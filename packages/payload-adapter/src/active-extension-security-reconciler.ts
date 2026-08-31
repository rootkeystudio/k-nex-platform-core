import { ArtifactVerifier, type SignedCatalog } from "@k-nex/extension-bundler";
import type { ExtensionIdentity } from "@k-nex/contracts";
import type { ExtensionSecurityQuarantineReceipt, RuntimeExtensionStore } from "@k-nex/runtime";
import { RuntimeExtensionStoreError } from "./runtime-extension-store.js";

export interface ActiveExtensionSecurityReconcileRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: Extract<ExtensionIdentity, { deliveryClass: "hot-application" | "theme-skin" }>;
  readonly catalog: SignedCatalog;
}

export type ActiveExtensionSecurityReconcileResult =
  | Readonly<{ status: "not-active" | "clear" }>
  | Readonly<{ status: "quarantined"; receipt: ExtensionSecurityQuarantineReceipt }>;

/**
 * Current catalog policy is evaluated separately from immutable artifact reads.
 * A quarantine is a system security transition, never an operator disable.
 */
export class ActiveExtensionSecurityReconciler {
  constructor(
    private readonly verifier: ArtifactVerifier,
    private readonly store: Pick<RuntimeExtensionStore, "inventory" | "quarantineActiveGeneration" | "readSecurityQuarantineReceipt">
  ) {}

  async reconcile(input: ActiveExtensionSecurityReconcileRequest): Promise<ActiveExtensionSecurityReconcileResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const inventory = await this.store.inventory(input.applicationId, input.environment);
      const entries = input.extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
      const active = entries[input.extension.id];
      if (!active) return Object.freeze({ status: "not-active" });
      if (active.disposition === "quarantined") {
        if (!active.retainedGeneration) return Object.freeze({ status: "not-active" });
        const receipt = await this.store.readSecurityQuarantineReceipt({
          applicationId: input.applicationId,
          environment: input.environment,
          extension: input.extension,
          generationId: active.retainedGeneration.generationId
        });
        return receipt ? Object.freeze({ status: "quarantined", receipt }) : Object.freeze({ status: "not-active" });
      }
      if (active.disposition !== "active" || !active.activeGeneration) return Object.freeze({ status: "not-active" });
      const generation = active.activeGeneration;
      const decision = await this.verifier.currentSecurityDecision(input.catalog, {
        deliveryClass: generation.deliveryClass,
        id: generation.extensionId,
        version: generation.version,
        sourceCommit: generation.sourceCommit,
        artifactDigest: generation.artifactDigest,
        manifestDigest: generation.manifestDigest,
        provenanceDigest: generation.provenanceDigest,
        sbomDigest: generation.sbomDigest
      });
      const disposition = decision.disposition;
      if (disposition === "clear") return Object.freeze({ status: "clear" });
      const securityDecision = Object.freeze({ ...decision, disposition });
      try {
        const receipt = await this.store.quarantineActiveGeneration({
          applicationId: input.applicationId,
          environment: input.environment,
          extension: input.extension,
          expectedRevision: active.revision,
          generationId: generation.generationId,
          decision: securityDecision
        });
        return Object.freeze({ status: "quarantined", receipt });
      } catch (error) {
        if (!(error instanceof RuntimeExtensionStoreError) || !["REVISION_CONFLICT", "GENERATION_MISMATCH"].includes(error.code) || attempt === 2) throw error;
      }
    }
    throw new Error("Security reconciliation exhausted unexpectedly.");
  }
}
