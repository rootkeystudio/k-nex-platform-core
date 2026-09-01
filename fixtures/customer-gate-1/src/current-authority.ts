import type { AgentToolDescriptor, DataSourceDescriptor } from "@k-nex/contracts";
import {
  CurrentAuthorityAdapter,
  CurrentAuthorityPermissionProjection,
  CurrentAuthorityRealtimeTopicAuthorization,
  CurrentAuthorityRemoteUiFrameAuthorization,
  EffectiveAuthorityResolver,
  createAuthorizationCatalogProvider,
  createCurrentAuthorityTarget,
  createEffectiveAuthorizationCatalog,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  createTrustedAuthorizationSession,
  type CurrentAuthorityTarget,
  type ActionDefinition,
  type ScopedRegistrationResult,
  type TrustedAuthorizationSession,
  type RealtimeSubscriptionContext,
  type RealtimeTopicDefinition,
  type RemoteUiFrameAuthorityIdentity
} from "@k-nex/runtime";
import { PostgresAuthorizationStore, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import type { PayloadRequest } from "payload";

const applicationId = "customer-gate-1";
const environment = "production";
const owner = Object.freeze({ kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 });

export interface FixtureAuthorityContext {
  /** Actor-isolated cache identity; current RBAC is rechecked before every cache lookup. */
  readonly permissionFingerprint: string;
}

export type FixtureSalesProfile = "normal" | "done";

export interface FixtureCurrentAuthority {
  readonly adapter: CurrentAuthorityAdapter<FixtureAuthorityContext>;
  readonly permissions: CurrentAuthorityPermissionProjection<FixtureAuthorityContext>;
  context(request: PayloadRequest, correlationId: string, user?: unknown): FixtureAuthorityContext;
  salesProfile(context: FixtureAuthorityContext): FixtureSalesProfile;
  source(descriptor: DataSourceDescriptor, surface: string): CurrentAuthorityTarget;
  field(descriptor: DataSourceDescriptor, fieldId: string, surface: string): CurrentAuthorityTarget;
  action(action: ActionDefinition, input: unknown): CurrentAuthorityTarget;
  tool(descriptor: AgentToolDescriptor): CurrentAuthorityTarget;
  authorizeRealtime(
    context: FixtureAuthorityContext,
    topic: RealtimeTopicDefinition,
    subscription: RealtimeSubscriptionContext<Readonly<Record<string, unknown>>>
  ): Promise<boolean>;
  payload(collection: string, operation: "find" | "create" | "update"): CurrentAuthorityTarget;
  remoteUi(context: FixtureAuthorityContext): FixtureRemoteUiAuthorization;
}

export interface FixtureRemoteUiAuthorization {
  authorizeRoute(identity: RemoteUiFrameAuthorityIdentity, signal?: AbortSignal): Promise<boolean>;
  authorizeFrame(identity: RemoteUiFrameAuthorityIdentity, signal?: AbortSignal): Promise<boolean>;
  authorizeTarget(identity: RemoteUiFrameAuthorityIdentity, operation: "source" | "action", targetId: string, signal?: AbortSignal): Promise<boolean>;
}

function pool(request: PayloadRequest): RuntimeExtensionPool {
  const value = (request.payload.db as { pool?: unknown } | undefined)?.pool;
  if (typeof value !== "object" || value === null || !("connect" in value) || !("query" in value)) {
    throw new TypeError("Payload PostgreSQL pool is unavailable.");
  }
  return value as RuntimeExtensionPool;
}

function actor(user: unknown): { readonly id: string; readonly salesProfile: FixtureSalesProfile } {
  if (typeof user !== "object" || user === null || !("collection" in user) || user.collection !== "users" || !("id" in user) || user.id === null || user.id === undefined) {
    throw new TypeError("Authentication context is invalid.");
  }
  const email = "email" in user && typeof user.email === "string" ? user.email : undefined;
  // This fixed fixture intentionally maps unknown and missing emails to normal.
  return { id: String(user.id), salesProfile: email === "done@example.test" ? "done" : "normal" };
}

function target(permission: ReadonlyMap<string, Readonly<{ resource: string; scope: "application" | "record" | "field" }>>, permissionId: string, boundary: string, selectedRecordId?: string): CurrentAuthorityTarget {
  const descriptor = permission.get(permissionId);
  if (descriptor === undefined) throw new TypeError(`Registered permission ${permissionId} is unavailable.`);
  const recordId = selectedRecordId ?? `boundary-${boundary.replace(/[^a-z0-9-]/giu, "-")}`;
  const scope = descriptor.scope === "application"
    ? { kind: "application" as const, resource: descriptor.resource }
    : descriptor.scope === "record"
      ? { kind: "record" as const, resource: descriptor.resource, recordId }
      : { kind: "field" as const, resource: descriptor.resource, recordId, fieldId: descriptor.resource };
  return createCurrentAuthorityTarget({ permissionId, scope, facts: { boundary, permissionId } });
}

function catalog(registration: ScopedRegistrationResult) {
  const bindings = registration.contributions.policyBindings
    .filter(({ pluginId }) => pluginId === "module.sales")
    .map(({ value }) => value as Readonly<{ id: string; permissionId: string; publisher: { kind: "extension"; deliveryClass: "platform-plugin"; extensionId: "module.sales" }; policyReference: string }>);
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration,
    generation: {
      schemaVersion: 1,
      applicationId,
      owner,
      runtimeGenerationIds: ["static-module-sales-1"],
      state: "current",
      authorizationRevision: 0,
      lifecycleRevision: 0
    }
  });
  return createEffectiveAuthorizationCatalog({
    applicationId,
    extensions: [contribution],
    executables: bindings.map((binding) => createPlatformPluginPolicyExecutable({
      kind: "platform-plugin",
      publisher: binding.publisher,
      bindingId: binding.id,
      policyReference: binding.policyReference,
      executor: { evaluate: (input) => ({
        schemaVersion: 1 as const,
        outcome: input.permissionId === binding.permissionId && typeof input.facts === "object" && input.facts !== null &&
          Object.keys(input.facts).sort().join("\0") === "boundary\0permissionId" &&
          typeof (input.facts as { boundary?: unknown }).boundary === "string" &&
          (input.facts as { permissionId?: unknown }).permissionId === binding.permissionId ? "allow" as const : "deny" as const
      }) }
    }))
  });
}

