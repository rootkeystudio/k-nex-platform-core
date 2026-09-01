import type {
  AgentToolDescriptor, DataSourceDefinition, PluginContributionCategory,
  PluginContributionRequirement, PluginManifest, RegistrationPhase
} from "@k-nex/contracts";
import {
  AgentToolDescriptorSchema, AuthorizationPermissionDescriptorSchema, PluginNavigationDescriptorSchema,
  PluginEventDescriptorSchema, PluginHealthAuditDescriptorSchema, PluginJobDescriptorSchema,
  PluginLifecycleDescriptorSchema, PluginLocalizationDescriptorSchema, PluginMigrationDescriptorSchema,
  PluginPageTemplateDescriptorSchema, PluginRouteDescriptorSchema, PluginSettingsDescriptorSchema,
  PluginRealtimeTopicDescriptorSchema, PluginServiceDescriptorSchema, PluginTestingMetadataDescriptorSchema,
  PluginUiContributionDescriptorSchema, assertDataSourceDefinition,
  pluginContributionCategoryKeys, pluginContributionRegistry, registrationPhases
} from "@k-nex/contracts";
import * as semver from "semver";
import { actionToolCompatible, assertActionDefinition, type ActionDefinition, type ActionHandler } from "./action.js";
import { dataSourceToolCompatible, type DataSourceHandler } from "./data-source-gateway.js";
import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";
import {
  createRegistrationLifecycleAuthority,
  freezeRegistrationLifecycleAuthority,
  leaseCapabilityService,
  retainRegistrationLifecycleAuthority
} from "./registration-lifecycle-authority.js";

export type ContributionKind = PluginContributionCategory;
export type BoundContributionKind = Extract<ContributionKind, "sources" | "actions" | "events" | "jobs" | "realtimeTopics" | "components" | "blocks">;

type ContributionKindsForPhase<Phase extends RegistrationPhase> = {
  [Kind in ContributionKind]: (typeof pluginContributionRegistry)[Kind]["registrationPhase"] extends Phase ? Kind : never;
}[ContributionKind];
type ContractsContributionKind = ContributionKindsForPhase<"contracts">;
type SchemaContributionKind = ContributionKindsForPhase<"schema">;
type BehaviorContributionKind = ContributionKindsForPhase<"behavior">;
type JobsContributionKind = ContributionKindsForPhase<"jobs">;
type UiContributionKind = ContributionKindsForPhase<"ui">;
type ValidateContributionKind = ContributionKindsForPhase<"validate">;
const boundContributionKinds = ["sources", "actions", "events", "jobs", "realtimeTopics", "components", "blocks"] as const satisfies readonly BoundContributionKind[];

export type RegistrationErrorCode =
  | "GRAPH_MISMATCH" | "WRONG_PHASE" | "UNDECLARED_CONTRIBUTION" | "UNDECLARED_CAPABILITY_ACCESS"
  | "CAPABILITY_UNAVAILABLE" | "PROVIDER_MISMATCH" | "DUPLICATE_CONTRIBUTION" | "DUPLICATE_BINDING"
  | "INVALID_CONTRIBUTION" | "FROZEN" | "INVENTORY_MISMATCH";

export class RegistrationError extends Error {
  readonly path: readonly string[];
  constructor(readonly code: RegistrationErrorCode, message: string, path: readonly string[] = []) {
    super(message);
    this.name = "RegistrationError";
    this.path = Object.freeze([...path]);
  }
}

