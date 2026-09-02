import { describe, expect, it } from "vitest";

import type {
  AuthorizationState,
  ExtensionAuthorizationGeneration,
  Role,
  RoleAssignment,
  RolePermissionGrant
} from "@k-nex/contracts";
import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";
import type { PluginManifest } from "@k-nex/contracts";

import {
  createEffectiveAuthorizationCatalog,
  createPlatformPluginRegistrationAuthorizationContribution,
  type EffectiveAuthorizationCatalog
} from "../src/authorization-registry.js";
import {
  AuthorizationStoreError,
  parseAuthorizationStoreMutation,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreMutation,
  type AuthorizationStoreTransaction
} from "../src/authorization-store.js";
import {
  EffectiveAuthorityResolver,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationRequest,
  createTrustedAuthorizationSession
} from "../src/effective-authority.js";
import {
  createPlatformPluginLifecycleState,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration
} from "../src/plugin-lifecycle.js";
import { definePluginRegistration, executeRegistration } from "../src/registration-runtime.js";
import { adoptRetainedExtensionGrants } from "../src/retained-grant-adoption.js";

const applicationId = "customer-alpha";
const expected: AuthorizationExpectedRevision = Object.freeze({ applicationId, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 });
const oldOwner = Object.freeze({ kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 });
const targetOwner = Object.freeze({ ...oldOwner, generation: 2 });
const platformOwner = Object.freeze({ kind: "platform" as const, namespace: "system" as const });

const role = (): Role => ({ schemaVersion: 1, id: "sales.mixed", applicationId, label: "Mixed role", revision: 0 });
const grant = (id: string, permissionId: string, owner: RolePermissionGrant["owner"] = oldOwner): RolePermissionGrant => ({ schemaVersion: 1, id, applicationId, roleId: role().id, permissionId, owner, revision: 0 });
const generation = (
  owner: ExtensionAuthorizationGeneration["owner"],
  state: "current" | "retired",
  options: Readonly<Partial<Pick<ExtensionAuthorizationGeneration, "runtimeGenerationIds" | "authorizationRevision" | "lifecycleRevision">>> = {}
): ExtensionAuthorizationGeneration => ({
  schemaVersion: 1,
  applicationId,
  owner,
  runtimeGenerationIds: options.runtimeGenerationIds ?? [`sales-generation-${owner.generation}`],
  state,
  authorizationRevision: options.authorizationRevision ?? 0,
  lifecycleRevision: options.lifecycleRevision ?? 0
});

