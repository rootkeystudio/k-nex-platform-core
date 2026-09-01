import { describe, expect, it } from "vitest";

import type {
  AuthorizationOwnerRef,
  AuthorizationState,
  ExtensionAuthorizationOwnerRef,
  ExtensionPermissionPublisherRef,
  Role,
  RolePermissionGrant,
  TemplateAdoption
} from "@k-nex/contracts";
import type { InstalledPlatformPluginManifest, ResolvedPlatformPluginGraph } from "@k-nex/composition";
import type { PluginManifest } from "@k-nex/contracts";

import { createEffectiveAuthorizationCatalog, createPlatformPluginRegistrationAuthorizationContribution, type EffectiveRoleTemplate } from "../src/authorization-registry.js";
import {
  AuthorizationStoreError,
  parseAuthorizationStoreMutation,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreMutation,
  type AuthorizationStoreTransaction
} from "../src/authorization-store.js";
import {
  compareInstantiatedRoleTemplate,
  copyTemplatePermissionsToRole,
  instantiateRoleTemplate,
  reconcileAutomaticRoleTemplates,
  tombstoneAutomaticRoleTemplate
} from "../src/role-template-bootstrap.js";
import { digestTemplateBaseline } from "../src/protected-role-baselines.js";
import { definePluginRegistration, executeRegistration } from "../src/registration-runtime.js";
import { scopePlatformPluginRegistration } from "../src/plugin-lifecycle.js";

const expected: AuthorizationExpectedRevision = Object.freeze({
  applicationId: "customer-alpha", environment: "production", authorizationRevision: 0, lifecycleRevision: 0
});
const owner = Object.freeze({ kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 });
const publisher = Object.freeze({ kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales" });
const collidingPublisher = Object.freeze({ kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "provider.sales" });
const collidingOwner = Object.freeze({ ...collidingPublisher, generation: 1 });

interface TemplateIdentity {
  readonly publisher: ExtensionPermissionPublisherRef;
  readonly owner: ExtensionAuthorizationOwnerRef;
  readonly kind: PluginManifest["kind"];
}

const salesIdentity: TemplateIdentity = Object.freeze({ publisher, owner, kind: "module" });
const collidingIdentity: TemplateIdentity = Object.freeze({ publisher: collidingPublisher, owner: collidingOwner, kind: "provider" });

function effectiveTemplate(applicationId = expected.applicationId, version = 1, instantiation: "automatic" | "manual" = "manual", permissionIds = ["sales.opportunity.read", "sales.opportunity.write"], identity: TemplateIdentity = salesIdentity): EffectiveRoleTemplate {
  const descriptors = permissionIds.map((id) => ({ schemaVersion: 1, id, publisher: identity.publisher, title: id, description: "Sales permission", audience: "authenticated", resource: "sales.opportunity", operation: "read", scope: "application" }));
  const roleTemplate = { schemaVersion: 1, id: "sales.manager", publisher: identity.publisher, version, instantiation, title: "Sales manager", permissionIds } as const;
  const declared = (values: readonly { readonly id: string }[]) => Object.fromEntries(values.map(({ id }) => [id, "required"]));
  const manifest = {
    apiVersion: 1, id: identity.publisher.extensionId, kind: identity.kind, displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: { permissions: declared(descriptors), policyBindings: {}, roleTemplates: declared([roleTemplate]) }
  } as PluginManifest;
  const graph: ResolvedPlatformPluginGraph = {
    resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-sales", required: [], optional: [] }],
    capabilityProviders: [], registrationOrder: [manifest.id]
  };
  const installed: readonly InstalledPlatformPluginManifest[] = [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales" }, manifest }];
  const registration = definePluginRegistration({
    pluginId: manifest.id,
    contracts(context) {
      for (const value of descriptors) context.register("permissions", value.id, value);
      context.register("roleTemplates", roleTemplate.id, roleTemplate);
    }
  });
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration: scopePlatformPluginRegistration(executeRegistration({ graph, installed, registrations: [registration] }), []),
    generation: { schemaVersion: 1, applicationId, owner: identity.owner, runtimeGenerationIds: ["sales-generation-1"], state: "current", authorizationRevision: 1, lifecycleRevision: 1 }
  });
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision: 1, extensions: [contribution], executables: [] }).roleTemplates[0]!;
}

