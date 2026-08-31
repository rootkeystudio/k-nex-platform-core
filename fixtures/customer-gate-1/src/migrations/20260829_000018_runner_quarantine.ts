import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_extension_runner_quarantine_receipts" (
      "receipt_id" varchar(128) PRIMARY KEY NOT NULL,
      "quarantine_transition_id" varchar(128) NOT NULL UNIQUE,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) DEFAULT 'hot-application' NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "expected_revision" integer NOT NULL,
      "revision" integer NOT NULL,
      "inventory_revision" integer NOT NULL,
      "reason" varchar(32) NOT NULL,
      "quarantine_digest" varchar(71) NOT NULL UNIQUE,
      "receipt_json" jsonb NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_runner_quarantine_owner_fk" FOREIGN KEY ("application_id", "environment", "delivery_class", "extension_id") REFERENCES "runtime_extensions" ("application_id", "environment", "delivery_class", "extension_id") ON DELETE RESTRICT,
      CONSTRAINT "runtime_extension_runner_quarantine_class_check" CHECK ("delivery_class"='hot-application'),
      CONSTRAINT "runtime_extension_runner_quarantine_revision_check" CHECK ("expected_revision" BETWEEN 0 AND 1000000000 AND "revision" BETWEEN 1 AND 1000000000 AND "revision" = "expected_revision" + 1),
      CONSTRAINT "runtime_extension_runner_quarantine_inventory_check" CHECK ("inventory_revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_runner_quarantine_reason_check" CHECK ("reason" IN ('INVOCATION_TIMEOUT','OUTPUT_BUDGET_EXCEEDED','PROTOCOL_VIOLATION','CONTAINER_FAILED','POLICY_VIOLATION')),
      CONSTRAINT "runtime_extension_runner_quarantine_digest_check" CHECK ("quarantine_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_extension_runner_quarantine_json_check" CHECK (jsonb_typeof("receipt_json")='object' AND jsonb_typeof("event_json")='object')
    );
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=17, "revision"=18 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_runner_quarantine_receipts";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=16, "revision"=17 WHERE "id"=1;
  `);
}
