import { identityPatterns } from "./identity.js";
import { outputContracts } from "./output-contracts.js";
import { registrationPhases, registrationRules } from "./registration-phases.js";

export const architectureRegistry = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  schemaVersion: 1,
  identity: {
    pluginIdPattern: identityPatterns.plugin,
    capabilityIdPattern: identityPatterns.capability,
    resourceIdPattern: identityPatterns.resource,
    outputContractIdPattern: identityPatterns.outputContract,
    rules: [
      "Dots express namespace hierarchy.",
      "A hyphen is allowed only inside one semantic segment.",
      "Package names are deployment locations and are not persisted identities.",
      "A persisted ID rename requires an explicit data/document migration; runtime aliases are not a permanent compatibility mechanism."
    ],
    canonicalExamples: {
      plugins: [
        "module.sales",
        "module.logistics.core",
        "module.logistics.driver",
        "module.logistics.live-tracking",
        "provider.realtime.socketio",
        "builder.puck",
        "theme.neobrutalism"
      ],
      capabilities: ["realtime.gateway", "storage.objects", "builder.engine"],
      resources: ["sales.tasks", "sales.total-potential-revenue", "logistics.shipment.assign", "page.filters.date-range"]
    }
  },
  registration: {
    phases: registrationPhases,
    rules: registrationRules
  },
  outputContracts,
  lifecycle: {
    schemaOwningPluginV1: {
      reversibleOperations: ["disable", "re-enable"],
      destructiveOperations: ["purge"],
      uninstallWithRetainedSchema: "unsupported-until-executable-proof",
      archiveOrExport: "explicit-project-operation"
    },
    schemaLessPluginV1: {
      uninstall: "allowed-after-dependency-and-reference-checks"
    }
  },
  determinism: {
    committedArtifacts: [
      ".k-nex/generated/k-nex.resolved.json",
      ".k-nex/generated/plugin-registry.ts",
      ".k-nex/generated/provider-registry.ts",
      ".k-nex/generated/payload-contributions.ts",
      ".k-nex/generated/ui-registry.ts",
      ".k-nex/generated/data-source-registry.ts",
      ".k-nex/generated/theme-registry.ts"
    ],
    forbiddenInCommittedGeneratedArtifacts: [
      "wall-clock timestamps",
      "absolute filesystem paths",
      "hostnames",
      "random identifiers",
      "secret values"
    ],
    buildAndDeploymentMetadata: "Produced separately as signed CI provenance and deployment receipts."
  },
  forbiddenLegacySymbols: [
    "module.logistics-core",
    "module.logistics-dispatch",
    "module.logistics-driver",
    "module.logistics-live-tracking",
    "provider.realtime-websocket-local",
    "provider.realtime-websocket-redis",
    "provider.database-postgres",
    "provider.database-target-neon",
    "@k-nex/database-postgres",
    "database.primary",
    "metric.money@1"
  ]
} as const;

export type ArchitectureRegistry = typeof architectureRegistry;
