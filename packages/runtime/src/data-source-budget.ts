import {
  DataSourceQueryControlsSchema,
  dataSourcePlatformCeilings,
  type DataSourceCostClass,
  type DataSourceDescriptor,
  type DataSourceQueryControls
} from "@k-nex/contracts";

import { isDataSourceActorContext } from "./data-source-authorization.js";
import {
  DataSourceGatewayError,
  type AuthenticatedDataSourceRequest,
  type AuthorizedDataSourceQuery,
  type DataSourceGatewayRequest,
  type QueryBudgetLease,
  type QueryBudgetEvaluator,
  type RegisteredDataSource
} from "./data-source-gateway.js";

const classCeilings: Readonly<Record<DataSourceCostClass, Readonly<{ concurrency: number; ratePerMinute: number; baseCost: number }>>> = {
  low: { concurrency: 64, ratePerMinute: 600, baseCost: 1 },
  medium: { concurrency: 16, ratePerMinute: 300, baseCost: 5 },
  high: { concurrency: 4, ratePerMinute: 60, baseCost: 10 }
};

interface RateBucket {
  tokens: number;
  updatedAt: number;
}

export interface BoundedBudgetedDataSourceQuery {
  readonly input: unknown;
  readonly controls: DataSourceQueryControls;
  readonly signal: AbortSignal;
  readonly lease: QueryBudgetLease;
}

export interface BoundedQueryBudgetOptions {
  readonly now?: () => number;
}

function fail(code: string, status: number, detail: string): never {
  throw new DataSourceGatewayError(code, status, detail);
}

