import { defineUiContributionBinding, type UiBlockRenderInput } from "@k-nex/ui-runtime";
import { createPuckBlockLibrary } from "@k-nex/ui-builder-blocks";

import {
  salesRouteDescriptors,
  salesPageTemplates,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesOpportunityStageUpdateDescriptor,
  salesOpportunitiesDescriptor,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesTaskTableBlockDescriptor,
  salesTaskTableComponentDescriptor,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor
} from "./contracts.js";

export { salesNavigationDescriptors, salesRouteDescriptors, salesTaskPageTemplate } from "./contracts.js";

export type SalesUiRenderState = NonNullable<UiBlockRenderInput["sourceResult"]>["state"] | "idle";

export interface SalesTaskTablePresentation {
  readonly kind: "data-table";
  readonly title: string;
  readonly accessibility: Readonly<{ readonly role: "table"; readonly label: string }>;
  readonly state: SalesUiRenderState;
  readonly table?: unknown;
  readonly problemCode?: string;
}

export interface SalesContributionPresentation {
  readonly kind: "data-table" | "metric" | "form" | "data-list" | "detail" | "status" | "settings-summary";
  readonly title: string;
  readonly accessibility: Readonly<{ readonly role: "table" | "form" | "list" | "status" | "region"; readonly label: string }>;
  readonly state: SalesUiRenderState;
  readonly action?: NonNullable<UiBlockRenderInput["action"]>;
  readonly data?: unknown;
  readonly problemCode?: string;
}

export function salesTaskTableRenderer(input: UiBlockRenderInput): Readonly<SalesTaskTablePresentation> {
  const props = input.props as { readonly title: string };
  const state = input.sourceResult?.state ?? "idle";
  return Object.freeze({
    kind: "data-table" as const,
    title: props.title,
    accessibility: Object.freeze({ role: "table" as const, label: props.title }),
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

function accessibility(kind: ReturnType<typeof rendererKind>, label: string) {
  const role = kind === "data-table" ? "table" : kind === "form" ? "form" : kind === "data-list" ? "list" : kind === "status" || kind === "metric" ? "status" : "region";
  return Object.freeze({ role, label });
}

function contributionRenderer(id: string): (input: UiBlockRenderInput) => Readonly<SalesContributionPresentation> {
  return (input: UiBlockRenderInput) => {
    const props = input.props as { readonly title: string };
    const state = input.sourceResult?.state ?? "idle";
    const kind = rendererKind(id);
    return Object.freeze({
      kind, title: props.title, accessibility: accessibility(kind, props.title), state,
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.sourceResult !== undefined && "data" in input.sourceResult ? { data: input.sourceResult.data } : {}),
      ...(input.sourceResult !== undefined && "problem" in input.sourceResult ? { problemCode: input.sourceResult.problem.code } : {})
    });
  };
}

export const salesTaskTableComponent = defineUiContributionBinding({
  descriptor: salesTaskTableComponentDescriptor,
  render: salesTaskTableRenderer
});

export const salesTaskTableBlock = defineUiContributionBinding({
  descriptor: salesTaskTableBlockDescriptor,
  render: salesTaskTableRenderer
});

function definition(descriptor: (typeof salesUiComponentDescriptors)[number] | (typeof salesUiBlockDescriptors)[number]): UiContributionDefinition<Readonly<SalesContributionPresentation>> {
  return defineUiContributionBinding({
    descriptor,
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

const salesBlockLabels: Readonly<Record<string, string>> = Object.freeze({
  "sales.task-table": "Sales task table",
  "sales.revenue-metric": "Sales revenue metric",
  "sales.task-quick-create": "Sales task quick-create",
  "sales.opportunity-list": "Sales opportunity list",
  "sales.opportunity-detail": "Sales opportunity detail",
  "sales.settings-summary": "Sales settings summary"
});
export const salesPuckBlockAuthoring = Object.freeze(Object.fromEntries(salesUiBlockDefinitions.map((definition) => [definition.id, Object.freeze({
  label: salesBlockLabels[definition.id]!,
  fields: Object.freeze([{ prop: "title", label: "Title", kind: "text" as const }]),
  allowChildren: false,
  defaultProps: Object.freeze({ title: salesBlockLabels[definition.id]! })
})])));
export const salesPuckBlockBridges = createPuckBlockLibrary(salesUiBlockDefinitions, salesPuckBlockAuthoring);

export const salesWorkspaceUiContract = Object.freeze({
  pluginId: "module.sales" as const,
  surface: "workspace" as const,
  sourceIds: Object.freeze([salesOpportunitiesDescriptor.id, salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id].sort()),
  actionIds: Object.freeze([salesOpportunityStageUpdateDescriptor.id, salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id].sort()),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id)),
  pageTemplateIds: Object.freeze(salesPageTemplates.map(({ id }) => id).sort()),
  componentIds: Object.freeze(salesUiComponentDescriptors.map(({ id }) => id)),
  blockIds: Object.freeze(salesUiBlockDescriptors.map(({ id }) => id))
});
