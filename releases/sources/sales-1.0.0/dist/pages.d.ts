import type { ReactElement, ReactNode } from "react";
import { type DataTableActionAuthorization, type DataTableActionResult, type DataTableBulkActionResult, type DataTableMutationExecutor, type DataTableRequestState, type DataTableViewState } from "@k-nex/ui-data/data-table-controller";
import { type ChoiceOption, type FormSnapshot } from "@k-nex/ui-forms";
import type { BrowserDataTransport, BrowserMutationContext, BrowserRequestState } from "@k-nex/ui-runtime";
import type { MetricScalar, TableRow } from "@k-nex/contracts";
import { type CreateTaskInput, type SalesWorkspaceSettings, type UpdateOpportunityStageInput } from "./contracts.js";
export declare const salesTasksTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export declare const salesOpportunitiesTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export declare function createSalesTaskQuickCreateController(transport: BrowserDataTransport, idempotencyKey: string): import("@k-nex/ui-forms").FormController<CreateTaskInput, unknown>;
export declare function createSalesOpportunityStageController(transport: BrowserDataTransport, initialValues: UpdateOpportunityStageInput, idempotencyKey: string): import("@k-nex/ui-forms").FormController<UpdateOpportunityStageInput, unknown>;
export interface SalesOpportunityEditFormProps {
    readonly opportunity: FormSnapshot<UpdateOpportunityStageInput>;
    readonly opportunityOptions: readonly ChoiceOption[];
    readonly onOpportunityChange: <K extends keyof UpdateOpportunityStageInput>(field: K, value: UpdateOpportunityStageInput[K]) => void;
    readonly onOpportunitySubmit: () => void | Promise<void>;
}
export declare function SalesOpportunityEditForm({ opportunity, opportunityOptions, onOpportunityChange, onOpportunitySubmit }: SalesOpportunityEditFormProps): ReactElement;
export interface SalesOverviewPageProps {
    readonly revenueState: BrowserRequestState<MetricScalar>;
    readonly onRetry?: () => void;
}
export declare function SalesOverviewPage({ revenueState, onRetry }: SalesOverviewPageProps): ReactElement;
export interface SalesTasksPageProps {
    readonly requestState: DataTableRequestState;
    readonly viewState?: DataTableViewState;
    readonly createTask: FormSnapshot<CreateTaskInput>;
    readonly onViewStateChange?: (state: DataTableViewState) => void;
    readonly onCreateTaskChange: <K extends keyof CreateTaskInput>(field: K, value: CreateTaskInput[K]) => void;
    readonly onCreateTask: () => void | Promise<void>;
    readonly mutationExecutor?: DataTableMutationExecutor;
    readonly actionAuthorization?: DataTableActionAuthorization;
    readonly actionActorFingerprint?: string;
    readonly actionContext?: BrowserMutationContext;
    readonly onActionResult?: (result: DataTableActionResult | DataTableBulkActionResult) => void | Promise<void>;
    readonly onSourceInvalidated?: (sourceId: string) => void;
    readonly onRefetch?: () => void;
    readonly renderDetail?: (row: TableRow) => ReactNode;
    readonly onLoadMore?: (state: DataTableViewState) => void;
    readonly loadMoreLoading?: boolean;
}
export declare function SalesTasksPage({ requestState, viewState, createTask, onViewStateChange, onCreateTaskChange, onCreateTask, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }: SalesTasksPageProps): ReactElement;
export interface SalesOpportunitiesPageProps {
    readonly requestState: DataTableRequestState;
    readonly viewState?: DataTableViewState;
    readonly onViewStateChange?: (state: DataTableViewState) => void;
    readonly mutationExecutor?: DataTableMutationExecutor;
    readonly actionAuthorization?: DataTableActionAuthorization;
    readonly actionActorFingerprint?: string;
    readonly actionContext?: BrowserMutationContext;
    readonly onActionResult?: (result: DataTableActionResult | DataTableBulkActionResult) => void | Promise<void>;
    readonly onSourceInvalidated?: (sourceId: string) => void;
    readonly onRefetch?: () => void;
    readonly renderDetail?: (row: TableRow) => ReactNode;
    readonly onLoadMore?: (state: DataTableViewState) => void;
    readonly loadMoreLoading?: boolean;
}
export declare function SalesOpportunitiesPage({ requestState, viewState, onViewStateChange, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }: SalesOpportunitiesPageProps): ReactElement;
export interface SalesSettingsPageProps {
    readonly settings: SalesWorkspaceSettings;
}
export declare function SalesSettingsPage({ settings }: SalesSettingsPageProps): ReactElement;
export declare const salesDefaultPageContract: Readonly<{
    templates: readonly string[];
    sourceQueries: readonly string[];
    actions: readonly string[];
}>;
//# sourceMappingURL=pages.d.ts.map