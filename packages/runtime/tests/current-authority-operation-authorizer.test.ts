import { describe, expect, it, vi } from "vitest";

import {
  CurrentAuthorityOperationAuthorizer
} from "../src/current-authority-operation-authorizer.js";
import { createTrustedAuthorizationSession } from "../src/effective-authority.js";
import type { EffectiveAuthorizationRequest, TrustedAuthorizationSession } from "../src/effective-authority.js";
import type { OperationAuthorizationRequest } from "../src/plugin-manager.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const baseRequest: OperationAuthorizationRequest = Object.freeze({
  applicationId: "customer-alpha",
  environment: "production",
  extension: Object.freeze({ deliveryClass: "hot-application", id: "app.sales-assistant" }),
  operation: "install",
  requestDigest: digest("a"),
  expectedRevision: 7
});

const session = createTrustedAuthorizationSession({
  schemaVersion: 1,
  applicationId: baseRequest.applicationId,
  environment: baseRequest.environment,
  correlationId: "extension-auth-correlation-1",
  principal: { kind: "user", id: "user:admin" },
  effectiveActor: { kind: "user", id: "user:admin" }
});
const actor = Object.freeze({ kind: "actor" as const, id: "user:admin", approvalId: "approval:extension-change" });

function decision(trustedSession: TrustedAuthorizationSession, request: Readonly<{ decisionId: string; permissionId: string; scope: unknown }>, outcome: "allow" | "deny" = "allow", revisions: Readonly<{ authorizationRevision: number; lifecycleRevision: number }> = { authorizationRevision: 4, lifecycleRevision: 8 }) {
  return Object.freeze({
    schemaVersion: 1 as const,
    decisionId: request.decisionId,
    correlationId: trustedSession.correlationId,
    applicationId: trustedSession.applicationId,
    environment: trustedSession.environment,
    permissionId: request.permissionId,
    owner: { kind: "platform" as const, namespace: "system" as const },
    principal: trustedSession.principal,
    effectiveActor: trustedSession.effectiveActor,
    ...(trustedSession.delegation === undefined ? {} : { delegation: trustedSession.delegation }),
    scope: request.scope,
    authorizationRevision: revisions.authorizationRevision,
    lifecycleRevision: revisions.lifecycleRevision,
    outcome,
    reason: outcome === "allow" ? "granted" as const : "permission-not-granted" as const,
    approval: "not-required" as const,
    reauthentication: "not-required" as const
  });
}

function harness(options: Readonly<{
  current?: () => unknown | Promise<unknown>;
  session?: TrustedAuthorizationSession;
  actor?: typeof actor;
  decide?: (request: Readonly<{ decisionId: string; permissionId: string; scope: unknown }>, trustedSession: TrustedAuthorizationSession) => unknown | Promise<unknown>;
}> = {}) {
  const trustedSession = options.session ?? session;
  const trustedActor = options.actor ?? actor;
  const current = vi.fn(async () => options.current ? await options.current() : Object.freeze({ session: trustedSession, actor: trustedActor }));
  const authorize = vi.fn(async (_session: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) => options.decide ? await options.decide(request, trustedSession) : decision(trustedSession, request));
  return {
    current,
    authorize,
    authorizer: new CurrentAuthorityOperationAuthorizer({ current } as never, { authorize } as never)
  };
}

function request(input: Partial<OperationAuthorizationRequest> = {}): OperationAuthorizationRequest {
  return Object.freeze({ ...baseRequest, ...input });
}

