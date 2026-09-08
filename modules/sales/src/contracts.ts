import type {
  AgentToolDescriptor,
  AgentToolJsonSchema,
  ActionDescriptor,
  DataSourceDescriptor,
  PluginNavigationDescriptor,
  PluginPageTemplateDescriptor,
  PluginRouteDescriptor,
  SystemSettingsDescriptor,
  PluginUiContributionDescriptor,
  RuntimeSchema,
  TableRecords,
  DataSourceQueryControls
} from "@k-nex/contracts";
import { TableRecordsSchema, canonicalJson } from "@k-nex/contracts";
import { isSalesCalendarDate, salesCrmActionDescriptors, salesCrmRouteDescriptors } from "./crm-authority.js";

export const salesRecordIdPattern = "^(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-7])$";

const salesSourceLimits = Object.freeze({
  maxSelectedFields: 8,
  maxPageSize: 100,
  maxFilters: 8,
  maxSorts: 2,
  maxBodyBytes: 32_768,
  maxResultBytes: 1_048_576,
  maxDepth: 6,
  timeoutMs: 5_000,
  maxConcurrency: 4,
  ratePerMinute: 300,
  burst: 30,
  costClass: "medium" as const,
  maxCost: 100
});

export const salesTaskFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  {
    id: "title",
    kind: "text",
    binding: "required",
    nullable: false,
    permission: "sales.tasks.read",
    sortable: true,
    filterOperators: ["eq", "contains"]
  },
  {
    id: "status",
    kind: "status",
    binding: "required",
    nullable: false,
    permission: "sales.tasks.read",
    sortable: true,
    filterOperators: ["eq", "in"]
  }
] as const;

export const salesTasksDescriptor: DataSourceDescriptor = {
  id: "sales.tasks",
  version: 2,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks.output", version: 2 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  structuralCompatibilityHash: "sha256:a0211668702800a1abd7ad5408847da099a84acc20d0cce098b672d4eea062c3",
  presentationMetadataRevision: 1,
  title: "Sales tasks",
  inputFields: [],
  outputFields: salesTaskFields,
  paginationModes: ["offset", "cursor"],
  limits: { ...salesSourceLimits },
  cacheClass: "actor"
};

type SalesSourceField = NonNullable<DataSourceDescriptor["outputFields"]>[number];
const crmField = (id: string, kind: SalesSourceField["kind"], permission: string, nullable = false): SalesSourceField => ({ id, kind, binding: nullable ? "optional" : "required", nullable, permission, sortable: false, filterOperators: [] });

export const salesOpportunityFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  { id: "name", kind: "text", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: true, filterOperators: ["eq", "contains"] },
  crmField("pipeline-id", "integer", "sales.opportunities.read"),
  crmField("pipeline-revision", "integer", "sales.opportunities.read"),
  { id: "stage-id", kind: "status", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: true, filterOperators: ["eq", "in"] },
  crmField("stage-name", "text", "sales.opportunities.read"),
  { id: "stage-semantic", kind: "enum", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: false, filterOperators: [] },
  crmField("stage-revision", "integer", "sales.opportunities.read"),
  { id: "revision", kind: "integer", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: false, filterOperators: [] },
  { id: "amount", kind: "money", binding: "optional", nullable: true, permission: "sales.opportunities.amount.read", sortable: false, filterOperators: [] }
];
export const salesOpportunityDetailFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  crmField("name", "text", "sales.opportunities.read"),
  crmField("owner-id", "text", "sales.opportunities.read"),
  crmField("team-id", "text", "sales.opportunities.read", true),
  crmField("account-id", "integer", "sales.opportunities.read"),
  crmField("primary-contact-id", "integer", "sales.opportunities.read", true),
  crmField("pipeline-id", "integer", "sales.opportunities.read"),
  crmField("pipeline-revision", "integer", "sales.opportunities.read"),
  crmField("stage-id", "status", "sales.opportunities.read"),
  crmField("stage-name", "text", "sales.opportunities.read"),
  { id: "stage-semantic", kind: "enum", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: false, filterOperators: [] },
  crmField("stage-revision", "integer", "sales.opportunities.read"),
  crmField("archive-status", "status", "sales.opportunities.read"),
  crmField("expected-close-date", "text", "sales.opportunities.read", true),
  crmField("revision", "integer", "sales.opportunities.read"),
  { id: "amount", kind: "money", binding: "optional", nullable: true, permission: "sales.opportunities.amount.read", sortable: false, filterOperators: [] }
];

export const salesOpportunitiesDescriptor: DataSourceDescriptor = {
  id: "sales.opportunities",
  version: 3,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.opportunities.output", version: 3 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.opportunities.read",
  structuralCompatibilityHash: "sha256:82668a173c4ee1ce38924b5f99846f86644f437a3926299927cf979426f826ad",
  presentationMetadataRevision: 1,
  title: "Sales opportunities",
  inputFields: [],
  outputFields: salesOpportunityFields,
  paginationModes: ["offset"],
  limits: { ...salesSourceLimits, maxSelectedFields: 9 },
  cacheClass: "actor"
};

const salesCrmListLimits = { ...salesSourceLimits, maxSelectedFields: 8 } as const;

export const salesAccountFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  crmField("name", "text", "sales.accounts.read"), crmField("owner-id", "text", "sales.accounts.read"), crmField("team-id", "text", "sales.accounts.read", true), crmField("status", "status", "sales.accounts.read"), crmField("revision", "integer", "sales.accounts.read")
];
export const salesContactFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  crmField("display-name", "text", "sales.contacts.read"), crmField("owner-id", "text", "sales.contacts.read"), crmField("team-id", "text", "sales.contacts.read", true), crmField("account-id", "integer", "sales.contacts.read"), crmField("status", "status", "sales.contacts.read"), crmField("revision", "integer", "sales.contacts.read"), crmField("email", "text", "sales.contacts.channels.read", true), crmField("phone", "text", "sales.contacts.channels.read", true)
];
export const salesLeadFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  crmField("display-name", "text", "sales.leads.read"), crmField("owner-id", "text", "sales.leads.read"), crmField("team-id", "text", "sales.leads.read", true), crmField("status", "status", "sales.leads.read"), crmField("archive-status", "status", "sales.leads.read"), crmField("revision", "integer", "sales.leads.read"), crmField("email", "text", "sales.leads.channels.read", true), crmField("phone", "text", "sales.leads.channels.read", true)
];
export const salesLeadDetailFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  ...salesLeadFields,
  crmField("source", "text", "sales.leads.read"),
  crmField("decided-at", "text", "sales.leads.read", true),
  crmField("qualified-at", "text", "sales.leads.read", true),
  crmField("disqualified-at", "text", "sales.leads.read", true),
  crmField("qualified-account-id", "integer", "sales.leads.read", true),
  crmField("qualified-contact-id", "integer", "sales.leads.read", true),
  crmField("qualified-opportunity-id", "integer", "sales.leads.read", true)
];

function crmSource(id: string, version: number, permission: string, title: string, outputFields: NonNullable<DataSourceDescriptor["outputFields"]>, structuralCompatibilityHash: string, inputFields: DataSourceDescriptor["inputFields"] = []): DataSourceDescriptor {
  return {
    id, version, ownerPluginId: "module.sales", primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id: `${id}.output`, version }, audience: "authenticated", surfaces: ["workspace"], permission,
    structuralCompatibilityHash, presentationMetadataRevision: 1, title, inputFields, outputFields,
    paginationModes: ["offset"], limits: salesCrmListLimits, cacheClass: "actor"
  };
}

export const salesAccountsDescriptor = crmSource("sales.accounts", 1, "sales.accounts.read", "Sales accounts", salesAccountFields, "sha256:9610899be1f882239297a5aea011ac2860e5dd7b57afe821bc8e08257aeffe11");
export const salesContactsDescriptor = crmSource("sales.contacts", 1, "sales.contacts.read", "Sales contacts", salesContactFields, "sha256:7a05053c0eed840b9abb487c6817462ff3f9edf6ebd30b9b97e200f05b18a99e");
export const salesLeadsDescriptor = crmSource("sales.leads", 1, "sales.leads.read", "Sales leads", salesLeadFields, "sha256:72bbddf594ce5a08bc0d1bf844f6803f767e8293ca2a999fc0c88d90d85cfe91");
const crmDetailInputFields: DataSourceDescriptor["inputFields"] = [{ id: "id", kind: "string", required: true, nullable: false }];
export const salesAccountDetailDescriptor = crmSource("sales.account.detail", 1, "sales.accounts.read", "Sales account detail", salesAccountFields, "sha256:aa69e0e0568eb173050e22d0901961cfffde1485bc96109a527a2e2ba277cc2c", crmDetailInputFields);
export const salesContactDetailDescriptor = crmSource("sales.contact.detail", 1, "sales.contacts.read", "Sales contact detail", salesContactFields, "sha256:4b75035608812e4702e36e93ce9f9dc3a7a53b9dea2ca709699e74e5502d7d5b", crmDetailInputFields);
export const salesLeadDetailDescriptor: DataSourceDescriptor = Object.freeze({
  ...crmSource("sales.lead.detail", 1, "sales.leads.read", "Sales lead detail", salesLeadDetailFields, "sha256:62436905ce48d37158bbcf932a1aa977282195a868db99e0f345714f1dc36b98", crmDetailInputFields),
  limits: { ...salesSourceLimits, maxSelectedFields: 15 }
});
export const salesOpportunityDetailDescriptor: DataSourceDescriptor = Object.freeze({
  ...crmSource("sales.opportunity.detail", 2, "sales.opportunities.read", "Sales opportunity detail", salesOpportunityDetailFields, "sha256:77e88e1763a20e8ac1c2c2eb41d6a877534ee81cdb02d697dbdf06dbd688225c", crmDetailInputFields),
  limits: { ...salesSourceLimits, maxSelectedFields: 15 }
});

