import { randomUUID } from "node:crypto";

import { ResourceIdSchema, canonicalJson } from "@k-nex/contracts";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export interface WorkspaceNavigationInvalidation {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly eventType: "workspace-navigation.changed";
  readonly operation: "create" | "update";
  readonly applicationId: string;
  readonly environment: string;
  readonly folderId: string;
  readonly folderRevision: number;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
  readonly occurredAt: string;
}

export interface WorkspaceNavigationInvalidationSink {
  publish(invalidation: WorkspaceNavigationInvalidation, signal: AbortSignal): Promise<void>;
}

export interface WorkspaceNavigationOutboxDispatchOptions {
  readonly applicationId: string;
  readonly environment: string;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly publishTimeoutMs?: number;
}

export interface WorkspaceNavigationOutboxWorkerOptions {
  readonly batchSize?: number;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export type DispatchWorkspaceNavigationOutboxResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ eventId: string; invalidation: WorkspaceNavigationInvalidation; status: "delivered" }>;

interface WorkspaceNavigationOutboxRow {
  event_id: string;
  application_id: string;
  environment: string;
  folder_id: string;
  operation_kind: string;
  folder_revision: number;
  authorization_revision: number;
  lifecycle_revision: number;
  event_json: unknown;
  attempt_count: number;
  claim_token: string;
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_LEASE_MS = 35_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_PUBLISH_TIMEOUT_MS = 30_000;
const MAX_DURATION_MS = 60 * 60 * 1_000;

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 1_000_000_000;
}

function validAuthorityRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000;
}

export function parseWorkspaceNavigationInvalidation(value: unknown): WorkspaceNavigationInvalidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Workspace navigation invalidation is invalid.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.eventType !== "workspace-navigation.changed" || typeof record.eventId !== "string" || !eventIdPattern.test(record.eventId) ||
    (record.operation !== "create" && record.operation !== "update") || typeof record.applicationId !== "string" || !applicationPattern.test(record.applicationId) ||
    typeof record.environment !== "string" || !environmentPattern.test(record.environment) || !ResourceIdSchema.safeParse(record.folderId).success || !validRevision(record.folderRevision) || !validAuthorityRevision(record.authorizationRevision) || !validAuthorityRevision(record.lifecycleRevision) ||
    typeof record.occurredAt !== "string" || new Date(record.occurredAt).toISOString() !== record.occurredAt) throw new Error("Workspace navigation invalidation is invalid.");
  const event = Object.freeze({
    schemaVersion: 1 as const, eventId: record.eventId, eventType: "workspace-navigation.changed" as const,
    operation: record.operation, applicationId: record.applicationId, environment: record.environment,
    folderId: record.folderId as string, folderRevision: record.folderRevision,
    authorizationRevision: record.authorizationRevision, lifecycleRevision: record.lifecycleRevision, occurredAt: record.occurredAt
  });
  if (canonicalJson(event) !== canonicalJson(value)) throw new Error("Workspace navigation invalidation is not canonical.");
  return event;
}

function persistedInvalidation(row: WorkspaceNavigationOutboxRow): WorkspaceNavigationInvalidation {
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1 || typeof row.claim_token !== "string" || row.claim_token.length === 0) throw new Error("Workspace navigation outbox claim is invalid.");
  const event = parseWorkspaceNavigationInvalidation(row.event_json);
  if (event.eventId !== row.event_id || event.applicationId !== row.application_id || event.environment !== row.environment || event.folderId !== row.folder_id || event.operation !== row.operation_kind || event.folderRevision !== row.folder_revision || event.authorizationRevision !== row.authorization_revision || event.lifecycleRevision !== row.lifecycle_revision) {
    throw new Error("Workspace navigation outbox event does not match its persisted invalidation identity.");
  }
  return event;
}

async function publishWithTimeout(sink: WorkspaceNavigationInvalidationSink, message: WorkspaceNavigationInvalidation, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sink.publish(message, controller.signal),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error("Workspace navigation outbox publication timed out.")); }, timeoutMs); })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