function jsonBytes(value: unknown, code: string, status: number): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(code, status, "Query data must be bounded JSON.");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function jsonDepth(value: unknown, ancestors = new Set<object>()): number {
  if (typeof value !== "object" || value === null) return 0;
  if (ancestors.has(value)) fail("INVALID_QUERY_BODY", 400, "Query data must be bounded JSON.");
  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  let depth = 1;
  for (const child of children) depth = Math.max(depth, 1 + jsonDepth(child, ancestors));
  ancestors.delete(value);
  return depth;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function actorSourceKey(authenticated: AuthenticatedDataSourceRequest, sourceId: string): string {
  if (!isDataSourceActorContext(authenticated.actor)) fail("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
  const actor = authenticated.actor.effectiveActor;
  return `${actor.kind}\u0000${actor.id}\u0000${sourceId}`;
}

function validateOperations(
  descriptor: DataSourceDescriptor,
  controls: DataSourceQueryControls,
  selectedFields: readonly string[]
): void {
  const limits = descriptor.limits;
  if (selectedFields.length > limits.maxSelectedFields || selectedFields.length > dataSourcePlatformCeilings.selectedFields) {
    fail("SELECTED_FIELD_LIMIT_EXCEEDED", 400, "Too many fields were selected.");
  }
  if (controls.filters.length > limits.maxFilters || controls.filters.length > dataSourcePlatformCeilings.filters) {
    fail("FILTER_LIMIT_EXCEEDED", 400, "Too many filters were requested.");
  }
  if (controls.sort.length > limits.maxSorts || controls.sort.length > dataSourcePlatformCeilings.sorts) {
    fail("SORT_LIMIT_EXCEEDED", 400, "Too many sort fields were requested.");
  }

  if (descriptor.primaryContract.id === "metric.scalar") {
    if (controls.page !== undefined || controls.cursor !== undefined || controls.filters.length > 0 || controls.sort.length > 0) {
      fail("QUERY_OPERATION_NOT_DECLARED", 400, "The source does not declare tabular query operations.");
    }
    return;
  }
  const pagination = controls.page ?? controls.cursor;
  if (pagination === undefined) fail("QUERY_PAGINATION_REQUIRED", 400, "Exactly one page or cursor request is required.");
  if (pagination.size > limits.maxPageSize || pagination.size > dataSourcePlatformCeilings.pageSize) {
    fail("PAGE_LIMIT_EXCEEDED", 400, "The requested page is too large.");
  }

  const fields = new Map((descriptor.outputFields ?? []).map((field) => [field.id, field]));
  for (const filter of controls.filters) {
    const field = fields.get(filter.field);
    if (!field || !field.filterOperators.includes(filter.operator)) {
      fail("FILTER_NOT_ALLOWED", 400, "A requested filter is not declared by the source.");
    }
  }
  const sortedFields = new Set<string>();
  for (const sort of controls.sort) {
    const field = fields.get(sort.field);
    if (!field?.sortable || sortedFields.has(sort.field)) {
      fail("SORT_NOT_ALLOWED", 400, "A requested sort is not declared by the source.");
    }
    sortedFields.add(sort.field);
  }
}

function queryCost(descriptor: DataSourceDescriptor, controls: DataSourceQueryControls, selectedFields: readonly string[]): number {
  const pagination = controls.page ?? controls.cursor;
  const pageCost = pagination === undefined ? 0 : Math.ceil(pagination.size / 25);
  return classCeilings[descriptor.limits.costClass].baseCost
    + selectedFields.length
    + controls.filters.length * 2
    + controls.sort.length
    + pageCost;
}

export class BoundedQueryBudgetEvaluator implements QueryBudgetEvaluator {
  private readonly now: () => number;
  private readonly active = new Map<string, number>();
  private readonly buckets = new Map<string, RateBucket>();

  constructor(options: BoundedQueryBudgetOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  evaluate(
    source: RegisteredDataSource,
    request: DataSourceGatewayRequest,
    authenticated: AuthenticatedDataSourceRequest,
    authorized: AuthorizedDataSourceQuery
  ): BoundedBudgetedDataSourceQuery {
    if (request.signal.aborted) fail("QUERY_CANCELLED", 499, "The query was cancelled.");
    const parsed = DataSourceQueryControlsSchema.safeParse(request.query);
    if (!parsed.success) fail("INVALID_QUERY_CONTROLS", 400, "Query controls are invalid.");
    const controls = parsed.data;
    const descriptor = source.definition.descriptor;
    validateOperations(descriptor, controls, authorized.selectedFields);

    const body = { input: request.input, query: controls, selectedFields: authorized.selectedFields };
    const depth = jsonDepth(body);
    if (depth > descriptor.limits.maxDepth || depth > dataSourcePlatformCeilings.depth) {
      fail("QUERY_DEPTH_EXCEEDED", 400, "The query body is too deeply nested.");
    }
    if (jsonBytes(body, "INVALID_QUERY_BODY", 400) > descriptor.limits.maxBodyBytes) {
      fail("QUERY_BODY_TOO_LARGE", 413, "The query body is too large.");
    }
    if (queryCost(descriptor, controls, authorized.selectedFields) > descriptor.limits.maxCost) {
      fail("QUERY_COST_EXCEEDED", 429, "The query cost budget was exceeded.");
    }

    const key = actorSourceKey(authenticated, descriptor.id);
    const classLimit = classCeilings[descriptor.limits.costClass];
    const concurrency = Math.min(descriptor.limits.maxConcurrency, classLimit.concurrency, dataSourcePlatformCeilings.concurrency);
    const current = this.active.get(key) ?? 0;
    if (current >= concurrency) fail("QUERY_CONCURRENCY_EXCEEDED", 429, "Too many source queries are running.");

    const now = this.now();
    const rate = Math.min(descriptor.limits.ratePerMinute, classLimit.ratePerMinute, dataSourcePlatformCeilings.ratePerMinute);
    const capacity = Math.min(descriptor.limits.burst, dataSourcePlatformCeilings.burst);
    const previous = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    const elapsed = Math.max(0, now - previous.updatedAt);
    const tokens = Math.min(capacity, previous.tokens + elapsed * rate / 60_000);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      fail("QUERY_RATE_EXCEEDED", 429, "The source query rate was exceeded.");
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    this.active.set(key, current + 1);

    let released = false;
    const lease = Object.freeze({
      release: (): void => {
        if (released) return;
        released = true;
        const remaining = (this.active.get(key) ?? 1) - 1;
        if (remaining <= 0) this.active.delete(key);
        else this.active.set(key, remaining);
      }
    });
    const timeout = AbortSignal.timeout(Math.min(descriptor.limits.timeoutMs, dataSourcePlatformCeilings.timeoutMs));
    return {
      input: request.input,
      controls: deepFreeze(controls),
      signal: AbortSignal.any([request.signal, timeout]),
      lease
    };
  }

  assertResult(source: RegisteredDataSource, value: unknown): void {
    if (jsonBytes(value, "INVALID_SOURCE_OUTPUT", 500) > source.definition.descriptor.limits.maxResultBytes) {
      fail("QUERY_RESULT_TOO_LARGE", 500, "The data-source result is too large.");
    }
  }
}
