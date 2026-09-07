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
import { salesAccountsDescriptor, salesContactsDescriptor, salesLeadsDescriptor } from "@k-nex/module-sales-current/contracts";
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
  readonly applicationId: string;
  readonly environment: string;
  readonly actorId: string;
  readonly ownerId: string;
  readonly teamId: string;
  /** Actor-isolated cache identity; current RBAC is rechecked before every cache lookup. */
  readonly permissionFingerprint: string;
}
export interface FixtureDurableSalesAuthority {
  readonly context: FixtureAuthorityContext;
  readonly recordScope: "owned-or-assigned-team" | "managed-teams-and-own" | "application-sales-scope" | "explicit-application-or-team-scope";
  readonly applicationWide: boolean;
  readonly mutationAllowed: boolean;
  readonly authorizedTeamIds: readonly string[];
  readonly scopeRevision: number;
  readonly authorizationRevision: number;
  readonly lifecycleRevision: number;
  /** The exact static module.sales authorization generation bound to this process. */
  readonly moduleSalesAuthorizationGeneration: number;
  /** Exact ordered runtime generation IDs from that process-bound authorization generation. */
  readonly moduleSalesRuntimeGenerationIds: readonly string[];
  /** Exact effective grants retained with a data-movement job for its fenced worker. */
  readonly permissionGrants: readonly string[];
  /** Registered CRM fields whose current field permission is granted. */
  readonly fieldGrants: readonly `${"sales.object.lead" | "sales.object.account" | "sales.object.contact"}:${string}`[];
}

export type FixtureSalesProfile = "normal" | "done";

