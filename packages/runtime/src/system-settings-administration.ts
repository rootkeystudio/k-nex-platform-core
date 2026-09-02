import {
  AuthorizationStateSchema,
  ResourceIdSchema,
  ResumableSettingsOperationSchema,
  SettingsAdministrationViewSchema,
  SettingsChangeInputSchema,
  SettingsDocumentIdentitySchema,
  SettingsStateSchema,
  SettingsStoredDocumentSchema,
  SettingsTerminalReceiptSchema,
  SystemSettingsDescriptorSchema,
  canonicalJson,
  type AuthorizationDecision,
  type AuthorizationState,
  type SettingsAdministrationView,
  type SettingsChangeInput,
  type SettingsDocumentIdentity,
  type SettingsState,
  type SettingsStoredDocument,
  type SettingsTerminalReceipt,
  type ResumableSettingsOperation,
  type PluginSettingValue,
  type SystemSettingsDescriptor
} from "@k-nex/contracts";

import { CurrentAuthorityAdapter, createCurrentAuthorityTarget, type CurrentAuthorityTarget } from "./current-authority-adapter.js";
import { projectSettingsAdministrationView, projectSystemSettingsValues, validateSystemSettingsValues } from "./plugin-settings.js";

export type SystemSettingsAdministrationErrorCode = "UNAUTHORIZED" | "REQUEST_INVALID" | "REVISION_CONFLICT" | "STATE_INVALID";

export class SystemSettingsAdministrationError extends Error {
  constructor(readonly code: SystemSettingsAdministrationErrorCode, message: string) {
    super(message);
    this.name = "SystemSettingsAdministrationError";
  }
}

/** A verified descriptor bound to the exact application, environment, and owner generation. */
export interface SystemSettingsDescriptorRecord {
  readonly descriptor: SystemSettingsDescriptor;
  readonly identity: SettingsDocumentIdentity;
  readonly lifecycle: "active" | "disabled" | "retired";
}

export interface SystemSettingsDescriptorSource {
  list(applicationId: string, environment: string): Promise<readonly SystemSettingsDescriptorRecord[]> | readonly SystemSettingsDescriptorRecord[];
}

/** Structural equivalent of the adapter's existing SystemSettingsSnapshot, kept adapter-free. */
export interface SystemSettingsSnapshot {
  readonly state: SettingsState;
  readonly document?: SettingsStoredDocument;
}

export interface SystemSettingsAdministrationStore {
  read(identity: SettingsDocumentIdentity): Promise<SystemSettingsSnapshot | undefined> | SystemSettingsSnapshot | undefined;
  writeImmediate(input: unknown): Promise<unknown> | unknown;
  beginGenerationValidated(input: unknown): Promise<unknown> | unknown;
}

/** Server-owned IDs and time for persisted receipts. */
export interface SystemSettingsAdministrationMetadata {
  // ponytail: adapter replay must bind the browser request independently of regenerated receipt metadata.
  id(kind: "operation" | "receipt" | "invalidation" | "audit"): unknown;
  now(): unknown;
}

export interface SystemSettingsAdministrationStateSource {
  readState(applicationId: string, environment: string): Promise<AuthorizationState | undefined> | AuthorizationState | undefined;
}

export interface SystemSettingsAdministrationOptions<TContext> {
  readonly authority: CurrentAuthorityAdapter<TContext>;
  readonly descriptorSource: SystemSettingsDescriptorSource;
  readonly state: SystemSettingsAdministrationStateSource;
  readonly store: SystemSettingsAdministrationStore;
  readonly metadata?: SystemSettingsAdministrationMetadata;
}

const readTarget = createCurrentAuthorityTarget({
  permissionId: "system.settings.read",
  scope: { kind: "application", resource: "system.settings" },
  facts: { boundary: "system-settings-administration" }
});
const changeTarget = createCurrentAuthorityTarget({
  permissionId: "system.settings.manage",
  scope: { kind: "application", resource: "system.settings" },
  facts: { boundary: "system-settings-administration" }
});

/** Read-only server facade for system settings administration. */
export class SystemSettingsAdministrationService<TContext> {
  constructor(private readonly options: SystemSettingsAdministrationOptions<TContext>) {}