const savedBindingInput: NonNullable<DataSourceDescriptor["inputFields"]> = [
  { id: "saved-view-id", kind: "integer", required: false, nullable: false },
  { id: "expected-revision", kind: "integer", required: false, nullable: false }
];
const viewField = (id: string, kind: SalesSourceField["kind"], permission: string, options: { required?: boolean; nullable?: boolean; sortable?: boolean; operators?: readonly string[] } = {}): SalesSourceField => ({
  id, kind, binding: options.required ? "required" : "optional", nullable: options.nullable ?? false, permission,
  sortable: options.sortable ?? false, filterOperators: [...(options.operators ?? [])] as SalesSourceField["filterOperators"]
});
const textOps = ["eq", "neq", "in", "not-in", "contains", "starts-with", "is-null", "is-not-null"] as const;
const enumOps = ["eq", "neq", "in", "not-in", "is-null", "is-not-null"] as const;
const orderedOps = ["eq", "neq", "gt", "gte", "lt", "lte", "is-null", "is-not-null"] as const;
export const salesSavedViewTableFields = Object.freeze([
  viewField("name", "text", "sales.saved-views.read", { sortable: true, operators: textOps }), viewField("display-name", "text", "sales.saved-views.read", { sortable: true, operators: textOps }),
  viewField("title", "text", "sales.saved-views.read", { sortable: true, operators: textOps }), viewField("subject", "text", "sales.saved-views.read", { sortable: true, operators: textOps }),
  viewField("type", "enum", "sales.saved-views.read", { sortable: true, operators: enumOps }), viewField("source", "enum", "sales.saved-views.read", { sortable: true, operators: enumOps }),
  viewField("owner-id", "text", "sales.saved-views.read"), viewField("team-id", "text", "sales.saved-views.read", { nullable: true }),
  viewField("status", "status", "sales.saved-views.read", { sortable: true, operators: enumOps }), viewField("archive-status", "status", "sales.saved-views.read", { sortable: true, operators: enumOps }),
  viewField("revision", "integer", "sales.saved-views.read", { sortable: true, operators: orderedOps }), viewField("account-id", "integer", "sales.saved-views.read", { nullable: true, operators: orderedOps }),
  viewField("primary-contact-id", "integer", "sales.saved-views.read", { nullable: true }), viewField("pipeline-id", "integer", "sales.saved-views.read", { nullable: true }),
  viewField("stage-id", "enum", "sales.saved-views.read", { nullable: true, sortable: true, operators: enumOps }), viewField("expected-close-date", "date", "sales.saved-views.read", { nullable: true, sortable: true, operators: orderedOps }),
  viewField("amount", "money", "sales.saved-views.read", { nullable: true }), viewField("email", "text", "sales.saved-views.read", { nullable: true }), viewField("phone", "text", "sales.saved-views.read", { nullable: true }),
  viewField("due-date", "date", "sales.saved-views.read", { nullable: true, sortable: true, operators: orderedOps }), viewField("related-record-type", "enum", "sales.saved-views.read", { nullable: true }),
  viewField("related-record-id", "integer", "sales.saved-views.read", { nullable: true }), viewField("scheduled-at", "datetime", "sales.saved-views.read", { nullable: true, sortable: true, operators: orderedOps }),
  viewField("occurred-at", "datetime", "sales.saved-views.read", { nullable: true, sortable: true, operators: orderedOps })
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesSavedViewKanbanFields = Object.freeze([
  viewField("row-kind", "enum", "sales.opportunities.read", { required: true }), viewField("name", "text", "sales.opportunities.read", { required: true, sortable: true, operators: textOps }),
  viewField("stage-id", "enum", "sales.opportunities.read", { required: true, sortable: true, operators: enumOps }), viewField("stage-metadata", "text", "sales.opportunities.read", { nullable: true }),
  viewField("revision", "integer", "sales.opportunities.read", { nullable: true, sortable: true, operators: orderedOps })
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesSavedViewCalendarFields = Object.freeze([
  viewField("type", "enum", "sales.activities.read", { required: true, sortable: true, operators: enumOps }), viewField("subject", "text", "sales.activities.read", { required: true, sortable: true, operators: textOps }),
  viewField("status", "status", "sales.activities.read", { required: true, sortable: true, operators: enumOps }), viewField("scheduled-at", "datetime", "sales.activities.read", { nullable: true, sortable: true, operators: orderedOps }),
  viewField("occurred-at", "datetime", "sales.activities.read", { nullable: true, sortable: true, operators: orderedOps }), viewField("related-record-type", "enum", "sales.activities.read", { required: true }),
  viewField("related-record-id", "integer", "sales.activities.read", { required: true }), viewField("revision", "integer", "sales.activities.read", { required: true, sortable: true, operators: orderedOps })
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesPipelineSnapshotFields = Object.freeze([
  viewField("pipeline-id", "integer", "sales.pipelines.read", { required: true }), viewField("pipeline-revision", "integer", "sales.pipelines.read", { required: true }),
  viewField("pipeline-name", "text", "sales.pipelines.read", { required: true }), viewField("stage-id", "text", "sales.pipelines.read", { required: true }),
  viewField("stage-revision", "integer", "sales.pipelines.read", { required: true }), viewField("semantic", "enum", "sales.pipelines.read", { required: true }),
  viewField("stage-name", "text", "sales.pipelines.read", { required: true }), viewField("position", "integer", "sales.pipelines.read", { required: true }),
  viewField("probability-basis-points", "integer", "sales.pipelines.read", { required: true }), viewField("allowed-transition-stage-ids", "text", "sales.pipelines.read", { required: true }),
  viewField("required-field-ids", "text", "sales.pipelines.read", { required: true }), viewField("status", "status", "sales.pipelines.read", { required: true })
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesSavedViewListFields = Object.freeze([
  viewField("id", "integer", "sales.saved-views.read", { required: true }), viewField("name", "text", "sales.saved-views.read", { required: true, sortable: true, operators: ["eq", "contains"] }),
  viewField("visibility", "enum", "sales.saved-views.read", { required: true, sortable: true, operators: ["eq", "in"] }), viewField("team-id", "text", "sales.saved-views.read", { nullable: true }),
  viewField("target-object-id", "enum", "sales.saved-views.read", { required: true }), viewField("view-kind", "enum", "sales.saved-views.read", { required: true }),
  viewField("revision", "integer", "sales.saved-views.read", { required: true }), viewField("status", "status", "sales.saved-views.read", { required: true })
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesSavedViewDetailFields = Object.freeze([
  ...salesSavedViewListFields.slice(0, 4), viewField("chunk-index", "integer", "sales.saved-views.read", { required: true }), viewField("chunk-count", "integer", "sales.saved-views.read", { required: true }),
  viewField("definition-chunk", "text", "sales.saved-views.read", { required: true }), ...salesSavedViewListFields.slice(4)
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);

function p134Source(id: string, title: string, hash: string, fields: readonly SalesSourceField[], limits: Partial<NonNullable<DataSourceDescriptor["limits"]>>, inputFields: DataSourceDescriptor["inputFields"] = []): DataSourceDescriptor {
  return { id, version: 1, ownerPluginId: "module.sales", primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id: `${id}.output`, version: 1 }, audience: "authenticated", surfaces: ["workspace"], permission: id === "sales.pipeline.snapshot" ? "sales.pipelines.read" : "sales.saved-views.read", structuralCompatibilityHash: hash, presentationMetadataRevision: 1, title, inputFields, outputFields: [...fields], paginationModes: ["offset"], limits: { ...salesSourceLimits, ...limits }, cacheClass: "authorization-context" };
}
export const salesSavedViewTableDescriptor = p134Source("sales.saved-view.table", "Sales saved table view", "sha256:9707080142ac16e3f0d540c439e7ae3bc8d2cc1f6fb5166a1879f355834c07d2", salesSavedViewTableFields, {}, savedBindingInput);
export const salesSavedViewKanbanDescriptor = p134Source("sales.saved-view.kanban", "Sales saved Kanban view", "sha256:c54433c895722e63dd499720e37e8f2ae9b1390c28bab9f0c5111c4f7ea1233a", salesSavedViewKanbanFields, {}, savedBindingInput);
export const salesSavedViewCalendarDescriptor = p134Source("sales.saved-view.calendar", "Sales saved calendar view", "sha256:8d9e0bc1f7f3c53b53f3e006c51f2e5e41e2198284c3ad827e10cbf32431f5f9", salesSavedViewCalendarFields, {}, savedBindingInput);
const salesAdministrationSourceLimits = Object.freeze({ ratePerMinute: 120, burst: 12, costClass: "low" as const });
export const salesPipelineSnapshotDescriptor = p134Source("sales.pipeline.snapshot", "Sales pipeline snapshot", "sha256:c9bc20dcc9f46c54dc5c16ef1dcafa54bbba0b6a6531e79f0e8f7dac2493664b", salesPipelineSnapshotFields, { ...salesAdministrationSourceLimits, maxSelectedFields: 12, maxPageSize: 6, maxFilters: 0, maxSorts: 0, maxCost: 14 });
export const salesSavedViewListDescriptor = p134Source("sales.saved-view.list", "Sales saved views", "sha256:21cb975945b4b96ce9e239ef091cf64d2b7249f4015481f45d38fc11c5cd0dbd", salesSavedViewListFields, { ...salesAdministrationSourceLimits, maxFilters: 2, maxSorts: 1, maxCost: 20 });
export const salesSavedViewDetailDescriptor = p134Source("sales.saved-view.detail", "Sales saved view detail", "sha256:52bcebb4b05acf5db95f83c21a9a95dc5d6c8f5db70cd56cf2204fbba9baaf76", salesSavedViewDetailFields, { ...salesAdministrationSourceLimits, maxSelectedFields: 11, maxPageSize: 33, maxFilters: 0, maxSorts: 0, maxCost: 14 }, [{ id: "saved-view-id", kind: "integer", required: false, nullable: false }]);

const movementField = (id: string, kind: SalesSourceField["kind"], permission: string, nullable = false): SalesSourceField => ({ id, kind, binding: nullable ? "optional" : "required", nullable, permission, sortable: false, filterOperators: [] });
export const salesImportJobListFields = Object.freeze([movementField("id", "integer", "sales.imports.read"), movementField("target-object-type", "enum", "sales.imports.read"), movementField("state", "status", "sales.imports.read"), movementField("accepted-rows", "integer", "sales.imports.read"), movementField("rejected-rows", "integer", "sales.imports.read"), movementField("revision", "integer", "sales.imports.read")]);
export const salesImportJobDetailFields = Object.freeze([movementField("id", "integer", "sales.imports.read"), movementField("state", "status", "sales.imports.read"), movementField("diagnostic-code", "enum", "sales.imports.read", true), movementField("artifact-expires-at", "datetime", "sales.imports.read", true), movementField("revision", "integer", "sales.imports.read")]);
export const salesExportJobListFields = Object.freeze([movementField("id", "integer", "sales.exports.read"), movementField("target-object-type", "enum", "sales.exports.read"), movementField("state", "status", "sales.exports.read"), movementField("row-count", "integer", "sales.exports.read"), movementField("revision", "integer", "sales.exports.read")]);
export const salesExportJobDetailFields = Object.freeze([movementField("id", "integer", "sales.exports.read"), movementField("state", "status", "sales.exports.read"), movementField("artifact-id", "resource", "sales.exports.read", true), movementField("artifact-expires-at", "datetime", "sales.exports.read", true), movementField("revision", "integer", "sales.exports.read")]);
export const salesDedupeCandidateFields = Object.freeze([movementField("candidate-id", "integer", "sales.records.merge"), movementField("candidate-revision", "integer", "sales.records.merge"), movementField("match-kind", "enum", "sales.records.merge")]);
const movementInput = (prefix: "import" | "export"): DataSourceDescriptor["inputFields"] => [{ id: `${prefix}-job-id`, kind: "integer", required: false, nullable: false }, { id: "expected-revision", kind: "integer", required: false, nullable: false }];
function movementSource(id: string, title: string, permission: string, hash: string, fields: readonly SalesSourceField[], inputFields: DataSourceDescriptor["inputFields"] = [], paginationModes: DataSourceDescriptor["paginationModes"] = ["offset"], cacheClass: DataSourceDescriptor["cacheClass"] = "authorization-context"): DataSourceDescriptor {
  return { id, version: 1, ownerPluginId: "module.sales", primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id: `${id}.output`, version: 1 }, audience: "authenticated", surfaces: ["workspace"], permission, structuralCompatibilityHash: hash, presentationMetadataRevision: 1, title, inputFields, outputFields: [...fields], paginationModes, limits: { ...salesSourceLimits, maxSelectedFields: fields.length, maxFilters: 0, maxSorts: 0, ratePerMinute: 120, burst: 12, costClass: id === "sales.dedupe.candidates" ? "medium" : "low", maxCost: id === "sales.dedupe.candidates" ? 100 : 20 }, cacheClass };
}
export const salesImportJobListDescriptor = movementSource("sales.import-job.list", "Sales import jobs", "sales.imports.read", "sha256:197b274aa0761c87f01d61114184073f3a7a298c16b7cca032fda801f06360b1", salesImportJobListFields);
export const salesImportJobDetailDescriptor = movementSource("sales.import-job.detail", "Sales import job detail", "sales.imports.read", "sha256:a9605b199390aff854f3b4f950b2c33f8076d54fac01e66d4401a8a0119ed5f0", salesImportJobDetailFields, movementInput("import"));
export const salesExportJobListDescriptor = movementSource("sales.export-job.list", "Sales export jobs", "sales.exports.read", "sha256:2eeb257f1987b2e2e611ad69fad1463db4fa09bdac135b15a6b7b268d54bd726", salesExportJobListFields);
export const salesExportJobDetailDescriptor = movementSource("sales.export-job.detail", "Sales export job detail", "sales.exports.read", "sha256:393a540189c9a65fa3a678dba311b61c05156742fb2640e7957672419225f54a", salesExportJobDetailFields, movementInput("export"));
export const salesDedupeCandidatesDescriptor = movementSource("sales.dedupe.candidates", "Sales duplicate candidates", "sales.records.merge", "sha256:288bd0c42e139d0b3b96eb76d01afee731b5d023f5546b8ef0d1dae634a53f57", salesDedupeCandidateFields, [{ id: "target-object-type", kind: "enum", required: false, nullable: false }, { id: "id", kind: "integer", required: false, nullable: false }, { id: "expected-revision", kind: "integer", required: false, nullable: false }], ["cursor"], "no-store");

export type SalesSavedViewSourceId = "sales.saved-view.table" | "sales.saved-view.kanban" | "sales.saved-view.calendar";
export type SalesSavedViewVisibility = Readonly<{ kind: "personal" } | { kind: "team"; teamId: string }>;
export interface SalesSavedViewSourceBinding { readonly id: SalesSavedViewSourceId; readonly version: 1; readonly sourceSchema: Readonly<{ id: string; version: 1 }>; readonly structuralCompatibilityHash: string; }
export interface SalesSavedViewDefinition {
  readonly kind: "table" | "kanban" | "calendar";
  readonly targetObjectId: "sales.object.account" | "sales.object.contact" | "sales.object.lead" | "sales.object.opportunity" | "sales.object.task" | "sales.object.activity";
  readonly source: SalesSavedViewSourceBinding;
  readonly fields: readonly string[];
  readonly filters: readonly Readonly<{ fieldId: string; operator: string; value?: unknown }>[];
  readonly sorts: readonly Readonly<{ fieldId: string; direction: "asc" | "desc" }>[];
  readonly grouping?: "stage-id";
  readonly dateField?: "scheduled-at" | "occurred-at";
  readonly calendarRange?: Readonly<{ start: string; end: string; timezone: string }>;
  readonly presentation: Readonly<{ density: "comfortable" | "compact" } | { mode: "agenda" | "month" }>;
  readonly pageSize: number;
}
export interface SalesSavedViewBindingInput { readonly "saved-view-id"?: number; readonly "expected-revision"?: number; }
export interface CompiledSalesSavedView { readonly selectedFields: readonly string[]; readonly query: DataSourceQueryControls; }
export interface SalesReportingTimezone { readonly timezone: string; readonly revision: number; }
export interface SalesSavedViewCompileContext { readonly reportingTimezone?: SalesReportingTimezone; readonly now?: Date; }

const savedViewDescriptors: Readonly<Record<SalesSavedViewSourceId, DataSourceDescriptor>> = Object.freeze({
  "sales.saved-view.table": salesSavedViewTableDescriptor, "sales.saved-view.kanban": salesSavedViewKanbanDescriptor, "sales.saved-view.calendar": salesSavedViewCalendarDescriptor
});
const sourceTargets: Readonly<Record<SalesSavedViewSourceId, readonly SalesSavedViewDefinition["targetObjectId"][]>> = Object.freeze({
  "sales.saved-view.table": ["sales.object.account", "sales.object.contact", "sales.object.lead", "sales.object.opportunity", "sales.object.task", "sales.object.activity"],
  "sales.saved-view.kanban": ["sales.object.opportunity"], "sales.saved-view.calendar": ["sales.object.activity"]
});
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
/** Exact persisted Saved View byte representation: recursively key-sorted and whitespace-free. */
export const canonicalSalesSavedViewJson = (value: unknown): string => JSON.stringify(JSON.parse(canonicalJson(value)));
export const isSalesBoundedNfcText = (value: unknown, maxUtf8Bytes = 120): value is string => typeof value === "string" && value.normalize("NFC") === value && !value.includes("\0") && utf8Bytes(value) >= 1 && utf8Bytes(value) <= maxUtf8Bytes;
const exactObject = (value: unknown, allowed: readonly string[], required: readonly string[]): value is Record<string, unknown> => salesRecord(value) && Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
const positiveSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && new Date(value).toISOString() === value;
const canonicalIanaTimezone = (value: unknown): value is string => {
  if (typeof value !== "string" || value.normalize("NFC") !== value || value.includes("\0") || utf8Bytes(value) < 1 || utf8Bytes(value) > 120) return false;
  try {
    return (value === "UTC" || Intl.supportedValuesOf("timeZone").includes(value)) && new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone === value;
  } catch { return false; }
};
const calendarParts = (date: Date, timezone: string): Readonly<{ year: number; month: number; day: number; hour: number; minute: number; second: number }> => {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", { calendar: "iso8601", numberingSystem: "latn", timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
  const year = values.year; const month = values.month; const day = values.day; const hour = values.hour; const minute = values.minute; const second = values.second;
  if (typeof year !== "number" || typeof month !== "number" || typeof day !== "number" || typeof hour !== "number" || typeof minute !== "number" || typeof second !== "number" || ![year, month, day, hour, minute, second].every(Number.isSafeInteger) || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 24 || minute < 0 || minute > 59 || second < 0 || second > 59) throw new TypeError("Sales reporting timezone conversion is invalid.");
  return Object.freeze({ year, month, day, hour: hour === 24 ? 0 : hour, minute, second });
};
const utcAtZonedMidnight = (year: number, month: number, day: number, timezone: string): string => {
  const expected = Date.UTC(year, month - 1, day); let candidate = expected;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = calendarParts(new Date(candidate), timezone); const actualEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = expected - actualEpoch;
    if (adjustment === 0) {
      if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== 0 || actual.minute !== 0 || actual.second !== 0) break;
      return new Date(candidate).toISOString();
    }
    candidate += adjustment;
  }
  throw new TypeError("Sales reporting timezone midnight is invalid.");
};
const calendarDaysBetween = (start: string, end: string, timezone: string): number => {
  const first = calendarParts(new Date(start), timezone); const last = calendarParts(new Date(end), timezone);
  return (Date.UTC(last.year, last.month - 1, last.day) - Date.UTC(first.year, first.month - 1, first.day)) / 86_400_000;
};
export function canonicalSalesCalendarRange(reportingTimezone: SalesReportingTimezone, now = new Date()): Readonly<{ start: string; end: string; timezone: string }> {
  if (!positiveSafeInteger(reportingTimezone.revision) || !canonicalIanaTimezone(reportingTimezone.timezone) || Number.isNaN(now.getTime())) throw new TypeError("Sales reporting timezone is invalid.");
  const current = calendarParts(now, reportingTimezone.timezone); const nextYear = current.month === 12 ? current.year + 1 : current.year; const nextMonth = current.month === 12 ? 1 : current.month + 1;
  return Object.freeze({ start: utcAtZonedMidnight(current.year, current.month, 1, reportingTimezone.timezone), end: utcAtZonedMidnight(nextYear, nextMonth, 1, reportingTimezone.timezone), timezone: reportingTimezone.timezone });
}

export function parseSalesSavedViewBindingInput(value: unknown): Readonly<{ savedViewId?: number; expectedRevision?: number }> {
  if (!salesRecord(value)) throw new TypeError("Sales saved-view binding input is invalid.");
  const keys = Object.keys(value).sort().join("\0");
  if (keys === "") return Object.freeze({});
  if (keys !== "expected-revision\0saved-view-id" || !positiveSafeInteger(value["saved-view-id"]) || !positiveSafeInteger(value["expected-revision"])) throw new TypeError("Sales saved-view binding input must be empty or an exact ID/revision pair.");
  return Object.freeze({ savedViewId: value["saved-view-id"], expectedRevision: value["expected-revision"] });
}

function savedScalar(field: SalesSourceField, value: unknown): boolean {
  if (value === null) return field.nullable;
  if (["text", "status", "enum", "resource"].includes(field.kind)) return typeof value === "string" && utf8Bytes(value) <= 512;
  if (field.kind === "integer") return Number.isSafeInteger(value);
  if (["number", "percentage", "duration"].includes(field.kind)) return typeof value === "number" && Number.isFinite(value);
  if (field.kind === "date") return isSalesCalendarDate(value);
  if (field.kind === "datetime") return instant(value);
  if (field.kind === "boolean") return typeof value === "boolean";
  if (field.kind === "decimal") return typeof value === "string" && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
  return false;
}

/** Validates the persisted closed grammar and compiles only platform query controls. */
export function compileSalesSavedViewDefinition(definition: unknown, sourceId: SalesSavedViewSourceId, selectedFields: readonly string[], pageNumber: number, context: SalesSavedViewCompileContext = {}): CompiledSalesSavedView {
  const descriptor = savedViewDescriptors[sourceId];
  if (!positiveSafeInteger(pageNumber) || pageNumber > 1_000_000 || !exactObject(definition, ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "grouping", "calendarRange", "dateField", "presentation", "pageSize"], ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "presentation", "pageSize"]) || utf8Bytes(canonicalSalesSavedViewJson(definition)) > 16_384) throw new TypeError("Sales saved-view definition is invalid.");
  const view = definition as unknown as SalesSavedViewDefinition;
  const expectedKind = sourceId.slice("sales.saved-view.".length);
  const source = view.source;
  if (view.kind !== expectedKind || !sourceTargets[sourceId].includes(view.targetObjectId) || !exactObject(source, ["id", "version", "sourceSchema", "structuralCompatibilityHash"], ["id", "version", "sourceSchema", "structuralCompatibilityHash"]) || source.id !== descriptor.id || source.version !== descriptor.version || canonicalJson(source.sourceSchema) !== canonicalJson(descriptor.sourceSchema) || source.structuralCompatibilityHash !== descriptor.structuralCompatibilityHash) throw new TypeError("Sales saved-view source binding is stale or forged.");
  const fields = descriptor.outputFields ?? [];
  if (!Array.isArray(view.fields) || view.fields.length < 1 || view.fields.length > 8 || new Set(view.fields).size !== view.fields.length || view.fields.some((id) => typeof id !== "string" || !fields.some((field) => field.id === id)) || selectedFields.join("\0") !== view.fields.join("\0") || fields.some((field) => field.binding === "required" && !view.fields.includes(field.id))) throw new TypeError("Sales saved-view selected fields are invalid.");
  if (!Array.isArray(view.filters) || view.filters.length > (view.kind === "calendar" ? 6 : 8) || !Array.isArray(view.sorts) || view.sorts.length > 2) throw new TypeError("Sales saved-view query exceeds its bounds.");
  const filters = view.filters.map((filter) => {
    if (!exactObject(filter, ["fieldId", "operator", "value"], ["fieldId", "operator"]) || typeof filter.fieldId !== "string" || typeof filter.operator !== "string") throw new TypeError("Sales saved-view filter is invalid.");
    const field = fields.find((candidate) => candidate.id === filter.fieldId);
    const nullOperator = filter.operator === "is-null" || filter.operator === "is-not-null";
    const arrayOperator = filter.operator === "in" || filter.operator === "not-in";
    if (field === undefined || !view.fields.includes(field.id) || !field.filterOperators.includes(filter.operator as never) || nullOperator === Object.hasOwn(filter, "value")) throw new TypeError("Sales saved-view filter is invalid.");
    if (!nullOperator) {
      const value = filter.value;
      if (arrayOperator ? !Array.isArray(value) || value.length < 1 || value.length > 20 || new Set(value.map((item) => item === null ? "null" : typeof item)).size !== 1 || !value.every((item) => savedScalar(field, item)) : !savedScalar(field, value)) throw new TypeError("Sales saved-view filter value is invalid.");
    }
    return Object.freeze({ field: filter.fieldId, operator: filter.operator, ...(nullOperator ? {} : { value: filter.value }) });
  });
  const seenSorts = new Set<string>();
  const sort = view.sorts.map((item) => {
    if (!exactObject(item, ["fieldId", "direction"], ["fieldId", "direction"]) || typeof item.fieldId !== "string" || typeof item.direction !== "string" || !view.fields.includes(item.fieldId) || seenSorts.has(item.fieldId) || !["asc", "desc"].includes(item.direction)) throw new TypeError("Sales saved-view sort is invalid.");
    const field = fields.find((candidate) => candidate.id === item.fieldId); if (field?.sortable !== true) throw new TypeError("Sales saved-view sort is invalid."); seenSorts.add(item.fieldId);
    return Object.freeze({ field: item.fieldId, direction: item.direction });
  });
  if (!positiveSafeInteger(view.pageSize) || view.pageSize > 100 || view.kind === "kanban" && view.pageSize < 7) throw new TypeError("Sales saved-view page size is invalid.");
  const presentation = view.presentation as Record<string, unknown>;
  if (view.kind === "table" && (view.grouping !== undefined || view.calendarRange !== undefined || view.dateField !== undefined || !exactObject(presentation, ["density"], ["density"]) || !["comfortable", "compact"].includes(presentation.density as string))) throw new TypeError("Sales table-view discriminator is invalid.");
  if (view.kind === "kanban" && (view.targetObjectId !== "sales.object.opportunity" || view.grouping !== "stage-id" || view.calendarRange !== undefined || view.dateField !== undefined || view.fields.join("\0") !== "row-kind\0name\0stage-id\0stage-metadata\0revision" || !exactObject(presentation, ["density"], ["density"]) || !["comfortable", "compact"].includes(presentation.density as string))) throw new TypeError("Sales Kanban-view discriminator is invalid.");
  if (view.kind === "calendar") {
    const reportingTimezone = context.reportingTimezone;
    if (view.targetObjectId !== "sales.object.activity" || view.grouping !== undefined || !["scheduled-at", "occurred-at"].includes(view.dateField as string) || !view.fields.includes(view.dateField!) || !exactObject(presentation, ["mode"], ["mode"]) || !["agenda", "month"].includes(presentation.mode as string) || !exactObject(view.calendarRange, ["start", "end", "timezone"], ["start", "end", "timezone"]) || !instant(view.calendarRange.start) || !instant(view.calendarRange.end) || reportingTimezone === undefined || !positiveSafeInteger(reportingTimezone.revision) || !canonicalIanaTimezone(reportingTimezone.timezone) || view.calendarRange.timezone !== reportingTimezone.timezone) throw new TypeError("Sales calendar-view discriminator is invalid.");
    const start = Date.parse(view.calendarRange.start); const end = Date.parse(view.calendarRange.end); const calendarDays = calendarDaysBetween(view.calendarRange.start, view.calendarRange.end, reportingTimezone.timezone); if (end <= start || !Number.isSafeInteger(calendarDays) || calendarDays < 1 || calendarDays > 31) throw new TypeError("Sales calendar-view range is invalid.");
    const dateField = view.dateField!; filters.push(Object.freeze({ field: dateField, operator: "gte", value: view.calendarRange.start }), Object.freeze({ field: dateField, operator: "lt", value: view.calendarRange.end }));
  }
  return Object.freeze({ selectedFields: Object.freeze([...view.fields]), query: Object.freeze({ filters: Object.freeze(filters), sort: Object.freeze(sort), page: Object.freeze({ number: pageNumber, size: view.pageSize }) }) as DataSourceQueryControls });
}

export function validateSalesPipelineSnapshotInput(value: unknown, applicationId: string, environment: string, deriveStageId: (applicationId: string, environment: string, pipelineId: number, semantic: SalesOpportunityStage) => string): Readonly<Record<string, unknown>> {
  if (!exactObject(value, ["id", "expectedRevision", "name", "orderedStageIds", "stages"], ["id", "expectedRevision", "name", "orderedStageIds", "stages"]) || !positiveSafeInteger(Number(value.id)) || !positiveSafeInteger(value.expectedRevision) || typeof value.name !== "string" || !isSalesBoundedNfcText(value.name.trim()) || !Array.isArray(value.orderedStageIds) || value.orderedStageIds.length !== 6 || new Set(value.orderedStageIds).size !== 6 || !Array.isArray(value.stages) || value.stages.length !== 6) throw new TypeError("Sales pipeline snapshot is invalid.");
  const pipelineId = Number(value.id); const orderedStageIds = value.orderedStageIds as unknown[]; const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] as const; const seen = new Set<string>();
  const stages: readonly Readonly<Record<string, unknown>>[] = value.stages.map((raw, index): Readonly<Record<string, unknown>> => {
    if (!exactObject(raw, ["stageId", "expectedRevision", "semantic", "name", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds"], ["stageId", "expectedRevision", "semantic", "name", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds"]) || typeof raw.semantic !== "string" || !semantics.includes(raw.semantic as typeof semantics[number]) || seen.has(raw.semantic) || raw.stageId !== deriveStageId(applicationId, environment, pipelineId, raw.semantic as SalesOpportunityStage) || raw.position !== index || orderedStageIds[index] !== raw.stageId || !positiveSafeInteger(raw.expectedRevision) || typeof raw.name !== "string" || !isSalesBoundedNfcText(raw.name.trim()) || !Number.isSafeInteger(raw.probabilityBasisPoints) || (raw.probabilityBasisPoints as number) < 0 || (raw.probabilityBasisPoints as number) > 10_000 || !Array.isArray(raw.allowedTransitionStageIds) || new Set(raw.allowedTransitionStageIds).size !== raw.allowedTransitionStageIds.length || !Array.isArray(raw.requiredFieldIds)) throw new TypeError("Sales pipeline stage snapshot is invalid.");
    seen.add(raw.semantic);
    return Object.freeze({ ...(raw as Readonly<Record<string, unknown>>), name: raw.name.trim() });
  });
  if (seen.size !== 6 || stages[4]?.semantic !== "won" || stages[5]?.semantic !== "lost" || stages.slice(0, 4).some((stage) => !["qualification", "discovery", "proposal", "negotiation"].includes(String(stage.semantic)))) throw new TypeError("Sales pipeline semantic positions are invalid.");
  const byId = new Map(stages.map((stage) => [stage.stageId as string, stage])); const trusted: Readonly<Record<string, readonly string[]>> = { qualification: ["discovery", "lost"], discovery: ["proposal", "lost"], proposal: ["negotiation", "lost"], negotiation: ["won", "lost"], won: [], lost: [] };
  for (const stage of stages) {
    const destinations = stage.allowedTransitionStageIds as unknown[]; if (destinations.some((id) => typeof id !== "string" || !byId.has(id) || !trusted[stage.semantic as string]!.includes(String(byId.get(id)?.semantic)))) throw new TypeError("Sales pipeline transition graph is invalid.");
    const required = stage.requiredFieldIds as unknown[]; const expected = stage.semantic === "lost" ? ["lossReason"] : []; if (canonicalJson(required) !== canonicalJson(expected)) throw new TypeError("Sales pipeline transition requirements are invalid.");
  }
  return Object.freeze({ ...value, name: value.name.trim(), stages: Object.freeze(stages) });
}

export const salesTimelineFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  crmField("kind", "text", "sales.activities.read"),
  crmField("subject", "text", "sales.activities.read"),
  crmField("status", "status", "sales.activities.read"),
  crmField("occurred-at", "text", "sales.activities.read"),
  crmField("revision", "integer", "sales.activities.read"),
  crmField("body", "text", "sales.notes.body.read", true)
];
export const salesTimelineDescriptor = crmSource("sales.timeline", 1, "sales.activities.read", "Sales activity timeline", salesTimelineFields, "sha256:660c102d6dce2f6090f5452cb6400886d59fd19f32eec75f2e09885761eacfa2", [
  { id: "related-record-type", kind: "string", required: true, nullable: false },
  { id: "related-record-id", kind: "string", required: true, nullable: false }
]);

/** Recipient-scoped work queues expose neither provider data nor credential references. */
export const salesNotificationFields = Object.freeze([
  crmField("subject", "text", "sales.notifications.read"), crmField("state", "status", "sales.notifications.read"),
  crmField("created-at", "datetime", "sales.notifications.read"), crmField("revision", "integer", "sales.notifications.read")
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesReminderFields = Object.freeze([
  crmField("subject", "text", "sales.reminders.read"), crmField("state", "status", "sales.reminders.read"),
  crmField("scheduled-at", "datetime", "sales.reminders.read"), crmField("reference-kind", "enum", "sales.reminders.read"),
  crmField("reference-id", "integer", "sales.reminders.read"), crmField("revision", "integer", "sales.reminders.read")
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
/** Public provider configuration status. Secret references and values are intentionally unrepresentable. */
export const salesProviderConfigurationFields = Object.freeze([
  crmField("provider-id", "enum", "sales.settings.read"), crmField("state", "status", "sales.settings.read"),
  crmField("revision", "integer", "sales.settings.read"), crmField("updated-at", "datetime", "sales.settings.read"),
  crmField("revoked-at", "datetime", "sales.settings.read", true)
] satisfies NonNullable<DataSourceDescriptor["outputFields"]>);
export const salesNotificationsDescriptor = crmSource("sales.notifications", 1, "sales.notifications.read", "Sales notifications", [...salesNotificationFields], "sha256:1ed4ed6955fbb2ba337e2b84e0cf9b2a9744230b05c7bbf187e69b8848f593c0");
export const salesRemindersDescriptor = crmSource("sales.reminders", 1, "sales.reminders.read", "Sales reminders", [...salesReminderFields], "sha256:a2f87efad77edab1c705faa3640065f1060cb6403f2e1e0633f8333225e42564");
export const salesProviderConfigurationsDescriptor = crmSource("sales.provider-configurations", 1, "sales.settings.read", "Sales provider configurations", [...salesProviderConfigurationFields], "sha256:b7f2815c8115bbb72c9f9843d1b7b083d92f856fec61b2dc28f77e393c4c911e");

function crmCell(field: SalesSourceField, cell: unknown): boolean {
  if (cell === null) return field.nullable;
  if (!salesRecord(cell) || cell.kind !== field.kind) return false;
  if (field.kind === "resource") return true;
  if (Object.keys(cell).join("\u0000") !== "kind\u0000value") return false;
  if (field.kind === "integer") {
    const minimum = field.id === "accepted-rows" || field.id === "rejected-rows" || field.id === "row-count" ? 0 : 1;
    const maximum = ["sales.imports.read", "sales.exports.read", "sales.records.merge"].includes(field.permission) ? Number.MAX_SAFE_INTEGER : 2_147_483_647;
    return Number.isSafeInteger(cell.value) && (cell.value as number) >= minimum && (cell.value as number) <= maximum;
  }
  if (field.kind === "status") {
    const allowed = field.permission === "sales.accounts.read" || field.permission === "sales.contacts.read" ? ["active", "archived", "merged"]
      : field.permission === "sales.leads.read" ? field.id === "archive-status" ? ["active", "archived"] : ["new", "working", "qualified", "disqualified"]
      : field.permission === "sales.imports.read" ? ["draft", "validated", "queued", "running", "succeeded", "partially-failed", "failed", "cancelled"]
      : field.permission === "sales.exports.read" ? ["queued", "running", "succeeded", "failed", "cancelled"]
      : field.permission === "sales.notifications.read" ? ["unread", "read", "archived"]
      : field.permission === "sales.reminders.read" ? ["scheduled", "delivered", "dismissed", "cancelled", "failed"]
      : field.permission === "sales.settings.read" ? ["active", "revoked"]
      : undefined;
    return typeof cell.value === "string" && (allowed === undefined ? cell.value.length > 0 && cell.value.length <= 64 : allowed.includes(cell.value));
  }
  if (field.kind === "enum") {
    const allowed = field.id === "target-object-type" ? ["sales.object.lead", "sales.object.account", "sales.object.contact"]
      : field.id === "match-kind" ? ["account-name", "contact-email", "contact-phone", "contact-email-and-phone"]
      : field.id === "diagnostic-code" ? ["IMPORT_INVALID_ENCODING", "IMPORT_INVALID_CSV", "IMPORT_UNSAFE_FORMULA", "IMPORT_LIMIT_EXCEEDED", "IMPORT_PROTECTED_FIELD", "IMPORT_MAPPING_INVALID", "IMPORT_UPLOAD_BINDING_INVALID", "IMPORT_REQUIRED_VALUE", "IMPORT_VALUE_INVALID", "IMPORT_CONTACT_ACCOUNT_FORBIDDEN", "IMPORT_ROW_CONFLICT", "IMPORT_WORKER_RETRY_EXHAUSTED", "DEDUPE_CANDIDATE_LIMIT", "STALE_RECORD", "ACTION_FORBIDDEN", "NOT_FOUND", "ARTIFACT_EXPIRED", "ARTIFACT_FORBIDDEN", "IDEMPOTENCY_CONFLICT"]
      : field.id === "reference-kind" ? ["task", "activity"]
      : field.id === "provider-id" ? ["email.reference.v1", "calendar.reference.v1"]
      : undefined;
    return typeof cell.value === "string" && allowed !== undefined && allowed.includes(cell.value);
  }
  if (field.kind === "datetime") return typeof cell.value === "string" && isCanonicalUtcInstant(cell.value);
  return typeof cell.value === "string" && cell.value.length > 0 && cell.value.length <= 10_000;
}
function crmTableSchema(fields: readonly SalesSourceField[]): RuntimeSchema<TableRecords> {
  const ids = new Set(fields.map(({ id }) => id)); const required = new Set(fields.filter(({ binding }) => binding === "required").map(({ id }) => id));
  return { safeParse(value) {
    const parsed = TableRecordsSchema.safeParse(value);
    if (!parsed.success) return parsed;
    if (parsed.data.fields.some((id) => !ids.has(id)) || [...required].some((id) => !parsed.data.fields.includes(id)) || parsed.data.rows.some((row) => Object.keys(row.values).join("\u0000") !== parsed.data.fields.join("\u0000") || parsed.data.fields.some((id) => !crmCell(fields.find((field) => field.id === id)!, row.values[id])))) return invalidRuntimeValue("Sales CRM source output is invalid.");
    return parsed;
  } };
}
export const salesAccountsOutputRuntimeSchema = crmTableSchema(salesAccountFields);
export const salesContactsOutputRuntimeSchema = crmTableSchema(salesContactFields);
export const salesLeadsOutputRuntimeSchema = crmTableSchema(salesLeadFields);
export const salesAccountDetailOutputRuntimeSchema = crmTableSchema(salesAccountFields);
export const salesContactDetailOutputRuntimeSchema = crmTableSchema(salesContactFields);
const baseSalesLeadDetailOutputRuntimeSchema = crmTableSchema(salesLeadDetailFields);
export const salesLeadDetailOutputRuntimeSchema: RuntimeSchema<TableRecords> = { safeParse(value) {
  const parsed = baseSalesLeadDetailOutputRuntimeSchema.safeParse(value); if (!parsed.success) return parsed;
  for (const row of parsed.data.rows) {
    const lifecycleFields = ["decided-at", "qualified-at", "disqualified-at"] as const;
    if (!lifecycleFields.some((field) => parsed.data.fields.includes(field))) continue;
    const status = (row.values.status as { readonly value?: unknown } | undefined)?.value;
    const validInstant = (field: string) => row.values[field] === null || salesRecord(row.values[field]) && row.values[field]?.kind === "text" && typeof row.values[field]?.value === "string" && isCanonicalUtcInstant(row.values[field]?.value);
    const present = (field: string) => row.values[field] !== null;
    const lifecycleInvalid = status === "qualified" ? !(present("decided-at") && present("qualified-at") && !present("disqualified-at")) : status === "disqualified" ? !(present("decided-at") && !present("qualified-at") && present("disqualified-at")) : present("decided-at") || present("qualified-at") || present("disqualified-at");
    if (!lifecycleFields.every((field) => parsed.data.fields.includes(field)) || !lifecycleFields.every(validInstant) || lifecycleInvalid) return invalidRuntimeValue("Sales Lead detail lifecycle is invalid.");
  }
  return parsed;
} };
export const salesTimelineOutputRuntimeSchema = crmTableSchema(salesTimelineFields);
export const salesNotificationsOutputRuntimeSchema = crmTableSchema(salesNotificationFields);
export const salesRemindersOutputRuntimeSchema = crmTableSchema(salesReminderFields);
export const salesProviderConfigurationsOutputRuntimeSchema = crmTableSchema(salesProviderConfigurationFields);
export const salesImportJobListOutputRuntimeSchema = crmTableSchema(salesImportJobListFields);
export const salesImportJobDetailOutputRuntimeSchema = crmTableSchema(salesImportJobDetailFields);
export const salesExportJobListOutputRuntimeSchema = crmTableSchema(salesExportJobListFields);
export const salesExportJobDetailOutputRuntimeSchema = crmTableSchema(salesExportJobDetailFields);
export const salesDedupeCandidatesOutputRuntimeSchema = crmTableSchema(salesDedupeCandidateFields);

const movementPairInput = (job: "import-job-id" | "export-job-id"): RuntimeSchema<Readonly<Record<string, number>>> => ({ safeParse(value) {
  if (!salesRecord(value)) return invalidRuntimeValue("Sales job source input is invalid.");
  if (Object.keys(value).length === 0) return { success: true as const, data: Object.freeze({}) };
  if (!exactObject(value, [job, "expected-revision"], [job, "expected-revision"]) || !positiveSafeInteger(value[job]) || !positiveSafeInteger(value["expected-revision"])) return invalidRuntimeValue("Sales job source input is invalid.");
  return { success: true as const, data: Object.freeze({ [job]: value[job] as number, "expected-revision": value["expected-revision"] as number }) };
} });
export const salesImportJobDetailInputRuntimeSchema = movementPairInput("import-job-id");
export const salesExportJobDetailInputRuntimeSchema = movementPairInput("export-job-id");
export const salesDedupeCandidatesInputRuntimeSchema: RuntimeSchema<Readonly<Record<string, unknown>>> = { safeParse(value) {
  if (!salesRecord(value)) return invalidRuntimeValue("Sales dedupe input is invalid.");
  if (Object.keys(value).length === 0) return { success: true as const, data: Object.freeze({}) };
  if (!exactObject(value, ["target-object-type", "id", "expected-revision"], ["target-object-type", "id", "expected-revision"]) || !["sales.object.account", "sales.object.contact"].includes(String(value["target-object-type"])) || !positiveSafeInteger(value.id) || !positiveSafeInteger(value["expected-revision"])) return invalidRuntimeValue("Sales dedupe input is invalid.");
  return { success: true as const, data: Object.freeze({ ...value }) };
} };

export const salesCrmDetailInputRuntimeSchema: RuntimeSchema<Readonly<{ id: string }>> = {
  safeParse(value) {
    return salesRecord(value) && Object.keys(value).join("\u0000") === "id" && isSalesRecordId(value.id)
      ? { success: true as const, data: { id: value.id } }
      : invalidRuntimeValue("Sales detail input is invalid.");
  }
};
export const salesTimelineInputRuntimeSchema: RuntimeSchema<Readonly<{ relatedRecordType: "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task"; relatedRecordId: string }>> = {
  safeParse(value) {
    const types = ["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"] as const;
    const type = salesRecord(value) ? value["related-record-type"] : undefined; const id = salesRecord(value) ? value["related-record-id"] : undefined;
    return salesRecord(value) && Object.keys(value).sort().join("\u0000") === "related-record-id\u0000related-record-type" && isSalesRecordId(id) && types.includes(type as typeof types[number])
      ? { success: true as const, data: { relatedRecordType: type as typeof types[number], relatedRecordId: id } }
      : invalidRuntimeValue("Sales timeline input is invalid.");
  }
};

const salesSearchTasksInputSchema: AgentToolDescriptor["inputSchema"] = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 }
  },
  required: ["title"],
  additionalProperties: false
};

const salesCreateTaskInputSchema: AgentToolDescriptor["inputSchema"] = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 256 }
  },
  required: ["title"],
  additionalProperties: false
};

const salesCreateTaskOutputSchema: AgentToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    title: { type: "string", minLength: 1, maxLength: 256 },
    status: { type: "string", enum: ["open", "completed", "cancelled"] },
    revision: { type: "integer", minimum: 1 }
  },
  required: ["id", "title", "status", "revision"],
  additionalProperties: false
};

