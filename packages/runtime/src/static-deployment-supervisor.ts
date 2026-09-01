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

/** Boundary proof that an external transition effect was never dispatched. */
export class StaticDeploymentEffectNotDispatchedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaticDeploymentEffectNotDispatchedError";
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
  readonly transitionCheckpoint?: StaticDeploymentTransitionCheckpoint;
  readonly stateDigest: string;
}

export type StaticDeploymentTransitionStep = "activate-worker" | "converge-gateway" | "reconnect-realtime" | "drain-previous" | "drain-retained" | "retire-retained";

export interface StaticDeploymentTransitionCheckpoint {
  readonly kind: "promote" | "rollback" | "retire-rollback" | "promote-retire-previous";
  readonly revision: number;
  readonly activeGenerationId: string;
  readonly previousGenerationId: string;
  readonly completedSteps: readonly StaticDeploymentTransitionStep[];
  /** A durably claimed external step; conflicting pointer changes must wait for it. */
  readonly reservedStep?: StaticDeploymentTransitionStep;
  readonly reservationId?: string;
  readonly reservationExpiresAt?: string;
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

export interface StaticDeploymentLifecycleAdmission {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly extensionId: string;
  readonly quarantineRecovery: boolean;
}

export interface StaticGenerationIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly generationId: string;
}

export interface StaticGenerationRetirementReservation extends StaticGenerationIdentity {
  readonly reservationId: string;
  readonly reservedAt: string;
  readonly completedAt?: string;
}

export interface StaticDeploymentTransitionTicket extends StaticGenerationIdentity {
  readonly activeGenerationId: string;
  readonly revision: number;
  readonly fencingToken: number;
  readonly promotionRevision: number;
  readonly leaseOwner: string;
  readonly checkpointKind: StaticDeploymentTransitionCheckpoint["kind"];
  readonly step: StaticDeploymentTransitionStep;
  readonly reservationId: string;
  readonly reservationExpiresAt: string;
}

/** One-shot authority for recovering the already-active release worker. */
export interface StaticWorkerRecoveryActivationTicket extends StaticGenerationIdentity {
  readonly revision: number;
  readonly fencingToken: number;
  readonly promotionRevision: number;
  readonly leaseOwner: string;
  readonly executionLeaseDurationMs: number;
  readonly recoveryId: string;
  readonly recoveryExpiresAt: string;
}

export interface StaticWorkerRecoveryProbe extends StaticGenerationIdentity {
  readonly sourceCommit: string;
  readonly applicationDigest: string;
  readonly imageDigest: string;
  readonly imageReference: string;
  readonly fencingToken: number;
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
  /** Verify ticket immediately before worker mode changes. */
  activateWorker(ticket: StaticDeploymentTransitionTicket): Promise<void>;
  /** A healthy exact worker avoids an unnecessary recovery-fence epoch. */
  hasHealthyActiveWorker(probe: StaticWorkerRecoveryProbe): Promise<boolean>;
  /** Verify recovery authority immediately before recreating or activating the settled worker. */
  recoverActiveWorker(ticket: StaticWorkerRecoveryActivationTicket): Promise<void>;
  /** Verify ticket immediately before draining work. */
  drain(ticket: StaticDeploymentTransitionTicket): Promise<void>;
  /** Verify reservation, then ticket when present, immediately before destruction. */
  retire(input: Readonly<{ reservation: StaticGenerationRetirementReservation; ticket?: StaticDeploymentTransitionTicket }>): Promise<void>;
}

export interface GatewayTrafficRouter {
  /** Verify ticket immediately before routing state changes. */
  converge(ticket: StaticDeploymentTransitionTicket): Promise<void>;
}

export interface StaticRealtimeConvergence {
  /** Verify ticket immediately before reconnect/resync state changes. */
  reconnectAndResync(ticket: StaticDeploymentTransitionTicket): Promise<void>;
}

interface Owner { readonly applicationId: string; readonly environment: string; }

