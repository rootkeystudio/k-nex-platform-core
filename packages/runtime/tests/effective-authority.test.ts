import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationOwnerRef,
  AuthorizationState,
  ExtensionAuthorizationGeneration,
  Role,
  RoleAssignment,
  RolePermissionGrant
} from "@k-nex/contracts";
import type { PluginManifest } from "@k-nex/contracts";
import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";

import {
  EffectiveAuthorityError,
  EffectiveAuthorityResolver,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationRequest,
  createTrustedAuthorizationSession,
  type AuthorizationCatalogProvider
} from "../src/effective-authority.js";
import {
  createEffectiveAuthorizationCatalog,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  type EffectiveAuthorizationCatalog
} from "../src/authorization-registry.js";
import type { AuthorizationStore, AuthorizationStoreReadTransaction, AuthorizationStoreTransaction } from "../src/authorization-store.js";
import { definePluginRegistration, executeRegistration } from "../src/registration-runtime.js";
import { scopePlatformPluginRegistration } from "../src/plugin-lifecycle.js";

const applicationId = "customer-alpha";
const environment = "production";
const platformOwner = { kind: "platform", namespace: "system" } as const;
const salesOwner = { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 7 } as const;
const state = (authorizationRevision = 1, lifecycleRevision = 1): AuthorizationState => ({ schemaVersion: 1, applicationId, environment, authorizationRevision, lifecycleRevision });
const subject = (id: string) => ({ kind: "user" as const, id });
const role = (id: string): Role => ({ schemaVersion: 1, id, applicationId, label: id, revision: 1 });
const assignment = (id: string, roleId: string, principal: ReturnType<typeof subject>, assignmentState: "active" | "revoked" = "active"): RoleAssignment => ({ schemaVersion: 1, id, applicationId, roleId, principal, state: assignmentState, revision: 1 });
const grant = (id: string, roleId: string, permissionId: string, owner: AuthorizationOwnerRef): RolePermissionGrant => ({ schemaVersion: 1, id, applicationId, roleId, permissionId, owner, revision: 1 });
const generation = (owner = salesOwner, generationState: "current" | "retired" = "current"): ExtensionAuthorizationGeneration => ({ schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["sales-generation-1"], state: generationState, authorizationRevision: 1, lifecycleRevision: 1 });

function catalog(lifecycleRevision = 1): EffectiveAuthorizationCatalog {
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [], executables: [] });
}

function extensionCatalog(input: Readonly<{
  permissionId: string;
  owner?: typeof salesOwner;
  resource: string;
  scope?: "application" | "record" | "field";
  execute?: () => unknown | Promise<unknown>;
  lifecycleRevision?: number;
}>): EffectiveAuthorizationCatalog {
  const publisher = { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" } as const;
  const owner = input.owner ?? salesOwner;
  const scope = input.scope ?? "application";
  const descriptor = {
    schemaVersion: 1 as const, id: input.permissionId, publisher, title: input.permissionId, description: input.permissionId,
    audience: "authenticated" as const, resource: input.resource, operation: "execute" as const, scope
  };
  const policyBinding = input.execute === undefined ? undefined : {
    schemaVersion: 1 as const, id: `${input.permissionId}.binding`, publisher, permissionId: input.permissionId,
    policyReference: `${input.permissionId}.policy`, scope, failureMode: "deny" as const, timeoutMs: 25
  };
  const manifest = {
    apiVersion: 1, id: publisher.extensionId, kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: { permissions: { [descriptor.id]: "required" }, ...(policyBinding === undefined ? {} : { policyBindings: { [policyBinding.id]: "required" } }) }
  } as PluginManifest;
  const graph: ResolvedPlatformPluginGraph = {
    resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-sales", required: [], optional: [] }],
    capabilityProviders: [], registrationOrder: [manifest.id]
  };
  const installed: readonly InstalledPlatformPluginManifest[] = [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales" }, manifest }];
  const registration = definePluginRegistration({ pluginId: manifest.id, contracts(context) {
    context.register("permissions", descriptor.id, descriptor);
    if (policyBinding !== undefined) context.register("policyBindings", policyBinding.id, policyBinding);
  } });
  const lifecycleRevision = input.lifecycleRevision ?? 1;
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration: scopePlatformPluginRegistration(executeRegistration({ graph, installed, registrations: [registration] }), []),
    generation: { schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["sales-generation-1"], state: "current", authorizationRevision: 1, lifecycleRevision }
  });
  const executable = policyBinding === undefined ? [] : [createPlatformPluginPolicyExecutable({
    kind: "platform-plugin", publisher, bindingId: policyBinding.id, policyReference: policyBinding.policyReference,
    executor: { evaluate: () => input.execute!() as never }
  })];
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [contribution], executables: executable });
}

