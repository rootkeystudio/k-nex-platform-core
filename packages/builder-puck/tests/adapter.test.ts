import { describe, expect, it } from "vitest";

import { canonicalJson, type UiDocument } from "@k-nex/contracts";
import { createPuckBuilderAdapter, type PuckBlockBridge } from "../src/index.js";

const card: PuckBlockBridge = {
  id: "content.card",
  version: 1,
  label: "Card",
  fields: [{ prop: "title", label: "Title", kind: "text" }],
  allowChildren: true,
  defaultProps: { title: "New card" },
  render: ({ props }) => props.title
};
const text: PuckBlockBridge = {
  id: "content.text",
  version: 1,
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "textarea" }],
  allowChildren: false,
  defaultProps: { text: "" },
  render: ({ props }) => props.text
};
const fixture: UiDocument = {
  id: "cms.home",
  version: 1,
  schemaVersion: 1,
  profile: "cms",
  regions: {
    main: [{
      id: "card-1",
      type: "content.card",
      version: 1,
      props: { title: "Welcome", untouched: { enabled: true } },
      layout: { tokens: { spacing: "space.large" } },
      children: [{ id: "text-1", type: "content.text", version: 1, props: { text: "Hello" } }],
      engineMetadata: { "builder.visual": { zone: "main" } }
    }],
    sidebar: [{ id: "text-2", type: "content.text", version: 1, props: { text: "Preserved" } }]
  }
};

describe("Puck builder adapter", () => {
  it("round-trips canonical documents without semantic loss", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const puckData = adapter.toPuckData(fixture);
    expect(canonicalJson(adapter.fromPuckData(puckData))).toBe(canonicalJson(fixture));
    expect(JSON.stringify(fixture)).not.toContain("__kNex");
  });

  it("applies an editor field change and survives serialize/reload", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const puckData = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, unknown> }> };
    puckData.content[0].props["__kNexField:title"] = "Edited";
    const edited = adapter.fromPuckData(puckData);
    expect(edited.regions.main[0].props).toEqual({ title: "Edited", untouched: { enabled: true } });
    expect(canonicalJson(adapter.fromPuckData(adapter.toPuckData(edited)))).toBe(canonicalJson(edited));
  });

  it("round-trips a document without the configured canvas region", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [text] });
    const withoutMain = { ...fixture, regions: { sidebar: fixture.regions.sidebar } };
    expect(canonicalJson(adapter.fromPuckData(adapter.toPuckData(withoutMain)))).toBe(canonicalJson(withoutMain));
  });

  it("serializes a palette-added component from canonical defaults", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [text] });
    const data = structuredClone(adapter.toPuckData({ ...fixture, regions: { main: [] } })) as { content: unknown[] };
    const config = adapter.config.components["content.text__v1"] as { defaultProps: Record<string, unknown> };
    data.content.push({ type: "content.text__v1", props: { ...structuredClone(config.defaultProps), id: "text-new" } });
    expect(adapter.fromPuckData(data).regions.main[0]).toMatchObject({ id: "text-new", type: "content.text", props: { text: "" } });
  });

  it("bridges fields and the canonical child slot into Puck config", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const components = adapter.config.components as Record<string, { fields: Record<string, { type: string }> }>;
    expect(components["content.card__v1"]?.fields["__kNexField:title"]?.type).toBe("text");
    expect(components["content.card__v1"]?.fields.__kNexChildren?.type).toBe("slot");
    expect(components["content.text__v1"]?.fields.__kNexChildren).toBeUndefined();
  });

  it("rejects unknown, mismatched, and malformed editor data", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [card, text] });
    const unknown = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ type: string; props: Record<string, unknown> }> };
    unknown.content[0].type = "unknown.block__v1";
    expect(() => adapter.fromPuckData(unknown)).toThrow(/Unknown Puck component/);

    const mismatched = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, any> }> };
    mismatched.content[0].props.__kNexNode.type = "content.text";
    expect(() => adapter.fromPuckData(mismatched)).toThrow(/does not match/);

    const missingField = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, unknown> }> };
    delete missingField.content[0].props["__kNexField:title"];
    expect(() => adapter.fromPuckData(missingField)).toThrow(/field is missing/);

    const wrongFieldType = structuredClone(adapter.toPuckData(fixture)) as { content: Array<{ props: Record<string, unknown> }> };
    wrongFieldType.content[0].props["__kNexField:title"] = 42;
    expect(() => adapter.fromPuckData(wrongFieldType)).toThrow(/invalid value/);
  });

  it("rejects duplicate bridges and child content on leaf blocks", () => {
    expect(() => createPuckBuilderAdapter({ blocks: [card, card] })).toThrow(/Duplicate/);
    const adapter = createPuckBuilderAdapter({ blocks: [text] });
    expect(() => adapter.toPuckData({ ...fixture, regions: { main: [{ ...fixture.regions.main[0], type: "content.text", children: fixture.regions.main[0].children }] } })).toThrow(/does not allow children/);
  });
});