/** Request sessions are branded before any policy/cache/store boundary. */
export function createFixtureCurrentAuthority(registration: ScopedRegistrationResult): FixtureCurrentAuthority {
  const permission = new Map(registration.contributions.permissions
    .filter(({ pluginId }) => pluginId === "module.sales")
    .map(({ value }) => {
      const descriptor = value as Readonly<{ id: string; resource: string; scope: "application" | "record" | "field" }>;
      return [descriptor.id, descriptor] as const;
    }));
  const realtimePermissions = new Map(registration.contributions.realtimeTopics.map(({ id, value }) =>
    [id, (value as Readonly<{ permission: string }>).permission] as const));
  const remoteSources = new Map(registration.contributions.sources
    .filter(({ pluginId }) => pluginId === "module.sales")
    .map(({ id, value }) => [id, (value as Readonly<{ descriptor: DataSourceDescriptor }>).descriptor] as const));
  const remoteActions = new Map(registration.contributions.actions
    .filter(({ pluginId }) => pluginId === "module.sales")
    .map(({ id, value }) => [id, value as ActionDefinition] as const));
  const effectiveCatalog = catalog(registration);
  const catalogProvider = createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) =>
    requested === applicationId ? Object.freeze({ applicationId, lifecycleRevision, catalog: effectiveCatalog }) : undefined);
  const sessions = new WeakMap<FixtureAuthorityContext, TrustedAuthorizationSession>();
  /** Domain facts stay in the branded context store: the cache accepts JSON-safe context projections only. */
  const salesProfiles = new WeakMap<FixtureAuthorityContext, FixtureSalesProfile>();
  const contexts = new WeakMap<PayloadRequest, Readonly<{ actorId: string; salesProfile: FixtureSalesProfile; context: FixtureAuthorityContext }>>();
  const stores = new WeakMap<TrustedAuthorizationSession, PostgresAuthorizationStore>();
  const resolver = {
    authorize(session: TrustedAuthorizationSession, request: Parameters<EffectiveAuthorityResolver["authorize"]>[1], signal: AbortSignal) {
      const store = stores.get(session);
      if (store === undefined) throw new TypeError("Current authorization store is unavailable.");
      return new EffectiveAuthorityResolver({ store, catalogProvider }).authorize(session, request, signal);
    }
  };
  const adapter = new CurrentAuthorityAdapter<FixtureAuthorityContext>({ current: (context) => sessions.get(context) }, resolver);
  const realtimeContexts = new WeakMap<object, FixtureAuthorityContext>();
  const permissions = new CurrentAuthorityPermissionProjection(adapter, (kind, descriptor) =>
    target(permission, descriptor.permission, `${kind}-${descriptor.id}`));
  const realtime = new CurrentAuthorityRealtimeTopicAuthorization(
    adapter,
    (_topic, subscription) => {
      const context = realtimeContexts.get(subscription);
      if (context === undefined) throw new TypeError("Realtime authority context is unavailable.");
      return context;
    },
    (topic) => {
      const permissionId = realtimePermissions.get(topic.id);
      if (permissionId === undefined) throw new TypeError("Registered realtime topic is unavailable.");
      return target(permission, permissionId, `realtime-${topic.id}`);
    }
  );
  const fixture: FixtureCurrentAuthority = {
    adapter,
    permissions,
    context(request, correlationId, user = request.user) {
      const current = actor(user);
      const existing = contexts.get(request);
      if (existing !== undefined) {
        if (existing.actorId !== current.id || existing.salesProfile !== current.salesProfile) {
          throw new TypeError("Payload request authority actor or Sales profile changed.");
        }
        return existing.context;
      }
      const session = createTrustedAuthorizationSession({
        schemaVersion: 1,
        applicationId,
        environment,
        correlationId,
        principal: { kind: "user", id: current.id },
        effectiveActor: { kind: "user", id: current.id }
      });
      const context = Object.freeze({
        permissionFingerprint: `${applicationId}:${environment}:user:${current.id}:sales:${current.salesProfile}`
      });
      stores.set(session, new PostgresAuthorizationStore(pool(request)));
      sessions.set(context, session);
      salesProfiles.set(context, current.salesProfile);
      contexts.set(request, Object.freeze({ actorId: current.id, salesProfile: current.salesProfile, context }));
      return context;
    },
    salesProfile(context) {
      const profile = salesProfiles.get(context);
      if (!sessions.has(context) || profile === undefined) throw new TypeError("Fixture Sales profile context is unavailable.");
      return profile;
    },
    source(descriptor, surface) { return target(permission, descriptor.permission, `source-${surface}-${descriptor.id}`); },
    field(descriptor, fieldId, surface) {
      const field = descriptor.outputFields?.find((candidate) => candidate.id === fieldId);
      if (field === undefined) throw new TypeError("Registered source field is unavailable.");
      return target(permission, field.permission, `field-${surface}-${descriptor.id}-${fieldId}`);
    },
    action(action, input) {
      const recordId = typeof input === "object" && input !== null && "id" in input && typeof input.id === "string" ? input.id : undefined;
      return target(permission, action.descriptor.permission, `action-${action.descriptor.id}`, recordId);
    },
    tool(descriptor) { return target(permission, descriptor.permission, `tool-${descriptor.id}`); },
    async authorizeRealtime(context, topic, subscription) {
      realtimeContexts.set(subscription, context);
      try { return await realtime.authorize(topic, subscription); }
      finally { realtimeContexts.delete(subscription); }
    },
    payload(collection, operation) {
      const permissionId = collection === "sales-tasks"
        ? operation === "find" ? "sales.tasks.read" : "sales.tasks.write"
        : collection === "sales-opportunities"
          ? operation === "find" ? "sales.opportunities.read" : "sales.opportunities.write"
          : undefined;
      if (permissionId === undefined) throw new TypeError("Payload collection is unavailable.");
      return target(permission, permissionId, `payload-${collection}-${operation}`);
    },
    remoteUi(context): FixtureRemoteUiAuthorization {
      const validIdentity = (identity: RemoteUiFrameAuthorityIdentity) =>
        identity.applicationId === applicationId && identity.environment === environment && identity.appId === "app.sales-live";
      const identityBoundary = (identity: RemoteUiFrameAuthorityIdentity) => `${identity.appId}-${identity.generationId}`;
      const remote = new CurrentAuthorityRemoteUiFrameAuthorization(
        adapter,
        (identity) => {
          if (!validIdentity(identity)) throw new TypeError("Remote UI authority identity is unavailable.");
          return context;
        },
        (identity) => ({
          frame: target(permission, "sales.tasks.read", `remote-ui-frame-${identityBoundary(identity)}`),
          sources: new Map([...remoteSources].map(([id, descriptor]) => [id, target(permission, descriptor.permission, `remote-ui-source-${identityBoundary(identity)}-${id}`)])),
          actions: new Map([...remoteActions].map(([id, action]) => [id, target(permission, action.descriptor.permission, `remote-ui-action-${identityBoundary(identity)}-${id}`)]))
        })
      );
      const authorization: FixtureRemoteUiAuthorization = {
        authorizeRoute(identity, signal) {
          if (!validIdentity(identity)) return Promise.resolve(false);
          return permissions.allowsRoute(context, { id: "remote-ui.route.sales-live", permission: "sales.tasks.read" }, signal);
        },
        authorizeFrame: (identity, signal) => remote.allowsFrame(identity, signal),
        authorizeTarget: (identity, operation, targetId, signal) => operation === "source"
          ? remote.allowsSource(identity, targetId, signal)
          : remote.allowsAction(identity, targetId, signal)
      };
      return Object.freeze(authorization);
    }
  };
  return Object.freeze(fixture);
}
