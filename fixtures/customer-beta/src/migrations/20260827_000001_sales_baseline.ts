import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

const source = (path: string) => readFileSync(fileURLToPath(import.meta.resolve(path)), "utf8");

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(source("@k-nex/module-sales/payload-baseline-up.sql")));
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(source("@k-nex/module-sales/payload-baseline-down.sql")));
}
