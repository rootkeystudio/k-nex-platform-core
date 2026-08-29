import { canonicalJson } from "@k-nex/contracts";

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

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
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
    if (artifact.version !== input.plan.version) throw new Error("Verified durable artifact version differs from the plan.");
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
    if (!same(artifact.authority, input.authority) || artifact.version !== input.plan.plan.version) {
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
