import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationLifecycleProjector,
  type AuthorizationLifecycleCommittedTransition
} from "../src/authorization-lifecycle-projector.js";
import type { RuntimeExtensionSession } from "../src/runtime-extension-store.js";

const applicationId = "customer-alpha";
const environment = "production";
const identity = { deliveryClass: "platform-plugin", extensionId: "module.sales" } as const;

function lifecycle(operation: "install" | "update" | "rollback" | "disable", lifecycleState: "active" | "disabled", revision: number, generationId = "sales-generation-1") {
  return {
    schemaVersion: 1, applicationId, environment, eventId: `event-${revision}`, eventType: "extension.lifecycle-transition",
    operationId: `operation-${revision}`, operation, operationPhase: "completed", lifecycleState,
    expectedRevision: revision - 1, revision, inventoryRevision: revision, actor: { kind: "trusted-automation", identity: "test.lifecycle" },
    receiptId: `receipt-${revision}`, auditId: `audit-${revision}`, idempotencyKey: `lifecycle:${revision}:test`, correlationId: `correlation-${revision}`,
    occurredAt: "2026-09-01T00:00:00.000Z", deliveryClass: identity.deliveryClass, id: identity.extensionId,
    evidence: { sourceCommit: "a".repeat(40), compositionChangePlanDigest: `sha256:${"b".repeat(64)}`, generationId }
  } as const;
}

function descriptor(extensionId = identity.extensionId) {
  return {
    schemaVersion: 1, id: "sales.orders.read", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId },
    title: "Read sales orders", description: "Read sales orders through the authorized sales extension.", audience: "authenticated",
    resource: "sales.orders", operation: "read", scope: "application"
  } as const;
}

function generation(options: Readonly<{ extensionId?: string; lifecycleRevision?: number; state?: "current" | "retired" }> = {}) {
  return {
    application_id: applicationId, delivery_class: "platform-plugin", extension_id: options.extensionId ?? identity.extensionId,
    authorization_generation: 1, runtime_generation_ids: ["sales-generation-1"], state: options.state ?? "current",
    authorization_revision: 4, lifecycle_revision: options.lifecycleRevision ?? 2
  };
}

