import { randomUUID } from "node:crypto";

import { DurableEventEnvelopeSchema, EventPayloadSchema, type DurableEventEnvelope } from "@k-nex/contracts";
import { sql, type PostgresAdapter } from "@payloadcms/db-postgres";
import type { Payload } from "payload";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 100;
const MAX_DURATION_MS = 60 * 60 * 1_000;
const DELIVERY_ERROR_CODE = "DELIVERY_FAILED";

type DatabaseResult = { rowCount?: number; rows?: Record<string, unknown>[] };

export interface OutboxProcessorActor {
  readonly kind: "system";
  readonly id: "outbox.processor";
}

export interface OutboxSubscriberContext {
  readonly actor: OutboxProcessorActor;
  readonly checkpoint: Readonly<Record<string, unknown>> | null;
  readonly event: DurableEventEnvelope;
  readonly idempotencyKey: string;
  saveCheckpoint(checkpoint: Readonly<Record<string, unknown>>): Promise<void>;
}

export type OutboxSubscriber = (context: OutboxSubscriberContext) => Promise<void>;

export interface ProcessPayloadOutboxOptions {
  readonly backoffMs?: number;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly payload: Payload;
  readonly subscriber: OutboxSubscriber;
}

export type ProcessPayloadOutboxResult = Readonly<{
  eventId?: string;
  status: "dead-lettered" | "delivered" | "idle" | "lease-lost" | "retry-scheduled";
}>;

export interface PayloadOutboxHealth {
  readonly deadLetter: number;
  readonly delivered: number;
  readonly expiredLeases: number;
  readonly oldestPendingAt: string | null;
  readonly pending: number;
  readonly processing: number;
}

interface ClaimedEvent {
  readonly attemptCount: number;
  readonly eventId: string;
  readonly row: Record<string, unknown>;
  readonly token: string;
}

