import { createHash } from "node:crypto";

import {
  ExtensionAuthorizationOwnerRefSchema,
  RoleSchema,
  RoleTemplateSchema,
  canonicalJson,
  protectedRoleIds,
  templateBaselineDigestAlgorithm,
  type AuthorizationOwnerRef,
  type AuthorizationDecisionAudit,
  type ExtensionAuthorizationOwnerRef,
  type Role,
  type RoleTemplate,
  type TemplateAdoption
} from "@k-nex/contracts";

import { isEffectiveRoleTemplateForApplication, type EffectiveRoleTemplate } from "./authorization-registry.js";
import {
  AuthorizationStoreError,
  parseAuthorizationExpectedRevision,
  type AuthorizationExpectedRevision,
  type AuthorizationStore,
  type AuthorizationStoreReadTransaction,
  type AuthorizationStoreTransaction,
  type AuthorizationTransactionOutcome
} from "./authorization-store.js";
import { compareTemplateBaseline, digestTemplateBaseline, type TemplateBaselineComparison } from "./protected-role-baselines.js";

export interface InstantiateRoleTemplateInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly effectiveTemplate: EffectiveRoleTemplate;
  readonly role: Readonly<{ readonly id: string; readonly label: string; readonly description?: string }>;
  /** A server-authorized mutation may attach its decision audit to this same transaction. */
  readonly audit?: AuthorizationDecisionAudit;
  /** Server-only admission that observes this mutation's exact transaction. */
  readonly admit?: (transaction: AuthorizationStoreReadTransaction) => Promise<void>;
}

export interface ReconcileAutomaticRoleTemplatesInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly effectiveTemplates: readonly EffectiveRoleTemplate[];
}

export interface CopyTemplatePermissionsInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly effectiveTemplate: EffectiveRoleTemplate;
  readonly roleId: string;
  readonly permissionIds: readonly string[];
  /** A server-authorized mutation may attach its decision audit to this same transaction. */
  readonly audit?: AuthorizationDecisionAudit;
  /** Server-only admission that observes this mutation's exact transaction. */
  readonly admit?: (transaction: AuthorizationStoreReadTransaction) => Promise<void>;
}

export interface TombstoneAutomaticRoleTemplateInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly effectiveTemplate: EffectiveRoleTemplate;
}

export interface CompareInstantiatedRoleTemplateInput {
  readonly store: AuthorizationStore;
  readonly expected: AuthorizationExpectedRevision;
  readonly effectiveTemplate: EffectiveRoleTemplate;
  readonly roleId: string;
}

/** Creates one customer-owned role from an explicitly selected template; templates never create assignments. */
export async function instantiateRoleTemplate(input: InstantiateRoleTemplateInput): Promise<AuthorizationTransactionOutcome<TemplateAdoption>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const effectiveTemplate = parseEffectiveTemplate(input.effectiveTemplate, expected.applicationId);
  const role = parseNewRole(input.role, expected);
  const revision = nextRevision(expected);
  const adoption = createAdoption(expected.applicationId, role.id, effectiveTemplate, effectiveTemplate.template.permissionIds, "instantiated-role", revision);

  return input.store.transaction(expected, async (transaction) => {
    if (await transaction.readRole(expected.applicationId, role.id) !== undefined) {
      fail("REVISION_CONFLICT", "Template role target already exists.");
    }
    await input.admit?.(transaction);
    await writeRoleTemplate(transaction, role, effectiveTemplate, adoption);
    await writeAudit(transaction, input.audit);
    return adoption;
  });
}

/** Reconciles automatic templates once. Any exact publisher/template adoption permanently suppresses replay. */
export async function reconcileAutomaticRoleTemplates(input: ReconcileAutomaticRoleTemplatesInput): Promise<AuthorizationTransactionOutcome<readonly TemplateAdoption[]>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const templates = input.effectiveTemplates.map((template) => parseEffectiveTemplate(template, expected.applicationId)).filter(({ template }) => template.instantiation === "automatic");
  const identities = new Set<string>();
  for (const template of templates) {
    const identity = templateIdentity(template);
    if (identities.has(identity)) fail("MUTATION_INVALID", "Automatic template input is ambiguous.");
    identities.add(identity);
  }
  const revision = nextRevision(expected);

  return input.store.transaction(expected, async (transaction) => {
    const adoptions = await transaction.listTemplateAdoptions(expected.applicationId);
    const created: TemplateAdoption[] = [];
    for (const effectiveTemplate of templates) {
      if (adoptions.some((adoption) => sameTemplate(adoption, effectiveTemplate))) continue;
      const role = parseNewRole({ id: automaticRoleId(expected.applicationId, effectiveTemplate), label: effectiveTemplate.template.title, ...(effectiveTemplate.template.description === undefined ? {} : { description: effectiveTemplate.template.description }) }, expected);
      if (await transaction.readRole(expected.applicationId, role.id) !== undefined) {
        fail("REVISION_CONFLICT", "Automatic template role target already exists without an adoption.");
      }
      const adoption = createAdoption(expected.applicationId, role.id, effectiveTemplate, effectiveTemplate.template.permissionIds, "instantiated-role", revision);
      await writeRoleTemplate(transaction, role, effectiveTemplate, adoption);
      created.push(adoption);
    }
    return Object.freeze(created);
  });
}