/** Writes a canonical navigation signal beside the folder change in its transaction. */
export async function writeWorkspaceNavigationInvalidationOutbox(session: Pick<RuntimeExtensionSession, "query">, value: WorkspaceNavigationInvalidation): Promise<void> {
  const event = parseWorkspaceNavigationInvalidation(value);
  await session.query(
    `insert into k_nex_workspace_navigation_outbox (event_id, application_id, environment, folder_id, operation_kind, folder_revision, authorization_revision, lifecycle_revision, event_json)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [event.eventId, event.applicationId, event.environment, event.folderId, event.operation, event.folderRevision, event.authorizationRevision, event.lifecycleRevision, canonicalJson(event)]
  );
}

/** Publishes durable navigation signals at least once; readers also poll current navigation. */
export class PostgresWorkspaceNavigationOutboxDispatcher {
  private readonly applicationId: string;
  private readonly environment: string;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly publishTimeoutMs: number;

  constructor(private readonly pool: RuntimeExtensionPool, options: WorkspaceNavigationOutboxDispatchOptions) {
    if (!applicationPattern.test(options.applicationId) || !environmentPattern.test(options.environment)) throw new TypeError("Workspace navigation outbox identity is invalid.");
    this.applicationId = options.applicationId;
    this.environment = options.environment;
    this.leaseMs = boundedInteger(options.leaseMs ?? DEFAULT_LEASE_MS, "leaseMs", 1, MAX_DURATION_MS);
    this.maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "maxAttempts", 1, 20);
    this.publishTimeoutMs = boundedInteger(options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS, "publishTimeoutMs", 1, MAX_DURATION_MS);
    if (this.leaseMs <= this.publishTimeoutMs) throw new RangeError("leaseMs must exceed publishTimeoutMs.");
  }

  async dispatchNext(sink: WorkspaceNavigationInvalidationSink): Promise<DispatchWorkspaceNavigationOutboxResult> {
    const token = randomUUID();
    await this.deadLetterExhausted();
    const selected = await this.pool.query<WorkspaceNavigationOutboxRow>(
      `with candidate as (select event_id from k_nex_workspace_navigation_outbox where application_id=$2 and environment=$3 and attempt_count < $1 and (status='pending' or (status='processing' and lease_expires_at <= now())) order by attempt_count, folder_revision, event_id for update skip locked limit 1) update k_nex_workspace_navigation_outbox as event set status='processing', claimed_at=now(), lease_expires_at=now() + ($4 * interval '1 millisecond'), claim_token=$5, attempt_count=event.attempt_count + 1 from candidate where event.event_id=candidate.event_id returning event.event_id, event.application_id, event.environment, event.folder_id, event.operation_kind, event.folder_revision, event.authorization_revision, event.lifecycle_revision, event.event_json, event.attempt_count, event.claim_token`,
      [this.maxAttempts, this.applicationId, this.environment, this.leaseMs, token]
    );
    const row = selected.rows[0];
    if (!row) return Object.freeze({ status: "idle" });
    try {
      const message = persistedInvalidation(row);
      await publishWithTimeout(sink, message, this.publishTimeoutMs);
      const delivered = await this.pool.query(`update k_nex_workspace_navigation_outbox set status='delivered', claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code=null where event_id=$1 and status='processing' and claim_token=$2`, [row.event_id, row.claim_token]);
      if (delivered.rowCount !== 1) throw new Error("Workspace navigation outbox claim was lost.");
      return Object.freeze({ eventId: row.event_id, invalidation: message, status: "delivered" });
    } catch (error) {
      const terminal = row.attempt_count >= this.maxAttempts;
      try { await this.pool.query(`update k_nex_workspace_navigation_outbox set status=$3::varchar, claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code='DELIVERY_FAILED', dead_lettered_at=case when $3::varchar='dead-letter' then now() else null end where event_id=$1 and status='processing' and claim_token=$2`, [row.event_id, row.claim_token, terminal ? "dead-letter" : "pending"]); } catch { /* preserve publication error */ }
      throw error;
    }
  }

  private async deadLetterExhausted(): Promise<void> {
    await this.pool.query(
      `with candidate as (select event_id from k_nex_workspace_navigation_outbox where application_id=$2 and environment=$3 and attempt_count >= $1 and (status='pending' or (status='processing' and lease_expires_at <= now())) order by folder_revision, event_id for update skip locked limit 1) update k_nex_workspace_navigation_outbox as event set status='dead-letter', dead_lettered_at=now(), claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code='DELIVERY_FAILED' from candidate where event.event_id=candidate.event_id`,
      [this.maxAttempts, this.applicationId, this.environment]
    );
  }
}

/** Owns one bounded non-overlapping navigation dispatcher loop. */
export class WorkspaceNavigationOutboxWorker {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly schedule: (work: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private running = false;
  private lifecycle = 0;
  private timer: unknown;
  private draining: Promise<number> | undefined;

  constructor(private readonly dispatcher: Pick<PostgresWorkspaceNavigationOutboxDispatcher, "dispatchNext">, private readonly sink: WorkspaceNavigationInvalidationSink, private readonly options: WorkspaceNavigationOutboxWorkerOptions = {}) {
    this.batchSize = boundedInteger(options.batchSize ?? 100, "batchSize", 1, 1_000);
    this.intervalMs = boundedInteger(options.intervalMs ?? 1_000, "intervalMs", 10, 300_000);
    this.schedule = options.schedule ?? ((work, delayMs) => setTimeout(work, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start(): void { if (!this.running) { this.running = true; void this.runAndSchedule(++this.lifecycle); } }
  stop(): void { this.running = false; ++this.lifecycle; if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined; }
  get started(): boolean { return this.running; }

  drain(): Promise<number> {
    if (this.draining) return this.draining;
    const operation = this.drainBatch().finally(() => { if (this.draining === operation) this.draining = undefined; });
    this.draining = operation;
    return operation;
  }

  private async drainBatch(): Promise<number> {
    let delivered = 0;
    while (delivered < this.batchSize) {
      const result = await this.dispatcher.dispatchNext(this.sink);
      if (result.status === "idle") break;
      delivered += 1;
    }
    return delivered;
  }

  private async runAndSchedule(lifecycle: number): Promise<void> {
    try { await this.drain(); } catch (error) { this.options.onError?.(error); }
    finally {
      if (!this.running || this.lifecycle !== lifecycle) return;
      this.timer = this.schedule(() => { this.timer = undefined; void this.runAndSchedule(lifecycle); }, this.intervalMs);
    }
  }
}
