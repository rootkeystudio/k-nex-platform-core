import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { defineUiContributionBinding, type UiBlockRenderInput, type UiContributionDefinition } from "@k-nex/ui-runtime";
import { Section, Status } from "@k-nex/ui-components";
import { DataList, DataTable, KeyValueList, Metric, QueryBoundary, createDataTableState } from "@k-nex/ui-data";
import type { DataTableRequestState } from "@k-nex/ui-data/data-table-controller";
import { Form, FormActions, Select, TextInput } from "@k-nex/ui-forms";
import type { MetricScalar, TableRecords } from "@k-nex/contracts";

import {
  salesAccountDetailDescriptor,
  salesAccountsDescriptor,
  salesContactDetailDescriptor,
  salesContactsDescriptor,
  salesLeadDetailDescriptor,
  salesLeadsDescriptor,
  salesOpportunityDetailDescriptor,
  salesRouteDescriptors,
  salesPageTemplates,
  salesUiBlockDescriptors,
  salesUiComponentDescriptors,
  salesOpportunityStageUpdateDescriptor,
  salesOwnershipAssignDescriptor,
  salesOpportunityKanbanBlockDescriptor,
  salesOpportunitiesDescriptor,
  salesTaskCreateDescriptor,
  salesTaskUpdateDescriptor,
  salesTaskTableBlockDescriptor,
  salesTaskTableComponentDescriptor,
  salesTasksDescriptor,
  salesTimelineDescriptor
} from "./contracts.js";
import { SalesCrmDetailPage, salesAccountsTableDefinition, salesContactsTableDefinition, salesLeadsTableDefinition, salesOpportunitiesTableDefinition, salesTasksTableDefinition, useSalesRoutePagination } from "./pages.js";
import { salesWorkflowMutations } from "./browser.js";

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

const workflowFields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "sales.account.create": ["name"], "sales.account.update": ["id", "expectedRevision", "name"], "sales.account.archive": ["id", "expectedRevision"],
  "sales.contact.create": ["accountId", "displayName", "email", "phone"], "sales.contact.update": ["id", "expectedRevision", "displayName", "emailMode", "email", "phoneMode", "phone"], "sales.contact.archive": ["id", "expectedRevision"],
  "sales.lead.create": ["displayName", "source", "email", "phone"], "sales.lead.update": ["id", "expectedRevision", "displayName", "source", "emailMode", "email", "phoneMode", "phone"],
  "sales.lead.qualify": ["id", "expectedRevision", "accountMode", "accountName", "accountId", "contactMode", "contactName", "contactId", "opportunityName", "pipelineId"], "sales.lead.disqualify": ["id", "expectedRevision"], "sales.lead.archive": ["id", "expectedRevision"],
  "sales.opportunity.create": ["name", "accountId", "pipelineId", "stageId", "primaryContactId", "amountValue", "amountCurrency", "amountScale", "expectedCloseDate"],
  "sales.opportunity.update": ["id", "expectedRevision", "name", "primaryContactMode", "primaryContactId", "amountMode", "amountValue", "amountCurrency", "amountScale", "expectedCloseDateMode", "expectedCloseDate"],
  "sales.opportunity.stage.update": ["id", "expectedStage", "expectedRevision", "stage"],
  "sales.opportunity.close": ["id", "expectedRevision", "expectedStage", "stage", "lossReason"], "sales.opportunity.archive": ["id", "expectedRevision"],
  "sales.activity.create": ["relatedRecordType", "relatedRecordId", "type", "subject", "scheduledAt", "supersedesActivityId"],
  "sales.activity.complete": ["id", "expectedRevision"], "sales.activity.cancel": ["id", "expectedRevision"],
  "sales.note.create": ["relatedRecordType", "relatedRecordId", "body", "replacesNoteId"],
  "sales.attachment.link": ["relatedRecordType", "relatedRecordId", "storageReference", "filename", "mediaType", "byteSize"],
  "sales.attachment.remove": ["id", "expectedRevision"],
  "sales.ownership.assign": ["recordType", "id", "expectedRevision", "ownerId", "teamId"]
});