class MemoryStore implements AuthorizationStore {
  transactionCalls = 0;
  readTransactionCalls = 0;
  constructor(
    private current: AuthorizationState = state(),
    readonly roles: readonly Role[] = [role("role.one")],
    readonly grants: readonly RolePermissionGrant[] = [grant("grant.one", "role.one", "system.extensions.plan", platformOwner)],
    readonly assignments: readonly RoleAssignment[] = [assignment("assignment.one", "role.one", subject("user:one"))],
    private generationRows: readonly ExtensionAuthorizationGeneration[] = [],
    private readonly rejectConcurrentReads = false
  ) {}

  async readState(): Promise<AuthorizationState> { return this.current; }
  setState(value: AuthorizationState): void { this.current = value; }
  setGenerations(value: readonly ExtensionAuthorizationGeneration[]): void { this.generationRows = value; }
  #reading = false;
  private async read<T>(value: () => T): Promise<T> {
    if (this.rejectConcurrentReads && this.#reading) throw new Error("concurrent transaction read");
    this.#reading = true;
    try {
      await Promise.resolve();
      return value();
    } finally {
      this.#reading = false;
    }
  }
  private async transact<T>(expected: AuthorizationState, work: (transaction: AuthorizationStoreReadTransaction) => Promise<T>) {
    if (expected.authorizationRevision !== this.current.authorizationRevision || expected.lifecycleRevision !== this.current.lifecycleRevision) throw new Error("stale");
    const filter = (principal?: RoleAssignment["principal"]) => this.assignments.filter((value) => principal === undefined || value.principal.kind === principal.kind && value.principal.id === principal.id);
    const transaction: AuthorizationStoreReadTransaction = {
      readRole: async (_applicationId, roleId) => this.read(() => this.roles.find((value) => value.id === roleId)),
      listRoles: async () => this.read(() => this.roles),
      listGrants: async (_applicationId, roleId) => this.read(() => roleId === undefined ? this.grants : this.grants.filter((value) => value.roleId === roleId)),
      listAssignments: async (_applicationId, principal) => this.read(() => filter(principal)),
      listTemplateAdoptions: async () => this.read(() => []), listCatalogSnapshots: async () => this.read(() => []), listExtensionGenerations: async () => this.read(() => this.generationRows),
      readBootstrapReceipt: async () => undefined, listAudits: async () => []
    };
    return Object.freeze({ committed: true as const, value: await work(transaction), state: this.current });
  }
  async readTransaction<T>(expected: AuthorizationState, work: (transaction: AuthorizationStoreReadTransaction) => Promise<T>) {
    this.readTransactionCalls += 1;
    return this.transact(expected, work);
  }
  async transaction<T>(expected: AuthorizationState, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) {
    this.transactionCalls += 1;
    return this.transact(expected, async (read) => work({ ...read, write: async () => { throw new Error("resolver must not write"); } }));
  }
}

function provider(value: EffectiveAuthorizationCatalog, current = state()): AuthorizationCatalogProvider {
  return createAuthorizationCatalogProvider(({ applicationId: requestedApplicationId, lifecycleRevision }) =>
    requestedApplicationId === applicationId && lifecycleRevision === current.lifecycleRevision ? { applicationId, lifecycleRevision, catalog: value } : undefined);
}

function request(permissionId = "system.extensions.plan", scope = { kind: "application" as const, resource: "system.extensions" }) {
  return createEffectiveAuthorizationRequest({ schemaVersion: 1, decisionId: "decision:one", permissionId, scope, facts: {} });
}

describe("effective authority resolver", () => {
  it("reads authority through the read-only transaction", async () => {
    const store = new MemoryStore();
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: provider(catalog()) });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:read-only", principal: subject("user:one"), effectiveActor: subject("user:one") });

    await expect(resolver.authorize(session, request())).resolves.toMatchObject({ outcome: "allow" });

    expect(store.readTransactionCalls).toBe(1);
    expect(store.transactionCalls).toBe(0);
  });

