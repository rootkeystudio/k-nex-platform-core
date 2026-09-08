import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ActionDescriptorSchema,
  AgentToolDescriptorSchema,
  DataSourceDescriptorSchema,
  AuthorizationPermissionDescriptorSchema,
  PermissionPolicyBindingSchema,
  PluginManifestSchema,
  PluginNavigationDescriptorSchema,
  PluginPageTemplateDescriptorSchema,
  PluginRouteDescriptorSchema,
  SystemSettingsDescriptorSchema,
  PluginUiContributionDescriptorSchema,
  RoleTemplateSchema,
  canonicalJson
} from "@k-nex/contracts";
import salesManifest from "../k-nex.plugin.json" with { type: "json" };

import {
  salesCreateTaskToolDescriptor,
  salesCreateTaskOutputRuntimeSchema,
  salesEventDescriptors,
  salesWorkflowTriggerDescriptors,
  salesNavigationDescriptors,
  salesOpportunityFields,
  salesOpportunitiesDescriptor,
  salesOpportunitiesOutputRuntimeSchema,
  salesRealtimeTopicDescriptors,
  salesRouteDescriptors,
  salesSearchTasksDescriptor,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesUpdateTaskInputRuntimeSchema,
  salesUpdateTaskOutputRuntimeSchema,
  salesOpportunityStageUpdateDescriptor,
  salesOpportunityStageInputRuntimeSchema,
  salesOpportunityStageOutputRuntimeSchema,
  salesPageTemplates,
  salesReportsPageTemplate,
  salesNotificationsPageTemplate,
  salesProviderConfigurationsDescriptor,
  salesReportDescriptors,
  salesWonLostConversionDescriptor,
  salesLeadConversionDescriptor,
  salesSalesCycleDurationDescriptor,
  salesWeightedForecastDescriptor,
  salesReportRunDescriptor,
  salesReportScheduleDescriptor,
  salesMetricOutputRuntimeSchema,
  salesReferenceMetadata,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesTaskTableBlockDescriptor,
  salesTaskTableComponentDescriptor,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  salesWorkspaceSettingsDescriptor
} from "../dist/contracts.js";
import {
  createSalesRealtimeRelay,
  salesDefaultSettings,
  salesOpportunitiesHandler,
  salesLeadDetailHandler,
  salesPipelineAuditJob,
  salesOpportunityStageUpdateHandler,
  salesRegistration,
  salesTaskCreateDefinition,
  salesTaskCreateHandler,
  salesTaskUpdateHandler,
  salesTasksDefinition,
  salesTasksHandler,
  salesCrmActionDescriptors,
  salesCrmRouteDescriptors,
  salesWorkflowActionDefinitions,
  salesWorkflowActionHandler,
  salesCommunicationActionHandler,
  salesReportActionHandler,
  salesWeightedForecastHandler,
  salesPermissionPolicyExecutors,
  projectSalesStateHistory,
  createSalesImportGenesisAudit,
  createSalesMergeAuditTransition,
  createSalesDataMovementJobAudit,
  createSalesDataMovementJobOutbox,
  salesDataMovementJobTransitions,
  salesDataMovementObjectEvent,
  createSalesRecipientAuditEntry,
  appendSalesRecipientAudit,
  validateSalesRecipientAuditHistory,
  salesEventAfterChange,
  salesPipelineStageId,
  salesProviderConfigurationsHandler
} from "../dist/server.js";

const qualificationStageId = salesPipelineStageId("customer-gate-1", "production", 17, "qualification");
const discoveryStageId = salesPipelineStageId("customer-gate-1", "production", 17, "discovery");
const proposalStageId = salesPipelineStageId("customer-gate-1", "production", 17, "proposal");
const negotiationStageId = salesPipelineStageId("customer-gate-1", "production", 17, "negotiation");
const wonStageId = salesPipelineStageId("customer-gate-1", "production", 17, "won");
const lostStageId = salesPipelineStageId("customer-gate-1", "production", 17, "lost");
const stageSemantics = new Map([[qualificationStageId, "qualification"], [discoveryStageId, "discovery"], [proposalStageId, "proposal"], [negotiationStageId, "negotiation"], [wonStageId, "won"], [lostStageId, "lost"]]);
const stageTransitions = new Map([[qualificationStageId, [discoveryStageId, lostStageId]], [discoveryStageId, [proposalStageId, lostStageId]], [proposalStageId, [negotiationStageId, lostStageId]], [negotiationStageId, [wonStageId, lostStageId]], [wonStageId, []], [lostStageId, []]]);
const stageMove = (id, expectedRevision, source, destination) => ({ id, expectedRevision, expectedPipelineId: "17", expectedPipelineRevision: 2, expectedSourceStageId: source, expectedSourceStageRevision: 2, destinationStageId: destination, expectedDestinationStageRevision: 2 });
const recipientAudit = (actionId, resourceId, fromState, toState, revision, idempotencyKey) => ({ actionId, resourceId, applicationId: "customer-gate-1", environment: "production", fromState, toState, occurredAt: `2026-09-08T12:00:0${revision}.000Z`, actorId: "user-1", revision, idempotencyKey });
const p134StageFind = (state, options) => {
  if (options.collection === "sales-opportunities") return { docs: [structuredClone(state)] };
  if (options.collection === "sales-pipelines") return { docs: [{ id: "17", revision: 2, status: "active", isActive: true }] };
  const stageId = options.where.and.find((clause) => clause.stageId)?.stageId.equals;
  return { docs: [{ id: stageId, pipelineId: 17, stageId, revision: 2, status: "active", semantic: stageSemantics.get(stageId), allowedTransitionStageIds: stageTransitions.get(stageId), requiredFieldIds: stageId === lostStageId ? ["lossReason"] : [] }] };
};

test("reminder schedule remains source-bound under recipient block contract", () => {
  const node = salesNotificationsPageTemplate.document.regions.main.find(({ id }) => id === "reminder-schedule");
  assert.equal(node?.bindings?.action?.id, "sales.reminder.schedule");
  assert.equal(node?.bindings?.source?.source.id, "sales.reminders");
  assert.deepEqual(node?.bindings?.source?.selectedFields, ["subject", "state", "scheduled-at", "reference-kind", "reference-id", "revision"]);
});

test("recipient delivery audit chains preserve genesis and every fenced lifecycle transition", () => {
  const notificationIdentity = { resourceId: "41", applicationId: "customer-gate-1", environment: "production", revision: 1, state: "unread" };
  const delivered = createSalesRecipientAuditEntry(recipientAudit("sales.notification.deliver", "41", "absent", "unread", 1, "notification-deliver-41"), "sales-notifications");
  const read = createSalesRecipientAuditEntry(recipientAudit("sales.notification.read", "41", "unread", "read", 2, "notification-read-41"), "sales-notifications");
  const afterRead = appendSalesRecipientAudit([delivered], "sales-notifications", notificationIdentity, read);
  assert.equal(afterRead.length, 2); assert.equal(afterRead.at(-1)?.toState, "read");
  const archive = createSalesRecipientAuditEntry(recipientAudit("sales.notification.archive", "41", "read", "archived", 3, "notification-archive-41"), "sales-notifications");
  const afterArchive = appendSalesRecipientAudit(afterRead, "sales-notifications", { ...notificationIdentity, revision: 2, state: "read" }, archive);
  assert.equal(validateSalesRecipientAuditHistory(afterArchive, "sales-notifications", { ...notificationIdentity, revision: 3, state: "archived" }).length, 3);
  assert.throws(() => createSalesRecipientAuditEntry(recipientAudit("sales.notification.archive", "41", "unread-or-read", "archived", 3, "notification-archive-invalid"), "sales-notifications"));

  const reminderIdentity = { resourceId: "42", applicationId: "customer-gate-1", environment: "production", revision: 1, state: "scheduled" };
  const scheduled = createSalesRecipientAuditEntry(recipientAudit("sales.reminder.schedule", "42", "absent", "scheduled", 1, "reminder-schedule-42"), "sales-reminders");
  const workerDelivered = createSalesRecipientAuditEntry(recipientAudit("sales.job.reminder-delivery", "42", "scheduled", "delivered", 2, "reminder-deliver-42"), "sales-reminders");
  const deliveredReminder = appendSalesRecipientAudit([scheduled], "sales-reminders", reminderIdentity, workerDelivered);
  const dismiss = createSalesRecipientAuditEntry(recipientAudit("sales.reminder.dismiss", "42", "delivered", "dismissed", 3, "reminder-dismiss-42"), "sales-reminders");
  assert.equal(appendSalesRecipientAudit(deliveredReminder, "sales-reminders", { ...reminderIdentity, revision: 2, state: "delivered" }, dismiss).at(-1)?.toState, "dismissed");
  const cancel = createSalesRecipientAuditEntry(recipientAudit("sales.reminder.dismiss", "42", "scheduled", "cancelled", 2, "reminder-cancel-42"), "sales-reminders");
  assert.equal(appendSalesRecipientAudit([scheduled], "sales-reminders", reminderIdentity, cancel).at(-1)?.toState, "cancelled");
});

