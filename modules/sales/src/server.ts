import {
  MetricScalarSchema,
  TableRecordsSchema,
  type DataSourceDefinition,
  type DataSourceDescriptor,
  type DataSourceQueryControls
} from "@k-nex/contracts";
import type { DataSourceHandler, DataSourceHandlerRequest, PluginRegistration } from "@k-nex/runtime";
import type { CollectionConfig } from "payload";

const salesSourceLimits = Object.freeze({
  maxSelectedFields: 8,
  maxPageSize: 100,
  maxFilters: 8,
  maxSorts: 2,
  maxBodyBytes: 32_768,
  maxResultBytes: 1_048_576,
  maxDepth: 6,
  timeoutMs: 5_000,
  maxConcurrency: 16,
  ratePerMinute: 300,
  burst: 30,
  costClass: "medium" as const,
  maxCost: 100
});

const salesMetricLimits = Object.freeze({
  ...salesSourceLimits,
  maxSelectedFields: 1,
  maxFilters: 0,
  maxSorts: 0,
  costClass: "high" as const,
  maxCost: 50
});

const salesTaskFields: DataSourceDescriptor["outputFields"] = [
  {
    id: "title",
    kind: "text",
    binding: "required",
    nullable: false,
    permission: "sales.tasks.title.read",
    sortable: true,
    filterOperators: ["eq", "contains"]
  },
  {
    id: "status",
    kind: "status",
    binding: "required",
    nullable: false,
    permission: "sales.tasks.status.read",
    sortable: true,
    filterOperators: ["eq", "in"]
  },
  {
    id: "potential-revenue",
    kind: "money",
    binding: "required",
    nullable: true,
    permission: "sales.tasks.revenue.read",
    sortable: false,
    filterOperators: []
  },
  {
    id: "private-note",
    kind: "text",
    binding: "optional",
    nullable: true,
    permission: "sales.tasks.private-note.read",
    sortable: false,
    filterOperators: []
  }
] as const;

const salesTaskFieldStorage = {
  title: "title",
  status: "status",
  "potential-revenue": "potentialRevenue",
  "private-note": "privateNote"
} as const;

const salesTaskFieldIds = new Set(Object.keys(salesTaskFieldStorage));
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

interface SalesPayloadRequest {
  readonly payload: {
    find(options: SalesFindOptions): Promise<SalesFindResult>;
  };
  readonly locale?: string;
  readonly transactionID?: number | string;
}

interface SalesFindOptions {
  readonly collection: "sales-tasks";
  readonly depth: 0;
  readonly overrideAccess: false;
  readonly pagination: true;
  readonly page?: number;
  readonly limit?: number;
  readonly select?: Readonly<Record<string, true>>;
  readonly sort?: string | readonly string[];
  readonly where?: unknown;
  readonly locale?: string;
  readonly user?: { readonly id: string; readonly collection: "users" };
  readonly req?: { readonly locale?: string; readonly transactionID?: number | string };
}

interface SalesFindResult {
  readonly docs: readonly SalesTaskDocument[];
  readonly page?: number;
  readonly totalPages?: number;
  readonly hasNextPage?: boolean;
}

interface SalesTaskDocument {
  readonly id?: string | number;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly potentialRevenue?: unknown;
  readonly privateNote?: unknown;
}

interface SalesTaskScope {
  readonly kind: "sales.tasks";
  readonly where?: unknown;
}

interface DecimalAmount {
  readonly units: bigint;
  readonly scale: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function salesRequest(value: unknown): SalesPayloadRequest {
  if (!isRecord(value) || !isRecord(value.payload) || typeof value.payload.find !== "function") {
    throw new Error("The Sales source requires a capability-scoped Payload request.");
  }
  return value as unknown as SalesPayloadRequest;
}

function scopeWhere(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || value.kind !== "sales.tasks") throw new Error("The Sales source received an invalid record scope.");
  return value.where;
}

function payloadUser(actor: unknown): { readonly id: string; readonly collection: "users" } | undefined {
  if (!isRecord(actor) || !isRecord(actor.effectiveActor)) return undefined;
  const effectiveActor = actor.effectiveActor;
  return effectiveActor.kind === "user" && typeof effectiveActor.id === "string"
    ? { id: effectiveActor.id, collection: "users" }
    : undefined;
}

function requestOptions(
  context: DataSourceHandlerRequest,
  options: Omit<SalesFindOptions, "collection" | "depth" | "overrideAccess" | "pagination" | "locale" | "user" | "req">
): SalesFindOptions {
  const request = salesRequest(context.request);
  const base: SalesFindOptions = {
    collection: "sales-tasks" as const,
    depth: 0 as const,
    overrideAccess: false as const,
    pagination: true as const,
    ...options
  };
  const user = payloadUser(context.actor);
  return {
    ...base,
    ...(user === undefined ? {} : { user }),
    ...(request.locale === undefined ? {} : { locale: request.locale }),
    ...(request.locale === undefined && request.transactionID === undefined
      ? {}
      : {
          req: {
            ...(request.locale === undefined ? {} : { locale: request.locale }),
            ...(request.transactionID === undefined ? {} : { transactionID: request.transactionID })
          }
        })
  };
}

