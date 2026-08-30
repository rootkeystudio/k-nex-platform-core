import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  compareExactSemverPrecedence,
  ExactSemverSchema,
  ExtensionLifecycleEventSchema,
  ExtensionSecurityQuarantineEventSchema,
  RuntimeExtensionInventorySchema,
  type ExtensionLifecycleEvent,
  type RuntimeExtensionInventory,
  type StaticDeploymentReceipt
} from "@k-nex/contracts";
import type {
  ClaimOperationResult,
  ExtensionActivationReceipt,
  ExtensionDispositionReceipt,
  ExtensionRunnerQuarantineReceipt,
  ExtensionSecurityQuarantineReceipt,
  ExtensionManagerReceipt,
  ExtensionOperationPhase,
  PluginManagerPlan,
  RuntimeExtensionOperation,
  RuntimeExtensionStore,
  RunnerQuarantineReason,
  StagedGenerationActivation,
  VerifiedGenerationAuthority
} from "@k-nex/runtime";

export interface RuntimeExtensionQueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount?: number | null;
}

export interface RuntimeExtensionSession {
  query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<RuntimeExtensionQueryResult<T>>;
  release(): void;
}

export interface RuntimeExtensionPool {
  connect(): Promise<RuntimeExtensionSession>;
  query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<RuntimeExtensionQueryResult<T>>;
}

export interface RuntimeExtensionClock {
  now(): Date;
}

export class RuntimeExtensionStoreError extends Error {
  constructor(readonly code: "REVISION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "OPERATION_IN_PROGRESS" | "OPERATION_NOT_FOUND" | "LEASE_CONFLICT" | "PHASE_CONFLICT" | "GLOBAL_BUDGET_EXHAUSTED" | "GENERATION_MISMATCH" | "VERSION_DOWNGRADE" | "READINESS_EXPIRED" | "ROLLBACK_BLOCKED" | "REFERENCE_CONFLICT" | "STATE_INVALID", message: string) {
    super(message);
    this.name = "RuntimeExtensionStoreError";
  }
}

interface OperationRow {
  operation_id: string;
  application_id: string;
  environment: string;
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  operation_kind: RuntimeExtensionOperation["request"]["operation"];
  request_digest: string;
  request_json: RuntimeExtensionOperation["request"];
  authorization_json: RuntimeExtensionOperation["authorization"];
  expected_revision: number;
  phase: ExtensionOperationPhase;
  lease_owner: string;
  lease_token: string;
  lease_expires_at: Date | string;
  plan_json: PluginManagerPlan | null;
  authority_json: VerifiedGenerationAuthority | null;
  result_json: ExtensionManagerReceipt | null;
}

interface ExtensionRow {
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  revision: number;
  disposition: "active" | "disabled" | "quarantined" | "retirement-pending" | "removed";
  active_generation_id: string | null;
  rollback_generation_id: string | null;
  active_generation: Record<string, unknown> | null;
  rollback_generation: Record<string, unknown> | null;
  rollback_compatibility_json: StagedGenerationActivation["compatibility"] | null;
  retained_generation: Record<string, unknown> | null;
  last_operation_id: string | null;
  last_receipt_id: string | null;
  state_digest: string | null;
  inventory_revision: number;
}

interface GenerationRow {
  generation_id: string;
  version: string;
  authority_json: VerifiedGenerationAuthority;
  authority_digest: string;
  state: "staged" | "warming" | "active" | "rollback" | "retired";
  server_generation_id: string | null;
  ui_generation_id: string | null;
  storage_generation_id: string | null;
  activation_json: Readonly<{ metadata: Record<string, unknown>; settings: Record<string, unknown>; storageSchemaVersions: Record<string, number> }> | null;
  compatibility_json: StagedGenerationActivation["compatibility"] | null;
  readiness_token: string | null;
  readiness_expires_at: Date | string | null;
  staged_revision: number | null;
  receipt_id: string | null;
}

function fail(code: RuntimeExtensionStoreError["code"], message: string): never {
  throw new RuntimeExtensionStoreError(code, message);
}

function operation(row: OperationRow): RuntimeExtensionOperation {
  return Object.freeze({
    operationId: row.operation_id,
    request: Object.freeze(row.request_json),
    requestDigest: row.request_digest,
    authorization: Object.freeze(row.authorization_json),
    phase: row.phase,
    leaseToken: row.lease_token,
    ...(row.plan_json ? { plan: Object.freeze(row.plan_json) } : {}),
    ...(row.authority_json ? { authority: Object.freeze(row.authority_json) } : {}),
    ...(row.result_json ? { result: Object.freeze(row.result_json) } : {})
  });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function timestamp(clock: RuntimeExtensionClock): string {
  const now = clock.now();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail("STATE_INVALID", "Runtime extension clock is invalid.");
  return now.toISOString();
}

function validRecordId(value: string): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(value);
}

function assertStage(stage: StagedGenerationActivation, now: Date): void {
  const readiness = stage.readiness;
  const readyAt = new Date(readiness.readyAt);
  const expiresAt = new Date(readiness.expiresAt);
  const identities = [readiness.generationId, readiness.serverGenerationId, readiness.uiGenerationId, readiness.storageGenerationId];
  if (!identities.every((identity) => identity === stage.authority.generationId) || !validRecordId(stage.authority.generationId)) {
    fail("GENERATION_MISMATCH", "Server, UI, storage, and artifact generation identities must match.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(readiness.leaseToken) || Number.isNaN(readyAt.valueOf()) || Number.isNaN(expiresAt.valueOf()) ||
    readyAt.valueOf() > now.valueOf() || expiresAt.valueOf() <= now.valueOf() || expiresAt.valueOf() - now.valueOf() > 300_000) {
    fail("READINESS_EXPIRED", "Generation readiness lease is invalid or expired.");
  }
  if (!ExactSemverSchema.safeParse(stage.version).success) fail("STATE_INVALID", "Generation version is invalid.");
  const activationBytes = new TextEncoder().encode(canonicalJson({ metadata: stage.metadata, settings: stage.settings, storageSchemaVersions: stage.storageSchemaVersions })).byteLength;
  if (Object.keys(stage.metadata).length > 128 || Object.keys(stage.settings).length > 128 || Object.keys(stage.storageSchemaVersions).length > 128 || activationBytes > 131_072 ||
    Object.values(stage.storageSchemaVersions).some((revision) => !Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000_000)) {
    fail("STATE_INVALID", "Generation activation changes exceed their bounded contract.");
  }
  const compatibility = stage.compatibility;
  if (!/^sha256:[0-9a-f]{64}$/u.test(compatibility.migrationDigest) || !Number.isSafeInteger(compatibility.dataRevision) || compatibility.dataRevision < 0 || compatibility.dataRevision > 1_000_000_000 ||
    (compatibility.status === "compatible" && (!validRecordId(compatibility.windowId) || new Date(compatibility.closesAt).valueOf() <= now.valueOf())) ||
    (compatibility.status === "irreversible" && (!validRecordId(compatibility.decisionId) || compatibility.reason.length < 1 || compatibility.reason.length > 512))) {
    fail("STATE_INVALID", "Generation migration compatibility record is invalid.");
  }
}

function evidenceIds(row: OperationRow, revision: number) {
  const suffix = `${row.operation_id.slice("operation-".length)}-${revision}`;
  return { receiptId: `receipt-${suffix}`, auditId: `audit-${suffix}`, eventId: `event-${suffix}` };
}

function operationId(requestDigest: string): string {
  return `operation-${requestDigest.slice("sha256:".length, "sha256:".length + 32)}`;
}

export interface RuntimeExtensionIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly deliveryClass: "platform-plugin" | "hot-application" | "theme-skin";
  readonly extensionId: string;
}

export function runtimeExtensionIdentityKey(identity: RuntimeExtensionIdentity): string {
  return canonicalJson([identity.applicationId, identity.environment, identity.deliveryClass, identity.extensionId]);
}

