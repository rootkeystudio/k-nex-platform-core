import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_extension_security_receipts" (
      "receipt_id" varchar(128) PRIMARY KEY NOT NULL,
      "security_transition_id" varchar(128) NOT NULL UNIQUE,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "expected_revision" integer NOT NULL,
      "revision" integer NOT NULL,
      "inventory_revision" integer NOT NULL,
      "decision_digest" varchar(71) NOT NULL UNIQUE,
      "receipt_json" jsonb NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_security_receipts_owner_fk" FOREIGN KEY ("application_id", "environment", "delivery_class", "extension_id") REFERENCES "runtime_extensions" ("application_id", "environment", "delivery_class", "extension_id") ON DELETE RESTRICT,
      CONSTRAINT "runtime_extension_security_receipts_class_check" CHECK ("delivery_class" IN ('hot-application','theme-skin')),
      CONSTRAINT "runtime_extension_security_receipts_revision_check" CHECK ("expected_revision" BETWEEN 0 AND 1000000000 AND "revision" BETWEEN 1 AND 1000000000 AND "revision" = "expected_revision" + 1),
      CONSTRAINT "runtime_extension_security_receipts_inventory_check" CHECK ("inventory_revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_security_receipts_digest_check" CHECK ("decision_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_extension_security_receipts_json_check" CHECK (jsonb_typeof("receipt_json")='object' AND jsonb_typeof("event_json")='object')
    );

    CREATE TABLE "runtime_extension_security_audit" (
      "audit_id" varchar(128) PRIMARY KEY NOT NULL,
      "receipt_id" varchar(128) NOT NULL REFERENCES "runtime_extension_security_receipts" ("receipt_id") ON DELETE RESTRICT,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "revision" integer NOT NULL,
      "inventory_revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_security_audit_revision_key" UNIQUE ("application_id", "environment", "delivery_class", "extension_id", "revision"),
      CONSTRAINT "runtime_extension_security_audit_inventory_check" CHECK ("inventory_revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_security_audit_event_check" CHECK (jsonb_typeof("event_json")='object')
    );

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=15, "revision"=16 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_security_audit";
    DROP TABLE "runtime_extension_security_receipts";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=14, "revision"=15 WHERE "id"=1;
  `);
}
