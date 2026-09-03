import { describe, expect, it } from "vitest";

import type { AdministrationAuthorityEnvelope, AuthorizationDecision } from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession } from "../src/effective-authority.js";
import { PersistedSettingsAuthorityReauthorizer } from "../src/settings-operation-current-authority.js";

describe("P11 persisted settings current authority", () => {
  it("denies promotion after either captured permission is revoked", async () => {
    let revoked: string | undefined;
    const principal = { kind: "user" as const, id: "admin" };
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: "customer-alpha", environment: "production", correlationId: "settings-worker", principal, effectiveActor: principal });
    const adapter = new CurrentAuthorityAdapter({ current: async () => session }, { authorize: async (current, request) => ({
      schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
      permissionId: request.permissionId, owner: request.permissionId.startsWith("system.") ? { kind: "platform", namespace: "system" } : { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 },
      principal: current.principal, effectiveActor: current.effectiveActor, scope: request.scope, authorizationRevision: 2, lifecycleRevision: 3,
      outcome: request.permissionId === revoked ? "deny" : "allow", reason: request.permissionId === revoked ? "permission-not-granted" : "granted", approval: "not-required", reauthentication: "not-required"
    } as AuthorizationDecision) });
    const envelope: AdministrationAuthorityEnvelope = {
      schemaVersion: 1, applicationId: "customer-alpha", environment: "production", principal, effectiveActor: principal, authorizationRevision: 1, lifecycleRevision: 3,
      permissions: [
        { decisionId: "settings-manage", permissionId: "system.settings.manage", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.settings" } },
        { decisionId: "sales-write", permissionId: "sales.settings.write", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, scope: { kind: "application", resource: "sales.settings" } }
      ],
      reauthentication: { evidenceId: "settings-proof", verifiedAt: "2026-09-02T00:00:00.000Z", expiresAt: "2026-09-02T00:01:00.000Z" }
    };
    const reauthorizer = new PersistedSettingsAuthorityReauthorizer(adapter, { current: async () => ({}) });
    const identity = { applicationId: "customer-alpha", environment: "production", descriptorId: "sales.workspace", descriptorSchemaVersion: 1, owner: { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 } };
    const request = { authority: envelope, identity, operationId: "settings-operation-one", phase: "claim" as const };
    await expect(reauthorizer.reauthorize(request)).resolves.toEqual({ schemaVersion: 1, applicationId: "customer-alpha", environment: "production", authorizationRevision: 2, lifecycleRevision: 3 });
    revoked = "sales.settings.write";
    await expect(reauthorizer.reauthorize(request)).resolves.toBeUndefined();
  });

  it("binds scope, identity and one current revision", async () => {
    const principal = { kind: "user" as const, id: "admin" };
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: "customer-alpha", environment: "production", correlationId: "settings-worker", principal, effectiveActor: principal });
    const substitutedSession = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: "customer-other", environment: "production", correlationId: "settings-worker-other", principal, effectiveActor: principal });
    let inconsistent = false;
    let substituted = false;
    const adapter = new CurrentAuthorityAdapter({ current: async (context: { substituted: boolean }) => context.substituted ? substitutedSession : session }, { authorize: async (current, request) => ({
      schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
      permissionId: request.permissionId, owner: request.permissionId.startsWith("system.") ? { kind: "platform", namespace: "system" } : { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 },
      principal: current.principal, effectiveActor: current.effectiveActor, scope: request.scope, authorizationRevision: inconsistent && request.permissionId === "sales.settings.write" ? 3 : 2, lifecycleRevision: 3,
      outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required"
    } as AuthorizationDecision) });
    const envelope: AdministrationAuthorityEnvelope = {
      schemaVersion: 1, applicationId: "customer-alpha", environment: "production", principal, effectiveActor: principal, authorizationRevision: 1, lifecycleRevision: 3,
      permissions: [
        { decisionId: "settings-manage", permissionId: "system.settings.manage", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.settings" } },
        { decisionId: "sales-write", permissionId: "sales.settings.write", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, scope: { kind: "application", resource: "sales.settings" } }
      ], reauthentication: { evidenceId: "settings-proof", verifiedAt: "2026-09-02T00:00:00.000Z", expiresAt: "2026-09-02T00:01:00.000Z" }
    };
    const reauthorizer = new PersistedSettingsAuthorityReauthorizer(adapter, { current: async (input) => input.identity.descriptorId === "sales.workspace" ? { substituted } : undefined });
    const identity = { applicationId: "customer-alpha", environment: "production", descriptorId: "sales.workspace", descriptorSchemaVersion: 1, owner: { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 } };
    await expect(reauthorizer.reauthorize({ authority: envelope, identity: { ...identity, applicationId: "customer-other" }, operationId: "settings-operation-one", phase: "claim" })).resolves.toBeUndefined();
    await expect(reauthorizer.reauthorize({ authority: envelope, identity: { ...identity, environment: "staging" }, operationId: "settings-operation-one", phase: "claim" })).resolves.toBeUndefined();
    await expect(reauthorizer.reauthorize({ authority: envelope, identity: { ...identity, descriptorId: "sales.other" }, operationId: "settings-operation-one", phase: "claim" })).resolves.toBeUndefined();
    substituted = true;
    await expect(reauthorizer.reauthorize({ authority: envelope, identity, operationId: "settings-operation-one", phase: "claim" })).resolves.toBeUndefined();
    substituted = false;
    inconsistent = true;
    await expect(reauthorizer.reauthorize({ authority: envelope, identity, operationId: "settings-operation-one", phase: "promote" })).resolves.toBeUndefined();
  });
});
