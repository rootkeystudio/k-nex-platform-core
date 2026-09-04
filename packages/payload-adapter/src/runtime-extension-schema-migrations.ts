import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

const migration20260829_000007_runtime_extensions = Object.freeze({
  name: "20260829_000007_runtime_extensions",
async up({ db }: MigrateUpArgs): Promise<void> {
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
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_operation_budget";
    DROP TABLE "runtime_extension_outbox";
    DROP TABLE "runtime_extension_audit";
    DROP TABLE "runtime_extension_transition_receipts";
    DROP TABLE "runtime_extension_operations";
    DROP TABLE "runtime_extension_inventory_revisions";
    DROP TABLE "runtime_extension_generations";
    DROP TABLE "runtime_extensions";
  `);
}
});

const migration20260829_000008_app_storage = Object.freeze({
  name: "20260829_000008_app_storage",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_extension_storage_namespaces" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "app_id" varchar(128) NOT NULL,
      "schema_id" varchar(128) NOT NULL,
      "schema_version" integer NOT NULL,
      "quota_bytes" bigint NOT NULL,
      "used_bytes" bigint DEFAULT 0 NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "app_id", "schema_id"),
      CONSTRAINT "runtime_extension_storage_application_id_check" CHECK ("application_id" ~ '^[a-z][a-z0-9-]{2,127}$'),
      CONSTRAINT "runtime_extension_storage_environment_check" CHECK ("environment" ~ '^[a-z][a-z0-9-]{1,63}$'),
      CONSTRAINT "runtime_extension_storage_app_id_check" CHECK ("app_id" ~ '^app(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$'),
      CONSTRAINT "runtime_extension_storage_schema_id_check" CHECK ("schema_id" ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$'),
      CONSTRAINT "runtime_extension_storage_schema_version_check" CHECK ("schema_version" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_storage_quota_check" CHECK ("quota_bytes" BETWEEN 1 AND 268435456 AND "used_bytes" BETWEEN 0 AND "quota_bytes"),
      CONSTRAINT "runtime_extension_storage_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "runtime_extension_storage_records" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "app_id" varchar(128) NOT NULL,
      "schema_id" varchar(128) NOT NULL,
      "storage_key" varchar(160) NOT NULL,
      "value_json" jsonb NOT NULL,
      "value_bytes" integer NOT NULL,
      "revision" integer NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "app_id", "schema_id", "storage_key"),
      CONSTRAINT "runtime_extension_storage_records_namespace_fk" FOREIGN KEY ("application_id", "environment", "app_id", "schema_id") REFERENCES "runtime_extension_storage_namespaces" ("application_id", "environment", "app_id", "schema_id") ON DELETE cascade,
      CONSTRAINT "runtime_extension_storage_key_check" CHECK ("storage_key" ~ '^[a-z][a-z0-9._:-]{0,159}$'),
      CONSTRAINT "runtime_extension_storage_value_bytes_check" CHECK ("value_bytes" BETWEEN 1 AND 1048576),
      CONSTRAINT "runtime_extension_storage_record_revision_check" CHECK ("revision" BETWEEN 1 AND 1000000000)
    );
    CREATE INDEX "runtime_extension_storage_records_query_idx" ON "runtime_extension_storage_records" ("application_id", "environment", "app_id", "schema_id", "storage_key");
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_storage_records";
    DROP TABLE "runtime_extension_storage_namespaces";
  `);
}
});

