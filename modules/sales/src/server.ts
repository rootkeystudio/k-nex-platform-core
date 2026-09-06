import { createHash } from "node:crypto";

import {
  canonicalJson,
  type RuntimeSchema,
  type DataSourceDefinition,
  type DataSourceQueryControls
} from "@k-nex/contracts";
import { createOutboxRealtimeRelay, writeTransactionalOutboxEvent } from "@k-nex/payload-adapter";
import type {
  ActionDefinition,
  ActionHandler,
  DataSourceHandler,
  DataSourceHandlerRequest,
  PlatformPluginPolicyExecutor
} from "@k-nex/runtime";
import { ActionGatewayError, DataSourceGatewayError, definePluginRegistration, projectSystemSettingsValues } from "@k-nex/runtime";
import type { CollectionConfig } from "payload";
import type { CollectionAfterChangeHook, PayloadRequest } from "payload";

import {
  salesAccountsCollection,
  salesActivitiesCollection,
  salesAttachmentReferencesCollection,
  salesContactsCollection,
  salesLeadsCollection,
  salesNotesCollection,
  salesOpportunitiesCollection as salesOpportunitiesCoreCollection,
  salesPipelinesCollection,
  salesPipelineStagesCollection,
  salesCoreCollectionSlugs,
  salesRelatedRecordTypes,
  salesTasksCollection as salesTasksCoreCollection
} from "./crm-core.js";

import {
  salesCreateTaskToolDescriptor,
  salesCreateTaskInputRuntimeSchema,
  salesCreateTaskOutputRuntimeSchema,
  salesEmptyInputRuntimeSchema,
  salesEventDescriptors,
  salesNavigationDescriptors,
  salesOpportunitiesDescriptor,
  salesOpportunitiesOutputRuntimeSchema,
  salesOpportunityStageInputRuntimeSchema,
  salesOpportunityStageOutputRuntimeSchema,
  salesOpportunityStageUpdateDescriptor,
  salesPageTemplates,
  salesRealtimeTopicDescriptors,
  salesReferenceMetadata,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskFields,
  salesTaskUpdateDescriptor,
  salesTasksDescriptor,
  salesTasksOutputRuntimeSchema,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesUpdateTaskInputRuntimeSchema,
  salesUpdateTaskOutputRuntimeSchema,
  salesWorkspaceSettingsDescriptor,
  type CreateTaskInput,
  type CreateTaskOutput,
  type UpdateOpportunityStageInput,
  type UpdateOpportunityStageOutput,
  type UpdateTaskInput,
  type UpdateTaskOutput
} from "./contracts.js";
import {
  salesCrmActionDescriptors,
  salesCrmPermissionDescriptors,
  salesCrmPermissionPolicyBindings,
  salesCrmRoleTemplates,
  salesCrmRouteDescriptors
} from "./crm-authority.js";
import { salesUiBlockDefinitions, salesUiComponentDefinitions } from "./ui.js";

export {
  salesCreateTaskToolDescriptor,
  salesNavigationDescriptors,
  salesReferenceMetadata,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  salesWorkspaceSettingsDescriptor
} from "./contracts.js";
export {
  salesCrmActionDescriptors,
  salesCrmObjectFieldActionMatrix,
  salesCrmPermissionDescriptors,
  salesCrmPermissionPolicyBindings,
  salesCrmRoleTemplates,
  salesCrmRouteDescriptors
} from "./crm-authority.js";

const salesTaskFieldStorage = {
  title: "title",
  status: "status"
} as const;

const salesTaskFieldIds = new Set(Object.keys(salesTaskFieldStorage));
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

interface SalesPayloadRequest {
  readonly payload: {
    find(options: SalesFindOptions): Promise<SalesFindResult>;
    create(options: SalesCreateOptions): Promise<SalesCreatedTask>;
    update(options: SalesUpdateOptions): Promise<SalesUpdatedRecord>;
    update(options: SalesConditionalUpdateOptions): Promise<SalesConditionalUpdateResult>;
  };
  readonly locale?: string;
  readonly transactionID?: number | string;
}

interface SalesFindOptions {
  readonly collection: "sales-tasks" | "sales-opportunities";
  readonly depth: 0;
  readonly overrideAccess: true;
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
  readonly docs: readonly (SalesTaskDocument | SalesOpportunityDocument)[];
  readonly page?: number;
  readonly totalPages?: number;
  readonly hasNextPage?: boolean;
}

interface SalesTaskDocument {
  readonly id?: string | number;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly revision?: unknown;
  readonly audit?: unknown;
}

interface SalesOpportunityDocument {
  readonly id?: string | number;
  readonly name?: unknown;
  readonly stageId?: unknown;
  readonly amount?: unknown;
  readonly currency?: unknown;
  readonly revision?: unknown;
  readonly audit?: unknown;
}

interface SalesCreateOptions {
  readonly collection: "sales-tasks";
  readonly data: {
    readonly title: string;
    readonly status: "open" | "completed" | "cancelled";
    readonly applicationId: string;
    readonly environment: string;
    readonly ownerId: string;
    readonly teamId?: string;
    readonly createdBy: string;
    readonly updatedBy: string;
    readonly revision: number;
    readonly audit: readonly Readonly<Record<string, unknown>>[];
    readonly archiveStatus: "active";
  };
  readonly depth: 0;
  readonly overrideAccess: true;
  readonly user?: { readonly id: string; readonly collection: "users" };
  readonly req: SalesPayloadRequest;
  readonly context: { readonly kNexSalesEvent?: SalesEventContext };
}

interface SalesCreatedTask {
  readonly id?: string | number;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly revision?: unknown;
  readonly audit?: unknown;
}

interface SalesUpdateOptions {
  readonly collection: "sales-tasks" | "sales-opportunities";
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly depth: 0;
  readonly overrideAccess: true;
  readonly user?: { readonly id: string; readonly collection: "users" };
  readonly req: SalesPayloadRequest;
  readonly context: { readonly kNexSalesEvent: SalesEventContext };
}