  it("rejects raw and cloned sessions", async () => {
    const resolver = new EffectiveAuthorityResolver({ store: new MemoryStore(), catalogProvider: provider(catalog()) });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:one") });
    await expect(resolver.authorize({ ...session }, request())).rejects.toMatchObject({ code: "UNTRUSTED_SESSION" } satisfies Partial<EffectiveAuthorityError>);
    await expect(resolver.authorize(structuredClone(session), request())).rejects.toMatchObject({ code: "UNTRUSTED_SESSION" } satisfies Partial<EffectiveAuthorityError>);
  });

  it("accepts only the exact factory catalog from a trusted provider", async () => {
    const factoryCatalog = catalog();
    const raw = {
      permissions: factoryCatalog.permissions,
      policyBindings: factoryCatalog.policyBindings,
      roleTemplates: factoryCatalog.roleTemplates,
      execute: factoryCatalog.execute
    } as EffectiveAuthorizationCatalog;
    const clone = { ...factoryCatalog } as EffectiveAuthorizationCatalog;
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:catalog", principal: subject("user:one"), effectiveActor: subject("user:one") });
    await expect(new EffectiveAuthorityResolver({ store: new MemoryStore(), catalogProvider: provider(raw) }).authorize(session, request())).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" } satisfies Partial<EffectiveAuthorityError>);
    await expect(new EffectiveAuthorityResolver({ store: new MemoryStore(), catalogProvider: provider(clone) }).authorize(session, request())).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" } satisfies Partial<EffectiveAuthorityError>);
    await expect(new EffectiveAuthorityResolver({ store: new MemoryStore(), catalogProvider: provider(factoryCatalog) }).authorize(session, request())).resolves.toMatchObject({ outcome: "allow", reason: "granted" });
  });

  it("rejects an exact catalog branded for an older lifecycle revision", async () => {
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:catalog-revision", principal: subject("user:one"), effectiveActor: subject("user:one") });
    const resolver = new EffectiveAuthorityResolver({
      store: new MemoryStore(state(1, 2)),
      catalogProvider: createAuthorizationCatalogProvider(() => ({ applicationId, lifecycleRevision: 2, catalog: catalog(1) }))
    });
    await expect(resolver.authorize(session, request())).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" } satisfies Partial<EffectiveAuthorityError>);
  });