test("communication writes require exact locked relation admissions and finalize resource-bound genesis", async () => {
  const actor = handlerContext().actor;
  const gatewayResult = (intent) => ({ operationId: "provider-operation-91", state: "queued", providerId: intent.actionId === "sales.email.send" ? "email.reference.v1" : "calendar.reference.v1", receipt: { idempotencyDigest: `sha256:${"a".repeat(64)}`, relatedRecord: intent.relatedRecord } });
  const emailCreates = []; const emailUpdates = []; const dispatched = [];
  const emailRequest = handlerContext({ request: { payload: {
    find: async () => ({ docs: [] }),
    create: async (options) => { emailCreates.push(options); return { id: 91 }; },
    update: async (options) => { emailUpdates.push(options); return { id: 91, revision: 1, status: "scheduled" }; }
  } } }).request;
  const emailDecision = { actionId: "sales.email.send", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", communicationRelationAdmission: { actionId: "sales.email.send", recordType: "sales.contact", recordId: "17", applicationId: "customer-gate-1", environment: "production", revision: 4, status: "active", archiveStatus: null, ownerId: "contact-owner", teamId: "contact-team" } };
  const emailContext = { decision: emailDecision, providerGateway: { dispatch: async (intent) => { dispatched.push(intent); return gatewayResult(intent); } } };
  assert.deepEqual(await salesCommunicationActionHandler({ actor, request: emailRequest, authorizationContext: emailContext, input: { providerId: "email.reference.v1", relatedRecordType: "sales.contact", relatedRecordId: "17", subject: "Follow up", body: "Hello" }, idempotencyKey: "email-send-91", signal: new AbortController().signal }), { id: "91", revision: 1, status: "accepted" });
  assert.equal(emailCreates.length, 1); assert.equal(emailCreates[0].data.teamId, "contact-team"); assert.deepEqual(emailCreates[0].data.audit, []);
  assert.equal(emailUpdates.length, 1); assert.equal(emailUpdates[0].id, "91"); assert.equal(emailUpdates[0].data.audit[0].resourceId, "91"); assert.equal(emailUpdates[0].data.audit[0].actionId, "sales.email.send");
  assert.equal(dispatched[0].payload.activityId, 91); assert.deepEqual(dispatched[0].relatedRecord, { type: "sales.contact", id: 17 });

  await assert.rejects(salesCommunicationActionHandler({ actor, request: emailRequest, authorizationContext: { ...emailContext, decision: { ...emailDecision, communicationRelationAdmission: { ...emailDecision.communicationRelationAdmission, teamId: null } } }, input: { providerId: "email.reference.v1", relatedRecordType: "sales.contact", relatedRecordId: "17", subject: "Blocked", body: "Blocked" }, idempotencyKey: "email-send-null-team", signal: new AbortController().signal }), (error) => error?.code === "ACTION_FORBIDDEN");
  assert.equal(emailCreates.length, 1, "invalid admission must fail before Activity creation");

  const reminderCreates = []; const reminderUpdates = [];
  const reminderRequest = handlerContext({ request: { payload: {
    find: async () => ({ docs: [{ id: "27", revision: 3, status: "open", relatedRecordType: "sales.contact", relatedRecordId: "17", audit: [] }] }),
    create: async (options) => { reminderCreates.push(options); return { id: 92 }; },
    update: async (options) => { reminderUpdates.push(options); return { id: 92, revision: 1, state: "scheduled" }; }
  } } }).request;
  const reminderDecision = { actionId: "sales.reminder.schedule", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", resourceId: "27", communicationRelationAdmission: { actionId: "sales.reminder.schedule", recordType: "sales.task", recordId: "27", applicationId: "customer-gate-1", environment: "production", revision: 3, status: "open", archiveStatus: null, ownerId: "task-owner", teamId: null } };
  assert.deepEqual(await salesCommunicationActionHandler({ actor, request: reminderRequest, authorizationContext: reminderDecision, input: { referenceKind: "task", referenceId: "27", expectedRevision: 3, scheduledAt: "2026-09-09T12:00:00.000Z", subject: "Call customer" }, idempotencyKey: "reminder-schedule-92", signal: new AbortController().signal }), { id: "92", revision: 1, status: "scheduled" });
  assert.match(reminderCreates[0].data.idempotencyDigest, /^sha256:[0-9a-f]{64}$/u); assert.deepEqual(reminderCreates[0].data.audit, []);
  assert.equal(reminderUpdates[0].id, "92"); assert.equal(reminderUpdates[0].data.audit[0].resourceId, "92"); assert.equal(reminderUpdates[0].data.audit[0].actionId, "sales.reminder.schedule");
});

test("qualified Lead detail projects only bounded lineage cells", async () => {
  let select;
  const result = await salesLeadDetailHandler(handlerContext({
    input: { id: "7" },
    selectedFields: ["display-name", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"],
    recordScope: salesScope("sales.lead.detail"),
    request: { payload: { find: async (request) => {
      select = request.select;
      return { docs: [{ id: 7, displayName: "Qualified lead", qualifiedAccountId: "8", qualifiedContactId: "9", qualifiedOpportunityId: "10" }], hasNextPage: false };
    } } }
  }));
  assert.deepEqual(select, { id: true, displayName: true, qualifiedAccountId: true, qualifiedContactId: true, qualifiedOpportunityId: true });
  assert.deepEqual(result.rows[0], { key: "7", values: {
    "display-name": { kind: "text", value: "Qualified lead" },
    "qualified-account-id": { kind: "integer", value: 8 },
    "qualified-contact-id": { kind: "integer", value: 9 },
    "qualified-opportunity-id": { kind: "integer", value: 10 }
  } });
});
import {
  salesCrmPermissionDescriptors,
  salesCrmObjectFieldActionMatrix,
  salesCrmPermissionPolicyBindings,
  salesCrmRoleTemplates
} from "../dist/crm-authority.js";

test("Sales CRM action outputs are exact and action-specific", () => {
  const definition = (id) => salesWorkflowActionDefinitions.find((candidate) => candidate.descriptor.id === id);
  assert.equal(definition("sales.account.create").outputSchema.safeParse({ id: "1", revision: 1, status: "active" }).success, true);
  assert.equal(definition("sales.account.create").outputSchema.safeParse({ id: "1", revision: 1, status: "active", secret: "leak" }).success, false);
  assert.equal(definition("sales.account.create").outputSchema.safeParse({ id: "1", revision: 1, status: "qualified" }).success, false);
  assert.equal(definition("sales.account.create").outputSchema.safeParse({ id: "not-an-id", revision: 1, status: "active" }).success, false);
  assert.equal(definition("sales.lead.qualify").outputSchema.safeParse({ id: "1", revision: 2, status: "qualified", accountId: "2", contactId: "3", opportunityId: "4" }).success, true);
  assert.equal(definition("sales.lead.qualify").outputSchema.safeParse({ id: "1", revision: 2, status: "qualified", accountId: "2", contactId: "3" }).success, false);
});

test("lead qualification accepts only exact ordered host linked-record admissions", async () => {
  const input = { id: "1", expectedRevision: 1, accountMode: "link", accountId: "2", contactMode: "link", contactId: "3", opportunityName: "Qualified opportunity", pipelineId: "4" };
  const account = { recordType: "sales.account", recordId: "2", applicationId: "customer-gate-1", environment: "production" };
  const contact = { recordType: "sales.contact", recordId: "3", applicationId: "customer-gate-1", environment: "production" };
  const base = { actionId: "sales.lead.qualify", resourceId: "1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", teamId: "team:user-1", eventId: "qualification-admission-test" };
  const request = { payload: { find: async () => { throw new Error("admission reached storage"); }, create: async () => { throw new Error("admission reached storage"); }, update: async () => { throw new Error("admission reached storage"); } } };
  for (const linkedRecordAdmissions of [undefined, [account], [contact, account], [account, account], [account, contact, contact], [{ ...account, recordId: "9" }], [{ ...account, environment: "staging" }, contact], [{ ...account, extra: true }, contact]]) {
    await assert.rejects(salesWorkflowActionHandler({ actor: handlerContext().actor, request, authorizationContext: { ...base, ...(linkedRecordAdmissions === undefined ? {} : { linkedRecordAdmissions }) }, input, idempotencyKey: "qualification-admission", signal: new AbortController().signal }), /Sales linked-record admission is invalid/u);
  }
  const createInput = { id: "1", expectedRevision: 1, accountMode: "create", accountName: "Created", contactMode: "create", contactName: "Created", opportunityName: "Qualified opportunity", pipelineId: "4" };
  await assert.rejects(salesWorkflowActionHandler({ actor: handlerContext().actor, request, authorizationContext: { ...base, linkedRecordAdmissions: [] }, input: createInput, idempotencyKey: "qualification-create-admission", signal: new AbortController().signal }), /Sales linked-record admission is invalid/u);
});

test("committed task and v3 opportunity actions preserve opaque record IDs", async () => {
  const id = `legacy-${"x".repeat(121)}`;
  assert.equal(id.length, 128);
  const taskOutput = { id, title: "Legacy task", status: "open", revision: 1 };
  const taskUpdate = { id, expectedRevision: 1, expectedStatus: "open", status: "completed" };
  const opportunityInput = { id, expectedRevision: 1, expectedPipelineId: "17", expectedPipelineRevision: 2, expectedSourceStageId: qualificationStageId, expectedSourceStageRevision: 2, destinationStageId: discoveryStageId, expectedDestinationStageRevision: 2 };
  const opportunityOutput = { id, pipelineId: "17", stageId: discoveryStageId, revision: 2 };
  assert.equal(salesCreateTaskOutputRuntimeSchema.safeParse(taskOutput).success, true);
  assert.equal(salesUpdateTaskInputRuntimeSchema.safeParse(taskUpdate).success, true);
  assert.equal(salesUpdateTaskOutputRuntimeSchema.safeParse({ ...taskOutput, status: "completed", revision: 2 }).success, true);
  assert.equal(salesOpportunityStageInputRuntimeSchema.safeParse(opportunityInput).success, true);
  assert.equal(salesOpportunityStageOutputRuntimeSchema.safeParse(opportunityOutput).success, true);
  const opaqueIdSchema = { type: "string", minLength: 1, maxLength: 128 };
  assert.deepEqual(salesTaskCreateDescriptor.outputSchema.properties.id, opaqueIdSchema);
  assert.deepEqual(salesTaskUpdateDescriptor.inputSchema.properties.id, opaqueIdSchema);
  assert.deepEqual(salesTaskUpdateDescriptor.outputSchema.properties.id, opaqueIdSchema);
  assert.deepEqual(salesOpportunityStageUpdateDescriptor.inputSchema.properties.id, opaqueIdSchema);
  assert.deepEqual(salesOpportunityStageUpdateDescriptor.outputSchema.properties.id, opaqueIdSchema);
  const overlong = `${id}x`;
  assert.equal(salesCreateTaskOutputRuntimeSchema.safeParse({ ...taskOutput, id: overlong }).success, false);
  assert.equal(salesUpdateTaskInputRuntimeSchema.safeParse({ ...taskUpdate, id: overlong }).success, false);
  assert.equal(salesOpportunityStageInputRuntimeSchema.safeParse({ ...opportunityInput, id: overlong }).success, false);

  const actor = handlerContext().actor;
  const request = { payload: { find: async () => { throw new Error("replay found"); }, create: async () => { throw new Error("replay created"); }, update: async () => { throw new Error("replay updated"); } } };
  const authorization = (actionId, replay) => ({ actionId, resourceId: id, applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", idempotencyReplay: replay });
  assert.deepEqual(await salesTaskUpdateHandler({ actor, request, authorizationContext: authorization("sales.task.update", { ...taskOutput, status: "completed", revision: 2 }), input: taskUpdate, idempotencyKey: "legacy-task-replay", signal: new AbortController().signal }), { ...taskOutput, status: "completed", revision: 2 });
  assert.deepEqual(await salesOpportunityStageUpdateHandler({ actor, request, authorizationContext: authorization("sales.opportunity.stage.update", opportunityOutput), input: opportunityInput, idempotencyKey: "legacy-opportunity-replay", signal: new AbortController().signal }), opportunityOutput);
});

function handlerContext(overrides = {}) {
  const base = {
    actor: { principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" } },
    request: {
      payload: { find: async () => ({ docs: [], hasNextPage: false }) },
      applicationIdentity: { applicationId: "customer-gate-1", environment: "production" },
      locale: "en-US",
      transactionID: "tx-7"
    },
    input: {},
    query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
    selectedFields: ["title", "status"],
    recordScope: salesScope("sales.tasks"),
    signal: new AbortController().signal
  };
  return { ...base, ...overrides, request: { ...base.request, ...overrides.request, payload: { ...base.request.payload, ...overrides.request?.payload } } };
}

function salesScope(kind) {
  return {
    kind,
    where: { and: [
      { applicationId: { equals: "customer-gate-1" } },
      { environment: { equals: "production" } },
      { ownerId: { equals: "user-1" } }
    ] }
  };
}

test("provider configuration source exposes only closed safe status through host read gateway", async () => {
  let gatewayInput;
  const rows = [
    { providerId: "email.reference.v1", state: "active", revision: 3, updatedAt: "2026-09-08T12:00:00.000Z", revokedAt: null },
    { providerId: "calendar.reference.v1", state: "revoked", revision: 4, updatedAt: "2026-09-08T12:01:00.000Z", revokedAt: "2026-09-08T12:01:00.000Z" }
  ];
  const result = await salesProviderConfigurationsHandler(handlerContext({
    selectedFields: ["provider-id", "state", "revision", "updated-at", "revoked-at"],
    request: { providerConfigurationReadGateway: { read: async (input) => { gatewayInput = input; return rows; } } }
  }));
  assert.deepEqual(gatewayInput, { applicationId: "customer-gate-1", environment: "production", actorId: "user-1" });
  assert.deepEqual(result.fields, ["provider-id", "state", "revision", "updated-at", "revoked-at"]);
  assert.deepEqual(result.rows.map(({ key }) => key), ["calendar.reference.v1", "email.reference.v1"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  await assert.rejects(salesProviderConfigurationsHandler(handlerContext({
    selectedFields: ["provider-id"],
    request: { providerConfigurationReadGateway: { read: async () => [{ ...rows[0], secretReference: "host-secret-slot" }] } }
  })), (error) => error?.code === "INVALID_SOURCE_OUTPUT" && error?.status === 500);
  await assert.rejects(salesProviderConfigurationsHandler(handlerContext({ selectedFields: ["provider-id"], request: {} })), (error) => error?.code === "SOURCE_FORBIDDEN" && error?.status === 403);
});

function assertActionAudit(entry, expected) {
  assert.deepEqual({
    actionId: entry.actionId,
    resourceId: entry.resourceId,
    applicationId: entry.applicationId,
    environment: entry.environment,
    fromState: entry.fromState,
    toState: entry.toState,
    actorId: entry.actorId,
    revision: entry.revision,
    idempotencyKey: entry.idempotencyKey
  }, expected);
  assert.equal(new Date(entry.occurredAt).toISOString(), entry.occurredAt);
}

function structuralHash(descriptor) {
  return `sha256:${createHash("sha256").update(canonicalJson({
    id: descriptor.id,
    version: descriptor.version,
    primaryContract: descriptor.primaryContract,
    sourceSchema: descriptor.sourceSchema,
    inputFields: descriptor.inputFields,
    outputFields: descriptor.outputFields ?? [],
    paginationModes: descriptor.paginationModes,
    limits: descriptor.limits
  })).digest("hex")}`;
}

test("Sales registers active successor sources and frozen authority", () => {
  assert.equal(DataSourceDescriptorSchema.safeParse(salesTasksDescriptor).success, true);
  assert.equal(DataSourceDescriptorSchema.safeParse(salesOpportunitiesDescriptor).success, true);
  assert.equal(salesTasksDescriptor.structuralCompatibilityHash, structuralHash(salesTasksDescriptor));
  assert.equal(salesOpportunitiesDescriptor.structuralCompatibilityHash, structuralHash(salesOpportunitiesDescriptor));
  assert.equal(salesProviderConfigurationsDescriptor.structuralCompatibilityHash, structuralHash(salesProviderConfigurationsDescriptor));
  assert.deepEqual(salesProviderConfigurationsDescriptor.outputFields.map(({ id }) => id), ["provider-id", "state", "revision", "updated-at", "revoked-at"]);
  assert.equal(salesProviderConfigurationsDescriptor.permission, "sales.settings.read");
  assert.equal(salesTasksDefinition.descriptor.primaryContract.id, "table.records");
  assert.deepEqual(salesTasksDescriptor.outputFields.map(({ id }) => id), ["title", "status"]);
  assert.deepEqual(salesOpportunitiesDescriptor.outputFields.map(({ id }) => id), ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision", "amount"]);
  assert.deepEqual(salesOpportunitiesDescriptor, {
    id: "sales.opportunities", version: 3, ownerPluginId: "module.sales",
    primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id: "sales.opportunities.output", version: 3 },
    audience: "authenticated", surfaces: ["workspace"], permission: "sales.opportunities.read",
    structuralCompatibilityHash: "sha256:82668a173c4ee1ce38924b5f99846f86644f437a3926299927cf979426f826ad",
    presentationMetadataRevision: 1, title: "Sales opportunities", inputFields: [], outputFields: salesOpportunityFields,
    paginationModes: ["offset"], limits: { maxSelectedFields: 9, maxPageSize: 100, maxFilters: 8, maxSorts: 2, maxBodyBytes: 32_768, maxResultBytes: 1_048_576, maxDepth: 6, timeoutMs: 5_000, maxConcurrency: 4, ratePerMinute: 300, burst: 30, costClass: "medium", maxCost: 100 }, cacheClass: "actor"
  });
  const permissionIds = new Set(salesCrmPermissionDescriptors.map(({ id }) => id));
  for (const descriptor of [salesTasksDescriptor, salesOpportunitiesDescriptor]) {
    assert.equal(permissionIds.has(descriptor.permission), true, `${descriptor.id} must reference a declared permission`);
  }

  const contributions = [];
  const bindings = [];
  salesRegistration.contracts?.({ pluginId: "module.sales", services: { get: () => undefined }, register: (kind, id) => contributions.push([kind, id]) });
  salesRegistration.dataHandlers?.({ pluginId: "module.sales", services: { get: () => undefined }, bind: (kind, id) => bindings.push([kind, id]) });
  salesRegistration.ui?.({
    pluginId: "module.sales",
    services: { get: () => undefined },
    register: (kind, id) => contributions.push([kind, id]),
    bindRenderer: (kind, id) => bindings.push([kind, id])
  });
  assert.deepEqual(contributions.filter(([kind]) => kind === "sources").map(([, id]) => id).sort(), ["sales.account.detail", "sales.accounts", "sales.contact.detail", "sales.contacts", "sales.dedupe.candidates", "sales.export-job.detail", "sales.export-job.list", "sales.import-job.detail", "sales.import-job.list", "sales.lead.detail", "sales.leads", "sales.notifications", "sales.opportunities", "sales.opportunity.detail", "sales.pipeline.snapshot", "sales.provider-configurations", "sales.reminders", "sales.report.activity-by-owner-team", "sales.report.lead-conversion", "sales.report.pipeline-value-by-stage", "sales.report.sales-cycle-duration", "sales.report.task-aging", "sales.report.weighted-forecast", "sales.report.won-lost-conversion", "sales.saved-view.calendar", "sales.saved-view.detail", "sales.saved-view.kanban", "sales.saved-view.list", "sales.saved-view.table", "sales.tasks", "sales.timeline"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "actions").map(([, id]) => id).sort(), salesManifest.contributions.actions && Object.keys(salesManifest.contributions.actions).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "tools").map(([, id]) => id).sort(), ["sales.tools.create-task", "sales.tools.search-tasks"]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "permissions").map(([, id]) => id).sort(), salesCrmPermissionDescriptors.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "policyBindings").map(([, id]) => id).sort(), salesCrmPermissionPolicyBindings.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "roleTemplates").map(([, id]) => id).sort(), salesCrmRoleTemplates.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "settings").map(([, id]) => id), [salesWorkspaceSettingsDescriptor.id]);
  assert.deepEqual(contributions.filter(([kind]) => kind === "routes").map(([, id]) => id).sort(), salesRouteDescriptors.map(({ id }) => id).sort());
  assert.deepEqual(contributions.filter(([kind]) => kind === "navigation").map(([, id]) => id), salesNavigationDescriptors.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "pageTemplates").map(([, id]) => id), salesPageTemplates.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "components").map(([, id]) => id), salesUiComponentDescriptors.map(({ id }) => id));
  assert.deepEqual(contributions.filter(([kind]) => kind === "blocks").map(([, id]) => id), salesUiBlockDescriptors.map(({ id }) => id));
  assert.deepEqual(bindings.filter(([kind]) => kind === "sources").map(([, id]) => id).sort(), ["sales.account.detail", "sales.accounts", "sales.contact.detail", "sales.contacts", "sales.dedupe.candidates", "sales.export-job.detail", "sales.export-job.list", "sales.import-job.detail", "sales.import-job.list", "sales.lead.detail", "sales.leads", "sales.notifications", "sales.opportunities", "sales.opportunity.detail", "sales.pipeline.snapshot", "sales.provider-configurations", "sales.reminders", "sales.report.activity-by-owner-team", "sales.report.lead-conversion", "sales.report.pipeline-value-by-stage", "sales.report.sales-cycle-duration", "sales.report.task-aging", "sales.report.weighted-forecast", "sales.report.won-lost-conversion", "sales.saved-view.calendar", "sales.saved-view.detail", "sales.saved-view.kanban", "sales.saved-view.list", "sales.saved-view.table", "sales.tasks", "sales.timeline"]);
  assert.deepEqual(bindings.filter(([kind]) => kind === "actions").map(([, id]) => id).sort(), salesManifest.contributions.actions && Object.keys(salesManifest.contributions.actions).sort());
  assert.deepEqual(bindings.filter(([kind]) => kind === "components").map(([, id]) => id), salesUiComponentDescriptors.map(({ id }) => id));
  assert.deepEqual(bindings.filter(([kind]) => kind === "blocks").map(([, id]) => id), salesUiBlockDescriptors.map(({ id }) => id));
});

test("P13.8 report catalog is closed, source-bound, and delegates only through the reporting gateway", async () => {
  assert.deepEqual(salesReportDescriptors.map(({ id }) => id), ["sales.report.pipeline-value-by-stage", "sales.report.weighted-forecast", "sales.report.won-lost-conversion", "sales.report.lead-conversion", "sales.report.activity-by-owner-team", "sales.report.task-aging", "sales.report.sales-cycle-duration"]);
  for (const descriptor of salesReportDescriptors) {
    assert.equal(DataSourceDescriptorSchema.safeParse(descriptor).success, true);
    assert.equal(descriptor.permission, "sales.reports.read");
    assert.equal(descriptor.limits.timeoutMs, 1_000);
    assert.equal(descriptor.limits.maxDepth, 3);
    assert.equal(descriptor.limits.maxFilters, 0);
    assert.equal(descriptor.limits.maxSorts, 0);
  }
  assert.equal(salesMetricOutputRuntimeSchema.safeParse({ value: { kind: "money", value: "12.50", currency: "USD", scale: 2 } }).success, true);
  assert.deepEqual([salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesSalesCycleDurationDescriptor].map(({ primaryContract }) => primaryContract), [{ id: "metric.scalar", version: 2 }, { id: "metric.scalar", version: 2 }, { id: "metric.scalar", version: 2 }]);
  assert.deepEqual(salesWeightedForecastDescriptor.primaryContract, { id: "metric.scalar", version: 1 });
  assert.deepEqual(salesNavigationDescriptors.find(({ id }) => id === "sales.navigation.reports"), { id: "sales.navigation.reports", ownerPluginId: "module.sales", labelMessageId: "sales.message.navigation-reports", route: { routeId: "sales.route.reports", params: {} }, permission: "sales.reports.read", order: 11 });
  const reportInputs = Object.fromEntries(salesReportsPageTemplate.document.regions.main.map((node) => [node.id, node.bindings?.source?.input]));
  assert.deepEqual(reportInputs, {
    "pipeline-value-by-stage": {}, "weighted-forecast": {}, "won-lost-conversion": { "window-mode": "current-reporting-week" }, "lead-conversion": { "window-mode": "current-reporting-week" }, "activity-by-owner-team": { "window-mode": "current-reporting-week" }, "task-aging": {}, "sales-cycle-duration": { "window-mode": "current-reporting-week" }
  });
  const reportAuthority = { authorizationRevision: 7, lifecycleRevision: 2, salesScopeRevision: 5, settingsRevision: 3, reportingTimezone: "UTC", reportingCurrency: "USD", runtimeGenerationId: "runtime-sales-1", reportPermissionGrants: ["sales.reports.read"], objectPermissionGrants: ["sales.opportunities.read", "sales.pipelines.read"], fieldPermissionGrants: ["sales.opportunities.amount.read"] };
  const weightedMetadataBase = { applicationId: "customer-gate-1", environment: "production", source: { id: "sales.report.weighted-forecast", version: 1 }, sourceSchema: { id: "sales.report.weighted-forecast.output", version: 1 }, authorizationRevision: 7, lifecycleRevision: 2, salesScopeRevision: 5, settingsRevision: 3, reportingTimezone: "UTC", reportingCurrency: "USD", currencyScale: 2, asOf: "2026-09-08T00:00:00.000Z", windowMode: "as-of", grouping: "none", authorizedRecordCount: 1 };
  const weightedMetadata = { ...weightedMetadataBase, executionDigest: `sha256:${createHash("sha256").update(canonicalJson(weightedMetadataBase)).digest("hex")}` };
  const reads = [];
  const metric = await salesWeightedForecastHandler({
    actor: { effectiveActor: { kind: "user", id: "seller-1" } }, input: {}, selectedFields: [], query: { filters: [], sort: [] }, recordScope: { kind: "application", where: { applicationId: { equals: "customer-gate-1" } } }, signal: new AbortController().signal,
    request: { applicationIdentity: { applicationId: "customer-gate-1", environment: "production" }, reportingAuthority: reportAuthority, reporting: { read: async (call) => { reads.push(call); return { data: { value: { kind: "money", value: "12.50", currency: "USD", scale: 2 } }, metadata: weightedMetadata }; }, run: async () => { throw new Error("unused"); }, schedule: async () => { throw new Error("unused"); } } }
  });
  assert.deepEqual(metric, { data: { value: { kind: "money", value: "12.50", currency: "USD", scale: 2 } }, reportExecution: weightedMetadata });
  assert.deepEqual(reads.map(({ reportId, windowMode, selectedFields }) => ({ reportId, windowMode, selectedFields })), [{ reportId: "sales.report.weighted-forecast", windowMode: "as-of", selectedFields: [] }]);
  const calls = [];
  const authorizationContext = { actionId: "sales.report.run", applicationId: "customer-gate-1", environment: "production", actorId: "seller-1", ownerId: "seller-1", authorizationRevision: 7, lifecycleRevision: 2, salesScopeRevision: 5, reportingAuthority: { ...reportAuthority, reportPermissionGrants: ["sales.exports.execute", "sales.reports.read"] }, reporting: { read: async () => { throw new Error("unused"); }, run: async (call) => { calls.push(call); return { reportRunId: "report-run-1", state: "queued", revision: 1 }; }, schedule: async () => { throw new Error("unused"); } } };
  const run = await salesReportActionHandler({ authorizationContext, input: { reportId: "sales.report.weighted-forecast", windowMode: "as-of" }, idempotencyKey: "report-run-key-1", signal: new AbortController().signal });
  assert.deepEqual(run, { reportRunId: "report-run-1", state: "queued", revision: 1 });
  assert.equal(calls[0].input.reportId, "sales.report.weighted-forecast");
  await assert.rejects(() => salesReportActionHandler({ authorizationContext: { ...authorizationContext, actionId: salesReportScheduleDescriptor.id }, input: { operation: "upsert", reportId: "sales.report.task-aging", recipientId: "seller-1", expectedRevision: 0, weekday: 8, localTime: "09:00", windowMode: "as-of" }, idempotencyKey: "report-schedule-key-1", signal: new AbortController().signal }), /Sales report input is invalid/);
  assert.equal(salesReportRunDescriptor.inputSchema.additionalProperties, false);
  assert.equal(salesReportScheduleDescriptor.inputSchema.additionalProperties, false);
});

test("Sales settings, permissions, routes, and navigation use strict platform contracts", () => {
  assert.equal(SystemSettingsDescriptorSchema.safeParse(salesWorkspaceSettingsDescriptor).success, true);
  assert.equal(salesCrmPermissionDescriptors.every((descriptor) => AuthorizationPermissionDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every((descriptor) => PluginRouteDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesNavigationDescriptors.every((descriptor) => PluginNavigationDescriptorSchema.safeParse(descriptor).success), true);
  assert.equal(salesRouteDescriptors.every(({ viewId }) => salesPageTemplates.some(({ id }) => id === viewId)), true);
  assert.equal(PluginPageTemplateDescriptorSchema.safeParse(salesTaskPageTemplate).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableComponentDescriptor).success, true);
  assert.equal(PluginUiContributionDescriptorSchema.safeParse(salesTaskTableBlockDescriptor).success, true);
  assert.deepEqual(salesDefaultSettings, { defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks" });
  assert.deepEqual([salesReferenceMetadata.health.version, salesReferenceMetadata.lifecycle.version, salesReferenceMetadata.testing.version], [2, 2, 2]);
});

test("Sales P13.2 policy bindings and role templates are static same-owner declarations", () => {
  assert.equal(PluginManifestSchema.safeParse(salesManifest).success, true);
  assert.equal(salesCrmPermissionPolicyBindings.every((binding) => PermissionPolicyBindingSchema.safeParse(binding).success), true);
  assert.equal(salesCrmRoleTemplates.every((template) => RoleTemplateSchema.safeParse(template).success), true);

  const permissionById = new Map(salesCrmPermissionDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const bindingByPermissionId = new Map(salesCrmPermissionPolicyBindings.map((binding) => [binding.permissionId, binding]));
  for (const binding of salesCrmPermissionPolicyBindings) {
    assert.deepEqual(binding.publisher, { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
    assert.equal(permissionById.get(binding.permissionId)?.scope, binding.scope);
    assert.equal(binding.failureMode, "deny");
    assert.equal(binding.timeoutMs > 0 && binding.timeoutMs <= 5_000, true);
  }
  for (const descriptor of salesCrmPermissionDescriptors) {
    if (descriptor.scope === "application") assert.equal(bindingByPermissionId.has(descriptor.id), false);
    else {
      const binding = bindingByPermissionId.get(descriptor.id);
      assert.ok(binding, `${descriptor.id} must have one policy binding`);
      const row = salesCrmObjectFieldActionMatrix.find((candidate) => [candidate.readPermissionId, candidate.writePermissionId, candidate.archivePermissionId, ...Object.values(candidate.sensitiveFields ?? {}), ...Object.values(candidate.actionPermissions ?? {})].includes(descriptor.id));
      const operationPolicy = descriptor.id === "sales.ownership.write" ? "sales.policy.ownership.current"
        : descriptor.id === "sales.records.merge" ? "sales.policy.merge.current"
          : descriptor.id === "sales.reports.read" ? "sales.policy.reports.current" : row?.recordPolicyId;
      assert.equal(binding.policyReference, operationPolicy);
    }
  }
  assert.equal(bindingByPermissionId.size, salesCrmPermissionPolicyBindings.length);
  assert.deepEqual(Object.keys(salesManifest.contributions.policyBindings).sort(), salesCrmPermissionPolicyBindings.map(({ id }) => id).sort());
  assert.deepEqual(Object.keys(salesManifest.contributions.roleTemplates).sort(), salesCrmRoleTemplates.map(({ id }) => id).sort());

  for (const template of salesCrmRoleTemplates) {
    assert.deepEqual(template.publisher, { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" });
    assert.deepEqual(template.permissionIds, [...template.permissionIds].sort());
    assert.equal(template.permissionIds.every((permissionId) => permissionById.has(permissionId)), true);
    assert.equal(Object.hasOwn(template, "assignments"), false);
  }
  assert.deepEqual(salesCrmRoleTemplates.map(({ title }) => title), [
    "Sales Viewer", "Sales Representative", "Sales Manager", "Sales Administrator"
  ]);
  for (let index = 1; index < salesCrmRoleTemplates.length; index += 1) {
    const previous = new Set(salesCrmRoleTemplates[index - 1].permissionIds);
    assert.equal(previous.size < salesCrmRoleTemplates[index].permissionIds.length, true);
    assert.equal([...previous].every((permissionId) => salesCrmRoleTemplates[index].permissionIds.includes(permissionId)), true);
  }
});

test("Sales current record policies enforce exact persona scope modes", () => {
  const executor = salesPermissionPolicyExecutors["sales.policy.tasks.current"];
  const input = {
    permissionId: "sales.tasks.read",
    applicationId: "customer-gate-1",
    effectiveActor: { id: "user-1" },
    scope: { kind: "record", recordId: "1" },
    facts: {
      applicationId: "customer-gate-1",
      environment: "production",
      recordEnvironment: "production",
      recordId: "1",
      ownerId: "user-1",
      recordScope: "owned-or-assigned-team",
      applicationWide: false,
      mutationAllowed: true,
      salesScopeRevision: 1
    }
  };
  assert.deepEqual(executor.evaluate(input), { schemaVersion: 1, outcome: "allow" });
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, applicationId: "other-customer" } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordEnvironment: "staging" } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2" } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-1"] } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-2"] } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, ownerId: "user-2", applicationWide: true } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordScope: "managed-teams-and-own", ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-2"] } }).outcome, "allow");
  const viewer = { ...input, facts: { ...input.facts, recordScope: "explicit-application-or-team-scope", applicationWide: false, mutationAllowed: false, ownerId: "user-1" } };
  assert.equal(executor.evaluate(viewer).outcome, "deny", "viewer ownership alone must not grant record access");
  assert.equal(executor.evaluate({ ...viewer, facts: { ...viewer.facts, ownerId: "user-2", teamId: "team-1", authorizedTeamIds: ["team-1"] } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...viewer, facts: { ...viewer.facts, ownerId: "user-2", applicationWide: true } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...viewer, facts: { ...viewer.facts, ownerId: "user-2", teamId: "team-2", authorizedTeamIds: ["team-1"] } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordScope: "application-sales-scope", ownerId: "user-2", applicationWide: true } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, recordScope: "application-sales-scope", applicationWide: false } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...viewer, scope: { kind: "record", recordId: "collection" }, facts: { ...viewer.facts, recordId: "collection", collectionScope: true, authorizedTeamIds: ["team-1"] } }).outcome, "allow");
  assert.equal(executor.evaluate({ ...input, permissionId: "sales.tasks.write", facts: { ...input.facts, mutationAllowed: false } }).outcome, "deny");
  assert.equal(executor.evaluate({ ...input, facts: { ...input.facts, salesScopeRevision: 0 } }).outcome, "deny");

  const fieldExecutor = salesPermissionPolicyExecutors["sales.policy.opportunities.current"];
  assert.equal(fieldExecutor.evaluate({
    ...input,
    permissionId: "sales.opportunities.amount.read",
    scope: { kind: "field", recordId: "1", fieldId: "amount" },
    facts: { ...input.facts, fieldId: "amount", fieldAllowed: false }
  }).outcome, "deny");
});

