import * as z from "zod";

import {
  AuthorizationDelegationSchema,
  AuthorizationOwnerRefSchema,
  AuthorizationPermissionIdSchema,
  AuthorizationScopeSchema,
  AuthorizationSubjectSchema,
  PermissionPublisherRefSchema,
  isPermissionOwnedByOwner,
  isPermissionOwnedByPublisher
} from "./authorization.js";
import { canonicalJson } from "./canonical-json.js";
import { MillisecondTimestampSchema } from "./event.js";
import { ExtensionDeliveryClassSchema, ExtensionLifecycleStateSchema } from "./extension-runtime.js";
import { ResourceIdSchema } from "./identity.js";
import { pluginSettingFieldIssues, PluginSettingFieldSchema, PluginSettingValueSchema } from "./plugin-configuration.js";
import { uniqueArray } from "./schema-helpers.js";

const applicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const environmentSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const recordIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u);
const revisionSchema = z.number().finite().int().nonnegative().max(1_000_000_000);
const positiveRevisionSchema = z.number().finite().int().min(1).max(1_000_000_000);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const settingKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/u);
const settingsFieldLimit = 128;
const settingsSerializedBytesLimit = 16_384;
const safeFieldValueSchema = z.union([
  z.string().max(4_096),
  z.number().finite().safe(),
  z.boolean(),
  z.null(),
  uniqueArray(z.string().min(1).max(256)).max(128)
]);

function boundedSettingsRecord<T extends z.ZodType>(valueSchema: T, minimum = 0): z.ZodRecord<typeof settingKeySchema, T> {
  return z.record(settingKeySchema, valueSchema)
    .superRefine((value, context) => {
      const count = Object.keys(value).length;
      if (count < minimum || count > settingsFieldLimit) {
        context.addIssue({ code: "custom", message: `Settings records must contain ${minimum} through ${settingsFieldLimit} fields.` });
      }
      if (new TextEncoder().encode(canonicalJson(value)).byteLength > settingsSerializedBytesLimit) {
        context.addIssue({ code: "custom", message: "Settings records exceed the canonical byte limit." });
      }
    })
    .meta({ minProperties: minimum, maxProperties: settingsFieldLimit, kNexMaxCanonicalBytes: settingsSerializedBytesLimit });
}

const descriptorFieldsSchema = boundedSettingsRecord(PluginSettingFieldSchema, 1);
const storedSettingsValuesSchema = boundedSettingsRecord(PluginSettingValueSchema);
const browserSettingsValuesSchema = boundedSettingsRecord(safeFieldValueSchema, 1);

const settingsIdentityBase = {
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  descriptorId: ResourceIdSchema,
  owner: AuthorizationOwnerRefSchema,
  descriptorSchemaVersion: positiveRevisionSchema
} as const;

const administrationAuthorityPermissionSchema = z.strictObject({
  decisionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u).max(160),
  permissionId: AuthorizationPermissionIdSchema,
  owner: AuthorizationOwnerRefSchema,
  scope: AuthorizationScopeSchema
});

const administrationActorEnvelopeBase = {
  schemaVersion: z.literal(1),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  principal: AuthorizationSubjectSchema,
  effectiveActor: AuthorizationSubjectSchema,
  delegation: AuthorizationDelegationSchema.optional(),
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema,
  permissions: uniqueArray(administrationAuthorityPermissionSchema).min(1).max(4)
} as const;

/** Persist-safe originating actor, delegation, and concrete authority intents. */
export const AdministrationActorEnvelopeSchema = z.strictObject(administrationActorEnvelopeBase);

/** Persist-safe originating authority plus settings reauthentication metadata. */
export const AdministrationAuthorityEnvelopeSchema = z.strictObject({
  ...administrationActorEnvelopeBase,
  reauthentication: z.strictObject({
    evidenceId: recordIdSchema,
    verifiedAt: MillisecondTimestampSchema,
    expiresAt: MillisecondTimestampSchema
  })
}).superRefine((value, context) => {
  if (Date.parse(value.reauthentication.expiresAt) <= Date.parse(value.reauthentication.verifiedAt)) {
    context.addIssue({ code: "custom", path: ["reauthentication", "expiresAt"], message: "Reauthentication evidence must expire after verification." });
  }
});

