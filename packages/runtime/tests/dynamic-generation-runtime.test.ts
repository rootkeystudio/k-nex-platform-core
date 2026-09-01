import { describe, expect, it, vi } from "vitest";

import {
  AuthoritativeHotApplicationRuntime,
  createTrustedAuthorizationSession,
  createTrustedHotApplicationInvocationContext,
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
    deliveryClass: "hot-application", id: request.extension.id, availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [{ kind: "records", required: true, reason: "Read verified sales records.", operations: ["query"], resources: [{ id: "sales.records", version: 1 }] }],
    resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
  }
};
const artifact: DurableDynamicArtifact = {
  authority, version: "1.0.0",
  hotApplicationManifest: {
    schemaVersion: 1, deliveryClass: "hot-application", id: request.extension.id, displayName: "Sales assistant", version: "1.0.0", runtimeAbi: "1.0.0",
    entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] }, capabilities: plan.plan.requiredCapabilities, permissions: [], policyBindings: [], resourceBudget: plan.plan.resourceBudget,
    settings: [], screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
  },
  capabilities: plan.plan.requiredCapabilities,
  resourceBudget: plan.plan.resourceBudget,
  compatibility: { status: "compatible", windowId: "rollback-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("f"), dataRevision: 1 },
  metadata: { navigation: "sales" }, settings: { locale: "en" }, storageSchemaVersions: { "sales.records": 1 }
};
const productionProfile = {
  schemaVersion: 1,
  scope: "production",
  profile: "os-container-per-generation-v1",
  isolation: "os-container-per-generation",
  workloadIdentity: "unique-non-root",
  namespaces: { pid: "separate", mount: "separate", user: "separate", network: "separate" },
  filesystem: { root: "read-only", code: "read-only", temporaryStorage: "bounded-tmpfs", hostMounts: "none" },
  privileges: { linuxCapabilities: "dropped", noNewPrivileges: true, dockerSocket: "none", databaseCredential: "none", hostSecrets: "none" },
  policy: { syscallProfile: "sha256:9e1b305927408a95032982bd0c5713e372cd2a3c205febc954df62e8a0de3ef8", macProfile: "sha256:258d1e7e322b0dd4d9394ddc97e356e191076a89609cd07395fe5ac9656a1814", rawEgress: "denied", inboundListener: "denied", hostNetworkAdapter: "allowlisted-proxy-only" },
  limits: { cpuMilliCores: 2_000, memoryMiB: 512, processes: 256, openFiles: 4_096, tempBytes: 268_435_456 },
  rpc: { transport: "structured-host-rpc-only", schemaValidated: true, shortLivedGenerationActorIdentity: true }
} as const;
const manifestCapabilities = plan.plan.requiredCapabilities;
const capabilityAuthorization = { allowed: true, authorizationRevision: 1, lifecycleRevision: 1 } as const;

function activeGeneration(authorityForGeneration = authority) {
  return { authority: "verified-bundle" as const, ...authorityForGeneration, version: "1.0.0", receiptId: "receipt-runtime-1" };
}

function inventory(active: ReturnType<typeof activeGeneration>) {
  return { extensions: { hotApplications: { [authority.extensionId]: { disposition: "active" as const, activeGeneration: active } } } };
}

function trafficRuntime(store: any, runner: any, tokens: any, productionArtifact: DurableDynamicArtifact) {
  return new AuthoritativeHotApplicationRuntime(store, { resolve: vi.fn(async ({ generationId }: { generationId: string }) => generationId === productionArtifact.authority.generationId ? productionArtifact : undefined) }, tokens, { isolationProfile: productionProfile, ...runner }, {
    authorize: vi.fn(async () => capabilityAuthorization)
  }, {
    applicationId: authority.applicationId, environment: authority.environment, appId: authority.extensionId
  }, "runtime-traffic-gateway");
}

function context(correlationId: string) {
  return createTrustedHotApplicationInvocationContext({ session: createTrustedAuthorizationSession({
    schemaVersion: 1, applicationId: authority.applicationId, environment: authority.environment, correlationId,
    principal: { kind: "user", id: "user:one" }, effectiveActor: { kind: "user", id: "user:one" }
  }), revision: { authorizationRevision: 1, lifecycleRevision: 1 } });
}

