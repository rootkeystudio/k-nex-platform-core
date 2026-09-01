import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationDecision,
  AuthorizationDecisionAudit,
  AuthorizationState,
  PermissionCatalogSnapshot,
  Role,
  RoleAssignment,
  RolePermissionGrant,
  TemplateAdoption,
  PluginManifest
} from "@k-nex/contracts";
import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";

import { createAuthorizationCatalogProvider, createTrustedAuthorizationSession, type EffectiveAuthorityResolver, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { createEffectiveAuthorizationCatalog, createPlatformPluginRegistrationAuthorizationContribution } from "../src/authorization-registry.js";
import { AuthorizationStoreError, type AuthorizationAuditEntry, type AuthorizationExpectedRevision, type AuthorizationStore, type AuthorizationStoreMutation, type AuthorizationStoreTransaction } from "../src/authorization-store.js";
import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { SystemAccessAdministrationError, SystemAccessAdministrationService } from "../src/system-access-administration.js";
import { definePluginRegistration, executeRegistration } from "../src/registration-runtime.js";
import { scopePlatformPluginRegistration } from "../src/plugin-lifecycle.js";

const expected = Object.freeze({ applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 1 } satisfies AuthorizationExpectedRevision);
const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, correlationId: "system-access-test", principal: { kind: "user", id: "admin" }, effectiveActor: { kind: "user", id: "admin" } });
const catalog = createEffectiveAuthorizationCatalog({ applicationId: expected.applicationId, lifecycleRevision: expected.lifecycleRevision, extensions: [], executables: [] });

class MemoryStore implements AuthorizationStore {
  state: AuthorizationState = { schemaVersion: 1, ...expected };
  readonly roles = new Map<string, Role>();
  readonly grants = new Map<string, RolePermissionGrant>();
  readonly assignments = new Map<string, RoleAssignment>();
  readonly adoptions = new Map<string, TemplateAdoption>();
  readonly snapshots = new Map<string, PermissionCatalogSnapshot>();
  readonly audits: AuthorizationAuditEntry[] = [];
  readonly writes: AuthorizationStoreMutation[] = [];

  async readState(): Promise<AuthorizationState> { return this.state; }
  async bootstrapFirstOwnerTransaction<T>(): Promise<never> { throw new Error("not used"); }
  async transaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) {
    if (actual.applicationId !== this.state.applicationId || actual.environment !== this.state.environment || actual.authorizationRevision !== this.state.authorizationRevision || actual.lifecycleRevision !== this.state.lifecycleRevision) throw new Error("stale");
    const staged: AuthorizationStoreMutation[] = [];
    const view: AuthorizationStoreTransaction = {
      readRole: async (_applicationId, id) => this.roles.get(id),
      listRoles: async () => Object.freeze([...this.roles.values()]),
      listGrants: async (_applicationId, roleId) => Object.freeze([...this.grants.values()].filter((grant) => roleId === undefined || grant.roleId === roleId)),
      listAssignments: async (_applicationId, principal) => Object.freeze([...this.assignments.values()].filter((assignment) => principal === undefined || assignment.principal.kind === principal.kind && assignment.principal.id === principal.id)),
      listTemplateAdoptions: async (_applicationId, roleId) => Object.freeze([...this.adoptions.values()].filter((adoption) => roleId === undefined || adoption.roleId === roleId)),
      listCatalogSnapshots: async () => Object.freeze([...this.snapshots.values()]),
      listExtensionGenerations: async () => [],
      readBootstrapReceipt: async () => undefined,
      listAudits: async ({ afterAuditId, limit }) => {
        const entries = [...this.audits].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.audit.auditId.localeCompare(left.audit.auditId));
        const cursor = afterAuditId === undefined ? -1 : entries.findIndex((entry) => entry.audit.auditId === afterAuditId);
        return Object.freeze(afterAuditId === undefined ? entries.slice(0, limit) : cursor < 0 ? [] : entries.slice(cursor + 1, cursor + 1 + limit));
      },
      write: async (mutation) => { staged.push(mutation); }
    };
    const value = await work(view);
    for (const mutation of staged) this.apply(mutation);
    this.writes.push(...staged);
    if (staged.some((mutation) => mutation.kind !== "audit")) this.state = { ...this.state, authorizationRevision: this.state.authorizationRevision + 1 };
    return Object.freeze({ committed: true as const, value, state: this.state });
  }

  private apply(mutation: AuthorizationStoreMutation): void {
    if (mutation.kind === "role") this.roles.set(mutation.role.id, mutation.role);
    if (mutation.kind === "grant") this.grants.set(mutation.grant.id, mutation.grant);
    if (mutation.kind === "assignment") this.assignments.set(mutation.assignment.id, mutation.assignment);
    if (mutation.kind === "template-adoption") this.adoptions.set(mutation.adoption.id, mutation.adoption);
    if (mutation.kind === "catalog-snapshot") this.snapshots.set(mutation.snapshot.id, mutation.snapshot);
    if (mutation.kind === "audit") this.audits.push(Object.freeze({ audit: mutation.audit, occurredAt: new Date(this.audits.length).toISOString() }));
  }
}

