import {
  RuntimeExtensionInventorySchema,
  type ExtensionIdentity,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";
import type { ArtifactVerifier, CurrentCatalogSecurityDecision, SignedCatalog } from "@k-nex/extension-bundler";
import type { ExtensionSecurityQuarantineReceipt, RuntimeExtensionStore } from "@k-nex/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  ActiveExtensionSecurityReconciler,
  type ActiveExtensionSecurityReconcileRequest
} from "../src/active-extension-security-reconciler.js";
import { RuntimeExtensionStoreError } from "../src/runtime-extension-store.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const identity = { deliveryClass: "hot-application", id: "app.sales-live" } as const satisfies Extract<ExtensionIdentity, { deliveryClass: "hot-application" | "theme-skin" }>;
const catalog = Object.freeze({}) as SignedCatalog;
const generation = {
  authority: "verified-bundle" as const,
  applicationId: "customer-alpha",
  environment: "production",
  generationId: "generation-live",
  version: "1.0.0",
  sourceCommit: "a".repeat(40),
  artifactDigest: digest("b"),
  manifestDigest: digest("c"),
  catalogDigest: digest("d"),
  provenanceDigest: digest("e"),
  sbomDigest: digest("f"),
  receiptId: "receipt-live",
  deliveryClass: "hot-application" as const,
  extensionId: identity.id
};
const receipt: ExtensionSecurityQuarantineReceipt = {
  receiptId: "security-receipt-live",
  securityTransitionId: "security-transition-live",
  disposition: "quarantined",
  reason: "revoked",
  generationId: generation.generationId,
  revisionBefore: 17,
  revisionAfter: 18,
  inventoryRevision: 31,
  catalogDigest: digest("9"),
  occurredAt: "2026-08-31T12:00:00.000Z"
};
const revokedDecision: CurrentCatalogSecurityDecision = {
  catalogDigest: receipt.catalogDigest,
  catalogSignerIdentity: "k-nex-catalog",
  catalogSequence: 7,
  release: {
    deliveryClass: generation.deliveryClass,
    id: generation.extensionId,
    version: generation.version,
    sourceCommit: generation.sourceCommit,
    artifactDigest: generation.artifactDigest,
    manifestDigest: generation.manifestDigest,
    provenanceDigest: generation.provenanceDigest,
    sbomDigest: generation.sbomDigest
  },
  disposition: "revoked"
};

type ReconcilerStore = Pick<RuntimeExtensionStore, "inventory" | "quarantineActiveGeneration" | "readSecurityQuarantineReceipt">;

function inventory(disposition: "active" | "quarantined", revision: number): RuntimeExtensionInventory {
  return RuntimeExtensionInventorySchema.parse({
    schemaVersion: 1,
    applicationId: "customer-alpha",
    environment: "production",
    hostInventoryDigest: digest("0"),
    revision: 80,
    observedAt: "2026-08-31T12:00:00.000Z",
    stateDigest: digest("1"),
    extensions: {
      platformPlugins: {},
      hotApplications: {
        [identity.id]: {
          disposition,
          revision,
          lastOperationId: "operation-live",
          lastReceiptId: "receipt-live",
          stateDigest: digest("2"),
          ...(disposition === "active" ? { activeGeneration: generation } : { retainedGeneration: generation })
        }
      },
      themeSkins: {}
    }
  });
}

function harness() {
  const inventoryRead = vi.fn<ReconcilerStore["inventory"]>();
  const quarantineActiveGeneration = vi.fn<ReconcilerStore["quarantineActiveGeneration"]>();
  const readSecurityQuarantineReceipt = vi.fn<ReconcilerStore["readSecurityQuarantineReceipt"]>();
  const store: ReconcilerStore = { inventory: inventoryRead, quarantineActiveGeneration, readSecurityQuarantineReceipt };
  const verifier = { currentSecurityDecision: vi.fn<ArtifactVerifier["currentSecurityDecision"]>() };
  const reconciler = new ActiveExtensionSecurityReconciler(verifier as ArtifactVerifier, store);

  return {
    reconcile: reconciler.reconcile.bind(reconciler),
    inventoryRead,
    quarantineActiveGeneration,
    readSecurityQuarantineReceipt,
    verifier
  };
}

function request(): ActiveExtensionSecurityReconcileRequest {
  return { applicationId: "customer-alpha", environment: "production", extension: identity, catalog };
}

