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
