import type {
  AgentToolDescriptor,
  AgentToolJsonSchema,
  DataSourceDescriptor,
  MetricScalar,
  PermissionDescriptor,
  PluginNavigationDescriptor,
  PluginPageTemplateDescriptor,
  PluginRouteDescriptor,
  PluginSettingsDescriptor,
  RuntimeSchema,
  TableRecords
} from "@k-nex/contracts";
import { MetricScalarSchema, TableRecordsSchema } from "@k-nex/contracts";

const salesSourceLimits = Object.freeze({
  maxSelectedFields: 8,
  maxPageSize: 100,
  maxFilters: 8,
  maxSorts: 2,
  maxBodyBytes: 32_768,
  maxResultBytes: 1_048_576,
  maxDepth: 6,
  timeoutMs: 5_000,
  maxConcurrency: 16,
  ratePerMinute: 300,
  burst: 30,
  costClass: "medium" as const,
  maxCost: 100
});

const salesMetricLimits = Object.freeze({
  ...salesSourceLimits,
  maxSelectedFields: 1,
  maxFilters: 0,
  maxSorts: 0,
  costClass: "high" as const,
  maxCost: 50
});

export const salesTaskFields: NonNullable<DataSourceDescriptor["outputFields"]> = [
  {
    id: "title",
    kind: "text",
    binding: "required",
    nullable: false,
    permission: "sales.tasks.title.read",
    sortable: true,
    filterOperators: ["eq", "contains"]
  },
  {
    id: "status",
    kind: "status",
    binding: "required",
    nullable: false,
    permission: "sales.tasks.status.read",
    sortable: true,
    filterOperators: ["eq", "in"]
  },
  {
    id: "potential-revenue",
    kind: "money",
    binding: "required",
    nullable: true,
    permission: "sales.tasks.revenue.read",
    sortable: false,
    filterOperators: []
  },
  {
    id: "private-note",
    kind: "text",
    binding: "optional",
    nullable: true,
    permission: "sales.tasks.private-note.read",
    sortable: false,
    filterOperators: []
  }
] as const;

export const salesTotalPotentialRevenueDescriptor: DataSourceDescriptor = {
  id: "sales.total-potential-revenue",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "metric.scalar", version: 1 },
  sourceSchema: { id: "sales.total-potential-revenue.output", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.revenue.read",
  structuralCompatibilityHash: "sha256:4e20e6c42ce9d3ea887a6b9d18bce800ec0c2d1b3ff2b6357f740374f091e45b",
  presentationMetadataRevision: 1,
  title: "Total potential revenue",
  inputFields: [],
  limits: { ...salesMetricLimits },
  cacheClass: "actor"
};

export const salesTasksDescriptor: DataSourceDescriptor = {
  id: "sales.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks.output", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  structuralCompatibilityHash: "sha256:c8367ee2c153671b70e606ec4445358ab2ebbf5561318cef1829fe4390487120",
  presentationMetadataRevision: 1,
  title: "Sales tasks",
  inputFields: [],
  outputFields: salesTaskFields,
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
    title: { type: "string", minLength: 1, maxLength: 256 },
    status: { type: "string", enum: ["open", "done"] },
    potentialRevenue: { type: "string", minLength: 1, maxLength: 64 },
    privateNote: { type: "string", minLength: 1, maxLength: 4_096 }
  },
  required: ["title"],
  additionalProperties: false
};

const salesCreateTaskOutputSchema: AgentToolJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    title: { type: "string", minLength: 1, maxLength: 256 },
    status: { type: "string", enum: ["open", "done"] }
  },
  required: ["id", "title", "status"],
  additionalProperties: false
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
  readonly status?: "open" | "done";
  readonly potentialRevenue?: string;
  readonly privateNote?: string;
}

export interface CreateTaskOutput {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "done";
}

const salesDecimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
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
    if (!salesRecord(value) || Object.keys(value).some((key) => !["title", "status", "potentialRevenue", "privateNote"].includes(key))) {
      return invalidRuntimeValue("Sales task input must be a closed object.");
    }
    if (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256) return invalidRuntimeValue("Sales task title is invalid.");
    if (value.status !== undefined && value.status !== "open" && value.status !== "done") return invalidRuntimeValue("Sales task status is invalid.");
    if (value.potentialRevenue !== undefined && (typeof value.potentialRevenue !== "string" || value.potentialRevenue.length > 64 || !salesDecimalPattern.test(value.potentialRevenue))) {
      return invalidRuntimeValue("Sales task revenue is invalid.");
    }
    if (value.privateNote !== undefined && (typeof value.privateNote !== "string" || value.privateNote.length < 1 || value.privateNote.length > 4_096)) {
      return invalidRuntimeValue("Sales task private note is invalid.");
    }
    return { success: true as const, data: {
      title: value.title,
      ...(value.status === undefined ? {} : { status: value.status }),
      ...(value.potentialRevenue === undefined ? {} : { potentialRevenue: value.potentialRevenue }),
      ...(value.privateNote === undefined ? {} : { privateNote: value.privateNote })
    } };
  }
};

export const salesCreateTaskOutputRuntimeSchema: RuntimeSchema<CreateTaskOutput> = {
  safeParse(value) {
    if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000status\u0000title" ||
      typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
      typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256 ||
      value.status !== "open" && value.status !== "done") return invalidRuntimeValue("Sales task action output is invalid.");
    return { success: true as const, data: value as unknown as CreateTaskOutput };
  }
};

export const salesTotalPotentialRevenueOutputRuntimeSchema: RuntimeSchema<MetricScalar> = {
  safeParse(value) {
    const parsed = MetricScalarSchema.safeParse(value);
    if (!parsed.success) return parsed;
    if (Object.keys(parsed.data).join("\u0000") !== "value" || parsed.data.value.kind !== "money" || parsed.data.value.currency !== "USD" || "rounding" in parsed.data.value) {
      return invalidRuntimeValue("Sales revenue output must be an exact USD money metric.");
    }
    return parsed;
  }
};

const salesTaskOutputFieldIds = new Set(salesTaskFields.map((field) => field.id));
const salesRequiredTaskOutputFieldIds = new Set(salesTaskFields.filter((field) => field.binding === "required").map((field) => field.id));

function exactSalesTaskCell(fieldId: string, cell: unknown): boolean {
  const field = salesTaskFields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return false;
  if (cell === null) return field.nullable;
  if (!salesRecord(cell) || cell.kind !== field.kind) return false;
  const expectedKeys = field.kind === "money" ? ["kind", "value", "currency", "scale"] : ["kind", "value"];
  if (Object.keys(cell).join("\u0000") !== expectedKeys.join("\u0000") || !field.nullable && cell.value === null) return false;
  if (fieldId === "potential-revenue" && cell.currency !== "USD") return false;
  return fieldId !== "status" || cell.value === "open" || cell.value === "done";
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

export const salesTaskCreateDescriptor = {
  id: "sales.task.create",
  version: 1,
  ownerPluginId: "module.sales",
  inputSchema: salesCreateTaskInputSchema,
  outputSchema: salesCreateTaskOutputSchema,
  permission: "sales.tasks.write",
  policy: "sales.tasks.domain",
  effect: "write" as const,
  idempotency: "required" as const,
  dryRun: false
} as const;

export const salesSearchTasksDescriptor: AgentToolDescriptor = {
  id: "sales.tools.search-tasks",
  version: 1,
  ownerPluginId: "module.sales",
  title: "Search tasks",
  description: "Search tasks visible to the current actor.",
  inputSchema: salesSearchTasksInputSchema,
  outputContract: "table.records@1",
  invocation: { kind: "source", source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version } },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  policy: "sales.tasks.agent-read",
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
  version: 1,
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
  redaction: { inputPaths: ["/privateNote"], outputPaths: [] },
  audit: { category: "sales.task.create", resourcePath: "/id" }
};

export const salesWorkspaceSettingsDescriptor: PluginSettingsDescriptor = {
  id: "sales.settings.workspace",
  ownerPluginId: "module.sales",
  schemaVersion: 1,
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
    }
  },
  surface: "workspace",
  audience: "authenticated",
  readPermission: "sales.settings.read",
  changePermission: "sales.settings.write",
  featureRevision: 1,
  publicationRevision: 1
};

