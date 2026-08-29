import {
  canonicalJson,
  ExactSemverSchema,
  ExtensionIdentitySchema,
  ExtensionInstallPlanSchema,
  type ExtensionIdentity,
  type ExtensionInstallPlan,
  type ExtensionLifecycleEvent,
  type ExtensionOperationPhase,
  type ExtensionOperationActor,
  type StaticCompositionChangePlan,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";

export type ExtensionManagerOperation = "install" | "update" | "disable" | "rollback" | "uninstall";
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

export interface OperationAuthorizationRequest {
  readonly applicationId: string;
  readonly environment: string;
  readonly extension: ExtensionIdentity;
  readonly operation: ExtensionManagerOperation;
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
  plan(request: ExtensionChangeRequest): Promise<Readonly<{ plan: ExtensionInstallPlan; sourceCommit: string; generationId: string }>>;
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

export type ExtensionManagerReceipt = ExtensionActivationReceipt | ExtensionDispositionReceipt;

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
  prepare(input: Readonly<{ request: ExtensionChangeRequest; plan: Exclude<PluginManagerPlan, { executionClass: "static-release" }>; authority: VerifiedGenerationAuthority }>): Promise<StagedGenerationActivation>;
}

export interface DynamicArtifactPipeline {
  stage(plan: Exclude<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>): Promise<VerifiedGenerationAuthority>;
  reverify(authority: VerifiedGenerationAuthority): Promise<boolean>;
}

export type PluginManagerPlan =
  | Readonly<{ executionClass: "live-generation"; operationId: string; plan: Exclude<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>; sourceCommit: string; generationId: string }>
  | Readonly<{ executionClass: "static-release"; operationId: string; plan: Extract<ExtensionInstallPlan, { deliveryClass: "platform-plugin" }>; generationId: string; sourceChange: StaticCompositionChangeResult; deployment: TrustedDeploymentRequest }>;

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
  claimOperation(input: Readonly<{ request: ExtensionChangeRequest; requestDigest: string; authorization: OperationAuthorizationDecision; workerId: string }>): Promise<ClaimOperationResult>;
  resumeOperation(operationId: string, workerId: string): Promise<RuntimeExtensionOperation>;
  savePlan(operationId: string, leaseToken: string, plan: PluginManagerPlan): Promise<RuntimeExtensionOperation>;
  transition(input: Readonly<{ operationId: string; leaseToken: string; expectedPhase: ExtensionOperationPhase; phase: ExtensionOperationPhase; authority?: VerifiedGenerationAuthority }>): Promise<Readonly<{ operation: RuntimeExtensionOperation; event: ExtensionLifecycleEvent }>>;
  readOperation(operationId: string): Promise<RuntimeExtensionOperation | undefined>;
  inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory>;
  stageGeneration(input: Readonly<{ operationId: string; leaseToken: string; stage: StagedGenerationActivation }>): Promise<Readonly<{ operation: RuntimeExtensionOperation; event: ExtensionLifecycleEvent }>>;
  refreshGenerationReadiness(input: Readonly<{ operationId: string; leaseToken: string; stage: StagedGenerationActivation }>): Promise<RuntimeExtensionOperation>;
  activateGeneration(operationId: string, leaseToken: string): Promise<ExtensionActivationReceipt>;
  rollbackGeneration(operationId: string, leaseToken: string): Promise<ExtensionActivationReceipt>;
  disableGeneration(operationId: string, leaseToken: string): Promise<ExtensionDispositionReceipt>;
  uninstallGeneration(operationId: string, leaseToken: string): Promise<ExtensionDispositionReceipt>;
  observeActiveGeneration(applicationId: string, environment: string, extension: ExtensionIdentity): Promise<ActiveGenerationObservation>;
  acquireGenerationLease(input: Readonly<{ applicationId: string; environment: string; extension: ExtensionIdentity; generationId: string; holder: string; ttlMs: number }>): Promise<string>;
  releaseGenerationLease(leaseId: string): Promise<void>;
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

function assertPlanMatches(request: ExtensionChangeRequest, plan: ExtensionInstallPlan): void {
  if (plan.deliveryClass !== request.extension.deliveryClass || plan.id !== request.extension.id || plan.operation !== request.operation ||
    plan.version !== request.targetVersion || plan.expectedRevision !== request.expectedRevision) {
    throw new PluginManagerError("PLAN_MISMATCH", "Planner output does not match the authorized extension request.");
  }
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
    private readonly generationRuntime?: DynamicGenerationRuntime
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(workerId)) throw new TypeError("PluginManager worker identity is invalid.");
  }

  async plan(request: ExtensionChangeRequest): Promise<PluginManagerPlan> {
    if (!validRequest(request)) throw new PluginManagerError("INVALID_REQUEST", "Extension change request is invalid.");
    const requestDigest = await digest(request);
    const authorization = await this.authorizer.authorize({ ...request, requestDigest });
    const claim = await this.store.claimOperation({ request, requestDigest, authorization, workerId: this.workerId });
    if (claim.status === "replay" && claim.operation.plan) {
      await this.checkpointStaticPlan(claim.operation);
      return claim.operation.plan;
    }
    const claimedOperation = claim.status === "replay" ? await this.store.resumeOperation(claim.operation.operationId, this.workerId) : claim.operation;

    const planned = await this.planner.plan(request);
    const parsed = ExtensionInstallPlanSchema.parse(planned.plan);
    if (!/^[0-9a-f]{40}$/u.test(planned.sourceCommit) || !/^[a-z][a-z0-9-]{2,127}$/u.test(planned.generationId)) {
      throw new PluginManagerError("PLAN_MISMATCH", "Planner source or generation authority is invalid.");
    }
    assertPlanMatches(request, parsed);
    const operationId = claimedOperation.operationId;
    let result: PluginManagerPlan;
    if (parsed.deliveryClass === "platform-plugin") {
      const sourceChange = await this.staticChanges.request({
        applicationId: request.applicationId,
        environment: request.environment,
        expectedSourceCommit: planned.sourceCommit,
        generationId: planned.generationId,
        plan: parsed
      }, authorization);
      const deployment = await this.deployments.request(sourceChange, authorization);
      result = Object.freeze({ executionClass: "static-release", operationId, plan: parsed, generationId: planned.generationId, sourceChange, deployment });
    } else {
      result = Object.freeze({ executionClass: "live-generation", operationId, plan: parsed, sourceCommit: planned.sourceCommit, generationId: planned.generationId });
    }
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
    const dynamicPlan = operation.plan;
    let current = operation;
    if (current.phase === "planning") current = (await this.store.transition({ operationId, leaseToken: current.leaseToken, expectedPhase: "planning", phase: "downloading" })).operation;
    const authority = current.authority ?? await this.artifacts.stage(dynamicPlan.plan);
    if (current.phase === "downloading") current = (await this.store.transition({ operationId, leaseToken: current.leaseToken, expectedPhase: "downloading", phase: "verified", authority })).operation;
    if (!await this.artifacts.reverify(authority)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Staged artifact authority could not be reverified.");
    if (current.phase === "verified") await this.store.transition({ operationId, leaseToken: current.leaseToken, expectedPhase: "verified", phase: "staged", authority });
    return authority;
  }

  async inventory(applicationId: string, environment: string): Promise<RuntimeExtensionInventory> {
    const inventory = await this.store.inventory(applicationId, environment);
    for (const entry of Object.values(inventory.extensions.hotApplications)) await this.assertDynamicEntry(entry);
    for (const entry of Object.values(inventory.extensions.themeSkins)) await this.assertDynamicEntry(entry);
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
      actor: operation.authorization.actor,
      phase: operation.phase,
      ...(operation.plan ? { plan: operation.plan } : {}),
      ...(operation.result ? { result: operation.result } : {})
    });
  }

  async validate(operationId: string): Promise<ExtensionValidationReport> {
    const operation = await this.store.readOperation(operationId);
    if (!operation?.plan) throw new PluginManagerError("OPERATION_NOT_FOUND", "Planned extension operation is unavailable.");
    if (operation.plan.executionClass === "static-release") {
      throw new PluginManagerError("WRONG_EXECUTION_CLASS", "Platform Plugin validation belongs to trusted source/build/deployment authority.");
    }
    const valid = operation.authority !== undefined && await this.artifacts.reverify(operation.authority);
    return Object.freeze({ operationId, executionClass: "live-generation", phase: operation.phase, valid, checks: valid ? ["verified-bundle", "generation-authority"] : [] });
  }

  async activate(operationId: string): Promise<ExtensionActivationReceipt> {
    let current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "live-generation" || !current.authority || !["install", "update"].includes(current.request.operation)) {
      throw new PluginManagerError("INVALID_STATE", "Only a verified live generation can be activated.");
    }
    if (!this.generationRuntime) throw new PluginManagerError("INVALID_STATE", "Live generation preparation is unavailable.");
    if (current.phase === "staged") {
      if (!await this.artifacts.reverify(current.authority)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Staged artifact authority could not be reverified.");
      const stage = await this.generationRuntime.prepare({ request: current.request, plan: current.plan, authority: current.authority });
      current = (await this.store.stageGeneration({ operationId, leaseToken: current.leaseToken, stage })).operation;
    } else if (current.phase === "warming") {
      if (!await this.artifacts.reverify(current.authority)) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Warming artifact authority could not be reverified.");
      const stage = await this.generationRuntime.prepare({ request: current.request, plan: current.plan, authority: current.authority });
      current = await this.store.refreshGenerationReadiness({ operationId, leaseToken: current.leaseToken, stage });
    }
    if (current.phase !== "warming") throw new PluginManagerError("INVALID_STATE", `Extension operation cannot activate from ${current.phase}.`);
    return this.store.activateGeneration(operationId, current.leaseToken);
  }

  async rollback(operationId: string): Promise<ExtensionActivationReceipt> {
    const current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "live-generation" || current.request.operation !== "rollback" || current.phase !== "planning") {
      throw new PluginManagerError("INVALID_STATE", "Extension rollback operation is not ready.");
    }
    return this.store.rollbackGeneration(operationId, current.leaseToken);
  }

  async disable(operationId: string): Promise<ExtensionDispositionReceipt> {
    const current = await this.dispositionOperation(operationId, "disable");
    return this.store.disableGeneration(operationId, current.leaseToken);
  }

  async uninstall(operationId: string): Promise<ExtensionDispositionReceipt> {
    const current = await this.dispositionOperation(operationId, "uninstall");
    return this.store.uninstallGeneration(operationId, current.leaseToken);
  }

  private async assertDynamicEntry(entry: RuntimeExtensionInventory["extensions"]["hotApplications"][string]): Promise<void> {
    if (entry.disposition !== "active") return;
    const generation = entry.activeGeneration;
    if (!await this.artifacts.reverify({
      generationId: generation.generationId,
      sourceCommit: generation.sourceCommit,
      artifactDigest: generation.artifactDigest,
      manifestDigest: generation.manifestDigest,
      catalogDigest: generation.catalogDigest,
      provenanceDigest: generation.provenanceDigest,
      sbomDigest: generation.sbomDigest
    })) throw new PluginManagerError("ARTIFACT_AUTHORITY_REJECTED", "Dynamic artifact authority could not be reverified.");
  }

  private async checkpointStaticPlan(operation: RuntimeExtensionOperation): Promise<void> {
    if (operation.plan?.executionClass !== "static-release" || !["planning", "source-change-required"].includes(operation.phase)) return;
    let current = await this.store.resumeOperation(operation.operationId, this.workerId);
    if (current.phase === "planning") current = (await this.store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "planning", phase: "source-change-required" })).operation;
    if (current.phase === "source-change-required") await this.store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "source-change-required", phase: "source-change-ready" });
  }

  private async dispositionOperation(operationId: string, operation: "disable" | "uninstall"): Promise<RuntimeExtensionOperation> {
    const current = await this.store.resumeOperation(operationId, this.workerId);
    if (!current.plan || current.plan.executionClass !== "live-generation" || current.request.operation !== operation || current.phase !== "planning") {
      throw new PluginManagerError("INVALID_STATE", `Extension ${operation} operation is not ready.`);
    }
    return current;
  }
}