test("Sales registers source/action-backed tools with strict write policy", () => {
  assert.equal(AgentToolDescriptorSchema.safeParse(salesSearchTasksDescriptor).success, true);
  assert.equal(AgentToolDescriptorSchema.safeParse(salesCreateTaskToolDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskCreateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesTaskUpdateDescriptor).success, true);
  assert.equal(ActionDescriptorSchema.safeParse(salesOpportunityStageUpdateDescriptor).success, true);
  assert.deepEqual(salesSearchTasksDescriptor.invocation, { kind: "source", source: { id: "sales.tasks", version: 2 } });
  assert.equal(salesSearchTasksDescriptor.policy, "sales.policy.tasks.current");
  assert.deepEqual(salesSearchTasksDescriptor.inputSchema.required, ["title"]);
  assert.deepEqual(Object.keys(salesSearchTasksDescriptor.inputSchema.properties), ["title"]);
  assert.deepEqual(salesCreateTaskToolDescriptor.invocation, { kind: "action", action: { id: "sales.task.create", version: 2 } });
  assert.equal(salesCreateTaskToolDescriptor.approval, "per-call");
  assert.equal(salesCreateTaskToolDescriptor.idempotency, "required");
  assert.equal(salesSearchTasksDescriptor.dryRun, false);
  assert.deepEqual(salesCreateTaskToolDescriptor.inputSchema, salesTaskCreateDescriptor.inputSchema);
  assert.deepEqual(salesCreateTaskToolDescriptor.outputSchema, salesTaskCreateDescriptor.outputSchema);
  assert.equal(salesTaskCreateDefinition.descriptor.id, "sales.task.create");
});

