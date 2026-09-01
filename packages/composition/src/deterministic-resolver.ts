import type {
  Dependency,
  PlatformPluginRequest,
  PlatformProviderRequest
} from "@k-nex/contracts";
import * as semver from "semver";

import type { InstalledPlatformPluginManifest } from "./installed-plugin-loader.js";

export const resolverVersion = "1.0.0" as const;

export type PlatformPluginGraphResolutionErrorCode =
  | "REQUEST_DUPLICATE"
  | "REQUEST_NOT_INSTALLED"
  | "REQUEST_IDENTITY_MISMATCH"
  | "PRERELEASE_NOT_EXPLICIT"
  | "DEPENDENCY_MISSING"
  | "DEPENDENCY_VERSION_UNSATISFIED"
  | "CAPABILITY_MISSING"
  | "CAPABILITY_VERSION_UNSATISFIED"
  | "CAPABILITY_AMBIGUOUS"
  | "PROVIDER_SELECTION_INVALID"
  | "CONFLICT"
  | "REQUIRED_CYCLE"
  | "MANIFEST_RANGE_INVALID";

export class PlatformPluginGraphResolutionError extends Error {
  readonly code: PlatformPluginGraphResolutionErrorCode;
  readonly path: readonly string[];

  constructor(code: PlatformPluginGraphResolutionErrorCode, message: string, path: readonly string[] = []) {
    super(message);
    this.name = "PlatformPluginGraphResolutionError";
    this.code = code;
    this.path = Object.freeze([...path]);
  }
}

