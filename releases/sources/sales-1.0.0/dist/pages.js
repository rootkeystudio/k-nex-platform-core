import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@k-nex/ui-design-system-contracts";
import { Card, Status } from "@k-nex/ui-components";
import { DataTable } from "@k-nex/ui-data/data-table";
import { createDataTableState, defineDataTable } from "@k-nex/ui-data/data-table-controller";
import { KeyValueList } from "@k-nex/ui-data/presentation";
import { Metric, QueryBoundary } from "@k-nex/ui-data/metric";
import { Form, FormActions, Select, TextInput, createFormController } from "@k-nex/ui-forms";
import { DashboardPage, IndexPage, SettingsPage } from "@k-nex/ui-pages";
import { salesCreateTaskMutation, salesOpportunitiesQuery, salesOpportunityStageMutation, salesUpdateTaskMutation, salesTasksQuery } from "./browser.js";
import { salesOpportunitiesDescriptor, salesOpportunitiesPageTemplate, salesOverviewPageTemplate, salesSettingsPageTemplate, salesTaskPageTemplate, salesTasksDescriptor } from "./contracts.js";
export const salesTasksTableDefinition = defineDataTable({
    id: "sales.tasks-index",
    descriptor: salesTasksDescriptor,
    query: salesTasksQuery,
    columns: [
        { id: "title", label: "Title", size: 280 },
        { id: "status", label: "Status" },
        { id: "potential-revenue", label: "Potential revenue" }
    ],
    paginationModes: ["offset"],
    defaultPageSize: 25,
    searchField: "title",
    facets: { status: ["open", "done"] },
    rowActions: [{ id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, mutation: salesUpdateTaskMutation, input: (rowKey) => ({ id: rowKey, status: "done" }), label: "Complete" }],
    bulkActions: [{ id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, mutation: salesUpdateTaskMutation, input: (rowKey) => ({ id: rowKey, status: "done" }), label: "Complete" }]
});
export const salesOpportunitiesTableDefinition = defineDataTable({
    id: "sales.opportunities-index",
    descriptor: salesOpportunitiesDescriptor,
    query: salesOpportunitiesQuery,
    columns: [{ id: "name", label: "Name", size: 280 }, { id: "stage", label: "Stage" }, { id: "value", label: "Value" }],
    paginationModes: ["offset"],
    defaultPageSize: 25,
    searchField: "name",
    facets: { stage: ["lead", "qualified", "won", "lost"] },
    rowActions: [{ id: salesOpportunityStageMutation.action.id, action: salesOpportunityStageMutation.action, mutation: salesOpportunityStageMutation, input: (rowKey) => ({ id: rowKey, stage: "won" }), label: "Change stage" }]
});
export function createSalesTaskQuickCreateController(transport, idempotencyKey) {
    return createFormController({
        initialValues: { title: "", status: "open" },
        validate: (values) => values.title.trim().length === 0 ? { title: "Title is required." } : {},
        submit: (values, signal) => salesCreateTaskMutation.execute(transport, values, { signal, idempotencyKey })
    });
}
export function createSalesOpportunityStageController(transport, initialValues, idempotencyKey) {
    return createFormController({
        initialValues,
        validate: () => ({}),
        submit: (values, signal) => salesOpportunityStageMutation.execute(transport, values, { signal, idempotencyKey })
    });
}
const opportunityStages = [
    { id: "lead", label: "Lead" },
    { id: "qualified", label: "Qualified" },
    { id: "won", label: "Won" },
    { id: "lost", label: "Lost" }
];
export function SalesOpportunityEditForm({ opportunity, opportunityOptions, onOpportunityChange, onOpportunitySubmit }) {
    return _jsxs(Form, { label: "Edit opportunity", pending: opportunity.submitting, onSubmit: onOpportunitySubmit, children: [_jsx(Select, { name: "id", label: "Opportunity", value: opportunity.values.id, options: opportunityOptions, disabled: opportunity.submitting, ...(opportunity.fieldErrors.id === undefined ? {} : { error: opportunity.fieldErrors.id }), onChange: (value) => onOpportunityChange("id", value) }), _jsx(Select, { name: "stage", label: "Stage", value: opportunity.values.stage, options: opportunityStages, disabled: opportunity.submitting, ...(opportunity.fieldErrors.stage === undefined ? {} : { error: opportunity.fieldErrors.stage }), onChange: (value) => onOpportunityChange("stage", value) }), _jsx(FormActions, { children: _jsx(Button, { type: "submit", isDisabled: opportunity.submitting, children: "Save opportunity" }) })] });
}
const crumbs = (current, href) => [{ id: "sales", label: "Sales", href: "/sales" }, { id: "current", label: current, href, current: true }];
export function SalesOverviewPage({ revenueState, onRetry }) {
    return _jsx(DashboardPage, { templateId: salesOverviewPageTemplate.id, title: "Sales overview", description: "Current pipeline summary.", breadcrumbs: crumbs("Overview", "/sales"), children: _jsx(QueryBoundary, { state: revenueState, ...(onRetry === undefined ? {} : { onRetry }), children: (metric) => _jsx(Metric, { label: "Total potential revenue", metric: metric }) }) });
}
export function SalesTasksPage({ requestState, viewState = createDataTableState(salesTasksTableDefinition), createTask, onViewStateChange, onCreateTaskChange, onCreateTask, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }) {
    return _jsx(IndexPage, { templateId: salesTaskPageTemplate.id, title: "Sales tasks", description: "Authorized tasks and follow-up work.", breadcrumbs: crumbs("Tasks", "/sales/tasks"), aside: _jsx(Card, { children: _jsxs(Form, { label: "Create task", pending: createTask.submitting, onSubmit: onCreateTask, children: [_jsx(TextInput, { name: "title", label: "Title", value: createTask.values.title, ...(createTask.fieldErrors.title === undefined ? {} : { error: createTask.fieldErrors.title }), required: true, onChange: (value) => onCreateTaskChange("title", value) }), _jsx(Select, { name: "status", label: "Status", value: createTask.values.status ?? "open", options: [{ id: "open", label: "Open" }, { id: "done", label: "Done" }], onChange: (value) => onCreateTaskChange("status", value) }), _jsx(FormActions, { children: _jsx(Button, { type: "submit", isDisabled: createTask.submitting, children: "Create task" }) })] }) }), children: _jsx(DataTable, { definition: salesTasksTableDefinition, viewState: viewState, requestState: requestState, ...(onViewStateChange === undefined ? {} : { onViewStateChange }), ...(mutationExecutor === undefined ? {} : { mutationExecutor }), ...(actionAuthorization === undefined ? {} : { actionAuthorization }), ...(actionActorFingerprint === undefined ? {} : { actionActorFingerprint }), ...(actionContext === undefined ? {} : { actionContext }), ...(onActionResult === undefined ? {} : { onActionResult }), ...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated }), ...(onRefetch === undefined ? {} : { onRefetch }), ...(renderDetail === undefined ? {} : { renderDetail }), ...(onLoadMore === undefined ? {} : { onLoadMore }), ...(loadMoreLoading === undefined ? {} : { loadMoreLoading }) }) });
}
export function SalesOpportunitiesPage({ requestState, viewState = createDataTableState(salesOpportunitiesTableDefinition), onViewStateChange, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }) {
    return _jsx(IndexPage, { templateId: salesOpportunitiesPageTemplate.id, title: "Opportunities", description: "Authorized pipeline opportunities.", breadcrumbs: crumbs("Opportunities", "/sales/opportunities"), children: _jsx(DataTable, { definition: salesOpportunitiesTableDefinition, viewState: viewState, requestState: requestState, ...(onViewStateChange === undefined ? {} : { onViewStateChange }), ...(mutationExecutor === undefined ? {} : { mutationExecutor }), ...(actionAuthorization === undefined ? {} : { actionAuthorization }), ...(actionActorFingerprint === undefined ? {} : { actionActorFingerprint }), ...(actionContext === undefined ? {} : { actionContext }), ...(onActionResult === undefined ? {} : { onActionResult }), ...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated }), ...(onRefetch === undefined ? {} : { onRefetch }), ...(renderDetail === undefined ? {} : { renderDetail }), ...(onLoadMore === undefined ? {} : { onLoadMore }), ...(loadMoreLoading === undefined ? {} : { loadMoreLoading }) }) });
}
export function SalesSettingsPage({ settings }) {
    return _jsxs(SettingsPage, { templateId: salesSettingsPageTemplate.id, title: "Sales settings", description: "Workspace presentation settings.", breadcrumbs: crumbs("Settings", "/sales/settings"), children: [_jsx(Status, { tone: "positive", children: "Active" }), _jsx(KeyValueList, { label: "Sales settings", items: [
                    { id: "default-page", key: "Default page", value: settings.defaultPage },
                    { id: "page-size", key: "Task page size", value: String(settings.defaultTaskPageSize) },
                    { id: "revenue", key: "Potential revenue", value: settings.showPotentialRevenue ? "Visible" : "Hidden" },
                    { id: "stages", key: "Pipeline stages", value: settings.pipelineStages.join(", ") }
                ] })] });
}
export const salesDefaultPageContract = Object.freeze({
    templates: Object.freeze([salesOverviewPageTemplate.id, salesTaskPageTemplate.id, salesOpportunitiesPageTemplate.id, salesSettingsPageTemplate.id]),
    sourceQueries: Object.freeze([salesTasksQuery.source.id, salesOpportunitiesQuery.source.id]),
    actions: Object.freeze([salesCreateTaskMutation.action.id, salesUpdateTaskMutation.action.id, salesOpportunityStageMutation.action.id])
});
//# sourceMappingURL=pages.js.map