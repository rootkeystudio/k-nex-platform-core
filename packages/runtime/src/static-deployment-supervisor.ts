import type {
  MigrationCompatibilityPlan,
  StaticDeploymentReceipt,
  TrustedApplicationBuildEvidence,
  WorkerGenerationFence
} from "@k-nex/contracts";

import type { VerifiedStaticApplicationBuild } from "./static-composition-authority.js";
import type { StaticCompositionChangeResult } from "./plugin-manager.js";

export class StaticDeploymentSupervisorError extends Error {
  constructor(readonly code: "ARTIFACT_MISMATCH" | "READINESS_REJECTED" | "STATE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "StaticDeploymentSupervisorError";
  }
}

export interface StaticApplicationGeneration {
  readonly generationId: string;
  readonly sourceCommit: string;
  readonly compositionChangePlanDigest: string;
  readonly buildEvidenceDigest: string;
  readonly applicationDigest: string;
  readonly imageDigest: string;
  readonly imageReference: string;
  readonly migrationRevision: number;
}

export interface StaticDeploymentSnapshot {
  readonly applicationId: string;
  readonly environment: string;
  readonly revision: number;
  readonly active: StaticApplicationGeneration;
  readonly rollback?: StaticApplicationGeneration;
  readonly rollbackWindow: Readonly<Record<string, unknown>>;
  readonly stateDigest: string;
}

export interface StaticPromotionReadiness {
  readonly generationId: string;
  readonly sourceCommit: string;
  readonly applicationDigest: string;
  readonly imageDigest: string;
  readonly migrationRevision: number;
  readonly completedMigrationSteps: readonly string[];
  readonly publicSmoke: true;
  readonly authenticatedSmoke: true;
  readonly inventoryReconciled: true;
  readonly workerMode: "passive";
  readonly gatewayCapacity: true;
  readonly realtimeReady: true;
  readonly observedAt: string;
}

export interface VerifiedStaticBuildReader {
  read(token: VerifiedStaticApplicationBuild): Readonly<{
    change: StaticCompositionChangeResult;
    evidence: TrustedApplicationBuildEvidence;
    evidenceDigest: string;
  }>;
}

export interface StaticApplicationArtifactProvider {
  resolve(evidence: TrustedApplicationBuildEvidence): Promise<Readonly<{
    imageReference: string;
    applicationDigest: string;
    imageDigest: string;
    runtimeImageDigest: string;
  }>>;
  reverify(generation: StaticApplicationGeneration): Promise<Readonly<{
    imageReference: string;
    applicationDigest: string;
    imageDigest: string;
    runtimeImageDigest: string;
  }>>;
}

export interface StaticMigrationExecutor {
  runOnline(plan: MigrationCompatibilityPlan["plan"]): Promise<readonly string[]>;
  runPostRetirement(plan: MigrationCompatibilityPlan["plan"]): Promise<readonly string[]>;
}

export interface StaticGenerationHost {
  start(input: Readonly<{
    applicationId: string;
    environment: string;
    generationId: string;
    imageReference: string;
    workerMode: "passive";
  }>): Promise<void>;
  readiness(input: Readonly<{
    applicationId: string;
    environment: string;
    generationId: string;
    sourceCommit: string;
    applicationDigest: string;
    imageDigest: string;
    migrationRevision: number;
    completedMigrationSteps: readonly string[];
  }>): Promise<StaticPromotionReadiness>;
  activateWorker(generationId: string, fence: WorkerGenerationFence): Promise<void>;
  drain(generationId: string): Promise<void>;
  retire(generationId: string): Promise<void>;
}

export interface GatewayTrafficRouter {
  converge(input: Readonly<{ applicationId: string; environment: string; generationId: string; revision: number }>): Promise<void>;
}

export interface StaticRealtimeConvergence {
  reconnectAndResync(input: Readonly<{ applicationId: string; environment: string; previousGenerationId: string; activeGenerationId: string }>): Promise<void>;
}

interface Owner { readonly applicationId: string; readonly environment: string; }

export interface StaticDeploymentState {
  read(owner: Owner): Promise<StaticDeploymentSnapshot | undefined>;
  readFence(owner: Owner): Promise<WorkerGenerationFence | undefined>;
  promote(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    generationId: string;
    workerOwner: string;
    workerLeaseExpiresAt: string;
    build: VerifiedStaticApplicationBuild;
    readiness: StaticPromotionReadiness;
  }>): Promise<StaticDeploymentReceipt>;
  rollback(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    workerOwner: string;
    workerLeaseExpiresAt: string;
  }>): Promise<StaticDeploymentReceipt>;
  closeRollback(input: Owner & Readonly<{ expectedRevision: number; retiredGenerationId: string }>): Promise<StaticDeploymentReceipt>;
  assertContractCleanup(owner: Owner): Promise<void>;
}