class MemoryStore implements AuthorizationStore {
  readonly roles = new Map<string, Role>();
  readonly grants = new Map<string, RolePermissionGrant>();
  readonly adoptions = new Map<string, TemplateAdoption>();
  readonly committedWrites: AuthorizationStoreMutation[] = [];
  state: AuthorizationState = { schemaVersion: 1, ...expected };

  constructor(seed: Readonly<{ readonly roles?: readonly Role[]; readonly grants?: readonly RolePermissionGrant[]; readonly adoptions?: readonly TemplateAdoption[] }> = {}) {
    for (const role of seed.roles ?? []) this.roles.set(role.id, role);
    for (const grant of seed.grants ?? []) this.grants.set(grantKey(grant), grant);
    for (const adoption of seed.adoptions ?? []) this.adoptions.set(adoption.id, adoption);
  }

  async readState(): Promise<AuthorizationState> { return this.state; }

  async transaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) {
    if (actual.applicationId !== this.state.applicationId || actual.environment !== this.state.environment || actual.authorizationRevision !== this.state.authorizationRevision || actual.lifecycleRevision !== this.state.lifecycleRevision) {
      throw new AuthorizationStoreError("REVISION_CONFLICT", "Authorization state changed.");
    }
    const staged: AuthorizationStoreMutation[] = [];
    const transaction: AuthorizationStoreTransaction = {
      readRole: async (_applicationId, roleId) => this.roles.get(roleId),
      listRoles: async () => [...this.roles.values()],
      listGrants: async (_applicationId, roleId) => [...this.grants.values()].filter((grant) => roleId === undefined || grant.roleId === roleId),
      listAssignments: async () => [],
      listTemplateAdoptions: async (_applicationId, roleId) => [...this.adoptions.values()].filter((adoption) => roleId === undefined || adoption.roleId === roleId),
      listCatalogSnapshots: async () => [],
      listExtensionGenerations: async () => [],
      readBootstrapReceipt: async () => undefined,
      listAudits: async () => [],
      write: async (mutation) => { staged.push(await parseAuthorizationStoreMutation(mutation)); }
    };
    const value = await work(transaction);
    for (const mutation of staged) this.apply(mutation);
    this.committedWrites.push(...staged);
    if (staged.length > 0) this.state = { ...this.state, authorizationRevision: this.state.authorizationRevision + 1 };
    return Object.freeze({ committed: true as const, value, state: this.state });
  }

  private apply(mutation: AuthorizationStoreMutation): void {
    if (mutation.kind === "role") this.roles.set(mutation.role.id, mutation.role);
    if (mutation.kind === "grant") this.grants.set(grantKey(mutation.grant), mutation.grant);
    if (mutation.kind === "template-adoption") this.adoptions.set(mutation.adoption.id, mutation.adoption);
  }
}

