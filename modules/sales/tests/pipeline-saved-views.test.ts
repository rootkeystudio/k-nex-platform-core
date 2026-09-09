import { describe, expect, it, vi } from "vitest";
import { BoundedQueryBudgetEvaluator, DataSourceGatewayError } from "@k-nex/runtime";

import { canonicalSalesCalendarRange, canonicalSalesSavedViewJson, compileSalesSavedViewDefinition, salesPipelineSnapshotDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewTableDescriptor, salesWorkflowActionInputRuntimeSchemas, salesWorkflowActionOutputRuntimeSchemas, validateSalesPipelineSnapshotInput } from "../src/contracts.js";
import { recheckSalesSavedViewExecution, resolveSalesSavedViewExecution, salesConfigurationActionDefinitions, salesConfigurationActionHandler, salesPipelineSnapshotHandler, salesPipelineSnapshotOutputRuntimeSchema, salesPipelineStageId, salesSavedViewCalendarHandler, salesSavedViewDetailHandler, salesSavedViewKanbanHandler, salesSavedViewListHandler, salesSavedViewTableHandler, salesSavedViewTableOutputRuntimeSchema, type SalesPersistedSavedView } from "../src/server.js";

const stageId = "48a05b92-77d1-5cfc-83af-095f66e0f6f1";
const view: SalesPersistedSavedView = {
  id: 7, revision: 3, applicationId: "customer-gate-1", environment: "production", ownerId: "seller-1", status: "active", visibility: { kind: "personal" },
  definition: {
    kind: "kanban", targetObjectId: "sales.object.opportunity", source: { id: "sales.saved-view.kanban", version: 1, sourceSchema: { id: "sales.saved-view.kanban.output", version: 1 }, structuralCompatibilityHash: salesSavedViewKanbanDescriptor.structuralCompatibilityHash },
    fields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"], filters: [], sorts: [], grouping: "stage-id", presentation: { density: "comfortable" }, pageSize: 25
  }
};

