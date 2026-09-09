import { defineActionMutation, defineSourceQuery } from "@k-nex/ui-runtime";
import { TableRecordsSchema } from "@k-nex/contracts";
import { salesAccountDetailDescriptor, salesAccountDetailOutputRuntimeSchema, salesAccountsDescriptor, salesAccountsOutputRuntimeSchema, salesAccountArchiveDescriptor, salesAccountCreateDescriptor, salesAccountUpdateDescriptor, salesActivityCancelDescriptor, salesActivityCompleteDescriptor, salesActivityCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor, salesContactDetailDescriptor, salesContactDetailOutputRuntimeSchema, salesContactsDescriptor, salesContactsOutputRuntimeSchema, salesContactArchiveDescriptor, salesContactCreateDescriptor, salesContactUpdateDescriptor, salesCreateTaskInputRuntimeSchema, salesCreateTaskOutputRuntimeSchema, salesCrmDetailInputRuntimeSchema, salesEmptyInputRuntimeSchema, salesLeadDetailDescriptor, salesLeadDetailOutputRuntimeSchema, salesLeadsDescriptor, salesLeadsOutputRuntimeSchema, salesLeadArchiveDescriptor, salesLeadCreateDescriptor, salesLeadDisqualifyDescriptor, salesLeadQualifyDescriptor, salesLeadUpdateDescriptor, salesNoteCreateDescriptor, salesOpportunitiesDescriptor, salesOpportunityDetailDescriptor, salesOpportunityDetailOutputRuntimeSchema, salesOpportunityArchiveDescriptor, salesOpportunityCloseDescriptor, salesOpportunityCreateDescriptor, salesOpportunityUpdateDescriptor, salesOwnershipAssignDescriptor, salesOpportunitiesOutputRuntimeSchema, salesOpportunityStageInputRuntimeSchema, salesOpportunityStageOutputRuntimeSchema, salesOpportunityStageUpdateDescriptor, salesPipelineArchiveDescriptor, salesPipelineUpdateDescriptor, salesPipelineSnapshotDescriptor, salesDedupeCandidatesDescriptor, salesDataMovementActionInputRuntimeSchemas, salesDataMovementActionOutputRuntimeSchemas, salesExportCancelDescriptor, salesExportCreateDescriptor, salesExportJobDetailDescriptor, salesExportJobListDescriptor, salesImportCancelDescriptor, salesImportCommitDescriptor, salesImportDryRunDescriptor, salesImportJobDetailDescriptor, salesImportJobListDescriptor, salesMergeCommitDescriptor, salesNotificationsDescriptor, salesProviderConfigurationsDescriptor, salesNotificationsOutputRuntimeSchema, salesRemindersDescriptor, salesRemindersOutputRuntimeSchema, salesNotificationReadDescriptor, salesNotificationArchiveDescriptor, salesReminderDismissDescriptor, salesReminderScheduleDescriptor, salesEmailSendDescriptor, salesCalendarSyncDescriptor, salesIntegrationConfigureDescriptor, salesCommunicationActionInputRuntimeSchemas, salesCommunicationActionOutputRuntimeSchemas, salesSavedViewCalendarDescriptor, salesSavedViewDetailDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor, salesSavedViewArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesRouteDescriptors, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor, salesTasksOutputRuntimeSchema, salesTimelineDescriptor, salesTimelineOutputRuntimeSchema, salesTimelineInputRuntimeSchema, salesUpdateTaskInputRuntimeSchema, salesUpdateTaskOutputRuntimeSchema, salesWorkflowActionInputRuntimeSchemas, salesWorkflowActionOutputRuntimeSchemas } from "./contracts.js";
export function salesWorkspacePresentation(settings) {
    const routeId = settings.defaultPage === "overview" ? "sales.route.overview"
        : settings.defaultPage === "opportunities" ? "sales.route.opportunities" : "sales.route.tasks";
    return Object.freeze({
        routeId,
        taskPageSize: settings.defaultTaskPageSize,
        showPotentialRevenue: settings.showPotentialRevenue
    });
}
export const salesTasksQuery = defineSourceQuery({
    source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version },
    input: salesEmptyInputRuntimeSchema,
    output: salesTasksOutputRuntimeSchema,
    defaults: {},
    selectedFields: ["title", "status"],
    isEmpty: (value) => value.rows.length === 0
});
export const salesOpportunitiesQuery = defineSourceQuery({
    source: { id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version },
    input: salesEmptyInputRuntimeSchema,
    output: salesOpportunitiesOutputRuntimeSchema,
    defaults: {},
    selectedFields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision"],
    isEmpty: (value) => value.rows.length === 0
});
const savedViewBindingInputRuntimeSchema = { safeParse(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            return { success: false, error: new Error("Sales saved-view binding is invalid.") };
        const record = value;
        const keys = Object.keys(record).sort().join("\u0000");
        if (keys !== "" && keys !== "expected-revision\u0000saved-view-id" || keys !== "" && (!Number.isSafeInteger(record["saved-view-id"]) || record["saved-view-id"] < 1 || !Number.isSafeInteger(record["expected-revision"]) || record["expected-revision"] < 1))
            return { success: false, error: new Error("Sales saved-view binding is invalid.") };
        return { success: true, data: record };
    } };
