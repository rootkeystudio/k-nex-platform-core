import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AdministrationOperatorResponseSchema,
  administrationOperatorRequestDigestInput,
  canonicalJson,
  type AdministrationOperatorAuthenticatedCommand,
  type RuntimeExtensionInventory
} from "@k-nex/contracts";
import type { ExtensionOperatorApi, RuntimeExtensionOperation } from "@k-nex/runtime";

import { AdministrationExtensionCommandHandler } from "../src/administration-extension-command-handler.js";
import { remoteAdministrationExtensionOperationDigest } from "../src/remote-administration-extension-operator.js";

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
const identity = {
  schemaVersion: 1,
  uriSan: "spiffe://knex-deployment/customer-alpha/production/extensions",
  applicationId: actor.applicationId,
  environment: actor.environment,
  allowedCommandFamilies: ["extension-lifecycle"]
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
const command = {
  schemaVersion: 1,
  kind: "extension-plan",
  audience: "k-nex-administration-operator",
  actor,
  expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 13, extensionRevision: 0 },
  idempotencyKey: "extension-command-1",
  issuedAt: "2026-09-04T12:00:00.000Z",
  expiresAt: "2026-09-04T12:05:00.000Z",
  extension: { deliveryClass: "hot-application", id: "app.sales-assistant" },
  version: "1.0.0",
  operation: "install"
} as const;
const plan = {
  executionClass: "live-generation",
  operationId: "operation-extension-1",
  generationId: "generation-extension-1",
  sourceCommit: "a".repeat(40),
  plan: {
    schemaVersion: 1, planId: "plan-extension-1", operationId: "operation-extension-1", operation: "install", version: "1.0.0", artifactDigest: digest("c"), expectedRevision: 0,
    targetGenerationId: "generation-extension-1", approvalRequired: false, rollback: { available: true, windowSeconds: 60 }, deliveryClass: "hot-application", id: "app.sales-assistant",
    availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [],
    resourceBudget: { cpuMilliCores: 100, memoryMiB: 128, processes: 1, openFiles: 32, tempBytes: 1024, wallTimeMs: 1000, inputBytes: 1024, outputBytes: 1024, logBytes: 1024, concurrency: 1 }
  }
} as const;

function operation(overrides: Partial<RuntimeExtensionOperation> = {}): RuntimeExtensionOperation {
  return {
    operationId: plan.operationId,
    request: { applicationId: actor.applicationId, environment: actor.environment, extension: command.extension, operation: command.operation, targetVersion: command.version, expectedRevision: 0, idempotencyKey: command.idempotencyKey, correlationId: "administration-extension-operator" },
    requestDigest: digest("1"), authorization: { actor: { kind: "trusted-automation", identity: "operator:production" }, decisionId: "operator-decision-1" }, phase: "planning", leaseToken: "lease-token-1", plan,
    ...overrides
  };
}

function authenticated(value = command): AdministrationOperatorAuthenticatedCommand {
  return { command: value, verifiedMtlsIdentity: identity } as AdministrationOperatorAuthenticatedCommand;
}

function harness(options: Readonly<{
  currentState?: unknown;
  currentInventory?: RuntimeExtensionInventory;
  stored?: RuntimeExtensionOperation;
  afterActivate?: (replace: (next: RuntimeExtensionOperation) => void) => void;
}> = {}) {
  let stored = options.stored ?? operation();
  const api = { plan: vi.fn(async () => plan), activate: vi.fn(async () => options.afterActivate?.((next) => { stored = next; })), rollback: vi.fn(async () => undefined), disable: vi.fn(async () => undefined), uninstall: vi.fn(async () => undefined) } as unknown as ExtensionOperatorApi;
  const store = { inventory: vi.fn(async () => options.currentInventory ?? inventory), readOperation: vi.fn(async () => stored) };
  const value = new AdministrationExtensionCommandHandler({
    applicationId: actor.applicationId, environment: actor.environment, operatorIdentity: "operator:production", clock: () => new Date("2026-09-04T12:01:00.000Z"),
    authorizationState: { readState: vi.fn(async () => options.currentState ?? { schemaVersion: 1, applicationId: actor.applicationId, environment: actor.environment, authorizationRevision: 7, lifecycleRevision: 11 }) },
    store: store as never, operatorForActor: vi.fn(() => api)
  });
  return { value, api, store, setStored: (next: RuntimeExtensionOperation) => { stored = next; } };
}

