import {
  AuthorizationDecisionSchema,
  AuthorizationDelegationSchema,
  AuthorizationPermissionIdSchema,
  AuthorizationScopeSchema,
  AuthorizationStateSchema,
  AuthorizationSubjectSchema,
  canonicalJson,
  type AuthorizationDecision,
  type AuthorizationOwnerRef,
  type AuthorizationSubject,
  type ExtensionAuthorizationGeneration,
  type Role,
  type RoleAssignment,
  type RolePermissionGrant
} from "@k-nex/contracts";

import { isEffectiveAuthorizationCatalogForLifecycle, type EffectiveAuthorizationCatalog } from "./authorization-registry.js";
import type { AuthorizationExpectedRevision, AuthorizationStore } from "./authorization-store.js";

type AuthorizationDelegation = ReturnType<typeof AuthorizationDelegationSchema.parse>;
type AuthorizationScope = ReturnType<typeof AuthorizationScopeSchema.parse>;

export type EffectiveAuthorityErrorCode = "UNTRUSTED_SESSION" | "UNTRUSTED_CATALOG_PROVIDER" | "INVALID_REQUEST" | "AUTHORITY_UNAVAILABLE";

export class EffectiveAuthorityError extends Error {
  constructor(readonly code: EffectiveAuthorityErrorCode, message: string) {
    super(message);
    this.name = "EffectiveAuthorityError";
  }
}

export interface TrustedAuthorizationSession {
  readonly schemaVersion: 1;
  readonly applicationId: string;
  readonly environment: string;
  readonly correlationId: string;
  readonly principal: AuthorizationSubject;
  readonly effectiveActor: AuthorizationSubject;
  readonly delegation?: AuthorizationDelegation;
}

export interface EffectiveAuthorizationRequest {
  readonly schemaVersion: 1;
  readonly decisionId: string;
  readonly permissionId: string;
  readonly scope: AuthorizationScope;
  /** Canonical, bounded facts selected by host policy code. */
  readonly facts: unknown;
}

export interface AuthorizationCatalogProvider {
  current(input: Readonly<{ readonly applicationId: string; readonly lifecycleRevision: number }>):
    Readonly<{ readonly applicationId: string; readonly lifecycleRevision: number; readonly catalog: EffectiveAuthorizationCatalog }> |
    undefined |
    Promise<Readonly<{ readonly applicationId: string; readonly lifecycleRevision: number; readonly catalog: EffectiveAuthorizationCatalog }> | undefined>;
}

export interface EffectiveAuthorityResolverOptions {
  readonly store: AuthorizationStore;
  readonly catalogProvider: AuthorizationCatalogProvider;
  readonly maxCacheEntries?: number;
}

const sessions = new WeakSet<object>();
const requests = new WeakSet<object>();
const catalogProviders = new WeakSet<object>();
const maxFactsBytes = 16_384;
const maxFactsDepth = 8;

function fail(code: EffectiveAuthorityErrorCode, message: string): never {
  throw new EffectiveAuthorityError(code, message);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("INVALID_REQUEST", "Authorization value is not canonical.");
  }
  return value as Record<string, unknown>;
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

function sameSubject(left: AuthorizationSubject, right: AuthorizationSubject): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function ownerKey(owner: AuthorizationOwnerRef): string {
  return owner.kind === "platform"
    ? `platform:${owner.namespace}`
    : `extension:${owner.deliveryClass}:${owner.extensionId}:${owner.generation}`;
}

function sameOwner(left: AuthorizationOwnerRef, right: AuthorizationOwnerRef): boolean {
  return ownerKey(left) === ownerKey(right);
}

function generationCurrent(owner: AuthorizationOwnerRef, generations: readonly ExtensionAuthorizationGeneration[]): boolean {
  return owner.kind === "platform" || generations.some((generation) => generation.state === "current" && sameOwner(owner, generation.owner));
}

function boundedFacts(value: unknown): boolean {
  const seen = new Set<object>();
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 0 }];
  try {
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.depth > maxFactsDepth) return false;
      if (typeof current.value !== "object" || current.value === null) continue;
      if (seen.has(current.value)) return false;
      seen.add(current.value);
      for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
    }
    return Buffer.byteLength(canonicalJson(value)) <= maxFactsBytes;
  } catch {
    return false;
  }
}

