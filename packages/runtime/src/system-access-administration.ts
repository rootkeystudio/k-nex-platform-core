import { createHash } from "node:crypto";

import {
  AuthorizationDecisionAuditSchema,
  AuthorizationSubjectSchema,
  RoleAssignmentSchema,
  RolePermissionGrantSchema,
  RoleSchema,
  canonicalJson,
  protectedRoleIds,
  type AuthorizationDecision,
  type AuthorizationDecisionAudit,
  type AuthorizationOwnerRef,
  type AuthorizationSubject,
  type PermissionCatalogSnapshot,
  type Role,
  type RoleAssignment,
  type RolePermissionGrant
} from "@k-nex/contracts";

import { isEffectiveAuthorizationCatalogForLifecycle, type EffectiveAuthorizationCatalog, type EffectiveRoleTemplate } from "./authorization-registry.js";
import {
  AuthorizationStoreError,
  parseAuthorizationExpectedRevision,
  type AuthorizationAuditEntry,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreReadTransaction,
  type AuthorizationStoreTransaction,
  type AuthorizationTransactionOutcome
} from "./authorization-store.js";
import { CurrentAuthorityAdapter, createCurrentAuthorityTarget, type CurrentAuthorityTarget } from "./current-authority-adapter.js";
import type { AuthorizationCatalogProvider } from "./effective-authority.js";
import { copyTemplatePermissionsToRole, instantiateRoleTemplate } from "./role-template-bootstrap.js";

export type SystemAccessAdministrationErrorCode = "UNAUTHORIZED" | "MUTATION_INVALID" | "REVISION_CONFLICT";

export class SystemAccessAdministrationError extends Error {
  constructor(readonly code: SystemAccessAdministrationErrorCode, message: string) {
    super(message);
    this.name = "SystemAccessAdministrationError";
  }
}

export interface SystemAccessAdministrationOptions<TContext> {
  readonly store: AuthorizationStore;
  readonly catalogProvider: AuthorizationCatalogProvider;
  readonly authority: CurrentAuthorityAdapter<TContext>;
}

export interface ActivePermissionGroup {
  readonly owner: AuthorizationOwnerRef;
  readonly resource: string;
  readonly operation: "read" | "write" | "manage" | "execute";
  readonly permissions: readonly EffectiveAuthorizationCatalog["permissions"][number][];
}

export interface InactivePermissionDiagnostic {
  readonly snapshot: PermissionCatalogSnapshot;
}

export interface RoleGrantDiagnostic {
  readonly grant: RolePermissionGrant;
  readonly state: "active" | "inactive";
  readonly inactiveReason?: PermissionCatalogSnapshot["state"] | "orphaned-after-removal";
}

export interface RoleDetail {
  readonly role: Role;
  readonly grants: readonly RoleGrantDiagnostic[];
  readonly assignments: readonly RoleAssignment[];
}

export interface RolesView {
  readonly roles: readonly Role[];
  readonly hiddenInactiveRoleIds: readonly string[];
}

export interface PermissionsView {
  readonly active: readonly ActivePermissionGroup[];
  readonly inactive: readonly InactivePermissionDiagnostic[];
}

const targets = Object.freeze({
  rolesRead: target("system.roles.read", "system.roles"),
  rolesManage: target("system.roles.manage", "system.roles"),
  permissionsRead: target("system.permissions.read", "system.permissions"),
  assignmentsRead: target("system.role-assignments.read", "system.role-assignments"),
  assignmentsManage: target("system.role-assignments.manage", "system.role-assignments"),
  auditRead: target("system.authorization.audit.read", "system.authorization.audit")
});

function target(permissionId: string, resource: string): CurrentAuthorityTarget {
  return createCurrentAuthorityTarget({ permissionId, scope: { kind: "application", resource }, facts: Object.freeze({ boundary: "system-access-administration" }) });
}

/**
 * Server-only coordinator for the System access screens. Its API accepts no
 * client-selected authorization target, permission owner, or generation.
 */
export class SystemAccessAdministrationService<TContext> {
  constructor(private readonly options: SystemAccessAdministrationOptions<TContext>) {}