const exactTableOutput = (fields) => ({ safeParse(value) {
        const parsed = TableRecordsSchema.safeParse(value);
        if (!parsed.success || parsed.data.fields.join("\u0000") !== fields.join("\u0000") || parsed.data.rows.some((row) => Object.keys(row.values).sort().join("\u0000") !== [...fields].sort().join("\u0000")))
            return { success: false, error: new Error("Sales saved-view output is invalid.") };
        return { success: true, data: parsed.data };
    } });
const savedViewQuery = (descriptor, fields, input = savedViewBindingInputRuntimeSchema, defaults = {}) => defineSourceQuery({ source: { id: descriptor.id, version: descriptor.version }, input, output: exactTableOutput(fields), defaults, selectedFields: fields, isEmpty: (value) => value.rows.length === 0 });
export const salesSavedViewTableQuery = savedViewQuery(salesSavedViewTableDescriptor, ["name"]);
export const salesSavedViewKanbanQuery = savedViewQuery(salesSavedViewKanbanDescriptor, ["row-kind", "name", "stage-id", "stage-metadata", "revision"]);
export const salesSavedViewCalendarQuery = savedViewQuery(salesSavedViewCalendarDescriptor, ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"]);
export const salesPipelineSnapshotQuery = savedViewQuery(salesPipelineSnapshotDescriptor, ["pipeline-id", "pipeline-revision", "pipeline-name", "stage-id", "stage-revision", "semantic", "stage-name", "position", "probability-basis-points", "allowed-transition-stage-ids", "required-field-ids", "status"], salesEmptyInputRuntimeSchema);
export const salesSavedViewListQuery = savedViewQuery(salesSavedViewListDescriptor, ["id", "name", "visibility", "team-id", "target-object-id", "view-kind", "revision", "status"], salesEmptyInputRuntimeSchema);
export const salesSavedViewDetailQuery = savedViewQuery(salesSavedViewDetailDescriptor, ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"], { safeParse(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !Number.isSafeInteger(value["saved-view-id"]))
            return { success: false, error: new Error("Sales saved-view selection is invalid.") };
        return { success: true, data: value };
    } }, { "saved-view-id": 1 });
const dataMovementSelectionInput = (id) => ({ safeParse(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            return { success: false, error: new Error("Sales job selection is invalid.") };
        const record = value;
        const keys = Object.keys(record).sort().join("\u0000");
        if (keys !== "" && keys !== `${id}\u0000expected-revision` || keys !== "" && (!Number.isSafeInteger(record[id]) || record[id] < 1 || !Number.isSafeInteger(record["expected-revision"]) || record["expected-revision"] < 1))
            return { success: false, error: new Error("Sales job selection is invalid.") };
        return { success: true, data: record };
    } });
