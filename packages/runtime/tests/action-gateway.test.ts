import { describe, expect, it } from "vitest";
import type { PluginManifest } from "@k-nex/contracts";

import { executeRegistration } from "../src/registration-runtime.js";
import { scopePluginRegistration } from "../src/plugin-lifecycle.js";
import { ActionGatewayError, RegisteredActionGateway } from "../src/action-gateway.js";

const inputSchema = { safeParse: (value: unknown) => typeof value === "object" && value !== null && (value as { value?: unknown }).value === "ok" ? { success: true as const, data: value } : { success: false as const, error: new Error("invalid") } };
const outputSchema = { safeParse: (value: unknown) => typeof value === "object" && value !== null && typeof (value as { allowed?: unknown }).allowed === "boolean" ? { success: true as const, data: value } : { success: false as const, error: new Error("invalid") } };
const definition = {
  descriptor: {
    id: "fixture.action.run", version: 1, ownerPluginId: "module.fixture",
    inputSchema: { type: "object", properties: { value: { type: "string", minLength: 1 } }, required: ["value"], additionalProperties: false },
    outputSchema: { type: "object", properties: { allowed: { type: "boolean" } }, required: ["allowed"], additionalProperties: false },
    permission: "fixture.write", policy: "fixture.policy", effect: "write", idempotency: "required", dryRun: false
  },
  inputSchema,
  outputSchema
};

function registration() {
  const manifest: PluginManifest = {
    apiVersion: 1, id: "module.fixture", kind: "module", displayName: "Fixture", version: "1.0.0", package: "fixture",
    compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
    provides: [], requires: [], optional: [], conflicts: [],
    lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "unsupported" },
    contributions: { permissions: { "fixture.write": "required" }, actions: { "fixture.action.run": "required" } }
  };
  return scopePluginRegistration(executeRegistration({
    graph: { resolverVersion: "1.0.0", plugins: [{ id: "module.fixture", kind: "module", package: "fixture", version: "1.0.0", integrity: "sha512-fixture", required: [], optional: [] }], capabilityProviders: [], registrationOrder: ["module.fixture"] },
    installed: [{ package: { name: "fixture", version: "1.0.0", integrity: "sha512-fixture" }, manifest }],
    registrations: [{ pluginId: "module.fixture", contracts(context) {
      context.register("permissions", "fixture.write", {
        id: "fixture.write", ownerPluginId: "module.fixture", title: "Write fixture", description: "Write fixture.",
        audience: "authenticated", resource: "fixture.action", operation: "write",
        policy: { id: "fixture.policy", scope: "application", recordScoped: false, fieldScoped: false }
      });
      context.register("actions", "fixture.action.run", definition);
    }, dataHandlers(context) { context.bind("actions", "fixture.action.run", ({ authorizationContext }) => authorizationContext); } }]
  }), []);
}

describe("registered action gateway", () => {
  it("passes only the policy decision to the handler", async () => {
    const gateway = new RegisteredActionGateway(registration(), {
      authenticate: () => ({ actor: {}, request: {}, authorizationContext: { forged: true } })
    }, { authorize: () => ({ allowed: true }) });
    const response = await gateway.execute({ correlationId: "c1", rawRequest: {}, actionId: "fixture.action.run", input: { value: "ok" }, idempotencyKey: "i1", signal: new AbortController().signal });
    expect(response).toMatchObject({ ok: true, body: { data: { allowed: true } } });
  });

  it("fails closed for unknown actions, invalid input, missing idempotency, and policy denial", async () => {
    const gateway = new RegisteredActionGateway(registration(), { authenticate: () => ({ actor: {}, request: {}, authorizationContext: {} }) }, {
      authorize: () => { throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden."); }
    });
    const base = { correlationId: "c1", rawRequest: {}, actionId: "fixture.action.run", input: { value: "ok" }, idempotencyKey: "i1", signal: new AbortController().signal };
    await expect(gateway.execute({ ...base, actionId: "other" })).resolves.toMatchObject({ ok: false, status: 404 });
    await expect(gateway.execute({ ...base, input: "bad" })).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(gateway.execute({ ...base, idempotencyKey: undefined })).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(gateway.execute(base)).resolves.toMatchObject({ ok: false, status: 403 });
  });
});
