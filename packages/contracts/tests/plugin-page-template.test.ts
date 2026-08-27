import { describe, expect, it } from "vitest";

import { PluginPageTemplateDescriptorSchema } from "../src/index.js";

const descriptor = {
  id: "sales.page.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  route: { routeId: "sales.route.tasks", params: {} },
  surface: "workspace",
  profile: "workspace",
  permission: "sales.tasks.read",
  publicationPolicy: { ownership: "customer", adoption: "explicit" },
  requirements: {
    capabilities: [{ id: "records.storage", version: "1.0.0" }],
    sources: [{ id: "sales.tasks", version: 1 }],
    actions: [{ id: "sales.task.create", version: 1 }],
    blocks: [{ id: "sales.task-table", version: 1 }]
  },
  document: {
    id: "sales.page.tasks",
    version: 1,
    schemaVersion: 1,
    profile: "workspace",
    regions: {
      main: [{
        id: "tasks",
        type: "sales.task-table",
        version: 1,
        props: {},
        bindings: {
          source: { source: { id: "sales.tasks", version: 1 }, input: {}, structuralCompatibilityHash: `sha256:${"a".repeat(64)}` },
          action: { id: "sales.task.create", version: 1 }
        }
      }]
    }
  }
} as const;

describe("P6.4 plugin page template contract", () => {
  it("accepts an immutable customer-owned canonical template", () => {
    expect(PluginPageTemplateDescriptorSchema.safeParse(descriptor).success).toBe(true);
  });

  it("rejects identity, profile, resource, and migration drift", () => {
    expect(PluginPageTemplateDescriptorSchema.safeParse({ ...descriptor, document: { ...descriptor.document, id: "sales.page.other" } }).success).toBe(false);
    expect(PluginPageTemplateDescriptorSchema.safeParse({ ...descriptor, profile: "cms" }).success).toBe(false);
    expect(PluginPageTemplateDescriptorSchema.safeParse({ ...descriptor, requirements: { ...descriptor.requirements, sources: [] } }).success).toBe(false);
    expect(PluginPageTemplateDescriptorSchema.safeParse({ ...descriptor, requirements: { ...descriptor.requirements, actions: [] } }).success).toBe(false);
    expect(PluginPageTemplateDescriptorSchema.safeParse({
      ...descriptor,
      document: { ...descriptor.document, regions: { main: [{ ...descriptor.document.regions.main[0], bindings: { ...descriptor.document.regions.main[0].bindings, action: { id: "sales.task.other", version: 1 } } }] } }
    }).success).toBe(false);
    expect(PluginPageTemplateDescriptorSchema.safeParse({ ...descriptor, version: 2, document: { ...descriptor.document, version: 2 } }).success).toBe(false);
  });

  it("accepts explicit migration metadata only for a later version", () => {
    expect(PluginPageTemplateDescriptorSchema.safeParse({
      ...descriptor,
      version: 2,
      document: { ...descriptor.document, version: 2 },
      migration: { adoptableFromVersions: [1], notesMessageId: "sales.message.template-v2" }
    }).success).toBe(true);
  });
});
