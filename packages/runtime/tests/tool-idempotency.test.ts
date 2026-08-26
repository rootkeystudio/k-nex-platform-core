import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import {
  InMemoryToolIdempotencyCoordinator,
  ToolIdempotencyConflictError,
  ToolIdempotencyInProgressError
} from "../src/tool-idempotency.js";
import type { ToolExecutionContext } from "../src/tool-gateway.js";

const writeDescriptor: AgentToolDescriptor = {
  id: "sales.tools.create-task",
  version: 1,
  ownerPluginId: "module.sales",
  title: "Create task",
  description: "Creates one task.",
  inputSchema: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false
  },
  outputSchema: { type: "object", properties: {}, additionalProperties: false },
  invocation: { kind: "action", action: { id: "sales.task.create", version: 1 } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.write",
  policy: "sales.tasks.domain",
  effect: "write",
  risk: "medium",
  approval: "per-call",
  idempotency: "required",
  dryRun: false,
  limits: { timeoutMs: 1000, maxConcurrency: 1, ratePerMinute: 10, burst: 2, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.tasks" }
};

const readDescriptor: AgentToolDescriptor = {
  ...writeDescriptor,
  id: "sales.tools.search",
  title: "Search tasks",
  effect: "read-only",
  approval: "none",
  idempotency: "not-applicable",
  invocation: { kind: "source", source: { id: "sales.tasks", version: 1 } }
};

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const descriptor = overrides.descriptor ?? writeDescriptor;
  return {
    request: {
      correlationId: "correlation-1",
      rawRequest: {},
      tool: { id: descriptor.id, version: descriptor.version },
      surface: "workspace",
      features: [],
      input: { title: "One" },
      signal: new AbortController().signal,
      idempotencyKey: "request-1"
    },
    principal: { actor: {}, request: {}, authorizationContext: {} },
    agentClient: { client: {}, session: {} },
    delegation: { principalId: "user-1", applicationId: "app-1" },
    descriptor,
    input: { title: "One" },
    authorization: {},
    budget: {},
    signal: new AbortController().signal,
    ...overrides
  };
}

describe("P2A.6 in-memory tool idempotency", () => {
  it("bypasses read tools without inspecting a key, subject, or input", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const claim = await coordinator.claim(context({
      descriptor: readDescriptor,
      delegation: undefined,
      input: undefined,
      request: { ...context().request, tool: { id: readDescriptor.id, version: 1 }, idempotencyKey: undefined }
    }));
    expect(claim.replay).toBeUndefined();
    expect(claim.context).toEqual({ status: "not-applicable" });
    expect(claim.complete({ ignored: true })).toBeUndefined();
    expect(claim.fail()).toBeUndefined();
  });

  it("requires a bounded key and a validated principal/application scope for writes", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    await expect(coordinator.claim(context({ request: { ...context().request, idempotencyKey: undefined } })))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    await expect(coordinator.claim(context({ request: { ...context().request, idempotencyKey: "bad key" } })))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    await expect(coordinator.claim(context({ delegation: { principalId: "user-1" } })))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONTEXT_INVALID" });
  });

  it("canonicalizes input and returns one frozen stable result for exact replays", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const first = await coordinator.claim(context({ input: { b: 2, a: 1 } }));
    const result = { id: "task-1", nested: { ok: true } };
    await first.complete(result);
    result.nested.ok = false;

    const replay = await coordinator.claim(context({ input: { a: 1, b: 2 } }));
    expect(replay.context).toMatchObject({ status: "replay", reference: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
    expect(replay.replay).toEqual({ id: "task-1", nested: { ok: true } });
    expect(Object.isFrozen(replay.replay)).toBe(true);
    expect(Object.isFrozen((replay.replay as { nested: object }).nested)).toBe(true);
  });

  it("rejects changed input and isolates the key by exact tool identity", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const first = await coordinator.claim(context());
    await first.complete({ id: "task-1" });
    await expect(coordinator.claim(context({ input: { title: "Two" } }))).rejects.toBeInstanceOf(ToolIdempotencyConflictError);

    const otherTool = await coordinator.claim(context({
      descriptor: { ...writeDescriptor, version: 2 },
      request: { ...context().request, tool: { id: writeDescriptor.id, version: 2 } }
    }));
    expect(otherTool.replay).toBeUndefined();
  });

  it("isolates the same key across principal/application scopes", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const first = await coordinator.claim(context());
    await first.complete({ id: "task-1" });
    const other = await coordinator.claim(context({ delegation: { principalId: "user-2", applicationId: "app-1" } }));
    expect(other.replay).toBeUndefined();
  });

  it("returns one stable in-progress conflict for concurrent duplicates", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const first = await coordinator.claim(context());
    const attempts = await Promise.allSettled([coordinator.claim(context()), coordinator.claim(context())]);
    const conflicts = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected");
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]?.reason).toBeInstanceOf(ToolIdempotencyInProgressError);
    expect(conflicts[1]?.reason).toBeInstanceOf(ToolIdempotencyInProgressError);
    expect((conflicts[0]?.reason as ToolIdempotencyInProgressError).reference)
      .toBe((conflicts[1]?.reason as ToolIdempotencyInProgressError).reference);
    await first.complete({ id: "task-1" });
    await expect(coordinator.claim(context())).resolves.toMatchObject({ replay: { id: "task-1" } });
  });

  it("removes failed claims for retry but keeps completed claims through repeated completion/failure calls", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const failed = await coordinator.claim(context());
    await failed.fail();
    const retry = await coordinator.claim(context());
    await retry.complete({ id: "task-1" });
    await retry.complete({ id: "task-2" });
    await retry.fail();
    await expect(coordinator.claim(context())).resolves.toMatchObject({ replay: { id: "task-1" } });
  });

  it("keeps an invalid post-dispatch result pending instead of allowing a duplicate retry", async () => {
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => 1_000 });
    const first = await coordinator.claim(context());
    expect(() => first.complete({ invalid: () => undefined })).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_RESULT_INVALID" }));
    await expect(coordinator.claim(context())).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
  });

  it("retains an uncertain late outcome for bounded duplicate suppression", async () => {
    let now = 1_000;
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => now }, { retentionMs: 100 });
    const claim = await coordinator.claim(context());
    await claim.fail({ retain: true });
    await expect(coordinator.claim(context())).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    now = 1_100;
    await expect(coordinator.claim(context())).resolves.toMatchObject({ context: { status: "claimed" } });
  });

  it("expires only completed records using the injected clock and enforces the record bound", async () => {
    let now = 1_000;
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => now }, { retentionMs: 100, maxRecords: 1 });
    const first = await coordinator.claim(context());
    await expect(coordinator.claim(context({ request: { ...context().request, idempotencyKey: "request-2" } })))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CAPACITY_EXCEEDED" });
    await first.complete({ id: "task-1" });
    now = 1_100;
    const afterRetention = await coordinator.claim(context({ request: { ...context().request, idempotencyKey: "request-2" } }));
    expect(afterRetention.replay).toBeUndefined();
  });
});
