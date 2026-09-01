import { HotApplicationConcreteRouteSchema, HotApplicationIdSchema, hotApplicationHostRouteTemplate, isHotApplicationRouteLiteralSegment, matchHotApplicationRoute } from "@k-nex/contracts";

export interface HotApplicationSurfaceRegistration {
  readonly appId: string;
  readonly generationId: string;
  readonly active: boolean;
  /** Signed app-relative route templates. */
  readonly routes: readonly string[];
  /** Concrete host pathnames derived from the signed templates. */
  readonly navigation: readonly Readonly<{ id: string; title: string; route: string }>[];
  readonly slots: readonly Readonly<{ slotId: string; contributionId: string }>[];
}

export class HotApplicationSurfaceError extends Error {
  constructor(readonly code: "ROUTE_INVALID" | "APP_UNAVAILABLE" | "ROUTE_UNAVAILABLE" | "DUPLICATE_CONTRIBUTION", message: string) {
    super(message);
    this.name = "HotApplicationSurfaceError";
  }
}

const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function validate(registration: HotApplicationSurfaceRegistration): void {
  if (!HotApplicationIdSchema.safeParse(registration.appId).success || !/^[a-z][a-z0-9-]{2,127}$/u.test(registration.generationId) || registration.routes.some((route) => hotApplicationHostRouteTemplate(registration.appId, route) === undefined) ||
    registration.navigation.some((item) => !idPattern.test(item.id) || item.title.length < 1 || item.title.length > 120 || !HotApplicationConcreteRouteSchema.safeParse(item.route).success || !registration.routes.some((route) => matchHotApplicationRoute(registration.appId, route, item.route))) ||
    registration.slots.some((item) => !idPattern.test(item.slotId) || !idPattern.test(item.contributionId))) throw new HotApplicationSurfaceError("ROUTE_INVALID", "Hot Application surface registration is invalid.");
}

export function resolveHotApplicationRoute(pathname: string, registrations: readonly HotApplicationSurfaceRegistration[]): Readonly<{ appId: string; generationId: string; route: string }> {
  if (!HotApplicationConcreteRouteSchema.safeParse(pathname).success) throw new HotApplicationSurfaceError("ROUTE_INVALID", "Hot Application route is invalid.");
  const matches = registrations.filter((registration) => {
    validate(registration);
    return registration.active && registration.routes.some((route) => matchHotApplicationRoute(registration.appId, route, pathname));
  });
  if (matches.length === 0) throw new HotApplicationSurfaceError("ROUTE_UNAVAILABLE", "Hot Application route is unavailable.");
  if (matches.length > 1) throw new HotApplicationSurfaceError("DUPLICATE_CONTRIBUTION", "Hot Application route ownership is ambiguous.");
  return Object.freeze({ appId: matches[0]!.appId, generationId: matches[0]!.generationId, route: pathname });
}

/** Resolves the preinstalled `/apps/:appId/*` host route without runtime route injection. */
export function resolveHotApplicationFixedRoute(appRouteId: string, segments: readonly string[] | undefined, registrations: readonly HotApplicationSurfaceRegistration[]): Readonly<{ appId: string; generationId: string; route: string }> {
  if (!HotApplicationIdSchema.safeParse(`app.${appRouteId}`).success || segments?.some((segment) => !isHotApplicationRouteLiteralSegment(segment))) {
    throw new HotApplicationSurfaceError("ROUTE_INVALID", "Fixed Hot Application route parameters are invalid.");
  }
  return resolveHotApplicationRoute(`/apps/${[appRouteId, ...(segments ?? [])].join("/")}`, registrations);
}

export function resolveHotApplicationNavigation(registrations: readonly HotApplicationSurfaceRegistration[]): readonly Readonly<{ appId: string; id: string; title: string; route: string }>[] {
  const seen = new Set<string>();
  return Object.freeze(registrations.flatMap((registration) => {
    validate(registration);
    if (!registration.active) return [];
    return registration.navigation.map((item) => {
      if (seen.has(item.id)) throw new HotApplicationSurfaceError("DUPLICATE_CONTRIBUTION", "Hot Application navigation identity is ambiguous.");
      seen.add(item.id);
      return Object.freeze({ appId: registration.appId, ...item });
    });
  }));
}

export function resolveHotApplicationSlot(slotId: string, registrations: readonly HotApplicationSurfaceRegistration[]): readonly Readonly<{ appId: string; generationId: string; contributionId: string }>[] {
  if (!idPattern.test(slotId)) throw new HotApplicationSurfaceError("ROUTE_INVALID", "Extension slot identity is invalid.");
  const seen = new Set<string>();
  return Object.freeze(registrations.flatMap((registration) => {
    validate(registration);
    if (!registration.active) return [];
    return registration.slots.filter((item) => item.slotId === slotId).map((item) => {
      if (seen.has(item.contributionId)) throw new HotApplicationSurfaceError("DUPLICATE_CONTRIBUTION", "Extension slot contribution identity is ambiguous.");
      seen.add(item.contributionId);
      return Object.freeze({ appId: registration.appId, generationId: registration.generationId, contributionId: item.contributionId });
    });
  }));
}
