import { canonicalJson, type HotApplicationManifest, type ThemeSkinManifest } from "@k-nex/contracts";
import { randomUUID } from "node:crypto";

import type {
  DynamicArtifactPipeline,
  DynamicGenerationRuntime,
  ExtensionChangeRequest,
  GenerationReadinessLease,
  PluginManagerPlan,
  StagedGenerationActivation,
  VerifiedGenerationAuthority,
  VerifiedGenerationAuthorityOwner
} from "./plugin-manager.js";

export interface DurableDynamicArtifact {
  readonly authority: VerifiedGenerationAuthority;
  readonly version: string;
  /** Complete reverified Hot Application declaration; never inferred from an activation row. */
  readonly hotApplicationManifest?: HotApplicationManifest;
  readonly resourceBudget: HotApplicationManifest["resourceBudget"] | ThemeSkinManifest["resourceBudget"];
  readonly capabilities?: Readonly<HotApplicationManifest["capabilities"]>;
  readonly compatibility: StagedGenerationActivation["compatibility"];
  readonly metadata: StagedGenerationActivation["metadata"];
  readonly settings: StagedGenerationActivation["settings"];
  readonly storageSchemaVersions: StagedGenerationActivation["storageSchemaVersions"];
}

export interface DurableDynamicArtifactStore {
  resolve(input: Readonly<{ owner: VerifiedGenerationAuthorityOwner; generationId: string; artifactDigest: string }>): Promise<DurableDynamicArtifact | undefined>;
}

export interface DynamicGenerationWarmer {
  warm(input: Readonly<{
    request: ExtensionChangeRequest;
    plan: Exclude<PluginManagerPlan, { executionClass: "static-release" }>;
    artifact: DurableDynamicArtifact;
  }>): Promise<GenerationReadinessLease>;
}

export interface HotApplicationGenerationWarmupInput {
  readonly request: ExtensionChangeRequest;
  readonly plan: Extract<PluginManagerPlan, { executionClass: "live-generation" }>;
  readonly artifact: DurableDynamicArtifact;
  readonly manifest: HotApplicationManifest;
}

/**
 * Each preparation dependency owns an authority boundary. The warmer joins the
 * independently verified server, UI, storage, and fixed-host-surface checks
 * into the one readiness lease that activation persists atomically.
 */
export interface HotApplicationGenerationWarmupDependencies {
  readonly runner: Readonly<{ prepareServer(input: HotApplicationGenerationWarmupInput): Promise<void> }>;
  readonly remoteUi: Readonly<{ prepareRemoteUi(input: HotApplicationGenerationWarmupInput): Promise<void> }>;
  readonly storage: Readonly<{ prepareStorage(input: HotApplicationGenerationWarmupInput): Promise<void> }>;
  readonly surfaces: Readonly<{ prepareFixedSurfaces(input: HotApplicationGenerationWarmupInput): Promise<void> }>;
  readonly clock: Readonly<{ now(): Date }>;
  readonly leaseTtlMs?: number;
}

/** Concrete reference warmer for a Hot Application immutable generation. */
export class ReferenceHotApplicationGenerationWarmer implements DynamicGenerationWarmer {
  private readonly leaseTtlMs: number;

