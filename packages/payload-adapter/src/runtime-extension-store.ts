import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  compareExactSemverPrecedence,
  ExactSemverSchema,
  ExtensionIdentitySchema,
  ExtensionLifecycleEventSchema,
  ExtensionSecurityQuarantineEventSchema,
  RuntimeExtensionInventorySchema,
  StaticDeploymentReceiptSchema,
  type ExtensionLifecycleEvent,
  type ExtensionSecurityQuarantineEvent,
  type RuntimeExtensionInventory,
  type StaticDeploymentReceipt
} from "@k-nex/contracts";
import type {
  ClaimOperationResult,
  ExtensionActivationReceipt,
  ExtensionDispositionReceipt,
  ExtensionEnableReceipt,
  ExtensionRunnerQuarantineReceipt,
  ExtensionSecurityQuarantineReceipt,
  ExtensionManagerReceipt,
  ExtensionOperationPhase,
  PluginManagerPlan,
  RuntimeExtensionOperation,
  RuntimeExtensionStore,
  RunnerQuarantineReason,
  StagedGenerationActivation,
  StaticApplicationGeneration,
  StaticRetainedGeneration,
  VerifiedGenerationAuthority
} from "@k-nex/runtime";
import type { AuthorizationLifecycleProjectionInput, SharedStaticGenerationRebindInput } from "./authorization-lifecycle-projector.js";

export interface RuntimeExtensionQueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount?: number | null;
}

export interface RuntimeExtensionSession {
  query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<RuntimeExtensionQueryResult<T>>;
  release(): void;
}

export interface RuntimeExtensionPool {
  connect(): Promise<RuntimeExtensionSession>;
  query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<RuntimeExtensionQueryResult<T>>;
}

export interface RuntimeExtensionClock {
  now(): Date;
}

export interface StaticHostPlatformPlugin {
  readonly id: string;
  readonly package: Readonly<{ name: string; version: string; integrity: string }>;
  readonly runtimeGenerationId: string;
}

export interface StaticHostRuntimeInventoryReconciliation {
  readonly applicationId: string;
  readonly environment: string;
  readonly platformPlugins: readonly StaticHostPlatformPlugin[];
  readonly deployment:
    | Readonly<{ kind: "initial"; generation: StaticApplicationGeneration; workerFencingToken: number }>
    | Readonly<{ kind: "receipt"; receipt: StaticDeploymentReceipt }>;
}

interface StaticHostAuthorityRow {
  revision: number;
  active_generation_id: string;
  active_generation: Record<string, unknown>;
  active_execution_generation: string;
  fencing_token: string | number;
  promotion_revision: number;
  lease_expires_at: Date | string;
  event_json: unknown | null;
}

interface RuntimeExtensionAuthorizationLifecycleProjector {
  project(input: AuthorizationLifecycleProjectionInput): Promise<unknown>;
}

interface RuntimeExtensionSharedStaticGenerationRebinder {
  rebind(input: SharedStaticGenerationRebindInput): Promise<void>;
}

const runnerQuarantineReasons = Object.freeze({
  INVOCATION_TIMEOUT: true,
  OUTPUT_BUDGET_EXCEEDED: true,
  PROTOCOL_VIOLATION: true,
  CONTAINER_FAILED: true,
  POLICY_VIOLATION: true
} satisfies Readonly<Record<RunnerQuarantineReason, true>>);

export class RuntimeExtensionStoreError extends Error {
  constructor(readonly code: "REVISION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "OPERATION_IN_PROGRESS" | "OPERATION_NOT_FOUND" | "LEASE_CONFLICT" | "PHASE_CONFLICT" | "GLOBAL_BUDGET_EXHAUSTED" | "GENERATION_MISMATCH" | "VERSION_DOWNGRADE" | "READINESS_EXPIRED" | "ROLLBACK_BLOCKED" | "REFERENCE_CONFLICT" | "STATE_INVALID", message: string) {
    super(message);
    this.name = "RuntimeExtensionStoreError";
  }
}

interface OperationRow {
  operation_id: string;
  application_id: string;
  environment: string;
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  operation_kind: RuntimeExtensionOperation["request"]["operation"];
  request_digest: string;
  request_json: RuntimeExtensionOperation["request"];
  authorization_json: RuntimeExtensionOperation["authorization"];
  expected_revision: number;
  phase: ExtensionOperationPhase;
  lease_owner: string;
  lease_token: string;
  lease_expires_at: Date | string;
  plan_json: PluginManagerPlan | null;
  authority_json: VerifiedGenerationAuthority | null;
  result_json: ExtensionManagerReceipt | null;
}

interface ExtensionRow {
  delivery_class: "platform-plugin" | "hot-application" | "theme-skin";
  extension_id: string;
  revision: number;
  disposition: "active" | "disabled" | "quarantined" | "retirement-pending" | "removed";
  active_generation_id: string | null;
  rollback_generation_id: string | null;
  active_generation: Record<string, unknown> | null;
  rollback_generation: Record<string, unknown> | null;
  rollback_compatibility_json: StagedGenerationActivation["compatibility"] | null;
  retained_generation: Record<string, unknown> | null;
  last_operation_id: string | null;
  last_receipt_id: string | null;
  state_digest: string | null;
  inventory_revision: number;
}

interface GenerationRow {
  generation_id: string;
  version: string;
  authority_json: VerifiedGenerationAuthority;
  authority_digest: string;
  state: "staged" | "warming" | "active" | "rollback" | "retired";
  server_generation_id: string | null;
  ui_generation_id: string | null;
  storage_generation_id: string | null;
  activation_json: Readonly<{ metadata: Record<string, unknown>; settings: Record<string, unknown>; storageSchemaVersions: Record<string, number> }> | null;
  compatibility_json: StagedGenerationActivation["compatibility"] | null;
  readiness_token: string | null;
  readiness_expires_at: Date | string | null;
  staged_revision: number | null;
  receipt_id: string | null;
}

interface SecurityQuarantineReceiptRow {
  receipt_id: string;
  security_transition_id: string;
  application_id: string;
  environment: string;
  delivery_class: "hot-application" | "theme-skin";
  extension_id: string;
  generation_id: string;
  expected_revision: number;
  revision: number;
  inventory_revision: number;
  decision_digest: string;
  receipt_json: unknown;
  event_json: unknown;
}

type SecurityQuarantineInput = Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0];
type SecurityQuarantineTransitionIds = Readonly<{
  decisionDigest: string;
  securityTransitionId: string;
  receiptId: string;
  auditId: string;
  eventId: string;
}>;

function fail(code: RuntimeExtensionStoreError["code"], message: string): never {
  throw new RuntimeExtensionStoreError(code, message);
}

function operation(row: OperationRow): RuntimeExtensionOperation {
  return Object.freeze({
    operationId: row.operation_id,
    request: Object.freeze(row.request_json),
    requestDigest: row.request_digest,
    authorization: Object.freeze(row.authorization_json),
    phase: row.phase,
    leaseToken: row.lease_token,
    ...(row.plan_json ? { plan: Object.freeze(row.plan_json) } : {}),
    ...(row.authority_json ? { authority: Object.freeze(row.authority_json) } : {}),
    ...(row.result_json ? { result: Object.freeze(row.result_json) } : {})
  });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function securityQuarantineTransitionIds(input: SecurityQuarantineInput): Promise<SecurityQuarantineTransitionIds> {
  const decisionDigest = await sha256({
    applicationId: input.applicationId,
    environment: input.environment,
    extension: input.extension,
    expectedRevision: input.expectedRevision,
    generationId: input.generationId,
    decision: input.decision
  });
  const suffix = decisionDigest.slice("sha256:".length, "sha256:".length + 32);
  return Object.freeze({
    decisionDigest,
    securityTransitionId: `security-quarantine-${suffix}`,
    receiptId: `security-receipt-${suffix}`,
    auditId: `security-audit-${suffix}`,
    eventId: `security-event-${suffix}`
  });
}

function timestamp(clock: RuntimeExtensionClock): string {
  const now = clock.now();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail("STATE_INVALID", "Runtime extension clock is invalid.");
  return now.toISOString();
}

function validRecordId(value: string): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(value);
}

function securityQuarantineInput(event: ExtensionSecurityQuarantineEvent): SecurityQuarantineInput {
  return {
    applicationId: event.applicationId,
    environment: event.environment,
    extension: { deliveryClass: event.deliveryClass, id: event.id },
    expectedRevision: event.expectedRevision,
    generationId: event.evidence.generationId,
    decision: {
      catalogDigest: event.evidence.catalogDigest,
      catalogSignerIdentity: event.evidence.catalogSignerIdentity,
      catalogSequence: event.evidence.catalogSequence,
      disposition: event.evidence.disposition,
      release: {
        deliveryClass: event.deliveryClass,
        id: event.id,
        version: event.evidence.version,
        sourceCommit: event.evidence.sourceCommit,
        artifactDigest: event.evidence.artifactDigest,
        manifestDigest: event.evidence.manifestDigest,
        provenanceDigest: event.evidence.provenanceDigest,
        sbomDigest: event.evidence.sbomDigest
      }
    }
  };
}

async function securityQuarantineReceipt(row: SecurityQuarantineReceiptRow): Promise<ExtensionSecurityQuarantineReceipt> {
  let event: ExtensionSecurityQuarantineEvent;
  try { event = ExtensionSecurityQuarantineEventSchema.parse(row.event_json); }
  catch { return fail("STATE_INVALID", "Persisted security quarantine event is invalid."); }
  const input = securityQuarantineInput(event);
  const ids = await securityQuarantineTransitionIds(input);
  if (row.decision_digest !== ids.decisionDigest || event.eventId !== ids.eventId || event.auditId !== ids.auditId ||
    event.receiptId !== ids.receiptId || event.securityTransitionId !== ids.securityTransitionId ||
    row.receipt_id !== ids.receiptId || row.security_transition_id !== ids.securityTransitionId ||
    event.applicationId !== row.application_id || event.environment !== row.environment || event.deliveryClass !== row.delivery_class ||
    event.id !== row.extension_id || event.evidence.generationId !== row.generation_id || event.expectedRevision !== row.expected_revision ||
    event.revision !== row.revision || event.inventoryRevision !== row.inventory_revision) {
    return fail("STATE_INVALID", "Persisted security quarantine receipt does not match its owner or transition evidence.");
  }
  const receipt: ExtensionSecurityQuarantineReceipt = Object.freeze({
    receiptId: event.receiptId,
    securityTransitionId: event.securityTransitionId,
    disposition: "quarantined",
    reason: event.evidence.disposition,
    generationId: event.evidence.generationId,
    revisionBefore: event.expectedRevision,
    revisionAfter: event.revision,
    inventoryRevision: event.inventoryRevision,
    catalogDigest: event.evidence.catalogDigest,
    occurredAt: event.occurredAt
  });
  try {
    if (canonicalJson(row.receipt_json) !== canonicalJson(receipt)) {
      return fail("STATE_INVALID", "Persisted security quarantine receipt does not match its event evidence.");
    }
  } catch {
    return fail("STATE_INVALID", "Persisted security quarantine receipt is invalid.");
  }
  return receipt;
}

function assertStage(stage: StagedGenerationActivation, now: Date, validateCompatibility = true): void {
  const readiness = stage.readiness;
  const readyAt = new Date(readiness.readyAt);
  const expiresAt = new Date(readiness.expiresAt);
  const identities = [readiness.generationId, readiness.serverGenerationId, readiness.uiGenerationId, readiness.storageGenerationId];
  if (!identities.every((identity) => identity === stage.authority.generationId) || !validRecordId(stage.authority.generationId)) {
    fail("GENERATION_MISMATCH", "Server, UI, storage, and artifact generation identities must match.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(readiness.leaseToken) || Number.isNaN(readyAt.valueOf()) || Number.isNaN(expiresAt.valueOf()) ||
    readyAt.valueOf() > now.valueOf() || expiresAt.valueOf() <= now.valueOf() || expiresAt.valueOf() - now.valueOf() > 300_000) {
    fail("READINESS_EXPIRED", "Generation readiness lease is invalid or expired.");
  }
  if (!ExactSemverSchema.safeParse(stage.version).success) fail("STATE_INVALID", "Generation version is invalid.");
  const activationBytes = new TextEncoder().encode(canonicalJson({ metadata: stage.metadata, settings: stage.settings, storageSchemaVersions: stage.storageSchemaVersions })).byteLength;
  if (Object.keys(stage.metadata).length > 128 || Object.keys(stage.settings).length > 128 || Object.keys(stage.storageSchemaVersions).length > 128 || activationBytes > 131_072 ||
    Object.values(stage.storageSchemaVersions).some((revision) => !Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000_000)) {
    fail("STATE_INVALID", "Generation activation changes exceed their bounded contract.");
  }
  if (validateCompatibility) {
    const compatibility = stage.compatibility;
    if (!/^sha256:[0-9a-f]{64}$/u.test(compatibility.migrationDigest) || !Number.isSafeInteger(compatibility.dataRevision) || compatibility.dataRevision < 0 || compatibility.dataRevision > 1_000_000_000 ||
      (compatibility.status === "compatible" && (!validRecordId(compatibility.windowId) || new Date(compatibility.closesAt).valueOf() <= now.valueOf())) ||
      (compatibility.status === "irreversible" && (!validRecordId(compatibility.decisionId) || compatibility.reason.length < 1 || compatibility.reason.length > 512))) {
      fail("STATE_INVALID", "Generation migration compatibility record is invalid.");
    }
  }
}

function evidenceIds(row: OperationRow, revision: number) {
  const suffix = `${row.operation_id.slice("operation-".length)}-${revision}`;
  return { receiptId: `receipt-${suffix}`, auditId: `audit-${suffix}`, eventId: `event-${suffix}` };
}

function operationId(requestDigest: string): string {
  return `operation-${requestDigest.slice("sha256:".length, "sha256:".length + 32)}`;
}

export interface RuntimeExtensionIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly deliveryClass: "platform-plugin" | "hot-application" | "theme-skin";
  readonly extensionId: string;
}

