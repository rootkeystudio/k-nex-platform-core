import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "sales_tasks" ADD COLUMN "potential_revenue" varchar;
    ALTER TABLE "sales_tasks" ADD COLUMN "private_note" varchar;
    UPDATE "k_nex_migration_revision"
      SET "predecessor_revision" = 1, "revision" = 2
      WHERE "id" = 1;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "sales_tasks" DROP COLUMN "private_note";
    ALTER TABLE "sales_tasks" DROP COLUMN "potential_revenue";
    UPDATE "k_nex_migration_revision"
      SET "predecessor_revision" = 0, "revision" = 1
      WHERE "id" = 1;
  `);
}
