import {
  MetricScalarSchema,
  TableRecordsSchema,
  type RuntimeSchema,
  type DataSourceDefinition,
  type DataSourceQueryControls,
  type PluginSettingValue
} from "@k-nex/contracts";
import type {
  ActionDefinition,
  ActionHandler,
  DataSourceHandler,
  DataSourceHandlerRequest,
  PluginSettingsRuntimeDefinition
} from "@k-nex/runtime";
import { definePluginRegistration, resolvePluginSettings } from "@k-nex/runtime";
import type { CollectionConfig } from "payload";

import {
  salesCreateTaskToolDescriptor,
  salesNavigationDescriptors,
  salesPermissionDescriptors,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskPageTemplate,
  salesTaskFields,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor,
  salesWorkspaceSettingsDescriptor,
  type CreateTaskInput,
  type CreateTaskOutput
} from "./contracts.js";

export {
  salesCreateTaskToolDescriptor,
  salesNavigationDescriptors,
  salesPermissionDescriptors,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor,
  salesWorkspaceSettingsDescriptor
} from "./contracts.js";

const salesTaskFieldStorage = {
  title: "title",
  status: "status",
  "potential-revenue": "potentialRevenue",
  "private-note": "privateNote"
} as const;

const salesTaskFieldIds = new Set(Object.keys(salesTaskFieldStorage));
const salesRequiredTaskFieldIds = new Set(
  salesTaskFields?.filter((field) => field.binding === "required").map((field) => field.id) ?? []
);
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

