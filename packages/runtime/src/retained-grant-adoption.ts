import {
  ExtensionAuthorizationGenerationSchema,
  ExtensionAuthorizationOwnerRefSchema,
  RolePermissionGrantSchema,
  protectedRoleIds,
  type AuthorizationOwnerRef,
  type ExtensionAuthorizationGeneration,
  type ExtensionAuthorizationOwnerRef,
  type Role,
  type RolePermissionGrant
} from "@k-nex/contracts";

import {
  isEffectiveAuthorizationCatalogForGeneration,
  isEffectiveAuthorizationCatalogForLifecycleOwner,
  type EffectiveAuthorizationCatalog
} from "./authorization-registry.js";
import {
  AuthorizationStoreError,
  parseAuthorizationExpectedRevision,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreTransaction,
  type AuthorizationTransactionOutcome
} from "./authorization-store.js";

export interface AdoptRetainedExtensionGrantsInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly effectiveCatalog: EffectiveAuthorizationCatalog;
  readonly targetOwner: ExtensionAuthorizationOwnerRef;
  readonly roleId: string;
  /** Explicitly reviewed grant IDs in canonical lexical order. */
  readonly selectedGrantIds: readonly string[];
}

/** Rebinds only reviewed retired-generation grants to one exact current extension generation. */
export async function adoptRetainedExtensionGrants(input: AdoptRetainedExtensionGrantsInput): Promise<AuthorizationTransactionOutcome<readonly RolePermissionGrant[]>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const targetOwner = parseTargetOwner(input.targetOwner);
  const catalog = parseEffectiveCatalog(input.effectiveCatalog, expected, targetOwner);
  const selectedGrantIds = parseSelectedGrantIds(input.selectedGrantIds);
  const revision = nextRevision(expected);

  return input.store.transaction(expected, async (transaction) => {
    const role = await editableRole(transaction, expected.applicationId, input.roleId);
    const generations = parseGenerations(await transaction.listExtensionGenerations(expected.applicationId), expected.applicationId);
    const currentTarget = assertCurrentTarget(generations, targetOwner);
    if (!isEffectiveAuthorizationCatalogForGeneration(catalog, currentTarget)) {
      fail("MUTATION_INVALID", "The effective authorization catalog is not bound to the exact current extension generation.");
    }
    const grants = parseRoleGrants(await transaction.listGrants(expected.applicationId, role.id), expected.applicationId, role.id);
    const byId = new Map(grants.map((grant) => [grant.id, grant]));
    if (byId.size !== grants.length) fail("MUTATION_INVALID", "Role grants are ambiguous.");
    const replacements = selectedGrantIds.map((grantId) => replacement(byId.get(grantId), targetOwner, generations, catalog, revision));
    for (const grant of replacements) await transaction.write({ kind: "grant", grant });
    return Object.freeze(replacements);
  });
}

function parseEffectiveCatalog(value: unknown, expected: AuthorizationExpectedRevision, targetOwner: ExtensionAuthorizationOwnerRef): EffectiveAuthorizationCatalog {
  if (!isEffectiveAuthorizationCatalogForLifecycleOwner(value, expected.applicationId, expected.lifecycleRevision, targetOwner)) {
    fail("MUTATION_INVALID", "The effective authorization catalog is not current for this extension generation.");
  }
  return value;
}

function parseTargetOwner(value: unknown): ExtensionAuthorizationOwnerRef {
  const parsed = ExtensionAuthorizationOwnerRefSchema.safeParse(value);
  if (!parsed.success) fail("MUTATION_INVALID", "Target authorization owner is invalid.");
  return parsed.data;
}

function parseSelectedGrantIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string") || !strictlySorted(value)) {
    fail("MUTATION_INVALID", "Selected retained grants must be nonempty, sorted, and unique.");
  }
  return Object.freeze([...value]);
}

async function editableRole(transaction: AuthorizationStoreTransaction, applicationId: string, roleId: string): Promise<Role> {
  const role = await transaction.readRole(applicationId, roleId);
  if (role === undefined || role.applicationId !== applicationId || role.protectedRoleId !== undefined || protectedRoleIds.includes(role.id as never)) {
    fail("MUTATION_INVALID", "Retained grant adoption requires an existing editable role.");
  }
  return role;
}