/** Static trusted, closed data-only settings definition. */
export const SystemSettingsDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ResourceIdSchema,
  publisher: PermissionPublisherRefSchema,
  descriptorSchemaVersion: positiveRevisionSchema,
  validation: z.enum(["immediate", "generation-validated"]),
  fields: descriptorFieldsSchema,
  readPermission: ResourceIdSchema,
  changePermission: ResourceIdSchema
}).superRefine((descriptor, context) => {
  for (const path of [["id"], ["readPermission"], ["changePermission"]] as const) {
    const value = descriptor[path[0]];
    if (!isPermissionOwnedByPublisher(descriptor.publisher, value)) {
      context.addIssue({ code: "custom", path: [...path], message: "Settings descriptor IDs and permissions must use the static publisher namespace." });
    }
  }
  for (const issue of pluginSettingFieldIssues(descriptor.fields)) {
    context.addIssue({ code: "custom", path: ["fields", ...issue.path], message: issue.message });
  }
});

/** Immutable scope for a settings document; an extension owner includes its authorization generation. */
export const SettingsDocumentIdentitySchema = z.strictObject(settingsIdentityBase).superRefine((identity, context) => {
  if (!isPermissionOwnedByOwner(identity.owner, identity.descriptorId)) {
    context.addIssue({ code: "custom", path: ["descriptorId"], message: "Settings document identity must use its owner namespace." });
  }
});

const settingsDocumentBase = {
  schemaVersion: z.literal(1),
  identity: SettingsDocumentIdentitySchema,
  documentRevision: positiveRevisionSchema,
  settingsRevision: positiveRevisionSchema,
  values: storedSettingsValuesSchema
} as const;

/** The only document state applied by consumers. Secret references are permitted only in this non-administration value form. */
export const EffectiveSettingsDocumentSchema = z.strictObject({ ...settingsDocumentBase, state: z.literal("effective") });
/** A generation-fenced candidate. It remains non-effective until its exact owner generation promotes it. */
export const PendingSettingsCandidateSchema = z.strictObject({ ...settingsDocumentBase, state: z.literal("pending-generation-validation") });
export const SettingsStoredDocumentSchema = z.union([EffectiveSettingsDocumentSchema, PendingSettingsCandidateSchema]);

export const SettingsStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  settingsRevision: revisionSchema
});

/** Browser input intentionally has no application, descriptor, owner, generation, schema, or operation identity. */
export const SettingsChangeInputSchema = z.strictObject({
  expectedDocumentRevision: revisionSchema,
  expectedSettingsRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema,
  values: browserSettingsValuesSchema
});

/** Browser input for reviewed reinstall adoption; source and target generations are server-derived. */
export const SettingsAdoptionInputSchema = z.strictObject({
  expectedDocumentRevision: revisionSchema,
  expectedSettingsRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

/** Browser input selects only a host-configured opaque slot alias; provider keys never cross this boundary. */
export const SettingsSecretBindingInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("bind"),
    field: settingKeySchema,
    slotAlias: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/u),
    expectedDocumentRevision: revisionSchema,
    expectedSettingsRevision: revisionSchema,
    idempotencyKey: idempotencyKeySchema
  }),
  z.strictObject({
    action: z.literal("unbind"),
    field: settingKeySchema,
    expectedDocumentRevision: revisionSchema,
    expectedSettingsRevision: revisionSchema,
    idempotencyKey: idempotencyKeySchema
  })
]);

