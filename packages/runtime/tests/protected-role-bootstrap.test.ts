import { describe, expect, it } from "vitest";

import type {
  AuthorizationState,
  BootstrapReceipt,
  Role,
  RoleAssignment,
  RolePermissionGrant
} from "@k-nex/contracts";

import {
  AuthorizationStoreError,
  parseAuthorizationStoreMutation,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreMutation,
  type AuthorizationStoreTransaction
} from "../src/authorization-store.js";
import { assertFirstOwnerBootstrapMutations, bootstrapFirstOwner } from "../src/protected-role-bootstrap.js";
import { protectedPlatformRoleBaselines } from "../src/protected-role-baselines.js";

const expected: AuthorizationExpectedRevision = Object.freeze({
  applicationId: "customer-alpha", environment: "production", authorizationRevision: 0, lifecycleRevision: 0
});

class MemoryStore implements AuthorizationStore {
  readonly roles: Role[];
  readonly grants: RolePermissionGrant[];
  readonly assignments: RoleAssignment[];
  readonly committedWrites: AuthorizationStoreMutation[] = [];
  receipt: BootstrapReceipt | undefined;
  transactionCalls = 0;
  bootstrapTransactionCalls = 0;
  state: AuthorizationState;

  constructor(seed: Partial<Pick<MemoryStore, "roles" | "grants" | "assignments" | "receipt">> = {}) {
    this.roles = [...(seed.roles ?? [])];
    this.grants = [...(seed.grants ?? [])];
    this.assignments = [...(seed.assignments ?? [])];
    this.receipt = seed.receipt;
    this.state = { schemaVersion: 1, ...expected };
  }

  async readState(): Promise<AuthorizationState> { return this.state; }

  async transaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) {
    this.transactionCalls += 1;
    if (actual.authorizationRevision !== this.state.authorizationRevision || actual.lifecycleRevision !== this.state.lifecycleRevision) {
      throw new AuthorizationStoreError("REVISION_CONFLICT", "Authorization state changed before bootstrap.");
    }
    const staged: AuthorizationStoreMutation[] = [];
    const transaction: AuthorizationStoreTransaction = {
      readRole: async (_applicationId, roleId) => this.roles.find((role) => role.id === roleId),
      listRoles: async () => this.roles,
      listGrants: async (_applicationId, roleId) => roleId === undefined ? this.grants : this.grants.filter((grant) => grant.roleId === roleId),
      listAssignments: async (_applicationId, principal) => principal === undefined ? this.assignments : this.assignments.filter((assignment) => assignment.principal.kind === principal.kind && assignment.principal.id === principal.id),
      listTemplateAdoptions: async () => [],
      listCatalogSnapshots: async () => [],
      listExtensionGenerations: async () => [],
      readBootstrapReceipt: async () => this.receipt,
      listAudits: async () => [],
      write: async (mutation) => { staged.push(await parseAuthorizationStoreMutation(mutation, { validate: () => "accepted" })); }
    };
    const value = await work(transaction);
    for (const mutation of staged) this.apply(mutation);
    this.committedWrites.push(...staged);
    if (staged.length > 0) this.state = { ...this.state, authorizationRevision: this.state.authorizationRevision + 1 };
    return Object.freeze({ committed: true as const, value, state: this.state });
  }

  async bootstrapFirstOwnerTransaction<T>(actual: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>) {
    this.bootstrapTransactionCalls += 1;
    if (this.roles.length !== 0 || this.grants.length !== 0 || this.assignments.length !== 0 || this.receipt !== undefined) {
      throw new AuthorizationStoreError("REVISION_CONFLICT", "First-owner bootstrap is closed because authorization state already exists.");
    }
    if (actual.authorizationRevision !== this.state.authorizationRevision || actual.lifecycleRevision !== this.state.lifecycleRevision) {
      throw new AuthorizationStoreError("REVISION_CONFLICT", "Authorization state changed before bootstrap.");
    }
    const staged: AuthorizationStoreMutation[] = [];
    const transaction: AuthorizationStoreTransaction = {
      readRole: async (_applicationId, roleId) => this.roles.find((role) => role.id === roleId),
      listRoles: async () => this.roles,
      listGrants: async (_applicationId, roleId) => roleId === undefined ? this.grants : this.grants.filter((grant) => grant.roleId === roleId),
      listAssignments: async (_applicationId, principal) => principal === undefined ? this.assignments : this.assignments.filter((assignment) => assignment.principal.kind === principal.kind && assignment.principal.id === principal.id),
      listTemplateAdoptions: async () => [],
      listCatalogSnapshots: async () => [],
      listExtensionGenerations: async () => [],
      readBootstrapReceipt: async () => this.receipt,
      listAudits: async () => [],
      write: async (mutation) => { staged.push(await parseAuthorizationStoreMutation(mutation, { validate: () => "accepted" })); }
    };
    const value = await work(transaction);
    assertFirstOwnerBootstrapMutations(actual, staged);
    for (const mutation of staged) this.apply(mutation);
    this.committedWrites.push(...staged);
    this.state = { ...this.state, authorizationRevision: this.state.authorizationRevision + 1 };
    return Object.freeze({ committed: true as const, value, state: this.state });
  }

  private apply(mutation: AuthorizationStoreMutation): void {
    if (mutation.kind === "role") this.roles.push(mutation.role);
    if (mutation.kind === "grant") this.grants.push(mutation.grant);
    if (mutation.kind === "assignment") this.assignments.push(mutation.assignment);
    if (mutation.kind === "bootstrap-receipt") this.receipt = mutation.receipt;
  }
}

