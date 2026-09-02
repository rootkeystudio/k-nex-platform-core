import { describe, expect, it } from "vitest";

import {
  PluginNavigationDescriptorSchema,
  PluginRouteDescriptorSchema
} from "../src/index.js";

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
