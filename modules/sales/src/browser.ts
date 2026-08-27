import { defineActionMutation, defineSourceQuery } from "@k-nex/ui-runtime";

import {
  salesCreateTaskInputRuntimeSchema,
  salesCreateTaskOutputRuntimeSchema,
  salesEmptyInputRuntimeSchema,
  salesTaskCreateDescriptor,
  salesRouteDescriptors,
  salesTasksDescriptor,
  salesTasksOutputRuntimeSchema,
  salesTotalPotentialRevenueOutputRuntimeSchema,
  salesTotalPotentialRevenueDescriptor
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

export const salesCreateTaskMutation = defineActionMutation({
  action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version },
  input: salesCreateTaskInputRuntimeSchema,
  output: salesCreateTaskOutputRuntimeSchema,
  invalidates: [salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id]
});

export const salesBrowserContract = Object.freeze({
  pluginId: "module.sales" as const,
  sourceIds: Object.freeze([
    salesTasksDescriptor.id,
    salesTotalPotentialRevenueDescriptor.id
  ]),
  actionIds: Object.freeze([salesTaskCreateDescriptor.id]),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id))
});
