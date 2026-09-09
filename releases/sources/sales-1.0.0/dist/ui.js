import { createElement, useEffect, useRef, useState } from "react";
import { defineUiContributionBinding } from "@k-nex/ui-runtime";
import { Section, Status } from "@k-nex/ui-components";
import { DataList, DataTable, KeyValueList, Metric, PaginationControl, QueryBoundary, createDataTableState, defineDataTable } from "@k-nex/ui-data";
import { Form, FormActions, Select, TextInput } from "@k-nex/ui-forms";
import { salesAccountDetailDescriptor, salesAccountsDescriptor, salesContactDetailDescriptor, salesContactsDescriptor, salesDedupeCandidatesDescriptor, salesExportCancelDescriptor, salesExportCreateDescriptor, salesExportJobDetailDescriptor, salesExportJobListDescriptor, salesImportJobDetailDescriptor, salesImportJobListDescriptor, salesImportCancelDescriptor, salesImportCommitDescriptor, salesImportDryRunDescriptor, salesMergeCommitDescriptor, salesNotificationsDescriptor, salesProviderConfigurationsDescriptor, salesReportDescriptors, salesReportBlockId, salesReportRunDescriptor, salesReportScheduleDescriptor, salesRemindersDescriptor, salesNotificationReadDescriptor, salesNotificationArchiveDescriptor, salesReminderDismissDescriptor, salesReminderScheduleDescriptor, salesEmailSendDescriptor, salesCalendarSyncDescriptor, salesIntegrationConfigureDescriptor, salesLeadDetailDescriptor, salesLeadsDescriptor, salesOpportunityDetailDescriptor, salesRouteDescriptors, salesPageTemplates, salesUiBlockDescriptors, salesUiComponentDescriptors, salesOpportunityStageUpdateDescriptor, salesOwnershipAssignDescriptor, salesOpportunityKanbanBlockDescriptor, salesOpportunitiesDescriptor, salesPipelineArchiveDescriptor, salesPipelineSnapshotDescriptor, salesPipelineUpdateDescriptor, salesSavedViewArchiveDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewCreateDescriptor, salesSavedViewDetailDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor, salesSavedViewUpdateDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTaskTableBlockDescriptor, salesTaskTableComponentDescriptor, salesTasksDescriptor, salesTimelineDescriptor } from "./contracts.js";
import { SalesCrmDetailPage, salesAccountsTableDefinition, salesContactsTableDefinition, salesLeadsTableDefinition, salesOpportunitiesTableDefinition, salesTasksTableDefinition, useSalesRoutePagination } from "./pages.js";
import { salesSavedViewTableQuery, salesWorkflowMutations } from "./browser.js";
export { salesNavigationDescriptors, salesRouteDescriptors, salesTaskPageTemplate } from "./contracts.js";
function componentElement(component, props) {
    if (typeof component !== "function")
        throw new TypeError("K-Nex component definition is not executable.");
    return createElement(component, props);
}
const workflowFields = Object.freeze({
    "sales.account.create": ["name"], "sales.account.update": ["id", "expectedRevision", "name"], "sales.account.archive": ["id", "expectedRevision"],
    "sales.contact.create": ["accountId", "displayName", "email", "phone"], "sales.contact.update": ["id", "expectedRevision", "displayName", "emailMode", "email", "phoneMode", "phone"], "sales.contact.archive": ["id", "expectedRevision"],
    "sales.lead.create": ["displayName", "source", "email", "phone"], "sales.lead.update": ["id", "expectedRevision", "displayName", "source", "emailMode", "email", "phoneMode", "phone"],
    "sales.lead.qualify": ["id", "expectedRevision", "accountMode", "accountName", "accountId", "contactMode", "contactName", "contactId", "opportunityName", "pipelineId"], "sales.lead.disqualify": ["id", "expectedRevision"], "sales.lead.archive": ["id", "expectedRevision"],
    "sales.opportunity.create": ["name", "accountId", "pipelineId", "expectedPipelineRevision", "stageId", "expectedStageRevision", "primaryContactId", "amountValue", "amountCurrency", "amountScale", "expectedCloseDate"],
    "sales.opportunity.update": ["id", "expectedRevision", "name", "primaryContactMode", "primaryContactId", "amountMode", "amountValue", "amountCurrency", "amountScale", "expectedCloseDateMode", "expectedCloseDate"],
    "sales.opportunity.close": ["id", "expectedRevision", "expectedStage", "stage", "lossReason"], "sales.opportunity.archive": ["id", "expectedRevision"],
    "sales.activity.create": ["relatedRecordType", "relatedRecordId", "type", "subject", "scheduledAt", "supersedesActivityId"],
    "sales.activity.complete": ["id", "expectedRevision"], "sales.activity.cancel": ["id", "expectedRevision"],
    "sales.note.create": ["relatedRecordType", "relatedRecordId", "body", "replacesNoteId"],
    "sales.attachment.link": ["relatedRecordType", "relatedRecordId", "storageReference", "filename", "mediaType", "byteSize"],
    "sales.attachment.remove": ["id", "expectedRevision"],
    "sales.ownership.assign": ["recordType", "id", "expectedRevision", "ownerId", "teamId"]
});
const fieldLabels = Object.freeze({
    id: "Record ID", expectedRevision: "Expected revision", name: "Name", accountId: "Account ID", contactId: "Contact ID", displayName: "Display name", emailMode: "Email mode", email: "Email", phoneMode: "Phone mode", phone: "Phone", source: "Source",
    accountMode: "Account mode", accountName: "Account name", contactMode: "Contact mode", contactName: "Contact name", opportunityName: "Opportunity name", pipelineId: "Pipeline ID", expectedPipelineRevision: "Expected pipeline revision", stageId: "Stage ID", expectedStageRevision: "Expected stage revision", expectedStage: "Expected stage", stage: "Stage", lossReason: "Loss reason",
    primaryContactMode: "Primary contact mode", primaryContactId: "Primary contact ID", amountMode: "Amount mode", amountValue: "Amount", amountCurrency: "Currency", amountScale: "Amount scale", expectedCloseDateMode: "Expected close date mode", expectedCloseDate: "Expected close date",
    relatedRecordType: "Related record type", relatedRecordId: "Related record ID", type: "Activity type", subject: "Subject", scheduledAt: "Scheduled at", supersedesActivityId: "Supersedes activity ID",
    body: "Note", replacesNoteId: "Replaced note ID", storageReference: "Storage reference", filename: "Filename", mediaType: "Media type", byteSize: "Byte size",
    recordType: "Record type", ownerId: "Owner ID", teamId: "Team ID"
});
function sourceRecord(input) {
    return input.sourceResult !== undefined && "data" in input.sourceResult && input.sourceResult.data !== null && typeof input.sourceResult.data === "object" && Array.isArray(input.sourceResult.data.rows)
        ? input.sourceResult.data.rows[0] : undefined;
}
function isCanonicalUtcInstant(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
        return false;
    try {
        return new Date(value).toISOString() === value;
    }
    catch {
        return false;
    }
}
function initialWorkflowValues(input, actionId, fields) {
    const row = sourceRecord(input);
    const sourceId = input.node.bindings?.source?.source.id ?? input.node.type;
    const actionTarget = actionId.split(".")[1] ?? "";
    const sourceTarget = (sourceId.split(".")[1] ?? "").split("-")[0] ?? "";
    const targetMatchesSource = actionTarget === sourceTarget || actionTarget === "ownership" && ["account", "contact", "lead", "opportunity"].includes(sourceTarget) || (sourceId === salesTimelineDescriptor.id && ["activity", "attachment"].includes(actionTarget));
    const topLevelCreate = ["sales.account.create", "sales.contact.create", "sales.lead.create", "sales.opportunity.create"].includes(actionId) && !sourceId.endsWith(".detail");
    return Object.fromEntries(fields.map((field) => {
        if (actionId === "sales.lead.qualify" && (field === "accountMode" || field === "contactMode"))
            return [field, "create"];
        if (actionId === "sales.opportunity.update" && ["primaryContactMode", "amountMode", "expectedCloseDateMode"].includes(field))
            return [field, "retain"];
        if ((actionId === "sales.contact.update" || actionId === "sales.lead.update") && (field === "emailMode" || field === "phoneMode"))
            return [field, "retain"];
        if (topLevelCreate)
            return [field, ""];
        if (field === "recordType")
            return [field, ["account", "contact", "lead", "opportunity"].includes(sourceTarget) ? `sales.${sourceTarget}` : ""];
        if (field === "id")
            return [field, targetMatchesSource ? row?.key ?? "" : ""];
        if (field === "relatedRecordId")
            return [field, row?.key ?? ""];
        if (field === "relatedRecordType") {
            const kind = sourceId.startsWith("sales.account") ? "sales.account" : sourceId.startsWith("sales.contact") ? "sales.contact" : sourceId.startsWith("sales.lead") ? "sales.lead" : sourceId.startsWith("sales.opportunity") ? "sales.opportunity" : "";
            return [field, kind];
        }
        if (field === "expectedRevision")
            return [field, targetMatchesSource && cellText(row?.values.revision) !== "—" ? cellText(row?.values.revision) : ""];
        if (field === "expectedStage")
            return [field, targetMatchesSource && cellText(row?.values["stage-id"]) !== "—" ? cellText(row?.values["stage-id"]) : ""];
        if (actionId === "sales.opportunity.stage.update" && field === "stage") {
            const current = cellText(row?.values["stage-id"]);
            return [field, opportunityTransitionTarget[current] ?? ""];
        }
        const sourceField = field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const value = cellText(row?.values[sourceField]);
        return [field, value === "—" ? "" : value];
    }));
}
function nextStageOptions(value) {
    return value === undefined || value === "" ? [] : [{ id: value, label: value[0].toUpperCase() + value.slice(1) }];
}
function SalesWorkflowActionForm({ label, input }) {
    const actionId = input.action?.id;
    const projected = sourceRecord(input);
    const fields = actionId === undefined ? [] : (workflowFields[actionId] ?? []).filter((field) => {
        if (["amountMode", "amountValue", "amountCurrency", "amountScale"].includes(field) && !input.actor.permissions.has("sales.opportunities.amount.read"))
            return false;
        if (!["emailMode", "email", "phoneMode", "phone"].includes(field))
            return true;
        const permission = actionId.includes("contact") ? "sales.contacts.channels.read" : "sales.leads.channels.read";
        return input.actor.permissions.has(permission) && (field.endsWith("Mode") || actionId.endsWith(".create") || projected === undefined || projected.values[field] !== undefined);
    });
    const bindingRevision = `${actionId ?? ""}:${projected?.key ?? ""}:${cellText(projected?.values.revision)}`;
    const [values, setValues] = useState(() => initialWorkflowValues(input, actionId ?? "", fields));
    const [announcement, setAnnouncement] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const formRoot = useRef(null);
    useEffect(() => {
        setValues(initialWorkflowValues(input, actionId ?? "", fields));
        setFieldErrors({});
    }, [bindingRevision]);
    useEffect(() => { const first = Object.keys(fieldErrors)[0]; if (first !== undefined)
        formRoot.current?.querySelector(`[name="${first}"]`)?.focus(); }, [fieldErrors]);
    const optionalFields = ["email", "phone", "lossReason", "supersedesActivityId", "replacesNoteId", "teamId", "primaryContactId", "amountValue", "amountCurrency", "amountScale", "expectedCloseDate"];
    const visibleFields = actionId === "sales.opportunity.update" ? fields.filter((field) => {
        if (field === "primaryContactId")
            return values.primaryContactMode === "set";
        if (["amountValue", "amountCurrency", "amountScale"].includes(field))
            return values.amountMode === "set";
        if (field === "expectedCloseDate")
            return values.expectedCloseDateMode === "set";
        return true;
    }) : actionId === "sales.contact.update" || actionId === "sales.lead.update" ? fields.filter((field) => field === "email" ? values.emailMode === "set" : field === "phone" ? values.phoneMode === "set" : true)
        : actionId !== "sales.lead.qualify" ? fields : fields.filter((field) => {
            if (field === "accountName")
                return values.accountMode === "create";
            if (field === "accountId")
                return values.accountMode === "link";
            if (field === "contactName")
                return values.contactMode === "create";
            if (field === "contactId")
                return values.contactMode === "link";
            return true;
        });
    const enabled = actionId !== undefined && fields.length > 0 && input.dispatchAction !== undefined;
    const submit = async () => {
        if (!enabled || input.action === undefined || input.dispatchAction === undefined)
            return;
        if (actionId === "sales.activity.create" && !isCanonicalUtcInstant(values.scheduledAt ?? "")) {
            setFieldErrors({ scheduledAt: "Enter a canonical UTC instant, for example 2026-09-06T12:30:00.000Z." });
            setAnnouncement("Scheduled at is invalid.");
            return;
        }
        setFieldErrors({});
        const actionInput = Object.fromEntries(visibleFields.flatMap((field) => ["amountValue", "amountCurrency", "amountScale"].includes(field) || values[field] === "" && optionalFields.includes(field) ? [] : [[field, ["expectedRevision", "expectedPipelineRevision", "expectedStageRevision", "byteSize"].includes(field) ? Number(values[field]) : values[field]]]));
        if (actionId === "sales.opportunity.update" && !input.actor.permissions.has("sales.opportunities.amount.read"))
            Object.assign(actionInput, { amountMode: "retain" });
        if ((actionId === "sales.contact.update" || actionId === "sales.lead.update") && !input.actor.permissions.has(actionId === "sales.contact.update" ? "sales.contacts.channels.read" : "sales.leads.channels.read"))
            Object.assign(actionInput, { emailMode: "retain", phoneMode: "retain" });
        if (actionId === "sales.opportunity.create" && typeof values.amountValue === "string" && values.amountValue.length > 0 || actionId === "sales.opportunity.update" && values.amountMode === "set")
            Object.assign(actionInput, { amount: { kind: "money", value: values.amountValue, currency: values.amountCurrency, scale: Number(values.amountScale) } });
        try {
            await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
            setAnnouncement(`${label} completed.`);
        }
        catch {
            setAnnouncement(`${label} failed. Refresh record and try again.`);
        }
    };
    return createElement("div", { ref: formRoot }, createElement(Form, {
        label, onSubmit: submit,
        children: [
            ...visibleFields.map((field) => field === "accountMode" || field === "contactMode"
                ? createElement(Select, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "", required: true, options: [{ id: "create", label: "Create new" }, ...(field === "contactMode" && values.accountMode === "create" ? [] : [{ id: "link", label: "Link existing" }])], onChange: (value) => { setValues((current) => ({ ...current, [field]: value, ...(field === "accountMode" && value === "create" ? { contactMode: "create" } : {}) })); setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== field))); } })
                : (actionId === "sales.opportunity.update" && ["primaryContactMode", "amountMode", "expectedCloseDateMode"].includes(field) || (actionId === "sales.contact.update" || actionId === "sales.lead.update") && (field === "emailMode" || field === "phoneMode"))
                    ? createElement(Select, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "retain", required: true, options: ["retain", "set", "clear"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })), onChange: (value) => setValues((current) => ({ ...current, [field]: value })) })
                    : actionId === "sales.opportunity.stage.update" && field === "stage"
                        ? createElement(Select, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "", required: true, options: nextStageOptions(values.stage), onChange: (value) => setValues((current) => ({ ...current, stage: value })) })
                        : createElement(TextInput, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "", required: !optionalFields.includes(field) || actionId === "sales.opportunity.update" && ["primaryContactId", "amountValue", "amountCurrency", "amountScale", "expectedCloseDate"].includes(field), ...(fieldErrors[field] === undefined ? {} : { error: fieldErrors[field] }), onChange: (value) => { setValues((current) => ({ ...current, [field]: value })); setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== field))); } })),
            createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: !enabled }, label) }),
            createElement("p", { key: "announcement", role: "status", "aria-live": "polite" }, announcement)
        ]
    }));
}
function SalesTaskActionForm({ label, enabled, onSubmit }) {
    const [title, setTitle] = useState("");
    return createElement(Form, {
        label,
        onSubmit: () => enabled && title.trim().length > 0 ? onSubmit({ title }) : undefined,
        children: [
            createElement(TextInput, { key: "title", name: "title", label: "Title", value: title, required: true, onChange: setTitle }),
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
    if (id === "sales.calendar")
        return "calendar";
    if (["sales.report.weighted-forecast", "sales.report.won-lost-conversion", "sales.report.lead-conversion", "sales.report.sales-cycle-duration"].map(salesReportBlockId).includes(id))
        return "metric";
    if (["sales.report.pipeline-value-by-stage", "sales.report.activity-by-owner-team", "sales.report.task-aging"].map(salesReportBlockId).includes(id))
        return "data-list";
    if (id.includes("kanban"))
        return "kanban";
    if (id.includes("revenue"))
        return "metric";
    if (id.includes("quick-create"))
        return "form";
    if (id.includes("create") || id.includes("update") || id.includes("archive") || id.includes("qualify") || id.includes("disqualify") || id.includes("close"))
        return "form";
    if (id.includes("account-detail") || id.includes("contact-detail") || id.includes("lead-detail") || id.includes(".detail."))
        return "detail";
    if (id.includes("account-list") || id.includes("contact-list") || id.includes("lead-list") || id.includes(".list.accounts") || id.includes(".list.contacts") || id.includes(".list.leads"))
        return "data-table";
    if (id.includes("opportunity-list") || id === "sales.list.opportunities")
        return "data-table";
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
function tableDefinition(input) {
    const sourceId = input.node.bindings?.source?.source.id;
    if (sourceId === salesAccountsDescriptor.id || sourceId === salesAccountDetailDescriptor.id)
        return salesAccountsTableDefinition;
    if (sourceId === salesContactsDescriptor.id || sourceId === salesContactDetailDescriptor.id)
        return salesContactsTableDefinition;
    if (sourceId === salesLeadsDescriptor.id || sourceId === salesLeadDetailDescriptor.id)
        return salesLeadsTableDefinition;
    return salesOpportunitiesTableDefinition;
}
function detailHref(input, rowKey) {
    const sourceId = input.node.bindings?.source?.source.id ?? "";
    const segment = sourceId === salesAccountsDescriptor.id ? "accounts" : sourceId === salesContactsDescriptor.id ? "contacts" : sourceId === salesLeadsDescriptor.id ? "leads" : sourceId === salesOpportunitiesDescriptor.id ? "opportunities" : undefined;
    return segment === undefined ? undefined : `/sales/${segment}/${encodeURIComponent(rowKey)}`;
}
function detailKind(input) {
    const sourceId = input.node.bindings?.source?.source.id;
    return sourceId === salesAccountDetailDescriptor.id ? "account" : sourceId === salesContactDetailDescriptor.id ? "contact"
        : sourceId === salesLeadDetailDescriptor.id ? "lead" : sourceId === salesOpportunityDetailDescriptor.id ? "opportunity" : undefined;
}
function actionLabel(actionId) {
    return actionId === undefined ? "Update record" : actionId.split(".").slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
function SalesCrmDataGrid({ input, title }) {
    const definition = tableDefinition(input);
    const pagination = useSalesRoutePagination();
    const [localViewState, setLocalViewState] = useState(() => createDataTableState(definition));
    const viewState = pagination === undefined ? localViewState : { ...localViewState, pagination: { mode: "offset", page: pagination.listPage, size: 25 } };
    const setViewState = (next) => {
        setLocalViewState(next);
        const currentPage = viewState.pagination.mode === "offset" ? viewState.pagination.page : 1;
        if (next.pagination.mode === "offset" && next.pagination.page !== currentPage)
            pagination?.onListPageChange(next.pagination.page);
    };
    return createElement(DataTable, {
        definition, viewState, onViewStateChange: setViewState, requestState: dataTableRequestState(input.sourceResult), label: title, mode: "grid",
        renderDetail: (row) => {
            const href = detailHref(input, row.key);
            return href === undefined ? null : createElement("a", { href, "aria-label": `Open ${title.toLowerCase()} record ${row.key}` }, "Open detail");
        }
    });
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
    if (value === null || value === undefined)
        return "—";
    if (typeof value !== "object")
        return String(value);
    if ("value" in value)
        return value.value === null || value.value === undefined ? "—" : String(value.value);
    if ("label" in value)
        return value.label === null || value.label === undefined ? "—" : String(value.label);
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
function recipientDeliveryRows(input) {
    const result = input.sourceResult;
    if (result?.state !== "success" && result?.state !== "stale" && result?.state !== "refetching")
        return [];
    return tableRecordShape(result.data) ? result.data.rows : [];
}
function recipientActionLabel(actionId) {
    return actionId === salesNotificationReadDescriptor.id ? "Read notification"
        : actionId === salesNotificationArchiveDescriptor.id ? "Archive notification"
            : actionId === salesReminderDismissDescriptor.id ? "Dismiss reminder" : undefined;
}
function recipientActionPermission(actionId) {
    return actionId === salesNotificationReadDescriptor.id ? salesNotificationReadDescriptor.permission
        : actionId === salesNotificationArchiveDescriptor.id ? salesNotificationArchiveDescriptor.permission
            : actionId === salesReminderDismissDescriptor.id ? salesReminderDismissDescriptor.permission : undefined;
}
function recipientActionAvailable(actionId, state) {
    return actionId === salesNotificationReadDescriptor.id ? state === "unread"
        : actionId === salesNotificationArchiveDescriptor.id ? state === "unread" || state === "read"
            : actionId === salesReminderDismissDescriptor.id && (state === "scheduled" || state === "delivered");
}
function SalesCommunicationActionForm({ input, title }) {
    const actionId = input.action?.id;
    const [values, setValues] = useState({ providerId: actionId === "sales.email.send" ? "email.reference.v1" : "calendar.reference.v1", relatedRecordType: "sales.contact", referenceKind: "task", operation: "activate" });
    const [notice, setNotice] = useState("");
    const field = (name, label, required = true) => createElement(TextInput, { key: name, name, label, value: values[name] ?? "", required, onChange: (value) => setValues((current) => ({ ...current, [name]: value })) });
    const select = (name, label, options) => createElement(Select, { key: name, name, label, value: values[name] ?? options[0].id, required: true, options, onChange: (value) => setValues((current) => ({ ...current, [name]: value })) });
    const fields = actionId === "sales.email.send" ? [select("relatedRecordType", "Recipient record type", [{ id: "sales.contact", label: "Contact" }, { id: "sales.lead", label: "Lead" }]), field("relatedRecordId", "Recipient record ID"), field("subject", "Subject"), field("body", "Message")]
        : actionId === "sales.calendar.sync" ? [field("activityId", "Activity ID"), field("expectedRevision", "Expected revision")]
            : actionId === "sales.integration.configure" ? [select("providerId", "Provider", [{ id: "email.reference.v1", label: "Email reference" }, { id: "calendar.reference.v1", label: "Calendar reference" }]), field("expectedRevision", "Expected revision"), select("operation", "Operation", [{ id: "activate", label: "Activate" }, { id: "revoke", label: "Revoke" }])]
                : actionId === "sales.reminder.schedule" ? [select("referenceKind", "Reference kind", [{ id: "task", label: "Task" }, { id: "activity", label: "Activity" }]), field("referenceId", "Reference ID"), field("expectedRevision", "Expected revision"), field("scheduledAt", "Scheduled at UTC"), field("subject", "Subject")]
                    : [];
    const submit = async () => {
        if (input.action === undefined || input.dispatchAction === undefined || fields.length === 0)
            return;
        const actionInput = actionId === "sales.email.send" ? { providerId: "email.reference.v1", relatedRecordType: values.relatedRecordType, relatedRecordId: values.relatedRecordId, subject: values.subject, body: values.body }
            : actionId === "sales.calendar.sync" ? { providerId: "calendar.reference.v1", activityId: values.activityId, expectedRevision: Number(values.expectedRevision) }
                : actionId === "sales.reminder.schedule" ? { referenceKind: values.referenceKind, referenceId: values.referenceId, expectedRevision: Number(values.expectedRevision), scheduledAt: values.scheduledAt, subject: values.subject }
                    : { providerId: values.providerId, expectedRevision: Number(values.expectedRevision), operation: values.operation };
        try {
            await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
            setNotice(`${title} completed.`);
        }
        catch {
            setNotice(`${title} failed. Check values and current authority.`);
        }
    };
    return createElement(Form, { label: title, onSubmit: submit, children: [...fields, createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: input.action === undefined || input.dispatchAction === undefined }, actionLabel(actionId)) }), createElement("p", { key: "notice", role: "status", "aria-live": "polite" }, notice)] });
}
/** Static report actions expose only frozen IDs and weekly schedule fields; no query or recipient address can enter the browser contract. */
function SalesReportActionForm({ input, title }) {
    const actionId = input.action?.id;
    const reportId = input.node.bindings?.source?.source.id;
    const windowed = reportId === "sales.report.won-lost-conversion" || reportId === "sales.report.lead-conversion" || reportId === "sales.report.activity-by-owner-team" || reportId === "sales.report.sales-cycle-duration";
    const [values, setValues] = useState({ windowMode: windowed ? "current-reporting-week" : "as-of", recipientId: "", expectedRevision: "0", weekday: "1", localTime: "09:00" });
    const [notice, setNotice] = useState("");
    const field = (name, label) => createElement(TextInput, { key: name, name, label, value: values[name] ?? "", required: true, onChange: (value) => setValues((current) => ({ ...current, [name]: value })) });
    const submit = async () => {
        if (input.action === undefined || input.dispatchAction === undefined || reportId === undefined)
            return;
        const base = { reportId, windowMode: values.windowMode };
        const actionInput = actionId === salesReportRunDescriptor.id ? base : { operation: "upsert", ...base, recipientId: values.recipientId, expectedRevision: Number(values.expectedRevision), weekday: Number(values.weekday), localTime: values.localTime };
        try {
            await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
            setNotice(`${title} queued.`);
        }
        catch {
            setNotice(`${title} failed. Check current authority and schedule values.`);
        }
    };
    const fields = [windowed ? createElement(Select, { key: "window", name: "windowMode", label: "Reporting window", value: values.windowMode ?? "current-reporting-week", required: true, options: [{ id: "current-reporting-week", label: "Current reporting week" }, { id: "previous-complete-reporting-week", label: "Previous reporting week" }, { id: "current-reporting-month", label: "Current reporting month" }, { id: "previous-complete-reporting-month", label: "Previous reporting month" }], onChange: (value) => setValues((current) => ({ ...current, windowMode: value })) }) : null];
    if (actionId === salesReportScheduleDescriptor.id)
        fields.push(field("recipientId", "Recipient user ID"), field("expectedRevision", "Expected revision"), field("weekday", "Weekday (1-7)"), field("localTime", "Local time (HH:MM)"));
    return createElement(Form, { label: title, onSubmit: submit, children: [...fields, createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: input.action === undefined || input.dispatchAction === undefined || reportId === undefined }, actionId === salesReportScheduleDescriptor.id ? "Schedule weekly report" : "Export report") }), createElement("p", { key: "notice", role: "status", "aria-live": "polite" }, notice)] });
}
/** Fixed recipient delivery controls preserve source row CAS identity; server enforces recipient scope. */
function SalesRecipientDeliveryBlock({ input, title }) {
    if (input.action?.id === salesReminderScheduleDescriptor.id)
        return componentElement(SalesCommunicationActionForm, { input, title });
    const [announcement, setAnnouncement] = useState("");
    const action = input.action;
    const label = action === undefined ? undefined : recipientActionLabel(action.id);
    const permission = action === undefined ? undefined : recipientActionPermission(action.id);
    const permitted = permission !== undefined && input.actor.permissions.has(permission);
    const run = async (row) => {
        const revision = Number(cellText(row.values.revision));
        const rowLabel = action?.id === salesReminderDismissDescriptor.id && cellText(row.values.state) === "scheduled" ? "Cancel reminder" : label;
        if (action === undefined || label === undefined || input.dispatchAction === undefined || !/^[1-9][0-9]*$/u.test(row.key) || !positiveSafeInteger(revision))
            return;
        try {
            await input.dispatchAction({ action, input: { id: row.key, expectedRevision: revision }, nodeId: input.node.id });
            setAnnouncement(`${rowLabel} completed.`);
        }
        catch {
            setAnnouncement(`${rowLabel} failed. Refresh and try again.`);
        }
    };
    const rows = recipientDeliveryRows(input);
    const sourceState = input.sourceResult?.state;
    if (sourceState === "insufficient-permission")
        return createElement("section", { "aria-label": title }, createElement("p", { role: "alert", "data-state": "forbidden" }, "Recipient delivery records are unavailable."));
    if (sourceState === "error" || sourceState === "invalid-contract")
        return createElement("section", { "aria-label": title }, createElement("p", { role: "alert" }, "Recipient delivery records are unavailable."));
    return createElement("section", { "aria-label": title, "data-k-nex-component": "sales-recipient-delivery" }, [
        createElement("ul", { key: "rows", "aria-label": title }, rows.length === 0 ? createElement("li", {}, "No delivery records.") : rows.map((row) => {
            const subject = cellText(row.values.subject);
            const state = cellText(row.values.state);
            const revision = Number(cellText(row.values.revision));
            const enabled = label !== undefined && permitted && input.dispatchAction !== undefined && /^[1-9][0-9]*$/u.test(row.key) && positiveSafeInteger(revision) && recipientActionAvailable(action?.id ?? "", state);
            const rowLabel = action?.id === salesReminderDismissDescriptor.id && state === "scheduled" ? "Cancel reminder" : label;
            return createElement("li", { key: row.key }, [createElement("span", { key: "subject" }, `${subject} (${state})`), enabled ? createElement("button", { key: "action", type: "button", "data-action-id": action.id, "data-record-id": row.key, onClick: () => void run(row) }, rowLabel) : null]);
        })),
        createElement("p", { key: "announcement", role: "status", "aria-live": "polite" }, announcement)
    ]);
}
function queryElement(kind, input, title) {
    const children = (value) => {
        if (kind === "metric")
            return componentElement(Metric, { label: title, metric: value });
        if (kind === "data-list")
            return componentElement(DataList, { label: title, items: tableItems(value, value.fields) });
        const table = value;
        const record = table.rows[0];
        return componentElement(Section, { label: title, children: componentElement(KeyValueList, { label: title, items: record === undefined ? [] : table.fields.filter((field) => record.values[field] !== undefined).map((field) => ({ id: field, key: field.replaceAll("-", " "), value: cellText(record.values[field]) })) }) });
    };
    const boundary = componentElement(QueryBoundary, { state: queryRequestState(input.sourceResult), children });
    if (input.sourceResult?.state === "stale")
        return createElement("section", { "aria-label": `${title} stale data`, "data-state": "stale" }, createElement("p", { role: "status" }, "Showing stale data."), boundary);
    if (input.sourceResult?.state === "refetching")
        return createElement("section", { "aria-label": `${title} refreshing`, "data-state": "refetching" }, createElement("p", { role: "status" }, "Refreshing…"), boundary);
    return boundary;
}
const opportunityStages = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
const opportunityTransitionTarget = Object.freeze({ qualification: ["discovery", "lost"], discovery: ["proposal", "lost"], proposal: ["negotiation", "lost"], negotiation: ["won", "lost"] });
function positiveSafeInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function tableRecordShape(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const table = value;
    return Array.isArray(table.fields) && table.fields.every((field) => typeof field === "string") && Array.isArray(table.rows) && table.rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row) && typeof row.key === "string" && row.values !== null && typeof row.values === "object" && !Array.isArray(row.values)) && table.page !== null && typeof table.page === "object" && !Array.isArray(table.page) && typeof table.page.hasNext === "boolean";
}
function stageMetadata(row) {
    if (!/^stage:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(row.key))
        return undefined;
    if (Object.keys(row.values).sort().join("\0") !== "name\0revision\0row-kind\0stage-id\0stage-metadata" || row.values.revision !== null || !taggedCellValue(row.values["row-kind"], "enum", "stage") || !taggedCellValue(row.values.name, "text") || !taggedCellValue(row.values["stage-id"], "enum") || !taggedCellValue(row.values["stage-metadata"], "text"))
        return undefined;
    const raw = cellText(row.values["stage-metadata"]);
    if (raw === "—" || utf8Length(raw) > 512)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || JSON.stringify(parsed) !== raw)
            return undefined;
        const value = parsed;
        if (Object.keys(value).join("\u0000") !== "pipelineId\u0000pipelineRevision\u0000stageName\u0000stageRevision\u0000stageSemantic")
            return undefined;
        if (!positiveSafeInteger(value.pipelineId) || !positiveSafeInteger(value.pipelineRevision) || !positiveSafeInteger(value.stageRevision) || typeof value.stageName !== "string" || utf8Length(value.stageName) < 1 || utf8Length(value.stageName) > 120 || value.stageName !== cellText(row.values.name) || !opportunityStages.includes(value.stageSemantic))
            return undefined;
        const id = row.key.slice("stage:".length);
        return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id) && cellText(row.values["stage-id"]) === id && cellText(row.values["row-kind"]) === "stage" ? { id, pipelineId: value.pipelineId, pipelineRevision: value.pipelineRevision, stageRevision: value.stageRevision, stageName: value.stageName, stageSemantic: value.stageSemantic } : undefined;
    }
    catch {
        return undefined;
    }
}
function taggedCellValue(value, kind, exactValue) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === "kind\0value" && value.kind === kind && (exactValue === undefined || value.value === exactValue);
}
function positiveOpportunityKey(key) {
    const match = /^opportunity:([1-9][0-9]*)$/u.exec(key);
    if (match === null)
        return undefined;
    const id = Number(match[1]);
    return positiveSafeInteger(id) && String(id) === match[1] ? match[1] : undefined;
}
function pageResult(input) {
    const data = input.sourceResult?.state === "success" || input.sourceResult?.state === "stale" || input.sourceResult?.state === "refetching" ? input.sourceResult.data : undefined;
    return data !== null && typeof data === "object" && "page" in data ? data.page : undefined;
}
function requestWorkspacePage(input, pagination, page) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
        return;
    if (pagination !== undefined) {
        pagination.onListPageChange(page);
        return;
    }
    if (typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("k-nex:sales-page-change", { bubbles: true, detail: { nodeId: input.node.id, page } }));
}
function SalesOpportunityKanban({ table, title, input }) {
    const [announcement, setAnnouncement] = useState("");
    const pagination = useSalesRoutePagination();
    const density = presentation(input).density ?? "comfortable";
    const stageRows = table.rows.slice(0, 6).map(stageMetadata);
    const cards = table.rows.slice(6);
    const validPage = Number.isSafeInteger(table.page.number) && table.page.number >= 1 && table.page.number <= 1_000_000 && Number.isSafeInteger(table.page.pageSize) && table.page.pageSize >= 7 && table.page.pageSize <= 100 && table.rows.length <= table.page.pageSize;
    const validCards = cards.every((row) => positiveOpportunityKey(row.key) !== undefined && Object.keys(row.values).sort().join("\0") === "name\0revision\0row-kind\0stage-id\0stage-metadata" && taggedCellValue(row.values["row-kind"], "enum", "opportunity") && taggedCellValue(row.values.name, "text") && utf8Length(cellText(row.values.name)) >= 1 && utf8Length(cellText(row.values.name)) <= 256 && taggedCellValue(row.values["stage-id"], "enum") && uuidV5.test(cellText(row.values["stage-id"])) && row.values["stage-metadata"] === null && taggedCellValue(row.values.revision, "integer") && positiveSafeInteger(Number(cellText(row.values.revision))) && stageRows.some((stage) => stage?.id === cellText(row.values["stage-id"])));
    const stageSemantics = stageRows.map((stage) => stage?.stageSemantic);
    // The first four positions are customer-configurable, but their membership
    // and the terminal positions are immutable.  The row order is the pipeline
    // order supplied by the source, never a UI sort.
    const validStageOrder = stageSemantics.slice(0, 4).every((semantic) => semantic === "qualification" || semantic === "discovery" || semantic === "proposal" || semantic === "negotiation") && new Set(stageSemantics.slice(0, 4)).size === 4 && stageSemantics[4] === "won" && stageSemantics[5] === "lost";
    const validStages = table.fields.join("\0") === "row-kind\0name\0stage-id\0stage-metadata\0revision" && table.rows.length >= 6 && validPage && stageRows.length === 6 && stageRows.every((stage) => stage !== undefined) && validStageOrder && new Set(stageRows.map((stage) => stage.id)).size === 6 && new Set(stageRows.map((stage) => `${stage.pipelineId}:${stage.pipelineRevision}`)).size === 1 && new Set(cards.map(({ key }) => key)).size === cards.length && validCards;
    const stages = validStages ? stageRows : [];
    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const move = async (row, destination) => {
        const id = positiveOpportunityKey(row.key) ?? "";
        const expectedRevision = Number(cellText(row.values.revision));
        const source = stageById.get(cellText(row.values["stage-id"]));
        if (input.action === undefined || input.dispatchAction === undefined || id.length === 0 || !positiveSafeInteger(expectedRevision) || source === undefined)
            return;
        try {
            await input.dispatchAction({ action: input.action, input: { id, expectedRevision, expectedPipelineId: String(source.pipelineId), expectedPipelineRevision: source.pipelineRevision, expectedSourceStageId: source.id, expectedSourceStageRevision: source.stageRevision, destinationStageId: destination.id, expectedDestinationStageRevision: destination.stageRevision }, nodeId: input.node.id });
            setAnnouncement(`${cellText(row.values.name)} moved to ${destination.stageName}.`);
        }
        catch {
            setAnnouncement(`${cellText(row.values.name)} was not moved. Refresh and try again.`);
        }
    };
    const destinationsFor = (row) => {
        const source = stageById.get(cellText(row.values["stage-id"]));
        if (source === undefined || source.stageSemantic === "won" || source.stageSemantic === "lost")
            return [];
        return opportunityTransitionTarget[source.stageSemantic].map((semantic) => stages.find((candidate) => candidate.stageSemantic === semantic)).filter((candidate) => candidate !== undefined);
    };
    if (!validStages)
        return createElement("section", { "aria-label": title, "data-k-nex-component": "sales-opportunity-kanban", "data-state": "invalid-contract" }, createElement("p", { role: "alert" }, "Pipeline data is unavailable. Refresh and try again."));
    return createElement("section", { "aria-label": title, "data-k-nex-component": "sales-opportunity-kanban", "data-density": density }, [
        createElement("h2", { key: "title" }, title),
        createElement("div", { key: "columns", "data-slot": "kanban-columns" }, stages.map((stage) => createElement("section", { key: stage.id, "aria-label": `${stage.stageName} opportunities`, onDragOver: (event) => event.preventDefault(), onDrop: (event) => { event.preventDefault(); const row = cards.find((candidate) => candidate.key === event.dataTransfer.getData("text/plain")); if (row !== undefined && destinationsFor(row).some(({ id }) => id === stage.id))
                void move(row, stage); } }, [
            createElement("h3", { key: "heading" }, stage.stageName),
            createElement("ul", { key: "cards" }, cards.filter((row) => cellText(row.values["stage-id"]) === stage.id).map((row) => {
                const name = cellText(row.values.name);
                const destinations = destinationsFor(row);
                return createElement("li", { key: row.key, "data-opportunity-id": row.key, draggable: true, onDragStart: (event) => event.dataTransfer.setData("text/plain", row.key) }, [
                    createElement("strong", { key: "name" }, name),
                    density === "compact" ? null : createElement("span", { key: "stage", "data-slot": "kanban-card-stage" }, stage.stageName),
                    input.action === undefined || input.dispatchAction === undefined ? null : createElement("div", { key: "moves", "aria-label": `Move ${name}` }, destinations.map((destination) => createElement("button", { key: destination.id, type: "button", onClick: () => void move(row, destination) }, `Move to ${destination.stageName}`)))
                ]);
            }))
        ]))),
        validPage && (table.page.number > 1 || table.page.hasNext) ? componentElement(PaginationControl, { key: "pagination", page: table.page.number, hasNext: table.page.hasNext, onPageChange: (page) => requestWorkspacePage(input, pagination, page) }) : null,
        createElement("p", { key: "announcement", role: "status", "aria-live": "polite" }, announcement)
    ]);
}
function kanbanElement(input, title) {
    return componentElement(QueryBoundary, {
        state: queryRequestState(input.sourceResult),
        children: (value) => tableRecordShape(value) ? componentElement(SalesOpportunityKanban, { table: value, title, input }) : createElement("section", { "aria-label": title, "data-k-nex-component": "sales-opportunity-kanban", "data-state": "invalid-contract" }, createElement("p", { role: "alert" }, "Pipeline data is unavailable. Refresh and try again."))
    });
}
const pipelineFields = ["pipeline-id", "pipeline-revision", "pipeline-name", "stage-id", "stage-revision", "semantic", "stage-name", "position", "probability-basis-points", "allowed-transition-stage-ids", "required-field-ids", "status"];
const pipelineSemantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
const trustedTransitions = Object.freeze({ qualification: ["discovery", "lost"], discovery: ["proposal", "lost"], proposal: ["negotiation", "lost"], negotiation: ["won", "lost"], won: [], lost: [] });
const uuidV5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const pipelineStageNamespace = "13f5fa89-b465-5a7a-a19d-74ed6c5d1ef4";
function canonicalStringArray(value) {
    const raw = cellText(value);
    if (raw === "—" || utf8Length(raw) > 512)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") && new Set(parsed).size === parsed.length && JSON.stringify(parsed) === raw ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function utf8Length(value) { return new TextEncoder().encode(value).byteLength; }
function pipelineIdentity(input) {
    const value = input.node.pipelineIdentity;
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== "applicationId\0environment")
        return undefined;
    const identity = value;
    if (typeof identity.applicationId !== "string" || typeof identity.environment !== "string" || identity.applicationId.includes("\0") || identity.environment.includes("\0") || utf8Length(identity.applicationId.normalize("NFC")) < 1 || utf8Length(identity.applicationId.normalize("NFC")) > 128 || utf8Length(identity.environment.normalize("NFC")) < 1 || utf8Length(identity.environment.normalize("NFC")) > 64)
        return undefined;
    return Object.freeze({ applicationId: identity.applicationId.normalize("NFC"), environment: identity.environment.normalize("NFC") });
}
async function pipelineStageUuid(identity, pipelineId, semantic) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined || !positiveSafeInteger(pipelineId) || pipelineId > 2_147_483_647)
        return undefined;
    const namespace = new Uint8Array(pipelineStageNamespace.replaceAll("-", "").match(/../gu).map((pair) => Number.parseInt(pair, 16)));
    const name = ["phase13/pipeline-stage/v1", identity.applicationId, identity.environment, String(pipelineId), semantic].join("\0");
    const bytes = new Uint8Array(namespace.length + new TextEncoder().encode(name).length);
    bytes.set(namespace);
    bytes.set(new TextEncoder().encode(name), namespace.length);
    const digest = new Uint8Array(await subtle.digest("SHA-1", bytes));
    digest[6] = (digest[6] & 0x0f) | 0x50;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** The admin form must never turn a malformed snapshot into a partial update. */
