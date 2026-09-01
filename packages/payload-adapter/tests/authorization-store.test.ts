import { describe, expect, it, vi } from "vitest";

import { PostgresAuthorizationStore } from "../src/authorization-store.js";
import type { RuntimeExtensionPool, RuntimeExtensionSession } from "../src/runtime-extension-store.js";

const expected = { applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 2 } as const;
const role = { schemaVersion: 1, id: "sales.manager", applicationId: expected.applicationId, label: "Sales Manager", revision: 1 } as const;
const descriptor = {
  schemaVersion: 1, id: "system.roles.manage", publisher: { kind: "platform", namespace: "system" }, title: "Manage roles",
  description: "Manage customer roles.", audience: "authenticated", resource: "system.roles", operation: "manage", scope: "application"
} as const;

function harness(options: Readonly<{ state?: Partial<typeof expected>; activeOwner?: boolean; otherOwners?: number; roleRow?: Record<string, unknown>; bootstrapAssignment?: Record<string, unknown> }> = {}) {
  const current = { ...expected, ...options.state };
  const queries: string[] = [];
  const query = vi.fn(async <T extends object>(text: string, values: readonly unknown[] = []) => {
    queries.push(text);
    if (text.startsWith("select application_id, authorization_revision")) return { rows: [{ application_id: current.applicationId, authorization_revision: current.authorizationRevision, lifecycle_revision: current.lifecycleRevision }] as T[] };
    if (text.startsWith("select application_id, role_id")) return { rows: options.roleRow ? [options.roleRow] as T[] : [] as T[] };
    if (text.startsWith("update k_nex_authorization_state")) return { rows: [{ application_id: current.applicationId, authorization_revision: values[1], lifecycle_revision: values[2] }] as T[] };
    if (text.startsWith("select role_id, state from k_nex_role_assignments")) return { rows: options.activeOwner ? [{ role_id: "system.role.owner", state: "active" }] as T[] : [] as T[] };
    if (text.startsWith("select role_id, subject_kind, subject_id, state")) return { rows: options.bootstrapAssignment ? [options.bootstrapAssignment] as T[] : [] as T[] };
    if (text.startsWith("select count(*)::int")) return { rows: [{ count: options.otherOwners ?? 0 }] as T[] };
    return { rows: [] as T[] };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return { query, queries, store: new PostgresAuthorizationStore(pool) };
}

describe("PostgresAuthorizationStore", () => {
  it("projects one application-global state into each environment context", async () => {
    const value = harness();

    const [production, staging] = await Promise.all([
      value.store.readState(expected.applicationId, "production"),
      value.store.readState(expected.applicationId, "staging")
    ]);

    expect(production).toMatchObject({ environment: "production", authorizationRevision: 4, lifecycleRevision: 2 });
    expect(staging).toMatchObject({ environment: "staging", authorizationRevision: 4, lifecycleRevision: 2 });
    expect(value.query.mock.calls.filter(([query]) => String(query).includes("k_nex_authorization_state"))).toEqual([
      [expect.not.stringContaining("environment"), [expected.applicationId]],
      [expect.not.stringContaining("environment"), [expected.applicationId]]
    ]);
  });

  it("initializes 0/0 state, locks it, writes one mutation, advances once, then commits", async () => {
    const value = harness({ state: { authorizationRevision: 0, lifecycleRevision: 0 } });

    const result = await value.store.transaction({ ...expected, authorizationRevision: 0, lifecycleRevision: 0 }, async (transaction) => {
      await transaction.write({ kind: "role", role });
      return "ok";
    });

    expect(result).toMatchObject({ committed: true, value: "ok", state: { authorizationRevision: 1, lifecycleRevision: 0 } });
    expect(value.queries.slice(0, 5)).toEqual([
      "begin", expect.stringContaining("pg_advisory_xact_lock"), expect.stringContaining("insert into k_nex_authorization_state"),
      expect.stringContaining("from k_nex_authorization_state"), expect.stringContaining("insert into k_nex_roles")
    ]);
    expect(value.queries.at(-1)).toBe("commit");
    const lockKey = value.query.mock.calls[1]?.[1]?.[0];
    expect(typeof lockKey).toBe("string");
    expect(JSON.parse(lockKey as string)).toEqual([expected.applicationId, "authorization-state"]);
  });

  it("rolls back exact revision conflict before callback", async () => {
    const value = harness({ state: { authorizationRevision: 5 } });
    const work = vi.fn(async () => undefined);

    await expect(value.store.transaction(expected, work)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(work).not.toHaveBeenCalled();
    expect(value.queries.at(-1)).toBe("rollback");
  });

  it("fails closed and rolls back rejected service assignments", async () => {
    const value = harness();
    const store = new PostgresAuthorizationStore({ connect: vi.fn(async () => ({ query: value.query, release: vi.fn() })), query: value.query }, { validate: () => "rejected" });
    const assignment = { schemaVersion: 1, id: "assignment-1", applicationId: expected.applicationId, roleId: role.id, principal: { kind: "service", id: "service:sync" }, state: "active", revision: 1 } as const;

    await expect(store.transaction(expected, async (transaction) => transaction.write({ kind: "assignment", assignment }))).rejects.toMatchObject({ code: "SUBJECT_INVALID" });
    expect(value.queries.some((query) => query.includes("insert into k_nex_role_assignments"))).toBe(false);
    expect(value.queries.at(-1)).toBe("rollback");
  });

  it("keeps audit-only writes revision-neutral and advances each revision once for mixed writes", async () => {
    const audit = {
      schemaVersion: 1, auditId: "audit-1", decisionId: "decision-1", correlationId: "correlation-1", applicationId: expected.applicationId,
      environment: expected.environment, permissionId: descriptor.id, owner: descriptor.publisher, principal: { kind: "user", id: "user-1" },
      effectiveActor: { kind: "user", id: "user-1" }, scope: { kind: "application", resource: "system.roles" }, authorizationRevision: 4,
      lifecycleRevision: 2, outcome: "allow", reason: "granted", approval: "satisfied", reauthentication: "satisfied"
    } as const;
    const auditOnly = harness();
    await auditOnly.store.transaction(expected, async (transaction) => transaction.write({ kind: "audit", audit }));
    expect(auditOnly.queries.some((query) => query.startsWith("update k_nex_authorization_state"))).toBe(false);

    const mixed = harness();
    const snapshot = { schemaVersion: 1, id: "snapshot-1", applicationId: expected.applicationId, source: "administrative-non-authoritative", permission: descriptor, state: "deprecated", owner: descriptor.publisher, revision: 1 } as const;
    const result = await mixed.store.transaction(expected, async (transaction) => {
      await transaction.write({ kind: "role", role });
      await transaction.write({ kind: "catalog-snapshot", snapshot });
    });
    expect(result.state).toMatchObject({ authorizationRevision: 5, lifecycleRevision: 3 });
    expect(mixed.queries.filter((query) => query.startsWith("update k_nex_authorization_state"))).toHaveLength(1);
  });

  it("rejects concurrent last-owner revocation under the application transaction lock", async () => {
    const value = harness({ activeOwner: true, otherOwners: 0 });
    const ownerAssignment = { schemaVersion: 1, id: "owner-assignment-1", applicationId: expected.applicationId, roleId: "system.role.owner", principal: { kind: "user", id: "user-1" }, state: "revoked", revision: 2 } as const;
    const store = new PostgresAuthorizationStore({ connect: vi.fn(async () => ({ query: value.query, release: vi.fn() })), query: value.query }, { validate: () => "accepted" });

    await expect(store.transaction(expected, async (transaction) => transaction.write({ kind: "assignment", assignment: ownerAssignment }))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.queries.some((query) => query.startsWith("select count(*)::int"))).toBe(true);
    expect(value.queries.some((query) => query.includes("insert into k_nex_role_assignments"))).toBe(false);
  });

  it("rejects a receipt that does not bind an exact active owner assignment", async () => {
    const value = harness({ bootstrapAssignment: { role_id: "system.role.owner", subject_kind: "user", subject_id: "user-1", state: "revoked" } });
    const receipt = { schemaVersion: 1, id: "receipt-1", applicationId: expected.applicationId, ownerRoleId: "system.role.owner", ownerAssignmentId: "owner-assignment-1", ownerPrincipal: { kind: "user", id: "user-1" }, authorizationRevision: 5, state: "committed" } as const;

    await expect(value.store.transaction(expected, async (transaction) => transaction.write({ kind: "bootstrap-receipt", receipt }))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.queries.some((query) => query.includes("insert into k_nex_authorization_bootstrap_receipts"))).toBe(false);
    expect(value.queries.at(-1)).toBe("rollback");
  });

  it("fails closed instead of treating an empty persisted description as absent", async () => {
    const value = harness({ roleRow: { application_id: expected.applicationId, role_id: role.id, label: role.label, description: "", protected_role_id: null, revision: 1 } });

    await expect(value.store.transaction(expected, async (transaction) => transaction.readRole(expected.applicationId, role.id))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(value.queries.at(-1)).toBe("rollback");
  });
});