/** Mutable work record for a generation-validated write. Terminal results live only in SettingsTerminalReceipt. */
export const ResumableSettingsOperationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: recordIdSchema,
  identity: SettingsDocumentIdentitySchema,
  pendingDocument: PendingSettingsCandidateSchema,
  expectedDocumentRevision: revisionSchema,
  expectedSettingsRevision: revisionSchema,
  state: z.enum(["pending-validation", "validating", "promotion-blocked"]),
  attempts: z.number().finite().int().nonnegative().max(1_000_000),
  requestedBy: AuthorizationSubjectSchema,
  authorityDigest: digestSchema,
  idempotencyKey: idempotencyKeySchema,
  revision: positiveRevisionSchema,
  leaseOwner: recordIdSchema.optional(),
  leaseExpiresAt: MillisecondTimestampSchema.optional(),
  updatedAt: MillisecondTimestampSchema
}).superRefine((operation, context) => {
  if (operation.pendingDocument.identity.applicationId !== operation.identity.applicationId
    || operation.pendingDocument.identity.environment !== operation.identity.environment
    || operation.pendingDocument.identity.descriptorId !== operation.identity.descriptorId
    || operation.pendingDocument.identity.descriptorSchemaVersion !== operation.identity.descriptorSchemaVersion
    || JSON.stringify(operation.pendingDocument.identity.owner) !== JSON.stringify(operation.identity.owner)) {
    context.addIssue({ code: "custom", path: ["pendingDocument", "identity"], message: "A pending document must retain the exact operation identity." });
  }
  if ((operation.leaseOwner === undefined) !== (operation.leaseExpiresAt === undefined)
    || operation.state !== "validating" && operation.leaseOwner !== undefined) {
    context.addIssue({ code: "custom", path: ["leaseOwner"], message: "Only a validating operation may hold one complete lease." });
  }
});

const safeChangedFieldsSchema = uniqueArray(settingKeySchema).max(256);
const terminalSettingsReceiptBase = {
  schemaVersion: z.literal(1),
  receiptId: recordIdSchema,
  operationId: recordIdSchema,
  identity: SettingsDocumentIdentitySchema,
  requestedBy: AuthorizationSubjectSchema,
  authorityDigest: digestSchema,
  reauthentication: z.literal("satisfied"),
  idempotencyKey: idempotencyKeySchema,
  occurredAt: MillisecondTimestampSchema
} as const;

/** Immutable terminal evidence. It exposes changed field names, never values or secret-reference identifiers. */
export const SettingsTerminalReceiptSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    ...terminalSettingsReceiptBase,
    outcome: z.literal("promoted"),
    documentRevision: positiveRevisionSchema,
    settingsRevision: positiveRevisionSchema,
    changedFields: safeChangedFieldsSchema,
    invalidationId: recordIdSchema
  }),
  z.strictObject({
    ...terminalSettingsReceiptBase,
    outcome: z.enum(["validation-failed", "promotion-invalidated"]),
    reason: z.enum(["generation-not-current", "generation-not-ready", "schema-validation-failed", "descriptor-disabled", "permission-revoked"])
  })
]);

/** Safe invalidation payload for outbox/revision convergence. */
export const SettingsInvalidationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  invalidationId: recordIdSchema,
  identity: SettingsDocumentIdentitySchema,
  settingsRevision: positiveRevisionSchema,
  occurredAt: MillisecondTimestampSchema
});

const administrationProjectedFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("visible-value"), value: safeFieldValueSchema }),
  z.strictObject({ kind: z.literal("redacted-secret") }),
  z.strictObject({ kind: z.literal("unset") })
]);
const administrationFieldsSchema = boundedSettingsRecord(administrationProjectedFieldSchema);

function ownerMatchesDescriptorPublisher(owner: z.infer<typeof AuthorizationOwnerRefSchema>, publisher: z.infer<typeof PermissionPublisherRefSchema>): boolean {
  return owner.kind === "platform" && publisher.kind === "platform"
    ? owner.namespace === publisher.namespace
    : owner.kind === "extension" && publisher.kind === "extension"
      && owner.deliveryClass === publisher.deliveryClass && owner.extensionId === publisher.extensionId;
}

