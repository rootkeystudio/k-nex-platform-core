import { describe, expect, it } from "vitest";

import {
  CatalogRefreshInputSchema,
  CatalogRefreshObservationSchema,
  CatalogRefreshReceiptSchema,
  ExtensionAdministrationActionViewSchema,
  OperationsCenterReceiptSchema,
  OperationsCenterRequestInputSchema,
  OperationsCenterRequestSchema,
  ResumableCatalogRefreshOperationSchema,
  ResumableSettingsOperationSchema,
  SettingsAdministrationViewSchema,
  SettingsChangeInputSchema,
  SettingsInvalidationSchema,
  SettingsStoredDocumentSchema,
  SettingsTerminalReceiptSchema,
  SystemHealthObservationSchema,
  SystemSettingsDescriptorSchema
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const authorityDigest = digest("d");
const timestamp = "2026-09-02T12:00:00.000Z";
const publisher = { kind: "extension", deliveryClass: "hot-application", extensionId: "app.sales.reports" } as const;
const owner = { ...publisher, generation: 7 } as const;
const identity = { applicationId: "customer-alpha", environment: "production", descriptorId: "sales.reports.settings", owner, descriptorSchemaVersion: 2 } as const;
const stored = { schemaVersion: 1, identity, state: "effective", documentRevision: 3, settingsRevision: 8, values: { pageSize: 50, apiToken: { kind: "secret-reference", provider: "environment", key: "SALES_REPORTS_TOKEN" } } } as const;
const descriptor = {
  schemaVersion: 1,
  id: identity.descriptorId,
  publisher,
  descriptorSchemaVersion: identity.descriptorSchemaVersion,
  validation: "generation-validated",
  fields: {
    apiToken: { required: true, type: "secret-reference" },
    pageSize: { required: true, type: "integer", default: 50, minimum: 1, maximum: 500 }
  },
  readPermission: "sales.reports.settings.read",
  changePermission: "sales.reports.settings.manage"
} as const;

describe("P11.1 system administration contracts", () => {
  it("freezes static settings descriptors and owner-generation document identity", () => {
    expect(SystemSettingsDescriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, id: "system.settings" }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, readPermission: "system.settings.read" }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, descriptorSchemaVersion: 0 }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, fields: { ...descriptor.fields, apiToken: { required: true, type: "string" } } }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, fields: { ...descriptor.fields, entrypoint: { required: false, type: "string" } } }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, fields: { ...descriptor.fields, pageSize: { required: true, type: "integer", minimum: 10, maximum: 1 } } }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, fields: { ...descriptor.fields, pageSize: { required: true, type: "integer", default: 10, maximum: 5 } } }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, fields: { ...descriptor.fields, mode: { required: true, type: "string", default: "unsafe", allowed: ["safe"] } } }).success).toBe(false);
    expect(SystemSettingsDescriptorSchema.safeParse({ ...descriptor, schemaDigest: digest("a") }).success).toBe(false);
    expect(SettingsStoredDocumentSchema.safeParse(stored).success).toBe(true);
    expect(SettingsStoredDocumentSchema.safeParse({ ...stored, identity: { ...identity, owner: { ...owner, generation: 8 } } }).success).toBe(true);
    expect(SettingsStoredDocumentSchema.safeParse({ ...stored, identity: { ...identity, descriptorId: "other.settings" } }).success).toBe(false);
  });

  it("separates client input, mutable validation work, immutable terminal evidence, and invalidation", () => {
    const input = { expectedDocumentRevision: 3, expectedSettingsRevision: 8, idempotencyKey: "settings-change-1", values: { pageSize: 100 } } as const;
    expect(SettingsChangeInputSchema.safeParse(input).success).toBe(true);
    expect(SettingsChangeInputSchema.safeParse({ ...input, owner }).success).toBe(false);
    expect(SettingsChangeInputSchema.safeParse({ ...input, values: { apiToken: stored.values.apiToken } }).success).toBe(false);
    expect(SettingsChangeInputSchema.safeParse({ ...input, values: {} }).success).toBe(false);

    const operation = { schemaVersion: 1, operationId: "settings-operation-1", identity, pendingDocument: { ...stored, state: "pending-generation-validation", documentRevision: 4 }, expectedDocumentRevision: 3, expectedSettingsRevision: 8, state: "pending-validation", attempts: 0, requestedBy: { kind: "user", id: "user-1" }, authorityDigest, idempotencyKey: input.idempotencyKey, revision: 1, updatedAt: timestamp } as const;
    expect(ResumableSettingsOperationSchema.safeParse(operation).success).toBe(true);
    expect(ResumableSettingsOperationSchema.safeParse({ ...operation, state: "promoted" }).success).toBe(false);
    expect(ResumableSettingsOperationSchema.safeParse({ ...operation, pendingDocument: { ...operation.pendingDocument, identity: { ...identity, environment: "staging" } } }).success).toBe(false);

    const receipt = { schemaVersion: 1, receiptId: "settings-receipt-1", operationId: operation.operationId, identity, requestedBy: operation.requestedBy, authorityDigest, reauthentication: "satisfied", idempotencyKey: input.idempotencyKey, occurredAt: timestamp, outcome: "promoted", documentRevision: 4, settingsRevision: 9, changedFields: ["pageSize"], invalidationId: "settings-invalidation-1" } as const;
    expect(SettingsTerminalReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(SettingsTerminalReceiptSchema.safeParse({ ...receipt, values: { apiToken: stored.values.apiToken } }).success).toBe(false);
    expect(SettingsInvalidationSchema.safeParse({ schemaVersion: 1, invalidationId: receipt.invalidationId, identity, settingsRevision: 9, occurredAt: timestamp }).success).toBe(true);
  });

  it("redacts secret references from administration views", () => {
    const view = { schemaVersion: 1, identity, descriptor, state: "effective", documentRevision: 3, settingsRevision: 8, fields: { apiToken: { kind: "redacted-secret" }, pageSize: { kind: "visible-value", value: 50 } } } as const;
    expect(SettingsAdministrationViewSchema.safeParse(view).success).toBe(true);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, documentRevision: 0, settingsRevision: 0 }).success).toBe(true);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, fields: { apiToken: { kind: "visible-value", value: "SALES_REPORTS_TOKEN" } } }).success).toBe(false);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, fields: {} }).success).toBe(false);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, fields: { apiToken: { kind: "redacted-secret" }, pageSize: { kind: "visible-value", value: "not-an-integer" } } }).success).toBe(false);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, fields: { apiToken: { kind: "redacted-secret" }, pageSize: { kind: "visible-value", value: 501 } } }).success).toBe(false);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, secretReferences: { apiToken: "SALES_REPORTS_TOKEN" } }).success).toBe(false);

    const optionalDescriptor = { ...descriptor, fields: { label: { required: false, type: "string" } } } as const;
    const optionalView = { ...view, descriptor: optionalDescriptor, fields: { label: { kind: "unset" } } } as const;
    expect(SettingsAdministrationViewSchema.safeParse(optionalView).success).toBe(true);
    expect(SettingsAdministrationViewSchema.safeParse({ ...view, fields: { apiToken: { kind: "redacted-secret" }, pageSize: { kind: "unset" } } }).success).toBe(false);
  });

  it("keeps catalog transport and trust selection out of client input while distinguishing staged and accepted state", () => {
    const input = { expectedCatalogRevision: 4, idempotencyKey: "catalog-refresh-1" } as const;
    expect(CatalogRefreshInputSchema.safeParse(input).success).toBe(true);
    expect(CatalogRefreshInputSchema.safeParse({ ...input, url: "https://evil.test/catalog" }).success).toBe(false);
    const accepted = { sequence: 4, digest: digest("b"), releaseCount: 2, observedAt: timestamp } as const;
    expect(CatalogRefreshObservationSchema.safeParse({ schemaVersion: 1, catalogRevision: 4, state: "accepted", accepted }).success).toBe(true);
    expect(CatalogRefreshObservationSchema.safeParse({ schemaVersion: 1, catalogRevision: 5, state: "staged-reconciliation", staged: accepted, accepted }).success).toBe(true);
    expect(CatalogRefreshObservationSchema.safeParse({ schemaVersion: 1, catalogRevision: 5, state: "staged-reconciliation", accepted }).success).toBe(false);
    expect(CatalogRefreshObservationSchema.safeParse({ schemaVersion: 1, catalogRevision: 5, state: "accepted", staged: accepted, accepted }).success).toBe(false);
    const operation = { schemaVersion: 1, refreshId: "catalog-refresh-1", expectedCatalogRevision: 4, state: "staged-reconciliation", staged: { ...accepted, sequence: 5 }, requestedBy: { kind: "user", id: "user-1" }, authorityDigest, idempotencyKey: input.idempotencyKey, revision: 2, updatedAt: timestamp } as const;
    expect(ResumableCatalogRefreshOperationSchema.safeParse(operation).success).toBe(true);
    expect(ResumableCatalogRefreshOperationSchema.safeParse({ ...operation, state: "fetching" }).success).toBe(false);
    expect(ResumableCatalogRefreshOperationSchema.safeParse({ ...operation, staged: undefined }).success).toBe(false);
    const receipt = { schemaVersion: 1, receiptId: "catalog-receipt-1", refreshId: "catalog-refresh-1", outcome: "accepted", catalogRevision: 5, accepted: { ...accepted, sequence: 5 }, reconciledReleaseCount: 2, requestedBy: { kind: "user", id: "user-1" }, authorityDigest, idempotencyKey: input.idempotencyKey, occurredAt: timestamp } as const;
    expect(CatalogRefreshReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(CatalogRefreshReceiptSchema.safeParse({ ...receipt, signer: "untrusted" }).success).toBe(false);
    expect(CatalogRefreshReceiptSchema.safeParse({ schemaVersion: 1, receiptId: "catalog-receipt-2", refreshId: "catalog-refresh-1", outcome: "rejected", reason: "security-reconciliation-pending", requestedBy: operation.requestedBy, idempotencyKey: input.idempotencyKey, occurredAt: timestamp }).success).toBe(false);
  });

  it("models operations as projection-bound requests/receipts and health as derived observations", () => {
    const input = { expectedOperationsRevision: 4, idempotencyKey: "backup-request-1" } as const;
    expect(OperationsCenterRequestInputSchema.safeParse(input).success).toBe(true);
    expect(OperationsCenterRequestInputSchema.safeParse({ ...input, target: "database" }).success).toBe(false);
    const request = { schemaVersion: 1, requestId: "operations-request-1", kind: "backup", applicationId: "customer-alpha", environment: "production", expectedOperationsRevision: 4, expectedInventoryDigest: digest("c"), requestedBy: { kind: "user", id: "user-1" }, authorityDigest, idempotencyKey: input.idempotencyKey, reference: { source: "backup", operationId: "backup-operation-1" }, createdAt: timestamp } as const;
    expect(OperationsCenterRequestSchema.safeParse(request).success).toBe(true);
    expect(OperationsCenterRequestSchema.safeParse({ ...request, reference: { source: "restore-drill", operationId: "restore-drill-operation-1" } }).success).toBe(false);
    expect(OperationsCenterRequestSchema.safeParse({ ...request, reference: { ...request.reference, receiptId: "backup-receipt-1" } }).success).toBe(false);
    const receipt = { schemaVersion: 1, receiptId: "operations-receipt-1", requestId: request.requestId, kind: "backup", applicationId: request.applicationId, environment: request.environment, expectedInventoryDigest: request.expectedInventoryDigest, requestedBy: request.requestedBy, authorityDigest, idempotencyKey: request.idempotencyKey, reference: { ...request.reference, receiptId: "backup-receipt-1" }, outcome: "completed", reason: "completed", occurredAt: timestamp } as const;
    expect(OperationsCenterReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(OperationsCenterReceiptSchema.safeParse({ ...receipt, outcome: "completed", reason: "approval-required" }).success).toBe(false);
    expect(OperationsCenterReceiptSchema.safeParse({ ...receipt, outcome: "rejected", reason: "verification-failed" }).success).toBe(false);
    expect(OperationsCenterReceiptSchema.safeParse({ ...receipt, reference: { source: "restore-drill", operationId: "restore-drill-operation-1", receiptId: "restore-drill-receipt-1" } }).success).toBe(false);
    expect(OperationsCenterReceiptSchema.safeParse({ ...receipt, reference: { source: "backup", operationId: "backup-operation-1" } }).success).toBe(false);
    expect(OperationsCenterReceiptSchema.safeParse({ ...receipt, error: "raw operator failure" }).success).toBe(false);
    expect(SystemHealthObservationSchema.safeParse({ schemaVersion: 1, observationId: "health-observation-1", applicationId: "customer-alpha", environment: "production", source: "backup", state: "ready", revision: 9, checkIds: ["system.operations.backup"], observedAt: timestamp }).success).toBe(true);
  });

  it("freezes extension action authorization by action and delivery class", () => {
    const base = { id: "sales.reports", lifecycleState: "disabled", reauthentication: "required", availability: "available" } as const;
    const cases = [
      { ...base, deliveryClass: "hot-application", action: "install", executableOperation: "install", permissionId: "system.extensions.install-live", approval: "canonical-plan" },
      { ...base, deliveryClass: "theme-skin", action: "install", executableOperation: "install", permissionId: "system.extensions.install-live", approval: "canonical-plan" },
      { ...base, deliveryClass: "platform-plugin", action: "install", executableOperation: "install", permissionId: "system.extensions.deploy-platform-plugin", approval: "required" },
      { ...base, deliveryClass: "hot-application", action: "re-enable", executableOperation: "install", permissionId: "system.extensions.enable", approval: "canonical-plan" },
      { ...base, deliveryClass: "hot-application", action: "update", executableOperation: "update", permissionId: "system.extensions.update", approval: "canonical-plan" },
      { ...base, deliveryClass: "hot-application", action: "disable", executableOperation: "disable", permissionId: "system.extensions.disable", approval: "canonical-plan" },
      { ...base, deliveryClass: "hot-application", action: "rollback", executableOperation: "rollback", permissionId: "system.extensions.rollback", approval: "canonical-plan" },
      { ...base, deliveryClass: "hot-application", action: "uninstall", executableOperation: "uninstall", permissionId: "system.extensions.uninstall", approval: "required" }
    ] as const;
    for (const action of cases) expect(ExtensionAdministrationActionViewSchema.safeParse(action).success).toBe(true);
    expect(ExtensionAdministrationActionViewSchema.safeParse({ ...cases[0], permissionId: "system.extensions.enable" }).success).toBe(false);
    expect(ExtensionAdministrationActionViewSchema.safeParse({ ...cases[2], approval: "canonical-plan" }).success).toBe(false);
    expect(ExtensionAdministrationActionViewSchema.safeParse({ ...cases[3], executableOperation: "update" }).success).toBe(false);
    expect(ExtensionAdministrationActionViewSchema.safeParse({ ...cases[4], reauthentication: "not-required" }).success).toBe(false);
  });
});
