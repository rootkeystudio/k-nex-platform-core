import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import type { ToolExecutionContext } from "../src/tool-gateway.js";
import { InMemoryToolApprovalEvaluator, toolApprovalLimits } from "../src/tool-approval.js";

const descriptor: AgentToolDescriptor = {
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

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    request: {
      correlationId: "correlation-1",
      rawRequest: {},
      tool: { id: descriptor.id, version: descriptor.version },
      surface: "workspace",
      features: [],
      input: { title: "One" },
      signal: new AbortController().signal
    },
    principal: { actor: {}, request: {}, authorizationContext: {} },
    agentClient: { client: {}, session: {} },
    delegation: {},
    descriptor,
    input: { title: "One" },
    authorization: {},
    budget: {},
    signal: new AbortController().signal,
    ...overrides
  };
}

describe("P2A.5 per-call approvals", () => {
  it("binds an approval to exact arguments, principal, session, tool version, and one use", async () => {
    let now = 1_000;
    let approvalId: string | undefined;
    let principalId = "user-1";
    let sessionId = "session-1";
    const evaluator = new InMemoryToolApprovalEvaluator(
      { now: () => now },
      { resolve: () => ({ principalId, agentSessionId: sessionId, approvalId }) },
      { authorize: () => true }
    );
    await expect(evaluator.prepare(context())).resolves.toMatchObject({ status: "required", principalId, agentSessionId: sessionId });
    await expect(evaluator.submit(context(), { id: "approval-1", decision: "approve", expiresAtEpochMs: 2_000 }))
      .resolves.toEqual({ status: "approved", id: "approval-1", expiresAtEpochMs: 2_000 });
    approvalId = "approval-1";
    await expect(evaluator.evaluate(context())).resolves.toEqual({ status: "approved", id: "approval-1" });
    await expect(evaluator.evaluate(context())).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    approvalId = undefined;
    await evaluator.submit(context(), { id: "approval-2", decision: "approve", expiresAtEpochMs: 2_000 });
    approvalId = "approval-2";
    await expect(evaluator.evaluate(context({ input: { title: "Changed" } }))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(evaluator.evaluate(context({ descriptor: { ...descriptor, version: 2 } }))).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    principalId = "user-2";
    await expect(evaluator.evaluate(context())).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    principalId = "user-1";
    sessionId = "session-2";
    await expect(evaluator.evaluate(context())).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    sessionId = "session-1";
    now = 2_000;
    await expect(evaluator.evaluate(context())).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("fails closed for invalid, duplicate, overlong, or unauthorized submissions", async () => {
    const evaluator = new InMemoryToolApprovalEvaluator(
      { now: () => 1_000 },
      { resolve: () => ({ principalId: "user-1", agentSessionId: "session-1" }) },
      { authorize: (_context, submission) => submission.id !== "denied" }
    );
    await expect(evaluator.submit(context(), { id: "late", decision: "approve", expiresAtEpochMs: 1_000 })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await expect(evaluator.submit(context(), { id: "extra", decision: "approve", expiresAtEpochMs: 2_000, extra: true })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await expect(evaluator.submit(context(), { id: "long", decision: "approve", expiresAtEpochMs: 1_000_000 })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await expect(evaluator.submit(context(), { id: "denied", decision: "approve", expiresAtEpochMs: 2_000 })).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
    await evaluator.submit(context(), { id: "duplicate", decision: "approve", expiresAtEpochMs: 2_000 });
    await expect(evaluator.submit(context(), { id: "duplicate", decision: "approve", expiresAtEpochMs: 2_000 })).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  });

  it("reserves an approval ID across concurrent submissions", async () => {
    let release: (() => void) | undefined;
    const issuerReady = new Promise<void>((resolve) => { release = resolve; });
    const evaluator = new InMemoryToolApprovalEvaluator(
      { now: () => 1_000 },
      { resolve: () => ({ principalId: "user-1", agentSessionId: "session-1" }) },
      { authorize: async () => { await issuerReady; return true; } }
    );
    const first = evaluator.submit(context(), { id: "concurrent", decision: "approve", expiresAtEpochMs: 2_000 });
    await expect(evaluator.submit(context(), { id: "concurrent", decision: "approve", expiresAtEpochMs: 2_000 })).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
    release?.();
    await expect(first).resolves.toMatchObject({ status: "approved", id: "concurrent" });
  });

  it("purges expired records before enforcing the bounded record capacity", { timeout: 30_000 }, async () => {
    let now = 1_000;
    const evaluator = new InMemoryToolApprovalEvaluator(
      { now: () => now },
      { resolve: () => ({ principalId: "user-1", agentSessionId: "session-1" }) },
      { authorize: () => true }
    );
    for (let index = 0; index < toolApprovalLimits.maxRecords; index += 1) {
      await evaluator.submit(context(), {
        id: `capacity-${index}`,
        decision: "approve",
        expiresAtEpochMs: 2_000
      });
    }
    await expect(evaluator.submit(context(), {
      id: "capacity-full",
      decision: "approve",
      expiresAtEpochMs: 2_000
    })).rejects.toMatchObject({ code: "APPROVAL_DENIED" });

    now = 2_000;
    await expect(evaluator.submit(context(), {
      id: "capacity-recovered",
      decision: "approve",
      expiresAtEpochMs: 3_000
    })).resolves.toMatchObject({ status: "approved", id: "capacity-recovered" });
  });

  it("does not require approval for a read-only none policy", async () => {
    const evaluator = new InMemoryToolApprovalEvaluator(
      { now: () => 1_000 },
      { resolve: () => ({ principalId: "user-1", agentSessionId: "session-1" }) },
      { authorize: () => false }
    );
    const read = context({ descriptor: { ...descriptor, effect: "read-only", approval: "none", idempotency: "not-applicable", invocation: { kind: "source", source: { id: "sales.tasks", version: 1 } } } });
    await expect(evaluator.evaluate(read)).resolves.toEqual({ status: "not-required" });
  });
});
