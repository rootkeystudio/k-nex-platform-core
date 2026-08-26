import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PluginManifestSchema, type AgentToolDescriptor } from "@k-nex/contracts";
import {
  BoundedToolRiskBudgetEvaluator,
  InMemoryToolApprovalEvaluator,
  InMemoryToolIdempotencyCoordinator,
  SafeToolAuditDecorator,
  SafeToolProblemSerializer,
  ScriptedSalesToolClient,
  ToolCatalog,
  ToolExecutionGateway,
  ToolGatewayError,
  executeRegistration,
  type ScriptedToolRequestDetails,
  type ToolExecutionContext,
  type ToolGatewayRequest,
  type ToolGatewayStages
} from "@k-nex/runtime";
import {
  salesCreateTaskToolDescriptor,
  salesRegistration,
  salesSearchTasksDescriptor,
  salesTaskCreateDefinition,
  salesTasksDefinition
} from "@k-nex/module-sales/server";
import { describe, expect, it } from "vitest";

import { createPayloadMcpPluginConfig } from "../src/mcp-adapter.js";

const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../../../modules/sales/k-nex.plugin.json"),
  "utf8"
)));

function registration() {
  return executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [{
        id: manifest.id,
        kind: manifest.kind,
        package: manifest.package,
        version: manifest.version,
        integrity: "sha512-sales-tool-proof",
        required: [],
        optional: []
      }],
      capabilityProviders: [],
      registrationOrder: [manifest.id]
    },
    installed: [{
      package: { name: manifest.package, version: manifest.version, integrity: "sha512-sales-tool-proof" },
      manifest
    }],
    registrations: [salesRegistration]
  });
}

function parsed<T>(result: { success: true; data: T } | { success: false; error: unknown }): T {
  if (!result.success) throw new ToolGatewayError("TOOL_CONTRACT_INVALID", 500, "Tool contract validation failed.");
  return result.data;
}