const fieldLabels: Readonly<Record<string, string>> = Object.freeze({
  id: "Record ID", expectedRevision: "Expected revision", name: "Name", accountId: "Account ID", contactId: "Contact ID", displayName: "Display name", emailMode: "Email mode", email: "Email", phoneMode: "Phone mode", phone: "Phone", source: "Source",
  accountMode: "Account mode", accountName: "Account name", contactMode: "Contact mode", contactName: "Contact name", opportunityName: "Opportunity name", pipelineId: "Pipeline ID", stageId: "Stage ID", expectedStage: "Expected stage", stage: "Stage", lossReason: "Loss reason",
  primaryContactMode: "Primary contact mode", primaryContactId: "Primary contact ID", amountMode: "Amount mode", amountValue: "Amount", amountCurrency: "Currency", amountScale: "Amount scale", expectedCloseDateMode: "Expected close date mode", expectedCloseDate: "Expected close date",
  relatedRecordType: "Related record type", relatedRecordId: "Related record ID", type: "Activity type", subject: "Subject", scheduledAt: "Scheduled at", supersedesActivityId: "Supersedes activity ID",
  body: "Note", replacesNoteId: "Replaced note ID", storageReference: "Storage reference", filename: "Filename", mediaType: "Media type", byteSize: "Byte size",
  recordType: "Record type", ownerId: "Owner ID", teamId: "Team ID"
});

function sourceRecord(input: UiBlockRenderInput): TableRecords["rows"][number] | undefined {
  return input.sourceResult !== undefined && "data" in input.sourceResult && input.sourceResult.data !== null && typeof input.sourceResult.data === "object" && Array.isArray((input.sourceResult.data as TableRecords).rows)
    ? (input.sourceResult.data as TableRecords).rows[0] : undefined;
}

function isCanonicalUtcInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function initialWorkflowValues(input: UiBlockRenderInput, actionId: string, fields: readonly string[]): Record<string, string> {
  const row = sourceRecord(input);
  const sourceId = input.node.bindings?.source?.source.id ?? input.node.type;
  const actionTarget = actionId.split(".")[1] ?? "";
  const sourceTarget = (sourceId.split(".")[1] ?? "").split("-")[0] ?? "";
  const targetMatchesSource = actionTarget === sourceTarget || actionTarget === "ownership" && ["account", "contact", "lead", "opportunity"].includes(sourceTarget) || (sourceId === salesTimelineDescriptor.id && ["activity", "attachment"].includes(actionTarget));
  const topLevelCreate = ["sales.account.create", "sales.contact.create", "sales.lead.create", "sales.opportunity.create"].includes(actionId) && !sourceId.endsWith(".detail");
  return Object.fromEntries(fields.map((field) => {
    if (actionId === "sales.lead.qualify" && (field === "accountMode" || field === "contactMode")) return [field, "create"];
    if (actionId === "sales.opportunity.update" && ["primaryContactMode", "amountMode", "expectedCloseDateMode"].includes(field)) return [field, "retain"];
    if ((actionId === "sales.contact.update" || actionId === "sales.lead.update") && (field === "emailMode" || field === "phoneMode")) return [field, "retain"];
    if (topLevelCreate) return [field, actionId === "sales.opportunity.create" && field === "stageId" ? "qualification" : ""];
    if (field === "recordType") return [field, ["account", "contact", "lead", "opportunity"].includes(sourceTarget) ? `sales.${sourceTarget}` : ""];
    if (field === "id") return [field, targetMatchesSource ? row?.key ?? "" : ""];
    if (field === "relatedRecordId") return [field, row?.key ?? ""];
    if (field === "relatedRecordType") {
      const kind = sourceId.startsWith("sales.account") ? "sales.account" : sourceId.startsWith("sales.contact") ? "sales.contact" : sourceId.startsWith("sales.lead") ? "sales.lead" : sourceId.startsWith("sales.opportunity") ? "sales.opportunity" : "";
      return [field, kind];
    }
    if (field === "expectedRevision") return [field, targetMatchesSource && cellText(row?.values.revision) !== "—" ? cellText(row?.values.revision) : ""];
    if (field === "expectedStage") return [field, targetMatchesSource && cellText(row?.values["stage-id"]) !== "—" ? cellText(row?.values["stage-id"]) : ""];
    if (actionId === "sales.opportunity.stage.update" && field === "stage") {
      const current = cellText(row?.values["stage-id"]);
      return [field, opportunityTransitionTarget[current as keyof typeof opportunityTransitionTarget] ?? ""];
    }
    const sourceField = field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const value = cellText(row?.values[sourceField]);
    return [field, value === "—" ? "" : value];
  }));
}

function nextStageOptions(value: string | undefined): readonly { readonly id: string; readonly label: string }[] {
  return value === undefined || value === "" ? [] : [{ id: value, label: value[0]!.toUpperCase() + value.slice(1) }];
}

