import type { ReactElement, ReactNode } from "react";

import { Button } from "@k-nex/ui-design-system-contracts";
import { Card, Status } from "@k-nex/ui-components";
import { DataTable } from "@k-nex/ui-data/data-table";
import {
  createDataTableState,
  defineDataTable,
  type DataTableActionCapability,
  type DataTableActionResult,
  type DataTableBulkActionResult,
  type DataTableMutationExecutor,
  type DataTableRequestState,
  type DataTableViewState
} from "@k-nex/ui-data/data-table-controller";
import { KeyValueList } from "@k-nex/ui-data/presentation";
import { Metric, QueryBoundary } from "@k-nex/ui-data/metric";
import { Form, FormActions, Select, TextInput, createFormController, type FormSnapshot } from "@k-nex/ui-forms";
import { DashboardPage, IndexPage, SettingsPage } from "@k-nex/ui-pages";
import type { BrowserDataTransport, BrowserMutationContext, BrowserRequestState } from "@k-nex/ui-runtime";
import type { MetricScalar, TableRow } from "@k-nex/contracts";

import {
  salesCreateTaskMutation,
  salesOpportunitiesQuery,
  salesOpportunityStageMutation,
  salesUpdateTaskMutation,
  salesTasksQuery
} from "./browser.js";
import {
  salesOpportunitiesDescriptor,
  salesOpportunitiesPageTemplate,
  salesOverviewPageTemplate,
  salesSettingsPageTemplate,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  type CreateTaskInput,
  type SalesWorkspaceSettings,
  type UpdateOpportunityStageInput
} from "./contracts.js";

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
  rowActions: [{ id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, mutation: salesUpdateTaskMutation, input: (rowKey: string) => ({ id: rowKey, status: "done" }), label: "Complete" }],
  bulkActions: [{ id: salesUpdateTaskMutation.action.id, action: salesUpdateTaskMutation.action, mutation: salesUpdateTaskMutation, input: (rowKey: string) => ({ id: rowKey, status: "done" }), label: "Complete" }]
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
  rowActions: [{ id: salesOpportunityStageMutation.action.id, action: salesOpportunityStageMutation.action, mutation: salesOpportunityStageMutation, input: (rowKey: string) => ({ id: rowKey, stage: "won" }), label: "Change stage" }]
});

export function createSalesTaskQuickCreateController(transport: BrowserDataTransport, idempotencyKey: string) {
  return createFormController<CreateTaskInput, unknown>({
    initialValues: { title: "", status: "open" },
    validate: (values) => values.title.trim().length === 0 ? { title: "Title is required." } : {},
    submit: (values, signal) => salesCreateTaskMutation.execute(transport, values, { signal, idempotencyKey })
  });
}

export function createSalesOpportunityStageController(transport: BrowserDataTransport, initialValues: UpdateOpportunityStageInput, idempotencyKey: string) {
  return createFormController<UpdateOpportunityStageInput, unknown>({
    initialValues,
    validate: () => ({}),
    submit: (values, signal) => salesOpportunityStageMutation.execute(transport, values, { signal, idempotencyKey })
  });
}

const crumbs = (current: string, href: string) => [{ id: "sales", label: "Sales", href: "/sales" }, { id: "current", label: current, href, current: true }];

export interface SalesOverviewPageProps { readonly revenueState: BrowserRequestState<MetricScalar>; readonly onRetry?: () => void; }
export function SalesOverviewPage({ revenueState, onRetry }: SalesOverviewPageProps): ReactElement {
  return <DashboardPage templateId={salesOverviewPageTemplate.id} title="Sales overview" description="Current pipeline summary." breadcrumbs={crumbs("Overview", "/sales")}>
    <QueryBoundary state={revenueState} {...(onRetry === undefined ? {} : { onRetry })}>{(metric) => <Metric label="Total potential revenue" metric={metric} />}</QueryBoundary>
  </DashboardPage>;
}

