import {
  AuthorizationSubjectSchema,
  EffectiveSettingsDocumentSchema,
  PendingSettingsCandidateSchema,
  ResumableSettingsOperationSchema,
  SettingsDocumentIdentitySchema,
  SettingsInvalidationSchema,
  SettingsStateSchema,
  SettingsTerminalReceiptSchema,
  canonicalJson,
  type AuthorizationSubject,
  type EffectiveSettingsDocument,
  type ResumableSettingsOperation,
  type SettingsDocumentIdentity,
  type SettingsInvalidation,
  type SettingsState,
  type SettingsTerminalReceipt
} from "@k-nex/contracts";

import type { RuntimeExtensionPool, RuntimeExtensionSession } from "./runtime-extension-store.js";

export type SystemSettingsStoreErrorCode = "INVALID" | "REVISION" | "IDEMPOTENCY" | "STATE";

export class SystemSettingsStoreError extends Error {
  constructor(readonly code: SystemSettingsStoreErrorCode, message: string) {
    super(message);
    this.name = "SystemSettingsStoreError";
  }
}

export interface SystemSettingsSnapshot {
  readonly state: SettingsState;
  readonly document?: EffectiveSettingsDocument;
}

export interface ImmediateSystemSettingsWrite {
  readonly identity: unknown;
  readonly document: Readonly<{
    readonly expectedDocumentRevision: unknown;
    readonly expectedSettingsRevision: unknown;
    readonly values: unknown;
  }>;
  readonly operation: Readonly<{ readonly operationId: unknown; readonly idempotencyKey: unknown }>;
  readonly receipt: Readonly<{ readonly receiptId: unknown; readonly invalidationId: unknown; readonly occurredAt: unknown }>;
  readonly actor: unknown;
  readonly auditId: unknown;
  readonly changedFields: unknown;
}

interface StateRow { settings_revision: number | string; }
interface DocumentRow {
  owner_kind: string;
  owner_namespace: string | null;
  owner_delivery_class: string | null;
  owner_extension_id: string | null;
  owner_generation: number | string | null;
  document_revision: number | string;
  settings_revision: number | string;
  values_json: unknown;
}
interface ReceiptRow {
  receipt_id: string;
  operation_id: string;
  application_id: string;
  environment: string;
  descriptor_id: string;
  descriptor_schema_version: number | string;
  owner_scope_key: string;
  owner_kind: string;
  owner_namespace: string | null;
  owner_delivery_class: string | null;
  owner_extension_id: string | null;
  owner_generation: number | string | null;
  requested_by_kind: string;
  requested_by_id: string;
  idempotency_key: string;
  request_digest: string;
  outcome: string;
  receipt_json: unknown;
  occurred_at: unknown;
}

interface OperationRow {
  operation_id: string;
  application_id: string;
  environment: string;
  descriptor_id: string;
  descriptor_schema_version: number | string;
  owner_scope_key: string;
  owner_kind: string;
  owner_namespace: string | null;
  owner_delivery_class: string | null;
  owner_extension_id: string | null;
  owner_generation: number | string | null;
  pending_document_json: unknown;
  expected_document_revision: number | string;
  expected_settings_revision: number | string;
  state: string;
  attempts: number | string;
  requested_by_kind: string;
  requested_by_id: string;
  idempotency_key: string;
  request_digest: string;
  revision: number | string;
  updated_at: unknown;
}

interface ParsedWrite {
  readonly identity: SettingsDocumentIdentity;
  readonly expectedDocumentRevision: number;
  readonly expectedSettingsRevision: number;
  readonly values: EffectiveSettingsDocument["values"];
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly receiptId: string;
  readonly invalidationId: string;
  readonly occurredAt: string;
  readonly actor: AuthorizationSubject;
  readonly auditId: string;
  readonly changedFields: readonly string[];
  readonly requestDigest: string;
}

interface OwnerColumns {
  readonly ownerKind: string;
  readonly ownerNamespace: string | null;
  readonly ownerDeliveryClass: string | null;
  readonly ownerExtensionId: string | null;
  readonly ownerGeneration: number | null;
  readonly ownerScopeKey: string;
}

export interface GenerationValidatedSystemSettingsWrite extends ImmediateSystemSettingsWrite {}

export interface SettingsOperationIdentity {
  readonly identity: unknown;
  readonly operationId: unknown;
}

export interface SettingsOperationTransition extends SettingsOperationIdentity {
  readonly expectedOperationRevision: unknown;
  readonly state: unknown;
}

export interface SettingsOperationPromotion extends GenerationValidatedSystemSettingsWrite {
  readonly expectedOperationRevision: unknown;
}

export interface SettingsOperationFailure extends SettingsOperationPromotion {
  readonly reason: unknown;
}

function fail(code: SystemSettingsStoreErrorCode, message: string): never {
  throw new SystemSettingsStoreError(code, message);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID", "System settings input is invalid.");
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) fail("INVALID", "System settings input is invalid.");
  return object;
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail("INVALID", "System settings input is invalid.");
  return result.data;
}

function positiveOrZero(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) fail("INVALID", "System settings input is invalid.");
  return value;
}

