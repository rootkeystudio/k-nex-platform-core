import { describe, expect, it, vi } from "vitest";

import { PostgresStaticDeploymentStore, StaticDeploymentStoreError } from "../src/static-deployment-store.js";
import type { RuntimeExtensionPool, RuntimeExtensionSession } from "../src/runtime-extension-store.js";

const owner = { applicationId: "customer-alpha", environment: "prod" };
const claimToken = "12345678-1234-4abc-8def-123456789abc";
const resultDigest = `sha256:${"a".repeat(64)}`;
const now = new Date("2026-08-29T12:00:00.000Z");

function completionHarness(overrides: Readonly<{
  effect?: Partial<{ state: "pending" | "completed"; generation_id: string; fencing_token: number; claim_expires_at: string | null; result_digest: string | null }>;
  fence?: Partial<{ active_execution_generation: string; fencing_token: number; lease_expires_at: string }>;
}> = {}) {
  const effect = {
    state: "pending" as const,
    generation_id: "customer-alpha-blue-8",
    fencing_token: 4,
    attempts: 1,
    claim_owner: "worker:blue",
    claim_token: claimToken,
    claim_expires_at: "2026-08-29T12:01:00.000Z",
    result_digest: null,
    ...overrides.effect
  };
  const fence = {
    active_execution_generation: "customer-alpha-blue-8",
    fencing_token: 4,
    lease_owner: "worker:blue",
    lease_expires_at: "2026-08-29T12:02:00.000Z",
    promotion_revision: 0,
    ...overrides.fence
  };
  const query = vi.fn(async <T extends object>(text: string) => {
    if (["begin", "commit", "rollback"].includes(text) || text.startsWith("select pg_advisory_xact_lock")) return { rows: [] as T[] };
    if (text.includes("from runtime_worker_effects") && text.startsWith("select")) return { rows: [effect] as T[] };
    if (text.includes("from runtime_worker_generation_fences")) return { rows: [fence] as T[] };
    if (text.startsWith("update runtime_worker_effects")) return { rows: [{ effect_id: "effect-9" }] as T[] };
    throw new Error(`Unexpected query: ${text}`);
  });
  const session: RuntimeExtensionSession = { query, release: vi.fn() };
  const pool: RuntimeExtensionPool = { connect: vi.fn(async () => session), query };
  const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, { read: vi.fn() } as never);
  const complete = () => store.completeEffect({ ...owner, effectId: "effect-9", generationId: "customer-alpha-blue-8", fencingToken: 4, claimToken, resultDigest });
  return { complete, query };
}

describe("PostgresStaticDeploymentStore.completeEffect", () => {
  it("rejects blue's pending completion immediately after the fence transfers to green", async () => {
    const value = completionHarness({ fence: { active_execution_generation: "customer-alpha-green-9", fencing_token: 5 } });

    await expect(value.complete()).rejects.toMatchObject<Partial<StaticDeploymentStoreError>>({ code: "FENCE_REJECTED" });
    expect(value.query).toHaveBeenCalledWith(expect.stringContaining("runtime_worker_generation_fences where application_id=$1 and environment=$2 for update"), [owner.applicationId, owner.environment]);
    expect(value.query.mock.calls.some(([text]) => typeof text === "string" && text.startsWith("update runtime_worker_effects"))).toBe(false);
  });

  it("rejects an expired claim before green has reclaimed the effect", async () => {
    const value = completionHarness({ effect: { claim_expires_at: "2026-08-29T11:59:59.999Z" } });

    await expect(value.complete()).rejects.toMatchObject<Partial<StaticDeploymentStoreError>>({ code: "EFFECT_CONFLICT" });
    expect(value.query.mock.calls.some(([text]) => typeof text === "string" && text.startsWith("update runtime_worker_effects"))).toBe(false);
  });

  it("keeps a matching completed result idempotent after a later fence transfer", async () => {
    const value = completionHarness({
      effect: { state: "completed", result_digest: resultDigest, claim_expires_at: null },
      fence: { active_execution_generation: "customer-alpha-green-9", fencing_token: 5 }
    });

    await expect(value.complete()).resolves.toEqual({ status: "already-completed" });
    expect(value.query).not.toHaveBeenCalledWith(expect.stringContaining("runtime_worker_generation_fences"), expect.anything());
  });
});

