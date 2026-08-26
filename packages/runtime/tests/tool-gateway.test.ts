import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import {
  SafeToolProblemSerializer,
  ToolExecutionGateway,
  ToolGatewayError,
  type ToolGatewayRequest,
  type ToolGatewayStages
} from "../src/tool-gateway.js";

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
      "approval", "idempotency", "dispatcher", "output", "redactor", "audit", "release"
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

  it("does not release an idempotency claim after dispatch may have produced an effect", async () => {
    let failedClaims = 0;
    const { gateway } = harness({
      idempotency: { claim: () => ({ context: {}, complete: () => undefined, fail: () => { failedClaims += 1; } }) },
      dispatcher: { dispatch: () => { throw new Error("uncertain action outcome"); } }
    });
    await expect(gateway.execute(request())).resolves.toMatchObject({ ok: false, status: 500 });
    expect(failedClaims).toBe(0);
  });
});