export function runtimeExtensionIdentityKey(identity: RuntimeExtensionIdentity): string {
  return canonicalJson([identity.applicationId, identity.environment, identity.deliveryClass, identity.extensionId]);
}

function identityKey(row: Pick<OperationRow, "application_id" | "environment" | "delivery_class" | "extension_id">): string {
  return runtimeExtensionIdentityKey({
    applicationId: row.application_id,
    environment: row.environment,
    deliveryClass: row.delivery_class,
    extensionId: row.extension_id
  });
}

function assertAuthorityOwner(row: Pick<OperationRow, "application_id" | "environment" | "delivery_class" | "extension_id">, authority: VerifiedGenerationAuthority): void {
  if (row.delivery_class === "platform-plugin" || authority.applicationId !== row.application_id || authority.environment !== row.environment ||
    authority.deliveryClass !== row.delivery_class || authority.extensionId !== row.extension_id) {
    fail("GENERATION_MISMATCH", "Verified generation authority belongs to a different runtime extension owner.");
  }
}

function stateCurrentGenerationId(state: ExtensionRow): string | undefined {
  if (state.active_generation_id) return state.active_generation_id;
  const retained = state.retained_generation?.["generationId"];
  return typeof retained === "string" ? retained : undefined;
}

function assertPlanIdentity(row: OperationRow, plan: PluginManagerPlan, state: ExtensionRow): void {
  const planned = plan.plan;
  const currentGenerationId = stateCurrentGenerationId(state);
  if (plan.operationId !== row.operation_id || planned.operationId !== row.operation_id || planned.operation !== row.operation_kind ||
    planned.deliveryClass !== row.delivery_class || planned.id !== row.extension_id || planned.expectedRevision !== row.expected_revision ||
    planned.currentGenerationId !== currentGenerationId || planned.targetGenerationId !== plan.generationId) {
    fail("GENERATION_MISMATCH", "Persisted plan does not bind this operation to the current inventory generation.");
  }
  if (!planned.targetGenerationId) fail("GENERATION_MISMATCH", "Persisted plan has no target generation identity.");
  const retainedStaticEnable = row.delivery_class === "platform-plugin" && row.operation_kind === "install" &&
    plan.executionClass === "live-generation" && "retainedStaticGeneration" in plan;
  if ((row.delivery_class === "platform-plugin" && (row.operation_kind === "disable" || retainedStaticEnable)) !==
      (plan.executionClass === "live-generation" && planned.deliveryClass === "platform-plugin")) {
    fail("GENERATION_MISMATCH", "Platform Plugin execution class does not match its lifecycle operation.");
  }
  if (row.delivery_class !== "platform-plugin" && plan.executionClass !== "live-generation") {
    fail("GENERATION_MISMATCH", "Dynamic extension operation cannot use static release authority.");
  }
  if (plan.executionClass === "static-release" && plan.quarantineRecovery !==
      (row.operation_kind === "update" && state.disposition === "quarantined")) {
    fail("GENERATION_MISMATCH", "Static quarantine recovery authority does not match durable lifecycle state.");
  }
  if (retainedStaticEnable) {
    if (state.disposition !== "disabled" || !state.retained_generation ||
      canonicalJson(staticRetainedGeneration(state.retained_generation, plan.retainedStaticGeneration.hostInventoryDigest)) !== canonicalJson(plan.retainedStaticGeneration) ||
      plan.sourceCommit !== plan.retainedStaticGeneration.sourceCommit || plan.generationId !== plan.retainedStaticGeneration.generationId ||
      planned.version !== plan.retainedStaticGeneration.version) {
      fail("GENERATION_MISMATCH", "Retained Platform Plugin enable plan does not match the disabled host generation.");
    }
  } else if (["install", "update"].includes(row.operation_kind)) {
    if (planned.targetGenerationId === state.active_generation_id || planned.targetGenerationId === state.rollback_generation_id) {
      fail("GENERATION_MISMATCH", "Install and update target generations must be fresh.");
    }
  } else if (row.operation_kind === "rollback") {
    if (!state.active_generation_id || planned.targetGenerationId !== state.rollback_generation_id) {
      fail("GENERATION_MISMATCH", "Rollback plan must target the retained inventory generation.");
    }
  } else if (row.delivery_class === "platform-plugin" && row.operation_kind === "uninstall") {
    if (!currentGenerationId || planned.targetGenerationId === currentGenerationId || planned.targetGenerationId === state.rollback_generation_id) {
      fail("GENERATION_MISMATCH", "Static uninstall plan must target a fresh application generation.");
    }
  } else if (planned.targetGenerationId !== currentGenerationId) {
    fail("GENERATION_MISMATCH", "Disable plan must remain bound to the active inventory generation.");
  }
}

function staticRetainedGeneration(retained: Record<string, unknown>, hostInventoryDigest: string): StaticRetainedGeneration {
  if (retained["authority"] !== "static-build" || !validRecordId(String(retained["generationId"])) || !ExactSemverSchema.safeParse(retained["version"]).success ||
    typeof retained["sourceCommit"] !== "string" || !/^[0-9a-f]{40}$/u.test(retained["sourceCommit"]) ||
    !["compositionChangePlanDigest", "buildEvidenceDigest", "applicationDigest", "imageDigest"].every((key) => typeof retained[key] === "string" && /^sha256:[0-9a-f]{64}$/u.test(retained[key])) ||
    !Number.isSafeInteger(retained["migrationRevision"]) || Number(retained["migrationRevision"]) < 0 ||
    !Number.isSafeInteger(retained["workerFencingToken"]) || Number(retained["workerFencingToken"]) < 1 ||
    !validRecordId(String(retained["receiptId"])) || !/^sha256:[0-9a-f]{64}$/u.test(hostInventoryDigest)) {
    fail("GENERATION_MISMATCH", "Retained Platform Plugin evidence is invalid.");
  }
  return {
    generationId: String(retained["generationId"]), version: String(retained["version"]), sourceCommit: String(retained["sourceCommit"]),
    compositionChangePlanDigest: String(retained["compositionChangePlanDigest"]), buildEvidenceDigest: String(retained["buildEvidenceDigest"]),
    applicationDigest: String(retained["applicationDigest"]), imageDigest: String(retained["imageDigest"]),
    migrationRevision: Number(retained["migrationRevision"]), workerFencingToken: Number(retained["workerFencingToken"]), receiptId: String(retained["receiptId"]), hostInventoryDigest
  };
}

