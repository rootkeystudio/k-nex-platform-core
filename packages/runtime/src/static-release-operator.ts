import type { StaticDeploymentReceipt } from "@k-nex/contracts";

import type { StaticReleaseOperator } from "./extension-operator-api.js";
import type { ExtensionOperationStatus, ExtensionValidationReport } from "./plugin-manager.js";
import type { VerifiedStaticApplicationBuild } from "./static-composition-authority.js";
import type { DeploymentSupervisor, StaticDeploymentOutcome, VerifiedStaticBuildReader } from "./static-deployment-supervisor.js";

export type StaticReleaseRequestStatus = "build-requested" | "builder-attested" | "deployment-requested" | "deployed" | "rejected";

export interface DurableStaticReleaseRequest {
  readonly buildRequestDigest: string;
  readonly applicationId: string;
  readonly environment: string;
  readonly version: string;
  readonly sourceCommit: string;
  readonly changePlanDigest: string;
  readonly status: StaticReleaseRequestStatus;
  readonly generationId?: string;
  readonly buildEvidenceDigest?: string;
  readonly applicationDigest?: string;
  readonly imageDigest?: string;
  readonly migrationRevision?: number;
  readonly workerFencingToken?: number;
  readonly receipt?: StaticDeploymentReceipt;
}

export interface StaticReleaseRequestAuthority {
  readRequest(buildRequestDigest: string): Promise<DurableStaticReleaseRequest | undefined>;
  requestDeployment(input: Readonly<{ buildRequestDigest: string; expectedVersion: string }>): Promise<DurableStaticReleaseRequest>;
  recordDeployment(input: Readonly<{ buildRequestDigest: string; expectedVersion: string; receipt: StaticDeploymentReceipt }>): Promise<DurableStaticReleaseRequest>;
  recoverDeployment(input: Readonly<{
    buildRequestDigest: string;
    expectedVersion: string;
    expectedRevision: number;
    targetGenerationId: string;
    operation: "promote" | "rollback";
  }>): Promise<DurableStaticReleaseRequest | undefined>;
}

export interface TrustedStaticReleaseBuildAuthority {
  verifiedBuild(request: DurableStaticReleaseRequest): Promise<VerifiedStaticApplicationBuild | undefined>;
}

export interface StaticReleaseWorkerLeaseAuthority {
  acquire(operation: ExtensionOperationStatus): Promise<Readonly<{ workerOwner: string; workerLeaseExpiresAt: string }>>;
}

export class StaticReleaseOperatorError extends Error {
  constructor(readonly code: "INVALID_OPERATION" | "AUTHORITY_UNAVAILABLE" | "AUTHORITY_MISMATCH", message: string) {
    super(message);
    this.name = "StaticReleaseOperatorError";
  }
}

export class DurableStaticReleaseOperator implements StaticReleaseOperator {
  constructor(
    private readonly requests: StaticReleaseRequestAuthority,
    private readonly builds: TrustedStaticReleaseBuildAuthority,
    private readonly verifiedBuilds: VerifiedStaticBuildReader,
    private readonly supervisor: DeploymentSupervisor,
    private readonly workerLeases: StaticReleaseWorkerLeaseAuthority
  ) {}

  async validate(operation: ExtensionOperationStatus): Promise<ExtensionValidationReport> {
    const request = await this.request(operation);
    if (request.status === "rejected") throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Static release request was rejected by the trusted authority.");
    if (request.status === "build-requested") {
      return Object.freeze({ operationId: operation.operationId, executionClass: "static-release", phase: operation.phase, valid: false, checks: ["durable-source-change"] });
    }
    await this.build(operation, request);
    return Object.freeze({ operationId: operation.operationId, executionClass: "static-release", phase: operation.phase, valid: true, checks: ["durable-source-change", "trusted-build", "exact-version"] });
  }