describe("role template bootstrap", () => {
  it("instantiates an explicitly selected template as a new customer role with exact-owner grants and no assignment", async () => {
    const store = new MemoryStore();
    const result = await instantiateRoleTemplate({ store, expected, effectiveTemplate: effectiveTemplate(), role: { id: "sales.customer-manager", label: "Customer sales manager" } });

    expect(result.state.authorizationRevision).toBe(1);
    expect(result.value).toMatchObject({ roleId: "sales.customer-manager", kind: "instantiated-role", oldBaselinePermissionIds: ["sales.opportunity.read", "sales.opportunity.write"], owner });
    expect(result.value).toMatchObject({ oldBaselineDigest: digestTemplateBaseline(["sales.opportunity.read", "sales.opportunity.write"]), revision: 1 });
    expect([...store.grants.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "sales.customer-manager", permissionId: "sales.opportunity.read", owner }),
      expect.objectContaining({ roleId: "sales.customer-manager", permissionId: "sales.opportunity.write", owner })
    ]));
    expect(store.committedWrites.some((mutation) => mutation.kind === "assignment")).toBe(false);
  });

  it("accepts only an exact template entry from the current customer catalog", async () => {
    const authentic = effectiveTemplate();
    const forged = { template: { ...authentic.template }, owner: { ...authentic.owner } } as EffectiveRoleTemplate;
    const crossApplication = effectiveTemplate("customer-beta");
    const store = new MemoryStore();

    await expect(instantiateRoleTemplate({ store, expected, effectiveTemplate: forged, role: { id: "sales.forged", label: "Forged" } })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    await expect(instantiateRoleTemplate({ store, expected, effectiveTemplate: crossApplication, role: { id: "sales.cross-application", label: "Cross application" } })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(store.committedWrites).toEqual([]);
  });

  it("keeps independent automatic tombstones across versions and generations without creating a role or grants", async () => {
    const store = new MemoryStore();
    const automatic = effectiveTemplate(expected.applicationId, 1, "automatic");
    const tombstoned = await tombstoneAutomaticRoleTemplate({ store, expected, effectiveTemplate: automatic });
    expect(tombstoned.value).toMatchObject({ kind: "instantiated-role", state: "tombstoned", oldBaselinePermissionIds: automatic.template.permissionIds, oldBaselineDigest: digestTemplateBaseline(automatic.template.permissionIds) });
    expect(tombstoned.value.roleId).toBeUndefined();
    expect([...store.roles.values()]).toEqual([]);
    expect([...store.grants.values()]).toEqual([]);
    const replay = await tombstoneAutomaticRoleTemplate({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplate: automatic });
    expect(replay.value).toEqual(tombstoned.value);
    expect(replay.state).toEqual(tombstoned.state);
    const newerTemplate = effectiveTemplate(expected.applicationId, 2, "automatic");
    const newerGeneration = effectiveTemplate(expected.applicationId, 3, "automatic", undefined, { ...salesIdentity, owner: { ...owner, generation: 2 } });
    const versionReplay = await reconcileAutomaticRoleTemplates({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplates: [newerTemplate] });
    expect(versionReplay.value).toEqual([]);
    expect((await reconcileAutomaticRoleTemplates({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplates: [newerGeneration] })).value).toEqual([]);
    expect([...store.roles.values()]).toEqual([]);
    expect([...store.grants.values()]).toEqual([]);
    expect(store.committedWrites.some((mutation) => mutation.kind === "assignment")).toBe(false);
  });

  it("suppresses automatic templates after a one-time copy but not for a colliding publisher/template identity", async () => {
    const role = customerRole("sales.mixed-auto", "Mixed automatic role");
    const store = new MemoryStore({ roles: [role] });
    const automatic = effectiveTemplate(expected.applicationId, 1, "automatic");
    await copyTemplatePermissionsToRole({ store, expected, effectiveTemplate: automatic, roleId: role.id, permissionIds: ["sales.opportunity.read"] });

    const suppressed = await reconcileAutomaticRoleTemplates({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplates: [automatic] });
    expect(suppressed.value).toEqual([]);
    expect([...store.roles.values()]).toEqual([role]);
    const otherPublisher = effectiveTemplate(expected.applicationId, 1, "automatic", undefined, collidingIdentity);
    const unrelated = await reconcileAutomaticRoleTemplates({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplates: [automatic, otherPublisher] });
    expect(unrelated.value).toHaveLength(1);
    expect(unrelated.value[0]).toMatchObject({ publisher: collidingPublisher, templateId: "sales.manager" });
  });

  it("rejects a tombstone request after an automatic role was already instantiated", async () => {
    const store = new MemoryStore();
    const automatic = effectiveTemplate(expected.applicationId, 1, "automatic");
    await reconcileAutomaticRoleTemplates({ store, expected, effectiveTemplates: [automatic] });

    await expect(tombstoneAutomaticRoleTemplate({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplate: automatic })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(tombstoneAutomaticRoleTemplate({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplate: effectiveTemplate() })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
  });

  it("copies a selected subset once into a mixed role without changing unrelated grants or a later template version", async () => {
    const role = customerRole("sales.mixed-manager", "Mixed manager");
    const unrelated = grant(role.id, "system.roles.read", { kind: "platform", namespace: "system" });
    const store = new MemoryStore({ roles: [role], grants: [unrelated] });
    await copyTemplatePermissionsToRole({ store, expected, effectiveTemplate: effectiveTemplate(), roleId: role.id, permissionIds: ["sales.opportunity.read"] });
    const grantsAfterCopy = [...store.grants.values()];

    await expect(copyTemplatePermissionsToRole({ store, expected: { ...expected, authorizationRevision: 1 }, effectiveTemplate: effectiveTemplate(expected.applicationId, 2, "manual", ["sales.opportunity.delete", "sales.opportunity.read"]), roleId: role.id, permissionIds: ["sales.opportunity.delete"] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect([...store.grants.values()]).toEqual(grantsAfterCopy);
    expect([...store.grants.values()]).toEqual(expect.arrayContaining([unrelated, expect.objectContaining({ permissionId: "sales.opportunity.read", owner })]));
  });

  it("compares a customer-edited role read-only and fails closed on a bad stored digest", async () => {
    const role = customerRole("sales.edited-manager", "Edited manager");
    const adoption = adopted(role.id, ["sales.opportunity.read"]);
    const store = new MemoryStore({ roles: [role], adoptions: [adoption], grants: [
      grant(role.id, "sales.opportunity.read", owner),
      grant(role.id, "sales.opportunity.write", owner),
      grant(role.id, "system.roles.read", { kind: "platform", namespace: "system" })
    ] });
    const comparison = await compareInstantiatedRoleTemplate({ store, expected, effectiveTemplate: effectiveTemplate(expected.applicationId, 2, "manual", ["sales.opportunity.delete", "sales.opportunity.read"]), roleId: role.id });
    expect(comparison.value).toMatchObject({ customerAddedPermissionIds: ["sales.opportunity.write"], templateAddedPermissionIds: ["sales.opportunity.delete"] });
    expect(store.committedWrites).toEqual([]);

    store.adoptions.set(adoption.id, { ...adoption, oldBaselineDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" });
    await expect(compareInstantiatedRoleTemplate({ store, expected, effectiveTemplate: effectiveTemplate(expected.applicationId, 2, "manual", ["sales.opportunity.delete", "sales.opportunity.read"]), roleId: role.id })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    expect(store.committedWrites).toEqual([]);
  });

  it("rejects protected targets and invalid template subsets without writes", async () => {
    const store = new MemoryStore({ roles: [customerRole("system.role.owner", "Owner", "system.role.owner")] });
    await expect(instantiateRoleTemplate({ store, expected, effectiveTemplate: effectiveTemplate(), role: { id: "system.role.owner", label: "Owner" } })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    await expect(copyTemplatePermissionsToRole({ store, expected, effectiveTemplate: effectiveTemplate(), roleId: "system.role.owner", permissionIds: ["sales.opportunity.delete"] })).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(store.committedWrites).toEqual([]);
  });
});

function customerRole(id: string, label: string, protectedRoleId?: Role["protectedRoleId"]): Role {
  return { schemaVersion: 1, id, applicationId: expected.applicationId, label, ...(protectedRoleId === undefined ? {} : { protectedRoleId }), revision: 1 };
}

function grant(roleId: string, permissionId: string, grantOwner: AuthorizationOwnerRef): RolePermissionGrant {
  return { schemaVersion: 1, id: `${roleId}.${permissionId}`, applicationId: expected.applicationId, roleId, permissionId, owner: grantOwner, revision: 1 };
}

function adopted(roleId: string, oldBaselinePermissionIds: string[]): TemplateAdoption {
  return {
    schemaVersion: 1,
    id: `${roleId}.adoption`,
    applicationId: expected.applicationId,
    roleId,
    templateId: "sales.manager",
    publisher,
    owner,
    templateVersion: 1,
    oldBaselinePermissionIds,
    digestAlgorithm: "sha256-canonical-json-v1",
    oldBaselineDigest: digestTemplateBaseline(oldBaselinePermissionIds),
    kind: "instantiated-role",
    state: "adopted",
    revision: 1
  };
}

function grantKey(grant: RolePermissionGrant): string { return `${grant.roleId}/${grant.permissionId}`; }
