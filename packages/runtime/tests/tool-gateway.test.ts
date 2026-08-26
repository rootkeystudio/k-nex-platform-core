import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import {
  SafeToolProblemSerializer,
  ToolExecutionGateway,
  ToolGatewayError,
  type ToolSuccessEnvelope,
  type ToolGatewayRequest,
  type ToolGatewayStages
} from "../src/tool-gateway.js";
import { InMemoryToolApprovalEvaluator } from "../src/tool-approval.js";
import { InMemoryToolIdempotencyCoordinator } from "../src/tool-idempotency.js";

const descriptor: AgentToolDescriptor = {
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
  limits: { timeoutMs: 1000, maxConcurrency: 1, ratePerMinute: 10, burst: 2, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.tasks" }
};

const writeDescriptor: AgentToolDescriptor = {
  ...descriptor,
  id: "sales.tools.create",
  title: "Create",
  invocation: { kind: "action", action: { id: "sales.tasks.create", version: 1 } },
  effect: "write",
  approval: "per-call",
  idempotency: "required"
};

const request = (): ToolGatewayRequest => ({
  correlationId: "correlation-1",
  rawRequest: {},
  tool: { id: descriptor.id, version: descriptor.version },
  surface: "workspace",
  features: [],
  input: {},
  signal: new AbortController().signal
});

function harness(overrides: Partial<ToolGatewayStages> = {}) {
  const trace: string[] = [];
  const step = <T>(name: string, value: T): T => { trace.push(name); return value; };
  const stages: ToolGatewayStages = {
    principal: { authenticate: () => step("principal", { actor: {}, request: {}, authorizationContext: {} }) },
    agentClient: { authenticate: () => step("agent-client", { client: {}, session: {} }) },
    delegation: { evaluate: () => step("delegation", {}) },
    catalog: { lookup: () => step("catalog", descriptor) },
    input: { validate: (_tool, value) => step("input", value) },
    authorization: { authorize: () => step("authorization", {}) },
    budget: { evaluate: () => step("budget", { context: {}, signal: request().signal, release: () => trace.push("release") }) },
    approval: {
      evaluate: () => step("approval", {}),
      prepare: () => step("prepare", { required: false }),
      submit: () => step("submit", { accepted: true })
    },
    idempotency: { claim: () => step("idempotency", { context: {}, complete: () => undefined, fail: () => undefined }) },
    dispatcher: { dispatch: () => step("dispatcher", "raw") },
    output: { validate: (_tool, value) => step("output", value) },
    redactor: { redact: (_context, value) => step("redactor", value) },
    audit: {
      beforeDispatch: () => step("audit-before-dispatch", undefined),
      success: () => step("audit", undefined),
      failure: () => step("audit-failure", undefined)
    },
    problem: { serialize: (error, correlationId) => step("problem", new SafeToolProblemSerializer().serialize(error, correlationId)) },
    ...overrides
  };
  return { gateway: new ToolExecutionGateway(stages), trace };
}

describe("P2A.4 tool execution gateway", () => {
  it("runs the security-significant execution stages in exact order", async () => {
    const { gateway, trace } = harness();
    const response = await gateway.execute(request());
    expect(response).toMatchObject({
      ok: true,
      status: 200,
      body: { tool: { id: descriptor.id, version: 1 }, provenance: "k-nex-tool", trust: "structured-untrusted-content", data: "raw" }
    });
    expect(trace).toEqual([
      "principal", "agent-client", "delegation", "catalog", "input", "authorization", "budget",
      "approval", "idempotency", "audit-before-dispatch", "dispatcher", "release", "output", "redactor", "audit"
    ]);
  });

  it("short-circuits denial before later stages and returns a safe problem", async () => {
    const { gateway, trace } = harness({
      authorization: { authorize: () => { trace.push("authorization"); throw new ToolGatewayError("TOOL_FORBIDDEN", 403, "Forbidden."); } }
    });
    const response = await gateway.execute(request());
    expect(response).toMatchObject({ ok: false, status: 403, body: { code: "TOOL_FORBIDDEN", correlationId: "correlation-1" } });
    expect(trace).toEqual(["principal", "agent-client", "delegation", "catalog", "input", "authorization", "audit-failure", "problem"]);
  });

  it("normalizes unexpected failures without leaking their message", async () => {
    const { gateway } = harness({ dispatcher: { dispatch: () => { throw new Error("secret stack detail"); } } });
    const response = await gateway.execute(request());
    expect(response).toMatchObject({ ok: false, status: 500, body: { code: "INTERNAL_ERROR", detail: "Tool request failed." } });
    expect(JSON.stringify(response)).not.toContain("secret stack detail");
  });

  it("supports approval preparation and submission without dispatching a handler", async () => {
    const prepared = harness();
    await expect(prepared.gateway.prepare(request())).resolves.toMatchObject({ ok: true, body: { required: false } });
    expect(prepared.trace).not.toContain("dispatcher");
    const submitted = harness();
    await expect(submitted.gateway.submitApproval(request(), { token: "approval" })).resolves.toMatchObject({ ok: true, body: { accepted: true } });
    expect(submitted.trace).not.toContain("dispatcher");
  });

  it("uses an idempotent replay result without exposing or calling registered handlers", async () => {
    const { gateway, trace } = harness({
      idempotency: { claim: () => ({
        context: {},
        replay: {
          schemaVersion: 1,
          correlationId: "original-correlation",
          tool: { id: descriptor.id, version: descriptor.version },
          provenance: "k-nex-tool",
          trust: "structured-untrusted-content",
          data: "replayed"
        },
        complete: () => undefined,
        fail: () => undefined
      }) }
    });
    const response = await gateway.execute(request());
    expect(response).toMatchObject({ ok: true, body: { correlationId: "original-correlation", data: "replayed" } });
    expect(trace).not.toContain("dispatcher");
    expect(trace).not.toContain("output");
    expect(trace).not.toContain("redactor");
  });

  it("rejects a malformed idempotency replay without dispatching", async () => {
    const { gateway, trace } = harness({
      idempotency: { claim: () => ({ context: {}, replay: { secret: "not-an-envelope" }, complete: () => undefined, fail: () => undefined }) }
    });
    await expect(gateway.execute(request())).resolves.toMatchObject({ ok: false, status: 500, body: { code: "IDEMPOTENCY_RESULT_INVALID" } });
    expect(trace).not.toContain("dispatcher");
  });

  it("retains an idempotency claim after dispatch may have produced an effect", async () => {
    const failures: unknown[] = [];
    const { gateway } = harness({
      idempotency: { claim: () => ({ context: {}, complete: () => undefined, fail: (options) => { failures.push(options); } }) },
      dispatcher: { dispatch: () => { throw new Error("uncertain action outcome"); } }
    });
    await expect(gateway.execute(request())).resolves.toMatchObject({ ok: false, status: 500 });
    expect(failures).toEqual([{ retain: true }]);
  });

  it("bounds a real idempotency claim after a synchronous dispatcher failure", async () => {
    let now = 1_000;
    const coordinator = new InMemoryToolIdempotencyCoordinator({ now: () => now }, { retentionMs: 10 });
    const writeRequest = {
      ...request(),
      tool: { id: writeDescriptor.id, version: writeDescriptor.version },
      idempotencyKey: "sync-failure"
    };
    const stages = harness({
      catalog: { lookup: () => writeDescriptor },
      delegation: { evaluate: () => ({ principalId: "user-1", applicationId: "app-1" }) },
      idempotency: coordinator,
      dispatcher: { dispatch: () => { throw new Error("synchronous action failure"); } }
    });

    await expect(stages.gateway.execute(writeRequest)).resolves.toMatchObject({ ok: false, status: 500 });
    await expect(stages.gateway.execute(writeRequest)).resolves.toMatchObject({
      ok: false,
      status: 409,
      body: { code: "IDEMPOTENCY_IN_PROGRESS" }
    });
    now = 1_010;
    await expect(stages.gateway.execute(writeRequest)).resolves.toMatchObject({ ok: false, status: 500 });
  });

  it("enforces timeout against a non-cooperative dispatcher without releasing uncertain idempotency", async () => {
    let releaseCount = 0;
    let failCount = 0;
    let finish: (() => void) | undefined;
    const timeoutStages = harness({
      budget: { evaluate: () => ({ context: {}, signal: AbortSignal.timeout(1), release: () => { releaseCount += 1; } }) },
      idempotency: { claim: () => ({ context: {}, complete: () => undefined, fail: () => { failCount += 1; } }) },
      dispatcher: { dispatch: () => new Promise<void>((resolve) => { finish = resolve; }) }
    });
    const response = await timeoutStages.gateway.execute(request());
    expect(response).toMatchObject({ ok: false, status: 504, body: { code: "TOOL_TIMEOUT" } });
    expect(failCount).toBe(0);
    expect(releaseCount).toBe(0);
    finish?.();
    for (let attempt = 0; attempt < 10 && releaseCount === 0; attempt += 1) await Promise.resolve();
    expect(releaseCount).toBe(1);
  });

  it("reconciles a late success through validation, redaction, and idempotency completion", async () => {
    const budgetAbort = new AbortController();
    let finish: ((value: unknown) => void) | undefined;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let completed: ToolSuccessEnvelope | undefined;
    let completeLate: (() => void) | undefined;
    const completedPromise = new Promise<void>((resolve) => { completeLate = resolve; });
    const stages = harness({
      budget: { evaluate: () => ({ context: {}, signal: budgetAbort.signal, release: () => undefined }) },
      idempotency: {
        claim: () => ({
          context: {},
          complete: (value: unknown) => { completed = value as ToolSuccessEnvelope; completeLate?.(); },
          fail: () => undefined
        })
      },
      dispatcher: {
        dispatch: () => new Promise((resolve) => {
          finish = resolve;
          started?.();
        })
      },
      output: { validate: (_tool, value) => ({ secret: (value as { secret: string }).secret }) },
      redactor: { redact: (_context, value) => ({ safe: (value as { secret: string }).secret }) }
    });
    const pending = stages.gateway.execute(request());
    await startedPromise;
    budgetAbort.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, status: 504, body: { code: "TOOL_TIMEOUT" } });
    finish?.({ secret: "late-value" });
    await completedPromise;
    expect(completed).toMatchObject({ data: { safe: "late-value" } });
  });

  it("settles a late handler failure without an unhandled rejection", async () => {
    const budgetAbort = new AbortController();
    let rejectLate: ((error: unknown) => void) | undefined;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let failed = 0;
    const stages = harness({
      budget: { evaluate: () => ({ context: {}, signal: budgetAbort.signal, release: () => undefined }) },
      idempotency: {
        claim: () => ({
          context: {},
          complete: () => undefined,
          fail: () => { failed += 1; }
        })
      },
      dispatcher: {
        dispatch: () => new Promise((_resolve, reject) => {
          rejectLate = reject;
          started?.();
        })
      }
    });
    const pending = stages.gateway.execute(request());
    await startedPromise;
    budgetAbort.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, status: 504, body: { code: "TOOL_TIMEOUT" } });
    rejectLate?.(new Error("late failure"));
    for (let attempt = 0; attempt < 10 && failed === 0; attempt += 1) await Promise.resolve();
    expect(failed).toBe(1);
  });

  it("fails closed before dispatch when authoritative audit is unavailable", async () => {
    let dispatched = false;
    let auditAttempts = 0;
    const stages = harness({
      audit: {
        beforeDispatch: () => { auditAttempts += 1; throw new Error("audit sink offline"); },
        success: () => undefined,
        failure: () => undefined
      },
      dispatcher: { dispatch: () => { dispatched = true; return "raw"; } }
    });
    const response = await stages.gateway.execute(request());
    expect(response).toMatchObject({ ok: false, status: 500, body: { code: "INTERNAL_ERROR" } });
    expect(auditAttempts).toBe(1);
    expect(dispatched).toBe(false);
  });

  it("fails closed when the completion audit sink fails", async () => {
    let dispatched = false;
    const stages = harness({
      dispatcher: { dispatch: () => { dispatched = true; return "raw"; } },
      audit: {
        beforeDispatch: () => undefined,
        success: () => { throw new Error("audit sink offline"); },
        failure: () => undefined
      }
    });
    const response = await stages.gateway.execute(request());
    expect(response).toMatchObject({ ok: false, status: 500, body: { code: "INTERNAL_ERROR" } });
    expect(dispatched).toBe(true);
  });

  it("allows one concurrent gateway call to consume a single approval", async () => {
    const writeDescriptor: AgentToolDescriptor = {
      ...descriptor,
      invocation: { kind: "action", action: { id: "sales.task.create", version: 1 } },
      effect: "write",
      approval: "per-call",
      idempotency: "required"
    };
    let dispatched = 0;
    const approval = new InMemoryToolApprovalEvaluator(
      { now: () => 1_000 },
      { resolve: (context) => ({
        principalId: "user-1",
        agentSessionId: "session-1",
        approvalId: (context.request.rawRequest as { approvalId?: string }).approvalId
      }) },
      { authorize: () => true }
    );
    const requestWithApproval = (approvalId?: string): ToolGatewayRequest => ({
      ...request(),
      rawRequest: approvalId === undefined ? {} : { approvalId }
    });
    const stages = harness({
      catalog: { lookup: () => writeDescriptor },
      approval,
      dispatcher: { dispatch: () => { dispatched += 1; return "raw"; } }
    });
    await expect(stages.gateway.submitApproval(request(), {
      id: "approval-concurrent",
      decision: "approve",
      expiresAtEpochMs: 2_000
    })).resolves.toMatchObject({ ok: true, body: { status: "approved" } });
    const responses = await Promise.all([
      stages.gateway.execute(requestWithApproval("approval-concurrent")),
      stages.gateway.execute(requestWithApproval("approval-concurrent"))
    ]);
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(responses.filter((response) => !response.ok).map((response) => response.body.code)).toEqual(["APPROVAL_REQUIRED"]);
    expect(dispatched).toBe(1);
  });
});
