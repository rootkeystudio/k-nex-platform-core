import { buildConfig } from "payload";
import { sql } from "@payloadcms/db-postgres";

import { bootGate1Application } from "../dist/src/boot.js";
import { createGate1Application } from "../dist/src/create-application.js";

const failingMigration = {
  name: "20260826_000001_failed",
  async up({ db }) {
    await db.execute(sql`CREATE TABLE "failed_migration_marker" ("id" integer PRIMARY KEY);`);
    throw new Error("Intentional Gate 1 migration failure.");
  },
  async down() {}
};

const application = createGate1Application({
  databaseUrl: process.env.DATABASE_URL,
  migrations: [failingMigration],
  payloadSecret: process.env.PAYLOAD_SECRET
});

await bootGate1Application({
  config: buildConfig(application.config),
  key: "gate1-failed-migration"
});

console.log("READY");
