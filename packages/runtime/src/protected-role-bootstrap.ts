import { createHash } from "node:crypto";

import { AuthorizationSubjectSchema, canonicalJson, type BootstrapReceipt, type ProtectedRoleId } from "@k-nex/contracts";

import {
  AuthorizationStoreError,
  parseAuthorizationExpectedRevision,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreMutation,
  type AuthorizationTransactionOutcome
} from "./authorization-store.js";
import { protectedPlatformRoleBaselines } from "./protected-role-baselines.js";

export interface BootstrapFirstOwnerInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly firstOwner: unknown;
}

/** Creates the permanently single-use protected-role baseline and its first owner. */
export async function bootstrapFirstOwner(input: BootstrapFirstOwnerInput): Promise<AuthorizationTransactionOutcome<BootstrapReceipt>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  if (expected.authorizationRevision !== 0 || expected.lifecycleRevision !== 0) {
    fail("REVISION_CONFLICT", "First-owner bootstrap requires authorization and lifecycle revision 0.");
  }
  const owner = AuthorizationSubjectSchema.safeParse(input.firstOwner);
  if (!owner.success || owner.data.kind !== "user") {
    fail("SUBJECT_INVALID", "First-owner bootstrap requires a valid user principal.");
  }

  const { applicationId } = expected;
  const ownerAssignmentId = bootstrapId(applicationId, "owner-assignment", owner.data.id);
  const receipt: BootstrapReceipt = {
    schemaVersion: 1,
    id: bootstrapId(applicationId, "receipt", ownerAssignmentId),
    applicationId,
    ownerRoleId: "system.role.owner",
    ownerAssignmentId,
    ownerPrincipal: owner.data,
    authorizationRevision: 1,
    state: "committed"
  };

  return input.store.bootstrapFirstOwnerTransaction(expected, async (transaction) => {
    for (const baseline of protectedPlatformRoleBaselines) {
      await transaction.write({ kind: "role", role: {
        schemaVersion: 1,
        id: baseline.id,
        applicationId,
        label: protectedRoleLabels[baseline.id],
        protectedRoleId: baseline.id,
        revision: 1
      } });
      for (const permissionId of baseline.permissionIds) {
        await transaction.write({ kind: "grant", grant: {
          schemaVersion: 1,
          id: bootstrapId(applicationId, "grant", baseline.id, permissionId),
          applicationId,
          roleId: baseline.id,
          permissionId,
          owner: { kind: "platform", namespace: "system" },
          revision: 1
        } });
      }
    }
    await transaction.write({ kind: "assignment", assignment: {
      schemaVersion: 1,
      id: ownerAssignmentId,
      applicationId,
      roleId: "system.role.owner",
      principal: owner.data,
      state: "active",
      revision: 1
    } });
    await transaction.write({ kind: "bootstrap-receipt", receipt });
    return receipt;
  });
}

