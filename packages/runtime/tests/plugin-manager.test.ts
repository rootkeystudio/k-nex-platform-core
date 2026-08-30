import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionInstallPlan, RuntimeExtensionInventory, StaticCompositionChangePlan } from "@k-nex/contracts";
import {
  PluginManager,
  TrustedAutomationOperationAuthorizer,
  type ClaimOperationResult,
  type ExtensionChangeRequest,
  type ExtensionActivationReceipt,
  type PluginManagerPlan,
  type RuntimeExtensionOperation,
  type RuntimeExtensionStore,
  type VerifiedGenerationAuthority
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const staticChange = JSON.parse(readFileSync(new URL("../../../fixtures/extensions/valid/static-composition-change-plan.json", import.meta.url), "utf8")) as StaticCompositionChangePlan;

const request: ExtensionChangeRequest = {
  applicationId: "customer-alpha",
  environment: "production",
  extension: { deliveryClass: "hot-application", id: "app.sales-assistant" },
  operation: "install",
  targetVersion: "1.0.0",
  expectedRevision: 0,
  idempotencyKey: "install:app.sales-assistant:1",
  correlationId: "extension-correlation-1"
};

const hotPlan: ExtensionInstallPlan = {
  schemaVersion: 1,
  planId: "sales-assistant-plan-1",
  operationId: "sales-assistant-operation-1",
  operation: "install",
  version: "1.0.0",
  artifactDigest: digest("a"),
  expectedRevision: 0,
  targetGenerationId: "sales-assistant-generation-1",
  approvalRequired: false,
  rollback: { available: true, windowSeconds: 86_400 },
  deliveryClass: "hot-application",
  id: "app.sales-assistant",
  availability: { outcome: "live-generation", activation: "atomic-generation-pointer" },
  requiredCapabilities: [],
  resourceBudget: {
    maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576,
    maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000,
    maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4
  }
};

const authority: VerifiedGenerationAuthority = {
  applicationId: "customer-alpha",
  environment: "production",
  deliveryClass: "hot-application",
  extensionId: "app.sales-assistant",
  generationId: "sales-assistant-generation-1",
  sourceCommit: "a".repeat(40),
  artifactDigest: digest("a"),
  manifestDigest: digest("b"),
  catalogDigest: digest("c"),
  provenanceDigest: digest("d"),
  sbomDigest: digest("e")
};

function emptyInventory(): RuntimeExtensionInventory {
  return {
    schemaVersion: 1, applicationId: "customer-alpha", environment: "production", hostInventoryDigest: digest("7"), revision: 0,
    observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: { platformPlugins: {}, themeSkins: {}, hotApplications: {} }
  };
}

class MemoryStore implements RuntimeExtensionStore {
  operation?: RuntimeExtensionOperation;
  readonly transitions: string[] = [];
  inventoryValue: RuntimeExtensionInventory = emptyInventory();
  rollbackResult?: ExtensionActivationReceipt;
  readonly staticReceipts: unknown[] = [];
  resumeCount = 0;

  async claimOperation(input: Parameters<RuntimeExtensionStore["claimOperation"]>[0]): Promise<ClaimOperationResult> {
    if (this.operation) return { status: "replay", operation: this.operation };
    this.operation = { operationId: "extension-operation-1", request: input.request, requestDigest: input.requestDigest, authorization: input.authorization, phase: "planning", leaseToken: "lease-1" };
    return { status: "claimed", operation: this.operation };
  }

  async resumeOperation(): Promise<RuntimeExtensionOperation> {
    if (!this.operation) throw new Error("missing operation");
    this.resumeCount += 1;
    if (this.operation.phase === "completed") return this.operation;
    this.operation = { ...this.operation, leaseToken: "lease-resumed" };
    return this.operation;
  }

  async savePlan(_id: string, _token: string, plan: PluginManagerPlan): Promise<RuntimeExtensionOperation> {
    if (!this.operation) throw new Error("missing operation");
    this.operation = { ...this.operation, plan };
    return this.operation;
  }

  async transition(input: Parameters<RuntimeExtensionStore["transition"]>[0]) {
    if (!this.operation || this.operation.phase !== input.expectedPhase) throw new Error("phase mismatch");
    this.transitions.push(`${input.expectedPhase}->${input.phase}`);
    this.operation = { ...this.operation, phase: input.phase, ...(input.authority ? { authority: input.authority } : {}) };
    return { operation: this.operation, event: {} as never };
  }

  async readOperation(): Promise<RuntimeExtensionOperation | undefined> { return this.operation; }
  async inventory(): Promise<RuntimeExtensionInventory> { return this.inventoryValue; }
  async stageGeneration(input: Parameters<RuntimeExtensionStore["stageGeneration"]>[0]) {
    return this.transition({ operationId: input.operationId, leaseToken: input.leaseToken, expectedPhase: "staged", phase: "warming", authority: input.stage.authority });
  }
  async refreshGenerationReadiness(): Promise<RuntimeExtensionOperation> { return this.operation!; }
  async activateGeneration(): Promise<ExtensionActivationReceipt> {
    return {
      receiptId: "activation-receipt-1", operationId: this.operation!.operationId, operation: "install",
      generationId: authority.generationId, revisionBefore: 5, revisionAfter: 6, inventoryRevision: 6,
      compatibility: { status: "compatible", windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 },
      rollback: "unavailable", occurredAt: "2026-08-29T09:00:00.000Z"
    };
  }
  async rollbackGeneration(): Promise<ExtensionActivationReceipt> {
    if (!this.rollbackResult) throw new Error("unused");
    return this.rollbackResult;
  }
  async completeStaticRelease(_id: string, _token: string, receipt: Parameters<RuntimeExtensionStore["completeStaticRelease"]>[2]) {
    this.staticReceipts.push(receipt);
    this.operation = { ...this.operation!, phase: "completed", result: receipt };
    return receipt;
  }
  async disableGeneration() {
    return { receiptId: "disable-receipt-1", operationId: this.operation!.operationId, operation: "disable" as const, disposition: "disabled" as const, revisionBefore: 1, revisionAfter: 2, inventoryRevision: 2, occurredAt: "2026-08-29T09:00:00.000Z" };
  }
  async uninstallGeneration() {
    return { receiptId: "uninstall-receipt-1", operationId: this.operation!.operationId, operation: "uninstall" as const, disposition: "removed" as const, revisionBefore: 2, revisionAfter: 3, inventoryRevision: 3, occurredAt: "2026-08-29T09:00:00.000Z" };
  }
  async quarantineRunnerGeneration(input: Parameters<RuntimeExtensionStore["quarantineRunnerGeneration"]>[0]) {
    return { receiptId: "runner-receipt-1", quarantineTransitionId: "runner-quarantine-1", disposition: "quarantined" as const, reason: input.reason, generationId: input.generationId, revisionBefore: input.expectedRevision, revisionAfter: input.expectedRevision + 1, inventoryRevision: input.expectedRevision + 1, occurredAt: "2026-08-29T09:00:00.000Z" };
  }
  async observeActiveGeneration() { return { revision: 0, inventoryRevision: 0 }; }
  async acquireGenerationLease() { return "lease-00000000-0000-4000-8000-000000000000"; }
  async releaseGenerationLease() {}
  async hasLiveGenerationLease() { return false; }
  async liveGenerationLeaseCount() { return 0; }
}

function manager(store = new MemoryStore(), reverify = true) {
  const planner = { validate: vi.fn(async () => undefined), plan: vi.fn(async (planning) => ({
    plan: { ...hotPlan, operationId: planning.operationId, operation: planning.operation, version: planning.targetVersion, expectedRevision: planning.expectedRevision, ...(planning.currentGenerationId ? { currentGenerationId: planning.currentGenerationId } : {}) },
    sourceCommit: "a".repeat(40), generationId: "sales-assistant-generation-1"
  })) };
  const artifacts = { stage: vi.fn(async () => authority), reverify: vi.fn(async () => reverify) };
  const staticChanges = { request: vi.fn() };
  const deployments = { request: vi.fn(), reverify: vi.fn(async () => reverify) };
  const generationRuntime = { prepare: vi.fn(async ({ authority: preparedAuthority, plan }) => ({
    authority: preparedAuthority, version: plan.plan.version,
    readiness: { generationId: preparedAuthority.generationId, serverGenerationId: preparedAuthority.generationId, uiGenerationId: preparedAuthority.generationId, storageGenerationId: preparedAuthority.generationId, leaseToken: "readiness:lease-1", readyAt: "2026-08-29T09:00:00.000Z", expiresAt: "2026-08-30T09:01:00.000Z" },
    compatibility: { status: "compatible" as const, windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 },
    metadata: {}, settings: {}, storageSchemaVersions: {}
  })) };
  const clock = { now: () => new Date(Date.now()) };
  return { value: new PluginManager("phase-9-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, store, artifacts, staticChanges, deployments, generationRuntime, clock), store, planner, artifacts, staticChanges, deployments, generationRuntime, clock };
}

describe("PluginManager", () => {
  afterEach(() => vi.useRealTimers());

  it("plans and stages a verified live generation with resumable checkpoints", async () => {
    const runtime = manager();
    const planned = await runtime.value.plan(request);
    expect(planned.executionClass).toBe("live-generation");
    await expect(runtime.value.stage(planned.operationId)).resolves.toEqual(authority);
    expect(runtime.store.transitions).toEqual(["planning->downloading", "downloading->verified", "verified->staged"]);
    expect(runtime.artifacts.stage).toHaveBeenCalledWith({ plan: expect.objectContaining({ ...hotPlan, operationId: planned.operationId }), owner: { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-assistant" } });
    expect(runtime.artifacts.reverify).toHaveBeenCalledWith(authority, { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-assistant" });
    await expect(runtime.value.plan(request)).resolves.toBe(planned);
    expect(runtime.planner.plan).toHaveBeenCalledTimes(1);
    runtime.store.operation = { ...runtime.store.operation!, phase: "failed" };
    await expect(runtime.value.stage(planned.operationId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("runs mandatory lifecycle policy validation before claiming an operation", async () => {
    const runtime = manager();
    const claimOperation = vi.spyOn(runtime.store, "claimOperation");
    runtime.planner.validate.mockRejectedValueOnce(Object.assign(new Error("Plugin module.sales does not support uninstall."), { code: "OPERATION_UNSUPPORTED" }));
    await expect(runtime.value.plan({
      ...request, extension: { deliveryClass: "platform-plugin", id: "module.sales" }, operation: "uninstall",
      idempotencyKey: "uninstall:module.sales:unsupported", correlationId: "uninstall-module-sales-unsupported"
    })).rejects.toMatchObject({ code: "OPERATION_UNSUPPORTED" });
    expect(runtime.planner.validate).toHaveBeenCalledWith(expect.objectContaining({ operation: "uninstall", extension: { deliveryClass: "platform-plugin", id: "module.sales" } }));
    expect(claimOperation).not.toHaveBeenCalled();
    expect(runtime.store.operation).toBeUndefined();
    expect(runtime.planner.plan).not.toHaveBeenCalled();
  });

  it("warms and atomically activates the staged generation", async () => {
    const runtime = manager();
    const planned = await runtime.value.plan(request);
    await runtime.value.stage(planned.operationId);
    await expect(runtime.value.activate(planned.operationId)).resolves.toMatchObject({ generationId: authority.generationId, revisionAfter: 6 });
    expect(runtime.generationRuntime.prepare).toHaveBeenCalledOnce();
    expect(runtime.store.transitions.at(-1)).toBe("staged->warming");
  });

  it("delegates module and executable theme Platform Plugins to source and trusted-build authorities", async () => {
    const runtime = manager();
    const platformRequest: ExtensionChangeRequest = { ...request, extension: { deliveryClass: "platform-plugin", id: "module.sales" }, idempotencyKey: "install:module.sales:1" };
    const platformPlan: ExtensionInstallPlan = {
      schemaVersion: 1, planId: hotPlan.planId, operationId: hotPlan.operationId, operation: "install", version: "1.0.0",
      artifactDigest: digest("a"), expectedRevision: 0, targetGenerationId: "customer-alpha-green-1", approvalRequired: false,
      rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] }
    };
    runtime.planner.plan.mockImplementation(async (planning) => ({ plan: { ...platformPlan, operationId: planning.operationId }, sourceCommit: "b".repeat(40), generationId: "customer-alpha-green-1" }));
    runtime.staticChanges.request.mockResolvedValue({ status: "source-change-ready", planDigest: digest("f"), targetSourceCommit: "b".repeat(40), change: staticChange });
    runtime.deployments.request.mockResolvedValue({ status: "build-requested", buildRequestDigest: digest("9"), sourceCommit: "b".repeat(40) });
    await expect(runtime.value.plan(platformRequest)).resolves.toMatchObject({ executionClass: "static-release" });
    expect(runtime.store.transitions).toEqual(["planning->source-change-required", "source-change-required->source-change-ready"]);
    expect(runtime.staticChanges.request).toHaveBeenCalledOnce();
    expect(runtime.deployments.request).toHaveBeenCalledOnce();
    runtime.store.operation = { ...runtime.store.operation!, phase: "source-change-required" };
    await runtime.value.plan(platformRequest);
    expect(runtime.store.transitions.at(-1)).toBe("source-change-required->source-change-ready");
    expect(runtime.staticChanges.request).toHaveBeenCalledOnce();
    expect(runtime.deployments.request).toHaveBeenCalledOnce();

    const theme = manager();
    const themeRequest: ExtensionChangeRequest = { ...request, extension: { deliveryClass: "platform-plugin", id: "theme.minimal" }, idempotencyKey: "install:theme.minimal:1" };
    theme.planner.plan.mockImplementation(async (planning) => ({ plan: { ...platformPlan, id: "theme.minimal", operationId: planning.operationId }, sourceCommit: "b".repeat(40), generationId: "customer-alpha-green-1" }));
    theme.staticChanges.request.mockResolvedValue({ status: "source-change-ready", planDigest: digest("f"), targetSourceCommit: "b".repeat(40), change: staticChange });
    theme.deployments.request.mockResolvedValue({ status: "build-requested", buildRequestDigest: digest("9"), sourceCommit: "b".repeat(40) });
    await expect(theme.value.plan(themeRequest)).resolves.toMatchObject({ executionClass: "static-release" });
    expect(theme.artifacts.stage).not.toHaveBeenCalled();
  });

  it("keeps Platform Plugin disable on the current application generation without source/build work", async () => {
    const runtime = manager();
    const platformRequest: ExtensionChangeRequest = {
      ...request,
      extension: { deliveryClass: "platform-plugin", id: "module.sales" },
      operation: "disable",
      targetVersion: "1.0.1",
      expectedRevision: 4,
      idempotencyKey: "disable:module.sales:4",
      correlationId: "disable-module-sales-4"
    };
    runtime.store.inventoryValue = {
      schemaVersion: 1, applicationId: request.applicationId, environment: request.environment, hostInventoryDigest: digest("7"), revision: 4,
      observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: {
        hotApplications: {}, themeSkins: {}, platformPlugins: {
          "module.sales": {
            disposition: "active", revision: 4, lastOperationId: "extension-operation-previous", lastReceiptId: "extension-receipt-previous", stateDigest: digest("9"),
            activeGeneration: {
              authority: "static-build", generationId: "customer-alpha-green-12", version: "1.0.1", sourceCommit: "b".repeat(40),
              compositionChangePlanDigest: digest("a"), buildEvidenceDigest: digest("b"), applicationDigest: digest("c"), imageDigest: digest("d"),
              migrationRevision: 12, workerFencingToken: 2, receiptId: "static-receipt-previous"
            }
          }
        }
      }
    };
    const disablePlan: ExtensionInstallPlan = {
      schemaVersion: 1, planId: "sales-disable-4", operationId: "placeholder", operation: "disable", version: "1.0.1", artifactDigest: digest("a"),
      expectedRevision: 4, currentGenerationId: "customer-alpha-green-12", targetGenerationId: "customer-alpha-green-12", approvalRequired: true,
      rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    };
    runtime.planner.plan.mockImplementation(async (planning) => ({
      plan: { ...disablePlan, operationId: planning.operationId }, sourceCommit: "b".repeat(40), generationId: disablePlan.targetGenerationId!
    }));
    const planned = await runtime.value.plan(platformRequest);
    expect(planned).toMatchObject({ executionClass: "live-generation", generationId: "customer-alpha-green-12" });
    await expect(runtime.value.disable(planned.operationId)).resolves.toMatchObject({ disposition: "disabled" });
    expect(runtime.staticChanges.request).not.toHaveBeenCalled();
    expect(runtime.deployments.request).not.toHaveBeenCalled();

    const freshGeneration = manager();
    freshGeneration.store.inventoryValue = runtime.store.inventoryValue;
    freshGeneration.planner.plan.mockImplementation(async (planning) => ({
      plan: { ...disablePlan, operationId: planning.operationId, targetGenerationId: "customer-alpha-disable-13" }, sourceCommit: "c".repeat(40), generationId: "customer-alpha-disable-13"
    }));
    await expect(freshGeneration.value.plan(platformRequest)).rejects.toMatchObject({ code: "PLAN_MISMATCH" });
  });

  it("requires a fresh static release generation for a supported Platform Plugin uninstall", async () => {
    const runtime = manager();
    const platformRequest: ExtensionChangeRequest = {
      ...request, extension: { deliveryClass: "platform-plugin", id: "provider.schema-less" }, operation: "uninstall", targetVersion: "1.0.1",
      expectedRevision: 4, idempotencyKey: "uninstall:provider.schema-less:4", correlationId: "uninstall-schema-less-4"
    };
    runtime.store.inventoryValue = {
      schemaVersion: 1, applicationId: request.applicationId, environment: request.environment, hostInventoryDigest: digest("7"), revision: 4,
      observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: { hotApplications: {}, themeSkins: {}, platformPlugins: {
        "provider.schema-less": { disposition: "active", revision: 4, lastOperationId: "extension-operation-previous", lastReceiptId: "extension-receipt-previous", stateDigest: digest("9"), activeGeneration: {
          authority: "static-build", generationId: "customer-alpha-green-12", version: "1.0.1", sourceCommit: "b".repeat(40),
          compositionChangePlanDigest: digest("a"), buildEvidenceDigest: digest("b"), applicationDigest: digest("c"), imageDigest: digest("d"), migrationRevision: 12,
          workerFencingToken: 2, receiptId: "static-receipt-previous"
        } }
      } }
    };
    const uninstallPlan: ExtensionInstallPlan = {
      schemaVersion: 1, planId: "schema-less-uninstall-5", operationId: "placeholder", operation: "uninstall", version: "1.0.1", artifactDigest: digest("a"),
      expectedRevision: 4, currentGenerationId: "customer-alpha-green-12", targetGenerationId: "customer-alpha-uninstall-13", approvalRequired: true,
      rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "provider.schema-less",
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    };
    runtime.planner.plan.mockImplementation(async (planning) => ({ plan: { ...uninstallPlan, operationId: planning.operationId }, sourceCommit: "c".repeat(40), generationId: "customer-alpha-uninstall-13" }));
    runtime.staticChanges.request.mockResolvedValue({ status: "source-change-ready", planDigest: digest("e"), targetSourceCommit: "c".repeat(40), change: staticChange });
    runtime.deployments.request.mockResolvedValue({ status: "build-requested", buildRequestDigest: digest("f"), sourceCommit: "c".repeat(40) });
    await expect(runtime.value.plan(platformRequest)).resolves.toMatchObject({ executionClass: "static-release", generationId: "customer-alpha-uninstall-13" });

    const sameGeneration = manager();
    sameGeneration.store.inventoryValue = runtime.store.inventoryValue;
    sameGeneration.planner.plan.mockImplementation(async (planning) => ({ plan: { ...uninstallPlan, operationId: planning.operationId, targetGenerationId: "customer-alpha-green-12" }, sourceCommit: "c".repeat(40), generationId: "customer-alpha-green-12" }));
    await expect(sameGeneration.value.plan(platformRequest)).rejects.toMatchObject({ code: "PLAN_MISMATCH" });
  });

  it("rejects a forged live-generation Platform Plugin uninstall at execution", async () => {
    const runtime = manager();
    runtime.store.operation = {
      operationId: "extension-operation-forged-uninstall",
      request: { ...request, extension: { deliveryClass: "platform-plugin", id: "provider.schema-less" }, operation: "uninstall" },
      requestDigest: digest("1"), authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("2") },
      phase: "planning", leaseToken: "forged-lease",
      plan: {
        executionClass: "live-generation", operationId: "extension-operation-forged-uninstall", sourceCommit: "b".repeat(40), generationId: "customer-alpha-uninstall-13",
        plan: { ...hotPlan, deliveryClass: "platform-plugin", id: "provider.schema-less", operation: "uninstall", operationId: "extension-operation-forged-uninstall", currentGenerationId: "customer-alpha-green-12", targetGenerationId: "customer-alpha-uninstall-13", availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] } }
      } as unknown as PluginManagerPlan
    };
    await expect(runtime.value.uninstall(runtime.store.operation.operationId)).rejects.toMatchObject({ code: "WRONG_EXECUTION_CLASS" });
    expect(runtime.store.resumeCount).toBe(1);
  });

  it("reconciles only the exact authoritative static receipt and replays it without a second inventory write", async () => {
    const runtime = manager();
    const platformRequest: ExtensionChangeRequest = { ...request, extension: { deliveryClass: "platform-plugin", id: "module.sales" }, idempotencyKey: "install:module.sales:receipt" };
    const platformPlan: ExtensionInstallPlan = {
      schemaVersion: 1, planId: hotPlan.planId, operationId: hotPlan.operationId, operation: "install", version: "1.0.0",
      artifactDigest: digest("a"), expectedRevision: 0, targetGenerationId: "customer-alpha-green-1", approvalRequired: false,
      rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] }
    };
    runtime.planner.plan.mockImplementation(async (planning) => ({ plan: { ...platformPlan, operationId: planning.operationId }, sourceCommit: "b".repeat(40), generationId: "customer-alpha-green-1" }));
    runtime.staticChanges.request.mockResolvedValue({ status: "source-change-ready", planDigest: digest("f"), targetSourceCommit: "b".repeat(40), change: staticChange });
    runtime.deployments.request.mockResolvedValue({ status: "build-requested", buildRequestDigest: digest("9"), sourceCommit: "b".repeat(40) });
    const plan = await runtime.value.plan(platformRequest);
    const receipt = {
      schemaVersion: 1, receiptId: "static-promotion-1", operation: "promote", applicationId: "customer-alpha", environment: "production",
      activeGenerationId: "customer-alpha-green-1", previousGenerationId: "customer-alpha-blue-1", sourceCommit: "b".repeat(40),
      compositionChangePlanDigest: digest("f"), buildEvidenceDigest: digest("d"), applicationDigest: digest("e"), imageDigest: digest("f"),
      migrationRevision: 2, workerFencingToken: 2, promotionRevision: 1, revisionBefore: 0, revisionAfter: 1,
      rollbackWindow: { state: "open", windowId: "window-1", closesAt: "2026-08-30T00:00:00.000Z" }, contractCleanup: "blocked", occurredAt: "2026-08-29T00:00:00.000Z"
    } as const;
    await expect(runtime.value.completeStaticRelease(plan.operationId, receipt)).resolves.toEqual(receipt);
    await expect(runtime.value.completeStaticRelease(plan.operationId, receipt)).resolves.toEqual(receipt);
    expect(runtime.store.staticReceipts).toEqual([receipt]);
    await expect(runtime.value.completeStaticRelease(plan.operationId, { ...receipt, activeGenerationId: "customer-alpha-green-2" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rejects planner mismatches and unverified inventory authority", async () => {
    const runtime = manager(undefined, false);
    runtime.planner.plan.mockResolvedValue({ plan: { ...hotPlan, id: "app.other" }, sourceCommit: "a".repeat(40), generationId: "sales-assistant-generation-1" });
    await expect(runtime.value.plan(request)).rejects.toMatchObject({ code: "PLAN_MISMATCH" });

    runtime.store.inventoryValue = {
      schemaVersion: 1, applicationId: "customer-alpha", environment: "production", hostInventoryDigest: digest("7"), revision: 1,
      observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: {
        platformPlugins: {}, themeSkins: {}, hotApplications: { "app.sales-assistant": {
          disposition: "active", revision: 1, lastOperationId: "extension-operation-1", lastReceiptId: "extension-receipt-1", stateDigest: digest("9"),
          activeGeneration: { authority: "verified-bundle", version: "1.0.0", receiptId: "extension-receipt-1", ...authority }
        } }
      }
    };
    await expect(runtime.value.inventory("customer-alpha", "production")).rejects.toMatchObject({ code: "ARTIFACT_AUTHORITY_REJECTED" });
  });

  it("binds planner operation and generation identities to current inventory and rejects active-version downgrades", async () => {
    const runtime = manager();
    runtime.store.inventoryValue = {
      schemaVersion: 1, applicationId: request.applicationId, environment: request.environment, hostInventoryDigest: digest("7"), revision: 5,
      observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: {
        platformPlugins: {}, themeSkins: {}, hotApplications: {
          "app.sales-assistant": {
            disposition: "active", revision: 5, lastOperationId: "extension-operation-previous", lastReceiptId: "extension-receipt-previous", stateDigest: digest("9"),
            activeGeneration: { authority: "verified-bundle", version: "1.0.1", receiptId: "extension-receipt-previous", ...authority, generationId: "sales-assistant-generation-active" },
            rollbackGeneration: { authority: "verified-bundle", version: "1.5.0", receiptId: "extension-receipt-rollback", ...authority, generationId: "sales-assistant-generation-rollback" }
          }
        }
      }
    };
    const update: ExtensionChangeRequest = { ...request, operation: "update", targetVersion: "2.1.0", expectedRevision: 5, idempotencyKey: "update:app.sales-assistant:2-1-0" };
    const planned = await runtime.value.plan(update);
    expect(runtime.planner.plan).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: planned.operationId, currentGenerationId: "sales-assistant-generation-active", rollbackGenerationId: "sales-assistant-generation-rollback"
    }));

    const downgrade = manager();
    downgrade.store.inventoryValue = runtime.store.inventoryValue;
    const downgradeRequest: ExtensionChangeRequest = { ...update, targetVersion: "1.0.0+attacker", idempotencyKey: "update:app.sales-assistant:1-0-0-attacker" };
    await expect(downgrade.value.plan(downgradeRequest)).rejects.toMatchObject({ code: "PLAN_MISMATCH" });

    const reused = manager();
    reused.store.inventoryValue = runtime.store.inventoryValue;
    reused.planner.plan.mockImplementation(async (planning) => ({
      plan: { ...hotPlan, operationId: planning.operationId, operation: "update", version: "2.1.0", expectedRevision: 5, currentGenerationId: planning.currentGenerationId, targetGenerationId: "sales-assistant-generation-active" },
      sourceCommit: "a".repeat(40), generationId: "sales-assistant-generation-active"
    }));
    await expect(reused.value.plan(update)).rejects.toMatchObject({ code: "PLAN_MISMATCH" });
  });

  it("rejects an otherwise-valid authority copied to another extension owner", async () => {
    const runtime = manager();
    runtime.artifacts.stage.mockResolvedValue({ ...authority, extensionId: "app.forecast" });
    const planned = await runtime.value.plan(request);
    await expect(runtime.value.stage(planned.operationId)).rejects.toMatchObject({ code: "ARTIFACT_AUTHORITY_REJECTED" });
    expect(runtime.artifacts.reverify).not.toHaveBeenCalled();
  });

  it("rejects owner substitution before activating a previously staged generation", async () => {
    const runtime = manager();
    const planned = await runtime.value.plan(request);
    await runtime.value.stage(planned.operationId);
    runtime.store.operation = { ...runtime.store.operation!, authority: { ...authority, environment: "staging" } };
    await expect(runtime.value.activate(planned.operationId)).rejects.toMatchObject({ code: "ARTIFACT_AUTHORITY_REJECTED" });
    expect(runtime.generationRuntime.prepare).not.toHaveBeenCalled();
  });

  it("reverifies and freshly warms the retained generation before the rollback pointer can change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T09:00:30.000Z"));
    const retained = { ...authority, generationId: "sales-assistant-generation-0" };
    const rollbackRequest: ExtensionChangeRequest = {
      ...request,
      operation: "rollback",
      expectedRevision: 1,
      idempotencyKey: "rollback:app.sales-assistant:1"
    };
    const runtime = manager();
    runtime.planner.plan.mockImplementation(async (planning) => ({
      plan: { ...hotPlan, operationId: planning.operationId, operation: "rollback", expectedRevision: 1, currentGenerationId: planning.currentGenerationId, targetGenerationId: retained.generationId },
      sourceCommit: retained.sourceCommit,
      generationId: retained.generationId
    }));
    runtime.store.inventoryValue = {
      schemaVersion: 1, applicationId: request.applicationId, environment: request.environment, hostInventoryDigest: digest("7"), revision: 1,
      observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: {
        platformPlugins: {}, themeSkins: {}, hotApplications: { "app.sales-assistant": {
          disposition: "active", revision: 1, lastOperationId: "extension-operation-1", lastReceiptId: "extension-receipt-1", stateDigest: digest("9"),
          activeGeneration: { authority: "verified-bundle", version: "1.0.0", receiptId: "extension-receipt-1", ...authority },
          rollbackGeneration: { authority: "verified-bundle", version: "1.0.0", receiptId: "extension-receipt-0", ...retained }
        } }
      }
    };
    runtime.store.rollbackResult = {
      receiptId: "rollback-receipt-1", operationId: "extension-operation-1", operation: "rollback", generationId: retained.generationId,
      previousGenerationId: authority.generationId, revisionBefore: 1, revisionAfter: 2, inventoryRevision: 2,
      compatibility: { status: "compatible", windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 },
      rollback: "available", occurredAt: "2026-08-29T09:00:00.000Z"
    };
    const planned = await runtime.value.plan(rollbackRequest);
    await expect(runtime.value.rollback(planned.operationId)).resolves.toMatchObject({ generationId: retained.generationId });
    expect(runtime.artifacts.reverify).toHaveBeenCalledWith(retained, expect.objectContaining({ extensionId: retained.extensionId }));
    expect(runtime.generationRuntime.prepare).toHaveBeenCalledWith(expect.objectContaining({ authority: retained }));

    runtime.artifacts.reverify.mockResolvedValueOnce(false);
    runtime.store.operation = { ...runtime.store.operation!, phase: "planning" };
    await expect(runtime.value.rollback(planned.operationId)).rejects.toMatchObject({ code: "ARTIFACT_AUTHORITY_REJECTED" });
    expect(runtime.store.rollbackResult).toBeDefined();
  });

  it("rejects stale or mixed retained readiness before rollback pointer mutation", async () => {
    const runtime = manager();
    const retained = { ...authority, generationId: "sales-assistant-generation-0" };
    runtime.store.operation = {
      operationId: "extension-operation-rollback", request: { ...request, operation: "rollback", expectedRevision: 1 }, requestDigest: digest("1"),
      authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("2") }, phase: "planning", leaseToken: "lease-rollback",
      plan: { executionClass: "live-generation", operationId: "extension-operation-rollback", plan: { ...hotPlan, operation: "rollback", expectedRevision: 1, targetGenerationId: retained.generationId }, sourceCommit: retained.sourceCommit, generationId: retained.generationId }
    };
    runtime.store.inventoryValue = {
      schemaVersion: 1, applicationId: request.applicationId, environment: request.environment, hostInventoryDigest: digest("7"), revision: 1,
      observedAt: "2026-08-29T09:00:00.000Z", stateDigest: digest("8"), extensions: {
        platformPlugins: {}, themeSkins: {}, hotApplications: { "app.sales-assistant": {
          disposition: "active", revision: 1, lastOperationId: "extension-operation-1", lastReceiptId: "extension-receipt-1", stateDigest: digest("9"),
          activeGeneration: { authority: "verified-bundle", version: "1.0.0", receiptId: "extension-receipt-1", ...authority },
          rollbackGeneration: { authority: "verified-bundle", version: "1.0.0", receiptId: "extension-receipt-0", ...retained }
        } }
      }
    };
    runtime.generationRuntime.prepare.mockResolvedValueOnce({
      authority: retained, version: "1.0.0",
      readiness: { generationId: retained.generationId, serverGenerationId: retained.generationId, uiGenerationId: authority.generationId, storageGenerationId: retained.generationId, leaseToken: "readiness:lease-1", readyAt: "2026-08-29T09:00:00.000Z", expiresAt: "2026-08-30T09:00:00.000Z" },
      compatibility: { status: "compatible", windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 }, metadata: {}, settings: {}, storageSchemaVersions: {}
    });
    await expect(runtime.value.rollback("extension-operation-rollback")).rejects.toMatchObject({ code: "ARTIFACT_AUTHORITY_REJECTED" });
    expect(runtime.store.rollbackResult).toBeUndefined();
  });

  it("exposes safe progress, validation, disable, and uninstall operations", async () => {
    const runtime = manager();
    const planned = await runtime.value.plan(request);
    await runtime.value.stage(planned.operationId);
    await expect(runtime.value.validate(planned.operationId)).resolves.toMatchObject({ valid: true, executionClass: "live-generation", checks: ["verified-bundle", "generation-authority"] });
    const progress = await runtime.value.operation(planned.operationId);
    expect(progress).toMatchObject({ operationId: planned.operationId, phase: "staged", actor: { kind: "trusted-automation" } });
    expect(progress).not.toHaveProperty("leaseToken");

    runtime.store.operation = { ...runtime.store.operation!, request: { ...request, operation: "disable" }, phase: "planning" };
    await expect(runtime.value.disable(planned.operationId)).resolves.toMatchObject({ disposition: "disabled" });
    runtime.store.operation = { ...runtime.store.operation!, request: { ...request, operation: "uninstall" }, phase: "planning" };
    await expect(runtime.value.uninstall(planned.operationId)).resolves.toMatchObject({ disposition: "removed" });
  });

  it("returns persisted receipts for every completed mutation without resuming its lease or side effects", async () => {
    const cases = [
      { operation: "install" as const, receipt: { receiptId: "install-receipt", operation: "install" as const, generationId: authority.generationId, revisionBefore: 0, revisionAfter: 1, inventoryRevision: 1, compatibility: { status: "compatible" as const, windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 }, rollback: "unavailable" as const, occurredAt: "2026-08-29T09:00:00.000Z" } },
      { operation: "update" as const, receipt: { receiptId: "update-receipt", operation: "update" as const, generationId: authority.generationId, revisionBefore: 1, revisionAfter: 2, inventoryRevision: 2, compatibility: { status: "compatible" as const, windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 }, rollback: "available" as const, occurredAt: "2026-08-29T09:00:00.000Z" } },
      { operation: "rollback" as const, receipt: { receiptId: "rollback-receipt", operation: "rollback" as const, generationId: "sales-assistant-generation-0", revisionBefore: 2, revisionAfter: 3, inventoryRevision: 3, compatibility: { status: "compatible" as const, windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 }, rollback: "available" as const, occurredAt: "2026-08-29T09:00:00.000Z" } },
      { operation: "disable" as const, receipt: { receiptId: "disable-receipt", operation: "disable" as const, disposition: "disabled" as const, revisionBefore: 3, revisionAfter: 4, inventoryRevision: 4, occurredAt: "2026-08-29T09:00:00.000Z" } },
      { operation: "uninstall" as const, receipt: { receiptId: "uninstall-receipt", operation: "uninstall" as const, disposition: "removed" as const, revisionBefore: 4, revisionAfter: 5, inventoryRevision: 5, occurredAt: "2026-08-29T09:00:00.000Z" } }
    ];
    for (const entry of cases) {
      const runtime = manager();
      const completedRequest = { ...request, operation: entry.operation, idempotencyKey: `${entry.operation}:app.sales-assistant:lost-response` };
      runtime.store.operation = {
        operationId: "extension-operation-1", request: completedRequest, requestDigest: digest("1"),
        authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("2") },
        phase: "completed", leaseToken: "completed-lease", plan: { executionClass: "live-generation", operationId: "extension-operation-1", plan: { ...hotPlan, operationId: "extension-operation-1", operation: entry.operation, targetGenerationId: authority.generationId }, sourceCommit: authority.sourceCommit, generationId: authority.generationId },
        result: { ...entry.receipt, operationId: "extension-operation-1" }
      };
      if (entry.operation !== "rollback") await expect(runtime.value.plan(completedRequest)).resolves.toEqual(runtime.store.operation.plan);
      const replay = entry.operation === "rollback" ? runtime.value.rollback("extension-operation-1")
        : entry.operation === "disable" ? runtime.value.disable("extension-operation-1")
          : entry.operation === "uninstall" ? runtime.value.uninstall("extension-operation-1") : runtime.value.activate("extension-operation-1");
      await expect(replay).resolves.toEqual(runtime.store.operation.result);
      expect(runtime.store.resumeCount).toBe(0);
      expect(runtime.planner.plan).not.toHaveBeenCalled();
    }
  });

  it("rejects authorization before policy validation or operation claiming", async () => {
    const runtime = manager();
    const authorizer = { authorize: vi.fn(async () => { throw new Error("OPERATION_FORBIDDEN"); }) };
    const claimOperation = vi.spyOn(runtime.store, "claimOperation");
    const blocked = new PluginManager(
      "phase-9-worker",
      authorizer,
      runtime.planner,
      runtime.store,
      runtime.artifacts,
      runtime.staticChanges,
      runtime.deployments,
      runtime.generationRuntime,
      runtime.clock
    );
    await expect(blocked.plan(request)).rejects.toThrow("OPERATION_FORBIDDEN");
    expect(authorizer.authorize).toHaveBeenCalledOnce();
    expect(runtime.planner.validate).not.toHaveBeenCalled();
    expect(runtime.planner.plan).not.toHaveBeenCalled();
    expect(claimOperation).not.toHaveBeenCalled();
    expect(runtime.store.operation).toBeUndefined();
    expect(runtime.store.transitions).toEqual([]);
    expect(runtime.store.staticReceipts).toEqual([]);
  });
});