describe("first owner protected-role bootstrap", () => {
  it("commits exactly the baseline roles and grants with one active owner receipt", async () => {
    const store = new MemoryStore();
    const result = await bootstrapFirstOwner({ store, expected, firstOwner: { kind: "user", id: "user-1" } });

    expect(store.bootstrapTransactionCalls).toBe(1);
    expect(result.state).toMatchObject({ authorizationRevision: 1, lifecycleRevision: 0 });
    expect(result.value).toMatchObject({ ownerRoleId: "system.role.owner", ownerPrincipal: { kind: "user", id: "user-1" }, ownerAssignmentId: store.assignments[0]!.id, authorizationRevision: 1, state: "committed" });
    expect(store.roles.map((role) => role.id)).toEqual(protectedPlatformRoleBaselines.map((baseline) => baseline.id));
    expect(store.grants.map(({ roleId, permissionId }) => ({ roleId, permissionId }))).toEqual(protectedPlatformRoleBaselines.flatMap((baseline) => baseline.permissionIds.map((permissionId) => ({ roleId: baseline.id, permissionId }))));
    expect(store.assignments).toEqual([expect.objectContaining({ roleId: "system.role.owner", principal: { kind: "user", id: "user-1" }, state: "active" })]);
    expect(store.receipt).toEqual(result.value);
  });

  it("uses stable scoped assignment, receipt, and grant IDs", async () => {
    const first = new MemoryStore();
    const second = new MemoryStore();
    await bootstrapFirstOwner({ store: first, expected, firstOwner: { kind: "user", id: "user-1" } });
    await bootstrapFirstOwner({ store: second, expected, firstOwner: { kind: "user", id: "user-1" } });

    expect(second.committedWrites.map((mutation) => mutation.kind === "grant" ? mutation.grant.id : mutation.kind === "assignment" ? mutation.assignment.id : mutation.kind === "bootstrap-receipt" ? mutation.receipt.id : undefined)).toEqual(
      first.committedWrites.map((mutation) => mutation.kind === "grant" ? mutation.grant.id : mutation.kind === "assignment" ? mutation.assignment.id : mutation.kind === "bootstrap-receipt" ? mutation.receipt.id : undefined)
    );
  });

  it("fails closed before any write for invalid, non-first-run, partial, and replayed bootstrap", async () => {
    const serviceStore = new MemoryStore();
    await expect(bootstrapFirstOwner({ store: serviceStore, expected, firstOwner: { kind: "service", id: "service-1" } })).rejects.toMatchObject({ code: "SUBJECT_INVALID" });
    expect(serviceStore.transactionCalls).toBe(0);

    const staleStore = new MemoryStore();
    await expect(bootstrapFirstOwner({ store: staleStore, expected: { ...expected, authorizationRevision: 1 }, firstOwner: { kind: "user", id: "user-1" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(staleStore.transactionCalls).toBe(0);

    const partialStore = new MemoryStore({ roles: [{ schemaVersion: 1, id: "system.role.owner", applicationId: expected.applicationId, label: "Owner", protectedRoleId: "system.role.owner", revision: 1 }] });
    await expect(bootstrapFirstOwner({ store: partialStore, expected, firstOwner: { kind: "user", id: "user-1" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(partialStore.committedWrites).toEqual([]);

    const replayStore = new MemoryStore();
    await bootstrapFirstOwner({ store: replayStore, expected, firstOwner: { kind: "user", id: "user-1" } });
    await expect(bootstrapFirstOwner({ store: replayStore, expected, firstOwner: { kind: "user", id: "user-1" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(replayStore.committedWrites).toHaveLength(2 + protectedPlatformRoleBaselines.length + protectedPlatformRoleBaselines.reduce((count, baseline) => count + baseline.permissionIds.length, 0));
  });
});
