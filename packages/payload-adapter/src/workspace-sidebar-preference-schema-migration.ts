import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

/** Customer-owned storage for one authenticated user's desktop sidebar presentation. */
export const kNexWorkspaceSidebarPreferenceSchemaMigration = Object.freeze({
  name: "20260904_000007_knex_workspace_sidebar_preferences",
  async up({ db }: MigrateUpArgs): Promise<void> {
    await db.execute(sql`
      CREATE TABLE "k_nex_workspace_sidebar_preferences" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "user_id" varchar(160) NOT NULL,
        "sidebar" varchar(16) NOT NULL,
        "updated_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "user_id"),
        CONSTRAINT "k_nex_workspace_sidebar_preferences_application_check" CHECK ("application_id" ~ '^[a-z][a-z0-9-]{2,127}$'),
        CONSTRAINT "k_nex_workspace_sidebar_preferences_environment_check" CHECK ("environment" ~ '^[a-z][a-z0-9-]{1,63}$'),
        CONSTRAINT "k_nex_workspace_sidebar_preferences_user_check" CHECK (char_length("user_id") BETWEEN 1 AND 160 AND "user_id" !~ '[[:cntrl:]]'),
        CONSTRAINT "k_nex_workspace_sidebar_preferences_sidebar_check" CHECK ("sidebar" IN ('expanded','collapsed'))
      );
    `);
  },
  async down({ db }: MigrateDownArgs): Promise<void> {
    await db.execute(sql`DROP TABLE "k_nex_workspace_sidebar_preferences";`);
  }
});