export interface ScopedServices { get<T = unknown>(capability: string): T; }
export interface PhaseContext { readonly pluginId: string; readonly services: ScopedServices; }
export interface ContributionRegistrationContext<Kind extends ContributionKind> extends PhaseContext {
  register(kind: Kind, id: string, value: unknown): void;
}
export interface ContractsRegistrationContext extends ContributionRegistrationContext<ContractsContributionKind> {
  register(kind: Exclude<ContractsContributionKind, "sources" | "actions" | "tools">, id: string, value: unknown): void;
  register(kind: "sources", id: string, value: DataSourceDefinition): void;
  register(kind: "actions", id: string, value: ActionDefinition): void;
  register(kind: "tools", id: string, value: AgentToolDescriptor): void;
}
export interface ProvidersRegistrationContext extends PhaseContext { provide(capability: string, service: unknown): void; }
export type SchemaRegistrationContext = ContributionRegistrationContext<SchemaContributionKind>;
export type BehaviorRegistrationContext = ContributionRegistrationContext<BehaviorContributionKind>;
export interface JobsRegistrationContext extends ContributionRegistrationContext<JobsContributionKind> {
  bind(id: string, handler: (...args: never[]) => unknown): void;
}
export type ValidateRegistrationContext = ContributionRegistrationContext<ValidateContributionKind>;
export interface DataHandlersRegistrationContext extends PhaseContext {
  bind(kind: "sources", id: string, handler: DataSourceHandler): void;
  bind(kind: "actions", id: string, handler: ActionHandler): void;
  bind(kind: "events" | "realtimeTopics", id: string, handler: (...args: never[]) => unknown): void;
}
export interface UiRegistrationContext extends ContributionRegistrationContext<UiContributionKind> {
  bindRenderer(kind: "components" | "blocks", id: string, renderer: (...args: never[]) => unknown): void;
}
export interface AdminRegistrationContext extends PhaseContext {}
export interface PluginRegistration {
  readonly pluginId: string;
  readonly contracts?: (context: ContractsRegistrationContext) => void;
  readonly providers?: (context: ProvidersRegistrationContext) => void;
  readonly schema?: (context: SchemaRegistrationContext) => void;
  readonly behavior?: (context: BehaviorRegistrationContext) => void;
  readonly jobs?: (context: JobsRegistrationContext) => void;
  readonly dataHandlers?: (context: DataHandlersRegistrationContext) => void;
  readonly ui?: (context: UiRegistrationContext) => void;
  readonly admin?: (context: AdminRegistrationContext) => void;
  readonly validate?: (context: ValidateRegistrationContext) => void;
}
export function definePluginRegistration<const Registration extends PluginRegistration>(registration: Registration): Readonly<Registration> {
  return Object.freeze(registration);
}
export interface RegisteredContribution { readonly pluginId: string; readonly id: string; readonly value: unknown; }
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
  readonly graph: ResolvedPlatformPluginGraph;
  readonly installed: readonly InstalledPlatformPluginManifest[];
  readonly registrations: readonly PluginRegistration[];
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
function fail(code: RegistrationErrorCode, message: string, path: readonly string[] = []): never {
  throw new RegistrationError(code, message, path);
}
function isContributionKind(kind: string): kind is ContributionKind {
  return (pluginContributionCategoryKeys as readonly string[]).includes(kind);
}
function declaredContributions(manifest: PluginManifest): ReadonlyMap<ContributionKind, ReadonlyMap<string, PluginContributionRequirement>> {
  return new Map(pluginContributionCategoryKeys.map((kind) => [
    kind, new Map(Object.entries(manifest.contributions?.[kind] ?? {}))
  ]));
}
function declaredCapabilities(manifest: PluginManifest): ReadonlySet<string> {
  return new Set([...manifest.requires, ...manifest.optional]
    .filter((dependency): dependency is Extract<(typeof manifest.requires)[number], { capability: string }> => "capability" in dependency)
    .map((dependency) => dependency.capability));
}
function declaredCapabilityRanges(manifest: PluginManifest): ReadonlyMap<string, readonly string[]> {
  const ranges = new Map<string, string[]>();
  for (const dependency of [...manifest.requires, ...manifest.optional]) {
    if (!("capability" in dependency)) continue;
    const values = ranges.get(dependency.capability) ?? [];
    values.push(dependency.version);
    ranges.set(dependency.capability, values);
  }
  return ranges;
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
function activeManifests(graph: ResolvedPlatformPluginGraph, installed: readonly InstalledPlatformPluginManifest[]): ReadonlyMap<string, PluginManifest> {
  const installedById = new Map(installed.map((entry) => [entry.manifest.id, entry]));
  const active = new Map<string, PluginManifest>();
  for (const node of graph.plugins) {
    const entry = installedById.get(node.id);
    if (!entry || entry.manifest.package !== node.package || entry.manifest.version !== node.version ||
      entry.package.name !== node.package || entry.package.version !== node.version ||
      entry.package.integrity !== node.integrity || entry.manifest.kind !== node.kind || active.has(node.id)) {
      fail("GRAPH_MISMATCH", `Resolved plugin ${node.id} does not match one installed manifest.`, [node.id]);
    }
    active.set(node.id, entry.manifest);
  }
  const ids = new Set(active.keys());
  if (graph.registrationOrder.length !== ids.size || new Set(graph.registrationOrder).size !== ids.size ||
    graph.registrationOrder.some((id) => !ids.has(id))) {
    fail("GRAPH_MISMATCH", "Registration order must contain every resolved plugin exactly once.");
  }
  return active;
}
function freezeEntries(entries: readonly RegisteredContribution[]): readonly RegisteredContribution[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}
function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (child: unknown): void => {
    if (typeof child !== "object" || child === null || Object.isFrozen(child)) return;
    for (const value of Object.values(child)) freeze(value);
    Object.freeze(child);
  };
  freeze(clone);
  return clone;
}