describe("PostgresStaticDeploymentStore.assertTransitionTicket", () => {
  it("validates a reserved inactive drain ticket through a read-only deployment/fence query", async () => {
    const reservationId = "12345678-1234-4abc-8def-123456789abc";
    const reservationExpiresAt = "2026-08-29T12:01:00.000Z";
    const generation = (generationId: string) => ({
      generationId, sourceCommit: "a".repeat(40), compositionChangePlanDigest: resultDigest, buildEvidenceDigest: resultDigest,
      applicationDigest: resultDigest, imageDigest: resultDigest, imageReference: `ghcr.io/k-nex/test@${resultDigest}`, migrationRevision: 1
    });
    const row = {
      revision: 1,
      active_generation_id: "customer-alpha-green-9",
      active_generation: generation("customer-alpha-green-9"),
      rollback_generation_id: "customer-alpha-blue-8",
      rollback_generation: generation("customer-alpha-blue-8"),
      rollback_window: { state: "open" },
      transition_checkpoint: {
        kind: "promote", revision: 1, activeGenerationId: "customer-alpha-green-9", previousGenerationId: "customer-alpha-blue-8",
        completedSteps: ["activate-worker", "converge-gateway", "reconnect-realtime"], reservedStep: "drain-previous", reservationId, reservationExpiresAt
      },
      state_digest: resultDigest,
      active_execution_generation: "customer-alpha-green-9",
      fencing_token: 5,
      lease_owner: "worker:green",
      lease_expires_at: "2026-08-29T12:02:00.000Z",
      promotion_revision: 1
    };
    const query = vi.fn(async () => ({ rows: [row] }));
    const store = new PostgresStaticDeploymentStore({ query } as unknown as RuntimeExtensionPool, { now: () => now }, { read: vi.fn() } as never);

    const ticket = {
      ...owner, generationId: "customer-alpha-blue-8", activeGenerationId: "customer-alpha-green-9", revision: 1,
      fencingToken: 5, checkpointKind: "promote", step: "drain-previous", reservationId, reservationExpiresAt
    } as const;
    await expect(store.assertTransitionTicket(ticket)).resolves.toBeUndefined();
    const statement = query.mock.calls[0]?.[0] as string;
    expect(statement).toContain("join runtime_worker_generation_fences");
    expect(statement).not.toContain("runtime_static_generation_retirements");
    expect(statement).not.toContain("for update");
    row.transition_checkpoint = { ...row.transition_checkpoint, reservationId: "87654321-1234-4abc-8def-123456789abc" };
    await expect(store.assertTransitionTicket(ticket)).rejects.toMatchObject({ code: "FENCE_REJECTED" });
  });

  it("denies a live claim, permits expired takeover, and rejects the old drain ticket", async () => {
    const firstId = "12345678-1234-4abc-8def-123456789abc";
    const secondId = "87654321-1234-4abc-8def-123456789abc";
    let currentNow = new Date("2026-08-29T12:00:00.000Z");
    const generation = (generationId: string) => ({
      generationId, sourceCommit: "a".repeat(40), compositionChangePlanDigest: resultDigest, buildEvidenceDigest: resultDigest,
      applicationDigest: resultDigest, imageDigest: resultDigest, imageReference: `ghcr.io/k-nex/test@${resultDigest}`, migrationRevision: 1
    });
    const row = {
      revision: 1,
      active_generation_id: "customer-alpha-green-9",
      active_generation: generation("customer-alpha-green-9"),
      rollback_generation_id: "customer-alpha-blue-8",
      rollback_generation: generation("customer-alpha-blue-8"),
      rollback_window: { state: "open" },
      transition_checkpoint: {
        kind: "promote", revision: 1, activeGenerationId: "customer-alpha-green-9", previousGenerationId: "customer-alpha-blue-8",
        completedSteps: ["activate-worker", "converge-gateway", "reconnect-realtime"]
      },
      state_digest: resultDigest
    };
    const fence = {
      active_execution_generation: "customer-alpha-green-9", fencing_token: 5, lease_owner: "worker:green",
      lease_expires_at: "2026-08-29T12:02:00.000Z", promotion_revision: 1
    };
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (["begin", "commit", "rollback"].includes(text) || text.startsWith("select pg_advisory_xact_lock")) return { rows: [] };
      if (text.startsWith("select * from runtime_static_deployments")) return { rows: [row] };
      if (text.startsWith("select * from runtime_worker_generation_fences")) return { rows: [fence] };
      if (text.includes("from runtime_static_deployments d join runtime_worker_generation_fences")) return { rows: [{ ...row, ...fence }] };
      if (text.startsWith("update runtime_static_deployments")) {
        row.transition_checkpoint = JSON.parse(values?.[2] as string);
        return { rows: [{ revision: row.revision }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    });
    const session = { query, release: vi.fn() } as unknown as RuntimeExtensionSession;
    const store = new PostgresStaticDeploymentStore({ connect: vi.fn(async () => session), query } as unknown as RuntimeExtensionPool, { now: () => currentNow }, { read: vi.fn() } as never);
    const input = { ...owner, expectedRevision: 1, step: "drain-previous" as const };

    const first = await store.reserveTransitionStep({ ...input, reservationId: firstId });
    await expect(store.reserveTransitionStep({ ...input, reservationId: secondId })).rejects.toMatchObject<Partial<StaticDeploymentStoreError>>({ code: "REVISION_CONFLICT" });
    currentNow = new Date("2026-08-29T12:01:00.001Z");
    const second = await store.reserveTransitionStep({ ...input, reservationId: secondId });

    expect(second.reservationId).toBe(secondId);
    expect(second.reservationId).not.toBe(first.reservationId);
    await expect(store.assertTransitionTicket(first)).rejects.toMatchObject<Partial<StaticDeploymentStoreError>>({ code: "FENCE_REJECTED" });
  });

  it.each([
    ["activate-worker", []],
    ["converge-gateway", ["activate-worker"]],
    ["reconnect-realtime", ["activate-worker", "converge-gateway"]],
    ["retire-retained", ["drain-retained"]]
  ] as const)("rejects stale %s authority before its external boundary", async (step, completedSteps) => {
    const reservationId = "12345678-1234-4abc-8def-123456789abc";
    const reservationExpiresAt = "2026-08-29T12:01:00.000Z";
    const generation = (generationId: string) => ({
      generationId, sourceCommit: "a".repeat(40), compositionChangePlanDigest: resultDigest, buildEvidenceDigest: resultDigest,
      applicationDigest: resultDigest, imageDigest: resultDigest, imageReference: `ghcr.io/k-nex/test@${resultDigest}`, migrationRevision: 1
    });
    const retire = step === "retire-retained";
    const row = {
      revision: 1, active_generation_id: "customer-alpha-green-9", active_generation: generation("customer-alpha-green-9"),
      rollback_generation_id: "customer-alpha-blue-8", rollback_generation: generation("customer-alpha-blue-8"),
      rollback_window: { state: retire ? "retirement-reserved" : "open" },
      transition_checkpoint: {
        kind: retire ? "retire-rollback" : "promote", revision: 1, activeGenerationId: "customer-alpha-green-9", previousGenerationId: "customer-alpha-blue-8",
        completedSteps, reservedStep: step, reservationId, reservationExpiresAt
      },
      state_digest: resultDigest, active_execution_generation: "customer-alpha-green-9", fencing_token: 5,
      lease_owner: "worker:green", lease_expires_at: "2026-08-29T12:02:00.000Z", promotion_revision: 1,
      reservation_id: retire ? reservationId : null, retirement_state: retire ? "reserved" : null, retirement_generation_id: retire ? "customer-alpha-blue-8" : null
    };
    const query = vi.fn(async () => ({ rows: [row] }));
    const store = new PostgresStaticDeploymentStore({ query } as unknown as RuntimeExtensionPool, { now: () => now }, { read: vi.fn() } as never);
    const ticket = {
      ...owner, generationId: retire ? "customer-alpha-blue-8" : "customer-alpha-green-9", activeGenerationId: "customer-alpha-green-9", revision: 1,
      fencingToken: 5, checkpointKind: retire ? "retire-rollback" : "promote", step, reservationId, reservationExpiresAt
    } as const;
    row.transition_checkpoint = { ...row.transition_checkpoint, reservationId: "87654321-1234-4abc-8def-123456789abc" };
    const retirement = retire ? { ...owner, generationId: "customer-alpha-blue-8", reservationId, reservedAt: "2026-08-29T12:00:00.000Z" } : undefined;
    await expect(store.assertTransitionTicket(ticket, retirement)).rejects.toMatchObject<Partial<StaticDeploymentStoreError>>({ code: "FENCE_REJECTED" });
    const statement = query.mock.calls[0]?.[0] as string;
    if (retire) {
      expect(statement).toContain("runtime_static_generation_retirements");
      expect(query.mock.calls[0]?.[1]).toEqual([owner.applicationId, owner.environment, "customer-alpha-blue-8"]);
    } else {
      expect(statement).not.toContain("runtime_static_generation_retirements");
      expect(query.mock.calls[0]?.[1]).toEqual([owner.applicationId, owner.environment]);
    }
  });
});

describe("PostgresStaticDeploymentStore.listPendingGenerationRetirements", () => {
  it("returns one bounded retirement page when more work remains", async () => {
    const retirements = Array.from({ length: 33 }, (_, index) => ({
      application_id: owner.applicationId, environment: owner.environment, generation_id: `customer-alpha-stale-${index + 10}`,
      reservation_id: `12345678-1234-4abc-8def-${String(index).padStart(12, "0")}`, state: "reserved", reserved_at: "2026-08-29T12:00:00.000Z", completed_at: null
    }));
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (["begin", "commit", "rollback"].includes(text) || text.startsWith("select pg_advisory_xact_lock")) return { rows: [] };
      if (text.startsWith("select * from runtime_static_deployments")) return { rows: [{ active_generation_id: "customer-alpha-green-9", rollback_generation_id: null }] };
      if (text.startsWith("select * from runtime_static_generation_retirements")) return { rows: retirements.slice(0, Number(values?.[4])) };
      throw new Error(`Unexpected query: ${text}`);
    });
    const session = { query, release: vi.fn() } as unknown as RuntimeExtensionSession;
    const store = new PostgresStaticDeploymentStore({ connect: vi.fn(async () => session), query } as unknown as RuntimeExtensionPool, { now: () => now }, { read: vi.fn() } as never);

    await expect(store.listPendingGenerationRetirements({ ...owner, limit: 32 })).resolves.toHaveLength(32);
  });
});
