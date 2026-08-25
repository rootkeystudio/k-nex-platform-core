import type { PluginManifest, RegistrationPhase } from "@k-nex/contracts";
import { registrationPhases } from "@k-nex/contracts";

import type { ResolvedPluginGraph } from "./deterministic-resolver.js";
import type { InstalledPluginManifest } from "./installed-plugin-loader.js";

export const contributionKinds = [
  "contracts",
  "schema",
  "behavior",
  "jobs",
  "dataSources",
  "actions",
  "blocks",
  "navigation",
  "admin"
] as const;

export type ContributionKind = (typeof contributionKinds)[number];
export type BoundContributionKind = "dataSources" | "actions" | "blocks";

export type RegistrationErrorCode =
  | "GRAPH_MISMATCH"
  | "WRONG_PHASE"
  | "UNDECLARED_CONTRIBUTION"
  | "UNDECLARED_CAPABILITY_ACCESS"
  | "CAPABILITY_UNAVAILABLE"
  | "PROVIDER_MISMATCH"
  | "DUPLICATE_CONTRIBUTION"
  | "DUPLICATE_BINDING"
  | "FROZEN"
  | "INVENTORY_MISMATCH";

export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  readonly path: readonly string[];

  constructor(code: RegistrationErrorCode, message: string, path: readonly string[] = []) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
    this.path = Object.freeze([...path]);
  }
}

export interface ScopedServices {
  get<T = unknown>(capability: string): T;
}

interface PhaseContext {
  readonly pluginId: string;
  readonly services: ScopedServices;
}

export interface ContractsRegistrationContext extends PhaseContext {
  register(kind: "contracts" | "dataSources" | "actions" | "blocks", id: string, value: unknown): void;
}

export interface ProvidersRegistrationContext extends PhaseContext {
  provide(capability: string, service: unknown): void;
}

export interface SingleKindRegistrationContext extends PhaseContext {
  register(id: string, value: unknown): void;
}

export interface DataHandlersRegistrationContext extends PhaseContext {
  bind(kind: "dataSources" | "actions", id: string, handler: unknown): void;
}

export interface UiRegistrationContext extends PhaseContext {
  registerNavigation(id: string, value: unknown): void;
  bindBlock(id: string, renderer: unknown): void;
}

export interface PluginRegistration {
  readonly pluginId: string;
  readonly contracts?: (context: ContractsRegistrationContext) => void;
  readonly providers?: (context: ProvidersRegistrationContext) => void;
  readonly schema?: (context: SingleKindRegistrationContext) => void;
  readonly behavior?: (context: SingleKindRegistrationContext) => void;
  readonly jobs?: (context: SingleKindRegistrationContext) => void;
  readonly dataHandlers?: (context: DataHandlersRegistrationContext) => void;
  readonly ui?: (context: UiRegistrationContext) => void;
  readonly admin?: (context: SingleKindRegistrationContext) => void;
}

export interface RegisteredContribution {
  readonly pluginId: string;
  readonly id: string;
  readonly value: unknown;
}

export interface RegistrationInventoryPlugin {
  readonly id: string;
  readonly contributions: Readonly<Partial<Record<ContributionKind, readonly string[]>>>;
  readonly capabilityAccess: readonly string[];
}

export interface RegistrationResult {
  readonly phases: readonly RegistrationPhase[];
  readonly inventory: readonly RegistrationInventoryPlugin[];
  readonly contributions: Readonly<Record<ContributionKind, readonly RegisteredContribution[]>>;
  readonly bindings: Readonly<Record<BoundContributionKind, readonly RegisteredContribution[]>>;
}

export interface ExecuteRegistrationOptions {
  readonly graph: ResolvedPluginGraph;
  readonly installed: readonly InstalledPluginManifest[];
  readonly registrations: readonly PluginRegistration[];
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: RegistrationErrorCode, message: string, path: readonly string[] = []): never {
  throw new RegistrationError(code, message, path);
}

function declaredContributions(manifest: PluginManifest): ReadonlyMap<ContributionKind, ReadonlySet<string>> {
  return new Map(contributionKinds.map((kind) => [kind, new Set(manifest.contributions?.[kind] ?? [])]));
}

