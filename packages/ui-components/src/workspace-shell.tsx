"use client";

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { ThemePresentationSnapshot } from "@k-nex/ui-design-system-contracts";
import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";
import { Icon, VisuallyHidden } from "./foundation.js";
import { WorkspaceNavigationDrawer } from "./navigation.js";

type WorkspaceShellThemePresentation = Pick<ThemePresentationSnapshot, "profileRevisionId" | "mode" | "cssText">;

export interface WorkspaceShellProps {
  readonly applicationLabel: string;
  readonly environment: string;
  readonly currentHref: string;
  readonly navigation: ResolvedWorkspaceNavigation;
  readonly saveSidebarPreference?: (value: "expanded" | "collapsed") => Promise<void>;
  readonly themePresentation: WorkspaceShellThemePresentation;
  readonly children: ReactNode;
}

const railIcons = Object.freeze({ apps: "▦", dashboard: "▤", folder: "▱", sales: "▥", system: "⚙" });

const workspaceShellCss = `
[data-k-nex-component="workspace-shell"]{background:var(--k-nex-admin-color-background);color:var(--k-nex-admin-color-foreground)}
[data-k-nex-component="workspace-shell"] .workspace-sidebar{background:var(--k-nex-admin-color-background);border-inline-end:1px solid var(--k-nex-admin-color-border);padding:calc(var(--k-nex-admin-spacing-content)*1px)}
[data-k-nex-component="workspace-shell"] .workspace-header{background:var(--k-nex-admin-color-background);border-block-end:1px solid var(--k-nex-admin-color-border);gap:calc(var(--k-nex-admin-spacing-content)*1px);padding:calc(var(--k-nex-admin-spacing-content)*.75px) calc(var(--k-nex-admin-spacing-content)*1px)}
[data-k-nex-component="workspace-shell"] .workspace-brand{gap:calc(var(--k-nex-admin-spacing-content)*.25px);margin-block-end:calc(var(--k-nex-admin-spacing-content)*1px)}
[data-k-nex-component="workspace-shell"] .workspace-sidebar > button,[data-k-nex-component="workspace-shell"] .workspace-mobile-trigger,[data-k-nex-component="workspace-shell"] .workspace-drawer button{background:var(--k-nex-admin-color-background);border:1px solid var(--k-nex-admin-color-border);border-radius:calc(var(--k-nex-admin-radius-control)*1px);color:var(--k-nex-admin-color-foreground);padding:calc(var(--k-nex-admin-spacing-content)*.5px)}
[data-k-nex-component="workspace-shell"] .workspace-environment{border-color:var(--k-nex-admin-color-border);border-radius:calc(var(--k-nex-admin-radius-control)*1px);padding:calc(var(--k-nex-admin-spacing-content)*.2px) calc(var(--k-nex-admin-spacing-content)*.6px)}
[data-k-nex-component="workspace-shell"] .workspace-desktop-navigation-rail .workspace-rail-item[data-active]{background:var(--k-nex-admin-color-accent);color:var(--k-nex-admin-color-foreground)}
[data-k-nex-component="workspace-shell"] .workspace-skip-link:focus,[data-k-nex-component="workspace-shell"] :is(a,button):focus-visible{outline:3px solid var(--k-nex-admin-color-accent);outline-offset:3px}
[data-k-nex-component="workspace-shell"] .workspace-skip-link:focus,[data-k-nex-component="workspace-shell"] .workspace-drawer{background:var(--k-nex-admin-color-background);color:var(--k-nex-admin-color-foreground);padding:calc(var(--k-nex-admin-spacing-content)*1px)}
[data-k-nex-component="workspace-shell"] .workspace-drawer-overlay{background:color-mix(in srgb,var(--k-nex-admin-color-foreground) 45%,transparent)}
@media (prefers-reduced-motion:no-preference){[data-k-nex-component="workspace-shell"]{transition:grid-template-columns calc(var(--k-nex-admin-motion-duration)*1ms) ease}}
`;

function railIcon(icon?: keyof typeof railIcons): ReactElement {
  return <Icon>{railIcons[icon ?? "apps"]}</Icon>;
}