  async roles(input: Readonly<{ readonly context: TContext; readonly includeInactive?: boolean }>): Promise<RolesView> {
    exactInput(input, ["context", "includeInactive"], ["includeInactive"]);
    if (input.includeInactive !== undefined && typeof input.includeInactive !== "boolean") invalid("Role list input is invalid.");
    return this.read(input.context, targets.rolesRead, async (transaction, catalog, expected) => {
      const roles = await transaction.listRoles(expected.applicationId);
      const grants = await transaction.listGrants(expected.applicationId);
      const assignments = await transaction.listAssignments(expected.applicationId);
      const active = activeGrantKeys(catalog);
      const assignedRoleIds = new Set(assignments.map((assignment) => assignment.roleId));
      const hiddenInactiveRoleIds = roles
        .filter((role) => !assignedRoleIds.has(role.id) && roleIsInactiveOnly(role, grants.filter((grant) => grant.roleId === role.id), active))
        .map((role) => role.id)
        .sort(compare);
      const hidden = new Set(hiddenInactiveRoleIds);
      return Object.freeze({
        roles: Object.freeze(roles.filter((role) => input.includeInactive === true || !hidden.has(role.id)).sort((left, right) => compare(left.id, right.id))),
        hiddenInactiveRoleIds: Object.freeze(hiddenInactiveRoleIds)
      });
    });
  }

  async roleDetail(input: Readonly<{ readonly context: TContext; readonly roleId: string }>): Promise<RoleDetail> {
    exactInput(input, ["context", "roleId"]);
    return this.read(input.context, targets.rolesRead, async (transaction, catalog, expected) => {
      const role = await requiredRole(transaction, expected.applicationId, input.roleId, false);
      const grants = await transaction.listGrants(expected.applicationId, role.id);
      const assignments = await transaction.listAssignments(expected.applicationId);
      const snapshots = await transaction.listCatalogSnapshots(expected.applicationId);
      return Object.freeze({ role, grants: grantDiagnostics(grants, catalog, snapshots), assignments: Object.freeze([...assignments].filter((assignment) => assignment.roleId === role.id).sort((left, right) => compare(left.id, right.id))) });
    });
  }

  async permissions(input: Readonly<{ readonly context: TContext }>): Promise<PermissionsView> {
    exactInput(input, ["context"]);
    return this.read(input.context, targets.permissionsRead, async (transaction, catalog, expected) => {
      const snapshots = await transaction.listCatalogSnapshots(expected.applicationId);
      return Object.freeze({ active: groupPermissions(catalog), inactive: Object.freeze(snapshots.map((snapshot) => Object.freeze({ snapshot })).sort((left, right) => compare(left.snapshot.id, right.snapshot.id))) });
    });
  }

  async assignments(input: Readonly<{ readonly context: TContext; readonly principal?: unknown }>): Promise<readonly RoleAssignment[]> {
    exactInput(input, ["context", "principal"], ["principal"]);
    const principal = input.principal === undefined ? undefined : parseSubject(input.principal);
    return this.read(input.context, targets.assignmentsRead, async (transaction, _catalog, expected) =>
      Object.freeze([...(await transaction.listAssignments(expected.applicationId, principal))].sort((left, right) => compare(left.id, right.id)))
    );
  }

  async templates(input: Readonly<{ readonly context: TContext }>): Promise<readonly EffectiveRoleTemplate[]> {
    exactInput(input, ["context"]);
    return this.read(input.context, targets.rolesRead, async (_transaction, catalog) =>
      Object.freeze([...catalog.roleTemplates].sort((left, right) => compare(templateKey(left), templateKey(right))))
    );
  }