function catalog(
  permissionIds = ["sales.orders.read", "sales.orders.write"],
  targetApplicationId = applicationId,
  options: Readonly<{
    enabled?: boolean;
    lifecycleRevision?: number;
    authorizationRevision?: number;
    runtimeGenerationIds?: readonly string[];
  }> = {}
): EffectiveAuthorizationCatalog {
  const publisher = { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales" };
  const descriptors = permissionIds.map((id) => ({
    schemaVersion: 1 as const, id, publisher, title: id, description: "Sales permission", audience: "authenticated" as const,
    resource: "sales.orders", operation: "read" as const, scope: "application" as const
  }));
  const manifest = {
    apiVersion: 1, id: publisher.extensionId, kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: { permissions: Object.fromEntries(descriptors.map(({ id }) => [id, "required"])) }
  } as PluginManifest;
  const graph: ResolvedPlatformPluginGraph = {
    resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-sales", required: [], optional: [] }],
    capabilityProviders: [], registrationOrder: [manifest.id]
  };
  const installed: readonly InstalledPlatformPluginManifest[] = [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales" }, manifest }];
  const registration = definePluginRegistration({
    pluginId: manifest.id,
    contracts(context) { for (const descriptor of descriptors) context.register("permissions", descriptor.id, descriptor); }
  });
  const executed = executeRegistration({ graph, installed, registrations: [registration] });
  const disabled = options.enabled === false;
  const scoped = scopePlatformPluginRegistration(executed, disabled ? [reconcilePlatformPluginAvailability(executed, createPlatformPluginLifecycleState({
    pluginId: manifest.id,
    catalogStatus: "supported",
    package: { status: "installed", name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" },
    enabled: false,
    configuration: { revision: 0, ready: true },
    migration: { current: 0, required: 0, ready: true },
    dataState: "retained",
    releaseStatus: "supported"
  }))] : []);
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration: scoped,
    generation: {
      schemaVersion: 1,
      applicationId: targetApplicationId,
      owner: targetOwner,
      runtimeGenerationIds: options.runtimeGenerationIds ?? ["sales-generation-2"],
      state: "current",
      authorizationRevision: options.authorizationRevision ?? 0,
      lifecycleRevision: options.lifecycleRevision ?? 0
    }
  });
  return createEffectiveAuthorizationCatalog({ applicationId: targetApplicationId, lifecycleRevision: options.lifecycleRevision ?? 0, extensions: [contribution], executables: [] });
}

class MemoryStore implements AuthorizationStore {
  readonly roles = new Map<string, Role>();
  readonly grants = new Map<string, RolePermissionGrant>();
  readonly assignments = new Map<string, RoleAssignment>();
  readonly writes: AuthorizationStoreMutation[] = [];
  state: AuthorizationState = { schemaVersion: 1, ...expected };

  constructor(seed: Readonly<{ readonly roles?: readonly Role[]; readonly grants?: readonly RolePermissionGrant[]; readonly assignments?: readonly RoleAssignment[]; readonly generations?: readonly ExtensionAuthorizationGeneration[] }> = {}) {
    for (const value of seed.roles ?? []) this.roles.set(value.id, value);
    for (const value of seed.grants ?? []) this.grants.set(value.id, value);
    for (const value of seed.assignments ?? []) this.assignments.set(value.id, value);
    this.generations = [...(seed.generations ?? [])];
  }

  private generations: ExtensionAuthorizationGeneration[];
  async readState(): Promise<AuthorizationState> { return this.state; }
  async readTransaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: Omit<AuthorizationStoreTransaction, "write">) => Promise<T>) { return this.transaction(actual, work); }
  async bootstrapFirstOwnerTransaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) { return this.transaction(actual, work); }
  async transaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) {
    if (actual.applicationId !== this.state.applicationId || actual.environment !== this.state.environment || actual.authorizationRevision !== this.state.authorizationRevision || actual.lifecycleRevision !== this.state.lifecycleRevision) {
      throw new AuthorizationStoreError("REVISION_CONFLICT", "Authorization state changed.");
    }
    const staged: AuthorizationStoreMutation[] = [];
    const transaction: AuthorizationStoreTransaction = {
      readRole: async (_applicationId, roleId) => this.roles.get(roleId),
      listRoles: async () => [...this.roles.values()],
      listGrants: async (_applicationId, roleId) => [...this.grants.values()].filter((value) => roleId === undefined || value.roleId === roleId),
      listAssignments: async (_applicationId, principal) => [...this.assignments.values()].filter((value) => principal === undefined || value.principal.kind === principal.kind && value.principal.id === principal.id),
      listTemplateAdoptions: async () => [], listCatalogSnapshots: async () => [], listExtensionGenerations: async () => this.generations,
      readBootstrapReceipt: async () => undefined, listAudits: async () => [],
      write: async (mutation) => { staged.push(await parseAuthorizationStoreMutation(mutation)); }
    };
    const value = await work(transaction);
    for (const mutation of staged) if (mutation.kind === "grant") this.grants.set(mutation.grant.id, mutation.grant);
    this.writes.push(...staged);
    if (staged.length > 0) this.state = { ...this.state, authorizationRevision: this.state.authorizationRevision + 1 };
    return Object.freeze({ committed: true as const, value, state: this.state });
  }
}