const migration20260829_000009_extension_activation = Object.freeze({
  name: "20260829_000009_extension_activation",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "runtime_extensions"
      ADD COLUMN "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
      ADD COLUMN "settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
      ADD COLUMN "storage_schema_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
      ADD COLUMN "rollback_compatibility_json" jsonb,
      ADD CONSTRAINT "runtime_extensions_activation_json_check" CHECK (
        jsonb_typeof("metadata_json")='object' AND jsonb_typeof("settings_json")='object' AND jsonb_typeof("storage_schema_versions")='object'
      ),
      ADD CONSTRAINT "runtime_extensions_rollback_compatibility_check" CHECK ("rollback_compatibility_json" IS NULL OR jsonb_typeof("rollback_compatibility_json")='object');

    ALTER TABLE "runtime_extension_generations"
      ADD COLUMN "state" varchar(16) DEFAULT 'staged' NOT NULL,
      ADD COLUMN "server_generation_id" varchar(128),
      ADD COLUMN "ui_generation_id" varchar(128),
      ADD COLUMN "storage_generation_id" varchar(128),
      ADD COLUMN "activation_json" jsonb,
      ADD COLUMN "compatibility_json" jsonb,
      ADD COLUMN "readiness_token" varchar(160),
      ADD COLUMN "readiness_expires_at" timestamp(3) with time zone,
      ADD COLUMN "staged_revision" integer,
      ADD COLUMN "receipt_id" varchar(128),
      ADD COLUMN "activated_at" timestamp(3) with time zone,
      ADD CONSTRAINT "runtime_extension_generations_state_check" CHECK ("state" IN ('staged','warming','active','rollback','retired')),
      ADD CONSTRAINT "runtime_extension_generations_identity_fence_check" CHECK (
        ("server_generation_id" IS NULL AND "ui_generation_id" IS NULL AND "storage_generation_id" IS NULL) OR
        ("server_generation_id"="generation_id" AND "ui_generation_id"="generation_id" AND "storage_generation_id"="generation_id")
      ),
      ADD CONSTRAINT "runtime_extension_generations_activation_json_check" CHECK ("activation_json" IS NULL OR jsonb_typeof("activation_json")='object'),
      ADD CONSTRAINT "runtime_extension_generations_compatibility_json_check" CHECK ("compatibility_json" IS NULL OR jsonb_typeof("compatibility_json")='object'),
      ADD CONSTRAINT "runtime_extension_generations_staged_revision_check" CHECK ("staged_revision" IS NULL OR "staged_revision" BETWEEN 1 AND 1000000000);

    CREATE TABLE "runtime_extension_generation_leases" (
      "lease_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "holder" varchar(160) NOT NULL,
      "expires_at" timestamp(3) with time zone NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_generation_leases_generation_fk" FOREIGN KEY (
        "application_id", "environment", "delivery_class", "extension_id", "generation_id"
      ) REFERENCES "runtime_extension_generations" (
        "application_id", "environment", "delivery_class", "extension_id", "generation_id"
      ) ON DELETE cascade
    );
    CREATE INDEX "runtime_extension_generation_leases_live_idx" ON "runtime_extension_generation_leases" (
      "application_id", "environment", "delivery_class", "extension_id", "generation_id", "expires_at"
    );
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_generation_leases";
    ALTER TABLE "runtime_extension_generations"
      DROP CONSTRAINT "runtime_extension_generations_staged_revision_check",
      DROP CONSTRAINT "runtime_extension_generations_compatibility_json_check",
      DROP CONSTRAINT "runtime_extension_generations_activation_json_check",
      DROP CONSTRAINT "runtime_extension_generations_identity_fence_check",
      DROP CONSTRAINT "runtime_extension_generations_state_check",
      DROP COLUMN "activated_at",
      DROP COLUMN "receipt_id",
      DROP COLUMN "staged_revision",
      DROP COLUMN "readiness_expires_at",
      DROP COLUMN "readiness_token",
      DROP COLUMN "compatibility_json",
      DROP COLUMN "activation_json",
      DROP COLUMN "storage_generation_id",
      DROP COLUMN "ui_generation_id",
      DROP COLUMN "server_generation_id",
      DROP COLUMN "state";
    ALTER TABLE "runtime_extensions"
      DROP CONSTRAINT "runtime_extensions_rollback_compatibility_check",
      DROP CONSTRAINT "runtime_extensions_activation_json_check",
      DROP COLUMN "rollback_compatibility_json",
      DROP COLUMN "storage_schema_versions",
      DROP COLUMN "settings_json",
      DROP COLUMN "metadata_json";
  `);
}
});

const migration20260829_000010_theme_skin_profiles = Object.freeze({
  name: "20260829_000010_theme_skin_profiles",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_theme_profile_publications" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "profile_id" varchar(128) NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "active_revision_id" varchar(128),
      "active_profile" jsonb,
      "previous_revision_id" varchar(128),
      "previous_profile" jsonb,
      "draft_revision_id" varchar(128),
      "draft_profile" jsonb,
      "state_digest" varchar(71),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "profile_id"),
      CONSTRAINT "runtime_theme_profile_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "runtime_theme_profile_active_pair_check" CHECK (("active_revision_id" IS NULL)=("active_profile" IS NULL)),
      CONSTRAINT "runtime_theme_profile_previous_pair_check" CHECK (("previous_revision_id" IS NULL)=("previous_profile" IS NULL)),
      CONSTRAINT "runtime_theme_profile_draft_pair_check" CHECK (("draft_revision_id" IS NULL)=("draft_profile" IS NULL)),
      CONSTRAINT "runtime_theme_profile_json_check" CHECK (
        ("active_profile" IS NULL OR jsonb_typeof("active_profile")='object') AND
        ("previous_profile" IS NULL OR jsonb_typeof("previous_profile")='object') AND
        ("draft_profile" IS NULL OR jsonb_typeof("draft_profile")='object')
      ),
      CONSTRAINT "runtime_theme_profile_state_digest_check" CHECK ("state_digest" IS NULL OR "state_digest" ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE "runtime_theme_profile_outbox" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "profile_id" varchar(128) NOT NULL,
      "revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "status" varchar(16) DEFAULT 'pending' NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_theme_profile_outbox_owner_fk" FOREIGN KEY ("application_id", "environment", "profile_id")
        REFERENCES "runtime_theme_profile_publications" ("application_id", "environment", "profile_id") ON DELETE cascade,
      CONSTRAINT "runtime_theme_profile_outbox_revision_key" UNIQUE ("application_id", "environment", "profile_id", "revision"),
      CONSTRAINT "runtime_theme_profile_outbox_revision_check" CHECK ("revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_theme_profile_outbox_status_check" CHECK ("status" IN ('pending','delivered')),
      CONSTRAINT "runtime_theme_profile_outbox_event_check" CHECK (jsonb_typeof("event_json")='object')
    );
    CREATE INDEX "runtime_theme_profile_outbox_pending_idx" ON "runtime_theme_profile_outbox" ("status", "revision", "event_id") WHERE "status"='pending';
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_theme_profile_outbox";
    DROP TABLE "runtime_theme_profile_publications";
  `);
}
});

