import { randomUUID } from "node:crypto";

import { ExtensionLifecycleEventSchema, ExtensionSecurityQuarantineEventSchema, ExtensionSharedStaticGenerationRebindEventSchema } from "@k-nex/contracts";
import type { RuntimeExtensionInvalidation } from "@k-nex/runtime";

import type { RuntimeExtensionPool } from "./runtime-extension-store.js";

export interface RuntimeExtensionInvalidationSink {
  publish(invalidation: RuntimeExtensionInvalidation, signal: AbortSignal): Promise<void>;
}

export type DispatchRuntimeExtensionOutboxResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ eventId: string; invalidation: RuntimeExtensionInvalidation; status: "delivered" }>;

interface RuntimeExtensionOutboxRow {
  event_id: string;
  application_id: string;
  environment: string;
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  inventory_revision: number;
  event_json: unknown;
  attempt_count: number;
  claim_token: string;
}

export interface RuntimeExtensionOutboxDispatchOptions {
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly publishTimeoutMs?: number;
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

function invalidation(row: RuntimeExtensionOutboxRow): RuntimeExtensionInvalidation {
  const eventType = (row.event_json as { eventType?: unknown }).eventType;
  const event = eventType === "extension.security-quarantine"
    ? ExtensionSecurityQuarantineEventSchema.parse(row.event_json)
    : eventType === "extension.shared-static-generation-rebind"
      ? ExtensionSharedStaticGenerationRebindEventSchema.parse(row.event_json)
      : ExtensionLifecycleEventSchema.parse(row.event_json);
  if (event.applicationId !== row.application_id || event.environment !== row.environment || event.deliveryClass !== row.delivery_class ||
    event.id !== row.extension_id || event.inventoryRevision !== row.inventory_revision) {
    throw new Error("Runtime extension outbox event does not match its persisted invalidation identity.");
  }
  return Object.freeze({
    applicationId: row.application_id,
    environment: row.environment,
    extension: Object.freeze({ deliveryClass: row.delivery_class, id: row.extension_id }),
    inventoryRevision: row.inventory_revision
  });
}

function claimed(row: RuntimeExtensionOutboxRow): RuntimeExtensionOutboxRow {
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1 || typeof row.claim_token !== "string" || row.claim_token.length === 0) {
    throw new Error("Runtime extension outbox claim is invalid.");
  }
  return row;
}

async function publishWithTimeout(
  sink: RuntimeExtensionInvalidationSink,
  message: RuntimeExtensionInvalidation,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sink.publish(message, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Runtime extension outbox publication timed out."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

/** Publishes each invalidation at least once with a short, durable PostgreSQL lease. */
export class PostgresRuntimeExtensionOutboxDispatcher {
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly publishTimeoutMs: number;

  constructor(private readonly pool: RuntimeExtensionPool, options: RuntimeExtensionOutboxDispatchOptions = {}) {
    this.leaseMs = boundedInteger(options.leaseMs ?? DEFAULT_LEASE_MS, "leaseMs", 1, MAX_DURATION_MS);
    this.maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "maxAttempts", 1, 20);
    this.publishTimeoutMs = boundedInteger(options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS, "publishTimeoutMs", 1, MAX_DURATION_MS);
    if (this.leaseMs <= this.publishTimeoutMs) throw new RangeError("leaseMs must exceed publishTimeoutMs.");
  }

  async dispatchNext(sink: RuntimeExtensionInvalidationSink): Promise<DispatchRuntimeExtensionOutboxResult> {
    const token = randomUUID();
    await this.deadLetterExhausted();
    const row = await this.claim(token);
    if (!row) return Object.freeze({ status: "idle" });

    try {
      const message = invalidation(row);
      await publishWithTimeout(sink, message, this.publishTimeoutMs);
      const delivered = await this.pool.query(
        `update runtime_extension_outbox
         set status='delivered', claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code=null
         where event_id=$1 and status='processing' and claim_token=$2`,
        [row.event_id, row.claim_token]
      );
      if (delivered.rowCount !== 1) throw new Error("Runtime extension outbox claim was lost.");
      return Object.freeze({ eventId: row.event_id, invalidation: message, status: "delivered" });
    } catch (error) {
      try { await this.releaseFailedClaim(row); } catch { /* preserve the publication error */ }
      throw error;
    }
  }

  private async deadLetterExhausted(): Promise<void> {
    await this.pool.query(
      `with candidate as (
         select event_id from runtime_extension_outbox
         where attempt_count >= $1 and (status='pending' or (status='processing' and lease_expires_at <= now()))
         order by inventory_revision, event_id for update skip locked limit 1
       )
       update runtime_extension_outbox as event set status='dead-letter', dead_lettered_at=now(),
         claimed_at=null, lease_expires_at=null, claim_token=null, last_error_code='DELIVERY_FAILED'
       from candidate where event.event_id=candidate.event_id`,
      [this.maxAttempts]
    );
  }

  private async claim(token: string): Promise<RuntimeExtensionOutboxRow | undefined> {
    const selected = await this.pool.query<RuntimeExtensionOutboxRow>(
      `with candidate as (
         select event_id from runtime_extension_outbox
         where attempt_count < $1 and (status='pending' or (status='processing' and lease_expires_at <= now()))
         order by attempt_count, inventory_revision, event_id for update skip locked limit 1
       )
       update runtime_extension_outbox as event set status='processing', claimed_at=now(),
         lease_expires_at=now() + ($2 * interval '1 millisecond'), claim_token=$3,
         attempt_count=event.attempt_count + 1
       from candidate where event.event_id=candidate.event_id
       returning event.event_id, event.application_id, event.environment, event.delivery_class, event.extension_id,
         event.inventory_revision, event.event_json, event.attempt_count, event.claim_token`,
      [this.maxAttempts, this.leaseMs, token]
    );
    return selected.rows[0] ? claimed(selected.rows[0]) : undefined;
  }

  private async releaseFailedClaim(row: RuntimeExtensionOutboxRow): Promise<void> {
    const terminal = row.attempt_count >= this.maxAttempts;
    await this.pool.query(
      `update runtime_extension_outbox set status=$3::varchar, claimed_at=null, lease_expires_at=null, claim_token=null,
         last_error_code='DELIVERY_FAILED', dead_lettered_at=case when $3::varchar='dead-letter' then now() else null end
       where event_id=$1 and status='processing' and claim_token=$2`,
      [row.event_id, row.claim_token, terminal ? "dead-letter" : "pending"]
    );
  }
}
