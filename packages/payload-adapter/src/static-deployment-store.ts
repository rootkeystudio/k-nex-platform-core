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
import type {
  StaticApplicationGeneration,
  StaticDeploymentSnapshot,
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

function timestamp(clock: RuntimeExtensionClock): string {
  const value = clock.now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail("INPUT_INVALID", "Static deployment clock is invalid.");
  return value.toISOString();
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function snapshot(owner: Owner, row: DeploymentRow): StaticDeploymentSnapshot {
  return Object.freeze({
    ...owner,
    revision: row.revision,
    active: Object.freeze(structuredClone(row.active_generation)),
    ...(row.rollback_generation ? { rollback: Object.freeze(structuredClone(row.rollback_generation)) } : {}),
    rollbackWindow: Object.freeze(structuredClone(row.rollback_window)),
    stateDigest: row.state_digest
  });
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
      const state = { revision: 0, active: input.generation, rollback: null, rollbackWindow: { state: "not-applicable", contractCleanup: "blocked" } };
      const stateDigest = await sha256(state);
      await session.query(
        `insert into runtime_static_deployments (
           application_id, environment, revision, active_generation_id, active_generation, rollback_window, state_digest
         ) values ($1,$2,0,$3,$4::jsonb,$5::jsonb,$6) on conflict do nothing`,
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

  async promote(input: Owner & Readonly<{
    expectedRevision: number;
    expectedFenceToken: number;
    generationId: string;
    workerOwner: string;
    workerLeaseExpiresAt: string;
    build: VerifiedStaticApplicationBuild;
    readiness: StaticPromotionReadiness;
  }>): Promise<StaticDeploymentReceipt> {
    assertOwner(input); assertRevision(input.expectedRevision); assertFenceToken(input.expectedFenceToken);
    if (!generationPattern.test(input.generationId)) fail("INPUT_INVALID", "Target static generation identity is invalid.");
    this.assertWorkerLease(input.workerOwner, input.workerLeaseExpiresAt);
    const verified = this.builds.read(input.build);
    const change = this.parseChange(verified.change.change);
    const evidence = this.parseEvidence(verified.evidence);
    const generation = await this.targetGeneration(input, change, evidence);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Static deployment revision changed before promotion.");
      if (current.active_generation.sourceCommit !== change.base.sourceCommit || current.active_generation.migrationRevision !== change.migration.baseRevision) {
        fail("EVIDENCE_MISMATCH", "Static deployment no longer matches the authorized base source and migration revision.");
      }
      if (!fence || Number(fence.fencing_token) !== input.expectedFenceToken || fence.active_execution_generation !== current.active_generation_id) {
        fail("FENCE_REJECTED", "Worker execution authority changed before promotion.");
      }
      if (change.migration.rollbackWindow.state !== "open") fail("READINESS_REJECTED", "Zero-downtime promotion requires an explicit compatible rollback window.");
      const revision = current.revision + 1;
      const token = Number(fence.fencing_token) + 1;
      const rollbackWindow = change.migration.rollbackWindow;
      const stateDigest = await sha256({ revision, active: generation, rollback: current.active_generation, rollbackWindow });
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1,
        receiptId: `static-promotion-${revision}`,
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
        rollbackWindow: { state: "open", windowId: rollbackWindow.windowId, closesAt: rollbackWindow.closesAt },
        contractCleanup: "blocked",
        occurredAt: timestamp(this.clock)
      });
      await this.commitTransition(session, input, current, fence, generation, current.active_generation, rollbackWindow, receipt, input.workerOwner, input.workerLeaseExpiresAt, stateDigest);
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
      if (!current.rollback_generation || !current.rollback_generation_id || current.rollback_window.state !== "open") fail("ROLLBACK_UNAVAILABLE", "No compatible static generation is retained for rollback.");
      if (new Date(String(current.rollback_window.closesAt)).valueOf() <= this.clock.now().valueOf()) fail("ROLLBACK_UNAVAILABLE", "Static deployment rollback window has expired.");
      if (!fence || Number(fence.fencing_token) !== input.expectedFenceToken || fence.active_execution_generation !== current.active_generation_id) fail("FENCE_REJECTED", "Worker execution authority changed before rollback.");
      const revision = current.revision + 1;
      const token = Number(fence.fencing_token) + 1;
      const target = current.rollback_generation;
      const stateDigest = await sha256({ revision, active: target, rollback: current.active_generation, rollbackWindow: current.rollback_window });
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1,
        receiptId: `static-rollback-${revision}`,
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
      await this.commitTransition(session, input, current, fence, target, current.active_generation, current.rollback_window, receipt, input.workerOwner, input.workerLeaseExpiresAt, stateDigest);
      return Object.freeze(receipt);
    });
  }

  async closeRollback(input: Owner & Readonly<{ expectedRevision: number; retiredGenerationId: string }>): Promise<StaticDeploymentReceipt> {
    assertOwner(input); assertRevision(input.expectedRevision);
    return this.transaction(async (session) => {
      await this.lock(session, input);
      const current = await this.readLocked(session, input);
      const fence = await this.readFenceLocked(session, input);
      if (!current || current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Static deployment revision changed before rollback closure.");
      if (!current.rollback_generation || current.rollback_generation_id !== input.retiredGenerationId || current.rollback_window.state !== "open") {
        fail("CONTRACT_CLEANUP_BLOCKED", "The retained rollback generation has not been explicitly retired.");
      }
      if (!fence) fail("FENCE_REJECTED", "Worker execution fence is unavailable.");
      const revision = current.revision + 1;
      const closedAt = timestamp(this.clock);
      const rollbackWindow = { state: "closed", windowId: current.rollback_window.windowId, closedAt, contractCleanup: "eligible" };
      const stateDigest = await sha256({ revision, active: current.active_generation, rollback: null, rollbackWindow });
      const receipt = StaticDeploymentReceiptSchema.parse({
        schemaVersion: 1,
        receiptId: `static-rollback-close-${revision}`,
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
           rollback_window=$4::jsonb, state_digest=$5, updated_at=now()
         where application_id=$1 and environment=$2 and revision=$6 returning revision`,
        [input.applicationId, input.environment, revision, JSON.stringify(rollbackWindow), stateDigest, current.revision]
      );
      if (!updated.rows[0]) fail("REVISION_CONFLICT", "Static deployment changed before rollback closure commit.");
      await this.outbox(session, input, receipt);
      return Object.freeze(receipt);
    });
  }

  async assertContractCleanup(owner: Owner): Promise<void> {
    const value = await this.read(owner);
    if (!value || value.rollback || value.rollbackWindow.state !== "closed" || value.rollbackWindow.contractCleanup !== "eligible") {
      fail("CONTRACT_CLEANUP_BLOCKED", "Post-retirement contract work requires a closed rollback window and retired old generation.");
    }
  }

  async renewWorkerFence(input: Owner & Readonly<{ generationId: string; fencingToken: number; owner: string; expiresAt: string }>): Promise<WorkerGenerationFence> {
    assertOwner(input); assertFenceToken(input.fencingToken); this.assertWorkerLease(input.owner, input.expiresAt);
    return this.transaction(async (session) => {
      const result = await session.query<FenceRow>(
        `update runtime_worker_generation_fences set lease_expires_at=$6, updated_at=now()
         where application_id=$1 and environment=$2 and active_execution_generation=$3 and fencing_token=$4 and lease_owner=$5 returning *`,
        [input.applicationId, input.environment, input.generationId, input.fencingToken, input.owner, input.expiresAt]
      );
      if (!result.rows[0]) fail("FENCE_REJECTED", "Worker fence renewal authority is stale.");
      return this.fence(input, result.rows[0]);
    });
  }

  async claimEffect(input: Owner & Readonly<{ effectId: string; generationId: string; fencingToken: number; claimantId: string; claimLeaseExpiresAt: string }>): Promise<Readonly<{ status: "claimed"; attempts: number; claimToken: string }> | Readonly<{ status: "already-claimed" | "already-completed"; attempts: number }>> {
    this.assertEffectInput(input);
    return this.transaction(async (session) => {
      const fence = await this.assertActiveFence(session, input);
      this.assertEffectClaimLease(input, fence);
      const current = await session.query<EffectRow>(
        `select * from runtime_worker_effects where application_id=$1 and environment=$2 and effect_id=$3 for update`,
        [input.applicationId, input.environment, input.effectId]
      );
      const row = current.rows[0];
      if (row?.state === "completed") return Object.freeze({ status: "already-completed", attempts: row.attempts });
      if (row && row.generation_id === input.generationId && Number(row.fencing_token) === input.fencingToken &&
        row.claim_expires_at && new Date(row.claim_expires_at).valueOf() > this.clock.now().valueOf()) {
        return Object.freeze({ status: "already-claimed", attempts: row.attempts });
      }
      const claimToken = globalThis.crypto.randomUUID();
      const updated = row ? await session.query<EffectRow>(
        `update runtime_worker_effects set generation_id=$4, fencing_token=$5, claim_owner=$6, claim_token=$7, claim_expires_at=$8,
           attempts=attempts+1, updated_at=now()
         where application_id=$1 and environment=$2 and effect_id=$3 returning *`,
        [input.applicationId, input.environment, input.effectId, input.generationId, input.fencingToken, input.claimantId, claimToken, input.claimLeaseExpiresAt]
      ) : await session.query<EffectRow>(
        `insert into runtime_worker_effects (application_id, environment, effect_id, generation_id, fencing_token, claim_owner, claim_token, claim_expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [input.applicationId, input.environment, input.effectId, input.generationId, input.fencingToken, input.claimantId, claimToken, input.claimLeaseExpiresAt]
      );
      return Object.freeze({ status: "claimed", attempts: updated.rows[0]!.attempts, claimToken });
    });
  }

  async completeEffect(input: Owner & Readonly<{ effectId: string; generationId: string; fencingToken: number; claimToken: string; resultDigest: string }>): Promise<Readonly<{ status: "completed" | "already-completed" }>> {
    this.assertEffectInput(input);
    if (!digestPattern.test(input.resultDigest) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.claimToken)) fail("INPUT_INVALID", "Worker effect completion claim is invalid.");
    return this.transaction(async (session) => {
      await this.assertActiveFence(session, input);
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
      if (row.generation_id !== input.generationId || Number(row.fencing_token) !== input.fencingToken) fail("FENCE_REJECTED", "Worker effect claim belongs to a stale execution fence.");
      if (row.claim_token !== input.claimToken || !row.claim_expires_at || new Date(row.claim_expires_at).valueOf() <= this.clock.now().valueOf()) fail("EFFECT_CONFLICT", "Worker effect claim is not owned by this worker or has expired.");
      const updated = await session.query(
        `update runtime_worker_effects set state='completed', result_digest=$4, claim_owner=null, claim_token=null, claim_expires_at=null, updated_at=now()
         where application_id=$1 and environment=$2 and effect_id=$3 and state='pending' and claim_token=$5 returning effect_id`,
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

  private assertEffectInput(input: Owner & Readonly<{ effectId: string; generationId: string; fencingToken: number }>): void {
    assertOwner(input); assertFenceToken(input.fencingToken);
    if (!generationPattern.test(input.generationId) || !/^[a-z][a-z0-9-]{2,127}$/u.test(input.effectId)) fail("INPUT_INVALID", "Worker effect identity is invalid.");
  }

  private assertEffectClaimLease(input: Readonly<{ claimantId: string; claimLeaseExpiresAt: string }>, fence: FenceRow): void {
    const expiresAt = new Date(input.claimLeaseExpiresAt).valueOf();
    const fenceExpiresAt = new Date(fence.lease_expires_at).valueOf();
    const now = this.clock.now().valueOf();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(input.claimantId) || Number.isNaN(expiresAt) || expiresAt <= now || expiresAt > fenceExpiresAt || expiresAt - now > 300_000) {
      fail("EFFECT_CONFLICT", "Worker effect claim lease is invalid or exceeds active worker authority.");
    }
  }

  private async assertActiveFence(session: RuntimeExtensionSession, input: Owner & Readonly<{ generationId: string; fencingToken: number }>): Promise<FenceRow> {
    const fence = await this.readFenceLocked(session, input);
    if (!fence || fence.active_execution_generation !== input.generationId || Number(fence.fencing_token) !== input.fencingToken ||
      new Date(fence.lease_expires_at).valueOf() <= this.clock.now().valueOf()) fail("FENCE_REJECTED", "Worker generation is passive, stale, or lease-expired.");
    return fence;
  }

  private fence(owner: Owner, row: FenceRow): WorkerGenerationFence {
    return WorkerGenerationFenceSchema.parse({
      schemaVersion: 1,
      ...owner,
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
    rollback: StaticApplicationGeneration,
    rollbackWindow: Record<string, unknown>,
    receipt: StaticDeploymentReceipt,
    workerOwner: string,
    workerLeaseExpiresAt: string,
    stateDigest: string
  ): Promise<void> {
    const revision = receipt.revisionAfter;
    const token = receipt.workerFencingToken;
    const updated = await session.query(
      `update runtime_static_deployments set revision=$3, active_generation_id=$4, active_generation=$5::jsonb,
         rollback_generation_id=$6, rollback_generation=$7::jsonb, rollback_window=$8::jsonb, state_digest=$9, updated_at=now()
       where application_id=$1 and environment=$2 and revision=$10 returning revision`,
      [owner.applicationId, owner.environment, revision, active.generationId, JSON.stringify(active), rollback.generationId, JSON.stringify(rollback), JSON.stringify(rollbackWindow), stateDigest, current.revision]
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