export interface SalesTasksPageProps {
  readonly requestState: DataTableRequestState;
  readonly viewState?: DataTableViewState;
  readonly createTask: FormSnapshot<CreateTaskInput>;
  readonly onViewStateChange?: (state: DataTableViewState) => void;
  readonly onCreateTaskChange: <K extends keyof CreateTaskInput>(field: K, value: CreateTaskInput[K]) => void;
  readonly onCreateTask: () => void | Promise<void>;
  readonly mutationExecutor?: DataTableMutationExecutor;
  readonly actionCapabilities?: readonly DataTableActionCapability[];
  readonly actionContext?: BrowserMutationContext;
  readonly onActionResult?: (result: DataTableActionResult | DataTableBulkActionResult) => void | Promise<void>;
  readonly onSourceInvalidated?: (sourceId: string) => void;
  readonly onRefetch?: () => void;
  readonly renderDetail?: (row: TableRow) => ReactNode;
  readonly onLoadMore?: () => void;
  readonly loadMoreLoading?: boolean;
}
export function SalesTasksPage({ requestState, viewState = createDataTableState(salesTasksTableDefinition), createTask, onViewStateChange, onCreateTaskChange, onCreateTask, mutationExecutor, actionCapabilities, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }: SalesTasksPageProps): ReactElement {
  return <IndexPage templateId={salesTaskPageTemplate.id} title="Sales tasks" description="Authorized tasks and follow-up work." breadcrumbs={crumbs("Tasks", "/sales/tasks")} aside={<Card><Form label="Create task" pending={createTask.submitting} onSubmit={onCreateTask}><TextInput name="title" label="Title" value={createTask.values.title} {...(createTask.fieldErrors.title === undefined ? {} : { error: createTask.fieldErrors.title })} required onChange={(value) => onCreateTaskChange("title", value)} /><Select name="status" label="Status" value={createTask.values.status ?? "open"} options={[{ id: "open", label: "Open" }, { id: "done", label: "Done" }]} onChange={(value) => onCreateTaskChange("status", value as "open" | "done")} /><FormActions><Button type="submit" isDisabled={createTask.submitting}>Create task</Button></FormActions></Form></Card>}>
    <DataTable definition={salesTasksTableDefinition} viewState={viewState} requestState={requestState} {...(onViewStateChange === undefined ? {} : { onViewStateChange })} {...(mutationExecutor === undefined ? {} : { mutationExecutor })} {...(actionCapabilities === undefined ? {} : { actionCapabilities })} {...(actionContext === undefined ? {} : { actionContext })} {...(onActionResult === undefined ? {} : { onActionResult })} {...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated })} {...(onRefetch === undefined ? {} : { onRefetch })} {...(renderDetail === undefined ? {} : { renderDetail })} {...(onLoadMore === undefined ? {} : { onLoadMore })} {...(loadMoreLoading === undefined ? {} : { loadMoreLoading })} />
  </IndexPage>;
}

export interface SalesOpportunitiesPageProps {
  readonly requestState: DataTableRequestState;
  readonly viewState?: DataTableViewState;
  readonly onViewStateChange?: (state: DataTableViewState) => void;
  readonly mutationExecutor?: DataTableMutationExecutor;
  readonly actionCapabilities?: readonly DataTableActionCapability[];
  readonly actionContext?: BrowserMutationContext;
  readonly onActionResult?: (result: DataTableActionResult | DataTableBulkActionResult) => void | Promise<void>;
  readonly onSourceInvalidated?: (sourceId: string) => void;
  readonly onRefetch?: () => void;
  readonly renderDetail?: (row: TableRow) => ReactNode;
  readonly onLoadMore?: () => void;
  readonly loadMoreLoading?: boolean;
}
export function SalesOpportunitiesPage({ requestState, viewState = createDataTableState(salesOpportunitiesTableDefinition), onViewStateChange, mutationExecutor, actionCapabilities, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }: SalesOpportunitiesPageProps): ReactElement {
  return <IndexPage templateId={salesOpportunitiesPageTemplate.id} title="Opportunities" description="Authorized pipeline opportunities." breadcrumbs={crumbs("Opportunities", "/sales/opportunities")}>
    <DataTable definition={salesOpportunitiesTableDefinition} viewState={viewState} requestState={requestState} {...(onViewStateChange === undefined ? {} : { onViewStateChange })} {...(mutationExecutor === undefined ? {} : { mutationExecutor })} {...(actionCapabilities === undefined ? {} : { actionCapabilities })} {...(actionContext === undefined ? {} : { actionContext })} {...(onActionResult === undefined ? {} : { onActionResult })} {...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated })} {...(onRefetch === undefined ? {} : { onRefetch })} {...(renderDetail === undefined ? {} : { renderDetail })} {...(onLoadMore === undefined ? {} : { onLoadMore })} {...(loadMoreLoading === undefined ? {} : { loadMoreLoading })} />
  </IndexPage>;
}

export interface SalesSettingsPageProps { readonly settings: SalesWorkspaceSettings; }
export function SalesSettingsPage({ settings }: SalesSettingsPageProps): ReactElement {
  return <SettingsPage templateId={salesSettingsPageTemplate.id} title="Sales settings" description="Workspace presentation settings." breadcrumbs={crumbs("Settings", "/sales/settings")}>
    <Status tone="positive">Active</Status>
    <KeyValueList label="Sales settings" items={[
      { id: "default-page", key: "Default page", value: settings.defaultPage },
      { id: "page-size", key: "Task page size", value: String(settings.defaultTaskPageSize) },
      { id: "revenue", key: "Potential revenue", value: settings.showPotentialRevenue ? "Visible" : "Hidden" },
      { id: "stages", key: "Pipeline stages", value: settings.pipelineStages.join(", ") }
    ]} />
  </SettingsPage>;
}

export const salesDefaultPageContract = Object.freeze({
  templates: Object.freeze([salesOverviewPageTemplate.id, salesTaskPageTemplate.id, salesOpportunitiesPageTemplate.id, salesSettingsPageTemplate.id]),
  sourceQueries: Object.freeze([salesTasksQuery.source.id, salesOpportunitiesQuery.source.id]),
  actions: Object.freeze([salesCreateTaskMutation.action.id, salesUpdateTaskMutation.action.id, salesOpportunityStageMutation.action.id])
});
