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
  it("takes the lifecycle advisory lock before resolving the active durable generation and reverified bytes", async () => {
    let releaseLock: (() => void) | undefined;
    const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const queries: string[] = [];
    const row = {
      application_id: authority.applicationId, environment: authority.environment, delivery_class: authority.deliveryClass,
      extension_id: authority.extensionId, generation_id: authority.generationId, artifact_digest: artifactDigest,
      authority_json: authority, activation_json: { metadata: {}, settings: {}, storageSchemaVersions: {} }, version: "1.0.0",
      catalog_json: catalog, artifact_bytes: Buffer.from("bundle"), provenance_bytes: Buffer.from("provenance"), runtime_abi: "1.0.0"
    };
    const session = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        queries.push(text);
        if (text.startsWith("select pg_advisory_xact_lock")) await lock;
        if (text.includes("from runtime_extension_artifact_bindings")) {
          expect(values).toEqual([authority.applicationId, authority.environment, authority.extensionId, authority.generationId, artifactDigest]);
          return { rows: [row] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    const store = new PostgresVerifiedArtifactStore(
      { connect: async () => session, query: vi.fn() } as any,
      { verifyAccepted: vi.fn(async () => verified) } as any
    );

    const reading = store.readRemoteUi({
      applicationId: authority.applicationId, environment: authority.environment, extensionId: authority.extensionId,
      generationId: authority.generationId, artifactDigest
    });
    await Promise.resolve();
    expect(queries.some((query) => query.includes("from runtime_extension_artifact_bindings"))).toBe(false);

    releaseLock?.();
    await expect(reading).resolves.toMatchObject({ artifactDigest });
    const activeBindingQuery = queries.find((query) => query.includes("from runtime_extension_artifact_bindings"));
    expect(activeBindingQuery).toContain("e.active_generation=jsonb_build_object(");
    expect(activeBindingQuery).toContain("'receiptId', r.receipt_id");
    expect(activeBindingQuery).toContain("g.authority_json=b.authority_json");
    expect(activeBindingQuery).toContain("and g.receipt_id=r.receipt_id");
    expect(activeBindingQuery).toContain("join lateral (");
    expect(activeBindingQuery).toContain("order by r.revision desc");
    expect(activeBindingQuery).toContain("o.operation_kind in ('install','update','rollback')");
    expect(activeBindingQuery).toContain("r.event_json->>'receiptId'=r.receipt_id");
    expect(activeBindingQuery).toContain("r.event_json->'evidence'->>'catalogDigest'=b.authority_json->>'catalogDigest'");
    expect(queries.findIndex((query) => query.startsWith("select pg_advisory_xact_lock"))).toBeLessThan(
      queries.findIndex((query) => query.includes("from runtime_extension_artifact_bindings"))
    );
    expect(session.release).toHaveBeenCalledOnce();
  });
});
