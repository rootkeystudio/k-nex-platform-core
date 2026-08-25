import { executeRegistration, type ResolvedPluginGraph } from "@k-nex/composition";
import { PluginManifestSchema } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import { composePayloadApplication } from "@k-nex/payload-adapter";
import { buildConfig } from "payload";

import resolvedJson from "../.k-nex/generated/k-nex.resolved.json" with { type: "json" };
import { runtimeRegistration } from "../.k-nex/generated/runtime-registration.js";

function requiredEnvironment(name: "DATABASE_URL" | "PAYLOAD_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

if (resolvedJson.resolverVersion !== "1.0.0") throw new Error("Unsupported resolved graph version.");
const manifest = PluginManifestSchema.parse(manifestJson);
const plugin = resolvedJson.plugins.find(({ id }) => id === manifest.id);
if (!plugin) throw new Error("The Sales plugin is missing from the resolved graph.");

const graph: ResolvedPluginGraph = {
  resolverVersion: resolvedJson.resolverVersion,
  plugins: resolvedJson.plugins.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    package: entry.package,
    version: entry.version,
    integrity: entry.integrity,
    required: entry.required,
    optional: entry.optional
  })),
  capabilityProviders: resolvedJson.capabilityProviders,
  registrationOrder: resolvedJson.registrationOrder
};
const registration = executeRegistration({
  graph,
  installed: [{
    package: { name: plugin.package, version: plugin.version, integrity: plugin.integrity },
    manifest
  }],
  registrations: [runtimeRegistration["module.sales"].salesRegistration]
});
export const composedApplication = composePayloadApplication({
  baseConfig: { secret: requiredEnvironment("PAYLOAD_SECRET") },
  databaseUrl: requiredEnvironment("DATABASE_URL"),
  registration
});

export default buildConfig(composedApplication.config);
