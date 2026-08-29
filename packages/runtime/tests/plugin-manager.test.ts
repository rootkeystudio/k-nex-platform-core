import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

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
  generationId: "sales-assistant-generation-1",
  sourceCommit: "a".repeat(40),
  artifactDigest: digest("a"),
  manifestDigest: digest("b"),
  catalogDigest: digest("c"),
  provenanceDigest: digest("d"),
  sbomDigest: digest("e")
};

class MemoryStore implements RuntimeExtensionStore {
  operation?: RuntimeExtensionOperation;
  readonly transitions: string[] = [];
  inventoryValue!: RuntimeExtensionInventory;

  async claimOperation(input: Parameters<RuntimeExtensionStore["claimOperation"]>[0]): Promise<ClaimOperationResult> {
    if (this.operation) return { status: "replay", operation: this.operation };
    this.operation = { operationId: "extension-operation-1", request: input.request, requestDigest: input.requestDigest, authorization: input.authorization, phase: "planning", leaseToken: "lease-1" };
    return { status: "claimed", operation: this.operation };
  }

  async resumeOperation(): Promise<RuntimeExtensionOperation> {
    if (!this.operation) throw new Error("missing operation");
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
  async rollbackGeneration(): Promise<ExtensionActivationReceipt> { throw new Error("unused"); }
  async observeActiveGeneration() { return { revision: 0, inventoryRevision: 0 }; }
  async acquireGenerationLease() { return "lease-00000000-0000-4000-8000-000000000000"; }
  async releaseGenerationLease() {}
  async liveGenerationLeaseCount() { return 0; }
}

function manager(store = new MemoryStore(), reverify = true) {
  const planner = { plan: vi.fn(async () => ({ plan: hotPlan, sourceCommit: "a".repeat(40), generationId: "sales-assistant-generation-1" })) };
  const artifacts = { stage: vi.fn(async () => authority), reverify: vi.fn(async () => reverify) };
  const staticChanges = { request: vi.fn() };
  const deployments = { request: vi.fn(), reverify: vi.fn(async () => reverify) };
  const generationRuntime = { prepare: vi.fn(async () => ({
    authority, version: "1.0.0",
    readiness: { generationId: authority.generationId, serverGenerationId: authority.generationId, uiGenerationId: authority.generationId, storageGenerationId: authority.generationId, leaseToken: "readiness:lease-1", readyAt: "2026-08-29T09:00:00.000Z", expiresAt: "2026-08-29T09:01:00.000Z" },
    compatibility: { status: "compatible" as const, windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("6"), dataRevision: 1 },
    metadata: {}, settings: {}, storageSchemaVersions: {}
  })) };
  return { value: new PluginManager("phase-9-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, store, artifacts, staticChanges, deployments, generationRuntime), store, planner, artifacts, staticChanges, deployments, generationRuntime };
}

describe("PluginManager", () => {
  it("plans and stages a verified live generation with resumable checkpoints", async () => {
    const runtime = manager();
    const planned = await runtime.value.plan(request);
    expect(planned.executionClass).toBe("live-generation");
    await expect(runtime.value.stage(planned.operationId)).resolves.toEqual(authority);
    expect(runtime.store.transitions).toEqual(["planning->downloading", "downloading->verified", "verified->staged"]);
    expect(runtime.artifacts.reverify).toHaveBeenCalledWith(authority);
    await expect(runtime.value.plan(request)).resolves.toBe(planned);
    expect(runtime.planner.plan).toHaveBeenCalledTimes(1);
    runtime.store.operation = { ...runtime.store.operation!, phase: "failed" };
    await expect(runtime.value.stage(planned.operationId)).rejects.toMatchObject({ code: "INVALID_STATE" });
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
    runtime.planner.plan.mockResolvedValue({ plan: platformPlan, sourceCommit: "b".repeat(40), generationId: "customer-alpha-green-1" });
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
    theme.planner.plan.mockResolvedValue({ plan: { ...platformPlan, id: "theme.minimal" }, sourceCommit: "b".repeat(40), generationId: "customer-alpha-green-1" });
    theme.staticChanges.request.mockResolvedValue({ status: "source-change-ready", planDigest: digest("f"), targetSourceCommit: "b".repeat(40), change: staticChange });
    theme.deployments.request.mockResolvedValue({ status: "build-requested", buildRequestDigest: digest("9"), sourceCommit: "b".repeat(40) });
    await expect(theme.value.plan(themeRequest)).resolves.toMatchObject({ executionClass: "static-release" });
    expect(theme.artifacts.stage).not.toHaveBeenCalled();
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
});
