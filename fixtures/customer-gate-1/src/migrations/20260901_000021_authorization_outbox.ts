import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "k_nex_authorization_outbox" (
      "event_id" uuid PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "authorization_revision" integer NOT NULL,
      "lifecycle_revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "status" varchar(32) DEFAULT 'pending' NOT NULL,
      "attempt_count" integer DEFAULT 0 NOT NULL,
      "claimed_at" timestamp(3) with time zone,
      "lease_expires_at" timestamp(3) with time zone,
      "claim_token" uuid,
      "last_error_code" varchar(64),
      "dead_lettered_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_authorization_outbox_state_fk" FOREIGN KEY ("application_id") REFERENCES "k_nex_authorization_state" ("application_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_authorization_outbox_revision_key" UNIQUE ("application_id", "environment", "authorization_revision", "lifecycle_revision"),
      CONSTRAINT "k_nex_authorization_outbox_revision_check" CHECK ("authorization_revision" BETWEEN 0 AND 1000000000 AND "lifecycle_revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "k_nex_authorization_outbox_status_check" CHECK ("status" IN ('pending','processing','delivered','dead-letter')),
      CONSTRAINT "k_nex_authorization_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
      CONSTRAINT "k_nex_authorization_outbox_event_check" CHECK (jsonb_typeof("event_json")='object')
    );
    CREATE INDEX "k_nex_authorization_outbox_pending_idx" ON "k_nex_authorization_outbox" ("attempt_count", "authorization_revision", "lifecycle_revision", "event_id") WHERE "status"='pending';
    CREATE INDEX "k_nex_authorization_outbox_expired_lease_idx" ON "k_nex_authorization_outbox" ("lease_expires_at", "event_id") WHERE "status"='processing';

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=20, "revision"=21 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "k_nex_authorization_outbox";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=19, "revision"=20 WHERE "id"=1;
  `);
}
