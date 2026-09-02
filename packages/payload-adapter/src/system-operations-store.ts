import {
  AuthorizationSubjectSchema,
  OperationsCenterReceiptSchema,
  OperationsCenterRequestSchema,
  canonicalJson,
  type OperationsCenterReceipt,
  type OperationsCenterRequest
} from "@k-nex/contracts";

import type { SystemOperationKind, SystemOperationsOperator } from "@k-nex/runtime";
import type { RuntimeExtensionClock, RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export type SystemOperationsStoreErrorCode = "INVALID" | "REVISION_CONFLICT" | "INVENTORY_CHANGED" | "LEASE_CONFLICT" | "PROOF_INVALID";
export class SystemOperationsStoreError extends Error {
  constructor(readonly code: SystemOperationsStoreErrorCode, message: string) { super(message); this.name = "SystemOperationsStoreError"; }
}

interface StateRow { operations_revision: number; inventory_digest: string; }
interface RequestRow { operation_id: string; request_json: unknown; state: "pending" | "processing" | "terminal"; lease_token: string | null; }
interface ReceiptRow { receipt_json: unknown; }

export interface ClaimedSystemOperation { readonly request: OperationsCenterRequest; readonly leaseToken: string; }
export interface SystemOperationCompletionProof {
  readonly outcome: "completed" | "failed";
  readonly referenceReceiptId: string;
  readonly cleanEnvironmentRestore?: true;
  readonly reason?: "operator-unavailable" | "verification-failed";
}

export interface TrustedSystemOperationExecutor {
  execute(request: OperationsCenterRequest): Promise<Readonly<{ referenceReceiptId: string; cleanEnvironmentRestore: true }>>;
}

export class PostgresSystemOperationsStore implements SystemOperationsOperator {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly clock: RuntimeExtensionClock) {}

  async initialize(input: Readonly<{ applicationId: string; environment: string; inventoryDigest: string }>): Promise<void> {
    assertScope(input.applicationId, input.environment, input.inventoryDigest);
    await this.pool.query(
      `insert into k_nex_system_operations_state (application_id, environment, inventory_digest) values ($1,$2,$3)
       on conflict (application_id, environment) do nothing`,
      [input.applicationId, input.environment, input.inventoryDigest]
    );
  }

  async state(applicationId: string, environment: string): Promise<Readonly<{ operationsRevision: number; inventoryDigest: string }> | undefined> {
    assertScope(applicationId, environment);
    const result = await this.pool.query<StateRow>(`select operations_revision, inventory_digest from k_nex_system_operations_state where application_id=$1 and environment=$2`, [applicationId, environment]);
    const row = result.rows[0];
    return row ? Object.freeze({ operationsRevision: row.operations_revision, inventoryDigest: row.inventory_digest }) : undefined;
  }

  async observeInventory(input: Readonly<{ applicationId: string; environment: string; expectedOperationsRevision: number; expectedInventoryDigest: string; inventoryDigest: string }>): Promise<number> {
    assertScope(input.applicationId, input.environment, input.inventoryDigest);
    assertDigest(input.expectedInventoryDigest);
    assertRevision(input.expectedOperationsRevision);
    return this.transaction(async (session) => {
      const state = await this.lockState(session, input.applicationId, input.environment);
      if (state.operations_revision !== input.expectedOperationsRevision || state.inventory_digest !== input.expectedInventoryDigest) fail("REVISION_CONFLICT", "Operations inventory observation is stale.");
      if (state.inventory_digest === input.inventoryDigest) return state.operations_revision;
      const revision = state.operations_revision + 1;
      await session.query(`update k_nex_system_operations_state set operations_revision=$3, inventory_digest=$4, updated_at=now() where application_id=$1 and environment=$2`, [input.applicationId, input.environment, revision, input.inventoryDigest]);
      await this.outbox(session, input.applicationId, input.environment, revision, { type: "operations.inventory", inventoryDigest: input.inventoryDigest });
      return revision;
    });
  }

  async replay(input: Readonly<{ kind: SystemOperationKind; applicationId: string; environment: string; expectedOperationsRevision: number; requestedBy: OperationsCenterRequest["requestedBy"]; idempotencyKey: string }>): Promise<OperationsCenterReceipt | undefined> {
    assertScope(input.applicationId, input.environment);
    const requestedBy = AuthorizationSubjectSchema.parse(input.requestedBy);
    assertRevision(input.expectedOperationsRevision);
    if ((input.kind !== "backup" && input.kind !== "restore-drill") || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(input.idempotencyKey)) fail("INVALID", "System operation replay is invalid.");
    const request = await this.pool.query<RequestRow>(`select operation_id, request_json, state, lease_token from k_nex_system_operation_requests where application_id=$1 and environment=$2 and kind=$3 and idempotency_key=$4`, [input.applicationId, input.environment, input.kind, input.idempotencyKey]);
    if (!request.rows[0]) return undefined;
    const parsed = OperationsCenterRequestSchema.parse(request.rows[0].request_json);
    if (parsed.expectedOperationsRevision !== input.expectedOperationsRevision || parsed.requestedBy.kind !== requestedBy.kind || parsed.requestedBy.id !== requestedBy.id) fail("REVISION_CONFLICT", "System operation replay binding changed.");
    const receipt = await this.pool.query<ReceiptRow>(`select receipt_json from k_nex_system_operation_receipts where operation_id=$1 order by terminal desc limit 1`, [request.rows[0].operation_id]);
    if (!receipt.rows[0]) fail("INVALID", "System operation replay receipt is unavailable.");
    return Object.freeze(OperationsCenterReceiptSchema.parse(receipt.rows[0].receipt_json));
  }

  async submit(input: Parameters<SystemOperationsOperator["submit"]>[0]): Promise<OperationsCenterReceipt> {
    assertScope(input.applicationId, input.environment, input.expectedInventoryDigest);
    assertRevision(input.expectedOperationsRevision);
    if (input.kind !== "backup" && input.kind !== "restore-drill" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(input.idempotencyKey)) fail("INVALID", "System operation request is invalid.");
    const requestedBy = AuthorizationSubjectSchema.parse(input.requestedBy);
    return this.transaction(async (session) => {
      const state = await this.lockState(session, input.applicationId, input.environment);
      const replay = await session.query<RequestRow>(
        `select operation_id, request_json, state, lease_token from k_nex_system_operation_requests where application_id=$1 and environment=$2 and kind=$3 and idempotency_key=$4 for update`,
        [input.applicationId, input.environment, input.kind, input.idempotencyKey]
      );
      if (replay.rows[0]) {
        const request = OperationsCenterRequestSchema.parse(replay.rows[0].request_json);
        if (request.expectedInventoryDigest !== input.expectedInventoryDigest || request.requestedBy.kind !== requestedBy.kind || request.requestedBy.id !== requestedBy.id) fail("REVISION_CONFLICT", "System operation idempotency key is bound to another request.");
        return this.latestReceipt(session, replay.rows[0].operation_id);
      }
      if (state.operations_revision !== input.expectedOperationsRevision) fail("REVISION_CONFLICT", "System operation revision changed.");
      if (state.inventory_digest !== input.expectedInventoryDigest) fail("INVENTORY_CHANGED", "System operation inventory changed.");
      const fingerprint = { ...input, requestedBy };
      const operationId = await identifier(`${input.kind}-operation`, fingerprint);
      const requestId = await identifier(`${input.kind}-request`, fingerprint);
      const createdAt = timestamp(this.clock);
      const request = OperationsCenterRequestSchema.parse({ schemaVersion: 1, requestId, applicationId: input.applicationId, environment: input.environment, kind: input.kind,
        expectedOperationsRevision: input.expectedOperationsRevision, expectedInventoryDigest: input.expectedInventoryDigest, requestedBy, idempotencyKey: input.idempotencyKey,
        reference: { source: input.kind, operationId }, createdAt });
      const receipt = OperationsCenterReceiptSchema.parse({ schemaVersion: 1, receiptId: await identifier(`${input.kind}-accepted`, fingerprint), requestId,
        applicationId: input.applicationId, environment: input.environment, kind: input.kind, expectedInventoryDigest: input.expectedInventoryDigest,
        requestedBy, idempotencyKey: input.idempotencyKey, reference: request.reference, outcome: "accepted", reason: "accepted", occurredAt: createdAt });
      await session.query(
        `insert into k_nex_system_operation_requests (operation_id, request_id, application_id, environment, kind, expected_operations_revision, expected_inventory_digest, idempotency_key, request_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [operationId, requestId, input.applicationId, input.environment, input.kind, input.expectedOperationsRevision, input.expectedInventoryDigest, input.idempotencyKey, JSON.stringify(request)]
      );
      await this.receipt(session, operationId, receipt, false);
      await this.advance(session, request, receipt, "accepted", state.operations_revision + 1);
      return Object.freeze(receipt);
    });
  }

  async claim(input: Readonly<{ applicationId: string; environment: string; workerId: string; leaseSeconds: number }>): Promise<ClaimedSystemOperation | undefined> {
    assertScope(input.applicationId, input.environment);
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(input.workerId) || !Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 1 || input.leaseSeconds > 300) fail("INVALID", "System operation lease is invalid.");
    return this.transaction(async (session) => {
      const selected = await session.query<RequestRow>(
        `select operation_id, request_json, state, lease_token from k_nex_system_operation_requests
         where application_id=$1 and environment=$2 and (state='pending' or (state='processing' and lease_expires_at<=now()))
         order by created_at, operation_id for update skip locked limit 1`, [input.applicationId, input.environment]
      );
      const row = selected.rows[0];
      if (!row) return undefined;
      const leaseToken = `lease-${crypto.randomUUID().replaceAll("-", "")}`;
      await session.query(`update k_nex_system_operation_requests set state='processing', lease_owner=$2, lease_token=$3, lease_expires_at=now()+($4::text||' seconds')::interval, updated_at=now() where operation_id=$1`, [row.operation_id, input.workerId, leaseToken, input.leaseSeconds]);
      return Object.freeze({ request: Object.freeze(OperationsCenterRequestSchema.parse(row.request_json)), leaseToken });
    });
  }

  async complete(operationId: string, leaseToken: string, proof: SystemOperationCompletionProof): Promise<OperationsCenterReceipt> {
    if (!validId(operationId) || !/^lease-[0-9a-f]{32}$/u.test(leaseToken) || !validId(proof.referenceReceiptId) ||
      proof.outcome === "failed" && !["operator-unavailable", "verification-failed"].includes(proof.reason ?? "") ||
      proof.outcome === "completed" && (proof.reason !== undefined || proof.cleanEnvironmentRestore !== true)) fail("PROOF_INVALID", "System operation completion proof is invalid.");
    return this.transaction(async (session) => {
      const result = await session.query<RequestRow>(`select operation_id, request_json, state, lease_token from k_nex_system_operation_requests where operation_id=$1 for update`, [operationId]);
      const row = result.rows[0];
      if (!row) fail("LEASE_CONFLICT", "System operation is unavailable.");
      if (row.state === "terminal") return this.latestReceipt(session, operationId);
      if (row.state !== "processing" || row.lease_token !== leaseToken) fail("LEASE_CONFLICT", "System operation lease is stale.");
      const request = OperationsCenterRequestSchema.parse(row.request_json);
      const state = await this.lockState(session, request.applicationId, request.environment);
      if (state.inventory_digest !== request.expectedInventoryDigest) fail("INVENTORY_CHANGED", "System operation inventory changed before completion.");
      const occurredAt = timestamp(this.clock);
      const receipt = OperationsCenterReceiptSchema.parse({ schemaVersion: 1, receiptId: await identifier(`${request.kind}-${proof.outcome}`, { operationId, proof }), requestId: request.requestId,
        applicationId: request.applicationId, environment: request.environment, kind: request.kind, expectedInventoryDigest: request.expectedInventoryDigest,
        requestedBy: request.requestedBy, idempotencyKey: request.idempotencyKey, reference: { source: request.kind, operationId, receiptId: proof.referenceReceiptId },
        outcome: proof.outcome, reason: proof.outcome === "completed" ? "completed" : proof.reason, occurredAt });
      await session.query(`update k_nex_system_operation_requests set state='terminal', lease_owner=null, lease_token=null, lease_expires_at=null, updated_at=now() where operation_id=$1`, [operationId]);
      await this.receipt(session, operationId, receipt, true);
      await this.advance(session, request, receipt, proof.outcome, state.operations_revision + 1);
      return Object.freeze(receipt);
    });
  }

  private async latestReceipt(session: RuntimeExtensionSession, operationId: string): Promise<OperationsCenterReceipt> {
    const result = await session.query<ReceiptRow>(`select receipt_json from k_nex_system_operation_receipts where operation_id=$1 order by terminal desc limit 1`, [operationId]);
    if (!result.rows[0]) fail("INVALID", "System operation receipt is unavailable.");
    return Object.freeze(OperationsCenterReceiptSchema.parse(result.rows[0].receipt_json));
  }

  private async receipt(session: RuntimeExtensionSession, operationId: string, receipt: OperationsCenterReceipt, terminal: boolean): Promise<void> {
    await session.query(`insert into k_nex_system_operation_receipts (receipt_id, operation_id, request_id, application_id, environment, terminal, receipt_json, occurred_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)`, [receipt.receiptId, operationId, receipt.requestId, receipt.applicationId, receipt.environment, terminal, JSON.stringify(receipt), receipt.occurredAt]);
  }

  private async advance(session: RuntimeExtensionSession, request: OperationsCenterRequest, receipt: OperationsCenterReceipt, outcome: "accepted" | "completed" | "failed", revision: number): Promise<void> {
    await session.query(`update k_nex_system_operations_state set operations_revision=$3, updated_at=now() where application_id=$1 and environment=$2`, [request.applicationId, request.environment, revision]);
    const auditId = await identifier("operations-audit", { operationId: request.reference.operationId, outcome, revision });
    await session.query(`insert into k_nex_system_operation_audit (audit_id, application_id, environment, operation_id, kind, outcome, operations_revision, requested_by_kind, requested_by_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)`, [auditId, request.applicationId, request.environment, request.reference.operationId, request.kind, outcome, revision, request.requestedBy.kind, request.requestedBy.id, receipt.occurredAt]);
    await this.outbox(session, request.applicationId, request.environment, revision, { type: "operations.receipt", operationId: request.reference.operationId, receipt });
  }

  private async outbox(session: RuntimeExtensionSession, applicationId: string, environment: string, revision: number, event: unknown): Promise<void> {
    const eventId = await identifier("operations-event", { applicationId, environment, revision, event });
    await session.query(`insert into k_nex_system_operation_outbox (event_id, application_id, environment, operations_revision, event_json) values ($1,$2,$3,$4,$5::jsonb)`, [eventId, applicationId, environment, revision, JSON.stringify(event)]);
  }

  private async lockState(session: RuntimeExtensionSession, applicationId: string, environment: string): Promise<StateRow> {
    const result = await session.query<StateRow>(`select operations_revision, inventory_digest from k_nex_system_operations_state where application_id=$1 and environment=$2 for update`, [applicationId, environment]);
    if (!result.rows[0]) fail("REVISION_CONFLICT", "System operations state is unavailable.");
    return result.rows[0];
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try { await session.query("begin"); const value = await work(session); await session.query("commit"); return value; }
    catch (error) { try { await session.query("rollback"); } catch {} throw error; }
    finally { session.release(); }
  }
}

/** Runs only in the separate trusted operator process; web receives the store's submit/replay facade, never this executor. */
export class SystemOperationsWorker {
  constructor(private readonly store: PostgresSystemOperationsStore, private readonly executor: TrustedSystemOperationExecutor) {}

  async runNext(input: Readonly<{ applicationId: string; environment: string; workerId: string; leaseSeconds: number }>): Promise<OperationsCenterReceipt | undefined> {
    const claimed = await this.store.claim(input);
    if (!claimed) return undefined;
    try {
      const proof = await this.executor.execute(claimed.request);
      return this.store.complete(claimed.request.reference.operationId, claimed.leaseToken, { outcome: "completed", referenceReceiptId: proof.referenceReceiptId, cleanEnvironmentRestore: proof.cleanEnvironmentRestore });
    } catch {
      return this.store.complete(claimed.request.reference.operationId, claimed.leaseToken, { outcome: "failed", reason: "operator-unavailable", referenceReceiptId: `${claimed.request.kind}-failure-receipt` });
    }
  }
}

function assertScope(applicationId: string, environment: string, digest?: string): void {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(environment)) fail("INVALID", "System operations scope is invalid.");
  if (digest !== undefined) assertDigest(digest);
}
function assertDigest(value: string): void { if (!/^sha256:[0-9a-f]{64}$/u.test(value)) fail("INVALID", "System operations inventory digest is invalid."); }
function assertRevision(value: number): void { if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) fail("INVALID", "System operations revision is invalid."); }
function validId(value: string): boolean { return /^[a-z][a-z0-9-]{2,127}$/u.test(value); }
function timestamp(clock: RuntimeExtensionClock): string { const value = clock.now(); if (!(value instanceof Date) || Number.isNaN(value.valueOf())) fail("INVALID", "System operations clock is invalid."); return value.toISOString(); }
async function identifier(prefix: string, value: unknown): Promise<string> { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value))); const hex = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); return `${prefix}-${hex.slice(0, 32)}`; }
function fail(code: SystemOperationsStoreErrorCode, message: string): never { throw new SystemOperationsStoreError(code, message); }
