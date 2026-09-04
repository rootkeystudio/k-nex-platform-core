import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export const kNexSystemOperationsSchemaMigration = Object.freeze({
  name: "20260902_000025_system_operations",
  async up({ db }: MigrateUpArgs): Promise<void> {
    await db.execute(sql`
    CREATE TABLE "k_nex_system_operations_state" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "operations_revision" integer DEFAULT 0 NOT NULL,
      "inventory_digest" varchar(71) NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "k_nex_system_operations_state_check" CHECK ("application_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "environment" ~ '^[a-z][a-z0-9-]{1,63}$' AND "operations_revision" BETWEEN 0 AND 1000000000 AND "inventory_digest" ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE "k_nex_system_operation_requests" (
      "operation_id" varchar(128) PRIMARY KEY NOT NULL,
      "request_id" varchar(128) NOT NULL UNIQUE,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "kind" varchar(16) NOT NULL,
      "expected_operations_revision" integer NOT NULL,
      "expected_inventory_digest" varchar(71) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "authority_json" jsonb NOT NULL,
      "authority_digest" varchar(71) NOT NULL,
      "request_json" jsonb NOT NULL,
      "state" varchar(16) DEFAULT 'pending' NOT NULL,
      "lease_owner" varchar(128),
      "lease_token" varchar(128),
      "lease_expires_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_system_operation_requests_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_operations_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_operation_requests_replay_key" UNIQUE ("application_id", "environment", "kind", "idempotency_key"),
      CONSTRAINT "k_nex_system_operation_requests_check" CHECK ("operation_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "request_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "kind" IN ('backup','restore-drill') AND "expected_operations_revision" BETWEEN 0 AND 1000000000 AND "expected_inventory_digest" ~ '^sha256:[0-9a-f]{64}$' AND "authority_digest" ~ '^sha256:[0-9a-f]{64}$' AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' AND jsonb_typeof("authority_json")='object' AND jsonb_typeof("request_json")='object' AND (("state"='pending' AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL) OR ("state"='processing' AND "lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state"='terminal' AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)))
    );
    CREATE INDEX "k_nex_system_operation_requests_claim_idx" ON "k_nex_system_operation_requests" ("application_id", "environment", "state", "lease_expires_at", "created_at");

    CREATE TABLE "k_nex_system_operation_receipts" (
      "receipt_id" varchar(128) PRIMARY KEY NOT NULL,
      "operation_id" varchar(128) NOT NULL,
      "request_id" varchar(128) NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "terminal" boolean NOT NULL,
      "authority_digest" varchar(71) NOT NULL,
      "receipt_json" jsonb NOT NULL,
      "occurred_at" timestamp(3) with time zone NOT NULL,
      CONSTRAINT "k_nex_system_operation_receipts_request_fk" FOREIGN KEY ("operation_id") REFERENCES "k_nex_system_operation_requests" ("operation_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_operation_receipts_terminal_key" UNIQUE NULLS NOT DISTINCT ("operation_id", "terminal"),
      CONSTRAINT "k_nex_system_operation_receipts_check" CHECK ("receipt_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "request_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "authority_digest" ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof("receipt_json")='object' AND NOT ("receipt_json" ?| ARRAY['url','repository','credential','password','secret','token','encryptionKey','rawError']))
    );

    CREATE TABLE "k_nex_system_operation_audit" (
      "audit_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "operation_id" varchar(128) NOT NULL,
      "kind" varchar(16) NOT NULL,
      "outcome" varchar(16) NOT NULL,
      "operations_revision" integer NOT NULL,
      "requested_by_kind" varchar(16) NOT NULL,
      "requested_by_id" varchar(160) NOT NULL,
      "authority_json" jsonb NOT NULL,
      "authority_digest" varchar(71) NOT NULL,
      "execution_authority" varchar(32) NOT NULL,
      "created_at" timestamp(3) with time zone NOT NULL,
      CONSTRAINT "k_nex_system_operation_audit_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_operations_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_operation_audit_request_fk" FOREIGN KEY ("operation_id") REFERENCES "k_nex_system_operation_requests" ("operation_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_operation_audit_check" CHECK ("audit_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "kind" IN ('backup','restore-drill') AND "outcome" IN ('accepted','completed','failed') AND "operations_revision" BETWEEN 1 AND 1000000000 AND "requested_by_kind" IN ('user','service') AND "requested_by_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$' AND "authority_digest" ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof("authority_json")='object' AND "execution_authority"='system-after-acceptance')
    );

    CREATE TABLE "k_nex_system_operation_outbox" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "operations_revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_system_operation_outbox_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_operations_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_operation_outbox_revision_key" UNIQUE ("application_id", "environment", "operations_revision"),
      CONSTRAINT "k_nex_system_operation_outbox_check" CHECK ("event_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "operations_revision" BETWEEN 1 AND 1000000000 AND jsonb_typeof("event_json")='object' AND NOT ("event_json" ?| ARRAY['url','repository','credential','password','secret','token','encryptionKey','rawError']))
    );

    CREATE FUNCTION public.k_nex_system_operation_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$ BEGIN RAISE EXCEPTION 'system operation receipts are immutable'; END; $$;
    REVOKE ALL ON FUNCTION public.k_nex_system_operation_receipt_immutable() FROM PUBLIC;
    CREATE TRIGGER "k_nex_system_operation_receipts_immutable" BEFORE UPDATE OR DELETE ON "k_nex_system_operation_receipts" FOR EACH ROW EXECUTE FUNCTION public.k_nex_system_operation_receipt_immutable();
    `);
  },
  async down({ db }: MigrateDownArgs): Promise<void> {
    await db.execute(sql`
    DROP TRIGGER "k_nex_system_operation_receipts_immutable" ON "k_nex_system_operation_receipts";
    DROP FUNCTION public.k_nex_system_operation_receipt_immutable();
    DROP TABLE "k_nex_system_operation_outbox";
    DROP TABLE "k_nex_system_operation_audit";
    DROP TABLE "k_nex_system_operation_receipts";
    DROP TABLE "k_nex_system_operation_requests";
    DROP TABLE "k_nex_system_operations_state";
    `);
  }
});
