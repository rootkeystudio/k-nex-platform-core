import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "k_nex_roles" (
      "application_id" varchar(128) NOT NULL,
      "role_id" varchar(160) NOT NULL,
      "label" varchar(120) NOT NULL,
      "description" varchar(240),
      "protected_role_id" varchar(32),
      "revision" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "role_id"),
      CONSTRAINT "k_nex_roles_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "k_nex_roles_protected_marker_check" CHECK (
        ("role_id" = 'system.role.owner' AND "protected_role_id" IS NOT DISTINCT FROM 'system.role.owner')
        OR ("role_id" = 'system.role.security-admin' AND "protected_role_id" IS NOT DISTINCT FROM 'system.role.security-admin')
        OR ("role_id" = 'system.role.extension-admin' AND "protected_role_id" IS NOT DISTINCT FROM 'system.role.extension-admin')
        OR ("role_id" = 'system.role.user-admin' AND "protected_role_id" IS NOT DISTINCT FROM 'system.role.user-admin')
        OR ("role_id" = 'system.role.auditor' AND "protected_role_id" IS NOT DISTINCT FROM 'system.role.auditor')
        OR ("role_id" NOT IN ('system.role.owner', 'system.role.security-admin', 'system.role.extension-admin', 'system.role.user-admin', 'system.role.auditor') AND "protected_role_id" IS NULL)
      )
    );

    CREATE TABLE "k_nex_extension_authorization_generations" (
      "application_id" varchar(128) NOT NULL,
      "delivery_class" varchar(32) NOT NULL,
      "extension_id" varchar(128) NOT NULL,
      "authorization_generation" bigint NOT NULL,
      "runtime_generation_ids" jsonb NOT NULL,
      "state" varchar(16) NOT NULL,
      "authorization_revision" integer DEFAULT 0 NOT NULL,
      "lifecycle_revision" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "delivery_class", "extension_id", "authorization_generation"),
      CONSTRAINT "k_nex_extension_authorization_generations_owner_check" CHECK (
        ("delivery_class" = 'platform-plugin' AND "extension_id" ~ '^(module|provider|builder|theme|integration|preset)(\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$')
        OR ("delivery_class" = 'hot-application' AND "extension_id" ~ '^app(\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$')
      ),
      CONSTRAINT "k_nex_extension_authorization_generations_reserved_namespace_check" CHECK (substring("extension_id" FROM position('.' IN "extension_id") + 1) <> 'system' AND substring("extension_id" FROM position('.' IN "extension_id") + 1) NOT LIKE 'system.%'),
      CONSTRAINT "k_nex_extension_authorization_generations_generation_check" CHECK ("authorization_generation" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "k_nex_extension_authorization_generations_state_check" CHECK ("state" IN ('current', 'retired')),
      CONSTRAINT "k_nex_extension_authorization_generations_revision_check" CHECK ("authorization_revision" BETWEEN 0 AND 1000000000 AND "lifecycle_revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "k_nex_extension_authorization_generations_runtime_ids_check" CHECK (jsonb_typeof("runtime_generation_ids") = 'array')
    );
    CREATE UNIQUE INDEX "k_nex_extension_authorization_generations_current_key" ON "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id") WHERE "state"='current';

    CREATE TABLE "k_nex_role_permission_grants" (
      "application_id" varchar(128) NOT NULL,
      "grant_id" varchar(160) NOT NULL,
      "role_id" varchar(160) NOT NULL,
      "permission_id" varchar(160) NOT NULL,
      "owner_kind" varchar(16) NOT NULL,
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "revision" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "grant_id"),
      CONSTRAINT "k_nex_role_permission_grants_role_fk" FOREIGN KEY ("application_id", "role_id") REFERENCES "k_nex_roles" ("application_id", "role_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_role_permission_grants_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_role_permission_grants_identity_key" UNIQUE ("application_id", "role_id", "permission_id"),
      CONSTRAINT "k_nex_role_permission_grants_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "k_nex_role_permission_grants_owner_check" CHECK (
        ("owner_kind" = 'platform' AND "owner_namespace" IS NOT DISTINCT FROM 'system' AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL AND "permission_id" LIKE 'system.%')
        OR (
          "owner_kind" = 'extension'
          AND "owner_namespace" IS NULL
          AND "owner_delivery_class" IS NOT NULL
          AND "owner_delivery_class" IN ('platform-plugin', 'hot-application')
          AND "owner_extension_id" IS NOT NULL
          AND "owner_generation" IS NOT NULL
          AND "owner_generation" BETWEEN 1 AND 9007199254740991
          AND "permission_id" LIKE substring("owner_extension_id" FROM position('.' IN "owner_extension_id") + 1) || '.%'
        )
      )
    );

    CREATE TABLE "k_nex_role_assignments" (
      "application_id" varchar(128) NOT NULL,
      "assignment_id" varchar(160) NOT NULL,
      "role_id" varchar(160) NOT NULL,
      "subject_kind" varchar(16) NOT NULL,
      "subject_id" varchar(160) NOT NULL,
      "state" varchar(16) NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "assignment_id"),
      CONSTRAINT "k_nex_role_assignments_role_fk" FOREIGN KEY ("application_id", "role_id") REFERENCES "k_nex_roles" ("application_id", "role_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_role_assignments_identity_key" UNIQUE ("application_id", "role_id", "subject_kind", "subject_id"),
      CONSTRAINT "k_nex_role_assignments_owner_receipt_key" UNIQUE ("application_id", "assignment_id", "role_id", "subject_kind", "subject_id"),
      CONSTRAINT "k_nex_role_assignments_subject_check" CHECK ("subject_kind" IN ('user', 'service')),
      CONSTRAINT "k_nex_role_assignments_state_check" CHECK ("state" IN ('active', 'revoked')),
      CONSTRAINT "k_nex_role_assignments_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000)
    );
    CREATE INDEX "k_nex_role_assignments_subject_idx" ON "k_nex_role_assignments" ("application_id", "subject_kind", "subject_id", "state");

    CREATE TABLE "k_nex_role_template_adoptions" (
      "application_id" varchar(128) NOT NULL,
      "adoption_id" varchar(160) NOT NULL,
      "role_id" varchar(160) NOT NULL,
      "template_id" varchar(160) NOT NULL,
      "publisher_delivery_class" varchar(32) NOT NULL,
      "publisher_extension_id" varchar(128) NOT NULL,
      "owner_delivery_class" varchar(32) NOT NULL,
      "owner_extension_id" varchar(128) NOT NULL,
      "owner_generation" bigint NOT NULL,
      "template_version" bigint NOT NULL,
      "old_baseline_permission_ids" jsonb NOT NULL,
      "digest_algorithm" varchar(32) NOT NULL,
      "old_baseline_digest" varchar(71) NOT NULL,
      "kind" varchar(32) NOT NULL,
      "state" varchar(16) NOT NULL,
      "revision" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "adoption_id"),
      CONSTRAINT "k_nex_role_template_adoptions_role_fk" FOREIGN KEY ("application_id", "role_id") REFERENCES "k_nex_roles" ("application_id", "role_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_role_template_adoptions_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_role_template_adoptions_identity_key" UNIQUE ("application_id", "role_id", "template_id", "kind"),
      CONSTRAINT "k_nex_role_template_adoptions_owner_check" CHECK (
        "publisher_delivery_class" IN ('platform-plugin', 'hot-application')
        AND "owner_delivery_class" = "publisher_delivery_class"
        AND "owner_extension_id" = "publisher_extension_id"
        AND "owner_generation" BETWEEN 1 AND 9007199254740991
        AND "template_version" BETWEEN 1 AND 9007199254740991
        AND "template_id" LIKE substring("publisher_extension_id" FROM position('.' IN "publisher_extension_id") + 1) || '.%'
      ),
      CONSTRAINT "k_nex_role_template_adoptions_baseline_check" CHECK (jsonb_typeof("old_baseline_permission_ids") = 'array'),
      CONSTRAINT "k_nex_role_template_adoptions_digest_check" CHECK ("digest_algorithm" = 'sha256-canonical-json-v1' AND "old_baseline_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "k_nex_role_template_adoptions_kind_check" CHECK ("kind" IN ('instantiated-role', 'copied-permissions')),
      CONSTRAINT "k_nex_role_template_adoptions_state_check" CHECK ("state" IN ('adopted', 'tombstoned')),
      CONSTRAINT "k_nex_role_template_adoptions_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "k_nex_permission_catalog_snapshots" (
      "application_id" varchar(128) NOT NULL,
      "snapshot_id" varchar(160) NOT NULL,
      "source" varchar(40) NOT NULL,
      "permission_json" jsonb NOT NULL,
      "state" varchar(40) NOT NULL,
      "owner_kind" varchar(16),
      "owner_namespace" varchar(32),
      "owner_delivery_class" varchar(32),
      "owner_extension_id" varchar(128),
      "owner_generation" bigint,
      "revision" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "snapshot_id"),
      CONSTRAINT "k_nex_permission_catalog_snapshots_extension_owner_fk" FOREIGN KEY ("application_id", "owner_delivery_class", "owner_extension_id", "owner_generation") REFERENCES "k_nex_extension_authorization_generations" ("application_id", "delivery_class", "extension_id", "authorization_generation") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_permission_catalog_snapshots_source_check" CHECK ("source" = 'administrative-non-authoritative'),
      CONSTRAINT "k_nex_permission_catalog_snapshots_permission_check" CHECK (jsonb_typeof("permission_json") = 'object'),
      CONSTRAINT "k_nex_permission_catalog_snapshots_state_check" CHECK ("state" IN ('inactive-extension-disabled', 'inactive-extension-not-ready', 'inactive-generation-retired', 'deprecated', 'orphaned-after-removal')),
      CONSTRAINT "k_nex_permission_catalog_snapshots_owner_check" CHECK (
        ("owner_kind" IS NULL AND "owner_namespace" IS NULL AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL)
        OR ("owner_kind" IS NOT DISTINCT FROM 'platform' AND "owner_namespace" IS NOT DISTINCT FROM 'system' AND "owner_delivery_class" IS NULL AND "owner_extension_id" IS NULL AND "owner_generation" IS NULL)
        OR ("owner_kind" IS NOT DISTINCT FROM 'extension' AND "owner_namespace" IS NULL AND "owner_delivery_class" IS NOT NULL AND "owner_delivery_class" IN ('platform-plugin', 'hot-application') AND "owner_extension_id" IS NOT NULL AND "owner_generation" IS NOT NULL AND "owner_generation" BETWEEN 1 AND 9007199254740991)
      ),
      CONSTRAINT "k_nex_permission_catalog_snapshots_revision_check" CHECK ("revision" BETWEEN 0 AND 1000000000)
    );
    CREATE INDEX "k_nex_permission_catalog_snapshots_state_idx" ON "k_nex_permission_catalog_snapshots" ("application_id", "state", "snapshot_id");

    CREATE TABLE "k_nex_authorization_state" (
      "application_id" varchar(128) NOT NULL,
      "authorization_revision" integer DEFAULT 0 NOT NULL,
      "lifecycle_revision" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id"),
      CONSTRAINT "k_nex_authorization_state_revision_check" CHECK ("authorization_revision" BETWEEN 0 AND 1000000000 AND "lifecycle_revision" BETWEEN 0 AND 1000000000)
    );

    CREATE TABLE "k_nex_authorization_bootstrap_receipts" (
      "application_id" varchar(128) NOT NULL,
      "receipt_id" varchar(160) NOT NULL,
      "owner_role_id" varchar(32) NOT NULL,
      "owner_assignment_id" varchar(160) NOT NULL,
      "owner_principal_kind" varchar(16) NOT NULL,
      "owner_principal_id" varchar(160) NOT NULL,
      "protected_baseline_version" integer NOT NULL,
      "protected_baseline_digest" varchar(71) NOT NULL,
      "authorization_revision" integer NOT NULL,
      "state" varchar(16) NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "receipt_id"),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_owner_role_fk" FOREIGN KEY ("application_id", "owner_role_id") REFERENCES "k_nex_roles" ("application_id", "role_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_owner_assignment_fk" FOREIGN KEY ("application_id", "owner_assignment_id", "owner_role_id", "owner_principal_kind", "owner_principal_id") REFERENCES "k_nex_role_assignments" ("application_id", "assignment_id", "role_id", "subject_kind", "subject_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_application_key" UNIQUE ("application_id"),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_assignment_key" UNIQUE ("application_id", "owner_assignment_id"),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_owner_check" CHECK ("owner_role_id" = 'system.role.owner' AND "owner_principal_kind" = 'user'),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_protected_baseline_version_check" CHECK ("protected_baseline_version" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_protected_baseline_digest_check" CHECK ("protected_baseline_digest" ~ '^sha256:[0-9a-f]{64}$'),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_revision_check" CHECK ("authorization_revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "k_nex_authorization_bootstrap_receipts_state_check" CHECK ("state" = 'committed')
    );

    CREATE TABLE "k_nex_authorization_audit" (
      "audit_id" varchar(160) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "permission_id" varchar(160) NOT NULL,
      "outcome" varchar(16) NOT NULL,
      "reason" varchar(32) NOT NULL,
      "authorization_revision" integer NOT NULL,
      "lifecycle_revision" integer NOT NULL,
      "audit_json" jsonb NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "k_nex_authorization_audit_state_fk" FOREIGN KEY ("application_id") REFERENCES "k_nex_authorization_state" ("application_id") ON DELETE RESTRICT,
      CONSTRAINT "k_nex_authorization_audit_outcome_check" CHECK ("outcome" IN ('allow', 'deny')),
      CONSTRAINT "k_nex_authorization_audit_reason_check" CHECK ("reason" IN ('granted', 'permission-not-granted', 'owner-not-effective', 'assignment-revoked', 'delegation-reduced', 'approval-required', 'reauthentication-required', 'policy-denied')),
      CONSTRAINT "k_nex_authorization_audit_revision_check" CHECK ("authorization_revision" BETWEEN 0 AND 1000000000 AND "lifecycle_revision" BETWEEN 0 AND 1000000000),
      CONSTRAINT "k_nex_authorization_audit_json_check" CHECK (jsonb_typeof("audit_json") = 'object')
    );
    CREATE INDEX "k_nex_authorization_audit_application_revision_idx" ON "k_nex_authorization_audit" ("application_id", "environment", "authorization_revision", "audit_id");
    CREATE INDEX "k_nex_authorization_audit_permission_idx" ON "k_nex_authorization_audit" ("application_id", "environment", "permission_id", "created_at");

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=18, "revision"=19 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "k_nex_authorization_audit";
    DROP TABLE "k_nex_authorization_bootstrap_receipts";
    DROP TABLE "k_nex_authorization_state";
    DROP TABLE "k_nex_permission_catalog_snapshots";
    DROP TABLE "k_nex_role_template_adoptions";
    DROP TABLE "k_nex_role_assignments";
    DROP TABLE "k_nex_role_permission_grants";
    DROP TABLE "k_nex_extension_authorization_generations";
    DROP TABLE "k_nex_roles";
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=17, "revision"=18 WHERE "id"=1;
  `);
}