test("Sales declares event-to-realtime invalidation mappings", () => {
  assert.deepEqual(salesEventDescriptors.map(({ id }) => id).sort(), [
    "sales.event.account-changed", "sales.event.contact-changed", "sales.event.export-job-changed", "sales.event.import-job-changed", "sales.event.lead-changed", "sales.event.notification-changed", "sales.event.opportunity-changed", "sales.event.provider-configuration-changed", "sales.event.reminder-changed", "sales.event.report-run-changed", "sales.event.task-changed", "sales.event.timeline-changed", "sales.event.workflow-execution-changed", "sales.event.workflow.activity-scheduled", "sales.event.workflow.lead-owner-assigned", "sales.event.workflow.opportunity-proposal-entered"
  ]);
  const eventIds = new Set(salesEventDescriptors.map(({ id }) => id));
  const sourceIds = new Set(salesManifest.contributions.sources && Object.keys(salesManifest.contributions.sources));
  const permissionIds = new Set(salesCrmPermissionDescriptors.map(({ id }) => id));
  for (const event of salesEventDescriptors) {
    assert.equal(["durable-integration", "durable-workflow"].includes(event.eventClass), true);
    assert.equal(sourceIds.has(event.sourceId), true);
  }
  assert.deepEqual(salesEventDescriptors.find(({ id }) => id === "sales.event.workflow-execution-changed"), {
    id: "sales.event.workflow-execution-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.timeline"
  });
  assert.equal(salesRealtimeTopicDescriptors.some(({ eventId }) => eventId === "sales.event.workflow-execution-changed"), false);
  assert.deepEqual(salesWorkflowTriggerDescriptors, [
    { id: "sales.workflow.opportunity-proposal-follow-up", version: 1, eventId: "sales.event.workflow.opportunity-proposal-entered", eventClass: "durable-workflow", actionId: "sales.opportunity.stage.update", effectKind: "create-owner-follow-up-task", targetCollection: "sales-opportunities", recipient: "accepted-owner", fanout: 1, depth: 1 },
    { id: "sales.workflow.lead-owner-assigned-notification", version: 1, eventId: "sales.event.workflow.lead-owner-assigned", eventClass: "durable-workflow", actionId: "sales.ownership.assign", effectKind: "notify-new-owner", targetCollection: "sales-leads", recipient: "accepted-owner", fanout: 1, depth: 1 },
    { id: "sales.workflow.scheduled-activity-reminder", version: 1, eventId: "sales.event.workflow.activity-scheduled", eventClass: "durable-workflow", actionId: "sales.activity.create", effectKind: "schedule-reminder", targetCollection: "sales-activities", recipient: "original-actor", fanout: 1, depth: 1 }
  ]);
  assert.deepEqual(salesReferenceMetadata.workflowJob, { id: "sales.job.crm-workflow-execution", version: 1, ownerPluginId: "module.sales", timeoutMs: 10_000, maxConcurrency: 16, idempotent: true });
  for (const topic of salesRealtimeTopicDescriptors) {
    assert.equal(eventIds.has(topic.eventId), true);
    assert.equal(sourceIds.has(topic.sourceId), true);
    assert.equal(permissionIds.has(topic.permission), true);
  }
  assert.deepEqual(salesRealtimeTopicDescriptors.find(({ id }) => id === "sales.realtime.timeline"), {
    id: "sales.realtime.timeline", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.timeline-changed", sourceId: "sales.timeline", permission: "sales.activities.read"
  });
  assert.deepEqual(salesRealtimeTopicDescriptors.find(({ id }) => id === "sales.realtime.provider-configurations"), {
    id: "sales.realtime.provider-configurations", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.provider-configuration-changed", sourceId: "sales.provider-configurations", permission: "sales.settings.read"
  });
});

