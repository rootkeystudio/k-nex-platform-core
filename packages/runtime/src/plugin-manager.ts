import {
  canonicalJson,
  compareExactSemverPrecedence,
  ExactSemverSchema,
  ExtensionIdentitySchema,
  ExtensionInstallPlanSchema,
  type ExtensionIdentity,
  type ExtensionInstallPlan,
  type ExtensionLifecycleEvent,
  type ExtensionOperationPhase,
  type ExtensionOperationActor,
  type ActiveGenerationSecurityDisposition,
  type StaticDeploymentReceipt,
  type StaticCompositionChangePlan,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";

export type ExtensionManagerOperation = "install" | "update" | "disable" | "rollback" | "uninstall";
/** Internal authorization-only operation: a disabled install re-enables its retained lifecycle. */
type ExtensionAuthorizationOperation = ExtensionManagerOperation | "enable";
export type { ExtensionOperationPhase } from "@k-nex/contracts";

export interface ExtensionChangeRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: ExtensionIdentity;
  readonly operation: ExtensionManagerOperation;
  readonly targetVersion: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/** The planner receives the immutable operation and the inventory generation it must bind. */
export interface ExtensionPlanningRequest extends ExtensionChangeRequest {
  readonly operationId: string;
  readonly currentGenerationId?: string;
  readonly rollbackGenerationId?: string;
}

export interface OperationAuthorizationRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: ExtensionIdentity;
  readonly operation: ExtensionAuthorizationOperation;
  readonly requestDigest: string;
  readonly expectedRevision: number;
}

export interface OperationAuthorizationDecision {
  readonly actor: ExtensionOperationActor;
  readonly decisionId: string;
}

export interface ExtensionOperationAuthorizer {
  authorize(request: OperationAuthorizationRequest): Promise<OperationAuthorizationDecision>;
}

export class TrustedAutomationOperationAuthorizer implements ExtensionOperationAuthorizer {
  constructor(private readonly identity: string) {
    if (identity.length < 1 || identity.length > 512) throw new TypeError("Trusted automation identity is invalid.");
  }

  async authorize(request: OperationAuthorizationRequest): Promise<OperationAuthorizationDecision> {
    return Object.freeze({
      actor: Object.freeze({ kind: "trusted-automation", identity: this.identity }),
      decisionId: await digest({ authority: this.identity, request })
    });
  }
}

export interface ExtensionPlanner {
  validate(request: ExtensionChangeRequest): Promise<void>;
  plan(request: ExtensionPlanningRequest): Promise<Readonly<{ plan: ExtensionInstallPlan; sourceCommit: string; generationId: string }>>;
}

export interface StaticCompositionChangeResult {
  readonly planDigest: string;
  readonly targetSourceCommit: string;
  readonly status: "source-change-ready";
  readonly change: StaticCompositionChangePlan;
}

export interface StaticCompositionChangeRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly expectedSourceCommit: string;
  readonly generationId: string;
  readonly plan: Extract<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>;
}

export interface StaticCompositionChangeAuthority {
  request(request: StaticCompositionChangeRequest, authorization: OperationAuthorizationDecision): Promise<StaticCompositionChangeResult>;
}

export interface TrustedDeploymentRequest {
  readonly buildRequestDigest: string;
  readonly sourceCommit: string;
  readonly status: "build-requested";
}

export interface TrustedBuildDeploymentClient {
  request(change: StaticCompositionChangeResult, authorization: OperationAuthorizationDecision): Promise<TrustedDeploymentRequest>;
  reverify(authority: StaticGenerationAuthority): Promise<boolean>;
}

export interface StaticGenerationAuthority {
  readonly generationId: string;
  readonly version: string;
  readonly sourceCommit: string;
  readonly compositionChangePlanDigest: string;
  readonly buildEvidenceDigest: string;
  readonly applicationDigest: string;
  readonly imageDigest: string;
  readonly migrationRevision: number;
  readonly workerFencingToken: number;
  readonly receiptId: string;
}

export interface VerifiedGenerationAuthority {
  readonly applicationId: string;
  readonly environment: string;
  readonly deliveryClass: "hot-application" | "theme-skin";
  readonly extensionId: string;
  readonly generationId: string;
  readonly sourceCommit: string;
  readonly artifactDigest: string;
  readonly manifestDigest: string;
  readonly catalogDigest: string;
  readonly provenanceDigest: string;
  readonly sbomDigest: string;
}

export type ExtensionActivationJson = null | boolean | number | string | readonly ExtensionActivationJson[] | Readonly<{ [key: string]: ExtensionActivationJson }>;

export type ExtensionRollbackCompatibility =
  | Readonly<{ status: "compatible"; windowId: string; closesAt: string; migrationDigest: string; dataRevision: number }>
  | Readonly<{ status: "irreversible"; decisionId: string; reason: string; migrationDigest: string; dataRevision: number }>;

export interface GenerationReadinessLease {
  readonly generationId: string;
  readonly leaseToken: string;
  readonly readyAt: string;
  readonly expiresAt: string;
  readonly serverGenerationId: string;
  readonly uiGenerationId: string;
  readonly storageGenerationId: string;
}

export interface StagedGenerationActivation {
  readonly authority: VerifiedGenerationAuthority;
  readonly version: string;
  readonly readiness: GenerationReadinessLease;
  readonly compatibility: ExtensionRollbackCompatibility;
  readonly metadata: Readonly<Record<string, ExtensionActivationJson>>;
  readonly settings: Readonly<Record<string, ExtensionActivationJson>>;
  readonly storageSchemaVersions: Readonly<Record<string, number>>;
}

