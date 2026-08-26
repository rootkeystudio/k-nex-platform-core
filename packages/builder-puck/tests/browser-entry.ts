import "@puckeditor/core/puck.css";
import { createRoot } from "react-dom/client";

import { createPuckBuilderAdapter, type PuckBlockBridge } from "../src/index.js";
import { PuckEditorHost } from "../src/editor.js";

const definition = {
  id: "content.text",
  version: 1,
  profiles: ["cms"] as const,
  surfaces: ["cms", "public"] as const,
  audience: "public" as const,
  propsSchema: {
    safeParse(value: unknown) {
      const valid = value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).length === 1 && typeof (value as { text?: unknown }).text === "string";
      return valid ? { success: true as const, data: value } : { success: false as const, error: "invalid" };
    }
  },
  render: ({ props }: { props: unknown }) => (props as { text: string }).text
};
const bridge: PuckBlockBridge = {
  definition,
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: false,
  defaultProps: { text: "" }
};
const adapter = createPuckBuilderAdapter({ blocks: [bridge], preview: { surface: "cms", actor: { authenticated: true, permissions: new Set() } } });
const uiDocument = {
  id: "cms.browser-proof",
  version: 1,
  schemaVersion: 1,
  profile: "cms",
  regions: { main: [
    { id: "first", type: "content.text", version: 1, props: { text: "First" } },
    { id: "second", type: "content.text", version: 1, props: { text: "Second" } }
  ] }
};

declare global {
  interface Window { __kNexDocument: unknown }
}
window.__kNexDocument = uiDocument;
const root = document.getElementById("root");
if (root === null) throw new Error("Browser fixture root is missing.");
createRoot(root).render(PuckEditorHost({ adapter, document: uiDocument, onChange: (next) => { window.__kNexDocument = next; } }));
