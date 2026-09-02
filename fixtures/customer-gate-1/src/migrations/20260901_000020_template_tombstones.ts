import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "k_nex_role_template_adoptions"
      ALTER COLUMN "role_id" DROP NOT NULL,
      ADD CONSTRAINT "k_nex_role_template_adoptions_tombstone_role_check" CHECK (
        ("role_id" IS NULL AND "kind" = 'instantiated-role' AND "state" = 'tombstoned')
        OR ("role_id" IS NOT NULL AND NOT ("kind" = 'instantiated-role' AND "state" = 'tombstoned'))
      );
    CREATE UNIQUE INDEX "k_nex_role_template_adoptions_tombstone_identity_key"
      ON "k_nex_role_template_adoptions" ("application_id", "publisher_delivery_class", "publisher_extension_id", "template_id", "kind")
      WHERE "kind" = 'instantiated-role' AND "state" = 'tombstoned';
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=19, "revision"=20 WHERE "id"=1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DELETE FROM "k_nex_role_template_adoptions"
      WHERE "role_id" IS NULL
        AND "kind" = 'instantiated-role'
        AND "state" = 'tombstoned';
    DROP INDEX "k_nex_role_template_adoptions_tombstone_identity_key";
    ALTER TABLE "k_nex_role_template_adoptions"
      DROP CONSTRAINT "k_nex_role_template_adoptions_tombstone_role_check",
      ALTER COLUMN "role_id" SET NOT NULL;
    UPDATE "k_nex_migration_revision" SET "predecessor_revision"=18, "revision"=19 WHERE "id"=1;
  `);
}
