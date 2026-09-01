import { createHash } from "node:crypto";

import {
  AuthorizationPermissionIdSchema,
  ProtectedRoleBaselineSchema,
  canonicalJson,
  protectedRoleIds,
  templateBaselineDigestAlgorithm,
  type ProtectedRoleBaseline,
  type ProtectedRoleId,
  type TemplateAdoption
} from "@k-nex/contracts";

import { platformPermissionDescriptors } from "./authorization-registry.js";

export class TemplateBaselineError extends Error {
  constructor(readonly code: "INVALID_BASELINE" | "DIGEST_MISMATCH", message: string) {
    super(message);
    this.name = "TemplateBaselineError";
  }
}

export interface TemplateBaselineComparison {
  readonly oldBaselinePermissionIds: readonly string[];
  readonly currentOwnerPermissionIds: readonly string[];
  readonly newBaselinePermissionIds: readonly string[];
  readonly customerAddedPermissionIds: readonly string[];
  readonly customerRemovedPermissionIds: readonly string[];
  readonly templateAddedPermissionIds: readonly string[];
  readonly templateRemovedPermissionIds: readonly string[];
}

export interface CompareTemplateBaselineInput {
  readonly stored: Pick<TemplateAdoption, "digestAlgorithm" | "oldBaselineDigest" | "oldBaselinePermissionIds">;
  /** Permissions currently granted to the role for the adopted template's owner only. */
  readonly currentOwnerPermissionIds: readonly string[];
  readonly newBaselinePermissionIds: readonly string[];
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const platformPermissionIds = new Set(platformPermissionDescriptors.map(({ id }) => id));

function canonicalPermissionIds(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.some((permissionId) => !AuthorizationPermissionIdSchema.safeParse(permissionId).success)) {
    throw new TemplateBaselineError("INVALID_BASELINE", "Permission baseline contains an invalid permission ID.");
  }
  return Object.freeze([...new Set(value)].sort(compare));
}

function isCanonicalPermissionIds(value: readonly string[], canonical: readonly string[]): boolean {
  return value.length === canonical.length && value.every((permissionId, index) => permissionId === canonical[index]);
}

function protectedBaseline(id: ProtectedRoleId, permissionIds: readonly string[]): ProtectedRoleBaseline {
  const parsed = ProtectedRoleBaselineSchema.safeParse({ schemaVersion: 1, id, permissionIds: canonicalPermissionIds(permissionIds) });
  if (!parsed.success || parsed.data.permissionIds.some((permissionId) => !platformPermissionIds.has(permissionId))) {
    throw new TemplateBaselineError("INVALID_BASELINE", `Protected role ${id} has an invalid platform baseline.`);
  }
  return Object.freeze({ ...parsed.data, permissionIds: Object.freeze([...parsed.data.permissionIds]) as unknown as string[] });
}

const allPlatformPermissionIds = Object.freeze([...platformPermissionIds].sort(compare));

/** Immutable platform-owned baselines; labels are deliberately absent from authority. */
export const protectedPlatformRoleBaselines: readonly ProtectedRoleBaseline[] = Object.freeze([
  protectedBaseline("system.role.owner", allPlatformPermissionIds),
  protectedBaseline("system.role.security-admin", [
    "system.authorization.audit.read",
    "system.permissions.read",
    "system.role-assignments.manage",
    "system.role-assignments.read",
    "system.roles.manage",
    "system.roles.read"
  ]),
  protectedBaseline("system.role.extension-admin", [
    "system.extensions.deploy-platform-plugin",
    "system.extensions.disable",
    "system.extensions.enable",
    "system.extensions.install-hot",
    "system.extensions.plan",
    "system.extensions.quarantine",
    "system.extensions.read",
    "system.extensions.rollback",
    "system.extensions.uninstall",
    "system.extensions.update",
    "system.permissions.read"
  ]),
  protectedBaseline("system.role.user-admin", [
    "system.role-assignments.manage",
    "system.role-assignments.read",
    "system.roles.read"
  ]),
  protectedBaseline("system.role.auditor", [
    "system.authorization.audit.read",
    "system.permissions.read",
    "system.role-assignments.read",
    "system.roles.read"
  ])
]);

if (protectedPlatformRoleBaselines.length !== protectedRoleIds.length ||
  protectedPlatformRoleBaselines.some((baseline, index) => baseline.id !== protectedRoleIds[index])) {
  throw new TemplateBaselineError("INVALID_BASELINE", "Protected role baselines must cover each protected role exactly once.");
}

/** SHA-256 over the canonical JSON representation of a sorted unique permission baseline. */
export function digestTemplateBaseline(permissionIds: readonly string[]): string {
  return `sha256:${createHash("sha256").update(canonicalJson(canonicalPermissionIds(permissionIds))).digest("hex")}`;
}

function difference(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightIds = new Set(right);
  return Object.freeze(left.filter((permissionId) => !rightIds.has(permissionId)));
}

/**
 * Compares an adopted template's verified stored baseline with the current role's
 * owner-scoped grants and a new template baseline. No role mutation is performed.
 */
export function compareTemplateBaseline(input: CompareTemplateBaselineInput): TemplateBaselineComparison {
  const oldBaselinePermissionIds = canonicalPermissionIds(input.stored.oldBaselinePermissionIds);
  if (!isCanonicalPermissionIds(input.stored.oldBaselinePermissionIds, oldBaselinePermissionIds) ||
    input.stored.digestAlgorithm !== templateBaselineDigestAlgorithm ||
    digestTemplateBaseline(oldBaselinePermissionIds) !== input.stored.oldBaselineDigest) {
    throw new TemplateBaselineError("DIGEST_MISMATCH", "Stored template baseline digest does not match its canonical permissions.");
  }
  const currentOwnerPermissionIds = canonicalPermissionIds(input.currentOwnerPermissionIds);
  const newBaselinePermissionIds = canonicalPermissionIds(input.newBaselinePermissionIds);
  return Object.freeze({
    oldBaselinePermissionIds,
    currentOwnerPermissionIds,
    newBaselinePermissionIds,
    customerAddedPermissionIds: difference(currentOwnerPermissionIds, oldBaselinePermissionIds),
    customerRemovedPermissionIds: difference(oldBaselinePermissionIds, currentOwnerPermissionIds),
    templateAddedPermissionIds: difference(newBaselinePermissionIds, oldBaselinePermissionIds),
    templateRemovedPermissionIds: difference(oldBaselinePermissionIds, newBaselinePermissionIds)
  });
}
