import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { BoundedToolRiskBudgetEvaluator, BudgetedToolOutputValidator, toolBudgetCeilings } from "../src/tool-budget.js";
import type { ToolExecutionContext } from "../src/tool-gateway.js";

const descriptor = (limits: Partial<AgentToolDescriptor["limits"]> = {}): AgentToolDescriptor => ({
  id: "sales.tools.search",
  version: 1,
  ownerPluginId: "module.sales",
  title: "Search",
  description: "Search tasks.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: { type: "string" },
  invocation: { kind: "source", source: { id: "sales.tasks", version: 1 } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  policy: "sales.tasks.tool",
  effect: "read-only",
  risk: "low",
  approval: "none",
  idempotency: "not-applicable",
  dryRun: false,
  limits: { timeoutMs: 100, maxConcurrency: 2, ratePerMinute: 60, burst: 2, costClass: "low", maxCost: 1, ...limits },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.tasks" }
});

function context(tool = descriptor(), input: unknown = {}): Omit<ToolExecutionContext, "budget" | "signal"> {
  return {
    request: {
      correlationId: "correlation-1",
      rawRequest: {},
      tool: { id: tool.id, version: tool.version },
      surface: "workspace",
      features: [],
      input,
      signal: new AbortController().signal
    },
    principal: { actor: {}, request: {}, authorizationContext: {} },
    agentClient: { client: {}, session: {} },
    delegation: {},
    descriptor: tool,
    input,
    authorization: {}
  };
}

function budget(now = () => 0, principalId = "user-1", runId = "run-1") {
  return new BoundedToolRiskBudgetEvaluator({ now }, { resolve: () => ({ principalId, agentRunId: runId }) });
}

describe("P2A.6 tool budgets", () => {
  it("enforces per-principal/tool concurrency and releases idempotently", () => {
    const evaluator = budget();
    const tool = descriptor({ maxConcurrency: 1 });
    const first = evaluator.evaluate(context(tool));
    expect(() => evaluator.evaluate(context(tool))).toThrowError(expect.objectContaining({ code: "TOOL_CONCURRENCY_EXCEEDED" }));
    first.release();
    first.release();
    expect(evaluator.evaluate(context(tool)).release()).toBeUndefined();
  });

  it("enforces rate/burst independently and refills with the injected clock", () => {
    let now = 0;
    const evaluator = budget(() => now);
    const tool = descriptor({ burst: 1, ratePerMinute: 60 });
    evaluator.evaluate(context(tool)).release();
    expect(() => evaluator.evaluate(context(tool))).toThrowError(expect.objectContaining({ code: "TOOL_RATE_EXCEEDED" }));
    now = 1_000;
    expect(evaluator.evaluate(context(tool)).release()).toBeUndefined();
  });

  it("bounds input/output JSON bytes, depth, cost, and caller cancellation", () => {
    const evaluator = budget();
    expect(() => evaluator.evaluate(context(descriptor(), { value: "x".repeat(toolBudgetCeilings.inputBytes) })))
      .toThrowError(expect.objectContaining({ code: "TOOL_INPUT_TOO_LARGE" }));
    let deep: unknown = true;
    for (let index = 0; index < 9; index += 1) deep = { child: deep };
    expect(() => evaluator.evaluate(context(descriptor(), deep))).toThrowError(expect.objectContaining({ code: "TOOL_INPUT_DEPTH_EXCEEDED" }));
    expect(() => evaluator.evaluate(context(descriptor({ costClass: "high", maxCost: 1 }))))
      .toThrowError(expect.objectContaining({ code: "TOOL_COST_EXCEEDED" }));
    expect(() => evaluator.assertOutput({ value: "x".repeat(toolBudgetCeilings.outputBytes) }))
      .toThrowError(expect.objectContaining({ code: "TOOL_OUTPUT_TOO_LARGE" }));
    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledContext = context();
    expect(() => evaluator.evaluate({ ...cancelledContext, request: { ...cancelledContext.request, signal: cancelled.signal } }))
      .toThrowError(expect.objectContaining({ code: "TOOL_CANCELLED" }));
  });

  it("caps calls per principal agent run", () => {
    let now = 0;
    const evaluator = budget(() => now);
    for (let index = 0; index < toolBudgetCeilings.maxCallsPerRun; index += 1) {
      evaluator.evaluate(context(descriptor({ burst: 60, ratePerMinute: 600 }))).release();
      now += 100;
    }
    expect(() => evaluator.evaluate(context(descriptor({ burst: 60, ratePerMinute: 600 }))))
      .toThrowError(expect.objectContaining({ code: "TOOL_RUN_LIMIT_EXCEEDED" }));
  });

  it("composes a bounded timeout signal", async () => {
    const lease = budget().evaluate(context(descriptor({ timeoutMs: 1 })));
    await new Promise<void>((resolve) => lease.signal.addEventListener("abort", () => resolve(), { once: true }));
    expect(lease.signal.aborted).toBe(true);
    lease.release();
  });

  it("applies result bounds after target/tool output validation", () => {
    const evaluator = budget();
    const validator = new BudgetedToolOutputValidator({ validate: (_descriptor, output) => output }, evaluator);
    expect(() => validator.validate(descriptor(), { value: "x".repeat(toolBudgetCeilings.outputBytes) }))
      .toThrowError(expect.objectContaining({ code: "TOOL_OUTPUT_TOO_LARGE" }));
  });
});
