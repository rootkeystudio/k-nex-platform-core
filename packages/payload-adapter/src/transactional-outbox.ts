import { sql } from "@payloadcms/db-postgres";
import type { PostgresAdapter } from "@payloadcms/db-postgres";
import { DurableEventEnvelopeSchema, type DurableEventEnvelope } from "@k-nex/contracts";
import type { PayloadRequest } from "payload";
import { z } from "zod/v4";

const RetentionTimestampSchema = z.iso.datetime({ offset: true }).max(64);
const timestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

type InstantParts = {
  readonly wholeMilliseconds: bigint;
  readonly fraction: string;
};

export interface WriteTransactionalOutboxEventArgs {
  readonly req: PayloadRequest;
  readonly event: DurableEventEnvelope;
  readonly retentionUntil: string;
}

function instantParts(timestamp: string): InstantParts {
  const match = timestampPattern.exec(timestamp);
  if (!match) throw new Error("Transactional outbox timestamps must be ISO instants with an offset.");

  const wholeMilliseconds = Date.parse(`${match[1]}:${match[2] ?? "00"}.000${match[4]}`);
  if (!Number.isFinite(wholeMilliseconds)) throw new Error("Transactional outbox timestamp is not a valid instant.");
  return { wholeMilliseconds: BigInt(wholeMilliseconds), fraction: match[3] ?? "" };
}

function isAfter(later: InstantParts, earlier: InstantParts): boolean {
  if (later.wholeMilliseconds !== earlier.wholeMilliseconds) return later.wholeMilliseconds > earlier.wholeMilliseconds;
  const width = Math.max(later.fraction.length, earlier.fraction.length);
  return BigInt(later.fraction.padEnd(width, "0") || "0") > BigInt(earlier.fraction.padEnd(width, "0") || "0");
}

async function activeTransactionDb(req: PayloadRequest): Promise<NonNullable<PostgresAdapter["sessions"]>[string]["db"]> {
  const transactionId = await req.transactionID;
  if (transactionId === undefined || transactionId === null) {
    throw new Error("Transactional outbox requires an active Payload transaction.");
  }

  const adapter = req.payload.db as unknown as PostgresAdapter;
  const session = adapter.sessions?.[String(transactionId)];
  if (session?.db === undefined || session.db === null) {
    throw new Error("Transactional outbox requires an active Postgres transaction session.");
  }
  return session.db;
}

export async function writeTransactionalOutboxEvent({
  req,
  event,
  retentionUntil
}: WriteTransactionalOutboxEventArgs): Promise<void> {
  const parsedEvent = DurableEventEnvelopeSchema.parse(event);
  const parsedRetentionUntil = RetentionTimestampSchema.parse(retentionUntil);
  if (!isAfter(instantParts(parsedRetentionUntil), instantParts(parsedEvent.occurredAt))) {
    throw new Error("Transactional outbox retentionUntil must be strictly after event.occurredAt.");
  }

  const db = await activeTransactionDb(req);
  const actor = parsedEvent.actor;
  await db.execute(sql`
    INSERT INTO "k_nex_outbox" (
      "event_id", "event_type", "schema_version", "message_class", "occurred_at",
      "application_id", "plugin_id", "actor_id", "actor_type", "impersonator_id",
      "correlation_id", "causation_id", "idempotency_key", "payload", "retention_until"
    ) VALUES (
      ${parsedEvent.id}, ${parsedEvent.type}, ${parsedEvent.schemaVersion}, ${parsedEvent.messageClass}, ${parsedEvent.occurredAt},
      ${parsedEvent.applicationId}, ${parsedEvent.pluginId}, ${actor?.id ?? null}, ${actor?.type ?? null}, ${actor?.impersonatorId ?? null},
      ${parsedEvent.correlationId}, ${parsedEvent.causationId ?? null}, ${parsedEvent.idempotencyKey ?? null}, ${JSON.stringify(parsedEvent.payload)}::jsonb, ${parsedRetentionUntil}
    )
  `);
}