function parseOperationId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,127}$/u.test(value)) fail("INVALID", "System settings input is invalid.");
  return value;
}

function integer(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) fail("STATE", "Stored system settings state is invalid.");
  return result;
}

function ownerColumns(identity: SettingsDocumentIdentity): OwnerColumns {
  if (identity.owner.kind === "platform") {
    return {
      ownerKind: "platform",
      ownerNamespace: identity.owner.namespace,
      ownerDeliveryClass: null,
      ownerExtensionId: null,
      ownerGeneration: null,
      ownerScopeKey: "platform:system"
    };
  }
  return {
    ownerKind: "extension",
    ownerNamespace: null,
    ownerDeliveryClass: identity.owner.deliveryClass,
    ownerExtensionId: identity.owner.extensionId,
    ownerGeneration: identity.owner.generation,
    ownerScopeKey: `${identity.owner.deliveryClass}:${identity.owner.extensionId}:${identity.owner.generation}`
  };
}

function identityMatches(row: DocumentRow, identity: SettingsDocumentIdentity): boolean {
  const owner = ownerColumns(identity);
  return row.owner_kind === owner.ownerKind && row.owner_namespace === owner.ownerNamespace
    && row.owner_delivery_class === owner.ownerDeliveryClass && row.owner_extension_id === owner.ownerExtensionId
    && (row.owner_generation === null ? null : integer(row.owner_generation)) === owner.ownerGeneration;
}

function document(identity: SettingsDocumentIdentity, row: DocumentRow): EffectiveSettingsDocument {
  if (!identityMatches(row, identity)) fail("STATE", "Stored system settings document identity is invalid.");
  return parse(EffectiveSettingsDocumentSchema, {
    schemaVersion: 1,
    state: "effective",
    identity,
    documentRevision: integer(row.document_revision),
    settingsRevision: integer(row.settings_revision),
    values: row.values_json
  });
}

function state(identity: Pick<SettingsDocumentIdentity, "applicationId" | "environment">, row: StateRow): SettingsState {
  return parse(SettingsStateSchema, {
    schemaVersion: 1,
    applicationId: identity.applicationId,
    environment: identity.environment,
    settingsRevision: integer(row.settings_revision)
  });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function receiptMatches(row: ReceiptRow, input: ParsedWrite): SettingsTerminalReceipt | undefined {
  const receipt = SettingsTerminalReceiptSchema.safeParse(row.receipt_json);
  if (!receipt.success) fail("STATE", "Stored system settings receipt is invalid.");
  const owner = ownerColumns(input.identity);
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_digest)) fail("STATE", "Stored system settings receipt is invalid.");
  if (row.request_digest !== input.requestDigest || row.receipt_id !== input.receiptId || row.operation_id !== input.operationId
    || row.application_id !== input.identity.applicationId || row.environment !== input.identity.environment
    || row.descriptor_id !== input.identity.descriptorId || integer(row.descriptor_schema_version) !== input.identity.descriptorSchemaVersion
    || row.owner_scope_key !== owner.ownerScopeKey || row.owner_kind !== owner.ownerKind || row.owner_namespace !== owner.ownerNamespace
    || row.owner_delivery_class !== owner.ownerDeliveryClass || row.owner_extension_id !== owner.ownerExtensionId
    || (row.owner_generation === null ? null : integer(row.owner_generation)) !== owner.ownerGeneration
    || row.requested_by_kind !== input.actor.kind || row.requested_by_id !== input.actor.id
    || row.idempotency_key !== input.idempotencyKey || row.outcome !== receipt.data.outcome
    || receipt.data.receiptId !== row.receipt_id || receipt.data.receiptId !== input.receiptId
    || receipt.data.operationId !== row.operation_id || receipt.data.operationId !== input.operationId
    || receipt.data.occurredAt !== timestamp(row.occurred_at) || canonicalJson(receipt.data.identity) !== canonicalJson(input.identity)
    || canonicalJson(receipt.data.requestedBy) !== canonicalJson(input.actor) || receipt.data.idempotencyKey !== input.idempotencyKey) {
    return undefined;
  }
  return receipt.data;
}

function timestamp(value: unknown): string {
  const result = value instanceof Date ? value.toISOString() : value;
  return parse({ safeParse: (candidate: unknown) => typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(candidate)
    ? { success: true as const, data: candidate } : { success: false as const } }, result);
}

function operation(identity: SettingsDocumentIdentity, row: OperationRow): ResumableSettingsOperation {
  const owner = ownerColumns(identity);
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_digest)
    || row.application_id !== identity.applicationId || row.environment !== identity.environment
    || row.descriptor_id !== identity.descriptorId || integer(row.descriptor_schema_version) !== identity.descriptorSchemaVersion
    || row.owner_scope_key !== owner.ownerScopeKey || row.owner_kind !== owner.ownerKind || row.owner_namespace !== owner.ownerNamespace
    || row.owner_delivery_class !== owner.ownerDeliveryClass || row.owner_extension_id !== owner.ownerExtensionId
    || (row.owner_generation === null ? null : integer(row.owner_generation)) !== owner.ownerGeneration) {
    fail("STATE", "Stored system settings operation is invalid.");
  }
  return parse(ResumableSettingsOperationSchema, {
    schemaVersion: 1,
    operationId: row.operation_id,
    identity,
    pendingDocument: row.pending_document_json,
    expectedDocumentRevision: integer(row.expected_document_revision),
    expectedSettingsRevision: integer(row.expected_settings_revision),
    state: row.state,
    attempts: integer(row.attempts),
    requestedBy: { kind: row.requested_by_kind, id: row.requested_by_id },
    idempotencyKey: row.idempotency_key,
    revision: integer(row.revision),
    updatedAt: timestamp(row.updated_at)
  });
}

