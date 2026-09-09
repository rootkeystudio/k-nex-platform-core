import { createContext, isValidElement, useContext, useState, type Context, type ReactElement, type ReactNode } from "react";

import { Button } from "@k-nex/ui-design-system-contracts";
import { Card, Section, Status } from "@k-nex/ui-components";
import { DataTable } from "@k-nex/ui-data/data-table";
import {
  createDataTableState,
  defineDataTable,
  type DataTableActionAuthorization,
  type DataTableActionResult,
  type DataTableBulkActionResult,
  type DataTableMutationExecutor,
  type DataTableRequestState,
  type DataTableViewState
} from "@k-nex/ui-data/data-table-controller";
import { QueryBoundary } from "@k-nex/ui-data/metric";
import { DataList, KeyValueList } from "@k-nex/ui-data/presentation";
import { PaginationControl, StaleState } from "@k-nex/ui-data/table-controls";
import { Form, FormActions, Select, TextInput, createFormController, type ChoiceOption, type FormSnapshot } from "@k-nex/ui-forms";
import { DashboardPage, DetailPage, IndexPage, SettingsPage } from "@k-nex/ui-pages";
import type { BrowserDataTransport, BrowserMutationContext, BrowserRequestState, UiRuntimeActionDispatcher } from "@k-nex/ui-runtime";
import type { TableRecords, TableRow } from "@k-nex/contracts";

import {
  salesCreateTaskMutation,
  salesAccountsQuery,
  salesContactsQuery,
  salesLeadsQuery,
  salesOpportunitiesQuery,
  salesOpportunityStageMutation,
  salesUpdateTaskMutation,
  salesTasksQuery
} from "./browser.js";
import {
  salesAccountsDescriptor,
  salesActivityCancelDescriptor,
  salesActivityCompleteDescriptor,
  salesAttachmentRemoveDescriptor,
  salesContactsDescriptor,
  salesLeadsDescriptor,
  salesOpportunitiesDescriptor,
  salesOpportunitiesPageTemplate,
  salesOverviewPageTemplate,
  salesSettingsPageTemplate,
  salesTaskPageTemplate,
  salesTasksDescriptor,
  isSalesRecordId,
  type CreateTaskInput,
  type SalesWorkspaceSettings,
  type UpdateOpportunityStageInput
} from "./contracts.js";

type SalesCrmKind = "account" | "contact" | "lead" | "opportunity";

const crmColumns = {
  account: [{ id: "name", label: "Name", size: 280 }, { id: "owner-id", label: "Owner" }, { id: "status", label: "Status" }, { id: "revision", label: "Revision" }],
  contact: [{ id: "display-name", label: "Name", size: 280 }, { id: "owner-id", label: "Owner" }, { id: "account-id", label: "Account" }, { id: "status", label: "Status" }, { id: "revision", label: "Revision" }, { id: "email", label: "Email", defaultVisible: false }, { id: "phone", label: "Phone", defaultVisible: false }],
  lead: [{ id: "display-name", label: "Name", size: 280 }, { id: "owner-id", label: "Owner" }, { id: "status", label: "Status" }, { id: "archive-status", label: "Archive status" }, { id: "revision", label: "Revision" }, { id: "email", label: "Email", defaultVisible: false }, { id: "phone", label: "Phone", defaultVisible: false }]
} as const;

export const salesAccountsTableDefinition = defineDataTable({ id: "sales.accounts-index", descriptor: salesAccountsDescriptor, query: salesAccountsQuery, columns: crmColumns.account, paginationModes: ["offset"], defaultPageSize: 25, rowActions: [] });
export const salesContactsTableDefinition = defineDataTable({ id: "sales.contacts-index", descriptor: salesContactsDescriptor, query: salesContactsQuery, columns: crmColumns.contact, paginationModes: ["offset"], defaultPageSize: 25, rowActions: [] });
export const salesLeadsTableDefinition = defineDataTable({ id: "sales.leads-index", descriptor: salesLeadsDescriptor, query: salesLeadsQuery, columns: crmColumns.lead, paginationModes: ["offset"], defaultPageSize: 25, rowActions: [] });