/** Copies a selected current-template subset exactly once, preserving every existing unrelated grant. */
export async function copyTemplatePermissionsToRole(input: CopyTemplatePermissionsInput): Promise<AuthorizationTransactionOutcome<TemplateAdoption>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const effectiveTemplate = parseEffectiveTemplate(input.effectiveTemplate, expected.applicationId);
  const permissionIds = parseSelectedPermissions(input.permissionIds, effectiveTemplate.template);
  const revision = nextRevision(expected);

  return input.store.transaction(expected, async (transaction) => {
    const role = await editableRole(transaction, expected.applicationId, input.roleId);
    const adoptions = await transaction.listTemplateAdoptions(expected.applicationId, role.id);
    if (adoptions.some((adoption) => adoption.kind === "copied-permissions" && adoption.templateId === effectiveTemplate.template.id && !sameTemplate(adoption, effectiveTemplate))) {
      fail("MUTATION_INVALID", "Template ID belongs to another publisher in this role.");
    }
    if (adoptions.some((adoption) => adoption.kind === "copied-permissions" && sameTemplate(adoption, effectiveTemplate))) {
      fail("REVISION_CONFLICT", "Template permissions were already copied into this role.");
    }
    await input.admit?.(transaction);
    const grants = await transaction.listGrants(expected.applicationId, role.id);
    for (const permissionId of permissionIds) {
      const existing = grants.find((grant) => grant.permissionId === permissionId);
      if (existing === undefined) {
        await transaction.write({ kind: "grant", grant: createGrant(expected.applicationId, role.id, permissionId, effectiveTemplate.owner, revision) });
      } else if (!sameOwner(existing.owner, effectiveTemplate.owner)) {
        fail("MUTATION_INVALID", "Selected permission is already bound to another authorization owner.");
      }
    }
    const adoption = createAdoption(expected.applicationId, role.id, effectiveTemplate, permissionIds, "copied-permissions", revision);
    await transaction.write({ kind: "template-adoption", adoption });
    await writeAudit(transaction, input.audit);
    return adoption;
  });
}

/** Records an independent suppression decision before an automatic template can create a customer role. */
export async function tombstoneAutomaticRoleTemplate(input: TombstoneAutomaticRoleTemplateInput): Promise<AuthorizationTransactionOutcome<TemplateAdoption>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const effectiveTemplate = parseEffectiveTemplate(input.effectiveTemplate, expected.applicationId);
  if (effectiveTemplate.template.instantiation !== "automatic") {
    fail("MUTATION_INVALID", "Only automatic templates may be tombstoned before instantiation.");
  }
  const revision = nextRevision(expected);

  return input.store.transaction(expected, async (transaction) => {
    const adoptions = await transaction.listTemplateAdoptions(expected.applicationId);
    const existing = adoptions.find((adoption) => sameTemplate(adoption, effectiveTemplate));
    if (existing !== undefined) {
      if (existing.kind === "instantiated-role" && existing.state === "tombstoned" && existing.roleId === undefined) return existing;
      fail("REVISION_CONFLICT", "Automatic template already has an adoption or live instantiated role.");
    }
    const tombstone = createTombstone(expected.applicationId, effectiveTemplate, revision);
    await transaction.write({ kind: "template-adoption", adoption: tombstone });
    return tombstone;
  });
}

