import { describe, expect, it, vi } from "vitest";
import type { AuthorizationDecision } from "@k-nex/contracts";

import {
  CurrentAuthorityActionGatewayPolicy,
  CurrentAuthorityCapabilityAuthorization,
  CurrentAuthorityDataSourcePolicy,
  CurrentAuthorityHotApplicationCapabilityAuthorization,
  CurrentAuthorityPermissionProjection,
  CurrentAuthorityRemoteUiFrameAuthorization,
  CurrentAuthorityRealtimeTopicAuthorization,
  CurrentAuthoritySettingsAuthorization,
  CurrentAuthorityToolAuthorization,
  createCurrentAuthorityCapabilityTargetRegistry
} from "../src/current-authority-policies.js";
import { CurrentAuthorityAdapter, createCurrentAuthorityTarget } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession, type EffectiveAuthorityResolver, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { PluginSettingsService } from "../src/plugin-settings.js";

const session = (): TrustedAuthorizationSession => createTrustedAuthorizationSession({
  schemaVersion: 1, applicationId: "customer-alpha", environment: "production", correlationId: "correlation:one",
  principal: { kind: "user", id: "user:one" }, effectiveActor: { kind: "user", id: "user:one" }
});

function target(permissionId: string) {
  return createCurrentAuthorityTarget({ permissionId, scope: { kind: "application", resource: "system.settings" }, facts: { registered: true } });
}

