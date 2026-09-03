import {
  ExactSemverSchema,
  ExtensionIdentitySchema,
  RemoteUiIsolationProfileSchema,
  RunnerIsolationProfileSchema,
  WorkerGenerationFenceSchema,
  type ExtensionIdentity,
  type RemoteUiIsolationProfile,
  type RunnerIsolationProfile,
  type StaticDeploymentReceipt,
  type RuntimeExtensionInventory,
  type WorkerGenerationFence
} from "@k-nex/contracts";

import type {
  ExtensionActivationReceipt,
  ExtensionChangeRequest,
  ExtensionDispositionReceipt,
  ExtensionOperationStatus,
  ExtensionValidationReport,
  PluginManager,
  PluginManagerPlan,
  VerifiedGenerationAuthority
} from "./plugin-manager.js";
import type { StaticDeploymentOutcome, StaticDeploymentSnapshot } from "./static-deployment-supervisor.js";

export interface ExtensionCatalogRecord {
  readonly extension: ExtensionIdentity;
  readonly version: string;
  readonly displayName: string;
  readonly support: "supported" | "deprecated" | "unsupported";
  readonly review: "approved" | "pending" | "rejected";
  readonly security: "clear" | "advisory" | "compromised";
  readonly revoked: boolean;
  readonly availability: "live-generation" | "static-release";
}

export interface ExtensionCatalogSource {
  list(): Promise<readonly ExtensionCatalogRecord[]>;
}

export interface StaticReleaseOperator {
  validate(operation: ExtensionOperationStatus): Promise<ExtensionValidationReport>;
  execute(operation: ExtensionOperationStatus): Promise<StaticDeploymentOutcome>;
  rollback(operation: ExtensionOperationStatus): Promise<StaticDeploymentReceipt>;
  finalize(operation: ExtensionOperationStatus): Promise<void>;
}

export interface ExtensionHealthObservation {
  readonly extension: ExtensionIdentity;
  readonly generationId?: string;
  readonly state: "healthy" | "degraded" | "quarantined" | "disabled" | "removed";
  readonly reason?: string;
}

export interface ExtensionRuntimeStatusObservation {
  readonly runnerIsolation: RunnerIsolationProfile;
  readonly remoteUiIsolation: RemoteUiIsolationProfile;
  readonly health: readonly ExtensionHealthObservation[];
  readonly staticDeployment?: StaticDeploymentSnapshot;
  readonly workerFence?: WorkerGenerationFence;
}

export interface ExtensionRuntimeStatusSource {
  observe(applicationId: string, environment: string): Promise<ExtensionRuntimeStatusObservation>;
}

export interface ExtensionSystemStatus extends ExtensionRuntimeStatusObservation {
  readonly applicationId: string;
  readonly environment: string;
  readonly inventory: RuntimeExtensionInventory;
}

type OperatorManager = Pick<PluginManager, "plan" | "stage" | "validate" | "operation" | "activate" | "rollback" | "disable" | "uninstall" | "inventory" | "completeStaticRelease" | "prepareStaticRelease">;
type OperatorMutationResult = ExtensionActivationReceipt | ExtensionDispositionReceipt | StaticDeploymentOutcome | StaticDeploymentReceipt;

function validOwner(applicationId: string, environment: string): boolean {
  return /^[a-z][a-z0-9-]{2,127}$/u.test(applicationId) && /^[a-z][a-z0-9-]{1,63}$/u.test(environment);
}

export class ExtensionOperatorApi {
  constructor(
    private readonly manager: OperatorManager,
    private readonly catalog: ExtensionCatalogSource,
    private readonly staticReleases: StaticReleaseOperator,
    private readonly runtimeStatus: ExtensionRuntimeStatusSource
  ) {}

  async catalogList(filter: Readonly<{ deliveryClass?: ExtensionIdentity["deliveryClass"]; includeUnavailable?: boolean }> = {}): Promise<readonly ExtensionCatalogRecord[]> {
    if (filter.deliveryClass !== undefined && !["platform-plugin", "hot-application", "theme-skin"].includes(filter.deliveryClass)) throw new TypeError("Catalog delivery-class filter is invalid.");
    const records = (await this.catalog.list()).map((record) => this.catalogRecord(record));
    const identities = records.map((record) => `${record.extension.deliveryClass}:${record.extension.id}:${record.version}`);
    if (new Set(identities).size !== identities.length) throw new TypeError("Catalog contains duplicate extension releases.");
    return Object.freeze(records
      .filter((record) => filter.deliveryClass === undefined || record.extension.deliveryClass === filter.deliveryClass)
      .filter((record) => filter.includeUnavailable === true || (!record.revoked && record.review === "approved" && record.security === "clear" && record.support !== "unsupported"))
      .sort((left, right) => `${left.extension.deliveryClass}:${left.extension.id}:${left.version}`.localeCompare(`${right.extension.deliveryClass}:${right.extension.id}:${right.version}`)));
  }

  async catalogDetail(extension: ExtensionIdentity, version: string): Promise<ExtensionCatalogRecord | undefined> {
    const identity = ExtensionIdentitySchema.parse(extension);
    const exactVersion = ExactSemverSchema.parse(version);
    return (await this.catalogList({ includeUnavailable: true })).find((candidate) => candidate.extension.deliveryClass === identity.deliveryClass && candidate.extension.id === identity.id && candidate.version === exactVersion);
  }

  plan(request: ExtensionChangeRequest): Promise<PluginManagerPlan> { return this.manager.plan(request); }
  stage(operationId: string): Promise<VerifiedGenerationAuthority> { return this.manager.stage(operationId); }
  operation(operationId: string): Promise<ExtensionOperationStatus> { return this.manager.operation(operationId); }

