import { randomUUID } from "node:crypto";

import { AuthorizationStateSchema, canonicalJson } from "@k-nex/contracts";
import type { AuthorizationRevisionInvalidation } from "@k-nex/runtime";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export type AuthorizationInvalidation = AuthorizationRevisionInvalidation;

export interface AuthorizationInvalidationSink {
  publish(invalidation: AuthorizationInvalidation, signal: AbortSignal): Promise<void>;
}

export interface AuthorizationOutboxDispatchOptions {
  readonly applicationId: string;
  readonly environment: string;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly publishTimeoutMs?: number;
}

export interface AuthorizationOutboxWorkerOptions {
  readonly batchSize?: number;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export type DispatchAuthorizationOutboxResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ eventId: string; invalidation: AuthorizationInvalidation; status: "delivered" }>;

interface AuthorizationOutboxRow {
  event_id: string;
  application_id: string;
  environment: string;
  authorization_revision: number;
  lifecycle_revision: number;
  event_json: unknown;
  attempt_count: number;
  claim_token: string;
}

const DEFAULT_LEASE_MS = 35_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_PUBLISH_TIMEOUT_MS = 30_000;
const MAX_DURATION_MS = 60 * 60 * 1_000;

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function invalidation(value: unknown): AuthorizationInvalidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Authorization invalidation is invalid.");
  const record = value as Record<string, unknown>;
  const parsed = AuthorizationStateSchema.safeParse({
    schemaVersion: 1,
    applicationId: record.applicationId,
    environment: record.environment,
    authorizationRevision: record.authorizationRevision,
    lifecycleRevision: record.lifecycleRevision
  });
  if (!parsed.success || record.scope !== "application" && record.scope !== "environment") throw new Error("Authorization invalidation is invalid.");
  const result = Object.freeze({
    applicationId: parsed.data.applicationId,
    environment: parsed.data.environment,
    scope: record.scope,
    authorizationRevision: parsed.data.authorizationRevision,
    lifecycleRevision: parsed.data.lifecycleRevision
  });
  return result;
}

function claimed(row: AuthorizationOutboxRow): AuthorizationOutboxRow {
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1 || typeof row.claim_token !== "string" || row.claim_token.length === 0) {
    throw new Error("Authorization outbox claim is invalid.");
  }
  return row;
}

function persistedInvalidation(row: AuthorizationOutboxRow): AuthorizationInvalidation {
  const event = invalidation(row.event_json);
  if (canonicalJson(event) !== canonicalJson(row.event_json)) throw new Error("Authorization outbox event is not canonical.");
  if (event.applicationId !== row.application_id || event.environment !== row.environment ||
    event.authorizationRevision !== row.authorization_revision || event.lifecycleRevision !== row.lifecycle_revision) {
    throw new Error("Authorization outbox event does not match its persisted invalidation identity.");
  }
  return event;
}

