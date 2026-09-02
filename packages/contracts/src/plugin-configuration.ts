import * as z from "zod";

import { PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

const settingKeyPattern = /^[a-z][A-Za-z0-9]*$/;
const routeParameterNamePattern = /^[A-Za-z][A-Za-z0-9]*$/;
const secretLikeSettingKeyPattern = /(password|secret|token|credential|privateKey|apiKey)$/i;
const reservedSettingTerms = [
  "action", "block", "component", "contribution", "entrypoint", "import", "job",
  "migration", "plugin", "provider", "route", "schema", "source", "tool", "topology"
] as const;

export const SecretReferenceSchema = z.strictObject({
  kind: z.literal("secret-reference"),
  provider: z.literal("environment"),
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/)
});

export const PluginSettingValueSchema = z.union([
  z.string().max(4_096),
  z.number().finite(),
  z.boolean(),
  z.null(),
  uniqueArray(z.string().min(1).max(256)).max(128),
  SecretReferenceSchema
]);

const settingFieldBase = {
  required: z.boolean(),
  description: z.string().min(1).max(240).optional()
} as const;

export const PluginSettingFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...settingFieldBase,
    type: z.literal("string"),
    default: z.string().max(4_096).optional(),
    allowed: uniqueArray(z.string().min(1).max(256)).max(128).optional()
  }),
  z.strictObject({
    ...settingFieldBase,
    type: z.literal("integer"),
    default: z.number().int().safe().optional(),
    minimum: z.number().int().safe().optional(),
    maximum: z.number().int().safe().optional()
  }),
  z.strictObject({
    ...settingFieldBase,
    type: z.literal("boolean"),
    default: z.boolean().optional()
  }),
  z.strictObject({
    ...settingFieldBase,
    type: z.literal("string-list"),
    default: uniqueArray(z.string().min(1).max(256)).max(128).optional()
  }),
  z.strictObject({
    ...settingFieldBase,
    type: z.literal("secret-reference")
  })
]);

const settingFieldsSchema = z.record(z.string().regex(settingKeyPattern), PluginSettingFieldSchema)
  .check((context) => {
    if (Object.keys(context.value).length === 0) context.issues.push({ code: "custom", input: context.value, message: "Settings fields cannot be empty." });
  })
  .meta({ minProperties: 1 });

const surfaceSchema = z.enum(["workspace", "cms", "public", "driver", "mobile", "system"]);
const audienceSchema = z.enum(["public", "authenticated", "system"]);

function ownedByPlugin(pluginId: string, resourceId: string): boolean {
  return resourceId.startsWith(`${pluginId.split(".")[1]}.`);
}

export const PluginSettingsDescriptorSchema = z.strictObject({
  id: ResourceIdSchema,
  ownerPluginId: PluginIdSchema,
  schemaVersion: z.number().int().positive(),
  fields: settingFieldsSchema,
  surface: surfaceSchema,
  audience: audienceSchema,
  readPermission: ResourceIdSchema,
  changePermission: ResourceIdSchema,
  featureRevision: z.number().int().nonnegative(),
  publicationRevision: z.number().int().nonnegative()
}).check((context) => {
  const descriptor = context.value;
  if (!ownedByPlugin(descriptor.ownerPluginId, descriptor.id)) {
    context.issues.push({ code: "custom", input: descriptor.id, path: ["id"], message: "Settings ID must use the owner plugin namespace." });
  }
  for (const [key, field] of Object.entries(descriptor.fields)) {
    const normalizedKey = key.toLowerCase();
    if (reservedSettingTerms.some((term) => normalizedKey.includes(term))) {
      context.issues.push({ code: "custom", input: key, path: ["fields", key], message: "Settings cannot control executable contributions or application topology." });
    }
    if (secretLikeSettingKeyPattern.test(key) && field.type !== "secret-reference") {
      context.issues.push({ code: "custom", input: key, path: ["fields", key], message: "Secret-like settings must use secret references." });
    }
    if (field.type === "integer") {
      if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
        context.issues.push({ code: "custom", input: field, path: ["fields", key], message: "Integer setting bounds are invalid." });
      }
      if (field.default !== undefined && (field.minimum !== undefined && field.default < field.minimum || field.maximum !== undefined && field.default > field.maximum)) {
        context.issues.push({ code: "custom", input: field.default, path: ["fields", key, "default"], message: "Integer setting default is outside its bounds." });
      }
    }
    if (field.type === "string" && field.default !== undefined && field.allowed !== undefined && !field.allowed.includes(field.default)) {
      context.issues.push({ code: "custom", input: field.default, path: ["fields", key, "default"], message: "String setting default is not allowed." });
    }
  }
});