export interface ExtensionActivationReceipt {
  readonly receiptId: string;
  readonly operationId: string;
  readonly operation: "install" | "update" | "rollback";
  readonly generationId: string;
  readonly previousGenerationId?: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly inventoryRevision: number;
  readonly compatibility: ExtensionRollbackCompatibility;
  readonly rollback: "available" | "unavailable" | "blocked-irreversible";
  readonly occurredAt: string;
}

export interface ExtensionDispositionReceipt {
  readonly receiptId: string;
  readonly operationId: string;
  readonly operation: "disable" | "uninstall";
  readonly disposition: "disabled" | "removed";
  readonly previousGenerationId?: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly inventoryRevision: number;
  readonly occurredAt: string;
}

export interface ActiveGenerationSecurityDecision {
  readonly catalogDigest: string;
  readonly catalogSignerIdentity: string;
  readonly catalogSequence: number;
  readonly disposition: ActiveGenerationSecurityDisposition;
  readonly release: Readonly<{
    deliveryClass: "hot-application" | "theme-skin";
    id: string;
    version: string;
    sourceCommit: string;
    artifactDigest: string;
    manifestDigest: string;
    provenanceDigest: string;
    sbomDigest: string;
  }>;
}

export interface ExtensionSecurityQuarantineReceipt {
  readonly receiptId: string;
  readonly securityTransitionId: string;
  readonly disposition: "quarantined";
  readonly reason: ActiveGenerationSecurityDecision["disposition"];
  readonly generationId: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly inventoryRevision: number;
  readonly catalogDigest: string;
  readonly occurredAt: string;
}

export type RunnerQuarantineReason = "INVOCATION_TIMEOUT" | "OUTPUT_BUDGET_EXCEEDED" | "PROTOCOL_VIOLATION" | "CONTAINER_FAILED" | "POLICY_VIOLATION";

/** Durable system quarantine for a terminal per-generation runner failure. */
export interface ExtensionRunnerQuarantineReceipt {
  readonly receiptId: string;
  readonly quarantineTransitionId: string;
  readonly disposition: "quarantined";
  readonly reason: RunnerQuarantineReason;
  readonly generationId: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly inventoryRevision: number;
  readonly occurredAt: string;
}

export type ExtensionManagerReceipt = ExtensionActivationReceipt | ExtensionDispositionReceipt | StaticDeploymentReceipt;

export interface ExtensionValidationReport {
  readonly operationId: string;
  readonly executionClass: PluginManagerPlan["executionClass"];
  readonly phase: ExtensionOperationPhase;
  readonly valid: boolean;
  readonly checks: readonly string[];
}

export interface ExtensionOperationStatus {
  readonly operationId: string;
  readonly request: ExtensionChangeRequest;
  readonly requestDigest: string;
  readonly actor: ExtensionOperationActor;
  readonly phase: ExtensionOperationPhase;
  readonly plan?: PluginManagerPlan;
  readonly result?: ExtensionManagerReceipt;
}

export interface ActiveGenerationObservation {
  readonly revision: number;
  readonly inventoryRevision: number;
  readonly generationId?: string;
}

export interface DynamicGenerationRuntime {
  prepare(input: Readonly<{ request: ExtensionChangeRequest; plan: DynamicPluginManagerPlan; authority: VerifiedGenerationAuthority }>): Promise<StagedGenerationActivation>;
}

export interface DynamicArtifactPipeline {
  stage(input: Readonly<{ plan: Exclude<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>; owner: VerifiedGenerationAuthorityOwner }>): Promise<VerifiedGenerationAuthority>;
  reverify(authority: VerifiedGenerationAuthority, owner: VerifiedGenerationAuthorityOwner): Promise<boolean>;
}

export interface VerifiedGenerationAuthorityOwner {
  readonly applicationId: string;
  readonly environment: string;
  readonly deliveryClass: "hot-application" | "theme-skin";
  readonly extensionId: string;
}

export type DynamicPluginManagerPlan = Readonly<{
  executionClass: "live-generation";
  operationId: string;
  plan: Exclude<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>;
  sourceCommit: string;
  generationId: string;
}>;

export type PluginManagerPlan =
  | DynamicPluginManagerPlan
  | Readonly<{ executionClass: "live-generation"; operationId: string; plan: Extract<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }> & { operation: "disable" }; sourceCommit: string; generationId: string }>
  | Readonly<{ executionClass: "static-release"; operationId: string; plan: Extract<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>; generationId: string; sourceChange: StaticCompositionChangeResult; deployment: TrustedDeploymentRequest; quarantineRecovery: boolean }>;

export interface RuntimeExtensionOperation {
  readonly operationId: string;
  readonly request: ExtensionChangeRequest;
  readonly requestDigest: string;
  readonly authorization: OperationAuthorizationDecision;
  readonly phase: ExtensionOperationPhase;
  readonly leaseToken: string;
  readonly plan?: PluginManagerPlan;
  readonly authority?: VerifiedGenerationAuthority;
  readonly result?: ExtensionManagerReceipt;
}

export type ClaimOperationResult =
  | Readonly<{ status: "claimed"; operation: RuntimeExtensionOperation }>
  | Readonly<{ status: "replay"; operation: RuntimeExtensionOperation }>;