const dedupeSelectionInput = { safeParse(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            return { success: false, error: new Error("Sales duplicate selection is invalid.") };
        const record = value;
        const keys = Object.keys(record).sort().join("\u0000");
        if (keys !== "" && keys !== "expected-revision\u0000id\u0000target-object-type" || keys !== "" && (record["target-object-type"] !== "sales.object.account" && record["target-object-type"] !== "sales.object.contact" || !Number.isSafeInteger(record.id) || record.id < 1 || !Number.isSafeInteger(record["expected-revision"]) || record["expected-revision"] < 1))
            return { success: false, error: new Error("Sales duplicate selection is invalid.") };
        return { success: true, data: record };
    } };
export const salesImportJobListQuery = savedViewQuery(salesImportJobListDescriptor, ["id", "target-object-type", "state", "accepted-rows", "rejected-rows", "revision"], salesEmptyInputRuntimeSchema);
export const salesImportJobDetailQuery = savedViewQuery(salesImportJobDetailDescriptor, ["id", "state", "diagnostic-code", "artifact-expires-at", "revision"], dataMovementSelectionInput("import-job-id"));
export const salesExportJobListQuery = savedViewQuery(salesExportJobListDescriptor, ["id", "target-object-type", "state", "row-count", "revision"], salesEmptyInputRuntimeSchema);
export const salesExportJobDetailQuery = savedViewQuery(salesExportJobDetailDescriptor, ["id", "state", "artifact-id", "artifact-expires-at", "revision"], dataMovementSelectionInput("export-job-id"));
export const salesDedupeCandidatesQuery = savedViewQuery(salesDedupeCandidatesDescriptor, ["candidate-id", "candidate-revision", "match-kind"], dedupeSelectionInput);
export const salesNotificationsQuery = savedViewQuery(salesNotificationsDescriptor, ["subject", "state", "created-at", "revision"], salesEmptyInputRuntimeSchema);
export const salesRemindersQuery = savedViewQuery(salesRemindersDescriptor, ["subject", "state", "scheduled-at", "reference-kind", "reference-id", "revision"], salesEmptyInputRuntimeSchema);
export const salesProviderConfigurationsQuery = savedViewQuery(salesProviderConfigurationsDescriptor, ["provider-id", "state", "revision", "updated-at", "revoked-at"], salesEmptyInputRuntimeSchema);
const crmListQuery = (descriptor, output, selectedFields) => defineSourceQuery({ source: { id: descriptor.id, version: descriptor.version }, input: salesEmptyInputRuntimeSchema, output, defaults: {}, selectedFields, isEmpty: (value) => value.rows.length === 0 });
const crmDetailQuery = (descriptor, output, selectedFields) => defineSourceQuery({ source: { id: descriptor.id, version: descriptor.version }, input: salesCrmDetailInputRuntimeSchema, output, defaults: { id: "1" }, selectedFields, isEmpty: (value) => value.rows.length === 0 });
export const salesAccountsQuery = crmListQuery(salesAccountsDescriptor, salesAccountsOutputRuntimeSchema, ["name", "owner-id", "status", "revision"]);
export const salesContactsQuery = crmListQuery(salesContactsDescriptor, salesContactsOutputRuntimeSchema, ["display-name", "owner-id", "account-id", "status", "revision"]);
export const salesLeadsQuery = crmListQuery(salesLeadsDescriptor, salesLeadsOutputRuntimeSchema, ["display-name", "owner-id", "status", "archive-status", "revision"]);
export const salesAccountDetailQuery = crmDetailQuery(salesAccountDetailDescriptor, salesAccountDetailOutputRuntimeSchema, ["name", "owner-id", "team-id", "status", "revision"]);
export const salesContactDetailQuery = crmDetailQuery(salesContactDetailDescriptor, salesContactDetailOutputRuntimeSchema, ["display-name", "owner-id", "team-id", "account-id", "status", "revision"]);
export const salesLeadDetailQuery = crmDetailQuery(salesLeadDetailDescriptor, salesLeadDetailOutputRuntimeSchema, ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"]);
export const salesOpportunityDetailQuery = crmDetailQuery(salesOpportunityDetailDescriptor, salesOpportunityDetailOutputRuntimeSchema, ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "expected-close-date", "revision"]);
const timelineBrowserInput = { safeParse(value) {
        const parsed = salesTimelineInputRuntimeSchema.safeParse(value);
        return parsed.success ? { success: true, data: value } : parsed;
    } };
