import {
  ExactSemverSchema,
  PluginIdSchema,
  ResourceIdSchema,
  compareExactSemverPrecedence,
  type AuthorizationDecision,
  type AuthorizationState,
  type ExtensionAdministrationActionView,
  type RuntimeExtensionInventory,
  type ThemeProfile
} from "@k-nex/contracts";

import { projectExtensionAdministrationActions } from "./system-extension-administration.js";
import type { ExtensionCatalogRecord } from "./extension-operator-api.js";
import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "./current-authority-adapter.js";

export interface SystemThemePackageDescriptor {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly surfaces: readonly ("admin" | "public")[];
  readonly availability: "installed" | "available";
}

export interface SystemThemeProfileSnapshot {
  readonly profileId: string;
  readonly revision: number;
  readonly active?: ThemeProfile;
  readonly previous?: ThemeProfile;
  readonly draft?: ThemeProfile;
}

export interface SystemThemeProfileReference {
  readonly profileId: string;
  readonly state: "active" | "previous" | "draft";
  readonly profileRevisionId: string;
}

export interface SystemThemePackageView extends SystemThemePackageDescriptor {
  readonly class: "package";
  readonly references: readonly SystemThemeProfileReference[];
  readonly removal: "available" | "blocked";
}

export interface SystemThemeSkinView {
  readonly class: "skin";
  readonly id: string;
  readonly disposition: "available" | "active" | "disabled" | "quarantined" | "retirement-pending" | "removed";
  readonly version?: string;
  readonly generationId?: string;
  readonly actions: readonly ExtensionAdministrationActionView[];
}

export interface SystemThemeProfileView extends SystemThemeProfileSnapshot {
  readonly class: "profile";
}

export interface SystemThemeAdministrationView {
  readonly packages: readonly SystemThemePackageView[];
  readonly skins: readonly SystemThemeSkinView[];
  readonly profiles: readonly SystemThemeProfileView[];
}

export interface SystemThemeProfileOperator {
  list(owner: Readonly<{ applicationId: string; environment: string }>): Promise<readonly SystemThemeProfileSnapshot[]>;
  read(owner: Readonly<{ applicationId: string; environment: string; profileId: string }>): Promise<SystemThemeProfileSnapshot | undefined>;
  preview(input: Readonly<{ applicationId: string; environment: string; profile: unknown; expectedRevision: number }>): Promise<unknown>;
  stageDraft(input: Readonly<{ applicationId: string; environment: string; profile: unknown }>): Promise<SystemThemeProfileSnapshot>;
  publish(input: Readonly<{ applicationId: string; environment: string; profile: unknown; expectedRevision: number }>): Promise<unknown>;
  rollback(input: Readonly<{ applicationId: string; environment: string; profileId: string; expectedRevision: number }>): Promise<unknown>;
}

export interface SystemThemeAdministrationCatalogSource {
  read(applicationId: string, environment: string): Promise<Readonly<{ packages: readonly SystemThemePackageDescriptor[]; inventory: RuntimeExtensionInventory; catalog: readonly ExtensionCatalogRecord[] }>>;
}

export class SystemThemeAdministrationError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "REQUEST_INVALID" | "REVISION_CONFLICT" | "SOURCE_UNAVAILABLE", message: string) { super(message); this.name = "SystemThemeAdministrationError"; }
}

const themeReadTarget = createCurrentAuthorityTarget({ permissionId: "system.themes.read", scope: { kind: "application", resource: "system.themes" }, facts: { boundary: "system-theme-administration" } });
const themeManageTarget = createCurrentAuthorityTarget({ permissionId: "system.themes.manage", scope: { kind: "application", resource: "system.themes" }, facts: { boundary: "system-theme-administration" } });

export class SystemThemeAdministrationService<TContext> {
  constructor(private readonly options: Readonly<{
    authority: CurrentAuthorityAdapter<TContext>;
    state: { readState(applicationId: string, environment: string): Promise<AuthorizationState | undefined> };
    profiles: { resolve(context: TContext): Promise<SystemThemeProfileOperator | undefined> | SystemThemeProfileOperator | undefined };
    catalog: SystemThemeAdministrationCatalogSource;
  }>) {}

