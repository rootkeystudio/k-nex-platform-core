import { describe, expect, it, vi } from "vitest";

import {
  DurableDynamicArtifactPipeline,
  DurableDynamicGenerationRuntime,
  ReferenceHotApplicationGenerationWarmer,
  type DurableDynamicArtifact,
  type ExtensionChangeRequest,
  type PluginManagerPlan
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const request: ExtensionChangeRequest = {
  applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id: "app.sales-assistant" },
  operation: "install", targetVersion: "1.0.0", expectedRevision: 0, idempotencyKey: "install:app.sales-assistant:1", correlationId: "extension-correlation-1"
};
const authority = {
  applicationId: request.applicationId, environment: request.environment, deliveryClass: "hot-application" as const, extensionId: request.extension.id,
  generationId: "sales-assistant-generation-1", sourceCommit: "a".repeat(40), artifactDigest: digest("a"), manifestDigest: digest("b"),
  catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e")
};
const plan: Extract<PluginManagerPlan, { executionClass: "live-generation" }> = {
  executionClass: "live-generation", operationId: "operation-1", sourceCommit: authority.sourceCommit, generationId: authority.generationId,
  plan: {
    schemaVersion: 1, planId: "sales-plan-1", operationId: "operation-1", operation: "install", version: "1.0.0", artifactDigest: authority.artifactDigest,
    expectedRevision: 0, targetGenerationId: authority.generationId, approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 },
    deliveryClass: "hot-application", id: request.extension.id, availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [],
    resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
  }
};
const artifact: DurableDynamicArtifact = {
  authority, version: "1.0.0",
  compatibility: { status: "compatible", windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("f"), dataRevision: 1 },
  metadata: { navigation: "sales" }, settings: { locale: "en" }, storageSchemaVersions: { "sales.records": 1 }
};

describe("durable dynamic generation adapters", () => {
  it("joins runner, remote UI, storage, and fixed surfaces into one generation-bound health lease", async () => {
    const prepared: string[] = [];
    const warmer = new ReferenceHotApplicationGenerationWarmer({
      runner: { prepareServer: async () => { prepared.push("runner"); } },
      remoteUi: { prepareRemoteUi: async () => { prepared.push("remote-ui"); } },
      storage: { prepareStorage: async () => { prepared.push("storage"); } },
      surfaces: { prepareFixedSurfaces: async () => { prepared.push("surfaces"); } },
      clock: { now: () => new Date("2026-08-29T09:00:00.000Z") }
    });

    const readiness = await warmer.warm({ request, plan, artifact });

    expect(prepared).toEqual(["runner", "remote-ui", "storage", "surfaces"]);
    expect(readiness).toMatchObject({ generationId: authority.generationId, serverGenerationId: authority.generationId, uiGenerationId: authority.generationId, storageGenerationId: authority.generationId, readyAt: "2026-08-29T09:00:00.000Z" });
    expect(Date.parse(readiness.expiresAt)).toBe(Date.parse(readiness.readyAt) + 60_000);
  });

  it("stages and warms only the durable artifact bound to the plan", async () => {
    const artifacts = { resolve: vi.fn(async () => artifact) };
    const warmer = { warm: vi.fn(async () => ({ generationId: authority.generationId, serverGenerationId: authority.generationId, uiGenerationId: authority.generationId, storageGenerationId: authority.generationId, leaseToken: "readiness:lease-1", readyAt: "2026-08-29T09:00:00.000Z", expiresAt: "2026-08-29T09:01:00.000Z" })) };
    const pipeline = new DurableDynamicArtifactPipeline(artifacts);
    const runtime = new DurableDynamicGenerationRuntime(artifacts, warmer);
    const owner = { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId };

    await expect(pipeline.stage({ plan: plan.plan, owner })).resolves.toEqual(authority);
    await expect(runtime.prepare({ request, plan, authority })).resolves.toMatchObject({ authority, version: "1.0.0", metadata: artifact.metadata });
    expect(warmer.warm).toHaveBeenCalledWith({ request, plan, artifact });
  });

  it("rejects a durable record whose immutable artifact binding changed", async () => {
    const artifacts = { resolve: vi.fn(async () => ({ ...artifact, authority: { ...authority, artifactDigest: digest("9") } })) };
    const pipeline = new DurableDynamicArtifactPipeline(artifacts);
    await expect(pipeline.stage({ plan: plan.plan, owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId } })).rejects.toThrow(/unavailable|belongs/i);
  });
});
