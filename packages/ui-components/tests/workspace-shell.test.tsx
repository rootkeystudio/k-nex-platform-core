import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";
import type { ThemePresentationSnapshot } from "@k-nex/ui-design-system-contracts";

import { WorkspaceShell } from "../src/workspace-shell.js";

const themePresentation: Pick<ThemePresentationSnapshot, "profileRevisionId" | "mode" | "cssText"> = {
  profileRevisionId: "theme-profile-revision-42",
  mode: "light",
  cssText: '[data-k-nex-theme-profile="theme-profile-revision-42"]{--k-nex-admin-color-background:#fff;--k-nex-admin-color-foreground:#111;--k-nex-admin-color-border:#888;--k-nex-admin-color-accent:#05f;--k-nex-admin-motion-duration:160;--k-nex-admin-radius-control:8;--k-nex-admin-spacing-content:16}'
};

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
    const markup = renderToStaticMarkup(<WorkspaceShell applicationLabel="Customer Alpha" environment="production" currentHref="/sales" navigation={navigation} preferenceKey="customer-alpha:user-one:sidebar" themePresentation={themePresentation}><p>Sales content</p></WorkspaceShell>);
    expect(markup).toContain('data-k-nex-component="workspace-shell"');
    expect(markup).toContain('data-k-nex-theme-profile="theme-profile-revision-42"');
    expect(markup).toContain('data-k-nex-theme-mode="light"');
    expect(markup).toContain(themePresentation.cssText);
    expect(markup).toContain('workspace-drawer-overlay{background:color-mix(in srgb,var(--k-nex-admin-color-foreground) 45%,transparent)}');
    expect(markup).toContain('workspace-environment{border-color:var(--k-nex-admin-color-border);border-radius:calc(var(--k-nex-admin-radius-control)*1px)');
    expect(markup).toContain(':is(a,button):focus-visible{outline:3px solid var(--k-nex-admin-color-accent)');
    expect(markup).toContain('href="#workspace-main"');
    expect(markup).toContain('aria-label="Desktop workspace navigation"');
    expect(markup).toContain('aria-label="Open navigation"');
    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Sales content");
    expect(markup).toContain("Pipeline");
  });

  it("keeps resolved links usable in the collapsed desktop rail", () => {
    const markup = renderToStaticMarkup(<WorkspaceShell applicationLabel="Customer Alpha" environment="production" currentHref="/sales" navigation={{ ...navigation, sidebar: "collapsed" }} preferenceKey="customer-alpha:user-one:sidebar" themePresentation={themePresentation}><p>Sales content</p></WorkspaceShell>);

    expect(markup).toContain('data-sidebar="collapsed"');
    expect(markup).toContain('workspace-desktop-navigation-rail');
    expect(markup).toContain('title="Overview"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-k-nex-component="visually-hidden"');
  });
});