function projectedValueMatchesDefinition(
  definition: z.infer<typeof PluginSettingFieldSchema>,
  field: z.infer<typeof administrationProjectedFieldSchema>,
  waitingConfiguration: boolean
): boolean {
  if (field.kind === "unset") return waitingConfiguration || !definition.required;
  if (definition.type === "secret-reference") return field.kind === "redacted-secret";
  if (field.kind !== "visible-value") return false;
  const value = field.value;
  if (definition.type === "string") return typeof value === "string" && (definition.allowed === undefined || definition.allowed.includes(value));
  if (definition.type === "integer") return typeof value === "number" && Number.isSafeInteger(value)
    && (definition.minimum === undefined || value >= definition.minimum)
    && (definition.maximum === undefined || value <= definition.maximum);
  if (definition.type === "boolean") return typeof value === "boolean";
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** General-administration projection is descriptor-derived. Secret values and references are unrepresentable. */
export const SettingsAdministrationViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: SettingsDocumentIdentitySchema,
  descriptor: SystemSettingsDescriptorSchema,
  state: z.enum(["waiting-configuration", "effective", "pending-validation", "diagnostic-disabled", "diagnostic-retired"]),
  documentRevision: revisionSchema,
  settingsRevision: revisionSchema,
  fields: administrationFieldsSchema,
  pendingOperationId: recordIdSchema.optional()
}).superRefine((view, context) => {
  if (view.identity.descriptorId !== view.descriptor.id
    || view.identity.descriptorSchemaVersion !== view.descriptor.descriptorSchemaVersion
    || !ownerMatchesDescriptorPublisher(view.identity.owner, view.descriptor.publisher)) {
    context.addIssue({ code: "custom", path: ["descriptor"], message: "Administration projections must use their exact descriptor and owner publisher." });
  }
  const descriptorKeys = Object.keys(view.descriptor.fields).sort();
  const projectedKeys = Object.keys(view.fields).sort();
  if (descriptorKeys.length !== projectedKeys.length || descriptorKeys.some((key, index) => key !== projectedKeys[index])) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Administration projections must include exactly the descriptor-defined fields." });
  }
  for (const [key, field] of Object.entries(view.fields)) {
    const definition = view.descriptor.fields[key];
    if (definition === undefined) {
      context.addIssue({ code: "custom", path: ["fields", key], message: "Administration projections may expose only descriptor fields." });
    } else if (!projectedValueMatchesDefinition(definition, field, view.state === "waiting-configuration")) {
      context.addIssue({ code: "custom", path: ["fields", key], message: "Administration projection values and redaction must follow the descriptor field definition." });
    }
  }
});

const catalogSnapshotSchema = z.strictObject({
  sequence: positiveRevisionSchema,
  digest: digestSchema,
  releaseCount: z.number().finite().int().nonnegative().max(10_000),
  observedAt: MillisecondTimestampSchema
});

const catalogRefreshObservationBase = {
  schemaVersion: z.literal(1),
  catalogRevision: revisionSchema
} as const;

/** Read-only catalog pointer projection. It intentionally omits transport URL, signer and trust-root material. */
export const CatalogRefreshObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...catalogRefreshObservationBase, state: z.literal("no-accepted-snapshot") }),
  z.strictObject({ ...catalogRefreshObservationBase, state: z.literal("staged-reconciliation"), staged: catalogSnapshotSchema, accepted: catalogSnapshotSchema.optional() }),
  z.strictObject({ ...catalogRefreshObservationBase, state: z.literal("accepted"), accepted: catalogSnapshotSchema })
]);

/** Browser input has no catalog endpoint, signer, trust key, release, repository, ref, or URL selector. */
export const CatalogRefreshInputSchema = z.strictObject({
  expectedCatalogRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

const resumableCatalogRefreshOperationBase = {
  schemaVersion: z.literal(1),
  refreshId: recordIdSchema,
  expectedCatalogRevision: revisionSchema,
  requestedBy: AuthorizationSubjectSchema,
  authorityDigest: digestSchema,
  idempotencyKey: idempotencyKeySchema,
  revision: positiveRevisionSchema,
  updatedAt: MillisecondTimestampSchema
} as const;

/** Mutable refresh work. A staged snapshot remains fail-closed until reconciliation atomically terminalizes it. */
export const ResumableCatalogRefreshOperationSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...resumableCatalogRefreshOperationBase, state: z.literal("fetching") }),
  z.strictObject({ ...resumableCatalogRefreshOperationBase, state: z.literal("staged-reconciliation"), staged: catalogSnapshotSchema })
]);

