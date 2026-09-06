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
  TableRecords
} from "@k-nex/contracts";
import { TableRecordsSchema } from "@k-nex/contracts";
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
const crmField = (id: string, kind: "text" | "status" | "integer", permission: string, nullable = false): SalesSourceField => ({ id, kind, binding: nullable ? "optional" : "required", nullable, permission, sortable: false, filterOperators: [] });

export const salesOpportunityFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  { id: "name", kind: "text", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: true, filterOperators: ["eq", "contains"] },
  { id: "stage-id", kind: "status", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: true, filterOperators: ["eq", "in"] },
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
  crmField("stage-id", "status", "sales.opportunities.read"),
  crmField("archive-status", "status", "sales.opportunities.read"),
  crmField("expected-close-date", "text", "sales.opportunities.read", true),
  crmField("revision", "integer", "sales.opportunities.read"),
  { id: "amount", kind: "money", binding: "optional", nullable: true, permission: "sales.opportunities.amount.read", sortable: false, filterOperators: [] }
];

export const salesOpportunitiesDescriptor: DataSourceDescriptor = {
  id: "sales.opportunities",
  version: 2,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.opportunities.output", version: 2 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.opportunities.read",
  structuralCompatibilityHash: "sha256:49a707b6f512bc0d8cad02c38a506066e6973e09468e1e3c8373c8e1287ade5d",
  presentationMetadataRevision: 1,
  title: "Sales opportunities",
  inputFields: [],
  outputFields: salesOpportunityFields,
  paginationModes: ["offset"],
  limits: { ...salesSourceLimits },
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
  ...crmSource("sales.opportunity.detail", 1, "sales.opportunities.read", "Sales opportunity detail", salesOpportunityDetailFields, "sha256:13f00de403130aa2e96978e81d8c93da1b7bf30bf8892b708cee12e6781da59a", crmDetailInputFields),
  limits: { ...salesSourceLimits, maxSelectedFields: 12 }
});

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

function crmCell(field: SalesSourceField, cell: unknown): boolean {
  if (cell === null) return field.nullable;
  if (!salesRecord(cell) || cell.kind !== field.kind || Object.keys(cell).join("\u0000") !== "kind\u0000value") return false;
  if (field.kind === "integer") return Number.isSafeInteger(cell.value) && (cell.value as number) >= 1 && (cell.value as number) <= 2_147_483_647;
  if (field.kind === "status") {
    const allowed = field.permission === "sales.accounts.read" || field.permission === "sales.contacts.read" ? ["active", "archived", "merged"]
      : field.permission === "sales.leads.read" ? field.id === "archive-status" ? ["active", "archived"] : ["new", "working", "qualified", "disqualified"]
      : undefined;
    return typeof cell.value === "string" && (allowed === undefined ? cell.value.length > 0 && cell.value.length <= 64 : allowed.includes(cell.value));
  }
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
  readonly expectedStage: SalesOpportunityStage;
  readonly expectedRevision: number;
  readonly stage: SalesOpportunityStage;
}
export interface UpdateOpportunityStageOutput {
  readonly id: string;
  readonly name: string;
  readonly stage: SalesOpportunityStage;
  readonly revision: number;
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
    const transitions: Readonly<Record<string, string>> = { qualification: "discovery", discovery: "proposal", proposal: "negotiation" };
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "expectedRevision\u0000expectedStage\u0000id\u0000stage" || !boundedLegacyId(value.id) ||
      !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1 ||
      typeof value.expectedStage !== "string" || typeof value.stage !== "string" || transitions[value.expectedStage] !== value.stage) {
      return invalidRuntimeValue("Sales opportunity stage input is invalid.");
    }
    return { success: true as const, data: value as unknown as UpdateOpportunityStageInput };
  }
};

