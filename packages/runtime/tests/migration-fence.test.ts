import { describe, expect, it } from "vitest";

import { assertMigrationReadiness, assertPlatformReleaseReadiness, deriveMigrationLockKey, executeMigrationJob, MigrationFenceError, type MigrationSession } from "../src/index.js";

function harness(options: { lock?: boolean; revision?: number; migrationFails?: boolean } = {}) {
  let revision = options.revision ?? 6;
  let releaseRevision = "release-6";
  const queries: string[] = [];
  const session: MigrationSession = {
    async query<T extends object>(text: string) {
      queries.push(text);
      if (text.includes("from pg_database")) return { rows: [{ database_id: "16384" }] as T[] };
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: options.lock ?? true }] as T[] };
      if (text.startsWith("select revision")) return { rows: [{ revision }] as T[] };
      if (text.startsWith("update k_nex_release_revision")) {
        revision = 7; releaseRevision = "release-7";
        return { rows: [{ application_id: "customer.alpha", predecessor_revision: 6, revision, release_revision: releaseRevision }] as T[] };
      }
      return { rows: [] };
    },
    release() { queries.push("release"); }
  };
  return {
    queries,
    pool: {
      connect: async () => session,
      async query<T extends object>() { return { rows: [{ application_id: "customer.alpha", predecessor_revision: 6, revision, release_revision: releaseRevision }] as T[] }; }
    },
    migrate: async () => { queries.push("migrate"); if (options.migrationFails) throw new Error("interrupted"); }
  };
}

