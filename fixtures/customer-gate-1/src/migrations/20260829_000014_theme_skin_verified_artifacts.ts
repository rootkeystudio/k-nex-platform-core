import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "runtime_extension_artifacts"
      DROP CONSTRAINT "runtime_extension_artifacts_class_check",
      ADD CONSTRAINT "runtime_extension_artifacts_class_check" CHECK ("delivery_class" IN ('hot-application', 'theme-skin'));

    ALTER TABLE "runtime_extension_artifact_bindings"
      DROP CONSTRAINT "runtime_extension_artifact_bindings_owner_check",
      ADD CONSTRAINT "runtime_extension_artifact_bindings_owner_check" CHECK ("delivery_class" IN ('hot-application', 'theme-skin'));

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=13, "revision"=14 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "runtime_extension_artifact_bindings"
      DROP CONSTRAINT "runtime_extension_artifact_bindings_owner_check",
      ADD CONSTRAINT "runtime_extension_artifact_bindings_owner_check" CHECK ("delivery_class" = 'hot-application');

    ALTER TABLE "runtime_extension_artifacts"
      DROP CONSTRAINT "runtime_extension_artifacts_class_check",
      ADD CONSTRAINT "runtime_extension_artifacts_class_check" CHECK ("delivery_class" = 'hot-application');

    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=12, "revision"=13 WHERE "id"=1;
  `);
}
