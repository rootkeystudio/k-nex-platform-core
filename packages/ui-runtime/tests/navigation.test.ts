import { describe, expect, it } from "vitest";

import type { PluginNavigationDescriptor, PluginRouteDescriptor } from "@k-nex/contracts";

import {
  NavigationResolutionError,
  resolvePluginNavigation
} from "../src/navigation.js";

const tasksRoute: PluginRouteDescriptor = {
  id: "sales.route.tasks",
  ownerPluginId: "module.sales",
  path: "/sales/tasks",
  parameters: {},
  surface: "workspace",
  audience: "authenticated",
  permission: "sales.tasks.read",
  viewId: "sales.view.tasks"
};

const taskDetailRoute: PluginRouteDescriptor = {
  id: "sales.route.task-detail",
  ownerPluginId: "module.sales",
  path: "/sales/tasks/:taskId",
  parameters: { taskId: { type: "string" } },
  surface: "workspace",
  audience: "authenticated",
  permission: "sales.tasks.read",
  viewId: "sales.view.task-detail"
};

const tasksNavigation: PluginNavigationDescriptor = {
  id: "sales.navigation.tasks",
  ownerPluginId: "module.sales",
  labelMessageId: "sales.message.navigation-tasks",
  route: { routeId: tasksRoute.id, params: {} },
  permission: "sales.navigation.read",
  order: 10
};

function input(overrides: Partial<Parameters<typeof resolvePluginNavigation>[0]> = {}): Parameters<typeof resolvePluginNavigation>[0] {
  return {
    installedPluginIds: new Set(["module.sales"]),
    routes: [tasksRoute, taskDetailRoute],
    navigation: [tasksNavigation],
    actor: { authenticated: true, permissions: new Set(["sales.tasks.read", "sales.navigation.read"]) },
    ...overrides
  };
}

function expectCode(run: () => unknown, code: NavigationResolutionError["code"]): void {
  try {
    run();
    throw new Error("Expected navigation failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(NavigationResolutionError);
    expect((error as NavigationResolutionError).code).toBe(code);
  }
}

describe("P6.3 route and navigation resolution", () => {
  it("resolves source-controlled routes and typed parameters", () => {
    const detail: PluginNavigationDescriptor = {
      ...tasksNavigation,
      id: "sales.navigation.task-detail",
      route: { routeId: taskDetailRoute.id, params: { taskId: "task 7" } },
      order: 20
    };
    expect(resolvePluginNavigation(input({ navigation: [tasksNavigation, detail] }))).toEqual([
      expect.objectContaining({ id: tasksNavigation.id, href: "/sales/tasks" }),
      expect.objectContaining({ id: detail.id, href: "/sales/tasks/task%207" })
    ]);
    expectCode(() => resolvePluginNavigation(input({
      navigation: [{ ...detail, route: { routeId: taskDetailRoute.id, params: { taskId: 7 } } }]
    })), "ROUTE_PARAMETERS_INVALID");
  });

  it("fails when navigation targets an absent or uninstalled route", () => {
    expectCode(() => resolvePluginNavigation(input({ routes: [] })), "ROUTE_TARGET_UNAVAILABLE");
    expectCode(() => resolvePluginNavigation(input({
      routes: [{ ...tasksRoute, ownerPluginId: "module.other", id: "other.route.tasks", viewId: "other.view.tasks" }]
    })), "ROUTE_OWNER_UNINSTALLED");
  });

  it("cannot expose navigation by bypassing either route or item permission", () => {
    expect(resolvePluginNavigation(input({
      actor: { authenticated: true, permissions: new Set(["sales.navigation.read"]) }
    }))).toEqual([]);
    expect(resolvePluginNavigation(input({
      actor: { authenticated: true, permissions: new Set(["sales.tasks.read"]) }
    }))).toEqual([]);
    expect(resolvePluginNavigation(input({
      actor: { authenticated: false, permissions: new Set(["sales.tasks.read", "sales.navigation.read"]) }
    }))).toEqual([]);

    const child = { ...tasksNavigation, id: "sales.navigation.child", parentId: tasksNavigation.id };
    expect(resolvePluginNavigation(input({
      navigation: [{ ...tasksNavigation, permission: "sales.parent.read" }, child]
    }))).toEqual([]);
  });

  it("rejects missing and cyclic navigation parents", () => {
    expectCode(() => resolvePluginNavigation(input({
      navigation: [{ ...tasksNavigation, parentId: "sales.navigation.missing" }]
    })), "PARENT_UNAVAILABLE");
    expectCode(() => resolvePluginNavigation(input({
      navigation: [
        { ...tasksNavigation, parentId: "sales.navigation.other" },
        { ...tasksNavigation, id: "sales.navigation.other", parentId: tasksNavigation.id }
      ]
    })), "PARENT_CYCLE");
  });
});