/** Mints the only session accepted by the resolver; structured clones lose this capability. */
export function createTrustedAuthorizationSession(value: unknown): TrustedAuthorizationSession {
  const input = exactObject(value, value !== null && typeof value === "object" && "delegation" in value ?
    ["applicationId", "correlationId", "delegation", "effectiveActor", "environment", "principal", "schemaVersion"] :
    ["applicationId", "correlationId", "effectiveActor", "environment", "principal", "schemaVersion"]);
  const state = AuthorizationStateSchema.safeParse({ schemaVersion: 1, applicationId: input.applicationId, environment: input.environment, authorizationRevision: 0, lifecycleRevision: 0 });
  const principal = AuthorizationSubjectSchema.safeParse(input.principal);
  const effectiveActor = AuthorizationSubjectSchema.safeParse(input.effectiveActor);
  const delegation = input.delegation === undefined ? undefined : AuthorizationDelegationSchema.safeParse(input.delegation);
  if (input.schemaVersion !== 1 || !state.success || !principal.success || !effectiveActor.success || typeof input.correlationId !== "string" ||
    !AuthorizationDecisionSchema.safeParse({ schemaVersion: 1, decisionId: input.correlationId, correlationId: input.correlationId, applicationId: state.success ? state.data.applicationId : "invalid", environment: state.success ? state.data.environment : "invalid", permissionId: "system.permissions.read", owner: { kind: "platform", namespace: "system" }, principal: principal.success ? principal.data : { kind: "user", id: "invalid" }, effectiveActor: effectiveActor.success ? effectiveActor.data : { kind: "user", id: "invalid" }, scope: { kind: "application", resource: "system.permissions" }, authorizationRevision: 0, lifecycleRevision: 0, outcome: "deny", reason: "permission-not-granted", approval: "not-required", reauthentication: "not-required" }).success ||
    delegation !== undefined && (!delegation.success || !sameSubject(delegation.data.delegator, principal.data))) {
    fail("INVALID_REQUEST", "Authorization session is invalid.");
  }
  if (delegation === undefined && !sameSubject(principal.data, effectiveActor.data)) fail("INVALID_REQUEST", "A changed effective actor requires reducing delegation.");
  const session = frozenClone({ schemaVersion: 1 as const, applicationId: state.data.applicationId, environment: state.data.environment, correlationId: input.correlationId, principal: principal.data, effectiveActor: effectiveActor.data, ...(delegation === undefined ? {} : { delegation: delegation.data }) });
  sessions.add(session);
  return session;
}

/** Lets boundary adapters reject raw or cloned values before resolver invocation. */
export function isTrustedAuthorizationSession(value: unknown): value is TrustedAuthorizationSession {
  return typeof value === "object" && value !== null && sessions.has(value);
}

/** Mints a server-selected target. Raw or cloned request objects are never accepted. */
export function createEffectiveAuthorizationRequest(value: unknown): EffectiveAuthorizationRequest {
  const input = exactObject(value, ["decisionId", "facts", "permissionId", "schemaVersion", "scope"]);
  const permissionId = AuthorizationPermissionIdSchema.safeParse(input.permissionId);
  const scope = AuthorizationScopeSchema.safeParse(input.scope);
  if (input.schemaVersion !== 1 || !permissionId.success || !scope.success || typeof input.decisionId !== "string" || !boundedFacts(input.facts)) {
    fail("INVALID_REQUEST", "Authorization request is invalid.");
  }
  const request = frozenClone({ schemaVersion: 1 as const, decisionId: input.decisionId, permissionId: permissionId.data, scope: scope.data, facts: input.facts });
  requests.add(request);
  return request;
}

/** Brands the host-owned source of current effective catalogs. */
export function createAuthorizationCatalogProvider(current: AuthorizationCatalogProvider["current"]): AuthorizationCatalogProvider {
  if (typeof current !== "function") fail("INVALID_REQUEST", "Authorization catalog provider is invalid.");
  const provider = Object.freeze({ current });
  catalogProviders.add(provider);
  return provider;
}

interface CachedAuthority {
  readonly activeAssignments: number;
  readonly revokedAssignments: number;
  readonly ownersByPermission: ReadonlyMap<string, readonly AuthorizationOwnerRef[]>;
  readonly ineffectiveOwnersByPermission: ReadonlyMap<string, readonly AuthorizationOwnerRef[]>;
}

interface AuthoritySnapshot {
  readonly principal: CachedAuthority;
  readonly effectiveActor: CachedAuthority;
  readonly intersection: ReadonlyMap<string, readonly AuthorizationOwnerRef[]>;
}

function roleIds(assignments: readonly RoleAssignment[], roles: readonly Role[]): ReadonlySet<string> {
  const rolesById = new Set(roles.map((role) => role.id));
  return new Set(assignments.filter((assignment) => assignment.state === "active" && rolesById.has(assignment.roleId)).map((assignment) => assignment.roleId));
}