function configurationContribution(kind: ContributionKind, id: string, pluginId: string, value: unknown): unknown {
  const schema = kind === "settings" ? PluginSettingsDescriptorSchema
    : kind === "permissions" ? AuthorizationPermissionDescriptorSchema
      : kind === "routes" ? PluginRouteDescriptorSchema
        : kind === "navigation" ? PluginNavigationDescriptorSchema
          : kind === "pageTemplates" ? PluginPageTemplateDescriptorSchema
            : kind === "components" || kind === "blocks" ? PluginUiContributionDescriptorSchema
              : kind === "migrations" ? PluginMigrationDescriptorSchema
                : kind === "services" ? PluginServiceDescriptorSchema
                  : kind === "events" ? PluginEventDescriptorSchema
                    : kind === "jobs" ? PluginJobDescriptorSchema
                      : kind === "realtimeTopics" ? PluginRealtimeTopicDescriptorSchema
                        : kind === "localization" ? PluginLocalizationDescriptorSchema
                          : kind === "healthAudit" ? PluginHealthAuditDescriptorSchema
                            : kind === "lifecycle" ? PluginLifecycleDescriptorSchema
                              : kind === "testingMetadata" ? PluginTestingMetadataDescriptorSchema
          : undefined;
  if (schema === undefined) return value;
  const parsed = schema.safeParse(value);
  const publisher = parsed.success
    ? (parsed.data as { readonly publisher?: { readonly kind?: string; readonly deliveryClass?: string; readonly extensionId?: string } }).publisher
    : undefined;
  if (!parsed.success || parsed.data.id !== id || (kind === "permissions"
    ? publisher?.kind !== "extension" || publisher.deliveryClass !== "platform-plugin" || publisher.extensionId !== pluginId
    : (parsed.data as { readonly ownerPluginId?: string }).ownerPluginId !== pluginId)) {
    fail("INVALID_CONTRIBUTION", `${kind} contribution identity must match ${pluginId}:${id}.`, [pluginId, kind, id]);
  }
  if ((kind === "components" || kind === "blocks") && (parsed.data as { readonly kind?: string }).kind !== (kind === "components" ? "component" : "block")) {
    fail("INVALID_CONTRIBUTION", `${kind} contribution kind must match its inventory category.`, [pluginId, kind, id]);
  }
  return frozenClone(parsed.data);
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
  const bindings = new Map<BoundContributionKind, Map<string, RegisteredContribution>>(
    boundContributionKinds.map((kind) => [kind, new Map()])
  );
  const contributionOwners = new Map<string, string>();
  const capabilityAccess = new Map<string, Set<string>>();
  const services = new Map<string, unknown>();
  const declarations = new Map([...manifests].map(([id, manifest]) => [id, declaredContributions(manifest)]));
  const allowedCapabilities = new Map([...manifests].map(([id, manifest]) => [id, declaredCapabilities(manifest)]));
  const capabilityRanges = new Map([...manifests].map(([id, manifest]) => [id, declaredCapabilityRanges(manifest)]));
  const graphNodes = new Map(options.graph.plugins.map((node) => [node.id, node]));
  const provided = new Map([...manifests].map(([id, manifest]) => [id, providedCapabilities(manifest)]));
  const selectedProviders = new Map<string, (typeof options.graph.capabilityProviders)[number]>();
  for (const selection of options.graph.capabilityProviders) {
    if (selectedProviders.has(selection.capability) || !provided.get(selection.plugin)?.get(selection.capability)?.has(selection.version)) {
      fail("GRAPH_MISMATCH", `Capability selection ${selection.capability} does not match one resolved provider.`, [selection.capability]);
    }
    selectedProviders.set(selection.capability, selection);
  }
  const requiredProviders = new Map<string, ReadonlySet<string>>();
  for (const [pluginId, manifest] of manifests) {
    const node = graphNodes.get(pluginId);
    const providers = new Set<string>();
    for (const dependency of manifest.requires) {
      if ("plugin" in dependency) {
        if (!node?.required.includes(dependency.plugin)) {
          fail("GRAPH_MISMATCH", `Resolved graph omits required provider ${dependency.plugin} for ${pluginId}.`, [pluginId, dependency.plugin]);
        }
        providers.add(dependency.plugin);
        continue;
      }
      const selection = selectedProviders.get(dependency.capability);
      if (!selection || !node?.required.includes(selection.plugin) ||
        !semver.satisfies(selection.version, dependency.version, { loose: false, includePrerelease: false })) {
        fail("GRAPH_MISMATCH", `Resolved graph omits required capability provider ${dependency.capability} for ${pluginId}.`, [pluginId, dependency.capability]);
      }
      providers.add(selection.plugin);
    }
    requiredProviders.set(pluginId, providers);
  }
  const lifecycleAuthority = createRegistrationLifecycleAuthority(requiredProviders);
  let phase: RegistrationPhase = "manifest";
  let currentPlugin: string | undefined;
  let frozen = false;
  for (const id of manifests.keys()) {
    actual.set(id, new Map(pluginContributionCategoryKeys.map((kind) => [kind, new Map()])));
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
      const node = graphNodes.get(pluginId);
      const granted = selection !== undefined && [...(node?.required ?? []), ...(node?.optional ?? [])].includes(selection.plugin) &&
        (capabilityRanges.get(pluginId)?.get(capability) ?? []).some((range) =>
          semver.satisfies(selection.version, range, { loose: false, includePrerelease: false }));
      if (!selection || !granted || !services.has(capability)) {
        fail("CAPABILITY_UNAVAILABLE", `Capability ${capability} is not bound for plugin ${pluginId}.`, [pluginId, capability]);
      }
      capabilityAccess.get(pluginId)?.add(capability);
      return leaseCapabilityService(services.get(capability) as T, lifecycleAuthority, pluginId, selection.plugin);
    }
  });
  const register = (expectedPhase: RegistrationPhase, pluginId: string, kind: ContributionKind, id: string, value: unknown): void => {
    if (!isContributionKind(kind)) fail("INVALID_CONTRIBUTION", `Unknown contribution category ${kind}.`, [pluginId, kind, id]);
    if (pluginContributionRegistry[kind].registrationPhase !== expectedPhase) {
      fail("WRONG_PHASE", `Contribution category ${kind} does not register during ${expectedPhase}.`, [pluginId, kind, expectedPhase]);
    }
    assertPhase(expectedPhase, pluginId);
    if (!declarations.get(pluginId)?.get(kind)?.has(id)) {
      fail("UNDECLARED_CONTRIBUTION", `Plugin ${pluginId} did not declare ${kind} contribution ${id}.`, [pluginId, kind, id]);
    }
    value = configurationContribution(kind, id, pluginId, value);
    if (kind === "sources") {
      let definition: DataSourceDefinition;
      try { assertDataSourceDefinition(value); definition = value; } catch {
        fail("INVALID_CONTRIBUTION", `Source contribution ${id} must be a valid definition.`, [pluginId, kind, id]);
      }
      if (definition.descriptor.id !== id || definition.descriptor.ownerPluginId !== pluginId) {
        fail("INVALID_CONTRIBUTION", `Source descriptor identity must match ${pluginId}:${id}.`, [pluginId, kind, id]);
      }
    }
    if (kind === "actions") {
      let definition: ActionDefinition;
      try { assertActionDefinition(value); definition = value; } catch {
        fail("INVALID_CONTRIBUTION", `Action contribution ${id} must be a valid definition.`, [pluginId, kind, id]);
      }
      if (definition.descriptor.id !== id || definition.descriptor.ownerPluginId !== pluginId) {
        fail("INVALID_CONTRIBUTION", `Action descriptor identity must match ${pluginId}:${id}.`, [pluginId, kind, id]);
      }
      value = Object.freeze({ ...definition, descriptor: frozenClone(definition.descriptor) });
    }
    if (kind === "tools") {
      const parsed = AgentToolDescriptorSchema.safeParse(value);
      if (!parsed.success) fail("INVALID_CONTRIBUTION", `Tool contribution ${id} must be a valid descriptor.`, [pluginId, kind, id]);
      const descriptor: AgentToolDescriptor = parsed.data;
      if (descriptor.id !== id || descriptor.ownerPluginId !== pluginId || !manifests.has(descriptor.ownerPluginId)) {
        fail("INVALID_CONTRIBUTION", `Tool descriptor identity must match installed plugin ${pluginId}:${id}.`, [pluginId, kind, id]);
      }
      value = frozenClone(descriptor);
    }
    const owner = contributionOwners.get(id);
    if (owner) fail("DUPLICATE_CONTRIBUTION", `Contribution ${id} is already registered by ${owner}.`, [id, owner, pluginId]);
    contributionOwners.set(id, pluginId);
    actual.get(pluginId)?.get(kind)?.set(id, value);
  };
  const bind = (expectedPhase: RegistrationPhase, pluginId: string, kind: BoundContributionKind, id: string, value: unknown): void => {
    assertPhase(expectedPhase, pluginId);
    if (typeof value !== "function") {
      fail("INVALID_CONTRIBUTION", `${kind} binding ${id} must be a function.`, [pluginId, kind, id]);
    }
    if (!actual.get(pluginId)?.get(kind)?.has(id)) {
      fail("UNDECLARED_CONTRIBUTION", `Plugin ${pluginId} cannot bind undeclared ${kind} contribution ${id}.`, [pluginId, kind, id]);
    }
    const entries = bindings.get(kind);
    if (entries?.has(id)) fail("DUPLICATE_BINDING", `Contribution ${id} already has a ${kind} binding.`, [pluginId, kind, id]);
    entries?.set(id, { pluginId, id, value });
  };
  const categoryContext = <Kind extends ContributionKind>(pluginId: string, nextPhase: RegistrationPhase): ContributionRegistrationContext<Kind> => ({
    pluginId, services: scopedServices(pluginId), register: (kind, id, value) => register(nextPhase, pluginId, kind, id, value)
  });
  const run = (nextPhase: RegistrationPhase): void => {
    phase = nextPhase;
    for (const pluginId of options.graph.registrationOrder) {
      const plan = plans.get(pluginId);
      currentPlugin = pluginId;
      const base = { pluginId, services: scopedServices(pluginId) };
      if (nextPhase === "contracts") plan?.contracts?.(categoryContext<ContractsContributionKind>(pluginId, nextPhase));
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
          if ((typeof service !== "object" || service === null) && typeof service !== "function") {
            fail("INVALID_CONTRIBUTION", `Capability ${capability} service must be an object or function.`, [pluginId, capability]);
          }
          services.set(capability, service);
        }
      });
      else if (nextPhase === "schema") plan?.schema?.(categoryContext<SchemaContributionKind>(pluginId, nextPhase));
      else if (nextPhase === "behavior") plan?.behavior?.(categoryContext<BehaviorContributionKind>(pluginId, nextPhase));
      else if (nextPhase === "jobs") plan?.jobs?.({
        ...categoryContext<JobsContributionKind>(pluginId, nextPhase),
        bind: (id, value) => bind("jobs", pluginId, "jobs", id, value)
      });
      else if (nextPhase === "data-handlers") plan?.dataHandlers?.({ ...base, bind: (kind, id, value) => bind("data-handlers", pluginId, kind, id, value) });
      else if (nextPhase === "ui") plan?.ui?.({
        ...categoryContext<UiContributionKind>(pluginId, nextPhase),
        bindRenderer: (kind, id, value) => bind("ui", pluginId, kind, id, value)
      });
      else if (nextPhase === "admin") plan?.admin?.(base);
      else if (nextPhase === "validate") plan?.validate?.(categoryContext<ValidateContributionKind>(pluginId, nextPhase));
    }
    currentPlugin = undefined;
  };
  for (const nextPhase of registrationPhases) if (!["manifest", "freeze"].includes(nextPhase)) run(nextPhase);

  const mismatches: string[] = [];
  for (const pluginId of [...manifests.keys()].sort(compare)) {
    const declared = declarations.get(pluginId)!;
    for (const kind of pluginContributionCategoryKeys) {
      const registered = actual.get(pluginId)?.get(kind) ?? new Map<string, unknown>();
      for (const [id, requirement] of declared.get(kind) ?? []) {
        if (requirement === "required" && !registered.has(id)) mismatches.push(`${pluginId}:${kind}:${id}`);
      }
    }
    for (const kind of boundContributionKinds) {
      for (const id of actual.get(pluginId)?.get(kind)?.keys() ?? []) {
        if (!bindings.get(kind)?.has(id)) mismatches.push(`${pluginId}:${kind}:${id}:binding`);
      }
    }
  }
  for (const [pluginId, byKind] of actual) {
    const reference = (
      originKind: ContributionKind,
      originId: string,
      targetKind: ContributionKind,
      targetId: string,
      version?: number,
      requireBinding = false
    ): void => {
      const value = actual.get(pluginId)?.get(targetKind)?.get(targetId);
      const registeredVersion = targetKind === "sources"
        ? (value as DataSourceDefinition | undefined)?.descriptor.version
        : targetKind === "actions"
          ? (value as ActionDefinition | undefined)?.descriptor.version
          : (value as { readonly version?: number } | undefined)?.version;
      if (contributionOwners.get(targetId) !== pluginId || value === undefined || version !== undefined && registeredVersion !== version ||
        requireBinding && bindings.get(targetKind as BoundContributionKind)?.get(targetId)?.pluginId !== pluginId) {
        mismatches.push(`${pluginId}:${originKind}:${originId}:${targetKind}:${targetId}${version === undefined ? "" : `@${version}`}`);
      }
    };
    const messageIds = new Set([...(byKind.get("localization")?.values() ?? [])]
      .flatMap((value) => Object.keys((value as { readonly messages?: Readonly<Record<string, string>> }).messages ?? {})));
    for (const [settingsId, value] of byKind.get("settings") ?? []) {
      const descriptor = value as { readonly readPermission: string; readonly changePermission: string };
      reference("settings", settingsId, "permissions", descriptor.readPermission);
      reference("settings", settingsId, "permissions", descriptor.changePermission);
    }
    for (const [sourceId, value] of byKind.get("sources") ?? []) {
      const descriptor = (value as DataSourceDefinition).descriptor;
      reference("sources", sourceId, "permissions", descriptor.permission);
      for (const field of descriptor.outputFields ?? []) {
        if (field.permission !== undefined) reference("sources", sourceId, "permissions", field.permission);
      }
    }
    for (const [actionId, value] of byKind.get("actions") ?? []) {
      reference("actions", actionId, "permissions", (value as ActionDefinition).descriptor.permission);
    }
    for (const [routeId, value] of byKind.get("routes") ?? []) {
      const descriptor = value as { readonly permission: string; readonly viewId: string };
      reference("routes", routeId, "permissions", descriptor.permission);
      reference("routes", routeId, "pageTemplates", descriptor.viewId);
    }
    for (const [navigationId, value] of byKind.get("navigation") ?? []) {
      const descriptor = value as { readonly labelMessageId?: string; readonly route: { readonly routeId: string }; readonly permission: string; readonly parentId?: string };
      const labelMessageId = descriptor.labelMessageId;
      if (labelMessageId === undefined || !messageIds.has(labelMessageId)) mismatches.push(`${pluginId}:navigation:${navigationId}:localization`);
      reference("navigation", navigationId, "routes", descriptor.route.routeId);
      reference("navigation", navigationId, "permissions", descriptor.permission);
      if (descriptor.parentId !== undefined) reference("navigation", navigationId, "navigation", descriptor.parentId);
    }
    for (const [toolId, value] of byKind.get("tools") ?? []) {
      const descriptor = value as AgentToolDescriptor;
      reference("tools", toolId, "permissions", descriptor.permission);
      const targetKind: Extract<ContributionKind, "sources" | "actions"> = descriptor.invocation.kind === "source" ? "sources" : "actions";
      const targetId = descriptor.invocation.kind === "source" ? descriptor.invocation.source.id : descriptor.invocation.action.id;
      const targetOwner = contributionOwners.get(targetId);
      const target = targetOwner === undefined ? undefined : actual.get(targetOwner)?.get(targetKind)?.get(targetId);
      const hasOwnedBinding = targetOwner === pluginId && bindings.get(targetKind)?.get(targetId)?.pluginId === pluginId;
      const compatible = descriptor.invocation.kind === "source"
        ? target !== undefined && dataSourceToolCompatible(descriptor, (target as DataSourceDefinition).descriptor)
        : target !== undefined && actionToolCompatible(descriptor, (target as ActionDefinition).descriptor);
      if (!hasOwnedBinding || !compatible) mismatches.push(`${pluginId}:tools:${toolId}:binding`);
    }
    for (const [uiId, value] of [...(byKind.get("components") ?? []), ...(byKind.get("blocks") ?? [])]) {
      const originKind = byKind.get("components")?.has(uiId) ? "components" : "blocks";
      const descriptor = value as { readonly permission?: string; readonly actionPolicy?: { readonly actions: readonly { readonly id: string; readonly version: number }[] } };
      if (descriptor.permission !== undefined) reference(originKind, uiId, "permissions", descriptor.permission);
      for (const action of descriptor.actionPolicy?.actions ?? []) {
        reference(originKind, uiId, "actions", action.id, action.version, true);
      }
    }
    for (const [eventId, value] of byKind.get("events") ?? []) {
      reference("events", eventId, "sources", (value as { readonly sourceId: string }).sourceId, undefined, true);
    }
    for (const [topicId, value] of byKind.get("realtimeTopics") ?? []) {
      const descriptor = value as { readonly eventId: string; readonly sourceId: string; readonly permission: string };
      reference("realtimeTopics", topicId, "events", descriptor.eventId, undefined, true);
      reference("realtimeTopics", topicId, "sources", descriptor.sourceId, undefined, true);
      reference("realtimeTopics", topicId, "permissions", descriptor.permission);
    }
    for (const [testingId, value] of byKind.get("testingMetadata") ?? []) {
      if ((value as { readonly conformancePluginId: string }).conformancePluginId !== pluginId) {
        mismatches.push(`${pluginId}:testingMetadata:${testingId}:plugin`);
      }
    }
    for (const [templateId, value] of byKind.get("pageTemplates") ?? []) {
      const template = value as {
        readonly route: { readonly routeId: string };
        readonly permission: string;
        readonly requirements: {
          readonly capabilities: readonly { readonly id: string; readonly version: string }[];
          readonly sources: readonly { readonly id: string; readonly version: number }[];
          readonly actions: readonly { readonly id: string; readonly version: number }[];
          readonly blocks: readonly { readonly id: string; readonly version: number }[];
        };
      };
      reference("pageTemplates", templateId, "routes", template.route.routeId);
      reference("pageTemplates", templateId, "permissions", template.permission);
      for (const requirement of template.requirements.capabilities) {
        const selected = selectedProviders.get(requirement.id);
        if (selected?.version !== requirement.version) mismatches.push(`${pluginId}:pageTemplates:${templateId}:capability:${requirement.id}@${requirement.version}`);
      }
      for (const [kind, requirements] of [
        ["sources", template.requirements.sources],
        ["actions", template.requirements.actions],
        ["blocks", template.requirements.blocks]
      ] as const) {
        for (const requirement of requirements) {
          reference("pageTemplates", templateId, kind, requirement.id, requirement.version, kind === "sources" || kind === "actions" || kind === "blocks");
        }
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
  freezeRegistrationLifecycleAuthority(lifecycleAuthority);
  const contributions = Object.fromEntries(pluginContributionCategoryKeys.map((kind) => [kind, freezeEntries(
    [...actual.entries()].flatMap(([pluginId, byKind]) => [...(byKind.get(kind)?.entries() ?? [])].map(([id, value]) => ({ pluginId, id, value })))
      .sort((left, right) => compare(`${left.pluginId}\u0000${left.id}`, `${right.pluginId}\u0000${right.id}`))
  )])) as Record<ContributionKind, readonly RegisteredContribution[]>;
  const frozenBindings = Object.fromEntries(boundContributionKinds.map((kind) => [
    kind, freezeEntries([...(bindings.get(kind)?.values() ?? [])].sort((left, right) => compare(left.id, right.id)))
  ])) as Record<BoundContributionKind, readonly RegisteredContribution[]>;
  const inventory = [...manifests.keys()].sort(compare).map((pluginId) => Object.freeze({
    id: pluginId,
    contributions: Object.freeze(Object.fromEntries(pluginContributionCategoryKeys
      .map((kind) => [kind, Object.freeze([...(actual.get(pluginId)?.get(kind)?.keys() ?? [])].sort(compare))] as const)
      .filter(([, ids]) => ids.length > 0))),
    capabilityAccess: Object.freeze([...(capabilityAccess.get(pluginId) ?? [])].sort(compare))
  }));
  const result = Object.freeze({
    phases: Object.freeze([...registrationPhases]), inventory: Object.freeze(inventory),
    contributions: Object.freeze(contributions), bindings: Object.freeze(frozenBindings)
  });
  retainRegistrationLifecycleAuthority(
    result,
    lifecycleAuthority,
    new Set(result.contributions.lifecycle.map(({ pluginId }) => pluginId))
  );
  return result;
}
