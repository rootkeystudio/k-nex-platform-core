import { describe, expect, it } from "vitest";
import ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { applicationAuthFiles } from "../src/application-auth-files.js";
import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";
import { canonicalSalesSavedViewJson } from "../../../modules/sales/src/contracts.js";

describe("generated P13.4 Saved View runtime closure", () => {
  it("packs the UI runtime public preparation API for generated application builds", () => {
    const barrel = readFileSync(new URL("../../ui-runtime/src/index.ts", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../../ui-runtime/src/document-runtime.ts", import.meta.url), "utf8");
    const fixture = readFileSync(new URL("../../../fixtures/customer-gate-1/tests/p13-3-generated-crm-fixture.mjs", import.meta.url), "utf8");
    expect(barrel).toContain('export * from "./document-runtime.js"');
    expect(runtime).toContain("export function prepareUiRuntimeDocument");
    expect(fixture).toContain('["@k-nex/ui-runtime", "packages/ui-runtime"]');
  });

  it("executes emitted request-local selection and rebinding without mutating the persisted document", () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const executableSource = sales.slice(sales.indexOf("const savedViewExecutionSources"), sales.indexOf("type SavedViewQueryClient"));
    const executable = ts.transpileModule(`${executableSource.replaceAll("export ", "")}\nreturn { admittedWorkspaceSalesDocument, prepareWorkspaceSalesDocument, savedViewAuthorityMatrix };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const emitted = new Function("kNexIdentity", executable)({ applicationId: "app", environment: "production" }) as { admittedWorkspaceSalesDocument(document: unknown): any; prepareWorkspaceSalesDocument(document: unknown, input?: unknown, mode?: "table" | "kanban"): any; savedViewAuthorityMatrix: any };
    const persisted = { id: "sales.page.saved-views", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [
      { id: "list", type: "sales.saved-views", version: 1, props: {}, bindings: { source: { source: { id: "sales.saved-view.list", version: 1 }, input: {}, structuralCompatibilityHash: "hash", selectedFields: ["id"] } } },
      { id: "detail", type: "sales.saved-views", version: 1, props: {}, bindings: { source: { source: { id: "sales.saved-view.detail", version: 1 }, input: {}, structuralCompatibilityHash: "hash", selectedFields: ["id"] }, action: { id: "sales.saved-view.update", version: 2 } } },
      { id: "table", type: "sales.saved-view-table", version: 1, props: { savedViewId: 7, expectedRevision: 3 }, bindings: { source: { source: { id: "sales.saved-view.table", version: 1 }, input: {}, structuralCompatibilityHash: "hash", selectedFields: ["name"] } } },
      { id: "archive", type: "sales.saved-views", version: 1, props: {}, bindings: { action: { id: "sales.saved-view.archive", version: 1 } } },
      { id: "pipeline", type: "sales.pipeline-settings", version: 1, props: {} }
    ] } };
    const before = JSON.stringify(persisted);
    expect(emitted.admittedWorkspaceSalesDocument(persisted).regions.main[2].props).toEqual({});
    const selected = emitted.prepareWorkspaceSalesDocument(persisted, { "saved-view-id": 9, "expected-revision": 4 });
    expect(JSON.stringify(persisted)).toBe(before);
    expect(selected.regions.main.find((node: any) => node.id === "detail").bindings.source.input).toEqual({ "saved-view-id": 9 });
    expect(selected.regions.main.find((node: any) => node.id === "table").bindings.source.input).toEqual({ "saved-view-id": 9, "expected-revision": 4 });
    expect(selected.regions.main.find((node: any) => node.id === "detail").bindings.action).toEqual({ id: "sales.saved-view.update", version: 2 });
    expect(selected.regions.main.find((node: any) => node.id === "archive").bindings.action).toEqual({ id: "sales.saved-view.archive", version: 1 });
    expect(selected.regions.main.find((node: any) => node.id === "pipeline").pipelineIdentity).toEqual({ applicationId: "app", environment: "production" });
    expect((persisted.regions.main[4] as any).pipelineIdentity).toBeUndefined();
    expect(emitted.prepareWorkspaceSalesDocument(persisted).regions.main.some((node: any) => node.id === "detail")).toBe(false);
    expect(emitted.savedViewAuthorityMatrix["table:sales.object.opportunity"].fields.amount).toEqual({ permission: "sales.opportunities.amount.read", operations: ["select"] });
    expect(emitted.savedViewAuthorityMatrix["kanban:sales.object.opportunity"].fields["stage-id"].operations).toEqual(["select", "filter", "sort", "group"]);
    expect(emitted.savedViewAuthorityMatrix["calendar:sales.object.activity"].fields["scheduled-at"].operations).toEqual(["select", "filter", "sort", "calendar"]);
  });

  it("executes emitted native selection admission with canonical omission and exact pairs", () => {
    const server = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-sales-routes.ts"]!;
    const body = server.slice(server.indexOf("function positiveRouteInteger"), server.indexOf("function routePage"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn { salesRouteSelection, salesRouteSelectionFromSearchParams };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const emitted = new Function(executable)() as { salesRouteSelection(route: string, value: unknown): unknown; salesRouteSelectionFromSearchParams(route: string, value: unknown): unknown };
    expect(emitted.salesRouteSelection("sales.route.saved-views", {})).toEqual({});
    expect(emitted.salesRouteSelectionFromSearchParams("sales.route.saved-views", { "saved-view-id": "9", "expected-revision": "4" })).toEqual({ "saved-view-id": 9, "expected-revision": 4 });
    expect(emitted.salesRouteSelectionFromSearchParams("sales.route.opportunities", { mode: "table" })).toEqual({});
    expect(emitted.salesRouteSelectionFromSearchParams("sales.route.opportunities", { mode: "kanban", "saved-view-id": "9", "expected-revision": "4" })).toEqual({ mode: "kanban", "saved-view-id": 9, "expected-revision": 4 });
    expect(() => emitted.salesRouteSelection("sales.route.opportunities", { mode: "table", "saved-view-id": 9, "expected-revision": 4 })).toThrow("Sales route selection is invalid");
    expect(() => emitted.salesRouteSelectionFromSearchParams("sales.route.saved-views", { "saved-view-id": ["9", "10"], "expected-revision": "4" })).toThrow("Sales route selection is invalid");
    expect(() => emitted.salesRouteSelection("sales.route.calendar", { "saved-view-id": 9 })).toThrow("Sales route selection is invalid");
  });

  it("executes emitted mutation successor, clear, and history selection helpers", () => {
    const client = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/app/components/k-nex-sales-route-runtime.tsx"]!;
    const body = client.slice(client.indexOf("function savedViewMutationPair"), client.indexOf("export function RegisteredSalesRouteRuntime"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn { salesLocationSelection, savedViewMutationSelection, salesSelectionHref };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const emitted = new Function("URLSearchParams", "isSalesRecordId", executable)(URLSearchParams, (value: unknown) => typeof value === "string" && /^(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-7])$/u.test(value)) as any;
    expect(emitted.salesLocationSelection("sales.route.opportunities", "?mode=table")).toEqual({});
    expect(emitted.salesLocationSelection("sales.route.opportunities", "?mode=kanban&saved-view-id=7&expected-revision=3")).toEqual({ mode: "kanban", "saved-view-id": 7, "expected-revision": 3 });
    expect(emitted.salesLocationSelection("sales.route.opportunities", "?mode=table&saved-view-id=7&expected-revision=3")).toBeUndefined();
    expect(emitted.savedViewMutationSelection({ "saved-view-id": 7, "expected-revision": 3 }, "sales.saved-view.update", { id: "7", revision: 4, status: "active" })).toEqual({ "saved-view-id": 7, "expected-revision": 4 });
    expect(emitted.savedViewMutationSelection({ "saved-view-id": 7, "expected-revision": 4 }, "sales.saved-view.archive", { id: "7", revision: 5, status: "archived" })).toEqual({});
    expect(emitted.savedViewMutationSelection({}, "sales.saved-view.create", { id: "8", revision: 1, status: "active" })).toEqual({ "saved-view-id": 8, "expected-revision": 1 });
    expect(emitted.savedViewMutationSelection({}, "sales.saved-view.create", { id: "8", revision: 1, status: "archived" })).toBeUndefined();
    expect(emitted.savedViewMutationSelection({}, "sales.saved-view.create", { id: 8, revision: 1, status: "active" })).toBeUndefined();
    expect(emitted.savedViewMutationSelection({}, "sales.saved-view.create", { id: "2147483648", revision: 1, status: "active" })).toBeUndefined();
    expect(emitted.savedViewMutationSelection({}, "sales.import.dry-run", { importJobId: 9, revision: 2, state: "validated" })).toEqual({ "import-job-id": 9, "expected-revision": 2 });
    expect(emitted.savedViewMutationSelection({}, "sales.export.create", { exportJobId: 10, revision: 1, state: "queued" })).toEqual({ "export-job-id": 10, "expected-revision": 1 });
    expect(emitted.salesSelectionHref("/sales/views", {})).toBe("/sales/views");
    expect(emitted.salesSelectionHref("/sales/views", { "saved-view-id": 8, "expected-revision": 1 })).toBe("/sales/views?saved-view-id=8&expected-revision=1");
  });

  it("selects the canonical first authorized management row and returns empty after archive", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const body = sales.slice(sales.indexOf("export async function resolveCanonicalSavedViewBinding"), sales.indexOf("/** Locks and compiles Saved Views"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn resolveCanonicalSavedViewBinding;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
    let rows: Record<string, unknown>[] = [{ id: 2, revision: 7 }]; let releases = 0;
    const client = { async query(text: string, values?: readonly unknown[]) { queries.push({ text, values }); return { rows }; }, release() { releases += 1; } };
    const resolve = new Function("actor", "kNexIdentity", "positiveSafeInteger", executable)(
      async () => ({ authorization: { effectiveActor: { id: "actor" }, salesScope: { authorizedTeamIds: ["team-b", "team-a"] } } }),
      { applicationId: "app", environment: "production" }, (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ) as (payload: unknown, context: unknown) => Promise<unknown>;
    const payload = { db: { pool: { connect: async () => client } } };
    await expect(resolve(payload, {})).resolves.toEqual({ "saved-view-id": 2, "expected-revision": 7 });
    expect(queries[0]?.text).toContain("(owner_id=$3 and visibility='personal')");
    expect(queries[0]?.text).toContain("visibility_team_id=any($4::text[])");
    expect(queries[0]?.text).toContain("order by case when owner_id=$3 and visibility='personal' then 0 else 1 end,id asc");
    rows = [];
    await expect(resolve(payload, {})).resolves.toEqual({});
    expect(releases).toBe(2);
  });

  it("locks the current mutation scope before admitting a Saved View destination", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const start = sales.indexOf("async function lockCurrentSalesMutationScope");
    const body = sales.slice(start, sales.indexOf("function salesActionCapability", start));
    const executable = ts.transpileModule(`${body}\nreturn lockCurrentSalesMutationScope;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const statements: unknown[] = [];
    const execute = async (statement: unknown) => { statements.push(statement); return { rows: [{ revision: 4 }] }; };
    const lock = new Function("activePayloadPostgresTransaction", "currentSalesAuthorityFence", "postgresRows", "sql", "kNexIdentity", executable)(
      async () => ({ execute }), async () => true, (value: { rows: unknown[] }) => value.rows,
      (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }), { applicationId: "app", environment: "production" }
    ) as (request: unknown, current: unknown) => Promise<boolean>;
    await expect(lock({}, { effectiveActor: { id: "actor" }, salesScope: { revision: 4 } })).resolves.toBe(true);
    expect(statements).toHaveLength(1);
    expect(JSON.stringify(statements[0])).toContain("mutation_allowed");
    expect(JSON.stringify(statements[0])).toContain("FOR SHARE");
  });

  it("executes emitted Saved View actions with string record IDs bound to numeric route selection", async () => {
    const server = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-sales-routes.ts"]!;
    const body = server.slice(server.indexOf("export async function executeRegisteredSalesRouteAction"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn executeRegisteredSalesRouteAction;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const calls: unknown[] = [];
    const execute = new Function("currentSalesAuthorityGeneration", "salesRouteSelection", "executeWorkspaceSalesAction", "registeredAction", executable)(
      async () => ({}),
      () => ({ savedView: { "saved-view-id": 7, "expected-revision": 3 } }),
      async (...args: unknown[]) => { calls.push(args); return { status: 200 }; },
      () => ({ id: "sales.saved-view.update", version: 2 })
    ) as (...args: any[]) => Promise<unknown>;
    const input = { id: "7", expectedRevision: 3, name: "Mine", visibility: "personal", definition: {} };
    await expect(execute({}, {}, "sales.route.saved-views", "detail", "sales.saved-view.update", input, { "saved-view-id": 7, "expected-revision": 3 }, "saved-view-update-1", new AbortController().signal)).resolves.toEqual({ status: 200 });
    expect(calls).toHaveLength(1);
    await expect(execute({}, {}, "sales.route.saved-views", "detail", "sales.saved-view.update", { ...input, id: 7 }, {}, "saved-view-update-2", new AbortController().signal)).rejects.toThrow("selection changed");
    await expect(execute({}, {}, "sales.route.saved-views", "detail", "sales.saved-view.archive", { id: "7", expectedRevision: 4 }, {}, "saved-view-archive-1", new AbortController().signal)).rejects.toThrow("selection changed");
  });

  it("retains a source-backed no-default Kanban node when mutation authority is absent", () => {
    const server = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-sales-routes.ts"]!;
    const body = server.slice(server.indexOf("function authorizedFixedDetailDocument"), server.indexOf("/** Fixed daily routes"));
    const executable = ts.transpileModule(`${body}\nreturn authorizedFixedDetailDocument;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const registry = { scopedRegistration: { contributions: { actions: [{ id: "sales.opportunity.stage.update", value: { descriptor: { id: "sales.opportunity.stage.update", version: 3, permission: "sales.opportunities.stage.update" } } }] } } };
    const authorize = new Function("kNexSalesRegistry", executable)(registry) as (document: any, routeId: string, permissions: string[]) => any;
    const persisted = { regions: { main: [{ id: "sales-opportunity-kanban", type: "sales.opportunity-kanban", version: 3, props: { title: "Opportunity pipeline" }, bindings: { source: { source: { id: "sales.saved-view.kanban", version: 1 }, input: {}, structuralCompatibilityHash: "hash", selectedFields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"] }, action: { id: "sales.opportunity.stage.update", version: 3 } } }] } };
    const result = authorize(persisted, "sales.route.opportunities", ["sales.opportunities.read"]);
    expect(result.regions.main).toHaveLength(1);
    expect(result.regions.main[0].bindings.source.source.id).toBe("sales.saved-view.kanban");
    expect(result.regions.main[0].bindings.action).toBeUndefined();
    expect(persisted.regions.main[0].bindings.action).toEqual({ id: "sales.opportunity.stage.update", version: 3 });
  });

  it("admits omitted-pair Kanban routing while preserving no persisted default as absence", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const persistedBody = sales.slice(sales.indexOf("function persistedSavedView"), sales.indexOf("function savedViewPersistence"));
    const persistedExecutable = ts.transpileModule(`${persistedBody}\nreturn persistedSavedView;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const persisted = new Function("positiveSafeInteger", persistedExecutable)((value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0) as (row: unknown) => unknown;
    expect(persisted(undefined)).toBeUndefined();
    expect(() => persisted({})).toThrow("Sales Saved View row is invalid");

    const route = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/app/api/k-nex/sales/routes/[routeId]/route.ts"]!;
    const routeBody = route.slice(route.indexOf("function pageNumber"));
    const routeExecutable = ts.transpileModule(`${routeBody.replaceAll("export ", "")}\nreturn GET;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const admitted: Array<{ routeId: string; pagination: unknown; selection: unknown }> = [];
    const get = new Function("bootKnexApplication", "getHeaders", "loadRegisteredSalesRoute", "kNexRequestContext", "salesRouteSelectionFromSearchParams", "Response", "URL", routeExecutable)(
      async () => ({}), async () => new Headers(), async (_payload: unknown, _context: unknown, routeId: string, _params: unknown, pagination: unknown, selection: unknown) => { admitted.push({ routeId, pagination, selection }); return { ok: true }; },
      () => ({}), (_routeId: string, value: unknown) => value, Response, URL
    ) as (request: Request, context: unknown) => Promise<Response>;
    const response = await get(new Request("https://example.test/api/k-nex/sales/routes/sales.route.opportunities?page=1&mode=kanban"), { params: Promise.resolve({ routeId: "sales.route.opportunities" }) });
    expect(response.status).toBe(200);
    expect(admitted[0]).toEqual({ routeId: "sales.route.opportunities", pagination: { listPage: 1 }, selection: { mode: "kanban" } });
    const pipelineResponse = await get(new Request("https://example.test/api/k-nex/sales/routes/sales.route.pipeline-settings?page=1"), { params: Promise.resolve({ routeId: "sales.route.pipeline-settings" }) });
    expect(pipelineResponse.status).toBe(200);
    expect(admitted[1]).toEqual({ routeId: "sales.route.pipeline-settings", pagination: { listPage: 1 }, selection: {} });
    const viewsResponse = await get(new Request("https://example.test/api/k-nex/sales/routes/sales.route.saved-views?page=1"), { params: Promise.resolve({ routeId: "sales.route.saved-views" }) });
    expect(viewsResponse.status).toBe(200);
    expect(admitted[2]).toEqual({ routeId: "sales.route.saved-views", pagination: { listPage: 1 }, selection: {} });

  });

  it("returns canonical empty Kanban data without dispatch when no authorized default exists", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const body = sales.slice(sales.indexOf("export async function loadWorkspaceSalesSources"), sales.indexOf("/** Owns the complete Saved View transaction"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn loadWorkspaceSalesSources;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const fields = ["row-kind", "name", "stage-id", "stage-metadata", "revision"];
    const document = { regions: { main: [{ id: "sales-opportunity-kanban", bindings: { source: { source: { id: "sales.saved-view.kanban", version: 1 }, input: {}, structuralCompatibilityHash: "kanban-hash", selectedFields: fields } } }] } };
    const plan = { gatewayInput: {}, selectedFields: fields, query: { filters: [], sort: [], page: { number: 1, size: 25 } }, empty: true };
    const states = new WeakMap<object, unknown>();
    let dispatched = 0;
    const client = { queries: [] as string[], async query(text: string) { this.queries.push(text); return { rows: [] }; }, release() {} };
    const current = { request: {}, authorization: { effectiveActor: { id: "actor" }, salesScope: { revision: 8 } } };
    states.set(document, { client, current, persistence: {}, plans: new Map([["sales-opportunity-kanban", plan]]) });
    const load = new Function("sourceNodes", "dataMovementSources", "salesRecordDetailSources", "savedViewExecutionStates", "actor", "sources", "workspaceSalesGateway", "canonicalJson", "readSalesScope", "recheckSalesSavedViewExecution", "DataSourceGatewayError", executable)(
      (value: any) => value.regions.main,
      new Set(["sales.import-job.list", "sales.import-job.detail", "sales.export-job.list", "sales.export-job.detail", "sales.dedupe.candidates"]),
      new Set(["sales.account.detail", "sales.contact.detail", "sales.lead.detail", "sales.opportunity.detail"]),
      states,
      async () => current,
      new Map([["sales.saved-view.kanban", { definition: { descriptor: { id: "sales.saved-view.kanban", version: 1, structuralCompatibilityHash: "kanban-hash", primaryContract: { id: "table.records" }, paginationModes: ["offset"], limits: { maxPageSize: 100 } } } }]]),
      () => ({ query: async () => { dispatched += 1; throw new Error("gateway must not dispatch"); } }),
      JSON.stringify,
      async () => ({ revision: 8 }),
      async () => undefined,
      Error
    ) as (...args: any[]) => Promise<any>;
    const output = await load({}, { correlationId: "correlation" }, document, ["sales.opportunities.read"], new AbortController().signal);
    expect(output["sales-opportunity-kanban"]).toEqual({ state: "success", data: { fields, rows: [], page: { number: 1, pageSize: 25, hasNext: false } } });
    expect(dispatched).toBe(0);
    expect(client.queries).toEqual(["commit"]);
  });

  it("executes emitted transaction ownership failures and destroys uncertain clients", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const body = sales.slice(sales.indexOf("export async function resolveWorkspaceSalesDocument"), sales.indexOf("async function abandonSavedViewExecution"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn resolveWorkspaceSalesDocument;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const make = (client: any, actor: () => Promise<unknown>) => new Function("sourceNodes", "savedViewExecutionSources", "actor", "savedViewPersistence", "resolveSalesSavedViewExecution", "kNexIdentity", "savedViewBindingInput", "savedViewExecutionStates", "canonicalJson", executable)(
      () => [{ id: "view", bindings: { source: { source: { id: "sales.saved-view.table" }, input: {}, selectedFields: [] } } }], new Set(["sales.saved-view.table"]), actor, () => ({}), async () => ({ gatewayInput: {}, selectedFields: [], query: {}, empty: true }), { applicationId: "app", environment: "production" }, () => ({}), new WeakMap(), JSON.stringify
    ) as (payload: unknown, context: unknown, document: unknown, permissions: unknown) => Promise<unknown>;
    const beginFailure = { query: async (text: string) => { if (text === "begin") throw new Error("begin failed"); return { rows: [] }; }, releases: [] as boolean[], release(destroy = false) { this.releases.push(destroy); } };
    await expect(make(beginFailure, async () => ({}))({ db: { pool: { connect: async () => beginFailure } } }, {}, {}, [])).rejects.toThrow("begin failed");
    expect(beginFailure.releases).toEqual([true]);
    const actorFailure = { query: async (text: string) => text === "rollback" ? Promise.reject(new Error("rollback failed")) : { rows: [] }, releases: [] as boolean[], release(destroy = false) { this.releases.push(destroy); } };
    await expect(make(actorFailure, async () => { throw new Error("actor failed"); })({ db: { pool: { connect: async () => actorFailure } } }, {}, {}, [])).rejects.toThrow("actor failed");
    expect(actorFailure.releases).toEqual([true]);
  });

  it("executes emitted kind-aware preview rebinding without persisted mutation", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const body = sales.slice(sales.indexOf("export async function resolveWorkspaceSalesDocument"), sales.indexOf("async function abandonSavedViewExecution"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn resolveWorkspaceSalesDocument;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const persisted = { regions: { main: [{ id: "saved-view-table-preview", type: "sales.saved-view-table", props: {}, bindings: { source: { source: { id: "sales.saved-view.table", version: 1 }, input: { "saved-view-id": 7, "expected-revision": 3 }, structuralCompatibilityHash: "table-hash", selectedFields: ["name"] } } }] } };
    const before = JSON.stringify(persisted); const client = { query: async () => ({ rows: [] }), release: () => undefined };
    const selected = { id: 7, definition: { source: { id: "sales.saved-view.kanban" }, fields: ["name", "stage-id"], presentation: { density: "compact" } } };
    const persistence = { lockSavedView: async () => selected, resolveDefaultSavedView: async () => selected };
    const weak = new WeakMap();
    const resolve = new Function("sourceNodes", "savedViewExecutionSources", "actor", "savedViewPersistence", "resolveSalesSavedViewExecution", "kNexIdentity", "savedViewBindingInput", "savedViewExecutionStates", "canonicalJson", "sources", executable)(
      (document: any) => document.regions.main, new Set(["sales.saved-view.table", "sales.saved-view.kanban", "sales.saved-view.calendar"]), async () => ({ authorization: { effectiveActor: { id: "actor" } } }), () => persistence,
      async (input: any) => ({ gatewayInput: input.bindingInput, selectedFields: input.selectedFields, query: {}, empty: false }), { applicationId: "app", environment: "production" }, (value: unknown) => value, weak, JSON.stringify,
      new Map([["sales.saved-view.kanban", { definition: { descriptor: { id: "sales.saved-view.kanban", version: 1, structuralCompatibilityHash: "kanban-hash" } } }]])
    ) as (...args: any[]) => Promise<any>;
    const result = await resolve({ db: { pool: { connect: async () => client } } }, {}, persisted, []);
    expect(JSON.stringify(persisted)).toBe(before);
    expect(result.regions.main[0]).toMatchObject({ type: "sales.opportunity-kanban", props: { title: "Saved View preview" }, presentation: { density: "compact" }, bindings: { source: { source: { id: "sales.saved-view.kanban", version: 1 }, structuralCompatibilityHash: "kanban-hash", selectedFields: ["name", "stage-id"] } } });
  });

  it("executes the emitted abort-between-resolution cleanup edge", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const body = sales.slice(sales.indexOf("export async function projectWorkspaceSalesDocument"), sales.indexOf("export async function executeWorkspaceSalesAction"));
    const executable = ts.transpileModule(`${body.replaceAll("export ", "")}\nreturn projectWorkspaceSalesDocument;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    let abandoned = 0; let loaded = 0;
    const project = new Function("resolveWorkspaceSalesDocument", "prepareWorkspaceSalesDocument", "loadWorkspaceSalesSources", "abandonSavedViewExecution", executable)(async (_p: unknown, _c: unknown, document: unknown) => document, (document: unknown) => document, async () => { loaded += 1; return {}; }, async () => { abandoned += 1; }) as (...args: any[]) => Promise<unknown>;
    const reason = new Error("aborted");
    await expect(project({}, {}, {}, [], { aborted: true, reason })).rejects.toBe(reason);
    expect({ abandoned, loaded }).toEqual({ abandoned: 1, loaded: 0 });
  });

  it("executes emitted Saved View chunk envelope, UTF-8, metadata, and digest checks", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const body = sales.slice(sales.indexOf("function taggedCell"), sales.indexOf("export async function loadWorkspaceSalesSources"));
    const executable = ts.transpileModule(`${body}\nreturn validateSavedViewDetail;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const validate = new Function("positiveSafeInteger", "canonicalJson", "canonicalSalesSavedViewJson", "Buffer", "createHash", "kNexIdentity", executable)((value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0, JSON.stringify, canonicalSalesSavedViewJson, Buffer, createHash, { applicationId: "app", environment: "production" }) as (client: unknown, current: unknown, value: unknown) => Promise<void>;
    const cell = (kind: string, value: unknown) => value === null ? null : { kind, value };
    const fields = ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"];
    const row = (index: number, count: number, chunk: string, changes: Record<string, unknown> = {}) => ({ key: `saved-view:7:chunk:${index}`, values: { id: cell("integer", 7), name: cell("text", "Mine"), visibility: cell("enum", "personal"), "team-id": null, "chunk-index": cell("integer", index), "chunk-count": cell("integer", count), "definition-chunk": cell("text", chunk), "target-object-id": cell("enum", "sales.object.account"), "view-kind": cell("enum", "table"), revision: cell("integer", 3), status: cell("status", "active"), ...changes } });
    const result = { fields, rows: [row(0, 1, "{}")], page: { number: 1, pageSize: 33, hasNext: false } };
    const client = { query: async () => ({ rows: [{ definition: {}, name: "Mine", owner_id: "actor", visibility: "personal", visibility_team_id: null, target_object_id: "sales.object.account", view_kind: "table", revision: 3, status: "active" }] }) };
    const current = { effectiveActor: { id: "actor" }, salesScope: { authorizedTeamIds: [] } };
    await expect(validate(client, current, result)).resolves.toBeUndefined();
    await expect(validate(client, current, { ...result, page: { number: 2, pageSize: 33, hasNext: false } })).rejects.toThrow("detail page");
    await expect(validate(client, current, { ...result, rows: [row(0, 1, "é".repeat(300))] })).rejects.toThrow("detail chunk");
    await expect(validate(client, current, { ...result, rows: [row(0, 1, "\ud800")] })).rejects.toThrow("detail chunk");
    await expect(validate(client, current, { ...result, rows: [{ ...row(0, 1, "{}"), key: "7:0" }] })).rejects.toThrow("detail chunk");
    await expect(validate(client, current, { ...result, rows: [row(0, 2, "{"), row(2, 2, "}")] })).rejects.toThrow("detail chunk");
    await expect(validate(client, current, { ...result, rows: [row(0, 2, "{"), row(1, 2, "}", { name: cell("text", "Other") })] })).rejects.toThrow("chunks are mixed");
    await expect(validate({ query: async () => ({ rows: [{ ...(await client.query()).rows[0], name: "Other" }] }) }, current, result)).rejects.toThrow("authority or digest changed");
    await expect(validate({ query: async () => ({ rows: [{ ...(await client.query()).rows[0], definition: { changed: true } }] }) }, current, result)).rejects.toThrow("authority or digest changed");
    const emojiDefinition = { label: "😀" }; const emojiText = JSON.stringify(emojiDefinition);
    await expect(validate({ query: async () => ({ rows: [{ ...(await client.query()).rows[0], definition: emojiDefinition }] }) }, current, { ...result, rows: [row(0, 1, emojiText)] })).resolves.toBeUndefined();
    const definition33 = { value: "a".repeat(55) }; const text33 = JSON.stringify(definition33); const chunks33 = Array.from({ length: 33 }, (_, index) => text33.slice(index * 2, index === 32 ? undefined : index * 2 + 2));
    await expect(validate({ query: async () => ({ rows: [{ ...(await client.query()).rows[0], definition: definition33 }] }) }, current, { ...result, rows: chunks33.map((chunk, index) => row(index, 33, chunk)) })).resolves.toBeUndefined();
    const sortedDefinition = { a: 1, z: 2 }; const sortedText = canonicalSalesSavedViewJson(sortedDefinition);
    await expect(validate({ query: async () => ({ rows: [{ ...(await client.query()).rows[0], definition: sortedDefinition }] }) }, current, { ...result, rows: [row(0, 1, sortedText)] })).resolves.toBeUndefined();
    await expect(validate({ query: async () => ({ rows: [{ ...(await client.query()).rows[0], definition: sortedDefinition }] }) }, current, { ...result, rows: [row(0, 1, '{"z":2,"a":1}')] })).rejects.toThrow("not canonical");
  });

  it("executes emitted personal, team, and application scope separation", () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const recordBody = sales.slice(sales.indexOf("function salesRecordWhere"), sales.indexOf("export async function resolveMergedSalesDetailRedirect"));
    const metadataBody = sales.slice(sales.indexOf("function savedViewMetadataWhere"), sales.indexOf("const workspaceCurrentSalesPolicy"));
    const executable = ts.transpileModule(`${recordBody}\n${metadataBody}\nreturn { salesRecordWhere, savedViewMetadataWhere };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const emitted = new Function("kNexIdentity", executable)({ applicationId: "app", environment: "production" }) as { salesRecordWhere(current: any): any; savedViewMetadataWhere(current: any): any };
    const personal = { effectiveActor: { id: "actor" }, salesScope: { recordScope: "owned-or-assigned-team", applicationWide: false, authorizedTeamIds: [] } };
    const team = { effectiveActor: { id: "actor" }, salesScope: { recordScope: "managed-teams-and-own", applicationWide: false, authorizedTeamIds: ["team-a"] } };
    const application = { effectiveActor: { id: "actor" }, salesScope: { recordScope: "application-sales-scope", applicationWide: true, authorizedTeamIds: ["team-a"] } };
    expect(JSON.stringify(emitted.salesRecordWhere(personal))).toContain('"ownerId":{"equals":"actor"}');
    expect(JSON.stringify(emitted.salesRecordWhere(team))).toContain('"teamId":{"in":["team-a"]}');
    expect(emitted.salesRecordWhere(application).and).toHaveLength(2);
    const metadata = JSON.stringify(emitted.savedViewMetadataWhere(application));
    expect(metadata).toContain('"visibility":{"equals":"personal"}');
    expect(metadata).toContain('"visibilityTeamId":{"in":["team-a"]}');
    expect(metadata).not.toContain("applicationWide");
    expect(sales).toContain('(record.visibility === "personal" ? record.visibilityTeamId === null : typeof record.visibilityTeamId === "string")');
    expect(sales).toContain("current.salesScope.authorizedTeamIds.includes(destinationTeamId)");
    expect(sales).toContain("savedViewAction && !await lockCurrentSalesMutationScope");
    expect(sales).toContain("actionReportingTimezone = await lockSalesReportingTimezone");
    expect(sales).toContain("\"descriptor_id\"='system.general'");
    expect(sales).toContain("document.settings_revision > state.settings_revision");
    expect(sales).toContain("revision: document.settings_revision");
    expect(sales).toContain('document.owner_kind !== "platform"');
    expect(sales).toContain('document.owner_namespace !== "system"');
    expect(sales).toContain("document.owner_delivery_class !== null");
    expect(sales).toContain("!canonicalIana((values as Record<string, unknown>).reportingTimezone)");
    expect(sales).toContain("{ reportingTimezone: actionReportingTimezone }");
    expect(sales).toContain("{ recheckReportingTimezone: () => lockSalesReportingTimezone");
    expect(sales).toContain('"mutation_allowed" = true FOR SHARE');
    expect(sales).toContain("{ savedViewCurrent }");
    expect(sales).toContain("{ savedViewDestination }");
    expect(sales).toContain('actionId === "sales.opportunity.stage.update"');
    expect(sales).toContain('{ collection: "sales-pipeline-stages", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" }');
  });

  it("executes the emitted reporting-timezone document revision and owner fence", async () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
    const start = sales.indexOf("type LockedSalesReportingTimezone");
    const body = sales.slice(start, sales.indexOf("function salesActionCapability", start));
    const executable = ts.transpileModule(`${body}\nreturn lockSalesReportingTimezone;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const load = (state: unknown, document: unknown) => new Function("activePayloadPostgresTransaction", "postgresRows", "sql", "kNexIdentity", "positiveSafeInteger", "canonicalIana", "ActionGatewayError", executable)(
      async () => ({ execute: async (query: { strings: readonly string[] }) => ({ rows: query.strings.join("").includes("k_nex_system_settings_state") ? [state] : [document] }) }),
      (value: { rows: readonly unknown[] }) => value.rows,
      (strings: TemplateStringsArray) => ({ strings }), { applicationId: "app", environment: "production" },
      (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
      (value: unknown) => value === "UTC", class extends Error {}
    ) as (request: unknown, actionId: string, input: unknown) => Promise<unknown>;
    const exact = { owner_kind: "platform", owner_namespace: "system", owner_delivery_class: null, owner_extension_id: null, owner_generation: null, document_revision: 4, settings_revision: 3, values_json: { reportingTimezone: "UTC" } };
    const invoke = (loader: ReturnType<typeof load>) => loader({}, "sales.saved-view.create", { definition: { kind: "calendar" } });
    await expect(invoke(load({ settings_revision: 5 }, exact))).resolves.toEqual({ timezone: "UTC", revision: 3 });
    await expect(invoke(load({ settings_revision: 2 }, exact))).rejects.toThrow();
    await expect(invoke(load({ settings_revision: 5 }, { ...exact, owner_namespace: "forged" }))).rejects.toThrow();
    await expect(invoke(load({ settings_revision: 5 }, { ...exact, values_json: { reportingTimezone: "Mars/Olympus" } }))).rejects.toThrow();
  });

  it("extracts raw embedded props into one request-local document before load and render", () => {
    const files = workspacePageApplicationFiles({ applicationId: "customer-alpha" });
    const sales = files["src/k-nex-sales-workspace.ts"]!;
    const host = files["src/k-nex-workspace-pages.ts"]!;

    expect(sales).toContain('key !== "savedViewId" && key !== "expectedRevision"');
    expect(sales).toContain('{ "saved-view-id": props.savedViewId, "expected-revision": props.expectedRevision }');
    expect(sales).toContain('const expectedKeys = node.type === "sales.opportunity-kanban" ? "title" : "";');
    expect(sales).toContain('throw new TypeError("Saved View block props are invalid.")');
    expect(sales).toContain("savedViewExecutionStates.set(resolved");
    expect(host).toContain('projectWorkspaceSalesDocument(payload, context, detail.publication.revision.document, permissions, session.signal, Object.freeze({}), pageNumber, undefined, "table", pageNodeId)');
    expect(host).toContain("return Object.freeze({ document, permissions, sourceResults");
    const client = files["src/app/components/k-nex-workspace-page-runtime.tsx"]!;
    expect(client).toContain('window.addEventListener("k-nex:sales-page-change", changePage)');
    expect(client).toContain('(page as number) > 1_000_000');
    expect(client).toContain('"&nodeId=" + encodeURIComponent(pageRequest.nodeId) + "&page=" + pageRequest.page');
  });

  it("locks, compiles, rechecks, and cleans up bounded source execution", () => {
    const sales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;

    expect(sales).toContain('await client.query("begin")');
    expect(sales).toContain("resolveDefaultSavedView(sourceId: SalesSavedViewSourceId)");
    expect(sales).toContain("resolveSalesSavedViewExecution({ sourceId, bindingInput: parsed, selectedFields, pageNumber");
    expect(sales).toContain("const query = savedViewPlan?.query");
    expect(sales).toContain('rows: [], page: { number: page.number, pageSize: page.size, hasNext: false }');
    expect(sales).toContain('descriptor.id === "sales.pipeline.snapshot" ? 6 : descriptor.id === "sales.saved-view.detail" ? 33');
    expect(sales).toContain("const detail = salesRecordDetailSources.has(descriptor.id)");
    expect(sales).toContain("recheckSalesSavedViewExecution({ fence: plan.fence");
    expect(sales).toContain("new ApplicationReportingTimezoneResolver(new EffectiveSettingsProvider");
    expect(sales).toContain("descriptor_id='system.general' and descriptor_schema_version=3");
    expect(sales).toContain("EffectiveSettingsDocumentSchema.safeParse");
    expect(sales).toContain("plan.fence?.reportingTimezone");
    expect(sales).toContain('await savedViewState.client.query("commit")');
    expect(sales).toContain('try { await savedViewState.client.query("rollback"); } catch { destroy = true; }');
    expect(sales).toContain("savedViewExecutionStates.delete(document)");
  });

  it("parses exact native pairs and mounts only the selected Opportunity mode", () => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" });
    const server = files["src/k-nex-sales-routes.ts"]!;
    const client = files["src/app/components/k-nex-sales-route-runtime.tsx"]!;
    const api = files["src/app/api/k-nex/sales/routes/[routeId]/route.ts"]!;
    const workspaceSales = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;

    expect(server).toContain('keys === "expected-revision\\0saved-view-id"');
    expect(server).toContain('routeId === "sales.route.calendar" || routeId === "sales.route.saved-views"');
    expect(api).toContain("query.getAll(key).length !== 1");
    expect(workspaceSales).toContain('node.id === "sales-opportunities" && mode === "kanban" || node.id === "sales-opportunity-kanban" && mode === "table"');
    expect(client).toContain('onClick={() => replaceSelection({})}');
    expect(client).toContain('onClick={() => replaceSelection({ mode: "kanban" })}');
    expect(client).toContain('window.addEventListener("popstate", restore)');
    expect(client).toContain("savedViewMutationSelection(selection, request.action.id, body.data)");
    expect(client).toContain('requestLocal: true');
    expect(client).toContain('window.dispatchEvent(new CustomEvent("k-nex:sales-import-select"');
    expect(files["src/app/(workspace)/sales/calendar/page.tsx"]).toBeDefined();
    expect(files["src/app/(workspace)/sales/settings/pipeline/page.tsx"]).toBeDefined();
    expect(files["src/app/(workspace)/sales/views/page.tsx"]).toBeDefined();
  });
});