export interface ResolvedPlatformPluginNode {
  readonly id: string;
  readonly kind: string;
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

export interface ResolvedPlatformPluginCapabilityProvider {
  readonly capability: string;
  readonly plugin: string;
  readonly version: string;
}

export interface ResolvedPlatformPluginGraph {
  readonly resolverVersion: typeof resolverVersion;
  readonly plugins: readonly ResolvedPlatformPluginNode[];
  readonly capabilityProviders: readonly ResolvedPlatformPluginCapabilityProvider[];
  readonly registrationOrder: readonly string[];
}

export interface ResolvePlatformPluginGraphOptions {
  readonly plugins: readonly PlatformPluginRequest[];
  readonly providers: Readonly<Record<string, PlatformProviderRequest>>;
  readonly installed: readonly InstalledPlatformPluginManifest[];
}

interface InstalledEntry {
  readonly installed: InstalledPlatformPluginManifest;
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
}

interface IdentityRequest {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
}

interface CapabilityRequirement {
  readonly consumer: string;
  readonly range: string;
}

interface CapabilitySelection {
  readonly plugin: string;
  readonly version: string;
}

interface ExplicitProvider {
  readonly capability: string;
  readonly entry: InstalledEntry;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareInstalled(left: InstalledEntry, right: InstalledEntry): number {
  return compareStrings(
    `${left.id}\u0000${left.packageName}\u0000${left.version}\u0000${left.installed.package.integrity}`,
    `${right.id}\u0000${right.packageName}\u0000${right.version}\u0000${right.installed.package.integrity}`
  );
}

function fail(code: PlatformPluginGraphResolutionErrorCode, message: string, path: readonly string[] = []): never {
  throw new PlatformPluginGraphResolutionError(code, message, path);
}

function isPluginDependency(dependency: Dependency): dependency is Extract<Dependency, { readonly plugin: string }> {
  return "plugin" in dependency;
}

function dependencyKey(dependency: Dependency): string {
  return isPluginDependency(dependency)
    ? `plugin\u0000${dependency.plugin}\u0000${dependency.version}`
    : `capability\u0000${dependency.capability}\u0000${dependency.version}`;
}

function compareDependencies(left: Dependency, right: Dependency): number {
  return compareStrings(dependencyKey(left), dependencyKey(right));
}

function sortedDependencies(dependencies: readonly Dependency[]): readonly Dependency[] {
  return [...dependencies].sort(compareDependencies);
}

function isValidRange(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && semver.validRange(value, { loose: false }) !== null;
}

function satisfies(version: string, range: string): boolean {
  return semver.satisfies(version, range, { loose: false, includePrerelease: false });
}

function isPrerelease(version: string): boolean {
  return semver.prerelease(version, { loose: false }) !== null;
}

function providedVersions(entry: InstalledEntry, capability: string): readonly string[] {
  const versions = entry.installed.manifest.provides
    .filter((provision) => provision.capability === capability)
    .map((provision) => provision.version);
  return [...new Set(versions)].sort(compareStrings);
}

function compareProviderEntries(left: InstalledEntry, right: InstalledEntry): number {
  return compareStrings(left.id, right.id);
}

function identityFromPluginRequest(request: PlatformPluginRequest): IdentityRequest {
  return { id: request.id, packageName: request.package, version: request.version };
}

function identityFromProviderRequest(request: PlatformProviderRequest): IdentityRequest {
  return { id: request.plugin, packageName: request.package, version: request.version };
}

function requestLabel(source: "plugin" | "provider", id: string, capability?: string): string {
  return capability ? `${source} ${id} for capability ${capability}` : `${source} ${id}`;
}

function buildInstalledIndexes(installed: readonly InstalledPlatformPluginManifest[]): {
  readonly entries: readonly InstalledEntry[];
  readonly byId: ReadonlyMap<string, InstalledEntry>;
  readonly byPackage: ReadonlyMap<string, InstalledEntry>;
} {
  const entries = installed.map((value) => ({
    installed: value,
    id: value.manifest.id,
    packageName: value.package.name,
    version: value.package.version
  }));
  const sorted = [...entries].sort(compareInstalled);
  const byId = new Map<string, InstalledEntry>();
  const byPackage = new Map<string, InstalledEntry>();

  for (const entry of sorted) {
    if (entry.installed.manifest.package !== entry.packageName || entry.installed.manifest.version !== entry.version) {
      fail(
        "REQUEST_IDENTITY_MISMATCH",
        `Installed plugin ${entry.id} has inconsistent package identity.`,
        [entry.id]
      );
    }
    const duplicateId = byId.get(entry.id);
    if (duplicateId) {
      fail(
        "REQUEST_DUPLICATE",
        `Installed plugin ID ${entry.id} is declared more than once.`,
        [entry.id]
      );
    }
    const duplicatePackage = byPackage.get(entry.packageName);
    if (duplicatePackage) {
      fail(
        "REQUEST_DUPLICATE",
        `Installed package ${entry.packageName} is declared more than once.`,
        [entry.packageName]
      );
    }
    byId.set(entry.id, entry);
    byPackage.set(entry.packageName, entry);
  }

  return { entries: sorted, byId, byPackage };
}

function reconcileIdentity(
  identity: IdentityRequest,
  byId: ReadonlyMap<string, InstalledEntry>,
  byPackage: ReadonlyMap<string, InstalledEntry>,
  label: string
): InstalledEntry {
  const byRequestedId = byId.get(identity.id);
  const byRequestedPackage = byPackage.get(identity.packageName);
  if (!byRequestedId && !byRequestedPackage) {
    fail("REQUEST_NOT_INSTALLED", `${label} is not present in the installed plugin manifests.`, [identity.id]);
  }
  if (
    !byRequestedId ||
    !byRequestedPackage ||
    byRequestedId !== byRequestedPackage ||
    byRequestedId.packageName !== identity.packageName ||
    byRequestedId.version !== identity.version
  ) {
    fail("REQUEST_IDENTITY_MISMATCH", `${label} does not match an installed plugin identity.`, [identity.id]);
  }
  return byRequestedId;
}

function validatePluginRequestDuplicates(plugins: readonly PlatformPluginRequest[]): void {
  const sorted = [...plugins].sort((left, right) =>
    compareStrings(`${left.id}\u0000${left.package}\u0000${left.version}`, `${right.id}\u0000${right.package}\u0000${right.version}`)
  );
  const ids = new Set<string>();
  const packages = new Set<string>();
  for (const request of sorted) {
    if (ids.has(request.id)) {
      fail("REQUEST_DUPLICATE", `Plugin request ID ${request.id} is declared more than once.`, [request.id]);
    }
    if (packages.has(request.package)) {
      fail("REQUEST_DUPLICATE", `Plugin package ${request.package} is requested more than once.`, [request.package]);
    }
    ids.add(request.id);
    packages.add(request.package);
  }
}

function validateRangeDependencies(active: readonly InstalledEntry[]): void {
  for (const entry of active) {
    const dependencies = [
      ...sortedDependencies(entry.installed.manifest.requires),
      ...sortedDependencies(entry.installed.manifest.optional),
      ...sortedDependencies(entry.installed.manifest.conflicts)
    ];
    for (const dependency of dependencies) {
      if (!isValidRange(dependency.version)) {
        const target = isPluginDependency(dependency) ? dependency.plugin : dependency.capability;
        fail(
          "MANIFEST_RANGE_INVALID",
          `Plugin ${entry.id} declares an invalid version range for ${target}.`,
          [entry.id, target]
        );
      }
    }
  }
}

function canonicalCycle(path: readonly string[]): readonly string[] {
  const nodes = path.slice(0, -1);
  let best = nodes;
  for (let offset = 1; offset < nodes.length; offset += 1) {
    const candidate = [...nodes.slice(offset), ...nodes.slice(0, offset)];
    if (compareStrings(candidate.join("\u0000"), best.join("\u0000")) < 0) best = candidate;
  }
  return Object.freeze([...best, best[0]!]);
}

function shortestRequiredCycle(edges: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] | undefined {
  const starts = [...edges.keys()].sort(compareStrings);
  let shortest: readonly string[] | undefined;
  for (const start of starts) {
    const queue: Array<{ readonly node: string; readonly path: readonly string[] }> = [{ node: start, path: [start] }];
    const distance = new Map<string, number>([[start, 0]]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const neighbors = [...(edges.get(current.node) ?? [])].sort(compareStrings);
      for (const neighbor of neighbors) {
        if (neighbor === start) {
          const cycle = canonicalCycle([...current.path, start]);
          if (!shortest || cycle.length < shortest.length || (cycle.length === shortest.length && compareStrings(cycle.join("\u0000"), shortest.join("\u0000")) < 0)) {
            shortest = cycle;
          }
          continue;
        }
        const nextDistance = current.path.length;
        const previousDistance = distance.get(neighbor);
        if (previousDistance !== undefined && previousDistance <= nextDistance) continue;
        distance.set(neighbor, nextDistance);
        queue.push({ node: neighbor, path: [...current.path, neighbor] });
      }
    }
  }
  return shortest;
}

function dependencyFirstOrder(
  nodes: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>
): readonly string[] {
  const remainingDependencies = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const node of nodes) {
    const dependencies = edges.get(node) ?? new Set<string>();
    remainingDependencies.set(node, dependencies.size);
    for (const dependency of dependencies) {
      const users = dependents.get(dependency) ?? new Set<string>();
      users.add(node);
      dependents.set(dependency, users);
    }
  }

