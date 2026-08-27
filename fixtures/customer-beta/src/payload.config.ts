import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";

import { kNexSalesRegistry } from "./k-nex-registry.js";
import { migrations } from "./migrations/index.js";

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.PAYLOAD_SECRET;
if (!databaseUrl || !secret) throw new Error("DATABASE_URL and PAYLOAD_SECRET are required.");

export default buildConfig({
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, prodMigrations: migrations, push: false }),
  collections: [...kNexSalesRegistry.collections],
  custom: { kNexApplicationId: "customer-beta" },
  secret
});
