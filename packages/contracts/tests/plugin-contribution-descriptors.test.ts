import { describe, expect, it } from "vitest";

import {
  PluginEventDescriptorSchema,
  PluginHealthAuditDescriptorSchema,
  PluginJobDescriptorSchema,
  PluginLifecycleDescriptorSchema,
  PluginLocalizationDescriptorSchema,
  PluginMigrationDescriptorSchema,
  PluginRealtimeTopicDescriptorSchema,
  PluginServiceDescriptorSchema,
  PluginTestingMetadataDescriptorSchema
} from "../src/index.js";

const owned = { id: "sales.reference", version: 1, ownerPluginId: "module.sales" } as const;

describe("P6.1 typed contribution descriptors", () => {
  it("validates every non-source/action configuration category", () => {
    const values = [
      [PluginMigrationDescriptorSchema, { ...owned, predecessorRevisions: [0] }],
      [PluginServiceDescriptorSchema, owned],
      [PluginEventDescriptorSchema, { ...owned, eventClass: "durable-integration", sourceId: "sales.tasks" }],
      [PluginJobDescriptorSchema, { ...owned, timeoutMs: 5_000, maxConcurrency: 1, idempotent: true }],
      [PluginRealtimeTopicDescriptorSchema, { ...owned, eventId: "sales.event.changed", sourceId: "sales.tasks", permission: "sales.tasks.read" }],
      [PluginLocalizationDescriptorSchema, { ...owned, locale: "en", messages: { "sales.message.title": "Sales" } }],
      [PluginHealthAuditDescriptorSchema, { ...owned, safe: true }],
      [PluginLifecycleDescriptorSchema, { ...owned, disable: "supported", reenable: "supported", purge: "unsupported" }],
      [PluginTestingMetadataDescriptorSchema, { ...owned, conformancePluginId: "module.sales" }]
    ] as const;
    for (const [schema, value] of values) expect(schema.safeParse(value).success).toBe(true);
  });

  it("rejects foreign ownership and arbitrary descriptor fields", () => {
    expect(PluginJobDescriptorSchema.safeParse({ ...owned, ownerPluginId: "module.other", timeoutMs: 5_000, maxConcurrency: 1, idempotent: true }).success).toBe(false);
    expect(PluginLifecycleDescriptorSchema.safeParse({ ...owned, disable: "supported", reenable: "supported", purge: "unsupported", executable: true }).success).toBe(false);
  });
});
