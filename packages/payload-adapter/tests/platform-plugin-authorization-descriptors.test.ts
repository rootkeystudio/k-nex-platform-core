import { describe, expect, it, vi } from "vitest";

import { executeRegistration, scopePlatformPluginRegistration, type ScopedRegistrationResult } from "@k-nex/runtime";

import { createStaticPlatformPluginAuthorizationDescriptorResolver } from "../src/platform-plugin-authorization-descriptors.js";
import type { RuntimeExtensionSession } from "../src/runtime-extension-store.js";

const applicationId = "customer-alpha";
const environment = "production";
const pluginId = "module.sales";
const currentSourceCommit = "a".repeat(40);
const previousSourceCommit = "b".repeat(40);

function registration(sourcePluginId = pluginId, descriptorPluginId = sourcePluginId, permissionId = descriptorPluginId === "module.sales" ? "sales.orders.read" : "other.orders.read"): ScopedRegistrationResult {
  const descriptor = {
    schemaVersion: 1, id: permissionId,
    publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: descriptorPluginId },
    title: "Read orders", description: "Read orders through the registered extension.", audience: "authenticated",
    resource: descriptorPluginId === "module.sales" ? "sales.orders" : "other.orders", operation: "read", scope: "application"
  } as const;
  const manifest = {
    apiVersion: 1, id: sourcePluginId, kind: "module", displayName: "Fixture", version: "1.0.0", package: "@k-nex/fixture",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" },
    contributions: { permissions: { [descriptor.id]: "required" } }
  } as const;
  const raw = executeRegistration({
    graph: { resolverVersion: "1.0.0", plugins: [{ id: sourcePluginId, kind: "module", package: manifest.package, version: "1.0.0", integrity: "sha512-fixture", required: [], optional: [] }], capabilityProviders: [], registrationOrder: [sourcePluginId] },
    installed: [{ package: { name: manifest.package, version: "1.0.0", integrity: "sha512-fixture" }, manifest }],
    registrations: [{ pluginId: sourcePluginId, contracts(context) { context.register("permissions", descriptor.id, descriptor); } }]
  });
  return scopePlatformPluginRegistration(raw, []);
}

function transition(operation: "install" | "update" | "rollback" | "disable" | "uninstall", sourceCommit = currentSourceCommit) {
  const lifecycleState = operation === "disable" ? "disabled" : operation === "uninstall" ? "removed" : "active";
  return {
    schemaVersion: 1, applicationId, environment, eventId: "event-1", eventType: "extension.lifecycle-transition",
    operationId: "operation-1", operation, operationPhase: "completed", lifecycleState,
    expectedRevision: 1, revision: 2, inventoryRevision: 2, actor: { kind: "trusted-automation", identity: "test.lifecycle" },
    receiptId: "receipt-1", auditId: "audit-1", idempotencyKey: "lifecycle:test:1", correlationId: "correlation-1",
    occurredAt: "2026-09-01T00:00:00.000Z", deliveryClass: "platform-plugin", id: pluginId,
    evidence: { sourceCommit, compositionChangePlanDigest: `sha256:${"c".repeat(64)}`, generationId: "host-generation-2" }
  } as const;
}

function session(retainedGeneration: unknown = null) {
  const query = vi.fn(async <T extends object>() => ({ rows: [{ retained_generation: retainedGeneration }] as T[] }));
  return { query, release: vi.fn() } satisfies RuntimeExtensionSession;
}

describe("static Platform Plugin authorization descriptor resolver", () => {
  it.each(["install", "update", "rollback", "disable"] as const)("uses the exact transition source commit for %s", async (operation) => {
    const resolve = createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId, registrations: [{ sourceCommit: currentSourceCommit, registration: registration() }]
    });
    const value = session();

    await expect(resolve(value, transition(operation))).resolves.toMatchObject([{ id: "sales.orders.read" }]);
    expect(value.query).not.toHaveBeenCalled();
  });

  it("uses the retained pre-removal registration for static uninstall", async () => {
    const resolve = createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId,
      registrations: new Map([[currentSourceCommit, registration()], [previousSourceCommit, registration()]])
    });
    const value = session({ authority: "static-build", sourceCommit: previousSourceCommit, generationId: "plugin-generation-1" });

    await expect(resolve(value, transition("uninstall", currentSourceCommit))).resolves.toMatchObject([{ id: "sales.orders.read" }]);
    expect(value.query).toHaveBeenCalledWith(expect.stringContaining("retained_generation"), [applicationId, environment, pluginId]);
  });

  it("fails closed when static uninstall has malformed retained generation evidence", async () => {
    const resolve = createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId, registrations: [{ sourceCommit: currentSourceCommit, registration: registration() }]
    });

    await expect(resolve(session({ authority: "static-build", sourceCommit: "not-a-commit", generationId: "wrong" }), transition("uninstall")))
      .rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
  });

  it("resolves incompatible-update descriptors from the distinct trusted prior source commit", async () => {
    const resolve = createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId,
      registrations: [
        { sourceCommit: currentSourceCommit, registration: registration(pluginId, pluginId, "sales.orders.write") },
        { sourceCommit: previousSourceCommit, registration: registration(pluginId, pluginId, "sales.orders.read") }
      ]
    });
    const value = session();
    const prior = { authority: "static-build", sourceCommit: previousSourceCommit, generationId: "plugin-generation-1" };

    await expect(resolve(value, transition("update"))).resolves.toMatchObject([{ id: "sales.orders.write" }]);
    await expect(resolve(value, transition("update"), prior)).resolves.toMatchObject([{ id: "sales.orders.read" }]);
    await expect(resolve(value, transition("update"), { ...prior, sourceCommit: "f".repeat(40) })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
  });

  it("fails closed for mismatched source, application, plugin, duplicate registry, or non-Platform Plugin input", async () => {
    const trusted = registration();
    const resolve = createStaticPlatformPluginAuthorizationDescriptorResolver({ applicationId, registrations: [{ sourceCommit: currentSourceCommit, registration: trusted }] });
    const value = session();

    await expect(resolve(value, transition("install", previousSourceCommit))).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(resolve(value, { ...transition("install"), applicationId: "customer-beta" })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(resolve(value, { ...transition("install"), id: "module.other" })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(resolve(value, { ...transition("install"), deliveryClass: "hot-application", id: "app.sales" } as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(() => createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId, registrations: [{ sourceCommit: currentSourceCommit, registration: trusted }, { sourceCommit: currentSourceCommit, registration: trusted }]
    })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