  async validate(operationId: string): Promise<ExtensionValidationReport> {
    let operation = await this.manager.operation(operationId);
    if (operation.plan?.executionClass === "static-release") {
      await this.manager.prepareStaticRelease(operationId);
      operation = await this.manager.operation(operationId);
    }
    return operation.plan?.executionClass === "static-release" ? this.staticReleases.validate(operation) : this.manager.validate(operationId);
  }

  async activate(operationId: string): Promise<OperatorMutationResult> {
    const operation = await this.manager.operation(operationId);
    this.assertOperation(operation, ["install", "update"]);
    if (operation.plan?.executionClass !== "static-release") return this.manager.activate(operationId);
    return this.reconcileStatic(operation, await this.staticReleases.execute(operation));
  }

  async rollback(operationId: string): Promise<OperatorMutationResult> {
    const operation = await this.manager.operation(operationId);
    this.assertOperation(operation, ["rollback"]);
    if (operation.plan?.executionClass !== "static-release") return this.manager.rollback(operationId);
    const receipt = await this.staticReleases.rollback(operation);
    await this.manager.completeStaticRelease(operation.operationId, receipt);
    await this.staticReleases.finalize(operation);
    return receipt;
  }

  async disable(operationId: string): Promise<OperatorMutationResult> {
    const operation = await this.manager.operation(operationId);
    this.assertOperation(operation, ["disable"]);
    if (operation.plan?.executionClass !== "static-release") return this.manager.disable(operationId);
    return this.reconcileStatic(operation, await this.staticReleases.execute(operation));
  }

  async uninstall(operationId: string): Promise<OperatorMutationResult> {
    const operation = await this.manager.operation(operationId);
    this.assertOperation(operation, ["uninstall"]);
    if (operation.plan?.executionClass !== "static-release") return this.manager.uninstall(operationId);
    return this.reconcileStatic(operation, await this.staticReleases.execute(operation));
  }

  async status(applicationId: string, environment: string): Promise<ExtensionSystemStatus> {
    if (!validOwner(applicationId, environment)) throw new TypeError("Extension status owner is invalid.");
    const [inventory, observation] = await Promise.all([this.manager.inventory(applicationId, environment), this.runtimeStatus.observe(applicationId, environment)]);
    if ((observation.staticDeployment && (observation.staticDeployment.applicationId !== applicationId || observation.staticDeployment.environment !== environment)) ||
      (observation.workerFence && (observation.workerFence.applicationId !== applicationId || observation.workerFence.environment !== environment))) throw new TypeError("Extension status authority belongs to another application or environment.");
    const health = observation.health.map((entry) => {
      const extension = ExtensionIdentitySchema.parse(entry.extension);
      if ((entry.generationId !== undefined && !/^[a-z][a-z0-9-]{2,127}$/u.test(entry.generationId)) || (entry.reason !== undefined && (entry.reason.length < 1 || entry.reason.length > 512)) ||
        !["healthy", "degraded", "quarantined", "disabled", "removed"].includes(entry.state)) throw new TypeError("Extension health observation is invalid.");
      return Object.freeze({ ...entry, extension: Object.freeze(extension) });
    }).sort((left, right) => `${left.extension.deliveryClass}:${left.extension.id}`.localeCompare(`${right.extension.deliveryClass}:${right.extension.id}`));
    const healthKeys = health.map((entry) => `${entry.extension.deliveryClass}:${entry.extension.id}`);
    if (new Set(healthKeys).size !== healthKeys.length) throw new TypeError("Extension health observations contain duplicate identities.");
    return Object.freeze({
      applicationId,
      environment,
      inventory,
      runnerIsolation: RunnerIsolationProfileSchema.parse(observation.runnerIsolation),
      remoteUiIsolation: RemoteUiIsolationProfileSchema.parse(observation.remoteUiIsolation),
      health: Object.freeze(health),
      ...(observation.staticDeployment ? { staticDeployment: observation.staticDeployment } : {}),
      ...(observation.workerFence ? { workerFence: WorkerGenerationFenceSchema.parse(observation.workerFence) } : {})
    });
  }

  private catalogRecord(value: ExtensionCatalogRecord): ExtensionCatalogRecord {
    const extension = ExtensionIdentitySchema.parse(value.extension);
    const version = ExactSemverSchema.parse(value.version);
    if (value.displayName.length < 1 || value.displayName.length > 160 || !["supported", "deprecated", "unsupported"].includes(value.support) ||
      !["approved", "pending", "rejected"].includes(value.review) || !["clear", "advisory", "compromised"].includes(value.security) ||
      (extension.deliveryClass === "platform-plugin") !== (value.availability === "static-release")) throw new TypeError("Catalog record is invalid.");
    return Object.freeze({ ...value, extension: Object.freeze(extension), version });
  }

  private assertOperation(operation: ExtensionOperationStatus, expected: readonly ExtensionChangeRequest["operation"][]): void {
    if (!expected.includes(operation.request.operation)) throw new TypeError(`Operation ${operation.operationId} is not authorized for this lifecycle action.`);
  }

  private async reconcileStatic(operation: ExtensionOperationStatus, outcome: StaticDeploymentOutcome): Promise<StaticDeploymentOutcome> {
    if (outcome.outcome === "promoted") {
      await this.manager.completeStaticRelease(operation.operationId, outcome.receipt);
      await this.staticReleases.finalize(operation);
    }
    return outcome;
  }
}
