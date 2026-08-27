import { describe, expect, it } from "vitest";

import { PluginUiContributionDescriptorSchema } from "../src/index.js";

const descriptor = {
  id: "sales.table.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  kind: "component",
  propsSchema: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 120 } }, required: ["title"], additionalProperties: false },
  profiles: ["workspace"],
  surfaces: ["workspace"],
  audience: "authenticated",
  permission: "sales.tasks.read",
  sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title", "status"] },
  requiredStates: ["loading", "empty", "error", "forbidden"]
} as const;

describe("P6.6 plugin UI contribution contract", () => {
  it("accepts a canonical component descriptor", () => {
    expect(PluginUiContributionDescriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(PluginUiContributionDescriptorSchema.safeParse({ ...descriptor, id: "sales.task-table", kind: "block" }).success).toBe(true);
  });

  it("rejects missing states, policy mismatch, and foreign ownership", () => {
    expect(PluginUiContributionDescriptorSchema.safeParse({ ...descriptor, requiredStates: ["loading", "empty", "error"] }).success).toBe(false);
    expect(PluginUiContributionDescriptorSchema.safeParse({ ...descriptor, permission: undefined }).success).toBe(false);
    expect(PluginUiContributionDescriptorSchema.safeParse({ ...descriptor, id: "other.table.tasks" }).success).toBe(false);
  });
});
