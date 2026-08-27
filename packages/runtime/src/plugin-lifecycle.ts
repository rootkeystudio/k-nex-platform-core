import {
  PluginManifestSchema,
  ResourceIdSchema,
  pluginContributionCategoryKeys,
  type PluginContributionCategory,
  type PluginManifest
} from "@k-nex/contracts";

import type { RegistrationResult } from "./registration-runtime.js";

export type PluginLifecycleErrorCode =
  | "INVALID_STATE" | "PACKAGE_MISMATCH" | "NOT_READY" | "OPERATION_UNSUPPORTED" | "REFERENCES_PRESENT";

export class PluginLifecycleError extends Error {
  constructor(readonly code: PluginLifecycleErrorCode, message: string) {
    super(message);
    this.name = "PluginLifecycleError";
  }
}

export interface PluginPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface PluginLifecycleState {
  readonly pluginId: string;
  readonly catalogStatus: "supported" | "unsupported";
  readonly package: { readonly status: "absent" } | ({ readonly status: "installed" } & PluginPackageIdentity);
  readonly enabled: boolean;
  readonly configuration: { readonly revision: number; readonly ready: boolean };
  readonly migration: { readonly current: number; readonly required: number; readonly ready: boolean };
  readonly dataState: "none" | "active" | "retained";
  readonly releaseStatus: "supported" | "unsupported";
}

export interface PluginInstallPlan {
  readonly operation: "install" | "enable" | "noop";
  readonly packageChange: PluginPackageIdentity | null;
  readonly requiresDeployment: true;
  readonly seedTemplateIds: readonly string[];
}

export interface PluginAvailability {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly ready: boolean;
  isAvailable(kind: PluginContributionCategory, id: string): boolean;
  readonly contributions: Readonly<Partial<Record<PluginContributionCategory, readonly string[]>>>;
}

export interface PluginReference {
  readonly kind: "dependency" | "document" | "event" | "integration" | "job";
  readonly id: string;
  readonly pluginId: string;
}

const retainedWhileDisabled = new Set<PluginContributionCategory>([
  "healthAudit", "lifecycle", "migrations", "schema", "settings", "testingMetadata"
]);