export interface FixtureCurrentAuthority {
  readonly adapter: CurrentAuthorityAdapter<FixtureAuthorityContext>;
  readonly permissions: CurrentAuthorityPermissionProjection<FixtureAuthorityContext>;
  context(request: PayloadRequest, correlationId: string, user?: unknown): FixtureAuthorityContext;
  resolveDurableSalesAuthority(request: PayloadRequest, correlationId: string): Promise<FixtureDurableSalesAuthority>;
  revalidateDurableSalesAuthority(request: PayloadRequest, durable: FixtureDurableSalesAuthority): Promise<boolean>;
  durableSalesAuthority(request: PayloadRequest): FixtureDurableSalesAuthority;
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
  payloadAction(actionId: string, collection: string, operation: "find" | "create" | "update"): CurrentAuthorityTarget;
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

type MovementTarget = "sales.object.lead" | "sales.object.account" | "sales.object.contact";
const movementFieldBindings = Object.freeze([
  { target: "sales.object.account" as const, fieldId: "name", descriptor: salesAccountsDescriptor, sourceFieldId: "name" },
  { target: "sales.object.contact" as const, fieldId: "displayName", descriptor: salesContactsDescriptor, sourceFieldId: "display-name" },
  { target: "sales.object.contact" as const, fieldId: "accountId", descriptor: salesContactsDescriptor, sourceFieldId: "account-id" },
  { target: "sales.object.contact" as const, fieldId: "email", descriptor: salesContactsDescriptor, sourceFieldId: "email" },
  { target: "sales.object.contact" as const, fieldId: "phone", descriptor: salesContactsDescriptor, sourceFieldId: "phone" },
  { target: "sales.object.lead" as const, fieldId: "displayName", descriptor: salesLeadsDescriptor, sourceFieldId: "display-name" },
  { target: "sales.object.lead" as const, fieldId: "source", descriptor: salesLeadsDescriptor, sourceFieldId: "source" },
  { target: "sales.object.lead" as const, fieldId: "email", descriptor: salesLeadsDescriptor, sourceFieldId: "email" },
  { target: "sales.object.lead" as const, fieldId: "phone", descriptor: salesLeadsDescriptor, sourceFieldId: "phone" }
] as const);

function effectiveMovementFieldGrants(permissionGrants: readonly string[]): readonly `${MovementTarget}:${string}`[] {
  const granted = new Set(permissionGrants);
  const resolved = movementFieldBindings.flatMap(({ target, fieldId, descriptor, sourceFieldId }) => {
    const permission = descriptor.outputFields?.find((field) => field.id === sourceFieldId)?.permission;
    return permission !== undefined && granted.has(permission) ? [`${target}:${fieldId}` as const] : [];
  });
  return Object.freeze([...new Set(resolved)].sort());
}

function effectivePermissionGrants(rows: readonly Record<string, unknown>[]): readonly string[] {
  const grants = rows.map(({ permission_id: permissionId }) => permissionId).filter((permissionId): permissionId is string =>
    typeof permissionId === "string" && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(permissionId)
  );
  if (grants.length !== rows.length || grants.length > 512) throw new TypeError("Durable Sales permission grants are unavailable.");
  return Object.freeze([...new Set(grants)].sort());
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

type ProcessBoundSalesGeneration = Readonly<{
  authorizationGeneration: number;
  runtimeGenerationIds: readonly string[];
  authorizationRevision: number;
  lifecycleRevision: number;
}>;

/**
 * A request may only retain the authorization generation baked into this
 * process. Durable state can revoke that generation, never select another one
 * for an already-running binary.
 */
async function processBoundSalesGeneration(
  database: RuntimeExtensionPool,
  staticIdentityProvider: FixtureStaticProcessIdentityProvider,
  owner: FixtureApplicationIdentity
): Promise<ProcessBoundSalesGeneration> {
  const staticIdentity = staticIdentityProvider.current();
  if (staticIdentity === undefined) throw new TypeError("Static Sales process identity is unavailable.");
  const identity = staticProcessIdentity(staticIdentity);
  const [generations, runtime] = await Promise.all([
    database.query<Record<string, unknown>>(
      "select application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and delivery_class=$2 and extension_id=$3 and state='current' order by authorization_generation",
      [owner.applicationId, deliveryClass, extensionId]
    ),
    database.query<Record<string, unknown>>(
      "select disposition, active_generation_id, active_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [owner.applicationId, owner.environment, deliveryClass, extensionId]
    )
  ]);
  const current = generations.rows.map(generation);
  if (current.length !== 1 || current[0] === undefined || runtime.rows.length !== 1 ||
    current[0].runtimeGenerationIds.length !== 1 || current[0].runtimeGenerationIds[0] !== identity.generationId ||
    !staticRuntimeMatches(runtime.rows[0]!, identity)) {
    throw new TypeError("Static Sales authorization generation is unavailable.");
  }
  return Object.freeze({
    authorizationGeneration: current[0].owner.generation,
    runtimeGenerationIds: Object.freeze([...current[0].runtimeGenerationIds]),
    authorizationRevision: current[0].authorizationRevision,
    lifecycleRevision: current[0].lifecycleRevision
  });
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
  const durableContexts = new WeakMap<PayloadRequest, FixtureDurableSalesAuthority>();
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
  // Fixture authority gives real PostgreSQL resolution the platform's maximum bounded deadline.
  const adapter = new CurrentAuthorityAdapter<FixtureAuthorityContext>({ current: (context) => sessions.get(context) }, resolver, 5_000);
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
  const sameDurableAuthority = (left: FixtureDurableSalesAuthority, row: Record<string, unknown> | undefined, revision: Record<string, unknown> | undefined, grants: readonly Record<string, unknown>[], processBound: ProcessBoundSalesGeneration) =>
    row !== undefined && revision !== undefined && row.record_scope === left.recordScope && row.application_wide === left.applicationWide && row.mutation_allowed === left.mutationAllowed &&
    Array.isArray(row.authorized_team_ids) && JSON.stringify(row.authorized_team_ids) === JSON.stringify(left.authorizedTeamIds) && row.revision === left.scopeRevision &&
    revision.authorization_revision === left.authorizationRevision && revision.lifecycle_revision === left.lifecycleRevision &&
    processBound.authorizationGeneration === left.moduleSalesAuthorizationGeneration && JSON.stringify(processBound.runtimeGenerationIds) === JSON.stringify(left.moduleSalesRuntimeGenerationIds) &&
    processBound.authorizationRevision === left.authorizationRevision && processBound.lifecycleRevision === left.lifecycleRevision &&
    JSON.stringify(effectivePermissionGrants(grants)) === JSON.stringify(left.permissionGrants) &&
    JSON.stringify(effectiveMovementFieldGrants(left.permissionGrants)) === JSON.stringify(left.fieldGrants);
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
        applicationId: owner.applicationId,
        environment: owner.environment,
        actorId: current.id,
        ownerId: current.id,
        teamId: `team:${current.id}`,
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
    async resolveDurableSalesAuthority(request, correlationId) {
      const current = fixture.context(request, correlationId);
      const database = pool(request);
      const [scope, state, grants, processBound] = await Promise.all([
        database.query<Record<string, unknown>>("select record_scope, application_wide, mutation_allowed, authorized_team_ids, revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active'", [owner.applicationId, owner.environment, current.actorId]),
        database.query<Record<string, unknown>>("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [owner.applicationId]),
        database.query<Record<string, unknown>>("select distinct g.permission_id from k_nex_role_assignments a join k_nex_role_permission_grants g on g.application_id=a.application_id and g.role_id=a.role_id where a.application_id=$1 and a.subject_kind='user' and a.subject_id=$2 and a.state='active' order by g.permission_id", [owner.applicationId, current.actorId]),
        processBoundSalesGeneration(database, staticIdentityProvider, owner)
      ]);
      const row = scope.rows[0]; const revision = state.rows[0];
      if (scope.rows.length !== 1 || state.rows.length !== 1 || row === undefined || revision === undefined ||
        !["owned-or-assigned-team", "managed-teams-and-own", "application-sales-scope", "explicit-application-or-team-scope"].includes(String(row.record_scope)) ||
        typeof row.application_wide !== "boolean" || typeof row.mutation_allowed !== "boolean" || !Array.isArray(row.authorized_team_ids) || row.authorized_team_ids.length > 32 || row.authorized_team_ids.some((teamId) => typeof teamId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(teamId)) || JSON.stringify(row.authorized_team_ids) !== JSON.stringify([...new Set(row.authorized_team_ids)].sort()) ||
        !Number.isSafeInteger(row.revision) || !Number.isSafeInteger(revision.authorization_revision) || !Number.isSafeInteger(revision.lifecycle_revision) ||
        processBound.authorizationRevision !== revision.authorization_revision || processBound.lifecycleRevision !== revision.lifecycle_revision) throw new TypeError("Durable Sales authority is unavailable.");
      const permissionGrants = effectivePermissionGrants(grants.rows);
      const resolved = Object.freeze({ context: current, recordScope: row.record_scope as FixtureDurableSalesAuthority["recordScope"], applicationWide: row.application_wide, mutationAllowed: row.mutation_allowed, authorizedTeamIds: Object.freeze(row.authorized_team_ids.map(String)), scopeRevision: row.revision as number, authorizationRevision: revision.authorization_revision as number, lifecycleRevision: revision.lifecycle_revision as number, moduleSalesAuthorizationGeneration: processBound.authorizationGeneration, moduleSalesRuntimeGenerationIds: processBound.runtimeGenerationIds, permissionGrants, fieldGrants: effectiveMovementFieldGrants(permissionGrants) });
      durableContexts.set(request, resolved);
      return resolved;
    },
    async revalidateDurableSalesAuthority(request, durable) {
      const database = pool(request);
      const [scope, state, grants, processBound] = await Promise.all([
        database.query<Record<string, unknown>>("select record_scope, application_wide, mutation_allowed, authorized_team_ids, revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active'", [durable.context.applicationId, durable.context.environment, durable.context.actorId]),
        database.query<Record<string, unknown>>("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [durable.context.applicationId]),
        database.query<Record<string, unknown>>("select distinct g.permission_id from k_nex_role_assignments a join k_nex_role_permission_grants g on g.application_id=a.application_id and g.role_id=a.role_id where a.application_id=$1 and a.subject_kind='user' and a.subject_id=$2 and a.state='active' order by g.permission_id", [durable.context.applicationId, durable.context.actorId]),
        processBoundSalesGeneration(database, staticIdentityProvider, owner)
      ]);
      return scope.rows.length === 1 && state.rows.length === 1 && sameDurableAuthority(durable, scope.rows[0], state.rows[0], grants.rows, processBound);
    },
    durableSalesAuthority(request) {
      const resolved = durableContexts.get(request);
      if (resolved === undefined) throw new TypeError("Durable Sales authority is unavailable.");
      return resolved;
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
      const recordId = action.descriptor.id.startsWith("sales.import.") || action.descriptor.id.startsWith("sales.export.") || action.descriptor.id === "sales.merge.commit" ? "collection" : typeof input === "object" && input !== null && "id" in input && typeof input.id === "string" ? input.id : undefined;
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
          : collection === "sales-accounts"
            ? operation === "find" ? "sales.accounts.read" : "sales.accounts.write"
            : collection === "sales-contacts"
              ? operation === "find" ? "sales.contacts.read" : "sales.contacts.write"
              : collection === "sales-leads"
                ? operation === "find" ? "sales.leads.read" : "sales.leads.write"
                : collection === "sales-activities"
                  ? operation === "find" ? "sales.activities.read" : "sales.activities.write"
                  : collection === "sales-notes"
                    ? operation === "find" ? "sales.notes.read" : "sales.notes.write"
                    : collection === "sales-attachment-references"
                      ? operation === "find" ? "sales.attachments.read" : "sales.attachments.write"
                      : collection === "sales-pipelines"
                        ? "sales.pipelines.read"
                        : collection === "sales-pipeline-stages"
                          ? "sales.pipelines.read"
                : undefined;
      if (permissionId === undefined) throw new TypeError("Payload collection is unavailable.");
      return target(permission, permissionId, `payload-${collection}-${operation}`);
    },
    payloadAction(actionId, collection, operation) {
      const permissionId = actionId === "sales.opportunity.stage.update"
        ? collection === "sales-opportunities" ? "sales.opportunities.stage.update" : undefined
        : actionId === "sales.task.create" || actionId === "sales.task.update"
          ? collection === "sales-tasks" ? "sales.tasks.write" : undefined
          : actionId === "sales.ownership.assign" && ["sales-accounts", "sales-contacts", "sales-leads", "sales-opportunities"].includes(collection)
            ? "sales.ownership.write"
          : actionId.startsWith("sales.account.") && collection === "sales-accounts"
            ? actionId.endsWith(".archive") ? "sales.accounts.archive" : "sales.accounts.write"
            : actionId.startsWith("sales.contact.") && collection === "sales-contacts"
              ? actionId.endsWith(".archive") ? "sales.contacts.archive" : "sales.contacts.write"
              : actionId.startsWith("sales.lead.")
                ? collection === "sales-leads"
                  ? actionId.endsWith(".archive") ? "sales.leads.archive" : actionId.endsWith(".qualify") ? "sales.leads.qualify" : actionId.endsWith(".disqualify") ? "sales.leads.disqualify" : "sales.leads.write"
                    : actionId === "sales.lead.qualify" && collection === "sales-accounts" ? operation === "find" ? "sales.accounts.read" : "sales.accounts.write"
                      : actionId === "sales.lead.qualify" && collection === "sales-contacts" ? operation === "find" ? "sales.contacts.read" : "sales.contacts.write"
                      : actionId === "sales.lead.qualify" && collection === "sales-opportunities" ? "sales.opportunities.write"
                        : actionId === "sales.lead.qualify" && (collection === "sales-pipelines" || collection === "sales-pipeline-stages") && operation === "find" ? "sales.pipelines.read" : undefined
                : actionId.startsWith("sales.opportunity.") && collection === "sales-opportunities"
                  ? actionId.endsWith(".archive") ? "sales.opportunities.archive" : actionId.endsWith(".close") ? "sales.opportunities.close" : "sales.opportunities.write"
                  : (actionId === "sales.opportunity.create" || actionId === "sales.opportunity.update") && collection === "sales-contacts" && operation === "find" ? "sales.contacts.read"
                    : actionId === "sales.opportunity.create" && collection === "sales-accounts" && operation === "find" ? "sales.accounts.read"
                    : actionId === "sales.opportunity.create" && (collection === "sales-pipelines" || collection === "sales-pipeline-stages") && operation === "find" ? "sales.pipelines.read"
                      : actionId === "sales.contact.create" && collection === "sales-accounts" && operation === "find" ? "sales.accounts.read"
                  : actionId.startsWith("sales.activity.") && collection === "sales-activities" ? "sales.activities.write"
                    : actionId === "sales.note.create" && collection === "sales-notes" ? operation === "find" ? "sales.notes.read" : "sales.notes.write"
                      : (actionId === "sales.attachment.link" || actionId === "sales.attachment.remove") && collection === "sales-attachment-references" ? "sales.attachments.write"
                        : (actionId.startsWith("sales.activity.") || actionId === "sales.note.create" || actionId === "sales.attachment.link" || actionId === "sales.attachment.remove") && operation === "find"
                          ? collection === "sales-tasks" ? "sales.tasks.read" : collection === "sales-opportunities" ? "sales.opportunities.read" : collection === "sales-accounts" ? "sales.accounts.read" : collection === "sales-contacts" ? "sales.contacts.read" : collection === "sales-leads" ? "sales.leads.read" : undefined
                  : undefined;
      if (permissionId === undefined) throw new TypeError("Action Payload collection is unavailable.");
      return target(permission, permissionId, `payload-action-${actionId}-${collection}-${operation}`);
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