  async audits(input: Readonly<{ readonly context: TContext; readonly afterAuditId?: string; readonly limit: number }>): Promise<readonly AuthorizationAuditEntry[]> {
    exactInput(input, ["afterAuditId", "context", "limit"], ["afterAuditId"]);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000 || input.afterAuditId !== undefined && typeof input.afterAuditId !== "string") invalid("Authorization audit page is invalid.");
    return this.read(input.context, targets.auditRead, async (transaction, _catalog, expected) => transaction.listAudits({ applicationId: expected.applicationId, ...(input.afterAuditId === undefined ? {} : { afterAuditId: input.afterAuditId }), limit: input.limit }));
  }

  async createRole(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly role: unknown }>): Promise<AuthorizationTransactionOutcome<Role>> {
    exactInput(input, ["context", "expected", "role"]);
    return this.mutate(input.context, input.expected, targets.rolesManage, "create-role", async (transaction, expected) => {
      const value = exactObject(input.role, ["description", "id", "label"], ["description"]);
      const role = RoleSchema.safeParse({ schemaVersion: 1, applicationId: expected.applicationId, id: value.id, label: value.label, ...(value.description === undefined ? {} : { description: value.description }), revision: nextRevision(expected) });
      if (!role.success || isProtectedRole(role.data)) invalid("Customer role metadata is invalid.");
      if (await transaction.readRole(expected.applicationId, role.data.id) !== undefined) conflict("Role already exists.");
      await transaction.write({ kind: "role", role: role.data });
      return role.data;
    });
  }

  async updateRole(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly roleId: string; readonly metadata: unknown }>): Promise<AuthorizationTransactionOutcome<Role>> {
    exactInput(input, ["context", "expected", "metadata", "roleId"]);
    return this.mutate(input.context, input.expected, targets.rolesManage, "update-role", async (transaction, expected) => {
      const existing = await requiredRole(transaction, expected.applicationId, input.roleId, true);
      const metadata = exactObject(input.metadata, ["description", "label"], ["description"]);
      const role = RoleSchema.safeParse({ ...existing, label: metadata.label, ...(metadata.description === undefined ? {} : { description: metadata.description }), revision: nextRevision(expected) });
      if (!role.success || isProtectedRole(role.data)) invalid("Customer role metadata is invalid.");
      await transaction.write({ kind: "role", role: role.data });
      return role.data;
    });
  }

  async addPermission(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly roleId: string; readonly permissionId: string }>): Promise<AuthorizationTransactionOutcome<RolePermissionGrant>> {
    exactInput(input, ["context", "expected", "permissionId", "roleId"]);
    return this.mutate(input.context, input.expected, targets.rolesManage, "add-permission", async (transaction, expected, catalog, decision) => {
      const role = await requiredRole(transaction, expected.applicationId, input.roleId, true);
      const permission = oneActivePermission(catalog, input.permissionId);
      assertPermissionDelegable(await delegationAuthority(transaction, expected.applicationId, catalog, decision), permission);
      const grants = await transaction.listGrants(expected.applicationId, role.id);
      if (grants.some((grant) => grant.permissionId === permission.descriptor.id)) conflict("Role already grants this permission.");
      const grant = RolePermissionGrantSchema.safeParse({ schemaVersion: 1, id: id("grant", expected.applicationId, role.id, permission.descriptor.id, ownerKey(permission.owner)), applicationId: expected.applicationId, roleId: role.id, permissionId: permission.descriptor.id, owner: permission.owner, revision: nextRevision(expected) });
      if (!grant.success) invalid("Selected active permission is invalid.");
      await transaction.write({ kind: "grant", grant: grant.data });
      return grant.data;
    });
  }

  async createAssignment(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly assignment: unknown }>): Promise<AuthorizationTransactionOutcome<RoleAssignment>> {
    exactInput(input, ["assignment", "context", "expected"]);
    return this.mutate(input.context, input.expected, targets.assignmentsManage, "create-assignment", async (transaction, expected, catalog, decision) => {
      const value = exactObject(input.assignment, ["id", "principal", "roleId"]);
      const role = await requiredRole(transaction, expected.applicationId, stringValue(value.roleId), false);
      const assignment = RoleAssignmentSchema.safeParse({ schemaVersion: 1, applicationId: expected.applicationId, id: value.id, roleId: value.roleId, principal: value.principal, state: "active", revision: nextRevision(expected) });
      if (!assignment.success) invalid("Role assignment is invalid.");
      assertAssignmentDelegable(await delegationAuthority(transaction, expected.applicationId, catalog, decision), role, assignment.data.principal);
      if ((await transaction.listAssignments(expected.applicationId)).some((candidate) => candidate.id === assignment.data.id)) conflict("Role assignment already exists.");
      await transaction.write({ kind: "assignment", assignment: assignment.data });
      return assignment.data;
    });
  }

  async revokeAssignment(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly assignmentId: string }>): Promise<AuthorizationTransactionOutcome<RoleAssignment>> {
    exactInput(input, ["assignmentId", "context", "expected"]);
    return this.mutate(input.context, input.expected, targets.assignmentsManage, "revoke-assignment", async (transaction, expected, catalog, decision) => {
      const assignment = (await transaction.listAssignments(expected.applicationId)).find((candidate) => candidate.id === input.assignmentId);
      if (assignment === undefined) invalid("Role assignment does not exist.");
      if (assignment.state === "revoked") conflict("Role assignment is already revoked.");
      const role = await requiredRole(transaction, expected.applicationId, assignment.roleId, false);
      assertProtectedAssignmentChange(await delegationAuthority(transaction, expected.applicationId, catalog, decision), role);
      const revoked = RoleAssignmentSchema.parse({ ...assignment, state: "revoked", revision: nextRevision(expected) });
      await transaction.write({ kind: "assignment", assignment: revoked });
      return revoked;
    });
  }

  async reactivateAssignment(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly assignmentId: string }>): Promise<AuthorizationTransactionOutcome<RoleAssignment>> {
    exactInput(input, ["assignmentId", "context", "expected"]);
    return this.storeErrorBoundary(async () => {
      const expected = parseAuthorizationExpectedRevision(input.expected);
      const decision = await this.admitMutation(input.context, expected, targets.assignmentsManage);
      const catalog = await this.catalog(expected.applicationId, expected.lifecycleRevision);
      return this.options.store.transaction(expected, async (transaction) => {
        const assignment = (await transaction.listAssignments(expected.applicationId)).find((candidate) => candidate.id === input.assignmentId);
        if (assignment === undefined) invalid("Role assignment does not exist.");
        if (assignment.state === "active") conflict("Role assignment is already active.");
        const role = await requiredRole(transaction, expected.applicationId, assignment.roleId, false);
        assertAssignmentDelegable(await delegationAuthority(transaction, expected.applicationId, catalog, decision), role, assignment.principal);
        const active = RoleAssignmentSchema.parse({ ...assignment, state: "active", revision: nextRevision(expected) });
        await transaction.write({ kind: "assignment", assignment: active });
        await transaction.write({ kind: "audit", audit: audit(decision, "reactivate-assignment", active.id) });
        return active;
      });
    });
  }

  async removePermission(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly grantId: string }>): Promise<AuthorizationTransactionOutcome<RolePermissionGrant>> {
    exactInput(input, ["context", "expected", "grantId"]);
    return this.storeErrorBoundary(async () => {
      const expected = parseAuthorizationExpectedRevision(input.expected);
      const decision = await this.admitMutation(input.context, expected, targets.rolesManage);
      return this.options.store.transaction(expected, async (transaction) => {
        const grant = (await transaction.listGrants(expected.applicationId)).find((candidate) => candidate.id === input.grantId);
        if (grant === undefined) invalid("Role permission grant does not exist.");
        await requiredRole(transaction, expected.applicationId, grant.roleId, true);
        const removed = await transaction.removeGrant(expected.applicationId, grant.id);
        if (removed === undefined) conflict("Role permission grant changed before removal.");
        await transaction.write({ kind: "audit", audit: audit(decision, "remove-permission", removed.id) });
        return removed;
      });
    });
  }

  async instantiateTemplate(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly templateId: string; readonly role: unknown }>): Promise<AuthorizationTransactionOutcome<unknown>> {
    return this.storeErrorBoundary(async () => {
      exactInput(input, ["context", "expected", "role", "templateId"]);
      const expected = parseAuthorizationExpectedRevision(input.expected);
      const decision = await this.admitMutation(input.context, expected, targets.rolesManage);
      const catalog = await this.catalog(expected.applicationId, expected.lifecycleRevision);
      const template = oneTemplate(catalog, input.templateId);
      return instantiateRoleTemplate({ store: this.options.store, expected, effectiveTemplate: template, role: parseTemplateRole(input.role), audit: audit(decision, "instantiate-template", input.templateId), admit: async (transaction) => {
        assertPermissionsDelegable(await delegationAuthority(transaction, expected.applicationId, catalog, decision), catalog, template.template.permissionIds, template.owner);
      } });
    });
  }

  async copyTemplatePermissions(input: Readonly<{ readonly context: TContext; readonly expected: unknown; readonly templateId: string; readonly roleId: string; readonly permissionIds: unknown }>): Promise<AuthorizationTransactionOutcome<unknown>> {
    return this.storeErrorBoundary(async () => {
      exactInput(input, ["context", "expected", "permissionIds", "roleId", "templateId"]);
      const expected = parseAuthorizationExpectedRevision(input.expected);
      const decision = await this.admitMutation(input.context, expected, targets.rolesManage);
      const catalog = await this.catalog(expected.applicationId, expected.lifecycleRevision);
      const template = oneTemplate(catalog, input.templateId);
      const permissionIds = canonicalSelection(input.permissionIds);
      return copyTemplatePermissionsToRole({ store: this.options.store, expected, effectiveTemplate: template, roleId: input.roleId, permissionIds, audit: audit(decision, "copy-template-permissions", `${input.roleId}/${input.templateId}`), admit: async (transaction) => {
        assertPermissionsDelegable(await delegationAuthority(transaction, expected.applicationId, catalog, decision), catalog, permissionIds, template.owner);
      } });
    });
  }

  private async read<TResult>(context: TContext, target: CurrentAuthorityTarget, work: (transaction: AuthorizationStoreReadTransaction, catalog: EffectiveAuthorizationCatalog, expected: AuthorizationExpectedRevision) => Promise<TResult>): Promise<TResult> {
    return this.storeErrorBoundary(async () => {
      const decision = await this.options.authority.authorize(context, target);
      if (!allowed(decision, target)) unauthorized();
      const expected = expectedFromDecision(decision);
      const catalog = await this.catalog(expected.applicationId, expected.lifecycleRevision);
      const outcome = await this.options.store.readTransaction(expected, async (transaction) => work(transaction, catalog, expected));
      return outcome.value;
    });
  }

  private async mutate<TResult>(context: TContext, expectedValue: unknown, target: CurrentAuthorityTarget, action: string, work: (transaction: AuthorizationStoreTransaction, expected: AuthorizationExpectedRevision, catalog: EffectiveAuthorizationCatalog, decision: AuthorizationDecision) => Promise<TResult>): Promise<AuthorizationTransactionOutcome<TResult>> {
    return this.storeErrorBoundary(async () => {
      const expected = parseAuthorizationExpectedRevision(expectedValue);
      const decision = await this.admitMutation(context, expected, target);
      const catalog = await this.catalog(expected.applicationId, expected.lifecycleRevision);
      return this.options.store.transaction(expected, async (transaction) => {
        const value = await work(transaction, expected, catalog, decision);
        await transaction.write({ kind: "audit", audit: audit(decision, action, auditSubject(value)) });
        return value;
      });
    });
  }

  private async storeErrorBoundary<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AuthorizationStoreError) {
        throw new SystemAccessAdministrationError(error.code === "REVISION_CONFLICT" ? "REVISION_CONFLICT" : "MUTATION_INVALID", error.message);
      }
      throw error;
    }
  }

  private async admitMutation(context: TContext, expected: AuthorizationExpectedRevision, target: CurrentAuthorityTarget): Promise<AuthorizationDecision> {
    const decision = await this.options.authority.authorize(context, target);
    if (!allowed(decision, target) || decision.applicationId !== expected.applicationId || decision.environment !== expected.environment ||
      decision.authorizationRevision !== expected.authorizationRevision || decision.lifecycleRevision !== expected.lifecycleRevision ||
      decision.approval !== "not-required" || decision.reauthentication !== "not-required") {
      if (decision !== undefined && (decision.authorizationRevision !== expected.authorizationRevision || decision.lifecycleRevision !== expected.lifecycleRevision)) conflict("Authorization decision revision is stale.");
      unauthorized();
    }
    return decision;
  }

  private async catalog(applicationIdValue: string, lifecycleRevision: number): Promise<EffectiveAuthorizationCatalog> {
    const value = await this.options.catalogProvider.current({ applicationId: applicationIdValue, lifecycleRevision });
    if (value === undefined || value.applicationId !== applicationIdValue || value.lifecycleRevision !== lifecycleRevision ||
      !isEffectiveAuthorizationCatalogForLifecycle(value.catalog, applicationIdValue, lifecycleRevision)) {
      throw new SystemAccessAdministrationError("REVISION_CONFLICT", "Current effective authorization catalog is unavailable.");
    }
    return value.catalog;
  }
}

