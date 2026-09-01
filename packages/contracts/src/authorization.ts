import * as z from "zod";

import { HotApplicationIdSchema, PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

export const authorizationCeilings = Object.freeze({
  descriptors: 256,
  grantsPerRole: 512,
  templatePermissions: 256,
  snapshots: 1_024,
  identifierLength: 160,
  labelLength: 120,
  descriptionLength: 240,
  revision: 1_000_000_000
} as const);

const identifierSchema = z.string().min(1).max(authorizationCeilings.identifierLength)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);
const applicationIdSchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const environmentSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/u);
const positiveSafeIntegerSchema = z.number().finite().int().safe().positive().max(Number.MAX_SAFE_INTEGER);
const revisionSchema = z.number().finite().int().safe().nonnegative().max(authorizationCeilings.revision);
const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const runtimeGenerationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);

const platformPublisherSchema = z.strictObject({
  kind: z.literal("platform"),
  namespace: z.literal("system")
});

const platformPluginPublisherSchema = z.strictObject({
  kind: z.literal("extension"),
  deliveryClass: z.literal("platform-plugin"),
  extensionId: PluginIdSchema
});

const hotApplicationPublisherSchema = z.strictObject({
  kind: z.literal("extension"),
  deliveryClass: z.literal("hot-application"),
  extensionId: HotApplicationIdSchema
});

/** Immutable publisher identity for static permission and template declarations. */
export const PermissionPublisherRefSchema = z.union([
  platformPublisherSchema,
  platformPluginPublisherSchema,
  hotApplicationPublisherSchema
]).superRefine((publisher, context) => {
  if (hasReservedSystemNamespace(publisher)) {
    context.addIssue({ code: "custom", path: ["extensionId"], message: "Extensions may not claim the reserved system permission namespace." });
  }
});

export const ExtensionPermissionPublisherRefSchema = z.union([
  platformPluginPublisherSchema,
  hotApplicationPublisherSchema
]).superRefine((publisher, context) => {
  if (hasReservedSystemNamespace(publisher)) {
    context.addIssue({ code: "custom", path: ["extensionId"], message: "Extensions may not claim the reserved system permission namespace." });
  }
});

const platformOwnerSchema = platformPublisherSchema;
const platformPluginOwnerSchema = platformPluginPublisherSchema.extend({ generation: positiveSafeIntegerSchema });
const hotApplicationOwnerSchema = hotApplicationPublisherSchema.extend({ generation: positiveSafeIntegerSchema });

/** Persisted/effective ownership. Extension authorization generations are numeric fences. */
export const AuthorizationOwnerRefSchema = z.union([
  platformOwnerSchema,
  platformPluginOwnerSchema,
  hotApplicationOwnerSchema
]).superRefine((owner, context) => {
  if (hasReservedSystemNamespace(owner)) {
    context.addIssue({ code: "custom", path: ["extensionId"], message: "Extensions may not own the reserved system permission namespace." });
  }
});

export const ExtensionAuthorizationOwnerRefSchema = z.union([
  platformPluginOwnerSchema,
  hotApplicationOwnerSchema
]).superRefine((owner, context) => {
  if (hasReservedSystemNamespace(owner)) {
    context.addIssue({ code: "custom", path: ["extensionId"], message: "Extensions may not own the reserved system permission namespace." });
  }
});

export const AuthorizationPermissionIdSchema = ResourceIdSchema.max(authorizationCeilings.identifierLength);

/** Returns the complete extension suffix after the first dot, never only the second segment. */
export function permissionPublisherNamespace(publisher: PermissionPublisherRef): string {
  return publisher.kind === "platform" ? "system" : publisher.extensionId.slice(publisher.extensionId.indexOf(".") + 1);
}

function hasReservedSystemNamespace(publisher: PermissionPublisherRef | AuthorizationOwnerRef): boolean {
  if (publisher.kind !== "extension") return false;
  const namespace = permissionPublisherNamespace(publisher);
  return namespace === "system" || namespace.startsWith("system.");
}

export function isPermissionOwnedByPublisher(publisher: PermissionPublisherRef, permissionId: string): boolean {
  return !hasReservedSystemNamespace(publisher)
    && AuthorizationPermissionIdSchema.safeParse(permissionId).success
    && permissionId.startsWith(`${permissionPublisherNamespace(publisher)}.`);
}

