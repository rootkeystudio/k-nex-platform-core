import { ArtifactVerifier, type SignedCatalog } from "@k-nex/extension-bundler";
import type { ExtensionIdentity } from "@k-nex/contracts";
import type { ExtensionSecurityQuarantineReceipt, RuntimeExtensionStore } from "@k-nex/runtime";

export interface ActiveExtensionSecurityReconcileRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: Extract<ExtensionIdentity, { deliveryClass: "hot-application" | "theme-skin" }>;
  readonly expectedRevision: number;
  readonly catalog: SignedCatalog;
}

export type ActiveExtensionSecurityReconcileResult =
  | Readonly<{ status: "not-active" | "no-matching-release" | "clear" }>
  | Readonly<{ status: "quarantined"; receipt: ExtensionSecurityQuarantineReceipt }>;

/**
 * Current catalog policy is evaluated separately from immutable artifact reads.
 * A quarantine is a system security transition, never an operator disable.
 */
export class ActiveExtensionSecurityReconciler {
  constructor(
    private readonly verifier: ArtifactVerifier,
    private readonly store: Pick<RuntimeExtensionStore, "inventory" | "quarantineActiveGeneration">
  ) {}

  async reconcile(input: ActiveExtensionSecurityReconcileRequest): Promise<ActiveExtensionSecurityReconcileResult> {
    const inventory = await this.store.inventory(input.applicationId, input.environment);
    const entries = input.extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
    const active = entries[input.extension.id];
    if (!active || (active.disposition !== "active" && active.disposition !== "quarantined")) return Object.freeze({ status: "not-active" });
    const generation = active.disposition === "active" ? active.activeGeneration : active.retainedGeneration;
    if (!generation) return Object.freeze({ status: "not-active" });
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
    if (!decision) return Object.freeze({ status: "no-matching-release" });
    if (decision.disposition === "clear") {
      if (active.disposition === "quarantined") throw new Error("A new catalog decision conflicts with the frozen security quarantine receipt.");
      return Object.freeze({ status: "clear" });
    }
    const securityDecision = Object.freeze({ ...decision, disposition: decision.disposition as "revoked" | "compromised" | "unsupported" });
    const receipt = await this.store.quarantineActiveGeneration({
      applicationId: input.applicationId,
      environment: input.environment,
      extension: input.extension,
      expectedRevision: input.expectedRevision,
      generationId: generation.generationId,
      decision: securityDecision
    });
    return Object.freeze({ status: "quarantined", receipt });
  }
}
