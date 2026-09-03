import {
  AuthorizationDecisionAuditSchema,
  protectedRoleIds,
  type AuthorizationDecisionAudit,
  type BootstrapReceipt,
  type RolePermissionGrant
} from "@k-nex/contracts";

import {
  AuthorizationStoreError,
  parseAuthorizationExpectedRevision,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreReadTransaction,
  type AuthorizationStoreTransaction,
  type AuthorizationTransactionOutcome,
  type ProtectedRoleBaselineReconciliationStore
} from "./authorization-store.js";
import {
  currentProtectedPlatformRoleBaselineRelease,
  protectedPlatformRoleLabels,
  recognizedProtectedPlatformRoleBaselineRelease,
  type ProtectedPlatformRoleBaselineRelease
} from "./protected-role-baselines.js";
import { protectedRoleBootstrapId } from "./protected-role-bootstrap.js";

export const protectedRoleBaselineReconciliationOperation = "reconcile-protected-role-baseline";
export const protectedRoleBaselineReconciliationTarget = "system.protected-role-baselines";

export interface ReconcileProtectedRoleBaselineInput {
  readonly store: AuthorizationStore & ProtectedRoleBaselineReconciliationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly expectedPrior: Readonly<{ readonly version: number; readonly digest: string }>;
  /** A current-authority decision audit from the trusted release operator. */
  readonly audit: unknown;
}

export interface EnsureProtectedRoleBaselineReleaseInput {
  readonly store: AuthorizationStore & ProtectedRoleBaselineReconciliationStore;
  readonly applicationId: string;
  readonly environment: string;
  readonly audit: (state: AuthorizationExpectedRevision) => unknown;
}

/** Release/startup gate: upgrades the sole compiled predecessor or fails closed. */
export async function ensureProtectedRoleBaselineRelease(
  input: EnsureProtectedRoleBaselineReleaseInput
): Promise<"uninitialized" | "current" | "upgraded"> {
  const state = await input.store.readState(input.applicationId, input.environment);
  if (state === undefined) return "uninitialized";
  const receipt = await input.store.readProtectedRoleBaselineReceipt(input.applicationId);
  if (receipt === undefined) fail("REVISION_CONFLICT", "Initialized authorization state has no protected baseline receipt.");
  if (receipt.protectedBaselineVersion === currentProtectedPlatformRoleBaselineRelease.version
    && receipt.protectedBaselineDigest === currentProtectedPlatformRoleBaselineRelease.digest) return "current";
  const prior = recognizedProtectedPlatformRoleBaselineRelease(receipt.protectedBaselineVersion, receipt.protectedBaselineDigest);
  if (prior === undefined || prior.version >= currentProtectedPlatformRoleBaselineRelease.version) {
    fail("REVISION_CONFLICT", "Stored protected role baseline is not the compiled release predecessor.");
  }
  const expected = parseAuthorizationExpectedRevision({
    applicationId: state.applicationId,
    environment: state.environment,
    authorizationRevision: state.authorizationRevision,
    lifecycleRevision: state.lifecycleRevision
  });
  await reconcileProtectedRoleBaseline({
    store: input.store,
    expected,
    expectedPrior: { version: prior.version, digest: prior.digest },
    audit: input.audit(expected)
  });
  return "upgraded";
}

/**
 * Reconciles only a recognized compiled predecessor to the compiled current
 * protected baseline. Customer administration never receives this capability.
 */
export async function reconcileProtectedRoleBaseline(
  input: ReconcileProtectedRoleBaselineInput
): Promise<AuthorizationTransactionOutcome<BootstrapReceipt>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const prior = recognizedProtectedPlatformRoleBaselineRelease(input.expectedPrior.version, input.expectedPrior.digest);
  if (prior === undefined || prior.version >= currentProtectedPlatformRoleBaselineRelease.version) {
    fail("MUTATION_INVALID", "Protected role baseline predecessor is not recognized for reconciliation.");
  }
  const audit = reconciliationAudit(input.audit, expected);

  return input.store.reconcileProtectedRoleBaselineTransaction(expected, input.expectedPrior, async (transaction) => {
    const receipt = await transaction.readBootstrapReceipt(expected.applicationId);
    if (receipt === undefined || receipt.protectedBaselineVersion !== prior.version || receipt.protectedBaselineDigest !== prior.digest) {
      fail("REVISION_CONFLICT", "Protected role baseline receipt does not match the expected predecessor.");
    }
    await assertExactProtectedRoleBaselineState(transaction, expected, prior);

    const current = currentProtectedPlatformRoleBaselineRelease;
    const currentKeys = grantKeys(current);
    const existing = await transaction.listGrants(expected.applicationId);
    for (const value of existing.filter((grant) => protectedRoleIds.includes(grant.roleId as typeof protectedRoleIds[number]))) {
      if (!currentKeys.has(grantKey(value.roleId, value.permissionId))) {
        await transaction.removeGrant(expected.applicationId, value.id);
      }
    }
    const existingKeys = new Set(existing.map((grant) => grantKey(grant.roleId, grant.permissionId)));
    for (const baseline of current.baselines) {
      for (const permissionId of baseline.permissionIds) {
        if (existingKeys.has(grantKey(baseline.id, permissionId))) continue;
        await transaction.write({ kind: "grant", grant: {
          schemaVersion: 1,
          id: protectedRoleBootstrapId(expected.applicationId, "grant", baseline.id, permissionId),
          applicationId: expected.applicationId,
          roleId: baseline.id,
          permissionId,
          owner: { kind: "platform", namespace: "system" },
          revision: expected.authorizationRevision + 1
        } });
      }
    }

    const nextReceipt: BootstrapReceipt = {
      ...receipt,
      protectedBaselineVersion: current.version,
      protectedBaselineDigest: current.digest,
      authorizationRevision: expected.authorizationRevision + 1
    };
    await transaction.write({ kind: "bootstrap-receipt", receipt: nextReceipt });
    await transaction.write({ kind: "audit", audit });
    return nextReceipt;
  });
}