function selectedStorageFields(selectedFields: readonly string[]): Readonly<Record<string, true>> {
  const select: Record<string, true> = { id: true };
  const seen = new Set<string>();
  for (const fieldId of selectedFields) {
    if (!salesTaskFieldIds.has(fieldId) || seen.has(fieldId)) throw new Error("The Sales source received an invalid field selection.");
    seen.add(fieldId);
    select[salesTaskFieldStorage[fieldId as keyof typeof salesTaskFieldStorage]] = true;
  }
  return select;
}

function whereClause(field: string, operator: string, value: unknown): Record<string, unknown> {
  const payloadOperator: Record<string, string> = {
    eq: "equals",
    in: "in",
    contains: "contains",
    gt: "greater_than",
    gte: "greater_than_or_equal",
    lt: "less_than",
    lte: "less_than_or_equal"
  };
  const mapped = payloadOperator[operator];
  if (mapped === undefined) throw new Error("The Sales source received an unsupported filter operator.");
  return { [field]: { [mapped]: value } };
}

function taskWhere(context: DataSourceHandlerRequest, controls: DataSourceQueryControls): unknown {
  const clauses: unknown[] = [];
  const scoped = scopeWhere(context.recordScope);
  if (scoped !== undefined) clauses.push(scoped);
  for (const filter of controls.filters) {
    const storageField = salesTaskFieldStorage[filter.field as keyof typeof salesTaskFieldStorage];
    const field = salesTaskFields?.find((candidate) => candidate.id === filter.field);
    if (storageField === undefined || field === undefined || !field.filterOperators.includes(filter.operator)) {
      throw new Error("The Sales source received an unknown or disallowed filter.");
    }
    clauses.push(whereClause(storageField, filter.operator, filter.value));
  }
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : { and: clauses };
}

function taskSort(controls: DataSourceQueryControls): readonly string[] {
  if (controls.sort.length === 0) return ["id"];
  return [...controls.sort.map((sort) => {
    const storageField = salesTaskFieldStorage[sort.field as keyof typeof salesTaskFieldStorage];
    const field = salesTaskFields?.find((candidate) => candidate.id === sort.field);
    if (storageField === undefined || field === undefined || !field.sortable) throw new Error("The Sales source received an unsupported sort field.");
    return sort.direction === "desc" ? `-${storageField}` : storageField;
  }), "id"];
}

function parseAmount(value: unknown): DecimalAmount {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !decimalPattern.test(text)) throw new Error("Sales revenue values must be canonical decimals.");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  if (fraction.length > 18) throw new Error("Sales revenue scale is too large.");
  const units = BigInt(`${whole}${fraction}`) * (text.startsWith("-") ? -1n : 1n);
  return { units, scale: fraction.length };
}

function addAmounts(left: DecimalAmount, right: DecimalAmount): DecimalAmount {
  const scale = Math.max(left.scale, right.scale);
  return {
    units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale),
    scale
  };
}

function formatAmount(amount: DecimalAmount): string {
  if (amount.units === 0n) return "0";
  const negative = amount.units < 0n;
  const digits = (negative ? -amount.units : amount.units).toString().padStart(amount.scale + 1, "0");
  const split = amount.scale === 0 ? digits : `${digits.slice(0, -amount.scale)}.${digits.slice(-amount.scale)}`;
  return `${negative ? "-" : ""}${split.replace(/\.?0+$/, "")}`;
}

function moneyCell(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const amount = parseAmount(value);
  return { kind: "money", value: formatAmount(amount), currency: "USD", scale: amount.scale };
}

function taskCell(fieldId: string, document: SalesTaskDocument): Record<string, unknown> | null {
  const storageField = salesTaskFieldStorage[fieldId as keyof typeof salesTaskFieldStorage];
  const value = document[storageField as keyof SalesTaskDocument];
  if (fieldId === "potential-revenue") return moneyCell(value);
  if (fieldId === "private-note") {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || value.length === 0) throw new Error("Sales private notes must be non-empty text.");
    return { kind: "text", value };
  }
  if (typeof value !== "string" || value.length === 0) throw new Error(`Sales task ${fieldId} is missing or invalid.`);
  return { kind: fieldId === "title" ? "text" : "status", value };
}

async function findTasks(context: DataSourceHandlerRequest, options: Omit<SalesFindOptions, "collection" | "depth" | "overrideAccess" | "pagination" | "locale" | "user" | "req">): Promise<SalesFindResult> {
  if (context.signal.aborted) throw context.signal.reason;
  return salesRequest(context.request).payload.find(requestOptions(context, options));
}