  async list(input: Readonly<{ context: TContext }>): Promise<SystemThemeAdministrationView> {
    exactThemeInput(input, ["context"]);
    const decision = await this.authorize(input.context, "read");
    const profiles = await this.operator(input.context);
    const [snapshots, source] = await Promise.all([profiles.list(owner(decision)), this.options.catalog.read(decision.applicationId, decision.environment)]);
    const view = projectSystemThemeAdministration({ ...source, profiles: snapshots });
    await this.confirm(input.context, decision, "read");
    return view;
  }

  async detail(input: Readonly<{ context: TContext; profileId: string }>): Promise<SystemThemeProfileSnapshot | undefined> {
    exactThemeInput(input, ["context", "profileId"]);
    if (!ResourceIdSchema.safeParse(input.profileId).success) invalidTheme();
    const decision = await this.authorize(input.context, "read");
    const value = await (await this.operator(input.context)).read({ ...owner(decision), profileId: input.profileId });
    await this.confirm(input.context, decision, "read");
    return value;
  }

  async preview(input: Readonly<{ context: TContext; profile: unknown; expectedRevision: number }>): Promise<unknown> { return this.mutate(input, "preview"); }
  async stage(input: Readonly<{ context: TContext; profile: unknown }>): Promise<SystemThemeProfileSnapshot> { return this.mutate(input, "stage") as Promise<SystemThemeProfileSnapshot>; }
  async publish(input: Readonly<{ context: TContext; profile: unknown; expectedRevision: number }>): Promise<unknown> { return this.mutate(input, "publish"); }
  async rollback(input: Readonly<{ context: TContext; profileId: string; expectedRevision: number }>): Promise<unknown> { return this.mutate(input, "rollback"); }

  private async mutate(input: Readonly<Record<string, unknown> & { context: TContext }>, operation: "preview" | "stage" | "publish" | "rollback"): Promise<unknown> {
    exactThemeInput(input, operation === "stage" ? ["context", "profile"] : operation === "rollback" ? ["context", "expectedRevision", "profileId"] : ["context", "expectedRevision", "profile"]);
    const decision = await this.authorize(input.context, "manage");
    const operator = await this.operator(input.context);
    const scope = owner(decision);
    await this.confirm(input.context, decision, "manage");
    let result: unknown;
    if (operation === "stage") result = await operator.stageDraft({ ...scope, profile: input.profile });
    else if (operation === "rollback") {
      if (!ResourceIdSchema.safeParse(input.profileId).success || !revision(input.expectedRevision)) invalidTheme();
      result = await operator.rollback({ ...scope, profileId: input.profileId as string, expectedRevision: input.expectedRevision as number });
    } else {
      if (!revision(input.expectedRevision)) invalidTheme();
      result = operation === "preview" ? await operator.preview({ ...scope, profile: input.profile, expectedRevision: input.expectedRevision as number })
        : await operator.publish({ ...scope, profile: input.profile, expectedRevision: input.expectedRevision as number });
    }
    return result;
  }

  private async authorize(context: TContext, operation: "read" | "manage"): Promise<AuthorizationDecision> {
    const target = operation === "read" ? themeReadTarget : themeManageTarget;
    const decision = await this.options.authority.authorize(context, target);
    if (decision?.outcome !== "allow" || decision.permissionId !== target.permissionId || decision.scope.kind !== "application" || decision.scope.resource !== "system.themes") unauthorizedTheme();
    const state = await this.options.state.readState(decision.applicationId, decision.environment);
    if (!state || state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision) conflictTheme();
    return decision;
  }

  private async confirm(context: TContext, initial: AuthorizationDecision, operation: "read" | "manage"): Promise<void> {
    const current = await this.authorize(context, operation);
    if (current.decisionId !== initial.decisionId || current.applicationId !== initial.applicationId || current.environment !== initial.environment || current.authorizationRevision !== initial.authorizationRevision || current.lifecycleRevision !== initial.lifecycleRevision) conflictTheme();
  }

