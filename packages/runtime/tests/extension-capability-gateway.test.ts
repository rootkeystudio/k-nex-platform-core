import { describe, expect, it } from "vitest";

import {
  ExtensionCapabilityGateway,
  HmacExtensionCapabilityTokens,
  type ExtensionCapabilityHandler
} from "../src/extension-capability-gateway.js";

const clock = { value: new Date("2026-08-29T10:00:00.000Z"), now() { return this.value; } };
const tokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(9), clock);
const token = () => tokens.issue({
  tokenId: "capability-token-1", applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant",
  generationId: "sales-assistant-generation-1", invocationId: "runner-invocation-1",
  actor: { principalId: "user:one", effectiveActorId: "user:one" }, correlationId: "runner-correlation-1",
  grants: [{ kind: "records", required: true, reason: "Read assigned sales tasks.", operations: ["query"], resources: [{ id: "sales.tasks", version: 1 }] }], ttlMs: 30_000
});
const handler: ExtensionCapabilityHandler = {
  validateInput(value) { if (typeof value !== "object" || value === null) throw new Error("invalid input"); return value; },
  invoke(context, input) { return { applicationId: context.applicationId, actor: context.actor.effectiveActorId, input }; },
  validateOutput(value) { return value; }
};

function gateway() {
  return new ExtensionCapabilityGateway(tokens, { "records.query": handler }, clock, { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 });
}

describe("extension capability authority", () => {
  it("binds declared capability calls to short-lived app, generation, invocation, actor, and sequence identity", async () => {
    const value = token();
    await expect(gateway().invoke({ token: value, invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: { query: "mine" }, signal: new AbortController().signal }))
      .resolves.toEqual({ applicationId: "customer-alpha", actor: "user:one", input: { query: "mine" } });
  });

  it("fails closed on tampering, undeclared capability, identity mixing, replay, expiry, and payload budgets", async () => {
    const value = token();
    const calls = gateway();
    const base = { token: value, invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query" as const, payload: {}, signal: new AbortController().signal };
    await expect(calls.invoke({ ...base, token: `${value.slice(0, -1)}x` })).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    await expect(calls.invoke({ ...base, capability: "records.action" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(calls.invoke({ ...base, generationId: "other-generation-1" })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(() => calls.assertInvocationIdentity(value, {
      applicationId: "customer-alpha", environment: "production", appId: "app.forecast", generationId: "sales-assistant-generation-1", invocationId: "runner-invocation-1"
    })).toThrow(expect.objectContaining({ code: "IDENTITY_MISMATCH" }));
    await calls.invoke(base);
    await expect(calls.invoke(base)).rejects.toMatchObject({ code: "SEQUENCE_INVALID" });
    await expect(gateway().invoke({ ...base, payload: { nested: { too: { deeply: { for: { gateway: true } } } } } })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    clock.value = new Date("2026-08-29T10:00:31.000Z");
    await expect(gateway().invoke(base)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    clock.value = new Date("2026-08-29T10:00:00.000Z");
  });

  it("cryptographically binds closed contract grants and maps each callable ID to its exact operation", async () => {
    const value = tokens.issue({
      tokenId: "capability-token-2", applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant",
      generationId: "sales-assistant-generation-1", invocationId: "runner-invocation-2",
      actor: { principalId: "user:one", effectiveActorId: "user:one" }, correlationId: "runner-correlation-2",
      grants: [{ kind: "records", required: true, reason: "Read assigned sales tasks.", operations: ["query"], resources: [{ id: "sales.tasks", version: 1 }] }], ttlMs: 30_000
    });
    const calls = new ExtensionCapabilityGateway(tokens, { "records.query": handler, "records.action": handler }, clock, { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 });
    await expect(calls.invoke({ token: value, invocationId: "runner-invocation-2", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.action", payload: {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    const [version, payload, signature] = value.split(".");
    const forgedClaims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    forgedClaims.grants[0].operations.push("action");
    const forged = `${version}.${Buffer.from(JSON.stringify(forgedClaims)).toString("base64url")}.${signature}`;
    await expect(calls.invoke({ token: forged, invocationId: "runner-invocation-2", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.action", payload: {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });
});
