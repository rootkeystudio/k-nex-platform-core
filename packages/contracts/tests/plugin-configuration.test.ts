import { describe, expect, it } from "vitest";

import {
  PermissionDescriptorSchema,
  PluginNavigationDescriptorSchema,
  PluginRouteDescriptorSchema,
  PluginSettingsDescriptorSchema,
  PluginSettingsDocumentSchema
} from "../src/index.js";

const settings = {
  id: "sales.settings.workspace",
  ownerPluginId: "module.sales",
  schemaVersion: 2,
  fields: {
    defaultTaskPageSize: { type: "integer", required: true, default: 25, minimum: 1, maximum: 100 },
    pipelineStages: { type: "string-list", required: true, default: ["lead", "won"] },
    apiToken: { type: "secret-reference", required: false }
  },
  surface: "workspace",
  audience: "authenticated",
  readPermission: "sales.settings.read",
  changePermission: "sales.settings.write",
  featureRevision: 1,
  publicationRevision: 1
} as const;

const permission = {
  id: "sales.tasks.read",
  ownerPluginId: "module.sales",
  title: "Read Sales tasks",
  description: "Read actor-authorized Sales task projections.",
  audience: "authenticated",
  resource: "sales.tasks",
  operation: "read",
  policy: { id: "sales.policy.tasks-read", scope: "record", recordScoped: true, fieldScoped: false }
} as const;

const route = {
  id: "sales.route.task-detail",
  ownerPluginId: "module.sales",
  path: "/sales/tasks/:taskId",
  parameters: { taskId: { type: "string" } },
  surface: "workspace",
  audience: "authenticated",
  permission: "sales.tasks.read",
  viewId: "sales.view.task-detail"
} as const;

describe("P6.3 plugin configuration contracts", () => {
  it("accepts versioned strict settings with defaults and secret references", () => {
    expect(PluginSettingsDescriptorSchema.safeParse(settings).success).toBe(true);
    expect(PluginSettingsDocumentSchema.safeParse({
      settingsId: settings.id,
      schemaVersion: 2,
      revision: 7,
      values: {
        defaultTaskPageSize: 50,
        pipelineStages: ["lead", "qualified", "won"],
        apiToken: { kind: "secret-reference", provider: "environment", key: "SALES_API_TOKEN" }
      }
    }).success).toBe(true);
  });

  it("rejects settings fields that can alter executable contributions or topology", () => {
    for (const key of ["actions", "imports", "plugins", "topology", "pluginPackage", "importGraph"]) {
      expect(PluginSettingsDescriptorSchema.safeParse({
        ...settings,
        fields: { [key]: { type: "string", required: false } }
      }).success).toBe(false);
    }
    expect(PluginSettingsDescriptorSchema.safeParse({
      ...settings,
      fields: { apiToken: { type: "string", required: true } }
    }).success).toBe(false);
  });

  it("accepts consistent permission policy metadata and rejects inconsistent field scope", () => {
    expect(PermissionDescriptorSchema.safeParse(permission).success).toBe(true);
    expect(PermissionDescriptorSchema.safeParse({
      ...permission,
      policy: { ...permission.policy, scope: "field", fieldScoped: false }
    }).success).toBe(false);
  });

  it("requires typed route parameters to exactly match source-controlled path placeholders", () => {
    expect(PluginRouteDescriptorSchema.safeParse(route).success).toBe(true);
    expect(PluginRouteDescriptorSchema.safeParse({ ...route, parameters: {} }).success).toBe(false);
    expect(PluginRouteDescriptorSchema.safeParse({
      ...route,
      path: "/sales/tasks/:taskId/:taskId"
    }).success).toBe(false);
  });

  it("accepts navigation by route ID and rejects cross-owner identities", () => {
    const navigation = {
      id: "sales.navigation.tasks",
      ownerPluginId: "module.sales",
      labelMessageId: "sales.message.navigation-tasks",
      route: { routeId: "sales.route.tasks", params: {} },
      permission: "sales.tasks.read",
      order: 10
    };
    expect(PluginNavigationDescriptorSchema.safeParse(navigation).success).toBe(true);
    expect(PluginNavigationDescriptorSchema.safeParse({ ...navigation, id: "other.navigation.tasks" }).success).toBe(false);
  });
});
