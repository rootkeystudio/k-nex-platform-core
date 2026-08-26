import { describe, expect, it } from "vitest";

import { salesTasksDescriptor } from "../../../modules/sales/src/server.js";
import {
  createStaticTextBlockDefinition,
  createUiDocumentRuntime,
  createUiRuntimeRegistry,
  createWorkspaceTaskTableBlockDefinition
} from "../src/index.js";

const authenticatedActor = {
  authenticated: true,
  permissions: new Set(["sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read"])
};
const table = {
  fields: ["title", "status", "potential-revenue"],
  rows: [{
    key: "task-1",
    values: {
      title: { kind: "text", value: "Call customer" },
      status: { kind: "status", value: "open" }
    }
  }],
  page: { number: 1, pageSize: 20, hasNext: false }
};
const workspaceDocument = {
  id: "workspace.sales",
  version: 1,
  schemaVersion: 1,
  profile: "workspace",
  regions: {
    main: [{
      id: "tasks-1",
      type: "sales.workspace-task-table",
      version: 1,
      props: { title: "Open tasks" },
      bindings: { source: {
        source: { id: "sales.tasks", version: 1 },
        input: {},
        structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
        selectedFields: ["title", "status", "potential-revenue"]
      } }
    }]
  }
};

describe("P4.5 proof blocks", () => {
  it("renders one shared static block on the public CMS surface", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createStaticTextBlockDefinition()], sources: [] }));
    const result = runtime.render({
      document: { id: "cms.home", version: 1, schemaVersion: 1, profile: "cms", regions: { main: [{ id: "text-1", type: "content.text", version: 1, props: { text: "Hello" } }] } },
      surface: "public",
      actor: { authenticated: false, permissions: new Set() }
    });
    expect(result).toMatchObject({ success: true, regions: { main: [{ status: "rendered", output: { kind: "text", text: "Hello" } }] } });
  });

  it("renders the authenticated workspace table from the Phase 2 sales.tasks projection", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({
      blocks: [createWorkspaceTaskTableBlockDefinition()],
      sources: [salesTasksDescriptor]
    }));
    const result = runtime.render({
      document: workspaceDocument,
      surface: "workspace",
      actor: authenticatedActor,
      sourceResults: { "tasks-1": { state: "success", data: table } }
    });
    expect(result).toMatchObject({ success: true, regions: { main: [{ status: "rendered", output: { kind: "data-table", title: "Open tasks", state: "success", table } }] } });
  });

  it("fails closed when authenticated source output violates table.records@1", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createWorkspaceTaskTableBlockDefinition()], sources: [salesTasksDescriptor] }));
    const result = runtime.render({ document: workspaceDocument, surface: "workspace", actor: authenticatedActor, sourceResults: { "tasks-1": { state: "success", data: { rows: [] } } } });
    expect(result).toMatchObject({ success: true, regions: { main: [{ status: "fallback", reason: "SOURCE_RESULT_INVALID" }] } });
  });

  it("rejects undeclared or unauthorized fields reintroduced by a source result", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createWorkspaceTaskTableBlockDefinition()], sources: [salesTasksDescriptor] }));
    const leaked = {
      ...table,
      fields: ["title", "status", "private-note"],
      rows: [{
        ...table.rows[0],
        values: { ...table.rows[0].values, "private-note": { kind: "text", value: "sensitive" } }
      }]
    };
    const result = runtime.render({ document: workspaceDocument, surface: "workspace", actor: authenticatedActor, sourceResults: { "tasks-1": { state: "success", data: leaked } } });
    expect(result).toMatchObject({ success: true, regions: { main: [{ status: "fallback", reason: "SOURCE_RESULT_INVALID" }] } });
  });

  it("accepts omitted nullable cells and drops a denied optional selection exactly like the Phase 2 gateway", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createWorkspaceTaskTableBlockDefinition()], sources: [salesTasksDescriptor] }));
    const withDeniedOptional = {
      ...workspaceDocument,
      regions: { main: [{
        ...workspaceDocument.regions.main[0],
        bindings: { source: { ...workspaceDocument.regions.main[0].bindings.source, selectedFields: ["title", "status", "potential-revenue", "private-note"] } }
      }] }
    };
    const result = runtime.render({ document: withDeniedOptional, surface: "workspace", actor: authenticatedActor, sourceResults: { "tasks-1": { state: "success", data: table } } });
    expect(result).toMatchObject({ success: true, regions: { main: [{ status: "rendered" }] } });
  });

  it("accepts gateway-valid field reordering and omitted applicable cells", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createWorkspaceTaskTableBlockDefinition()], sources: [salesTasksDescriptor] }));
    const reordered = {
      ...workspaceDocument,
      regions: { main: [{
        ...workspaceDocument.regions.main[0],
        bindings: { source: { ...workspaceDocument.regions.main[0].bindings.source, selectedFields: ["status", "title", "potential-revenue"] } }
      }] }
    };
    const sparse = { ...table, rows: [{ key: "task-1", values: {} }] };
    const result = runtime.render({ document: reordered, surface: "workspace", actor: authenticatedActor, sourceResults: { "tasks-1": { state: "success", data: sparse } } });
    expect(result).toMatchObject({ success: true, regions: { main: [{ status: "rendered" }] } });
  });

  it("does not turn the workspace source into publishable authority during authenticated CMS preview", () => {
    const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [createWorkspaceTaskTableBlockDefinition()], sources: [salesTasksDescriptor] }));
    const cmsDocument = { ...workspaceDocument, id: "cms.sales", profile: "cms" };
    const preview = runtime.render({ document: cmsDocument, surface: "cms", actor: authenticatedActor, sourceResults: { "tasks-1": { state: "success", data: table } } });
    const published = runtime.render({ document: cmsDocument, surface: "public", actor: { authenticated: false, permissions: new Set() }, sourceResults: { "tasks-1": { state: "success", data: table } } });
    expect(preview).toMatchObject({ success: true, regions: { main: [{ status: "fallback", reason: "PROFILE_DENIED" }] } });
    expect(published).toMatchObject({ success: true, regions: { main: [{ status: "fallback", reason: "PROFILE_DENIED" }] } });
  });
});