export const salesTaskTablePropsSchema = {
  type: "object" as const,
  properties: { title: { type: "string" as const, minLength: 1, maxLength: 120 } },
  required: ["title"],
  additionalProperties: false as const
};

const salesToolLimits = Object.freeze({
  timeoutMs: 5_000,
  maxConcurrency: 4,
  ratePerMinute: 120,
  burst: 10,
  costClass: "low" as const,
  maxCost: 10
});

export interface CreateTaskInput {
  readonly title: string;
}

export interface CreateTaskOutput {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "completed" | "cancelled";
  readonly revision: number;
}

export interface UpdateTaskInput { readonly id: string; readonly expectedRevision: number; readonly expectedStatus: "open"; readonly status: "completed" | "cancelled"; }
export interface UpdateTaskOutput { readonly id: string; readonly title: string; readonly status: "open" | "completed" | "cancelled"; readonly revision: number; }
export type SalesOpportunityStage = "qualification" | "discovery" | "proposal" | "negotiation" | "won" | "lost";
export interface UpdateOpportunityStageInput {
  readonly id: string;
  readonly expectedRevision: number;
  readonly expectedPipelineId: string;
  readonly expectedPipelineRevision: number;
  readonly expectedSourceStageId: string;
  readonly expectedSourceStageRevision: number;
  readonly destinationStageId: string;
  readonly expectedDestinationStageRevision: number;
}
export interface UpdateOpportunityStageOutput {
  readonly id: string;
  readonly revision: number;
  readonly pipelineId: string;
  readonly stageId: string;
}

const salesRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const invalidRuntimeValue = (message: string) => ({ success: false as const, error: new Error(message) });
const salesRecordIdRegex = new RegExp(salesRecordIdPattern, "u");
const salesPrincipalIdentityRegex = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u;
export function isSalesRecordId(value: unknown): value is string { return typeof value === "string" && salesRecordIdRegex.test(value); }
const salesRecordIdKeys = new Set(["id", "accountId", "contactId", "opportunityId", "pipelineId", "relatedRecordId", "primaryContactId", "supersedesActivityId", "replacesNoteId"]);
const salesPrincipalIdentityKeys = new Set(["ownerId", "teamId"]);
function isCanonicalUtcInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

export const salesEmptyInputRuntimeSchema: RuntimeSchema<Record<string, never>> = {
  safeParse(value) {
    return salesRecord(value) && Object.keys(value).length === 0
      ? { success: true as const, data: {} }
      : invalidRuntimeValue("Sales data-source input must be empty.");
  }
};

export const salesCreateTaskInputRuntimeSchema: RuntimeSchema<CreateTaskInput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).join("\u0000") !== "title") {
      return invalidRuntimeValue("Sales task input must be a closed object.");
    }
    if (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256) return invalidRuntimeValue("Sales task title is invalid.");
    return { success: true as const, data: { title: value.title } };
  }
};

export const salesCreateTaskOutputRuntimeSchema: RuntimeSchema<CreateTaskOutput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000revision\u0000status\u0000title" ||
      !boundedLegacyId(value.id) ||
      typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256 ||
      !["open", "completed", "cancelled"].includes(value.status as string) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) return invalidRuntimeValue("Sales task action output is invalid.");
    return { success: true as const, data: value as unknown as CreateTaskOutput };
  }
};

function boundedLegacyId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128; }

export const salesUpdateTaskInputRuntimeSchema: RuntimeSchema<UpdateTaskInput> = {
  safeParse(value) {
    if (!salesRecord(value) || !boundedLegacyId(value.id) || Object.keys(value).sort().join("\u0000") !== "expectedRevision\u0000expectedStatus\u0000id\u0000status" ||
      !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1 ||
      value.expectedStatus !== "open" || !["completed", "cancelled"].includes(value.status as string)) return invalidRuntimeValue("Sales task update input is invalid.");
    return { success: true as const, data: value as unknown as UpdateTaskInput };
  }
};

export const salesUpdateTaskOutputRuntimeSchema: RuntimeSchema<UpdateTaskOutput> = salesCreateTaskOutputRuntimeSchema;

export const salesOpportunityStageInputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageInput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "destinationStageId\u0000expectedDestinationStageRevision\u0000expectedPipelineId\u0000expectedPipelineRevision\u0000expectedRevision\u0000expectedSourceStageId\u0000expectedSourceStageRevision\u0000id" || !boundedLegacyId(value.id) || !isSalesRecordId(value.expectedPipelineId) ||
      ![value.expectedRevision, value.expectedPipelineRevision, value.expectedSourceStageRevision, value.expectedDestinationStageRevision].every((revision) => Number.isSafeInteger(revision) && (revision as number) >= 1) ||
      ![value.expectedSourceStageId, value.destinationStageId].every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id))) {
      return invalidRuntimeValue("Sales opportunity stage input is invalid.");
    }
    return { success: true as const, data: value as unknown as UpdateOpportunityStageInput };
  }
};

export const salesOpportunityStageOutputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageOutput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000pipelineId\u0000revision\u0000stageId" || !boundedLegacyId(value.id) || !isSalesRecordId(value.pipelineId) || typeof value.stageId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.stageId) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
      return invalidRuntimeValue("Sales opportunity stage output is invalid.");
    }
    return { success: true as const, data: value as unknown as UpdateOpportunityStageOutput };
  }
};

const salesTaskOutputFieldIds = new Set(salesTaskFields.map((field) => field.id));
const salesRequiredTaskOutputFieldIds = new Set(salesTaskFields.filter((field) => field.binding === "required").map((field) => field.id));

function exactSalesTaskCell(fieldId: string, cell: unknown): boolean {
  const field = salesTaskFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return false;
  if (cell === null) return field.nullable;
  if (!salesRecord(cell) || cell.kind !== field.kind) return false;
  if (Object.keys(cell).join("\u0000") !== "kind\u0000value" || !field.nullable && cell.value === null) return false;
  return fieldId !== "status" || ["open", "completed", "cancelled"].includes(cell.value as string);
}

export const salesTasksOutputRuntimeSchema: RuntimeSchema<TableRecords> = {
  safeParse(value) {
    const parsed = TableRecordsSchema.safeParse(value);
    if (!parsed.success) return parsed;
    const { fields, rows } = parsed.data;
    if (fields.some((fieldId) => !salesTaskOutputFieldIds.has(fieldId)) || [...salesRequiredTaskOutputFieldIds].some((fieldId) => !fields.includes(fieldId))) {
      return invalidRuntimeValue("Sales task output fields do not match the source descriptor.");
    }
    for (const row of rows) {
      if (Object.keys(row.values).join("\u0000") !== fields.join("\u0000") || fields.some((fieldId) => !exactSalesTaskCell(fieldId, row.values[fieldId]))) {
        return invalidRuntimeValue("Sales task row cells do not match the source descriptor.");
      }
    }
    return parsed;
  }
};

const opportunityFieldIds = new Set(salesOpportunityFields.map((field) => field.id));
const requiredOpportunityFieldIds = new Set(salesOpportunityFields.filter((field) => field.binding === "required").map((field) => field.id));
const opportunityStages = Object.freeze(["qualification", "discovery", "proposal", "negotiation", "won", "lost"] as const);

function exactSalesOpportunityCell(fieldId: string, cell: unknown): boolean {
  const field = salesOpportunityFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return false;
  if (cell === null) return field.nullable;
  if (!salesRecord(cell) || cell.kind !== field.kind || !field.nullable && cell.value === null) return false;
  if (fieldId === "name" || fieldId === "stage-name") return typeof cell.value === "string" && cell.value.length > 0;
  if (fieldId === "stage-id") return typeof cell.value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(cell.value);
  if (fieldId === "stage-semantic") return typeof cell.value === "string" && opportunityStages.includes(cell.value as typeof opportunityStages[number]);
  if (["pipeline-id", "pipeline-revision", "stage-revision", "revision"].includes(fieldId)) return Number.isSafeInteger(cell.value) && (cell.value as number) >= 1 && (cell.value as number) <= 2_147_483_647;
  return fieldId === "amount" && typeof cell.value === "string" && /^[A-Z]{3}$/u.test(cell.currency as string) && Number.isSafeInteger(cell.scale) && (cell.scale as number) >= 0 && (cell.scale as number) <= 18;
}

