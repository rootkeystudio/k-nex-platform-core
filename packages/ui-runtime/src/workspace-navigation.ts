import {
  PluginNavigationDescriptorSchema,
  PluginRouteDescriptorSchema,
  WorkspaceNavigationNodeSchema,
  WorkspaceNavigationTreeSchema,
  WorkspacePageSchema,
  canonicalJson,
  type PluginNavigationDescriptor,
  type PluginRouteDescriptor,
  type PluginRouteParameterValue,
  type WorkspaceNavigationNode,
  type WorkspaceNavigationTree,
  type WorkspacePage,
  type WorkspaceRouteTarget
} from "@k-nex/contracts";

export type WorkspaceNavigationResolutionErrorCode =
  | "INPUT_INVALID"
  | "DUPLICATE_ID"
  | "DUPLICATE_ROUTE"
  | "FOREIGN_PARENT"
  | "PARENT_MISSING"
  | "PLUGIN_INACTIVE"
  | "ROUTE_MISSING"
  | "ROUTE_PARAMETERS_INVALID"
  | "ROUTE_PATH_CONFLICT";

export class WorkspaceNavigationResolutionError extends Error {
  constructor(readonly code: WorkspaceNavigationResolutionErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceNavigationResolutionError";
  }
}

export interface WorkspacePluginNavigationSection {
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  readonly icon?: "apps" | "dashboard" | "folder" | "sales" | "system";
  readonly order: number;
  readonly active: boolean;
  readonly acceptsCustomerChildren?: boolean;
  readonly routes: readonly PluginRouteDescriptor[];
  readonly navigation: readonly PluginNavigationDescriptor[];
  readonly messages: Readonly<Record<string, string>>;
}

export interface WorkspaceNavigationPreferences {
  readonly sidebar: "expanded" | "collapsed";
  readonly favoritePageIds: readonly string[];
  readonly recentPageIds: readonly string[];
}

export interface ResolvedWorkspaceRoute {
  readonly target: WorkspaceRouteTarget;
  readonly href: string;
}

export interface ResolvedWorkspaceShortcut {
  readonly pageId: string;
  readonly label: string;
  readonly href: string;
}

export interface ResolvedWorkspaceNavigation {
  readonly tree: WorkspaceNavigationTree;
  readonly routes: readonly ResolvedWorkspaceRoute[];
  readonly favorites: readonly ResolvedWorkspaceShortcut[];
  readonly recent: readonly ResolvedWorkspaceShortcut[];
  readonly sidebar: "expanded" | "collapsed";
}

export interface ResolveWorkspaceNavigationInput {
  readonly applicationId: string;
  readonly environment: string;
  readonly revision: number;
  readonly implementedSystemRouteIds: readonly string[];
  readonly plugins: readonly WorkspacePluginNavigationSection[];
  readonly customerFolders: readonly WorkspaceNavigationNode[];
  readonly pages: readonly WorkspacePage[];
  readonly preferences: WorkspaceNavigationPreferences;
  readonly authorize: (permissionId: string, target: WorkspaceRouteTarget) => boolean | Promise<boolean>;
  readonly pageAccess: (pageId: string) => boolean | Promise<boolean>;
}

const fixedRoutes = Object.freeze([
  ["system.route.workspace", "/", "system.workspace-pages.read", "Workspace", "dashboard", "k-nex.navigation.root", "k-nex.navigation.workspace", 0],
  ["system.route.roles", "/system/access/roles", "system.roles.read", "Roles", undefined, "system.navigation.root", "system.navigation.roles", 10],
  ["system.route.permissions", "/system/access/permissions", "system.permissions.read", "Permissions", undefined, "system.navigation.root", "system.navigation.permissions", 20],
  ["system.route.assignments", "/system/access/assignments", "system.role-assignments.read", "Assignments", undefined, "system.navigation.root", "system.navigation.assignments", 30],
  ["system.route.extensions", "/system/extensions", "system.extensions.read", "Extensions", "apps", "system.navigation.root", "system.navigation.extensions", 40],
  ["system.route.workspace-pages", "/system/workspace-pages", "system.workspace-pages.read", "Workspace pages", "dashboard", "system.navigation.root", "system.navigation.workspace-pages", 45],
  ["system.route.themes", "/system/themes", "system.themes.read", "Themes", undefined, "system.navigation.root", "system.navigation.themes", 50],
  ["system.route.settings", "/system/settings", "system.settings.read", "Settings", undefined, "system.navigation.root", "system.navigation.settings", 60],
  ["system.route.operations", "/system/operations", "system.operations.read", "Operations", undefined, "system.navigation.root", "system.navigation.operations", 70]
] as const);

