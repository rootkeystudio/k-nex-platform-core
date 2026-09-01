import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision, AuthorizationState } from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { type ExtensionOperatorApi } from "../src/extension-operator-api.js";
import { type ExtensionChangeRequest, type ExtensionOperationStatus, type PluginManagerPlan } from "../src/plugin-manager.js";
import { SystemExtensionAdministrationError, SystemExtensionAdministrationService } from "../src/system-extension-administration.js";

const expected = Object.freeze({ applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 7, extensionRevision: 3 });
const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, correlationId: "system-extension-test", principal: { kind: "user", id: "admin" }, effectiveActor: { kind: "user", id: "admin" } });

type TestContext = Readonly<Record<never, never>>;

function authorizationState(): AuthorizationState { return { schemaVersion: 1, ...expected }; }

function decision(request: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny" = "allow"): AuthorizationDecision {
  return {
    schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
    permissionId: request.permissionId, owner: { kind: "platform", namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor,
    scope: request.scope, authorizationRevision: expected.authorizationRevision, lifecycleRevision: expected.lifecycleRevision,
    outcome, reason: outcome === "allow" ? "granted" : "permission-not-granted", approval: "not-required", reauthentication: "not-required"
  };
}

function plan(deliveryClass: "hot-application" | "theme-skin" | "platform-plugin", availability = "zero-downtime-eligible"): PluginManagerPlan {
  const common = {
    schemaVersion: 1, planId: "plan-system-extension-1", operationId: "operation-system-extension-1", operation: "install", version: "1.0.0",
    artifactDigest: `sha256:${"a".repeat(64)}`, expectedRevision: expected.extensionRevision, targetGenerationId: "generation-system-extension-1",
    approvalRequired: false, rollback: { available: true, windowSeconds: 60 }
  };
  const impact = deliveryClass === "platform-plugin"
    ? { ...common, deliveryClass, id: "module.sales", availability: availability === "maintenance-required" ? { outcome: availability, reasons: ["incompatible-overlap"] } : availability === "unsupported" ? { outcome: availability, reasons: ["supervisor-unavailable"] } : { outcome: availability, checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } } }
    : { ...common, deliveryClass, id: deliveryClass === "hot-application" ? "app.sales-assistant" : "skin.minimal-accent", availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, ...(deliveryClass === "hot-application" ? { requiredCapabilities: [], resourceBudget: { cpuMilliCores: 100, memoryMiB: 128, processes: 1, openFiles: 32, tempBytes: 1024, wallTimeMs: 1000, inputBytes: 1024, outputBytes: 1024, logBytes: 1024, concurrency: 1 } } : { resourceBudget: { cssBytes: 1024, assetBytes: 1024 } }) };
  return { executionClass: deliveryClass === "platform-plugin" ? "static-release" : "live-generation", operationId: common.operationId, generationId: common.targetGenerationId, plan: impact } as unknown as PluginManagerPlan;
}

