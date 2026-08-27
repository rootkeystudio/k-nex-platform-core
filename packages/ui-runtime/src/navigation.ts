import {
  PluginNavigationDescriptorSchema,
  PluginRouteDescriptorSchema,
  type PluginNavigationDescriptor,
  type PluginRouteDescriptor,
  type PluginRouteParameterValue
} from "@k-nex/contracts";

export type NavigationResolutionErrorCode =
  | "DESCRIPTOR_INVALID"
  | "DUPLICATE_ID"
  | "NAVIGATION_OWNER_UNINSTALLED"
  | "PARENT_UNAVAILABLE"
  | "PARENT_CYCLE"
  | "ROUTE_OWNER_UNINSTALLED"
  | "ROUTE_PARAMETERS_INVALID"
  | "ROUTE_TARGET_UNAVAILABLE";

export class NavigationResolutionError extends Error {
  constructor(readonly code: NavigationResolutionErrorCode, message: string, readonly path: readonly string[] = []) {
    super(message);
    this.name = "NavigationResolutionError";
  }
}

export interface NavigationActor {
  readonly authenticated: boolean;
  readonly permissions: ReadonlySet<string>;
}

export interface ResolvedNavigationItem {
  readonly id: string;
  readonly labelMessageId: string;
  readonly href: string;
  readonly parentId?: string;
  readonly order: number;
  readonly routeId: string;
}

export interface ResolvePluginNavigationInput {
  readonly installedPluginIds: ReadonlySet<string>;
  readonly routes: readonly PluginRouteDescriptor[];
  readonly navigation: readonly PluginNavigationDescriptor[];
  readonly actor: NavigationActor;
}

function fail(code: NavigationResolutionErrorCode, message: string, path: readonly string[] = []): never {
  throw new NavigationResolutionError(code, message, Object.freeze([...path]));
}

function uniqueById<T extends { readonly id: string }>(values: readonly T[], label: string): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) fail("DUPLICATE_ID", `Duplicate ${label} ID ${value.id}.`, [value.id]);
    result.set(value.id, value);
  }
  return result;
}

function parameterMatches(type: PluginRouteDescriptor["parameters"][string]["type"], value: PluginRouteParameterValue): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  return typeof value === "boolean";
}

function resolveHref(route: PluginRouteDescriptor, params: Readonly<Record<string, PluginRouteParameterValue>>): string {
  const expected = Object.keys(route.parameters).sort();
  const actual = Object.keys(params).sort();
  if (expected.join("\u0000") !== actual.join("\u0000")) {
    fail("ROUTE_PARAMETERS_INVALID", `Route ${route.id} parameters do not match its contract.`, [route.id]);
  }
  for (const key of expected) {
    const value = params[key];
    const parameter = route.parameters[key];
    if (value === undefined || parameter === undefined || !parameterMatches(parameter.type, value)) {
      fail("ROUTE_PARAMETERS_INVALID", `Route ${route.id} parameter ${key} has an invalid type.`, [route.id, key]);
    }
  }
  return route.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_match, key: string) => encodeURIComponent(String(params[key])));
}

function assertParentGraph(navigation: ReadonlyMap<string, PluginNavigationDescriptor>): void {
  for (const item of navigation.values()) {
    if (item.parentId !== undefined && !navigation.has(item.parentId)) {
      fail("PARENT_UNAVAILABLE", `Navigation parent ${item.parentId} is unavailable.`, [item.id, item.parentId]);
    }
    const visited = new Set<string>([item.id]);
    let parentId = item.parentId;
    while (parentId !== undefined) {
      if (visited.has(parentId)) fail("PARENT_CYCLE", `Navigation item ${item.id} has a parent cycle.`, [item.id]);
      visited.add(parentId);
      parentId = navigation.get(parentId)?.parentId;
    }
  }
}

export function resolvePluginNavigation(input: ResolvePluginNavigationInput): readonly ResolvedNavigationItem[] {
  const routes = input.routes.map((route) => {
    const parsed = PluginRouteDescriptorSchema.safeParse(route);
    if (!parsed.success) fail("DESCRIPTOR_INVALID", `Route descriptor ${route.id} is invalid.`, [route.id]);
    if (!input.installedPluginIds.has(parsed.data.ownerPluginId)) {
      fail("ROUTE_OWNER_UNINSTALLED", `Route owner ${parsed.data.ownerPluginId} is not installed.`, [parsed.data.id]);
    }
    return parsed.data;
  });
  const navigation = input.navigation.map((item) => {
    const parsed = PluginNavigationDescriptorSchema.safeParse(item);
    if (!parsed.success) fail("DESCRIPTOR_INVALID", `Navigation descriptor ${item.id} is invalid.`, [item.id]);
    if (!input.installedPluginIds.has(parsed.data.ownerPluginId)) {
      fail("NAVIGATION_OWNER_UNINSTALLED", `Navigation owner ${parsed.data.ownerPluginId} is not installed.`, [parsed.data.id]);
    }
    return parsed.data;
  });
  const routesById = uniqueById(routes, "route");
  const navigationById = uniqueById(navigation, "navigation");
  assertParentGraph(navigationById);

  const permitted = new Map([...navigationById.values()].map((item) => {
    const route = routesById.get(item.route.routeId);
    if (route === undefined) fail("ROUTE_TARGET_UNAVAILABLE", `Navigation route ${item.route.routeId} is unavailable.`, [item.id, item.route.routeId]);
    resolveHref(route, item.route.params);
    return [item.id, (route.audience === "public" || input.actor.authenticated) &&
      input.actor.permissions.has(route.permission) && input.actor.permissions.has(item.permission)] as const;
  }));
  const visible = (item: PluginNavigationDescriptor): boolean => {
    if (!permitted.get(item.id)) return false;
    return item.parentId === undefined || visible(navigationById.get(item.parentId)!);
  };

  return Object.freeze([...navigationById.values()].flatMap((item) => {
    if (!visible(item)) return [];
    const route = routesById.get(item.route.routeId)!;
    const href = resolveHref(route, item.route.params);
    return [Object.freeze({
      id: item.id,
      labelMessageId: item.labelMessageId,
      href,
      ...(item.parentId === undefined ? {} : { parentId: item.parentId }),
      order: item.order,
      routeId: route.id
    })];
  }).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
}
