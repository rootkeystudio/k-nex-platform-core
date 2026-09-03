import { describe, expect, it, vi } from "vitest";

import { canonicalJson, type AuthorizationDecision } from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession } from "../src/effective-authority.js";
import { SystemCatalogAdministrationService } from "../src/system-catalog-administration.js";

describe("SystemCatalogAdministrationService", () => {
  it("uses one stable server identity and returns a terminal receipt after response loss", async () => {
    const actor = { kind: "user" as const, id: "owner" };
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId: "customer-alpha", environment: "production", correlationId: "catalog-request", principal: actor, effectiveActor: actor });
    const authority = new CurrentAuthorityAdapter({ current: async () => session }, { authorize: async (current, request) => ({
      schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
      permissionId: request.permissionId, owner: { kind: "platform", namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor,
      scope: request.scope, authorizationRevision: 1, lifecycleRevision: 1, outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required"
    } as AuthorizationDecision) });
    let receipt: unknown;
    const operator = {
      read: vi.fn(async () => receipt),
      refresh: vi.fn(async (input) => {
        const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(input.authorityEnvelope)));
        receipt = { schemaVersion: 1, receiptId: "catalog-receipt-one", refreshId: input.refreshId, outcome: "rejected", reason: "fetch-failed", requestedBy: input.requestedBy,
          authorityDigest: `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`, idempotencyKey: input.idempotencyKey, occurredAt: "2026-09-02T00:00:00.000Z" };
        return receipt;
      })
    };
    const options = { authority, state: { readState: async () => ({ schemaVersion: 1 as const, applicationId: "customer-alpha", environment: "production", authorizationRevision: 1, lifecycleRevision: 1, catalogRevision: 0 }) },
      observation: { readObservation: async () => ({ schemaVersion: 1 as const, catalogRevision: 0, state: "no-accepted-snapshot" as const }) }, operator: { resolve: async () => operator } };
    const request = { expectedCatalogRevision: 0, idempotencyKey: "catalog-response-loss-one" };

    const first = await new SystemCatalogAdministrationService(options).refresh({ context: {}, request });
    const replay = await new SystemCatalogAdministrationService(options).refresh({ context: {}, request });

    expect(replay).toEqual(first);
    expect(operator.refresh).toHaveBeenCalledTimes(1);
    expect(operator.read.mock.calls[0]?.[0]).toMatch(/^catalog-refresh-[0-9a-f]{32}$/u);
    expect(operator.read.mock.calls[1]?.[0]).toBe(operator.read.mock.calls[0]?.[0]);
  });
});