function harness(options: Readonly<{
  state?: Readonly<{ authorizationRevision: number; lifecycleRevision: number }>;
  generations?: readonly Record<string, unknown>[];
}> = {}) {
  const state = { authorizationRevision: 4, lifecycleRevision: 2, ...options.state };
  const queries: string[] = [];
  const query = vi.fn(async <T extends object>(text: string, values: readonly unknown[] = []) => {
    queries.push(text);
    if (text.startsWith("select pg_advisory_xact_lock")) return { rows: [] as T[] };
    if (text.startsWith("insert into k_nex_authorization_state")) return { rows: [] as T[] };
    if (text.startsWith("select application_id, authorization_revision")) {
      return { rows: [{ application_id: applicationId, authorization_revision: state.authorizationRevision, lifecycle_revision: state.lifecycleRevision }] as T[] };
    }
    if (text.startsWith("select application_id, delivery_class")) return { rows: (options.generations ?? []) as T[] };
    if (text.startsWith("insert into k_nex_extension_authorization_generations")) return { rows: [] as T[] };
    if (text.startsWith("delete from k_nex_permission_catalog_snapshots")) return { rows: [] as T[] };
    if (text.startsWith("insert into k_nex_permission_catalog_snapshots")) return { rows: [] as T[] };
    if (text.startsWith("insert into k_nex_authorization_outbox")) return { rows: [] as T[] };
    if (text.startsWith("update k_nex_authorization_state")) {
      state.authorizationRevision = values[2] as number;
      state.lifecycleRevision = values[1] as number;
      return { rows: [{ application_id: applicationId, authorization_revision: state.authorizationRevision, lifecycle_revision: state.lifecycleRevision }] as T[] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  return { state, queries, query, session };
}

describe("AuthorizationLifecycleProjector", () => {
  it("locks, projects inactive snapshots, and advances the lifecycle revision once", async () => {
    const value = harness({ generations: [generation()] });
    const resolver = vi.fn(async () => [descriptor()]);
    const projector = new AuthorizationLifecycleProjector(resolver);

    const result = await projector.project({
      session: value.session, transition: lifecycle("disable", "disabled", 9), runtimeGenerationIds: ["sales-generation-1"]
    });

    expect(result.state).toMatchObject({ authorizationRevision: 4, lifecycleRevision: 3 });
    expect(result.plan.mutations).toEqual([
      expect.objectContaining({ kind: "extension-generation", generation: expect.objectContaining({ state: "current", lifecycleRevision: 3 }) }),
      expect.objectContaining({ kind: "catalog-snapshot", snapshot: expect.objectContaining({ state: "inactive-extension-disabled", revision: 3 }) })
    ]);
    expect(value.queries).toEqual([
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("insert into k_nex_authorization_state"),
      expect.stringContaining("from k_nex_authorization_state"),
      expect.stringContaining("from k_nex_extension_authorization_generations"),
      expect.stringContaining("insert into k_nex_extension_authorization_generations"),
      expect.stringContaining("insert into k_nex_permission_catalog_snapshots"),
      expect.stringContaining("update k_nex_authorization_state"),
      expect.stringContaining("insert into k_nex_authorization_outbox")
    ]);
    expect(resolver).toHaveBeenCalledWith(value.session, lifecycle("disable", "disabled", 9));
    expect(value.queries.some((query) => query.startsWith("delete from k_nex_permission_catalog_snapshots"))).toBe(false);
    const advance = value.query.mock.calls.find(([text]) => String(text).startsWith("update k_nex_authorization_state"));
    expect(advance?.[1]).toEqual([applicationId, 3, 4, 2]);
    const outbox = value.query.mock.calls.find(([text]) => String(text).includes("k_nex_authorization_outbox"));
    expect(outbox?.[1]?.slice(1, 5)).toEqual([applicationId, environment, 4, 3]);
    expect(JSON.parse(outbox?.[1]?.[5] as string)).toEqual({ applicationId, environment, scope: "environment", authorizationRevision: 4, lifecycleRevision: 3 });
  });

  it("leaves the caller transaction unchanged when trusted descriptor resolution fails", async () => {
    const value = harness({ generations: [generation()] });
    const projector = new AuthorizationLifecycleProjector(async () => { throw new Error("descriptor lookup failed"); });

    await expect(projector.project({
      session: value.session, transition: lifecycle("disable", "disabled", 9), runtimeGenerationIds: ["sales-generation-1"]
    })).rejects.toThrow("descriptor lookup failed");

    expect(value.state).toEqual({ authorizationRevision: 4, lifecycleRevision: 2 });
    expect(value.queries.some((query) => query.startsWith("update k_nex_authorization_state") || query.startsWith("insert into k_nex_extension_authorization_generations") || query.startsWith("delete from k_nex_permission_catalog_snapshots"))).toBe(false);
  });

  it("fails closed when a locked row belongs to another extension", async () => {
    const value = harness({ generations: [generation({ extensionId: "module.other" })] });
    const projector = new AuthorizationLifecycleProjector(async () => [descriptor()]);

    await expect(projector.project({
      session: value.session, transition: lifecycle("install", "active", 9), runtimeGenerationIds: ["sales-generation-1"]
    })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(value.queries.some((query) => query.startsWith("update k_nex_authorization_state"))).toBe(false);
  });

  it("fails closed for a stale locked generation instead of advancing authorization state", async () => {
    const value = harness({ generations: [generation({ lifecycleRevision: 4 })] });
    const projector = new AuthorizationLifecycleProjector(async (_session, _transition: AuthorizationLifecycleCommittedTransition) => [descriptor()]);

    await expect(projector.project({
      session: value.session, transition: lifecycle("disable", "disabled", 9), runtimeGenerationIds: ["sales-generation-1"]
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.queries.some((query) => query.startsWith("update k_nex_authorization_state") || query.startsWith("delete from k_nex_permission_catalog_snapshots"))).toBe(false);
  });

  it("uses separately resolved prior descriptors and reconciles only reactivated deprecated snapshots", async () => {
    const value = harness({ generations: [generation()] });
    const priorEvidence = { authority: "static-build", sourceCommit: "b".repeat(40), generationId: "sales-generation-1" };
    const retained = { ...descriptor(), id: "sales.orders.write", title: "Write sales orders", description: "Write sales orders through the authorized sales extension.", operation: "write" };
    const target = { ...descriptor(), title: "Read updated sales orders" };
    const introduced = { ...descriptor(), id: "sales.orders.v2.read", title: "Read sales orders v2", description: "Read sales orders through the authorized sales extension.", resource: "sales.orders.v2" };
    const resolver = vi.fn(async (_session, _transition, prior) => prior === undefined ? [target, introduced] : [descriptor(), retained]);
    const projector = new AuthorizationLifecycleProjector(resolver);

    const result = await projector.project({
      session: value.session, transition: lifecycle("update", "active", 9, "sales-generation-2"), runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "compatible", priorGenerationEvidence: priorEvidence
    });

    expect(result.plan.snapshots).toMatchObject([{ state: "deprecated", permission: { id: "sales.orders.write" }, owner: { generation: 1 } }]);
    expect(resolver).toHaveBeenNthCalledWith(1, value.session, lifecycle("update", "active", 9, "sales-generation-2"));
    expect(resolver).toHaveBeenNthCalledWith(2, value.session, lifecycle("update", "active", 9, "sales-generation-2"), priorEvidence);
    const deleteCall = value.query.mock.calls.find(([text]) => String(text).includes("state='deprecated'"));
    expect(deleteCall?.[0]).toContain("state='deprecated'");
    expect(deleteCall?.[1]).toEqual([applicationId, identity.deliveryClass, identity.extensionId, [1], [target.id, introduced.id]]);
  });

  it("fails closed when prior evidence does not exactly name the current authorization runtime generation", async () => {
    const value = harness({ generations: [generation()] });
    const resolver = vi.fn(async () => [descriptor()]);
    const projector = new AuthorizationLifecycleProjector(resolver);

    await expect(projector.project({
      session: value.session, transition: lifecycle("update", "active", 9, "sales-generation-2"), runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "incompatible", priorGenerationEvidence: { authority: "static-build", sourceCommit: "b".repeat(40), generationId: "other-generation" }
    })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });

    expect(resolver).not.toHaveBeenCalled();
    expect(value.queries.some((query) => query.startsWith("update k_nex_authorization_state") || query.startsWith("delete from k_nex_permission_catalog_snapshots"))).toBe(false);
  });

  it("reconciles only restored compatible-update deprecations when rollback restores the prior release", async () => {
    const value = harness({ generations: [generation()] });
    const restored = descriptor();
    const projector = new AuthorizationLifecycleProjector(async () => [restored]);

    const result = await projector.project({
      session: value.session,
      transition: lifecycle("rollback", "active", 10, "sales-generation-1"),
      runtimeGenerationIds: ["sales-generation-1"]
    });

    expect(result.plan.snapshots).toEqual([]);
    const deleteCall = value.query.mock.calls.find(([text]) => String(text).includes("state='deprecated'"));
    expect(deleteCall?.[0]).toContain("state='deprecated'");
    expect(deleteCall?.[1]).toEqual([applicationId, identity.deliveryClass, identity.extensionId, [1], [restored.id]]);
  });

  it("accepts exact retired authorization evidence for an incompatible update after quarantine", async () => {
    const value = harness({ generations: [generation({ state: "retired" })] });
    const priorEvidence = { authority: "static-build", sourceCommit: "b".repeat(40), generationId: "sales-generation-1" };
    const projector = new AuthorizationLifecycleProjector(async () => [descriptor()]);

    const result = await projector.project({
      session: value.session, transition: lifecycle("update", "active", 9, "sales-generation-2"), runtimeGenerationIds: ["sales-generation-2"],
      updateCompatibility: "incompatible", priorGenerationEvidence: priorEvidence
    });

    expect(result.plan.generations).toMatchObject([
      { owner: { generation: 1 }, state: "retired", runtimeGenerationIds: ["sales-generation-1"] },
      { owner: { generation: 2 }, state: "current", runtimeGenerationIds: ["sales-generation-2"] }
    ]);
  });
});