function declaredCapabilities(manifest: PluginManifest): ReadonlySet<string> {
  return new Set([...manifest.requires, ...manifest.optional]
    .filter((dependency): dependency is Extract<(typeof manifest.requires)[number], { capability: string }> => "capability" in dependency)
    .map((dependency) => dependency.capability));
}

function providedCapabilities(manifest: PluginManifest): ReadonlyMap<string, ReadonlySet<string>> {
  const provided = new Map<string, Set<string>>();
  for (const provision of manifest.provides) {
    const versions = provided.get(provision.capability) ?? new Set<string>();
    versions.add(provision.version);
    provided.set(provision.capability, versions);
  }
  return provided;
}

function activeManifests(
  graph: ResolvedPluginGraph,
  installed: readonly InstalledPluginManifest[]
): ReadonlyMap<string, PluginManifest> {
  const installedById = new Map(installed.map((entry) => [entry.manifest.id, entry]));
  const active = new Map<string, PluginManifest>();
  for (const node of graph.plugins) {
    const entry = installedById.get(node.id);
    if (
      !entry ||
      entry.manifest.package !== node.package ||
      entry.manifest.version !== node.version ||
      entry.package.name !== node.package ||
      entry.package.version !== node.version ||
      entry.package.integrity !== node.integrity ||
      entry.manifest.kind !== node.kind ||
      active.has(node.id)
    ) {
      fail("GRAPH_MISMATCH", `Resolved plugin ${node.id} does not match one installed manifest.`, [node.id]);
    }
    active.set(node.id, entry.manifest);
  }
  const ids = new Set(active.keys());
  if (
    graph.registrationOrder.length !== ids.size ||
    new Set(graph.registrationOrder).size !== ids.size ||
    graph.registrationOrder.some((id) => !ids.has(id))
  ) {
    fail("GRAPH_MISMATCH", "Registration order must contain every resolved plugin exactly once.");
  }
  return active;
}

