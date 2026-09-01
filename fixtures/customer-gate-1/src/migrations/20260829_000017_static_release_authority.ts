import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=16, "revision"=17 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_static_release_requests";
    DROP TABLE "runtime_static_composition_checkpoints";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=15, "revision"=16 WHERE "id"=1;
  `);
}
