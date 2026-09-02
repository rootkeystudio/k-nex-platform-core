import { ExtensionAuthorizationGenerationSchema, type AgentToolDescriptor, type DataSourceDescriptor, type ExtensionAuthorizationGeneration } from "@k-nex/contracts";
import {
  CurrentAuthorityAdapter,
  CurrentAuthorityPermissionProjection,
  CurrentAuthorityRealtimeTopicAuthorization,
  CurrentAuthorityRemoteUiFrameAuthorization,
  EffectiveAuthorityResolver,
  createAuthorizationCatalogProvider,
  createCurrentAuthorityTarget,
  createEffectiveAuthorizationCatalog,
  createHotApplicationManifestAuthorizationContribution,
  createHotApplicationPolicyExecutable,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  createTrustedAuthorizationSession,
  isEffectiveAuthorizationCatalogForGeneration,
  readAuthoritativeHotApplicationAuthorizationSource,
  AuthoritativeHotApplicationRuntime,
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
const deliveryClass = "platform-plugin";
const extensionId = "module.sales";

export interface FixtureApplicationIdentity {
  readonly applicationId: string;
  readonly environment: string;
}

export interface FixtureStaticProcessIdentity { readonly __opaqueFixtureStaticProcessIdentity?: never; }

/** Process-local build identity source. Missing or changed identity fails closed. */
export interface FixtureStaticProcessIdentityProvider {
  current(): FixtureStaticProcessIdentity | undefined;
}

/** The host owns this in-memory boundary; durable rows never supply a runnable Hot runtime. */
export interface FixtureHotApplicationRuntimeRegistry {
  register(extensionId: string, runtime: AuthoritativeHotApplicationRuntime): void;
  unregister(extensionId: string): void;
  current(): readonly AuthoritativeHotApplicationRuntime[];
}

export function createFixtureHotApplicationRuntimeRegistry(): FixtureHotApplicationRuntimeRegistry {
  const runtimes = new Map<string, AuthoritativeHotApplicationRuntime>();
  const validExtensionId = (value: string) => /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value);
  return Object.freeze({
    register(extensionId: string, runtime: AuthoritativeHotApplicationRuntime) {
      if (!validExtensionId(extensionId) || !(runtime instanceof AuthoritativeHotApplicationRuntime)) {
        throw new TypeError("Hot Application authorization runtime is invalid.");
      }
      runtimes.set(extensionId, runtime);
    },
    unregister(extensionId: string) {
      if (!validExtensionId(extensionId)) throw new TypeError("Hot Application extension id is invalid.");
      runtimes.delete(extensionId);
    },
    current() { return Object.freeze([...runtimes.values()]); }
  });
}

interface FixtureStaticProcessIdentityRecord {
  readonly applicationId: string;
  readonly environment: string;
  readonly extensionId: string;
  readonly generationId: string;
  readonly sourceCommit: string;
  readonly applicationDigest: `sha256:${string}`;
}

const staticProcessIdentities = new WeakMap<object, FixtureStaticProcessIdentityRecord>();

/**
 * The customer build/entrypoint mints this opaque value once from baked build
 * metadata. Durable runtime rows may be compared with it but can never supply
 * or replace the local process identity.
 */
export function createFixtureStaticProcessIdentity(value: FixtureStaticProcessIdentityRecord): FixtureStaticProcessIdentity {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(value.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(value.environment) ||
    value.extensionId !== extensionId || !/^[a-z][a-z0-9-]{2,127}$/u.test(value.generationId) ||
    !/^[0-9a-f]{40}$/u.test(value.sourceCommit) || !/^sha256:[0-9a-f]{64}$/u.test(value.applicationDigest)) {
    throw new TypeError("Fixture static process identity is invalid.");
  }
  const identity = Object.freeze({});
  staticProcessIdentities.set(identity, Object.freeze({ ...value }));
  return identity as FixtureStaticProcessIdentity;
}

function staticProcessIdentity(value: FixtureStaticProcessIdentity): FixtureStaticProcessIdentityRecord {
  const identity = typeof value === "object" && value !== null ? staticProcessIdentities.get(value) : undefined;
  if (identity === undefined) throw new TypeError("Fixture static process identity is not trusted.");
  return identity;
}

