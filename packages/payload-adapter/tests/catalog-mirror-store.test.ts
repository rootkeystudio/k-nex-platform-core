import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@k-nex/contracts";
import { PostgresCatalogMirrorStore } from "../src/catalog-mirror-store.js";
import type { RuntimeExtensionPool, RuntimeExtensionSession } from "../src/runtime-extension-store.js";

const owner = { applicationId: "customer-alpha", environment: "production" } as const;
const actor = { kind: "user" as const, id: "user-1" };
const authorityEnvelope = { schemaVersion: 1 as const, ...owner, principal: actor, effectiveActor: actor, authorizationRevision: 1, lifecycleRevision: 1, permissions: [{ decisionId: "catalog-decision", permissionId: "system.catalog.refresh", owner: { kind: "platform" as const, namespace: "system" as const }, scope: { kind: "application" as const, resource: "system.catalog" } }] };
const authorityDigest = `sha256:${createHash("sha256").update(canonicalJson(authorityEnvelope)).digest("hex")}`;
const refresh = { refreshId: "catalog-refresh-1", expectedCatalogRevision: 0, requestedBy: actor, authorityEnvelope, idempotencyKey: "catalog-refresh-key-1" } as const;
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const payload = { schemaVersion: 1, sequence: 1, expiresAt: "2030-01-02T00:00:00.000Z", entries: [{ deliveryClass: "hot-application", id: "app.sales", version: "1.0.0", runtimeAbi: "1.0.0", publisher: { identity: "catalog-publisher", publicKey }, source: { repository: "https://github.com/k-nex/official-apps", commit: "0123456789abcdef0123456789abcdef01234567", assetUrl: "https://github.com/k-nex/official-apps/releases/download/v1.0.0/app.sales.tar.gz" }, artifactDigest: `sha256:${"a".repeat(64)}`, manifestDigest: `sha256:${"b".repeat(64)}`, sbomDigest: `sha256:${"c".repeat(64)}`, provenanceDigest: `sha256:${"d".repeat(64)}`, support: "supported", review: "approved", security: "clear", revoked: false }] } as const;
const signedCatalog = { schemaVersion: 1, signer: { identity: "catalog-signer", publicKey }, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64") } as const;
const snapshot = { snapshotId: "catalog-snapshot-1", signedCatalog, signerIdentity: signedCatalog.signer.identity, sequence: payload.sequence, digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`, releaseCount: payload.entries.length, observedAt: "2026-09-02T00:00:00.000Z" } as const;
const checkpoint = { signerIdentity: snapshot.signerIdentity, sequence: snapshot.sequence, payloadDigest: snapshot.digest, highestVersions: { "hot-application:app.sales": "1.0.0" } } as const;
const requirement = { deliveryClass: "hot-application", extensionId: "app.sales", generationId: "sales-generation-1", decisionDigest: `sha256:${"b".repeat(64)}` } as const;

function harness() {
  const queries: string[] = [];
  let operation: Record<string, unknown> | undefined;
  let stagedState = false;
  const query = vi.fn(async <T extends object>(text: string, values: readonly unknown[] = []) => {
    queries.push(text);
    if (text.startsWith("select expected_catalog_revision, authority_digest")) return { rows: [] as T[] };
    if (text.startsWith("select * from k_nex_catalog_refresh_operations")) return { rows: operation ? [operation] as T[] : [] as T[] };
    if (text.startsWith("select sequence, payload_digest, release_count, observed_at from k_nex_catalog_mirror_snapshots")) return { rows: [{ sequence: snapshot.sequence, payload_digest: snapshot.digest, release_count: snapshot.releaseCount, observed_at: snapshot.observedAt }] as T[] };
    if (text.startsWith("select catalog_revision, staged_snapshot_id")) return { rows: [{ catalog_revision: 0, staged_snapshot_id: stagedState ? snapshot.snapshotId : null }] as T[] };
    if (text.startsWith("select signer_identity, sequence")) return { rows: [] as T[] };
    if (text.startsWith("insert into k_nex_catalog_refresh_operations")) {
      operation = { refresh_id: refresh.refreshId, expected_catalog_revision: 0, staged_snapshot_id: snapshot.snapshotId, requested_by_kind: "user", requested_by_id: "user-1", authority_json: authorityEnvelope, authority_digest: authorityDigest, idempotency_key: refresh.idempotencyKey, state: "staged-reconciliation", revision: 1, updated_at: snapshot.observedAt };
    }
    if (text.startsWith("update k_nex_catalog_mirror_state set staged_snapshot_id")) stagedState = true;
    if (text.startsWith("update k_nex_catalog_refresh_operations set revision=revision+1")) {
      operation = { ...operation, revision: 2 };
      return { rows: [operation] as T[] };
    }
    return { rows: [] as T[] };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { query, connect: vi.fn(async () => session) };
  return { queries, query, store: new PostgresCatalogMirrorStore(pool, owner) };
}

describe("PostgresCatalogMirrorStore", () => {
  it("stages checkpoint, immutable snapshot, operation, and per-release requirements in one transaction", async () => {
    const value = harness();

    const operation = await value.store.stageVerified({ refresh, snapshot, expectedCheckpoint: undefined, checkpoint, requirements: [requirement] });

    expect(operation).toMatchObject({ state: "staged-reconciliation", refreshId: refresh.refreshId, staged: { digest: snapshot.digest } });
    expect(value.queries).toEqual(expect.arrayContaining([
      "begin",
      expect.stringContaining("runtime_catalog_checkpoints"),
      expect.stringContaining("k_nex_catalog_mirror_snapshots"),
      expect.stringContaining("k_nex_catalog_refresh_operations"),
      expect.stringContaining("k_nex_catalog_reconciliation_requirements"),
      "commit"
    ]));
    expect(value.queries.filter((query) => query.startsWith("insert into k_nex_catalog_refresh_receipts"))).toHaveLength(0);
  });

  it("rejects duplicate impacted releases before database writes", async () => {
    const value = harness();

    await expect(value.store.stageVerified({ refresh, snapshot, expectedCheckpoint: undefined, checkpoint, requirements: [requirement, requirement] })).rejects.toMatchObject({ code: "INVALID" });
    expect(value.queries).toEqual([]);
  });

  it("rejects forged snapshot metadata before checkpoint or snapshot writes", async () => {
    const value = harness();
    await expect(value.store.stageVerified({ refresh, snapshot: { ...snapshot, digest: `sha256:${"e".repeat(64)}` }, expectedCheckpoint: undefined, checkpoint, requirements: [requirement] })).rejects.toMatchObject({ code: "INVALID" });
    expect(value.queries).toEqual([]);
  });

  it("replaces stale requirements under the mirror lock without moving the staged pointer", async () => {
    const value = harness();
    await value.store.stageVerified({ refresh, snapshot, expectedCheckpoint: undefined, checkpoint, requirements: [] });
    await value.store.rebaseRequirements({ refreshId: refresh.refreshId, expectedOperationRevision: 1, expectedCatalogRevision: 0, requirements: [requirement] });

    expect(value.queries).toEqual(expect.arrayContaining([
      "begin",
      expect.stringContaining("for update"),
      expect.stringContaining("delete from k_nex_catalog_reconciliation_requirements"),
      expect.stringContaining("insert into k_nex_catalog_reconciliation_requirements"),
      expect.stringContaining("update k_nex_catalog_refresh_operations set revision=revision+1"),
      "commit"
    ]));
  });

  it("reads staged catalog before accepted catalog, owner-scoped", async () => {
    const staged = { pointer_id: "catalog-snapshot-1", snapshot_id: "catalog-snapshot-1", signer_identity: snapshot.signerIdentity, sequence: snapshot.sequence, payload_digest: snapshot.digest, release_count: snapshot.releaseCount, observed_at: snapshot.observedAt, snapshot_json: snapshot.signedCatalog };
    const accepted = { ...staged, pointer_id: "catalog-snapshot-2", snapshot_id: "catalog-snapshot-2" };
    const query = vi.fn(async <T extends object>(text: string) => ({ rows: [text.includes("coalesce(s.staged") ? staged : accepted] as T[] }));
    const pool: RuntimeExtensionPool = { query, connect: vi.fn() };
    const store = new PostgresCatalogMirrorStore(pool, owner);
    await expect(store.readSecuritySnapshot(owner)).resolves.toMatchObject({ snapshotId: "catalog-snapshot-1" });
    await expect(store.readAcceptedSnapshot()).resolves.toMatchObject({ snapshotId: "catalog-snapshot-2" });
    expect(query.mock.calls[0]?.[1]).toEqual([owner.applicationId, owner.environment]);
  });

  it("rejects a security snapshot request for another owner before querying", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool: RuntimeExtensionPool = { query, connect: vi.fn() };
    const store = new PostgresCatalogMirrorStore(pool, owner);

    await expect(store.readSecuritySnapshot({ applicationId: "customer-beta", environment: owner.environment })).rejects.toMatchObject({ code: "INVALID" });
    expect(query).not.toHaveBeenCalled();
  });

  it("has no accepted catalog before state exists", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool: RuntimeExtensionPool = { query, connect: vi.fn() };

    await expect(new PostgresCatalogMirrorStore(pool, owner).readObservation()).resolves.toEqual({ schemaVersion: 1, catalogRevision: 0, state: "no-accepted-snapshot" });
  });
});
