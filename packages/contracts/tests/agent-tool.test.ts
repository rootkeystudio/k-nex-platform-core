import { describe, expect, it } from "vitest";

import {
  AgentToolDescriptorSchema,
  AgentToolInputSchemaSchema,
  PluginManifestSchema
} from "../src/index.js";

const inputSchema = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const, minLength: 1, maxLength: 120 }
  },
  required: ["title"],
  additionalProperties: false as const
};

const readTool = {
  id: "sales.tools.search-tasks",
  version: 1,
  ownerPluginId: "module.sales",
  title: "Search tasks",
  description: "Search tasks visible to the current actor.",
  inputSchema,
  outputContract: "table.records@1",
  invocation: { kind: "source" as const, source: { id: "sales.tasks", version: 1 } },
  audience: "authenticated" as const,
  surfaces: ["workspace"] as const,
  permission: "sales.tasks.read",
  policy: "sales.tasks.agent-read",
  effect: "read-only" as const,
  risk: "low" as const,
  approval: "none" as const,
  idempotency: "not-applicable" as const,
  dryRun: false,
  limits: {
    timeoutMs: 5_000,
    maxConcurrency: 4,
    ratePerMinute: 120,
    burst: 10,
    costClass: "low" as const,
    maxCost: 10
  },
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.task.search" }
};

describe("P2A.1 agent-tool contracts", () => {
  it("accepts a source-backed read descriptor and preserves serializable metadata", () => {
    const result = AgentToolDescriptorSchema.safeParse(readTool);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invocation).toEqual({ kind: "source", source: { id: "sales.tasks", version: 1 } });
      expect(result.data.inputSchema).toEqual(inputSchema);
    }
  });

  it("accepts a write only with per-call approval and required idempotency", () => {
    expect(AgentToolDescriptorSchema.safeParse({
      ...readTool,
      id: "sales.tools.create-task",
      title: "Create task",
      effect: "write",
      approval: "per-call",
      idempotency: "required",
      invocation: { kind: "action", action: { id: "sales.task.create", version: 1 } }
    }).success).toBe(true);
  });

  it.each([
    ["rejects an open input object", { inputSchema: { ...inputSchema, additionalProperties: true } }, "additionalProperties"],
    ["rejects an undeclared required field", { inputSchema: { ...inputSchema, required: ["missing"] } }, "required"],
    ["rejects a non-object input", { inputSchema: { type: "string" } }, "type"],
    ["rejects a write without approval", { effect: "write", approval: "none", idempotency: "required" }, "approval"],
    ["rejects a write without idempotency", { effect: "write", approval: "per-call", idempotency: "not-applicable" }, "idempotency"],
    ["rejects a write backed by a source", { effect: "write", approval: "per-call", idempotency: "required" }, "invocation"],
    ["rejects destructive effects", { effect: "destructive" }, "effect"],
    ["rejects external effects", { effect: "external" }, "effect"]
  ] as const)("%s with a stable diagnostic path", (_label, patch, path) => {
    const result = AgentToolDescriptorSchema.safeParse({ ...readTool, ...patch });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.at(-1) === path)).toBe(true);
  });

  it("rejects executable schemas and duplicate/unknown manifest contributions", () => {
    expect(AgentToolInputSchemaSchema.safeParse({
      type: "object",
      properties: { title: { parse: () => "unsafe" } },
      additionalProperties: false
    }).success).toBe(false);
    expect(AgentToolInputSchemaSchema.safeParse({
      type: "object",
      properties: { title: { type: "string", enum: [{ nested: true }] } },
      additionalProperties: false
    }).success).toBe(false);

    const manifest = {
      apiVersion: 1,
      id: "module.sales",
      kind: "module",
      displayName: "Sales",
      version: "1.0.0",
      package: "@k-nex/module-sales",
      compatibility: { core: "1", payload: "3", node: "24", payloadDatabaseAdapters: ["postgres"] },
      lifecycle: { ownsPayloadSchema: false, ownsPersistentData: true, disable: "supported", purge: "unsupported", uninstall: "unsupported" },
      contributions: { tools: { "sales.tools.search-tasks": "required" } }
    };
    expect(PluginManifestSchema.safeParse(manifest).success).toBe(true);
    expect(PluginManifestSchema.safeParse({
      ...manifest,
      contributions: { contracts: { "sales.tools.search-tasks": "required" } }
    }).success).toBe(false);
  });
});
