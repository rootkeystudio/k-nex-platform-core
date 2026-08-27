import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BrowserDataTransport } from "@k-nex/ui-runtime";
import {
  SalesOpportunitiesPage,
  SalesOverviewPage,
  SalesSettingsPage,
  SalesTasksPage,
  createSalesOpportunityStageController,
  createSalesTaskQuickCreateController,
  salesDefaultPageContract,
  salesOpportunitiesTableDefinition,
  salesTasksTableDefinition
} from "../src/pages.js";

const taskRecords = {
  fields: ["title", "status", "potential-revenue"],
  rows: [{ key: "task-1", values: { title: { kind: "text" as const, value: "Call customer" }, status: { kind: "status" as const, value: "open" }, "potential-revenue": { kind: "money" as const, value: "20", currency: "USD", scale: 2 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const opportunityRecords = {
  fields: ["name", "stage", "value"],
  rows: [{ key: "opp-1", values: { name: { kind: "text" as const, value: "Platform rollout" }, stage: { kind: "status" as const, value: "qualified" }, value: { kind: "money" as const, value: "1200", currency: "USD", scale: 2 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

describe("P7.7 Sales default pages", () => {
  it("renders registered overview, tasks, opportunities, and settings templates with K-Nex components", () => {
    const overview = renderToStaticMarkup(<SalesOverviewPage revenueState={{ state: "success", data: { value: { kind: "money", value: "1220", currency: "USD", scale: 2 } } }} />);
    const createTask = createSalesTaskQuickCreateController({ query: vi.fn(), mutate: vi.fn() } as unknown as BrowserDataTransport, "task-page").initial();
    const tasks = renderToStaticMarkup(<SalesTasksPage requestState={{ state: "success", data: taskRecords }} createTask={createTask} onCreateTaskChange={() => undefined} onCreateTask={() => undefined} />);
    const opportunities = renderToStaticMarkup(<SalesOpportunitiesPage requestState={{ state: "success", data: opportunityRecords }} />);
    const settings = renderToStaticMarkup(<SalesSettingsPage settings={{ defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks", pipelineStages: ["lead", "won"] }} />);
    expect(overview).toContain('data-page-template-id="sales.page.overview"');
    expect(overview).toContain('data-k-nex-component="metric"');
    expect(tasks).toContain('data-page-template-id="sales.page.tasks"');
    expect(tasks).toContain('data-k-nex-component="data-table"');
    expect(tasks).toContain('aria-label="Create task"');
    expect(opportunities).toContain('data-page-template-id="sales.page.opportunities"');
    expect(opportunities).toContain("Platform rollout");
    expect(settings).toContain('data-page-template-id="sales.page.settings"');
    expect(settings).toContain("Task page size");
    expect(salesDefaultPageContract.templates).toHaveLength(4);
    expect(salesTasksTableDefinition.query.source.id).toBe("sales.tasks");
    expect(salesOpportunitiesTableDefinition.query.source.id).toBe("sales.opportunities");
  });

  it("submits page forms only through registered Sales actions", async () => {
    const actions: string[] = [];
    const transport: BrowserDataTransport = {
      query: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }),
      mutate: async (request) => { actions.push(request.action.id); return request.action.id === "sales.task.create" ? { ok: true, data: { id: "task-1", title: "Follow up", status: "open" } } : { ok: true, data: { id: "opp-1", name: "Platform rollout", stage: "won" } }; }
    };
    const task = createSalesTaskQuickCreateController(transport, "create-1");
    await task.submit(task.change(task.initial(), "title", "Follow up"), new AbortController().signal);
    const opportunity = createSalesOpportunityStageController(transport, { id: "opp-1", stage: "qualified" }, "stage-1");
    await opportunity.submit(opportunity.change(opportunity.initial(), "stage", "won"), new AbortController().signal);
    expect(actions).toEqual(["sales.task.create", "sales.opportunity.stage.update"]);
  });
});
