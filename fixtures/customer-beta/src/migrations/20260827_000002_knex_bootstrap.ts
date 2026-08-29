import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(`CREATE TABLE "k_nex_release_revision" (
    "application_id" varchar PRIMARY KEY NOT NULL, "predecessor_revision" integer NOT NULL,
    "revision" integer NOT NULL, "release_revision" varchar NOT NULL
  ); INSERT INTO "k_nex_release_revision" VALUES ('customer-beta', 0, 1, 'platform-0.2.0-bootstrap');`));
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw('DROP TABLE "k_nex_release_revision" CASCADE;'));
}