function identityKey(row: Pick<OperationRow, "application_id" | "environment" | "delivery_class" | "extension_id">): string {
  return runtimeExtensionIdentityKey({
    applicationId: row.application_id,
    environment: row.environment,
    deliveryClass: row.delivery_class,
    extensionId: row.extension_id
  });
}

function assertAuthorityOwner(row: Pick<OperationRow, "application_id" | "environment" | "delivery_class" | "extension_id">, authority: VerifiedGenerationAuthority): void {
  if (row.delivery_class === "platform-plugin" || authority.applicationId !== row.application_id || authority.environment !== row.environment ||
    authority.deliveryClass !== row.delivery_class || authority.extensionId !== row.extension_id) {
    fail("GENERATION_MISMATCH", "Verified generation authority belongs to a different runtime extension owner.");
  }
}

function stateCurrentGenerationId(state: ExtensionRow): string | undefined {
  if (state.active_generation_id) return state.active_generation_id;
  const retained = state.retained_generation?.["generationId"];
  return typeof retained === "string" ? retained : undefined;
}

function assertPlanIdentity(row: OperationRow, plan: PluginManagerPlan, state: ExtensionRow): void {
  const planned = plan.plan;
  const currentGenerationId = stateCurrentGenerationId(state);
  if (plan.operationId !== row.operation_id || planned.operationId !== row.operation_id || planned.operation !== row.operation_kind ||
    planned.deliveryClass !== row.delivery_class || planned.id !== row.extension_id || planned.expectedRevision !== row.expected_revision ||
    planned.currentGenerationId !== currentGenerationId || planned.targetGenerationId !== plan.generationId) {
    fail("GENERATION_MISMATCH", "Persisted plan does not bind this operation to the current inventory generation.");
  }
  if (!planned.targetGenerationId) fail("GENERATION_MISMATCH", "Persisted plan has no target generation identity.");
  if ((row.delivery_class === "platform-plugin" && row.operation_kind === "disable") !==
      (plan.executionClass === "live-generation" && planned.deliveryClass === "platform-plugin")) {
    fail("GENERATION_MISMATCH", "Platform Plugin execution class does not match its lifecycle operation.");
  }
  if (row.delivery_class !== "platform-plugin" && plan.executionClass !== "live-generation") {
    fail("GENERATION_MISMATCH", "Dynamic extension operation cannot use static release authority.");
  }
  if (["install", "update"].includes(row.operation_kind)) {
    if (planned.targetGenerationId === state.active_generation_id || planned.targetGenerationId === state.rollback_generation_id) {
      fail("GENERATION_MISMATCH", "Install and update target generations must be fresh.");
    }
  } else if (row.operation_kind === "rollback") {
    if (!state.active_generation_id || planned.targetGenerationId !== state.rollback_generation_id) {
      fail("GENERATION_MISMATCH", "Rollback plan must target the retained inventory generation.");
    }
  } else if (row.delivery_class === "platform-plugin" && row.operation_kind === "uninstall") {
    if (!currentGenerationId || planned.targetGenerationId === currentGenerationId || planned.targetGenerationId === state.rollback_generation_id) {
      fail("GENERATION_MISMATCH", "Static uninstall plan must target a fresh application generation.");
    }
  } else if (planned.targetGenerationId !== currentGenerationId) {
    fail("GENERATION_MISMATCH", "Disable plan must remain bound to the active inventory generation.");
  }
}

function transitionEvidence(row: OperationRow, authority: VerifiedGenerationAuthority | undefined, staticReceipt?: StaticDeploymentReceipt, staticGeneration?: Record<string, unknown>) {
  const plan = row.plan_json;
  if (!plan) fail("STATE_INVALID", "A lifecycle transition requires a persisted plan.");
  if (plan.executionClass === "static-release") {
    return {
      sourceCommit: plan.sourceChange.targetSourceCommit,
      compositionChangePlanDigest: plan.sourceChange.planDigest,
      buildRequestDigest: plan.deployment.buildRequestDigest,
      generationId: plan.generationId,
      ...(staticReceipt ? {
        buildEvidenceDigest: staticReceipt.buildEvidenceDigest,
        applicationDigest: staticReceipt.applicationDigest,
        imageDigest: staticReceipt.imageDigest
      } : {})
    };
  }
  if (row.delivery_class === "platform-plugin") {
    if (!staticGeneration || typeof staticGeneration["sourceCommit"] !== "string" || typeof staticGeneration["compositionChangePlanDigest"] !== "string" || typeof staticGeneration["generationId"] !== "string") {
      fail("STATE_INVALID", "Runtime-only Platform Plugin transition is missing its retained static generation evidence.");
    }
    return {
      sourceCommit: staticGeneration["sourceCommit"],
      compositionChangePlanDigest: staticGeneration["compositionChangePlanDigest"],
      generationId: staticGeneration["generationId"],
      ...(typeof staticGeneration["buildEvidenceDigest"] === "string" ? { buildEvidenceDigest: staticGeneration["buildEvidenceDigest"] } : {}),
      ...(typeof staticGeneration["applicationDigest"] === "string" ? { applicationDigest: staticGeneration["applicationDigest"] } : {}),
      ...(typeof staticGeneration["imageDigest"] === "string" ? { imageDigest: staticGeneration["imageDigest"] } : {})
    };
  }
  return {
    sourceCommit: authority?.sourceCommit ?? plan.sourceCommit,
    artifactDigest: authority?.artifactDigest ?? plan.plan.artifactDigest,
    generationId: authority?.generationId ?? plan.generationId,
    ...(authority ? {
      manifestDigest: authority.manifestDigest,
      catalogDigest: authority.catalogDigest,
      provenanceDigest: authority.provenanceDigest,
      sbomDigest: authority.sbomDigest
    } : {})
  };
}

function lifecycleState(phase: ExtensionOperationPhase): ExtensionLifecycleEvent["lifecycleState"] {
  if (["planning", "downloading", "verified", "staged", "waiting-configuration", "waiting-approval", "warming"].includes(phase)) {
    return phase as ExtensionLifecycleEvent["lifecycleState"];
  }
  if (phase === "completed" || phase === "rollback-window-open") return "active";
  return phase === "failed" ? "quarantined" : "planning";
}

const allowedTransitions: Readonly<Record<ExtensionOperationPhase, readonly ExtensionOperationPhase[]>> = Object.freeze({
  planning: ["downloading", "source-change-required", "failed"],
  downloading: ["verified", "failed"],
  verified: ["staged", "failed"],
  staged: ["waiting-configuration", "waiting-approval", "warming", "failed"],
  "waiting-configuration": ["waiting-approval", "warming", "failed"],
  "waiting-approval": ["warming", "failed"],
  warming: ["completed", "failed"],
  "source-change-required": ["source-change-ready", "failed"],
  "source-change-ready": ["build-attested", "failed"],
  "build-attested": ["zero-downtime-eligible", "maintenance-required", "unsupported", "failed"],
  "zero-downtime-eligible": ["rollback-window-open", "completed", "failed"],
  "maintenance-required": ["completed", "failed"],
  unsupported: ["failed"],
  "rollback-window-open": ["rollback-window-closed", "failed"],
  "rollback-window-closed": ["contract-cleanup-eligible", "completed", "failed"],
  "contract-cleanup-eligible": ["completed", "failed"],
  completed: [],
  failed: []
});

export class PostgresRuntimeExtensionStore implements RuntimeExtensionStore {
  private readonly leaseMs: number;
  private readonly maxConcurrentOperations: number;

  constructor(
    private readonly pool: RuntimeExtensionPool,
    private readonly clock: RuntimeExtensionClock,
    private readonly hostInventoryDigest: string,
    options: Readonly<{ leaseMs?: number; maxConcurrentOperations?: number }> = {}
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxConcurrentOperations = options.maxConcurrentOperations ?? 16;
    if (!/^sha256:[0-9a-f]{64}$/u.test(hostInventoryDigest) || !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1 ||
      !Number.isSafeInteger(this.maxConcurrentOperations) || this.maxConcurrentOperations < 1 || this.maxConcurrentOperations > 512) {
      throw new TypeError("Runtime extension store configuration is invalid.");
    }
  }

