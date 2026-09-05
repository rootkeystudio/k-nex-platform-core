import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { canonicalJson, type AdministrationOperatorCommand, type AdministrationOperatorResponse, type RuntimeExtensionInventory } from "@k-nex/contracts";
import type { ExtensionChangeRequest, PluginManagerPlan, RuntimeExtensionOperation } from "@k-nex/runtime";
import { AdministrationOperatorClientError, type NodeHttpsAdministrationOperatorClient } from "../src/administration-operator-client.js";
import {
  RemoteAdministrationExtensionOperator,
  remoteAdministrationExtensionOperationDigest
} from "../src/remote-administration-extension-operator.js";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const actor = {
  schemaVersion: 1,
  applicationId: "customer-alpha",
  environment: "production",
  principal: { kind: "user", id: "user:owner" },
  effectiveActor: { kind: "user", id: "user:owner" },
  authorizationRevision: 7,
  lifecycleRevision: 11,
  permissions: [{ decisionId: "decision-1", permissionId: "system.extensions.plan", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.extensions" } }]
} as const;
const inventory = {
  schemaVersion: 1,
  applicationId: actor.applicationId,
  environment: actor.environment,
  hostInventoryDigest: digest("a"),
  revision: 13,
  observedAt: "2026-09-04T12:00:00.000Z",
  stateDigest: digest("b"),
  extensions: { platformPlugins: {}, hotApplications: {}, themeSkins: {} }
} as const satisfies RuntimeExtensionInventory;
const request = {
  applicationId: actor.applicationId,
  environment: actor.environment,
  extension: { deliveryClass: "hot-application", id: "app.sales-assistant" },
  operation: "install",
  targetVersion: "1.0.0",
  expectedRevision: 0,
  idempotencyKey: "extension-install-1",
  correlationId: "extension-correlation-1"
} as const satisfies ExtensionChangeRequest;
const plan = {
  executionClass: "live-generation",
  operationId: "operation-extension-1",
  generationId: "generation-extension-1",
  sourceCommit: "a".repeat(40),
  plan: {
    schemaVersion: 1,
    planId: "plan-extension-1",
    operationId: "operation-extension-1",
    operation: "install",
    version: "1.0.0",
    artifactDigest: digest("c"),
    expectedRevision: 0,
    targetGenerationId: "generation-extension-1",
    approvalRequired: false,
    rollback: { available: true, windowSeconds: 60 },
    deliveryClass: "hot-application",
    id: "app.sales-assistant",
    availability: { outcome: "live-generation", activation: "atomic-generation-pointer" },
    requiredCapabilities: [],
    resourceBudget: { cpuMilliCores: 100, memoryMiB: 128, processes: 1, openFiles: 32, tempBytes: 1024, wallTimeMs: 1000, inputBytes: 1024, outputBytes: 1024, logBytes: 1024, concurrency: 1 }
  }
} as const satisfies PluginManagerPlan;
const plannedInventory = {
  ...inventory,
  revision: 14,
  stateDigest: digest("4"),
  extensions: { platformPlugins: {}, themeSkins: {}, hotApplications: {
    [request.extension.id]: { disposition: "removed", revision: 1, lastOperationId: plan.operationId, lastReceiptId: "receipt-initial-1", stateDigest: digest("5") }
  } }
} as const satisfies RuntimeExtensionInventory;
const authority = {
  applicationId: actor.applicationId,
  environment: actor.environment,
  deliveryClass: "hot-application",
  extensionId: request.extension.id,
  generationId: plan.generationId,
  sourceCommit: "a".repeat(40),
  artifactDigest: digest("c"), manifestDigest: digest("d"), catalogDigest: digest("e"), provenanceDigest: digest("f"), sbomDigest: digest("0")
} as const;

function operation(overrides: Partial<RuntimeExtensionOperation> = {}): RuntimeExtensionOperation {
  const boundRequest = overrides.request ?? request;
  return {
    operationId: plan.operationId,
    request: boundRequest,
    requestDigest: `sha256:${createHash("sha256").update(canonicalJson(boundRequest)).digest("hex")}`,
    authorization: { actor: { kind: "actor", id: actor.effectiveActor.id, approvalId: "approval:owner" }, decisionId: "operator-decision-1" },
    phase: "staged",
    leaseToken: "lease-token-1",
    plan,
    authority,
    ...overrides
  };
}

function accepted(value: RuntimeExtensionOperation, operationId = value.operationId): AdministrationOperatorResponse {
  return {
    schemaVersion: 1,
    outcome: "accepted",
    requestDigest: digest("2"),
    authoritativeResult: { kind: "operation", operationId },
    resultDigest: remoteAdministrationExtensionOperationDigest(value),
    operatorIdentity: "operator:production"
  };
}

function harness(options: { snapshotInventory?: RuntimeExtensionInventory; currentInventory?: RuntimeExtensionInventory; stored?: RuntimeExtensionOperation; replay?: RuntimeExtensionOperation; submit?: (command: AdministrationOperatorCommand) => Promise<AdministrationOperatorResponse> } = {}) {
  let stored = options.stored ?? operation();
  const store = {
    inventory: vi.fn(async () => options.currentInventory ?? inventory),
    readOperation: vi.fn(async () => stored),
    readOperationByIdempotency: vi.fn(async () => options.replay)
  };
  const submit = vi.fn(options.submit ?? (async () => accepted(stored)));
  const value = new RemoteAdministrationExtensionOperator({
    actor,
    inventory: options.snapshotInventory ?? inventory,
    client: { submit } as unknown as NodeHttpsAdministrationOperatorClient,
    store: store as never,
    readers: { catalogList: async () => [], catalogDetail: async () => undefined, status: async () => ({ applicationId: actor.applicationId, environment: actor.environment, inventory } as never) },
    now: () => new Date("2026-09-04T12:01:00.000Z")
  });
  return { value, store, submit, setStored: (next: RuntimeExtensionOperation) => { stored = next; } };
}

describe("RemoteAdministrationExtensionOperator", () => {
  it("submits a closed plan command and returns only the bound persisted plan", async () => {
    const test = harness({ stored: operation({ request: { ...request, correlationId: "operator-owned-correlation" } }) });
    await expect(test.value.plan(request)).resolves.toEqual(plan);
    expect(test.submit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "extension-plan", actor, expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 13, extensionRevision: 0 },
      extension: request.extension, version: request.targetVersion, operation: request.operation, idempotencyKey: request.idempotencyKey
    }));
  });

  it("submits execute and returns the exact terminal durable result", async () => {
    const receipt = { receiptId: "receipt-extension-1", operationId: plan.operationId, operation: "install", generationId: plan.generationId,
      revisionBefore: 1, revisionAfter: 2, inventoryRevision: 15, compatibility: { status: "compatible", windowId: "window-extension-1", closesAt: "2026-09-04T13:00:00.000Z", migrationDigest: digest("3"), dataRevision: 1 }, rollback: "available", occurredAt: "2026-09-04T12:01:01.000Z" } as const;
    let test: ReturnType<typeof harness>;
    let attempts = 0;
    test = harness({ snapshotInventory: plannedInventory, currentInventory: plannedInventory, submit: async () => {
      const completed = operation({ phase: "completed", result: receipt });
      test.setStored(completed);
      if (attempts++ === 0) throw new AdministrationOperatorClientError("TRANSPORT_FAILED", "response lost");
      return accepted(completed);
    } });
    await expect(test.value.activate(plan.operationId)).resolves.toEqual(receipt);
    expect(test.submit).toHaveBeenCalledWith(expect.objectContaining({ kind: "extension-execute", operationId: plan.operationId, idempotencyKey: `execute:${plan.operationId}`, expected: expect.objectContaining({ inventoryRevision: 14, extensionRevision: 1 }) }));
    expect(test.submit).toHaveBeenCalledTimes(2);
    expect(test.submit.mock.calls[0]![0]).toEqual(test.submit.mock.calls[1]![0]);

    const completed = operation({ phase: "completed", result: receipt });
    const finalInventory = { ...plannedInventory, revision: 15, extensions: { ...plannedInventory.extensions, hotApplications: {
      [request.extension.id]: { ...plannedInventory.extensions.hotApplications[request.extension.id], revision: 2, lastReceiptId: receipt.receiptId }
    } } } as RuntimeExtensionInventory;
    const httpReplay = harness({ snapshotInventory: finalInventory, currentInventory: finalInventory, stored: completed });
    await expect(httpReplay.value.activate(plan.operationId)).resolves.toEqual(receipt);
    expect(httpReplay.submit).not.toHaveBeenCalled();

    const stolen = { ...plannedInventory, extensions: { ...plannedInventory.extensions, hotApplications: {
      [request.extension.id]: { ...plannedInventory.extensions.hotApplications[request.extension.id], lastOperationId: "operation-extension-other" }
    } } } as RuntimeExtensionInventory;
    const wrongOwner = harness({ snapshotInventory: stolen, currentInventory: stolen });
    await expect(wrongOwner.value.activate(plan.operationId)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(wrongOwner.submit).not.toHaveBeenCalled();
  });

  it("returns an exact persisted plan after HTTP response loss and rejects a changed payload under the same identity", async () => {
    const persisted = operation({ request: { ...request, correlationId: "operator-bound-correlation" } });
    const replay = harness({ stored: persisted, replay: persisted });
    await expect(replay.value.plan(request)).resolves.toEqual(plan);
    expect(replay.submit).not.toHaveBeenCalled();

    await expect(replay.value.plan({ ...request, targetVersion: "1.0.1" })).rejects.toMatchObject({ code: "RESULT_INVALID" });
  });

  it("validates only persisted prepared authority without writing or calling the operator", async () => {
    const valid = harness();
    await expect(valid.value.validate(plan.operationId)).resolves.toMatchObject({ valid: true, checks: ["persisted-generation-authority"] });
    expect(valid.submit).not.toHaveBeenCalled();

    const failed = harness({ stored: operation({ phase: "failed" }) });
    await expect(failed.value.validate(plan.operationId)).resolves.toMatchObject({ valid: false, checks: [] });
    expect(failed.submit).not.toHaveBeenCalled();
  });

  it("denies cross-tenant operations and stale inventory before remote mutation", async () => {
    const foreign = harness({ stored: operation({ request: { ...request, applicationId: "customer-beta" } }) });
    await expect(foreign.value.operation(plan.operationId)).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });

    const stale = harness({ currentInventory: { ...inventory, revision: 14, stateDigest: digest("9") } });
    await expect(stale.value.plan(request)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(stale.submit).not.toHaveBeenCalled();
  });

  it("denies forged bindings and accepted responses without a terminal durable result", async () => {
    const forged = harness({ submit: async () => ({ ...accepted(operation()), resultDigest: digest("9") }) });
    await expect(forged.value.plan(request)).rejects.toMatchObject({ code: "RESULT_INVALID" });

    const missing = harness({ snapshotInventory: plannedInventory, currentInventory: plannedInventory, submit: async () => accepted(operation()) });
    await expect(missing.value.activate(plan.operationId)).rejects.toMatchObject({ code: "RESULT_INVALID" });
  });
});
