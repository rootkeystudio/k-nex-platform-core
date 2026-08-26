import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AgentToolDescriptor } from "@k-nex/contracts";
import type { ToolGatewayResponse } from "@k-nex/runtime";

import {
  createPayloadMcpPlugin,
  createPayloadMcpPluginConfig,
  payloadMcpAdapterInventory,
  type PayloadMcpAdapterOptions
} from "../src/mcp-adapter.js";

const readTool = {
  id: "sales.tools.search",
  version: 1,
  ownerPluginId: "module.sales",
  title: "Search sales tasks",
  description: "Search visible sales tasks.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1, maxLength: 32 } },
    required: ["query"],
    additionalProperties: false
  },
  invocation: { kind: "source", source: { id: "sales.tasks", version: 1 } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  policy: "sales.tasks.read",
  effect: "read-only",
  risk: "low",
  approval: "none",
  idempotency: "not-applicable",
  dryRun: true,
  limits: { timeoutMs: 1_000, maxConcurrency: 1, ratePerMinute: 60, burst: 5, costClass: "low", maxCost: 1 },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.search" }
} satisfies AgentToolDescriptor;

const writeTool = {
  ...readTool,
  id: "sales.tools.update",
  title: "Update sales task",
  description: "Update one visible sales task.",
  invocation: { kind: "action", action: { id: "sales.tasks.update", version: 1 } },
  effect: "write",
  approval: "per-call",
  idempotency: "required"
} satisfies AgentToolDescriptor;

function futureExpiry(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
}

function request(): { headers: Headers } {
  return { headers: new Headers() };
}

function options(overrides: Partial<PayloadMcpAdapterOptions> = {}): PayloadMcpAdapterOptions {
  const gateway = {
    execute: vi.fn(async (): Promise<ToolGatewayResponse> => ({
      ok: true,
      status: 200,
      body: {
        schemaVersion: 1,
        correlationId: "corr-1",
        tool: { id: readTool.id, version: readTool.version },
        provenance: "k-nex-tool",
        trust: "structured-untrusted-content",
        data: { result: "safe" }
      }
    }))
  };
  return {
    tools: [readTool, writeTool],
    catalog: { list: vi.fn(async () => ({ revision: "sha256:revision", tools: [readTool] })) },
    gateway,
    context: {
      resolve: vi.fn(async () => ({
        actor: { principal: { kind: "user", id: "actor-1" }, effectiveActor: { kind: "user", id: "actor-1" } },
        delegation: { id: "grant-1" },
        authorizationContext: { workspaceId: "workspace-1" },
        surface: "workspace" as const,
        features: []
      }))
    },
    surface: "workspace",
    ...overrides
  } as PayloadMcpAdapterOptions;
}

