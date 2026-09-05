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
    costClass: "medium",
    maxCost: 100
});
const salesMetricLimits = Object.freeze({
    ...salesSourceLimits,
    maxSelectedFields: 1,
    maxFilters: 0,
    maxSorts: 0,
    costClass: "high",
    maxCost: 50
});
export const salesTaskFields = [
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
];
export const salesTotalPotentialRevenueDescriptor = {
    id: "sales.total-potential-revenue",
    version: 1,
    ownerPluginId: "module.sales",
    primaryContract: { id: "metric.scalar", version: 1 },
    sourceSchema: { id: "sales.total-potential-revenue.output", version: 1 },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "sales.tasks.revenue.read",
    structuralCompatibilityHash: "sha256:44396ab7e33f70f1bb4250494af86105624f2c28b9e7095e8d438fc7fafeb85d",
    presentationMetadataRevision: 1,
    title: "Total potential revenue",
    inputFields: [],
    paginationModes: [],
    limits: { ...salesMetricLimits },
    cacheClass: "actor"
};
export const salesTasksDescriptor = {
    id: "sales.tasks",
    version: 1,
    ownerPluginId: "module.sales",
    primaryContract: { id: "table.records", version: 1 },
    sourceSchema: { id: "sales.tasks.output", version: 1 },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "sales.tasks.read",
    structuralCompatibilityHash: "sha256:520d5f0bd7874a0b9c63fd3974ce355180314fcbd961ca9407a781d9fc768f26",
    presentationMetadataRevision: 1,
    title: "Sales tasks",
    inputFields: [],
    outputFields: salesTaskFields,
    paginationModes: ["offset", "cursor"],
    limits: { ...salesSourceLimits },
    cacheClass: "actor"
};
export const salesOpportunityFields = [
    { id: "name", kind: "text", binding: "required", nullable: false, permission: "sales.opportunities.name.read", sortable: true, filterOperators: ["eq", "contains"] },
    { id: "stage", kind: "status", binding: "required", nullable: false, permission: "sales.opportunities.stage.read", sortable: true, filterOperators: ["eq", "in"] },
    { id: "revision", kind: "text", binding: "optional", nullable: false, permission: "sales.opportunities.stage.read", sortable: false, filterOperators: [] },
    { id: "value", kind: "money", binding: "optional", nullable: true, permission: "sales.opportunities.value.read", sortable: false, filterOperators: [] }
];
export const salesOpportunitiesDescriptor = {
    id: "sales.opportunities",
    version: 1,
    ownerPluginId: "module.sales",
    primaryContract: { id: "table.records", version: 1 },
    sourceSchema: { id: "sales.opportunities.output", version: 1 },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "sales.opportunities.read",
    structuralCompatibilityHash: "sha256:09311605c4c5afaab4ff5f902f88f5c206fc1c7dd5e925f713d72d6a2ddba066",
    presentationMetadataRevision: 1,
    title: "Sales opportunities",
    inputFields: [],
    outputFields: salesOpportunityFields,
    paginationModes: ["offset"],
    limits: { ...salesSourceLimits },
    cacheClass: "actor"
};
const salesSearchTasksInputSchema = {
    type: "object",
    properties: {
        title: { type: "string", minLength: 1, maxLength: 120 }
    },
    required: ["title"],
    additionalProperties: false
};
const salesCreateTaskInputSchema = {
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
const salesCreateTaskOutputSchema = {
    type: "object",
    properties: {
        id: { type: "string", minLength: 1, maxLength: 128 },
        title: { type: "string", minLength: 1, maxLength: 256 },
        status: { type: "string", enum: ["open", "done"] }
    },
    required: ["id", "title", "status"],
    additionalProperties: false
};
export const salesTaskTablePropsSchema = {
    type: "object",
    properties: { title: { type: "string", minLength: 1, maxLength: 120 } },
    required: ["title"],
    additionalProperties: false
};
const salesToolLimits = Object.freeze({
    timeoutMs: 5_000,
    maxConcurrency: 4,
    ratePerMinute: 120,
    burst: 10,
    costClass: "low",
    maxCost: 10
});
const salesDecimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const salesRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const invalidRuntimeValue = (message) => ({ success: false, error: new Error(message) });
export const salesEmptyInputRuntimeSchema = {
    safeParse(value) {
        return salesRecord(value) && Object.keys(value).length === 0
            ? { success: true, data: {} }
            : invalidRuntimeValue("Sales data-source input must be empty.");
    }
};
export const salesCreateTaskInputRuntimeSchema = {
    safeParse(value) {
        if (!salesRecord(value) || Object.keys(value).some((key) => !["title", "status", "potentialRevenue", "privateNote"].includes(key))) {
            return invalidRuntimeValue("Sales task input must be a closed object.");
        }
        if (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256)
            return invalidRuntimeValue("Sales task title is invalid.");
        if (value.status !== undefined && value.status !== "open" && value.status !== "done")
            return invalidRuntimeValue("Sales task status is invalid.");
        if (value.potentialRevenue !== undefined && (typeof value.potentialRevenue !== "string" || value.potentialRevenue.length > 64 || !salesDecimalPattern.test(value.potentialRevenue))) {
            return invalidRuntimeValue("Sales task revenue is invalid.");
        }
        if (value.privateNote !== undefined && (typeof value.privateNote !== "string" || value.privateNote.length < 1 || value.privateNote.length > 4_096)) {
            return invalidRuntimeValue("Sales task private note is invalid.");
        }
        return { success: true, data: {
                title: value.title,
                ...(value.status === undefined ? {} : { status: value.status }),
                ...(value.potentialRevenue === undefined ? {} : { potentialRevenue: value.potentialRevenue }),
                ...(value.privateNote === undefined ? {} : { privateNote: value.privateNote })
            } };
    }
};
export const salesCreateTaskOutputRuntimeSchema = {
    safeParse(value) {
        if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000status\u0000title" ||
            typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
            typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256 ||
            value.status !== "open" && value.status !== "done")
            return invalidRuntimeValue("Sales task action output is invalid.");
        return { success: true, data: value };
    }
};
function boundedId(value) { return typeof value === "string" && value.length > 0 && value.length <= 128; }
export const salesUpdateTaskInputRuntimeSchema = {
    safeParse(value) {
        if (!salesRecord(value) || !boundedId(value.id) || Object.keys(value).some((key) => !["id", "title", "status"].includes(key)) ||
            value.title === undefined && value.status === undefined || value.title !== undefined && (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 256) ||
            value.status !== undefined && value.status !== "open" && value.status !== "done")
            return invalidRuntimeValue("Sales task update input is invalid.");
        return { success: true, data: value };
    }
};
export const salesUpdateTaskOutputRuntimeSchema = salesCreateTaskOutputRuntimeSchema;
export const salesOpportunityStageInputRuntimeSchema = {
    safeParse(value) {
        if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "expectedRevision\u0000expectedStage\u0000id\u0000stage" || !boundedId(value.id) ||
            typeof value.expectedRevision !== "string" || !Number.isFinite(Date.parse(value.expectedRevision)) ||
            ![value.expectedStage, value.stage].every((stage) => ["lead", "qualified", "won", "lost"].includes(stage))) {
            return invalidRuntimeValue("Sales opportunity stage input is invalid.");
        }
        return { success: true, data: value };
    }
};
export const salesOpportunityStageOutputRuntimeSchema = {
    safeParse(value) {
        if (!salesRecord(value) || Object.keys(value).sort().join("\u0000") !== "id\u0000name\u0000revision\u0000stage" || !boundedId(value.id) ||
            typeof value.name !== "string" || value.name.length < 1 || value.name.length > 256 || !["lead", "qualified", "won", "lost"].includes(value.stage) ||
            typeof value.revision !== "string" || !Number.isFinite(Date.parse(value.revision))) {
            return invalidRuntimeValue("Sales opportunity stage output is invalid.");
        }
        return { success: true, data: value };
    }
};
export const salesTotalPotentialRevenueOutputRuntimeSchema = {
    safeParse(value) {
        const parsed = MetricScalarSchema.safeParse(value);
        if (!parsed.success)
            return parsed;
        if (Object.keys(parsed.data).join("\u0000") !== "value" || parsed.data.value.kind !== "money" || parsed.data.value.currency !== "USD" || "rounding" in parsed.data.value) {
            return invalidRuntimeValue("Sales revenue output must be an exact USD money metric.");
        }
        return parsed;
    }
};
const salesTaskOutputFieldIds = new Set(salesTaskFields.map((field) => field.id));
const salesRequiredTaskOutputFieldIds = new Set(salesTaskFields.filter((field) => field.binding === "required").map((field) => field.id));
function exactSalesTaskCell(fieldId, cell) {
    const field = salesTaskFields.find((candidate) => candidate.id === fieldId);
    if (field === undefined)
        return false;
    if (cell === null)
        return field.nullable;
    if (!salesRecord(cell) || cell.kind !== field.kind)
        return false;
    const expectedKeys = field.kind === "money" ? ["kind", "value", "currency", "scale"] : ["kind", "value"];
    if (Object.keys(cell).join("\u0000") !== expectedKeys.join("\u0000") || !field.nullable && cell.value === null)
        return false;
    if (fieldId === "potential-revenue" && cell.currency !== "USD")
        return false;
    return fieldId !== "status" || cell.value === "open" || cell.value === "done";
}
export const salesTasksOutputRuntimeSchema = {
    safeParse(value) {
        const parsed = TableRecordsSchema.safeParse(value);
        if (!parsed.success)
            return parsed;
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
export const salesOpportunitiesOutputRuntimeSchema = {
    safeParse(value) {
        const parsed = TableRecordsSchema.safeParse(value);
        if (!parsed.success)
            return parsed;
        if (parsed.data.fields.some((field) => !opportunityFieldIds.has(field)) || ["name", "stage"].some((field) => !parsed.data.fields.includes(field))) {
            return invalidRuntimeValue("Sales opportunity output fields are invalid.");
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
    effect: "write",
    idempotency: "required",
    dryRun: false
};
export const salesTaskUpdateDescriptor = {
    id: "sales.task.update",
    version: 1,
    ownerPluginId: "module.sales",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", minLength: 1, maxLength: 128 },
            title: { type: "string", minLength: 1, maxLength: 256 },
            status: { type: "string", enum: ["open", "done"] }
        },
        required: ["id"],
        additionalProperties: false
    },
    outputSchema: salesCreateTaskOutputSchema,
    permission: "sales.tasks.write",
    policy: "sales.tasks.domain",
    effect: "write",
    idempotency: "required",
    dryRun: false
};
export const salesOpportunityStageUpdateDescriptor = {
    id: "sales.opportunity.stage.update",
    version: 1,
    ownerPluginId: "module.sales",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", minLength: 1, maxLength: 128 },
            expectedStage: { type: "string", enum: ["lead", "qualified", "won", "lost"] },
            expectedRevision: { type: "string", minLength: 20, maxLength: 32 },
            stage: { type: "string", enum: ["lead", "qualified", "won", "lost"] }
        },
        required: ["id", "expectedStage", "expectedRevision", "stage"],
        additionalProperties: false
    },
    outputSchema: {
        type: "object",
        properties: {
            id: { type: "string", minLength: 1, maxLength: 128 },
            name: { type: "string", minLength: 1, maxLength: 256 },
            stage: { type: "string", enum: ["lead", "qualified", "won", "lost"] },
            revision: { type: "string", minLength: 20, maxLength: 32 }
        },
        required: ["id", "name", "stage", "revision"],
        additionalProperties: false
    },
    permission: "sales.opportunities.write",
    policy: "sales.opportunities.domain",
    effect: "write",
    idempotency: "required",
    dryRun: false
};
export const salesSearchTasksDescriptor = {
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
    policy: "sales.tasks.domain",
    effect: "read-only",
    risk: "low",
    approval: "none",
    idempotency: "not-applicable",
    dryRun: false,
    limits: salesToolLimits,
    redaction: { inputPaths: [], outputPaths: [] },
    audit: { category: "sales.task.search" }
};
export const salesCreateTaskToolDescriptor = {
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
export const salesWorkspaceSettingsDescriptor = {
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
            default: ["lead", "qualified", "won", "lost"],
            description: "Ordered reference pipeline stages."
        }
    },
    readPermission: "sales.settings.read",
    changePermission: "sales.settings.write"
};
function permission(id, title, description, resource, operation, scope) {
    return {
        schemaVersion: 1,
        id,
        publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
        title,
        description,
        audience: "authenticated",
        resource,
        operation,
        scope
    };
}
export const salesPermissionDescriptors = Object.freeze([
    permission("sales.navigation.read", "Open Sales workspace", "Open registered Sales workspace routes and navigation.", "sales.navigation", "read", "application"),
    permission("sales.settings.read", "Read Sales settings", "Read non-secret Sales workspace settings.", "sales.settings", "read", "application"),
    permission("sales.settings.write", "Change Sales settings", "Change validated Sales workspace settings.", "sales.settings", "write", "application"),
    permission("sales.tasks.read", "Read Sales tasks", "Read actor-authorized Sales task records.", "sales.tasks", "read", "record"),
    permission("sales.tasks.title.read", "Read task titles", "Read task title fields.", "sales.tasks.title", "read", "field"),
    permission("sales.tasks.status.read", "Read task status", "Read task status fields.", "sales.tasks.status", "read", "field"),
    permission("sales.tasks.revenue.read", "Read task revenue", "Read potential revenue fields.", "sales.tasks.revenue", "read", "field"),
    permission("sales.tasks.private-note.read", "Read private task notes", "Read private task note fields.", "sales.tasks.private-note", "read", "field"),
    permission("sales.tasks.write", "Write Sales tasks", "Create and update actor-authorized Sales tasks.", "sales.tasks", "write", "record"),
    permission("sales.opportunities.read", "Read opportunities", "Read actor-authorized Sales opportunities.", "sales.opportunities", "read", "record"),
    permission("sales.opportunities.name.read", "Read opportunity names", "Read opportunity name fields.", "sales.opportunities.name", "read", "field"),
    permission("sales.opportunities.stage.read", "Read opportunity stages", "Read opportunity stage fields.", "sales.opportunities.stage", "read", "field"),
    permission("sales.opportunities.value.read", "Read opportunity values", "Read opportunity value fields.", "sales.opportunities.value", "read", "field"),
    permission("sales.opportunities.write", "Change opportunity stages", "Change actor-authorized opportunity stages.", "sales.opportunities", "write", "record")
]);
const salesPermissionPublisher = {
    kind: "extension",
    deliveryClass: "platform-plugin",
    extensionId: "module.sales"
};
/** Static bindings for the existing Sales record and field policy seams. */
export const salesPermissionPolicyBindings = Object.freeze([
    {
        schemaVersion: 1,
        id: "sales.policy.tasks.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.tasks.read",
        policyReference: "sales.tasks.domain",
        scope: "record",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.tasks.title.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.tasks.title.read",
        policyReference: "sales.tasks.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.tasks.status.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.tasks.status.read",
        policyReference: "sales.tasks.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.tasks.revenue.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.tasks.revenue.read",
        policyReference: "sales.tasks.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.tasks.private-note.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.tasks.private-note.read",
        policyReference: "sales.tasks.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.tasks.write",
        publisher: salesPermissionPublisher,
        permissionId: "sales.tasks.write",
        policyReference: "sales.tasks.domain",
        scope: "record",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.opportunities.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.opportunities.read",
        policyReference: "sales.opportunities.domain",
        scope: "record",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.opportunities.name.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.opportunities.name.read",
        policyReference: "sales.opportunities.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.opportunities.stage.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.opportunities.stage.read",
        policyReference: "sales.opportunities.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.opportunities.value.read",
        publisher: salesPermissionPublisher,
        permissionId: "sales.opportunities.value.read",
        policyReference: "sales.opportunities.domain",
        scope: "field",
        failureMode: "deny",
        timeoutMs: 1_000
    },
    {
        schemaVersion: 1,
        id: "sales.policy.opportunities.write",
        publisher: salesPermissionPublisher,
        permissionId: "sales.opportunities.write",
        policyReference: "sales.opportunities.domain",
        scope: "record",
        failureMode: "deny",
        timeoutMs: 1_000
    }
]);
/** Static Sales role defaults; customer roles and assignments remain platform-owned. */
export const salesRoleTemplates = Object.freeze([
    {
        schemaVersion: 1,
        id: "sales.template.viewer",
        publisher: salesPermissionPublisher,
        version: 1,
        instantiation: "manual",
        title: "Sales Viewer",
        description: "View core Sales tasks and opportunities.",
        permissionIds: [
            "sales.navigation.read",
            "sales.opportunities.name.read",
            "sales.opportunities.read",
            "sales.opportunities.stage.read",
            "sales.tasks.read",
            "sales.tasks.status.read",
            "sales.tasks.title.read"
        ]
    },
    {
        schemaVersion: 1,
        id: "sales.template.representative",
        publisher: salesPermissionPublisher,
        version: 1,
        instantiation: "manual",
        title: "Sales Representative",
        description: "View core Sales data and manage assigned tasks.",
        permissionIds: [
            "sales.navigation.read",
            "sales.opportunities.name.read",
            "sales.opportunities.read",
            "sales.opportunities.stage.read",
            "sales.tasks.private-note.read",
            "sales.tasks.read",
            "sales.tasks.status.read",
            "sales.tasks.title.read",
            "sales.tasks.write"
        ]
    },
    {
        schemaVersion: 1,
        id: "sales.template.manager",
        publisher: salesPermissionPublisher,
        version: 1,
        instantiation: "manual",
        title: "Sales Manager",
        description: "Manage the Sales pipeline and view revenue data.",
        permissionIds: [
            "sales.navigation.read",
            "sales.opportunities.name.read",
            "sales.opportunities.read",
            "sales.opportunities.stage.read",
            "sales.opportunities.value.read",
            "sales.opportunities.write",
            "sales.tasks.private-note.read",
            "sales.tasks.read",
            "sales.tasks.revenue.read",
            "sales.tasks.status.read",
            "sales.tasks.title.read",
            "sales.tasks.write"
        ]
    },
    {
        schemaVersion: 1,
        id: "sales.template.administrator",
        publisher: salesPermissionPublisher,
        version: 1,
        instantiation: "manual",
        title: "Sales Administrator",
        description: "Manage all Sales data and workspace settings.",
        permissionIds: [
            "sales.navigation.read",
            "sales.opportunities.name.read",
            "sales.opportunities.read",
            "sales.opportunities.stage.read",
            "sales.opportunities.value.read",
            "sales.opportunities.write",
            "sales.settings.read",
            "sales.settings.write",
            "sales.tasks.private-note.read",
            "sales.tasks.read",
            "sales.tasks.revenue.read",
            "sales.tasks.status.read",
            "sales.tasks.title.read",
            "sales.tasks.write"
        ]
    }
]);
export const salesRouteDescriptors = Object.freeze([
    {
        id: "sales.route.overview",
        ownerPluginId: "module.sales",
        path: "/sales",
        parameters: {},
        surface: "workspace",
        audience: "authenticated",
        permission: "sales.navigation.read",
        viewId: "sales.page.overview"
    },
    {
        id: "sales.route.tasks",
        ownerPluginId: "module.sales",
        path: "/sales/tasks",
        parameters: {},
        surface: "workspace",
        audience: "authenticated",
        permission: "sales.navigation.read",
        viewId: "sales.page.tasks"
    },
    {
        id: "sales.route.opportunities",
        ownerPluginId: "module.sales",
        path: "/sales/opportunities",
        parameters: {},
        surface: "workspace",
        audience: "authenticated",
        permission: "sales.navigation.read",
        viewId: "sales.page.opportunities"
    },
    {
        id: "sales.route.settings",
        ownerPluginId: "module.sales",
        path: "/sales/settings",
        parameters: {},
        surface: "workspace",
        audience: "authenticated",
        permission: "sales.navigation.read",
        viewId: "sales.page.settings"
    }
]);
export const salesNavigationDescriptors = Object.freeze([
    {
        id: "sales.navigation.overview",
        ownerPluginId: "module.sales",
        labelMessageId: "sales.message.navigation-overview",
        route: { routeId: "sales.route.overview", params: {} },
        permission: "sales.navigation.read",
        order: 10
    },
    {
        id: "sales.navigation.tasks",
        ownerPluginId: "module.sales",
        labelMessageId: "sales.message.navigation-tasks",
        route: { routeId: "sales.route.tasks", params: {} },
        permission: "sales.navigation.read",
        order: 20
    },
    {
        id: "sales.navigation.opportunities",
        ownerPluginId: "module.sales",
        labelMessageId: "sales.message.navigation-opportunities",
        route: { routeId: "sales.route.opportunities", params: {} },
        permission: "sales.navigation.read",
        order: 30
    },
    {
        id: "sales.navigation.settings",
        ownerPluginId: "module.sales",
        labelMessageId: "sales.message.navigation-settings",
        route: { routeId: "sales.route.settings", params: {} },
        permission: "sales.navigation.read",
        order: 40
    }
]);
export const salesTaskPageTemplate = {
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
        blocks: [{ id: "sales.task-table", version: 2 }, { id: "sales.task-quick-create", version: 1 }]
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
                }, {
                    id: "sales-task-create",
                    type: "sales.task-quick-create",
                    version: 1,
                    props: { title: "Create task" },
                    bindings: { action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version } }
                }]
        }
    }
};
export const salesOverviewPageTemplate = {
    id: "sales.page.overview", version: 1, ownerPluginId: "module.sales",
    route: { routeId: "sales.route.overview", params: {} }, surface: "workspace", profile: "workspace",
    permission: "sales.tasks.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
    requirements: {
        capabilities: [], sources: [{ id: salesTotalPotentialRevenueDescriptor.id, version: 1 }], actions: [],
        blocks: [{ id: "sales.revenue-metric", version: 1 }]
    },
    document: {
        id: "sales.page.overview", version: 1, schemaVersion: 1, profile: "workspace",
        regions: { main: [{
                    id: "sales-revenue", type: "sales.revenue-metric", version: 1, props: { title: "Total potential revenue" },
                    bindings: { source: { source: { id: salesTotalPotentialRevenueDescriptor.id, version: 1 }, input: {}, structuralCompatibilityHash: salesTotalPotentialRevenueDescriptor.structuralCompatibilityHash } }
                }] }
    }
};
export const salesOpportunitiesPageTemplate = {
    id: "sales.page.opportunities", version: 1, ownerPluginId: "module.sales",
    route: { routeId: "sales.route.opportunities", params: {} }, surface: "workspace", profile: "workspace",
    permission: "sales.opportunities.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
    requirements: {
        capabilities: [], sources: [{ id: salesOpportunitiesDescriptor.id, version: 1 }], actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: 1 }],
        blocks: [{ id: "sales.opportunity-list", version: 1 }]
    },
    document: {
        id: "sales.page.opportunities", version: 1, schemaVersion: 1, profile: "workspace",
        regions: { main: [{
                    id: "sales-opportunities", type: "sales.opportunity-list", version: 1, props: { title: "Opportunities" },
                    bindings: { source: { source: { id: salesOpportunitiesDescriptor.id, version: 1 }, input: {}, structuralCompatibilityHash: salesOpportunitiesDescriptor.structuralCompatibilityHash, selectedFields: ["name", "stage", "revision", "value"] } }
                }] }
    }
};
export const salesSettingsPageTemplate = {
    id: "sales.page.settings", version: 1, ownerPluginId: "module.sales",
    route: { routeId: "sales.route.settings", params: {} }, surface: "workspace", profile: "workspace",
    permission: "sales.settings.read", publicationPolicy: { ownership: "customer", adoption: "explicit" },
    requirements: { capabilities: [], sources: [], actions: [], blocks: [{ id: "sales.settings-summary", version: 1 }] },
    document: {
        id: "sales.page.settings", version: 1, schemaVersion: 1, profile: "workspace",
        regions: { main: [{ id: "sales-settings", type: "sales.settings-summary", version: 1, props: { title: "Sales settings" } }] }
    }
};
export const salesPageTemplates = Object.freeze([
    salesOverviewPageTemplate, salesTaskPageTemplate, salesOpportunitiesPageTemplate, salesSettingsPageTemplate
]);
const salesTaskUiPolicy = {
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
export const salesTaskTableComponentDescriptor = {
    id: "sales.table.tasks",
    version: 1,
    ownerPluginId: "module.sales",
    kind: "component",
    ...salesTaskUiPolicy
};
export const salesTaskTableBlockDescriptor = {
    id: "sales.task-table",
    version: 2,
    ownerPluginId: "module.sales",
    kind: "block",
    ...salesTaskUiPolicy
};
function uiContribution(id, kind, permissionId, sourcePolicy, actionPolicy) {
    return {
        id, version: 1, ownerPluginId: "module.sales", kind,
        propsSchema: salesTaskTablePropsSchema,
        profiles: ["workspace"], surfaces: ["workspace"], audience: "authenticated", permission: permissionId,
        ...(sourcePolicy === undefined ? {} : { sourcePolicy }),
        ...(actionPolicy === undefined ? {} : { actionPolicy }),
        requiredStates: ["loading", "empty", "error", "forbidden"]
    };
}
const metricSourcePolicy = { required: true, contracts: [{ id: "metric.scalar", version: 1 }], requiredFields: [] };
const opportunitySourcePolicy = { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: ["name", "stage", "revision"] };
export const salesRevenueMetricComponentDescriptor = uiContribution("sales.metric.total-potential-revenue", "component", "sales.tasks.revenue.read", metricSourcePolicy);
export const salesQuickCreateComponentDescriptor = uiContribution("sales.form.task-quick-create", "component", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: 1 }] });
export const salesOpportunityListComponentDescriptor = uiContribution("sales.list.opportunities", "component", "sales.opportunities.read", opportunitySourcePolicy);
export const salesOpportunityDetailComponentDescriptor = uiContribution("sales.detail.opportunity", "component", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: 1 }] });
export const salesPipelineStatusComponentDescriptor = uiContribution("sales.status.pipeline-stage", "component", "sales.opportunities.stage.read");
export const salesRevenueMetricBlockDescriptor = uiContribution("sales.revenue-metric", "block", "sales.tasks.revenue.read", metricSourcePolicy);
export const salesQuickCreateBlockDescriptor = uiContribution("sales.task-quick-create", "block", "sales.tasks.write", undefined, { required: true, actions: [{ id: salesTaskCreateDescriptor.id, version: 1 }] });
export const salesOpportunityListBlockDescriptor = uiContribution("sales.opportunity-list", "block", "sales.opportunities.read", opportunitySourcePolicy);
export const salesOpportunityDetailBlockDescriptor = uiContribution("sales.opportunity-detail", "block", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: 1 }] });
export const salesOpportunityKanbanBlockDescriptor = uiContribution("sales.opportunity-kanban", "block", "sales.opportunities.read", opportunitySourcePolicy, { required: false, actions: [{ id: salesOpportunityStageUpdateDescriptor.id, version: 1 }] });
export const salesSettingsSummaryBlockDescriptor = uiContribution("sales.settings-summary", "block", "sales.settings.read");
export const salesUiComponentDescriptors = Object.freeze([
    salesTaskTableComponentDescriptor, salesRevenueMetricComponentDescriptor, salesQuickCreateComponentDescriptor,
    salesOpportunityListComponentDescriptor, salesOpportunityDetailComponentDescriptor, salesPipelineStatusComponentDescriptor
]);
export const salesUiBlockDescriptors = Object.freeze([
    salesTaskTableBlockDescriptor, salesRevenueMetricBlockDescriptor, salesQuickCreateBlockDescriptor,
    salesOpportunityListBlockDescriptor, salesOpportunityDetailBlockDescriptor, salesOpportunityKanbanBlockDescriptor, salesSettingsSummaryBlockDescriptor
]);
export const salesEventDescriptors = Object.freeze([
    { id: "sales.event.task-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.tasks" },
    { id: "sales.event.opportunity-changed", version: 1, ownerPluginId: "module.sales", eventClass: "durable-integration", sourceId: "sales.opportunities" }
]);
export const salesRealtimeTopicDescriptors = Object.freeze([
    { id: "sales.realtime.tasks", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.task-changed", sourceId: "sales.tasks", permission: "sales.tasks.read" },
    { id: "sales.realtime.opportunities", version: 1, ownerPluginId: "module.sales", eventId: "sales.event.opportunity-changed", sourceId: "sales.opportunities", permission: "sales.opportunities.read" }
]);
export const salesReferenceMetadata = Object.freeze({
    migration: { id: "sales.migration.initial", version: 2, ownerPluginId: "module.sales", predecessorRevisions: [1] },
    service: { id: "sales.service.domain", version: 1, ownerPluginId: "module.sales" },
    job: { id: "sales.job.pipeline-audit", version: 1, ownerPluginId: "module.sales", timeoutMs: 5_000, maxConcurrency: 1, idempotent: true },
    localization: {
        id: "sales.localization.en", version: 1, ownerPluginId: "module.sales", locale: "en",
        messages: {
            "sales.message.overview": "Overview", "sales.message.tasks": "Tasks",
            "sales.message.opportunities": "Opportunities", "sales.message.settings": "Settings",
            "sales.message.navigation-overview": "Overview", "sales.message.navigation-tasks": "Tasks",
            "sales.message.navigation-opportunities": "Opportunities", "sales.message.navigation-settings": "Settings"
        }
    },
    health: { id: "sales.health.runtime", version: 1, ownerPluginId: "module.sales", safe: true },
    lifecycle: { id: "sales.lifecycle.reference", version: 1, ownerPluginId: "module.sales", disable: "supported", reenable: "supported", purge: "supported" },
    testing: { id: "sales.testing.conformance", version: 1, ownerPluginId: "module.sales", conformancePluginId: "module.sales" }
});
//# sourceMappingURL=contracts.js.map