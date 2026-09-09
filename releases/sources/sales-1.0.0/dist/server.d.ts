import { type RuntimeSchema, type DataSourceDefinition, type DataSourceQueryControls } from "@k-nex/contracts";
import { createOutboxRealtimeRelay } from "@k-nex/payload-adapter";
import type { ActionDefinition, ActionHandler, DataSourceHandler, PlatformPluginPolicyExecutor } from "@k-nex/runtime";
import type { CollectionConfig } from "payload";
import type { CollectionAfterChangeHook } from "payload";
import { salesAccountsCollection, salesActivitiesCollection, salesAttachmentReferencesCollection, salesContactsCollection, salesLeadsCollection, salesNotesCollection, salesPipelinesCollection, salesPipelineStagesCollection, salesNotificationsCollection, salesRemindersCollection, salesCoreCollectionSlugs, salesRelatedRecordTypes } from "./crm-core.js";
import { type SalesSavedViewBindingInput, type SalesSavedViewDefinition, type SalesReportingTimezone, type SalesSavedViewSourceId, type SalesSavedViewVisibility, type SalesReportId, type SalesReportWindowMode, type CreateTaskInput, type CreateTaskOutput, type UpdateOpportunityStageInput, type UpdateOpportunityStageOutput, type UpdateTaskInput, type UpdateTaskOutput } from "./contracts.js";
export declare const salesDataMovementErrorCodes: readonly ["IMPORT_INVALID_ENCODING", "IMPORT_INVALID_CSV", "IMPORT_UNSAFE_FORMULA", "IMPORT_LIMIT_EXCEEDED", "IMPORT_PROTECTED_FIELD", "IMPORT_MAPPING_INVALID", "IMPORT_UPLOAD_BINDING_INVALID", "IMPORT_REQUIRED_VALUE", "IMPORT_VALUE_INVALID", "IMPORT_CONTACT_ACCOUNT_FORBIDDEN", "IMPORT_ROW_CONFLICT", "IMPORT_WORKER_RETRY_EXHAUSTED", "DEDUPE_CANDIDATE_LIMIT", "STALE_RECORD", "ACTION_FORBIDDEN", "NOT_FOUND", "ARTIFACT_EXPIRED", "ARTIFACT_FORBIDDEN", "IDEMPOTENCY_CONFLICT"];
export type SalesDataMovementErrorCode = typeof salesDataMovementErrorCodes[number];
export declare class SalesDataMovementError extends Error {
    readonly code: SalesDataMovementErrorCode;
    constructor(code: SalesDataMovementErrorCode);
}
export type SalesImportTarget = "sales.object.lead" | "sales.object.account" | "sales.object.contact";
export type SalesDedupeTarget = Extract<SalesImportTarget, "sales.object.account" | "sales.object.contact">;
export type SalesDedupeMatchKind = "account-name" | "contact-email" | "contact-phone" | "contact-email-and-phone";
export type SalesDataMovementObjectEventType = "sales.event.account-changed" | "sales.event.contact-changed" | "sales.event.lead-changed";
export declare const salesDedupeNormalizerVersion: "node24.19-unicode17-v1";
/** The data-movement worker reuses the registered object invalidations; it never invents a parallel event class. */
export declare function salesDataMovementObjectEvent(targetObjectType: SalesImportTarget): SalesDataMovementObjectEventType;
export type SalesDataMovementJobKind = "import" | "export";
export type SalesDataMovementJobEventType = "sales.event.import-job-changed" | "sales.event.export-job-changed";
export type SalesDataMovementJobAudit = Readonly<{
    actionId: "sales.import.commit" | "sales.import.cancel" | "sales.export.create" | "sales.export.cancel";
    resourceId: string;
    applicationId: string;
    environment: string;
    fromState: string;
    toState: string;
    occurredAt: string;
    actorId: string;
    revision: number;
    idempotencyKey: string;
    dataMovement: Readonly<{
        kind: SalesDataMovementJobKind;
        jobId: number;
    }>;
}>;
export declare const salesDataMovementJobTransitions: Readonly<{
    import: readonly (Readonly<{
        actionId: "sales.import.commit";
        fromState: "queued";
        toState: "running";
    }> | Readonly<{
        actionId: "sales.import.commit";
        fromState: "running";
        toState: "succeeded";
    }> | Readonly<{
        actionId: "sales.import.commit";
        fromState: "running";
        toState: "partially-failed";
    }> | Readonly<{
        actionId: "sales.import.commit";
        fromState: "running";
        toState: "failed";
    }> | Readonly<{
        actionId: "sales.import.cancel";
        fromState: "validated";
        toState: "cancelled";
    }> | Readonly<{
        actionId: "sales.import.cancel";
        fromState: "queued";
        toState: "cancelled";
    }>)[];
    export: readonly (Readonly<{
        actionId: "sales.export.create";
        fromState: "queued";
        toState: "running";
    }> | Readonly<{
        actionId: "sales.export.create";
        fromState: "running";
        toState: "succeeded";
    }> | Readonly<{
        actionId: "sales.export.create";
        fromState: "running";
        toState: "failed";
    }> | Readonly<{
        actionId: "sales.export.cancel";
        fromState: "queued";
        toState: "cancelled";
    }>)[];
}>;
/** Canonical audit evidence for every persisted job state transition, including queued-to-running. */
export declare function createSalesDataMovementJobAudit(input: Readonly<{
    kind: SalesDataMovementJobKind;
    jobId: number;
    actionId: SalesDataMovementJobAudit["actionId"];
    applicationId: string;
    environment: string;
    fromState: string;
    toState: string;
    occurredAt: string;
    actorId: string;
    revision: number;
    idempotencyKey: string;
}>): SalesDataMovementJobAudit;
/** Registered job event payload. Environment stays top-level for the outbox consumer predicate. */
export declare function createSalesDataMovementJobOutbox(input: SalesDataMovementJobAudit & Readonly<{
    targetObjectType: SalesImportTarget;
    authorizationRevision: number;
    lifecycleRevision: number;
    scopeRevision: number;
}>): Readonly<{
    type: SalesDataMovementJobEventType;
    payload: Readonly<{
        environment: string;
        jobId: number;
        state: string;
        revision: number;
        actionId: string;
        targetObjectType: SalesImportTarget;
        authorizationRevision: number;
        lifecycleRevision: number;
        scopeRevision: number;
    }>;
}>;
export type SalesDataMovementObjectAudit = Readonly<{
    actionId: "sales.import.commit" | "sales.merge.commit";
    resourceId: string;
    applicationId: string;
    environment: string;
    fromState: "absent" | "active";
    toState: "new" | "active" | "merged";
    occurredAt: string;
    actorId: string;
    revision: number;
    idempotencyKey: string;
    ownershipGenesis?: Readonly<{
        ownerId: string;
        teamId: string | null;
    }>;
    dataMovement: Readonly<{
        kind: "import";
        importJobId: number;
        oneBasedDataRow: number;
        rowDigest: string;
    } | {
        kind: "merge";
        role: "survivor" | "merged";
        lineageId: string;
    }>;
}>;
/** Canonical revision-one audit for records created by a fenced import worker. */
export declare function createSalesImportGenesisAudit(input: Readonly<{
    targetObjectType: SalesImportTarget;
    resourceId: string;
    applicationId: string;
    environment: string;
    ownerId: string;
    teamId: string | null;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
    importJobId: number;
    oneBasedDataRow: number;
    rowDigest: string;
}>): SalesDataMovementObjectAudit;
/** Canonical survivor/merged audit transition, bound to immutable lineage identity before post-row digests exist. */
export declare function createSalesMergeAuditTransition(input: Readonly<{
    resourceId: string;
    applicationId: string;
    environment: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
    preRevision: number;
    role: "survivor" | "merged";
    lineageId: string;
}>): SalesDataMovementObjectAudit;
export type SalesImportMapping = Readonly<{
    header: string;
    fieldId: string;
}>;
export type SalesParsedImportRow = Readonly<{
    oneBasedDataRow: number;
    values: Readonly<Record<string, string | number | null>>;
    rowDigest: string;
    state: "pending";
}>;
export type SalesImportDiagnostic = Readonly<{
    oneBasedDataRow: number;
    code: "IMPORT_REQUIRED_VALUE" | "IMPORT_VALUE_INVALID";
}>;
export type SalesImportDryRun = Readonly<{
    headers: readonly string[];
    rows: readonly SalesParsedImportRow[];
    diagnostics: readonly SalesImportDiagnostic[];
    chunks: readonly Readonly<{
        chunkIndex: number;
        rowStart: number;
        rowEndExclusive: number;
        state: "queued";
        attempt: 0;
        leaseRevision: 1;
    }>[];
    uploadDigest: string;
    diagnosticDigest: string;
    acceptedRows: number;
    rejectedRows: number;
}>;
/** Strict UTF-8/RFC4180 validation; fatal input never produces a durable job. */
export declare function parseSalesImportCsv(bytes: Uint8Array, target: SalesImportTarget, mapping: readonly SalesImportMapping[]): SalesImportDryRun;
export declare function normalizeSalesDedupeValue(kind: "account-name" | "contact-email" | "contact-phone", value: string): string | null;
export declare function salesDedupeMatch(target: SalesDedupeTarget, subject: Readonly<Record<string, unknown>>, candidate: Readonly<Record<string, unknown>>): SalesDedupeMatchKind | null;
export declare function buildSalesExportCsv(selectedFields: readonly string[], rows: readonly Readonly<Record<string, unknown>>[]): Uint8Array;
export declare const salesMergeRelationIds: Readonly<{
    "sales.object.account": readonly string[];
    "sales.object.contact": readonly string[];
}>;
export declare function planSalesMerge(input: Readonly<{
    targetObjectType: SalesDedupeTarget;
    winner: Readonly<Record<string, unknown>>;
    winnerExpectedRevision: number;
    loser: Readonly<Record<string, unknown>>;
    loserExpectedRevision: number;
    actorId: string;
    authorizationRevision: number;
    lineageId: string;
    committedAt: string;
    relationCounts: Readonly<Record<string, number>>;
}>): Readonly<{
    winnerPost: Readonly<{
        revision: number;
    }>;
    loserPost: Readonly<{
        revision: number;
        status: string;
        mergedIntoId: number;
    }>;
    lineage: Readonly<{
        lineageId: string;
        applicationId: string;
        environment: string;
        targetObjectType: SalesDedupeTarget;
        winnerId: number;
        winnerPreRevision: number;
        winnerPostRevision: number;
        loserId: number;
        loserPreRevision: number;
        loserPostRevision: number;
        matchKind: SalesDedupeMatchKind;
        normalizerVersion: "node24.19-unicode17-v1";
        actorId: string;
        authorizationRevision: number;
        winnerPreDigest: string;
        winnerPostDigest: string;
        loserPreDigest: string;
        loserPostDigest: string;
        rewrittenRelationCounts: Readonly<{
            relationId: string;
            count: number;
        }>[];
        committedAt: string;
    }>;
    lineageDigest: string;
}>;
type MovementActionCall = Readonly<{
    input: Readonly<Record<string, unknown>>;
    idempotencyKey: string;
    signal: AbortSignal;
}>;
type MovementSourceCall = Readonly<{
    input: Readonly<Record<string, unknown>>;
    query: DataSourceQueryControls;
    selectedFields: readonly string[];
    signal: AbortSignal;
}>;
/** Request-scoped persistence authority. The host owns transactions, locks, reauthorization, leases, and artifact storage. */
export interface SalesDataMovementStore {
    dryRunImport(call: MovementActionCall): Promise<unknown>;
    commitImport(call: MovementActionCall): Promise<unknown>;
    cancelImport(call: MovementActionCall): Promise<unknown>;
    createExport(call: MovementActionCall): Promise<unknown>;
    cancelExport(call: MovementActionCall): Promise<unknown>;
    mergeRecords(call: MovementActionCall): Promise<unknown>;
    listImportJobs(call: MovementSourceCall): Promise<unknown>;
    getImportJob(call: MovementSourceCall): Promise<unknown>;
    listExportJobs(call: MovementSourceCall): Promise<unknown>;
    getExportJob(call: MovementSourceCall): Promise<unknown>;
    findDedupeCandidates(call: MovementSourceCall): Promise<unknown>;
}
export declare const salesDataMovementActionHandler: ActionHandler;
export declare const salesDataMovementActionDefinitions: readonly ActionDefinition[];
export declare const salesImportJobListHandler: DataSourceHandler;
export declare const salesImportJobDetailHandler: DataSourceHandler;
export declare const salesExportJobListHandler: DataSourceHandler;
export declare const salesExportJobDetailHandler: DataSourceHandler;
export declare const salesDedupeCandidatesHandler: DataSourceHandler;
export declare const salesImportJobListDefinition: DataSourceDefinition;
export declare const salesImportJobDetailDefinition: DataSourceDefinition;
export declare const salesExportJobListDefinition: DataSourceDefinition;
export declare const salesExportJobDetailDefinition: DataSourceDefinition;
export declare const salesDedupeCandidatesDefinition: DataSourceDefinition;
/** Closed underlying grants prevent reports from treating sales.reports.read as a substitute for CRM object/field authority. */
export declare const salesReportPermissionGrants: readonly ["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"];
export declare const salesReportObjectPermissionGrants: readonly ["sales.activities.read", "sales.leads.read", "sales.opportunities.read", "sales.pipelines.read", "sales.tasks.read"];
export declare const salesReportFieldPermissionGrants: readonly ["sales.opportunities.amount.read"];
type SalesReportPermissionGrant = typeof salesReportPermissionGrants[number];
type SalesReportObjectPermissionGrant = typeof salesReportObjectPermissionGrants[number];
type SalesReportFieldPermissionGrant = typeof salesReportFieldPermissionGrants[number];
/** Current server-owned authority/settings facts. The host must lock and recheck these with every report aggregation or durable delivery transition. */
export type SalesReportingAuthority = Readonly<{
    readonly authorizationRevision: number;
    readonly lifecycleRevision: number;
    readonly salesScopeRevision: number;
    readonly settingsRevision: number;
    readonly reportingTimezone: string;
    readonly reportingCurrency: string;
    readonly runtimeGenerationId: string;
    readonly reportPermissionGrants: readonly SalesReportPermissionGrant[];
    readonly objectPermissionGrants: readonly SalesReportObjectPermissionGrant[];
    readonly fieldPermissionGrants: readonly SalesReportFieldPermissionGrant[];
}>;
export type SalesReportResult = Readonly<{
    readonly applicationId: string;
    readonly environment: string;
    readonly actorId: string;
    readonly authority: SalesReportingAuthority;
    readonly reportId: SalesReportId;
    readonly windowMode: "as-of" | SalesReportWindowMode;
    readonly query: DataSourceQueryControls;
    readonly selectedFields: readonly string[];
    readonly recordScope: unknown;
}>;
export type SalesReportResultMetadata = import("@k-nex/contracts").DataSourceReportExecution;
export type SalesReportReadResult = Readonly<{
    readonly data: unknown;
    readonly metadata: SalesReportResultMetadata;
}>;
export type SalesReportActionCall = Readonly<{
    readonly applicationId: string;
    readonly environment: string;
    readonly actorId: string;
    readonly authority: SalesReportingAuthority;
    readonly idempotencyKey: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly signal: AbortSignal;
}>;
/** Composition owns persistence, current authorization rechecks, settings revisions, fencing, audit and outbox. */
export interface SalesReportingGateway {
    read(input: SalesReportResult): Promise<SalesReportReadResult>;
    run(input: SalesReportActionCall): Promise<unknown>;
    schedule(input: SalesReportActionCall): Promise<unknown>;
}
export declare const salesPipelineValueByStageHandler: DataSourceHandler;
export declare const salesWeightedForecastHandler: DataSourceHandler;
export declare const salesWonLostConversionHandler: DataSourceHandler;
export declare const salesLeadConversionHandler: DataSourceHandler;
export declare const salesActivityByOwnerTeamHandler: DataSourceHandler;
export declare const salesTaskAgingHandler: DataSourceHandler;
export declare const salesSalesCycleDurationHandler: DataSourceHandler;
export declare const salesPipelineValueByStageDefinition: DataSourceDefinition;
export declare const salesWeightedForecastDefinition: DataSourceDefinition;
export declare const salesWonLostConversionDefinition: DataSourceDefinition;
export declare const salesLeadConversionDefinition: DataSourceDefinition;
export declare const salesActivityByOwnerTeamDefinition: DataSourceDefinition;
export declare const salesTaskAgingDefinition: DataSourceDefinition;
export declare const salesSalesCycleDurationDefinition: DataSourceDefinition;
export declare const salesReportActionHandler: ActionHandler;
export declare const salesReportActionDefinitions: readonly ActionDefinition[];
/** The host supplies the fenced durable queue implementation; Sales never receives a database or transport capability. */
export interface SalesReportDeliveryGateway {
    process(): Promise<unknown>;
}
export declare function salesReportDeliveryJob(input: Readonly<{
    gateway: SalesReportDeliveryGateway;
}>): Promise<unknown>;
export { salesCreateTaskToolDescriptor, salesNavigationDescriptors, salesReferenceMetadata, salesRouteDescriptors, salesSearchTasksDescriptor, salesTaskCreateDescriptor, salesTaskPageTemplate, salesTasksDescriptor, salesTimelineDescriptor, salesTimelineFields, salesTimelineInputRuntimeSchema, salesWorkspaceSettingsDescriptor } from "./contracts.js";
export { salesCrmActionDescriptors, salesCrmObjectFieldActionMatrix, salesCrmPermissionDescriptors, salesCrmPermissionPolicyBindings, salesCrmRoleTemplates, salesCrmRouteDescriptors } from "./crm-authority.js";
export interface SalesSavedViewMutationAuthority {
    readonly ownerId: string;
    readonly visibility: "personal" | "team";
    readonly visibilityTeamId: string | null;
}
export type SalesCommunicationRelationAdmission = Readonly<{
    actionId: "sales.email.send" | "sales.calendar.sync" | "sales.reminder.schedule";
    recordType: "sales.contact" | "sales.lead" | "sales.task" | "sales.activity";
    recordId: string;
    applicationId: string;
    environment: string;
    revision: number;
    status: "active" | "new" | "working" | "open" | "scheduled";
    archiveStatus: "active" | null;
    ownerId: string;
    teamId: string | null;
}>;
interface SalesAuditEntry {
    readonly actionId: string;
    readonly resourceId: string;
    readonly applicationId: string;
    readonly environment: string;
    readonly fromState: string;
    readonly toState: string;
    readonly occurredAt: string;
    readonly actorId: string;
    readonly revision: number;
    readonly idempotencyKey: string;
    readonly ownershipGenesis?: Readonly<{
        ownerId: string;
        teamId: string | null;
    }>;
    readonly ownership?: Readonly<{
        oldOwnerId: string;
        newOwnerId: string;
        oldTeamId: string | null;
        newTeamId: string | null;
    }>;
    readonly dataMovement?: Readonly<{
        kind: "import";
        importJobId: number;
        oneBasedDataRow: number;
        rowDigest: string;
    } | {
        kind: "merge";
        role: "survivor" | "merged";
        lineageId: string;
    }>;
}
export declare const salesEventAfterChange: CollectionAfterChangeHook;
export declare function createSalesRealtimeRelay(gateway: Parameters<typeof createOutboxRealtimeRelay>[0]["gateway"]): import("@k-nex/payload-adapter").OutboxSubscriber;
export declare function salesPipelineAuditJob(input: {
    readonly opportunities: readonly {
        readonly stage: "qualification" | "discovery" | "proposal" | "negotiation" | "won" | "lost";
    }[];
    readonly signal: AbortSignal;
}): Readonly<{
    pluginId: "module.sales";
    jobId: "sales.job.pipeline-audit";
    stageCounts: Readonly<{
        qualification: number;
        discovery: number;
        proposal: number;
        negotiation: number;
        won: number;
        lost: number;
    }>;
}>;
/** The host owns provider delivery; this bounded job admits only the fenced delivery intent. */
export declare function salesReminderDeliveryJob(input: Readonly<{
    reminderId: string;
    applicationId: string;
    environment: string;
    recipientId: string;
    fencingToken: number;
    signal: AbortSignal;
}>): Readonly<{
    pluginId: "module.sales";
    jobId: "sales.job.reminder-delivery";
    reminderId: string;
    fencingToken: number;
}>;
/** Trusted host owns the fenced PostgreSQL workflow processor; Sales only exposes its fixed job identity. */
export interface SalesCrmWorkflowExecutionGateway {
    process(): Promise<unknown>;
}
export declare function salesCrmWorkflowExecutionJob(input: Readonly<{
    gateway: SalesCrmWorkflowExecutionGateway;
}>): Promise<unknown>;
export declare const salesPipelineStageNamespace = "13f5fa89-b465-5a7a-a19d-74ed6c5d1ef4";
export declare const salesPipelineStageSemantics: readonly ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
/** Exact ADR-0028 UUIDv5 derivation; stage names never participate in identity. */
export declare function salesPipelineStageId(applicationId: string, environment: string, pipelineStableId: number, semantic: typeof salesPipelineStageSemantics[number]): string;
export interface SalesPersistedSavedView {
    readonly id: number;
    readonly revision: number;
    readonly applicationId: string;
    readonly environment: string;
    readonly ownerId: string;
    readonly visibility: SalesSavedViewVisibility;
    readonly definition: SalesSavedViewDefinition;
    readonly status: "active" | "archived";
}
export interface SalesSavedViewMetadataScope {
    readonly applicationId: string;
    readonly environment: string;
    readonly savedViewId: number;
    readonly savedViewRevision: number;
    readonly ownerId: string;
    readonly visibility: SalesSavedViewVisibility;
}
export interface SalesSavedViewTargetRecordScope {
    readonly kind: "sales.accounts" | "sales.contacts" | "sales.leads" | "sales.opportunities" | "sales.tasks" | "sales.activities";
    readonly where: unknown;
}
export interface SalesSavedViewFieldAuthority {
    readonly fieldId: string;
    readonly select: boolean;
    readonly filter: boolean;
    readonly sort: boolean;
}
export interface SalesSavedViewExecutionPersistence {
    readonly lockSavedView: (id: number) => Promise<SalesPersistedSavedView | undefined>;
    readonly resolveDefaultSavedView: (sourceId: SalesSavedViewSourceId) => Promise<SalesPersistedSavedView | undefined>;
    readonly authorizationRevision: () => Promise<number>;
    readonly sourceRevision: (sourceId: SalesSavedViewSourceId) => Promise<number>;
    readonly authorizeView: (view: SalesPersistedSavedView) => Promise<boolean>;
    readonly authorizeTarget: (view: SalesPersistedSavedView) => Promise<boolean>;
    readonly authorizeFields: (view: SalesPersistedSavedView) => Promise<boolean>;
    readonly targetRecordScope: (view: SalesPersistedSavedView) => Promise<SalesSavedViewTargetRecordScope | undefined>;
    readonly fieldAuthority: (view: SalesPersistedSavedView) => Promise<readonly SalesSavedViewFieldAuthority[]>;
    readonly reportingTimezone: () => Promise<SalesReportingTimezone>;
}
export interface SalesSavedViewExecutionRequest {
    readonly sourceId: SalesSavedViewSourceId;
    readonly bindingInput: SalesSavedViewBindingInput;
    readonly selectedFields: readonly string[];
    readonly pageNumber: number;
    readonly applicationId: string;
    readonly environment: string;
    readonly actorId: string;
    readonly persistence: SalesSavedViewExecutionPersistence;
}
export interface SalesSavedViewExecutionFence {
    readonly savedViewId: number;
    readonly savedViewRevision: number;
    readonly sourceId: SalesSavedViewSourceId;
    readonly sourceRevision: number;
    readonly authorizationRevision: number;
    readonly targetRecordScope: SalesSavedViewTargetRecordScope;
    readonly fieldAuthority: readonly SalesSavedViewFieldAuthority[];
    readonly reportingTimezone?: SalesReportingTimezone;
}
export type SalesResolvedSavedViewExecution = Readonly<{
    gatewayInput: SalesSavedViewBindingInput;
    targetObjectId?: SalesSavedViewDefinition["targetObjectId"];
    metadataScope?: SalesSavedViewMetadataScope;
    targetRecordScope?: SalesSavedViewTargetRecordScope;
    fieldAuthority?: readonly SalesSavedViewFieldAuthority[];
    selectedFields: readonly string[];
    query: DataSourceQueryControls;
    fence?: SalesSavedViewExecutionFence;
    empty: boolean;
}>;
/** Locks current visibility/target/field authority and returns one request-local execution plan. */
export declare function resolveSalesSavedViewExecution(input: SalesSavedViewExecutionRequest): Promise<SalesResolvedSavedViewExecution>;
/** Must run after gateway execution and before cache/result publication. */
export declare function recheckSalesSavedViewExecution(input: Readonly<{
    fence: SalesSavedViewExecutionFence;
    applicationId: string;
    environment: string;
    persistence: SalesSavedViewExecutionPersistence;
}>): Promise<void>;
export declare const salesAccountsHandler: DataSourceHandler;
export declare const salesAccountDetailHandler: DataSourceHandler;
export declare const salesContactsHandler: DataSourceHandler;
export declare const salesContactDetailHandler: DataSourceHandler;
export declare const salesLeadsHandler: DataSourceHandler;
export declare const salesLeadDetailHandler: DataSourceHandler;
export declare const salesOpportunityDetailHandler: DataSourceHandler;
export declare const salesNotificationsHandler: DataSourceHandler;
export declare const salesRemindersHandler: DataSourceHandler;
export type SalesProviderConfigurationProjection = Readonly<{
    readonly providerId: "email.reference.v1" | "calendar.reference.v1";
    readonly state: "active" | "revoked";
    readonly revision: number;
    readonly updatedAt: string;
    readonly revokedAt: string | null;
}>;
/** Host-owned read authority. Returned shape cannot represent secret references or values. */
export interface SalesProviderConfigurationReadGateway {
    read(input: Readonly<{
        applicationId: string;
        environment: string;
        actorId: string;
    }>): Promise<readonly SalesProviderConfigurationProjection[]>;
}
export declare const salesProviderConfigurationsHandler: DataSourceHandler;
export type SalesProviderIntent = Readonly<{
    readonly actionId: "sales.email.send" | "sales.calendar.sync" | "sales.integration.configure";
    readonly idempotencyKey: string;
    readonly relatedRecord: Readonly<{
        readonly type: "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity" | "sales.task";
        readonly id: number;
    }> | null;
    readonly payload: Readonly<Record<string, unknown>>;
}>;
export type SalesProviderResult = Readonly<{
    readonly operationId: string;
    readonly state: "queued" | "accepted";
    readonly providerId: "email.reference.v1" | "calendar.reference.v1";
    readonly receipt: Readonly<{
        readonly idempotencyDigest: string;
        readonly relatedRecord: SalesProviderIntent["relatedRecord"];
    }>;
}>;
/** Host-owned narrow provider authority. It resolves channel/secret references; Sales receives neither. */
export interface SalesProviderGateway {
    dispatch(intent: SalesProviderIntent): Promise<SalesProviderResult>;
}
export type SalesRecipientAuditCollection = "sales-notifications" | "sales-reminders";
export type SalesRecipientAuditIdentity = Readonly<{
    resourceId: string;
    applicationId: string;
    environment: string;
    revision: number;
    state: string;
}>;
export type SalesRecipientAuditEntryInput = Readonly<{
    actionId: string;
    resourceId: string;
    applicationId: string;
    environment: string;
    fromState: string;
    toState: string;
    occurredAt: string;
    actorId: string;
    revision: number;
    idempotencyKey: string;
}>;
/** Exact host/Sales recipient delivery chain; source row revision and final state are both fenced. */
export declare function validateSalesRecipientAuditHistory(value: unknown, collection: SalesRecipientAuditCollection, identity: SalesRecipientAuditIdentity): readonly SalesAuditEntry[];
export declare function createSalesRecipientAuditEntry(input: SalesRecipientAuditEntryInput, collection: SalesRecipientAuditCollection): SalesAuditEntry;
export declare function appendSalesRecipientAudit(history: unknown, collection: SalesRecipientAuditCollection, identity: SalesRecipientAuditIdentity, input: SalesRecipientAuditEntryInput): readonly SalesAuditEntry[];
/** P13.6 bounded provider and recipient delivery actions. Host capability injection is the only provider boundary. */
export declare const salesCommunicationActionHandler: ActionHandler;
export declare const salesCommunicationActionDefinitions: readonly ActionDefinition[];
/** A related-record first check prevents a timeline row from widening the target's Sales scope. */
export declare const salesTimelineHandler: DataSourceHandler;
export declare const salesTasksDefinition: DataSourceDefinition;
export declare const salesOpportunitiesDefinition: DataSourceDefinition;
export declare const salesAccountsDefinition: DataSourceDefinition;
export declare const salesAccountDetailDefinition: DataSourceDefinition;
export declare const salesContactsDefinition: DataSourceDefinition;
export declare const salesContactDetailDefinition: DataSourceDefinition;
export declare const salesLeadsDefinition: DataSourceDefinition;
export declare const salesLeadDetailDefinition: DataSourceDefinition;
export declare const salesOpportunityDetailDefinition: DataSourceDefinition;
export declare const salesTimelineDefinition: DataSourceDefinition;
export declare const salesPipelineSnapshotOutputRuntimeSchema: RuntimeSchema<{
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesSavedViewListOutputRuntimeSchema: RuntimeSchema<{
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesSavedViewDetailOutputRuntimeSchema: RuntimeSchema<{
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesSavedViewTableOutputRuntimeSchema: RuntimeSchema<{
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesSavedViewKanbanOutputRuntimeSchema: RuntimeSchema<{
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesSavedViewCalendarOutputRuntimeSchema: RuntimeSchema<{
    fields: string[];
    rows: {
        key: string;
        values: Record<string, {
            kind: "text";
            value: string;
        } | {
            kind: "integer";
            value: number;
        } | {
            kind: "number";
            value: number;
        } | {
            kind: "decimal";
            value: string;
            scale: number;
            unit?: string | undefined;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "money";
            value: string;
            currency: string;
            scale: number;
            rounding?: "half-up" | "half-even" | "toward-zero" | "away-from-zero" | undefined;
        } | {
            kind: "datetime";
            value: string;
        } | {
            kind: "date";
            value: string;
        } | {
            kind: "boolean";
            value: boolean;
        } | {
            kind: "status";
            value: string;
        } | {
            kind: "enum";
            value: string;
        } | {
            kind: "resource";
            resourceType: string;
            id: string;
            label: string;
            route: {
                routeId: string;
                params: Record<string, string>;
            };
        } | null>;
    }[];
    page: {
        number: number;
        pageSize: number;
        hasNext: boolean;
        nextCursor?: string | undefined;
    };
}>;
export declare const salesPipelineSnapshotDefinition: DataSourceDefinition;
export declare const salesSavedViewListDefinition: DataSourceDefinition;
export declare const salesSavedViewDetailDefinition: DataSourceDefinition;
export declare const salesSavedViewTableDefinition: DataSourceDefinition;
export declare const salesSavedViewKanbanDefinition: DataSourceDefinition;
export declare const salesSavedViewCalendarDefinition: DataSourceDefinition;
export declare const salesPipelineSnapshotHandler: DataSourceHandler;
export declare const salesSavedViewListHandler: DataSourceHandler;
export declare const salesSavedViewDetailHandler: DataSourceHandler;
export declare const salesSavedViewTableHandler: DataSourceHandler;
export declare const salesSavedViewKanbanHandler: DataSourceHandler;
export declare const salesSavedViewCalendarHandler: DataSourceHandler;
export declare const salesTasksHandler: DataSourceHandler;
export declare const salesOpportunitiesHandler: DataSourceHandler;
export declare const salesTaskCreateDefinition: ActionDefinition<CreateTaskInput, CreateTaskOutput>;
export declare const salesTaskUpdateDefinition: ActionDefinition<UpdateTaskInput, UpdateTaskOutput>;
export declare const salesOpportunityStageUpdateDefinition: ActionDefinition<UpdateOpportunityStageInput, UpdateOpportunityStageOutput>;
export declare const salesTaskCreateHandler: ActionHandler<CreateTaskInput, CreateTaskOutput>;
export declare const salesTaskUpdateHandler: ActionHandler<UpdateTaskInput, UpdateTaskOutput>;
export declare const salesOpportunityStageUpdateHandler: ActionHandler<UpdateOpportunityStageInput, UpdateOpportunityStageOutput>;
declare const workflowActions: Readonly<{
    readonly "sales.account.create": {
        readonly collection: "sales-accounts";
        readonly event: "sales.event.account-changed";
        readonly stateField: "status";
        readonly state: "active";
    };
    readonly "sales.account.update": {
        readonly collection: "sales-accounts";
        readonly event: "sales.event.account-changed";
        readonly stateField: "status";
    };
    readonly "sales.account.archive": {
        readonly collection: "sales-accounts";
        readonly event: "sales.event.account-changed";
        readonly stateField: "status";
        readonly state: "archived";
    };
    readonly "sales.contact.create": {
        readonly collection: "sales-contacts";
        readonly event: "sales.event.contact-changed";
        readonly stateField: "status";
        readonly state: "active";
    };
    readonly "sales.contact.update": {
        readonly collection: "sales-contacts";
        readonly event: "sales.event.contact-changed";
        readonly stateField: "status";
    };
    readonly "sales.contact.archive": {
        readonly collection: "sales-contacts";
        readonly event: "sales.event.contact-changed";
        readonly stateField: "status";
        readonly state: "archived";
    };
    readonly "sales.lead.create": {
        readonly collection: "sales-leads";
        readonly event: "sales.event.lead-changed";
        readonly stateField: "status";
        readonly state: "new";
    };
    readonly "sales.lead.update": {
        readonly collection: "sales-leads";
        readonly event: "sales.event.lead-changed";
        readonly stateField: "status";
    };
    readonly "sales.lead.qualify": {
        readonly collection: "sales-leads";
        readonly event: "sales.event.lead-changed";
        readonly stateField: "status";
        readonly state: "qualified";
    };
    readonly "sales.lead.disqualify": {
        readonly collection: "sales-leads";
        readonly event: "sales.event.lead-changed";
        readonly stateField: "status";
        readonly state: "disqualified";
    };
    readonly "sales.lead.archive": {
        readonly collection: "sales-leads";
        readonly event: "sales.event.lead-changed";
        readonly stateField: "archiveStatus";
        readonly state: "archived";
    };
    readonly "sales.opportunity.create": {
        readonly collection: "sales-opportunities";
        readonly event: "sales.event.opportunity-changed";
        readonly stateField: "stageId";
    };
    readonly "sales.opportunity.update": {
        readonly collection: "sales-opportunities";
        readonly event: "sales.event.opportunity-changed";
        readonly stateField: "stageId";
    };
    readonly "sales.opportunity.close": {
        readonly collection: "sales-opportunities";
        readonly event: "sales.event.opportunity-changed";
        readonly stateField: "stageId";
    };
    readonly "sales.opportunity.archive": {
        readonly collection: "sales-opportunities";
        readonly event: "sales.event.opportunity-changed";
        readonly stateField: "archiveStatus";
        readonly state: "archived";
    };
    readonly "sales.activity.create": {
        readonly collection: "sales-activities";
        readonly event: "sales.event.timeline-changed";
        readonly stateField: "status";
        readonly state: "scheduled";
    };
    readonly "sales.activity.complete": {
        readonly collection: "sales-activities";
        readonly event: "sales.event.timeline-changed";
        readonly stateField: "status";
        readonly state: "completed";
    };
    readonly "sales.activity.cancel": {
        readonly collection: "sales-activities";
        readonly event: "sales.event.timeline-changed";
        readonly stateField: "status";
        readonly state: "cancelled";
    };
    readonly "sales.note.create": {
        readonly collection: "sales-notes";
        readonly event: "sales.event.timeline-changed";
        readonly stateField: "status";
        readonly state: "recorded";
    };
    readonly "sales.attachment.link": {
        readonly collection: "sales-attachment-references";
        readonly event: "sales.event.timeline-changed";
        readonly stateField: "status";
        readonly state: "active";
    };
    readonly "sales.attachment.remove": {
        readonly collection: "sales-attachment-references";
        readonly event: "sales.event.timeline-changed";
        readonly stateField: "status";
        readonly state: "removed";
    };
}>;
type WorkflowActionId = keyof typeof workflowActions;
type WorkflowActionInput = Readonly<Record<string, unknown>>;
type WorkflowActionOutput = Readonly<{
    id: string;
    revision: number;
    status?: string;
    pipelineId?: string;
    stageId?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
}>;
type WorkflowCollection = typeof workflowActions[WorkflowActionId]["collection"];
export declare const salesWorkflowActionDefinitions: readonly ActionDefinition<WorkflowActionInput, WorkflowActionOutput>[];
export type SalesStateHistoryEntry = Readonly<{
    actionId: string;
    stateField: "status" | "stageId" | "archiveStatus";
    fromState: string;
    toState: string;
    revision: number;
    occurredAt: string;
}>;
/** Validates the complete private audit chain before exposing only the newest safe state transitions. */
export declare function projectSalesStateHistory(input: Readonly<{
    audit: unknown;
    collection: WorkflowCollection;
    id: string;
    applicationId: string;
    environment: string;
    revision: number;
    ownerId: string;
    teamId?: string | null;
    currentState: string;
    currentStateField: "status" | "stageId" | "archiveStatus";
    archiveStatus?: string;
}>): readonly SalesStateHistoryEntry[];
/** Fixed P13.3 CRM actions; every record mutation remains scoped by host authorization and CAS. */
export declare const salesWorkflowActionHandler: ActionHandler<WorkflowActionInput, WorkflowActionOutput>;
export declare const salesConfigurationActionDefinitions: readonly ActionDefinition[];
/** Configuration mutations execute inside the action endpoint's already-open Postgres transaction. */
export declare const salesConfigurationActionHandler: ActionHandler;
type OwnershipRecordType = "sales.account" | "sales.contact" | "sales.lead" | "sales.opportunity";
type OwnershipInput = Readonly<{
    recordType: OwnershipRecordType;
    id: string;
    expectedRevision: number;
    ownerId: string;
    teamId?: string;
}>;
type OwnershipOutput = Readonly<{
    recordType: OwnershipRecordType;
    id: string;
    revision: number;
    ownerId: string;
    teamId?: string;
}>;
export declare const salesOwnershipAssignHandler: ActionHandler<OwnershipInput, OwnershipOutput>;
export declare const salesOwnershipAssignDefinition: ActionDefinition<OwnershipInput, OwnershipOutput>;
export declare const salesTasksCollection: CollectionConfig;
export declare const salesOpportunitiesCollection: CollectionConfig;
export declare const salesAccountsCollectionWithEvents: CollectionConfig;
export declare const salesContactsCollectionWithEvents: CollectionConfig;
export declare const salesLeadsCollectionWithEvents: CollectionConfig;
export declare const salesActivitiesCollectionWithEvents: CollectionConfig;
export declare const salesNotesCollectionWithEvents: CollectionConfig;
export declare const salesAttachmentReferencesCollectionWithEvents: CollectionConfig;
export declare const salesPipelinesCollectionWithEvents: CollectionConfig;
export declare const salesSavedViewsCollectionWithEvents: CollectionConfig;
export declare const salesNotificationsCollectionWithEvents: CollectionConfig;
export declare const salesRemindersCollectionWithEvents: CollectionConfig;
export { salesAccountsCollection, salesActivitiesCollection, salesAttachmentReferencesCollection, salesContactsCollection, salesLeadsCollection, salesNotesCollection, salesNotificationsCollection, salesPipelinesCollection, salesPipelineStagesCollection, salesRemindersCollection, salesCoreCollectionSlugs, salesRelatedRecordTypes };
export declare const salesCoreCollections: readonly CollectionConfig[];
export declare const salesDefaultSettings: Readonly<Record<string, string | number | boolean | string[] | {
    kind: "secret-reference";
    provider: "environment";
    key: string;
} | null>>;
/** Static domain policy executors bound by the host to the exact Sales generation. */
export declare const salesPermissionPolicyExecutors: Readonly<{
    [k: string]: PlatformPluginPolicyExecutor;
}>;
export declare const salesRegistration: Readonly<{
    readonly pluginId: "module.sales";
    readonly contracts: (context: import("@k-nex/runtime").ContractsRegistrationContext) => void;
    readonly schema: (context: import("@k-nex/runtime").SchemaRegistrationContext) => void;
    readonly behavior: (context: import("@k-nex/runtime").BehaviorRegistrationContext) => void;
    readonly jobs: (context: import("@k-nex/runtime").JobsRegistrationContext) => void;
    readonly dataHandlers: (context: import("@k-nex/runtime").DataHandlersRegistrationContext) => void;
    readonly ui: (context: import("@k-nex/runtime").UiRegistrationContext) => void;
    readonly validate: (context: import("@k-nex/runtime").ValidateRegistrationContext) => void;
}>;
//# sourceMappingURL=server.d.ts.map