export const salesTasksTableDefinition = defineDataTable({
  id: "sales.tasks-index",
  descriptor: salesTasksDescriptor,
  query: salesTasksQuery,
  columns: [
    { id: "title", label: "Title", size: 280 },
    { id: "status", label: "Status" }
  ],
  paginationModes: ["offset"],
  defaultPageSize: 25,
  searchField: "title",
  facets: { status: ["open", "completed", "cancelled"] },
  rowActions: [],
  bulkActions: []
});

export const salesOpportunitiesTableDefinition = defineDataTable({
  id: "sales.opportunities-index",
  descriptor: salesOpportunitiesDescriptor,
  query: salesOpportunitiesQuery,
  columns: [{ id: "name", label: "Name", size: 280 }, { id: "pipeline-id", label: "Pipeline" }, { id: "pipeline-revision", label: "Pipeline revision" }, { id: "stage-id", label: "Stage" }, { id: "stage-name", label: "Stage name" }, { id: "stage-semantic", label: "Stage semantic" }, { id: "stage-revision", label: "Stage revision" }, { id: "revision", label: "Revision" }, { id: "amount", label: "Amount" }],
  paginationModes: ["offset"],
  defaultPageSize: 25,
  rowActions: []
});

const crmListConfig = {
  account: { title: "Accounts", description: "Authorized customer and prospect accounts.", href: "/sales/accounts", templateId: "sales.page.accounts", definition: salesAccountsTableDefinition },
  contact: { title: "Contacts", description: "Authorized contacts and account relationships.", href: "/sales/contacts", templateId: "sales.page.contacts", definition: salesContactsTableDefinition },
  lead: { title: "Leads", description: "Authorized leads awaiting a qualification decision.", href: "/sales/leads", templateId: "sales.page.leads", definition: salesLeadsTableDefinition },
  opportunity: { title: "Opportunities", description: "Authorized pipeline opportunities.", href: "/sales/opportunities", templateId: "sales.page.opportunities", definition: salesOpportunitiesTableDefinition }
} as const;

export interface SalesCrmListPageProps {
  readonly kind: SalesCrmKind;
  readonly requestState: DataTableRequestState;
  readonly viewState?: DataTableViewState;
  readonly onViewStateChange?: (state: DataTableViewState) => void;
  readonly createForm?: ReactNode;
  readonly onRetry?: () => void;
}

export function SalesCrmListPage({ kind, requestState, viewState, onViewStateChange, createForm, onRetry }: SalesCrmListPageProps): ReactElement {
  const config = crmListConfig[kind];
  const [localState, setLocalState] = useState(() => createDataTableState(config.definition));
  const state = viewState ?? localState;
  return <IndexPage templateId={config.templateId} title={config.title} description={config.description} breadcrumbs={crumbs(config.title, config.href)} {...(createForm === undefined ? {} : { aside: <Card>{createForm}</Card> })}>
    <DataTable mode="grid" definition={config.definition} viewState={state} requestState={requestState} onViewStateChange={onViewStateChange ?? setLocalState} renderDetail={(row) => isSalesRecordId(row.key) ? <a href={`${config.href}/${row.key}`} aria-label={`Open ${kind} ${row.key}`}>Open detail</a> : null} {...(onRetry === undefined ? {} : { onRetry })} />
  </IndexPage>;
}

export const SalesAccountsPage = (props: Omit<SalesCrmListPageProps, "kind">): ReactElement => <SalesCrmListPage kind="account" {...props} />;
export const SalesContactsPage = (props: Omit<SalesCrmListPageProps, "kind">): ReactElement => <SalesCrmListPage kind="contact" {...props} />;
export const SalesLeadsPage = (props: Omit<SalesCrmListPageProps, "kind">): ReactElement => <SalesCrmListPage kind="lead" {...props} />;

