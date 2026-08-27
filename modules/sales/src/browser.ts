import { defineActionMutation, defineSourceQuery } from "@k-nex/ui-runtime";

import {
  salesCreateTaskInputRuntimeSchema,
  salesCreateTaskOutputRuntimeSchema,
  salesEmptyInputRuntimeSchema,
  salesOpportunitiesDescriptor,
  salesOpportunitiesOutputRuntimeSchema,
  salesOpportunityStageInputRuntimeSchema,
  salesOpportunityStageOutputRuntimeSchema,
  salesOpportunityStageUpdateDescriptor,
  salesRouteDescriptors,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesTasksDescriptor,
  salesTasksOutputRuntimeSchema,
  salesTotalPotentialRevenueDescriptor,
  salesTotalPotentialRevenueOutputRuntimeSchema,
  salesUpdateTaskInputRuntimeSchema,
  salesUpdateTaskOutputRuntimeSchema
} from "./contracts.js";

export const salesTasksQuery = defineSourceQuery({
  source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version },
  input: salesEmptyInputRuntimeSchema,
  output: salesTasksOutputRuntimeSchema,
  defaults: {},
  selectedFields: ["title", "status", "potential-revenue"],
  isEmpty: (value) => value.rows.length === 0
});

export const salesTotalPotentialRevenueQuery = defineSourceQuery({
  source: { id: salesTotalPotentialRevenueDescriptor.id, version: salesTotalPotentialRevenueDescriptor.version },
  input: salesEmptyInputRuntimeSchema,
  output: salesTotalPotentialRevenueOutputRuntimeSchema,
  defaults: {}
});

export const salesOpportunitiesQuery = defineSourceQuery({
  source: { id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version },
  input: salesEmptyInputRuntimeSchema,
  output: salesOpportunitiesOutputRuntimeSchema,
  defaults: {},
  selectedFields: ["name", "stage", "value"],
  isEmpty: (value) => value.rows.length === 0
});

export const salesCreateTaskMutation = defineActionMutation({
  action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version },
  input: salesCreateTaskInputRuntimeSchema,
  output: salesCreateTaskOutputRuntimeSchema,
  invalidates: [salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id]
});

export const salesUpdateTaskMutation = defineActionMutation({
  action: { id: salesTaskUpdateDescriptor.id, version: salesTaskUpdateDescriptor.version },
  input: salesUpdateTaskInputRuntimeSchema,
  output: salesUpdateTaskOutputRuntimeSchema,
  invalidates: [salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id]
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
    salesTasksDescriptor.id,
    salesOpportunitiesDescriptor.id,
    salesTotalPotentialRevenueDescriptor.id
  ]),
  actionIds: Object.freeze([salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id, salesOpportunityStageUpdateDescriptor.id]),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id))
});
