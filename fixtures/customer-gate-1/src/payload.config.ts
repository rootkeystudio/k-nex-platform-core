import { buildConfig } from "payload";

import { createGate1Application } from "./create-application.js";
import { migrations } from "./migrations/index.js";

function requiredEnvironment(name: "DATABASE_URL" | "PAYLOAD_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

export const composedApplication = createGate1Application({
  databaseUrl: requiredEnvironment("DATABASE_URL"),
  migrations,
  payloadSecret: requiredEnvironment("PAYLOAD_SECRET")
});

export default buildConfig(composedApplication.config);