  async list(input: Readonly<{ readonly context: TContext }>): Promise<readonly SettingsAdministrationView[]> {
    exactInput(input, ["context"]);
    const decision = await this.admit(input.context);
    const records = await this.records(decision);
    const views: SettingsAdministrationView[] = [];
    for (const record of records) {
      if (!await this.descriptorAllowed(input.context, decision, record)) continue;
      await this.current(decision);
      const view = await this.view(record);
      await this.current(decision);
      views.push(view);
    }
    return Object.freeze(views.sort((left, right) => left.identity.descriptorId.localeCompare(right.identity.descriptorId)));
  }

  async detail(input: Readonly<{ readonly context: TContext; readonly settingsId: string }>): Promise<SettingsAdministrationView | undefined> {
    exactInput(input, ["context", "settingsId"]);
    if (!ResourceIdSchema.safeParse(input.settingsId).success) invalid("Settings ID is invalid.");
    const decision = await this.admit(input.context);
    const record = (await this.records(decision)).find((candidate) => candidate.descriptor.id === input.settingsId);
    if (!record || !await this.descriptorAllowed(input.context, decision, record)) return undefined;
    await this.current(decision);
    const view = await this.view(record);
    await this.current(decision);
    return view;
  }

  async change(input: Readonly<{ readonly context: TContext; readonly settingsId: string; readonly change: SettingsChangeInput }>): Promise<SettingsTerminalReceipt | ResumableSettingsOperation> {
    exactInput(input, ["change", "context", "settingsId"]);
    if (!ResourceIdSchema.safeParse(input.settingsId).success) invalid("Settings ID is invalid.");
    const change = SettingsChangeInputSchema.safeParse(input.change);
    if (!change.success) invalid("Settings change input is invalid.");
    const decision = await this.admit(input.context, changeTarget);
    const record = (await this.records(decision)).find((candidate) => candidate.descriptor.id === input.settingsId);
    if (!record) invalid("Settings ID is unavailable.");
    await this.descriptorDecision(input.context, decision, record, record.descriptor.changePermission);
    if (record.lifecycle !== "active") stateInvalid("Only active settings may change.");
    await this.current(decision);
    const snapshot = await this.snapshot(record.identity);
    if (snapshot?.document !== undefined && snapshot.document.state !== "effective") stateInvalid("Settings snapshot is not effective.");
    const documentRevision = snapshot?.document?.documentRevision ?? 0;
    const settingsRevision = snapshot?.state.settingsRevision ?? 0;
    if (change.data.expectedDocumentRevision !== documentRevision || change.data.expectedSettingsRevision !== settingsRevision) {
      conflict("Settings revisions changed before the change was accepted.");
    }
    const values = candidateValues(record.descriptor, snapshot?.document, change.data);
    const changedFields = changed(snapshot?.document?.values, values);
    await this.current(decision);
    const write = this.write(record.identity, decision, change.data, values, changedFields);
    try {
      const result = record.descriptor.validation === "immediate"
        ? await this.options.store.writeImmediate(write)
        : await this.options.store.beginGenerationValidated(write);
      return parseChangeResult(result, record.descriptor.validation);
    } catch (error) { mapStoreError(error); }
  }

  private async admit(context: TContext, target = readTarget): Promise<AuthorizationDecision> {
    let decision: AuthorizationDecision | undefined;
    try { decision = await this.options.authority.authorize(context, target); }
    catch { unauthorized(); }
    if (!allows(decision, target)) unauthorized();
    await this.current(decision);
    return decision;
  }

  private async records(decision: AuthorizationDecision): Promise<readonly SystemSettingsDescriptorRecord[]> {
    let records: unknown;
    try { records = await this.options.descriptorSource.list(decision.applicationId, decision.environment); }
    catch { stateInvalid("Settings descriptors are unavailable."); }
    return parseRecords(records, decision.applicationId, decision.environment);
  }