function operationScopeMatches(row: OperationRow, identity: SettingsDocumentIdentity): boolean {
  const owner = ownerColumns(identity);
  return row.application_id === identity.applicationId && row.environment === identity.environment
    && row.descriptor_id === identity.descriptorId && integer(row.descriptor_schema_version) === identity.descriptorSchemaVersion
    && row.owner_scope_key === owner.ownerScopeKey && row.owner_kind === owner.ownerKind && row.owner_namespace === owner.ownerNamespace
    && row.owner_delivery_class === owner.ownerDeliveryClass && row.owner_extension_id === owner.ownerExtensionId
    && (row.owner_generation === null ? null : integer(row.owner_generation)) === owner.ownerGeneration;
}

function operationMatches(row: OperationRow, input: ParsedWrite): ResumableSettingsOperation | undefined {
  if (!operationScopeMatches(row, input.identity)) return undefined;
  const parsed = operation(input.identity, row);
  if (row.operation_id !== input.operationId || row.request_digest !== input.requestDigest
    || parsed.expectedDocumentRevision !== input.expectedDocumentRevision || parsed.expectedSettingsRevision !== input.expectedSettingsRevision
    || parsed.idempotencyKey !== input.idempotencyKey || canonicalJson(parsed.requestedBy) !== canonicalJson(input.actor)) {
    return undefined;
  }
  return parsed;
}

function isCurrentGeneration(identity: SettingsDocumentIdentity, row: { state: string } | undefined): boolean {
  return identity.owner.kind === "platform" || row?.state === "current";
}

function deriveChangedFields(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>
): readonly string[] {
  const previous = before ?? {};
  return Object.freeze([...new Set([...Object.keys(previous), ...Object.keys(after)])]
    .filter((key) => !(key in previous) || !(key in after) || canonicalJson(previous[key]) !== canonicalJson(after[key]))
    .sort());
}

function assertChangedFields(
  claimed: readonly string[],
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>
): void {
  if (canonicalJson(claimed) !== canonicalJson(deriveChangedFields(before, after))) {
    fail("INVALID", "System settings changed fields do not match the document change.");
  }
}

function databaseError(error: unknown): never {
  if (error instanceof SystemSettingsStoreError) throw error;
  fail("STATE", "System settings transaction could not be completed.");
}

/** Customer-scoped immediate settings persistence. Generation-validated operations deliberately belong to P11.2c. */
export class PostgresSystemSettingsStore {
  constructor(private readonly pool: RuntimeExtensionPool) {}

  async read(identityValue: unknown): Promise<SystemSettingsSnapshot | undefined> {
    const identity = parse(SettingsDocumentIdentitySchema, identityValue);
    const owner = ownerColumns(identity);
    try {
      const currentState = await this.pool.query<StateRow>(
        "select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2",
        [identity.applicationId, identity.environment]
      );
      const row = currentState.rows[0];
      if (!row) return undefined;
      const currentDocument = await this.pool.query<DocumentRow>(
        `select owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json
         from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5`,
        [identity.applicationId, identity.environment, identity.descriptorId, identity.descriptorSchemaVersion, owner.ownerScopeKey]
      );
      const parsedState = state(identity, row);
      const parsedDocument = currentDocument.rows[0] ? document(identity, currentDocument.rows[0]) : undefined;
      if (parsedDocument && parsedDocument.settingsRevision > parsedState.settingsRevision) fail("STATE", "Stored system settings revisions are invalid.");
      const result: SystemSettingsSnapshot = { state: parsedState, ...(parsedDocument ? { document: parsedDocument } : {}) };
      return Object.freeze(result);
    } catch (error) { databaseError(error); }
  }