function staticHostPlugins(input: StaticHostRuntimeInventoryReconciliation): readonly StaticHostPlatformPlugin[] {
  if (!validRecordId(input.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(input.environment) ||
    input.platformPlugins.length < 1 || input.platformPlugins.length > 256) {
    fail("STATE_INVALID", "Static host runtime inventory owner or size is invalid.");
  }
  const plugins = [...input.platformPlugins].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const runtimeGenerationIds = new Set<string>();
  for (const [index, plugin] of plugins.entries()) {
    if (!ExtensionIdentitySchema.safeParse({ deliveryClass: "platform-plugin", id: plugin.id }).success ||
      !validRecordId(plugin.runtimeGenerationId) || !ExactSemverSchema.safeParse(plugin.package.version).success ||
      !/^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u.test(plugin.package.name) ||
      !/^(?:sha256:[0-9a-f]{64}|sha512-[A-Za-z0-9+/]{86}==)$/u.test(plugin.package.integrity) ||
      (index > 0 && plugins[index - 1]!.id === plugin.id) || runtimeGenerationIds.has(plugin.runtimeGenerationId)) {
      fail("STATE_INVALID", "Static host Platform Plugin inventory is invalid.");
    }
    runtimeGenerationIds.add(plugin.runtimeGenerationId);
  }
  return Object.freeze(plugins.map((plugin) => Object.freeze({
    id: plugin.id,
    package: Object.freeze({ ...plugin.package }),
    runtimeGenerationId: plugin.runtimeGenerationId
  })));
}

interface StaticHostDeploymentEvidence {
  readonly activeGenerationId: string;
  readonly sourceCommit: string;
  readonly compositionChangePlanDigest: string;
  readonly buildEvidenceDigest: string;
  readonly applicationDigest: string;
  readonly imageDigest: string;
  readonly migrationRevision: number;
  readonly workerFencingToken: number;
  readonly promotionRevision: number;
  readonly receiptId: string;
  readonly receipt?: StaticDeploymentReceipt;
  readonly initialGeneration?: StaticApplicationGeneration;
}

function staticHostGenerationEvidence(plugin: StaticHostPlatformPlugin, deployment: StaticHostDeploymentEvidence) {
  return Object.freeze({
    authority: "static-build" as const,
    generationId: plugin.runtimeGenerationId,
    version: plugin.package.version,
    sourceCommit: deployment.sourceCommit,
    compositionChangePlanDigest: deployment.compositionChangePlanDigest,
    buildEvidenceDigest: deployment.buildEvidenceDigest,
    applicationDigest: deployment.applicationDigest,
    imageDigest: deployment.imageDigest,
    migrationRevision: deployment.migrationRevision,
    workerFencingToken: deployment.workerFencingToken,
    receiptId: deployment.receiptId
  });
}

function assertStaticHostAuthority(row: StaticHostAuthorityRow | undefined, deployment: StaticHostDeploymentEvidence, now: Date): void {
  const leaseExpiresAt = row ? new Date(row.lease_expires_at).valueOf() : Number.NaN;
  if (!row || row.revision !== deployment.promotionRevision || row.active_generation_id !== deployment.activeGenerationId ||
    row.active_execution_generation !== deployment.activeGenerationId || Number(row.fencing_token) !== deployment.workerFencingToken ||
    row.promotion_revision !== deployment.promotionRevision || !Number.isFinite(now.valueOf()) || !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now.valueOf() ||
    (deployment.receipt ? canonicalJson(row.event_json) !== canonicalJson(deployment.receipt) : row.event_json !== null)) {
    fail("GENERATION_MISMATCH", "Static host deployment receipt, serving generation, or worker fence is not current.");
  }
  const generation = row.active_generation;
  if ((deployment.initialGeneration && canonicalJson(generation) !== canonicalJson(deployment.initialGeneration)) ||
    generation["generationId"] !== deployment.activeGenerationId || generation["sourceCommit"] !== deployment.sourceCommit ||
    generation["compositionChangePlanDigest"] !== deployment.compositionChangePlanDigest || generation["buildEvidenceDigest"] !== deployment.buildEvidenceDigest ||
    generation["applicationDigest"] !== deployment.applicationDigest || generation["imageDigest"] !== deployment.imageDigest ||
    generation["migrationRevision"] !== deployment.migrationRevision) {
    fail("GENERATION_MISMATCH", "Static host deployment generation does not match its durable receipt.");
  }
}

function assertStaticPreparation(row: OperationRow, plan: Extract<PluginManagerPlan, { executionClass: "static-release" }>): void {
  const previous = row.plan_json;
  if (row.phase !== "planning" || !previous || previous.executionClass !== "static-release" ||
    canonicalJson({ operationId: previous.operationId, plan: previous.plan, sourceCommit: previous.sourceCommit, generationId: previous.generationId, quarantineRecovery: previous.quarantineRecovery }) !==
      canonicalJson({ operationId: plan.operationId, plan: plan.plan, sourceCommit: plan.sourceCommit, generationId: plan.generationId, quarantineRecovery: plan.quarantineRecovery })) {
    fail("PHASE_CONFLICT", "Static release preparation does not match the persisted impact plan.");
  }
  if (previous.preparation === "impact-only") {
    if (plan.preparation !== "source-ready" || plan.sourceChange.status !== "source-change-ready") {
      fail("PHASE_CONFLICT", "Static release source preparation transition is invalid.");
    }
    return;
  }
  if (previous.preparation !== "source-ready" || plan.preparation !== "prepared" ||
    canonicalJson(plan.sourceChange) !== canonicalJson(previous.sourceChange) || plan.deployment.status !== "build-requested" ||
    plan.deployment.sourceCommit !== plan.sourceChange.targetSourceCommit) {
    fail("PHASE_CONFLICT", "Static release preparation transition is invalid.");
  }
}

function transitionEvidence(row: OperationRow, authority: VerifiedGenerationAuthority | undefined, staticReceipt?: StaticDeploymentReceipt, retainedGeneration?: Record<string, unknown>) {
  const plan = row.plan_json;
  if (!plan) fail("STATE_INVALID", "A lifecycle transition requires a persisted plan.");
  if (plan.executionClass === "static-release") {
    if (plan.preparation === "impact-only") fail("STATE_INVALID", "Static lifecycle transitions require source preparation evidence.");
    return {
      sourceCommit: plan.sourceChange.targetSourceCommit,
      compositionChangePlanDigest: plan.sourceChange.planDigest,
      generationId: plan.generationId,
      ...(plan.preparation === "prepared" ? { buildRequestDigest: plan.deployment.buildRequestDigest } : {}),
      ...(staticReceipt ? {
        buildEvidenceDigest: staticReceipt.buildEvidenceDigest,
        applicationDigest: staticReceipt.applicationDigest,
        imageDigest: staticReceipt.imageDigest
      } : {})
    };
  }
  if (row.delivery_class === "platform-plugin") {
    if (!retainedGeneration || typeof retainedGeneration["sourceCommit"] !== "string" || typeof retainedGeneration["compositionChangePlanDigest"] !== "string" || typeof retainedGeneration["generationId"] !== "string") {
      fail("STATE_INVALID", "Runtime-only Platform Plugin transition is missing its retained static generation evidence.");
    }
    return {
      sourceCommit: retainedGeneration["sourceCommit"],
      compositionChangePlanDigest: retainedGeneration["compositionChangePlanDigest"],
      generationId: retainedGeneration["generationId"],
      ...(typeof retainedGeneration["buildEvidenceDigest"] === "string" ? { buildEvidenceDigest: retainedGeneration["buildEvidenceDigest"] } : {}),
      ...(typeof retainedGeneration["applicationDigest"] === "string" ? { applicationDigest: retainedGeneration["applicationDigest"] } : {}),
      ...(typeof retainedGeneration["imageDigest"] === "string" ? { imageDigest: retainedGeneration["imageDigest"] } : {})
    };
  }
  if (row.delivery_class === "hot-application" && !authority && retainedGeneration) {
    return retainedHotApplicationEvidence(row, retainedGeneration);
  }
  return {
    sourceCommit: authority?.sourceCommit ?? plan.sourceCommit,
    artifactDigest: authority?.artifactDigest ?? plan.plan.artifactDigest,
    generationId: authority?.generationId ?? plan.generationId,
    ...(authority ? {
      manifestDigest: authority.manifestDigest,
      catalogDigest: authority.catalogDigest,
      provenanceDigest: authority.provenanceDigest,
      sbomDigest: authority.sbomDigest
    } : {})
  };
}

function retainedHotApplicationEvidence(row: OperationRow, retainedGeneration: Record<string, unknown>) {
  const sourceCommit = retainedGeneration["sourceCommit"];
  const artifactDigest = retainedGeneration["artifactDigest"];
  const manifestDigest = retainedGeneration["manifestDigest"];
  const catalogDigest = retainedGeneration["catalogDigest"];
  const provenanceDigest = retainedGeneration["provenanceDigest"];
  const sbomDigest = retainedGeneration["sbomDigest"];
  const generationId = retainedGeneration["generationId"];
  if (retainedGeneration["authority"] !== "verified-bundle" || retainedGeneration["applicationId"] !== row.application_id ||
    retainedGeneration["environment"] !== row.environment || retainedGeneration["deliveryClass"] !== row.delivery_class ||
    retainedGeneration["extensionId"] !== row.extension_id || typeof generationId !== "string" || !validRecordId(generationId) ||
    typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
    typeof artifactDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(artifactDigest) ||
    typeof manifestDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(manifestDigest) ||
    typeof catalogDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(catalogDigest) ||
    typeof provenanceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(provenanceDigest) ||
    typeof sbomDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(sbomDigest)) {
    fail("GENERATION_MISMATCH", "Retained Hot Application generation evidence does not bind the exact verified extension owner.");
  }
  return { sourceCommit, artifactDigest, generationId, manifestDigest, catalogDigest, provenanceDigest, sbomDigest };
}

function lifecycleState(phase: ExtensionOperationPhase): ExtensionLifecycleEvent["lifecycleState"] {
  if (["planning", "downloading", "verified", "staged", "waiting-configuration", "waiting-approval", "warming"].includes(phase)) {
    return phase as ExtensionLifecycleEvent["lifecycleState"];
  }
  if (phase === "completed" || phase === "rollback-window-open") return "active";
  return phase === "failed" ? "quarantined" : "planning";
}

const allowedTransitions: Readonly<Record<ExtensionOperationPhase, readonly ExtensionOperationPhase[]>> = Object.freeze({
  planning: ["downloading", "source-change-required", "failed"],
  downloading: ["verified", "failed"],
  verified: ["staged", "failed"],
  staged: ["waiting-configuration", "waiting-approval", "warming", "failed"],
  "waiting-configuration": ["waiting-approval", "warming", "failed"],
  "waiting-approval": ["warming", "failed"],
  warming: ["completed", "failed"],
  "source-change-required": ["source-change-ready", "failed"],
  "source-change-ready": ["build-attested", "failed"],
  "build-attested": ["zero-downtime-eligible", "maintenance-required", "unsupported", "failed"],
  "zero-downtime-eligible": ["rollback-window-open", "completed", "failed"],
  "maintenance-required": ["completed", "failed"],
  unsupported: ["failed"],
  "rollback-window-open": ["rollback-window-closed", "failed"],
  "rollback-window-closed": ["contract-cleanup-eligible", "completed", "failed"],
  "contract-cleanup-eligible": ["completed", "failed"],
  completed: [],
  failed: []
});

export class PostgresRuntimeExtensionStore implements RuntimeExtensionStore {
  private readonly leaseMs: number;
  private readonly maxConcurrentOperations: number;
  private readonly reconciliationBatchSize: number;
  private readonly authorizationLifecycleProjector: RuntimeExtensionAuthorizationLifecycleProjector | undefined;
  private readonly sharedStaticGenerationRebinder: RuntimeExtensionSharedStaticGenerationRebinder;

  constructor(
    private readonly pool: RuntimeExtensionPool,
    private readonly clock: RuntimeExtensionClock,
    private readonly hostInventoryDigest: string,
    options: Readonly<{
      leaseMs?: number;
      maxConcurrentOperations?: number;
      reconciliationBatchSize?: number;
      authorizationLifecycleProjector?: RuntimeExtensionAuthorizationLifecycleProjector;
      sharedStaticGenerationRebinder: RuntimeExtensionSharedStaticGenerationRebinder;
    }>
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxConcurrentOperations = options.maxConcurrentOperations ?? 16;
    this.reconciliationBatchSize = options.reconciliationBatchSize ?? this.maxConcurrentOperations;
    this.authorizationLifecycleProjector = options.authorizationLifecycleProjector;
    this.sharedStaticGenerationRebinder = options.sharedStaticGenerationRebinder;
    if (!/^sha256:[0-9a-f]{64}$/u.test(hostInventoryDigest) || !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1 ||
      !Number.isSafeInteger(this.maxConcurrentOperations) || this.maxConcurrentOperations < 1 || this.maxConcurrentOperations > 512 ||
      !Number.isSafeInteger(this.reconciliationBatchSize) || this.reconciliationBatchSize < 1 || this.reconciliationBatchSize > 512) {
      throw new TypeError("Runtime extension store configuration is invalid.");
    }
  }

  /**
   * Seeds an empty Platform Plugin projection from locked revision-zero deployment
   * state or a durable supervisor receipt. Boot reconciliation is not a user lifecycle
   * transition, so it cannot fabricate actor audit or authorization transition evidence.
   */
  async reconcileStaticHostInventory(input: StaticHostRuntimeInventoryReconciliation): Promise<RuntimeExtensionInventory> {
    const plugins = staticHostPlugins(input);
    const configuredHostInventoryDigest = await sha256({ applicationId: input.applicationId, environment: input.environment, platformPlugins: plugins });
    if (configuredHostInventoryDigest !== this.hostInventoryDigest) {
      fail("GENERATION_MISMATCH", "Static host inventory differs from the configured immutable host inventory.");
    }
    let deployment: StaticHostDeploymentEvidence;
    if (input.deployment.kind === "receipt") {
      const parsed = StaticDeploymentReceiptSchema.safeParse(input.deployment.receipt);
      if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(input.deployment.receipt) ||
        !["promote", "rollback"].includes(parsed.data.operation) || parsed.data.applicationId !== input.applicationId || parsed.data.environment !== input.environment) {
        fail("GENERATION_MISMATCH", "Static host inventory does not bind the current deployment receipt.");
      }
      const receipt = parsed.data;
      if (receipt.promotionRevision !== receipt.revisionAfter) fail("GENERATION_MISMATCH", "Static deployment receipt revision is inconsistent.");
      deployment = Object.freeze({
        activeGenerationId: receipt.activeGenerationId, sourceCommit: receipt.sourceCommit,
        compositionChangePlanDigest: receipt.compositionChangePlanDigest, buildEvidenceDigest: receipt.buildEvidenceDigest,
        applicationDigest: receipt.applicationDigest, imageDigest: receipt.imageDigest, migrationRevision: receipt.migrationRevision,
        workerFencingToken: receipt.workerFencingToken, promotionRevision: receipt.promotionRevision, receiptId: receipt.receiptId, receipt
      });
    } else {
      const generation = input.deployment.generation;
      if (!validRecordId(generation.generationId) || !/^[0-9a-f]{40}$/u.test(generation.sourceCommit) ||
        ![generation.compositionChangePlanDigest, generation.buildEvidenceDigest, generation.applicationDigest, generation.imageDigest].every((value) => /^sha256:[0-9a-f]{64}$/u.test(value)) ||
        !/^[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/u.test(generation.imageReference) || !generation.imageReference.endsWith(`@${generation.imageDigest}`) ||
        !Number.isSafeInteger(generation.migrationRevision) || generation.migrationRevision < 0 ||
        !Number.isSafeInteger(input.deployment.workerFencingToken) || input.deployment.workerFencingToken < 1) {
        fail("GENERATION_MISMATCH", "Initial static host deployment evidence is invalid.");
      }
      const initialDigest = await sha256({ applicationId: input.applicationId, environment: input.environment, generation, workerFencingToken: input.deployment.workerFencingToken, hostInventoryDigest: this.hostInventoryDigest });
      deployment = Object.freeze({
        activeGenerationId: generation.generationId, sourceCommit: generation.sourceCommit,
        compositionChangePlanDigest: generation.compositionChangePlanDigest, buildEvidenceDigest: generation.buildEvidenceDigest,
        applicationDigest: generation.applicationDigest, imageDigest: generation.imageDigest, migrationRevision: generation.migrationRevision,
        workerFencingToken: input.deployment.workerFencingToken, promotionRevision: 0,
        receiptId: `static-host-initial-${initialDigest.slice("sha256:".length, "sha256:".length + 32)}`,
        initialGeneration: Object.freeze(structuredClone(generation))
      });
    }
    const reconciliationDigest = await sha256({ applicationId: input.applicationId, environment: input.environment, receiptId: deployment.receiptId, hostInventoryDigest: this.hostInventoryDigest });
    const operationId = `static-host-reconcile-${reconciliationDigest.slice("sha256:".length, "sha256:".length + 32)}`;
    await this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([input.applicationId, input.environment, "static-host-runtime-inventory"])]);
      const authority = await session.query<StaticHostAuthorityRow>(
        `select d.revision, d.active_generation_id, d.active_generation,
           f.active_execution_generation, f.fencing_token, f.promotion_revision, f.lease_expires_at, x.event_json
         from runtime_static_deployments d
         join runtime_worker_generation_fences f using (application_id, environment)
         left join runtime_static_deployment_outbox x on x.application_id=d.application_id and x.environment=d.environment
           and x.revision=d.revision and ($3::varchar is null or x.event_id=$3)
         where d.application_id=$1 and d.environment=$2
         for update of d, f`,
        [input.applicationId, input.environment, deployment.receipt ? deployment.receiptId : null]
      );
      assertStaticHostAuthority(authority.rows[0], deployment, this.clock.now());
      const existing = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions
         where application_id=$1 and environment=$2 and delivery_class='platform-plugin'
         order by extension_id for update`,
        [input.applicationId, input.environment]
      );
      const configured = new Map(plugins.map((plugin) => [plugin.id, staticHostGenerationEvidence(plugin, deployment)]));
      if (existing.rows.length > 0) {
        for (const row of existing.rows) {
          const expected = configured.get(row.extension_id);
          if (!expected) {
            if (row.disposition === "active") fail("GENERATION_MISMATCH", "Active Platform Plugin is absent from configured host inventory.");
            continue;
          }
          configured.delete(row.extension_id);
          const actual = row.disposition === "active" ? row.active_generation : row.disposition === "removed" ? null : row.retained_generation;
          if (!actual || canonicalJson(actual) !== canonicalJson(expected) ||
            (row.disposition === "active" && row.active_generation_id !== expected.generationId)) {
            fail("GENERATION_MISMATCH", "Platform Plugin runtime projection differs from current host release evidence.");
          }
        }
        if (configured.size > 0) fail("GENERATION_MISMATCH", "Configured Platform Plugin is missing from an initialized runtime projection.");
        return;
      }
      await session.query(
        `insert into runtime_extension_inventory_revisions (application_id, environment, revision)
         values ($1,$2,0) on conflict do nothing`,
        [input.applicationId, input.environment]
      );
      const advanced = await session.query<{ revision: number }>(
        `update runtime_extension_inventory_revisions set revision=revision+1
         where application_id=$1 and environment=$2 returning revision`,
        [input.applicationId, input.environment]
      );
      if (!advanced.rows[0]) fail("STATE_INVALID", "Static host runtime inventory revision is unavailable.");
      for (const plugin of plugins) {
        const evidence = staticHostGenerationEvidence(plugin, deployment);
        const stateDigest = await sha256({ disposition: "active", generation: evidence, hostInventoryDigest: this.hostInventoryDigest });
        const inserted = await session.query(
          `insert into runtime_extensions (
             application_id, environment, delivery_class, extension_id, revision, disposition,
             active_generation_id, active_generation, last_operation_id, last_receipt_id, state_digest
           ) values ($1,$2,'platform-plugin',$3,1,'active',$4,$5::jsonb,$6,$7,$8)
           on conflict do nothing returning extension_id`,
          [input.applicationId, input.environment, plugin.id, plugin.runtimeGenerationId, JSON.stringify(evidence), operationId, deployment.receiptId, stateDigest]
        );
        if (inserted.rowCount !== 1) fail("REVISION_CONFLICT", "Platform Plugin runtime projection changed during host reconciliation.");
      }
    });
    return this.inventory(input.applicationId, input.environment);
  }

  async reconcileExpiredOperations(input: Readonly<{ applicationId: string; environment: string }>): Promise<number> {
    const now = timestamp(this.clock);
    return this.transaction(async (session) => {
      const expired = await session.query<OperationRow>(
        `select * from runtime_extension_operations
         where application_id=$1 and environment=$2 and phase not in ('completed','failed') and lease_expires_at <= $3
         order by lease_expires_at, operation_id
         limit $4 for update skip locked`,
        [input.applicationId, input.environment, now, this.reconciliationBatchSize]
      );
      let reclaimed = 0;
      for (const candidate of expired.rows) {
        const identityLock = await session.query<{ acquired: boolean }>(
          "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired",
          [identityKey(candidate)]
        );
        if (!identityLock.rows[0]?.acquired) continue;
        const failed = await session.query<OperationRow>(
          `update runtime_extension_operations
           set phase='failed', lease_owner='expired-operation-reconciler', lease_token=$2, lease_expires_at=$3, updated_at=now()
           where operation_id=$1 and phase not in ('completed','failed') and lease_expires_at <= $3
           returning *`,
          [candidate.operation_id, randomUUID(), now]
        );
        const row = failed.rows[0];
        if (!row) continue;
        // A claim without a persisted plan never reached the lifecycle evidence boundary; manufacturing bundle evidence for it would be false.
        if (row.plan_json && !(row.plan_json.executionClass === "static-release" && row.plan_json.preparation === "impact-only")) {
          await this.appendTransition(session, row, "failed", undefined);
        }
        await session.query(
          `update runtime_extension_operation_budget set active_count=greatest(active_count-1,0) where application_id=$1 and environment=$2`,
          [row.application_id, row.environment]
        );
        reclaimed += 1;
      }
      return reclaimed;
    });
  }

  async claimOperation(input: Parameters<RuntimeExtensionStore["claimOperation"]>[0]): Promise<ClaimOperationResult> {
    return this.transaction(async (session) => {
      const request = input.request;
      const key = canonicalJson([request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      await session.query(
        `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition)
         values ($1, $2, $3, $4, 0, 'removed') on conflict do nothing`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]
      );
      await session.query(
        `insert into runtime_extension_inventory_revisions (application_id, environment, revision) values ($1, $2, 0) on conflict do nothing`,
        [request.applicationId, request.environment]
      );
      const state = await session.query<ExtensionRow>(
        `select * from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]
      );
      const replay = await session.query<OperationRow>(
        `select * from runtime_extension_operations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and operation_kind=$5 and idempotency_key=$6`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id, request.operation, request.idempotencyKey]
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_digest !== input.requestDigest) fail("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request.");
        return Object.freeze({ status: "replay", operation: operation(replay.rows[0]) });
      }

      if (state.rows[0]?.revision !== request.expectedRevision) fail("REVISION_CONFLICT", "Runtime extension revision differs from the requested revision.");
      const activeVersion = state.rows[0]?.active_generation?.["version"];
      if (["install", "update"].includes(request.operation) && typeof activeVersion === "string" && compareExactSemverPrecedence(request.targetVersion, activeVersion) < 0) {
        fail("VERSION_DOWNGRADE", "Install and update cannot downgrade the active extension version.");
      }

      const active = await session.query<{ operation_id: string }>(
        `select operation_id from runtime_extension_operations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and phase not in ('completed','failed') for update`,
        [request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id]
      );
      if (active.rows.length > 0) fail("OPERATION_IN_PROGRESS", "Another operation owns this extension identity.");

      await session.query(
        `insert into runtime_extension_operation_budget (application_id, environment, active_count, max_count)
         values ($1, $2, 0, $3) on conflict do nothing`,
        [request.applicationId, request.environment, this.maxConcurrentOperations]
      );
      const budget = await session.query<{ active_count: number; max_count: number }>(
        `select active_count, max_count from runtime_extension_operation_budget where application_id=$1 and environment=$2 for update`,
        [request.applicationId, request.environment]
      );
      const available = budget.rows[0];
      if (!available || available.active_count >= available.max_count) fail("GLOBAL_BUDGET_EXHAUSTED", "Runtime extension operation budget is exhausted.");
      await session.query(`update runtime_extension_operation_budget set active_count=active_count+1 where application_id=$1 and environment=$2`, [request.applicationId, request.environment]);

      const id = operationId(input.requestDigest);
      const token = randomUUID();
      const expiresAt = new Date(this.clock.now().valueOf() + this.leaseMs).toISOString();
      const inserted = await session.query<OperationRow>(
        `insert into runtime_extension_operations (
           operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
           request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,'planning',$12,$13,$14)
         returning *`,
        [id, request.applicationId, request.environment, request.extension.deliveryClass, request.extension.id, request.operation, request.idempotencyKey,
          input.requestDigest, JSON.stringify(request), JSON.stringify(input.authorization), request.expectedRevision, input.workerId, token, expiresAt]
      );
      if (!inserted.rows[0]) fail("STATE_INVALID", "Runtime operation insert returned no row.");
      return Object.freeze({ status: "claimed", operation: operation(inserted.rows[0]) });
    });
  }

  async resumeOperation(id: string, workerId: string): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const result = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
      const row = result.rows[0];
      if (!row) fail("OPERATION_NOT_FOUND", "Runtime extension operation is unavailable.");
      if (["completed", "failed"].includes(row.phase)) return operation(row);
      const now = this.clock.now();
      if (new Date(row.lease_expires_at).valueOf() > now.valueOf() && row.lease_owner !== workerId) fail("LEASE_CONFLICT", "Runtime extension operation has a live lease.");
      const token = randomUUID();
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set lease_owner=$2, lease_token=$3, lease_expires_at=$4, updated_at=now() where operation_id=$1 returning *`,
        [id, workerId, token, new Date(now.valueOf() + this.leaseMs).toISOString()]
      );
      return operation(updated.rows[0]!);
    });
  }

  async savePlan(id: string, token: string, plan: PluginManagerPlan): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, id, token);
      const state = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const current = state.rows[0];
      if (!current || current.revision !== row.expected_revision) fail("REVISION_CONFLICT", "Runtime extension revision changed before planning.");
      assertPlanIdentity(row, plan, current);
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set plan_json=$3::jsonb, updated_at=now() where operation_id=$1 and lease_token=$2 returning *`,
        [id, token, JSON.stringify(plan)]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension plan lease changed.");
      if (!(plan.executionClass === "static-release" && plan.preparation === "impact-only")) {
        const retainedStaticReenable = plan.executionClass === "live-generation" && row.delivery_class === "platform-plugin" &&
          row.operation_kind === "install" && "retainedStaticGeneration" in plan;
        const retainedGeneration = retainedStaticReenable ? current.retained_generation : current.active_generation;
        if (retainedStaticReenable && !retainedGeneration) fail("GENERATION_MISMATCH", "Platform Plugin re-enable lost its retained host generation.");
        await this.appendTransition(session, saved, "planning", undefined, retainedGeneration ?? undefined);
      }
      return operation(saved);
    });
  }

  async saveStaticPreparation(id: string, token: string, plan: Extract<PluginManagerPlan, { executionClass: "static-release" }>): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, id, token);
      assertStaticPreparation(row, plan);
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set plan_json=$3::jsonb, updated_at=now() where operation_id=$1 and lease_token=$2 returning *`,
        [id, token, JSON.stringify(plan)]
      );
      if (!updated.rows[0]) fail("LEASE_CONFLICT", "Runtime extension preparation lease changed.");
      return operation(updated.rows[0]);
    });
  }

  async transition(input: Parameters<RuntimeExtensionStore["transition"]>[0]) {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.plan_json?.executionClass === "static-release" && row.plan_json.preparation !== "prepared") {
        fail("PHASE_CONFLICT", "Static lifecycle transitions require a prepared source/build plan.");
      }
      if (row.phase !== input.expectedPhase) fail("PHASE_CONFLICT", "Runtime extension operation phase changed.");
      if (!allowedTransitions[row.phase].includes(input.phase)) fail("PHASE_CONFLICT", `Runtime extension transition ${row.phase} -> ${input.phase} is invalid.`);
      if (input.authority) assertAuthorityOwner(row, input.authority);
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set phase=$3, authority_json=coalesce($4::jsonb, authority_json), updated_at=now()
         where operation_id=$1 and lease_token=$2 returning *`,
        [input.operationId, input.leaseToken, input.phase, input.authority ? JSON.stringify(input.authority) : null]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension transition lease changed.");
      const event = await this.appendTransition(session, saved, input.phase, input.authority);
      if (input.phase === "completed" || input.phase === "failed") {
        await session.query(`update runtime_extension_operation_budget set active_count=greatest(active_count-1,0) where application_id=$1 and environment=$2`, [saved.application_id, saved.environment]);
      }
      return Object.freeze({ operation: operation(saved), event });
    });
  }

  async stageGeneration(input: Parameters<RuntimeExtensionStore["stageGeneration"]>[0]) {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.phase !== "staged" || row.plan_json?.executionClass !== "live-generation" || !row.authority_json) {
        fail("PHASE_CONFLICT", "Only a staged live generation can enter warm-up.");
      }
      const stage = input.stage;
      assertStage(stage, this.clock.now());
      assertAuthorityOwner(row, stage.authority);
      if (canonicalJson(stage.authority) !== canonicalJson(row.authority_json) || stage.version !== row.plan_json.plan.version) {
        fail("GENERATION_MISMATCH", "Prepared generation authority differs from the verified operation authority.");
      }
      const activation = { metadata: stage.metadata, settings: stage.settings, storageSchemaVersions: stage.storageSchemaVersions };
      const authorityDigest = await sha256(stage.authority);
      const staged = await session.query<GenerationRow>(
        `insert into runtime_extension_generations (
           application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest,
           previous_generation_id, rollback_eligible, state, server_generation_id, ui_generation_id, storage_generation_id,
           activation_json, compatibility_json, readiness_token, readiness_expires_at
         ) values ($1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,$6::varchar,$7::jsonb,$8::varchar,
           (select active_generation_id from runtime_extensions where application_id=$1::varchar and environment=$2::varchar and delivery_class=$3::varchar and extension_id=$4::varchar),
           $9,'warming',$5::varchar,$5::varchar,$5::varchar,$10::jsonb,$11::jsonb,$12::varchar,$13::timestamptz)
         on conflict (application_id, environment, delivery_class, extension_id, generation_id) do update set
           state='warming', activation_json=excluded.activation_json, compatibility_json=excluded.compatibility_json,
           readiness_token=excluded.readiness_token, readiness_expires_at=excluded.readiness_expires_at
         where runtime_extension_generations.authority_digest=excluded.authority_digest
         returning *`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, stage.authority.generationId, stage.version,
          JSON.stringify(stage.authority), authorityDigest, stage.compatibility.status === "compatible", JSON.stringify(activation),
          JSON.stringify(stage.compatibility), stage.readiness.leaseToken, stage.readiness.expiresAt]
      );
      if (!staged.rows[0]) fail("GENERATION_MISMATCH", "A different artifact already owns this generation identity.");
      const updated = await session.query<OperationRow>(
        `update runtime_extension_operations set phase='warming', updated_at=now() where operation_id=$1 and lease_token=$2 and phase='staged' returning *`,
        [input.operationId, input.leaseToken]
      );
      const saved = updated.rows[0];
      if (!saved) fail("LEASE_CONFLICT", "Runtime extension warm-up lease changed.");
      const event = await this.appendTransition(session, saved, "warming", stage.authority);
      await session.query(
        `update runtime_extension_generations set staged_revision=$6 where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, stage.authority.generationId, event.revision]
      );
      return Object.freeze({ operation: operation(saved), event });
    });
  }

  async refreshGenerationReadiness(input: Parameters<RuntimeExtensionStore["refreshGenerationReadiness"]>[0]): Promise<RuntimeExtensionOperation> {
    return this.transaction(async (session) => {
      const row = await this.lockOperation(session, input.operationId, input.leaseToken);
      if (row.phase !== "warming" || row.plan_json?.executionClass !== "live-generation" || !row.authority_json) {
        fail("PHASE_CONFLICT", "Only a warming live generation can refresh readiness.");
      }
      assertStage(input.stage, this.clock.now());
      assertAuthorityOwner(row, input.stage.authority);
      if (canonicalJson(input.stage.authority) !== canonicalJson(row.authority_json) || input.stage.version !== row.plan_json.plan.version) {
        fail("GENERATION_MISMATCH", "Refreshed generation authority differs from the verified operation authority.");
      }
      const activation = { metadata: input.stage.metadata, settings: input.stage.settings, storageSchemaVersions: input.stage.storageSchemaVersions };
      const refreshed = await session.query(
        `update runtime_extension_generations g set activation_json=$6::jsonb, compatibility_json=$7::jsonb, readiness_token=$8, readiness_expires_at=$9
         from runtime_extensions e
         where g.application_id=$1 and g.environment=$2 and g.delivery_class=$3 and g.extension_id=$4 and g.generation_id=$5
           and g.application_id=e.application_id and g.environment=e.environment and g.delivery_class=e.delivery_class and g.extension_id=e.extension_id
           and g.state='warming' and g.staged_revision=e.revision and g.authority_digest=$10 returning g.generation_id`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, input.stage.authority.generationId,
          JSON.stringify(activation), JSON.stringify(input.stage.compatibility), input.stage.readiness.leaseToken, input.stage.readiness.expiresAt,
          await sha256(input.stage.authority)]
      );
      if (refreshed.rowCount !== 1) fail("REVISION_CONFLICT", "Warming generation changed before readiness refresh.");
      return operation(row);
    });
  }

  async activateGeneration(id: string, token: string): Promise<ExtensionActivationReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, ["install", "update"]);
      if (replay) return replay as ExtensionActivationReceipt;
      const row = await this.lockOperation(session, id, token);
      if (row.phase !== "warming" || row.plan_json?.executionClass !== "live-generation" || !row.authority_json || !["install", "update"].includes(row.operation_kind)) {
        fail("PHASE_CONFLICT", "Only a warming live generation can activate.");
      }
      assertAuthorityOwner(row, row.authority_json);
      const identity = identityKey(row);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state) fail("STATE_INVALID", "Runtime extension state is unavailable.");
      const generationResult = await session.query<GenerationRow>(
        `select * from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, row.authority_json.generationId]
      );
      const generation = generationResult.rows[0];
      if (!generation || generation.staged_revision !== state.revision || generation.server_generation_id !== generation.generation_id ||
        generation.ui_generation_id !== generation.generation_id || generation.storage_generation_id !== generation.generation_id) {
        fail("GENERATION_MISMATCH", "Staged server, UI, storage, and extension revisions do not form one generation.");
      }
      assertAuthorityOwner(row, generation.authority_json);
      if (!generation.readiness_expires_at || new Date(generation.readiness_expires_at).valueOf() <= this.clock.now().valueOf()) {
        fail("READINESS_EXPIRED", "Generation readiness expired before activation.");
      }
      if (!generation.activation_json || !generation.compatibility_json) fail("STATE_INVALID", "Generation activation evidence is incomplete.");

      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const { receiptId } = evidenceIds(row, revision);
      const activeGeneration = this.bundleGenerationEvidence(generation, receiptId);
      const previousGeneration = state.active_generation ?? state.retained_generation;
      const previousGenerationId = previousGeneration ? state.active_generation_id ?? undefined : undefined;
      const recoveredFromQuarantine = state.disposition === "quarantined";
      const rollbackAvailable = !recoveredFromQuarantine && Boolean(previousGeneration && generation.compatibility_json.status === "compatible");
      const updateCompatibility = row.operation_kind === "update"
        ? state.disposition === "quarantined" ? "incompatible" : this.updateAuthorizationCompatibility(generation.compatibility_json, rollbackAvailable)
        : undefined;
      const priorGenerationEvidence = row.operation_kind === "update"
        ? previousGeneration ?? fail("STATE_INVALID", "Update has no active immutable generation evidence.")
        : undefined;
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition='active', active_generation_id=$6, active_generation=$7::jsonb,
           rollback_generation_id=$8, rollback_generation=$9::jsonb, retained_generation=null,
           metadata_json=$10::jsonb, settings_json=$11::jsonb, storage_schema_versions=$12::jsonb,
           rollback_compatibility_json=$13::jsonb, last_operation_id=$14, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$15`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, generation.generation_id, JSON.stringify(activeGeneration),
          rollbackAvailable ? previousGenerationId : null, rollbackAvailable ? JSON.stringify(previousGeneration) : null,
          JSON.stringify(generation.activation_json.metadata), JSON.stringify(generation.activation_json.settings), JSON.stringify(generation.activation_json.storageSchemaVersions),
          rollbackAvailable ? JSON.stringify(generation.compatibility_json) : null, row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed before activation.");
      await session.query(
        `update runtime_extension_generations set state=case when generation_id=$5 then 'active' when generation_id=$6 then 'rollback' else state end,
           receipt_id=case when generation_id=$5 then $7 else receipt_id end, activated_at=case when generation_id=$5 then now() else activated_at end
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id in ($5,$6)`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, generation.generation_id, previousGenerationId ?? generation.generation_id, receiptId]
      );
      const event = await this.writeTransitionEvidence(session, row, "completed", row.authority_json, revision, inventoryRevision);
      await this.projectAuthorizationLifecycle(
        session,
        event,
        [generation.generation_id],
        updateCompatibility,
        priorGenerationEvidence
      );
      const receipt: ExtensionActivationReceipt = Object.freeze({
        receiptId: event.receiptId, operationId: row.operation_id, operation: row.operation_kind as "install" | "update",
        generationId: generation.generation_id, ...(previousGenerationId ? { previousGenerationId } : {}), revisionBefore: state.revision,
        revisionAfter: revision, inventoryRevision, compatibility: generation.compatibility_json,
        rollback: generation.compatibility_json.status === "irreversible" ? "blocked-irreversible" : rollbackAvailable ? "available" : "unavailable",
        occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async enableGeneration(id: string, token: string): Promise<ExtensionEnableReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, ["install"]);
      if (replay) return replay as ExtensionEnableReceipt;
      const row = await this.lockOperation(session, id, token);
      const plan = row.plan_json;
      if (row.phase !== "planning" || row.delivery_class !== "platform-plugin" || row.operation_kind !== "install" ||
        plan?.executionClass !== "live-generation" || !("retainedStaticGeneration" in plan)) {
        fail("PHASE_CONFLICT", "Only a retained disabled Platform Plugin generation can be enabled live.");
      }
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identityKey(row)]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== row.expected_revision + 1 || state.disposition !== "disabled" || state.active_generation_id || !state.retained_generation) {
        fail("REVISION_CONFLICT", "Disabled Platform Plugin changed before re-enable.");
      }
      const retained = staticRetainedGeneration(state.retained_generation, this.hostInventoryDigest);
      if (canonicalJson(retained) !== canonicalJson(plan.retainedStaticGeneration) || plan.sourceCommit !== retained.sourceCommit ||
        plan.generationId !== retained.generationId || plan.plan.targetGenerationId !== retained.generationId || plan.plan.currentGenerationId !== retained.generationId ||
        plan.plan.version !== retained.version) {
        fail("GENERATION_MISMATCH", "Retained Platform Plugin or current host inventory does not match the enable plan.");
      }
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition='active', active_generation_id=$6, active_generation=$7::jsonb,
           rollback_generation_id=null, rollback_generation=null, retained_generation=null, rollback_compatibility_json=null,
           last_operation_id=$8, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$9`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, retained.generationId,
          JSON.stringify(state.retained_generation), row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Disabled Platform Plugin changed during re-enable.");
      await session.query(
        `update runtime_extension_generations set state='active', receipt_id=$6, activated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, retained.generationId, evidenceIds(row, revision).receiptId]
      );
      const event = await this.writeTransitionEvidence(session, row, "completed", undefined, revision, inventoryRevision, "active", undefined, state.retained_generation);
      await this.projectAuthorizationLifecycle(session, event, [retained.generationId]);
      const receipt: ExtensionEnableReceipt = Object.freeze({
        receiptId: event.receiptId, operationId: row.operation_id, operation: "install", disposition: "active", generationId: retained.generationId,
        sourceCommit: retained.sourceCommit, compositionChangePlanDigest: retained.compositionChangePlanDigest, buildEvidenceDigest: retained.buildEvidenceDigest,
        applicationDigest: retained.applicationDigest, imageDigest: retained.imageDigest, hostInventoryDigest: retained.hostInventoryDigest,
        revisionBefore: state.revision, revisionAfter: revision, inventoryRevision, occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async rollbackGeneration(id: string, token: string, stage: StagedGenerationActivation): Promise<ExtensionActivationReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, ["rollback"]);
      if (replay) return replay as ExtensionActivationReceipt;
      const row = await this.lockOperation(session, id, token);
      if (row.phase !== "planning" || row.operation_kind !== "rollback" || row.plan_json?.executionClass !== "live-generation") {
        fail("PHASE_CONFLICT", "Only a planned live-generation rollback can commit.");
      }
      assertStage(stage, this.clock.now(), false);
      assertAuthorityOwner(row, stage.authority);
      const authorityDigest = await sha256(stage.authority);
      const identity = identityKey(row);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== row.expected_revision + 1) fail("REVISION_CONFLICT", "Rollback expected revision does not match the planned active state.");
      const compatibility = state.rollback_compatibility_json;
      if (compatibility?.status === "irreversible") {
        fail("ROLLBACK_BLOCKED", `Rollback is blocked by irreversible migration decision ${compatibility.decisionId}.`);
      }
      assertPlanIdentity(row, row.plan_json, state);
      if (!state.active_generation_id || !state.active_generation) fail("ROLLBACK_BLOCKED", "No active generation is available for rollback.");
      if (!state.rollback_generation_id || !state.rollback_generation) fail("ROLLBACK_BLOCKED", "No compatible prior generation is retained.");
      const targetResult = await session.query<GenerationRow>(
        `select * from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, state.rollback_generation_id]
      );
      const target = targetResult.rows[0];
      if (!target || !target.activation_json || !compatibility) fail("ROLLBACK_BLOCKED", "Rollback generation evidence is incomplete.");
      assertStage(stage, this.clock.now(), false);
      const now = this.clock.now();
      if (compatibility.status !== "compatible" || !validRecordId(compatibility.windowId) || !/^sha256:[0-9a-f]{64}$/u.test(compatibility.migrationDigest) ||
        !Number.isSafeInteger(compatibility.dataRevision) || compatibility.dataRevision < 0 || compatibility.dataRevision > 1_000_000_000 ||
        !Number.isFinite(Date.parse(compatibility.closesAt)) || Date.parse(compatibility.closesAt) <= now.valueOf()) {
        fail("ROLLBACK_BLOCKED", "Rollback compatibility window is closed or invalid.");
      }
      const retained = state.rollback_generation;
      const retainedEvidence = target.receipt_id && validRecordId(target.receipt_id)
        ? this.bundleGenerationEvidence(target, target.receipt_id)
        : undefined;
      if (stage.readiness.leaseToken === target.readiness_token) {
        fail("READINESS_EXPIRED", "Rollback readiness lease was not freshly prepared.");
      }
      if (target.generation_id !== state.rollback_generation_id || target.state !== "rollback" || target.server_generation_id !== target.generation_id ||
        target.ui_generation_id !== target.generation_id || target.storage_generation_id !== target.generation_id || target.version !== row.plan_json.plan.version ||
        stage.version !== target.version || canonicalJson(stage.authority) !== canonicalJson(target.authority_json) || authorityDigest !== target.authority_digest ||
        canonicalJson({ metadata: stage.metadata, settings: stage.settings, storageSchemaVersions: stage.storageSchemaVersions }) !== canonicalJson(target.activation_json) ||
        !retainedEvidence || canonicalJson(retained) !== canonicalJson(retainedEvidence) || row.plan_json.sourceCommit !== stage.authority.sourceCommit ||
        row.plan_json.plan.artifactDigest !== stage.authority.artifactDigest) {
        fail("GENERATION_MISMATCH", "Rollback stage does not bind the exact retained immutable generation.");
      }
      assertAuthorityOwner(row, target.authority_json);

      const revision = state.revision + 1;
      const refreshed = await session.query(
        `update runtime_extension_generations set readiness_token=$6, readiness_expires_at=$7, staged_revision=$8
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5
           and state='rollback' and authority_digest=$9 returning generation_id`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, target.generation_id,
          stage.readiness.leaseToken, stage.readiness.expiresAt, state.revision, authorityDigest]
      );
      if (refreshed.rowCount !== 1) fail("REVISION_CONFLICT", "Retained generation changed before rollback readiness refresh.");
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const { receiptId } = evidenceIds(row, revision);
      const targetEvidence = this.bundleGenerationEvidence(target, receiptId);
      const updated = await session.query(
        `update runtime_extensions set revision=$5, active_generation_id=$6, active_generation=$7::jsonb,
           rollback_generation_id=$8, rollback_generation=$9::jsonb, metadata_json=$10::jsonb, settings_json=$11::jsonb,
           storage_schema_versions=$12::jsonb, last_operation_id=$13, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$14`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, state.rollback_generation_id, JSON.stringify(targetEvidence),
          state.active_generation_id, JSON.stringify(state.active_generation), JSON.stringify(target.activation_json.metadata), JSON.stringify(target.activation_json.settings),
          JSON.stringify(target.activation_json.storageSchemaVersions), row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed before rollback.");
      await session.query(
        `update runtime_extension_generations set state=case when generation_id=$5 then 'active' when generation_id=$6 then 'rollback' else state end,
           receipt_id=case when generation_id=$5 then $7 else receipt_id end
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id in ($5,$6)`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, state.rollback_generation_id, state.active_generation_id, receiptId]
      );
      const authority = target.authority_json;
      const event = await this.writeTransitionEvidence(session, row, "completed", authority, revision, inventoryRevision);
      await this.projectAuthorizationLifecycle(session, event, [target.generation_id]);
      const receipt: ExtensionActivationReceipt = Object.freeze({
        receiptId: event.receiptId, operationId: row.operation_id, operation: "rollback", generationId: state.rollback_generation_id,
        previousGenerationId: state.active_generation_id, revisionBefore: state.revision, revisionAfter: revision, inventoryRevision,
        compatibility, rollback: "available", occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async completeStaticRelease(id: string, token: string, receipt: StaticDeploymentReceipt): Promise<StaticDeploymentReceipt> {
    return this.transaction(async (session) => {
      const persisted = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
      const replay = persisted.rows[0];
      if (replay?.phase === "completed") {
        if (replay.plan_json?.executionClass !== "static-release" || !replay.result_json || !("activeGenerationId" in replay.result_json) || canonicalJson(replay.result_json) !== canonicalJson(receipt)) {
          fail("STATE_INVALID", "Completed static release operation has a different persisted receipt.");
        }
        return replay.result_json;
      }
      const row = await this.lockOperation(session, id, token);
      if (row.delivery_class !== "platform-plugin" || row.plan_json?.executionClass !== "static-release" || row.plan_json.preparation !== "prepared" ||
        !["source-change-ready", "build-attested", "zero-downtime-eligible", "rollback-window-open"].includes(row.phase)) {
        fail("PHASE_CONFLICT", "Static deployment receipt cannot complete this runtime operation.");
      }
      const plan = row.plan_json;
      if (receipt.applicationId !== row.application_id || receipt.environment !== row.environment || receipt.activeGenerationId !== plan.generationId ||
        receipt.sourceCommit !== plan.sourceChange.targetSourceCommit || receipt.compositionChangePlanDigest !== plan.sourceChange.planDigest ||
        receipt.operation !== (row.operation_kind === "rollback" ? "rollback" : "promote") ||
        (row.operation_kind === "uninstall" &&
          (receipt.previousGenerationId !== plan.plan.currentGenerationId || receipt.activeGenerationId === receipt.previousGenerationId))) {
        fail("GENERATION_MISMATCH", "Static deployment receipt does not bind the planned runtime operation.");
      }
      const identity = identityKey(row);
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state) fail("STATE_INVALID", "Runtime extension state is unavailable.");
      assertPlanIdentity(row, plan, state);
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const previousGeneration = state.active_generation ?? state.retained_generation;
      const active = !["disable", "uninstall"].includes(row.operation_kind);
      const recoveredFromQuarantine = state.disposition === "quarantined";
      const retained = active && !recoveredFromQuarantine
        ? previousGeneration && receipt.rollbackWindow.state === "open" ? previousGeneration : null
        : previousGeneration;
      const activeGeneration = active ? this.staticGenerationEvidence(plan, receipt) : null;
      const disposition = row.operation_kind === "disable" ? "disabled" : row.operation_kind === "uninstall" ? "removed" : "active";
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition=$6, active_generation_id=$7, active_generation=$8::jsonb,
           rollback_generation_id=$9, rollback_generation=$10::jsonb, retained_generation=$11::jsonb, last_operation_id=$12, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$13`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, disposition,
          active ? receipt.activeGenerationId : null, active ? JSON.stringify(activeGeneration) : null,
          active && !recoveredFromQuarantine && retained ? String(retained["generationId"]) : null,
          active && !recoveredFromQuarantine && retained ? JSON.stringify(retained) : null,
          !active && previousGeneration ? JSON.stringify(previousGeneration) : null, row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed before static receipt reconciliation.");
      const event = await this.writeTransitionEvidence(session, row, "completed", undefined, revision, inventoryRevision, disposition, receipt);
      const previousRuntimeGenerationId = stateCurrentGenerationId(state);
      const updateCompatibility = row.operation_kind === "update"
        ? state.disposition === "quarantined" ? "incompatible" : this.updateAuthorizationCompatibilityFromStaticReceipt(receipt)
        : undefined;
      const priorGenerationEvidence = row.operation_kind === "update"
        ? previousGeneration ?? fail("STATE_INVALID", "Static update has no active immutable generation evidence.")
        : undefined;
      await this.projectAuthorizationLifecycle(
        session,
        event,
        [active ? receipt.activeGenerationId : previousRuntimeGenerationId ?? fail("STATE_INVALID", "Static disposition has no prior plugin generation.")],
        updateCompatibility,
        priorGenerationEvidence
      );
      await this.sharedStaticGenerationRebinder.rebind({
        session,
        applicationId: row.application_id,
        environment: row.environment,
        previousGenerationId: receipt.previousGenerationId,
        receipt,
        excludeExtensionId: row.extension_id,
        operationId: row.operation_id
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async disableGeneration(id: string, token: string): Promise<ExtensionDispositionReceipt> {
    return this.changeDisposition(id, token, "disable", "disabled");
  }

  async uninstallGeneration(id: string, token: string): Promise<ExtensionDispositionReceipt> {
    return this.changeDisposition(id, token, "uninstall", "removed");
  }

  async quarantineActiveGeneration(input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0]): Promise<ExtensionSecurityQuarantineReceipt> {
    if (!validRecordId(input.generationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      input.extension.deliveryClass !== input.decision.release.deliveryClass || input.extension.id !== input.decision.release.id ||
      input.generationId.length < 1 || !/^sha256:[0-9a-f]{64}$/u.test(input.decision.catalogDigest) ||
      !Number.isSafeInteger(input.decision.catalogSequence) || input.decision.catalogSequence < 1 ||
      !/^[a-z0-9][a-z0-9.-]{0,159}$/u.test(input.decision.catalogSignerIdentity) ||
      ![
        "revoked",
        "security-compromised",
        "security-advisory",
        "review-rejected",
        "review-pending",
        "support-unsupported",
        "support-deprecated",
        "release-missing",
        "release-evidence-mismatch",
        "publisher-key-mismatch"
      ].includes(input.decision.disposition)) {
      fail("STATE_INVALID", "Security quarantine decision is invalid.");
    }
    const transition = await securityQuarantineTransitionIds(input);
    return this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id])]);
      const replay = await session.query<SecurityQuarantineReceiptRow>(
        `select receipt_id, security_transition_id, application_id, environment, delivery_class, extension_id, generation_id,
                expected_revision, revision, inventory_revision, decision_digest, receipt_json, event_json
         from runtime_extension_security_receipts where decision_digest=$1 for update`,
        [transition.decisionDigest]
      );
      if (replay.rows[0]) return securityQuarantineReceipt(replay.rows[0]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Runtime extension revision changed before security quarantine.");
      if (state.disposition !== "active" || state.active_generation_id !== input.generationId || !state.active_generation) {
        fail("GENERATION_MISMATCH", "Security quarantine no longer targets the active generation.");
      }
      this.assertSecurityDecisionMatchesActive(input, state.active_generation);
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, input.applicationId, input.environment);
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition='quarantined', active_generation_id=null, active_generation=null,
           rollback_generation_id=null, rollback_generation=null, retained_generation=$6::jsonb, rollback_compatibility_json=null,
           last_operation_id=$7, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$8`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, revision,
          JSON.stringify(state.active_generation), transition.securityTransitionId, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed during security quarantine.");
      await session.query(
        `update runtime_extension_generations set state='retired'
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 and state='active'`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId]
      );
      await session.query(
        `delete from runtime_extension_generation_leases where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id]
      );
      const receipt: ExtensionSecurityQuarantineReceipt = Object.freeze({
        receiptId: transition.receiptId,
        securityTransitionId: transition.securityTransitionId,
        disposition: "quarantined",
        reason: input.decision.disposition,
        generationId: input.generationId,
        revisionBefore: state.revision,
        revisionAfter: revision,
        inventoryRevision,
        catalogDigest: input.decision.catalogDigest,
        occurredAt: timestamp(this.clock)
      });
      const event = await this.writeSecurityQuarantineEvidence(session, input, transition, receipt);
      await this.projectAuthorizationLifecycle(session, event, [input.generationId]);
      return receipt;
    });
  }

  async readSecurityQuarantineReceipt(input: Parameters<RuntimeExtensionStore["readSecurityQuarantineReceipt"]>[0]): Promise<ExtensionSecurityQuarantineReceipt | undefined> {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(input.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(input.environment) ||
      !validRecordId(input.generationId) ||
      (input.extension.deliveryClass === "hot-application" && !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(input.extension.id)) ||
      (input.extension.deliveryClass === "theme-skin" && !/^skin(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(input.extension.id))) {
      fail("STATE_INVALID", "Security quarantine receipt lookup is invalid.");
    }
    const result = await this.pool.query<SecurityQuarantineReceiptRow>(
      `select receipt_id, security_transition_id, application_id, environment, delivery_class, extension_id, generation_id,
              expected_revision, revision, inventory_revision, decision_digest, receipt_json, event_json
       from runtime_extension_security_receipts
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5
       order by revision desc limit 1`,
      [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId]
    );
    const row = result.rows[0];
    return row ? await securityQuarantineReceipt(row) : undefined;
  }

  async quarantineRunnerGeneration(input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0]): Promise<ExtensionRunnerQuarantineReceipt> {
    if (!/^[a-z][a-z0-9-]{2,127}$/u.test(input.applicationId) || !/^[a-z][a-z0-9-]{1,63}$/u.test(input.environment) ||
      !/^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u.test(input.appId) || !validRecordId(input.generationId) ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      runnerQuarantineReasons[input.reason] !== true) {
      fail("STATE_INVALID", "Runner quarantine request is invalid.");
    }
    const transition = await this.runnerQuarantineTransitionIds(input);
    return this.transaction(async (session) => {
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([input.applicationId, input.environment, "hot-application", input.appId])]);
      const replay = await session.query<{ receipt_json: ExtensionRunnerQuarantineReceipt }>(
        `select receipt_json from runtime_extension_runner_quarantine_receipts where quarantine_digest=$1 for update`,
        [transition.quarantineDigest]
      );
      if (replay.rows[0]) return Object.freeze({ ...replay.rows[0].receipt_json });
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 for update`,
        [input.applicationId, input.environment, input.appId]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Runtime extension revision changed before runner quarantine.");
      if (state.disposition !== "active" || state.active_generation_id !== input.generationId || !state.active_generation || !state.last_operation_id) {
        fail("GENERATION_MISMATCH", "Runner quarantine no longer targets the active generation.");
      }
      const operationResult = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for share`, [state.last_operation_id]);
      const row = operationResult.rows[0];
      if (!row || row.delivery_class !== "hot-application" || row.extension_id !== input.appId) fail("STATE_INVALID", "Runner quarantine cannot reconstruct its authoritative lifecycle evidence.");
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, input.applicationId, input.environment);
      const updated = await session.query(
        `update runtime_extensions set revision=$4, disposition='quarantined', active_generation_id=null, active_generation=null,
           rollback_generation_id=null, rollback_generation=null, retained_generation=$5::jsonb, rollback_compatibility_json=null,
           last_operation_id=$6, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 and revision=$7`,
        [input.applicationId, input.environment, input.appId, revision, JSON.stringify(state.active_generation), transition.quarantineTransitionId, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", "Runtime extension revision changed during runner quarantine.");
      await session.query(
        `update runtime_extension_generations set state='retired'
         where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3 and generation_id=$4 and state='active'`,
        [input.applicationId, input.environment, input.appId, input.generationId]
      );
      await session.query(
        `delete from runtime_extension_generation_leases where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3`,
        [input.applicationId, input.environment, input.appId]
      );
      const receipt: ExtensionRunnerQuarantineReceipt = Object.freeze({
        receiptId: transition.receiptId,
        quarantineTransitionId: transition.quarantineTransitionId,
        disposition: "quarantined",
        reason: input.reason,
        generationId: input.generationId,
        revisionBefore: state.revision,
        revisionAfter: revision,
        inventoryRevision,
        occurredAt: timestamp(this.clock)
      });
      const event = await this.writeRunnerQuarantineEvidence(session, row, input, transition, receipt);
      await this.projectAuthorizationLifecycle(session, event, [input.generationId]);
      return receipt;
    });
  }

  private async changeDisposition(
    id: string,
    token: string,
    operationKind: "disable" | "uninstall",
    disposition: "disabled" | "removed"
  ): Promise<ExtensionDispositionReceipt> {
    return this.transaction(async (session) => {
      const replay = await this.completedReceipt(session, id, [operationKind]);
      if (replay) return replay as ExtensionDispositionReceipt;
      const row = await this.lockOperation(session, id, token);
      if (row.phase !== "planning" || row.operation_kind !== operationKind || row.plan_json?.executionClass !== "live-generation") {
        fail("PHASE_CONFLICT", `Only a planned live-generation ${operationKind} can commit.`);
      }
      if (row.delivery_class === "platform-plugin" && operationKind === "uninstall") {
        fail("PHASE_CONFLICT", "Platform Plugin uninstall requires static source/build authority.");
      }
      await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identityKey(row)]);
      const stateResult = await session.query<ExtensionRow>(
        `select *, 0::int as inventory_revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for update`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      const state = stateResult.rows[0];
      if (!state || state.revision !== row.expected_revision + 1) fail("REVISION_CONFLICT", `${operationKind} expected revision does not match the planned state.`);
      if (operationKind === "disable" && (state.disposition !== "active" || !state.active_generation_id || !state.active_generation)) {
        fail("STATE_INVALID", "Only an active extension can be disabled.");
      }
      if (operationKind === "uninstall" && state.disposition === "removed") fail("STATE_INVALID", "Removed extension cannot be uninstalled again.");
      if (row.delivery_class === "theme-skin") {
        const reference = await session.query<{ profile_id: string }>(
          `select profile_id from runtime_theme_profile_publications
           where application_id=$1 and environment=$2 and (
             active_profile->'skin'->>'id'=$3 or previous_profile->'skin'->>'id'=$3 or draft_profile->'skin'->>'id'=$3
           ) limit 1`,
          [row.application_id, row.environment, row.extension_id]
        );
        if (reference.rows[0]) fail("REFERENCE_CONFLICT", "Theme Skin is still referenced by a durable Theme Profile revision.");
      }
      const previousGeneration = state.active_generation ?? state.retained_generation;
      const previousGenerationId = previousGeneration && typeof previousGeneration["generationId"] === "string" ? previousGeneration["generationId"] : undefined;
      const revision = state.revision + 1;
      const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
      const retained = disposition === "disabled" ? state.active_generation : null;
      const updated = await session.query(
        `update runtime_extensions set revision=$5, disposition=$6::varchar, active_generation_id=null, active_generation=null,
           rollback_generation_id=null, rollback_generation=null, retained_generation=$7::jsonb, rollback_compatibility_json=null,
           metadata_json=case when $6::varchar='removed' then '{}'::jsonb else metadata_json end,
           settings_json=case when $6::varchar='removed' then '{}'::jsonb else settings_json end,
           storage_schema_versions=case when $6::varchar='removed' then '{}'::jsonb else storage_schema_versions end,
           last_operation_id=$8, updated_at=now()
         where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and revision=$9`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id, revision, disposition, retained ? JSON.stringify(retained) : null, row.operation_id, state.revision]
      );
      if (updated.rowCount !== 1) fail("REVISION_CONFLICT", `Runtime extension changed before ${operationKind}.`);
      await session.query(
        `delete from runtime_extension_generation_leases where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
        [row.application_id, row.environment, row.delivery_class, row.extension_id]
      );
      if (disposition === "removed") {
        await session.query(
          `delete from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
          [row.application_id, row.environment, row.delivery_class, row.extension_id]
        );
      } else {
        await session.query(
          `update runtime_extension_generations set state='retired' where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and state in ('active','rollback')`,
          [row.application_id, row.environment, row.delivery_class, row.extension_id]
        );
      }
      const event = await this.writeTransitionEvidence(session, row, "completed", undefined, revision, inventoryRevision, disposition, undefined, previousGeneration ?? undefined);
      if (row.delivery_class !== "theme-skin") {
        if (!previousGenerationId) fail("STATE_INVALID", `${operationKind} has no current runtime generation.`);
        await this.projectAuthorizationLifecycle(session, event, [previousGenerationId]);
      }
      const receipt: ExtensionDispositionReceipt = Object.freeze({
        receiptId: event.receiptId,
        operationId: row.operation_id,
        operation: operationKind,
        disposition,
        ...(previousGenerationId ? { previousGenerationId } : {}),
        revisionBefore: state.revision,
        revisionAfter: revision,
        inventoryRevision,
        occurredAt: event.occurredAt
      });
      await this.completeOperation(session, row, receipt);
      return receipt;
    });
  }

  async readOperation(id: string): Promise<RuntimeExtensionOperation | undefined> {
    const result = await this.pool.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1`, [id]);
    return result.rows[0] ? operation(result.rows[0]) : undefined;
  }

  async observeActiveGeneration(applicationId: string, environment: string, extension: Parameters<RuntimeExtensionStore["observeActiveGeneration"]>[2]) {
    const result = await this.pool.query<{ revision: number; inventory_revision: number; active_generation_id: string | null }>(
      `select e.revision, coalesce(i.revision,0)::int inventory_revision, e.active_generation_id
       from runtime_extensions e left join runtime_extension_inventory_revisions i using (application_id, environment)
       where e.application_id=$1 and e.environment=$2 and e.delivery_class=$3 and e.extension_id=$4`,
      [applicationId, environment, extension.deliveryClass, extension.id]
    );
    const row = result.rows[0];
    if (!row) return Object.freeze({ revision: 0, inventoryRevision: 0 });
    return Object.freeze({ revision: row.revision, inventoryRevision: row.inventory_revision, ...(row.active_generation_id ? { generationId: row.active_generation_id } : {}) });
  }

  async acquireGenerationLease(input: Parameters<RuntimeExtensionStore["acquireGenerationLease"]>[0]): Promise<string> {
    if (!validRecordId(input.generationId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(input.holder) ||
      !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > 300_000) throw new TypeError("Generation drain lease request is invalid.");
    return this.transaction(async (session) => {
      const active = await session.query<{ active_generation_id: string | null }>(
        `select active_generation_id from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 for share`,
        [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id]
      );
      if (active.rows[0]?.active_generation_id !== input.generationId) fail("GENERATION_MISMATCH", "Only the active generation may receive a new in-flight lease.");
      const leaseId = `lease-${randomUUID()}`;
      await session.query(
        `insert into runtime_extension_generation_leases (lease_id, application_id, environment, delivery_class, extension_id, generation_id, holder, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [leaseId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId, input.holder,
          new Date(this.clock.now().valueOf() + input.ttlMs).toISOString()]
      );
      return leaseId;
    });
  }

  async releaseGenerationLease(leaseId: string): Promise<void> {
    if (!/^lease-[0-9a-f-]{36}$/u.test(leaseId)) throw new TypeError("Generation drain lease identity is invalid.");
    await this.pool.query(`delete from runtime_extension_generation_leases where lease_id=$1`, [leaseId]);
  }

  async hasLiveGenerationLease(input: Parameters<RuntimeExtensionStore["hasLiveGenerationLease"]>[0]): Promise<boolean> {
    if (!validRecordId(input.generationId) || !/^lease-[0-9a-f-]{36}$/u.test(input.leaseId)) throw new TypeError("Generation drain lease identity is invalid.");
    const result = await this.pool.query<{ lease_id: string }>(
      `select lease_id from runtime_extension_generation_leases
       where lease_id=$1 and application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6 and expires_at>$7`,
      [input.leaseId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId, timestamp(this.clock)]
    );
    return result.rows.length === 1;
  }

  async liveGenerationLeaseCount(applicationId: string, environment: string, extension: Parameters<RuntimeExtensionStore["liveGenerationLeaseCount"]>[2], generationId: string): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `select count(*)::int count from runtime_extension_generation_leases
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5 and expires_at>$6`,
      [applicationId, environment, extension.deliveryClass, extension.id, generationId, timestamp(this.clock)]
    );
    return result.rows[0]?.count ?? 0;
  }

  async inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory> {
    const result = await this.pool.query<ExtensionRow>(
      `select runtime_extensions.*,
         coalesce((select revision from runtime_extension_inventory_revisions where application_id=$1 and environment=$2), 0)::int as inventory_revision
       from runtime_extensions where application_id=$1 and environment=$2 order by delivery_class, extension_id`,
      [applicationId, environment]
    );
    const extensions = { platformPlugins: {}, hotApplications: {}, themeSkins: {} } as Record<string, Record<string, unknown>>;
    for (const row of result.rows) {
      if (row.revision === 0) continue;
      const entry: Record<string, unknown> = {
        disposition: row.disposition,
        revision: row.revision,
        lastOperationId: row.last_operation_id ?? "operation-uninitialized",
        lastReceiptId: row.last_receipt_id ?? "receipt-uninitialized",
        stateDigest: row.state_digest ?? await sha256({ disposition: row.disposition, revision: row.revision })
      };
      if (row.disposition === "active" && row.active_generation) {
        entry.activeGeneration = row.active_generation;
        if (row.rollback_generation) entry.rollbackGeneration = row.rollback_generation;
      } else if (row.disposition !== "removed" && row.retained_generation) entry.retainedGeneration = row.retained_generation;
      const group = row.delivery_class === "platform-plugin" ? "platformPlugins" : row.delivery_class === "hot-application" ? "hotApplications" : "themeSkins";
      extensions[group]![row.extension_id] = entry;
    }
    const revision = result.rows[0]?.inventory_revision ?? 0;
    const inventory = { schemaVersion: 1 as const, applicationId, environment, hostInventoryDigest: this.hostInventoryDigest, revision, extensions };
    return RuntimeExtensionInventorySchema.parse({ ...inventory, observedAt: timestamp(this.clock), stateDigest: await sha256(inventory) });
  }

  private assertSecurityDecisionMatchesActive(
    input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0],
    active: Record<string, unknown>
  ): void {
    const release = input.decision.release;
    if (active["generationId"] !== input.generationId || active["version"] !== release.version || active["sourceCommit"] !== release.sourceCommit ||
      active["artifactDigest"] !== release.artifactDigest || active["manifestDigest"] !== release.manifestDigest ||
      active["provenanceDigest"] !== release.provenanceDigest || active["sbomDigest"] !== release.sbomDigest ||
      active["deliveryClass"] !== release.deliveryClass || active["extensionId"] !== release.id) {
      fail("GENERATION_MISMATCH", "Current security decision does not bind the exact active immutable release.");
    }
  }

  private async runnerQuarantineTransitionIds(input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0]) {
    const quarantineDigest = await sha256(input);
    const suffix = quarantineDigest.slice("sha256:".length, "sha256:".length + 32);
    return Object.freeze({
      quarantineDigest,
      quarantineTransitionId: `runner-quarantine-${suffix}`,
      receiptId: `runner-receipt-${suffix}`,
      auditId: `runner-audit-${suffix}`,
      eventId: `runner-event-${suffix}`
    });
  }

  private async writeRunnerQuarantineEvidence(
    session: RuntimeExtensionSession,
    row: OperationRow,
    input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0],
    ids: Readonly<{ quarantineDigest: string; quarantineTransitionId: string; receiptId: string; auditId: string; eventId: string }>,
    receipt: ExtensionRunnerQuarantineReceipt
  ): Promise<ExtensionLifecycleEvent> {
    const event = ExtensionLifecycleEventSchema.parse({
      schemaVersion: 1,
      applicationId: input.applicationId,
      environment: input.environment,
      eventId: ids.eventId,
      eventType: "extension.lifecycle-transition",
      operationId: row.operation_id,
      operation: row.operation_kind,
      operationPhase: "failed",
      lifecycleState: "quarantined",
      expectedRevision: input.expectedRevision,
      revision: receipt.revisionAfter,
      inventoryRevision: receipt.inventoryRevision,
      actor: row.authorization_json.actor,
      receiptId: ids.receiptId,
      auditId: ids.auditId,
      idempotencyKey: row.request_json.idempotencyKey,
      correlationId: row.request_json.correlationId,
      occurredAt: receipt.occurredAt,
      deliveryClass: "hot-application",
      id: input.appId,
      evidence: transitionEvidence(row, row.authority_json ?? undefined)
    });
    const eventJson = JSON.stringify(event);
    await session.query(
      `insert into runtime_extension_runner_quarantine_receipts
       (receipt_id, quarantine_transition_id, application_id, environment, delivery_class, extension_id, generation_id, expected_revision, revision, inventory_revision, reason, quarantine_digest, receipt_json, event_json)
       values ($1,$2,$3,$4,'hot-application',$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [ids.receiptId, ids.quarantineTransitionId, input.applicationId, input.environment, input.appId, input.generationId,
        input.expectedRevision, receipt.revisionAfter, receipt.inventoryRevision, input.reason, ids.quarantineDigest, JSON.stringify(receipt), eventJson]
    );
    await session.query(
      `insert into runtime_extension_audit (audit_id, operation_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,'hot-application',$5,$6,$7,$8::jsonb)`,
      [ids.auditId, row.operation_id, input.applicationId, input.environment, input.appId, receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_outbox (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [ids.eventId, input.applicationId, input.environment, "hot-application", input.appId, receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `update runtime_extensions set last_receipt_id=$4, state_digest=$5 where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3`,
      [input.applicationId, input.environment, input.appId, ids.receiptId, await sha256({ event, reason: input.reason })]
    );
    return event;
  }

  private async writeSecurityQuarantineEvidence(
    session: RuntimeExtensionSession,
    input: Parameters<RuntimeExtensionStore["quarantineActiveGeneration"]>[0],
    ids: Readonly<{ decisionDigest: string; securityTransitionId: string; receiptId: string; auditId: string; eventId: string }>,
    receipt: ExtensionSecurityQuarantineReceipt
  ): Promise<ExtensionSecurityQuarantineEvent> {
    const event = ExtensionSecurityQuarantineEventSchema.parse({
      schemaVersion: 1,
      eventId: ids.eventId,
      eventType: "extension.security-quarantine",
      securityTransitionId: ids.securityTransitionId,
      receiptId: ids.receiptId,
      auditId: ids.auditId,
      applicationId: input.applicationId,
      environment: input.environment,
      deliveryClass: input.extension.deliveryClass,
      id: input.extension.id,
      expectedRevision: input.expectedRevision,
      revision: receipt.revisionAfter,
      inventoryRevision: receipt.inventoryRevision,
      occurredAt: receipt.occurredAt,
      evidence: {
        catalogDigest: input.decision.catalogDigest,
        catalogSignerIdentity: input.decision.catalogSignerIdentity,
        catalogSequence: input.decision.catalogSequence,
        disposition: input.decision.disposition,
        version: input.decision.release.version,
        sourceCommit: input.decision.release.sourceCommit,
        artifactDigest: input.decision.release.artifactDigest,
        manifestDigest: input.decision.release.manifestDigest,
        provenanceDigest: input.decision.release.provenanceDigest,
        sbomDigest: input.decision.release.sbomDigest,
        generationId: input.generationId
      }
    });
    const eventJson = JSON.stringify(event);
    const receiptJson = JSON.stringify(receipt);
    await session.query(
      `insert into runtime_extension_security_receipts
       (receipt_id, security_transition_id, application_id, environment, delivery_class, extension_id, generation_id, expected_revision, revision, inventory_revision, decision_digest, receipt_json, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [ids.receiptId, ids.securityTransitionId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, input.generationId,
        input.expectedRevision, receipt.revisionAfter, receipt.inventoryRevision, ids.decisionDigest, receiptJson, eventJson]
    );
    await session.query(
      `insert into runtime_extension_security_audit
       (audit_id, receipt_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [ids.auditId, ids.receiptId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id,
        receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_outbox
       (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [ids.eventId, input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id,
        receipt.revisionAfter, receipt.inventoryRevision, eventJson]
    );
    await session.query(
      `update runtime_extensions set last_receipt_id=$5, state_digest=$6 where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
      [input.applicationId, input.environment, input.extension.deliveryClass, input.extension.id, ids.receiptId, await sha256(event)]
    );
    return event;
  }

  private async projectAuthorizationLifecycle(
    session: RuntimeExtensionSession,
    transition: ExtensionLifecycleEvent | ExtensionSecurityQuarantineEvent,
    runtimeGenerationIds: readonly [string],
    updateCompatibility?: "compatible" | "incompatible",
    priorGenerationEvidence?: unknown
  ): Promise<void> {
    if (transition.deliveryClass === "theme-skin") return;
    if (!this.authorizationLifecycleProjector) {
      fail("STATE_INVALID", "Platform Plugin and Hot Application terminal transitions require an authorization lifecycle projector.");
    }
    await this.authorizationLifecycleProjector.project({
      session,
      transition,
      runtimeGenerationIds,
      ...(updateCompatibility === undefined ? {} : { updateCompatibility }),
      ...(priorGenerationEvidence === undefined ? {} : { priorGenerationEvidence })
    });
  }

  private updateAuthorizationCompatibility(
    compatibility: StagedGenerationActivation["compatibility"],
    rollbackAvailable: boolean
  ): "compatible" | "incompatible" {
    return rollbackAvailable && compatibility.status === "compatible" && Date.parse(compatibility.closesAt) > this.clock.now().valueOf()
      ? "compatible"
      : "incompatible";
  }

  private updateAuthorizationCompatibilityFromStaticReceipt(receipt: StaticDeploymentReceipt): "compatible" | "incompatible" {
    return receipt.operation === "promote" && receipt.rollbackWindow.state === "open" && Date.parse(receipt.rollbackWindow.closesAt) > this.clock.now().valueOf()
      ? "compatible"
      : "incompatible";
  }

  private async transaction<T>(work: (session: RuntimeExtensionSession) => Promise<T>): Promise<T> {
    const session = await this.pool.connect();
    try {
      await session.query("begin");
      const result = await work(session);
      await session.query("commit");
      return result;
    } catch (error) {
      try { await session.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      session.release();
    }
  }

  private async lockOperation(session: RuntimeExtensionSession, id: string, token: string): Promise<OperationRow> {
    const result = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
    const row = result.rows[0];
    if (!row) fail("OPERATION_NOT_FOUND", "Runtime extension operation is unavailable.");
    if (row.lease_token !== token || new Date(row.lease_expires_at).valueOf() <= this.clock.now().valueOf()) fail("LEASE_CONFLICT", "Runtime extension operation lease is stale.");
    return row;
  }

  private async completedReceipt(
    session: RuntimeExtensionSession,
    id: string,
    expectedOperations: readonly RuntimeExtensionOperation["request"]["operation"][]
  ): Promise<ExtensionManagerReceipt | undefined> {
    const result = await session.query<OperationRow>(`select * from runtime_extension_operations where operation_id=$1 for update`, [id]);
    const row = result.rows[0];
    if (!row || row.phase !== "completed") return undefined;
    if (!row.result_json || !expectedOperations.includes(row.operation_kind) || row.result_json.operation !== row.operation_kind) {
      fail("STATE_INVALID", "Completed runtime extension operation has no matching persisted receipt.");
    }
    return row.result_json;
  }

  private async advanceInventoryRevision(session: RuntimeExtensionSession, applicationId: string, environment: string): Promise<number> {
    const result = await session.query<{ revision: number }>(
      `update runtime_extension_inventory_revisions set revision=revision+1 where application_id=$1 and environment=$2 returning revision`,
      [applicationId, environment]
    );
    const revision = result.rows[0]?.revision;
    if (!revision) fail("STATE_INVALID", "Runtime extension inventory revision update failed.");
    return revision;
  }

  private bundleGenerationEvidence(generation: GenerationRow, receiptId: string) {
    return {
      authority: "verified-bundle" as const,
      applicationId: generation.authority_json.applicationId,
      environment: generation.authority_json.environment,
      deliveryClass: generation.authority_json.deliveryClass,
      extensionId: generation.authority_json.extensionId,
      generationId: generation.generation_id,
      version: generation.version,
      sourceCommit: generation.authority_json.sourceCommit,
      artifactDigest: generation.authority_json.artifactDigest,
      manifestDigest: generation.authority_json.manifestDigest,
      catalogDigest: generation.authority_json.catalogDigest,
      provenanceDigest: generation.authority_json.provenanceDigest,
      sbomDigest: generation.authority_json.sbomDigest,
      receiptId
    };
  }

  private staticGenerationEvidence(plan: Extract<PluginManagerPlan, { executionClass: "static-release" }>, receipt: StaticDeploymentReceipt) {
    return {
      authority: "static-build" as const,
      generationId: receipt.activeGenerationId,
      version: plan.plan.version,
      sourceCommit: receipt.sourceCommit,
      compositionChangePlanDigest: receipt.compositionChangePlanDigest,
      buildEvidenceDigest: receipt.buildEvidenceDigest,
      applicationDigest: receipt.applicationDigest,
      imageDigest: receipt.imageDigest,
      migrationRevision: receipt.migrationRevision,
      workerFencingToken: receipt.workerFencingToken,
      receiptId: receipt.receiptId
    };
  }

  private async completeOperation(session: RuntimeExtensionSession, row: OperationRow, receipt: ExtensionManagerReceipt): Promise<void> {
    const completed = await session.query(
      `update runtime_extension_operations set phase='completed', result_json=$3::jsonb, updated_at=now() where operation_id=$1 and lease_token=$2 returning operation_id`,
      [row.operation_id, row.lease_token, JSON.stringify(receipt)]
    );
    if (completed.rowCount !== 1) fail("LEASE_CONFLICT", "Runtime extension completion lease changed.");
    await session.query(
      `update runtime_extension_operation_budget set active_count=greatest(active_count-1,0) where application_id=$1 and environment=$2`,
      [row.application_id, row.environment]
    );
  }

  private async appendTransition(session: RuntimeExtensionSession, row: OperationRow, phase: ExtensionOperationPhase, authority: VerifiedGenerationAuthority | undefined, retainedGeneration?: Record<string, unknown>): Promise<ExtensionLifecycleEvent> {
    const identity = identityKey(row);
    await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
    const state = await session.query<{ revision: number }>(
      `update runtime_extensions set revision=revision+1, last_operation_id=$5, updated_at=now()
       where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 returning revision`,
      [row.application_id, row.environment, row.delivery_class, row.extension_id, row.operation_id]
    );
    const revision = state.rows[0]?.revision;
    if (!revision) fail("STATE_INVALID", "Runtime extension revision update failed.");
    const inventoryRevision = await this.advanceInventoryRevision(session, row.application_id, row.environment);
    return this.writeTransitionEvidence(session, row, phase, authority, revision, inventoryRevision, undefined, undefined, retainedGeneration);
  }

  private async writeTransitionEvidence(
    session: RuntimeExtensionSession,
    row: OperationRow,
    phase: ExtensionOperationPhase,
    authority: VerifiedGenerationAuthority | undefined,
    revision: number,
    inventoryRevision: number,
    lifecycle?: ExtensionLifecycleEvent["lifecycleState"],
    staticReceipt?: StaticDeploymentReceipt,
    retainedGeneration?: Record<string, unknown>
  ): Promise<ExtensionLifecycleEvent> {
    const ids = evidenceIds(row, revision);
    const receiptId = staticReceipt?.receiptId ?? ids.receiptId;
    const { auditId, eventId } = ids;
    const event = ExtensionLifecycleEventSchema.parse({
      schemaVersion: 1,
      applicationId: row.application_id,
      environment: row.environment,
      eventId,
      eventType: "extension.lifecycle-transition",
      operationId: row.operation_id,
      operation: row.operation_kind,
      operationPhase: phase,
      lifecycleState: lifecycle ?? lifecycleState(phase),
      expectedRevision: revision - 1,
      revision,
      inventoryRevision,
      actor: row.authorization_json.actor,
      receiptId,
      auditId,
      idempotencyKey: row.request_json.idempotencyKey,
      correlationId: row.request_json.correlationId,
      occurredAt: timestamp(this.clock),
      deliveryClass: row.delivery_class,
      id: row.extension_id,
      evidence: transitionEvidence(row, authority ?? row.authority_json ?? undefined, staticReceipt, retainedGeneration)
    });
    const eventJson = JSON.stringify(event);
    await session.query(
      `insert into runtime_extension_transition_receipts (receipt_id, operation_id, revision, event_json) values ($1,$2,$3,$4::jsonb)`,
      [receiptId, row.operation_id, revision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_audit (audit_id, operation_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [auditId, row.operation_id, row.application_id, row.environment, row.delivery_class, row.extension_id, revision, inventoryRevision, eventJson]
    );
    await session.query(
      `insert into runtime_extension_outbox (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [eventId, row.application_id, row.environment, row.delivery_class, row.extension_id, revision, inventoryRevision, eventJson]
    );
    await session.query(
      `update runtime_extensions set last_receipt_id=$5, state_digest=$6 where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4`,
      [row.application_id, row.environment, row.delivery_class, row.extension_id, receiptId, await sha256(event)]
    );
    return event;
  }
}