export function isPermissionOwnedByOwner(owner: AuthorizationOwnerRef, permissionId: string): boolean {
  return isPermissionOwnedByPublisher(owner, permissionId);
}

function sameExtensionPublisher(left: PermissionPublisherRef, right: PermissionPublisherRef): boolean {
  return left.kind === "extension" && right.kind === "extension"
    && left.deliveryClass === right.deliveryClass && left.extensionId === right.extensionId;
}

function ownerMatchesPublisher(owner: AuthorizationOwnerRef, publisher: PermissionPublisherRef): boolean {
  return owner.kind === "platform" && publisher.kind === "platform"
    ? owner.namespace === publisher.namespace
    : sameExtensionPublisher(owner, publisher);
}

function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

export const PermissionAudienceSchema = z.enum(["authenticated", "service", "system"]);
export const PermissionOperationSchema = z.enum(["read", "write", "manage", "execute"]);
export const PermissionScopeSchema = z.enum(["application", "record", "field"]);

/** Data-only descriptor. Executable policy code belongs only behind a separate static binding. */
export const AuthorizationPermissionDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: AuthorizationPermissionIdSchema,
  publisher: PermissionPublisherRefSchema,
  title: z.string().min(1).max(authorizationCeilings.labelLength),
  description: z.string().min(1).max(authorizationCeilings.descriptionLength),
  audience: PermissionAudienceSchema,
  resource: ResourceIdSchema,
  operation: PermissionOperationSchema,
  scope: PermissionScopeSchema
}).superRefine((descriptor, context) => {
  if (!isPermissionOwnedByPublisher(descriptor.publisher, descriptor.id)) {
    context.addIssue({ code: "custom", path: ["id"], message: "Permission IDs must use the publisher namespace." });
  }
});

/** A static reference resolved by trusted host code; it cannot embed executable policy. */
export const PermissionPolicyBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ResourceIdSchema,
  publisher: PermissionPublisherRefSchema,
  permissionId: AuthorizationPermissionIdSchema,
  policyReference: ResourceIdSchema,
  scope: PermissionScopeSchema,
  failureMode: z.literal("deny"),
  timeoutMs: z.number().finite().int().safe().min(1).max(5_000)
}).superRefine((binding, context) => {
  if (!isPermissionOwnedByPublisher(binding.publisher, binding.id)
    || !isPermissionOwnedByPublisher(binding.publisher, binding.permissionId)
    || !isPermissionOwnedByPublisher(binding.publisher, binding.policyReference)) {
    context.addIssue({ code: "custom", message: "Policy bindings may reference only publisher-owned static IDs." });
  }
});

export const protectedRoleIds = [
  "system.role.owner",
  "system.role.security-admin",
  "system.role.extension-admin",
  "system.role.user-admin",
  "system.role.auditor"
] as const;

export const ProtectedRoleIdSchema = z.enum(protectedRoleIds);
export const ProtectedRoleBaselineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ProtectedRoleIdSchema,
  permissionIds: uniqueArray(AuthorizationPermissionIdSchema).min(1).max(authorizationCeilings.grantsPerRole)
}).superRefine((baseline, context) => {
  if (!baseline.permissionIds.every((permissionId) => isPermissionOwnedByPublisher({ kind: "platform", namespace: "system" }, permissionId))) {
    context.addIssue({ code: "custom", path: ["permissionIds"], message: "Protected roles may contain only system permissions." });
  }
  if (!sortedUnique(baseline.permissionIds)) {
    context.addIssue({ code: "custom", path: ["permissionIds"], message: "Protected role permissions must be unique canonical lexical order." });
  }
});

/** Customer-owned role metadata. Its label is presentation only, never a requested authority. */
export const RoleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  applicationId: applicationIdSchema,
  label: z.string().min(1).max(authorizationCeilings.labelLength),
  description: z.string().min(1).max(authorizationCeilings.descriptionLength).optional(),
  protectedRoleId: ProtectedRoleIdSchema.optional(),
  revision: revisionSchema
}).superRefine((role, context) => {
  const reservedProtectedRole = protectedRoleIds.includes(role.id as ProtectedRoleId);
  if (reservedProtectedRole && role.protectedRoleId !== role.id) {
    context.addIssue({ code: "custom", path: ["protectedRoleId"], message: "A reserved protected role ID must declare its matching protected role ID." });
  }
  if (!reservedProtectedRole && role.protectedRoleId !== undefined) {
    context.addIssue({ code: "custom", path: ["protectedRoleId"], message: "Only reserved protected role IDs may declare a protected role ID." });
  }
});

