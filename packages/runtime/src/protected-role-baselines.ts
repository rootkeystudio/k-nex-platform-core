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

export interface ProtectedPlatformRoleBaselineRelease {
  readonly version: number;
  readonly digest: string;
  readonly baselines: readonly ProtectedRoleBaseline[];
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

const protectedPlatformRoleLabels = Object.freeze({
  "system.role.owner": "Owner",
  "system.role.security-admin": "Security administrator",
  "system.role.extension-admin": "Extension administrator",
  "system.role.user-admin": "User administrator",
  "system.role.auditor": "Auditor"
} satisfies Record<ProtectedRoleId, string>);

export { protectedPlatformRoleLabels };

/** The last shipped protected baseline, retained only to recognize a safe upgrade source. */
const protectedPlatformRoleBaselinesV1: readonly ProtectedRoleBaseline[] = Object.freeze([
  protectedBaseline("system.role.owner", [
    "system.authorization.audit.read",
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
    "system.permissions.read",
    "system.role-assignments.manage",
    "system.role-assignments.read",
    "system.roles.manage",
    "system.roles.read",
    "system.settings.manage",
    "system.settings.read",
    "system.themes.manage"
  ]),
  protectedBaseline("system.role.security-admin", [
    "system.authorization.audit.read",
    "system.permissions.read",
    "system.role-assignments.manage",
    "system.role-assignments.read",
    "system.roles.manage",
    "system.roles.read"
  ]),
  protectedBaseline("system.role.extension-admin", [
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
    "system.permissions.read",
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

function digestProtectedPlatformRoleBaselines(version: number, baselines: readonly ProtectedRoleBaseline[]): string {
  return `sha256:${createHash("sha256").update(canonicalJson({ schemaVersion: 1, version, baselines })).digest("hex")}`;
}

function baselineRelease(version: number, baselines: readonly ProtectedRoleBaseline[]): ProtectedPlatformRoleBaselineRelease {
  if (!Number.isSafeInteger(version) || version < 1 ||
    baselines.length !== protectedRoleIds.length || baselines.some((baseline, index) => baseline.id !== protectedRoleIds[index])) {
    throw new TemplateBaselineError("INVALID_BASELINE", "Protected role baseline release is invalid.");
  }
  return Object.freeze({ version, digest: digestProtectedPlatformRoleBaselines(version, baselines), baselines });
}

/** Compiled current target; callers cannot provide protected baseline content. */
export const currentProtectedPlatformRoleBaselineRelease = baselineRelease(2, protectedPlatformRoleBaselines);

/** Static recognized sources only. Unknown versions or digests fail closed. */
export const recognizedProtectedPlatformRoleBaselineReleases: readonly ProtectedPlatformRoleBaselineRelease[] = Object.freeze([
  baselineRelease(1, protectedPlatformRoleBaselinesV1),
  currentProtectedPlatformRoleBaselineRelease
]);

export function recognizedProtectedPlatformRoleBaselineRelease(version: number, digest: string): ProtectedPlatformRoleBaselineRelease | undefined {
  return recognizedProtectedPlatformRoleBaselineReleases.find((release) => release.version === version && release.digest === digest);
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