describe("durable dynamic generation adapters", () => {
  it("joins runner, remote UI, storage, and fixed surfaces into one generation-bound health lease", async () => {
    const prepared: string[] = [];
    const prepareServer = vi.fn(async () => { prepared.push("runner"); });
    const prepareRemoteUi = vi.fn(async () => { prepared.push("remote-ui"); });
    const prepareStorage = vi.fn(async () => { prepared.push("storage"); });
    const prepareFixedSurfaces = vi.fn(async () => { prepared.push("surfaces"); });
    const warmer = new ReferenceHotApplicationGenerationWarmer({
      runner: { prepareServer }, remoteUi: { prepareRemoteUi }, storage: { prepareStorage }, surfaces: { prepareFixedSurfaces },
      clock: { now: () => new Date("2026-08-29T09:00:00.000Z") }
    });

    const readiness = await warmer.warm({ request, plan, artifact });

    expect(prepared).toEqual(["runner", "remote-ui", "storage", "surfaces"]);
    for (const dependency of [prepareServer, prepareRemoteUi, prepareStorage, prepareFixedSurfaces]) {
      expect(dependency).toHaveBeenCalledWith(expect.objectContaining({ manifest: artifact.hotApplicationManifest }));
    }
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

  it("rejects verified declarations that differ from the approved plan", async () => {
    const artifacts = { resolve: vi.fn(async () => ({ ...artifact, hotApplicationManifest: { ...artifact.hotApplicationManifest!, capabilities: [] } })) };
    const pipeline = new DurableDynamicArtifactPipeline(artifacts);
    await expect(pipeline.stage({ plan: plan.plan, owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId } })).rejects.toThrow(/declarations/i);
  });

  it("keeps a positive UI-admitted G1 invocation pinned to G1", async () => {
    const active = activeGeneration();
    const productionArtifact: DurableDynamicArtifact = {
      ...artifact
    };
    const enforcedProfile = { ...productionProfile, limits: { cpuMilliCores: 300, memoryMiB: 64, processes: 3, openFiles: 32, tempBytes: 65_536 } } as const;
    const leases: string[] = [];
    const store = {
      inventory: vi.fn(async () => inventory(active)),
      acquireGenerationLease: vi.fn(async ({ generationId }: { generationId: string }) => {
        expect(generationId).toBe(authority.generationId);
        return "lease-00000000-0000-4000-8000-000000000000";
      }),
      releaseGenerationLease: vi.fn(async (leaseId: string) => { leases.push(leaseId); })
    };
    const tokens = { issue: vi.fn(() => "capability-token") };
    const runner = { isolationProfile: enforcedProfile, invoke: vi.fn(async (invocation) => ({ generationId: invocation.generationId, artifactDigest: invocation.artifactDigest })) };
    const runtime = trafficRuntime(store, runner, tokens, productionArtifact);

    await expect(runtime.invoke({
      input: { marker: "traffic" },
      context: context("traffic-correlation-1"),
      expectedGeneration: { generationId: authority.generationId, artifactDigest: authority.artifactDigest }
    })).resolves.toEqual({ generationId: authority.generationId, artifactDigest: authority.artifactDigest });

    expect(tokens.issue).toHaveBeenCalledWith(expect.objectContaining({ generationId: authority.generationId, grants: manifestCapabilities, ttlMs: 6_000, drainLeaseId: expect.stringMatching(/^lease-/u) }));
    expect(runner.invoke).toHaveBeenCalledWith(expect.objectContaining({ generationId: authority.generationId, artifactDigest: authority.artifactDigest, serverEntrypoint: "server/main.mjs", drainLeaseId: "lease-00000000-0000-4000-8000-000000000000", limits: {
      cpuMilliCores: 300, memoryMiB: 64, processes: 3, openFiles: 32, tempBytes: 65_536,
      wallTimeMs: 5_000, inputBytes: 65_536, outputBytes: 131_072, logBytes: 65_536, maxConcurrency: 4
    } }));
    expect(leases).toEqual(["lease-00000000-0000-4000-8000-000000000000"]);
  });

  it("does not mint authorization authority from stale or mismatched durable artifacts", async () => {
    const store = {
      inventory: vi.fn(async () => inventory(activeGeneration())),
      acquireGenerationLease: vi.fn(),
      releaseGenerationLease: vi.fn()
    };
    const mismatches: DurableDynamicArtifact[] = [
      { ...artifact, authority: { ...authority, artifactDigest: digest("9") } },
      { ...artifact, authority: { ...authority, applicationId: "customer-beta" } },
      { ...artifact, authority: { ...authority, generationId: "sales-assistant-generation-2" } }
    ];
    for (const mismatch of mismatches) {
      const runtime = trafficRuntime(store, { invoke: vi.fn() }, { issue: vi.fn() }, mismatch);
      await expect(runtime.createAuthorizationSource()).rejects.toThrow(/matching verified Hot Application bytes/u);
    }
  });

  it("reselects G2 once when an unpinned lease acquisition observes a pointer switch", async () => {
    const nextAuthority = { ...authority, generationId: "sales-assistant-generation-2", artifactDigest: digest("9"), manifestDigest: digest("8"), catalogDigest: digest("7"), provenanceDigest: digest("6"), sbomDigest: digest("5") };
    const nextArtifact: DurableDynamicArtifact = { ...artifact, authority: nextAuthority };
    let current = inventory(activeGeneration());
    const store = {
      inventory: vi.fn(async () => current),
      acquireGenerationLease: vi.fn(async ({ generationId }: { generationId: string }) => {
        if (generationId === authority.generationId) {
          current = inventory(activeGeneration(nextAuthority));
          throw new Error("pointer changed");
        }
        return "lease-00000000-0000-4000-8000-000000000000";
      }),
      releaseGenerationLease: vi.fn(async () => {})
    };
    const artifacts = { resolve: vi.fn(async ({ generationId }: { generationId: string }) => generationId === authority.generationId ? artifact : nextArtifact) };
    const runner = { isolationProfile: productionProfile, invoke: vi.fn(async (input) => input.generationId) };
    const runtime = new AuthoritativeHotApplicationRuntime(store as any, artifacts, { issue: vi.fn(() => "capability-token") } as any, runner, { authorize: vi.fn(async () => capabilityAuthorization) }, {
      applicationId: authority.applicationId, environment: authority.environment, appId: authority.extensionId
    }, "runtime-traffic-gateway");

    await expect(runtime.invoke({ input: {}, context: context("traffic-correlation-unpinned") })).resolves.toBe(nextAuthority.generationId);
    expect(store.acquireGenerationLease).toHaveBeenNthCalledWith(1, expect.objectContaining({ generationId: authority.generationId }));
    expect(store.acquireGenerationLease).toHaveBeenNthCalledWith(2, expect.objectContaining({ generationId: nextAuthority.generationId }));
    expect(artifacts.resolve).toHaveBeenNthCalledWith(1, expect.objectContaining({ generationId: authority.generationId }));
    expect(artifacts.resolve).toHaveBeenNthCalledWith(2, expect.objectContaining({ generationId: nextAuthority.generationId }));
    expect(runner.invoke).toHaveBeenCalledOnce();
    expect(runner.invoke).toHaveBeenCalledWith(expect.objectContaining({ generationId: nextAuthority.generationId }));
  });

  it("propagates an unpinned same-generation lease failure without retrying", async () => {
    const leaseError = new Error("database unavailable");
    const store = {
      inventory: vi.fn(async () => inventory(activeGeneration())),
      acquireGenerationLease: vi.fn(async () => { throw leaseError; }),
      releaseGenerationLease: vi.fn()
    };
    const runner = { invoke: vi.fn() };
    const runtime = trafficRuntime(store, runner, { issue: vi.fn() }, artifact);

    await expect(runtime.invoke({ input: {}, context: context("traffic-correlation-2") })).rejects.toBe(leaseError);
    expect(store.acquireGenerationLease).toHaveBeenCalledTimes(1);
    expect(runner.invoke).not.toHaveBeenCalled();
  });

  it("denies a UI-admitted G1 request when cutover reaches G2 before lease acquisition", async () => {
    const nextAuthority = { ...authority, generationId: "sales-assistant-generation-2", artifactDigest: digest("9"), manifestDigest: digest("8"), catalogDigest: digest("7"), provenanceDigest: digest("6"), sbomDigest: digest("5") };
    const nextArtifact: DurableDynamicArtifact = { ...artifact, authority: nextAuthority };
    let current = inventory(activeGeneration());
    const next = inventory(activeGeneration(nextAuthority));
    const store = {
      inventory: vi.fn(async () => current),
      acquireGenerationLease: vi.fn(async () => { current = next; throw new Error("pointer changed"); }),
      releaseGenerationLease: vi.fn(async () => {})
    };
    const artifacts = { resolve: vi.fn(async ({ generationId }: { generationId: string }) => generationId === authority.generationId
      ? artifact : nextArtifact) };
    const runner = { isolationProfile: productionProfile, invoke: vi.fn(async (input) => input.generationId) };
    const runtime = new AuthoritativeHotApplicationRuntime(store as any, artifacts, { issue: vi.fn(() => "capability-token") } as any, runner, { authorize: vi.fn(async () => capabilityAuthorization) }, {
      applicationId: authority.applicationId, environment: authority.environment, appId: authority.extensionId
    }, "runtime-traffic-gateway");

    await expect(runtime.invoke({ input: {}, context: context("traffic-correlation-3"), expectedGeneration: { generationId: authority.generationId, artifactDigest: authority.artifactDigest } })).rejects.toThrow("changed after UI admission");
    expect(store.acquireGenerationLease).toHaveBeenCalledOnce();
    expect(store.acquireGenerationLease).toHaveBeenCalledWith(expect.objectContaining({ generationId: authority.generationId }));
    expect(runner.invoke).not.toHaveBeenCalled();
  });

  it("releases the generation lease when runner execution fails", async () => {
    const runnerFailure = new Error("runner failed");
    const released: string[] = [];
    const store = {
      inventory: vi.fn(async () => inventory(activeGeneration())),
      acquireGenerationLease: vi.fn(async () => "lease-00000000-0000-4000-8000-000000000000"),
      releaseGenerationLease: vi.fn(async (leaseId: string) => { released.push(leaseId); })
    };
    const runtime = trafficRuntime(store, { invoke: vi.fn(async () => { throw runnerFailure; }) }, { issue: vi.fn(() => "capability-token") }, artifact);

    await expect(runtime.invoke({ input: {}, context: context("traffic-correlation-4"), expectedGeneration: { generationId: authority.generationId, artifactDigest: authority.artifactDigest } })).rejects.toBe(runnerFailure);
    expect(released).toEqual(["lease-00000000-0000-4000-8000-000000000000"]);
  });

  it("rejects raw or cloned invocation contexts before capability or runner work", async () => {
    const store = { inventory: vi.fn(), acquireGenerationLease: vi.fn(), releaseGenerationLease: vi.fn() };
    const runtime = trafficRuntime(store, { invoke: vi.fn() }, { issue: vi.fn() }, artifact);

    await expect(runtime.invoke({ input: {}, context: {} as never })).rejects.toThrow(/not trusted/u);
    await expect(runtime.invoke({ input: {}, context: structuredClone(context("traffic-correlation-cloned")) })).rejects.toThrow(/not trusted/u);
    expect(store.inventory).not.toHaveBeenCalled();
  });

  it("intersects every declared grant before token issue, including jobs.schedule", async () => {
    const jobs = { kind: "jobs" as const, required: false, reason: "Schedule follow-up.", operations: ["schedule"] as const, scheduleIds: ["sales.follow-up"] };
    const constrained: DurableDynamicArtifact = {
      ...artifact,
      hotApplicationManifest: { ...artifact.hotApplicationManifest!, capabilities: [...artifact.hotApplicationManifest!.capabilities, jobs] }
    };
    const store = {
      inventory: vi.fn(async () => inventory(activeGeneration())),
      acquireGenerationLease: vi.fn(async () => "lease-00000000-0000-4000-8000-000000000000"),
      releaseGenerationLease: vi.fn(async () => {})
    };
    const tokens = { issue: vi.fn(() => "capability-token") };
    const capabilities = { authorize: vi.fn(async ({ grant }: { grant: { kind: string } }) => ({ ...capabilityAuthorization, allowed: grant.kind !== "jobs" })) };
    const runner = { isolationProfile: productionProfile, invoke: vi.fn(async () => "ok") };
    const runtime = new AuthoritativeHotApplicationRuntime(store as never, { resolve: vi.fn(async () => constrained) } as never, tokens as never, runner, capabilities, {
      applicationId: authority.applicationId, environment: authority.environment, appId: authority.extensionId
    }, "runtime-traffic-gateway");

    await expect(runtime.invoke({ input: {}, context: context("traffic-capability-intersection") })).resolves.toBe("ok");
    expect(capabilities.authorize).toHaveBeenCalledWith(expect.objectContaining({ grant: jobs }));
    expect(tokens.issue).toHaveBeenCalledWith(expect.objectContaining({ grants: manifestCapabilities }));
  });

  it("fails closed when current capability decisions do not match the traffic boundary revision", async () => {
    const store = {
      inventory: vi.fn(async () => inventory(activeGeneration())),
      acquireGenerationLease: vi.fn(async () => "lease-00000000-0000-4000-8000-000000000000"),
      releaseGenerationLease: vi.fn(async () => {})
    };
    const tokens = { issue: vi.fn(() => "capability-token") };
    const runner = { isolationProfile: productionProfile, invoke: vi.fn(async () => "unexpected") };
    const runtime = new AuthoritativeHotApplicationRuntime(store as never, { resolve: vi.fn(async () => artifact) } as never, tokens as never, runner, {
      authorize: vi.fn(async () => ({ allowed: true, authorizationRevision: 2, lifecycleRevision: 1 }))
    }, {
      applicationId: authority.applicationId, environment: authority.environment, appId: authority.extensionId
    }, "runtime-traffic-gateway");

    await expect(runtime.invoke({ input: {}, context: context("traffic-revision-mismatch") })).rejects.toThrow(/changed while minting/u);
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(runner.invoke).not.toHaveBeenCalled();
  });
});
