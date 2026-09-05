import { createElement, useState } from "react";
import { defineUiContributionBinding } from "@k-nex/ui-runtime";
import { Section, Status } from "@k-nex/ui-components";
import { DataList, DataTable, KeyValueList, Metric, QueryBoundary, createDataTableState } from "@k-nex/ui-data";
import { Form, FormActions, Select, TextInput } from "@k-nex/ui-forms";
import { salesRouteDescriptors, salesPageTemplates, salesUiBlockDescriptors, salesUiComponentDescriptors, salesOpportunityStageUpdateDescriptor, salesOpportunityKanbanBlockDescriptor, salesOpportunitiesDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTaskTableBlockDescriptor, salesTaskTableComponentDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "./contracts.js";
import { salesOpportunitiesTableDefinition, salesTasksTableDefinition } from "./pages.js";
export { salesNavigationDescriptors, salesRouteDescriptors, salesTaskPageTemplate } from "./contracts.js";
function componentElement(component, props) {
    if (typeof component !== "function")
        throw new TypeError("K-Nex component definition is not executable.");
    return createElement(component, props);
}
function SalesTaskActionForm({ label, enabled, onSubmit }) {
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
export function salesTaskTableRenderer(input) {
    const props = input.props;
    const state = input.sourceResult?.state ?? "idle";
    return Object.freeze({
        kind: "data-table",
        component: "DataTable",
        title: props.title,
        accessibility: Object.freeze({ role: "table", label: props.title }),
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
function rendererKind(id) {
    if (id.includes("kanban"))
        return "kanban";
    if (id.includes("revenue"))
        return "metric";
    if (id.includes("quick-create"))
        return "form";
    if (id.includes("opportunity-list") || id === "sales.list.opportunities")
        return "data-list";
    if (id.includes("opportunity-detail") || id === "sales.detail.opportunity")
        return "detail";
    if (id.includes("pipeline"))
        return "status";
    if (id.includes("settings-summary"))
        return "settings-summary";
    return "data-table";
}
function accessibility(kind, label) {
    const role = kind === "data-table" ? "table" : kind === "form" ? "form" : kind === "data-list" ? "region" : kind === "status" || kind === "metric" ? "status" : "region";
    return Object.freeze({ role, label });
}
function dataTableRequestState(sourceResult) {
    if (sourceResult === undefined)
        return { state: "idle" };
    if (sourceResult.state === "insufficient-permission" || sourceResult.state === "invalid-contract")
        return { state: sourceResult.state };
    return sourceResult;
}
function queryRequestState(sourceResult) {
    if (sourceResult === undefined)
        return { state: "idle" };
    if (sourceResult.state === "stale" || sourceResult.state === "refetching")
        return { state: "success", data: sourceResult.data };
    if (sourceResult.state === "insufficient-permission")
        return { state: "forbidden", problem: { code: "SOURCE_FIELD_PERMISSION_DENIED", status: 403 } };
    if (sourceResult.state === "invalid-contract")
        return { state: "invalid-contract" };
    return sourceResult;
}
function cellText(value) {
    if (value === null || typeof value !== "object")
        return value === undefined ? "—" : String(value);
    if ("value" in value)
        return String(value.value);
    if ("label" in value)
        return String(value.label);
    return "—";
}
function tableItems(value, fields) {
    if (value === null || typeof value !== "object" || !Array.isArray(value.rows))
        return [];
    return value.rows.map((row) => ({
        id: row.key,
        label: row.values[fields[0] ?? "name"] === undefined ? row.key : cellText(row.values[fields[0] ?? "name"]),
        value: fields.slice(1).map((field) => `${field}: ${cellText(row.values[field])}`).join(" · ") || row.key
    }));
}
function queryElement(kind, input, title) {
    const children = (value) => {
        if (kind === "metric")
            return componentElement(Metric, { label: title, metric: value });
        if (kind === "data-list")
            return componentElement(DataList, { label: title, items: tableItems(value, ["name", "stage", "value"]) });
        return componentElement(Section, { label: title, children: componentElement(KeyValueList, { label: title, items: tableItems(value, ["name", "stage", "value"]).map(({ id, label, value: itemValue }) => ({ id, key: label, value: itemValue })) }) });
    };
    return componentElement(QueryBoundary, { state: queryRequestState(input.sourceResult), children });
}
const opportunityStages = ["lead", "qualified", "won", "lost"];
function SalesOpportunityKanban({ table, title, input }) {
    const [announcement, setAnnouncement] = useState("");
    const move = async (id, name, expectedStage, expectedRevision, stage) => {
        if (input.action === undefined || input.dispatchAction === undefined || !opportunityStages.includes(expectedStage))
            return;
        try {
            await input.dispatchAction({ action: input.action, input: { id, expectedStage, expectedRevision, stage }, nodeId: input.node.id });
            setAnnouncement(`${name} moved to ${stage}.`);
        }
        catch {
            setAnnouncement(`${name} was not moved. Refresh and try again.`);
        }
    };
    return createElement("section", { "aria-label": title, "data-k-nex-component": "sales-opportunity-kanban" }, [
        createElement("h2", { key: "title" }, title),
        createElement("div", { key: "columns", "data-slot": "kanban-columns" }, opportunityStages.map((stage) => createElement("section", { key: stage, "aria-label": `${stage} opportunities` }, [
            createElement("h3", { key: "heading" }, stage[0].toUpperCase() + stage.slice(1)),
            createElement("ul", { key: "cards" }, table.rows.filter((row) => cellText(row.values.stage) === stage).map((row) => {
                const name = cellText(row.values.name);
                const revision = cellText(row.values.revision);
                return createElement("li", { key: row.key, "data-opportunity-id": row.key }, [
                    createElement("strong", { key: "name" }, name),
                    input.action === undefined || input.dispatchAction === undefined ? null : createElement("div", { key: "moves", "aria-label": `Move ${name}` }, opportunityStages.filter((target) => target !== stage).map((target) => createElement("button", { key: target, type: "button", onClick: () => move(row.key, name, stage, revision, target) }, `Move to ${target}`)))
                ]);
            }))
        ]))),
        createElement("p", { key: "announcement", role: "status", "aria-live": "polite" }, announcement)
    ]);
}
function kanbanElement(input, title) {
    return componentElement(QueryBoundary, {
        state: queryRequestState(input.sourceResult),
        children: (value) => componentElement(SalesOpportunityKanban, { table: value, title, input })
    });
}
function contributionElement(kind, input, title) {
    if (kind === "data-table")
        return componentElement(DataTable, {
            definition: salesOpportunitiesTableDefinition,
            viewState: createDataTableState(salesOpportunitiesTableDefinition),
            requestState: dataTableRequestState(input.sourceResult),
            label: title
        });
    if (kind === "metric" || kind === "data-list" || kind === "detail")
        return queryElement(kind, input, title);
    if (kind === "form")
        return componentElement(SalesTaskActionForm, {
            label: title, enabled: input.action !== undefined && input.dispatchAction !== undefined,
            onSubmit: async (values) => {
                if (input.action === undefined || input.dispatchAction === undefined)
                    return;
                await input.dispatchAction({ action: input.action, input: values, nodeId: input.node.id });
            }
        });
    if (kind === "status")
        return componentElement(Status, { children: title });
    if (kind === "kanban")
        return kanbanElement(input, title);
    return componentElement(Section, { label: title, children: componentElement(KeyValueList, { label: title, items: [{ id: "summary", key: title, value: "Available" }] }) });
}
function componentName(kind) {
    if (kind === "data-table")
        return "DataTable";
    if (kind === "data-list")
        return "DataList";
    if (kind === "detail" || kind === "settings-summary")
        return "KeyValueList";
    if (kind === "metric")
        return "Metric";
    if (kind === "form")
        return "Form";
    if (kind === "kanban")
        return "Kanban";
    return "Status";
}
function contributionRenderer(id) {
    return (input) => {
        const props = input.props;
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
function definition(descriptor) {
    return defineUiContributionBinding({
        descriptor,
        render: contributionRenderer(descriptor.id)
    });
}
export const salesUiComponentDefinitions = Object.freeze(salesUiComponentDescriptors.map((descriptor) => descriptor.id === salesTaskTableComponent.id ? salesTaskTableComponent : definition(descriptor)));
export const salesUiBlockDefinitions = Object.freeze(salesUiBlockDescriptors.map((descriptor) => descriptor.id === salesTaskTableBlock.id ? salesTaskTableBlock : definition(descriptor)));
export const salesWorkspaceUiContract = Object.freeze({
    pluginId: "module.sales",
    surface: "workspace",
    sourceIds: Object.freeze([salesOpportunitiesDescriptor.id, salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id].sort()),
    actionIds: Object.freeze([salesOpportunityStageUpdateDescriptor.id, salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id].sort()),
    routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id)),
    pageTemplateIds: Object.freeze(salesPageTemplates.map(({ id }) => id).sort()),
    componentIds: Object.freeze(salesUiComponentDescriptors.map(({ id }) => id)),
    blockIds: Object.freeze(salesUiBlockDescriptors.map(({ id }) => id))
});
//# sourceMappingURL=ui.js.map