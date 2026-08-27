import { describe, expect, it } from "vitest";

import { assertMigrationReadiness, deriveMigrationLockKey, executeMigrationJob, MigrationFenceError, type MigrationSession } from "../src/index.js";

function harness(options: { lock?: boolean; revision?: number; migrationFails?: boolean } = {}) {
  let revision = options.revision ?? 6;
  let releaseRevision = "release-6";
  const queries: string[] = [];
  const session: MigrationSession = {
    async query<T extends object>(text: string) {
      queries.push(text);
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
    expect(deriveMigrationLockKey("customer.alpha", "postgres://cluster/database")).toEqual(deriveMigrationLockKey("customer.alpha", "postgres://cluster/database"));
    expect(deriveMigrationLockKey("customer.alpha", "postgres://cluster/other")).not.toEqual(deriveMigrationLockKey("customer.alpha", "postgres://cluster/database"));
  });

  it("owns one dedicated session, verifies predecessor, records release, and unlocks", async () => {
    const test = harness();
    await expect(executeMigrationJob({ pool: test.pool, applicationId: "customer.alpha", databaseIdentity: "gate1", expectedPredecessorRevision: 6, targetRevision: 7, releaseRevision: "release-7", migrate: test.migrate })).resolves.toEqual({ applicationId: "customer.alpha", predecessorRevision: 6, revision: 7, releaseRevision: "release-7" });
    expect(test.queries).toEqual(expect.arrayContaining(["begin", "migrate", "commit", "release"]));
    expect(test.queries.some((query) => query.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("denies concurrent ownership and rolls back interrupted work", async () => {
    const concurrent = harness({ lock: false });
    await expect(executeMigrationJob({ pool: concurrent.pool, applicationId: "customer.alpha", databaseIdentity: "gate1", expectedPredecessorRevision: 6, targetRevision: 7, releaseRevision: "release-7", migrate: concurrent.migrate })).rejects.toMatchObject({ code: "LOCK_UNAVAILABLE" });
    expect(concurrent.queries).not.toContain("migrate");

    const interrupted = harness({ migrationFails: true });
    await expect(executeMigrationJob({ pool: interrupted.pool, applicationId: "customer.alpha", databaseIdentity: "gate1", expectedPredecessorRevision: 6, targetRevision: 7, releaseRevision: "release-7", migrate: interrupted.migrate })).rejects.toThrow("interrupted");
    expect(interrupted.queries).toEqual(expect.arrayContaining(["rollback", "release"]));
  });

  it("fails readiness for stale or mismatched releases", async () => {
    const current = harness({ revision: 7 });
    await expect(assertMigrationReadiness({ pool: current.pool, applicationId: "customer.alpha", artifactRevision: 6, releaseRevision: "release-6" })).rejects.toEqual(expect.objectContaining<Partial<MigrationFenceError>>({ code: "STALE_ARTIFACT" }));
    await expect(assertMigrationReadiness({ pool: current.pool, applicationId: "customer.alpha", artifactRevision: 7, releaseRevision: "wrong" })).rejects.toEqual(expect.objectContaining<Partial<MigrationFenceError>>({ code: "RELEASE_MISMATCH" }));
  });
});