test("the Sales create action finalizes resource-bound audit evidence in its transaction", async () => {
  const calls = [];
  const request = {
    payload: {
      find: async () => ({ docs: [], hasNextPage: false }),
      create: async (options) => {
        calls.push(options);
        return { id: "7", title: options.data.title, status: options.data.status, revision: options.data.revision };
      },
      update: async (options) => {
        calls.push(options);
        return { id: "7", title: "Call customer", status: "open", revision: 1 };
      }
    },
    locale: "en-US",
    transactionID: "tx-7"
  };
  const result = await salesTaskCreateHandler({
    actor: { principal: { kind: "user", id: "user-1" }, effectiveActor: { kind: "user", id: "user-1" } },
    request,
    authorizationContext: { actionId: "sales.task.create", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-2", teamId: "team-1" },
    input: { title: "Call customer" },
    idempotencyKey: "create-1",
    signal: new AbortController().signal
  });
  assert.deepEqual(result, { id: "7", title: "Call customer", status: "open", revision: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].collection, "sales-tasks");
  assert.equal(calls[0].overrideAccess, true);
  assert.equal(calls[0].depth, 0);
  assert.deepEqual(calls[0].user, { id: "user-1", collection: "users" });
  assert.equal(calls[0].req, request);
  assert.deepEqual(calls[0].data, {
    title: "Call customer", status: "open", applicationId: "customer-gate-1", environment: "production",
    ownerId: "user-1", teamId: "team-1", createdBy: "user-1", updatedBy: "user-1", revision: 1,
    audit: [], archiveStatus: "active"
  });
  assert.deepEqual(calls[0].context, {});
  assert.equal(calls[1].collection, "sales-tasks");
  assertActionAudit(calls[1].data.audit[0], {
    actionId: "sales.task.create", resourceId: "7", applicationId: "customer-gate-1", environment: "production",
    fromState: "absent", toState: "open", actorId: "user-1", revision: 1, idempotencyKey: "create-1"
  });
  assert.deepEqual({ eventId: calls[1].context.kNexSalesEvent.eventId, type: calls[1].context.kNexSalesEvent.type }, { eventId: "create-1", type: "sales.event.task-changed" });
  assert.deepEqual(calls[1].context.kNexSalesEvent.transition, calls[1].data.audit[0]);
});

test("Sales durable events project task and opportunity invalidations through the realtime gateway", async () => {
  const publications = [];
  const relay = createSalesRealtimeRelay({ publish: async (input) => { publications.push(input); return { accepted: true }; } });
  const base = {
    schemaVersion: 1, messageClass: "durable-integration", occurredAt: "2026-08-27T00:00:00.000Z",
    applicationId: "customer-gate-1", pluginId: "module.sales", correlationId: "correlation-1"
  };
  const run = async (event) => relay({
    actor: { kind: "system", id: "outbox.processor" }, checkpoint: null, event,
    idempotencyKey: event.id, saveCheckpoint: async () => undefined
  });
  await run({ ...base, id: "task-event-1", type: "sales.event.task-changed", payload: { resourceId: "1", actionId: "sales.task.update", environment: "production", fromState: "open", toState: "completed", revision: 2, idempotencyKey: "task-event-1", operation: "update" } });
  await run({ ...base, id: "opportunity-event-1", type: "sales.event.opportunity-changed", payload: { resourceId: "2", actionId: "sales.opportunity.stage.update", environment: "production", fromState: "discovery", toState: "proposal", revision: 8, idempotencyKey: "opportunity-event-1", operation: "update" } });
  assert.deepEqual(publications.map(({ channel, message }) => ({ topicId: channel.topicId, message })), [
    { topicId: "sales.realtime.tasks", message: { topic: "sales.realtime.tasks", source: "sales.tasks", event: "sales.event.task-changed", correlation: "correlation-1", dedupe: "task-event-1" } },
    { topicId: "sales.realtime.opportunities", message: { topic: "sales.realtime.opportunities", source: "sales.opportunities", event: "sales.event.opportunity-changed", correlation: "correlation-1", dedupe: "opportunity-event-1" } }
  ]);
  assert.equal(JSON.stringify(publications).includes("resourceId"), false);
  assert.equal(JSON.stringify(publications).includes("fromState"), false);
  for (const [type, topic, source] of [["sales.event.account-changed", "sales.realtime.accounts", "sales.accounts"], ["sales.event.contact-changed", "sales.realtime.contacts", "sales.contacts"], ["sales.event.lead-changed", "sales.realtime.leads", "sales.leads"], ["sales.event.import-job-changed", "sales.realtime.import-jobs", "sales.import-job.list"], ["sales.event.export-job-changed", "sales.realtime.export-jobs", "sales.export-job.list"]]) {
    await run({ ...base, id: `movement-${source}`, type, payload: { resourceId: "9", actionId: "sales.import.commit", environment: "production", fromState: "absent", toState: source === "sales.leads" ? "new" : "active", revision: 1, idempotencyKey: `movement-${source}`, operation: "update" } });
    assert.deepEqual(publications.at(-1).channel.topicId, topic);
    assert.deepEqual(publications.at(-1).message.source, source);
  }
  await run({ ...base, id: "provider-configuration-1", type: "sales.event.provider-configuration-changed", payload: { providerId: "email.reference.v1", state: "revoked", revision: 4, environment: "production" } });
  assert.deepEqual(publications.at(-1).channel, { topicId: "sales.realtime.provider-configurations", params: {} });
  assert.deepEqual(publications.at(-1).message, { topic: "sales.realtime.provider-configurations", source: "sales.provider-configurations", event: "sales.event.provider-configuration-changed", correlation: "correlation-1", dedupe: "provider-configuration-1" });
  assert.equal(JSON.stringify(publications.at(-1)).includes("providerId"), false);
  const publicationCount = publications.length;
  await run({ ...base, id: "workflow-execution-1", type: "sales.event.workflow-execution-changed", payload: { state: "succeeded", revision: 2, environment: "production" } });
  assert.equal(publications.length, publicationCount);
});

test("Sales durable event hook binds the exact final audit transition and closed event contract", async () => {
  const transition = { actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production", fromState: "open", toState: "completed", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 2, idempotencyKey: "event-1" };
  const baseEvent = { eventId: "event-1", type: "sales.event.task-changed", stateField: "status", transition };
  const baseDoc = { id: 1, applicationId: "customer-gate-1", environment: "production", status: "completed", revision: 2, audit: [{ ...transition, revision: 1, idempotencyKey: "event-0" }, transition] };
  const run = async ({ event = baseEvent, doc = baseDoc, operation = "update", applicationId = "customer-gate-1" } = {}) => {
    const writes = [];
    const req = { headers: new Headers(), transactionID: "tx", payload: { config: { custom: { kNexApplicationId: applicationId } }, db: { sessions: { tx: { db: { execute: async (query) => { writes.push(query); return { rows: [] }; } } } } } } };
    await salesEventAfterChange({ collection: { slug: "sales-tasks" }, context: { kNexSalesEvent: event }, doc, operation, req });
    return writes;
  };
  assert.equal((await run()).length, 1);
  for (const candidate of [
    { event: { ...baseEvent, eventId: "event-other" } },
    { event: { ...baseEvent, type: "sales.event.opportunity-changed" } },
    { event: { ...baseEvent, stateField: "stageId" } },
    { event: { ...baseEvent, transition: { ...transition, actionId: "sales.task.unknown" } } },
    { event: { ...baseEvent, transition: { ...transition, actorId: "user-other" } } },
    { doc: { ...baseDoc, audit: [...baseDoc.audit.slice(0, -1), { ...transition, fromState: "cancelled" }] } },
    { operation: "create" },
    { applicationId: "customer-other" }
  ]) await assert.rejects(run(candidate), /does not match/);
});

test("Sales workflow trigger hook emits only closed dedicated workflow envelopes", async () => {
  const transition = { actionId: "sales.opportunity.stage.update", resourceId: "8", applicationId: "customer-gate-1", environment: "production", fromState: "discovery-stage", toState: "proposal-stage", occurredAt: "2026-09-08T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "opportunity-proposal-8" };
  const workflow = { type: "sales.event.workflow.opportunity-proposal-entered", workflowId: "sales.workflow.opportunity-proposal-follow-up", workflowVersion: 1, effectKind: "create-owner-follow-up-task", acceptedOwnerId: "user-2", recipientId: "user-2", authorizationRevision: 9, lifecycleRevision: 3, scopeRevision: 4 };
  const event = { eventId: transition.idempotencyKey, type: "sales.event.opportunity-changed", stateField: "stageId", transition, workflow };
  const doc = { id: 8, applicationId: "customer-gate-1", environment: "production", ownerId: "user-2", stageId: "proposal-stage", revision: 1, audit: [transition] };
  const run = async (candidate = {}) => {
    const writes = [];
    const req = {
      headers: new Headers(), transactionID: "tx",
      payload: {
        config: { custom: { kNexApplicationId: "customer-gate-1" } },
        db: { sessions: { tx: { db: { execute: async (query) => { writes.push(query); return { rows: [] }; } } } } }
      }
    };
    await salesEventAfterChange({ collection: { slug: candidate.collection ?? "sales-opportunities" }, context: { kNexSalesEvent: { ...event, ...(candidate.event ?? {}) } }, doc: { ...doc, ...(candidate.doc ?? {}) }, operation: "update", req });
    return writes;
  };
  assert.equal((await run()).length, 2);
  for (const candidate of [
    { event: { workflow: { ...workflow, recipientId: "user-3" } } },
    { event: { workflow: { ...workflow, effectKind: "notify-new-owner" } } },
    { event: { workflow: { ...workflow, authorizationRevision: 0 } } },
    { doc: { ownerId: "user-3" } }
  ]) await assert.rejects(run(candidate), /workflow trigger facts/);
  const leadTransition = { actionId: "sales.ownership.assign", resourceId: "9", applicationId: "customer-gate-1", environment: "production", fromState: "working", toState: "working", occurredAt: "2026-09-08T00:00:00.000Z", actorId: "user-1", revision: 2, idempotencyKey: "lead-owner-9", ownership: { oldOwnerId: "user-1", newOwnerId: "user-2", oldTeamId: null, newTeamId: null } };
  assert.equal((await run({ collection: "sales-leads", event: { eventId: leadTransition.idempotencyKey, type: "sales.event.lead-changed", stateField: "status", transition: leadTransition, workflow: { type: "sales.event.workflow.lead-owner-assigned", workflowId: "sales.workflow.lead-owner-assigned-notification", workflowVersion: 1, effectKind: "notify-new-owner", acceptedOwnerId: "user-2", recipientId: "user-2", authorizationRevision: 9, lifecycleRevision: 3, scopeRevision: 4 } }, doc: { id: 9, ownerId: "user-2", status: "working", revision: 2, audit: [{ ...leadTransition, revision: 1, idempotencyKey: "lead-owner-8" }, leadTransition] } })).length, 2);
  const activityTransition = { actionId: "sales.activity.create", resourceId: "10", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "scheduled", occurredAt: "2026-09-08T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "activity-scheduled-10" };
  assert.equal((await run({ collection: "sales-activities", event: { eventId: activityTransition.idempotencyKey, type: "sales.event.timeline-changed", stateField: "status", transition: activityTransition, workflow: { type: "sales.event.workflow.activity-scheduled", workflowId: "sales.workflow.scheduled-activity-reminder", workflowVersion: 1, effectKind: "schedule-reminder", acceptedOwnerId: "user-1", recipientId: "user-1", authorizationRevision: 9, lifecycleRevision: 3, scopeRevision: 4, scheduledAt: "2026-09-08T01:00:00.000Z" } }, doc: { id: 10, ownerId: "user-1", createdBy: "user-1", status: "scheduled", scheduledAt: "2026-09-08T01:00:00.000Z", revision: 1, audit: [activityTransition] } })).length, 2);
});

test("Sales output schemas enforce canonical task shapes", () => {
  const validTable = {
    fields: ["title", "status"],
    rows: [{
      key: "1",
      values: {
        title: { kind: "text", value: "Follow-up" },
        status: { kind: "status", value: "open" }
      }
    }],
    page: { number: 1, pageSize: 25, hasNext: false }
  };
  assert.equal(salesTasksDefinition.outputSchema.safeParse(validTable).success, true);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({ ...validTable, fields: ["title", "status", "unknown"] }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { ...validTable.rows[0].values, status: { kind: "text", value: "open" } } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { ...validTable.rows[0].values, status: { kind: "status", value: "paused" } } }]
  }).success, false);
  assert.equal(salesTasksDefinition.outputSchema.safeParse({
    ...validTable,
    rows: [{ ...validTable.rows[0], values: { title: null, status: validTable.rows[0].values.status } }]
  }).success, false);
});

