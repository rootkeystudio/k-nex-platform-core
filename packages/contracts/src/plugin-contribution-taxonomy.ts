import * as z from "zod";

import { type PluginId, ResourceIdSchema } from "./identity.js";
import { type RegistrationPhase } from "./registration-phases.js";

export const pluginContributionCategoryKeys = [
  "schema",
  "migrations",
  "services",
  "permissions",
  "settings",
  "sources",
  "actions",
  "tools",
  "events",
  "jobs",
  "realtimeTopics",
  "components",
  "blocks",
  "routes",
  "navigation",
  "pageTemplates",
  "localization",
  "healthAudit",
  "lifecycle",
  "testingMetadata"
] as const;

export type PluginContributionCategory = (typeof pluginContributionCategoryKeys)[number];

export const pluginContributionAuthorities = ["server", "browser", "testing"] as const;
export type PluginContributionAuthority = (typeof pluginContributionAuthorities)[number];

export type PluginContributionCategoryMetadata = {
  readonly registrationPhase: RegistrationPhase;
  readonly authority: PluginContributionAuthority;
};

/**
 * Canonical static contribution surfaces. Detailed descriptors belong to their
 * respective contracts as each surface is implemented.
 */
export const pluginContributionRegistry = {
  schema: { registrationPhase: "schema", authority: "server" },
  migrations: { registrationPhase: "schema", authority: "server" },
  services: { registrationPhase: "behavior", authority: "server" },
  permissions: { registrationPhase: "contracts", authority: "server" },
  settings: { registrationPhase: "contracts", authority: "server" },
  sources: { registrationPhase: "contracts", authority: "server" },
  actions: { registrationPhase: "contracts", authority: "server" },
  tools: { registrationPhase: "contracts", authority: "server" },
  events: { registrationPhase: "contracts", authority: "server" },
  jobs: { registrationPhase: "jobs", authority: "server" },
  realtimeTopics: { registrationPhase: "contracts", authority: "server" },
  components: { registrationPhase: "ui", authority: "browser" },
  blocks: { registrationPhase: "ui", authority: "browser" },
  routes: { registrationPhase: "ui", authority: "browser" },
  navigation: { registrationPhase: "ui", authority: "browser" },
  pageTemplates: { registrationPhase: "ui", authority: "browser" },
  localization: { registrationPhase: "ui", authority: "browser" },
  healthAudit: { registrationPhase: "validate", authority: "server" },
  lifecycle: { registrationPhase: "behavior", authority: "server" },
  testingMetadata: { registrationPhase: "validate", authority: "testing" }
} as const satisfies Record<PluginContributionCategory, PluginContributionCategoryMetadata>;

export const PluginContributionRequirementSchema = z.enum(["required", "optional"]);
export type PluginContributionRequirement = z.infer<typeof PluginContributionRequirementSchema>;

export const PluginContributionDeclarationSchema = z.record(ResourceIdSchema, PluginContributionRequirementSchema)
  .superRefine((declarations, context) => {
    if (Object.keys(declarations).length === 0) {
      context.addIssue({ code: "custom", message: "Contribution declarations cannot be empty." });
    }
  })
  // Zod's record schema has no native non-empty operation. Preserve the rule
  // for generated JSON Schema while runtime validation remains above.
  .meta({ minProperties: 1 });

export type PluginContributionDeclaration = z.infer<typeof PluginContributionDeclarationSchema>;

/** Returns the first semantic namespace after the plugin kind. */
export function pluginContributionNamespace(pluginId: PluginId): string {
  return pluginId.split(".")[1]!;
}