  private async descriptorAllowed(context: TContext, topLevel: AuthorizationDecision, record: SystemSettingsDescriptorRecord): Promise<boolean> {
    let target: CurrentAuthorityTarget;
    try { target = descriptorTarget(record, record.descriptor.readPermission); }
    catch { stateInvalid("Settings descriptor authorization target is invalid."); }
    let decision: AuthorizationDecision | undefined;
    try { decision = await this.options.authority.authorize(context, target); }
    catch { return false; }
    if (!allows(decision, target)) return false;
    if (!sameDecisionContext(decision, topLevel)) {
      conflict("Descriptor authorization changed before settings values were read.");
    }
    return true;
  }

  private async descriptorDecision(context: TContext, topLevel: AuthorizationDecision, record: SystemSettingsDescriptorRecord, permissionId: string): Promise<AuthorizationDecision> {
    let target: CurrentAuthorityTarget;
    try { target = descriptorTarget(record, permissionId); }
    catch { stateInvalid("Settings descriptor authorization target is invalid."); }
    let decision: AuthorizationDecision | undefined;
    try { decision = await this.options.authority.authorize(context, target); }
    catch { unauthorized(); }
    if (!allows(decision, target)) unauthorized();
    if (!sameDecisionContext(decision, topLevel)) {
      conflict("Descriptor authorization changed before settings were changed.");
    }
    return decision;
  }

  private async current(decision: AuthorizationDecision): Promise<void> {
    let state: unknown;
    try { state = await this.options.state.readState(decision.applicationId, decision.environment); }
    catch { stateInvalid("Authorization state is unavailable."); }
    const parsed = AuthorizationStateSchema.safeParse(state);
    if (!parsed.success || parsed.data.applicationId !== decision.applicationId || parsed.data.environment !== decision.environment) {
      stateInvalid("Authorization state is invalid.");
    }
    if (parsed.data.authorizationRevision !== decision.authorizationRevision || parsed.data.lifecycleRevision !== decision.lifecycleRevision) {
      conflict("Authorization or lifecycle state changed before settings administration.");
    }
  }

  private async view(record: SystemSettingsDescriptorRecord): Promise<SettingsAdministrationView> {
    const parsed = await this.snapshot(record.identity);
    if (parsed?.document) {
      try {
        return projectSettingsAdministrationView(
          record.descriptor,
          parsed.document,
          parsed.state.settingsRevision,
          record.lifecycle === "active" ? undefined : record.lifecycle === "disabled" ? "diagnostic-disabled" : "diagnostic-retired"
        );
      } catch { stateInvalid("Settings projection is invalid."); }
    }
    return defaultView(record, parsed?.state.settingsRevision ?? 0);
  }

  private async snapshot(identity: SettingsDocumentIdentity): Promise<SystemSettingsSnapshot | undefined> {
    let snapshot: unknown;
    try { snapshot = await this.options.store.read(identity); }
    catch { stateInvalid("Settings snapshot is unavailable."); }
    return parseSnapshot(snapshot, identity);
  }

  private write(
    identity: SettingsDocumentIdentity,
    decision: AuthorizationDecision,
    change: SettingsChangeInput,
    values: Readonly<Record<string, unknown>>,
    changedFields: readonly string[]
  ): unknown {
    const metadata = this.options.metadata;
    if (!metadata) stateInvalid("Settings write metadata is unavailable.");
    let occurredAt: string;
    let operationId: unknown;
    let receiptId: unknown;
    let invalidationId: unknown;
    let auditId: unknown;
    try {
      operationId = metadata.id("operation");
      receiptId = metadata.id("receipt");
      invalidationId = metadata.id("invalidation");
      auditId = metadata.id("audit");
      occurredAt = timestamp(metadata.now());
    } catch { stateInvalid("Settings write metadata is invalid."); }
    if (![operationId, receiptId, invalidationId, auditId].every(validId)) stateInvalid("Settings write metadata is invalid.");
    return Object.freeze({
      identity,
      document: Object.freeze({
        expectedDocumentRevision: change.expectedDocumentRevision,
        expectedSettingsRevision: change.expectedSettingsRevision,
        values
      }),
      operation: Object.freeze({ operationId, idempotencyKey: change.idempotencyKey }),
      receipt: Object.freeze({ receiptId, invalidationId, occurredAt }),
      actor: decision.effectiveActor,
      authority: Object.freeze({
        schemaVersion: 1 as const,
        applicationId: decision.applicationId,
        environment: decision.environment,
        authorizationRevision: decision.authorizationRevision,
        lifecycleRevision: decision.lifecycleRevision
      }),
      auditId,
      changedFields
    });
  }
}