  const ready = [...nodes].filter((node) => remainingDependencies.get(node) === 0).sort(compareStrings);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(compareStrings);
    const node = ready.shift();
    if (!node) break;
    order.push(node);
    for (const dependent of [...(dependents.get(node) ?? [])].sort(compareStrings)) {
      const count = (remainingDependencies.get(dependent) ?? 0) - 1;
      remainingDependencies.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  return Object.freeze(order);
}

function selectProvidedVersion(entry: InstalledEntry, capability: string, ranges: readonly string[]): string | undefined {
  return providedVersions(entry, capability).find((version) => ranges.every((range) => satisfies(version, range)));
}

function activeProviders(active: readonly InstalledEntry[], capability: string): readonly InstalledEntry[] {
  return active.filter((entry) => providedVersions(entry, capability).length > 0).sort(compareProviderEntries);
}

function resolveRequiredCapabilities(
  requirements: ReadonlyMap<string, readonly CapabilityRequirement[]>,
  active: readonly InstalledEntry[],
  installed: readonly InstalledEntry[],
  explicitProviders: ReadonlyMap<string, ExplicitProvider>,
  explicitlyRequestedIds: ReadonlySet<string>,
  requiredEdges: Map<string, Set<string>>,
  selections: Map<string, CapabilitySelection>
): void {
  for (const capability of [...requirements.keys()].sort(compareStrings)) {
    const entries = requirements.get(capability) ?? [];
    const ranges = entries.map((entry) => entry.range);
    const explicit = explicitProviders.get(capability);
    let selected: CapabilitySelection | undefined;
    if (explicit) {
      const version = selectProvidedVersion(explicit.entry, capability, ranges);
      if (!version) {
        if (providedVersions(explicit.entry, capability).length === 0) {
          fail(
            "PROVIDER_SELECTION_INVALID",
            `Provider ${explicit.entry.id} does not provide capability ${capability}.`,
            [capability, explicit.entry.id]
          );
        }
        fail(
          "CAPABILITY_VERSION_UNSATISFIED",
          `Selected provider ${explicit.entry.id} cannot satisfy capability ${capability}.`,
          [capability, explicit.entry.id]
        );
      }
      selected = { plugin: explicit.entry.id, version };
    } else {
      const candidates = activeProviders(active, capability).filter((entry) => selectProvidedVersion(entry, capability, ranges) !== undefined);
      if (candidates.length === 0) {
        const allProviders = activeProviders(active, capability);
        if (allProviders.length > 0) {
          fail(
            "CAPABILITY_VERSION_UNSATISFIED",
            `No active provider satisfies capability ${capability}.`,
            [capability]
          );
        }
        const unrequestedPrerelease = installed.some(
          (entry) => isPrerelease(entry.version) && !explicitlyRequestedIds.has(entry.id) && providedVersions(entry, capability).length > 0
        );
        if (unrequestedPrerelease) {
          fail(
            "PRERELEASE_NOT_EXPLICIT",
            `Capability ${capability} is provided only by an unrequested prerelease plugin.`,
            [capability]
          );
        }
        fail("CAPABILITY_MISSING", `No active provider supplies capability ${capability}.`, [capability]);
      }
      if (candidates.length > 1) {
        fail(
          "CAPABILITY_AMBIGUOUS",
          `Capability ${capability} has multiple compatible active providers.`,
          [capability, ...candidates.map((entry) => entry.id)]
        );
      }
      const entry = candidates[0];
      if (!entry) fail("CAPABILITY_MISSING", `No active provider supplies capability ${capability}.`, [capability]);
      const version = selectProvidedVersion(entry, capability, ranges);
      if (!version) fail("CAPABILITY_VERSION_UNSATISFIED", `No active provider satisfies capability ${capability}.`, [capability]);
      selected = { plugin: entry.id, version };
    }
    if (!selected) continue;
    selections.set(capability, selected);
    for (const requirement of entries) {
      const edges = requiredEdges.get(requirement.consumer);
      edges?.add(selected.plugin);
    }
  }
}

function resolveOptionalCapabilities(
  requirements: ReadonlyMap<string, readonly CapabilityRequirement[]>,
  active: readonly InstalledEntry[],
  explicitProviders: ReadonlyMap<string, ExplicitProvider>,
  selections: Map<string, CapabilitySelection>,
  optionalEdges: Map<string, Set<string>>
): void {
  for (const capability of [...requirements.keys()].sort(compareStrings)) {
    const requirementsForCapability = requirements.get(capability) ?? [];
    const addCompatibleEdges = (selected: CapabilitySelection): void => {
      for (const requirement of requirementsForCapability) {
        if (satisfies(selected.version, requirement.range)) {
          optionalEdges.get(requirement.consumer)?.add(selected.plugin);
        }
      }
    };
    const selected = selections.get(capability);
    if (selected) {
      const provider = active.find((entry) => entry.id === selected.plugin);
      if (provider) addCompatibleEdges(selected);
      continue;
    }
    const explicit = explicitProviders.get(capability);
    if (explicit) {
      const versions = providedVersions(explicit.entry, capability);
      if (versions.length === 0) {
        fail(
          "PROVIDER_SELECTION_INVALID",
          `Provider ${explicit.entry.id} does not provide capability ${capability}.`,
          [capability, explicit.entry.id]
        );
      }
      const version =
        versions.find((candidate) =>
          requirementsForCapability.some((requirement) => satisfies(candidate, requirement.range))
        ) ?? versions[0]!;
      const selection = { plugin: explicit.entry.id, version };
      selections.set(capability, selection);
      addCompatibleEdges(selection);
      continue;
    }
    const providers = activeProviders(active, capability).filter((provider) =>
      providedVersions(provider, capability).some((version) =>
        requirementsForCapability.some((requirement) => satisfies(version, requirement.range))
      )
    );
    if (providers.length > 1) {
      fail(
        "CAPABILITY_AMBIGUOUS",
        `Capability ${capability} has multiple active providers for an optional dependency.`,
        [capability, ...providers.map((entry) => entry.id)]
      );
    }
    if (providers.length === 1) {
      const provider = providers[0];
      if (!provider) continue;
      const version = providedVersions(provider, capability).find((candidate) =>
        requirementsForCapability.some((requirement) => satisfies(candidate, requirement.range))
      );
      if (!version) continue;
      const selection = { plugin: provider.id, version };
      selections.set(capability, selection);
      addCompatibleEdges(selection);
    }
  }
}

function validateConflicts(active: readonly InstalledEntry[], activeById: ReadonlyMap<string, InstalledEntry>): void {
  for (const entry of active) {
    for (const dependency of sortedDependencies(entry.installed.manifest.conflicts)) {
      if (isPluginDependency(dependency)) {
        const target = activeById.get(dependency.plugin);
        if (target && satisfies(target.version, dependency.version)) {
          fail("CONFLICT", `Plugin ${entry.id} conflicts with plugin ${dependency.plugin}.`, [entry.id, dependency.plugin]);
        }
        continue;
      }
      const providers = activeProviders(active, dependency.capability);
      for (const provider of providers) {
        const version = selectProvidedVersion(provider, dependency.capability, [dependency.version]);
        if (version) {
          fail(
            "CONFLICT",
            `Plugin ${entry.id} conflicts with capability ${dependency.capability}.`,
            [entry.id, dependency.capability, provider.id]
          );
        }
      }
    }
  }
}

export function resolvePlatformPluginGraph(options: ResolvePlatformPluginGraphOptions): ResolvedPlatformPluginGraph {
  const plugins = options.plugins ?? [];
  const providers = options.providers ?? {};
  const installed = options.installed ?? [];
  const indexes = buildInstalledIndexes(installed);
  validatePluginRequestDuplicates(plugins);

  const explicitlyRequestedIds = new Set<string>();
  const activeById = new Map<string, InstalledEntry>();
  const pluginRequests = [...plugins].sort((left, right) => compareStrings(`${left.id}\u0000${left.package}\u0000${left.version}`, `${right.id}\u0000${right.package}\u0000${right.version}`));
  for (const request of pluginRequests) {
    const entry = reconcileIdentity(identityFromPluginRequest(request), indexes.byId, indexes.byPackage, requestLabel("plugin", request.id));
    explicitlyRequestedIds.add(request.id);
    if (request.enabled) activeById.set(entry.id, entry);
  }

  const explicitProviders = new Map<string, ExplicitProvider>();
  const providerEntries = Object.entries(providers).sort(([left], [right]) => compareStrings(left, right));
  const providerIdentityByPlugin = new Map<string, string>();
  for (const [capability, request] of providerEntries) {
    const identity = identityFromProviderRequest(request);
    const identityKey = `${identity.packageName}\u0000${identity.version}`;
    const previousIdentity = providerIdentityByPlugin.get(identity.id);
    if (previousIdentity && previousIdentity !== identityKey) {
      fail("REQUEST_DUPLICATE", `Provider requests for plugin ${identity.id} use different identities.`, [identity.id]);
    }
    providerIdentityByPlugin.set(identity.id, identityKey);
    const entry = reconcileIdentity(identity, indexes.byId, indexes.byPackage, requestLabel("provider", request.plugin, capability));
    activeById.set(entry.id, entry);
    explicitProviders.set(capability, { capability, entry });
  }

  const active = [...activeById.values()].sort((left, right) => compareStrings(left.id, right.id));
  validateRangeDependencies(active);
  const requiredEdges = new Map<string, Set<string>>();
  const optionalEdges = new Map<string, Set<string>>();
  const requiredCapabilities = new Map<string, CapabilityRequirement[]>();
  const optionalCapabilities = new Map<string, CapabilityRequirement[]>();
  for (const entry of active) {
    requiredEdges.set(entry.id, new Set<string>());
    optionalEdges.set(entry.id, new Set<string>());
    const requires = sortedDependencies(entry.installed.manifest.requires);
    for (const dependency of requires) {
      if (isPluginDependency(dependency)) {
        const targetInstalled = indexes.byId.get(dependency.plugin);
        const target = activeById.get(dependency.plugin);
        if (!targetInstalled) {
          fail("DEPENDENCY_MISSING", `Plugin ${entry.id} requires missing plugin ${dependency.plugin}.`, [entry.id, dependency.plugin]);
        }
        if (!target) {
          if (isPrerelease(targetInstalled.version) && !explicitlyRequestedIds.has(targetInstalled.id)) {
            fail(
              "PRERELEASE_NOT_EXPLICIT",
              `Plugin ${dependency.plugin} is an unrequested prerelease dependency.`,
              [entry.id, dependency.plugin]
            );
          }
          fail("DEPENDENCY_MISSING", `Plugin ${entry.id} requires inactive plugin ${dependency.plugin}.`, [entry.id, dependency.plugin]);
        }
        if (!satisfies(target.version, dependency.version)) {
          fail(
            "DEPENDENCY_VERSION_UNSATISFIED",
            `Plugin ${entry.id} requires ${dependency.plugin} in range ${dependency.version}.`,
            [entry.id, dependency.plugin]
          );
        }
        requiredEdges.get(entry.id)?.add(target.id);
      } else {
        const requirements = requiredCapabilities.get(dependency.capability) ?? [];
        requirements.push({ consumer: entry.id, range: dependency.version });
        requiredCapabilities.set(dependency.capability, requirements);
      }
    }
    for (const dependency of sortedDependencies(entry.installed.manifest.optional)) {
      if (isPluginDependency(dependency)) {
        const target = activeById.get(dependency.plugin);
        if (target && satisfies(target.version, dependency.version)) optionalEdges.get(entry.id)?.add(target.id);
      } else {
        const requirements = optionalCapabilities.get(dependency.capability) ?? [];
        requirements.push({ consumer: entry.id, range: dependency.version });
        optionalCapabilities.set(dependency.capability, requirements);
      }
    }
  }

  const selections = new Map<string, CapabilitySelection>();
  resolveRequiredCapabilities(requiredCapabilities, active, indexes.entries, explicitProviders, explicitlyRequestedIds, requiredEdges, selections);
  resolveOptionalCapabilities(optionalCapabilities, active, explicitProviders, selections, optionalEdges);
  for (const [capability, explicit] of explicitProviders) {
    if (!selections.has(capability)) {
      const versions = providedVersions(explicit.entry, capability);
      if (versions.length === 0) {
        fail(
          "PROVIDER_SELECTION_INVALID",
          `Provider ${explicit.entry.id} does not provide capability ${capability}.`,
          [capability, explicit.entry.id]
        );
      }
      if (optionalCapabilities.has(capability)) continue;
      selections.set(capability, { plugin: explicit.entry.id, version: versions[0]! });
    }
  }

  validateConflicts(active, activeById);
  const cycle = shortestRequiredCycle(requiredEdges);
  if (cycle) fail("REQUIRED_CYCLE", `Required plugin dependency cycle: ${cycle.join(" -> ")}.`, cycle);

  const nodes: ResolvedPlatformPluginNode[] = active.map((entry) => {
    const required = [...(requiredEdges.get(entry.id) ?? [])].sort(compareStrings);
    const optional = [...(optionalEdges.get(entry.id) ?? [])].sort(compareStrings);
    return {
      id: entry.id,
      kind: entry.installed.manifest.kind,
      package: entry.packageName,
      version: entry.version,
      integrity: entry.installed.package.integrity,
      required: Object.freeze([...new Set(required)]),
      optional: Object.freeze([...new Set(optional)])
    };
  });
  const capabilityProviders = [...selections.entries()]
    .map(([capability, selection]) => ({ capability, plugin: selection.plugin, version: selection.version }))
    .sort((left, right) => compareStrings(`${left.capability}\u0000${left.plugin}\u0000${left.version}`, `${right.capability}\u0000${right.plugin}\u0000${right.version}`));
  const registrationOrder = dependencyFirstOrder(active.map((entry) => entry.id), requiredEdges);
  return {
    resolverVersion,
    plugins: Object.freeze(nodes),
    capabilityProviders: Object.freeze(capabilityProviders),
    registrationOrder
  };
}