export async function assertExactProtectedRoleBaselineState(
  transaction: AuthorizationStoreReadTransaction,
  expected: AuthorizationExpectedRevision,
  release: ProtectedPlatformRoleBaselineRelease
): Promise<void> {
  const roles = await transaction.listRoles(expected.applicationId);
  const protectedRoles = roles.filter((role) => protectedRoleIds.includes(role.id as typeof protectedRoleIds[number]));
  if (protectedRoles.length !== release.baselines.length || protectedRoles.some((role) =>
    role.applicationId !== expected.applicationId || role.protectedRoleId !== role.id || role.label !== protectedPlatformRoleLabels[role.id as keyof typeof protectedPlatformRoleLabels]
  )) {
    fail("REVISION_CONFLICT", "Protected role metadata does not exactly match the recognized predecessor.");
  }
  const protectedRoleIdsSeen = new Set(protectedRoles.map((role) => role.id));
  if (protectedRoleIdsSeen.size !== release.baselines.length || release.baselines.some((baseline) => !protectedRoleIdsSeen.has(baseline.id))) {
    fail("REVISION_CONFLICT", "Protected role metadata does not exactly match the recognized predecessor.");
  }

  const expectedKeys = grantKeys(release);
  const grants = (await transaction.listGrants(expected.applicationId)).filter((grant) => protectedRoleIds.includes(grant.roleId as typeof protectedRoleIds[number]));
  const actualKeys = new Set(grants.map((grant) => grantKey(grant.roleId, grant.permissionId)));
  if (grants.length !== expectedKeys.size || actualKeys.size !== expectedKeys.size || grants.some((grant) => !isExactProtectedGrant(grant, expected.applicationId, expectedKeys))) {
    fail("REVISION_CONFLICT", "Protected role grants do not exactly match the recognized predecessor.");
  }

  const owners = await transaction.listAssignments(expected.applicationId);
  if (!owners.some((assignment) => assignment.roleId === "system.role.owner" && assignment.state === "active" && assignment.principal.kind === "user")) {
    fail("REVISION_CONFLICT", "Protected role reconciliation must preserve an active human owner.");
  }
}

function reconciliationAudit(value: unknown, expected: AuthorizationExpectedRevision): AuthorizationDecisionAudit {
  const parsed = AuthorizationDecisionAuditSchema.safeParse(value);
  if (!parsed.success || parsed.data.applicationId !== expected.applicationId || parsed.data.environment !== expected.environment ||
    parsed.data.authorizationRevision !== expected.authorizationRevision || parsed.data.lifecycleRevision !== expected.lifecycleRevision ||
    parsed.data.permissionId !== "system.roles.manage" || parsed.data.owner.kind !== "platform" || parsed.data.owner.namespace !== "system" ||
    parsed.data.outcome !== "allow" || parsed.data.operation !== protectedRoleBaselineReconciliationOperation || parsed.data.target !== protectedRoleBaselineReconciliationTarget) {
    fail("MUTATION_INVALID", "Protected role baseline reconciliation audit is invalid.");
  }
  return parsed.data;
}

function grantKeys(release: ProtectedPlatformRoleBaselineRelease): ReadonlySet<string> {
  return new Set(release.baselines.flatMap((baseline) => baseline.permissionIds.map((permissionId) => grantKey(baseline.id, permissionId))));
}

function isExactProtectedGrant(grant: RolePermissionGrant, applicationId: string, expectedKeys: ReadonlySet<string>): boolean {
  return isProtectedPlatformRoleGrant(grant) && grant.applicationId === applicationId &&
    expectedKeys.has(grantKey(grant.roleId, grant.permissionId)) &&
    grant.id === protectedRoleBootstrapId(applicationId, "grant", grant.roleId, grant.permissionId);
}

/** Adapter guard for the dedicated reconciliation capability. */
export function isProtectedPlatformRoleGrant(grant: RolePermissionGrant): boolean {
  return protectedRoleIds.includes(grant.roleId as typeof protectedRoleIds[number]) && grant.owner.kind === "platform" && grant.owner.namespace === "system";
}

/** Adapter guard: only the compiled current target may be added by reconciliation. */
export function isCurrentProtectedRoleBaselineGrant(grant: RolePermissionGrant, expectedAuthorizationRevision: number): boolean {
  return isCurrentProtectedRoleBaselineGrantKey(grant) &&
    grant.revision === expectedAuthorizationRevision + 1;
}

/** Adapter guard: compiled target grants must never be removed during reconciliation. */
export function isCurrentProtectedRoleBaselineGrantKey(grant: RolePermissionGrant): boolean {
  return isExactProtectedGrant(grant, grant.applicationId, grantKeys(currentProtectedPlatformRoleBaselineRelease));
}

function grantKey(roleId: string, permissionId: string): string {
  return `${roleId}\u0000${permissionId}`;
}

function fail(code: "MUTATION_INVALID" | "REVISION_CONFLICT", message: string): never {
  throw new AuthorizationStoreError(code, message);
}
