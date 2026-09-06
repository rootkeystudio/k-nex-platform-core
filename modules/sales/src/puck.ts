import { createPuckBlockLibrary } from "@k-nex/ui-builder-blocks";

import {
  salesAccountDetailDescriptor,
  salesAccountsDescriptor,
  salesContactDetailDescriptor,
  salesContactsDescriptor,
  salesLeadDetailDescriptor,
  salesLeadsDescriptor,
  salesOpportunitiesDescriptor,
  salesOpportunityCreateDescriptor,
  salesOpportunityDetailDescriptor,
  salesOpportunityStageUpdateDescriptor,
  salesTaskCreateDescriptor,
  salesTasksDescriptor
} from "./contracts.js";
import { salesUiBlockDefinitions } from "./ui.js";

export const salesTaskTablePuckAuthoring = Object.freeze({
  label: "Sales task table",
  fields: Object.freeze([{ prop: "title", label: "Title", kind: "text" as const }]),
  allowChildren: false,
  defaultProps: Object.freeze({ title: "Sales tasks" })
});

const labels: Readonly<Record<string, string>> = Object.freeze({
  "sales.task-table": "Sales task table",
  "sales.task-quick-create": "Sales task quick-create",
  "sales.opportunity-list": "Sales opportunity list",
  "sales.opportunity-detail": "Sales opportunity detail",
  "sales.opportunity-kanban": "Sales opportunity Kanban",
  "sales.settings-summary": "Sales settings summary"
});

function defaultBindings(definition: (typeof salesUiBlockDefinitions)[number]) {
  const id = definition.id;
  if (id === "sales.task-table") return { source: { source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version }, input: {}, structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash, selectedFields: ["title", "status"] } };
  if (id === "sales.task-quick-create") return { action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version } };
  if (id.includes("opportunity")) return {
    source: { source: { id: id.includes("detail") ? salesOpportunityDetailDescriptor.id : salesOpportunitiesDescriptor.id, version: id.includes("detail") ? salesOpportunityDetailDescriptor.version : salesOpportunitiesDescriptor.version }, input: id.includes("detail") ? { id: "1" } : {}, structuralCompatibilityHash: id.includes("detail") ? salesOpportunityDetailDescriptor.structuralCompatibilityHash : salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: id.includes("detail") ? ["name", "stage-id", "archive-status", "revision"] : ["name", "stage-id", "revision"] },
    ...(id === "sales.opportunity-list" ? { action: { id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version } } : id === "sales.opportunity-kanban" || id === "sales.opportunity-detail" ? { action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version } } : {})
  };
  const crm = id.includes("account") ? { list: salesAccountsDescriptor, detail: salesAccountDetailDescriptor, fields: ["name", "status", "revision"] }
    : id.includes("contact") ? { list: salesContactsDescriptor, detail: salesContactDetailDescriptor, fields: ["display-name", "status", "revision"] }
      : id.includes("lead") ? { list: salesLeadsDescriptor, detail: salesLeadDetailDescriptor, fields: ["display-name", "status", "archive-status", "revision"] } : undefined;
  if (crm !== undefined) {
    const source = id.includes("detail") ? crm.detail : crm.list;
    const action = definition.actionPolicy?.actions[0];
    return {
      source: { source: { id: source.id, version: source.version }, input: id.includes("detail") ? { id: "1" } : {}, structuralCompatibilityHash: source.structuralCompatibilityHash, selectedFields: crm.fields },
      ...(action === undefined ? {} : { action })
    };
  }
  return undefined;
}

const fixedCrmBlocks = new Set(["sales.account-list", "sales.account-detail", "sales.contact-list", "sales.contact-detail", "sales.lead-list", "sales.lead-detail", "sales.opportunity-list", "sales.opportunity-detail"]);
const salesPuckDefinitions = salesUiBlockDefinitions.filter(({ id }) => !fixedCrmBlocks.has(id));

export const salesPuckBlockAuthoring = Object.freeze(Object.fromEntries(salesPuckDefinitions.map((definition) => [definition.id, Object.freeze({
  label: labels[definition.id] ?? definition.id.split(/[.-]/u).slice(1).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
  fields: Object.freeze([{ prop: "title", label: "Title", kind: "text" as const }]),
  allowChildren: false,
  defaultProps: Object.freeze({ title: labels[definition.id] ?? definition.id }),
  ...(defaultBindings(definition) === undefined ? {} : { defaultBindings: defaultBindings(definition) })
})])));

export const salesPuckBlockBridges = createPuckBlockLibrary(salesPuckDefinitions, salesPuckBlockAuthoring);
