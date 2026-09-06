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
import { isSalesCalendarDate, salesPhoneMaxLength } from "./crm-authority.js";

import {
  salesAccountDetailDescriptor,
  salesAccountDetailOutputRuntimeSchema,
  salesAccountFields,
  salesAccountsDescriptor,
  salesAccountsOutputRuntimeSchema,
  salesContactDetailDescriptor,
  salesContactDetailOutputRuntimeSchema,
  salesContactFields,
  salesContactsDescriptor,
  salesContactsOutputRuntimeSchema,
  salesCreateTaskToolDescriptor,
  salesCreateTaskInputRuntimeSchema,
  salesCreateTaskOutputRuntimeSchema,
  salesCrmDetailInputRuntimeSchema,
  salesEmptyInputRuntimeSchema,
  salesEventDescriptors,
  salesLeadDetailDescriptor,
  salesLeadDetailFields,
  salesLeadDetailOutputRuntimeSchema,
  salesLeadFields,
  salesLeadsDescriptor,
  salesLeadsOutputRuntimeSchema,
  salesNavigationDescriptors,
  salesOwnershipAssignDescriptor,
  salesOpportunitiesDescriptor,
  salesOpportunitiesOutputRuntimeSchema,
  salesOpportunityStageInputRuntimeSchema,
  salesOpportunityStageOutputRuntimeSchema,
  salesOpportunityStageUpdateDescriptor,
  salesOpportunityDetailDescriptor,
  salesOpportunityDetailFields,
  salesOpportunityDetailOutputRuntimeSchema,
  salesOpportunityFields,
  salesPageTemplates,
  salesRealtimeTopicDescriptors,
  salesReferenceMetadata,
  isSalesRecordId,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskFields,
  salesTaskUpdateDescriptor,
  salesTasksDescriptor,
  salesTasksOutputRuntimeSchema,
  salesTimelineDescriptor,
  salesTimelineFields,
  salesTimelineInputRuntimeSchema,
  salesTimelineOutputRuntimeSchema,
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
  salesTimelineDescriptor,
  salesTimelineFields,
  salesTimelineInputRuntimeSchema,
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
  readonly collection: "sales-tasks" | "sales-opportunities" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-pipelines" | "sales-pipeline-stages" | "sales-activities" | "sales-notes" | "sales-attachment-references";
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
  readonly docs: readonly (SalesTaskDocument | SalesOpportunityDocument | SalesWorkflowDocument)[];
  readonly page?: number;
  readonly totalPages?: number;
  readonly hasNextPage?: boolean;
}

interface SalesTaskDocument {
  readonly id?: string | number;
  readonly createdAt?: unknown;
  readonly dueDate?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly revision?: unknown;
  readonly audit?: unknown;
}

interface SalesOpportunityDocument {
  readonly id?: string | number;
  readonly name?: unknown;
  readonly stageId?: unknown;
  readonly archiveStatus?: unknown;
  readonly amount?: unknown;
  readonly currency?: unknown;
  readonly revision?: unknown;
  readonly audit?: unknown;
}

interface SalesWorkflowDocument {
  readonly id?: string | number;
  readonly createdAt?: unknown;
  readonly applicationId?: unknown;
  readonly environment?: unknown;
  readonly ownerId?: unknown;
  readonly teamId?: unknown;
  readonly name?: unknown;
  readonly displayName?: unknown;
  readonly source?: unknown;
  readonly status?: unknown;
  readonly archiveStatus?: unknown;
  readonly revision?: unknown;
  readonly audit?: unknown;
  readonly accountId?: unknown;
  readonly pipelineId?: unknown;
  readonly isActive?: unknown;
  readonly semantic?: unknown;
  readonly stageId?: unknown;
  readonly email?: unknown;
  readonly phone?: unknown;
  readonly qualifiedAccountId?: unknown;
  readonly qualifiedContactId?: unknown;
  readonly qualifiedOpportunityId?: unknown;
  readonly primaryContactId?: unknown;
  readonly amount?: unknown;
  readonly currency?: unknown;
  readonly expectedCloseDate?: unknown;
  readonly relatedRecordId?: unknown;
  readonly relatedRecordType?: unknown;
  readonly subject?: unknown;
  readonly type?: unknown;
  readonly occurredAt?: unknown;
  readonly scheduledAt?: unknown;
  readonly filename?: unknown;
  readonly mediaType?: unknown;
  readonly supersedesActivity?: unknown;
  readonly body?: unknown;
}

interface SalesCreateOptions {
  readonly collection: "sales-tasks" | "sales-opportunities" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-activities" | "sales-notes" | "sales-attachment-references";
  readonly data: Readonly<Record<string, unknown>>;
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
  readonly collection: "sales-tasks" | "sales-opportunities" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-activities" | "sales-notes" | "sales-attachment-references";
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly depth: 0;
  readonly overrideAccess: true;
  readonly user?: { readonly id: string; readonly collection: "users" };
  readonly req: SalesPayloadRequest;
  readonly context: { readonly kNexSalesEvent?: SalesEventContext };
}

interface SalesConditionalUpdateOptions extends Omit<SalesUpdateOptions, "id"> {
  readonly collection: "sales-tasks" | "sales-opportunities" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-activities" | "sales-notes" | "sales-attachment-references";
  readonly where: unknown;
}

interface SalesUpdatedRecord {
  readonly id?: string | number;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly name?: unknown;
  readonly stageId?: unknown;
  readonly revision?: unknown;
  readonly archiveStatus?: unknown;
  readonly displayName?: unknown;
  readonly qualifiedAccountId?: unknown;
  readonly qualifiedContactId?: unknown;
  readonly qualifiedOpportunityId?: unknown;
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
  /** Host locks prospective ownership facts before this domain mutation. */
  readonly ownershipNewOwnerId?: string;
  readonly ownershipNewTeamId?: string;
  readonly ownershipTeamCleared?: boolean;
  readonly linkedRecordAdmissions?: readonly Readonly<{ recordType: "sales.account" | "sales.contact"; recordId: string; applicationId: string; environment: string }>[];
  readonly protectedFieldAdmissions?: readonly Readonly<{ fieldId: "email" | "phone" | "amount"; permissionId: "sales.contacts.channels.read" | "sales.leads.channels.read" | "sales.opportunities.amount.read" }>[];
  readonly noteReplacementAdmission?: Readonly<{ recordId: string; applicationId: string; environment: string; relatedRecordType: TimelineTargetType; relatedRecordId: string }>;
  readonly resolveAttachmentUpload?: (input: Readonly<{ applicationId: string; environmentId: string; actorId: string; storageRef: string }>) => Promise<unknown>;
}

type SalesEventType =
  | "sales.event.task-changed"
  | "sales.event.opportunity-changed"
  | "sales.event.account-changed"
  | "sales.event.contact-changed"
  | "sales.event.lead-changed"
  | "sales.event.timeline-changed";

interface SalesEventContext {
  readonly eventId: string;
  readonly type: SalesEventType;
  readonly stateField: "status" | "stageId" | "archiveStatus";
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
  readonly ownershipGenesis?: Readonly<{ ownerId: string; teamId: string | null }>;
  readonly ownership?: Readonly<{ oldOwnerId: string; newOwnerId: string; oldTeamId: string | null; newTeamId: string | null }>;
}

function eventContext(type: SalesEventContext["type"], transition: SalesAuditEntry, stateField: SalesEventContext["stateField"] = type === "sales.event.opportunity-changed" ? "stageId" : "status"): { readonly kNexSalesEvent: SalesEventContext } {
  return Object.freeze({ kNexSalesEvent: Object.freeze({ eventId: transition.idempotencyKey, type, stateField, transition }) });
}

function applicationId(request: PayloadRequest): string {
  const custom = request.payload.config.custom as { readonly kNexApplicationId?: unknown } | undefined;
  if (typeof custom?.kNexApplicationId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(custom.kNexApplicationId)) {
    throw new Error("Sales durable events require a canonical application ID.");
  }
  return custom.kNexApplicationId;
}

function salesEventContract(actionId: string, collection: string): Readonly<{ type: SalesEventType; stateField: SalesEventContext["stateField"] }> | undefined {
  if (collection === "sales-tasks" && ["sales.task.create", "sales.task.update"].includes(actionId)) return { type: "sales.event.task-changed", stateField: "status" };
  if (collection === "sales-accounts" && ["sales.account.create", "sales.account.update", "sales.account.archive", "sales.lead.qualify", "sales.ownership.assign"].includes(actionId)) return { type: "sales.event.account-changed", stateField: "status" };
  if (collection === "sales-contacts" && ["sales.contact.create", "sales.contact.update", "sales.contact.archive", "sales.lead.qualify", "sales.ownership.assign"].includes(actionId)) return { type: "sales.event.contact-changed", stateField: "status" };
  if (collection === "sales-leads" && ["sales.lead.create", "sales.lead.update", "sales.lead.qualify", "sales.lead.disqualify", "sales.lead.archive", "sales.ownership.assign"].includes(actionId)) return { type: "sales.event.lead-changed", stateField: actionId === "sales.lead.archive" ? "archiveStatus" : "status" };
  if (collection === "sales-opportunities" && ["sales.opportunity.create", "sales.opportunity.update", "sales.opportunity.stage.update", "sales.opportunity.close", "sales.opportunity.archive", "sales.lead.qualify", "sales.ownership.assign"].includes(actionId)) return { type: "sales.event.opportunity-changed", stateField: actionId === "sales.opportunity.archive" ? "archiveStatus" : "stageId" };
  if (collection === "sales-activities" && ["sales.activity.create", "sales.activity.complete", "sales.activity.cancel"].includes(actionId)) return { type: "sales.event.timeline-changed", stateField: "status" };
  if (collection === "sales-notes" && actionId === "sales.note.create") return { type: "sales.event.timeline-changed", stateField: "status" };
  if (collection === "sales-attachment-references" && ["sales.attachment.link", "sales.attachment.remove"].includes(actionId)) return { type: "sales.event.timeline-changed", stateField: "status" };
  return undefined;
}