/** Performs the stored-old/current-role/new-template comparison under the exact store revision without writes. */
export async function compareInstantiatedRoleTemplate(input: CompareInstantiatedRoleTemplateInput): Promise<AuthorizationTransactionOutcome<TemplateBaselineComparison>> {
  const expected = parseAuthorizationExpectedRevision(input.expected);
  const effectiveTemplate = parseEffectiveTemplate(input.effectiveTemplate, expected.applicationId);

  return input.store.transaction(expected, async (transaction) => {
    await editableRole(transaction, expected.applicationId, input.roleId);
    const adoptions = await transaction.listTemplateAdoptions(expected.applicationId, input.roleId);
    if (adoptions.some((adoption) => adoption.kind === "instantiated-role" && adoption.templateId === effectiveTemplate.template.id && !sameTemplate(adoption, effectiveTemplate))) {
      fail("MUTATION_INVALID", "Template ID belongs to another publisher in this role.");
    }
    const adoption = adoptions.find((candidate) => candidate.kind === "instantiated-role" && sameExactTemplate(candidate, effectiveTemplate));
    if (adoption === undefined || effectiveTemplate.template.version <= adoption.templateVersion) {
      fail("MUTATION_INVALID", "A newer exact-owner instantiated template adoption is required for comparison.");
    }
    const grants = await transaction.listGrants(expected.applicationId, input.roleId);
    return compareTemplateBaseline({
      stored: adoption,
      currentOwnerPermissionIds: grants.filter((grant) => sameOwner(grant.owner, effectiveTemplate.owner)).map((grant) => grant.permissionId),
      newBaselinePermissionIds: effectiveTemplate.template.permissionIds
    });
  });
}

function parseEffectiveTemplate(value: unknown, applicationId: string): EffectiveRoleTemplate {
  if (!isEffectiveRoleTemplateForApplication(value, applicationId) || typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["owner", "template"])) {
    fail("MUTATION_INVALID", "Effective role template is invalid.");
  }
  const input = value as unknown as Record<string, unknown>;
  const template = RoleTemplateSchema.safeParse(input.template);
  const owner = ExtensionAuthorizationOwnerRefSchema.safeParse(input.owner);
  if (!template.success || !owner.success || !samePublisher(owner.data, template.data.publisher)) {
    fail("MUTATION_INVALID", "Template publisher and authorization owner must exactly match.");
  }
  return Object.freeze({ template: template.data, owner: owner.data });
}

function parseNewRole(value: unknown, expected: AuthorizationExpectedRevision): Role {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !exactKeys(value, ["description", "id", "label"], ["description"])) {
    fail("MUTATION_INVALID", "Template role input is invalid.");
  }
  const input = value as Record<string, unknown>;
  const role = RoleSchema.safeParse({ schemaVersion: 1, applicationId: expected.applicationId, id: input.id, label: input.label, ...(input.description === undefined ? {} : { description: input.description }), revision: nextRevision(expected) });
  if (!role.success || role.data.protectedRoleId !== undefined || protectedRoleIds.includes(role.data.id as never)) {
    fail("MUTATION_INVALID", "Template roles must use a customer-owned non-protected role ID and label.");
  }
  return role.data;
}

function parseSelectedPermissions(value: unknown, template: RoleTemplate): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((permissionId) => typeof permissionId !== "string")) {
    fail("MUTATION_INVALID", "Template permission selection must be nonempty.");
  }
  const permissionIds = [...new Set(value)].sort(compare);
  if (permissionIds.length !== value.length || permissionIds.some((permissionId) => !template.permissionIds.includes(permissionId))) {
    fail("MUTATION_INVALID", "Template permission selection is not a canonical subset.");
  }
  return Object.freeze(permissionIds);
}

function createAdoption(applicationId: string, roleId: string, effectiveTemplate: EffectiveRoleTemplate, permissionIds: readonly string[], kind: TemplateAdoption["kind"], revision: number): TemplateAdoption {
  return Object.freeze({
    schemaVersion: 1,
    id: deterministicId(applicationId, "adoption", kind, roleId, ...templateIdentityParts(effectiveTemplate)),
    applicationId,
    roleId,
    templateId: effectiveTemplate.template.id,
    publisher: effectiveTemplate.template.publisher,
    owner: effectiveTemplate.owner,
    templateVersion: effectiveTemplate.template.version,
    oldBaselinePermissionIds: [...permissionIds],
    digestAlgorithm: templateBaselineDigestAlgorithm,
    oldBaselineDigest: digestTemplateBaseline(permissionIds),
    kind,
    state: "adopted",
    revision
  });
}

