import { describe, expect, it, vi } from "vitest";

import { canonicalJson, type RuntimeExtensionInventory } from "@k-nex/contracts";
import { sha256, type VerifiedCatalogSnapshot } from "@k-nex/extension-bundler";

import { CatalogRefreshCoordinator } from "../src/catalog-refresh-coordinator.js";
import { CatalogMirrorStoreError, type CatalogMirrorRefresh } from "../src/catalog-mirror-store.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const owner = { applicationId: "customer-alpha", environment: "production" } as const;
const refresh: CatalogMirrorRefresh = { refreshId: "catalog-refresh-1", expectedCatalogRevision: 0, requestedBy: { kind: "user", id: "user-1" }, idempotencyKey: "catalog-refresh-key-1" };
const payload = { sequence: 1, entries: [{ deliveryClass: "hot-application", id: "app.sales", version: "1.0.0" }] };
const snapshotDigest = sha256(Buffer.from(canonicalJson(payload)));
const snapshot = {
  catalog: { signer: { identity: "catalog-signer" }, payload },
  entries: [{ deliveryClass: "hot-application", id: "app.sales", version: "1.0.0" }],
  checkpoint: { signerIdentity: "catalog-signer", sequence: 1, payloadDigest: snapshotDigest, highestVersions: { "hot-application:app.sales": "1.0.0" } }
} as unknown as VerifiedCatalogSnapshot;
const stagedSnapshot = { snapshotId: "catalog-snapshot-1", signedCatalog: snapshot.catalog, signerIdentity: "catalog-signer", sequence: 1, digest: snapshotDigest, releaseCount: 1, observedAt: "2026-09-02T00:00:00.000Z" } as const;
const fetching = { schemaVersion: 1, refreshId: refresh.refreshId, expectedCatalogRevision: 0, requestedBy: refresh.requestedBy, idempotencyKey: refresh.idempotencyKey, state: "fetching", revision: 1, updatedAt: "2026-09-02T00:00:00.000Z" } as const;
const staged = { ...fetching, state: "staged-reconciliation" as const, revision: 2, staged: { sequence: 1, digest: stagedSnapshot.digest, releaseCount: 1, observedAt: stagedSnapshot.observedAt } };

function inventory(quarantined = false): RuntimeExtensionInventory {
  return {
    schemaVersion: 1, applicationId: owner.applicationId, environment: owner.environment, hostInventoryDigest: digest("0"), revision: 1, observedAt: stagedSnapshot.observedAt, stateDigest: digest("1"),
    extensions: {
      platformPlugins: {},
      hotApplications: {
        "app.sales": {
          disposition: quarantined ? "quarantined" : "active", revision: 3, lastOperationId: "operation-sales", lastReceiptId: "receipt-sales", stateDigest: digest("2"),
          ...(quarantined ? { retainedGeneration: { authority: "verified-bundle", applicationId: owner.applicationId, environment: owner.environment, generationId: "generation-sales", version: "1.0.0", sourceCommit: "a".repeat(40), artifactDigest: digest("3"), manifestDigest: digest("4"), catalogDigest: digest("5"), provenanceDigest: digest("6"), sbomDigest: digest("7"), receiptId: "receipt-sales", deliveryClass: "hot-application", extensionId: "app.sales" } } : { activeGeneration: { authority: "verified-bundle", applicationId: owner.applicationId, environment: owner.environment, generationId: "generation-sales", version: "1.0.0", sourceCommit: "a".repeat(40), artifactDigest: digest("3"), manifestDigest: digest("4"), catalogDigest: digest("5"), provenanceDigest: digest("6"), sbomDigest: digest("7"), receiptId: "receipt-sales", deliveryClass: "hot-application", extensionId: "app.sales" } })
        }
      },
      themeSkins: {}
    }
  } as RuntimeExtensionInventory;
}