export const salesOpportunityStageOutputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageOutput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000name\u0000revision\u0000stage" || !boundedLegacyId(value.id) ||
      typeof value.name !== "string" || value.name.length < 1 || value.name.length > 256 || !["qualification", "discovery", "proposal", "negotiation", "won", "lost"].includes(value.stage as string) ||
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
  if (fieldId === "name") return typeof cell.value === "string" && cell.value.length > 0;
  if (fieldId === "stage-id") return typeof cell.value === "string" && opportunityStages.includes(cell.value as typeof opportunityStages[number]);
  if (fieldId === "revision") return Number.isSafeInteger(cell.value) && (cell.value as number) >= 1;
  return typeof cell.value === "string" && /^[A-Z]{3}$/u.test(cell.currency as string) && Number.isSafeInteger(cell.scale) && (cell.scale as number) >= 0 && (cell.scale as number) <= 18;
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
  version: 2,
  ownerPluginId: "module.sales",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 128 },
      expectedStage: { type: "string", enum: ["qualification", "discovery", "proposal"] },
      expectedRevision: { type: "integer", minimum: 1 },
      stage: { type: "string", enum: ["discovery", "proposal", "negotiation"] }
    },
    required: ["id", "expectedStage", "expectedRevision", "stage"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, maxLength: 128 },
      name: { type: "string", minLength: 1, maxLength: 256 },
      stage: { type: "string", enum: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] },
      revision: { type: "integer", minimum: 1 }
    },
    required: ["id", "name", "stage", "revision"],
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
export const salesActivityCreateDescriptor = workflowActionDescriptor("sales.activity.create");
export const salesActivityCompleteDescriptor = workflowActionDescriptor("sales.activity.complete");
export const salesActivityCancelDescriptor = workflowActionDescriptor("sales.activity.cancel");
export const salesNoteCreateDescriptor = workflowActionDescriptor("sales.note.create");
export const salesAttachmentLinkDescriptor = workflowActionDescriptor("sales.attachment.link");
export const salesAttachmentRemoveDescriptor = workflowActionDescriptor("sales.attachment.remove");
export const salesOwnershipAssignDescriptor = workflowActionDescriptor("sales.ownership.assign");