function freezeEntries(entries: readonly RegisteredContribution[]): readonly RegisteredContribution[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

export function executeRegistration(options: ExecuteRegistrationOptions): RegistrationResult {
  const manifests = activeManifests(options.graph, options.installed);
  const plans = new Map<string, PluginRegistration>();
  for (const plan of options.registrations) {
    if (!manifests.has(plan.pluginId) || plans.has(plan.pluginId)) {
      fail("GRAPH_MISMATCH", `Registration plan ${plan.pluginId} is not a unique resolved plugin.`, [plan.pluginId]);
    }
    plans.set(plan.pluginId, plan);
  }

  const actual = new Map<string, Map<ContributionKind, Map<string, unknown>>>();
  const bindings = new Map<BoundContributionKind, Map<string, RegisteredContribution>>([
    ["dataSources", new Map()],
    ["actions", new Map()],
    ["blocks", new Map()]
  ]);
  const contributionOwners = new Map<string, string>();
  const capabilityAccess = new Map<string, Set<string>>();
  const services = new Map<string, unknown>();
  const declarations = new Map([...manifests].map(([id, manifest]) => [id, declaredContributions(manifest)]));
  const allowedCapabilities = new Map([...manifests].map(([id, manifest]) => [id, declaredCapabilities(manifest)]));
  const provided = new Map([...manifests].map(([id, manifest]) => [id, providedCapabilities(manifest)]));
  const selectedProviders = new Map<string, (typeof options.graph.capabilityProviders)[number]>();
  for (const selection of options.graph.capabilityProviders) {
    if (
      selectedProviders.has(selection.capability) ||
      !provided.get(selection.plugin)?.get(selection.capability)?.has(selection.version)
    ) {
      fail("GRAPH_MISMATCH", `Capability selection ${selection.capability} does not match one resolved provider.`, [selection.capability]);
    }
    selectedProviders.set(selection.capability, selection);
  }
  let phase: RegistrationPhase = "manifest";
  let currentPlugin: string | undefined;
  let frozen = false;

  for (const id of manifests.keys()) {
    actual.set(id, new Map(contributionKinds.map((kind) => [kind, new Map()])));
    capabilityAccess.set(id, new Set());
  }

  const assertPhase = (expected: RegistrationPhase, pluginId: string): void => {
    if (frozen) fail("FROZEN", "Registration is frozen.", [pluginId]);
    if (phase !== expected || currentPlugin !== pluginId) {
      fail("WRONG_PHASE", `Plugin ${pluginId} attempted ${expected} registration during ${phase}.`, [pluginId, expected, phase]);
    }
  };

  const scopedServices = (pluginId: string): ScopedServices => Object.freeze({
    get<T = unknown>(capability: string): T {
      if (frozen) fail("FROZEN", "Registration is frozen.", [pluginId]);
      if (!allowedCapabilities.get(pluginId)?.has(capability)) {
        fail("UNDECLARED_CAPABILITY_ACCESS", `Plugin ${pluginId} did not declare capability ${capability}.`, [pluginId, capability]);
      }
      const selection = selectedProviders.get(capability);
      if (!selection || !services.has(capability)) {
        fail("CAPABILITY_UNAVAILABLE", `Capability ${capability} is not bound for plugin ${pluginId}.`, [pluginId, capability]);
      }
      capabilityAccess.get(pluginId)?.add(capability);
      return services.get(capability) as T;
    }
  });

  const register = (
    expectedPhase: RegistrationPhase,
    pluginId: string,
    kind: ContributionKind,
    id: string,
    value: unknown
  ): void => {
    assertPhase(expectedPhase, pluginId);
    if (!declarations.get(pluginId)?.get(kind)?.has(id)) {
      fail("UNDECLARED_CONTRIBUTION", `Plugin ${pluginId} did not declare ${kind} contribution ${id}.`, [pluginId, kind, id]);
    }
    const owner = contributionOwners.get(id);
    if (owner) fail("DUPLICATE_CONTRIBUTION", `Contribution ${id} is already registered by ${owner}.`, [id, owner, pluginId]);
    contributionOwners.set(id, pluginId);
    actual.get(pluginId)?.get(kind)?.set(id, value);
  };

  const bind = (
    expectedPhase: RegistrationPhase,
    pluginId: string,
    kind: BoundContributionKind,
    id: string,
    value: unknown
  ): void => {
    assertPhase(expectedPhase, pluginId);
    if (!actual.get(pluginId)?.get(kind)?.has(id)) {
      fail("UNDECLARED_CONTRIBUTION", `Plugin ${pluginId} cannot bind undeclared ${kind} contribution ${id}.`, [pluginId, kind, id]);
    }
    const entries = bindings.get(kind);
    if (entries?.has(id)) fail("DUPLICATE_BINDING", `Contribution ${id} already has a ${kind} binding.`, [pluginId, kind, id]);
    entries?.set(id, { pluginId, id, value });
  };

  const run = (nextPhase: RegistrationPhase): void => {
    phase = nextPhase;
    for (const pluginId of options.graph.registrationOrder) {
      const plan = plans.get(pluginId);
      currentPlugin = pluginId;
      const base = { pluginId, services: scopedServices(pluginId) };
      if (nextPhase === "contracts") plan?.contracts?.({
        ...base,
        register: (kind, id, value) => register("contracts", pluginId, kind, id, value)
      });
      else if (nextPhase === "providers") plan?.providers?.({
        ...base,
        provide: (capability, service) => {
          assertPhase("providers", pluginId);
          const selection = selectedProviders.get(capability);
          const versions = provided.get(pluginId)?.get(capability);
          if (!selection || selection.plugin !== pluginId || !versions?.has(selection.version)) {
            fail("PROVIDER_MISMATCH", `Plugin ${pluginId} is not the resolved provider for ${capability}.`, [pluginId, capability]);
          }
          if (services.has(capability)) fail("PROVIDER_MISMATCH", `Capability ${capability} is already bound.`, [pluginId, capability]);
          services.set(capability, service);
        }
      });
      else if (nextPhase === "schema") plan?.schema?.({
        ...base,
        register: (id, value) => register("schema", pluginId, "schema", id, value)
      });
      else if (nextPhase === "behavior") plan?.behavior?.({
        ...base,
        register: (id, value) => register("behavior", pluginId, "behavior", id, value)
      });
      else if (nextPhase === "jobs") plan?.jobs?.({
        ...base,
        register: (id, value) => register("jobs", pluginId, "jobs", id, value)
      });
      else if (nextPhase === "data-handlers") plan?.dataHandlers?.({
        ...base,
        bind: (kind, id, value) => bind("data-handlers", pluginId, kind, id, value)
      });
      else if (nextPhase === "ui") plan?.ui?.({
        ...base,
        registerNavigation: (id, value) => register("ui", pluginId, "navigation", id, value),
        bindBlock: (id, value) => bind("ui", pluginId, "blocks", id, value)
      });
      else if (nextPhase === "admin") plan?.admin?.({
        ...base,
        register: (id, value) => register("admin", pluginId, "admin", id, value)
      });
    }
    currentPlugin = undefined;
  };

  for (const nextPhase of registrationPhases) {
    if (["manifest", "validate", "freeze"].includes(nextPhase)) continue;
    run(nextPhase);
  }

  phase = "validate";
  const mismatches: string[] = [];
  for (const pluginId of [...manifests.keys()].sort(compare)) {
    const declared = declarations.get(pluginId)!;
    for (const kind of contributionKinds) {
      const expected = [...(declared.get(kind) ?? [])].sort(compare);
      const registered = [...(actual.get(pluginId)?.get(kind)?.keys() ?? [])].sort(compare);
      if (expected.join("\u0000") !== registered.join("\u0000")) mismatches.push(`${pluginId}:${kind}`);
    }
    for (const kind of ["dataSources", "actions", "blocks"] as const) {
      for (const id of declared.get(kind) ?? []) {
        if (!bindings.get(kind)?.has(id)) mismatches.push(`${pluginId}:${kind}:${id}:binding`);
      }
    }
  }
  for (const capability of [...selectedProviders.keys()].sort(compare)) {
    if (!services.has(capability)) mismatches.push(`capability:${capability}:binding`);
  }
  if (mismatches.length > 0) {
    fail("INVENTORY_MISMATCH", `Declared and actual registration inventory differ: ${mismatches.sort(compare).join(", ")}.`, mismatches.sort(compare));
  }

  phase = "freeze";
  frozen = true;
  const contributions = Object.fromEntries(contributionKinds.map((kind) => [kind, freezeEntries(
    [...actual.entries()].flatMap(([pluginId, byKind]) => [...(byKind.get(kind)?.entries() ?? [])]
      .map(([id, value]) => ({ pluginId, id, value })))
      .sort((left, right) => compare(`${left.pluginId}\u0000${left.id}`, `${right.pluginId}\u0000${right.id}`))
  )])) as unknown as Record<ContributionKind, readonly RegisteredContribution[]>;
  const frozenBindings = Object.fromEntries((["dataSources", "actions", "blocks"] as const).map((kind) => [
    kind,
    freezeEntries([...(bindings.get(kind)?.values() ?? [])].sort((left, right) => compare(left.id, right.id)))
  ])) as Record<BoundContributionKind, readonly RegisteredContribution[]>;
  const inventory = [...manifests.keys()].sort(compare).map((pluginId) => Object.freeze({
    id: pluginId,
    contributions: Object.freeze(Object.fromEntries(contributionKinds
      .map((kind) => [kind, Object.freeze([...(actual.get(pluginId)?.get(kind)?.keys() ?? [])].sort(compare))] as const)
      .filter(([, ids]) => ids.length > 0))),
    capabilityAccess: Object.freeze([...(capabilityAccess.get(pluginId) ?? [])].sort(compare))
  }));

  return Object.freeze({
    phases: Object.freeze([...registrationPhases]),
    inventory: Object.freeze(inventory),
    contributions: Object.freeze(contributions),
    bindings: Object.freeze(frozenBindings)
  });
}
