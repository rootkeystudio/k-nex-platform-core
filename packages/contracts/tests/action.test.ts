import { describe, expect, it } from "vitest";

import { ActionDescriptorSchema } from "../src/index.js";

const inputSchema = {
  type: "object" as const,
  properties: {
    taskId: { type: "string" as const, minLength: 1, maxLength: 64 }
  },
  required: ["taskId"],
  additionalProperties: false as const
};

const outputSchema = {
  type: "object" as const,
  properties: {
    accepted: { type: "boolean" as const }
  },
  required: ["accepted"],
  additionalProperties: false as const
};

const action = {
  id: "sales.task.complete",
  version: 1,
  ownerPluginId: "module.sales",
  inputSchema,
  outputSchema,
  permission: "sales.tasks.write",
  policy: "sales.tasks.domain",
  effect: "write" as const,
  idempotency: "required" as const,
  dryRun: true
};

describe("P2A.3 action contracts", () => {
  it("accepts a serializable action descriptor with a bounded schema", () => {
    const result = ActionDescriptorSchema.safeParse(action);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(action);
      expect(JSON.stringify(result.data)).not.toContain("handler");
    }
  });

  it("accepts a canonical output-contract reference instead of an inline schema", () => {
    expect(ActionDescriptorSchema.safeParse({
      ...action,
      id: "sales.task.complete-summary",
      outputSchema: undefined,
      outputContract: "table.records@1",
      effect: "read-only",
      idempotency: "not-applicable"
    }).success).toBe(true);
  });

  it.each([
    ["rejects a non-canonical action ID", { id: "Sales.Task.Complete" }, "id"],
    ["rejects version zero", { version: 0 }, "version"],
    ["rejects an open input schema", { inputSchema: { ...inputSchema, additionalProperties: true } }, "additionalProperties"],
    ["rejects an action without an output contract", { outputSchema: undefined }, "outputSchema"],
    ["rejects both output representations", { outputContract: "table.records@1" }, "outputSchema"],
    ["rejects a write without idempotency", { idempotency: "not-applicable" }, "idempotency"],
    ["rejects an unknown permission", { permission: "sales tasks.write" }, "permission"]
  ] as const)("%s with a stable diagnostic path", (_label, patch, path) => {
    const result = ActionDescriptorSchema.safeParse({ ...action, ...patch });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.at(-1) === path)).toBe(true);
  });

  it("keeps read-only actions free of write idempotency requirements", () => {
    expect(ActionDescriptorSchema.safeParse({
      ...action,
      id: "sales.task.inspect",
      outputContract: "table.records@1",
      outputSchema: undefined,
      effect: "read-only",
      idempotency: "not-applicable"
    }).success).toBe(true);
  });

  it("rejects executable handler metadata", () => {
    expect(ActionDescriptorSchema.safeParse({ ...action, handler: () => undefined }).success).toBe(false);
  });

  it("rejects output schemas beyond the bounded nesting depth", () => {
    let output: unknown = { type: "string" };
    for (let depth = 0; depth < 9; depth += 1) output = { type: "array", items: output };
    expect(ActionDescriptorSchema.safeParse({ ...action, outputSchema: output }).success).toBe(false);
  });
});
