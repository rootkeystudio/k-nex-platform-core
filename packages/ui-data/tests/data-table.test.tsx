import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { deserializeBrowserViewState, type BrowserDataTransport } from "@k-nex/ui-runtime";
import { salesOpportunityStageMutation, salesTasksQuery, salesUpdateTaskMutation } from "../../../modules/sales/src/browser.js";
import { salesTasksDescriptor } from "../../../modules/sales/src/contracts.js";
import {
  DataGrid,
  DataTable,
  allowedDataTableActions,
  createDataTableController,
  createDataTableState,
  defineDataTable,
  resolveDataTableActionAuthorization,
  type DataTableActionAuthorization
} from "../src/index.js";

const definition = defineDataTable({
  id: "sales.tasks-table",
  descriptor: salesTasksDescriptor,
  query: salesTasksQuery,
  columns: [
    { id: "title", label: "Title", size: 240 },
    { id: "status", label: "Status" },
    { id: "potential-revenue", label: "Potential revenue" },
    { id: "private-note", label: "Private note" }
  ],
  paginationModes: ["offset", "cursor"],
  defaultPageSize: 25,
  searchField: "title",
  facets: { status: ["open", "done"] },
  rowActions: [
    { id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, mutation: salesUpdateTaskMutation, input: (rowKey: string) => ({ id: rowKey, status: "done" }), label: "Complete" },
    { id: salesOpportunityStageMutation.action.id, action: salesOpportunityStageMutation.action, mutation: salesOpportunityStageMutation, input: (rowKey: string) => ({ id: rowKey, stage: "won" }), label: "Secret" }
  ],
  bulkActions: [{ id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, mutation: salesUpdateTaskMutation, input: (rowKey: string) => ({ id: rowKey, status: "done" }), label: "Complete" }]
});

const actorFingerprint = `sha256:${"a".repeat(64)}`;
const catalogRevision = `sha256:${"b".repeat(64)}`;
const authorization = resolveDataTableActionAuthorization(definition, actorFingerprint, {
  resolve: (request) => ({ actorFingerprint: request.actorFingerprint, catalogRevision, capabilities: request.actions.map((action) => ({ state: action.id === salesUpdateTaskMutation.action.id ? "allowed" as const : "denied" as const, action })) })
});