describe("CurrentAuthorityOperationAuthorizer", () => {
  it.each([
    ["hot install", request(), ["system.extensions.plan", "system.extensions.install-hot"], "system.extensions"],
    ["re-enable", request({ operation: "enable" }), ["system.extensions.plan", "system.extensions.enable"], "system.extensions"],
    ["platform install", request({ extension: { deliveryClass: "platform-plugin", id: "module.sales" } }), ["system.extensions.plan", "system.extensions.deploy-platform-plugin"], "system.extensions"],
    ["theme install", request({ extension: { deliveryClass: "theme-skin", id: "skin.minimal-accent" } }), ["system.extensions.plan", "system.themes.manage"], "system.themes"],
    ["update", request({ operation: "update" }), ["system.extensions.plan", "system.extensions.update"], "system.extensions"],
    ["disable", request({ operation: "disable" }), ["system.extensions.plan", "system.extensions.disable"], "system.extensions"],
    ["rollback", request({ operation: "rollback" }), ["system.extensions.plan", "system.extensions.rollback"], "system.extensions"],
    ["uninstall", request({ operation: "uninstall" }), ["system.extensions.plan", "system.extensions.uninstall"], "system.extensions"]
  ] as const)("requires plan plus fixed permission for %s", async (_name, operation, permissions, operationResource) => {
    const value = harness();
    await expect(value.authorizer.authorize(operation)).resolves.toMatchObject({ actor });
    expect(value.current).toHaveBeenCalledWith(expect.objectContaining(operation));
    expect(value.authorize.mock.calls.map(([, input]) => input.permissionId).sort()).toEqual([...permissions].sort());
    const scopes = value.authorize.mock.calls.map(([, input]) => input.scope);
    expect(scopes).toContainEqual({ kind: "application", resource: "system.extensions" });
    expect(scopes).toContainEqual({ kind: "application", resource: operationResource });
  });

  it("requires both plan and operation decisions, with a decision ID tied to both", async () => {
    for (const deniedPermission of ["system.extensions.plan", "system.extensions.install-hot"] as const) {
      const value = harness({ decide: (input, trustedSession) => decision(trustedSession, input, input.permissionId === deniedPermission ? "deny" : "allow") });
      await expect(value.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }

    const value = harness();
    const first = await value.authorizer.authorize(baseRequest);
    const second = await value.authorizer.authorize(baseRequest);
    const changed = await value.authorizer.authorize(request({ requestDigest: digest("b") }));
    expect(first.decisionId).toBe(second.decisionId);
    expect(changed.decisionId).not.toBe(first.decisionId);

    const differentSession = createTrustedAuthorizationSession({
      schemaVersion: 1, applicationId: baseRequest.applicationId, environment: baseRequest.environment,
      correlationId: "extension-auth-correlation-2", principal: { kind: "user", id: "user:reviewer" }, effectiveActor: { kind: "user", id: "user:reviewer" }
    });
    const differentActor = Object.freeze({ kind: "actor" as const, id: "user:reviewer", approvalId: "approval:reviewer-change" });
    const differentContext = await harness({ session: differentSession, actor: differentActor }).authorizer.authorize(baseRequest);
    const approvalChanged = await harness({ actor: Object.freeze({ ...actor, approvalId: "approval:second-change" }) }).authorizer.authorize(baseRequest);
    expect(differentContext.decisionId).not.toBe(first.decisionId);
    expect(approvalChanged.decisionId).not.toBe(first.decisionId);
  });

  it("requires enable permission for a disabled-install re-enable", async () => {
    const value = harness({ decide: (input, trustedSession) => decision(
      trustedSession,
      input,
      input.permissionId === "system.extensions.enable" ? "deny" : "allow"
    ) });
    await expect(value.authorizer.authorize(request({ operation: "enable" }))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(value.authorize.mock.calls.map(([, input]) => input.permissionId).sort()).toEqual(["system.extensions.enable", "system.extensions.plan"]);
  });

  it.each([
    ["authorization", { authorizationRevision: 5, lifecycleRevision: 8 }],
    ["lifecycle", { authorizationRevision: 4, lifecycleRevision: 9 }]
  ] as const)("fails closed when plan and operation decisions have mixed %s revisions", async (_kind, revisions) => {
    const value = harness({ decide: (input, trustedSession) => decision(
      trustedSession,
      input,
      "allow",
      input.permissionId === "system.extensions.plan" ? { authorizationRevision: 4, lifecycleRevision: 8 } : revisions
    ) });
    await expect(value.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows matching authority revisions", async () => {
    const value = harness({ decide: (input, trustedSession) => decision(trustedSession, input, "allow", { authorizationRevision: 11, lifecycleRevision: 12 }) });
    await expect(value.authorizer.authorize(baseRequest)).resolves.toMatchObject({ actor });
  });

  it("fails closed for provider failure, raw sessions, and mismatched actor identity", async () => {
    const unavailable = harness({ current: () => { throw new Error("session unavailable"); } });
    await expect(unavailable.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const rawSession = harness({ current: () => ({ session: structuredClone(session), actor }) });
    await expect(rawSession.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(rawSession.authorize).not.toHaveBeenCalled();

    const forgedActor = harness({ current: () => ({ session, actor: { kind: "actor", id: "user:attacker", approvalId: "approval:forged" } }) });
    await expect(forgedActor.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(forgedActor.authorize).not.toHaveBeenCalled();

    const resolverFailure = harness({ decide: () => { throw new Error("resolver unavailable"); } });
    await expect(resolverFailure.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const malformedDecision = harness({ decide: () => ({ outcome: "allow" }) });
    await expect(malformedDecision.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const mismatchedPrincipal = harness({ decide: (input, trustedSession) => ({ ...decision(trustedSession, input), principal: { kind: "user", id: "user:attacker" } }) });
    await expect(mismatchedPrincipal.authorizer.authorize(baseRequest)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("ignores forged client permission and scope surface", async () => {
    const value = harness();
    const forged = Object.freeze({
      ...baseRequest,
      permissionId: "system.roles.manage",
      scope: { kind: "record", resource: "sales.records", recordId: "record:forged" },
      actor: { kind: "actor", id: "user:attacker", approvalId: "approval:forged" }
    }) as OperationAuthorizationRequest;
    await expect(value.authorizer.authorize(forged)).resolves.toMatchObject({ actor });
    expect(value.authorize.mock.calls.map(([, input]) => input.permissionId).sort()).toEqual(["system.extensions.install-hot", "system.extensions.plan"]);
    expect(value.authorize.mock.calls.map(([, input]) => input.scope)).toHaveLength(2);
    expect(value.authorize.mock.calls.every(([, input]) => input.scope.kind === "application" && input.scope.resource === "system.extensions")).toBe(true);
  });
});