  async writeImmediate(value: unknown): Promise<SettingsTerminalReceipt> {
    const input = await this.input(value);
    try {
      return await this.transaction(async (session) => {
        const owner = ownerColumns(input.identity);
        await this.lockScope(session, input.identity);
        const stateResult = await session.query<StateRow>(
          "select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2 for update",
          [input.identity.applicationId, input.identity.environment]
        );
        const currentState = stateResult.rows[0];
        if (!currentState) fail("STATE", "System settings state is unavailable.");
        const documentResult = await session.query<DocumentRow>(
          `select owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json
           from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5 for update`,
          [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion, owner.ownerScopeKey]
        );
        const replayResult = await session.query<ReceiptRow>(
          `select receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key,
             owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation,
             requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json, occurred_at
           from k_nex_system_settings_receipts
           where (application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5 and idempotency_key=$6)
              or operation_id=$7 or receipt_id=$8 for update`,
          [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
            owner.ownerScopeKey, input.idempotencyKey, input.operationId, input.receiptId]
        );
        if (replayResult.rows.length > 1) fail("STATE", "System settings replay state is invalid.");
        if (replayResult.rows[0]) {
          const replay = receiptMatches(replayResult.rows[0], input);
          if (!replay) fail("IDEMPOTENCY", "System settings idempotency key was reused with a different request.");
          return replay;
        }
        await this.assertActiveGeneration(session, input.identity);
        const currentDocument = documentResult.rows[0] ? document(input.identity, documentResult.rows[0]) : undefined;
        const currentSettingsRevision = state(input.identity, currentState).settingsRevision;
        if (currentDocument && currentDocument.settingsRevision > currentSettingsRevision) fail("STATE", "Stored system settings revisions are invalid.");
        if ((currentDocument?.documentRevision ?? 0) !== input.expectedDocumentRevision || currentSettingsRevision !== input.expectedSettingsRevision) {
          fail("REVISION", "System settings revision changed.");
        }
        assertChangedFields(input.changedFields, currentDocument?.values, input.values);
        const nextDocument = parse(EffectiveSettingsDocumentSchema, {
          schemaVersion: 1,
          state: "effective",
          identity: input.identity,
          documentRevision: input.expectedDocumentRevision + 1,
          settingsRevision: currentSettingsRevision + 1,
          values: input.values
        });
        const receipt = parse(SettingsTerminalReceiptSchema, {
          schemaVersion: 1,
          receiptId: input.receiptId,
          operationId: input.operationId,
          identity: input.identity,
          requestedBy: input.actor,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt,
          outcome: "promoted",
          documentRevision: nextDocument.documentRevision,
          settingsRevision: nextDocument.settingsRevision,
          changedFields: input.changedFields,
          invalidationId: input.invalidationId
        });
        if (receipt.outcome !== "promoted") fail("STATE", "System settings receipt is invalid.");
        const invalidation = parse(SettingsInvalidationSchema, {
          schemaVersion: 1,
          invalidationId: input.invalidationId,
          identity: input.identity,
          settingsRevision: nextDocument.settingsRevision,
          occurredAt: input.occurredAt
        });
        await session.query(
          `insert into k_nex_system_settings_documents
            (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
             owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
           on conflict (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key)
           do update set document_revision=excluded.document_revision, settings_revision=excluded.settings_revision, values_json=excluded.values_json, updated_at=now()`,
          [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
            owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration,
            nextDocument.documentRevision, nextDocument.settingsRevision, canonicalJson(nextDocument.values)]
        );
        await session.query(
          "update k_nex_system_settings_state set settings_revision=$3, updated_at=now() where application_id=$1 and environment=$2",
          [input.identity.applicationId, input.identity.environment, nextDocument.settingsRevision]
        );
        await session.query(
          `insert into k_nex_system_settings_receipts
            (receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
             owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json, occurred_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'promoted',$17::jsonb,$18::timestamptz)`,
          [receipt.receiptId, receipt.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
            input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
            owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, input.idempotencyKey, input.requestDigest,
            canonicalJson(receipt), receipt.occurredAt]
        );
        await session.query(
          `insert into k_nex_system_settings_audit
            (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
             owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome,
             document_revision, settings_revision, changed_fields_json)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'applied',$16,$17,$18::jsonb)`,
          [input.auditId, receipt.operationId, receipt.receiptId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
            input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
            owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, receipt.documentRevision, receipt.settingsRevision,
            canonicalJson(receipt.changedFields)]
        );
        await session.query(
          `insert into k_nex_system_settings_outbox
            (event_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
             owner_delivery_class, owner_extension_id, owner_generation, settings_revision, occurred_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)`,
          [invalidation.invalidationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
            input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
            owner.ownerExtensionId, owner.ownerGeneration, invalidation.settingsRevision, invalidation.occurredAt]
        );
        return receipt;
      });
    } catch (error) { databaseError(error); }
  }

