import {
  AdministrationAuthorityEnvelopeSchema,
  AuthorizationStateSchema,
  AuthorizationSubjectSchema,
  EffectiveSettingsDocumentSchema,
  PendingSettingsCandidateSchema,
  ResumableSettingsOperationSchema,
  SystemSettingsDescriptorSchema,
  SettingsDocumentIdentitySchema,
  SettingsInvalidationSchema,
  SettingsStateSchema,
  SettingsTerminalReceiptSchema,
  canonicalJson,
  type AuthorizationSubject,
  type AuthorizationState,
  type AdministrationAuthorityEnvelope,
  type EffectiveSettingsDocument,
  type ResumableSettingsOperation,
  type SettingsDocumentIdentity,
  type SettingsInvalidation,
  type SettingsState,
  type SettingsTerminalReceipt
} from "@k-nex/contracts";
import { projectSystemSettingsValues } from "@k-nex/runtime";

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
  readonly authorityEnvelope: unknown;
  readonly authority: unknown;
  readonly auditId: unknown;
  readonly changedFields: unknown;
}

interface StateRow { settings_revision: number | string; }
interface AuthorizationStateRow {
  application_id: string;
  authorization_revision: number | string;
  lifecycle_revision: number | string;
}
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
  authority_json: unknown;
  authority_digest: string;
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
  authority_json: unknown;
  authority_digest: string;
  revision: number | string;
  lease_owner: string | null;
  lease_expires_at: unknown | null;
  updated_at: unknown;
  created_at: unknown;
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
  readonly authority: AuthorizationState;
  readonly authorityEnvelope: AdministrationAuthorityEnvelope;
  readonly authorityDigest: string;
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
  readonly authority: unknown;
}

export interface SettingsValidationClaim {
  readonly operation: ResumableSettingsOperation;
  readonly runtimeGenerationId: string;
}