const migration20260829_000011_static_deployment = Object.freeze({
  name: "20260829_000011_static_deployment",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_static_deployments" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "active_generation_id" varchar(128) NOT NULL,
      "active_generation" jsonb NOT NULL,
      "rollback_generation_id" varchar(128),
      "rollback_generation" jsonb,
      "rollback_window" jsonb NOT NULL,
      "transition_checkpoint" jsonb,
      "state_digest" varchar(71) NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "runtime_static_deployments_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "runtime_static_deployments_generation_json_check" CHECK (
        jsonb_typeof("active_generation")='object' AND ("rollback_generation" IS NULL OR jsonb_typeof("rollback_generation")='object')
      ),
      CONSTRAINT "runtime_static_deployments_rollback_pair_check" CHECK (("rollback_generation_id" IS NULL)=("rollback_generation" IS NULL)),
      CONSTRAINT "runtime_static_deployments_rollback_window_check" CHECK (jsonb_typeof("rollback_window")='object'),
      CONSTRAINT "runtime_static_deployments_transition_checkpoint_check" CHECK ("transition_checkpoint" IS NULL OR jsonb_typeof("transition_checkpoint")='object'),
      CONSTRAINT "runtime_static_deployments_state_digest_check" CHECK ("state_digest" ~ '^sha256:[0-9a-f]{64}$')
    );

    CREATE TABLE "runtime_worker_generation_fences" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "active_execution_generation" varchar(128) NOT NULL,
      "fencing_token" bigint NOT NULL,
      "lease_owner" varchar(160) NOT NULL,
      "lease_expires_at" timestamp(3) with time zone NOT NULL,
      "promotion_revision" integer NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "runtime_worker_generation_fences_owner_fk" FOREIGN KEY ("application_id", "environment")
        REFERENCES "runtime_static_deployments" ("application_id", "environment") ON DELETE cascade,
      CONSTRAINT "runtime_worker_generation_fences_token_check" CHECK ("fencing_token" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "runtime_worker_generation_fences_revision_check" CHECK ("promotion_revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "runtime_static_generation_retirements" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "reservation_id" uuid NOT NULL,
      "state" varchar(16) DEFAULT 'reserved' NOT NULL,
      "reserved_at" timestamp(3) with time zone NOT NULL,
      "completed_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "generation_id"),
      CONSTRAINT "runtime_static_generation_retirements_reservation_key" UNIQUE ("reservation_id"),
      CONSTRAINT "runtime_static_generation_retirements_owner_fk" FOREIGN KEY ("application_id", "environment")
        REFERENCES "runtime_static_deployments" ("application_id", "environment") ON DELETE cascade,
      CONSTRAINT "runtime_static_generation_retirements_generation_check" CHECK ("generation_id" ~ '^[a-z][a-z0-9-]{2,127}$'),
      CONSTRAINT "runtime_static_generation_retirements_state_check" CHECK ("state" IN ('reserved','completed')),
      CONSTRAINT "runtime_static_generation_retirements_completion_check" CHECK (("state"='completed')=("completed_at" IS NOT NULL))
    );
    CREATE INDEX "runtime_static_generation_retirements_pending_idx"
      ON "runtime_static_generation_retirements" ("application_id", "environment", "reserved_at", "generation_id")
      WHERE "state"='reserved';

    CREATE TABLE "runtime_static_worker_activations" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "deployment_revision" integer NOT NULL,
      "fencing_token" bigint NOT NULL,
      "promotion_revision" integer NOT NULL,
      "lease_owner" varchar(160) NOT NULL,
      "execution_lease_duration_ms" integer NOT NULL,
      "recovery_id" uuid PRIMARY KEY NOT NULL,
      "state" varchar(16) DEFAULT 'reserved' NOT NULL,
      "recovery_expires_at" timestamp(3) with time zone NOT NULL,
      "reserved_at" timestamp(3) with time zone NOT NULL,
      "completed_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_static_worker_activations_owner_fk" FOREIGN KEY ("application_id", "environment")
        REFERENCES "runtime_static_deployments" ("application_id", "environment") ON DELETE cascade,
      CONSTRAINT "runtime_static_worker_activations_generation_check" CHECK ("generation_id" ~ '^[a-z][a-z0-9-]{2,127}$'),
      CONSTRAINT "runtime_static_worker_activations_revision_check" CHECK ("deployment_revision" BETWEEN 0 AND 1000000000 AND "promotion_revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "runtime_static_worker_activations_token_check" CHECK ("fencing_token" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "runtime_static_worker_activations_lease_duration_check" CHECK ("execution_lease_duration_ms" BETWEEN 1000 AND 300000),
      CONSTRAINT "runtime_static_worker_activations_state_check" CHECK ("state" IN ('reserved','completed','expired')),
      CONSTRAINT "runtime_static_worker_activations_completion_check" CHECK (("state"='completed')=("completed_at" IS NOT NULL))
    );
    CREATE UNIQUE INDEX "runtime_static_worker_activations_live_owner_idx"
      ON "runtime_static_worker_activations" ("application_id", "environment") WHERE "state"='reserved';
    CREATE INDEX "runtime_static_worker_activations_owner_idx"
      ON "runtime_static_worker_activations" ("application_id", "environment");

    CREATE TABLE "runtime_static_worker_recovery_outbox" (
      "event_id" uuid PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "recovery_id" uuid UNIQUE NOT NULL,
      "deployment_revision" integer NOT NULL,
      "promotion_revision" integer NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "previous_fencing_token" bigint NOT NULL,
      "previous_lease_owner" varchar(160) NOT NULL,
      "fencing_token" bigint NOT NULL,
      "lease_owner" varchar(160) NOT NULL,
      "execution_lease_duration_ms" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_static_worker_recovery_outbox_owner_fk" FOREIGN KEY ("application_id", "environment") REFERENCES "runtime_static_deployments" ("application_id", "environment") ON DELETE cascade,
      CONSTRAINT "runtime_static_worker_recovery_outbox_activation_fk" FOREIGN KEY ("recovery_id") REFERENCES "runtime_static_worker_activations" ("recovery_id") ON DELETE restrict,
      CONSTRAINT "runtime_static_worker_recovery_outbox_token_check" CHECK ("previous_fencing_token" BETWEEN 1 AND 9007199254740991 AND "fencing_token" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "runtime_static_worker_recovery_outbox_lease_duration_check" CHECK ("execution_lease_duration_ms" BETWEEN 1000 AND 300000),
      CONSTRAINT "runtime_static_worker_recovery_outbox_revision_check" CHECK ("deployment_revision" BETWEEN 0 AND 1000000000 AND "promotion_revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "runtime_static_worker_recovery_outbox_event_check" CHECK (jsonb_typeof("event_json")='object')
    );

    CREATE TABLE "runtime_worker_effects" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "effect_id" varchar(128) NOT NULL,
      "state" varchar(16) DEFAULT 'pending' NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "fencing_token" bigint NOT NULL,
      "attempts" integer DEFAULT 1 NOT NULL,
      "claim_owner" varchar(160),
      "claim_token" uuid,
      "claim_expires_at" timestamp(3) with time zone,
      "result_digest" varchar(71),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "effect_id"),
      CONSTRAINT "runtime_worker_effects_fence_fk" FOREIGN KEY ("application_id", "environment")
        REFERENCES "runtime_worker_generation_fences" ("application_id", "environment") ON DELETE cascade,
      CONSTRAINT "runtime_worker_effects_state_check" CHECK ("state" IN ('pending','completed')),
      CONSTRAINT "runtime_worker_effects_token_check" CHECK ("fencing_token" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "runtime_worker_effects_attempts_check" CHECK ("attempts" BETWEEN 1 AND 1000000),
      CONSTRAINT "runtime_worker_effects_result_check" CHECK (("state"='completed')=("result_digest" IS NOT NULL) AND ("result_digest" IS NULL OR "result_digest" ~ '^sha256:[0-9a-f]{64}$')),
      CONSTRAINT "runtime_worker_effects_claim_check" CHECK (
        ("state"='pending')=("claim_owner" IS NOT NULL AND "claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
      )
    );

    CREATE TABLE "runtime_static_deployment_outbox" (
      "event_id" varchar(128) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "revision" integer NOT NULL,
      "event_json" jsonb NOT NULL,
      "status" varchar(16) DEFAULT 'pending' NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_static_deployment_outbox_owner_fk" FOREIGN KEY ("application_id", "environment")
        REFERENCES "runtime_static_deployments" ("application_id", "environment") ON DELETE cascade,
      CONSTRAINT "runtime_static_deployment_outbox_revision_key" UNIQUE ("application_id", "environment", "revision"),
      CONSTRAINT "runtime_static_deployment_outbox_revision_check" CHECK ("revision" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_static_deployment_outbox_status_check" CHECK ("status" IN ('pending','delivered')),
      CONSTRAINT "runtime_static_deployment_outbox_event_check" CHECK (jsonb_typeof("event_json")='object')
    );
    CREATE INDEX "runtime_static_deployment_outbox_pending_idx" ON "runtime_static_deployment_outbox" ("status", "revision", "event_id") WHERE "status"='pending';
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_static_deployment_outbox";
    DROP TABLE "runtime_worker_effects";
    DROP TABLE "runtime_static_worker_recovery_outbox";
    DROP TABLE "runtime_static_worker_activations";
    DROP TABLE "runtime_static_generation_retirements";
    DROP TABLE "runtime_worker_generation_fences";
    DROP TABLE "runtime_static_deployments";
  `);
}
});

const migration20260829_000012_verified_artifacts = Object.freeze({
  name: "20260829_000012_verified_artifacts",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_extension_artifacts" (
      "artifact_digest" varchar(71) PRIMARY KEY NOT NULL,
      "artifact_bytes" bytea NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_extension_artifacts_digest_check" CHECK ("artifact_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_extension_artifacts_bytes_check" CHECK (octet_length("artifact_bytes") BETWEEN 1 AND 268435456)
    );

    CREATE TABLE "runtime_extension_artifact_acceptances" (
      "artifact_digest" varchar(71) NOT NULL REFERENCES "runtime_extension_artifacts" ("artifact_digest") ON DELETE RESTRICT,
      "catalog_digest" varchar(71) NOT NULL,
      "catalog_json" jsonb NOT NULL,
      "provenance_bytes" bytea NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "version" varchar(64) NOT NULL,
      "runtime_abi" varchar(64) NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("artifact_digest", "catalog_digest"),
      CONSTRAINT "runtime_extension_artifact_acceptances_digest_check" CHECK ("catalog_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_extension_artifact_acceptances_class_check" CHECK ("delivery_class" = 'hot-application'),
      CONSTRAINT "runtime_extension_artifact_acceptances_provenance_check" CHECK (octet_length("provenance_bytes") BETWEEN 1 AND 1048576),
      CONSTRAINT "runtime_extension_artifact_acceptances_catalog_check" CHECK (jsonb_typeof("catalog_json") = 'object')
    );

    CREATE TABLE "runtime_extension_artifact_bindings" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "artifact_digest" varchar(71) NOT NULL,
      "catalog_digest" varchar(71) NOT NULL,
      "authority_json" jsonb NOT NULL,
      "activation_json" jsonb NOT NULL,
      "version" varchar(64) NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "delivery_class", "extension_id", "generation_id"),
      CONSTRAINT "runtime_extension_artifact_bindings_acceptance_fk" FOREIGN KEY ("artifact_digest", "catalog_digest") REFERENCES "runtime_extension_artifact_acceptances" ("artifact_digest", "catalog_digest") ON DELETE RESTRICT,
      CONSTRAINT "runtime_extension_artifact_bindings_owner_check" CHECK ("delivery_class" = 'hot-application'),
      CONSTRAINT "runtime_extension_artifact_bindings_authority_check" CHECK (jsonb_typeof("authority_json") = 'object' AND "authority_json" ? 'catalogDigest' AND "catalog_digest" = "authority_json"->>'catalogDigest'),
      CONSTRAINT "runtime_extension_artifact_bindings_activation_check" CHECK (jsonb_typeof("activation_json") = 'object')
    );
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_artifact_bindings";
    DROP TABLE "runtime_extension_artifact_acceptances";
    DROP TABLE "runtime_extension_artifacts";
  `);
}
});

