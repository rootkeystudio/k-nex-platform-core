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
});
