import { describe, expect, it } from "vitest";

import { createUiRuntimeRegistry, defineUiContributionBinding, type UiBlockDefinition } from "../src/index.js";
import { PluginUiContributionDescriptorSchema, type DataSourceDescriptor } from "@k-nex/contracts";

const propsSchema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
const block: UiBlockDefinition = {
  id: "content.card",
  version: 1,
  profiles: ["cms", "workspace"],
  surfaces: ["cms", "workspace"],
  audience: "authenticated",
  propsSchema,
  render: ({ props }) => props
};
const source: DataSourceDescriptor = {
  id: "sales.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
  presentationMetadataRevision: 1,
  title: "Tasks",
  inputFields: [],
  outputFields: [{ id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.read", sortable: true, filterOperators: [] }],
  limits: { maxSelectedFields: 8, maxPageSize: 20, maxFilters: 4, maxSorts: 2, maxBodyBytes: 4096, maxResultBytes: 65536, maxDepth: 4, timeoutMs: 5000, maxConcurrency: 4, ratePerMinute: 60, burst: 10, costClass: "low", maxCost: 10 },
  cacheClass: "actor"
};

describe("UI runtime registry", () => {
  it("validates, snapshots, and resolves trusted definitions", () => {
    const mutableProfiles = ["workspace"] as const;
    const definition = { ...block, profiles: mutableProfiles, sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }] as const, requiredFields: ["title"] } };
    const registry = createUiRuntimeRegistry({ blocks: [definition], sources: [source] });
    expect(registry.resolveBlock("content.card", 1)?.sourcePolicy?.requiredFields).toEqual(["title"]);
    expect(registry.resolveSource("sales.tasks", 1)?.title).toBe("Tasks");
    expect(Object.isFrozen(registry.blocks)).toBe(true);
    expect(Object.isFrozen(registry.sources[0])).toBe(true);
  });

  it("rejects duplicate block and source identities", () => {
    expect(() => createUiRuntimeRegistry({ blocks: [block, block], sources: [] })).toThrow(/Duplicate UI block/);
    expect(() => createUiRuntimeRegistry({ blocks: [], sources: [source, source] })).toThrow(/Duplicate UI source/);
  });

  it("rejects invalid audience, profile, and public-surface combinations", () => {
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, surfaces: ["public"] }], sources: [] })).toThrow(/Only public/);
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, audience: "public", profiles: ["workspace"], surfaces: ["workspace", "public"] }], sources: [] })).not.toThrow();
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, audience: "internal" as never }], sources: [] })).toThrow(/audience/);
  });

  it("rejects malformed callbacks and source policies", () => {
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, render: undefined as never }], sources: [] })).toThrow(/callbacks/);
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, sourcePolicy: { required: true, contracts: [], requiredFields: [] } }], sources: [] })).toThrow(/nonempty/);
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, sourcePolicy: { required: "yes" as never, contracts: [{ id: "table.records", version: 1 }], requiredFields: [] } }], sources: [] })).toThrow(/declare whether/);
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, sourcePolicy: { required: true, contracts: [{ id: "metric.scalar", version: 1 }], requiredFields: ["title"] } }], sources: [] })).toThrow(/table.records/);
    expect(() => createUiRuntimeRegistry({ blocks: [{ ...block, sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["title", "title"] } }], sources: [] })).toThrow(/canonical and unique/);
  });

  it("derives runtime props validation from the static contribution descriptor", () => {
    const descriptor = {
      id: "content.card",
      version: 1,
      ownerPluginId: "module.content",
      kind: "block" as const,
      propsSchema: {
        type: "object" as const,
        properties: { title: { type: "string" as const, minLength: 1, maxLength: 4 } },
        required: ["title"],
        additionalProperties: false as const
      },
      profiles: ["cms"] as const,
      surfaces: ["cms"] as const,
      audience: "authenticated" as const,
      permission: "content.cards.read",
      requiredStates: ["loading", "empty", "error", "forbidden"] as const
    };
    expect(PluginUiContributionDescriptorSchema.safeParse(descriptor).success).toBe(true);
    const binding = defineUiContributionBinding({ descriptor, render: ({ props }) => props });
    expect(binding.propsSchema.safeParse({ title: "Card" }).success).toBe(true);
    for (const props of [{}, { title: "Card", unexpected: true }, { title: 1 }, { title: "Longer" }]) {
      expect(binding.propsSchema.safeParse(props).success).toBe(false);
    }

    const openObject = { ...descriptor, propsSchema: { ...descriptor.propsSchema, additionalProperties: true } };
    expect(PluginUiContributionDescriptorSchema.safeParse(openObject).success).toBe(false);
    expect(() => defineUiContributionBinding({ descriptor: openObject as never, render: ({ props }) => props })).toThrow(/invalid/);
  });

  it("validates ownership catalog identities and source ownership", () => {
    expect(() => createUiRuntimeRegistry({ blocks: [], sources: [], blockCatalog: [
      { id: "content.card", version: 1, ownerPluginId: "invalid" }
    ] })).toThrow(/canonical identities/);
    expect(() => createUiRuntimeRegistry({ blocks: [], sources: [], blockCatalog: [
      { id: "content.card", version: 1, ownerPluginId: "module.content" },
      { id: "content.card", version: 1, ownerPluginId: "module.content" }
    ] })).toThrow(/unique/);
    expect(() => createUiRuntimeRegistry({ blocks: [], sources: [source], sourceCatalog: [
      { id: "sales.tasks", version: 1, ownerPluginId: "module.other" }
    ] })).toThrow(/owner does not match/);
  });
});
