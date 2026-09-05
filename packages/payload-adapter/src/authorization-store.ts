import {
  AuthorizationDecisionAuditSchema,
  AuthorizationStateSchema,
  AuthorizationSubjectSchema,
  BootstrapReceiptSchema,
  ExtensionAuthorizationGenerationSchema,
  PermissionCatalogSnapshotSchema,
  RoleAssignmentSchema,
  RolePermissionGrantSchema,
  RoleSchema,
  TemplateAdoptionSchema,
  canonicalJson,
  protectedRoleIds,
  type AuthorizationDecisionAudit,
  type AuthorizationState,
  type BootstrapReceipt,
  type ExtensionAuthorizationGeneration,
  type PermissionCatalogSnapshot,
  type Role,
  type RoleAssignment,
  type RolePermissionGrant,
  type TemplateAdoption
} from "@k-nex/contracts";
import {
  AuthorizationStoreError,
  assertExactProtectedRoleBaselineState,
  assertFirstOwnerBootstrapMutations,
  assertAuthorizationExpectedRevision,
  currentProtectedPlatformRoleBaselineRelease,
  isCurrentProtectedRoleBaselineGrant,
  isCurrentProtectedRoleBaselineGrantKey,
  isProtectedPlatformRoleGrant,
  parseAuthorizationExpectedRevision,
  parseAuthorizationStoreMutation,
  recognizedProtectedPlatformRoleBaselineRelease,
  type AuthorizationStore,
  type AuthorizationAuditEntry,
  type AuthorizationStoreMutation,
  type AuthorizationStoreReadTransaction,
  type AuthorizationStoreTransaction,
  type AuthorizationSubjectValidator,
  type AuthorizationTransactionOutcome,
  type AuthorizationExpectedRevision,
  type ProtectedRoleBaselineReconciliationStore,
  protectedRoleBaselineReconciliationOperation,
  protectedRoleBaselineReconciliationTarget
} from "@k-nex/runtime";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";
import { writeAuthorizationInvalidationOutbox } from "./authorization-outbox.js";

type Row = Record<string, unknown>;

function fail(code: "MUTATION_INVALID" | "REVISION_CONFLICT" | "SUBJECT_INVALID", message: string): never {
  throw new AuthorizationStoreError(code, message);
}

function integer(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) fail("MUTATION_INVALID", "Persisted authorization row has an invalid integer.");
  return number;
}

function string(value: unknown): string {
  if (typeof value !== "string") fail("MUTATION_INVALID", "Persisted authorization row has an invalid string.");
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return string(value);
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success || canonicalJson(result.data) !== canonicalJson(value)) {
    fail("MUTATION_INVALID", "Persisted authorization row is not canonical.");
  }
  return Object.freeze(result.data);
}

function role(row: Row): Role {
  const description = optionalString(row.description);
  const protectedRoleId = optionalString(row.protected_role_id);
  return parse(RoleSchema, {
    schemaVersion: 1, id: string(row.role_id), applicationId: string(row.application_id), label: string(row.label),
    ...(description !== undefined ? { description } : {}), ...(protectedRoleId !== undefined ? { protectedRoleId } : {}), revision: integer(row.revision)
  });
}

function owner(row: Row, prefix = "owner_"): RolePermissionGrant["owner"] {
  const kind = string(row[`${prefix}kind`]);
  if (kind === "platform") return { kind, namespace: string(row[`${prefix}namespace`]) as "system" };
  if (kind === "extension") return {
    kind, deliveryClass: string(row[`${prefix}delivery_class`]) as "platform-plugin" | "hot-application",
    extensionId: string(row[`${prefix}extension_id`]), generation: integer(row[`${prefix}generation`])
  };
  fail("MUTATION_INVALID", "Persisted authorization owner is invalid.");
}

function grant(row: Row): RolePermissionGrant {
  return parse(RolePermissionGrantSchema, {
    schemaVersion: 1, id: string(row.grant_id), applicationId: string(row.application_id), roleId: string(row.role_id),
    permissionId: string(row.permission_id), owner: owner(row), revision: integer(row.revision)
  });
}

function assignment(row: Row): RoleAssignment {
  return parse(RoleAssignmentSchema, {
    schemaVersion: 1, id: string(row.assignment_id), applicationId: string(row.application_id), roleId: string(row.role_id),
    principal: { kind: string(row.subject_kind), id: string(row.subject_id) }, state: string(row.state), revision: integer(row.revision)
  });
}

