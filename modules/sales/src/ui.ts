import { createElement, useState, type ReactNode } from "react";
import { defineUiContributionBinding, type UiBlockRenderInput, type UiContributionDefinition } from "@k-nex/ui-runtime";
import { Section, Status } from "@k-nex/ui-components";
import { DataList, DataTable, KeyValueList, Metric, QueryBoundary, createDataTableState } from "@k-nex/ui-data";
import { Form, FormActions, Select, TextInput } from "@k-nex/ui-forms";
import type { MetricScalar, TableRecords } from "@k-nex/contracts";

import {
  salesRouteDescriptors,
  salesPageTemplates,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesOpportunityStageUpdateDescriptor,
  salesOpportunityKanbanBlockDescriptor,
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
  readonly kind: "data-table" | "metric" | "form" | "data-list" | "detail" | "status" | "settings-summary" | "kanban";
  readonly component: string;
  readonly title: string;
  readonly accessibility: Readonly<{ readonly role: "table" | "form" | "list" | "status" | "region"; readonly label: string }>;
  readonly state: SalesUiRenderState;
  readonly element: unknown;
  readonly action?: NonNullable<UiBlockRenderInput["action"]>;
  readonly data?: unknown;
  readonly problemCode?: string;
}

function componentElement(component: unknown, props: Record<string, unknown>): unknown {
  if (typeof component !== "function") throw new TypeError("K-Nex component definition is not executable.");
  return createElement(component as (props: Record<string, unknown>) => ReactNode, props);
}

interface ActionFormProps {
  readonly label: string;
  readonly enabled: boolean;
  readonly onSubmit: (values: Readonly<Record<string, string>>) => void | Promise<void>;
}

function SalesTaskActionForm({ label, enabled, onSubmit }: ActionFormProps) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("open");
  return createElement(Form, {
    label,
    onSubmit: () => enabled && title.trim().length > 0 ? onSubmit({ title, status }) : undefined,
    children: [
      createElement(TextInput, { key: "title", name: "title", label: "Title", value: title, required: true, onChange: setTitle }),
      createElement(Select, { key: "status", name: "status", label: "Status", value: status, options: [{ id: "open", label: "Open" }, { id: "done", label: "Done" }], onChange: setStatus }),
      createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: !enabled || title.trim().length === 0 }, "Create task") })
    ]
  });
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
    element: componentElement(DataTable, {
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

function rendererKind(id: string): "data-table" | "metric" | "form" | "data-list" | "detail" | "status" | "settings-summary" | "kanban" {
  if (id.includes("kanban")) return "kanban";
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
    if (kind === "metric") return componentElement(Metric, { label: title, metric: value as MetricScalar });
    if (kind === "data-list") return componentElement(DataList, { label: title, items: tableItems(value, ["name", "stage", "value"]) });
    return componentElement(Section, { label: title, children: componentElement(KeyValueList, { label: title, items: tableItems(value, ["name", "stage", "value"]).map(({ id, label, value: itemValue }) => ({ id, key: label, value: itemValue })) }) });
  };
  return componentElement(QueryBoundary, { state: queryRequestState(input.sourceResult), children });
}

const opportunityStages = ["lead", "qualified", "won", "lost"] as const;

function SalesOpportunityKanban({ table, title, input }: { readonly table: TableRecords; readonly title: string; readonly input: UiBlockRenderInput }) {
  const [announcement, setAnnouncement] = useState("");
  const move = async (id: string, name: string, expectedStage: string, expectedRevision: string, stage: typeof opportunityStages[number]) => {
    if (input.action === undefined || input.dispatchAction === undefined || !opportunityStages.includes(expectedStage as typeof opportunityStages[number])) return;
    try {
      await input.dispatchAction({ action: input.action, input: { id, expectedStage, expectedRevision, stage }, nodeId: input.node.id });
      setAnnouncement(`${name} moved to ${stage}.`);
    } catch {
      setAnnouncement(`${name} was not moved. Refresh and try again.`);
    }
  };
  return createElement("section", { "aria-label": title, "data-k-nex-component": "sales-opportunity-kanban" }, [
    createElement("h2", { key: "title" }, title),
    createElement("div", { key: "columns", "data-slot": "kanban-columns" }, opportunityStages.map((stage) => createElement("section", { key: stage, "aria-label": `${stage} opportunities` }, [
      createElement("h3", { key: "heading" }, stage[0]!.toUpperCase() + stage.slice(1)),
      createElement("ul", { key: "cards" }, table.rows.filter((row) => cellText(row.values.stage) === stage).map((row) => {
        const name = cellText(row.values.name);
        const revision = cellText(row.values.revision);
        return createElement("li", { key: row.key, "data-opportunity-id": row.key }, [
          createElement("strong", { key: "name" }, name),
          input.action === undefined || input.dispatchAction === undefined ? null : createElement("div", { key: "moves", "aria-label": `Move ${name}` }, opportunityStages.filter((target) => target !== stage).map((target) =>
            createElement("button", { key: target, type: "button", onClick: () => move(row.key, name, stage, revision, target) }, `Move to ${target}`)))
        ]);
      }))
    ]))),
    createElement("p", { key: "announcement", role: "status", "aria-live": "polite" }, announcement)
  ]);
}

function kanbanElement(input: UiBlockRenderInput, title: string): unknown {
  return componentElement(QueryBoundary, {
    state: queryRequestState(input.sourceResult),
    children: (value: unknown) => componentElement(SalesOpportunityKanban, { table: value as TableRecords, title, input })
  });
}

function contributionElement(kind: ReturnType<typeof rendererKind>, input: UiBlockRenderInput, title: string): unknown {
  if (kind === "data-table") return componentElement(DataTable, {
    definition: salesOpportunitiesTableDefinition,
    viewState: createDataTableState(salesOpportunitiesTableDefinition),
    requestState: dataTableRequestState(input.sourceResult),
    label: title
  });
  if (kind === "metric" || kind === "data-list" || kind === "detail") return queryElement(kind, input, title);
  if (kind === "form") return componentElement(SalesTaskActionForm, {
    label: title, enabled: input.action !== undefined && input.dispatchAction !== undefined,
    onSubmit: async (values: Readonly<Record<string, string>>) => {
      if (input.action === undefined || input.dispatchAction === undefined) return;
      await input.dispatchAction({ action: input.action, input: values, nodeId: input.node.id });
    }
  });
  if (kind === "status") return componentElement(Status, { children: title });
  if (kind === "kanban") return kanbanElement(input, title);
  return componentElement(Section, { label: title, children: componentElement(KeyValueList, { label: title, items: [{ id: "summary", key: title, value: "Available" }] }) });
}

function componentName(kind: ReturnType<typeof rendererKind>): string {
  if (kind === "data-table") return "DataTable";
  if (kind === "data-list") return "DataList";
  if (kind === "detail" || kind === "settings-summary") return "KeyValueList";
  if (kind === "metric") return "Metric";
  if (kind === "form") return "Form";
  if (kind === "kanban") return "Kanban";
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