  /** Starts durable exact-generation validation; its candidate is never visible through read(). */
  async beginGenerationValidated(value: unknown): Promise<ResumableSettingsOperation | SettingsTerminalReceipt> {
    const input = await this.input(value);
    try {
      return await this.transaction(async (session) => {
        const owner = ownerColumns(input.identity);
        await this.lockScope(session, input.identity);
        const existing = await this.findTerminal(session, input);
        if (existing) return existing;
        const operations = await session.query<OperationRow>(
          `select ${this.operationColumns}
           from k_nex_system_settings_operations
           where (application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5 and idempotency_key=$6)
              or operation_id=$7 for update`,
          [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
            owner.ownerScopeKey, input.idempotencyKey, input.operationId]
        );
        if (operations.rows.length > 1) fail("STATE", "System settings replay state is invalid.");
        if (operations.rows[0]) {
          const replay = operationMatches(operations.rows[0], input);
          if (!replay) fail("IDEMPOTENCY", "System settings idempotency key was reused with a different request.");
          return replay;
        }
        const current = await this.currentDocument(session, input.identity, true);
        if ((current.document?.documentRevision ?? 0) !== input.expectedDocumentRevision || current.state.settingsRevision !== input.expectedSettingsRevision) {
          fail("REVISION", "System settings revision changed.");
        }
        assertChangedFields(input.changedFields, current.document?.values, input.values);
        const pending = parse(PendingSettingsCandidateSchema, {
          schemaVersion: 1,
          state: "pending-generation-validation",
          identity: input.identity,
          documentRevision: input.expectedDocumentRevision + 1,
          settingsRevision: current.state.settingsRevision + 1,
          values: input.values
        });
        await session.query(
          `insert into k_nex_system_settings_operations
            (operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
             owner_delivery_class, owner_extension_id, owner_generation, pending_document_json, expected_document_revision, expected_settings_revision,
             state, requested_by_kind, requested_by_id, idempotency_key, request_digest)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,'pending-validation',$15,$16,$17,$18)`,
          [input.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
            owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration,
            canonicalJson(pending), input.expectedDocumentRevision, input.expectedSettingsRevision, input.actor.kind, input.actor.id,
            input.idempotencyKey, input.requestDigest]
        );
        const inserted = await session.query<OperationRow>(
          `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1`, [input.operationId]
        );
        if (inserted.rows.length !== 1) fail("STATE", "System settings operation is unavailable.");
        return operation(input.identity, inserted.rows[0]!);
      });
    } catch (error) { databaseError(error); }
  }

  async readGenerationValidated(value: unknown): Promise<ResumableSettingsOperation | SettingsTerminalReceipt | undefined> {
    const request = exactObject(value, ["identity", "operationId"]);
    const identity = parse(SettingsDocumentIdentitySchema, request.identity);
    const operationId = parseOperationId(request.operationId);
    try {
      const active = await this.pool.query<OperationRow>(
        `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1`, [operationId]
      );
      if (active.rows.length > 1) fail("STATE", "Stored system settings operation is invalid.");
      if (active.rows[0]) return operation(identity, active.rows[0]);
      const terminal = await this.pool.query<ReceiptRow>(
        `select ${this.receiptColumns} from k_nex_system_settings_receipts where operation_id=$1`, [operationId]
      );
      if (terminal.rows.length > 1) fail("STATE", "Stored system settings receipt is invalid.");
      if (!terminal.rows[0]) return undefined;
      return this.readReceipt(identity, operationId, terminal.rows[0]);
    } catch (error) { databaseError(error); }
  }

