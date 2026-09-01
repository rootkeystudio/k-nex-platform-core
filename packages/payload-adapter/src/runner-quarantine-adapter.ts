import type { RunnerQuarantineReason, RuntimeExtensionStore } from "@k-nex/runtime";

export interface RuntimeRunnerGenerationIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
}

/** Bridges runner failures to the revisioned runtime inventory; labels are never authority. */
export class RuntimeStoreRunnerQuarantineAdapter {
  constructor(private readonly store: Pick<RuntimeExtensionStore, "inventory" | "hasLiveGenerationLease" | "quarantineRunnerGeneration">) {}

  async active(identity: RuntimeRunnerGenerationIdentity): Promise<boolean> {
    const entry = (await this.store.inventory(identity.applicationId, identity.environment)).extensions.hotApplications[identity.appId];
    return entry?.disposition === "active" && entry.activeGeneration?.generationId === identity.generationId;
  }

  async admit(identity: RuntimeRunnerGenerationIdentity, drainLeaseId: string): Promise<boolean> {
    return this.store.hasLiveGenerationLease({
      applicationId: identity.applicationId,
      environment: identity.environment,
      extension: { deliveryClass: "hot-application", id: identity.appId },
      generationId: identity.generationId,
      leaseId: drainLeaseId
    });
  }

  async quarantine(identity: RuntimeRunnerGenerationIdentity, reason: RunnerQuarantineReason): Promise<void> {
    const entry = (await this.store.inventory(identity.applicationId, identity.environment)).extensions.hotApplications[identity.appId];
    if (entry?.disposition === "quarantined" && entry.retainedGeneration?.generationId === identity.generationId) return;
    if (entry?.disposition !== "active" || entry.activeGeneration?.generationId !== identity.generationId) {
      throw new Error("Runner failure no longer targets an authoritative active generation.");
    }
    await this.store.quarantineRunnerGeneration({
      applicationId: identity.applicationId,
      environment: identity.environment,
      appId: identity.appId,
      generationId: identity.generationId,
      expectedRevision: entry.revision,
      reason
    });
  }
}
