import type { ActionDefinition } from "./action.js";
import { ActionGatewayError, type ActionGatewayPolicy } from "./action-gateway.js";
import {
  type ExtensionCapabilityAuthority,
  type ExtensionCapabilityClaims,
  type ExtensionCapabilityGrant,
  type ExtensionCapabilityId
} from "./extension-capability-gateway.js";
import type {
  DataSourcePolicyDecision,
  DataSourcePolicyRequest,
  DataSourcePolicyService
} from "./data-source-authorization.js";
import type { RealtimeSubscriptionContext, RealtimeTopicDefinition } from "./realtime.js";
import type { HotApplicationCapabilityAuthorizer } from "./hot-application-runtime.js";
import type { PluginSettingsAuthorizer } from "./plugin-settings.js";
import { ToolGatewayError, type ToolAuthorizationEvaluator, type ToolExecutionContext } from "./tool-gateway.js";
import { canonicalJson, ExtensionCapabilityRequestSchema, type AgentToolDescriptor, type DataSourceDescriptor, type PluginSettingsDescriptor } from "@k-nex/contracts";

import { CurrentAuthorityAdapter, isCurrentAuthorityTarget, type CurrentAuthorityTarget } from "./current-authority-adapter.js";

type DataSourceTargetSelector = Readonly<{
  source(descriptor: DataSourceDescriptor, surface: string): CurrentAuthorityTarget;
  field(descriptor: DataSourceDescriptor, fieldId: string, surface: string): CurrentAuthorityTarget;
}>;

type PermissionDescriptor = Readonly<{ id: string; permission: string }>;

async function permits<TContext>(
  authority: CurrentAuthorityAdapter<TContext>,
  context: TContext,
  target: () => CurrentAuthorityTarget,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    return await authority.allows(context, target(), signal);
  } catch {
    return false;
  }
}

function deniedDataSource(): DataSourcePolicyDecision {
  return Object.freeze({ sourceAllowed: false, recordScope: undefined, allowedFields: Object.freeze([]) });
}

/**
 * Intersects a server-selected RBAC source/field decision with the pre-existing
 * domain policy. Target selectors receive registered descriptors only, never an
 * authenticated request or its client-controlled authorization context.
 */
export class CurrentAuthorityDataSourcePolicy<TContext> implements DataSourcePolicyService {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (request: DataSourcePolicyRequest) => TContext,
    private readonly targets: DataSourceTargetSelector,
    private readonly domain: DataSourcePolicyService
  ) {}

  async authorize(request: DataSourcePolicyRequest): Promise<DataSourcePolicyDecision> {
    const context = this.context(request);
    if (!await permits(this.authority, context, () => this.targets.source(request.descriptor, request.surface))) return deniedDataSource();
    try {
      const domain = await this.domain.authorize(request);
      if (!domain.sourceAllowed) return deniedDataSource();
      const allowedFields: string[] = [];
      for (const fieldId of domain.allowedFields) {
        if (await permits(this.authority, context, () => this.targets.field(request.descriptor, fieldId, request.surface))) allowedFields.push(fieldId);
      }
      return Object.freeze({ sourceAllowed: true, recordScope: domain.recordScope, allowedFields: Object.freeze(allowedFields) });
    } catch {
      return deniedDataSource();
    }
  }
}

/** Wraps the existing action policy port; its downstream policy is unreachable until RBAC admits the registered action. */
export class CurrentAuthorityActionGatewayPolicy<TContext> implements ActionGatewayPolicy {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (request: Parameters<ActionGatewayPolicy["authorize"]>[0]) => TContext,
    private readonly target: (action: ActionDefinition, input: unknown) => CurrentAuthorityTarget,
    private readonly domain: ActionGatewayPolicy
  ) {}

  async authorize(request: Parameters<ActionGatewayPolicy["authorize"]>[0]): Promise<unknown> {
    if (!await permits(this.authority, this.context(request), () => this.target(request.action, request.input))) {
      throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Current authority does not permit this action.");
    }
    return this.domain.authorize(request);
  }
}

