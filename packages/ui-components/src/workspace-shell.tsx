"use client";

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { ResolvedWorkspaceNavigation } from "@k-nex/ui-runtime";
import { WorkspaceNavigationDrawer } from "./navigation.js";

export interface WorkspaceShellProps {
  readonly applicationLabel: string;
  readonly environment: string;
  readonly currentHref: string;
  readonly navigation: ResolvedWorkspaceNavigation;
  readonly preferenceKey: string;
  readonly children: ReactNode;
}

function navigationContent(navigation: ResolvedWorkspaceNavigation, currentHref: string, onNavigate?: () => void): ReactElement {
  const nodes = navigation.tree.nodes;
  const routes = new Map(navigation.routes.map((route) => [JSON.stringify(route.target), route.href]));
  const children = new Map<string | undefined, typeof nodes>();
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const branch = (parentId?: string): ReactElement => <ul>{(children.get(parentId) ?? []).map((node) => {
    const nested = children.get(node.id);
    const href = node.target === undefined ? undefined : routes.get(JSON.stringify(node.target));
    return <li key={node.id} data-navigation-node={node.id}>
      {href === undefined ? <span data-navigation-label>{node.label}</span> : <a href={href} aria-current={href === currentHref ? "page" : undefined} onClick={onNavigate}>{node.label}</a>}
      {nested === undefined ? null : branch(node.id)}
    </li>;
  })}</ul>;
  const shortcuts = (label: string, values: ResolvedWorkspaceNavigation["favorites"]): ReactElement | null => values.length === 0 ? null :
    <section data-workspace-shortcuts><h2>{label}</h2><ul>{values.map((item) => <li key={item.pageId}><a href={item.href} aria-current={item.href === currentHref ? "page" : undefined} onClick={onNavigate}>{item.label}</a></li>)}</ul></section>;
  return <nav aria-label="Workspace navigation">{branch()}{shortcuts("Favorites", navigation.favorites)}{shortcuts("Recent", navigation.recent)}</nav>;
}

export function WorkspaceShell({ applicationLabel, environment, currentHref, navigation, preferenceKey, children }: WorkspaceShellProps): ReactElement {
  const [collapsed, setCollapsed] = useState(navigation.sidebar === "collapsed");
  useEffect(() => {
    const stored = globalThis.localStorage?.getItem(preferenceKey);
    if (stored === "expanded" || stored === "collapsed") setCollapsed(stored === "collapsed");
  }, [preferenceKey]);
  const setSidebar = (value: boolean) => {
    setCollapsed(value);
    globalThis.localStorage?.setItem(preferenceKey, value ? "collapsed" : "expanded");
  };
  const currentLabel = useMemo(() => {
    const route = navigation.routes.find(({ href }) => href === currentHref);
    if (route === undefined) return "Workspace";
    return navigation.tree.nodes.find(({ target }) => target !== undefined && JSON.stringify(target) === JSON.stringify(route.target))?.label ?? "Workspace";
  }, [currentHref, navigation]);
  return <div data-k-nex-component="workspace-shell" data-sidebar={collapsed ? "collapsed" : "expanded"}>
    <a className="workspace-skip-link" href="#workspace-main">Skip to main content</a>
    <aside className="workspace-sidebar" aria-label="Desktop workspace navigation">
      <div className="workspace-brand"><strong>{applicationLabel}</strong><span>{environment}</span></div>
      <button type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => setSidebar(!collapsed)}>☰</button>
      <div className="workspace-desktop-navigation">{navigationContent(navigation, currentHref)}</div>
    </aside>
    <header className="workspace-header">
      <WorkspaceNavigationDrawer applicationLabel={applicationLabel}>{(close) => navigationContent(navigation, currentHref, close)}</WorkspaceNavigationDrawer>
      <nav aria-label="Breadcrumb"><ol><li><a href="/">Workspace</a></li>{currentHref === "/" ? null : <li aria-current="page">{currentLabel}</li>}</ol></nav>
      <span className="workspace-environment">{environment}</span>
    </header>
    <main id="workspace-main" tabIndex={-1}>{children}</main>
  </div>;
}