function harness(options: Readonly<{ initial?: typeof fetching | typeof staged | ReturnType<typeof acceptedReceipt>; readerError?: Error; verifyError?: Error; stageError?: Error; reconciliation?: "clear" | "quarantined"; previousCheckpoint?: VerifiedCatalogSnapshot["checkpoint"] }> = {}) {
  let current = options.initial ?? fetching;
  let quarantined = false;
  const decision = { catalogDigest: digest("a"), catalogSignerIdentity: "catalog-signer", catalogSequence: 1, release: {}, disposition: "clear" };
  const requirements: Array<{ deliveryClass: "hot-application" | "theme-skin"; extensionId: string; generationId: string; decisionDigest: string; terminalState: "pending" | "clear" | "quarantined"; securityReceiptId?: string }> = [];
  if (current.state === "staged-reconciliation") requirements.push({
    deliveryClass: "hot-application", extensionId: "app.sales", generationId: "generation-sales",
    decisionDigest: sha256(Buffer.from(canonicalJson({ applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: "hot-application", id: "app.sales" }, expectedRevision: 3, generationId: "generation-sales", decision }))),
    terminalState: "pending"
  });
  const accepted = acceptedReceipt();
  const rejected = rejectedReceipt("fetch-failed");
  const reader = { read: vi.fn(async () => { if (options.readerError) throw options.readerError; return snapshot.catalog; }) };
  const catalog = {
    verifySnapshot: vi.fn(async () => { if (options.verifyError) throw options.verifyError; return snapshot; }),
    verifyStagedSnapshot: vi.fn(async () => snapshot)
  };
  const mirror = {
    begin: vi.fn(async () => current),
    stageVerified: vi.fn(async (input) => {
      if (options.stageError) throw options.stageError;
      requirements.splice(0, requirements.length, ...input.requirements.map((requirement: typeof requirements[number]) => ({ ...requirement, terminalState: "pending" as const })));
      current = staged;
      return staged;
    }),
    readStaged: vi.fn(async () => current.state === "staged-reconciliation" ? { operation: current, snapshot: stagedSnapshot } : undefined),
    readRequirements: vi.fn(async () => requirements),
    rebaseRequirements: vi.fn(async (input) => {
      const next = input.requirements.map((requirement: typeof requirements[number]) => ({ ...requirement, terminalState: "pending" as const }));
      if (canonicalJson(requirements.map(({ terminalState: _state, securityReceiptId: _receipt, ...requirement }) => requirement)) !== canonicalJson(input.requirements)) {
        requirements.splice(0, requirements.length, ...next);
        current = { ...current, revision: current.revision + 1 } as typeof staged;
      }
      return current;
    }),
    markReconciliationTerminal: vi.fn(async (input) => {
      const requirement = requirements.find((candidate) => candidate.extensionId === input.requirement.extensionId && candidate.generationId === input.requirement.generationId);
      if (!requirement) throw new Error("missing requirement");
      requirement.terminalState = input.state;
      requirement.securityReceiptId = input.securityReceiptId;
    }),
    readObservation: vi.fn(async () => ({ schemaVersion: 1, catalogRevision: 1, state: "staged-reconciliation" as const, staged: staged.staged })),
    acceptAfterTerminalReconciliation: vi.fn(async () => { current = accepted; return accepted; }),
    reject: vi.fn(async (input) => { current = rejectedReceipt(input.reason); return current; })
  };
  const reconciler = { reconcileSnapshot: vi.fn(async () => {
    if (options.reconciliation === "quarantined") {
      quarantined = true;
      return { status: "quarantined" as const, receipt: { receiptId: "security-receipt-1" } };
    }
    return { status: "clear" as const };
  }) };
  const extensions = { inventory: vi.fn(async () => inventory(quarantined)) };
  const coordinator = new CatalogRefreshCoordinator({
    owner, reader, catalog, checkpoints: { read: vi.fn(async () => current.state === "staged-reconciliation" ? snapshot.checkpoint : options.previousCheckpoint) },
    verifier: { currentSecurityDecisionFromSnapshot: vi.fn(() => decision) },
    mirror, extensions, reconciler,
    now: () => new Date(stagedSnapshot.observedAt), ids: { snapshot: () => "catalog-snapshot-1", receipt: () => "catalog-receipt-1", audit: () => "catalog-audit-1", event: () => "catalog-event-1" }
  });
  return { coordinator, reader, catalog, mirror, reconciler, requirements, extensions, accepted };
}

function acceptedReceipt() { return { schemaVersion: 1, receiptId: "catalog-receipt-1", refreshId: refresh.refreshId, outcome: "accepted" as const, catalogRevision: 2, accepted: staged.staged, reconciledReleaseCount: 1, requestedBy: refresh.requestedBy, idempotencyKey: refresh.idempotencyKey, occurredAt: stagedSnapshot.observedAt }; }
function rejectedReceipt(reason: "stale-revision" | "fetch-failed" | "snapshot-invalid" | "snapshot-replayed") { return { schemaVersion: 1, receiptId: "catalog-receipt-1", refreshId: refresh.refreshId, outcome: "rejected" as const, reason, requestedBy: refresh.requestedBy, idempotencyKey: refresh.idempotencyKey, occurredAt: stagedSnapshot.observedAt }; }