function adapter(payload: Payload): PostgresAdapter {
  return payload.db as unknown as PostgresAdapter;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function result(value: unknown): DatabaseResult {
  if (typeof value !== "object" || value === null) throw new Error("Postgres returned an invalid outbox result.");
  return value as DatabaseResult;
}

function rows(value: unknown): Record<string, unknown>[] {
  const parsed = result(value).rows;
  if (!Array.isArray(parsed)) throw new Error("Postgres returned invalid outbox rows.");
  return parsed;
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") throw new Error("Outbox timestamp is invalid.");
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Outbox timestamp is invalid.");
  return parsed.toISOString();
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Outbox metadata is invalid.");
  return value;
}

function eventFromRow(row: Record<string, unknown>): DurableEventEnvelope {
  const actorId = optionalString(row.actor_id);
  const actorType = optionalString(row.actor_type);
  const impersonatorId = optionalString(row.impersonator_id);
  const causationId = optionalString(row.causation_id);
  const idempotencyKey = optionalString(row.idempotency_key);
  return DurableEventEnvelopeSchema.parse({
    id: row.event_id,
    type: row.event_type,
    schemaVersion: row.schema_version,
    messageClass: row.message_class,
    occurredAt: timestamp(row.occurred_at),
    applicationId: row.application_id,
    pluginId: row.plugin_id,
    ...(actorId && actorType ? { actor: { id: actorId, type: actorType, ...(impersonatorId ? { impersonatorId } : {}) } } : {}),
    correlationId: row.correlation_id,
    ...(causationId ? { causationId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    payload: row.payload
  });
}

function claimedEvent(row: Record<string, unknown>): ClaimedEvent {
  if (typeof row.event_id !== "string" || typeof row.claim_token !== "string" ||
    !Number.isSafeInteger(row.attempt_count) || Number(row.attempt_count) < 0) {
    throw new Error("Claimed outbox state is invalid.");
  }
  return {
    attemptCount: Number(row.attempt_count),
    eventId: row.event_id,
    row,
    token: row.claim_token
  };
}

async function deadLetterExhaustedClaim(payload: Payload, maxAttempts: number): Promise<string | undefined> {
  const exhausted = rows(await adapter(payload).drizzle.execute(sql`
    WITH candidate AS (
      SELECT "id" FROM "k_nex_outbox"
      WHERE "attempt_count" >= ${maxAttempts} AND (
        "status" = 'pending'
        OR ("status" = 'processing' AND "lease_expires_at" <= now())
      )
      ORDER BY CASE WHEN "status" = 'pending' THEN 0 ELSE 1 END, "lease_expires_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "k_nex_outbox" AS event
    SET "status" = 'dead-letter', "last_error_code" = ${DELIVERY_ERROR_CODE},
        "dead_lettered_at" = now(), "claimed_at" = NULL, "lease_expires_at" = NULL,
        "claim_token" = NULL, "updated_at" = now()
    FROM candidate
    WHERE event."id" = candidate."id"
    RETURNING event."event_id"
  `));
  const eventId = exhausted[0]?.event_id;
  if (eventId === undefined) return undefined;
  if (typeof eventId !== "string") throw new Error("Dead-lettered outbox state is invalid.");
  return eventId;
}

async function claim(payload: Payload, leaseMs: number, maxAttempts: number): Promise<ClaimedEvent | undefined> {
  const token = randomUUID();
  const selected = rows(await adapter(payload).drizzle.execute(sql`
    WITH candidate AS (
      SELECT "id" FROM "k_nex_outbox"
      WHERE "attempt_count" < ${maxAttempts} AND (
        ("status" = 'pending' AND "available_at" <= now())
        OR ("status" = 'processing' AND "lease_expires_at" <= now())
      )
      ORDER BY CASE WHEN "status" = 'pending' THEN 0 ELSE 1 END, "available_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "k_nex_outbox" AS event
    SET "status" = 'processing', "claimed_at" = now(),
        "lease_expires_at" = now() + (${leaseMs} * interval '1 millisecond'),
        "claim_token" = ${token}, "attempt_count" = "attempt_count" + 1, "updated_at" = now()
    FROM candidate
    WHERE event."id" = candidate."id"
    RETURNING event.*
  `));
  return selected[0] ? claimedEvent(selected[0]) : undefined;
}

async function updateWithLease(payload: Payload, statement: unknown): Promise<boolean> {
  const updated = result(await adapter(payload).drizzle.execute(statement as Parameters<PostgresAdapter["drizzle"]["execute"]>[0]));
  return updated.rowCount === 1;
}

export async function processNextPayloadOutboxEvent(options: ProcessPayloadOutboxOptions): Promise<ProcessPayloadOutboxResult> {
  if (typeof options.subscriber !== "function") throw new TypeError("subscriber must be a function.");
  const leaseMs = boundedInteger(options.leaseMs ?? DEFAULT_LEASE_MS, "leaseMs", 1, MAX_DURATION_MS);
  const maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "maxAttempts", 1, 20);
  const backoffMs = boundedInteger(options.backoffMs ?? DEFAULT_BACKOFF_MS, "backoffMs", 1, MAX_DURATION_MS);
  const exhaustedEventId = await deadLetterExhaustedClaim(options.payload, maxAttempts);
  if (exhaustedEventId) return Object.freeze({ eventId: exhaustedEventId, status: "dead-lettered" });
  const claimed = await claim(options.payload, leaseMs, maxAttempts);
  if (!claimed) return Object.freeze({ status: "idle" });

  let checkpoint: Readonly<Record<string, unknown>> | null = null;
  const saveCheckpoint = async (value: Readonly<Record<string, unknown>>): Promise<void> => {
    const parsed = EventPayloadSchema.parse(value);
    const saved = await updateWithLease(options.payload, sql`
      UPDATE "k_nex_outbox"
      SET "checkpoint" = ${JSON.stringify(parsed)}::jsonb,
          "lease_expires_at" = now() + (${leaseMs} * interval '1 millisecond'), "updated_at" = now()
      WHERE "event_id" = ${claimed.eventId} AND "status" = 'processing' AND "claim_token" = ${claimed.token}
    `);
    if (!saved) throw new Error("Outbox lease was lost before checkpoint persistence.");
    checkpoint = parsed;
  };

  try {
    const event = eventFromRow(claimed.row);
    checkpoint = claimed.row.checkpoint === null || claimed.row.checkpoint === undefined
      ? null
      : EventPayloadSchema.parse(claimed.row.checkpoint);
    await options.subscriber(Object.freeze({
      actor: Object.freeze({ kind: "system", id: "outbox.processor" }),
      checkpoint,
      event,
      idempotencyKey: event.id,
      saveCheckpoint
    }));
    const delivered = await updateWithLease(options.payload, sql`
      UPDATE "k_nex_outbox"
      SET "status" = 'delivered',
          "processed_at" = now(), "claimed_at" = NULL, "lease_expires_at" = NULL,
          "claim_token" = NULL, "last_error_code" = NULL, "updated_at" = now()
      WHERE "event_id" = ${claimed.eventId} AND "status" = 'processing' AND "claim_token" = ${claimed.token}
    `);
    return Object.freeze({ eventId: claimed.eventId, status: delivered ? "delivered" : "lease-lost" });
  } catch {
    const deadLetter = claimed.attemptCount >= maxAttempts;
    const delay = Math.min(backoffMs * (2 ** (claimed.attemptCount - 1)), MAX_DURATION_MS);
    const updated = await updateWithLease(options.payload, sql`
      UPDATE "k_nex_outbox"
      SET "status" = ${deadLetter ? "dead-letter" : "pending"},
          "last_error_code" = ${DELIVERY_ERROR_CODE},
          "available_at" = now() + (${deadLetter ? 0 : delay} * interval '1 millisecond'),
          "dead_lettered_at" = ${deadLetter ? new Date() : null},
          "claimed_at" = NULL, "lease_expires_at" = NULL, "claim_token" = NULL,
          "updated_at" = now()
      WHERE "event_id" = ${claimed.eventId} AND "status" = 'processing' AND "claim_token" = ${claimed.token}
    `);
    return Object.freeze({
      eventId: claimed.eventId,
      status: updated ? deadLetter ? "dead-lettered" : "retry-scheduled" : "lease-lost"
    });
  }
}

export async function readPayloadOutboxHealth(payload: Payload): Promise<PayloadOutboxHealth> {
  const health = rows(await adapter(payload).drizzle.execute(sql`
    SELECT
      count(*) FILTER (WHERE "status" = 'pending')::int AS "pending",
      count(*) FILTER (WHERE "status" = 'processing')::int AS "processing",
      count(*) FILTER (WHERE "status" = 'delivered')::int AS "delivered",
      count(*) FILTER (WHERE "status" = 'dead-letter')::int AS "dead_letter",
      count(*) FILTER (WHERE "status" = 'processing' AND "lease_expires_at" <= now())::int AS "expired_leases",
      min("available_at") FILTER (WHERE "status" = 'pending') AS "oldest_pending_at"
    FROM "k_nex_outbox"
  `))[0];
  if (!health) throw new Error("Postgres returned no outbox health row.");
  return Object.freeze({
    pending: Number(health.pending),
    processing: Number(health.processing),
    delivered: Number(health.delivered),
    deadLetter: Number(health.dead_letter),
    expiredLeases: Number(health.expired_leases),
    oldestPendingAt: health.oldest_pending_at === null ? null : timestamp(health.oldest_pending_at)
  });
}