describe("retained extension grant adoption", () => {
  it("rebinds only explicit reviewed retained grants and preserves an unrelated platform grant", async () => {
    const oldRead = grant("grant.sales.read", "sales.orders.read");
    const platform = grant("grant.system.roles", "system.roles.read", platformOwner);
    const store = new MemoryStore({ roles: [role()], grants: [oldRead, platform], generations: [generation(oldOwner, "retired"), generation(targetOwner, "current")] });

    const result = await adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: catalog(), targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] });

    expect(result.state.authorizationRevision).toBe(1);
    expect(result.value).toEqual([expect.objectContaining({ id: oldRead.id, roleId: oldRead.roleId, permissionId: oldRead.permissionId, owner: targetOwner, revision: 1 })]);
    expect(store.grants.get(oldRead.id)).toMatchObject({ owner: targetOwner, revision: 1 });
    expect(store.grants.get(platform.id)).toEqual(platform);
    expect(store.writes.every((mutation) => mutation.kind === "grant" && mutation.grant.id === oldRead.id)).toBe(true);
  });

  it("keeps a retired grant ineffective until explicit adoption rebinds it to the catalog's current generation", async () => {
    const oldRead = grant("grant.sales.read", "sales.orders.read");
    const assignment: RoleAssignment = { schemaVersion: 1, id: "assignment.sales", applicationId, roleId: role().id, principal: { kind: "user", id: "user:one" }, state: "active", revision: 0 };
    const store = new MemoryStore({ roles: [role()], grants: [oldRead], assignments: [assignment], generations: [generation(oldOwner, "retired"), generation(targetOwner, "current")] });
    const effectiveCatalog = catalog();
    const resolver = new EffectiveAuthorityResolver({
      store,
      catalogProvider: createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) => requested === applicationId && lifecycleRevision === 0 ? { applicationId, lifecycleRevision, catalog: effectiveCatalog } : undefined)
    });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment: "production", correlationId: "correlation.sales", principal: { kind: "user", id: "user:one" }, effectiveActor: { kind: "user", id: "user:one" } });
    const request = createEffectiveAuthorizationRequest({ schemaVersion: 1, decisionId: "decision.sales", permissionId: oldRead.permissionId, scope: { kind: "application", resource: "sales.orders" }, facts: {} });

    await expect(resolver.authorize(session, request)).resolves.toMatchObject({ outcome: "deny", reason: "owner-not-effective" });
    await adoptRetainedExtensionGrants({ store, expected, effectiveCatalog, targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] });
    await expect(resolver.authorize(session, request)).resolves.toMatchObject({ outcome: "allow", reason: "granted", owner: targetOwner });
  });

  it("rejects stale lifecycle and disabled catalogs before any grant write", async () => {
    const oldRead = grant("grant.sales.read", "sales.orders.read");
    const base = () => new MemoryStore({ roles: [role()], grants: [oldRead], generations: [generation(oldOwner, "retired"), generation(targetOwner, "current")] });

    const stale = base();
    stale.state = { ...stale.state, lifecycleRevision: 1 };
    await expect(adoptRetainedExtensionGrants({
      store: stale,
      expected: { ...expected, lifecycleRevision: 1 },
      effectiveCatalog: catalog(["sales.orders.read"], applicationId, { lifecycleRevision: 0 }),
      targetOwner,
      roleId: role().id,
      selectedGrantIds: [oldRead.id]
    })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(stale.writes).toEqual([]);

    const disabled = base();
    await expect(adoptRetainedExtensionGrants({
      store: disabled,
      expected,
      effectiveCatalog: catalog(["sales.orders.read"], applicationId, { enabled: false }),
      targetOwner,
      roleId: role().id,
      selectedGrantIds: [oldRead.id]
    })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(disabled.writes).toEqual([]);
  });

  it("requires the catalog's exact current generation tuple before any grant write", async () => {
    const oldRead = grant("grant.sales.read", "sales.orders.read");
    const base = (target = generation(targetOwner, "current")) => new MemoryStore({
      roles: [role()],
      grants: [oldRead],
      generations: [generation(oldOwner, "retired"), target]
    });
    const attempt = async (
      store: MemoryStore,
      effectiveCatalog: EffectiveAuthorizationCatalog
    ) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog, targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] });

    const valid = base();
    await expect(attempt(valid, catalog())).resolves.toMatchObject({ value: [expect.objectContaining({ owner: targetOwner })] });
    expect(valid.writes).toHaveLength(1);

    const staleRuntime = base(generation(targetOwner, "current", { runtimeGenerationIds: ["sales-generation-new"] }));
    await expect(attempt(staleRuntime, catalog())).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(staleRuntime.writes).toEqual([]);

    const staleAuthorizationRevision = base(generation(targetOwner, "current", { authorizationRevision: 1 }));
    await expect(attempt(staleAuthorizationRevision, catalog())).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(staleAuthorizationRevision.writes).toEqual([]);

    const staleDescriptors = base();
    await expect(attempt(staleDescriptors, catalog(["sales.orders.write"]))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(staleDescriptors.writes).toEqual([]);
  });

  it("fails closed for stale, forged, cross-application, unreviewed, current, cross-owner, and ambiguous inputs", async () => {
    const oldRead = grant("grant.sales.read", "sales.orders.read");
    const currentRead = grant("grant.sales.current", "sales.orders.write", targetOwner);
    const foreign = grant("grant.finance.read", "finance.orders.read", { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.finance", generation: 1 });
    const base = () => new MemoryStore({ roles: [role()], grants: [oldRead, currentRead, foreign], generations: [generation(oldOwner, "retired"), generation(targetOwner, "current")] });
    const authentic = catalog();
    const attempts: readonly ((store: MemoryStore) => Promise<unknown>)[] = [
      (store) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: { ...authentic } as EffectiveAuthorizationCatalog, targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] }),
      (store) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: catalog(["sales.orders.read"], "customer-beta"), targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] }),
      (store) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: catalog(["sales.orders.write"]), targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] }),
      (store) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: authentic, targetOwner, roleId: role().id, selectedGrantIds: [currentRead.id] }),
      (store) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: authentic, targetOwner, roleId: role().id, selectedGrantIds: [foreign.id] }),
      (store) => adoptRetainedExtensionGrants({ store, expected, effectiveCatalog: authentic, targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id, oldRead.id] })
    ];
    for (const attempt of attempts) {
      const store = base();
      await expect(attempt(store)).rejects.toMatchObject({ code: "MUTATION_INVALID" });
      expect(store.writes).toEqual([]);
    }
    const stale = base();
    await expect(adoptRetainedExtensionGrants({ store: stale, expected: { ...expected, authorizationRevision: 1 }, effectiveCatalog: authentic, targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(stale.writes).toEqual([]);
    const missing = base();
    await expect(adoptRetainedExtensionGrants({ store: missing, expected, effectiveCatalog: authentic, targetOwner, roleId: role().id, selectedGrantIds: ["grant.sales.missing"] })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(missing.writes).toEqual([]);
    const protectedRole: Role = { schemaVersion: 1, id: "system.role.owner", applicationId, label: "Owner", protectedRoleId: "system.role.owner", revision: 0 };
    const protectedStore = new MemoryStore({ roles: [protectedRole], grants: [oldRead], generations: [generation(oldOwner, "retired"), generation(targetOwner, "current")] });
    await expect(adoptRetainedExtensionGrants({ store: protectedStore, expected, effectiveCatalog: authentic, targetOwner, roleId: protectedRole.id, selectedGrantIds: [oldRead.id] })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(protectedStore.writes).toEqual([]);
    const ambiguous = new MemoryStore({ roles: [role()], grants: [oldRead], generations: [generation(oldOwner, "retired"), generation(targetOwner, "current"), generation({ ...targetOwner, generation: 3 }, "current")] });
    await expect(adoptRetainedExtensionGrants({ store: ambiguous, expected, effectiveCatalog: authentic, targetOwner, roleId: role().id, selectedGrantIds: [oldRead.id] })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(ambiguous.writes).toEqual([]);
  });
});