test("the task source applies bounded projection, allowlisted operations, and pagination", async () => {
  let call;
  const result = await salesTasksHandler(handlerContext({
    selectedFields: ["title", "status"],
    query: {
      page: { number: 2, size: 10 },
      filters: [{ field: "title", operator: "contains", value: "follow" }],
      sort: [{ field: "status", direction: "desc" }]
    },
    recordScope: salesScope("sales.tasks"),
    request: {
      payload: {
        find: async (options) => {
          call = options;
          return { docs: [{ id: "1", title: "Follow-up", status: "open" }], page: 2, totalPages: 3, hasNextPage: true };
        }
      }
    }
  }));
  assert.deepEqual(result, {
    fields: ["title", "status"],
    rows: [{ key: "1", values: {
      title: { kind: "text", value: "Follow-up" },
      status: { kind: "status", value: "open" }
    } }],
    page: { number: 2, pageSize: 10, hasNext: true }
  });
  assert.equal(call.overrideAccess, true);
  assert.equal(call.depth, 0);
  assert.equal(call.page, 2);
  assert.equal(call.limit, 10);
  assert.deepEqual(call.select, { id: true, title: true, status: true });
  assert.deepEqual(call.sort, ["-status", "id"]);
  assert.deepEqual(call.where, { and: [
    { and: [{ applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }] },
    { title: { contains: "follow" } }
  ] });
});

test("the task source advances opaque cursor pages through bounded Payload pagination", async () => {
  let call;
  const first = await salesTasksHandler(handlerContext({
    query: { cursor: { size: 10 }, filters: [], sort: [] },
    request: { payload: { find: async (options) => {
      call = options;
      return { docs: [], hasNextPage: true };
    } } }
  }));
  assert.equal(first.page.number, 1);
  assert.equal(typeof first.page.nextCursor, "string");
  const second = await salesTasksHandler(handlerContext({
    query: { cursor: { size: 10, after: first.page.nextCursor }, filters: [], sort: [] },
    request: { payload: { find: async (options) => {
      call = options;
      return { docs: [], hasNextPage: false };
    } } }
  }));
  assert.equal(call.page, 2);
  assert.equal(second.page.nextCursor, undefined);
  const invalidCursor = (error) => error?.code === "INVALID_CURSOR" && error?.status === 400;
  await assert.rejects(salesTasksHandler(handlerContext({
    query: { cursor: { size: 5, after: first.page.nextCursor }, filters: [], sort: [] }
  })), invalidCursor);
  await assert.rejects(salesTasksHandler(handlerContext({
    query: { cursor: { size: 10, after: "not-a-sales-cursor" }, filters: [], sort: [] }
  })), invalidCursor);
});

test("the task source rejects direct unknown field manipulation", async () => {
  await assert.rejects(
    salesTasksHandler(handlerContext({ selectedFields: ["private-secret"] })),
    /invalid field selection/
  );
});

test("Sales sources require closed host-issued application and environment scopes", async () => {
  for (const recordScope of [undefined, { kind: "sales.tasks" }, { kind: "sales.tasks", where: {} },
    { kind: "sales.tasks", where: { arbitrary: { equals: "value" } } }]) {
    await assert.rejects(salesTasksHandler(handlerContext({ recordScope })), /closed application and environment record scope/);
  }
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { ...salesScope("sales.tasks"), where: { and: [
      { applicationId: { equals: "other-customer" } }, { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }
    ] } },
  })), /closed application and environment record scope/);
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: { and: [
      { or: [{ applicationId: { equals: "customer-gate-1" } }, { ownerId: { equals: "user-1" } }] },
      { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }
    ] } }
  })), /closed application and environment record scope/);
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { ...salesScope("sales.tasks"), where: { and: [
      { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "staging" } }, { ownerId: { equals: "user-1" } }
    ] } }
  })), /closed application and environment record scope/);
  await assert.rejects(salesTasksHandler(handlerContext({
    request: { applicationIdentity: { applicationId: "other-customer", environment: "production" } }
  })), /closed application and environment record scope/);
  for (const clause of [{ applicationId: { equals: "customer-gate-1", extraOperator: "bypass" } }, { environment: { equals: "production", extraOperator: "bypass" } }]) {
    await assert.rejects(salesTasksHandler(handlerContext({
      recordScope: { ...salesScope("sales.tasks"), where: { and: [clause, { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { equals: "user-1" } }] } }
    })), /closed application and environment record scope/);
  }
  let observed;
  const teamScope = { and: [
    { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } },
    { or: [{ ownerId: { equals: "user-1" } }, { teamId: { in: ["team-1", "team-2"] } }] }
  ] };
  await salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: teamScope },
    request: { payload: { find: async (options) => { observed = options.where; return { docs: [], hasNextPage: false }; } } }
  }));
  assert.deepEqual(observed, teamScope);
  const applicationScope = { and: [
    { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }
  ] };
  await salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: applicationScope },
    request: { payload: { find: async (options) => { observed = options.where; return { docs: [], hasNextPage: false }; } } }
  }));
  assert.deepEqual(observed, applicationScope);
  for (const inValues of [[], ["team-1", "team-1"], [""], Array.from({ length: 33 }, (_, index) => `team-${index}`)]) {
    await assert.rejects(salesTasksHandler(handlerContext({
      recordScope: { kind: "sales.tasks", where: { and: [
        { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { teamId: { in: inValues } }
      ] } }
    })), /closed application and environment record scope/);
  }
  await assert.rejects(salesTasksHandler(handlerContext({
    recordScope: { kind: "sales.tasks", where: { and: [
      { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } }, { ownerId: { in: ["user-1"] } }
    ] } }
  })), /closed application and environment record scope/);
});

test("the opportunities source returns bounded canonical rows", async () => {
  const result = await salesOpportunitiesHandler(handlerContext({
    request: { payload: { find: async (options) => options.collection === "sales-opportunities"
      ? (assert.equal(options.select.currency, true), { docs: [{ id: "2", name: "Platform rollout", pipelineId: 17, stageId: discoveryStageId, archiveStatus: "active", amount: "1200.50", currency: "EUR", revision: 7 }], hasNextPage: false })
      : options.collection === "sales-pipelines" ? { docs: [{ id: 17, revision: 2, status: "active" }] }
        : { docs: [{ pipelineId: 17, stageId: discoveryStageId, name: "Discovery", semantic: "discovery", revision: 2, status: "active" }] } } },
    selectedFields: ["name", "stage-id", "revision", "amount"],
    recordScope: salesScope("sales.opportunities")
  }));
  assert.deepEqual(result.rows[0], {
    key: "2",
    values: {
      name: { kind: "text", value: "Platform rollout" },
      "stage-id": { kind: "status", value: discoveryStageId },
      revision: { kind: "integer", value: 7 },
      amount: { kind: "money", value: "1200.50", currency: "EUR", scale: 2 }
    }
  });
});

test("Sales opportunity output accepts only exact canonical selected cells", () => {
  const valid = {
    fields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision", "amount"],
    rows: [{ key: "2", values: {
      name: { kind: "text", value: "Platform rollout" },
      "pipeline-id": { kind: "integer", value: 17 }, "pipeline-revision": { kind: "integer", value: 2 },
      "stage-id": { kind: "status", value: discoveryStageId }, "stage-name": { kind: "text", value: "Discovery" }, "stage-semantic": { kind: "enum", value: "discovery" }, "stage-revision": { kind: "integer", value: 2 },
      revision: { kind: "integer", value: 7 },
      amount: { kind: "money", value: "1200.5", currency: "EUR", scale: 2 }
    } }],
    page: { number: 1, pageSize: 25, hasNext: false }
  };
  assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse(valid).success, true);
  assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse({ ...valid, rows: [{ ...valid.rows[0], values: { ...valid.rows[0].values, amount: null } }] }).success, true);
  for (const values of [
    { name: valid.rows[0].values.name, "stage-id": valid.rows[0].values["stage-id"] },
    { ...valid.rows[0].values, extra: { kind: "text", value: "extra" } },
    { ...valid.rows[0].values, name: { kind: "status", value: "Platform rollout" } },
    { ...valid.rows[0].values, "stage-id": { kind: "status", value: "unknown" } },
    { ...valid.rows[0].values, revision: { kind: "integer", value: 0 } },
    { ...valid.rows[0].values, amount: { kind: "money", value: "1200.5", currency: "eur", scale: 2 } },
    { ...valid.rows[0].values, amount: { kind: "money", value: "1200.5", currency: "EUR", scale: 19 } }
  ]) assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse({ ...valid, rows: [{ ...valid.rows[0], values }] }).success, false);
});

test("Sales opportunity money preserves stored currency and rejects malformed amount pairs", async () => {
  const source = (document) => salesOpportunitiesHandler(handlerContext({
    request: { payload: { find: async (options) => options.collection === "sales-opportunities" ? { docs: [{ id: "2", name: "Platform rollout", pipelineId: 17, stageId: discoveryStageId, revision: 1, ...document }], hasNextPage: false } : options.collection === "sales-pipelines" ? { docs: [{ id: 17, revision: 2 }] } : { docs: [{ pipelineId: 17, stageId: discoveryStageId, name: "Discovery", semantic: "discovery", revision: 2 }] } } },
    selectedFields: ["amount"], recordScope: salesScope("sales.opportunities")
  }));
  assert.deepEqual((await source({ amount: "0.00", currency: "EUR" })).rows[0].values.amount, { kind: "money", value: "0.00", currency: "EUR", scale: 2 });
  for (const document of [
    { amount: "12.3x", currency: "EUR" }, { amount: "12.3", currency: "eur" },
    { amount: 12.3, currency: "EUR" }, { amount: null, currency: "EUR" }, { amount: "12.3", currency: null }
  ]) await assert.rejects(source(document));
});

test("Sales pipeline audit counts exactly six canonical stages", () => {
  const result = salesPipelineAuditJob({
    opportunities: [{ stage: "qualification" }, { stage: "discovery" }, { stage: "proposal" }, { stage: "negotiation" }, { stage: "won" }, { stage: "lost" }],
    signal: new AbortController().signal
  });
  assert.deepEqual(result.stageCounts, { qualification: 1, discovery: 1, proposal: 1, negotiation: 1, won: 1, lost: 1 });
});

