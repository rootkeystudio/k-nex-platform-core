import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
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
      "state_digest" varchar(71) NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment"),
      CONSTRAINT "runtime_static_deployments_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "runtime_static_deployments_generation_json_check" CHECK (
        jsonb_typeof("active_generation")='object' AND ("rollback_generation" IS NULL OR jsonb_typeof("rollback_generation")='object')
      ),
      CONSTRAINT "runtime_static_deployments_rollback_pair_check" CHECK (("rollback_generation_id" IS NULL)=("rollback_generation" IS NULL)),
      CONSTRAINT "runtime_static_deployments_rollback_window_check" CHECK (jsonb_typeof("rollback_window")='object'),
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

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=10, "revision"=11 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "runtime_static_deployment_outbox";
    DROP TABLE "runtime_worker_effects";
    DROP TABLE "runtime_worker_generation_fences";
    DROP TABLE "runtime_static_deployments";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=9, "revision"=10 WHERE "id"=1;
  `);
}