export type StaticDeploymentOutcome =
  | Readonly<{ outcome: "promoted"; receipt: StaticDeploymentReceipt }>
  | Readonly<{ outcome: "maintenance-required"; reasons: readonly ["offline-migration"] }>;

function ensureArtifact(
  value: Awaited<ReturnType<StaticApplicationArtifactProvider["resolve"]>>,
  evidence: TrustedApplicationBuildEvidence
): void {
  const expectedReference = `${evidence.imageSubject.repository}@${evidence.imageSubject.digest}`;
  if (value.imageReference !== expectedReference || value.applicationDigest !== evidence.applicationSubject.digest || value.imageDigest !== evidence.imageSubject.digest) {
    throw new StaticDeploymentSupervisorError("ARTIFACT_MISMATCH", "Artifact provider did not resolve the attested immutable application and image.");
  }
}

function ensureRetainedArtifact(
  value: Awaited<ReturnType<StaticApplicationArtifactProvider["reverify"]>>,
  generation: StaticApplicationGeneration
): void {
  if (value.imageReference !== generation.imageReference || value.applicationDigest !== generation.applicationDigest || value.imageDigest !== generation.imageDigest || value.runtimeImageDigest !== generation.imageDigest) {
    throw new StaticDeploymentSupervisorError("ARTIFACT_MISMATCH", "Retained artifact does not match the owner-bound immutable generation.");
  }
}

function ensureReadiness(readiness: StaticPromotionReadiness, generation: StaticApplicationGeneration): void {
  if (readiness.generationId !== generation.generationId || readiness.sourceCommit !== generation.sourceCommit ||
    readiness.applicationDigest !== generation.applicationDigest || readiness.imageDigest !== generation.imageDigest ||
    readiness.migrationRevision !== generation.migrationRevision || readiness.publicSmoke !== true || readiness.authenticatedSmoke !== true ||
    readiness.inventoryReconciled !== true || readiness.workerMode !== "passive" || readiness.gatewayCapacity !== true || readiness.realtimeReady !== true ||
    !Number.isFinite(Date.parse(readiness.observedAt))) {
    throw new StaticDeploymentSupervisorError("READINESS_REJECTED", "Generation readiness does not prove the exact passive immutable target.");
  }
}

export class DeploymentSupervisor {
  constructor(
    private readonly builds: VerifiedStaticBuildReader,
    private readonly artifacts: StaticApplicationArtifactProvider,
    private readonly migrations: StaticMigrationExecutor,
    private readonly generations: StaticGenerationHost,
    private readonly state: StaticDeploymentState,
    private readonly gateway: GatewayTrafficRouter,
    private readonly realtime: StaticRealtimeConvergence
  ) {}

  async deploy(input: Readonly<{
    build: VerifiedStaticApplicationBuild;
    generationId: string;
    workerOwner: string;
    workerLeaseExpiresAt: string;
  }>): Promise<StaticDeploymentOutcome> {
    const verified = this.builds.read(input.build);
    const change = verified.change.change;
    if (change.migration.steps.some((step) => step.phase === "offline-required")) {
      return Object.freeze({ outcome: "maintenance-required", reasons: ["offline-migration"] as const });
    }
    const owner = { applicationId: change.applicationId, environment: change.environment };
    const before = await this.requireState(owner);
    const fence = await this.requireFence(owner);
    const artifact = await this.artifacts.resolve(verified.evidence);
    ensureArtifact(artifact, verified.evidence);
    const completedMigrationSteps = await this.migrations.runOnline(change.migration);
    let readiness: StaticPromotionReadiness;
    try {
      if (artifact.runtimeImageDigest !== artifact.imageDigest) throw new StaticDeploymentSupervisorError("ARTIFACT_MISMATCH", "Artifact provider did not resolve the attested image bytes.");
      await this.generations.start({ ...owner, generationId: input.generationId, imageReference: artifact.imageReference, workerMode: "passive" });
      readiness = await this.generations.readiness({
        ...owner,
        generationId: input.generationId,
        sourceCommit: change.target.sourceCommit,
        applicationDigest: artifact.applicationDigest,
        imageDigest: artifact.imageDigest,
        migrationRevision: change.migration.targetRevision,
        completedMigrationSteps
      });
      ensureReadiness(readiness, {
        generationId: input.generationId,
        sourceCommit: change.target.sourceCommit,
        compositionChangePlanDigest: verified.change.planDigest,
        buildEvidenceDigest: verified.evidenceDigest,
        applicationDigest: artifact.applicationDigest,
        imageDigest: artifact.imageDigest,
        imageReference: artifact.imageReference,
        migrationRevision: change.migration.targetRevision
      });
    } catch (error) {
      try { await this.generations.retire(input.generationId); } catch { /* preserve readiness failure */ }
      throw error;
    }
    const receipt = await this.state.promote({
      ...owner,
      expectedRevision: before.revision,
      expectedFenceToken: fence.fencingToken,
      generationId: input.generationId,
      workerOwner: input.workerOwner,
      workerLeaseExpiresAt: input.workerLeaseExpiresAt,
      build: input.build,
      readiness
    });
    const promotedFence = await this.requireFence(owner);
    await this.generations.activateWorker(input.generationId, promotedFence);
    await this.gateway.converge({ ...owner, generationId: input.generationId, revision: receipt.revisionAfter });
    await this.realtime.reconnectAndResync({ ...owner, previousGenerationId: before.active.generationId, activeGenerationId: input.generationId });
    await this.generations.drain(before.active.generationId);
    return Object.freeze({ outcome: "promoted", receipt });
  }