/** Normalized role-to-permission grant, fenced to an extension authorization generation when applicable. */
export const RolePermissionGrantSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  applicationId: applicationIdSchema,
  roleId: identifierSchema,
  permissionId: AuthorizationPermissionIdSchema,
  owner: AuthorizationOwnerRefSchema,
  revision: revisionSchema
}).superRefine((grant, context) => {
  if (!isPermissionOwnedByOwner(grant.owner, grant.permissionId)) {
    context.addIssue({ code: "custom", path: ["permissionId"], message: "A grant must be owned by its bound owner and authorization generation." });
  }
});

export const AuthorizationSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user"), id: identifierSchema }),
  z.strictObject({ kind: z.literal("service"), id: identifierSchema })
]);

/** Explicitly non-temporal assignment state. Unknown scheduling/expiry fields are rejected. */
export const RoleAssignmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  applicationId: applicationIdSchema,
  roleId: identifierSchema,
  principal: AuthorizationSubjectSchema,
  state: z.enum(["active", "revoked"]),
  revision: revisionSchema
});

/** Static extension default; it contains no user/service assignment authority. */
export const RoleTemplateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ResourceIdSchema,
  publisher: ExtensionPermissionPublisherRefSchema,
  version: positiveSafeIntegerSchema,
  instantiation: z.enum(["automatic", "manual"]),
  title: z.string().min(1).max(authorizationCeilings.labelLength),
  description: z.string().min(1).max(authorizationCeilings.descriptionLength).optional(),
  permissionIds: uniqueArray(AuthorizationPermissionIdSchema).min(1).max(authorizationCeilings.templatePermissions)
}).superRefine((template, context) => {
  if (!isPermissionOwnedByPublisher(template.publisher, template.id)
    || !template.permissionIds.every((permissionId) => isPermissionOwnedByPublisher(template.publisher, permissionId))) {
    context.addIssue({ code: "custom", message: "Role templates may contain only same-owner extension permissions." });
  }
  if (!sortedUnique(template.permissionIds)) {
    context.addIssue({ code: "custom", path: ["permissionIds"], message: "Template permissions must be unique canonical lexical order." });
  }
});

export const templateBaselineDigestAlgorithm = "sha256-canonical-json-v1" as const;
export const TemplateAdoptionKindSchema = z.enum(["instantiated-role", "copied-permissions"]);
export const TemplateAdoptionStateSchema = z.enum(["adopted", "tombstoned"]);

/** Retains the canonical old template baseline needed for customer-edit-safe upgrade comparison. */
export const TemplateAdoptionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  applicationId: applicationIdSchema,
  roleId: identifierSchema.optional(),
  templateId: ResourceIdSchema,
  publisher: ExtensionPermissionPublisherRefSchema,
  owner: ExtensionAuthorizationOwnerRefSchema,
  templateVersion: positiveSafeIntegerSchema,
  oldBaselinePermissionIds: uniqueArray(AuthorizationPermissionIdSchema).min(1).max(authorizationCeilings.templatePermissions),
  digestAlgorithm: z.literal(templateBaselineDigestAlgorithm),
  oldBaselineDigest: sha256DigestSchema,
  kind: TemplateAdoptionKindSchema,
  state: TemplateAdoptionStateSchema,
  revision: revisionSchema
}).superRefine((adoption, context) => {
  const independentTombstone = adoption.kind === "instantiated-role" && adoption.state === "tombstoned";
  if (independentTombstone ? adoption.roleId !== undefined : adoption.roleId === undefined) {
    context.addIssue({ code: "custom", path: ["roleId"], message: "Only instantiated-role tombstones omit their role ID." });
  }
  if (!isPermissionOwnedByPublisher(adoption.publisher, adoption.templateId)
    || !adoption.oldBaselinePermissionIds.every((permissionId) => isPermissionOwnedByPublisher(adoption.publisher, permissionId))
    || !sameExtensionPublisher(adoption.publisher, adoption.owner)) {
    context.addIssue({ code: "custom", message: "Template adoption must retain one same-owner extension baseline." });
  }
  if (!sortedUnique(adoption.oldBaselinePermissionIds)) {
    context.addIssue({ code: "custom", path: ["oldBaselinePermissionIds"], message: "Stored template baselines must be unique canonical lexical order." });
  }
});