async function totalPotentialRevenue(context: DataSourceHandlerRequest): Promise<unknown> {
  const documents: SalesTaskDocument[] = [];
  let page = 1;
  let hasNext = true;
  while (hasNext) {
    if (context.signal.aborted) throw context.signal.reason;
    const result = await findTasks(context, {
      page,
      limit: 100,
      select: { id: true, potentialRevenue: true },
      sort: ["id"],
      where: scopeWhere(context.recordScope)
    });
    documents.push(...result.docs);
    if (documents.length > 10_000) throw new Error("Sales revenue aggregation exceeded its bounded row limit.");
    hasNext = result.hasNextPage ?? (result.totalPages !== undefined && page < result.totalPages);
    page += 1;
  }
  let total: DecimalAmount = { units: 0n, scale: 0 };
  for (const document of documents) {
    if (document.potentialRevenue !== null && document.potentialRevenue !== undefined) total = addAmounts(total, parseAmount(document.potentialRevenue));
  }
  return { value: { kind: "money", value: formatAmount(total), currency: "USD", scale: total.scale } };
}

async function tasksTable(context: DataSourceHandlerRequest): Promise<unknown> {
  if (context.query.page === undefined) throw new Error("Sales task table requires server pagination.");
  const selectedFields = [...context.selectedFields];
  const result = await findTasks(context, {
    page: context.query.page.number,
    limit: context.query.page.size,
    select: selectedStorageFields(selectedFields),
    sort: taskSort(context.query),
    where: taskWhere(context, context.query)
  });
  const rows = result.docs.map((document) => {
    if (document.id === undefined || document.id === null || String(document.id).length === 0) throw new Error("Sales task rows require stable IDs.");
    return {
      key: String(document.id),
      values: Object.fromEntries(selectedFields.map((fieldId) => [fieldId, taskCell(fieldId, document)]))
    };
  });
  return {
    fields: selectedFields,
    rows,
    page: {
      number: context.query.page.number,
      pageSize: context.query.page.size,
      hasNext: result.hasNextPage ?? (result.totalPages !== undefined && context.query.page.number < result.totalPages)
    }
  };
}

export const salesTotalPotentialRevenueDescriptor: DataSourceDescriptor = {
  id: "sales.total-potential-revenue",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "metric.scalar", version: 1 },
  sourceSchema: { id: "sales.total-potential-revenue.output", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.revenue.read",
  structuralCompatibilityHash: "sha256:4e20e6c42ce9d3ea887a6b9d18bce800ec0c2d1b3ff2b6357f740374f091e45b",
  presentationMetadataRevision: 1,
  title: "Total potential revenue",
  inputFields: [],
  limits: { ...salesMetricLimits },
  cacheClass: "actor"
};

export const salesTasksDescriptor: DataSourceDescriptor = {
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
  outputFields: salesTaskFields,
  limits: { ...salesSourceLimits },
  cacheClass: "actor"
};

export const salesTotalPotentialRevenueDefinition: DataSourceDefinition = {
  descriptor: salesTotalPotentialRevenueDescriptor,
  inputSchema: zodEmptyObject(),
  outputSchema: MetricScalarSchema
};

export const salesTasksDefinition: DataSourceDefinition = {
  descriptor: salesTasksDescriptor,
  inputSchema: zodEmptyObject(),
  outputSchema: TableRecordsSchema
};

function zodEmptyObject() {
  return {
    safeParse(value: unknown) {
      return isRecord(value) && Object.keys(value).length === 0
        ? { success: true as const, data: {} }
        : { success: false as const, error: new Error("Sales data-source input must be empty.") };
    }
  };
}

export const salesTotalPotentialRevenueHandler: DataSourceHandler = totalPotentialRevenue;
export const salesTasksHandler: DataSourceHandler = tasksTable;

export const salesTasksCollection: CollectionConfig = {
  slug: "sales-tasks",
  access: {
    read: ({ req }) => Boolean(req.user)
  },
  fields: [
    { name: "title", type: "text", required: true },
    {
      name: "status",
      type: "select",
      defaultValue: "open",
      options: [
        { label: "Open", value: "open" },
        { label: "Done", value: "done" }
      ],
      required: true
    },
    { name: "potentialRevenue", type: "text", required: false },
    { name: "privateNote", type: "textarea", required: false }
  ],
  indexes: [{ fields: ["status"] }]
};

export const salesRegistration: PluginRegistration = {
  pluginId: "module.sales",
  contracts: (context) => {
    context.register("dataSources", salesTotalPotentialRevenueDescriptor.id, salesTotalPotentialRevenueDefinition);
    context.register("dataSources", salesTasksDescriptor.id, salesTasksDefinition);
  },
  schema: (context) => context.register("sales.tasks.collection", {
    type: "payload.collection",
    collection: salesTasksCollection
  }),
  dataHandlers: (context) => {
    context.bind("dataSources", salesTotalPotentialRevenueDescriptor.id, salesTotalPotentialRevenueHandler);
    context.bind("dataSources", salesTasksDescriptor.id, salesTasksHandler);
  }
};