export interface SalesNotificationsPageProps {
  readonly notifications: readonly TableRow[];
  readonly reminders: readonly TableRow[];
  readonly onRead?: (id: string, revision: number) => void | Promise<void>;
  readonly onArchive?: (id: string, revision: number) => void | Promise<void>;
  readonly onDismiss?: (id: string, revision: number) => void | Promise<void>;
}
function recipientRevision(row: TableRow): number | undefined {
  const cell = row.values.revision;
  return cell !== null && typeof cell === "object" && "value" in cell && Number.isSafeInteger(cell.value) && (cell.value as number) >= 1 ? cell.value as number : undefined;
}
function recipientText(row: TableRow, field: string): string {
  const cell = row.values[field]; return cell !== null && typeof cell === "object" && "value" in cell && typeof cell.value === "string" ? cell.value : "Unavailable";
}
/** Fixed recipient-only notification center. The server remains authoritative for recipient/CAS checks. */
export function SalesNotificationsPage({ notifications, reminders, onRead, onArchive, onDismiss }: SalesNotificationsPageProps): ReactElement {
  return <IndexPage templateId="sales.page.notifications" title="Notifications" description="Your authorized reminders and notification delivery records." breadcrumbs={crumbs("Notifications", "/sales/notifications")}>
    <Section label="Notifications"><ul aria-label="Notifications">{notifications.map((row) => { const revision = recipientRevision(row); const state = recipientText(row, "state"); return <li key={row.key}><span>{recipientText(row, "subject")} ({state})</span>{state === "unread" && revision !== undefined && onRead !== undefined ? <button type="button" data-action-id="sales.notification.read" data-record-id={row.key} onClick={() => void onRead(row.key, revision)}>Read notification</button> : null}{state !== "archived" && revision !== undefined && onArchive !== undefined ? <button type="button" data-action-id="sales.notification.archive" data-record-id={row.key} onClick={() => void onArchive(row.key, revision)}>Archive notification</button> : null}</li>; })}</ul></Section>
    <Section label="Reminders"><ul aria-label="Reminders">{reminders.map((row) => { const revision = recipientRevision(row); const state = recipientText(row, "state"); return <li key={row.key}><span>{recipientText(row, "subject")} ({state})</span>{(state === "scheduled" || state === "delivered") && revision !== undefined && onDismiss !== undefined ? <button type="button" data-action-id="sales.reminder.dismiss" data-record-id={row.key} onClick={() => void onDismiss(row.key, revision)}>{state === "scheduled" ? "Cancel reminder" : "Dismiss reminder"}</button> : null}</li>; })}</ul></Section>
  </IndexPage>;
}

export interface SalesCrmFormField { readonly name: string; readonly label: string; readonly required?: boolean; readonly value: string; readonly error?: string; }
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