function navigationContent(navigation: ResolvedWorkspaceNavigation, currentHref: string, onNavigate?: () => void, compact = false): ReactElement {
  const nodes = navigation.tree.nodes;
  const routes = new Map(navigation.routes.map((route) => [JSON.stringify(route.target), route.href]));
  const children = new Map<string | undefined, typeof nodes>();
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const branch = (parentId?: string): ReactElement => <ul>{(children.get(parentId) ?? []).map((node) => {
    const nested = children.get(node.id);
    const href = node.target === undefined ? undefined : routes.get(JSON.stringify(node.target));
    return <li key={node.id} data-navigation-node={node.id}>
      {href === undefined
        ? <span data-navigation-label {...(compact ? { title: node.label, className: "workspace-rail-item" } : {})}>{compact ? <>{railIcon(node.icon)}<VisuallyHidden>{node.label}</VisuallyHidden></> : node.label}</span>
        : <a href={href} aria-current={href === currentHref ? "page" : undefined} onClick={onNavigate} {...(compact ? { title: node.label, className: "workspace-rail-item", "data-active": href === currentHref || undefined } : {})}>{compact ? <>{railIcon(node.icon)}<VisuallyHidden>{node.label}</VisuallyHidden></> : node.label}</a>}
      {nested === undefined ? null : branch(node.id)}
    </li>;
  })}</ul>;
  const shortcuts = (label: string, values: ResolvedWorkspaceNavigation["favorites"]): ReactElement | null => values.length === 0 ? null :
    <section data-workspace-shortcuts><h2>{compact ? <VisuallyHidden>{label}</VisuallyHidden> : label}</h2><ul>{values.map((item) => <li key={item.pageId}><a href={item.href} aria-current={item.href === currentHref ? "page" : undefined} onClick={onNavigate} {...(compact ? { title: item.label, className: "workspace-rail-item", "data-active": item.href === currentHref || undefined } : {})}>{compact ? <>{railIcon()}<VisuallyHidden>{item.label}</VisuallyHidden></> : item.label}</a></li>)}</ul></section>;
  return <nav aria-label="Workspace navigation">{branch()}{shortcuts("Favorites", navigation.favorites)}{shortcuts("Recent", navigation.recent)}</nav>;
}

export function WorkspaceShell({ applicationLabel, environment, currentHref, navigation, saveSidebarPreference, themePresentation, children }: WorkspaceShellProps): ReactElement {
  const [collapsed, setCollapsed] = useState(navigation.sidebar === "collapsed");
  useEffect(() => { setCollapsed(navigation.sidebar === "collapsed"); }, [navigation.sidebar]);
  const setSidebar = (value: boolean) => {
    setCollapsed(value);
    void saveSidebarPreference?.(value ? "collapsed" : "expanded").catch(() => setCollapsed(navigation.sidebar === "collapsed"));
  };
  const currentLabel = useMemo(() => {
    const route = navigation.routes.find(({ href }) => href === currentHref);
    if (route === undefined) return "Workspace";
    return navigation.tree.nodes.find(({ target }) => target !== undefined && JSON.stringify(target) === JSON.stringify(route.target))?.label ?? "Workspace";
  }, [currentHref, navigation]);
  return <div className="workspace-shell" data-k-nex-component="workspace-shell" data-k-nex-theme-profile={themePresentation.profileRevisionId} data-k-nex-theme-mode={themePresentation.mode} data-sidebar={collapsed ? "collapsed" : "expanded"}>
    <style>{themePresentation.cssText}</style>
    <style>{workspaceShellCss}</style>
    <a className="workspace-skip-link" href="#workspace-main">Skip to main content</a>
    <aside className="workspace-sidebar" aria-label="Desktop workspace navigation">
      <div className="workspace-brand"><strong>{applicationLabel}</strong><span>{environment}</span></div>
      <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => setSidebar(!collapsed)}>☰</button>
      <div className="workspace-desktop-navigation">
        <div className="workspace-desktop-navigation-expanded">{navigationContent(navigation, currentHref)}</div>
        <div className="workspace-desktop-navigation-rail">{navigationContent(navigation, currentHref, undefined, true)}</div>
      </div>
    </aside>
    <header className="workspace-header">
      <WorkspaceNavigationDrawer applicationLabel={applicationLabel}>{(close) => navigationContent(navigation, currentHref, close)}</WorkspaceNavigationDrawer>
      <nav aria-label="Breadcrumb"><ol><li><a href="/">Workspace</a></li>{currentHref === "/" ? null : <li aria-current="page">{currentLabel}</li>}</ol></nav>
      <span className="workspace-environment">{environment}</span>
    </header>
    <main id="workspace-main" tabIndex={-1}>{children}</main>
  </div>;
}