function fail(code: PluginLifecycleErrorCode, message: string): never {
  throw new PluginLifecycleError(code, message);
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertPackageIdentity(identity: PluginPackageIdentity): void {
  if (!identity.name.startsWith("@") || identity.name.length > 214 || identity.version.length < 1 || identity.version.length > 128 ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(identity.integrity)) {
    fail("INVALID_STATE", "Plugin package identity is invalid.");
  }
}

function assertState(state: PluginLifecycleState): void {
  ResourceIdSchema.parse(state.pluginId);
  if (!validRevision(state.configuration.revision) || !validRevision(state.migration.current) || !validRevision(state.migration.required)) {
    fail("INVALID_STATE", "Plugin lifecycle revisions must be non-negative safe integers.");
  }
  if (state.package.status === "installed") assertPackageIdentity(state.package);
  if (state.package.status === "absent" && (state.enabled || state.dataState === "active")) {
    fail("INVALID_STATE", "An absent plugin package cannot be enabled or own active data.");
  }
  if (state.enabled && state.dataState === "retained") fail("INVALID_STATE", "Enabled plugin data cannot remain in retained state.");
}

export function createPluginLifecycleState(state: PluginLifecycleState): PluginLifecycleState {
  assertState(state);
  return Object.freeze({
    ...state,
    package: Object.freeze({ ...state.package }),
    configuration: Object.freeze({ ...state.configuration }),
    migration: Object.freeze({ ...state.migration })
  });
}

function parsedManifest(value: PluginManifest): PluginManifest {
  return PluginManifestSchema.parse(value);
}

export function pluginReadyForEnable(state: PluginLifecycleState): boolean {
  assertState(state);
  return state.catalogStatus === "supported" && state.releaseStatus === "supported" &&
    state.package.status === "installed" && state.configuration.ready && state.migration.ready &&
    state.migration.current === state.migration.required;
}

export function planPluginInstall(input: {
  readonly manifest: PluginManifest;
  readonly package: PluginPackageIdentity;
  readonly state?: PluginLifecycleState;
  readonly existingTemplateIds?: readonly string[];
}): PluginInstallPlan {
  const manifest = parsedManifest(input.manifest);
  assertPackageIdentity(input.package);
  if (input.package.name !== manifest.package || input.package.version !== manifest.version) {
    fail("PACKAGE_MISMATCH", "Install plan package identity does not match the plugin manifest.");
  }
  if (input.state !== undefined) {
    assertState(input.state);
    if (input.state.pluginId !== manifest.id) fail("PACKAGE_MISMATCH", "Install plan state belongs to another plugin.");
    if (input.state.package.status === "installed" &&
      (input.state.package.name !== input.package.name || input.state.package.version !== input.package.version || input.state.package.integrity !== input.package.integrity)) {
      fail("PACKAGE_MISMATCH", "Package upgrade planning is deferred to Gate 8.");
    }
  }
  const existing = new Set(input.existingTemplateIds ?? []);
  const seedTemplateIds = Object.keys(manifest.contributions?.pageTemplates ?? {}).filter((id) => !existing.has(id)).sort();
  const operation = input.state?.package.status !== "installed" ? "install" : input.state.enabled ? "noop" : "enable";
  return Object.freeze({
    operation,
    packageChange: operation === "install" ? Object.freeze({ ...input.package }) : null,
    requiresDeployment: true,
    seedTemplateIds: Object.freeze(seedTemplateIds)
  });
}

export function disablePlugin(state: PluginLifecycleState, manifestValue: PluginManifest): PluginLifecycleState {
  const manifest = parsedManifest(manifestValue);
  assertState(state);
  if (state.pluginId !== manifest.id) fail("PACKAGE_MISMATCH", "Lifecycle state belongs to another plugin.");
  if (manifest.lifecycle.disable !== "supported") fail("OPERATION_UNSUPPORTED", `Plugin ${manifest.id} does not support disable.`);
  return createPluginLifecycleState({ ...state, enabled: false, dataState: state.dataState === "none" ? "none" : "retained" });
}

export function reenablePlugin(state: PluginLifecycleState, manifestValue: PluginManifest): PluginLifecycleState {
  const manifest = parsedManifest(manifestValue);
  assertState(state);
  if (state.pluginId !== manifest.id) fail("PACKAGE_MISMATCH", "Lifecycle state belongs to another plugin.");
  if (manifest.lifecycle.disable !== "supported") fail("OPERATION_UNSUPPORTED", `Plugin ${manifest.id} does not support re-enable.`);
  if (!pluginReadyForEnable(state)) fail("NOT_READY", `Plugin ${manifest.id} is not ready to re-enable.`);
  return createPluginLifecycleState({ ...state, enabled: true, dataState: state.dataState === "none" ? "none" : "active" });
}

export function reconcilePluginAvailability(registration: RegistrationResult, state: PluginLifecycleState): PluginAvailability {
  assertState(state);
  const ready = pluginReadyForEnable(state);
  const available = new Map<PluginContributionCategory, Set<string>>();
  for (const kind of pluginContributionCategoryKeys) {
    const ids = registration.contributions[kind]
      .filter(({ pluginId }) => pluginId === state.pluginId)
      .map(({ id }) => id)
      .filter(() => state.package.status === "installed" && (state.enabled && ready || retainedWhileDisabled.has(kind)));
    if (ids.length > 0) available.set(kind, new Set(ids));
  }
  const contributions = Object.freeze(Object.fromEntries([...available].map(([kind, ids]) => [kind, Object.freeze([...ids].sort())])));
  return Object.freeze({
    pluginId: state.pluginId,
    enabled: state.enabled,
    ready,
    contributions,
    isAvailable(kind: PluginContributionCategory, id: string) { return available.get(kind)?.has(id) ?? false; }
  });
}

export function scopePluginRegistration(
  registration: RegistrationResult,
  availabilityValues: readonly PluginAvailability[]
): RegistrationResult {
  const availability = new Map<string, PluginAvailability>();
  for (const value of availabilityValues) {
    if (availability.has(value.pluginId)) fail("INVALID_STATE", `Plugin ${value.pluginId} has duplicate lifecycle availability.`);
    availability.set(value.pluginId, value);
  }
  const lifecycleOwners = new Set(registration.contributions.lifecycle.map(({ pluginId }) => pluginId));
  for (const pluginId of lifecycleOwners) {
    if (!availability.has(pluginId)) fail("NOT_READY", `Plugin ${pluginId} requires lifecycle availability before registration can execute.`);
  }
  const allowed = (kind: PluginContributionCategory, pluginId: string, id: string): boolean =>
    !lifecycleOwners.has(pluginId) || availability.get(pluginId)?.isAvailable(kind, id) === true;
  const contributions = Object.freeze(Object.fromEntries(pluginContributionCategoryKeys.map((kind) => [
    kind,
    Object.freeze(registration.contributions[kind].filter(({ pluginId, id }) => allowed(kind, pluginId, id)))
  ]))) as RegistrationResult["contributions"];
  const bindings = Object.freeze(Object.fromEntries(Object.entries(registration.bindings).map(([kind, entries]) => [
    kind,
    Object.freeze(entries.filter(({ pluginId, id }) => allowed(kind as PluginContributionCategory, pluginId, id)))
  ]))) as RegistrationResult["bindings"];
  const inventory = Object.freeze(registration.inventory.map((plugin) => Object.freeze({
    ...plugin,
    contributions: Object.freeze(Object.fromEntries(pluginContributionCategoryKeys.flatMap((kind) => {
      const ids = contributions[kind].filter(({ pluginId }) => pluginId === plugin.id).map(({ id }) => id);
      return ids.length === 0 ? [] : [[kind, Object.freeze(ids)]];
    })))
  })));
  return Object.freeze({ phases: registration.phases, inventory, contributions, bindings });
}

export function scanPluginReferences(pluginId: string, references: readonly PluginReference[]): readonly PluginReference[] {
  ResourceIdSchema.parse(pluginId);
  const found = new Map<string, PluginReference>();
  for (const reference of references) {
    ResourceIdSchema.parse(reference.id);
    ResourceIdSchema.parse(reference.pluginId);
    if (reference.pluginId !== pluginId) continue;
    const key = `${reference.kind}\u0000${reference.id}\u0000${reference.pluginId}`;
    found.set(key, Object.freeze({ ...reference }));
  }
  return Object.freeze([...found.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, value]) => value));
}

export function assertPluginDestructiveOperationSafe(manifestValue: PluginManifest, references: readonly PluginReference[]): void {
  const manifest = parsedManifest(manifestValue);
  const found = scanPluginReferences(manifest.id, references);
  if (found.length > 0) fail("REFERENCES_PRESENT", `Plugin ${manifest.id} has ${found.length} active reference(s).`);
}

export function assertPluginUninstallSupported(manifestValue: PluginManifest): void {
  const manifest = parsedManifest(manifestValue);
  if (manifest.lifecycle.uninstall !== "supported") fail("OPERATION_UNSUPPORTED", `Plugin ${manifest.id} does not support uninstall.`);
}
