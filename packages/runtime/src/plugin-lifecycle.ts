import {
  PluginManifestSchema,
  ResourceIdSchema,
  pluginContributionCategoryKeys,
  type PluginContributionCategory,
  type PluginManifest
} from "@k-nex/contracts";

import type { RegistrationResult } from "./registration-runtime.js";
import {
  registrationLifecycleAuthority,
  retainRegistrationLifecycleAuthority,
  scopeRegistrationLifecycleAuthority
} from "./registration-lifecycle-authority.js";

export type PlatformPluginLifecycleErrorCode =
  | "INVALID_STATE" | "PACKAGE_MISMATCH" | "NOT_READY" | "OPERATION_UNSUPPORTED" | "REFERENCES_PRESENT";

export class PlatformPluginLifecycleError extends Error {
  constructor(readonly code: PlatformPluginLifecycleErrorCode, message: string) {
    super(message);
    this.name = "PlatformPluginLifecycleError";
  }
}

export interface PlatformPluginPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface PlatformPluginLifecycleState {
  readonly pluginId: string;
  readonly catalogStatus: "supported" | "unsupported";
  readonly package: { readonly status: "absent" } | ({ readonly status: "installed" } & PlatformPluginPackageIdentity);
  readonly enabled: boolean;
  readonly configuration: { readonly revision: number; readonly ready: boolean };
  readonly migration: { readonly current: number; readonly required: number; readonly ready: boolean };
  readonly dataState: "none" | "active" | "retained";
  readonly releaseStatus: "supported" | "unsupported";
}

export interface PlatformPluginInstallPlan {
  readonly operation: "install" | "enable" | "noop";
  readonly packageChange: PlatformPluginPackageIdentity | null;
  readonly requiresDeployment: true;
  readonly seedTemplateIds: readonly string[];
}

export interface PlatformPluginAvailability {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly ready: boolean;
  isAvailable(kind: PluginContributionCategory, id: string): boolean;
  readonly contributions: Readonly<Partial<Record<PluginContributionCategory, readonly string[]>>>;
}

export interface PlatformPluginReference {
  readonly kind: "dependency" | "document" | "event" | "integration" | "job";
  readonly id: string;
  readonly pluginId: string;
}

const retainedWhileDisabled = new Set<PluginContributionCategory>([
  "healthAudit", "lifecycle", "migrations", "schema", "settings", "testingMetadata"
]);
const authoritativeAvailability = new WeakSet<object>();
const authoritativeRegistrations = new WeakSet<object>();
const registrationAvailability = new WeakMap<object, {
  readonly availability: ReadonlyMap<string, PlatformPluginAvailability>;
  readonly unavailablePlugins: ReadonlySet<string>;
}>();
declare const scopedRegistrationBrand: unique symbol;

export interface ScopedRegistrationResult extends RegistrationResult {
  readonly [scopedRegistrationBrand]: true;
}