export const AdministrativePermissionCatalogStateSchema = z.enum([
  "inactive-extension-disabled",
  "inactive-extension-not-ready",
  "inactive-generation-retired",
  "deprecated",
  "orphaned-after-removal"
]);

/** Informational catalog projection. It is deliberately not an effective authorization source. */
export const PermissionCatalogSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  applicationId: applicationIdSchema,
  source: z.literal("administrative-non-authoritative"),
  permission: AuthorizationPermissionDescriptorSchema,
  state: AdministrativePermissionCatalogStateSchema,
  owner: AuthorizationOwnerRefSchema.optional(),
  revision: revisionSchema
}).superRefine((snapshot, context) => {
  if (snapshot.owner !== undefined && (!isPermissionOwnedByOwner(snapshot.owner, snapshot.permission.id)
    || !ownerMatchesPublisher(snapshot.owner, snapshot.permission.publisher))) {
    context.addIssue({ code: "custom", path: ["owner"], message: "Snapshot owner must exactly match the projected permission publisher." });
  }
});

/** Bridges a numeric authorization generation to a bounded Phase 9 runtime generation ID. */
export const ExtensionAuthorizationGenerationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  applicationId: applicationIdSchema,
  owner: ExtensionAuthorizationOwnerRefSchema,
  runtimeGenerationIds: uniqueArray(runtimeGenerationIdSchema).min(1).max(16),
  state: z.enum(["current", "retired"]),
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema
});

export const AuthorizationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema
});

export const BootstrapReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  applicationId: applicationIdSchema,
  ownerRoleId: z.literal("system.role.owner"),
  ownerAssignmentId: identifierSchema,
  ownerPrincipal: z.strictObject({ kind: z.literal("user"), id: identifierSchema }),
  authorizationRevision: revisionSchema,
  state: z.literal("committed")
});

export const AuthorizationScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("application"), resource: ResourceIdSchema }),
  z.strictObject({ kind: z.literal("record"), resource: ResourceIdSchema, recordId: identifierSchema }),
  z.strictObject({ kind: z.literal("field"), resource: ResourceIdSchema, recordId: identifierSchema, fieldId: ResourceIdSchema })
]);

export const AuthorizationDelegationSchema = z.strictObject({
  delegationId: identifierSchema,
  delegator: AuthorizationSubjectSchema,
  effect: z.literal("reducing")
});

export const AuthorizationDecisionReasonSchema = z.enum([
  "granted",
  "permission-not-granted",
  "owner-not-effective",
  "assignment-revoked",
  "delegation-reduced",
  "approval-required",
  "reauthentication-required",
  "policy-denied"
]);
export type AuthorizationDecisionReason = z.infer<typeof AuthorizationDecisionReasonSchema>;

/** Safe decision projection: no role labels, raw request inputs, secrets, or permission arrays. */
export const AuthorizationDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  decisionId: identifierSchema,
  correlationId: identifierSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  permissionId: AuthorizationPermissionIdSchema,
  owner: AuthorizationOwnerRefSchema,
  principal: AuthorizationSubjectSchema,
  effectiveActor: AuthorizationSubjectSchema,
  delegation: AuthorizationDelegationSchema.optional(),
  scope: AuthorizationScopeSchema,
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema,
  outcome: z.enum(["allow", "deny"]),
  reason: AuthorizationDecisionReasonSchema,
  approval: z.enum(["not-required", "required", "satisfied"]),
  reauthentication: z.enum(["not-required", "required", "satisfied"])
}).superRefine((decision, context) => {
  if (!isPermissionOwnedByOwner(decision.owner, decision.permissionId)) {
    context.addIssue({ code: "custom", path: ["permissionId"], message: "Decisions must bind the requested permission to its owner." });
  }
  validateDecisionCoherence(decision, context);
});

