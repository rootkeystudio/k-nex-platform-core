import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@k-nex/contracts";
import { createOutboxRealtimeRelay, writeTransactionalOutboxEvent } from "@k-nex/payload-adapter";
import { DataSourceGatewayError, definePluginRegistration, resolvePluginSettings } from "@k-nex/runtime";
import { salesCreateTaskToolDescriptor, salesCreateTaskInputRuntimeSchema, salesCreateTaskOutputRuntimeSchema, salesEmptyInputRuntimeSchema, salesEventDescriptors, salesNavigationDescriptors, salesOpportunitiesDescriptor, salesOpportunitiesOutputRuntimeSchema, salesOpportunityStageInputRuntimeSchema, salesOpportunityStageOutputRuntimeSchema, salesOpportunityStageUpdateDescriptor, salesPageTemplates, salesPermissionDescriptors, salesRealtimeTopicDescriptors, salesReferenceMetadata, salesRouteDescriptors, salesSearchTasksDescriptor, salesTaskCreateDescriptor, salesTaskFields, salesTaskUpdateDescriptor, salesTasksDescriptor, salesTasksOutputRuntimeSchema, salesTotalPotentialRevenueDescriptor, salesTotalPotentialRevenueOutputRuntimeSchema, salesUiBlockDescriptors, salesUiComponentDescriptors, salesUpdateTaskInputRuntimeSchema, salesUpdateTaskOutputRuntimeSchema, salesWorkspaceSettingsDescriptor } from "./contracts.js";
import { salesUiBlockDefinitions, salesUiComponentDefinitions } from "./ui.js";
export { salesCreateTaskToolDescriptor, salesNavigationDescriptors, salesPermissionDescriptors, salesRouteDescriptors, salesSearchTasksDescriptor, salesTaskCreateDescriptor, salesTaskPageTemplate, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor, salesWorkspaceSettingsDescriptor } from "./contracts.js";
const salesTaskFieldStorage = {
    title: "title",
    status: "status",
    "potential-revenue": "potentialRevenue",
    "private-note": "privateNote"
};
const salesTaskFieldIds = new Set(Object.keys(salesTaskFieldStorage));
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function eventContext(type, idempotencyKey) {
    return Object.freeze({ kNexSalesEvent: Object.freeze({ eventId: idempotencyKey ?? randomUUID(), type }) });
}
function applicationId(request) {
    const custom = request.payload.config.custom;
    if (typeof custom?.kNexApplicationId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(custom.kNexApplicationId)) {
        throw new Error("Sales durable events require a canonical application ID.");
    }
    return custom.kNexApplicationId;
}
export const salesEventAfterChange = async ({ context, doc, operation, req }) => {
    const event = context.kNexSalesEvent;
    if (event === undefined)
        return doc;
    const occurredAt = new Date().toISOString();
    const retentionUntil = new Date(Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const actorId = req.user?.id;
    await writeTransactionalOutboxEvent({
        req,
        event: {
            id: event.eventId,
            type: event.type,
            schemaVersion: 1,
            messageClass: "durable-integration",
            occurredAt,
            applicationId: applicationId(req),
            pluginId: "module.sales",
            ...(actorId === undefined || actorId === null ? {} : { actor: { id: String(actorId), type: "user" } }),
            correlationId: req.headers.get("x-correlation-id") ?? event.eventId,
            idempotencyKey: event.eventId,
            payload: { resourceId: String(doc.id), operation }
        },
        retentionUntil
    });
    return doc;
};
export function createSalesRealtimeRelay(gateway) {
    return createOutboxRealtimeRelay({
        gateway,
        project(event) {
            if (event.pluginId !== "module.sales")
                return null;
            const topicId = event.type === "sales.event.task-changed" ? "sales.realtime.tasks"
                : event.type === "sales.event.opportunity-changed" ? "sales.realtime.opportunities" : undefined;
            if (topicId === undefined)
                return null;
            return { topicId, params: {}, message: { sourceId: topicId === "sales.realtime.tasks" ? "sales.tasks" : "sales.opportunities", ...event.payload } };
        }
    });
}
export function salesPipelineAuditJob(input) {
    if (input.signal.aborted)
        throw input.signal.reason;
    if (!Array.isArray(input.opportunities) || input.opportunities.length > 1_000)
        throw new Error("Sales pipeline audit input exceeds its bounded contract.");
    const stageCounts = { lead: 0, qualified: 0, won: 0, lost: 0 };
    for (const opportunity of input.opportunities) {
        if (!Object.hasOwn(stageCounts, opportunity.stage))
            throw new Error("Sales pipeline audit received an invalid stage.");
        const stage = opportunity.stage;
        stageCounts[stage] += 1;
    }
    return Object.freeze({ pluginId: "module.sales", jobId: "sales.job.pipeline-audit", stageCounts: Object.freeze(stageCounts) });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function salesRequest(value) {
    if (!isRecord(value) || !isRecord(value.payload) || typeof value.payload.find !== "function") {
        throw new Error("The Sales source requires a capability-scoped Payload request.");
    }
    return value;
}
function scopeWhere(value, expectedKind = "sales.tasks") {
    if (value === undefined || value === null)
        return undefined;
    if (!isRecord(value) || value.kind !== expectedKind)
        throw new Error("The Sales source received an invalid record scope.");
    return value.where;
}
function payloadUser(actor) {
    if (!isRecord(actor) || !isRecord(actor.effectiveActor))
        return undefined;
    const effectiveActor = actor.effectiveActor;
    return effectiveActor.kind === "user" && typeof effectiveActor.id === "string"
        ? { id: effectiveActor.id, collection: "users" }
        : undefined;
}
function requestOptions(context, options) {
    const request = salesRequest(context.request);
    const base = {
        collection: "sales-tasks",
        depth: 0,
        overrideAccess: true,
        pagination: true,
        ...options
    };
    const user = payloadUser(context.actor);
    return {
        ...base,
        ...(user === undefined ? {} : { user }),
        ...(request.locale === undefined ? {} : { locale: request.locale }),
        ...(request.locale === undefined && request.transactionID === undefined
            ? {}
            : {
                req: {
                    ...(request.locale === undefined ? {} : { locale: request.locale }),
                    ...(request.transactionID === undefined ? {} : { transactionID: request.transactionID })
                }
            })
    };
}
function selectedStorageFields(selectedFields) {
    const select = { id: true };
    const seen = new Set();
    for (const fieldId of selectedFields) {
        if (!salesTaskFieldIds.has(fieldId) || seen.has(fieldId))
            throw new Error("The Sales source received an invalid field selection.");
        seen.add(fieldId);
        select[salesTaskFieldStorage[fieldId]] = true;
    }
    return select;
}
function whereClause(field, operator, value) {
    const payloadOperator = {
        eq: "equals",
        in: "in",
        contains: "contains",
        gt: "greater_than",
        gte: "greater_than_or_equal",
        lt: "less_than",
        lte: "less_than_or_equal"
    };
    const mapped = payloadOperator[operator];
    if (mapped === undefined)
        throw new Error("The Sales source received an unsupported filter operator.");
    return { [field]: { [mapped]: value } };
}
function taskWhere(context, controls) {
    const clauses = [];
    const scoped = scopeWhere(context.recordScope);
    if (scoped !== undefined)
        clauses.push(scoped);
    for (const filter of controls.filters) {
        const storageField = salesTaskFieldStorage[filter.field];
        const field = salesTaskFields?.find((candidate) => candidate.id === filter.field);
        if (storageField === undefined || field === undefined || !field.filterOperators.includes(filter.operator)) {
            throw new Error("The Sales source received an unknown or disallowed filter.");
        }
        clauses.push(whereClause(storageField, filter.operator, filter.value));
    }
    if (clauses.length === 0)
        return undefined;
    return clauses.length === 1 ? clauses[0] : { and: clauses };
}
function taskSort(controls) {
    if (controls.sort.length === 0)
        return ["id"];
    return [...controls.sort.map((sort) => {
            const storageField = salesTaskFieldStorage[sort.field];
            const field = salesTaskFields?.find((candidate) => candidate.id === sort.field);
            if (storageField === undefined || field === undefined || !field.sortable)
                throw new Error("The Sales source received an unsupported sort field.");
            return sort.direction === "desc" ? `-${storageField}` : storageField;
        }), "id"];
}
function parseAmount(value) {
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (typeof text !== "string" || !decimalPattern.test(text))
        throw new Error("Sales revenue values must be canonical decimals.");
    const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
    if (fraction.length > 18)
        throw new Error("Sales revenue scale is too large.");
    const units = BigInt(`${whole}${fraction}`) * (text.startsWith("-") ? -1n : 1n);
    return { units, scale: fraction.length };
}
function addAmounts(left, right) {
    const scale = Math.max(left.scale, right.scale);
    return {
        units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale),
        scale
    };
}
function formatAmount(amount) {
    if (amount.units === 0n)
        return "0";
    const negative = amount.units < 0n;
    const digits = (negative ? -amount.units : amount.units).toString().padStart(amount.scale + 1, "0");
    if (amount.scale === 0)
        return `${negative ? "-" : ""}${digits}`;
    const integer = digits.slice(0, -amount.scale);
    const fraction = digits.slice(-amount.scale).replace(/0+$/, "");
    return `${negative ? "-" : ""}${integer}${fraction.length === 0 ? "" : `.${fraction}`}`;
}
function moneyCell(value) {
    if (value === null || value === undefined)
        return null;
    const amount = parseAmount(value);
    return { kind: "money", value: formatAmount(amount), currency: "USD", scale: amount.scale };
}
function taskCell(fieldId, document) {
    const storageField = salesTaskFieldStorage[fieldId];
    const value = document[storageField];
    if (fieldId === "potential-revenue")
        return moneyCell(value);
    if (fieldId === "private-note") {
        if (value === null || value === undefined)
            return null;
        if (typeof value !== "string" || value.length === 0)
            throw new Error("Sales private notes must be non-empty text.");
        return { kind: "text", value };
    }
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Sales task ${fieldId} is missing or invalid.`);
    return { kind: fieldId === "title" ? "text" : "status", value };
}
async function findTasks(context, options) {
    if (context.signal.aborted)
        throw context.signal.reason;
    return salesRequest(context.request).payload.find(requestOptions(context, options));
}
function salesTaskContinuationKey(query) {
    if (query.cursor === undefined)
        throw new Error("Sales task cursor query is missing.");
    return createHash("sha256").update(canonicalJson({
        source: { id: "sales.tasks", version: 1 },
        filters: query.filters,
        sort: query.sort,
        size: query.cursor.size
    })).digest("hex");
}
function salesTaskCursor(page, continuationKey) {
    return Buffer.from(`sales.tasks@1:${continuationKey}:${page}`).toString("base64url");
}
function salesTaskCursorPage(after, continuationKey) {
    if (after === undefined)
        return 1;
    let value;
    try {
        value = Buffer.from(after, "base64url").toString("utf8");
    }
    catch {
        throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
    }
    const match = /^sales\.tasks@1:([0-9a-f]{64}):([1-9][0-9]*)$/u.exec(value);
    if (match === null || match[1] !== continuationKey)
        throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
    const page = Number(match[2]);
    if (!Number.isSafeInteger(page) || page > 1_000_000)
        throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
    return page;
}
async function totalPotentialRevenue(context) {
    const documents = [];
    let page = 1;
    let hasNext = true;
    while (hasNext) {
        if (context.signal.aborted)
            throw context.signal.reason;
        const result = await findTasks(context, {
            page,
            limit: 100,
            select: { id: true, potentialRevenue: true },
            sort: ["id"],
            where: scopeWhere(context.recordScope)
        });
        documents.push(...result.docs);
        if (documents.length > 10_000)
            throw new Error("Sales revenue aggregation exceeded its bounded row limit.");
        hasNext = result.hasNextPage ?? (result.totalPages !== undefined && page < result.totalPages);
        page += 1;
    }
    let total = { units: 0n, scale: 0 };
    for (const document of documents) {
        if (document.potentialRevenue !== null && document.potentialRevenue !== undefined)
            total = addAmounts(total, parseAmount(document.potentialRevenue));
    }
    return { value: { kind: "money", value: formatAmount(total), currency: "USD", scale: total.scale } };
}
async function tasksTable(context) {
    if (context.query.page === undefined && context.query.cursor === undefined)
        throw new Error("Sales task table requires server pagination.");
    if (context.query.cursor?.before !== undefined)
        throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
    const continuationKey = context.query.cursor === undefined ? undefined : salesTaskContinuationKey(context.query);
    const page = context.query.page?.number ?? salesTaskCursorPage(context.query.cursor?.after, continuationKey);
    const pageSize = context.query.page?.size ?? context.query.cursor.size;
    const selectedFields = [...context.selectedFields];
    const result = await findTasks(context, {
        page,
        limit: pageSize,
        select: selectedStorageFields(selectedFields),
        sort: taskSort(context.query),
        where: taskWhere(context, context.query)
    });
    const rows = result.docs.map((document) => {
        if (document.id === undefined || document.id === null || String(document.id).length === 0)
            throw new Error("Sales task rows require stable IDs.");
        return {
            key: String(document.id),
            values: Object.fromEntries(selectedFields.map((fieldId) => [fieldId, taskCell(fieldId, document)]))
        };
    });
    const hasNext = result.hasNextPage ?? (result.totalPages !== undefined && page < result.totalPages);
    return {
        fields: selectedFields,
        rows,
        page: {
            number: page,
            pageSize,
            hasNext,
            ...(continuationKey !== undefined && hasNext ? { nextCursor: salesTaskCursor(page + 1, continuationKey) } : {})
        }
    };
}
const opportunityStorage = { name: "name", stage: "stage", value: "value" };
function opportunityCell(fieldId, document) {
    const value = document[opportunityStorage[fieldId]];
    if (fieldId === "value")
        return moneyCell(value);
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Sales opportunity ${fieldId} is invalid.`);
    return { kind: fieldId === "stage" ? "status" : "text", value };
}
async function opportunitiesTable(context) {
    if (context.query.page === undefined || context.query.filters.length > 0 || context.query.sort.length > 0) {
        throw new Error("Sales opportunities require bounded unfiltered pagination.");
    }
    const selected = [...context.selectedFields];
    if (new Set(selected).size !== selected.length || selected.some((field) => !(field in opportunityStorage))) {
        throw new Error("Sales opportunity field selection is invalid.");
    }
    const base = requestOptions(context, {
        page: context.query.page.number,
        limit: context.query.page.size,
        select: { id: true, ...Object.fromEntries(selected.map((field) => [opportunityStorage[field], true])) },
        sort: ["id"],
        where: scopeWhere(context.recordScope, "sales.opportunities")
    });
    const result = await salesRequest(context.request).payload.find({ ...base, collection: "sales-opportunities" });
    const documents = result.docs;
    return {
        fields: selected,
        rows: documents.map((document) => {
            if (document.id === undefined || document.id === null)
                throw new Error("Sales opportunity rows require stable IDs.");
            return { key: String(document.id), values: Object.fromEntries(selected.map((field) => [field, opportunityCell(field, document)])) };
        }),
        page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: result.hasNextPage ?? false }
    };
}
function invalidOutput(message) {
    return { success: false, error: new Error(message) };
}
export const salesTotalPotentialRevenueDefinition = {
    descriptor: salesTotalPotentialRevenueDescriptor,
    inputSchema: salesEmptyInputRuntimeSchema,
    outputSchema: salesTotalPotentialRevenueOutputRuntimeSchema
};
export const salesTasksDefinition = {
    descriptor: salesTasksDescriptor,
    inputSchema: salesEmptyInputRuntimeSchema,
    outputSchema: salesTasksOutputRuntimeSchema
};
export const salesOpportunitiesDefinition = {
    descriptor: salesOpportunitiesDescriptor,
    inputSchema: salesEmptyInputRuntimeSchema,
    outputSchema: salesOpportunitiesOutputRuntimeSchema
};
export const salesTotalPotentialRevenueHandler = totalPotentialRevenue;
export const salesTasksHandler = tasksTable;
export const salesOpportunitiesHandler = opportunitiesTable;
export const salesTaskCreateDefinition = {
    descriptor: salesTaskCreateDescriptor,
    inputSchema: salesCreateTaskInputRuntimeSchema,
    outputSchema: salesCreateTaskOutputRuntimeSchema
};
export const salesTaskUpdateDefinition = {
    descriptor: salesTaskUpdateDescriptor,
    inputSchema: salesUpdateTaskInputRuntimeSchema,
    outputSchema: salesUpdateTaskOutputRuntimeSchema
};
export const salesOpportunityStageUpdateDefinition = {
    descriptor: salesOpportunityStageUpdateDescriptor,
    inputSchema: salesOpportunityStageInputRuntimeSchema,
    outputSchema: salesOpportunityStageOutputRuntimeSchema
};
function createTaskRequest(value) {
    const request = salesRequest(value);
    if (typeof request.payload.create !== "function")
        throw new Error("The Sales action requires a capability-scoped Payload request.");
    return request;
}
function updateRequest(value) {
    const request = salesRequest(value);
    if (typeof request.payload.update !== "function")
        throw new Error("The Sales action requires a capability-scoped Payload update request.");
    return request;
}
export const salesTaskCreateHandler = async ({ actor, request, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const parsed = salesCreateTaskInputRuntimeSchema.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const payloadRequest = createTaskRequest(request);
    const user = payloadUser(actor);
    const created = await payloadRequest.payload.create({
        collection: "sales-tasks",
        data: parsed.data,
        depth: 0,
        overrideAccess: true,
        ...(user === undefined ? {} : { user }),
        req: payloadRequest,
        context: eventContext("sales.event.task-changed", idempotencyKey)
    });
    if (signal.aborted)
        throw signal.reason;
    if (created.id === undefined || created.id === null || typeof created.title !== "string" ||
        created.title.length < 1 || created.title.length > 256 ||
        created.status !== "open" && created.status !== "done") {
        throw new Error("Sales task creation returned an invalid task.");
    }
    return { id: String(created.id), title: created.title, status: created.status };
};
export const salesTaskUpdateHandler = async ({ actor, request, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const parsed = salesUpdateTaskInputRuntimeSchema.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const payloadRequest = updateRequest(request);
    const user = payloadUser(actor);
    const updated = await payloadRequest.payload.update({
        collection: "sales-tasks", id: parsed.data.id,
        data: { ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }), ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }) },
        depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest,
        context: eventContext("sales.event.task-changed", idempotencyKey)
    });
    const result = { id: String(updated.id), title: updated.title, status: updated.status };
    const validated = salesUpdateTaskOutputRuntimeSchema.safeParse(result);
    if (!validated.success)
        throw validated.error;
    return validated.data;
};
export const salesOpportunityStageUpdateHandler = async ({ actor, request, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const parsed = salesOpportunityStageInputRuntimeSchema.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const payloadRequest = updateRequest(request);
    const user = payloadUser(actor);
    const updated = await payloadRequest.payload.update({
        collection: "sales-opportunities", id: parsed.data.id, data: { stage: parsed.data.stage }, depth: 0, overrideAccess: true,
        ...(user === undefined ? {} : { user }), req: payloadRequest,
        context: eventContext("sales.event.opportunity-changed", idempotencyKey)
    });
    const result = { id: String(updated.id), name: updated.name, stage: updated.stage };
    const validated = salesOpportunityStageOutputRuntimeSchema.safeParse(result);
    if (!validated.success)
        throw validated.error;
    return validated.data;
};
export const salesTasksCollection = {
    slug: "sales-tasks",
    hooks: { afterChange: [salesEventAfterChange] },
    access: {
        create: () => false,
        delete: () => false,
        read: () => false,
        update: () => false
    },
    fields: [
        { name: "title", type: "text", required: true },
        {
            name: "status",
            type: "select",
            defaultValue: "open",
            options: [
                { label: "Open", value: "open" },
                { label: "Done", value: "done" }
            ],
            required: true
        },
        { name: "potentialRevenue", type: "text", required: false },
        { name: "privateNote", type: "textarea", required: false }
    ],
    indexes: [{ fields: ["status"] }]
};
export const salesOpportunitiesCollection = {
    slug: "sales-opportunities",
    hooks: { afterChange: [salesEventAfterChange] },
    access: {
        create: () => false,
        delete: () => false,
        read: () => false,
        update: () => false
    },
    fields: [
        { name: "name", type: "text", required: true },
        { name: "stage", type: "select", required: true, defaultValue: "lead", options: [
                { label: "Lead", value: "lead" }, { label: "Qualified", value: "qualified" },
                { label: "Won", value: "won" }, { label: "Lost", value: "lost" }
            ] },
        { name: "value", type: "text", required: false }
    ],
    indexes: [{ fields: ["stage"] }]
};
export const salesWorkspaceSettingsDefinition = {
    descriptor: salesWorkspaceSettingsDescriptor,
    migrations: [],
    schema: {
        safeParse(value) {
            if (!isRecord(value) || Object.keys(value).sort().join("\u0000") !== "defaultPage\u0000defaultTaskPageSize\u0000pipelineStages\u0000showPotentialRevenue" ||
                !Number.isSafeInteger(value.defaultTaskPageSize) || Number(value.defaultTaskPageSize) < 1 || Number(value.defaultTaskPageSize) > 100 ||
                typeof value.showPotentialRevenue !== "boolean" || !["overview", "tasks", "opportunities"].includes(value.defaultPage) ||
                !Array.isArray(value.pipelineStages) || value.pipelineStages.join("\u0000") !== "lead\u0000qualified\u0000won\u0000lost") {
                return invalidOutput("Sales workspace settings must match the strict current schema.");
            }
            return { success: true, data: value };
        }
    }
};
export const salesDefaultSettings = resolvePluginSettings(salesWorkspaceSettingsDefinition);
export const salesRegistration = definePluginRegistration({
    pluginId: "module.sales",
    contracts: (context) => {
        for (const descriptor of salesPermissionDescriptors)
            context.register("permissions", descriptor.id, descriptor);
        context.register("settings", salesWorkspaceSettingsDescriptor.id, salesWorkspaceSettingsDescriptor);
        context.register("sources", salesTotalPotentialRevenueDescriptor.id, salesTotalPotentialRevenueDefinition);
        context.register("sources", salesTasksDescriptor.id, salesTasksDefinition);
        context.register("sources", salesOpportunitiesDescriptor.id, salesOpportunitiesDefinition);
        context.register("actions", salesTaskCreateDescriptor.id, salesTaskCreateDefinition);
        context.register("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateDefinition);
        context.register("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateDefinition);
        context.register("tools", salesSearchTasksDescriptor.id, salesSearchTasksDescriptor);
        context.register("tools", salesCreateTaskToolDescriptor.id, salesCreateTaskToolDescriptor);
        for (const descriptor of salesEventDescriptors)
            context.register("events", descriptor.id, descriptor);
        for (const descriptor of salesRealtimeTopicDescriptors)
            context.register("realtimeTopics", descriptor.id, descriptor);
    },
    schema: (context) => {
        context.register("schema", "sales.tasks.collection", { type: "payload.collection", collection: salesTasksCollection });
        context.register("schema", "sales.opportunities.collection", { type: "payload.collection", collection: salesOpportunitiesCollection });
        context.register("migrations", salesReferenceMetadata.migration.id, salesReferenceMetadata.migration);
    },
    behavior: (context) => {
        context.register("services", salesReferenceMetadata.service.id, salesReferenceMetadata.service);
        context.register("lifecycle", salesReferenceMetadata.lifecycle.id, salesReferenceMetadata.lifecycle);
    },
    jobs: (context) => {
        context.register("jobs", salesReferenceMetadata.job.id, salesReferenceMetadata.job);
        context.bind(salesReferenceMetadata.job.id, salesPipelineAuditJob);
    },
    dataHandlers: (context) => {
        context.bind("sources", salesTotalPotentialRevenueDescriptor.id, salesTotalPotentialRevenueHandler);
        context.bind("sources", salesTasksDescriptor.id, salesTasksHandler);
        context.bind("actions", salesTaskCreateDescriptor.id, salesTaskCreateHandler);
        context.bind("sources", salesOpportunitiesDescriptor.id, salesOpportunitiesHandler);
        context.bind("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateHandler);
        context.bind("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateHandler);
        for (const descriptor of salesEventDescriptors)
            context.bind("events", descriptor.id, salesEventAfterChange);
        for (const descriptor of salesRealtimeTopicDescriptors)
            context.bind("realtimeTopics", descriptor.id, createSalesRealtimeRelay);
    },
    ui: (context) => {
        for (const descriptor of salesUiComponentDescriptors)
            context.register("components", descriptor.id, descriptor);
        for (const descriptor of salesUiBlockDescriptors)
            context.register("blocks", descriptor.id, descriptor);
        for (const descriptor of salesRouteDescriptors)
            context.register("routes", descriptor.id, descriptor);
        for (const descriptor of salesNavigationDescriptors)
            context.register("navigation", descriptor.id, descriptor);
        for (const descriptor of salesPageTemplates)
            context.register("pageTemplates", descriptor.id, descriptor);
        for (const definition of salesUiComponentDefinitions)
            context.bindRenderer("components", definition.id, definition.render);
        for (const definition of salesUiBlockDefinitions)
            context.bindRenderer("blocks", definition.id, definition.render);
        context.register("localization", salesReferenceMetadata.localization.id, salesReferenceMetadata.localization);
    },
    validate: (context) => {
        context.register("healthAudit", salesReferenceMetadata.health.id, salesReferenceMetadata.health);
        context.register("testingMetadata", salesReferenceMetadata.testing.id, salesReferenceMetadata.testing);
    }
});
//# sourceMappingURL=server.js.map