export interface RuntimeExtensionStore {
  reconcileExpiredOperations(input: Readonly<{ applicationId: string; environment: string }>): Promise<number>;
  claimOperation(input: Readonly<{ request: ExtensionChangeRequest; requestDigest: string; authorization: OperationAuthorizationDecision; workerId: string }>): Promise<ClaimOperationResult>;
  resumeOperation(operationId: string, workerId: string): Promise<RuntimeExtensionOperation>;
  savePlan(operationId: string, leaseToken: string, plan: PluginManagerPlan): Promise<RuntimeExtensionOperation>;
  transition(input: Readonly<{ operationId: string; leaseToken: string; expectedPhase: ExtensionOperationPhase; phase: ExtensionOperationPhase; authority?: VerifiedGenerationAuthority }>): Promise<Readonly<{ operation: RuntimeExtensionOperation; event: ExtensionLifecycleEvent }>>;
  readOperation(operationId: string): Promise<RuntimeExtensionOperation | undefined>;
  inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory>;
  stageGeneration(input: Readonly<{ operationId: string; leaseToken: string; stage: StagedGenerationActivation }>): Promise<Readonly<{ operation: RuntimeExtensionOperation; event: ExtensionLifecycleEvent }>>;
  refreshGenerationReadiness(input: Readonly<{ operationId: string; leaseToken: string; stage: StagedGenerationActivation }>): Promise<RuntimeExtensionOperation>;
  activateGeneration(operationId: string, leaseToken: string): Promise<ExtensionActivationReceipt>;
  rollbackGeneration(operationId: string, leaseToken: string, stage: StagedGenerationActivation): Promise<ExtensionActivationReceipt>;
  completeStaticRelease(operationId: string, leaseToken: string, receipt: StaticDeploymentReceipt): Promise<StaticDeploymentReceipt>;
  disableGeneration(operationId: string, leaseToken: string): Promise<ExtensionDispositionReceipt>;
  uninstallGeneration(operationId: string, leaseToken: string): Promise<ExtensionDispositionReceipt>;
  quarantineActiveGeneration(input: Readonly<{
    applicationId: string;
    environment: string;
    extension: Extract<ExtensionIdentity, { deliveryClass: "hot-application" | "theme-skin" }>;
    expectedRevision: number;
    generationId: string;
    decision: ActiveGenerationSecurityDecision;
  }>): Promise<ExtensionSecurityQuarantineReceipt>;
  readSecurityQuarantineReceipt(input: Readonly<{
    applicationId: string;
    environment: string;
    extension: Extract<ExtensionIdentity, { deliveryClass: "hot-application" | "theme-skin" }>;
    generationId: string;
  }>): Promise<ExtensionSecurityQuarantineReceipt | undefined>;
  quarantineRunnerGeneration(input: Readonly<{
    applicationId: string;
    environment: string;
    appId: string;
    generationId: string;
    expectedRevision: number;
    reason: RunnerQuarantineReason;
  }>): Promise<ExtensionRunnerQuarantineReceipt>;
  observeActiveGeneration(applicationId: string, environment: string, extension: ExtensionIdentity): Promise<ActiveGenerationObservation>;
  acquireGenerationLease(input: Readonly<{ applicationId: string; environment: string; extension: ExtensionIdentity; generationId: string; holder: string; ttlMs: number }>): Promise<string>;
  releaseGenerationLease(leaseId: string): Promise<void>;
  hasLiveGenerationLease(input: Readonly<{ applicationId: string; environment: string; extension: ExtensionIdentity; generationId: string; leaseId: string }>): Promise<boolean>;
  liveGenerationLeaseCount(applicationId: string, environment: string, extension: ExtensionIdentity, generationId: string): Promise<number>;
}

export class PluginManagerError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PLAN_MISMATCH" | "OPERATION_NOT_FOUND" | "WRONG_EXECUTION_CLASS" | "INVALID_STATE" | "ARTIFACT_AUTHORITY_REJECTED", message: string) {
    super(message);
    this.name = "PluginManagerError";
  }
}

function validRequest(request: ExtensionChangeRequest): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(request.applicationId) && /^[a-z][a-z0-9-]{1,63}$/u.test(request.environment) &&
    ExtensionIdentitySchema.safeParse(request.extension).success && ExactSemverSchema.safeParse(request.targetVersion).success &&
    Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(request.idempotencyKey) && /^[a-z][a-z0-9-]{2,127}$/u.test(request.correlationId);
}

async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Canonical digest of the immutable request persisted with every extension operation. */
export async function extensionOperationRequestDigest(request: ExtensionChangeRequest): Promise<string> {
  if (!validRequest(request)) throw new TypeError("Extension operation request is invalid.");
  return digest(request);
}

export function extensionOperationActorMatches(left: ExtensionOperationActor, right: ExtensionOperationActor): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export interface ExtensionInventoryState {
  readonly revision: number;
  readonly disposition: "fresh" | "active" | "disabled" | "quarantined" | "retirement-pending" | "removed";
  readonly currentGenerationId?: string;
  readonly rollbackGenerationId?: string;
  readonly currentVersion?: string;
}

