import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createPuckBuilderAdapter, type PuckBlockBridge } from "../src/index.js";
import { PuckEditorHost } from "../src/editor.js";

const bridge: PuckBlockBridge = {
  id: "content.text",
  version: 1,
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: false,
  defaultProps: { text: "" },
  render: ({ props }) => props.text
};
const document = {
  id: "cms.home",
  version: 1,
  schemaVersion: 1,
  profile: "cms",
  regions: { main: [{ id: "text-1", type: "content.text", version: 1, props: { text: "Hello" } }] }
};

describe("Puck editor host", () => {
  it("mounts Puck with adapter data and converts change callbacks back to canonical documents", () => {
    const adapter = createPuckBuilderAdapter({ blocks: [bridge] });
    const onChange = vi.fn();
    const element = PuckEditorHost({ adapter, document, onChange });
    expect(isValidElement(element)).toBe(true);
    const props = element.props as { data: unknown; onChange: (data: unknown) => void };
    props.onChange(props.data);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "cms.home", profile: "cms" }));
  });
});
