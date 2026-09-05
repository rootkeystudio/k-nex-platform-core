import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_extensions" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "disposition" varchar(32) DEFAULT 'removed' NOT NULL,
      "active_generation_id" varchar(128),
      "rollback_generation_id" varchar(128),
      "active_generation" jsonb,
      "rollback_generation" jsonb,
      "retained_generation" jsonb,
      "last_operation_id" varchar(128),
      "last_receipt_id" varchar(128),
      "state_digest" varchar(71),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "delivery_class", "extension_id"),
      CONSTRAINT "runtime_extensions_delivery_class_check" CHECK ("delivery_class" IN ('platform-plugin','hot-application','theme-skin')),
      CONSTRAINT "runtime_extensions_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "runtime_extensions_disposition_check" CHECK ("disposition" IN ('active','disabled','quarantined','retirement-pending','removed')),
      CONSTRAINT "runtime_extensions_active_authority_check" CHECK (("disposition" = 'active') = ("active_generation_id" IS NOT NULL AND "active_generation" IS NOT NULL)),
      CONSTRAINT "runtime_extensions_nonactive_pointer_check" CHECK ("disposition" = 'active' OR ("active_generation_id" IS NULL AND "active_generation" IS NULL)),
      CONSTRAINT "runtime_extensions_state_digest_check" CHECK ("state_digest" IS NULL OR "state_digest" ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE "runtime_extension_generations" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "version" varchar(64) NOT NULL,
      "authority_json" jsonb NOT NULL,
      "authority_digest" varchar(71) NOT NULL,
      "previous_generation_id" varchar(128),
      "rollback_eligible" boolean DEFAULT false NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "delivery_class", "extension_id", "generation_id"),
      CONSTRAINT "runtime_extension_generations_owner_fk" FOREIGN KEY ("application_id", "environment", "delivery_class", "extension_id") REFERENCES "runtime_extensions" ("application_id", "environment", "delivery_class", "extension_id") ON DELETE cascade,
      CONSTRAINT "runtime_extension_generations_authority_object_check" CHECK (jsonb_typeof("authority_json") = 'object'),
      CONSTRAINT "runtime_extension_generations_authority_digest_check" CHECK ("authority_digest" ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE "runtime_extension_inventory_revisions" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "runtime_extension_inventory_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "runtime_extension_operations" (
      "operation_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "operation_kind" varchar(32) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "request_digest" varchar(71) NOT NULL,
      "execution_request_digest" varchar(71),
      "request_json" jsonb NOT NULL,
      "authorization_json" jsonb NOT NULL,
      "expected_revision" integer NOT NULL,
      "phase" varchar(64) NOT NULL,
      "lease_owner" varchar(160) NOT NULL,
      "lease_token" varchar(64) NOT NULL,
      "lease_expires_at" timestamp(3) with time zone NOT NULL,
      "plan_json" jsonb,
      "authority_json" jsonb,
      "result_json" jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_operations_owner_fk" FOREIGN KEY ("application_id", "environment", "delivery_class", "extension_id") REFERENCES "runtime_extensions" ("application_id", "environment", "delivery_class", "extension_id") ON DELETE cascade,
      CONSTRAINT "runtime_extension_operations_kind_check" CHECK ("operation_kind" IN ('install','update','disable','rollback','uninstall')),
      CONSTRAINT "runtime_extension_operations_phase_check" CHECK ("phase" IN ('planning','downloading','verified','staged','waiting-configuration','waiting-approval','warming','source-change-required','source-change-ready','build-attested','zero-downtime-eligible','maintenance-required','unsupported','rollback-window-open','rollback-window-closed','contract-cleanup-eligible','completed','failed')),
      CONSTRAINT "runtime_extension_operations_expected_revision_check" CHECK ("expected_revision" >= 0),
      CONSTRAINT "runtime_extension_operations_request_digest_check" CHECK ("request_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_extension_operations_execution_request_digest_check" CHECK ("execution_request_digest" IS NULL OR "execution_request_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_extension_operations_json_check" CHECK (jsonb_typeof("request_json")='object' AND jsonb_typeof("authorization_json")='object' AND ("plan_json" IS NULL OR jsonb_typeof("plan_json")='object') AND ("authority_json" IS NULL OR jsonb_typeof("authority_json")='object')),
      CONSTRAINT "runtime_extension_operations_idempotency_key" UNIQUE ("application_id", "environment", "delivery_class", "extension_id", "operation_kind", "idempotency_key")
    );
    CREATE INDEX "runtime_extension_operations_lease_idx" ON "runtime_extension_operations" ("lease_expires_at", "operation_id") WHERE "phase" NOT IN ('completed','failed');
    CREATE INDEX "runtime_extension_operations_identity_idx" ON "runtime_extension_operations" ("application_id", "environment", "delivery_class", "extension_id", "updated_at");

    CREATE TABLE "runtime_extension_transition_receipts" (
      "receipt_id" varchar(128) PRIMARY KEY NOT NULL,
      "operation_id" varchar(128) NOT NULL REFERENCES "runtime_extension_operations" ("operation_id") ON DELETE cascade,
      "revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_transition_receipts_revision_key" UNIQUE ("operation_id", "revision"),
      CONSTRAINT "runtime_extension_transition_receipts_event_check" CHECK (jsonb_typeof("event_json")='object')
    );

    CREATE TABLE "runtime_extension_audit" (
      "audit_id" varchar(128) PRIMARY KEY NOT NULL,
      "operation_id" varchar(128) NOT NULL REFERENCES "runtime_extension_operations" ("operation_id") ON DELETE cascade,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "revision" integer NOT NULL,
      "inventory_revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_audit_revision_key" UNIQUE ("application_id", "environment", "delivery_class", "extension_id", "revision"),
      CONSTRAINT "runtime_extension_audit_inventory_revision_check" CHECK ("inventory_revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_audit_event_check" CHECK (jsonb_typeof("event_json")='object')
    );

    CREATE TABLE "runtime_extension_outbox" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "revision" integer NOT NULL,
      "inventory_revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "status" varchar(32) DEFAULT 'pending' NOT NULL,
      "attempt_count" integer DEFAULT 0 NOT NULL,
      "claimed_at" timestamp(3) with time zone,
      "lease_expires_at" timestamp(3) with time zone,
      "claim_token" varchar(64),
      "last_error_code" varchar(64),
      "dead_lettered_at" timestamp(3) with time zone,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_outbox_revision_key" UNIQUE ("application_id", "environment", "delivery_class", "extension_id", "revision"),
      CONSTRAINT "runtime_extension_outbox_inventory_revision_key" UNIQUE ("application_id", "environment", "inventory_revision"),
      CONSTRAINT "runtime_extension_outbox_inventory_revision_check" CHECK ("inventory_revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_outbox_status_check" CHECK ("status" IN ('pending','processing','delivered','dead-letter')),
      CONSTRAINT "runtime_extension_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
      CONSTRAINT "runtime_extension_outbox_event_check" CHECK (jsonb_typeof("event_json")='object')
    );
    CREATE INDEX "runtime_extension_outbox_pending_idx" ON "runtime_extension_outbox" ("attempt_count", "inventory_revision", "event_id") WHERE "status"='pending';
    CREATE INDEX "runtime_extension_outbox_expired_lease_idx" ON "runtime_extension_outbox" ("lease_expires_at", "event_id") WHERE "status"='processing';

    CREATE TABLE "runtime_extension_operation_budget" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "active_count" integer DEFAULT 0 NOT NULL,
      "max_count" integer NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "runtime_extension_operation_budget_count_check" CHECK ("active_count" >= 0 AND "max_count" > 0 AND "active_count" <= "max_count")
    );

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=6, "revision"=7 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_operation_budget";
    DROP TABLE "runtime_extension_outbox";
    DROP TABLE "runtime_extension_audit";
    DROP TABLE "runtime_extension_transition_receipts";
    DROP TABLE "runtime_extension_operations";
    DROP TABLE "runtime_extension_inventory_revisions";
    DROP TABLE "runtime_extension_generations";
    DROP TABLE "runtime_extensions";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=5, "revision"=6 WHERE "id"=1;
  `);
}