async function publishWithTimeout(sink: AuthorizationInvalidationSink, message: AuthorizationInvalidation, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sink.publish(message, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Authorization outbox publication timed out."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

/** Writes the opaque invalidation beside the revision update in the caller's transaction. */
export async function writeAuthorizationInvalidationOutbox(session: Pick<RuntimeExtensionSession, "query">, value: AuthorizationInvalidation): Promise<void> {
  const event = invalidation(value);
  await session.query(
    `insert into k_nex_authorization_outbox (event_id, application_id, environment, authorization_revision, lifecycle_revision, event_json)
     values ($1,$2,$3,$4,$5,$6::jsonb)
     on conflict (application_id, environment, authorization_revision, lifecycle_revision) do nothing`,
    [randomUUID(), event.applicationId, event.environment, event.authorizationRevision, event.lifecycleRevision, canonicalJson(event)]
  );
}

/** Publishes opaque authorization invalidations at least once with a short durable lease. */
export class PostgresAuthorizationOutboxDispatcher {
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly publishTimeoutMs: number;
  private readonly applicationId: string;
  private readonly environment: string;

  constructor(private readonly pool: RuntimeExtensionPool, options: AuthorizationOutboxDispatchOptions) {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(options.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(options.environment)) throw new TypeError("Authorization outbox identity is invalid.");
    this.applicationId = options.applicationId;
    this.environment = options.environment;
    this.leaseMs = boundedInteger(options.leaseMs ?? DEFAULT_LEASE_MS, "leaseMs", 1, MAX_DURATION_MS);
    this.maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "maxAttempts", 1, 20);
    this.publishTimeoutMs = boundedInteger(options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS, "publishTimeoutMs", 1, MAX_DURATION_MS);
    if (this.leaseMs <= this.publishTimeoutMs) throw new RangeError("leaseMs must exceed publishTimeoutMs.");
  }

  async dispatchNext(sink: AuthorizationInvalidationSink): Promise<DispatchAuthorizationOutboxResult> {
    const token = randomUUID();
    await this.deadLetterExhausted();
    const row = await this.claim(token);
    if (!row) return Object.freeze({ status: "idle" });

    try {
      const message = persistedInvalidation(row);
      await publishWithTimeout(sink, message, this.publishTimeoutMs);
      const delivered = await this.pool.query(
        `update k_nex_authorization_outbox
         set status='delivered', claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code=null
         where event_id=$1 and status='processing' and claim_token=$2`,
        [row.event_id, row.claim_token]
      );
      if (delivered.rowCount !== 1) throw new Error("Authorization outbox claim was lost.");
      return Object.freeze({ eventId: row.event_id, invalidation: message, status: "delivered" });
    } catch (error) {
      try { await this.releaseFailedClaim(row); } catch { /* preserve the publication error */ }
      throw error;
    }
  }

  private async deadLetterExhausted(): Promise<void> {
    await this.pool.query(
      `with candidate as (
         select event_id from k_nex_authorization_outbox
         where application_id=$2 and environment=$3 and attempt_count >= $1 and (status='pending' or (status='processing' and lease_expires_at <= now()))
         order by authorization_revision, lifecycle_revision, event_id for update skip locked limit 1
       )
       update k_nex_authorization_outbox as event set status='dead-letter', dead_lettered_at=now(),
         claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code='DELIVERY_FAILED'
       from candidate where event.event_id=candidate.event_id`,
      [this.maxAttempts, this.applicationId, this.environment]
    );
  }

  private async claim(token: string): Promise<AuthorizationOutboxRow | undefined> {
    const selected = await this.pool.query<AuthorizationOutboxRow>(
      `with candidate as (
         select event_id from k_nex_authorization_outbox
         where application_id=$2 and environment=$3 and attempt_count < $1 and (status='pending' or (status='processing' and lease_expires_at <= now()))
         order by attempt_count, authorization_revision, lifecycle_revision, event_id for update skip locked limit 1
       )
       update k_nex_authorization_outbox as event set status='processing', claimed_at=now(),
         lease_expires_at=now() + ($4 * interval '1 millisecond'), claim_token=$5,
         attempt_count=event.attempt_count + 1
       from candidate where event.event_id=candidate.event_id
       returning event.event_id, event.application_id, event.environment, event.authorization_revision, event.lifecycle_revision,
         event.event_json, event.attempt_count, event.claim_token`,
      [this.maxAttempts, this.applicationId, this.environment, this.leaseMs, token]
    );
    return selected.rows[0] ? claimed(selected.rows[0]) : undefined;
  }

  private async releaseFailedClaim(row: AuthorizationOutboxRow): Promise<void> {
    const terminal = row.attempt_count >= this.maxAttempts;
    await this.pool.query(
      `update k_nex_authorization_outbox set status=$3::varchar, claimed_at=null, lease_expires_at=null, claim_token=null,
         last_error_code='DELIVERY_FAILED', dead_lettered_at=case when $3::varchar='dead-letter' then now() else null end
       where event_id=$1 and status='processing' and claim_token=$2`,
      [row.event_id, row.claim_token, terminal ? "dead-letter" : "pending"]
    );
  }
}

/** Owns one bounded non-overlapping dispatcher loop; PostgreSQL remains the durable queue. */
export class AuthorizationOutboxWorker {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly schedule: (work: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private running = false;
  private lifecycle = 0;
  private timer: unknown;
  private draining: Promise<number> | undefined;

  constructor(
    private readonly dispatcher: Pick<PostgresAuthorizationOutboxDispatcher, "dispatchNext">,
    private readonly sink: AuthorizationInvalidationSink,
    private readonly options: AuthorizationOutboxWorkerOptions = {}
  ) {
    this.batchSize = boundedInteger(options.batchSize ?? 100, "batchSize", 1, 1_000);
    this.intervalMs = boundedInteger(options.intervalMs ?? 1_000, "intervalMs", 10, 300_000);
    this.schedule = options.schedule ?? ((work, delayMs) => setTimeout(work, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const lifecycle = ++this.lifecycle;
    void this.runAndSchedule(lifecycle);
  }

  stop(): void {
    this.running = false;
    ++this.lifecycle;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }

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
    try { await this.drain(); }
    catch (error) { this.options.onError?.(error); }
    finally {
      if (!this.running || this.lifecycle !== lifecycle) return;
      this.timer = this.schedule(() => {
        this.timer = undefined;
        void this.runAndSchedule(lifecycle);
      }, this.intervalMs);
    }
  }
}