  async claimOperation(input: Parameters<RuntimeExtensionStore["claimOperation"]>[0]): Promise<ClaimOperationResult> {
    return this.transaction(async (session) => {
      const request = input.request;
      const key = canonicalJson([request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      await session.query(
        `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition)
         values ($1, $2, $3, $4, 0, 'removed') on conflict do nothing`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]
      );
      await session.query(
        `insert into runtime_extension_inventory_revisions (application_id, environment, revision) values ($1, $2, 0) on conflict do nothing`,
        [request.applicationId, request.environment]
      );
      const state = await session.query<ExtensionRow>(
        `select * from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]
      );
      const replay = await session.query<OperationRow>(
        `select * from runtime_extension_operations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and operation_kind=$5 and idempotency_key=$6`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id, request.operation, request.idempotencyKey]
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_digest !== input.requestDigest) fail("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request.");
        return Object.freeze({ status: "replay", operation: operation(replay.rows[0]) });
      }

      if (state.rows[0]?.revision !== request.expectedRevision) fail("REVISION_CONFLICT", "Runtime extension revision differs from the requested revision.");
      const activeVersion = state.rows[0]?.active_generation?.["version"];
      if (["install", "update"].includes(request.operation) && typeof activeVersion === "string" && compareExactSemverPrecedence(request.targetVersion, activeVersion) < 0) {
        fail("VERSION_DOWNGRADE", "Install and update cannot downgrade the active extension version.");
      }

      const active = await session.query<{ operation_id: string }>(
        `select operation_id from runtime_extension_operations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and phase not in ('completed','failed') for update`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]
      );
      if (active.rows.length > 0) fail("OPERATION_IN_PROGRESS", "Another operation owns this extension identity.");

      await session.query(
        `insert into runtime_extension_operation_budget (application_id, environment, active_count, max_count)
         values ($1, $2, 0, $3) on conflict do nothing`,
        [request.applicationId, request.environment, this.maxConcurrentOperations]
      );
      const budget = await session.query<{ active_count: number; max_count: number }>(
        `select active_count, max_count from runtime_extension_operation_budget where application_id=$1 and environment=$2 for update`,
        [request.applicationId, request.environment]
      );
      const available = budget.rows[0];
      if (!available || available.active_count >= available.max_count) fail("GLOBAL_BUDGET_EXHAUSTED", "Runtime extension operation budget is exhausted.");
      await session.query(`update runtime_extension_operation_budget set active_count=active_count+1 where application_id=$1 and environment=$2`, [request.applicationId, request.environment]);

      const id = operationId(input.requestDigest);
      const token = randomUUID();
      const expiresAt = new Date(this.clock.now().valueOf() + this.leaseMs).toISOString();
      const inserted = await session.query<OperationRow>(
        `insert into runtime_extension_operations (
           operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
           request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,'planning',$12,$13,$14)
         returning *`,
        [id, request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id, request.operation, request.idempotencyKey,
          input.requestDigest, JSON.stringify(request), JSON.stringify(input.authorization), request.expectedRevision, input.workerId, token, expiresAt]
      );
      if (!inserted.rows[0]) fail("STATE_INVALID", "Runtime operation insert returned no row.");
      return Object.freeze({ status: "claimed", operation: operation(inserted.rows[0]) });
    });
  }

  async resumeOperation(id: string, workerId: string): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const result = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
      const row = result.rows[0];
      if (!row) fail("OPERATION_NOT_FOUND", "Runtime extension operation is unavailable.");
      if (["completed", "failed"].includes(row.phase)) return operation(row);
      const now = this.clock.now();
      if (new Date(row.lease_expires_at).valueOf() > now.valueOf() && row.lease_owner !== workerId) fail("LEASE_CONFLICT", "Runtime extension operation has a live lease.");
      const token = randomUUID();
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set lease_owner=$2, lease_token=$3, lease_expires_at=$4, updated_at=now() where operation_id=$1 returning *`,
        [id, workerId, token, new Date(now.valueOf() + this.leaseMs).toISOString()]
      );
      return operation(updated.rows[0]!);
    });
  }

  async savePlan(id: string, token: string, plan: PluginManagerPlan): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, id, token);
      const state = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const current = state.rows[0];
      if (!current || current.revision !== row.expected_revision) fail("REVISION_CONFLICT", "Runtime extension revision changed before planning.");
      assertPlanIdentity(row, plan, current);
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set plan_json=$3::jsonb, updated_at=now() where operation_id=$1 and lease_token=$2 returning *`,
        [id, token, JSON.stringify(plan)]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension plan lease changed.");
      await this.appendTransition(session, saved, "planning", undefined, current.active_generation ?? undefined);
      return operation(saved);
    });
  }

  async transition(input: Parameters<RuntimeExtensionStore["transition"]>[0]) {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.phase !== input.expectedPhase) fail("PHASE_CONFLICT", "Runtime extension operation phase changed.");
      if (!allowedTransitions[row.phase].includes(input.phase)) fail("PHASE_CONFLICT", `Runtime extension transition ${row.phase} -> ${input.phase} is invalid.`);
      if (input.authority) assertAuthorityOwner(row, input.authority);
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set phase=$3, authority_json=coalesce($4::jsonb, authority_json), updated_at=now()
         where operation_id=$1 and lease_token=$2 returning *`,
        [input.operationId, input.leaseToken, input.phase, input.authority ? JSON.stringify(input.authority) : null]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension transition lease changed.");
      const event = await this.appendTransition(session, saved, input.phase, input.authority);
      if (input.phase === "completed" || input.phase === "failed") {
        await session.query(`update runtime_extension_operation_budget set active_count=greatest(active_count-1,0) where application_id=$1 and environment=$2`, [saved.application_id, saved.environment]);
      }
      return Object.freeze({ operation: operation(saved), event });
    });
  }

  async stageGeneration(input: Parameters<RuntimeExtensionStore["stageGeneration"]>[0]) {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.phase !== "staged" || row.plan_json?.executionClass !== "live-generation" || !row.authority_json) {
        fail("PHASE_CONFLICT", "Only a staged live generation can enter warm-up.");
      }
      const stage = input.stage;
      assertStage(stage, this.clock.now());
      assertAuthorityOwner(row, stage.authority);
      if (canonicalJson(stage.authority) !== canonicalJson(row.authority_json) || stage.version !== row.plan_json.plan.version) {
        fail("GENERATION_MISMATCH", "Prepared generation authority differs from the verified operation authority.");
      }
      const activation = { metadata: stage.metadata, settings: stage.settings, storageSchemaVersions: stage.storageSchemaVersions };
      const authorityDigest = await sha256(stage.authority);
      const staged = await session.query<GenerationRow>(
        `insert into runtime_extension_generations (
           application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest,
           previous_generation_id, rollback_eligible, state, server_generation_id, ui_generation_id, storage_generation_id,
           activation_json, compatibility_json, readiness_token, readiness_expires_at
         ) values ($1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,$6::varchar,$7::jsonb,$8::varchar,
           (select active_generation_id from runtime_extensions where application_id=$1::varchar and environment=$2::varchar and delivery_class=$3::varchar and extension_id=$4::varchar),
           $9,'warming',$5::varchar,$5::varchar,$5::varchar,$10::jsonb,$11::jsonb,$12::varchar,$13::timestamptz)
         on conflict (application_id, environment, delivery_class, extension_id, generation_id) do update set
           state='warming', activation_json=excluded.activation_json, compatibility_json=excluded.compatibility_json,
           readiness_token=excluded.readiness_token, readiness_expires_at=excluded.readiness_expires_at
         where runtime_extension_generations.authority_digest=excluded.authority_digest
         returning *`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, stage.authority.generationId, stage.version,
          JSON.stringify(stage.authority), authorityDigest, stage.compatibility.status === "compatible", JSON.stringify(activation),
          JSON.stringify(stage.compatibility), stage.readiness.leaseToken, stage.readiness.expiresAt]
      );
      if (!staged.rows[0]) fail("GENERATION_MISMATCH", "A different artifact already owns this generation identity.");
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set phase='warming', updated_at=now() where operation_id=$1 and lease_token=$2 and phase='staged' returning *`,
        [input.operationId, input.leaseToken]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension warm-up lease changed.");
      const event = await this.appendTransition(session, saved, "warming", stage.authority);
      await session.query(
        `update runtime_extension_generations set staged_revision=$6 where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, stage.authority.generationId, event.revision]
      );
      return Object.freeze({ operation: operation(saved), event });
    });
  }

  async refreshGenerationReadiness(input: Parameters<RuntimeExtensionStore["refreshGenerationReadiness"]>[0]): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.phase !== "warming" || row.plan_json?.executionClass !== "live-generation" || !row.authority_json) {
        fail("PHASE_CONFLICT", "Only a warming live generation can refresh readiness.");
      }
      assertStage(input.stage, this.clock.now());
      assertAuthorityOwner(row, input.stage.authority);
      if (canonicalJson(input.stage.authority) !== canonicalJson(row.authority_json) || input.stage.version !== row.plan_json.plan.version) {
        fail("GENERATION_MISMATCH", "Refreshed generation authority differs from the verified operation authority.");
      }
      const activation = { metadata: input.stage.metadata, settings: input.stage.settings, storageSchemaVersions: input.stage.storageSchemaVersions };
      const refreshed = await session.query(
        `update runtime_extension_generations g set activation_json=$6::jsonb, compatibility_json=$7::jsonb, readiness_token=$8, readiness_expires_at=$9
         from runtime_extensions e
         where g.application_id=$1 and g.environment=$2 and g.delivery_class=$3 and g.extension_id=$4 and g.generation_id=$5
           and g.application_id=e.application_id and g.environment=e.environment and g.delivery_class=e.delivery_class and g.extension_id=e.extension_id
           and g.state='warming' and g.staged_revision=e.revision and g.authority_digest=$10 returning g.generation_id`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, input.stage.authority.generationId,
          JSON.stringify(activation), JSON.stringify(input.stage.compatibility), input.stage.readiness.leaseToken, input.stage.readiness.expiresAt,
          await sha256(input.stage.authority)]
      );
      if (refreshed.rowCount !== 1) fail("REVISION_CONFLICT", "Warming generation changed before readiness refresh.");
      return operation(row);
    });
  }

  async activateGeneration(id: string, token: string): Promise<ExtensionActivationReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, ["install", "update"]);
      if (replay) return replay as ExtensionActivationReceipt;
      const row = await this.lockOperation(session, id, token);
      if (row.phase !== "warming" || row.plan_json?.executionClass !== "live-generation" || !row.authority_json || !["install", "update"].includes(row.operation_kind)) {
        fail("PHASE_CONFLICT", "Only a warming live generation can activate.");
      }
      assertAuthorityOwner(row, row.authority_json);
      const identity = identityKey(row);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state) fail("STATE_INVALID", "Runtime extension state is unavailable.");
      const generationResult = await session.query<GenerationRow>(
        `select * from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, row.authority_json.generationId]
      );
      const generation = generationResult.rows[0];
      if (!generation || generation.staged_revision !== state.revision || generation.server_generation_id !== generation.generation_id ||
        generation.ui_generation_id !== generation.generation_id || generation.storage_generation_id !== generation.generation_id) {
        fail("GENERATION_MISMATCH", "Staged server, UI, storage, and extension revisions do not form one generation.");
      }
      assertAuthorityOwner(row, generation.authority_json);
      if (!generation.readiness_expires_at || new Date(generation.readiness_expires_at).valueOf() <= this.clock.now().valueOf()) {
        fail("READINESS_EXPIRED", "Generation readiness expired before activation.");
      }
      if (!generation.activation_json || !generation.compatibility_json) fail("STATE_INVALID", "Generation activation evidence is incomplete.");

      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const { receiptId } = evidenceIds(row, revision);
      const activeGeneration = this.bundleGenerationEvidence(generation, receiptId);
      const previousGeneration = state.active_generation;
      const previousGenerationId = previousGeneration ? state.active_generation_id ?? undefined : undefined;
      const rollbackAvailable = Boolean(previousGeneration && generation.compatibility_json.status === "compatible");
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition='active', active_generation_id=$6, active_generation=$7::jsonb,
           rollback_generation_id=$8, rollback_generation=$9::jsonb, retained_generation=null,
           metadata_json=$10::jsonb, settings_json=$11::jsonb, storage_schema_versions=$12::jsonb,
           rollback_compatibility_json=$13::jsonb, last_operation_id=$14, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$15`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, generation.generation_id, JSON.stringify(activeGeneration),
          rollbackAvailable ? previousGenerationId : null, rollbackAvailable ? JSON.stringify(previousGeneration) : null,
          JSON.stringify(generation.activation_json.metadata), JSON.stringify(generation.activation_json.settings), JSON.stringify(generation.activation_json.storageSchemaVersions),
          JSON.stringify(generation.compatibility_json), row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed before activation.");
      await session.query(
        `update runtime_extension_generations set state=case when generation_id=$5 then 'active' when generation_id=$6 then 'rollback' else state end,
           receipt_id=case when generation_id=$5 then $7 else receipt_id end, activated_at=case when generation_id=$5 then now() else activated_at end
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id in ($5,$6)`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, generation.generation_id, previousGenerationId ?? generation.generation_id, receiptId]
      );
      const event = await this.writeTransitionEvidence(session, row, "completed", row.authority_json, revision, inventoryRevision);
      const receipt: ExtensionActivationReceipt = Object.freeze({
        receiptId: event.receiptId, operationId: row.operation_id, operation: row.operation_kind as "install" | "update",
        generationId: generation.generation_id, ...(previousGenerationId ? { previousGenerationId } : {}), revisionBefore: state.revision,
        revisionAfter: revision, inventoryRevision, compatibility: generation.compatibility_json,
        rollback: generation.compatibility_json.status === "irreversible" ? "blocked-irreversible" : rollbackAvailable ? "available" : "unavailable",
        occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async rollbackGeneration(id: string, token: string): Promise<ExtensionActivationReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, ["rollback"]);
      if (replay) return replay as ExtensionActivationReceipt;
      const row = await this.lockOperation(session, id, token);
      if (row.phase !== "planning" || row.operation_kind !== "rollback" || row.plan_json?.executionClass !== "live-generation") {
        fail("PHASE_CONFLICT", "Only a planned live-generation rollback can commit.");
      }
      const identity = identityKey(row);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== row.expected_revision + 1) fail("REVISION_CONFLICT", "Rollback expected revision does not match the planned active state.");
      if (!state.active_generation_id || !state.active_generation) fail("ROLLBACK_BLOCKED", "No active generation is available for rollback.");
      const compatibility = state.rollback_compatibility_json;
      if (compatibility?.status === "irreversible") {
        fail("ROLLBACK_BLOCKED", `Irreversible decision ${compatibility.decisionId} blocks rollback.`);
      }
      if (!state.rollback_generation_id || !state.rollback_generation) fail("ROLLBACK_BLOCKED", "No compatible prior generation is retained.");
      const targetResult = await session.query<GenerationRow>(
        `select * from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, state.rollback_generation_id]
      );
      const target = targetResult.rows[0];
      if (!target || !target.activation_json || !compatibility) fail("ROLLBACK_BLOCKED", "Rollback generation evidence is incomplete.");
      if (new Date(compatibility.closesAt).valueOf() <= this.clock.now().valueOf()) fail("ROLLBACK_BLOCKED", "Rollback compatibility window is closed.");

      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const { receiptId } = evidenceIds(row, revision);
      const targetEvidence = { ...state.rollback_generation, receiptId };
      const updated = await session.query(
        `update runtime_extensions set revision=$5, active_generation_id=$6, active_generation=$7::jsonb,
           rollback_generation_id=$8, rollback_generation=$9::jsonb, metadata_json=$10::jsonb, settings_json=$11::jsonb,
           storage_schema_versions=$12::jsonb, last_operation_id=$13, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$14`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, state.rollback_generation_id, JSON.stringify(targetEvidence),
          state.active_generation_id, JSON.stringify(state.active_generation), JSON.stringify(target.activation_json.metadata), JSON.stringify(target.activation_json.settings),
          JSON.stringify(target.activation_json.storageSchemaVersions), row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed before rollback.");
      await session.query(
        `update runtime_extension_generations set state=case when generation_id=$5 then 'active' when generation_id=$6 then 'rollback' else state end,
           receipt_id=case when generation_id=$5 then $7 else receipt_id end
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id in ($5,$6)`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, state.rollback_generation_id, state.active_generation_id, receiptId]
      );
      const authority = target.authority_json;
      const event = await this.writeTransitionEvidence(session, row, "completed", authority, revision, inventoryRevision);
      const receipt: ExtensionActivationReceipt = Object.freeze({
        receiptId: event.receiptId, operationId: row.operation_id, operation: "rollback", generationId: state.rollback_generation_id,
        previousGenerationId: state.active_generation_id, revisionBefore: state.revision, revisionAfter: revision, inventoryRevision,
        compatibility, rollback: "available", occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async completeStaticRelease(id: string, token: string, receipt: StaticDeploymentReceipt): Promise<StaticDeploymentReceipt> {
    return this.transaction(async (session) => {
      const persisted = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
      const replay = persisted.rows[0];
      if (replay?.phase === "completed") {
        if (replay.plan_json?.executionClass !== "static-release" || !replay.result_json || !("activeGenerationId" in replay.result_json) || canonicalJson(replay.result_json) !== canonicalJson(receipt)) {
          fail("STATE_INVALID", "Completed static release operation has a different persisted receipt.");
        }
        return replay.result_json;
      }
      const row = await this.lockOperation(session, id, token);
      if (row.delivery_class !== "platform-plugin" || row.plan_json?.executionClass !== "static-release" ||
        !["source-change-ready", "build-attested", "zero-downtime-eligible", "rollback-window-open"].includes(row.phase)) {
        fail("PHASE_CONFLICT", "Static deployment receipt cannot complete this runtime operation.");
      }
      const plan = row.plan_json;
      if (receipt.applicationId !== row.application_id || receipt.environment !== row.environment || receipt.activeGenerationId !== plan.generationId ||
        receipt.sourceCommit !== plan.sourceChange.targetSourceCommit || receipt.compositionChangePlanDigest !== plan.sourceChange.planDigest ||
        receipt.operation !== (row.operation_kind === "rollback" ? "rollback" : "promote") ||
        (row.operation_kind === "uninstall" &&
          (receipt.previousGenerationId !== plan.plan.currentGenerationId || receipt.activeGenerationId === receipt.previousGenerationId))) {
        fail("GENERATION_MISMATCH", "Static deployment receipt does not bind the planned runtime operation.");
      }
      const identity = identityKey(row);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state) fail("STATE_INVALID", "Runtime extension state is unavailable.");
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const previousGeneration = state.active_generation;
      const active = !["disable", "uninstall"].includes(row.operation_kind);
      const retained = active && previousGeneration && receipt.rollbackWindow.state === "open" ? previousGeneration : null;
      const activeGeneration = active ? this.staticGenerationEvidence(plan, receipt) : null;
      const disposition = row.operation_kind === "disable" ? "disabled" : row.operation_kind === "uninstall" ? "removed" : "active";
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition=$6, active_generation_id=$7, active_generation=$8::jsonb,
           rollback_generation_id=$9, rollback_generation=$10::jsonb, retained_generation=$11::jsonb, last_operation_id=$12, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$13`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, disposition,
          active ? receipt.activeGenerationId : null, active ? JSON.stringify(activeGeneration) : null,
          retained ? String(retained["generationId"]) : null, retained ? JSON.stringify(retained) : null,
          !active && previousGeneration ? JSON.stringify(previousGeneration) : null, row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed before static receipt reconciliation.");
      await this.writeTransitionEvidence(session, row, "completed", undefined, revision, inventoryRevision, undefined, receipt);
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async disableGeneration(id: string, token: string): Promise<ExtensionDispositionReceipt> {
    return this.changeDisposition(id, token, "disable", "disabled");
  }

  async uninstallGeneration(id: string, token: string): Promise<ExtensionDispositionReceipt> {
    return this.changeDisposition(id, token, "uninstall", "removed");
  }

  async quarantineActiveGeneration(input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0]): Promise<ExtensionSecurityQuarantineReceipt> {
    if (!validRecordId(input.generationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      input.extension.deliveryClass !== input.decision.release.deliveryClass || input.extension.id !== input.decision.release.id ||
      input.generationId.length < 1 || !/^sha256:[0-9a-f]{64}$/u.test(input.decision.catalogDigest) ||
      !Number.isSafeInteger(input.decision.catalogSequence) || input.decision.catalogSequence < 1 ||
      !/^[a-z0-9][a-z0-9.-]{0,159}$/u.test(input.decision.catalogSignerIdentity) ||
      !["revoked", "compromised", "unsupported"].includes(input.decision.disposition)) {
      fail("STATE_INVALID", "Security quarantine decision is invalid.");
    }
    const transition = await this.securityTransitionIds(input);
    return this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id])]);
      const replay = await session.query<{ receipt_json: ExtensionSecurityQuarantineReceipt }>(
        `select receipt_json from runtime_extension_security_receipts where decision_digest=$1 for update`,
        [transition.decisionDigest]
      );
      if (replay.rows[0]) return Object.freeze({ ...replay.rows[0].receipt_json });
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Runtime extension revision changed before security quarantine.");
      if (state.disposition !== "active" || state.active_generation_id !== input.generationId || !state.active_generation) {
        fail("GENERATION_MISMATCH", "Security quarantine no longer targets the active generation.");
      }
      this.assertSecurityDecisionMatchesActive(input, state.active_generation);
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, input.applicationId, input.environment);
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition='quarantined', active_generation_id=null, active_generation=null,
           rollback_generation_id=null, rollback_generation=null, retained_generation=$6::jsonb, rollback_compatibility_json=null,
           last_operation_id=$7, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$8`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, revision,
          JSON.stringify(state.active_generation), transition.securityTransitionId, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed during security quarantine.");
      await session.query(
        `update runtime_extension_generations set state='retired'
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 and state='active'`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId]
      );
      await session.query(
        `delete from runtime_extension_generation_leases where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id]
      );
      const receipt: ExtensionSecurityQuarantineReceipt = Object.freeze({
        receiptId: transition.receiptId,
        securityTransitionId: transition.securityTransitionId,
        disposition: "quarantined",
        reason: input.decision.disposition,
        generationId: input.generationId,
        revisionBefore: state.revision,
        revisionAfter: revision,
        inventoryRevision,
        catalogDigest: input.decision.catalogDigest,
        occurredAt: timestamp(this.clock)
      });
      await this.writeSecurityQuarantineEvidence(session, input, transition, receipt);
      return receipt;
    });
  }

  async quarantineRunnerGeneration(input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0]): Promise<ExtensionRunnerQuarantineReceipt> {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(input.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(input.environment) ||
      !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(input.appId) || !validRecordId(input.generationId) ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      !["INVOCATION_TIMEOUT", "OUTPUT_BUDGET_EXCEEDED", "PROTOCOL_VIOLATION", "CONTAINER_FAILED", "POLICY_UNAVAILABLE"].includes(input.reason)) {
      fail("STATE_INVALID", "Runner quarantine request is invalid.");
    }
    const transition = await this.runnerQuarantineTransitionIds(input);
    return this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([input.applicationId, input.environment, "hot-application", input.appId])]);
      const replay = await session.query<{ receipt_json: ExtensionRunnerQuarantineReceipt }>(
        `select receipt_json from runtime_extension_runner_quarantine_receipts where quarantine_digest=$1 for update`,
        [transition.quarantineDigest]
      );
      if (replay.rows[0]) return Object.freeze({ ...replay.rows[0].receipt_json });
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 for update`,
        [input.applicationId, input.environment, input.appId]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Runtime extension revision changed before runner quarantine.");
      if (state.disposition !== "active" || state.active_generation_id !== input.generationId || !state.active_generation || !state.last_operation_id) {
        fail("GENERATION_MISMATCH", "Runner quarantine no longer targets the active generation.");
      }
      const operationResult = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for share`, [state.last_operation_id]);
      const row = operationResult.rows[0];
      if (!row || row.delivery_class !== "hot-application" || row.extension_id !== input.appId) fail("STATE_INVALID", "Runner quarantine cannot reconstruct its authoritative lifecycle evidence.");
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, input.applicationId, input.environment);
      const updated = await session.query(
        `update runtime_extensions set revision=$4, disposition='quarantined', active_generation_id=null, active_generation=null,
           rollback_generation_id=null, rollback_generation=null, retained_generation=$5::jsonb, rollback_compatibility_json=null,
           last_operation_id=$6, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 and revision=$7`,
        [input.applicationId, input.environment, input.appId, revision, JSON.stringify(state.active_generation), transition.quarantineTransitionId, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed during runner quarantine.");
      await session.query(
        `update runtime_extension_generations set state='retired'
         where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 and generation_id=$4 and state='active'`,
        [input.applicationId, input.environment, input.appId, input.generationId]
      );
      await session.query(
        `delete from runtime_extension_generation_leases where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3`,
        [input.applicationId, input.environment, input.appId]
      );
      const receipt: ExtensionRunnerQuarantineReceipt = Object.freeze({
        receiptId: transition.receiptId,
        quarantineTransitionId: transition.quarantineTransitionId,
        disposition: "quarantined",
        reason: input.reason,
        generationId: input.generationId,
        revisionBefore: state.revision,
        revisionAfter: revision,
        inventoryRevision,
        occurredAt: timestamp(this.clock)
      });
      await this.writeRunnerQuarantineEvidence(session, row, input, transition, receipt);
      return receipt;
    });
  }

  private async changeDisposition(
    id: string,
    token: string,
    operationKind: "disable" | "uninstall",
    disposition: "disabled" | "removed"
  ): Promise<ExtensionDispositionReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, [operationKind]);
      if (replay) return replay as ExtensionDispositionReceipt;
      const row = await this.lockOperation(session, id, token);
      if (row.phase !== "planning" || row.operation_kind !== operationKind || row.plan_json?.executionClass !== "live-generation") {
        fail("PHASE_CONFLICT", `Only a planned live-generation ${operationKind} can commit.`);
      }
      if (row.delivery_class === "platform-plugin" && operationKind === "uninstall") {
        fail("PHASE_CONFLICT", "Platform Plugin uninstall requires static source/build authority.");
      }
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identityKey(row)]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== row.expected_revision + 1) fail("REVISION_CONFLICT", `${operationKind} expected revision does not match the planned state.`);
      if (operationKind === "disable" && (state.disposition !== "active" || !state.active_generation_id || !state.active_generation)) {
        fail("STATE_INVALID", "Only an active extension can be disabled.");
      }
      if (operationKind === "uninstall" && state.disposition === "removed") fail("STATE_INVALID", "Removed extension cannot be uninstalled again.");
      if (row.delivery_class === "theme-skin") {
        const reference = await session.query<{ profile_id: string }>(
          `select profile_id from runtime_theme_profile_publications
           where application_id=$1 and environment=$2 and (
             active_profile->'skin'->>'id'=$3 or previous_profile->'skin'->>'id'=$3 or draft_profile->'skin'->>'id'=$3
           ) limit 1`,
          [row.application_id, row.environment, row.extension_id]
        );
        if (reference.rows[0]) fail("REFERENCE_CONFLICT", "Theme Skin is still referenced by a durable Theme Profile revision.");
      }
      const previousGeneration = state.active_generation ?? state.retained_generation;
      const previousGenerationId = previousGeneration && typeof previousGeneration["generationId"] === "string" ? previousGeneration["generationId"] : undefined;
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const retained = disposition === "disabled" ? state.active_generation : null;
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition=$6::varchar, active_generation_id=null, active_generation=null,
           rollback_generation_id=null, rollback_generation=null, retained_generation=$7::jsonb, rollback_compatibility_json=null,
           metadata_json=case when $6::varchar='removed' then '{}'::jsonb else metadata_json end,
           settings_json=case when $6::varchar='removed' then '{}'::jsonb else settings_json end,
           storage_schema_versions=case when $6::varchar='removed' then '{}'::jsonb else storage_schema_versions end,
           last_operation_id=$8, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$9`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, disposition, retained ? JSON.stringify(retained) : null, row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", `Runtime extension changed before ${operationKind}.`);
      await session.query(
        `delete from runtime_extension_generation_leases where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      if (disposition === "removed") {
        await session.query(
          `delete from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
          [row.application_id, row.environment, row.delivery_class, row.extension_id]
        );
      } else {
        await session.query(
          `update runtime_extension_generations set state='retired' where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and state in ('active','rollback')`,
          [row.application_id, row.environment, row.delivery_class, row.extension_id]
        );
      }
      const event = await this.writeTransitionEvidence(session, row, "completed", undefined, revision, inventoryRevision, disposition, undefined, previousGeneration ?? undefined);
      const receipt: ExtensionDispositionReceipt = Object.freeze({
        receiptId: event.receiptId,
        operationId: row.operation_id,
        operation: operationKind,
        disposition,
        ...(previousGenerationId ? { previousGenerationId } : {}),
        revisionBefore: state.revision,
        revisionAfter: revision,
        inventoryRevision,
        occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async readOperation(id: string): Promise<RuntimeExtensionOperation | undefined> {
    const result = await this.pool.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1`, [id]);
    return result.rows[0] ? operation(result.rows[0]) : undefined;
  }

  async observeActiveGeneration(applicationId: string, environment: string, extension: Parameters<RuntimeExtensionStore["observeActiveGeneration"]>[2]) {
    const result = await this.pool.query<{ revision: number; inventory_revision: number; active_generation_id: string | null }>(
      `select e.revision, coalesce(i.revision,0)::int inventory_revision, e.active_generation_id
       from runtime_extensions e left join runtime_extension_inventory_revisions i using (application_id, environment)
       where e.application_id=$1 and e.environment=$2 and e.delivery_class=$3 and e.extension_id=$4`,
      [applicationId, environment, extension.deliveryClass, extension.id]
    );
    const row = result.rows[0];
    if (!row) return Object.freeze({ revision: 0, inventoryRevision: 0 });
    return Object.freeze({ revision: row.revision, inventoryRevision: row.inventory_revision, ...(row.active_generation_id ? { generationId: row.active_generation_id } : {}) });
  }

  async acquireGenerationLease(input: Parameters<RuntimeExtensionStore["acquireGenerationLease"]>[0]): Promise<string> {
    if (!validRecordId(input.generationId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(input.holder) ||
      !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > 300_000) throw new TypeError("Generation drain lease request is invalid.");
    return this.transaction(async (session) => {
      const active = await session.query<{ active_generation_id: string | null }>(
        `select active_generation_id from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for share`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id]
      );
      if (active.rows[0]?.active_generation_id !== input.generationId) fail("GENERATION_MISMATCH", "Only the active generation may receive a new in-flight lease.");
      const leaseId = `lease-${randomUUID()}`;
      await session.query(
        `insert into runtime_extension_generation_leases (lease_id, application_id, environment, delivery_class, extension_id, generation_id, holder, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [leaseId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId, input.holder,
          new Date(this.clock.now().valueOf() + input.ttlMs).toISOString()]
      );
      return leaseId;
    });
  }

  async releaseGenerationLease(leaseId: string): Promise<void> {
    if (!/^lease-[0-9a-f-]{36}$/u.test(leaseId)) throw new TypeError("Generation drain lease identity is invalid.");
    await this.pool.query(`delete from runtime_extension_generation_leases where lease_id=$1`, [leaseId]);
  }

  async hasLiveGenerationLease(input: Parameters<RuntimeExtensionStore["hasLiveGenerationLease"]>[0]): Promise<boolean> {
    if (!validRecordId(input.generationId) || !/^lease-[0-9a-f-]{36}$/u.test(input.leaseId)) throw new TypeError("Generation drain lease identity is invalid.");
    const result = await this.pool.query<{ lease_id: string }>(
      `select lease_id from runtime_extension_generation_leases
       where lease_id=$1 and application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6 and expires_at>$7`,
      [input.leaseId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId, timestamp(this.clock)]
    );
    return result.rows.length === 1;
  }

  async liveGenerationLeaseCount(applicationId: string, environment: string, extension: Parameters<RuntimeExtensionStore["liveGenerationLeaseCount"]>[2], generationId: string): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `select count(*)::int count from runtime_extension_generation_leases
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 and expires_at>$6`,
      [applicationId, environment, extension.deliveryClass, extension.id, generationId, timestamp(this.clock)]
    );
    return result.rows[0]?.count ?? 0;
  }

  async inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory> {
    const result = await this.pool.query<ExtensionRow>(
      `select runtime_extensions.*,
         coalesce((select revision from runtime_extension_inventory_revisions where application_id=$1 and environment=$2), 0)::int as inventory_revision
       from runtime_extensions where application_id=$1 and environment=$2 order by delivery_class, extension_id`,
      [applicationId, environment]
    );
    const extensions = { platformPlugins: {}, hotApplications: {}, themeSkins: {} } as Record<string, Record<string, unknown>>;
    for (const row of result.rows) {
      if (row.revision === 0) continue;
      const entry: Record<string, unknown> = {
        disposition: row.disposition,
        revision: row.revision,
        lastOperationId: row.last_operation_id ?? "operation-uninitialized",
        lastReceiptId: row.last_receipt_id ?? "receipt-uninitialized",
        stateDigest: row.state_digest ?? await sha256({ disposition: row.disposition, revision: row.revision })
      };
      if (row.disposition === "active" && row.active_generation) {
        entry.activeGeneration = row.active_generation;
        if (row.rollback_generation) entry.rollbackGeneration = row.rollback_generation;
      } else if (row.disposition !== "removed" && row.retained_generation) entry.retainedGeneration = row.retained_generation;
      const group = row.delivery_class === "platform-plugin" ? "platformPlugins" : row.delivery_class === "hot-application" ? "hotApplications" : "themeSkins";
      extensions[group]![row.extension_id] = entry;
    }
    const revision = result.rows[0]?.inventory_revision ?? 0;
    const inventory = { schemaVersion: 1 as const, applicationId, environment, hostInventoryDigest: this.hostInventoryDigest, revision, extensions };
    return RuntimeExtensionInventorySchema.parse({ ...inventory, observedAt: timestamp(this.clock), stateDigest: await sha256(inventory) });
  }

  private assertSecurityDecisionMatchesActive(
    input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0],
    active: Record<string, unknown>
  ): void {
    const release = input.decision.release;
    if (active["generationId"] !== input.generationId || active["version"] !== release.version || active["sourceCommit"] !== release.sourceCommit ||
      active["artifactDigest"] !== release.artifactDigest || active["manifestDigest"] !== release.manifestDigest ||
      active["provenanceDigest"] !== release.provenanceDigest || active["sbomDigest"] !== release.sbomDigest ||
      active["deliveryClass"] !== release.deliveryClass || active["extensionId"] !== release.id) {
      fail("GENERATION_MISMATCH", "Current security decision does not bind the exact active immutable release.");
    }
  }

  private async securityTransitionIds(input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0]) {
    const decisionDigest = await sha256({
      applicationId: input.applicationId,
      environment: input.environment,
      extension: input.extension,
      expectedRevision: input.expectedRevision,
      generationId: input.generationId,
      decision: input.decision
    });
    const suffix = decisionDigest.slice("sha256:".length, "sha256:".length + 32);
    return Object.freeze({
      decisionDigest,
      securityTransitionId: `security-quarantine-${suffix}`,
      receiptId: `security-receipt-${suffix}`,
      auditId: `security-audit-${suffix}`,
      eventId: `security-event-${suffix}`
    });
  }

  private async runnerQuarantineTransitionIds(input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0]) {
    const quarantineDigest = await sha256(input);
    const suffix = quarantineDigest.slice("sha256:".length, "sha256:".length + 32);
    return Object.freeze({
      quarantineDigest,
      quarantineTransitionId: `runner-quarantine-${suffix}`,
      receiptId: `runner-receipt-${suffix}`,
      auditId: `runner-audit-${suffix}`,
      eventId: `runner-event-${suffix}`
    });
  }

  private async writeRunnerQuarantineEvidence(
    session: RuntimeExtensionSession,
    row: OperationRow,
    input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0],
    ids: Readonly<{ quarantineDigest: string; quarantineTransitionId: string; receiptId: string; auditId: string; eventId: string }>,
    receipt: ExtensionRunnerQuarantineReceipt
  ): Promise<void> {
    const event = ExtensionLifecycleEventSchema.parse({
      schemaVersion: 1,
      applicationId: input.applicationId,
      environment: input.environment,
      eventId: ids.eventId,
      eventType: "extension.lifecycle-transition",
      operationId: row.operation_id,
      operation: row.operation_kind,
      operationPhase: "failed",
      lifecycleState: "quarantined",
      expectedRevision: input.expectedRevision,
      revision: receipt.revisionAfter,
      inventoryRevision: receipt.inventoryRevision,
      actor: row.authorization_json.actor,
      receiptId: ids.receiptId,
      auditId: ids.auditId,
      idempotencyKey: row.request_json.idempotencyKey,
      correlationId: row.request_json.correlationId,
      occurredAt: receipt.occurredAt,
      deliveryClass: "hot-application",
      id: input.appId,
      evidence: transitionEvidence(row, row.authority_json ?? undefined)
    });
    const eventJson = JSON.stringify(event);
    await session.query(
      `insert into runtime_extension_runner_quarantine_receipts
       (receipt_id, quarantine_transition_id, application_id, environment, delivery_class, extension_id, generation_id, expected_revision, revision, inventory_revision, reason, quarantine_digest, receipt_json, event_json)
       values ($1,$2,$3,$4,'hot-application',$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [ids.receiptId, ids.quarantineTransitionId, input.applicationId, input.environment, input.appId, input.generationId,
        input.expectedRevision, receipt.revisionAfter, receipt.inventoryRevision, input.reason, ids.quarantineDigest, JSON.stringify(receipt), eventJson]
    );
    await session.query(
      `insert into runtime_extension_audit (audit_id, operation_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,'hot-application',$5,$6,$7,$8::jsonb)`,
      [ids.auditId, row.operation_id, input.applicationId, input.environment, input.appId, receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_outbox (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [ids.eventId, input.applicationId, input.environment, "hot-application", input.appId, receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `update runtime_extensions set last_receipt_id=$4, state_digest=$5 where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3`,
      [input.applicationId, input.environment, input.appId, ids.receiptId, await sha256({ event, reason: input.reason })]
    );
  }

  private async writeSecurityQuarantineEvidence(
    session: RuntimeExtensionSession,
    input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0],
    ids: Readonly<{ decisionDigest: string; securityTransitionId: string; receiptId: string; auditId: string; eventId: string }>,
    receipt: ExtensionSecurityQuarantineReceipt
  ): Promise<void> {
    const event = ExtensionSecurityQuarantineEventSchema.parse({
      schemaVersion: 1,
      eventId: ids.eventId,
      eventType: "extension.security-quarantine",
      securityTransitionId: ids.securityTransitionId,
      receiptId: ids.receiptId,
      auditId: ids.auditId,
      applicationId: input.applicationId,
      environment: input.environment,
      deliveryClass: input.extension.deliveryClass,
      id: input.extension.id,
      expectedRevision: input.expectedRevision,
      revision: receipt.revisionAfter,
      inventoryRevision: receipt.inventoryRevision,
      occurredAt: receipt.occurredAt,
      evidence: {
        catalogDigest: input.decision.catalogDigest,
        catalogSignerIdentity: input.decision.catalogSignerIdentity,
        catalogSequence: input.decision.catalogSequence,
        disposition: input.decision.disposition,
        version: input.decision.release.version,
        sourceCommit: input.decision.release.sourceCommit,
        artifactDigest: input.decision.release.artifactDigest,
        manifestDigest: input.decision.release.manifestDigest,
        provenanceDigest: input.decision.release.provenanceDigest,
        sbomDigest: input.decision.release.sbomDigest,
        generationId: input.generationId
      }
    });
    const eventJson = JSON.stringify(event);
    const receiptJson = JSON.stringify(receipt);
    await session.query(
      `insert into runtime_extension_security_receipts
       (receipt_id, security_transition_id, application_id, environment, delivery_class, extension_id, generation_id, expected_revision, revision, inventory_revision, decision_digest, receipt_json, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [ids.receiptId, ids.securityTransitionId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId,
        input.expectedRevision, receipt.revisionAfter, receipt.inventoryRevision, ids.decisionDigest, receiptJson, eventJson]
    );
    await session.query(
      `insert into runtime_extension_security_audit
       (audit_id, receipt_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [ids.auditId, ids.receiptId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id,
        receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_outbox
       (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [ids.eventId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id,
        receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `update runtime_extensions set last_receipt_id=$5, state_digest=$6 where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
      [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, ids.receiptId, await sha256(event)]
    );
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

  private async lockOperation(session: RuntimeExtensionSession, id: string, token: string): Promise<OperationRow> {
    const result = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
    const row = result.rows[0];
    if (!row) fail("OPERATION_NOT_FOUND", "Runtime extension operation is unavailable.");
    if (row.lease_token !== token || new Date(row.lease_expires_at).valueOf() <= this.clock.now().valueOf()) fail("LEASE_CONFLICT", "Runtime extension operation lease is stale.");
    return row;
  }

  private async completedReceipt(
    session: RuntimeExtensionSession,
    id: string,
    expectedOperations: readonly RuntimeExtensionOperation["request"]["operation"][]
  ): Promise<ExtensionManagerReceipt | undefined> {
    const result = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
    const row = result.rows[0];
    if (!row || row.phase !== "completed") return undefined;
    if (!row.result_json || !expectedOperations.includes(row.operation_kind) || row.result_json.operation !== row.operation_kind) {
      fail("STATE_INVALID", "Completed runtime extension operation has no matching persisted receipt.");
    }
    return row.result_json;
  }

  private async advanceInventoryRevision(session: RuntimeExtensionSession, applicationId: string, environment: string): Promise<number> {
    const result = await session.query<{ revision: number }>(
      `update runtime_extension_inventory_revisions set revision=revision+1 where application_id=$1 and environment=$2 returning revision`,
      [applicationId, environment]
    );
    const revision = result.rows[0]?.revision;
    if (!revision) fail("STATE_INVALID", "Runtime extension inventory revision update failed.");
    return revision;
  }

  private bundleGenerationEvidence(generation: GenerationRow, receiptId: string) {
    return {
      authority: "verified-bundle" as const,
      applicationId: generation.authority_json.applicationId,
      environment: generation.authority_json.environment,
      deliveryClass: generation.authority_json.deliveryClass,
      extensionId: generation.authority_json.extensionId,
      generationId: generation.generation_id,
      version: generation.version,
      sourceCommit: generation.authority_json.sourceCommit,
      artifactDigest: generation.authority_json.artifactDigest,
      manifestDigest: generation.authority_json.manifestDigest,
      catalogDigest: generation.authority_json.catalogDigest,
      provenanceDigest: generation.authority_json.provenanceDigest,
      sbomDigest: generation.authority_json.sbomDigest,
      receiptId
    };
  }

  private staticGenerationEvidence(plan: Extract<PluginManagerPlan, { executionClass: "static-release" }>, receipt: StaticDeploymentReceipt) {
    return {
      authority: "static-build" as const,
      generationId: receipt.activeGenerationId,
      version: plan.plan.version,
      sourceCommit: receipt.sourceCommit,
      compositionChangePlanDigest: receipt.compositionChangePlanDigest,
      buildEvidenceDigest: receipt.buildEvidenceDigest,
      applicationDigest: receipt.applicationDigest,
      imageDigest: receipt.imageDigest,
      migrationRevision: receipt.migrationRevision,
      workerFencingToken: receipt.workerFencingToken,
      receiptId: receipt.receiptId
    };
  }

  private async completeOperation(session: RuntimeExtensionSession, row: OperationRow, receipt: ExtensionManagerReceipt): Promise<void> {
    const completed = await session.query(
      `update runtime_extension_operations set phase='completed', result_json=$3::jsonb, updated_at=now() where operation_id=$1 and lease_token=$2 returning operation_id`,
      [row.operation_id, row.lease_token, JSON.stringify(receipt)]
    );
    if (completed.rowCount !== 1) fail("LEASE_CONFLICT", "Runtime extension completion lease changed.");
    await session.query(
      `update runtime_extension_operation_budget set active_count=greatest(active_count-1,0) where application_id=$1 and environment=$2`,
      [row.application_id, row.environment]
    );
  }

  private async appendTransition(session: RuntimeExtensionSession, row: OperationRow, phase: ExtensionOperationPhase, authority: VerifiedGenerationAuthority | undefined, staticGeneration?: Record<string, unknown>): Promise<ExtensionLifecycleEvent> {
    const identity = identityKey(row);
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
    const state = await session.query<{ revision: number }>(
      `update runtime_extensions set revision=revision+1, last_operation_id=$5, updated_at=now()
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 returning revision`,
      [row.application_id, row.environment, row.delivery_class, row.extension_id, row.operation_id]
    );
    const revision = state.rows[0]?.revision;
    if (!revision) fail("STATE_INVALID", "Runtime extension revision update failed.");
    const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
    return this.writeTransitionEvidence(session, row, phase, authority, revision, inventoryRevision, undefined, undefined, staticGeneration);
  }

  private async writeTransitionEvidence(
    session: RuntimeExtensionSession,
    row: OperationRow,
    phase: ExtensionOperationPhase,
    authority: VerifiedGenerationAuthority | undefined,
    revision: number,
    inventoryRevision: number,
    lifecycle?: ExtensionLifecycleEvent["lifecycleState"],
    staticReceipt?: StaticDeploymentReceipt,
    staticGeneration?: Record<string, unknown>
  ): Promise<ExtensionLifecycleEvent> {
    const ids = evidenceIds(row, revision);
    const receiptId = staticReceipt?.receiptId ?? ids.receiptId;
    const { auditId, eventId } = ids;
    const event = ExtensionLifecycleEventSchema.parse({
      schemaVersion: 1,
      applicationId: row.application_id,
      environment: row.environment,
      eventId,
      eventType: "extension.lifecycle-transition",
      operationId: row.operation_id,
      operation: row.operation_kind,
      operationPhase: phase,
      lifecycleState: lifecycle ?? lifecycleState(phase),
      expectedRevision: revision - 1,
      revision,
      inventoryRevision,
      actor: row.authorization_json.actor,
      receiptId,
      auditId,
      idempotencyKey: row.request_json.idempotencyKey,
      correlationId: row.request_json.correlationId,
      occurredAt: timestamp(this.clock),
      deliveryClass: row.delivery_class,
      id: row.extension_id,
      evidence: transitionEvidence(row, authority ?? row.authority_json ?? undefined, staticReceipt, staticGeneration)
    });
    const eventJson = JSON.stringify(event);
    await session.query(
      `insert into runtime_extension_transition_receipts (receipt_id, operation_id, revision, event_json) values ($1,$2,$3,$4::jsonb)`,
      [receiptId, row.operation_id, revision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_audit (audit_id, operation_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [auditId, row.operation_id, row.application_id, row.environment, row.delivery_class, row.extension_id, revision, inventoryRevision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_outbox (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [eventId, row.application_id, row.environment, row.delivery_class, row.extension_id, revision, inventoryRevision, eventJson]
    );
    await session.query(
      `update runtime_extensions set last_receipt_id=$5, state_digest=$6 where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
      [row.application_id, row.environment, row.delivery_class, row.extension_id, receiptId, await sha256(event)]
    );
    return event;
  }
}
