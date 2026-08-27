import { defineUiContributionBinding, type UiBlockRenderInput } from "@k-nex/ui-runtime";

import {
  salesRouteDescriptors,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
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

function rendererKind(id: string): "data-table" | "metric" | "form" | "data-list" | "detail" | "status" | "settings-summary" {
  if (id.includes("revenue")) return "metric";
  if (id.includes("quick-create")) return "form";
  if (id.includes("opportunity-list") || id === "sales.list.opportunities") return "data-list";
  if (id.includes("opportunity-detail") || id === "sales.detail.opportunity") return "detail";
  if (id.includes("pipeline")) return "status";
  if (id.includes("settings-summary")) return "settings-summary";
  return "data-table";
}

function contributionRenderer(id: string) {
  return (input: UiBlockRenderInput) => {
    const props = input.props as { readonly title: string };
    const state = input.sourceResult?.state ?? "idle";
    return Object.freeze({
      kind: rendererKind(id), title: props.title, state,
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.sourceResult !== undefined && "data" in input.sourceResult ? { data: input.sourceResult.data } : {}),
      ...(input.sourceResult !== undefined && "problem" in input.sourceResult ? { problemCode: input.sourceResult.problem.code } : {})
    });
  };
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

function definition(descriptor: (typeof salesUiComponentDescriptors)[number] | (typeof salesUiBlockDescriptors)[number]) {
  return defineUiContributionBinding({
    descriptor,
    propsSchema: taskTablePropsRuntimeSchema,
    render: contributionRenderer(descriptor.id)
  });
}

export const salesUiComponentDefinitions = Object.freeze(salesUiComponentDescriptors.map((descriptor) =>
  descriptor.id === salesTaskTableComponent.id ? salesTaskTableComponent : definition(descriptor)));
export const salesUiBlockDefinitions = Object.freeze(salesUiBlockDescriptors.map((descriptor) =>
  descriptor.id === salesTaskTableBlock.id ? salesTaskTableBlock : definition(descriptor)));

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
  componentIds: Object.freeze(salesUiComponentDescriptors.map(({ id }) => id)),
  blockIds: Object.freeze(salesUiBlockDescriptors.map(({ id }) => id))
});