const migration20260829_000013_catalog_checkpoints = Object.freeze({
  name: "20260829_000013_catalog_checkpoints",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_catalog_checkpoints" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "signer_identity" varchar(160) NOT NULL,
      "sequence" bigint NOT NULL,
      "payload_digest" varchar(71) NOT NULL,
      "highest_versions" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "signer_identity"),
      CONSTRAINT "runtime_catalog_checkpoints_sequence_check" CHECK ("sequence" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "runtime_catalog_checkpoints_digest_check" CHECK ("payload_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_catalog_checkpoints_versions_object_check" CHECK (jsonb_typeof("highest_versions") = 'object')
    );
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_catalog_checkpoints";
  `);
}
});

const migration20260829_000014_theme_skin_verified_artifacts = Object.freeze({
  name: "20260829_000014_theme_skin_verified_artifacts",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "runtime_extension_artifact_acceptances"
      DROP CONSTRAINT "runtime_extension_artifact_acceptances_class_check",
      ADD CONSTRAINT "runtime_extension_artifact_acceptances_class_check" CHECK ("delivery_class" IN ('hot-application', 'theme-skin'));

    ALTER TABLE "runtime_extension_artifact_bindings"
      DROP CONSTRAINT "runtime_extension_artifact_bindings_owner_check",
      ADD CONSTRAINT "runtime_extension_artifact_bindings_owner_check" CHECK ("delivery_class" IN ('hot-application', 'theme-skin'));
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "runtime_extension_artifact_bindings"
      DROP CONSTRAINT "runtime_extension_artifact_bindings_owner_check",
      ADD CONSTRAINT "runtime_extension_artifact_bindings_owner_check" CHECK ("delivery_class" = 'hot-application');

    ALTER TABLE "runtime_extension_artifact_acceptances"
      DROP CONSTRAINT "runtime_extension_artifact_acceptances_class_check",
      ADD CONSTRAINT "runtime_extension_artifact_acceptances_class_check" CHECK ("delivery_class" = 'hot-application');
  `);
}
});

const migration20260829_000015_extension_capability_authority = Object.freeze({
  name: "20260829_000015_extension_capability_authority",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_extension_capability_sequences" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "app_id" varchar(128) NOT NULL,
      "generation_id" varchar(128) NOT NULL,
      "invocation_id" varchar(128) NOT NULL,
      "token_id" varchar(128) NOT NULL,
      "issued_at" timestamp(3) with time zone NOT NULL,
      "principal_id" varchar(160) NOT NULL,
      "effective_actor_id" varchar(160) NOT NULL,
      "delegation_id" varchar(160) DEFAULT '' NOT NULL,
      "sequence" integer NOT NULL,
      "expires_at" timestamp(3) with time zone NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "app_id", "generation_id", "invocation_id", "token_id", "issued_at", "principal_id", "effective_actor_id", "delegation_id"),
      CONSTRAINT "runtime_extension_capability_sequences_sequence_check" CHECK ("sequence" BETWEEN 1 AND 1000000000),
      CONSTRAINT "runtime_extension_capability_sequences_expiry_check" CHECK ("expires_at" > "issued_at")
    );
    CREATE INDEX "runtime_extension_capability_sequences_expiry_idx" ON "runtime_extension_capability_sequences" ("expires_at");
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_capability_sequences";
  `);
}
});

const migration20260829_000016_extension_security_quarantine = Object.freeze({
  name: "20260829_000016_extension_security_quarantine",
async up({ db }: MigrateUpArgs): Promise<void> {
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
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_security_audit";
    DROP TABLE "runtime_extension_security_receipts";
  `);
}
});

