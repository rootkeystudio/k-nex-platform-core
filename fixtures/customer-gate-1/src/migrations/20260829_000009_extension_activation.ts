import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=8, "revision"=9 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
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
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=7, "revision"=8 WHERE "id"=1;
  `);
}