function fail(code: WorkspaceNavigationResolutionErrorCode, message: string): never {
  throw new WorkspaceNavigationResolutionError(code, message);
}

function targetKey(target: WorkspaceRouteTarget): string { return canonicalJson(target); }

function routeHref(route: PluginRouteDescriptor, params: Readonly<Record<string, PluginRouteParameterValue>>): string {
  const expected = Object.keys(route.parameters).sort();
  const actual = Object.keys(params).sort();
  if (expected.join("\0") !== actual.join("\0")) fail("ROUTE_PARAMETERS_INVALID", `Route ${route.id} parameters do not match.`);
  for (const key of expected) {
    const value = params[key];
    const type = route.parameters[key]?.type;
    if (value === undefined || type === undefined || type === "string" && typeof value !== "string" ||
      type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value)) || type === "boolean" && typeof value !== "boolean") {
      fail("ROUTE_PARAMETERS_INVALID", `Route ${route.id} parameter ${key} is invalid.`);
    }
  }
  return route.path.replace(/:([A-Za-z][A-Za-z0-9]*)/gu, (_match, key: string) => encodeURIComponent(String(params[key])));
}

function register<T>(map: Map<string, T>, id: string, value: T, code: "DUPLICATE_ID" | "DUPLICATE_ROUTE"): void {
  if (map.has(id)) fail(code, `Duplicate workspace identity ${id}.`);
  map.set(id, value);
}

function validatePreferences(value: WorkspaceNavigationPreferences): void {
  if (value.sidebar !== "expanded" && value.sidebar !== "collapsed" ||
    !Array.isArray(value.favoritePageIds) || !Array.isArray(value.recentPageIds) || value.favoritePageIds.length > 64 || value.recentPageIds.length > 64 ||
    [...value.favoritePageIds, ...value.recentPageIds].some((id) => typeof id !== "string" || id.length < 3 || id.length > 160)) {
    fail("INPUT_INVALID", "Workspace navigation preferences are invalid.");
  }
}

function assertParentOwnership(nodes: ReadonlyMap<string, WorkspaceNavigationNode>, sections: ReadonlyMap<string, WorkspacePluginNavigationSection>): void {
  for (const node of nodes.values()) {
    if (node.parentId === undefined) continue;
    const parent = nodes.get(node.parentId);
    if (parent === undefined) fail("PARENT_MISSING", `Navigation parent ${node.parentId} is missing.`);
    if (parent.kind !== "folder") fail("FOREIGN_PARENT", `Navigation parent ${node.parentId} is not a folder.`);
    if (node.owner.kind === "platform-plugin") {
      if (parent.owner.kind !== "platform-plugin" || parent.owner.pluginId !== node.owner.pluginId) fail("FOREIGN_PARENT", `Plugin navigation ${node.id} crosses owner boundaries.`);
    } else if (node.owner.kind === "customer" && parent.owner.kind === "platform-plugin") {
      if (!sections.get(parent.id)?.acceptsCustomerChildren) fail("FOREIGN_PARENT", `Customer navigation ${node.id} uses a closed plugin parent.`);
    } else if (node.owner.kind === "customer" && parent.owner.kind !== "customer") {
      fail("FOREIGN_PARENT", `Customer navigation ${node.id} crosses owner boundaries.`);
    }
  }
}

function uniquePreferenceIds(values: readonly string[]): readonly string[] { return Object.freeze([...new Set(values)]); }

function implementedSystemRoutes(ids: readonly string[]): readonly (typeof fixedRoutes)[number][] {
  if (!Array.isArray(ids)) fail("INPUT_INVALID", "Implemented System route IDs are invalid.");
  const selected = new Set<string>();
  let previous = -1;
  for (const id of ids) {
    const index = fixedRoutes.findIndex(([routeId]) => routeId === id);
    if (typeof id !== "string" || index < 0) fail("INPUT_INVALID", "Implemented System route IDs are invalid.");
    if (selected.has(id)) fail("DUPLICATE_ROUTE", `Duplicate workspace identity ${id}.`);
    if (index <= previous) fail("INPUT_INVALID", "Implemented System route IDs are invalid.");
    selected.add(id);
    previous = index;
  }
  return fixedRoutes.filter(([routeId]) => selected.has(routeId));
}