describe("Payload MCP adapter", () => {
  it("registers only explicit K-Nex tools and disables Payload CRUD/experimental surfaces", () => {
    const config = createPayloadMcpPluginConfig(options());
    expect(config.collections).toEqual({});
    expect(config.globals).toEqual({});
    expect(config.experimental).toBeUndefined();
    expect(config.mcp?.tools?.map((tool) => tool.name)).toEqual([
      "k-nex-sales-tools-search-v1",
      "k-nex-sales-tools-update-v1"
    ]);
    expect(config.mcp?.handlerOptions?.maxDuration).toBe(30);
    expect(config.mcp?.handlerOptions?.disableSse).toBe(true);
  });

  it("intersects enum membership with string and numeric constraints", () => {
    const constrainedTool = {
      ...readTool,
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "done"], minLength: 1, maxLength: 4 },
          rank: { type: "integer", enum: [1, 2], minimum: 1, maximum: 2 }
        },
        required: ["status", "rank"],
        additionalProperties: false
      }
    } satisfies AgentToolDescriptor;
    const tool = createPayloadMcpPluginConfig(options({ tools: [constrainedTool] })).mcp?.tools?.[0];

    expect(tool?.parameters.status?.safeParse("open").success).toBe(true);
    expect(tool?.parameters.status?.safeParse("").success).toBe(false);
    expect(tool?.parameters.status?.safeParse("other").success).toBe(false);
    expect(tool?.parameters.rank?.safeParse(1).success).toBe(true);
    expect(tool?.parameters.rank?.safeParse(1.5).success).toBe(false);
    expect(tool?.parameters.rank?.safeParse(3).success).toBe(false);
  });

  it("intersects API-key capability toggles with actor/delegation-filtered catalog visibility", async () => {
    const setup = options();
    const config = createPayloadMcpPluginConfig(setup);
    const defaults = {
      user: { id: "actor-1", collection: "users" },
      expiresAt: futureExpiry(),
      "payload-mcp-tool": { kNexSalesToolsSearchV1: true, kNexSalesToolsUpdateV1: true }
    } as never;
    const settings = await config.overrideAuth!(request() as never, async () => defaults);
    expect(settings["payload-mcp-tool"]).toEqual({ kNexSalesToolsSearchV1: true, kNexSalesToolsUpdateV1: false });
    expect(settings.collections).toEqual({});
    expect(settings.globals).toEqual({});
    expect((setup.catalog.list as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      surface: "workspace",
      limit: 100
    });
  });

  it("re-enters the K-Nex gateway and returns only the safe structured envelope", async () => {
    const setup = options();
    const config = createPayloadMcpPluginConfig(setup);
    const handler = config.mcp?.tools?.[0]?.handler;
    expect(handler).toBeTypeOf("function");
    const payloadRequest = { headers: new Headers({ "x-correlation-id": "corr-1", "idempotency-key": "key-1" }) };
    const response = await handler!({ query: "follow-up" }, payloadRequest as never, undefined);
    expect(JSON.parse(response.content[0]!.text)).toMatchObject({ provenance: "k-nex-tool", data: { result: "safe" } });
    expect(response.structuredContent).toEqual({ result: "safe" });
    expect(response.isError).toBeUndefined();
    expect(setup.gateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      rawRequest: payloadRequest,
      tool: { id: readTool.id, version: readTool.version },
      input: { query: "follow-up" },
      idempotencyKey: "key-1"
    }));
  });

  it("maps gateway failures to an MCP tool error result", async () => {
    const failure: ToolGatewayResponse = {
      ok: false,
      status: 403,
      body: {
        type: "urn:k-nex:problem:tool-forbidden",
        title: "Tool was forbidden.",
        status: 403,
        detail: "Tool was forbidden.",
        code: "TOOL_FORBIDDEN",
        correlationId: "corr-1"
      }
    };
    const setup = options({ gateway: { execute: vi.fn(async () => failure) } });
    const handler = createPayloadMcpPluginConfig(setup).mcp?.tools?.[0]?.handler;
    const response = await handler!({ query: "follow-up" }, request() as never, undefined);
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect(JSON.parse(response.content[0]!.text)).toMatchObject({ code: "TOOL_FORBIDDEN", status: 403 });
  });

  it("serves tools/list and tools/call over the MCP protocol", async () => {
    const setup = options();
    const config = createPayloadMcpPluginConfig(setup);
    const server = new McpServer({ name: "k-nex-test", version: "1.0.0" });
    const payloadRequest = request();
    for (const tool of config.mcp?.tools ?? []) {
      server.registerTool(tool.name, { description: tool.description, inputSchema: tool.parameters }, (args) =>
        tool.handler(args as Record<string, unknown>, payloadRequest as never, undefined) as never
      );
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "k-nex-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual([
        "k-nex-sales-tools-search-v1",
        "k-nex-sales-tools-update-v1"
      ]);
      const called = await client.callTool({
        name: "k-nex-sales-tools-search-v1",
        arguments: { query: "follow-up" }
      });
      expect(called.isError).toBeUndefined();
      expect(called.structuredContent).toEqual({ result: "safe" });
      expect(JSON.parse((called.content[0] as { text: string }).text)).toMatchObject({
        provenance: "k-nex-tool",
        data: { result: "safe" }
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("fails closed for an API key that has not enabled the visible K-Nex tool", async () => {
    const config = createPayloadMcpPluginConfig(options());
    const defaults = { user: { id: "actor-1", collection: "users" }, expiresAt: futureExpiry(), "payload-mcp-tool": { kNexSalesToolsSearchV1: false } } as never;
    const settings = await config.overrideAuth!(request() as never, async () => defaults);
    expect(settings["payload-mcp-tool"]).toEqual({ kNexSalesToolsSearchV1: false, kNexSalesToolsUpdateV1: false });
  });

  it("keeps API-key collection management bounded to the configured user collection", async () => {
    const config = createPayloadMcpPluginConfig(options({ userCollection: "members" }));
    const collection = config.overrideApiKeyCollection!({
      slug: "payload-mcp-api-keys",
      auth: { useAPIKey: true },
      access: { create: () => true, read: () => true }
    });
    expect(await collection.access?.create?.({ req: { user: null } } as never)).toBe(false);
    expect(await collection.access?.create?.({ req: { user: { id: "member-1", collection: "members" } } } as never)).toBe(true);
    expect(collection.indexes).toContainEqual({ fields: ["apiKeyIndex"], unique: true });
    expect(collection.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "expiresAt", required: true, index: true })]));
  });

  it("rejects expired, missing, and overlong API-key lifetimes", async () => {
    const config = createPayloadMcpPluginConfig(options());
    const resolve = (expiresAt?: string) => config.overrideAuth!(request() as never, async () => ({
      user: { id: "actor-1", collection: "users" },
      ...(expiresAt === undefined ? {} : { expiresAt }),
      "payload-mcp-tool": { kNexSalesToolsSearchV1: true }
    }) as never);
    await expect(resolve()).rejects.toThrow();
    await expect(resolve(new Date(Date.now() - 1_000).toISOString())).rejects.toThrow();
    await expect(resolve(new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000).toISOString())).rejects.toThrow();
  });

  it("bounds duration and isolates telemetry failures", () => {
    expect(() => createPayloadMcpPluginConfig(options({ maxDurationSeconds: 31 }))).toThrow(/max duration/);
    const telemetry = vi.fn(() => { throw new Error("telemetry unavailable"); });
    const config = createPayloadMcpPluginConfig(options({ telemetry }));
    expect(() => config.mcp?.handlerOptions?.onEvent?.({ method: "tools/call" })).not.toThrow();
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ kind: "mcp.transport-event" }));
  });

  it("inventories the official API-key collection when the plugin is applied", async () => {
    const plugin = createPayloadMcpPlugin(options());
    const applied = await plugin({ secret: "fixture-secret", collections: [] } as never);
    const apiKeys = applied.collections?.find((collection) => collection.slug === "payload-mcp-api-keys");
    expect(apiKeys).toBeDefined();
    expect(apiKeys?.fields.some((field) => field.type === "collapsible")).toBe(true);
    expect(apiKeys?.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: "expiresAt" })]));
    expect(applied.collections?.some((collection) => collection.slug === "sales.tasks")).toBe(false);
    const endpoints = applied.endpoints?.map(({ method, path }) => `${method.toUpperCase()} /api${path}`).sort();
    expect(payloadMcpAdapterInventory).toMatchObject({
      package: "@payloadcms/plugin-mcp",
      version: "3.88.0",
      collections: [apiKeys?.slug],
      endpoints,
      adminGroups: [apiKeys?.admin?.group]
    });
  });
});