describe("CatalogRefreshCoordinator", () => {
  it("verifies, stages, reconciles clear releases, then atomically accepts", async () => {
    const value = harness();

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "accepted" });
    expect(value.catalog.verifySnapshot).toHaveBeenCalledTimes(2);
    expect(value.catalog.verifyStagedSnapshot).toHaveBeenCalledTimes(1);
    expect(value.mirror.stageVerified).toHaveBeenCalledTimes(1);
    expect(value.mirror.markReconciliationTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: "clear" }));
    expect(value.mirror.acceptAfterTerminalReconciliation).toHaveBeenCalledWith(expect.objectContaining({ reconciledReleaseCount: 1, expectedInventoryRevision: 1 }));
  });

  it("persists fetch failure without replacing prior pointer", async () => {
    const value = harness({ readerError: new Error("network down") });

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "rejected", reason: "fetch-failed" });
    expect(value.mirror.stageVerified).not.toHaveBeenCalled();
    expect(value.mirror.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: "fetch-failed" }));
  });

  it("persists replay rejection", async () => {
    const value = harness({ verifyError: new Error("Official catalog checkpoint is stale or replayed.") });

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "rejected", reason: "snapshot-replayed" });
    expect(value.mirror.stageVerified).not.toHaveBeenCalled();
  });

  it("persists an exact checkpoint replay before staging", async () => {
    const value = harness({ previousCheckpoint: snapshot.checkpoint });

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "rejected", reason: "snapshot-replayed" });
    expect(value.mirror.stageVerified).not.toHaveBeenCalled();
  });

  it("terminalizes a concurrent stale stage", async () => {
    const value = harness({ stageError: new CatalogMirrorStoreError("REVISION", "Catalog revision changed before refresh.") });

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "rejected", reason: "stale-revision" });
    expect(value.mirror.reject).toHaveBeenCalledWith(expect.objectContaining({ reason: "stale-revision" }));
  });

  it("leaves fetching state intact when durable staging fails", async () => {
    const value = harness({ stageError: new Error("database unavailable") });

    await expect(value.coordinator.refresh(refresh)).rejects.toThrow("database unavailable");
    expect(value.mirror.reject).not.toHaveBeenCalled();
  });

  it("resumes staged work after crash without fetching again", async () => {
    const value = harness({ initial: staged });

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "accepted" });
    expect(value.reader.read).not.toHaveBeenCalled();
    expect(value.mirror.stageVerified).not.toHaveBeenCalled();
    expect(value.reconciler.reconcileSnapshot).toHaveBeenCalledTimes(1);
  });

  it("binds exact quarantine receipt before acceptance", async () => {
    const value = harness({ reconciliation: "quarantined" });

    await value.coordinator.refresh(refresh);
    expect(value.mirror.markReconciliationTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: "quarantined", securityReceiptId: "security-receipt-1" }));
  });

  it("returns durable terminal receipt on replay", async () => {
    const value = harness({ initial: acceptedReceipt() });

    await expect(value.coordinator.refresh(refresh)).resolves.toEqual(value.accepted);
    expect(value.reader.read).not.toHaveBeenCalled();
    expect(value.mirror.acceptAfterTerminalReconciliation).not.toHaveBeenCalled();
  });

  it("durably rebases a replaced active generation and accepts it", async () => {
    const value = harness();
    const changed = inventory();
    const active = changed.extensions.hotApplications["app.sales"];
    if (active?.disposition !== "active") throw new Error("test fixture requires active generation");
    active.activeGeneration = { ...active.activeGeneration, generationId: "generation-replaced" };
    value.extensions.inventory.mockResolvedValueOnce(inventory()).mockResolvedValue(changed);

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "accepted" });
    expect(value.mirror.rebaseRequirements).toHaveBeenCalledWith(expect.objectContaining({ requirements: [expect.objectContaining({ generationId: "generation-replaced" })] }));
    expect(value.mirror.markReconciliationTerminal).toHaveBeenCalledWith(expect.objectContaining({ requirement: expect.objectContaining({ generationId: "generation-replaced" }) }));
    expect(value.mirror.acceptAfterTerminalReconciliation).toHaveBeenCalled();
  });

  it("durably rebases a newly active extension and terminalizes both exact releases", async () => {
    const value = harness({ initial: staged });
    const changed = inventory();
    const active = changed.extensions.hotApplications["app.sales"];
    if (active?.disposition !== "active") throw new Error("test fixture requires active generation");
    changed.extensions.hotApplications["app.new"] = { ...active, activeGeneration: { ...active.activeGeneration, extensionId: "app.new", generationId: "generation-new" } };
    value.extensions.inventory.mockResolvedValue(changed);

    await expect(value.coordinator.refresh(refresh)).resolves.toMatchObject({ outcome: "accepted" });
    expect(value.mirror.rebaseRequirements).toHaveBeenCalledWith(expect.objectContaining({ requirements: expect.arrayContaining([expect.objectContaining({ extensionId: "app.new", generationId: "generation-new" })]) }));
    expect(value.mirror.markReconciliationTerminal).toHaveBeenCalledTimes(2);
    expect(value.mirror.acceptAfterTerminalReconciliation).toHaveBeenCalledWith(expect.objectContaining({ reconciledReleaseCount: 2 }));
  });
});
