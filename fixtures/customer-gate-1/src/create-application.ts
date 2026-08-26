import type { ResolvedPluginGraph } from "@k-nex/composition";
import { executeRegistration } from "@k-nex/runtime";
import { PluginManifestSchema } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import {
  composePayloadApplication,
  type ComposedPayloadApplication,
  type CustomerPayloadMigration
} from "@k-nex/payload-adapter";

import resolvedJson from "../.k-nex/generated/k-nex.resolved.json" with { type: "json" };
import { runtimeRegistration } from "../.k-nex/generated/runtime-registration.js";
import { createDataSourceQueryEndpoint } from "./data-source-endpoint.js";
import { createGate1RuntimeInventory, createRuntimeInventoryEndpoint } from "./runtime-inventory.js";

export interface CreateGate1ApplicationOptions {
  readonly databaseUrl: string;
  readonly migrations: readonly CustomerPayloadMigration[];
  readonly payloadSecret: string;
}

export function createGate1Application(options: CreateGate1ApplicationOptions): ComposedPayloadApplication {
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
  const inventory = createGate1RuntimeInventory(registration);
  return composePayloadApplication({
    baseConfig: {
      secret: options.payloadSecret,
      endpoints: [createRuntimeInventoryEndpoint(inventory), createDataSourceQueryEndpoint(registration)]
    },
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    registration
  });
}
