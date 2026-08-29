import {
  RunnerIsolationProfileSchema,
  type HotApplicationManifest,
  type RunnerIsolationProfile
} from "@k-nex/contracts";
import { randomUUID } from "node:crypto";

import type { ExtensionActorIdentity, ExtensionCapabilityTokenRequest, HmacExtensionCapabilityTokens } from "./extension-capability-gateway.js";
import type { DurableDynamicArtifact, DurableDynamicArtifactStore } from "./dynamic-generation-runtime.js";
import type { RuntimeExtensionStore } from "./plugin-manager.js";

type ProductionRunnerIsolationProfile = Extract<RunnerIsolationProfile, { scope: "production" }>;
type ActiveGeneration = NonNullable<ReturnType<AuthoritativeHotApplicationRuntime["active"]>>;
type HotApplicationArtifact = DurableDynamicArtifact & Readonly<{ hotApplicationManifest: HotApplicationManifest }>;

function isHotApplicationArtifact(artifact: DurableDynamicArtifact): artifact is HotApplicationArtifact {
  return artifact.authority.deliveryClass === "hot-application" && artifact.hotApplicationManifest?.deliveryClass === "hot-application";
}

export interface HotApplicationServerInvocation {
  readonly owner: Readonly<{ applicationId: string; environment: string; deliveryClass: "hot-application"; extensionId: string }>;
  readonly generationId: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly serverEntrypoint: string;
  readonly invocationId: string;
  readonly token: string;
  readonly input: unknown;
  readonly limits: Readonly<{
    cpuMilliCores: number;
    memoryMiB: number;
    processes: number;
    openFiles: number;
    tempBytes: number;
    wallTimeMs: number;
    inputBytes: number;
    outputBytes: number;
    logBytes: number;
    maxConcurrency: number;
  }>;
  readonly signal?: AbortSignal;
}

export interface HotApplicationServerRunner {
  invoke(input: HotApplicationServerInvocation): Promise<unknown>;
}

export interface HotApplicationTrafficRequest {
  readonly input: unknown;
  readonly actor: ExtensionActorIdentity;
  readonly correlationId: string;
  readonly signal?: AbortSignal;
}

/** Binds traffic to one reverified immutable Hot Application generation. */
export class AuthoritativeHotApplicationRuntime {
  private readonly profile: ProductionRunnerIsolationProfile;

  constructor(
    private readonly store: Pick<RuntimeExtensionStore, "inventory" | "acquireGenerationLease" | "releaseGenerationLease">,
    private readonly artifacts: DurableDynamicArtifactStore,
    private readonly tokens: Pick<HmacExtensionCapabilityTokens, "issue">,
    private readonly runner: HotApplicationServerRunner,
    private readonly identity: Readonly<{ applicationId: string; environment: string; appId: string }>,
    profile: RunnerIsolationProfile,
    private readonly holder: string = "hot-application-traffic",
  ) {
    const parsed = RunnerIsolationProfileSchema.safeParse(profile);
    if (!parsed.success || parsed.data.scope !== "production" ||
      !/^[a-z][a-z0-9-]{2,127}$/u.test(identity.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(identity.environment) ||
      !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(identity.appId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(holder)) {
      throw new TypeError("Hot Application traffic runtime identity or production isolation profile is invalid.");
    }
    this.profile = parsed.data;
  }

  async invoke(request: HotApplicationTrafficRequest): Promise<unknown> {
    const extension = { deliveryClass: "hot-application" as const, id: this.identity.appId };
    const owner = { applicationId: this.identity.applicationId, environment: this.identity.environment, deliveryClass: "hot-application" as const, extensionId: this.identity.appId };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const active = this.active(await this.store.inventory(this.identity.applicationId, this.identity.environment));
      if (!active) throw new Error("Hot Application has no authoritative active generation.");
      const artifact = await this.artifacts.resolve({ owner, generationId: active.generationId, artifactDigest: active.artifactDigest });
      if (!artifact || !this.matches(active, artifact) || !isHotApplicationArtifact(artifact)) {
        throw new Error("The authoritative generation has no matching verified Hot Application bytes.");
      }
      const ttlMs = Math.min(300_000, artifact.hotApplicationManifest.resourceBudget.maxWallTimeMs + 1_000);
      let leaseId: string;
      try {
        leaseId = await this.store.acquireGenerationLease({
          applicationId: this.identity.applicationId,
          environment: this.identity.environment,
          extension,
          generationId: active.generationId,
          holder: this.holder,
          ttlMs
        });
      } catch (error) {
        let current: ActiveGeneration | undefined;
        try {
          current = this.active(await this.store.inventory(this.identity.applicationId, this.identity.environment));
        } catch {
          throw error;
        }
        if (current?.generationId === active.generationId || attempt === 1) throw error;
        continue;
      }
      try {
        const invocationId = `invocation-${randomUUID()}`;
        const token = this.tokens.issue({
          tokenId: `token-${randomUUID()}`,
          applicationId: this.identity.applicationId,
          environment: this.identity.environment,
          appId: this.identity.appId,
          generationId: active.generationId,
          invocationId,
          actor: request.actor,
          correlationId: request.correlationId,
          drainLeaseId: leaseId,
          grants: artifact.hotApplicationManifest.capabilities,
          ttlMs
        } satisfies ExtensionCapabilityTokenRequest);
        const budget = artifact.hotApplicationManifest.resourceBudget;
        const serverEntrypoint = artifact.hotApplicationManifest.entrypoints.server[0];
        if (!serverEntrypoint) throw new Error("Verified Hot Application manifest declares no server entrypoint.");
        return await this.runner.invoke({
          owner,
          generationId: active.generationId,
          artifactDigest: active.artifactDigest as `sha256:${string}`,
          serverEntrypoint,
          invocationId,
          token,
          input: request.input,
          limits: {
            cpuMilliCores: Math.min(budget.maxCpuMilliCores, this.profile.limits.cpuMilliCores),
            memoryMiB: Math.min(budget.maxMemoryMiB, this.profile.limits.memoryMiB),
            processes: this.profile.limits.processes,
            openFiles: this.profile.limits.openFiles,
            tempBytes: this.profile.limits.tempBytes,
            wallTimeMs: budget.maxWallTimeMs,
            inputBytes: budget.maxInputBytes,
            outputBytes: budget.maxOutputBytes,
            logBytes: budget.maxLogBytes,
            maxConcurrency: budget.maxConcurrency
          },
          ...(request.signal ? { signal: request.signal } : {})
        });
      } finally {
        await this.store.releaseGenerationLease(leaseId);
      }
    }
    throw new Error("Hot Application active generation changed before an invocation lease could be acquired.");
  }

  private active(inventory: Awaited<ReturnType<RuntimeExtensionStore["inventory"]>>) {
    const entry = inventory.extensions.hotApplications[this.identity.appId];
    return entry?.disposition === "active" ? entry.activeGeneration : undefined;
  }

  private matches(active: ActiveGeneration, artifact: DurableDynamicArtifact): boolean {
    const authority = artifact.authority;
    return authority.deliveryClass === "hot-application" && authority.applicationId === this.identity.applicationId && authority.environment === this.identity.environment &&
      authority.extensionId === this.identity.appId && authority.generationId === active.generationId && authority.sourceCommit === active.sourceCommit &&
      authority.artifactDigest === active.artifactDigest && authority.manifestDigest === active.manifestDigest && authority.catalogDigest === active.catalogDigest &&
      authority.provenanceDigest === active.provenanceDigest && authority.sbomDigest === active.sbomDigest;
  }
}