const timelineQuery = (selectedFields) => defineSourceQuery({
    source: { id: salesTimelineDescriptor.id, version: salesTimelineDescriptor.version }, input: timelineBrowserInput, output: salesTimelineOutputRuntimeSchema,
    defaults: { "related-record-type": "sales.account", "related-record-id": "1" }, selectedFields, isEmpty: (value) => value.rows.length === 0
});
export const salesTimelineQuery = timelineQuery(["kind", "subject", "status", "occurred-at", "revision"]);
export const salesTimelineWithBodyQuery = timelineQuery(["kind", "subject", "status", "occurred-at", "revision", "body"]);
function workflowMutation(descriptor, invalidates) {
    return defineActionMutation({
        action: { id: descriptor.id, version: descriptor.version },
        input: salesWorkflowActionInputRuntimeSchemas[descriptor.id],
        output: salesWorkflowActionOutputRuntimeSchemas[descriptor.id],
        invalidates
    });
}
const accountSources = [salesAccountsDescriptor.id, salesAccountDetailDescriptor.id];
const contactSources = [salesContactsDescriptor.id, salesContactDetailDescriptor.id];
const leadSources = [salesLeadsDescriptor.id, salesLeadDetailDescriptor.id];
const opportunitySources = [salesOpportunitiesDescriptor.id, salesOpportunityDetailDescriptor.id];
export const salesAccountCreateMutation = workflowMutation(salesAccountCreateDescriptor, accountSources);
export const salesAccountUpdateMutation = workflowMutation(salesAccountUpdateDescriptor, accountSources);
export const salesAccountArchiveMutation = workflowMutation(salesAccountArchiveDescriptor, accountSources);
export const salesContactCreateMutation = workflowMutation(salesContactCreateDescriptor, contactSources);
export const salesContactUpdateMutation = workflowMutation(salesContactUpdateDescriptor, contactSources);
export const salesContactArchiveMutation = workflowMutation(salesContactArchiveDescriptor, contactSources);
export const salesLeadCreateMutation = workflowMutation(salesLeadCreateDescriptor, leadSources);
export const salesLeadUpdateMutation = workflowMutation(salesLeadUpdateDescriptor, leadSources);
export const salesLeadQualifyMutation = workflowMutation(salesLeadQualifyDescriptor, [...leadSources, ...accountSources, ...contactSources, ...opportunitySources]);
export const salesLeadDisqualifyMutation = workflowMutation(salesLeadDisqualifyDescriptor, leadSources);
export const salesLeadArchiveMutation = workflowMutation(salesLeadArchiveDescriptor, leadSources);
export const salesOpportunityCreateMutation = workflowMutation(salesOpportunityCreateDescriptor, opportunitySources);
export const salesOpportunityUpdateMutation = workflowMutation(salesOpportunityUpdateDescriptor, opportunitySources);
export const salesOpportunityCloseMutation = workflowMutation(salesOpportunityCloseDescriptor, opportunitySources);
export const salesOpportunityArchiveMutation = workflowMutation(salesOpportunityArchiveDescriptor, opportunitySources);
export const salesActivityCreateMutation = workflowMutation(salesActivityCreateDescriptor, [salesTimelineDescriptor.id]);
export const salesActivityCompleteMutation = workflowMutation(salesActivityCompleteDescriptor, [salesTimelineDescriptor.id]);
export const salesActivityCancelMutation = workflowMutation(salesActivityCancelDescriptor, [salesTimelineDescriptor.id]);
export const salesNoteCreateMutation = workflowMutation(salesNoteCreateDescriptor, [salesTimelineDescriptor.id]);
export const salesAttachmentLinkMutation = workflowMutation(salesAttachmentLinkDescriptor, [salesTimelineDescriptor.id]);
export const salesAttachmentRemoveMutation = workflowMutation(salesAttachmentRemoveDescriptor, [salesTimelineDescriptor.id]);
export const salesOwnershipAssignMutation = workflowMutation(salesOwnershipAssignDescriptor, [...accountSources, ...contactSources, ...leadSources, ...opportunitySources]);
export const salesWorkflowMutations = Object.freeze([
    salesAccountCreateMutation, salesAccountUpdateMutation, salesAccountArchiveMutation,
    salesContactCreateMutation, salesContactUpdateMutation, salesContactArchiveMutation,
    salesLeadCreateMutation, salesLeadUpdateMutation, salesLeadQualifyMutation, salesLeadDisqualifyMutation, salesLeadArchiveMutation,
    salesOpportunityCreateMutation, salesOpportunityUpdateMutation, salesOpportunityCloseMutation, salesOpportunityArchiveMutation,
    salesActivityCreateMutation, salesActivityCompleteMutation, salesActivityCancelMutation, salesNoteCreateMutation, salesAttachmentLinkMutation, salesAttachmentRemoveMutation,
    salesOwnershipAssignMutation
]);
export const salesCreateTaskMutation = defineActionMutation({
    action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version },
    input: salesCreateTaskInputRuntimeSchema,
    output: salesCreateTaskOutputRuntimeSchema,
    invalidates: [salesTasksDescriptor.id]
});
export const salesUpdateTaskMutation = defineActionMutation({
    action: { id: salesTaskUpdateDescriptor.id, version: salesTaskUpdateDescriptor.version },
    input: salesUpdateTaskInputRuntimeSchema,
    output: salesUpdateTaskOutputRuntimeSchema,
    invalidates: [salesTasksDescriptor.id]
});
export const salesOpportunityStageMutation = defineActionMutation({
    action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version },
    input: salesOpportunityStageInputRuntimeSchema,
    output: salesOpportunityStageOutputRuntimeSchema,
    invalidates: [salesOpportunitiesDescriptor.id]
});
export const salesPipelineUpdateMutation = workflowMutation(salesPipelineUpdateDescriptor, [salesPipelineSnapshotDescriptor.id]);
export const salesPipelineArchiveMutation = workflowMutation(salesPipelineArchiveDescriptor, [salesPipelineSnapshotDescriptor.id]);
const savedViewSources = [salesSavedViewListDescriptor.id, salesSavedViewDetailDescriptor.id, salesSavedViewTableDescriptor.id, salesSavedViewKanbanDescriptor.id, salesSavedViewCalendarDescriptor.id];
export const salesSavedViewCreateMutation = workflowMutation(salesSavedViewCreateDescriptor, savedViewSources);
export const salesSavedViewUpdateMutation = workflowMutation(salesSavedViewUpdateDescriptor, savedViewSources);
export const salesSavedViewArchiveMutation = workflowMutation(salesSavedViewArchiveDescriptor, savedViewSources);
function dataMovementMutation(descriptor, invalidates) {
    return defineActionMutation({ action: { id: descriptor.id, version: descriptor.version }, input: salesDataMovementActionInputRuntimeSchemas[descriptor.id], output: salesDataMovementActionOutputRuntimeSchemas[descriptor.id], invalidates });
}
const importSources = [salesImportJobListDescriptor.id, salesImportJobDetailDescriptor.id];
const exportSources = [salesExportJobListDescriptor.id, salesExportJobDetailDescriptor.id];
export const salesImportDryRunMutation = dataMovementMutation(salesImportDryRunDescriptor, importSources);
export const salesImportCommitMutation = dataMovementMutation(salesImportCommitDescriptor, importSources);
export const salesImportCancelMutation = dataMovementMutation(salesImportCancelDescriptor, importSources);
export const salesExportCreateMutation = dataMovementMutation(salesExportCreateDescriptor, exportSources);
export const salesExportCancelMutation = dataMovementMutation(salesExportCancelDescriptor, exportSources);
export const salesMergeCommitMutation = dataMovementMutation(salesMergeCommitDescriptor, [salesDedupeCandidatesDescriptor.id, salesAccountsDescriptor.id, salesAccountDetailDescriptor.id, salesContactsDescriptor.id, salesContactDetailDescriptor.id]);
function communicationMutation(descriptor, invalidates) {
    return defineActionMutation({ action: { id: descriptor.id, version: descriptor.version }, input: salesCommunicationActionInputRuntimeSchemas[descriptor.id], output: salesCommunicationActionOutputRuntimeSchemas[descriptor.id], invalidates });
}
const notificationSources = [salesNotificationsDescriptor.id, salesRemindersDescriptor.id];
export const salesNotificationReadMutation = communicationMutation(salesNotificationReadDescriptor, notificationSources);
export const salesNotificationArchiveMutation = communicationMutation(salesNotificationArchiveDescriptor, notificationSources);
export const salesReminderDismissMutation = communicationMutation(salesReminderDismissDescriptor, notificationSources);
export const salesReminderScheduleMutation = communicationMutation(salesReminderScheduleDescriptor, notificationSources);
export const salesEmailSendMutation = communicationMutation(salesEmailSendDescriptor, notificationSources);
export const salesCalendarSyncMutation = communicationMutation(salesCalendarSyncDescriptor, notificationSources);
export const salesIntegrationConfigureMutation = communicationMutation(salesIntegrationConfigureDescriptor, [salesProviderConfigurationsDescriptor.id]);
export const salesBrowserContract = Object.freeze({
    pluginId: "module.sales",
    sourceIds: Object.freeze([
        salesAccountDetailDescriptor.id,
        salesAccountsDescriptor.id,
        salesContactDetailDescriptor.id,
        salesContactsDescriptor.id,
        salesLeadDetailDescriptor.id,
        salesLeadsDescriptor.id,
        salesTasksDescriptor.id,
        salesTimelineDescriptor.id,
        salesOpportunityDetailDescriptor.id,
        salesOpportunitiesDescriptor.id,
        salesPipelineSnapshotDescriptor.id,
        salesImportJobListDescriptor.id,
        salesImportJobDetailDescriptor.id,
        salesExportJobListDescriptor.id,
        salesExportJobDetailDescriptor.id,
        salesDedupeCandidatesDescriptor.id,
        salesSavedViewCalendarDescriptor.id,
        salesSavedViewDetailDescriptor.id,
        salesSavedViewKanbanDescriptor.id,
        salesSavedViewListDescriptor.id,
        salesSavedViewTableDescriptor.id,
        salesNotificationsDescriptor.id, salesRemindersDescriptor.id, salesProviderConfigurationsDescriptor.id
    ].sort()),
    actionIds: Object.freeze([salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id, salesOpportunityStageUpdateDescriptor.id, salesPipelineUpdateDescriptor.id, salesPipelineArchiveDescriptor.id, salesSavedViewCreateDescriptor.id, salesSavedViewUpdateDescriptor.id, salesSavedViewArchiveDescriptor.id, salesImportDryRunDescriptor.id, salesImportCommitDescriptor.id, salesImportCancelDescriptor.id, salesExportCreateDescriptor.id, salesExportCancelDescriptor.id, salesMergeCommitDescriptor.id, salesNotificationReadDescriptor.id, salesNotificationArchiveDescriptor.id, salesReminderDismissDescriptor.id, salesReminderScheduleDescriptor.id, salesEmailSendDescriptor.id, salesCalendarSyncDescriptor.id, salesIntegrationConfigureDescriptor.id, ...salesWorkflowMutations.map(({ action }) => action.id)].sort()),
    routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id))
});
//# sourceMappingURL=browser.js.map