import { defineActionMutation, defineSourceQuery } from "@k-nex/ui-runtime";

import {
  salesAccountDetailDescriptor,
  salesAccountDetailOutputRuntimeSchema,
  salesAccountsDescriptor,
  salesAccountsOutputRuntimeSchema,
  salesAccountArchiveDescriptor,
  salesAccountCreateDescriptor,
  salesAccountUpdateDescriptor,
  salesActivityCancelDescriptor,
  salesActivityCompleteDescriptor,
  salesActivityCreateDescriptor,
  salesAttachmentLinkDescriptor,
  salesAttachmentRemoveDescriptor,
  salesContactDetailDescriptor,
  salesContactDetailOutputRuntimeSchema,
  salesContactsDescriptor,
  salesContactsOutputRuntimeSchema,
  salesContactArchiveDescriptor,
  salesContactCreateDescriptor,
  salesContactUpdateDescriptor,
  salesCreateTaskInputRuntimeSchema,
  salesCreateTaskOutputRuntimeSchema,
  salesCrmDetailInputRuntimeSchema,
  salesEmptyInputRuntimeSchema,
  salesLeadDetailDescriptor,
  salesLeadDetailOutputRuntimeSchema,
  salesLeadsDescriptor,
  salesLeadsOutputRuntimeSchema,
  salesLeadArchiveDescriptor,
  salesLeadCreateDescriptor,
  salesLeadDisqualifyDescriptor,
  salesLeadQualifyDescriptor,
  salesLeadUpdateDescriptor,
  salesNoteCreateDescriptor,
  salesOpportunitiesDescriptor,
  salesOpportunityDetailDescriptor,
  salesOpportunityDetailOutputRuntimeSchema,
  salesOpportunityArchiveDescriptor,
  salesOpportunityCloseDescriptor,
  salesOpportunityCreateDescriptor,
  salesOpportunityUpdateDescriptor,
  salesOwnershipAssignDescriptor,
  salesOpportunitiesOutputRuntimeSchema,
  salesOpportunityStageInputRuntimeSchema,
  salesOpportunityStageOutputRuntimeSchema,
  salesOpportunityStageUpdateDescriptor,
  salesRouteDescriptors,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesTasksDescriptor,
  salesTasksOutputRuntimeSchema,
  salesTimelineDescriptor,
  salesTimelineOutputRuntimeSchema,
  salesTimelineInputRuntimeSchema,
  salesUpdateTaskInputRuntimeSchema,
  salesUpdateTaskOutputRuntimeSchema,
  salesWorkflowActionInputRuntimeSchemas,
  salesWorkflowActionOutputRuntimeSchemas,
  type SalesWorkspaceSettings
} from "./contracts.js";

export interface SalesWorkspacePresentation {
  readonly routeId: "sales.route.overview" | "sales.route.opportunities" | "sales.route.tasks";
  readonly taskPageSize: number;
  readonly showPotentialRevenue: boolean;
  readonly pipelineStages: readonly string[];
}

export function salesWorkspacePresentation(settings: SalesWorkspaceSettings): Readonly<SalesWorkspacePresentation> {
  const routeId = settings.defaultPage === "overview" ? "sales.route.overview"
    : settings.defaultPage === "opportunities" ? "sales.route.opportunities" : "sales.route.tasks";
  return Object.freeze({
    routeId,
    taskPageSize: settings.defaultTaskPageSize,
    showPotentialRevenue: settings.showPotentialRevenue,
    pipelineStages: Object.freeze([...settings.pipelineStages])
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
  selectedFields: ["name", "stage-id", "revision"],
  isEmpty: (value) => value.rows.length === 0
});

const crmListQuery = (
  descriptor: typeof salesAccountsDescriptor,
  output: typeof salesAccountsOutputRuntimeSchema,
  selectedFields: readonly string[]
) => defineSourceQuery({ source: { id: descriptor.id, version: descriptor.version }, input: salesEmptyInputRuntimeSchema, output, defaults: {}, selectedFields, isEmpty: (value) => value.rows.length === 0 });

const crmDetailQuery = (
  descriptor: typeof salesAccountDetailDescriptor,
  output: typeof salesAccountDetailOutputRuntimeSchema,
  selectedFields: readonly string[]
) => defineSourceQuery({ source: { id: descriptor.id, version: descriptor.version }, input: salesCrmDetailInputRuntimeSchema, output, defaults: { id: "1" }, selectedFields, isEmpty: (value) => value.rows.length === 0 });

export const salesAccountsQuery = crmListQuery(salesAccountsDescriptor, salesAccountsOutputRuntimeSchema, ["name", "owner-id", "status", "revision"]);
export const salesContactsQuery = crmListQuery(salesContactsDescriptor, salesContactsOutputRuntimeSchema, ["display-name", "owner-id", "account-id", "status", "revision"]);
export const salesLeadsQuery = crmListQuery(salesLeadsDescriptor, salesLeadsOutputRuntimeSchema, ["display-name", "owner-id", "status", "archive-status", "revision"]);
export const salesAccountDetailQuery = crmDetailQuery(salesAccountDetailDescriptor, salesAccountDetailOutputRuntimeSchema, ["name", "owner-id", "team-id", "status", "revision"]);
export const salesContactDetailQuery = crmDetailQuery(salesContactDetailDescriptor, salesContactDetailOutputRuntimeSchema, ["display-name", "owner-id", "team-id", "account-id", "status", "revision"]);
export const salesLeadDetailQuery = crmDetailQuery(salesLeadDetailDescriptor, salesLeadDetailOutputRuntimeSchema, ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"]);
export const salesOpportunityDetailQuery = crmDetailQuery(salesOpportunityDetailDescriptor, salesOpportunityDetailOutputRuntimeSchema, ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "expected-close-date", "revision"]);

type TimelineInput = Readonly<{ "related-record-type": "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task"; "related-record-id": string }>;
const timelineBrowserInput = { safeParse(value: unknown) {
  const parsed = salesTimelineInputRuntimeSchema.safeParse(value);
  return parsed.success ? { success: true as const, data: value as TimelineInput } : parsed;
} };
const timelineQuery = (selectedFields: readonly string[]) => defineSourceQuery({
  source: { id: salesTimelineDescriptor.id, version: salesTimelineDescriptor.version }, input: timelineBrowserInput, output: salesTimelineOutputRuntimeSchema,
  defaults: { "related-record-type": "sales.account", "related-record-id": "1" } as TimelineInput, selectedFields, isEmpty: (value) => value.rows.length === 0
});
export const salesTimelineQuery = timelineQuery(["kind", "subject", "status", "occurred-at", "revision"]);
export const salesTimelineWithBodyQuery = timelineQuery(["kind", "subject", "status", "occurred-at", "revision", "body"]);

function workflowMutation(descriptor: { readonly id: string; readonly version: number }, invalidates: readonly string[]) {
  return defineActionMutation({
    action: { id: descriptor.id, version: descriptor.version },
    input: salesWorkflowActionInputRuntimeSchemas[descriptor.id]!,
    output: salesWorkflowActionOutputRuntimeSchemas[descriptor.id]!,
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

export const salesBrowserContract = Object.freeze({
  pluginId: "module.sales" as const,
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
    salesOpportunitiesDescriptor.id
  ].sort()),
  actionIds: Object.freeze([salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id, salesOpportunityStageUpdateDescriptor.id, ...salesWorkflowMutations.map(({ action }) => action.id)].sort()),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id))
});