/** Wraps the existing tool authorization port before budgets, approvals, and dispatch. */
export class CurrentAuthorityToolAuthorization<TContext> implements ToolAuthorizationEvaluator {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (request: Omit<ToolExecutionContext, "authorization" | "budget" | "signal">) => TContext,
    private readonly target: (descriptor: AgentToolDescriptor) => CurrentAuthorityTarget,
    private readonly domain: ToolAuthorizationEvaluator
  ) {}

  async authorize(request: Omit<ToolExecutionContext, "authorization" | "budget" | "signal">): Promise<unknown> {
    if (!await permits(this.authority, this.context(request), () => this.target(request.descriptor))) {
      throw new ToolGatewayError("TOOL_FORBIDDEN", 403, "Tool access is forbidden.");
    }
    return this.domain.authorize(request);
  }
}

/** Guards an existing topic's authorize callback; subscription parameters never select its RBAC target. */
export class CurrentAuthorityRealtimeTopicAuthorization<TContext> {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (topic: Readonly<{ id: string }>, subscription: RealtimeSubscriptionContext<Readonly<Record<string, unknown>>>) => TContext,
    private readonly target: (topic: Readonly<{ id: string }>) => CurrentAuthorityTarget
  ) {}

  async authorize(topic: RealtimeTopicDefinition, subscription: RealtimeSubscriptionContext<Readonly<Record<string, unknown>>>): Promise<boolean> {
    if (!await permits(this.authority, this.context(topic, subscription), () => this.target(topic), subscription.signal)) return false;
    try {
      return !subscription.signal.aborted && await topic.authorize(subscription);
    } catch {
      return false;
    }
  }
}

/** Admission helpers for existing settings reads and changes. The callbacks run only after current RBAC allow. */
export class CurrentAuthoritySettingsAuthorization<TContext> implements PluginSettingsAuthorizer<TContext> {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly readTarget: (descriptor: PluginSettingsDescriptor) => CurrentAuthorityTarget,
    private readonly changeTarget: (descriptor: PluginSettingsDescriptor) => CurrentAuthorityTarget
  ) {}

  allowsRead(context: TContext, descriptor: PluginSettingsDescriptor, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, context, () => this.readTarget(descriptor), signal);
  }

  allowsChange(context: TContext, descriptor: PluginSettingsDescriptor, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, context, () => this.changeTarget(descriptor), signal);
  }

  authorize(input: Parameters<PluginSettingsAuthorizer<TContext>["authorize"]>[0]): Promise<boolean> {
    return input.operation === "read"
      ? this.allowsRead(input.context, input.descriptor, input.signal)
      : this.allowsChange(input.context, input.descriptor, input.signal);
  }

  async read<TResult>(context: TContext, descriptor: PluginSettingsDescriptor, operation: () => TResult | Promise<TResult>, signal?: AbortSignal): Promise<TResult | undefined> {
    return await this.allowsRead(context, descriptor, signal) ? operation() : undefined;
  }

  async change<TResult>(context: TContext, descriptor: PluginSettingsDescriptor, operation: () => TResult | Promise<TResult>, signal?: AbortSignal): Promise<TResult | undefined> {
    return await this.allowsChange(context, descriptor, signal) ? operation() : undefined;
  }
}

/** Projects permission visibility for routes, pages, and navigation from registered descriptors only. */
export class CurrentAuthorityPermissionProjection<TContext> {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly target: (kind: "route" | "page" | "navigation", descriptor: PermissionDescriptor) => CurrentAuthorityTarget
  ) {}

  allowsRoute(context: TContext, descriptor: PermissionDescriptor, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, context, () => this.target("route", descriptor), signal);
  }

  allowsPage(context: TContext, descriptor: PermissionDescriptor, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, context, () => this.target("page", descriptor), signal);
  }

  allowsNavigation(context: TContext, descriptor: PermissionDescriptor, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, context, () => this.target("navigation", descriptor), signal);
  }

  async enterRoute<TResult>(context: TContext, descriptor: PermissionDescriptor, enter: () => TResult | Promise<TResult>, signal?: AbortSignal): Promise<TResult> {
    if (!await this.allowsRoute(context, descriptor, signal)) throw new Error("Current authority denied route entry.");
    return enter();
  }

  async renderPage<TResult>(context: TContext, descriptor: PermissionDescriptor, render: () => TResult | Promise<TResult>, signal?: AbortSignal): Promise<TResult> {
    if (!await this.allowsPage(context, descriptor, signal)) throw new Error("Current authority denied page rendering.");
    return render();
  }

  async visibleNavigation(context: TContext, descriptors: readonly PermissionDescriptor[], signal?: AbortSignal): Promise<readonly PermissionDescriptor[]> {
    const visible: PermissionDescriptor[] = [];
    for (const descriptor of descriptors) if (await this.allowsNavigation(context, descriptor, signal)) visible.push(descriptor);
    return Object.freeze(visible);
  }
}

export interface RemoteUiFrameAuthorityIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
}

export interface RemoteUiAuthorityTargets {
  /** Server-registered target for the frame protocol itself. */
  readonly frame: CurrentAuthorityTarget;
  /** Server-registered targets keyed by the declared source IDs. */
  readonly sources: ReadonlyMap<string, CurrentAuthorityTarget>;
  /** Server-registered targets keyed by the declared action IDs. */
  readonly actions: ReadonlyMap<string, CurrentAuthorityTarget>;
}

/**
 * The frame is untrusted: it supplies only a lookup ID. Permission, scope, and
 * facts remain in server-registered targets pinned to the generation identity.
 */
export class CurrentAuthorityRemoteUiFrameAuthorization<TContext> {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (identity: RemoteUiFrameAuthorityIdentity) => TContext,
    private readonly targets: (identity: RemoteUiFrameAuthorityIdentity) => RemoteUiAuthorityTargets
  ) {}

  allowsFrame(identity: RemoteUiFrameAuthorityIdentity, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, this.context(identity), () => this.targets(identity).frame, signal);
  }

  allowsSource(identity: RemoteUiFrameAuthorityIdentity, targetId: string, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, this.context(identity), () => {
      const target = this.targets(identity).sources.get(targetId);
      if (target === undefined) throw new TypeError("Remote source target is not registered.");
      return target;
    }, signal);
  }

  allowsAction(identity: RemoteUiFrameAuthorityIdentity, targetId: string, signal?: AbortSignal): Promise<boolean> {
    return permits(this.authority, this.context(identity), () => {
      const target = this.targets(identity).actions.get(targetId);
      if (target === undefined) throw new TypeError("Remote action target is not registered.");
      return target;
    }, signal);
  }
}

export interface CapabilityAuthorityTargetInput {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  readonly capability: ExtensionCapabilityId;
  readonly grant: ExtensionCapabilityGrant;
}

export interface CurrentAuthorityCapabilityTargetEntry {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  readonly grant: ExtensionCapabilityGrant;
  readonly capabilities: readonly Readonly<{ capability: ExtensionCapabilityId; targets: readonly CurrentAuthorityTarget[] }>[];
}

export interface CurrentAuthorityCapabilityTargetRegistry {
  grantTargets(input: Omit<CapabilityAuthorityTargetInput, "capability">): readonly CurrentAuthorityTarget[] | undefined;
  callTargets(input: CapabilityAuthorityTargetInput): readonly CurrentAuthorityTarget[] | undefined;
}

const capabilityRegistries = new WeakSet<object>();

function impliedCapabilities(grant: ExtensionCapabilityGrant): readonly ExtensionCapabilityId[] {
  if (grant.kind === "records") return grant.operations.map((operation) => operation === "query" ? "records.query" : "records.action");
  if (grant.kind === "app-storage") return grant.operations.map((operation) => `app-storage.${operation}` as ExtensionCapabilityId);
  if (grant.kind === "events") return grant.operations.map((operation) => `events.${operation}` as ExtensionCapabilityId);
  if (grant.kind === "http-fetch") return ["http-fetch.request"];
  if (grant.kind === "files") return grant.operations.map((operation) => `files.${operation}` as ExtensionCapabilityId);
  if (grant.kind === "jobs") return ["jobs.schedule"];
  if (grant.kind === "audit") return ["audit.emit"];
  return [];
}

function capabilityEntryKey(input: Readonly<{ applicationId: string; environment: string; appId: string; generationId: string; grant: ExtensionCapabilityGrant }>): string {
  return canonicalJson({ applicationId: input.applicationId, environment: input.environment, appId: input.appId, generationId: input.generationId, grant: input.grant });
}