export function SalesCrmActionForm({ label, fields, pending = false, destructive = false, submitLabel, confirmation, formError, onChange, onSubmit }: SalesCrmActionFormProps): ReactElement {
  return <Form label={label} pending={pending} onSubmit={onSubmit}>
    {fields.map((field) => <TextInput key={field.name} name={field.name} label={field.label} value={field.value} {...(field.required === undefined ? {} : { required: field.required })} disabled={pending} {...(field.error === undefined ? {} : { error: field.error })} onChange={(value) => onChange(field.name, value)} />)}
    {formError === undefined ? null : <p role="alert">Action failed. Refresh record and try again.</p>}
    {confirmation === undefined ? null : <p role="status" aria-live="polite">{confirmation}</p>}
    <FormActions><Button type="submit" isDisabled={pending} {...(destructive ? { variant: "danger" as const } : {})}>{submitLabel}</Button></FormActions>
  </Form>;
}

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
type SalesFixedDetailValue = Readonly<{ timeline?: ReactNode; history?: ReactNode; pagination?: SalesRoutePagination; hostOwnsRouteChrome?: boolean }>;
let salesFixedDetailContext: Context<SalesFixedDetailValue | undefined> | undefined;
function fixedDetailContext(): Context<SalesFixedDetailValue | undefined> {
  return salesFixedDetailContext ??= createContext<SalesFixedDetailValue | undefined>(undefined);
}
export function useSalesRoutePagination(): SalesRoutePagination | undefined {
  return useContext(fixedDetailContext())?.pagination;
}
export function SalesFixedDetailRouteProvider({ timeline, history, pagination, hostOwnsRouteChrome = false, children }: Readonly<{ timeline?: ReactNode; history?: ReactNode; pagination?: SalesRoutePagination; hostOwnsRouteChrome?: boolean; children: ReactNode }>): ReactElement {
  const ContextProvider = fixedDetailContext().Provider;
  return <ContextProvider value={{ ...(timeline === undefined ? {} : { timeline }), ...(history === undefined ? {} : { history }), ...(pagination === undefined ? {} : { pagination }), ...(hostOwnsRouteChrome ? { hostOwnsRouteChrome: true } : {}) }}>{children}</ContextProvider>;
}

export interface SalesStateHistoryEntry {
  readonly actionId: string;
  readonly stateField: "status" | "stageId" | "archiveStatus";
  readonly fromState: string;
  readonly toState: string;
  readonly revision: number;
  readonly occurredAt: string;
}

export function SalesStateHistory({ entries }: Readonly<{ entries: readonly SalesStateHistoryEntry[] }>): ReactElement {
  const labels = { status: "Status", stageId: "Stage", archiveStatus: "Archive status" } as const;
  const bounded = [...entries].sort((left, right) => right.revision - left.revision).slice(0, 25);
  return bounded.length === 0 ? <p role="status">No state transitions.</p> : <DataList label="Authorized state transition history" items={bounded.map((entry) => ({
    id: `${entry.revision}:${entry.stateField}`,
    label: `${labels[entry.stateField]}: ${entry.fromState} to ${entry.toState}`,
    value: `${entry.actionId} · revision ${entry.revision} · ${entry.occurredAt}`
  }))} />;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  if (!("value" in value)) return "—";
  const cell = value as { readonly value?: unknown; readonly currency?: unknown };
  if (cell.value === null || cell.value === undefined) return "—";
  return typeof cell.currency === "string" ? `${String(cell.value)} ${cell.currency}` : String(cell.value);
}