function permission(
  id: string,
  title: string,
  description: string,
  resource: string,
  operation: PermissionDescriptor["operation"],
  scope: PermissionDescriptor["policy"]["scope"]
): PermissionDescriptor {
  return {
    id,
    ownerPluginId: "module.sales",
    title,
    description,
    audience: "authenticated",
    resource,
    operation,
    policy: {
      id: `sales.policy.${id.slice("sales.".length).replaceAll(".", "-")}`,
      scope,
      recordScoped: scope === "record" || scope === "field",
      fieldScoped: scope === "field"
    }
  };
}

export const salesPermissionDescriptors = Object.freeze([
  permission("sales.settings.read", "Read Sales settings", "Read non-secret Sales workspace settings.", "sales.settings", "read", "application"),
  permission("sales.settings.write", "Change Sales settings", "Change validated Sales workspace settings.", "sales.settings", "write", "application"),
  permission("sales.tasks.read", "Read Sales tasks", "Read actor-authorized Sales task records.", "sales.tasks", "read", "record"),
  permission("sales.tasks.title.read", "Read task titles", "Read task title fields.", "sales.tasks.title", "read", "field"),
  permission("sales.tasks.status.read", "Read task status", "Read task status fields.", "sales.tasks.status", "read", "field"),
  permission("sales.tasks.revenue.read", "Read task revenue", "Read potential revenue fields.", "sales.tasks.revenue", "read", "field"),
  permission("sales.tasks.private-note.read", "Read private task notes", "Read private task note fields.", "sales.tasks.private-note", "read", "field"),
  permission("sales.tasks.write", "Write Sales tasks", "Create and update actor-authorized Sales tasks.", "sales.tasks", "write", "record")
]);

export const salesRouteDescriptors = Object.freeze([
  {
    id: "sales.route.tasks",
    ownerPluginId: "module.sales",
    path: "/sales/tasks",
    parameters: {},
    surface: "workspace",
    audience: "authenticated",
    permission: "sales.tasks.read",
    viewId: "sales.view.tasks"
  },
  {
    id: "sales.route.task-detail",
    ownerPluginId: "module.sales",
    path: "/sales/tasks/:taskId",
    parameters: { taskId: { type: "string" } },
    surface: "workspace",
    audience: "authenticated",
    permission: "sales.tasks.read",
    viewId: "sales.view.task-detail"
  }
] satisfies readonly PluginRouteDescriptor[]);

export const salesNavigationDescriptors = Object.freeze([
  {
    id: "sales.navigation.tasks",
    ownerPluginId: "module.sales",
    labelMessageId: "sales.message.navigation-tasks",
    route: { routeId: "sales.route.tasks", params: {} },
    permission: "sales.tasks.read",
    order: 10
  }
] satisfies readonly PluginNavigationDescriptor[]);

export const salesTaskPageTemplate: PluginPageTemplateDescriptor = {
  id: "sales.page.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  route: { routeId: "sales.route.tasks", params: {} },
  surface: "workspace",
  profile: "workspace",
  permission: "sales.tasks.read",
  publicationPolicy: { ownership: "customer", adoption: "explicit" },
  requirements: {
    capabilities: [],
    sources: [{ id: salesTasksDescriptor.id, version: salesTasksDescriptor.version }],
    actions: [{ id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version }],
    blocks: [{ id: "sales.task-table", version: 2 }]
  },
  document: {
    id: "sales.page.tasks",
    version: 1,
    schemaVersion: 1,
    profile: "workspace",
    regions: {
      main: [{
        id: "sales-tasks",
        type: "sales.task-table",
        version: 2,
        props: { title: "Sales tasks" },
        bindings: {
          source: {
            source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version },
            input: {},
            structuralCompatibilityHash: salesTasksDescriptor.structuralCompatibilityHash,
            selectedFields: ["title", "status", "potential-revenue"]
          }
        }
      }]
    }
  }
};