function allowed(decision: AuthorizationDecision | undefined, target: CurrentAuthorityTarget): decision is AuthorizationDecision {
  return decision?.outcome === "allow" && decision.permissionId === target.permissionId && decision.scope.kind === "application" && decision.scope.resource === (target.scope as { readonly resource: string }).resource;
}

function expectedFromDecision(decision: AuthorizationDecision): AuthorizationExpectedRevision {
  return parseAuthorizationExpectedRevision({
    applicationId: decision.applicationId,
    environment: decision.environment,
    authorizationRevision: decision.authorizationRevision,
    lifecycleRevision: decision.lifecycleRevision
  });
}

function activeGrantKeys(catalog: EffectiveAuthorizationCatalog): ReadonlySet<string> {
  return new Set(catalog.permissions.map(permissionKey));
}

function permissionKey(permission: Pick<EffectiveAuthorizationCatalog["permissions"][number], "descriptor" | "owner">): string {
  return `${permission.descriptor.id}\u0000${ownerKey(permission.owner)}`;
}

function grantKey(grant: RolePermissionGrant): string {
  return `${grant.permissionId}\u0000${ownerKey(grant.owner)}`;
}

function sameSubject(left: AuthorizationSubject, right: AuthorizationSubject): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function roleIsInactiveOnly(role: Role, grants: readonly RolePermissionGrant[], active: ReadonlySet<string>): boolean {
  return role.protectedRoleId === undefined && grants.length > 0 && !grants.some((grant) => active.has(grantKey(grant)));
}