function authority(assignments: readonly RoleAssignment[], roles: readonly Role[], grants: readonly RolePermissionGrant[], generations: readonly ExtensionAuthorizationGeneration[]): CachedAuthority {
  const activeAssignments = assignments.filter((assignment) => assignment.state === "active");
  const owners = new Map<string, AuthorizationOwnerRef[]>();
  const ineffectiveOwners = new Map<string, AuthorizationOwnerRef[]>();
  const rolesForActor = roleIds(assignments, roles);
  for (const grant of grants) {
    if (!rolesForActor.has(grant.roleId)) continue;
    const target = generationCurrent(grant.owner, generations) ? owners : ineffectiveOwners;
    const current = target.get(grant.permissionId) ?? [];
    if (!current.some((owner) => sameOwner(owner, grant.owner))) current.push(frozenClone(grant.owner));
    target.set(grant.permissionId, current);
  }
  return Object.freeze({
    activeAssignments: activeAssignments.length,
    revokedAssignments: assignments.filter((assignment) => assignment.state === "revoked").length,
    ownersByPermission: new Map([...owners].map(([permissionId, values]) => [permissionId, Object.freeze(values.sort((left, right) => ownerKey(left).localeCompare(ownerKey(right))))])),
    ineffectiveOwnersByPermission: new Map([...ineffectiveOwners].map(([permissionId, values]) => [permissionId, Object.freeze(values.sort((left, right) => ownerKey(left).localeCompare(ownerKey(right))))]))
  });
}

function intersect(left: CachedAuthority, right: CachedAuthority): ReadonlyMap<string, readonly AuthorizationOwnerRef[]> {
  const result = new Map<string, readonly AuthorizationOwnerRef[]>();
  for (const [permissionId, owners] of left.ownersByPermission) {
    const rightOwners = right.ownersByPermission.get(permissionId) ?? [];
    const common = owners.filter((owner) => rightOwners.some((candidate) => sameOwner(owner, candidate)));
    if (common.length > 0) result.set(permissionId, Object.freeze(common));
  }
  return result;
}

export class EffectiveAuthorityResolver {
  readonly #store: AuthorizationStore;
  readonly #catalogProvider: AuthorizationCatalogProvider;
  readonly #maxCacheEntries: number;
  readonly #cache = new Map<string, AuthoritySnapshot>();

  constructor(options: EffectiveAuthorityResolverOptions) {
    if (!catalogProviders.has(options.catalogProvider)) fail("UNTRUSTED_CATALOG_PROVIDER", "Authorization catalog provider was not minted by K-Nex.");
    if (!Number.isSafeInteger(options.maxCacheEntries ?? 256) || (options.maxCacheEntries ?? 256) < 1 || (options.maxCacheEntries ?? 256) > 4_096) {
      throw new TypeError("Authorization cache limit is invalid.");
    }
    this.#store = options.store;
    this.#catalogProvider = options.catalogProvider;
    this.#maxCacheEntries = options.maxCacheEntries ?? 256;
  }

  async authorize(session: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest, signal: AbortSignal = new AbortController().signal): Promise<AuthorizationDecision> {
    if (!sessions.has(session)) fail("UNTRUSTED_SESSION", "Authorization session was not minted by K-Nex.");
    if (!requests.has(request)) fail("INVALID_REQUEST", "Authorization request was not minted by K-Nex.");
    const current = await this.#store.readState(session.applicationId, session.environment);
    if (current === undefined) fail("AUTHORITY_UNAVAILABLE", "Authorization state is unavailable.");
    const catalogValue = await this.#catalogProvider.current({ applicationId: session.applicationId, lifecycleRevision: current.lifecycleRevision });
    if (catalogValue === undefined || catalogValue.applicationId !== session.applicationId || catalogValue.lifecycleRevision !== current.lifecycleRevision ||
      !isEffectiveAuthorizationCatalogForLifecycle(catalogValue.catalog, session.applicationId, current.lifecycleRevision)) {
      fail("AUTHORITY_UNAVAILABLE", "Current effective authorization catalog is unavailable.");
    }
    const expected: AuthorizationExpectedRevision = Object.freeze({ applicationId: session.applicationId, environment: session.environment, authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision });
    let snapshot: AuthoritySnapshot;
    try {
      snapshot = await this.#authority(expected, session);
    } catch (error) {
      if (error instanceof EffectiveAuthorityError) throw error;
      fail("AUTHORITY_UNAVAILABLE", "Current authorization data is unavailable.");
    }
    return this.#decide(current, catalogValue.catalog, session, request, snapshot, signal);
  }

