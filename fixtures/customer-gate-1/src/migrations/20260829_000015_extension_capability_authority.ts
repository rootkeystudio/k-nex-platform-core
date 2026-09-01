import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=14, "revision"=15 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_extension_capability_sequences";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=13, "revision"=14 WHERE "id"=1;
  `);
}
