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

export const salesOpportunityFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  { id: "name", kind: "text", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: true, filterOperators: ["eq", "contains"] },
  { id: "stage-id", kind: "status", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: true, filterOperators: ["eq", "in"] },
  { id: "revision", kind: "integer", binding: "required", nullable: false, permission: "sales.opportunities.read", sortable: false, filterOperators: [] },
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
      typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
      typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256 ||
      !["open", "completed", "cancelled"].includes(value.status as string) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) return invalidRuntimeValue("Sales task action output is invalid.");
    return { success: true as const, data: value as unknown as CreateTaskOutput };
  }
};

function boundedId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128; }

export const salesUpdateTaskInputRuntimeSchema: RuntimeSchema<UpdateTaskInput> = {
  safeParse(value) {
    if (!salesRecord(value) || !boundedId(value.id) || Object.keys(value).sort().join("\u0000") !== "expectedRevision\u0000expectedStatus\u0000id\u0000status" ||
      !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1 ||
      value.expectedStatus !== "open" || !["completed", "cancelled"].includes(value.status as string)) return invalidRuntimeValue("Sales task update input is invalid.");
    return { success: true as const, data: value as unknown as UpdateTaskInput };
  }
};

export const salesUpdateTaskOutputRuntimeSchema: RuntimeSchema<UpdateTaskOutput> = salesCreateTaskOutputRuntimeSchema;

export const salesOpportunityStageInputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageInput> = {
  safeParse(value) {
    const transitions: Readonly<Record<string, string>> = { qualification: "discovery", discovery: "proposal", proposal: "negotiation" };
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "expectedRevision\u0000expectedStage\u0000id\u0000stage" || !boundedId(value.id) ||
      !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1 ||
      typeof value.expectedStage !== "string" || typeof value.stage !== "string" || transitions[value.expectedStage] !== value.stage) {
      return invalidRuntimeValue("Sales opportunity stage input is invalid.");
    }
    return { success: true as const, data: value as unknown as UpdateOpportunityStageInput };
  }
};

export const salesOpportunityStageOutputRuntimeSchema: RuntimeSchema<UpdateOpportunityStageOutput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000name\u0000revision\u0000stage" || !boundedId(value.id) ||
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
  id: "sales.page.opportunities", version: 2, ownerPluginId: "module.sales",
  route: { routeId: "sales.route.opportunities", params: {} }, surface: "workspace", profile: "workspace",
  permission: "sales.opportunities.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
  migration: { adoptableFromVersions: [1], notesMessageId: "sales.message.template-v2" },
  requirements: {
    capabilities: [], sources: [{ id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }], actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }],
    blocks: [{ id: "sales.opportunity-list", version: 2 }]
  },
  document: {
    id: "sales.page.opportunities", version: 2, schemaVersion: 1, profile: "workspace",
    regions: { main: [{
      id: "sales-opportunities", type: "sales.opportunity-list", version: 2, props: { title: "Opportunities" },
      bindings: { source: { source: { id: salesOpportunitiesDescriptor.id, version: salesOpportunitiesDescriptor.version }, input: {}, structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage-id", "revision", "amount"] } }
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

export const salesPageTemplates = Object.freeze([
  salesOverviewPageTemplate, salesTaskPageTemplate, salesOpportunitiesPageTemplate, salesSettingsPageTemplate
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

const opportunitySourcePolicy = { required: true, contracts: [{ id: "table.records" as const, version: 1 as const }], requiredFields: ["name", "stage-id", "revision"] };

export const salesQuickCreateComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.form.task-quick-create", "component", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }] });
export const salesOpportunityListComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.list.opportunities", "component", "sales.opportunities.read", opportunitySourcePolicy);
export const salesOpportunityDetailComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.detail.opportunity", "component", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }] });
export const salesPipelineStatusComponentDescriptor: PluginUiContributionDescriptor = uiContribution("sales.status.pipeline-stage", "component", "sales.pipelines.read");

export const salesQuickCreateBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.task-quick-create", "block", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }] });
export const salesOpportunityListBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.opportunity-list", "block", "sales.opportunities.read", opportunitySourcePolicy);
export const salesOpportunityDetailBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.opportunity-detail", "block", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }] });
export const salesOpportunityKanbanBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.opportunity-kanban", "block", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: salesOpportunityStageUpdateDescriptor.version }] });
export const salesSettingsSummaryBlockDescriptor: PluginUiContributionDescriptor = uiContribution("sales.settings-summary", "block", "sales.settings.read");

export const salesUiComponentDescriptors: readonly PluginUiContributionDescriptor[] = Object.freeze([
  salesTaskTableComponentDescriptor, salesQuickCreateComponentDescriptor,
  salesOpportunityListComponentDescriptor, salesOpportunityDetailComponentDescriptor, salesPipelineStatusComponentDescriptor
]);
export const salesUiBlockDescriptors: readonly PluginUiContributionDescriptor[] = Object.freeze([
  salesTaskTableBlockDescriptor, salesQuickCreateBlockDescriptor,
  salesOpportunityListBlockDescriptor, salesOpportunityDetailBlockDescriptor, salesOpportunityKanbanBlockDescriptor, salesSettingsSummaryBlockDescriptor
]);

export const salesEventDescriptors = Object.freeze([
  { id: "sales.event.task-changed", version: 2, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.tasks" },
  { id: "sales.event.opportunity-changed", version: 2, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.opportunities" }
]);

export const salesRealtimeTopicDescriptors = Object.freeze([
  { id: "sales.realtime.tasks", version: 2, ownerPluginId: "module.sales", eventId: "sales.event.task-changed", sourceId: "sales.tasks", permission: "sales.tasks.read" },
  { id: "sales.realtime.opportunities", version: 2, ownerPluginId: "module.sales", eventId: "sales.event.opportunity-changed", sourceId: "sales.opportunities", permission: "sales.opportunities.read" }
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
      "sales.message.navigation-opportunities": "Opportunities", "sales.message.navigation-settings": "Settings",
      "sales.message.template-v2": "Adopt CRM core template version 2."
    }
  },
  health: { id: "sales.health.runtime", version: 2, ownerPluginId: "module.sales", safe: true },
  lifecycle: { id: "sales.lifecycle.reference", version: 2, ownerPluginId: "module.sales", disable: "supported", reenable: "supported", purge: "supported" },
  testing: { id: "sales.testing.conformance", version: 2, ownerPluginId: "module.sales", conformancePluginId: "module.sales" }
});