function decision(request: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny"): AuthorizationDecision {
  return {
    schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId,
    applicationId: current.applicationId, environment: current.environment, permissionId: request.permissionId,
    owner: { kind: "platform", namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor,
    scope: request.scope, authorizationRevision: 1, lifecycleRevision: 1, outcome,
    reason: outcome === "allow" ? "granted" : "policy-denied", approval: "not-required", reauthentication: "not-required"
  };
}

function adapter(outcomes: Readonly<Record<string, "allow" | "deny">>) {
  const current = session();
  const authority = {
    authorize: vi.fn(async (_session: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) => decision(request, current, outcomes[request.permissionId] ?? "deny"))
  } as Pick<EffectiveAuthorityResolver, "authorize">;
  return new CurrentAuthorityAdapter({ current: async () => current }, authority);
}

const source = { id: "sales.source.orders", outputFields: [{ id: "sales.field.order" }, { id: "sales.field.total" }] } as never;
const sourceRequest = { actor: {}, authorizationContext: { permission: "forged" }, descriptor: source, surface: "admin" } as never;
const action = { descriptor: { id: "sales.action.close" } } as never;
const tool = { id: "sales.tool.close" } as never;

describe("current authority policy wrappers", () => {
  it("does not call domain source policy until RBAC allows, then intersects field grants", async () => {
    const deniedDomain = { authorize: vi.fn() };
    const denied = new CurrentAuthorityDataSourcePolicy(adapter({ "system.settings.read": "deny" }), () => ({}), {
      source: () => target("system.settings.read"), field: () => target("system.settings.manage")
    }, deniedDomain);
    await expect(denied.authorize(sourceRequest)).resolves.toMatchObject({ sourceAllowed: false, allowedFields: [] });
    expect(deniedDomain.authorize).not.toHaveBeenCalled();

    const domain = { authorize: vi.fn(async () => ({ sourceAllowed: true, recordScope: { tenant: "alpha" }, allowedFields: ["sales.field.order", "sales.field.total"] })) };
    const allowed = new CurrentAuthorityDataSourcePolicy(adapter({ "system.settings.read": "allow", "system.settings.manage": "allow", "system.themes.manage": "deny" }), () => ({}), {
      source: () => target("system.settings.read"), field: (_descriptor, field) => target(field === "sales.field.order" ? "system.settings.manage" : "system.themes.manage")
    }, domain);
    await expect(allowed.authorize(sourceRequest)).resolves.toEqual({ sourceAllowed: true, recordScope: { tenant: "alpha" }, allowedFields: ["sales.field.order"] });
    expect(domain.authorize).toHaveBeenCalledOnce();
  });

  it("blocks action and tool policy before their downstream policies", async () => {
    const actionDomain = { authorize: vi.fn() };
    const actionTarget = vi.fn(() => target("system.settings.manage"));
    const actions = new CurrentAuthorityActionGatewayPolicy(adapter({ "system.settings.manage": "deny" }), () => ({}), actionTarget, actionDomain);
    await expect(actions.authorize({ action, input: {}, authenticated: {} } as never)).rejects.toMatchObject({ code: "ACTION_FORBIDDEN" });
    expect(actionTarget).toHaveBeenCalledWith(action, {});
    expect(actionDomain.authorize).not.toHaveBeenCalled();

    const toolDomain = { authorize: vi.fn() };
    const tools = new CurrentAuthorityToolAuthorization(adapter({ "system.settings.manage": "deny" }), () => ({}), () => target("system.settings.manage"), toolDomain);
    await expect(tools.authorize({ descriptor: tool } as never)).rejects.toMatchObject({ code: "TOOL_FORBIDDEN" });
    expect(toolDomain.authorize).not.toHaveBeenCalled();
  });

  it("fails closed before realtime/settings work and projects only allowed navigation", async () => {
    const topicAuthorize = vi.fn(async () => true);
    const realtime = new CurrentAuthorityRealtimeTopicAuthorization(adapter({ "system.settings.read": "deny" }), () => ({}), () => target("system.settings.read"));
    await expect(realtime.authorize({ id: "sales.realtime.orders", authorize: topicAuthorize } as never, { signal: new AbortController().signal } as never)).resolves.toBe(false);
    expect(topicAuthorize).not.toHaveBeenCalled();

    const settings = new CurrentAuthoritySettingsAuthorization(adapter({ "system.settings.read": "deny", "system.settings.manage": "deny" }), () => target("system.settings.read"), () => target("system.settings.manage"));
    const read = vi.fn();
    const change = vi.fn();
    await expect(settings.read({}, { id: "sales.settings" } as never, read)).resolves.toBeUndefined();
    await expect(settings.change({}, { id: "sales.settings" } as never, change)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();

    const store = { read: vi.fn(), replace: vi.fn() };
    const service = new PluginSettingsService(store, settings);
    await expect(service.read({ descriptor: { id: "sales.settings", readPermission: "system.settings.read" } } as never, {})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(store.read).not.toHaveBeenCalled();

    const projection = new CurrentAuthorityPermissionProjection(adapter({ "system.settings.read": "allow", "system.settings.manage": "deny" }), (_kind, descriptor) => target(descriptor.permission));
    await expect(projection.allowsRoute({}, { id: "sales.route.orders", permission: "system.settings.read" })).resolves.toBe(true);
    await expect(projection.allowsPage({}, { id: "sales.page.orders", permission: "system.settings.manage" })).resolves.toBe(false);
    const render = vi.fn();
    await expect(projection.renderPage({}, { id: "sales.page.orders", permission: "system.settings.manage" }, render)).rejects.toThrow(/denied/u);
    expect(render).not.toHaveBeenCalled();
  });

  it("reauthorizes only the exact signed grant, including existing jobs.schedule", async () => {
    const grant = { kind: "jobs", required: true, reason: "sync", operations: ["schedule"], scheduleIds: ["sales.job.sync"] } as never;
    const claims = { applicationId: "customer-alpha", environment: "production", appId: "app.sales", generationId: "sales-generation", actor: { principalId: "user:one", effectiveActorId: "user:one" } } as never;
    const registry = createCurrentAuthorityCapabilityTargetRegistry([{ ...claims, grant, capabilities: [{ capability: "jobs.schedule", targets: [target("system.settings.manage")] }] }]);
    const capabilities = new CurrentAuthorityCapabilityAuthorization(adapter({ "system.settings.manage": "allow" }), () => ({}), registry);
    await expect(capabilities.reauthorize(claims, { capability: "jobs.schedule", grants: [grant] })).resolves.toBe(true);

    const revokedGrant = { kind: "jobs", required: true, reason: "other", operations: ["schedule"], scheduleIds: ["sales.job.revoked"] } as never;
    const allRegistry = createCurrentAuthorityCapabilityTargetRegistry([
      { ...claims, grant, capabilities: [{ capability: "jobs.schedule", targets: [target("system.settings.manage")] }] },
      { ...claims, grant: revokedGrant, capabilities: [{ capability: "jobs.schedule", targets: [target("system.themes.manage")] }] }
    ]);
    const allGrants = new CurrentAuthorityCapabilityAuthorization(adapter({ "system.settings.manage": "allow", "system.themes.manage": "deny" }), () => ({}), allRegistry);
    await expect(allGrants.reauthorize(claims, { capability: "jobs.schedule", grants: [grant, revokedGrant] })).resolves.toBe(false);
  });

  it("authorizes every permission implied by a declared grant before token issuance", async () => {
    const grant = { kind: "jobs", required: true, reason: "sync", operations: ["schedule"], scheduleIds: ["sales.job.sync"] } as never;
    const registry = createCurrentAuthorityCapabilityTargetRegistry([{
      applicationId: "customer-alpha", environment: "production", appId: "app.sales", generationId: "sales-generation", grant,
      capabilities: [{ capability: "jobs.schedule", targets: [target("system.settings.read"), target("system.settings.manage")] }]
    }]);
    const authorization = new CurrentAuthorityHotApplicationCapabilityAuthorization(
      adapter({ "system.settings.read": "allow", "system.settings.manage": "deny" }),
      ({ session }) => session,
      registry
    );

    await expect(authorization.authorize({
      session: session(), applicationId: "customer-alpha", environment: "production",
      appId: "app.sales", generationId: "sales-generation", grant
    })).resolves.toEqual({ allowed: false, authorizationRevision: 1, lifecycleRevision: 1 });
  });

  it("rechecks only server-registered remote frame, source, and action targets", async () => {
    const remote = new CurrentAuthorityRemoteUiFrameAuthorization(adapter({ "system.settings.read": "allow", "system.settings.manage": "deny" }), () => ({}), () => ({
      frame: target("system.settings.read"),
      sources: new Map([["sales.source.orders", target("system.settings.read")]]),
      actions: new Map([["sales.action.close", target("system.settings.manage")]])
    }));
    const identity = { applicationId: "customer-alpha", environment: "production", appId: "app.sales", generationId: "sales-generation" };
    await expect(remote.allowsFrame(identity)).resolves.toBe(true);
    await expect(remote.allowsSource(identity, "sales.source.orders")).resolves.toBe(true);
    await expect(remote.allowsAction(identity, "sales.action.close")).resolves.toBe(false);
    await expect(remote.allowsSource(identity, "forged.target")).resolves.toBe(false);
  });
});