function detailContent(props: SalesCrmDetailPageProps): ReactNode {
  const render = (data: NonNullable<Extract<DataTableRequestState, { state: "success" }>["data"]>) => {
    const record = data.rows[0];
    if (record === undefined) return <div role="status" data-state="empty">Record unavailable.</div>;
    const ownership = data.fields.filter((field) => ["owner-id", "team-id"].includes(field) && record.values[field] != null);
    const relations = data.fields.filter((field) => ["account-id", "primary-contact-id", "pipeline-id", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"].includes(field) && record.values[field] != null);
    const summary = data.fields.filter((field) => !ownership.includes(field) && !relations.includes(field) && !["revision"].includes(field) && record.values[field] != null);
    const timeline = props.timeline ?? (props.timelineState === undefined ? undefined : <SalesTimeline requestState={props.timelineState} {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })} />);
    return <>
      <Section label="Summary"><KeyValueList label="Authorized record fields" items={summary.map((field) => ({ id: field, key: field.replaceAll("-", " "), value: cellText(record.values[field]) }))} /></Section>
      {props.ownership === undefined && ownership.length === 0 ? null : <Section label="Ownership">{props.ownership ?? <KeyValueList label="Authorized ownership" items={ownership.map((field) => ({ id: field, key: field.replaceAll("-", " "), value: cellText(record.values[field]) }))} />}</Section>}
      {props.relations === undefined && relations.length === 0 ? null : <Section label="Relations">{props.relations ?? <KeyValueList label="Authorized relations" items={relations.map((field) => {
        const value = cellText(record.values[field]);
        const destination = field === "qualified-account-id" ? { permission: "sales.accounts.read", href: `/sales/accounts/${encodeURIComponent(value)}`, label: "View qualified account" }
          : field === "qualified-contact-id" ? { permission: "sales.contacts.read", href: `/sales/contacts/${encodeURIComponent(value)}`, label: "View qualified contact" }
            : field === "qualified-opportunity-id" ? { permission: "sales.opportunities.read", href: `/sales/opportunities/${encodeURIComponent(value)}`, label: "View qualified opportunity" } : undefined;
        return { id: field, key: field.replaceAll("-", " "), value: destination !== undefined && props.permissions?.includes(destination.permission) === true ? <a href={destination.href} aria-label={destination.label}>{value}</a> : value };
      })} />}</Section>}
      {timeline === undefined ? null : isValidElement(timeline) && timeline.type === SalesTimeline ? timeline : <Section label="Timeline">{timeline}</Section>}
      {props.tasks === undefined ? null : <Section label="Tasks and reminders">{props.tasks}</Section>}
      <Section label="State history">{props.history ?? <KeyValueList label="Authorized state history" items={[{ id: "status", key: "status", value: cellText(record.values.status) }, { id: "revision", key: "revision", value: cellText(record.values.revision) }]} />}</Section>
      {props.actions === undefined ? null : <Section label="Authorized actions">{props.actions}</Section>}
    </>;
  };
  if (props.requestState.state === "stale") return <StaleState {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })}>{render(props.requestState.data)}</StaleState>;
  if (props.requestState.state === "refetching") return <section aria-label="Refreshing record" data-state="refetching"><p role="status">Refreshing…</p>{render(props.requestState.data)}</section>;
  if (props.requestState.state === "insufficient-permission") return <div role="alert" data-state="insufficient-permission">Required record fields are unavailable.</div>;
  return <QueryBoundary state={props.requestState} empty="Record unavailable." {...(props.onRetry === undefined ? {} : { onRetry: props.onRetry })}>{render}</QueryBoundary>;
}

export interface SalesTimelineProps {
  readonly requestState: DataTableRequestState;
  readonly permissions?: readonly string[];
  readonly dispatchAction?: UiRuntimeActionDispatcher;
  readonly onRetry?: () => void;
}

function timelineEntryId(row: TableRecords["rows"][number], prefix: string): string | undefined {
  return row.key.startsWith(`${prefix}:`) && isSalesRecordId(row.key.slice(prefix.length + 1)) ? row.key.slice(prefix.length + 1) : undefined;
}

