import { describe, expect, it, vi } from "vitest";

import {
  ScriptedSalesToolClient,
  type ScriptedToolClientDependencies,
  type ScriptedToolRequestDetails
} from "../src/scripted-tool-client.js";
import type { ToolCatalogRequest } from "../src/tool-catalog.js";
import type { ToolGatewayRequest, ToolGatewayResponse, ToolPreparationResponse } from "../src/tool-gateway.js";

const authentication: ToolCatalogRequest = {
  actor: {
    principal: { kind: "user", id: "user-1" },
    effectiveActor: { kind: "user", id: "user-1" }
  },
  delegation: { id: "grant-1" },
  authorizationContext: { revision: "1" },
  surface: "workspace",
  features: []
};

const flow = {
  readTool: { id: "sales.tools.search-tasks", version: 1 },
  readInput: { status: "open" },
  forbiddenTool: { id: "sales.tools.internal", version: 1 },
  forbiddenInput: {},
  writeTool: { id: "sales.tools.create-task", version: 1 },
  writeInput: { title: "Ship the proof" },
  changedWriteInput: { title: "Ship a different proof" },
  idempotencyKey: "task-1",
  approval: ({ stage, input }: { stage: "initial" | "replay" | "changed-input"; input: unknown }) => ({
    id: `approval-${stage}`,
    decision: "approve" as const,
    expiresAtEpochMs: 2_000
  })
};

function success(request: ToolGatewayRequest, data: unknown): ToolGatewayResponse {
  return {
    ok: true,
    status: 200,
    body: {
      schemaVersion: 1,
      correlationId: request.correlationId,
      tool: request.tool,
      provenance: "k-nex-tool",
      trust: "structured-untrusted-content",
      data
    }
  };
}

function request(details: ScriptedToolRequestDetails): ToolGatewayRequest {
  return {
    correlationId: details.correlationId,
    rawRequest: details,
    tool: details.tool,
    surface: details.context.surface,
    features: details.context.features,
    input: details.input,
    signal: new AbortController().signal,
    ...(details.idempotencyKey === undefined ? {} : { idempotencyKey: details.idempotencyKey })
  };
}

function dependencies(): {
  dependencies: ScriptedToolClientDependencies;
  catalogList: ReturnType<typeof vi.fn>;
  gateway: {
    execute: ReturnType<typeof vi.fn>;
    prepare: ReturnType<typeof vi.fn>;
    submitApproval: ReturnType<typeof vi.fn>;
  };
  requests: ScriptedToolRequestDetails[];
  approvals: unknown[];
} {
  const requests: ScriptedToolRequestDetails[] = [];
  const approvals: unknown[] = [];
  const catalogList = vi.fn(async (value: ToolCatalogRequest) => ({
    revision: "sha256:catalog",
    tools: [
      { id: flow.readTool.id, version: flow.readTool.version },
      { id: flow.writeTool.id, version: flow.writeTool.version }
    ]
  }));
  const gateway = {
    execute: vi.fn(async (value: ToolGatewayRequest): Promise<ToolGatewayResponse> => {
      if (value.tool.id === flow.forbiddenTool.id) {
        return { ok: false, status: 403, body: { type: "urn:k-nex:problem:forbidden", title: "Forbidden.", status: 403, detail: "Forbidden.", code: "TOOL_FORBIDDEN", correlationId: value.correlationId } };
      }
      if (JSON.stringify(value.input) === JSON.stringify(flow.changedWriteInput)) {
        return { ok: false, status: 409, body: { type: "urn:k-nex:problem:idempotency-key-reused", title: "Conflict.", status: 409, detail: "Conflict.", code: "IDEMPOTENCY_KEY_REUSED", correlationId: value.correlationId } };
      }
      return success(value, value.tool.id === flow.writeTool.id ? { taskId: "task-1" } : { tasks: [] });
    }),
    prepare: vi.fn(async (): Promise<ToolPreparationResponse> => ({ ok: true, status: 200, body: { status: "required" } })),
    submitApproval: vi.fn(async (_value: ToolGatewayRequest, approval: unknown): Promise<ToolPreparationResponse> => {
      approvals.push(approval);
      return { ok: true, status: 200, body: { status: "approved" } };
    })
  };
  const dependencies: ScriptedToolClientDependencies = {
    catalog: { list: catalogList },
    gateway,
    authenticate: vi.fn(async () => authentication),
    request: (details) => {
      requests.push(details);
      return request(details);
    }
  };
  return { dependencies, catalogList, gateway, requests, approvals };
}

describe("P2A.8 deterministic scripted tool client", () => {
  it("runs the read, forbidden, approval, replay, and changed-input proof flow", async () => {
    const setup = dependencies();
    const client = new ScriptedSalesToolClient(setup.dependencies);

    const proof = await client.run(flow);

    expect(setup.dependencies.authenticate).toHaveBeenCalledOnce();
    expect(setup.catalogList).toHaveBeenCalledWith(authentication);
    expect(proof.catalog.tools.map((tool) => tool.id)).toEqual([
      flow.readTool.id,
      flow.writeTool.id
    ]);
    expect(proof.read).toMatchObject({ ok: true, body: { data: { tasks: [] } } });
    expect(proof.forbidden).toMatchObject({ ok: false, status: 403, body: { code: "TOOL_FORBIDDEN" } });
    expect(proof.prepared).toMatchObject({ ok: true, body: { status: "required" } });
    expect(proof.approval).toMatchObject({ ok: true, body: { status: "approved" } });
    expect(proof.write).toMatchObject({ ok: true, body: { data: { taskId: "task-1" } } });
    expect(proof.replay).toMatchObject({ ok: true, body: { data: { taskId: "task-1" } } });
    expect(proof.changedReplay).toMatchObject({ ok: false, status: 409, body: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(setup.approvals).toEqual([
      { id: "approval-initial", decision: "approve", expiresAtEpochMs: 2_000 },
      { id: "approval-replay", decision: "approve", expiresAtEpochMs: 2_000 },
      { id: "approval-changed-input", decision: "approve", expiresAtEpochMs: 2_000 }
    ]);
    expect(setup.requests.filter(({ tool }) => tool.id === flow.writeTool.id).map(({ input, idempotencyKey, approvalId }) => ({
      input,
      idempotencyKey,
      approvalId
    }))).toEqual([
      { input: flow.writeInput, idempotencyKey: flow.idempotencyKey, approvalId: undefined },
      { input: flow.writeInput, idempotencyKey: flow.idempotencyKey, approvalId: "approval-initial" },
      { input: flow.writeInput, idempotencyKey: flow.idempotencyKey, approvalId: "approval-replay" },
      { input: flow.changedWriteInput, idempotencyKey: flow.idempotencyKey, approvalId: undefined },
      { input: flow.changedWriteInput, idempotencyKey: flow.idempotencyKey, approvalId: "approval-changed-input" }
    ]);
  });

  it("passes the exact prepared input to each approval decision", async () => {
    const setup = dependencies();
    const approvedInputs: unknown[] = [];
    const client = new ScriptedSalesToolClient(setup.dependencies);

    await client.run({
      ...flow,
      approval: ({ input }) => {
        approvedInputs.push(input);
        return { id: `approval-${approvedInputs.length}`, decision: "approve", expiresAtEpochMs: 2_000 };
      }
    });

    expect(approvedInputs).toEqual([flow.writeInput, flow.writeInput, flow.changedWriteInput]);
  });
});
