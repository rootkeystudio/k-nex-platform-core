import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

/** Clean-database v1 storage for customer-owned workspace pages. */
export const kNexWorkspacePageSchemaMigration = Object.freeze({
  name: "20260903_000004_knex_workspace_pages",
  async up({ db }: MigrateUpArgs): Promise<void> {
    await db.execute(sql`
      CREATE TABLE "k_nex_workspace_pages" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "document_id" varchar(160) NOT NULL,
        "state" varchar(16) NOT NULL,
        "page_revision" integer NOT NULL,
        "working_copy_revision" integer NOT NULL,
        "access_revision" integer NOT NULL,
        "published_revision_id" varchar(160),
        "dependency_digest" varchar(71),
        "page_json" jsonb NOT NULL,
        "created_at" timestamp(3) with time zone NOT NULL,
        "updated_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id"),
        CONSTRAINT "k_nex_workspace_pages_document_key" UNIQUE ("application_id", "environment", "document_id"),
        CONSTRAINT "k_nex_workspace_pages_state_check" CHECK ("state" IN ('draft','published','archived')),
        CONSTRAINT "k_nex_workspace_pages_revision_check" CHECK ("page_revision" BETWEEN 1 AND 1000000000 AND "working_copy_revision" BETWEEN 1 AND 1000000000 AND "access_revision" BETWEEN 0 AND 1000000000),
        CONSTRAINT "k_nex_workspace_pages_publication_check" CHECK (("state" <> 'published') OR ("published_revision_id" IS NOT NULL AND "dependency_digest" ~ '^sha256:[0-9a-f]{64}$')),
        CONSTRAINT "k_nex_workspace_pages_json_check" CHECK (jsonb_typeof("page_json")='object')
      );
      CREATE INDEX "k_nex_workspace_pages_list_idx" ON "k_nex_workspace_pages" ("application_id", "environment", "state", "page_id");

      CREATE TABLE "k_nex_workspace_navigation_folders" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "folder_id" varchar(160) NOT NULL,
        "revision" integer NOT NULL,
        "node_json" jsonb NOT NULL,
        "updated_by_json" jsonb NOT NULL,
        "updated_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "folder_id"),
        CONSTRAINT "k_nex_workspace_navigation_folders_revision_check" CHECK ("revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_navigation_folders_node_json_check" CHECK (jsonb_typeof("node_json")='object'),
        CONSTRAINT "k_nex_workspace_navigation_folders_actor_json_check" CHECK (jsonb_typeof("updated_by_json")='object')
      );

      CREATE TABLE "k_nex_workspace_navigation_outbox" (
        "event_id" uuid PRIMARY KEY NOT NULL,
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "folder_id" varchar(160) NOT NULL,
        "operation_kind" varchar(16) NOT NULL,
        "folder_revision" integer NOT NULL,
        "authorization_revision" integer NOT NULL,
        "lifecycle_revision" integer NOT NULL,
        "event_json" jsonb NOT NULL,
        "status" varchar(16) DEFAULT 'pending' NOT NULL,
        "attempt_count" integer DEFAULT 0 NOT NULL,
        "claimed_at" timestamp(3) with time zone,
        "lease_expires_at" timestamp(3) with time zone,
        "claim_token" uuid,
        "last_error_code" varchar(64),
        "dead_lettered_at" timestamp(3) with time zone,
        "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "k_nex_workspace_navigation_outbox_operation_check" CHECK ("operation_kind" IN ('create','update')),
        CONSTRAINT "k_nex_workspace_navigation_outbox_revision_check" CHECK ("folder_revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_navigation_outbox_authority_revision_check" CHECK ("authorization_revision" BETWEEN 0 AND 1000000000 AND "lifecycle_revision" BETWEEN 0 AND 1000000000),
        CONSTRAINT "k_nex_workspace_navigation_outbox_status_check" CHECK ("status" IN ('pending','processing','delivered','dead-letter')),
        CONSTRAINT "k_nex_workspace_navigation_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
        CONSTRAINT "k_nex_workspace_navigation_outbox_json_check" CHECK (jsonb_typeof("event_json")='object'),
        CONSTRAINT "k_nex_workspace_navigation_outbox_revision_key" UNIQUE ("application_id", "environment", "folder_id", "folder_revision")
      );
      CREATE INDEX "k_nex_workspace_navigation_outbox_pending_idx" ON "k_nex_workspace_navigation_outbox" ("application_id", "environment", "attempt_count", "folder_revision", "event_id") WHERE "status"='pending';
      CREATE INDEX "k_nex_workspace_navigation_outbox_expired_lease_idx" ON "k_nex_workspace_navigation_outbox" ("lease_expires_at", "event_id") WHERE "status"='processing';

      CREATE TABLE "k_nex_workspace_page_access" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "access_revision" integer NOT NULL,
        "subject_kind" varchar(16) NOT NULL,
        "subject_id" varchar(160) NOT NULL,
        "capability" varchar(8) NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id", "subject_kind", "subject_id"),
        CONSTRAINT "k_nex_workspace_page_access_page_fk" FOREIGN KEY ("application_id", "environment", "page_id") REFERENCES "k_nex_workspace_pages" ("application_id", "environment", "page_id") ON DELETE RESTRICT,
        CONSTRAINT "k_nex_workspace_page_access_subject_check" CHECK ("subject_kind" IN ('role','user')),
        CONSTRAINT "k_nex_workspace_page_access_capability_check" CHECK ("capability" IN ('view','edit')),
        CONSTRAINT "k_nex_workspace_page_access_revision_check" CHECK ("access_revision" BETWEEN 0 AND 1000000000)
      );
      CREATE INDEX "k_nex_workspace_page_access_subject_idx" ON "k_nex_workspace_page_access" ("application_id", "environment", "subject_kind", "subject_id", "page_id");

      CREATE TABLE "k_nex_workspace_working_copies" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "document_id" varchar(160) NOT NULL,
        "working_copy_revision" integer NOT NULL,
        "working_copy_json" jsonb NOT NULL,
        "updated_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id"),
        CONSTRAINT "k_nex_workspace_working_copies_page_fk" FOREIGN KEY ("application_id", "environment", "page_id") REFERENCES "k_nex_workspace_pages" ("application_id", "environment", "page_id") ON DELETE RESTRICT,
        CONSTRAINT "k_nex_workspace_working_copies_revision_check" CHECK ("working_copy_revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_working_copies_json_check" CHECK (jsonb_typeof("working_copy_json")='object')
      );

      CREATE TABLE "k_nex_workspace_published_revisions" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "revision_id" varchar(160) NOT NULL,
        "document_id" varchar(160) NOT NULL,
        "document_revision" integer NOT NULL,
        "dependency_digest" varchar(71) NOT NULL,
        "revision_json" jsonb NOT NULL,
        "published_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id", "revision_id"),
        CONSTRAINT "k_nex_workspace_published_revisions_page_fk" FOREIGN KEY ("application_id", "environment", "page_id") REFERENCES "k_nex_workspace_pages" ("application_id", "environment", "page_id") ON DELETE RESTRICT,
        CONSTRAINT "k_nex_workspace_published_revisions_document_key" UNIQUE ("application_id", "environment", "page_id", "document_revision"),
        CONSTRAINT "k_nex_workspace_published_revisions_revision_check" CHECK ("document_revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_published_revisions_digest_check" CHECK ("dependency_digest" ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT "k_nex_workspace_published_revisions_json_check" CHECK (jsonb_typeof("revision_json")='object')
      );

      CREATE TABLE "k_nex_workspace_publication_pointers" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "pointer_revision" integer NOT NULL,
        "published_revision_id" varchar(160) NOT NULL,
        "pointer_json" jsonb NOT NULL,
        "updated_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id"),
        CONSTRAINT "k_nex_workspace_publication_pointers_page_fk" FOREIGN KEY ("application_id", "environment", "page_id") REFERENCES "k_nex_workspace_pages" ("application_id", "environment", "page_id") ON DELETE RESTRICT,
        CONSTRAINT "k_nex_workspace_publication_pointers_revision_fk" FOREIGN KEY ("application_id", "environment", "page_id", "published_revision_id") REFERENCES "k_nex_workspace_published_revisions" ("application_id", "environment", "page_id", "revision_id") ON DELETE RESTRICT,
        CONSTRAINT "k_nex_workspace_publication_pointers_revision_check" CHECK ("pointer_revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_publication_pointers_json_check" CHECK (jsonb_typeof("pointer_json")='object')
      );

      CREATE TABLE "k_nex_workspace_publication_receipts" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "receipt_id" varchar(160) NOT NULL,
        "idempotency_key" varchar(160) NOT NULL,
        "pointer_revision" integer NOT NULL,
        "receipt_json" jsonb NOT NULL,
        "occurred_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id", "receipt_id"),
        CONSTRAINT "k_nex_workspace_publication_receipts_page_fk" FOREIGN KEY ("application_id", "environment", "page_id") REFERENCES "k_nex_workspace_pages" ("application_id", "environment", "page_id") ON DELETE RESTRICT,
        CONSTRAINT "k_nex_workspace_publication_receipts_idempotency_key" UNIQUE ("application_id", "environment", "page_id", "idempotency_key"),
        CONSTRAINT "k_nex_workspace_publication_receipts_revision_check" CHECK ("pointer_revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_publication_receipts_json_check" CHECK (jsonb_typeof("receipt_json")='object')
      );

      CREATE TABLE "k_nex_workspace_page_operations" (
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "idempotency_key" varchar(160) NOT NULL,
        "operation_kind" varchar(32) NOT NULL,
        "request_digest" varchar(71) NOT NULL,
        "result_json" jsonb NOT NULL,
        "created_at" timestamp(3) with time zone NOT NULL,
        PRIMARY KEY ("application_id", "environment", "page_id", "idempotency_key"),
        CONSTRAINT "k_nex_workspace_page_operations_digest_check" CHECK ("request_digest" ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT "k_nex_workspace_page_operations_json_check" CHECK (jsonb_typeof("result_json")='object')
      );

      CREATE TABLE "k_nex_workspace_page_audit" (
        "audit_id" uuid PRIMARY KEY NOT NULL,
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "operation_kind" varchar(32) NOT NULL,
        "event_json" jsonb NOT NULL,
        "created_at" timestamp(3) with time zone NOT NULL,
        CONSTRAINT "k_nex_workspace_page_audit_json_check" CHECK (jsonb_typeof("event_json")='object')
      );
      CREATE INDEX "k_nex_workspace_page_audit_page_idx" ON "k_nex_workspace_page_audit" ("application_id", "environment", "page_id", "created_at", "audit_id");

      CREATE TABLE "k_nex_workspace_page_outbox" (
        "event_id" uuid PRIMARY KEY NOT NULL,
        "application_id" varchar(128) NOT NULL,
        "environment" varchar(64) NOT NULL,
        "page_id" varchar(160) NOT NULL,
        "operation_kind" varchar(32) NOT NULL,
        "page_revision" integer NOT NULL,
        "event_json" jsonb NOT NULL,
        "status" varchar(16) DEFAULT 'pending' NOT NULL,
        "attempt_count" integer DEFAULT 0 NOT NULL,
        "claimed_at" timestamp(3) with time zone,
        "lease_expires_at" timestamp(3) with time zone,
        "claim_token" uuid,
        "last_error_code" varchar(64),
        "dead_lettered_at" timestamp(3) with time zone,
        "created_at" timestamp(3) with time zone NOT NULL,
        CONSTRAINT "k_nex_workspace_page_outbox_status_check" CHECK ("status" IN ('pending','processing','delivered','dead-letter')),
        CONSTRAINT "k_nex_workspace_page_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
        CONSTRAINT "k_nex_workspace_page_outbox_revision_check" CHECK ("page_revision" BETWEEN 1 AND 1000000000),
        CONSTRAINT "k_nex_workspace_page_outbox_json_check" CHECK (jsonb_typeof("event_json")='object')
      );
      CREATE INDEX "k_nex_workspace_page_outbox_pending_idx" ON "k_nex_workspace_page_outbox" ("application_id", "attempt_count", "page_revision", "event_id") WHERE "status"='pending';
      CREATE INDEX "k_nex_workspace_page_outbox_expired_lease_idx" ON "k_nex_workspace_page_outbox" ("lease_expires_at", "event_id") WHERE "status"='processing';

      CREATE FUNCTION "k_nex_workspace_reject_immutable_mutation"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'workspace immutable history cannot be changed';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "k_nex_workspace_published_revisions_immutable" BEFORE UPDATE OR DELETE ON "k_nex_workspace_published_revisions" FOR EACH ROW EXECUTE FUNCTION "k_nex_workspace_reject_immutable_mutation"();
      CREATE TRIGGER "k_nex_workspace_publication_receipts_immutable" BEFORE UPDATE OR DELETE ON "k_nex_workspace_publication_receipts" FOR EACH ROW EXECUTE FUNCTION "k_nex_workspace_reject_immutable_mutation"();
      CREATE TRIGGER "k_nex_workspace_page_audit_immutable" BEFORE UPDATE OR DELETE ON "k_nex_workspace_page_audit" FOR EACH ROW EXECUTE FUNCTION "k_nex_workspace_reject_immutable_mutation"();
    `);
  },
  async down({ db }: MigrateDownArgs): Promise<void> {
    await db.execute(sql`
      DROP TRIGGER "k_nex_workspace_page_audit_immutable" ON "k_nex_workspace_page_audit";
      DROP TRIGGER "k_nex_workspace_publication_receipts_immutable" ON "k_nex_workspace_publication_receipts";
      DROP TRIGGER "k_nex_workspace_published_revisions_immutable" ON "k_nex_workspace_published_revisions";
      DROP FUNCTION "k_nex_workspace_reject_immutable_mutation";
      DROP TABLE "k_nex_workspace_page_outbox";
      DROP TABLE "k_nex_workspace_page_audit";
      DROP TABLE "k_nex_workspace_page_operations";
      DROP TABLE "k_nex_workspace_publication_receipts";
      DROP TABLE "k_nex_workspace_publication_pointers";
      DROP TABLE "k_nex_workspace_published_revisions";
      DROP TABLE "k_nex_workspace_working_copies";
      DROP TABLE "k_nex_workspace_page_access";
      DROP TABLE "k_nex_workspace_navigation_outbox";
      DROP TABLE "k_nex_workspace_navigation_folders";
      DROP TABLE "k_nex_workspace_pages";
    `);
  }
});
