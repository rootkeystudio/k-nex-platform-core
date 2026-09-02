import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "k_nex_catalog_mirror_state" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "catalog_revision" integer DEFAULT 0 NOT NULL,
      "staged_snapshot_id" varchar(128),
      "accepted_snapshot_id" varchar(128),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "k_nex_catalog_mirror_state_owner_check" CHECK ("application_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "environment" ~ '^[a-z][a-z0-9-]{1,63}$'),
      CONSTRAINT "k_nex_catalog_mirror_state_revision_check" CHECK ("catalog_revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "k_nex_catalog_mirror_snapshots" (
      "snapshot_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "signer_identity" varchar(160) NOT NULL,
      "sequence" bigint NOT NULL,
      "payload_digest" varchar(71) NOT NULL,
      "release_count" integer NOT NULL,
      "observed_at" timestamp(3) with time zone NOT NULL,
      "snapshot_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_catalog_mirror_snapshots_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_catalog_mirror_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_mirror_snapshots_owner_id_key" UNIQUE ("application_id", "environment", "snapshot_id"),
      CONSTRAINT "k_nex_catalog_mirror_snapshots_owner_sequence_key" UNIQUE ("application_id", "environment", "signer_identity", "sequence", "payload_digest"),
      CONSTRAINT "k_nex_catalog_mirror_snapshots_identity_check" CHECK ("snapshot_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "signer_identity" ~ '^[a-z0-9][a-z0-9.-]*$' AND "sequence" BETWEEN 1 AND 9007199254740991 AND "payload_digest" ~ '^sha256:[0-9a-f]{64}$' AND "release_count" BETWEEN 0 AND 10000),
      CONSTRAINT "k_nex_catalog_mirror_snapshots_json_check" CHECK (jsonb_typeof("snapshot_json")='object')
    );
    ALTER TABLE "k_nex_catalog_mirror_state"
      ADD CONSTRAINT "k_nex_catalog_mirror_state_staged_fk" FOREIGN KEY ("application_id", "environment", "staged_snapshot_id") REFERENCES "k_nex_catalog_mirror_snapshots" ("application_id", "environment", "snapshot_id") ON DELETE RESTRICT,
      ADD CONSTRAINT "k_nex_catalog_mirror_state_accepted_fk" FOREIGN KEY ("application_id", "environment", "accepted_snapshot_id") REFERENCES "k_nex_catalog_mirror_snapshots" ("application_id", "environment", "snapshot_id") ON DELETE RESTRICT;

    CREATE TABLE "k_nex_catalog_refresh_operations" (
      "refresh_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "expected_catalog_revision" integer NOT NULL,
      "staged_snapshot_id" varchar(128),
      "requested_by_kind" varchar(16) NOT NULL,
      "requested_by_id" varchar(160) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "state" varchar(32) DEFAULT 'fetching' NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_catalog_refresh_operations_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_catalog_mirror_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_operations_snapshot_fk" FOREIGN KEY ("application_id", "environment", "staged_snapshot_id") REFERENCES "k_nex_catalog_mirror_snapshots" ("application_id", "environment", "snapshot_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_operations_owner_id_key" UNIQUE ("application_id", "environment", "refresh_id"),
      CONSTRAINT "k_nex_catalog_refresh_operations_replay_key" UNIQUE ("application_id", "environment", "idempotency_key"),
      CONSTRAINT "k_nex_catalog_refresh_operations_identity_check" CHECK ("refresh_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "expected_catalog_revision" BETWEEN 0 AND 1000000000 AND "revision" BETWEEN 1 AND 1000000000 AND "requested_by_kind" IN ('user','service') AND "requested_by_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$' AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' AND (("state"='fetching' AND "staged_snapshot_id" IS NULL) OR ("state"='staged-reconciliation' AND "staged_snapshot_id" IS NOT NULL) OR ("state"='terminal')))
    );

    CREATE TABLE "k_nex_catalog_refresh_receipts" (
      "receipt_id" varchar(128) PRIMARY KEY NOT NULL,
      "refresh_id" varchar(128) NOT NULL UNIQUE,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "expected_catalog_revision" integer NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "receipt_json" jsonb NOT NULL,
      "occurred_at" timestamp(3) with time zone NOT NULL,
      CONSTRAINT "k_nex_catalog_refresh_receipts_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_catalog_mirror_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_receipts_operation_fk" FOREIGN KEY ("application_id", "environment", "refresh_id") REFERENCES "k_nex_catalog_refresh_operations" ("application_id", "environment", "refresh_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_receipts_replay_key" UNIQUE ("application_id", "environment", "idempotency_key"),
      CONSTRAINT "k_nex_catalog_refresh_receipts_identity_check" CHECK ("receipt_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "refresh_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "expected_catalog_revision" BETWEEN 0 AND 1000000000 AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
      CONSTRAINT "k_nex_catalog_refresh_receipts_safe_check" CHECK (jsonb_typeof("receipt_json")='object' AND NOT ("receipt_json" ?| ARRAY['url','repository','signer','publicKey','signature','trustRoot','token','secret']))
    );

    CREATE TABLE "k_nex_catalog_reconciliation_requirements" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "refresh_id" varchar(128) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "decision_digest" varchar(71) NOT NULL,
      "terminal_state" varchar(16) DEFAULT 'pending' NOT NULL,
      "security_receipt_id" varchar(128),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "refresh_id", "delivery_class", "extension_id", "generation_id"),
      CONSTRAINT "k_nex_catalog_reconciliation_requirements_operation_fk" FOREIGN KEY ("application_id", "environment", "refresh_id") REFERENCES "k_nex_catalog_refresh_operations" ("application_id", "environment", "refresh_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_reconciliation_requirements_receipt_fk" FOREIGN KEY ("security_receipt_id") REFERENCES "runtime_extension_security_receipts" ("receipt_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_reconciliation_requirements_check" CHECK ("delivery_class" IN ('hot-application','theme-skin') AND "extension_id" ~ '^(app|skin)\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$' AND "generation_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "decision_digest" ~ '^sha256:[0-9a-f]{64}$' AND (("terminal_state"='pending' AND "security_receipt_id" IS NULL) OR ("terminal_state"='clear' AND "security_receipt_id" IS NULL) OR ("terminal_state"='quarantined' AND "security_receipt_id" IS NOT NULL)))
    );

    CREATE TABLE "k_nex_catalog_refresh_audit" (
      "audit_id" varchar(128) PRIMARY KEY NOT NULL,
      "receipt_id" varchar(128) NOT NULL UNIQUE,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "catalog_revision" integer NOT NULL,
      "outcome" varchar(16) NOT NULL,
      "sequence" bigint NOT NULL,
      "payload_digest" varchar(71) NOT NULL,
      "release_count" integer NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_catalog_refresh_audit_receipt_fk" FOREIGN KEY ("receipt_id") REFERENCES "k_nex_catalog_refresh_receipts" ("receipt_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_audit_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_catalog_mirror_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_audit_identity_check" CHECK ("audit_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "catalog_revision" BETWEEN 0 AND 1000000000 AND "outcome"='accepted' AND "sequence" BETWEEN 1 AND 9007199254740991 AND "payload_digest" ~ '^sha256:[0-9a-f]{64}$' AND "release_count" BETWEEN 0 AND 10000)
    );

    CREATE TABLE "k_nex_catalog_refresh_outbox" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "receipt_id" varchar(128) NOT NULL UNIQUE,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "catalog_revision" integer NOT NULL,
      "status" varchar(16) DEFAULT 'pending' NOT NULL,
      "attempt_count" integer DEFAULT 0 NOT NULL,
      "claimed_at" timestamp(3) with time zone,
      "lease_expires_at" timestamp(3) with time zone,
      "claim_token" varchar(64),
      "delivered_at" timestamp(3) with time zone,
      "dead_lettered_at" timestamp(3) with time zone,
      "occurred_at" timestamp(3) with time zone NOT NULL,
      CONSTRAINT "k_nex_catalog_refresh_outbox_receipt_fk" FOREIGN KEY ("receipt_id") REFERENCES "k_nex_catalog_refresh_receipts" ("receipt_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_outbox_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_catalog_mirror_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_catalog_refresh_outbox_identity_check" CHECK ("event_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "catalog_revision" BETWEEN 1 AND 1000000000 AND "status" IN ('pending','processing','delivered','dead-letter') AND "attempt_count" >= 0)
    );
    CREATE INDEX "k_nex_catalog_refresh_outbox_pending_idx" ON "k_nex_catalog_refresh_outbox" ("application_id", "environment", "catalog_revision", "event_id") WHERE "status"='pending';

    CREATE FUNCTION public.k_nex_catalog_refresh_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Catalog refresh receipts are immutable.' USING ERRCODE = '55000'; END; $$;
    REVOKE ALL ON FUNCTION public.k_nex_catalog_refresh_receipt_immutable() FROM PUBLIC;
    CREATE TRIGGER "k_nex_catalog_refresh_receipts_immutable" BEFORE UPDATE OR DELETE ON "k_nex_catalog_refresh_receipts" FOR EACH ROW EXECUTE FUNCTION public.k_nex_catalog_refresh_receipt_immutable();
    CREATE FUNCTION public.k_nex_catalog_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Catalog snapshots are immutable.' USING ERRCODE = '55000'; END; $$;
    REVOKE ALL ON FUNCTION public.k_nex_catalog_snapshot_immutable() FROM PUBLIC;
    CREATE TRIGGER "k_nex_catalog_mirror_snapshots_immutable" BEFORE UPDATE OR DELETE ON "k_nex_catalog_mirror_snapshots" FOR EACH ROW EXECUTE FUNCTION public.k_nex_catalog_snapshot_immutable();
    CREATE FUNCTION public.k_nex_catalog_audit_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Catalog audit rows are immutable.' USING ERRCODE = '55000'; END; $$;
    REVOKE ALL ON FUNCTION public.k_nex_catalog_audit_immutable() FROM PUBLIC;
    CREATE TRIGGER "k_nex_catalog_refresh_audit_immutable" BEFORE UPDATE OR DELETE ON "k_nex_catalog_refresh_audit" FOR EACH ROW EXECUTE FUNCTION public.k_nex_catalog_audit_immutable();

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=23, "revision"=24 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER "k_nex_catalog_refresh_audit_immutable" ON "k_nex_catalog_refresh_audit";
    DROP FUNCTION public.k_nex_catalog_audit_immutable();
    DROP TRIGGER "k_nex_catalog_mirror_snapshots_immutable" ON "k_nex_catalog_mirror_snapshots";
    DROP FUNCTION public.k_nex_catalog_snapshot_immutable();
    DROP TRIGGER "k_nex_catalog_refresh_receipts_immutable" ON "k_nex_catalog_refresh_receipts";
    DROP FUNCTION public.k_nex_catalog_refresh_receipt_immutable();
    DROP TABLE "k_nex_catalog_refresh_outbox";
    DROP TABLE "k_nex_catalog_refresh_audit";
    DROP TABLE "k_nex_catalog_reconciliation_requirements";
    DROP TABLE "k_nex_catalog_refresh_receipts";
    DROP TABLE "k_nex_catalog_refresh_operations";
    ALTER TABLE "k_nex_catalog_mirror_state" DROP CONSTRAINT "k_nex_catalog_mirror_state_staged_fk", DROP CONSTRAINT "k_nex_catalog_mirror_state_accepted_fk";
    DROP TABLE "k_nex_catalog_mirror_snapshots";
    DROP TABLE "k_nex_catalog_mirror_state";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=22, "revision"=23 WHERE "id"=1;
  `);
}
