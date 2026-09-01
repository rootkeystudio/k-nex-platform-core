import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=12, "revision"=13 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_catalog_checkpoints";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=11, "revision"=12 WHERE "id"=1;
  `);
}
