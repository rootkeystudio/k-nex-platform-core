import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
      expect(runtime).toMatchObject({ kind: bridge.definition.id.slice("content.".length), props: bridge.defaultProps });
      expect(runtime).toHaveProperty("component");
      expect(runtime).toHaveProperty("accessibility.role");
      expect(runtime).toHaveProperty("element");
      const editorMarkup = renderToStaticMarkup(editor as Parameters<typeof renderToStaticMarkup>[0]);
      const runtimeMarkup = renderToStaticMarkup((runtime as { element: Parameters<typeof renderToStaticMarkup>[0] }).element);
      expect(editorMarkup).toBe(runtimeMarkup);
      const componentName = String((runtime as { component: string }).component).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(runtimeMarkup).toContain(`data-k-nex-component="${componentName.replace(/^-/, "")}"`);
      const role = String((runtime as { accessibility: { role: string } }).accessibility.role);
      if (role === "heading") expect(runtimeMarkup).toMatch(/<h[1-6]\b/);
      else if (role === "table") expect(runtimeMarkup).toMatch(/<table\b/);
      else if (role === "form") expect(runtimeMarkup).toMatch(/<form\b/);
      else if (role === "status") expect(runtimeMarkup).toContain('role="status"');
      else if (role === "tablist") expect(runtimeMarkup).toContain('role="tablist"');
      else if (role === "region") expect(runtimeMarkup).toMatch(/<section\b[^>]*aria-label=/);
    }
  });
});