export function createFixtureStaticProcessIdentityProvider(
  owner: FixtureApplicationIdentity = { applicationId, environment },
  environmentValues: NodeJS.ProcessEnv = process.env
): FixtureStaticProcessIdentityProvider {
  let identity: FixtureStaticProcessIdentity | undefined;
  let canonical: string | undefined;
  return Object.freeze({
    current() {
      const generationId = environmentValues.K_NEX_GENERATION;
      const sourceCommit = environmentValues.K_NEX_SOURCE_COMMIT;
      const applicationDigest = environmentValues.K_NEX_APPLICATION_DIGEST;
      if (!generationId || !sourceCommit || !applicationDigest) return undefined;
      const next = JSON.stringify({ applicationId: owner.applicationId, environment: owner.environment, extensionId, generationId, sourceCommit, applicationDigest });
      if (canonical !== undefined && canonical !== next) return undefined;
      if (identity === undefined) {
        identity = createFixtureStaticProcessIdentity({
          applicationId: owner.applicationId, environment: owner.environment, extensionId, generationId, sourceCommit,
          applicationDigest: applicationDigest as `sha256:${string}`
        });
        canonical = next;
      }
      return identity;
    }
  });
}

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

type HotAuthorizationEntry = Readonly<{
  contribution: ReturnType<typeof createHotApplicationManifestAuthorizationContribution>;
  executables: readonly ReturnType<typeof createHotApplicationPolicyExecutable>[];
  generation: ExtensionAuthorizationGeneration;
}>;

function catalog(
  registration: ScopedRegistrationResult,
  generation: ExtensionAuthorizationGeneration | undefined,
  lifecycleRevision: number,
  catalogApplicationId: string,
  lifecycleOverride?: Readonly<{ enabled: boolean; ready: boolean }>,
  hotApplications: readonly HotAuthorizationEntry[] = []
) {
  const bindings = registration.contributions.policyBindings
    .filter(({ pluginId }) => pluginId === "module.sales")
    .map(({ value }) => value as Readonly<{ id: string; permissionId: string; publisher: { kind: "extension"; deliveryClass: "platform-plugin"; extensionId: "module.sales" }; policyReference: string }>);
  const contribution = generation === undefined ? undefined : createPlatformPluginRegistrationAuthorizationContribution({
    registration,
    generation,
    ...(lifecycleOverride === undefined ? {} : { lifecycleOverride })
  });
  return createEffectiveAuthorizationCatalog({
    applicationId: catalogApplicationId,
    lifecycleRevision,
    extensions: [...(contribution === undefined ? [] : [contribution]), ...hotApplications.map(({ contribution: value }) => value)],
    executables: [...(contribution === undefined ? [] : bindings.map((binding) => createPlatformPluginPolicyExecutable({
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
    }))), ...hotApplications.flatMap(({ executables }) => executables)]
  });
}

function generation(row: Record<string, unknown>): ExtensionAuthorizationGeneration | undefined {
  const parsed = ExtensionAuthorizationGenerationSchema.safeParse({
    schemaVersion: 1,
    applicationId: row.application_id,
    owner: {
      kind: "extension",
      deliveryClass: row.delivery_class,
      extensionId: row.extension_id,
      generation: typeof row.authorization_generation === "number" ? row.authorization_generation : Number(row.authorization_generation)
    },
    runtimeGenerationIds: row.runtime_generation_ids,
    state: row.state,
    authorizationRevision: typeof row.authorization_revision === "number" ? row.authorization_revision : Number(row.authorization_revision),
    lifecycleRevision: typeof row.lifecycle_revision === "number" ? row.lifecycle_revision : Number(row.lifecycle_revision)
  });
  return parsed.success ? Object.freeze(parsed.data) : undefined;
}

/** Durable Phase 9 state can only suppress this static registration; it never supplies descriptors or code. */
function staticRuntimeMatches(row: Record<string, unknown>, identity: FixtureStaticProcessIdentityRecord): boolean {
  const active = row.active_generation;
  return row.disposition === "active" && row.active_generation_id === identity.generationId &&
    typeof active === "object" && active !== null && !Array.isArray(active) &&
    (active as Record<string, unknown>).authority === "static-build" &&
    (active as Record<string, unknown>).generationId === identity.generationId &&
    (active as Record<string, unknown>).sourceCommit === identity.sourceCommit &&
    (active as Record<string, unknown>).applicationDigest === identity.applicationDigest;
}