/** Exact current lifecycle authority shared by planning and administration projection. */
export function extensionInventoryState(inventory: RuntimeExtensionInventory, extension: ExtensionIdentity): ExtensionInventoryState {
  const entries = extension.deliveryClass === "platform-plugin" ? inventory.extensions.platformPlugins
    : extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
  const entry = entries[extension.id];
  if (!entry) return Object.freeze({ revision: 0, disposition: "fresh" });
  if (entry.disposition === "removed") return Object.freeze({ revision: entry.revision, disposition: "removed" });
  if (entry.disposition !== "active") return Object.freeze({
    revision: entry.revision,
    disposition: entry.disposition,
    ...(entry.retainedGeneration ? { currentGenerationId: entry.retainedGeneration.generationId, currentVersion: entry.retainedGeneration.version } : {})
  });
  return Object.freeze({
    revision: entry.revision,
    disposition: "active",
    currentGenerationId: entry.activeGeneration.generationId,
    currentVersion: entry.activeGeneration.version,
    ...(entry.rollbackGeneration ? { rollbackGenerationId: entry.rollbackGeneration.generationId } : {})
  });
}

function inventoryGenerationState(inventory: RuntimeExtensionInventory, request: ExtensionChangeRequest): ExtensionInventoryState {
  return extensionInventoryState(inventory, request.extension);
}

type OperationAdmission = Readonly<Partial<Record<ExtensionManagerOperation, ExtensionAuthorizationOperation>>>;

const operationAdmission: Readonly<Record<ExtensionInventoryState["disposition"], OperationAdmission>> = Object.freeze({
  fresh: Object.freeze({ install: "install" }),
  removed: Object.freeze({ install: "install" }),
  active: Object.freeze({ update: "update", disable: "disable", rollback: "rollback", uninstall: "uninstall" }),
  disabled: Object.freeze({ install: "enable", uninstall: "uninstall" }),
  quarantined: Object.freeze({ update: "update", uninstall: "uninstall" }),
  "retirement-pending": Object.freeze({})
});

/** Operations that may enter planning for the exact current inventory disposition. */
export function admittedExtensionOperations(disposition: ExtensionInventoryState["disposition"]): readonly ExtensionManagerOperation[] {
  return Object.freeze(Object.keys(operationAdmission[disposition]) as ExtensionManagerOperation[]);
}

function admittedAuthorizationOperation(request: ExtensionChangeRequest, inventory: ExtensionInventoryState): ExtensionAuthorizationOperation {
  const operation = operationAdmission[inventory.disposition][request.operation];
  if (!operation) throw new PluginManagerError("INVALID_STATE", `Extension ${request.operation} is not allowed while ${inventory.disposition}.`);
  return operation;
}

function assertNoActiveDowngrade(request: ExtensionChangeRequest, inventory: ExtensionInventoryState): void {
  const comparison = inventory.currentVersion === undefined ? undefined : compareExactSemverPrecedence(request.targetVersion, inventory.currentVersion);
  if ((request.operation === "install" && comparison !== undefined && comparison < 0) ||
    (inventory.disposition === "active" && request.operation === "update" && comparison !== undefined && comparison <= 0)) {
    throw new PluginManagerError("PLAN_MISMATCH", "Install and update must target a newer extension version when one is active.");
  }
}

function assertRetainedReleaseReenable(request: ExtensionChangeRequest, inventory: ExtensionInventoryState): void {
  if (inventory.disposition === "disabled" && request.operation === "install" && request.targetVersion !== inventory.currentVersion) {
    throw new PluginManagerError("PLAN_MISMATCH", "Re-enable must target the exact retained extension release.");
  }
}

function assertInventoryCanPlan(request: ExtensionChangeRequest, inventory: ExtensionInventoryState): void {
  assertNoActiveDowngrade(request, inventory);
  if (request.operation === "rollback" && (!inventory.currentGenerationId || !inventory.rollbackGenerationId)) {
    throw new PluginManagerError("PLAN_MISMATCH", "Rollback requires an active generation and a retained generation in current inventory.");
  }
}

function assertPlanMatches(
  request: ExtensionChangeRequest,
  plan: ExtensionInstallPlan,
  operationId: string,
  plannerGenerationId: string,
  inventory: ExtensionInventoryState
): void {
  if (plan.deliveryClass !== request.extension.deliveryClass || plan.id !== request.extension.id || plan.operation !== request.operation ||
    plan.version !== request.targetVersion || plan.expectedRevision !== request.expectedRevision || plan.operationId !== operationId ||
    plan.currentGenerationId !== inventory.currentGenerationId || plan.targetGenerationId !== plannerGenerationId || inventory.revision !== request.expectedRevision) {
    throw new PluginManagerError("PLAN_MISMATCH", "Planner output does not match the authorized extension request.");
  }
  if (!plan.targetGenerationId) throw new PluginManagerError("PLAN_MISMATCH", "Planner output has no target generation identity.");
  const retainedReenable = request.extension.deliveryClass !== "platform-plugin" && inventory.disposition === "disabled" && request.operation === "install";
  if (retainedReenable) {
    if (plan.targetGenerationId !== inventory.currentGenerationId) {
      throw new PluginManagerError("PLAN_MISMATCH", "Re-enable must target the retained generation from current inventory.");
    }
  } else if (["install", "update"].includes(request.operation)) {
    if (plan.targetGenerationId === inventory.currentGenerationId || plan.targetGenerationId === inventory.rollbackGenerationId) {
      throw new PluginManagerError("PLAN_MISMATCH", "Install and update target generations must be fresh.");
    }
    assertInventoryCanPlan(request, inventory);
  } else if (request.operation === "rollback") {
    if (!inventory.currentGenerationId || plan.targetGenerationId !== inventory.rollbackGenerationId) {
      throw new PluginManagerError("PLAN_MISMATCH", "Rollback must target the retained generation from current inventory.");
    }
  } else if (request.extension.deliveryClass === "platform-plugin" && request.operation === "uninstall") {
    if (!inventory.currentGenerationId || plan.targetGenerationId === inventory.currentGenerationId || plan.targetGenerationId === inventory.rollbackGenerationId) {
      throw new PluginManagerError("PLAN_MISMATCH", "Static uninstall must target a fresh application generation.");
    }
  } else if (plan.targetGenerationId !== inventory.currentGenerationId) {
    throw new PluginManagerError("PLAN_MISMATCH", "Disable must remain bound to the active inventory generation.");
  }
}

