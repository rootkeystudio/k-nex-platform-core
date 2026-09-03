import { describe, expect, it } from "vitest";

import type { PluginNavigationDescriptor, PluginRouteDescriptor, WorkspacePage } from "@k-nex/contracts";

import {
  WorkspaceNavigationResolutionError,
  resolveAuthorizedWorkspacePath,
  resolveWorkspaceNavigation,
  type ResolveWorkspaceNavigationInput
} from "../src/workspace-navigation.js";

const salesRoute: PluginRouteDescriptor = {
  id: "sales.route.overview",
  ownerPluginId: "module.sales",
  path: "/sales",
  parameters: {},
  surface: "workspace",
  audience: "authenticated",
  permission: "sales.navigation.read",
  viewId: "sales.page.overview"
};

const salesNavigation: PluginNavigationDescriptor = {
  id: "sales.navigation.overview",
  ownerPluginId: "module.sales",
  labelMessageId: "sales.message.navigation-overview",
  route: { routeId: salesRoute.id, params: {} },
  permission: "sales.navigation.read",
  order: 10
};

const page: WorkspacePage = {
  schemaVersion: 1,
  identity: { applicationId: "customer-alpha", environment: "production", pageId: "customer.page.pipeline", documentId: "customer.document.pipeline" },
  title: "Pipeline dashboard",
  state: "published",
  navigation: { state: "placed", parentNavigationId: "sales.navigation.root", order: 20 },
  workingCopyRevision: 1,
  publishedRevisionId: "customer.revision.pipeline.1",
  accessRevision: 1,
  dependencyDigest: `sha256:${"a".repeat(64)}`,
  revision: 1,
  createdBy: { kind: "user", id: "user:owner" },
  updatedBy: { kind: "user", id: "user:owner" },
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z"
};

function input(overrides: Partial<ResolveWorkspaceNavigationInput> = {}): ResolveWorkspaceNavigationInput {
  return {
    applicationId: "customer-alpha",
    environment: "production",
    revision: 4,
    implementedSystemRouteIds: ["system.route.workspace", "system.route.workspace-pages"],
    plugins: [{
      id: "sales.navigation.root",
      pluginId: "module.sales",
      label: "Sales",
      icon: "sales",
      order: 100,
      active: true,
      acceptsCustomerChildren: true,
      routes: [],
      navigation: [],
      messages: {}
    }],
    customerFolders: [],
    pages: [page],
    preferences: { sidebar: "collapsed", favoritePageIds: [page.identity.pageId, page.identity.pageId], recentPageIds: [page.identity.pageId] },
    authorize: async () => true,
    pageAccess: async () => true,
    ...overrides
  };
}