interface DelegationAuthority {
  readonly root: boolean;
  readonly permissionKeys: ReadonlySet<string>;
  readonly rolePermissionKeys: ReadonlyMap<string, ReadonlySet<string>>;
  readonly principal: AuthorizationSubject;
  readonly effectiveActor: AuthorizationSubject;
}

/**
 * Generic administration permissions only open this service.  Each authority
 * expansion is constrained by the actor's current transaction-local closure.
 */
async function delegationAuthority(
  transaction: AuthorizationStoreReadTransaction,
  applicationId: string,
  catalog: EffectiveAuthorizationCatalog,
  decision: AuthorizationDecision
): Promise<DelegationAuthority> {
  const roles = await transaction.listRoles(applicationId);
  const grants = await transaction.listGrants(applicationId);
  const assignments = await transaction.listAssignments(applicationId);
  const active = activeGrantKeys(catalog);
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const rolePermissionKeys = new Map<string, ReadonlySet<string>>();
  for (const role of roles) {
    // Persisted dormant grants are not current authority, but a non-owner may
    // not assign a role that could regain authority after lifecycle changes.
    rolePermissionKeys.set(role.id, new Set(grants.filter((grant) => grant.roleId === role.id).map(grantKey)));
  }
  const fullCatalog = active;
  const authorityFor = (subject: AuthorizationSubject): Readonly<{ readonly root: boolean; readonly permissionKeys: ReadonlySet<string> }> => {
    const assignedRoleIds = new Set(assignments
      .filter((assignment) => assignment.state === "active" && sameSubject(assignment.principal, subject))
      .map((assignment) => assignment.roleId));
    const root = subject.kind === "user" && [...assignedRoleIds].some((roleId) => rolesById.get(roleId)?.protectedRoleId === "system.role.owner");
    if (root) return Object.freeze({ root: true, permissionKeys: fullCatalog });
    const permissionKeys = new Set<string>();
    for (const roleId of assignedRoleIds) {
      for (const key of rolePermissionKeys.get(roleId) ?? []) if (active.has(key)) permissionKeys.add(key);
    }
    return Object.freeze({ root: false, permissionKeys });
  };
  const principal = authorityFor(decision.principal);
  const effectiveActor = sameSubject(decision.principal, decision.effectiveActor) ? principal : authorityFor(decision.effectiveActor);
  const permissionKeys = sameSubject(decision.principal, decision.effectiveActor)
    ? principal.permissionKeys
    : new Set([...principal.permissionKeys].filter((key) => effectiveActor.permissionKeys.has(key)));
  return Object.freeze({
    root: principal.root && effectiveActor.root,
    permissionKeys,
    rolePermissionKeys,
    principal: decision.principal,
    effectiveActor: decision.effectiveActor
  });
}

