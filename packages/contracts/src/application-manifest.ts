import * as z from "zod";

import { CapabilityIdSchema, ExactSemverSchema, PluginIdSchema } from "./identity.js";
import { OpenObjectSchema, uniqueArray } from "./schema-helpers.js";

export const PluginRequestSchema = z.strictObject({
  id: PluginIdSchema,
  package: z.string(),
  version: ExactSemverSchema,
  enabled: z.boolean(),
  options: OpenObjectSchema.optional()
});

export const ProviderRequestSchema = z.strictObject({
  plugin: PluginIdSchema,
  package: z.string(),
  version: ExactSemverSchema,
  options: OpenObjectSchema.optional()
});

export const ApplicationManifestSchema = z.strictObject({
  "$schema": z.string().optional(),
  schemaVersion: z.literal(1),
  application: z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(160),
    type: z.enum(["customer-platform", "website-only", "backend-only"]),
    defaultLocale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).optional(),
    locales: uniqueArray(z.string()).optional()
  }),
  runtime: z.strictObject({
    node: z.string().regex(/^24\.[0-9]+\.[0-9]+$/),
    packageManager: z.literal("pnpm"),
    packageManagerVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    deploymentMode: z.enum(["container", "platform-native"])
  }),
  framework: z.strictObject({
    payload: z.strictObject({
      database: z.strictObject({
        adapter: z.literal("postgres"),
        package: z.literal("@payloadcms/db-postgres"),
        connectionEnvironmentVariable: z.literal("DATABASE_URL")
      })
    })
  }),
  plugins: z.array(PluginRequestSchema),
  providers: z.record(CapabilityIdSchema, ProviderRequestSchema),
  builder: z.strictObject({
    plugin: z.literal("builder.puck"),
    package: z.string(),
    version: ExactSemverSchema,
    profiles: OpenObjectSchema
  }),
  themes: OpenObjectSchema,
  development: z.looseObject({
    database: z.union([
      z.strictObject({
        mode: z.literal("docker-postgres"),
        serviceName: z.string().regex(/^[a-z][a-z0-9-]*$/)
      }),
      z.strictObject({ mode: z.literal("external") })
    ])
  }),
  build: z.strictObject({
    dockerfile: z.boolean(),
    commitGeneratedRegistries: z.literal(true),
    validateGeneratedFilesInCI: z.literal(true)
  }),
  environment: z.strictObject({
    required: uniqueArray(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
  })
}).meta({
  $id: "https://schemas.k-nex.dev/application/v1.json",
  title: "K-Nex Application Manifest v1"
});

export type PluginRequest = z.infer<typeof PluginRequestSchema>;
export type ProviderRequest = z.infer<typeof ProviderRequestSchema>;
export type ApplicationManifest = z.infer<typeof ApplicationManifestSchema>;
