import {
  canonicalJson,
  StaticCompositionChangePlanSchema,
  StaticDeploymentReceiptSchema,
  TrustedApplicationBuildEvidenceSchema,
  WorkerGenerationFenceSchema,
  type StaticCompositionChangePlan,
  type StaticDeploymentReceipt,
  type TrustedApplicationBuildEvidence,
  type WorkerGenerationFence
} from "@k-nex/contracts";
import { hasLiveStaticPromotionRollbackWindow } from "@k-nex/runtime";
import type {
  StaticApplicationGeneration,
  StaticDeploymentSnapshot,
  StaticDeploymentTransitionCheckpoint,
  StaticDeploymentTransitionStep,
  StaticDeploymentTransitionTicket,
  StaticGenerationRetirementReservation,
  StaticWorkerRecoveryActivationTicket,
  StaticPromotionReadiness,
  VerifiedStaticApplicationBuild,
  VerifiedStaticBuildReader
} from "@k-nex/runtime";

import type { RuntimeExtensionClock, RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export type StaticDeploymentStoreErrorCode =
  | "INPUT_INVALID"
  | "REVISION_CONFLICT"
  | "EVIDENCE_MISMATCH"
  | "READINESS_REJECTED"
  | "MAINTENANCE_REQUIRED"
  | "FENCE_REJECTED"
  | "ROLLBACK_UNAVAILABLE"
  | "CONTRACT_CLEANUP_BLOCKED"
  | "EFFECT_CONFLICT";

export class StaticDeploymentStoreError extends Error {
  constructor(readonly code: StaticDeploymentStoreErrorCode, message: string) {
    super(message);
    this.name = "StaticDeploymentStoreError";
  }
}

interface DeploymentRow {
  revision: number;
  active_generation_id: string;
  active_generation: StaticApplicationGeneration;
  rollback_generation_id: string | null;
  rollback_generation: StaticApplicationGeneration | null;
  rollback_window: Record<string, unknown>;
  transition_checkpoint: StaticDeploymentTransitionCheckpoint | null;
  state_digest: string;
}

interface FenceRow {
  active_execution_generation: string;
  fencing_token: string | number;
  lease_owner: string;
  lease_expires_at: Date | string;
  promotion_revision: number;
}

interface EffectRow {
  state: "pending" | "completed";
  generation_id: string;
  fencing_token: string | number;
  attempts: number;
  claim_owner: string | null;
  claim_token: string | null;
  claim_expires_at: Date | string | null;
  result_digest: string | null;
}

interface RetirementRow {
  application_id: string;
  environment: string;
  generation_id: string;
  reservation_id: string;
  state: "reserved" | "completed";
  reserved_at: Date | string;
  completed_at: Date | string | null;
}

interface TransitionAuthorityRow extends DeploymentRow, FenceRow {
  reservation_id: string | null;
  retirement_state: "reserved" | "completed" | null;
  retirement_generation_id: string | null;
}

interface WorkerRecoveryActivationRow {
  application_id: string;
  environment: string;
  generation_id: string;
  deployment_revision: number;
  fencing_token: string | number;
  promotion_revision: number;
  lease_owner: string;
  execution_lease_duration_ms: number;
  recovery_id: string;
  state: "reserved" | "completed" | "expired";
  recovery_expires_at: Date | string;
  reserved_at: Date | string;
  completed_at: Date | string | null;
}

interface WorkerRecoveryAuthorityRow extends WorkerRecoveryActivationRow, DeploymentRow {
  live_fencing_token: string | number;
  live_lease_owner: string;
  lease_expires_at: Date | string;
  live_promotion_revision: number;
  active_execution_generation: string;
}

interface Owner { readonly applicationId: string; readonly environment: string; }

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const generationPattern = /^[a-z][a-z0-9-]{2,127}$/u;

function fail(code: StaticDeploymentStoreErrorCode, message: string): never {
  throw new StaticDeploymentStoreError(code, message);
}

function assertOwner(owner: Owner): void {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(owner.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(owner.environment)) fail("INPUT_INVALID", "Static deployment owner is invalid.");
}

function assertGeneration(value: StaticApplicationGeneration): void {
  if (!generationPattern.test(value.generationId) || !/^[0-9a-f]{40}$/u.test(value.sourceCommit) ||
    ![value.compositionChangePlanDigest, value.buildEvidenceDigest, value.applicationDigest, value.imageDigest].every((item) => digestPattern.test(item)) ||
    !/^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/u.test(value.imageReference) || !value.imageReference.endsWith(`@${value.imageDigest}`) ||
    !Number.isSafeInteger(value.migrationRevision) || value.migrationRevision < 0 || value.migrationRevision > 1_000_000_000) {
    fail("INPUT_INVALID", "Static application generation evidence is invalid.");
  }
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1_000_000_000) fail("REVISION_CONFLICT", "Static deployment expected revision is invalid.");
}

function assertFenceToken(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) fail("FENCE_REJECTED", "Worker fencing token is invalid.");
}

function nextFenceToken(value: string | number): number {
  const current = Number(value);
  assertFenceToken(current);
  if (current >= Number.MAX_SAFE_INTEGER - 1) fail("FENCE_REJECTED", "Worker fencing token space is exhausted.");
  return current + 1;
}

