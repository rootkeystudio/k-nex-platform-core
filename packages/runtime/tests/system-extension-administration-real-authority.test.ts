import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision, AuthorizationState, ExtensionInstallPlan, RuntimeExtensionInventory } from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { CurrentAuthorityOperationAuthorizer } from "../src/current-authority-operation-authorizer.js";
import { createTrustedAuthorizationSession, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { ExtensionOperatorApi } from "../src/extension-operator-api.js";
import {
  PluginManager,
  type ClaimOperationResult,
  type ExtensionChangeRequest,
  type ExtensionPlanningRequest,
  type PluginManagerPlan,
  type RuntimeExtensionOperation,
  type RuntimeExtensionStore
} from "../src/plugin-manager.js";
import { SystemExtensionAdministrationService } from "../src/system-extension-administration.js";

const expected = Object.freeze({
  applicationId: "customer-alpha",
  environment: "production",
  authorizationRevision: 4,
  lifecycleRevision: 7,
  extensionRevision: 0
});
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const runnerIsolation = JSON.parse(readFileSync(new URL("../../../fixtures/extensions/valid/runner-isolation-profile.json", import.meta.url), "utf8"));
const remoteUiIsolation = JSON.parse(readFileSync(new URL("../../../fixtures/extensions/valid/remote-ui-isolation-profile.json", import.meta.url), "utf8"));

interface BrowserContext {
  readonly name: string;
  readonly session: TrustedAuthorizationSession;
  readonly actor: Readonly<{ readonly kind: "actor"; readonly id: string; readonly approvalId: string }>;
}

function inventory(): RuntimeExtensionInventory {
  return {
    schemaVersion: 1,
    applicationId: expected.applicationId,
    environment: expected.environment,
    hostInventoryDigest: digest("a"),
    revision: expected.extensionRevision,
    observedAt: "2026-09-01T00:00:00.000Z",
    stateDigest: digest("b"),
    extensions: { hotApplications: {}, platformPlugins: {}, themeSkins: {} }
  };
}

function request(): unknown {
  return {
    extension: { deliveryClass: "hot-application", id: "app.sales-assistant" },
    operation: "install",
    targetVersion: "1.0.0",
    idempotencyKey: "install:real-authority:1"
  };
}

function plan(input: ExtensionPlanningRequest): Readonly<{ readonly plan: ExtensionInstallPlan; readonly sourceCommit: string; readonly generationId: string }> {
  const generationId = `generation-${input.operationId}`;
  return {
    sourceCommit: "a".repeat(40),
    generationId,
    plan: {
      schemaVersion: 1,
      planId: `plan-${input.operationId}`,
      operationId: input.operationId,
      operation: input.operation,
      version: input.targetVersion,
      artifactDigest: digest("c"),
      expectedRevision: input.expectedRevision,
      targetGenerationId: generationId,
      approvalRequired: false,
      rollback: { available: true, windowSeconds: 60 },
      deliveryClass: "hot-application",
      id: "app.sales-assistant",
      availability: { outcome: "live-generation", activation: "atomic-generation-pointer" },
      requiredCapabilities: [],
      resourceBudget: {
        maxBundleBytes: 1_048_576,
        maxAssetBytes: 262_144,
        maxStorageBytes: 1_048_576,
        maxMemoryMiB: 128,
        maxCpuMilliCores: 500,
        maxWallTimeMs: 5_000,
        maxInputBytes: 65_536,
        maxOutputBytes: 131_072,
        maxLogBytes: 65_536,
        maxConcurrency: 4
      }
    }
  };
}

class MemoryExtensionStore implements RuntimeExtensionStore {
  readonly claims = vi.fn();
  readonly resumes = vi.fn();
  readonly plannerValidation = vi.fn();
  operation?: RuntimeExtensionOperation;

  constructor(private readonly operationId: string) {}

  async reconcileExpiredOperations(): Promise<number> { return 0; }

  async claimOperation(input: Parameters<RuntimeExtensionStore["claimOperation"]>[0]): Promise<ClaimOperationResult> {
    this.claims(input);
    if (this.operation) return { status: "replay", operation: this.operation };
    this.operation = {
      operationId: this.operationId,
      request: input.request,
      requestDigest: input.requestDigest,
      authorization: input.authorization,
      phase: "planning",
      leaseToken: `lease-${this.operationId}`
    };
    return { status: "claimed", operation: this.operation };
  }

  async resumeOperation(operationId: string): Promise<RuntimeExtensionOperation> {
    this.resumes(operationId);
    if (!this.operation || operationId !== this.operation.operationId) throw new Error("operation is not visible in this browser context");
    return this.operation;
  }

  async savePlan(operationId: string, _leaseToken: string, saved: PluginManagerPlan): Promise<RuntimeExtensionOperation> {
    if (!this.operation || operationId !== this.operation.operationId) throw new Error("operation is not visible in this browser context");
    this.operation = { ...this.operation, plan: saved };
    return this.operation;
  }

  async readOperation(operationId: string): Promise<RuntimeExtensionOperation | undefined> {
    return this.operation?.operationId === operationId ? this.operation : undefined;
  }

  async inventory(): Promise<RuntimeExtensionInventory> { return inventory(); }

  async transition(): Promise<never> { throw new Error("not needed for planning proof"); }
  async stageGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async refreshGenerationReadiness(): Promise<never> { throw new Error("not needed for planning proof"); }
  async activateGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async rollbackGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async completeStaticRelease(): Promise<never> { throw new Error("not needed for planning proof"); }
  async disableGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async uninstallGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async quarantineActiveGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async readSecurityQuarantineReceipt(): Promise<undefined> { return undefined; }
  async quarantineRunnerGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async observeActiveGeneration(): Promise<never> { throw new Error("not needed for planning proof"); }
  async acquireGenerationLease(): Promise<never> { throw new Error("not needed for planning proof"); }
  async releaseGenerationLease(): Promise<void> {}
  async hasLiveGenerationLease(): Promise<false> { return false; }
  async liveGenerationLeaseCount(): Promise<0> { return 0; }
}

function authorizationDecision(
  session: TrustedAuthorizationSession,
  input: EffectiveAuthorizationRequest,
  outcome: "allow" | "deny"
): AuthorizationDecision {
  return {
    schemaVersion: 1,
    decisionId: input.decisionId,
    correlationId: session.correlationId,
    applicationId: session.applicationId,
    environment: session.environment,
    permissionId: input.permissionId,
    owner: { kind: "platform", namespace: "system" },
    principal: session.principal,
    effectiveActor: session.effectiveActor,
    scope: input.scope,
    authorizationRevision: expected.authorizationRevision,
    lifecycleRevision: expected.lifecycleRevision,
    outcome,
    reason: outcome === "allow" ? "granted" : "permission-not-granted",
    approval: "not-required",
    reauthentication: "not-required"
  };
}

function browserContext(name: string, actorId: string): BrowserContext {
  const session = createTrustedAuthorizationSession({
    schemaVersion: 1,
    applicationId: expected.applicationId,
    environment: expected.environment,
    correlationId: `browser-${name}`,
    principal: { kind: "user", id: actorId },
    effectiveActor: { kind: "user", id: actorId }
  });
  return Object.freeze({ name, session, actor: Object.freeze({ kind: "actor" as const, id: actorId, approvalId: `approval-${name}` }) });
}

describe("system extension administration real authority chain", () => {
  it("keeps facade and manager permissions current, persists the authorized actor, and isolates browser-bound operations", async () => {
    const plannerOnly = browserContext("planner", "planner-only");
    const extensionAdmin = browserContext("extension-admin", "extension-admin");
    const allowed = new Map<string, ReadonlySet<string>>([
      [plannerOnly.actor.id, new Set(["system.extensions.read", "system.extensions.plan"])],
      [extensionAdmin.actor.id, new Set([
        "system.extensions.read",
        "system.extensions.plan",
        "system.extensions.install-hot",
        "system.extensions.deploy-platform-plugin",
        "system.extensions.update",
        "system.extensions.disable",
        "system.extensions.rollback",
        "system.extensions.uninstall"
      ])]
    ]);
    const resolver = {
      authorize: vi.fn(async (session: TrustedAuthorizationSession, input: EffectiveAuthorizationRequest) =>
        authorizationDecision(session, input, allowed.get(session.effectiveActor.id)?.has(input.permissionId) === true ? "allow" : "deny"))
    };
    const plannerStore = new MemoryExtensionStore("operation-planner");
    const adminStore = new MemoryExtensionStore("operation-extension-admin");
    const artifacts = { stage: vi.fn(), reverify: vi.fn() };
    const staticChanges = { request: vi.fn() };
    const deployments = { request: vi.fn(), reverify: vi.fn() };

    const operatorFor = (context: BrowserContext, store: MemoryExtensionStore) => {
      const manager = new PluginManager(
        `worker-${context.name}`,
        new CurrentAuthorityOperationAuthorizer({ current: async () => ({ session: context.session, actor: context.actor }) }, resolver),
        {
          validate: async (change: ExtensionChangeRequest) => { store.plannerValidation(change); },
          plan: async (input: ExtensionPlanningRequest) => plan(input)
        },
        store,
        artifacts,
        staticChanges,
        deployments,
        undefined,
        { now: () => new Date("2026-09-01T00:00:00.000Z") }
      );
      return new ExtensionOperatorApi(
        manager,
        { list: async () => [] },
        { validate: async () => { throw new Error("static release is not needed for planning proof"); }, execute: async () => { throw new Error("static release is not needed for planning proof"); }, rollback: async () => { throw new Error("static release is not needed for planning proof"); } },
        { observe: async () => ({ runnerIsolation, remoteUiIsolation, health: [] }) }
      );
    };
    const operators = new Map<BrowserContext, ExtensionOperatorApi>([
      [plannerOnly, operatorFor(plannerOnly, plannerStore)],
      [extensionAdmin, operatorFor(extensionAdmin, adminStore)]
    ]);
    const service = new SystemExtensionAdministrationService<BrowserContext>({
      authority: new CurrentAuthorityAdapter({ current: async (context) => context.session }, resolver),
      operator: { resolve: (context) => operators.get(context) },
      state: { readState: async (): Promise<AuthorizationState> => ({ schemaVersion: 1, ...expected }) }
    });

    await expect(service.plan({ context: plannerOnly, expected, request: request() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(resolver.authorize.mock.calls.map(([, input]) => input.permissionId).sort()).toEqual([
      "system.extensions.install-hot",
      "system.extensions.plan",
      "system.extensions.plan"
    ]);
    expect(plannerStore.plannerValidation).not.toHaveBeenCalled();
    expect(plannerStore.claims).not.toHaveBeenCalled();
    expect(artifacts.stage).not.toHaveBeenCalled();
    expect(staticChanges.request).not.toHaveBeenCalled();
    expect(deployments.request).not.toHaveBeenCalled();

    resolver.authorize.mockClear();
    const created = await service.plan({ context: extensionAdmin, expected, request: request() });
    expect(resolver.authorize.mock.calls.map(([, input]) => input.permissionId).sort()).toEqual([
      "system.extensions.install-hot",
      "system.extensions.install-hot",
      "system.extensions.plan",
      "system.extensions.plan",
      "system.extensions.plan"
    ]);
    expect(adminStore.operation).toMatchObject({ operationId: created.operationId, authorization: { actor: extensionAdmin.actor } });
    expect(adminStore.plannerValidation).toHaveBeenCalledTimes(1);
    expect(adminStore.claims).toHaveBeenCalledTimes(1);

    await expect(service.operationStatus({ context: plannerOnly, operationId: created.operationId })).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    await expect(service.execute({ context: plannerOnly, expected, operationId: created.operationId })).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    expect(plannerStore.resumes).not.toHaveBeenCalled();
    expect(adminStore.resumes).not.toHaveBeenCalled();
  });
});