function assertPermissionDelegable(authority: DelegationAuthority, permission: EffectiveAuthorizationCatalog["permissions"][number]): void {
  if (!authority.root && !authority.permissionKeys.has(permissionKey(permission))) unauthorized();
}

function assertPermissionsDelegable(
  authority: DelegationAuthority,
  catalog: EffectiveAuthorizationCatalog,
  permissionIds: readonly string[],
  owner: AuthorizationOwnerRef
): void {
  for (const permissionId of permissionIds) {
    const permission = catalog.permissions.find((candidate) => candidate.descriptor.id === permissionId && ownerKey(candidate.owner) === ownerKey(owner));
    if (permission === undefined) invalid("Selected permission is not active for the selected owner.");
    assertPermissionDelegable(authority, permission);
  }
}

function assertAssignmentDelegable(authority: DelegationAuthority, role: Role, subject: AuthorizationSubject): void {
  if (isProtectedRole(role)) {
    if (!authority.root) unauthorized();
    if (subject.kind !== "user") invalid("Protected roles may only be assigned to human users.");
    return;
  }
  if (!authority.root && (sameSubject(subject, authority.principal) || sameSubject(subject, authority.effectiveActor))) {
    unauthorized();
  }
  if (!authority.root && [...(authority.rolePermissionKeys.get(role.id) ?? [])].some((key) => !authority.permissionKeys.has(key))) {
    unauthorized();
  }
}

