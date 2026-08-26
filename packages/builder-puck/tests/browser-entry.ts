import "@puckeditor/core/puck.css";
import { createRoot } from "react-dom/client";

import type { DataSourceDescriptor } from "@k-nex/contracts";
import {
  createStaticTextBlockDefinition,
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
  createWorkspaceTaskTableBlockDefinition,
  presentUiRuntimeResult
} from "@k-nex/ui-runtime";
import { createPuckBuilderAdapter, type PuckBlockBridge } from "../src/index.js";
import { PuckEditorHost } from "../src/editor.js";

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
  outputFields: [
    { id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.title.read", sortable: false, filterOperators: [] },
    { id: "status", kind: "status", binding: "required", nullable: false, permission: "sales.tasks.status.read", sortable: false, filterOperators: [] }
  ],
  limits: {
    maxSelectedFields: 8, maxPageSize: 20, maxFilters: 4, maxSorts: 2, maxBodyBytes: 4096, maxResultBytes: 65536,
    maxDepth: 4, timeoutMs: 5000, maxConcurrency: 4, ratePerMinute: 60, burst: 10, costClass: "low", maxCost: 10
  },
  cacheClass: "actor"
};
const table = {
  fields: ["title", "status"],
  rows: [{ key: "task-1", values: { title: { kind: "text", value: "Call customer" }, status: { kind: "status", value: "open" } } }],
  page: { number: 1, pageSize: 20, hasNext: false }
} as const;
const actor = {
  authenticated: true,
  permissions: new Set(["sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read"])
};
const textDefinition = createStaticTextBlockDefinition();
const tableDefinition = createWorkspaceTaskTableBlockDefinition();
const bridges: readonly PuckBlockBridge[] = [{
  definition: textDefinition,
  label: "Text",
  fields: [{ prop: "text", label: "Text", kind: "text" }],
  allowChildren: true,
  defaultProps: { text: "New text" }
}, {
  definition: tableDefinition,
  label: "Task table",
  fields: [{ prop: "title", label: "Title", kind: "text" }],
  allowChildren: false,
  defaultProps: { title: "Open tasks" }
}];
const uiDocument = {
  id: "workspace.browser-proof",
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: { main: [{
    id: "tasks",
    type: "sales.workspace-task-table",
    version: 1,
    props: { title: "Open tasks" },
    bindings: { source: {
      source: { id: source.id, version: source.version },
      input: {},
      structuralCompatibilityHash: source.structuralCompatibilityHash,
      selectedFields: ["title", "status"]
    } }
  }, {
    id: "group",
    type: "content.text",
    version: 1,
    props: { text: "Group" },
    children: [
      { id: "first", type: "content.text", version: 1, props: { text: "First" } },
      { id: "second", type: "content.text", version: 1, props: { text: "Second" } }
    ]
  }] }
} as const;
const sourceResults = { tasks: { state: "success" as const, data: table } };
const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [textDefinition, tableDefinition], sources: [source] }));
const productionResult = runtime.render({ document: uiDocument, surface: "workspace", actor, sourceResults });
const adapter = createPuckBuilderAdapter({
  blocks: bridges,
  preview: { surface: "workspace", actor, sources: [source], sourceResults }
});

declare global {
  interface Window { __kNexDocument: any }
}
window.__kNexDocument = uiDocument;
const root = document.getElementById("root");
const production = document.getElementById("production");
if (root === null || production === null) throw new Error("Browser fixture roots are missing.");
createRoot(production).render(presentUiRuntimeResult(productionResult));
createRoot(root).render(PuckEditorHost({ adapter, document: uiDocument, onChange: (next) => { window.__kNexDocument = next; } }));