function timestamp(clock: RuntimeExtensionClock): string {
  const value = clock.now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail("INPUT_INVALID", "Static deployment clock is invalid.");
  return value.toISOString();
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function receiptId(owner: Owner, operation: StaticDeploymentReceipt["operation"], revision: number): Promise<string> {
  return `static-${operation}-${(await sha256([owner.applicationId, owner.environment])).slice(7)}-${revision}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function checkpoint(value: StaticDeploymentTransitionCheckpoint | null, row: DeploymentRow): StaticDeploymentTransitionCheckpoint | null {
  if (value === null) return null;
  const allowed: Record<StaticDeploymentTransitionCheckpoint["kind"], readonly StaticDeploymentTransitionStep[]> = {
    promote: ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"],
    rollback: ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"],
    "retire-rollback": ["drain-retained", "retire-retained"],
    "promote-retire-previous": ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous", "retire-retained"]
  };
  const hasReservation = value?.reservedStep !== undefined || value?.reservationId !== undefined || value?.reservationExpiresAt !== undefined;
  const reservationIsValid = !hasReservation || Boolean(value?.reservedStep && value.reservationId && value.reservationExpiresAt &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.reservationId) && Number.isFinite(Date.parse(value.reservationExpiresAt)));
  if (!value || !["promote", "rollback", "retire-rollback", "promote-retire-previous"].includes(value.kind) || value.revision !== row.revision ||
    !generationPattern.test(value.activeGenerationId) || !generationPattern.test(value.previousGenerationId) ||
    value.activeGenerationId !== row.active_generation_id ||
    (value.kind === "promote-retire-previous" ? row.rollback_generation_id !== null : value.previousGenerationId !== row.rollback_generation_id) ||
    !Array.isArray(value.completedSteps) || value.completedSteps.some((step, index) => step !== allowed[value.kind][index]) ||
    (value.reservedStep !== undefined && value.reservedStep !== allowed[value.kind][value.completedSteps.length]) || !reservationIsValid) {
    fail("INPUT_INVALID", "Static deployment transition checkpoint is invalid.");
  }
  return value;
}

function assertNoReservedStep(value: StaticDeploymentTransitionCheckpoint | null): void {
  if (value?.reservedStep) fail("REVISION_CONFLICT", "Static deployment has a durable external transition step in progress.");
}

function assertCompletedCheckpoint(value: StaticDeploymentTransitionCheckpoint | null): void {
  if (!value) return;
  const allowed = value.kind === "retire-rollback"
    ? ["drain-retained", "retire-retained"]
    : value.kind === "promote-retire-previous"
      ? ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous", "retire-retained"]
      : ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"];
  if (value.completedSteps.length !== allowed.length) {
    fail("REVISION_CONFLICT", "Static deployment has an incomplete transition checkpoint.");
  }
}

function assertWorkerRecoveryCheckpoint(value: StaticDeploymentTransitionCheckpoint | null): void {
  if (!value || value.kind === "retire-rollback" || value.completedSteps[0] === "activate-worker") return;
  fail("REVISION_CONFLICT", "Static worker recovery cannot bypass pending worker activation.");
}

function assertRecoveryId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    fail("INPUT_INVALID", "Static worker recovery identity is invalid.");
  }
}

function snapshot(owner: Owner, row: DeploymentRow): StaticDeploymentSnapshot {
  const transitionCheckpoint = checkpoint(row.transition_checkpoint, row);
  return Object.freeze({
    ...owner,
    revision: row.revision,
    active: Object.freeze(structuredClone(row.active_generation)),
    ...(row.rollback_generation ? { rollback: Object.freeze(structuredClone(row.rollback_generation)) } : {}),
    rollbackWindow: Object.freeze(structuredClone(row.rollback_window)),
    ...(transitionCheckpoint ? { transitionCheckpoint: Object.freeze(structuredClone(transitionCheckpoint)) } : {}),
    stateDigest: row.state_digest
  });
}

function stateForDigest(row: Readonly<Pick<DeploymentRow, "revision" | "active_generation" | "rollback_generation" | "rollback_window" | "transition_checkpoint">>): Record<string, unknown> {
  return { revision: row.revision, active: row.active_generation, rollback: row.rollback_generation, rollbackWindow: row.rollback_window, transitionCheckpoint: row.transition_checkpoint };
}

function effectIdempotencyKey(input: Owner & Readonly<{ effectId: string }>): string {
  return `${input.applicationId}:${input.environment}:${input.effectId}`;
}

export class PostgresStaticDeploymentStore {
  constructor(
    private readonly pool: RuntimeExtensionPool,
    private readonly clock: RuntimeExtensionClock,
    private readonly builds: VerifiedStaticBuildReader
  ) {}

  async initialize(input: Owner & Readonly<{
    generation: StaticApplicationGeneration;
    workerOwner: string;
    workerFencingToken: number;
    workerLeaseExpiresAt: string;
  }>): Promise<StaticDeploymentSnapshot> {
    assertOwner(input); assertGeneration(input.generation); assertFenceToken(input.workerFencingToken);
    this.assertWorkerLease(input.workerOwner, input.workerLeaseExpiresAt);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const state = { revision: 0, active: input.generation, rollback: null, rollbackWindow: { state: "not-applicable", contractCleanup: "blocked" }, transitionCheckpoint: null };
      const stateDigest = await sha256(state);
      await session.query(
        `insert into runtime_static_deployments (
           application_id, environment, revision, active_generation_id, active_generation, rollback_window, transition_checkpoint, state_digest
         ) values ($1,$2,0,$3,$4::jsonb,$5::jsonb,null,$6) on conflict do nothing`,
        [input.applicationId, input.environment, input.generation.generationId, JSON.stringify(input.generation), JSON.stringify(state.rollbackWindow), stateDigest]
      );
      await session.query(
        `insert into runtime_worker_generation_fences (
           application_id, environment, active_execution_generation, fencing_token, lease_owner, lease_expires_at, promotion_revision
         ) values ($1,$2,$3,$4,$5,$6,0) on conflict do nothing`,
        [input.applicationId, input.environment, input.generation.generationId, input.workerFencingToken, input.workerOwner, input.workerLeaseExpiresAt]
      );
      const row = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!row || !fence || !same(row.active_generation, input.generation) || Number(fence.fencing_token) !== input.workerFencingToken || fence.active_execution_generation !== input.generation.generationId) {
        fail("REVISION_CONFLICT", "Static deployment is already initialized with different authority.");
      }
      return snapshot(input, row);
    });
  }

  async read(owner: Owner): Promise<StaticDeploymentSnapshot | undefined> {
    assertOwner(owner);
    const result = await this.pool.query<DeploymentRow>(
      `select * from runtime_static_deployments where application_id=$1 and environment=$2`,
      [owner.applicationId, owner.environment]
    );
    return result.rows[0] ? snapshot(owner, result.rows[0]) : undefined;
  }

  async readFence(owner: Owner): Promise<WorkerGenerationFence | undefined> {
    assertOwner(owner);
    const result = await this.pool.query<FenceRow>(
      `select * from runtime_worker_generation_fences where application_id=$1 and environment=$2`,
      [owner.applicationId, owner.environment]
    );
    return result.rows[0] ? this.fence(owner, result.rows[0]) : undefined;
  }

  async isWorkerFenceLive(owner: Owner, expected: WorkerGenerationFence): Promise<boolean> {
    assertOwner(owner); assertFenceToken(expected.fencingToken); assertRevision(expected.promotionRevision);
    const result = await this.pool.query<{ live: boolean }>(
      `select exists(select 1 from runtime_worker_generation_fences
         where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4
           and lease_owner=$5 and promotion_revision=$6 and lease_expires_at>now()) as live`,
      [owner.applicationId, owner.environment, expected.activeExecutionGeneration, expected.fencingToken, expected.lease.owner, expected.promotionRevision]
    );
    return result.rows[0]?.live === true;
  }

  async promote(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    generationId: string;
    workerOwner: string;
    workerLeaseExpiresAt: string;
    build: VerifiedStaticApplicationBuild;
    readiness: StaticPromotionReadiness;
    lifecycleAdmission: Readonly<{ operationId: string; expectedRevision: number; extensionId: string; quarantineRecovery: boolean }>;
  }>): Promise<StaticDeploymentReceipt> {
    assertOwner(input); assertRevision(input.expectedRevision); assertFenceToken(input.expectedFenceToken);
    if (!generationPattern.test(input.generationId)) fail("INPUT_INVALID", "Target static generation identity is invalid.");
    this.assertWorkerLease(input.workerOwner, input.workerLeaseExpiresAt);
    if (typeof input.lifecycleAdmission !== "object" || input.lifecycleAdmission === null ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(input.lifecycleAdmission.operationId) ||
      !Number.isSafeInteger(input.lifecycleAdmission.expectedRevision) || input.lifecycleAdmission.expectedRevision < 0 ||
      !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(input.lifecycleAdmission.extensionId) ||
      typeof input.lifecycleAdmission.quarantineRecovery !== "boolean") fail("INPUT_INVALID", "Static lifecycle admission is invalid.");
    const verified = this.builds.read(input.build);
    const change = this.parseChange(verified.change.change);
    const evidence = this.parseEvidence(verified.evidence);
    const generation = await this.targetGeneration(input, change, evidence);
    return this.transaction(async (session) => {
      {
        const admission = input.lifecycleAdmission;
        if (change.plugin.id !== admission.extensionId) fail("EVIDENCE_MISMATCH", "Static lifecycle admission targets another plugin.");
        await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([input.applicationId, input.environment, "platform-plugin", admission.extensionId])]);
        const lifecycle = await session.query<{
          operation_id: string; expected_revision: number; phase: string; plan_json: Record<string, unknown>;
          lifecycle_revision: number; disposition: string;
        }>(
          `select o.operation_id, o.expected_revision, o.phase, o.plan_json,
                  e.revision lifecycle_revision, e.disposition
           from runtime_extension_operations o
           join runtime_extensions e on e.application_id=o.application_id and e.environment=o.environment
             and e.delivery_class=o.delivery_class and e.extension_id=o.extension_id
           where o.operation_id=$1 and o.application_id=$2 and o.environment=$3
             and o.delivery_class='platform-plugin' and o.extension_id=$4
           for update of o,e`,
          [admission.operationId, input.applicationId, input.environment, admission.extensionId]
        );
        const row = lifecycle.rows[0];
        const plan = row?.plan_json;
        if (!row || row.expected_revision !== admission.expectedRevision || row.lifecycle_revision !== admission.expectedRevision ||
          !["source-change-ready", "build-attested", "zero-downtime-eligible", "rollback-window-open"].includes(row.phase) ||
          plan?.["executionClass"] !== "static-release" || plan?.["generationId"] !== input.generationId ||
          plan?.["quarantineRecovery"] !== admission.quarantineRecovery ||
          (row.disposition === "quarantined") !== admission.quarantineRecovery) {
          fail("REVISION_CONFLICT", "Static lifecycle admission changed before promotion.");
        }
      }
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Static deployment revision changed before promotion.");
      await this.assertNoLiveWorkerRecovery(session, input);
      assertNoReservedStep(current.transition_checkpoint);
      assertCompletedCheckpoint(current.transition_checkpoint);
      if (await this.readRetirementLocked(session, input, input.generationId)) fail("REVISION_CONFLICT", "Target static generation is reserved or tombstoned for retirement.");
      if (current.rollback_window.state === "retirement-reserved") fail("REVISION_CONFLICT", "Static deployment cannot replace a generation while rollback retirement is reserved.");
      if (current.active_generation.sourceCommit !== change.base.sourceCommit || current.active_generation.migrationRevision !== change.migration.baseRevision) {
        fail("EVIDENCE_MISMATCH", "Static deployment no longer matches the authorized base source and migration revision.");
      }
      if (!fence || Number(fence.fencing_token) !== input.expectedFenceToken || fence.active_execution_generation !== current.active_generation_id) {
        fail("FENCE_REJECTED", "Worker execution authority changed before promotion.");
      }
      const rollbackWindow = change.migration.rollbackWindow;
      if (rollbackWindow.state !== "open" || !hasLiveStaticPromotionRollbackWindow(current.active_generation, rollbackWindow, this.clock.now())) {
        fail("READINESS_REJECTED", "Promotion rollback window does not retain the active application and remain open.");
      }
      const revision = current.revision + 1;
      const token = nextFenceToken(fence.fencing_token);
      const occurredAt = timestamp(this.clock);
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1,
        receiptId: await receiptId(input, "promote", revision),
        operation: "promote",
        applicationId: input.applicationId,
        environment: input.environment,
        activeGenerationId: generation.generationId,
        previousGenerationId: current.active_generation_id,
        sourceCommit: generation.sourceCommit,
        compositionChangePlanDigest: generation.compositionChangePlanDigest,
        buildEvidenceDigest: generation.buildEvidenceDigest,
        applicationDigest: generation.applicationDigest,
        imageDigest: generation.imageDigest,
        migrationRevision: generation.migrationRevision,
        workerFencingToken: token,
        promotionRevision: revision,
        revisionBefore: current.revision,
        revisionAfter: revision,
        rollbackWindow: input.lifecycleAdmission.quarantineRecovery
          ? { state: "closed", windowId: rollbackWindow.windowId, closedAt: occurredAt }
          : { state: "open", windowId: rollbackWindow.windowId, closesAt: rollbackWindow.closesAt },
        contractCleanup: "blocked",
        occurredAt
      });
      if (input.lifecycleAdmission.quarantineRecovery) {
        if (await this.readRetirementLocked(session, input, current.active_generation_id)) {
          fail("REVISION_CONFLICT", "Quarantined static generation is already reserved or tombstoned for retirement.");
        }
        const reservedAt = occurredAt;
        await session.query(
          `insert into runtime_static_generation_retirements (
             application_id, environment, generation_id, reservation_id, reserved_at
           ) values ($1,$2,$3,$4,$5)`,
          [input.applicationId, input.environment, current.active_generation_id, globalThis.crypto.randomUUID(), reservedAt]
        );
        const closedWindow = { state: "closed", windowId: rollbackWindow.windowId, closedAt: reservedAt, retiredGenerationId: current.active_generation_id, contractCleanup: "blocked" };
        await this.commitTransition(session, input, current, fence, generation, null, closedWindow, receipt, input.workerOwner, input.workerLeaseExpiresAt,
          "promote-retire-previous", current.active_generation_id);
      } else {
        await this.commitTransition(session, input, current, fence, generation, current.active_generation, rollbackWindow, receipt, input.workerOwner, input.workerLeaseExpiresAt);
      }
      return Object.freeze(receipt);
    });
  }

  async rollback(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    workerOwner: string;
    workerLeaseExpiresAt: string;
  }>): Promise<StaticDeploymentReceipt> {
    assertOwner(input); assertRevision(input.expectedRevision); assertFenceToken(input.expectedFenceToken);
    this.assertWorkerLease(input.workerOwner, input.workerLeaseExpiresAt);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Static deployment revision changed before rollback.");
      await this.assertNoLiveWorkerRecovery(session, input);
      assertNoReservedStep(current.transition_checkpoint);
      assertCompletedCheckpoint(current.transition_checkpoint);
      if (!current.rollback_generation || !current.rollback_generation_id || current.rollback_window.state !== "open") fail("ROLLBACK_UNAVAILABLE", "No compatible static generation is retained for rollback.");
      if (new Date(String(current.rollback_window.closesAt)).valueOf() <= this.clock.now().valueOf()) fail("ROLLBACK_UNAVAILABLE", "Static deployment rollback window has expired.");
      if (!fence || Number(fence.fencing_token) !== input.expectedFenceToken || fence.active_execution_generation !== current.active_generation_id) fail("FENCE_REJECTED", "Worker execution authority changed before rollback.");
      const revision = current.revision + 1;
      const token = nextFenceToken(fence.fencing_token);
      const target = current.rollback_generation;
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1,
        receiptId: await receiptId(input, "rollback", revision),
        operation: "rollback",
        applicationId: input.applicationId,
        environment: input.environment,
        activeGenerationId: target.generationId,
        previousGenerationId: current.active_generation_id,
        sourceCommit: target.sourceCommit,
        compositionChangePlanDigest: target.compositionChangePlanDigest,
        buildEvidenceDigest: target.buildEvidenceDigest,
        applicationDigest: target.applicationDigest,
        imageDigest: target.imageDigest,
        migrationRevision: target.migrationRevision,
        workerFencingToken: token,
        promotionRevision: revision,
        revisionBefore: current.revision,
        revisionAfter: revision,
        rollbackWindow: { state: "open", windowId: current.rollback_window.windowId, closesAt: current.rollback_window.closesAt },
        contractCleanup: "blocked",
        occurredAt: timestamp(this.clock)
      });
      await this.commitTransition(session, input, current, fence, target, current.active_generation, current.rollback_window, receipt, input.workerOwner, input.workerLeaseExpiresAt);
      return Object.freeze(receipt);
    });
  }

  async closeRollback(input: Owner & Readonly<{ expectedRevision: number; retiredGenerationId: string }>): Promise<StaticDeploymentReceipt> {
    assertOwner(input); assertRevision(input.expectedRevision);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current) fail("REVISION_CONFLICT", "Static deployment is unavailable for rollback closure.");
      if (current.rollback_window.state === "closed") return this.readCloseReceipt(session, input, current);
      await this.assertNoLiveWorkerRecovery(session, input);
      if (current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Static deployment revision changed before rollback closure.");
      assertNoReservedStep(current.transition_checkpoint);
      assertCompletedCheckpoint(current.transition_checkpoint);
      if (!current.rollback_generation || current.rollback_generation_id !== input.retiredGenerationId || current.rollback_window.state !== "retirement-reserved" ||
        !current.transition_checkpoint?.completedSteps.includes("drain-retained") || !current.transition_checkpoint.completedSteps.includes("retire-retained")) {
        fail("CONTRACT_CLEANUP_BLOCKED", "The retained rollback generation has not been drained and retired under its reservation.");
      }
      const retirement = await this.readRetirementLocked(session, input, input.retiredGenerationId);
      if (!retirement || retirement.state !== "completed") fail("CONTRACT_CLEANUP_BLOCKED", "The retained rollback generation is missing its completed one-shot retirement tombstone.");
      if (!fence) fail("FENCE_REJECTED", "Worker execution fence is unavailable.");
      const revision = current.revision + 1;
      const closedAt = timestamp(this.clock);
      const rollbackWindow = { state: "closed", windowId: current.rollback_window.windowId, closedAt, retiredGenerationId: input.retiredGenerationId, contractCleanup: "eligible" };
      const stateDigest = await sha256({ revision, active: current.active_generation, rollback: null, rollbackWindow, transitionCheckpoint: null });
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1,
        receiptId: await receiptId(input, "close-rollback", revision),
        operation: "close-rollback",
        applicationId: input.applicationId,
        environment: input.environment,
        activeGenerationId: current.active_generation_id,
        retiredGenerationId: input.retiredGenerationId,
        sourceCommit: current.active_generation.sourceCommit,
        compositionChangePlanDigest: current.active_generation.compositionChangePlanDigest,
        buildEvidenceDigest: current.active_generation.buildEvidenceDigest,
        applicationDigest: current.active_generation.applicationDigest,
        imageDigest: current.active_generation.imageDigest,
        migrationRevision: current.active_generation.migrationRevision,
        workerFencingToken: Number(fence.fencing_token),
        promotionRevision: fence.promotion_revision,
        revisionBefore: current.revision,
        revisionAfter: revision,
        rollbackWindow: { state: "closed", windowId: current.rollback_window.windowId, closedAt },
        contractCleanup: "eligible",
        occurredAt: closedAt
      });
      const updated = await session.query(
        `update runtime_static_deployments set revision=$3, rollback_generation_id=null, rollback_generation=null,
           rollback_window=$4::jsonb, transition_checkpoint=null, state_digest=$5, updated_at=now()
         where application_id=$1 and environment=$2 and revision=$6 returning revision`,
        [input.applicationId, input.environment, revision, JSON.stringify(rollbackWindow), stateDigest, current.revision]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment changed before rollback closure commit.");
      await this.outbox(session, input, receipt);
      return Object.freeze(receipt);
    });
  }

  async reserveRollbackRetirement(input: Owner & Readonly<{ expectedRevision: number; retiredGenerationId: string }>): Promise<StaticGenerationRetirementReservation> {
    assertOwner(input); assertRevision(input.expectedRevision);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || !fence) fail("FENCE_REJECTED", "Static deployment authority is unavailable for rollback retirement.");
      if (current.rollback_window.state === "retirement-reserved" && current.rollback_generation_id === input.retiredGenerationId) {
        const existing = await this.readRetirementLocked(session, input, input.retiredGenerationId);
        if (!existing) fail("REVISION_CONFLICT", "Rollback retirement reservation is missing its durable tombstone.");
        return this.retirement(existing);
      }
      await this.assertNoLiveWorkerRecovery(session, input);
      if (current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Static deployment revision changed before rollback retirement reservation.");
      assertNoReservedStep(current.transition_checkpoint);
      assertCompletedCheckpoint(current.transition_checkpoint);
      if (!current.rollback_generation || current.rollback_generation_id !== input.retiredGenerationId || current.rollback_window.state !== "open" || current.active_generation_id === input.retiredGenerationId) {
        fail("CONTRACT_CLEANUP_BLOCKED", "Only the retained inactive rollback generation can be reserved for retirement.");
      }
      const revision = current.revision + 1;
      const reservedAt = timestamp(this.clock);
      if (await this.readRetirementLocked(session, input, input.retiredGenerationId)) {
        fail("REVISION_CONFLICT", "Retired static generation identity is permanently tombstoned.");
      }
      const reservationId = globalThis.crypto.randomUUID();
      const insertedRetirement = await session.query<RetirementRow>(
        `insert into runtime_static_generation_retirements (
           application_id, environment, generation_id, reservation_id, reserved_at
         ) values ($1,$2,$3,$4,$5) returning *`,
        [input.applicationId, input.environment, input.retiredGenerationId, reservationId, reservedAt]
      );
      const rollbackWindow = { state: "retirement-reserved", windowId: current.rollback_window.windowId, closesAt: current.rollback_window.closesAt, reservedAt, contractCleanup: "blocked" };
      const checkpoint: StaticDeploymentTransitionCheckpoint = { kind: "retire-rollback", revision, activeGenerationId: current.active_generation_id, previousGenerationId: input.retiredGenerationId, completedSteps: [] };
      const stateDigest = await sha256({ revision, active: current.active_generation, rollback: current.rollback_generation, rollbackWindow, transitionCheckpoint: checkpoint });
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1, receiptId: await receiptId(input, "reserve-rollback-retirement", revision), operation: "reserve-rollback-retirement",
        applicationId: input.applicationId, environment: input.environment, activeGenerationId: current.active_generation_id,
        retiredGenerationId: input.retiredGenerationId, sourceCommit: current.active_generation.sourceCommit,
        compositionChangePlanDigest: current.active_generation.compositionChangePlanDigest, buildEvidenceDigest: current.active_generation.buildEvidenceDigest,
        applicationDigest: current.active_generation.applicationDigest, imageDigest: current.active_generation.imageDigest,
        migrationRevision: current.active_generation.migrationRevision, workerFencingToken: Number(fence.fencing_token), promotionRevision: fence.promotion_revision,
        revisionBefore: current.revision, revisionAfter: revision,
        rollbackWindow: { state: "retirement-reserved", windowId: current.rollback_window.windowId, closesAt: current.rollback_window.closesAt, reservedAt }, contractCleanup: "blocked", occurredAt: reservedAt
      });
      const updated = await session.query(
        `update runtime_static_deployments set revision=$3, rollback_window=$4::jsonb, transition_checkpoint=$5::jsonb, state_digest=$6, updated_at=now()
         where application_id=$1 and environment=$2 and revision=$7 returning revision`,
        [input.applicationId, input.environment, revision, JSON.stringify(rollbackWindow), JSON.stringify(checkpoint), stateDigest, current.revision]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment changed before rollback retirement reservation commit.");
      await this.outbox(session, input, receipt);
      return this.retirement(insertedRetirement.rows[0]!);
    });
  }

  async reserveGenerationRetirement(input: Owner & Readonly<{ generationId: string }>): Promise<StaticGenerationRetirementReservation | undefined> {
    assertOwner(input);
    if (!generationPattern.test(input.generationId)) fail("INPUT_INVALID", "Static generation retirement identity is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      if (!current) fail("REVISION_CONFLICT", "Static deployment is unavailable for generation retirement.");
      const existing = await this.readRetirementLocked(session, input, input.generationId);
      if (current.active_generation_id === input.generationId || current.rollback_generation_id === input.generationId ||
        (current.transition_checkpoint?.kind === "promote-retire-previous" && current.transition_checkpoint.previousGenerationId === input.generationId)) {
        if (existing) fail("EVIDENCE_MISMATCH", "A protected static generation also has a retirement tombstone.");
        return undefined;
      }
      if (existing) return this.retirement(existing);
      const reservationId = globalThis.crypto.randomUUID();
      const reservedAt = timestamp(this.clock);
      const inserted = await session.query<RetirementRow>(
        `insert into runtime_static_generation_retirements (
           application_id, environment, generation_id, reservation_id, reserved_at
         ) values ($1,$2,$3,$4,$5) returning *`,
        [input.applicationId, input.environment, input.generationId, reservationId, reservedAt]
      );
      return this.retirement(inserted.rows[0]!);
    });
  }

  async readGenerationRetirement(input: Owner & Readonly<{ generationId: string }>): Promise<StaticGenerationRetirementReservation | undefined> {
    assertOwner(input);
    if (!generationPattern.test(input.generationId)) fail("INPUT_INVALID", "Static generation retirement identity is invalid.");
    const result = await this.pool.query<RetirementRow>(
      `select * from runtime_static_generation_retirements where application_id=$1 and environment=$2 and generation_id=$3`,
      [input.applicationId, input.environment, input.generationId]
    );
    return result.rows[0] ? this.retirement(result.rows[0]) : undefined;
  }

  async listPendingGenerationRetirements(input: Owner & Readonly<{ limit: number }>): Promise<readonly StaticGenerationRetirementReservation[]> {
    assertOwner(input);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 32) fail("INPUT_INVALID", "Generation retirement recovery limit is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      if (!current) fail("REVISION_CONFLICT", "Static deployment is unavailable for retirement recovery.");
      const result = await session.query<RetirementRow>(
        `select * from runtime_static_generation_retirements
         where application_id=$1 and environment=$2 and state='reserved'
           and generation_id<>$3 and generation_id<>coalesce($4, '') and generation_id<>coalesce($5, '')
         order by reserved_at, generation_id limit $6`,
        [input.applicationId, input.environment, current.active_generation_id, current.rollback_generation_id, current.transition_checkpoint?.previousGenerationId, input.limit]
      );
      return Object.freeze(result.rows.map((row) => this.retirement(row)));
    });
  }

  async completeGenerationRetirement(input: StaticGenerationRetirementReservation): Promise<void> {
    assertOwner(input);
    if (!generationPattern.test(input.generationId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.reservationId)) {
      fail("INPUT_INVALID", "Static generation retirement reservation is invalid.");
    }
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const existing = await this.readRetirementLocked(session, input, input.generationId);
      if (!current || !existing || existing.reservation_id !== input.reservationId) fail("REVISION_CONFLICT", "Generation retirement reservation changed before completion.");
      const normalRollbackRetirement = current.rollback_generation_id === input.generationId && current.rollback_window.state === "retirement-reserved" &&
        current.transition_checkpoint?.kind === "retire-rollback" && current.transition_checkpoint.previousGenerationId === input.generationId &&
        current.transition_checkpoint.reservedStep === "retire-retained";
      const quarantinedRecoveryRetirement = current.transition_checkpoint?.kind === "promote-retire-previous" &&
        current.transition_checkpoint.previousGenerationId === input.generationId && current.transition_checkpoint.reservedStep === "retire-retained";
      if (current.active_generation_id === input.generationId || (current.rollback_generation_id === input.generationId && !normalRollbackRetirement) ||
        (current.transition_checkpoint?.kind === "promote-retire-previous" && !quarantinedRecoveryRetirement)) fail("EVIDENCE_MISMATCH", "A protected static generation cannot complete retirement.");
      if (existing.state === "completed") return;
      const completedAt = timestamp(this.clock);
      const updated = await session.query(
        `update runtime_static_generation_retirements set state='completed', completed_at=$5, updated_at=now()
         where application_id=$1 and environment=$2 and generation_id=$3 and reservation_id=$4 and state='reserved' returning generation_id`,
        [input.applicationId, input.environment, input.generationId, input.reservationId, completedAt]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Generation retirement reservation changed during completion.");
    });
  }

  async reserveTransitionStep(input: Owner & Readonly<{ expectedRevision: number; step: StaticDeploymentTransitionStep; reservationId: string }>): Promise<StaticDeploymentTransitionTicket> {
    assertOwner(input); assertRevision(input.expectedRevision);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.reservationId)) fail("INPUT_INVALID", "Static deployment transition reservation identity is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.expectedRevision || !current.transition_checkpoint || !fence) fail("REVISION_CONFLICT", "Static deployment transition checkpoint changed before reservation.");
      await this.assertNoLiveWorkerRecovery(session, input);
      const checkpoint = current.transition_checkpoint;
      const allowed = checkpoint.kind === "retire-rollback" ? ["drain-retained", "retire-retained"]
        : checkpoint.kind === "promote-retire-previous" ? ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous", "retire-retained"]
          : ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"];
      if (checkpoint.reservedStep && (checkpoint.reservedStep !== input.step || checkpoint.reservationId !== input.reservationId) && Date.parse(checkpoint.reservationExpiresAt!) > this.clock.now().valueOf()) {
        fail("REVISION_CONFLICT", "A live external transition step is already reserved.");
      }
      if (input.step !== allowed[checkpoint.completedSteps.length]) fail("INPUT_INVALID", "Transition step is out of order for the persisted deployment checkpoint.");
      const ticket: StaticDeploymentTransitionTicket = Object.freeze({
        applicationId: input.applicationId,
        environment: input.environment,
        generationId: ["activate-worker", "converge-gateway", "reconnect-realtime"].includes(input.step) ? checkpoint.activeGenerationId : checkpoint.previousGenerationId,
        activeGenerationId: checkpoint.activeGenerationId,
        revision: checkpoint.revision,
        fencingToken: Number(fence.fencing_token),
        promotionRevision: fence.promotion_revision,
        leaseOwner: fence.lease_owner,
        checkpointKind: checkpoint.kind,
        step: input.step,
        reservationId: input.reservationId,
        reservationExpiresAt: new Date(this.clock.now().valueOf() + 60_000).toISOString()
      });
      if (checkpoint.reservedStep === input.step && checkpoint.reservationId === input.reservationId) return Object.freeze({ ...ticket, reservationExpiresAt: checkpoint.reservationExpiresAt! });
      const updatedCheckpoint = { ...checkpoint, reservedStep: input.step, reservationId: ticket.reservationId, reservationExpiresAt: ticket.reservationExpiresAt } as StaticDeploymentTransitionCheckpoint;
      const stateDigest = await sha256(stateForDigest({ ...current, transition_checkpoint: updatedCheckpoint }));
      const updated = await session.query(
        `update runtime_static_deployments set transition_checkpoint=$3::jsonb, state_digest=$4, updated_at=now()
         where application_id=$1 and environment=$2 and revision=$5 returning revision`,
        [input.applicationId, input.environment, JSON.stringify(updatedCheckpoint), stateDigest, input.expectedRevision]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment transition checkpoint changed during reservation.");
      return ticket;
    });
  }

  async releaseTransitionStep(input: StaticDeploymentTransitionTicket): Promise<void> {
    assertOwner(input); assertRevision(input.revision); assertFenceToken(input.fencingToken);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.revision || !current.transition_checkpoint) fail("REVISION_CONFLICT", "Static deployment transition checkpoint changed before release.");
      const checkpoint = current.transition_checkpoint;
      this.assertTransitionTicketValue(input, checkpoint, fence);
      if (checkpoint.reservedStep !== input.step || checkpoint.reservationId !== input.reservationId) return;
      const { reservedStep: _reservedStep, reservationId: _reservationId, reservationExpiresAt: _reservationExpiresAt, ...unreservedCheckpoint } = checkpoint;
      const updatedCheckpoint = unreservedCheckpoint as StaticDeploymentTransitionCheckpoint;
      const stateDigest = await sha256(stateForDigest({ ...current, transition_checkpoint: updatedCheckpoint }));
      const updated = await session.query(
        `update runtime_static_deployments set transition_checkpoint=$3::jsonb, state_digest=$4, updated_at=now()
         where application_id=$1 and environment=$2 and revision=$5 returning revision`,
        [input.applicationId, input.environment, JSON.stringify(updatedCheckpoint), stateDigest, input.revision]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment transition checkpoint changed during release.");
    });
  }

  async completeTransitionStep(input: StaticDeploymentTransitionTicket): Promise<void> {
    assertOwner(input); assertRevision(input.revision); assertFenceToken(input.fencingToken);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.revision || !current.transition_checkpoint) fail("REVISION_CONFLICT", "Static deployment transition checkpoint changed before completion.");
      const checkpoint = current.transition_checkpoint;
      this.assertTransitionTicketValue(input, checkpoint, fence);
      if (checkpoint.completedSteps.includes(input.step)) return;
      const allowed = checkpoint.kind === "retire-rollback" ? ["drain-retained", "retire-retained"]
        : checkpoint.kind === "promote-retire-previous" ? ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous", "retire-retained"]
          : ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"];
      if (input.step !== allowed[checkpoint.completedSteps.length] || checkpoint.reservedStep !== input.step || checkpoint.reservationId !== input.reservationId) fail("REVISION_CONFLICT", "Transition step is not durably reserved by this external effect.");
      const completedSteps = [...checkpoint.completedSteps, input.step] as StaticDeploymentTransitionStep[];
      const { reservedStep: _reservedStep, reservationId: _reservationId, reservationExpiresAt: _reservationExpiresAt, ...unreservedCheckpoint } = checkpoint;
      const completedRecoveryRetirement = checkpoint.kind === "promote-retire-previous" && input.step === "retire-retained";
      const updatedCheckpoint = completedRecoveryRetirement ? null : { ...unreservedCheckpoint, completedSteps } as StaticDeploymentTransitionCheckpoint;
      const rollbackWindow = completedRecoveryRetirement
        ? { ...current.rollback_window, contractCleanup: "eligible" }
        : current.rollback_window;
      const stateDigest = await sha256(stateForDigest({ ...current, rollback_window: rollbackWindow, transition_checkpoint: updatedCheckpoint }));
      const updated = await session.query(
        `update runtime_static_deployments set rollback_window=$3::jsonb, transition_checkpoint=$4::jsonb, state_digest=$5, updated_at=now()
         where application_id=$1 and environment=$2 and revision=$6 returning revision`,
        [input.applicationId, input.environment, JSON.stringify(rollbackWindow), JSON.stringify(updatedCheckpoint), stateDigest, input.revision]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment transition checkpoint changed during completion.");
    });
  }

  async assertTransitionTicket(input: StaticDeploymentTransitionTicket, retirement?: StaticGenerationRetirementReservation): Promise<void> {
    assertOwner(input); assertRevision(input.revision); assertFenceToken(input.fencingToken);
    const retirementProjection = retirement ? ", r.reservation_id, r.state as retirement_state, r.generation_id as retirement_generation_id" : "";
    const retirementJoin = retirement
      ? " left join runtime_static_generation_retirements r on r.application_id=d.application_id and r.environment=d.environment and r.generation_id=$3"
      : "";
    const result = await this.pool.query<TransitionAuthorityRow>(
      `select d.*, f.active_execution_generation, f.fencing_token, f.lease_owner, f.lease_expires_at, f.promotion_revision${retirementProjection}
       from runtime_static_deployments d join runtime_worker_generation_fences f using (application_id, environment)
       ${retirementJoin}
       where d.application_id=$1 and d.environment=$2`,
      retirement ? [input.applicationId, input.environment, retirement.generationId] : [input.applicationId, input.environment]
    );
    const current = result.rows[0];
    if (!current || current.revision !== input.revision || !current.transition_checkpoint) fail("REVISION_CONFLICT", "Static generation drain authority is stale.");
    const transition = checkpoint(current.transition_checkpoint, current);
    if (!transition) fail("REVISION_CONFLICT", "Static deployment transition authority is unavailable.");
    this.assertTransitionTicketValue(input, transition, current);
    const previousStep = input.step === "drain-previous" || input.step === "drain-retained" || input.step === "retire-retained";
    if (previousStep && (input.generationId === current.active_generation_id || transition.previousGenerationId !== input.generationId)) {
      fail("FENCE_REJECTED", "Static generation transition target is active or stale.");
    }
    if (input.step === "retire-retained") {
      const normalRollbackRetirement = current.rollback_generation_id === input.generationId && current.rollback_window.state === "retirement-reserved";
      const quarantinedRecoveryRetirement = current.rollback_generation_id === null && current.rollback_window.state === "closed" &&
        transition.kind === "promote-retire-previous" && transition.previousGenerationId === input.generationId;
      if (!retirement || retirement.applicationId !== input.applicationId || retirement.environment !== input.environment || retirement.generationId !== input.generationId ||
        current.retirement_generation_id !== input.generationId || current.reservation_id !== retirement.reservationId || !["reserved", "completed"].includes(String(current.retirement_state)) ||
        (!normalRollbackRetirement && !quarantinedRecoveryRetirement)) {
        fail("FENCE_REJECTED", "Retained static generation retirement authority is stale.");
      }
    }
  }

  async assertContractCleanup(owner: Owner): Promise<void> {
    const value = await this.read(owner);
    if (!value || value.rollback || value.rollbackWindow.state !== "closed" || value.rollbackWindow.contractCleanup !== "eligible") {
      fail("CONTRACT_CLEANUP_BLOCKED", "Post-retirement contract work requires a closed rollback window and retired old generation.");
    }
  }

  async reserveWorkerRecoveryActivation(owner: Owner & Readonly<{ expectedRevision: number; expectedFencingToken: number; expectedPromotionRevision: number; generationId: string; executionLeaseDurationMs: number; initialActivation?: boolean }>): Promise<StaticWorkerRecoveryActivationTicket> {
    assertOwner(owner); assertRevision(owner.expectedRevision); assertFenceToken(owner.expectedFencingToken); assertRevision(owner.expectedPromotionRevision);
    this.assertWorkerLeaseDuration(owner.executionLeaseDurationMs);
    if (!generationPattern.test(owner.generationId)) fail("INPUT_INVALID", "Static worker recovery generation is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session, owner);
      const current = await this.readLocked(session, owner);
      const fence = await this.readFenceLocked(session, owner);
      if (!current || !fence) fail("REVISION_CONFLICT", "Static worker recovery authority is unavailable.");
      assertNoReservedStep(current.transition_checkpoint);
      assertWorkerRecoveryCheckpoint(current.transition_checkpoint);
      const now = await this.databaseNow(session);
      const existing = await this.readLiveWorkerRecoveryLocked(session, owner);
      const sameDeployment = current.revision === owner.expectedRevision && current.active_generation_id === owner.generationId && fence.promotion_revision === owner.expectedPromotionRevision;
      if (existing && sameDeployment && new Date(existing.recovery_expires_at).valueOf() > now.valueOf()) {
        this.assertRecoveryAuthority(existing, current, fence);
        if (existing.execution_lease_duration_ms !== owner.executionLeaseDurationMs) fail("FENCE_REJECTED", "Static worker recovery lease configuration changed during activation.");
        return this.recoveryTicket(existing);
      }
      if (!sameDeployment || Number(fence.fencing_token) !== owner.expectedFencingToken) fail("REVISION_CONFLICT", "Static worker recovery probe is stale.");
      if (existing) {
        await session.query(
          `update runtime_static_worker_activations set state='expired', updated_at=now()
           where application_id=$1 and environment=$2 and recovery_id=$3 and state='reserved'`,
          [owner.applicationId, owner.environment, existing.recovery_id]
        );
      }
      const recoveryId = globalThis.crypto.randomUUID();
      const leaseOwner = `static-recovery:${recoveryId}`;
      const recoveryExpiresAt = new Date(now.valueOf() + 60_000).toISOString();
      const initialActivation = owner.initialActivation === true && current.revision === 0 && Number(fence.fencing_token) === 1 &&
        new Date(fence.lease_expires_at).valueOf() > now.valueOf() && !(await this.hasWorkerRecoveryHistoryLocked(session, owner));
      const nextFence = initialActivation ? Number(fence.fencing_token) : nextFenceToken(fence.fencing_token);
      const leaseExpiresAt = initialActivation && new Date(fence.lease_expires_at).valueOf() > Date.parse(recoveryExpiresAt)
        ? new Date(fence.lease_expires_at).toISOString()
        : recoveryExpiresAt;
      const updatedFence = await session.query<FenceRow>(
        `update runtime_worker_generation_fences set fencing_token=$3, lease_owner=$4, lease_expires_at=$5, updated_at=now()
         where application_id=$1 and environment=$2 and fencing_token=$6 and promotion_revision=$7 returning *`,
        [owner.applicationId, owner.environment, nextFence, leaseOwner, leaseExpiresAt, Number(fence.fencing_token), fence.promotion_revision]
      );
      if (!updatedFence.rows[0]) fail("FENCE_REJECTED", "Static worker recovery fence changed before takeover.");
      const inserted = await session.query<WorkerRecoveryActivationRow>(
        `insert into runtime_static_worker_activations (
           application_id, environment, generation_id, deployment_revision, fencing_token, promotion_revision, lease_owner,
           execution_lease_duration_ms, recovery_id, recovery_expires_at, reserved_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [owner.applicationId, owner.environment, current.active_generation_id, current.revision, nextFence, fence.promotion_revision,
          leaseOwner, owner.executionLeaseDurationMs, recoveryId, recoveryExpiresAt, now.toISOString()]
      );
      await session.query(
        `insert into runtime_static_worker_recovery_outbox (
           event_id, application_id, environment, recovery_id, deployment_revision, promotion_revision, generation_id,
           previous_fencing_token, previous_lease_owner, fencing_token, lease_owner, execution_lease_duration_ms, event_json
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [recoveryId, owner.applicationId, owner.environment, recoveryId, current.revision, fence.promotion_revision, current.active_generation_id,
          Number(fence.fencing_token), fence.lease_owner, nextFence, leaseOwner, owner.executionLeaseDurationMs,
          JSON.stringify({ eventId: recoveryId, recoveryId, applicationId: owner.applicationId, environment: owner.environment, deploymentRevision: current.revision,
            promotionRevision: fence.promotion_revision, generationId: current.active_generation_id, previousFencingToken: Number(fence.fencing_token), previousLeaseOwner: fence.lease_owner,
            fencingToken: nextFence, leaseOwner, executionLeaseDurationMs: owner.executionLeaseDurationMs })]
      );
      return this.recoveryTicket(inserted.rows[0]!);
    });
  }

  async completeWorkerRecoveryActivation(input: StaticWorkerRecoveryActivationTicket): Promise<void> {
    this.assertRecoveryTicketInput(input);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      const row = await this.readWorkerRecoveryLocked(session, input);
      if (!row) fail("REVISION_CONFLICT", "Static worker recovery authority changed before completion.");
      if (row.state === "completed") {
        if (row.recovery_id !== input.recoveryId || row.generation_id !== input.generationId || row.deployment_revision !== input.revision ||
          Number(row.fencing_token) !== input.fencingToken || row.promotion_revision !== input.promotionRevision || row.lease_owner !== input.leaseOwner ||
          row.execution_lease_duration_ms !== input.executionLeaseDurationMs || new Date(row.recovery_expires_at).toISOString() !== input.recoveryExpiresAt) fail("FENCE_REJECTED", "Static worker recovery completion is stale.");
        return;
      }
      if (!current || !fence) fail("REVISION_CONFLICT", "Static worker recovery authority changed before completion.");
      this.assertRecoveryTicketValue(input, row, current, fence);
      const updated = await session.query(
        `update runtime_static_worker_activations set state='completed', completed_at=now(), updated_at=now()
         where application_id=$1 and environment=$2 and recovery_id=$3 and state='reserved' and recovery_expires_at>now() returning recovery_id`,
        [input.applicationId, input.environment, input.recoveryId]
      );
      if (!updated.rows[0]) fail("FENCE_REJECTED", "Static worker recovery authority expired before completion.");
      const activated = await session.query(
        `update runtime_worker_generation_fences set lease_expires_at=now()+($7::integer*interval '1 millisecond'), updated_at=now()
         where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and lease_owner=$5
           and promotion_revision=$6 and lease_expires_at>now() returning fencing_token`,
        [input.applicationId, input.environment, input.generationId, input.fencingToken, input.leaseOwner, input.promotionRevision, input.executionLeaseDurationMs]
      );
      if (!activated.rows[0]) fail("FENCE_REJECTED", "Static worker recovery execution lease changed before completion.");
    });
  }

  async readWorkerRecoveryActivation(owner: Owner): Promise<StaticWorkerRecoveryActivationTicket | undefined> {
    assertOwner(owner);
    const result = await this.pool.query<WorkerRecoveryAuthorityRow>(
      `select a.*, d.*, f.active_execution_generation, f.fencing_token as live_fencing_token, f.lease_owner as live_lease_owner,
              f.lease_expires_at, f.promotion_revision as live_promotion_revision
       from runtime_static_worker_activations a
       join runtime_static_deployments d using (application_id, environment)
       join runtime_worker_generation_fences f using (application_id, environment)
       where a.application_id=$1 and a.environment=$2 and a.state='reserved'
         and a.recovery_expires_at>now() and f.lease_expires_at>now()
       order by a.reserved_at desc limit 1`,
      [owner.applicationId, owner.environment]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const fence: FenceRow = {
      active_execution_generation: row.active_execution_generation,
      fencing_token: row.live_fencing_token,
      lease_owner: row.live_lease_owner,
      lease_expires_at: row.lease_expires_at,
      promotion_revision: row.live_promotion_revision
    };
    this.assertRecoveryAuthority(row, row as DeploymentRow, fence);
    return this.recoveryTicket(row);
  }

  async expireWorkerRecoveryActivation(owner: Owner): Promise<boolean> {
    assertOwner(owner);
    return this.transaction(async (session) => {
      await this.lock(session, owner);
      const expired = await session.query(
        `update runtime_static_worker_activations set state='expired', updated_at=now()
         where application_id=$1 and environment=$2 and state='reserved' and recovery_expires_at<=now()
         returning recovery_id`,
        [owner.applicationId, owner.environment]
      );
      return expired.rows.length === 1;
    });
  }

  async assertWorkerRecoveryActivation(input: StaticWorkerRecoveryActivationTicket): Promise<void> {
    this.assertRecoveryTicketInput(input);
    const result = await this.pool.query<WorkerRecoveryAuthorityRow>(
      `select a.*, d.*, f.active_execution_generation, f.fencing_token as live_fencing_token, f.lease_owner as live_lease_owner,
              f.lease_expires_at, f.promotion_revision as live_promotion_revision
       from runtime_static_worker_activations a
       join runtime_static_deployments d using (application_id, environment)
       join runtime_worker_generation_fences f using (application_id, environment)
       where a.application_id=$1 and a.environment=$2 and a.recovery_id=$3 and a.state='reserved'
         and a.recovery_expires_at>now() and f.lease_expires_at>now()`,
      [input.applicationId, input.environment, input.recoveryId]
    );
    const row = result.rows[0];
    if (!row) fail("FENCE_REJECTED", "Static worker recovery authority is unavailable.");
    const current = row as DeploymentRow;
    const fence: FenceRow = {
      active_execution_generation: row.active_execution_generation,
      fencing_token: row.live_fencing_token,
      lease_owner: row.live_lease_owner,
      lease_expires_at: row.lease_expires_at,
      promotion_revision: row.live_promotion_revision
    };
    this.assertRecoveryTicketValue(input, row, current, fence);
  }

  async renewWorkerFence(input: Owner & Readonly<{ generationId: string; fencingToken: number; owner: string; expectedPromotionRevision: number; leaseDurationMs: number }>): Promise<WorkerGenerationFence> {
    assertOwner(input); assertFenceToken(input.fencingToken); assertRevision(input.expectedPromotionRevision); this.assertWorkerLeaseRenewal(input.owner, input.leaseDurationMs);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readFenceLocked(session, input);
      const databaseNow = await this.databaseNow(session);
      if (!current || current.active_execution_generation !== input.generationId || Number(current.fencing_token) !== input.fencingToken ||
        current.lease_owner !== input.owner || current.promotion_revision !== input.expectedPromotionRevision ||
        new Date(current.lease_expires_at).valueOf() <= databaseNow.valueOf()) {
        fail("FENCE_REJECTED", "Worker fence renewal authority is stale or expired.");
      }
      const requestedExpiry = databaseNow.valueOf() + input.leaseDurationMs;
      if (requestedExpiry <= new Date(current.lease_expires_at).valueOf()) {
        return this.fence(input, current);
      }
      const result = await session.query<FenceRow>(
        `update runtime_worker_generation_fences set lease_expires_at=now()+($6::integer*interval '1 millisecond'), updated_at=now()
         where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and lease_owner=$5
           and promotion_revision=$7 and lease_expires_at>now()
           and lease_expires_at<now()+($6::integer*interval '1 millisecond') returning *`,
        [input.applicationId, input.environment, input.generationId, input.fencingToken, input.owner, input.leaseDurationMs, input.expectedPromotionRevision]
      );
      if (!result.rows[0]) fail("FENCE_REJECTED", "Worker fence renewal authority is stale.");
      return this.fence(input, result.rows[0]);
    });
  }

  async claimEffect(input: Owner & Readonly<{ effectId: string; generationId: string; fencingToken: number; claimantId: string; claimLeaseDurationMs: number }>): Promise<Readonly<{ status: "claimed"; attempts: number; claimToken: string; externalIdempotencyKey: string }> | Readonly<{ status: "already-claimed" | "already-completed"; attempts: number; externalIdempotencyKey: string }>> {
    this.assertEffectInput(input);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const databaseNow = await this.databaseNow(session);
      const fence = await this.assertActiveFence(session, input, databaseNow);
      const claimLeaseExpiresAt = this.effectClaimExpiresAt(input, fence, databaseNow);
      const current = await session.query<EffectRow>(
        `select * from runtime_worker_effects where application_id=$1 and environment=$2 and effect_id=$3 for update`,
        [input.applicationId, input.environment, input.effectId]
      );
      const row = current.rows[0];
      const externalIdempotencyKey = effectIdempotencyKey(input);
      if (row?.state === "completed") return Object.freeze({ status: "already-completed", attempts: row.attempts, externalIdempotencyKey });
      if (row && row.claim_expires_at && new Date(row.claim_expires_at).valueOf() > databaseNow.valueOf()) {
        // A live claim remains with its original fence while that generation drains. It is never reassigned by a promotion.
        return Object.freeze({ status: "already-claimed", attempts: row.attempts, externalIdempotencyKey });
      }
      const claimToken = globalThis.crypto.randomUUID();
      const updated = row ? await session.query<EffectRow>(
        `update runtime_worker_effects set generation_id=$4, fencing_token=$5, claim_owner=$6, claim_token=$7, claim_expires_at=$8,
           attempts=attempts+1, updated_at=now()
         where application_id=$1 and environment=$2 and effect_id=$3 returning *`,
        [input.applicationId, input.environment, input.effectId, input.generationId, input.fencingToken, input.claimantId, claimToken, claimLeaseExpiresAt]
      ) : await session.query<EffectRow>(
        `insert into runtime_worker_effects (application_id, environment, effect_id, generation_id, fencing_token, claim_owner, claim_token, claim_expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [input.applicationId, input.environment, input.effectId, input.generationId, input.fencingToken, input.claimantId, claimToken, claimLeaseExpiresAt]
      );
      return Object.freeze({ status: "claimed", attempts: updated.rows[0]!.attempts, claimToken, externalIdempotencyKey });
    });
  }

  async completeEffect(input: Owner & Readonly<{ effectId: string; generationId: string; fencingToken: number; claimToken: string; resultDigest: string }>): Promise<Readonly<{ status: "completed" | "already-completed" }>> {
    this.assertEffectInput(input);
    if (!digestPattern.test(input.resultDigest) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.claimToken)) fail("INPUT_INVALID", "Worker effect completion claim is invalid.");
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const databaseNow = await this.databaseNow(session);
      const current = await session.query<EffectRow>(
        `select * from runtime_worker_effects where application_id=$1 and environment=$2 and effect_id=$3 for update`,
        [input.applicationId, input.environment, input.effectId]
      );
      const row = current.rows[0];
      if (!row) fail("EFFECT_CONFLICT", "Worker effect must be claimed before completion.");
      if (row.state === "completed") {
        if (row.result_digest !== input.resultDigest) fail("EFFECT_CONFLICT", "Completed worker effect cannot be rebound to a different result.");
        return Object.freeze({ status: "already-completed" });
      }
      const fence = await this.readFenceLocked(session, input);
      if (!fence || fence.active_execution_generation !== input.generationId || Number(fence.fencing_token) !== input.fencingToken ||
        new Date(fence.lease_expires_at).valueOf() <= databaseNow.valueOf()) fail("FENCE_REJECTED", "Worker generation is passive, stale, or lease-expired.");
      if (row.generation_id !== input.generationId || Number(row.fencing_token) !== input.fencingToken) fail("FENCE_REJECTED", "Worker effect claim belongs to a different execution fence.");
      if (row.claim_token !== input.claimToken || !row.claim_expires_at || new Date(row.claim_expires_at).valueOf() <= databaseNow.valueOf()) fail("EFFECT_CONFLICT", "Worker effect claim is not owned by this worker or has expired.");
      const updated = await session.query(
        `update runtime_worker_effects set state='completed', result_digest=$4, claim_owner=null, claim_token=null, claim_expires_at=null, updated_at=now()
         where application_id=$1 and environment=$2 and effect_id=$3 and state='pending' and claim_token=$5 and claim_expires_at > now() returning effect_id`,
        [input.applicationId, input.environment, input.effectId, input.resultDigest, input.claimToken]
      );
      if (!updated.rows[0]) fail("EFFECT_CONFLICT", "Worker effect completion raced another owner.");
      return Object.freeze({ status: "completed" });
    });
  }

  private parseChange(value: unknown): StaticCompositionChangePlan {
    try { return StaticCompositionChangePlanSchema.parse(value); } catch { fail("EVIDENCE_MISMATCH", "Static composition change evidence is invalid."); }
  }

  private parseEvidence(value: unknown): TrustedApplicationBuildEvidence {
    try { return TrustedApplicationBuildEvidenceSchema.parse(value); } catch { fail("EVIDENCE_MISMATCH", "Trusted build evidence is invalid."); }
  }

  private async targetGeneration(
    input: Owner & Readonly<{ generationId: string; readiness: StaticPromotionReadiness }>,
    change: StaticCompositionChangePlan,
    evidence: TrustedApplicationBuildEvidence
  ): Promise<StaticApplicationGeneration> {
    if (change.applicationId !== input.applicationId || change.environment !== input.environment || evidence.applicationId !== input.applicationId || evidence.environment !== input.environment ||
      evidence.sourceCommit !== change.target.sourceCommit || !same(evidence.composition, change.target.composition) ||
      evidence.applicationSubject.digest !== change.target.applicationSubjectDigest || evidence.imageSubject.digest !== change.target.imageSubjectDigest) {
      fail("EVIDENCE_MISMATCH", "Static source and build evidence do not identify the same target.");
    }
    if (change.migration.steps.some((step) => step.phase === "offline-required")) fail("MAINTENANCE_REQUIRED", "Offline migration work cannot enter zero-downtime promotion.");
    const runnable = change.migration.steps.filter((step) => step.phase === "online-expand" || step.phase === "online-backfill").map((step) => step.stepId).sort();
    const completed = [...input.readiness.completedMigrationSteps].sort();
    const observed = new Date(input.readiness.observedAt).valueOf();
    if (input.readiness.generationId !== input.generationId || input.readiness.sourceCommit !== change.target.sourceCommit ||
      input.readiness.applicationDigest !== evidence.applicationSubject.digest || input.readiness.imageDigest !== evidence.imageSubject.digest ||
      input.readiness.migrationRevision !== change.migration.targetRevision || !same(runnable, completed) || new Set(completed).size !== completed.length ||
      input.readiness.publicSmoke !== true || input.readiness.authenticatedSmoke !== true || input.readiness.inventoryReconciled !== true ||
      input.readiness.workerMode !== "passive" || input.readiness.gatewayCapacity !== true || input.readiness.realtimeReady !== true ||
      Number.isNaN(observed) || observed > this.clock.now().valueOf() || this.clock.now().valueOf() - observed > 300_000) {
      fail("READINESS_REJECTED", "Target readiness does not bind exact source/build/migration/inventory and passive-worker evidence.");
    }
    return Object.freeze({
      generationId: input.generationId,
      sourceCommit: change.target.sourceCommit,
      compositionChangePlanDigest: await sha256(change),
      buildEvidenceDigest: await sha256(evidence),
      applicationDigest: evidence.applicationSubject.digest,
      imageDigest: evidence.imageSubject.digest,
      imageReference: `${evidence.imageSubject.repository}@${evidence.imageSubject.digest}`,
      migrationRevision: change.migration.targetRevision
    });
  }

  private assertWorkerLease(owner: string, expiresAt: string): void {
    const expiry = new Date(expiresAt).valueOf();
    const now = this.clock.now().valueOf();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(owner) || Number.isNaN(expiry) || expiry <= now || expiry - now > 300_000) {
      fail("FENCE_REJECTED", "Worker execution lease is invalid or exceeds five minutes.");
    }
  }

  private assertWorkerLeaseRenewal(owner: string, leaseDurationMs: number): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(owner)) {
      fail("FENCE_REJECTED", "Worker execution lease is invalid.");
    }
    this.assertWorkerLeaseDuration(leaseDurationMs);
  }

  private assertWorkerLeaseDuration(leaseDurationMs: number): void {
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 300_000) fail("FENCE_REJECTED", "Worker execution lease duration is invalid.");
  }

  private async databaseNow(session: RuntimeExtensionSession): Promise<Date> {
    const result = await session.query<{ now: Date | string }>("select now() as now");
    const raw = result.rows[0]?.now;
    const value = raw === undefined ? Number.NaN : new Date(raw).valueOf();
    if (!Number.isFinite(value)) fail("FENCE_REJECTED", "Database clock is unavailable for worker authority.");
    return new Date(value);
  }

  private assertEffectInput(input: Owner & Readonly<{ effectId: string; generationId: string; fencingToken: number }>): void {
    assertOwner(input); assertFenceToken(input.fencingToken);
    if (!generationPattern.test(input.generationId) || !/^[a-z][a-z0-9-]{2,127}$/u.test(input.effectId)) fail("INPUT_INVALID", "Worker effect identity is invalid.");
  }

  private effectClaimExpiresAt(input: Readonly<{ claimantId: string; claimLeaseDurationMs: number }>, fence: FenceRow, now: Date): string {
    const fenceExpiresAt = new Date(fence.lease_expires_at).valueOf();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(input.claimantId) || !Number.isSafeInteger(input.claimLeaseDurationMs) ||
      input.claimLeaseDurationMs < 250 || input.claimLeaseDurationMs > 300_000 || now.valueOf() + input.claimLeaseDurationMs > fenceExpiresAt) {
      fail("EFFECT_CONFLICT", "Worker effect claim lease is invalid or exceeds active worker authority.");
    }
    return new Date(now.valueOf() + input.claimLeaseDurationMs).toISOString();
  }

  private async assertActiveFence(session: RuntimeExtensionSession, input: Owner & Readonly<{ generationId: string; fencingToken: number }>, now: Date): Promise<FenceRow> {
    const fence = await this.readFenceLocked(session, input);
    if (!fence || fence.active_execution_generation !== input.generationId || Number(fence.fencing_token) !== input.fencingToken ||
      new Date(fence.lease_expires_at).valueOf() <= now.valueOf()) fail("FENCE_REJECTED", "Worker generation is passive, stale, or lease-expired.");
    return fence;
  }

  private assertTransitionTicketValue(input: StaticDeploymentTransitionTicket, checkpoint: StaticDeploymentTransitionCheckpoint, fence: FenceRow | undefined): void {
    const expectedGenerationId = input.step === "activate-worker" || input.step === "converge-gateway" || input.step === "reconnect-realtime"
      ? checkpoint.activeGenerationId
      : checkpoint.previousGenerationId;
    if (!fence || input.activeGenerationId !== checkpoint.activeGenerationId || input.generationId !== expectedGenerationId ||
      input.revision !== checkpoint.revision || input.checkpointKind !== checkpoint.kind || input.fencingToken !== Number(fence.fencing_token) ||
      input.promotionRevision !== fence.promotion_revision || input.leaseOwner !== fence.lease_owner ||
      fence.active_execution_generation !== checkpoint.activeGenerationId || checkpoint.reservationId !== input.reservationId ||
      checkpoint.reservedStep !== input.step || checkpoint.reservationExpiresAt !== input.reservationExpiresAt || Date.parse(input.reservationExpiresAt) <= this.clock.now().valueOf()) {
      fail("FENCE_REJECTED", "Static deployment transition authority is stale.");
    }
  }

  private fence(owner: Owner, row: FenceRow): WorkerGenerationFence {
    return WorkerGenerationFenceSchema.parse({
      schemaVersion: 1,
      applicationId: owner.applicationId,
      environment: owner.environment,
      activeExecutionGeneration: row.active_execution_generation,
      fencingToken: Number(row.fencing_token),
      lease: { owner: row.lease_owner, expiresAt: new Date(row.lease_expires_at).toISOString() },
      promotionRevision: row.promotion_revision,
      mode: "active"
    });
  }

  private async commitTransition(
    session: RuntimeExtensionSession,
    owner: Owner,
    current: DeploymentRow,
    fence: FenceRow,
    active: StaticApplicationGeneration,
    rollback: StaticApplicationGeneration | null,
    rollbackWindow: Record<string, unknown>,
    receipt: StaticDeploymentReceipt,
    workerOwner: string,
    workerLeaseExpiresAt: string,
    checkpointKind: StaticDeploymentTransitionCheckpoint["kind"] = receipt.operation === "promote" ? "promote" : "rollback",
    previousGenerationId: string = rollback?.generationId ?? fail("INPUT_INVALID", "Static transition has no prior generation.")
  ): Promise<void> {
    const revision = receipt.revisionAfter;
    const token = receipt.workerFencingToken;
    const checkpoint: StaticDeploymentTransitionCheckpoint = {
      kind: checkpointKind,
      revision,
      activeGenerationId: active.generationId,
      previousGenerationId,
      completedSteps: []
    };
    const stateDigest = await sha256({ revision, active, rollback, rollbackWindow, transitionCheckpoint: checkpoint });
    const updated = await session.query(
      `update runtime_static_deployments set revision=$3, active_generation_id=$4, active_generation=$5::jsonb,
         rollback_generation_id=$6, rollback_generation=$7::jsonb, rollback_window=$8::jsonb, transition_checkpoint=$9::jsonb, state_digest=$10, updated_at=now()
       where application_id=$1 and environment=$2 and revision=$11 returning revision`,
      [owner.applicationId, owner.environment, revision, active.generationId, JSON.stringify(active), rollback?.generationId ?? null, rollback ? JSON.stringify(rollback) : null, JSON.stringify(rollbackWindow), JSON.stringify(checkpoint), stateDigest, current.revision]
    );
    if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment changed before promotion commit.");
    const transferred = await session.query(
      `update runtime_worker_generation_fences set active_execution_generation=$3, fencing_token=$4,
         lease_owner=$5, lease_expires_at=$6, promotion_revision=$7, updated_at=now()
       where application_id=$1 and environment=$2 and fencing_token=$8 returning fencing_token`,
      [owner.applicationId, owner.environment, active.generationId, token, workerOwner, workerLeaseExpiresAt, revision, Number(fence.fencing_token)]
    );
    if (!transferred.rows[0]) fail("FENCE_REJECTED", "Worker execution fence changed before promotion commit.");
    await this.outbox(session, owner, receipt);
  }

  private async outbox(session: RuntimeExtensionSession, owner: Owner, receipt: StaticDeploymentReceipt): Promise<void> {
    await session.query(
      `insert into runtime_static_deployment_outbox (event_id, application_id, environment, revision, event_json)
       values ($1,$2,$3,$4,$5::jsonb)`,
      [receipt.receiptId, owner.applicationId, owner.environment, receipt.revisionAfter, JSON.stringify(receipt)]
    );
  }

  private async readReserveReceipt(session: RuntimeExtensionSession, owner: Owner, current: DeploymentRow): Promise<StaticDeploymentReceipt> {
    const result = await session.query<{ event_json: unknown }>(
      `select event_json from runtime_static_deployment_outbox where application_id=$1 and environment=$2 and revision=$3`,
      [owner.applicationId, owner.environment, current.revision]
    );
    try {
      const receipt = StaticDeploymentReceiptSchema.parse(result.rows[0]?.event_json);
      if (receipt.operation !== "reserve-rollback-retirement") throw new Error("wrong receipt");
      return Object.freeze(receipt);
    } catch { fail("REVISION_CONFLICT", "Rollback retirement reservation is missing its authoritative receipt."); }
  }

  private async readCloseReceipt(session: RuntimeExtensionSession, owner: Owner, current: DeploymentRow): Promise<StaticDeploymentReceipt> {
    const result = await session.query<{ event_json: unknown }>(
      `select event_json from runtime_static_deployment_outbox where application_id=$1 and environment=$2 and revision=$3`,
      [owner.applicationId, owner.environment, current.revision]
    );
    try {
      const receipt = StaticDeploymentReceiptSchema.parse(result.rows[0]?.event_json);
      if (receipt.operation !== "close-rollback") throw new Error("wrong receipt");
      return Object.freeze(receipt);
    } catch { fail("REVISION_CONFLICT", "Rollback closure is missing its authoritative receipt."); }
  }

  private async lock(session: RuntimeExtensionSession, owner: Owner): Promise<void> {
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([owner.applicationId, owner.environment, "static-deployment"])]);
  }

  private async readLocked(session: RuntimeExtensionSession, owner: Owner): Promise<DeploymentRow | undefined> {
    const result = await session.query<DeploymentRow>(
      `select * from runtime_static_deployments where application_id=$1 and environment=$2 for update`,
      [owner.applicationId, owner.environment]
    );
    return result.rows[0];
  }

  private async readFenceLocked(session: RuntimeExtensionSession, owner: Owner): Promise<FenceRow | undefined> {
    const result = await session.query<FenceRow>(
      `select * from runtime_worker_generation_fences where application_id=$1 and environment=$2 for update`,
      [owner.applicationId, owner.environment]
    );
    return result.rows[0];
  }

  private async readRetirementLocked(session: RuntimeExtensionSession, owner: Owner, generationId: string): Promise<RetirementRow | undefined> {
    const result = await session.query<RetirementRow>(
      `select * from runtime_static_generation_retirements where application_id=$1 and environment=$2 and generation_id=$3 for update`,
      [owner.applicationId, owner.environment, generationId]
    );
    return result.rows[0];
  }

  private async readLiveWorkerRecoveryLocked(session: RuntimeExtensionSession, owner: Owner): Promise<WorkerRecoveryActivationRow | undefined> {
    const result = await session.query<WorkerRecoveryActivationRow>(
      `select * from runtime_static_worker_activations
       where application_id=$1 and environment=$2 and state='reserved'
       order by reserved_at desc limit 1 for update`,
      [owner.applicationId, owner.environment]
    );
    return result.rows[0];
  }

  private async hasWorkerRecoveryHistoryLocked(session: RuntimeExtensionSession, owner: Owner): Promise<boolean> {
    const result = await session.query<{ exists: boolean }>(
      `select exists(select 1 from runtime_static_worker_activations where application_id=$1 and environment=$2) as exists`,
      [owner.applicationId, owner.environment]
    );
    return result.rows[0]?.exists === true;
  }

  private async assertNoLiveWorkerRecovery(session: RuntimeExtensionSession, owner: Owner): Promise<void> {
    const row = await this.readLiveWorkerRecoveryLocked(session, owner);
    if (row && new Date(row.recovery_expires_at).valueOf() > (await this.databaseNow(session)).valueOf()) {
      fail("REVISION_CONFLICT", "Static worker recovery activation is still in progress.");
    }
  }

  private async readWorkerRecoveryLocked(session: RuntimeExtensionSession, input: StaticWorkerRecoveryActivationTicket): Promise<WorkerRecoveryActivationRow | undefined> {
    const result = await session.query<WorkerRecoveryActivationRow>(
      `select * from runtime_static_worker_activations where application_id=$1 and environment=$2 and recovery_id=$3 for update`,
      [input.applicationId, input.environment, input.recoveryId]
    );
    return result.rows[0];
  }

  private assertRecoveryAuthority(row: WorkerRecoveryActivationRow, current: DeploymentRow, fence: FenceRow): void {
    if (row.generation_id !== current.active_generation_id || row.deployment_revision !== current.revision ||
      Number(row.fencing_token) !== Number(fence.fencing_token) || row.promotion_revision !== fence.promotion_revision ||
      row.lease_owner !== fence.lease_owner || fence.active_execution_generation !== current.active_generation_id) {
      fail("FENCE_REJECTED", "Static worker recovery authority no longer matches the active deployment.");
    }
  }

  private assertRecoveryTicketInput(input: StaticWorkerRecoveryActivationTicket): void {
    assertOwner(input); assertRevision(input.revision); assertFenceToken(input.fencingToken); assertRevision(input.promotionRevision);
    if (!generationPattern.test(input.generationId) || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(input.leaseOwner) ||
      !Number.isFinite(Date.parse(input.recoveryExpiresAt))) fail("INPUT_INVALID", "Static worker recovery ticket is invalid.");
    this.assertWorkerLeaseDuration(input.executionLeaseDurationMs);
    assertRecoveryId(input.recoveryId);
  }

  private assertRecoveryTicketValue(input: StaticWorkerRecoveryActivationTicket, row: WorkerRecoveryActivationRow, current: DeploymentRow, fence: FenceRow): void {
    this.assertRecoveryAuthority(row, current, fence);
    if (row.state !== "reserved" || row.recovery_id !== input.recoveryId || row.generation_id !== input.generationId ||
      row.deployment_revision !== input.revision || Number(row.fencing_token) !== input.fencingToken ||
      row.promotion_revision !== input.promotionRevision || row.lease_owner !== input.leaseOwner || row.execution_lease_duration_ms !== input.executionLeaseDurationMs ||
      new Date(row.recovery_expires_at).toISOString() !== input.recoveryExpiresAt ||
      !Number.isFinite(Date.parse(input.recoveryExpiresAt))) {
      fail("FENCE_REJECTED", "Static worker recovery authority is stale.");
    }
  }

  private recoveryTicket(row: WorkerRecoveryActivationRow): StaticWorkerRecoveryActivationTicket {
    if (!generationPattern.test(row.generation_id) || !["reserved", "completed", "expired"].includes(row.state) ||
      !Number.isSafeInteger(row.deployment_revision) || !Number.isSafeInteger(Number(row.fencing_token)) ||
      !Number.isSafeInteger(row.promotion_revision) || !Number.isSafeInteger(row.execution_lease_duration_ms) || row.execution_lease_duration_ms < 1_000 || row.execution_lease_duration_ms > 300_000 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(row.lease_owner)) {
      fail("EVIDENCE_MISMATCH", "Static worker recovery record is invalid.");
    }
    assertRecoveryId(row.recovery_id);
    return Object.freeze({
      applicationId: row.application_id,
      environment: row.environment,
      generationId: row.generation_id,
      revision: row.deployment_revision,
      fencingToken: Number(row.fencing_token),
      promotionRevision: row.promotion_revision,
      leaseOwner: row.lease_owner,
      executionLeaseDurationMs: row.execution_lease_duration_ms,
      recoveryId: row.recovery_id,
      recoveryExpiresAt: new Date(row.recovery_expires_at).toISOString()
    });
  }

  private retirement(row: RetirementRow): StaticGenerationRetirementReservation {
    const reservedAt = new Date(row.reserved_at).toISOString();
    const completedAt = row.completed_at ? new Date(row.completed_at).toISOString() : undefined;
    if (!generationPattern.test(row.generation_id) || !["reserved", "completed"].includes(row.state) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.reservation_id) ||
      !Number.isFinite(Date.parse(reservedAt)) || (row.state === "completed") !== (completedAt !== undefined)) {
      fail("EVIDENCE_MISMATCH", "Static generation retirement evidence is invalid.");
    }
    return Object.freeze({
      applicationId: row.application_id,
      environment: row.environment,
      generationId: row.generation_id,
      reservationId: row.reservation_id,
      reservedAt,
      ...(completedAt ? { completedAt } : {})
    });
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const result = await work(session);
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }
}
