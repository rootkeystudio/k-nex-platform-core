import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";

import { WorkspaceShell } from "../src/workspace-shell.js";

const navigation: ResolvedWorkspaceNavigation = {
  tree: {
    schemaVersion: 1,
    applicationId: "customer-alpha",
    environment: "production",
    revision: 1,
    nodes: [
      { id: "k-nex.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "K-Nex", order: 0 },
      { id: "k-nex.navigation.workspace", owner: { kind: "platform" }, kind: "link", parentId: "k-nex.navigation.root", label: "Workspace", order: 0, target: { class: "system", routeId: "system.route.workspace" } },
      { id: "sales.navigation.root", owner: { kind: "platform-plugin", pluginId: "module.sales" }, kind: "folder", label: "Sales", order: 100 },
      { id: "sales.navigation.overview", owner: { kind: "platform-plugin", pluginId: "module.sales" }, kind: "link", parentId: "sales.navigation.root", label: "Overview", order: 10, target: { class: "platform-plugin", ownerPluginId: "module.sales", routeId: "sales.route.overview" } },
      { id: "system.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "System", order: 1_000_000 }
    ]
  },
  routes: [
    { target: { class: "system", routeId: "system.route.workspace" }, href: "/" },
    { target: { class: "platform-plugin", ownerPluginId: "module.sales", routeId: "sales.route.overview" }, href: "/sales" }
  ],
  favorites: [{ pageId: "customer.page.pipeline", label: "Pipeline", href: "/workspace/pages/customer.page.pipeline" }],
  recent: [],
  sidebar: "expanded"
};

describe("P12.4 workspace shell", () => {
  it("server-renders only resolved navigation with shell, skip-link, breadcrumb, and collapse semantics", () => {
    const markup = renderToStaticMarkup(<WorkspaceShell applicationLabel="Customer Alpha" environment="production" currentHref="/sales" navigation={navigation} preferenceKey="customer-alpha:user-one:sidebar"><p>Sales content</p></WorkspaceShell>);
    expect(markup).toContain('data-k-nex-component="workspace-shell"');
    expect(markup).toContain('href="#workspace-main"');
    expect(markup).toContain('aria-label="Desktop workspace navigation"');
    expect(markup).toContain('aria-label="Open navigation"');
    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Sales content");
    expect(markup).toContain("Pipeline");
  });
});