function assertProtectedAssignmentChange(authority: DelegationAuthority, role: Role): void {
  if (!isProtectedRole(role)) return;
  if (!authority.root) unauthorized();
}

function groupPermissions(catalog: EffectiveAuthorizationCatalog): readonly ActivePermissionGroup[] {
  const grouped = new Map<string, { owner: AuthorizationOwnerRef; resource: string; operation: ActivePermissionGroup["operation"]; permissions: EffectiveAuthorizationCatalog["permissions"][number][] }>();
  for (const permission of catalog.permissions) {
    const key = `${ownerKey(permission.owner)}\u0000${permission.descriptor.resource}\u0000${permission.descriptor.operation}`;
    const group = grouped.get(key) ?? { owner: permission.owner, resource: permission.descriptor.resource, operation: permission.descriptor.operation, permissions: [] };
    group.permissions.push(permission);
    grouped.set(key, group);
  }
  return Object.freeze([...grouped.values()].map((group) => Object.freeze({ ...group, permissions: Object.freeze(group.permissions.sort((left, right) => compare(left.descriptor.id, right.descriptor.id))) })).sort((left, right) => compare(`${ownerKey(left.owner)}/${left.resource}/${left.operation}`, `${ownerKey(right.owner)}/${right.resource}/${right.operation}`)));
}

function grantDiagnostics(grants: readonly RolePermissionGrant[], catalog: EffectiveAuthorizationCatalog, snapshots: readonly PermissionCatalogSnapshot[]): readonly RoleGrantDiagnostic[] {
  const active = activeGrantKeys(catalog);
  return Object.freeze([...grants].sort((left, right) => compare(left.id, right.id)).map((grant) => {
    if (active.has(grantKey(grant))) return Object.freeze({ grant, state: "active" as const });
    const snapshot = snapshots.find((candidate) => candidate.permission.id === grant.permissionId && candidate.owner !== undefined && ownerKey(candidate.owner) === ownerKey(grant.owner));
    return Object.freeze({ grant, state: "inactive" as const, inactiveReason: snapshot?.state ?? "orphaned-after-removal" });
  }));
}

function oneActivePermission(catalog: EffectiveAuthorizationCatalog, permissionId: unknown): EffectiveAuthorizationCatalog["permissions"][number] {
  if (typeof permissionId !== "string") invalid("Permission selection is invalid.");
  const matching = catalog.permissions.filter((permission) => permission.descriptor.id === permissionId);
  if (matching.length !== 1) invalid("Permission is not uniquely active in the effective catalog.");
  return matching[0]!;
}

function oneTemplate(catalog: EffectiveAuthorizationCatalog, templateId: unknown): EffectiveRoleTemplate {
  if (typeof templateId !== "string") invalid("Role template selection is invalid.");
  const matching = catalog.roleTemplates.filter((template) => template.template.id === templateId);
  if (matching.length !== 1) invalid("Role template is not uniquely active in the effective catalog.");
  return matching[0]!;
}

