import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { deserializeBrowserViewState, type BrowserDataTransport } from "@k-nex/ui-runtime";
import { salesOpportunityStageMutation, salesTasksQuery, salesUpdateTaskMutation } from "../../../modules/sales/src/browser.js";
import { salesTasksDescriptor } from "../../../modules/sales/src/contracts.js";
import {
  DataGrid,
  DataTable,
  createDataTableController,
  createDataTableState,
  defineDataTable
} from "../src/index.js";

const definition = defineDataTable({
  id: "sales.tasks-table",
  descriptor: salesTasksDescriptor,
  query: salesTasksQuery,
  columns: [
    { id: "title", label: "Title", size: 240 },
    { id: "status", label: "Status" },
    { id: "potential-revenue", label: "Potential revenue" }
  ],
  paginationModes: ["offset", "cursor"],
  defaultPageSize: 25,
  searchField: "title",
  facets: { status: ["open", "done"] },
  rowActions: [
    { id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, capability: { state: "allowed", action: salesUpdateTaskMutation.action }, mutation: salesUpdateTaskMutation, input: (rowKey: string) => ({ id: rowKey, status: "done" }), label: "Complete" },
    { id: salesOpportunityStageMutation.action.id, action: salesOpportunityStageMutation.action, capability: { state: "denied", action: salesOpportunityStageMutation.action }, mutation: salesOpportunityStageMutation, input: (rowKey: string) => ({ id: rowKey, stage: "won" }), label: "Secret" }
  ],
  bulkActions: [{ id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, capability: { state: "allowed", action: salesUpdateTaskMutation.action }, mutation: salesUpdateTaskMutation, input: (rowKey: string) => ({ id: rowKey, status: "done" }), label: "Complete" }]
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
    await expect(controller.execute(transport, {}, state, new Set(["title", "status", "potential-revenue"]), context)).resolves.toEqual({ state: "success", data: records });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ controls: controller.controls(state) }));
    const firstIdentity = await controller.identity({}, state, context);
    const secondIdentity = await controller.identity({}, { ...state, search: "different" }, context);
    expect(firstIdentity.key).not.toBe(secondIdentity.key);
    await expect(controller.execute(transport, {}, state, new Set(["title", "status"]), context)).resolves.toEqual({ state: "insufficient-permission" });
  });

  it("rejects undeclared operations and keeps URL state non-authoritative", () => {
    const controller = createDataTableController(definition);
    const state = { ...createDataTableState(definition), selectedRows: ["task-1"], detailRow: "task-1" };
    expect(() => controller.controls({ ...state, sort: [{ field: "potential-revenue", direction: "desc" }] })).toThrow(/not declared/);
    const serialized = controller.serializeView(state);
    expect(deserializeBrowserViewState(serialized)).not.toHaveProperty("selectedRows");
    expect(deserializeBrowserViewState(serialized)).not.toHaveProperty("detailRow");
    expect(controller.shouldRefetch("sales.tasks")).toBe(true);
    expect(controller.shouldRefetch("sales.opportunities")).toBe(false);
  });

  it("rejects capability results that do not identify the registered action", () => {
    const action = definition.rowActions?.[0];
    expect(action).toBeDefined();
    expect(() => defineDataTable({
      ...definition,
      rowActions: [{ ...action!, capability: { state: "allowed", action: { id: "sales.task.forged", version: 1 } } }]
    })).toThrow(/canonical registered mutation/);
  });

  it("executes only canonical allowed actions and reports partial bulk failures", async () => {
    const controller = createDataTableController(definition);
    const execute = vi.fn(async (_mutation: unknown, input: unknown) => {
      const id = (input as { id: string }).id;
      return id === "task-2" ? { state: "error" as const, problem: { code: "CONFLICT", status: 409 } } : { state: "success" as const, data: { id } };
    });
    const executor = { execute };
    const action = await controller.executeAction(executor, salesUpdateTaskMutation.action.id, "task-1", context);
    expect(action.result.state).toBe("success");
    expect(action.invalidatedSources).toEqual(["sales.tasks", "sales.total-potential-revenue"]);
    await expect(controller.executeAction(executor, salesOpportunityStageMutation.action.id, "task-1", context)).resolves.toMatchObject({ result: { state: "forbidden" } });
    await expect(controller.executeAction(executor, "sales.task.unknown", "task-1", context)).resolves.toMatchObject({ result: { state: "forbidden" } });
    const bulk = await controller.executeBulkAction(executor, salesUpdateTaskMutation.action.id, ["task-1", "task-2"], context);
    expect(bulk.state).toBe("partial");
    expect(bulk.succeededRowKeys).toEqual(["task-1"]);
    expect(bulk.failedRowKeys).toEqual(["task-2"]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("renders semantic table by default and an explicit keyboard grid", () => {
    const state = { ...createDataTableState(definition), selectedRows: ["task-1"] };
    const table = renderToStaticMarkup(<DataTable definition={definition} viewState={state} requestState={{ state: "success", data: records }} />);
    expect(table).toContain("<table");
    expect(table).not.toContain('role="grid"');
    expect(table).toContain("Call customer");
    expect(table).toContain("Complete");
    expect(table).toContain("Complete");
    expect(table).not.toContain("Secret");
    expect(table).toContain('data-k-nex-component="search-control"');
    expect(table).toContain('data-k-nex-component="facet-filter"');
    expect(table).toContain('data-k-nex-component="sort-control"');
    expect(table).toContain('data-k-nex-component="pagination-control"');
    const grid = renderToStaticMarkup(<DataGrid definition={definition} viewState={state} requestState={{ state: "success", data: records }} />);
    expect(grid).toContain('role="grid"');
    expect(grid).toContain('role="gridcell"');
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
