import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecisionAudit } from "@k-nex/contracts";
import { PostgresAuthorizationStore } from "../src/authorization-store.js";
import type { RuntimeExtensionPool, RuntimeExtensionSession } from "../src/runtime-extension-store.js";
import { bootstrapFirstOwner, protectedPlatformRoleBaselines } from "@k-nex/runtime";

const expected = { applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 2 } as const;
const role = { schemaVersion: 1, id: "sales.manager", applicationId: expected.applicationId, label: "Sales Manager", revision: 1 } as const;
const descriptor = {
  schemaVersion: 1, id: "system.roles.manage", publisher: { kind: "platform", namespace: "system" }, title: "Manage roles",
  description: "Manage customer roles.", audience: "authenticated", resource: "system.roles", operation: "manage", scope: "application"
} as const;

function harness(options: Readonly<{ state?: Partial<typeof expected>; activeOwner?: boolean; otherOwners?: number; roleRow?: Record<string, unknown>; adoptionRow?: Record<string, unknown>; auditRows?: readonly Record<string, unknown>[]; bootstrapAssignment?: Record<string, unknown>; protectedGrantRoleId?: string; outboxFailure?: boolean }> = {}) {
  const current = { ...expected, ...options.state };
  const queries: string[] = [];
  let writtenOwnerAssignment: Record<string, unknown> | undefined;
  const query = vi.fn(async <T extends object>(text: string, values: readonly unknown[] = []) => {
    queries.push(text);
    if (text.startsWith("select application_id, authorization_revision")) return { rows: [{ application_id: current.applicationId, authorization_revision: current.authorizationRevision, lifecycle_revision: current.lifecycleRevision }] as T[] };
    if (text.startsWith("select application_id, role_id")) return { rows: options.roleRow ? [options.roleRow] as T[] : [] as T[] };
    if (text.startsWith("select application_id, adoption_id")) return { rows: options.adoptionRow ? [options.adoptionRow] as T[] : [] as T[] };
    if (text.startsWith("select audit_id, application_id")) return { rows: options.auditRows ? [...options.auditRows] as T[] : [] as T[] };
    if (text.startsWith("update k_nex_authorization_state")) {
      current.authorizationRevision = values[1] as number;
      current.lifecycleRevision = values[2] as number;
      return { rows: [{ application_id: current.applicationId, authorization_revision: current.authorizationRevision, lifecycle_revision: current.lifecycleRevision }] as T[] };
    }
    if (text.startsWith("insert into k_nex_authorization_outbox") && options.outboxFailure) throw new Error("outbox unavailable");
    if (text.startsWith("insert into k_nex_role_assignments")) {
      writtenOwnerAssignment = { role_id: values[2], subject_kind: values[3], subject_id: values[4], state: values[5] };
      return { rows: [] as T[] };
    }
    if (text.startsWith("select role_id, state from k_nex_role_assignments")) return { rows: options.activeOwner ? [{ role_id: "system.role.owner", state: "active" }] as T[] : [] as T[] };
    if (text.startsWith("select role_id from k_nex_role_permission_grants")) return { rows: options.protectedGrantRoleId === undefined ? [] as T[] : [{ role_id: options.protectedGrantRoleId }] as T[] };
    if (text.startsWith("select role_id, subject_kind, subject_id, state")) return { rows: options.bootstrapAssignment ? [options.bootstrapAssignment] as T[] : writtenOwnerAssignment === undefined ? [] as T[] : [writtenOwnerAssignment] as T[] };
    if (text.startsWith("select count(*)::int")) return { rows: [{ count: options.otherOwners ?? 0 }] as T[] };
    return { rows: [] as T[] };
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  return { current, query, queries, store: new PostgresAuthorizationStore(pool) };
}

function audit(auditId: string): AuthorizationDecisionAudit {
  return {
    schemaVersion: 1, auditId, decisionId: `decision-${auditId}`, correlationId: `correlation-${auditId}`,
    applicationId: expected.applicationId, environment: expected.environment, permissionId: descriptor.id,
    owner: descriptor.publisher, principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" },
    scope: { kind: "application", resource: "system.roles" }, authorizationRevision: expected.authorizationRevision,
    lifecycleRevision: expected.lifecycleRevision, outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required"
  };
}

function auditRow(value: AuthorizationDecisionAudit, createdAt: unknown): Record<string, unknown> {
  return {
    audit_id: value.auditId, application_id: value.applicationId, environment: value.environment, permission_id: value.permissionId,
    outcome: value.outcome, reason: value.reason, authorization_revision: value.authorizationRevision,
    lifecycle_revision: value.lifecycleRevision, audit_json: value, created_at: createdAt
  };
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
    expect(value.queries.at(-2)).toContain("insert into k_nex_authorization_outbox");
    const lockKey = value.query.mock.calls[1]?.[1]?.[0];
    expect(typeof lockKey).toBe("string");
    expect(JSON.parse(lockKey as string)).toEqual([expected.applicationId, "authorization-state"]);
  });

  it("rejects every regular protected role/grant write, including a moved protected grant ID", async () => {
    const protectedRole = { schemaVersion: 1, id: "system.role.owner", applicationId: expected.applicationId, label: "Renamed owner", protectedRoleId: "system.role.owner", revision: 2 } as const;
    const protectedGrant = { schemaVersion: 1, id: "protected-grant", applicationId: expected.applicationId, roleId: "system.role.owner", permissionId: "system.roles.manage", owner: { kind: "platform", namespace: "system" }, revision: 2 } as const;

    const roleValue = harness();
    await expect(roleValue.store.transaction(expected, async (transaction) => transaction.write({ kind: "role", role: protectedRole }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(roleValue.queries.some((query) => query.startsWith("insert into k_nex_roles"))).toBe(false);

    const grantValue = harness();
    await expect(grantValue.store.transaction(expected, async (transaction) => transaction.write({ kind: "grant", grant: protectedGrant }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(grantValue.queries.some((query) => query.startsWith("insert into k_nex_role_permission_grants"))).toBe(false);

    const movedValue = harness({ protectedGrantRoleId: "system.role.owner" });
    const movedGrant = { ...protectedGrant, roleId: role.id, revision: 3 };
    await expect(movedValue.store.transaction(expected, async (transaction) => transaction.write({ kind: "grant", grant: movedGrant }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(movedValue.queries.some((query) => query.startsWith("insert into k_nex_role_permission_grants"))).toBe(false);
    expect(movedValue.queries.at(-1)).toBe("rollback");
  });

  it("rolls back a malformed dedicated bootstrap after its staged writes", async () => {
    const value = harness({ state: { authorizationRevision: 0, lifecycleRevision: 0 } });
    const zero = { ...expected, authorizationRevision: 0, lifecycleRevision: 0 } as const;
    const partialRole = { schemaVersion: 1, id: "system.role.owner", applicationId: expected.applicationId, label: "Owner", protectedRoleId: "system.role.owner", revision: 1 } as const;

    await expect(value.store.bootstrapFirstOwnerTransaction(zero, async (transaction) => transaction.write({ kind: "role", role: partialRole }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(value.queries.some((query) => query.startsWith("insert into k_nex_roles"))).toBe(true);
    expect(value.queries.some((query) => query.startsWith("update k_nex_authorization_state"))).toBe(false);
    expect(value.queries.at(-1)).toBe("rollback");
  });

  it("commits the exact service first-owner bootstrap only through the dedicated path", async () => {
    const value = harness({ state: { authorizationRevision: 0, lifecycleRevision: 0 } });
    const store = new PostgresAuthorizationStore({ connect: vi.fn(async () => ({ query: value.query, release: vi.fn() })), query: value.query }, { validate: () => "accepted" });
    const result = await bootstrapFirstOwner({ store, expected: { ...expected, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: "user-1" } });

    expect(result.state).toMatchObject({ authorizationRevision: 1, lifecycleRevision: 0 });
    expect(value.queries.filter((query) => query.startsWith("insert into k_nex_roles"))).toHaveLength(protectedPlatformRoleBaselines.length);
    expect(value.queries.filter((query) => query.startsWith("insert into k_nex_role_permission_grants"))).toHaveLength(protectedPlatformRoleBaselines.reduce((count, baseline) => count + baseline.permissionIds.length, 0));
    expect(value.queries.some((query) => query.startsWith("insert into k_nex_authorization_bootstrap_receipts"))).toBe(true);
    expect(value.queries.at(-1)).toBe("commit");
  });

  it("leaves the post-receipt revision and protected baseline untouched after a regular mutation attempt", async () => {
    const value = harness({ state: { authorizationRevision: 1, lifecycleRevision: 0 }, protectedGrantRoleId: "system.role.owner" });
    const before = await value.store.readState(expected.applicationId, expected.environment);
    const movedGrant = { schemaVersion: 1, id: "protected-grant", applicationId: expected.applicationId, roleId: role.id, permissionId: "system.roles.manage", owner: { kind: "platform", namespace: "system" }, revision: 2 } as const;

    await expect(value.store.transaction({ ...expected, authorizationRevision: 1, lifecycleRevision: 0 }, async (transaction) => transaction.write({ kind: "grant", grant: movedGrant }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });

    await expect(value.store.readState(expected.applicationId, expected.environment)).resolves.toEqual(before);
    expect(value.current.authorizationRevision).toBe(1);
    expect(value.queries.some((query) => query.startsWith("update k_nex_authorization_state") || query.startsWith("insert into k_nex_role_permission_grants") || query.startsWith("insert into k_nex_authorization_bootstrap_receipts"))).toBe(false);
  });

  it("round-trips an independent template tombstone with a null role ID", async () => {
    const adoption = {
      schemaVersion: 1, id: "adoption-1", applicationId: expected.applicationId, templateId: "sales.manager",
      publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
      owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 },
      templateVersion: 1, oldBaselinePermissionIds: ["sales.opportunity.read"], digestAlgorithm: "sha256-canonical-json-v1", oldBaselineDigest: `sha256:${"0".repeat(64)}`,
      kind: "instantiated-role", state: "tombstoned", revision: 1
    } as const;
    const row = {
      application_id: adoption.applicationId, adoption_id: adoption.id, role_id: null, template_id: adoption.templateId,
      publisher_delivery_class: adoption.publisher.deliveryClass, publisher_extension_id: adoption.publisher.extensionId,
      owner_kind: "extension", owner_namespace: null, owner_delivery_class: adoption.owner.deliveryClass, owner_extension_id: adoption.owner.extensionId, owner_generation: adoption.owner.generation,
      template_version: adoption.templateVersion, old_baseline_permission_ids: adoption.oldBaselinePermissionIds, digest_algorithm: adoption.digestAlgorithm,
      old_baseline_digest: adoption.oldBaselineDigest, kind: adoption.kind, state: adoption.state, revision: adoption.revision
    };
    const value = harness({ adoptionRow: row });

    await value.store.transaction(expected, async (transaction) => {
      await expect(transaction.listTemplateAdoptions(expected.applicationId)).resolves.toEqual([adoption]);
      await transaction.write({ kind: "template-adoption", adoption });
    });

    const write = value.query.mock.calls.find(([query]) => String(query).startsWith("insert into k_nex_role_template_adoptions"));
    expect(write?.[1]?.[2]).toBeNull();
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
    expect(auditOnly.queries.some((query) => query.includes("k_nex_authorization_outbox"))).toBe(false);

    const mixed = harness();
    const snapshot = { schemaVersion: 1, id: "snapshot-1", applicationId: expected.applicationId, source: "administrative-non-authoritative", permission: descriptor, state: "deprecated", owner: descriptor.publisher, revision: 1 } as const;
    const result = await mixed.store.transaction(expected, async (transaction) => {
      await transaction.write({ kind: "role", role });
      await transaction.write({ kind: "catalog-snapshot", snapshot });
    });
    expect(result.state).toMatchObject({ authorizationRevision: 5, lifecycleRevision: 3 });
    expect(mixed.queries.filter((query) => query.startsWith("update k_nex_authorization_state"))).toHaveLength(1);
    expect(mixed.queries.filter((query) => query.includes("k_nex_authorization_outbox"))).toHaveLength(1);
  });

  it("projects durable audit timestamps in newest-first database order and pages from the cursor tuple", async () => {
    const older = audit("audit-older");
    const alpha = audit("audit-alpha");
    const omega = audit("audit-omega");
    const first = harness({ auditRows: [
      auditRow(omega, new Date("2026-09-01T12:01:00.000Z")),
      auditRow(alpha, new Date("2026-09-01T12:01:00.000Z")),
      auditRow(older, new Date("2026-09-01T12:00:00.000Z"))
    ] });

    await expect(first.store.transaction(expected, (transaction) => transaction.listAudits({ applicationId: expected.applicationId, limit: 3 }))).resolves.toMatchObject({ value: [
      { audit: omega, occurredAt: "2026-09-01T12:01:00.000Z" },
      { audit: alpha, occurredAt: "2026-09-01T12:01:00.000Z" },
      { audit: older, occurredAt: "2026-09-01T12:00:00.000Z" }
    ] });
    const firstQuery = first.query.mock.calls.find(([query]) => String(query).startsWith("select audit_id, application_id"));
    expect(firstQuery?.[0]).toContain("order by created_at desc, audit_id desc");

    const after = harness({ auditRows: [auditRow(older, "2026-09-01T12:00:00.000Z")] });
    await expect(after.store.transaction(expected, (transaction) => transaction.listAudits({ applicationId: expected.applicationId, afterAuditId: alpha.auditId, limit: 3 }))).resolves.toMatchObject({ value: [
      { audit: older, occurredAt: "2026-09-01T12:00:00.000Z" }
    ] });
    const afterQuery = after.query.mock.calls.find(([query]) => String(query).startsWith("select audit_id, application_id"));
    expect(afterQuery?.[0]).toContain("(created_at, audit_id) < (select created_at, audit_id");
    expect(afterQuery?.[1]).toEqual([expected.applicationId, expected.environment, alpha.auditId, 3]);
  });

  it("fails closed when a persisted audit timestamp cannot be parsed", async () => {
    const value = harness({ auditRows: [auditRow(audit("audit-invalid-time"), "not-a-timestamp")] });

    await expect(value.store.transaction(expected, (transaction) => transaction.listAudits({ applicationId: expected.applicationId, limit: 1 }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(value.queries.at(-1)).toBe("rollback");
  });

  it("rolls back the authorization write when its transactional outbox write fails", async () => {
    const value = harness({ outboxFailure: true });

    await expect(value.store.transaction(expected, async (transaction) => transaction.write({ kind: "role", role }))).rejects.toThrow("outbox unavailable");
    expect(value.queries.some((query) => query.startsWith("insert into k_nex_roles"))).toBe(true);
    expect(value.queries.at(-1)).toBe("rollback");
    expect(value.queries).not.toContain("commit");
  });

  it("rejects concurrent last-owner revocation under the application transaction lock", async () => {
    const value = harness({ activeOwner: true, otherOwners: 0 });
    const ownerAssignment = { schemaVersion: 1, id: "owner-assignment-1", applicationId: expected.applicationId, roleId: "system.role.owner", principal: { kind: "user", id: "user-1" }, state: "revoked", revision: 2 } as const;
    const store = new PostgresAuthorizationStore({ connect: vi.fn(async () => ({ query: value.query, release: vi.fn() })), query: value.query }, { validate: () => "accepted" });

    await expect(store.transaction(expected, async (transaction) => transaction.write({ kind: "assignment", assignment: ownerAssignment }))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.queries.some((query) => query.startsWith("select count(*)::int"))).toBe(true);
    expect(value.queries.some((query) => query.includes("insert into k_nex_role_assignments"))).toBe(false);
  });

  it("rejects bootstrap receipts outside the dedicated first-owner path", async () => {
    const value = harness({ bootstrapAssignment: { role_id: "system.role.owner", subject_kind: "user", subject_id: "user-1", state: "revoked" } });
    const receipt = { schemaVersion: 1, id: "receipt-1", applicationId: expected.applicationId, ownerRoleId: "system.role.owner", ownerAssignmentId: "owner-assignment-1", ownerPrincipal: { kind: "user", id: "user-1" }, authorizationRevision: 5, state: "committed" } as const;

    await expect(value.store.transaction(expected, async (transaction) => transaction.write({ kind: "bootstrap-receipt", receipt }))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(value.queries.some((query) => query.includes("insert into k_nex_authorization_bootstrap_receipts"))).toBe(false);
    expect(value.queries.at(-1)).toBe("rollback");
  });

  it("fails closed instead of treating an empty persisted description as absent", async () => {
    const value = harness({ roleRow: { application_id: expected.applicationId, role_id: role.id, label: role.label, description: "", protected_role_id: null, revision: 1 } });

    await expect(value.store.transaction(expected, async (transaction) => transaction.readRole(expected.applicationId, role.id))).rejects.toMatchObject({ code: "MUTATION_INVALID" });
    expect(value.queries.at(-1)).toBe("rollback");
  });
});
