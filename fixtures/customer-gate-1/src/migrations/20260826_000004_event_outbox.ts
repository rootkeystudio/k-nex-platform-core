import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "k_nex_outbox" (
      "id" bigserial PRIMARY KEY NOT NULL,
      "event_id" varchar(128) NOT NULL,
      "event_type" varchar(128) NOT NULL,
      "schema_version" integer NOT NULL,
      "message_class" varchar(32) NOT NULL,
      "occurred_at" timestamp(3) with time zone NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "plugin_id" varchar(128) NOT NULL,
      "actor_id" varchar(128),
      "actor_type" varchar(64),
      "impersonator_id" varchar(128),
      "correlation_id" varchar(128) NOT NULL,
      "causation_id" varchar(128),
      "idempotency_key" varchar(128),
      "payload" jsonb NOT NULL,
      "status" varchar(32) DEFAULT 'pending' NOT NULL,
      "attempt_count" integer DEFAULT 0 NOT NULL,
      "available_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "claimed_at" timestamp(3) with time zone,
      "lease_expires_at" timestamp(3) with time zone,
      "checkpoint" jsonb,
      "last_error_code" varchar(128),
      "dead_lettered_at" timestamp(3) with time zone,
      "processed_at" timestamp(3) with time zone,
      "retention_until" timestamp(3) with time zone NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_outbox_event_id_key" UNIQUE ("event_id"),
      CONSTRAINT "k_nex_outbox_schema_version_check" CHECK ("schema_version" BETWEEN 1 AND 1000000),
      CONSTRAINT "k_nex_outbox_message_class_check" CHECK ("message_class" IN ('durable-integration', 'durable-workflow')),
      CONSTRAINT "k_nex_outbox_payload_object_check" CHECK (jsonb_typeof("payload") = 'object'),
      CONSTRAINT "k_nex_outbox_actor_pair_check" CHECK (("actor_id" IS NULL) = ("actor_type" IS NULL)),
      CONSTRAINT "k_nex_outbox_impersonator_check" CHECK ("impersonator_id" IS NULL OR ("actor_id" IS NOT NULL AND "actor_type" IS NOT NULL)),
      CONSTRAINT "k_nex_outbox_status_check" CHECK ("status" IN ('pending', 'processing', 'delivered', 'dead-letter')),
      CONSTRAINT "k_nex_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
      CONSTRAINT "k_nex_outbox_claim_state_check" CHECK (
        ("status" = 'processing' AND "claimed_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
        OR ("status" IN ('pending', 'delivered', 'dead-letter') AND "claimed_at" IS NULL AND "lease_expires_at" IS NULL)
      ),
      CONSTRAINT "k_nex_outbox_checkpoint_object_check" CHECK ("checkpoint" IS NULL OR jsonb_typeof("checkpoint") = 'object'),
      CONSTRAINT "k_nex_outbox_retention_check" CHECK ("retention_until" > "occurred_at"),
      CONSTRAINT "k_nex_outbox_status_timestamps_check" CHECK (
        ("status" = 'delivered' AND "processed_at" IS NOT NULL AND "dead_lettered_at" IS NULL)
        OR ("status" = 'dead-letter' AND "dead_lettered_at" IS NOT NULL AND "processed_at" IS NULL)
        OR ("status" IN ('pending', 'processing') AND "processed_at" IS NULL AND "dead_lettered_at" IS NULL)
      )
    );

    CREATE INDEX "k_nex_outbox_claim_order_idx"
      ON "k_nex_outbox" USING btree ("status", "available_at", "id")
      WHERE "status" = 'pending';
    CREATE INDEX "k_nex_outbox_lease_recovery_idx"
      ON "k_nex_outbox" USING btree ("lease_expires_at", "id")
      WHERE "status" = 'processing' AND "lease_expires_at" IS NOT NULL;
    CREATE INDEX "k_nex_outbox_retention_cleanup_idx"
      ON "k_nex_outbox" USING btree ("retention_until", "id");
    CREATE INDEX "k_nex_outbox_correlation_idx"
      ON "k_nex_outbox" USING btree ("correlation_id");
    CREATE UNIQUE INDEX "k_nex_outbox_idempotency_scope_key"
      ON "k_nex_outbox" USING btree ("application_id", "plugin_id", "event_type", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;

    UPDATE "k_nex_migration_revision"
      SET "predecessor_revision" = 3, "revision" = 4
      WHERE "id" = 1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "k_nex_outbox";
    UPDATE "k_nex_migration_revision"
      SET "predecessor_revision" = 2, "revision" = 3
      WHERE "id" = 1;
  `);
}