export interface SettingsValidationAuthority {
  readonly operation: ResumableSettingsOperation;
  readonly authority: AdministrationAuthorityEnvelope;
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
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_digest)) {
    fail("STATE", "Stored system settings receipt is invalid.");
  }
  const persistedAuthority = parse(AdministrationAuthorityEnvelopeSchema, row.authority_json);
  if (row.authority_digest !== input.authorityDigest || canonicalJson(persistedAuthority) !== canonicalJson(input.authorityEnvelope)) return undefined;
  if (row.request_digest !== input.requestDigest
    || row.application_id !== input.identity.applicationId || row.environment !== input.identity.environment
    || row.descriptor_id !== input.identity.descriptorId || integer(row.descriptor_schema_version) !== input.identity.descriptorSchemaVersion
    || row.owner_scope_key !== owner.ownerScopeKey || row.owner_kind !== owner.ownerKind || row.owner_namespace !== owner.ownerNamespace
    || row.owner_delivery_class !== owner.ownerDeliveryClass || row.owner_extension_id !== owner.ownerExtensionId
    || (row.owner_generation === null ? null : integer(row.owner_generation)) !== owner.ownerGeneration
    || row.requested_by_kind !== input.actor.kind || row.requested_by_id !== input.actor.id
    || row.idempotency_key !== input.idempotencyKey || row.outcome !== receipt.data.outcome
    || receipt.data.receiptId !== row.receipt_id
    || receipt.data.operationId !== row.operation_id
    || receipt.data.occurredAt !== timestamp(row.occurred_at) || canonicalJson(receipt.data.identity) !== canonicalJson(input.identity)
    || canonicalJson(receipt.data.requestedBy) !== canonicalJson(input.actor) || receipt.data.idempotencyKey !== input.idempotencyKey
    || receipt.data.authorityDigest !== input.authorityDigest || receipt.data.reauthentication !== "satisfied") {
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
    authorityDigest: row.authority_digest,
    idempotencyKey: row.idempotency_key,
    revision: integer(row.revision),
    ...(row.lease_owner == null ? {} : { leaseOwner: row.lease_owner, leaseExpiresAt: timestamp(row.lease_expires_at) }),
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

function operationMatchesCore(row: OperationRow, input: ParsedWrite): ResumableSettingsOperation | undefined {
  if (!operationScopeMatches(row, input.identity)) return undefined;
  const parsed = operation(input.identity, row);
  const persistedAuthority = parse(AdministrationAuthorityEnvelopeSchema, row.authority_json);
  const acceptedAt = Date.parse(timestamp(row.created_at));
  if (row.request_digest !== input.requestDigest
    || parsed.expectedDocumentRevision !== input.expectedDocumentRevision || parsed.expectedSettingsRevision !== input.expectedSettingsRevision
    || parsed.idempotencyKey !== input.idempotencyKey || canonicalJson(parsed.requestedBy) !== canonicalJson(input.actor)
    || parsed.authorityDigest !== input.authorityDigest
    || canonicalJson(persistedAuthority) !== canonicalJson(input.authorityEnvelope)
    || Date.parse(persistedAuthority.reauthentication.verifiedAt) > acceptedAt
    || Date.parse(persistedAuthority.reauthentication.expiresAt) <= acceptedAt) {
    return undefined;
  }
  return parsed;
}

function operationMatches(row: OperationRow, input: ParsedWrite): ResumableSettingsOperation | undefined {
  if (row.operation_id !== input.operationId) return undefined;
  return operationMatchesCore(row, input);
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
    const session = await this.pool.connect();
    try {
      await session.query("begin isolation level repeatable read read only");
      const currentState = await session.query<StateRow>(
        "select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2",
        [identity.applicationId, identity.environment]
      );
      const row = currentState.rows[0];
      if (!row) {
        await session.query("commit");
        return undefined;
      }
      const currentDocument = await session.query<DocumentRow>(
        `select owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json
         from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5`,
        [identity.applicationId, identity.environment, identity.descriptorId, identity.descriptorSchemaVersion, owner.ownerScopeKey]
      );
      const parsedState = state(identity, row);
      const parsedDocument = currentDocument.rows[0] ? document(identity, currentDocument.rows[0]) : undefined;
      if (parsedDocument && parsedDocument.settingsRevision > parsedState.settingsRevision) fail("STATE", "Stored system settings revisions are invalid.");
      const result: SystemSettingsSnapshot = { state: parsedState, ...(parsedDocument ? { document: parsedDocument } : {}) };
      await session.query("commit");
      return Object.freeze(result);
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve root error */ }
      databaseError(error);
    } finally { session.release(); }
  }

  async writeImmediate(value: unknown): Promise<SettingsTerminalReceipt> {
    const input = await this.input(value);
    try {
      return await this.transaction(async (session) => {
        const owner = ownerColumns(input.identity);
        await this.lockScope(session, input.identity);
        await this.assertAuthority(session, input.identity, input.authority);
        await this.lockSettingsState(session, input.identity);
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
             requested_by_kind, requested_by_id, idempotency_key, request_digest, authority_json, authority_digest, outcome, receipt_json, occurred_at
           from k_nex_system_settings_receipts
           where (application_id=$1 and environment=$2 and descriptor_id=$3 and descriptor_schema_version=$4 and owner_scope_key=$5 and idempotency_key=$6)
              or operation_id=$7 or receipt_id=$8 for update`,
          [input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
            owner.ownerScopeKey, input.idempotencyKey, input.operationId, input.receiptId]
        );
        if (replayResult.rows.length > 1) fail("IDEMPOTENCY", "System settings identifiers collide with another request.");
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
          authorityDigest: input.authorityDigest,
          reauthentication: "satisfied",
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
             owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest,
             authority_json, authority_digest, outcome, receipt_json, occurred_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,'promoted',$19::jsonb,$20::timestamptz)`,
          [receipt.receiptId, receipt.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
            input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
            owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, input.idempotencyKey, input.requestDigest,
            canonicalJson(input.authorityEnvelope), input.authorityDigest, canonicalJson(receipt), receipt.occurredAt]
        );
        await session.query(
          `insert into k_nex_system_settings_audit
            (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
             owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome,
             authority_json, authority_digest, reauthentication, document_revision, settings_revision, changed_fields_json)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'applied',$16::jsonb,$17,'satisfied',$18,$19,$20::jsonb)`,
          [input.auditId, receipt.operationId, receipt.receiptId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
            input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
            owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, canonicalJson(input.authorityEnvelope), input.authorityDigest,
            receipt.documentRevision, receipt.settingsRevision, canonicalJson(receipt.changedFields)]
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
        await this.assertAuthority(session, input.identity, input.authority);
        await this.lockSettingsState(session, input.identity);
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
        if (operations.rows.length > 1) fail("IDEMPOTENCY", "System settings identifiers collide with another request.");
        if (operations.rows[0]) {
          const replay = operationMatchesCore(operations.rows[0], input);
          if (!replay) fail("IDEMPOTENCY", "System settings idempotency key was reused with a different request.");
          return replay;
        }
        await this.assertConfigurableGeneration(session, input.identity);
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
             state, requested_by_kind, requested_by_id, idempotency_key, request_digest, authority_json, authority_digest, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,'pending-validation',$15,$16,$17,$18,$19::jsonb,$20,$21::timestamptz)`,
          [input.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId, input.identity.descriptorSchemaVersion,
            owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration,
            canonicalJson(pending), input.expectedDocumentRevision, input.expectedSettingsRevision, input.actor.kind, input.actor.id,
            input.idempotencyKey, input.requestDigest, canonicalJson(input.authorityEnvelope), input.authorityDigest, input.occurredAt]
        );
        const inserted = await session.query<OperationRow>(
          `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1`, [input.operationId]
        );
        if (inserted.rows.length !== 1) fail("STATE", "System settings operation is unavailable.");
        return operation(input.identity, inserted.rows[0]!);
      });
    } catch (error) { databaseError(error); }
  }

  /** Starts explicit reinstall adoption without accepting a browser-supplied source generation or values. */
  async beginRetainedAdoption(value: unknown): Promise<ResumableSettingsOperation | SettingsTerminalReceipt> {
    const request = exactObject(value, ["descriptor", "write"]);
    const descriptor = parse(SystemSettingsDescriptorSchema, request.descriptor);
    const input = await this.input(request.write);
    if (input.identity.owner.kind !== "extension" || input.identity.owner.deliveryClass !== "hot-application"
      || descriptor.validation !== "generation-validated" || descriptor.id !== input.identity.descriptorId
      || descriptor.descriptorSchemaVersion !== input.identity.descriptorSchemaVersion
      || descriptor.publisher.kind !== "extension" || descriptor.publisher.deliveryClass !== input.identity.owner.deliveryClass
      || descriptor.publisher.extensionId !== input.identity.owner.extensionId || input.expectedDocumentRevision !== 0
      || Object.keys(input.values).length !== 0 || input.changedFields.length !== 0) {
      fail("INVALID", "System settings adoption input is invalid.");
    }
    const source = await this.pool.query<{ values_json: unknown }>(
      `select document.values_json
       from k_nex_system_settings_documents document
       join k_nex_extension_authorization_generations generation
         on generation.application_id=document.application_id and generation.delivery_class=document.owner_delivery_class
         and generation.extension_id=document.owner_extension_id and generation.authorization_generation=document.owner_generation
       where document.application_id=$1 and document.environment=$2 and document.descriptor_id=$3
         and document.owner_delivery_class=$4 and document.owner_extension_id=$5
         and document.owner_generation<>$6 and generation.state='retired'
       order by document.owner_generation desc limit 1`,
      [input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.owner.deliveryClass, input.identity.owner.extensionId, input.identity.owner.generation]
    );
    if (!source.rows[0]) fail("STATE", "Retained system settings are unavailable for adoption.");
    let values: Readonly<Record<string, unknown>>;
    try { values = projectSystemSettingsValues(descriptor, source.rows[0].values_json as never); }
    catch { fail("STATE", "Retained system settings require explicit configuration."); }
    return this.beginGenerationValidated({
      identity: input.identity,
      document: { expectedDocumentRevision: input.expectedDocumentRevision, expectedSettingsRevision: input.expectedSettingsRevision, values },
      operation: { operationId: input.operationId, idempotencyKey: input.idempotencyKey },
      receipt: { receiptId: input.receiptId, invalidationId: input.invalidationId, occurredAt: input.occurredAt },
      actor: input.actor,
      authorityEnvelope: input.authorityEnvelope,
      authority: input.authority,
      auditId: input.auditId,
      changedFields: Object.keys(values).sort()
    });
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

  /** Trusted worker read; the browser-facing operation exposes only authorityDigest. */
  async readGenerationValidatedAuthority(value: unknown): Promise<SettingsValidationAuthority | undefined> {
    const request = exactObject(value, ["identity", "operationId"]);
    const identity = parse(SettingsDocumentIdentitySchema, request.identity);
    const operationId = parseOperationId(request.operationId);
    try {
      const active = await this.pool.query<OperationRow>(
        `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1`, [operationId]
      );
      if (active.rows.length > 1) fail("STATE", "Stored system settings operation is invalid.");
      const row = active.rows[0];
      if (!row) return undefined;
      const authority = parse(AdministrationAuthorityEnvelopeSchema, row.authority_json);
      const digest = await sha256(authority);
      if (digest !== row.authority_digest) fail("STATE", "Stored settings authority envelope is invalid.");
      const parsedOperation = operation(identity, row);
      if (parsedOperation.operationId !== operationId || parsedOperation.authorityDigest !== digest) {
        fail("STATE", "Stored settings authority envelope is invalid.");
      }
      return Object.freeze({ operation: parsedOperation, authority });
    } catch (error) { databaseError(error); }
  }

  async transitionGenerationValidated(value: unknown): Promise<ResumableSettingsOperation> {
    const request = exactObject(value, ["identity", "operationId", "expectedOperationRevision", "state", "authority"]);
    const identity = parse(SettingsDocumentIdentitySchema, request.identity);
    const operationId = parseOperationId(request.operationId);
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    const authority = this.authority(identity, request.authority);
    if (expectedRevision === 0 || (request.state !== "validating" && request.state !== "promotion-blocked")) fail("INVALID", "System settings input is invalid.");
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, identity);
        await this.assertAuthority(session, identity, authority);
        const found = await session.query<OperationRow>(
          `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1 for update`, [operationId]
        );
        if (!found.rows[0]) fail("STATE", "System settings operation is unavailable.");
        const current = operation(identity, found.rows[0]);
        const allowed = (current.state === "pending-validation" && (request.state === "validating" || request.state === "promotion-blocked"))
          || (current.state === "validating" && request.state === "promotion-blocked");
        if (current.revision !== expectedRevision || !allowed) fail("REVISION", "System settings operation revision changed.");
        const updated = await session.query<OperationRow>(
          `update k_nex_system_settings_operations set state=$2::varchar, attempts=attempts+1, revision=revision+1,
             lease_owner=case when $2::varchar='promotion-blocked' then null else lease_owner end,
             lease_expires_at=case when $2::varchar='promotion-blocked' then null else lease_expires_at end, updated_at=now()
           where operation_id=$1 and revision=$3 returning ${this.operationColumns}`,
          [operationId, request.state, expectedRevision]
        );
        if (updated.rows.length !== 1) fail("REVISION", "System settings operation revision changed.");
        return operation(identity, updated.rows[0]!);
      });
    } catch (error) { databaseError(error); }
  }

  async claimGenerationValidated(value: unknown): Promise<SettingsValidationClaim> {
    const request = exactObject(value, ["identity", "operationId", "expectedOperationRevision", "authority", "leaseOwner", "now", "leaseExpiresAt"]);
    const identity = parse(SettingsDocumentIdentitySchema, request.identity);
    const operationId = parseOperationId(request.operationId);
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    const authority = this.authority(identity, request.authority);
    const leaseOwner = parseOperationId(request.leaseOwner);
    const now = timestamp(request.now);
    const leaseExpiresAt = timestamp(request.leaseExpiresAt);
    if (expectedRevision === 0 || leaseExpiresAt <= now) fail("INVALID", "System settings validation lease is invalid.");
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, identity);
        await this.assertAuthority(session, identity, authority);
        const found = await session.query<OperationRow>(
          `select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1 for update`, [operationId]
        );
        if (!found.rows[0]) fail("STATE", "System settings operation is unavailable.");
        const current = operation(identity, found.rows[0]);
        const leaseAvailable = current.state === "pending-validation" || current.state === "validating"
          && (current.leaseOwner === leaseOwner || current.leaseExpiresAt! <= now);
        if (current.revision !== expectedRevision || !leaseAvailable) fail("REVISION", "System settings validation lease is unavailable.");
        const runtimeGenerationId = await this.assertConfigurableGeneration(session, identity);
        const updated = await session.query<OperationRow>(
          `update k_nex_system_settings_operations
           set state='validating', attempts=attempts+1, revision=revision+1, lease_owner=$2, lease_expires_at=$3::timestamptz, updated_at=now()
           where operation_id=$1 and revision=$4 returning ${this.operationColumns}`,
          [operationId, leaseOwner, leaseExpiresAt, expectedRevision]
        );
        if (updated.rows.length !== 1) fail("REVISION", "System settings operation revision changed.");
        return Object.freeze({ operation: operation(identity, updated.rows[0]!), runtimeGenerationId });
      });
    } catch (error) { databaseError(error); }
  }

  async promoteGenerationValidated(value: unknown): Promise<SettingsTerminalReceipt> {
    const { input, expectedRevision, leaseOwner } = await this.operationWrite(value);
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, input.identity);
        await this.assertAuthority(session, input.identity, input.authority);
        await this.lockSettingsState(session, input.identity);
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
        if (leaseOwner !== undefined && (active.leaseOwner !== leaseOwner || active.leaseExpiresAt! <= input.occurredAt)) {
          fail("REVISION", "System settings validation lease changed or expired.");
        }
        const current = await this.currentDocument(session, input.identity, true);
        if ((current.document?.documentRevision ?? 0) !== active.expectedDocumentRevision || current.state.settingsRevision !== active.expectedSettingsRevision) {
          fail("REVISION", "System settings revision changed.");
        }
        assertChangedFields(input.changedFields, current.document?.values, active.pendingDocument.values);
        await this.assertConfigurableGeneration(session, input.identity);
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
    const keys = ["identity", "document", "operation", "receipt", "actor", "authorityEnvelope", "authority", "auditId", "changedFields", "expectedOperationRevision", "reason"];
    const withLease = typeof value === "object" && value !== null && Object.hasOwn(value, "leaseOwner");
    const request = exactObject(value, withLease ? [...keys, "leaseOwner"] : keys);
    const input = await this.input({ identity: request.identity, document: request.document, operation: request.operation, receipt: request.receipt, actor: request.actor, authorityEnvelope: request.authorityEnvelope, authority: request.authority, auditId: request.auditId, changedFields: request.changedFields }, false);
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    const failureProbe = parse(SettingsTerminalReceiptSchema, {
      schemaVersion: 1, receiptId: input.receiptId, operationId: input.operationId, identity: input.identity, requestedBy: input.actor,
      authorityDigest: input.authorityDigest, reauthentication: "satisfied",
      idempotencyKey: input.idempotencyKey, occurredAt: input.occurredAt, outcome: "validation-failed", reason: request.reason
    });
    if (expectedRevision === 0 || failureProbe.outcome === "promoted") fail("INVALID", "System settings input is invalid.");
    try {
      return await this.transaction(async (session) => {
        await this.lockScope(session, input.identity);
        await this.assertAuthority(session, input.identity, input.authority);
        await this.lockSettingsState(session, input.identity);
        const replay = await this.findTerminal(session, input);
        if (replay) return replay;
        const owner = ownerColumns(input.identity);
        const found = await session.query<OperationRow>(`select ${this.operationColumns} from k_nex_system_settings_operations where operation_id=$1 for update`, [input.operationId]);
        if (!found.rows[0]) fail("STATE", "System settings operation is unavailable.");
        const active = operationMatches(found.rows[0], input);
        if (!active) fail("IDEMPOTENCY", "System settings operation identity does not match.");
        if (active.revision !== expectedRevision || (active.state !== "validating" && active.state !== "promotion-blocked")) fail("REVISION", "System settings operation revision changed.");
        if (withLease && (active.leaseOwner !== parseOperationId(request.leaseOwner) || active.leaseExpiresAt! <= input.occurredAt)) {
          fail("REVISION", "System settings validation lease changed or expired.");
        }
        const receipt = parse(SettingsTerminalReceiptSchema, {
          schemaVersion: 1, receiptId: input.receiptId, operationId: input.operationId, identity: input.identity, requestedBy: input.actor,
          authorityDigest: input.authorityDigest, reauthentication: "satisfied",
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
    requested_by_id, idempotency_key, request_digest, authority_json, authority_digest, revision, lease_owner, lease_expires_at, updated_at, created_at`;

  private readonly receiptColumns = `receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version,
    owner_scope_key, owner_kind, owner_namespace, owner_delivery_class, owner_extension_id, owner_generation,
    requested_by_kind, requested_by_id, idempotency_key, request_digest, authority_json, authority_digest, outcome, receipt_json, occurred_at`;

  private async lockScope(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity): Promise<void> {
    if (identity.owner.kind === "extension") {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([
        identity.applicationId, identity.environment, identity.owner.deliveryClass, identity.owner.extensionId
      ])]);
    }
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson(identity)]);
  }

  private async assertAuthority(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity, authority: AuthorizationState): Promise<void> {
    const result = await session.query<AuthorizationStateRow>(
      `select application_id, authorization_revision, lifecycle_revision
       from k_nex_authorization_state where application_id=$1 for share`,
      [identity.applicationId]
    );
    const row = result.rows[0];
    const current = row === undefined ? undefined : AuthorizationStateSchema.safeParse({
      schemaVersion: 1,
      applicationId: row.application_id,
      environment: identity.environment,
      authorizationRevision: integer(row.authorization_revision),
      lifecycleRevision: integer(row.lifecycle_revision)
    });
    if (current === undefined || !current.success || current.data.applicationId !== identity.applicationId || current.data.environment !== identity.environment) {
      fail("STATE", "Authorization state is unavailable.");
    }
    if (current.data.authorizationRevision !== authority.authorizationRevision || current.data.lifecycleRevision !== authority.lifecycleRevision) {
      fail("REVISION", "Authorization or lifecycle state changed before settings write.");
    }
  }

  private async lockSettingsState(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity): Promise<void> {
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

  private async assertConfigurableGeneration(session: RuntimeExtensionSession, identity: SettingsDocumentIdentity): Promise<string> {
    if (identity.owner.kind === "platform") return "platform";
    await session.query(
      `select 1 from runtime_extensions
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
      [identity.applicationId, identity.environment, identity.owner.deliveryClass, identity.owner.extensionId]
    );
    await session.query(
      `select generation_id from runtime_extension_generations
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
      [identity.applicationId, identity.environment, identity.owner.deliveryClass, identity.owner.extensionId]
    );
    const result = await session.query<{
      authorization_state: string;
      disposition: string | null;
      active_generation_id: string | null;
      runtime_generation_id: string | null;
      runtime_state: string | null;
      generation_bound: boolean;
      waiting_configuration: boolean;
    }>(
      `select g.state as authorization_state, e.disposition, e.active_generation_id,
              x.generation_id as runtime_generation_id, x.state as runtime_state,
              g.runtime_generation_ids ? x.generation_id as generation_bound,
              exists (
                select 1 from runtime_extension_operations operation
                where operation.application_id=g.application_id and operation.environment=$5
                  and operation.delivery_class=g.delivery_class and operation.extension_id=g.extension_id
                  and operation.phase='waiting-configuration'
                  and operation.plan_json->>'generationId'=g.runtime_generation_ids->>0
              ) as waiting_configuration
       from k_nex_extension_authorization_generations g
       left join runtime_extensions e on e.application_id=g.application_id and e.environment=$5
         and e.delivery_class=g.delivery_class and e.extension_id=g.extension_id
       left join runtime_extension_generations x on x.application_id=g.application_id and x.environment=$5
         and x.delivery_class=g.delivery_class and x.extension_id=g.extension_id
         and x.generation_id=case when g.state='current' then e.active_generation_id else g.runtime_generation_ids->>0 end
       where g.application_id=$1 and g.delivery_class=$2 and g.extension_id=$3 and g.authorization_generation=$4
       for update of g`,
      [identity.applicationId, identity.owner.deliveryClass, identity.owner.extensionId, identity.owner.generation, identity.environment]
    );
    const row = result.rows[0];
    const current = row?.authorization_state === "current" && row.disposition === "active"
      && row.active_generation_id === row.runtime_generation_id && row.runtime_state === "active" && row.generation_bound;
    const pending = row?.authorization_state === "pending-configuration" && identity.owner.deliveryClass === "hot-application"
      && row.runtime_state === "staged" && row.generation_bound && row.waiting_configuration;
    if ((!current && !pending) || row?.runtime_generation_id == null) {
      fail("STATE", "System settings generation is neither active-current nor exact waiting configuration.");
    }
    return row.runtime_generation_id;
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
    if (result.rows.length > 1) fail("IDEMPOTENCY", "System settings identifiers collide with another request.");
    if (!result.rows[0]) return undefined;
    const replay = receiptMatches(result.rows[0], input);
    if (!replay) fail("IDEMPOTENCY", "System settings idempotency key was reused with a different request.");
    return replay;
  }

  private readReceipt(identity: SettingsDocumentIdentity, operationId: string, row: ReceiptRow): SettingsTerminalReceipt {
    const receipt = parse(SettingsTerminalReceiptSchema, row.receipt_json);
    const authority = parse(AdministrationAuthorityEnvelopeSchema, row.authority_json);
    const owner = ownerColumns(identity);
    if (!/^sha256:[0-9a-f]{64}$/u.test(row.request_digest) || row.operation_id !== operationId
      || row.application_id !== identity.applicationId || row.environment !== identity.environment || row.descriptor_id !== identity.descriptorId
      || integer(row.descriptor_schema_version) !== identity.descriptorSchemaVersion || row.owner_scope_key !== owner.ownerScopeKey
      || row.owner_kind !== owner.ownerKind || row.owner_namespace !== owner.ownerNamespace || row.owner_delivery_class !== owner.ownerDeliveryClass
      || row.owner_extension_id !== owner.ownerExtensionId || (row.owner_generation === null ? null : integer(row.owner_generation)) !== owner.ownerGeneration
      || receipt.operationId !== operationId || receipt.operationId !== row.operation_id || canonicalJson(receipt.identity) !== canonicalJson(identity)
      || receipt.receiptId !== row.receipt_id || receipt.idempotencyKey !== row.idempotency_key
      || receipt.outcome !== row.outcome || receipt.occurredAt !== timestamp(row.occurred_at)
      || canonicalJson(receipt.requestedBy) !== canonicalJson({ kind: row.requested_by_kind, id: row.requested_by_id })
      || receipt.authorityDigest !== row.authority_digest || receipt.reauthentication !== "satisfied"
      || authority.applicationId !== identity.applicationId || authority.environment !== identity.environment
      || canonicalJson(authority.effectiveActor) !== canonicalJson(receipt.requestedBy)) {
      fail("STATE", "Stored system settings receipt is invalid.");
    }
    return receipt;
  }

  private promotedReceipt(input: ParsedWrite, pending: ResumableSettingsOperation["pendingDocument"]): Extract<SettingsTerminalReceipt, { outcome: "promoted" }> {
    const result = parse(SettingsTerminalReceiptSchema, {
      schemaVersion: 1, receiptId: input.receiptId, operationId: input.operationId, identity: input.identity,
      requestedBy: input.actor, authorityDigest: input.authorityDigest, reauthentication: "satisfied",
      idempotencyKey: input.idempotencyKey, occurredAt: input.occurredAt, outcome: "promoted",
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
         owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest,
         authority_json, authority_digest, outcome, receipt_json, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,'promoted',$19::jsonb,$20::timestamptz)`,
      [receipt.receiptId, receipt.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, input.idempotencyKey, input.requestDigest,
        canonicalJson(input.authorityEnvelope), input.authorityDigest, canonicalJson(receipt), receipt.occurredAt]
    );
    await session.query(
      `insert into k_nex_system_settings_audit
        (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
         owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome,
         authority_json, authority_digest, reauthentication, document_revision, settings_revision, changed_fields_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'applied',$16::jsonb,$17,'satisfied',$18,$19,$20::jsonb)`,
      [input.auditId, receipt.operationId, receipt.receiptId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, canonicalJson(input.authorityEnvelope), input.authorityDigest,
        receipt.documentRevision, receipt.settingsRevision, canonicalJson(receipt.changedFields)]
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
         owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest,
         authority_json, authority_digest, outcome, receipt_json, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20::jsonb,$21::timestamptz)`,
      [receipt.receiptId, receipt.operationId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, input.idempotencyKey, input.requestDigest,
        canonicalJson(input.authorityEnvelope), input.authorityDigest, receipt.outcome, canonicalJson(receipt), receipt.occurredAt]
    );
    await session.query(
      `insert into k_nex_system_settings_audit
        (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
         owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome,
         authority_json, authority_digest, reauthentication, changed_fields_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,'satisfied','[]'::jsonb)`,
      [input.auditId, receipt.operationId, receipt.receiptId, input.identity.applicationId, input.identity.environment, input.identity.descriptorId,
        input.identity.descriptorSchemaVersion, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, input.actor.kind, input.actor.id, receipt.outcome,
        canonicalJson(input.authorityEnvelope), input.authorityDigest]
    );
  }

  private async operationWrite(value: unknown): Promise<{ input: ParsedWrite; expectedRevision: number; leaseOwner?: string }> {
    const keys = ["identity", "document", "operation", "receipt", "actor", "authorityEnvelope", "authority", "auditId", "changedFields", "expectedOperationRevision"];
    const withLease = typeof value === "object" && value !== null && Object.hasOwn(value, "leaseOwner");
    const request = exactObject(value, withLease ? [...keys, "leaseOwner"] : keys);
    const expectedRevision = positiveOrZero(request.expectedOperationRevision);
    if (expectedRevision === 0) fail("INVALID", "System settings input is invalid.");
    return {
      input: await this.input({ identity: request.identity, document: request.document, operation: request.operation, receipt: request.receipt, actor: request.actor, authorityEnvelope: request.authorityEnvelope, authority: request.authority, auditId: request.auditId, changedFields: request.changedFields }, false),
      expectedRevision,
      ...(withLease ? { leaseOwner: parseOperationId(request.leaseOwner) } : {})
    };
  }

  private async input(value: unknown, requireCurrentEnvelope = true): Promise<ParsedWrite> {
    const input = exactObject(value, ["identity", "document", "operation", "receipt", "actor", "authorityEnvelope", "authority", "auditId", "changedFields"]);
    const documentInput = exactObject(input.document, ["expectedDocumentRevision", "expectedSettingsRevision", "values"]);
    const operation = exactObject(input.operation, ["operationId", "idempotencyKey"]);
    const receipt = exactObject(input.receipt, ["receiptId", "invalidationId", "occurredAt"]);
    const identity = parse(SettingsDocumentIdentitySchema, input.identity);
    const expectedDocumentRevision = positiveOrZero(documentInput.expectedDocumentRevision);
    const expectedSettingsRevision = positiveOrZero(documentInput.expectedSettingsRevision);
    const actor = parse(AuthorizationSubjectSchema, input.actor);
    const authority = this.authority(identity, input.authority);
    const authorityEnvelope = parse(AdministrationAuthorityEnvelopeSchema, input.authorityEnvelope);
    if (authorityEnvelope.applicationId !== identity.applicationId || authorityEnvelope.environment !== identity.environment
      || canonicalJson(authorityEnvelope.effectiveActor) !== canonicalJson(actor)
      || requireCurrentEnvelope && (authorityEnvelope.authorizationRevision !== authority.authorizationRevision
        || authorityEnvelope.lifecycleRevision !== authority.lifecycleRevision
        || Date.parse(authorityEnvelope.reauthentication.verifiedAt) > Date.parse(String(receipt.occurredAt))
        || Date.parse(authorityEnvelope.reauthentication.expiresAt) <= Date.parse(String(receipt.occurredAt)))
      || !authorityEnvelope.permissions.some(({ permissionId, scope }) => permissionId === "system.settings.manage"
        && scope.kind === "application" && scope.resource === "system.settings")
      || authorityEnvelope.permissions.length < 2) fail("INVALID", "System settings authority envelope is invalid.");
    const authorityDigest = await sha256(authorityEnvelope);
    const preview = parse(SettingsTerminalReceiptSchema, {
      schemaVersion: 1,
      receiptId: receipt.receiptId,
      operationId: operation.operationId,
      identity,
      requestedBy: actor,
      authorityDigest: "sha256:" + "0".repeat(64),
      reauthentication: "satisfied",
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
      idempotencyKey: preview.idempotencyKey,
      actor,
      authorityDigest,
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
      authority,
      authorityEnvelope,
      authorityDigest,
      auditId: auditProbe.invalidationId,
      changedFields,
      requestDigest
    });
  }

  private authority(identity: SettingsDocumentIdentity, value: unknown): AuthorizationState {
    const authority = parse(AuthorizationStateSchema, value);
    if (authority.applicationId !== identity.applicationId || authority.environment !== identity.environment) {
      fail("INVALID", "System settings input is invalid.");
    }
    return authority;
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
