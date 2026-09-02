import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "k_nex_system_settings_state" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "settings_revision" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "k_nex_system_settings_state_identity_check" CHECK (
        "application_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "environment" ~ '^[a-z][a-z0-9-]{1,63}$'
      ),
      CONSTRAINT "k_nex_system_settings_state_revision_check" CHECK ("settings_revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "k_nex_system_settings_documents" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "descriptor_id" varchar(128) NOT NULL,
      "descriptor_schema_version" integer NOT NULL,
      "owner_scope_key" varchar(200) NOT NULL,
      "owner_kind" varchar(16) NOT NULL,
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "document_revision" integer NOT NULL,
      "settings_revision" integer NOT NULL,
      "values_json" jsonb NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "descriptor_id", "descriptor_schema_version", "owner_scope_key"),
      CONSTRAINT "k_nex_system_settings_documents_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_settings_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_documents_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_documents_identity_check" CHECK (
        "descriptor_id" ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$'
        AND "descriptor_schema_version" BETWEEN 1 AND 1000000000
        AND "document_revision" BETWEEN 1 AND 1000000000
        AND "settings_revision" BETWEEN 1 AND 1000000000
      ),
      CONSTRAINT "k_nex_system_settings_documents_owner_check" CHECK (
        ("owner_kind"='platform' AND "owner_scope_key"='platform:system' AND "owner_namespace" IS NOT NULL AND "owner_namespace"='system'
          AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL
          AND "descriptor_id" LIKE 'system.%')
        OR ("owner_kind"='extension' AND "owner_namespace" IS NULL
          AND "owner_delivery_class" IS NOT NULL AND "owner_delivery_class" IN ('platform-plugin','hot-application')
          AND "owner_extension_id" IS NOT NULL AND "owner_generation" IS NOT NULL
          AND "owner_generation" BETWEEN 1 AND 9007199254740991
          AND "owner_scope_key"="owner_delivery_class" || ':' || "owner_extension_id" || ':' || "owner_generation"::text
          AND "descriptor_id" LIKE substring("owner_extension_id" FROM position('.' IN "owner_extension_id") + 1) || '.%')
      ),
      CONSTRAINT "k_nex_system_settings_documents_values_object_check" CHECK (jsonb_typeof("values_json")='object')
    );

    CREATE TABLE "k_nex_system_settings_operations" (
      "operation_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "descriptor_id" varchar(128) NOT NULL,
      "descriptor_schema_version" integer NOT NULL,
      "owner_scope_key" varchar(200) NOT NULL,
      "owner_kind" varchar(16) NOT NULL,
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "pending_document_json" jsonb NOT NULL,
      "expected_document_revision" integer NOT NULL,
      "expected_settings_revision" integer NOT NULL,
      "state" varchar(32) NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "requested_by_kind" varchar(16) NOT NULL,
      "requested_by_id" varchar(160) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "request_digest" varchar(71) NOT NULL,
      "authority_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "authority_digest" varchar(71) DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL,
      "lease_owner" varchar(128),
      "lease_expires_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_system_settings_operations_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_settings_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_operations_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_operations_replay_key" UNIQUE ("application_id", "environment", "descriptor_id", "descriptor_schema_version", "owner_scope_key", "idempotency_key"),
      CONSTRAINT "k_nex_system_settings_operations_identity_check" CHECK (
        "operation_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "descriptor_id" ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$'
        AND "descriptor_schema_version" BETWEEN 1 AND 1000000000
        AND "expected_document_revision" BETWEEN 0 AND 1000000000 AND "expected_settings_revision" BETWEEN 0 AND 1000000000
        AND "attempts" BETWEEN 0 AND 1000000 AND "revision" BETWEEN 1 AND 1000000000
        AND "requested_by_kind" IN ('user','service') AND "requested_by_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
        AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
        AND "request_digest" ~ '^sha256:[0-9a-f]{64}$'
        AND "authority_digest" ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof("authority_json")='object'
        AND (("lease_owner" IS NULL AND "lease_expires_at" IS NULL) OR ("state"='validating' AND "lease_owner" ~ '^[a-z][a-z0-9-]{2,127}$' AND "lease_expires_at" IS NOT NULL))
      ),
      CONSTRAINT "k_nex_system_settings_operations_owner_check" CHECK (
        ("owner_kind"='platform' AND "owner_scope_key"='platform:system' AND "owner_namespace" IS NOT NULL AND "owner_namespace"='system'
          AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL AND "descriptor_id" LIKE 'system.%')
        OR ("owner_kind"='extension' AND "owner_namespace" IS NULL
          AND "owner_delivery_class" IS NOT NULL AND "owner_delivery_class" IN ('platform-plugin','hot-application')
          AND "owner_extension_id" IS NOT NULL AND "owner_generation" IS NOT NULL
          AND "owner_generation" BETWEEN 1 AND 9007199254740991
          AND "owner_scope_key"="owner_delivery_class" || ':' || "owner_extension_id" || ':' || "owner_generation"::text
          AND "descriptor_id" LIKE substring("owner_extension_id" FROM position('.' IN "owner_extension_id") + 1) || '.%')
      ),
      CONSTRAINT "k_nex_system_settings_operations_pending_object_check" CHECK (jsonb_typeof("pending_document_json")='object'),
      CONSTRAINT "k_nex_system_settings_operations_state_check" CHECK ("state" IN ('pending-validation','validating','promotion-blocked'))
    );
    CREATE INDEX "k_nex_system_settings_operations_pending_idx" ON "k_nex_system_settings_operations" ("application_id", "environment", "state", "updated_at", "operation_id");

    CREATE TABLE "k_nex_system_settings_receipts" (
      "receipt_id" varchar(128) PRIMARY KEY NOT NULL,
      "operation_id" varchar(128) NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "descriptor_id" varchar(128) NOT NULL,
      "descriptor_schema_version" integer NOT NULL,
      "owner_scope_key" varchar(200) NOT NULL,
      "owner_kind" varchar(16) NOT NULL,
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "requested_by_kind" varchar(16) NOT NULL,
      "requested_by_id" varchar(160) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "request_digest" varchar(71) NOT NULL,
      "authority_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "authority_digest" varchar(71) DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
      "outcome" varchar(32) NOT NULL,
      "receipt_json" jsonb NOT NULL,
      "occurred_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_system_settings_receipts_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_settings_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_receipts_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_receipts_operation_key" UNIQUE ("operation_id"),
      CONSTRAINT "k_nex_system_settings_receipts_replay_key" UNIQUE ("application_id", "environment", "descriptor_id", "descriptor_schema_version", "owner_scope_key", "idempotency_key"),
      CONSTRAINT "k_nex_system_settings_receipts_identity_check" CHECK (
        "receipt_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "operation_id" ~ '^[a-z][a-z0-9-]{2,127}$'
        AND "descriptor_id" ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$'
        AND "descriptor_schema_version" BETWEEN 1 AND 1000000000 AND "requested_by_kind" IN ('user','service')
        AND "requested_by_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
        AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' AND "request_digest" ~ '^sha256:[0-9a-f]{64}$'
        AND "authority_digest" ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof("authority_json")='object'
        AND "outcome" IN ('promoted','validation-failed','promotion-invalidated')
      ),
      CONSTRAINT "k_nex_system_settings_receipts_owner_check" CHECK (
        ("owner_kind"='platform' AND "owner_scope_key"='platform:system' AND "owner_namespace" IS NOT NULL AND "owner_namespace"='system'
          AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL AND "descriptor_id" LIKE 'system.%')
        OR ("owner_kind"='extension' AND "owner_namespace" IS NULL
          AND "owner_delivery_class" IS NOT NULL AND "owner_delivery_class" IN ('platform-plugin','hot-application')
          AND "owner_extension_id" IS NOT NULL AND "owner_generation" IS NOT NULL
          AND "owner_generation" BETWEEN 1 AND 9007199254740991
          AND "owner_scope_key"="owner_delivery_class" || ':' || "owner_extension_id" || ':' || "owner_generation"::text
          AND "descriptor_id" LIKE substring("owner_extension_id" FROM position('.' IN "owner_extension_id") + 1) || '.%')
      ),
      CONSTRAINT "k_nex_system_settings_receipts_safe_object_check" CHECK (
        jsonb_typeof("receipt_json")='object' AND NOT ("receipt_json" ?| ARRAY['values','value','secret','secretReference','reference'])
      )
    );

    CREATE TABLE "k_nex_system_settings_audit" (
      "audit_id" varchar(128) PRIMARY KEY NOT NULL,
      "operation_id" varchar(128),
      "receipt_id" varchar(128),
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "descriptor_id" varchar(128) NOT NULL,
      "descriptor_schema_version" integer NOT NULL,
      "owner_scope_key" varchar(200) NOT NULL,
      "owner_kind" varchar(16) NOT NULL,
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "requested_by_kind" varchar(16) NOT NULL,
      "requested_by_id" varchar(160) NOT NULL,
      "outcome" varchar(32) NOT NULL,
      "authority_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "authority_digest" varchar(71) DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
      "reauthentication" varchar(16) DEFAULT 'satisfied' NOT NULL,
      "document_revision" integer,
      "settings_revision" integer,
      "changed_fields_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_system_settings_audit_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_settings_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_audit_identity_check" CHECK (
        "audit_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "descriptor_id" ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$'
        AND "descriptor_schema_version" BETWEEN 1 AND 1000000000 AND "requested_by_kind" IN ('user','service')
        AND "requested_by_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
        AND "outcome" IN ('applied','validation-failed','promotion-invalidated')
        AND "authority_digest" ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof("authority_json")='object' AND "reauthentication"='satisfied'
        AND ("document_revision" IS NULL OR "document_revision" BETWEEN 1 AND 1000000000)
        AND ("settings_revision" IS NULL OR "settings_revision" BETWEEN 1 AND 1000000000)
      ),
      CONSTRAINT "k_nex_system_settings_audit_owner_check" CHECK (
        ("owner_kind"='platform' AND "owner_scope_key"='platform:system' AND "owner_namespace" IS NOT NULL AND "owner_namespace"='system'
          AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL AND "descriptor_id" LIKE 'system.%')
        OR ("owner_kind"='extension' AND "owner_namespace" IS NULL
          AND "owner_delivery_class" IS NOT NULL AND "owner_delivery_class" IN ('platform-plugin','hot-application')
          AND "owner_extension_id" IS NOT NULL AND "owner_generation" IS NOT NULL
          AND "owner_generation" BETWEEN 1 AND 9007199254740991
          AND "owner_scope_key"="owner_delivery_class" || ':' || "owner_extension_id" || ':' || "owner_generation"::text
          AND "descriptor_id" LIKE substring("owner_extension_id" FROM position('.' IN "owner_extension_id") + 1) || '.%')
      ),
      CONSTRAINT "k_nex_system_settings_audit_safe_fields_check" CHECK (jsonb_typeof("changed_fields_json")='array')
    );
    CREATE INDEX "k_nex_system_settings_audit_scope_idx" ON "k_nex_system_settings_audit" ("application_id", "environment", "descriptor_id", "created_at", "audit_id");

    CREATE TABLE "k_nex_system_settings_outbox" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "descriptor_id" varchar(128) NOT NULL,
      "descriptor_schema_version" integer NOT NULL,
      "owner_scope_key" varchar(200) NOT NULL,
      "owner_kind" varchar(16) NOT NULL,
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "settings_revision" integer NOT NULL,
      "status" varchar(32) DEFAULT 'pending' NOT NULL,
      "attempt_count" integer DEFAULT 0 NOT NULL,
      "claimed_at" timestamp(3) with time zone,
      "lease_expires_at" timestamp(3) with time zone,
      "claim_token" varchar(64),
      "last_error_code" varchar(64),
      "dead_lettered_at" timestamp(3) with time zone,
      "occurred_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_system_settings_outbox_state_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "k_nex_system_settings_state" ("application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_outbox_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_system_settings_outbox_revision_key" UNIQUE ("application_id", "environment", "settings_revision"),
      CONSTRAINT "k_nex_system_settings_outbox_identity_check" CHECK (
        "event_id" ~ '^[a-z][a-z0-9-]{2,127}$' AND "descriptor_id" ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$'
        AND "descriptor_schema_version" BETWEEN 1 AND 1000000000 AND "settings_revision" BETWEEN 1 AND 1000000000
        AND "status" IN ('pending','processing','delivered','dead-letter') AND "attempt_count" >= 0
      ),
      CONSTRAINT "k_nex_system_settings_outbox_owner_check" CHECK (
        ("owner_kind"='platform' AND "owner_scope_key"='platform:system' AND "owner_namespace" IS NOT NULL AND "owner_namespace"='system'
          AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL AND "descriptor_id" LIKE 'system.%')
        OR ("owner_kind"='extension' AND "owner_namespace" IS NULL
          AND "owner_delivery_class" IS NOT NULL AND "owner_delivery_class" IN ('platform-plugin','hot-application')
          AND "owner_extension_id" IS NOT NULL AND "owner_generation" IS NOT NULL
          AND "owner_generation" BETWEEN 1 AND 9007199254740991
          AND "owner_scope_key"="owner_delivery_class" || ':' || "owner_extension_id" || ':' || "owner_generation"::text
          AND "descriptor_id" LIKE substring("owner_extension_id" FROM position('.' IN "owner_extension_id") + 1) || '.%')
      )
    );
    CREATE INDEX "k_nex_system_settings_outbox_pending_idx" ON "k_nex_system_settings_outbox" ("attempt_count", "settings_revision", "event_id") WHERE "status"='pending';
    CREATE INDEX "k_nex_system_settings_outbox_expired_lease_idx" ON "k_nex_system_settings_outbox" ("lease_expires_at", "event_id") WHERE "status"='processing';

    CREATE FUNCTION public.k_nex_system_settings_receipt_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    BEGIN
      RAISE EXCEPTION 'System settings terminal receipts are immutable.' USING ERRCODE = '55000';
    END;
    $$;
    REVOKE ALL ON FUNCTION public.k_nex_system_settings_receipt_immutable() FROM PUBLIC;
    CREATE TRIGGER "k_nex_system_settings_receipts_immutable"
      BEFORE UPDATE OR DELETE ON "k_nex_system_settings_receipts"
      FOR EACH ROW EXECUTE FUNCTION public.k_nex_system_settings_receipt_immutable();

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=22, "revision"=23 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER "k_nex_system_settings_receipts_immutable" ON "k_nex_system_settings_receipts";
    DROP FUNCTION public.k_nex_system_settings_receipt_immutable();
    DROP TABLE "k_nex_system_settings_outbox";
    DROP TABLE "k_nex_system_settings_audit";
    DROP TABLE "k_nex_system_settings_receipts";
    DROP TABLE "k_nex_system_settings_operations";
    DROP TABLE "k_nex_system_settings_documents";
    DROP TABLE "k_nex_system_settings_state";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=21, "revision"=22 WHERE "id"=1;
  `);
}
