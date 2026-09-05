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

function protectedBaseline(id: ProtectedRoleId, permissionIds: readonly string[], knownPermissionIds = platformPermissionIds): ProtectedRoleBaseline {
  const parsed = ProtectedRoleBaselineSchema.safeParse({ schemaVersion: 1, id, permissionIds: canonicalPermissionIds(permissionIds) });
  if (!parsed.success || parsed.data.permissionIds.some((permissionId) => !knownPermissionIds.has(permissionId))) {
    throw new TemplateBaselineError("INVALID_BASELINE", `Protected role ${id} has an invalid platform baseline.`);
  }
  return Object.freeze({ ...parsed.data, permissionIds: Object.freeze([...parsed.data.permissionIds]) as unknown as string[] });
}

const allPlatformPermissionIds = Object.freeze([...platformPermissionIds].sort(compare));
/** Exact Phase 11 v3 permission universe. Never derive history from the current registry. */
const allPlatformPermissionIdsV3 = Object.freeze([
  "system.authorization.audit.read",
  "system.catalog.refresh",
  "system.extensions.deploy-platform-plugin",
  "system.extensions.disable",
  "system.extensions.enable",
  "system.extensions.install-live",
  "system.extensions.plan",
  "system.extensions.quarantine",
  "system.extensions.read",
  "system.extensions.rollback",
  "system.extensions.uninstall",
  "system.extensions.update",
  "system.operations.backup",
  "system.operations.read",
  "system.operations.restore-drill",
  "system.permissions.read",
  "system.role-assignments.manage",
  "system.role-assignments.read",
  "system.roles.manage",
  "system.roles.read",
  "system.settings.manage",
  "system.settings.read",
  "system.themes.manage",
  "system.themes.read"
]);
const platformPermissionIdsV3 = new Set(allPlatformPermissionIdsV3);

const protectedPlatformRoleLabels = Object.freeze({
  "system.role.owner": "Owner",
  "system.role.security-admin": "Security administrator",
  "system.role.extension-admin": "Extension administrator",
  "system.role.user-admin": "User administrator",
  "system.role.auditor": "Auditor"
} satisfies Record<ProtectedRoleId, string>);

export { protectedPlatformRoleLabels };

/** The exact Phase 11 release, retained only to recognize the v3 → v4 upgrade. */
const protectedPlatformRoleBaselinesV3: readonly ProtectedRoleBaseline[] = Object.freeze([
  protectedBaseline("system.role.owner", allPlatformPermissionIdsV3, platformPermissionIdsV3),
  protectedBaseline("system.role.security-admin", [
    "system.authorization.audit.read",
    "system.permissions.read",
    "system.role-assignments.manage",
    "system.role-assignments.read",
    "system.roles.manage",
    "system.roles.read"
  ], platformPermissionIdsV3),
  protectedBaseline("system.role.extension-admin", [
    "system.catalog.refresh",
    "system.extensions.deploy-platform-plugin",
    "system.extensions.disable",
    "system.extensions.enable",
    "system.extensions.install-live",
    "system.extensions.plan",
    "system.extensions.quarantine",
    "system.extensions.read",
    "system.extensions.rollback",
    "system.extensions.uninstall",
    "system.extensions.update",
    "system.operations.read",
    "system.themes.manage",
    "system.themes.read"
  ], platformPermissionIdsV3),
  protectedBaseline("system.role.user-admin", [
    "system.role-assignments.manage",
    "system.role-assignments.read",
    "system.roles.read"
  ], platformPermissionIdsV3),
  protectedBaseline("system.role.auditor", [
    "system.authorization.audit.read",
    "system.permissions.read",
    "system.role-assignments.read",
    "system.roles.read",
    "system.operations.read",
    "system.themes.read"
  ], platformPermissionIdsV3)
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
    "system.catalog.refresh",
    "system.extensions.deploy-platform-plugin",
    "system.extensions.disable",
    "system.extensions.enable",
    "system.extensions.install-live",
    "system.extensions.plan",
    "system.extensions.quarantine",
    "system.extensions.read",
    "system.extensions.rollback",
    "system.extensions.uninstall",
    "system.extensions.update",
    "system.operations.read",
    "system.themes.manage",
    "system.themes.read"
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
    "system.roles.read",
    "system.operations.read",
    "system.themes.read"
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
export const currentProtectedPlatformRoleBaselineRelease = baselineRelease(4, protectedPlatformRoleBaselines);

const expectedProtectedPlatformRoleBaselineV3Digest = "sha256:cc46f8b9d9cbc290a5550f1c4a32b67640decab972ecd986e6230fff2d534d6a";
const protectedPlatformRoleBaselineReleaseV3 = baselineRelease(3, protectedPlatformRoleBaselinesV3);
if (protectedPlatformRoleBaselineReleaseV3.digest !== expectedProtectedPlatformRoleBaselineV3Digest) {
  throw new TemplateBaselineError("DIGEST_MISMATCH", "The immutable protected role baseline v3 digest changed.");
}

/** Static recognized sources only. Unknown versions or digests fail closed. */
export const recognizedProtectedPlatformRoleBaselineReleases: readonly ProtectedPlatformRoleBaselineRelease[] = Object.freeze([
  protectedPlatformRoleBaselineReleaseV3,
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