  async execute(operation: ExtensionOperationStatus): Promise<StaticDeploymentOutcome> {
    if (operation.request.operation === "rollback") throw new StaticReleaseOperatorError("INVALID_OPERATION", "Static rollback must use the rollback operation path.");
    const request = await this.request(operation);
    if (request.status === "deployed") return Object.freeze({ outcome: "promoted", receipt: this.deployedReceipt(operation, request) });
    if (request.status !== "builder-attested" && request.status !== "deployment-requested") throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Static release is not attested and ready for deployment.");
    const build = await this.build(operation, request);
    const dispatched = await this.requests.requestDeployment({ buildRequestDigest: request.buildRequestDigest, expectedVersion: request.version });
    this.assertRequest(operation, dispatched);
    if (dispatched.status === "deployed") return Object.freeze({ outcome: "promoted", receipt: this.deployedReceipt(operation, dispatched) });
    if (dispatched.status !== "deployment-requested") throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Static release deployment request is unavailable.");
    const recovered = await this.recover(operation, dispatched, "promote");
    if (recovered) return Object.freeze({ outcome: "promoted", receipt: this.deployedReceipt(operation, recovered) });
    const lease = await this.workerLeases.acquire(operation);
    const outcome = await this.supervisor.deploy({ build, generationId: operation.plan!.generationId, ...lease });
    if (outcome.outcome === "maintenance-required") return outcome;
    if (outcome.receipt.activeGenerationId !== operation.plan!.generationId) throw new StaticReleaseOperatorError("AUTHORITY_MISMATCH", "Deployment receipt promoted a generation other than the durable operation target.");
    const persisted = await this.requests.recordDeployment({ buildRequestDigest: dispatched.buildRequestDigest, expectedVersion: dispatched.version, receipt: outcome.receipt });
    this.assertRequest(operation, persisted);
    return Object.freeze({ outcome: "promoted", receipt: this.deployedReceipt(operation, persisted) });
  }

  async rollback(operation: ExtensionOperationStatus): Promise<StaticDeploymentReceipt> {
    if (operation.request.operation !== "rollback") throw new StaticReleaseOperatorError("INVALID_OPERATION", "Static rollback requires a rollback operation.");
    const request = await this.request(operation);
    if (request.status === "deployed") return this.rollbackReceipt(operation, request);
    if (request.status !== "builder-attested" && request.status !== "deployment-requested") throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Static rollback is not backed by an attested durable release request.");
    await this.build(operation, request);
    const dispatched = await this.requests.requestDeployment({ buildRequestDigest: request.buildRequestDigest, expectedVersion: request.version });
    this.assertRequest(operation, dispatched);
    if (dispatched.status === "deployed") return this.rollbackReceipt(operation, dispatched);
    if (dispatched.status !== "deployment-requested") throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Static rollback deployment request is unavailable.");
    const recovered = await this.recover(operation, dispatched, "rollback");
    if (recovered) return this.rollbackReceipt(operation, recovered);
    const lease = await this.workerLeases.acquire(operation);
    const receipt = await this.supervisor.rollback({ applicationId: operation.request.applicationId, environment: operation.request.environment, ...lease });
    if (receipt.activeGenerationId !== operation.plan!.generationId) throw new StaticReleaseOperatorError("AUTHORITY_MISMATCH", "Rollback receipt promoted a generation other than the durable operation target.");
    const persisted = await this.requests.recordDeployment({ buildRequestDigest: dispatched.buildRequestDigest, expectedVersion: dispatched.version, receipt });
    this.assertRequest(operation, persisted);
    return this.rollbackReceipt(operation, persisted);
  }

  private async request(operation: ExtensionOperationStatus): Promise<DurableStaticReleaseRequest> {
    const plan = operation.plan;
    if (!plan || plan.executionClass !== "static-release") throw new StaticReleaseOperatorError("INVALID_OPERATION", "Static release operator requires a static-release operation plan.");
    const request = await this.requests.readRequest(plan.deployment.buildRequestDigest);
    if (!request) throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Durable static release request is unavailable.");
    this.assertRequest(operation, request);
    return request;
  }