function descriptorTarget(record: SystemSettingsDescriptorRecord, permissionId: string): CurrentAuthorityTarget {
  const resource = permissionId.slice(0, permissionId.lastIndexOf("."));
  return createCurrentAuthorityTarget({
    permissionId,
    scope: { kind: "application", resource },
    facts: { boundary: "system-settings-administration", descriptorId: record.descriptor.id, owner: record.identity.owner }
  });
}

function parseRecords(value: unknown, applicationId: string, environment: string): readonly SystemSettingsDescriptorRecord[] {
  if (!Array.isArray(value)) stateInvalid("Settings descriptor source is invalid.");
  const ids = new Set<string>();
  const records = value.map((record) => {
    if (!exactObject(record, ["descriptor", "identity", "lifecycle"])) stateInvalid("Settings descriptor record is invalid.");
    const descriptor = SystemSettingsDescriptorSchema.safeParse(record.descriptor);
    const identity = SettingsDocumentIdentitySchema.safeParse(record.identity);
    if (!descriptor.success || !identity.success || !isLifecycle(record.lifecycle) ||
      identity.data.applicationId !== applicationId || identity.data.environment !== environment ||
      identity.data.descriptorId !== descriptor.data.id || identity.data.descriptorSchemaVersion !== descriptor.data.descriptorSchemaVersion ||
      !ownerMatches(identity.data, descriptor.data) || ids.has(descriptor.data.id)) {
      stateInvalid("Settings descriptor binding is invalid.");
    }
    ids.add(descriptor.data.id);
    return Object.freeze({ descriptor: descriptor.data, identity: identity.data, lifecycle: record.lifecycle });
  });
  return Object.freeze(records.sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id)));
}

function parseSnapshot(value: unknown, identity: SettingsDocumentIdentity): SystemSettingsSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!exactObject(value, ["document", "state"], ["document"])) stateInvalid("Settings snapshot is invalid.");
  const state = SettingsStateSchema.safeParse(value.state);
  const document = value.document === undefined ? undefined : SettingsStoredDocumentSchema.safeParse(value.document);
  if (!state.success || document !== undefined && !document.success || state.data.applicationId !== identity.applicationId || state.data.environment !== identity.environment ||
    document !== undefined && (!sameIdentity(document.data.identity, identity) || document.data.settingsRevision > state.data.settingsRevision)) {
    stateInvalid("Settings snapshot is invalid.");
  }
  return Object.freeze({ state: state.data, ...(document === undefined ? {} : { document: document.data }) });
}

function defaultView(record: SystemSettingsDescriptorRecord, settingsRevision: number): SettingsAdministrationView {
  try {
    const values = projectSystemSettingsValues(record.descriptor);
    const fields = Object.fromEntries(Object.entries(record.descriptor.fields).map(([key, definition]) => {
      const value = values[key];
      return [key, definition.type === "secret-reference"
        ? value === undefined ? { kind: "unset" } : { kind: "redacted-secret" }
        : value === undefined ? { kind: "unset" } : { kind: "visible-value", value }];
    }));
    const parsed = SettingsAdministrationViewSchema.safeParse({
      schemaVersion: 1,
      identity: record.identity,
      descriptor: record.descriptor,
      state: record.lifecycle === "active" ? "effective" : record.lifecycle === "disabled" ? "diagnostic-disabled" : "diagnostic-retired",
      documentRevision: 0,
      settingsRevision,
      fields
    });
    if (!parsed.success) stateInvalid("Default settings projection is invalid.");
    return Object.freeze(parsed.data);
  } catch { stateInvalid("Default settings projection is invalid."); }
}

function candidateValues(
  descriptor: SystemSettingsDescriptor,
  document: SettingsStoredDocument | undefined,
  change: SettingsChangeInput
): Readonly<Record<string, PluginSettingValue>> {
  const values: Record<string, PluginSettingValue> = { ...change.values };
  for (const [key, field] of Object.entries(descriptor.fields)) {
    if (field.type !== "secret-reference") continue;
    delete values[key];
    if (document !== undefined && Object.hasOwn(document.values, key)) values[key] = document.values[key]!;
  }
  try { return validateSystemSettingsValues(descriptor, values); }
  catch { invalid("Settings change values are invalid."); }
}

