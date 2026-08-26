import type { AgentToolDescriptor, DataSourceCostClass } from "@k-nex/contracts";

import { ToolGatewayError, type ToolExecutionContext, type ToolRiskBudgetEvaluator, type ToolBudgetLease, type ToolOutputValidator } from "./tool-gateway.js";

export const toolBudgetCeilings = Object.freeze({
  inputBytes: 1_048_576,
  outputBytes: 4_194_304,
  depth: 8,
  concurrency: 64,
  ratePerMinute: 600,
  burst: 60,
  maxCallsPerRun: 100
} as const);

const classCeilings: Readonly<Record<DataSourceCostClass, Readonly<{ concurrency: number; ratePerMinute: number; baseCost: number }>>> = {
  low: { concurrency: 64, ratePerMinute: 600, baseCost: 1 },
  medium: { concurrency: 16, ratePerMinute: 300, baseCost: 5 },
  high: { concurrency: 4, ratePerMinute: 60, baseCost: 10 }
};

interface RateBucket {
  tokens: number;
  updatedAt: number;
}

export interface ToolBudgetScope {
  readonly principalId: string;
  readonly agentRunId: string;
}

export interface ToolBudgetScopeResolver {
  resolve(context: Omit<ToolExecutionContext, "budget" | "signal">): ToolBudgetScope;
}

export interface ToolBudgetClock {
  now(): number;
}

function fail(code: string, status = 429): never {
  throw new ToolGatewayError(code, status, "Tool execution budget was exceeded.");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function jsonBytes(value: unknown, output = false): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(output ? "TOOL_OUTPUT_INVALID" : "TOOL_INPUT_INVALID", output ? 500 : 400);
  }
  if (serialized === undefined) fail(output ? "TOOL_OUTPUT_INVALID" : "TOOL_INPUT_INVALID", output ? 500 : 400);
  return new TextEncoder().encode(serialized).byteLength;
}

function jsonDepth(value: unknown, output = false, ancestors = new Set<object>()): number {
  if (typeof value !== "object" || value === null) return 0;
  if (ancestors.has(value)) fail(output ? "TOOL_OUTPUT_INVALID" : "TOOL_INPUT_INVALID", output ? 500 : 400);
  ancestors.add(value);
  let depth = 1;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    depth = Math.max(depth, 1 + jsonDepth(child, output, ancestors));
  }
  ancestors.delete(value);
  return depth;
}

export class BoundedToolRiskBudgetEvaluator implements ToolRiskBudgetEvaluator {
  private readonly active = new Map<string, number>();
  private readonly buckets = new Map<string, RateBucket>();
  private readonly runCalls = new Map<string, number>();

  constructor(private readonly clock: ToolBudgetClock, private readonly scopes: ToolBudgetScopeResolver) {}

  evaluate(context: Omit<ToolExecutionContext, "budget" | "signal">): ToolBudgetLease {
    if (context.request.signal.aborted) fail("TOOL_CANCELLED", 499);
    if (jsonDepth(context.input) > toolBudgetCeilings.depth) fail("TOOL_INPUT_DEPTH_EXCEEDED", 400);
    if (jsonBytes(context.input) > toolBudgetCeilings.inputBytes) fail("TOOL_INPUT_TOO_LARGE", 413);
    const descriptor = context.descriptor;
    const classLimit = classCeilings[descriptor.limits.costClass];
    if (classLimit.baseCost > descriptor.limits.maxCost) fail("TOOL_COST_EXCEEDED");
    const scope = this.scopes.resolve(context);
    if (!validId(scope.principalId) || !validId(scope.agentRunId)) fail("TOOL_BUDGET_CONTEXT_INVALID", 401);
    const key = `${scope.principalId}\u0000${descriptor.id}\u0000${descriptor.version}`;
    const runKey = `${scope.principalId}\u0000${scope.agentRunId}`;
    const calls = this.runCalls.get(runKey) ?? 0;
    if (calls >= toolBudgetCeilings.maxCallsPerRun) fail("TOOL_RUN_LIMIT_EXCEEDED");
    const concurrency = Math.min(descriptor.limits.maxConcurrency, classLimit.concurrency, toolBudgetCeilings.concurrency);
    const current = this.active.get(key) ?? 0;
    if (current >= concurrency) fail("TOOL_CONCURRENCY_EXCEEDED");
    const now = this.clock.now();
    if (!Number.isSafeInteger(now)) fail("TOOL_BUDGET_CONTEXT_INVALID", 500);
    const rate = Math.min(descriptor.limits.ratePerMinute, classLimit.ratePerMinute, toolBudgetCeilings.ratePerMinute);
    const capacity = Math.min(descriptor.limits.burst, toolBudgetCeilings.burst);
    const previous = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    const elapsed = Math.max(0, now - previous.updatedAt);
    const tokens = Math.min(capacity, previous.tokens + elapsed * rate / 60_000);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      fail("TOOL_RATE_EXCEEDED");
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    this.runCalls.set(runKey, calls + 1);
    this.active.set(key, current + 1);
    let released = false;
    const signal = AbortSignal.any([
      context.request.signal,
      AbortSignal.timeout(descriptor.limits.timeoutMs)
    ]);
    return Object.freeze({
      context: Object.freeze({ principalId: scope.principalId, agentRunId: scope.agentRunId, cost: classLimit.baseCost }),
      signal,
      release: (): void => {
        if (released) return;
        released = true;
        const remaining = (this.active.get(key) ?? 1) - 1;
        if (remaining <= 0) this.active.delete(key);
        else this.active.set(key, remaining);
      }
    });
  }

  assertOutput(value: unknown): void {
    if (jsonDepth(value, true) > toolBudgetCeilings.depth) fail("TOOL_OUTPUT_DEPTH_EXCEEDED", 500);
    if (jsonBytes(value, true) > toolBudgetCeilings.outputBytes) fail("TOOL_OUTPUT_TOO_LARGE", 500);
  }
}

export class BudgetedToolOutputValidator implements ToolOutputValidator {
  constructor(
    private readonly validator: ToolOutputValidator,
    private readonly budget: Pick<BoundedToolRiskBudgetEvaluator, "assertOutput">
  ) {}

  validate(descriptor: AgentToolDescriptor, output: unknown): unknown {
    const validated = this.validator.validate(descriptor, output);
    this.budget.assertOutput(validated);
    return validated;
  }
}
