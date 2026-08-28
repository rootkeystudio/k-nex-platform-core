import { defineUiContributionBinding, type UiBlockRenderInput, type UiContributionDefinition } from "@k-nex/ui-runtime";
import { createKNextActionFormElement, createKNextComponentElement, createPuckBlockLibrary } from "@k-nex/ui-builder-blocks";
import { Section, Status } from "@k-nex/ui-components";
import { DataList, DataTable, KeyValueList, Metric, QueryBoundary, createDataTableState } from "@k-nex/ui-data";
import type { MetricScalar, TableRecords } from "@k-nex/contracts";

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
import { salesOpportunitiesTableDefinition, salesTasksTableDefinition } from "./pages.js";

export { salesNavigationDescriptors, salesRouteDescriptors, salesTaskPageTemplate } from "./contracts.js";

export type SalesUiRenderState = NonNullable<UiBlockRenderInput["sourceResult"]>["state"] | "idle";

export interface SalesTaskTablePresentation {
  readonly kind: "data-table";
  readonly component: "DataTable";
  readonly title: string;
  readonly accessibility: Readonly<{ readonly role: "table"; readonly label: string }>;
  readonly state: SalesUiRenderState;
  readonly element: unknown;
  readonly action?: NonNullable<UiBlockRenderInput["action"]>;
  readonly table?: unknown;
  readonly problemCode?: string;
}

export interface SalesContributionPresentation {
  readonly kind: "data-table" | "metric" | "form" | "data-list" | "detail" | "status" | "settings-summary";
  readonly component: string;
  readonly title: string;
  readonly accessibility: Readonly<{ readonly role: "table" | "form" | "list" | "status" | "region"; readonly label: string }>;
  readonly state: SalesUiRenderState;
  readonly element: unknown;
  readonly action?: NonNullable<UiBlockRenderInput["action"]>;
  readonly data?: unknown;
  readonly problemCode?: string;
}

export function salesTaskTableRenderer(input: UiBlockRenderInput): Readonly<SalesTaskTablePresentation> {
  const props = input.props as { readonly title: string };
  const state = input.sourceResult?.state ?? "idle";
  return Object.freeze({
    kind: "data-table" as const,
    component: "DataTable" as const,
    title: props.title,
    accessibility: Object.freeze({ role: "table" as const, label: props.title }),
    state,
    element: createKNextComponentElement(DataTable, {
      definition: salesTasksTableDefinition,
      viewState: createDataTableState(salesTasksTableDefinition),
      requestState: dataTableRequestState(input.sourceResult),
      label: props.title
    }),
    ...(input.action === undefined ? {} : { action: input.action }),
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
  const role = kind === "data-table" ? "table" : kind === "form" ? "form" : kind === "data-list" ? "region" : kind === "status" || kind === "metric" ? "status" : "region";
  return Object.freeze({ role, label });
}

function dataTableRequestState(sourceResult: UiBlockRenderInput["sourceResult"]): unknown {
  if (sourceResult === undefined) return { state: "idle" };
  if (sourceResult.state === "insufficient-permission" || sourceResult.state === "invalid-contract") return { state: sourceResult.state };
  return sourceResult;
}

function queryRequestState(sourceResult: UiBlockRenderInput["sourceResult"]): unknown {
  if (sourceResult === undefined) return { state: "idle" };
  if (sourceResult.state === "stale" || sourceResult.state === "refetching") return { state: "success", data: sourceResult.data };
  if (sourceResult.state === "insufficient-permission") return { state: "forbidden", problem: { code: "SOURCE_FIELD_PERMISSION_DENIED", status: 403 } };
  if (sourceResult.state === "invalid-contract") return { state: "invalid-contract" };
  return sourceResult;
}

function cellText(value: unknown): string {
  if (value === null || typeof value !== "object") return value === undefined ? "—" : String(value);
  if ("value" in value) return String(value.value);
  if ("label" in value) return String(value.label);
  return "—";
}

function tableItems(value: unknown, fields: readonly string[]) {
  if (value === null || typeof value !== "object" || !Array.isArray((value as TableRecords).rows)) return [];
  return (value as TableRecords).rows.map((row) => ({
    id: row.key,
    label: row.values[fields[0] ?? "name"] === undefined ? row.key : cellText(row.values[fields[0] ?? "name"]),
    value: fields.slice(1).map((field) => `${field}: ${cellText(row.values[field])}`).join(" · ") || row.key
  }));
}

function queryElement(kind: ReturnType<typeof rendererKind>, input: UiBlockRenderInput, title: string): unknown {
  const children = (value: unknown) => {
    if (kind === "metric") return createKNextComponentElement(Metric, { label: title, metric: value as MetricScalar });
    if (kind === "data-list") return createKNextComponentElement(DataList, { label: title, items: tableItems(value, ["name", "stage", "value"]) });
    return createKNextComponentElement(Section, { label: title, children: createKNextComponentElement(KeyValueList, { label: title, items: tableItems(value, ["name", "stage", "value"]).map(({ id, label, value: itemValue }) => ({ id, key: label, value: itemValue })) }) });
  };
  return createKNextComponentElement(QueryBoundary, { state: queryRequestState(input.sourceResult), children });
}

function contributionElement(kind: ReturnType<typeof rendererKind>, input: UiBlockRenderInput, title: string): unknown {
  if (kind === "data-table") return createKNextComponentElement(DataTable, {
    definition: salesOpportunitiesTableDefinition,
    viewState: createDataTableState(salesOpportunitiesTableDefinition),
    requestState: dataTableRequestState(input.sourceResult),
    label: title
  });
  if (kind === "metric" || kind === "data-list" || kind === "detail") return queryElement(kind, input, title);
  if (kind === "form") return createKNextActionFormElement({
    label: title,
    fields: [{ name: "title", label: "Title", kind: "text", required: true }, { name: "status", label: "Status", kind: "select", options: [{ id: "open", label: "Open" }, { id: "done", label: "Done" }] }],
    initialValues: { title: "", status: "open" },
    submitLabel: "Create task",
    enabled: input.action !== undefined && input.dispatchAction !== undefined,
    onSubmit: async (values: Readonly<Record<string, string>>) => {
      if (input.action === undefined || input.dispatchAction === undefined) return;
      await input.dispatchAction({ action: input.action, input: values, nodeId: input.node.id });
    }
  });
  if (kind === "status") return createKNextComponentElement(Status, { children: title });
  return createKNextComponentElement(Section, { label: title, children: createKNextComponentElement(KeyValueList, { label: title, items: [{ id: "summary", key: title, value: "Available" }] }) });
}

function componentName(kind: ReturnType<typeof rendererKind>): string {
  if (kind === "data-table") return "DataTable";
  if (kind === "data-list") return "DataList";
  if (kind === "detail" || kind === "settings-summary") return "KeyValueList";
  if (kind === "metric") return "Metric";
  if (kind === "form") return "Form";
  return "Status";
}

function contributionRenderer(id: string): (input: UiBlockRenderInput) => Readonly<SalesContributionPresentation> {
  return (input: UiBlockRenderInput) => {
    const props = input.props as { readonly title: string };
    const state = input.sourceResult?.state ?? "idle";
    const kind = rendererKind(id);
    return Object.freeze({
      kind, component: componentName(kind), title: props.title, accessibility: accessibility(kind, props.title), state,
      element: contributionElement(kind, input, props.title),
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