function authorityOwner(request: ExtensionChangeRequest): VerifiedGenerationAuthorityOwner {
  if (request.extension.deliveryClass === "platform-plugin") {
    throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin delivery does not use live generation authority.");
  }
  return Object.freeze({
    applicationId: request.applicationId,
    environment: request.environment,
    deliveryClass: request.extension.deliveryClass,
    extensionId: request.extension.id
  });
}

function assertAuthorityOwner(authority: VerifiedGenerationAuthority, owner: VerifiedGenerationAuthorityOwner): void {
  if (authority.applicationId !== owner.applicationId || authority.environment !== owner.environment ||
    authority.deliveryClass !== owner.deliveryClass || authority.extensionId !== owner.extensionId) {
    throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Verified generation authority belongs to a different extension owner.");
  }
}

type ActiveDynamicGeneration =
  | Extract<RuntimeExtensionInventory["extensions"]["hotApplications"][string], { disposition: "active" }>["activeGeneration"]
  | Extract<RuntimeExtensionInventory["extensions"]["themeSkins"][string], { disposition: "active" }>["activeGeneration"];

function authorityFromGeneration(generation: ActiveDynamicGeneration): VerifiedGenerationAuthority {
  return Object.freeze({
    applicationId: generation.applicationId,
    environment: generation.environment,
    deliveryClass: generation.deliveryClass,
    extensionId: generation.extensionId,
    generationId: generation.generationId,
    sourceCommit: generation.sourceCommit,
    artifactDigest: generation.artifactDigest,
    manifestDigest: generation.manifestDigest,
    catalogDigest: generation.catalogDigest,
    provenanceDigest: generation.provenanceDigest,
    sbomDigest: generation.sbomDigest
  });
}

function assertFreshRollbackReadiness(stage: StagedGenerationActivation, authority: VerifiedGenerationAuthority, version: string, now: Date): void {
  if (canonicalJson(stage.authority) !== canonicalJson(authority) || stage.version !== version ||
    stage.readiness.generationId !== authority.generationId || stage.readiness.serverGenerationId !== authority.generationId ||
    stage.readiness.uiGenerationId !== authority.generationId || stage.readiness.storageGenerationId !== authority.generationId ||
    !(now instanceof Date) || Number.isNaN(now.valueOf()) ||
    !Number.isFinite(Date.parse(stage.readiness.readyAt)) || !Number.isFinite(Date.parse(stage.readiness.expiresAt)) ||
    Date.parse(stage.readiness.expiresAt) <= now.valueOf()) {
    throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Retained generation readiness is not fresh and generation-bound.");
  }
}

function isStaticDeploymentReceipt(receipt: ExtensionManagerReceipt): receipt is StaticDeploymentReceipt {
  return "activeGenerationId" in receipt && "compositionChangePlanDigest" in receipt && "buildEvidenceDigest" in receipt;
}

function assertStaticReceipt(operation: RuntimeExtensionOperation, receipt: StaticDeploymentReceipt): void {
  const plan = operation.plan;
  if (!plan || plan.executionClass !== "static-release" || receipt.applicationId !== operation.request.applicationId || receipt.environment !== operation.request.environment ||
    receipt.activeGenerationId !== plan.generationId || receipt.sourceCommit !== plan.sourceChange.targetSourceCommit ||
    receipt.compositionChangePlanDigest !== plan.sourceChange.planDigest || receipt.operation !== (operation.request.operation === "rollback" ? "rollback" : "promote") ||
    (operation.request.operation === "uninstall" &&
      (receipt.previousGenerationId !== plan.plan.currentGenerationId || receipt.activeGenerationId === receipt.previousGenerationId))) {
    throw new PluginManagerError("PLAN_MISMATCH", "Static deployment receipt does not bind the authorized operation plan.");
  }
}

function dynamicPlan(plan: PluginManagerPlan): DynamicPluginManagerPlan {
  if (plan.executionClass !== "live-generation" || plan.plan.deliveryClass === "platform-plugin") {
    throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin delivery does not use dynamic generation authority.");
  }
  return plan as DynamicPluginManagerPlan;
}

