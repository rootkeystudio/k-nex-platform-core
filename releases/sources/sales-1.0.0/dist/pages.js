import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createContext, isValidElement, useContext, useState } from "react";
import { Button } from "@k-nex/ui-design-system-contracts";
import { Card, Section, Status } from "@k-nex/ui-components";
import { DataTable } from "@k-nex/ui-data/data-table";
import { createDataTableState, defineDataTable } from "@k-nex/ui-data/data-table-controller";
import { QueryBoundary } from "@k-nex/ui-data/metric";
import { DataList, KeyValueList } from "@k-nex/ui-data/presentation";
import { PaginationControl, StaleState } from "@k-nex/ui-data/table-controls";
import { Form, FormActions, Select, TextInput, createFormController } from "@k-nex/ui-forms";
import { DashboardPage, DetailPage, IndexPage, SettingsPage } from "@k-nex/ui-pages";
import { salesCreateTaskMutation, salesAccountsQuery, salesContactsQuery, salesLeadsQuery, salesOpportunitiesQuery, salesOpportunityStageMutation, salesUpdateTaskMutation, salesTasksQuery } from "./browser.js";
import { salesAccountsDescriptor, salesActivityCancelDescriptor, salesActivityCompleteDescriptor, salesAttachmentRemoveDescriptor, salesContactsDescriptor, salesLeadsDescriptor, salesOpportunitiesDescriptor, salesOpportunitiesPageTemplate, salesOverviewPageTemplate, salesSettingsPageTemplate, salesTaskPageTemplate, salesTasksDescriptor, isSalesRecordId } from "./contracts.js";
const crmColumns = {
    account: [{ id: "name", label: "Name", size: 280 }, { id: "owner-id", label: "Owner" }, { id: "status", label: "Status" }, { id: "revision", label: "Revision" }],
    contact: [{ id: "display-name", label: "Name", size: 280 }, { id: "owner-id", label: "Owner" }, { id: "account-id", label: "Account" }, { id: "status", label: "Status" }, { id: "revision", label: "Revision" }, { id: "email", label: "Email", defaultVisible: false }, { id: "phone", label: "Phone", defaultVisible: false }],
    lead: [{ id: "display-name", label: "Name", size: 280 }, { id: "owner-id", label: "Owner" }, { id: "status", label: "Status" }, { id: "archive-status", label: "Archive status" }, { id: "revision", label: "Revision" }, { id: "email", label: "Email", defaultVisible: false }, { id: "phone", label: "Phone", defaultVisible: false }]
};
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
};
export function SalesCrmListPage({ kind, requestState, viewState, onViewStateChange, createForm, onRetry }) {
    const config = crmListConfig[kind];
    const [localState, setLocalState] = useState(() => createDataTableState(config.definition));
    const state = viewState ?? localState;
    return _jsx(IndexPage, { templateId: config.templateId, title: config.title, description: config.description, breadcrumbs: crumbs(config.title, config.href), ...(createForm === undefined ? {} : { aside: _jsx(Card, { children: createForm }) }), children: _jsx(DataTable, { mode: "grid", definition: config.definition, viewState: state, requestState: requestState, onViewStateChange: onViewStateChange ?? setLocalState, renderDetail: (row) => isSalesRecordId(row.key) ? _jsx("a", { href: `${config.href}/${row.key}`, "aria-label": `Open ${kind} ${row.key}`, children: "Open detail" }) : null, ...(onRetry === undefined ? {} : { onRetry }) }) });
}
export const SalesAccountsPage = (props) => _jsx(SalesCrmListPage, { kind: "account", ...props });
export const SalesContactsPage = (props) => _jsx(SalesCrmListPage, { kind: "contact", ...props });
export const SalesLeadsPage = (props) => _jsx(SalesCrmListPage, { kind: "lead", ...props });
function recipientRevision(row) {
    const cell = row.values.revision;
    return cell !== null && typeof cell === "object" && "value" in cell && Number.isSafeInteger(cell.value) && cell.value >= 1 ? cell.value : undefined;
}
function recipientText(row, field) {
    const cell = row.values[field];
    return cell !== null && typeof cell === "object" && "value" in cell && typeof cell.value === "string" ? cell.value : "Unavailable";
}
/** Fixed recipient-only notification center. The server remains authoritative for recipient/CAS checks. */
export function SalesNotificationsPage({ notifications, reminders, onRead, onArchive, onDismiss }) {
    return _jsxs(IndexPage, { templateId: "sales.page.notifications", title: "Notifications", description: "Your authorized reminders and notification delivery records.", breadcrumbs: crumbs("Notifications", "/sales/notifications"), children: [_jsx(Section, { label: "Notifications", children: _jsx("ul", { "aria-label": "Notifications", children: notifications.map((row) => { const revision = recipientRevision(row); const state = recipientText(row, "state"); return _jsxs("li", { children: [_jsxs("span", { children: [recipientText(row, "subject"), " (", state, ")"] }), state === "unread" && revision !== undefined && onRead !== undefined ? _jsx("button", { type: "button", "data-action-id": "sales.notification.read", "data-record-id": row.key, onClick: () => void onRead(row.key, revision), children: "Read notification" }) : null, state !== "archived" && revision !== undefined && onArchive !== undefined ? _jsx("button", { type: "button", "data-action-id": "sales.notification.archive", "data-record-id": row.key, onClick: () => void onArchive(row.key, revision), children: "Archive notification" }) : null] }, row.key); }) }) }), _jsx(Section, { label: "Reminders", children: _jsx("ul", { "aria-label": "Reminders", children: reminders.map((row) => { const revision = recipientRevision(row); const state = recipientText(row, "state"); return _jsxs("li", { children: [_jsxs("span", { children: [recipientText(row, "subject"), " (", state, ")"] }), (state === "scheduled" || state === "delivered") && revision !== undefined && onDismiss !== undefined ? _jsx("button", { type: "button", "data-action-id": "sales.reminder.dismiss", "data-record-id": row.key, onClick: () => void onDismiss(row.key, revision), children: state === "scheduled" ? "Cancel reminder" : "Dismiss reminder" }) : null] }, row.key); }) }) })] });
}
export function SalesCrmActionForm({ label, fields, pending = false, destructive = false, submitLabel, confirmation, formError, onChange, onSubmit }) {
    return _jsxs(Form, { label: label, pending: pending, onSubmit: onSubmit, children: [fields.map((field) => _jsx(TextInput, { name: field.name, label: field.label, value: field.value, ...(field.required === undefined ? {} : { required: field.required }), disabled: pending, ...(field.error === undefined ? {} : { error: field.error }), onChange: (value) => onChange(field.name, value) }, field.name)), formError === undefined ? null : _jsx("p", { role: "alert", children: "Action failed. Refresh record and try again." }), confirmation === undefined ? null : _jsx("p", { role: "status", "aria-live": "polite", children: confirmation }), _jsx(FormActions, { children: _jsx(Button, { type: "submit", isDisabled: pending, ...(destructive ? { variant: "danger" } : {}), children: submitLabel }) })] });
}
let salesFixedDetailContext;
function fixedDetailContext() {
    return salesFixedDetailContext ??= createContext(undefined);
}
export function useSalesRoutePagination() {
    return useContext(fixedDetailContext())?.pagination;
}
export function SalesFixedDetailRouteProvider({ timeline, history, pagination, hostOwnsRouteChrome = false, children }) {
    const ContextProvider = fixedDetailContext().Provider;
    return _jsx(ContextProvider, { value: { ...(timeline === undefined ? {} : { timeline }), ...(history === undefined ? {} : { history }), ...(pagination === undefined ? {} : { pagination }), ...(hostOwnsRouteChrome ? { hostOwnsRouteChrome: true } : {}) }, children: children });
}
export function SalesStateHistory({ entries }) {
    const labels = { status: "Status", stageId: "Stage", archiveStatus: "Archive status" };
    const bounded = [...entries].sort((left, right) => right.revision - left.revision).slice(0, 25);
    return bounded.length === 0 ? _jsx("p", { role: "status", children: "No state transitions." }) : _jsx(DataList, { label: "Authorized state transition history", items: bounded.map((entry) => ({
            id: `${entry.revision}:${entry.stateField}`,
            label: `${labels[entry.stateField]}: ${entry.fromState} to ${entry.toState}`,
            value: `${entry.actionId} · revision ${entry.revision} · ${entry.occurredAt}`
        })) });
}
function cellText(value) {
    if (value === null || value === undefined)
        return "—";
    if (typeof value !== "object")
        return String(value);
    if (!("value" in value))
        return "—";
    const cell = value;
    if (cell.value === null || cell.value === undefined)
        return "—";
    return typeof cell.currency === "string" ? `${String(cell.value)} ${cell.currency}` : String(cell.value);
}
function detailContent(props) {
    const render = (data) => {
        const record = data.rows[0];
        if (record === undefined)
            return _jsx("div", { role: "status", "data-state": "empty", children: "Record unavailable." });
        const ownership = data.fields.filter((field) => ["owner-id", "team-id"].includes(field) && record.values[field] != null);
        const relations = data.fields.filter((field) => ["account-id", "primary-contact-id", "pipeline-id", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"].includes(field) && record.values[field] != null);
        const summary = data.fields.filter((field) => !ownership.includes(field) && !relations.includes(field) && !["revision"].includes(field) && record.values[field] != null);
        const timeline = props.timeline ?? (props.timelineState === undefined ? undefined : _jsx(SalesTimeline, { requestState: props.timelineState, ...(props.onRetry === undefined ? {} : { onRetry: props.onRetry }) }));
        return _jsxs(_Fragment, { children: [_jsx(Section, { label: "Summary", children: _jsx(KeyValueList, { label: "Authorized record fields", items: summary.map((field) => ({ id: field, key: field.replaceAll("-", " "), value: cellText(record.values[field]) })) }) }), props.ownership === undefined && ownership.length === 0 ? null : _jsx(Section, { label: "Ownership", children: props.ownership ?? _jsx(KeyValueList, { label: "Authorized ownership", items: ownership.map((field) => ({ id: field, key: field.replaceAll("-", " "), value: cellText(record.values[field]) })) }) }), props.relations === undefined && relations.length === 0 ? null : _jsx(Section, { label: "Relations", children: props.relations ?? _jsx(KeyValueList, { label: "Authorized relations", items: relations.map((field) => {
                            const value = cellText(record.values[field]);
                            const destination = field === "qualified-account-id" ? { permission: "sales.accounts.read", href: `/sales/accounts/${encodeURIComponent(value)}`, label: "View qualified account" }
                                : field === "qualified-contact-id" ? { permission: "sales.contacts.read", href: `/sales/contacts/${encodeURIComponent(value)}`, label: "View qualified contact" }
                                    : field === "qualified-opportunity-id" ? { permission: "sales.opportunities.read", href: `/sales/opportunities/${encodeURIComponent(value)}`, label: "View qualified opportunity" } : undefined;
                            return { id: field, key: field.replaceAll("-", " "), value: destination !== undefined && props.permissions?.includes(destination.permission) === true ? _jsx("a", { href: destination.href, "aria-label": destination.label, children: value }) : value };
                        }) }) }), timeline === undefined ? null : isValidElement(timeline) && timeline.type === SalesTimeline ? timeline : _jsx(Section, { label: "Timeline", children: timeline }), props.tasks === undefined ? null : _jsx(Section, { label: "Tasks and reminders", children: props.tasks }), _jsx(Section, { label: "State history", children: props.history ?? _jsx(KeyValueList, { label: "Authorized state history", items: [{ id: "status", key: "status", value: cellText(record.values.status) }, { id: "revision", key: "revision", value: cellText(record.values.revision) }] }) }), props.actions === undefined ? null : _jsx(Section, { label: "Authorized actions", children: props.actions })] });
    };
    if (props.requestState.state === "stale")
        return _jsx(StaleState, { ...(props.onRetry === undefined ? {} : { onRetry: props.onRetry }), children: render(props.requestState.data) });
    if (props.requestState.state === "refetching")
        return _jsxs("section", { "aria-label": "Refreshing record", "data-state": "refetching", children: [_jsx("p", { role: "status", children: "Refreshing\u2026" }), render(props.requestState.data)] });
    if (props.requestState.state === "insufficient-permission")
        return _jsx("div", { role: "alert", "data-state": "insufficient-permission", children: "Required record fields are unavailable." });
    return _jsx(QueryBoundary, { state: props.requestState, empty: "Record unavailable.", ...(props.onRetry === undefined ? {} : { onRetry: props.onRetry }), children: render });
}
function timelineEntryId(row, prefix) {
    return row.key.startsWith(`${prefix}:`) && isSalesRecordId(row.key.slice(prefix.length + 1)) ? row.key.slice(prefix.length + 1) : undefined;
}
export function SalesTimeline({ requestState, permissions, dispatchAction, onRetry }) {
    const [announcement, setAnnouncement] = useState("");
    const pagination = useSalesRoutePagination();
    const allowed = (permission) => permissions === undefined || permissions.includes(permission);
    const run = async (action, row, label, prefix) => {
        const id = timelineEntryId(row, prefix);
        const revision = Number(cellText(row.values.revision));
        if (dispatchAction === undefined || id === undefined || !Number.isSafeInteger(revision))
            return;
        try {
            await dispatchAction({ action, input: { id, expectedRevision: revision }, nodeId: `sales-fixed-timeline-${row.key}` });
            setAnnouncement(`${label} completed.`);
        }
        catch {
            setAnnouncement(`${label} failed. Refresh record and try again.`);
        }
    };
    const render = (data) => {
        const tasks = data.rows.filter((row) => cellText(row.values.kind) === "task");
        const events = data.rows.filter((row) => cellText(row.values.kind) !== "task");
        const eventItems = events.map((row) => {
            const kind = cellText(row.values.kind);
            const subject = cellText(row.values.subject);
            const status = cellText(row.values.status);
            const activityId = timelineEntryId(row, "activity");
            const attachmentId = timelineEntryId(row, "attachment");
            const activity = kind.startsWith("activity:") && status === "scheduled" && activityId !== undefined;
            const attachment = kind === "attachment" && status === "active" && attachmentId !== undefined;
            const canComplete = activity && allowed(salesActivityCompleteDescriptor.permission);
            const canCancel = activity && allowed(salesActivityCancelDescriptor.permission);
            const canRemove = attachment && allowed(salesAttachmentRemoveDescriptor.permission);
            const controls = dispatchAction === undefined || !canComplete && !canCancel && !canRemove ? null : _jsxs("span", { role: "group", "aria-label": `Actions for ${subject}`, children: [canComplete ? _jsxs("button", { type: "button", "data-action-id": salesActivityCompleteDescriptor.id, "data-record-id": activityId, onClick: () => run(salesActivityCompleteDescriptor, row, `Complete ${subject}`, "activity"), children: ["Complete ", subject] }) : null, canCancel ? _jsxs("button", { type: "button", "data-action-id": salesActivityCancelDescriptor.id, "data-record-id": activityId, onClick: () => run(salesActivityCancelDescriptor, row, `Cancel ${subject}`, "activity"), children: ["Cancel ", subject] }) : null, canRemove ? _jsxs("button", { type: "button", "data-action-id": salesAttachmentRemoveDescriptor.id, "data-record-id": attachmentId, onClick: () => run(salesAttachmentRemoveDescriptor, row, `Remove ${subject}`, "attachment"), children: ["Remove ", subject] }) : null] });
            const body = cellText(row.values.body);
            return { id: row.key, label: `${kind}: ${subject}`, value: _jsxs(_Fragment, { children: [[status, cellText(row.values["occurred-at"]), ...(body === "—" ? [] : [body])].join(" · "), controls] }) };
        });
        return _jsxs(_Fragment, { children: [_jsx(Section, { label: "Timeline", children: eventItems.length === 0 ? _jsx("p", { role: "status", children: "No timeline entries." }) : _jsx(DataList, { label: "Activity, notes, and attachments", items: eventItems }) }), allowed("sales.tasks.read") ? _jsx(Section, { label: "Tasks and reminders", children: tasks.length === 0 ? _jsx("p", { role: "status", children: "No tasks or reminders." }) : _jsx(DataList, { label: "Related tasks and reminders", items: tasks.map((row) => ({ id: row.key, label: cellText(row.values.subject), value: `${cellText(row.values.status)} · ${cellText(row.values["occurred-at"])}` })) }) }) : null, pagination === undefined || data.page.number <= 1 && !data.page.hasNext ? null : _jsx(PaginationControl, { page: data.page.number, hasNext: data.page.hasNext, onPageChange: pagination.onTimelinePageChange }), _jsx("p", { role: "status", "aria-live": "polite", children: announcement })] });
    };
    if (requestState.state === "stale")
        return _jsx(StaleState, { ...(onRetry === undefined ? {} : { onRetry }), children: render(requestState.data) });
    if (requestState.state === "refetching")
        return _jsxs("section", { "aria-label": "Refreshing timeline", "data-state": "refetching", children: [_jsx("p", { role: "status", children: "Refreshing\u2026" }), render(requestState.data)] });
    if (requestState.state === "insufficient-permission")
        return _jsx(_Fragment, {});
    return _jsx(QueryBoundary, { state: requestState, empty: "No timeline entries.", ...(onRetry === undefined ? {} : { onRetry }), children: render });
}
export function SalesCrmDetailPage(props) {
    const config = crmListConfig[props.kind];
    const title = `${config.title.slice(0, -1)} detail`;
    const fixed = useContext(fixedDetailContext());
    const resolved = { ...props, ...(props.timeline === undefined && fixed?.timeline !== undefined ? { timeline: fixed.timeline } : {}), ...(props.history === undefined && fixed?.history !== undefined ? { history: fixed.history } : {}) };
    if (fixed?.hostOwnsRouteChrome === true)
        return _jsx(_Fragment, { children: detailContent(resolved) });
    return _jsx(DetailPage, { templateId: `sales.page.${props.kind}-detail`, title: title, description: `Authorized ${props.kind} context and activity.`, breadcrumbs: crumbs(title, `${config.href}/${encodeURIComponent(props.recordId)}`), children: detailContent(resolved) });
}
export function createSalesTaskQuickCreateController(transport, idempotencyKey) {
    return createFormController({
        initialValues: { title: "" },
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
export function SalesOpportunityEditForm({ opportunity, opportunityOptions, onOpportunityChange, onOpportunitySubmit }) {
    return _jsxs(Form, { label: "Edit opportunity", pending: opportunity.submitting, onSubmit: onOpportunitySubmit, children: [_jsx(Select, { name: "id", label: "Opportunity", value: opportunity.values.id, options: opportunityOptions, disabled: opportunity.submitting, ...(opportunity.fieldErrors.id === undefined ? {} : { error: opportunity.fieldErrors.id }), onChange: (value) => onOpportunityChange("id", value) }), _jsx(TextInput, { name: "destinationStageId", label: "Destination stage ID", value: opportunity.values.destinationStageId, required: true, disabled: opportunity.submitting, ...(opportunity.fieldErrors.destinationStageId === undefined ? {} : { error: opportunity.fieldErrors.destinationStageId }), onChange: (value) => onOpportunityChange("destinationStageId", value) }), _jsx(FormActions, { children: _jsx(Button, { type: "submit", isDisabled: opportunity.submitting, children: "Save opportunity" }) })] });
}
const crumbs = (current, href) => [{ id: "sales", label: "Sales", href: "/sales" }, { id: "current", label: current, href, current: true }];
export function SalesOverviewPage() {
    return _jsx(DashboardPage, { templateId: salesOverviewPageTemplate.id, title: "Sales overview", description: "Current pipeline summary.", breadcrumbs: crumbs("Overview", "/sales"), children: _jsx(_Fragment, {}) });
}
export function SalesTasksPage({ requestState, viewState = createDataTableState(salesTasksTableDefinition), createTask, onViewStateChange, onCreateTaskChange, onCreateTask, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }) {
    return _jsx(IndexPage, { templateId: salesTaskPageTemplate.id, title: "Sales tasks", description: "Authorized tasks and follow-up work.", breadcrumbs: crumbs("Tasks", "/sales/tasks"), aside: _jsx(Card, { children: _jsxs(Form, { label: "Create task", pending: createTask.submitting, onSubmit: onCreateTask, children: [_jsx(TextInput, { name: "title", label: "Title", value: createTask.values.title, ...(createTask.fieldErrors.title === undefined ? {} : { error: createTask.fieldErrors.title }), required: true, onChange: (value) => onCreateTaskChange("title", value) }), _jsx(FormActions, { children: _jsx(Button, { type: "submit", isDisabled: createTask.submitting, children: "Create task" }) })] }) }), children: _jsx(DataTable, { definition: salesTasksTableDefinition, viewState: viewState, requestState: requestState, ...(onViewStateChange === undefined ? {} : { onViewStateChange }), ...(mutationExecutor === undefined ? {} : { mutationExecutor }), ...(actionAuthorization === undefined ? {} : { actionAuthorization }), ...(actionActorFingerprint === undefined ? {} : { actionActorFingerprint }), ...(actionContext === undefined ? {} : { actionContext }), ...(onActionResult === undefined ? {} : { onActionResult }), ...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated }), ...(onRefetch === undefined ? {} : { onRefetch }), ...(renderDetail === undefined ? {} : { renderDetail }), ...(onLoadMore === undefined ? {} : { onLoadMore }), ...(loadMoreLoading === undefined ? {} : { loadMoreLoading }) }) });
}
export function SalesOpportunitiesPage({ requestState, viewState, onViewStateChange, mutationExecutor, actionAuthorization, actionActorFingerprint, actionContext, onActionResult, onSourceInvalidated, onRefetch, renderDetail, onLoadMore, loadMoreLoading }) {
    const [localState, setLocalState] = useState(() => createDataTableState(salesOpportunitiesTableDefinition));
    return _jsx(IndexPage, { templateId: salesOpportunitiesPageTemplate.id, title: "Opportunities", description: "Authorized pipeline opportunities.", breadcrumbs: crumbs("Opportunities", "/sales/opportunities"), children: _jsx(DataTable, { mode: "grid", definition: salesOpportunitiesTableDefinition, viewState: viewState ?? localState, requestState: requestState, onViewStateChange: onViewStateChange ?? setLocalState, ...(mutationExecutor === undefined ? {} : { mutationExecutor }), ...(actionAuthorization === undefined ? {} : { actionAuthorization }), ...(actionActorFingerprint === undefined ? {} : { actionActorFingerprint }), ...(actionContext === undefined ? {} : { actionContext }), ...(onActionResult === undefined ? {} : { onActionResult }), ...(onSourceInvalidated === undefined ? {} : { onSourceInvalidated }), ...(onRefetch === undefined ? {} : { onRefetch }), renderDetail: renderDetail ?? ((row) => isSalesRecordId(row.key) ? _jsx("a", { href: `/sales/opportunities/${row.key}`, "aria-label": `Open opportunity ${row.key}`, children: "Open detail" }) : null), ...(onLoadMore === undefined ? {} : { onLoadMore }), ...(loadMoreLoading === undefined ? {} : { loadMoreLoading }) }) });
}
export function SalesSettingsPage({ settings }) {
    return _jsxs(SettingsPage, { templateId: salesSettingsPageTemplate.id, title: "Sales settings", description: "Workspace presentation settings.", breadcrumbs: crumbs("Settings", "/sales/settings"), children: [_jsx(Status, { tone: "positive", children: "Active" }), _jsx(KeyValueList, { label: "Sales settings", items: [
                    { id: "default-page", key: "Default page", value: settings.defaultPage },
                    { id: "page-size", key: "Task page size", value: String(settings.defaultTaskPageSize) },
                    { id: "revenue", key: "Potential revenue", value: settings.showPotentialRevenue ? "Visible" : "Hidden" }
                ] })] });
}
export function SalesImportsPage({ children }) {
    return _jsx(IndexPage, { templateId: "sales.page.imports", title: "Imports", description: "Validate, queue, and review controlled CRM imports.", breadcrumbs: crumbs("Imports", "/sales/imports"), children: children });
}
export function SalesExportsPage({ children }) {
    return _jsx(IndexPage, { templateId: "sales.page.exports", title: "Exports", description: "Create and retrieve authorized CRM export snapshots.", breadcrumbs: crumbs("Exports", "/sales/exports"), children: children });
}
export const salesDefaultPageContract = Object.freeze({
    templates: Object.freeze([salesOverviewPageTemplate.id, salesTaskPageTemplate.id, salesOpportunitiesPageTemplate.id, salesSettingsPageTemplate.id]),
    sourceQueries: Object.freeze([salesTasksQuery.source.id, salesOpportunitiesQuery.source.id]),
    actions: Object.freeze([salesCreateTaskMutation.action.id, salesUpdateTaskMutation.action.id, salesOpportunityStageMutation.action.id])
});
//# sourceMappingURL=pages.js.map