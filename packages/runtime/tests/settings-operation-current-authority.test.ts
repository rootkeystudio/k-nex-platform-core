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
    await expect(reauthorizer.reauthorize({ authority: envelope })).resolves.toBe(true);
    revoked = "sales.settings.write";
    await expect(reauthorizer.reauthorize({ authority: envelope })).resolves.toBe(false);
  });
});
