import type { DataSourceDefinition, DataSourceDescriptor } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { BoundedQueryBudgetEvaluator } from "../src/data-source-budget.js";
import { DataSourceGatewayError, type DataSourceGatewayRequest, type RegisteredDataSource } from "../src/data-source-gateway.js";

const baseLimits: DataSourceDescriptor["limits"] = {
  maxSelectedFields: 4,
  maxPageSize: 50,
  maxFilters: 4,
  maxSorts: 2,
  maxBodyBytes: 10_000,
  maxResultBytes: 1_000,
  maxDepth: 6,
  timeoutMs: 100,
  maxConcurrency: 2,
  ratePerMinute: 120,
  burst: 10,
  costClass: "low",
  maxCost: 100
};

function registeredSource(
  id = "sales.tasks",
  limits: Partial<DataSourceDescriptor["limits"]> = {}
): RegisteredDataSource {
  const descriptor: DataSourceDescriptor = {
    id,
    version: 1,
    ownerPluginId: "module.sales",
    primaryContract: { id: "table.records", version: 1 },
    sourceSchema: { id: `${id}.output`, version: 1 },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "sales.tasks.read",
    structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
    presentationMetadataRevision: 1,
    title: "Sales tasks",
    inputFields: [],
    outputFields: [
      { id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.title.read", sortable: true, filterOperators: ["contains"] },
      { id: "status", kind: "status", binding: "optional", nullable: false, permission: "sales.tasks.status.read", sortable: false, filterOperators: ["eq", "in"] }
    ],
    limits: { ...baseLimits, ...limits },
    cacheClass: "actor"
  };
  const schema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
  const definition: DataSourceDefinition = { descriptor, inputSchema: schema, outputSchema: schema };
  return { definition, handler: () => undefined };
}

const actor = (id = "user-1") => ({
  actor: {
    principal: { kind: "user" as const, id },
    effectiveActor: { kind: "user" as const, id }
  },
  request: {},
  authorizationContext: {}
});

function request(overrides: Partial<DataSourceGatewayRequest> = {}): DataSourceGatewayRequest {
  return {
    correlationId: "corr-1",
    rawRequest: {},
    sourceId: "sales.tasks",
    surface: "workspace",
    input: {},
    query: {
      page: { number: 1, size: 25 },
      filters: [{ field: "status", operator: "eq", value: "open" }],
      sort: [{ field: "title", direction: "asc" }]
    },
    selectedFields: ["title", "status"],
    signal: new AbortController().signal,
    ...overrides
  };
}

const authorized = { selectedFields: ["title", "status"], recordScope: { tenant: "one" } };

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected the budget to reject the query.");
  } catch (error) {
    expect(error).toBeInstanceOf(DataSourceGatewayError);
    expect((error as DataSourceGatewayError).code).toBe(code);
  }
}