const records = {
  fields: ["title", "status", "potential-revenue"],
  rows: [{ key: "task-1", values: {
    title: { kind: "text" as const, value: "Call customer" },
    status: { kind: "status" as const, value: "open" },
    "potential-revenue": { kind: "money" as const, value: "1200", currency: "USD", scale: 2 }
  } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

const context = {
  surface: "workspace" as const,
  authorizationBoundary: { kind: "actor" as const, actorFingerprint: `sha256:${"a".repeat(64)}` },
  signal: new AbortController().signal
};
const allTaskFields = new Set(["title", "status", "potential-revenue", "private-note"]);
const nonPrivateTaskFields = new Set(["title", "status", "potential-revenue"]);

describe("P7.6 standard DataTable/DataGrid", () => {
  it("turns Sales task state into bounded server-owned query controls", async () => {
    const controller = createDataTableController(definition);
    const state = {
      ...createDataTableState(definition),
      pagination: { mode: "cursor" as const, size: 25, after: "next-1" },
      search: "customer",
      filters: [{ field: "status", operator: "in" as const, value: ["open"] }],
      sort: [{ field: "title", direction: "asc" as const }]
    };
    expect(controller.controls(state)).toEqual({
      cursor: { size: 25, after: "next-1" },
      filters: [
        { field: "status", operator: "in", value: ["open"] },
        { field: "title", operator: "contains", value: "customer" }
      ],
      sort: [{ field: "title", direction: "asc" }]
    });
    const query = vi.fn(async () => ({ ok: true as const, data: records }));
    const transport: BrowserDataTransport = { query, mutate: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }) };
    await expect(controller.execute(transport, {}, state, allTaskFields, context)).resolves.toEqual({ state: "success", data: records });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ controls: controller.controls(state), selectedFields: ["title", "status", "potential-revenue", "private-note"] }));
    const firstIdentity = await controller.identity({}, state, allTaskFields, context);
    const secondIdentity = await controller.identity({}, { ...state, search: "different" }, allTaskFields, context);
    expect(firstIdentity.key).not.toBe(secondIdentity.key);
    const restrictedIdentity = await controller.identity({}, state, nonPrivateTaskFields, context);
    expect(firstIdentity.key).not.toBe(restrictedIdentity.key);
    await expect(controller.execute(transport, {}, state, nonPrivateTaskFields, context)).resolves.toEqual({ state: "success", data: records });
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ selectedFields: ["title", "status", "potential-revenue"] }));
    await expect(controller.execute(transport, {}, state, new Set(["title", "status"]), context)).resolves.toEqual({ state: "insufficient-permission" });
  });

  it("rejects undeclared operations and keeps URL state non-authoritative", () => {
    const controller = createDataTableController(definition);
    const state = { ...createDataTableState(definition), selectedRows: ["task-1"], detailRow: "task-1" };
    expect(() => controller.controls({ ...state, sort: [{ field: "potential-revenue", direction: "desc" }] })).toThrow(/not declared/);
    expect(() => controller.controls({ ...state, search: "customer", filters: Array.from({ length: definition.descriptor.limits.maxFilters }, () => ({ field: "status", operator: "eq" as const, value: "open" })) })).toThrow(/exceed source limits/);
    const serialized = controller.serializeView(state);
    expect(deserializeBrowserViewState(serialized)).not.toHaveProperty("selectedRows");
    expect(deserializeBrowserViewState(serialized)).not.toHaveProperty("detailRow");
    expect(controller.shouldRefetch("sales.tasks")).toBe(true);
    expect(controller.shouldRefetch("sales.opportunities")).toBe(false);
  });

  it("uses actor-bound authoritative catalog results and fails closed for forged receipts", () => {
    expect(allowedDataTableActions(definition.rowActions ?? [], authorization, actorFingerprint).map(({ id }) => id)).toEqual([salesUpdateTaskMutation.action.id]);
    expect(allowedDataTableActions(definition.rowActions ?? [], authorization, `sha256:${"c".repeat(64)}`)).toEqual([]);
    const forged = { actorFingerprint, catalogRevision, capabilities: [{ state: "allowed", action: salesOpportunityStageMutation.action }] } as DataTableActionAuthorization;
    expect(allowedDataTableActions(definition.rowActions ?? [], forged, actorFingerprint)).toEqual([]);
    expect(() => resolveDataTableActionAuthorization(definition, actorFingerprint, { resolve: (request) => ({ actorFingerprint: request.actorFingerprint, catalogRevision, capabilities: [
      { state: "allowed", action: request.actions[0]! }, { state: "allowed", action: request.actions[0]! }
    ] }) })).toThrow(/invalid/);
  });

  it("refreshes catalog authority before display, row execution, and bulk execution", async () => {
    let allowed = true;
    const resolver = vi.fn((request: { readonly actorFingerprint: string; readonly actions: readonly { readonly id: string; readonly version: number }[] }) => ({
      actorFingerprint: request.actorFingerprint,
      catalogRevision: `sha256:${(allowed ? "c" : "d").repeat(64)}`,
      capabilities: request.actions.map((action) => ({ state: allowed ? "allowed" as const : "denied" as const, action }))
    }));
    const revocable = resolveDataTableActionAuthorization(definition, actorFingerprint, { resolve: resolver });
    expect(allowedDataTableActions(definition.rowActions ?? [], revocable, actorFingerprint)).toHaveLength(2);
    allowed = false;
    expect(allowedDataTableActions(definition.rowActions ?? [], revocable, actorFingerprint)).toEqual([]);
    const controller = createDataTableController(definition);
    const executor = { execute: vi.fn(async () => ({ state: "success" as const, data: {} })) };
    await expect(controller.executeAction(executor, revocable, actorFingerprint, salesUpdateTaskMutation.action.id, "task-1", context)).resolves.toMatchObject({ result: { state: "forbidden" } });
    await expect(controller.executeBulkAction(executor, revocable, actorFingerprint, salesUpdateTaskMutation.action.id, ["task-1"], context)).resolves.toMatchObject({ state: "forbidden" });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(resolver).toHaveBeenCalledTimes(6);
  });

  it("executes only canonical allowed actions and reports partial bulk failures", async () => {
    const controller = createDataTableController(definition);
    const execute = vi.fn(async (_mutation: unknown, input: unknown) => {
      const id = (input as { id: string }).id;
      return id === "task-2" ? { state: "error" as const, problem: { code: "CONFLICT", status: 409 } } : { state: "success" as const, data: { id } };
    });
    const executor = { execute };
    const action = await controller.executeAction(executor, authorization, actorFingerprint, salesUpdateTaskMutation.action.id, "task-1", context);
    expect(action.result.state).toBe("success");
    expect(action.invalidatedSources).toEqual(["sales.tasks", "sales.total-potential-revenue"]);
    await expect(controller.executeAction(executor, authorization, actorFingerprint, salesOpportunityStageMutation.action.id, "task-1", context)).resolves.toMatchObject({ result: { state: "forbidden" } });
    await expect(controller.executeAction(executor, authorization, actorFingerprint, "sales.task.unknown", "task-1", context)).resolves.toMatchObject({ result: { state: "forbidden" } });
    const bulk = await controller.executeBulkAction(executor, authorization, actorFingerprint, salesUpdateTaskMutation.action.id, ["task-1", "task-2"], context);
    expect(bulk.state).toBe("partial");
    expect(bulk.succeededRowKeys).toEqual(["task-1"]);
    expect(bulk.failedRowKeys).toEqual(["task-2"]);
    expect(execute).toHaveBeenCalledTimes(3);
    const oversized = await controller.executeBulkAction(executor, authorization, actorFingerprint, salesUpdateTaskMutation.action.id, Array.from({ length: 101 }, (_, index) => `task-${index}`), context);
    expect(oversized).toMatchObject({ state: "failure", results: [] });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("accepts response cursor metadata and carries it into the next page query", async () => {
    const controller = createDataTableController(definition);
    const first = { ...createDataTableState(definition), pagination: { mode: "cursor" as const, size: 25 } };
    const query = vi.fn(async () => ({ ok: true as const, data: { ...records, page: { number: 1, pageSize: 25, hasNext: true, nextCursor: "opaque-next" } } }));
    const transport: BrowserDataTransport = { query, mutate: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }) };
    await expect(controller.execute(transport, {}, first, allTaskFields, context)).resolves.toMatchObject({ state: "success", data: { page: { nextCursor: "opaque-next" } } });
    const next = { ...first, pagination: { mode: "cursor" as const, size: 25, after: "opaque-next" } };
    await controller.execute(transport, {}, next, allTaskFields, context);
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ controls: { cursor: { size: 25, after: "opaque-next" }, filters: [], sort: [] } }));
    const missingToken: BrowserDataTransport = { query: async () => ({ ok: true, data: { ...records, page: { number: 1, pageSize: 25, hasNext: true } } }), mutate: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }) };
    await expect(controller.execute(missingToken, {}, first, allTaskFields, context)).resolves.toEqual({ state: "invalid-contract" });
  });

  it("renders semantic table by default and an explicit keyboard grid", () => {
    const state = { ...createDataTableState(definition), selectedRows: ["task-1"] };
    const table = renderToStaticMarkup(<DataTable definition={definition} actionAuthorization={authorization} actionActorFingerprint={actorFingerprint} viewState={state} requestState={{ state: "success", data: records }} />);
    expect(table).toContain("<table");
    expect(table).not.toContain('role="grid"');
    expect(table).toContain("Call customer");
    expect(table).toContain("Complete");
    expect(table).toContain("Complete");
    expect(table).not.toContain("Secret");
    expect(table).not.toContain(">Private note</th>");
    expect(table).toContain('data-k-nex-component="search-control"');
    expect(table).toContain('data-k-nex-component="facet-filter"');
    expect(table).toContain('data-k-nex-component="sort-control"');
    expect(table).toContain('data-k-nex-component="pagination-control"');
    const grid = renderToStaticMarkup(<DataGrid definition={definition} actionAuthorization={authorization} actionActorFingerprint={actorFingerprint} viewState={state} requestState={{ state: "success", data: records }} />);
    expect(grid).toContain('role="grid"');
    expect(grid).toContain('role="gridcell"');
    expect(grid.match(/role="gridcell" tabindex="0"/g)).toHaveLength(1);
    expect(grid.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("renders only fields returned by the authorized projection", () => {
    const table = renderToStaticMarkup(<DataTable definition={definition} viewState={createDataTableState(definition)} requestState={{ state: "success", data: records }} />);
    expect(table).not.toContain(">Private note</th>");
    const authorized = { ...records, fields: [...records.fields, "private-note"], rows: [{ ...records.rows[0]!, values: { ...records.rows[0]!.values, "private-note": { kind: "text" as const, value: "Customer requested a call." } } }] };
    expect(renderToStaticMarkup(<DataTable definition={definition} viewState={createDataTableState(definition)} requestState={{ state: "success", data: authorized }} />)).toContain(">Private note</th>");
  });

  it("removes hidden-field operations from UI and rejects them before transport", async () => {
    const hiddenDescriptor = {
      ...salesTasksDescriptor,
      outputFields: salesTasksDescriptor.outputFields?.map((field) => field.id === "private-note"
        ? { ...field, sortable: true, filterOperators: ["contains" as const] }
        : field)
    };
    const hiddenDefinition = defineDataTable({
      ...definition,
      descriptor: hiddenDescriptor,
      searchField: "private-note"
    });
    const hiddenState = {
      ...createDataTableState(hiddenDefinition),
      search: "secret",
      sort: [{ field: "private-note", direction: "asc" as const }]
    };
    const queryCall = vi.fn(async () => ({ ok: true as const, data: records }));
    const hiddenTransport: BrowserDataTransport = { query: queryCall, mutate: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }) };
    await expect(createDataTableController(hiddenDefinition).execute(hiddenTransport, {}, hiddenState, nonPrivateTaskFields, context))
      .resolves.toEqual({ state: "invalid-contract" });
    expect(queryCall).not.toHaveBeenCalled();
    const markup = renderToStaticMarkup(<DataTable definition={hiddenDefinition} viewState={hiddenState} requestState={{ state: "success", data: records }} />);
    expect(markup).not.toContain('data-k-nex-component="search-control"');
    expect(markup).not.toContain('<option value="private-note"');
  });

  it("reflects and updates array-backed facet state", () => {
    const state = { ...createDataTableState(definition), filters: [{ field: "status", operator: "in" as const, value: ["open"] }] };
    const table = renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "success", data: records }} />);
    expect(table).toContain('<option value="open" selected="">open</option>');
  });

  it("exposes loading, empty, forbidden, stale, and refetching states", () => {
    const state = createDataTableState(definition);
    expect(renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "loading" }} />)).toContain('data-state="loading"');
    expect(renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "empty" }} />)).toContain('data-state="empty"');
    expect(renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "forbidden", problem: { code: "DENIED", status: 403 } }} />)).toContain('data-state="forbidden"');
    expect(renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "stale", data: records }} />)).toContain('data-state="stale"');
    expect(renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "refetching", data: records }} />)).toContain('data-state="refetching"');
  });
});