async function requiredRole(transaction: AuthorizationStoreReadTransaction, applicationIdValue: string, roleId: unknown, editable: boolean): Promise<Role> {
  if (typeof roleId !== "string") invalid("Role ID is invalid.");
  const role = await transaction.readRole(applicationIdValue, roleId);
  if (role === undefined || role.applicationId !== applicationIdValue || editable && isProtectedRole(role)) invalid(editable ? "Role is protected or does not exist." : "Role does not exist.");
  return role;
}

function isProtectedRole(role: Role): boolean {
  return role.protectedRoleId !== undefined || protectedRoleIds.includes(role.id as never);
}

function canonicalSelection(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string") || !strictlySorted(value)) invalid("Selected template permissions must be sorted and unique.");
  return Object.freeze([...value]);
}

function parseTemplateRole(value: unknown): Readonly<{ readonly id: string; readonly label: string; readonly description?: string }> {
  const input = exactObject(value, ["description", "id", "label"], ["description"]);
  if (typeof input.id !== "string" || typeof input.label !== "string" || input.description !== undefined && typeof input.description !== "string") invalid("Template role metadata is invalid.");
  return Object.freeze({ id: input.id, label: input.label, ...(input.description === undefined ? {} : { description: input.description }) });
}

function parseSubject(value: unknown): AuthorizationSubject {
  const parsed = AuthorizationSubjectSchema.safeParse(value);
  if (!parsed.success) invalid("Assignment subject is invalid.");
  return parsed.data;
}

function audit(decision: AuthorizationDecision, operation: string, target: string): AuthorizationDecisionAudit {
  const value = AuthorizationDecisionAuditSchema.safeParse({
    schemaVersion: 1, auditId: id("audit", decision.decisionId, operation, target), decisionId: decision.decisionId,
    correlationId: decision.correlationId, applicationId: decision.applicationId, environment: decision.environment,
    permissionId: decision.permissionId, owner: decision.owner, principal: decision.principal, effectiveActor: decision.effectiveActor,
    ...(decision.delegation === undefined ? {} : { delegationId: decision.delegation.delegationId }), scope: decision.scope,
    operation, target, authorizationRevision: decision.authorizationRevision, lifecycleRevision: decision.lifecycleRevision,
    outcome: decision.outcome, reason: decision.reason, approval: decision.approval, reauthentication: decision.reauthentication
  });
  if (!value.success) invalid("Authorization decision audit is invalid.");
  return value.data;
}

function auditSubject(value: unknown): string {
  try { return createHash("sha256").update(canonicalJson(value)).digest("hex"); } catch { return "invalid"; }
}

function id(kind: string, ...parts: readonly string[]): string {
  return `access.${kind}.${createHash("sha256").update(canonicalJson(parts)).digest("hex")}`;
}

function ownerKey(owner: AuthorizationOwnerRef): string {
  return owner.kind === "platform" ? `platform:${owner.namespace}` : `extension:${owner.deliveryClass}:${owner.extensionId}:${owner.generation}`;
}

function templateKey(template: EffectiveRoleTemplate): string {
  return `${template.owner.deliveryClass}/${template.owner.extensionId}/${template.owner.generation}/${template.template.id}`;
}

function exactInput(value: unknown, allowed: readonly string[], optional: readonly string[] = []): void { exactObject(value, allowed, optional); }

function exactObject(value: unknown, allowed: readonly string[], optional: readonly string[] = []): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !optional.includes(key) && !(key in value))) invalid("System access input is not canonical.");
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown): string { if (typeof value !== "string") invalid("Expected string input."); return value; }
function strictlySorted(values: readonly string[]): boolean { return values.every((value, index) => index === 0 || values[index - 1]! < value); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function nextRevision(expected: AuthorizationExpectedRevision): number { if (expected.authorizationRevision >= 1_000_000_000) conflict("Authorization revision cannot advance further."); return expected.authorizationRevision + 1; }
function invalid(message: string): never { throw new SystemAccessAdministrationError("MUTATION_INVALID", message); }
function conflict(message: string): never { throw new SystemAccessAdministrationError("REVISION_CONFLICT", message); }
function unauthorized(): never { throw new SystemAccessAdministrationError("UNAUTHORIZED", "Current authority does not permit this access administration operation."); }