export function SalesTimeline({ requestState, permissions, dispatchAction, onRetry }: SalesTimelineProps): ReactElement {
  const [announcement, setAnnouncement] = useState("");
  const pagination = useSalesRoutePagination();
  const allowed = (permission: string) => permissions === undefined || permissions.includes(permission);
  const run = async (action: { readonly id: string; readonly version: number }, row: TableRecords["rows"][number], label: string, prefix: string) => {
    const id = timelineEntryId(row, prefix); const revision = Number(cellText(row.values.revision));
    if (dispatchAction === undefined || id === undefined || !Number.isSafeInteger(revision)) return;
    try {
      await dispatchAction({ action, input: { id, expectedRevision: revision }, nodeId: `sales-fixed-timeline-${row.key}` });
      setAnnouncement(`${label} completed.`);
    } catch { setAnnouncement(`${label} failed. Refresh record and try again.`); }
  };
  const render = (data: Extract<DataTableRequestState, { state: "success" }>["data"]) => {
    const tasks = data.rows.filter((row) => cellText(row.values.kind) === "task");
    const events = data.rows.filter((row) => cellText(row.values.kind) !== "task");
    const eventItems = events.map((row) => {
      const kind = cellText(row.values.kind); const subject = cellText(row.values.subject); const status = cellText(row.values.status);
      const activityId = timelineEntryId(row, "activity"); const attachmentId = timelineEntryId(row, "attachment");
      const activity = kind.startsWith("activity:") && status === "scheduled" && activityId !== undefined;
      const attachment = kind === "attachment" && status === "active" && attachmentId !== undefined;
      const canComplete = activity && allowed(salesActivityCompleteDescriptor.permission);
      const canCancel = activity && allowed(salesActivityCancelDescriptor.permission);
      const canRemove = attachment && allowed(salesAttachmentRemoveDescriptor.permission);
      const controls = dispatchAction === undefined || !canComplete && !canCancel && !canRemove ? null : <span role="group" aria-label={`Actions for ${subject}`}>
        {canComplete ? <button type="button" data-action-id={salesActivityCompleteDescriptor.id} data-record-id={activityId} onClick={() => run(salesActivityCompleteDescriptor, row, `Complete ${subject}`, "activity")}>Complete {subject}</button> : null}
        {canCancel ? <button type="button" data-action-id={salesActivityCancelDescriptor.id} data-record-id={activityId} onClick={() => run(salesActivityCancelDescriptor, row, `Cancel ${subject}`, "activity")}>Cancel {subject}</button> : null}
        {canRemove ? <button type="button" data-action-id={salesAttachmentRemoveDescriptor.id} data-record-id={attachmentId} onClick={() => run(salesAttachmentRemoveDescriptor, row, `Remove ${subject}`, "attachment")}>Remove {subject}</button> : null}
      </span>;
      const body = cellText(row.values.body);
      return { id: row.key, label: `${kind}: ${subject}`, value: <>{[status, cellText(row.values["occurred-at"]), ...(body === "—" ? [] : [body])].join(" · ")}{controls}</> };
    });
    return <>
      <Section label="Timeline">{eventItems.length === 0 ? <p role="status">No timeline entries.</p> : <DataList label="Activity, notes, and attachments" items={eventItems} />}</Section>
      {allowed("sales.tasks.read") ? <Section label="Tasks and reminders">{tasks.length === 0 ? <p role="status">No tasks or reminders.</p> : <DataList label="Related tasks and reminders" items={tasks.map((row) => ({ id: row.key, label: cellText(row.values.subject), value: `${cellText(row.values.status)} · ${cellText(row.values["occurred-at"])}` }))} />}</Section> : null}
      {pagination === undefined || data.page.number <= 1 && !data.page.hasNext ? null : <PaginationControl page={data.page.number} hasNext={data.page.hasNext} onPageChange={pagination.onTimelinePageChange} />}
      <p role="status" aria-live="polite">{announcement}</p>
    </>;
  };
  if (requestState.state === "stale") return <StaleState {...(onRetry === undefined ? {} : { onRetry })}>{render(requestState.data)}</StaleState>;
  if (requestState.state === "refetching") return <section aria-label="Refreshing timeline" data-state="refetching"><p role="status">Refreshing…</p>{render(requestState.data)}</section>;
  if (requestState.state === "insufficient-permission") return <></>;
  return <QueryBoundary state={requestState} empty="No timeline entries." {...(onRetry === undefined ? {} : { onRetry })}>{render}</QueryBoundary>;
}

export function SalesCrmDetailPage(props: SalesCrmDetailPageProps): ReactElement {
  const config = crmListConfig[props.kind];
  const title = `${config.title.slice(0, -1)} detail`;
  const fixed = useContext(fixedDetailContext());
  const resolved = { ...props, ...(props.timeline === undefined && fixed?.timeline !== undefined ? { timeline: fixed.timeline } : {}), ...(props.history === undefined && fixed?.history !== undefined ? { history: fixed.history } : {}) };
  if (fixed?.hostOwnsRouteChrome === true) return <>{detailContent(resolved)}</>;
  return <DetailPage templateId={`sales.page.${props.kind}-detail`} title={title} description={`Authorized ${props.kind} context and activity.`} breadcrumbs={crumbs(title, `${config.href}/${encodeURIComponent(props.recordId)}`)}>
    {detailContent(resolved)}
  </DetailPage>;
}