/** Immutable safe result for a catalog refresh. A staged snapshot cannot be represented as accepted. */
export const CatalogRefreshReceiptSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    schemaVersion: z.literal(1),
    receiptId: recordIdSchema,
    refreshId: recordIdSchema,
    outcome: z.literal("accepted"),
    catalogRevision: positiveRevisionSchema,
    accepted: catalogSnapshotSchema,
    reconciledReleaseCount: z.number().finite().int().nonnegative().max(10_000),
    requestedBy: AuthorizationSubjectSchema,
    authorityDigest: digestSchema,
    idempotencyKey: idempotencyKeySchema,
    occurredAt: MillisecondTimestampSchema
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    receiptId: recordIdSchema,
    refreshId: recordIdSchema,
    outcome: z.literal("rejected"),
    reason: z.enum(["stale-revision", "fetch-failed", "snapshot-invalid", "snapshot-replayed"]),
    requestedBy: AuthorizationSubjectSchema,
    authorityDigest: digestSchema,
    idempotencyKey: idempotencyKeySchema,
    occurredAt: MillisecondTimestampSchema
  })
]);

const settingsOperationReferenceSchema = z.strictObject({ source: z.literal("settings-operation"), operationId: recordIdSchema, receiptId: recordIdSchema.optional() });
const catalogRefreshReferenceSchema = z.strictObject({ source: z.literal("catalog-refresh"), refreshId: recordIdSchema, receiptId: recordIdSchema.optional() });
const extensionOperationReferenceSchema = z.strictObject({ source: z.literal("extension-operation"), operationId: recordIdSchema, receiptId: recordIdSchema.optional() });
const deploymentReferenceSchema = z.strictObject({ source: z.literal("deployment"), receiptId: recordIdSchema });
const themePublicationReferenceSchema = z.strictObject({ source: z.literal("theme-publication"), receiptId: recordIdSchema });
const backupReferenceSchema = z.strictObject({ source: z.literal("backup"), operationId: recordIdSchema, receiptId: recordIdSchema.optional() });
const restoreDrillReferenceSchema = z.strictObject({ source: z.literal("restore-drill"), operationId: recordIdSchema, receiptId: recordIdSchema.optional() });
const pendingBackupReferenceSchema = z.strictObject({ source: z.literal("backup"), operationId: recordIdSchema });
const pendingRestoreDrillReferenceSchema = z.strictObject({ source: z.literal("restore-drill"), operationId: recordIdSchema });
const terminalBackupReferenceSchema = z.strictObject({ source: z.literal("backup"), operationId: recordIdSchema, receiptId: recordIdSchema });
const terminalRestoreDrillReferenceSchema = z.strictObject({ source: z.literal("restore-drill"), operationId: recordIdSchema, receiptId: recordIdSchema });

export const OperationsCenterReferenceSchema = z.discriminatedUnion("source", [
  settingsOperationReferenceSchema,
  catalogRefreshReferenceSchema,
  extensionOperationReferenceSchema,
  deploymentReferenceSchema,
  themePublicationReferenceSchema,
  backupReferenceSchema,
  restoreDrillReferenceSchema
]);

/** Request form input carries only concurrency and idempotency proof; target/inventory/authority are server derived. */
export const OperationsCenterRequestInputSchema = z.strictObject({
  expectedOperationsRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
});

/** A projection-bound request, never an independent operation-state machine. */
const operationsCenterRequestBase = {
  schemaVersion: z.literal(1),
  requestId: recordIdSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  expectedOperationsRevision: revisionSchema,
  expectedInventoryDigest: digestSchema,
  requestedBy: AuthorizationSubjectSchema,
  authorityDigest: digestSchema,
  idempotencyKey: idempotencyKeySchema,
  createdAt: MillisecondTimestampSchema
} as const;

export const OperationsCenterRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...operationsCenterRequestBase, kind: z.literal("backup"), reference: pendingBackupReferenceSchema }),
  z.strictObject({ ...operationsCenterRequestBase, kind: z.literal("restore-drill"), reference: pendingRestoreDrillReferenceSchema })
]);

/** Immutable safe receipt projected from the owning operator. No raw operator errors or credentials are representable. */
const operationsCenterReceiptBase = {
  schemaVersion: z.literal(1),
  receiptId: recordIdSchema,
  requestId: recordIdSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  expectedInventoryDigest: digestSchema,
  requestedBy: AuthorizationSubjectSchema,
  authorityDigest: digestSchema,
  idempotencyKey: idempotencyKeySchema,
  occurredAt: MillisecondTimestampSchema
} as const;

