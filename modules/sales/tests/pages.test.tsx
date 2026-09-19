import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BrowserDataTransport } from "@k-nex/ui-runtime";
import { createDataTableState } from "@k-nex/ui-data/data-table-controller";
import {
  SalesAccountsPage,
  SalesContactsPage,
  SalesCrmActionForm,
  SalesCrmDetailPage,
  SalesFixedDetailRouteProvider,
  SalesLeadsPage,
  SalesTimeline,
  SalesOpportunitiesPage,
  SalesOpportunityEditForm,
  SalesOverviewPage,
  SalesSettingsPage,
  SalesStateHistory,
  SalesTasksPage,
  createSalesOpportunityStageController,
  createSalesTaskQuickCreateController,
  salesAccountsTableDefinition,
  salesContactsTableDefinition,
  salesDefaultPageContract,
  salesLeadsTableDefinition,
  salesOpportunitiesTableDefinition,
  salesTasksTableDefinition
} from "../src/pages.js";

const accountRecords = {
  fields: ["name", "owner-id", "status", "revision"],
  rows: [{ key: "1", values: { name: { kind: "text" as const, value: "Acme" }, "owner-id": { kind: "text" as const, value: "owner-1" }, status: { kind: "status" as const, value: "active" }, revision: { kind: "integer" as const, value: 2 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const contactRecords = {
  fields: ["display-name", "owner-id", "account-id", "status", "revision"],
  rows: [{ key: "2", values: { "display-name": { kind: "text" as const, value: "Ada" }, "owner-id": { kind: "text" as const, value: "owner-1" }, "account-id": { kind: "integer" as const, value: 1 }, status: { kind: "status" as const, value: "active" }, revision: { kind: "integer" as const, value: 3 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const leadRecords = {
  fields: ["display-name", "owner-id", "status", "archive-status", "revision"],
  rows: [{ key: "3", values: { "display-name": { kind: "text" as const, value: "Grace" }, "owner-id": { kind: "text" as const, value: "owner-1" }, status: { kind: "status" as const, value: "working" }, "archive-status": { kind: "status" as const, value: "active" }, revision: { kind: "integer" as const, value: 2 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

const taskRecords = {
  fields: ["title", "status"],
  rows: [{ key: "task-1", values: { title: { kind: "text" as const, value: "Call customer" }, status: { kind: "status" as const, value: "open" } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};
const opportunityRecords = {
  fields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision", "amount"],
  rows: [{ key: "4", values: { name: { kind: "text" as const, value: "Platform rollout" }, "pipeline-id": { kind: "integer" as const, value: 17 }, "pipeline-revision": { kind: "integer" as const, value: 4 }, "stage-id": { kind: "status" as const, value: "76ad7b41-5584-5d62-ab10-2575df5a8d47" }, "stage-name": { kind: "text" as const, value: "Discovery" }, "stage-semantic": { kind: "enum" as const, value: "discovery" }, "stage-revision": { kind: "integer" as const, value: 3 }, revision: { kind: "integer" as const, value: 7 }, amount: { kind: "money" as const, value: "1200", currency: "USD", scale: 2 } } }],
  page: { number: 1, pageSize: 25, hasNext: false }
};

describe("P7.7 Sales default pages", () => {
  it("renders registered overview, tasks, opportunities, and settings templates with K-Nex components", () => {
    const overview = renderToStaticMarkup(<SalesOverviewPage />);
    const createTask = createSalesTaskQuickCreateController({ query: vi.fn(), mutate: vi.fn() } as unknown as BrowserDataTransport, "task-page").initial();
    const tasks = renderToStaticMarkup(<SalesTasksPage requestState={{ state: "success", data: taskRecords }} createTask={createTask} onCreateTaskChange={() => undefined} onCreateTask={() => undefined} />);
    const opportunities = renderToStaticMarkup(<SalesOpportunitiesPage requestState={{ state: "success", data: opportunityRecords }} />);
    const settings = renderToStaticMarkup(<SalesSettingsPage settings={{ defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks" }} />);
    expect(overview).toContain('data-page-template-id="sales.page.overview"');
    expect(overview).toContain("Current pipeline summary.");
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

  it("renders keyboard-first CRM lists and projection-only fixed detail", () => {
    const accounts = renderToStaticMarkup(<SalesAccountsPage requestState={{ state: "success", data: accountRecords }} viewState={{ ...createDataTableState(salesAccountsTableDefinition), detailRow: "1" }} />);
    const contacts = renderToStaticMarkup(<SalesContactsPage requestState={{ state: "success", data: contactRecords }} viewState={{ ...createDataTableState(salesContactsTableDefinition), detailRow: "2" }} />);
    const leads = renderToStaticMarkup(<SalesLeadsPage requestState={{ state: "success", data: leadRecords }} viewState={{ ...createDataTableState(salesLeadsTableDefinition), detailRow: "3" }} />);
    const opportunities = renderToStaticMarkup(<SalesOpportunitiesPage requestState={{ state: "success", data: opportunityRecords }} viewState={{ ...createDataTableState(salesOpportunitiesTableDefinition), detailRow: "4" }} />);
    const detail = renderToStaticMarkup(<SalesCrmDetailPage kind="contact" recordId="contact-1" requestState={{ state: "success", data: contactRecords }} ownership={<span>Owner Ada</span>} timeline={<ol><li>Called customer</li></ol>} actions={<button type="button">Archive contact</button>} />);

    expect(accounts).toContain('data-page-template-id="sales.page.accounts"');
    expect(accounts).toContain('role="grid"');
    expect(accounts).toContain('tabindex="0"');
    expect(accounts).toContain('href="/sales/accounts/1"');
    expect(contacts).toContain("Ada");
    expect(contacts).toContain('href="/sales/contacts/2"');
    expect(leads).toContain('href="/sales/leads/3"');
    expect(opportunities).toContain('href="/sales/opportunities/4"');
    for (const markup of [accounts, contacts, leads, opportunities]) {
      expect(markup).toContain('type="button" tabindex="-1"');
      expect(markup).toContain("Open detail</a>");
    }
    expect(detail).toContain('data-page-template-id="sales.page.contact-detail"');
    expect(detail).toContain('aria-label="Ownership"');
    expect(detail).toContain('aria-label="Timeline"');
    expect(detail).toContain("Archive contact");
    expect(detail).not.toContain("email");
    expect(detail).not.toContain("phone");
    const invalid = renderToStaticMarkup(<SalesAccountsPage requestState={{ state: "success", data: { ...accountRecords, rows: [{ ...accountRecords.rows[0]!, key: "01" }] } }} />);
    expect(invalid).not.toContain("/sales/accounts/01");
  });

  it("lets the generated fixed-route host own the only page heading without dropping detail content", () => {
    const markup = renderToStaticMarkup(<><h1>Contact detail</h1><SalesFixedDetailRouteProvider hostOwnsRouteChrome><SalesCrmDetailPage kind="contact" recordId="2" requestState={{ state: "success", data: contactRecords }} /></SalesFixedDetailRouteProvider></>);
    expect(markup.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(markup).toContain("Contact detail");
    expect(markup).toContain("Ada");
    expect(markup).toContain('aria-label="Summary"');
  });

  it("renders explicit denied, stale, empty, and error detail states", () => {
    const denied = renderToStaticMarkup(<SalesCrmDetailPage kind="account" recordId="account-1" requestState={{ state: "insufficient-permission" }} />);
    const stale = renderToStaticMarkup(<SalesCrmDetailPage kind="account" recordId="account-1" requestState={{ state: "stale", data: accountRecords }} onRetry={() => undefined} />);
    const empty = renderToStaticMarkup(<SalesCrmDetailPage kind="account" recordId="account-1" requestState={{ state: "empty" }} />);
    const error = renderToStaticMarkup(<SalesCrmDetailPage kind="account" recordId="account-1" requestState={{ state: "error", problem: { code: "SAFE_ERROR", status: 500 } }} />);

    expect(denied).toContain('data-state="insufficient-permission"');
    expect(denied).toContain('role="alert"');
    expect(stale).toContain('data-state="stale"');
    expect(stale).toContain('type="button"');
    expect(empty).toContain('data-state="empty"');
    expect(error).toContain('role="alert"');
    expect(error).not.toContain("SAFE_ERROR");
  });

  it("links qualified Lead lineage only with destination read authority", () => {
    const data = { fields: ["display-name", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"], rows: [{ key: "3", values: {
      "display-name": { kind: "text" as const, value: "Qualified lead" },
      "qualified-account-id": { kind: "integer" as const, value: 7 },
      "qualified-contact-id": { kind: "integer" as const, value: 8 },
      "qualified-opportunity-id": { kind: "integer" as const, value: 9 }
    } }], page: { number: 1, pageSize: 1, hasNext: false } };
    const authorized = renderToStaticMarkup(<SalesCrmDetailPage kind="lead" recordId="3" requestState={{ state: "success", data }} permissions={["sales.accounts.read", "sales.contacts.read", "sales.opportunities.read"]} />);
    expect(authorized).toContain('href="/sales/accounts/7"');
    expect(authorized).toContain('aria-label="View qualified contact"');
    expect(authorized).toContain('href="/sales/opportunities/9"');
    const leadOnly = renderToStaticMarkup(<SalesCrmDetailPage kind="lead" recordId="3" requestState={{ state: "success", data }} permissions={["sales.leads.read"]} />);
    expect(leadOnly).toContain("qualified account id");
    expect(leadOnly).not.toContain('href="/sales/accounts/7"');
    expect(leadOnly).not.toContain('href="/sales/contacts/8"');
    expect(leadOnly).not.toContain('href="/sales/opportunities/9"');
  });

  it("bounds and labels authorized state history without exposing protected audit fields", () => {
    const entries = Array.from({ length: 27 }, (_, index) => ({
      actionId: index === 26 ? "sales.opportunity.archive" : "sales.opportunity.stage.update",
      stateField: index === 26 ? "archiveStatus" as const : "stageId" as const,
      fromState: index === 26 ? "active" : `stage-${index}`,
      toState: index === 26 ? "archived" : `stage-${index + 1}`,
      revision: index + 1,
      occurredAt: `2026-09-06T00:00:${String(index).padStart(2, "0")}.000Z`
    }));
    const markup = renderToStaticMarkup(<SalesStateHistory entries={entries} />);
    expect(markup.match(/data-slot="item"/g)).toHaveLength(25);
    expect(markup.indexOf("Archive status: active to archived")).toBeLessThan(markup.indexOf("Stage: stage-25 to stage-26"));
    expect(markup).not.toContain("stage-0 to stage-1");
    expect(markup).not.toContain("actorId");
    expect(markup).not.toContain("idempotencyKey");
    expect(markup).not.toContain("facts");
  });

  it("renders labelled action fields, safe failure, and live confirmation", () => {
    const markup = renderToStaticMarkup(<SalesCrmActionForm label="Edit account" fields={[{ name: "name", label: "Name", value: "Acme", required: true }]} submitLabel="Save account" confirmation="Account saved." formError="STALE_RECORD" onChange={() => undefined} onSubmit={() => undefined} />);
    expect(markup).toContain('aria-label="Edit account"');
    expect(markup).toContain('name="name"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("STALE_RECORD");
  });

  it("renders authorized timeline fields and omits absent note body", () => {
    const base = {
      fields: ["kind", "subject", "status", "occurred-at", "revision"],
      rows: [{ key: "timeline-1", values: { kind: { kind: "text" as const, value: "note" }, subject: { kind: "text" as const, value: "Customer note" }, status: { kind: "status" as const, value: "recorded" }, "occurred-at": { kind: "text" as const, value: "2026-09-06T00:00:00.000Z" }, revision: { kind: "integer" as const, value: 1 } } }],
      page: { number: 1, pageSize: 25, hasNext: false }
    };
    const hidden = renderToStaticMarkup(<SalesTimeline requestState={{ state: "success", data: base }} />);
    expect(hidden).toContain("Customer note");
    expect(hidden).not.toContain("private body");
    const visible = renderToStaticMarkup(<SalesTimeline requestState={{ state: "success", data: { ...base, fields: [...base.fields, "body"], rows: base.rows.map((row) => ({ ...row, values: { ...row.values, body: { kind: "text" as const, value: "Authorized body" } } })) } }} />);
    expect(visible).toContain("Authorized body");
    expect(visible).toContain('aria-label="Activity, notes, and attachments"');
    const nonNote = renderToStaticMarkup(<SalesTimeline requestState={{ state: "success", data: { fields: [...base.fields, "body"], rows: [{ key: "activity:1", values: { kind: { kind: "text" as const, value: "activity:call" }, subject: { kind: "text" as const, value: "Call customer" }, status: { kind: "status" as const, value: "scheduled" }, "occurred-at": { kind: "text" as const, value: "2026-09-06T00:00:00.000Z" }, revision: { kind: "integer" as const, value: 1 }, body: null } }], page: { number: 1, pageSize: 25, hasNext: false } } }} />);
    expect(nonNote).not.toContain(" · null");
    expect(nonNote).not.toContain(" · —");
  });

  it("renders fixed-detail sections and targets child timeline actions by selected row", () => {
    const data = {
      fields: ["kind", "subject", "status", "occurred-at", "revision"],
      rows: [
        { key: "activity:41", values: { kind: { kind: "text" as const, value: "activity:call" }, subject: { kind: "text" as const, value: "Call Ada" }, status: { kind: "status" as const, value: "scheduled" }, "occurred-at": { kind: "text" as const, value: "2026-09-06T10:00:00.000Z" }, revision: { kind: "integer" as const, value: 3 } } },
        { key: "attachment:52", values: { kind: { kind: "text" as const, value: "attachment" }, subject: { kind: "text" as const, value: "proposal.pdf" }, status: { kind: "status" as const, value: "active" }, "occurred-at": { kind: "text" as const, value: "attached" }, revision: { kind: "integer" as const, value: 2 } } },
        { key: "task:63", values: { kind: { kind: "text" as const, value: "task" }, subject: { kind: "text" as const, value: "Follow up" }, status: { kind: "status" as const, value: "open" }, "occurred-at": { kind: "text" as const, value: "follow-up" }, revision: { kind: "integer" as const, value: 1 } } }
      ],
      page: { number: 1, pageSize: 25, hasNext: false }
    };
    const markup = renderToStaticMarkup(<SalesTimeline requestState={{ state: "success", data }} permissions={["sales.activities.read", "sales.activities.write", "sales.attachments.write", "sales.tasks.read"]} dispatchAction={async () => undefined} />);
    expect(markup).toContain('aria-label="Timeline"');
    expect(markup).toContain('aria-label="Tasks and reminders"');
    expect(markup).toContain('data-action-id="sales.activity.complete" data-record-id="41"');
    expect(markup).toContain('data-action-id="sales.activity.cancel" data-record-id="41"');
    expect(markup).toContain('data-action-id="sales.attachment.remove" data-record-id="52"');
    expect(markup).not.toContain('data-record-id="contact-1"');
    expect(markup).toContain('role="status" aria-live="polite"');
    const denied = renderToStaticMarkup(<SalesTimeline requestState={{ state: "success", data }} permissions={["sales.activities.read"]} dispatchAction={async () => undefined} />);
    expect(denied).not.toContain("Tasks and reminders");
    expect(denied).not.toContain("data-action-id");
  });

  it("submits page forms only through registered Sales actions", async () => {
    const actions: string[] = [];
    const transport: BrowserDataTransport = {
      query: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }),
      mutate: async (request) => { actions.push(request.action.id); return request.action.id === "sales.task.create" ? { ok: true, data: { id: "1", title: "Follow up", status: "open", revision: 1 } } : { ok: true, data: { id: "4", name: "Platform rollout", stage: "proposal", revision: 8 } }; }
    };
    const task = createSalesTaskQuickCreateController(transport, "create-1");
    await task.submit(task.change(task.initial(), "title", "Follow up"), new AbortController().signal);
    const opportunity = createSalesOpportunityStageController(transport, { id: "4", expectedRevision: 7, expectedPipelineId: "17", expectedPipelineRevision: 4, expectedSourceStageId: "76ad7b41-5584-5d62-ab10-2575df5a8d47", expectedSourceStageRevision: 3, destinationStageId: "a5299df1-1fd8-50dd-947a-4ed1ea145b2d", expectedDestinationStageRevision: 4 }, "stage-1");
    await opportunity.submit(opportunity.initial(), new AbortController().signal);
    expect(actions).toEqual(["sales.task.create", "sales.opportunity.stage.update"]);
  });

  it("renders the opportunity edit form with options from the registered async source", async () => {
    const transport: BrowserDataTransport = {
      async query(request) {
        expect(request.source.id).toBe("sales.opportunities");
        return { ok: true, data: opportunityRecords };
      },
      async mutate() { return { ok: false, problem: { code: "UNUSED", status: 500 } }; }
    };
    const source = await salesOpportunitiesTableDefinition.query.execute(transport, {}, {
      surface: "workspace",
      authorizationBoundary: { kind: "actor", actorFingerprint: `sha256:${"a".repeat(64)}` },
      signal: new AbortController().signal
    });
    expect(source).toMatchObject({ state: "success" });
    const record = source.state === "success" ? source.data.rows[0]! : undefined;
    const name = record?.values.name;
    const options = record === undefined || name?.kind !== "text" ? [] : [{ id: record.key, label: name.value }];
    const controller = createSalesOpportunityStageController(transport, { id: "4", expectedRevision: 7, expectedPipelineId: "17", expectedPipelineRevision: 4, expectedSourceStageId: "76ad7b41-5584-5d62-ab10-2575df5a8d47", expectedSourceStageRevision: 3, destinationStageId: "a5299df1-1fd8-50dd-947a-4ed1ea145b2d", expectedDestinationStageRevision: 4 }, "edit-1");
    const markup = renderToStaticMarkup(<SalesOpportunityEditForm opportunity={controller.initial()} opportunityOptions={options} onOpportunityChange={() => undefined} onOpportunitySubmit={() => undefined} />);

    expect(markup).toContain('aria-label="Edit opportunity"');
    expect(markup).toContain('<option value="4" selected="">Platform rollout</option>');
    expect(markup).toContain('name="destinationStageId"');
    expect(markup).toContain("Save opportunity");
  });
});