const migration20260829_000017_static_release_authority = Object.freeze({
  name: "20260829_000017_static_release_authority",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "runtime_static_composition_checkpoints" (
      "checkpoint_id" varchar(71) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "expected_source_commit" varchar(40) NOT NULL,
      "change_json" jsonb NOT NULL,
      "change_digest" varchar(71) NOT NULL,
      "status" varchar(16) DEFAULT 'planned' NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "committed_at" timestamp(3) with time zone,
      CONSTRAINT "runtime_static_composition_checkpoints_commit_check" CHECK ("expected_source_commit" ~ '^[0-9a-f]{40}$' AND "change_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_static_composition_checkpoints_status_check" CHECK ("status" IN ('planned','committed')),
      CONSTRAINT "runtime_static_composition_checkpoints_json_check" CHECK (jsonb_typeof("change_json")='object'),
      CONSTRAINT "runtime_static_composition_checkpoints_completed_check" CHECK (("status"='committed')=("committed_at" IS NOT NULL))
    );

    CREATE TABLE "runtime_static_release_requests" (
      "request_digest" varchar(71) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "version" varchar(64) NOT NULL,
      "source_commit" varchar(40) NOT NULL,
      "change_plan_digest" varchar(71) NOT NULL,
      "change_json" jsonb NOT NULL,
      "authorization_json" jsonb NOT NULL,
      "status" varchar(24) DEFAULT 'build-requested' NOT NULL,
      "generation_id" varchar(128),
      "build_evidence_digest" varchar(71),
      "application_digest" varchar(71),
      "image_digest" varchar(71),
      "migration_revision" integer,
      "worker_fencing_token" bigint,
      "receipt_id" varchar(128),
      "receipt_json" jsonb,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "runtime_static_release_requests_digest_check" CHECK ("request_digest" ~ '^sha256:[0-9a-f]{64}$' AND "source_commit" ~ '^[0-9a-f]{40}$' AND "change_plan_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "runtime_static_release_requests_version_check" CHECK ("version" ~ '^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*)|(?:[0-9]*[A-Za-z-][0-9A-Za-z-]*))(?:\\.(?:(?:0|[1-9][0-9]*)|(?:[0-9]*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'),
      CONSTRAINT "runtime_static_release_requests_json_check" CHECK (jsonb_typeof("change_json")='object' AND jsonb_typeof("authorization_json")='object' AND ("receipt_json" IS NULL OR jsonb_typeof("receipt_json")='object')),
      CONSTRAINT "runtime_static_release_requests_status_check" CHECK ("status" IN ('build-requested','builder-attested','deployment-requested','deployed','rejected')),
      CONSTRAINT "runtime_static_release_requests_attestation_check" CHECK (
        CASE WHEN "status" IN ('builder-attested','deployment-requested','deployed')
          THEN ("build_evidence_digest" ~ '^sha256:[0-9a-f]{64}$' AND "application_digest" ~ '^sha256:[0-9a-f]{64}$' AND "image_digest" ~ '^sha256:[0-9a-f]{64}$') IS TRUE
          ELSE "build_evidence_digest" IS NULL AND "application_digest" IS NULL AND "image_digest" IS NULL
        END
      ),
      CONSTRAINT "runtime_static_release_requests_result_check" CHECK (
        CASE WHEN "status"='deployed'
          THEN ("generation_id" IS NOT NULL AND "migration_revision" BETWEEN 0 AND 1000000000 AND "worker_fencing_token" BETWEEN 1 AND 9007199254740991 AND "receipt_id" IS NOT NULL AND "receipt_json" IS NOT NULL) IS TRUE
          ELSE "generation_id" IS NULL AND "migration_revision" IS NULL AND "worker_fencing_token" IS NULL AND "receipt_id" IS NULL AND "receipt_json" IS NULL
        END
      )
    );
    CREATE INDEX "runtime_static_release_requests_pending_idx" ON "runtime_static_release_requests" ("status", "created_at") WHERE "status" IN ('build-requested','builder-attested','deployment-requested');
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_static_release_requests";
    DROP TABLE "runtime_static_composition_checkpoints";
  `);
}
});

const migration20260829_000018_runner_quarantine = Object.freeze({
  name: "20260829_000018_runner_quarantine",
async up({ db }: MigrateUpArgs): Promise<void> {
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
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_runner_quarantine_receipts";
  `);
}
});