export async function resolveWorkspaceNavigation(input: ResolveWorkspaceNavigationInput): Promise<ResolvedWorkspaceNavigation> {
  if (typeof input.authorize !== "function" || typeof input.pageAccess !== "function") fail("INPUT_INVALID", "Workspace authority ports are required.");
  validatePreferences(input.preferences);
  const systemRoutes = implementedSystemRoutes(input.implementedSystemRouteIds);
  const nodes = new Map<string, WorkspaceNavigationNode>();
  const routes = new Map<string, ResolvedWorkspaceRoute & { readonly permissionId: string }>();
  const routeIds = new Map<string, string>();
  const sections = new Map<string, WorkspacePluginNavigationSection>();

  register(nodes, "k-nex.navigation.root", WorkspaceNavigationNodeSchema.parse({ id: "k-nex.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "K-Nex", icon: "dashboard", order: 0 }), "DUPLICATE_ID");
  register(nodes, "system.navigation.root", WorkspaceNavigationNodeSchema.parse({ id: "system.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "System", icon: "system", order: 1_000_000 }), "DUPLICATE_ID");
  for (const [routeId, href, permissionId, label, icon, parentId, id, order] of systemRoutes) {
    const target = { class: "system" as const, routeId };
    register(routeIds, routeId, href, "DUPLICATE_ROUTE");
    register(routes, targetKey(target), { target, href, permissionId }, "DUPLICATE_ROUTE");
    register(nodes, id, WorkspaceNavigationNodeSchema.parse({ id, owner: { kind: "platform" }, kind: "link", parentId, label, ...(icon === undefined ? {} : { icon }), order, target }), "DUPLICATE_ID");
  }

  for (const section of input.plugins) {
    if (!section.active) fail("PLUGIN_INACTIVE", `Plugin navigation owner ${section.pluginId} is inactive.`);
    if (sections.has(section.id) || [...sections.values()].some(({ pluginId }) => pluginId === section.pluginId)) fail("DUPLICATE_ID", `Plugin section ${section.id} is duplicate.`);
    sections.set(section.id, section);
    register(nodes, section.id, WorkspaceNavigationNodeSchema.parse({ id: section.id, owner: { kind: "platform-plugin", pluginId: section.pluginId }, kind: "folder", label: section.label, ...(section.icon === undefined ? {} : { icon: section.icon }), order: section.order }), "DUPLICATE_ID");
    const sectionRoutes = new Map<string, PluginRouteDescriptor>();
    for (const rawRoute of section.routes) {
      const parsed = PluginRouteDescriptorSchema.safeParse(rawRoute);
      if (!parsed.success || parsed.data.ownerPluginId !== section.pluginId) fail("INPUT_INVALID", `Plugin route in ${section.pluginId} is invalid.`);
      register(sectionRoutes, parsed.data.id, parsed.data, "DUPLICATE_ROUTE");
      register(routeIds, parsed.data.id, parsed.data.path, "DUPLICATE_ROUTE");
    }
    const descriptors = new Map<string, PluginNavigationDescriptor>();
    for (const rawNavigation of section.navigation) {
      const parsed = PluginNavigationDescriptorSchema.safeParse(rawNavigation);
      if (!parsed.success || parsed.data.ownerPluginId !== section.pluginId) fail("INPUT_INVALID", `Plugin navigation in ${section.pluginId} is invalid.`);
      register(descriptors, parsed.data.id, parsed.data, "DUPLICATE_ID");
    }
    for (const descriptor of descriptors.values()) {
      const route = sectionRoutes.get(descriptor.route.routeId);
      if (route === undefined) fail("ROUTE_MISSING", `Navigation route ${descriptor.route.routeId} is missing.`);
      const target = { class: "platform-plugin" as const, ownerPluginId: section.pluginId, routeId: route.id };
      const href = routeHref(route, descriptor.route.params);
      const label = section.messages[descriptor.labelMessageId];
      if (typeof label !== "string" || label.length < 1 || label.length > 120) fail("INPUT_INVALID", `Navigation label ${descriptor.labelMessageId} is unavailable.`);
      const parentId = descriptor.parentId ?? section.id;
      register(nodes, descriptor.id, WorkspaceNavigationNodeSchema.parse({ id: descriptor.id, owner: { kind: "platform-plugin", pluginId: section.pluginId }, kind: "link", parentId, label, order: descriptor.order, target }), "DUPLICATE_ID");
      register(routes, targetKey(target), { target, href, permissionId: route.permission === descriptor.permission ? route.permission : `${route.permission}\0${descriptor.permission}` }, "DUPLICATE_ROUTE");
    }
  }

  for (const rawFolder of input.customerFolders) {
    const folder = WorkspaceNavigationNodeSchema.safeParse(rawFolder);
    if (!folder.success || folder.data.owner.kind !== "customer" || folder.data.kind !== "folder") fail("INPUT_INVALID", "Customer navigation folder is invalid.");
    register(nodes, folder.data.id, folder.data, "DUPLICATE_ID");
  }

  const pages = new Map<string, WorkspacePage>();
  for (const rawPage of input.pages) {
    const parsed = WorkspacePageSchema.safeParse(rawPage);
    if (!parsed.success || parsed.data.identity.applicationId !== input.applicationId || parsed.data.identity.environment !== input.environment) fail("INPUT_INVALID", "Workspace page navigation identity is invalid.");
    register(pages, parsed.data.identity.pageId, parsed.data, "DUPLICATE_ID");
    if (parsed.data.state === "archived" || parsed.data.navigation.state === "unplaced") continue;
    const target = { class: "workspace-page" as const, pageId: parsed.data.identity.pageId, mode: "view" as const };
    const href = `/workspace/pages/${encodeURIComponent(parsed.data.identity.pageId)}`;
    register(nodes, parsed.data.identity.pageId, WorkspaceNavigationNodeSchema.parse({ id: parsed.data.identity.pageId, owner: { kind: "customer" }, kind: "link", parentId: parsed.data.navigation.parentNavigationId, label: parsed.data.title, order: parsed.data.navigation.order, target }), "DUPLICATE_ID");
    register(routes, targetKey(target), { target, href, permissionId: "system.workspace-pages.read" }, "DUPLICATE_ROUTE");
  }

  assertParentOwnership(nodes, sections);
  const completeTree = WorkspaceNavigationTreeSchema.safeParse({ schemaVersion: 1, applicationId: input.applicationId, environment: input.environment, revision: input.revision, nodes: [...nodes.values()] });
  if (!completeTree.success) fail("INPUT_INVALID", "Workspace navigation tree is invalid.");

  const visibleLinks = new Set<string>();
  const visibleRoutes = new Map<string, ResolvedWorkspaceRoute>();
  const hrefs = new Map<string, string>();
  for (const node of completeTree.data.nodes) {
    if (node.kind !== "link" || node.target === undefined) continue;
    const route = routes.get(targetKey(node.target));
    if (route === undefined) fail("ROUTE_MISSING", `Workspace route for ${node.id} is missing.`);
    const permissions = route.permissionId.split("\0");
    const allowed = (await Promise.all(permissions.map((permissionId) => input.authorize(permissionId, route.target)))).every(Boolean) &&
      (route.target.class !== "workspace-page" || await input.pageAccess(route.target.pageId));
    if (!allowed) continue;
    const existing = hrefs.get(route.href);
    if (existing !== undefined && existing !== targetKey(route.target)) fail("ROUTE_PATH_CONFLICT", `Workspace route path ${route.href} is ambiguous.`);
    hrefs.set(route.href, targetKey(route.target));
    visibleLinks.add(node.id);
    visibleRoutes.set(targetKey(route.target), { target: route.target, href: route.href });
  }

  const visibleNodes = new Set(visibleLinks);
  for (const id of visibleLinks) {
    let parentId = nodes.get(id)?.parentId;
    while (parentId !== undefined) { visibleNodes.add(parentId); parentId = nodes.get(parentId)?.parentId; }
  }
  visibleNodes.add("system.navigation.root");
  const tree = WorkspaceNavigationTreeSchema.parse({ schemaVersion: 1, applicationId: input.applicationId, environment: input.environment, revision: input.revision,
    nodes: completeTree.data.nodes.filter(({ id }) => visibleNodes.has(id)).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)) });
  const shortcut = (pageId: string): ResolvedWorkspaceShortcut | undefined => {
    const page = pages.get(pageId);
    const route = visibleRoutes.get(targetKey({ class: "workspace-page", pageId, mode: "view" }));
    return page === undefined || route === undefined ? undefined : Object.freeze({ pageId, label: page.title, href: route.href });
  };
  return Object.freeze({
    tree,
    routes: Object.freeze([...visibleRoutes.values()].sort((left, right) => left.href.localeCompare(right.href))),
    favorites: Object.freeze(uniquePreferenceIds(input.preferences.favoritePageIds).flatMap((id) => shortcut(id) ?? [])),
    recent: Object.freeze(uniquePreferenceIds(input.preferences.recentPageIds).flatMap((id) => shortcut(id) ?? [])),
    sidebar: input.preferences.sidebar
  });
}

export function resolveAuthorizedWorkspacePath(navigation: ResolvedWorkspaceNavigation, pathname: string): ResolvedWorkspaceRoute | undefined {
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#")) return undefined;
  return navigation.routes.find(({ href }) => href === pathname);
}