describe("migration execution fence", () => {
  it("derives stable database-scoped two-key advisory locks", () => {
    expect(deriveMigrationLockKey("customer.alpha", "16384")).toEqual(deriveMigrationLockKey("customer.alpha", "16384"));
    expect(deriveMigrationLockKey("customer.alpha", "16385")).not.toEqual(deriveMigrationLockKey("customer.alpha", "16384"));
  });

  it("owns one dedicated session, verifies predecessor, records release, and unlocks", async () => {
    const test = harness();
    await expect(executeMigrationJob({ pool: test.pool, applicationId: "customer.alpha", expectedPredecessorRevision: 6, targetRevision: 7, releaseRevision: "release-7", migrate: test.migrate })).resolves.toEqual({ applicationId: "customer.alpha", predecessorRevision: 6, revision: 7, releaseRevision: "release-7" });
    expect(test.queries).toEqual(expect.arrayContaining(["begin", "migrate", "commit", "release"]));
    expect(test.queries.some((query) => query.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("denies concurrent ownership and rolls back interrupted work", async () => {
    const concurrent = harness({ lock: false });
    await expect(executeMigrationJob({ pool: concurrent.pool, applicationId: "customer.alpha", expectedPredecessorRevision: 6, targetRevision: 7, releaseRevision: "release-7", migrate: concurrent.migrate })).rejects.toMatchObject({ code: "LOCK_UNAVAILABLE" });
    expect(concurrent.queries).not.toContain("migrate");

    const interrupted = harness({ migrationFails: true });
    await expect(executeMigrationJob({ pool: interrupted.pool, applicationId: "customer.alpha", expectedPredecessorRevision: 6, targetRevision: 7, releaseRevision: "release-7", migrate: interrupted.migrate })).rejects.toThrow("interrupted");
    expect(interrupted.queries).toEqual(expect.arrayContaining(["rollback", "release"]));
  });

  it("fails readiness for stale or mismatched releases", async () => {
    const current = harness({ revision: 7 });
    await expect(assertMigrationReadiness({ pool: current.pool, applicationId: "customer.alpha", artifactRevision: 6, releaseRevision: "release-6" })).rejects.toEqual(expect.objectContaining<Partial<MigrationFenceError>>({ code: "STALE_ARTIFACT" }));
    await expect(assertMigrationReadiness({ pool: current.pool, applicationId: "customer.alpha", artifactRevision: 7, releaseRevision: "wrong" })).rejects.toEqual(expect.objectContaining<Partial<MigrationFenceError>>({ code: "RELEASE_MISMATCH" }));
  });
});

/**
 * A completed platform release is only evidence while the database still
 * matches it, so this stands in for the three things that can drift apart
 * after the receipt is written: the release tuple, the migration set the
 * receipt was written for, and the ledger that set left behind.
 */
function platformDatabase(overrides: {
  predecessorRevision?: number; revision?: number; releaseRevision?: string;
  migrationSetDigest?: string | null; releaseClosure?: string | null; applied?: readonly string[];
} = {}) {
  const declared = ["20260827_000001_sales_baseline", "20260909_000036_release_revision"];
  const digest = "a".repeat(64);
  const releaseClosure = `sha256:${"c".repeat(64)}`;
  const row = {
    application_id: "customer.alpha",
    predecessor_revision: overrides.predecessorRevision ?? 0,
    revision: overrides.revision ?? 2,
    release_revision: overrides.releaseRevision ?? "platform-1.1.0-release",
    migration_set_digest: overrides.migrationSetDigest === undefined ? digest : overrides.migrationSetDigest,
    release_closure: overrides.releaseClosure === undefined ? releaseClosure : overrides.releaseClosure,
    applied: overrides.applied ?? declared
  };
  const queries: string[] = [];
  return {
    declared, digest, releaseClosure, queries,
    input: {
      applicationId: "customer.alpha", predecessorRevision: 0, revision: 2, releaseRevision: "platform-1.1.0-release",
      migrationSetDigest: digest, releaseClosure, declaredMigrations: declared
    },
    pool: {
      async query<T extends object>(text: string) {
        queries.push(text);
        return { rows: [row] as unknown as T[] };
      }
    }
  };
}

describe("platform release readiness", () => {
  it("accepts the canonical release only with its own migration set and ledger", async () => {
    const database = platformDatabase();
    await expect(assertPlatformReleaseReadiness({ pool: database.pool, ...database.input })).resolves.toEqual({
      applicationId: "customer.alpha", predecessorRevision: 0, revision: 2, releaseRevision: "platform-1.1.0-release",
      migrationSetDigest: database.digest, releaseClosure: database.releaseClosure, appliedMigrations: database.declared
    });
    // One statement: a second read would let a concurrent restore or migration
    // land between the release row and the ledger it is supposed to describe.
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]).toContain("k_nex_release_revision");
    expect(database.queries[0]).toContain("payload_migrations");
  });

  it("refuses a canonical release row whose durable ledger has drifted", async () => {
    const missing = platformDatabase({ applied: ["20260909_000036_release_revision"] });
    await expect(assertPlatformReleaseReadiness({ pool: missing.pool, ...missing.input })).rejects.toMatchObject({ code: "LEDGER_MISMATCH" });

    const reordered = platformDatabase({ applied: ["20260909_000036_release_revision", "20260827_000001_sales_baseline"] });
    await expect(assertPlatformReleaseReadiness({ pool: reordered.pool, ...reordered.input })).rejects.toMatchObject({ code: "LEDGER_MISMATCH" });

    const extra = platformDatabase({ applied: ["20260827_000001_sales_baseline", "20260909_000036_release_revision", "20260910_000037_unknown"] });
    await expect(assertPlatformReleaseReadiness({ pool: extra.pool, ...extra.input })).rejects.toMatchObject({ code: "LEDGER_MISMATCH" });
  });

  it("refuses a release recorded for migration bytes this artifact does not carry", async () => {
    const substituted = platformDatabase({ migrationSetDigest: "b".repeat(64) });
    await expect(assertPlatformReleaseReadiness({ pool: substituted.pool, ...substituted.input })).rejects.toMatchObject({ code: "MIGRATION_SET_MISMATCH" });

    const unrecorded = platformDatabase({ migrationSetDigest: null });
    await expect(assertPlatformReleaseReadiness({ pool: unrecorded.pool, ...unrecorded.input })).rejects.toMatchObject({ code: "MIGRATION_SET_MISMATCH" });

    const republished = platformDatabase({ releaseClosure: `sha256:${"d".repeat(64)}` });
    await expect(assertPlatformReleaseReadiness({ pool: republished.pool, ...republished.input })).rejects.toMatchObject({ code: "RELEASE_MISMATCH" });

    const unclosed = platformDatabase({ releaseClosure: null });
    await expect(assertPlatformReleaseReadiness({ pool: unclosed.pool, ...unclosed.input })).rejects.toMatchObject({ code: "RELEASE_MISMATCH" });
  });

  it("refuses a lineage-dependent release row for the same release identity", async () => {
    const lineage = platformDatabase({ predecessorRevision: 1 });
    await expect(assertPlatformReleaseReadiness({ pool: lineage.pool, ...lineage.input })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });

    const installing = platformDatabase({ revision: 0, releaseRevision: "platform-1.1.0-installing", migrationSetDigest: null });
    await expect(assertPlatformReleaseReadiness({ pool: installing.pool, ...installing.input })).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
  });

  it("keeps platform release receipts out of the lineage migration primitive", async () => {
    const test = harness();
    await expect(executeMigrationJob({
      pool: test.pool, applicationId: "customer.alpha", expectedPredecessorRevision: 6, targetRevision: 7,
      releaseRevision: "platform-1.1.0-release", migrate: test.migrate
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(test.queries).not.toContain("migrate");
  });
});