  it("intersects principal and delegated effective actor", async () => {
    const store = new MemoryStore(state(), [role("one"), role("two")], [grant("one", "one", "system.extensions.plan", platformOwner), grant("two", "two", "system.extensions.plan", platformOwner)], [assignment("one", "one", subject("user:one")), assignment("two", "two", subject("user:two"))]);
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: provider(catalog()) });
    const allowed = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:two"), delegation: { delegationId: "delegation:one", delegator: subject("user:one"), effect: "reducing" } });
    await expect(resolver.authorize(allowed, request())).resolves.toMatchObject({ outcome: "allow", reason: "granted" });
    const denied = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:two", principal: subject("user:one"), effectiveActor: subject("user:three"), delegation: { delegationId: "delegation:two", delegator: subject("user:one"), effect: "reducing" } });
    await expect(resolver.authorize(denied, request())).resolves.toMatchObject({ outcome: "deny", reason: "delegation-reduced" });
  });

  it("isolates cache by actor and both revisions", async () => {
    const store = new MemoryStore();
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: createAuthorizationCatalogProvider(({ lifecycleRevision }) => ({ applicationId, lifecycleRevision, catalog: catalog(lifecycleRevision) })) });
    const one = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:one") });
    const two = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:two", principal: subject("user:two"), effectiveActor: subject("user:two") });
    await resolver.authorize(one, request());
    await resolver.authorize(one, request());
    await resolver.authorize(two, request());
    store.setState(state(2, 2));
    await resolver.authorize(one, request());
    expect(store.readTransactionCalls).toBe(3);
    expect(store.transactionCalls).toBe(0);
  });

  it("serializes reads within one durable transaction session", async () => {
    const resolver = new EffectiveAuthorityResolver({ store: new MemoryStore(state(), undefined, undefined, undefined, undefined, true), catalogProvider: provider(catalog()) });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:one") });
    await expect(resolver.authorize(session, request())).resolves.toMatchObject({ outcome: "allow" });
  });

  it("does not reuse an extension grant across a generation revision", async () => {
    const nextSalesOwner = { ...salesOwner, generation: 8 } as const;
    const store = new MemoryStore(state(1, 1), [role("sales")], [grant("sales", "sales", "sales.records.read", salesOwner)], [assignment("sales", "sales", subject("user:one"))], [generation(salesOwner)]);
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: createAuthorizationCatalogProvider(({ lifecycleRevision }) => ({
      applicationId, lifecycleRevision, catalog: extensionCatalog({ permissionId: "sales.records.read", owner: lifecycleRevision === 1 ? salesOwner : nextSalesOwner, resource: "sales.records", scope: "record", lifecycleRevision })
    })) });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:one") });
    const salesRequest = request("sales.records.read", { kind: "record", resource: "sales.records", recordId: "record:one" });
    await expect(resolver.authorize(session, salesRequest)).resolves.toMatchObject({ outcome: "deny", reason: "policy-denied" });
    store.setGenerations([generation(nextSalesOwner)]);
    store.setState(state(1, 2));
    await expect(resolver.authorize(session, salesRequest)).resolves.toMatchObject({ outcome: "deny", reason: "owner-not-effective" });
    expect(store.readTransactionCalls).toBe(2);
    expect(store.transactionCalls).toBe(0);
  });

  it("keeps mixed system grants while dormant and orphaned extension grants deny", async () => {
    const store = new MemoryStore(state(), [role("mixed")], [grant("system", "mixed", "system.extensions.plan", platformOwner), grant("sales", "mixed", "sales.records.read", salesOwner)], [assignment("mixed", "mixed", subject("user:one"))], [generation(salesOwner, "retired")]);
    const effectiveCatalog = extensionCatalog({ permissionId: "sales.records.read", resource: "sales.records", scope: "record" });
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: provider(effectiveCatalog) });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:one") });
    await expect(resolver.authorize(session, request())).resolves.toMatchObject({ outcome: "allow" });
    await expect(resolver.authorize(session, request("sales.records.read", { kind: "record", resource: "sales.records", recordId: "record:one" }))).resolves.toMatchObject({ outcome: "deny", reason: "owner-not-effective" });
    const orphaned = new EffectiveAuthorityResolver({
      store: new MemoryStore(state(), [role("mixed")], [grant("sales", "mixed", "sales.records.read", salesOwner)], [assignment("mixed", "mixed", subject("user:one"))], [generation(salesOwner)]),
      catalogProvider: provider(extensionCatalog({ permissionId: "sales.records.read", owner: { ...salesOwner, generation: 8 }, resource: "sales.records", scope: "record" }))
    });
    await expect(orphaned.authorize(session, request("sales.records.read", { kind: "record", resource: "sales.records", recordId: "record:one" }))).resolves.toMatchObject({ outcome: "deny", reason: "owner-not-effective" });
    const revoked = new EffectiveAuthorityResolver({
      store: new MemoryStore(state(), [role("one")], [grant("one", "one", "system.extensions.plan", platformOwner)], [assignment("revoked", "one", subject("user:one"), "revoked")]),
      catalogProvider: provider(catalog())
    });
    await expect(revoked.authorize(session, request())).resolves.toMatchObject({ outcome: "deny", reason: "assignment-revoked" });
  });

  it("denies mismatched scope and policy denial or failure", async () => {
    const execute = vi.fn(async () => ({ schemaVersion: 1 as const, outcome: "deny" as const }));
    const effectiveCatalog = extensionCatalog({ permissionId: "sales.policy.read", resource: "sales.policy", execute });
    const resolver = new EffectiveAuthorityResolver({
      store: new MemoryStore(state(), [role("sales")], [grant("sales", "sales", "sales.policy.read", salesOwner)], [assignment("sales", "sales", subject("user:one"))], [generation(salesOwner)]),
      catalogProvider: provider(effectiveCatalog)
    });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "correlation:one", principal: subject("user:one"), effectiveActor: subject("user:one") });
    await expect(resolver.authorize(session, request("sales.policy.read", { kind: "application", resource: "system.themes" }))).resolves.toMatchObject({ outcome: "deny", reason: "policy-denied" });
    await expect(resolver.authorize(session, request("sales.policy.read", { kind: "application", resource: "sales.policy" }))).resolves.toMatchObject({ outcome: "deny", reason: "policy-denied" });
    const failingResolver = new EffectiveAuthorityResolver({
      store: new MemoryStore(state(), [role("sales")], [grant("sales", "sales", "sales.policy.read", salesOwner)], [assignment("sales", "sales", subject("user:one"))], [generation(salesOwner)]),
      catalogProvider: provider(extensionCatalog({ permissionId: "sales.policy.read", resource: "sales.policy", execute: () => { throw new Error("policy unavailable"); } }))
    });
    await expect(failingResolver.authorize(session, request("sales.policy.read", { kind: "application", resource: "sales.policy" }))).resolves.toMatchObject({ outcome: "deny", reason: "policy-denied" });
  });
});
