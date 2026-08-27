import type { ResolvedPluginGraph } from "@k-nex/composition";
import {
  createPluginLifecycleState,
  executeRegistration,
  reconcilePluginAvailability,
  scopePluginRegistration,
  ToolCatalog,
  type PluginAvailability,
  type PluginLifecycleState
} from "@k-nex/runtime";
import { PluginManifestSchema, type AgentToolDescriptor } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import providerManifestJson from "@k-nex/provider-realtime-socketio/manifest" with { type: "json" };
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
import { applicationMigrationRevision } from "./migration-revision.js";
import { createGate1RuntimeInventory, createRuntimeInventoryEndpoint } from "./runtime-inventory.js";

export interface CreateGate1ApplicationOptions {
  readonly databaseUrl: string;
  readonly migrations: readonly CustomerPayloadMigration[];
  readonly payloadSecret: string;
  readonly salesEnabled?: boolean;
}

export interface Gate1Application extends ComposedPayloadApplication {
  readonly salesAvailability: PluginAvailability;
  readonly salesLifecycle: PluginLifecycleState;
}

const usersCollection: CollectionConfig = {
  slug: "users",
  auth: true,
  fields: []
};

export function createGate1Application(options: CreateGate1ApplicationOptions): Gate1Application {
  if (resolvedJson.resolverVersion !== "1.0.0") throw new Error("Unsupported resolved graph version.");
  const manifest = PluginManifestSchema.parse(manifestJson);
  const providerManifest = PluginManifestSchema.parse(providerManifestJson);
  const plugin = resolvedJson.plugins.find(({ id }) => id === manifest.id);
  const providerPlugin = resolvedJson.plugins.find(({ id }) => id === providerManifest.id);
  if (!plugin || !providerPlugin) throw new Error("The Sales module or selected realtime provider is missing from the resolved graph.");

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
    installed: [
      { package: { name: plugin.package, version: plugin.version, integrity: plugin.integrity }, manifest },
      { package: { name: providerPlugin.package, version: providerPlugin.version, integrity: providerPlugin.integrity }, manifest: providerManifest }
    ],
    registrations: [
      runtimeRegistration["module.sales"].salesRegistration,
      runtimeRegistration["provider.realtime.socketio"].socketIoRealtimeProviderRegistration
    ]
  });
  const salesEnabled = options.salesEnabled ?? true;
  const salesLifecycle = createPluginLifecycleState({
    pluginId: manifest.id,
    catalogStatus: "supported",
    package: { status: "installed", name: plugin.package, version: plugin.version, integrity: plugin.integrity },
    enabled: salesEnabled,
    configuration: { revision: 1, ready: true },
    migration: { current: applicationMigrationRevision.current, required: applicationMigrationRevision.current, ready: true },
    dataState: salesEnabled ? "active" : "retained",
    releaseStatus: "supported"
  });
  const salesAvailability = reconcilePluginAvailability(registration, salesLifecycle);
  const scopedRegistration = scopePluginRegistration(registration, [salesAvailability]);
  const inventory = createGate1RuntimeInventory(scopedRegistration);
  const tools = scopedRegistration.contributions.tools
    .map(({ value }) => value as AgentToolDescriptor);
  const catalog = new ToolCatalog(scopedRegistration, { isVisible: () => true });
  const mcp = tools.length === 0 ? undefined : createPayloadMcpPlugin({
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
  const application = composePayloadApplication({
    baseConfig: {
      secret: options.payloadSecret,
      custom: { kNexApplicationId: "customer-gate-1" },
      plugins: mcp === undefined ? [] : [mcp],
      endpoints: [createRuntimeInventoryEndpoint(inventory), createDataSourceQueryEndpoint(scopedRegistration)]
    },
    baseCollections: [usersCollection],
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    pluginAvailability: [salesAvailability],
    registration: scopedRegistration
  });
  return Object.freeze({ ...application, salesAvailability, salesLifecycle });
}
