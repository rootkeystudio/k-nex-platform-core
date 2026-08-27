import * as z from "zod";

import { DurableEventClassSchema } from "./event.js";
import { PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

const version = z.number().int().positive().max(1_000_000);
const owned = {
  id: ResourceIdSchema,
  version,
  ownerPluginId: PluginIdSchema
} as const;

const ownedByPlugin = (value: { id: string; ownerPluginId: string }): boolean =>
  value.id.startsWith(`${value.ownerPluginId.split(".")[1]}.`);
const ownerIssue = { path: ["id"], message: "Contribution ID must use the owner plugin namespace." };

export const PluginMigrationDescriptorSchema = z.strictObject({
  ...owned,
  predecessorRevisions: uniqueArray(z.number().int().nonnegative()).max(128)
}).refine(ownedByPlugin, ownerIssue);

export const PluginServiceDescriptorSchema = z.strictObject(owned).refine(ownedByPlugin, ownerIssue);

export const PluginEventDescriptorSchema = z.strictObject({
  ...owned,
  eventClass: DurableEventClassSchema,
  sourceId: ResourceIdSchema
}).refine(ownedByPlugin, ownerIssue);

export const PluginJobDescriptorSchema = z.strictObject({
  ...owned,
  timeoutMs: z.number().int().positive().max(86_400_000),
  maxConcurrency: z.number().int().positive().max(1_000),
  idempotent: z.boolean()
}).refine(ownedByPlugin, ownerIssue);

export const PluginRealtimeTopicDescriptorSchema = z.strictObject({
  ...owned,
  eventId: ResourceIdSchema,
  sourceId: ResourceIdSchema,
  permission: ResourceIdSchema
}).refine(ownedByPlugin, ownerIssue);

export const PluginLocalizationDescriptorSchema = z.strictObject({
  ...owned,
  locale: z.string().min(2).max(35).regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
  messages: z.record(ResourceIdSchema, z.string().min(1).max(4_096))
}).refine(ownedByPlugin, ownerIssue);

export const PluginHealthAuditDescriptorSchema = z.strictObject({ ...owned, safe: z.literal(true) }).refine(ownedByPlugin, ownerIssue);

export const PluginLifecycleDescriptorSchema = z.strictObject({
  ...owned,
  disable: z.enum(["supported", "unsupported"]),
  reenable: z.enum(["supported", "unsupported"]),
  purge: z.enum(["supported", "unsupported"])
}).refine(ownedByPlugin, ownerIssue);

export const PluginTestingMetadataDescriptorSchema = z.strictObject({
  ...owned,
  conformancePluginId: PluginIdSchema
}).refine(ownedByPlugin, ownerIssue);

export type PluginMigrationDescriptor = z.infer<typeof PluginMigrationDescriptorSchema>;
export type PluginServiceDescriptor = z.infer<typeof PluginServiceDescriptorSchema>;
export type PluginEventDescriptor = z.infer<typeof PluginEventDescriptorSchema>;
export type PluginJobDescriptor = z.infer<typeof PluginJobDescriptorSchema>;
export type PluginRealtimeTopicDescriptor = z.infer<typeof PluginRealtimeTopicDescriptorSchema>;
export type PluginLocalizationDescriptor = z.infer<typeof PluginLocalizationDescriptorSchema>;
export type PluginHealthAuditDescriptor = z.infer<typeof PluginHealthAuditDescriptorSchema>;
export type PluginLifecycleDescriptor = z.infer<typeof PluginLifecycleDescriptorSchema>;
export type PluginTestingMetadataDescriptor = z.infer<typeof PluginTestingMetadataDescriptorSchema>;
