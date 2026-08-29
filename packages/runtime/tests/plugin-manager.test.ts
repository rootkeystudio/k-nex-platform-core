import { describe, expect, it, vi } from "vitest";

import type { ExtensionInstallPlan, RuntimeExtensionInventory } from "@k-nex/contracts";
import {
  PluginManager,
  TrustedAutomationOperationAuthorizer,
  type ClaimOperationResult,
  type ExtensionChangeRequest,
  type PluginManagerPlan,
  type RuntimeExtensionOperation,
  type RuntimeExtensionStore,
  type VerifiedGenerationAuthority
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

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
}

function manager(store = new MemoryStore(), reverify = true) {
  const planner = { plan: vi.fn(async () => ({ plan: hotPlan, sourceCommit: "a".repeat(40), generationId: "sales-assistant-generation-1" })) };
  const artifacts = { stage: vi.fn(async () => authority), reverify: vi.fn(async () => reverify) };
  const staticChanges = { request: vi.fn() };
  const deployments = { request: vi.fn(), reverify: vi.fn(async () => reverify) };
  return { value: new PluginManager("phase-9-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), planner, store, artifacts, staticChanges, deployments), store, planner, artifacts, staticChanges, deployments };
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

  it("delegates Platform Plugin plans to source and trusted-build authorities", async () => {
    const runtime = manager();
    const platformRequest: ExtensionChangeRequest = { ...request, extension: { deliveryClass: "platform-plugin", id: "module.sales" }, idempotencyKey: "install:module.sales:1" };
    const platformPlan: ExtensionInstallPlan = {
      schemaVersion: 1, planId: hotPlan.planId, operationId: hotPlan.operationId, operation: "install", version: "1.0.0",
      artifactDigest: digest("a"), expectedRevision: 0, targetGenerationId: "customer-alpha-green-1", approvalRequired: false,
      rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] }
    };
    runtime.planner.plan.mockResolvedValue({ plan: platformPlan, sourceCommit: "b".repeat(40), generationId: "customer-alpha-green-1" });
    runtime.staticChanges.request.mockResolvedValue({ status: "source-change-ready", planDigest: digest("f"), targetSourceCommit: "b".repeat(40) });
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