  private async build(operation: ExtensionOperationStatus, request: DurableStaticReleaseRequest): Promise<VerifiedStaticApplicationBuild> {
    const build = await this.builds.verifiedBuild(request);
    if (!build) throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Trusted build authority cannot reverify the durable static release request.");
    const verified = this.verifiedBuilds.read(build);
    const plan = operation.plan;
    if (!plan || plan.executionClass !== "static-release") throw new StaticReleaseOperatorError("INVALID_OPERATION", "Static release operator requires a static-release operation plan.");
    if (verified.change.planDigest !== plan.sourceChange.planDigest || verified.change.targetSourceCommit !== plan.sourceChange.targetSourceCommit ||
      verified.evidenceDigest !== request.buildEvidenceDigest || verified.evidence.applicationSubject.digest !== request.applicationDigest || verified.evidence.imageSubject.digest !== request.imageDigest) {
      throw new StaticReleaseOperatorError("AUTHORITY_MISMATCH", "Trusted build token does not match the durable static release request.");
    }
    return build;
  }

  private assertRequest(operation: ExtensionOperationStatus, request: DurableStaticReleaseRequest): void {
    const plan = operation.plan;
    if (!plan || plan.executionClass !== "static-release" || request.applicationId !== operation.request.applicationId || request.environment !== operation.request.environment ||
      request.version !== plan.plan.version || request.sourceCommit !== plan.sourceChange.targetSourceCommit || request.changePlanDigest !== plan.sourceChange.planDigest ||
      request.buildRequestDigest !== plan.deployment.buildRequestDigest || plan.deployment.sourceCommit !== plan.sourceChange.targetSourceCommit) {
      throw new StaticReleaseOperatorError("AUTHORITY_MISMATCH", "Durable static release request does not bind this operation's exact source, version, and plan.");
    }
  }

  private deployedReceipt(operation: ExtensionOperationStatus, request: DurableStaticReleaseRequest): StaticDeploymentReceipt {
    if (request.status !== "deployed" || !request.receipt) throw new StaticReleaseOperatorError("AUTHORITY_UNAVAILABLE", "Deployed static release request is missing its authoritative receipt.");
    const plan = operation.plan;
    const receipt = request.receipt;
    if (!plan || plan.executionClass !== "static-release" || receipt.applicationId !== request.applicationId || receipt.environment !== request.environment ||
      receipt.activeGenerationId !== plan.generationId || receipt.sourceCommit !== request.sourceCommit || receipt.compositionChangePlanDigest !== request.changePlanDigest ||
      receipt.buildEvidenceDigest !== request.buildEvidenceDigest || receipt.applicationDigest !== request.applicationDigest || receipt.imageDigest !== request.imageDigest ||
      receipt.migrationRevision !== request.migrationRevision || receipt.workerFencingToken !== request.workerFencingToken ||
      receipt.operation !== (operation.request.operation === "rollback" ? "rollback" : "promote") ||
      (operation.request.operation === "uninstall" &&
        (receipt.previousGenerationId !== plan.plan.currentGenerationId || receipt.activeGenerationId === receipt.previousGenerationId))) {
      throw new StaticReleaseOperatorError("AUTHORITY_MISMATCH", "Static deployment receipt does not match the durable release authority.");
    }
    return receipt;
  }

  private async recover(operation: ExtensionOperationStatus, request: DurableStaticReleaseRequest, receiptOperation: "promote" | "rollback"): Promise<DurableStaticReleaseRequest | undefined> {
    const plan = operation.plan;
    if (!plan || plan.executionClass !== "static-release") throw new StaticReleaseOperatorError("INVALID_OPERATION", "Static release operator requires a static-release operation plan.");
    const recovered = await this.requests.recoverDeployment({
      buildRequestDigest: request.buildRequestDigest,
      expectedVersion: request.version,
      expectedRevision: operation.request.expectedRevision,
      targetGenerationId: plan.generationId,
      operation: receiptOperation
    });
    if (recovered) this.assertRequest(operation, recovered);
    return recovered;
  }

  private rollbackReceipt(operation: ExtensionOperationStatus, request: DurableStaticReleaseRequest): StaticDeploymentReceipt {
    const receipt = this.deployedReceipt(operation, request);
    if (receipt.operation !== "rollback") throw new StaticReleaseOperatorError("AUTHORITY_MISMATCH", "A promotion receipt cannot satisfy a static rollback operation.");
    return receipt;
  }
}