export const salesOpportunitiesOutputRuntimeSchema: RuntimeSchema<TableRecords> = {
  safeParse(value) {
    const parsed = TableRecordsSchema.safeParse(value);
    if (!parsed.success) return parsed;
    const { fields, rows } = parsed.data;
    if (fields.some((fieldId) => !opportunityFieldIds.has(fieldId)) || [...requiredOpportunityFieldIds].some((fieldId) => !fields.includes(fieldId))) {
      return invalidRuntimeValue("Sales opportunity output fields are invalid.");
    }
    for (const row of rows) {
      if (Object.keys(row.values).join("\u0000") !== fields.join("\u0000") || fields.some((fieldId) => !exactSalesOpportunityCell(fieldId, row.values[fieldId]))) {
        return invalidRuntimeValue("Sales opportunity row cells do not match the source descriptor.");
      }
    }
    return parsed;
  }
};

const opportunityDetailFieldIds = new Set(salesOpportunityDetailFields.map((field) => field.id));
const requiredOpportunityDetailFieldIds = new Set(salesOpportunityDetailFields.filter((field) => field.binding === "required").map((field) => field.id));

function exactSalesOpportunityDetailCell(fieldId: string, cell: unknown): boolean {
  if (opportunityFieldIds.has(fieldId)) return exactSalesOpportunityCell(fieldId, cell);
  const field = salesOpportunityDetailFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined || cell === null) return field?.nullable === true;
  if (!salesRecord(cell) || cell.kind !== field.kind || cell.value === null) return false;
  return field.kind === "integer"
    ? Number.isSafeInteger(cell.value) && (cell.value as number) >= 1 && (cell.value as number) <= 2_147_483_647
      : field.id === "archive-status"
      ? cell.value === "active" || cell.value === "archived"
      : field.id === "expected-close-date"
        ? isSalesCalendarDate(cell.value)
      : typeof cell.value === "string";
}

export const salesOpportunityDetailOutputRuntimeSchema: RuntimeSchema<TableRecords> = {
  safeParse(value) {
    const parsed = TableRecordsSchema.safeParse(value);
    if (!parsed.success) return parsed;
    const { fields, rows } = parsed.data;
    if (fields.some((fieldId) => !opportunityDetailFieldIds.has(fieldId)) || [...requiredOpportunityDetailFieldIds].some((fieldId) => !fields.includes(fieldId))) {
      return invalidRuntimeValue("Sales opportunity detail output fields are invalid.");
    }
    for (const row of rows) {
      if (Object.keys(row.values).join("\u0000") !== fields.join("\u0000") || fields.some((fieldId) => !exactSalesOpportunityDetailCell(fieldId, row.values[fieldId]))) {
        return invalidRuntimeValue("Sales opportunity detail row cells do not match the source descriptor.");
      }
    }
    return parsed;
  }
};

export const salesTaskCreateDescriptor = {
  id: "sales.task.create",
  version: 2,
  ownerPluginId: "module.sales",
  inputSchema: salesCreateTaskInputSchema,
  outputSchema: salesCreateTaskOutputSchema,
  permission: "sales.tasks.write",
  policy: "sales.policy.tasks.current",
  effect: "write" as const,
  idempotency: "required" as const,
  dryRun: false
} as const;

export const salesTaskUpdateDescriptor: ActionDescriptor = {
  id: "sales.task.update",
  version: 2,
  ownerPluginId: "module.sales",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 128 },
      expectedRevision: { type: "integer", minimum: 1 },
      expectedStatus: { type: "string", enum: ["open"] },
      status: { type: "string", enum: ["completed", "cancelled"] }
    },
    required: ["id", "expectedRevision", "expectedStatus", "status"],
    additionalProperties: false
  },
  outputSchema: salesCreateTaskOutputSchema,
  permission: "sales.tasks.write",
  policy: "sales.policy.tasks.current",
  effect: "write" as const,
  idempotency: "required" as const,
  dryRun: false
};

export const salesOpportunityStageUpdateDescriptor: ActionDescriptor = {
  id: "sales.opportunity.stage.update",
  version: 3,
  ownerPluginId: "module.sales",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 128 },
      expectedRevision: { type: "integer", minimum: 1 },
      expectedPipelineId: { type: "string", minLength: 1, maxLength: 10 },
      expectedPipelineRevision: { type: "integer", minimum: 1 },
      expectedSourceStageId: { type: "string", minLength: 36, maxLength: 36 },
      expectedSourceStageRevision: { type: "integer", minimum: 1 },
      destinationStageId: { type: "string", minLength: 36, maxLength: 36 },
      expectedDestinationStageRevision: { type: "integer", minimum: 1 }
    },
    required: ["id", "expectedRevision", "expectedPipelineId", "expectedPipelineRevision", "expectedSourceStageId", "expectedSourceStageRevision", "destinationStageId", "expectedDestinationStageRevision"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 128 },
      revision: { type: "integer", minimum: 1 }, pipelineId: { type: "string", minLength: 1, maxLength: 10 }, stageId: { type: "string", minLength: 36, maxLength: 36 }
    },
    required: ["id", "revision", "pipelineId", "stageId"],
    additionalProperties: false
  },
  permission: "sales.opportunities.stage.update",
  policy: "sales.policy.opportunities.current",
  effect: "write" as const,
  idempotency: "required" as const,
  dryRun: false
};

function workflowActionDescriptor(id: string): ActionDescriptor {
  const descriptor = salesCrmActionDescriptors.find((candidate) => candidate.id === id);
  if (descriptor === undefined) throw new TypeError(`Missing frozen Sales action ${id}.`);
  return descriptor;
}

export const salesAccountCreateDescriptor = workflowActionDescriptor("sales.account.create");
export const salesAccountUpdateDescriptor = workflowActionDescriptor("sales.account.update");
export const salesAccountArchiveDescriptor = workflowActionDescriptor("sales.account.archive");
export const salesContactCreateDescriptor = workflowActionDescriptor("sales.contact.create");
export const salesContactUpdateDescriptor = workflowActionDescriptor("sales.contact.update");
export const salesContactArchiveDescriptor = workflowActionDescriptor("sales.contact.archive");
export const salesLeadCreateDescriptor = workflowActionDescriptor("sales.lead.create");
export const salesLeadUpdateDescriptor = workflowActionDescriptor("sales.lead.update");
export const salesLeadQualifyDescriptor = workflowActionDescriptor("sales.lead.qualify");
export const salesLeadDisqualifyDescriptor = workflowActionDescriptor("sales.lead.disqualify");
export const salesLeadArchiveDescriptor = workflowActionDescriptor("sales.lead.archive");
export const salesOpportunityCreateDescriptor = workflowActionDescriptor("sales.opportunity.create");
export const salesOpportunityUpdateDescriptor = workflowActionDescriptor("sales.opportunity.update");
export const salesOpportunityCloseDescriptor = workflowActionDescriptor("sales.opportunity.close");
export const salesOpportunityArchiveDescriptor = workflowActionDescriptor("sales.opportunity.archive");
export const salesPipelineUpdateDescriptor = workflowActionDescriptor("sales.pipeline.update");
export const salesPipelineArchiveDescriptor = workflowActionDescriptor("sales.pipeline.archive");
export const salesSavedViewCreateDescriptor = workflowActionDescriptor("sales.saved-view.create");
export const salesSavedViewUpdateDescriptor = workflowActionDescriptor("sales.saved-view.update");
export const salesSavedViewArchiveDescriptor = workflowActionDescriptor("sales.saved-view.archive");
export const salesActivityCreateDescriptor = workflowActionDescriptor("sales.activity.create");
export const salesActivityCompleteDescriptor = workflowActionDescriptor("sales.activity.complete");
export const salesActivityCancelDescriptor = workflowActionDescriptor("sales.activity.cancel");
export const salesNoteCreateDescriptor = workflowActionDescriptor("sales.note.create");
export const salesAttachmentLinkDescriptor = workflowActionDescriptor("sales.attachment.link");
export const salesAttachmentRemoveDescriptor = workflowActionDescriptor("sales.attachment.remove");
export const salesOwnershipAssignDescriptor = workflowActionDescriptor("sales.ownership.assign");
export const salesImportDryRunDescriptor = workflowActionDescriptor("sales.import.dry-run");
export const salesImportCommitDescriptor = workflowActionDescriptor("sales.import.commit");
export const salesImportCancelDescriptor = workflowActionDescriptor("sales.import.cancel");
export const salesExportCreateDescriptor = workflowActionDescriptor("sales.export.create");
export const salesExportCancelDescriptor = workflowActionDescriptor("sales.export.cancel");
export const salesMergeCommitDescriptor = workflowActionDescriptor("sales.merge.commit");
export const salesEmailSendDescriptor = workflowActionDescriptor("sales.email.send");
export const salesCalendarSyncDescriptor = workflowActionDescriptor("sales.calendar.sync");
export const salesReminderScheduleDescriptor = workflowActionDescriptor("sales.reminder.schedule");
export const salesNotificationReadDescriptor = workflowActionDescriptor("sales.notification.read");
export const salesNotificationArchiveDescriptor = workflowActionDescriptor("sales.notification.archive");
export const salesReminderDismissDescriptor = workflowActionDescriptor("sales.reminder.dismiss");
export const salesIntegrationConfigureDescriptor = workflowActionDescriptor("sales.integration.configure");

