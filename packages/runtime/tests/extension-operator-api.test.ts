import { readFileSync } from "node:fs";

import type { RuntimeExtensionInventory } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import { ExtensionOperatorApi, type ExtensionOperationStatus } from "../src/index.js";

const load = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const inventory = load("../../../fixtures/extensions/valid/runtime-extension-inventory.json") as RuntimeExtensionInventory;
const runnerIsolation = load("../../../fixtures/extensions/valid/runner-isolation-profile.json");
const remoteUiIsolation = load("../../../fixtures/extensions/valid/remote-ui-isolation-profile.json");
const dynamicOperation = {
  operationId: "operation-dynamic-1",
  request: { applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", expectedRevision: 0, idempotencyKey: "install:app.sales-assistant:1", correlationId: "correlation-dynamic-1" },
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
  const lifecycleOperations = [operationFor("disable"), operationFor("uninstall"), operationFor("rollback", "static-release")];
  const operations = new Map([dynamicOperation, staticOperation, ...lifecycleOperations].map((operation) => [operation.operationId, operation]));
  const manager = {
    plan: vi.fn(), stage: vi.fn(), validate: vi.fn(async () => ({ operationId: dynamicOperation.operationId, executionClass: "live-generation", phase: "staged", valid: true, checks: ["verified-bundle"] })),
    operation: vi.fn(async (id: string) => operations.get(id)!), activate: vi.fn(async () => ({ operation: "install" })), rollback: vi.fn(async () => ({ operation: "rollback" })),
    disable: vi.fn(async () => ({ operation: "disable" })), uninstall: vi.fn(async () => ({ operation: "uninstall" })), inventory: vi.fn(async () => inventory)
  };
  const catalog = { list: vi.fn(async () => [
    { extension: { deliveryClass: "theme-skin", id: "skin.minimal-accent" }, version: "1.0.0", displayName: "Minimal Accent", support: "supported", review: "approved", security: "clear", revoked: false, availability: "live-generation" },
    { extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, version: "1.0.0", displayName: "Sales Assistant", support: "supported", review: "approved", security: "compromised", revoked: true, availability: "live-generation" },
    { extension: { deliveryClass: "platform-plugin", id: "module.sales" }, version: "1.1.0", displayName: "Sales", support: "supported", review: "approved", security: "clear", revoked: false, availability: "static-release" }
  ] as const) };
  const staticReleases = {
    validate: vi.fn(async () => ({ operationId: staticOperation.operationId, executionClass: "static-release", phase: "build-attested", valid: true, checks: ["trusted-build"] })),
    execute: vi.fn(async () => ({ outcome: "maintenance-required", reasons: ["offline-migration"] })),
    rollback: vi.fn(async () => ({ operation: "rollback" }))
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
    await expect(value.api.catalogList({ includeUnavailable: true, deliveryClass: "hot-application" })).resolves.toHaveLength(1);
    await expect(value.api.catalogDetail({ deliveryClass: "platform-plugin", id: "module.sales" }, "1.1.0")).resolves.toMatchObject({ availability: "static-release" });
    await expect(value.api.catalogDetail({ deliveryClass: "platform-plugin", id: "module.sales" }, "latest")).rejects.toThrow();
    const records = await value.catalog.list();
    value.catalog.list.mockResolvedValueOnce([...records, records[0]]);
    await expect(value.api.catalogList({ includeUnavailable: true })).rejects.toThrow("duplicate extension releases");
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
    await value.api.rollback("operation-static-release-rollback");
    expect(value.staticReleases.validate).toHaveBeenCalledOnce();
    expect(value.staticReleases.execute).toHaveBeenCalledOnce();
    expect(value.staticReleases.rollback).toHaveBeenCalledOnce();
    await expect(value.api.disable(dynamicOperation.operationId)).rejects.toThrow("not authorized for this lifecycle action");
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
