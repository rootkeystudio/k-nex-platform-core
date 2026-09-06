import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision } from "@k-nex/contracts";

import {
  CurrentAuthorityAdapter,
  createCurrentAuthorityTarget
} from "../src/current-authority-adapter.js";
import {
  createTrustedAuthorizationSession,
  type EffectiveAuthorityResolver,
  type EffectiveAuthorizationRequest,
  type TrustedAuthorizationSession
} from "../src/effective-authority.js";

const session = (): TrustedAuthorizationSession => createTrustedAuthorizationSession({
  schemaVersion: 1,
  applicationId: "customer-alpha",
  environment: "production",
  correlationId: "correlation:one",
  principal: { kind: "user", id: "user:one" },
  effectiveActor: { kind: "user", id: "user:one" }
});

const target = () => createCurrentAuthorityTarget({
  permissionId: "system.settings.read",
  scope: { kind: "application", resource: "system.settings" },
  facts: { boundary: "settings" }
});

function decision(value: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny" = "allow"): AuthorizationDecision {
  return {
    schemaVersion: 1,
    decisionId: value.decisionId,
    correlationId: current.correlationId,
    applicationId: current.applicationId,
    environment: current.environment,
    permissionId: value.permissionId,
    owner: { kind: "platform", namespace: "system" },
    principal: current.principal,
    effectiveActor: current.effectiveActor,
    scope: value.scope,
    authorizationRevision: 1,
    lifecycleRevision: 1,
    outcome,
    reason: outcome === "allow" ? "granted" : "policy-denied",
    approval: "not-required",
    reauthentication: "not-required"
  };
}

function resolver(handler: (current: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) => Promise<AuthorizationDecision>): Pick<EffectiveAuthorityResolver, "authorize"> {
  return { authorize: vi.fn(handler) } as unknown as Pick<EffectiveAuthorityResolver, "authorize">;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

describe("current authority adapter", () => {
  it("authorizes only a branded server-selected target", async () => {
    const current = session();
    const authority = resolver(async (active, request) => decision(request, active));
    const adapter = new CurrentAuthorityAdapter({ current: async () => current }, authority);

    await expect(adapter.allows({ boundary: "settings" }, target())).resolves.toBe(true);
    expect(authority.authorize).toHaveBeenCalledOnce();
    await expect(adapter.allows({}, structuredClone(target()) as never)).resolves.toBe(false);
    expect(() => createCurrentAuthorityTarget({ permissionId: "system.settings.read", scope: { kind: "application", resource: "system.settings" }, facts: {}, actor: "user:forged" })).toThrow();
  });

  it("fails closed for denied, failed, aborted, raw, and cloned sessions", async () => {
    const current = session();
    const denied = resolver(async (active, request) => decision(request, active, "deny"));
    const adapter = new CurrentAuthorityAdapter({ current: async () => current }, denied);
    await expect(adapter.allows({}, target())).resolves.toBe(false);

    const failing = new CurrentAuthorityAdapter({ current: async () => current }, resolver(async () => { throw new Error("policy failed"); }));
    await expect(failing.allows({}, target())).resolves.toBe(false);

    const raw = new CurrentAuthorityAdapter({ current: async () => ({ ...current } as TrustedAuthorizationSession) }, denied);
    const cloned = new CurrentAuthorityAdapter({ current: async () => structuredClone(current) }, denied);
    await expect(raw.allows({}, target())).resolves.toBe(false);
    await expect(cloned.allows({}, target())).resolves.toBe(false);

    const controller = new AbortController();
    controller.abort();
    await expect(adapter.allows({}, target(), controller.signal)).resolves.toBe(false);

    const timedOut = new CurrentAuthorityAdapter({ current: async () => current }, resolver(async () => await new Promise<AuthorizationDecision>(() => undefined)));
    const timeoutController = new AbortController();
    setTimeout(() => timeoutController.abort(), 0);
    await expect(timedOut.allows({}, target(), timeoutController.signal)).resolves.toBe(false);
  });

  it("owns a bounded deadline for unresolved session and resolver calls", async () => {
    const never = new Promise<never>(() => undefined);
    const waitingSession = new CurrentAuthorityAdapter({ current: async () => never }, resolver(async () => never), 5);
    await expect(waitingSession.allows({}, target())).resolves.toBe(false);

    const waitingResolver = new CurrentAuthorityAdapter({ current: async () => session() }, resolver(async () => never), 5);
    await expect(waitingResolver.allows({}, target())).resolves.toBe(false);
  });

  it("drains raw session work without admitting a resolver after closure", async () => {
    const current = deferred<TrustedAuthorizationSession>();
    const authority = resolver(async (active, request) => decision(request, active));
    const adapter = new CurrentAuthorityAdapter({ current: () => current.promise }, authority, 5);
    const authorization = adapter.allows({}, target());
    const draining = adapter.drain();
    let drained = false;
    void draining.then(() => { drained = true; });
    await expect(authorization).resolves.toBe(false);
    await Promise.resolve();
    expect(drained).toBe(false);
    current.resolve(session());
    await expect(draining).resolves.toBeUndefined();
    expect(authority.authorize).not.toHaveBeenCalled();
    await expect(adapter.allows({}, target())).resolves.toBe(false);
  });

  it("drains raw resolver work concurrently and absorbs delayed rejection", async () => {
    const active = session();
    const resolution = deferred<AuthorizationDecision>();
    const entered = deferred<void>();
    const authority = resolver(() => { entered.resolve(); return resolution.promise; });
    const adapter = new CurrentAuthorityAdapter({ current: async () => active }, authority, 100);
    const authorization = adapter.allows({}, target());
    await entered.promise;
    expect(authority.authorize).toHaveBeenCalledOnce();
    await expect(authorization).resolves.toBe(false);
    const first = adapter.drain();
    const second = adapter.drain();
    let firstDone = false;
    void first.then(() => { firstDone = true; });
    await Promise.resolve();
    expect(firstDone).toBe(false);
    resolution.reject(new Error("late resolver failure"));
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(adapter.allows({}, target())).resolves.toBe(false);
    expect(authority.authorize).toHaveBeenCalledOnce();
  });
});