export function createSalesTaskQuickCreateController(transport: BrowserDataTransport, idempotencyKey: string) {
  return createFormController<CreateTaskInput, unknown>({
    initialValues: { title: "" },
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

export interface SalesOpportunityEditFormProps {
  readonly opportunity: FormSnapshot<UpdateOpportunityStageInput>;
  readonly opportunityOptions: readonly ChoiceOption[];
  readonly onOpportunityChange: <K extends keyof UpdateOpportunityStageInput>(field: K, value: UpdateOpportunityStageInput[K]) => void;
  readonly onOpportunitySubmit: () => void | Promise<void>;
}
export function SalesOpportunityEditForm({ opportunity, opportunityOptions, onOpportunityChange, onOpportunitySubmit }: SalesOpportunityEditFormProps): ReactElement {
  return <Form label="Edit opportunity" pending={opportunity.submitting} onSubmit={onOpportunitySubmit}>
    <Select name="id" label="Opportunity" value={opportunity.values.id} options={opportunityOptions} disabled={opportunity.submitting} {...(opportunity.fieldErrors.id === undefined ? {} : { error: opportunity.fieldErrors.id })} onChange={(value) => onOpportunityChange("id", value)} />
    <TextInput name="destinationStageId" label="Destination stage ID" value={opportunity.values.destinationStageId} required disabled={opportunity.submitting} {...(opportunity.fieldErrors.destinationStageId === undefined ? {} : { error: opportunity.fieldErrors.destinationStageId })} onChange={(value) => onOpportunityChange("destinationStageId", value)} />
    <FormActions><Button type="submit" isDisabled={opportunity.submitting}>Save opportunity</Button></FormActions>
  </Form>;
}

const crumbs = (current: string, href: string) => [{ id: "sales", label: "Sales", href: "/sales" }, { id: "current", label: current, href, current: true }];

export function SalesOverviewPage(): ReactElement {
  return <DashboardPage templateId={salesOverviewPageTemplate.id} title="Sales overview" description="Current pipeline summary." breadcrumbs={crumbs("Overview", "/sales")}>
    <></>
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
export function SalesTasksPage({ requestState, viewState = createDataTableState(salesTasksTableDefinition), createTask, onViewStateChange, onCreateTaskChange, onCreateTask, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }: SalesTasksPageProps): ReactElement {
  return <IndexPage templateId={salesTaskPageTemplate.id} title="Sales tasks" description="Authorized tasks and follow-up work." breadcrumbs={crumbs("Tasks", "/sales/tasks")} aside={<Card><Form label="Create task" pending={createTask.submitting} onSubmit={onCreateTask}><TextInput name="title" label="Title" value={createTask.values.title} {...(createTask.fieldErrors.title === undefined ? {} : { error: createTask.fieldErrors.title })} required onChange={(value) => onCreateTaskChange("title", value)} /><FormActions><Button type="submit" isDisabled={createTask.submitting}>Create task</Button></FormActions></Form></Card>}>
    <DataTable definition={salesTasksTableDefinition} viewState={viewState} requestState={requestState} {...(onViewStateChange === undefined ? {} : { onViewStateChange })} {...(mutationExecutor === undefined ? {} : { mutationExecutor })} {...(actionAuthorization === undefined ? {} : { actionAuthorization })} {...(actionActorFingerprint === undefined ? {} : { actionActorFingerprint })} {...(actionContext === undefined ? {} : { actionContext })} {...(onActionResult === undefined ? {} : { onActionResult })} {...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated })} {...(onRefetch === undefined ? {} : { onRefetch })} {...(renderDetail === undefined ? {} : { renderDetail })} {...(onLoadMore === undefined ? {} : { onLoadMore })} {...(loadMoreLoading === undefined ? {} : { loadMoreLoading })} />
  </IndexPage>;
}

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
export function SalesOpportunitiesPage({ requestState, viewState, onViewStateChange, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }: SalesOpportunitiesPageProps): ReactElement {
  const [localState, setLocalState] = useState(() => createDataTableState(salesOpportunitiesTableDefinition));
  return <IndexPage templateId={salesOpportunitiesPageTemplate.id} title="Opportunities" description="Authorized pipeline opportunities." breadcrumbs={crumbs("Opportunities", "/sales/opportunities")}>
    <DataTable mode="grid" definition={salesOpportunitiesTableDefinition} viewState={viewState ?? localState} requestState={requestState} onViewStateChange={onViewStateChange ?? setLocalState} {...(mutationExecutor === undefined ? {} : { mutationExecutor })} {...(actionAuthorization === undefined ? {} : { actionAuthorization })} {...(actionActorFingerprint === undefined ? {} : { actionActorFingerprint })} {...(actionContext === undefined ? {} : { actionContext })} {...(onActionResult === undefined ? {} : { onActionResult })} {...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated })} {...(onRefetch === undefined ? {} : { onRefetch })} renderDetail={renderDetail ?? ((row) => isSalesRecordId(row.key) ? <a href={`/sales/opportunities/${row.key}`} aria-label={`Open opportunity ${row.key}`}>Open detail</a> : null)} {...(onLoadMore === undefined ? {} : { onLoadMore })} {...(loadMoreLoading === undefined ? {} : { loadMoreLoading })} />
  </IndexPage>;
}

