import { createHash } from "node:crypto";
import { canonicalJson, dataSourceReportExecutionDigestInput, DataSourceReportExecutionSchema, iso4217CurrencyScale, isIso4217CurrencyCode, TableRecordsSchema } from "@k-nex/contracts";
import { createOutboxRealtimeRelay, writeTransactionalOutboxEvent } from "@k-nex/payload-adapter";
import { ActionGatewayError, DataSourceGatewayError, definePluginRegistration, projectSystemSettingsValues } from "@k-nex/runtime";
import { salesAccountsCollection, salesActivitiesCollection, salesAttachmentReferencesCollection, salesContactsCollection, salesLeadsCollection, salesNotesCollection, salesOpportunitiesCollection as salesOpportunitiesCoreCollection, salesPipelinesCollection, salesPipelineStagesCollection, salesSavedViewsCollection, salesImportJobsCollection, salesImportRowsCollection, salesImportChunksCollection, salesExportJobsCollection, salesMergeLineageCollection, salesNotificationsCollection, salesRemindersCollection, salesCoreCollectionSlugs, salesRelatedRecordTypes, salesTasksCollection as salesTasksCoreCollection } from "./crm-core.js";
import { isSalesCalendarDate, salesPhoneMaxLength } from "./crm-authority.js";
import { salesAccountDetailDescriptor, salesAccountDetailOutputRuntimeSchema, salesAccountFields, salesAccountsDescriptor, salesAccountsOutputRuntimeSchema, salesContactDetailDescriptor, salesContactDetailOutputRuntimeSchema, salesContactFields, salesContactsDescriptor, salesContactsOutputRuntimeSchema, salesCreateTaskToolDescriptor, salesCreateTaskInputRuntimeSchema, salesCreateTaskOutputRuntimeSchema, salesCrmDetailInputRuntimeSchema, salesEmptyInputRuntimeSchema, salesEventDescriptors, salesLeadDetailDescriptor, salesLeadDetailFields, salesLeadDetailOutputRuntimeSchema, salesLeadFields, salesLeadsDescriptor, salesLeadsOutputRuntimeSchema, salesNavigationDescriptors, salesOwnershipAssignDescriptor, salesOpportunitiesDescriptor, salesOpportunitiesOutputRuntimeSchema, salesOpportunityStageInputRuntimeSchema, salesOpportunityStageOutputRuntimeSchema, salesOpportunityStageUpdateDescriptor, salesOpportunityDetailDescriptor, salesOpportunityDetailFields, salesOpportunityDetailOutputRuntimeSchema, salesOpportunityFields, salesPageTemplates, salesRealtimeTopicDescriptors, salesReferenceMetadata, isSalesRecordId, isSalesBoundedNfcText, salesRouteDescriptors, salesSearchTasksDescriptor, salesTaskCreateDescriptor, salesTaskFields, salesTaskUpdateDescriptor, salesTasksDescriptor, salesTasksOutputRuntimeSchema, salesTimelineDescriptor, salesTimelineFields, salesTimelineInputRuntimeSchema, salesTimelineOutputRuntimeSchema, salesUiBlockDescriptors, salesUiComponentDescriptors, salesUpdateTaskInputRuntimeSchema, salesUpdateTaskOutputRuntimeSchema, salesWorkspaceSettingsDescriptor, canonicalSalesCalendarRange, canonicalSalesSavedViewJson, compileSalesSavedViewDefinition, parseSalesSavedViewBindingInput, salesPipelineSnapshotDescriptor, salesPipelineSnapshotFields, salesSavedViewCalendarDescriptor, salesSavedViewCalendarFields, salesSavedViewDetailDescriptor, salesSavedViewDetailFields, salesSavedViewKanbanDescriptor, salesSavedViewKanbanFields, salesSavedViewListDescriptor, salesSavedViewListFields, salesSavedViewTableDescriptor, salesSavedViewTableFields, salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor, salesImportJobListDescriptor, salesImportJobDetailDescriptor, salesExportJobListDescriptor, salesExportJobDetailDescriptor, salesDedupeCandidatesDescriptor, salesImportJobListOutputRuntimeSchema, salesImportJobDetailOutputRuntimeSchema, salesExportJobListOutputRuntimeSchema, salesExportJobDetailOutputRuntimeSchema, salesDedupeCandidatesOutputRuntimeSchema, salesImportJobDetailInputRuntimeSchema, salesExportJobDetailInputRuntimeSchema, salesDedupeCandidatesInputRuntimeSchema, salesNotificationsDescriptor, salesNotificationFields, salesNotificationsOutputRuntimeSchema, salesRemindersDescriptor, salesReminderFields, salesRemindersOutputRuntimeSchema, salesProviderConfigurationFields, salesProviderConfigurationsDescriptor, salesProviderConfigurationsOutputRuntimeSchema, salesReportDescriptors, salesPipelineValueByStageDescriptor, salesPipelineValueByStageOutputRuntimeSchema, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesActivityByOwnerTeamDescriptor, salesActivityByOwnerTeamOutputRuntimeSchema, salesTaskAgingDescriptor, salesTaskAgingOutputRuntimeSchema, salesSalesCycleDurationDescriptor, salesMetricOutputRuntimeSchema, salesMetricOutputRuntimeV2Schema, salesReportRunDescriptor, salesReportScheduleDescriptor, salesReportActionDescriptors, salesReportActionInputRuntimeSchemas, salesReportActionOutputRuntimeSchemas, salesCommunicationActionDescriptors, salesCommunicationActionInputRuntimeSchemas, salesCommunicationActionOutputRuntimeSchemas, salesImportDryRunDescriptor, salesImportCommitDescriptor, salesImportCancelDescriptor, salesExportCreateDescriptor, salesExportCancelDescriptor, salesMergeCommitDescriptor, salesDataMovementActionInputRuntimeSchemas, salesDataMovementActionOutputRuntimeSchemas, salesWorkflowActionInputRuntimeSchemas, salesWorkflowActionOutputRuntimeSchemas, validateSalesPipelineSnapshotInput } from "./contracts.js";
import { salesCrmActionDescriptors, salesCrmPermissionDescriptors, salesCrmPermissionPolicyBindings, salesCrmRoleTemplates, salesCrmRouteDescriptors } from "./crm-authority.js";
import { salesUiBlockDefinitions, salesUiComponentDefinitions } from "./ui.js";
export const salesDataMovementErrorCodes = Object.freeze([
    "IMPORT_INVALID_ENCODING", "IMPORT_INVALID_CSV", "IMPORT_UNSAFE_FORMULA", "IMPORT_LIMIT_EXCEEDED", "IMPORT_PROTECTED_FIELD", "IMPORT_MAPPING_INVALID", "IMPORT_UPLOAD_BINDING_INVALID",
    "IMPORT_REQUIRED_VALUE", "IMPORT_VALUE_INVALID", "IMPORT_CONTACT_ACCOUNT_FORBIDDEN", "IMPORT_ROW_CONFLICT", "IMPORT_WORKER_RETRY_EXHAUSTED", "DEDUPE_CANDIDATE_LIMIT", "STALE_RECORD", "ACTION_FORBIDDEN", "NOT_FOUND", "ARTIFACT_EXPIRED", "ARTIFACT_FORBIDDEN", "IDEMPOTENCY_CONFLICT"
]);
export class SalesDataMovementError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "SalesDataMovementError";
    }
}
export const salesDedupeNormalizerVersion = "node24.19-unicode17-v1";
const movementWhitespace = /^[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*/u;
const movementWhitespaceTrailing = /[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
const movementWhitespaceRun = /[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const movementTargets = Object.freeze({
    "sales.object.lead": Object.freeze({ required: ["displayName", "source"], fields: ["displayName", "source", "email", "phone"] }),
    "sales.object.account": Object.freeze({ required: ["name"], fields: ["name"] }),
    "sales.object.contact": Object.freeze({ required: ["displayName", "accountId"], fields: ["displayName", "accountId", "email", "phone"] })
});
const protectedImportFields = new Set(["ownerId", "teamId", "applicationId", "environment", "createdBy", "updatedBy", "audit", "revision", "status", "archiveStatus", "mergedIntoId", "mergeLineage"]);
/** The data-movement worker reuses the registered object invalidations; it never invents a parallel event class. */
export function salesDataMovementObjectEvent(targetObjectType) {
    return targetObjectType === "sales.object.account" ? "sales.event.account-changed" : targetObjectType === "sales.object.contact" ? "sales.event.contact-changed" : "sales.event.lead-changed";
}
export const salesDataMovementJobTransitions = Object.freeze({
    import: Object.freeze([
        Object.freeze({ actionId: "sales.import.commit", fromState: "queued", toState: "running" }),
        Object.freeze({ actionId: "sales.import.commit", fromState: "running", toState: "succeeded" }),
        Object.freeze({ actionId: "sales.import.commit", fromState: "running", toState: "partially-failed" }),
        Object.freeze({ actionId: "sales.import.commit", fromState: "running", toState: "failed" }),
        Object.freeze({ actionId: "sales.import.cancel", fromState: "validated", toState: "cancelled" }),
        Object.freeze({ actionId: "sales.import.cancel", fromState: "queued", toState: "cancelled" })
    ]),
    export: Object.freeze([
        Object.freeze({ actionId: "sales.export.create", fromState: "queued", toState: "running" }),
        Object.freeze({ actionId: "sales.export.create", fromState: "running", toState: "succeeded" }),
        Object.freeze({ actionId: "sales.export.create", fromState: "running", toState: "failed" }),
        Object.freeze({ actionId: "sales.export.cancel", fromState: "queued", toState: "cancelled" })
    ])
});
function validJobTransition(input) {
    return salesDataMovementJobTransitions[input.kind].some((transition) => transition.actionId === input.actionId && transition.fromState === input.fromState && transition.toState === input.toState);
}
/** Canonical audit evidence for every persisted job state transition, including queued-to-running. */
export function createSalesDataMovementJobAudit(input) {
    if (!Number.isSafeInteger(input.jobId) || input.jobId < 1 || !validJobTransition(input))
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    dataMovementAuditIdentity({ ...input, resourceId: String(input.jobId) });
    return Object.freeze({ actionId: input.actionId, resourceId: String(input.jobId), applicationId: input.applicationId, environment: input.environment, fromState: input.fromState, toState: input.toState, occurredAt: input.occurredAt, actorId: input.actorId, revision: input.revision, idempotencyKey: input.idempotencyKey, dataMovement: Object.freeze({ kind: input.kind, jobId: input.jobId }) });
}
/** Registered job event payload. Environment stays top-level for the outbox consumer predicate. */
export function createSalesDataMovementJobOutbox(input) {
    if (!Number.isSafeInteger(input.authorizationRevision) || input.authorizationRevision < 1 || !Number.isSafeInteger(input.lifecycleRevision) || input.lifecycleRevision < 0 || !Number.isSafeInteger(input.scopeRevision) || input.scopeRevision < 1)
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    const kind = input.dataMovement.kind;
    const type = kind === "import" ? "sales.event.import-job-changed" : "sales.event.export-job-changed";
    return Object.freeze({ type, payload: Object.freeze({ environment: input.environment, jobId: input.dataMovement.jobId, state: input.toState, revision: input.revision, actionId: input.actionId, targetObjectType: input.targetObjectType, authorizationRevision: input.authorizationRevision, lifecycleRevision: input.lifecycleRevision, scopeRevision: input.scopeRevision }) });
}
function dataMovementAuditIdentity(input) {
    if (!isSalesRecordId(input.resourceId) || !applicationIdPattern.test(input.applicationId) || input.applicationId.length > 128 || !environmentPattern.test(input.environment) || input.environment.length > 64 ||
        !actorIdPattern.test(input.actorId) || input.actorId.length > 160 || !durableIdPattern.test(input.idempotencyKey) || !validAuditTimestamp(input.occurredAt) || !Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 1_000_000_000) {
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    }
}
function dataMovementDigest(value) {
    if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value))
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    return value;
}
function dataMovementOwnership(ownerId, teamId) {
    const ownership = ownershipSnapshot({ ownerId, teamId });
    if (ownership === undefined)
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    return ownership;
}
/** Canonical revision-one audit for records created by a fenced import worker. */
export function createSalesImportGenesisAudit(input) {
    dataMovementAuditIdentity({ ...input, revision: 1 });
    if (!Number.isSafeInteger(input.importJobId) || input.importJobId < 1 || !Number.isSafeInteger(input.oneBasedDataRow) || input.oneBasedDataRow < 1 || input.oneBasedDataRow > 10_000)
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    const toState = input.targetObjectType === "sales.object.lead" ? "new" : "active";
    return Object.freeze({ actionId: "sales.import.commit", resourceId: input.resourceId, applicationId: input.applicationId, environment: input.environment, fromState: "absent", toState,
        occurredAt: input.occurredAt, actorId: input.actorId, revision: 1, idempotencyKey: input.idempotencyKey, ownershipGenesis: dataMovementOwnership(input.ownerId, input.teamId),
        dataMovement: Object.freeze({ kind: "import", importJobId: input.importJobId, oneBasedDataRow: input.oneBasedDataRow, rowDigest: dataMovementDigest(input.rowDigest) }) });
}
/** Canonical survivor/merged audit transition, bound to immutable lineage identity before post-row digests exist. */
export function createSalesMergeAuditTransition(input) {
    if (!Number.isSafeInteger(input.preRevision) || input.preRevision < 1 || input.preRevision >= 1_000_000_000 || typeof input.lineageId !== "string" || input.lineageId.length < 1 || input.lineageId.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(input.lineageId))
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    dataMovementAuditIdentity({ ...input, revision: input.preRevision + 1 });
    return Object.freeze({ actionId: "sales.merge.commit", resourceId: input.resourceId, applicationId: input.applicationId, environment: input.environment, fromState: "active", toState: input.role === "survivor" ? "active" : "merged",
        occurredAt: input.occurredAt, actorId: input.actorId, revision: input.preRevision + 1, idempotencyKey: input.idempotencyKey,
        dataMovement: Object.freeze({ kind: "merge", role: input.role, lineageId: input.lineageId }) });
}
function parseRfc4180(text) {
    const records = [];
    let record = [];
    let cell = "";
    let quoted = false;
    let afterQuote = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"') {
                if (text[index + 1] === '"') {
                    cell += '"';
                    index += 1;
                }
                else {
                    quoted = false;
                    afterQuote = true;
                }
            }
            else
                cell += character;
            continue;
        }
        if (afterQuote && character !== "," && character !== "\r")
            throw new SalesDataMovementError("IMPORT_INVALID_CSV");
        if (character === '"') {
            if (cell !== "" || afterQuote)
                throw new SalesDataMovementError("IMPORT_INVALID_CSV");
            quoted = true;
            continue;
        }
        if (character === ",") {
            record.push(cell);
            cell = "";
            afterQuote = false;
            continue;
        }
        if (character === "\r") {
            if (text[index + 1] !== "\n")
                throw new SalesDataMovementError("IMPORT_INVALID_CSV");
            record.push(cell);
            records.push(record);
            record = [];
            cell = "";
            afterQuote = false;
            index += 1;
            continue;
        }
        if (character === "\n")
            throw new SalesDataMovementError("IMPORT_INVALID_CSV");
        if (afterQuote)
            throw new SalesDataMovementError("IMPORT_INVALID_CSV");
        cell += character;
    }
    if (quoted || record.length !== 0 || cell !== "" || afterQuote)
        throw new SalesDataMovementError("IMPORT_INVALID_CSV");
    return records;
}
/** Strict UTF-8/RFC4180 validation; fatal input never produces a durable job. */
export function parseSalesImportCsv(bytes, target, mapping) {
    if (!(bytes instanceof Uint8Array))
        throw new SalesDataMovementError("IMPORT_LIMIT_EXCEEDED");
    const content = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    if (content.byteLength > 16_777_216)
        throw new SalesDataMovementError("IMPORT_LIMIT_EXCEEDED");
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    }
    catch {
        throw new SalesDataMovementError("IMPORT_INVALID_ENCODING");
    }
    const records = parseRfc4180(text);
    if (records.length < 2 || records.length > 10_001)
        throw new SalesDataMovementError(records.length > 10_001 ? "IMPORT_LIMIT_EXCEEDED" : "IMPORT_INVALID_CSV");
    const headers = records[0].map((value) => value.normalize("NFC"));
    if (headers.length < 1 || headers.length > 64 || new Set(headers).size !== headers.length || headers.some((header) => header.length === 0 || new TextEncoder().encode(header).byteLength > 120))
        throw new SalesDataMovementError(headers.length > 64 ? "IMPORT_LIMIT_EXCEEDED" : "IMPORT_INVALID_CSV");
    if (headers.some((header) => /^[=+\-@]/u.test(header.replace(movementWhitespace, ""))))
        throw new SalesDataMovementError("IMPORT_UNSAFE_FORMULA");
    if (!Array.isArray(mapping) || mapping.length !== headers.length || mapping.some((item) => typeof item !== "object" || item === null || Object.keys(item).sort().join("\0") !== "fieldId\0header" || typeof item.header !== "string" || typeof item.fieldId !== "string" || item.header.normalize("NFC") !== item.header))
        throw new SalesDataMovementError("IMPORT_MAPPING_INVALID");
    const targetSchema = movementTargets[target];
    const mappedHeaders = mapping.map(({ header }) => header);
    const mappedFields = mapping.map(({ fieldId }) => fieldId);
    if (mappedFields.some((field) => protectedImportFields.has(field)))
        throw new SalesDataMovementError("IMPORT_PROTECTED_FIELD");
    if (new Set(mappedHeaders).size !== headers.length || new Set(mappedFields).size !== mappedFields.length || headers.some((header) => !mappedHeaders.includes(header)) || mappedFields.some((field) => !targetSchema.fields.includes(field)) || targetSchema.required.some((field) => !mappedFields.includes(field)))
        throw new SalesDataMovementError("IMPORT_MAPPING_INVALID");
    const diagnostics = [];
    const rows = [];
    for (let rowIndex = 1; rowIndex < records.length; rowIndex += 1) {
        const cells = records[rowIndex];
        if (cells.length !== headers.length)
            throw new SalesDataMovementError("IMPORT_INVALID_CSV");
        if (cells.some((cell) => new TextEncoder().encode(cell).byteLength > 16_384))
            throw new SalesDataMovementError("IMPORT_LIMIT_EXCEEDED");
        if (cells.some((cell) => /^[=+\-@]/u.test(cell.replace(movementWhitespace, ""))))
            throw new SalesDataMovementError("IMPORT_UNSAFE_FORMULA");
        const values = {};
        let rowCode;
        for (const { header, fieldId } of mapping) {
            const value = cells[headers.indexOf(header)].normalize("NFC");
            if (value === "") {
                values[fieldId] = null;
                if (targetSchema.required.includes(fieldId))
                    rowCode = "IMPORT_REQUIRED_VALUE";
                continue;
            }
            const max = fieldId === "email" ? 320 : fieldId === "phone" ? 64 : 120;
            if (fieldId === "accountId") {
                if (!/^[1-9][0-9]{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value)))
                    rowCode = "IMPORT_VALUE_INVALID";
                else
                    values[fieldId] = Number(value);
            }
            else if (new TextEncoder().encode(value).byteLength > max)
                rowCode = "IMPORT_VALUE_INVALID";
            else
                values[fieldId] = value;
        }
        const oneBasedDataRow = rowIndex;
        if (rowCode !== undefined)
            diagnostics.push(Object.freeze({ oneBasedDataRow, code: rowCode }));
        else
            rows.push(Object.freeze({ oneBasedDataRow, values: Object.freeze(values), rowDigest: digest(canonicalJson({ targetObjectType: target, values, oneBasedDataRow })), state: "pending" }));
    }
    const chunks = Array.from({ length: Math.ceil(records.length === 1 ? 0 : (records.length - 1) / 250) }, (_, chunkIndex) => Object.freeze({ chunkIndex, rowStart: chunkIndex * 250, rowEndExclusive: Math.min((chunkIndex + 1) * 250, records.length - 1), state: "queued", attempt: 0, leaseRevision: 1 }));
    return Object.freeze({ headers: Object.freeze(headers), rows: Object.freeze(rows), diagnostics: Object.freeze(diagnostics), chunks: Object.freeze(chunks), uploadDigest: digest(content), diagnosticDigest: digest(canonicalJson(diagnostics)), acceptedRows: rows.length, rejectedRows: diagnostics.length });
}
export function normalizeSalesDedupeValue(kind, value) {
    if (process.versions.node !== "24.19.0" || process.versions.unicode !== "17.0" || process.versions.icu !== "78.3")
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    const normalized = value.normalize("NFC");
    if (kind === "contact-phone") {
        const phone = normalized.replace(/[^0-9]/gu, "");
        return phone.length >= 7 && phone.length <= 15 ? phone : null;
    }
    if (kind === "account-name")
        return normalized.replace(movementWhitespace, "").replace(movementWhitespaceTrailing, "").replace(movementWhitespaceRun, " ").toLowerCase();
    return normalized.replace(movementWhitespace, "").replace(movementWhitespaceTrailing, "").toLowerCase();
}
export function salesDedupeMatch(target, subject, candidate) {
    if (target === "sales.object.account")
        return normalizeSalesDedupeValue("account-name", String(subject.name ?? "")) !== "" && normalizeSalesDedupeValue("account-name", String(subject.name ?? "")) === normalizeSalesDedupeValue("account-name", String(candidate.name ?? "")) ? "account-name" : null;
    const email = typeof subject.email === "string" && typeof candidate.email === "string" && normalizeSalesDedupeValue("contact-email", subject.email) !== "" && normalizeSalesDedupeValue("contact-email", subject.email) === normalizeSalesDedupeValue("contact-email", candidate.email);
    const subjectPhone = typeof subject.phone === "string" ? normalizeSalesDedupeValue("contact-phone", subject.phone) : null;
    const candidatePhone = typeof candidate.phone === "string" ? normalizeSalesDedupeValue("contact-phone", candidate.phone) : null;
    const phone = subjectPhone !== null && subjectPhone === candidatePhone;
    return email && phone ? "contact-email-and-phone" : email ? "contact-email" : phone ? "contact-phone" : null;
}
const csvCell = (value, neutralize) => { let text = value === null || value === undefined ? "" : String(value); if (neutralize && /^[=+\-@]/u.test(text.replace(movementWhitespace, "")))
    text = `'${text}`; return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
export function buildSalesExportCsv(selectedFields, rows) {
    if (selectedFields.length < 1 || selectedFields.length > 8 || new Set(selectedFields).size !== selectedFields.length || rows.length > 10_000)
        throw new SalesDataMovementError("IMPORT_LIMIT_EXCEEDED");
    const header = `${selectedFields.map((field) => csvCell(field, false)).join(",")}\r\n`;
    const output = rows.length === 0 ? header : `${header}${rows.map((row) => selectedFields.map((field) => csvCell(row[field], true)).join(",")).join("\r\n")}\r\n`;
    const bytes = new TextEncoder().encode(output);
    if (bytes.byteLength > 16_777_216)
        throw new SalesDataMovementError("IMPORT_LIMIT_EXCEEDED");
    return bytes;
}
export const salesMergeRelationIds = Object.freeze({
    "sales.object.account": Object.freeze(["sales_contacts.account_id", "sales_opportunities.account_id", "sales_leads.qualified_account_id", "sales_activities.related_record_id where related_record_type=sales.account", "sales_notes.related_record_id where related_record_type=sales.account", "sales_attachment_references.related_record_id where related_record_type=sales.account", "sales_tasks.related_record_id where related_record_type=sales.account"]),
    "sales.object.contact": Object.freeze(["sales_opportunities.primary_contact_id", "sales_leads.qualified_contact_id", "sales_activities.related_record_id where related_record_type=sales.contact", "sales_notes.related_record_id where related_record_type=sales.contact", "sales_attachment_references.related_record_id where related_record_type=sales.contact", "sales_tasks.related_record_id where related_record_type=sales.contact"])
});
export function planSalesMerge(input) {
    const { winner, loser } = input;
    const winnerId = Number(winner.id);
    const loserId = Number(loser.id);
    const winnerRevision = Number(winner.revision);
    const loserRevision = Number(loser.revision);
    if (![winnerId, loserId, winnerRevision, loserRevision, input.winnerExpectedRevision, input.loserExpectedRevision, input.authorizationRevision].every((value) => Number.isSafeInteger(value) && value > 0) || winnerRevision >= Number.MAX_SAFE_INTEGER || loserRevision >= Number.MAX_SAFE_INTEGER || winnerRevision !== input.winnerExpectedRevision || loserRevision !== input.loserExpectedRevision || winnerId === loserId || winner.status !== "active" || loser.status !== "active" || Object.hasOwn(winner, "mergedIntoId") || Object.hasOwn(loser, "mergedIntoId") || typeof winner.applicationId !== "string" || winner.applicationId.length === 0 || typeof winner.environment !== "string" || winner.environment.length === 0 || winner.applicationId !== loser.applicationId || winner.environment !== loser.environment || Object.hasOwn(winner, "targetObjectType") && winner.targetObjectType !== input.targetObjectType || Object.hasOwn(loser, "targetObjectType") && loser.targetObjectType !== input.targetObjectType)
        throw new SalesDataMovementError("STALE_RECORD");
    if (typeof input.actorId !== "string" || input.actorId.length < 1 || input.actorId.length > 160 || typeof input.lineageId !== "string" || input.lineageId.length < 1 || input.lineageId.length > 128 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.committedAt) || new Date(input.committedAt).toISOString() !== input.committedAt)
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    if (input.targetObjectType === "sales.object.contact" && (!Number.isSafeInteger(winner.accountId) || winner.accountId < 1 || winner.accountId !== loser.accountId))
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    const matchKind = salesDedupeMatch(input.targetObjectType, winner, loser);
    if (matchKind === null)
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    const relationIds = salesMergeRelationIds[input.targetObjectType];
    if (canonicalJson(Object.keys(input.relationCounts).sort()) !== canonicalJson([...relationIds].sort()))
        throw new SalesDataMovementError("ACTION_FORBIDDEN");
    const rewrittenRelationCounts = relationIds.map((relationId) => { const count = input.relationCounts[relationId]; if (!Number.isSafeInteger(count) || count < 0)
        throw new SalesDataMovementError("ACTION_FORBIDDEN"); return Object.freeze({ relationId, count: count }); });
    const winnerPost = { ...winner, revision: winnerRevision + 1 };
    const loserPost = { ...loser, revision: loserRevision + 1, status: "merged", mergedIntoId: winnerId };
    const lineage = Object.freeze({ lineageId: input.lineageId, applicationId: winner.applicationId, environment: winner.environment, targetObjectType: input.targetObjectType, winnerId, winnerPreRevision: winnerRevision, winnerPostRevision: winnerRevision + 1, loserId, loserPreRevision: loserRevision, loserPostRevision: loserRevision + 1, matchKind, normalizerVersion: salesDedupeNormalizerVersion, actorId: input.actorId, authorizationRevision: input.authorizationRevision, winnerPreDigest: digest(canonicalJson(winner)), winnerPostDigest: digest(canonicalJson(winnerPost)), loserPreDigest: digest(canonicalJson(loser)), loserPostDigest: digest(canonicalJson(loserPost)), rewrittenRelationCounts, committedAt: input.committedAt });
    return Object.freeze({ winnerPost: Object.freeze(winnerPost), loserPost: Object.freeze(loserPost), lineage, lineageDigest: digest(canonicalJson(lineage)) });
}
function movementStore(value) {
    if (typeof value !== "object" || value === null || !("dataMovement" in value))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales data movement authority is unavailable.");
    return value.dataMovement;
}
const movementActionMethods = Object.freeze({ "sales.import.dry-run": "dryRunImport", "sales.import.commit": "commitImport", "sales.import.cancel": "cancelImport", "sales.export.create": "createExport", "sales.export.cancel": "cancelExport", "sales.merge.commit": "mergeRecords" });
export const salesDataMovementActionHandler = async ({ authorizationContext, input, idempotencyKey, signal }) => {
    const actionId = authorizationContext?.actionId;
    if (actionId === undefined || !(actionId in movementActionMethods) || typeof idempotencyKey !== "string" || idempotencyKey.length === 0)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales data movement action is forbidden.");
    const store = movementStore(authorizationContext);
    const method = movementActionMethods[actionId];
    const output = await store[method]({ input: input, idempotencyKey, signal });
    const parsed = salesDataMovementActionOutputRuntimeSchemas[actionId].safeParse(output);
    if (!parsed.success)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales data movement result is invalid.");
    const result = parsed.data;
    const actionInput = input;
    const bound = actionId === "sales.import.commit" || actionId === "sales.import.cancel" ? result.importJobId === actionInput.importJobId
        : actionId === "sales.export.cancel" ? result.exportJobId === actionInput.exportJobId
            : actionId === "sales.merge.commit" ? result.winnerId === actionInput.winnerId && result.loserId === actionInput.loserId && result.winnerRevision === actionInput.winnerExpectedRevision + 1 && result.loserRevision === actionInput.loserExpectedRevision + 1 && canonicalJson(result.rewrittenRelationCounts.map(({ relationId }) => relationId)) === canonicalJson(salesMergeRelationIds[actionInput.targetObjectType])
                : true;
    if (!bound)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales data movement result does not match its request.");
    return result;
};
const movementActionDescriptors = Object.freeze([salesImportDryRunDescriptor, salesImportCommitDescriptor, salesImportCancelDescriptor, salesExportCreateDescriptor, salesExportCancelDescriptor, salesMergeCommitDescriptor]);
export const salesDataMovementActionDefinitions = Object.freeze(movementActionDescriptors.map((descriptor) => ({ descriptor, inputSchema: salesDataMovementActionInputRuntimeSchemas[descriptor.id], outputSchema: salesDataMovementActionOutputRuntimeSchemas[descriptor.id] })));
function movementSourceHandler(method) {
    return async ({ request, input, query, selectedFields, signal }) => {
        return await movementStore(request)[method]({ input: input, query, selectedFields, signal });
    };
}
export const salesImportJobListHandler = movementSourceHandler("listImportJobs");
export const salesImportJobDetailHandler = movementSourceHandler("getImportJob");
export const salesExportJobListHandler = movementSourceHandler("listExportJobs");
export const salesExportJobDetailHandler = movementSourceHandler("getExportJob");
export const salesDedupeCandidatesHandler = movementSourceHandler("findDedupeCandidates");
export const salesImportJobListDefinition = { descriptor: salesImportJobListDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesImportJobListOutputRuntimeSchema };
export const salesImportJobDetailDefinition = { descriptor: salesImportJobDetailDescriptor, inputSchema: salesImportJobDetailInputRuntimeSchema, outputSchema: salesImportJobDetailOutputRuntimeSchema };
export const salesExportJobListDefinition = { descriptor: salesExportJobListDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesExportJobListOutputRuntimeSchema };
export const salesExportJobDetailDefinition = { descriptor: salesExportJobDetailDescriptor, inputSchema: salesExportJobDetailInputRuntimeSchema, outputSchema: salesExportJobDetailOutputRuntimeSchema };
export const salesDedupeCandidatesDefinition = { descriptor: salesDedupeCandidatesDescriptor, inputSchema: salesDedupeCandidatesInputRuntimeSchema, outputSchema: salesDedupeCandidatesOutputRuntimeSchema };
/** Closed underlying grants prevent reports from treating sales.reports.read as a substitute for CRM object/field authority. */
export const salesReportPermissionGrants = ["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"];
export const salesReportObjectPermissionGrants = ["sales.activities.read", "sales.leads.read", "sales.opportunities.read", "sales.pipelines.read", "sales.tasks.read"];
export const salesReportFieldPermissionGrants = ["sales.opportunities.amount.read"];
function reportingGateway(value, error) {
    const candidate = isRecord(value) && isRecord(value.reporting) ? value.reporting : undefined;
    if (candidate === undefined || typeof candidate.read !== "function" || typeof candidate.run !== "function" || typeof candidate.schedule !== "function") {
        if (error === "source")
            throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales reporting authority is unavailable.");
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting authority is unavailable.");
    }
    return candidate;
}
function sortedClosedGrants(value, allowed) {
    return Array.isArray(value) && value.every((grant) => typeof grant === "string" && allowed.includes(grant)) &&
        canonicalJson([...new Set(value)].sort()) === canonicalJson(value);
}
const reportRequirements = Object.freeze({
    "sales.report.pipeline-value-by-stage": Object.freeze({ objects: ["sales.opportunities.read", "sales.pipelines.read"], fields: ["sales.opportunities.amount.read"], grouping: "stage" }),
    "sales.report.weighted-forecast": Object.freeze({ objects: ["sales.opportunities.read", "sales.pipelines.read"], fields: ["sales.opportunities.amount.read"], grouping: "none" }),
    "sales.report.won-lost-conversion": Object.freeze({ objects: ["sales.opportunities.read", "sales.pipelines.read"], fields: [], grouping: "none" }),
    "sales.report.lead-conversion": Object.freeze({ objects: ["sales.leads.read"], fields: [], grouping: "none" }),
    "sales.report.activity-by-owner-team": Object.freeze({ objects: ["sales.activities.read"], fields: [], grouping: "owner-team" }),
    "sales.report.task-aging": Object.freeze({ objects: ["sales.tasks.read"], fields: [], grouping: "aging-bucket" }),
    "sales.report.sales-cycle-duration": Object.freeze({ objects: ["sales.opportunities.read"], fields: [], grouping: "none" })
});
function reportingAuthority(value, error, reportId, action) {
    const authority = isRecord(value) && isRecord(value.reportingAuthority) ? value.reportingAuthority : undefined;
    if (authority === undefined || !["authorizationRevision", "lifecycleRevision", "salesScopeRevision", "settingsRevision", "reportingTimezone", "reportingCurrency", "runtimeGenerationId", "reportPermissionGrants", "objectPermissionGrants", "fieldPermissionGrants"].every((key) => Object.hasOwn(authority, key)) || Object.keys(authority).length !== 10 ||
        typeof authority.authorizationRevision !== "number" || !Number.isSafeInteger(authority.authorizationRevision) || authority.authorizationRevision < 1 || typeof authority.lifecycleRevision !== "number" || !Number.isSafeInteger(authority.lifecycleRevision) || authority.lifecycleRevision < 0 || typeof authority.salesScopeRevision !== "number" || !Number.isSafeInteger(authority.salesScopeRevision) || authority.salesScopeRevision < 1 || typeof authority.settingsRevision !== "number" || !Number.isSafeInteger(authority.settingsRevision) || authority.settingsRevision < 1 ||
        typeof authority.reportingTimezone !== "string" || !isIso4217CurrencyCode(authority.reportingCurrency) || typeof authority.runtimeGenerationId !== "string" || authority.runtimeGenerationId.length < 1 || authority.runtimeGenerationId.length > 160 ||
        !sortedClosedGrants(authority.reportPermissionGrants, salesReportPermissionGrants) || !sortedClosedGrants(authority.objectPermissionGrants, salesReportObjectPermissionGrants) || !sortedClosedGrants(authority.fieldPermissionGrants, salesReportFieldPermissionGrants) ||
        !authority.reportPermissionGrants.includes("sales.reports.read") || action === "run" && !authority.reportPermissionGrants.includes("sales.exports.execute") || action === "schedule" && !authority.reportPermissionGrants.includes("sales.reports.schedule")) {
        if (error === "source")
            throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales reporting authority is unavailable.");
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting authority is unavailable.");
    }
    try {
        if (new Intl.DateTimeFormat("en-US", { timeZone: authority.reportingTimezone }).resolvedOptions().timeZone !== authority.reportingTimezone)
            throw new Error("noncanonical");
    }
    catch {
        if (error === "source")
            throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales reporting authority is unavailable.");
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting authority is unavailable.");
    }
    const parsed = Object.freeze({ authorizationRevision: authority.authorizationRevision, lifecycleRevision: authority.lifecycleRevision, salesScopeRevision: authority.salesScopeRevision, settingsRevision: authority.settingsRevision, reportingTimezone: authority.reportingTimezone, reportingCurrency: authority.reportingCurrency, runtimeGenerationId: authority.runtimeGenerationId, reportPermissionGrants: Object.freeze([...authority.reportPermissionGrants]), objectPermissionGrants: Object.freeze([...authority.objectPermissionGrants]), fieldPermissionGrants: Object.freeze([...authority.fieldPermissionGrants]) });
    if (reportId !== undefined) {
        const required = reportRequirements[reportId];
        if (required.objects.some((grant) => !parsed.objectPermissionGrants.includes(grant)) || required.fields.some((grant) => !parsed.fieldPermissionGrants.includes(grant))) {
            if (error === "source")
                throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales report underlying authority is unavailable.");
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report underlying authority is unavailable.");
        }
    }
    return parsed;
}
const reportWindowed = new Set(["sales.report.won-lost-conversion", "sales.report.lead-conversion", "sales.report.activity-by-owner-team", "sales.report.sales-cycle-duration"]);
function reportWindow(reportId, value) {
    if (reportWindowed.has(reportId)) {
        if (typeof value !== "string" || !["current-reporting-week", "previous-complete-reporting-week", "current-reporting-month", "previous-complete-reporting-month"].includes(value))
            throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales report window is invalid.");
        return value;
    }
    if (value !== undefined)
        throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales report does not accept a window.");
    return "as-of";
}
function reportReadData(value, call) {
    if (!isRecord(value) || !Object.hasOwn(value, "data") || !Object.hasOwn(value, "metadata") || Object.keys(value).length !== 2 || !isRecord(value.metadata))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales report result metadata is invalid.");
    const parsedMetadata = DataSourceReportExecutionSchema.safeParse(value.metadata);
    if (!parsedMetadata.success)
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales report result metadata is invalid.");
    const metadata = parsedMetadata.data;
    const required = reportRequirements[call.reportId];
    const currencyScale = iso4217CurrencyScale(call.authority.reportingCurrency);
    if (currencyScale === undefined)
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales report result metadata is invalid.");
    const expected = Object.freeze({
        applicationId: call.applicationId,
        environment: call.environment,
        source: Object.freeze({ id: call.reportId, version: 1 }),
        sourceSchema: Object.freeze({ id: `${call.reportId}.output`, version: 1 }),
        authorizationRevision: call.authority.authorizationRevision,
        lifecycleRevision: call.authority.lifecycleRevision,
        salesScopeRevision: call.authority.salesScopeRevision,
        settingsRevision: call.authority.settingsRevision,
        reportingTimezone: call.authority.reportingTimezone,
        reportingCurrency: call.authority.reportingCurrency,
        currencyScale,
        asOf: metadata.asOf,
        windowMode: call.windowMode,
        grouping: required.grouping,
        authorizedRecordCount: metadata.authorizedRecordCount
    });
    const executionDigest = `sha256:${createHash("sha256").update(canonicalJson(expected)).digest("hex")}`;
    if (Object.keys(metadata).length !== 16 || Object.entries(expected).some(([key, expectedValue]) => canonicalJson(metadata[key]) !== canonicalJson(expectedValue)) || metadata.executionDigest !== executionDigest ||
        !Number.isFinite(Date.parse(metadata.asOf)) || new Date(metadata.asOf).toISOString() !== metadata.asOf || canonicalJson(dataSourceReportExecutionDigestInput(metadata)) !== canonicalJson(expected)) {
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales report result metadata is invalid.");
    }
    return Object.freeze({ data: value.data, reportExecution: metadata });
}
function reportSourceHandler(reportId) {
    return async (context) => {
        const descriptor = salesReportDescriptors.find(({ id }) => id === reportId);
        const input = context.input;
        if (!isRecord(input) || Object.keys(input).some((key) => key !== "window-mode") || context.query.filters.length !== 0 || context.query.sort.length !== 0 || descriptor.primaryContract.id === "metric.scalar" && context.query.page !== undefined || descriptor.primaryContract.id === "table.records" && context.query.page === undefined)
            throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales report query is invalid.");
        const selectedFields = [...context.selectedFields];
        const allowedFields = new Set((descriptor.outputFields ?? []).map(({ id }) => id));
        if (descriptor.primaryContract.id === "metric.scalar" ? selectedFields.length !== 0 : selectedFields.length === 0 || new Set(selectedFields).size !== selectedFields.length || selectedFields.some((field) => !allowedFields.has(field)))
            throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales report field selection is invalid.");
        const identity = sourceIdentity(context.request);
        const actor = payloadUser(context.actor);
        if (actor === undefined)
            throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales reports require a user actor.");
        const call = Object.freeze({ ...identity, actorId: actor.id, authority: reportingAuthority(context.request, "source", reportId), reportId, windowMode: reportWindow(reportId, input["window-mode"]), query: context.query, selectedFields, recordScope: context.recordScope });
        return reportReadData(await reportingGateway(context.request, "source").read(call), call);
    };
}
export const salesPipelineValueByStageHandler = reportSourceHandler("sales.report.pipeline-value-by-stage");
export const salesWeightedForecastHandler = reportSourceHandler("sales.report.weighted-forecast");
export const salesWonLostConversionHandler = reportSourceHandler("sales.report.won-lost-conversion");
export const salesLeadConversionHandler = reportSourceHandler("sales.report.lead-conversion");
export const salesActivityByOwnerTeamHandler = reportSourceHandler("sales.report.activity-by-owner-team");
export const salesTaskAgingHandler = reportSourceHandler("sales.report.task-aging");
export const salesSalesCycleDurationHandler = reportSourceHandler("sales.report.sales-cycle-duration");
export const salesPipelineValueByStageDefinition = { descriptor: salesPipelineValueByStageDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesPipelineValueByStageOutputRuntimeSchema };
export const salesWeightedForecastDefinition = { descriptor: salesWeightedForecastDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesMetricOutputRuntimeSchema };
export const salesWonLostConversionDefinition = { descriptor: salesWonLostConversionDescriptor, inputSchema: { safeParse(value) { return reportWindowedInput(value); } }, outputSchema: salesMetricOutputRuntimeV2Schema };
export const salesLeadConversionDefinition = { descriptor: salesLeadConversionDescriptor, inputSchema: { safeParse(value) { return reportWindowedInput(value); } }, outputSchema: salesMetricOutputRuntimeV2Schema };
export const salesActivityByOwnerTeamDefinition = { descriptor: salesActivityByOwnerTeamDescriptor, inputSchema: { safeParse(value) { return reportWindowedInput(value); } }, outputSchema: salesActivityByOwnerTeamOutputRuntimeSchema };
export const salesTaskAgingDefinition = { descriptor: salesTaskAgingDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesTaskAgingOutputRuntimeSchema };
export const salesSalesCycleDurationDefinition = { descriptor: salesSalesCycleDurationDescriptor, inputSchema: { safeParse(value) { return reportWindowedInput(value); } }, outputSchema: salesMetricOutputRuntimeV2Schema };
function reportWindowedInput(value) {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "window-mode") || value["window-mode"] !== undefined && (typeof value["window-mode"] !== "string" || !["current-reporting-week", "previous-complete-reporting-week", "current-reporting-month", "previous-complete-reporting-month"].includes(value["window-mode"])))
        return { success: false, error: new Error("Sales report input is invalid.") };
    return { success: true, data: Object.freeze({ ...(value["window-mode"] === undefined ? {} : { "window-mode": value["window-mode"] }) }) };
}
export const salesReportActionHandler = async ({ authorizationContext, input, idempotencyKey, signal }) => {
    const actionId = isRecord(authorizationContext) && typeof authorizationContext.actionId === "string" ? authorizationContext.actionId : undefined;
    if (actionId !== salesReportRunDescriptor.id && actionId !== salesReportScheduleDescriptor.id || typeof idempotencyKey !== "string" || idempotencyKey.length === 0)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report action is forbidden.");
    const parsedInput = salesReportActionInputRuntimeSchemas[actionId].safeParse(input);
    if (!parsedInput.success)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report input is invalid.");
    const authorization = writeAuthorization(authorizationContext, actionId);
    const output = salesReportActionOutputRuntimeSchemas[actionId];
    const replay = idempotencyReplay(authorization, output);
    if (replay !== undefined)
        return replay;
    const reportId = parsedInput.data.reportId;
    if (typeof reportId !== "string" || !salesReportDescriptors.some(({ id }) => id === reportId))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report ID is invalid.");
    const window = parsedInput.data.windowMode;
    if (actionId === salesReportRunDescriptor.id || parsedInput.data.operation === "upsert") {
        try {
            reportWindow(reportId, reportWindowed.has(reportId) ? window : window === "as-of" ? undefined : window);
        }
        catch {
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report window is invalid.");
        }
    }
    if (actionId === salesReportScheduleDescriptor.id) {
        const schedule = parsedInput.data;
        const upsert = schedule.operation === "upsert";
        const allowed = upsert ? ["operation", "reportId", "recipientId", "expectedRevision", "weekday", "localTime", "windowMode"] : ["operation", "reportId", "recipientId", "expectedRevision"];
        const expectedRevision = schedule.expectedRevision;
        const weekday = schedule.weekday;
        const localTime = schedule.localTime;
        const validRevision = typeof expectedRevision === "number" && Number.isSafeInteger(expectedRevision) && expectedRevision >= (upsert ? 0 : 1);
        const validWeekday = typeof weekday === "number" && Number.isSafeInteger(weekday) && weekday >= 1 && weekday <= 7;
        if ((schedule.operation !== "upsert" && schedule.operation !== "cancel") || Object.keys(schedule).some((key) => !allowed.includes(key)) || typeof schedule.recipientId !== "string" || !actorIdPattern.test(schedule.recipientId) || !validRevision || upsert && (!validWeekday || typeof localTime !== "string" || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/u.test(localTime)))
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report schedule is invalid.");
    }
    const call = Object.freeze({ applicationId: authorization.applicationId, environment: authorization.environment, actorId: authorization.actorId, authority: reportingAuthority(authorizationContext, "action", reportId, actionId === salesReportRunDescriptor.id ? "run" : "schedule"), idempotencyKey, input: parsedInput.data, signal });
    const result = actionId === salesReportRunDescriptor.id ? await reportingGateway(authorizationContext, "action").run(call) : await reportingGateway(authorizationContext, "action").schedule(call);
    const parsedOutput = output.safeParse(result);
    if (!parsedOutput.success)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report result is invalid.");
    if (actionId === salesReportRunDescriptor.id && parsedOutput.data.state !== "queued" || actionId === salesReportScheduleDescriptor.id && (parsedOutput.data.reportId !== reportId || parsedOutput.data.recipientId !== parsedInput.data.recipientId || parsedOutput.data.state !== (parsedInput.data.operation === "cancel" ? "cancelled" : "active")))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report result does not match its request.");
    return parsedOutput.data;
};
export const salesReportActionDefinitions = Object.freeze(salesReportActionDescriptors.map((descriptor) => ({ descriptor, inputSchema: salesReportActionInputRuntimeSchemas[descriptor.id], outputSchema: salesReportActionOutputRuntimeSchemas[descriptor.id] })));
export async function salesReportDeliveryJob(input) {
    if (input.gateway === undefined || typeof input.gateway.process !== "function")
        throw new Error("Sales report delivery gateway is unavailable.");
    return await input.gateway.process();
}
export { salesCreateTaskToolDescriptor, salesNavigationDescriptors, salesReferenceMetadata, salesRouteDescriptors, salesSearchTasksDescriptor, salesTaskCreateDescriptor, salesTaskPageTemplate, salesTasksDescriptor, salesTimelineDescriptor, salesTimelineFields, salesTimelineInputRuntimeSchema, salesWorkspaceSettingsDescriptor } from "./contracts.js";
export { salesCrmActionDescriptors, salesCrmObjectFieldActionMatrix, salesCrmPermissionDescriptors, salesCrmPermissionPolicyBindings, salesCrmRoleTemplates, salesCrmRouteDescriptors } from "./crm-authority.js";
const salesTaskFieldStorage = {
    title: "title",
    status: "status"
};
const salesTaskFieldIds = new Set(Object.keys(salesTaskFieldStorage));
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function eventContext(type, transition, stateField = type === "sales.event.opportunity-changed" ? "stageId" : "status", workflow) {
    return Object.freeze({ kNexSalesEvent: Object.freeze({ eventId: transition.idempotencyKey, type, stateField, transition, ...(workflow === undefined ? {} : { workflow }) }) });
}
function applicationId(request) {
    const custom = request.payload.config.custom;
    if (typeof custom?.kNexApplicationId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(custom.kNexApplicationId)) {
        throw new Error("Sales durable events require a canonical application ID.");
    }
    return custom.kNexApplicationId;
}
function salesEventContract(actionId, collection) {
    if (collection === "sales-tasks" && ["sales.task.create", "sales.task.update"].includes(actionId))
        return { type: "sales.event.task-changed", stateField: "status" };
    if (collection === "sales-accounts" && ["sales.account.create", "sales.account.update", "sales.account.archive", "sales.lead.qualify", "sales.ownership.assign"].includes(actionId))
        return { type: "sales.event.account-changed", stateField: "status" };
    if (collection === "sales-contacts" && ["sales.contact.create", "sales.contact.update", "sales.contact.archive", "sales.lead.qualify", "sales.ownership.assign"].includes(actionId))
        return { type: "sales.event.contact-changed", stateField: "status" };
    if (collection === "sales-leads" && ["sales.lead.create", "sales.lead.update", "sales.lead.qualify", "sales.lead.disqualify", "sales.lead.archive", "sales.ownership.assign"].includes(actionId))
        return { type: "sales.event.lead-changed", stateField: actionId === "sales.lead.archive" ? "archiveStatus" : "status" };
    if (collection === "sales-opportunities" && ["sales.opportunity.create", "sales.opportunity.update", "sales.opportunity.stage.update", "sales.opportunity.close", "sales.opportunity.archive", "sales.lead.qualify", "sales.ownership.assign"].includes(actionId))
        return { type: "sales.event.opportunity-changed", stateField: actionId === "sales.opportunity.archive" ? "archiveStatus" : "stageId" };
    if (collection === "sales-activities" && ["sales.activity.create", "sales.activity.complete", "sales.activity.cancel", "sales.email.send", "sales.calendar.sync"].includes(actionId))
        return { type: "sales.event.timeline-changed", stateField: "status" };
    if (collection === "sales-notes" && actionId === "sales.note.create")
        return { type: "sales.event.timeline-changed", stateField: "status" };
    if (collection === "sales-attachment-references" && ["sales.attachment.link", "sales.attachment.remove"].includes(actionId))
        return { type: "sales.event.timeline-changed", stateField: "status" };
    if (collection === "sales-pipelines" && actionId === "sales.pipeline.update")
        return { type: "sales.event.opportunity-changed", stateField: "status" };
    if (collection === "sales-saved-views" && ["sales.saved-view.create", "sales.saved-view.update", "sales.saved-view.archive"].includes(actionId))
        return { type: "sales.event.opportunity-changed", stateField: "status" };
    if (collection === "sales-notifications" && ["sales.notification.read", "sales.notification.archive"].includes(actionId))
        return { type: "sales.event.notification-changed", stateField: "state" };
    if (collection === "sales-reminders" && ["sales.reminder.schedule", "sales.reminder.dismiss"].includes(actionId))
        return { type: "sales.event.reminder-changed", stateField: "state" };
    return undefined;
}
function validWorkflowTrigger(event, document) {
    const workflow = event.workflow;
    if (workflow === undefined)
        return undefined;
    const transition = event.transition;
    const revisionsValid = Number.isSafeInteger(workflow.authorizationRevision) && workflow.authorizationRevision >= 1 &&
        Number.isSafeInteger(workflow.lifecycleRevision) && workflow.lifecycleRevision >= 0 &&
        Number.isSafeInteger(workflow.scopeRevision) && workflow.scopeRevision >= 1;
    const common = revisionsValid && workflow.workflowVersion === 1 && workflow.acceptedOwnerId === String(document.ownerId) &&
        workflow.acceptedOwnerId.length > 0 && workflow.recipientId.length > 0;
    const opportunity = workflow.type === "sales.event.workflow.opportunity-proposal-entered" &&
        workflow.workflowId === "sales.workflow.opportunity-proposal-follow-up" && workflow.effectKind === "create-owner-follow-up-task" &&
        workflow.recipientId === workflow.acceptedOwnerId && transition.actionId === "sales.opportunity.stage.update";
    const lead = workflow.type === "sales.event.workflow.lead-owner-assigned" &&
        workflow.workflowId === "sales.workflow.lead-owner-assigned-notification" && workflow.effectKind === "notify-new-owner" &&
        workflow.recipientId === workflow.acceptedOwnerId && transition.actionId === "sales.ownership.assign" &&
        transition.ownership?.newOwnerId === workflow.acceptedOwnerId;
    const activity = workflow.type === "sales.event.workflow.activity-scheduled" &&
        workflow.workflowId === "sales.workflow.scheduled-activity-reminder" && workflow.effectKind === "schedule-reminder" &&
        workflow.recipientId === transition.actorId && transition.actionId === "sales.activity.create" &&
        transition.fromState === "absent" && transition.toState === "scheduled" && document.status === "scheduled" &&
        document.createdBy === transition.actorId && typeof workflow.scheduledAt === "string" && document.scheduledAt === workflow.scheduledAt;
    if (!common || ![opportunity, lead, activity].filter(Boolean).length ||
        (workflow.type === "sales.event.workflow.activity-scheduled" ? !activity : workflow.scheduledAt !== undefined)) {
        throw new Error("Sales workflow trigger facts do not match the committed record.");
    }
    return workflow;
}
export const salesEventAfterChange = async ({ collection, context, doc, operation, req }) => {
    const event = context.kNexSalesEvent;
    if (event === undefined)
        return doc;
    const transition = event.transition;
    const document = isRecord(doc) ? doc : undefined;
    const statusField = event.stateField;
    const audit = document?.audit;
    const lastAudit = Array.isArray(audit) ? audit.at(-1) : undefined;
    const expected = salesEventContract(transition.actionId, collection.slug);
    const auditMatches = Array.isArray(audit) && audit.length === transition.revision && isRecord(lastAudit) && canonicalJson(lastAudit) === canonicalJson(transition);
    if (operation !== "update" || document === undefined || String(document.id) !== transition.resourceId || document[statusField] !== transition.toState || !auditMatches ||
        document.revision !== transition.revision || document.applicationId !== transition.applicationId || document.environment !== transition.environment ||
        event.eventId !== transition.idempotencyKey || applicationId(req) !== transition.applicationId || expected === undefined || expected.type !== event.type || expected.stateField !== statusField) {
        throw new Error("Sales durable event transition does not match the committed record.");
    }
    const occurredAt = transition.occurredAt;
    const retentionUntil = new Date(Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
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
            actor: { id: transition.actorId, type: "user" },
            correlationId: req.headers.get("x-correlation-id") ?? event.eventId,
            idempotencyKey: event.eventId,
            payload: {
                resourceId: transition.resourceId,
                actionId: transition.actionId,
                environment: transition.environment,
                fromState: transition.fromState,
                toState: transition.toState,
                revision: transition.revision,
                idempotencyKey: transition.idempotencyKey,
                operation
            }
        },
        retentionUntil
    });
    const workflow = validWorkflowTrigger(event, document);
    if (workflow !== undefined) {
        const workflowEventId = `sales-workflow-${createHash("sha256").update(canonicalJson({ triggerEventId: event.eventId, workflow })).digest("hex")}`;
        await writeTransactionalOutboxEvent({ req, event: {
                id: workflowEventId, type: workflow.type, schemaVersion: 1, messageClass: "durable-workflow", occurredAt,
                applicationId: applicationId(req), pluginId: "module.sales", actor: { id: transition.actorId, type: "user" },
                correlationId: req.headers.get("x-correlation-id") ?? event.eventId, causationId: event.eventId, idempotencyKey: workflowEventId,
                payload: {
                    applicationId: transition.applicationId, environment: transition.environment, workflowId: workflow.workflowId,
                    workflowVersion: workflow.workflowVersion, effectKind: workflow.effectKind, targetId: transition.resourceId,
                    acceptedRevision: transition.revision, originalActorId: transition.actorId, acceptedOwnerId: workflow.acceptedOwnerId,
                    recipientId: workflow.recipientId, authRevision: workflow.authorizationRevision,
                    lifecycleRevision: workflow.lifecycleRevision, scopeRevision: workflow.scopeRevision, acceptedAt: occurredAt,
                    ...(workflow.scheduledAt === undefined ? {} : { scheduledAt: workflow.scheduledAt })
                }
            }, retentionUntil });
    }
    return doc;
};
export function createSalesRealtimeRelay(gateway) {
    return createOutboxRealtimeRelay({
        gateway,
        project(event) {
            if (event.pluginId !== "module.sales")
                return null;
            const topicId = event.type === "sales.event.task-changed" ? "sales.realtime.tasks"
                : event.type === "sales.event.opportunity-changed" ? "sales.realtime.opportunities"
                    : event.type === "sales.event.account-changed" ? "sales.realtime.accounts"
                        : event.type === "sales.event.contact-changed" ? "sales.realtime.contacts"
                            : event.type === "sales.event.lead-changed" ? "sales.realtime.leads"
                                : event.type === "sales.event.import-job-changed" ? "sales.realtime.import-jobs"
                                    : event.type === "sales.event.export-job-changed" ? "sales.realtime.export-jobs"
                                        : event.type === "sales.event.notification-changed" ? "sales.realtime.notifications"
                                            : event.type === "sales.event.reminder-changed" ? "sales.realtime.reminders"
                                                : event.type === "sales.event.provider-configuration-changed" ? "sales.realtime.provider-configurations"
                                                    : event.type === "sales.event.timeline-changed" ? "sales.realtime.timeline" : undefined;
            if (topicId === undefined)
                return null;
            const sourceId = topicId === "sales.realtime.tasks" ? "sales.tasks"
                : topicId === "sales.realtime.opportunities" ? "sales.opportunities"
                    : topicId === "sales.realtime.accounts" ? "sales.accounts"
                        : topicId === "sales.realtime.contacts" ? "sales.contacts"
                            : topicId === "sales.realtime.leads" ? "sales.leads"
                                : topicId === "sales.realtime.import-jobs" ? "sales.import-job.list"
                                    : topicId === "sales.realtime.export-jobs" ? "sales.export-job.list"
                                        : topicId === "sales.realtime.notifications" ? "sales.notifications"
                                            : topicId === "sales.realtime.reminders" ? "sales.reminders"
                                                : topicId === "sales.realtime.provider-configurations" ? "sales.provider-configurations" : "sales.timeline";
            // Realtime is an invalidation channel. The authoritative projection is
            // always re-read through the source boundary; record/state facts stay in
            // the durable outbox and never cross the socket transport.
            return {
                topicId,
                params: {},
                message: {
                    correlation: event.correlationId,
                    dedupe: event.id,
                    event: event.type,
                    source: sourceId,
                    topic: topicId
                }
            };
        }
    });
}
export function salesPipelineAuditJob(input) {
    if (input.signal.aborted)
        throw input.signal.reason;
    if (!Array.isArray(input.opportunities) || input.opportunities.length > 1_000)
        throw new Error("Sales pipeline audit input exceeds its bounded contract.");
    const stageCounts = { qualification: 0, discovery: 0, proposal: 0, negotiation: 0, won: 0, lost: 0 };
    for (const opportunity of input.opportunities) {
        if (!Object.hasOwn(stageCounts, opportunity.stage))
            throw new Error("Sales pipeline audit received an invalid stage.");
        const stage = opportunity.stage;
        stageCounts[stage] += 1;
    }
    return Object.freeze({ pluginId: "module.sales", jobId: "sales.job.pipeline-audit", stageCounts: Object.freeze(stageCounts) });
}
/** The host owns provider delivery; this bounded job admits only the fenced delivery intent. */
export function salesReminderDeliveryJob(input) {
    if (input.signal.aborted)
        throw input.signal.reason;
    if (!isSalesRecordId(input.reminderId) || !applicationIdPattern.test(input.applicationId) || !environmentPattern.test(input.environment) || !actorIdPattern.test(input.recipientId) || !Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1)
        throw new Error("Sales reminder delivery input is invalid.");
    return Object.freeze({ pluginId: "module.sales", jobId: "sales.job.reminder-delivery", reminderId: input.reminderId, fencingToken: input.fencingToken });
}
export async function salesCrmWorkflowExecutionJob(input) {
    if (input === null || typeof input !== "object" || input.gateway === null || typeof input.gateway !== "object" || typeof input.gateway.process !== "function") {
        throw new Error("Sales CRM workflow job requires the trusted host processor.");
    }
    return await input.gateway.process();
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export const salesPipelineStageNamespace = "13f5fa89-b465-5a7a-a19d-74ed6c5d1ef4";
export const salesPipelineStageSemantics = Object.freeze(["qualification", "discovery", "proposal", "negotiation", "won", "lost"]);
const pipelineStageUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const trustedStageTransitions = Object.freeze({ qualification: ["discovery", "lost"], discovery: ["proposal", "lost"], proposal: ["negotiation", "lost"], negotiation: ["won", "lost"], won: [], lost: [] });
/** Exact ADR-0028 UUIDv5 derivation; stage names never participate in identity. */
export function salesPipelineStageId(applicationId, environment, pipelineStableId, semantic) {
    const bounded = (value, max) => value.length > 0 && !value.includes("\0") && Buffer.byteLength(value.normalize("NFC")) <= max;
    if (!bounded(applicationId, 128) || !bounded(environment, 64) || !Number.isSafeInteger(pipelineStableId) || pipelineStableId < 1 || pipelineStableId > 2_147_483_647 || !salesPipelineStageSemantics.includes(semantic))
        throw new TypeError("Sales pipeline stage identity input is invalid.");
    const namespace = Buffer.from(salesPipelineStageNamespace.replaceAll("-", ""), "hex");
    const name = ["phase13/pipeline-stage/v1", applicationId, environment, String(pipelineStableId), semantic].map((value) => value.normalize("NFC")).join("\0");
    const digest = createHash("sha1").update(namespace).update(Buffer.from(name, "utf8")).digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function trustedPipelineStage(document, applicationId, environment, pipelineId) {
    const semantic = document?.semantic;
    if (typeof semantic !== "string" || !salesPipelineStageSemantics.includes(semantic) || document?.stageId !== salesPipelineStageId(applicationId, environment, pipelineId, semantic) ||
        !Array.isArray(document.requiredFieldIds) || canonicalJson(document.requiredFieldIds) !== canonicalJson(semantic === "lost" ? ["lossReason"] : []))
        return undefined;
    return semantic;
}
function trustedPipelineTransition(source, destination, applicationId, environment, pipelineId, destinationStageId) {
    const sourceSemantic = trustedPipelineStage(source, applicationId, environment, pipelineId);
    const destinationSemantic = trustedPipelineStage(destination, applicationId, environment, pipelineId);
    return sourceSemantic !== undefined && destinationSemantic !== undefined && Array.isArray(source?.allowedTransitionStageIds) && source.allowedTransitionStageIds.includes(destinationStageId) && trustedStageTransitions[sourceSemantic].includes(destinationSemantic);
}
/** Locks current visibility/target/field authority and returns one request-local execution plan. */
export async function resolveSalesSavedViewExecution(input) {
    const binding = parseSalesSavedViewBindingInput(input.bindingInput);
    const view = binding.savedViewId === undefined ? await input.persistence.resolveDefaultSavedView(input.sourceId) : await input.persistence.lockSavedView(binding.savedViewId);
    if (view === undefined) {
        const query = Object.freeze({ filters: [], sort: [], page: { number: input.pageNumber, size: 25 } });
        return Object.freeze({ gatewayInput: {}, selectedFields: Object.freeze([...input.selectedFields]), query, empty: true });
    }
    if (view.status !== "active" || view.applicationId !== input.applicationId || view.environment !== input.environment || binding.expectedRevision !== undefined && binding.expectedRevision !== view.revision || view.definition.source.id !== input.sourceId ||
        !await input.persistence.authorizeView(view) || !await input.persistence.authorizeTarget(view) || !await input.persistence.authorizeFields(view))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved view is unavailable.");
    const [authorizationRevision, sourceRevision, targetRecordScope, fieldAuthority, reportingTimezone] = await Promise.all([input.persistence.authorizationRevision(), input.persistence.sourceRevision(input.sourceId), input.persistence.targetRecordScope(view), input.persistence.fieldAuthority(view), input.sourceId === "sales.saved-view.calendar" ? input.persistence.reportingTimezone() : undefined]);
    if (!positiveExecutionRevision(authorizationRevision) || !positiveExecutionRevision(sourceRevision))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved-view revision fence is invalid.");
    const compiled = compileSalesSavedViewDefinition(view.definition, input.sourceId, input.selectedFields, input.pageNumber, { ...(reportingTimezone === undefined ? {} : { reportingTimezone }) });
    const expectedScopeKind = { "sales.object.account": "sales.accounts", "sales.object.contact": "sales.contacts", "sales.object.lead": "sales.leads", "sales.object.opportunity": "sales.opportunities", "sales.object.task": "sales.tasks", "sales.object.activity": "sales.activities" }[view.definition.targetObjectId];
    const selected = new Set(compiled.selectedFields);
    const filtered = new Set(compiled.query.filters.map(({ field }) => field));
    const sorted = new Set(compiled.query.sort.map(({ field }) => field));
    if (targetRecordScope?.kind !== expectedScopeKind || !isRecord(targetRecordScope.where) || fieldAuthority.length !== new Set(fieldAuthority.map(({ fieldId }) => fieldId)).size || fieldAuthority.some((entry) => !selected.has(entry.fieldId) || !entry.select || filtered.has(entry.fieldId) && !entry.filter || sorted.has(entry.fieldId) && !entry.sort))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved-view target authority is unavailable.");
    const metadataScope = Object.freeze({ applicationId: view.applicationId, environment: view.environment, savedViewId: view.id, savedViewRevision: view.revision, ownerId: view.ownerId, visibility: view.visibility });
    const authorityFields = Object.freeze(fieldAuthority.map((entry) => Object.freeze({ ...entry })));
    const fence = Object.freeze({ savedViewId: view.id, savedViewRevision: view.revision, sourceId: input.sourceId, sourceRevision, authorizationRevision, targetRecordScope, fieldAuthority: authorityFields, ...(reportingTimezone === undefined ? {} : { reportingTimezone }) });
    return Object.freeze({ gatewayInput: Object.freeze({ "saved-view-id": view.id, "expected-revision": view.revision }), targetObjectId: view.definition.targetObjectId, metadataScope, targetRecordScope, fieldAuthority: authorityFields, selectedFields: compiled.selectedFields, query: compiled.query, empty: false, fence });
}
const positiveExecutionRevision = (value) => Number.isSafeInteger(value) && value > 0;
/** Must run after gateway execution and before cache/result publication. */
export async function recheckSalesSavedViewExecution(input) {
    const [view, authorizationRevision, sourceRevision, reportingTimezone] = await Promise.all([input.persistence.lockSavedView(input.fence.savedViewId), input.persistence.authorizationRevision(), input.persistence.sourceRevision(input.fence.sourceId), input.fence.sourceId === "sales.saved-view.calendar" ? input.persistence.reportingTimezone() : undefined]);
    const reportingTimezoneMatches = reportingTimezone === undefined && input.fence.reportingTimezone === undefined || reportingTimezone !== undefined && input.fence.reportingTimezone !== undefined && canonicalJson(reportingTimezone) === canonicalJson(input.fence.reportingTimezone);
    if (view === undefined || view.status !== "active" || view.applicationId !== input.applicationId || view.environment !== input.environment || view.revision !== input.fence.savedViewRevision || view.definition.source.id !== input.fence.sourceId || authorizationRevision !== input.fence.authorizationRevision || sourceRevision !== input.fence.sourceRevision ||
        !reportingTimezoneMatches || !await input.persistence.authorizeView(view) || !await input.persistence.authorizeTarget(view) || !await input.persistence.authorizeFields(view))
        throw new DataSourceGatewayError("SOURCE_STALE", 409, "Sales saved-view execution changed before publication.");
    const [targetRecordScope, fieldAuthority] = await Promise.all([input.persistence.targetRecordScope(view), input.persistence.fieldAuthority(view)]);
    if (canonicalJson(targetRecordScope) !== canonicalJson(input.fence.targetRecordScope) || canonicalJson(fieldAuthority) !== canonicalJson(input.fence.fieldAuthority))
        throw new DataSourceGatewayError("SOURCE_STALE", 409, "Sales saved-view authority changed before publication.");
}
function salesRequest(value) {
    if (!isRecord(value) || !isRecord(value.payload) || typeof value.payload.find !== "function") {
        throw new Error("The Sales source requires a capability-scoped Payload request.");
    }
    return value;
}
const salesScopeFields = new Set(["ownerId", "teamId", "status", "stageId", "state", "recipientId", "id"]);
const salesSavedViewScopeFields = new Set(["ownerId", "teamId", "status", "id", "visibility", "visibilityTeamId"]);
function closedScopePredicate(value, depth = 0, fields = salesScopeFields) {
    if (!isRecord(value) || depth > 4)
        return false;
    const entries = Object.entries(value);
    if (entries.length !== 1)
        return false;
    const [field, condition] = entries[0];
    if (field === "and" || field === "or") {
        return Array.isArray(condition) && condition.length > 0 && condition.length <= 32 &&
            condition.every((entry) => closedScopePredicate(entry, depth + 1, fields));
    }
    if (!fields.has(field) || !isRecord(condition) || Object.keys(condition).length !== 1)
        return false;
    if (typeof condition.equals === "string")
        return condition.equals.length > 0 && condition.equals.length <= 160;
    return (field === "teamId" || field === "visibilityTeamId") && Array.isArray(condition.in) && condition.in.length > 0 && condition.in.length <= 32 &&
        condition.in.every((teamId) => typeof teamId === "string" && teamId.length > 0 && teamId.length <= 160) &&
        new Set(condition.in).size === condition.in.length;
}
function exactSavedViewMetadataPredicate(value) {
    if (!isRecord(value) || !Array.isArray(value.or) || value.or.length < 1 || value.or.length > 2 || Object.keys(value).length !== 1)
        return false;
    let personal = 0;
    let team = 0;
    for (const branch of value.or) {
        if (!isRecord(branch) || !Array.isArray(branch.and) || branch.and.length !== 2 || Object.keys(branch).length !== 1)
            return false;
        const clauses = branch.and;
        const personalOwner = clauses.some((clause) => isRecord(clause) && isRecord(clause.ownerId) && typeof clause.ownerId.equals === "string" && clause.ownerId.equals.length > 0 && Object.keys(clause.ownerId).length === 1 && Object.keys(clause).length === 1);
        const personalVisibility = clauses.some((clause) => isRecord(clause) && isRecord(clause.visibility) && clause.visibility.equals === "personal" && Object.keys(clause.visibility).length === 1 && Object.keys(clause).length === 1);
        const teamIds = clauses.some((clause) => isRecord(clause) && isRecord(clause.visibilityTeamId) && Array.isArray(clause.visibilityTeamId.in) && clause.visibilityTeamId.in.length > 0 && clause.visibilityTeamId.in.length <= 32 && clause.visibilityTeamId.in.every((id) => typeof id === "string" && id.length > 0 && id.length <= 160) && new Set(clause.visibilityTeamId.in).size === clause.visibilityTeamId.in.length && Object.keys(clause.visibilityTeamId).length === 1 && Object.keys(clause).length === 1);
        const teamVisibility = clauses.some((clause) => isRecord(clause) && isRecord(clause.visibility) && clause.visibility.equals === "team" && Object.keys(clause.visibility).length === 1 && Object.keys(clause).length === 1);
        if (personalOwner && personalVisibility)
            personal += 1;
        else if (teamIds && teamVisibility)
            team += 1;
        else
            return false;
    }
    return personal === 1 && team === value.or.length - 1;
}
function sourceIdentity(request) {
    const identity = isRecord(request) && isRecord(request.applicationIdentity) ? request.applicationIdentity : undefined;
    if (typeof identity?.applicationId !== "string" || identity.applicationId.length === 0 ||
        typeof identity?.environment !== "string" || identity.environment.length === 0) {
        throw new Error("The Sales source requires an authenticated application and environment identity.");
    }
    return Object.freeze({ applicationId: identity.applicationId, environment: identity.environment });
}
function scopeWhere(value, identity, expectedKind = "sales.tasks") {
    if (!isRecord(value) || value.kind !== expectedKind || !isRecord(value.where) || !Array.isArray(value.where.and) ||
        Object.keys(value.where).length !== 1 || value.where.and.length < 2 || value.where.and.length > 32) {
        throw new Error("The Sales source requires a closed application and environment record scope.");
    }
    let application = 0;
    let environment = 0;
    let activeStatus = 0;
    const authorityClauses = [];
    for (const clause of value.where.and) {
        if (isRecord(clause) && isRecord(clause.applicationId) && Object.keys(clause.applicationId).length === 1 && clause.applicationId.equals === identity.applicationId && Object.keys(clause).length === 1) {
            application += 1;
            continue;
        }
        if (isRecord(clause) && isRecord(clause.environment) && Object.keys(clause.environment).length === 1 && clause.environment.equals === identity.environment && Object.keys(clause).length === 1) {
            environment += 1;
            continue;
        }
        if (expectedKind === "sales.saved-views" && isRecord(clause) && isRecord(clause.status) && Object.keys(clause.status).length === 1 && clause.status.equals === "active" && Object.keys(clause).length === 1) {
            activeStatus += 1;
            continue;
        }
        if (!closedScopePredicate(clause, 0, expectedKind === "sales.saved-views" ? salesSavedViewScopeFields : salesScopeFields))
            throw new Error("The Sales source requires a closed application and environment record scope.");
        authorityClauses.push(clause);
    }
    if (application !== 1 || environment !== 1)
        throw new Error("The Sales source requires a closed application and environment record scope.");
    if (expectedKind === "sales.saved-views" && (activeStatus !== 1 || authorityClauses.length !== 1 || !exactSavedViewMetadataPredicate(authorityClauses[0])))
        throw new Error("The Sales saved-view source requires exact active personal-owner or authorized-team metadata authority.");
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
        gte: "greater_than_equal",
        lt: "less_than",
        lte: "less_than_equal"
    };
    const mapped = payloadOperator[operator];
    if (mapped === undefined)
        throw new Error("The Sales source received an unsupported filter operator.");
    return { [field]: { [mapped]: value } };
}
function taskWhere(context, controls) {
    const clauses = [];
    const scoped = scopeWhere(context.recordScope, sourceIdentity(context.request));
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
    if (typeof value !== "string" || !decimalPattern.test(value))
        throw new Error("Sales revenue values must be canonical decimals.");
    const text = value;
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
    const negative = amount.units < 0n;
    const digits = (negative ? -amount.units : amount.units).toString().padStart(amount.scale + 1, "0");
    if (amount.scale === 0)
        return `${negative ? "-" : ""}${digits}`;
    const integer = digits.slice(0, -amount.scale);
    return `${negative ? "-" : ""}${integer}.${digits.slice(-amount.scale)}`;
}
function moneyCell(value, currency) {
    if (value === null || value === undefined) {
        if (currency !== null && currency !== undefined)
            throw new Error("Sales opportunity amount and currency must be paired.");
        return null;
    }
    if (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency))
        throw new Error("Sales opportunity currency is invalid.");
    const amount = parseAmount(value);
    return { kind: "money", value: formatAmount(amount), currency, scale: amount.scale };
}
function taskCell(fieldId, document) {
    const storageField = salesTaskFieldStorage[fieldId];
    const value = document[storageField];
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
        source: { id: "sales.tasks", version: 2 },
        filters: query.filters,
        sort: query.sort,
        size: query.cursor.size
    })).digest("hex");
}
function salesTaskCursor(page, continuationKey) {
    return Buffer.from(`sales.tasks@2:${continuationKey}:${page}`).toString("base64url");
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
    const match = /^sales\.tasks@2:([0-9a-f]{64}):([1-9][0-9]*)$/u.exec(value);
    if (match === null || match[1] !== continuationKey)
        throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
    const page = Number(match[2]);
    if (!Number.isSafeInteger(page) || page > 1_000_000)
        throw new DataSourceGatewayError("INVALID_CURSOR", 400, "Sales task cursor is invalid.");
    return page;
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
const opportunityStorage = { name: "name", "pipeline-id": "pipelineId", "pipeline-revision": "pipelineRevision", "stage-id": "stageId", "stage-name": "stageName", "stage-semantic": "stageSemantic", "stage-revision": "stageRevision", revision: "revision", amount: "amount" };
function opportunityCell(fieldId, document) {
    const value = document[opportunityStorage[fieldId]];
    if (fieldId === "amount")
        return moneyCell(value, document.currency);
    if (["revision", "pipeline-id", "pipeline-revision", "stage-revision"].includes(fieldId)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new Error("Sales opportunity revision is invalid.");
        return { kind: "integer", value };
    }
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Sales opportunity ${fieldId} is invalid.`);
    return { kind: fieldId === "stage-id" ? "status" : fieldId === "stage-semantic" ? "enum" : "text", value };
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
        select: { id: true, name: true, pipelineId: true, stageId: true, revision: true, ...(selected.includes("amount") ? { amount: true, currency: true } : {}) },
        sort: ["id"],
        where: scopeWhere(context.recordScope, sourceIdentity(context.request), "sales.opportunities")
    });
    const result = await salesRequest(context.request).payload.find({ ...base, collection: "sales-opportunities" });
    const documents = result.docs;
    const pipelineIds = [...new Set(documents.map(({ pipelineId }) => pipelineId).filter((id) => typeof id === "string" || typeof id === "number"))];
    const identity = sourceIdentity(context.request);
    const request = salesRequest(context.request);
    const [pipelines, stages] = await Promise.all([
        request.payload.find({ ...requestOptions(context, { page: 1, limit: Math.max(1, pipelineIds.length), where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { id: { in: pipelineIds } }, { status: { equals: "active" } }] } }), collection: "sales-pipelines" }),
        request.payload.find({ ...requestOptions(context, { page: 1, limit: Math.max(1, pipelineIds.length * 6), where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { pipelineId: { in: pipelineIds } }, { status: { equals: "active" } }] } }), collection: "sales-pipeline-stages" })
    ]);
    const pipelineById = new Map(pipelines.docs.map((row) => [String(row.id), row]));
    const stageById = new Map(stages.docs.map((row) => [`${String(row.pipelineId)}:${String(row.stageId)}`, row]));
    return {
        fields: selected,
        rows: documents.map((document) => {
            if (document.id === undefined || document.id === null)
                throw new Error("Sales opportunity rows require stable IDs.");
            const pipeline = pipelineById.get(String(document.pipelineId));
            const stage = stageById.get(`${String(document.pipelineId)}:${String(document.stageId)}`);
            if (pipeline === undefined || stage === undefined)
                throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales opportunity pipeline projection is incomplete.");
            const projected = { ...document, pipelineRevision: pipeline.revision, stageName: stage.name, stageSemantic: stage.semantic, stageRevision: stage.revision };
            return { key: String(document.id), values: Object.fromEntries(selected.map((field) => [field, opportunityCell(field, projected)])) };
        }),
        page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: result.hasNextPage ?? false }
    };
}
const crmSourceSpecs = Object.freeze({
    "sales.accounts": { collection: "sales-accounts", fields: salesAccountFields, storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", status: "status", revision: "revision" } },
    "sales.account.detail": { collection: "sales-accounts", fields: salesAccountFields, storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", status: "status", revision: "revision" } },
    "sales.contacts": { collection: "sales-contacts", fields: salesContactFields, storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", status: "status", revision: "revision", email: "email", phone: "phone" } },
    "sales.contact.detail": { collection: "sales-contacts", fields: salesContactFields, storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", status: "status", revision: "revision", email: "email", phone: "phone" } },
    "sales.leads": { collection: "sales-leads", fields: salesLeadFields, storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "archive-status": "archiveStatus", status: "status", revision: "revision", email: "email", phone: "phone" } },
    "sales.lead.detail": { collection: "sales-leads", fields: salesLeadDetailFields, storage: { "display-name": "displayName", source: "source", "owner-id": "ownerId", "team-id": "teamId", "archive-status": "archiveStatus", status: "status", revision: "revision", email: "email", phone: "phone", "decided-at": "decidedAt", "qualified-at": "qualifiedAt", "disqualified-at": "disqualifiedAt", "qualified-account-id": "qualifiedAccountId", "qualified-contact-id": "qualifiedContactId", "qualified-opportunity-id": "qualifiedOpportunityId" } },
    "sales.opportunity.detail": { collection: "sales-opportunities", fields: salesOpportunityDetailFields, storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", "archive-status": "archiveStatus", "account-id": "accountId", "primary-contact-id": "primaryContactId", "pipeline-id": "pipelineId", "stage-id": "stageId", "expected-close-date": "expectedCloseDate", revision: "revision", amount: "amount" } },
    "sales.notifications": { collection: "sales-notifications", fields: salesNotificationFields, storage: { subject: "subject", state: "state", "created-at": "createdAt", revision: "revision" } },
    "sales.reminders": { collection: "sales-reminders", fields: salesReminderFields, storage: { subject: "subject", state: "state", "scheduled-at": "scheduledAt", "reference-kind": "referenceKind", "reference-id": "referenceId", revision: "revision" } }
});
function isCrmSourceId(value) { return Object.hasOwn(crmSourceSpecs, value); }
function crmSourceCell(field, value, currency) {
    if (value === null || value === undefined) {
        if (field.nullable)
            return null;
        throw new Error(`Sales ${field.id} is absent.`);
    }
    if (field.kind === "integer") {
        const integer = Number.isSafeInteger(value) ? value : typeof value === "string" && isSalesRecordId(value) ? Number(value) : undefined;
        if (typeof integer !== "number" || !Number.isSafeInteger(integer) || integer < 1)
            throw new Error(`Sales ${field.id} is invalid.`);
        return { kind: "integer", value: integer };
    }
    if (field.kind === "money")
        return moneyCell(value, currency);
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Sales ${field.id} is invalid.`);
    return { kind: field.kind, value };
}
function crmDetailInput(context, detail) {
    if (!detail) {
        const empty = salesEmptyInputRuntimeSchema.safeParse(context.input);
        if (!empty.success)
            throw empty.error;
        return undefined;
    }
    const parsed = salesCrmDetailInputRuntimeSchema.safeParse(context.input);
    if (!parsed.success)
        throw parsed.error;
    return parsed.data.id;
}
async function crmTable(context, sourceId) {
    const spec = crmSourceSpecs[sourceId];
    const detail = sourceId.endsWith(".detail");
    const id = crmDetailInput(context, detail);
    if (context.query.filters.length > 0 || context.query.sort.length > 0 || context.query.page === undefined || detail && context.query.page.number !== 1)
        throw new Error("Sales CRM source query is invalid.");
    const selected = [...context.selectedFields];
    if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some((field) => !Object.hasOwn(spec.storage, field)))
        throw new Error("Sales CRM source field selection is invalid.");
    const identity = sourceIdentity(context.request);
    const scope = scopeWhere(context.recordScope, identity, sourceId);
    const where = id === undefined ? scope : { and: [scope, { id: { equals: id } }] };
    const request = salesRequest(context.request);
    const user = payloadUser(context.actor);
    const result = await request.payload.find({ collection: spec.collection, depth: 0, overrideAccess: true, pagination: true, page: context.query.page.number, limit: detail ? 1 : context.query.page.size, select: { id: true, ...Object.fromEntries(selected.map((field) => [spec.storage[field], true])), ...(selected.includes("amount") ? { currency: true } : {}) }, sort: ["id"], where, ...(user === undefined ? {} : { user }), req: request });
    if (detail && result.docs.length > 1)
        throw new Error("Sales CRM detail source is ambiguous.");
    return { fields: selected, rows: result.docs.map((document) => {
            if (document.id === undefined || document.id === null)
                throw new Error("Sales CRM source row has no ID.");
            return { key: String(document.id), values: Object.fromEntries(selected.map((field) => [field, crmSourceCell(spec.fields.find((candidate) => candidate.id === field), document[spec.storage[field]], document.currency)])) };
        }), page: { number: context.query.page.number, pageSize: detail ? 1 : context.query.page.size, hasNext: detail ? false : result.hasNextPage ?? false } };
}
export const salesAccountsHandler = async (context) => await crmTable(context, "sales.accounts");
export const salesAccountDetailHandler = async (context) => await crmTable(context, "sales.account.detail");
export const salesContactsHandler = async (context) => await crmTable(context, "sales.contacts");
export const salesContactDetailHandler = async (context) => await crmTable(context, "sales.contact.detail");
export const salesLeadsHandler = async (context) => await crmTable(context, "sales.leads");
export const salesLeadDetailHandler = async (context) => await crmTable(context, "sales.lead.detail");
export const salesOpportunityDetailHandler = async (context) => await crmTable(context, "sales.opportunity.detail");
function recipientScopeWhere(context, expectedKind) {
    const identity = sourceIdentity(context.request);
    const actor = payloadUser(context.actor);
    const scope = context.recordScope;
    if (actor === undefined || !isRecord(scope) || scope.kind !== expectedKind || !isRecord(scope.where) || !Array.isArray(scope.where.and) || Object.keys(scope.where).length !== 1 || scope.where.and.length !== 3)
        throw new Error("Sales recipient source requires exact recipient authority.");
    const clauses = scope.where.and;
    const exact = (field, value) => clauses.filter((clause) => isRecord(clause) && Object.keys(clause).length === 1 && isRecord(clause[field]) && Object.keys(clause[field]).length === 1 && clause[field].equals === value).length === 1;
    if (!exact("applicationId", identity.applicationId) || !exact("environment", identity.environment) || !exact("recipientId", actor.id))
        throw new Error("Sales recipient source requires exact recipient authority.");
    return scope.where;
}
async function recipientTable(context, sourceId) {
    const spec = crmSourceSpecs[sourceId];
    const input = salesEmptyInputRuntimeSchema.safeParse(context.input);
    if (!input.success || context.query.page === undefined || context.query.filters.length > 0 || context.query.sort.length > 0)
        throw new Error("Sales recipient source query is invalid.");
    const selected = [...context.selectedFields];
    if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some((field) => !Object.hasOwn(spec.storage, field)))
        throw new Error("Sales recipient source field selection is invalid.");
    const request = salesRequest(context.request);
    const user = payloadUser(context.actor);
    const result = await request.payload.find({ collection: spec.collection, depth: 0, overrideAccess: true, pagination: true, page: context.query.page.number, limit: context.query.page.size, select: { id: true, ...Object.fromEntries(selected.map((field) => [spec.storage[field], true])) }, sort: ["id"], where: recipientScopeWhere(context, sourceId), ...(user === undefined ? {} : { user }), req: request });
    return { fields: selected, rows: result.docs.map((document) => ({ key: String(document.id), values: Object.fromEntries(selected.map((field) => [field, crmSourceCell(spec.fields.find((candidate) => candidate.id === field), document[spec.storage[field]])])) })), page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: result.hasNextPage ?? false } };
}
export const salesNotificationsHandler = async (context) => await recipientTable(context, "sales.notifications");
export const salesRemindersHandler = async (context) => await recipientTable(context, "sales.reminders");
function providerConfigurationReadGateway(request) {
    const candidate = isRecord(request) && isRecord(request.providerConfigurationReadGateway) ? request.providerConfigurationReadGateway : undefined;
    if (candidate === undefined || typeof candidate.read !== "function")
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales provider configuration status is unavailable.");
    return candidate;
}
function canonicalConfigurationInstant(value) {
    if (typeof value !== "string")
        return false;
    try {
        return new Date(value).toISOString() === value;
    }
    catch {
        return false;
    }
}
export const salesProviderConfigurationsHandler = async (context) => {
    const parsedInput = salesEmptyInputRuntimeSchema.safeParse(context.input);
    const page = context.query.page;
    if (!parsedInput.success || page === undefined || context.query.filters.length > 0 || context.query.sort.length > 0)
        throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales provider configuration query is invalid.");
    const selected = [...context.selectedFields];
    const allowedFields = new Set(salesProviderConfigurationFields.map(({ id }) => id));
    if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some((field) => !allowedFields.has(field)))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales provider configuration field selection is invalid.");
    const identity = sourceIdentity(context.request);
    const actor = payloadUser(context.actor);
    if (actor === undefined)
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales provider configuration status requires a user actor.");
    const rows = await providerConfigurationReadGateway(context.request).read(Object.freeze({ ...identity, actorId: actor.id }));
    const providerIds = new Set();
    if (!Array.isArray(rows) || rows.length > 2)
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales provider configuration status is invalid.");
    const validated = rows.map((row) => {
        if (!isRecord(row) || Object.keys(row).sort().join("\0") !== "providerId\0revision\0revokedAt\0state\0updatedAt" || !["email.reference.v1", "calendar.reference.v1"].includes(String(row.providerId)) || providerIds.has(String(row.providerId)) || !["active", "revoked"].includes(String(row.state)) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || !canonicalConfigurationInstant(row.updatedAt) || row.state === "active" && row.revokedAt !== null || row.state === "revoked" && !canonicalConfigurationInstant(row.revokedAt))
            throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales provider configuration status is invalid.");
        providerIds.add(String(row.providerId));
        return row;
    }).sort((left, right) => left.providerId.localeCompare(right.providerId));
    const values = (row) => ({ "provider-id": row.providerId, state: row.state, revision: row.revision, "updated-at": row.updatedAt, "revoked-at": row.revokedAt });
    const offset = (page.number - 1) * page.size;
    const visible = validated.slice(offset, offset + page.size);
    return { fields: selected, rows: visible.map((row) => ({ key: row.providerId, values: Object.fromEntries(selected.map((field) => [field, crmSourceCell(salesProviderConfigurationFields.find((candidate) => candidate.id === field), values(row)[field])])) })), page: { number: page.number, pageSize: page.size, hasNext: offset + page.size < validated.length } };
};
function communicationGateway(value) {
    const candidate = isRecord(value) && isRecord(value.providerGateway) ? value.providerGateway : undefined;
    if (candidate === undefined || typeof candidate.dispatch !== "function") {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales provider authority is unavailable.");
    }
    return candidate;
}
function communicationAuthorization(value, actionId, resourceId) {
    const authorization = writeAuthorization(value, actionId, resourceId);
    if (!actorIdPattern.test(authorization.actorId) || !applicationIdPattern.test(authorization.applicationId) || !environmentPattern.test(authorization.environment)) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales provider authority is invalid.");
    }
    return authorization;
}
function communicationRelationAdmission(authorization, actionId, recordType, recordId, revision) {
    const admission = authorization.communicationRelationAdmission;
    const exact = admission !== undefined && Object.keys(admission).sort().join("\0") === "actionId\0applicationId\0archiveStatus\0environment\0ownerId\0recordId\0recordType\0revision\0status\0teamId";
    if (!exact || admission.actionId !== actionId || admission.recordType !== recordType || admission.recordId !== recordId || admission.applicationId !== authorization.applicationId || admission.environment !== authorization.environment || revision !== undefined && admission.revision !== revision || !Number.isSafeInteger(admission.revision) || admission.revision < 1 || !actorIdPattern.test(admission.ownerId) || admission.teamId !== null && !actorIdPattern.test(admission.teamId))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales communication relation admission is invalid.");
    const validState = recordType === "sales.contact" ? admission.status === "active" && admission.archiveStatus === null
        : recordType === "sales.lead" ? (admission.status === "new" || admission.status === "working") && admission.archiveStatus === "active"
            : recordType === "sales.task" ? admission.status === "open" && admission.archiveStatus === null
                : admission.status === "scheduled" && admission.archiveStatus === null;
    if (!validState || actionId === "sales.email.send" && admission.teamId === null)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales communication relation is unavailable.");
    return admission;
}
function communicationAudit(authorization, actionId, resourceId, fromState, toState, revision, idempotencyKey) {
    const occurredAt = new Date().toISOString();
    if (!validAuditTimestamp(occurredAt))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales audit timestamp is invalid.");
    return Object.freeze({ actionId, resourceId, applicationId: authorization.applicationId, environment: authorization.environment, fromState, toState, occurredAt, actorId: authorization.actorId, revision, idempotencyKey });
}
function recipientAuditTransitionAllowed(collection, actionId, fromState, toState) {
    if (collection === "sales-notifications")
        return actionId === "sales.notification.deliver" && fromState === "absent" && toState === "unread"
            || actionId === "sales.notification.read" && fromState === "unread" && toState === "read"
            || actionId === "sales.notification.archive" && ["unread", "read"].includes(fromState) && toState === "archived";
    return actionId === "sales.reminder.schedule" && fromState === "absent" && toState === "scheduled"
        || actionId === "sales.job.reminder-delivery" && fromState === "scheduled" && ["delivered", "failed"].includes(toState)
        || actionId === "sales.reminder.dismiss" && (fromState === "delivered" && toState === "dismissed" || fromState === "scheduled" && toState === "cancelled");
}
function recipientAuditEntry(value, collection) {
    if (!isRecord(value) || !exactKeys(value, ["actionId", "resourceId", "applicationId", "environment", "fromState", "toState", "occurredAt", "actorId", "revision", "idempotencyKey"]) ||
        typeof value.actionId !== "string" || typeof value.resourceId !== "string" || typeof value.applicationId !== "string" || typeof value.environment !== "string" || typeof value.fromState !== "string" || typeof value.toState !== "string" || typeof value.occurredAt !== "string" || typeof value.actorId !== "string" || typeof value.idempotencyKey !== "string" || typeof value.revision !== "number" ||
        !isSalesRecordId(value.resourceId) || !applicationIdPattern.test(value.applicationId) || !environmentPattern.test(value.environment) || !actorIdPattern.test(value.actorId) || !durableIdPattern.test(value.idempotencyKey) || !validAuditTimestamp(value.occurredAt) || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 1_000_000_000 || !recipientAuditTransitionAllowed(collection, value.actionId, value.fromState, value.toState))
        return undefined;
    return Object.freeze(value);
}
/** Exact host/Sales recipient delivery chain; source row revision and final state are both fenced. */
export function validateSalesRecipientAuditHistory(value, collection, identity) {
    if (!isSalesRecordId(identity.resourceId) || !applicationIdPattern.test(identity.applicationId) || !environmentPattern.test(identity.environment) || !Number.isSafeInteger(identity.revision) || identity.revision < 1 || identity.revision > 1_000_000_000)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales recipient audit identity is invalid.");
    const history = boundedAuditArray(value);
    if (history.length !== identity.revision)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales recipient audit history is not current.");
    const idempotencyKeys = new Set();
    let priorState = "absent";
    const parsed = history.map((raw, index) => {
        const entry = recipientAuditEntry(raw, collection);
        if (entry === undefined || entry.resourceId !== identity.resourceId || entry.applicationId !== identity.applicationId || entry.environment !== identity.environment || entry.revision !== index + 1 || entry.fromState !== priorState || idempotencyKeys.has(entry.idempotencyKey))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales recipient audit history is invalid.");
        idempotencyKeys.add(entry.idempotencyKey);
        priorState = entry.toState;
        return entry;
    });
    if (priorState !== identity.state)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales recipient audit history is not current.");
    return Object.freeze(parsed);
}
export function createSalesRecipientAuditEntry(input, collection) {
    const entry = recipientAuditEntry(input, collection);
    if (entry === undefined)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales recipient audit transition is invalid.");
    return entry;
}
export function appendSalesRecipientAudit(history, collection, identity, input) {
    const current = validateSalesRecipientAuditHistory(history, collection, identity);
    const entry = createSalesRecipientAuditEntry(input, collection);
    if (entry.revision !== identity.revision + 1 || entry.fromState !== identity.state || current.some((prior) => prior.idempotencyKey === entry.idempotencyKey))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales recipient audit transition is stale.");
    return validateSalesRecipientAuditHistory([...current, entry], collection, { ...identity, revision: entry.revision, state: entry.toState });
}
function providerResult(value, expectedProviderId) {
    if (!isRecord(value) || !exactKeys(value, ["operationId", "state", "providerId", "receipt"]) || typeof value.operationId !== "string" || !durableIdPattern.test(value.operationId) || (value.state !== "queued" && value.state !== "accepted") || (value.providerId !== "email.reference.v1" && value.providerId !== "calendar.reference.v1") || !isRecord(value.receipt) || !exactKeys(value.receipt, ["idempotencyDigest", "relatedRecord"]) || typeof value.receipt.idempotencyDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.receipt.idempotencyDigest)) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales provider result is invalid.");
    }
    if (value.providerId !== expectedProviderId)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales provider result does not match the action.");
    return Object.freeze(value);
}
function communicationActionId(value) {
    const actionId = isRecord(value) && isRecord(value.decision) ? value.decision.actionId : isRecord(value) ? value.actionId : undefined;
    if (typeof actionId !== "string" || !salesCommunicationActionDescriptors.some((descriptor) => descriptor.id === actionId))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales communication action is unavailable.");
    return actionId;
}
function communicationOutput(schema, value) {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
        throw parsed.error;
    return parsed.data;
}
function communicationRecordId(value, name) {
    if (!isSalesRecordId(value))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
    return value;
}
async function communicationReference(payloadRequest, authorization, kind, id, expectedRevision, user) {
    const collection = kind === "task" ? "sales-tasks" : "sales-activities";
    const state = kind === "task" ? "open" : "scheduled";
    const found = await payloadRequest.payload.find({ collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, select: { id: true, revision: true, status: true, relatedRecordType: true, relatedRecordId: true, audit: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }, { status: { equals: state } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest });
    if (found.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales reminder reference changed before scheduling.");
    return found.docs[0];
}
async function communicationDeliveryCurrent(payloadRequest, authorization, collection, id, expectedRevision, states, user) {
    const found = await payloadRequest.payload.find({ collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, select: { id: true, revision: true, state: true, audit: true, recipientId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { recipientId: { equals: authorization.actorId } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }, { state: { in: states } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest });
    if (found.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales delivery is unavailable at the expected revision.");
    const current = found.docs[0];
    if (current.recipientId !== authorization.actorId || typeof current.state !== "string" || !states.includes(current.state) || current.revision !== expectedRevision)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales delivery no longer matches its recipient lifecycle fence.");
    return current;
}
/** P13.6 bounded provider and recipient delivery actions. Host capability injection is the only provider boundary. */
export const salesCommunicationActionHandler = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const actionId = communicationActionId(authorizationContext);
    const runtime = salesCommunicationActionInputRuntimeSchemas[actionId];
    const parsed = runtime.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const output = salesCommunicationActionOutputRuntimeSchemas[actionId];
    const resourceId = typeof parsed.data.id === "string" ? parsed.data.id : typeof parsed.data.referenceId === "string" ? parsed.data.referenceId : typeof parsed.data.activityId === "string" ? parsed.data.activityId : undefined;
    const authorization = communicationAuthorization(authorizationContext, actionId, resourceId);
    const replay = idempotencyReplay(authorization, output);
    if (replay !== undefined)
        return replay;
    const eventId = durableActionEventId(authorization, idempotencyKey);
    const payloadRequest = workflowPayload(request);
    const user = payloadUser(actor);
    if (actionId === "sales.email.send") {
        const relatedRecordId = communicationRecordId(parsed.data.relatedRecordId, "related record ID");
        const relation = communicationRelationAdmission(authorization, actionId, parsed.data.relatedRecordType, relatedRecordId);
        const queuedAt = new Date().toISOString();
        // The host's transaction includes this create and dispatch. A rejected dispatch aborts it,
        // while the queued operation carries this stable Activity ID for the fenced worker CAS.
        const created = await payloadRequest.payload.create({ collection: "sales-activities", data: { applicationId: authorization.applicationId, environment: authorization.environment, ownerId: relation.ownerId, teamId: relation.teamId, createdBy: authorization.actorId, updatedBy: authorization.actorId, revision: 1, audit: [], status: "scheduled", type: "email", subject: parsed.data.subject, actorId: authorization.actorId, scheduledAt: queuedAt, relatedRecordType: parsed.data.relatedRecordType, relatedRecordId }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) });
        const activityId = communicationRecordId(String(created.id), "activity ID");
        const audit = communicationAudit(authorization, actionId, activityId, "absent", "scheduled", 1, eventId);
        const finalized = await payloadRequest.payload.update({ collection: "sales-activities", id: activityId, data: { audit: [audit] }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext("sales.event.timeline-changed", audit, "status") });
        if (String(finalized.id) !== activityId || finalized.revision !== 1 || finalized.status !== "scheduled")
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales email Activity audit finalization failed.");
        const gateway = communicationGateway(authorizationContext);
        providerResult(await gateway.dispatch(Object.freeze({ actionId, idempotencyKey: eventId, relatedRecord: { type: parsed.data.relatedRecordType, id: Number(relatedRecordId) }, payload: Object.freeze({ activityId: Number(activityId), expectedRevision: 1, subject: parsed.data.subject, body: parsed.data.body }) })), "email.reference.v1");
        return communicationOutput(output, { id: activityId, revision: 1, status: "accepted" });
    }
    if (actionId === "sales.calendar.sync") {
        const activityId = communicationRecordId(parsed.data.activityId, "activity ID");
        const expectedRevision = Number(parsed.data.expectedRevision);
        communicationRelationAdmission(authorization, actionId, "sales.activity", activityId, expectedRevision);
        const current = await communicationReference(payloadRequest, authorization, "activity", activityId, expectedRevision, user);
        const gateway = communicationGateway(authorizationContext);
        const relatedRecordType = current.relatedRecordType;
        const relatedRecordId = current.relatedRecordId;
        if (typeof relatedRecordType !== "string" || !["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"].includes(relatedRecordType) || !isSalesRecordId(relatedRecordId))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales activity relation is invalid.");
        providerResult(await gateway.dispatch(Object.freeze({ actionId, idempotencyKey: eventId, relatedRecord: { type: relatedRecordType, id: Number(relatedRecordId) }, payload: Object.freeze({ activityId: Number(activityId), expectedRevision }) })), "calendar.reference.v1");
        // Worker completion uses this unchanged CAS fence; Sales never races it with metadata-only writes.
        return communicationOutput(output, { id: activityId, revision: expectedRevision, status: "accepted" });
    }
    if (actionId === "sales.reminder.schedule") {
        const kind = parsed.data.referenceKind;
        const referenceId = communicationRecordId(parsed.data.referenceId, "reminder reference ID");
        const expectedRevision = Number(parsed.data.expectedRevision);
        communicationRelationAdmission(authorization, actionId, kind === "task" ? "sales.task" : "sales.activity", referenceId, expectedRevision);
        await communicationReference(payloadRequest, authorization, kind, referenceId, expectedRevision, user);
        const idempotencyDigest = digest(canonicalJson({ applicationId: authorization.applicationId, environment: authorization.environment, recipientId: authorization.actorId, key: eventId }));
        const created = await payloadRequest.payload.create({ collection: "sales-reminders", data: { applicationId: authorization.applicationId, environment: authorization.environment, recipientId: authorization.actorId, referenceKind: kind, referenceId, subject: parsed.data.subject, scheduledAt: parsed.data.scheduledAt, state: "scheduled", revision: 1, idempotencyDigest, audit: [] }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) });
        const reminderId = communicationRecordId(String(created.id), "reminder ID");
        const audit = communicationAudit(authorization, actionId, reminderId, "absent", "scheduled", 1, eventId);
        const finalized = await payloadRequest.payload.update({ collection: "sales-reminders", id: reminderId, data: { audit: [audit] }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext("sales.event.reminder-changed", audit, "state") });
        if (String(finalized.id) !== reminderId || finalized.revision !== 1 || finalized.state !== "scheduled")
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales reminder audit finalization failed.");
        return communicationOutput(output, { id: reminderId, revision: 1, status: "scheduled" });
    }
    if (actionId === "sales.notification.read" || actionId === "sales.notification.archive" || actionId === "sales.reminder.dismiss") {
        const collection = actionId.startsWith("sales.notification") ? "sales-notifications" : "sales-reminders";
        const id = communicationRecordId(parsed.data.id, "delivery ID");
        const expectedRevision = Number(parsed.data.expectedRevision);
        const expected = actionId === "sales.notification.read" ? ["unread"] : actionId === "sales.notification.archive" ? ["unread", "read"] : ["scheduled", "delivered"];
        const current = await communicationDeliveryCurrent(payloadRequest, authorization, collection, id, expectedRevision, expected, user);
        const currentState = current.state;
        const destination = actionId === "sales.notification.read" ? "read" : actionId === "sales.notification.archive" ? "archived" : currentState === "scheduled" ? "cancelled" : "dismissed";
        const audit = communicationAudit(authorization, actionId, id, currentState, destination, expectedRevision + 1, eventId);
        const history = appendSalesRecipientAudit(current.audit, collection, { resourceId: id, applicationId: authorization.applicationId, environment: authorization.environment, revision: expectedRevision, state: currentState }, audit);
        const eventType = actionId.startsWith("sales.notification") ? "sales.event.notification-changed" : "sales.event.reminder-changed";
        const lifecycleTimestamp = actionId === "sales.notification.read" ? { readAt: audit.occurredAt }
            : actionId === "sales.notification.archive" ? { archivedAt: audit.occurredAt }
                : destination === "cancelled" ? { cancelledAt: audit.occurredAt }
                    : { dismissedAt: audit.occurredAt };
        const updated = await payloadRequest.payload.update({ collection, where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { recipientId: { equals: authorization.actorId } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }, { state: { in: expected } }] }, data: { state: destination, revision: expectedRevision + 1, audit: history, ...lifecycleTimestamp }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext(eventType, audit, "state") });
        if (updated.errors.length !== 0)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales delivery transition was rejected.");
        if (updated.docs.length !== 1)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales delivery transition lost its compare-and-swap fence.");
        return communicationOutput(output, { id, revision: expectedRevision + 1, status: destination });
    }
    const gateway = communicationGateway(authorizationContext);
    const provider = providerResult(await gateway.dispatch(Object.freeze({ actionId: "sales.integration.configure", idempotencyKey: eventId, relatedRecord: null, payload: Object.freeze({ providerId: parsed.data.providerId, expectedRevision: parsed.data.expectedRevision, operation: parsed.data.operation }) })), parsed.data.providerId);
    return communicationOutput(output, { providerId: provider.providerId, revision: Number(parsed.data.expectedRevision) + 1, status: "accepted" });
};
export const salesCommunicationActionDefinitions = Object.freeze(salesCommunicationActionDescriptors.map((descriptor) => ({ descriptor, inputSchema: salesCommunicationActionInputRuntimeSchemas[descriptor.id], outputSchema: salesCommunicationActionOutputRuntimeSchemas[descriptor.id] })));
const timelineTargetCollections = Object.freeze({
    "sales.account": "sales-accounts", "sales.contact": "sales-contacts", "sales.lead": "sales-leads", "sales.opportunity": "sales-opportunities", "sales.task": "sales-tasks"
});
function timelineText(value, field) {
    if (typeof value !== "string" || value.length < 1 || value.length > 256)
        throw new Error(`Sales timeline ${field} is invalid.`);
    return value;
}
function timelineEnum(value, allowed, field) {
    const parsed = timelineText(value, field);
    if (!allowed.includes(parsed))
        throw new Error(`Sales timeline ${field} is invalid.`);
    return parsed;
}
function timelineInstant(value, field) {
    const parsed = timelineText(value, field);
    if (!validAuditTimestamp(parsed))
        throw new Error(`Sales timeline ${field} is invalid.`);
    return parsed;
}
function timelineDate(value) {
    const parsed = timelineText(value, "due date");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(parsed) || new Date(`${parsed}T00:00:00.000Z`).toISOString().slice(0, 10) !== parsed)
        throw new Error("Sales timeline due date is invalid.");
    return parsed;
}
function timelineRevision(value) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("Sales timeline revision is invalid.");
    return value;
}
function salesNoteBody(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 10_000)
        throw new Error("Sales note body is invalid.");
    return value;
}
function salesNoteSummary(value) { return salesNoteBody(value).slice(0, 512); }
function timelineValues(selected, values, body, note = false) {
    return Object.freeze({ ...values, ...(selected.includes("body") ? { body: note ? { kind: "text", value: salesNoteSummary(body) } : null } : {}) });
}
/** Timeline records remain independently protected: denied record classes are omitted. */
async function timelineFind(find) {
    try {
        return await find();
    }
    catch (error) {
        if (error instanceof Error && error.message === "Current authority denied the Payload persistence operation.")
            return undefined;
        throw error;
    }
}
/** A related-record first check prevents a timeline row from widening the target's Sales scope. */
export const salesTimelineHandler = async (context) => {
    // Gateway has already converted external hyphenated input into this closed internal shape.
    const input = isRecord(context.input) && Object.keys(context.input).sort().join("\0") === "relatedRecordId\0relatedRecordType" &&
        isSalesRecordId(context.input.relatedRecordId) && typeof context.input.relatedRecordType === "string" && Object.hasOwn(timelineTargetCollections, context.input.relatedRecordType)
        ? { success: true, data: { relatedRecordType: context.input.relatedRecordType, relatedRecordId: context.input.relatedRecordId } }
        : salesTimelineInputRuntimeSchema.safeParse(context.input);
    if (!input.success)
        throw input.error;
    const selected = [...context.selectedFields];
    const allowed = new Set(salesTimelineFields.map(({ id }) => id));
    const required = salesTimelineFields.filter(({ binding }) => binding === "required").map(({ id }) => id);
    if (context.query.page === undefined || context.query.filters.length !== 0 || context.query.sort.length !== 0 || selected.length === 0 || new Set(selected).size !== selected.length || selected.some((field) => !allowed.has(field)) || required.some((field) => !selected.includes(field)))
        throw new Error("Sales timeline query is invalid.");
    const identity = sourceIdentity(context.request);
    const scope = scopeWhere(context.recordScope, identity, "sales.timeline");
    const offset = (context.query.page.number - 1) * context.query.page.size;
    const windowEnd = offset + context.query.page.size;
    if (!Number.isSafeInteger(windowEnd) || offset >= 100)
        throw new Error("Sales timeline page exceeds its bounded contract.");
    const effectiveEnd = Math.min(windowEnd, 100);
    const requested = Math.min(effectiveEnd + 1, 100);
    const request = salesRequest(context.request);
    const user = payloadUser(context.actor);
    let authorityType = input.data.relatedRecordType;
    let authorityId = input.data.relatedRecordId;
    const taskTarget = input.data.relatedRecordType === "sales.task";
    let directTargetAuthorized = false;
    if (authorityType === "sales.task") {
        const taskResult = await request.payload.find({ collection: "sales-tasks", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, relatedRecordType: true, relatedRecordId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { id: { equals: authorityId } }] }, ...(user === undefined ? {} : { user }), req: request });
        const task = taskResult.docs[0];
        if (taskResult.docs.length !== 1 || typeof task?.relatedRecordType !== "string" || !Object.hasOwn(timelineTargetCollections, task.relatedRecordType) || task.relatedRecordId === undefined || task.relatedRecordId === null)
            return { fields: [...context.selectedFields], rows: [], page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: false } };
        authorityType = task.relatedRecordType;
        try {
            authorityId = persistedWorkflowId(task.relatedRecordId, "task parent record ID");
        }
        catch {
            return { fields: [...context.selectedFields], rows: [], page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: false } };
        }
        const directTask = await request.payload.find({ collection: "sales-tasks", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true }, sort: ["id"], where: { and: [scope, { id: { equals: input.data.relatedRecordId } }] }, ...(user === undefined ? {} : { user }), req: request });
        directTargetAuthorized = directTask.docs.length === 1;
    }
    const targetResult = await request.payload.find({ collection: timelineTargetCollections[authorityType], depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true }, sort: ["id"], where: { and: [scope, { id: { equals: authorityId } }] }, ...(user === undefined ? {} : { user }), req: request });
    const activityTargetAuthorized = targetResult.docs.length === 1;
    if (!taskTarget)
        directTargetAuthorized = activityTargetAuthorized;
    if (!activityTargetAuthorized && !directTargetAuthorized)
        return { fields: [...context.selectedFields], rows: [], page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: false } };
    const relationship = [{ relatedRecordType: { equals: input.data.relatedRecordType } }, { relatedRecordId: { equals: input.data.relatedRecordId } }];
    const relatedWhere = { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, ...relationship] };
    const options = { depth: 0, overrideAccess: true, pagination: true, page: 1, limit: requested, where: relatedWhere, ...(user === undefined ? {} : { user }), req: request };
    const childWhere = (predicate) => ({ and: [...relatedWhere.and, predicate] });
    const [completedActivities, plannedActivities, notes, attachments, dueTasks, undatedTasks] = await Promise.all([
        activityTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-activities", sort: ["-occurredAt", "-id"], where: childWhere({ status: { equals: "completed" } }), select: { id: true, type: true, subject: true, status: true, occurredAt: true, scheduledAt: true, revision: true } })) : undefined,
        activityTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-activities", sort: ["-scheduledAt", "-id"], where: childWhere({ status: { in: ["scheduled", "cancelled"] } }), select: { id: true, type: true, subject: true, status: true, scheduledAt: true, revision: true } })) : undefined,
        directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-notes", sort: ["-occurredAt", "-id"], select: { id: true, status: true, occurredAt: true, revision: true, ...(selected.includes("body") ? { body: true } : {}) } })) : undefined,
        directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-attachment-references", sort: ["-createdAt", "-id"], select: { id: true, filename: true, status: true, createdAt: true, revision: true } })) : undefined,
        directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-tasks", sort: ["-dueDate", "-id"], where: childWhere({ dueDate: { exists: true } }), select: { id: true, title: true, status: true, dueDate: true, revision: true } })) : undefined,
        directTargetAuthorized ? timelineFind(() => request.payload.find({ ...options, collection: "sales-tasks", sort: ["-createdAt", "-id"], where: childWhere({ dueDate: { exists: false } }), select: { id: true, title: true, status: true, createdAt: true, revision: true } })) : undefined
    ]);
    const dated = (key, recordId, classRank, instant, values) => {
        const id = typeof recordId === "number" ? recordId : typeof recordId === "string" && isSalesRecordId(recordId) ? Number(recordId) : NaN;
        if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)
            throw new Error("Sales timeline record ID is invalid.");
        return { key, id, classRank, instant, values };
    };
    const entries = [
        ...(completedActivities?.docs ?? []).map((doc) => { const instant = timelineInstant(doc.occurredAt, "activity occurrence"); return dated(`activity:${String(doc.id)}`, doc.id, 0, instant, timelineValues(selected, { kind: { kind: "text", value: `activity:${timelineEnum(doc.type, ["call", "meeting", "email"], "activity type")}` }, subject: { kind: "text", value: timelineText(doc.subject, "activity subject") }, status: { kind: "status", value: timelineEnum(doc.status, ["completed"], "activity status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
        ...(plannedActivities?.docs ?? []).map((doc) => { const instant = timelineInstant(doc.scheduledAt, "activity schedule"); return dated(`activity:${String(doc.id)}`, doc.id, 1, instant, timelineValues(selected, { kind: { kind: "text", value: `activity:${timelineEnum(doc.type, ["call", "meeting", "email"], "activity type")}` }, subject: { kind: "text", value: timelineText(doc.subject, "activity subject") }, status: { kind: "status", value: timelineEnum(doc.status, ["scheduled", "cancelled"], "activity status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
        ...(notes?.docs ?? []).map((doc) => { const instant = timelineInstant(doc.occurredAt, "note occurrence"); return dated(`note:${String(doc.id)}`, doc.id, 2, instant, timelineValues(selected, { kind: { kind: "text", value: "note" }, subject: { kind: "text", value: "Note" }, status: { kind: "status", value: timelineEnum(doc.status, ["recorded"], "note status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } }, doc.body, true)); }),
        ...(attachments?.docs ?? []).map((doc) => { const instant = timelineInstant(doc.createdAt, "attachment creation"); return dated(`attachment:${String(doc.id)}`, doc.id, 3, instant, timelineValues(selected, { kind: { kind: "text", value: "attachment" }, subject: { kind: "text", value: timelineText(doc.filename, "attachment filename") }, status: { kind: "status", value: timelineEnum(doc.status, ["active", "removed"], "attachment status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
        ...(dueTasks?.docs ?? []).map((doc) => { const dueDate = timelineDate(doc.dueDate); return dated(`task:${String(doc.id)}`, doc.id, 4, `${dueDate}T00:00:00.000Z`, timelineValues(selected, { kind: { kind: "text", value: "task" }, subject: { kind: "text", value: timelineText(doc.title, "task title") }, status: { kind: "status", value: timelineEnum(doc.status, ["open", "completed", "cancelled"], "task status") }, "occurred-at": { kind: "text", value: dueDate }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); }),
        ...(undatedTasks?.docs ?? []).map((doc) => { const instant = timelineInstant(doc.createdAt, "task creation"); return dated(`task:${String(doc.id)}`, doc.id, 5, instant, timelineValues(selected, { kind: { kind: "text", value: "task" }, subject: { kind: "text", value: timelineText(doc.title, "task title") }, status: { kind: "status", value: timelineEnum(doc.status, ["open", "completed", "cancelled"], "task status") }, "occurred-at": { kind: "text", value: instant }, revision: { kind: "integer", value: timelineRevision(doc.revision) } })); })
    ].sort((left, right) => right.instant.localeCompare(left.instant) || left.classRank - right.classRank || right.id - left.id);
    const rows = entries.slice(offset, effectiveEnd).map(({ key, values }) => ({ key, values }));
    const classHasNext = [completedActivities, plannedActivities, notes, attachments, dueTasks, undatedTasks].some((result) => result?.hasNextPage === true);
    const withinWindow = effectiveEnd < 100;
    return { fields: [...context.selectedFields], rows, page: { number: context.query.page.number, pageSize: context.query.page.size, hasNext: withinWindow && (effectiveEnd < entries.length || classHasNext) } };
};
function invalidOutput(message) {
    return { success: false, error: new Error(message) };
}
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
export const salesAccountsDefinition = { descriptor: salesAccountsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesAccountsOutputRuntimeSchema };
export const salesAccountDetailDefinition = { descriptor: salesAccountDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesAccountDetailOutputRuntimeSchema };
export const salesContactsDefinition = { descriptor: salesContactsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesContactsOutputRuntimeSchema };
export const salesContactDetailDefinition = { descriptor: salesContactDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesContactDetailOutputRuntimeSchema };
export const salesLeadsDefinition = { descriptor: salesLeadsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesLeadsOutputRuntimeSchema };
export const salesLeadDetailDefinition = { descriptor: salesLeadDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesLeadDetailOutputRuntimeSchema };
export const salesOpportunityDetailDefinition = { descriptor: salesOpportunityDetailDescriptor, inputSchema: salesCrmDetailInputRuntimeSchema, outputSchema: salesOpportunityDetailOutputRuntimeSchema };
export const salesTimelineDefinition = { descriptor: salesTimelineDescriptor, inputSchema: salesTimelineInputRuntimeSchema, outputSchema: salesTimelineOutputRuntimeSchema };
const savedBindingRuntime = { safeParse(value) {
        try {
            const parsed = parseSalesSavedViewBindingInput(value);
            return { success: true, data: parsed.savedViewId === undefined ? {} : { "saved-view-id": parsed.savedViewId, "expected-revision": parsed.expectedRevision } };
        }
        catch (error) {
            return invalidOutput(error instanceof Error ? error.message : "Sales saved-view input is invalid.");
        }
    } };
const savedDetailInputRuntime = { safeParse(value) {
        if (!isRecord(value) || Object.keys(value).length > 1 || Object.keys(value).some((key) => key !== "saved-view-id") || value["saved-view-id"] !== undefined && !positiveExecutionRevision(value["saved-view-id"]))
            return invalidOutput("Sales saved-view detail input is invalid.");
        return { success: true, data: value };
    } };
function exactP134Cell(sourceId, field, cell) {
    if (cell === null)
        return field.nullable;
    if (!isRecord(cell) || cell.kind !== field.kind)
        return false;
    if (field.kind === "money")
        return exactKeys(cell, ["kind", "value", "currency", "scale"]) && typeof cell.value === "string" && decimalPattern.test(cell.value) && typeof cell.currency === "string" && /^[A-Z]{3}$/u.test(cell.currency) && Number.isSafeInteger(cell.scale) && cell.scale >= 0 && cell.scale <= 18;
    if (!exactKeys(cell, ["kind", "value"]))
        return false;
    if (field.kind === "integer")
        return Number.isSafeInteger(cell.value) && cell.value >= -2_147_483_648 && cell.value <= 2_147_483_647;
    if (["number", "percentage", "duration"].includes(field.kind))
        return typeof cell.value === "number" && Number.isFinite(cell.value);
    if (field.kind === "boolean")
        return typeof cell.value === "boolean";
    if (typeof cell.value !== "string")
        return false;
    if ((sourceId === salesPipelineSnapshotDescriptor.id && ["pipeline-name", "stage-name"].includes(field.id) || [salesSavedViewListDescriptor.id, salesSavedViewDetailDescriptor.id].includes(sourceId) && ["name", "team-id"].includes(field.id)) && !isSalesBoundedNfcText(cell.value))
        return false;
    if (field.kind === "date")
        return /^\d{4}-\d{2}-\d{2}$/u.test(cell.value) && !Number.isNaN(Date.parse(`${cell.value}T00:00:00.000Z`));
    if (field.kind === "datetime")
        return validAuditTimestamp(cell.value);
    return Buffer.byteLength(cell.value, "utf8") <= 16_384;
}
function exactP134RowIdentity(sourceId, row) {
    const scalar = (field) => isRecord(row.values[field]) ? row.values[field].value : undefined;
    if (sourceId === salesPipelineSnapshotDescriptor.id)
        return typeof scalar("stage-id") === "string" && row.key === `stage:${scalar("stage-id")}` && pipelineStageUuidPattern.test(scalar("stage-id"));
    if (sourceId === salesSavedViewListDescriptor.id)
        return Number.isSafeInteger(scalar("id")) && row.key === String(scalar("id"));
    if (sourceId === salesSavedViewDetailDescriptor.id)
        return Number.isSafeInteger(scalar("id")) && Number.isSafeInteger(scalar("chunk-index")) && row.key === `saved-view:${scalar("id")}:chunk:${scalar("chunk-index")}`;
    if (sourceId === salesSavedViewKanbanDescriptor.id)
        return scalar("row-kind") === "stage" ? typeof scalar("stage-id") === "string" && row.key === `stage:${scalar("stage-id")}` : scalar("row-kind") === "opportunity" && /^opportunity:[1-9][0-9]*$/u.test(row.key);
    return /^[1-9][0-9]*$/u.test(row.key);
}
const p134Output = (sourceId, fields) => ({ safeParse(value) {
        const parsed = TableRecordsSchema.safeParse(value);
        if (!parsed.success)
            return parsed;
        const declared = new Map(fields.map((field) => [field.id, field]));
        const required = fields.filter(({ binding }) => binding === "required").map(({ id }) => id);
        if (parsed.data.fields.some((id) => !declared.has(id)) || required.some((id) => !parsed.data.fields.includes(id)) || parsed.data.rows.some((row) => Object.keys(row.values).join("\0") !== parsed.data.fields.join("\0") || parsed.data.fields.some((id) => !exactP134Cell(sourceId, declared.get(id), row.values[id])) || !exactP134RowIdentity(sourceId, row)))
            return invalidOutput("Sales configuration source output is invalid.");
        if (sourceId === salesPipelineSnapshotDescriptor.id) {
            const scalar = (row, field) => {
                const cell = row.values[field];
                return isRecord(cell) ? cell.value : undefined;
            };
            if (parsed.data.rows.length !== 6 || parsed.data.page.number !== 1 || parsed.data.page.pageSize !== 6 || parsed.data.page.hasNext !== false)
                return invalidOutput("Sales pipeline snapshot is invalid.");
            const stageIds = parsed.data.rows.map((row) => scalar(row, "stage-id"));
            const semantics = parsed.data.rows.map((row) => scalar(row, "semantic"));
            const pipelineId = scalar(parsed.data.rows[0], "pipeline-id");
            const pipelineRevision = scalar(parsed.data.rows[0], "pipeline-revision");
            if (!positiveExecutionRevision(pipelineId) || !positiveExecutionRevision(pipelineRevision) || new Set(stageIds).size !== 6 || new Set(semantics.slice(0, 4)).size !== 4 || semantics.slice(0, 4).some((semantic) => !salesPipelineStageSemantics.slice(0, 4).includes(semantic)) || semantics[4] !== "won" || semantics[5] !== "lost")
                return invalidOutput("Sales pipeline snapshot is invalid.");
            for (const [index, row] of parsed.data.rows.entries()) {
                const semantic = semantics[index];
                let transitions;
                let requiredFields;
                try {
                    transitions = JSON.parse(String(scalar(row, "allowed-transition-stage-ids")));
                    requiredFields = JSON.parse(String(scalar(row, "required-field-ids")));
                }
                catch {
                    return invalidOutput("Sales pipeline snapshot is invalid.");
                }
                const expectedRequired = semantic === "lost" ? ["lossReason"] : [];
                if (!Array.isArray(transitions) || new Set(transitions).size !== transitions.length || transitions.some((target) => { const targetIndex = stageIds.indexOf(target); return targetIndex < 0 || !trustedStageTransitions[semantic].includes(semantics[targetIndex]); }) || scalar(row, "pipeline-id") !== pipelineId || scalar(row, "pipeline-revision") !== pipelineRevision || !positiveExecutionRevision(scalar(row, "stage-revision")) || scalar(row, "position") !== index || scalar(row, "status") !== "active" || !isSalesBoundedNfcText(String(scalar(row, "pipeline-name"))) || !isSalesBoundedNfcText(String(scalar(row, "stage-name"))) || !Number.isSafeInteger(scalar(row, "probability-basis-points")) || Number(scalar(row, "probability-basis-points")) < 0 || Number(scalar(row, "probability-basis-points")) > 10_000 || JSON.stringify(transitions) !== String(scalar(row, "allowed-transition-stage-ids")) || JSON.stringify(requiredFields) !== String(scalar(row, "required-field-ids")) || JSON.stringify(requiredFields) !== JSON.stringify(expectedRequired))
                    return invalidOutput("Sales pipeline snapshot is invalid.");
            }
        }
        if (sourceId === salesSavedViewKanbanDescriptor.id) {
            const scalar = (row, field) => {
                const cell = row.values[field];
                return isRecord(cell) ? cell.value : undefined;
            };
            const stages = parsed.data.rows.filter((row) => scalar(row, "row-kind") === "stage");
            const opportunities = parsed.data.rows.filter((row) => scalar(row, "row-kind") === "opportunity");
            const stageIds = new Set();
            const stageSemantics = [];
            let pipelineId;
            let pipelineRevision;
            if (stages.length !== 6 || parsed.data.rows.slice(0, 6).some((row) => scalar(row, "row-kind") !== "stage"))
                return invalidOutput("Sales Kanban snapshot is invalid.");
            for (const [index, row] of stages.entries()) {
                const stageId = scalar(row, "stage-id");
                const raw = scalar(row, "stage-metadata");
                if (typeof stageId !== "string" || typeof raw !== "string")
                    return invalidOutput("Sales Kanban snapshot is invalid.");
                let metadata;
                try {
                    metadata = JSON.parse(raw);
                }
                catch {
                    return invalidOutput("Sales Kanban snapshot is invalid.");
                }
                if (!isRecord(metadata) || Object.keys(metadata).join("\0") !== "pipelineId\0pipelineRevision\0stageName\0stageRevision\0stageSemantic" || JSON.stringify(metadata) !== raw || !positiveExecutionRevision(metadata.pipelineId) || !positiveExecutionRevision(metadata.pipelineRevision) || !positiveExecutionRevision(metadata.stageRevision) || metadata.stageName !== scalar(row, "name") || !isSalesBoundedNfcText(String(metadata.stageName)) || !salesPipelineStageSemantics.includes(metadata.stageSemantic) || stageIds.has(stageId))
                    return invalidOutput("Sales Kanban snapshot is invalid.");
                pipelineId ??= metadata.pipelineId;
                pipelineRevision ??= metadata.pipelineRevision;
                if (metadata.pipelineId !== pipelineId || metadata.pipelineRevision !== pipelineRevision)
                    return invalidOutput("Sales Kanban snapshot is invalid.");
                stageSemantics.push(metadata.stageSemantic);
                stageIds.add(stageId);
            }
            if (new Set(stageSemantics.slice(0, 4)).size !== 4 || stageSemantics.slice(0, 4).some((semantic) => !salesPipelineStageSemantics.slice(0, 4).includes(semantic)) || stageSemantics[4] !== "won" || stageSemantics[5] !== "lost")
                return invalidOutput("Sales Kanban snapshot is invalid.");
            if (opportunities.some((row) => !stageIds.has(String(scalar(row, "stage-id"))) || scalar(row, "stage-metadata") !== undefined && scalar(row, "stage-metadata") !== null))
                return invalidOutput("Sales Kanban snapshot is invalid.");
        }
        return parsed;
    } });
export const salesPipelineSnapshotOutputRuntimeSchema = p134Output(salesPipelineSnapshotDescriptor.id, salesPipelineSnapshotFields);
export const salesSavedViewListOutputRuntimeSchema = p134Output(salesSavedViewListDescriptor.id, salesSavedViewListFields);
export const salesSavedViewDetailOutputRuntimeSchema = p134Output(salesSavedViewDetailDescriptor.id, salesSavedViewDetailFields);
export const salesSavedViewTableOutputRuntimeSchema = p134Output(salesSavedViewTableDescriptor.id, salesSavedViewTableFields);
export const salesSavedViewKanbanOutputRuntimeSchema = p134Output(salesSavedViewKanbanDescriptor.id, salesSavedViewKanbanFields);
export const salesSavedViewCalendarOutputRuntimeSchema = p134Output(salesSavedViewCalendarDescriptor.id, salesSavedViewCalendarFields);
export const salesPipelineSnapshotDefinition = { descriptor: salesPipelineSnapshotDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesPipelineSnapshotOutputRuntimeSchema };
export const salesSavedViewListDefinition = { descriptor: salesSavedViewListDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesSavedViewListOutputRuntimeSchema };
export const salesSavedViewDetailDefinition = { descriptor: salesSavedViewDetailDescriptor, inputSchema: savedDetailInputRuntime, outputSchema: salesSavedViewDetailOutputRuntimeSchema };
export const salesSavedViewTableDefinition = { descriptor: salesSavedViewTableDescriptor, inputSchema: savedBindingRuntime, outputSchema: salesSavedViewTableOutputRuntimeSchema };
export const salesSavedViewKanbanDefinition = { descriptor: salesSavedViewKanbanDescriptor, inputSchema: savedBindingRuntime, outputSchema: salesSavedViewKanbanOutputRuntimeSchema };
export const salesSavedViewCalendarDefinition = { descriptor: salesSavedViewCalendarDescriptor, inputSchema: savedBindingRuntime, outputSchema: salesSavedViewCalendarOutputRuntimeSchema };
function p134Values(selected, raw, fields) {
    return Object.fromEntries(selected.map((fieldId) => { const field = fields.find(({ id }) => id === fieldId); const value = raw[fieldId]; return [fieldId, value === null || value === undefined && field.nullable ? null : { kind: field.kind, value }]; }));
}
function compactSourceStringArray(value) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales pipeline stage arrays are invalid.");
    return JSON.stringify(value);
}
export const salesPipelineSnapshotHandler = async (context) => {
    const request = salesRequest(context.request);
    const identity = sourceIdentity(context.request);
    const where = scopeWhere(context.recordScope, identity, "sales.pipelines");
    const pipelines = await request.payload.find({ ...requestOptions(context, { where: { and: [where, { status: { equals: "active" } }, { isActive: { equals: true } }] }, limit: 2, page: 1, select: { id: true, revision: true, name: true, orderedStageIds: true, status: true, isActive: true } }), collection: "sales-pipelines" });
    if (pipelines.docs.length !== 1)
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales requires exactly one active pipeline.");
    const pipeline = pipelines.docs[0];
    const stages = await request.payload.find({ ...requestOptions(context, { where: { and: [where, { pipelineId: { equals: pipeline.id } }, { status: { equals: "active" } }] }, limit: 7, page: 1, sort: ["position"] }), collection: "sales-pipeline-stages" });
    if (stages.docs.length !== 6 || !Array.isArray(pipeline.orderedStageIds))
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales pipeline snapshot is incomplete.");
    const stageRows = stages.docs;
    const pipelineId = Number(pipeline.id);
    const orderedStageIds = pipeline.orderedStageIds;
    try {
        if (pipeline.status !== "active" || pipeline.isActive !== true || stageRows.some((stage) => stage.status !== "active"))
            throw new TypeError();
        validateSalesPipelineSnapshotInput({ id: pipelineId, expectedRevision: pipeline.revision, name: pipeline.name, orderedStageIds, stages: stageRows.map((stage) => ({ stageId: stage.stageId, expectedRevision: stage.revision, semantic: stage.semantic, name: stage.name, position: stage.position, probabilityBasisPoints: stage.probabilityBasisPoints, allowedTransitionStageIds: stage.allowedTransitionStageIds, requiredFieldIds: stage.requiredFieldIds })) }, identity.applicationId, identity.environment, salesPipelineStageId);
    }
    catch {
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales pipeline snapshot is inconsistent.");
    }
    const rows = stageRows.map((stage) => ({ key: `stage:${String(stage.stageId)}`, values: p134Values(context.selectedFields, { "pipeline-id": pipeline.id, "pipeline-revision": pipeline.revision, "pipeline-name": pipeline.name, "stage-id": stage.stageId, "stage-revision": stage.revision, semantic: stage.semantic, "stage-name": stage.name, position: stage.position, "probability-basis-points": stage.probabilityBasisPoints, "allowed-transition-stage-ids": compactSourceStringArray(stage.allowedTransitionStageIds), "required-field-ids": compactSourceStringArray(stage.requiredFieldIds), status: stage.status }, salesPipelineSnapshotFields) }));
    return { fields: [...context.selectedFields], rows, page: { number: 1, pageSize: 6, hasNext: false } };
};
async function visibleSavedViews(context, oneId) {
    const request = salesRequest(context.request);
    const identity = sourceIdentity(context.request);
    const where = scopeWhere(context.recordScope, identity, "sales.saved-views");
    const page = context.query.page;
    if (oneId === undefined && page === undefined)
        throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales saved-view list requires offset pagination.");
    return await request.payload.find({ ...requestOptions(context, { where: { and: [where, ...(oneId === undefined ? [] : [{ id: { equals: oneId } }])] }, limit: oneId === undefined ? page.size : 2, page: oneId === undefined ? page.number : 1, ...(oneId === undefined ? { sort: ["visibility", "id"] } : {}) }), collection: "sales-saved-views" });
}
export const salesSavedViewListHandler = async (context) => {
    const page = context.query.page;
    if (page === undefined)
        throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales saved-view list requires offset pagination.");
    const found = await visibleSavedViews(context);
    const rows = found.docs.map((view) => ({ key: String(view.id), values: p134Values(context.selectedFields, { id: view.id, name: view.name, visibility: view.visibility, "team-id": view.visibilityTeamId ?? null, "target-object-id": view.targetObjectId, "view-kind": view.viewKind, revision: view.revision, status: view.status }, salesSavedViewListFields) }));
    return { fields: [...context.selectedFields], rows, page: { number: page.number, pageSize: page.size, hasNext: found.hasNextPage } };
};
export const salesSavedViewDetailHandler = async (context) => {
    const id = isRecord(context.input) ? context.input["saved-view-id"] : undefined;
    if (!positiveExecutionRevision(id))
        return { fields: [...context.selectedFields], rows: [], page: { number: 1, pageSize: 33, hasNext: false } };
    const found = await visibleSavedViews(context, id);
    if (found.docs.length !== 1)
        return { fields: [...context.selectedFields], rows: [], page: { number: 1, pageSize: 33, hasNext: false } };
    const view = found.docs[0];
    const definition = canonicalSalesSavedViewJson(view.definition);
    const chunks = [];
    let chunk = "";
    let bytes = 0;
    for (const scalar of definition) {
        const scalarBytes = Buffer.byteLength(scalar, "utf8");
        if (bytes + scalarBytes > 512) {
            chunks.push(chunk);
            chunk = "";
            bytes = 0;
        }
        chunk += scalar;
        bytes += scalarBytes;
    }
    chunks.push(chunk);
    if (chunks.length > 33 || chunks.some((value) => Buffer.byteLength(value, "utf8") > 512))
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales saved-view definition chunking exceeded its bound.");
    const rows = chunks.map((value, index) => ({ key: `saved-view:${id}:chunk:${index}`, values: p134Values(context.selectedFields, { id, name: view.name, visibility: view.visibility, "team-id": view.visibilityTeamId ?? null, "chunk-index": index, "chunk-count": chunks.length, "definition-chunk": value, "target-object-id": view.targetObjectId, "view-kind": view.viewKind, revision: view.revision, status: view.status }, salesSavedViewDetailFields) }));
    return { fields: [...context.selectedFields], rows, page: { number: 1, pageSize: 33, hasNext: false } };
};
const savedTargetSpecs = Object.freeze({
    "sales.object.account": { scope: "sales.accounts", collection: "sales-accounts", storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", status: "status", revision: "revision" } },
    "sales.object.contact": { scope: "sales.contacts", collection: "sales-contacts", storage: { "display-name": "displayName", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", status: "status", revision: "revision", email: "email", phone: "phone" } },
    "sales.object.lead": { scope: "sales.leads", collection: "sales-leads", storage: { "display-name": "displayName", source: "source", "owner-id": "ownerId", "team-id": "teamId", status: "status", "archive-status": "archiveStatus", revision: "revision", email: "email", phone: "phone" } },
    "sales.object.opportunity": { scope: "sales.opportunities", collection: "sales-opportunities", storage: { name: "name", "owner-id": "ownerId", "team-id": "teamId", "account-id": "accountId", "primary-contact-id": "primaryContactId", "pipeline-id": "pipelineId", "stage-id": "stageId", "expected-close-date": "expectedCloseDate", amount: "amount", "archive-status": "archiveStatus", revision: "revision" } },
    "sales.object.task": { scope: "sales.tasks", collection: "sales-tasks", storage: { title: "title", "owner-id": "ownerId", "team-id": "teamId", status: "status", "archive-status": "archiveStatus", "due-date": "dueDate", "related-record-type": "relatedRecordType", "related-record-id": "relatedRecordId", revision: "revision" } },
    "sales.object.activity": { scope: "sales.activities", collection: "sales-activities", storage: { type: "type", subject: "subject", "owner-id": "ownerId", "team-id": "teamId", status: "status", "scheduled-at": "scheduledAt", "occurred-at": "occurredAt", "related-record-type": "relatedRecordType", "related-record-id": "relatedRecordId", revision: "revision" } }
});
async function savedViewExecution(context, sourceId) {
    const binding = parseSalesSavedViewBindingInput(context.input);
    const request = salesRequest(context.request);
    const authority = request.salesSavedViewExecutionAuthority;
    const identity = sourceIdentity(context.request);
    if (binding.savedViewId === undefined || binding.expectedRevision === undefined || context.query.page === undefined)
        throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales saved-view execution requires an exact ephemeral binding and page.");
    const metadata = authority?.metadataScope;
    if (metadata === undefined || metadata.applicationId !== identity.applicationId || metadata.environment !== identity.environment || metadata.savedViewId !== binding.savedViewId || metadata.savedViewRevision !== binding.expectedRevision ||
        typeof metadata.ownerId !== "string" || metadata.ownerId.length < 1 || !isRecord(metadata.visibility) || metadata.visibility.kind !== "personal" && metadata.visibility.kind !== "team" || metadata.visibility.kind === "team" && (typeof metadata.visibility.teamId !== "string" || metadata.visibility.teamId.length < 1)) {
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved-view metadata authority is invalid.");
    }
    const user = payloadUser(context.actor);
    const visibility = metadata.visibility.kind === "personal"
        ? { and: [{ ownerId: { equals: metadata.ownerId } }, { visibility: { equals: "personal" } }] }
        : { and: [{ visibilityTeamId: { equals: metadata.visibility.teamId } }, { visibility: { equals: "team" } }] };
    const found = await request.payload.find({ collection: "sales-saved-views", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2,
        where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { id: { equals: binding.savedViewId } }, { revision: { equals: binding.expectedRevision } }, { status: { equals: "active" } }, visibility] },
        ...(user === undefined ? {} : { user }), req: request });
    if (found.docs.length !== 1)
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved view is unavailable.");
    const row = found.docs[0];
    const definition = row.definition;
    if (row.revision !== binding.expectedRevision || row.status !== "active")
        throw new DataSourceGatewayError("SOURCE_STALE", 409, "Sales saved view changed before execution.");
    const reportingTimezone = authority?.reportingTimezone;
    const compiled = compileSalesSavedViewDefinition(definition, sourceId, context.selectedFields, context.query.page.number, { ...(reportingTimezone === undefined ? {} : { reportingTimezone }) });
    if (canonicalJson(compiled.query) !== canonicalJson(context.query))
        throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales saved-view compiled query does not match its persisted definition.");
    const expectedMetadata = { applicationId: sourceIdentity(context.request).applicationId, environment: sourceIdentity(context.request).environment, savedViewId: binding.savedViewId, savedViewRevision: binding.expectedRevision, ownerId: row.ownerId, visibility: row.visibility === "team" ? { kind: "team", teamId: row.visibilityTeamId } : { kind: "personal" } };
    const selected = new Set(context.selectedFields);
    const filtered = new Set(context.query.filters.map(({ field }) => field));
    const sorted = new Set(context.query.sort.map(({ field }) => field));
    if (authority === undefined || canonicalJson(authority.metadataScope) !== canonicalJson(expectedMetadata) || canonicalJson(authority.targetRecordScope) !== canonicalJson(context.recordScope) || authority.fieldAuthority.length !== selected.size || authority.fieldAuthority.length !== new Set(authority.fieldAuthority.map(({ fieldId }) => fieldId)).size || authority.fieldAuthority.some((field) => !selected.has(field.fieldId) || !field.select || filtered.has(field.fieldId) && !field.filter || sorted.has(field.fieldId) && !field.sort))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved-view execution authority is invalid.");
    return Object.freeze({ definition: definition, binding });
}
function savedCell(field, value, currency) {
    if (field.kind === "money")
        return moneyCell(value, currency);
    if (value === null || value === undefined) {
        if (field.nullable)
            return null;
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, `Sales saved-view ${field.id} is absent.`);
    }
    if (field.kind === "integer") {
        const parsed = typeof value === "string" ? Number(value) : value;
        if (!Number.isSafeInteger(parsed))
            throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, `Sales saved-view ${field.id} is invalid.`);
        return { kind: field.kind, value: parsed };
    }
    if (field.kind === "number" || field.kind === "percentage" || field.kind === "duration") {
        if (typeof value !== "number" || !Number.isFinite(value))
            throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, `Sales saved-view ${field.id} is invalid.`);
        return { kind: field.kind, value };
    }
    if (typeof value !== "string")
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, `Sales saved-view ${field.id} is invalid.`);
    return { kind: field.kind, value };
}
function savedFilter(field, operator, value) {
    if (operator === "neq")
        return { [field]: { not_equals: value } };
    if (operator === "not-in")
        return { [field]: { not_in: value } };
    if (operator === "starts-with")
        return { [field]: { like: `${String(value)}%` } };
    if (operator === "is-null")
        return { [field]: { exists: false } };
    if (operator === "is-not-null")
        return { [field]: { exists: true } };
    return whereClause(field, operator, value);
}
async function savedViewRows(context, sourceId, fields) {
    const execution = await savedViewExecution(context, sourceId);
    const spec = savedTargetSpecs[execution.definition.targetObjectId];
    const identity = sourceIdentity(context.request);
    const targetScope = scopeWhere(context.recordScope, identity, spec.scope);
    const selected = [...context.selectedFields];
    const byId = new Map(fields.map((field) => [field.id, field]));
    if (selected.some((field) => !Object.hasOwn(spec.storage, field) && field !== "row-kind" && field !== "stage-metadata"))
        throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Sales saved-view field is unavailable for its target.");
    const request = salesRequest(context.request);
    const user = payloadUser(context.actor);
    const page = context.query.page;
    const kanban = sourceId === "sales.saved-view.kanban";
    let pipeline;
    let kanbanStages = [];
    if (kanban) {
        const pipelines = await request.payload.find({ collection: "sales-pipelines", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { status: { equals: "active" } }, { isActive: { equals: true } }] }, select: { id: true, revision: true, name: true, orderedStageIds: true, status: true, isActive: true }, ...(user === undefined ? {} : { user }), req: request });
        if (pipelines.docs.length !== 1)
            throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales saved Kanban requires one active pipeline.");
        pipeline = pipelines.docs[0];
        const stages = await request.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 7, sort: ["position"], where: { and: [{ applicationId: { equals: identity.applicationId } }, { environment: { equals: identity.environment } }, { pipelineId: { equals: pipeline.id } }, { status: { equals: "active" } }] }, select: { stageId: true, revision: true, name: true, semantic: true, position: true, probabilityBasisPoints: true, allowedTransitionStageIds: true, requiredFieldIds: true, status: true }, ...(user === undefined ? {} : { user }), req: request });
        kanbanStages = stages.docs;
        try {
            if (kanbanStages.length !== 6 || pipeline.status !== "active" || pipeline.isActive !== true || kanbanStages.some((stage) => stage.status !== "active"))
                throw new TypeError();
            validateSalesPipelineSnapshotInput({ id: pipeline.id, expectedRevision: pipeline.revision, name: pipeline.name, orderedStageIds: pipeline.orderedStageIds, stages: kanbanStages.map((stage) => ({ stageId: stage.stageId, expectedRevision: stage.revision, semantic: stage.semantic, name: stage.name, position: stage.position, probabilityBasisPoints: stage.probabilityBasisPoints, allowedTransitionStageIds: stage.allowedTransitionStageIds, requiredFieldIds: stage.requiredFieldIds })) }, identity.applicationId, identity.environment, salesPipelineStageId);
        }
        catch {
            throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales saved Kanban pipeline is incomplete.");
        }
    }
    const where = { and: [targetScope, ...(pipeline === undefined ? [] : [{ pipelineId: { equals: pipeline.id } }]), ...context.query.filters.map((filter) => { const storage = spec.storage[filter.field]; if (typeof storage !== "string")
                throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales saved-view filter is unavailable for its target."); return savedFilter(storage, filter.operator, filter.value); })] };
    const sort = [...context.query.sort.map((item) => { const storage = spec.storage[item.field]; if (typeof storage !== "string")
            throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Sales saved-view sort is unavailable for its target."); return item.direction === "desc" ? `-${storage}` : storage; }), "id"];
    const result = await request.payload.find({ collection: spec.collection, depth: 0, overrideAccess: true, pagination: true, page: page.number, limit: kanban ? page.size - 6 : page.size, select: { id: true, ...(kanban ? { stageId: true, pipelineId: true } : {}), ...(selected.includes("amount") ? { currency: true } : {}), ...Object.fromEntries(selected.flatMap((field) => { const storage = spec.storage[field]; return typeof storage === "string" ? [[storage, true]] : []; })) }, sort, where, ...(user === undefined ? {} : { user }), req: request });
    const stageIds = new Set(kanbanStages.map((stage) => String(stage.stageId)));
    if (kanban && result.docs.some((document) => String(document.pipelineId) !== String(pipeline.id) || !stageIds.has(String(document.stageId))))
        throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Sales saved Kanban opportunity is outside its pipeline snapshot.");
    const rows = result.docs.map((document) => ({ key: `${kanban ? "opportunity:" : ""}${String(document.id)}`, values: Object.fromEntries(selected.map((fieldId) => {
            const field = byId.get(fieldId);
            const raw = document;
            const value = fieldId === "row-kind" ? "opportunity" : fieldId === "stage-metadata" ? null : raw[spec.storage[fieldId]];
            return [fieldId, savedCell(field, value, raw.currency)];
        })) }));
    if (kanban) {
        const snapshotPipeline = pipeline;
        rows.unshift(...kanbanStages.map((stage) => ({ key: `stage:${String(stage.stageId)}`, values: Object.fromEntries(selected.map((fieldId) => {
                const field = byId.get(fieldId);
                const value = fieldId === "row-kind" ? "stage" : fieldId === "name" ? stage.name : fieldId === "stage-id" ? stage.stageId : fieldId === "stage-metadata" ? JSON.stringify({ pipelineId: snapshotPipeline.id, pipelineRevision: snapshotPipeline.revision, stageName: stage.name, stageRevision: stage.revision, stageSemantic: stage.semantic }) : null;
                return [fieldId, savedCell(field, value)];
            })) })));
    }
    return { fields: selected, rows, page: { number: page.number, pageSize: page.size, hasNext: result.hasNextPage ?? false } };
}
export const salesSavedViewTableHandler = async (context) => await savedViewRows(context, "sales.saved-view.table", salesSavedViewTableFields);
export const salesSavedViewKanbanHandler = async (context) => await savedViewRows(context, "sales.saved-view.kanban", salesSavedViewKanbanFields);
export const salesSavedViewCalendarHandler = async (context) => await savedViewRows(context, "sales.saved-view.calendar", salesSavedViewCalendarFields);
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
function writeAuthorization(value, actionId, resourceId) {
    const decision = isRecord(value) && isRecord(value.decision) ? value.decision : value;
    if (!isRecord(decision) || decision.actionId !== actionId || typeof decision.applicationId !== "string" || decision.applicationId.length === 0 ||
        typeof decision.environment !== "string" || decision.environment.length === 0 || typeof decision.actorId !== "string" || decision.actorId.length === 0 ||
        typeof decision.ownerId !== "string" || decision.ownerId.length === 0 || decision.teamId !== undefined && (typeof decision.teamId !== "string" || decision.teamId.length === 0) ||
        decision.authorizationRevision !== undefined && (typeof decision.authorizationRevision !== "number" || !Number.isSafeInteger(decision.authorizationRevision) || decision.authorizationRevision < 1) ||
        decision.lifecycleRevision !== undefined && (typeof decision.lifecycleRevision !== "number" || !Number.isSafeInteger(decision.lifecycleRevision) || decision.lifecycleRevision < 0) ||
        decision.salesScopeRevision !== undefined && (typeof decision.salesScopeRevision !== "number" || !Number.isSafeInteger(decision.salesScopeRevision) || decision.salesScopeRevision < 1) ||
        resourceId !== undefined && decision.resourceId !== resourceId || actionId !== "sales.lead.qualify" && Object.hasOwn(decision, "linkedRecordAdmissions") ||
        !["sales.email.send", "sales.calendar.sync", "sales.reminder.schedule"].includes(actionId) && Object.hasOwn(decision, "communicationRelationAdmission") ||
        !["sales.contact.create", "sales.contact.update", "sales.lead.create", "sales.lead.update", "sales.opportunity.create", "sales.opportunity.update"].includes(actionId) && Object.hasOwn(decision, "protectedFieldAdmissions") || actionId !== "sales.note.create" && Object.hasOwn(decision, "noteReplacementAdmission")) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales write authorization is invalid.");
    }
    return decision;
}
function workflowAuthorityFacts(authorization) {
    const authorizationRevision = authorization.authorizationRevision;
    const lifecycleRevision = authorization.lifecycleRevision;
    const scopeRevision = authorization.salesScopeRevision;
    if (typeof authorizationRevision !== "number" || !Number.isSafeInteger(authorizationRevision) || authorizationRevision < 1 ||
        typeof lifecycleRevision !== "number" || !Number.isSafeInteger(lifecycleRevision) || lifecycleRevision < 0 ||
        typeof scopeRevision !== "number" || !Number.isSafeInteger(scopeRevision) || scopeRevision < 1) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales workflow authority facts are unavailable.");
    }
    return Object.freeze({ authorizationRevision, lifecycleRevision, scopeRevision });
}
function workflowTrigger(input) {
    if (!actorIdPattern.test(input.acceptedOwnerId) || !actorIdPattern.test(input.recipientId) ||
        input.acceptedOwnerId.length > 160 || input.recipientId.length > 160 ||
        input.scheduledAt !== undefined && !validAuditTimestamp(input.scheduledAt)) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales workflow trigger facts are invalid.");
    }
    const facts = workflowAuthorityFacts(input.authorization);
    return Object.freeze({
        type: input.type, workflowId: input.workflowId, workflowVersion: 1, effectKind: input.effectKind,
        acceptedOwnerId: input.acceptedOwnerId, recipientId: input.recipientId,
        ...facts, ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt })
    });
}
function qualificationAdmissions(authorization, input) {
    const expected = [
        ...(input.accountMode === "link" ? [{ recordType: "sales.account", recordId: workflowId(input.accountId, "account ID"), applicationId: authorization.applicationId, environment: authorization.environment }] : []),
        ...(input.contactMode === "link" ? [{ recordType: "sales.contact", recordId: workflowId(input.contactId, "contact ID"), applicationId: authorization.applicationId, environment: authorization.environment }] : [])
    ];
    const actual = authorization.linkedRecordAdmissions;
    if (expected.length === 0 ? actual !== undefined : !Array.isArray(actual) || actual.length !== expected.length)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked-record admission is invalid.");
    for (let index = 0; index < expected.length; index += 1) {
        const admission = actual?.[index];
        const target = expected[index];
        if (!isRecord(admission) || Object.keys(admission).sort().join("\0") !== "applicationId\0environment\0recordId\0recordType" ||
            admission.recordType !== target.recordType || admission.recordId !== target.recordId || admission.applicationId !== target.applicationId || admission.environment !== target.environment) {
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked-record admission is invalid.");
        }
    }
}
function ownershipAdmission(authorization, input) {
    const clearsTeam = input.teamId === undefined;
    if (authorization.ownershipNewOwnerId !== input.ownerId || authorization.ownershipTeamCleared !== clearsTeam ||
        (clearsTeam ? authorization.ownershipNewTeamId !== undefined : authorization.ownershipNewTeamId !== input.teamId)) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership admission is invalid.");
    }
}
function idempotencyReplay(authorization, schema) {
    if (!Object.hasOwn(authorization, "idempotencyReplay"))
        return undefined;
    const parsed = schema.safeParse(authorization.idempotencyReplay);
    if (!parsed.success)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales idempotency replay is invalid.");
    return parsed.data;
}
function durableActionEventId(authorization, idempotencyKey) {
    const eventId = authorization.eventId ?? idempotencyKey;
    if (eventId === undefined || !/^[a-z][a-z0-9-]{2,127}$/u.test(eventId)) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action event identity is invalid.");
    }
    return eventId;
}
const maxAuditEntries = 100;
const maxAuditEntryBytes = 4_096;
const maxAuditBytes = 262_144;
const applicationIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const environmentPattern = /^[a-z][a-z0-9-]*$/u;
const actorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const durableIdPattern = /^[a-z][a-z0-9-]{2,127}$/u;
function validAuditTimestamp(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function exactKeys(value, keys) {
    return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function ownershipSnapshot(value) {
    if (!isRecord(value) || !exactKeys(value, ["ownerId", "teamId"]) || typeof value.ownerId !== "string" || value.ownerId.length > 160 || !actorIdPattern.test(value.ownerId) ||
        value.teamId !== null && (typeof value.teamId !== "string" || value.teamId.length > 160 || !actorIdPattern.test(value.teamId)))
        return undefined;
    return Object.freeze({ ownerId: value.ownerId, teamId: value.teamId });
}
function withOwnershipGenesis(entry, ownerId, teamId) {
    const genesis = ownershipSnapshot({ ownerId, teamId });
    if (genesis === undefined)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership genesis is invalid.");
    return Object.freeze({ ...entry, ownershipGenesis: genesis });
}
function boundedAuditArray(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > maxAuditEntries)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
    try {
        if (Buffer.byteLength(canonicalJson(value)) > maxAuditBytes || value.some((entry) => Buffer.byteLength(canonicalJson(entry)) > maxAuditEntryBytes)) {
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history exceeds its bounded contract.");
        }
    }
    catch (error) {
        if (error instanceof ActionGatewayError)
            throw error;
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
    }
    return value;
}
function auditCollection(actionId) {
    return actionId === salesTaskCreateDescriptor.id || actionId === salesTaskUpdateDescriptor.id ? "sales-tasks"
        : actionId === salesOpportunityStageUpdateDescriptor.id ? "sales-opportunities" : undefined;
}
function validActionAudit(entry) {
    if (!exactKeys(entry, ["actionId", "resourceId", "applicationId", "environment", "fromState", "toState", "occurredAt", "actorId", "revision", "idempotencyKey"]) ||
        typeof entry.actionId !== "string" || typeof entry.resourceId !== "string" || typeof entry.applicationId !== "string" || typeof entry.environment !== "string" ||
        typeof entry.fromState !== "string" || typeof entry.toState !== "string" || typeof entry.occurredAt !== "string" || typeof entry.actorId !== "string" || typeof entry.idempotencyKey !== "string" || typeof entry.revision !== "number" ||
        !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision > 1_000_000_000 || !validAuditTimestamp(entry.occurredAt) ||
        !isSalesRecordId(entry.resourceId) || entry.applicationId.length > 128 || !applicationIdPattern.test(entry.applicationId) ||
        entry.environment.length > 64 || !environmentPattern.test(entry.environment) || entry.actorId.length > 160 || !actorIdPattern.test(entry.actorId) || !durableIdPattern.test(entry.idempotencyKey))
        return false;
    return entry.actionId === salesTaskCreateDescriptor.id ? entry.revision === 1 && entry.fromState === "absent" && entry.toState === "open"
        : entry.actionId === salesTaskUpdateDescriptor.id ? entry.fromState === "open" && ["completed", "cancelled"].includes(entry.toState)
            : entry.actionId === salesOpportunityStageUpdateDescriptor.id ? pipelineStageUuidPattern.test(entry.fromState) && pipelineStageUuidPattern.test(entry.toState) && entry.fromState !== entry.toState
                : false;
}
function validMigrationAudit(entry, collection) {
    const genesisKey = entry.ownershipGenesis === undefined ? [] : ["ownershipGenesis"];
    return entry.kind === "phase-13-legacy-upgrade" && typeof entry.receiptDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(entry.receiptDigest) &&
        (entry.ownershipGenesis === undefined || ownershipSnapshot(entry.ownershipGenesis) !== undefined) &&
        (collection === "sales-tasks" ? exactKeys(entry, ["kind", "receiptDigest", ...genesisKey])
            : exactKeys(entry, ["kind", "receiptDigest", "legacyStage", ...genesisKey]) && typeof entry.legacyStage === "string" && entry.legacyStage.length > 0 && entry.legacyStage.length <= 64);
}
function migrationState(entry, collection) {
    if (!validMigrationAudit(entry, collection))
        return undefined;
    if (collection === "sales-tasks")
        return "open";
    return { lead: "qualification", qualified: "discovery", won: "won", lost: "lost" }[entry.legacyStage];
}
function validatedAuditHistory(value, collection, identity) {
    const bounded = boundedAuditArray(value);
    let migrationSeen = false;
    let migration;
    let priorAction;
    const actionIdempotencyKeys = new Set();
    for (const [index, entry] of bounded.entries()) {
        if (!isRecord(entry) || !(validMigrationAudit(entry, collection) || validActionAudit(entry))) {
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
        }
        if (validMigrationAudit(entry, collection)) {
            if (index !== 0 || migrationSeen)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
            migrationSeen = true;
            migration = entry;
        }
        else {
            const action = validActionAudit(entry) ? entry : undefined;
            const expectedRevision = priorAction === undefined ? migrationSeen ? 2 : 1 : priorAction.revision + 1;
            if (action === undefined || auditCollection(action.actionId) !== collection || actionIdempotencyKeys.has(action.idempotencyKey) ||
                action.revision !== expectedRevision || priorAction === undefined && !migrationSeen && !(collection === "sales-tasks" && action.actionId === salesTaskCreateDescriptor.id) ||
                priorAction === undefined && migration !== undefined && action.fromState !== migrationState(migration, collection) ||
                priorAction !== undefined && (action.fromState !== priorAction.toState || action.resourceId !== priorAction.resourceId || action.applicationId !== priorAction.applicationId || action.environment !== priorAction.environment) ||
                identity !== undefined && (action.resourceId !== identity.resourceId || action.applicationId !== identity.applicationId || action.environment !== identity.environment || action.revision > identity.revision)) {
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
            }
            actionIdempotencyKeys.add(action.idempotencyKey);
            priorAction = action;
        }
    }
    return bounded;
}
function auditEntry(authorization, actionId, resourceId, revision, fromState, toState, idempotencyKey, occurredAt = new Date().toISOString()) {
    if (idempotencyKey === undefined || !durableIdPattern.test(idempotencyKey) || !validAuditTimestamp(occurredAt) || !isSalesRecordId(resourceId) ||
        fromState.length === 0 || toState.length === 0 || !Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000_000 ||
        authorization.applicationId.length > 128 || !applicationIdPattern.test(authorization.applicationId) || authorization.environment.length > 64 || !environmentPattern.test(authorization.environment) ||
        authorization.actorId.length > 160 || !actorIdPattern.test(authorization.actorId)) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales audit evidence is invalid.");
    }
    return Object.freeze({ actionId, resourceId, applicationId: authorization.applicationId, environment: authorization.environment,
        fromState, toState, occurredAt, actorId: authorization.actorId, revision, idempotencyKey });
}
function appendAudit(history, entry) {
    const collection = auditCollection(entry.actionId);
    if (collection === undefined)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
    const validated = validatedAuditHistory(history, collection);
    if (validated.length >= maxAuditEntries || validated.some((prior) => prior.idempotencyKey === entry.idempotencyKey)) {
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history cannot append this action.");
    }
    const appended = Object.freeze([...validated, entry]);
    validatedAuditHistory(appended, collection);
    return appended;
}
function mutationWhere(authorization, id, expectedRevision, state) {
    return { and: [
            { id: { equals: id } },
            { applicationId: { equals: authorization.applicationId } },
            { environment: { equals: authorization.environment } },
            { ownerId: { equals: authorization.ownerId } },
            ...(authorization.teamId === undefined ? [] : [{ teamId: { equals: authorization.teamId } }]),
            ...(state === undefined ? [] : [{ [state.field]: { equals: state.value } }]),
            { revision: { equals: expectedRevision } }
        ] };
}
async function auditForMutation(request, collection, where, user, expectedState) {
    const result = await request.payload.find({
        collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1,
        select: { id: true, revision: true, audit: true }, sort: ["id"], where,
        ...(user === undefined ? {} : { user }), req: request
    });
    if (result.docs.length !== 1) {
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record changed before the update.");
    }
    const document = result.docs[0];
    const revision = document.revision;
    if (!Number.isSafeInteger(revision))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record revision is invalid.");
    const currentRevision = revision;
    if (currentRevision < 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record revision is invalid.");
    const history = validatedAuditHistory(document.audit, collection, {
        resourceId: String(document.id), applicationId: String(where.and?.[1] && where.and[1]?.applicationId?.equals),
        environment: String(where.and?.[2] && where.and[2]?.environment?.equals), revision: currentRevision
    });
    const lastAction = history.findLast(validActionAudit);
    const migrationOrigin = lastAction === undefined && history.length === 1 && isRecord(history[0]) && validMigrationAudit(history[0], collection) && currentRevision === 1;
    if (lastAction !== undefined ? lastAction.revision !== currentRevision || lastAction.toState !== expectedState : !migrationOrigin || migrationState(history[0], collection) !== expectedState) {
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is not current.");
    }
    return history;
}
export const salesTaskCreateHandler = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const parsed = salesCreateTaskInputRuntimeSchema.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const payloadRequest = createTaskRequest(request);
    const user = payloadUser(actor);
    const authorization = writeAuthorization(authorizationContext, salesTaskCreateDescriptor.id);
    const replay = idempotencyReplay(authorization, salesCreateTaskOutputRuntimeSchema);
    if (replay !== undefined)
        return replay;
    const eventId = durableActionEventId(authorization, idempotencyKey);
    const occurredAt = new Date().toISOString();
    const created = await payloadRequest.payload.create({
        collection: "sales-tasks",
        data: {
            title: parsed.data.title,
            status: "open",
            applicationId: authorization.applicationId,
            environment: authorization.environment,
            ownerId: authorization.actorId,
            ...(authorization.teamId === undefined ? {} : { teamId: authorization.teamId }),
            createdBy: authorization.actorId,
            updatedBy: authorization.actorId,
            revision: 1,
            audit: [],
            archiveStatus: "active"
        },
        depth: 0,
        overrideAccess: true,
        ...(user === undefined ? {} : { user }),
        req: payloadRequest,
        context: Object.freeze({})
    });
    if (signal.aborted)
        throw signal.reason;
    if (created.id === undefined || created.id === null || typeof created.title !== "string" ||
        created.title.length < 1 || created.title.length > 256 ||
        !["open", "completed", "cancelled"].includes(created.status) || created.revision !== 1) {
        throw new Error("Sales task creation returned an invalid task.");
    }
    const resourceId = String(created.id);
    const transition = auditEntry(authorization, salesTaskCreateDescriptor.id, resourceId, 1, "absent", "open", eventId, occurredAt);
    const finalized = await payloadRequest.payload.update({
        collection: "sales-tasks", id: resourceId,
        data: { audit: [transition] }, depth: 0, overrideAccess: true,
        ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext("sales.event.task-changed", transition)
    });
    if (String(finalized.id) !== resourceId || finalized.status !== "open" || finalized.revision !== 1) {
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales task changed before audit finalization.");
    }
    return { id: resourceId, title: created.title, status: created.status, revision: created.revision };
};
export const salesTaskUpdateHandler = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const parsed = salesUpdateTaskInputRuntimeSchema.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const payloadRequest = updateRequest(request);
    const user = payloadUser(actor);
    const authorization = writeAuthorization(authorizationContext, salesTaskUpdateDescriptor.id, parsed.data.id);
    const replay = idempotencyReplay(authorization, salesUpdateTaskOutputRuntimeSchema);
    if (replay !== undefined)
        return replay;
    const eventId = durableActionEventId(authorization, idempotencyKey);
    const revision = parsed.data.expectedRevision + 1;
    const where = mutationWhere(authorization, parsed.data.id, parsed.data.expectedRevision, { field: "status", value: parsed.data.expectedStatus });
    const audit = await auditForMutation(payloadRequest, "sales-tasks", where, user, parsed.data.expectedStatus);
    const transition = auditEntry(authorization, salesTaskUpdateDescriptor.id, parsed.data.id, revision, parsed.data.expectedStatus, parsed.data.status, eventId);
    const update = await payloadRequest.payload.update({
        collection: "sales-tasks",
        where,
        data: { status: parsed.data.status, updatedBy: authorization.actorId, revision, audit: appendAudit(audit, transition) },
        depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest,
        context: eventContext("sales.event.task-changed", transition)
    });
    if (update.errors.length > 0 || update.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales task changed before the update.");
    const updated = update.docs[0];
    const result = { id: String(updated.id), title: updated.title, status: updated.status, revision: updated.revision };
    const validated = salesUpdateTaskOutputRuntimeSchema.safeParse(result);
    if (!validated.success)
        throw validated.error;
    return validated.data;
};
export const salesOpportunityStageUpdateHandler = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const parsed = salesOpportunityStageInputRuntimeSchema.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const payloadRequest = updateRequest(request);
    const user = payloadUser(actor);
    const authorization = writeAuthorization(authorizationContext, salesOpportunityStageUpdateDescriptor.id, parsed.data.id);
    const replay = idempotencyReplay(authorization, salesOpportunityStageOutputRuntimeSchema);
    if (replay !== undefined)
        return replay;
    const eventId = durableActionEventId(authorization, idempotencyKey);
    const revision = parsed.data.expectedRevision + 1;
    const current = await workflowCurrent(payloadRequest, authorization, "sales-opportunities", parsed.data.id, parsed.data.expectedRevision, "stageId", user);
    const identityWhere = { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }] };
    const [pipeline, sourceStage, destinationStage] = await Promise.all([
        payloadRequest.payload.find({ collection: "sales-pipelines", where: { and: [...identityWhere.and, { id: { equals: parsed.data.expectedPipelineId } }, { revision: { equals: parsed.data.expectedPipelineRevision } }, { status: { equals: "active" } }, { isActive: { equals: true } }] }, limit: 2, pagination: true, depth: 0, overrideAccess: true }),
        payloadRequest.payload.find({ collection: "sales-pipeline-stages", where: { and: [...identityWhere.and, { pipelineId: { equals: parsed.data.expectedPipelineId } }, { stageId: { equals: parsed.data.expectedSourceStageId } }, { revision: { equals: parsed.data.expectedSourceStageRevision } }, { status: { equals: "active" } }] }, limit: 2, pagination: true, depth: 0, overrideAccess: true }),
        payloadRequest.payload.find({ collection: "sales-pipeline-stages", where: { and: [...identityWhere.and, { pipelineId: { equals: parsed.data.expectedPipelineId } }, { stageId: { equals: parsed.data.destinationStageId } }, { revision: { equals: parsed.data.expectedDestinationStageRevision } }, { status: { equals: "active" } }] }, limit: 2, pagination: true, depth: 0, overrideAccess: true })
    ]);
    const source = sourceStage.docs[0];
    const destination = destinationStage.docs[0];
    if (current.document.archiveStatus !== "active" || String(current.document.pipelineId) !== parsed.data.expectedPipelineId || current.state !== parsed.data.expectedSourceStageId || pipeline.docs.length !== 1 || sourceStage.docs.length !== 1 || destinationStage.docs.length !== 1 ||
        !trustedPipelineTransition(source, destination, authorization.applicationId, authorization.environment, Number(parsed.data.expectedPipelineId), parsed.data.destinationStageId) || ["won", "lost"].includes(String(destination?.semantic)))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity or pipeline changed before the stage update.");
    const transition = auditEntry(authorization, salesOpportunityStageUpdateDescriptor.id, parsed.data.id, revision, parsed.data.expectedSourceStageId, parsed.data.destinationStageId, eventId);
    const update = await payloadRequest.payload.update({
        collection: "sales-opportunities",
        where: current.where,
        data: { stageId: parsed.data.destinationStageId, updatedBy: authorization.actorId, revision, audit: appendWorkflowAudit(current.audit, transition, "sales-opportunities", parsed.data.destinationStageId, "stageId", current.document.ownerId, typeof current.document.teamId === "string" ? current.document.teamId : null) }, depth: 0, overrideAccess: true,
        ...(user === undefined ? {} : { user }), req: payloadRequest,
        context: eventContext("sales.event.opportunity-changed", transition, "stageId", source?.semantic === "discovery" && destination?.semantic === "proposal" ? workflowTrigger({
            type: "sales.event.workflow.opportunity-proposal-entered", workflowId: "sales.workflow.opportunity-proposal-follow-up", effectKind: "create-owner-follow-up-task",
            acceptedOwnerId: String(current.document.ownerId), recipientId: String(current.document.ownerId), authorization
        }) : undefined)
    });
    if (update.errors.length > 0 || update.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity changed before the stage update.");
    const [pipelineFence, sourceFence, destinationFence] = await Promise.all([
        payloadRequest.payload.find({ collection: "sales-pipelines", where: { and: [...identityWhere.and, { id: { equals: parsed.data.expectedPipelineId } }, { revision: { equals: parsed.data.expectedPipelineRevision } }, { status: { equals: "active" } }, { isActive: { equals: true } }] }, limit: 2, pagination: true, depth: 0, overrideAccess: true }),
        payloadRequest.payload.find({ collection: "sales-pipeline-stages", where: { and: [...identityWhere.and, { pipelineId: { equals: parsed.data.expectedPipelineId } }, { stageId: { equals: parsed.data.expectedSourceStageId } }, { revision: { equals: parsed.data.expectedSourceStageRevision } }, { status: { equals: "active" } }] }, limit: 2, pagination: true, depth: 0, overrideAccess: true }),
        payloadRequest.payload.find({ collection: "sales-pipeline-stages", where: { and: [...identityWhere.and, { pipelineId: { equals: parsed.data.expectedPipelineId } }, { stageId: { equals: parsed.data.destinationStageId } }, { revision: { equals: parsed.data.expectedDestinationStageRevision } }, { status: { equals: "active" } }] }, limit: 2, pagination: true, depth: 0, overrideAccess: true })
    ]);
    if (pipelineFence.docs.length !== 1 || sourceFence.docs.length !== 1 || destinationFence.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed during the stage update.");
    const updated = update.docs[0];
    const result = { id: String(updated.id), pipelineId: parsed.data.expectedPipelineId, stageId: updated.stageId, revision: updated.revision };
    const validated = salesOpportunityStageOutputRuntimeSchema.safeParse(result);
    if (!validated.success)
        throw validated.error;
    return validated.data;
};
const workflowActions = Object.freeze({
    "sales.account.create": { collection: "sales-accounts", event: "sales.event.account-changed", stateField: "status", state: "active" },
    "sales.account.update": { collection: "sales-accounts", event: "sales.event.account-changed", stateField: "status" },
    "sales.account.archive": { collection: "sales-accounts", event: "sales.event.account-changed", stateField: "status", state: "archived" },
    "sales.contact.create": { collection: "sales-contacts", event: "sales.event.contact-changed", stateField: "status", state: "active" },
    "sales.contact.update": { collection: "sales-contacts", event: "sales.event.contact-changed", stateField: "status" },
    "sales.contact.archive": { collection: "sales-contacts", event: "sales.event.contact-changed", stateField: "status", state: "archived" },
    "sales.lead.create": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status", state: "new" },
    "sales.lead.update": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status" },
    "sales.lead.qualify": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status", state: "qualified" },
    "sales.lead.disqualify": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "status", state: "disqualified" },
    "sales.lead.archive": { collection: "sales-leads", event: "sales.event.lead-changed", stateField: "archiveStatus", state: "archived" },
    "sales.opportunity.create": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "stageId" },
    "sales.opportunity.update": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "stageId" },
    "sales.opportunity.close": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "stageId" },
    "sales.opportunity.archive": { collection: "sales-opportunities", event: "sales.event.opportunity-changed", stateField: "archiveStatus", state: "archived" },
    "sales.activity.create": { collection: "sales-activities", event: "sales.event.timeline-changed", stateField: "status", state: "scheduled" },
    "sales.activity.complete": { collection: "sales-activities", event: "sales.event.timeline-changed", stateField: "status", state: "completed" },
    "sales.activity.cancel": { collection: "sales-activities", event: "sales.event.timeline-changed", stateField: "status", state: "cancelled" },
    "sales.note.create": { collection: "sales-notes", event: "sales.event.timeline-changed", stateField: "status", state: "recorded" },
    "sales.attachment.link": { collection: "sales-attachment-references", event: "sales.event.timeline-changed", stateField: "status", state: "active" },
    "sales.attachment.remove": { collection: "sales-attachment-references", event: "sales.event.timeline-changed", stateField: "status", state: "removed" }
});
function isWorkflowActionId(value) { return Object.hasOwn(workflowActions, value); }
function workflowText(value, name) {
    if (typeof value !== "string" || value.length === 0 || value.length > 256)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
    return value;
}
function workflowMediaType(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 128)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales media type is invalid.");
    return value;
}
function workflowPhone(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > salesPhoneMaxLength)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales phone is invalid.");
    return value;
}
function workflowCalendarDate(value) {
    if (!isSalesCalendarDate(value))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales expected close date is invalid.");
    return value;
}
function workflowOpportunityMoney(value) {
    if (!isRecord(value) || Object.keys(value).sort().join("\0") !== "currency\0kind\0scale\0value" || value.kind !== "money" || typeof value.value !== "string" || !/^-?(0|[1-9][0-9]*)(?:[.][0-9]+)?$/u.test(value.value) || typeof value.currency !== "string" || !/^[A-Z]{3}$/u.test(value.currency) || !Number.isSafeInteger(value.scale) || value.scale < 0 || value.scale > 18 || value.value.startsWith("-") && Number(value.value) === 0)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity amount is invalid.");
    const fraction = value.value.split(".")[1] ?? "";
    if (fraction.length > value.scale)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity amount scale is invalid.");
    const amount = `${value.value}${fraction.length === 0 && value.scale > 0 ? "." : ""}${"0".repeat(value.scale - fraction.length)}`;
    if (amount.length > 128)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity amount is too large.");
    return Object.freeze({ amount, currency: value.currency });
}
function protectedFieldAdmissions(authorization, actionId, input) {
    const permissionId = actionId.startsWith("sales.contact.") ? "sales.contacts.channels.read" : actionId.startsWith("sales.lead.") ? "sales.leads.channels.read" : "sales.opportunities.amount.read";
    const fields = actionId.startsWith("sales.contact.") || actionId.startsWith("sales.lead.") ? ["email", "phone"] : ["amount"];
    const expected = fields.filter((fieldId) => fieldId === "amount" ? actionId === "sales.opportunity.create" ? input.amount !== undefined : input.amountMode !== "retain" : actionId.endsWith(".update") ? input[`${fieldId}Mode`] !== "retain" : input[fieldId] !== undefined).map((fieldId) => ({ fieldId, permissionId }));
    const actual = authorization.protectedFieldAdmissions;
    if (expected.length === 0 ? actual !== undefined : !Array.isArray(actual) || actual.length !== expected.length)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales protected-field admission is invalid.");
    for (let index = 0; index < expected.length; index += 1) {
        const admission = actual?.[index];
        const target = expected[index];
        if (!isRecord(admission) || Object.keys(admission).sort().join("\0") !== "fieldId\0permissionId" || admission.fieldId !== target.fieldId || admission.permissionId !== target.permissionId)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales protected-field admission is invalid.");
    }
}
function workflowTimestamp(value, name) {
    const timestamp = workflowText(value, name);
    if (!validAuditTimestamp(timestamp))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
    return timestamp;
}
function workflowId(value, name) {
    const id = workflowText(value, name);
    if (!isSalesRecordId(id))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
    return id;
}
function persistedWorkflowId(value, name) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647)
        return String(value);
    if (typeof value === "string" && isSalesRecordId(value))
        return value;
    throw new ActionGatewayError("STALE_RECORD", 409, `Sales persisted ${name} is invalid.`);
}
function workflowRevision(value) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales expected revision is invalid.");
    return value;
}
async function attachmentUploadAdmission(authorization, input, signal) {
    if (typeof authorization.resolveAttachmentUpload !== "function")
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment storage authority is unavailable.");
    const storageRef = workflowText(input.storageReference, "storage reference");
    let timer;
    let abortListener;
    try {
        const aborted = new Promise((_, reject) => {
            abortListener = () => reject(signal.reason);
            signal.addEventListener("abort", abortListener, { once: true });
        });
        const receipt = await Promise.race([
            authorization.resolveAttachmentUpload({ applicationId: authorization.applicationId, environmentId: authorization.environment, actorId: authorization.actorId, storageRef }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment storage authority timed out.")), 5_000); }),
            aborted
        ]);
        if (!isRecord(receipt) || !exactKeys(receipt, ["storageRef", "applicationId", "environmentId", "uploaderActorId", "filename", "mediaType", "byteSize", "state", "revision"]) ||
            receipt.storageRef !== storageRef || receipt.applicationId !== authorization.applicationId || receipt.environmentId !== authorization.environment || receipt.uploaderActorId !== authorization.actorId || receipt.state !== "ready" ||
            typeof receipt.filename !== "string" || receipt.filename.length === 0 || receipt.filename.length > 256 || typeof receipt.mediaType !== "string" || receipt.mediaType.length === 0 || receipt.mediaType.length > 128 ||
            !Number.isSafeInteger(receipt.byteSize) || receipt.byteSize < 0 || receipt.byteSize > 1_073_741_824 || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || receipt.revision > 1_000_000_000 ||
            input.filename !== receipt.filename || input.mediaType !== receipt.mediaType || input.byteSize !== receipt.byteSize)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment upload admission is invalid.");
        return receipt;
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        if (abortListener !== undefined)
            signal.removeEventListener("abort", abortListener);
    }
}
function exactWorkflowInput(actionId, value) {
    if (!isRecord(value))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action input is invalid.");
    const allowed = {
        "sales.account.create": ["name"], "sales.account.update": ["id", "expectedRevision", "name"], "sales.account.archive": ["id", "expectedRevision"],
        "sales.contact.create": ["accountId", "displayName", "email", "phone"], "sales.contact.update": ["id", "expectedRevision", "displayName", "emailMode", "email", "phoneMode", "phone"], "sales.contact.archive": ["id", "expectedRevision"],
        "sales.lead.create": ["displayName", "source", "email", "phone"], "sales.lead.update": ["id", "expectedRevision", "displayName", "source", "emailMode", "email", "phoneMode", "phone"], "sales.lead.qualify": ["id", "expectedRevision", "accountMode", "accountName", "accountId", "contactMode", "contactName", "contactId", "opportunityName", "pipelineId"], "sales.lead.disqualify": ["id", "expectedRevision"], "sales.lead.archive": ["id", "expectedRevision"],
        "sales.opportunity.create": ["name", "accountId", "pipelineId", "expectedPipelineRevision", "stageId", "expectedStageRevision", "primaryContactId", "amount", "expectedCloseDate"], "sales.opportunity.update": ["id", "expectedRevision", "name", "primaryContactMode", "primaryContactId", "amountMode", "amount", "expectedCloseDateMode", "expectedCloseDate"], "sales.opportunity.close": ["id", "expectedRevision", "expectedPipelineId", "expectedPipelineRevision", "expectedSourceStageId", "expectedSourceStageRevision", "destinationStageId", "expectedDestinationStageRevision", "lossReason"], "sales.opportunity.archive": ["id", "expectedRevision"],
        "sales.activity.create": ["relatedRecordType", "relatedRecordId", "type", "subject", "scheduledAt", "supersedesActivityId"], "sales.activity.complete": ["id", "expectedRevision"], "sales.activity.cancel": ["id", "expectedRevision"],
        "sales.note.create": ["relatedRecordType", "relatedRecordId", "body", "replacesNoteId"], "sales.attachment.link": ["relatedRecordType", "relatedRecordId", "storageReference", "filename", "mediaType", "byteSize"], "sales.attachment.remove": ["id", "expectedRevision"]
    };
    const keys = Object.keys(value);
    if (keys.some((key) => !allowed[actionId].includes(key)))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action input is invalid.");
    const required = actionId === "sales.opportunity.create" ? ["name", "accountId", "pipelineId", "expectedPipelineRevision", "stageId", "expectedStageRevision"]
        : actionId.endsWith(".create") ? allowed[actionId].filter((key) => !["email", "phone", "supersedesActivityId", "replacesNoteId"].includes(key))
            : actionId === "sales.opportunity.close" ? ["id", "expectedRevision", "expectedPipelineId", "expectedPipelineRevision", "expectedSourceStageId", "expectedSourceStageRevision", "destinationStageId", "expectedDestinationStageRevision"]
                : actionId === "sales.lead.qualify" ? ["id", "expectedRevision", "accountMode", "contactMode", "opportunityName", "pipelineId"]
                    : actionId === "sales.opportunity.update" ? ["id", "expectedRevision", "name", "primaryContactMode", "amountMode", "expectedCloseDateMode"]
                        : actionId === "sales.contact.update" ? ["id", "expectedRevision", "displayName", "emailMode", "phoneMode"]
                            : actionId === "sales.lead.update" ? ["id", "expectedRevision", "displayName", "source", "emailMode", "phoneMode"]
                                : allowed[actionId].filter((key) => !["email", "phone", "lossReason"].includes(key));
    if (required.some((key) => !Object.hasOwn(value, key)))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action input is invalid.");
    if (actionId === "sales.lead.qualify") {
        const accountCreate = value.accountMode === "create";
        const accountLink = value.accountMode === "link";
        const contactCreate = value.contactMode === "create";
        const contactLink = value.contactMode === "link";
        const exactAccount = accountCreate ? Object.hasOwn(value, "accountName") && !Object.hasOwn(value, "accountId") : accountLink && Object.hasOwn(value, "accountId") && !Object.hasOwn(value, "accountName");
        const exactContact = contactCreate ? Object.hasOwn(value, "contactName") && !Object.hasOwn(value, "contactId") : contactLink && Object.hasOwn(value, "contactId") && !Object.hasOwn(value, "contactName");
        if (!exactAccount || !exactContact || accountCreate && contactLink)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales lead qualification input is invalid.");
        if (accountCreate)
            workflowText(value.accountName, "account name");
        else
            workflowId(value.accountId, "account ID");
        if (contactCreate)
            workflowText(value.contactName, "contact name");
        else
            workflowId(value.contactId, "contact ID");
        workflowText(value.opportunityName, "opportunity name");
        workflowId(value.pipelineId, "pipeline ID");
    }
    if (actionId === "sales.opportunity.create" || actionId === "sales.opportunity.update") {
        workflowText(value.name, "opportunity name");
        if (actionId === "sales.opportunity.create") {
            workflowId(value.accountId, "account ID");
            workflowId(value.pipelineId, "pipeline ID");
            workflowRevision(value.expectedPipelineRevision);
            workflowRevision(value.expectedStageRevision);
            if (typeof value.stageId !== "string" || !pipelineStageUuidPattern.test(value.stageId))
                throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity stage identity is invalid.");
            if (value.primaryContactId !== undefined)
                workflowId(value.primaryContactId, "primary contact ID");
        }
        else {
            workflowId(value.id, "opportunity ID");
            workflowRevision(value.expectedRevision);
            for (const [modeKey, valueKey] of [["primaryContactMode", "primaryContactId"], ["amountMode", "amount"], ["expectedCloseDateMode", "expectedCloseDate"]]) {
                const mode = value[modeKey];
                const present = Object.hasOwn(value, valueKey);
                if (!["retain", "set", "clear"].includes(String(mode)) || (mode === "set") !== present)
                    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity update mode is invalid.");
            }
            if (value.primaryContactMode === "set")
                workflowId(value.primaryContactId, "primary contact ID");
        }
        if (value.amount !== undefined)
            workflowOpportunityMoney(value.amount);
        if (value.expectedCloseDate !== undefined)
            workflowCalendarDate(value.expectedCloseDate);
    }
    if (actionId === "sales.opportunity.close") {
        workflowId(value.id, "opportunity ID");
        workflowRevision(value.expectedRevision);
        workflowId(value.expectedPipelineId, "pipeline ID");
        workflowRevision(value.expectedPipelineRevision);
        workflowRevision(value.expectedSourceStageRevision);
        workflowRevision(value.expectedDestinationStageRevision);
        for (const key of ["expectedSourceStageId", "destinationStageId"])
            if (typeof value[key] !== "string" || !pipelineStageUuidPattern.test(value[key]))
                throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity stage identity is invalid.");
        if (value.lossReason !== undefined && (typeof value.lossReason !== "string" || Buffer.byteLength(value.lossReason.trim()) < 1 || Buffer.byteLength(value.lossReason.trim()) > 500))
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales loss reason is invalid.");
    }
    if (actionId === "sales.contact.update" || actionId === "sales.lead.update") {
        for (const [modeKey, valueKey] of [["emailMode", "email"], ["phoneMode", "phone"]]) {
            const mode = value[modeKey];
            const present = Object.hasOwn(value, valueKey);
            if (!(mode === "retain" || mode === "set" || mode === "clear") || (mode === "set") !== present)
                throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales channel update mode is invalid.");
            if (mode === "set")
                valueKey === "phone" ? workflowPhone(value[valueKey]) : workflowText(value[valueKey], valueKey);
        }
    }
    if (actionId === "sales.contact.create" || actionId === "sales.lead.create") {
        if (value.email !== undefined)
            workflowText(value.email, "email");
        if (value.phone !== undefined)
            workflowPhone(value.phone);
    }
    if (actionId === "sales.note.create") {
        salesNoteBody(value.body);
        if (value.replacesNoteId !== undefined)
            workflowId(value.replacesNoteId, "replaced note ID");
    }
    return Object.freeze({ ...value });
}
const workflowOutputStatuses = Object.freeze({
    "sales.account.create": ["active"], "sales.account.update": ["active"], "sales.account.archive": ["archived"],
    "sales.contact.create": ["active"], "sales.contact.update": ["active"], "sales.contact.archive": ["archived"],
    "sales.lead.create": ["new"], "sales.lead.update": ["working"], "sales.lead.qualify": ["qualified"], "sales.lead.disqualify": ["disqualified"], "sales.lead.archive": ["archived"],
    "sales.opportunity.create": ["qualification"], "sales.opportunity.update": ["qualification", "discovery", "proposal", "negotiation"], "sales.opportunity.close": ["won", "lost"], "sales.opportunity.archive": ["archived"],
    "sales.activity.create": ["scheduled"], "sales.activity.complete": ["completed"], "sales.activity.cancel": ["cancelled"],
    "sales.note.create": ["recorded"], "sales.attachment.link": ["active"], "sales.attachment.remove": ["removed"]
});
function workflowOutput(actionId, value) {
    const qualification = actionId === "sales.lead.qualify";
    const opportunityPipelineResult = actionId === "sales.opportunity.create" || actionId === "sales.opportunity.close";
    if (opportunityPipelineResult) {
        if (!isRecord(value) || !exactKeys(value, ["id", "revision", "pipelineId", "stageId"]) || !isSalesRecordId(value.id) || !isSalesRecordId(value.pipelineId) || typeof value.stageId !== "string" || !pipelineStageUuidPattern.test(value.stageId) || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 1_000_000_000)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action output is invalid.");
        return Object.freeze(value);
    }
    const allowedKeys = qualification ? ["id", "revision", "status", "accountId", "contactId", "opportunityId"] : ["id", "revision", "status"];
    if (!isRecord(value) || !exactKeys(value, allowedKeys) || !isSalesRecordId(value.id) || typeof value.status !== "string" || !workflowOutputStatuses[actionId].includes(value.status) || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 1_000_000_000 ||
        qualification && ["accountId", "contactId", "opportunityId"].some((key) => !isSalesRecordId(value[key]))) {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action output is invalid.");
    }
    return Object.freeze(value);
}
function workflowRuntimeSchema(actionId) {
    return { safeParse(value) { try {
            return { success: true, data: exactWorkflowInput(actionId, value) };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error("Sales action input is invalid.") };
        } } };
}
function workflowOutputRuntimeSchema(actionId) {
    return { safeParse(value) { try {
            return { success: true, data: workflowOutput(actionId, value) };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error("Sales action output is invalid.") };
        } } };
}
function workflowDescriptor(actionId) {
    const descriptor = salesCrmActionDescriptors.find((candidate) => candidate.id === actionId);
    if (descriptor === undefined)
        throw new TypeError(`Missing frozen Sales action ${actionId}.`);
    return descriptor;
}
export const salesWorkflowActionDefinitions = Object.freeze(Object.keys(workflowActions).map((actionId) => ({ descriptor: workflowDescriptor(actionId), inputSchema: workflowRuntimeSchema(actionId), outputSchema: workflowOutputRuntimeSchema(actionId) })));
function workflowPayload(value) {
    const request = salesRequest(value);
    if (typeof request.payload.create !== "function" || typeof request.payload.update !== "function" || typeof request.payload.find !== "function")
        throw new Error("The Sales action requires a capability-scoped Payload request.");
    return request;
}
function workflowBase(authorization, state) {
    return Object.freeze({ applicationId: authorization.applicationId, environment: authorization.environment, ownerId: authorization.ownerId,
        ...(authorization.teamId === undefined ? {} : { teamId: authorization.teamId }), createdBy: authorization.actorId, updatedBy: authorization.actorId, revision: 1, audit: [], status: state, archiveStatus: "active" });
}
function workflowWhere(authorization, id, expectedRevision) {
    return mutationWhere(authorization, id, expectedRevision);
}
function workflowState(document, stateField) {
    const value = document[stateField];
    if (typeof value !== "string" || value.length === 0)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record state is invalid.");
    return value;
}
function workflowStateIdentity(document, collection) {
    if (collection === "sales-opportunities")
        return Object.freeze({ stageId: workflowState(document, "stageId"), archiveStatus: workflowState(document, "archiveStatus") });
    if (collection === "sales-leads")
        return Object.freeze({ status: workflowState(document, "status"), archiveStatus: workflowState(document, "archiveStatus") });
    return Object.freeze({ status: workflowState(document, "status") });
}
function workflowEvent(actionId) { return workflowActions[actionId].event; }
function workflowCreates(actionId) { return actionId.endsWith(".create") || actionId === "sales.attachment.link"; }
async function authorizedPersistence(operation) {
    try {
        return await operation;
    }
    catch (error) {
        if (error instanceof Error && ["Payload persistence capability denied the collection operation.", "Current authority denied the Payload persistence operation."].includes(error.message))
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales persistence authority is unavailable.");
        throw error;
    }
}
function workflowRelatedType(value) {
    if (typeof value !== "string" || !Object.hasOwn(timelineTargetCollections, value))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related record type is invalid.");
    return value;
}
async function assertRelatedRecord(payloadRequest, authorization, type, id, user, active = false, requireSameOwnership = true) {
    const found = await authorizedPersistence(payloadRequest.payload.find({ collection: timelineTargetCollections[type], depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, ownerId: true, teamId: true, status: true, archiveStatus: true, accountId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }));
    if (found.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales related record is unavailable.");
    const related = found.docs[0];
    if (requireSameOwnership && (related.ownerId !== authorization.ownerId || (typeof related.teamId === "string" ? related.teamId : undefined) !== authorization.teamId))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related record authority changed.");
    if (active && (related.status !== "active" || related.archiveStatus === "archived"))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales related record is not active.");
    return related;
}
async function assertActivityRelatedRecord(payloadRequest, authorization, type, id, user) {
    if (type !== "sales.task")
        return await assertRelatedRecord(payloadRequest, authorization, type, id, user);
    const found = await payloadRequest.payload.find({ collection: "sales-tasks", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, relatedRecordType: true, relatedRecordId: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest });
    if (found.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales related task is unavailable.");
    const task = found.docs[0];
    if (typeof task.relatedRecordType !== "string" || !Object.hasOwn(timelineTargetCollections, task.relatedRecordType) || task.relatedRecordId === undefined || task.relatedRecordId === null) {
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales related task parent is invalid.");
    }
    return await assertRelatedRecord(payloadRequest, authorization, task.relatedRecordType, persistedWorkflowId(task.relatedRecordId, "task parent record ID"), user);
}
async function assertPipelineReference(payloadRequest, authorization, value, user, fence) {
    const id = workflowId(value, "pipeline ID");
    const scope = [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { pipelineId: { equals: id } }];
    const [pipeline, qualification] = await Promise.all([
        payloadRequest.payload.find({ collection: "sales-pipelines", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, revision: true, isActive: true, status: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { status: { equals: "active" } }, { isActive: { equals: true } }, ...(fence === undefined ? [] : [{ revision: { equals: fence.pipelineRevision } }])] }, ...(user === undefined ? {} : { user }), req: payloadRequest }),
        payloadRequest.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, stageId: true, semantic: true, revision: true }, sort: ["id"], where: { and: [...scope, ...(fence === undefined ? [] : [{ stageId: { equals: fence.stageId } }, { revision: { equals: fence.stageRevision } }]), { semantic: { equals: "qualification" } }, { status: { equals: "active" } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest })
    ]);
    if (pipeline.docs.length !== 1 || qualification.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline is unavailable.");
    const stageId = qualification.docs[0].stageId;
    if (typeof stageId !== "string" || stageId !== salesPipelineStageId(authorization.applicationId, authorization.environment, Number(id), "qualification") || trustedPipelineStage(qualification.docs[0], authorization.applicationId, authorization.environment, Number(id)) !== "qualification")
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales qualification stage identity is invalid.");
    return Object.freeze({ pipelineId: id, stageId });
}
async function assertActivitySupersession(payloadRequest, authorization, relatedRecordType, relatedRecordId, value, user) {
    if (value === undefined)
        return undefined;
    const initial = workflowId(value, "superseded activity ID");
    const seen = new Set();
    let current = initial;
    for (let depth = 0; depth < 32; depth += 1) {
        if (seen.has(current))
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity supersession cycle is invalid.");
        seen.add(current);
        const found = await payloadRequest.payload.find({ collection: "sales-activities", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, status: true, relatedRecordId: true, relatedRecordType: true, supersedesActivity: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: current } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest });
        if (found.docs.length !== 1)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales superseded activity is unavailable.");
        const document = found.docs[0];
        if (document.relatedRecordId !== relatedRecordId || document.relatedRecordType !== relatedRecordType)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales superseded activity has a different related record.");
        if (document.status !== "completed")
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Only completed Sales activities may be superseded.");
        if (document.supersedesActivity === undefined || document.supersedesActivity === null)
            return initial;
        current = persistedWorkflowId(document.supersedesActivity, "superseded activity ID");
    }
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity supersession is too deep.");
}
async function assertNoteReplacement(payloadRequest, authorization, relatedRecordType, relatedRecordId, value, user) {
    if (value === undefined) {
        if (authorization.noteReplacementAdmission !== undefined)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales note replacement admission is invalid.");
        return undefined;
    }
    const id = workflowId(value, "replaced note ID");
    const admission = authorization.noteReplacementAdmission;
    if (!isRecord(admission) || Object.keys(admission).sort().join("\0") !== "applicationId\0environment\0recordId\0relatedRecordId\0relatedRecordType" || admission.recordId !== id || admission.applicationId !== authorization.applicationId || admission.environment !== authorization.environment || admission.relatedRecordType !== relatedRecordType || admission.relatedRecordId !== relatedRecordId)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales note replacement admission is invalid.");
    const found = await authorizedPersistence(payloadRequest.payload.find({ collection: "sales-notes", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1,
        select: { id: true, status: true, relatedRecordId: true, relatedRecordType: true }, sort: ["id"], where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }));
    if (found.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales replaced note is unavailable.");
    const note = found.docs[0];
    if (note.status !== "recorded" || note.relatedRecordType !== relatedRecordType || persistedWorkflowId(note.relatedRecordId, "replaced note related record ID") !== relatedRecordId)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales replaced note does not belong to this record.");
    return id;
}
async function workflowCreate(payloadRequest, authorization, actionId, input, user, signal, eventId) {
    const spec = workflowActions[actionId];
    if (["sales.contact.create", "sales.lead.create", "sales.opportunity.create"].includes(actionId))
        protectedFieldAdmissions(authorization, actionId, input);
    const data = actionId === "sales.account.create" ? { ...workflowBase(authorization, "active"), name: workflowText(input.name, "account name") }
        : actionId === "sales.contact.create" ? { ...workflowBase(authorization, "active"), accountId: Number(workflowId(input.accountId, "account ID")), displayName: workflowText(input.displayName, "contact name"), ...(input.email === undefined ? {} : { email: workflowText(input.email, "email") }), ...(input.phone === undefined ? {} : { phone: workflowPhone(input.phone) }) }
            : actionId === "sales.lead.create" ? { ...workflowBase(authorization, "new"), displayName: workflowText(input.displayName, "lead name"), source: workflowText(input.source, "lead source"), ...(input.email === undefined ? {} : { email: workflowText(input.email, "email") }), ...(input.phone === undefined ? {} : { phone: workflowPhone(input.phone) }) }
                : actionId === "sales.activity.create" ? (() => { const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID"); const scheduledAt = workflowTimestamp(input.scheduledAt, "scheduled time"); return { ...workflowBase(authorization, "scheduled"), type: workflowText(input.type, "activity type"), subject: workflowText(input.subject, "activity subject"), actorId: authorization.actorId, relatedRecordType, relatedRecordId, scheduledAt }; })()
                    : actionId === "sales.note.create" ? (() => { const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID"); const base = workflowBase(authorization, "recorded"); const { archiveStatus: _archiveStatus, ...noteBase } = base; return { ...noteBase, body: salesNoteBody(input.body), authorId: authorization.actorId, occurredAt: new Date().toISOString(), relatedRecordType, relatedRecordId }; })()
                        : actionId === "sales.attachment.link" ? (() => { const relatedRecordType = workflowRelatedType(input.relatedRecordType); const relatedRecordId = workflowId(input.relatedRecordId, "related record ID"); const base = workflowBase(authorization, "active"); const { archiveStatus: _archiveStatus, ...attachmentBase } = base; const byteSize = input.byteSize; if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 1_073_741_824)
                            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales attachment size is invalid."); return { ...attachmentBase, storageReference: workflowText(input.storageReference, "storage reference"), filename: workflowText(input.filename, "filename"), mediaType: workflowMediaType(input.mediaType), byteSize, uploaderId: authorization.actorId, relatedRecordType, relatedRecordId }; })()
                            : { ...workflowBase(authorization, workflowText(input.stageId, "opportunity stage")), name: workflowText(input.name, "opportunity name"), accountId: Number(workflowId(input.accountId, "account ID")), pipelineId: Number(workflowId(input.pipelineId, "pipeline ID")), stageId: workflowText(input.stageId, "opportunity stage"), ...(input.primaryContactId === undefined ? {} : { primaryContactId: Number(workflowId(input.primaryContactId, "primary contact ID")) }), ...(input.amount === undefined ? {} : workflowOpportunityMoney(input.amount)), ...(input.expectedCloseDate === undefined ? {} : { expectedCloseDate: workflowCalendarDate(input.expectedCloseDate) }) };
    if (actionId === "sales.activity.create" || actionId === "sales.note.create" || actionId === "sales.attachment.link") {
        const relatedRecordType = workflowRelatedType(input.relatedRecordType);
        const relatedRecordId = workflowId(input.relatedRecordId, "related record ID");
        const related = actionId === "sales.activity.create"
            ? await assertActivityRelatedRecord(payloadRequest, authorization, relatedRecordType, relatedRecordId, user)
            : await assertRelatedRecord(payloadRequest, authorization, relatedRecordType, relatedRecordId, user);
        if (actionId === "sales.activity.create") {
            if (typeof related.teamId !== "string" || related.teamId.length === 0)
                throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity requires an assigned related-record team.");
            Object.assign(data, { teamId: related.teamId });
        }
        if (actionId === "sales.activity.create") {
            const supersedesActivityId = await assertActivitySupersession(payloadRequest, authorization, relatedRecordType, relatedRecordId, input.supersedesActivityId, user);
            if (supersedesActivityId !== undefined)
                Object.assign(data, { supersedesActivity: supersedesActivityId });
        }
        if (actionId === "sales.note.create") {
            const replacesNoteId = await assertNoteReplacement(payloadRequest, authorization, relatedRecordType, relatedRecordId, input.replacesNoteId, user);
            if (replacesNoteId !== undefined)
                Object.assign(data, { replacesNoteId });
        }
        if (actionId === "sales.attachment.link") {
            const upload = await attachmentUploadAdmission(authorization, input, signal);
            Object.assign(data, { storageReference: upload.storageRef, filename: upload.filename, mediaType: upload.mediaType, byteSize: upload.byteSize, uploaderId: upload.uploaderActorId });
        }
    }
    if (actionId === "sales.contact.create") {
        const account = await assertRelatedRecord(payloadRequest, authorization, "sales.account", workflowId(input.accountId, "account ID"), user, true);
        if (typeof account.teamId !== "string" || account.teamId.length === 0)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales contact requires an assigned active Account team.");
        Object.assign(data, { ownerId: account.ownerId, teamId: account.teamId });
    }
    if (actionId === "sales.opportunity.create") {
        const account = await assertRelatedRecord(payloadRequest, authorization, "sales.account", workflowId(input.accountId, "account ID"), user, true);
        if (typeof account.teamId !== "string" || account.teamId.length === 0)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity requires an assigned active Account team.");
        Object.assign(data, { ownerId: account.ownerId, teamId: account.teamId });
        const pipeline = await assertPipelineReference(payloadRequest, authorization, input.pipelineId, user, { pipelineRevision: workflowRevision(input.expectedPipelineRevision), stageId: workflowText(input.stageId, "opportunity stage"), stageRevision: workflowRevision(input.expectedStageRevision) });
        Object.assign(data, { pipelineId: Number(pipeline.pipelineId), stageId: pipeline.stageId, status: pipeline.stageId });
        if (input.primaryContactId !== undefined) {
            const contact = await assertRelatedRecord(payloadRequest, authorization, "sales.contact", workflowId(input.primaryContactId, "primary contact ID"), user, true, false);
            if (String(contact.accountId) !== workflowId(input.accountId, "account ID"))
                throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity contact does not belong to its Account.");
        }
    }
    const created = await authorizedPersistence(payloadRequest.payload.create({ collection: spec.collection, data, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) }));
    if (created.id === undefined || created.id === null)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record creation failed.");
    const id = String(created.id);
    if (actionId === "sales.opportunity.create")
        await assertPipelineReference(payloadRequest, authorization, input.pipelineId, user, { pipelineRevision: workflowRevision(input.expectedPipelineRevision), stageId: workflowText(input.stageId, "opportunity stage"), stageRevision: workflowRevision(input.expectedStageRevision) });
    const state = workflowState(created, spec.stateField);
    if (typeof created.ownerId !== "string" || created.ownerId.length === 0)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record ownership is invalid.");
    const audit = withOwnershipGenesis(auditEntry(authorization, actionId, id, 1, "absent", state, eventId), created.ownerId, typeof created.teamId === "string" ? created.teamId : null);
    const finalized = await payloadRequest.payload.update({ collection: spec.collection, id, data: { audit: appendWorkflowAudit([], audit, spec.collection, state, spec.stateField, created.ownerId, typeof created.teamId === "string" ? created.teamId : null) }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext(workflowEvent(actionId), audit, spec.stateField, actionId === "sales.activity.create" ? workflowTrigger({
            type: "sales.event.workflow.activity-scheduled", workflowId: "sales.workflow.scheduled-activity-reminder", effectKind: "schedule-reminder",
            acceptedOwnerId: created.ownerId, recipientId: authorization.actorId, authorization, scheduledAt: String(created.scheduledAt)
        }) : undefined) });
    if (String(finalized.id) !== id || finalized.revision !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit finalization failed.");
    if (signal.aborted)
        throw signal.reason;
    return actionId === "sales.opportunity.create"
        ? workflowOutput(actionId, { id, revision: 1, pipelineId: workflowId(input.pipelineId, "pipeline ID"), stageId: state })
        : workflowOutput(actionId, { id, revision: 1, status: state });
}
function workflowAuditStateField(actionId, collection) {
    if (actionId === "sales.import.commit" || actionId === "sales.merge.commit")
        return "status";
    if (actionId === "sales.lead.qualify")
        return collection === "sales-opportunities" ? "stageId" : "status";
    if (actionId === salesOpportunityStageUpdateDescriptor.id)
        return "stageId";
    if (actionId === salesOwnershipAssignDescriptor.id)
        return collection === "sales-opportunities" ? "stageId" : "status";
    return workflowActions[actionId].stateField;
}
function validDataMovementAudit(value, collection, genesis, actionId, fromState, toState) {
    if (!isRecord(value))
        return false;
    if (actionId === "sales.import.commit") {
        return genesis && exactKeys(value, ["kind", "importJobId", "oneBasedDataRow", "rowDigest"]) && value.kind === "import" &&
            Number.isSafeInteger(value.importJobId) && value.importJobId > 0 && Number.isSafeInteger(value.oneBasedDataRow) && value.oneBasedDataRow >= 1 && value.oneBasedDataRow <= 10_000 &&
            typeof value.rowDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(value.rowDigest) && fromState === "absent" &&
            (collection === "sales-accounts" || collection === "sales-contacts" ? toState === "active" : collection === "sales-leads" && toState === "new");
    }
    return actionId === "sales.merge.commit" && !genesis && (collection === "sales-accounts" || collection === "sales-contacts") &&
        exactKeys(value, ["kind", "lineageId", "role"]) && value.kind === "merge" && (value.role === "survivor" || value.role === "merged") &&
        typeof value.lineageId === "string" && value.lineageId.length >= 1 && value.lineageId.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value.lineageId) &&
        fromState === "active" &&
        (value.role === "survivor" ? toState === "active" : toState === "merged");
}
function legalWorkflowTransition(actionId, collection, from, to, genesis) {
    if (genesis) {
        if (actionId === "sales.import.commit")
            return from === "absent" && (collection === "sales-accounts" || collection === "sales-contacts" ? to === "active" : collection === "sales-leads" && to === "new");
        if (actionId === "sales.lead.qualify")
            return from === "absent" && (collection === "sales-opportunities" ? pipelineStageUuidPattern.test(to) : to === "active");
        if (actionId === "sales.opportunity.create")
            return from === "absent" && pipelineStageUuidPattern.test(to);
        const initial = { "sales.account.create": "active", "sales.contact.create": "active", "sales.lead.create": "new", "sales.activity.create": "scheduled", "sales.note.create": "recorded", "sales.attachment.link": "active" }[actionId];
        return initial !== undefined && from === "absent" && to === initial;
    }
    if (actionId === "sales.merge.commit")
        return (collection === "sales-accounts" || collection === "sales-contacts") && from === "active" && (to === "active" || to === "merged");
    if (actionId === "sales.account.update" || actionId === "sales.contact.update" || actionId === "sales.opportunity.update")
        return from === to;
    if (actionId === "sales.lead.update")
        return from === "new" && to === "working" || from === "working" && to === "working";
    if (actionId === "sales.lead.qualify")
        return ["new", "working"].includes(from) && to === "qualified";
    if (actionId === "sales.lead.disqualify")
        return ["new", "working"].includes(from) && to === "disqualified";
    if (actionId === salesOpportunityStageUpdateDescriptor.id || actionId === "sales.opportunity.close")
        return pipelineStageUuidPattern.test(from) && pipelineStageUuidPattern.test(to) && from !== to;
    if (actionId === "sales.activity.complete")
        return from === "scheduled" && to === "completed";
    if (actionId === "sales.activity.cancel")
        return from === "scheduled" && to === "cancelled";
    if (actionId === "sales.attachment.remove")
        return from === "active" && to === "removed";
    if (actionId.endsWith(".archive"))
        return from === "active" && to === "archived";
    return actionId === salesOwnershipAssignDescriptor.id && from === to;
}
function workflowAuditHistory(value, collection, identity, currentState, currentStateField) {
    const bounded = boundedAuditArray(value);
    const entries = [];
    const states = new Map([["archiveStatus", "active"]]);
    let migration = false;
    const idempotencyKeys = new Set();
    let lastOwnership;
    for (const [index, entry] of bounded.entries()) {
        const record = isRecord(entry) ? entry : undefined;
        if (index === 0 && collection === "sales-opportunities" && record !== undefined && validMigrationAudit(record, "sales-opportunities")) {
            const genesis = ownershipSnapshot(record.ownershipGenesis);
            if (genesis === undefined)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership genesis is invalid.");
            migration = true;
            const successor = bounded[1];
            const translatedState = isRecord(successor) && typeof successor.fromState === "string" && pipelineStageUuidPattern.test(successor.fromState) ? successor.fromState : currentState;
            states.set("stageId", translatedState);
            lastOwnership = genesis;
            continue;
        }
        if (index === 0 && collection === "sales-accounts" && record !== undefined && exactKeys(record, ["kind", "receiptDigest", "ownershipGenesis"]) && record.kind === "phase-13-legacy-import" && typeof record.receiptDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(record.receiptDigest)) {
            const genesis = ownershipSnapshot(record.ownershipGenesis);
            if (genesis === undefined)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership genesis is invalid.");
            migration = true;
            states.set("status", "active");
            lastOwnership = genesis;
            continue;
        }
        const qualifyGenesis = record?.actionId === "sales.lead.qualify" && index === 0 && !migration && ["sales-accounts", "sales-contacts", "sales-opportunities"].includes(collection);
        const ownership = record?.actionId === salesOwnershipAssignDescriptor.id;
        const genesis = index === 0 && !migration;
        const genesisFacts = ownershipSnapshot(record?.ownershipGenesis);
        const dataMovement = record?.actionId === "sales.import.commit" || record?.actionId === "sales.merge.commit";
        const allowedKeys = ["actionId", "resourceId", "applicationId", "environment", "fromState", "toState", "occurredAt", "actorId", "revision", "idempotencyKey", ...(genesis ? ["ownershipGenesis"] : []), ...(ownership ? ["ownership"] : []), ...(dataMovement ? ["dataMovement"] : [])];
        const actionAllowed = typeof record?.actionId === "string" && (isWorkflowActionId(record.actionId) ? workflowActions[record.actionId].collection === collection || qualifyGenesis
            : record.actionId === salesOpportunityStageUpdateDescriptor.id ? collection === "sales-opportunities"
                : dataMovement ? validDataMovementAudit(record.dataMovement, collection, genesis, record.actionId, record.fromState, record.toState)
                    : ownership && ["sales-accounts", "sales-contacts", "sales-leads", "sales-opportunities"].includes(collection));
        const ownershipFacts = isRecord(record?.ownership) ? record.ownership : undefined;
        if (record === undefined || !exactKeys(record, allowedKeys) || !actionAllowed ||
            typeof record.resourceId !== "string" || !isSalesRecordId(record.resourceId) || record.resourceId !== identity.id || record.applicationId !== identity.applicationId || record.environment !== identity.environment ||
            typeof record.applicationId !== "string" || record.applicationId.length > 128 || !applicationIdPattern.test(record.applicationId) || typeof record.environment !== "string" || record.environment.length > 64 || !environmentPattern.test(record.environment) ||
            !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision > 1_000_000_000 || record.revision !== index + 1 || typeof record.occurredAt !== "string" || !validAuditTimestamp(record.occurredAt) ||
            typeof record.fromState !== "string" || typeof record.toState !== "string" || typeof record.actorId !== "string" || record.actorId.length > 160 || !actorIdPattern.test(record.actorId) || typeof record.idempotencyKey !== "string" || !durableIdPattern.test(record.idempotencyKey) || idempotencyKeys.has(record.idempotencyKey) ||
            genesis && genesisFacts === undefined ||
            ownership && (ownershipFacts === undefined || !exactKeys(ownershipFacts, ["oldOwnerId", "newOwnerId", "oldTeamId", "newTeamId"]) ||
                typeof ownershipFacts.oldOwnerId !== "string" || ownershipFacts.oldOwnerId.length > 160 || !actorIdPattern.test(ownershipFacts.oldOwnerId) ||
                typeof ownershipFacts.newOwnerId !== "string" || ownershipFacts.newOwnerId.length > 160 || !actorIdPattern.test(ownershipFacts.newOwnerId) ||
                ![ownershipFacts.oldTeamId, ownershipFacts.newTeamId].every((teamId) => teamId === null || typeof teamId === "string" && teamId.length <= 160 && actorIdPattern.test(teamId))) ||
            isWorkflowActionId(record.actionId) && workflowCreates(record.actionId) && index !== 0) {
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
        }
        const action = record;
        const stateField = workflowAuditStateField(action.actionId, collection);
        const prior = states.get(stateField);
        if ((prior === undefined ? action.fromState !== "absent" : action.fromState !== prior) || index === 0 && migration || !legalWorkflowTransition(action.actionId, collection, action.fromState, action.toState, genesis))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is invalid.");
        if (genesis)
            lastOwnership = genesisFacts;
        if (!ownership)
            states.set(stateField, action.toState);
        if (ownership) {
            const oldTeamId = ownershipFacts.oldTeamId;
            const newTeamId = ownershipFacts.newTeamId;
            if (lastOwnership === undefined || ownershipFacts.oldOwnerId !== lastOwnership.ownerId || oldTeamId !== lastOwnership.teamId)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership audit continuity is invalid.");
            lastOwnership = Object.freeze({ ownerId: ownershipFacts.newOwnerId, teamId: newTeamId });
        }
        idempotencyKeys.add(action.idempotencyKey);
        entries.push(action);
    }
    const last = entries.at(-1);
    if ((last?.revision ?? (migration ? 1 : 0)) !== identity.revision || states.get(currentStateField) !== currentState ||
        identity.status !== undefined && states.get("status") !== identity.status || identity.stageId !== undefined && states.get("stageId") !== identity.stageId ||
        identity.archiveStatus !== undefined && states.get("archiveStatus") !== identity.archiveStatus || lastOwnership === undefined ||
        identity.ownerId !== lastOwnership.ownerId || (identity.teamId ?? null) !== lastOwnership.teamId)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is not current.");
    return bounded;
}
function appendWorkflowAudit(history, entry, collection, currentState, currentStateField, ownerId, teamId) {
    const appended = Object.freeze([...history, entry]);
    workflowAuditHistory(appended, collection, { id: entry.resourceId, applicationId: entry.applicationId, environment: entry.environment, revision: entry.revision, ownerId, teamId: teamId ?? null }, currentState, currentStateField);
    return appended;
}
/** Validates the complete private audit chain before exposing only the newest safe state transitions. */
export function projectSalesStateHistory(input) {
    const dualAxis = input.collection === "sales-leads" || input.collection === "sales-opportunities";
    if (dualAxis && (typeof input.archiveStatus !== "string" || !["active", "archived"].includes(input.archiveStatus)))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales audit history is not current.");
    const audit = workflowAuditHistory(input.audit, input.collection, { id: input.id, applicationId: input.applicationId, environment: input.environment, revision: input.revision, ownerId: input.ownerId, teamId: input.teamId ?? null,
        ...(input.currentStateField === "status" ? { status: input.currentState } : input.currentStateField === "stageId" ? { stageId: input.currentState } : {}), ...(dualAxis ? { archiveStatus: input.archiveStatus } : {}) }, input.currentState, input.currentStateField);
    return Object.freeze(audit.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.actionId !== "string" || entry.actionId === salesOwnershipAssignDescriptor.id)
            return [];
        return [Object.freeze({ actionId: entry.actionId, stateField: workflowAuditStateField(entry.actionId, input.collection), fromState: String(entry.fromState), toState: String(entry.toState), revision: Number(entry.revision), occurredAt: String(entry.occurredAt) })];
    }).slice(-25).reverse());
}
async function workflowCurrent(payloadRequest, authorization, collection, id, expectedRevision, stateField, user, relatedAuthority = false) {
    const where = relatedAuthority ? { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }] } : workflowWhere(authorization, id, expectedRevision);
    const found = await payloadRequest.payload.find({ collection, depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 1, select: { id: true, revision: true, audit: true, status: true, archiveStatus: true, pipelineId: true, stageId: true, name: true, displayName: true, ownerId: true, teamId: true, accountId: true, primaryContactId: true, relatedRecordType: true, relatedRecordId: true }, sort: ["id"], where, ...(user === undefined ? {} : { user }), req: payloadRequest });
    if (found.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record changed before the update.");
    const document = found.docs[0];
    if (String(document.id) !== id || document.revision !== expectedRevision)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record revision is invalid.");
    const state = workflowState(document, stateField);
    if (typeof document.ownerId !== "string" || document.ownerId.length === 0)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record ownership is invalid.");
    const audit = workflowAuditHistory(document.audit, collection, { id, applicationId: authorization.applicationId, environment: authorization.environment, revision: expectedRevision, ownerId: document.ownerId, teamId: typeof document.teamId === "string" ? document.teamId : null, ...workflowStateIdentity(document, collection) }, state, stateField);
    return Object.freeze({ where, document, state, audit });
}
function updateData(actionId, input, state, authorization, revision, audit) {
    const base = { updatedBy: authorization.actorId, revision, audit };
    if (actionId === "sales.account.update")
        return { ...base, name: workflowText(input.name, "account name") };
    if (actionId === "sales.contact.update")
        return { ...base, displayName: workflowText(input.displayName, "contact name"), ...(input.emailMode === "set" ? { email: workflowText(input.email, "email") } : input.emailMode === "clear" ? { email: null } : {}), ...(input.phoneMode === "set" ? { phone: workflowPhone(input.phone) } : input.phoneMode === "clear" ? { phone: null } : {}) };
    if (actionId === "sales.lead.update")
        return { ...base, displayName: workflowText(input.displayName, "lead name"), source: workflowText(input.source, "lead source"), ...(state === "new" ? { status: "working" } : {}), ...(input.emailMode === "set" ? { email: workflowText(input.email, "email") } : input.emailMode === "clear" ? { email: null } : {}), ...(input.phoneMode === "set" ? { phone: workflowPhone(input.phone) } : input.phoneMode === "clear" ? { phone: null } : {}) };
    if (actionId === "sales.opportunity.update")
        return { ...base, name: workflowText(input.name, "opportunity name"),
            ...(input.primaryContactMode === "set" ? { primaryContactId: Number(workflowId(input.primaryContactId, "primary contact ID")) } : input.primaryContactMode === "clear" ? { primaryContactId: null } : {}),
            ...(input.amountMode === "set" ? workflowOpportunityMoney(input.amount) : input.amountMode === "clear" ? { amount: null, currency: null } : {}),
            ...(input.expectedCloseDateMode === "set" ? { expectedCloseDate: workflowCalendarDate(input.expectedCloseDate) } : input.expectedCloseDateMode === "clear" ? { expectedCloseDate: null } : {}) };
    if (actionId === "sales.opportunity.close") {
        const stage = workflowText(input.destinationStageId, "opportunity stage");
        if (input.destinationSemantic === "lost" && input.lossReason === undefined)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales loss reason is required.");
        return { ...base, stageId: stage, closedAt: new Date().toISOString(), ...(input.destinationSemantic === "lost" ? { lossReason: workflowText(input.lossReason, "loss reason") } : {}) };
    }
    if (actionId === "sales.lead.disqualify")
        return { ...base, status: "disqualified", decidedAt: new Date().toISOString(), disqualifiedAt: new Date().toISOString() };
    if (actionId === "sales.activity.complete")
        return { ...base, status: "completed", occurredAt: new Date().toISOString() };
    if (actionId === "sales.activity.cancel")
        return { ...base, status: "cancelled" };
    if (actionId === "sales.attachment.remove")
        return { ...base, status: "removed" };
    if (actionId.endsWith(".archive"))
        return actionId === "sales.lead.archive" ? { ...base, archiveStatus: "archived" } : actionId === "sales.opportunity.archive" ? { ...base, archiveStatus: "archived" } : { ...base, status: "archived" };
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales transition from ${state} is unavailable.`);
}
async function createConversionRecord(payloadRequest, authorization, collection, data, actionId, eventId, user) {
    const created = await authorizedPersistence(payloadRequest.payload.create({ collection, data, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) }));
    if (created.id === undefined || created.id === null)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales conversion output creation failed.");
    const id = String(created.id);
    const state = collection === "sales-opportunities" ? workflowState(created, "stageId") : workflowState(created, "status");
    if (typeof created.ownerId !== "string" || created.ownerId.length === 0)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales conversion ownership is invalid.");
    const conversionEventId = `qualification-${createHash("sha256").update(canonicalJson({ eventId, collection, id })).digest("hex")}`;
    const audit = withOwnershipGenesis(auditEntry(authorization, actionId, id, 1, "absent", state, conversionEventId), created.ownerId, typeof created.teamId === "string" ? created.teamId : null);
    const event = collection === "sales-accounts" ? "sales.event.account-changed" : collection === "sales-contacts" ? "sales.event.contact-changed" : "sales.event.opportunity-changed";
    const stateField = collection === "sales-opportunities" ? "stageId" : "status";
    const context = eventContext(event, audit, stateField);
    const ownerId = created.ownerId;
    const teamId = typeof created.teamId === "string" ? created.teamId : null;
    const finalized = await payloadRequest.payload.update({ collection, id, data: { audit: appendWorkflowAudit([], audit, collection, state, stateField, ownerId, teamId) }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context });
    if (String(finalized.id) !== id)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales conversion output audit failed.");
    return id;
}
async function qualifyLead(payloadRequest, authorization, input, user, eventId) {
    qualificationAdmissions(authorization, input);
    const id = workflowId(input.id, "lead ID");
    const expectedRevision = workflowRevision(input.expectedRevision);
    const current = await workflowCurrent(payloadRequest, authorization, "sales-leads", id, expectedRevision, "status", user);
    if (current.document.archiveStatus !== "active" || !["new", "working"].includes(current.state))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead cannot be qualified from its current state.");
    if (typeof current.document.ownerId !== "string" || typeof current.document.teamId !== "string")
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead requires active ownership before qualification.");
    const pipeline = await assertPipelineReference(payloadRequest, authorization, input.pipelineId, user);
    const inheritedBase = (state) => ({ ...workflowBase(authorization, state), ownerId: current.document.ownerId, teamId: current.document.teamId });
    const accountId = input.accountMode === "create"
        ? await createConversionRecord(payloadRequest, authorization, "sales-accounts", { ...inheritedBase("active"), name: workflowText(input.accountName, "account name") }, "sales.lead.qualify", eventId, user)
        : workflowId(input.accountId, "account ID");
    if (input.accountMode === "link")
        await assertRelatedRecord(payloadRequest, authorization, "sales.account", accountId, user, true, false);
    const contactId = input.contactMode === "create"
        ? await createConversionRecord(payloadRequest, authorization, "sales-contacts", { ...inheritedBase("active"), accountId: Number(accountId), displayName: workflowText(input.contactName, "contact name") }, "sales.lead.qualify", eventId, user)
        : workflowId(input.contactId, "contact ID");
    if (input.contactMode === "link") {
        const contact = await assertRelatedRecord(payloadRequest, authorization, "sales.contact", contactId, user, true, false);
        if (persistedWorkflowId(contact.accountId, "contact account ID") !== accountId)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales contact does not belong to the qualified account.");
    }
    const opportunityId = await createConversionRecord(payloadRequest, authorization, "sales-opportunities", { ...inheritedBase(pipeline.stageId), name: workflowText(input.opportunityName, "opportunity name"), accountId: Number(accountId), primaryContactId: Number(contactId), pipelineId: Number(pipeline.pipelineId), stageId: pipeline.stageId }, "sales.lead.qualify", eventId, user);
    const revision = expectedRevision + 1;
    const transition = auditEntry(authorization, "sales.lead.qualify", id, revision, current.state, "qualified", eventId);
    const context = eventContext("sales.event.lead-changed", transition, "status");
    const updated = await payloadRequest.payload.update({ collection: "sales-leads", where: current.where, data: { updatedBy: authorization.actorId, revision, audit: appendWorkflowAudit(current.audit, transition, "sales-leads", "qualified", "status", current.document.ownerId, typeof current.document.teamId === "string" ? current.document.teamId : null), status: "qualified", decidedAt: new Date().toISOString(), qualifiedAt: new Date().toISOString(), qualifiedAccountId: accountId, qualifiedContactId: contactId, qualifiedOpportunityId: opportunityId }, depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context });
    if (updated.errors.length > 0 || updated.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead changed before qualification.");
    return workflowOutput("sales.lead.qualify", { id, revision, status: "qualified", accountId, contactId, opportunityId });
}
/** Fixed P13.3 CRM actions; every record mutation remains scoped by host authorization and CAS. */
export const salesWorkflowActionHandler = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const candidate = isRecord(authorizationContext) && isRecord(authorizationContext.decision) ? authorizationContext.decision.actionId : isRecord(authorizationContext) ? authorizationContext.actionId : undefined;
    if (typeof candidate !== "string" || !isWorkflowActionId(candidate))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action is unavailable.");
    const actionId = candidate;
    const parsed = exactWorkflowInput(actionId, input);
    const authorization = writeAuthorization(authorizationContext, actionId, typeof parsed.id === "string" ? parsed.id : undefined);
    const replay = idempotencyReplay(authorization, workflowOutputRuntimeSchema(actionId));
    if (replay !== undefined)
        return replay;
    const payloadRequest = workflowPayload(request);
    const user = payloadUser(actor);
    const eventId = durableActionEventId(authorization, idempotencyKey);
    if (workflowCreates(actionId))
        return await workflowCreate(payloadRequest, authorization, actionId, parsed, user, signal, eventId);
    if (actionId === "sales.lead.qualify")
        return await qualifyLead(payloadRequest, authorization, parsed, user, eventId);
    const id = workflowId(parsed.id, "record ID");
    const expectedRevision = workflowRevision(parsed.expectedRevision);
    const spec = workflowActions[actionId];
    const relatedMutation = actionId === "sales.attachment.remove" || actionId === "sales.activity.complete" || actionId === "sales.activity.cancel";
    const current = await workflowCurrent(payloadRequest, authorization, spec.collection, id, expectedRevision, spec.stateField, user, relatedMutation);
    if (relatedMutation) {
        const relatedType = workflowRelatedType(current.document.relatedRecordType);
        const relatedId = persistedWorkflowId(current.document.relatedRecordId, "related record ID");
        if (actionId === "sales.activity.complete" || actionId === "sales.activity.cancel")
            await assertActivityRelatedRecord(payloadRequest, authorization, relatedType, relatedId, user);
        else
            await assertRelatedRecord(payloadRequest, authorization, relatedType, relatedId, user);
    }
    if (current.document.archiveStatus === "archived")
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record is archived.");
    if ((actionId === "sales.account.update" || actionId === "sales.contact.update") && current.state !== "active")
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record is not active.");
    if (actionId === "sales.lead.update" && !["new", "working"].includes(current.state))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead cannot be updated from its current state.");
    if (actionId === "sales.opportunity.update" && ["won", "lost"].includes(current.state))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity is closed.");
    if (actionId === "sales.opportunity.update" && parsed.primaryContactMode === "set") {
        const accountId = persistedWorkflowId(current.document.accountId, "Account ID");
        const contact = await assertRelatedRecord(payloadRequest, authorization, "sales.contact", workflowId(parsed.primaryContactId, "primary contact ID"), user, true, false);
        if (String(contact.accountId) !== accountId)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity contact does not belong to its Account.");
    }
    if (["sales.contact.update", "sales.lead.update", "sales.opportunity.update"].includes(actionId))
        protectedFieldAdmissions(authorization, actionId, parsed);
    let destinationSemantic;
    let opportunityReferenceFence;
    if (actionId === "sales.opportunity.close") {
        const identity = [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }];
        const [pipeline, sourceStage, destinationStage] = await Promise.all([
            payloadRequest.payload.find({ collection: "sales-pipelines", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [...identity, { id: { equals: parsed.expectedPipelineId } }, { revision: { equals: parsed.expectedPipelineRevision } }, { status: { equals: "active" } }, { isActive: { equals: true } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }),
            payloadRequest.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [...identity, { pipelineId: { equals: parsed.expectedPipelineId } }, { stageId: { equals: parsed.expectedSourceStageId } }, { revision: { equals: parsed.expectedSourceStageRevision } }, { status: { equals: "active" } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }),
            payloadRequest.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [...identity, { pipelineId: { equals: parsed.expectedPipelineId } }, { stageId: { equals: parsed.destinationStageId } }, { revision: { equals: parsed.expectedDestinationStageRevision } }, { status: { equals: "active" } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest })
        ]);
        const source = sourceStage.docs[0];
        const destination = destinationStage.docs[0];
        if (pipeline.docs.length !== 1 || sourceStage.docs.length !== 1 || destinationStage.docs.length !== 1 || String(current.document.pipelineId) !== parsed.expectedPipelineId || current.state !== parsed.expectedSourceStageId || !trustedPipelineTransition(source, destination, authorization.applicationId, authorization.environment, Number(parsed.expectedPipelineId), String(parsed.destinationStageId)) || !["won", "lost"].includes(String(destination?.semantic)))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales opportunity or pipeline changed before close.");
        destinationSemantic = destination.semantic;
        if (destinationSemantic === "lost" ? parsed.lossReason === undefined : parsed.lossReason !== undefined)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales close fields do not match the destination stage.");
        opportunityReferenceFence = async () => {
            const [pipelineFence, sourceFence, destinationFence] = await Promise.all([
                payloadRequest.payload.find({ collection: "sales-pipelines", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [...identity, { id: { equals: parsed.expectedPipelineId } }, { revision: { equals: parsed.expectedPipelineRevision } }, { status: { equals: "active" } }, { isActive: { equals: true } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }),
                payloadRequest.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [...identity, { pipelineId: { equals: parsed.expectedPipelineId } }, { stageId: { equals: parsed.expectedSourceStageId } }, { revision: { equals: parsed.expectedSourceStageRevision } }, { status: { equals: "active" } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest }),
                payloadRequest.payload.find({ collection: "sales-pipeline-stages", depth: 0, overrideAccess: true, pagination: true, page: 1, limit: 2, where: { and: [...identity, { pipelineId: { equals: parsed.expectedPipelineId } }, { stageId: { equals: parsed.destinationStageId } }, { revision: { equals: parsed.expectedDestinationStageRevision } }, { status: { equals: "active" } }] }, ...(user === undefined ? {} : { user }), req: payloadRequest })
            ]);
            if (pipelineFence.docs.length !== 1 || sourceFence.docs.length !== 1 || destinationFence.docs.length !== 1)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed during close.");
        };
    }
    if (actionId === "sales.lead.disqualify" && !["new", "working"].includes(current.state))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales lead cannot be disqualified from its current state.");
    if (actionId.endsWith(".archive") && current.state === "archived")
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record is already archived.");
    const revision = expectedRevision + 1;
    const nextState = actionId === "sales.opportunity.close" ? workflowText(parsed.destinationStageId, "opportunity stage") : actionId === "sales.lead.update" && current.state === "new" ? "working" : ("state" in spec ? spec.state : current.state);
    const transition = auditEntry(authorization, actionId, id, revision, current.state, nextState, eventId);
    const audit = appendWorkflowAudit(current.audit, transition, spec.collection, nextState, spec.stateField, current.document.ownerId, typeof current.document.teamId === "string" ? current.document.teamId : null);
    const update = await payloadRequest.payload.update({ collection: spec.collection, where: current.where, data: updateData(actionId, destinationSemantic === undefined ? parsed : { ...parsed, destinationSemantic }, current.state, authorization, revision, audit), depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: eventContext(workflowEvent(actionId), transition, spec.stateField) });
    if (update.errors.length > 0 || update.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales record changed before update.");
    if (opportunityReferenceFence !== undefined)
        await opportunityReferenceFence();
    return actionId === "sales.opportunity.close"
        ? workflowOutput(actionId, { id, revision, pipelineId: workflowId(parsed.expectedPipelineId, "pipeline ID"), stageId: nextState })
        : workflowOutput(actionId, { id, revision, status: nextState });
};
const salesConfigurationDescriptors = Object.freeze([salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor]);
export const salesConfigurationActionDefinitions = Object.freeze(salesConfigurationDescriptors.map((descriptor) => ({ descriptor, inputSchema: salesWorkflowActionInputRuntimeSchemas[descriptor.id], outputSchema: salesWorkflowActionOutputRuntimeSchemas[descriptor.id] })));
function savedVisibility(value) {
    if (!isRecord(value) || !exactKeys(value, value.kind === "team" ? ["kind", "teamId"] : ["kind"]) || value.kind !== "personal" && value.kind !== "team" || value.kind === "team" && !isSalesBoundedNfcText(value.teamId))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view visibility is invalid.");
    return Object.freeze({ visibility: value.kind, visibilityTeamId: value.kind === "team" ? value.teamId : null });
}
function savedViewName(value) {
    if (typeof value !== "string" || !isSalesBoundedNfcText(value.trim()))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view name is invalid.");
    return value.trim();
}
function savedMutationAuthority(value) {
    if (!isRecord(value) || !exactKeys(value, ["ownerId", "visibility", "visibilityTeamId"]) || typeof value.ownerId !== "string" || value.ownerId.length < 1 ||
        value.visibility !== "personal" && value.visibility !== "team" || value.visibility === "personal" && value.visibilityTeamId !== null ||
        value.visibility === "team" && !isSalesBoundedNfcText(value.visibilityTeamId))
        return undefined;
    return value;
}
function assertSavedMutationAuthority(authorization, current, requested, mode) {
    const currentAuthority = savedMutationAuthority(authorization.savedViewCurrent);
    const destinationAuthority = savedMutationAuthority(authorization.savedViewDestination);
    if (mode === "create") {
        const visibility = savedVisibility(requested);
        if (currentAuthority !== undefined || destinationAuthority?.ownerId !== authorization.actorId || destinationAuthority.visibility !== visibility.visibility || destinationAuthority.visibilityTeamId !== visibility.visibilityTeamId)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view destination authority is invalid.");
        return;
    }
    const rowVisibility = current?.visibility;
    const rowTeam = current?.visibilityTeamId ?? null;
    if (currentAuthority === undefined || current === undefined || currentAuthority.ownerId !== current.ownerId || current.ownerId !== authorization.ownerId || currentAuthority.visibility !== rowVisibility || currentAuthority.visibilityTeamId !== rowTeam)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view current authority is invalid.");
    if (mode === "archive") {
        if (destinationAuthority !== undefined)
            throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view archive authority is invalid.");
        return;
    }
    const visibility = savedVisibility(requested);
    if (destinationAuthority?.ownerId !== current.ownerId || destinationAuthority.visibility !== visibility.visibility || destinationAuthority.visibilityTeamId !== visibility.visibilityTeamId)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view destination authority is invalid.");
}
function trustedReportingTimezone(value) {
    if (value === undefined)
        return undefined;
    if (!isRecord(value) || !exactKeys(value, ["timezone", "revision"]) || typeof value.timezone !== "string" || !Number.isSafeInteger(value.revision) || value.revision < 1)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting timezone authority is invalid.");
    const result = Object.freeze({ timezone: value.timezone, revision: value.revision });
    try {
        canonicalSalesCalendarRange(result);
    }
    catch {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting timezone authority is invalid.");
    }
    return result;
}
async function recheckSavedViewReportingTimezone(authorization, definition, expected) {
    if (definition.kind !== "calendar")
        return;
    if (expected === undefined || typeof authorization.recheckReportingTimezone !== "function")
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales reporting timezone authority is unavailable.");
    const current = trustedReportingTimezone(await authorization.recheckReportingTimezone());
    if (current === undefined || canonicalJson(current) !== canonicalJson(expected))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales reporting timezone changed during mutation.");
}
function validatedSavedDefinition(value, reportingTimezone, create = false) {
    if (!isRecord(value) || !isRecord(value.source) || typeof value.source.id !== "string" || !["sales.saved-view.table", "sales.saved-view.kanban", "sales.saved-view.calendar"].includes(value.source.id) || !Array.isArray(value.fields))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view definition is invalid.");
    const candidate = create && value.source.id === "sales.saved-view.calendar" && value.calendarRange === undefined && reportingTimezone !== undefined ? { ...value, calendarRange: canonicalSalesCalendarRange(reportingTimezone) } : value;
    try {
        compileSalesSavedViewDefinition(candidate, value.source.id, value.fields.filter((field) => typeof field === "string"), 1, { ...(reportingTimezone === undefined ? {} : { reportingTimezone }) });
    }
    catch {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales saved-view definition is invalid.");
    }
    return candidate;
}
function configurationAuditHistory(value, collection, identity) {
    const history = boundedAuditArray(value);
    const seen = new Set();
    let priorState;
    let identityMigrationSeen = false;
    for (const [index, raw] of history.entries()) {
        if (!isRecord(raw))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales configuration audit history is invalid.");
        if (collection !== "sales-saved-views" && index === 0 && (exactKeys(raw, ["kind", "receiptDigest"]) && raw.kind === "phase-13-legacy-import" && typeof raw.receiptDigest === "string" && /^sha256:[0-9a-f]{64}$/u.test(raw.receiptDigest) || exactKeys(raw, ["kind"]) && raw.kind === "phase-13-settings-migration")) {
            priorState = "active";
            continue;
        }
        if (collection !== "sales-saved-views" && raw.kind === "phase-13-pipeline-stage-identity") {
            if (identityMigrationSeen || !exactKeys(raw, ["kind", "receiptDigest", "sourceRevision", "targetRevision"]) || typeof raw.receiptDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(raw.receiptDigest) || raw.sourceRevision !== index || raw.targetRevision !== index + 1)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline identity migration audit is invalid.");
            identityMigrationSeen = true;
            priorState = "active";
            continue;
        }
        const genesisKeys = raw.ownershipGenesis === undefined ? [] : ["ownershipGenesis"];
        if (!exactKeys(raw, ["actionId", "resourceId", "applicationId", "environment", "fromState", "toState", "occurredAt", "actorId", "revision", "idempotencyKey", ...genesisKeys]) ||
            typeof raw.actionId !== "string" || typeof raw.resourceId !== "string" || typeof raw.applicationId !== "string" || typeof raw.environment !== "string" || typeof raw.fromState !== "string" || typeof raw.toState !== "string" || typeof raw.occurredAt !== "string" || typeof raw.actorId !== "string" || typeof raw.idempotencyKey !== "string" || !Number.isSafeInteger(raw.revision) || !validAuditTimestamp(raw.occurredAt) || !durableIdPattern.test(raw.idempotencyKey) || seen.has(raw.idempotencyKey) ||
            raw.resourceId !== identity.resourceId || raw.applicationId !== identity.applicationId || raw.environment !== identity.environment || raw.revision !== index + 1 || raw.fromState !== (priorState ?? "absent") ||
            (collection !== "sales-saved-views" ? raw.actionId !== salesPipelineUpdateDescriptor.id || raw.toState !== "active" : ![salesSavedViewCreateDescriptor.id, salesSavedViewUpdateDescriptor.id, salesSavedViewArchiveDescriptor.id].includes(raw.actionId) || raw.toState !== (raw.actionId === salesSavedViewArchiveDescriptor.id ? "archived" : "active"))) {
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales configuration audit history is invalid.");
        }
        if (collection === "sales-saved-views" && index === 0 && (raw.actionId !== salesSavedViewCreateDescriptor.id || identity.ownerId === undefined || ownershipSnapshot(raw.ownershipGenesis)?.ownerId !== identity.ownerId))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales saved-view audit genesis is invalid.");
        if (collection !== "sales-saved-views" && raw.ownershipGenesis !== undefined || collection === "sales-saved-views" && index > 0 && raw.ownershipGenesis !== undefined)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales configuration audit history is invalid.");
        seen.add(raw.idempotencyKey);
        priorState = raw.toState;
    }
    if (history.length !== identity.revision || priorState !== identity.state || collection !== "sales-saved-views" && !identityMigrationSeen)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales configuration audit history is not current.");
    return history;
}
function appendConfigurationAudit(history, collection, identity, entry) {
    const validated = configurationAuditHistory(history, collection, identity);
    if (validated.length >= maxAuditEntries || validated.some((raw) => raw.idempotencyKey === entry.idempotencyKey))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales configuration audit history cannot append this action.");
    const appended = Object.freeze([...validated, entry]);
    configurationAuditHistory(appended, collection, { ...identity, revision: entry.revision, state: entry.toState });
    return appended;
}
/** Configuration mutations execute inside the action endpoint's already-open Postgres transaction. */
export const salesConfigurationActionHandler = async ({ actor, request, authorizationContext, input, idempotencyKey, signal }) => {
    if (signal.aborted)
        throw signal.reason;
    const decision = isRecord(authorizationContext) && isRecord(authorizationContext.decision) ? authorizationContext.decision : authorizationContext;
    const actionId = isRecord(decision) && typeof decision.actionId === "string" ? decision.actionId : undefined;
    const descriptor = salesConfigurationDescriptors.find((candidate) => candidate.id === actionId);
    if (descriptor === undefined)
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales configuration action is unavailable.");
    const runtime = salesWorkflowActionInputRuntimeSchemas[descriptor.id];
    const parsed = runtime.safeParse(input);
    if (!parsed.success)
        throw parsed.error;
    const authorization = writeAuthorization(authorizationContext, descriptor.id, typeof parsed.data.id === "number" || typeof parsed.data.id === "string" ? String(parsed.data.id) : undefined);
    const reportingTimezone = trustedReportingTimezone(authorization.reportingTimezone);
    const replay = idempotencyReplay(authorization, salesWorkflowActionOutputRuntimeSchemas[descriptor.id]);
    if (replay !== undefined)
        return replay;
    const eventId = durableActionEventId(authorization, idempotencyKey);
    const payloadRequest = workflowPayload(request);
    const user = payloadUser(actor);
    const common = { depth: 0, overrideAccess: true, ...(user === undefined ? {} : { user }), req: payloadRequest, context: Object.freeze({}) };
    if (descriptor.id === salesPipelineArchiveDescriptor.id)
        throw new ActionGatewayError("ACTIVE_PIPELINE_REQUIRED", 409, "The sole active Sales pipeline cannot be archived.");
    if (descriptor.id === salesPipelineUpdateDescriptor.id) {
        const snapshot = validateSalesPipelineSnapshotInput(parsed.data, authorization.applicationId, authorization.environment, salesPipelineStageId);
        const pipelineId = Number(snapshot.id);
        const id = String(pipelineId);
        const expectedRevision = snapshot.expectedRevision;
        const stages = snapshot.stages;
        const current = await payloadRequest.payload.find({ collection: "sales-pipelines", ...common, pagination: true, page: 1, limit: 2, where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { status: { equals: "active" } }, { isActive: { equals: true } }] } });
        const pipelineDocument = current.docs[0];
        if (current.docs.length !== 1 || pipelineDocument === undefined)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed before update (active snapshot count).");
        if (String(pipelineDocument?.id) !== id)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed before update (identity).");
        if (pipelineDocument.revision !== expectedRevision)
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed before update (revision).");
        const persistedStages = await payloadRequest.payload.find({ collection: "sales-pipeline-stages", ...common, pagination: true, page: 1, limit: 7, where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { pipelineId: { equals: pipelineId } }, { status: { equals: "active" } }] } });
        if (persistedStages.docs.length !== 6 || stages.some((stage) => !persistedStages.docs.some((candidate) => { const row = candidate; return row.stageId === stage.stageId && row.revision === stage.expectedRevision && row.semantic === stage.semantic; })))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline stages changed before update.");
        for (const stage of stages) {
            const persisted = persistedStages.docs.find((candidate) => candidate.stageId === stage.stageId);
            configurationAuditHistory(persisted.audit, "sales-pipeline-stages", { resourceId: String(stage.stageId), applicationId: authorization.applicationId, environment: authorization.environment, revision: Number(stage.expectedRevision), state: "active" });
        }
        const pipelineRevision = expectedRevision + 1;
        const pipelineTransition = auditEntry(authorization, descriptor.id, id, pipelineRevision, "active", "active", eventId);
        const pipelineAudit = appendConfigurationAudit(pipelineDocument.audit, "sales-pipelines", { resourceId: id, applicationId: authorization.applicationId, environment: authorization.environment, revision: expectedRevision, state: "active" }, pipelineTransition);
        const updatedPipeline = await payloadRequest.payload.update({ collection: "sales-pipelines", id, data: { name: snapshot.name, orderedStageIds: snapshot.orderedStageIds, revision: pipelineRevision, updatedBy: authorization.actorId, audit: pipelineAudit }, ...common, context: eventContext("sales.event.opportunity-changed", pipelineTransition, "status") });
        if (String(updatedPipeline.id) !== id || updatedPipeline.revision !== pipelineRevision || canonicalJson(updatedPipeline.audit) !== canonicalJson(pipelineAudit))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed during CAS update.");
        const outputStages = [];
        for (const stage of stages) {
            const revision = Number(stage.expectedRevision) + 1;
            const persisted = persistedStages.docs.find((candidate) => candidate.stageId === stage.stageId);
            const stageTransition = Object.freeze({ ...pipelineTransition, resourceId: String(stage.stageId), revision });
            const stageAudit = appendConfigurationAudit(persisted.audit, "sales-pipeline-stages", { resourceId: String(stage.stageId), applicationId: authorization.applicationId, environment: authorization.environment, revision: Number(stage.expectedRevision), state: "active" }, stageTransition);
            const updated = await payloadRequest.payload.update({ collection: "sales-pipeline-stages", where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { pipelineId: { equals: pipelineId } }, { stageId: { equals: stage.stageId } }, { revision: { equals: stage.expectedRevision } }] }, data: { name: stage.name, position: stage.position, probabilityBasisPoints: stage.probabilityBasisPoints, allowedTransitionStageIds: stage.allowedTransitionStageIds, requiredFieldIds: stage.requiredFieldIds, revision, updatedBy: authorization.actorId, audit: stageAudit }, ...common });
            if (updated.errors.length > 0 || updated.docs.length !== 1)
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline stage changed before update.");
            if (canonicalJson(updated.docs[0]?.audit) !== canonicalJson(stageAudit))
                throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline stage audit changed during update.");
            outputStages.push({ stageId: stage.stageId, revision, semantic: stage.semantic, name: stage.name, position: stage.position, probabilityBasisPoints: stage.probabilityBasisPoints, allowedTransitionStageIds: stage.allowedTransitionStageIds, requiredFieldIds: stage.requiredFieldIds, status: "active" });
        }
        const [finalPipelineResult, finalStageResult] = await Promise.all([
            payloadRequest.payload.find({ collection: "sales-pipelines", ...common, pagination: true, page: 1, limit: 2, where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: pipelineId } }, { revision: { equals: pipelineRevision } }, { status: { equals: "active" } }, { isActive: { equals: true } }] } }),
            payloadRequest.payload.find({ collection: "sales-pipeline-stages", ...common, pagination: true, page: 1, limit: 7, where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { pipelineId: { equals: pipelineId } }, { status: { equals: "active" } }] } })
        ]);
        const finalPipeline = finalPipelineResult.docs[0];
        if (finalPipelineResult.docs.length !== 1 || canonicalJson(finalPipeline?.orderedStageIds) !== canonicalJson(snapshot.orderedStageIds) || finalPipeline?.revision !== pipelineRevision || finalStageResult.docs.length !== 6 || stages.some((stage) => !finalStageResult.docs.some((candidate) => {
            const row = candidate;
            if (row.stageId !== stage.stageId || row.revision !== Number(stage.expectedRevision) + 1 || row.semantic !== stage.semantic || row.name !== stage.name || row.position !== stage.position || row.probabilityBasisPoints !== stage.probabilityBasisPoints || canonicalJson(row.allowedTransitionStageIds) !== canonicalJson(stage.allowedTransitionStageIds) || canonicalJson(row.requiredFieldIds) !== canonicalJson(stage.requiredFieldIds))
                return false;
            configurationAuditHistory(row.audit, "sales-pipeline-stages", { resourceId: String(stage.stageId), applicationId: authorization.applicationId, environment: authorization.environment, revision: Number(stage.expectedRevision) + 1, state: "active" });
            return true;
        })))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed during final revision fence.");
        return { id, revision: expectedRevision + 1, name: snapshot.name, orderedStageIds: snapshot.orderedStageIds, stages: outputStages, status: "active" };
    }
    const create = descriptor.id === salesSavedViewCreateDescriptor.id;
    const archive = descriptor.id === salesSavedViewArchiveDescriptor.id;
    if (create) {
        const definition = validatedSavedDefinition(parsed.data.definition, reportingTimezone, true);
        const visibility = savedVisibility(parsed.data.visibility);
        assertSavedMutationAuthority(authorization, undefined, parsed.data.visibility, "create");
        const name = savedViewName(parsed.data.name);
        const created = await payloadRequest.payload.create({ collection: "sales-saved-views", data: { applicationId: authorization.applicationId, environment: authorization.environment, ownerId: authorization.actorId, ...(authorization.teamId === undefined ? {} : { teamId: authorization.teamId }), createdBy: authorization.actorId, updatedBy: authorization.actorId, revision: 1, audit: [], name, ...visibility, viewKind: definition.kind, targetObjectId: definition.targetObjectId, definition, status: "active" }, ...common });
        const id = String(created.id);
        const transition = withOwnershipGenesis(auditEntry(authorization, descriptor.id, id, 1, "absent", "active", eventId), authorization.actorId, authorization.teamId ?? null);
        const audit = [transition];
        configurationAuditHistory(audit, "sales-saved-views", { resourceId: id, applicationId: authorization.applicationId, environment: authorization.environment, revision: 1, ownerId: authorization.actorId, state: "active" });
        const finalized = await payloadRequest.payload.update({ collection: "sales-saved-views", where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { revision: { equals: 1 } }] }, data: { audit }, ...common, context: eventContext("sales.event.opportunity-changed", transition, "status") });
        if (finalized.errors.length > 0 || finalized.docs.length !== 1 || canonicalJson(finalized.docs[0]?.audit) !== canonicalJson(audit))
            throw new ActionGatewayError("STALE_RECORD", 409, "Sales saved-view audit finalization failed.");
        await recheckSavedViewReportingTimezone(authorization, definition, reportingTimezone);
        return { id, revision: 1, name: created.name, visibility: parsed.data.visibility, definition, status: "active" };
    }
    const id = workflowId(parsed.data.id, "saved-view ID");
    const expectedRevision = workflowRevision(parsed.data.expectedRevision);
    const revision = expectedRevision + 1;
    const locked = await payloadRequest.payload.find({ collection: "sales-saved-views", ...common, pagination: true, page: 1, limit: 2, where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }, { status: { equals: "active" } }] } });
    if (locked.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales saved view changed before mutation.");
    const currentView = locked.docs[0];
    assertSavedMutationAuthority(authorization, currentView, parsed.data.visibility, archive ? "archive" : "update");
    const transition = auditEntry(authorization, descriptor.id, id, revision, "active", archive ? "archived" : "active", eventId);
    const audit = appendConfigurationAudit(currentView.audit, "sales-saved-views", { resourceId: id, applicationId: authorization.applicationId, environment: authorization.environment, revision: expectedRevision, ownerId: String(currentView.ownerId), state: "active" }, transition);
    let updatedDefinition;
    const data = archive ? { status: "archived", revision, updatedBy: authorization.actorId, audit } : (() => { const definition = validatedSavedDefinition(parsed.data.definition, reportingTimezone); updatedDefinition = definition; return { name: savedViewName(parsed.data.name), ...savedVisibility(parsed.data.visibility), viewKind: definition.kind, targetObjectId: definition.targetObjectId, definition, revision, updatedBy: authorization.actorId, audit }; })();
    const updated = await payloadRequest.payload.update({ collection: "sales-saved-views", where: { and: [{ applicationId: { equals: authorization.applicationId } }, { environment: { equals: authorization.environment } }, { id: { equals: id } }, { revision: { equals: expectedRevision } }, { status: { equals: "active" } }] }, data, ...common, context: eventContext("sales.event.opportunity-changed", transition, "status") });
    if (updated.errors.length > 0 || updated.docs.length !== 1 || canonicalJson(updated.docs[0]?.audit) !== canonicalJson(audit))
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales saved view changed before mutation.");
    if (!archive)
        await recheckSavedViewReportingTimezone(authorization, updatedDefinition, reportingTimezone);
    return archive ? { id, revision, status: "archived" } : { id, revision, name: data.name, visibility: parsed.data.visibility, definition: updatedDefinition, status: "active" };
};
const ownershipCollections = Object.freeze({ "sales.account": "sales-accounts", "sales.contact": "sales-contacts", "sales.lead": "sales-leads", "sales.opportunity": "sales-opportunities" });
function ownershipIdentity(value, name) {
    if (typeof value !== "string" || value.length > 160 || !actorIdPattern.test(value))
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, `Sales ${name} is invalid.`);
    return value;
}
function ownershipInput(value) {
    if (!isRecord(value) || Object.keys(value).some((key) => !["recordType", "id", "expectedRevision", "ownerId", "teamId"].includes(key)) ||
        typeof value.recordType !== "string" || !Object.hasOwn(ownershipCollections, value.recordType) || typeof value.id !== "string" || !Number.isSafeInteger(value.expectedRevision) || typeof value.ownerId !== "string" || value.teamId !== undefined && typeof value.teamId !== "string") {
        throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership input is invalid.");
    }
    return Object.freeze({ recordType: value.recordType, id: workflowId(value.id, "record ID"), expectedRevision: workflowRevision(value.expectedRevision), ownerId: ownershipIdentity(value.ownerId, "owner ID"), ...(value.teamId === undefined ? {} : { teamId: ownershipIdentity(value.teamId, "team ID") }) });
}
const ownershipOutputSchema = { safeParse(value) {
        try {
            if (!isRecord(value) || Object.keys(value).some((key) => !["recordType", "id", "revision", "ownerId", "teamId"].includes(key)) ||
                typeof value.recordType !== "string" || !Object.hasOwn(ownershipCollections, value.recordType) || typeof value.id !== "string" || !Number.isSafeInteger(value.revision) || typeof value.ownerId !== "string" || value.teamId !== undefined && typeof value.teamId !== "string")
                throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership output is invalid.");
            return { success: true, data: Object.freeze({ recordType: value.recordType, id: workflowId(value.id, "record ID"), revision: workflowRevision(value.revision), ownerId: ownershipIdentity(value.ownerId, "owner ID"), ...(value.teamId === undefined ? {} : { teamId: ownershipIdentity(value.teamId, "team ID") }) }) };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error("Sales ownership output is invalid.") };
        }
    } };
export const salesOwnershipAssignHandler = async ({ request, authorizationContext, input, idempotencyKey }) => {
    const parsed = ownershipInput(input);
    const authorization = writeAuthorization(authorizationContext, salesOwnershipAssignDescriptor.id, parsed.id);
    const replay = idempotencyReplay(authorization, ownershipOutputSchema);
    if (replay !== undefined)
        return replay;
    ownershipAdmission(authorization, parsed);
    const collection = ownershipCollections[parsed.recordType];
    const stateField = parsed.recordType === "sales.opportunity" ? "stageId" : "status";
    const current = await workflowCurrent(workflowPayload(request), authorization, collection, parsed.id, parsed.expectedRevision, stateField, undefined);
    const currentTeam = typeof current.document.teamId === "string" ? current.document.teamId : undefined;
    if (current.document.archiveStatus === "archived" || current.state === "archived" || current.state === "won" || current.state === "lost" || current.state === "qualified" || current.state === "disqualified" ||
        parsed.ownerId === current.document.ownerId && parsed.teamId === currentTeam)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership target is unavailable.");
    const revision = parsed.expectedRevision + 1;
    if (typeof current.document.ownerId !== "string" || current.document.ownerId.length === 0)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership history is invalid.");
    const transition = Object.freeze({
        ...auditEntry(authorization, salesOwnershipAssignDescriptor.id, parsed.id, revision, current.state, current.state, durableActionEventId(authorization, idempotencyKey)),
        ownership: Object.freeze({ oldOwnerId: current.document.ownerId, newOwnerId: parsed.ownerId, oldTeamId: currentTeam ?? null, newTeamId: parsed.teamId ?? null })
    });
    const event = parsed.recordType === "sales.account" ? "sales.event.account-changed" : parsed.recordType === "sales.contact" ? "sales.event.contact-changed" : parsed.recordType === "sales.lead" ? "sales.event.lead-changed" : "sales.event.opportunity-changed";
    const audit = appendWorkflowAudit(current.audit, transition, collection, current.state, stateField, parsed.ownerId, parsed.teamId ?? null);
    const updated = await workflowPayload(request).payload.update({ collection, where: current.where, data: { ownerId: parsed.ownerId, ...(parsed.teamId === undefined ? { teamId: null } : { teamId: parsed.teamId }), updatedBy: authorization.actorId, revision, audit }, depth: 0, overrideAccess: true, req: workflowPayload(request), context: eventContext(event, transition, stateField, parsed.recordType === "sales.lead" ? workflowTrigger({
            type: "sales.event.workflow.lead-owner-assigned", workflowId: "sales.workflow.lead-owner-assigned-notification", effectKind: "notify-new-owner",
            acceptedOwnerId: parsed.ownerId, recipientId: parsed.ownerId, authorization
        }) : undefined) });
    if (updated.errors.length !== 0 || updated.docs.length !== 1)
        throw new ActionGatewayError("STALE_RECORD", 409, "Sales ownership changed before update.");
    return Object.freeze({ recordType: parsed.recordType, id: parsed.id, revision, ownerId: parsed.ownerId, ...(parsed.teamId === undefined ? {} : { teamId: parsed.teamId }) });
};
export const salesOwnershipAssignDefinition = Object.freeze({ descriptor: salesOwnershipAssignDescriptor, inputSchema: { safeParse(value) { try {
            return { success: true, data: ownershipInput(value) };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error("Sales ownership input is invalid.") };
        } } }, outputSchema: ownershipOutputSchema });
export const salesTasksCollection = { ...salesTasksCoreCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesOpportunitiesCollection = { ...salesOpportunitiesCoreCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesAccountsCollectionWithEvents = { ...salesAccountsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesContactsCollectionWithEvents = { ...salesContactsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesLeadsCollectionWithEvents = { ...salesLeadsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesActivitiesCollectionWithEvents = { ...salesActivitiesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesNotesCollectionWithEvents = { ...salesNotesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesAttachmentReferencesCollectionWithEvents = { ...salesAttachmentReferencesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesPipelinesCollectionWithEvents = { ...salesPipelinesCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesSavedViewsCollectionWithEvents = { ...salesSavedViewsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesNotificationsCollectionWithEvents = { ...salesNotificationsCollection, hooks: { afterChange: [salesEventAfterChange] } };
export const salesRemindersCollectionWithEvents = { ...salesRemindersCollection, hooks: { afterChange: [salesEventAfterChange] } };
export { salesAccountsCollection, salesActivitiesCollection, salesAttachmentReferencesCollection, salesContactsCollection, salesLeadsCollection, salesNotesCollection, salesNotificationsCollection, salesPipelinesCollection, salesPipelineStagesCollection, salesRemindersCollection, salesCoreCollectionSlugs, salesRelatedRecordTypes };
export const salesCoreCollections = Object.freeze([
    salesAccountsCollectionWithEvents,
    salesContactsCollectionWithEvents,
    salesLeadsCollectionWithEvents,
    salesPipelinesCollectionWithEvents,
    salesPipelineStagesCollection,
    salesActivitiesCollectionWithEvents,
    salesOpportunitiesCollection,
    salesTasksCollection,
    salesNotificationsCollectionWithEvents,
    salesRemindersCollectionWithEvents,
    salesNotesCollectionWithEvents,
    salesAttachmentReferencesCollectionWithEvents,
    salesSavedViewsCollectionWithEvents,
    salesImportJobsCollection,
    salesImportRowsCollection,
    salesImportChunksCollection,
    salesExportJobsCollection,
    salesMergeLineageCollection
]);
export const salesDefaultSettings = projectSystemSettingsValues(salesWorkspaceSettingsDescriptor);
const permissionPolicy = (permissions) => {
    const executor = {
        evaluate: (input) => {
            const facts = isRecord(input.facts) ? input.facts : undefined;
            const descriptor = salesCrmPermissionDescriptors.find(({ id }) => id === input.permissionId);
            const recordScope = facts?.recordScope;
            const scopedRecordId = input.scope.kind === "application" ? undefined : input.scope.recordId;
            const teams = Array.isArray(facts?.authorizedTeamIds) && facts.authorizedTeamIds.every((teamId) => typeof teamId === "string" && teamId.length > 0)
                ? facts.authorizedTeamIds : undefined;
            const scopeMatches = facts !== undefined && scopedRecordId !== undefined &&
                facts.applicationId === input.applicationId && typeof facts.environment === "string" && facts.environment.length > 0 &&
                facts.recordEnvironment === facts.environment && facts.recordId === scopedRecordId && Number.isSafeInteger(facts.salesScopeRevision) && facts.salesScopeRevision >= 1;
            const collectionScope = facts?.collectionScope === true && scopedRecordId === "collection";
            const validScope = recordScope === "owned-or-assigned-team" || recordScope === "managed-teams-and-own" ||
                recordScope === "application-sales-scope" || recordScope === "explicit-application-or-team-scope";
            const teamAllowed = typeof facts?.teamId === "string" && teams?.includes(facts.teamId) === true;
            const recordAllowed = scopeMatches && validScope && (collectionScope
                ? recordScope === "application-sales-scope" ? facts.applicationWide === true
                    : recordScope === "explicit-application-or-team-scope" ? typeof facts.applicationWide === "boolean"
                        : facts.applicationWide === false && facts.mutationAllowed === true
                : recordScope === "application-sales-scope" ? facts.applicationWide === true
                    : recordScope === "explicit-application-or-team-scope" ? facts.applicationWide === true || teamAllowed
                        : facts.applicationWide === false && (facts.ownerId === input.effectiveActor.id || teamAllowed));
            const fieldAllowed = input.scope.kind !== "field" || facts?.fieldId === input.scope.fieldId && facts.fieldAllowed === true;
            const operationAllowed = descriptor?.operation === "read" || facts?.mutationAllowed === true;
            return { schemaVersion: 1, outcome: permissions.includes(input.permissionId) && recordAllowed && fieldAllowed && operationAllowed ? "allow" : "deny" };
        }
    };
    return Object.freeze(executor);
};
/** Static domain policy executors bound by the host to the exact Sales generation. */
export const salesPermissionPolicyExecutors = Object.freeze({
    ...Object.fromEntries([...new Set(salesCrmPermissionPolicyBindings.map(({ policyReference }) => policyReference))].map((policyReference) => [policyReference,
        permissionPolicy(salesCrmPermissionPolicyBindings.filter((binding) => binding.policyReference === policyReference).map(({ permissionId }) => permissionId))]))
});
export const salesRegistration = definePluginRegistration({
    pluginId: "module.sales",
    contracts: (context) => {
        for (const descriptor of salesCrmPermissionDescriptors)
            context.register("permissions", descriptor.id, descriptor);
        for (const binding of salesCrmPermissionPolicyBindings)
            context.register("policyBindings", binding.id, binding);
        for (const template of salesCrmRoleTemplates)
            context.register("roleTemplates", template.id, template);
        context.register("settings", salesWorkspaceSettingsDescriptor.id, salesWorkspaceSettingsDescriptor);
        context.register("sources", salesTasksDescriptor.id, salesTasksDefinition);
        context.register("sources", salesOpportunitiesDescriptor.id, salesOpportunitiesDefinition);
        context.register("sources", salesAccountsDescriptor.id, salesAccountsDefinition);
        context.register("sources", salesAccountDetailDescriptor.id, salesAccountDetailDefinition);
        context.register("sources", salesContactsDescriptor.id, salesContactsDefinition);
        context.register("sources", salesContactDetailDescriptor.id, salesContactDetailDefinition);
        context.register("sources", salesLeadsDescriptor.id, salesLeadsDefinition);
        context.register("sources", salesLeadDetailDescriptor.id, salesLeadDetailDefinition);
        context.register("sources", salesOpportunityDetailDescriptor.id, salesOpportunityDetailDefinition);
        context.register("sources", salesTimelineDescriptor.id, salesTimelineDefinition);
        context.register("sources", salesNotificationsDescriptor.id, { descriptor: salesNotificationsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesNotificationsOutputRuntimeSchema });
        context.register("sources", salesRemindersDescriptor.id, { descriptor: salesRemindersDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesRemindersOutputRuntimeSchema });
        context.register("sources", salesProviderConfigurationsDescriptor.id, { descriptor: salesProviderConfigurationsDescriptor, inputSchema: salesEmptyInputRuntimeSchema, outputSchema: salesProviderConfigurationsOutputRuntimeSchema });
        for (const definition of [salesPipelineValueByStageDefinition, salesWeightedForecastDefinition, salesWonLostConversionDefinition, salesLeadConversionDefinition, salesActivityByOwnerTeamDefinition, salesTaskAgingDefinition, salesSalesCycleDurationDefinition])
            context.register("sources", definition.descriptor.id, definition);
        context.register("sources", salesPipelineSnapshotDescriptor.id, salesPipelineSnapshotDefinition);
        context.register("sources", salesSavedViewListDescriptor.id, salesSavedViewListDefinition);
        context.register("sources", salesSavedViewDetailDescriptor.id, salesSavedViewDetailDefinition);
        context.register("sources", salesSavedViewTableDescriptor.id, salesSavedViewTableDefinition);
        context.register("sources", salesSavedViewKanbanDescriptor.id, salesSavedViewKanbanDefinition);
        context.register("sources", salesSavedViewCalendarDescriptor.id, salesSavedViewCalendarDefinition);
        context.register("sources", salesImportJobListDescriptor.id, salesImportJobListDefinition);
        context.register("sources", salesImportJobDetailDescriptor.id, salesImportJobDetailDefinition);
        context.register("sources", salesExportJobListDescriptor.id, salesExportJobListDefinition);
        context.register("sources", salesExportJobDetailDescriptor.id, salesExportJobDetailDefinition);
        context.register("sources", salesDedupeCandidatesDescriptor.id, salesDedupeCandidatesDefinition);
        context.register("actions", salesTaskCreateDescriptor.id, salesTaskCreateDefinition);
        context.register("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateDefinition);
        context.register("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateDefinition);
        for (const definition of salesWorkflowActionDefinitions)
            context.register("actions", definition.descriptor.id, definition);
        for (const definition of salesConfigurationActionDefinitions)
            context.register("actions", definition.descriptor.id, definition);
        context.register("actions", salesOwnershipAssignDescriptor.id, salesOwnershipAssignDefinition);
        for (const definition of salesDataMovementActionDefinitions)
            context.register("actions", definition.descriptor.id, definition);
        for (const definition of salesCommunicationActionDefinitions)
            context.register("actions", definition.descriptor.id, definition);
        for (const definition of salesReportActionDefinitions)
            context.register("actions", definition.descriptor.id, definition);
        context.register("tools", salesSearchTasksDescriptor.id, salesSearchTasksDescriptor);
        context.register("tools", salesCreateTaskToolDescriptor.id, salesCreateTaskToolDescriptor);
        for (const descriptor of salesEventDescriptors)
            context.register("events", descriptor.id, descriptor);
        for (const descriptor of salesRealtimeTopicDescriptors)
            context.register("realtimeTopics", descriptor.id, descriptor);
    },
    schema: (context) => {
        const collections = [
            ["sales.accounts.collection", salesAccountsCollectionWithEvents],
            ["sales.contacts.collection", salesContactsCollectionWithEvents],
            ["sales.leads.collection", salesLeadsCollectionWithEvents],
            ["sales.pipelines.collection", salesPipelinesCollectionWithEvents],
            ["sales.pipeline-stages.collection", salesPipelineStagesCollection],
            ["sales.activities.collection", salesActivitiesCollectionWithEvents],
            ["sales.opportunities.collection", salesOpportunitiesCollection],
            ["sales.tasks.collection", salesTasksCollection],
            ["sales.notes.collection", salesNotesCollectionWithEvents],
            ["sales.attachment-references.collection", salesAttachmentReferencesCollectionWithEvents],
            ["sales.saved-views.collection", salesSavedViewsCollectionWithEvents],
            ["sales.notifications.collection", salesNotificationsCollectionWithEvents],
            ["sales.reminders.collection", salesRemindersCollectionWithEvents],
            ["sales.import-jobs.collection", salesImportJobsCollection],
            ["sales.import-rows.collection", salesImportRowsCollection],
            ["sales.import-chunks.collection", salesImportChunksCollection],
            ["sales.export-jobs.collection", salesExportJobsCollection],
            ["sales.merge-lineage.collection", salesMergeLineageCollection]
        ];
        for (const [id, collection] of collections)
            context.register("schema", id, { type: "payload.collection", collection });
        context.register("migrations", salesReferenceMetadata.migration.id, salesReferenceMetadata.migration);
    },
    behavior: (context) => {
        context.register("services", salesReferenceMetadata.service.id, salesReferenceMetadata.service);
        context.register("lifecycle", salesReferenceMetadata.lifecycle.id, salesReferenceMetadata.lifecycle);
    },
    jobs: (context) => {
        context.register("jobs", salesReferenceMetadata.job.id, salesReferenceMetadata.job);
        context.register("jobs", salesReferenceMetadata.reminderJob.id, salesReferenceMetadata.reminderJob);
        context.register("jobs", salesReferenceMetadata.workflowJob.id, salesReferenceMetadata.workflowJob);
        context.register("jobs", salesReferenceMetadata.reportJob.id, salesReferenceMetadata.reportJob);
        context.bind(salesReferenceMetadata.job.id, salesPipelineAuditJob);
        context.bind(salesReferenceMetadata.reminderJob.id, salesReminderDeliveryJob);
        context.bind(salesReferenceMetadata.workflowJob.id, salesCrmWorkflowExecutionJob);
        context.bind(salesReferenceMetadata.reportJob.id, salesReportDeliveryJob);
    },
    dataHandlers: (context) => {
        context.bind("sources", salesTasksDescriptor.id, salesTasksHandler);
        context.bind("sources", salesOpportunitiesDescriptor.id, salesOpportunitiesHandler);
        context.bind("sources", salesAccountsDescriptor.id, salesAccountsHandler);
        context.bind("sources", salesAccountDetailDescriptor.id, salesAccountDetailHandler);
        context.bind("sources", salesContactsDescriptor.id, salesContactsHandler);
        context.bind("sources", salesContactDetailDescriptor.id, salesContactDetailHandler);
        context.bind("sources", salesLeadsDescriptor.id, salesLeadsHandler);
        context.bind("sources", salesLeadDetailDescriptor.id, salesLeadDetailHandler);
        context.bind("sources", salesOpportunityDetailDescriptor.id, salesOpportunityDetailHandler);
        context.bind("sources", salesTimelineDescriptor.id, salesTimelineHandler);
        context.bind("sources", salesNotificationsDescriptor.id, salesNotificationsHandler);
        context.bind("sources", salesRemindersDescriptor.id, salesRemindersHandler);
        context.bind("sources", salesProviderConfigurationsDescriptor.id, salesProviderConfigurationsHandler);
        context.bind("sources", salesPipelineValueByStageDescriptor.id, salesPipelineValueByStageHandler);
        context.bind("sources", salesWeightedForecastDescriptor.id, salesWeightedForecastHandler);
        context.bind("sources", salesWonLostConversionDescriptor.id, salesWonLostConversionHandler);
        context.bind("sources", salesLeadConversionDescriptor.id, salesLeadConversionHandler);
        context.bind("sources", salesActivityByOwnerTeamDescriptor.id, salesActivityByOwnerTeamHandler);
        context.bind("sources", salesTaskAgingDescriptor.id, salesTaskAgingHandler);
        context.bind("sources", salesSalesCycleDurationDescriptor.id, salesSalesCycleDurationHandler);
        context.bind("sources", salesPipelineSnapshotDescriptor.id, salesPipelineSnapshotHandler);
        context.bind("sources", salesSavedViewListDescriptor.id, salesSavedViewListHandler);
        context.bind("sources", salesSavedViewDetailDescriptor.id, salesSavedViewDetailHandler);
        context.bind("sources", salesSavedViewTableDescriptor.id, salesSavedViewTableHandler);
        context.bind("sources", salesSavedViewKanbanDescriptor.id, salesSavedViewKanbanHandler);
        context.bind("sources", salesSavedViewCalendarDescriptor.id, salesSavedViewCalendarHandler);
        context.bind("sources", salesImportJobListDescriptor.id, salesImportJobListHandler);
        context.bind("sources", salesImportJobDetailDescriptor.id, salesImportJobDetailHandler);
        context.bind("sources", salesExportJobListDescriptor.id, salesExportJobListHandler);
        context.bind("sources", salesExportJobDetailDescriptor.id, salesExportJobDetailHandler);
        context.bind("sources", salesDedupeCandidatesDescriptor.id, salesDedupeCandidatesHandler);
        context.bind("actions", salesTaskCreateDescriptor.id, salesTaskCreateHandler);
        context.bind("actions", salesTaskUpdateDescriptor.id, salesTaskUpdateHandler);
        context.bind("actions", salesOpportunityStageUpdateDescriptor.id, salesOpportunityStageUpdateHandler);
        for (const definition of salesWorkflowActionDefinitions)
            context.bind("actions", definition.descriptor.id, salesWorkflowActionHandler);
        for (const definition of salesConfigurationActionDefinitions)
            context.bind("actions", definition.descriptor.id, salesConfigurationActionHandler);
        context.bind("actions", salesOwnershipAssignDescriptor.id, salesOwnershipAssignHandler);
        for (const definition of salesDataMovementActionDefinitions)
            context.bind("actions", definition.descriptor.id, salesDataMovementActionHandler);
        for (const definition of salesCommunicationActionDefinitions)
            context.bind("actions", definition.descriptor.id, salesCommunicationActionHandler);
        for (const definition of salesReportActionDefinitions)
            context.bind("actions", definition.descriptor.id, salesReportActionHandler);
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