describe("ActiveExtensionSecurityReconciler", () => {
  it("uses the active inventory revision rather than public caller state", async () => {
    const value = harness();
    value.inventoryRead.mockResolvedValue(inventory("active", 17));
    value.verifier.currentSecurityDecision.mockResolvedValue(revokedDecision);
    value.quarantineActiveGeneration.mockResolvedValue(receipt);
    const input = request();

    expect("expectedRevision" in input).toBe(false);
    await expect(value.reconcile(input)).resolves.toEqual({ status: "quarantined", receipt });
    expect(value.quarantineActiveGeneration).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: input.applicationId,
      environment: input.environment,
      extension: input.extension,
      generationId: generation.generationId,
      expectedRevision: 17
    }));
  });

  it.each(["REVISION_CONFLICT", "GENERATION_MISMATCH"] as const)("retries %s against freshly read inventory and succeeds", async (code) => {
    const value = harness();
    value.inventoryRead.mockResolvedValueOnce(inventory("active", 21)).mockResolvedValueOnce(inventory("active", 22));
    value.verifier.currentSecurityDecision.mockResolvedValue(revokedDecision);
    value.quarantineActiveGeneration.mockRejectedValueOnce(new RuntimeExtensionStoreError(code, "stale security transition")).mockResolvedValueOnce(receipt);

    await expect(value.reconcile(request())).resolves.toEqual({ status: "quarantined", receipt });
    expect(value.inventoryRead).toHaveBeenCalledTimes(2);
    expect(value.quarantineActiveGeneration).toHaveBeenCalledTimes(2);
    expect(value.quarantineActiveGeneration.mock.calls.map(([input]) => input.expectedRevision)).toEqual([21, 22]);
  });

  it("stops after exactly three retryable failures and returns the final error", async () => {
    const value = harness();
    const failure = new RuntimeExtensionStoreError("REVISION_CONFLICT", "final authoritative conflict");
    value.inventoryRead.mockResolvedValueOnce(inventory("active", 31)).mockResolvedValueOnce(inventory("active", 32)).mockResolvedValueOnce(inventory("active", 33));
    value.verifier.currentSecurityDecision.mockResolvedValue(revokedDecision);
    value.quarantineActiveGeneration.mockRejectedValue(failure);

    await expect(value.reconcile(request())).rejects.toBe(failure);
    expect(value.inventoryRead).toHaveBeenCalledTimes(3);
    expect(value.verifier.currentSecurityDecision).toHaveBeenCalledTimes(3);
    expect(value.quarantineActiveGeneration.mock.calls.map(([input]) => input.expectedRevision)).toEqual([31, 32, 33]);
  });

  it("returns the durable security receipt for an already quarantined exact generation without re-verifying or transitioning", async () => {
    const value = harness();
    value.inventoryRead.mockResolvedValue(inventory("quarantined", 18));
    value.readSecurityQuarantineReceipt.mockResolvedValue(receipt);

    await expect(value.reconcile(request())).resolves.toEqual({ status: "quarantined", receipt });
    expect(value.readSecurityQuarantineReceipt).toHaveBeenCalledWith({
      applicationId: "customer-alpha",
      environment: "production",
      extension: identity,
      generationId: generation.generationId
    });
    expect(value.verifier.currentSecurityDecision).not.toHaveBeenCalled();
    expect(value.quarantineActiveGeneration).not.toHaveBeenCalled();
  });

  it("treats a quarantined generation without its durable security receipt as not active", async () => {
    const value = harness();
    value.inventoryRead.mockResolvedValue(inventory("quarantined", 18));
    value.readSecurityQuarantineReceipt.mockResolvedValue(undefined);

    await expect(value.reconcile(request())).resolves.toEqual({ status: "not-active" });
    expect(value.verifier.currentSecurityDecision).not.toHaveBeenCalled();
    expect(value.quarantineActiveGeneration).not.toHaveBeenCalled();
  });

  it("returns clear for an active release with a current clear decision", async () => {
    const value = harness();
    value.inventoryRead.mockResolvedValue(inventory("active", 17));
    value.verifier.currentSecurityDecision.mockResolvedValue({ ...revokedDecision, disposition: "clear" });

    await expect(value.reconcile(request())).resolves.toEqual({ status: "clear" });
    expect(value.quarantineActiveGeneration).not.toHaveBeenCalled();
  });
});