describe("AdministrationExtensionCommandHandler", () => {
  it("binds a durable planned operation to the authenticated request and immutable actor", async () => {
    const test = harness();
    const input = authenticated();
    const response = await test.value.handle(input);
    expect(AdministrationOperatorResponseSchema.parse(response)).toEqual(response);
    expect(response).toMatchObject({ outcome: "accepted", requestDigest: `sha256:${createHash("sha256").update(canonicalJson(administrationOperatorRequestDigestInput(input))).digest("hex")}`, authoritativeResult: { kind: "operation", operationId: plan.operationId }, resultDigest: remoteAdministrationExtensionOperationDigest(operation()), operatorIdentity: "operator:production" });
    expect(test.api.plan).toHaveBeenCalledWith(expect.objectContaining({ ...operation().request }));
    expect(test.api.plan).toHaveBeenCalledTimes(1);
    expect(test.store.readOperation).toHaveBeenCalledWith(plan.operationId);
  });

  it("uses the operation's lifecycle action for execute and supports the same durable replay", async () => {
    const activeInventory = { ...inventory, revision: 14, extensions: { platformPlugins: {}, themeSkins: {}, hotApplications: {
      [command.extension.id]: { disposition: "removed", revision: 1, lastOperationId: plan.operationId, lastReceiptId: "receipt-initial-1", stateDigest: digest("d") }
    } } } as const satisfies RuntimeExtensionInventory;
    const receipt = { receiptId: "receipt-extension-1", operationId: plan.operationId, operation: "install", generationId: plan.generationId,
      revisionBefore: 0, revisionAfter: 1, inventoryRevision: 14, compatibility: { status: "compatible", windowId: "window-extension-1", closesAt: "2026-09-04T13:00:00.000Z", migrationDigest: digest("3"), dataRevision: 1 }, rollback: "available", occurredAt: "2026-09-04T12:01:01.000Z" } as const;
    const test = harness({ currentInventory: activeInventory, afterActivate: (replace) => replace(operation({ phase: "completed", result: receipt })) });
    const { extension: _extension, version: _version, operation: _operation, ...base } = command;
    const execute = authenticated({ ...base, kind: "extension-execute", expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 14, extensionRevision: 1 }, operationId: plan.operationId } as const);
    const first = await test.value.handle(execute);
    const replay = await test.value.handle(execute);
    expect(first).toEqual(replay);
    expect(test.api.activate).toHaveBeenCalledWith(plan.operationId);
    expect(test.api.activate).toHaveBeenCalledTimes(2);
  });

  it("rejects a plan that the durable operation did not persist exactly", async () => {
    for (const stored of [operation({ plan: undefined }), operation({ plan: { ...plan, sourceCommit: "b".repeat(40) } as never })]) {
      const test = harness({ stored });
      await expect(test.value.handle(authenticated())).rejects.toThrow();
      expect(test.api.plan).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects partial execution and a forged post-execution request", async () => {
    const activeInventory = { ...inventory, revision: 14, extensions: { platformPlugins: {}, themeSkins: {}, hotApplications: {
      [command.extension.id]: { disposition: "removed", revision: 1, lastOperationId: plan.operationId, lastReceiptId: "receipt-initial-1", stateDigest: digest("d") }
    } } } as const satisfies RuntimeExtensionInventory;
    const { extension: _extension, version: _version, operation: _operation, ...base } = command;
    const execute = authenticated({ ...base, kind: "extension-execute", expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 14, extensionRevision: 1 }, operationId: plan.operationId } as const);

    const partial = harness({ currentInventory: activeInventory });
    await expect(partial.value.handle(execute)).rejects.toThrow();

    const forged = harness({ currentInventory: activeInventory, afterActivate: (replace) => replace(operation({
      phase: "completed", result: {} as never, request: { ...operation().request, idempotencyKey: "forged-command-1" }
    })) });
    await expect(forged.value.handle(execute)).rejects.toThrow();
  });

  it("rejects stale authority or revisions, cross-tenant operations, and another command family before mutation", async () => {
    const staleAuthority = harness({ currentState: { schemaVersion: 1, applicationId: actor.applicationId, environment: actor.environment, authorizationRevision: 8, lifecycleRevision: 11 } });
    await expect(staleAuthority.value.handle(authenticated())).rejects.toThrow();
    expect(staleAuthority.api.plan).not.toHaveBeenCalled();

    const staleRevision = harness({ currentInventory: { ...inventory, revision: 14 } });
    await expect(staleRevision.value.handle(authenticated())).rejects.toThrow();
    expect(staleRevision.api.plan).not.toHaveBeenCalled();

    const staleTarget = harness();
    await expect(staleTarget.value.handle(authenticated({ ...command, expected: { authorizationRevision: 7, lifecycleRevision: 11, inventoryRevision: 13, extensionRevision: 1 } } as never))).rejects.toThrow();
    expect(staleTarget.api.plan).not.toHaveBeenCalled();

    const foreign = harness();
    const foreignActor = { ...actor, applicationId: "customer-beta" };
    await expect(foreign.value.handle({ command: { ...command, actor: foreignActor }, verifiedMtlsIdentity: { ...identity, applicationId: "customer-beta" } } as never)).rejects.toThrow();
    expect(foreign.api.plan).not.toHaveBeenCalled();

    const wrongFamily = harness();
    const { extension: _extension, version: _version, operation: _operation, ...base } = command;
    await expect(wrongFamily.value.handle({ command: { ...base, kind: "catalog-refresh", expected: { authorizationRevision: 7, lifecycleRevision: 11, catalogRevision: 1, inventoryRevision: 13 } }, verifiedMtlsIdentity: { ...identity, allowedCommandFamilies: ["extension-lifecycle", "catalog"] } } as never)).rejects.toThrow();
    expect(wrongFamily.api.plan).not.toHaveBeenCalled();
  });
});
