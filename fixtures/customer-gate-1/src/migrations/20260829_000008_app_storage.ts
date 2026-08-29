import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=7, "revision"=8 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_storage_records";
    DROP TABLE "runtime_extension_storage_namespaces";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=6, "revision"=7 WHERE "id"=1;
  `);
}