describe("P13.4 pipeline and saved-view backend", () => {
  it("derives the accepted opaque UUIDv5 vectors and rejects forged inputs", () => {
    expect(salesPipelineStageId("customer-gate-1", "production", 17, "qualification")).toBe(stageId);
    expect(salesPipelineStageId("customer-gate-1", "production", 17, "discovery")).toBe("76ad7b41-5584-5d62-ab10-2575df5a8d47");
    expect(() => salesPipelineStageId("customer\0forged", "production", 17, "qualification")).toThrow(/identity input/u);
  });

  it("compiles only exact bounded saved-view controls", () => {
    expect(canonicalSalesSavedViewJson({ z: 1, a: [true, null] })).toBe('{"a":[true,null],"z":1}');
    expect(compileSalesSavedViewDefinition(view.definition, "sales.saved-view.kanban", view.definition.fields, 2).query).toEqual({ filters: [], sort: [], page: { number: 2, size: 25 } });
    expect(() => compileSalesSavedViewDefinition({ ...view.definition, fields: [...view.definition.fields, "sql"] }, "sales.saved-view.kanban", [...view.definition.fields, "sql"], 1)).toThrow();
    expect(() => compileSalesSavedViewDefinition({ ...view.definition, filters: Array.from({ length: 9 }, () => ({ fieldId: "name", operator: "eq", value: "x" })) }, "sales.saved-view.kanban", view.definition.fields, 1)).toThrow(/bounds/u);
  });

  it("uses the current canonical reporting timezone and calendar days across DST", () => {
    const reportingTimezone = { timezone: "America/New_York", revision: 9 } as const;
    const calendarRange = canonicalSalesCalendarRange(reportingTimezone, new Date("2026-03-14T12:00:00.000Z"));
    expect(calendarRange).toEqual({ start: "2026-03-01T05:00:00.000Z", end: "2026-04-01T04:00:00.000Z", timezone: "America/New_York" });
    const definition = {
      kind: "calendar", targetObjectId: "sales.object.activity", source: { id: "sales.saved-view.calendar", version: 1, sourceSchema: { id: "sales.saved-view.calendar.output", version: 1 }, structuralCompatibilityHash: salesSavedViewCalendarDescriptor.structuralCompatibilityHash },
      fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], filters: [], sorts: [], calendarRange, dateField: "scheduled-at", presentation: { mode: "month" }, pageSize: 25
    } as const;
    expect(compileSalesSavedViewDefinition(definition, "sales.saved-view.calendar", definition.fields, 1, { reportingTimezone }).query.filters).toEqual([
      { field: "scheduled-at", operator: "gte", value: calendarRange.start }, { field: "scheduled-at", operator: "lt", value: calendarRange.end }
    ]);
    expect(() => compileSalesSavedViewDefinition(definition, "sales.saved-view.calendar", definition.fields, 1)).toThrow(/calendar-view discriminator/u);
    expect(() => compileSalesSavedViewDefinition({ ...definition, calendarRange: { ...calendarRange, timezone: "US/Eastern" } }, "sales.saved-view.calendar", definition.fields, 1, { reportingTimezone })).toThrow(/calendar-view discriminator/u);
    expect(() => compileSalesSavedViewDefinition({ ...definition, calendarRange: { ...calendarRange, end: "2026-04-02T04:00:00.000Z" } }, "sales.saved-view.calendar", definition.fields, 1, { reportingTimezone })).toThrow(/calendar-view range/u);
  });

  it("translates compiled inclusive calendar bounds to Payload query operators", async () => {
    const reportingTimezone = { timezone: "UTC", revision: 9 } as const;
    const calendarRange = { start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z", timezone: "UTC" } as const;
    const definition = {
      kind: "calendar", targetObjectId: "sales.object.activity", source: { id: salesSavedViewCalendarDescriptor.id, version: 1, sourceSchema: salesSavedViewCalendarDescriptor.sourceSchema, structuralCompatibilityHash: salesSavedViewCalendarDescriptor.structuralCompatibilityHash },
      fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], filters: [], sorts: [], calendarRange, dateField: "scheduled-at", presentation: { mode: "month" }, pageSize: 25
    } as const;
    const query = compileSalesSavedViewDefinition(definition, "sales.saved-view.calendar", definition.fields, 1, { reportingTimezone }).query;
    const recordScope = { kind: "sales.activities", where: { and: [{ applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { equals: "seller-1" } }] } };
    const find = vi.fn(async ({ collection }: { collection: string }) => collection === "sales-saved-views"
      ? { docs: [{ id: 7, revision: 3, ownerId: "seller-1", visibility: "personal", visibilityTeamId: null, status: "active", definition }], hasNextPage: false }
      : { docs: [], hasNextPage: false });
    const fieldAuthority = definition.fields.map((fieldId) => ({ fieldId, select: true, filter: fieldId === "scheduled-at", sort: false }));
    await salesSavedViewCalendarHandler({ actor: { effectiveActor: { kind: "user", id: "seller-1" } }, input: { "saved-view-id": 7, "expected-revision": 3 }, selectedFields: definition.fields, query, signal: new AbortController().signal, recordScope, request: { applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, salesSavedViewExecutionAuthority: { metadataScope: { applicationId: "customer-gate-1", environment: "production", savedViewId: 7, savedViewRevision: 3, ownerId: "seller-1", visibility: { kind: "personal" } }, targetRecordScope: recordScope, fieldAuthority, reportingTimezone }, payload: { find } } } as never);
    const targetQuery = find.mock.calls.find(([options]) => options.collection === "sales-activities")?.[0];
    expect(targetQuery.where).toEqual({ and: [recordScope.where, { scheduledAt: { greater_than_equal: calendarRange.start } }, { scheduledAt: { less_than: calendarRange.end } }] });
  });

  it("rejects heterogeneous saved-view filter arrays", () => {
    const table = {
      kind: "table", targetObjectId: "sales.object.account", source: { id: "sales.saved-view.table", version: 1, sourceSchema: { id: "sales.saved-view.table.output", version: 1 }, structuralCompatibilityHash: salesSavedViewTableDescriptor.structuralCompatibilityHash },
      fields: ["name"], filters: [{ fieldId: "name", operator: "in", value: ["customer", null] }], sorts: [], presentation: { density: "comfortable" }, pageSize: 25
    } as const;
    expect(() => compileSalesSavedViewDefinition(table, "sales.saved-view.table", table.fields, 1)).toThrow(/filter value/u);
  });

  it("enforces the saved-view name UTF-8 byte ceiling before dispatch", () => {
    const definition = {
      kind: "table", targetObjectId: "sales.object.account", source: { id: "sales.saved-view.table", version: 1, sourceSchema: { id: "sales.saved-view.table.output", version: 1 }, structuralCompatibilityHash: salesSavedViewTableDescriptor.structuralCompatibilityHash },
      fields: ["name"], filters: [], sorts: [], presentation: { density: "comfortable" }, pageSize: 25
    } as const;
    const runtime = salesWorkflowActionInputRuntimeSchemas["sales.saved-view.create"]!;
    expect(runtime.safeParse({ name: "é".repeat(60), visibility: { kind: "personal" }, definition }).success).toBe(true);
    expect(runtime.safeParse({ name: "é".repeat(61), visibility: { kind: "personal" }, definition }).success).toBe(false);
    expect(runtime.safeParse({ name: "e\u0301", visibility: { kind: "personal" }, definition }).success).toBe(false);
    expect(runtime.safeParse({ name: "View", visibility: { kind: "team", teamId: "e\u0301" }, definition }).success).toBe(false);
  });

  it("admits the exact pipeline snapshot at cost 14 and rejects a lower ceiling", () => {
    const schema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
    const request = {
      correlationId: "pipeline-budget", rawRequest: {}, sourceId: salesPipelineSnapshotDescriptor.id, surface: "workspace" as const, input: {},
      query: { filters: [], sort: [], page: { number: 1, size: 6 } }, selectedFields: salesPipelineSnapshotDescriptor.outputFields!.map(({ id }) => id), signal: new AbortController().signal
    };
    const authenticated = { actor: { principal: { kind: "user" as const, id: "admin-1" }, effectiveActor: { kind: "user" as const, id: "admin-1" } }, request: {}, authorizationContext: {} };
    const authorized = { selectedFields: request.selectedFields, recordScope: { kind: "sales.pipelines" } };
    const source = { definition: { descriptor: salesPipelineSnapshotDescriptor, inputSchema: schema, outputSchema: schema }, handler: () => undefined };
    const evaluated = new BoundedQueryBudgetEvaluator().evaluate(source, request, authenticated, authorized);
    evaluated.lease.release();
    const overBudget = { ...source, definition: { ...source.definition, descriptor: { ...salesPipelineSnapshotDescriptor, limits: { ...salesPipelineSnapshotDescriptor.limits, maxCost: 13 } } } };
    expect(() => new BoundedQueryBudgetEvaluator().evaluate(overBudget, request, authenticated, authorized)).toThrowError(expect.objectContaining<DataSourceGatewayError>({ code: "QUERY_COST_EXCEEDED", status: 429 }));
  });

  it("emits pipeline array cells as exact compact JSON byte strings", async () => {
    const semantics = ["discovery", "qualification", "proposal", "negotiation", "won", "lost"] as const;
    const ids = semantics.map((semantic) => salesPipelineStageId("customer-gate-1", "production", 17, semantic));
    const transitions = [[ids[2]], [ids[0]], [ids[3], ids[5]], [ids[4]], [], []];
    const docs = ids.map((stageId, index) => ({ stageId, revision: 1, semantic: semantics[index], name: `Stage ${index}`, position: index, probabilityBasisPoints: index * 2_000, allowedTransitionStageIds: transitions[index], requiredFieldIds: index === 5 ? ["lossReason"] : [], status: "active" }));
    const context = (find: ReturnType<typeof vi.fn>) => ({
      actor: { effectiveActor: { kind: "user", id: "admin-1" } }, input: {}, selectedFields: ["allowed-transition-stage-ids", "required-field-ids"], query: { filters: [], sort: [], page: { number: 1, size: 6 } }, signal: new AbortController().signal,
      recordScope: { kind: "sales.pipelines", where: { and: [{ applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }] } },
      request: { applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, payload: { find } }
    } as never);
    const find = vi.fn().mockResolvedValueOnce({ docs: [{ id: 17, revision: 4, name: "Sales", orderedStageIds: ids, status: "active", isActive: true }] }).mockResolvedValueOnce({ docs });
    const output = await salesPipelineSnapshotHandler(context(find));
    const allowed = (output.rows[0]!.values["allowed-transition-stage-ids"] as { value: string }).value;
    const required = (output.rows[5]!.values["required-field-ids"] as { value: string }).value;
    expect(allowed).toBe(JSON.stringify([ids[2]]));
    expect(required).toBe('["lossReason"]');
    for (const row of output.rows) for (const field of ["allowed-transition-stage-ids", "required-field-ids"] as const) {
      const raw = (row.values[field] as { value: string }).value;
      expect(raw).not.toMatch(/[\n\r]/u);
      expect(JSON.stringify(JSON.parse(raw))).toBe(raw);
    }
    const forged = docs.map((stage, index) => index === 0 ? { ...stage, stageId: "00000000-0000-5000-8000-000000000000" } : stage);
    const forgedFind = vi.fn().mockResolvedValueOnce({ docs: [{ id: 17, revision: 4, name: "Sales", orderedStageIds: forged.map(({ stageId }) => stageId), status: "active", isActive: true }] }).mockResolvedValueOnce({ docs: forged });
    await expect(salesPipelineSnapshotHandler(context(forgedFind))).rejects.toMatchObject({ code: "INVALID_SOURCE_OUTPUT", status: 500 });
    const inactiveFind = vi.fn().mockResolvedValueOnce({ docs: [{ id: 17, revision: 4, name: "Sales", orderedStageIds: ids, status: "active", isActive: false }] }).mockResolvedValueOnce({ docs });
    await expect(salesPipelineSnapshotHandler(context(inactiveFind))).rejects.toMatchObject({ code: "INVALID_SOURCE_OUTPUT", status: 500 });
  });

  it("rejects malformed collection-specific rows and forged nested replay output", () => {
    const ids = Array.from({ length: 6 }, (_, index) => `00000000-0000-5000-8000-00000000000${index}`);
    const stages = ids.map((id, index) => ({ stageId: id, revision: 2, semantic: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"][index], name: `Stage ${index}`, position: index, probabilityBasisPoints: index * 2_000, allowedTransitionStageIds: [], requiredFieldIds: index === 5 ? ["lossReason"] : [], status: "active" }));
    const replay = { id: "17", revision: 2, name: "Sales", orderedStageIds: ids, stages, status: "active" };
    expect(salesWorkflowActionOutputRuntimeSchemas["sales.pipeline.update"].safeParse(replay).success).toBe(true);
    expect(salesWorkflowActionOutputRuntimeSchemas["sales.pipeline.update"].safeParse({ ...replay, stages: stages.map((stage, index) => index === 0 ? { ...stage, forged: true } : stage) }).success).toBe(false);
    expect(salesWorkflowActionOutputRuntimeSchemas["sales.pipeline.update"].safeParse({ ...replay, stages: stages.slice(0, 5) }).success).toBe(false);

    const fields = salesPipelineSnapshotDescriptor.outputFields!.map(({ id }) => id);
    const semantics = ["discovery", "qualification", "proposal", "negotiation", "won", "lost"] as const;
    const transitions = [[ids[2]], [ids[0]], [ids[3], ids[5]], [ids[4]], [], []];
    const rows = ids.map((id, index) => ({ key: `stage:${id}`, values: Object.fromEntries(salesPipelineSnapshotDescriptor.outputFields!.map((field) => [field.id, { kind: field.kind, value:
      field.id === "pipeline-id" || field.id === "pipeline-revision" || field.id === "stage-revision" ? 1 : field.id === "position" ? index : field.id === "probability-basis-points" ? index * 2_000 : field.id === "stage-id" ? id : field.id === "semantic" ? semantics[index] : field.id === "pipeline-name" ? "Sales" : field.id === "stage-name" ? `Stage ${index}` : field.id === "allowed-transition-stage-ids" ? JSON.stringify(transitions[index]) : field.id === "required-field-ids" ? JSON.stringify(index === 5 ? ["lossReason"] : []) : "active" }])) }));
    const page = { number: 1, pageSize: 6, hasNext: false };
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows, page }).success).toBe(true);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.slice(0, 1), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.slice(0, 5), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: [...rows, rows[0]], page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: [rows[1], rows[0], ...rows.slice(2)], page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 0 ? { ...row, key: ids[0] } : row), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 1 ? { ...row, key: rows[0]!.key, values: { ...row.values, "stage-id": rows[0]!.values["stage-id"] } } : row), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, "allowed-transition-stage-ids": { kind: "text", value: JSON.stringify([ids[4]]) } } } : row), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, "pipeline-id": { kind: "integer", value: 2 } } } : row), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, status: null } } : row), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, status: { kind: "status", value: "archived" } } } : row), page }).success).toBe(false);
    expect(salesPipelineSnapshotOutputRuntimeSchema.safeParse({ fields, rows: rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, "stage-name": { kind: "text", value: "e\u0301" } } } : row), page }).success).toBe(false);
    expect(salesSavedViewTableOutputRuntimeSchema.safeParse({ fields: ["amount"], rows: [{ key: "9", values: { amount: { kind: "money", value: "12.50" } } }], page: { number: 1, pageSize: 20, hasNext: false } }).success).toBe(false);
  });

  it("admits configurable open-stage order and trusted transition subsets for pipeline mutations", () => {
    const semantics = ["discovery", "qualification", "proposal", "negotiation", "won", "lost"] as const;
    const ids = semantics.map((semantic) => salesPipelineStageId("customer-gate-1", "production", 17, semantic));
    const stages = semantics.map((semantic, index) => ({ stageId: ids[index], expectedRevision: 2, semantic, name: `Stage ${index}`, position: index, probabilityBasisPoints: index * 2_000, allowedTransitionStageIds: semantic === "discovery" ? [ids[2]] : semantic === "qualification" ? [ids[0]] : semantic === "proposal" ? [ids[3]] : semantic === "negotiation" ? [ids[4]] : [], requiredFieldIds: semantic === "lost" ? ["lossReason"] : [] }));
    const input = { id: "17", expectedRevision: 2, name: "Sales", orderedStageIds: ids, stages };
    expect(() => validateSalesPipelineSnapshotInput(input, "customer-gate-1", "production", salesPipelineStageId)).not.toThrow();
    expect(() => validateSalesPipelineSnapshotInput({ ...input, orderedStageIds: [...ids, ids[0]] }, "customer-gate-1", "production", salesPipelineStageId)).toThrow(/snapshot/u);
    expect(() => validateSalesPipelineSnapshotInput({ ...input, stages: stages.map((stage, index) => index === 0 ? { ...stage, allowedTransitionStageIds: [ids[4]] } : stage) }, "customer-gate-1", "production", salesPipelineStageId)).toThrow(/transition graph/u);
    expect(() => validateSalesPipelineSnapshotInput({ ...input, stages: [stages[0], stages[1], stages[2], stages[4], stages[3], stages[5]] }, "customer-gate-1", "production", salesPipelineStageId)).toThrow(/stage snapshot|semantic positions/u);
  });

  it("locks authority before execution and rejects a post-result revision race", async () => {
    let current = view; const persistence = {
      lockSavedView: vi.fn(async () => current), resolveDefaultSavedView: vi.fn(async () => current), authorizationRevision: vi.fn(async () => 11), sourceRevision: vi.fn(async () => 5),
      authorizeView: vi.fn(async () => true), authorizeTarget: vi.fn(async () => true), authorizeFields: vi.fn(async () => true),
      targetRecordScope: vi.fn(async () => ({ kind: "sales.opportunities" as const, where: { and: [{ applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }] } })),
      fieldAuthority: vi.fn(async () => view.definition.fields.map((fieldId) => ({ fieldId, select: true, filter: true, sort: true })))
    };
    const execution = await resolveSalesSavedViewExecution({ sourceId: "sales.saved-view.kanban", bindingInput: { "saved-view-id": 7, "expected-revision": 3 }, selectedFields: view.definition.fields, pageNumber: 1, applicationId: view.applicationId, environment: view.environment, actorId: "seller-1", persistence });
    expect(execution.empty).toBe(false); expect(execution.fence).toMatchObject({ savedViewId: 7, savedViewRevision: 3, sourceRevision: 5, authorizationRevision: 11 });
    expect(execution.gatewayInput).toEqual({ "saved-view-id": 7, "expected-revision": 3 });
    expect(execution.targetObjectId).toBe("sales.object.opportunity");
    current = { ...view, revision: 4 };
    await expect(recheckSalesSavedViewExecution({ fence: execution.fence!, applicationId: view.applicationId, environment: view.environment, persistence })).rejects.toMatchObject({ status: 409 });
  });

  it("rechecks absent non-calendar timezone fences and exact calendar timezone revisions", async () => {
    const table = { ...view, definition: { kind: "table", targetObjectId: "sales.object.account", source: { id: salesSavedViewTableDescriptor.id, version: 1, sourceSchema: salesSavedViewTableDescriptor.sourceSchema, structuralCompatibilityHash: salesSavedViewTableDescriptor.structuralCompatibilityHash }, fields: ["name"], filters: [], sorts: [], presentation: { density: "comfortable" }, pageSize: 25 } } as SalesPersistedSavedView;
    const reportingTimezone = { timezone: "UTC", revision: 4 } as const;
    const calendar = { ...view, definition: { kind: "calendar", targetObjectId: "sales.object.activity", source: { id: salesSavedViewCalendarDescriptor.id, version: 1, sourceSchema: salesSavedViewCalendarDescriptor.sourceSchema, structuralCompatibilityHash: salesSavedViewCalendarDescriptor.structuralCompatibilityHash }, fields: ["type", "subject", "status", "scheduled-at", "related-record-type", "related-record-id", "revision"], filters: [], sorts: [], dateField: "scheduled-at", calendarRange: canonicalSalesCalendarRange(reportingTimezone, new Date("2026-09-07T12:00:00.000Z")), presentation: { mode: "month" }, pageSize: 25 } } as SalesPersistedSavedView;
    for (const candidate of [table, view, calendar]) {
      let timezone: { timezone: string; revision: number } = reportingTimezone;
      const scopeKind = candidate.definition.targetObjectId === "sales.object.account" ? "sales.accounts" as const : candidate.definition.targetObjectId === "sales.object.activity" ? "sales.activities" as const : "sales.opportunities" as const;
      const persistence = {
        lockSavedView: vi.fn(async () => candidate), resolveDefaultSavedView: vi.fn(async () => candidate), authorizationRevision: vi.fn(async () => 11), sourceRevision: vi.fn(async () => 5), reportingTimezone: vi.fn(async () => timezone),
        authorizeView: vi.fn(async () => true), authorizeTarget: vi.fn(async () => true), authorizeFields: vi.fn(async () => true), targetRecordScope: vi.fn(async () => ({ kind: scopeKind, where: { and: [] } })),
        fieldAuthority: vi.fn(async () => candidate.definition.fields.map((fieldId) => ({ fieldId, select: true, filter: true, sort: true })))
      };
      const sourceId = candidate.definition.source.id;
      const execution = await resolveSalesSavedViewExecution({ sourceId, bindingInput: { "saved-view-id": 7, "expected-revision": 3 }, selectedFields: candidate.definition.fields, pageNumber: 1, applicationId: candidate.applicationId, environment: candidate.environment, actorId: "seller-1", persistence });
      await expect(recheckSalesSavedViewExecution({ fence: execution.fence!, applicationId: candidate.applicationId, environment: candidate.environment, persistence })).resolves.toBeUndefined();
      if (sourceId === "sales.saved-view.calendar") {
        timezone = { timezone: "UTC", revision: 5 };
        await expect(recheckSalesSavedViewExecution({ fence: execution.fence!, applicationId: candidate.applicationId, environment: candidate.environment, persistence })).rejects.toMatchObject({ code: "SOURCE_STALE", status: 409 });
      } else {
        expect(execution.fence).not.toHaveProperty("reportingTimezone");
        expect(persistence.reportingTimezone).not.toHaveBeenCalled();
      }
    }
  });

  it("returns a canonical empty plan without a persisted Kanban default", async () => {
    const fields = ["row-kind", "name", "stage-id", "stage-metadata", "revision"];
    const persistence = {
      lockSavedView: vi.fn(), resolveDefaultSavedView: vi.fn(async () => undefined), authorizationRevision: vi.fn(), sourceRevision: vi.fn(), authorizeView: vi.fn(), authorizeTarget: vi.fn(), authorizeFields: vi.fn(), targetRecordScope: vi.fn(), fieldAuthority: vi.fn()
    };
    const plan = await resolveSalesSavedViewExecution({ sourceId: "sales.saved-view.kanban", bindingInput: {}, selectedFields: fields, pageNumber: 1, applicationId: "customer-gate-1", environment: "production", actorId: "seller-1", persistence });
    expect(plan).toEqual({ gatewayInput: {}, selectedFields: fields, query: { filters: [], sort: [], page: { number: 1, size: 25 } }, empty: true });
    expect(persistence.authorizationRevision).not.toHaveBeenCalled();
    await expect(salesSavedViewKanbanHandler({ input: {}, query: plan.query, request: { payload: { find: vi.fn() }, applicationIdentity: { applicationId: "customer-gate-1", environment: "production" } } } as never)).rejects.toMatchObject({ code: "INVALID_QUERY_INPUT", status: 400 });
  });

  it("registers the closed configuration actions and denies sole-pipeline archive without effects", async () => {
    expect(salesConfigurationActionDefinitions.map(({ descriptor }) => `${descriptor.id}@${descriptor.version}`)).toEqual([
      "sales.pipeline.update@2", "sales.pipeline.archive@2", "sales.saved-view.create@2", "sales.saved-view.update@2", "sales.saved-view.archive@2"
    ]);
    const payload = { find: vi.fn(), create: vi.fn(), update: vi.fn() };
    await expect(salesConfigurationActionHandler({
      actor: { effectiveActor: { kind: "user", id: "admin-1" } }, request: { payload }, input: { id: "17", expectedRevision: 2 }, idempotencyKey: "pipeline-archive-1", signal: new AbortController().signal,
      authorizationContext: { actionId: "sales.pipeline.archive", applicationId: "customer-gate-1", environment: "production", actorId: "admin-1", ownerId: "admin-1", resourceId: "17", eventId: "pipeline-archive-1" }
    } as never)).rejects.toMatchObject({ code: "ACTIVE_PIPELINE_REQUIRED", status: 409 });
    expect(payload.find).not.toHaveBeenCalled(); expect(payload.create).not.toHaveBeenCalled(); expect(payload.update).not.toHaveBeenCalled();
  });

  it("derives calendar create range only from trusted reporting settings", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    try {
      const calendarDefinition = {
        kind: "calendar", targetObjectId: "sales.object.activity", source: { id: salesSavedViewCalendarDescriptor.id, version: 1, sourceSchema: salesSavedViewCalendarDescriptor.sourceSchema, structuralCompatibilityHash: salesSavedViewCalendarDescriptor.structuralCompatibilityHash },
        fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], filters: [], sorts: [], dateField: "scheduled-at", presentation: { mode: "month" }, pageSize: 25
      };
      const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 8, ...data }));
      const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ docs: [{ id: 8, ...data }], errors: [] }));
      const output = await salesConfigurationActionHandler({ actor: { effectiveActor: { kind: "user", id: "seller-1" } }, request: { payload: { create, update, find: vi.fn() } }, input: { name: "Calendar", visibility: { kind: "personal" }, definition: calendarDefinition }, idempotencyKey: "calendar-create-1", signal: new AbortController().signal,
        authorizationContext: { actionId: "sales.saved-view.create", applicationId: "customer-gate-1", environment: "production", actorId: "seller-1", ownerId: "seller-1", eventId: "calendar-create-1", savedViewDestination: { ownerId: "seller-1", visibility: "personal", visibilityTeamId: null }, reportingTimezone: { timezone: "America/New_York", revision: 9 }, recheckReportingTimezone: async () => ({ timezone: "America/New_York", revision: 9 }) }
      } as never);
      expect((output as { definition: { calendarRange: unknown } }).definition.calendarRange).toEqual({ start: "2026-03-01T05:00:00.000Z", end: "2026-04-01T04:00:00.000Z", timezone: "America/New_York" });
      expect(create.mock.calls[0]?.[0].data.definition).toMatchObject({ calendarRange: { timezone: "America/New_York" } });
    } finally { vi.useRealTimers(); }
  });

  it("rejects malformed saved-view audit history before mutation side effects", async () => {
    const malformed = [{ actionId: "sales.saved-view.create", resourceId: "7", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "active", occurredAt: "2026-09-07T00:00:00.000Z", actorId: "seller-1", revision: 1, idempotencyKey: "saved-create-1", ownershipGenesis: { ownerId: "seller-1", teamId: null }, forged: true }];
    const find = vi.fn(async () => ({ docs: [{ id: 7, revision: 1, ownerId: "seller-1", visibility: "personal", visibilityTeamId: null, audit: malformed, status: "active" }] })); const update = vi.fn();
    await expect(salesConfigurationActionHandler({ actor: { effectiveActor: { kind: "user", id: "seller-1" } }, request: { payload: { find, update, create: vi.fn() } }, input: { id: "7", expectedRevision: 1, name: "Updated", visibility: { kind: "personal" }, definition: { ...view.definition, kind: "table", targetObjectId: "sales.object.account", source: { id: salesSavedViewTableDescriptor.id, version: 1, sourceSchema: salesSavedViewTableDescriptor.sourceSchema, structuralCompatibilityHash: salesSavedViewTableDescriptor.structuralCompatibilityHash }, fields: ["name"], grouping: undefined } }, idempotencyKey: "saved-update-2", signal: new AbortController().signal,
      authorizationContext: { actionId: "sales.saved-view.update", applicationId: "customer-gate-1", environment: "production", actorId: "seller-1", ownerId: "seller-1", resourceId: "7", eventId: "saved-update-2", savedViewCurrent: { ownerId: "seller-1", visibility: "personal", visibilityTeamId: null }, savedViewDestination: { ownerId: "seller-1", visibility: "personal", visibilityTeamId: null } }
    } as never)).rejects.toMatchObject({ code: "STALE_RECORD", status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects malformed pipeline migration history before updating any snapshot row", async () => {
    const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] as const;
    const ids = semantics.map((semantic) => salesPipelineStageId("customer-gate-1", "production", 17, semantic));
    const stages = semantics.map((semantic, position) => ({ stageId: ids[position], revision: 2, semantic, name: semantic, position, probabilityBasisPoints: position * 2_000, allowedTransitionStageIds: position < 4 ? [ids[position + 1]] : [], requiredFieldIds: semantic === "lost" ? ["lossReason"] : [], status: "active" }));
    const audit = [{ kind: "phase-13-settings-migration" }, { kind: "phase-13-pipeline-stage-identity", receiptDigest: `sha256:${"a".repeat(64)}`, sourceRevision: 1, targetRevision: 2, forged: true }];
    const find = vi.fn().mockResolvedValueOnce({ docs: [{ id: 17, revision: 2, audit, status: "active", isActive: true }] }).mockResolvedValueOnce({ docs: stages }); const update = vi.fn();
    await expect(salesConfigurationActionHandler({ actor: { effectiveActor: { kind: "user", id: "admin-1" } }, request: { payload: { find, update, create: vi.fn() } }, input: { id: "17", expectedRevision: 2, name: "No write", orderedStageIds: ids, stages: stages.map(({ status: _status, revision, ...stage }) => ({ ...stage, expectedRevision: revision })) }, idempotencyKey: "pipeline-invalid-audit", signal: new AbortController().signal,
      authorizationContext: { actionId: "sales.pipeline.update", applicationId: "customer-gate-1", environment: "production", actorId: "admin-1", ownerId: "admin-1", resourceId: "17", eventId: "pipeline-invalid-audit" }
    } as never)).rejects.toMatchObject({ code: "STALE_RECORD", status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts only personal-owner OR authorized-team metadata authority and propagates the transaction", async () => {
    const find = vi.fn(async () => ({ docs: [], hasNextPage: false }));
    const base = {
      actor: { effectiveActor: { kind: "user", id: "seller-1" } }, input: {}, selectedFields: ["id", "name", "visibility", "target-object-id", "view-kind", "revision", "status"],
      query: { filters: [], sort: [], page: { number: 1, size: 20 } }, signal: new AbortController().signal,
      request: { transactionID: "tx-p134", applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, payload: { find } }
    };
    const recordScope = { kind: "sales.saved-views", where: { and: [
      { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } },
      { status: { equals: "active" } },
      { or: [
        { and: [{ ownerId: { equals: "seller-1" } }, { visibility: { equals: "personal" } }] },
        { and: [{ visibilityTeamId: { in: ["team-a", "team-b"] } }, { visibility: { equals: "team" } }] }
      ] }
    ] } };
    await salesSavedViewListHandler({ ...base, recordScope } as never);
    expect(find.mock.calls[0]?.[0]).toMatchObject({ req: { transactionID: "tx-p134" } });
    const personalOnlyScope = { ...recordScope, where: { and: [...recordScope.where.and.slice(0, 3), { or: [recordScope.where.and[3]!.or[0]!] }] } };
    await salesSavedViewListHandler({ ...base, recordScope: personalOnlyScope } as never);
    expect(find.mock.calls[1]?.[0]).toMatchObject({ req: { transactionID: "tx-p134" } });
    expect(find.mock.calls[1]?.[0].where.and[0]).toEqual(personalOnlyScope.where);
    await expect(salesSavedViewListHandler({ ...base, recordScope: { ...recordScope, where: { and: recordScope.where.and.slice(0, 3) } } } as never)).rejects.toThrow(/personal-owner or authorized-team/u);
    const teamOnlyScope = { ...recordScope, where: { and: [...recordScope.where.and.slice(0, 3), { or: [recordScope.where.and[3]!.or[1]!] }] } };
    await expect(salesSavedViewListHandler({ ...base, recordScope: teamOnlyScope } as never)).rejects.toThrow(/personal-owner or authorized-team/u);
    const emptyTeamScope = { ...recordScope, where: { and: [...recordScope.where.and.slice(0, 3), { or: [recordScope.where.and[3]!.or[0]!, { and: [{ visibilityTeamId: { in: [] } }, { visibility: { equals: "team" } }] }] }] } };
    await expect(salesSavedViewListHandler({ ...base, recordScope: emptyTeamScope } as never)).rejects.toThrow(/closed application and environment|personal-owner or authorized-team/u);
    const widenedScope = { ...recordScope, where: { and: [...recordScope.where.and.slice(0, 3), { or: [{ visibility: { equals: "personal" } }, recordScope.where.and[3]!.or[1]!] }] } };
    await expect(salesSavedViewListHandler({ ...base, recordScope: widenedScope } as never)).rejects.toThrow(/personal-owner or authorized-team/u);
    const missingStatusScope = { ...recordScope, where: { and: [recordScope.where.and[0]!, recordScope.where.and[1]!, recordScope.where.and[3]!] } };
    await expect(salesSavedViewListHandler({ ...base, recordScope: missingStatusScope } as never)).rejects.toThrow(/active personal-owner/u);
    const duplicateStatusScope = { ...recordScope, where: { and: [...recordScope.where.and, { status: { equals: "active" } }] } };
    await expect(salesSavedViewListHandler({ ...base, recordScope: duplicateStatusScope } as never)).rejects.toThrow(/active personal-owner/u);
    const archivedStatusScope = { ...recordScope, where: { and: recordScope.where.and.map((clause, index) => index === 2 ? { status: { equals: "archived" } } : clause) } };
    await expect(salesSavedViewListHandler({ ...base, recordScope: archivedStatusScope } as never)).rejects.toThrow(/active personal-owner/u);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("chunks saved-view detail on Unicode scalar boundaries with exact tagged keys", async () => {
    const definition = { note: "€".repeat(5_440) };
    const find = vi.fn(async () => ({ docs: [{ id: 7, revision: 3, ownerId: "seller-1", name: "Multibyte", visibility: "personal", visibilityTeamId: null, targetObjectId: "sales.object.opportunity", viewKind: "table", definition, status: "active" }], hasNextPage: false }));
    const recordScope = { kind: "sales.saved-views", where: { and: [
      { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } },
      { status: { equals: "active" } },
      { or: [{ and: [{ ownerId: { equals: "seller-1" } }, { visibility: { equals: "personal" } }] }, { and: [{ visibilityTeamId: { in: ["team-a"] } }, { visibility: { equals: "team" } }] }] }
    ] } };
    const output = await salesSavedViewDetailHandler({ actor: { effectiveActor: { kind: "user", id: "seller-1" } }, input: { "saved-view-id": 7 }, selectedFields: ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"], query: { filters: [], sort: [], page: { number: 1, size: 33 } }, signal: new AbortController().signal, recordScope, request: { transactionID: "tx-detail", applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, payload: { find } } } as never);
    expect(output.rows).toHaveLength(33);
    expect(output.rows.every((row, index) => row.key === `saved-view:7:chunk:${index}` && Buffer.byteLength((row.values["definition-chunk"] as { value: string }).value, "utf8") <= 512)).toBe(true);
    const assembled = output.rows.map((row) => (row.values["definition-chunk"] as { value: string }).value).join("");
    expect(assembled).toBe(canonicalSalesSavedViewJson(definition));
    expect(canonicalSalesSavedViewJson(JSON.parse(assembled))).toBe(assembled);
    find.mockResolvedValueOnce({ docs: [{ id: 7, revision: 3, ownerId: "seller-1", name: "Malformed", visibility: "personal", visibilityTeamId: null, targetObjectId: "sales.object.opportunity", viewKind: "table", definition: { note: "🧭".repeat(4_300) }, status: "active" }], hasNextPage: false });
    await expect(salesSavedViewDetailHandler({ actor: { effectiveActor: { kind: "user", id: "seller-1" } }, input: { "saved-view-id": 7 }, selectedFields: ["definition-chunk"], query: { filters: [], sort: [], page: { number: 1, size: 33 } }, signal: new AbortController().signal, recordScope, request: { applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, payload: { find } } } as never)).rejects.toMatchObject({ code: "INVALID_SOURCE_OUTPUT", status: 500 });
  });

  it("executes every frozen table target/field mapping without selecting hidden storage", async () => {
    const targets = {
      "sales.object.account": { scope: "sales.accounts", collection: "sales-accounts", fields: { name: "name", "owner-id": "ownerId", "team-id": "teamId", status: "status", revision: "revision" } },
      "sales.object.contact": { scope: "sales.contacts", collection: "sales-contacts", fields: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", status: "status", revision: "revision", email: "email", phone: "phone" } },
      "sales.object.lead": { scope: "sales.leads", collection: "sales-leads", fields: { "display-name": "displayName", source: "source", "owner-id": "ownerId", "team-id": "teamId", status: "status", "archive-status": "archiveStatus", revision: "revision", email: "email", phone: "phone" } },
      "sales.object.opportunity": { scope: "sales.opportunities", collection: "sales-opportunities", fields: { name: "name", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", "primary-contact-id": "primaryContactId", "pipeline-id": "pipelineId", "stage-id": "stageId", "expected-close-date": "expectedCloseDate", amount: "amount", "archive-status": "archiveStatus", revision: "revision" } },
      "sales.object.task": { scope: "sales.tasks", collection: "sales-tasks", fields: { title: "title", "owner-id": "ownerId", "team-id": "teamId", status: "status", "archive-status": "archiveStatus", "due-date": "dueDate", "related-record-type": "relatedRecordType", "related-record-id": "relatedRecordId", revision: "revision" } },
      "sales.object.activity": { scope: "sales.activities", collection: "sales-activities", fields: { type: "type", subject: "subject", "owner-id": "ownerId", "team-id": "teamId", status: "status", "scheduled-at": "scheduledAt", "occurred-at": "occurredAt", "related-record-type": "relatedRecordType", "related-record-id": "relatedRecordId", revision: "revision" } }
    } as const;
    const fieldValue = (fieldId: string) => {
      const kind = salesSavedViewTableDescriptor.outputFields?.find(({ id }) => id === fieldId)?.kind;
      return kind === "integer" ? 1 : kind === "date" ? "2026-09-07" : kind === "datetime" ? "2026-09-07T12:00:00.000Z" : kind === "money" ? "12.50" : "value";
    };
    for (const [targetObjectId, target] of Object.entries(targets)) {
      for (const [fieldId, storage] of Object.entries(target.fields)) {
        const definition = { kind: "table", targetObjectId, source: { id: salesSavedViewTableDescriptor.id, version: 1, sourceSchema: salesSavedViewTableDescriptor.sourceSchema, structuralCompatibilityHash: salesSavedViewTableDescriptor.structuralCompatibilityHash }, fields: [fieldId], filters: [], sorts: [], presentation: { density: "comfortable" }, pageSize: 20 } as const;
        const query = compileSalesSavedViewDefinition(definition, "sales.saved-view.table", [fieldId], 1).query;
        const recordScope = { kind: target.scope, where: { and: [{ applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }] } };
        const find = vi.fn(async ({ collection }: { collection: string }) => collection === "sales-saved-views"
          ? { docs: [{ id: 7, revision: 3, ownerId: "seller-1", visibility: "personal", visibilityTeamId: null, status: "active", definition }], hasNextPage: false }
          : { docs: [{ id: 9, [storage]: fieldValue(fieldId), ...(fieldId === "amount" ? { currency: "USD" } : {}) }], hasNextPage: false });
        const result = await salesSavedViewTableHandler({ actor: { effectiveActor: { kind: "user", id: "seller-1" } }, input: { "saved-view-id": 7, "expected-revision": 3 }, selectedFields: [fieldId], query, signal: new AbortController().signal, recordScope, request: { applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, salesSavedViewExecutionAuthority: { metadataScope: { applicationId: "customer-gate-1", environment: "production", savedViewId: 7, savedViewRevision: 3, ownerId: "seller-1", visibility: { kind: "personal" } }, targetRecordScope: recordScope, fieldAuthority: [{ fieldId, select: true, filter: true, sort: true }] }, payload: { find } } } as never);
        expect(result.rows).toHaveLength(1);
        const targetQuery = find.mock.calls.find(([options]) => options.collection === target.collection)?.[0];
        expect(targetQuery.select).toMatchObject({ id: true, [storage]: true });
        if (targetObjectId === "sales.object.opportunity" && fieldId === "name") expect(targetQuery.select).toEqual({ id: true, name: true });
        if (targetObjectId === "sales.object.opportunity" && fieldId === "amount") expect(targetQuery.select).toEqual({ id: true, currency: true, amount: true });
        expect(targetQuery.select).not.toHaveProperty("rowKind");
        expect(targetQuery.select).not.toHaveProperty("stageMetadata");
      }
    }
  });
});