function actionRuntime(descriptor: ActionDescriptor): RuntimeSchema<Readonly<Record<string, unknown>>> {
  return { safeParse(value) {
    if (!salesRecord(value) || !("type" in descriptor.inputSchema) || descriptor.inputSchema.type !== "object" || descriptor.inputSchema.properties === undefined) return invalidRuntimeValue("Sales action input is invalid.");
    const properties = descriptor.inputSchema.properties;
    const required = new Set(descriptor.inputSchema.required ?? []);
    if (Object.keys(value).some((key) => !Object.hasOwn(properties, key)) || [...required].some((key) => !Object.hasOwn(value, key))) return invalidRuntimeValue("Sales action input is invalid.");
    for (const [key, property] of Object.entries(properties)) {
      const item = value[key]; if (item === undefined) continue;
      if ("oneOf" in property) { if (!exactJsonSchemaValue(property, item)) return invalidRuntimeValue("Sales action input is invalid."); continue; }
      if (property.type === "string" && (typeof item !== "string" || item.length < (property.minLength ?? 0) || item.length > (property.maxLength ?? Number.MAX_SAFE_INTEGER) || new TextEncoder().encode(item).byteLength > (property.maxUtf8Bytes ?? Number.MAX_SAFE_INTEGER) || property.maxUtf8Bytes === 120 && !isSalesBoundedNfcText(key === "name" ? item.trim() : item) || property.enum !== undefined && !property.enum.includes(item) || salesRecordIdKeys.has(key) && !isSalesRecordId(item) || salesPrincipalIdentityKeys.has(key) && !salesPrincipalIdentityRegex.test(item) || key === "scheduledAt" && !isCanonicalUtcInstant(item))) return invalidRuntimeValue("Sales action input is invalid.");
      if (property.type === "integer" && (typeof item !== "number" || !Number.isSafeInteger(item) || item < (property.minimum ?? Number.MIN_SAFE_INTEGER) || item > (property.maximum ?? Number.MAX_SAFE_INTEGER))) return invalidRuntimeValue("Sales action input is invalid.");
    }
    if (descriptor.id === "sales.lead.qualify") {
      const accountCreate = value.accountMode === "create"; const accountLink = value.accountMode === "link";
      const contactCreate = value.contactMode === "create"; const contactLink = value.contactMode === "link";
      const exactAccount = accountCreate ? Object.hasOwn(value, "accountName") && !Object.hasOwn(value, "accountId") : accountLink && Object.hasOwn(value, "accountId") && !Object.hasOwn(value, "accountName");
      const exactContact = contactCreate ? Object.hasOwn(value, "contactName") && !Object.hasOwn(value, "contactId") : contactLink && Object.hasOwn(value, "contactId") && !Object.hasOwn(value, "contactName");
      if (!exactAccount || !exactContact || accountCreate && contactLink) return invalidRuntimeValue("Sales lead qualification input is invalid.");
    }
    if (descriptor.id === "sales.contact.update" || descriptor.id === "sales.lead.update") {
      for (const [modeKey, valueKey] of [["emailMode", "email"], ["phoneMode", "phone"]] as const) {
        const mode = value[modeKey]; const hasValue = Object.hasOwn(value, valueKey);
        if (!(mode === "retain" || mode === "set" || mode === "clear") || (mode === "set") !== hasValue) return invalidRuntimeValue("Sales channel update input is invalid.");
      }
    }
    if (descriptor.id === "sales.opportunity.create" || descriptor.id === "sales.opportunity.update") {
      const validDate = isSalesCalendarDate;
      const validMoney = (money: unknown) => {
        if (!salesRecord(money) || Object.keys(money).sort().join("\0") !== "currency\0kind\0scale\0value" || money.kind !== "money" || typeof money.value !== "string" || !/^-?(0|[1-9][0-9]*)(?:[.][0-9]+)?$/u.test(money.value) || typeof money.currency !== "string" || !/^[A-Z]{3}$/u.test(money.currency) || !Number.isSafeInteger(money.scale) || (money.scale as number) < 0 || (money.scale as number) > 18) return false;
        const fraction = money.value.split(".")[1] ?? "";
        if (fraction.length > (money.scale as number)) return false;
        const padded = `${money.value}${fraction.length === 0 && (money.scale as number) > 0 ? "." : ""}${"0".repeat((money.scale as number) - fraction.length)}`;
        return padded.length <= 128 && !(money.value.startsWith("-") && Number(money.value) === 0);
      };
      if (Object.hasOwn(value, "amount") && !validMoney(value.amount) || Object.hasOwn(value, "expectedCloseDate") && !validDate(value.expectedCloseDate)) return invalidRuntimeValue("Sales opportunity input is invalid.");
      if (descriptor.id === "sales.opportunity.update") {
        for (const [modeKey, valueKey] of [["primaryContactMode", "primaryContactId"], ["amountMode", "amount"], ["expectedCloseDateMode", "expectedCloseDate"]] as const) {
          const mode = value[modeKey]; const hasValue = Object.hasOwn(value, valueKey);
          if (!(["retain", "set", "clear"] as const).includes(mode as never) || (mode === "set") !== hasValue) return invalidRuntimeValue("Sales opportunity input is invalid.");
        }
      }
    }
    return { success: true as const, data: Object.freeze({ ...value }) };
  } };
}
function exactJsonSchemaValue(schema: AgentToolJsonSchema, value: unknown): boolean {
  if ("oneOf" in schema) return schema.oneOf.filter((branch) => exactJsonSchemaValue(branch, value)).length === 1;
  if (schema.enum !== undefined && !schema.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "number" || schema.type === "integer") return typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (schema.type === "string") return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Number.MAX_SAFE_INTEGER) && new TextEncoder().encode(value).byteLength <= (schema.maxUtf8Bytes ?? Number.MAX_SAFE_INTEGER) && (schema.maxUtf8Bytes !== 120 || isSalesBoundedNfcText(value));
  if (schema.type === "array") return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Number.MAX_SAFE_INTEGER) && schema.items !== undefined && value.every((item) => exactJsonSchemaValue(schema.items!, item));
  if (!salesRecord(value) || schema.properties === undefined) return false;
  const required = new Set(schema.required ?? []);
  return Object.keys(value).every((key) => Object.hasOwn(schema.properties!, key)) && [...required].every((key) => Object.hasOwn(value, key)) &&
    Object.entries(value).every(([key, item]) => exactJsonSchemaValue(schema.properties![key]!, item));
}
function actionOutputRuntime(descriptor: ActionDescriptor): RuntimeSchema<Readonly<Record<string, unknown>>> {
  return { safeParse(value) {
    const schema = descriptor.outputSchema;
    if (!salesRecord(value) || schema === undefined || !exactJsonSchemaValue(schema, value)) return invalidRuntimeValue("Sales action output is invalid.");
    for (const [key, item] of Object.entries(value)) if (typeof item === "string" && (salesRecordIdKeys.has(key) && !isSalesRecordId(item) || salesPrincipalIdentityKeys.has(key) && !salesPrincipalIdentityRegex.test(item))) return invalidRuntimeValue("Sales action output is invalid.");
    return { success: true as const, data: Object.freeze({ ...value }) };
  } };
}
export const salesWorkflowActionInputRuntimeSchemas = Object.freeze(Object.fromEntries([
  salesAccountCreateDescriptor, salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesContactCreateDescriptor, salesContactUpdateDescriptor, salesContactArchiveDescriptor,
  salesLeadCreateDescriptor, salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor,
  salesOpportunityCreateDescriptor, salesOpportunityUpdateDescriptor, salesOpportunityCloseDescriptor, salesOpportunityArchiveDescriptor, salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor,
  salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor, salesOwnershipAssignDescriptor
].map((descriptor) => [descriptor.id, actionRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;
export const salesWorkflowActionOutputRuntimeSchemas = Object.freeze(Object.fromEntries([
  salesAccountCreateDescriptor, salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesContactCreateDescriptor, salesContactUpdateDescriptor, salesContactArchiveDescriptor,
  salesLeadCreateDescriptor, salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor,
  salesOpportunityCreateDescriptor, salesOpportunityUpdateDescriptor, salesOpportunityCloseDescriptor, salesOpportunityArchiveDescriptor, salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor,
  salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor, salesOwnershipAssignDescriptor
].map((descriptor) => [descriptor.id, actionOutputRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;

const salesDataMovementActionDescriptors = Object.freeze([salesImportDryRunDescriptor, salesImportCommitDescriptor, salesImportCancelDescriptor, salesExportCreateDescriptor, salesExportCancelDescriptor, salesMergeCommitDescriptor]);
function movementActionRuntime(descriptor: ActionDescriptor): RuntimeSchema<Readonly<Record<string, unknown>>> {
  const base = actionRuntime(descriptor);
  return { safeParse(value) {
    const parsed = base.safeParse(value); if (!parsed.success) return parsed;
    const request = parsed.data.request;
    if (salesRecord(request) && Array.isArray(request.columnMapping)) {
      const mappings = request.columnMapping as readonly Record<string, unknown>[];
      const headers = mappings.map(({ header }) => header); const fields = mappings.map(({ fieldId }) => fieldId);
      if (new Set(headers).size !== headers.length || new Set(fields).size !== fields.length) return invalidRuntimeValue("Sales import mapping is invalid.");
      const required = request.targetObjectType === "sales.object.lead" ? ["displayName", "source"] : request.targetObjectType === "sales.object.account" ? ["name"] : ["displayName", "accountId"];
      if (required.some((field) => !fields.includes(field))) return invalidRuntimeValue("Sales import mapping is invalid.");
    }
    if (salesRecord(request) && Array.isArray(request.selectedFields) && new Set(request.selectedFields).size !== request.selectedFields.length) return invalidRuntimeValue("Sales export fields are invalid.");
    if (descriptor.id === "sales.merge.commit" && parsed.data.winnerId === parsed.data.loserId) return invalidRuntimeValue("Sales merge direction is invalid.");
    return parsed;
  } };
}
export const salesDataMovementActionInputRuntimeSchemas = Object.freeze(Object.fromEntries(salesDataMovementActionDescriptors.map((descriptor) => [descriptor.id, movementActionRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;
export const salesCommunicationActionDescriptors = Object.freeze([salesEmailSendDescriptor, salesCalendarSyncDescriptor, salesReminderScheduleDescriptor, salesNotificationReadDescriptor, salesNotificationArchiveDescriptor, salesReminderDismissDescriptor, salesIntegrationConfigureDescriptor]);
export const salesCommunicationActionInputRuntimeSchemas = Object.freeze(Object.fromEntries(salesCommunicationActionDescriptors.map((descriptor) => [descriptor.id, actionRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;
export const salesCommunicationActionOutputRuntimeSchemas = Object.freeze(Object.fromEntries(salesCommunicationActionDescriptors.map((descriptor) => [descriptor.id, actionOutputRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;
const sha256DigestPattern = /^sha256:[0-9a-f]{64}$/u;
function movementActionOutputRuntime(descriptor: ActionDescriptor): RuntimeSchema<Readonly<Record<string, unknown>>> {
  const base = actionOutputRuntime(descriptor);
  return { safeParse(value) {
    const parsed = base.safeParse(value); if (!parsed.success) return parsed;
    if (Object.entries(parsed.data).some(([key, item]) => key.endsWith("Digest") && (typeof item !== "string" || !sha256DigestPattern.test(item)))) return invalidRuntimeValue("Sales action output digest is invalid.");
    if (descriptor.id === "sales.import.dry-run" && (parsed.data.acceptedRows as number) + (parsed.data.rejectedRows as number) > 10_000) return invalidRuntimeValue("Sales import output counts are invalid.");
    if (descriptor.id === "sales.merge.commit") {
      const counts = parsed.data.rewrittenRelationCounts;
      const relationIds = Array.isArray(counts) ? counts.map((entry) => salesRecord(entry) ? entry.relationId : undefined) : [];
      const accountRelations = ["sales_contacts.account_id", "sales_opportunities.account_id", "sales_leads.qualified_account_id", "sales_activities.related_record_id where related_record_type=sales.account", "sales_notes.related_record_id where related_record_type=sales.account", "sales_attachment_references.related_record_id where related_record_type=sales.account", "sales_tasks.related_record_id where related_record_type=sales.account"];
      const contactRelations = ["sales_opportunities.primary_contact_id", "sales_leads.qualified_contact_id", "sales_activities.related_record_id where related_record_type=sales.contact", "sales_notes.related_record_id where related_record_type=sales.contact", "sales_attachment_references.related_record_id where related_record_type=sales.contact", "sales_tasks.related_record_id where related_record_type=sales.contact"];
      if (parsed.data.winnerId === parsed.data.loserId || canonicalJson(relationIds) !== canonicalJson(relationIds.length === 7 ? accountRelations : contactRelations)) return invalidRuntimeValue("Sales merge output is invalid.");
    }
    return parsed;
  } };
}
export const salesDataMovementActionOutputRuntimeSchemas = Object.freeze(Object.fromEntries(salesDataMovementActionDescriptors.map((descriptor) => [descriptor.id, movementActionOutputRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;

export const salesSearchTasksDescriptor: AgentToolDescriptor = {
  id: "sales.tools.search-tasks",
  version: 2,
  ownerPluginId: "module.sales",
  title: "Search tasks",
  description: "Search tasks visible to the current actor.",
  inputSchema: salesSearchTasksInputSchema,
  outputContract: "table.records@1",
  invocation: { kind: "source", source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  policy: "sales.policy.tasks.current",
  effect: "read-only",
  risk: "low",
  approval: "none",
  idempotency: "not-applicable",
  dryRun: false,
  limits: salesToolLimits,
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.task.search" }
};

export const salesCreateTaskToolDescriptor: AgentToolDescriptor = {
  id: "sales.tools.create-task",
  version: 2,
  ownerPluginId: "module.sales",
  title: "Create a Sales task",
  description: "Create exactly one Sales task for the current actor.",
  inputSchema: salesTaskCreateDescriptor.inputSchema,
  outputSchema: salesTaskCreateDescriptor.outputSchema,
  invocation: { kind: "action", action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: salesTaskCreateDescriptor.permission,
  policy: salesTaskCreateDescriptor.policy,
  effect: "write",
  risk: "medium",
  approval: "per-call",
  idempotency: "required",
  dryRun: salesTaskCreateDescriptor.dryRun,
  limits: salesToolLimits,
  redaction: { inputPaths: [], outputPaths: [] },
  audit: { category: "sales.task.create", resourcePath: "/id" }
};

export const salesWorkspaceSettingsDescriptor: SystemSettingsDescriptor = {
  schemaVersion: 1,
  id: "sales.settings.workspace",
  publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
  descriptorSchemaVersion: 2,
  validation: "immediate",
  fields: {
    defaultTaskPageSize: {
      type: "integer",
      required: true,
      default: 25,
      minimum: 1,
      maximum: 100,
      description: "Default bounded task page size."
    },
    showPotentialRevenue: {
      type: "boolean",
      required: true,
      default: true,
      description: "Show actor-authorized potential revenue fields."
    },
    defaultPage: {
      type: "string",
      required: true,
      default: "tasks",
      allowed: ["overview", "tasks", "opportunities"],
      description: "Default Sales workspace page."
    }
  },
  readPermission: "sales.settings.read",
  changePermission: "sales.settings.write"
};

export type SalesWorkspaceSettings = Readonly<{
  defaultTaskPageSize: number;
  showPotentialRevenue: boolean;
  defaultPage: "overview" | "tasks" | "opportunities";
}>;

export const salesRouteDescriptors = Object.freeze([
  {
    id: "sales.route.overview",
    ownerPluginId: "module.sales",
    path: "/sales",
    parameters: {},
    surface: "workspace",
    audience: "authenticated",
    permission: "sales.reports.read",
    viewId: "sales.page.overview"
  },
  {
    id: "sales.route.tasks",
    ownerPluginId: "module.sales",
    path: "/sales/tasks",
    parameters: {},
    surface: "workspace",
    audience: "authenticated",
    permission: "sales.tasks.read",
    viewId: "sales.page.tasks"
  },
  {
    id: "sales.route.opportunities",
    ownerPluginId: "module.sales",
    path: "/sales/opportunities",
    parameters: {},
    surface: "workspace",
    audience: "authenticated",
    permission: "sales.opportunities.read",
    viewId: "sales.page.opportunities"
  },
  {
    id: "sales.route.settings",
    ownerPluginId: "module.sales",
    path: "/sales/settings",
    parameters: {},
    surface: "workspace",
    audience: "authenticated",
    permission: "sales.settings.read",
    viewId: "sales.page.settings"
  },
  {
    id: "sales.route.accounts", ownerPluginId: "module.sales", path: "/sales/accounts", parameters: {}, surface: "workspace", audience: "authenticated", permission: "sales.accounts.read", viewId: "sales.page.accounts"
  },
  {
    id: "sales.route.account-detail", ownerPluginId: "module.sales", path: "/sales/accounts/:id", parameters: { id: { type: "string" } }, surface: "workspace", audience: "authenticated", permission: "sales.accounts.read", viewId: "sales.page.account-detail"
  },
  {
    id: "sales.route.contacts", ownerPluginId: "module.sales", path: "/sales/contacts", parameters: {}, surface: "workspace", audience: "authenticated", permission: "sales.contacts.read", viewId: "sales.page.contacts"
  },
  {
    id: "sales.route.contact-detail", ownerPluginId: "module.sales", path: "/sales/contacts/:id", parameters: { id: { type: "string" } }, surface: "workspace", audience: "authenticated", permission: "sales.contacts.read", viewId: "sales.page.contact-detail"
  },
  {
    id: "sales.route.leads", ownerPluginId: "module.sales", path: "/sales/leads", parameters: {}, surface: "workspace", audience: "authenticated", permission: "sales.leads.read", viewId: "sales.page.leads"
  },
  {
    id: "sales.route.lead-detail", ownerPluginId: "module.sales", path: "/sales/leads/:id", parameters: { id: { type: "string" } }, surface: "workspace", audience: "authenticated", permission: "sales.leads.read", viewId: "sales.page.lead-detail"
  },
  {
    id: "sales.route.opportunity-detail", ownerPluginId: "module.sales", path: "/sales/opportunities/:id", parameters: { id: { type: "string" } }, surface: "workspace", audience: "authenticated", permission: "sales.opportunities.read", viewId: "sales.page.opportunity-detail"
  },
  ...salesCrmRouteDescriptors.filter(({ id }) => ["sales.route.calendar", "sales.route.notifications", "sales.route.pipeline-settings", "sales.route.saved-views", "sales.route.imports", "sales.route.exports"].includes(id))
] satisfies readonly PluginRouteDescriptor[]);

export const salesNavigationDescriptors = Object.freeze([
  {
    id: "sales.navigation.overview",
    ownerPluginId: "module.sales",
    labelMessageId: "sales.message.navigation-overview",
    route: { routeId: "sales.route.overview", params: {} },
    permission: "sales.reports.read",
    order: 10
  },
  {
    id: "sales.navigation.tasks",
    ownerPluginId: "module.sales",
    labelMessageId: "sales.message.navigation-tasks",
    route: { routeId: "sales.route.tasks", params: {} },
    permission: "sales.tasks.read",
    order: 20
  },
  {
    id: "sales.navigation.opportunities",
    ownerPluginId: "module.sales",
    labelMessageId: "sales.message.navigation-opportunities",
    route: { routeId: "sales.route.opportunities", params: {} },
    permission: "sales.opportunities.read",
    order: 30
  },
  {
    id: "sales.navigation.settings",
    ownerPluginId: "module.sales",
    labelMessageId: "sales.message.navigation-settings",
    route: { routeId: "sales.route.settings", params: {} },
    permission: "sales.settings.read",
    order: 40
  },
  {
    id: "sales.navigation.accounts", ownerPluginId: "module.sales", labelMessageId: "sales.message.navigation-accounts", route: { routeId: "sales.route.accounts", params: {} }, permission: "sales.accounts.read", order: 25
  },
  {
    id: "sales.navigation.contacts", ownerPluginId: "module.sales", labelMessageId: "sales.message.navigation-contacts", route: { routeId: "sales.route.contacts", params: {} }, permission: "sales.contacts.read", order: 26
  },
  {
    id: "sales.navigation.leads", ownerPluginId: "module.sales", labelMessageId: "sales.message.navigation-leads", route: { routeId: "sales.route.leads", params: {} }, permission: "sales.leads.read", order: 27
  },
  {
    id: "sales.navigation.notifications", ownerPluginId: "module.sales", labelMessageId: "sales.message.navigation-notifications", route: { routeId: "sales.route.notifications", params: {} }, permission: "sales.notifications.read", order: 21
  }
] satisfies readonly PluginNavigationDescriptor[]);

export const salesTaskPageTemplate: PluginPageTemplateDescriptor = {
  id: "sales.page.tasks",
  version: 2,
  ownerPluginId: "module.sales",
  route: { routeId: "sales.route.tasks", params: {} },
  surface: "workspace",
  profile: "workspace",
  permission: "sales.tasks.read",
  publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1], notesMessageId: "sales.message.template-v2" },
  requirements: {
    capabilities: [],
    sources: [{ id: salesTasksDescriptor.id, version: salesTasksDescriptor.version }],
    actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }],
    blocks: [{ id: "sales.task-table", version: 3 }, { id: "sales.task-quick-create", version: 2 }]
  },
  document: {
    id: "sales.page.tasks",
    version: 2,
    schemaVersion: 1,
    profile: "workspace",
    regions: {
      main: [{
        id: "sales-tasks",
        type: "sales.task-table",
        version: 3,
        props: { title: "Sales tasks" },
        bindings: {
          source: {
            source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version },
            input: {},
            structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
            selectedFields: ["title", "status"]
          }
        }
      }, {
        id: "sales-task-create",
        type: "sales.task-quick-create",
        version: 2,
        props: { title: "Create task" },
        bindings: { action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version } }
      }]
    }
  }
};

export const salesOverviewPageTemplate: PluginPageTemplateDescriptor = {
  id: "sales.page.overview", version: 2, ownerPluginId: "module.sales",
  route: { routeId: "sales.route.overview", params: {} }, surface: "workspace", profile: "workspace",
  permission: "sales.reports.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1], notesMessageId: "sales.message.template-v2" },
  requirements: {
    capabilities: [], sources: [{ id: salesTasksDescriptor.id, version: salesTasksDescriptor.version }], actions: [],
    blocks: [{ id: "sales.task-table", version: 3 }]
  },
  document: {
    id: "sales.page.overview", version: 2, schemaVersion: 1, profile: "workspace",
    regions: { main: [{
      id: "sales-follow-up", type: "sales.task-table", version: 3, props: { title: "Follow-up tasks" },
      bindings: { source: { source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version }, input: {}, structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash, selectedFields: ["title", "status"] } }
    }] }
  }
};

export const salesOpportunitiesPageTemplate: PluginPageTemplateDescriptor = {
  id: "sales.page.opportunities", version: 4, ownerPluginId: "module.sales",
  route: { routeId: "sales.route.opportunities", params: {} }, surface: "workspace", profile: "workspace",
  permission: "sales.opportunities.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1, 2, 3], notesMessageId: "sales.message.template-v4" },
  requirements: {
    capabilities: [], sources: [{ id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }, { id: salesSavedViewKanbanDescriptor.id, version: salesSavedViewKanbanDescriptor.version }], actions: [{ id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version }, { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }],
    blocks: [{ id: "sales.opportunity-list", version: 4 }, { id: "sales.opportunity-kanban", version: 3 }]
  },
  document: {
    id: "sales.page.opportunities", version: 4, schemaVersion: 1, profile: "workspace",
    regions: { main: [{
      id: "sales-opportunities", type: "sales.opportunity-list", version: 4, props: { title: "Opportunities" },
      bindings: { source: { source: { id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }, input: {}, structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision"] }, action: { id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version } }
    }, {
      id: "sales-opportunity-kanban", type: "sales.opportunity-kanban", version: 3, props: { title: "Opportunity pipeline" },
      bindings: { source: { source: { id: salesSavedViewKanbanDescriptor.id, version: salesSavedViewKanbanDescriptor.version }, input: {}, structuralCompatibilityHash: salesSavedViewKanbanDescriptor.structuralCompatibilityHash, selectedFields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"] }, action: { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version } }
    }] }
  }
};

export const salesSettingsPageTemplate: PluginPageTemplateDescriptor = {
  id: "sales.page.settings", version: 3, ownerPluginId: "module.sales",
  route: { routeId: "sales.route.settings", params: {} }, surface: "workspace", profile: "workspace",
  permission: "sales.settings.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1, 2], notesMessageId: "sales.message.settings-template-v3" },
  requirements: { capabilities: [], sources: [{ id: salesProviderConfigurationsDescriptor.id, version: salesProviderConfigurationsDescriptor.version }], actions: [{ id: salesIntegrationConfigureDescriptor.id, version: salesIntegrationConfigureDescriptor.version }], blocks: [{ id: "sales.settings-summary", version: 2 }, { id: "sales.integration-settings", version: 1 }] },
  document: {
    id: "sales.page.settings", version: 3, schemaVersion: 1, profile: "workspace",
    regions: { main: [{ id: "sales-settings", type: "sales.settings-summary", version: 2, props: { title: "Sales settings" } }, { id: "sales-integration-settings", type: "sales.integration-settings", version: 1, props: {}, bindings: { source: { source: { id: salesProviderConfigurationsDescriptor.id, version: salesProviderConfigurationsDescriptor.version }, input: {}, structuralCompatibilityHash: salesProviderConfigurationsDescriptor.structuralCompatibilityHash, selectedFields: salesProviderConfigurationFields.map(({ id }) => id) }, action: { id: salesIntegrationConfigureDescriptor.id, version: salesIntegrationConfigureDescriptor.version } } }] }
  }
};

function crmPageTemplate(input: Readonly<{
  id: string; routeId: string; permission: string; source: DataSourceDescriptor; fields: readonly string[]; blockId: string; blockVersion?: number; detail?: boolean; actions: readonly ActionDescriptor[];
}>): PluginPageTemplateDescriptor {
  const mainId = `${input.id.replaceAll(".", "-")}-main`;
  const sourceBinding = { source: { id: input.source.id, version: input.source.version }, input: input.detail === true ? { id: "$route.id" } : {}, structuralCompatibilityHash: input.source.structuralCompatibilityHash, selectedFields: [...input.fields] };
  const timelineRowActions = new Set([salesActivityCompleteDescriptor.id, salesActivityCancelDescriptor.id, salesAttachmentRemoveDescriptor.id]);
  const blockVersion = input.blockVersion ?? 2;
  const actionNodes = input.actions.slice(1).filter((action) => !timelineRowActions.has(action.id)).map((action, index) => ({ id: `${mainId}-action-${index + 1}`, type: input.blockId, version: blockVersion, props: { title: action.id }, bindings: { source: sourceBinding, action: { id: action.id, version: action.version } } }));
  return {
    id: input.id, version: 1, ownerPluginId: "module.sales", route: { routeId: input.routeId, params: {} }, surface: "workspace", profile: "workspace", permission: input.permission,
    publicationPolicy: { ownership: "customer", adoption: "explicit" },
    requirements: { capabilities: [], sources: [{ id: input.source.id, version: input.source.version }], actions: input.actions.map(({ id, version }) => ({ id, version })), blocks: [{ id: input.blockId, version: blockVersion }]},
    document: { id: input.id, version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [{ id: mainId, type: input.blockId, version: blockVersion, props: { title: input.id }, bindings: { source: sourceBinding, ...(input.actions.length === 0 ? {} : { action: { id: input.actions[0]!.id, version: input.actions[0]!.version } }) } }, ...actionNodes] } }
  };
}

export const salesAccountsPageTemplate = crmPageTemplate({ id: "sales.page.accounts", routeId: "sales.route.accounts", permission: "sales.accounts.read", source: salesAccountsDescriptor, fields: ["name", "owner-id", "status", "revision"], blockId: "sales.account-list", actions: [salesAccountCreateDescriptor] });
export const salesAccountDetailPageTemplate = crmPageTemplate({ id: "sales.page.account-detail", routeId: "sales.route.account-detail", permission: "sales.accounts.read", source: salesAccountDetailDescriptor, fields: ["name", "owner-id", "team-id", "status", "revision"], blockId: "sales.account-detail", detail: true, actions: [salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesOwnershipAssignDescriptor, salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor] });
export const salesContactsPageTemplate = crmPageTemplate({ id: "sales.page.contacts", routeId: "sales.route.contacts", permission: "sales.contacts.read", source: salesContactsDescriptor, fields: ["display-name", "owner-id", "account-id", "status", "revision"], blockId: "sales.contact-list", actions: [salesContactCreateDescriptor] });
export const salesContactDetailPageTemplate = crmPageTemplate({ id: "sales.page.contact-detail", routeId: "sales.route.contact-detail", permission: "sales.contacts.read", source: salesContactDetailDescriptor, fields: ["display-name", "owner-id", "team-id", "account-id", "status", "revision"], blockId: "sales.contact-detail", detail: true, actions: [salesContactUpdateDescriptor, salesContactArchiveDescriptor, salesOwnershipAssignDescriptor, salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor] });
export const salesLeadsPageTemplate = crmPageTemplate({ id: "sales.page.leads", routeId: "sales.route.leads", permission: "sales.leads.read", source: salesLeadsDescriptor, fields: ["display-name", "owner-id", "status", "archive-status", "revision"], blockId: "sales.lead-list", actions: [salesLeadCreateDescriptor] });
export const salesLeadDetailPageTemplate = crmPageTemplate({ id: "sales.page.lead-detail", routeId: "sales.route.lead-detail", permission: "sales.leads.read", source: salesLeadDetailDescriptor, fields: ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"], blockId: "sales.lead-detail", detail: true, actions: [salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor, salesOwnershipAssignDescriptor, salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor] });
export const salesOpportunityDetailPageTemplate = crmPageTemplate({ id: "sales.page.opportunity-detail", routeId: "sales.route.opportunity-detail", permission: "sales.opportunities.read", source: salesOpportunityDetailDescriptor, fields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "expected-close-date", "revision"], blockId: "sales.opportunity-detail", blockVersion: 3, detail: true, actions: [salesOpportunityUpdateDescriptor, salesOpportunityStageUpdateDescriptor, salesOpportunityCloseDescriptor, salesOpportunityArchiveDescriptor, salesOwnershipAssignDescriptor, salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor] });

function p134Page(input: { id: string; routeId: string; permission: string; sources: readonly DataSourceDescriptor[]; actions: readonly ActionDescriptor[]; blocks: readonly { nodeId: string; id: string; source?: DataSourceDescriptor; fields?: readonly string[]; input?: Readonly<Record<string, never>>; action?: ActionDescriptor }[] }): PluginPageTemplateDescriptor {
  return { id: input.id, version: 1, ownerPluginId: "module.sales", route: { routeId: input.routeId, params: {} }, surface: "workspace", profile: "workspace", permission: input.permission,
    publicationPolicy: { ownership: "customer", adoption: "explicit" }, requirements: { capabilities: [], sources: input.sources.map(({ id, version }) => ({ id, version })), actions: input.actions.map(({ id, version }) => ({ id, version })), blocks: [...new Set(input.blocks.map(({ id }) => id))].map((id) => ({ id, version: 1 })) },
    document: { id: input.id, version: 1, schemaVersion: 1, profile: "workspace", regions: { main: input.blocks.map((block) => ({ id: block.nodeId, type: block.id, version: 1, props: {}, bindings: { ...(block.source === undefined ? {} : { source: { source: { id: block.source.id, version: block.source.version }, input: block.input ?? {}, structuralCompatibilityHash: block.source.structuralCompatibilityHash, selectedFields: [...(block.fields ?? [])] } }), ...(block.action === undefined ? {} : { action: { id: block.action.id, version: block.action.version } }) } })) } } };
}
export const salesCalendarPageTemplate = p134Page({ id: "sales.page.calendar", routeId: "sales.route.calendar", permission: "sales.activities.read", sources: [salesSavedViewCalendarDescriptor], actions: [salesEmailSendDescriptor, salesCalendarSyncDescriptor], blocks: [
  { nodeId: "calendar", id: "sales.calendar", source: salesSavedViewCalendarDescriptor, fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"] },
  { nodeId: "email-send", id: "sales.communication-actions", action: salesEmailSendDescriptor },
  { nodeId: "calendar-sync", id: "sales.communication-actions", action: salesCalendarSyncDescriptor }
] });
export const salesPipelineSettingsPageTemplate = p134Page({ id: "sales.page.pipeline-settings", routeId: "sales.route.pipeline-settings", permission: "sales.pipelines.configure", sources: [salesPipelineSnapshotDescriptor], actions: [salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor], blocks: [
  { nodeId: "pipeline-update", id: "sales.pipeline-settings", source: salesPipelineSnapshotDescriptor, fields: salesPipelineSnapshotFields.map(({ id }) => id), action: salesPipelineUpdateDescriptor },
  { nodeId: "pipeline-archive", id: "sales.pipeline-settings", source: salesPipelineSnapshotDescriptor, fields: salesPipelineSnapshotFields.map(({ id }) => id), action: salesPipelineArchiveDescriptor }
] });
export const salesSavedViewsPageTemplate = p134Page({ id: "sales.page.saved-views", routeId: "sales.route.saved-views", permission: "sales.saved-views.read", sources: [salesSavedViewListDescriptor, salesSavedViewDetailDescriptor, salesSavedViewTableDescriptor], actions: [salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor], blocks: [
  { nodeId: "saved-view-list", id: "sales.saved-views", source: salesSavedViewListDescriptor, fields: salesSavedViewListFields.map(({ id }) => id) },
  { nodeId: "saved-view-create", id: "sales.saved-views", action: salesSavedViewCreateDescriptor },
  { nodeId: "saved-view-table-preview", id: "sales.saved-view-table", source: salesSavedViewTableDescriptor, fields: ["name"], input: {} },
  { nodeId: "saved-view-detail", id: "sales.saved-views", source: salesSavedViewDetailDescriptor, fields: salesSavedViewDetailFields.map(({ id }) => id), action: salesSavedViewUpdateDescriptor },
  { nodeId: "saved-view-archive", id: "sales.saved-views", source: salesSavedViewDetailDescriptor, fields: salesSavedViewDetailFields.map(({ id }) => id), action: salesSavedViewArchiveDescriptor }
] });
export const salesImportsPageTemplate = p134Page({ id: "sales.page.imports", routeId: "sales.route.imports", permission: "sales.imports.read", sources: [salesImportJobListDescriptor, salesImportJobDetailDescriptor, salesDedupeCandidatesDescriptor], actions: [salesImportDryRunDescriptor, salesImportCommitDescriptor, salesImportCancelDescriptor, salesMergeCommitDescriptor], blocks: [
  { nodeId: "import-list", id: "sales.imports", source: salesImportJobListDescriptor, fields: salesImportJobListFields.map(({ id }) => id), action: salesImportDryRunDescriptor },
  { nodeId: "import-detail", id: "sales.imports", source: salesImportJobDetailDescriptor, fields: salesImportJobDetailFields.map(({ id }) => id), action: salesImportCommitDescriptor },
  { nodeId: "import-cancel", id: "sales.imports", action: salesImportCancelDescriptor },
  { nodeId: "dedupe", id: "sales.imports", source: salesDedupeCandidatesDescriptor, fields: salesDedupeCandidateFields.map(({ id }) => id), action: salesMergeCommitDescriptor }
] });
export const salesExportsPageTemplate = p134Page({ id: "sales.page.exports", routeId: "sales.route.exports", permission: "sales.exports.read", sources: [salesExportJobListDescriptor, salesExportJobDetailDescriptor], actions: [salesExportCreateDescriptor, salesExportCancelDescriptor], blocks: [
  { nodeId: "export-list", id: "sales.exports", source: salesExportJobListDescriptor, fields: salesExportJobListFields.map(({ id }) => id), action: salesExportCreateDescriptor },
  { nodeId: "export-detail", id: "sales.exports", source: salesExportJobDetailDescriptor, fields: salesExportJobDetailFields.map(({ id }) => id), action: salesExportCancelDescriptor }
] });
export const salesNotificationsPageTemplate = p134Page({ id: "sales.page.notifications", routeId: "sales.route.notifications", permission: "sales.notifications.read", sources: [salesNotificationsDescriptor, salesRemindersDescriptor], actions: [salesNotificationReadDescriptor, salesNotificationArchiveDescriptor, salesReminderDismissDescriptor, salesReminderScheduleDescriptor], blocks: [
  { nodeId: "notification-list", id: "sales.notification-center", source: salesNotificationsDescriptor, fields: salesNotificationFields.map(({ id }) => id), action: salesNotificationReadDescriptor },
  { nodeId: "notification-archive", id: "sales.notification-center", source: salesNotificationsDescriptor, fields: salesNotificationFields.map(({ id }) => id), action: salesNotificationArchiveDescriptor },
  { nodeId: "reminder-list", id: "sales.reminder-center", source: salesRemindersDescriptor, fields: salesReminderFields.map(({ id }) => id), action: salesReminderDismissDescriptor },
  { nodeId: "reminder-schedule", id: "sales.reminder-center", source: salesRemindersDescriptor, fields: salesReminderFields.map(({ id }) => id), action: salesReminderScheduleDescriptor }
] });

export const salesPageTemplates = Object.freeze([
  salesOverviewPageTemplate, salesTaskPageTemplate, salesOpportunitiesPageTemplate, salesSettingsPageTemplate,
  salesAccountsPageTemplate, salesAccountDetailPageTemplate, salesContactsPageTemplate, salesContactDetailPageTemplate,
  salesLeadsPageTemplate, salesLeadDetailPageTemplate, salesOpportunityDetailPageTemplate,
  salesCalendarPageTemplate, salesNotificationsPageTemplate, salesPipelineSettingsPageTemplate, salesSavedViewsPageTemplate, salesImportsPageTemplate, salesExportsPageTemplate
]);

const salesTaskUiPolicy: Omit<PluginUiContributionDescriptor, "id" | "version" | "ownerPluginId" | "kind"> = {
  profiles: ["workspace"],
  surfaces: ["workspace"],
  audience: "authenticated",
  permission: "sales.tasks.read",
  propsSchema: salesTaskTablePropsSchema,
  sourcePolicy: {
    required: true,
    contracts: [{ id: "table.records", version: 1 }],
    requiredFields: ["title", "status"]
  },
  actionPolicy: {
    required: false,
    actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }]
  },
  requiredStates: ["loading", "empty", "error", "forbidden"]
};

export const salesTaskTableComponentDescriptor: PluginUiContributionDescriptor = {
  id: "sales.table.tasks",
  version: 2,
  ownerPluginId: "module.sales",
  kind: "component",
  ...salesTaskUiPolicy
};

export const salesTaskTableBlockDescriptor: PluginUiContributionDescriptor = {
  id: "sales.task-table",
  version: 3,
  ownerPluginId: "module.sales",
  kind: "block",
  ...salesTaskUiPolicy
};

function uiContribution(
  id: string,
  kind: "component" | "block",
  permissionId: string,
  sourcePolicy?: PluginUiContributionDescriptor["sourcePolicy"],
  actionPolicy?: PluginUiContributionDescriptor["actionPolicy"]
): PluginUiContributionDescriptor {
  return {
    id, version: 2, ownerPluginId: "module.sales", kind,
    propsSchema: salesTaskTablePropsSchema,
    profiles: ["workspace"], surfaces: ["workspace"], audience: "authenticated", permission: permissionId,
    ...(sourcePolicy === undefined ? {} : { sourcePolicy }),
    ...(actionPolicy === undefined ? {} : { actionPolicy }),
    requiredStates: ["loading", "empty", "error", "forbidden"]
  };
}

const salesInteractionActions = [salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor] as const;

const emptyPropsSchema = { type: "object" as const, properties: {}, additionalProperties: false as const };
function p134Block(id: string, permission: string, requiredFields: readonly string[], actions: readonly ActionDescriptor[] = [], sourceRequired = true): PluginUiContributionDescriptor {
  return { id, version: 1, ownerPluginId: "module.sales", kind: "block", propsSchema: emptyPropsSchema, profiles: ["workspace"], surfaces: ["workspace"], audience: "authenticated", permission,
    sourcePolicy: { required: sourceRequired, contracts: [{ id: "table.records", version: 1 }], requiredFields: [...requiredFields] },
    ...(actions.length === 0 ? {} : { actionPolicy: { required: id === "sales.pipeline-settings", actions: actions.map(({ id: actionId, version }) => ({ id: actionId, version })) } }),
    requiredStates: ["loading", "empty", "error", "forbidden"] };
}
export const salesCalendarBlockDescriptor = p134Block("sales.calendar", "sales.activities.read", ["type", "subject", "status", "related-record-type", "related-record-id", "revision"]);
export const salesPipelineSettingsBlockDescriptor = p134Block("sales.pipeline-settings", "sales.pipelines.configure", ["pipeline-id", "pipeline-revision", "stage-id", "stage-revision", "semantic", "position", "allowed-transition-stage-ids", "required-field-ids"], [salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor]);
export const salesSavedViewsBlockDescriptor = p134Block("sales.saved-views", "sales.saved-views.read", ["id", "name", "visibility", "target-object-id", "view-kind", "revision", "status"], [salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor], false);
export const salesSavedViewTableBlockDescriptor = p134Block("sales.saved-view-table", "sales.saved-views.read", []);
export const salesNotificationsBlockDescriptor = p134Block("sales.notification-center", "sales.notifications.read", ["subject", "state", "created-at", "revision"], [salesNotificationReadDescriptor, salesNotificationArchiveDescriptor]);
export const salesRemindersBlockDescriptor = p134Block("sales.reminder-center", "sales.reminders.read", ["subject", "state", "scheduled-at", "reference-kind", "reference-id", "revision"], [salesReminderDismissDescriptor, salesReminderScheduleDescriptor]);
export const salesCommunicationActionsBlockDescriptor = p134Block("sales.communication-actions", "sales.activities.read", [], [salesEmailSendDescriptor, salesCalendarSyncDescriptor], false);
export const salesIntegrationSettingsBlockDescriptor = p134Block("sales.integration-settings", "sales.settings.read", salesProviderConfigurationFields.map(({ id }) => id), [salesIntegrationConfigureDescriptor]);

const opportunitySourcePolicy = { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: ["name", "stage-id", "revision"] };
const opportunityDetailSourcePolicy = { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "revision"] };

export const salesQuickCreateComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.form.task-quick-create", "component", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }] });
export const salesOpportunityListComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.list.opportunities", "component", "sales.opportunities.read", opportunitySourcePolicy);
export const salesOpportunityDetailComponentDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.detail.opportunity", "component", "sales.opportunities.read", opportunityDetailSourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }, { id: salesOwnershipAssignDescriptor.id, version: salesOwnershipAssignDescriptor.version }] }), version: 3 };
export const salesPipelineStatusComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.status.pipeline-stage", "component", "sales.pipelines.read");

export const salesQuickCreateBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.task-quick-create", "block", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }] });
export const salesOpportunityListBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.opportunity-list", "block", "sales.opportunities.read", { ...opportunitySourcePolicy, requiredFields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision"] }, { required: false, actions: [{ id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version }] }), version: 4 };
export const salesOpportunityDetailBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.opportunity-detail", "block", "sales.opportunities.read", opportunityDetailSourcePolicy, { required: false, actions: [
  { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version },
  { id: salesOpportunityUpdateDescriptor.id, version: salesOpportunityUpdateDescriptor.version },
  { id: salesOpportunityCloseDescriptor.id, version: salesOpportunityCloseDescriptor.version },
  { id: salesOpportunityArchiveDescriptor.id, version: salesOpportunityArchiveDescriptor.version },
  { id: salesOwnershipAssignDescriptor.id, version: salesOwnershipAssignDescriptor.version },
  ...salesInteractionActions.map(({ id, version }) => ({ id, version }))
] }), version: 3 };
export const salesOpportunityKanbanBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.opportunity-kanban", "block", "sales.opportunities.read", { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"] }, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }] }), version: 3 };
export const salesSettingsSummaryBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.settings-summary", "block", "sales.settings.read");
const crmListPolicy = (fields: readonly string[]) => ({ required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: [...fields] });
const crmUiComponent = (id: string, permission: string, fields: readonly string[], actions: readonly ActionDescriptor[]) => uiContribution(id, "component", permission, crmListPolicy(fields), actions.length === 0 ? undefined : { required: false, actions: actions.map(({ id: actionId, version }) => ({ id: actionId, version })) });
const crmUiBlock = (id: string, permission: string, fields: readonly string[], actions: readonly ActionDescriptor[]) => uiContribution(id, "block", permission, crmListPolicy(fields), actions.length === 0 ? undefined : { required: false, actions: actions.map(({ id: actionId, version }) => ({ id: actionId, version })) });
export const salesAccountListComponentDescriptor = crmUiComponent("sales.list.accounts", "sales.accounts.read", ["name", "owner-id", "status", "revision"], [salesAccountCreateDescriptor]);
export const salesAccountDetailComponentDescriptor = crmUiComponent("sales.detail.account", "sales.accounts.read", ["name", "owner-id", "team-id", "status", "revision"], [salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesOwnershipAssignDescriptor, ...salesInteractionActions]);
export const salesContactListComponentDescriptor = crmUiComponent("sales.list.contacts", "sales.contacts.read", ["display-name", "owner-id", "account-id", "status", "revision"], [salesContactCreateDescriptor]);
export const salesContactDetailComponentDescriptor = crmUiComponent("sales.detail.contact", "sales.contacts.read", ["display-name", "owner-id", "team-id", "account-id", "status", "revision"], [salesContactUpdateDescriptor, salesContactArchiveDescriptor, salesOwnershipAssignDescriptor, ...salesInteractionActions]);
export const salesLeadListComponentDescriptor = crmUiComponent("sales.list.leads", "sales.leads.read", ["display-name", "owner-id", "status", "archive-status", "revision"], [salesLeadCreateDescriptor]);
export const salesLeadDetailComponentDescriptor = crmUiComponent("sales.detail.lead", "sales.leads.read", ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"], [salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor, salesOwnershipAssignDescriptor, ...salesInteractionActions]);
export const salesAccountListBlockDescriptor = crmUiBlock("sales.account-list", "sales.accounts.read", ["name", "owner-id", "status", "revision"], [salesAccountCreateDescriptor]);
export const salesAccountDetailBlockDescriptor = crmUiBlock("sales.account-detail", "sales.accounts.read", ["name", "owner-id", "team-id", "status", "revision"], [salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesOwnershipAssignDescriptor, ...salesInteractionActions]);
export const salesContactListBlockDescriptor = crmUiBlock("sales.contact-list", "sales.contacts.read", ["display-name", "owner-id", "account-id", "status", "revision"], [salesContactCreateDescriptor]);
export const salesContactDetailBlockDescriptor = crmUiBlock("sales.contact-detail", "sales.contacts.read", ["display-name", "owner-id", "team-id", "account-id", "status", "revision"], [salesContactUpdateDescriptor, salesContactArchiveDescriptor, salesOwnershipAssignDescriptor, ...salesInteractionActions]);
export const salesLeadListBlockDescriptor = crmUiBlock("sales.lead-list", "sales.leads.read", ["display-name", "owner-id", "status", "archive-status", "revision"], [salesLeadCreateDescriptor]);
export const salesLeadDetailBlockDescriptor = crmUiBlock("sales.lead-detail", "sales.leads.read", ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"], [salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor, salesOwnershipAssignDescriptor, ...salesInteractionActions]);
export const salesImportsBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.imports", "block", "sales.imports.read", { required: false, contracts: [{ id: "table.records", version: 1 }], requiredFields: [] }, { required: false, actions: [salesImportDryRunDescriptor, salesImportCommitDescriptor, salesImportCancelDescriptor, salesMergeCommitDescriptor].map(({ id, version }) => ({ id, version })) }), version: 1, propsSchema: { type: "object", properties: {}, additionalProperties: false } };
export const salesExportsBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.exports", "block", "sales.exports.read", { required: false, contracts: [{ id: "table.records", version: 1 }], requiredFields: [] }, { required: false, actions: [salesExportCreateDescriptor, salesExportCancelDescriptor].map(({ id, version }) => ({ id, version })) }), version: 1, propsSchema: { type: "object", properties: {}, additionalProperties: false } };

export const salesUiComponentDescriptors: readonly PluginUiContributionDescriptor[] = Object.freeze([
  salesTaskTableComponentDescriptor, salesQuickCreateComponentDescriptor,
  salesOpportunityListComponentDescriptor, salesOpportunityDetailComponentDescriptor, salesPipelineStatusComponentDescriptor,
  salesAccountListComponentDescriptor, salesAccountDetailComponentDescriptor, salesContactListComponentDescriptor, salesContactDetailComponentDescriptor, salesLeadListComponentDescriptor, salesLeadDetailComponentDescriptor
]);
export const salesUiBlockDescriptors: readonly PluginUiContributionDescriptor[] = Object.freeze([
  salesTaskTableBlockDescriptor, salesQuickCreateBlockDescriptor,
  salesOpportunityListBlockDescriptor, salesOpportunityDetailBlockDescriptor, salesOpportunityKanbanBlockDescriptor, salesSettingsSummaryBlockDescriptor,
  salesAccountListBlockDescriptor, salesAccountDetailBlockDescriptor, salesContactListBlockDescriptor, salesContactDetailBlockDescriptor, salesLeadListBlockDescriptor, salesLeadDetailBlockDescriptor,
  salesCalendarBlockDescriptor, salesNotificationsBlockDescriptor, salesRemindersBlockDescriptor, salesCommunicationActionsBlockDescriptor, salesIntegrationSettingsBlockDescriptor, salesPipelineSettingsBlockDescriptor, salesSavedViewsBlockDescriptor, salesSavedViewTableBlockDescriptor, salesImportsBlockDescriptor, salesExportsBlockDescriptor
]);

export const salesEventDescriptors = Object.freeze([
  { id: "sales.event.task-changed", version: 2, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.tasks" },
  { id: "sales.event.opportunity-changed", version: 2, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.opportunities" },
  { id: "sales.event.account-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.accounts" },
  { id: "sales.event.contact-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.contacts" },
  { id: "sales.event.lead-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.leads" },
  { id: "sales.event.import-job-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.import-job.list" },
  { id: "sales.event.export-job-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.export-job.list" },
  { id: "sales.event.notification-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.notifications" },
  { id: "sales.event.reminder-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.reminders" },
  { id: "sales.event.provider-configuration-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.provider-configurations" },
  { id: "sales.event.timeline-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.timeline" }
]);

export const salesRealtimeTopicDescriptors = Object.freeze([
  { id: "sales.realtime.tasks", version: 2, ownerPluginId: "module.sales", eventId: "sales.event.task-changed", sourceId: "sales.tasks", permission: "sales.tasks.read" },
  { id: "sales.realtime.opportunities", version: 2, ownerPluginId: "module.sales", eventId: "sales.event.opportunity-changed", sourceId: "sales.opportunities", permission: "sales.opportunities.read" },
  { id: "sales.realtime.accounts", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.account-changed", sourceId: "sales.accounts", permission: "sales.accounts.read" },
  { id: "sales.realtime.contacts", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.contact-changed", sourceId: "sales.contacts", permission: "sales.contacts.read" },
  { id: "sales.realtime.leads", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.lead-changed", sourceId: "sales.leads", permission: "sales.leads.read" },
  { id: "sales.realtime.import-jobs", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.import-job-changed", sourceId: "sales.import-job.list", permission: "sales.imports.read" },
  { id: "sales.realtime.export-jobs", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.export-job-changed", sourceId: "sales.export-job.list", permission: "sales.exports.read" },
  { id: "sales.realtime.notifications", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.notification-changed", sourceId: "sales.notifications", permission: "sales.notifications.read" },
  { id: "sales.realtime.reminders", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.reminder-changed", sourceId: "sales.reminders", permission: "sales.reminders.read" },
  { id: "sales.realtime.provider-configurations", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.provider-configuration-changed", sourceId: "sales.provider-configurations", permission: "sales.settings.read" },
  { id: "sales.realtime.timeline", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.timeline-changed", sourceId: "sales.timeline", permission: "sales.activities.read" }
]);

export const salesReferenceMetadata = Object.freeze({
  migration: { id: "sales.migration.initial", version: 3, ownerPluginId: "module.sales", predecessorRevisions: [1, 2] },
  service: { id: "sales.service.domain", version: 2, ownerPluginId: "module.sales" },
  job: { id: "sales.job.pipeline-audit", version: 2, ownerPluginId: "module.sales", timeoutMs: 5_000, maxConcurrency: 1, idempotent: true },
  reminderJob: { id: "sales.job.reminder-delivery", version: 1, ownerPluginId: "module.sales", timeoutMs: 5_000, maxConcurrency: 4, idempotent: true },
  localization: {
    id: "sales.localization.en", version: 2, ownerPluginId: "module.sales", locale: "en",
    messages: {
      "sales.message.overview": "Overview", "sales.message.tasks": "Tasks",
      "sales.message.opportunities": "Opportunities", "sales.message.settings": "Settings",
      "sales.message.navigation-overview": "Overview", "sales.message.navigation-tasks": "Tasks",
      "sales.message.navigation-opportunities": "Opportunities", "sales.message.navigation-settings": "Settings", "sales.message.navigation-accounts": "Accounts", "sales.message.navigation-contacts": "Contacts", "sales.message.navigation-leads": "Leads", "sales.message.navigation-notifications": "Notifications",
      "sales.message.template-v2": "Adopt CRM core template version 2.",
      "sales.message.template-v3": "Adopt CRM opportunity template version 3.",
      "sales.message.template-v4": "Adopt CRM pipeline and saved-view template version 4.",
      "sales.message.settings-template-v3": "Adopt provider configuration status projection."
    }
  },
  health: { id: "sales.health.runtime", version: 2, ownerPluginId: "module.sales", safe: true },
  lifecycle: { id: "sales.lifecycle.reference", version: 2, ownerPluginId: "module.sales", disable: "supported", reenable: "supported", purge: "supported" },
  testing: { id: "sales.testing.conformance", version: 2, ownerPluginId: "module.sales", conformancePluginId: "module.sales" }
});
