import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=9, "revision"=10 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_theme_profile_outbox";
    DROP TABLE "runtime_theme_profile_publications";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=8, "revision"=9 WHERE "id"=1;
  `);
}