export interface SalesSettingsPageProps { readonly settings: SalesWorkspaceSettings; }
export function SalesSettingsPage({ settings }: SalesSettingsPageProps): ReactElement {
  return <SettingsPage templateId={salesSettingsPageTemplate.id} title="Sales settings" description="Workspace presentation settings." breadcrumbs={crumbs("Settings", "/sales/settings")}>
    <Status tone="positive">Active</Status>
    <KeyValueList label="Sales settings" items={[
      { id: "default-page", key: "Default page", value: settings.defaultPage },
      { id: "page-size", key: "Task page size", value: String(settings.defaultTaskPageSize) },
      { id: "revenue", key: "Potential revenue", value: settings.showPotentialRevenue ? "Visible" : "Hidden" }
    ]} />
  </SettingsPage>;
}

/** Fixed data-movement shells keep their actions inside the registered workspace route. */
export interface SalesDataMovementPageProps { readonly children: ReactNode; }

export function SalesImportsPage({ children }: SalesDataMovementPageProps): ReactElement {
  return <IndexPage templateId="sales.page.imports" title="Imports" description="Validate, queue, and review controlled CRM imports." breadcrumbs={crumbs("Imports", "/sales/imports")}>
    {children}
  </IndexPage>;
}

export function SalesExportsPage({ children }: SalesDataMovementPageProps): ReactElement {
  return <IndexPage templateId="sales.page.exports" title="Exports" description="Create and retrieve authorized CRM export snapshots." breadcrumbs={crumbs("Exports", "/sales/exports")}>
    {children}
  </IndexPage>;
}

export const salesDefaultPageContract = Object.freeze({
  templates: Object.freeze([salesOverviewPageTemplate.id, salesTaskPageTemplate.id, salesOpportunitiesPageTemplate.id, salesSettingsPageTemplate.id]),
  sourceQueries: Object.freeze([salesTasksQuery.source.id, salesOpportunitiesQuery.source.id]),
  actions: Object.freeze([salesCreateTaskMutation.action.id, salesUpdateTaskMutation.action.id, salesOpportunityStageMutation.action.id])
});
