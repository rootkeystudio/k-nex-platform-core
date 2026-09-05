import { createPuckBlockLibrary } from "@k-nex/ui-builder-blocks";

import {
  salesOpportunitiesDescriptor,
  salesOpportunityStageUpdateDescriptor,
  salesTaskCreateDescriptor,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor
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
  "sales.revenue-metric": "Sales revenue metric",
  "sales.task-quick-create": "Sales task quick-create",
  "sales.opportunity-list": "Sales opportunity list",
  "sales.opportunity-detail": "Sales opportunity detail",
  "sales.opportunity-kanban": "Sales opportunity Kanban",
  "sales.settings-summary": "Sales settings summary"
});

function defaultBindings(id: string) {
  if (id === "sales.revenue-metric") return { source: { source: { id: salesTotalPotentialRevenueDescriptor.id, version: 1 }, input: {}, structuralCompatibilityHash: salesTotalPotentialRevenueDescriptor.structuralCompatibilityHash } };
  if (id === "sales.task-table") return { source: { source: { id: salesTasksDescriptor.id, version: 1 }, input: {}, structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash, selectedFields: ["title", "status", "potential-revenue"] } };
  if (id === "sales.task-quick-create") return { action: { id: salesTaskCreateDescriptor.id, version: 1 } };
  if (id.includes("opportunity")) return {
    source: { source: { id: salesOpportunitiesDescriptor.id, version: 1 }, input: {}, structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage", "revision", "value"] },
    ...(id === "sales.opportunity-kanban" || id === "sales.opportunity-detail" ? { action: { id: salesOpportunityStageUpdateDescriptor.id, version: 1 } } : {})
  };
  return undefined;
}

export const salesPuckBlockAuthoring = Object.freeze(Object.fromEntries(salesUiBlockDefinitions.map((definition) => [definition.id, Object.freeze({
  label: labels[definition.id]!,
  fields: Object.freeze([{ prop: "title", label: "Title", kind: "text" as const }]),
  allowChildren: false,
  defaultProps: Object.freeze({ title: labels[definition.id]! }),
  ...(defaultBindings(definition.id) === undefined ? {} : { defaultBindings: defaultBindings(definition.id) })
})])));

export const salesPuckBlockBridges = createPuckBlockLibrary(salesUiBlockDefinitions, salesPuckBlockAuthoring);