function SalesWorkflowActionForm({ label, input }: { readonly label: string; readonly input: UiBlockRenderInput }) {
  const actionId = input.action?.id;
  const projected = sourceRecord(input);
  const fields = actionId === undefined ? [] : (workflowFields[actionId] ?? []).filter((field) => {
    if (["amountMode", "amountValue", "amountCurrency", "amountScale"].includes(field) && !input.actor.permissions.has("sales.opportunities.amount.read")) return false;
    if (!["emailMode", "email", "phoneMode", "phone"].includes(field)) return true;
    const permission = actionId.includes("contact") ? "sales.contacts.channels.read" : "sales.leads.channels.read";
    return input.actor.permissions.has(permission) && (field.endsWith("Mode") || actionId.endsWith(".create") || projected === undefined || projected.values[field] !== undefined);
  });
  const bindingRevision = `${actionId ?? ""}:${projected?.key ?? ""}:${cellText(projected?.values.revision)}`;
  const [values, setValues] = useState(() => initialWorkflowValues(input, actionId ?? "", fields));
  const [announcement, setAnnouncement] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const formRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setValues(initialWorkflowValues(input, actionId ?? "", fields));
    setFieldErrors({});
  }, [bindingRevision]);
  useEffect(() => { const first = Object.keys(fieldErrors)[0]; if (first !== undefined) formRoot.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); }, [fieldErrors]);
  const optionalFields = ["email", "phone", "lossReason", "supersedesActivityId", "replacesNoteId", "teamId", "primaryContactId", "amountValue", "amountCurrency", "amountScale", "expectedCloseDate"];
  const visibleFields = actionId === "sales.opportunity.update" ? fields.filter((field) => {
    if (field === "primaryContactId") return values.primaryContactMode === "set";
    if (["amountValue", "amountCurrency", "amountScale"].includes(field)) return values.amountMode === "set";
    if (field === "expectedCloseDate") return values.expectedCloseDateMode === "set";
    return true;
  }) : actionId === "sales.contact.update" || actionId === "sales.lead.update" ? fields.filter((field) => field === "email" ? values.emailMode === "set" : field === "phone" ? values.phoneMode === "set" : true)
    : actionId !== "sales.lead.qualify" ? fields : fields.filter((field) => {
    if (field === "accountName") return values.accountMode === "create";
    if (field === "accountId") return values.accountMode === "link";
    if (field === "contactName") return values.contactMode === "create";
    if (field === "contactId") return values.contactMode === "link";
    return true;
  });
  const enabled = actionId !== undefined && fields.length > 0 && input.dispatchAction !== undefined;
  const submit = async () => {
    if (!enabled || input.action === undefined || input.dispatchAction === undefined) return;
    if (actionId === "sales.activity.create" && !isCanonicalUtcInstant(values.scheduledAt ?? "")) {
      setFieldErrors({ scheduledAt: "Enter a canonical UTC instant, for example 2026-09-06T12:30:00.000Z." });
      setAnnouncement("Scheduled at is invalid.");
      return;
    }
    setFieldErrors({});
    const actionInput = Object.fromEntries(visibleFields.flatMap((field) => ["amountValue", "amountCurrency", "amountScale"].includes(field) || values[field] === "" && optionalFields.includes(field) ? [] : [[field, field === "expectedRevision" || field === "byteSize" ? Number(values[field]) : values[field]]]));
    if (actionId === "sales.opportunity.update" && !input.actor.permissions.has("sales.opportunities.amount.read")) Object.assign(actionInput, { amountMode: "retain" });
    if ((actionId === "sales.contact.update" || actionId === "sales.lead.update") && !input.actor.permissions.has(actionId === "sales.contact.update" ? "sales.contacts.channels.read" : "sales.leads.channels.read")) Object.assign(actionInput, { emailMode: "retain", phoneMode: "retain" });
    if (actionId === "sales.opportunity.create" && typeof values.amountValue === "string" && values.amountValue.length > 0 || actionId === "sales.opportunity.update" && values.amountMode === "set") Object.assign(actionInput, { amount: { kind: "money", value: values.amountValue, currency: values.amountCurrency, scale: Number(values.amountScale) } });
    try {
      await input.dispatchAction({ action: input.action, input: actionInput, nodeId: input.node.id });
      setAnnouncement(`${label} completed.`);
    } catch {
      setAnnouncement(`${label} failed. Refresh record and try again.`);
    }
  };
  return createElement("div", { ref: formRoot }, createElement(Form, {
    label, onSubmit: submit,
    children: [
      ...visibleFields.map((field) => field === "accountMode" || field === "contactMode"
        ? createElement(Select, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "", required: true, options: [{ id: "create", label: "Create new" }, ...(field === "contactMode" && values.accountMode === "create" ? [] : [{ id: "link", label: "Link existing" }])], onChange: (value: string) => { setValues((current) => ({ ...current, [field]: value, ...(field === "accountMode" && value === "create" ? { contactMode: "create" } : {}) })); setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== field))); } })
        : (actionId === "sales.opportunity.update" && ["primaryContactMode", "amountMode", "expectedCloseDateMode"].includes(field) || (actionId === "sales.contact.update" || actionId === "sales.lead.update") && (field === "emailMode" || field === "phoneMode"))
          ? createElement(Select, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "retain", required: true, options: ["retain", "set", "clear"].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })), onChange: (value: string) => setValues((current) => ({ ...current, [field]: value })) })
        : actionId === "sales.opportunity.stage.update" && field === "stage"
          ? createElement(Select, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "", required: true, options: nextStageOptions(values.stage), onChange: (value: string) => setValues((current) => ({ ...current, stage: value })) })
        : createElement(TextInput, { key: field, name: field, label: fieldLabels[field] ?? field, value: values[field] ?? "", required: !optionalFields.includes(field) || actionId === "sales.opportunity.update" && ["primaryContactId", "amountValue", "amountCurrency", "amountScale", "expectedCloseDate"].includes(field), ...(fieldErrors[field] === undefined ? {} : { error: fieldErrors[field] }), onChange: (value: string) => { setValues((current) => ({ ...current, [field]: value })); setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== field))); } })),
      createElement(FormActions, { key: "actions", children: createElement("button", { type: "submit", disabled: !enabled }, label) }),
      createElement("p", { key: "announcement", role: "status", "aria-live": "polite" }, announcement)
    ]
  }));
}