export const salesEventAfterChange: CollectionAfterChangeHook = async ({ collection, context, doc, operation, req }) => {
  const event = (context as { readonly kNexSalesEvent?: SalesEventContext }).kNexSalesEvent;
  if (event === undefined) return doc;
  const transition = event.transition;
  const document = isRecord(doc) ? doc : undefined;
  const statusField = event.stateField;
  const audit = document?.audit;
  const lastAudit = Array.isArray(audit) ? audit.at(-1) : undefined;
  const expected = salesEventContract(transition.actionId, collection.slug);
  const auditMatches = Array.isArray(audit) && audit.length === transition.revision && isRecord(lastAudit) && canonicalJson(lastAudit) === canonicalJson(transition);
  if (operation !== "update" || document === undefined || String(document.id) !== transition.resourceId || document[statusField] !== transition.toState || !auditMatches ||
    document.revision !== transition.revision || document.applicationId !== transition.applicationId || document.environment !== transition.environment ||
    event.eventId !== transition.idempotencyKey || applicationId(req) !== transition.applicationId || expected === undefined || expected.type !== event.type || expected.stateField !== statusField) {
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
        : event.type === "sales.event.opportunity-changed" ? "sales.realtime.opportunities"
          : event.type === "sales.event.account-changed" ? "sales.realtime.accounts"
              : event.type === "sales.event.contact-changed" ? "sales.realtime.contacts"
              : event.type === "sales.event.lead-changed" ? "sales.realtime.leads"
                : event.type === "sales.event.timeline-changed" ? "sales.realtime.timeline" : undefined;
      if (topicId === undefined) return null;
      const sourceId = topicId === "sales.realtime.tasks" ? "sales.tasks"
        : topicId === "sales.realtime.opportunities" ? "sales.opportunities"
          : topicId === "sales.realtime.accounts" ? "sales.accounts"
            : topicId === "sales.realtime.contacts" ? "sales.contacts"
            : topicId === "sales.realtime.leads" ? "sales.leads" : "sales.timeline";
      // Realtime is an invalidation channel. The authoritative projection is
      // always re-read through the source boundary; record/state facts stay in
      // the durable outbox and never cross the socket transport.
      return {
        topicId,
        params: {},
        message: {
          correlation: event.correlationId,
          dedupe: event.id,
          event: event.type,
          source: sourceId,
          topic: topicId
        }
      };
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
  const negative = amount.units < 0n;
  const digits = (negative ? -amount.units : amount.units).toString().padStart(amount.scale + 1, "0");
  if (amount.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const integer = digits.slice(0, -amount.scale);
  return `${negative ? "-" : ""}${integer}.${digits.slice(-amount.scale)}`;
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

const crmSourceSpecs = Object.freeze({
  "sales.accounts": { collection: "sales-accounts", fields: salesAccountFields, storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", status: "status", revision: "revision" } },
  "sales.account.detail": { collection: "sales-accounts", fields: salesAccountFields, storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", status: "status", revision: "revision" } },
  "sales.contacts": { collection: "sales-contacts", fields: salesContactFields, storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", status: "status", revision: "revision", email: "email", phone: "phone" } },
  "sales.contact.detail": { collection: "sales-contacts", fields: salesContactFields, storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", status: "status", revision: "revision", email: "email", phone: "phone" } },
  "sales.leads": { collection: "sales-leads", fields: salesLeadFields, storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "archive-status": "archiveStatus", status: "status", revision: "revision", email: "email", phone: "phone" } },
  "sales.lead.detail": { collection: "sales-leads", fields: salesLeadDetailFields, storage: { "display-name": "displayName", source: "source", "owner-id": "ownerId", "team-id": "teamId", "archive-status": "archiveStatus", status: "status", revision: "revision", email: "email", phone: "phone", "decided-at": "decidedAt", "qualified-at": "qualifiedAt", "disqualified-at": "disqualifiedAt", "qualified-account-id": "qualifiedAccountId", "qualified-contact-id": "qualifiedContactId", "qualified-opportunity-id": "qualifiedOpportunityId" } },
  "sales.opportunity.detail": { collection: "sales-opportunities", fields: salesOpportunityDetailFields, storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", "archive-status": "archiveStatus", "account-id": "accountId", "primary-contact-id": "primaryContactId", "pipeline-id": "pipelineId", "stage-id": "stageId", "expected-close-date": "expectedCloseDate", revision: "revision", amount: "amount" } }
} as const);
type CrmSourceId = keyof typeof crmSourceSpecs;

function isCrmSourceId(value: string): value is CrmSourceId { return Object.hasOwn(crmSourceSpecs, value); }
function crmSourceCell(field: { readonly id: string; readonly kind: string; readonly nullable: boolean }, value: unknown, currency?: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) { if (field.nullable) return null; throw new Error(`Sales ${field.id} is absent.`); }
  if (field.kind === "integer") {
    const integer = Number.isSafeInteger(value) ? value : typeof value === "string" && isSalesRecordId(value) ? Number(value) : undefined;
    if (typeof integer !== "number" || !Number.isSafeInteger(integer) || integer < 1) throw new Error(`Sales ${field.id} is invalid.`);
    return { kind: "integer", value: integer };
  }
  if (field.kind === "money") return moneyCell(value, currency);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Sales ${field.id} is invalid.`);
  return { kind: field.kind, value };
}
function crmDetailInput(context: DataSourceHandlerRequest, detail: boolean): string | undefined {
  if (!detail) { const empty = salesEmptyInputRuntimeSchema.safeParse(context.input); if (!empty.success) throw empty.error; return undefined; }
  const parsed = salesCrmDetailInputRuntimeSchema.safeParse(context.input); if (!parsed.success) throw parsed.error; return parsed.data.id;
}
async function crmTable(context: DataSourceHandlerRequest, sourceId: CrmSourceId): Promise<unknown> {
  const spec = crmSourceSpecs[sourceId]; const detail = sourceId.endsWith(".detail"); const id = crmDetailInput(context, detail);
  if (context.query.filters.length > 0 || context.query.sort.length > 0 || context.query.page === undefined || detail && context.query.page.number !== 1) throw new Error("Sales CRM source query is invalid.");
  const selected = [...context.selectedFields];
  if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some((field) => !Object.hasOwn(spec.storage, field))) throw new Error("Sales CRM source field selection is invalid.");
  const identity = sourceIdentity(context.request); const scope = scopeWhere(context.recordScope, identity, sourceId);
  const where = id === undefined ? scope : { and: [scope, { id: { equals: id } }] };
  const request = salesRequest(context.request); const user = payloadUser(context.actor);
  const result = await request.payload.find({ collection: spec.collection, depth: 0, overrideAccess: true, pagination: true, page: context.query.page.number, limit: detail ? 1 : context.query.page.size, select: { id: true, ...Object.fromEntries(selected.map((field) => [spec.storage[field as keyof typeof spec.storage], true])), ...(selected.includes("amount") ? { currency: true } : {}) }, sort: ["id"], where, ...(user === undefined ? {} : { user }), req: request });
  if (detail && result.docs.length > 1) throw new Error("Sales CRM detail source is ambiguous.");
  return { fields: selected, rows: result.docs.map((document) => {
    if (document.id === undefined || document.id === null) throw new Error("Sales CRM source row has no ID.");
    return { key: String(document.id), values: Object.fromEntries(selected.map((field) => [field, crmSourceCell(spec.fields.find((candidate) => candidate.id === field)!, (document as unknown as Record<string, unknown>)[spec.storage[field as keyof typeof spec.storage]], (document as unknown as Record<string, unknown>).currency)])) };
  }), page: { number: context.query.page.number, pageSize: detail ? 1 : context.query.page.size, hasNext: detail ? false : result.hasNextPage ?? false } };
}

export const salesAccountsHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.accounts");
export const salesAccountDetailHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.account.detail");
export const salesContactsHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.contacts");
export const salesContactDetailHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.contact.detail");
export const salesLeadsHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.leads");
export const salesLeadDetailHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.lead.detail");
export const salesOpportunityDetailHandler: DataSourceHandler = async (context) => await crmTable(context, "sales.opportunity.detail");

const timelineTargetCollections = Object.freeze({
  "sales.account": "sales-accounts", "sales.contact": "sales-contacts", "sales.lead": "sales-leads", "sales.opportunity": "sales-opportunities", "sales.task": "sales-tasks"
} as const);
type TimelineTargetType = keyof typeof timelineTargetCollections;

function timelineText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) throw new Error(`Sales timeline ${field} is invalid.`);
  return value;
}
function timelineEnum(value: unknown, allowed: readonly string[], field: string): string {
  const parsed = timelineText(value, field);
  if (!allowed.includes(parsed)) throw new Error(`Sales timeline ${field} is invalid.`);
  return parsed;
}
function timelineInstant(value: unknown, field: string): string {
  const parsed = timelineText(value, field);
  if (!validAuditTimestamp(parsed)) throw new Error(`Sales timeline ${field} is invalid.`);
  return parsed;
}
function timelineDate(value: unknown): string {
  const parsed = timelineText(value, "due date");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(parsed) || new Date(`${parsed}T00:00:00.000Z`).toISOString().slice(0, 10) !== parsed) throw new Error("Sales timeline due date is invalid.");
  return parsed;
}
function timelineRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error("Sales timeline revision is invalid.");
  return value as number;
}
function salesNoteBody(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 10_000) throw new Error("Sales note body is invalid.");
  return value;
}
function salesNoteSummary(value: unknown): string { return salesNoteBody(value).slice(0, 512); }
function timelineValues(selected: readonly string[], values: Readonly<Record<string, unknown>>, body?: unknown, note = false) {
  return Object.freeze({ ...values, ...(selected.includes("body") ? { body: note ? { kind: "text", value: salesNoteSummary(body) } : null } : {}) });
}

/** Timeline records remain independently protected: denied record classes are omitted. */
async function timelineFind<T>(find: () => Promise<T>): Promise<T | undefined> {
  try { return await find(); }
  catch (error) {
    if (error instanceof Error && error.message === "Current authority denied the Payload persistence operation.") return undefined;
    throw error;
  }
}

/** A related-record first check prevents a timeline row from widening the target's Sales scope. */
export const salesTimelineHandler: DataSourceHandler = async (context) => {
  // Gateway has already converted external hyphenated input into this closed internal shape.
  const input = isRecord(context.input) && Object.keys(context.input).sort().join("\0") === "relatedRecordId\0relatedRecordType" &&
    isSalesRecordId(context.input.relatedRecordId) && typeof context.input.relatedRecordType === "string" && Object.hasOwn(timelineTargetCollections, context.input.relatedRecordType)
    ? { success: true as const, data: { relatedRecordType: context.input.relatedRecordType as TimelineTargetType, relatedRecordId: context.input.relatedRecordId } }
    : salesTimelineInputRuntimeSchema.safeParse(context.input);
  if (!input.success) throw input.error;
  const selected = [...context.selectedFields]; const allowed = new Set(salesTimelineFields.map(({ id }) => id)); const required = salesTimelineFields.filter(({ binding }) => binding === "required").map(({ id }) => id);
  if (context.query.page === undefined || context.query.filters.length !== 0 || context.query.sort.length !== 0 || selected.length === 0 || new Set(selected).size !== selected.length || selected.some((field) => !allowed.has(field)) || required.some((field) => !selected.includes(field))) throw new Error("Sales timeline query is invalid.");
  const identity = sourceIdentity(context.request); const scope = scopeWhere(context.recordScope, identity, "sales.timeline");
  const offset = (context.query.page.number - 1) * context.query.page.size;
  const windowEnd = offset + context.query.page.size;
  if (!Number.isSafeInteger(windowEnd) || offset >= 100) throw new Error("Sales timeline page exceeds its bounded contract.");
  const effectiveEnd = Math.min(windowEnd, 100);
  const requested = Math.min(effectiveEnd + 1, 100);
  const request = salesRequest(context.request); const user = payloadUser(context.actor);
  let authorityType = input.data.relatedRecordType as TimelineTargetType;
  let authorityId = input.data.relatedRecordId;
  const taskTarget = input.data.relatedRecordType === "sales.task";
  let directTargetAuthorized = false;
  if (authorityType === "sales.task") {
    const taskResult = await request.payload.find({ collection: "sales-tasks", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, relatedRecordType: true, relatedRecordId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { id: { equals: authorityId } }] }, ...(user === undefined ? {} : { user }), req: request });
    const task = taskResult.docs[0] as SalesWorkflowDocument | undefined;
    if (taskResult.docs.length !== 1 || typeof task?.relatedRecordType !== "string" || !Object.hasOwn(timelineTargetCollections, task.relatedRecordType) || task.relatedRecordId === undefined || task.relatedRecordId === null) return { fields: [...context.selectedFields], rows: [], page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: false } };
    authorityType = task.relatedRecordType as TimelineTargetType;
    try { authorityId = persistedWorkflowId(task.relatedRecordId, "task parent record ID"); }
    catch { return { fields: [...context.selectedFields], rows: [], page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: false } }; }
    const directTask = await request.payload.find({ collection: "sales-tasks", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true }, sort: ["id"], where: { and: [scope, { id: { equals: input.data.relatedRecordId } }] }, ...(user === undefined ? {} : { user }), req: request });
    directTargetAuthorized = directTask.docs.length === 1;
  }
  const targetResult = await request.payload.find({ collection: timelineTargetCollections[authorityType], depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true }, sort: ["id"], where: { and: [scope, { id: { equals: authorityId } }] }, ...(user === undefined ? {} : { user }), req: request });
  const activityTargetAuthorized = targetResult.docs.length === 1;
  if (!taskTarget) directTargetAuthorized = activityTargetAuthorized;
  if (!activityTargetAuthorized && !directTargetAuthorized) return { fields: [...context.selectedFields], rows: [], page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: false } };
  const relationship = [{ relatedRecordType: { equals: input.data.relatedRecordType } }, { relatedRecordId: { equals: input.data.relatedRecordId } }];
  const relatedWhere = { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, ...relationship] };
  const options = { depth: 0 as const, overrideAccess: true as const, pagination: true as const, page: 1, limit: requested, where: relatedWhere, ...(user === undefined ? {} : { user }), req: request };
  const childWhere = (predicate: Readonly<Record<string, unknown>>) => ({ and: [...relatedWhere.and, predicate] });
  const [completedActivities, plannedActivities, notes, attachments, dueTasks, undatedTasks] = await Promise.all([
    activityTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-activities", sort: ["-occurredAt", "-id"], where: childWhere({ status: { equals: "completed" } }), select: { id: true, type: true, subject: true, status: true, occurredAt: true, scheduledAt: true, revision: true } })) : undefined,
    activityTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-activities", sort: ["-scheduledAt", "-id"], where: childWhere({ status: { in: ["scheduled", "cancelled"] } }), select: { id: true, type: true, subject: true, status: true, scheduledAt: true, revision: true } })) : undefined,
    directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-notes", sort: ["-occurredAt", "-id"], select: { id: true, status: true, occurredAt: true, revision: true, ...(selected.includes("body") ? { body: true as const } : {}) } })) : undefined,
    directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-attachment-references", sort: ["-createdAt", "-id"], select: { id: true, filename: true, status: true, createdAt: true, revision: true } })) : undefined,
    directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-tasks", sort: ["-dueDate", "-id"], where: childWhere({ dueDate: { exists: true } }), select: { id: true, title: true, status: true, dueDate: true, revision: true } })) : undefined,
    directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-tasks", sort: ["-createdAt", "-id"], where: childWhere({ dueDate: { exists: false } }), select: { id: true, title: true, status: true, createdAt: true, revision: true } })) : undefined
  ]);
  const dated = (key: string, recordId: unknown, classRank: number, instant: string, values: Readonly<Record<string, unknown>>) => {
    const id = typeof recordId === "number" ? recordId : typeof recordId === "string" && isSalesRecordId(recordId) ? Number(recordId) : NaN;
    if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) throw new Error("Sales timeline record ID is invalid.");
    return { key, id, classRank, instant, values };
  };
  const entries = [
    ...((completedActivities?.docs ?? []) as readonly SalesWorkflowDocument[]).map((doc) => { const instant = timelineInstant(doc.occurredAt, "activity occurrence"); return dated(`activity:${String(doc.id)}`, doc.id, 0, instant, timelineValues(selected, { kind: { kind: "text", value: `activity:${timelineEnum(doc.type, ["call", "meeting", "email"], "activity type")}` }, subject: { kind: "text", value: timelineText(doc.subject, "activity subject") }, status: { kind: "status", value: timelineEnum(doc.status, ["completed"], "activity status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
    ...((plannedActivities?.docs ?? []) as readonly SalesWorkflowDocument[]).map((doc) => { const instant = timelineInstant(doc.scheduledAt, "activity schedule"); return dated(`activity:${String(doc.id)}`, doc.id, 1, instant, timelineValues(selected, { kind: { kind: "text", value: `activity:${timelineEnum(doc.type, ["call", "meeting", "email"], "activity type")}` }, subject: { kind: "text", value: timelineText(doc.subject, "activity subject") }, status: { kind: "status", value: timelineEnum(doc.status, ["scheduled", "cancelled"], "activity status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
    ...((notes?.docs ?? []) as readonly SalesWorkflowDocument[]).map((doc) => { const instant = timelineInstant(doc.occurredAt, "note occurrence"); return dated(`note:${String(doc.id)}`, doc.id, 2, instant, timelineValues(selected, { kind: { kind: "text", value: "note" }, subject: { kind: "text", value: "Note" }, status: { kind: "status", value: timelineEnum(doc.status, ["recorded"], "note status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } }, doc.body, true)); }),
    ...((attachments?.docs ?? []) as readonly SalesWorkflowDocument[]).map((doc) => { const instant = timelineInstant(doc.createdAt, "attachment creation"); return dated(`attachment:${String(doc.id)}`, doc.id, 3, instant, timelineValues(selected, { kind: { kind: "text", value: "attachment" }, subject: { kind: "text", value: timelineText(doc.filename, "attachment filename") }, status: { kind: "status", value: timelineEnum(doc.status, ["active", "removed"], "attachment status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
    ...((dueTasks?.docs ?? []) as readonly SalesTaskDocument[]).map((doc) => { const dueDate = timelineDate(doc.dueDate); return dated(`task:${String(doc.id)}`, doc.id, 4, `${dueDate}T00:00:00.000Z`, timelineValues(selected, { kind: { kind: "text", value: "task" }, subject: { kind: "text", value: timelineText(doc.title, "task title") }, status: { kind: "status", value: timelineEnum(doc.status, ["open", "completed", "cancelled"], "task status") }, "occurred-at": { kind: "text", value: dueDate }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
    ...((undatedTasks?.docs ?? []) as readonly SalesTaskDocument[]).map((doc) => { const instant = timelineInstant(doc.createdAt, "task creation"); return dated(`task:${String(doc.id)}`, doc.id, 5, instant, timelineValues(selected, { kind: { kind: "text", value: "task" }, subject: { kind: "text", value: timelineText(doc.title, "task title") }, status: { kind: "status", value: timelineEnum(doc.status, ["open", "completed", "cancelled"], "task status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); })
  ].sort((left, right) => right.instant.localeCompare(left.instant) || left.classRank - right.classRank || right.id - left.id);
  const rows = entries.slice(offset, effectiveEnd).map(({ key, values }) => ({ key, values }));
  const classHasNext = [completedActivities, plannedActivities, notes, attachments, dueTasks, undatedTasks].some((result) => result?.hasNextPage === true);
  const withinWindow = effectiveEnd < 100;
  return { fields: [...context.selectedFields], rows, page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: withinWindow && (effectiveEnd < entries.length || classHasNext) } };
};

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

export const salesAccountsDefinition: DataSourceDefinition = { descriptor: salesAccountsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesAccountsOutputRuntimeSchema };
export const salesAccountDetailDefinition: DataSourceDefinition = { descriptor: salesAccountDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesAccountDetailOutputRuntimeSchema };
export const salesContactsDefinition: DataSourceDefinition = { descriptor: salesContactsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesContactsOutputRuntimeSchema };
export const salesContactDetailDefinition: DataSourceDefinition = { descriptor: salesContactDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesContactDetailOutputRuntimeSchema };
export const salesLeadsDefinition: DataSourceDefinition = { descriptor: salesLeadsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesLeadsOutputRuntimeSchema };
export const salesLeadDetailDefinition: DataSourceDefinition = { descriptor: salesLeadDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesLeadDetailOutputRuntimeSchema };
export const salesOpportunityDetailDefinition: DataSourceDefinition = { descriptor: salesOpportunityDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesOpportunityDetailOutputRuntimeSchema };
export const salesTimelineDefinition: DataSourceDefinition = { descriptor: salesTimelineDescriptor, inputSchema: salesTimelineInputRuntimeSchema, outputSchema: salesTimelineOutputRuntimeSchema };

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
    resourceId !== undefined && decision.resourceId !== resourceId || actionId !== "sales.lead.qualify" && Object.hasOwn(decision, "linkedRecordAdmissions") ||
    !["sales.contact.create", "sales.contact.update", "sales.lead.create", "sales.lead.update", "sales.opportunity.create", "sales.opportunity.update"].includes(actionId) && Object.hasOwn(decision, "protectedFieldAdmissions") || actionId !== "sales.note.create" && Object.hasOwn(decision, "noteReplacementAdmission")) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales write authorization is invalid.");
  }
  return decision as unknown as SalesWriteAuthorization;
}

function qualificationAdmissions(authorization: SalesWriteAuthorization, input: WorkflowActionInput): void {
  const expected = [
    ...(input.accountMode === "link" ? [{ recordType: "sales.account" as const, recordId: workflowId(input.accountId, "account ID"), applicationId: authorization.applicationId, environment: authorization.environment }] : []),
    ...(input.contactMode === "link" ? [{ recordType: "sales.contact" as const, recordId: workflowId(input.contactId, "contact ID"), applicationId: authorization.applicationId, environment: authorization.environment }] : [])
  ];
  const actual = authorization.linkedRecordAdmissions;
  if (expected.length === 0 ? actual !== undefined : !Array.isArray(actual) || actual.length !== expected.length) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked-record admission is invalid.");
  for (let index = 0; index < expected.length; index += 1) {
    const admission = actual?.[index]; const target = expected[index]!;
    if (!isRecord(admission) || Object.keys(admission).sort().join("\0") !== "applicationId\0environment\0recordId\0recordType" ||
      admission.recordType !== target.recordType || admission.recordId !== target.recordId || admission.applicationId !== target.applicationId || admission.environment !== target.environment) {
      throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked-record admission is invalid.");
    }
  }
}

function ownershipAdmission(authorization: SalesWriteAuthorization, input: OwnershipInput): void {
  const clearsTeam = input.teamId === undefined;
  if (authorization.ownershipNewOwnerId !== input.ownerId || authorization.ownershipTeamCleared !== clearsTeam ||
    (clearsTeam ? authorization.ownershipNewTeamId !== undefined : authorization.ownershipNewTeamId !== input.teamId)) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership admission is invalid.");
  }
}

function idempotencyReplay<T>(authorization: SalesWriteAuthorization, schema: RuntimeSchema<T>): T | undefined {
  if (!Object.hasOwn(authorization, "idempotencyReplay")) return undefined;
  const parsed = schema.safeParse(authorization.idempotencyReplay);
  if (!parsed.success) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales idempotency replay is invalid.");
  return parsed.data;
}

function durableActionEventId(authorization: SalesWriteAuthorization, idempotencyKey: string | undefined): string {
  const eventId = authorization.eventId ?? idempotencyKey;
  if (eventId === undefined || !/^[a-z][a-z0-9-]{2,127}$/u.test(eventId)) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action event identity is invalid.");
  }
  return eventId;
}

const maxAuditEntries = 100;
const maxAuditEntryBytes = 4_096;
const maxAuditBytes = 262_144;
const applicationIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const environmentPattern = /^[a-z][a-z0-9-]*$/u;
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const durableIdPattern = /^[a-z][a-z0-9-]{2,127}$/u;

function validAuditTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function ownershipSnapshot(value: unknown): Readonly<{ ownerId: string; teamId: string | null }> | undefined {
  if (!isRecord(value) || !exactKeys(value, ["ownerId", "teamId"]) || typeof value.ownerId !== "string" || value.ownerId.length > 160 || !actorIdPattern.test(value.ownerId) ||
    value.teamId !== null && (typeof value.teamId !== "string" || value.teamId.length > 160 || !actorIdPattern.test(value.teamId))) return undefined;
  return Object.freeze({ ownerId: value.ownerId, teamId: value.teamId as string | null });
}

function withOwnershipGenesis(entry: SalesAuditEntry, ownerId: string, teamId: string | null): SalesAuditEntry {
  const genesis = ownershipSnapshot({ ownerId, teamId });
  if (genesis === undefined) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership genesis is invalid.");
  return Object.freeze({ ...entry, ownershipGenesis: genesis });
}

function boundedAuditArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxAuditEntries) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
  try {
    if (Buffer.byteLength(canonicalJson(value)) > maxAuditBytes || value.some((entry) => Buffer.byteLength(canonicalJson(entry)) > maxAuditEntryBytes)) {
      throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history exceeds its bounded contract.");
    }
  } catch (error) {
    if (error instanceof ActionGatewayError) throw error;
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
  }
  return value;
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
    !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision > 1_000_000_000 || !validAuditTimestamp(entry.occurredAt) ||
    !isSalesRecordId(entry.resourceId) || entry.applicationId.length > 128 || !applicationIdPattern.test(entry.applicationId) ||
    entry.environment.length > 64 || !environmentPattern.test(entry.environment) || entry.actorId.length > 160 || !actorIdPattern.test(entry.actorId) || !durableIdPattern.test(entry.idempotencyKey)) return false;
  return entry.actionId === salesTaskCreateDescriptor.id ? entry.revision === 1 && entry.fromState === "absent" && entry.toState === "open"
    : entry.actionId === salesTaskUpdateDescriptor.id ? entry.fromState === "open" && ["completed", "cancelled"].includes(entry.toState)
      : entry.actionId === salesOpportunityStageUpdateDescriptor.id ? ({ qualification: "discovery", discovery: "proposal", proposal: "negotiation" } as Record<string, string>)[entry.fromState] === entry.toState
        : false;
}

function validMigrationAudit(entry: Readonly<Record<string, unknown>>, collection: AuditCollection): boolean {
  const genesisKey = entry.ownershipGenesis === undefined ? [] : ["ownershipGenesis"];
  return entry.kind === "phase-13-legacy-upgrade" && typeof entry.receiptDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(entry.receiptDigest) &&
    (entry.ownershipGenesis === undefined || ownershipSnapshot(entry.ownershipGenesis) !== undefined) &&
    (collection === "sales-tasks" ? exactKeys(entry, ["kind", "receiptDigest", ...genesisKey])
      : exactKeys(entry, ["kind", "receiptDigest", "legacyStage", ...genesisKey]) && typeof entry.legacyStage === "string" && entry.legacyStage.length > 0 && entry.legacyStage.length <= 64);
}

function migrationState(entry: Readonly<Record<string, unknown>>, collection: AuditCollection): string | undefined {
  if (!validMigrationAudit(entry, collection)) return undefined;
  if (collection === "sales-tasks") return "open";
  return ({ lead: "qualification", qualified: "discovery", won: "won", lost: "lost" } as Record<string, string>)[entry.legacyStage as string];
}

function validatedAuditHistory(value: unknown, collection: AuditCollection, identity?: AuditIdentity): readonly Readonly<Record<string, unknown>>[] {
  const bounded = boundedAuditArray(value);
  let migrationSeen = false;
  let migration: Readonly<Record<string, unknown>> | undefined;
  let priorAction: SalesAuditEntry | undefined;
  const actionIdempotencyKeys = new Set<string>();
  for (const [index, entry] of bounded.entries()) {
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
  }
  return bounded as readonly Readonly<Record<string, unknown>>[];
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
  if (idempotencyKey === undefined || !durableIdPattern.test(idempotencyKey) || !validAuditTimestamp(occurredAt) || !isSalesRecordId(resourceId) ||
    fromState.length === 0 || toState.length === 0 || !Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000_000 ||
    authorization.applicationId.length > 128 || !applicationIdPattern.test(authorization.applicationId) || authorization.environment.length > 64 || !environmentPattern.test(authorization.environment) ||
    authorization.actorId.length > 160 || !actorIdPattern.test(authorization.actorId)) {
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
  const current = await workflowCurrent(payloadRequest, authorization, "sales-opportunities", parsed.data.id, parsed.data.expectedRevision, "stageId", user);
  if (current.document.archiveStatus !== "active" || current.state !== parsed.data.expectedStage || !legalWorkflowTransition(salesOpportunityStageUpdateDescriptor.id, "sales-opportunities", current.state, parsed.data.stage, false)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity changed before the stage update.");
  const transition = auditEntry(authorization, salesOpportunityStageUpdateDescriptor.id, parsed.data.id, revision, parsed.data.expectedStage, parsed.data.stage, eventId);
  const update = await payloadRequest.payload.update({
    collection: "sales-opportunities",
    where: current.where,
    data: { stageId: parsed.data.stage, updatedBy: authorization.actorId, revision, audit: appendWorkflowAudit(current.audit, transition, "sales-opportunities", parsed.data.stage, "stageId", current.document.ownerId as string, typeof current.document.teamId === "string" ? current.document.teamId : null) }, depth: 0, overrideAccess: true,
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

const workflowActions = Object.freeze({
  "sales.account.create": { collection: "sales-accounts", event: "sales.event.account-changed", stateField: "status", state: "active" },
  "sales.account.update": { collection: "sales-accounts", event: "sales.event.account-changed", stateField: "status" },
  "sales.account.archive": { collection: "sales-accounts", event: "sales.event.account-changed", stateField: "status", state: "archived" },
  "sales.contact.create": { collection: "sales-contacts", event: "sales.event.contact-changed", stateField: "status", state: "active" },
  "sales.contact.update": { collection: "sales-contacts", event: "sales.event.contact-changed", stateField: "status" },
  "sales.contact.archive": { collection: "sales-contacts", event: "sales.event.contact-changed", stateField: "status", state: "archived" },
  "sales.lead.create": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status", state: "new" },
  "sales.lead.update": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status" },
  "sales.lead.qualify": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status", state: "qualified" },
  "sales.lead.disqualify": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status", state: "disqualified" },
  "sales.lead.archive": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "archiveStatus", state: "archived" },
  "sales.opportunity.create": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "stageId" },
  "sales.opportunity.update": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "stageId" },
  "sales.opportunity.close": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "stageId" },
  "sales.opportunity.archive": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "archiveStatus", state: "archived" },
  "sales.activity.create": { collection: "sales-activities", event: "sales.event.timeline-changed", stateField: "status", state: "scheduled" },
  "sales.activity.complete": { collection: "sales-activities", event: "sales.event.timeline-changed", stateField: "status", state: "completed" },
  "sales.activity.cancel": { collection: "sales-activities", event: "sales.event.timeline-changed", stateField: "status", state: "cancelled" },
  "sales.note.create": { collection: "sales-notes", event: "sales.event.timeline-changed", stateField: "status", state: "recorded" },
  "sales.attachment.link": { collection: "sales-attachment-references", event: "sales.event.timeline-changed", stateField: "status", state: "active" },
  "sales.attachment.remove": { collection: "sales-attachment-references", event: "sales.event.timeline-changed", stateField: "status", state: "removed" }
} as const);

type WorkflowActionId = keyof typeof workflowActions;
type WorkflowActionInput = Readonly<Record<string, unknown>>;
type WorkflowActionOutput = Readonly<{ id: string; revision: number; status: string; accountId?: string; contactId?: string; opportunityId?: string }>;
type WorkflowCollection = typeof workflowActions[WorkflowActionId]["collection"];

function isWorkflowActionId(value: string): value is WorkflowActionId { return Object.hasOwn(workflowActions, value); }
function workflowText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
  return value;
}
function workflowMediaType(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales media type is invalid.");
  return value;
}
function workflowPhone(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > salesPhoneMaxLength) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales phone is invalid.");
  return value;
}
function workflowCalendarDate(value: unknown): string {
  if (!isSalesCalendarDate(value)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales expected close date is invalid.");
  return value;
}
function workflowOpportunityMoney(value: unknown): Readonly<{ amount: string; currency: string }> {
  if (!isRecord(value) || Object.keys(value).sort().join("\0") !== "currency\0kind\0scale\0value" || value.kind !== "money" || typeof value.value !== "string" || !/^-?(0|[1-9][0-9]*)(?:[.][0-9]+)?$/u.test(value.value) || typeof value.currency !== "string" || !/^[A-Z]{3}$/u.test(value.currency) || !Number.isSafeInteger(value.scale) || (value.scale as number) < 0 || (value.scale as number) > 18 || value.value.startsWith("-") && Number(value.value) === 0) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity amount is invalid.");
  const fraction = value.value.split(".")[1] ?? "";
  if (fraction.length > (value.scale as number)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity amount scale is invalid.");
  const amount = `${value.value}${fraction.length === 0 && (value.scale as number) > 0 ? "." : ""}${"0".repeat((value.scale as number) - fraction.length)}`;
  if (amount.length > 128) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity amount is too large.");
  return Object.freeze({ amount, currency: value.currency });
}
function protectedFieldAdmissions(authorization: SalesWriteAuthorization, actionId: WorkflowActionId, input: WorkflowActionInput): void {
  const permissionId = actionId.startsWith("sales.contact.") ? "sales.contacts.channels.read" : actionId.startsWith("sales.lead.") ? "sales.leads.channels.read" : "sales.opportunities.amount.read";
  const fields = actionId.startsWith("sales.contact.") || actionId.startsWith("sales.lead.") ? ["email", "phone"] as const : ["amount"] as const;
  const expected = fields.filter((fieldId) => fieldId === "amount" ? actionId === "sales.opportunity.create" ? input.amount !== undefined : input.amountMode !== "retain" : actionId.endsWith(".update") ? input[`${fieldId}Mode`] !== "retain" : input[fieldId] !== undefined).map((fieldId) => ({ fieldId, permissionId }));
  const actual = authorization.protectedFieldAdmissions;
  if (expected.length === 0 ? actual !== undefined : !Array.isArray(actual) || actual.length !== expected.length) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales protected-field admission is invalid.");
  for (let index = 0; index < expected.length; index += 1) {
    const admission = actual?.[index]; const target = expected[index]!;
    if (!isRecord(admission) || Object.keys(admission).sort().join("\0") !== "fieldId\0permissionId" || admission.fieldId !== target.fieldId || admission.permissionId !== target.permissionId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales protected-field admission is invalid.");
  }
}
function workflowTimestamp(value: unknown, name: string): string {
  const timestamp = workflowText(value, name);
  if (!validAuditTimestamp(timestamp)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
  return timestamp;
}
function workflowId(value: unknown, name: string): string {
  const id = workflowText(value, name);
  if (!isSalesRecordId(id)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
  return id;
}
function persistedWorkflowId(value: unknown, name: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647) return String(value);
  if (typeof value === "string" && isSalesRecordId(value)) return value;
  throw new ActionGatewayError("STALE_RECORD", 409, `Sales persisted ${name} is invalid.`);
}
function workflowRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales expected revision is invalid.");
  return value as number;
}

type AttachmentUploadAdmission = Readonly<{ storageRef: string; applicationId: string; environmentId: string; uploaderActorId: string; filename: string; mediaType: string; byteSize: number; state: "ready"; revision: number }>;

async function attachmentUploadAdmission(authorization: SalesWriteAuthorization, input: WorkflowActionInput, signal: AbortSignal): Promise<AttachmentUploadAdmission> {
  if (typeof authorization.resolveAttachmentUpload !== "function") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment storage authority is unavailable.");
  const storageRef = workflowText(input.storageReference, "storage reference");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(signal.reason);
      signal.addEventListener("abort", abortListener, { once: true });
    });
    const receipt = await Promise.race([
      authorization.resolveAttachmentUpload({ applicationId: authorization.applicationId, environmentId: authorization.environment, actorId: authorization.actorId, storageRef }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment storage authority timed out.")), 5_000); }),
      aborted
    ]);
    if (!isRecord(receipt) || !exactKeys(receipt, ["storageRef", "applicationId", "environmentId", "uploaderActorId", "filename", "mediaType", "byteSize", "state", "revision"]) ||
      receipt.storageRef !== storageRef || receipt.applicationId !== authorization.applicationId || receipt.environmentId !== authorization.environment || receipt.uploaderActorId !== authorization.actorId || receipt.state !== "ready" ||
      typeof receipt.filename !== "string" || receipt.filename.length === 0 || receipt.filename.length > 256 || typeof receipt.mediaType !== "string" || receipt.mediaType.length === 0 || receipt.mediaType.length > 128 ||
      !Number.isSafeInteger(receipt.byteSize) || (receipt.byteSize as number) < 0 || (receipt.byteSize as number) > 1_073_741_824 || !Number.isSafeInteger(receipt.revision) || (receipt.revision as number) < 1 || (receipt.revision as number) > 1_000_000_000 ||
      input.filename !== receipt.filename || input.mediaType !== receipt.mediaType || input.byteSize !== receipt.byteSize) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment upload admission is invalid.");
    return receipt as unknown as AttachmentUploadAdmission;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortListener !== undefined) signal.removeEventListener("abort", abortListener);
  }
}
function exactWorkflowInput(actionId: WorkflowActionId, value: unknown): WorkflowActionInput {
  if (!isRecord(value)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action input is invalid.");
  const allowed: Readonly<Record<WorkflowActionId, readonly string[]>> = {
    "sales.account.create": ["name"], "sales.account.update": ["id", "expectedRevision", "name"], "sales.account.archive": ["id", "expectedRevision"],
    "sales.contact.create": ["accountId", "displayName", "email", "phone"], "sales.contact.update": ["id", "expectedRevision", "displayName", "emailMode", "email", "phoneMode", "phone"], "sales.contact.archive": ["id", "expectedRevision"],
    "sales.lead.create": ["displayName", "source", "email", "phone"], "sales.lead.update": ["id", "expectedRevision", "displayName", "source", "emailMode", "email", "phoneMode", "phone"], "sales.lead.qualify": ["id", "expectedRevision", "accountMode", "accountName", "accountId", "contactMode", "contactName", "contactId", "opportunityName", "pipelineId"], "sales.lead.disqualify": ["id", "expectedRevision"], "sales.lead.archive": ["id", "expectedRevision"],
    "sales.opportunity.create": ["name", "accountId", "pipelineId", "stageId", "primaryContactId", "amount", "expectedCloseDate"], "sales.opportunity.update": ["id", "expectedRevision", "name", "primaryContactMode", "primaryContactId", "amountMode", "amount", "expectedCloseDateMode", "expectedCloseDate"], "sales.opportunity.close": ["id", "expectedRevision", "expectedStage", "stage", "lossReason"], "sales.opportunity.archive": ["id", "expectedRevision"],
    "sales.activity.create": ["relatedRecordType", "relatedRecordId", "type", "subject", "scheduledAt", "supersedesActivityId"], "sales.activity.complete": ["id", "expectedRevision"], "sales.activity.cancel": ["id", "expectedRevision"],
    "sales.note.create": ["relatedRecordType", "relatedRecordId", "body", "replacesNoteId"], "sales.attachment.link": ["relatedRecordType", "relatedRecordId", "storageReference", "filename", "mediaType", "byteSize"], "sales.attachment.remove": ["id", "expectedRevision"]
  };
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed[actionId].includes(key))) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action input is invalid.");
  const required = actionId === "sales.opportunity.create" ? ["name", "accountId", "pipelineId", "stageId"]
      : actionId.endsWith(".create") ? allowed[actionId].filter((key) => !["email", "phone", "supersedesActivityId", "replacesNoteId"].includes(key))
    : actionId === "sales.opportunity.close" ? ["id", "expectedRevision", "expectedStage", "stage"]
      : actionId === "sales.lead.qualify" ? ["id", "expectedRevision", "accountMode", "contactMode", "opportunityName", "pipelineId"]
        : actionId === "sales.opportunity.update" ? ["id", "expectedRevision", "name", "primaryContactMode", "amountMode", "expectedCloseDateMode"]
          : actionId === "sales.contact.update" ? ["id", "expectedRevision", "displayName", "emailMode", "phoneMode"]
            : actionId === "sales.lead.update" ? ["id", "expectedRevision", "displayName", "source", "emailMode", "phoneMode"]
        : allowed[actionId].filter((key) => !["email", "phone", "lossReason"].includes(key));
  if (required.some((key) => !Object.hasOwn(value, key))) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action input is invalid.");
  if (actionId === "sales.lead.qualify") {
    const accountCreate = value.accountMode === "create"; const accountLink = value.accountMode === "link";
    const contactCreate = value.contactMode === "create"; const contactLink = value.contactMode === "link";
    const exactAccount = accountCreate ? Object.hasOwn(value, "accountName") && !Object.hasOwn(value, "accountId") : accountLink && Object.hasOwn(value, "accountId") && !Object.hasOwn(value, "accountName");
    const exactContact = contactCreate ? Object.hasOwn(value, "contactName") && !Object.hasOwn(value, "contactId") : contactLink && Object.hasOwn(value, "contactId") && !Object.hasOwn(value, "contactName");
    if (!exactAccount || !exactContact || accountCreate && contactLink) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales lead qualification input is invalid.");
    if (accountCreate) workflowText(value.accountName, "account name"); else workflowId(value.accountId, "account ID");
    if (contactCreate) workflowText(value.contactName, "contact name"); else workflowId(value.contactId, "contact ID");
    workflowText(value.opportunityName, "opportunity name"); workflowId(value.pipelineId, "pipeline ID");
  }
  if (actionId === "sales.opportunity.create" || actionId === "sales.opportunity.update") {
    workflowText(value.name, "opportunity name");
    if (actionId === "sales.opportunity.create") {
      workflowId(value.accountId, "account ID"); workflowId(value.pipelineId, "pipeline ID");
      if (value.stageId !== "qualification") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunities must begin in qualification.");
      if (value.primaryContactId !== undefined) workflowId(value.primaryContactId, "primary contact ID");
    } else {
      workflowId(value.id, "opportunity ID"); workflowRevision(value.expectedRevision);
      for (const [modeKey, valueKey] of [["primaryContactMode", "primaryContactId"], ["amountMode", "amount"], ["expectedCloseDateMode", "expectedCloseDate"]] as const) {
        const mode = value[modeKey]; const present = Object.hasOwn(value, valueKey);
        if (!["retain", "set", "clear"].includes(String(mode)) || (mode === "set") !== present) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity update mode is invalid.");
      }
      if (value.primaryContactMode === "set") workflowId(value.primaryContactId, "primary contact ID");
    }
    if (value.amount !== undefined) workflowOpportunityMoney(value.amount);
    if (value.expectedCloseDate !== undefined) workflowCalendarDate(value.expectedCloseDate);
  }
  if (actionId === "sales.contact.update" || actionId === "sales.lead.update") {
    for (const [modeKey, valueKey] of [["emailMode", "email"], ["phoneMode", "phone"]] as const) {
      const mode = value[modeKey]; const present = Object.hasOwn(value, valueKey);
      if (!(mode === "retain" || mode === "set" || mode === "clear") || (mode === "set") !== present) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales channel update mode is invalid.");
      if (mode === "set") valueKey === "phone" ? workflowPhone(value[valueKey]) : workflowText(value[valueKey], valueKey);
    }
  }
  if (actionId === "sales.contact.create" || actionId === "sales.lead.create") {
    if (value.email !== undefined) workflowText(value.email, "email");
    if (value.phone !== undefined) workflowPhone(value.phone);
  }
  if (actionId === "sales.note.create") { salesNoteBody(value.body); if (value.replacesNoteId !== undefined) workflowId(value.replacesNoteId, "replaced note ID"); }
  return Object.freeze({ ...value });
}

const workflowOutputStatuses: Readonly<Record<WorkflowActionId, readonly string[]>> = Object.freeze({
  "sales.account.create": ["active"], "sales.account.update": ["active"], "sales.account.archive": ["archived"],
  "sales.contact.create": ["active"], "sales.contact.update": ["active"], "sales.contact.archive": ["archived"],
  "sales.lead.create": ["new"], "sales.lead.update": ["working"], "sales.lead.qualify": ["qualified"], "sales.lead.disqualify": ["disqualified"], "sales.lead.archive": ["archived"],
  "sales.opportunity.create": ["qualification"], "sales.opportunity.update": ["qualification", "discovery", "proposal", "negotiation"], "sales.opportunity.close": ["won", "lost"], "sales.opportunity.archive": ["archived"],
  "sales.activity.create": ["scheduled"], "sales.activity.complete": ["completed"], "sales.activity.cancel": ["cancelled"],
  "sales.note.create": ["recorded"], "sales.attachment.link": ["active"], "sales.attachment.remove": ["removed"]
});

function workflowOutput(actionId: WorkflowActionId, value: unknown): WorkflowActionOutput {
  const qualification = actionId === "sales.lead.qualify";
  const allowedKeys = qualification ? ["id", "revision", "status", "accountId", "contactId", "opportunityId"] : ["id", "revision", "status"];
  if (!isRecord(value) || !exactKeys(value, allowedKeys) || !isSalesRecordId(value.id) || typeof value.status !== "string" || !workflowOutputStatuses[actionId].includes(value.status) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || (value.revision as number) > 1_000_000_000 ||
    qualification && ["accountId", "contactId", "opportunityId"].some((key) => !isSalesRecordId(value[key]))) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action output is invalid.");
  }
  return Object.freeze(value as WorkflowActionOutput);
}

function workflowRuntimeSchema(actionId: WorkflowActionId): RuntimeSchema<WorkflowActionInput> {
  return { safeParse(value) { try { return { success: true as const, data: exactWorkflowInput(actionId, value) }; } catch (error) { return { success: false as const, error: error instanceof Error ? error : new Error("Sales action input is invalid.") }; } } };
}
function workflowOutputRuntimeSchema(actionId: WorkflowActionId): RuntimeSchema<WorkflowActionOutput> {
  return { safeParse(value) { try { return { success: true as const, data: workflowOutput(actionId, value) }; } catch (error) { return { success: false as const, error: error instanceof Error ? error : new Error("Sales action output is invalid.") }; } } };
}

function workflowDescriptor(actionId: WorkflowActionId) {
  const descriptor = salesCrmActionDescriptors.find((candidate) => candidate.id === actionId);
  if (descriptor === undefined) throw new TypeError(`Missing frozen Sales action ${actionId}.`);
  return descriptor;
}

export const salesWorkflowActionDefinitions: readonly ActionDefinition<WorkflowActionInput, WorkflowActionOutput>[] = Object.freeze(
  (Object.keys(workflowActions) as WorkflowActionId[]).map((actionId) => ({ descriptor: workflowDescriptor(actionId), inputSchema: workflowRuntimeSchema(actionId), outputSchema: workflowOutputRuntimeSchema(actionId) }))
);

function workflowPayload(value: unknown): SalesPayloadRequest {
  const request = salesRequest(value);
  if (typeof request.payload.create !== "function" || typeof request.payload.update !== "function" || typeof request.payload.find !== "function") throw new Error("The Sales action requires a capability-scoped Payload request.");
  return request;
}
function workflowBase(authorization: SalesWriteAuthorization, state: string): Readonly<Record<string, unknown>> {
  return Object.freeze({ applicationId: authorization.applicationId, environment: authorization.environment, ownerId: authorization.ownerId,
    ...(authorization.teamId === undefined ? {} : { teamId: authorization.teamId }), createdBy: authorization.actorId, updatedBy: authorization.actorId, revision: 1, audit: [], status: state, archiveStatus: "active" });
}
function workflowWhere(authorization: SalesWriteAuthorization, id: string, expectedRevision: number): unknown {
  return mutationWhere(authorization, id, expectedRevision);
}
function workflowState(document: SalesWorkflowDocument, stateField: "status" | "stageId" | "archiveStatus"): string {
  const value = document[stateField];
  if (typeof value !== "string" || value.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record state is invalid.");
  return value;
}
function workflowStateIdentity(document: SalesWorkflowDocument, collection: WorkflowCollection): Readonly<{ status?: string; stageId?: string; archiveStatus?: string }> {
  if (collection === "sales-opportunities") return Object.freeze({ stageId: workflowState(document, "stageId"), archiveStatus: workflowState(document, "archiveStatus") });
  if (collection === "sales-leads") return Object.freeze({ status: workflowState(document, "status"), archiveStatus: workflowState(document, "archiveStatus") });
  return Object.freeze({ status: workflowState(document, "status") });
}
function workflowEvent(actionId: WorkflowActionId): SalesEventType { return workflowActions[actionId].event; }
function workflowCreates(actionId: WorkflowActionId): boolean { return actionId.endsWith(".create") || actionId === "sales.attachment.link"; }

async function authorizedPersistence<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) {
    if (error instanceof Error && ["Payload persistence capability denied the collection operation.", "Current authority denied the Payload persistence operation."].includes(error.message)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales persistence authority is unavailable.");
    throw error;
  }
}

function workflowRelatedType(value: unknown): TimelineTargetType {
  if (typeof value !== "string" || !Object.hasOwn(timelineTargetCollections, value)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related record type is invalid.");
  return value as TimelineTargetType;
}

async function assertRelatedRecord(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, type: TimelineTargetType, id: string, user: ReturnType<typeof payloadUser>, active = false, requireSameOwnership = true) {
  const found = await authorizedPersistence(payloadRequest.payload.find({ collection: timelineTargetCollections[type], depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, ownerId: true, teamId: true, status: true, archiveStatus: true, accountId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }));
  if (found.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales related record is unavailable.");
  const related = found.docs[0] as SalesWorkflowDocument;
  if (requireSameOwnership && (related.ownerId !== authorization.ownerId || (typeof related.teamId === "string" ? related.teamId : undefined) !== authorization.teamId)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related record authority changed.");
  if (active && (related.status !== "active" || related.archiveStatus === "archived")) throw new ActionGatewayError("STALE_RECORD", 409, "Sales related record is not active.");
  return related;
}

async function assertActivityRelatedRecord(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, type: TimelineTargetType, id: string, user: ReturnType<typeof payloadUser>) {
  if (type !== "sales.task") return await assertRelatedRecord(payloadRequest, authorization, type, id, user);
  const found = await payloadRequest.payload.find({ collection: "sales-tasks", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, relatedRecordType: true, relatedRecordId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest });
  if (found.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales related task is unavailable.");
  const task = found.docs[0] as SalesWorkflowDocument;
  if (typeof task.relatedRecordType !== "string" || !Object.hasOwn(timelineTargetCollections, task.relatedRecordType) || task.relatedRecordId === undefined || task.relatedRecordId === null) {
    throw new ActionGatewayError("STALE_RECORD", 409, "Sales related task parent is invalid.");
  }
  return await assertRelatedRecord(payloadRequest, authorization, task.relatedRecordType as TimelineTargetType, persistedWorkflowId(task.relatedRecordId, "task parent record ID"), user);
}

async function assertPipelineReference(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, value: unknown, user: ReturnType<typeof payloadUser>) {
  const id = workflowId(value, "pipeline ID");
  const scope = [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { pipelineId: { equals: id } }];
  const [pipeline, qualification] = await Promise.all([
    payloadRequest.payload.find({ collection: "sales-pipelines", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, isActive: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { isActive: { equals: true } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }),
    payloadRequest.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, stageId: true, semantic: true }, sort: ["id"], where: { and: [...scope, { stageId: { equals: "qualification" } }, { semantic: { equals: "qualification" } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest })
  ]);
  if (pipeline.docs.length !== 1 || qualification.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline is unavailable.");
  return id;
}

async function assertActivitySupersession(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, relatedRecordType: TimelineTargetType, relatedRecordId: string, value: unknown, user: ReturnType<typeof payloadUser>) {
  if (value === undefined) return undefined;
  const initial = workflowId(value, "superseded activity ID"); const seen = new Set<string>(); let current = initial;
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity supersession cycle is invalid.");
    seen.add(current);
    const found = await payloadRequest.payload.find({ collection: "sales-activities", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, status: true, relatedRecordId: true, relatedRecordType: true, supersedesActivity: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: current } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest });
    if (found.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales superseded activity is unavailable.");
    const document = found.docs[0] as SalesWorkflowDocument;
    if (document.relatedRecordId !== relatedRecordId || document.relatedRecordType !== relatedRecordType) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales superseded activity has a different related record.");
    if (document.status !== "completed") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Only completed Sales activities may be superseded.");
    if (document.supersedesActivity === undefined || document.supersedesActivity === null) return initial;
    current = persistedWorkflowId(document.supersedesActivity, "superseded activity ID");
  }
  throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity supersession is too deep.");
}

async function assertNoteReplacement(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, relatedRecordType: TimelineTargetType, relatedRecordId: string, value: unknown, user: ReturnType<typeof payloadUser>) {
  if (value === undefined) {
    if (authorization.noteReplacementAdmission !== undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales note replacement admission is invalid.");
    return undefined;
  }
  const id = workflowId(value, "replaced note ID");
  const admission = authorization.noteReplacementAdmission;
  if (!isRecord(admission) || Object.keys(admission).sort().join("\0") !== "applicationId\0environment\0recordId\0relatedRecordId\0relatedRecordType" || admission.recordId !== id || admission.applicationId !== authorization.applicationId || admission.environment !== authorization.environment || admission.relatedRecordType !== relatedRecordType || admission.relatedRecordId !== relatedRecordId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales note replacement admission is invalid.");
  const found = await authorizedPersistence(payloadRequest.payload.find({ collection: "sales-notes", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1,
    select: { id: true, status: true, relatedRecordId: true, relatedRecordType: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }));
  if (found.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales replaced note is unavailable.");
  const note = found.docs[0] as SalesWorkflowDocument;
  if (note.status !== "recorded" || note.relatedRecordType !== relatedRecordType || persistedWorkflowId(note.relatedRecordId, "replaced note related record ID") !== relatedRecordId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales replaced note does not belong to this record.");
  return id;
}

async function workflowCreate(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, actionId: WorkflowActionId, input: WorkflowActionInput, user: ReturnType<typeof payloadUser>, signal: AbortSignal, eventId: string): Promise<WorkflowActionOutput> {
  const spec = workflowActions[actionId];
  if (["sales.contact.create", "sales.lead.create", "sales.opportunity.create"].includes(actionId)) protectedFieldAdmissions(authorization, actionId, input);
  const data = actionId === "sales.account.create" ? { ...workflowBase(authorization, "active"), name: workflowText(input.name, "account name") }
    : actionId === "sales.contact.create" ? { ...workflowBase(authorization, "active"), accountId: Number(workflowId(input.accountId, "account ID")), displayName: workflowText(input.displayName, "contact name"), ...(input.email === undefined ? {} : { email: workflowText(input.email, "email") }), ...(input.phone === undefined ? {} : { phone: workflowPhone(input.phone) }) }
      : actionId === "sales.lead.create" ? { ...workflowBase(authorization, "new"), displayName: workflowText(input.displayName, "lead name"), source: workflowText(input.source, "lead source"), ...(input.email === undefined ? {} : { email: workflowText(input.email, "email") }), ...(input.phone === undefined ? {} : { phone: workflowPhone(input.phone) }) }
        : actionId === "sales.activity.create" ? (() => { const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID"); const scheduledAt = workflowTimestamp(input.scheduledAt, "scheduled time"); return { ...workflowBase(authorization, "scheduled"), type: workflowText(input.type, "activity type"), subject: workflowText(input.subject, "activity subject"), actorId: authorization.actorId, relatedRecordType, relatedRecordId, scheduledAt }; })()
          : actionId === "sales.note.create" ? (() => { const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID"); const base = workflowBase(authorization, "recorded"); const { archiveStatus: _archiveStatus, ...noteBase } = base; return { ...noteBase, body: salesNoteBody(input.body), authorId: authorization.actorId, occurredAt: new Date().toISOString(), relatedRecordType, relatedRecordId }; })()
          : actionId === "sales.attachment.link" ? (() => { const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID"); const base = workflowBase(authorization, "active"); const { archiveStatus: _archiveStatus, ...attachmentBase } = base; const byteSize = input.byteSize; if (!Number.isSafeInteger(byteSize) || (byteSize as number) < 0 || (byteSize as number) > 1_073_741_824) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment size is invalid."); return { ...attachmentBase, storageReference: workflowText(input.storageReference, "storage reference"), filename: workflowText(input.filename, "filename"), mediaType: workflowMediaType(input.mediaType), byteSize, uploaderId: authorization.actorId, relatedRecordType, relatedRecordId }; })()
          : { ...workflowBase(authorization, workflowText(input.stageId, "opportunity stage")), name: workflowText(input.name, "opportunity name"), accountId: Number(workflowId(input.accountId, "account ID")), pipelineId: Number(workflowId(input.pipelineId, "pipeline ID")), stageId: workflowText(input.stageId, "opportunity stage"), ...(input.primaryContactId === undefined ? {} : { primaryContactId: Number(workflowId(input.primaryContactId, "primary contact ID")) }), ...(input.amount === undefined ? {} : workflowOpportunityMoney(input.amount)), ...(input.expectedCloseDate === undefined ? {} : { expectedCloseDate: workflowCalendarDate(input.expectedCloseDate) }) };
  if (actionId === "sales.activity.create" || actionId === "sales.note.create" || actionId === "sales.attachment.link") {
    const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID");
    const related = actionId === "sales.activity.create"
      ? await assertActivityRelatedRecord(payloadRequest, authorization, relatedRecordType, relatedRecordId, user)
      : await assertRelatedRecord(payloadRequest, authorization, relatedRecordType, relatedRecordId, user);
    if (actionId === "sales.activity.create") {
      if (typeof related.teamId !== "string" || related.teamId.length === 0) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity requires an assigned related-record team.");
      Object.assign(data, { teamId: related.teamId });
    }
    if (actionId === "sales.activity.create") {
      const supersedesActivityId = await assertActivitySupersession(payloadRequest, authorization, relatedRecordType, relatedRecordId, input.supersedesActivityId, user);
      if (supersedesActivityId !== undefined) Object.assign(data, { supersedesActivity: supersedesActivityId });
    }
    if (actionId === "sales.note.create") {
      const replacesNoteId = await assertNoteReplacement(payloadRequest, authorization, relatedRecordType, relatedRecordId, input.replacesNoteId, user);
      if (replacesNoteId !== undefined) Object.assign(data, { replacesNoteId });
    }
    if (actionId === "sales.attachment.link") {
      const upload = await attachmentUploadAdmission(authorization, input, signal);
      Object.assign(data, { storageReference: upload.storageRef, filename: upload.filename, mediaType: upload.mediaType, byteSize: upload.byteSize, uploaderId: upload.uploaderActorId });
    }
  }
  if (actionId === "sales.contact.create") {
    const account = await assertRelatedRecord(payloadRequest, authorization, "sales.account", workflowId(input.accountId, "account ID"), user, true);
    if (typeof account.teamId !== "string" || account.teamId.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales contact requires an assigned active Account team.");
    Object.assign(data, { ownerId: account.ownerId, teamId: account.teamId });
  }
  if (actionId === "sales.opportunity.create") {
    if (input.stageId !== "qualification") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunities must begin in qualification.");
    const account = await assertRelatedRecord(payloadRequest, authorization, "sales.account", workflowId(input.accountId, "account ID"), user, true);
    if (typeof account.teamId !== "string" || account.teamId.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity requires an assigned active Account team.");
    Object.assign(data, { ownerId: account.ownerId, teamId: account.teamId });
    await assertPipelineReference(payloadRequest, authorization, input.pipelineId, user);
    if (input.primaryContactId !== undefined) {
      const contact = await assertRelatedRecord(payloadRequest, authorization, "sales.contact", workflowId(input.primaryContactId, "primary contact ID"), user, true, false);
      if (String(contact.accountId) !== workflowId(input.accountId, "account ID")) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity contact does not belong to its Account.");
    }
  }
  const created = await authorizedPersistence(payloadRequest.payload.create({ collection: spec.collection, data, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) })) as SalesWorkflowDocument;
  if (created.id === undefined || created.id === null) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record creation failed.");
  const id = String(created.id);
  const state = workflowState(created, spec.stateField);
  if (typeof created.ownerId !== "string" || created.ownerId.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record ownership is invalid.");
  const audit = withOwnershipGenesis(auditEntry(authorization, actionId, id, 1, "absent", state, eventId), created.ownerId, typeof created.teamId === "string" ? created.teamId : null);
  const finalized = await payloadRequest.payload.update({ collection: spec.collection, id, data: { audit: appendWorkflowAudit([], audit, spec.collection, state, spec.stateField, created.ownerId, typeof created.teamId === "string" ? created.teamId : null) }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext(workflowEvent(actionId), audit, spec.stateField) }) as SalesWorkflowDocument;
  if (String(finalized.id) !== id || finalized.revision !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit finalization failed.");
  if (signal.aborted) throw signal.reason;
  return workflowOutput(actionId, { id, revision: 1, status: state });
}

function workflowAuditStateField(actionId: string, collection: WorkflowCollection): "status" | "stageId" | "archiveStatus" {
  if (actionId === "sales.lead.qualify") return collection === "sales-opportunities" ? "stageId" : "status";
  if (actionId === salesOpportunityStageUpdateDescriptor.id) return "stageId";
  if (actionId === salesOwnershipAssignDescriptor.id) return collection === "sales-opportunities" ? "stageId" : "status";
  return workflowActions[actionId as WorkflowActionId].stateField;
}

function legalWorkflowTransition(actionId: string, collection: WorkflowCollection, from: string, to: string, genesis: boolean): boolean {
  if (genesis) {
    if (actionId === "sales.lead.qualify") return from === "absent" && (collection === "sales-opportunities" ? to === "qualification" : to === "active");
    const initial = ({ "sales.account.create": "active", "sales.contact.create": "active", "sales.lead.create": "new", "sales.opportunity.create": "qualification", "sales.activity.create": "scheduled", "sales.note.create": "recorded", "sales.attachment.link": "active" } as Record<string, string>)[actionId];
    return initial !== undefined && from === "absent" && to === initial;
  }
  if (actionId === "sales.account.update" || actionId === "sales.contact.update" || actionId === "sales.opportunity.update") return from === to;
  if (actionId === "sales.lead.update") return from === "new" && to === "working" || from === "working" && to === "working";
  if (actionId === "sales.lead.qualify") return ["new", "working"].includes(from) && to === "qualified";
  if (actionId === "sales.lead.disqualify") return ["new", "working"].includes(from) && to === "disqualified";
  if (actionId === salesOpportunityStageUpdateDescriptor.id) return ({ qualification: "discovery", discovery: "proposal", proposal: "negotiation" } as Record<string, string>)[from] === to;
  if (actionId === "sales.opportunity.close") return to === "lost" && ["qualification", "discovery", "proposal", "negotiation"].includes(from) || from === "negotiation" && to === "won";
  if (actionId === "sales.activity.complete") return from === "scheduled" && to === "completed";
  if (actionId === "sales.activity.cancel") return from === "scheduled" && to === "cancelled";
  if (actionId === "sales.attachment.remove") return from === "active" && to === "removed";
  if (actionId.endsWith(".archive")) return from === "active" && to === "archived";
  return actionId === salesOwnershipAssignDescriptor.id && from === to;
}

function workflowAuditHistory(value: unknown, collection: WorkflowCollection, identity: Readonly<{ id: string; applicationId: string; environment: string; revision: number; ownerId?: string; teamId?: string | null; status?: string; stageId?: string; archiveStatus?: string }>, currentState: string, currentStateField: "status" | "stageId" | "archiveStatus"): readonly SalesAuditEntry[] {
  const bounded = boundedAuditArray(value);
  const entries: SalesAuditEntry[] = [];
  const states = new Map<string, string>([["archiveStatus", "active"]]);
  let migration = false;
  const idempotencyKeys = new Set<string>();
  let lastOwnership: Readonly<{ ownerId: string; teamId: string | null }> | undefined;
  for (const [index, entry] of bounded.entries()) {
    const record = isRecord(entry) ? entry : undefined;
    if (index === 0 && collection === "sales-opportunities" && record !== undefined && validMigrationAudit(record, "sales-opportunities")) {
      const genesis = ownershipSnapshot(record.ownershipGenesis);
      if (genesis === undefined) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership genesis is invalid.");
      migration = true;
      states.set("stageId", migrationState(record, "sales-opportunities")!);
      lastOwnership = genesis;
      continue;
    }
    if (index === 0 && collection === "sales-accounts" && record !== undefined && exactKeys(record, ["kind", "receiptDigest", "ownershipGenesis"]) && record.kind === "phase-13-legacy-import" && typeof record.receiptDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(record.receiptDigest)) {
      const genesis = ownershipSnapshot(record.ownershipGenesis);
      if (genesis === undefined) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership genesis is invalid.");
      migration = true;
      states.set("status", "active");
      lastOwnership = genesis;
      continue;
    }
    const qualifyGenesis = record?.actionId === "sales.lead.qualify" && index === 0 && !migration && ["sales-accounts", "sales-contacts", "sales-opportunities"].includes(collection);
    const ownership = record?.actionId === salesOwnershipAssignDescriptor.id;
    const genesis = index === 0 && !migration;
    const genesisFacts = ownershipSnapshot(record?.ownershipGenesis);
    const allowedKeys = ["actionId", "resourceId", "applicationId", "environment", "fromState", "toState", "occurredAt", "actorId", "revision", "idempotencyKey", ...(genesis ? ["ownershipGenesis"] : []), ...(ownership ? ["ownership"] : [])];
    const actionAllowed = typeof record?.actionId === "string" && (isWorkflowActionId(record.actionId) ? workflowActions[record.actionId].collection === collection || qualifyGenesis
      : record.actionId === salesOpportunityStageUpdateDescriptor.id ? collection === "sales-opportunities"
        : ownership && ["sales-accounts", "sales-contacts", "sales-leads", "sales-opportunities"].includes(collection));
    const ownershipFacts = isRecord(record?.ownership) ? record.ownership : undefined;
    if (record === undefined || !exactKeys(record, allowedKeys) || !actionAllowed ||
      typeof record.resourceId !== "string" || !isSalesRecordId(record.resourceId) || record.resourceId !== identity.id || record.applicationId !== identity.applicationId || record.environment !== identity.environment ||
      typeof record.applicationId !== "string" || record.applicationId.length > 128 || !applicationIdPattern.test(record.applicationId) || typeof record.environment !== "string" || record.environment.length > 64 || !environmentPattern.test(record.environment) ||
      !Number.isSafeInteger(record.revision) || (record.revision as number) < 1 || (record.revision as number) > 1_000_000_000 || record.revision !== index + 1 || typeof record.occurredAt !== "string" || !validAuditTimestamp(record.occurredAt) ||
      typeof record.fromState !== "string" || typeof record.toState !== "string" || typeof record.actorId !== "string" || record.actorId.length > 160 || !actorIdPattern.test(record.actorId) || typeof record.idempotencyKey !== "string" || !durableIdPattern.test(record.idempotencyKey) || idempotencyKeys.has(record.idempotencyKey) ||
      genesis && genesisFacts === undefined ||
      ownership && (ownershipFacts === undefined || !exactKeys(ownershipFacts, ["oldOwnerId", "newOwnerId", "oldTeamId", "newTeamId"]) ||
        typeof ownershipFacts.oldOwnerId !== "string" || ownershipFacts.oldOwnerId.length > 160 || !actorIdPattern.test(ownershipFacts.oldOwnerId) ||
        typeof ownershipFacts.newOwnerId !== "string" || ownershipFacts.newOwnerId.length > 160 || !actorIdPattern.test(ownershipFacts.newOwnerId) ||
        ![ownershipFacts.oldTeamId, ownershipFacts.newTeamId].every((teamId) => teamId === null || typeof teamId === "string" && teamId.length <= 160 && actorIdPattern.test(teamId))) ||
      isWorkflowActionId(record.actionId as string) && workflowCreates(record.actionId as WorkflowActionId) && index !== 0) {
      throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
    }
    const action = record as unknown as SalesAuditEntry;
    const stateField = workflowAuditStateField(action.actionId, collection);
    const prior = states.get(stateField);
    if ((prior === undefined ? action.fromState !== "absent" : action.fromState !== prior) || index === 0 && migration || !legalWorkflowTransition(action.actionId, collection, action.fromState, action.toState, genesis)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
    if (genesis) lastOwnership = genesisFacts;
    if (!ownership) states.set(stateField, action.toState);
    if (ownership) {
      const oldTeamId = ownershipFacts!.oldTeamId as string | null;
      const newTeamId = ownershipFacts!.newTeamId as string | null;
      if (lastOwnership === undefined || ownershipFacts!.oldOwnerId !== lastOwnership.ownerId || oldTeamId !== lastOwnership.teamId) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership audit continuity is invalid.");
      lastOwnership = Object.freeze({ ownerId: ownershipFacts!.newOwnerId as string, teamId: newTeamId });
    }
    idempotencyKeys.add(action.idempotencyKey);
    entries.push(action);
  }
  const last = entries.at(-1);
  if ((last?.revision ?? (migration ? 1 : 0)) !== identity.revision || states.get(currentStateField) !== currentState ||
    identity.status !== undefined && states.get("status") !== identity.status || identity.stageId !== undefined && states.get("stageId") !== identity.stageId ||
    identity.archiveStatus !== undefined && states.get("archiveStatus") !== identity.archiveStatus || lastOwnership === undefined ||
    identity.ownerId !== lastOwnership.ownerId || (identity.teamId ?? null) !== lastOwnership.teamId) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is not current.");
  return bounded as unknown as readonly SalesAuditEntry[];
}

function appendWorkflowAudit(history: readonly SalesAuditEntry[], entry: SalesAuditEntry, collection: WorkflowCollection, currentState: string, currentStateField: "status" | "stageId" | "archiveStatus", ownerId: string, teamId?: string | null): readonly SalesAuditEntry[] {
  const appended = Object.freeze([...history, entry]);
  workflowAuditHistory(appended, collection, { id: entry.resourceId, applicationId: entry.applicationId, environment: entry.environment, revision: entry.revision, ownerId, teamId: teamId ?? null }, currentState, currentStateField);
  return appended;
}

export type SalesStateHistoryEntry = Readonly<{ actionId: string; stateField: "status" | "stageId" | "archiveStatus"; fromState: string; toState: string; revision: number; occurredAt: string }>;

/** Validates the complete private audit chain before exposing only the newest safe state transitions. */
export function projectSalesStateHistory(input: Readonly<{ audit: unknown; collection: WorkflowCollection; id: string; applicationId: string; environment: string; revision: number; ownerId: string; teamId?: string | null; currentState: string; currentStateField: "status" | "stageId" | "archiveStatus"; archiveStatus?: string }>): readonly SalesStateHistoryEntry[] {
  const dualAxis = input.collection === "sales-leads" || input.collection === "sales-opportunities";
  if (dualAxis && (typeof input.archiveStatus !== "string" || !["active", "archived"].includes(input.archiveStatus))) throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is not current.");
  const audit = workflowAuditHistory(input.audit, input.collection, { id: input.id, applicationId: input.applicationId, environment: input.environment, revision: input.revision, ownerId: input.ownerId, teamId: input.teamId ?? null,
    ...(input.currentStateField === "status" ? { status: input.currentState } : input.currentStateField === "stageId" ? { stageId: input.currentState } : {}), ...(dualAxis ? { archiveStatus: input.archiveStatus } : {}) }, input.currentState, input.currentStateField);
  return Object.freeze(audit.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.actionId !== "string" || entry.actionId === salesOwnershipAssignDescriptor.id) return [];
    return [Object.freeze({ actionId: entry.actionId, stateField: workflowAuditStateField(entry.actionId, input.collection), fromState: String(entry.fromState), toState: String(entry.toState), revision: Number(entry.revision), occurredAt: String(entry.occurredAt) })];
  }).slice(-25).reverse());
}

async function workflowCurrent(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, collection: WorkflowCollection, id: string, expectedRevision: number, stateField: "status" | "stageId" | "archiveStatus", user: ReturnType<typeof payloadUser>, relatedAuthority = false) {
  const where = relatedAuthority ? { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }] } : workflowWhere(authorization, id, expectedRevision);
  const found = await payloadRequest.payload.find({ collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, revision: true, audit: true, status: true, archiveStatus: true, stageId: true, name: true, displayName: true, ownerId: true, teamId: true, accountId: true, primaryContactId: true, relatedRecordType: true, relatedRecordId: true }, sort: ["id"], where, ...(user === undefined ? {} : { user }), req: payloadRequest });
  if (found.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record changed before the update.");
  const document = found.docs[0] as SalesWorkflowDocument;
  if (String(document.id) !== id || document.revision !== expectedRevision) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record revision is invalid.");
  const state = workflowState(document, stateField);
  if (typeof document.ownerId !== "string" || document.ownerId.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record ownership is invalid.");
  const audit = workflowAuditHistory(document.audit, collection, { id, applicationId: authorization.applicationId, environment: authorization.environment, revision: expectedRevision, ownerId: document.ownerId, teamId: typeof document.teamId === "string" ? document.teamId : null, ...workflowStateIdentity(document, collection) }, state, stateField);
  return Object.freeze({ where, document, state, audit });
}

function updateData(actionId: WorkflowActionId, input: WorkflowActionInput, state: string, authorization: SalesWriteAuthorization, revision: number, audit: readonly SalesAuditEntry[]): Readonly<Record<string, unknown>> {
  const base = { updatedBy: authorization.actorId, revision, audit };
  if (actionId === "sales.account.update") return { ...base, name: workflowText(input.name, "account name") };
  if (actionId === "sales.contact.update") return { ...base, displayName: workflowText(input.displayName, "contact name"), ...(input.emailMode === "set" ? { email: workflowText(input.email, "email") } : input.emailMode === "clear" ? { email: null } : {}), ...(input.phoneMode === "set" ? { phone: workflowPhone(input.phone) } : input.phoneMode === "clear" ? { phone: null } : {}) };
  if (actionId === "sales.lead.update") return { ...base, displayName: workflowText(input.displayName, "lead name"), source: workflowText(input.source, "lead source"), ...(state === "new" ? { status: "working" } : {}), ...(input.emailMode === "set" ? { email: workflowText(input.email, "email") } : input.emailMode === "clear" ? { email: null } : {}), ...(input.phoneMode === "set" ? { phone: workflowPhone(input.phone) } : input.phoneMode === "clear" ? { phone: null } : {}) };
  if (actionId === "sales.opportunity.update") return { ...base, name: workflowText(input.name, "opportunity name"),
    ...(input.primaryContactMode === "set" ? { primaryContactId: Number(workflowId(input.primaryContactId, "primary contact ID")) } : input.primaryContactMode === "clear" ? { primaryContactId: null } : {}),
    ...(input.amountMode === "set" ? workflowOpportunityMoney(input.amount) : input.amountMode === "clear" ? { amount: null, currency: null } : {}),
    ...(input.expectedCloseDateMode === "set" ? { expectedCloseDate: workflowCalendarDate(input.expectedCloseDate) } : input.expectedCloseDateMode === "clear" ? { expectedCloseDate: null } : {}) };
  if (actionId === "sales.opportunity.close") {
    const stage = workflowText(input.stage, "opportunity stage");
    if (stage === "lost" && input.lossReason === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales loss reason is required.");
    return { ...base, stageId: stage, closedAt: new Date().toISOString(), ...(stage === "lost" ? { lossReason: workflowText(input.lossReason, "loss reason") } : {}) };
  }
  if (actionId === "sales.lead.disqualify") return { ...base, status: "disqualified", decidedAt: new Date().toISOString(), disqualifiedAt: new Date().toISOString() };
  if (actionId === "sales.activity.complete") return { ...base, status: "completed", occurredAt: new Date().toISOString() };
  if (actionId === "sales.activity.cancel") return { ...base, status: "cancelled" };
  if (actionId === "sales.attachment.remove") return { ...base, status: "removed" };
  if (actionId.endsWith(".archive")) return actionId === "sales.lead.archive" ? { ...base, archiveStatus: "archived" } : actionId === "sales.opportunity.archive" ? { ...base, archiveStatus: "archived" } : { ...base, status: "archived" };
  throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales transition from ${state} is unavailable.`);
}

async function createConversionRecord(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, collection: "sales-accounts" | "sales-contacts" | "sales-opportunities", data: Readonly<Record<string, unknown>>, actionId: WorkflowActionId, eventId: string, user: ReturnType<typeof payloadUser>): Promise<string> {
  const created = await authorizedPersistence(payloadRequest.payload.create({ collection, data, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) })) as SalesWorkflowDocument;
  if (created.id === undefined || created.id === null) throw new ActionGatewayError("STALE_RECORD", 409, "Sales conversion output creation failed.");
  const id = String(created.id);
  const state = collection === "sales-opportunities" ? workflowState(created, "stageId") : workflowState(created, "status");
  if (typeof created.ownerId !== "string" || created.ownerId.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales conversion ownership is invalid.");
  const conversionEventId = `qualification-${createHash("sha256").update(canonicalJson({ eventId, collection, id })).digest("hex")}`;
  const audit = withOwnershipGenesis(auditEntry(authorization, actionId, id, 1, "absent", state, conversionEventId), created.ownerId, typeof created.teamId === "string" ? created.teamId : null);
  const event = collection === "sales-accounts" ? "sales.event.account-changed" : collection === "sales-contacts" ? "sales.event.contact-changed" : "sales.event.opportunity-changed";
  const stateField = collection === "sales-opportunities" ? "stageId" : "status";
  const context = eventContext(event, audit, stateField);
  const ownerId = created.ownerId; const teamId = typeof created.teamId === "string" ? created.teamId : null;
  const finalized = await payloadRequest.payload.update({ collection, id, data: { audit: appendWorkflowAudit([], audit, collection, state, stateField, ownerId, teamId) }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context }) as SalesWorkflowDocument;
  if (String(finalized.id) !== id) throw new ActionGatewayError("STALE_RECORD", 409, "Sales conversion output audit failed.");
  return id;
}

async function qualifyLead(payloadRequest: SalesPayloadRequest, authorization: SalesWriteAuthorization, input: WorkflowActionInput, user: ReturnType<typeof payloadUser>, eventId: string): Promise<WorkflowActionOutput> {
  qualificationAdmissions(authorization, input);
  const id = workflowId(input.id, "lead ID"); const expectedRevision = workflowRevision(input.expectedRevision);
  const current = await workflowCurrent(payloadRequest, authorization, "sales-leads", id, expectedRevision, "status", user);
  if (current.document.archiveStatus !== "active" || !["new", "working"].includes(current.state)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead cannot be qualified from its current state.");
  if (typeof current.document.ownerId !== "string" || typeof current.document.teamId !== "string") throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead requires active ownership before qualification.");
  const pipelineId = await assertPipelineReference(payloadRequest, authorization, input.pipelineId, user);
  const inheritedBase = (state: string) => ({ ...workflowBase(authorization, state), ownerId: current.document.ownerId, teamId: current.document.teamId });
  const accountId = input.accountMode === "create"
    ? await createConversionRecord(payloadRequest, authorization, "sales-accounts", { ...inheritedBase("active"), name: workflowText(input.accountName, "account name") }, "sales.lead.qualify", eventId, user)
    : workflowId(input.accountId, "account ID");
  if (input.accountMode === "link") await assertRelatedRecord(payloadRequest, authorization, "sales.account", accountId, user, true, false);
  const contactId = input.contactMode === "create"
    ? await createConversionRecord(payloadRequest, authorization, "sales-contacts", { ...inheritedBase("active"), accountId: Number(accountId), displayName: workflowText(input.contactName, "contact name") }, "sales.lead.qualify", eventId, user)
    : workflowId(input.contactId, "contact ID");
  if (input.contactMode === "link") {
    const contact = await assertRelatedRecord(payloadRequest, authorization, "sales.contact", contactId, user, true, false);
    if (persistedWorkflowId(contact.accountId, "contact account ID") !== accountId) throw new ActionGatewayError("STALE_RECORD", 409, "Sales contact does not belong to the qualified account.");
  }
  const opportunityId = await createConversionRecord(payloadRequest, authorization, "sales-opportunities", { ...inheritedBase("qualification"), name: workflowText(input.opportunityName, "opportunity name"), accountId: Number(accountId), primaryContactId: Number(contactId), pipelineId: Number(pipelineId), stageId: "qualification" }, "sales.lead.qualify", eventId, user);
  const revision = expectedRevision + 1;
  const transition = auditEntry(authorization, "sales.lead.qualify", id, revision, current.state, "qualified", eventId);
  const context = eventContext("sales.event.lead-changed", transition, "status");
  const updated = await payloadRequest.payload.update({ collection: "sales-leads", where: current.where, data: { updatedBy: authorization.actorId, revision, audit: appendWorkflowAudit(current.audit, transition, "sales-leads", "qualified", "status", current.document.ownerId as string, typeof current.document.teamId === "string" ? current.document.teamId : null), status: "qualified", decidedAt: new Date().toISOString(), qualifiedAt: new Date().toISOString(), qualifiedAccountId: accountId, qualifiedContactId: contactId, qualifiedOpportunityId: opportunityId }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context });
  if (updated.errors.length > 0 || updated.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead changed before qualification.");
  return workflowOutput("sales.lead.qualify", { id, revision, status: "qualified", accountId, contactId, opportunityId });
}

/** Fixed P13.3 CRM actions; every record mutation remains scoped by host authorization and CAS. */
export const salesWorkflowActionHandler: ActionHandler<WorkflowActionInput, WorkflowActionOutput> = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
  if (signal.aborted) throw signal.reason;
  const candidate = isRecord(authorizationContext) && isRecord(authorizationContext.decision) ? authorizationContext.decision.actionId : isRecord(authorizationContext) ? authorizationContext.actionId : undefined;
  if (typeof candidate !== "string" || !isWorkflowActionId(candidate)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action is unavailable.");
  const actionId = candidate;
  const parsed = exactWorkflowInput(actionId, input);
  const authorization = writeAuthorization(authorizationContext, actionId, typeof parsed.id === "string" ? parsed.id : undefined);
  const replay = idempotencyReplay(authorization, workflowOutputRuntimeSchema(actionId));
  if (replay !== undefined) return replay;
  const payloadRequest = workflowPayload(request);
  const user = payloadUser(actor);
  const eventId = durableActionEventId(authorization, idempotencyKey);
  if (workflowCreates(actionId)) return await workflowCreate(payloadRequest, authorization, actionId, parsed, user, signal, eventId);
  if (actionId === "sales.lead.qualify") return await qualifyLead(payloadRequest, authorization, parsed, user, eventId);
  const id = workflowId(parsed.id, "record ID"); const expectedRevision = workflowRevision(parsed.expectedRevision);
  const spec = workflowActions[actionId];
  const relatedMutation = actionId === "sales.attachment.remove" || actionId === "sales.activity.complete" || actionId === "sales.activity.cancel";
  const current = await workflowCurrent(payloadRequest, authorization, spec.collection, id, expectedRevision, spec.stateField, user, relatedMutation);
  if (relatedMutation) {
    const relatedType = workflowRelatedType(current.document.relatedRecordType);
    const relatedId = persistedWorkflowId(current.document.relatedRecordId, "related record ID");
    if (actionId === "sales.activity.complete" || actionId === "sales.activity.cancel") await assertActivityRelatedRecord(payloadRequest, authorization, relatedType, relatedId, user);
    else await assertRelatedRecord(payloadRequest, authorization, relatedType, relatedId, user);
  }
  if (current.document.archiveStatus === "archived") throw new ActionGatewayError("STALE_RECORD", 409, "Sales record is archived.");
  if ((actionId === "sales.account.update" || actionId === "sales.contact.update") && current.state !== "active") throw new ActionGatewayError("STALE_RECORD", 409, "Sales record is not active.");
  if (actionId === "sales.lead.update" && !["new", "working"].includes(current.state)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead cannot be updated from its current state.");
  if (actionId === "sales.opportunity.update" && ["won", "lost"].includes(current.state)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity is closed.");
  if (actionId === "sales.opportunity.update" && parsed.primaryContactMode === "set") {
    const accountId = persistedWorkflowId(current.document.accountId, "Account ID");
    const contact = await assertRelatedRecord(payloadRequest, authorization, "sales.contact", workflowId(parsed.primaryContactId, "primary contact ID"), user, true, false);
    if (String(contact.accountId) !== accountId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity contact does not belong to its Account.");
  }
  if (["sales.contact.update", "sales.lead.update", "sales.opportunity.update"].includes(actionId)) protectedFieldAdmissions(authorization, actionId, parsed);
  if (actionId === "sales.opportunity.close" && current.state !== workflowText(parsed.expectedStage, "opportunity stage")) throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity changed before close.");
  if (actionId === "sales.opportunity.close" && ["won", "lost"].includes(current.state)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity is already closed.");
  if (actionId === "sales.opportunity.close" && parsed.stage === "won" && current.state !== "negotiation") throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity can only be won from negotiation.");
  if (actionId === "sales.lead.disqualify" && !["new", "working"].includes(current.state)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead cannot be disqualified from its current state.");
  if (actionId.endsWith(".archive") && current.state === "archived") throw new ActionGatewayError("STALE_RECORD", 409, "Sales record is already archived.");
  const revision = expectedRevision + 1;
  const nextState = actionId === "sales.opportunity.close" ? workflowText(parsed.stage, "opportunity stage") : actionId === "sales.lead.update" && current.state === "new" ? "working" : ("state" in spec ? spec.state : current.state);
  const transition = auditEntry(authorization, actionId, id, revision, current.state, nextState, eventId);
  const audit = appendWorkflowAudit(current.audit, transition, spec.collection, nextState, spec.stateField, current.document.ownerId as string, typeof current.document.teamId === "string" ? current.document.teamId : null);
  const update = await payloadRequest.payload.update({ collection: spec.collection, where: current.where, data: updateData(actionId, parsed, current.state, authorization, revision, audit), depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext(workflowEvent(actionId), transition, spec.stateField) });
  if (update.errors.length > 0 || update.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales record changed before update.");
  return workflowOutput(actionId, { id, revision, status: nextState });
};

type OwnershipRecordType = "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity";
type OwnershipInput = Readonly<{ recordType: OwnershipRecordType; id: string; expectedRevision: number; ownerId: string; teamId?: string }>;
type OwnershipOutput = Readonly<{ recordType: OwnershipRecordType; id: string; revision: number; ownerId: string; teamId?: string }>;
const ownershipCollections: Readonly<Record<OwnershipRecordType, WorkflowCollection>> = Object.freeze({ "sales.account": "sales-accounts", "sales.contact": "sales-contacts", "sales.lead": "sales-leads", "sales.opportunity": "sales-opportunities" });
function ownershipIdentity(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 160 || !actorIdPattern.test(value)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
  return value;
}
function ownershipInput(value: unknown): OwnershipInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !["recordType", "id", "expectedRevision", "ownerId", "teamId"].includes(key)) ||
    typeof value.recordType !== "string" || !Object.hasOwn(ownershipCollections, value.recordType) || typeof value.id !== "string" || !Number.isSafeInteger(value.expectedRevision) || typeof value.ownerId !== "string" || value.teamId !== undefined && typeof value.teamId !== "string") {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership input is invalid.");
  }
  return Object.freeze({ recordType: value.recordType as OwnershipRecordType, id: workflowId(value.id, "record ID"), expectedRevision: workflowRevision(value.expectedRevision), ownerId: ownershipIdentity(value.ownerId, "owner ID"), ...(value.teamId === undefined ? {} : { teamId: ownershipIdentity(value.teamId, "team ID") }) });
}
const ownershipOutputSchema: RuntimeSchema<OwnershipOutput> = { safeParse(value) { try {
  if (!isRecord(value) || Object.keys(value).some((key) => !["recordType", "id", "revision", "ownerId", "teamId"].includes(key)) ||
    typeof value.recordType !== "string" || !Object.hasOwn(ownershipCollections, value.recordType) || typeof value.id !== "string" || !Number.isSafeInteger(value.revision) || typeof value.ownerId !== "string" || value.teamId !== undefined && typeof value.teamId !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership output is invalid.");
  return { success: true as const, data: Object.freeze({ recordType: value.recordType as OwnershipRecordType, id: workflowId(value.id, "record ID"), revision: workflowRevision(value.revision), ownerId: ownershipIdentity(value.ownerId, "owner ID"), ...(value.teamId === undefined ? {} : { teamId: ownershipIdentity(value.teamId, "team ID") }) }) };
} catch (error) { return { success: false as const, error: error instanceof Error ? error : new Error("Sales ownership output is invalid.") }; } } };

export const salesOwnershipAssignHandler: ActionHandler<OwnershipInput, OwnershipOutput> = async ({ request, authorizationContext, input, idempotencyKey }) => {
  const parsed = ownershipInput(input);
  const authorization = writeAuthorization(authorizationContext, salesOwnershipAssignDescriptor.id, parsed.id);
  const replay = idempotencyReplay(authorization, ownershipOutputSchema); if (replay !== undefined) return replay;
  ownershipAdmission(authorization, parsed);
  const collection = ownershipCollections[parsed.recordType];
  const stateField = parsed.recordType === "sales.opportunity" ? "stageId" : "status";
  const current = await workflowCurrent(workflowPayload(request), authorization, collection, parsed.id, parsed.expectedRevision, stateField, undefined);
  const currentTeam = typeof current.document.teamId === "string" ? current.document.teamId : undefined;
  if (current.document.archiveStatus === "archived" || current.state === "archived" || current.state === "won" || current.state === "lost" || current.state === "qualified" || current.state === "disqualified" ||
    parsed.ownerId === current.document.ownerId && parsed.teamId === currentTeam) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership target is unavailable.");
  const revision = parsed.expectedRevision + 1;
  if (typeof current.document.ownerId !== "string" || current.document.ownerId.length === 0) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership history is invalid.");
  const transition = Object.freeze({
    ...auditEntry(authorization, salesOwnershipAssignDescriptor.id, parsed.id, revision, current.state, current.state, durableActionEventId(authorization, idempotencyKey)),
    ownership: Object.freeze({ oldOwnerId: current.document.ownerId, newOwnerId: parsed.ownerId, oldTeamId: currentTeam ?? null, newTeamId: parsed.teamId ?? null })
  });
  const event = parsed.recordType === "sales.account" ? "sales.event.account-changed" : parsed.recordType === "sales.contact" ? "sales.event.contact-changed" : parsed.recordType === "sales.lead" ? "sales.event.lead-changed" : "sales.event.opportunity-changed";
  const audit = appendWorkflowAudit(current.audit, transition, collection, current.state, stateField, parsed.ownerId, parsed.teamId ?? null);
  const updated = await workflowPayload(request).payload.update({ collection, where: current.where, data: { ownerId: parsed.ownerId, ...(parsed.teamId === undefined ? { teamId: null } : { teamId: parsed.teamId }), updatedBy: authorization.actorId, revision, audit }, depth: 0, overrideAccess: true, req: workflowPayload(request), context: eventContext(event, transition, stateField) });
  if (updated.errors.length !== 0 || updated.docs.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership changed before update.");
  return Object.freeze({ recordType: parsed.recordType, id: parsed.id, revision, ownerId: parsed.ownerId, ...(parsed.teamId === undefined ? {} : { teamId: parsed.teamId }) });
};
export const salesOwnershipAssignDefinition: ActionDefinition<OwnershipInput, OwnershipOutput> = Object.freeze({ descriptor: salesOwnershipAssignDescriptor, inputSchema: { safeParse(value: unknown) { try { return { success: true as const, data: ownershipInput(value) }; } catch (error) { return { success: false as const, error: error instanceof Error ? error : new Error("Sales ownership input is invalid.") }; } } }, outputSchema: ownershipOutputSchema });

export const salesTasksCollection: CollectionConfig = { ...salesTasksCoreCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesOpportunitiesCollection: CollectionConfig = { ...salesOpportunitiesCoreCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesAccountsCollectionWithEvents: CollectionConfig = { ...salesAccountsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesContactsCollectionWithEvents: CollectionConfig = { ...salesContactsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesLeadsCollectionWithEvents: CollectionConfig = { ...salesLeadsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesActivitiesCollectionWithEvents: CollectionConfig = { ...salesActivitiesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesNotesCollectionWithEvents: CollectionConfig = { ...salesNotesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesAttachmentReferencesCollectionWithEvents: CollectionConfig = { ...salesAttachmentReferencesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export { salesAccountsCollection, salesActivitiesCollection, salesAttachmentReferencesCollection, salesContactsCollection, salesLeadsCollection, salesNotesCollection, salesPipelinesCollection, salesPipelineStagesCollection, salesCoreCollectionSlugs, salesRelatedRecordTypes };
export const salesCoreCollections: readonly CollectionConfig[] = Object.freeze([
  salesAccountsCollectionWithEvents,
  salesContactsCollectionWithEvents,
  salesLeadsCollectionWithEvents,
  salesPipelinesCollection,
  salesPipelineStagesCollection,
  salesActivitiesCollectionWithEvents,
  salesOpportunitiesCollection,
  salesTasksCollection,
  salesNotesCollectionWithEvents,
  salesAttachmentReferencesCollectionWithEvents
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
    context.register("sources", salesAccountsDescriptor.id, salesAccountsDefinition);
    context.register("sources", salesAccountDetailDescriptor.id, salesAccountDetailDefinition);
    context.register("sources", salesContactsDescriptor.id, salesContactsDefinition);
    context.register("sources", salesContactDetailDescriptor.id, salesContactDetailDefinition);
    context.register("sources", salesLeadsDescriptor.id, salesLeadsDefinition);
    context.register("sources", salesLeadDetailDescriptor.id, salesLeadDetailDefinition);
    context.register("sources", salesOpportunityDetailDescriptor.id, salesOpportunityDetailDefinition);
    context.register("sources", salesTimelineDescriptor.id, salesTimelineDefinition);
    context.register("actions", salesTaskCreateDescriptor.id, salesTaskCreateDefinition);
    context.register("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateDefinition);
    context.register("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateDefinition);
    for (const definition of salesWorkflowActionDefinitions) context.register("actions", definition.descriptor.id, definition);
    context.register("actions", salesOwnershipAssignDescriptor.id, salesOwnershipAssignDefinition);
    context.register("tools", salesSearchTasksDescriptor.id, salesSearchTasksDescriptor);
    context.register("tools", salesCreateTaskToolDescriptor.id, salesCreateTaskToolDescriptor);
    for (const descriptor of salesEventDescriptors) context.register("events", descriptor.id, descriptor);
    for (const descriptor of salesRealtimeTopicDescriptors) context.register("realtimeTopics", descriptor.id, descriptor);
  },
  schema: (context) => {
    const collections = [
      ["sales.accounts.collection", salesAccountsCollectionWithEvents],
      ["sales.contacts.collection", salesContactsCollectionWithEvents],
      ["sales.leads.collection", salesLeadsCollectionWithEvents],
      ["sales.pipelines.collection", salesPipelinesCollection],
      ["sales.pipeline-stages.collection", salesPipelineStagesCollection],
      ["sales.activities.collection", salesActivitiesCollectionWithEvents],
      ["sales.opportunities.collection", salesOpportunitiesCollection],
      ["sales.tasks.collection", salesTasksCollection],
      ["sales.notes.collection", salesNotesCollectionWithEvents],
      ["sales.attachment-references.collection", salesAttachmentReferencesCollectionWithEvents]
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
    context.bind("sources", salesAccountsDescriptor.id, salesAccountsHandler);
    context.bind("sources", salesAccountDetailDescriptor.id, salesAccountDetailHandler);
    context.bind("sources", salesContactsDescriptor.id, salesContactsHandler);
    context.bind("sources", salesContactDetailDescriptor.id, salesContactDetailHandler);
    context.bind("sources", salesLeadsDescriptor.id, salesLeadsHandler);
    context.bind("sources", salesLeadDetailDescriptor.id, salesLeadDetailHandler);
    context.bind("sources", salesOpportunityDetailDescriptor.id, salesOpportunityDetailHandler);
    context.bind("sources", salesTimelineDescriptor.id, salesTimelineHandler);
    context.bind("actions", salesTaskCreateDescriptor.id, salesTaskCreateHandler as ActionHandler);
    context.bind("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateHandler as ActionHandler);
    context.bind("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateHandler as ActionHandler);
    for (const definition of salesWorkflowActionDefinitions) context.bind("actions", definition.descriptor.id, salesWorkflowActionHandler as ActionHandler);
    context.bind("actions", salesOwnershipAssignDescriptor.id, salesOwnershipAssignHandler as ActionHandler);
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
