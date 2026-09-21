import { type ReactElement, type ReactNode } from "react";
import { type DataTableActionAuthorization, type DataTableActionResult, type DataTableBulkActionResult, type DataTableMutationExecutor, type DataTableRequestState, type DataTableViewState } from "@k-nex/ui-data/data-table-controller";
import { type ChoiceOption, type FormSnapshot } from "@k-nex/ui-forms";
import type { BrowserDataTransport, BrowserMutationContext, UiRuntimeActionDispatcher } from "@k-nex/ui-runtime";
import type { TableRow } from "@k-nex/contracts";
import { type CreateTaskInput, type SalesWorkspaceSettings, type UpdateOpportunityStageInput } from "./contracts.js";
type SalesCrmKind = "account" | "contact" | "lead" | "opportunity";
export declare const salesAccountsTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export declare const salesContactsTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export declare const salesLeadsTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export declare const salesTasksTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export declare const salesOpportunitiesTableDefinition: import("@k-nex/ui-data/data-table-controller").DataTableDefinition<Record<string, never>>;
export interface SalesCrmListPageProps {
    readonly kind: SalesCrmKind;
    readonly requestState: DataTableRequestState;
    readonly viewState?: DataTableViewState;
    readonly onViewStateChange?: (state: DataTableViewState) => void;
    readonly createForm?: ReactNode;
    readonly onRetry?: () => void;
}
export declare function SalesCrmListPage({ kind, requestState, viewState, onViewStateChange, createForm, onRetry }: SalesCrmListPageProps): ReactElement;
export declare const SalesAccountsPage: (props: Omit<SalesCrmListPageProps, "kind">) => ReactElement;
export declare const SalesContactsPage: (props: Omit<SalesCrmListPageProps, "kind">) => ReactElement;
export declare const SalesLeadsPage: (props: Omit<SalesCrmListPageProps, "kind">) => ReactElement;
export interface SalesNotificationsPageProps {
    readonly notifications: readonly TableRow[];
    readonly reminders: readonly TableRow[];
    readonly onRead?: (id: string, revision: number) => void | Promise<void>;
    readonly onArchive?: (id: string, revision: number) => void | Promise<void>;
    readonly onDismiss?: (id: string, revision: number) => void | Promise<void>;
}
/** Fixed recipient-only notification center. The server remains authoritative for recipient/CAS checks. */
export declare function SalesNotificationsPage({ notifications, reminders, onRead, onArchive, onDismiss }: SalesNotificationsPageProps): ReactElement;
export interface SalesCrmFormField {
    readonly name: string;
    readonly label: string;
    readonly required?: boolean;
    readonly value: string;
    readonly error?: string;
}
export interface SalesCrmActionFormProps {
    readonly label: string;
    readonly fields: readonly SalesCrmFormField[];
    readonly pending?: boolean;
    readonly destructive?: boolean;
    readonly submitLabel: string;
    readonly confirmation?: string;
    readonly formError?: string;
    readonly onChange: (name: string, value: string) => void;
    readonly onSubmit: () => void | Promise<void>;
}
export declare function SalesCrmActionForm({ label, fields, pending, destructive, submitLabel, confirmation, formError, onChange, onSubmit }: SalesCrmActionFormProps): ReactElement;
export interface SalesCrmDetailPageProps {
    readonly kind: SalesCrmKind;
    readonly recordId: string;
    readonly requestState: DataTableRequestState;
    readonly permissions?: readonly string[];
    readonly ownership?: ReactNode;
    readonly relations?: ReactNode;
    readonly timeline?: ReactNode;
    readonly timelineState?: DataTableRequestState;
    readonly tasks?: ReactNode;
    readonly history?: ReactNode;
    readonly actions?: ReactNode;
    readonly onRetry?: () => void;
}
export type SalesRoutePagination = Readonly<{
    listPage: number;
    timelinePage: number;
    onListPageChange: (page: number) => void;
    onTimelinePageChange: (page: number) => void;
}>;
export declare function useSalesRoutePagination(): SalesRoutePagination | undefined;
export declare function SalesFixedDetailRouteProvider({ timeline, history, pagination, hostOwnsRouteChrome, children }: Readonly<{
    timeline?: ReactNode;
    history?: ReactNode;
    pagination?: SalesRoutePagination;
    hostOwnsRouteChrome?: boolean;
    children: ReactNode;
}>): ReactElement;
export interface SalesStateHistoryEntry {
    readonly actionId: string;
    readonly stateField: "status" | "stageId" | "archiveStatus";
    readonly fromState: string;
    readonly toState: string;
    readonly revision: number;
    readonly occurredAt: string;
}
export declare function SalesStateHistory({ entries }: Readonly<{
    entries: readonly SalesStateHistoryEntry[];
}>): ReactElement;
export interface SalesTimelineProps {
    readonly requestState: DataTableRequestState;
    readonly permissions?: readonly string[];
    readonly dispatchAction?: UiRuntimeActionDispatcher;
    readonly onRetry?: () => void;
}
export declare function SalesTimeline({ requestState, permissions, dispatchAction, onRetry }: SalesTimelineProps): ReactElement;
export declare function SalesCrmDetailPage(props: SalesCrmDetailPageProps): ReactElement;
export declare function createSalesTaskQuickCreateController(transport: BrowserDataTransport, idempotencyKey: string): import("@k-nex/ui-forms").FormController<CreateTaskInput, unknown>;
export declare function createSalesOpportunityStageController(transport: BrowserDataTransport, initialValues: UpdateOpportunityStageInput, idempotencyKey: string): import("@k-nex/ui-forms").FormController<UpdateOpportunityStageInput, unknown>;
export interface SalesOpportunityEditFormProps {
    readonly opportunity: FormSnapshot<UpdateOpportunityStageInput>;
    readonly opportunityOptions: readonly ChoiceOption[];
    readonly onOpportunityChange: <K extends keyof UpdateOpportunityStageInput>(field: K, value: UpdateOpportunityStageInput[K]) => void;
    readonly onOpportunitySubmit: () => void | Promise<void>;
}
export declare function SalesOpportunityEditForm({ opportunity, opportunityOptions, onOpportunityChange, onOpportunitySubmit }: SalesOpportunityEditFormProps): ReactElement;
export declare function SalesOverviewPage(): ReactElement;
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
/** Fixed data-movement shells keep their actions inside the registered workspace route. */
export interface SalesDataMovementPageProps {
    readonly children: ReactNode;
}
export declare function SalesImportsPage({ children }: SalesDataMovementPageProps): ReactElement;
export declare function SalesExportsPage({ children }: SalesDataMovementPageProps): ReactElement;
export declare const salesDefaultPageContract: Readonly<{
    templates: readonly string[];
    sourceQueries: readonly string[];
    actions: readonly string[];
}>;
export {};
//# sourceMappingURL=pages.d.ts.map