import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=11, "revision"=12 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_artifact_bindings";
    DROP TABLE "runtime_extension_artifact_acceptances";
    DROP TABLE "runtime_extension_artifacts";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=10, "revision"=11 WHERE "id"=1;
  `);
}
