import { sql } from "@payloadcms/db-postgres";
import type { PostgresAdapter } from "@payloadcms/db-postgres";
import { DurableEventEnvelopeSchema, MillisecondTimestampSchema, type DurableEventEnvelope } from "@k-nex/contracts";
import type { PayloadRequest } from "payload";

export interface WriteTransactionalOutboxEventArgs {
  readonly req: PayloadRequest;
  readonly event: DurableEventEnvelope;
  readonly retentionUntil: string;
}

export async function activePayloadPostgresTransaction(req: PayloadRequest): Promise<NonNullable<PostgresAdapter["sessions"]>[string]["db"]> {
  const transactionId = await req.transactionID;
  if (transactionId === undefined || transactionId === null) {
    throw new Error("An active Payload transaction is required.");
  }

  const adapter = req.payload.db as unknown as PostgresAdapter;
  const session = adapter.sessions?.[String(transactionId)];
  if (session?.db === undefined || session.db === null) {
    throw new Error("An active Postgres transaction session from Payload is required.");
  }
  return session.db;
}

export async function writeTransactionalOutboxEvent({
  req,
  event,
  retentionUntil
}: WriteTransactionalOutboxEventArgs): Promise<void> {
  const parsedEvent = DurableEventEnvelopeSchema.parse(event);
  const parsedRetentionUntil = MillisecondTimestampSchema.parse(retentionUntil);
  if (Date.parse(parsedRetentionUntil) <= Date.parse(parsedEvent.occurredAt)) {
    throw new Error("Transactional outbox retentionUntil must be strictly after event.occurredAt.");
  }

  const db = await activePayloadPostgresTransaction(req);
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
