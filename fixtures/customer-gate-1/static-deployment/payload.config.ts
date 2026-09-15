import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";

import { kNexSalesRegistry } from "@k-nex-registry";
import { withTrustedSalesTaskCreateIdAdmission } from "@k-nex/payload-adapter";

function requiredEnvironment(name: "DATABASE_URL" | "PAYLOAD_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

export default buildConfig({
  db: postgresAdapter({ allowIDOnCreate: true, pool: { connectionString: requiredEnvironment("DATABASE_URL") }, push: false }),
  collections: kNexSalesRegistry.collections.map(withTrustedSalesTaskCreateIdAdmission),
  custom: { kNexApplicationId: "customer-alpha" },
  secret: requiredEnvironment("PAYLOAD_SECRET")
});