function parseGenerations(value: readonly unknown[], applicationId: string): readonly ExtensionAuthorizationGeneration[] {
  const rows = value.map((row) => {
    const parsed = ExtensionAuthorizationGenerationSchema.safeParse(row);
    if (!parsed.success || parsed.data.applicationId !== applicationId) fail("MUTATION_INVALID", "Authorization generation state is invalid.");
    return parsed.data;
  });
  const keys = new Set(rows.map(({ owner }) => ownerKey(owner)));
  if (keys.size !== rows.length) fail("MUTATION_INVALID", "Authorization generation state is ambiguous.");
  return Object.freeze(rows);
}

function assertCurrentTarget(generations: readonly ExtensionAuthorizationGeneration[], targetOwner: ExtensionAuthorizationOwnerRef): ExtensionAuthorizationGeneration {
  const target = generations.find(({ owner }) => sameOwner(owner, targetOwner));
  if (target === undefined || target.state !== "current") fail("MUTATION_INVALID", "Target authorization generation is not current.");
  const currentForPublisher = generations.filter(({ owner, state }) => state === "current" && samePublisher(owner, targetOwner));
  if (currentForPublisher.length !== 1 || !sameOwner(currentForPublisher[0]!.owner, targetOwner)) {
    fail("MUTATION_INVALID", "Target extension has ambiguous current authorization generations.");
  }
  return target;
}

function parseRoleGrants(value: readonly unknown[], applicationId: string, roleId: string): readonly RolePermissionGrant[] {
  return Object.freeze(value.map((row) => {
    const parsed = RolePermissionGrantSchema.safeParse(row);
    if (!parsed.success || parsed.data.applicationId !== applicationId || parsed.data.roleId !== roleId) {
      fail("MUTATION_INVALID", "Role grant state is invalid.");
    }
    return parsed.data;
  }));
}

function replacement(
  grant: RolePermissionGrant | undefined,
  targetOwner: ExtensionAuthorizationOwnerRef,
  generations: readonly ExtensionAuthorizationGeneration[],
  catalog: EffectiveAuthorizationCatalog,
  revision: number
): RolePermissionGrant {
  if (grant === undefined) fail("MUTATION_INVALID", "Selected retained grant is missing.");
  const oldOwner = grant.owner;
  if (oldOwner.kind !== "extension" || !samePublisher(oldOwner, targetOwner)) {
    fail("MUTATION_INVALID", "Selected retained grant belongs to another extension owner.");
  }
  if (sameOwner(oldOwner, targetOwner)) fail("MUTATION_INVALID", "Selected grant already belongs to the current authorization generation.");
  const oldGeneration = generations.find(({ owner }) => sameOwner(owner, oldOwner));
  if (oldGeneration === undefined || oldGeneration.state !== "retired") {
    fail("MUTATION_INVALID", "Selected grant is not retained from a retired authorization generation.");
  }
  const matchingPermissions = catalog.permissions.filter(({ descriptor, owner }) => descriptor.id === grant.permissionId && sameOwner(owner, targetOwner));
  if (matchingPermissions.length !== 1) fail("MUTATION_INVALID", "Selected retained grant has no reviewed current permission.");
  const parsed = RolePermissionGrantSchema.safeParse({ ...grant, owner: targetOwner, revision });
  if (!parsed.success) fail("MUTATION_INVALID", "Retained grant replacement is not canonical.");
  return parsed.data;
}

function samePublisher(left: { readonly deliveryClass: string; readonly extensionId: string }, right: { readonly deliveryClass: string; readonly extensionId: string }): boolean {
  return left.deliveryClass === right.deliveryClass && left.extensionId === right.extensionId;
}

function sameOwner(left: AuthorizationOwnerRef, right: ExtensionAuthorizationOwnerRef): boolean {
  return left.kind === "extension" && samePublisher(left, right) && left.generation === right.generation;
}

function ownerKey(owner: ExtensionAuthorizationOwnerRef): string {
  return `${owner.deliveryClass}:${owner.extensionId}:${owner.generation}`;
}

function strictlySorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function nextRevision(expected: AuthorizationExpectedRevision): number {
  if (expected.authorizationRevision >= 1_000_000_000) fail("REVISION_CONFLICT", "Authorization revision cannot advance further.");
  return expected.authorizationRevision + 1;
}

function fail(code: "MUTATION_INVALID" | "REVISION_CONFLICT", message: string): never {
  throw new AuthorizationStoreError(code, message);
}
