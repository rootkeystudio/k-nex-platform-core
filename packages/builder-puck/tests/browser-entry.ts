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
import { createPuckBuilderProfileRegistry, type PuckBlockBridge } from "../src/index.js";
import { PuckFixedShellHost } from "../src/editor.js";

const source: DataSourceDescriptor = {
  id: "sales.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks.output", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  structuralCompatibilityHash: "sha256:c8367ee2c153671b70e606ec4445358ab2ebbf5561318cef1829fe4390487120",
  presentationMetadataRevision: 1,
  title: "Sales tasks",
  inputFields: [],
  outputFields: [
    { id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.title.read", sortable: true, filterOperators: ["eq", "contains"] },
    { id: "status", kind: "status", binding: "required", nullable: false, permission: "sales.tasks.status.read", sortable: true, filterOperators: ["eq", "in"] },
    { id: "potential-revenue", kind: "money", binding: "required", nullable: true, permission: "sales.tasks.revenue.read", sortable: false, filterOperators: [] },
    { id: "private-note", kind: "text", binding: "optional", nullable: true, permission: "sales.tasks.private-note.read", sortable: false, filterOperators: [] }
  ],
  limits: {
    maxSelectedFields: 8, maxPageSize: 100, maxFilters: 8, maxSorts: 2, maxBodyBytes: 32768, maxResultBytes: 1048576,
    maxDepth: 6, timeoutMs: 5000, maxConcurrency: 16, ratePerMinute: 300, burst: 30, costClass: "medium", maxCost: 100
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
  }, {
    id: "group-two",
    type: "content.text",
    version: 1,
    props: { text: "Group two" },
    children: [
      { id: "third", type: "content.text", version: 1, props: { text: "Third" } },
      { id: "fourth", type: "content.text", version: 1, props: { text: "Fourth" } }
    ]
  }] }
} as const;
const sourceResults = { tasks: { state: "success" as const, data: table } };
const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [textDefinition, tableDefinition], sources: [source] }));
const productionResult = runtime.render({ document: uiDocument, surface: "workspace", actor, sourceResults });
const profile = createPuckBuilderProfileRegistry({
  blocks: bridges,
  sources: [source],
  profiles: [{
    id: "workspace",
    blocks: bridges.map(({ definition }) => ({ id: definition.id, version: definition.version })),
    sources: [{ id: source.id, version: source.version }],
    actions: [],
    publication: "save-layout"
  }],
  preview: { workspace: { surface: "workspace", actor, sourceResults } }
}).resolve("workspace");
if (profile === undefined) throw new Error("Workspace builder profile is missing.");

declare global {
  interface Window { __kNexDocument: any }
}
window.__kNexDocument = uiDocument;
const root = document.getElementById("root");
const production = document.getElementById("production");
if (root === null || production === null) throw new Error("Browser fixture roots are missing.");
createRoot(production).render(presentUiRuntimeResult(productionResult));
createRoot(root).render(PuckFixedShellHost({
  profile,
  document: uiDocument,
  authentication: "Authenticated",
  router: "Router",
  sidebar: "Sidebar",
  topBar: "Top bar",
  systemScreens: "System screens",
  globalDialogs: "Global dialogs",
  onChange: (next) => { window.__kNexDocument = next; }
}));
