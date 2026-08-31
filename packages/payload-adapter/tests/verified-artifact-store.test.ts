import { canonicalJson } from "@k-nex/contracts";
import { sha256 } from "@k-nex/extension-bundler";
import { describe, expect, it, vi } from "vitest";

import { PostgresVerifiedArtifactStore } from "../src/index.js";

const artifactDigest = `sha256:${"a".repeat(64)}` as const;
const manifestDigest = `sha256:${"b".repeat(64)}` as const;
const provenanceDigest = `sha256:${"c".repeat(64)}` as const;
const sbomDigest = `sha256:${"d".repeat(64)}` as const;
const authority = {
  applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application" as const,
  extensionId: "app.sales-assistant", generationId: "sales-generation-1", sourceCommit: "abcdef1234567890",
  artifactDigest, manifestDigest, provenanceDigest, sbomDigest, catalogDigest: "" as string
};
const catalog = { payload: { sequence: 1 } };
authority.catalogDigest = sha256(Buffer.from(canonicalJson(catalog)));

const verified = {
  artifactDigest,
  entry: { manifestDigest, provenanceDigest, sbomDigest, source: { commit: authority.sourceCommit } },
  manifest: {
    deliveryClass: "hot-application" as const, id: authority.extensionId, version: "1.0.0", resourceBudget: { maxCpuMs: 1 }
  },
  hotApplicationManifest: { screens: [] },
  files: new Map()
};

describe("PostgresVerifiedArtifactStore Remote UI reader", () => {
  it("rejects poisoned accepted evidence before creating a binding", async () => {
    const writes: string[] = [];
    const activation = { compatibility: { mode: "compatible" }, metadata: {}, settings: {}, storageSchemaVersions: {} } as any;
    const session = {
      query: vi.fn(async (text: string) => {
        writes.push(text);
        if (text.includes("from runtime_extension_artifacts")) return { rows: [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
        if (text.includes("from runtime_extension_artifact_acceptances")) {
          return { rows: [{ artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: { payload: { sequence: 2 } }, provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass, extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    const pool = {
      connect: async () => session,
      query: vi.fn(async () => { throw new Error("stage must validate through its transaction session"); })
    };
    const store = new PostgresVerifiedArtifactStore(pool as any, { verify: vi.fn(async () => verified) } as any);

    await expect(store.stage({
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: Buffer.from("bundle"), provenance: Buffer.from("provenance"), deliveryClass: authority.deliveryClass, id: authority.extensionId, version: "1.0.0", runtimeAbi: "1.0.0" },
      authority, activation
    })).rejects.toMatchObject({ code: "ARTIFACT_CONFLICT" });
    expect(writes.find((query) => query.includes("insert into runtime_extension_artifacts"))).toContain("(artifact_digest, artifact_bytes)");
    expect(writes.find((query) => query.includes("insert into runtime_extension_artifact_acceptances"))).toContain("(artifact_digest, catalog_digest");
    expect(writes.some((query) => query.includes("insert into runtime_extension_artifact_bindings"))).toBe(false);
    expect(writes.filter((query) => query.includes("insert into runtime_extension_artifact")).every((query) => !query.includes("do update"))).toBe(true);
  });

  it("reads remote UI through its max-1 transaction session without deadlocking", async () => {
    let releaseLock: (() => void) | undefined;
    const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const queries: string[] = [];
    const row = {
      application_id: authority.applicationId, environment: authority.environment, delivery_class: authority.deliveryClass,
      extension_id: authority.extensionId, generation_id: authority.generationId, artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest,
      authority_json: authority, activation_json: { metadata: {}, settings: {}, storageSchemaVersions: {} }, version: "1.0.0"
    };
    const session = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        queries.push(text);
        if (text.startsWith("select pg_advisory_xact_lock")) await lock;
        if (text.includes("from runtime_extension_artifact_bindings")) {
          expect(values).toEqual([authority.applicationId, authority.environment, authority.extensionId, authority.generationId, artifactDigest]);
          return { rows: [row] };
        }
        if (text.includes("from runtime_extension_artifacts")) {
          expect(values).toEqual([artifactDigest]);
          return { rows: [{ artifact_digest: artifactDigest, artifact_bytes: Buffer.from("bundle") }] };
        }
        if (text.includes("from runtime_extension_artifact_acceptances")) {
          expect(values).toEqual([artifactDigest, authority.catalogDigest]);
          return { rows: [{ artifact_digest: artifactDigest, catalog_digest: authority.catalogDigest, catalog_json: catalog, provenance_bytes: Buffer.from("provenance"), delivery_class: authority.deliveryClass, extension_id: authority.extensionId, version: "1.0.0", runtime_abi: "1.0.0" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    const pool = {
      max: 1,
      connect: async () => session,
      query: vi.fn(async () => { throw new Error("readRemoteUi must not request a second pool session"); })
    };
    const store = new PostgresVerifiedArtifactStore(
      pool as any,
      { verifyAccepted: vi.fn(async () => verified) } as any
    );

    const reading = store.readRemoteUi({
      applicationId: authority.applicationId, environment: authority.environment, extensionId: authority.extensionId,
      generationId: authority.generationId, artifactDigest
    });
    await Promise.resolve();
    expect(queries.some((query) => query.includes("from runtime_extension_artifact_bindings"))).toBe(false);

    releaseLock?.();
    await expect(reading).resolves.toMatchObject({ artifactDigest, catalogDigest: authority.catalogDigest });
    const activeBindingQuery = queries.find((query) => query.includes("from runtime_extension_artifact_bindings"));
    expect(activeBindingQuery).toContain("e.active_generation=jsonb_build_object(");
    expect(activeBindingQuery).toContain("'receiptId', r.receipt_id");
    expect(activeBindingQuery).toContain("g.authority_json=b.authority_json");
    expect(activeBindingQuery).toContain("and g.receipt_id=r.receipt_id");
    expect(activeBindingQuery).toContain("join runtime_extension_artifact_acceptances c on c.artifact_digest=b.artifact_digest and c.catalog_digest=b.catalog_digest");
    expect(activeBindingQuery).toContain("join lateral (");
    expect(activeBindingQuery).toContain("order by r.revision desc");
    expect(activeBindingQuery).toContain("o.operation_kind in ('install','update','rollback')");
    expect(activeBindingQuery).toContain("r.event_json->>'receiptId'=r.receipt_id");
    expect(activeBindingQuery).toContain("r.event_json->'evidence'->>'catalogDigest'=b.authority_json->>'catalogDigest'");
    expect(queries.findIndex((query) => query.startsWith("select pg_advisory_xact_lock"))).toBeLessThan(
      queries.findIndex((query) => query.includes("from runtime_extension_artifact_bindings"))
    );
    expect(queries.some((query) => query.includes("runtime_extension_artifacts where artifact_digest=$1"))).toBe(true);
    expect(queries.some((query) => query.includes("runtime_extension_artifact_acceptances where artifact_digest=$1 and catalog_digest=$2"))).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
    expect(session.release).toHaveBeenCalledOnce();
  });
});