interface SalesConditionalUpdateOptions extends Omit<SalesUpdateOptions, "id"> {
  readonly collection: "sales-tasks" | "sales-opportunities";
  readonly where: unknown;
}

interface SalesUpdatedRecord {
  readonly id?: string | number;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly name?: unknown;
  readonly stageId?: unknown;
  readonly revision?: unknown;
}

interface SalesConditionalUpdateResult {
  readonly docs: readonly SalesUpdatedRecord[];
  readonly errors: readonly unknown[];
}

interface SalesTaskScope {
  readonly kind: "sales.tasks";
  readonly where?: unknown;
}

interface SalesWriteAuthorization {
  readonly actionId: string;
  readonly applicationId: string;
  readonly environment: string;
  readonly actorId: string;
  readonly ownerId: string;
  readonly teamId?: string;
  readonly resourceId?: string;
  readonly idempotencyReplay?: unknown;
  readonly eventId?: string;
}

interface SalesEventContext {
  readonly eventId: string;
  readonly type: "sales.event.task-changed" | "sales.event.opportunity-changed";
  readonly transition: SalesAuditEntry;
}

interface SalesAuditEntry {
  readonly actionId: string;
  readonly resourceId: string;
  readonly applicationId: string;
  readonly environment: string;
  readonly fromState: string;
  readonly toState: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly revision: number;
  readonly idempotencyKey: string;
}

function eventContext(type: SalesEventContext["type"], transition: SalesAuditEntry): { readonly kNexSalesEvent: SalesEventContext } {
  return Object.freeze({ kNexSalesEvent: Object.freeze({ eventId: transition.idempotencyKey, type, transition }) });
}

function applicationId(request: PayloadRequest): string {
  const custom = request.payload.config.custom as { readonly kNexApplicationId?: unknown } | undefined;
  if (typeof custom?.kNexApplicationId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(custom.kNexApplicationId)) {
    throw new Error("Sales durable events require a canonical application ID.");
  }
  return custom.kNexApplicationId;
}

export const salesEventAfterChange: CollectionAfterChangeHook = async ({ context, doc, operation, req }) => {
  const event = (context as { readonly kNexSalesEvent?: SalesEventContext }).kNexSalesEvent;
  if (event === undefined) return doc;
  const transition = event.transition;
  const document = isRecord(doc) ? doc : undefined;
  const statusField = event.type === "sales.event.task-changed" ? "status" : "stageId";
  if (document === undefined || String(document.id) !== transition.resourceId || document[statusField] !== transition.toState ||
    document.revision !== transition.revision || document.applicationId !== transition.applicationId || document.environment !== transition.environment) {
    throw new Error("Sales durable event transition does not match the committed record.");
  }
  const occurredAt = transition.occurredAt;
  const retentionUntil = new Date(Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  await writeTransactionalOutboxEvent({
    req,
    event: {
      id: event.eventId,
      type: event.type,
      schemaVersion: 1,
      messageClass: "durable-integration",
      occurredAt,
      applicationId: applicationId(req),
      pluginId: "module.sales",
      actor: { id: transition.actorId, type: "user" },
      correlationId: req.headers.get("x-correlation-id") ?? event.eventId,
      idempotencyKey: event.eventId,
      payload: {
        resourceId: transition.resourceId,
        actionId: transition.actionId,
        environment: transition.environment,
        fromState: transition.fromState,
        toState: transition.toState,
        revision: transition.revision,
        idempotencyKey: transition.idempotencyKey,
        operation
      }
    },
    retentionUntil
  });
  return doc;
};

export function createSalesRealtimeRelay(gateway: Parameters<typeof createOutboxRealtimeRelay>[0]["gateway"]) {
  return createOutboxRealtimeRelay({
    gateway,
    project(event) {
      if (event.pluginId !== "module.sales") return null;
      const topicId = event.type === "sales.event.task-changed" ? "sales.realtime.tasks"
        : event.type === "sales.event.opportunity-changed" ? "sales.realtime.opportunities" : undefined;
      if (topicId === undefined) return null;
      return { topicId, params: {}, message: { sourceId: topicId === "sales.realtime.tasks" ? "sales.tasks" : "sales.opportunities", ...event.payload } };
    }
  });
}

export function salesPipelineAuditJob(input: {
  readonly opportunities: readonly { readonly stage: "qualification" | "discovery" | "proposal" | "negotiation" | "won" | "lost" }[];
  readonly signal: AbortSignal;
}) {
  if (input.signal.aborted) throw input.signal.reason;
  if (!Array.isArray(input.opportunities) || input.opportunities.length > 1_000) throw new Error("Sales pipeline audit input exceeds its bounded contract.");
  const stageCounts = { qualification: 0, discovery: 0, proposal: 0, negotiation: 0, won: 0, lost: 0 };
  for (const opportunity of input.opportunities) {
    if (!Object.hasOwn(stageCounts, opportunity.stage)) throw new Error("Sales pipeline audit received an invalid stage.");
    const stage: keyof typeof stageCounts = opportunity.stage;
    stageCounts[stage] += 1;
  }
  return Object.freeze({ pluginId: "module.sales" as const, jobId: "sales.job.pipeline-audit" as const, stageCounts: Object.freeze(stageCounts) });
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

const salesScopeFields = new Set(["ownerId", "teamId", "status", "stageId", "id"]);

function closedScopePredicate(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 4) return false;
  const entries = Object.entries(value);
  if (entries.length !== 1) return false;
  const [field, condition] = entries[0]!;
  if (field === "and" || field === "or") {
    return Array.isArray(condition) && condition.length > 0 && condition.length <= 32 &&
      condition.every((entry) => closedScopePredicate(entry, depth + 1));
  }
  if (!salesScopeFields.has(field) || !isRecord(condition) || Object.keys(condition).length !== 1) return false;
  if (typeof condition.equals === "string") return condition.equals.length > 0 && condition.equals.length <= 160;
  return field === "teamId" && Array.isArray(condition.in) && condition.in.length > 0 && condition.in.length <= 32 &&
    condition.in.every((teamId) => typeof teamId === "string" && teamId.length > 0 && teamId.length <= 160) &&
    new Set(condition.in).size === condition.in.length;
}

function sourceIdentity(request: unknown): Readonly<{ applicationId: string; environment: string }> {
  const identity = isRecord(request) && isRecord(request.applicationIdentity) ? request.applicationIdentity : undefined;
  if (typeof identity?.applicationId !== "string" || identity.applicationId.length === 0 ||
    typeof identity?.environment !== "string" || identity.environment.length === 0) {
    throw new Error("The Sales source requires an authenticated application and environment identity.");
  }
  return Object.freeze({ applicationId: identity.applicationId, environment: identity.environment });
}

function scopeWhere(value: unknown, identity: Readonly<{ applicationId: string; environment: string }>, expectedKind = "sales.tasks"): unknown {
  if (!isRecord(value) || value.kind !== expectedKind || !isRecord(value.where) || !Array.isArray(value.where.and) ||
    Object.keys(value.where).length !== 1 || value.where.and.length < 2 || value.where.and.length > 32) {
    throw new Error("The Sales source requires a closed application and environment record scope.");
  }
  let application = 0;
  let environment = 0;
  for (const clause of value.where.and) {
    if (isRecord(clause) && isRecord(clause.applicationId) && Object.keys(clause.applicationId).length === 1 && clause.applicationId.equals === identity.applicationId && Object.keys(clause).length === 1) { application += 1; continue; }
    if (isRecord(clause) && isRecord(clause.environment) && Object.keys(clause.environment).length === 1 && clause.environment.equals === identity.environment && Object.keys(clause).length === 1) { environment += 1; continue; }
    if (!closedScopePredicate(clause)) throw new Error("The Sales source requires a closed application and environment record scope.");
  }
  if (application !== 1 || environment !== 1) throw new Error("The Sales source requires a closed application and environment record scope.");
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
    overrideAccess: true as const,
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
  const scoped = scopeWhere(context.recordScope, sourceIdentity(context.request));
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
  if (typeof value !== "string" || !decimalPattern.test(value)) throw new Error("Sales revenue values must be canonical decimals.");
  const text = value;
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

function moneyCell(value: unknown, currency: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    if (currency !== null && currency !== undefined) throw new Error("Sales opportunity amount and currency must be paired.");
    return null;
  }
  if (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency)) throw new Error("Sales opportunity currency is invalid.");
  const amount = parseAmount(value);
  return { kind: "money", value: formatAmount(amount), currency, scale: amount.scale };
}

