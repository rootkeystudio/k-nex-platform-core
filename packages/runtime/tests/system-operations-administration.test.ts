import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision } from "@k-nex/contracts";

import { CompositeSystemOperationsProjection, SystemOperationsAdministrationService } from "../src/system-operations-administration.js";

const digest = `sha256:${"a".repeat(64)}`;
const actor = { kind: "user" as const, id: "user:owner" };
const state = { schemaVersion: 1 as const, applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 2, operationsRevision: 7, inventoryDigest: digest };

function decision(permissionId: string, outcome: "allow" | "deny" = "allow"): AuthorizationDecision {
  return {
    schemaVersion: 1, decisionId: "decision-operations-1", correlationId: "operations-test", applicationId: state.applicationId, environment: state.environment,
    permissionId, owner: { kind: "platform", namespace: "system" }, principal: actor, effectiveActor: actor,
    scope: { kind: "application", resource: "system.operations" }, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision,
    outcome, reason: outcome === "allow" ? "granted" : "permission-not-granted", approval: "not-required", reauthentication: "not-required"
  };
}

function harness(options: Readonly<{ outcome?: "allow" | "deny"; evidence?: { reauthentication: "satisfied"; approval: "not-required" | "satisfied" } }> = {}) {
  const authority = { authorize: vi.fn(async (_context: unknown, target: { permissionId: string }) => decision(target.permissionId, options.outcome)) };
  const source = { read: vi.fn(async () => ({ operationsRevision: state.operationsRevision, inventoryDigest: digest, references: [{ source: "deployment" as const, receiptId: "deployment-receipt-1" }], health: [{ schemaVersion: 1 as const, observationId: "health-observation-1", applicationId: state.applicationId, environment: state.environment, source: "deployment" as const, state: "ready" as const, revision: 1, checkIds: ["deployment.ready"], observedAt: "2026-09-02T00:00:00.000Z" }] })) };
  const operator = { replay: vi.fn(async () => undefined), submit: vi.fn(async (input: { kind: "backup" | "restore-drill"; applicationId: string; environment: string; expectedInventoryDigest: string; requestedBy: typeof actor; idempotencyKey: string }) => ({
    schemaVersion: 1 as const, receiptId: `${input.kind}-receipt-1`, requestId: `${input.kind}-request-1`, kind: input.kind,
    applicationId: input.applicationId, environment: input.environment, expectedInventoryDigest: input.expectedInventoryDigest, requestedBy: input.requestedBy,
    idempotencyKey: input.idempotencyKey, reference: { source: input.kind, operationId: `${input.kind}-operation-1` }, outcome: "accepted" as const, reason: "accepted" as const,
    occurredAt: "2026-09-02T00:00:00.000Z"
  })) };
  const service = new SystemOperationsAdministrationService({ authority: authority as never, state: { readState: vi.fn(async () => state) }, projection: source, operator: { resolve: vi.fn(() => operator) }, evidence: { verify: vi.fn(async () => options.evidence ?? { reauthentication: "satisfied" as const, approval: "not-required" as const }) } });
  return { authority, source, operator, service };
}

describe("system operations administration", () => {
  it("joins and deduplicates only same-owner authoritative references and health", async () => {
    const stateSource = { read: vi.fn(async () => ({ operationsRevision: 7, inventoryDigest: digest })) };
    const reference = { source: "deployment" as const, receiptId: "deployment-receipt-1" };
    const health = { schemaVersion: 1 as const, observationId: "health-observation-1", applicationId: state.applicationId, environment: state.environment, source: "deployment" as const, state: "ready" as const, revision: 1, checkIds: ["deployment.ready"], observedAt: "2026-09-02T00:00:00.000Z" };
    const projection = new CompositeSystemOperationsProjection(stateSource, [{ read: async () => [reference] }, { read: async () => [reference] }], [{ read: async () => [health] }]);
    await expect(projection.read({ applicationId: state.applicationId, environment: state.environment })).resolves.toMatchObject({ references: [reference], health: [health] });
    expect(stateSource.read).toHaveBeenCalledTimes(2);
    const forged = new CompositeSystemOperationsProjection(stateSource, [], [{ read: async () => [{ ...health, applicationId: "customer-other" }] }]);
    await expect(forged.read({ applicationId: state.applicationId, environment: state.environment })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("authorizes and reauthorizes safe projections against current state", async () => {
    const value = harness();
    await expect(value.service.read({ context: {} })).resolves.toMatchObject({ operationsRevision: 7, references: [{ source: "deployment" }], health: [{ state: "ready" }] });
    expect(value.authority.authorize).toHaveBeenCalledTimes(2);
    expect(value.source.read).toHaveBeenCalledWith({ applicationId: state.applicationId, environment: state.environment });
  });

  it("denies before touching projection or operator authority", async () => {
    const value = harness({ outcome: "deny" });
    await expect(value.service.read({ context: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(value.source.read).not.toHaveBeenCalled();
    expect(value.operator.submit).not.toHaveBeenCalled();
  });

  it("derives owner, inventory, actor, and permission while rejecting client authority fields", async () => {
    const value = harness();
    await expect(value.service.request({ context: {}, kind: "backup", request: { expectedOperationsRevision: 7, idempotencyKey: "backup-request-1" } })).resolves.toMatchObject({ kind: "backup", outcome: "accepted" });
    expect(value.authority.authorize).toHaveBeenCalledWith({}, expect.objectContaining({ permissionId: "system.operations.backup" }));
    expect(value.operator.submit).toHaveBeenCalledWith(expect.objectContaining({ applicationId: state.applicationId, environment: state.environment, expectedInventoryDigest: digest, requestedBy: actor }));
    await expect(value.service.request({ context: {}, kind: "backup", request: { expectedOperationsRevision: 7, idempotencyKey: "backup-request-2", inventoryDigest: digest } })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("requires server approval for restore drills", async () => {
    const denied = harness();
    await expect(denied.service.request({ context: {}, kind: "restore-drill", request: { expectedOperationsRevision: 7, idempotencyKey: "restore-request-1" } })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(denied.operator.submit).not.toHaveBeenCalled();
    const allowed = harness({ evidence: { reauthentication: "satisfied", approval: "satisfied" } });
    await expect(allowed.service.request({ context: {}, kind: "restore-drill", request: { expectedOperationsRevision: 7, idempotencyKey: "restore-request-2" } })).resolves.toMatchObject({ kind: "restore-drill", outcome: "accepted" });
  });

  it("returns an exact actor-bound replay before rejecting the now-stale original revision", async () => {
    const value = harness();
    const receipt = await value.operator.submit({ kind: "backup", applicationId: state.applicationId, environment: state.environment, expectedInventoryDigest: digest, requestedBy: actor, idempotencyKey: "backup-replay-1" });
    value.operator.replay.mockResolvedValueOnce(receipt);
    await expect(value.service.request({ context: {}, kind: "backup", request: { expectedOperationsRevision: 0, idempotencyKey: "backup-replay-1" } })).resolves.toEqual(receipt);
    expect(value.operator.submit).toHaveBeenCalledOnce();
  });
});