export const OperationsCenterReceiptSchema = z.union([
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("backup"), reference: pendingBackupReferenceSchema, outcome: z.literal("accepted"), reason: z.literal("accepted") }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("restore-drill"), reference: pendingRestoreDrillReferenceSchema, outcome: z.literal("accepted"), reason: z.literal("accepted") }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("backup"), reference: terminalBackupReferenceSchema, outcome: z.literal("completed"), reason: z.literal("completed") }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("restore-drill"), reference: terminalRestoreDrillReferenceSchema, outcome: z.literal("completed"), reason: z.literal("completed") }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("backup"), reference: terminalBackupReferenceSchema, outcome: z.literal("rejected"), reason: z.enum(["approval-required", "stale-revision", "inventory-changed"]) }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("restore-drill"), reference: terminalRestoreDrillReferenceSchema, outcome: z.literal("rejected"), reason: z.enum(["approval-required", "stale-revision", "inventory-changed"]) }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("backup"), reference: terminalBackupReferenceSchema, outcome: z.literal("failed"), reason: z.enum(["operator-unavailable", "verification-failed"]) }),
  z.strictObject({ ...operationsCenterReceiptBase, kind: z.literal("restore-drill"), reference: terminalRestoreDrillReferenceSchema, outcome: z.literal("failed"), reason: z.enum(["operator-unavailable", "verification-failed"]) })
]);

/** Derived health only. Client-reported health, raw errors, URLs and credentials are not part of this contract. */
export const SystemHealthObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observationId: recordIdSchema,
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  source: z.enum(["catalog", "extension-runtime", "deployment", "worker-fence", "backup", "migration", "theme-publication"]),
  state: z.enum(["ready", "degraded", "not-ready"]),
  revision: positiveRevisionSchema,
  checkIds: uniqueArray(ResourceIdSchema).min(1).max(64),
  observedAt: MillisecondTimestampSchema
});

const extensionAdministrationActionBase = {
  id: ResourceIdSchema,
  deliveryClass: ExtensionDeliveryClassSchema,
  lifecycleState: ExtensionLifecycleStateSchema,
  availability: z.enum(["available", "unavailable", "maintenance-required"]),
  impactDigest: digestSchema.optional(),
  operationReference: OperationsCenterReferenceSchema.optional()
} as const;

const executableExtensionAction = {
  reauthentication: z.literal("required")
} as const;

/** Server-owned action policy. A browser cannot substitute delivery, permission, approval, or reauthentication. */
export const ExtensionAdministrationActionViewSchema = z.union([
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, deliveryClass: z.literal("hot-application"), action: z.literal("install"), executableOperation: z.literal("install"), permissionId: z.literal("system.extensions.install-live"), approval: z.literal("canonical-plan") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, deliveryClass: z.literal("theme-skin"), action: z.literal("install"), executableOperation: z.literal("install"), permissionId: z.literal("system.extensions.install-live"), approval: z.literal("canonical-plan") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, deliveryClass: z.literal("platform-plugin"), action: z.literal("install"), executableOperation: z.literal("install"), permissionId: z.literal("system.extensions.deploy-platform-plugin"), approval: z.literal("required") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, action: z.literal("re-enable"), executableOperation: z.literal("install"), permissionId: z.literal("system.extensions.enable"), approval: z.literal("canonical-plan") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, action: z.literal("update"), executableOperation: z.literal("update"), permissionId: z.literal("system.extensions.update"), approval: z.literal("canonical-plan") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, action: z.literal("disable"), executableOperation: z.literal("disable"), permissionId: z.literal("system.extensions.disable"), approval: z.literal("canonical-plan") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, action: z.literal("rollback"), executableOperation: z.literal("rollback"), permissionId: z.literal("system.extensions.rollback"), approval: z.literal("canonical-plan") }),
  z.strictObject({ ...extensionAdministrationActionBase, ...executableExtensionAction, action: z.literal("uninstall"), executableOperation: z.literal("uninstall"), permissionId: z.literal("system.extensions.uninstall"), approval: z.literal("required") })
]);