function SalesTaskActionForm({ label, enabled, onSubmit }: ActionFormProps) {
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
  if (id.includes("create") || id.includes("update") || id.includes("archive") || id.includes("qualify") || id.includes("disqualify") || id.includes("close")) return "form";
  if (id.includes("account-detail") || id.includes("contact-detail") || id.includes("lead-detail") || id.includes(".detail.")) return "detail";
  if (id.includes("account-list") || id.includes("contact-list") || id.includes("lead-list") || id.includes(".list.accounts") || id.includes(".list.contacts") || id.includes(".list.leads")) return "data-table";
  if (id.includes("opportunity-list") || id === "sales.list.opportunities") return "data-table";
  if (id.includes("opportunity-detail") || id === "sales.detail.opportunity") return "detail";
  if (id.includes("pipeline")) return "status";
  if (id.includes("settings-summary")) return "settings-summary";
  return "data-table";
}

function accessibility(kind: ReturnType<typeof rendererKind>, label: string) {
  const role = kind === "data-table" ? "table" : kind === "form" ? "form" : kind === "data-list" ? "region" : kind === "status" || kind === "metric" ? "status" : "region";
  return Object.freeze({ role, label });
}

function dataTableRequestState(sourceResult: UiBlockRenderInput["sourceResult"]): DataTableRequestState {
  if (sourceResult === undefined) return { state: "idle" };
  if (sourceResult.state === "insufficient-permission" || sourceResult.state === "invalid-contract") return { state: sourceResult.state };
  return sourceResult as DataTableRequestState;
}

function tableDefinition(input: UiBlockRenderInput) {
  const sourceId = input.node.bindings?.source?.source.id;
  if (sourceId === salesAccountsDescriptor.id || sourceId === salesAccountDetailDescriptor.id) return salesAccountsTableDefinition;
  if (sourceId === salesContactsDescriptor.id || sourceId === salesContactDetailDescriptor.id) return salesContactsTableDefinition;
  if (sourceId === salesLeadsDescriptor.id || sourceId === salesLeadDetailDescriptor.id) return salesLeadsTableDefinition;
  return salesOpportunitiesTableDefinition;
}

function detailHref(input: UiBlockRenderInput, rowKey: string): string | undefined {
  const sourceId = input.node.bindings?.source?.source.id ?? "";
  const segment = sourceId === salesAccountsDescriptor.id ? "accounts" : sourceId === salesContactsDescriptor.id ? "contacts" : sourceId === salesLeadsDescriptor.id ? "leads" : sourceId === salesOpportunitiesDescriptor.id ? "opportunities" : undefined;
  return segment === undefined ? undefined : `/sales/${segment}/${encodeURIComponent(rowKey)}`;
}