  constructor(private readonly dependencies: HotApplicationGenerationWarmupDependencies) {
    this.leaseTtlMs = dependencies.leaseTtlMs ?? 60_000;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs < 1_000 || this.leaseTtlMs > 300_000) {
      throw new TypeError("Hot Application readiness lease duration is invalid.");
    }
  }

  async warm(input: Parameters<DynamicGenerationWarmer["warm"]>[0]): Promise<GenerationReadinessLease> {
    const manifest = input.artifact.hotApplicationManifest;
    if (input.plan.plan.deliveryClass !== "hot-application" || input.plan.generationId !== input.artifact.authority.generationId ||
      input.plan.plan.targetGenerationId !== input.artifact.authority.generationId || input.request.extension.deliveryClass !== "hot-application" ||
      input.request.extension.id !== input.artifact.authority.extensionId || manifest?.deliveryClass !== "hot-application") {
      throw new Error("Hot Application warm-up identity does not match the immutable generation.");
    }
    const preparation: HotApplicationGenerationWarmupInput = Object.freeze({ ...input, manifest });
    await this.dependencies.runner.prepareServer(preparation);
    await this.dependencies.remoteUi.prepareRemoteUi(preparation);
    await this.dependencies.storage.prepareStorage(preparation);
    await this.dependencies.surfaces.prepareFixedSurfaces(preparation);
    const readyAt = this.dependencies.clock.now();
    if (!(readyAt instanceof Date) || Number.isNaN(readyAt.valueOf())) throw new Error("Hot Application warm-up clock is invalid.");
    const generationId = input.artifact.authority.generationId;
    return Object.freeze({
      generationId,
      serverGenerationId: generationId,
      uiGenerationId: generationId,
      storageGenerationId: generationId,
      leaseToken: `ready:${generationId}:${randomUUID()}`,
      readyAt: readyAt.toISOString(),
      expiresAt: new Date(readyAt.valueOf() + this.leaseTtlMs).toISOString()
    });
  }
}

export interface ThemeSkinGenerationWarmupInput {
  readonly request: ExtensionChangeRequest;
  readonly plan: Extract<PluginManagerPlan, { executionClass: "live-generation" }>;
  readonly artifact: DurableDynamicArtifact;
}

export interface ThemeSkinGenerationWarmupDependencies {
  /**
   * The resolver owns parsing and validating the signed declarative skin. The
   * generation runtime only records readiness after that boundary succeeds.
   */
  readonly skins: Readonly<{ prepareSkin(input: ThemeSkinGenerationWarmupInput): Promise<void> }>;
  readonly clock: Readonly<{ now(): Date }>;
  readonly leaseTtlMs?: number;
}

/** Concrete readiness warmer for data-only Theme Skin generations. */
export class ReferenceThemeSkinGenerationWarmer implements DynamicGenerationWarmer {
  private readonly leaseTtlMs: number;