  async rollback(input: Owner & Readonly<{ workerOwner: string; workerLeaseExpiresAt: string }>): Promise<StaticDeploymentReceipt> {
    const owner = { applicationId: input.applicationId, environment: input.environment };
    const before = await this.requireState(owner);
    const fence = await this.requireFence(owner);
    if (!before.rollback) throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "No retained generation is available for rollback.");
    const retained = before.rollback;
    const artifact = await this.artifacts.reverify(retained);
    ensureRetainedArtifact(artifact, retained);
    let readiness: StaticPromotionReadiness;
    try {
      await this.generations.start({ ...owner, generationId: retained.generationId, imageReference: artifact.imageReference, workerMode: "passive" });
      readiness = await this.generations.readiness({
        ...owner,
        generationId: retained.generationId,
        sourceCommit: retained.sourceCommit,
        applicationDigest: retained.applicationDigest,
        imageDigest: retained.imageDigest,
        migrationRevision: retained.migrationRevision,
        completedMigrationSteps: []
      });
      ensureReadiness(readiness, retained);
    } catch (error) {
      try { await this.generations.retire(retained.generationId); } catch { /* preserve retained readiness failure */ }
      throw error;
    }
    const receipt = await this.state.rollback({
      ...owner,
      expectedRevision: before.revision,
      expectedFenceToken: fence.fencingToken,
      workerOwner: input.workerOwner,
      workerLeaseExpiresAt: input.workerLeaseExpiresAt
    });
    const rolledBackFence = await this.requireFence(owner);
    await this.generations.activateWorker(retained.generationId, rolledBackFence);
    await this.gateway.converge({ ...owner, generationId: retained.generationId, revision: receipt.revisionAfter });
    await this.realtime.reconnectAndResync({ ...owner, previousGenerationId: before.active.generationId, activeGenerationId: retained.generationId });
    await this.generations.drain(before.active.generationId);
    return receipt;
  }

  async recover(owner: Owner): Promise<void> {
    const current = await this.requireState(owner);
    const fence = await this.requireFence(owner);
    await this.generations.activateWorker(current.active.generationId, fence);
    await this.gateway.converge({ ...owner, generationId: current.active.generationId, revision: current.revision });
  }

  async closeRollback(owner: Owner): Promise<StaticDeploymentReceipt> {
    const current = await this.requireState(owner);
    if (!current.rollback) throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "No retained generation is available to retire.");
    await this.generations.drain(current.rollback.generationId);
    await this.generations.retire(current.rollback.generationId);
    return this.state.closeRollback({ ...owner, expectedRevision: current.revision, retiredGenerationId: current.rollback.generationId });
  }

  async runContractCleanup(owner: Owner, plan: MigrationCompatibilityPlan["plan"]): Promise<readonly string[]> {
    const current = await this.requireState(owner);
    if (plan.applicationId !== owner.applicationId || plan.environment !== owner.environment || plan.targetSourceCommit !== current.active.sourceCommit || plan.targetRevision !== current.active.migrationRevision) {
      throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Contract cleanup plan does not match the active source and migration revision.");
    }
    await this.state.assertContractCleanup(owner);
    return this.migrations.runPostRetirement(plan);
  }

  private async requireState(owner: Owner): Promise<StaticDeploymentSnapshot> {
    const value = await this.state.read(owner);
    if (!value) throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Static deployment state is unavailable.");
    return value;
  }

  private async requireFence(owner: Owner): Promise<WorkerGenerationFence> {
    const value = await this.state.readFence(owner);
    if (!value) throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Static worker fence is unavailable.");
    return value;
  }
}
