import type { ResolvedPluginGraph } from "@k-nex/composition";
import { executeRegistration, ToolCatalog } from "@k-nex/runtime";
import { PluginManifestSchema, type AgentToolDescriptor } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import type { CollectionConfig } from "payload";
import {
  composePayloadApplication,
  createPayloadMcpPlugin,
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

const usersCollection: CollectionConfig = {
  slug: "users",
  auth: true,
  fields: []
};

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
  const tools = registration.contributions.tools.map(({ value }) => value as AgentToolDescriptor);
  const catalog = new ToolCatalog(registration, { isVisible: () => true });
  const mcp = createPayloadMcpPlugin({
    tools,
    catalog,
    gateway: { execute: async () => { throw new Error("The fixture MCP lifecycle proof does not invoke tools."); } },
    context: {
      resolve: (_request, user) => {
        if (typeof user !== "object" || user === null || !("id" in user) ||
          (typeof user.id !== "string" && typeof user.id !== "number")) {
          throw new TypeError("MCP actor is invalid.");
        }
        const id = String(user.id);
        return {
          actor: {
            principal: { kind: "user", id },
            effectiveActor: { kind: "user", id }
          },
          delegation: { kind: "fixture-mcp-lifecycle" },
          authorizationContext: { kind: "fixture-mcp-lifecycle" },
          surface: "workspace",
          features: []
        };
      }
    },
    surface: "workspace"
  });
  return composePayloadApplication({
    baseConfig: {
      secret: options.payloadSecret,
      plugins: [mcp],
      endpoints: [createRuntimeInventoryEndpoint(inventory), createDataSourceQueryEndpoint(registration)]
    },
    baseCollections: [usersCollection],
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    registration
  });
}