interface SalesPayloadRequest {
  readonly payload: {
    find(options: SalesFindOptions): Promise<SalesFindResult>;
    create(options: SalesCreateOptions): Promise<SalesCreatedTask>;
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

interface SalesCreateOptions {
  readonly collection: "sales-tasks";
  readonly data: {
    readonly title: string;
    readonly status?: "open" | "done";
    readonly potentialRevenue?: string;
    readonly privateNote?: string;
  };
  readonly depth: 0;
  readonly overrideAccess: false;
  readonly user?: { readonly id: string; readonly collection: "users" };
  readonly req: SalesPayloadRequest;
}

interface SalesCreatedTask {
  readonly id?: string | number;
  readonly title?: unknown;
  readonly status?: unknown;
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
  if (amount.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const integer = digits.slice(0, -amount.scale);
  const fraction = digits.slice(-amount.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction.length === 0 ? "" : `.${fraction}`}`;
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

function invalidOutput(message: string) {
  return { success: false as const, error: new Error(message) };
}

const salesTotalPotentialRevenueOutputSchema = {
  safeParse(value: unknown) {
    const parsed = MetricScalarSchema.safeParse(value);
    if (!parsed.success) return parsed;
    if (Object.keys(parsed.data).join("\u0000") !== "value") return invalidOutput("Sales revenue metrics cannot include comparisons.");
    const metricValue = parsed.data.value;
    if (metricValue.kind !== "money" || metricValue.currency !== "USD") {
      return invalidOutput("Sales revenue metrics must be USD money values.");
    }
    if (Object.keys(metricValue).some((key) => key === "rounding")) {
      return invalidOutput("Sales revenue metrics must use the source money shape.");
    }
    return parsed;
  }
};

function exactTaskCell(fieldId: string, cell: unknown): boolean {
  const field = salesTaskFields?.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return false;
  if (cell === null) return field.nullable;
  if (!isRecord(cell) || cell.kind !== field.kind) return false;
  const expectedKeys = field.kind === "money"
    ? ["kind", "value", "currency", "scale"]
    : ["kind", "value"];
  if (Object.keys(cell).join("\u0000") !== expectedKeys.join("\u0000")) return false;
  if (!field.nullable && cell.value === null) return false;
  if (fieldId === "potential-revenue" && cell.currency !== "USD") return false;
  if (fieldId === "status" && cell.value !== "open" && cell.value !== "done") return false;
  return true;
}

const salesTasksOutputSchema = {
  safeParse(value: unknown) {
    const parsed = TableRecordsSchema.safeParse(value);
    if (!parsed.success) return parsed;
    const { fields, rows } = parsed.data;
    if (fields.some((fieldId) => !salesTaskFieldIds.has(fieldId)) || [...salesRequiredTaskFieldIds].some((fieldId) => !fields.includes(fieldId))) {
      return invalidOutput("Sales task output fields do not match the source descriptor.");
    }
    for (const row of rows) {
      const valueKeys = Object.keys(row.values);
      if (valueKeys.join("\u0000") !== fields.join("\u0000")) {
        return invalidOutput("Sales task rows must contain the selected fields in source order.");
      }
      for (const fieldId of fields) {
        if (!exactTaskCell(fieldId, row.values[fieldId])) {
          return invalidOutput("Sales task row cells do not match the source descriptor.");
        }
      }
    }
    return parsed;
  }
};

export const salesTotalPotentialRevenueDefinition: DataSourceDefinition = {
  descriptor: salesTotalPotentialRevenueDescriptor,
  inputSchema: zodEmptyObject(),
  outputSchema: salesTotalPotentialRevenueOutputSchema
};

export const salesTasksDefinition: DataSourceDefinition = {
  descriptor: salesTasksDescriptor,
  inputSchema: zodEmptyObject(),
  outputSchema: salesTasksOutputSchema
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

const salesCreateTaskInputRuntimeSchema: RuntimeSchema<CreateTaskInput> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || Object.keys(value).some((key) => !["title", "status", "potentialRevenue", "privateNote"].includes(key))) {
      return invalidOutput("Sales task input must be a closed object.");
    }
    if (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256) {
      return invalidOutput("Sales task titles must be non-empty text up to 256 characters.");
    }
    if (value.status !== undefined && value.status !== "open" && value.status !== "done") {
      return invalidOutput("Sales task status must be open or done.");
    }
    if (value.potentialRevenue !== undefined && (typeof value.potentialRevenue !== "string" || value.potentialRevenue.length < 1 || value.potentialRevenue.length > 64)) {
      return invalidOutput("Sales task revenue must be a bounded decimal string.");
    }
    if (value.privateNote !== undefined && (typeof value.privateNote !== "string" || value.privateNote.length < 1 || value.privateNote.length > 4_096)) {
      return invalidOutput("Sales task private notes must be bounded non-empty text.");
    }
    if (value.potentialRevenue !== undefined) {
      try {
        parseAmount(value.potentialRevenue);
      } catch {
        return invalidOutput("Sales task revenue must be a canonical decimal.");
      }
    }
    return {
      success: true as const,
      data: {
        title: value.title,
        ...(value.status === undefined ? {} : { status: value.status }),
        ...(value.potentialRevenue === undefined ? {} : { potentialRevenue: value.potentialRevenue }),
        ...(value.privateNote === undefined ? {} : { privateNote: value.privateNote })
      }
    };
  }
};

const salesCreateTaskOutputRuntimeSchema: RuntimeSchema<CreateTaskOutput> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000status\u0000title") {
      return invalidOutput("Sales task action output has an invalid shape.");
    }
    if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) {
      return invalidOutput("Sales task action output requires a stable ID.");
    }
    if (typeof value.title !== "string" || value.title.length === 0 || value.title.length > 256) {
      return invalidOutput("Sales task action output requires a task title.");
    }
    if (value.status !== "open" && value.status !== "done") {
      return invalidOutput("Sales task action output requires a valid status.");
    }
    return { success: true as const, data: value as unknown as CreateTaskOutput };
  }
};

export const salesTaskCreateDefinition: ActionDefinition<CreateTaskInput, CreateTaskOutput> = {
  descriptor: salesTaskCreateDescriptor,
  inputSchema: salesCreateTaskInputRuntimeSchema,
  outputSchema: salesCreateTaskOutputRuntimeSchema
};

function createTaskRequest(value: unknown): SalesPayloadRequest {
  const request = salesRequest(value);
  if (typeof request.payload.create !== "function") throw new Error("The Sales action requires a capability-scoped Payload request.");
  return request;
}

export const salesTaskCreateHandler: ActionHandler<CreateTaskInput, CreateTaskOutput> = async ({ actor, request, input, signal }) => {
  if (signal.aborted) throw signal.reason;
  const parsed = salesCreateTaskInputRuntimeSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;
  const payloadRequest = createTaskRequest(request);
  const user = payloadUser(actor);
  const created = await payloadRequest.payload.create({
    collection: "sales-tasks",
    data: parsed.data,
    depth: 0,
    overrideAccess: false,
    ...(user === undefined ? {} : { user }),
    req: payloadRequest
  });
  if (signal.aborted) throw signal.reason;
  if (created.id === undefined || created.id === null || typeof created.title !== "string" ||
    created.title.length < 1 || created.title.length > 256 ||
    created.status !== "open" && created.status !== "done") {
    throw new Error("Sales task creation returned an invalid task.");
  }
  return { id: String(created.id), title: created.title, status: created.status };
};

export const salesTasksCollection: CollectionConfig = {
  slug: "sales-tasks",
  access: {
    create: ({ req }) => req.user?.collection === "users",
    delete: ({ req }) => req.user?.collection === "users",
    read: ({ req }) => req.user?.collection === "users",
    update: ({ req }) => req.user?.collection === "users"
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

type SalesWorkspaceSettings = Readonly<Record<string, PluginSettingValue>>;

export const salesWorkspaceSettingsDefinition: PluginSettingsRuntimeDefinition<SalesWorkspaceSettings> = {
  descriptor: salesWorkspaceSettingsDescriptor,
  migrations: [],
  schema: {
    safeParse(value: unknown) {
      if (!isRecord(value) || Object.keys(value).sort().join("\u0000") !== "defaultTaskPageSize\u0000showPotentialRevenue" ||
        !Number.isSafeInteger(value.defaultTaskPageSize) || Number(value.defaultTaskPageSize) < 1 || Number(value.defaultTaskPageSize) > 100 ||
        typeof value.showPotentialRevenue !== "boolean") {
        return invalidOutput("Sales workspace settings must match the strict current schema.");
      }
      return { success: true as const, data: value as SalesWorkspaceSettings };
    }
  }
};

export const salesDefaultSettings = resolvePluginSettings(salesWorkspaceSettingsDefinition);

export const salesRegistration = definePluginRegistration({
  pluginId: "module.sales",
  contracts: (context) => {
    for (const descriptor of salesPermissionDescriptors) context.register("permissions", descriptor.id, descriptor);
    context.register("settings", salesWorkspaceSettingsDescriptor.id, salesWorkspaceSettingsDescriptor);
    context.register("sources", salesTotalPotentialRevenueDescriptor.id, salesTotalPotentialRevenueDefinition);
    context.register("sources", salesTasksDescriptor.id, salesTasksDefinition);
    context.register("actions", salesTaskCreateDescriptor.id, salesTaskCreateDefinition);
    context.register("tools", salesSearchTasksDescriptor.id, salesSearchTasksDescriptor);
    context.register("tools", salesCreateTaskToolDescriptor.id, salesCreateTaskToolDescriptor);
  },
  schema: (context) => context.register("schema", "sales.tasks.collection", {
    type: "payload.collection",
    collection: salesTasksCollection
  }),
  dataHandlers: (context) => {
    context.bind("sources", salesTotalPotentialRevenueDescriptor.id, salesTotalPotentialRevenueHandler);
    context.bind("sources", salesTasksDescriptor.id, salesTasksHandler);
    context.bind("actions", salesTaskCreateDescriptor.id, salesTaskCreateHandler as ActionHandler);
  },
  ui: (context) => {
    for (const descriptor of salesRouteDescriptors) context.register("routes", descriptor.id, descriptor);
    for (const descriptor of salesNavigationDescriptors) context.register("navigation", descriptor.id, descriptor);
    context.register("pageTemplates", salesTaskPageTemplate.id, salesTaskPageTemplate);
  }
});