export class PluginManager {
  constructor(
    private readonly workerId: string,
    private readonly authorizer: ExtensionOperationAuthorizer,
    private readonly planner: ExtensionPlanner,
    private readonly store: RuntimeExtensionStore,
    private readonly artifacts: DynamicArtifactPipeline,
    private readonly staticChanges: StaticCompositionChangeAuthority,
    private readonly deployments: TrustedBuildDeploymentClient,
    private readonly generationRuntime: DynamicGenerationRuntime | undefined,
    private readonly clock: Readonly<{ now(): Date }>
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(workerId)) throw new TypeError("PluginManager worker identity is invalid.");
  }

  async plan(request: ExtensionChangeRequest): Promise<PluginManagerPlan> {
    if (!validRequest(request)) throw new PluginManagerError("INVALID_REQUEST", "Extension change request is invalid.");
    const requestDigest = await extensionOperationRequestDigest(request);
    const inventory = inventoryGenerationState(await this.store.inventory(request.applicationId, request.environment), request);
    assertRetainedReleaseReenable(request, inventory);
    const authorizationOperation = admittedAuthorizationOperation(request, inventory);
    const authorization = await this.authorizer.authorize({ ...request, operation: authorizationOperation, requestDigest });
    await this.planner.validate(Object.freeze({ ...request }));
    await this.store.reconcileExpiredOperations({ applicationId: request.applicationId, environment: request.environment });
    let claim: ClaimOperationResult;
    try {
      claim = await this.store.claimOperation({ request, requestDigest, authorization, workerId: this.workerId });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "VERSION_DOWNGRADE") {
        throw new PluginManagerError("PLAN_MISMATCH", "Install and update cannot downgrade the active extension version.");
      }
      throw error;
    }
    if (claim.status === "replay" && claim.operation.plan) {
      await this.checkpointStaticPlan(claim.operation);
      return claim.operation.plan;
    }
    if (claim.status === "replay" && ["completed", "failed"].includes(claim.operation.phase)) {
      throw new PluginManagerError("INVALID_STATE", "Only the same unfinished operation may resume planning.");
    }
    const claimedOperation = claim.status === "replay" ? await this.store.resumeOperation(claim.operation.operationId, this.workerId) : claim.operation;
    assertInventoryCanPlan(request, inventory);

    const planned = await this.planner.plan(Object.freeze({
      ...request,
      operationId: claimedOperation.operationId,
      ...(inventory.currentGenerationId ? { currentGenerationId: inventory.currentGenerationId } : {}),
      ...(inventory.rollbackGenerationId ? { rollbackGenerationId: inventory.rollbackGenerationId } : {})
    }));
    const parsed = ExtensionInstallPlanSchema.parse(planned.plan);
    if (!/^[0-9a-f]{40}$/u.test(planned.sourceCommit) || !/^[a-z][a-z0-9-]{2,127}$/u.test(planned.generationId)) {
      throw new PluginManagerError("PLAN_MISMATCH", "Planner source or generation authority is invalid.");
    }
    assertPlanMatches(request, parsed, claimedOperation.operationId, planned.generationId, inventory);
    const operationId = claimedOperation.operationId;
    let result: PluginManagerPlan;
    if (parsed.deliveryClass === "platform-plugin") {
      if (parsed.operation === "disable") {
        result = Object.freeze({ executionClass: "live-generation", operationId, plan: { ...parsed, operation: "disable" as const }, sourceCommit: planned.sourceCommit, generationId: planned.generationId });
      } else {
        const sourceAuthorization = await this.reauthorize(claimedOperation);
        const sourceChange = await this.staticChanges.request({
          applicationId: request.applicationId,
          environment: request.environment,
          expectedSourceCommit: planned.sourceCommit,
          generationId: planned.generationId,
          plan: parsed
        }, sourceAuthorization);
        const deploymentAuthorization = await this.reauthorize(claimedOperation);
        const deployment = await this.deployments.request(sourceChange, deploymentAuthorization);
        result = Object.freeze({ executionClass: "static-release", operationId, plan: parsed, generationId: planned.generationId, sourceChange, deployment,
          quarantineRecovery: request.operation === "update" && inventory.disposition === "quarantined" });
      }
    } else {
      result = Object.freeze({ executionClass: "live-generation", operationId, plan: parsed, sourceCommit: planned.sourceCommit, generationId: planned.generationId });
    }
    await this.reauthorize(claimedOperation);
    const saved = await this.store.savePlan(operationId, claimedOperation.leaseToken, result);
    if (result.executionClass === "static-release") await this.checkpointStaticPlan(saved);
    return result;
  }

  async stage(operationId: string): Promise<VerifiedGenerationAuthority> {
    const operation = await this.store.resumeOperation(operationId, this.workerId);
    if (!operation.plan) throw new PluginManagerError("OPERATION_NOT_FOUND", "Planned extension operation is unavailable.");
    if (operation.plan.executionClass !== "live-generation") throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin delivery is delegated to static source/build authority.");
    if (!["install", "update"].includes(operation.request.operation)) throw new PluginManagerError("INVALID_STATE", "Only install and update operations stage a live generation.");
    if (!["planning", "downloading", "verified", "staged"].includes(operation.phase)) throw new PluginManagerError("INVALID_STATE", `Extension operation cannot stage from ${operation.phase}.`);
    await this.reauthorize(operation);
    const livePlan = dynamicPlan(operation.plan);
    let current = operation;
    if (current.phase === "planning") {
      await this.reauthorize(current);
      current = (await this.store.transition({ operationId, leaseToken: current.leaseToken, expectedPhase: "planning", phase: "downloading" })).operation;
    }
    const owner = authorityOwner(current.request);
    if (!current.authority) await this.reauthorize(current);
    const authority = current.authority ?? await this.artifacts.stage({ plan: livePlan.plan, owner });
    assertAuthorityOwner(authority, owner);
    if (current.phase === "downloading") {
      await this.reauthorize(current);
      current = (await this.store.transition({ operationId, leaseToken: current.leaseToken, expectedPhase: "downloading", phase: "verified", authority })).operation;
    }
    if (!await this.artifacts.reverify(authority, owner)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Staged artifact authority could not be reverified.");
    if (current.phase === "verified") {
      await this.reauthorize(current);
      await this.store.transition({ operationId, leaseToken: current.leaseToken, expectedPhase: "verified", phase: "staged", authority });
    }
    return authority;
  }

  async inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory> {
    const inventory = await this.store.inventory(applicationId, environment);
    for (const [extensionId, entry] of Object.entries(inventory.extensions.hotApplications)) {
      await this.assertDynamicEntry(entry, { applicationId, environment, deliveryClass: "hot-application", extensionId });
    }
    for (const [extensionId, entry] of Object.entries(inventory.extensions.themeSkins)) {
      await this.assertDynamicEntry(entry, { applicationId, environment, deliveryClass: "theme-skin", extensionId });
    }
    for (const entry of Object.values(inventory.extensions.platformPlugins)) {
      if (entry.disposition === "active" && !await this.deployments.reverify(entry.activeGeneration)) {
        throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Static build authority could not be reverified.");
      }
    }
    return inventory;
  }

  async operation(operationId: string): Promise<ExtensionOperationStatus> {
    const operation = await this.store.readOperation(operationId);
    if (!operation) throw new PluginManagerError("OPERATION_NOT_FOUND", "Extension operation is unavailable.");
    return Object.freeze({
      operationId: operation.operationId,
      request: operation.request,
      requestDigest: operation.requestDigest,
      actor: operation.authorization.actor,
      phase: operation.phase,
      ...(operation.plan ? { plan: operation.plan } : {}),
      ...(operation.result ? { result: operation.result } : {})
    });
  }

  async validate(operationId: string): Promise<ExtensionValidationReport> {
    const operation = await this.store.readOperation(operationId);
    if (!operation?.plan) throw new PluginManagerError("OPERATION_NOT_FOUND", "Planned extension operation is unavailable.");
    await this.reauthorize(operation);
    if (operation.plan.executionClass === "static-release") {
      throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin validation belongs to trusted source/build/deployment authority.");
    }
    const owner = authorityOwner(operation.request);
    const valid = operation.authority !== undefined && (assertAuthorityOwner(operation.authority, owner), await this.artifacts.reverify(operation.authority, owner));
    return Object.freeze({ operationId, executionClass: "live-generation", phase: operation.phase, valid, checks: valid ? ["verified-bundle", "generation-authority"] : [] });
  }

  async activate(operationId: string): Promise<ExtensionActivationReceipt> {
    const replay = await this.completedReceipt(operationId, ["install", "update"]);
    if (replay) return replay as ExtensionActivationReceipt;
    let current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "live-generation" || !current.authority || !["install", "update"].includes(current.request.operation)) {
      throw new PluginManagerError("INVALID_STATE", "Only a verified live generation can be activated.");
    }
    if (!this.generationRuntime) throw new PluginManagerError("INVALID_STATE", "Live generation preparation is unavailable.");
    if (current.request.extension.deliveryClass === "platform-plugin") {
      throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin delivery does not use live generation rollback.");
    }
    await this.reauthorize(current);
    const livePlan = dynamicPlan(current.plan);
    const owner = authorityOwner(current.request);
    assertAuthorityOwner(current.authority, owner);
    if (current.phase === "staged") {
      if (!await this.artifacts.reverify(current.authority, owner)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Staged artifact authority could not be reverified.");
      await this.reauthorize(current);
      const stage = await this.generationRuntime.prepare({ request: current.request, plan: livePlan, authority: current.authority });
      await this.reauthorize(current);
      current = (await this.store.stageGeneration({ operationId, leaseToken: current.leaseToken, stage })).operation;
    } else if (current.phase === "warming") {
      if (!await this.artifacts.reverify(current.authority, owner)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Warming artifact authority could not be reverified.");
      await this.reauthorize(current);
      const stage = await this.generationRuntime.prepare({ request: current.request, plan: livePlan, authority: current.authority });
      await this.reauthorize(current);
      current = await this.store.refreshGenerationReadiness({ operationId, leaseToken: current.leaseToken, stage });
    }
    if (current.phase !== "warming") throw new PluginManagerError("INVALID_STATE", `Extension operation cannot activate from ${current.phase}.`);
    await this.reauthorize(current);
    return this.store.activateGeneration(operationId, current.leaseToken);
  }

  async rollback(operationId: string): Promise<ExtensionActivationReceipt> {
    const replay = await this.completedReceipt(operationId, ["rollback"]);
    if (replay) return replay as ExtensionActivationReceipt;
    const current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "live-generation" || current.request.operation !== "rollback" || current.phase !== "planning") {
      throw new PluginManagerError("INVALID_STATE", "Extension rollback operation is not ready.");
    }
    if (!this.generationRuntime) throw new PluginManagerError("INVALID_STATE", "Live generation preparation is unavailable.");
    await this.reauthorize(current);
    const livePlan = dynamicPlan(current.plan);
    const owner = authorityOwner(current.request);
    const inventory = await this.store.inventory(current.request.applicationId, current.request.environment);
    const entries = current.request.extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : inventory.extensions.themeSkins;
    const entry = entries[current.request.extension.id];
    if (!entry || entry.disposition !== "active" || !entry.rollbackGeneration) {
      throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "No retained verified generation is available for rollback.");
    }
    const authority = authorityFromGeneration(entry.rollbackGeneration);
    assertAuthorityOwner(authority, owner);
    if (authority.generationId !== current.plan.generationId || !await this.artifacts.reverify(authority, owner)) {
      throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Retained artifact authority could not be reverified.");
    }
    await this.reauthorize(current);
    const stage = await this.generationRuntime.prepare({ request: current.request, plan: livePlan, authority });
    assertFreshRollbackReadiness(stage, authority, current.plan.plan.version, this.clock.now());
    await this.reauthorize(current);
    return this.store.rollbackGeneration(operationId, current.leaseToken, stage);
  }

  async completeStaticRelease(operationId: string, receipt: StaticDeploymentReceipt): Promise<StaticDeploymentReceipt> {
    const persisted = await this.store.readOperation(operationId);
    if (!persisted) throw new PluginManagerError("OPERATION_NOT_FOUND", "Extension operation is unavailable.");
    if (persisted.phase === "completed") {
      if (!persisted.plan || persisted.plan.executionClass !== "static-release" || !persisted.result || !isStaticDeploymentReceipt(persisted.result) || canonicalJson(persisted.result) !== canonicalJson(receipt)) {
        throw new PluginManagerError("INVALID_STATE", "Completed static release operation has a different persisted receipt.");
      }
      return persisted.result;
    }
    await this.reauthorize(persisted);
    const current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "static-release" || !["source-change-ready", "build-attested", "zero-downtime-eligible", "rollback-window-open"].includes(current.phase)) {
      throw new PluginManagerError("INVALID_STATE", "Static release operation is not ready for receipt reconciliation.");
    }
    assertStaticReceipt(current, receipt);
    await this.reauthorize(current);
    return this.store.completeStaticRelease(operationId, current.leaseToken, receipt);
  }

  async disable(operationId: string): Promise<ExtensionDispositionReceipt> {
    const replay = await this.completedReceipt(operationId, ["disable"]);
    if (replay) return replay as ExtensionDispositionReceipt;
    const current = await this.dispositionOperation(operationId, "disable");
    await this.reauthorize(current);
    return this.store.disableGeneration(operationId, current.leaseToken);
  }

  async uninstall(operationId: string): Promise<ExtensionDispositionReceipt> {
    const replay = await this.completedReceipt(operationId, ["uninstall"]);
    if (replay) return replay as ExtensionDispositionReceipt;
    const current = await this.dispositionOperation(operationId, "uninstall");
    await this.reauthorize(current);
    return this.store.uninstallGeneration(operationId, current.leaseToken);
  }

  private async assertDynamicEntry(
    entry: RuntimeExtensionInventory["extensions"]["hotApplications"][string] | RuntimeExtensionInventory["extensions"]["themeSkins"][string],
    owner: VerifiedGenerationAuthorityOwner
  ): Promise<void> {
    if (entry.disposition !== "active") return;
    const authority = authorityFromGeneration(entry.activeGeneration);
    assertAuthorityOwner(authority, owner);
    if (!await this.artifacts.reverify(authority, owner)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Dynamic artifact authority could not be reverified.");
  }

  private async checkpointStaticPlan(operation: RuntimeExtensionOperation): Promise<void> {
    if (operation.plan?.executionClass !== "static-release" || !["planning", "source-change-required"].includes(operation.phase)) return;
    let current = await this.store.resumeOperation(operation.operationId, this.workerId);
    if (current.phase === "planning") {
      await this.reauthorize(current);
      current = (await this.store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "planning", phase: "source-change-required" })).operation;
    }
    if (current.phase === "source-change-required") {
      await this.reauthorize(current);
      await this.store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "source-change-required", phase: "source-change-ready" });
    }
  }

  private async dispositionOperation(operationId: string, operation: "disable" | "uninstall"): Promise<RuntimeExtensionOperation> {
    const current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "live-generation" || current.request.operation !== operation || current.phase !== "planning") {
      throw new PluginManagerError("INVALID_STATE", `Extension ${operation} operation is not ready.`);
    }
    if (current.request.extension.deliveryClass === "platform-plugin" && operation === "uninstall") {
      throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin uninstall requires static source/build authority.");
    }
    await this.reauthorize(current);
    return current;
  }

  private async reauthorize(operation: RuntimeExtensionOperation): Promise<OperationAuthorizationDecision> {
    const requestDigest = await extensionOperationRequestDigest(operation.request);
    if (requestDigest !== operation.requestDigest) throw new PluginManagerError("INVALID_STATE", "Persisted extension operation request digest is invalid.");
    let current: OperationAuthorizationDecision;
    try {
      const inventory = inventoryGenerationState(await this.store.inventory(operation.request.applicationId, operation.request.environment), operation.request);
      current = await this.authorizer.authorize({
        ...operation.request,
        operation: admittedAuthorizationOperation(operation.request, inventory),
        requestDigest
      });
    }
    catch { throw new PluginManagerError("INVALID_STATE", "Current authority does not permit this extension operation."); }
    if (!extensionOperationActorMatches(current.actor, operation.authorization.actor)) {
      throw new PluginManagerError("INVALID_STATE", "Current authority no longer matches the persisted extension operation.");
    }
    return current;
  }

  private async completedReceipt(operationId: string, expectedOperations: readonly ExtensionManagerOperation[]): Promise<ExtensionManagerReceipt | undefined> {
    const operation = await this.store.readOperation(operationId);
    if (!operation) throw new PluginManagerError("OPERATION_NOT_FOUND", "Extension operation is unavailable.");
    if (operation.phase !== "completed") return undefined;
    if (!expectedOperations.includes(operation.request.operation) || !operation.result || operation.result.operation !== operation.request.operation) {
      throw new PluginManagerError("INVALID_STATE", "Completed extension operation has no matching persisted receipt.");
    }
    return operation.result;
  }
}