export interface StaticDeploymentState {
  read(owner: Owner): Promise<StaticDeploymentSnapshot | undefined>;
  readFence(owner: Owner): Promise<WorkerGenerationFence | undefined>;
  isWorkerFenceLive(owner: Owner, expected: WorkerGenerationFence): Promise<boolean>;
  promote(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    generationId: string;
    workerOwner: string;
    workerLeaseExpiresAt: string;
    build: VerifiedStaticApplicationBuild;
    readiness: StaticPromotionReadiness;
    lifecycleAdmission: StaticDeploymentLifecycleAdmission;
  }>): Promise<StaticDeploymentReceipt>;
  rollback(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    workerOwner: string;
    workerLeaseExpiresAt: string;
  }>): Promise<StaticDeploymentReceipt>;
  reserveRollbackRetirement(input: Owner & Readonly<{ expectedRevision: number; retiredGenerationId: string }>): Promise<StaticGenerationRetirementReservation>;
  reserveGenerationRetirement(input: StaticGenerationIdentity): Promise<StaticGenerationRetirementReservation | undefined>;
  readGenerationRetirement(input: StaticGenerationIdentity): Promise<StaticGenerationRetirementReservation | undefined>;
  listPendingGenerationRetirements(input: Owner & Readonly<{ limit: number }>): Promise<readonly StaticGenerationRetirementReservation[]>;
  completeGenerationRetirement(input: StaticGenerationRetirementReservation): Promise<void>;
  closeRollback(input: Owner & Readonly<{ expectedRevision: number; retiredGenerationId: string }>): Promise<StaticDeploymentReceipt>;
  reserveTransitionStep(input: Owner & Readonly<{ expectedRevision: number; step: StaticDeploymentTransitionStep; reservationId: string }>): Promise<StaticDeploymentTransitionTicket>;
  releaseTransitionStep(input: StaticDeploymentTransitionTicket): Promise<void>;
  completeTransitionStep(input: StaticDeploymentTransitionTicket): Promise<void>;
  assertTransitionTicket(input: StaticDeploymentTransitionTicket, retirement?: StaticGenerationRetirementReservation): Promise<void>;
  reserveWorkerRecoveryActivation(input: Owner & Readonly<{ expectedRevision: number; expectedFencingToken: number; expectedPromotionRevision: number; generationId: string; executionLeaseDurationMs: number; initialActivation?: boolean }>): Promise<StaticWorkerRecoveryActivationTicket>;
  readWorkerRecoveryActivation(owner: Owner): Promise<StaticWorkerRecoveryActivationTicket | undefined>;
  expireWorkerRecoveryActivation(owner: Owner): Promise<boolean>;
  completeWorkerRecoveryActivation(input: StaticWorkerRecoveryActivationTicket): Promise<void>;
  assertWorkerRecoveryActivation(input: StaticWorkerRecoveryActivationTicket): Promise<void>;
  assertContractCleanup(owner: Owner): Promise<void>;
}

export type StaticDeploymentOutcome =
  | Readonly<{ outcome: "promoted"; receipt: StaticDeploymentReceipt }>
  | Readonly<{ outcome: "maintenance-required"; reasons: readonly ["offline-migration"] }>;

export interface StaticDeploymentClock {
  now(): Date;
}

export interface StaticDeploymentWaiter {
  wait(milliseconds: number): Promise<void>;
}