function hotRuntimeMatches(row: Record<string, unknown>, source: Readonly<{
  generationId: string;
  sourceCommit: string;
  artifactDigest: string;
  manifestDigest: string;
}>): boolean {
  const active = row.active_generation;
  return row.disposition === "active" && row.active_generation_id === source.generationId &&
    typeof active === "object" && active !== null && !Array.isArray(active) &&
    (active as Record<string, unknown>).generationId === source.generationId &&
    (active as Record<string, unknown>).sourceCommit === source.sourceCommit &&
    (active as Record<string, unknown>).artifactDigest === source.artifactDigest &&
    (active as Record<string, unknown>).manifestDigest === source.manifestDigest;
}

async function activeHotApplications(
  database: RuntimeExtensionPool,
  lifecycleRevision: number,
  runtimeRegistry: FixtureHotApplicationRuntimeRegistry
): Promise<readonly HotAuthorizationEntry[]> {
  const result: HotAuthorizationEntry[] = [];
  const seen = new Set<string>();
  for (const runtime of runtimeRegistry.current()) {
    if (!(runtime instanceof AuthoritativeHotApplicationRuntime)) throw new TypeError("Hot Application authorization runtime is not trusted.");
    let source;
    try { source = await runtime.createAuthorizationSource(); }
    catch { continue; }
    const record = readAuthoritativeHotApplicationAuthorizationSource(source);
    if (!record || record.applicationId !== applicationId || record.environment !== environment || seen.has(record.extensionId)) continue;
    seen.add(record.extensionId);
    const [generations, runtimeState] = await Promise.all([
      database.query<Record<string, unknown>>(
        "select application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='hot-application' and extension_id=$2 and state='current' order by authorization_generation",
        [applicationId, record.extensionId]
      ),
      database.query<Record<string, unknown>>(
        "select disposition, active_generation_id, active_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3",
        [applicationId, environment, record.extensionId]
      )
    ]);
    const current = generations.rows.map(generation);
    if (current.length !== 1 || current[0] === undefined ||
      !current[0].runtimeGenerationIds.includes(record.generationId) || runtimeState.rows.length !== 1 || !hotRuntimeMatches(runtimeState.rows[0]!, record)) continue;
    try {
      const contribution = createHotApplicationManifestAuthorizationContribution({
        source,
        generation: current[0],
        lifecycle: { enabled: true, ready: true }
      });
      const executables = record.manifest.policyBindings.map((binding) => {
        if (binding.publisher.kind !== "extension" || binding.publisher.deliveryClass !== "hot-application") {
          throw new TypeError("Verified Hot Application policy binding has the wrong publisher.");
        }
        return createHotApplicationPolicyExecutable({
          kind: "hot-application",
          publisher: binding.publisher,
          bindingId: binding.id,
          policyReference: binding.policyReference,
          gateway: runtime.createAuthorizationPolicyGateway(source)
        });
      });
      result.push(Object.freeze({
        generation: current[0],
        contribution,
        executables: Object.freeze(executables)
      }));
    } catch { continue; }
  }
  return Object.freeze(result);
}

