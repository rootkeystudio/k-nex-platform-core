import { defineUiContributionBinding, type UiBlockRenderInput } from "@k-nex/ui-runtime";

import {
  salesRouteDescriptors,
  salesTaskCreateDescriptor,
  salesTaskTableBlockDescriptor,
  salesTaskTableComponentDescriptor,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor
} from "./contracts.js";

export { salesNavigationDescriptors, salesRouteDescriptors, salesTaskPageTemplate } from "./contracts.js";

const taskTablePropsRuntimeSchema = {
  safeParse(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: new Error("invalid") };
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 1 && typeof record.title === "string" && record.title.length > 0 && record.title.length <= 120
      ? { success: true as const, data: { title: record.title } }
      : { success: false as const, error: new Error("invalid") };
  }
};

export function salesTaskTableRenderer(input: UiBlockRenderInput) {
  const props = input.props as { readonly title: string };
  const state = input.sourceResult?.state ?? "idle";
  return Object.freeze({
    kind: "data-table" as const,
    title: props.title,
    state,
    ...(input.sourceResult !== undefined && "data" in input.sourceResult ? { table: input.sourceResult.data } : {}),
    ...(input.sourceResult !== undefined && "problem" in input.sourceResult ? { problemCode: input.sourceResult.problem.code } : {})
  });
}

export const salesTaskTableComponent = defineUiContributionBinding({
  descriptor: salesTaskTableComponentDescriptor,
  propsSchema: taskTablePropsRuntimeSchema,
  render: salesTaskTableRenderer
});

export const salesTaskTableBlock = defineUiContributionBinding({
  descriptor: salesTaskTableBlockDescriptor,
  propsSchema: taskTablePropsRuntimeSchema,
  render: salesTaskTableRenderer
});

export const salesTaskTablePuckAuthoring = Object.freeze({
  label: "Sales task table",
  fields: Object.freeze([{ prop: "title", label: "Title", kind: "text" as const }]),
  allowChildren: false,
  defaultProps: Object.freeze({ title: "Sales tasks" })
});

export const salesWorkspaceUiContract = Object.freeze({
  pluginId: "module.sales" as const,
  surface: "workspace" as const,
  sourceIds: Object.freeze([salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id]),
  actionIds: Object.freeze([salesTaskCreateDescriptor.id]),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id)),
  pageTemplateIds: Object.freeze(["sales.page.tasks"]),
  componentIds: Object.freeze(["sales.table.tasks"]),
  blockIds: Object.freeze(["sales.task-table"])
});