function request(): unknown { return { extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", idempotencyKey: "system-extension-install-1" }; }

function harness(options: Readonly<{
  readonly outcome?: "allow" | "deny";
  readonly state?: () => AuthorizationState | undefined;
  readonly inventoryRevision?: number;
  readonly operation?: ExtensionOperationStatus;
  readonly approval?: boolean;
  readonly provider?: (context: TestContext, fallback: ExtensionOperatorApi) => Promise<ExtensionOperatorApi | undefined> | ExtensionOperatorApi | undefined;
}> = {}) {
  const resolver = { authorize: vi.fn(async (current: TrustedAuthorizationSession, input: EffectiveAuthorizationRequest) => decision(input, current, options.outcome)) };
  const authority = new CurrentAuthorityAdapter({ current: async () => session }, resolver as never);
  const operator = {
    catalogList: vi.fn(async () => []), catalogDetail: vi.fn(async () => undefined), status: vi.fn(async () => ({ applicationId: expected.applicationId, environment: expected.environment, inventory: { revision: options.inventoryRevision ?? expected.extensionRevision } })),
    plan: vi.fn(async () => plan("hot-application")), operation: vi.fn(async () => options.operation), activate: vi.fn(async () => ({ receiptId: "receipt-system-extension-1" })), rollback: vi.fn(), disable: vi.fn(), uninstall: vi.fn()
  } as unknown as ExtensionOperatorApi;
  const state = { readState: vi.fn(async () => options.state ? options.state() : authorizationState()) };
  const approval = options.approval === undefined ? undefined : { verify: vi.fn(async () => options.approval) };
  const operatorProvider = { resolve: vi.fn(async (context: TestContext) => options.provider ? options.provider(context, operator) : operator) };
  return { resolver, operator, operatorProvider, state, approval, service: new SystemExtensionAdministrationService<TestContext>({ operator: operatorProvider, authority, state, ...(approval ? { approval } : {}) }) };
}

describe("system extension administration", () => {
  it("uses only the server-selected extension read permission for list, detail, and status", async () => {
    const value = harness();
    await value.service.list({ context: {} });
    await value.service.detail({ context: {}, extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, version: "1.0.0" });
    await value.service.status({ context: {} });
    expect(value.resolver.authorize.mock.calls.map(([, input]) => input.permissionId)).toEqual(["system.extensions.read", "system.extensions.read", "system.extensions.read"]);
    expect(value.operator.status).toHaveBeenCalledWith(expected.applicationId, expected.environment);
    await expect(value.service.list({ context: {}, permissionId: "system.roles.manage" } as never)).rejects.toMatchObject({ code: "REQUEST_INVALID" } satisfies Partial<SystemExtensionAdministrationError>);
  });

  it("denies reads before exposing catalog or status", async () => {
    const value = harness({ outcome: "deny" });
    await expect(value.service.status({ context: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<SystemExtensionAdministrationError>);
    expect(value.operator.status).not.toHaveBeenCalled();
  });

  it("fails closed when the context-bound operator is unavailable", async () => {
    const value = harness({ provider: async () => { throw new Error("missing trusted context binding"); } });
    await expect(value.service.list({ context: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<SystemExtensionAdministrationError>);
    expect(value.operatorProvider.resolve).toHaveBeenCalledTimes(1);
    expect(value.operator.catalogList).not.toHaveBeenCalled();
  });

  it("uses the operator bound to each context and cannot reuse another context's operation", async () => {
    const contextA = Object.freeze({}) as TestContext;
    const contextB = Object.freeze({}) as TestContext;
    const operationA = { operationId: "operation-context-a", request: { applicationId: expected.applicationId, environment: expected.environment, extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", expectedRevision: expected.extensionRevision, idempotencyKey: "system-extension-install-1", correlationId: "system-extension-administration" }, phase: "staged" } as unknown as ExtensionOperationStatus;
    const operationB = { ...operationA, operationId: "operation-context-b" } as ExtensionOperationStatus;
    let operatorA: ExtensionOperatorApi;
    let operatorB: ExtensionOperatorApi;
    const value = harness({ provider: (context) => context === contextA ? operatorA : context === contextB ? operatorB : undefined });
    operatorA = { ...value.operator, operation: vi.fn(async (operationId: string) => {
      if (operationId === operationA.operationId) return operationA;
      throw new Error("context A cannot access this operation");
    }) } as unknown as ExtensionOperatorApi;
    operatorB = { ...value.operator, operation: vi.fn(async (operationId: string) => {
      if (operationId === operationB.operationId) return operationB;
      throw new Error("context B cannot access this operation");
    }) } as unknown as ExtensionOperatorApi;

    await expect(value.service.operationStatus({ context: contextB, operationId: operationB.operationId })).resolves.toMatchObject({ operationId: operationB.operationId });
    await expect(value.service.operationStatus({ context: contextA, operationId: operationB.operationId })).rejects.toThrow("context A cannot access this operation");
    expect(operatorB.operation).toHaveBeenCalledTimes(1);
    expect(operatorA.operation).toHaveBeenCalledWith(operationB.operationId);
    expect(value.operatorProvider.resolve).toHaveBeenLastCalledWith(contextA);
  });

  it.each([
    ["hot application", plan("hot-application"), { outcome: "install-live", deliveryClass: "hot-application" }],
    ["theme skin", plan("theme-skin"), { outcome: "install-live", deliveryClass: "theme-skin" }],
    ["eligible plugin", plan("platform-plugin"), { outcome: "no-outage-deployment", deliveryClass: "platform-plugin" }],
    ["maintenance plugin", plan("platform-plugin", "maintenance-required"), { outcome: "maintenance-required", deliveryClass: "platform-plugin" }],
    ["unsupported plugin", plan("platform-plugin", "unsupported"), { outcome: "unsupported", deliveryClass: "platform-plugin" }]
  ] as const)("returns the authoritative %s display classification", async (_name, nextPlan, display) => {
    const value = harness();
    (value.operator.plan as ReturnType<typeof vi.fn>).mockResolvedValueOnce(nextPlan);
    await expect(value.service.plan({ context: {}, expected, request: request() })).resolves.toMatchObject({ impact: nextPlan.plan, display });
  });

  it("binds lifecycle input to current server owner and all three expected revisions", async () => {
    const value = harness();
    await value.service.plan({ context: {}, expected, request: request() });
    expect(value.operator.plan).toHaveBeenCalledWith(expect.objectContaining({ applicationId: expected.applicationId, environment: expected.environment, expectedRevision: expected.extensionRevision }));
    await expect(value.service.plan({ context: {}, expected: { ...expected, authorizationRevision: 5 }, request: request() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" } satisfies Partial<SystemExtensionAdministrationError>);
    await expect(value.service.plan({ context: {}, expected, request: { ...request() as object, actor: { kind: "actor", approvalId: "forged" } } })).rejects.toMatchObject({ code: "REQUEST_INVALID" } satisfies Partial<SystemExtensionAdministrationError>);
    const staleInventory = harness({ inventoryRevision: expected.extensionRevision + 1 });
    await expect(staleInventory.service.plan({ context: {}, expected, request: request() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" } satisfies Partial<SystemExtensionAdministrationError>);
    expect(staleInventory.operator.plan).not.toHaveBeenCalled();
  });

  it("denies plan dispatch before the operator sees a revoked caller", async () => {
    const value = harness({ outcome: "deny" });
    await expect(value.service.plan({ context: {}, expected, request: request() })).rejects.toMatchObject({ code: "UNAUTHORIZED" } satisfies Partial<SystemExtensionAdministrationError>);
    expect(value.operator.plan).not.toHaveBeenCalled();
  });

  it("does not let plan-only facade authority bypass the bound operator's lifecycle authorization", async () => {
    const value = harness();
    const operationAuthorizer = vi.fn(async (_request: ExtensionChangeRequest) => { throw new Error("operation-specific denied"); });
    (value.operator.plan as ReturnType<typeof vi.fn>).mockImplementation(async (change: ExtensionChangeRequest) => {
      await operationAuthorizer(change);
      return plan("hot-application");
    });
    await expect(value.service.plan({ context: {}, expected, request: request() })).rejects.toThrow("operation-specific denied");
    expect(value.resolver.authorize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ permissionId: "system.extensions.plan" }), expect.anything());
    expect(operationAuthorizer).toHaveBeenCalledWith(expect.objectContaining({ operation: "install" }));
  });

  it("requires a server-side operation-bound approval and rechecks state before execution", async () => {
    const operation = {
      operationId: "operation-system-extension-1", request: { applicationId: expected.applicationId, environment: expected.environment, extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", expectedRevision: expected.extensionRevision, idempotencyKey: "system-extension-install-1", correlationId: "system-extension-administration" },
      requestDigest: `sha256:${"b".repeat(64)}`, actor: { kind: "actor", id: "admin", approvalId: "server-approval" }, phase: "staged", plan: { ...plan("hot-application"), plan: { ...plan("hot-application").plan, approvalRequired: true } }
    } as unknown as ExtensionOperationStatus;
    const denied = harness({ operation });
    await expect(denied.service.execute({ context: {}, expected, operationId: operation.operationId })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" } satisfies Partial<SystemExtensionAdministrationError>);
    expect(denied.operator.activate).not.toHaveBeenCalled();

    const admitted = harness({ operation, approval: true });
    await expect(admitted.service.execute({ context: {}, expected, operationId: operation.operationId })).resolves.toMatchObject({ status: { operationId: operation.operationId } });
    expect(admitted.approval!.verify).toHaveBeenCalledWith(expect.objectContaining({ operation, expected }));
    expect(admitted.operator.activate).toHaveBeenCalledWith(operation.operationId);
    expect(admitted.state.readState).toHaveBeenCalledTimes(2);
    expect(admitted.operatorProvider.resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps execute approval and revision fenced after resolving its operator", async () => {
    const operation = {
      operationId: "operation-system-extension-1", request: { applicationId: expected.applicationId, environment: expected.environment, extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", expectedRevision: expected.extensionRevision, idempotencyKey: "system-extension-install-1", correlationId: "system-extension-administration" },
      requestDigest: `sha256:${"b".repeat(64)}`, actor: { kind: "actor", id: "admin", approvalId: "server-approval" }, phase: "staged", plan: { ...plan("hot-application"), plan: { ...plan("hot-application").plan, approvalRequired: true } }
    } as unknown as ExtensionOperationStatus;
    let reads = 0;
    const value = harness({ operation, approval: true, state: () => ++reads === 1 ? authorizationState() : { ...authorizationState(), lifecycleRevision: expected.lifecycleRevision + 1 } });
    await expect(value.service.execute({ context: {}, expected, operationId: operation.operationId })).rejects.toMatchObject({ code: "REVISION_CONFLICT" } satisfies Partial<SystemExtensionAdministrationError>);
    expect(value.approval!.verify).toHaveBeenCalledWith(expect.objectContaining({ operation, expected }));
    expect(value.operator.activate).not.toHaveBeenCalled();
    expect(value.operatorProvider.resolve).toHaveBeenCalledTimes(1);
  });
});