function detailKind(input: UiBlockRenderInput): "account" | "contact" | "lead" | "opportunity" | undefined {
  const sourceId = input.node.bindings?.source?.source.id;
  return sourceId === salesAccountDetailDescriptor.id ? "account" : sourceId === salesContactDetailDescriptor.id ? "contact"
    : sourceId === salesLeadDetailDescriptor.id ? "lead" : sourceId === salesOpportunityDetailDescriptor.id ? "opportunity" : undefined;
}

function actionLabel(actionId: string | undefined): string {
  return actionId === undefined ? "Update record" : actionId.split(".").slice(1).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
}

function SalesCrmDataGrid({ input, title }: { readonly input: UiBlockRenderInput; readonly title: string }) {
  const definition = tableDefinition(input);
  const pagination = useSalesRoutePagination();
  const [localViewState, setLocalViewState] = useState(() => createDataTableState(definition));
  const viewState = pagination === undefined ? localViewState : { ...localViewState, pagination: { mode: "offset" as const, page: pagination.listPage, size: 25 } };
  const setViewState = (next: typeof viewState) => {
    setLocalViewState(next);
    const currentPage = viewState.pagination.mode === "offset" ? viewState.pagination.page : 1;
    if (next.pagination.mode === "offset" && next.pagination.page !== currentPage) pagination?.onListPageChange(next.pagination.page);
  };
  return createElement(DataTable, {
    definition, viewState, onViewStateChange: setViewState, requestState: dataTableRequestState(input.sourceResult), label: title, mode: "grid",
    renderDetail: (row: TableRecords["rows"][number]) => {
      const href = detailHref(input, row.key);
      return href === undefined ? null : createElement("a", { href, "aria-label": `Open ${title.toLowerCase()} record ${row.key}` }, "Open detail");
    }
  });
}

function queryRequestState(sourceResult: UiBlockRenderInput["sourceResult"]): unknown {
  if (sourceResult === undefined) return { state: "idle" };
  if (sourceResult.state === "stale" || sourceResult.state === "refetching") return { state: "success", data: sourceResult.data };
  if (sourceResult.state === "insufficient-permission") return { state: "forbidden", problem: { code: "SOURCE_FIELD_PERMISSION_DENIED", status: 403 } };
  if (sourceResult.state === "invalid-contract") return { state: "invalid-contract" };
  return sourceResult;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  if ("value" in value) return value.value === null || value.value === undefined ? "—" : String(value.value);
  if ("label" in value) return value.label === null || value.label === undefined ? "—" : String(value.label);
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
    if (kind === "data-list") return componentElement(DataList, { label: title, items: tableItems(value, (value as TableRecords).fields) });
    const table = value as TableRecords;
    const record = table.rows[0];
    return componentElement(Section, { label: title, children: componentElement(KeyValueList, { label: title, items: record === undefined ? [] : table.fields.filter((field) => record.values[field] !== undefined).map((field) => ({ id: field, key: field.replaceAll("-", " "), value: cellText(record.values[field]) })) }) });
  };
  const boundary = componentElement(QueryBoundary, { state: queryRequestState(input.sourceResult), children });
  if (input.sourceResult?.state === "stale") return createElement("section", { "aria-label": `${title} stale data`, "data-state": "stale" }, createElement("p", { role: "status" }, "Showing stale data."), boundary as ReactNode);
  if (input.sourceResult?.state === "refetching") return createElement("section", { "aria-label": `${title} refreshing`, "data-state": "refetching" }, createElement("p", { role: "status" }, "Refreshing…"), boundary as ReactNode);
  return boundary;
}

const opportunityStages = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] as const;
const opportunityTransitionTarget = Object.freeze({ qualification: "discovery", discovery: "proposal", proposal: "negotiation" } as const);