function pipelineSnapshot(table) {
    if (!tableRecordShape(table))
        return undefined;
    const value = table;
    if (value.fields.join("\0") !== pipelineFields.join("\0") || value.rows.length !== 6 || value.page.number !== 1 || value.page.pageSize !== 6 || value.page.hasNext || value.rows.some((row) => Object.keys(row.values).sort().join("\0") !== [...pipelineFields].sort().join("\0")))
        return undefined;
    const first = value.rows[0];
    const id = Number(cellText(first?.values["pipeline-id"]));
    const revision = Number(cellText(first?.values["pipeline-revision"]));
    const name = cellText(first?.values["pipeline-name"]);
    if (!positiveSafeInteger(id) || !positiveSafeInteger(revision) || utf8Length(name.trim()) < 1 || utf8Length(name.trim()) > 120)
        return undefined;
    const stages = value.rows.map((row, index) => {
        const stageId = cellText(row.values["stage-id"]);
        const stageRevision = Number(cellText(row.values["stage-revision"]));
        const semantic = cellText(row.values.semantic);
        const stageName = cellText(row.values["stage-name"]);
        const position = Number(cellText(row.values.position));
        const probability = Number(cellText(row.values["probability-basis-points"]));
        const transitions = canonicalStringArray(row.values["allowed-transition-stage-ids"]);
        const required = canonicalStringArray(row.values["required-field-ids"]);
        if (row.key !== `stage:${stageId}` || !uuidV5.test(stageId) || !positiveSafeInteger(stageRevision) || !pipelineSemantics.includes(semantic) || utf8Length(stageName.trim()) < 1 || utf8Length(stageName.trim()) > 120 || position !== index || !Number.isSafeInteger(probability) || probability < 0 || probability > 10_000 || transitions === undefined || required === undefined || cellText(row.values["pipeline-id"]) !== String(id) || cellText(row.values["pipeline-revision"]) !== String(revision) || cellText(row.values["pipeline-name"]) !== name || cellText(row.values.status) !== "active")
            return undefined;
        return { id: stageId, revision: stageRevision, semantic: semantic, name: stageName, position, probability, transitions, required };
    });
    if (stages.some((stage) => stage === undefined))
        return undefined;
    const valid = stages;
    const stageIds = new Set(valid.map(({ id: stageId }) => stageId));
    const orderedSemantics = valid.map(({ semantic }) => semantic);
    const validOrder = orderedSemantics.slice(0, 4).every((semantic) => semantic === "qualification" || semantic === "discovery" || semantic === "proposal" || semantic === "negotiation") && new Set(orderedSemantics.slice(0, 4)).size === 4 && orderedSemantics[4] === "won" && orderedSemantics[5] === "lost";
    if (stageIds.size !== 6 || !validOrder || valid.some((stage) => stage.transitions.some((target) => !stageIds.has(target) || !trustedTransitions[stage.semantic].includes(valid.find((candidate) => candidate.id === target)?.semantic ?? "lost")) || JSON.stringify(stage.required) !== JSON.stringify(stage.semantic === "lost" ? ["lossReason"] : [])))
        return undefined;
    return { id, revision, name, stages: valid };
}
function SalesPipelineActionForm({ input, title }) {
    const [notice, setNotice] = useState("");
    const snapshot = input.sourceResult?.state === "success" ? pipelineSnapshot(input.sourceResult.data) : undefined;
    const snapshotKey = snapshot === undefined ? "invalid" : `${snapshot.id}:${snapshot.revision}:${snapshot.stages.map(({ id, semantic, position }) => `${id}:${semantic}:${position}`).join("|")}`;
    const identity = pipelineIdentity(input);
    const identityKey = identity === undefined ? "missing" : `${identity.applicationId}\0${identity.environment}`;
    const [deterministicIds, setDeterministicIds] = useState(false);
    const [names, setNames] = useState([]);
    const [probabilities, setProbabilities] = useState([]);
    const [transitions, setTransitions] = useState([]);
    useEffect(() => { if (snapshot !== undefined) {
        setNames(snapshot.stages.map(({ name }) => name));
        setProbabilities(snapshot.stages.map(({ probability }) => String(probability)));
        setTransitions(snapshot.stages.map(({ transitions: next }) => next));
    } }, [snapshotKey]);
    useEffect(() => { let active = true; setDeterministicIds(false); if (snapshot === undefined || identity === undefined)
        return () => { active = false; }; void Promise.all(snapshot.stages.map((stage) => pipelineStageUuid(identity, snapshot.id, stage.semantic))).then((ids) => { if (active)
        setDeterministicIds(ids.every((id, index) => id === snapshot.stages[index]?.id)); }).catch(() => { if (active)
        setDeterministicIds(false); }); return () => { active = false; }; }, [snapshotKey, identityKey]);
    const submit = async () => {
        if (input.action === undefined || input.dispatchAction === undefined || snapshot === undefined || !deterministicIds) {
            setNotice("Pipeline identity is unavailable or invalid. Refresh and try again.");
            return;
        }
        const stages = snapshot.stages.map((stage, index) => ({ stageId: stage.id, expectedRevision: stage.revision, semantic: stage.semantic, name: (names[index] ?? "").trim(), position: stage.position, probabilityBasisPoints: Number(probabilities[index]), allowedTransitionStageIds: transitions[index] ?? [], requiredFieldIds: stage.required }));
        if (stages.some((stage) => utf8Length(stage.name) < 1 || utf8Length(stage.name) > 120 || !Number.isSafeInteger(stage.probabilityBasisPoints) || stage.probabilityBasisPoints < 0 || stage.probabilityBasisPoints > 10_000)) {
            setNotice("Each stage needs a name and a probability from 0 to 10000.");
            return;
        }
        const actionInput = input.action.id === "sales.pipeline.archive" ? { id: snapshot.id, expectedRevision: snapshot.revision } : { id: snapshot.id, expectedRevision: snapshot.revision, name: snapshot.name, orderedStageIds: snapshot.stages.map(({ id }) => id), stages };
        try {
            await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
            setNotice(`${title} completed.`);
        }
        catch {
            setNotice(`${title} failed. Refresh and try again.`);
        }
    };
    const editable = input.action?.id !== "sales.pipeline.archive" && snapshot !== undefined;
    return createElement(Form, { label: title, onSubmit: submit, children: [editable ? snapshot.stages.map((stage, index) => createElement("fieldset", { key: stage.id }, [createElement("legend", { key: "legend" }, `${index + 1}. ${stage.semantic}`), createElement(TextInput, { key: "name", name: `stage-name-${index}`, label: "Stage name", value: names[index] ?? "", required: true, onChange: (next) => setNames((current) => current.map((item, itemIndex) => itemIndex === index ? next : item)) }), createElement(TextInput, { key: "probability", name: `stage-probability-${index}`, label: "Probability basis points", value: probabilities[index] ?? "", required: true, onChange: (next) => setProbabilities((current) => current.map((item, itemIndex) => itemIndex === index ? next : item)) }), trustedTransitions[stage.semantic].map((semantic) => { const destination = snapshot.stages.find((candidate) => candidate.semantic === semantic); const checked = (transitions[index] ?? []).includes(destination.id); return createElement("label", { key: destination.id }, [createElement("input", { key: "input", type: "checkbox", checked, onChange: () => setTransitions((current) => current.map((currentStage, itemIndex) => itemIndex !== index ? currentStage : checked ? currentStage.filter((id) => id !== destination.id) : [...currentStage, destination.id])) }), ` Allow transition to ${destination.name}`]); }), stage.semantic === "lost" ? createElement("p", { key: "loss", id: `loss-reason-${index}` }, "Loss reason is required when closing lost.") : null])) : null, createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: input.action === undefined || input.dispatchAction === undefined || snapshot === undefined || !deterministicIds, ...(!deterministicIds ? { "aria-describedby": "pipeline-contract-error" } : {}) }, input.action?.id === "sales.pipeline.archive" ? "Archive pipeline" : "Update pipeline") }), createElement("p", { key: "notice", id: "pipeline-contract-error", role: snapshot === undefined || !deterministicIds ? "alert" : "status", "aria-live": "polite" }, snapshot === undefined && input.sourceResult?.state === "success" ? "Pipeline data is invalid. Refresh and try again." : !deterministicIds ? "Pipeline identity validation is in progress or unavailable." : notice)] });
}
function savedViewDetail(table) {
    if (!tableRecordShape(table))
        return undefined;
    const value = table;
    const fields = ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"];
    if (value.fields.join("\0") !== fields.join("\0") || value.rows.length < 1 || value.rows.length > 33 || value.rows.some((row) => Object.keys(row.values).sort().join("\0") !== [...fields].sort().join("\0")))
        return undefined;
    const first = value.rows[0];
    const id = Number(cellText(first.values.id));
    const revision = Number(cellText(first.values.revision));
    const name = cellText(first.values.name);
    const visibility = cellText(first.values.visibility);
    const teamId = cellText(first.values["team-id"]);
    const chunkCount = Number(cellText(first.values["chunk-count"]));
    if (!positiveSafeInteger(id) || !positiveSafeInteger(revision) || utf8Length(name.trim()) < 1 || utf8Length(name.trim()) > 120 || !["personal", "team"].includes(visibility) || visibility === "team" && (teamId === "—" || utf8Length(teamId) > 120) || visibility === "personal" && teamId !== "—" || !positiveSafeInteger(chunkCount) || chunkCount !== value.rows.length)
        return undefined;
    const chunks = new Map();
    for (const row of value.rows) {
        const index = Number(cellText(row.values["chunk-index"]));
        const count = Number(cellText(row.values["chunk-count"]));
        const chunk = cellText(row.values["definition-chunk"]);
        if (!Number.isSafeInteger(index) || index < 0 || count !== chunkCount || chunks.has(index) || row.key !== `saved-view:${id}:chunk:${index}` || chunk === "—" || chunk.length > 512 || utf8Length(chunk) > 512 || cellText(row.values.id) !== String(id) || cellText(row.values.revision) !== String(revision) || cellText(row.values.name) !== name || cellText(row.values.visibility) !== visibility || cellText(row.values["team-id"]) !== teamId || cellText(row.values.status) !== "active")
            return undefined;
        chunks.set(index, chunk);
    }
    const definition = [...chunks.entries()].sort(([left], [right]) => left - right).map(([, chunk]) => chunk).join("");
    if (chunks.size !== chunkCount || [...chunks.keys()].sort((left, right) => left - right).some((index, position) => index !== position) || utf8Length(definition) > 16_384)
        return undefined;
    try {
        return JSON.stringify(JSON.parse(definition)) === definition ? { id, revision, name, visibility: visibility, teamId: teamId === "—" ? "" : teamId, definition } : undefined;
    }
    catch {
        return undefined;
    }
}
function SalesSavedViewActionForm({ input, title }) {
    const list = input.node.bindings?.source?.source.id === "sales.saved-view.list" && input.sourceResult?.state === "success" ? input.sourceResult.data : undefined;
    const detail = input.node.bindings?.source?.source.id === "sales.saved-view.detail" && input.sourceResult?.state === "success" ? savedViewDetail(input.sourceResult.data) : undefined;
    const detailKey = detail === undefined ? "none" : `${detail.id}:${detail.revision}`;
    const [name, setName] = useState("");
    const [visibility, setVisibility] = useState("personal");
    const [teamId, setTeamId] = useState("");
    const [definition, setDefinition] = useState("");
    const [notice, setNotice] = useState("");
    useEffect(() => { if (detail !== undefined) {
        setName(detail.name);
        setVisibility(detail.visibility);
        setTeamId(detail.teamId);
        setDefinition(detail.definition);
    } }, [detailKey]);
    const archive = input.action?.id === "sales.saved-view.archive";
    const update = input.action?.id === "sales.saved-view.update";
    const submit = async () => {
        if (input.action === undefined || input.dispatchAction === undefined)
            return;
        if ((archive || update) && detail === undefined) {
            setNotice("Saved view details are unavailable. Select a view and try again.");
            return;
        }
        let actionInput;
        if (archive)
            actionInput = { id: detail.id, expectedRevision: detail.revision };
        else {
            let parsed;
            try {
                parsed = JSON.parse(definition);
            }
            catch {
                setNotice("Definition must be valid canonical JSON.");
                return;
            }
            if (JSON.stringify(parsed) !== definition || utf8Length(name.trim()) < 1 || utf8Length(name.trim()) > 120 || visibility === "team" && teamId.trim().length === 0) {
                setNotice("Enter a name, canonical definition, and a team ID when team visibility is selected.");
                return;
            }
            actionInput = { ...(update ? { id: detail.id, expectedRevision: detail.revision } : {}), name: name.trim(), visibility: visibility === "team" ? { kind: "team", teamId: teamId.trim() } : { kind: "personal" }, definition: parsed };
        }
        try {
            await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
            setNotice(`${title} completed.`);
        }
        catch {
            setNotice(`${title} failed. Refresh and try again.`);
        }
    };
    const selectView = (candidate) => { const savedViewId = Number(cellText(candidate.values.id)); const expectedRevision = Number(cellText(candidate.values.revision)); if (positiveSafeInteger(savedViewId) && positiveSafeInteger(expectedRevision) && typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("k-nex:saved-view-select", { bubbles: true, detail: { savedViewId, expectedRevision } })); };
    if (list !== undefined && input.action === undefined)
        return createElement("section", { "aria-label": title }, createElement("ul", { "aria-label": "Saved views" }, list.rows.map((candidate) => createElement("li", { key: candidate.key }, createElement("button", { type: "button", onClick: () => selectView(candidate), "aria-label": `Select saved view ${cellText(candidate.values.name)}` }, cellText(candidate.values.name))))));
    return createElement("section", { "aria-label": title }, [list === undefined ? null : createElement("ul", { key: "saved-views", "aria-label": "Saved views" }, list.rows.map((candidate) => createElement("li", { key: candidate.key }, createElement("button", { type: "button", onClick: () => selectView(candidate), "aria-label": `Select saved view ${cellText(candidate.values.name)}` }, cellText(candidate.values.name))))), createElement(Form, { key: "form", label: title, onSubmit: submit, children: [archive ? null : [createElement(TextInput, { key: "name", name: "name", label: "Name", value: name, required: true, onChange: setName }), createElement(Select, { key: "visibility", name: "visibility", label: "Visibility", value: visibility, required: true, options: [{ id: "personal", label: "Personal" }, { id: "team", label: "Team" }], onChange: (next) => setVisibility(next === "team" ? "team" : "personal") }), visibility !== "team" ? null : createElement(TextInput, { key: "team-id", name: "team-id", label: "Team ID", value: teamId, required: true, onChange: setTeamId }), createElement(TextInput, { key: "definition", name: "definition", label: "Definition JSON", value: definition, required: true, onChange: setDefinition })], createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: input.action === undefined || input.dispatchAction === undefined || (archive || update) && detail === undefined, ...((archive || update) && detail === undefined ? { "aria-describedby": "saved-view-contract-error" } : {}) }, archive ? "Archive saved view" : update ? "Update saved view" : "Create saved view") }), createElement("p", { key: "notice", id: "saved-view-contract-error", role: detail === undefined && (archive || update) ? "alert" : "status", "aria-live": "polite" }, detail === undefined && (archive || update) ? "Saved view details are invalid or unavailable." : notice)] })]);
}
const importMappingDefaults = Object.freeze({
    "sales.object.lead": '[{"header":"Display name","fieldId":"displayName"},{"header":"Source","fieldId":"source"}]',
    "sales.object.account": '[{"header":"Name","fieldId":"name"}]',
    "sales.object.contact": '[{"header":"Display name","fieldId":"displayName"},{"header":"Account ID","fieldId":"accountId"}]'
});
const exportFieldDefaults = Object.freeze({
    "sales.object.lead": "display-name,status", "sales.object.account": "name,status", "sales.object.contact": "display-name,account-id,status"
});
function dataMovementSelection(event) {
    const value = event.detail;
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const record = value;
    const expectedRevision = record.expectedRevision;
    if (!positiveSafeInteger(expectedRevision))
        return undefined;
    if (positiveSafeInteger(record.importJobId))
        return { importJobId: record.importJobId, expectedRevision };
    if (positiveSafeInteger(record.exportJobId))
        return { exportJobId: record.exportJobId, expectedRevision };
    if ((record.targetObjectType === "sales.object.account" || record.targetObjectType === "sales.object.contact") && positiveSafeInteger(record.recordId))
        return { targetObjectType: record.targetObjectType, recordId: record.recordId, expectedRevision };
    return undefined;
}
function boundDataMovementSelection(input) {
    const value = input.node.bindings?.source?.input;
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const record = value;
    const expectedRevision = record["expected-revision"];
    if (!positiveSafeInteger(expectedRevision))
        return undefined;
    if (positiveSafeInteger(record["import-job-id"]))
        return { importJobId: record["import-job-id"], expectedRevision };
    if (positiveSafeInteger(record["export-job-id"]))
        return { exportJobId: record["export-job-id"], expectedRevision };
    if ((record["target-object-type"] === "sales.object.account" || record["target-object-type"] === "sales.object.contact") && positiveSafeInteger(record.id))
        return { targetObjectType: record["target-object-type"], recordId: record.id, expectedRevision };
    return undefined;
}
function rowIdentity(row, idField = "id") {
    const id = Number(cellText(row.values[idField]));
    const revision = Number(cellText(row.values.revision));
    return positiveSafeInteger(id) && positiveSafeInteger(revision) ? { id, revision } : undefined;
}
function SalesDataMovementBlock({ input, title }) {
    const actionId = input.action?.id;
    const sourceId = input.node.bindings?.source?.source.id;
    const table = input.sourceResult?.state === "success" && tableRecordShape(input.sourceResult.data) ? input.sourceResult.data : undefined;
    const boundSelection = boundDataMovementSelection(input);
    const [selection, setSelection] = useState(() => boundSelection ?? {});
    const [target, setTarget] = useState("sales.object.lead");
    const [artifactId, setArtifactId] = useState("");
    const [mapping, setMapping] = useState(importMappingDefaults["sales.object.lead"]);
    const [fields, setFields] = useState(exportFieldDefaults["sales.object.lead"]);
    const [authorizationRevision, setAuthorizationRevision] = useState("");
    const [candidate, setCandidate] = useState();
    const [confirmation, setConfirmation] = useState("");
    const [notice, setNotice] = useState("");
    useEffect(() => {
        const listen = (event) => { const next = dataMovementSelection(event); if (next !== undefined) {
            setSelection(next);
            setCandidate(undefined);
            setConfirmation("");
        } };
        window.addEventListener("k-nex:sales-import-select", listen);
        window.addEventListener("k-nex:sales-export-select", listen);
        window.addEventListener("k-nex:sales-dedupe-select", listen);
        return () => { window.removeEventListener("k-nex:sales-import-select", listen); window.removeEventListener("k-nex:sales-export-select", listen); window.removeEventListener("k-nex:sales-dedupe-select", listen); };
    }, []);
    useEffect(() => { if (boundSelection !== undefined)
        setSelection(boundSelection); }, [boundSelection?.importJobId, boundSelection?.exportJobId, boundSelection?.targetObjectType, boundSelection?.recordId, boundSelection?.expectedRevision]);
    const chooseTarget = (next) => {
        if (next !== "sales.object.lead" && next !== "sales.object.account" && next !== "sales.object.contact")
            return;
        setTarget(next);
        setMapping(importMappingDefaults[next]);
        setFields(exportFieldDefaults[next]);
    };
    const selectImport = (row) => { const selected = rowIdentity(row); if (selected === undefined || typeof window === "undefined")
        return; window.dispatchEvent(new CustomEvent("k-nex:sales-import-select", { bubbles: true, detail: { importJobId: selected.id, expectedRevision: selected.revision } })); };
    const selectExport = (row) => { const selected = rowIdentity(row); if (selected === undefined || typeof window === "undefined")
        return; window.dispatchEvent(new CustomEvent("k-nex:sales-export-select", { bubbles: true, detail: { exportJobId: selected.id, expectedRevision: selected.revision } })); };
    const submit = async () => {
        if (input.action === undefined || input.dispatchAction === undefined)
            return;
        const authorization = Number(authorizationRevision);
        let actionInput;
        if (actionId === "sales.import.dry-run") {
            let columnMapping;
            try {
                columnMapping = JSON.parse(mapping);
            }
            catch {
                setNotice("Column mapping must be valid JSON.");
                return;
            }
            if (artifactId.trim().length === 0 || !positiveSafeInteger(authorization)) {
                setNotice("Enter an upload artifact ID and current authorization revision.");
                return;
            }
            actionInput = { request: { uploadArtifactId: artifactId.trim(), targetObjectType: target, columnMapping, expectedAuthorizationRevision: authorization } };
        }
        else if (actionId === "sales.import.commit") {
            const selected = table?.rows[0] === undefined ? undefined : rowIdentity(table.rows[0]);
            if (selected === undefined || !positiveSafeInteger(authorization)) {
                setNotice("Select a validated import and enter the current authorization revision.");
                return;
            }
            actionInput = { importJobId: selected.id, expectedRevision: selected.revision, expectedAuthorizationRevision: authorization };
        }
        else if (actionId === "sales.import.cancel") {
            if (!positiveSafeInteger(selection.importJobId) || !positiveSafeInteger(selection.expectedRevision)) {
                setNotice("Select an import job before cancelling it.");
                return;
            }
            actionInput = { importJobId: selection.importJobId, expectedRevision: selection.expectedRevision };
        }
        else if (actionId === "sales.export.create") {
            const selectedFields = fields.split(",").map((field) => field.trim()).filter(Boolean);
            if (!positiveSafeInteger(authorization) || selectedFields.length === 0 || new Set(selectedFields).size !== selectedFields.length) {
                setNotice("Choose unique export fields and enter the current authorization revision.");
                return;
            }
            const sourceId = target === "sales.object.lead" ? "sales.leads" : target === "sales.object.account" ? "sales.accounts" : "sales.contacts";
            actionInput = { request: { targetObjectType: target, sourceId, sourceVersion: 1, sourceSchemaVersion: 1, selectedFields, expectedAuthorizationRevision: authorization } };
        }
        else if (actionId === "sales.export.cancel") {
            const selected = table?.rows[0] === undefined ? undefined : rowIdentity(table.rows[0]);
            const exportJobId = selected?.id ?? selection.exportJobId;
            const expectedRevision = selected?.revision ?? selection.expectedRevision;
            if (!positiveSafeInteger(exportJobId) || !positiveSafeInteger(expectedRevision)) {
                setNotice("Select an export job before cancelling it.");
                return;
            }
            actionInput = { exportJobId, expectedRevision };
        }
        else if (actionId === "sales.merge.commit") {
            if (selection.targetObjectType === undefined || !positiveSafeInteger(selection.recordId) || !positiveSafeInteger(selection.expectedRevision) || candidate === undefined || confirmation !== "MERGE" || !positiveSafeInteger(authorization)) {
                setNotice("Select a candidate, type MERGE, and enter the current authorization revision.");
                return;
            }
            actionInput = { targetObjectType: selection.targetObjectType, winnerId: selection.recordId, winnerExpectedRevision: selection.expectedRevision, loserId: candidate.id, loserExpectedRevision: candidate.revision, expectedAuthorizationRevision: authorization };
        }
        if (actionInput === undefined)
            return;
        try {
            await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
            setNotice(`${title} completed.`);
        }
        catch {
            setNotice(`${title} failed. Refresh and try again.`);
        }
    };
    const titleFor = actionId === "sales.import.dry-run" ? "Validate CSV import" : actionId === "sales.import.commit" ? "Queue import" : actionId === "sales.import.cancel" ? "Cancel import" : actionId === "sales.export.create" ? "Create export" : actionId === "sales.export.cancel" ? "Cancel export" : actionId === "sales.merge.commit" ? "Confirm merge" : title;
    const sourceRows = table === undefined ? null : createElement("ul", { key: "jobs", "aria-label": title }, table.rows.map((row) => {
        const id = sourceId === "sales.dedupe.candidates"
            ? (() => { const candidateId = Number(cellText(row.values["candidate-id"])); const candidateRevision = Number(cellText(row.values["candidate-revision"])); return positiveSafeInteger(candidateId) && positiveSafeInteger(candidateRevision) ? { id: candidateId, revision: candidateRevision } : undefined; })()
            : rowIdentity(row);
        const select = sourceId === "sales.import-job.list" ? () => selectImport(row) : sourceId === "sales.export-job.list" ? () => selectExport(row) : sourceId === "sales.dedupe.candidates" && id !== undefined ? () => setCandidate(id) : undefined;
        const label = sourceId === "sales.dedupe.candidates" ? `Select candidate ${id?.id ?? "unavailable"}` : `Select job ${id?.id ?? "unavailable"}`;
        const artifactId = sourceId === "sales.export-job.detail" ? cellText(row.values["artifact-id"]) : "—";
        const download = artifactId === "—" ? undefined : () => { if (typeof window !== "undefined")
            window.dispatchEvent(new CustomEvent("k-nex:sales-export-download", { bubbles: true, detail: { artifactId } })); };
        return createElement("li", { key: row.key }, [createElement("span", { key: "values" }, table.fields.map((field) => `${field}: ${cellText(row.values[field])}`).join(" · ")), select === undefined ? null : createElement("button", { key: "select", type: "button", onClick: select, "aria-label": label }, sourceId === "sales.dedupe.candidates" && candidate?.id === id?.id ? "Candidate selected" : label), download === undefined ? null : createElement("button", { key: "download", type: "button", onClick: download, "aria-label": "Download export" }, "Download export")]);
    }));
    const fieldsForAction = actionId === "sales.import.dry-run" ? [
        createElement(TextInput, { key: "artifact", name: "upload-artifact-id", label: "Upload artifact ID", value: artifactId, required: true, onChange: setArtifactId }),
        createElement(Select, { key: "target", name: "target-object-type", label: "Target object type", value: target, options: [{ id: "sales.object.lead", label: "Lead" }, { id: "sales.object.account", label: "Account" }, { id: "sales.object.contact", label: "Contact" }], onChange: chooseTarget }),
        createElement(TextInput, { key: "mapping", name: "column-mapping", label: "Column mapping JSON", value: mapping, required: true, onChange: setMapping })
    ] : actionId === "sales.export.create" ? [
        createElement(Select, { key: "target", name: "target-object-type", label: "Target object type", value: target, options: [{ id: "sales.object.lead", label: "Lead" }, { id: "sales.object.account", label: "Account" }, { id: "sales.object.contact", label: "Contact" }], onChange: chooseTarget }),
        createElement(TextInput, { key: "fields", name: "selected-fields", label: "Selected fields", value: fields, required: true, onChange: setFields })
    ] : actionId === "sales.merge.commit" ? [
        createElement("p", { key: "winner", role: "status" }, selection.recordId === undefined ? "Select an Account or Contact from this route; it remains the winning record." : `Winner: ${selection.recordId}; selected candidate becomes the merged record.`),
        createElement(TextInput, { key: "confirmation", name: "merge-confirmation", label: "Type MERGE to confirm", value: confirmation, required: true, onChange: setConfirmation })
    ] : [];
    const needsAuthorization = actionId === "sales.import.dry-run" || actionId === "sales.import.commit" || actionId === "sales.export.create" || actionId === "sales.merge.commit";
    return createElement("section", { "aria-label": title, "data-k-nex-component": input.node.type }, [sourceRows, createElement(Form, { key: "form", label: titleFor, onSubmit: submit, children: [...fieldsForAction, needsAuthorization ? createElement(TextInput, { key: "authorization", name: "authorization-revision", label: "Authorization revision", value: authorizationRevision, required: true, onChange: setAuthorizationRevision }) : null, createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: input.action === undefined || input.dispatchAction === undefined }, titleFor) }), createElement("p", { key: "notice", role: "status", "aria-live": "polite" }, notice)] })]);
}
const savedViewTableDefinition = defineDataTable({ id: "sales.saved-view-table", descriptor: salesSavedViewTableDescriptor, query: salesSavedViewTableQuery, columns: salesSavedViewTableDescriptor.outputFields.map(({ id }) => ({ id, label: id.replaceAll("-", " ") })), paginationModes: ["offset"], defaultPageSize: 25, rowActions: [] });
function presentation(input) {
    const value = input.node.presentation;
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return Object.freeze({});
    const record = value;
    return record.density === "comfortable" || record.density === "compact" ? Object.freeze({ density: record.density }) : record.mode === "agenda" || record.mode === "month" ? Object.freeze({ mode: record.mode }) : Object.freeze({});
}
function SalesSavedViewTable({ input, title }) {
    const pagination = useSalesRoutePagination();
    const [localState, setLocalState] = useState(() => createDataTableState(savedViewTableDefinition));
    const sourcePage = pageResult(input);
    const currentPage = pagination?.listPage ?? sourcePage?.number ?? (localState.pagination.mode === "offset" ? localState.pagination.page : 1);
    const pageSize = sourcePage !== undefined && Number.isSafeInteger(sourcePage.pageSize) && sourcePage.pageSize >= 1 && sourcePage.pageSize <= 100 ? sourcePage.pageSize : 25;
    const density = presentation(input).density;
    const viewState = { ...localState, pagination: { mode: "offset", page: currentPage, size: pageSize }, ...(density === undefined ? {} : { density }) };
    return createElement(DataTable, { definition: savedViewTableDefinition, viewState, onViewStateChange: (next) => { setLocalState(next); if (next.pagination.mode === "offset" && next.pagination.page !== currentPage)
            requestWorkspacePage(input, pagination, next.pagination.page); }, requestState: dataTableRequestState(input.sourceResult), label: title });
}
function savedViewTableElement(input, title) { return componentElement(SalesSavedViewTable, { input, title }); }
function SalesSavedViewCalendar({ input, title }) {
    const mode = presentation(input).mode ?? "agenda";
    const pagination = useSalesRoutePagination();
    const page = pageResult(input);
    return componentElement(QueryBoundary, { state: queryRequestState(input.sourceResult), children: (value) => {
            const items = tableItems(value, ["subject", "scheduled-at", "occurred-at"]);
            const agenda = componentElement(DataList, { key: "agenda", label: `${title} agenda`, items });
            const grouped = new Map();
            for (const item of items) {
                const date = item.value.match(/(?:scheduled-at|occurred-at): ([^ ·]+)/u)?.[1]?.slice(0, 10) ?? "Unscheduled";
                grouped.set(date, [...(grouped.get(date) ?? []), item]);
            }
            const month = createElement("div", { key: "month", "data-slot": "calendar-month" }, [...grouped.entries()].map(([date, entries]) => createElement("section", { key: date, "aria-label": `${date} activities` }, [createElement("h3", { key: "date" }, date), createElement("ul", { key: "entries" }, entries.map((entry) => createElement("li", { key: entry.id }, entry.label)))])));
            return createElement("section", { "aria-label": title, "data-k-nex-component": "sales-calendar", "data-calendar-mode": mode }, [createElement("h2", { key: "title" }, `${title} ${mode}`), mode === "agenda" ? agenda : month, page !== undefined && (page.number > 1 || page.hasNext) ? componentElement(PaginationControl, { key: "pagination", page: page.number, hasNext: page.hasNext, onPageChange: (next) => requestWorkspacePage(input, pagination, next) }) : null]);
        } });
}
function calendarElement(input, title) { return componentElement(SalesSavedViewCalendar, { input, title }); }
function detailActionAllowed(input, record) {
    const actionId = input.action?.id ?? "";
    const sourceId = input.node.bindings?.source?.source.id;
    const status = cellText(record?.values.status);
    const archiveStatus = cellText(record?.values["archive-status"]);
    const stage = cellText(record?.values["stage-id"]);
    if ((sourceId === salesAccountDetailDescriptor.id || sourceId === salesContactDetailDescriptor.id) && (status === "archived" || status === "merged")) {
        return !["sales.account.update", "sales.account.archive", "sales.contact.update", "sales.contact.archive", "sales.ownership.assign"].includes(actionId);
    }
    if (sourceId === salesLeadDetailDescriptor.id && archiveStatus === "archived") {
        return !["sales.lead.update", "sales.lead.qualify", "sales.lead.disqualify", "sales.lead.archive", "sales.ownership.assign"].includes(actionId);
    }
    if (sourceId === salesLeadDetailDescriptor.id && (status === "qualified" || status === "disqualified")) {
        return !["sales.lead.update", "sales.lead.qualify", "sales.lead.disqualify", "sales.ownership.assign"].includes(actionId);
    }
    if (sourceId === salesOpportunityDetailDescriptor.id && archiveStatus === "archived") {
        return !["sales.opportunity.update", "sales.opportunity.stage.update", "sales.opportunity.close", "sales.opportunity.archive", "sales.ownership.assign"].includes(actionId);
    }
    if (sourceId === salesOpportunityDetailDescriptor.id && (stage === "won" || stage === "lost"))
        return actionId === "sales.opportunity.archive" || !["sales.opportunity.update", "sales.opportunity.stage.update", "sales.opportunity.close", "sales.ownership.assign"].includes(actionId);
    return true;
}
function contributionElement(kind, input, title) {
    if (input.action?.id === salesReportRunDescriptor.id || input.action?.id === salesReportScheduleDescriptor.id)
        return componentElement(Section, { label: title, children: createElement("div", {}, queryElement(kind, input, title), componentElement(SalesReportActionForm, { input, title })) });
    if (input.node.type === "sales.notification-center" || input.node.type === "sales.reminder-center")
        return componentElement(SalesRecipientDeliveryBlock, { input, title });
    if (input.node.type === "sales.integration-settings")
        return componentElement(Section, { label: title, children: createElement("div", {}, queryElement("data-list", input, `${title} status`), componentElement(SalesCommunicationActionForm, { input, title })) });
    if (input.node.type === "sales.communication-actions")
        return componentElement(SalesCommunicationActionForm, { input, title });
    if (input.node.type === "sales.imports" || input.node.type === "sales.exports")
        return componentElement(SalesDataMovementBlock, { input, title });
    if (input.node.type === "sales.saved-view-table")
        return savedViewTableElement(input, title);
    if (input.action?.id === "sales.pipeline.update" || input.action?.id === "sales.pipeline.archive")
        return componentElement(SalesPipelineActionForm, { input, title });
    if (input.node.bindings?.source?.source.id === "sales.saved-view.list" || input.action?.id?.startsWith("sales.saved-view."))
        return componentElement(SalesSavedViewActionForm, { input, title });
    const record = sourceRecord(input);
    const actionAllowed = detailActionAllowed(input, record) && (input.action?.id !== salesOwnershipAssignDescriptor.id || input.actor.permissions.has(salesOwnershipAssignDescriptor.permission));
    if (kind === "data-table") {
        const table = componentElement(SalesCrmDataGrid, { key: "records", input, title });
        return workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? table : componentElement(Section, { label: title, children: createElement("div", {}, table, componentElement(SalesWorkflowActionForm, { label: actionLabel(input.action?.id), input })) });
    }
    if (kind === "metric" || kind === "data-list") {
        const content = queryElement(kind, input, title);
        return kind !== "data-list" || workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? content : componentElement(Section, { label: title, children: createElement("div", {}, content, componentElement(SalesWorkflowActionForm, { label: actionLabel(input.action?.id), input })) });
    }
    if (kind === "detail") {
        const action = workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? undefined : componentElement(SalesWorkflowActionForm, { label: actionLabel(input.action?.id), input });
        if (input.node.id.includes("-action-"))
            return action ?? null;
        const crmKind = detailKind(input);
        const record = sourceRecord(input);
        if (crmKind === undefined) {
            const detail = queryElement(kind, input, title);
            return action === undefined ? detail : componentElement(Section, { label: title, children: createElement("div", {}, detail, action) });
        }
        return componentElement(SalesCrmDetailPage, {
            kind: crmKind, recordId: record?.key ?? "unavailable", requestState: dataTableRequestState(input.sourceResult), permissions: [...input.actor.permissions], ...(action === undefined ? {} : { actions: action })
        });
    }
    if (kind === "form")
        return workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? componentElement(SalesTaskActionForm, {
            label: title, enabled: input.action !== undefined && input.dispatchAction !== undefined,
            onSubmit: async (values) => {
                if (input.action === undefined || input.dispatchAction === undefined)
                    return;
                await input.dispatchAction({ action: input.action, input: values, nodeId: input.node.id });
            }
        }) : componentElement(SalesWorkflowActionForm, { label: title, input });
    if (kind === "status")
        return componentElement(Status, { children: title });
    if (kind === "kanban")
        return kanbanElement(input, title);
    if (kind === "calendar")
        return calendarElement(input, title);
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
    if (kind === "calendar")
        return "DataList";
    return "Status";
}
function contributionRenderer(id) {
    return (input) => {
        const props = input.props;
        const title = props.title ?? id.replace(/^sales\./u, "Sales ").replaceAll("-", " ");
        const state = input.sourceResult?.state ?? "idle";
        const kind = rendererKind(id);
        return Object.freeze({
            kind, component: componentName(kind), title, accessibility: accessibility(kind, title), state,
            element: contributionElement(kind, input, title),
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
    sourceIds: Object.freeze([
        salesAccountDetailDescriptor.id, salesAccountsDescriptor.id, salesContactDetailDescriptor.id, salesContactsDescriptor.id,
        salesLeadDetailDescriptor.id, salesLeadsDescriptor.id, salesOpportunityDetailDescriptor.id, salesOpportunitiesDescriptor.id,
        salesTasksDescriptor.id, salesTimelineDescriptor.id,
        salesPipelineSnapshotDescriptor.id, salesSavedViewCalendarDescriptor.id, salesSavedViewDetailDescriptor.id,
        salesSavedViewKanbanDescriptor.id, salesSavedViewListDescriptor.id, salesSavedViewTableDescriptor.id,
        salesImportJobListDescriptor.id, salesImportJobDetailDescriptor.id, salesExportJobListDescriptor.id,
        salesExportJobDetailDescriptor.id, salesDedupeCandidatesDescriptor.id, salesNotificationsDescriptor.id, salesRemindersDescriptor.id, salesProviderConfigurationsDescriptor.id, ...salesReportDescriptors.map(({ id }) => id)
    ].sort()),
    actionIds: Object.freeze([salesOpportunityStageUpdateDescriptor.id, salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id,
        salesPipelineUpdateDescriptor.id, salesPipelineArchiveDescriptor.id, salesSavedViewCreateDescriptor.id,
        salesSavedViewUpdateDescriptor.id, salesSavedViewArchiveDescriptor.id, salesImportDryRunDescriptor.id,
        salesImportCommitDescriptor.id, salesImportCancelDescriptor.id, salesExportCreateDescriptor.id,
        salesExportCancelDescriptor.id, salesMergeCommitDescriptor.id, salesNotificationReadDescriptor.id, salesNotificationArchiveDescriptor.id, salesReminderDismissDescriptor.id, salesReminderScheduleDescriptor.id, salesEmailSendDescriptor.id, salesCalendarSyncDescriptor.id, salesIntegrationConfigureDescriptor.id, salesReportRunDescriptor.id, salesReportScheduleDescriptor.id, ...salesWorkflowMutations.map(({ action }) => action.id)].sort()),
    routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id)),
    pageTemplateIds: Object.freeze(salesPageTemplates.map(({ id }) => id).sort()),
    componentIds: Object.freeze(salesUiComponentDescriptors.map(({ id }) => id)),
    blockIds: Object.freeze(salesUiBlockDescriptors.map(({ id }) => id))
});
//# sourceMappingURL=ui.js.map