async function expectCode(value: Promise<unknown>, code: WorkspaceNavigationResolutionError["code"]): Promise<void> {
  try {
    await value;
    throw new Error("Expected workspace navigation failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceNavigationResolutionError);
    expect((error as WorkspaceNavigationResolutionError).code).toBe(code);
  }
}

describe("P12.4 workspace navigation resolution", () => {
  it("resolves only implemented System routes and keeps Sales as a customer-page parent", async () => {
    const resolved = await resolveWorkspaceNavigation(input());
    expect(resolved.sidebar).toBe("collapsed");
    expect(resolved.tree.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "k-nex.navigation.root", "k-nex.navigation.workspace", "sales.navigation.root",
      "customer.page.pipeline", "system.navigation.root", "system.navigation.workspace-pages"
    ]));
    expect(resolved.tree.nodes.map(({ id }) => id)).not.toEqual(expect.arrayContaining(["sales.navigation.overview", "system.navigation.roles"]));
    expect(resolved.tree.nodes.find(({ id }) => id === page.identity.pageId)?.parentId).toBe("sales.navigation.root");
    expect(resolved.favorites).toEqual([{ pageId: page.identity.pageId, label: page.title, href: "/workspace/pages/customer.page.pipeline" }]);
    expect(resolved.recent).toHaveLength(1);
    expect(resolveAuthorizedWorkspacePath(resolved, "/sales")).toBeUndefined();
    expect(resolveAuthorizedWorkspacePath(resolved, "/workspace/pages/customer.page.pipeline")?.target).toEqual({ class: "workspace-page", pageId: page.identity.pageId, mode: "view" });
    expect(resolveAuthorizedWorkspacePath(resolved, "/system/access/roles")).toBeUndefined();
    expect(resolveAuthorizedWorkspacePath(resolved, "/missing")).toBeUndefined();
  });

  it("keeps an empty customer-page parent without synthesizing a plugin route", async () => {
    const resolved = await resolveWorkspaceNavigation(input({
      plugins: [
        { ...input().plugins[0]!, routes: [], navigation: [] },
        { ...input().plugins[0]!, id: "support.navigation.root", pluginId: "module.support", label: "Support", order: 200, acceptsCustomerChildren: false }
      ],
      pages: [],
      preferences: { sidebar: "expanded", favoritePageIds: [], recentPageIds: [] }
    }));
    expect(resolved.tree.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining(["sales.navigation.root"]));
    expect(resolved.tree.nodes.map(({ id }) => id)).not.toEqual(expect.arrayContaining(["support.navigation.root"]));
    expect(resolved.tree.nodes.find(({ id }) => id === "sales.navigation.root")).toMatchObject({ kind: "folder" });
    expect(resolved.routes.map(({ href }) => href)).not.toContain("/sales");
    expect(resolveAuthorizedWorkspacePath(resolved, "/sales")).toBeUndefined();
  });

  it("omits unauthorized links, routes, descendants, and shortcuts before serialization", async () => {
    const resolved = await resolveWorkspaceNavigation(input({
      authorize: async (permissionId) => permissionId === "system.workspace-pages.read",
      pageAccess: async () => false
    }));
    expect(resolved.tree.nodes.map(({ id }) => id)).toEqual(["k-nex.navigation.root", "k-nex.navigation.workspace", "system.navigation.workspace-pages", "sales.navigation.root", "system.navigation.root"]);
    expect(resolved.routes.map(({ href }) => href)).toEqual(["/", "/system/workspace-pages"]);
    expect(resolved.favorites).toEqual([]);
    expect(JSON.stringify(resolved)).not.toContain("sales.route.overview");
    expect(JSON.stringify(resolved)).not.toContain("customer.page.pipeline");
    expect(resolveAuthorizedWorkspacePath(resolved, "/sales")).toBeUndefined();
  });

  it("registers no System link or route outside the explicit implemented subset", async () => {
    const resolved = await resolveWorkspaceNavigation(input({
      implementedSystemRouteIds: [],
      pages: [],
      preferences: { sidebar: "expanded", favoritePageIds: [], recentPageIds: [] }
    }));
    expect(resolved.tree.nodes.map(({ id }) => id)).toEqual(["sales.navigation.root", "system.navigation.root"]);
    expect(resolved.routes).toEqual([]);
  });

  it("rejects invalid or duplicate implemented System IDs alongside invalid graphs", async () => {
    await expectCode(resolveWorkspaceNavigation(input({ implementedSystemRouteIds: ["system.route.workspace", "system.route.workspace"] })), "DUPLICATE_ROUTE");
    await expectCode(resolveWorkspaceNavigation(input({ implementedSystemRouteIds: ["system.route.workspace-pages", "system.route.workspace"] })), "INPUT_INVALID");
    await expectCode(resolveWorkspaceNavigation(input({ implementedSystemRouteIds: ["system.route.not-real"] })), "INPUT_INVALID");
    await expectCode(resolveWorkspaceNavigation(input({ plugins: [{ ...input().plugins[0]!, id: "system.navigation.root" }] })), "DUPLICATE_ID");
    await expectCode(resolveWorkspaceNavigation(input({ plugins: [{ ...input().plugins[0]!, active: false }] })), "PLUGIN_INACTIVE");
    await expectCode(resolveWorkspaceNavigation(input({ plugins: [{ ...input().plugins[0]!, navigation: [salesNavigation] }] })), "ROUTE_MISSING");
    await expectCode(resolveWorkspaceNavigation(input({ plugins: [{ ...input().plugins[0]!, routes: [salesRoute], navigation: [{ ...salesNavigation, parentId: "system.navigation.root" }], messages: { "sales.message.navigation-overview": "Overview" } }] })), "FOREIGN_PARENT");
    await expectCode(resolveWorkspaceNavigation(input({ pages: [{ ...page, navigation: { state: "placed", parentNavigationId: "customer.folder.missing", order: 20 } }] })), "PARENT_MISSING");
    await expectCode(resolveWorkspaceNavigation(input({
      customerFolders: [
        { id: "customer.folder.one", owner: { kind: "customer" }, kind: "folder", parentId: "customer.folder.two", label: "One", order: 1 },
        { id: "customer.folder.two", owner: { kind: "customer" }, kind: "folder", parentId: "customer.folder.one", label: "Two", order: 2 }
      ]
    })), "INPUT_INVALID");
  });
});