/** Closed generation-pinned mapping assembled from verified host registrations. */
export function createCurrentAuthorityCapabilityTargetRegistry(entries: readonly CurrentAuthorityCapabilityTargetEntry[]): CurrentAuthorityCapabilityTargetRegistry {
  const grants = new Map<string, ReadonlyMap<ExtensionCapabilityId, readonly CurrentAuthorityTarget[]>>();
  for (const entry of entries) {
    const parsed = ExtensionCapabilityRequestSchema.safeParse(entry.grant);
    const implied = parsed.success ? impliedCapabilities(parsed.data) : [];
    if (!parsed.success || implied.length === 0 || entry.capabilities.length !== implied.length ||
      !implied.every((capability) => entry.capabilities.some((candidate) => candidate.capability === capability)) ||
      entry.capabilities.some(({ targets }) => targets.length === 0 || targets.some((target) => !isCurrentAuthorityTarget(target)))) {
      throw new TypeError("Capability authority mapping is incomplete or invalid.");
    }
    const key = capabilityEntryKey({ applicationId: entry.applicationId, environment: entry.environment, appId: entry.appId, generationId: entry.generationId, grant: parsed.data });
    if (grants.has(key)) throw new TypeError("Capability authority mapping is duplicate.");
    grants.set(key, new Map(entry.capabilities.map(({ capability, targets }) => [capability, Object.freeze([...targets])] as const)));
  }
  const registry = Object.freeze({
    grantTargets(input: Omit<CapabilityAuthorityTargetInput, "capability">) {
      const mapping = grants.get(capabilityEntryKey(input));
      if (!mapping || mapping.size === 0) return undefined;
      return Object.freeze([...mapping.values()].flat());
    },
    callTargets(input: CapabilityAuthorityTargetInput) {
      return grants.get(capabilityEntryKey(input))?.get(input.capability);
    }
  });
  capabilityRegistries.add(registry);
  return registry;
}

type HotApplicationCapabilityInput = Parameters<HotApplicationCapabilityAuthorizer["authorize"]>[0];

/** Intersects every permission implied by one declared grant before a runner token is minted. */
export class CurrentAuthorityHotApplicationCapabilityAuthorization<TContext> implements HotApplicationCapabilityAuthorizer {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (input: HotApplicationCapabilityInput) => TContext,
    private readonly targets: CurrentAuthorityCapabilityTargetRegistry
  ) {
    if (!capabilityRegistries.has(targets)) throw new TypeError("Capability authority target registry is not trusted.");
  }

  async authorize(input: HotApplicationCapabilityInput): Promise<boolean> {
    let targets: readonly CurrentAuthorityTarget[];
    try { targets = this.targets.grantTargets({ applicationId: input.applicationId, environment: input.environment, appId: input.appId, generationId: input.generationId, grant: input.grant }) ?? []; } catch { return false; }
    if (targets.length === 0) return false;
    const context = this.context(input);
    for (const target of targets) if (!await permits(this.authority, context, () => target)) return false;
    return true;
  }
}

/** Reauthorizes each exact verified grant. This includes the existing `jobs.schedule` host capability and creates no job model. */
export class CurrentAuthorityCapabilityAuthorization<TContext> implements ExtensionCapabilityAuthority {
  constructor(
    private readonly authority: CurrentAuthorityAdapter<TContext>,
    private readonly context: (claims: ExtensionCapabilityClaims) => TContext,
    private readonly targets: CurrentAuthorityCapabilityTargetRegistry
  ) {
    if (!capabilityRegistries.has(targets)) throw new TypeError("Capability authority target registry is not trusted.");
  }

  async reauthorize(claims: ExtensionCapabilityClaims, capability: Readonly<{ capability: ExtensionCapabilityId; grants: readonly ExtensionCapabilityGrant[] }>): Promise<boolean> {
    if (capability.grants.length === 0) return false;
    for (const grant of capability.grants) {
      const targets = this.targets.callTargets({
        applicationId: claims.applicationId,
        environment: claims.environment,
        appId: claims.appId,
        generationId: claims.generationId,
        capability: capability.capability,
        grant
      });
      if (!targets || targets.length === 0) return false;
      for (const target of targets) if (!await permits(this.authority, this.context(claims), () => target)) return false;
    }
    return true;
  }
}