  constructor(private readonly dependencies: ThemeSkinGenerationWarmupDependencies) {
    this.leaseTtlMs = dependencies.leaseTtlMs ?? 60_000;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs < 1_000 || this.leaseTtlMs > 300_000) {
      throw new TypeError("Theme Skin readiness lease duration is invalid.");
    }
  }

  async warm(input: Parameters<DynamicGenerationWarmer["warm"]>[0]): Promise<GenerationReadinessLease> {
    if (input.plan.plan.deliveryClass !== "theme-skin" || input.artifact.authority.deliveryClass !== "theme-skin" || input.plan.generationId !== input.artifact.authority.generationId ||
      input.plan.plan.targetGenerationId !== input.artifact.authority.generationId || input.request.extension.deliveryClass !== "theme-skin" ||
      input.request.extension.id !== input.artifact.authority.extensionId) {
      throw new Error("Theme Skin warm-up identity does not match the immutable generation.");
    }
    await this.dependencies.skins.prepareSkin(Object.freeze(input));
    const readyAt = this.dependencies.clock.now();
    if (!(readyAt instanceof Date) || Number.isNaN(readyAt.valueOf())) throw new Error("Theme Skin warm-up clock is invalid.");
    const generationId = input.artifact.authority.generationId;
    return Object.freeze({
      generationId,
      serverGenerationId: generationId,
      uiGenerationId: generationId,
      storageGenerationId: generationId,
      leaseToken: `ready:${generationId}:${randomUUID()}`,
      readyAt: readyAt.toISOString(),
      expiresAt: new Date(readyAt.valueOf() + this.leaseTtlMs).toISOString()
    });
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function matchesPlanDeclarations(plan: Exclude<PluginManagerPlan, { executionClass: "static-release" }>["plan"], artifact: DurableDynamicArtifact): boolean {
  if (plan.deliveryClass === "theme-skin") return same(plan.resourceBudget, artifact.resourceBudget);
  const manifest = artifact.hotApplicationManifest;
  return manifest?.deliveryClass === "hot-application" && same(plan.resourceBudget, manifest.resourceBudget) && same(plan.requiredCapabilities, manifest.capabilities);
}

function requireArtifact(
  artifact: DurableDynamicArtifact | undefined,
  owner: VerifiedGenerationAuthorityOwner,
  generationId: string,
  artifactDigest: string
): DurableDynamicArtifact {
  if (!artifact || !same(artifact.authority, {
    ...owner,
    generationId,
    artifactDigest,
    sourceCommit: artifact.authority.sourceCommit,
    manifestDigest: artifact.authority.manifestDigest,
    catalogDigest: artifact.authority.catalogDigest,
    provenanceDigest: artifact.authority.provenanceDigest,
    sbomDigest: artifact.authority.sbomDigest
  })) {
    throw new Error("Verified durable artifact is unavailable or belongs to another generation.");
  }
  return artifact;
}

/** Binds a live-generation operation to one immutable artifact record. */
export class DurableDynamicArtifactPipeline implements DynamicArtifactPipeline {
  constructor(private readonly artifacts: DurableDynamicArtifactStore) {}

  async stage(input: Parameters<DynamicArtifactPipeline["stage"]>[0]): Promise<VerifiedGenerationAuthority> {
    const generationId = input.plan.targetGenerationId;
    if (!generationId) throw new Error("Live generation plan has no target generation identity.");
    const artifact = requireArtifact(
      await this.artifacts.resolve({ owner: input.owner, generationId, artifactDigest: input.plan.artifactDigest }),
      input.owner,
      generationId,
      input.plan.artifactDigest
    );
    if (artifact.version !== input.plan.version || !matchesPlanDeclarations(input.plan, artifact)) {
      throw new Error("Verified durable artifact declarations differ from the approved plan.");
    }
    return artifact.authority;
  }

  async reverify(authority: VerifiedGenerationAuthority, owner: VerifiedGenerationAuthorityOwner): Promise<boolean> {
    const artifact = await this.artifacts.resolve({ owner, generationId: authority.generationId, artifactDigest: authority.artifactDigest });
    return artifact !== undefined && same(artifact.authority, authority);
  }
}

/** Prepares only the verified durable artifact that the operation already staged. */
export class DurableDynamicGenerationRuntime implements DynamicGenerationRuntime {
  constructor(private readonly artifacts: DurableDynamicArtifactStore, private readonly warmer: DynamicGenerationWarmer) {}

  async prepare(input: Parameters<DynamicGenerationRuntime["prepare"]>[0]): Promise<StagedGenerationActivation> {
    const owner: VerifiedGenerationAuthorityOwner = {
      applicationId: input.authority.applicationId,
      environment: input.authority.environment,
      deliveryClass: input.authority.deliveryClass,
      extensionId: input.authority.extensionId
    };
    const artifact = requireArtifact(
      await this.artifacts.resolve({ owner, generationId: input.authority.generationId, artifactDigest: input.authority.artifactDigest }),
      owner,
      input.authority.generationId,
      input.authority.artifactDigest
    );
    if (!same(artifact.authority, input.authority) || artifact.version !== input.plan.plan.version || !matchesPlanDeclarations(input.plan.plan, artifact)) {
      throw new Error("Prepared artifact no longer matches the verified operation authority.");
    }
    const readiness = await this.warmer.warm({ request: input.request, plan: input.plan, artifact });
    return Object.freeze({
      authority: artifact.authority,
      version: artifact.version,
      readiness,
      compatibility: artifact.compatibility,
      metadata: artifact.metadata,
      settings: artifact.settings,
      storageSchemaVersions: artifact.storageSchemaVersions
    });
  }
}
