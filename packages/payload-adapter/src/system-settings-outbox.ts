import { randomUUID } from "node:crypto";

import { SettingsInvalidationSchema, type SettingsInvalidation } from "@k-nex/contracts";

import type { RuntimeExtensionPool } from "./runtime-extension-store.js";

export interface SettingsInvalidationSink {
  publish(invalidation: SettingsInvalidation, signal: AbortSignal): Promise<void>;
}

export interface SettingsOutboxDispatchOptions {
  readonly applicationId: string;
  readonly environment: string;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly publishTimeoutMs?: number;
}

export interface SettingsOutboxWorkerOptions {
  readonly batchSize?: number;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export type DispatchSettingsOutboxResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ eventId: string; invalidation: SettingsInvalidation; status: "delivered" }>;

interface SettingsOutboxRow {
  event_id: string;
  application_id: string;
  environment: string;
  descriptor_id: string;
  descriptor_schema_version: number | string;
  owner_scope_key: string;
  owner_kind: string;
  owner_namespace: string | null;
  owner_delivery_class: string | null;
  owner_extension_id: string | null;
  owner_generation: number | string | null;
  settings_revision: number | string;
  occurred_at: Date | string;
  attempt_count: number;
  claim_token: string;
}

const defaultLeaseMs = 35_000;
const defaultMaxAttempts = 3;
const defaultPublishTimeoutMs = 30_000;
const maximumDurationMs = 60 * 60 * 1_000;

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} is invalid.`);
  return value;
}

function integer(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : value === null ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Settings outbox row is invalid.");
  return parsed;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error("Settings outbox row is invalid.");
  return date.toISOString();
}

function persistedInvalidation(row: SettingsOutboxRow): SettingsInvalidation {
  const platform = row.owner_kind === "platform";
  if (platform
    ? row.owner_namespace !== "system" || row.owner_scope_key !== "platform:system" || row.owner_delivery_class !== null || row.owner_extension_id !== null || row.owner_generation !== null
    : row.owner_kind !== "extension" || row.owner_namespace !== null || row.owner_delivery_class === null || row.owner_extension_id === null ||
      row.owner_scope_key !== `${row.owner_delivery_class}:${row.owner_extension_id}:${integer(row.owner_generation)}`) {
    throw new Error("Settings outbox row is invalid.");
  }
  const owner = platform
    ? { kind: "platform", namespace: row.owner_namespace }
    : {
        kind: "extension",
        deliveryClass: row.owner_delivery_class,
        extensionId: row.owner_extension_id,
        generation: integer(row.owner_generation)
      };
  const parsed = SettingsInvalidationSchema.safeParse({
    schemaVersion: 1,
    invalidationId: row.event_id,
    identity: {
      applicationId: row.application_id,
      environment: row.environment,
      descriptorId: row.descriptor_id,
      descriptorSchemaVersion: integer(row.descriptor_schema_version),
      owner
    },
    settingsRevision: integer(row.settings_revision),
    occurredAt: timestamp(row.occurred_at)
  });
  if (!parsed.success || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1 || !row.claim_token) {
    throw new Error("Settings outbox row is invalid.");
  }
  return Object.freeze(parsed.data);
}

async function publishWithTimeout(sink: SettingsInvalidationSink, message: SettingsInvalidation, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sink.publish(message, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Settings outbox publication timed out."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

/** Publishes value-free settings invalidations at least once with a durable lease. */
export class PostgresSettingsOutboxDispatcher {
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly publishTimeoutMs: number;
  private readonly applicationId: string;
  private readonly environment: string;

  constructor(private readonly pool: RuntimeExtensionPool, options: SettingsOutboxDispatchOptions) {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(options.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(options.environment)) {
      throw new TypeError("Settings outbox owner is invalid.");
    }
    this.applicationId = options.applicationId;
    this.environment = options.environment;
    this.leaseMs = boundedInteger(options.leaseMs ?? defaultLeaseMs, "leaseMs", 1, maximumDurationMs);
    this.maxAttempts = boundedInteger(options.maxAttempts ?? defaultMaxAttempts, "maxAttempts", 1, 20);
    this.publishTimeoutMs = boundedInteger(options.publishTimeoutMs ?? defaultPublishTimeoutMs, "publishTimeoutMs", 1, maximumDurationMs);
    if (this.leaseMs <= this.publishTimeoutMs) throw new RangeError("leaseMs must exceed publishTimeoutMs.");
  }

  async dispatchNext(sink: SettingsInvalidationSink): Promise<DispatchSettingsOutboxResult> {
    const token = randomUUID();
    await this.deadLetterExhausted();
    const row = await this.claim(token);
    if (!row) return Object.freeze({ status: "idle" });
    try {
      const message = persistedInvalidation(row);
      await publishWithTimeout(sink, message, this.publishTimeoutMs);
      const delivered = await this.pool.query(
        `update k_nex_system_settings_outbox
         set status='delivered', claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code=null
         where event_id=$1 and status='processing' and claim_token=$2`,
        [row.event_id, row.claim_token]
      );
      if (delivered.rowCount !== 1) throw new Error("Settings outbox claim was lost.");
      return Object.freeze({ eventId: row.event_id, invalidation: message, status: "delivered" });
    } catch (error) {
      try { await this.releaseFailedClaim(row); } catch { /* preserve publication failure */ }
      throw error;
    }
  }

  private async deadLetterExhausted(): Promise<void> {
    await this.pool.query(
      `with candidate as (
         select event_id from k_nex_system_settings_outbox
         where application_id=$2 and environment=$3 and attempt_count >= $1
           and (status='pending' or (status='processing' and lease_expires_at <= now()))
         order by settings_revision, event_id for update skip locked limit 1
       )
       update k_nex_system_settings_outbox as event set status='dead-letter', dead_lettered_at=now(),
         claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code='DELIVERY_FAILED'
       from candidate where event.event_id=candidate.event_id`,
      [this.maxAttempts, this.applicationId, this.environment]
    );
  }

  private async claim(token: string): Promise<SettingsOutboxRow | undefined> {
    const selected = await this.pool.query<SettingsOutboxRow>(
      `with candidate as (
         select event_id from k_nex_system_settings_outbox
         where application_id=$2 and environment=$3 and attempt_count < $1
           and (status='pending' or (status='processing' and lease_expires_at <= now()))
         order by attempt_count, settings_revision, event_id for update skip locked limit 1
       )
       update k_nex_system_settings_outbox as event set status='processing', claimed_at=now(),
         lease_expires_at=now() + ($4 * interval '1 millisecond'), claim_token=$5,
         attempt_count=event.attempt_count + 1
       from candidate where event.event_id=candidate.event_id
       returning event.event_id, event.application_id, event.environment, event.descriptor_id, event.descriptor_schema_version, event.owner_scope_key,
         event.owner_kind, event.owner_namespace, event.owner_delivery_class, event.owner_extension_id, event.owner_generation,
         event.settings_revision, event.occurred_at, event.attempt_count, event.claim_token`,
      [this.maxAttempts, this.applicationId, this.environment, this.leaseMs, token]
    );
    return selected.rows[0];
  }

  private async releaseFailedClaim(row: SettingsOutboxRow): Promise<void> {
    const terminal = row.attempt_count >= this.maxAttempts;
    await this.pool.query(
      `update k_nex_system_settings_outbox set status=$3::varchar, claimed_at=null, lease_expires_at=null, claim_token=null,
         last_error_code='DELIVERY_FAILED', dead_lettered_at=case when $3::varchar='dead-letter' then now() else null end
       where event_id=$1 and status='processing' and claim_token=$2`,
      [row.event_id, row.claim_token, terminal ? "dead-letter" : "pending"]
    );
  }
}

/** Owns one bounded non-overlapping settings dispatcher loop. */
export class SettingsOutboxWorker {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly schedule: (work: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private running = false;
  private lifecycle = 0;
  private timer: unknown;
  private draining: Promise<number> | undefined;

  constructor(
    private readonly dispatcher: Pick<PostgresSettingsOutboxDispatcher, "dispatchNext">,
    private readonly sink: SettingsInvalidationSink,
    private readonly options: SettingsOutboxWorkerOptions = {}
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
    const draining = this.drainBatch().finally(() => { if (this.draining === draining) this.draining = undefined; });
    this.draining = draining;
    return draining;
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
