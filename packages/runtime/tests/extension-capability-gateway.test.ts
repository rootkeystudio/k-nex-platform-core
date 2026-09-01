import { describe, expect, it } from "vitest";

import {
  ExtensionCapabilityGateway,
  HmacExtensionCapabilityTokens,
  InMemoryExtensionCapabilitySequenceStoreForTests,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function gateway() {
  return new ExtensionCapabilityGateway(tokens, { "records.query": handler }, { reauthorize: () => true }, new InMemoryExtensionCapabilitySequenceStoreForTests(clock), clock, { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 });
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
    const calls = new ExtensionCapabilityGateway(tokens, { "records.query": handler, "records.action": handler }, { reauthorize: () => true }, new InMemoryExtensionCapabilitySequenceStoreForTests(clock), clock, { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 });
    await expect(calls.invoke({ token: value, invocationId: "runner-invocation-2", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.action", payload: {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    const [version, payload, signature] = value.split(".");
    const forgedClaims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    forgedClaims.grants[0].operations.push("action");
    const forged = `${version}.${Buffer.from(JSON.stringify(forgedClaims)).toString("base64url")}.${signature}`;
    await expect(calls.invoke({ token: forged, invocationId: "runner-invocation-2", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.action", payload: {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });

  it("issues a fail-closed token for an app that declares no host capabilities", async () => {
    const value = tokens.issue({
      tokenId: "capability-token-3", applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant",
      generationId: "sales-assistant-generation-1", invocationId: "runner-invocation-3",
      actor: { principalId: "user:one", effectiveActorId: "user:one" }, correlationId: "runner-correlation-3", grants: [], ttlMs: 30_000
    });
    await expect(gateway().invoke({ token: value, invocationId: "runner-invocation-3", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("reauthorizes every invocation instead of treating token possession as authority", async () => {
    let current = true;
    const calls = new ExtensionCapabilityGateway(tokens, { "records.query": handler }, { reauthorize: () => current }, new InMemoryExtensionCapabilitySequenceStoreForTests(clock), clock, { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 });
    const value = token();
    await calls.invoke({ token: value, invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: {}, signal: new AbortController().signal });
    current = false;
    await expect(calls.invoke({ token: value, invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 2, capability: "records.query", payload: {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "AUTHORITY_DENIED" });
  });

  it("stops a pre-aborted capability call before any gateway work", async () => {
    let reauthorizations = 0;
    let claims = 0;
    let handlers = 0;
    const calls = new ExtensionCapabilityGateway(
      tokens,
      { "records.query": { ...handler, invoke() { handlers += 1; } } },
      { reauthorize() { reauthorizations += 1; return true; } },
      { claim() { claims += 1; return true; } },
      clock,
      { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 }
    );
    const controller = new AbortController();
    const cancellation = new Error("cancelled");
    controller.abort(cancellation);
    await expect(calls.invoke({ token: token(), invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: {}, signal: controller.signal })).rejects.toBe(cancellation);
    expect({ reauthorizations, claims, handlers }).toEqual({ reauthorizations: 0, claims: 0, handlers: 0 });
  });

  it("does not claim or invoke when aborted while authority is pending", async () => {
    const authorization = deferred<boolean>();
    let reauthorizations = 0;
    let claims = 0;
    let handlers = 0;
    const calls = new ExtensionCapabilityGateway(
      tokens,
      { "records.query": { ...handler, invoke() { handlers += 1; } } },
      { reauthorize() { reauthorizations += 1; return authorization.promise; } },
      { claim() { claims += 1; return true; } },
      clock,
      { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 }
    );
    const controller = new AbortController();
    const pending = calls.invoke({ token: token(), invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: {}, signal: controller.signal });
    const cancellation = new Error("cancelled during authority");
    controller.abort(cancellation);
    authorization.resolve(true);
    await expect(pending).rejects.toBe(cancellation);
    expect({ reauthorizations, claims, handlers }).toEqual({ reauthorizations: 1, claims: 0, handlers: 0 });
  });

  it("allows a completed claim but never invokes when aborted while claiming", async () => {
    const sequence = deferred<boolean>();
    let reauthorizations = 0;
    let claims = 0;
    let handlers = 0;
    const calls = new ExtensionCapabilityGateway(
      tokens,
      { "records.query": { ...handler, invoke() { handlers += 1; } } },
      { reauthorize() { reauthorizations += 1; return true; } },
      { claim() { claims += 1; return sequence.promise; } },
      clock,
      { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 }
    );
    const controller = new AbortController();
    const pending = calls.invoke({ token: token(), invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: {}, signal: controller.signal });
    await Promise.resolve();
    expect(claims).toBe(1);
    const cancellation = new Error("cancelled during claim");
    controller.abort(cancellation);
    sequence.resolve(true);
    await expect(pending).rejects.toBe(cancellation);
    expect({ reauthorizations, claims, handlers }).toEqual({ reauthorizations: 1, claims: 1, handlers: 0 });
  });

  it("passes the caller's exact signal to the handler", async () => {
    let received: AbortSignal | undefined;
    const calls = new ExtensionCapabilityGateway(
      tokens,
      { "records.query": { ...handler, invoke(_claims, _input, signal) { received = signal; return {}; } } },
      { reauthorize() { return true; } },
      { claim() { return true; } },
      clock,
      { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 2 }
    );
    const controller = new AbortController();
    await calls.invoke({ token: token(), invocationId: "runner-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "records.query", payload: {}, signal: controller.signal });
    expect(received).toBe(controller.signal);
  });
});