describe("bounded data-source query budgets", () => {
  it("accepts only declared page, filter, sort, and field operations", () => {
    const budget = new BoundedQueryBudgetEvaluator();
    const evaluated = budget.evaluate(registeredSource(), request(), actor(), authorized);

    expect(evaluated.controls).toEqual(request().query);
    expect(evaluated.input).toEqual({});
    expect(evaluated.signal.aborted).toBe(false);
    evaluated.lease.release();
  });

  it("accepts bounded cursor pagination and charges its page size", () => {
    const budget = new BoundedQueryBudgetEvaluator();
    const evaluated = budget.evaluate(registeredSource(), request({
      query: { cursor: { after: "opaque-next", size: 25 }, filters: [], sort: [] }
    }), actor(), authorized);
    expect(evaluated.controls).toEqual({ cursor: { after: "opaque-next", size: 25 }, filters: [], sort: [] });
    evaluated.lease.release();

    expectCode(() => budget.evaluate(
      registeredSource("sales.tasks", { maxCost: 4 }),
      request({ query: { cursor: { size: 50 }, filters: [], sort: [] } }),
      actor("cursor-cost"),
      authorized
    ), "QUERY_COST_EXCEEDED");
  });

  it.each([
    [{ query: { page: { number: 1, size: 51 }, filters: [], sort: [] } }, "PAGE_LIMIT_EXCEEDED"],
    [{ query: { page: { number: 1, size: 25 }, filters: [{ field: "title", operator: "eq", value: "x" }], sort: [] } }, "FILTER_NOT_ALLOWED"],
    [{ query: { page: { number: 1, size: 25 }, filters: [], sort: [{ field: "status", direction: "asc" }] } }, "SORT_NOT_ALLOWED"],
    [{ query: { filters: [], sort: [] } }, "QUERY_PAGINATION_REQUIRED"]
  ] as const)("rejects undeclared or over-limit operations %#", (overrides, code) => {
    expectCode(() => new BoundedQueryBudgetEvaluator().evaluate(
      registeredSource(),
      request(overrides as Partial<DataSourceGatewayRequest>),
      actor(),
      authorized
    ), code);
  });

  it("rejects every pagination mode on metric sources", () => {
    const metric = registeredSource();
    const metricSource: RegisteredDataSource = {
      ...metric,
      definition: {
        ...metric.definition,
        descriptor: { ...metric.definition.descriptor, primaryContract: { id: "metric.scalar", version: 1 }, outputFields: undefined }
      }
    };
    expectCode(() => new BoundedQueryBudgetEvaluator().evaluate(
      metricSource,
      request({ query: { cursor: { size: 1 }, filters: [], sort: [] }, selectedFields: [] }),
      actor(),
      { selectedFields: [], recordScope: {} }
    ), "QUERY_OPERATION_NOT_DECLARED");
  });

  it("enforces body depth, body bytes, query cost, and result bytes", () => {
    expectCode(() => new BoundedQueryBudgetEvaluator().evaluate(
      registeredSource("sales.tasks", { maxDepth: 3 }),
      request({ input: { one: { two: { three: true } } } }),
      actor(),
      authorized
    ), "QUERY_DEPTH_EXCEEDED");
    expectCode(() => new BoundedQueryBudgetEvaluator().evaluate(
      registeredSource("sales.tasks", { maxBodyBytes: 50 }),
      request({ input: { value: "x".repeat(100) } }),
      actor(),
      authorized
    ), "QUERY_BODY_TOO_LARGE");
    expectCode(() => new BoundedQueryBudgetEvaluator().evaluate(
      registeredSource("sales.tasks", { maxCost: 2 }),
      request(),
      actor(),
      authorized
    ), "QUERY_COST_EXCEEDED");
    expectCode(() => new BoundedQueryBudgetEvaluator().assertResult(
      registeredSource("sales.tasks", { maxResultBytes: 20 }),
      { value: "x".repeat(100) }
    ), "QUERY_RESULT_TOO_LARGE");
  });

  it("isolates concurrency by effective actor and source and releases idempotently", () => {
    const budget = new BoundedQueryBudgetEvaluator();
    const source = registeredSource("sales.tasks", { maxConcurrency: 1 });
    const first = budget.evaluate(source, request(), actor("one"), authorized);
    expectCode(() => budget.evaluate(source, request(), actor("one"), authorized), "QUERY_CONCURRENCY_EXCEEDED");

    const otherActor = budget.evaluate(source, request(), actor("two"), authorized);
    const otherSource = budget.evaluate(registeredSource("sales.other", { maxConcurrency: 1 }), request({ sourceId: "sales.other" }), actor("one"), authorized);
    first.lease.release();
    first.lease.release();
    const afterRelease = budget.evaluate(source, request(), actor("one"), authorized);
    otherActor.lease.release();
    otherSource.lease.release();
    afterRelease.lease.release();
  });

  it("applies burst/rate refill per actor and source", () => {
    let now = 0;
    const budget = new BoundedQueryBudgetEvaluator({ now: () => now });
    const source = registeredSource("sales.tasks", { burst: 1, ratePerMinute: 60 });
    budget.evaluate(source, request(), actor(), authorized).lease.release();
    expectCode(() => budget.evaluate(source, request(), actor(), authorized), "QUERY_RATE_EXCEEDED");
    expect(budget.evaluate(source, request(), actor("other"), authorized).lease.release()).toBeUndefined();
    now = 1_000;
    expect(budget.evaluate(source, request(), actor(), authorized).lease.release()).toBeUndefined();
  });

  it("caps high-cost concurrency below a plugin's generic platform ceiling", () => {
    const budget = new BoundedQueryBudgetEvaluator();
    const source = registeredSource("sales.tasks", { costClass: "high", maxConcurrency: 64, burst: 10 });
    const leases = Array.from({ length: 4 }, () => budget.evaluate(source, request(), actor(), authorized).lease);
    expectCode(() => budget.evaluate(source, request(), actor(), authorized), "QUERY_CONCURRENCY_EXCEEDED");
    leases.forEach((lease) => lease.release());
  });

  it("rejects caller cancellation and composes a timeout signal", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    expectCode(() => new BoundedQueryBudgetEvaluator().evaluate(
      registeredSource(),
      request({ signal: cancelled.signal }),
      actor(),
      authorized
    ), "QUERY_CANCELLED");

    const evaluated = new BoundedQueryBudgetEvaluator().evaluate(
      registeredSource("sales.tasks", { timeoutMs: 1 }),
      request(),
      actor(),
      authorized
    );
    await new Promise<void>((resolve) => evaluated.signal.addEventListener("abort", () => resolve(), { once: true }));
    expect(evaluated.signal.aborted).toBe(true);
    evaluated.lease.release();
  });
});