function changed(before: Readonly<Record<string, unknown>> | undefined, after: Readonly<Record<string, unknown>>): readonly string[] {
  const previous = before ?? {};
  return Object.freeze([...new Set([...Object.keys(previous), ...Object.keys(after)])]
    .filter((key) => !Object.hasOwn(previous, key) || !Object.hasOwn(after, key) || canonicalJson(previous[key]) !== canonicalJson(after[key]))
    .sort());
}

function parseChangeResult(value: unknown, validation: SystemSettingsDescriptor["validation"]): SettingsTerminalReceipt | ResumableSettingsOperation {
  const receipt = SettingsTerminalReceiptSchema.safeParse(value);
  if (receipt.success) return Object.freeze(receipt.data);
  if (validation === "generation-validated") {
    const operation = ResumableSettingsOperationSchema.safeParse(value);
    if (operation.success) return Object.freeze(operation.data);
  }
  stateInvalid("Settings write result is invalid.");
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) stateInvalid("Settings write metadata is invalid.");
  const result = value.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result)) stateInvalid("Settings write metadata is invalid.");
  return result;
}

function validId(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{2,127}$/u.test(value); }

function mapStoreError(error: unknown): never {
  if (error instanceof Error) {
    const code = (error as Error & { readonly code?: unknown }).code;
    if (code === "REVISION" || code === "IDEMPOTENCY") conflict("Settings write conflicted.");
    if (code === "INVALID") invalid("Settings write input is invalid.");
  }
  stateInvalid("Settings write could not be completed.");
}

function allows(decision: AuthorizationDecision | undefined, target: CurrentAuthorityTarget): decision is AuthorizationDecision {
  return decision?.outcome === "allow" && decision.permissionId === target.permissionId && canonicalJson(decision.scope) === canonicalJson(target.scope);
}

function sameDecisionContext(left: AuthorizationDecision, right: AuthorizationDecision): boolean {
  return left.applicationId === right.applicationId && left.environment === right.environment
    && left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision
    && canonicalJson(left.principal) === canonicalJson(right.principal)
    && canonicalJson(left.effectiveActor) === canonicalJson(right.effectiveActor)
    && optionalCanonicalJson(left.delegation) === optionalCanonicalJson(right.delegation);
}

function optionalCanonicalJson(value: unknown): string { return value === undefined ? "undefined" : canonicalJson(value); }

function ownerMatches(identity: SettingsDocumentIdentity, descriptor: SystemSettingsDescriptor): boolean {
  const owner = identity.owner;
  const publisher = descriptor.publisher;
  return owner.kind === "platform" && publisher.kind === "platform" ? owner.namespace === publisher.namespace
    : owner.kind === "extension" && publisher.kind === "extension" && owner.deliveryClass === publisher.deliveryClass && owner.extensionId === publisher.extensionId;
}

function sameIdentity(left: SettingsDocumentIdentity, right: SettingsDocumentIdentity): boolean { return canonicalJson(left) === canonicalJson(right); }
function isLifecycle(value: unknown): value is SystemSettingsDescriptorRecord["lifecycle"] { return value === "active" || value === "disabled" || value === "retired"; }
function exactInput(value: unknown, keys: readonly string[]): void { if (!exactObject(value, keys)) invalid("Settings administration input is invalid."); }
function exactObject(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  const permitted = [...keys].sort();
  return actual.every((key) => permitted.includes(key)) && keys.every((key) => optional.includes(key) || Object.hasOwn(value, key));
}
function invalid(message: string): never { throw new SystemSettingsAdministrationError("REQUEST_INVALID", message); }
function conflict(message: string): never { throw new SystemSettingsAdministrationError("REVISION_CONFLICT", message); }
function unauthorized(): never { throw new SystemSettingsAdministrationError("UNAUTHORIZED", "Current authority does not permit settings administration."); }
function stateInvalid(message: string): never { throw new SystemSettingsAdministrationError("STATE_INVALID", message); }