function taskCell(fieldId: string, document: SalesTaskDocument): Record<string, unknown> | null {
  const storageField = salesTaskFieldStorage[fieldId as keyof typeof salesTaskFieldStorage];
  const value = document[storageField as keyof SalesTaskDocument];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Sales task ${fieldId} is missing or invalid.`);
  return { kind: fieldId === "title" ? "text" : "status", value };
}

async function findTasks(context: DataSourceHandlerRequest, options: Omit<SalesFindOptions, "collection" | "depth" | "overrideAccess" | "pagination" | "locale" | "user" | "req">): Promise<SalesFindResult> {
  if (context.signal.aborted) throw context.signal.reason;
  return salesRequest(context.request).payload.find(requestOptions(context, options));
}

function salesTaskContinuationKey(query: DataSourceQueryControls): string {
  if (query.cursor === undefined) throw new Error("Sales task cursor query is missing.");
  return createHash("sha256").update(canonicalJson({
    source: { id: "sales.tasks", version: 2 },
    filters: query.filters,
    sort: query.sort,
    size: query.cursor.size
  })).digest("hex");
}

function salesTaskCursor(page: number, continuationKey: string): string {
  return Buffer.from(`sales.tasks@2:${continuationKey}:${page}`).toString("base64url");
}

function salesTaskCursorPage(after: string | undefined, continuationKey: string): number {
  if (after === undefined) return 1;
  let value: string;
  try { value = Buffer.from(after, "base64url").toString("utf8"); } catch { throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid."); }
  const match = /^sales\.tasks@2:([0-9a-f]{64}):([1-9][0-9]*)$/u.exec(value);
  if (match === null || match[1] !== continuationKey) throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
  const page = Number(match[2]);
  if (!Number.isSafeInteger(page) || page > 1_000_000) throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
  return page;
}

async function tasksTable(context: DataSourceHandlerRequest): Promise<unknown> {
  if (context.query.page === undefined && context.query.cursor === undefined) throw new Error("Sales task table requires server pagination.");
  if (context.query.cursor?.before !== undefined) throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
  const continuationKey = context.query.cursor === undefined ? undefined : salesTaskContinuationKey(context.query);
  const page = context.query.page?.number ?? salesTaskCursorPage(context.query.cursor?.after, continuationKey!);
  const pageSize = context.query.page?.size ?? context.query.cursor!.size;
  const selectedFields = [...context.selectedFields];
  const result = await findTasks(context, {
    page,
    limit: pageSize,
    select: selectedStorageFields(selectedFields),
    sort: taskSort(context.query),
    where: taskWhere(context, context.query)
  });
  const rows = (result.docs as readonly SalesTaskDocument[]).map((document) => {
    if (document.id === undefined || document.id === null || String(document.id).length === 0) throw new Error("Sales task rows require stable IDs.");
    return {
      key: String(document.id),
      values: Object.fromEntries(selectedFields.map((fieldId) => [fieldId, taskCell(fieldId, document)]))
    };
  });
  const hasNext = result.hasNextPage ?? (result.totalPages !== undefined && page < result.totalPages);
  return {
    fields: selectedFields,
    rows,
    page: {
      number: page,
      pageSize,
      hasNext,
      ...(continuationKey !== undefined && hasNext ? { nextCursor: salesTaskCursor(page + 1, continuationKey) } : {})
    }
  };
}

const opportunityStorage = { name: "name", "stage-id": "stageId", revision: "revision", amount: "amount" } as const;

function opportunityCell(fieldId: string, document: SalesOpportunityDocument): Record<string, unknown> | null {
  const value = document[opportunityStorage[fieldId as keyof typeof opportunityStorage]];
  if (fieldId === "amount") return moneyCell(value, document.currency);
  if (fieldId === "revision") {
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error("Sales opportunity revision is invalid.");
    return { kind: "integer", value };
  }
  if (typeof value !== "string" || value.length === 0) throw new Error(`Sales opportunity ${fieldId} is invalid.`);
  return { kind: fieldId === "stage-id" ? "status" : "text", value };
}

async function opportunitiesTable(context: DataSourceHandlerRequest): Promise<unknown> {
  if (context.query.page === undefined || context.query.filters.length > 0 || context.query.sort.length > 0) {
    throw new Error("Sales opportunities require bounded unfiltered pagination.");
  }
  const selected = [...context.selectedFields];
  if (new Set(selected).size !== selected.length || selected.some((field) => !(field in opportunityStorage))) {
    throw new Error("Sales opportunity field selection is invalid.");
  }
  const base = requestOptions(context, {
    page: context.query.page.number,
    limit: context.query.page.size,
    select: { id: true, ...Object.fromEntries(selected.map((field) => [opportunityStorage[field as keyof typeof opportunityStorage], true])), ...(selected.includes("amount") ? { currency: true } : {}) },
    sort: ["id"],
    where: scopeWhere(context.recordScope, sourceIdentity(context.request), "sales.opportunities")
  });
  const result = await salesRequest(context.request).payload.find({ ...base, collection: "sales-opportunities" });
  const documents = result.docs as readonly SalesOpportunityDocument[];
  return {
    fields: selected,
    rows: documents.map((document) => {
      if (document.id === undefined || document.id === null) throw new Error("Sales opportunity rows require stable IDs.");
      return { key: String(document.id), values: Object.fromEntries(selected.map((field) => [field, opportunityCell(field, document)])) };
    }),
    page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: result.hasNextPage ?? false }
  };
}

function invalidOutput(message: string) {
  return { success: false as const, error: new Error(message) };
}

export const salesTasksDefinition: DataSourceDefinition = {
  descriptor: salesTasksDescriptor,
  inputSchema: salesEmptyInputRuntimeSchema,
  outputSchema: salesTasksOutputRuntimeSchema
};

export const salesOpportunitiesDefinition: DataSourceDefinition = {
  descriptor: salesOpportunitiesDescriptor,
  inputSchema: salesEmptyInputRuntimeSchema,
  outputSchema: salesOpportunitiesOutputRuntimeSchema
};

export const salesTasksHandler: DataSourceHandler = tasksTable;
export const salesOpportunitiesHandler: DataSourceHandler = opportunitiesTable;

export const salesTaskCreateDefinition: ActionDefinition<CreateTaskInput, CreateTaskOutput> = {
  descriptor: salesTaskCreateDescriptor,
  inputSchema: salesCreateTaskInputRuntimeSchema,
  outputSchema: salesCreateTaskOutputRuntimeSchema
};

export const salesTaskUpdateDefinition: ActionDefinition<UpdateTaskInput, UpdateTaskOutput> = {
  descriptor: salesTaskUpdateDescriptor,
  inputSchema: salesUpdateTaskInputRuntimeSchema,
  outputSchema: salesUpdateTaskOutputRuntimeSchema
};

export const salesOpportunityStageUpdateDefinition: ActionDefinition<UpdateOpportunityStageInput, UpdateOpportunityStageOutput> = {
  descriptor: salesOpportunityStageUpdateDescriptor,
  inputSchema: salesOpportunityStageInputRuntimeSchema,
  outputSchema: salesOpportunityStageOutputRuntimeSchema
};

function createTaskRequest(value: unknown): SalesPayloadRequest {
  const request = salesRequest(value);
  if (typeof request.payload.create !== "function") throw new Error("The Sales action requires a capability-scoped Payload request.");
  return request;
}

function updateRequest(value: unknown): SalesPayloadRequest {
  const request = salesRequest(value);
  if (typeof request.payload.update !== "function") throw new Error("The Sales action requires a capability-scoped Payload update request.");
  return request;
}

function writeAuthorization(value: unknown, actionId: string, resourceId?: string): SalesWriteAuthorization {
  const decision = isRecord(value) && isRecord(value.decision) ? value.decision : value;
  if (!isRecord(decision) || decision.actionId !== actionId || typeof decision.applicationId !== "string" || decision.applicationId.length === 0 ||
    typeof decision.environment !== "string" || decision.environment.length === 0 || typeof decision.actorId !== "string" || decision.actorId.length === 0 ||
    typeof decision.ownerId !== "string" || decision.ownerId.length === 0 || decision.teamId !== undefined && (typeof decision.teamId !== "string" || decision.teamId.length === 0) ||
    resourceId !== undefined && decision.resourceId !== resourceId) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales write authorization is invalid.");
  }
  return decision as unknown as SalesWriteAuthorization;
}

function idempotencyReplay<T>(authorization: SalesWriteAuthorization, schema: RuntimeSchema<T>): T | undefined {
  if (!Object.hasOwn(authorization, "idempotencyReplay")) return undefined;
  const parsed = schema.safeParse(authorization.idempotencyReplay);
  if (!parsed.success) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales idempotency replay is invalid.");
  return parsed.data;
}

function durableActionEventId(authorization: SalesWriteAuthorization, idempotencyKey: string | undefined): string | undefined {
  const eventId = authorization.eventId ?? idempotencyKey;
  if (eventId === undefined || !/^[a-z][a-z0-9-]{2,127}$/u.test(eventId)) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action event identity is invalid.");
  }
  return eventId;
}

const maxAuditEntries = 100;
const maxAuditEntryBytes = 4_096;
const maxAuditBytes = 262_144;

function validAuditTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

type AuditCollection = "sales-tasks" | "sales-opportunities";
type AuditIdentity = Readonly<{ resourceId: string; applicationId: string; environment: string; revision: number }>;

function auditCollection(actionId: string): AuditCollection | undefined {
  return actionId === salesTaskCreateDescriptor.id || actionId === salesTaskUpdateDescriptor.id ? "sales-tasks"
    : actionId === salesOpportunityStageUpdateDescriptor.id ? "sales-opportunities" : undefined;
}

function validActionAudit(entry: Readonly<Record<string, unknown>>): entry is Readonly<Record<string, unknown>> & SalesAuditEntry {
  if (!exactKeys(entry, ["actionId", "resourceId", "applicationId", "environment", "fromState", "toState", "occurredAt", "actorId", "revision", "idempotencyKey"]) ||
    typeof entry.actionId !== "string" || typeof entry.resourceId !== "string" || typeof entry.applicationId !== "string" || typeof entry.environment !== "string" ||
    typeof entry.fromState !== "string" || typeof entry.toState !== "string" || typeof entry.occurredAt !== "string" || typeof entry.actorId !== "string" || typeof entry.idempotencyKey !== "string" || typeof entry.revision !== "number" ||
    !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !validAuditTimestamp(entry.occurredAt) ||
    [entry.resourceId, entry.applicationId, entry.environment, entry.actorId, entry.idempotencyKey].some((value) => value.length === 0 || value.length > 160)) return false;
  return entry.actionId === salesTaskCreateDescriptor.id ? entry.revision === 1 && entry.fromState === "absent" && entry.toState === "open"
    : entry.actionId === salesTaskUpdateDescriptor.id ? entry.fromState === "open" && ["completed", "cancelled"].includes(entry.toState)
      : entry.actionId === salesOpportunityStageUpdateDescriptor.id ? ({ qualification: "discovery", discovery: "proposal", proposal: "negotiation" } as Record<string, string>)[entry.fromState] === entry.toState
        : false;
}

function validMigrationAudit(entry: Readonly<Record<string, unknown>>, collection: AuditCollection): boolean {
  return entry.kind === "phase-13-legacy-upgrade" && typeof entry.receiptDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(entry.receiptDigest) &&
    (collection === "sales-tasks" ? exactKeys(entry, ["kind", "receiptDigest"])
      : exactKeys(entry, ["kind", "receiptDigest", "legacyStage"]) && typeof entry.legacyStage === "string" && entry.legacyStage.length > 0 && entry.legacyStage.length <= 64);
}

function migrationState(entry: Readonly<Record<string, unknown>>, collection: AuditCollection): string | undefined {
  if (!validMigrationAudit(entry, collection)) return undefined;
  if (collection === "sales-tasks") return "open";
  return ({ lead: "qualification", qualified: "discovery", won: "won", lost: "lost" } as Record<string, string>)[entry.legacyStage as string];
}

function validatedAuditHistory(value: unknown, collection: AuditCollection, identity?: AuditIdentity): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxAuditEntries) {
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
  }
  let bytes = 0;
  let migrationSeen = false;
  let migration: Readonly<Record<string, unknown>> | undefined;
  let priorAction: SalesAuditEntry | undefined;
  const actionIdempotencyKeys = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || !(validMigrationAudit(entry, collection) || validActionAudit(entry))) {
      throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
    }
    if (validMigrationAudit(entry, collection)) {
      if (index !== 0 || migrationSeen) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
      migrationSeen = true;
      migration = entry;
    } else {
      const action = validActionAudit(entry) ? entry : undefined;
      const expectedRevision = priorAction === undefined ? migrationSeen ? 2 : 1 : priorAction.revision + 1;
      if (action === undefined || auditCollection(action.actionId) !== collection || actionIdempotencyKeys.has(action.idempotencyKey) ||
        action.revision !== expectedRevision || priorAction === undefined && !migrationSeen && !(collection === "sales-tasks" && action.actionId === salesTaskCreateDescriptor.id) ||
        priorAction === undefined && migration !== undefined && action.fromState !== migrationState(migration, collection) ||
        priorAction !== undefined && (action.fromState !== priorAction.toState || action.resourceId !== priorAction.resourceId || action.applicationId !== priorAction.applicationId || action.environment !== priorAction.environment) ||
        identity !== undefined && (action.resourceId !== identity.resourceId || action.applicationId !== identity.applicationId || action.environment !== identity.environment || action.revision > identity.revision)) {
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
      }
      actionIdempotencyKeys.add(action.idempotencyKey);
      priorAction = action as unknown as SalesAuditEntry;
    }
    let serialized: string;
    try { serialized = canonicalJson(entry); } catch { throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid."); }
    const entryBytes = Buffer.byteLength(serialized);
    if (entryBytes > maxAuditEntryBytes || (bytes += entryBytes) > maxAuditBytes) {
      throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history exceeds its bounded contract.");
    }
  }
  return value as readonly Readonly<Record<string, unknown>>[];
}

function auditEntry(
  authorization: SalesWriteAuthorization,
  actionId: string,
  resourceId: string,
  revision: number,
  fromState: string,
  toState: string,
  idempotencyKey: string | undefined,
  occurredAt = new Date().toISOString()
): SalesAuditEntry {
  if (idempotencyKey === undefined || idempotencyKey.length === 0 || !validAuditTimestamp(occurredAt) ||
    resourceId.length === 0 || fromState.length === 0 || toState.length === 0 || !Number.isSafeInteger(revision) || revision < 1) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales audit evidence is invalid.");
  }
  return Object.freeze({ actionId, resourceId, applicationId: authorization.applicationId, environment: authorization.environment,
    fromState, toState, occurredAt, actorId: authorization.actorId, revision, idempotencyKey });
}

function appendAudit(history: readonly Readonly<Record<string, unknown>>[], entry: SalesAuditEntry): readonly Readonly<Record<string, unknown>>[] {
  const collection = auditCollection(entry.actionId);
  if (collection === undefined) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
  const validated = validatedAuditHistory(history, collection);
  if (validated.length >= maxAuditEntries || validated.some((prior) => prior.idempotencyKey === entry.idempotencyKey)) {
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history cannot append this action.");
  }
  const appended = Object.freeze([...validated, entry as unknown as Readonly<Record<string, unknown>>]);
  validatedAuditHistory(appended, collection);
  return appended;
}

function mutationWhere(authorization: SalesWriteAuthorization, id: string, expectedRevision: number, state?: { readonly field: "status" | "stageId"; readonly value: string }) {
  return { and: [
    { id: { equals: id } },
    { applicationId: { equals: authorization.applicationId } },
    { environment: { equals: authorization.environment } },
    { ownerId: { equals: authorization.ownerId } },
    ...(authorization.teamId === undefined ? [] : [{ teamId: { equals: authorization.teamId } }]),
    ...(state === undefined ? [] : [{ [state.field]: { equals: state.value } }]),
    { revision: { equals: expectedRevision } }
  ] };
}

async function auditForMutation(
  request: SalesPayloadRequest,
  collection: "sales-tasks" | "sales-opportunities",
  where: unknown,
  user: { readonly id: string; readonly collection: "users" } | undefined,
  expectedState: string
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const result = await request.payload.find({
    collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1,
    select: { id: true, revision: true, audit: true }, sort: ["id"], where,
    ...(user === undefined ? {} : { user }), req: request
  });
  if (result.docs.length !== 1) {
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales record changed before the update.");
  }
  const document = result.docs[0]!;
  const revision = document.revision;
  if (!Number.isSafeInteger(revision)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record revision is invalid.");
  const currentRevision = revision as number;
  if (currentRevision < 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record revision is invalid.");
  const history = validatedAuditHistory(document.audit, collection, {
    resourceId: String(document.id), applicationId: String((where as { and?: readonly unknown[] }).and?.[1] && (where as { and: readonly { applicationId?: { equals?: unknown } }[] }).and[1]?.applicationId?.equals),
    environment: String((where as { and?: readonly unknown[] }).and?.[2] && (where as { and: readonly { environment?: { equals?: unknown } }[] }).and[2]?.environment?.equals), revision: currentRevision
  });
  const lastAction = history.findLast(validActionAudit);
  const migrationOrigin = lastAction === undefined && history.length === 1 && isRecord(history[0]) && validMigrationAudit(history[0], collection) && currentRevision === 1;
  if (lastAction !== undefined ? lastAction.revision !== currentRevision || lastAction.toState !== expectedState : !migrationOrigin || migrationState(history[0]!, collection) !== expectedState) {
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is not current.");
  }
  return history;
}

export const salesTaskCreateHandler: ActionHandler<CreateTaskInput, CreateTaskOutput> = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
  if (signal.aborted) throw signal.reason;
  const parsed = salesCreateTaskInputRuntimeSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;
  const payloadRequest = createTaskRequest(request);
  const user = payloadUser(actor);
  const authorization = writeAuthorization(authorizationContext, salesTaskCreateDescriptor.id);
  const replay = idempotencyReplay(authorization, salesCreateTaskOutputRuntimeSchema);
  if (replay !== undefined) return replay;
  const eventId = durableActionEventId(authorization, idempotencyKey);
  const occurredAt = new Date().toISOString();
  const created = await payloadRequest.payload.create({
    collection: "sales-tasks",
    data: {
      title: parsed.data.title,
      status: "open",
      applicationId: authorization.applicationId,
      environment: authorization.environment,
      ownerId: authorization.actorId,
      ...(authorization.teamId === undefined ? {} : { teamId: authorization.teamId }),
      createdBy: authorization.actorId,
      updatedBy: authorization.actorId,
      revision: 1,
      audit: [],
      archiveStatus: "active"
    },
    depth: 0,
    overrideAccess: true,
    ...(user === undefined ? {} : { user }),
    req: payloadRequest,
    context: Object.freeze({})
  });
  if (signal.aborted) throw signal.reason;
  if (created.id === undefined || created.id === null || typeof created.title !== "string" ||
    created.title.length < 1 || created.title.length > 256 ||
    !["open", "completed", "cancelled"].includes(created.status as string) || created.revision !== 1) {
    throw new Error("Sales task creation returned an invalid task.");
  }
  const resourceId = String(created.id);
  const transition = auditEntry(authorization, salesTaskCreateDescriptor.id, resourceId, 1, "absent", "open", eventId, occurredAt);
  const finalized = await payloadRequest.payload.update({
    collection: "sales-tasks", id: resourceId,
    data: { audit: [transition] }, depth: 0, overrideAccess: true,
    ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext("sales.event.task-changed", transition)
  });
  if (String(finalized.id) !== resourceId || finalized.status !== "open" || finalized.revision !== 1) {
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales task changed before audit finalization.");
  }
  return { id: resourceId, title: created.title, status: created.status as CreateTaskOutput["status"], revision: created.revision as number };
};

export const salesTaskUpdateHandler: ActionHandler<UpdateTaskInput, UpdateTaskOutput> = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
  if (signal.aborted) throw signal.reason;
  const parsed = salesUpdateTaskInputRuntimeSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;
  const payloadRequest = updateRequest(request);
  const user = payloadUser(actor);
  const authorization = writeAuthorization(authorizationContext, salesTaskUpdateDescriptor.id, parsed.data.id);
  const replay = idempotencyReplay(authorization, salesUpdateTaskOutputRuntimeSchema);
  if (replay !== undefined) return replay;
  const eventId = durableActionEventId(authorization, idempotencyKey);
  const revision = parsed.data.expectedRevision + 1;
  const where = mutationWhere(authorization, parsed.data.id, parsed.data.expectedRevision, { field: "status", value: parsed.data.expectedStatus });
  const audit = await auditForMutation(payloadRequest, "sales-tasks", where, user, parsed.data.expectedStatus);
  const transition = auditEntry(authorization, salesTaskUpdateDescriptor.id, parsed.data.id, revision, parsed.data.expectedStatus, parsed.data.status, eventId);
  const update = await payloadRequest.payload.update({
    collection: "sales-tasks",
    where,
    data: { status: parsed.data.status, updatedBy: authorization.actorId, revision, audit: appendAudit(audit, transition) },
    depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest,
    context: eventContext("sales.event.task-changed", transition)
  });
  if (update.errors.length > 0 || update.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales task changed before the update.");
  const updated = update.docs[0]!;
  const result = { id: String(updated.id), title: updated.title, status: updated.status, revision: updated.revision };
  const validated = salesUpdateTaskOutputRuntimeSchema.safeParse(result);
  if (!validated.success) throw validated.error;
  return validated.data;
};

export const salesOpportunityStageUpdateHandler: ActionHandler<UpdateOpportunityStageInput, UpdateOpportunityStageOutput> = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
  if (signal.aborted) throw signal.reason;
  const parsed = salesOpportunityStageInputRuntimeSchema.safeParse(input);
  if (!parsed.success) throw parsed.error;
  const payloadRequest = updateRequest(request);
  const user = payloadUser(actor);
  const authorization = writeAuthorization(authorizationContext, salesOpportunityStageUpdateDescriptor.id, parsed.data.id);
  const replay = idempotencyReplay(authorization, salesOpportunityStageOutputRuntimeSchema);
  if (replay !== undefined) return replay;
  const eventId = durableActionEventId(authorization, idempotencyKey);
  const revision = parsed.data.expectedRevision + 1;
  const where = mutationWhere(authorization, parsed.data.id, parsed.data.expectedRevision, { field: "stageId", value: parsed.data.expectedStage });
  const audit = await auditForMutation(payloadRequest, "sales-opportunities", where, user, parsed.data.expectedStage);
  const transition = auditEntry(authorization, salesOpportunityStageUpdateDescriptor.id, parsed.data.id, revision, parsed.data.expectedStage, parsed.data.stage, eventId);
  const update = await payloadRequest.payload.update({
    collection: "sales-opportunities",
    where,
    data: { stageId: parsed.data.stage, updatedBy: authorization.actorId, revision, audit: appendAudit(audit, transition) }, depth: 0, overrideAccess: true,
    ...(user === undefined ? {} : { user }), req: payloadRequest,
    context: eventContext("sales.event.opportunity-changed", transition)
  });
  if (update.errors.length > 0 || update.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity changed before the stage update.");
  const updated = update.docs[0]!;
  const result = { id: String(updated.id), name: updated.name, stage: updated.stageId, revision: updated.revision };
  const validated = salesOpportunityStageOutputRuntimeSchema.safeParse(result);
  if (!validated.success) throw validated.error;
  return validated.data;
};

export const salesTasksCollection: CollectionConfig = { ...salesTasksCoreCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesOpportunitiesCollection: CollectionConfig = { ...salesOpportunitiesCoreCollection, hooks: { afterChange: [salesEventAfterChange] } };
export { salesAccountsCollection, salesActivitiesCollection, salesAttachmentReferencesCollection, salesContactsCollection, salesLeadsCollection, salesNotesCollection, salesPipelinesCollection, salesPipelineStagesCollection, salesCoreCollectionSlugs, salesRelatedRecordTypes };
export const salesCoreCollections: readonly CollectionConfig[] = Object.freeze([
  salesAccountsCollection,
  salesContactsCollection,
  salesLeadsCollection,
  salesPipelinesCollection,
  salesPipelineStagesCollection,
  salesActivitiesCollection,
  salesOpportunitiesCollection,
  salesTasksCollection,
  salesNotesCollection,
  salesAttachmentReferencesCollection
]);

export const salesDefaultSettings = projectSystemSettingsValues(salesWorkspaceSettingsDescriptor);

const permissionPolicy = (permissions: readonly string[]): PlatformPluginPolicyExecutor => {
  const executor: PlatformPluginPolicyExecutor = {
    evaluate: (input) => {
      const facts = isRecord(input.facts) ? input.facts : undefined;
      const descriptor = salesCrmPermissionDescriptors.find(({ id }) => id === input.permissionId);
      const recordScope = facts?.recordScope;
      const scopedRecordId = input.scope.kind === "application" ? undefined : input.scope.recordId;
      const teams = Array.isArray(facts?.authorizedTeamIds) && facts.authorizedTeamIds.every((teamId) => typeof teamId === "string" && teamId.length > 0)
        ? facts.authorizedTeamIds as readonly string[] : undefined;
      const scopeMatches = facts !== undefined && scopedRecordId !== undefined &&
        facts.applicationId === input.applicationId && typeof facts.environment === "string" && facts.environment.length > 0 &&
        facts.recordEnvironment === facts.environment && facts.recordId === scopedRecordId && Number.isSafeInteger(facts.salesScopeRevision) && (facts.salesScopeRevision as number) >= 1;
      const collectionScope = facts?.collectionScope === true && scopedRecordId === "collection";
      const validScope = recordScope === "owned-or-assigned-team" || recordScope === "managed-teams-and-own" ||
        recordScope === "application-sales-scope" || recordScope === "explicit-application-or-team-scope";
      const teamAllowed = typeof facts?.teamId === "string" && teams?.includes(facts.teamId) === true;
      const recordAllowed = scopeMatches && validScope && (collectionScope
        ? recordScope === "application-sales-scope" ? facts.applicationWide === true
          : recordScope === "explicit-application-or-team-scope" ? typeof facts.applicationWide === "boolean"
            : facts.applicationWide === false && facts.mutationAllowed === true
        : recordScope === "application-sales-scope" ? facts.applicationWide === true
          : recordScope === "explicit-application-or-team-scope" ? facts.applicationWide === true || teamAllowed
            : facts.applicationWide === false && (facts.ownerId === input.effectiveActor.id || teamAllowed));
      const fieldAllowed = input.scope.kind !== "field" || facts?.fieldId === input.scope.fieldId && facts.fieldAllowed === true;
      const operationAllowed = descriptor?.operation === "read" || facts?.mutationAllowed === true;
      return { schemaVersion: 1, outcome: permissions.includes(input.permissionId) && recordAllowed && fieldAllowed && operationAllowed ? "allow" : "deny" };
    }
  };
  return Object.freeze(executor);
};

/** Static domain policy executors bound by the host to the exact Sales generation. */
export const salesPermissionPolicyExecutors = Object.freeze({
  ...Object.fromEntries([...new Set(salesCrmPermissionPolicyBindings.map(({ policyReference }) => policyReference))].map((policyReference) => [policyReference,
    permissionPolicy(salesCrmPermissionPolicyBindings.filter((binding) => binding.policyReference === policyReference).map(({ permissionId }) => permissionId))]))
});

export const salesRegistration = definePluginRegistration({
  pluginId: "module.sales",
  contracts: (context) => {
    for (const descriptor of salesCrmPermissionDescriptors) context.register("permissions", descriptor.id, descriptor);
    for (const binding of salesCrmPermissionPolicyBindings) context.register("policyBindings", binding.id, binding);
    for (const template of salesCrmRoleTemplates) context.register("roleTemplates", template.id, template);
    context.register("settings", salesWorkspaceSettingsDescriptor.id, salesWorkspaceSettingsDescriptor);
    context.register("sources", salesTasksDescriptor.id, salesTasksDefinition);
    context.register("sources", salesOpportunitiesDescriptor.id, salesOpportunitiesDefinition);
    context.register("actions", salesTaskCreateDescriptor.id, salesTaskCreateDefinition);
    context.register("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateDefinition);
    context.register("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateDefinition);
    context.register("tools", salesSearchTasksDescriptor.id, salesSearchTasksDescriptor);
    context.register("tools", salesCreateTaskToolDescriptor.id, salesCreateTaskToolDescriptor);
    for (const descriptor of salesEventDescriptors) context.register("events", descriptor.id, descriptor);
    for (const descriptor of salesRealtimeTopicDescriptors) context.register("realtimeTopics", descriptor.id, descriptor);
  },
  schema: (context) => {
    const collections = [
      ["sales.accounts.collection", salesAccountsCollection],
      ["sales.contacts.collection", salesContactsCollection],
      ["sales.leads.collection", salesLeadsCollection],
      ["sales.pipelines.collection", salesPipelinesCollection],
      ["sales.pipeline-stages.collection", salesPipelineStagesCollection],
      ["sales.activities.collection", salesActivitiesCollection],
      ["sales.opportunities.collection", salesOpportunitiesCollection],
      ["sales.tasks.collection", salesTasksCollection],
      ["sales.notes.collection", salesNotesCollection],
      ["sales.attachment-references.collection", salesAttachmentReferencesCollection]
    ] as const;
    for (const [id, collection] of collections) context.register("schema", id, { type: "payload.collection", collection });
    context.register("migrations", salesReferenceMetadata.migration.id, salesReferenceMetadata.migration);
  },
  behavior: (context) => {
    context.register("services", salesReferenceMetadata.service.id, salesReferenceMetadata.service);
    context.register("lifecycle", salesReferenceMetadata.lifecycle.id, salesReferenceMetadata.lifecycle);
  },
  jobs: (context) => {
    context.register("jobs", salesReferenceMetadata.job.id, salesReferenceMetadata.job);
    context.bind(salesReferenceMetadata.job.id, salesPipelineAuditJob as (...args: never[]) => unknown);
  },
  dataHandlers: (context) => {
    context.bind("sources", salesTasksDescriptor.id, salesTasksHandler);
    context.bind("sources", salesOpportunitiesDescriptor.id, salesOpportunitiesHandler);
    context.bind("actions", salesTaskCreateDescriptor.id, salesTaskCreateHandler as ActionHandler);
    context.bind("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateHandler as ActionHandler);
    context.bind("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateHandler as ActionHandler);
    for (const descriptor of salesEventDescriptors) context.bind("events", descriptor.id, salesEventAfterChange as (...args: never[]) => unknown);
    for (const descriptor of salesRealtimeTopicDescriptors) context.bind("realtimeTopics", descriptor.id, createSalesRealtimeRelay as (...args: never[]) => unknown);
  },
  ui: (context) => {
    for (const descriptor of salesUiComponentDescriptors) context.register("components", descriptor.id, descriptor);
    for (const descriptor of salesUiBlockDescriptors) context.register("blocks", descriptor.id, descriptor);
    for (const descriptor of salesRouteDescriptors) context.register("routes", descriptor.id, descriptor);
    for (const descriptor of salesNavigationDescriptors) context.register("navigation", descriptor.id, descriptor);
    for (const descriptor of salesPageTemplates) context.register("pageTemplates", descriptor.id, descriptor);
    for (const definition of salesUiComponentDefinitions) context.bindRenderer("components", definition.id, definition.render);
    for (const definition of salesUiBlockDefinitions) context.bindRenderer("blocks", definition.id, definition.render);
    context.register("localization", salesReferenceMetadata.localization.id, salesReferenceMetadata.localization);
  },
  validate: (context) => {
    context.register("healthAudit", salesReferenceMetadata.health.id, salesReferenceMetadata.health);
    context.register("testingMetadata", salesReferenceMetadata.testing.id, salesReferenceMetadata.testing);
  }
});
