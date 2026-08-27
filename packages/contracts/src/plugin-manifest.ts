import * as z from "zod";

import { CapabilityIdSchema, ExactSemverSchema, PluginIdSchema, pluginKinds } from "./identity.js";
import { lifecycleOperationSupport, lifecyclePolicy } from "./lifecycle.js";
import {
  PluginContributionDeclarationSchema,
  pluginContributionCategoryKeys,
  pluginContributionNamespace,
  type PluginContributionCategory
} from "./plugin-contribution-taxonomy.js";
import { uniqueArray } from "./schema-helpers.js";

const packageNamePattern = "^@?[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)?$";

export const CapabilityProvisionSchema = z.strictObject({
  capability: CapabilityIdSchema,
  version: ExactSemverSchema
});

const dependencyVersionSchema = z.string().min(1);

export const DependencySchema = z.union([
  z.strictObject({
    plugin: PluginIdSchema,
    version: dependencyVersionSchema,
    reason: z.string().optional()
  }),
  z.strictObject({
    capability: CapabilityIdSchema,
    version: dependencyVersionSchema,
    reason: z.string().optional()
  })
]);

const lifecycleOperations = z.enum(lifecycleOperationSupport);
const lifecycleShape = {
  ownsPersistentData: z.boolean(),
  disable: lifecycleOperations,
  purge: lifecycleOperations
} as const;

export const PluginLifecycleSchema = z.discriminatedUnion("ownsPayloadSchema", [
  z.strictObject({
    ownsPayloadSchema: z.literal(lifecyclePolicy.schemaOwningPluginV1.ownsPayloadSchema),
    ...lifecycleShape,
    uninstall: z.literal(lifecyclePolicy.schemaOwningPluginV1.manifestUninstall)
  }),
  z.strictObject({
    ownsPayloadSchema: z.literal(lifecyclePolicy.schemaLessPluginV1.ownsPayloadSchema),
    ...lifecycleShape,
    uninstall: lifecycleOperations
  })
]);

const contributionDeclarationShape = Object.fromEntries(
  pluginContributionCategoryKeys.map((category) => [category, PluginContributionDeclarationSchema.optional()])
) as { [Category in PluginContributionCategory]: z.ZodOptional<typeof PluginContributionDeclarationSchema> };

export const PluginContributionsSchema = z.strictObject(contributionDeclarationShape);

export const PluginManifestSchema = z.strictObject({
  "$schema": z.string().optional(),
  apiVersion: z.literal(1),
  id: PluginIdSchema,
  kind: z.enum(pluginKinds),
  displayName: z.string().min(1).max(120),
  version: ExactSemverSchema,
  package: z.string().regex(new RegExp(packageNamePattern)),
  compatibility: z.strictObject({
    core: z.string().min(1),
    payload: z.string().min(1),
    node: z.string().min(1),
    payloadDatabaseAdapters: uniqueArray(z.literal("postgres")).min(1)
  }),
  provides: z.array(CapabilityProvisionSchema).default([]),
  requires: z.array(DependencySchema).default([]),
  optional: z.array(DependencySchema).default([]),
  conflicts: z.array(DependencySchema).default([]),
  surfaces: uniqueArray(z.enum(["workspace", "cms", "public", "driver", "mobile", "system"])).optional(),
  environment: z.array(z.strictObject({
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    secret: z.boolean(),
    requiredWhen: z.enum(["installed", "enabled", "configured-feature"]),
    description: z.string().optional()
  })).optional(),
  lifecycle: PluginLifecycleSchema,
  contributions: PluginContributionsSchema.optional()
}).superRefine((manifest, context) => {
  const namespace = pluginContributionNamespace(manifest.id);
  for (const category of pluginContributionCategoryKeys) {
    const declarations = manifest.contributions?.[category];
    if (declarations === undefined) continue;
    for (const id of Object.keys(declarations)) {
      if (id.startsWith(`${namespace}.`)) continue;
      context.addIssue({
        code: "custom",
        path: ["contributions", category, id],
        message: `Contribution ID must use the ${namespace}. namespace owned by ${manifest.id}.`
      });
    }
  }
}).meta({
  $id: "https://schemas.k-nex.dev/plugin/v1.json",
  title: "K-Nex Plugin Manifest v1"
});

export type CapabilityProvision = z.infer<typeof CapabilityProvisionSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type PluginLifecycle = z.infer<typeof PluginLifecycleSchema>;
export type PluginContributions = z.infer<typeof PluginContributionsSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