function actionRuntime(descriptor: ActionDescriptor): RuntimeSchema<Readonly<Record<string, unknown>>> {
  return { safeParse(value) {
    if (!salesRecord(value) || descriptor.inputSchema.type !== "object" || descriptor.inputSchema.properties === undefined) return invalidRuntimeValue("Sales action input is invalid.");
    const properties = descriptor.inputSchema.properties;
    const required = new Set(descriptor.inputSchema.required ?? []);
    if (Object.keys(value).some((key) => !Object.hasOwn(properties, key)) || [...required].some((key) => !Object.hasOwn(value, key))) return invalidRuntimeValue("Sales action input is invalid.");
    for (const [key, property] of Object.entries(properties)) {
      const item = value[key]; if (item === undefined) continue;
      if (property.type === "string" && (typeof item !== "string" || item.length < (property.minLength ?? 0) || item.length > (property.maxLength ?? Number.MAX_SAFE_INTEGER) || property.enum !== undefined && !property.enum.includes(item) || salesRecordIdKeys.has(key) && !isSalesRecordId(item) || salesPrincipalIdentityKeys.has(key) && !salesPrincipalIdentityRegex.test(item) || key === "scheduledAt" && !isCanonicalUtcInstant(item))) return invalidRuntimeValue("Sales action input is invalid.");
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
function actionOutputRuntime(descriptor: ActionDescriptor): RuntimeSchema<Readonly<Record<string, unknown>>> {
  return { safeParse(value) {
    const schema = descriptor.outputSchema;
    if (!salesRecord(value) || schema === undefined || schema.type !== "object" || schema.properties === undefined) return invalidRuntimeValue("Sales action output is invalid.");
    const properties = schema.properties; const required = new Set(schema.required ?? []);
    if (Object.keys(value).some((key) => !Object.hasOwn(properties, key)) || [...required].some((key) => !Object.hasOwn(value, key))) return invalidRuntimeValue("Sales action output is invalid.");
    for (const [key, property] of Object.entries(properties)) {
      const item = value[key]; if (item === undefined) continue;
      if (property.type === "string" && (typeof item !== "string" || item.length < (property.minLength ?? 0) || item.length > (property.maxLength ?? Number.MAX_SAFE_INTEGER) || property.enum !== undefined && !property.enum.includes(item) || salesRecordIdKeys.has(key) && !isSalesRecordId(item) || salesPrincipalIdentityKeys.has(key) && !salesPrincipalIdentityRegex.test(item))) return invalidRuntimeValue("Sales action output is invalid.");
      if (property.type === "integer" && (typeof item !== "number" || !Number.isSafeInteger(item) || item < (property.minimum ?? Number.MIN_SAFE_INTEGER) || item > (property.maximum ?? Number.MAX_SAFE_INTEGER))) return invalidRuntimeValue("Sales action output is invalid.");
    }
    return { success: true as const, data: Object.freeze({ ...value }) };
  } };
}
export const salesWorkflowActionInputRuntimeSchemas = Object.freeze(Object.fromEntries([
  salesAccountCreateDescriptor, salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesContactCreateDescriptor, salesContactUpdateDescriptor, salesContactArchiveDescriptor,
  salesLeadCreateDescriptor, salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor,
  salesOpportunityCreateDescriptor, salesOpportunityUpdateDescriptor, salesOpportunityCloseDescriptor, salesOpportunityArchiveDescriptor,
  salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor, salesOwnershipAssignDescriptor
].map((descriptor) => [descriptor.id, actionRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;
export const salesWorkflowActionOutputRuntimeSchemas = Object.freeze(Object.fromEntries([
  salesAccountCreateDescriptor, salesAccountUpdateDescriptor, salesAccountArchiveDescriptor, salesContactCreateDescriptor, salesContactUpdateDescriptor, salesContactArchiveDescriptor,
  salesLeadCreateDescriptor, salesLeadUpdateDescriptor, salesLeadQualifyDescriptor, salesLeadDisqualifyDescriptor, salesLeadArchiveDescriptor,
  salesOpportunityCreateDescriptor, salesOpportunityUpdateDescriptor, salesOpportunityCloseDescriptor, salesOpportunityArchiveDescriptor,
  salesActivityCreateDescriptor, salesActivityCompleteDescriptor, salesActivityCancelDescriptor, salesNoteCreateDescriptor, salesAttachmentLinkDescriptor, salesAttachmentRemoveDescriptor, salesOwnershipAssignDescriptor
].map((descriptor) => [descriptor.id, actionOutputRuntime(descriptor)])) as Readonly<Record<string, RuntimeSchema<Readonly<Record<string, unknown>>>>>) ;

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
  descriptorSchemaVersion: 1,
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
    },
    pipelineStages: {
      type: "string-list",
      required: true,
      default: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"],
      description: "Ordered reference pipeline stages."
    }
  },
  readPermission: "sales.settings.read",
  changePermission: "sales.settings.write"
};

export type SalesWorkspaceSettings = Readonly<{
  defaultTaskPageSize: number;
  showPotentialRevenue: boolean;
  defaultPage: "overview" | "tasks" | "opportunities";
  pipelineStages: readonly string[];
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
  }
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
  id: "sales.page.opportunities", version: 3, ownerPluginId: "module.sales",
  route: { routeId: "sales.route.opportunities", params: {} }, surface: "workspace", profile: "workspace",
  permission: "sales.opportunities.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1, 2], notesMessageId: "sales.message.template-v3" },
  requirements: {
    capabilities: [], sources: [{ id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }], actions: [{ id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version }, { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }],
    blocks: [{ id: "sales.opportunity-list", version: 3 }]
  },
  document: {
    id: "sales.page.opportunities", version: 3, schemaVersion: 1, profile: "workspace",
    regions: { main: [{
      id: "sales-opportunities", type: "sales.opportunity-list", version: 3, props: { title: "Opportunities" },
      bindings: { source: { source: { id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }, input: {}, structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage-id", "revision"] }, action: { id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version } }
    }] }
  }
};

export const salesSettingsPageTemplate: PluginPageTemplateDescriptor = {
  id: "sales.page.settings", version: 2, ownerPluginId: "module.sales",
  route: { routeId: "sales.route.settings", params: {} }, surface: "workspace", profile: "workspace",
  permission: "sales.settings.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1], notesMessageId: "sales.message.template-v2" },
  requirements: { capabilities: [], sources: [], actions: [], blocks: [{ id: "sales.settings-summary", version: 2 }] },
  document: {
    id: "sales.page.settings", version: 2, schemaVersion: 1, profile: "workspace",
    regions: { main: [{ id: "sales-settings", type: "sales.settings-summary", version: 2, props: { title: "Sales settings" } }] }
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

export const salesPageTemplates = Object.freeze([
  salesOverviewPageTemplate, salesTaskPageTemplate, salesOpportunitiesPageTemplate, salesSettingsPageTemplate,
  salesAccountsPageTemplate, salesAccountDetailPageTemplate, salesContactsPageTemplate, salesContactDetailPageTemplate,
  salesLeadsPageTemplate, salesLeadDetailPageTemplate, salesOpportunityDetailPageTemplate
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

const opportunitySourcePolicy = { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: ["name", "stage-id", "revision"] };
const opportunityDetailSourcePolicy = { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "revision"] };

export const salesQuickCreateComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.form.task-quick-create", "component", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }] });
export const salesOpportunityListComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.list.opportunities", "component", "sales.opportunities.read", opportunitySourcePolicy);
export const salesOpportunityDetailComponentDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.detail.opportunity", "component", "sales.opportunities.read", opportunityDetailSourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }, { id: salesOwnershipAssignDescriptor.id, version: salesOwnershipAssignDescriptor.version }] }), version: 3 };
export const salesPipelineStatusComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.status.pipeline-stage", "component", "sales.pipelines.read");

export const salesQuickCreateBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.task-quick-create", "block", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }] });
export const salesOpportunityListBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.opportunity-list", "block", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityCreateDescriptor.id, version: salesOpportunityCreateDescriptor.version }] }), version: 3 };
export const salesOpportunityDetailBlockDescriptor: PluginUiContributionDescriptor = { ...uiContribution("sales.opportunity-detail", "block", "sales.opportunities.read", opportunityDetailSourcePolicy, { required: false, actions: [
  { id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version },
  { id: salesOpportunityUpdateDescriptor.id, version: salesOpportunityUpdateDescriptor.version },
  { id: salesOpportunityCloseDescriptor.id, version: salesOpportunityCloseDescriptor.version },
  { id: salesOpportunityArchiveDescriptor.id, version: salesOpportunityArchiveDescriptor.version },
  { id: salesOwnershipAssignDescriptor.id, version: salesOwnershipAssignDescriptor.version },
  ...salesInteractionActions.map(({ id, version }) => ({ id, version }))
] }), version: 3 };
export const salesOpportunityKanbanBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.opportunity-kanban", "block", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }] });
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

export const salesUiComponentDescriptors: readonly PluginUiContributionDescriptor[] = Object.freeze([
  salesTaskTableComponentDescriptor, salesQuickCreateComponentDescriptor,
  salesOpportunityListComponentDescriptor, salesOpportunityDetailComponentDescriptor, salesPipelineStatusComponentDescriptor,
  salesAccountListComponentDescriptor, salesAccountDetailComponentDescriptor, salesContactListComponentDescriptor, salesContactDetailComponentDescriptor, salesLeadListComponentDescriptor, salesLeadDetailComponentDescriptor
]);
export const salesUiBlockDescriptors: readonly PluginUiContributionDescriptor[] = Object.freeze([
  salesTaskTableBlockDescriptor, salesQuickCreateBlockDescriptor,
  salesOpportunityListBlockDescriptor, salesOpportunityDetailBlockDescriptor, salesOpportunityKanbanBlockDescriptor, salesSettingsSummaryBlockDescriptor,
  salesAccountListBlockDescriptor, salesAccountDetailBlockDescriptor, salesContactListBlockDescriptor, salesContactDetailBlockDescriptor, salesLeadListBlockDescriptor, salesLeadDetailBlockDescriptor
]);

export const salesEventDescriptors = Object.freeze([
  { id: "sales.event.task-changed", version: 2, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.tasks" },
  { id: "sales.event.opportunity-changed", version: 2, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.opportunities" },
  { id: "sales.event.account-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.accounts" },
  { id: "sales.event.contact-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.contacts" },
  { id: "sales.event.lead-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.leads" },
  { id: "sales.event.timeline-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.timeline" }
]);

export const salesRealtimeTopicDescriptors = Object.freeze([
  { id: "sales.realtime.tasks", version: 2, ownerPluginId: "module.sales", eventId: "sales.event.task-changed", sourceId: "sales.tasks", permission: "sales.tasks.read" },
  { id: "sales.realtime.opportunities", version: 2, ownerPluginId: "module.sales", eventId: "sales.event.opportunity-changed", sourceId: "sales.opportunities", permission: "sales.opportunities.read" },
  { id: "sales.realtime.accounts", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.account-changed", sourceId: "sales.accounts", permission: "sales.accounts.read" },
  { id: "sales.realtime.contacts", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.contact-changed", sourceId: "sales.contacts", permission: "sales.contacts.read" },
  { id: "sales.realtime.leads", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.lead-changed", sourceId: "sales.leads", permission: "sales.leads.read" },
  { id: "sales.realtime.timeline", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.timeline-changed", sourceId: "sales.timeline", permission: "sales.activities.read" }
]);

export const salesReferenceMetadata = Object.freeze({
  migration: { id: "sales.migration.initial", version: 3, ownerPluginId: "module.sales", predecessorRevisions: [1, 2] },
  service: { id: "sales.service.domain", version: 2, ownerPluginId: "module.sales" },
  job: { id: "sales.job.pipeline-audit", version: 2, ownerPluginId: "module.sales", timeoutMs: 5_000, maxConcurrency: 1, idempotent: true },
  localization: {
    id: "sales.localization.en", version: 2, ownerPluginId: "module.sales", locale: "en",
    messages: {
      "sales.message.overview": "Overview", "sales.message.tasks": "Tasks",
      "sales.message.opportunities": "Opportunities", "sales.message.settings": "Settings",
      "sales.message.navigation-overview": "Overview", "sales.message.navigation-tasks": "Tasks",
      "sales.message.navigation-opportunities": "Opportunities", "sales.message.navigation-settings": "Settings", "sales.message.navigation-accounts": "Accounts", "sales.message.navigation-contacts": "Contacts", "sales.message.navigation-leads": "Leads",
      "sales.message.template-v2": "Adopt CRM core template version 2.",
      "sales.message.template-v3": "Adopt CRM opportunity template version 3."
    }
  },
  health: { id: "sales.health.runtime", version: 2, ownerPluginId: "module.sales", safe: true },
  lifecycle: { id: "sales.lifecycle.reference", version: 2, ownerPluginId: "module.sales", disable: "supported", reenable: "supported", purge: "supported" },
  testing: { id: "sales.testing.conformance", version: 2, ownerPluginId: "module.sales", conformancePluginId: "module.sales" }
});