  async transitionGenerationValidated(value: unknown): Promise<ResumableSettingsOperation> {
    const request = exactObject(value, ["identity", "operationId", "expectedOperationRevision", "state"]);
    const identity = parse(SettingsDocumentIdentitySchema, request.identity);
    const operationId = parseOperationId(request.operationId);
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    if (expectedRevision === 0 || (request.state !== "validating" && request.state !== "promotion-blocked")) fail("INVALID", "System settings input is invalid.");
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, identity);
        const found = await session.query<OperationRow>(
          `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1 for update`, [operationId]
        );
        if (!found.rows[0]) fail("STATE", "System settings operation is unavailable.");
        const current = operation(identity, found.rows[0]);
        const allowed = (current.state === "pending-validation" && (request.state === "validating" || request.state === "promotion-blocked"))
          || (current.state === "validating" && request.state === "promotion-blocked");
        if (current.revision !== expectedRevision || !allowed) fail("REVISION", "System settings operation revision changed.");
        const updated = await session.query<OperationRow>(
          `update k_nex_system_settings_operations set state=$2, attempts=attempts+1, revision=revision+1, updated_at=now()
           where operation_id=$1 and revision=$3 returning ${this.operationColumns}`,
          [operationId, request.state, expectedRevision]
        );
        if (updated.rows.length !== 1) fail("REVISION", "System settings operation revision changed.");
        return operation(identity, updated.rows[0]!);
      });
    } catch (error) { databaseError(error); }
  }

  async promoteGenerationValidated(value: unknown): Promise<SettingsTerminalReceipt> {
    const { input, expectedRevision } = await this.operationWrite(value);
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, input.identity);
        const replay = await this.findTerminal(session, input);
        if (replay) return replay;
        const owner = ownerColumns(input.identity);
        const found = await session.query<OperationRow>(
          `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1 for update`, [input.operationId]
        );
        if (!found.rows[0]) fail("STATE", "System settings operation is unavailable.");
        const active = operationMatches(found.rows[0], input);
        if (!active) fail("IDEMPOTENCY", "System settings operation identity does not match.");
        if (active.revision !== expectedRevision || active.state !== "validating") fail("REVISION", "System settings operation revision changed.");
        const current = await this.currentDocument(session, input.identity, true);
        if ((current.document?.documentRevision ?? 0) !== active.expectedDocumentRevision || current.state.settingsRevision !== active.expectedSettingsRevision) {
          fail("REVISION", "System settings revision changed.");
        }
        assertChangedFields(input.changedFields, current.document?.values, active.pendingDocument.values);
        await this.assertActiveGeneration(session, input.identity);
        const receipt = this.promotedReceipt(input, active.pendingDocument);
        const invalidation = parse(SettingsInvalidationSchema, {
          schemaVersion: 1, invalidationId: input.invalidationId, identity: input.identity,
          settingsRevision: receipt.settingsRevision, occurredAt: input.occurredAt
        });
        await session.query("delete from k_nex_system_settings_operations where operation_id=$1 and revision=$2", [input.operationId, expectedRevision]);
        await this.writePromoted(session, input, owner, active.pendingDocument, receipt, invalidation);
        return receipt;
      });
    } catch (error) { databaseError(error); }
  }

  async failGenerationValidated(value: unknown): Promise<SettingsTerminalReceipt> {
    const request = exactObject(value, ["identity", "document", "operation", "receipt", "actor", "auditId", "changedFields", "expectedOperationRevision", "reason"]);
    const input = await this.input({ identity: request.identity, document: request.document, operation: request.operation, receipt: request.receipt, actor: request.actor, auditId: request.auditId, changedFields: request.changedFields });
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    const failureProbe = parse(SettingsTerminalReceiptSchema, {
      schemaVersion: 1, receiptId: input.receiptId, operationId: input.operationId, identity: input.identity, requestedBy: input.actor,
      idempotencyKey: input.idempotencyKey, occurredAt: input.occurredAt, outcome: "validation-failed", reason: request.reason
    });
    if (expectedRevision === 0 || failureProbe.outcome === "promoted") fail("INVALID", "System settings input is invalid.");
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, input.identity);
        const replay = await this.findTerminal(session, input);
        if (replay) return replay;
        const owner = ownerColumns(input.identity);
        const found = await session.query<OperationRow>(`select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1 for update`, [input.operationId]);
        if (!found.rows[0]) fail("STATE", "System settings operation is unavailable.");
        const active = operationMatches(found.rows[0], input);
        if (!active) fail("IDEMPOTENCY", "System settings operation identity does not match.");
        if (active.revision !== expectedRevision || (active.state !== "validating" && active.state !== "promotion-blocked")) fail("REVISION", "System settings operation revision changed.");
        const receipt = parse(SettingsTerminalReceiptSchema, {
          schemaVersion: 1, receiptId: input.receiptId, operationId: input.operationId, identity: input.identity, requestedBy: input.actor,
          idempotencyKey: input.idempotencyKey, occurredAt: input.occurredAt,
          outcome: active.state === "promotion-blocked" ? "promotion-invalidated" : "validation-failed", reason: failureProbe.reason
        });
        if (receipt.outcome === "promoted") fail("STATE", "System settings receipt is invalid.");
        await session.query("delete from k_nex_system_settings_operations where operation_id=$1 and revision=$2", [input.operationId, expectedRevision]);
        await this.writeFailure(session, input, owner, receipt);
        return receipt;
      });
    } catch (error) { databaseError(error); }
  }

  private readonly operationColumns = `operation_id, application_id, environment, descriptor_id, descriptor_schema_version,
    owner_scope_key, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation,
    pending_document_json, expected_document_revision, expected_settings_revision, state, attempts, requested_by_kind,
    requested_by_id, idempotency_key, request_digest, revision, updated_at`;

  private readonly receiptColumns = `receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version,
    owner_scope_key, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation,
    requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json, occurred_at`;

  private async lockScope(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity): Promise<void> {
    if (identity.owner.kind === "extension") {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([
        identity.applicationId, identity.environment, identity.owner.deliveryClass, identity.owner.extensionId
      ])]);
    }
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson(identity)]);
    await session.query(
      "insert into k_nex_system_settings_state (application_id, environment) values ($1,$2) on conflict do nothing",
      [identity.applicationId, identity.environment]
    );
    await session.query(
      "select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2 for update",
      [identity.applicationId, identity.environment]
    );
  }

  private async assertActiveGeneration(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity): Promise<void> {
    if (identity.owner.kind === "platform") return;
    const result = await session.query<{
      authorization_state: string;
      disposition: string;
      active_generation_id: string | null;
      runtime_state: string;
      generation_bound: boolean;
    }>(
      `select g.state as authorization_state, e.disposition, e.active_generation_id, x.state as runtime_state,
              g.runtime_generation_ids ? e.active_generation_id as generation_bound
       from k_nex_extension_authorization_generations g
       join runtime_extensions e on e.application_id=g.application_id and e.environment=$5
         and e.delivery_class=g.delivery_class and e.extension_id=g.extension_id
       join runtime_extension_generations x on x.application_id=e.application_id and x.environment=e.environment
         and x.delivery_class=e.delivery_class and x.extension_id=e.extension_id and x.generation_id=e.active_generation_id
       where g.application_id=$1 and g.delivery_class=$2 and g.extension_id=$3 and g.authorization_generation=$4
       for update of g, e, x`,
      [identity.applicationId, identity.owner.deliveryClass, identity.owner.extensionId, identity.owner.generation, identity.environment]
    );
    const current = result.rows[0];
    if (!isCurrentGeneration(identity, current === undefined ? undefined : { state: current.authorization_state })
      || current?.disposition !== "active" || current.active_generation_id === null
      || current.runtime_state !== "active" || current.generation_bound !== true) {
      fail("STATE", "System settings generation is not active and current.");
    }
  }

  private async currentDocument(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity, locked: boolean): Promise<{ state: SettingsState; document?: EffectiveSettingsDocument }> {
    const owner = ownerColumns(identity);
    const stateResult = await session.query<StateRow>(
      `select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2${locked ? " for update" : ""}`,
      [identity.applicationId, identity.environment]
    );
    if (!stateResult.rows[0]) fail("STATE", "System settings state is unavailable.");
    const documentResult = await session.query<DocumentRow>(
      `select owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json
       from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5${locked ? " for update" : ""}`,
      [identity.applicationId, identity.environment, identity.descriptorId, identity.descriptorSchemaVersion, owner.ownerScopeKey]
    );
    const parsedState = state(identity, stateResult.rows[0]);
    const parsedDocument = documentResult.rows[0] ? document(identity, documentResult.rows[0]) : undefined;
    if (parsedDocument && parsedDocument.settingsRevision > parsedState.settingsRevision) fail("STATE", "Stored system settings revisions are invalid.");
    return parsedDocument ? { state: parsedState, document: parsedDocument } : { state: parsedState };
  }

  private async findTerminal(session: RuntimeExtensionSession, input: ParsedWrite): Promise<SettingsTerminalReceipt | undefined> {
    const owner = ownerColumns(input.identity);
    const result = await session.query<ReceiptRow>(
      `select ${this.receiptColumns} from k_nex_system_settings_receipts
       where (application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5 and idempotency_key=$6)
          or operation_id=$7 or receipt_id=$8 for update`,
      [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
        owner.ownerScopeKey, input.idempotencyKey, input.operationId, input.receiptId]
    );
    if (result.rows.length > 1) fail("STATE", "System settings replay state is invalid.");
    if (!result.rows[0]) return undefined;
    const replay = receiptMatches(result.rows[0], input);
    if (!replay) fail("IDEMPOTENCY", "System settings idempotency key was reused with a different request.");
    return replay;
  }

  private readReceipt(identity: SettingsDocumentIdentity, operationId: string, row: ReceiptRow): SettingsTerminalReceipt {
    const receipt = parse(SettingsTerminalReceiptSchema, row.receipt_json);
    const owner = ownerColumns(identity);
    if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_digest) || row.operation_id !== operationId
      || row.application_id !== identity.applicationId || row.environment !== identity.environment || row.descriptor_id !== identity.descriptorId
      || integer(row.descriptor_schema_version) !== identity.descriptorSchemaVersion || row.owner_scope_key !== owner.ownerScopeKey
      || row.owner_kind !== owner.ownerKind || row.owner_namespace !== owner.ownerNamespace || row.owner_delivery_class !== owner.ownerDeliveryClass
      || row.owner_extension_id !== owner.ownerExtensionId || (row.owner_generation === null ? null : integer(row.owner_generation)) !== owner.ownerGeneration
      || receipt.operationId !== operationId || receipt.operationId !== row.operation_id || canonicalJson(receipt.identity) !== canonicalJson(identity)
      || receipt.receiptId !== row.receipt_id || receipt.idempotencyKey !== row.idempotency_key
      || receipt.outcome !== row.outcome || receipt.occurredAt !== timestamp(row.occurred_at)
      || canonicalJson(receipt.requestedBy) !== canonicalJson({ kind: row.requested_by_kind, id: row.requested_by_id })) {
      fail("STATE", "Stored system settings receipt is invalid.");
    }
    return receipt;
  }

  private promotedReceipt(input: ParsedWrite, pending: ResumableSettingsOperation["pendingDocument"]): Extract<SettingsTerminalReceipt, { outcome: "promoted" }> {
    const result = parse(SettingsTerminalReceiptSchema, {
      schemaVersion: 1, receiptId: input.receiptId, operationId: input.operationId, identity: input.identity,
      requestedBy: input.actor, idempotencyKey: input.idempotencyKey, occurredAt: input.occurredAt, outcome: "promoted",
      documentRevision: pending.documentRevision, settingsRevision: pending.settingsRevision,
      changedFields: input.changedFields, invalidationId: input.invalidationId
    });
    if (result.outcome !== "promoted") fail("STATE", "System settings receipt is invalid.");
    return result;
  }

  private async writePromoted(
    session: RuntimeExtensionSession,
    input: ParsedWrite,
    owner: OwnerColumns,
    pending: ResumableSettingsOperation["pendingDocument"],
    receipt: Extract<SettingsTerminalReceipt, { outcome: "promoted" }>,
    invalidation: SettingsInvalidation
  ): Promise<void> {
    await session.query(
      `insert into k_nex_system_settings_documents
        (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       on conflict (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key)
       do update set document_revision=excluded.document_revision, settings_revision=excluded.settings_revision, values_json=excluded.values_json, updated_at=now()`,
      [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
        owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration,
        pending.documentRevision, pending.settingsRevision, canonicalJson(pending.values)]
    );
    await session.query("update k_nex_system_settings_state set settings_revision=$3, updated_at=now() where application_id=$1 and environment=$2", [input.identity.applicationId, input.identity.environment, receipt.settingsRevision]);
    await session.query(
      `insert into k_nex_system_settings_receipts
        (receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'promoted',$17::jsonb,$18::timestamptz)`,
      [receipt.receiptId, receipt.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, input.idempotencyKey, input.requestDigest,
        canonicalJson(receipt), receipt.occurredAt]
    );
    await session.query(
      `insert into k_nex_system_settings_audit
        (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
         owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome,
         document_revision, settings_revision, changed_fields_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'applied',$16,$17,$18::jsonb)`,
      [input.auditId, receipt.operationId, receipt.receiptId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, receipt.documentRevision, receipt.settingsRevision,
        canonicalJson(receipt.changedFields)]
    );
    await session.query(
      `insert into k_nex_system_settings_outbox
        (event_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, settings_revision, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)`,
      [invalidation.invalidationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, invalidation.settingsRevision, invalidation.occurredAt]
    );
  }

  private async writeFailure(session: RuntimeExtensionSession, input: ParsedWrite, owner: OwnerColumns, receipt: Exclude<SettingsTerminalReceipt, { outcome: "promoted" }>): Promise<void> {
    await session.query(
      `insert into k_nex_system_settings_receipts
        (receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::timestamptz)`,
      [receipt.receiptId, receipt.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, input.idempotencyKey, input.requestDigest,
        receipt.outcome, canonicalJson(receipt), receipt.occurredAt]
    );
    await session.query(
      `insert into k_nex_system_settings_audit
        (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
         owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome, changed_fields_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'[]'::jsonb)`,
      [input.auditId, receipt.operationId, receipt.receiptId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, receipt.outcome]
    );
  }

  private async operationWrite(value: unknown): Promise<{ input: ParsedWrite; expectedRevision: number }> {
    const request = exactObject(value, ["identity", "document", "operation", "receipt", "actor", "auditId", "changedFields", "expectedOperationRevision"]);
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    if (expectedRevision === 0) fail("INVALID", "System settings input is invalid.");
    return { input: await this.input({ identity: request.identity, document: request.document, operation: request.operation, receipt: request.receipt, actor: request.actor, auditId: request.auditId, changedFields: request.changedFields }), expectedRevision };
  }

  private async input(value: unknown): Promise<ParsedWrite> {
    const input = exactObject(value, ["identity", "document", "operation", "receipt", "actor", "auditId", "changedFields"]);
    const documentInput = exactObject(input.document, ["expectedDocumentRevision", "expectedSettingsRevision", "values"]);
    const operation = exactObject(input.operation, ["operationId", "idempotencyKey"]);
    const receipt = exactObject(input.receipt, ["receiptId", "invalidationId", "occurredAt"]);
    const identity = parse(SettingsDocumentIdentitySchema, input.identity);
    const expectedDocumentRevision = positiveOrZero(documentInput.expectedDocumentRevision);
    const expectedSettingsRevision = positiveOrZero(documentInput.expectedSettingsRevision);
    const actor = parse(AuthorizationSubjectSchema, input.actor);
    const preview = parse(SettingsTerminalReceiptSchema, {
      schemaVersion: 1,
      receiptId: receipt.receiptId,
      operationId: operation.operationId,
      identity,
      requestedBy: actor,
      idempotencyKey: operation.idempotencyKey,
      occurredAt: receipt.occurredAt,
      outcome: "promoted",
      documentRevision: 1,
      settingsRevision: 1,
      changedFields: input.changedFields,
      invalidationId: receipt.invalidationId
    });
    if (preview.outcome !== "promoted") fail("INVALID", "System settings input is invalid.");
    const candidate = parse(EffectiveSettingsDocumentSchema, {
      schemaVersion: 1,
      state: "effective",
      identity,
      documentRevision: 1,
      settingsRevision: 1,
      values: documentInput.values
    });
    const auditProbe = parse(SettingsInvalidationSchema, {
      schemaVersion: 1,
      invalidationId: input.auditId,
      identity,
      settingsRevision: 1,
      occurredAt: receipt.occurredAt
    });
    const changedFields = Object.freeze([...preview.changedFields].sort());
    const requestDigest = await sha256({
      identity,
      expectedDocumentRevision,
      expectedSettingsRevision,
      values: candidate.values,
      operationId: preview.operationId,
      idempotencyKey: preview.idempotencyKey,
      receiptId: preview.receiptId,
      invalidationId: preview.invalidationId,
      occurredAt: preview.occurredAt,
      actor,
      auditId: auditProbe.invalidationId,
      changedFields
    });
    return Object.freeze({
      identity,
      expectedDocumentRevision,
      expectedSettingsRevision,
      values: candidate.values,
      operationId: preview.operationId,
      idempotencyKey: preview.idempotencyKey,
      receiptId: preview.receiptId,
      invalidationId: preview.invalidationId,
      occurredAt: preview.occurredAt,
      actor,
      auditId: auditProbe.invalidationId,
      changedFields,
      requestDigest
    });
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const result = await work(session);
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve root error */ }
      throw error;
    } finally { session.release(); }
  }
}