describe("P2A.8 Sales tool proof", () => {
  it("runs one logical approved write, stable replay, conflict, audit, and the same read through MCP", async () => {
    const resolved = registration();
    const actor = {
      principal: { kind: "user" as const, id: "user-1" },
      effectiveActor: { kind: "user" as const, id: "user-1" }
    };
    const catalogContext = {
      actor,
      delegation: { id: "delegation-1", principalId: "user-1", applicationId: "app-1" },
      authorizationContext: { revision: "sales-policy-1" },
      surface: "workspace" as const,
      features: [] as const
    };
    const catalog = new ToolCatalog(resolved, { isVisible: () => true });
    const tasks = [{ id: "task-1", title: "Seed follow-up", status: "open", potentialRevenue: "10.00", privateNote: "seed-secret" }];
    let creates = 0;
    const payloadRequest = {
      payload: {
        find: async () => ({ docs: tasks, page: 1, totalPages: 1, hasNextPage: false }),
        create: async (options: { data: { title: string; status?: "open" | "done" } }) => {
          creates += 1;
          const task = { id: `task-${tasks.length + 1}`, title: options.data.title, status: options.data.status ?? "open", potentialRevenue: null, privateNote: null };
          tasks.push(task);
          return task;
        }
      },
      locale: "en-US",
      transactionID: "tx-tool-proof"
    };
    const audits: unknown[] = [];
    const clock = { now: () => 1_000 };
    const approval = new InMemoryToolApprovalEvaluator(
      clock,
      {
        resolve: (context) => ({
          principalId: "user-1",
          agentSessionId: "session-1",
          ...((context.agentClient.session as { approvalId?: string }).approvalId === undefined
            ? {}
            : { approvalId: (context.agentClient.session as { approvalId: string }).approvalId })
        })
      },
      { authorize: () => true }
    );
    const budget = new BoundedToolRiskBudgetEvaluator(clock, {
      resolve: () => ({ principalId: "user-1", agentRunId: "run-1" })
    });
    const stages: ToolGatewayStages = {
      principal: {
        authenticate: () => ({ actor, request: payloadRequest, authorizationContext: catalogContext.authorizationContext })
      },
      agentClient: {
        authenticate: (request) => ({
          client: { id: "deterministic-client" },
          session: {
            id: "session-1",
            ...((request.rawRequest as { approvalId?: string }).approvalId === undefined
              ? {}
              : { approvalId: (request.rawRequest as { approvalId: string }).approvalId })
          }
        })
      },
      delegation: { evaluate: () => catalogContext.delegation },
      catalog: {
        lookup: (id, version, context) => catalog.lookup(id, version, {
          actor: context.principal.actor as typeof actor,
          delegation: context.delegation,
          authorizationContext: context.principal.authorizationContext,
          surface: context.surface,
          features: context.features
        })
      },
      input: {
        validate: (descriptor, input) => {
          if (descriptor.id === salesCreateTaskToolDescriptor.id) return parsed(salesTaskCreateDefinition.inputSchema.safeParse(input));
          if (descriptor.id === salesSearchTasksDescriptor.id && typeof input === "object" && input !== null &&
            Object.keys(input).join("\u0000") === "query" && typeof (input as { query?: unknown }).query === "string") return input;
          throw new ToolGatewayError("TOOL_INPUT_INVALID", 400, "Tool input is invalid.");
        }
      },
      authorization: { authorize: () => ({ scope: "sales.tasks" }) },
      budget,
      approval,
      idempotency: new InMemoryToolIdempotencyCoordinator(clock),
      dispatcher: {
        dispatch: async (context) => {
          if (context.descriptor.id === salesCreateTaskToolDescriptor.id) {
            const handler = resolved.bindings.actions.find(({ id }) => id === "sales.task.create")?.value;
            if (typeof handler !== "function") throw new Error("Sales action binding is missing.");
            return handler({
              actor: context.principal.actor,
              request: context.principal.request,
              authorizationContext: context.principal.authorizationContext,
              input: context.input,
              idempotencyKey: context.request.idempotencyKey,
              signal: context.signal
            });
          }
          const handler = resolved.bindings.dataSources.find(({ id }) => id === "sales.tasks")?.value;
          if (typeof handler !== "function") throw new Error("Sales source binding is missing.");
          return handler({
            actor: context.principal.actor,
            request: context.principal.request,
            authorizationContext: context.principal.authorizationContext,
            input: {},
            query: {
              page: { number: 1, size: 25 },
              filters: [{ field: "title", operator: "contains", value: (context.input as { query: string }).query }],
              sort: []
            },
            selectedFields: ["title", "status", "potential-revenue"],
            recordScope: { kind: "sales.tasks" },
            signal: context.signal
          });
        }
      },
      output: {
        validate: (descriptor, output) => descriptor.id === salesCreateTaskToolDescriptor.id
          ? parsed(salesTaskCreateDefinition.outputSchema.safeParse(output))
          : parsed(salesTasksDefinition.outputSchema.safeParse(output))
      },
      redactor: { redact: (_context, output) => output },
      audit: new SafeToolAuditDecorator(
        clock,
        {
          resolve: (request, context?: ToolExecutionContext) => ({
            principalId: "user-1",
            agentClientId: "deterministic-client",
            agentSessionId: "session-1",
            delegationId: "delegation-1",
            approvalId: (context?.approval as { id?: string } | undefined)?.id,
            idempotencyReference: (context?.idempotency as { reference?: string } | undefined)?.reference,
            inputDigest: (context?.idempotency as { inputDigest?: string } | undefined)?.inputDigest
          })
        },
        { write: (record) => { audits.push(record); } }
      ),
      problem: new SafeToolProblemSerializer()
    };
    const gateway = new ToolExecutionGateway(stages);
    const request = (details: ScriptedToolRequestDetails): ToolGatewayRequest => ({
      correlationId: details.correlationId,
      rawRequest: details,
      tool: details.tool,
      surface: details.context.surface,
      features: details.context.features,
      input: details.input,
      signal: new AbortController().signal,
      ...(details.idempotencyKey === undefined ? {} : { idempotencyKey: details.idempotencyKey })
    });
    const client = new ScriptedSalesToolClient({
      catalog,
      gateway,
      authenticate: () => catalogContext,
      request
    });
    const proof = await client.run({
      readTool: salesSearchTasksDescriptor,
      readInput: { query: "Seed" },
      forbiddenTool: { id: "sales.tools.forbidden", version: 1 },
      forbiddenInput: {},
      writeTool: salesCreateTaskToolDescriptor,
      writeInput: { title: "Approved follow-up", privateNote: "never-audit-this" },
      changedWriteInput: { title: "Changed follow-up", privateNote: "never-audit-this-either" },
      idempotencyKey: "create-task-proof-1",
      approval: ({ stage }) => ({ id: `approval-${stage}`, decision: "approve", expiresAtEpochMs: 2_000 })
    });

    expect(proof.catalog.tools.map(({ id }) => id)).toEqual(["sales.tools.create-task", "sales.tools.search-tasks"]);
    expect(proof.read).toMatchObject({ ok: true, body: { trust: "structured-untrusted-content" } });
    expect(proof.forbidden).toMatchObject({ ok: false, status: 404, body: { code: "TOOL_NOT_FOUND" } });
    expect(proof.prepared).toMatchObject({ ok: true, body: { status: "required" } });
    expect(proof.write).toMatchObject({ ok: true, body: { data: { id: "task-2", title: "Approved follow-up", status: "open" } } });
    expect(proof.replay).toEqual(proof.write);
    expect(proof.changedReplay).toMatchObject({ ok: false, status: 409, body: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(creates).toBe(1);
    expect(tasks).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("never-audit-this");

    const adapter = createPayloadMcpPluginConfig({
      tools: [salesSearchTasksDescriptor, salesCreateTaskToolDescriptor],
      catalog,
      gateway,
      context: { resolve: () => catalogContext },
      surface: "workspace"
    });
    const payloadMcpRequest = { headers: new Headers({ "x-correlation-id": "mcp-sales-read" }) };
    const defaults = {
      user: { id: "user-1", collection: "users" },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      "payload-mcp-tool": {
        kNexSalesToolsSearchTasksV1: true,
        kNexSalesToolsCreateTaskV1: true
      }
    } as never;
    const access = await adapter.overrideAuth!(payloadMcpRequest as never, async () => defaults);
    expect(Object.values(access["payload-mcp-tool"] ?? {})).toEqual([true, true]);
    const readHandler = adapter.mcp?.tools?.find(({ name }) => name.includes("search-tasks"))?.handler;
    const mcpRead = await readHandler!({ query: "Seed" }, payloadMcpRequest as never, undefined);
    expect(JSON.parse(mcpRead.content[0]!.text)).toMatchObject({ provenance: "k-nex-tool", trust: "structured-untrusted-content" });
  });
});