function catalogProvider(
  registration: ScopedRegistrationResult,
  database: RuntimeExtensionPool,
  staticIdentityProvider: FixtureStaticProcessIdentityProvider,
  hotRuntimeRegistry: FixtureHotApplicationRuntimeRegistry,
  owner: FixtureApplicationIdentity = { applicationId, environment }
) {
  return createAuthorizationCatalogProvider(async ({ applicationId: requested, lifecycleRevision }) => {
    if (requested !== owner.applicationId) return undefined;
    try {
      const [state, generations, runtime] = await Promise.all([
        database.query<Record<string, unknown>>("select application_id, lifecycle_revision from k_nex_authorization_state where application_id=$1", [owner.applicationId]),
        database.query<Record<string, unknown>>(
          "select application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and delivery_class=$2 and extension_id=$3 and state in ('current','retired') order by authorization_generation",
          [owner.applicationId, deliveryClass, extensionId]
        ),
        database.query<Record<string, unknown>>(
          "select disposition, active_generation_id, active_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
          [owner.applicationId, owner.environment, deliveryClass, extensionId]
        )
      ]);
      if (state.rows.length !== 1 || state.rows[0]?.application_id !== owner.applicationId || Number(state.rows[0]?.lifecycle_revision) !== lifecycleRevision || runtime.rows.length !== 1) return undefined;
      const parsed = generations.rows.map(generation);
      if (parsed.some((entry) => entry === undefined)) return undefined;
      const current = parsed.filter((entry): entry is ExtensionAuthorizationGeneration => entry?.state === "current");
      if (current.length > 1) return undefined;
      // The static registration is this process's bytes, not an interchangeable
      // descriptor bag. An old binary must fail closed after a durable pointer
      // changes to another source/application/generation.
      const staticIdentity = staticIdentityProvider.current();
      const processIdentity = staticIdentity === undefined ? undefined : staticProcessIdentity(staticIdentity);
      const active = current.length === 1 && processIdentity !== undefined && staticRuntimeMatches(runtime.rows[0]!, processIdentity) &&
        current[0]!.runtimeGenerationIds.length === 1 && current[0]!.runtimeGenerationIds[0] === processIdentity.generationId;
      const hotApplications = owner.applicationId === applicationId && owner.environment === environment
        ? await activeHotApplications(database, lifecycleRevision, hotRuntimeRegistry)
        : [];
      const effective = catalog(registration, current[0], lifecycleRevision, owner.applicationId, { enabled: active, ready: active }, hotApplications);
      if (active && !isEffectiveAuthorizationCatalogForGeneration(effective, current[0])) return undefined;
      if (hotApplications.some(({ generation: value }) => !isEffectiveAuthorizationCatalogForGeneration(effective, value))) return undefined;
      return Object.freeze({
        applicationId: owner.applicationId,
        lifecycleRevision,
        catalog: effective
      });
    } catch {
      return undefined;
    }
  });
}

/** Request sessions are branded before any policy/cache/store boundary. */
export function createFixtureCurrentAuthority(
  registration: ScopedRegistrationResult,
  staticIdentityProvider: FixtureStaticProcessIdentityProvider,
  hotRuntimeRegistry: FixtureHotApplicationRuntimeRegistry = createFixtureHotApplicationRuntimeRegistry(),
  owner: FixtureApplicationIdentity = { applicationId, environment }
): FixtureCurrentAuthority {
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
  const sessions = new WeakMap<FixtureAuthorityContext, TrustedAuthorizationSession>();
  /** Domain facts stay in the branded context store: the cache accepts JSON-safe context projections only. */
  const salesProfiles = new WeakMap<FixtureAuthorityContext, FixtureSalesProfile>();
  const contexts = new WeakMap<PayloadRequest, Readonly<{ actorId: string; salesProfile: FixtureSalesProfile; context: FixtureAuthorityContext }>>();
  const stores = new WeakMap<TrustedAuthorizationSession, PostgresAuthorizationStore>();
  const databases = new WeakMap<TrustedAuthorizationSession, RuntimeExtensionPool>();
  const resolver = {
    authorize(session: TrustedAuthorizationSession, request: Parameters<EffectiveAuthorityResolver["authorize"]>[1], signal: AbortSignal) {
      const store = stores.get(session);
      const database = databases.get(session);
      if (store === undefined || database === undefined) throw new TypeError("Current authorization store is unavailable.");
      return new EffectiveAuthorityResolver({ store, catalogProvider: catalogProvider(registration, database, staticIdentityProvider, hotRuntimeRegistry, owner) }).authorize(session, request, signal);
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
        applicationId: owner.applicationId,
        environment: owner.environment,
        correlationId,
        principal: { kind: "user", id: current.id },
        effectiveActor: { kind: "user", id: current.id }
      });
      const context = Object.freeze({
        permissionFingerprint: `${owner.applicationId}:${owner.environment}:user:${current.id}:sales:${current.salesProfile}`
      });
      const database = pool(request);
      stores.set(session, new PostgresAuthorizationStore(database));
      databases.set(session, database);
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
        identity.applicationId === owner.applicationId && identity.environment === owner.environment && identity.appId === "app.sales-live";
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