test("Sales mutation lifecycles reject invalid, stale, replayed, and foreign-scope writes", async () => {
  let updates = 0;
  let creates = 0;
  const readWheres = [];
  const request = {
    payload: {
      find: async (options) => { readWheres.push(options.where); return { docs: [] }; }, create: async () => { creates += 1; return {}; },
      update: async () => { updates += 1; return { docs: [], errors: [] }; }
    }
  };
  const base = {
    actor: handlerContext().actor, request, idempotencyKey: "replay-1", signal: new AbortController().signal,
    authorizationContext: { actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", teamId: "team-1" }
  };
  await assert.rejects(salesTaskUpdateHandler({ ...base, input: { id: "1", expectedRevision: 1, expectedStatus: "completed", status: "cancelled" } }));
  await assert.rejects(salesTaskUpdateHandler({ ...base, input: { id: "1", expectedRevision: 1, expectedStatus: "open", status: "open" } }));
  await assert.rejects(salesTaskUpdateHandler({ ...base, input: { id: "1", expectedRevision: 1, expectedStatus: "open", status: "completed" } }), (error) => error?.code === "STALE_RECORD");
  await assert.rejects(salesTaskUpdateHandler({ ...base, authorizationContext: { ...base.authorizationContext, ownerId: "user-2", teamId: "team-2" }, input: { id: "1", expectedRevision: 1, expectedStatus: "open", status: "cancelled" } }), (error) => error?.code === "STALE_RECORD");
  const foreignWhere = readWheres.at(-1);
  await assert.rejects(salesTaskCreateHandler({ ...base, authorizationContext: { ...base.authorizationContext, actionId: "sales.task.create", resourceId: undefined }, input: { title: "Blocked", status: "completed" } }));
  await assert.rejects(salesOpportunityStageUpdateHandler({ ...base, authorizationContext: { ...base.authorizationContext, actionId: "sales.opportunity.stage.update", resourceId: "2" }, input: stageMove("2", 1, negotiationStageId, proposalStageId) }));
  assert.deepEqual(foreignWhere.and, [
    { id: { equals: "1" } }, { applicationId: { equals: "customer-gate-1" } }, { environment: { equals: "production" } },
    { ownerId: { equals: "user-2" } }, { teamId: { equals: "team-2" } }, { status: { equals: "open" } }, { revision: { equals: 1 } }
  ]);
  assert.equal(creates, 0);
  assert.equal(updates, 0);
});

test("Sales rejects malformed or unbounded prior audit history before a write", async () => {
  let updates = 0;
  const authorizationContext = { actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" };
  const transition = { actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production", fromState: "open", toState: "completed", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 2, idempotencyKey: "prior-close-1" };
  for (const audit of [[{ notAnAudit: true }], [{ kind: "p13-2-generated-app-seed" }], [{ kind: "phase-13-legacy-upgrade", receiptDigest: "not-a-digest" }], [{ ...transition, actionId: "unknown" }], [transition, { ...transition, revision: 4, idempotencyKey: "prior-close-2" }], Array.from({ length: 101 }, () => ({ kind: "legacy" }))]) {
    const request = { payload: {
      find: async () => ({ docs: [{ id: "1", audit }] }), create: async () => ({}),
      update: async () => { updates += 1; return { docs: [], errors: [] }; }
    } };
    await assert.rejects(salesTaskUpdateHandler({
      actor: handlerContext().actor, request, authorizationContext,
      input: { id: "1", expectedRevision: 1, expectedStatus: "open", status: "completed" },
      idempotencyKey: `audit-${updates + 1}`, signal: new AbortController().signal
    }), (error) => error?.code === "STALE_RECORD");
  }
  assert.equal(updates, 0);
});

test("Sales audit origin and current-row binding are collection-specific", async () => {
  let updates = 0;
  const authorizationContext = { actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" };
  const taskCreate = { actionId: "sales.task.create", resourceId: "1", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "create-1" };
  const opportunityTransition = { ...taskCreate, actionId: "sales.opportunity.stage.update", fromState: "qualification", toState: "discovery", revision: 2 };
  for (const document of [
    { id: "1", revision: 1, audit: [] },
    { id: "1", revision: 2, audit: [{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}` }] },
    { id: "1", revision: 2, audit: [opportunityTransition] },
    { id: "1", revision: 1, audit: [{ ...taskCreate, resourceId: "3" }] },
    { id: "1", revision: 2, audit: [taskCreate] }
  ]) {
    const request = { payload: { find: async () => ({ docs: [document] }), create: async () => ({}), update: async () => { updates += 1; return { docs: [], errors: [] }; } } };
    await assert.rejects(salesTaskUpdateHandler({ actor: handlerContext().actor, request, authorizationContext,
      input: { id: "1", expectedRevision: document.revision, expectedStatus: "open", status: "completed" }, idempotencyKey: `strict-${document.revision}`, signal: new AbortController().signal
    }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  }
  const migration = { kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead" };
  const firstStage = { actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production", fromState: "qualification", toState: "discovery", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 2, idempotencyKey: "stage-1" };
  const repeatedStage = { ...firstStage, revision: 3, idempotencyKey: "stage-2" };
  const opportunityRequest = { payload: { find: async () => ({ docs: [{ id: "2", revision: 3, audit: [migration, firstStage, repeatedStage] }] }), create: async () => ({}), update: async () => { updates += 1; return { docs: [], errors: [] }; } } };
  await assert.rejects(salesOpportunityStageUpdateHandler({ actor: handlerContext().actor, request: opportunityRequest,
    authorizationContext: { ...authorizationContext, actionId: "sales.opportunity.stage.update", resourceId: "2" },
    input: stageMove("2", 3, discoveryStageId, proposalStageId), idempotencyKey: "strict-opp", signal: new AbortController().signal
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  assert.equal(updates, 0);
});

test("Sales state history validates the private mixed-axis chain and exposes only safe transitions", () => {
  const base = { resourceId: "1", applicationId: "customer-gate-1", environment: "production", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1" };
  const audit = [
    { ...base, actionId: "sales.account.create", fromState: "absent", toState: "active", revision: 1, idempotencyKey: "account-create-1", ownershipGenesis: { ownerId: "user-1", teamId: "team:user-1" } },
    { ...base, actionId: "sales.ownership.assign", fromState: "active", toState: "active", revision: 2, idempotencyKey: "ownership-assign-1", ownership: { oldOwnerId: "user-1", newOwnerId: "user-2", oldTeamId: "team:user-1", newTeamId: "team:user-2" } },
    { ...base, actionId: "sales.ownership.assign", fromState: "active", toState: "active", revision: 3, idempotencyKey: "ownership-assign-2", ownership: { oldOwnerId: "user-2", newOwnerId: "user-3", oldTeamId: "team:user-2", newTeamId: "team:user-3" } },
    { ...base, actionId: "sales.account.update", fromState: "active", toState: "active", revision: 4, idempotencyKey: "account-update-1" },
    { ...base, actionId: "sales.account.archive", fromState: "active", toState: "archived", revision: 5, idempotencyKey: "account-archive-1" }
  ];
  assert.deepEqual(projectSalesStateHistory({ audit, collection: "sales-accounts", id: "1", applicationId: "customer-gate-1", environment: "production", revision: 5, ownerId: "user-3", teamId: "team:user-3", currentState: "archived", currentStateField: "status" }), [
    { actionId: "sales.account.archive", stateField: "status", fromState: "active", toState: "archived", revision: 5, occurredAt: base.occurredAt },
    { actionId: "sales.account.update", stateField: "status", fromState: "active", toState: "active", revision: 4, occurredAt: base.occurredAt },
    { actionId: "sales.account.create", stateField: "status", fromState: "absent", toState: "active", revision: 1, occurredAt: base.occurredAt }
  ]);
  assert.throws(() => projectSalesStateHistory({ audit: audit.slice(0, 1), collection: "sales-accounts", id: "1", applicationId: "customer-gate-1", environment: "production", revision: 1, ownerId: "user-9", teamId: "team:user-1", currentState: "active", currentStateField: "status" }), (error) => error?.code === "STALE_RECORD");
  const malformedFirstAssignment = structuredClone(audit);
  malformedFirstAssignment[1].ownership.oldOwnerId = "user-9";
  assert.throws(() => projectSalesStateHistory({ audit: malformedFirstAssignment, collection: "sales-accounts", id: "1", applicationId: "customer-gate-1", environment: "production", revision: 5, ownerId: "user-3", teamId: "team:user-3", currentState: "archived", currentStateField: "status" }), (error) => error?.code === "STALE_RECORD");
  const malformed = structuredClone(audit);
  malformed[2].ownership.oldOwnerId = "user-9";
  assert.throws(() => projectSalesStateHistory({ audit: malformed, collection: "sales-accounts", id: "1", applicationId: "customer-gate-1", environment: "production", revision: 5, ownerId: "user-3", teamId: "team:user-3", currentState: "archived", currentStateField: "status" }), (error) => error?.code === "STALE_RECORD");
  assert.throws(() => projectSalesStateHistory({ audit, collection: "sales-accounts", id: "1", applicationId: "customer-gate-1", environment: "production", revision: 5, ownerId: "user-4", teamId: "team:user-3", currentState: "archived", currentStateField: "status" }), (error) => error?.code === "STALE_RECORD");
});

test("P13.5 import genesis and merge lineage audits remain canonical CRM history", () => {
  const base = { applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", teamId: "team:user-1", occurredAt: "2026-09-07T00:00:00.000Z" };
  const digest = `sha256:${"a".repeat(64)}`;
  const winnerGenesis = createSalesImportGenesisAudit({ ...base, targetObjectType: "sales.object.account", resourceId: "41", idempotencyKey: "import-job-7-row-1", importJobId: 7, oneBasedDataRow: 1, rowDigest: digest });
  const loserGenesis = createSalesImportGenesisAudit({ ...base, targetObjectType: "sales.object.account", resourceId: "42", idempotencyKey: "import-job-7-row-2", importJobId: 7, oneBasedDataRow: 2, rowDigest: digest });
  const winnerMerge = createSalesMergeAuditTransition({ ...base, resourceId: "41", idempotencyKey: "merge-lineage-7-survivor", preRevision: 1, role: "survivor", lineageId: "lineage-7" });
  const loserMerge = createSalesMergeAuditTransition({ ...base, resourceId: "42", idempotencyKey: "merge-lineage-7-merged", preRevision: 1, role: "merged", lineageId: "lineage-7" });
  assert.deepEqual(salesDataMovementObjectEvent("sales.object.account"), "sales.event.account-changed");
  assert.deepEqual(salesDataMovementObjectEvent("sales.object.contact"), "sales.event.contact-changed");
  assert.deepEqual(salesDataMovementObjectEvent("sales.object.lead"), "sales.event.lead-changed");
  for (const eventId of [salesDataMovementObjectEvent("sales.object.account"), salesDataMovementObjectEvent("sales.object.contact"), salesDataMovementObjectEvent("sales.object.lead")]) assert.equal(salesEventDescriptors.some(({ id }) => id === eventId), true);
  assert.deepEqual(projectSalesStateHistory({ audit: [winnerGenesis, winnerMerge], collection: "sales-accounts", id: "41", applicationId: base.applicationId, environment: base.environment, revision: 2, ownerId: base.ownerId, teamId: base.teamId, currentState: "active", currentStateField: "status" }).map(({ actionId, fromState, toState, revision }) => ({ actionId, fromState, toState, revision })), [
    { actionId: "sales.merge.commit", fromState: "active", toState: "active", revision: 2 },
    { actionId: "sales.import.commit", fromState: "absent", toState: "active", revision: 1 }
  ]);
  assert.deepEqual(projectSalesStateHistory({ audit: [loserGenesis, loserMerge], collection: "sales-accounts", id: "42", applicationId: base.applicationId, environment: base.environment, revision: 2, ownerId: base.ownerId, teamId: base.teamId, currentState: "merged", currentStateField: "status" }).map(({ actionId, fromState, toState, revision }) => ({ actionId, fromState, toState, revision })), [
    { actionId: "sales.merge.commit", fromState: "active", toState: "merged", revision: 2 },
    { actionId: "sales.import.commit", fromState: "absent", toState: "active", revision: 1 }
  ]);
  const forged = structuredClone(winnerGenesis);
  forged.dataMovement.rowDigest = "sha256:bad";
  assert.throws(() => projectSalesStateHistory({ audit: [forged], collection: "sales-accounts", id: "41", applicationId: base.applicationId, environment: base.environment, revision: 1, ownerId: base.ownerId, teamId: base.teamId, currentState: "active", currentStateField: "status" }), (error) => error?.code === "STALE_RECORD");
});

test("P13.5 job transitions require canonical audit and registered top-level environment outbox", () => {
  const running = createSalesDataMovementJobAudit({ kind: "import", jobId: 7, actionId: "sales.import.commit", applicationId: "customer-gate-1", environment: "production", fromState: "queued", toState: "running", occurredAt: "2026-09-07T00:00:00.000Z", actorId: "user-1", revision: 4, idempotencyKey: "import-7-running" });
  assert.deepEqual(running.dataMovement, { kind: "import", jobId: 7 });
  const event = createSalesDataMovementJobOutbox({ ...running, targetObjectType: "sales.object.lead", authorizationRevision: 3, lifecycleRevision: 1, scopeRevision: 2 });
  assert.deepEqual(event, { type: "sales.event.import-job-changed", payload: { environment: "production", jobId: 7, state: "running", revision: 4, actionId: "sales.import.commit", targetObjectType: "sales.object.lead", authorizationRevision: 3, lifecycleRevision: 1, scopeRevision: 2 } });
  assert.equal(salesEventDescriptors.some(({ id }) => id === event.type), true);
  assert.deepEqual(salesDataMovementJobTransitions, {
    import: [
      { actionId: "sales.import.commit", fromState: "queued", toState: "running" },
      { actionId: "sales.import.commit", fromState: "running", toState: "succeeded" },
      { actionId: "sales.import.commit", fromState: "running", toState: "partially-failed" },
      { actionId: "sales.import.commit", fromState: "running", toState: "failed" },
      { actionId: "sales.import.cancel", fromState: "validated", toState: "cancelled" },
      { actionId: "sales.import.cancel", fromState: "queued", toState: "cancelled" }
    ],
    export: [
      { actionId: "sales.export.create", fromState: "queued", toState: "running" },
      { actionId: "sales.export.create", fromState: "running", toState: "succeeded" },
      { actionId: "sales.export.create", fromState: "running", toState: "failed" },
      { actionId: "sales.export.cancel", fromState: "queued", toState: "cancelled" }
    ]
  });
  for (const transition of [...salesDataMovementJobTransitions.import, ...salesDataMovementJobTransitions.export]) {
    assert.doesNotThrow(() => createSalesDataMovementJobAudit({ ...running, ...transition, jobId: running.dataMovement.jobId, kind: transition.actionId.startsWith("sales.import.") ? "import" : "export" }));
  }
  for (const transition of [
    { kind: "import", actionId: "sales.import.commit", fromState: "validated", toState: "queued" },
    { kind: "import", actionId: "sales.import.commit", fromState: "queued", toState: "queued" },
    { kind: "export", actionId: "sales.export.create", fromState: "validated", toState: "queued" },
    { kind: "export", actionId: "sales.export.cancel", fromState: "running", toState: "cancelled" }
  ]) assert.throws(() => createSalesDataMovementJobAudit({ ...running, ...transition, jobId: running.dataMovement.jobId }), /ACTION_FORBIDDEN/u);
});

test("Sales task CAS admits one close and rejects its replay without another write", async () => {
  const state = { id: "1", title: "Follow-up", status: "open", revision: 1, audit: [{ actionId: "sales.task.create", resourceId: "1", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "create-1" }] };
  let updates = 0;
  const request = {
    payload: {
      create: async () => ({}),
      find: async (options) => {
        const predicates = options.where.and;
        const value = (field) => predicates.find((predicate) => predicate[field] !== undefined)?.[field].equals;
        return value("id") === state.id && value("applicationId") === "customer-gate-1" && value("environment") === "production" && value("ownerId") === "user-1" && value("teamId") === "team-1" && value("status") === state.status && value("revision") === state.revision
          ? { docs: [structuredClone(state)] } : { docs: [] };
      },
      update: async (options) => {
        updates += 1;
        Object.assign(state, { status: options.data.status, revision: options.data.revision, audit: options.data.audit });
        return { docs: [structuredClone(state)], errors: [] };
      }
    }
  };
  const input = { id: "1", expectedRevision: 1, expectedStatus: "open", status: "completed" };
  const base = { actor: handlerContext().actor, request, authorizationContext: { actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", teamId: "team-1" }, input, idempotencyKey: "close-1", signal: new AbortController().signal };
  await salesTaskUpdateHandler(base);
  await assert.rejects(salesTaskUpdateHandler(base), (error) => error?.code === "STALE_RECORD");
  assert.equal(updates, 1);
  assertActionAudit(state.audit[1], {
    actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production",
    fromState: "open", toState: "completed", actorId: "user-1", revision: 2, idempotencyKey: "close-1"
  });
});

test("Sales opportunity stage history appends one complete audit entry per accepted transition", async () => {
  const state = { id: "2", name: "Platform rollout", ownerId: "user-1", pipelineId: 17, stageId: qualificationStageId, archiveStatus: "active", revision: 1, audit: [{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead", ownershipGenesis: { ownerId: "user-1", teamId: null } }] };
  const contexts = [];
  const request = {
    payload: {
      create: async () => ({}),
      find: async (options) => p134StageFind(state, options),
      update: async (options) => {
        contexts.push(options.context);
        Object.assign(state, { stageId: options.data.stageId, revision: options.data.revision, audit: options.data.audit });
        return { docs: [structuredClone(state)], errors: [] };
      }
    }
  };
  const authorizationContext = { actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", authorizationRevision: 4, lifecycleRevision: 2, salesScopeRevision: 7 };
  const stages = [discoveryStageId, proposalStageId, negotiationStageId];
  for (const stage of stages) {
    const result = await salesOpportunityStageUpdateHandler({
      actor: handlerContext().actor, request, authorizationContext,
      input: stageMove("2", state.revision, state.stageId, stage),
      idempotencyKey: `opp-${stage}-1`, signal: new AbortController().signal
    });
    assert.equal(result.stageId, stage);
  }
  assert.equal(state.audit.length, stages.length + 1);
  for (const [index, entry] of state.audit.slice(1).entries()) {
    assertActionAudit(entry, {
      actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production",
      fromState: index === 0 ? qualificationStageId : stages[index - 1], toState: stages[index], actorId: "user-1", revision: index + 2,
      idempotencyKey: `opp-${stages[index]}-1`
    });
  }
  assert.equal(contexts.filter(({ kNexSalesEvent }) => kNexSalesEvent.workflow !== undefined).length, 1);
  assert.deepEqual(contexts[1].kNexSalesEvent.workflow, {
    type: "sales.event.workflow.opportunity-proposal-entered", workflowId: "sales.workflow.opportunity-proposal-follow-up", workflowVersion: 1,
    effectKind: "create-owner-follow-up-task", acceptedOwnerId: "user-1", recipientId: "user-1",
    authorizationRevision: 4, lifecycleRevision: 2, scopeRevision: 7
  });
});

test("Sales opportunity stage update rejects archived records before audit or mutation", async () => {
  let updates = 0;
  const audit = [{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead", ownershipGenesis: { ownerId: "user-1", teamId: null } }];
  const document = { id: "2", name: "Archived", ownerId: "user-1", pipelineId: 17, stageId: qualificationStageId, archiveStatus: "archived", revision: 1, audit };
  const request = { payload: {
    find: async () => ({ docs: [structuredClone(document)] }), create: async () => ({}),
    update: async () => { updates += 1; return { docs: [], errors: [] }; }
  } };
  await assert.rejects(salesOpportunityStageUpdateHandler({
    actor: handlerContext().actor, request,
    authorizationContext: { actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" },
    input: stageMove("2", 1, qualificationStageId, discoveryStageId),
    idempotencyKey: "archived-stage-1", signal: new AbortController().signal
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  assert.equal(updates, 0);
  assert.deepEqual(document.audit, audit);
});

test("Sales opportunity stage update denies a trusted graph edge removed by configuration", async () => {
  let updates = 0;
  const state = { id: "2", name: "Configured", ownerId: "user-1", pipelineId: 17, stageId: qualificationStageId, archiveStatus: "active", revision: 1, audit: [{ kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "lead", ownershipGenesis: { ownerId: "user-1", teamId: null } }] };
  const request = { payload: {
    create: async () => ({}),
    find: async (options) => {
      const found = p134StageFind(state, options);
      if (options.collection !== "sales-pipeline-stages") return found;
      const stageId = options.where.and.find((clause) => clause.stageId)?.stageId.equals;
      return stageId === qualificationStageId ? { docs: found.docs.map((stage) => ({ ...stage, allowedTransitionStageIds: [] })) } : found;
    },
    update: async () => { updates += 1; return { docs: [], errors: [] }; }
  } };
  await assert.rejects(salesOpportunityStageUpdateHandler({ actor: handlerContext().actor, request,
    authorizationContext: { actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" },
    input: stageMove("2", 1, qualificationStageId, discoveryStageId), idempotencyKey: "removed-edge-1", signal: new AbortController().signal
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  assert.equal(updates, 0);
});

test("Sales update actions use actor-scoped Payload updates exactly once", async () => {
  const calls = [];
  const taskAudit = { actionId: "sales.task.create", resourceId: "1", applicationId: "customer-gate-1", environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: "user-1", revision: 1, idempotencyKey: "task-create-1" };
  const opportunityAudit = { kind: "phase-13-legacy-upgrade", receiptDigest: `sha256:${"0".repeat(64)}`, legacyStage: "qualified", ownershipGenesis: { ownerId: "user-1", teamId: null } };
  const request = {
    payload: {
      find: async (options) => options.collection === "sales-tasks" ? { docs: [{ id: "1", status: "open", revision: 1, audit: [taskAudit] }] }
        : p134StageFind({ id: "2", ownerId: "user-1", pipelineId: 17, stageId: discoveryStageId, archiveStatus: "active", revision: 1, audit: [opportunityAudit] }, options), create: async () => ({}),
      update: async (options) => {
        calls.push(options);
        return options.collection === "sales-tasks"
          ? { docs: [{ id: "1", title: "Existing", status: options.data.status, revision: options.data.revision }], errors: [] }
          : { docs: [{ id: "2", name: "Platform rollout", stageId: options.data.stageId, revision: options.data.revision }], errors: [] };
      }
    }
  };
  const auth = (actionId, resourceId) => ({ actionId, resourceId, applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1", authorizationRevision: 4, lifecycleRevision: 2, salesScopeRevision: 7 });
  const base = { actor: handlerContext().actor, request, idempotencyKey: "update-1", signal: new AbortController().signal };
  assert.deepEqual(await salesTaskUpdateHandler({ ...base, authorizationContext: auth("sales.task.update", "1"), input: { id: "1", expectedRevision: 1, expectedStatus: "open", status: "completed" } }), { id: "1", title: "Existing", status: "completed", revision: 2 });
  assert.deepEqual(await salesOpportunityStageUpdateHandler({ ...base, authorizationContext: auth("sales.opportunity.stage.update", "2"), input: stageMove("2", 1, discoveryStageId, proposalStageId) }), { id: "2", pipelineId: "17", stageId: proposalStageId, revision: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.overrideAccess === true && call.user.id === "user-1"), true);
  assert.deepEqual(calls[1].where, { and: [
    { id: { equals: "2" } },
    { applicationId: { equals: "customer-gate-1" } },
    { environment: { equals: "production" } },
    { ownerId: { equals: "user-1" } },
    { revision: { equals: 1 } }
  ] });
  assert.deepEqual(calls[0].data.audit.slice(0, 1), [taskAudit]);
  assertActionAudit(calls[0].data.audit[1], {
    actionId: "sales.task.update", resourceId: "1", applicationId: "customer-gate-1", environment: "production",
    fromState: "open", toState: "completed", actorId: "user-1", revision: 2, idempotencyKey: "update-1"
  });
  assert.deepEqual(calls[1].data.audit.slice(0, 1), [opportunityAudit]);
  assertActionAudit(calls[1].data.audit[1], {
    actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production",
    fromState: discoveryStageId, toState: proposalStageId, actorId: "user-1", revision: 2, idempotencyKey: "update-1"
  });
});

test("Sales rejects a stale opportunity card without a blind update", async () => {
  let updates = 0;
  const request = { payload: { find: async () => ({ docs: [] }), create: async () => ({}), update: async () => { updates += 1; return { docs: [], errors: [] }; } } };
  await assert.rejects(salesOpportunityStageUpdateHandler({
    actor: handlerContext().actor, request,
    authorizationContext: { actionId: "sales.opportunity.stage.update", resourceId: "2", applicationId: "customer-gate-1", environment: "production", actorId: "user-1", ownerId: "user-1" },
    idempotencyKey: "stale-1", signal: new AbortController().signal,
    input: stageMove("2", 1, qualificationStageId, discoveryStageId)
  }), (error) => error?.code === "STALE_RECORD" && error?.status === 409);
  assert.equal(updates, 0);
});