function decision(request: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny", revisions = expected): AuthorizationDecision {
  return {
    schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
    permissionId: request.permissionId, owner: { kind: "platform", namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor,
    scope: request.scope, authorizationRevision: revisions.authorizationRevision, lifecycleRevision: revisions.lifecycleRevision,
    outcome, reason: outcome === "allow" ? "granted" : "permission-not-granted", approval: "not-required", reauthentication: "not-required"
  };
}

function service(store = new MemoryStore(), outcome: "allow" | "deny" = "allow", revisions: AuthorizationExpectedRevision | undefined = undefined, effectiveCatalog = catalog) {
  const resolver = { authorize: vi.fn(async (current: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) => decision(request, current, outcome, revisions ?? currentExpected(store.state))) } as unknown as Pick<EffectiveAuthorityResolver, "authorize">;
  const authority = new CurrentAuthorityAdapter({ current: async () => session }, resolver);
  const catalogProvider = createAuthorizationCatalogProvider(async ({ applicationId, lifecycleRevision }) => applicationId === expected.applicationId && lifecycleRevision === expected.lifecycleRevision ? { applicationId, lifecycleRevision, catalog: effectiveCatalog } : undefined);
  return { store, resolver, service: new SystemAccessAdministrationService({ store, catalogProvider, authority }) };
}

function role(id: string): Role { return { schemaVersion: 1, id, applicationId: expected.applicationId, label: id, revision: expected.authorizationRevision }; }
function audit(auditId: string): AuthorizationDecisionAudit {
  return {
    schemaVersion: 1, auditId, decisionId: `decision-${auditId}`, correlationId: `correlation-${auditId}`,
    applicationId: expected.applicationId, environment: expected.environment, permissionId: "system.roles.read",
    owner: { kind: "platform", namespace: "system" }, principal: { kind: "user", id: "admin" }, effectiveActor: { kind: "user", id: "admin" },
    scope: { kind: "application", resource: "system.roles" }, authorizationRevision: expected.authorizationRevision,
    lifecycleRevision: expected.lifecycleRevision, outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required"
  };
}
function currentExpected(state: AuthorizationState): AuthorizationExpectedRevision { return { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision }; }

function catalogWithTemplate() {
  const publisher = { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales" };
  const owner = { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 };
  const descriptors = ["sales.records.read", "sales.records.write"].map((id) => ({ schemaVersion: 1 as const, id, publisher, title: id, description: "Sales permission", audience: "authenticated" as const, resource: "sales.records", operation: id.endsWith("read") ? "read" as const : "write" as const, scope: "application" as const }));
  const template = { schemaVersion: 1 as const, id: "sales.manager", publisher, version: 1, instantiation: "manual" as const, title: "Sales manager", permissionIds: descriptors.map(({ id }) => id) };
  const manifest = {
    apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: { permissions: Object.fromEntries(descriptors.map(({ id }) => [id, "required"])), policyBindings: {}, roleTemplates: { [template.id]: "required" } }
  } as PluginManifest;
  const graph: ResolvedPlatformPluginGraph = { resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-sales", required: [], optional: [] }], capabilityProviders: [], registrationOrder: [manifest.id] };
  const installed: readonly InstalledPlatformPluginManifest[] = [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales" }, manifest }];
  const registration = definePluginRegistration({ pluginId: manifest.id, contracts(context) { for (const descriptor of descriptors) context.register("permissions", descriptor.id, descriptor); context.register("roleTemplates", template.id, template); } });
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({ registration: scopePlatformPluginRegistration(executeRegistration({ graph, installed, registrations: [registration] }), []), generation: { schemaVersion: 1, applicationId: expected.applicationId, owner, runtimeGenerationIds: ["sales-generation"], state: "current", authorizationRevision: expected.authorizationRevision, lifecycleRevision: expected.lifecycleRevision } });
  return createEffectiveAuthorizationCatalog({ applicationId: expected.applicationId, lifecycleRevision: expected.lifecycleRevision, extensions: [contribution], executables: [] });
}

describe("system access administration", () => {
  it("groups only effective permissions and exposes inactive snapshots as diagnostics", async () => {
    const { store, service: access } = service();
    store.snapshots.set("sales.read.inactive", {
      schemaVersion: 1, id: "sales.read.inactive", applicationId: expected.applicationId, source: "administrative-non-authoritative",
      permission: { schemaVersion: 1, id: "sales.read", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "sales" }, title: "Sales read", description: "Inactive", audience: "authenticated", resource: "sales.records", operation: "read", scope: "application" },
      state: "inactive-extension-disabled", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "sales", generation: 2 }, revision: expected.authorizationRevision
    });
    const view = await access.permissions({ context: {} });
    expect(view.active.filter((group) => group.resource === "system.roles").flatMap((group) => group.permissions.map(({ descriptor }) => descriptor.id)).sort()).toEqual(["system.roles.manage", "system.roles.read"]);
    expect(view.inactive).toEqual([expect.objectContaining({ snapshot: expect.objectContaining({ state: "inactive-extension-disabled", permission: expect.objectContaining({ id: "sales.read" }) }) })]);
  });

  it("derives the permission owner from the effective catalog and audits the role mutation atomically", async () => {
    const { store, service: access } = service();
    store.roles.set("customer-admin", role("customer-admin"));
    const result = await access.addPermission({ context: {}, expected, roleId: "customer-admin", permissionId: "system.roles.read" });
    expect(result.value).toMatchObject({ owner: { kind: "platform", namespace: "system" }, revision: 5 });
    expect(store.writes.slice(-2).map((mutation) => mutation.kind)).toEqual(["grant", "audit"]);
    expect(store.audits.at(-1)?.audit).toMatchObject({ permissionId: "system.roles.manage", authorizationRevision: 4, approval: "not-required", reauthentication: "not-required" });
    await expect(access.addPermission({ context: {}, expected: currentExpected(store.state), roleId: "customer-admin", permissionId: "system.roles.read", owner: { kind: "extension" } } as never)).rejects.toMatchObject({ code: "MUTATION_INVALID" } satisfies Partial<SystemAccessAdministrationError>);
  });

  it("denies unauthorized entry before reading or writing", async () => {
    const { store, service: access } = service(undefined, "deny");
    await expect(access.roles({ context: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<SystemAccessAdministrationError>);
    await expect(access.createRole({ context: {}, expected, role: { id: "customer-role", label: "Customer role" } })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<SystemAccessAdministrationError>);
    expect(store.writes).toEqual([]);
  });

  it("returns database occurrence times newest first and pages after the durable audit cursor", async () => {
    const { store, service: access } = service();
    store.audits.push(
      Object.freeze({ audit: audit("audit-older"), occurredAt: "2026-09-01T12:00:00.000Z" }),
      Object.freeze({ audit: audit("audit-alpha"), occurredAt: "2026-09-01T12:01:00.000Z" }),
      Object.freeze({ audit: audit("audit-omega"), occurredAt: "2026-09-01T12:01:00.000Z" })
    );

    await expect(access.audits({ context: {}, limit: 3 })).resolves.toEqual([
      { audit: audit("audit-omega"), occurredAt: "2026-09-01T12:01:00.000Z" },
      { audit: audit("audit-alpha"), occurredAt: "2026-09-01T12:01:00.000Z" },
      { audit: audit("audit-older"), occurredAt: "2026-09-01T12:00:00.000Z" }
    ]);
    await expect(access.audits({ context: {}, afterAuditId: "audit-alpha", limit: 3 })).resolves.toEqual([
      { audit: audit("audit-older"), occurredAt: "2026-09-01T12:00:00.000Z" }
    ]);
  });

  it("rejects stale authority decisions before mutation", async () => {
    const stale = { ...expected, authorizationRevision: expected.authorizationRevision + 1 };
    const { store, service: access } = service(undefined, "allow", stale);
    await expect(access.createRole({ context: {}, expected, role: { id: "customer-role", label: "Customer role" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" } satisfies Partial<SystemAccessAdministrationError>);
    expect(store.writes).toEqual([]);
  });

  it("maps store errors at read, mutation, and template boundaries without swallowing unknown errors", async () => {
    const read = service();
    vi.spyOn(read.store, "transaction").mockRejectedValueOnce(new AuthorizationStoreError("REVISION_CONFLICT", "CAS rejected."));
    await expect(read.service.roles({ context: {} })).rejects.toMatchObject({ code: "REVISION_CONFLICT" } satisfies Partial<SystemAccessAdministrationError>);

    const mutation = service();
    vi.spyOn(mutation.store, "transaction").mockRejectedValueOnce(new AuthorizationStoreError("MUTATION_INVALID", "Mutation rejected."));
    await expect(mutation.service.createRole({ context: {}, expected, role: { id: "customer-role", label: "Customer role" } })).rejects.toMatchObject({ code: "MUTATION_INVALID" } satisfies Partial<SystemAccessAdministrationError>);

    const template = service(undefined, "allow", undefined, catalogWithTemplate());
    vi.spyOn(template.store, "transaction").mockRejectedValueOnce(new AuthorizationStoreError("SUBJECT_INVALID", "Subject rejected."));
    await expect(template.service.instantiateTemplate({ context: {}, expected, templateId: "sales.manager", role: { id: "customer-sales", label: "Customer sales" } })).rejects.toMatchObject({ code: "MUTATION_INVALID" } satisfies Partial<SystemAccessAdministrationError>);

    const unavailable = new Error("database unavailable");
    vi.spyOn(template.store, "transaction").mockRejectedValueOnce(unavailable);
    await expect(template.service.copyTemplatePermissions({ context: {}, expected, templateId: "sales.manager", roleId: "customer-sales", permissionIds: ["sales.records.read"] })).rejects.toBe(unavailable);
  });

  it("hides an unassigned inactive-only role but keeps an assigned inactive role and its diagnostics visible", async () => {
    const { store, service: access } = service();
    const inactiveRole = role("sales-disabled");
    store.roles.set(inactiveRole.id, inactiveRole);
    store.grants.set("sales-disabled-read", { schemaVersion: 1, id: "sales-disabled-read", applicationId: expected.applicationId, roleId: inactiveRole.id, permissionId: "sales.read", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "sales", generation: 2 }, revision: expected.authorizationRevision });
    store.snapshots.set("sales-disabled", {
      schemaVersion: 1, id: "sales-disabled", applicationId: expected.applicationId, source: "administrative-non-authoritative",
      permission: { schemaVersion: 1, id: "sales.read", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "sales" }, title: "Sales read", description: "Disabled", audience: "authenticated", resource: "sales.records", operation: "read", scope: "application" },
      state: "inactive-extension-disabled", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "sales", generation: 2 }, revision: expected.authorizationRevision
    });
    expect((await access.roles({ context: {} })).roles).toEqual([]);
    expect((await access.roles({ context: {}, includeInactive: true })).hiddenInactiveRoleIds).toEqual([inactiveRole.id]);
    store.assignments.set("sales-disabled-assignment", { schemaVersion: 1, id: "sales-disabled-assignment", applicationId: expected.applicationId, roleId: inactiveRole.id, principal: { kind: "user", id: "inactive-sales-user" }, state: "revoked", revision: expected.authorizationRevision });
    await expect(access.roles({ context: {} })).resolves.toMatchObject({ roles: [expect.objectContaining({ id: inactiveRole.id })], hiddenInactiveRoleIds: [] });
    await expect(access.roleDetail({ context: {}, roleId: inactiveRole.id })).resolves.toMatchObject({
      grants: [expect.objectContaining({ state: "inactive", inactiveReason: "inactive-extension-disabled" })],
      assignments: [expect.objectContaining({ id: "sales-disabled-assignment", state: "revoked" })]
    });
  });

  it("instantiates and copies only the current catalog template while recording each mutation audit", async () => {
    const templates = catalogWithTemplate();
    const { store, service: access } = service(undefined, "allow", undefined, templates);
    await expect(access.instantiateTemplate({ context: {}, expected, templateId: "sales.manager", role: { id: "customer-sales", label: "Customer sales" } })).resolves.toMatchObject({ value: expect.objectContaining({ roleId: "customer-sales" }) });
    expect(store.writes.slice(-5).map((mutation) => mutation.kind)).toEqual(["role", "grant", "grant", "template-adoption", "audit"]);
    store.roles.set("mixed-sales", { ...role("mixed-sales"), revision: store.state.authorizationRevision });
    await expect(access.copyTemplatePermissions({ context: {}, expected: currentExpected(store.state), templateId: "sales.manager", roleId: "mixed-sales", permissionIds: ["sales.records.read"] })).resolves.toMatchObject({ value: expect.objectContaining({ roleId: "mixed-sales", kind: "copied-permissions" }) });
    expect(store.writes.slice(-3).map((mutation) => mutation.kind)).toEqual(["grant", "template-adoption", "audit"]);
    await expect(access.instantiateTemplate({ context: {}, expected: currentExpected(store.state), templateId: "sales.manager", role: { id: "forged-template", label: "Forged", owner: { kind: "platform" } } as never })).rejects.toMatchObject({ code: "MUTATION_INVALID" } satisfies Partial<SystemAccessAdministrationError>);
  });
});