function createTombstone(applicationId: string, effectiveTemplate: EffectiveRoleTemplate, revision: number): TemplateAdoption {
  const permissionIds = effectiveTemplate.template.permissionIds;
  return Object.freeze({
    schemaVersion: 1,
    id: deterministicId(applicationId, "tombstone", ...templateIdentityParts(effectiveTemplate)),
    applicationId,
    templateId: effectiveTemplate.template.id,
    publisher: effectiveTemplate.template.publisher,
    owner: effectiveTemplate.owner,
    templateVersion: effectiveTemplate.template.version,
    oldBaselinePermissionIds: [...permissionIds],
    digestAlgorithm: templateBaselineDigestAlgorithm,
    oldBaselineDigest: digestTemplateBaseline(permissionIds),
    kind: "instantiated-role",
    state: "tombstoned",
    revision
  });
}

function createGrant(applicationId: string, roleId: string, permissionId: string, owner: ExtensionAuthorizationOwnerRef, revision: number) {
  return Object.freeze({ schemaVersion: 1 as const, id: deterministicId(applicationId, "grant", roleId, permissionId, owner.deliveryClass, owner.extensionId, String(owner.generation)), applicationId, roleId, permissionId, owner, revision });
}

async function writeRoleTemplate(transaction: AuthorizationStoreTransaction, role: Role, effectiveTemplate: EffectiveRoleTemplate, adoption: TemplateAdoption): Promise<void> {
  await transaction.write({ kind: "role", role });
  for (const permissionId of effectiveTemplate.template.permissionIds) {
    await transaction.write({ kind: "grant", grant: createGrant(role.applicationId, role.id, permissionId, effectiveTemplate.owner, role.revision) });
  }
  await transaction.write({ kind: "template-adoption", adoption });
}

async function writeAudit(transaction: AuthorizationStoreTransaction, audit: AuthorizationDecisionAudit | undefined): Promise<void> {
  if (audit !== undefined) await transaction.write({ kind: "audit", audit });
}

async function editableRole(transaction: AuthorizationStoreTransaction, applicationId: string, roleId: string): Promise<Role> {
  const role = await transaction.readRole(applicationId, roleId);
  if (role === undefined || role.protectedRoleId !== undefined || protectedRoleIds.includes(role.id as never)) {
    fail("MUTATION_INVALID", "Template operations require an existing editable non-protected role.");
  }
  return role;
}

function automaticRoleId(applicationId: string, effectiveTemplate: EffectiveRoleTemplate): string {
  return deterministicId(applicationId, "automatic-role", ...templateIdentityParts(effectiveTemplate));
}

function templateIdentity(effectiveTemplate: EffectiveRoleTemplate): string {
  return templateIdentityParts(effectiveTemplate).join("/");
}

function templateIdentityParts(effectiveTemplate: EffectiveRoleTemplate): readonly string[] {
  return [effectiveTemplate.template.publisher.deliveryClass, effectiveTemplate.template.publisher.extensionId, effectiveTemplate.template.id];
}

function sameTemplate(adoption: TemplateAdoption, effectiveTemplate: EffectiveRoleTemplate): boolean {
  return adoption.templateId === effectiveTemplate.template.id && samePublisher(adoption.publisher, effectiveTemplate.template.publisher);
}

function sameExactTemplate(adoption: TemplateAdoption, effectiveTemplate: EffectiveRoleTemplate): boolean {
  return sameTemplate(adoption, effectiveTemplate) && sameOwner(adoption.owner, effectiveTemplate.owner);
}

function samePublisher(left: { readonly deliveryClass: string; readonly extensionId: string }, right: { readonly deliveryClass: string; readonly extensionId: string }): boolean {
  return left.deliveryClass === right.deliveryClass && left.extensionId === right.extensionId;
}

function sameOwner(left: AuthorizationOwnerRef, right: ExtensionAuthorizationOwnerRef): boolean {
  return left.kind === "extension" && samePublisher(left, right) && left.generation === right.generation;
}

function nextRevision(expected: AuthorizationExpectedRevision): number {
  if (expected.authorizationRevision >= 1_000_000_000) fail("REVISION_CONFLICT", "Authorization revision cannot advance further.");
  return expected.authorizationRevision + 1;
}

function deterministicId(applicationId: string, kind: string, ...parts: readonly string[]): string {
  return `template.${kind}.${createHash("sha256").update(canonicalJson([applicationId, kind, ...parts])).digest("hex")}`;
}

function exactKeys(value: object, allowed: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && allowed.every((key) => optional.includes(key) || keys.includes(key));
}

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function fail(code: "MUTATION_INVALID" | "REVISION_CONFLICT", message: string): never {
  throw new AuthorizationStoreError(code, message);
}