export const systemAdministrationContractsSchemaUrl = "https://schemas.k-nex.dev/system-administration/v1.schema.json" as const;
export const SystemAdministrationContractValueSchema = z.union([
  SystemSettingsDescriptorSchema,
  EffectiveSettingsDocumentSchema,
  PendingSettingsCandidateSchema,
  SettingsStoredDocumentSchema,
  SettingsStateSchema,
  SettingsChangeInputSchema,
  SettingsSecretBindingInputSchema,
  ResumableSettingsOperationSchema,
  SettingsTerminalReceiptSchema,
  SettingsInvalidationSchema,
  SettingsAdministrationViewSchema,
  CatalogRefreshObservationSchema,
  CatalogRefreshInputSchema,
  ResumableCatalogRefreshOperationSchema,
  CatalogRefreshReceiptSchema,
  OperationsCenterRequestInputSchema,
  OperationsCenterRequestSchema,
  OperationsCenterReceiptSchema,
  SystemHealthObservationSchema,
  ExtensionAdministrationActionViewSchema
]);

export const SystemAdministrationContractsSchema = z.strictObject({
  "$schema": z.literal(systemAdministrationContractsSchemaUrl),
  contract: SystemAdministrationContractValueSchema
});

export type SystemSettingsDescriptor = z.infer<typeof SystemSettingsDescriptorSchema>;
export type AdministrationAuthorityEnvelope = z.infer<typeof AdministrationAuthorityEnvelopeSchema>;
export type AdministrationActorEnvelope = z.infer<typeof AdministrationActorEnvelopeSchema>;
export type SystemSettingsFieldDescriptor = z.infer<typeof PluginSettingFieldSchema>;
export type SettingsDocumentIdentity = z.infer<typeof SettingsDocumentIdentitySchema>;
export type EffectiveSettingsDocument = z.infer<typeof EffectiveSettingsDocumentSchema>;
export type PendingSettingsCandidate = z.infer<typeof PendingSettingsCandidateSchema>;
export type SettingsStoredDocument = z.infer<typeof SettingsStoredDocumentSchema>;
export type SettingsState = z.infer<typeof SettingsStateSchema>;
export type SettingsChangeInput = z.infer<typeof SettingsChangeInputSchema>;
export type SettingsAdoptionInput = z.infer<typeof SettingsAdoptionInputSchema>;
export type SettingsSecretBindingInput = z.infer<typeof SettingsSecretBindingInputSchema>;
export type ResumableSettingsOperation = z.infer<typeof ResumableSettingsOperationSchema>;
export type SettingsTerminalReceipt = z.infer<typeof SettingsTerminalReceiptSchema>;
export type SettingsInvalidation = z.infer<typeof SettingsInvalidationSchema>;
export type SettingsAdministrationView = z.infer<typeof SettingsAdministrationViewSchema>;
export type CatalogRefreshObservation = z.infer<typeof CatalogRefreshObservationSchema>;
export type CatalogRefreshInput = z.infer<typeof CatalogRefreshInputSchema>;
export type ResumableCatalogRefreshOperation = z.infer<typeof ResumableCatalogRefreshOperationSchema>;
export type CatalogRefreshReceipt = z.infer<typeof CatalogRefreshReceiptSchema>;
export type OperationsCenterReference = z.infer<typeof OperationsCenterReferenceSchema>;
export type OperationsCenterRequestInput = z.infer<typeof OperationsCenterRequestInputSchema>;
export type OperationsCenterRequest = z.infer<typeof OperationsCenterRequestSchema>;
export type OperationsCenterReceipt = z.infer<typeof OperationsCenterReceiptSchema>;
export type SystemHealthObservation = z.infer<typeof SystemHealthObservationSchema>;
export type ExtensionAdministrationActionView = z.infer<typeof ExtensionAdministrationActionViewSchema>;
export type SystemAdministrationContractValue = z.infer<typeof SystemAdministrationContractValueSchema>;
export type SystemAdministrationContracts = z.infer<typeof SystemAdministrationContractsSchema>;