export const PluginSettingsDocumentSchema = z.strictObject({
  settingsId: ResourceIdSchema,
  schemaVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  values: z.record(z.string().regex(settingKeyPattern), PluginSettingValueSchema)
});

export const RouteParameterDescriptorSchema = z.strictObject({
  type: z.enum(["string", "integer", "boolean"])
});

export const PluginRouteDescriptorSchema = z.strictObject({
  id: ResourceIdSchema,
  ownerPluginId: PluginIdSchema,
  path: z.string().min(1).max(240).regex(/^\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9]*)(?:\/(?:[A-Za-z0-9_-]+|:[A-Za-z][A-Za-z0-9]*))*$/),
  parameters: z.record(z.string().regex(routeParameterNamePattern), RouteParameterDescriptorSchema),
  surface: surfaceSchema,
  audience: audienceSchema,
  permission: ResourceIdSchema,
  viewId: ResourceIdSchema
}).check((context) => {
  const descriptor = context.value;
  if (!ownedByPlugin(descriptor.ownerPluginId, descriptor.id) || !ownedByPlugin(descriptor.ownerPluginId, descriptor.viewId)) {
    context.issues.push({ code: "custom", input: descriptor.id, path: ["id"], message: "Route and view IDs must use the owner plugin namespace." });
  }
  const placeholders = descriptor.path.split("/").filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1));
  if (new Set(placeholders).size !== placeholders.length || placeholders.sort().join("\u0000") !== Object.keys(descriptor.parameters).sort().join("\u0000")) {
    context.issues.push({ code: "custom", input: descriptor.path, path: ["parameters"], message: "Route parameters must exactly match unique path placeholders." });
  }
});

export const PluginRouteParameterValueSchema = z.union([z.string().min(1).max(256), z.number().int().safe(), z.boolean()]);
export const PluginRouteReferenceSchema = z.strictObject({
  routeId: ResourceIdSchema,
  params: z.record(z.string().regex(routeParameterNamePattern), PluginRouteParameterValueSchema)
});

export const PluginNavigationDescriptorSchema = z.strictObject({
  id: ResourceIdSchema,
  ownerPluginId: PluginIdSchema,
  labelMessageId: ResourceIdSchema,
  route: PluginRouteReferenceSchema,
  permission: ResourceIdSchema,
  parentId: ResourceIdSchema.optional(),
  order: z.number().int().safe()
}).check((context) => {
  const descriptor = context.value;
  if (!ownedByPlugin(descriptor.ownerPluginId, descriptor.id) || !ownedByPlugin(descriptor.ownerPluginId, descriptor.labelMessageId)) {
    context.issues.push({ code: "custom", input: descriptor.id, path: ["id"], message: "Navigation and label IDs must use the owner plugin namespace." });
  }
});

export type SecretReference = z.infer<typeof SecretReferenceSchema>;
export type PluginSettingValue = z.infer<typeof PluginSettingValueSchema>;
export type PluginSettingField = z.infer<typeof PluginSettingFieldSchema>;
export type PluginSettingsDescriptor = z.infer<typeof PluginSettingsDescriptorSchema>;
export type PluginSettingsDocument = z.infer<typeof PluginSettingsDocumentSchema>;
export type RouteParameterDescriptor = z.infer<typeof RouteParameterDescriptorSchema>;
export type PluginRouteDescriptor = z.infer<typeof PluginRouteDescriptorSchema>;
export type PluginRouteParameterValue = z.infer<typeof PluginRouteParameterValueSchema>;
export type PluginRouteReference = z.infer<typeof PluginRouteReferenceSchema>;
export type PluginNavigationDescriptor = z.infer<typeof PluginNavigationDescriptorSchema>;