/** Persist-safe audit projection for one authorization decision. */
export const AuthorizationDecisionAuditSchema = z.strictObject({
  schemaVersion: z.literal(1),
  auditId: identifierSchema,
  decisionId: identifierSchema,
  correlationId: identifierSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  permissionId: AuthorizationPermissionIdSchema,
  owner: AuthorizationOwnerRefSchema,
  principal: AuthorizationSubjectSchema,
  effectiveActor: AuthorizationSubjectSchema,
  delegationId: identifierSchema.optional(),
  scope: AuthorizationScopeSchema,
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema,
  outcome: z.enum(["allow", "deny"]),
  reason: AuthorizationDecisionReasonSchema,
  approval: z.enum(["not-required", "required", "satisfied"]),
  reauthentication: z.enum(["not-required", "required", "satisfied"])
}).superRefine((audit, context) => {
  if (!isPermissionOwnedByOwner(audit.owner, audit.permissionId)) {
    context.addIssue({ code: "custom", path: ["permissionId"], message: "Audits must bind the requested permission to its owner." });
  }
  validateDecisionCoherence(audit, context);
});

function validateDecisionCoherence(
  decision: Readonly<{ outcome: "allow" | "deny"; reason: AuthorizationDecisionReason; approval: "not-required" | "required" | "satisfied"; reauthentication: "not-required" | "required" | "satisfied" }>,
  context: z.RefinementCtx
): void {
  if ((decision.outcome === "allow") !== (decision.reason === "granted")) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Only granted decisions may allow, and granted decisions must allow." });
  }
  if (decision.outcome === "allow" && (decision.approval === "required" || decision.reauthentication === "required")) {
    context.addIssue({ code: "custom", message: "Allowed decisions cannot leave approval or reauthentication unsatisfied." });
  }
}

export const authorizationContractsSchemaUrl = "https://schemas.k-nex.dev/authorization.v1.schema.json" as const;
export const AuthorizationContractValueSchema = z.union([
  AuthorizationPermissionDescriptorSchema,
  PermissionPolicyBindingSchema,
  ProtectedRoleBaselineSchema,
  RoleSchema,
  RolePermissionGrantSchema,
  RoleAssignmentSchema,
  RoleTemplateSchema,
  TemplateAdoptionSchema,
  PermissionCatalogSnapshotSchema,
  ExtensionAuthorizationGenerationSchema,
  AuthorizationStateSchema,
  BootstrapReceiptSchema,
  AuthorizationDecisionSchema,
  AuthorizationDecisionAuditSchema
]);

/** Canonical generated-schema/fixture envelope; persisted rows use the closed value schemas above. */
export const AuthorizationContractsSchema = z.strictObject({
  "$schema": z.literal(authorizationContractsSchemaUrl),
  contract: AuthorizationContractValueSchema
});

export type PermissionPublisherRef = z.infer<typeof PermissionPublisherRefSchema>;
export type ExtensionPermissionPublisherRef = z.infer<typeof ExtensionPermissionPublisherRefSchema>;
export type AuthorizationOwnerRef = z.infer<typeof AuthorizationOwnerRefSchema>;
export type ExtensionAuthorizationOwnerRef = z.infer<typeof ExtensionAuthorizationOwnerRefSchema>;
export type AuthorizationPermissionDescriptor = z.infer<typeof AuthorizationPermissionDescriptorSchema>;
export type PermissionPolicyBinding = z.infer<typeof PermissionPolicyBindingSchema>;
export type ProtectedRoleId = z.infer<typeof ProtectedRoleIdSchema>;
export type ProtectedRoleBaseline = z.infer<typeof ProtectedRoleBaselineSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type RolePermissionGrant = z.infer<typeof RolePermissionGrantSchema>;
export type AuthorizationSubject = z.infer<typeof AuthorizationSubjectSchema>;
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;
export type RoleTemplate = z.infer<typeof RoleTemplateSchema>;
export type TemplateAdoption = z.infer<typeof TemplateAdoptionSchema>;
export type PermissionCatalogSnapshot = z.infer<typeof PermissionCatalogSnapshotSchema>;
export type ExtensionAuthorizationGeneration = z.infer<typeof ExtensionAuthorizationGenerationSchema>;
export type AuthorizationState = z.infer<typeof AuthorizationStateSchema>;
export type BootstrapReceipt = z.infer<typeof BootstrapReceiptSchema>;
export type AuthorizationDecision = z.infer<typeof AuthorizationDecisionSchema>;
export type AuthorizationDecisionAudit = z.infer<typeof AuthorizationDecisionAuditSchema>;
export type AuthorizationContractValue = z.infer<typeof AuthorizationContractValueSchema>;
export type AuthorizationContracts = z.infer<typeof AuthorizationContractsSchema>;