function fail(code: PlatformPluginLifecycleErrorCode, message: string): never {
  throw new PlatformPluginLifecycleError(code, message);
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertPackageIdentity(identity: PlatformPluginPackageIdentity): void {
  if (!identity.name.startsWith("@") || identity.name.length > 214 || identity.version.length < 1 || identity.version.length > 128 ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(identity.integrity)) {
    fail("INVALID_STATE", "Plugin package identity is invalid.");
  }
}

function assertState(state: PlatformPluginLifecycleState): void {
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

export function createPlatformPluginLifecycleState(state: PlatformPluginLifecycleState): PlatformPluginLifecycleState {
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

export function platformPluginReadyForEnable(state: PlatformPluginLifecycleState): boolean {
  assertState(state);
  return state.catalogStatus === "supported" && state.releaseStatus === "supported" &&
    state.package.status === "installed" && state.configuration.ready && state.migration.ready &&
    state.migration.current === state.migration.required;
}

export function planPlatformPluginInstall(input: {
  readonly manifest: PluginManifest;
  readonly package: PlatformPluginPackageIdentity;
  readonly state?: PlatformPluginLifecycleState;
  readonly existingTemplateIds?: readonly string[];
}): PlatformPluginInstallPlan {
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

export function disablePlatformPlugin(state: PlatformPluginLifecycleState, manifestValue: PluginManifest): PlatformPluginLifecycleState {
  const manifest = parsedManifest(manifestValue);
  assertState(state);
  if (state.pluginId !== manifest.id) fail("PACKAGE_MISMATCH", "Lifecycle state belongs to another plugin.");
  if (manifest.lifecycle.disable !== "supported") fail("OPERATION_UNSUPPORTED", `Plugin ${manifest.id} does not support disable.`);
  return createPlatformPluginLifecycleState({ ...state, enabled: false, dataState: state.dataState === "none" ? "none" : "retained" });
}

export function reenablePlatformPlugin(state: PlatformPluginLifecycleState, manifestValue: PluginManifest): PlatformPluginLifecycleState {
  const manifest = parsedManifest(manifestValue);
  assertState(state);
  if (state.pluginId !== manifest.id) fail("PACKAGE_MISMATCH", "Lifecycle state belongs to another plugin.");
  if (manifest.lifecycle.disable !== "supported") fail("OPERATION_UNSUPPORTED", `Plugin ${manifest.id} does not support re-enable.`);
  if (!platformPluginReadyForEnable(state)) fail("NOT_READY", `Plugin ${manifest.id} is not ready to re-enable.`);
  return createPlatformPluginLifecycleState({ ...state, enabled: true, dataState: state.dataState === "none" ? "none" : "active" });
}

export function reconcilePlatformPluginAvailability(registration: RegistrationResult, state: PlatformPluginLifecycleState): PlatformPluginAvailability {
  assertState(state);
  const ready = platformPluginReadyForEnable(state);
  const available = new Map<PluginContributionCategory, Set<string>>();
  for (const kind of pluginContributionCategoryKeys) {
    const ids = registration.contributions[kind]
      .filter(({ pluginId }) => pluginId === state.pluginId)
      .map(({ id }) => id)
      .filter(() => state.package.status === "installed" && (state.enabled && ready || retainedWhileDisabled.has(kind)));
    if (ids.length > 0) available.set(kind, new Set(ids));
  }
  const contributions = Object.freeze(Object.fromEntries([...available].map(([kind, ids]) => [kind, Object.freeze([...ids].sort())])));
  const result = Object.freeze({
    pluginId: state.pluginId,
    enabled: state.enabled,
    ready,
    contributions,
    isAvailable(kind: PluginContributionCategory, id: string) { return available.get(kind)?.has(id) ?? false; }
  });
  authoritativeAvailability.add(result);
  return result;
}

export function assertExecutableRegistrationAuthority(registration: RegistrationResult): asserts registration is ScopedRegistrationResult {
  if (!authoritativeRegistrations.has(registration)) {
    fail("NOT_READY", "Registration requires authoritative lifecycle scoping before execution.");
  }
}

export function platformPluginEnabledInRegistration(registration: ScopedRegistrationResult, pluginId: string): boolean {
  assertExecutableRegistrationAuthority(registration);
  const scope = registrationAvailability.get(registration);
  if (scope?.unavailablePlugins.has(pluginId)) return false;
  const availability = scope?.availability.get(pluginId);
  return availability === undefined || availability.enabled && availability.ready;
}

export function scopePlatformPluginRegistration(
  registration: RegistrationResult,
  availabilityValues: readonly PlatformPluginAvailability[]
): ScopedRegistrationResult {
  const availability = new Map<string, PlatformPluginAvailability>();
  for (const value of availabilityValues) {
    if (!authoritativeAvailability.has(value)) fail("INVALID_STATE", `Plugin ${value.pluginId} availability is not authoritative.`);
    if (availability.has(value.pluginId)) fail("INVALID_STATE", `Plugin ${value.pluginId} has duplicate lifecycle availability.`);
    availability.set(value.pluginId, value);
  }
  const authority = registrationLifecycleAuthority(registration);
  const lifecycleParticipants = authority?.lifecycleParticipants ?? new Set(registration.contributions.lifecycle.map(({ pluginId }) => pluginId));
  for (const pluginId of lifecycleParticipants) {
    if (!availability.has(pluginId)) fail("NOT_READY", `Plugin ${pluginId} requires lifecycle availability before registration can execute.`);
  }
  const unavailablePlugins = new Set<string>();
  if (authority) {
    const unavailable = (pluginId: string): boolean => {
      const value = availability.get(pluginId);
      return unavailablePlugins.has(pluginId) || lifecycleParticipants.has(pluginId) && (!value?.enabled || !value.ready);
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const [consumerId, providers] of authority.requiredProviders) {
        if (unavailablePlugins.has(consumerId) || ![...providers].some(unavailable)) continue;
        unavailablePlugins.add(consumerId);
        changed = true;
      }
    }
  }
  const allowed = (kind: PluginContributionCategory, pluginId: string, id: string): boolean =>
    !unavailablePlugins.has(pluginId) && (!lifecycleParticipants.has(pluginId) || availability.get(pluginId)?.isAvailable(kind, id) === true);
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
  const result = Object.freeze({ phases: registration.phases, inventory, contributions, bindings }) as ScopedRegistrationResult;
  authoritativeRegistrations.add(result);
  registrationAvailability.set(result, { availability: new Map(availability), unavailablePlugins: new Set(unavailablePlugins) });
  scopeRegistrationLifecycleAuthority(registration, availability, unavailablePlugins);
  if (authority) retainRegistrationLifecycleAuthority(result, authority, lifecycleParticipants);
  return result;
}

export function scanPlatformPluginReferences(pluginId: string, references: readonly PlatformPluginReference[]): readonly PlatformPluginReference[] {
  ResourceIdSchema.parse(pluginId);
  const found = new Map<string, PlatformPluginReference>();
  for (const reference of references) {
    ResourceIdSchema.parse(reference.id);
    ResourceIdSchema.parse(reference.pluginId);
    if (reference.pluginId !== pluginId) continue;
    const key = `${reference.kind}\u0000${reference.id}\u0000${reference.pluginId}`;
    found.set(key, Object.freeze({ ...reference }));
  }
  return Object.freeze([...found.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, value]) => value));
}

export function assertPlatformPluginDestructiveOperationSafe(manifestValue: PluginManifest, references: readonly PlatformPluginReference[]): void {
  const manifest = parsedManifest(manifestValue);
  const found = scanPlatformPluginReferences(manifest.id, references);
  if (found.length > 0) fail("REFERENCES_PRESENT", `Plugin ${manifest.id} has ${found.length} active reference(s).`);
}

export function assertPlatformPluginUninstallSupported(manifestValue: PluginManifest): void {
  const manifest = parsedManifest(manifestValue);
  if (manifest.lifecycle.uninstall !== "supported") fail("OPERATION_UNSUPPORTED", `Plugin ${manifest.id} does not support uninstall.`);
}
