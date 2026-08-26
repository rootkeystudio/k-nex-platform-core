import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "k_nex_outbox" DROP CONSTRAINT "k_nex_outbox_claim_state_check";
    ALTER TABLE "k_nex_outbox" ADD COLUMN "claim_token" varchar(64);
    ALTER TABLE "k_nex_outbox" ADD CONSTRAINT "k_nex_outbox_claim_state_check" CHECK (
      ("status" = 'processing' AND "claimed_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "claim_token" IS NOT NULL)
      OR ("status" IN ('pending', 'delivered', 'dead-letter') AND "claimed_at" IS NULL AND "lease_expires_at" IS NULL AND "claim_token" IS NULL)
    );

    CREATE TABLE "sales_event_effects" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "task_id" varchar(128) NOT NULL,
      "system_actor_id" varchar(128) NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX "sales_event_effects_task_id_idx" ON "sales_event_effects" USING btree ("task_id");

    UPDATE "k_nex_migration_revision"
      SET "predecessor_revision" = 4, "revision" = 5
      WHERE "id" = 1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "sales_event_effects";
    ALTER TABLE "k_nex_outbox" DROP CONSTRAINT "k_nex_outbox_claim_state_check";
    ALTER TABLE "k_nex_outbox" DROP COLUMN "claim_token";
    ALTER TABLE "k_nex_outbox" ADD CONSTRAINT "k_nex_outbox_claim_state_check" CHECK (
      ("status" = 'processing' AND "claimed_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
      OR ("status" IN ('pending', 'delivered', 'dead-letter') AND "claimed_at" IS NULL AND "lease_expires_at" IS NULL)
    );
    UPDATE "k_nex_migration_revision"
      SET "predecessor_revision" = 3, "revision" = 4
      WHERE "id" = 1;
  `);
}