function adoption(row: Row): TemplateAdoption {
  const roleId = optionalString(row.role_id);
  return parse(TemplateAdoptionSchema, {
    schemaVersion: 1, id: string(row.adoption_id), applicationId: string(row.application_id), ...(roleId === undefined ? {} : { roleId }), templateId: string(row.template_id),
    publisher: { kind: "extension", deliveryClass: string(row.publisher_delivery_class), extensionId: string(row.publisher_extension_id) },
    owner: owner(row) as Exclude<RolePermissionGrant["owner"], { kind: "platform" }>, templateVersion: integer(row.template_version),
    oldBaselinePermissionIds: row.old_baseline_permission_ids, digestAlgorithm: string(row.digest_algorithm), oldBaselineDigest: string(row.old_baseline_digest),
    kind: string(row.kind), state: string(row.state), revision: integer(row.revision)
  });
}

function snapshot(row: Row): PermissionCatalogSnapshot {
  const kind = optionalString(row.owner_kind);
  return parse(PermissionCatalogSnapshotSchema, {
    schemaVersion: 1, id: string(row.snapshot_id), applicationId: string(row.application_id), source: string(row.source),
    permission: row.permission_json, state: string(row.state), ...(kind ? { owner: owner(row) } : {}), revision: integer(row.revision)
  });
}

function generation(row: Row): ExtensionAuthorizationGeneration {
  return parse(ExtensionAuthorizationGenerationSchema, {
    schemaVersion: 1, applicationId: string(row.application_id), owner: owner(row) as Exclude<RolePermissionGrant["owner"], { kind: "platform" }>,
    runtimeGenerationIds: row.runtime_generation_ids, state: string(row.state), authorizationRevision: integer(row.authorization_revision), lifecycleRevision: integer(row.lifecycle_revision)
  });
}

function state(row: Row, environment: string): AuthorizationState {
  return parse(AuthorizationStateSchema, {
    schemaVersion: 1, applicationId: string(row.application_id), environment,
    authorizationRevision: integer(row.authorization_revision), lifecycleRevision: integer(row.lifecycle_revision)
  });
}

function receipt(row: Row): BootstrapReceipt {
  return parse(BootstrapReceiptSchema, {
    schemaVersion: 1, id: string(row.receipt_id), applicationId: string(row.application_id), ownerRoleId: string(row.owner_role_id),
    ownerAssignmentId: string(row.owner_assignment_id), ownerPrincipal: { kind: string(row.owner_principal_kind), id: string(row.owner_principal_id) },
    protectedBaselineVersion: integer(row.protected_baseline_version), protectedBaselineDigest: string(row.protected_baseline_digest),
    authorizationRevision: integer(row.authorization_revision), state: string(row.state)
  });
}

function audit(row: Row): AuthorizationDecisionAudit {
  const value = parse(AuthorizationDecisionAuditSchema, row.audit_json);
  if (value.auditId !== string(row.audit_id) || value.applicationId !== string(row.application_id) || value.environment !== string(row.environment) ||
    value.permissionId !== string(row.permission_id) || value.outcome !== string(row.outcome) || value.reason !== string(row.reason) ||
    value.authorizationRevision !== integer(row.authorization_revision) || value.lifecycleRevision !== integer(row.lifecycle_revision)) {
    fail("MUTATION_INVALID", "Persisted authorization audit projection is inconsistent.");
  }
  return value;
}

function auditEntry(row: Row): AuthorizationAuditEntry {
  const value = row.created_at;
  if (!(value instanceof Date) && typeof value !== "string") fail("MUTATION_INVALID", "Persisted authorization audit timestamp is invalid.");
  const occurredAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(occurredAt.valueOf())) fail("MUTATION_INVALID", "Persisted authorization audit timestamp is invalid.");
  return Object.freeze({ audit: audit(row), occurredAt: occurredAt.toISOString() });
}

function sameApplication(expected: AuthorizationExpectedRevision, applicationId: string): void {
  if (applicationId !== expected.applicationId) fail("MUTATION_INVALID", "Authorization transaction cannot cross application boundaries.");
}

function mutationApplication(mutation: AuthorizationStoreMutation): string {
  switch (mutation.kind) {
    case "role": return mutation.role.applicationId;
    case "grant": return mutation.grant.applicationId;
    case "assignment": return mutation.assignment.applicationId;
    case "template-adoption": return mutation.adoption.applicationId;
    case "catalog-snapshot": return mutation.snapshot.applicationId;
    case "extension-generation": return mutation.generation.applicationId;
    case "bootstrap-receipt": return mutation.receipt.applicationId;
    case "audit": return mutation.audit.applicationId;
    default: return fail("MUTATION_INVALID", "Authorization mutation kind is invalid.");
  }
}

type RevisionChanges = Readonly<{ authorization: boolean; lifecycle: boolean }>;

function revisionChanges(mutations: readonly AuthorizationStoreMutation[], removedGrant: boolean): RevisionChanges {
  return Object.freeze({
    authorization: removedGrant || mutations.some((mutation) => ["role", "grant", "assignment", "template-adoption", "bootstrap-receipt"].includes(mutation.kind)),
    lifecycle: mutations.some((mutation) => ["catalog-snapshot", "extension-generation"].includes(mutation.kind))
  });
}

