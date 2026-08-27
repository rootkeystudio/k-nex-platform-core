import { describe, expect, it } from "vitest";

import { canonicalJson } from "@k-nex/contracts";
import { createPuckBuilderAdapter } from "@k-nex/builder-puck";
import { genericPuckBlockBridges } from "../src/index.js";

describe("generic Puck block library", () => {
  it("covers the canonical generic block set and round-trips through shared definitions", () => {
    expect(genericPuckBlockBridges.map(({ label }) => label)).toEqual(["Stack", "Grid", "Section", "Heading", "Text", "Card", "Alert", "Tabs", "Accordion", "Metric", "DataTable", "Form", "EmptyState"]);
    const adapter = createPuckBuilderAdapter({ blocks: genericPuckBlockBridges, preview: { surface: "public", actor: { authenticated: false, permissions: new Set() } } });
    const nodes = genericPuckBlockBridges.map((bridge, index) => ({ id: `generic-${index}`, type: bridge.definition.id, version: 1, props: bridge.defaultProps, ...(bridge.allowChildren ? { children: [] } : {}) }));
    const document = { id: "content.reference", version: 1, schemaVersion: 1 as const, profile: "cms" as const, regions: { main: nodes } };
    const data = adapter.toPuckData(document);
    expect(canonicalJson(adapter.fromPuckData(data))).toBe(canonicalJson(document));
    for (const [index, bridge] of genericPuckBlockBridges.entries()) {
      const editor = (adapter.config.components[`${bridge.definition.id}__v1`] as { render: (props: Record<string, unknown>) => unknown }).render(data.content[index]!.props);
      const runtime = bridge.definition.render({ node: nodes[index]!, props: bridge.defaultProps, surface: "public", actor: { authenticated: false, permissions: new Set() } });
      expect(editor).toEqual("Unsupported block presentation");
      expect(runtime).toMatchObject({ kind: bridge.definition.id.slice("content.".length), props: bridge.defaultProps });
    }
  });
});