function SalesOpportunityKanban({ table, title, input }: { readonly table: TableRecords; readonly title: string; readonly input: UiBlockRenderInput }) {
  const [announcement, setAnnouncement] = useState("");
  const move = async (id: string, name: string, expectedStage: string, expectedRevision: number, stage: typeof opportunityStages[number]) => {
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
      createElement("ul", { key: "cards" }, table.rows.filter((row) => cellText(row.values["stage-id"]) === stage).map((row) => {
        const name = cellText(row.values.name);
        const revision = Number(cellText(row.values.revision));
        return createElement("li", { key: row.key, "data-opportunity-id": row.key }, [
          createElement("strong", { key: "name" }, name),
          input.action === undefined || input.dispatchAction === undefined || !(stage in opportunityTransitionTarget) ? null : createElement("div", { key: "moves", "aria-label": `Move ${name}` }, (() => {
            const target = opportunityTransitionTarget[stage as keyof typeof opportunityTransitionTarget];
            return createElement("button", { key: target, type: "button", onClick: () => move(row.key, name, stage, revision, target) }, `Move to ${target}`);
          })())
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

function detailActionAllowed(input: UiBlockRenderInput, record: TableRecords["rows"][number] | undefined): boolean {
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
  if (sourceId === salesOpportunityDetailDescriptor.id && (stage === "won" || stage === "lost")) return actionId === "sales.opportunity.archive" || !["sales.opportunity.update", "sales.opportunity.stage.update", "sales.opportunity.close", "sales.ownership.assign"].includes(actionId);
  return true;
}

function contributionElement(kind: ReturnType<typeof rendererKind>, input: UiBlockRenderInput, title: string): unknown {
  const record = sourceRecord(input);
  const actionAllowed = detailActionAllowed(input, record) && (input.action?.id !== salesOwnershipAssignDescriptor.id || input.actor.permissions.has(salesOwnershipAssignDescriptor.permission));
  if (kind === "data-table") {
    const table = componentElement(SalesCrmDataGrid, { key: "records", input, title });
    return workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? table : componentElement(Section, { label: title, children: createElement("div", {}, table as ReactNode, componentElement(SalesWorkflowActionForm, { label: actionLabel(input.action?.id), input }) as ReactNode) });
  }
  if (kind === "metric" || kind === "data-list") {
    const content = queryElement(kind, input, title);
    return kind !== "data-list" || workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? content : componentElement(Section, { label: title, children: createElement("div", {}, content as ReactNode, componentElement(SalesWorkflowActionForm, { label: actionLabel(input.action?.id), input }) as ReactNode) });
  }
  if (kind === "detail") {
    const action = workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? undefined : componentElement(SalesWorkflowActionForm, { label: actionLabel(input.action?.id), input });
    if (input.node.id.includes("-action-")) return action ?? null;
    const crmKind = detailKind(input); const record = sourceRecord(input);
    if (crmKind === undefined) {
      const detail = queryElement(kind, input, title);
      return action === undefined ? detail : componentElement(Section, { label: title, children: createElement("div", {}, detail as ReactNode, action as ReactNode) });
    }
    return componentElement(SalesCrmDetailPage, {
      kind: crmKind, recordId: record?.key ?? "unavailable", requestState: dataTableRequestState(input.sourceResult), permissions: [...input.actor.permissions], ...(action === undefined ? {} : { actions: action })
    });
  }
  if (kind === "form") return workflowFields[input.action?.id ?? ""] === undefined || !actionAllowed ? componentElement(SalesTaskActionForm, {
    label: title, enabled: input.action !== undefined && input.dispatchAction !== undefined,
    onSubmit: async (values: Readonly<Record<string, string>>) => {
      if (input.action === undefined || input.dispatchAction === undefined) return;
      await input.dispatchAction({ action: input.action, input: values, nodeId: input.node.id });
    }
  }) : componentElement(SalesWorkflowActionForm, { label: title, input });
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
  sourceIds: Object.freeze([
    salesAccountDetailDescriptor.id, salesAccountsDescriptor.id, salesContactDetailDescriptor.id, salesContactsDescriptor.id,
    salesLeadDetailDescriptor.id, salesLeadsDescriptor.id, salesOpportunityDetailDescriptor.id, salesOpportunitiesDescriptor.id,
    salesTasksDescriptor.id, salesTimelineDescriptor.id
  ].sort()),
  actionIds: Object.freeze([salesOpportunityStageUpdateDescriptor.id, salesTaskCreateDescriptor.id, salesTaskUpdateDescriptor.id, ...salesWorkflowMutations.map(({ action }) => action.id)].sort()),
  routeIds: Object.freeze(salesRouteDescriptors.map(({ id }) => id)),
  pageTemplateIds: Object.freeze(salesPageTemplates.map(({ id }) => id).sort()),
  componentIds: Object.freeze(salesUiComponentDescriptors.map(({ id }) => id)),
  blockIds: Object.freeze(salesUiBlockDescriptors.map(({ id }) => id))
});
