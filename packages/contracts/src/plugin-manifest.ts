import * as z from "zod";

import { CapabilityIdSchema, ExactSemverSchema, PluginIdSchema, ResourceIdSchema, pluginKinds } from "./identity.js";
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

const lifecycleOperations = z.enum(["supported", "unsupported"]);
const lifecycleShape = {
  ownsPersistentData: z.boolean(),
  disable: lifecycleOperations,
  purge: lifecycleOperations
} as const;

export const PluginLifecycleSchema = z.discriminatedUnion("ownsPayloadSchema", [
  z.strictObject({
    ownsPayloadSchema: z.literal(true),
    ...lifecycleShape,
    uninstall: z.literal("unsupported")
  }),
  z.strictObject({
    ownsPayloadSchema: z.literal(false),
    ...lifecycleShape,
    uninstall: lifecycleOperations
  })
]);

const contributionArraySchema = uniqueArray(ResourceIdSchema);

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
  contributions: z.strictObject({
    contracts: contributionArraySchema.optional(),
    schema: contributionArraySchema.optional(),
    behavior: contributionArraySchema.optional(),
    jobs: contributionArraySchema.optional(),
    dataSources: contributionArraySchema.optional(),
    actions: contributionArraySchema.optional(),
    blocks: contributionArraySchema.optional(),
    navigation: contributionArraySchema.optional(),
    admin: contributionArraySchema.optional()
  }).optional()
}).meta({
  $id: "https://schemas.k-nex.dev/plugin/v1.json",
  title: "K-Nex Plugin Manifest v1"
});

export type CapabilityProvision = z.infer<typeof CapabilityProvisionSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type PluginLifecycle = z.infer<typeof PluginLifecycleSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
