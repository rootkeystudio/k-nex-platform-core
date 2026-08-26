import type { AgentToolDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { SafeToolAuditDecorator, type ToolAuditRecord } from "../src/tool-audit.js";
import { ToolGatewayError, type ToolExecutionContext } from "../src/tool-gateway.js";

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
  limits: { timeoutMs: 100, maxConcurrency: 1, ratePerMinute: 10, burst: 2, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: ["secret"], outputPaths: [] },
  audit: { category: "sales.tasks" }
};

function context(): ToolExecutionContext {
  return {
    request: {
      correlationId: "correlation-1",
      rawRequest: { prompt: "never audit me" },
      tool: { id: descriptor.id, version: descriptor.version },
      surface: "workspace",
      features: [],
      input: { secret: "credential", query: "safe" },
      idempotencyKey: "idempotency-secret-value",
      signal: new AbortController().signal
    },
    principal: { actor: {}, request: {}, authorizationContext: {} },
    agentClient: { client: {}, session: {} },
    delegation: {},
    descriptor,
    input: { secret: "credential", query: "safe" },
    authorization: {},
    budget: {},
    approval: {},
    idempotency: {},
    signal: new AbortController().signal
  };
}

describe("P2A.6 safe tool audit", () => {
  it("records bounded success metadata without inputs, results, prompts, or key values", async () => {
    const records: ToolAuditRecord[] = [];
    const audit = new SafeToolAuditDecorator(
      { now: () => 1_000 },
      { resolve: () => ({
        principalId: "user-1",
        agentClientId: "client-1",
        agentSessionId: "session-1",
        delegationId: "grant-1",
        approvalId: "approval-1",
        idempotencyReference: `sha256:${"a".repeat(64)}`,
        inputDigest: `sha256:${"b".repeat(64)}`
      }) },
      { write: (record) => { records.push(record); } }
    );
    await audit.success(context(), {
      schemaVersion: 1,
      correlationId: "correlation-1",
      tool: { id: descriptor.id, version: 1 },
      provenance: "k-nex-tool",
      trust: "structured-untrusted-content",
      data: { secretResult: "do not audit" }
    });
    expect(records).toEqual([expect.objectContaining({
      tool: { id: descriptor.id, version: 1, ownerPluginId: "module.sales" },
      category: "sales.tasks",
      principalId: "user-1",
      agentClientId: "client-1",
      agentSessionId: "session-1",
      delegationId: "grant-1",
      approvalId: "approval-1",
      idempotencyReference: `sha256:${"a".repeat(64)}`,
      inputDigest: `sha256:${"b".repeat(64)}`,
      hasIdempotencyKey: true,
      outcome: "success",
      code: "OK"
    })]);
    expect(JSON.stringify(records)).not.toMatch(/credential|never audit|idempotency-secret|secretResult|do not audit/);
  });

  it("records safe failure metadata before a descriptor is available", async () => {
    const records: ToolAuditRecord[] = [];
    const value = context();
    const audit = new SafeToolAuditDecorator(
      { now: () => 2_000 },
      { resolve: () => ({ principalId: "bad id with spaces" }) },
      { write: (record) => { records.push(record); } }
    );
    await audit.failure(value.request, new ToolGatewayError("TOOL_FORBIDDEN", 403, "Forbidden."));
    expect(records).toEqual([expect.objectContaining({ outcome: "failure", code: "TOOL_FORBIDDEN", tool: { id: descriptor.id, version: 1 } })]);
    expect(records[0]).not.toHaveProperty("principalId");
  });
});