  private async operator(context: TContext): Promise<SystemThemeProfileOperator> {
    try { const value = await this.options.profiles.resolve(context); if (value) return value; } catch {}
    throw new SystemThemeAdministrationError("SOURCE_UNAVAILABLE", "Theme Profile authority is unavailable.");
  }
}

export function projectSystemThemeAdministration(input: Readonly<{
  readonly packages: readonly SystemThemePackageDescriptor[];
  readonly profiles: readonly SystemThemeProfileSnapshot[];
  readonly inventory: RuntimeExtensionInventory;
  readonly catalog: readonly ExtensionCatalogRecord[];
}>): SystemThemeAdministrationView {
  const profiles = input.profiles.map((profile) => Object.freeze({ class: "profile" as const, ...profile }));
  const packages = input.packages.map((themePackage) => {
    if (!PluginIdSchema.safeParse(themePackage.id).success || !themePackage.id.startsWith("theme.") ||
      !ExactSemverSchema.safeParse(themePackage.version).success || themePackage.displayName.length === 0 ||
      themePackage.surfaces.length === 0 || themePackage.surfaces.some((surface) => surface !== "admin" && surface !== "public") ||
      new Set(themePackage.surfaces).size !== themePackage.surfaces.length) {
      throw new TypeError("Theme Package administration descriptor is invalid.");
    }
    const references = profiles.flatMap((profile) => profileReferences(profile, themePackage.id, themePackage.version));
    return Object.freeze({
      class: "package" as const,
      ...themePackage,
      surfaces: Object.freeze([...themePackage.surfaces]),
      references: Object.freeze(references),
      removal: references.length === 0 ? "available" as const : "blocked" as const
    });
  }).sort((left, right) => `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`));

  const actions = projectExtensionAdministrationActions(input.inventory, input.catalog);
  const catalogSkins = input.catalog.filter((record) => record.extension.deliveryClass === "theme-skin");
  const skinIds = new Set([...Object.keys(input.inventory.extensions.themeSkins), ...catalogSkins.map((record) => record.extension.id)]);
  const skins = [...skinIds].sort().map((id): SystemThemeSkinView => {
    const entry = input.inventory.extensions.themeSkins[id];
    const release = catalogSkins.filter((record) => record.extension.id === id).sort((left, right) => compareExactSemverPrecedence(right.version, left.version))[0];
    const generation = entry?.disposition === "active" ? entry.activeGeneration
      : entry && "retainedGeneration" in entry ? entry.retainedGeneration : undefined;
    const version = generation?.version ?? release?.version;
    return Object.freeze({
      class: "skin",
      id,
      disposition: entry?.disposition ?? "available",
      ...(version ? { version } : {}),
      ...(generation ? { generationId: generation.generationId } : {}),
      actions: Object.freeze(actions.filter((action) => action.deliveryClass === "theme-skin" && action.id === id))
    });
  });

  return Object.freeze({ packages: Object.freeze(packages), skins: Object.freeze(skins), profiles: Object.freeze(profiles) });
}

function profileReferences(profile: SystemThemeProfileView, themeId: string, themeVersion: string): SystemThemeProfileReference[] {
  const references: SystemThemeProfileReference[] = [];
  for (const state of ["active", "previous", "draft"] as const) {
    const value = profile[state];
    if (value?.themeId === themeId && value.themeVersion === themeVersion) {
      references.push(Object.freeze({ profileId: profile.profileId, state, profileRevisionId: value.revision.id }));
    }
  }
  return references;
}

function exactThemeInput(value: unknown, keys: readonly string[]): void { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) invalidTheme(); }
function owner(decision: AuthorizationDecision): Readonly<{ applicationId: string; environment: string }> { return Object.freeze({ applicationId: decision.applicationId, environment: decision.environment }); }
function revision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999; }
function invalidTheme(): never { throw new SystemThemeAdministrationError("REQUEST_INVALID", "Theme administration input is invalid."); }
function conflictTheme(): never { throw new SystemThemeAdministrationError("REVISION_CONFLICT", "Theme administration authority changed."); }
function unauthorizedTheme(): never { throw new SystemThemeAdministrationError("UNAUTHORIZED", "Current authority does not permit theme administration."); }