export function hasLiveStaticPromotionRollbackWindow(
  active: Pick<StaticApplicationGeneration, "applicationDigest">,
  rollbackWindow: MigrationCompatibilityPlan["plan"]["rollbackWindow"],
  now: Date
): boolean {
  if (rollbackWindow.state !== "open" || rollbackWindow.previousApplicationDigest !== active.applicationDigest) return false;
  const closesAt = Date.parse(rollbackWindow.closesAt);
  return Number.isFinite(now.valueOf()) && Number.isFinite(closesAt) && closesAt > now.valueOf();
}

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
    private readonly realtime: StaticRealtimeConvergence,
    private readonly clock: StaticDeploymentClock = { now: () => new Date() },
    private readonly waiter: StaticDeploymentWaiter = { wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }
  ) {}

  async deploy(input: Readonly<{
    build: VerifiedStaticApplicationBuild;
    generationId: string;
    workerOwner: string;
    workerLeaseExpiresAt: string;
    lifecycleAdmission: StaticDeploymentLifecycleAdmission;
  }>): Promise<StaticDeploymentOutcome> {
    if (typeof input.lifecycleAdmission !== "object" || input.lifecycleAdmission === null) {
      throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Static promotion requires durable lifecycle admission.");
    }
    const verified = this.builds.read(input.build);
    const change = verified.change.change;
    if (change.migration.steps.some((step) => step.phase === "offline-required")) {
      return Object.freeze({ outcome: "maintenance-required", reasons: ["offline-migration"] as const });
    }
    const owner = { applicationId: change.applicationId, environment: change.environment };
    const before = await this.requireState(owner);
    if (!hasLiveStaticPromotionRollbackWindow(before.active, change.migration.rollbackWindow, this.clock.now())) {
      throw new StaticDeploymentSupervisorError("READINESS_REJECTED", "Promotion rollback window does not retain the active application and remain open.");
    }
    if (await this.state.readGenerationRetirement({ ...owner, generationId: input.generationId })) {
      throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Static generation identity has a durable retirement tombstone.");
    }
    const fence = await this.requireFence(owner);
    const artifact = await this.artifacts.resolve(verified.evidence);
    ensureArtifact(artifact, verified.evidence);
    if (artifact.runtimeImageDigest !== artifact.imageDigest) throw new StaticDeploymentSupervisorError("ARTIFACT_MISMATCH", "Artifact provider did not resolve the attested image bytes.");
    const completedMigrationSteps = await this.migrations.runOnline(change.migration);
    let readiness: StaticPromotionReadiness;
    try {
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
      await this.cleanRejectedPromotion(owner, input.generationId, error);
      throw error;
    }
    let receipt: StaticDeploymentReceipt;
    try {
      receipt = await this.state.promote({
        ...owner,
        expectedRevision: before.revision,
        expectedFenceToken: fence.fencingToken,
        generationId: input.generationId,
        workerOwner: input.workerOwner,
        workerLeaseExpiresAt: input.workerLeaseExpiresAt,
        build: input.build,
        readiness,
        lifecycleAdmission: input.lifecycleAdmission
      });
    } catch (error) {
      await this.cleanRejectedPromotion(owner, input.generationId, error);
      throw error;
    }
    await this.finishPostCommit(owner);
    await this.recoverActiveWorkerIfSafe(owner, {});
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
    // The retained target remains rollback-authorized on readiness failure. Retiring
    // it after this unlocked read could race another supervisor that promotes it.
    await this.generations.start({ ...owner, generationId: retained.generationId, imageReference: artifact.imageReference, workerMode: "passive" });
    const readiness = await this.generations.readiness({
      ...owner,
      generationId: retained.generationId,
      sourceCommit: retained.sourceCommit,
      applicationDigest: retained.applicationDigest,
      imageDigest: retained.imageDigest,
      migrationRevision: retained.migrationRevision,
      completedMigrationSteps: []
    });
    ensureReadiness(readiness, retained);
    const receipt = await this.state.rollback({
      ...owner,
      expectedRevision: before.revision,
      expectedFenceToken: fence.fencingToken,
      workerOwner: input.workerOwner,
      workerLeaseExpiresAt: input.workerLeaseExpiresAt
    });
    await this.finishPostCommit(owner);
    await this.recoverActiveWorkerIfSafe(owner, {});
    return receipt;
  }

  async recover(owner: Owner, options: Readonly<{ initialActivation?: boolean; workerLeaseDurationMs?: number }> = {}): Promise<void> {
    await this.recoverPendingGenerationRetirements(owner);
    await this.recoverActiveWorkerIfSafe(owner, options);
    await this.finishPostCommit(owner);
    await this.recoverActiveWorkerIfSafe(owner, options);
  }

  private async recoverActiveWorkerIfSafe(owner: Owner, options: Readonly<{ initialActivation?: boolean; workerLeaseDurationMs?: number }>): Promise<boolean> {
    const current = await this.requireState(owner);
    const checkpoint = current.transitionCheckpoint;
    if (checkpoint?.reservedStep || (checkpoint && checkpoint.kind !== "retire-rollback" && checkpoint.completedSteps[0] !== "activate-worker")) return false;
    const fence = await this.requireFence(owner);
    const pending = await this.state.readWorkerRecoveryActivation(owner);
    if (pending) {
      if (pending.generationId !== current.active.generationId || pending.revision !== current.revision || pending.fencingToken !== fence.fencingToken ||
        pending.promotionRevision !== fence.promotionRevision || pending.leaseOwner !== fence.lease.owner) {
        throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Pending worker recovery no longer matches the active deployment fence.");
      }
      if (!(await this.generations.hasHealthyActiveWorker({ ...owner, ...current.active, fencingToken: pending.fencingToken })) || !(await this.state.isWorkerFenceLive(owner, fence))) {
        await this.generations.recoverActiveWorker(pending);
      }
      await this.state.completeWorkerRecoveryActivation(pending);
      return true;
    }
    await this.state.expireWorkerRecoveryActivation(owner);
    if (await this.generations.hasHealthyActiveWorker({ ...owner, ...current.active, fencingToken: fence.fencingToken }) && await this.state.isWorkerFenceLive(owner, fence)) return true;
    const ticket = await this.state.reserveWorkerRecoveryActivation({ ...owner, ...options, executionLeaseDurationMs: options.workerLeaseDurationMs ?? 1_000, expectedRevision: current.revision, expectedFencingToken: fence.fencingToken, expectedPromotionRevision: fence.promotionRevision, generationId: current.active.generationId });
    // A worker may have switched mode before a process died. An error leaves
    // the durable claim until expiry; a later recovery replays this ticket.
    await this.generations.recoverActiveWorker(ticket);
    await this.state.completeWorkerRecoveryActivation(ticket);
    return true;
  }

  async closeRollback(owner: Owner): Promise<StaticDeploymentReceipt> {
    await this.finishPostCommit(owner);
    let current = await this.requireState(owner);
    if (current.rollbackWindow.state === "closed") {
      const retiredGenerationId = current.rollbackWindow.retiredGenerationId;
      if (typeof retiredGenerationId !== "string") throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Closed rollback state is missing its retired generation identity.");
      return this.state.closeRollback({ ...owner, expectedRevision: current.revision, retiredGenerationId });
    }
    if (current.rollbackWindow.state === "open") {
      if (!current.rollback) throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "No retained generation is available to retire.");
      await this.state.reserveRollbackRetirement({ ...owner, expectedRevision: current.revision, retiredGenerationId: current.rollback.generationId });
      current = await this.requireState(owner);
    }
    if (current.rollbackWindow.state !== "retirement-reserved" || !current.rollback) {
      throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "No retained generation is reserved for retirement.");
    }
    await this.finishPostCommit(owner);
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

  private async cleanRejectedPromotion(owner: Owner, generationId: string, primary: unknown): Promise<void> {
    try {
      await this.retireRejectedPromotion(owner, generationId);
    } catch (cleanup) {
      const message = primary instanceof Error ? primary.message : "Static deployment failed while retiring its rejected generation.";
      const combined = new AggregateError([primary, cleanup], message, { cause: primary });
      if (primary && typeof primary === "object") {
        for (const field of ["code", "status"] as const) {
          if (Object.hasOwn(primary, field)) Object.defineProperty(combined, field, { value: (primary as Record<string, unknown>)[field], enumerable: true });
        }
      }
      throw combined;
    }
  }

  private async retireRejectedPromotion(owner: Owner, generationId: string): Promise<void> {
    const reservation = await this.state.reserveGenerationRetirement({ ...owner, generationId });
    if (!reservation) return;
    await this.generations.retire({ reservation });
    await this.state.completeGenerationRetirement(reservation);
  }

  private async recoverPendingGenerationRetirements(owner: Owner): Promise<void> {
    const pageSize = 32;
    const maximum = 128;
    let recovered = 0;
    while (true) {
      const page = await this.state.listPendingGenerationRetirements({ ...owner, limit: pageSize });
      if (page.length === 0) return;
      if (page.length > pageSize || recovered + page.length > maximum) {
        throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Pending static generation retirements exceed the bounded recovery limit.");
      }
      for (const reservation of page) {
        await this.generations.retire({ reservation });
        await this.state.completeGenerationRetirement(reservation);
      }
      recovered += page.length;
    }
  }

  private async finishPostCommit(owner: Owner): Promise<void> {
    const steps: Record<StaticDeploymentTransitionCheckpoint["kind"], readonly StaticDeploymentTransitionStep[]> = {
      promote: ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"],
      rollback: ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"],
      "retire-rollback": ["drain-retained", "retire-retained"],
      "promote-retire-previous": ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous", "retire-retained"]
    };
    while (true) {
      const current = await this.requireState(owner);
      const checkpoint = current.transitionCheckpoint;
      if (!checkpoint) return;
      const step = steps[checkpoint.kind][checkpoint.completedSteps.length];
      if (!step) return;
      if ((step === "drain-previous" || step === "drain-retained" || step === "retire-retained") && checkpoint.previousGenerationId === current.active.generationId) {
        throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Active generation cannot be drained or retired.");
      }
      const ticket = await this.reserveTransitionStep({ ...owner, expectedRevision: checkpoint.revision, step });
      try {
        if (step === "activate-worker") await this.generations.activateWorker(ticket);
        else if (step === "converge-gateway") await this.gateway.converge(ticket);
        else if (step === "reconnect-realtime") await this.realtime.reconnectAndResync(ticket);
        else if (step === "retire-retained") {
          const reservation = await this.state.readGenerationRetirement({ ...owner, generationId: checkpoint.previousGenerationId });
          if (!reservation) throw new StaticDeploymentSupervisorError("STATE_UNAVAILABLE", "Rollback retirement is missing its durable reservation.");
          await this.generations.retire({ reservation, ticket });
          await this.state.completeGenerationRetirement(reservation);
        } else {
          await this.generations.drain(ticket);
        }
      } catch (error) {
        if (error instanceof StaticDeploymentEffectNotDispatchedError) {
          await this.state.releaseTransitionStep(ticket);
        }
        // Ambiguous failures retain the durable claim because the boundary may
        // have accepted the effect before its response was lost.
        throw error;
      }
      await this.state.completeTransitionStep(ticket);
    }
  }

  private async reserveTransitionStep(input: Owner & Readonly<{ expectedRevision: number; step: StaticDeploymentTransitionStep }>): Promise<StaticDeploymentTransitionTicket> {
    const deadline = this.clock.now().valueOf() + 65_000;
    const reservationId = globalThis.crypto.randomUUID();
    let attempts = 0;
    while (true) {
      try {
        return await this.state.reserveTransitionStep({ ...input, reservationId });
      } catch (error) {
        const current = await this.requireState(input);
        const checkpoint = current.transitionCheckpoint;
        const expiresAt = checkpoint?.reservationExpiresAt ? Date.parse(checkpoint.reservationExpiresAt) : Number.NaN;
        const now = this.clock.now().valueOf();
        if (!checkpoint?.reservedStep || !Number.isFinite(expiresAt) || expiresAt <= now || now >= deadline || attempts >= 70) throw error;
        attempts += 1;
        await this.waiter.wait(Math.min(1_000, Math.max(1, expiresAt - now)));
      }
    }
  }
}