/** Validates the complete, authority-bearing first-owner bootstrap mutation set. */
export function assertFirstOwnerBootstrapMutations(expected: AuthorizationExpectedRevision, mutations: readonly AuthorizationStoreMutation[]): void {
  if (expected.authorizationRevision !== 0 || expected.lifecycleRevision !== 0) {
    fail("REVISION_CONFLICT", "First-owner bootstrap requires authorization and lifecycle revision 0.");
  }
  const roles = mutations.filter((mutation): mutation is Extract<AuthorizationStoreMutation, { readonly kind: "role" }> => mutation.kind === "role");
  const grants = mutations.filter((mutation): mutation is Extract<AuthorizationStoreMutation, { readonly kind: "grant" }> => mutation.kind === "grant");
  const assignments = mutations.filter((mutation): mutation is Extract<AuthorizationStoreMutation, { readonly kind: "assignment" }> => mutation.kind === "assignment");
  const receipts = mutations.filter((mutation): mutation is Extract<AuthorizationStoreMutation, { readonly kind: "bootstrap-receipt" }> => mutation.kind === "bootstrap-receipt");
  if (mutations.length !== roles.length + grants.length + assignments.length + receipts.length ||
    roles.length !== protectedPlatformRoleBaselines.length || assignments.length !== 1 || receipts.length !== 1) {
    fail("MUTATION_INVALID", "First-owner bootstrap must contain only the exact protected baseline, one owner assignment, and one receipt.");
  }

  const rolesById = new Map(roles.map(({ role }) => [role.id, role]));
  if (rolesById.size !== protectedPlatformRoleBaselines.length || roles.some(({ role }) => role.applicationId !== expected.applicationId || role.revision !== 1)) {
    fail("MUTATION_INVALID", "First-owner bootstrap roles are invalid.");
  }
  for (const baseline of protectedPlatformRoleBaselines) {
    const role = rolesById.get(baseline.id);
    if (role === undefined || role.protectedRoleId !== baseline.id || role.label !== protectedRoleLabels[baseline.id]) {
      fail("MUTATION_INVALID", "First-owner bootstrap must create each protected role exactly once.");
    }
  }

  const expectedGrantKeys = new Set(protectedPlatformRoleBaselines.flatMap((baseline) => baseline.permissionIds.map((permissionId) => `${baseline.id}\u0000${permissionId}`)));
  const actualGrantKeys = new Set(grants.map(({ grant }) => `${grant.roleId}\u0000${grant.permissionId}`));
  const grantIds = new Set(grants.map(({ grant }) => grant.id));
  if (grants.length !== expectedGrantKeys.size || actualGrantKeys.size !== expectedGrantKeys.size || grantIds.size !== grants.length ||
    grants.some(({ grant }) => grant.applicationId !== expected.applicationId || grant.id !== bootstrapId(expected.applicationId, "grant", grant.roleId, grant.permissionId) || grant.revision !== 1 || grant.owner.kind !== "platform" || grant.owner.namespace !== "system" || !expectedGrantKeys.has(`${grant.roleId}\u0000${grant.permissionId}`))) {
    fail("MUTATION_INVALID", "First-owner bootstrap grants must exactly match the protected platform baselines.");
  }

  const assignment = assignments[0]!.assignment;
  const receipt = receipts[0]!.receipt;
  if (assignment.applicationId !== expected.applicationId || assignment.id !== bootstrapId(expected.applicationId, "owner-assignment", assignment.principal.id) || assignment.roleId !== "system.role.owner" || assignment.principal.kind !== "user" || assignment.state !== "active" || assignment.revision !== 1 ||
    receipt.applicationId !== expected.applicationId || receipt.id !== bootstrapId(expected.applicationId, "receipt", assignment.id) || receipt.authorizationRevision !== 1 || receipt.ownerRoleId !== assignment.roleId || receipt.ownerAssignmentId !== assignment.id || receipt.ownerPrincipal.kind !== assignment.principal.kind || receipt.ownerPrincipal.id !== assignment.principal.id) {
    fail("MUTATION_INVALID", "First-owner bootstrap receipt must bind its one active owner assignment at revision 1.");
  }
}

function bootstrapId(applicationId: string, kind: string, ...parts: readonly string[]): string {
  const digest = createHash("sha256").update(canonicalJson([applicationId, kind, ...parts])).digest("hex");
  return `bootstrap.${kind}.${digest}`;
}

const protectedRoleLabels: Readonly<Record<ProtectedRoleId, string>> = {
  "system.role.owner": "Owner",
  "system.role.security-admin": "Security administrator",
  "system.role.extension-admin": "Extension administrator",
  "system.role.user-admin": "User administrator",
  "system.role.auditor": "Auditor"
} as const;

function fail(code: "MUTATION_INVALID" | "REVISION_CONFLICT" | "SUBJECT_INVALID", message: string): never {
  throw new AuthorizationStoreError(code, message);
}
