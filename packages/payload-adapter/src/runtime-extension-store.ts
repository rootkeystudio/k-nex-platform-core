import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  ExtensionLifecycleEventSchema,
  RuntimeExtensionInventorySchema,
  type ExtensionLifecycleEvent,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";
import type {
  ClaimOperationResult,
  ExtensionOperationPhase,
  PluginManagerPlan,
  RuntimeExtensionOperation,
  RuntimeExtensionStore,
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
  constructor(readonly code: "REVISION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "OPERATION_IN_PROGRESS" | "OPERATION_NOT_FOUND" | "LEASE_CONFLICT" | "PHASE_CONFLICT" | "GLOBAL_BUDGET_EXHAUSTED" | "STATE_INVALID", message: string) {
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
  phase: ExtensionOperationPhase;
  lease_owner: string;
  lease_token: string;
  lease_expires_at: Date | string;
  plan_json: PluginManagerPlan | null;
  authority_json: VerifiedGenerationAuthority | null;
}

interface ExtensionRow {
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  revision: number;
  disposition: "active" | "disabled" | "quarantined" | "retirement-pending" | "removed";
  active_generation: Record<string, unknown> | null;
  rollback_generation: Record<string, unknown> | null;
  retained_generation: Record<string, unknown> | null;
  last_operation_id: string | null;
  last_receipt_id: string | null;
  state_digest: string | null;
  inventory_revision: number;
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
    ...(row.authority_json ? { authority: Object.freeze(row.authority_json) } : {})
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

function operationId(requestDigest: string): string {
  return `operation-${requestDigest.slice("sha256:".length, "sha256:".length + 32)}`;
}

function identityKey(row: Pick<OperationRow, "application_id" | "environment" | "delivery_class" | "extension_id">): string {
  return canonicalJson([row.application_id, row.environment, row.delivery_class, row.extension_id]);
}

function transitionEvidence(row: OperationRow, authority: VerifiedGenerationAuthority | undefined) {
  const plan = row.plan_json;
  if (!plan) fail("STATE_INVALID", "A lifecycle transition requires a persisted plan.");
  if (plan.executionClass === "static-release") {
    return {
      sourceCommit: plan.sourceChange.targetSourceCommit,
      compositionChangePlanDigest: plan.sourceChange.planDigest,
      buildRequestDigest: plan.deployment.buildRequestDigest,
      generationId: plan.generationId
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
      const state = await session.query<{ revision: number }>(
        `select revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
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
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set plan_json=$3::jsonb, updated_at=now() where operation_id=$1 and lease_token=$2 returning *`,
        [id, token, JSON.stringify(plan)]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension plan lease changed.");
      await this.appendTransition(session, saved, "planning", undefined);
      return operation(saved);
    });
  }

  async transition(input: Parameters<RuntimeExtensionStore["transition"]>[0]) {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.phase !== input.expectedPhase) fail("PHASE_CONFLICT", "Runtime extension operation phase changed.");
      if (!allowedTransitions[row.phase].includes(input.phase)) fail("PHASE_CONFLICT", `Runtime extension transition ${row.phase} -> ${input.phase} is invalid.`);
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

  async readOperation(id: string): Promise<RuntimeExtensionOperation | undefined> {
    const result = await this.pool.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1`, [id]);
    return result.rows[0] ? operation(result.rows[0]) : undefined;
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

  private async appendTransition(session: RuntimeExtensionSession, row: OperationRow, phase: ExtensionOperationPhase, authority: VerifiedGenerationAuthority | undefined): Promise<ExtensionLifecycleEvent> {
    const identity = identityKey(row);
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
    const state = await session.query<{ revision: number }>(
      `update runtime_extensions set revision=revision+1, last_operation_id=$5, updated_at=now()
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 returning revision`,
      [row.application_id, row.environment, row.delivery_class, row.extension_id, row.operation_id]
    );
    const revision = state.rows[0]?.revision;
    if (!revision) fail("STATE_INVALID", "Runtime extension revision update failed.");
    const inventoryState = await session.query<{ revision: number }>(
      `update runtime_extension_inventory_revisions set revision=revision+1 where application_id=$1 and environment=$2 returning revision`,
      [row.application_id, row.environment]
    );
    const inventoryRevision = inventoryState.rows[0]?.revision;
    if (!inventoryRevision) fail("STATE_INVALID", "Runtime extension inventory revision update failed.");
    const receiptId = `receipt-${row.operation_id.slice("operation-".length)}-${revision}`;
    const auditId = `audit-${row.operation_id.slice("operation-".length)}-${revision}`;
    const eventId = `event-${row.operation_id.slice("operation-".length)}-${revision}`;
    const event = ExtensionLifecycleEventSchema.parse({
      schemaVersion: 1,
      applicationId: row.application_id,
      environment: row.environment,
      eventId,
      eventType: "extension.lifecycle-transition",
      operationId: row.operation_id,
      operation: row.operation_kind,
      operationPhase: phase,
      lifecycleState: lifecycleState(phase),
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
      evidence: transitionEvidence(row, authority ?? row.authority_json ?? undefined)
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