export const kNexStaticLifecycleAdmissionSchemaMigration = Object.freeze({
  name: "20260901_000022_static_lifecycle_admission",
async up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE FUNCTION public.k_nex_static_lifecycle_admission(
      p_operation_id varchar,
      p_application_id varchar,
      p_environment varchar,
      p_extension_id varchar
    ) RETURNS TABLE (
      operation_id varchar,
      expected_revision integer,
      phase varchar,
      plan_json jsonb,
      authorization_json jsonb,
      lifecycle_revision integer,
      disposition varchar
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    BEGIN
      RETURN QUERY
        SELECT o.operation_id, o.expected_revision, o.phase, o.plan_json, o.authorization_json, e.revision, e.disposition
        FROM public.runtime_extension_operations AS o
        JOIN public.runtime_extensions AS e
          ON e.application_id=o.application_id
          AND e.environment=o.environment
          AND e.delivery_class=o.delivery_class
          AND e.extension_id=o.extension_id
        WHERE o.operation_id=p_operation_id
          AND o.application_id=p_application_id
          AND o.environment=p_environment
          AND o.delivery_class='platform-plugin'
          AND o.extension_id=p_extension_id
          AND e.last_operation_id=o.operation_id
        FOR UPDATE OF o, e;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_lifecycle_admission(character varying, character varying, character varying, character varying) FROM PUBLIC;

    CREATE FUNCTION public.k_nex_static_impact_plan(
      p_operation_id varchar,
      p_application_id varchar,
      p_environment varchar,
      p_extension_id varchar
    ) RETURNS TABLE (
      operation_id varchar,
      application_id varchar,
      environment varchar,
      expected_revision integer,
      phase varchar,
      plan_json jsonb,
      authorization_json jsonb,
      lifecycle_revision integer,
      disposition varchar
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
      SELECT o.operation_id, o.application_id, o.environment, o.expected_revision, o.phase,
        o.plan_json, o.authorization_json, e.revision, e.disposition
      FROM public.runtime_extension_operations AS o
      JOIN public.runtime_extensions AS e
        ON e.application_id=o.application_id AND e.environment=o.environment
        AND e.delivery_class=o.delivery_class AND e.extension_id=o.extension_id
      WHERE o.operation_id=p_operation_id AND o.application_id=p_application_id
        AND o.environment=p_environment AND o.delivery_class='platform-plugin'
        AND o.extension_id=p_extension_id AND o.phase='planning'
        AND o.expected_revision=e.revision
        AND o.plan_json->>'executionClass'='static-release'
        AND o.plan_json->>'preparation'='impact-only';
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_impact_plan(character varying, character varying, character varying, character varying) FROM PUBLIC;

    CREATE FUNCTION public.k_nex_static_shared_generation_rebind(
      p_application_id varchar,
      p_environment varchar,
      p_previous_generation_id varchar,
      p_receipt jsonb,
      p_exclude_extension_id varchar DEFAULT NULL,
      p_operation_id varchar DEFAULT NULL
    ) RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    DECLARE
      v_extension_ids text[] := ARRAY[]::text[];
      v_generation jsonb;
      v_authorization_revision integer;
      v_lifecycle_revision integer;
      v_next_lifecycle_revision integer;
      v_inventory_revision integer;
      v_revision integer;
      v_updated integer;
      v_event_id varchar;
      v_evidence jsonb;
      v_event jsonb;
      v_invalidation jsonb;
      v_row record;
    BEGIN
      IF pg_catalog.jsonb_typeof(p_receipt) <> 'object'
        OR p_receipt->>'receiptId' IS NULL
        OR p_receipt->>'applicationId' IS DISTINCT FROM p_application_id
        OR p_receipt->>'environment' IS DISTINCT FROM p_environment
        OR p_receipt->>'previousGenerationId' IS DISTINCT FROM p_previous_generation_id
        OR (p_exclude_extension_id IS NULL) <> (p_operation_id IS NULL) THEN
        RAISE EXCEPTION 'Shared static generation rebind input is invalid.' USING ERRCODE = '22023';
      END IF;

      SELECT d.active_generation INTO v_generation
      FROM public.runtime_static_deployments AS d
      JOIN public.runtime_static_deployment_outbox AS x
        ON x.application_id=d.application_id AND x.environment=d.environment
        AND x.revision=(p_receipt->>'revisionAfter')::integer
      WHERE d.application_id=p_application_id AND d.environment=p_environment
        AND d.revision=(p_receipt->>'revisionAfter')::integer
        AND d.active_generation_id=p_receipt->>'activeGenerationId'
        AND d.active_generation->>'generationId'=p_receipt->>'activeGenerationId'
        AND x.event_id=p_receipt->>'receiptId' AND x.event_json=p_receipt
      FOR UPDATE OF d, x;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Shared static generation rebind is not bound to the committed deployment receipt.' USING ERRCODE = '40001';
      END IF;

      IF p_exclude_extension_id IS NOT NULL THEN
        PERFORM 1
        FROM public.runtime_extensions AS e
        JOIN public.runtime_extension_operations AS o ON o.operation_id=e.last_operation_id
        JOIN public.runtime_extension_transition_receipts AS t
          ON t.receipt_id=e.last_receipt_id AND t.operation_id=o.operation_id AND t.revision=e.revision
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.extension_id=p_exclude_extension_id
          AND o.operation_id=p_operation_id AND o.application_id=e.application_id AND o.environment=e.environment
          AND o.delivery_class=e.delivery_class AND o.extension_id=e.extension_id
          AND o.plan_json->>'generationId'=p_receipt->>'activeGenerationId'
          AND o.plan_json->'sourceChange'->>'targetSourceCommit'=p_receipt->>'sourceCommit'
          AND o.plan_json->'sourceChange'->>'planDigest'=p_receipt->>'compositionChangePlanDigest'
          AND t.event_json->>'receiptId'=p_receipt->>'receiptId'
          AND (t.event_json->>'revision')::integer=e.revision
          AND t.event_json->'evidence'->>'generationId'=p_receipt->>'activeGenerationId'
          AND t.event_json->'evidence'->>'sourceCommit'=p_receipt->>'sourceCommit'
          AND t.event_json->'evidence'->>'compositionChangePlanDigest'=p_receipt->>'compositionChangePlanDigest'
          AND t.event_json->'evidence'->>'buildEvidenceDigest'=p_receipt->>'buildEvidenceDigest'
          AND t.event_json->'evidence'->>'applicationDigest'=p_receipt->>'applicationDigest'
          AND t.event_json->'evidence'->>'imageDigest'=p_receipt->>'imageDigest'
          AND (
            (
              o.operation_kind<>'uninstall'
              AND e.disposition='active' AND e.active_generation_id=p_receipt->>'activeGenerationId'
              AND e.active_generation->>'authority'='static-build'
              AND e.active_generation->>'generationId'=p_receipt->>'activeGenerationId'
              AND e.active_generation->>'receiptId'=p_receipt->>'receiptId'
              AND (SELECT pg_catalog.count(*) FROM public.k_nex_extension_authorization_generations AS g
                   WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                     AND g.extension_id=e.extension_id AND g.state='current')=1
              AND EXISTS (
                SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
                WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                  AND g.extension_id=e.extension_id AND g.state='current'
                  AND g.runtime_generation_ids=pg_catalog.jsonb_build_array(p_receipt->>'activeGenerationId')
              )
            ) OR (
              o.operation_kind='uninstall' AND e.disposition='removed' AND e.active_generation_id IS NULL
              AND e.retained_generation->>'generationId'=p_previous_generation_id
              AND NOT EXISTS (
                SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
                WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                  AND g.extension_id=e.extension_id AND g.state='current'
              )
            )
          )
        FOR UPDATE OF e, o, t;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Excluded Platform Plugin is not owned by the admitted lifecycle operation.' USING ERRCODE = '40001';
        END IF;
      END IF;

      FOR v_row IN
        SELECT e.extension_id, e.revision, e.active_generation
        FROM public.runtime_extensions AS e
        JOIN public.runtime_extension_operations AS o ON o.operation_id=e.last_operation_id
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.disposition='active'
          AND (p_exclude_extension_id IS NULL OR e.extension_id<>p_exclude_extension_id)
          AND o.application_id=e.application_id AND o.environment=e.environment
          AND o.delivery_class=e.delivery_class AND o.extension_id=e.extension_id
        ORDER BY e.extension_id
        FOR UPDATE OF e, o
      LOOP
        IF v_row.active_generation->>'authority' IS DISTINCT FROM 'static-build'
          OR v_row.active_generation->>'generationId' IS DISTINCT FROM p_previous_generation_id
          OR v_row.active_generation->>'version' IS NULL THEN
          RAISE EXCEPTION 'Retained Platform Plugin does not bind the prior shared generation.' USING ERRCODE = '40001';
        END IF;
        v_extension_ids := pg_catalog.array_append(v_extension_ids, v_row.extension_id::text);
      END LOOP;

      IF pg_catalog.cardinality(v_extension_ids)=0 THEN
        RETURN 0;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.jsonb_build_array(p_application_id, 'authorization-state')::text, 0));
      SELECT authorization_revision, lifecycle_revision
      INTO STRICT v_authorization_revision, v_lifecycle_revision
      FROM public.k_nex_authorization_state
      WHERE application_id=p_application_id
      FOR UPDATE;
      v_next_lifecycle_revision := v_lifecycle_revision + 1;

      PERFORM 1
      FROM public.k_nex_extension_authorization_generations AS g
      WHERE g.application_id=p_application_id AND g.delivery_class='platform-plugin'
        AND g.extension_id=ANY(v_extension_ids) AND g.state='current'
      ORDER BY g.extension_id, g.authorization_generation
      FOR UPDATE;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.unnest(v_extension_ids) AS retained(extension_id)
        WHERE (SELECT pg_catalog.count(*) FROM public.k_nex_extension_authorization_generations AS g
               WHERE g.application_id=p_application_id AND g.delivery_class='platform-plugin'
                 AND g.extension_id=retained.extension_id AND g.state='current')<>1
          OR NOT EXISTS (
            SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
            WHERE g.application_id=p_application_id AND g.delivery_class='platform-plugin'
              AND g.extension_id=retained.extension_id AND g.state='current'
              AND g.runtime_generation_ids=pg_catalog.jsonb_build_array(p_previous_generation_id)
          )
      ) THEN
        RAISE EXCEPTION 'Retained Platform Plugin authorization generation does not bind the prior shared generation.' USING ERRCODE = '40001';
      END IF;

      FOR v_row IN
        SELECT e.extension_id, e.revision, e.active_generation
        FROM public.runtime_extensions AS e
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.extension_id=ANY(v_extension_ids)
        ORDER BY e.extension_id
      LOOP
        UPDATE public.runtime_extension_inventory_revisions
        SET revision=revision+1
        WHERE application_id=p_application_id AND environment=p_environment
        RETURNING revision INTO STRICT v_inventory_revision;
        v_revision := v_row.revision + 1;
        v_evidence := pg_catalog.jsonb_build_object(
          'authority','static-build', 'generationId',v_generation->>'generationId', 'version',v_row.active_generation->>'version',
          'sourceCommit',p_receipt->>'sourceCommit', 'compositionChangePlanDigest',p_receipt->>'compositionChangePlanDigest',
          'buildEvidenceDigest',p_receipt->>'buildEvidenceDigest', 'applicationDigest',p_receipt->>'applicationDigest',
          'imageDigest',p_receipt->>'imageDigest', 'migrationRevision',(p_receipt->>'migrationRevision')::integer,
          'workerFencingToken',(p_receipt->>'workerFencingToken')::bigint, 'receiptId',p_receipt->>'receiptId'
        );
        v_event_id := 'static-rebind-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to((p_receipt->>'receiptId') || ':' || v_row.extension_id, 'UTF8')
        ), 'hex'), 1, 26);
        v_event := pg_catalog.jsonb_build_object(
          'schemaVersion',1, 'eventId',v_event_id, 'eventType','extension.shared-static-generation-rebind',
          'receiptId',p_receipt->>'receiptId', 'applicationId',p_application_id, 'environment',p_environment,
          'deliveryClass','platform-plugin', 'id',v_row.extension_id, 'expectedRevision',v_row.revision,
          'revision',v_revision, 'inventoryRevision',v_inventory_revision, 'previousGenerationId',p_previous_generation_id,
          'evidence',pg_catalog.jsonb_build_object(
            'sourceCommit',p_receipt->>'sourceCommit', 'compositionChangePlanDigest',p_receipt->>'compositionChangePlanDigest',
            'generationId',v_generation->>'generationId', 'buildEvidenceDigest',p_receipt->>'buildEvidenceDigest',
            'applicationDigest',p_receipt->>'applicationDigest', 'imageDigest',p_receipt->>'imageDigest',
            'workerFencingToken',(p_receipt->>'workerFencingToken')::bigint
          ),
          'occurredAt',p_receipt->>'occurredAt'
        );
        UPDATE public.runtime_extensions
        SET revision=v_revision, active_generation_id=v_generation->>'generationId', active_generation=v_evidence,
          rollback_generation_id=p_previous_generation_id, rollback_generation=v_row.active_generation, retained_generation=NULL,
          last_receipt_id=p_receipt->>'receiptId',
          state_digest='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_event::text, 'UTF8')), 'hex'),
          updated_at=pg_catalog.now()
        WHERE application_id=p_application_id AND environment=p_environment AND delivery_class='platform-plugin'
          AND extension_id=v_row.extension_id AND revision=v_row.revision AND active_generation_id=p_previous_generation_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated<>1 THEN
          RAISE EXCEPTION 'Retained Platform Plugin changed during shared generation rebind.' USING ERRCODE = '40001';
        END IF;
        INSERT INTO public.runtime_extension_outbox
          (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
        VALUES (v_event_id, p_application_id, p_environment, 'platform-plugin', v_row.extension_id, v_revision, v_inventory_revision, v_event);
      END LOOP;

      UPDATE public.k_nex_extension_authorization_generations
      SET runtime_generation_ids=pg_catalog.jsonb_build_array(v_generation->>'generationId'),
        lifecycle_revision=v_next_lifecycle_revision, updated_at=pg_catalog.now()
      WHERE application_id=p_application_id AND delivery_class='platform-plugin'
        AND extension_id=ANY(v_extension_ids) AND state='current'
        AND runtime_generation_ids=pg_catalog.jsonb_build_array(p_previous_generation_id);
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated<>pg_catalog.cardinality(v_extension_ids) THEN
        RAISE EXCEPTION 'Authorization generation changed during shared static generation rebind.' USING ERRCODE = '40001';
      END IF;

      UPDATE public.k_nex_authorization_state
      SET lifecycle_revision=v_next_lifecycle_revision, updated_at=pg_catalog.now()
      WHERE application_id=p_application_id AND authorization_revision=v_authorization_revision AND lifecycle_revision=v_lifecycle_revision;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated<>1 THEN
        RAISE EXCEPTION 'Authorization state changed during shared static generation rebind.' USING ERRCODE = '40001';
      END IF;
      v_invalidation := pg_catalog.jsonb_build_object(
        'applicationId',p_application_id, 'environment',p_environment, 'scope','environment',
        'authorizationRevision',v_authorization_revision, 'lifecycleRevision',v_next_lifecycle_revision
      );
      INSERT INTO public.k_nex_authorization_outbox
        (event_id, application_id, environment, authorization_revision, lifecycle_revision, event_json)
      VALUES (pg_catalog.gen_random_uuid(), p_application_id, p_environment, v_authorization_revision, v_next_lifecycle_revision, v_invalidation)
      ON CONFLICT (application_id, environment, authorization_revision, lifecycle_revision) DO NOTHING;
      RETURN pg_catalog.cardinality(v_extension_ids);
    END;
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_shared_generation_rebind(character varying, character varying, character varying, jsonb, character varying, character varying) FROM PUBLIC;

    CREATE FUNCTION public.k_nex_static_serving_generation(
      p_application_id varchar,
      p_environment varchar
    ) RETURNS varchar
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $$
    DECLARE
      v_revision integer;
      v_active_generation_id varchar;
      v_previous_generation_id varchar;
      v_receipt jsonb;
    BEGIN
      SELECT d.revision, d.active_generation_id, x.event_json->>'previousGenerationId', x.event_json
      INTO v_revision, v_active_generation_id, v_previous_generation_id, v_receipt
      FROM public.runtime_static_deployments AS d
      LEFT JOIN LATERAL (
        SELECT event_json
        FROM public.runtime_static_deployment_outbox
        WHERE application_id=d.application_id AND environment=d.environment
          AND event_json->>'activeGenerationId'=d.active_generation_id
          AND event_json->>'operation' IN ('promote','rollback')
        ORDER BY revision DESC
        LIMIT 1
      ) AS x ON true
      WHERE d.application_id=p_application_id AND d.environment=p_environment;

      IF v_active_generation_id IS NULL THEN
        RETURN NULL;
      END IF;

      IF v_revision=0 THEN
        RETURN v_active_generation_id;
      END IF;

      IF v_receipt IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.runtime_extension_transition_receipts AS t
        JOIN public.runtime_extension_operations AS o ON o.operation_id=t.operation_id
        WHERE t.receipt_id=v_receipt->>'receiptId'
          AND o.application_id=p_application_id AND o.environment=p_environment
          AND o.delivery_class='platform-plugin'
          AND o.phase='completed' AND o.result_json=v_receipt
          AND o.plan_json->>'generationId'=v_active_generation_id
          AND o.plan_json->'sourceChange'->>'targetSourceCommit'=v_receipt->>'sourceCommit'
          AND o.plan_json->'sourceChange'->>'planDigest'=v_receipt->>'compositionChangePlanDigest'
          AND t.event_json->>'receiptId'=v_receipt->>'receiptId'
          AND t.event_json->>'operationId'=o.operation_id
          AND t.event_json->>'operation'=o.operation_kind
          AND t.event_json->>'operationPhase'='completed'
          AND t.event_json->'evidence'->>'generationId'=v_active_generation_id
          AND t.event_json->'evidence'->>'sourceCommit'=v_receipt->>'sourceCommit'
          AND t.event_json->'evidence'->>'compositionChangePlanDigest'=v_receipt->>'compositionChangePlanDigest'
          AND t.event_json->'evidence'->>'buildEvidenceDigest'=v_receipt->>'buildEvidenceDigest'
          AND t.event_json->'evidence'->>'applicationDigest'=v_receipt->>'applicationDigest'
          AND t.event_json->'evidence'->>'imageDigest'=v_receipt->>'imageDigest'
      ) THEN
        RETURN v_previous_generation_id;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.runtime_extensions AS e
        WHERE e.application_id=p_application_id AND e.environment=p_environment
          AND e.delivery_class='platform-plugin' AND e.disposition='active'
          AND (
            e.active_generation_id IS DISTINCT FROM v_active_generation_id
            OR e.active_generation->>'generationId' IS DISTINCT FROM v_active_generation_id
            OR (SELECT pg_catalog.count(*) FROM public.k_nex_extension_authorization_generations AS g
                WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                  AND g.extension_id=e.extension_id AND g.state='current')<>1
            OR NOT EXISTS (
              SELECT 1 FROM public.k_nex_extension_authorization_generations AS g
              WHERE g.application_id=e.application_id AND g.delivery_class=e.delivery_class
                AND g.extension_id=e.extension_id AND g.state='current'
                AND g.runtime_generation_ids=pg_catalog.jsonb_build_array(v_active_generation_id)
            )
          )
      ) THEN
        RETURN v_previous_generation_id;
      END IF;
      RETURN v_active_generation_id;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.k_nex_static_serving_generation(character varying, character varying) FROM PUBLIC;
  `);
},

async down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP FUNCTION public.k_nex_static_serving_generation(character varying, character varying);
    DROP FUNCTION public.k_nex_static_shared_generation_rebind(character varying, character varying, character varying, jsonb, character varying, character varying);
    DROP FUNCTION public.k_nex_static_impact_plan(character varying, character varying, character varying, character varying);
    DROP FUNCTION public.k_nex_static_lifecycle_admission(character varying, character varying, character varying, character varying);
  `);
}
});

/**
 * Production runtime-extension and static-lifecycle schema migrations.
 *
 * Ordered exactly as their predecessor fixture migrations. Payload tracks applied
 * migrations; the fixture-only k_nex_migration_revision bookkeeping is omitted.
 */
export const kNexRuntimeExtensionSchemaMigrations = Object.freeze([
  migration20260829_000007_runtime_extensions,
  migration20260829_000008_app_storage,
  migration20260829_000009_extension_activation,
  migration20260829_000010_theme_skin_profiles,
  migration20260829_000011_static_deployment,
  migration20260829_000012_verified_artifacts,
  migration20260829_000013_catalog_checkpoints,
  migration20260829_000014_theme_skin_verified_artifacts,
  migration20260829_000015_extension_capability_authority,
  migration20260829_000016_extension_security_quarantine,
  migration20260829_000017_static_release_authority,
  migration20260829_000018_runner_quarantine
]);
