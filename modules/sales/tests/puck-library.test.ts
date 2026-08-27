import { describe, expect, it } from "vitest";

import { canonicalJson } from "@k-nex/contracts";
import { createPuckBuilderProfileRegistry } from "@k-nex/builder-puck";
import { salesPageTemplates, salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "../src/contracts.js";
import { salesPuckBlockBridges } from "../src/ui.js";

const sources = [salesTasksDescriptor, salesOpportunitiesDescriptor, salesTotalPotentialRevenueDescriptor];
const profile = {
  id: "workspace" as const,
  blocks: salesPuckBlockBridges.map(({ definition }) => ({ id: definition.id, version: definition.version })),
  sources: sources.map(({ id, version }) => ({ id, version })),
  publication: "save-layout" as const
};

describe("Sales Puck block library", () => {
  it("round-trips every default page under the workspace profile policy", () => {
    const resolved = createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges, sources, profiles: [profile] }).resolve("workspace")!;
    for (const template of salesPageTemplates) {
      expect(resolved.validateDocument(template.document).id).toBe(template.id);
      expect(canonicalJson(resolved.adapter.fromPuckData(resolved.adapter.toPuckData(template.document)))).toBe(canonicalJson(template.document));
    }
  });

  it("rejects missing blocks and unauthorized action replacement", () => {
    expect(() => createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges.slice(1), sources, profiles: [profile] })).toThrow(/unknown block/);
    const resolved = createPuckBuilderProfileRegistry({ blocks: salesPuckBlockBridges, sources, profiles: [profile] }).resolve("workspace")!;
    const taskTemplate = salesPageTemplates.find(({ id }) => id === "sales.page.tasks")!;
    const changed = structuredClone(taskTemplate.document);
    changed.regions.main[1]!.bindings!.action = { id: "sales.task.update", version: 1 };
    expect(() => resolved.validateDocument(changed)).toThrow(/ACTION_NOT_ACCEPTED/);
  });
});