export class PostgresAuthorizationStore implements AuthorizationStore, ProtectedRoleBaselineReconciliationStore {
  constructor(private readonly pool: RuntimeExtensionPool, private readonly subjectValidator?: AuthorizationSubjectValidator) {}

  async readState(applicationId: string, environment: string): Promise<AuthorizationState | undefined> {
    const result = await this.pool.query<Row>(
      `select application_id, authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1`,
      [applicationId]
    );
    return result.rows[0] ? state(result.rows[0], environment) : undefined;
  }

  async readProtectedRoleBaselineReceipt(applicationId: string): Promise<BootstrapReceipt | undefined> {
    const result = await this.pool.query<Row>(
      `select application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id,
              protected_baseline_version, protected_baseline_digest, authorization_revision, state
       from k_nex_authorization_bootstrap_receipts where application_id=$1`,
      [applicationId]
    );
    if (result.rows.length > 1) fail("MUTATION_INVALID", "Persisted protected baseline receipt is invalid.");
    return result.rows[0] ? receipt(result.rows[0]) : undefined;
  }

  async transaction<T>(expected: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>): Promise<AuthorizationTransactionOutcome<T>> {
    return this.runTransaction(expected, work, false);
  }

  async readTransaction<T>(expected: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreReadTransaction) => Promise<T>): Promise<AuthorizationTransactionOutcome<T>> {
    const parsedExpected = parseAuthorizationExpectedRevision(expected);
    const session = await this.pool.connect();
    try {
      await session.query("begin isolation level repeatable read read only");
      const currentResult = await session.query<Row>(
        `select application_id, authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1`,
        [parsedExpected.applicationId]
      );
      const current = assertAuthorizationExpectedRevision(parsedExpected, currentResult.rows[0] ? state(currentResult.rows[0], parsedExpected.environment) : undefined);
      const value = await work(this.readView(session, parsedExpected));
      await session.query("commit");
      return Object.freeze({ committed: true, value, state: current });
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  async bootstrapFirstOwnerTransaction<T>(expected: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>): Promise<AuthorizationTransactionOutcome<T>> {
    return this.runTransaction(expected, work, true);
  }

  async reconcileProtectedRoleBaselineTransaction<T>(expected: AuthorizationExpectedRevision, expectedPrior: Readonly<{ readonly version: number; readonly digest: string }>, work: (transaction: AuthorizationStoreTransaction) => Promise<T>): Promise<AuthorizationTransactionOutcome<T>> {
    return this.runTransaction(expected, work, false, expectedPrior);
  }

  private async runTransaction<T>(expected: AuthorizationExpectedRevision, work: (transaction: AuthorizationStoreTransaction) => Promise<T>, bootstrap: boolean, reconciliation?: Readonly<{ readonly version: number; readonly digest: string }>): Promise<AuthorizationTransactionOutcome<T>> {
    const parsedExpected = parseAuthorizationExpectedRevision(expected);
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([parsedExpected.applicationId, "authorization-state"])]);
      if (parsedExpected.authorizationRevision === 0 && parsedExpected.lifecycleRevision === 0) {
        await session.query(`insert into k_nex_authorization_state (application_id) values ($1) on conflict do nothing`, [parsedExpected.applicationId]);
      }
      const locked = await session.query<Row>(
        `select application_id, authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1 for update`,
        [parsedExpected.applicationId]
      );
      const current = assertAuthorizationExpectedRevision(parsedExpected, locked.rows[0] ? state(locked.rows[0], parsedExpected.environment) : undefined);
      const mutations: AuthorizationStoreMutation[] = [];
      let removedGrant = false;
      const view = this.view(session, parsedExpected, current, mutations, bootstrap, reconciliation !== undefined, () => { removedGrant = true; });
      if (bootstrap) await this.assertBootstrapEmpty(view, parsedExpected.applicationId);
      const priorReceipt = reconciliation === undefined ? undefined : await this.assertProtectedBaselineReconciliationPrior(view, parsedExpected, reconciliation);
      const value = await work(view);
      if (bootstrap) assertFirstOwnerBootstrapMutations(parsedExpected, mutations);
      if (reconciliation !== undefined) {
        this.assertProtectedBaselineReconciliationMutations(parsedExpected, mutations);
        await this.assertProtectedBaselineReconciliationFinal(view, parsedExpected, priorReceipt!);
      }
      const changes = revisionChanges(mutations, removedGrant);
      const next = changes.authorization || changes.lifecycle
        ? await this.advance(session, current, changes)
        : current;
      if (changes.authorization || changes.lifecycle) {
        await writeAuthorizationInvalidationOutbox(session, {
          ...next,
          scope: changes.authorization ? "application" : "environment"
        });
      }
      await session.query("commit");
      return Object.freeze({ committed: true, value, state: next });
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  private async assertBootstrapEmpty(view: AuthorizationStoreTransaction, applicationId: string): Promise<void> {
    const roles = await view.listRoles(applicationId);
    const grants = await view.listGrants(applicationId);
    const assignments = await view.listAssignments(applicationId);
    const adoptions = await view.listTemplateAdoptions(applicationId);
    const snapshots = await view.listCatalogSnapshots(applicationId);
    const generations = await view.listExtensionGenerations(applicationId);
    const receipt = await view.readBootstrapReceipt(applicationId);
    const audits = await view.listAudits({ applicationId, limit: 1 });
    if (roles.length !== 0 || grants.length !== 0 || assignments.length !== 0 || adoptions.length !== 0 || snapshots.length !== 0 || generations.length !== 0 || receipt !== undefined || audits.length !== 0) {
      fail("REVISION_CONFLICT", "First-owner bootstrap requires an empty authorization state.");
    }
  }

  private readView(session: RuntimeExtensionSession, expected: AuthorizationExpectedRevision): AuthorizationStoreReadTransaction {
    const application = (applicationId: string) => sameApplication(expected, applicationId);
    return Object.freeze({
      readRole: async (applicationId: string, roleId: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, role_id, label, description, protected_role_id, revision from k_nex_roles where application_id=$1 and role_id=$2`, [expected.applicationId, roleId]);
        return result.rows[0] ? role(result.rows[0]) : undefined;
      },
      listRoles: async (applicationId: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, role_id, label, description, protected_role_id, revision from k_nex_roles where application_id=$1 order by role_id`, [expected.applicationId]);
        return Object.freeze(result.rows.map(role));
      },
      listGrants: async (applicationId: string, roleId?: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, grant_id, role_id, permission_id, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision from k_nex_role_permission_grants where application_id=$1${roleId === undefined ? "" : " and role_id=$2"} order by grant_id`, roleId === undefined ? [expected.applicationId] : [expected.applicationId, roleId]);
        return Object.freeze(result.rows.map(grant));
      },
      listAssignments: async (applicationId: string, principal?: RoleAssignment["principal"]) => {
        application(applicationId);
        const parsed = principal === undefined ? undefined : AuthorizationSubjectSchema.safeParse(principal);
        if (parsed !== undefined && !parsed.success) fail("MUTATION_INVALID", "Authorization subject filter is invalid.");
        const result = await session.query<Row>(`select application_id, assignment_id, role_id, subject_kind, subject_id, state, revision from k_nex_role_assignments where application_id=$1${parsed === undefined ? "" : " and subject_kind=$2 and subject_id=$3"} order by assignment_id`, parsed === undefined ? [expected.applicationId] : [expected.applicationId, parsed.data.kind, parsed.data.id]);
        return Object.freeze(result.rows.map(assignment));
      },
      listTemplateAdoptions: async (applicationId: string, roleId?: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, adoption_id, role_id, template_id, publisher_delivery_class, publisher_extension_id, 'extension' as owner_kind, null::varchar as owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, template_version, old_baseline_permission_ids, digest_algorithm, old_baseline_digest, kind, state, revision from k_nex_role_template_adoptions where application_id=$1${roleId === undefined ? "" : " and role_id=$2"} order by adoption_id`, roleId === undefined ? [expected.applicationId] : [expected.applicationId, roleId]);
        return Object.freeze(result.rows.map(adoption));
      },
      listCatalogSnapshots: async (applicationId: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, snapshot_id, source, permission_json, state, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision from k_nex_permission_catalog_snapshots where application_id=$1 order by snapshot_id`, [expected.applicationId]);
        return Object.freeze(result.rows.map(snapshot));
      },
      listExtensionGenerations: async (applicationId: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, 'extension' as owner_kind, null::varchar as owner_namespace, delivery_class as owner_delivery_class, extension_id as owner_extension_id, authorization_generation as owner_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 order by delivery_class, extension_id, authorization_generation`, [expected.applicationId]);
        return Object.freeze(result.rows.map(generation));
      },
      readBootstrapReceipt: async (applicationId: string) => {
        application(applicationId);
        const result = await session.query<Row>(`select application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, protected_baseline_version, protected_baseline_digest, authorization_revision, state from k_nex_authorization_bootstrap_receipts where application_id=$1`, [expected.applicationId]);
        return result.rows[0] ? receipt(result.rows[0]) : undefined;
      },
      listAudits: async (input: Readonly<{ readonly applicationId: string; readonly afterAuditId?: string; readonly limit: number }>) => {
        application(input.applicationId);
        if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000 || (input.afterAuditId !== undefined && typeof input.afterAuditId !== "string")) fail("MUTATION_INVALID", "Authorization audit page is invalid.");
        const result = await session.query<Row>(`select audit_id, application_id, environment, permission_id, outcome, reason, authorization_revision, lifecycle_revision, audit_json, created_at from k_nex_authorization_audit where application_id=$1 and environment=$2${input.afterAuditId === undefined ? "" : " and (created_at, audit_id) < (select created_at, audit_id from k_nex_authorization_audit where application_id=$1 and environment=$2 and audit_id=$3)"} order by created_at desc, audit_id desc limit $${input.afterAuditId === undefined ? 3 : 4}`,
          input.afterAuditId === undefined ? [expected.applicationId, expected.environment, input.limit] : [expected.applicationId, expected.environment, input.afterAuditId, input.limit]);
        return Object.freeze(result.rows.map(auditEntry));
      }
    });
  }

  private view(session: RuntimeExtensionSession, expected: AuthorizationExpectedRevision, current: AuthorizationState, mutations: AuthorizationStoreMutation[], bootstrap: boolean, reconciliation: boolean, onGrantRemoval: () => void): AuthorizationStoreTransaction {
    return Object.freeze({
      ...this.readView(session, expected),
      removeGrant: async (applicationId: string, grantId: string) => {
        sameApplication(expected, applicationId);
        if (typeof grantId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(grantId)) fail("MUTATION_INVALID", "Authorization grant ID is invalid.");
        const found = await session.query<Row>(`select application_id, grant_id, role_id, permission_id, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and grant_id=$2 for update`, [expected.applicationId, grantId]);
        if (found.rows[0] === undefined) return undefined;
        const existing = grant(found.rows[0]);
        if (!bootstrap && !reconciliation && protectedRoleIds.includes(existing.roleId as typeof protectedRoleIds[number])) fail("MUTATION_INVALID", "Protected role grants may not be removed.");
        if (reconciliation && (!isProtectedPlatformRoleGrant(existing) || isCurrentProtectedRoleBaselineGrantKey(existing))) fail("MUTATION_INVALID", "Protected baseline reconciliation may remove only superseded protected platform grants.");
        await session.query(`delete from k_nex_role_permission_grants where application_id=$1 and grant_id=$2`, [expected.applicationId, grantId]);
        onGrantRemoval();
        return existing;
      },
      write: async (value: AuthorizationStoreMutation) => {
        const mutation = await parseAuthorizationStoreMutation(value, this.subjectValidator);
        sameApplication(expected, mutationApplication(mutation));
        if (mutation.kind === "audit" && (mutation.audit.environment !== expected.environment || mutation.audit.authorizationRevision !== current.authorizationRevision || mutation.audit.lifecycleRevision !== current.lifecycleRevision)) {
          fail("REVISION_CONFLICT", "Authorization audit must bind the transaction's current revisions.");
        }
        if (!bootstrap && !reconciliation) await this.assertRegularMutationAllowed(session, mutation);
        if (reconciliation) this.assertProtectedBaselineReconciliationMutation(mutation, expected);
        if (mutation.kind === "assignment") await this.assertOwnerRevocationSafe(session, mutation.assignment);
        await this.write(session, mutation, reconciliation);
        mutations.push(mutation);
      }
    });
  }

  private async assertRegularMutationAllowed(session: RuntimeExtensionSession, mutation: AuthorizationStoreMutation): Promise<void> {
    if (mutation.kind === "bootstrap-receipt") {
      fail("MUTATION_INVALID", "Bootstrap receipts may be created only by the first-owner bootstrap transaction.");
    }
    if (mutation.kind === "role" && (mutation.role.protectedRoleId !== undefined || protectedRoleIds.includes(mutation.role.id as typeof protectedRoleIds[number]))) {
      fail("MUTATION_INVALID", "Protected role metadata may be created only by the first-owner bootstrap transaction.");
    }
    if (mutation.kind !== "grant") return;
    if (protectedRoleIds.includes(mutation.grant.roleId as typeof protectedRoleIds[number])) {
      fail("MUTATION_INVALID", "Protected role grants may be created only by the first-owner bootstrap transaction.");
    }
    const existing = await session.query<Row>(`select role_id from k_nex_role_permission_grants where application_id=$1 and grant_id=$2 for update`, [mutation.grant.applicationId, mutation.grant.id]);
    if (existing.rows[0] !== undefined && protectedRoleIds.includes(string(existing.rows[0].role_id) as typeof protectedRoleIds[number])) {
      fail("MUTATION_INVALID", "Protected role grants cannot be moved by reusing a grant ID.");
    }
  }

  private assertProtectedBaselineReconciliationMutation(mutation: AuthorizationStoreMutation, expected: AuthorizationExpectedRevision): void {
    if (mutation.kind === "bootstrap-receipt" || mutation.kind === "audit") return;
    if (mutation.kind === "grant" && isCurrentProtectedRoleBaselineGrant(mutation.grant, expected.authorizationRevision)) return;
    fail("MUTATION_INVALID", "Protected baseline reconciliation may change only protected platform grants, its receipt, and its audit.");
  }

  private assertProtectedBaselineReconciliationMutations(expected: AuthorizationExpectedRevision, mutations: readonly AuthorizationStoreMutation[]): void {
    const receipts = mutations.filter((mutation): mutation is Extract<AuthorizationStoreMutation, { readonly kind: "bootstrap-receipt" }> => mutation.kind === "bootstrap-receipt");
    const audits = mutations.filter((mutation): mutation is Extract<AuthorizationStoreMutation, { readonly kind: "audit" }> => mutation.kind === "audit");
    if (receipts.length !== 1 || audits.length !== 1 ||
      receipts[0]!.receipt.protectedBaselineVersion !== currentProtectedPlatformRoleBaselineRelease.version ||
      receipts[0]!.receipt.protectedBaselineDigest !== currentProtectedPlatformRoleBaselineRelease.digest ||
      receipts[0]!.receipt.authorizationRevision !== expected.authorizationRevision + 1 ||
      audits[0]!.audit.permissionId !== "system.roles.manage" || audits[0]!.audit.owner.kind !== "platform" || audits[0]!.audit.owner.namespace !== "system" || audits[0]!.audit.outcome !== "allow" ||
      audits[0]!.audit.operation !== protectedRoleBaselineReconciliationOperation || audits[0]!.audit.target !== protectedRoleBaselineReconciliationTarget) {
      fail("MUTATION_INVALID", "Protected baseline reconciliation requires its current receipt and exact audit.");
    }
  }

  private async assertProtectedBaselineReconciliationPrior(view: AuthorizationStoreTransaction, expected: AuthorizationExpectedRevision, expectedPrior: Readonly<{ readonly version: number; readonly digest: string }>): Promise<BootstrapReceipt> {
    const prior = recognizedProtectedPlatformRoleBaselineRelease(expectedPrior.version, expectedPrior.digest);
    if (prior === undefined || prior.version !== currentProtectedPlatformRoleBaselineRelease.version - 1) {
      fail("MUTATION_INVALID", "Protected role baseline predecessor is not recognized for reconciliation.");
    }
    const receipt = await view.readBootstrapReceipt(expected.applicationId);
    if (receipt === undefined || receipt.protectedBaselineVersion !== prior.version || receipt.protectedBaselineDigest !== prior.digest) {
      fail("REVISION_CONFLICT", "Protected role baseline receipt does not match the expected predecessor.");
    }
    await assertExactProtectedRoleBaselineState(view, expected, prior);
    return receipt;
  }

  private async assertProtectedBaselineReconciliationFinal(view: AuthorizationStoreTransaction, expected: AuthorizationExpectedRevision, priorReceipt: BootstrapReceipt): Promise<void> {
    await assertExactProtectedRoleBaselineState(view, expected, currentProtectedPlatformRoleBaselineRelease);
    const receipt = await view.readBootstrapReceipt(expected.applicationId);
    if (receipt === undefined || receipt.id !== priorReceipt.id || receipt.ownerRoleId !== priorReceipt.ownerRoleId ||
      receipt.ownerAssignmentId !== priorReceipt.ownerAssignmentId || receipt.ownerPrincipal.kind !== priorReceipt.ownerPrincipal.kind ||
      receipt.ownerPrincipal.id !== priorReceipt.ownerPrincipal.id || receipt.state !== priorReceipt.state ||
      receipt.protectedBaselineVersion !== currentProtectedPlatformRoleBaselineRelease.version ||
      receipt.protectedBaselineDigest !== currentProtectedPlatformRoleBaselineRelease.digest ||
      receipt.authorizationRevision !== expected.authorizationRevision + 1) {
      fail("REVISION_CONFLICT", "Protected role baseline reconciliation did not produce the exact compiled target receipt.");
    }
  }

  private async assertOwnerRevocationSafe(session: RuntimeExtensionSession, value: RoleAssignment): Promise<void> {
    const existing = await session.query<Row>(`select role_id, state from k_nex_role_assignments where application_id=$1 and assignment_id=$2 for update`, [value.applicationId, value.id]);
    const row = existing.rows[0];
    if (row === undefined || string(row.role_id) !== "system.role.owner" || string(row.state) !== "active" ||
      (value.roleId === "system.role.owner" && value.state === "active")) return;
    const others = await session.query<Row>(`select count(*)::int as count from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and state='active' and assignment_id<>$2`, [value.applicationId, value.id]);
    if (integer(others.rows[0]?.count) < 1) fail("REVISION_CONFLICT", "The last active owner assignment cannot be revoked.");
  }

  private async write(session: RuntimeExtensionSession, mutation: AuthorizationStoreMutation, reconciliation: boolean): Promise<void> {
    switch (mutation.kind) {
      case "role": return this.writeRole(session, mutation.role);
      case "grant": return this.writeGrant(session, mutation.grant);
      case "assignment": return this.writeAssignment(session, mutation.assignment);
      case "template-adoption": return this.writeAdoption(session, mutation.adoption);
      case "catalog-snapshot": return this.writeSnapshot(session, mutation.snapshot);
      case "extension-generation": return this.writeGeneration(session, mutation.generation);
      case "bootstrap-receipt": return this.writeReceipt(session, mutation.receipt, reconciliation);
      case "audit": return this.writeAudit(session, mutation.audit);
    }
  }

  private async writeRole(session: RuntimeExtensionSession, value: Role): Promise<void> {
    await session.query(`insert into k_nex_roles (application_id, role_id, label, description, protected_role_id, revision) values ($1,$2,$3,$4,$5,$6) on conflict (application_id, role_id) do update set label=excluded.label, description=excluded.description, protected_role_id=excluded.protected_role_id, revision=excluded.revision, updated_at=now()`, [value.applicationId, value.id, value.label, value.description ?? null, value.protectedRoleId ?? null, value.revision]);
  }

  private async writeGrant(session: RuntimeExtensionSession, value: RolePermissionGrant): Promise<void> {
    const ownerValues = value.owner.kind === "platform" ? ["platform", value.owner.namespace, null, null, null] : ["extension", null, value.owner.deliveryClass, value.owner.extensionId, value.owner.generation];
    await session.query(`insert into k_nex_role_permission_grants (application_id, grant_id, role_id, permission_id, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (application_id, grant_id) do update set role_id=excluded.role_id, permission_id=excluded.permission_id, owner_kind=excluded.owner_kind, owner_namespace=excluded.owner_namespace, owner_delivery_class=excluded.owner_delivery_class, owner_extension_id=excluded.owner_extension_id, owner_generation=excluded.owner_generation, revision=excluded.revision, updated_at=now()`, [value.applicationId, value.id, value.roleId, value.permissionId, ...ownerValues, value.revision]);
  }

  private async writeAssignment(session: RuntimeExtensionSession, value: RoleAssignment): Promise<void> {
    await session.query(`insert into k_nex_role_assignments (application_id, assignment_id, role_id, subject_kind, subject_id, state, revision) values ($1,$2,$3,$4,$5,$6,$7) on conflict (application_id, assignment_id) do update set role_id=excluded.role_id, subject_kind=excluded.subject_kind, subject_id=excluded.subject_id, state=excluded.state, revision=excluded.revision, updated_at=now()`, [value.applicationId, value.id, value.roleId, value.principal.kind, value.principal.id, value.state, value.revision]);
  }

  private async writeAdoption(session: RuntimeExtensionSession, value: TemplateAdoption): Promise<void> {
    await session.query(`insert into k_nex_role_template_adoptions (application_id, adoption_id, role_id, template_id, publisher_delivery_class, publisher_extension_id, owner_delivery_class, owner_extension_id, owner_generation, template_version, old_baseline_permission_ids, digest_algorithm, old_baseline_digest, kind, state, revision) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16) on conflict (application_id, adoption_id) do update set role_id=excluded.role_id, template_id=excluded.template_id, publisher_delivery_class=excluded.publisher_delivery_class, publisher_extension_id=excluded.publisher_extension_id, owner_delivery_class=excluded.owner_delivery_class, owner_extension_id=excluded.owner_extension_id, owner_generation=excluded.owner_generation, template_version=excluded.template_version, old_baseline_permission_ids=excluded.old_baseline_permission_ids, digest_algorithm=excluded.digest_algorithm, old_baseline_digest=excluded.old_baseline_digest, kind=excluded.kind, state=excluded.state, revision=excluded.revision, updated_at=now()`, [value.applicationId, value.id, value.roleId ?? null, value.templateId, value.publisher.deliveryClass, value.publisher.extensionId, value.owner.deliveryClass, value.owner.extensionId, value.owner.generation, value.templateVersion, canonicalJson(value.oldBaselinePermissionIds), value.digestAlgorithm, value.oldBaselineDigest, value.kind, value.state, value.revision]);
  }

  private async writeSnapshot(session: RuntimeExtensionSession, value: PermissionCatalogSnapshot): Promise<void> {
    const ownerValues = value.owner === undefined ? [null, null, null, null, null] : value.owner.kind === "platform" ? ["platform", value.owner.namespace, null, null, null] : ["extension", null, value.owner.deliveryClass, value.owner.extensionId, value.owner.generation];
    await session.query(`insert into k_nex_permission_catalog_snapshots (application_id, snapshot_id, source, permission_json, state, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, revision) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11) on conflict (application_id, snapshot_id) do update set source=excluded.source, permission_json=excluded.permission_json, state=excluded.state, owner_kind=excluded.owner_kind, owner_namespace=excluded.owner_namespace, owner_delivery_class=excluded.owner_delivery_class, owner_extension_id=excluded.owner_extension_id, owner_generation=excluded.owner_generation, revision=excluded.revision, updated_at=now()`, [value.applicationId, value.id, value.source, canonicalJson(value.permission), value.state, ...ownerValues, value.revision]);
  }

  private async writeGeneration(session: RuntimeExtensionSession, value: ExtensionAuthorizationGeneration): Promise<void> {
    await session.query(`insert into k_nex_extension_authorization_generations (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) on conflict (application_id, delivery_class, extension_id, authorization_generation) do update set runtime_generation_ids=excluded.runtime_generation_ids, state=excluded.state, authorization_revision=excluded.authorization_revision, lifecycle_revision=excluded.lifecycle_revision, updated_at=now()`, [value.applicationId, value.owner.deliveryClass, value.owner.extensionId, value.owner.generation, canonicalJson(value.runtimeGenerationIds), value.state, value.authorizationRevision, value.lifecycleRevision]);
  }

  private async writeReceipt(session: RuntimeExtensionSession, value: BootstrapReceipt, reconciliation: boolean): Promise<void> {
    if (reconciliation) {
      const owner = await session.query<Row>(`select assignment_id from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and subject_kind='user' and state='active' order by assignment_id limit 1 for update`, [value.applicationId]);
      if (owner.rows[0] === undefined) fail("REVISION_CONFLICT", "Protected baseline reconciliation requires an active human owner.");
    } else {
      const assignment = await session.query<Row>(`select role_id, subject_kind, subject_id, state from k_nex_role_assignments where application_id=$1 and assignment_id=$2 for update`, [value.applicationId, value.ownerAssignmentId]);
      const row = assignment.rows[0];
      if (row === undefined || string(row.role_id) !== value.ownerRoleId || string(row.subject_kind) !== value.ownerPrincipal.kind ||
        string(row.subject_id) !== value.ownerPrincipal.id || string(row.state) !== "active") {
        fail("REVISION_CONFLICT", "Bootstrap receipt requires its exact active owner assignment.");
      }
    }
    const result = await session.query<Row>(reconciliation
      ? `insert into k_nex_authorization_bootstrap_receipts (application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, protected_baseline_version, protected_baseline_digest, authorization_revision, state) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (application_id) do update set protected_baseline_version=excluded.protected_baseline_version, protected_baseline_digest=excluded.protected_baseline_digest, authorization_revision=excluded.authorization_revision where k_nex_authorization_bootstrap_receipts.receipt_id=excluded.receipt_id and k_nex_authorization_bootstrap_receipts.owner_role_id=excluded.owner_role_id and k_nex_authorization_bootstrap_receipts.owner_assignment_id=excluded.owner_assignment_id and k_nex_authorization_bootstrap_receipts.owner_principal_kind=excluded.owner_principal_kind and k_nex_authorization_bootstrap_receipts.owner_principal_id=excluded.owner_principal_id and k_nex_authorization_bootstrap_receipts.state=excluded.state returning receipt_id`
      : `insert into k_nex_authorization_bootstrap_receipts (application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, protected_baseline_version, protected_baseline_digest, authorization_revision, state) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning receipt_id`,
    [value.applicationId, value.id, value.ownerRoleId, value.ownerAssignmentId, value.ownerPrincipal.kind, value.ownerPrincipal.id, value.protectedBaselineVersion, value.protectedBaselineDigest, value.authorizationRevision, value.state]);
    if (result.rows.length !== 1) fail("REVISION_CONFLICT", "Protected baseline receipt cannot change its first-owner identity.");
  }

  private async writeAudit(session: RuntimeExtensionSession, value: AuthorizationDecisionAudit): Promise<void> {
    await session.query(`insert into k_nex_authorization_audit (audit_id, application_id, environment, permission_id, outcome, reason, authorization_revision, lifecycle_revision, audit_json) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [value.auditId, value.applicationId, value.environment, value.permissionId, value.outcome, value.reason, value.authorizationRevision, value.lifecycleRevision, canonicalJson(value)]);
  }

  private async advance(session: RuntimeExtensionSession, current: AuthorizationState, changes: RevisionChanges): Promise<AuthorizationState> {
    const nextAuthorization = current.authorizationRevision + (changes.authorization ? 1 : 0);
    const nextLifecycle = current.lifecycleRevision + (changes.lifecycle ? 1 : 0);
    const result = await session.query<Row>(`update k_nex_authorization_state set authorization_revision=$2, lifecycle_revision=$3, updated_at=now() where application_id=$1 and authorization_revision=$4 and lifecycle_revision=$5 returning application_id, authorization_revision, lifecycle_revision`, [current.applicationId, nextAuthorization, nextLifecycle, current.authorizationRevision, current.lifecycleRevision]);
    if (result.rows.length !== 1) fail("REVISION_CONFLICT", "Authorization state revision changed before commit.");
    return state(result.rows[0]!, current.environment);
  }
}