  async #authority(expected: AuthorizationExpectedRevision, session: TrustedAuthorizationSession): Promise<AuthoritySnapshot> {
    const key = canonicalJson({ applicationId: expected.applicationId, environment: expected.environment, principal: session.principal, effectiveActor: session.effectiveActor, delegationId: session.delegation?.delegationId ?? null, authorizationRevision: expected.authorizationRevision, lifecycleRevision: expected.lifecycleRevision });
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }
    const outcome = await this.#store.transaction(expected, async (transaction) => {
      // One PostgreSQL transaction owns one session; issue reads serially.
      const roles = await transaction.listRoles(expected.applicationId);
      const grants = await transaction.listGrants(expected.applicationId);
      const principalAssignments = await transaction.listAssignments(expected.applicationId, session.principal);
      const actorAssignments = sameSubject(session.principal, session.effectiveActor)
        ? []
        : await transaction.listAssignments(expected.applicationId, session.effectiveActor);
      const generations = await transaction.listExtensionGenerations(expected.applicationId);
      const principal = authority(principalAssignments, roles, grants, generations);
      const effectiveActor = sameSubject(session.principal, session.effectiveActor) ? principal : authority(actorAssignments, roles, grants, generations);
      return Object.freeze({ principal, effectiveActor, intersection: intersect(principal, effectiveActor) });
    });
    const snapshot = outcome.value;
    while (this.#cache.size >= this.#maxCacheEntries) this.#cache.delete(this.#cache.keys().next().value as string);
    this.#cache.set(key, snapshot);
    return snapshot;
  }

  async #decide(current: Readonly<{ applicationId: string; environment: string; authorizationRevision: number; lifecycleRevision: number }>, catalog: EffectiveAuthorizationCatalog, session: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest, snapshot: AuthoritySnapshot, signal: AbortSignal): Promise<AuthorizationDecision> {
    const descriptor = catalog.permissions.find(({ descriptor: candidate }) => candidate.id === request.permissionId);
    const candidates = snapshot.principal.ownersByPermission.get(request.permissionId) ?? [];
    const inactiveCandidates = snapshot.principal.ineffectiveOwnersByPermission.get(request.permissionId) ?? [];
    const owner = descriptor?.owner ?? candidates[0];
    if (owner === undefined) fail("INVALID_REQUEST", "Requested permission is not in the current authoritative catalog.");
    let outcome: "allow" | "deny" = "deny";
    let reason: AuthorizationDecision["reason"] = "permission-not-granted";
    const effectiveOwners = snapshot.intersection.get(request.permissionId) ?? [];
    if (descriptor === undefined || !effectiveOwners.some((candidate) => sameOwner(candidate, owner))) {
      if (session.delegation !== undefined && candidates.some((candidate) => sameOwner(candidate, owner))) reason = "delegation-reduced";
      else if (candidates.length > 0 || inactiveCandidates.length > 0) reason = "owner-not-effective";
      else if (snapshot.principal.activeAssignments === 0 && snapshot.principal.revokedAssignments > 0) reason = "assignment-revoked";
    } else if (descriptor.descriptor.scope !== request.scope.kind || descriptor.descriptor.resource !== request.scope.resource) {
      reason = "policy-denied";
    } else {
      const binding = catalog.policyBindings.find((candidate) => candidate.binding.permissionId === request.permissionId && sameOwner(candidate.owner, owner));
      if (binding === undefined && descriptor.descriptor.scope !== "application") {
        reason = "policy-denied";
      } else if (binding === undefined) {
        outcome = "allow";
        reason = "granted";
      } else {
        try {
          const policy = await catalog.execute({ schemaVersion: 1, applicationId: session.applicationId, permissionId: request.permissionId, scope: request.scope, principal: session.principal, effectiveActor: session.effectiveActor, ...(session.delegation === undefined ? {} : { delegation: session.delegation }), facts: request.facts }, signal);
          if (policy.outcome === "allow") {
            outcome = "allow";
            reason = "granted";
          } else reason = "policy-denied";
        } catch {
          reason = "policy-denied";
        }
      }
    }
    return AuthorizationDecisionSchema.parse({ schemaVersion: 1, decisionId: request.decisionId, correlationId: session.correlationId, applicationId: current.applicationId, environment: current.environment, permissionId: request.permissionId, owner, principal: session.principal, effectiveActor: session.effectiveActor, ...(session.delegation === undefined ? {} : { delegation: session.delegation }), scope: request.scope, authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, outcome, reason, approval: "not-required", reauthentication: "not-required" });
  }
}
