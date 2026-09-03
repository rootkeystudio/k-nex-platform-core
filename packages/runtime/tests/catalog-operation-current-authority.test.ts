import { describe, expect, it } from "vitest";

import type { AdministrationActorEnvelope, AuthorizationDecision } from "@k-nex/contracts";

import { PersistedCatalogAuthorityReauthorizer } from "../src/catalog-operation-current-authority.js";
import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession } from "../src/effective-authority.js";

describe("PersistedCatalogAuthorityReauthorizer", () => {
  it("binds persisted scope, actor, refresh and phase to one current decision", async () => {
    const actor = { kind: "user" as const, id: "owner" };
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: "customer-alpha", environment: "production", correlationId: "catalog-worker", principal: actor, effectiveActor: actor });
    let allowed = true;
    const adapter = new CurrentAuthorityAdapter({ current: async () => session }, { authorize: async (current, request) => ({
      schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
      permissionId: request.permissionId, owner: { kind: "platform", namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor,
      scope: request.scope, authorizationRevision: 2, lifecycleRevision: 3, outcome: allowed ? "allow" : "deny", reason: allowed ? "granted" : "permission-not-granted", approval: "not-required", reauthentication: "not-required"
    } as AuthorizationDecision) });
    const envelope: AdministrationActorEnvelope = { schemaVersion: 1, applicationId: "customer-alpha", environment: "production", principal: actor, effectiveActor: actor, authorizationRevision: 1, lifecycleRevision: 3,
      permissions: [{ decisionId: "catalog-original", permissionId: "system.catalog.refresh", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.catalog" } }] };
    let bound: unknown;
    const reauthorizer = new PersistedCatalogAuthorityReauthorizer(adapter, { current: async (input) => { bound = input; return {}; } });
    const input = { authority: envelope, refreshId: "catalog-refresh-one", phase: "accept" as const };
    await expect(reauthorizer.reauthorize(input)).resolves.toEqual({ schemaVersion: 1, applicationId: "customer-alpha", environment: "production", authorizationRevision: 2, lifecycleRevision: 3 });
    expect(bound).toEqual(input);
    allowed = false;
    await expect(reauthorizer.reauthorize(input)).resolves.toBeUndefined();
  });
});
