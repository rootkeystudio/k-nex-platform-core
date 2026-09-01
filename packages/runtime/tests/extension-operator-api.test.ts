import { readFileSync } from "node:fs";

import type { RuntimeExtensionInventory } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  CurrentStaticReleaseOperationAdmission,
  DurableStaticReleaseOperator,
  ExtensionOperatorApi,
  StaticReleaseOperatorError,
  extensionOperationRequestDigest,
  type ExtensionOperationStatus
} from "../src/index.js";

const load = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const inventory = load("../../../fixtures/extensions/valid/runtime-extension-inventory.json") as RuntimeExtensionInventory;
const runnerIsolation = load("../../../fixtures/extensions/valid/runner-isolation-profile.json");
const remoteUiIsolation = load("../../../fixtures/extensions/valid/remote-ui-isolation-profile.json");
const dynamicOperation = {
  operationId: "operation-dynamic-1",
  request: { applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", expectedRevision: 0, idempotencyKey: "install:app.sales-assistant:1", correlationId: "correlation-dynamic-1" },
  requestDigest: `sha256:${"a".repeat(64)}`,
  actor: { kind: "trusted-automation", identity: "github-actions:phase-9" },
  phase: "staged"
} as ExtensionOperationStatus;
const staticOperation = { ...dynamicOperation, operationId: "operation-static-1", request: { ...dynamicOperation.request, extension: { deliveryClass: "platform-plugin", id: "module.sales" } }, plan: { executionClass: "static-release" } } as unknown as ExtensionOperationStatus;
const operationFor = (operation: "rollback" | "disable" | "uninstall", executionClass: "live-generation" | "static-release" = "live-generation") => ({
  ...dynamicOperation,
  operationId: `operation-${executionClass}-${operation}`,
  request: { ...dynamicOperation.request, operation, ...(executionClass === "static-release" ? { extension: { deliveryClass: "platform-plugin", id: "module.sales" } } : {}) },
  plan: { executionClass }
}) as unknown as ExtensionOperationStatus;

function harness() {
  const lifecycleOperations = [operationFor("disable"), operationFor("uninstall"), operationFor("uninstall", "static-release"), operationFor("rollback", "static-release")];
  const operations = new Map([dynamicOperation, staticOperation, ...lifecycleOperations].map((operation) => [operation.operationId, operation]));
  const manager = {
    plan: vi.fn(), stage: vi.fn(), validate: vi.fn(async () => ({ operationId: dynamicOperation.operationId, executionClass: "live-generation", phase: "staged", valid: true, checks: ["verified-bundle"] })),
    operation: vi.fn(async (id: string) => operations.get(id)!), activate: vi.fn(async () => ({ operation: "install" })), rollback: vi.fn(async () => ({ operation: "rollback" })),
    disable: vi.fn(async () => ({ operation: "disable" })), uninstall: vi.fn(async () => ({ operation: "uninstall" })), inventory: vi.fn(async () => inventory), completeStaticRelease: vi.fn(async () => ({ operation: "rollback" }))
  };
  const catalog = { list: vi.fn(async () => [
    { extension: { deliveryClass: "theme-skin", id: "skin.minimal-accent" }, version: "1.0.0", displayName: "Minimal Accent", support: "supported", review: "approved", security: "clear", revoked: false, availability: "live-generation" },
    { extension: { deliveryClass: "hot-application", id: "app.sales-advisory" }, version: "1.0.0", displayName: "Sales Advisory", support: "supported", review: "approved", security: "advisory", revoked: false, availability: "live-generation" },
    { extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, version: "1.0.0", displayName: "Sales Assistant", support: "supported", review: "approved", security: "compromised", revoked: true, availability: "live-generation" },
    { extension: { deliveryClass: "platform-plugin", id: "module.sales" }, version: "1.0.0", displayName: "Sales", support: "supported", review: "approved", security: "clear", revoked: false, availability: "static-release" }
  ] as const) };
  const staticReleases = {
    validate: vi.fn(async () => ({ operationId: staticOperation.operationId, executionClass: "static-release", phase: "build-attested", valid: true, checks: ["trusted-build"] })),
    execute: vi.fn(async () => ({ outcome: "maintenance-required", reasons: ["offline-migration"] })),
    rollback: vi.fn(async () => ({ operation: "rollback" })),
    finalize: vi.fn(async () => undefined)
  };
  const runtimeStatus = { observe: vi.fn(async () => ({ runnerIsolation, remoteUiIsolation, health: [{ extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, generationId: "sales-assistant-generation-1", state: "healthy" }] })) };
  return { manager, catalog, staticReleases, runtimeStatus, api: new ExtensionOperatorApi(manager as never, catalog, staticReleases as never, runtimeStatus as never) };
}

describe("ExtensionOperatorApi", () => {
  it("lists only approved usable catalog records by default and provides exact detail", async () => {
    const value = harness();
    await expect(value.api.catalogList()).resolves.toEqual([
      expect.objectContaining({ extension: { deliveryClass: "platform-plugin", id: "module.sales" } }),
      expect.objectContaining({ extension: { deliveryClass: "theme-skin", id: "skin.minimal-accent" } })
    ]);
    await expect(value.api.catalogList({ includeUnavailable: true, deliveryClass: "hot-application" })).resolves.toHaveLength(2);
    await expect(value.api.catalogDetail({ deliveryClass: "platform-plugin", id: "module.sales" }, "1.0.0")).resolves.toMatchObject({ availability: "static-release" });
    await expect(value.api.catalogDetail({ deliveryClass: "platform-plugin", id: "module.sales" }, "latest")).rejects.toThrow();
    const records = await value.catalog.list();
    value.catalog.list.mockResolvedValueOnce([...records, records[0]]);
    await expect(value.api.catalogList({ includeUnavailable: true })).rejects.toThrow("duplicate extension releases");

    const maxVersion = `1.0.0+${"a".repeat(58)}`;
    value.catalog.list.mockResolvedValueOnce([{ ...records[0]!, version: maxVersion }]);
    await expect(value.api.catalogList({ includeUnavailable: true })).resolves.toEqual([expect.objectContaining({ version: maxVersion })]);
    value.catalog.list.mockResolvedValueOnce([{ ...records[0]!, version: `${maxVersion}a` }]);
    await expect(value.api.catalogList({ includeUnavailable: true })).rejects.toThrow();
  });

  it("routes live and static lifecycle calls through their owning authority", async () => {
    const value = harness();
    await value.api.validate(dynamicOperation.operationId);
    await value.api.activate(dynamicOperation.operationId);
    await value.api.disable("operation-live-generation-disable");
    await value.api.uninstall("operation-live-generation-uninstall");
    expect(value.manager.validate).toHaveBeenCalledOnce();
    expect(value.manager.activate).toHaveBeenCalledOnce();
    expect(value.manager.disable).toHaveBeenCalledOnce();
    expect(value.manager.uninstall).toHaveBeenCalledOnce();

    await expect(value.api.validate(staticOperation.operationId)).resolves.toMatchObject({ executionClass: "static-release" });
    await expect(value.api.activate(staticOperation.operationId)).resolves.toEqual({ outcome: "maintenance-required", reasons: ["offline-migration"] });
    await expect(value.api.uninstall("operation-static-release-uninstall")).resolves.toEqual({ outcome: "maintenance-required", reasons: ["offline-migration"] });
    await value.api.rollback("operation-static-release-rollback");
    expect(value.staticReleases.validate).toHaveBeenCalledOnce();
    expect(value.staticReleases.execute).toHaveBeenCalledTimes(2);
    expect(value.staticReleases.rollback).toHaveBeenCalledOnce();
    expect(value.staticReleases.finalize).toHaveBeenCalledOnce();
    expect(value.manager.completeStaticRelease).toHaveBeenCalledWith("operation-static-release-rollback", { operation: "rollback" });
    await expect(value.api.disable(dynamicOperation.operationId)).rejects.toThrow("not authorized for this lifecycle action");
  });

  it("reconciles a promoted static receipt through the unified manager inventory path", async () => {
    const value = harness();
    const receipt = { operation: "promote", receiptId: "static-promotion-1" };
    value.staticReleases.execute.mockResolvedValueOnce({ outcome: "promoted", receipt });
    await expect(value.api.activate(staticOperation.operationId)).resolves.toEqual({ outcome: "promoted", receipt });
    expect(value.manager.completeStaticRelease).toHaveBeenCalledWith(staticOperation.operationId, receipt);
    expect(value.staticReleases.finalize).toHaveBeenCalledWith(staticOperation);
  });

  it("combines reverified inventory with closed isolation, health, and fence observations", async () => {
    const value = harness();
    await expect(value.api.status("customer-alpha", "production")).resolves.toMatchObject({
      applicationId: "customer-alpha",
      environment: "production",
      inventory,
      runnerIsolation,
      remoteUiIsolation,
      health: [{ state: "healthy" }]
    });
    await expect(value.api.status("../../customer", "production")).rejects.toThrow("owner is invalid");
  });
});

describe("DurableStaticReleaseOperator", () => {
  const sourceCommit = "b".repeat(40);
  const planDigest = `sha256:${"c".repeat(64)}`;
  const buildDigest = `sha256:${"d".repeat(64)}`;
  const applicationDigest = `sha256:${"e".repeat(64)}`;
  const imageDigest = `sha256:${"f".repeat(64)}`;
  const receipt = {
    schemaVersion: 1, receiptId: "static-promotion-1", operation: "promote", applicationId: "customer-alpha", environment: "production",
    activeGenerationId: "customer-alpha-green-1", previousGenerationId: "customer-alpha-blue-1", sourceCommit,
    compositionChangePlanDigest: planDigest, buildEvidenceDigest: buildDigest, applicationDigest, imageDigest,
    migrationRevision: 2, workerFencingToken: 2, promotionRevision: 1, revisionBefore: 0, revisionAfter: 1,
    rollbackWindow: { state: "open", windowId: "window-1", closesAt: "2026-08-30T00:00:00.000Z" }, contractCleanup: "blocked", occurredAt: "2026-08-29T00:00:00.000Z"
  } as const;
  const operation = {
    ...staticOperation,
    plan: {
      executionClass: "static-release", operationId: "operation-static-1", generationId: "customer-alpha-green-1",
      plan: { version: "1.0.0" },
      sourceChange: { planDigest, targetSourceCommit: sourceCommit },
      deployment: { buildRequestDigest: `sha256:${"a".repeat(64)}`, sourceCommit }, quarantineRecovery: true
    }
  } as unknown as ExtensionOperationStatus;
  const request = (status: "builder-attested" | "deployment-requested" | "deployed") => ({
    buildRequestDigest: operation.plan!.executionClass === "static-release" ? operation.plan.deployment.buildRequestDigest : "",
    applicationId: "customer-alpha", environment: "production", version: "1.0.0", sourceCommit, changePlanDigest: planDigest, status,
    buildEvidenceDigest: buildDigest, applicationDigest, imageDigest,
    ...(status === "deployed" ? { generationId: "customer-alpha-green-1", migrationRevision: 2, workerFencingToken: 2, receipt } : {})
  });
  const admission = () => ({ admit: vi.fn(async (value: ExtensionOperationStatus) => ({ actor: value.actor, decisionId: `sha256:${"b".repeat(64)}` })) });

  it("admits a current decision with the original actor despite a changed decision id", async () => {
    const bound = { ...operation, requestDigest: await extensionOperationRequestDigest(operation.request) };
    const authorizer = { authorize: vi.fn(async () => ({ actor: bound.actor, decisionId: `sha256:${"9".repeat(64)}` })) };
    const value = new CurrentStaticReleaseOperationAdmission(authorizer);

    await expect(value.admit(bound)).resolves.toMatchObject({ actor: bound.actor });
    expect(authorizer.authorize).toHaveBeenCalledWith(expect.objectContaining({
      ...bound.request,
      requestDigest: bound.requestDigest
    }));
  });

  it("rejects an actor change through the concrete admission boundary", async () => {
    const bound = { ...operation, requestDigest: await extensionOperationRequestDigest(operation.request) };
    const value = new CurrentStaticReleaseOperationAdmission({ authorize: vi.fn(async () => ({ actor: { kind: "actor" as const, id: "user-2", approvalId: "approval-2" }, decisionId: `sha256:${"9".repeat(64)}` })) });

    await expect(value.admit(bound)).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });
  });

  it("routes an attested durable release through the supervisor and persists the exact receipt", async () => {
    const token = {};
    const requests = {
      readRequest: vi.fn(async () => request("builder-attested")),
      requestDeployment: vi.fn(async () => request("deployment-requested")),
      recordDeployment: vi.fn(async () => request("deployed")),
      recoverDeployment: vi.fn(async () => undefined)
    };
    const builds = { verifiedBuild: vi.fn(async () => token) };
    const reader = { read: vi.fn(() => ({ change: { planDigest, targetSourceCommit: sourceCommit }, evidenceDigest: buildDigest, evidence: { applicationSubject: { digest: applicationDigest }, imageSubject: { digest: imageDigest } } })) };
    const supervisor = { deploy: vi.fn(async () => ({ outcome: "promoted", receipt })), rollback: vi.fn(), recover: vi.fn(async () => undefined) };
    const leases = { acquire: vi.fn(async () => ({ workerOwner: "supervisor:phase-9", workerLeaseExpiresAt: "2026-08-29T00:01:00.000Z" })) };
    const value = new DurableStaticReleaseOperator(requests, builds, reader, supervisor as never, leases, admission());

    await expect(value.validate(operation)).resolves.toMatchObject({ valid: true, checks: expect.arrayContaining(["trusted-build", "exact-version"]) });
    await expect(value.execute(operation)).resolves.toEqual({ outcome: "promoted", receipt });
    expect(supervisor.deploy).toHaveBeenCalledWith({
      build: token,
      generationId: "customer-alpha-green-1",
      lifecycleAdmission: { operationId: operation.operationId, expectedRevision: operation.request.expectedRevision, extensionId: "module.sales", quarantineRecovery: true },
      workerOwner: "supervisor:phase-9",
      workerLeaseExpiresAt: "2026-08-29T00:01:00.000Z"
    });
    expect(requests.recordDeployment).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: "1.0.0", receipt }));
    await value.finalize(operation);
    expect(supervisor.recover).toHaveBeenCalledWith({ applicationId: "customer-alpha", environment: "production" });
  });

  it("denies durable deployment before request dispatch, worker lease, or supervisor work", async () => {
    const token = {};
    const requests = { readRequest: vi.fn(async () => request("builder-attested")), requestDeployment: vi.fn(), recordDeployment: vi.fn(), recoverDeployment: vi.fn() };
    const reader = { read: vi.fn(() => ({ change: { planDigest, targetSourceCommit: sourceCommit }, evidenceDigest: buildDigest, evidence: { applicationSubject: { digest: applicationDigest }, imageSubject: { digest: imageDigest } } })) };
    const supervisor = { deploy: vi.fn(), rollback: vi.fn() };
    const leases = { acquire: vi.fn() };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn(async () => token) }, reader, supervisor as never, leases, { admit: vi.fn(async () => { throw new Error("revoked"); }) });

    await expect(value.execute(operation)).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    expect(requests.requestDeployment).not.toHaveBeenCalled();
    expect(leases.acquire).not.toHaveBeenCalled();
    expect(supervisor.deploy).not.toHaveBeenCalled();
  });

  it("denies every static operation before reading its durable request", async () => {
    const denied = { admit: vi.fn(async () => { throw new Error("revoked"); }) };
    const requests = { readRequest: vi.fn(), requestDeployment: vi.fn(), recordDeployment: vi.fn(), recoverDeployment: vi.fn() };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn() }, { read: vi.fn() }, {} as never, { acquire: vi.fn() }, denied);
    const rollbackOperation = { ...operation, request: { ...operation.request, operation: "rollback" } } as ExtensionOperationStatus;

    await expect(value.validate(operation)).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(value.execute(operation)).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    await expect(value.rollback(rollbackOperation)).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });

    expect(denied.admit).toHaveBeenCalledTimes(3);
    expect(requests.readRequest).not.toHaveBeenCalled();
  });

  it("reauthorizes after a blocking worker lease before supervisor dispatch", async () => {
    const token = {};
    const requests = { readRequest: vi.fn(async () => request("builder-attested")), requestDeployment: vi.fn(async () => request("deployment-requested")), recordDeployment: vi.fn(), recoverDeployment: vi.fn(async () => undefined) };
    const reader = { read: vi.fn(() => ({ change: { planDigest, targetSourceCommit: sourceCommit }, evidenceDigest: buildDigest, evidence: { applicationSubject: { digest: applicationDigest }, imageSubject: { digest: imageDigest } } })) };
    const supervisor = { deploy: vi.fn(), rollback: vi.fn() };
    const leases = { acquire: vi.fn(async () => ({ workerOwner: "supervisor:phase-10", workerLeaseExpiresAt: "2026-09-01T00:01:00.000Z" })) };
    const admit = vi.fn()
      .mockResolvedValueOnce({ actor: operation.actor, decisionId: "decision-1" })
      .mockResolvedValueOnce({ actor: operation.actor, decisionId: "decision-2" })
      .mockResolvedValueOnce({ actor: operation.actor, decisionId: "decision-3" })
      .mockResolvedValueOnce({ actor: operation.actor, decisionId: "decision-4" })
      .mockRejectedValueOnce(new Error("revoked during lease"));
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn(async () => token) }, reader, supervisor as never, leases, { admit });

    await expect(value.execute(operation)).rejects.toMatchObject({ code: "AUTHORITY_UNAVAILABLE" });
    expect(leases.acquire).toHaveBeenCalledOnce();
    expect(supervisor.deploy).not.toHaveBeenCalled();
  });

  it("rejects a durable request that changes the persisted version or source authority", async () => {
    const requests = { readRequest: vi.fn(async () => ({ ...request("builder-attested"), version: "1.0.1" })), requestDeployment: vi.fn(), recordDeployment: vi.fn(), recoverDeployment: vi.fn() };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn() }, { read: vi.fn() }, {} as never, { acquire: vi.fn() }, admission());
    await expect(value.validate(operation)).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" } satisfies Partial<StaticReleaseOperatorError>);
  });

  it("rejects a deployed receipt that does not match its durable build authority", async () => {
    const requests = {
      readRequest: vi.fn(async () => ({ ...request("deployed"), receipt: { ...receipt, imageDigest: `sha256:${"0".repeat(64)}` } })),
      requestDeployment: vi.fn(), recordDeployment: vi.fn(), recoverDeployment: vi.fn()
    };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn() }, { read: vi.fn() }, {} as never, { acquire: vi.fn() }, admission());
    await expect(value.execute(operation)).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" } satisfies Partial<StaticReleaseOperatorError>);
  });

  it.each([
    ["missing", undefined],
    ["wrong", "customer-alpha-other-1"],
    ["same as active", "customer-alpha-green-1"]
  ])("rejects a supported static uninstall with %s previous-generation authority", async (_case, previousGenerationId) => {
    const uninstallReceipt = { ...receipt, previousGenerationId };
    const uninstallOperation = {
      ...operation,
      request: { ...operation.request, extension: { deliveryClass: "platform-plugin", id: "provider.schema-less" }, operation: "uninstall" },
      plan: { ...operation.plan, plan: { version: "1.0.0", currentGenerationId: "customer-alpha-blue-1" } }
    } as unknown as ExtensionOperationStatus;
    const requests = {
      readRequest: vi.fn(async () => ({ ...request("deployed"), receipt: uninstallReceipt })),
      requestDeployment: vi.fn(), recordDeployment: vi.fn(), recoverDeployment: vi.fn()
    };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn() }, { read: vi.fn() }, {} as never, { acquire: vi.fn() }, admission());
    await expect(value.execute(uninstallOperation)).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" } satisfies Partial<StaticReleaseOperatorError>);
  });

  it("recovers a committed promotion before retrying the supervisor side effect", async () => {
    const requests = {
      readRequest: vi.fn(async () => request("deployment-requested")),
      requestDeployment: vi.fn(async () => request("deployment-requested")),
      recordDeployment: vi.fn(),
      recoverDeployment: vi.fn(async () => request("deployed"))
    };
    const token = {};
    const reader = { read: vi.fn(() => ({ change: { planDigest, targetSourceCommit: sourceCommit }, evidenceDigest: buildDigest, evidence: { applicationSubject: { digest: applicationDigest }, imageSubject: { digest: imageDigest } } })) };
    const supervisor = { deploy: vi.fn(), rollback: vi.fn() };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn(async () => token) }, reader, supervisor as never, { acquire: vi.fn() }, admission());

    await expect(value.execute(operation)).resolves.toEqual({ outcome: "promoted", receipt });
    expect(requests.recoverDeployment).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: operation.request.expectedRevision, targetGenerationId: "customer-alpha-green-1", operation: "promote" }));
    expect(supervisor.deploy).not.toHaveBeenCalled();
  });

  it("routes a rollback through the durable transition and persists its rollback receipt", async () => {
    const rollbackReceipt = { ...receipt, receiptId: "static-rollback-2", operation: "rollback", revisionBefore: 1, revisionAfter: 2, workerFencingToken: 3, promotionRevision: 2 } as const;
    const rollbackOperation = { ...operation, request: { ...operation.request, operation: "rollback" } } as ExtensionOperationStatus;
    const token = {};
    const requests = {
      readRequest: vi.fn(async () => request("builder-attested")),
      requestDeployment: vi.fn(async () => request("deployment-requested")),
      recordDeployment: vi.fn(async () => ({ ...request("deployed"), workerFencingToken: 3, receipt: rollbackReceipt })),
      recoverDeployment: vi.fn(async () => undefined)
    };
    const reader = { read: vi.fn(() => ({ change: { planDigest, targetSourceCommit: sourceCommit }, evidenceDigest: buildDigest, evidence: { applicationSubject: { digest: applicationDigest }, imageSubject: { digest: imageDigest } } })) };
    const supervisor = { deploy: vi.fn(), rollback: vi.fn(async () => rollbackReceipt) };
    const value = new DurableStaticReleaseOperator(requests, { verifiedBuild: vi.fn(async () => token) }, reader, supervisor as never, { acquire: vi.fn(async () => ({ workerOwner: "supervisor:phase-9", workerLeaseExpiresAt: "2026-08-29T00:01:00.000Z" })) }, admission());

    await expect(value.rollback(rollbackOperation)).resolves.toEqual(rollbackReceipt);
    expect(supervisor.rollback).toHaveBeenCalledWith({ applicationId: "customer-alpha", environment: "production", workerOwner: "supervisor:phase-9", workerLeaseExpiresAt: "2026-08-29T00:01:00.000Z" });
    expect(requests.recordDeployment).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: "1.0.0", receipt: rollbackReceipt }));
  });
});
