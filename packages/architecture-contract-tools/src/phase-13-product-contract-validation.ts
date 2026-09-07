import { createHash } from "node:crypto";

import { ActionDescriptorSchema, AgentToolJsonSchemaSchema, canonicalJson, DataSourceDescriptorSchema, PluginPageTemplateDescriptorSchema, PluginRouteDescriptorSchema, PluginUiContributionDescriptorSchema, TableRecordsSchema } from "@k-nex/contracts";

import type { RepositoryDiagnostic } from "./repository-validation.js";

const sourcePath = "contracts/phase-13-crm-product-contract.v1.json";
const salesId = /^sales\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const requiredObjectIds = ["sales.object.account", "sales.object.contact", "sales.object.lead", "sales.object.opportunity", "sales.object.pipeline", "sales.object.pipeline-stage", "sales.object.activity", "sales.object.task", "sales.object.note", "sales.object.attachment-reference", "sales.object.saved-view", "sales.object.import-job", "sales.object.export-job", "sales.object.notification", "sales.object.reminder"];
const requiredOwnerIds = ["product.sales", "engineering.sales", "platform.security", "platform.operations"];
const requiredPersonaIds = ["sales.representative", "sales.manager", "sales.administrator", "sales.viewer-auditor"];
const requiredMetricIds = ["sales.metric.pipeline-value-by-stage", "sales.metric.weighted-forecast", "sales.metric.won-lost-conversion", "sales.metric.lead-conversion", "sales.metric.activity-by-owner-team", "sales.metric.task-aging", "sales.metric.sales-cycle-duration"];
const requiredProtectedFields = ["id", "applicationId", "environment", "ownerId", "teamId", "createdAt", "createdBy", "updatedAt", "updatedBy", "revision", "audit", "status", "state", "stageId", "archiveStatus", "mergedIntoId", "mergeLineage"];
const requiredRelatedRecordTargets = ["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"];
const requiredAttackIds = Array.from({ length: 15 }, (_, index) => `P13-ATK-${String(index + 1).padStart(2, "0")}`);
const taskId = /^P13\.(?:2|3|4|5|6|7|8|9|10)$/;
const acceptedContractDigest = "sha256:2ca5ae26d88632a5c200c9299809263fd12f0631a48c0b909f710f4210a86295";
const opportunityStateSource = "locked referenced pipeline-stage.semantic only; stage ID spelling never denotes state";
const pipelineStageOpaqueIdMigration = "P13.4 uses fixed UUIDv5 bytes and receipt-bound mapping to atomically rewrite only mutable stage ID and allowed-transition references; immutable audit, idempotency request/result, and published-document evidence stays byte-preserved";
const pipelineSemantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
const uuidV5Pattern = "^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const executionSourceIds = ["sales.saved-view.table", "sales.saved-view.kanban", "sales.saved-view.calendar"];
const administrationSourceIds = ["sales.pipeline.snapshot", "sales.saved-view.list", "sales.saved-view.detail"];
const savedViewSourceIds = [...executionSourceIds, ...administrationSourceIds];
const savedViewTargetIds = ["sales.object.account", "sales.object.contact", "sales.object.lead", "sales.object.opportunity", "sales.object.task", "sales.object.activity"];
const sourceLimits = { maxSelectedFields: 8, maxPageSize: 100, maxFilters: 8, maxSorts: 2, maxBodyBytes: 32_768, maxResultBytes: 1_048_576, maxDepth: 6, timeoutMs: 5_000, maxConcurrency: 4, ratePerMinute: 300, burst: 30, costClass: "medium", maxCost: 100 };

function sourceField(id: string, kind: string, binding: "required" | "optional", nullable: boolean, permission: string, sortable: boolean, filterOperators: string[]): Record<string, unknown> {
  return { id, kind, binding, nullable, permission, sortable, filterOperators };
}

const textOperators = ["eq", "neq", "in", "not-in", "contains", "starts-with", "is-null", "is-not-null"];
const enumOperators = ["eq", "neq", "in", "not-in", "is-null", "is-not-null"];
const orderedOperators = ["eq", "neq", "gt", "gte", "lt", "lte", "is-null", "is-not-null"];
const savedViewSourceFields: Record<string, Record<string, unknown>[]> = {
  "sales.saved-view.table": [
    sourceField("name", "text", "optional", false, "sales.saved-views.read", true, textOperators), sourceField("display-name", "text", "optional", false, "sales.saved-views.read", true, textOperators), sourceField("title", "text", "optional", false, "sales.saved-views.read", true, textOperators), sourceField("subject", "text", "optional", false, "sales.saved-views.read", true, textOperators),
    sourceField("type", "enum", "optional", false, "sales.saved-views.read", true, enumOperators), sourceField("source", "enum", "optional", false, "sales.saved-views.read", true, enumOperators), sourceField("owner-id", "text", "optional", false, "sales.saved-views.read", false, []), sourceField("team-id", "text", "optional", true, "sales.saved-views.read", false, []),
    sourceField("status", "status", "optional", false, "sales.saved-views.read", true, enumOperators), sourceField("archive-status", "status", "optional", false, "sales.saved-views.read", true, enumOperators), sourceField("revision", "integer", "optional", false, "sales.saved-views.read", true, orderedOperators), sourceField("account-id", "integer", "optional", true, "sales.saved-views.read", false, orderedOperators),
    sourceField("primary-contact-id", "integer", "optional", true, "sales.saved-views.read", false, []), sourceField("pipeline-id", "integer", "optional", true, "sales.saved-views.read", false, []), sourceField("stage-id", "enum", "optional", true, "sales.saved-views.read", true, enumOperators), sourceField("expected-close-date", "date", "optional", true, "sales.saved-views.read", true, orderedOperators),
    sourceField("amount", "money", "optional", true, "sales.saved-views.read", false, []), sourceField("email", "text", "optional", true, "sales.saved-views.read", false, []), sourceField("phone", "text", "optional", true, "sales.saved-views.read", false, []), sourceField("due-date", "date", "optional", true, "sales.saved-views.read", true, orderedOperators),
    sourceField("related-record-type", "enum", "optional", true, "sales.saved-views.read", false, []), sourceField("related-record-id", "integer", "optional", true, "sales.saved-views.read", false, []), sourceField("scheduled-at", "datetime", "optional", true, "sales.saved-views.read", true, orderedOperators), sourceField("occurred-at", "datetime", "optional", true, "sales.saved-views.read", true, orderedOperators)
  ],
  "sales.saved-view.kanban": [
    sourceField("row-kind", "enum", "required", false, "sales.opportunities.read", false, []), sourceField("name", "text", "required", false, "sales.opportunities.read", true, textOperators), sourceField("stage-id", "enum", "required", false, "sales.opportunities.read", true, enumOperators), sourceField("stage-metadata", "text", "optional", true, "sales.opportunities.read", false, []), sourceField("revision", "integer", "optional", true, "sales.opportunities.read", true, orderedOperators)
  ],
  "sales.saved-view.calendar": [
    sourceField("type", "enum", "required", false, "sales.activities.read", true, enumOperators), sourceField("subject", "text", "required", false, "sales.activities.read", true, textOperators), sourceField("status", "status", "required", false, "sales.activities.read", true, enumOperators), sourceField("scheduled-at", "datetime", "optional", true, "sales.activities.read", true, orderedOperators), sourceField("occurred-at", "datetime", "optional", true, "sales.activities.read", true, orderedOperators), sourceField("related-record-type", "enum", "required", false, "sales.activities.read", false, []), sourceField("related-record-id", "integer", "required", false, "sales.activities.read", false, []), sourceField("revision", "integer", "required", false, "sales.activities.read", true, orderedOperators)
  ]
};

const administrationSourceFields: Record<string, Record<string, unknown>[]> = {
  "sales.pipeline.snapshot": ["pipeline-id:integer", "pipeline-revision:integer", "pipeline-name:text", "stage-id:text", "stage-revision:integer", "semantic:enum", "stage-name:text", "position:integer", "probability-basis-points:integer", "allowed-transition-stage-ids:text", "required-field-ids:text", "status:status"].map((entry) => { const [id, kind] = entry.split(":"); return sourceField(id!, kind!, "required", false, "sales.pipelines.read", false, []); }),
  "sales.saved-view.list": [sourceField("id", "integer", "required", false, "sales.saved-views.read", false, []), sourceField("name", "text", "required", false, "sales.saved-views.read", true, ["eq", "contains"]), sourceField("visibility", "enum", "required", false, "sales.saved-views.read", true, ["eq", "in"]), sourceField("team-id", "text", "optional", true, "sales.saved-views.read", false, []), ...["target-object-id:enum", "view-kind:enum", "revision:integer", "status:status"].map((entry) => { const [id, kind] = entry.split(":"); return sourceField(id!, kind!, "required", false, "sales.saved-views.read", false, []); })],
  "sales.saved-view.detail": [sourceField("id", "integer", "required", false, "sales.saved-views.read", false, []), sourceField("name", "text", "required", false, "sales.saved-views.read", false, []), sourceField("visibility", "enum", "required", false, "sales.saved-views.read", false, []), sourceField("team-id", "text", "optional", true, "sales.saved-views.read", false, []), ...["chunk-index:integer", "chunk-count:integer", "definition-chunk:text", "target-object-id:enum", "view-kind:enum", "revision:integer", "status:status"].map((entry) => { const [id, kind] = entry.split(":"); return sourceField(id!, kind!, "required", false, "sales.saved-views.read", false, []); })]
};

function expectedAdministrationDescriptor(id: string): Record<string, unknown> {
  const pipeline = id === "sales.pipeline.snapshot"; const detail = id === "sales.saved-view.detail";
  const descriptor: Record<string, unknown> = { id, version: 1, ownerPluginId: "module.sales", primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id: `${id}.output`, version: 1 }, audience: "authenticated", surfaces: ["workspace"], permission: pipeline ? "sales.pipelines.read" : "sales.saved-views.read", structuralCompatibilityHash: "", presentationMetadataRevision: 1, title: pipeline ? "Sales pipeline snapshot" : detail ? "Sales saved view detail" : "Sales saved views", inputFields: detail ? [{ id: "saved-view-id", kind: "integer", required: false, nullable: false }] : [], outputFields: administrationSourceFields[id], paginationModes: ["offset"], limits: { ...sourceLimits, maxSelectedFields: pipeline ? 12 : detail ? 11 : 8, maxPageSize: pipeline ? 6 : detail ? 33 : 100, maxFilters: pipeline || detail ? 0 : 2, maxSorts: pipeline || detail ? 0 : 1, ratePerMinute: 120, burst: 12, costClass: "low", maxCost: pipeline || detail ? 14 : 20 }, cacheClass: "authorization-context" };
  descriptor.structuralCompatibilityHash = descriptorStructuralHash(descriptor);
  return descriptor;
}

function descriptorStructuralHash(descriptor: Record<string, unknown>): string {
  const projection = { id: descriptor.id, version: descriptor.version, primaryContract: descriptor.primaryContract, sourceSchema: descriptor.sourceSchema, inputFields: descriptor.inputFields, outputFields: descriptor.outputFields, paginationModes: descriptor.paginationModes, limits: descriptor.limits };
  return `sha256:${createHash("sha256").update(canonicalJson(projection)).digest("hex")}`;
}

function expectedSavedViewDescriptor(id: string): Record<string, unknown> {
  const suffix = id.slice("sales.saved-view.".length);
  const descriptor: Record<string, unknown> = {
    id, version: 1, ownerPluginId: "module.sales", primaryContract: { id: "table.records", version: 1 }, sourceSchema: { id: `${id}.output`, version: 1 }, audience: "authenticated", surfaces: ["workspace"], permission: "sales.saved-views.read", structuralCompatibilityHash: "", presentationMetadataRevision: 1,
    title: `Sales saved ${suffix === "kanban" ? "Kanban" : suffix} view`, inputFields: [{ id: "saved-view-id", kind: "integer", required: false, nullable: false }, { id: "expected-revision", kind: "integer", required: false, nullable: false }], outputFields: savedViewSourceFields[id], paginationModes: ["offset"], limits: { ...sourceLimits, maxSelectedFields: 8 }, cacheClass: "authorization-context"
  };
  descriptor.structuralCompatibilityHash = descriptorStructuralHash(descriptor);
  return descriptor;
}

function diagnostic(code: string, path: string, message: string, remediation: string): RepositoryDiagnostic {
  return { code, message, path, remediation, sourcePath, validator: "phase-13-product-contract" };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => record(item) === undefined ? [] : [record(item)!]) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function duplicateIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((id) => seen.has(id) || !seen.add(id));
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function sameJson(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function exactKeys(value: Record<string, unknown> | undefined, expected: readonly string[]): boolean {
  return value !== undefined && sameSet(Object.keys(value), expected);
}

function validPipelineConfiguration(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined) return false;
  if (!exactKeys(value, ["stageIds", "migration", "activePipeline", "opportunityRevisionAuthority", "semantics", "update", "stageMove", "successorContracts"])) return false;
  const stageIds = record(value.stageIds); const migration = record(value.migration); const update = record(value.update); const updateInput = record(update?.input); const stage = record(update?.stage); const stageMove = record(value.stageMove); const stageMoveInput = record(stageMove?.input); const successors = record(value.successorContracts); const actions = record(successors?.actions); const sources = record(successors?.sources); const contributions = record(successors?.contributions); const pages = record(successors?.pages); const settings = record(successors?.settings);
  const exactUpdateInput = { required: ["id", "expectedRevision", "name", "orderedStageIds", "stages"], additionalProperties: false, id: "canonical persisted pipeline ID", name: "UTF-8 1..120 bytes", orderedStageIds: "exactly six unique current-pipeline UUIDv5 stageId values in contiguous position order", stages: "exactly six entries" };
  const exactStage = { required: ["stageId", "expectedRevision", "semantic", "name", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds"], additionalProperties: false, stageId: "current-pipeline lowercase UUIDv5 re-derived from application, environment, pipelineStableId, and immutable original semantic; mismatch or remap is denied", semantic: "immutable original semantic; each canonical semantic occurs exactly once", name: "UTF-8 1..120 bytes presentation only", position: "unique contiguous integer 0..5 equal to orderedStageIds index", probabilityBasisPoints: "integer 0..10000", allowedTransitionStageIds: "unique current-snapshot stageId values only; cross-pipeline and unknown IDs are denied", requiredFieldIds: "unique camelCase identifiers matching ^[a-z][A-Za-z0-9]{0,63}$" };
  const exactStageMoveInput = { required: ["id", "expectedRevision", "expectedPipelineId", "expectedPipelineRevision", "expectedSourceStageId", "expectedSourceStageRevision", "destinationStageId", "expectedDestinationStageRevision"], additionalProperties: false };
  const goldenVectors = [
    { applicationId: "customer-gate-1", environment: "production", pipelineStableId: "17", semantic: "qualification", uuid: "48a05b92-77d1-5cfc-83af-095f66e0f6f1" },
    { applicationId: "customer-gate-1", environment: "production", pipelineStableId: "17", semantic: "discovery", uuid: "76ad7b41-5584-5d62-ab10-2575df5a8d47" },
    { applicationId: "customer-gate-2", environment: "production", pipelineStableId: "17", semantic: "qualification", uuid: "ded2ffa8-7258-5894-bd25-55a16fdc91c7" },
    { applicationId: "customer-gate-1", environment: "staging", pipelineStableId: "17", semantic: "qualification", uuid: "73f48f2e-37ec-58ff-a37e-671eb5a8dc68" },
    { applicationId: "customer-gate-1", environment: "production", pipelineStableId: "18", semantic: "qualification", uuid: "96367426-5f5c-5fe4-9807-75654572ccbf" }
  ];
  const validStageIds = exactKeys(stageIds, ["format", "pattern", "namespace", "normalizedName", "byteConstruction", "inputBounds", "cleanInstall", "goldenVectors"]) && stageIds?.format === "lowercase UUIDv5" && stageIds.pattern === uuidV5Pattern && stageIds.namespace === "13f5fa89-b465-5a7a-a19d-74ed6c5d1ef4" && stageIds.normalizedName === "phase13/pipeline-stage/v1\0applicationId\0environment\0pipelineStableId\0semantic" && stageIds.byteConstruction === "UTF-8(NFC(phase13/pipeline-stage/v1)) || 0x00 || UTF-8(NFC(applicationId)) || 0x00 || UTF-8(NFC(environment)) || 0x00 || UTF-8(NFC(pipelineStableId)) || 0x00 || UTF-8(NFC(semantic)); the four 0x00 bytes are delimiters and no input value contains U+0000" && sameJson(stageIds.inputBounds, { applicationIdUtf8Bytes: [1, 128], environmentUtf8Bytes: [1, 64], pipelineStableId: "^[1-9][0-9]{0,9}$ and <=2147483647", semantic: pipelineSemantics, normalization: "Unicode NFC before UTF-8; reject U+0000 and malformed scalar input" }) && sameJson(stageIds.goldenVectors, goldenVectors);
  const validMigration = exactKeys(migration, ["translation", "mutableReferences", "fieldMapping", "requiredFieldPopulation", "immutableEvidence", "translationEvidence", "preflight", "replay", "rollback"]) && sameSet(strings(migration?.mutableReferences), ["sales_pipeline_stages.stage_id", "sales_pipeline_stages.allowed_transition_stage_ids", "sales_pipeline_stages.required_field_ids", "sales_pipelines.ordered_stage_ids", "sales_opportunities.stage_id", "sales.settings.workspace@1.pipelineStages", "current editable saved-view definitions and source bindings", "current editable page document source/action/block bindings"]) && sameJson(migration?.fieldMapping, { collection: "sales_pipeline_stages", predecessorDatabase: "allowed_transitions", predecessorCollection: "allowedTransitions", successorDatabase: "allowed_transition_stage_ids", successorCollection: "allowedTransitionStageIds" }) && sameJson(migration?.requiredFieldPopulation, { collection: "sales_pipeline_stages", successorDatabase: "required_field_ids", successorCollection: "requiredFieldIds", predecessor: "field absent", rule: "new trusted value is [lossReason] only for semantic lost and [] for qualification, discovery, proposal, negotiation, and won; migration rejects any other semantic or preexisting conflicting value" }) && sameSet(strings(migration?.immutableEvidence), ["historical audit entries", "historical idempotency request digests", "historical idempotency result bodies", "published document revisions"]) && typeof migration?.translation === "string" && migration.translation.includes("exact UTF-8/NFC bytes") && typeof migration.translationEvidence === "string" && migration.translationEvidence.includes("byte-preserved") && typeof migration.preflight === "string" && typeof migration.replay === "string" && typeof migration.rollback === "string";
  const expectedActions = {
    "sales.pipeline.update": { fromVersion: 1, toVersion: 2, input: { required: ["id", "expectedRevision", "name", "orderedStageIds", "stages"], additionalProperties: false }, output: { required: ["id", "revision", "name", "orderedStageIds", "stages", "status"], additionalProperties: false, status: ["active"], stageItem: { required: ["stageId", "revision", "semantic", "name", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds", "status"], additionalProperties: false, status: ["active"] }, stageCount: 6 } },
    "sales.pipeline.archive": { fromVersion: 1, toVersion: 2, input: { required: ["id", "expectedRevision"], additionalProperties: false }, output: { required: ["id", "revision", "status"], additionalProperties: false }, soleActiveDenial: { code: "ACTIVE_PIPELINE_REQUIRED", status: 409, businessEffects: "zero" } },
    "sales.opportunity.create": { fromVersion: 2, toVersion: 3, input: { required: ["name", "accountId", "pipelineId", "expectedPipelineRevision", "stageId", "expectedStageRevision"], optional: ["primaryContactId", "amount", "expectedCloseDate"], qualificationAdmission: "locks active pipeline and requires destination stage semantic qualification", additionalProperties: false }, output: { required: ["id", "revision", "pipelineId", "stageId"], additionalProperties: false } },
    "sales.opportunity.stage.update": { fromVersion: 2, toVersion: 3, input: { required: exactStageMoveInput.required, destination: "nonterminal semantic only", additionalProperties: false }, output: { required: ["id", "revision", "pipelineId", "stageId"], additionalProperties: false } },
    "sales.opportunity.close": { fromVersion: 1, toVersion: 2, input: { required: exactStageMoveInput.required, optional: ["lossReason"], properties: { lossReason: "trimmed UTF-8 string 1..500 bytes" }, destination: "locked destination semantic is terminal won or lost only", conditional: { "destinationSemantic=lost": { required: ["lossReason"] }, "destinationSemantic=won": { forbidden: ["lossReason"] } }, additionalProperties: false }, output: { required: ["id", "revision", "pipelineId", "stageId"], additionalProperties: false } },
    "sales.saved-view.create": { fromVersion: 1, toVersion: 2, input: { required: ["name", "visibility", "definition"], additionalProperties: false }, output: { required: ["id", "revision", "name", "visibility", "definition", "status"], status: "active", additionalProperties: false } },
    "sales.saved-view.update": { fromVersion: 1, toVersion: 2, input: { required: ["id", "expectedRevision", "name", "visibility", "definition"], additionalProperties: false }, output: { required: ["id", "revision", "name", "visibility", "definition", "status"], status: "active", additionalProperties: false } },
    "sales.saved-view.archive": { fromVersion: 1, toVersion: 2, input: { required: ["id", "expectedRevision"], additionalProperties: false }, output: { required: ["id", "revision", "status"], status: "archived", additionalProperties: false } }
  };
  const contributionSpecs = { "sales.list.opportunities": { kind: "component", fromVersion: 2, toVersion: 3, digest: "sha256:a24a0145d8b55df0e106578dde90b8e0f07749307c64cb978bdbab3f33d6047f" }, "sales.detail.opportunity": { kind: "component", fromVersion: 3, toVersion: 4, digest: "sha256:d4a78ed29e52a32b02dcde27501c511a84627d68bb24755776a3a90070617403" }, "sales.opportunity-list": { kind: "block", fromVersion: 3, toVersion: 4, digest: "sha256:c60fabb0f6319266817798742c4c23b5144477b11b2b5559a003681845a1430d" }, "sales.opportunity-detail": { kind: "block", fromVersion: 3, toVersion: 4, digest: "sha256:1850b5573e64eb56e734fdb2ab67cca678fd8f8009e1a0a24e9038726817e6da" }, "sales.opportunity-kanban": { kind: "block", fromVersion: 2, toVersion: 3, digest: "sha256:c47f5b61818c0ddb2b3c17dbfdfcca260797aa3ae4d5dc906ff17dec131740c6" } };
  const pageSpecs = { "sales.page.opportunities": { fromVersion: 3, toVersion: 4, digest: "sha256:ca6e6e33d47b7f9a38fea77987f738ae9b7db59e941d5917c1a0dad5aa9fce20" }, "sales.page.opportunity-detail": { fromVersion: 1, toVersion: 2, digest: "sha256:1aa9cd059689e106bbf61bc13e09875fd749b3940c97eeed53328f4aece974df" } };
  const validContributions = exactKeys(contributions, Object.keys(contributionSpecs)) && Object.entries(contributionSpecs).every(([id, spec]) => { const successor = record(contributions?.[id]); const descriptor = record(successor?.descriptor); return exactKeys(successor, ["kind", "fromVersion", "toVersion", "descriptor"]) && successor?.kind === spec.kind && successor.fromVersion === spec.fromVersion && successor.toVersion === spec.toVersion && descriptor?.id === id && descriptor.version === spec.toVersion && PluginUiContributionDescriptorSchema.safeParse(descriptor).success && `sha256:${createHash("sha256").update(canonicalJson(descriptor)).digest("hex")}` === spec.digest; });
  const validPages = exactKeys(pages, Object.keys(pageSpecs)) && Object.entries(pageSpecs).every(([id, spec]) => { const successor = record(pages?.[id]); const descriptor = record(successor?.descriptor); return exactKeys(successor, ["fromVersion", "toVersion", "descriptor"]) && successor?.fromVersion === spec.fromVersion && successor.toVersion === spec.toVersion && descriptor?.id === id && descriptor.version === spec.toVersion && PluginPageTemplateDescriptorSchema.safeParse(descriptor).success && `sha256:${createHash("sha256").update(canonicalJson(descriptor)).digest("hex")}` === spec.digest; });
  if (!validContributions || !validPages) return false;
  const validSources = exactKeys(sources, ["sales.opportunities", "sales.opportunity.detail"]) && Object.entries(sources ?? {}).every(([id, raw]) => {
    const successor = record(raw); const sourceSchema = record(successor?.sourceSchema); const fields = records(successor?.outputFields); const fromVersion = id === "sales.opportunities" ? 2 : 1; const toVersion = id === "sales.opportunities" ? 3 : 2;
    const projection = { id, version: toVersion, primaryContract: { id: "table.records", version: 1 }, sourceSchema, inputFields: id === "sales.opportunity.detail" ? [{ id: "id", kind: "string", required: true, nullable: false }] : [], outputFields: fields, paginationModes: ["offset"], limits: { ...sourceLimits, maxSelectedFields: id === "sales.opportunity.detail" ? 15 : 9 } };
    const expectedIds = id === "sales.opportunities" ? ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision", "amount"] : ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "archive-status", "expected-close-date", "revision", "amount"];
    const expectedFieldDigest = id === "sales.opportunities" ? "sha256:56756b3709c1a1b3ac2b86700e6b6e83048d779eab64ad0571b75be0b6552d83" : "sha256:b3f0e71b81193c773cfbbf7776a501e8babd0f3445c9bc1c594331156ad298cf";
    return exactKeys(successor, ["fromVersion", "toVersion", "sourceSchema", "structuralCompatibilityHash", "outputFields"]) && successor?.fromVersion === fromVersion && successor.toVersion === toVersion && sameJson(sourceSchema, { id: `${id}.output`, version: toVersion }) && sameJson(fields.map(({ id: fieldId }) => fieldId), expectedIds) && fields.every((field) => exactKeys(field, ["id", "kind", "binding", "nullable", "permission", "sortable", "filterOperators"]) && typeof field.id === "string" && ["text", "status", "enum", "integer", "money"].includes(String(field.kind)) && strings(field.filterOperators).length <= 8) && `sha256:${createHash("sha256").update(canonicalJson(fields)).digest("hex")}` === expectedFieldDigest && successor.structuralCompatibilityHash === descriptorStructuralHash(projection);
  });
  const validSettings = sameJson(settings, { "sales.settings.workspace": { fromSchemaVersion: 1, toSchemaVersion: 2, removedEditableFields: ["pipelineStages"], retainedFields: ["defaultTaskPageSize", "showPotentialRevenue", "defaultPage"], pipelineProjection: "pipeline stage order is read-only from sales.pipeline.snapshot; settings never stores pipeline stage truth", migration: "lock settings and canonical pipeline; translate legacy pipelineStages exactly once into the six-stage UUID snapshot or stop maintenance-required; remove pipelineStages from current editable settings after receipt commit; replay same receipt is a no-op" } });
  const pipelineChecks = [validStageIds, validMigration, value.activePipeline === "exactly one active pipeline per application and environment; sales.pipeline.archive rejects the sole active pipeline because Gate 13 has no create or replacement path", sameJson(value.opportunityRevisionAuthority, { permission: "sales.opportunities.read", fields: ["pipeline-revision", "stage-revision"], meaning: "opaque concurrency tokens only; stage-name and stage-semantic are separately authorized Opportunity presentation fields, while pipeline name, graph, probability, required fields, and all other administration data remain undisclosed", upgradeInvariant: "an existing custom role with sales.opportunities.read and without sales.pipelines.read retains the same authorized Opportunity rows plus stage presentation and opaque revision tokens after upgrade; it gains no sales.pipeline.snapshot access or pipeline configuration detail" }), sameJson(value.semantics, pipelineSemantics), update?.actionId === "sales.pipeline.update", update?.mode === "full-atomic-snapshot", sameJson(updateInput, exactUpdateInput), sameJson(stage, exactStage), update?.graph === "allowed destination semantic edges are exactly a subset of qualification→discovery|lost, discovery→proposal|lost, proposal→negotiation|lost, negotiation→won|lost; terminal stages have no outgoing edge", update?.positions === "qualification, discovery, proposal, and negotiation occupy positions 0..3 in any configured order; won is exactly position 4 and lost exactly position 5", update?.requiredFieldIds === "lossReason is required only for a move into lost; no other transition-required field is accepted in Gate 13", update?.atomicity === "locks and rechecks current authority, the pipeline, and every affected stage; snapshot CAS, immutable audit, outbox, and idempotency commit in one transaction", stageMove?.actionId === "sales.opportunity.stage.update", sameJson(stageMoveInput, exactStageMoveInput), stageMove?.interaction === "pointer and keyboard Kanban movement invoke this same action; the locked referenced stage semantic defines state", sameJson(actions, expectedActions), validSources, validContributions, validPages, validSettings, successors?.bindings === "only mutable current editable source/action/block/page bindings atomically replace predecessor versions; every predecessor version is retired, published snapshots remain immutable and non-executable, and no alias or compatibility shim exists; action idempotency request digests include action ID, successor version, canonical input, application, environment, and actor, and never replay across versions"];
  return pipelineChecks.every(Boolean);
}

function validSavedViewConfiguration(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined || !exactKeys(value, ["versions", "visibility", "targetKinds", "sourceDescriptors", "administration", "authorityMatrix", "definition", "actions", "registries", "topology", "runtimeClosure", "execution", "persistence", "idempotency"])) return false;
  const descriptors = record(value.sourceDescriptors);
  const validDescriptors = exactKeys(descriptors, savedViewSourceIds) && savedViewSourceIds.every((id) => {
    const descriptor = record(descriptors?.[id]);
    const expected = executionSourceIds.includes(id) ? expectedSavedViewDescriptor(id) : expectedAdministrationDescriptor(id);
    const valid = descriptor !== undefined && DataSourceDescriptorSchema.safeParse(descriptor).success && descriptor.structuralCompatibilityHash === descriptorStructuralHash(descriptor) && sameJson(descriptor, expected);
    return valid;
  });
  const expectedAdministrationDescriptors = {
    "sales.pipeline.snapshot": { permission: "sales.pipelines.read", fields: ["pipeline-id", "pipeline-revision", "pipeline-name", "stage-id", "stage-revision", "semantic", "stage-name", "position", "probability-basis-points", "allowed-transition-stage-ids", "required-field-ids", "status"], maxSelectedFields: 12, maxPageSize: 6 },
    "sales.saved-view.list": { permission: "sales.saved-views.read", fields: ["id", "name", "visibility", "team-id", "target-object-id", "view-kind", "revision", "status"], maxSelectedFields: 8, maxPageSize: 100 },
    "sales.saved-view.detail": { permission: "sales.saved-views.read", fields: ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"], maxSelectedFields: 11, maxPageSize: 33 }
  };
  const validAdministrationDescriptors = administrationSourceIds.every((id) => {
    const descriptor = record(descriptors?.[id]); const spec = expectedAdministrationDescriptors[id as keyof typeof expectedAdministrationDescriptors]; const limits = record(descriptor?.limits); const fields = records(descriptor?.outputFields);
    return descriptor?.id === id && descriptor.version === 1 && descriptor.permission === spec.permission && sameJson(fields.map(({ id: fieldId }) => fieldId), spec.fields) && fields.every(({ permission }) => permission === spec.permission) && limits?.maxSelectedFields === spec.maxSelectedFields && limits.maxPageSize === spec.maxPageSize;
  });
  const targetSpecs: Record<string, { read: string; fields: string[]; filters: string[]; sorts: string[]; groups?: string[]; calendars?: string[]; sensitive?: Record<string, string> }> = {
    "sales.object.account": { read: "sales.accounts.read", fields: ["name", "owner-id", "team-id", "status", "revision"], filters: ["name", "status", "revision"], sorts: ["name", "status", "revision"] },
    "sales.object.contact": { read: "sales.contacts.read", fields: ["display-name", "owner-id", "team-id", "account-id", "status", "revision", "email", "phone"], filters: ["display-name", "account-id", "status", "revision"], sorts: ["display-name", "status", "revision"], sensitive: { email: "sales.contacts.channels.read", phone: "sales.contacts.channels.read" } },
    "sales.object.lead": { read: "sales.leads.read", fields: ["display-name", "owner-id", "team-id", "status", "archive-status", "revision", "email", "phone", "source"], filters: ["display-name", "status", "archive-status", "revision", "source"], sorts: ["display-name", "status", "revision"], sensitive: { email: "sales.leads.channels.read", phone: "sales.leads.channels.read" } },
    "sales.object.opportunity": { read: "sales.opportunities.read", fields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "expected-close-date", "revision", "amount"], filters: ["name", "stage-id", "archive-status", "expected-close-date", "revision"], sorts: ["name", "stage-id", "expected-close-date", "revision"], sensitive: { amount: "sales.opportunities.amount.read" } },
    "sales.object.task": { read: "sales.tasks.read", fields: ["title", "owner-id", "team-id", "status", "archive-status", "due-date", "related-record-type", "related-record-id", "revision"], filters: ["title", "status", "archive-status", "due-date", "revision"], sorts: ["title", "status", "due-date", "revision"] },
    "sales.object.activity": { read: "sales.activities.read", fields: ["type", "subject", "owner-id", "team-id", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], filters: ["type", "status", "scheduled-at", "occurred-at", "revision"], sorts: ["type", "status", "scheduled-at", "occurred-at", "revision"] }
  };
  const authorityMatrix = record(value.authorityMatrix); const authorities = record(authorityMatrix?.table);
  const validTableAuthorities = exactKeys(authorities, savedViewTargetIds) && savedViewTargetIds.every((target) => {
    const authority = record(authorities?.[target]); const fields = record(authority?.fields); const spec = targetSpecs[target]!;
    if (authority?.sourceId !== "sales.saved-view.table" || authority.readPermission !== spec.read || !exactKeys(fields, spec.fields)) return false;
    return spec.fields.every((field) => {
      const item = record(fields?.[field]); const operations = ["select", ...(spec.filters.includes(field) ? ["filter"] : []), ...(spec.sorts.includes(field) ? ["sort"] : []), ...(spec.groups?.includes(field) ? ["group"] : []), ...(spec.calendars?.includes(field) ? ["calendar"] : [])];
      return sameJson(item, { permission: spec.sensitive?.[field] ?? spec.read, operations });
    });
  });
  const kanbanAuthority = record(record(authorityMatrix?.kanban)?.["sales.object.opportunity"]); const kanbanFields = record(kanbanAuthority?.fields);
  const expectedKanbanFields = { "row-kind": { permission: "sales.opportunities.read", operations: ["select"] }, name: { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] }, "stage-id": { permission: "sales.opportunities.read", operations: ["select", "filter", "sort", "group"] }, "stage-metadata": { permission: "sales.opportunities.read", operations: ["select"] }, revision: { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] } };
  const validKanbanAuthority = exactKeys(record(authorityMatrix?.kanban), ["sales.object.opportunity"]) && sameJson(kanbanAuthority, { sourceId: "sales.saved-view.kanban", readPermission: "sales.opportunities.read", fields: expectedKanbanFields });
  const calendarAuthority = record(record(authorityMatrix?.calendar)?.["sales.object.activity"]);
  const expectedCalendarFields = { type: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, subject: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, status: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, "scheduled-at": { permission: "sales.activities.read", operations: ["select", "filter", "sort", "calendar"] }, "occurred-at": { permission: "sales.activities.read", operations: ["select", "filter", "sort", "calendar"] }, "related-record-type": { permission: "sales.activities.read", operations: ["select"] }, "related-record-id": { permission: "sales.activities.read", operations: ["select"] }, revision: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] } };
  const validCalendarAuthority = exactKeys(record(authorityMatrix?.calendar), ["sales.object.activity"]) && sameJson(calendarAuthority, { sourceId: "sales.saved-view.calendar", readPermission: "sales.activities.read", fields: expectedCalendarFields });
  const validAuthorities = exactKeys(authorityMatrix, ["table", "kanban", "calendar"]) && validTableAuthorities && validKanbanAuthority && validCalendarAuthority;
  const expectedVisibility = { personal: { required: ["kind"], forbidden: ["teamId"], value: "personal", additionalProperties: false }, team: { required: ["kind", "teamId"], teamId: "canonical current team ID, UTF-8 1..120 bytes", value: "team", additionalProperties: false }, forbidden: ["application", "public"], authority: "personal owner is exactly the actor; team visibility requires the actor's current saved-view permission and that exact active team within the actor's current record scope; application-wide/public visibility is never accepted" };
  const expectedDefinition = {
    required: ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "presentation", "pageSize"], optional: ["grouping", "calendarRange", "dateField"], additionalProperties: false, source: "exact persistedSourceBinding object for the definition kind", fields: "1..8 unique declared selectable source descriptor field IDs; includes every descriptor binding=required field and every filter, sort, grouping, and calendar date field; compiled selectedFields equals definition.fields byte-for-byte and in the same order",
    filters: { conjunction: "flat-and", itemRequired: ["fieldId", "operator"], itemOptional: ["value"], itemAdditionalProperties: false, operators: ["eq", "neq", "in", "not-in", "contains", "starts-with", "ends-with", "gt", "gte", "lt", "lte", "is-null", "is-not-null"], fieldKindOperators: { text: textOperators, status: enumOperators, enum: enumOperators, integer: orderedOperators, date: orderedOperators, datetime: orderedOperators, money: [] }, value: "is-null and is-not-null forbid value; all other operators require exactly one matching platform scalar (null, string <=512 UTF-8 bytes, or safe integer as declared by the field) or, for in/not-in only, a homogeneous 1..20 matching scalar array; nested objects are forbidden" },
    sorts: { itemRequired: ["fieldId", "direction"], itemAdditionalProperties: false, directions: ["asc", "desc"], fieldIds: "unique and all present in definition.fields" },
    variants: {
      table: { required: ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "presentation", "pageSize"], sourceId: "sales.saved-view.table", forbidden: ["grouping", "calendarRange", "dateField"], presentation: { required: ["density"], density: ["comfortable", "compact"], additionalProperties: false } },
      kanban: { required: ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "grouping", "presentation", "pageSize"], target: "sales.object.opportunity", sourceId: "sales.saved-view.kanban", grouping: "stage-id", fields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"], pageSize: "integer 7..100 total rows; six reserved stage rows plus 1..94 opportunity rows", forbidden: ["calendarRange", "dateField"], presentation: { required: ["density"], density: ["comfortable", "compact"], additionalProperties: false } },
      calendar: { requiredPersisted: ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "calendarRange", "dateField", "presentation", "pageSize"], requiredCreate: ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "dateField", "presentation", "pageSize"], target: "sales.object.activity", sourceId: "sales.saved-view.calendar", fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], dateField: ["scheduled-at", "occurred-at"], forbidden: ["grouping"], presentation: { required: ["mode"], mode: ["agenda", "month"], additionalProperties: false } }
    },
    calendarRange: { requiredPersisted: ["start", "end", "timezone"], optionalCreateInput: true, additionalProperties: false, dates: "canonical UTC instants; end is after start; range is at most 31 calendar days", timezone: "exact current canonical application reporting IANA timezone", canonicalization: "create normalizes omitted range to the current reporting-timezone month clipped to 31 calendar days before persistence; update and execution require the exact current timezone and reporting-timezone revision; noncanonical legacy calendar data is maintenance-required and is never silently converted" },
    bounds: { minPageSize: 1, maxFields: 8, maxFilters: 8, maxSorts: 2, maxGrouping: 1, maxPageSize: 100, minNameLength: 1, maxNameLength: 120, maxDefinitionBytes: 16_384, maxCalendarWindowDays: 31 }, presentation: { tableDensity: ["comfortable", "compact"], kanbanDensity: ["comfortable", "compact"], calendarMode: ["agenda", "month"] }, forbidden: ["sql", "payload-path", "code", "expression"], measurement: "definition UTF-8 byte length is measured over canonical JSON with sorted object keys and no transport encoding"
  };
  const expectedActions = {
    "sales.saved-view.create": { input: { required: ["name", "visibility", "definition"], additionalProperties: false }, output: { required: ["id", "revision", "name", "visibility", "definition", "status"], status: "active", additionalProperties: false }, authority: "authorize proposed visibility: personal owner is exactly actor; team requires current membership and write scope in exact proposed active team", cas: "new row revision 1; mutation, immutable audit, outbox, and idempotency commit atomically" },
    "sales.saved-view.update": { input: { required: ["id", "expectedRevision", "name", "visibility", "definition"], additionalProperties: false }, output: { required: ["id", "revision", "name", "visibility", "definition", "status"], status: "active", additionalProperties: false }, authority: "lock and authorize exact current active row scope; ownerId is immutable; independently authorize proposed destination; team-to-personal only for immutable owner; teamA-to-teamB requires current scope in exact teamA and destination scope in exact teamB", cas: "expectedRevision locks the row; stale revision or authority race returns CONFLICT or FORBIDDEN with zero mutation, audit, outbox, and idempotency effects; success commits all atomically" },
    "sales.saved-view.archive": { input: { required: ["id", "expectedRevision"], additionalProperties: false }, output: { required: ["id", "revision", "status"], status: "archived", additionalProperties: false }, authority: "expectedRevision locks the current active row and authorization uses exact current personal owner or exact current team scope", cas: "stale revision or authority race returns CONFLICT or FORBIDDEN with zero mutation, audit, outbox, and idempotency effects; success commits all atomically" }
  };
  const registries = record(value.registries); const routes = records(registries?.routes); const contributions = records(registries?.contributions); const pages = records(registries?.pages);
  const routeIds = ["sales.route.calendar", "sales.route.pipeline-settings", "sales.route.saved-views"]; const pageIds = ["sales.page.calendar", "sales.page.pipeline-settings", "sales.page.saved-views"]; const contributionIds = ["sales.calendar", "sales.pipeline-settings", "sales.saved-views", "sales.saved-view-table"];
  const validRegistries = exactKeys(registries, ["routes", "contributions", "pages", "compatibility"]) && routes.length === 3 && routes.every((route) => PluginRouteDescriptorSchema.safeParse(route).success) && sameJson(routes.map(({ id }) => id), routeIds) && contributions.length === 4 && contributions.every((descriptor) => PluginUiContributionDescriptorSchema.safeParse(descriptor).success && descriptor.kind === "block") && sameJson(contributions.map(({ id }) => id), contributionIds) && duplicateIds(contributions.map(({ id }) => String(id))).length === 0 && pages.length === 3 && pages.every((page) => PluginPageTemplateDescriptorSchema.safeParse(page).success) && sameJson(pages.map(({ id }) => id), pageIds) && routes.every((route, index) => route.viewId === pages[index]?.id) && pages.every((page, index) => record(page.route)?.routeId === routes[index]?.id && records(record(page.requirements)?.blocks).some(({ id, version }) => id === contributions[index]?.id && version === contributions[index]?.version)) && registries?.compatibility === "all route viewIds equal exact page IDs; each route has one canonical primary block and sales.page.saved-views additionally binds globally unique sales.saved-view-table; page route references, block requirements, source/action requirements, contribution policies, permissions, versions, and runtime bindings are exact; only block contributions are registered";
  const registrySpecs = [
    { routeId: "sales.route.calendar", path: "/sales/calendar", pageId: "sales.page.calendar", blockId: "sales.calendar", permission: "sales.activities.read", sourceRequired: true, sources: [{ id: "sales.saved-view.calendar", version: 1 }], actions: [], requiredFields: ["type", "subject", "status", "related-record-type", "related-record-id", "revision"] },
    { routeId: "sales.route.pipeline-settings", path: "/sales/settings/pipeline", pageId: "sales.page.pipeline-settings", blockId: "sales.pipeline-settings", permission: "sales.pipelines.configure", sourceRequired: true, sources: [{ id: "sales.pipeline.snapshot", version: 1 }], actions: [{ id: "sales.pipeline.update", version: 2 }, { id: "sales.pipeline.archive", version: 2 }], requiredFields: ["pipeline-id", "pipeline-revision", "stage-id", "stage-revision", "semantic", "position", "allowed-transition-stage-ids", "required-field-ids"] },
    { routeId: "sales.route.saved-views", path: "/sales/views", pageId: "sales.page.saved-views", blockId: "sales.saved-views", permission: "sales.saved-views.read", sourceRequired: false, sources: [{ id: "sales.saved-view.list", version: 1 }, { id: "sales.saved-view.detail", version: 1 }, { id: "sales.saved-view.table", version: 1 }], actions: [{ id: "sales.saved-view.create", version: 2 }, { id: "sales.saved-view.update", version: 2 }, { id: "sales.saved-view.archive", version: 2 }], requiredFields: ["id", "name", "visibility", "target-object-id", "view-kind", "revision", "status"] }
  ];
  const validRegistrySemantics = registrySpecs.every((spec, index) => {
    const route = routes[index]; const contribution = contributions[index]; const page = pages[index]; const requirements = record(page?.requirements); const sourcePolicy = record(contribution?.sourcePolicy); const actionPolicy = record(contribution?.actionPolicy);
    const blocks = spec.blockId === "sales.saved-views" ? [{ id: "sales.saved-views", version: 1 }, { id: "sales.saved-view-table", version: 1 }] : [{ id: spec.blockId, version: 1 }];
    return sameJson(route, { id: spec.routeId, ownerPluginId: "module.sales", path: spec.path, parameters: {}, surface: "workspace", audience: "authenticated", permission: spec.permission, viewId: spec.pageId }) && contribution?.id === spec.blockId && contribution.version === 1 && contribution.ownerPluginId === "module.sales" && contribution.kind === "block" && contribution.permission === spec.permission && sameJson(contribution.propsSchema, { type: "object", properties: {}, additionalProperties: false }) && sameJson(contribution.profiles, ["workspace"]) && sameJson(contribution.surfaces, ["workspace"]) && contribution.audience === "authenticated" && sameJson(contribution.requiredStates, ["loading", "empty", "error", "forbidden"]) && sameJson(sourcePolicy, { required: spec.sourceRequired, contracts: [{ id: "table.records", version: 1 }], requiredFields: spec.requiredFields }) && (spec.actions.length === 0 ? actionPolicy === undefined : sameJson(actionPolicy, { required: spec.blockId === "sales.pipeline-settings", actions: spec.actions })) && page?.id === spec.pageId && page.version === 1 && page.ownerPluginId === "module.sales" && page.permission === spec.permission && sameJson(requirements?.sources, spec.sources) && sameJson(requirements?.actions, spec.actions) && sameJson(requirements?.blocks, blocks);
  });
  const tableContribution = contributions[3];
  const validTableContribution = sameJson(tableContribution, { id: "sales.saved-view-table", version: 1, ownerPluginId: "module.sales", kind: "block", propsSchema: { type: "object", properties: {}, additionalProperties: false }, profiles: ["workspace"], surfaces: ["workspace"], audience: "authenticated", permission: "sales.saved-views.read", sourcePolicy: { required: true, contracts: [{ id: "table.records", version: 1 }], requiredFields: [] }, requiredStates: ["loading", "empty", "error", "forbidden"] });
  const bindingValid = (node: Record<string, unknown> | undefined, sourceId: string, selectedFields: string[], actionId?: string): boolean => {
    const bindings = record(node?.bindings); const sourceBinding = record(bindings?.source); const source = record(sourceBinding?.source); const action = record(bindings?.action); const descriptor = record(descriptors?.[sourceId]);
    return source?.id === sourceId && source.version === 1 && sameJson(sourceBinding?.input, {}) && sourceBinding?.structuralCompatibilityHash === descriptor?.structuralCompatibilityHash && sameJson(sourceBinding?.selectedFields, selectedFields) && (actionId === undefined ? action === undefined : sameJson(action, { id: actionId, version: 2 }));
  };
  const calendarNodes = records(record(record(pages[0]?.document)?.regions)?.main); const pipelineNodes = records(record(record(pages[1]?.document)?.regions)?.main); const savedNodes = records(record(record(pages[2]?.document)?.regions)?.main);
  const pipelineFields = ["pipeline-id", "pipeline-revision", "pipeline-name", "stage-id", "stage-revision", "semantic", "stage-name", "position", "probability-basis-points", "allowed-transition-stage-ids", "required-field-ids", "status"];
  const detailFields = ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"];
  const createBinding = record(savedNodes[1]?.bindings);
  const validPageBindings = calendarNodes.length === 1 && bindingValid(calendarNodes[0], "sales.saved-view.calendar", ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"]) && pipelineNodes.length === 2 && bindingValid(pipelineNodes[0], "sales.pipeline.snapshot", pipelineFields, "sales.pipeline.update") && bindingValid(pipelineNodes[1], "sales.pipeline.snapshot", pipelineFields, "sales.pipeline.archive") && savedNodes.length === 5 && savedNodes[0]?.id === "saved-view-list" && bindingValid(savedNodes[0], "sales.saved-view.list", ["id", "name", "visibility", "team-id", "target-object-id", "view-kind", "revision", "status"]) && savedNodes[1]?.id === "saved-view-create" && exactKeys(createBinding, ["action"]) && sameJson(createBinding?.action, { id: "sales.saved-view.create", version: 2 }) && savedNodes[2]?.id === "saved-view-table-preview" && bindingValid(savedNodes[2], "sales.saved-view.table", ["name"]) && savedNodes[3]?.id === "saved-view-detail" && bindingValid(savedNodes[3], "sales.saved-view.detail", detailFields, "sales.saved-view.update") && savedNodes[4]?.id === "saved-view-archive" && bindingValid(savedNodes[4], "sales.saved-view.detail", detailFields, "sales.saved-view.archive");
  const validTopology = `sha256:${createHash("sha256").update(canonicalJson(value.topology)).digest("hex")}` === "sha256:fa741f105ae0ce6fe35c72a7a972aa66e7c4cf688a4d4e2bcf87e074cff83e55";
  const validRuntimeClosure = `sha256:${createHash("sha256").update(canonicalJson(value.runtimeClosure)).digest("hex")}` === "sha256:32aa8dc79fe881cb4c5c76150d9c2157625af62cf45dbff6a921b9e0b93991fe";
  const execution = record(value.execution); const query = record(execution?.query); const queryFilters = record(query?.filters); const querySort = record(query?.sort); const ordering = record(query?.ordering); const valueOperators = record(queryFilters?.valueOperators); const executionAuthority = record(execution?.authority);
  const validExecution = exactKeys(execution, ["embedded", "compiler", "persistedSourceBinding", "input", "query", "result", "authority"]) && typeof execution?.compiler === "string" && execution.compiler.includes("recheck saved-view revision") && execution.compiler.includes("current authorization revision") && query?.selectedFields === "exactly definition.fields in persisted order" && queryFilters?.calendarUserMaxItems === 6 && typeof queryFilters.calendarEffectiveItems === "string" && queryFilters.calendarEffectiveItems.includes("total/effective source cost <=8") && typeof queryFilters.canonicalCompilation === "string" && querySort?.canonicalCompilation === "same order as persisted definition.sorts; fieldId maps to field; fields unique" && sameJson(ordering, { nulls: "asc NULLS LAST; desc NULLS FIRST", default: "when definition.sorts is empty, canonical id ascending", tieBreaker: "append canonical id ascending unless already the final unique sort; stable across repeated offset pages" }) && typeof valueOperators?.value === "string" && valueOperators.value.includes("strings <=512 UTF-8 bytes") && valueOperators.value.includes("homogeneous scalars") && sameJson(execution?.result, { shape: "TableRecords", required: ["fields", "rows", "page"], additionalProperties: false }) && sameJson(executionAuthority, { read: "current sales.saved-views.read plus exact personal owner or current active team scope", write: "current sales.saved-views.write plus exact personal owner or current active team scope", target: "current target-object record policy and read permission are required", fields: "every (viewKind,targetObjectId,sourceId,fieldId,operation) tuple requires exact authorityMatrix permission before query execution; denial never reaches SQL, cache, HTML, or result" });
  const expectedScalarKinds = { text: "string", status: "string", enum: "string", integer: "safe integer", number: "finite number", decimal: "canonical decimal string", money: "canonical money object", percentage: "finite number", duration: "finite number", datetime: "canonical UTC datetime string", date: "canonical date string", boolean: "boolean", resource: "canonical resource identifier string" };
  const validExecutionSemantics = execution?.compiler === "native and embedded load the same persisted definition; recheck saved-view revision, registered source id/version/schema/hash, and current authorization revision after execution and before cache/result publication; any change discards output and fails closed" && sameJson(execution.embedded, { scope: "host-extracted reserved props after runtimeClosure per-block raw-prop admission and before contribution propsSchema validation", variants: ["exact {}", "exact {savedViewId:positive-safe-integer,expectedRevision:positive-safe-integer}"], mapping: "savedViewId -> saved-view-id; expectedRevision -> expected-revision", partialOrExtra: "reject" }) && sameJson(execution.input, { variants: ["exact {}", "exact {saved-view-id:positive-safe-integer,expected-revision:positive-safe-integer}"], partialOrExtra: "reject" }) && sameJson(execution.persistedSourceBinding, { required: ["id", "version", "sourceSchema", "structuralCompatibilityHash"], id: executionSourceIds, sourceSchema: "exact {id,version} from the registered DataSource descriptor", structuralCompatibilityHash: "exact registered DataSource descriptor structuralCompatibilityHash", definitionSourceEquality: "definition.source equals persisted source binding exactly", additionalProperties: false }) && sameJson(queryFilters?.nullOperators, { operators: ["is-null", "is-not-null"], value: "forbidden" }) && sameJson(valueOperators?.kinds, expectedScalarKinds);
  const validAdministration = validExecutionSemantics && sameJson(value.administration, { pipelineSnapshot: { sourceId: "sales.pipeline.snapshot", rows: "exactly six rows including empty stages; repeated pipeline identity/revision plus stage UUID/revision/semantic/name/position/probability, allowedTransitionStageIds, requiredFieldIds, status; destination revisions therefore exist before any Kanban move" }, savedViews: { listSourceId: "sales.saved-view.list", detailSourceId: "sales.saved-view.detail", scope: "only current actor-owned personal and currently authorized team-visible active views; archived excluded from list and detail requires same read authority", bounds: "list offset page size <=100; detail is zero rows or exactly chunkCount 1..33 rows ordered by contiguous chunkIndex 0..chunkCount-1; each definition-chunk ends on a Unicode scalar boundary and is <=512 UTF-8 bytes and <=512 characters; concatenation is exactly the canonical persisted definition JSON <=16384 UTF-8 bytes" } });
  const validPersistence = validRegistrySemantics && validTableContribution && validPageBindings && validAdministrationDescriptors && sameJson(value.persistence, { required: ["name", "ownerId", "visibility", "definition", "status", "revision"], additionalProperties: false, derived: { targetObjectId: "definition.targetObjectId exactly", viewKind: "definition.kind exactly" } });
  return validDescriptors && validAuthorities && validAdministration && validPersistence && validRegistries && validTopology && validRuntimeClosure && validExecution && sameJson(value.versions, { "sales.saved-view.create": 2, "sales.saved-view.update": 2, "sales.saved-view.archive": 2 }) && sameJson(value.visibility, expectedVisibility) && sameJson(value.targetKinds, { table: savedViewTargetIds, kanban: { target: "sales.object.opportunity", grouping: "stage-id" }, calendar: { target: "sales.object.activity", dateFields: ["scheduled-at", "occurred-at"] } }) && sameJson(value.definition, expectedDefinition) && sameJson(value.actions, expectedActions) && value.idempotency === "all saved-view mutations are actor-bound and idempotent over application, environment, action ID, successor version, canonical input, and actor; exact replay returns the durable result and changed digest conflicts";
}

function validDataMovement(value: Record<string, unknown> | undefined, authorityMatrix: Record<string, unknown>[]): boolean {
  const sectionIds = ["versions", "selectionResolver", "csv", "importSchema", "runtimeSchemaChecks", "workerProtocol", "purge", "import", "export", "exportSchema", "dedupeAndMerge", "dedupeSchema", "mergeSchema", "publicErrors", "retention"];
  if (!exactKeys(value, ["descriptors", ...sectionIds, "semanticDigests"])) return false;
  const descriptors = record(value?.descriptors); const descriptorActions = record(descriptors?.actions); const descriptorSources = record(descriptors?.sources); const descriptorDigests = record(descriptors?.descriptorDigests); const routeQueries = record(descriptors?.routeQuerySchemas);
  const routes = records(descriptors?.routes); const contributions = records(descriptors?.contributions); const pages = records(descriptors?.pages); const actions = Object.values(descriptorActions ?? {}); const sources = Object.values(descriptorSources ?? {});
  if (!exactKeys(descriptors, ["routes", "routeQuerySchemas", "actions", "sources", "contributions", "pages", "descriptorDigests"]) || routes.length !== 2 || actions.length !== 6 || sources.length !== 5 || contributions.length !== 2 || pages.length !== 2) return false;
  if (!routes.every((item) => PluginRouteDescriptorSchema.safeParse(item).success) || !actions.every((item) => ActionDescriptorSchema.safeParse(item).success) || !sources.every((item) => DataSourceDescriptorSchema.safeParse(item).success) || !contributions.every((item) => PluginUiContributionDescriptorSchema.safeParse(item).success) || !pages.every((item) => PluginPageTemplateDescriptorSchema.safeParse(item).success) || !Object.values(routeQueries ?? {}).every((item) => AgentToolJsonSchemaSchema.safeParse(item).success)) return false;
  if (!sources.every((item) => { const descriptor = record(item); return descriptor !== undefined && descriptor.structuralCompatibilityHash === descriptorStructuralHash(descriptor); })) return false;
  const sourceMap = new Map(sources.map((item) => [String(record(item)?.id), record(item)!]));
  const action = (id: string): Record<string, unknown> | undefined => record(descriptorActions?.[id]);
  const references = (items: unknown): string[] => records(items).map(({ id, version }) => `${String(id)}@${String(version)}`);
  const expectedRoutes = [
    { id: "sales.route.imports", ownerPluginId: "module.sales", path: "/sales/imports", parameters: {}, surface: "workspace", audience: "authenticated", permission: "sales.imports.read", viewId: "sales.page.imports" },
    { id: "sales.route.exports", ownerPluginId: "module.sales", path: "/sales/exports", parameters: {}, surface: "workspace", audience: "authenticated", permission: "sales.exports.read", viewId: "sales.page.exports" }
  ];
  if (!sameJson(routes, expectedRoutes)) return false;
  const safeId = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
  const closed = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: "object", ...(required.length > 0 ? { required } : {}), properties, additionalProperties: false });
  const expectedQueries = {
    "sales.route.imports": { oneOf: [closed({}), closed({ importJobId: safeId, expectedRevision: safeId }, ["importJobId", "expectedRevision"]), closed({ targetObjectType: { type: "string", enum: ["sales.object.account", "sales.object.contact"] }, recordId: safeId, expectedRevision: safeId }, ["targetObjectType", "recordId", "expectedRevision"])] },
    "sales.route.exports": { oneOf: [closed({}), closed({ exportJobId: safeId, expectedRevision: safeId }, ["exportJobId", "expectedRevision"])] }
  };
  if (!sameJson(routeQueries, expectedQueries)) return false;
  const expectedActionAuthority: Record<string, [string, string]> = {
    "sales.import.dry-run": ["sales.imports.execute", "sales.policy.imports.current"], "sales.import.commit": ["sales.imports.execute", "sales.policy.imports.current"], "sales.import.cancel": ["sales.imports.execute", "sales.policy.imports.current"],
    "sales.export.create": ["sales.exports.execute", "sales.policy.exports.current"], "sales.export.cancel": ["sales.exports.execute", "sales.policy.exports.current"], "sales.merge.commit": ["sales.records.merge", "sales.policy.merge.current"]
  };
  if (Object.entries(expectedActionAuthority).some(([id, expected]) => !sameJson([action(id)?.permission, action(id)?.policy], expected))) return false;
  const expectedSourceShape: Record<string, { permission: string; input: string[]; output: string[] }> = {
    "sales.import-job.list": { permission: "sales.imports.read", input: [], output: ["id", "target-object-type", "state", "accepted-rows", "rejected-rows", "revision"] },
    "sales.import-job.detail": { permission: "sales.imports.read", input: ["import-job-id", "expected-revision"], output: ["id", "state", "diagnostic-code", "artifact-expires-at", "revision"] },
    "sales.export-job.list": { permission: "sales.exports.read", input: [], output: ["id", "target-object-type", "state", "row-count", "revision"] },
    "sales.export-job.detail": { permission: "sales.exports.read", input: ["export-job-id", "expected-revision"], output: ["id", "state", "artifact-id", "artifact-expires-at", "revision"] },
    "sales.dedupe.candidates": { permission: "sales.records.merge", input: ["target-object-type", "id", "expected-revision"], output: ["candidate-id", "candidate-revision", "match-kind"] }
  };
  if (Object.entries(expectedSourceShape).some(([id, expected]) => { const source = sourceMap.get(id); return source?.permission !== expected.permission || !sameJson(records(source?.inputFields).map(({ id: fieldId }) => fieldId), expected.input) || !sameJson(records(source?.outputFields).map(({ id: fieldId }) => fieldId), expected.output); })) return false;
  const expectedContributions = {
    "sales.imports": { permission: "sales.imports.read", actions: ["sales.import.dry-run@1", "sales.import.commit@1", "sales.import.cancel@1", "sales.merge.commit@1"] },
    "sales.exports": { permission: "sales.exports.read", actions: ["sales.export.create@1", "sales.export.cancel@1"] }
  };
  if (!sameJson(contributions.map(({ id }) => id), ["sales.imports", "sales.exports"]) || duplicateIds(contributions.map(({ id }) => String(id))).length > 0) return false;
  if (contributions.some((item) => { const expected = expectedContributions[item.id as keyof typeof expectedContributions]; return expected === undefined || item.permission !== expected.permission || !sameJson(references(record(item.actionPolicy)?.actions), expected.actions) || !sameJson(record(item.sourcePolicy)?.requiredFields, []); })) return false;
  const expectedPages = {
    "sales.page.imports": { permission: "sales.imports.read", route: "sales.route.imports", sources: ["sales.import-job.list@1", "sales.import-job.detail@1", "sales.dedupe.candidates@1"], actions: ["sales.import.dry-run@1", "sales.import.commit@1", "sales.import.cancel@1", "sales.merge.commit@1"], block: "sales.imports@1", nodes: [
      ["sales.import-job.list", ["id", "target-object-type", "state", "accepted-rows", "rejected-rows", "revision"], "sales.import.dry-run"], ["sales.import-job.detail", ["id", "state", "diagnostic-code", "artifact-expires-at", "revision"], "sales.import.commit"], [undefined, [], "sales.import.cancel"], ["sales.dedupe.candidates", ["candidate-id", "candidate-revision", "match-kind"], "sales.merge.commit"]
    ] },
    "sales.page.exports": { permission: "sales.exports.read", route: "sales.route.exports", sources: ["sales.export-job.list@1", "sales.export-job.detail@1"], actions: ["sales.export.create@1", "sales.export.cancel@1"], block: "sales.exports@1", nodes: [
      ["sales.export-job.list", ["id", "target-object-type", "state", "row-count", "revision"], "sales.export.create"], ["sales.export-job.detail", ["id", "state", "artifact-id", "artifact-expires-at", "revision"], "sales.export.cancel"]
    ] }
  };
  if (!sameJson(pages.map(({ id }) => id), ["sales.page.imports", "sales.page.exports"]) || duplicateIds(pages.map(({ id }) => String(id))).length > 0) return false;
  if (pages.some((page) => { const expected = expectedPages[page.id as keyof typeof expectedPages]; const requirements = record(page.requirements); const nodes = records(record(record(page.document)?.regions)?.main); return expected === undefined || page.permission !== expected.permission || record(page.route)?.routeId !== expected.route || !sameJson(references(requirements?.sources), expected.sources) || !sameJson(references(requirements?.actions), expected.actions) || !sameJson(references(requirements?.blocks), [expected.block]) || !sameJson(nodes.map((node) => { const bindings = record(node.bindings); const sourceBinding = record(bindings?.source); return [record(sourceBinding?.source)?.id, strings(sourceBinding?.selectedFields), record(bindings?.action)?.id]; }), expected.nodes); })) return false;
  const pageBindingsValid = pages.every((page) => {
    const route = routes.find(({ id }) => id === record(page.route)?.routeId);
    if (route?.viewId !== page.id) return false;
    const nodes = records(record(record(page.document)?.regions)?.main);
    return nodes.every((node) => { const binding = record(record(node.bindings)?.source); if (binding === undefined) return true; const reference = record(binding.source); const source = sourceMap.get(String(reference?.id)); const selected = strings(binding.selectedFields); const available = records(source?.outputFields).map(({ id }) => String(id)); return source !== undefined && reference?.version === source.version && binding.structuralCompatibilityHash === source.structuralCompatibilityHash && selected.every((field) => available.includes(field)); });
  });
  if (!pageBindingsValid) return false;
  const digest = (item: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(item)).digest("hex")}`;
  for (const key of ["routes", "routeQuerySchemas", "actions", "sources", "contributions", "pages"]) if (descriptorDigests?.[key] !== digest(descriptors?.[key])) return false;
  const semanticDigests = record(value?.semanticDigests);
  if (!exactKeys(semanticDigests, sectionIds) || sectionIds.some((id) => semanticDigests?.[id] !== digest(value?.[id]))) return false;
  const versions = record(value?.versions); const actionVersions = record(versions?.actions); const sourceVersions = record(versions?.sources);
  if (!sameJson(versions?.routes, ["sales.route.imports", "sales.route.exports"]) || !sameJson(actionVersions, { "sales.import.dry-run": 1, "sales.import.commit": 1, "sales.import.cancel": 1, "sales.export.create": 1, "sales.export.cancel": 1, "sales.merge.commit": 1 }) || !sameJson(sourceVersions, { "sales.import-job.list": 1, "sales.import-job.detail": 1, "sales.export-job.list": 1, "sales.export-job.detail": 1, "sales.dedupe.candidates": 1 })) return false;
  if (Object.entries(descriptorActions ?? {}).some(([id, raw]) => record(raw)?.id !== id || record(raw)?.version !== actionVersions?.[id] || JSON.stringify(record(raw)?.inputSchema).includes("idempotencyKey"))) return false;
  const importPolicy = authorityMatrix.find(({ objectId }) => objectId === "sales.object.import-job")?.recordPolicyId;
  const exportPolicy = authorityMatrix.find(({ objectId }) => objectId === "sales.object.export-job")?.recordPolicyId;
  const accountActions = record(authorityMatrix.find(({ objectId }) => objectId === "sales.object.account")?.actionPermissions);
  const contactActions = record(authorityMatrix.find(({ objectId }) => objectId === "sales.object.contact")?.actionPermissions);
  if (["sales.import.dry-run", "sales.import.commit", "sales.import.cancel"].some((id) => action(id)?.policy !== importPolicy) || ["sales.export.create", "sales.export.cancel"].some((id) => action(id)?.policy !== exportPolicy) || action("sales.merge.commit")?.policy !== "sales.policy.merge.current" || accountActions?.["sales.merge.commit"] !== "sales.records.merge" || contactActions?.["sales.merge.commit"] !== "sales.records.merge") return false;
  const branches = (id: string): Record<string, unknown>[] => records(record(record(record(action(id)?.inputSchema)?.properties)?.request)?.oneOf);
  const branchEnum = (branch: Record<string, unknown>, field: string): string[] => strings(record(record(branch.properties)?.[field])?.enum);
  const arrayItemEnum = (branch: Record<string, unknown>, field: string): string[] => strings(record(record(record(branch.properties)?.[field])?.items)?.enum);
  const nestedBranchEnum = (branch: Record<string, unknown>, arrayField: string, itemField: string): string[] => strings(record(record(record(record(record(branch.properties)?.[arrayField])?.items)?.properties)?.[itemField])?.enum);
  const dryRunBranches = branches("sales.import.dry-run"); const exportBranches = branches("sales.export.create");
  const dryRunFields = [["displayName", "source", "email", "phone"], ["name"], ["displayName", "accountId", "email", "phone"]];
  const exportFields = [["display-name", "owner-id", "team-id", "status", "archive-status", "revision", "email", "phone"], ["name", "owner-id", "team-id", "status", "revision"], ["display-name", "owner-id", "team-id", "account-id", "status", "revision", "email", "phone"]];
  if (dryRunBranches.length !== 3 || !sameJson(dryRunBranches.map((branch) => branchEnum(branch, "targetObjectType")), [["sales.object.lead"], ["sales.object.account"], ["sales.object.contact"]]) || !sameJson(dryRunBranches.map((branch) => nestedBranchEnum(branch, "columnMapping", "fieldId")), dryRunFields) || exportBranches.length !== 3 || !sameJson(exportBranches.map((branch) => [branchEnum(branch, "targetObjectType"), branchEnum(branch, "sourceId")]), [[["sales.object.lead"], ["sales.leads"]], [["sales.object.account"], ["sales.accounts"]], [["sales.object.contact"], ["sales.contacts"]]]) || !sameJson(exportBranches.map((branch) => arrayItemEnum(branch, "selectedFields")), exportFields)) return false;
  const boundedIntegers = (node: unknown): boolean => {
    const schema = record(node); if (schema === undefined) return true;
    if (schema.type === "integer") { const enumValues = Array.isArray(schema.enum) ? schema.enum : []; if (enumValues.length > 0) return enumValues.every((item) => Number.isSafeInteger(item)); if (typeof schema.maximum !== "number" || schema.maximum > Number.MAX_SAFE_INTEGER) return false; }
    return Object.values(record(schema.properties) ?? {}).every(boundedIntegers) && (schema.items === undefined || boundedIntegers(schema.items)) && (Array.isArray(schema.oneOf) ? schema.oneOf.every(boundedIntegers) : true);
  };
  if (actions.some((item) => !boundedIntegers(record(item)?.inputSchema) || !boundedIntegers(record(item)?.outputSchema))) return false;
  const selection = record(value?.selectionResolver); const csv = record(value?.csv); const importSchema = record(value?.importSchema); const runtimeChecks = record(value?.runtimeSchemaChecks); const worker = record(value?.workerProtocol); const purge = record(value?.purge); const importPersistence = record(record(value?.import)?.persistence); const exportMovement = record(value?.export); const exportPersistence = record(exportMovement?.persistence); const exportWorker = record(exportMovement?.worker); const dedupe = record(value?.dedupeAndMerge); const merge = record(dedupe?.merge); const rewriteSets = record(merge?.relatedRewriteSets); const dedupeSchema = record(value?.dedupeSchema); const mergeSchema = record(value?.mergeSchema);
  const limitsValid = sameJson(csv?.limits, { fileBytes: 16_777_216, dataRows: 10_000, columns: 64, cellUtf8Bytes: 16_384, workerChunkRows: 250 });
  const dedupeInputs = records(record(descriptorSources?.["sales.dedupe.candidates"])?.inputFields);
  const emptyTables = record(selection?.emptyTables);
  const selectionValid = sameJson(selection?.mapping, { importJobId: "import-job-id", exportJobId: "export-job-id", targetObjectType: "target-object-type", recordId: "id", expectedRevision: "expected-revision" }) && sameJson(selection?.importsRouteVariants, ["exact {}", "exact {importJobId,expectedRevision}", "exact {targetObjectType,recordId,expectedRevision}"]) && sameJson(Object.keys(emptyTables ?? {}), ["sales.import-job.detail", "sales.export-job.detail", "sales.dedupe.candidates"]) && Object.values(emptyTables ?? {}).every((table) => TableRecordsSchema.safeParse(table).success) && typeof selection?.dedupe === "string" && selection.dedupe.includes("subject is always merge winner") && selection.dedupe.includes("candidate is always merge loser") && sameJson(dedupeInputs.map(({ id, required }) => ({ id, required })), [{ id: "target-object-type", required: false }, { id: "id", required: false }, { id: "expected-revision", required: false }]);
  const runtimeChecksValid = sameJson(runtimeChecks, { safeIntegers: "every identity, revision, ordinal, count, attempt, lease revision, and relation count is an integer in 0..9007199254740991 with identities/revisions >=1", mappingUniqueness: "after NFC, headers are unique and fieldId values are unique; exact target branch field enums and required-field cardinality apply", exportUniqueness: "selectedFields are unique and exact targetObjectType/sourceId/sourceVersion/sourceSchemaVersion branch equality is required", digests: "every digest is lowercase sha256:<64 lowercase hexadecimal characters>; exact lexical validation supplements descriptor length bounds", relations: "merge relation counts contain every and only the target-specific ordered relation IDs once" });
  const importClaimFields = ["attempt", "workerGenerationFence", "leaseOwnerGeneration", "leaseRevision", "leaseExpiresAt"];
  const lifecycleValid = importClaimFields.every((field) => strings(importPersistence?.importChunk).includes(field)) && strings(importPersistence?.importRow).includes("outcome") && typeof csv?.header === "string" && csv.header.includes("at least one data row") && csv.header.includes("IMPORT_INVALID_CSV") && typeof csv?.mapping === "string" && csv.mapping.includes("{request:{") && typeof worker?.genesis === "string" && worker.genesis.includes("header-only input") && typeof worker?.chunking === "string" && worker.chunking.includes("dataRowCount in 1..10000") && strings(worker.chunkStates).includes("failed") && sameJson(worker.rowStates, ["pending", "accepted", "rejected"]) && strings(worker.rowTransitions).length === 2 && typeof worker.claim === "string" && worker.claim.includes("persisted workerGenerationFence") && worker.claim.includes("current global workerGenerationFence") && typeof worker.retryExhaustion === "string" && worker.retryExhaustion.includes("all remaining") && typeof worker.completion === "string" && worker.completion.includes("never requeues");
  const jobEvents = record(worker?.jobEvents);
  const jobEventsValid = sameJson(jobEvents, { schemaVersion: 1, messageClass: "durable-integration", payload: ["environment", "jobId", "state", "revision", "actionId", "targetObjectType", "authorizationRevision", "lifecycleRevision", "scopeRevision"], import: { eventId: "sales.event.import-job-changed", sourceId: "sales.import-job.list", topicId: "sales.realtime.import-jobs", transitions: ["queued->running", "running->succeeded", "running->partially-failed", "running->failed", "validated|queued->cancelled"] }, export: { eventId: "sales.event.export-job-changed", sourceId: "sales.export-job.list", topicId: "sales.realtime.export-jobs", transitions: ["queued->running", "running->succeeded", "running->failed", "queued->cancelled"] }, merge: { eventId: "existing target-specific winner object event", count: 1, binding: "winnerId,winnerRevision,lineageId", forbidden: "no loser or generic data-movement outbox" } });
  const purgeValid = purge?.afterDays === 30 && sameSet(strings(purge.delete), ["upload bytes", "uploadArtifactId locator", "mappingCanonicalJson", "canonicalMappedJson", "diagnostic artifact bytes", "diagnostic artifact offsets", "export snapshot row payload", "queryCanonicalJson", "export artifact bytes"]);
  const snapshotValid = sameSet(strings(exportPersistence?.snapshotRow), ["exportJobId", "ordinal", "recordId", "recordRevision", "rowCanonicalJson", "rowDigest"]);
  const exportClaimFields = ["workerGenerationFence", "leaseOwnerGeneration", "leaseRevision", "leaseExpiresAt", "attempt"];
  const exportWorkerValid = exportClaimFields.every((field) => strings(exportPersistence?.exportJob).includes(field)) && typeof exportWorker?.claim === "string" && exportWorker.claim.includes("persisted workerGenerationFence") && exportWorker.claim.includes("current global workerGenerationFence") && typeof exportWorker?.reclaim === "string" && exportWorker.reclaim.includes("persisted old workerGenerationFence") && exportWorker.reclaim.includes("current global fence/new owner") && exportWorker.reclaim.includes("at most 3") && typeof exportWorker?.cancelRace === "string" && exportWorker.cancelRace.includes("never both") && typeof exportWorker?.completion === "string" && exportWorker.completion.includes("commit once");
  const matchKinds = ["account-name", "contact-email", "contact-phone", "contact-email-and-phone"];
  const dedupeValid = sameJson(record(dedupeSchema?.output)?.matchKind, matchKinds) && dedupeSchema?.normalizerVersion === "node24.19-unicode17-v1" && typeof dedupeSchema?.selection === "string" && dedupeSchema.selection.includes("subject and candidate") && strings(record(dedupe?.candidateSource)?.matchKinds).every((kind) => matchKinds.includes(kind));
  const accountRewrites = ["sales_contacts.account_id", "sales_opportunities.account_id", "sales_leads.qualified_account_id", "sales_activities.related_record_id where related_record_type=sales.account", "sales_notes.related_record_id where related_record_type=sales.account", "sales_attachment_references.related_record_id where related_record_type=sales.account", "sales_tasks.related_record_id where related_record_type=sales.account"];
  const contactRewrites = ["sales_opportunities.primary_contact_id", "sales_leads.qualified_contact_id", "sales_activities.related_record_id where related_record_type=sales.contact", "sales_notes.related_record_id where related_record_type=sales.contact", "sales_attachment_references.related_record_id where related_record_type=sales.contact", "sales_tasks.related_record_id where related_record_type=sales.contact"];
  const lineageFields = ["lineageId", "applicationId", "environment", "targetObjectType", "winnerId", "winnerPreRevision", "winnerPostRevision", "loserId", "loserPreRevision", "loserPostRevision", "matchKind", "normalizerVersion", "actorId", "authorizationRevision", "winnerPreDigest", "winnerPostDigest", "loserPreDigest", "loserPostDigest", "rewrittenRelationCounts", "committedAt"];
  const mergeAudit = record(mergeSchema?.audit);
  const mergeValid = sameSet(strings(rewriteSets?.["sales.object.account"]), accountRewrites) && sameSet(strings(rewriteSets?.["sales.object.contact"]), contactRewrites) && sameJson(mergeSchema?.lineage, lineageFields) && typeof mergeSchema?.direction === "string" && mergeSchema.direction.includes("subject maps only to winnerId") && mergeSchema.direction.includes("candidate maps only to loserId") && typeof merge?.winner === "string" && merge.winner.includes("subject is always the surviving winner") && typeof mergeSchema?.contactAccount === "string" && mergeSchema.contactAccount.includes("accountId are non-null, equal") && typeof mergeSchema?.output === "string" && mergeSchema.output.includes("plus one") && typeof mergeAudit?.winner === "string" && mergeAudit.winner.startsWith("sales.merge.commit") && typeof mergeAudit?.loser === "string" && mergeAudit.loser.startsWith("sales.merge.commit");
  const relationOrder = record(mergeSchema?.relationCountOrder); const relationItems = record(record(record(action("sales.merge.commit")?.outputSchema)?.properties)?.rewrittenRelationCounts); const relationId = record(record(relationItems?.items)?.properties)?.relationId;
  const relationOutputValid = sameJson(relationOrder?.["sales.object.account"], accountRewrites) && sameJson(relationOrder?.["sales.object.contact"], contactRewrites) && sameSet(strings(record(relationId)?.enum), [...accountRewrites, ...contactRewrites]) && typeof record(mergeSchema?.audit)?.lineageDigestCoverage === "string";
  const publicErrors = strings(value?.publicErrors); const expectedErrors = ["IMPORT_INVALID_ENCODING", "IMPORT_INVALID_CSV", "IMPORT_UNSAFE_FORMULA", "IMPORT_LIMIT_EXCEEDED", "IMPORT_PROTECTED_FIELD", "IMPORT_MAPPING_INVALID", "IMPORT_UPLOAD_BINDING_INVALID", "IMPORT_REQUIRED_VALUE", "IMPORT_VALUE_INVALID", "IMPORT_CONTACT_ACCOUNT_FORBIDDEN", "IMPORT_ROW_CONFLICT", "IMPORT_WORKER_RETRY_EXHAUSTED", "DEDUPE_CANDIDATE_LIMIT", "STALE_RECORD", "ACTION_FORBIDDEN", "NOT_FOUND", "ARTIFACT_EXPIRED", "ARTIFACT_FORBIDDEN", "IDEMPOTENCY_CONFLICT"];
  const errorsValid = sameJson(publicErrors, expectedErrors) && duplicateIds(publicErrors).length === 0 && strings(importSchema?.fatalCodes).every((code) => publicErrors.includes(code)) && strings(importSchema?.rowCodes).every((code) => publicErrors.includes(code));
  return selectionValid && runtimeChecksValid && limitsValid && lifecycleValid && jobEventsValid && purgeValid && snapshotValid && exportWorkerValid && dedupeValid && mergeValid && relationOutputValid && errorsValid && record(importSchema?.columnMappingItem)?.additionalProperties === false && sameSet(strings(importSchema?.formulaLeading), ["=", "+", "-", "@"]);
}

function setDiagnostics(kind: string, ids: readonly string[], path: string): RepositoryDiagnostic[] {
  const diagnostics: RepositoryDiagnostic[] = [];
  for (const id of duplicateIds(ids).filter(Boolean)) diagnostics.push(diagnostic("PHASE13_DUPLICATE_OWNERSHIP", path, `${kind} ID is duplicated: ${id}.`, `Keep one authoritative ${kind} ID.`));
  for (const id of ids) if (!id || (kind !== "owner" && !salesId.test(id))) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", path, `${kind} has invalid ID: ${id || "<missing>"}.`, `Use a declared ${kind} ID.`));
  return diagnostics;
}

export function validatePhase13ProductContract(value: unknown): RepositoryDiagnostic[] {
  const contract = record(value);
  if (contract === undefined) return [diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$", "Phase 13 product contract must be an object.", "Restore contract object.")];
  const diagnostics: RepositoryDiagnostic[] = [];
  try {
    const actualDigest = `sha256:${createHash("sha256").update(canonicalJson(contract)).digest("hex")}`;
    if (actualDigest !== acceptedContractDigest) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_DRIFT", "$", `Contract digest ${actualDigest} differs from the accepted P13.5 digest.`, "Review the semantic change and update the accepted digest only with an accepted product-contract decision."));
  } catch (error) {
    diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$", `Phase 13 product contract is not canonical JSON data: ${error instanceof Error ? error.message : String(error)}.`, "Restore a canonical JSON-compatible contract."));
  }
  const sections = ["schemaVersion", "phase", "moduleId", "commonFields", "predecessorInventory", "target", "owners", "personas", "permissions", "lifecycles", "objects", "routes", "actions", "journeys", "metrics", "dataSemantics", "retention", "migration", "betaCriteria", "attacks", "nonGoals"];
  for (const section of sections) {
    if (!(section in contract)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$", `Required contract section is absent: ${section}.`, "Restore all Phase 13 contract sections."));
  }
  for (const key of Object.keys(contract)) if (!sections.includes(key)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$", `Unknown top-level contract section: ${key}.`, "Keep Phase 13 contract closed to declared sections."));
  if (contract.schemaVersion !== 1 || contract.phase !== 13 || contract.moduleId !== "module.sales") {
    diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$", "Contract identity must be schemaVersion 1, phase 13, module.sales.", "Restore Phase 13 Sales contract identity."));
  }
  const target = record(contract.target);
  if (target?.segment !== "B2B sales team" || target.activeSellerMinimum !== 3 || target.activeSellerMaximum !== 25 || target.activePipelineMaximum !== 1 || target.reportingCurrencyCount !== 1) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/target", "Target customer and bounded product shape differ from the accepted contract.", "Restore exact Phase 13 target bounds."));
  if (!sameSet(strings(contract.commonFields), ["id", "applicationId", "environment", "createdAt", "createdBy", "updatedAt", "updatedBy", "revision", "audit"])) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/commonFields", "Common CRM identity, isolation, actor, revision, or audit fields are incomplete.", "Restore exact common fields."));
  const owners = records(contract.owners);
  const ownerIds = owners.map(({ id }) => typeof id === "string" ? id : "");
  diagnostics.push(...setDiagnostics("owner", ownerIds, "$/owners"));
  if (!sameSet(ownerIds, requiredOwnerIds) || owners.some(({ scope }) => typeof scope !== "string" || scope === "")) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/owners", "Product contract owners or scopes are incomplete.", "Restore exact owner set and non-empty scopes."));
  const ownerSet = new Set(ownerIds);
  const objects = records(contract.objects);
  const objectIds = objects.map(({ id }) => typeof id === "string" ? id : "");
  diagnostics.push(...setDiagnostics("object", objectIds, "$/objects"));
  const objectSet = new Set(objectIds);
  const predecessor = record(contract.predecessorInventory);
  const predecessorIds = strings(predecessor?.identities);
  const decisionGroups = records(predecessor?.decisionGroups);
  const assignedPredecessorIds = decisionGroups.flatMap(({ ids }) => strings(ids));
  const validDecisionGroup = (group: Record<string, unknown>): boolean => {
    const ids = strings(group.ids);
    if (ids.length === 0) return false;
    if (group.contractModel === "versioned" && group.decision === "preserve-id-version-bump") return Number.isInteger(group.currentVersion) && Number.isInteger(group.targetVersion) && Number(group.targetVersion) === Number(group.currentVersion) + 1;
    if (group.contractModel === "static" && group.decision === "preserve-id-static-replace") return group.currentVersion === undefined && group.targetVersion === undefined;
    if (group.contractModel === "retired" && group.decision === "retire-fail-closed") return group.currentVersion === undefined && group.targetVersion === undefined;
    return false;
  };
  if (predecessorIds.length !== 77 || duplicateIds(predecessorIds).length > 0 || predecessorIds.some((id) => !salesId.test(id)) || decisionGroups.length !== 4 || decisionGroups.some((group) => !validDecisionGroup(group)) || duplicateIds(assignedPredecessorIds).length > 0 || !sameSet(assignedPredecessorIds, predecessorIds) || strings(predecessor?.persistedReferences).length !== 4) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/predecessorInventory", "Predecessor inventory must map each of 77 current Sales identities exactly once to an explicit version bump, static replacement, or fail-closed retirement and name persisted-reference migration.", "Restore the complete category-aware predecessor identity decision map."));
  if (!sameSet(objectIds, requiredObjectIds)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/objects", "CRM object set must contain exactly the fifteen accepted P13.1 objects.", "Restore exact CRM object inventory."));
  const journeys = records(contract.journeys);
  const journeyIds = journeys.map(({ id }) => typeof id === "string" ? id : "");
  diagnostics.push(...setDiagnostics("journey", journeyIds, "$/journeys"));
  const journeySet = new Set(journeyIds);
  const routeIds = strings(contract.routes);
  const actionIds = strings(contract.actions);
  diagnostics.push(...setDiagnostics("route", routeIds, "$/routes"), ...setDiagnostics("action", actionIds, "$/actions"));
  const routeSet = new Set(routeIds);
  const actionSet = new Set(actionIds);
  const permissions = record(contract.permissions);
  const permissionIds = strings(permissions?.definitions);
  diagnostics.push(...setDiagnostics("permission", permissionIds, "$/permissions/definitions"));
  const retiredIds = decisionGroups.filter(({ decision }) => decision === "retire-fail-closed").flatMap(({ ids }) => strings(ids));
  const activeTargetIds = new Set([...routeIds, ...actionIds, ...permissionIds]);
  if (retiredIds.some((id) => activeTargetIds.has(id))) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/predecessorInventory/decisionGroups", "A fail-closed retired identity is also declared active in the target contract.", "Keep retirement and target-active identity sets disjoint."));
  if (permissions?.authorityOwner !== "platform.security" || permissionIds.length < 40 || permissionIds.some((id) => id.startsWith("sales.permission.")) || !sameSet(strings(permissions?.fieldScopes), ["application", "environment", "record", "field", "owner", "team"]) || !sameSet(strings(permissions?.protectedFields), requiredProtectedFields)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/permissions", "Permission contract must use exact object/field/action IDs, current policy scopes, and actual protected field identities.", "Restore the closed Phase 13 permission model."));
  const scopeAdministration = record(permissions?.scopeAdministration);
  if (scopeAdministration?.owner !== "platform.security" || scopeAdministration.endpoint !== "fixed-generated-host:/api/k-nex/sales/authority-scopes" ||
    scopeAdministration.admission !== "current sales.settings.write plus active application-sales-scope, application-wide, mutation-allowed caller scope" ||
    scopeAdministration.target !== "upsert/reactivation requires current module.sales platform-plugin grant; revoke persists an explicit tombstone" ||
    scopeAdministration.consistency !== "expected global authorization revision and per-principal scope revision; request is idempotent over application, environment, caller, target, operation, and request digest" ||
    scopeAdministration.lifecycle !== "active scope may be dormant while current RBAC grant is absent and become effective when it returns; revoked scope never auto-reactivates" ||
    scopeAdministration.evidence !== "scope, authorization revision, immutable audit, and canonical authorization outbox commit in one transaction") diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/permissions/scopeAdministration", "Sales scope administration must remain a closed generated host control plane with current authority, CAS, tombstone, replay, and transaction evidence rules.", "Restore the exact P13.2 scope-administration contract."));
  const personaIds = records(contract.personas).map(({ id }) => typeof id === "string" ? id : "");
  diagnostics.push(...setDiagnostics("persona", personaIds, "$/personas"));
  if (!sameSet(personaIds, requiredPersonaIds) || records(contract.personas).some(({ recordScope, mutationScope }) => typeof recordScope !== "string" || recordScope === "" || typeof mutationScope !== "string" || mutationScope === "")) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/personas", "Persona set or authority scope is incomplete.", "Restore exact persona and scope definitions."));
  const personaSet = new Set(personaIds);
  const permissionSet = new Set(permissionIds);
  const routePermissions = records(permissions?.routePermissions);
  const authorizedRouteIds = routePermissions.map(({ routeId }) => typeof routeId === "string" ? routeId : "");
  if (!sameSet(authorizedRouteIds, routeIds) || duplicateIds(authorizedRouteIds).length > 0 || routePermissions.some(({ permissionId, policyOwner }) => typeof permissionId !== "string" || !permissionSet.has(permissionId) || policyOwner !== "platform.security")) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/permissions/routePermissions", "Route authorization must cover each declared route exactly once with a declared static permission under platform.security policy ownership.", "Restore the exact route-to-permission authority map."));
  for (const [index, grant] of records(permissions?.personaGrants).entries()) {
    if (!personaSet.has(String(grant.personaId))) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `$/permissions/personaGrants/${index}/personaId`, "Permission grant names unknown persona.", "Reference declared persona ID."));
    for (const permissionId of strings(grant.permissionIds)) if (!permissionSet.has(permissionId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `$/permissions/personaGrants/${index}/permissionIds`, `Permission grant references unknown permission ${permissionId}.`, "Reference declared permission ID."));
  }
  for (const personaId of personaIds) if (!records(permissions?.personaGrants).some((grant) => grant.personaId === personaId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", "$/permissions/personaGrants", `Persona ${personaId} has no permission grant matrix row.`, "Map each persona exactly once."));
  const grantPersonaIds = records(permissions?.personaGrants).map((grant) => typeof grant.personaId === "string" ? grant.personaId : "");
  if (duplicateIds(grantPersonaIds).length > 0) diagnostics.push(diagnostic("PHASE13_DUPLICATE_OWNERSHIP", "$/permissions/personaGrants", "Persona grant matrix contains duplicate persona rows.", "Keep one grant row per persona."));
  const administratorGrant = records(permissions?.personaGrants).find(({ personaId }) => personaId === "sales.administrator");
  if (!sameSet(strings(administratorGrant?.permissionIds), permissionIds)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/permissions/personaGrants", "Sales administrator template must enumerate every Sales permission without acquiring platform authority.", "Restore complete same-extension administrator grants."));
  const matrix = records(permissions?.objectFieldActionMatrix);
  const matrixObjectIds = matrix.map(({ objectId }) => typeof objectId === "string" ? objectId : "");
  if (!sameSet(matrixObjectIds, requiredObjectIds) || duplicateIds(matrixObjectIds).length > 0) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/permissions/objectFieldActionMatrix", "Permission matrix must contain exactly one row per CRM object.", "Restore exact object permission coverage."));
  const permissionMappedActions = new Set<string>();
  for (const [index, row] of matrix.entries()) {
    if (!objectSet.has(String(row.objectId))) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `$/permissions/objectFieldActionMatrix/${index}/objectId`, "Permission matrix references unknown object.", "Reference declared object ID."));
    const sensitiveFields = record(row.sensitiveFields) ?? {};
    const actionPermissions = record(row.actionPermissions) ?? {};
    const referencedPermissions = [row.readPermissionId, row.writePermissionId, row.archivePermissionId, ...Object.values(sensitiveFields), ...Object.values(actionPermissions)].filter((value): value is string => typeof value === "string");
    for (const permissionId of referencedPermissions) {
      if (!permissionSet.has(permissionId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `$/permissions/objectFieldActionMatrix/${index}`, `Permission matrix references unknown permission ${permissionId}.`, "Reference declared permission ID."));
    }
    if (typeof row.readPermissionId !== "string" || typeof row.writePermissionId !== "string" || typeof row.recordPolicyId !== "string" || !salesId.test(row.recordPolicyId)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", `$/permissions/objectFieldActionMatrix/${index}`, "Object permission row lacks exact read, write, or current record-policy identity.", "Restore object-specific authority mapping."));
    for (const actionId of Object.keys(actionPermissions)) {
      permissionMappedActions.add(actionId);
      if (!actionSet.has(actionId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `$/permissions/objectFieldActionMatrix/${index}/actionPermissions`, `Permission matrix references unknown action ${actionId}.`, "Reference declared action ID."));
    }
  }
  for (const objectId of objectIds) if (objectId && !matrix.some((row) => row.objectId === objectId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", "$/permissions/objectFieldActionMatrix", `Object ${objectId} has no permission matrix row.`, "Map every object to field/action policy."));
  const operationActionPermissions = record(permissions?.operationActionPermissions) ?? {};
  for (const [actionId, permissionId] of Object.entries(operationActionPermissions)) {
    permissionMappedActions.add(actionId);
    if (!actionSet.has(actionId) || typeof permissionId !== "string" || !permissionSet.has(permissionId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", "$/permissions/operationActionPermissions", `Operation action ${actionId} has unknown action or permission authority.`, "Map declared actions to declared permissions."));
  }
  for (const actionId of actionIds) if (!permissionMappedActions.has(actionId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", "$/permissions", `Action ${actionId} has no exact permission mapping.`, "Map every action to object or operation authority."));

  for (const [index, object] of objects.entries()) {
    const path = `$/objects/${index}`;
    const id = String(object.id ?? "<missing>");
    if (!ownerSet.has(String(object.owner))) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `${path}/owner`, `Object ${id} names unknown owner ${String(object.owner)}.`, "Reference declared owner ID."));
    const consumers = strings(object.dailyJourneyIds);
    if (consumers.length === 0) diagnostics.push(diagnostic("PHASE13_OBJECT_UNMAPPED", `${path}/dailyJourneyIds`, `Object ${id} has no daily workflow consumer.`, "Map object to one or more declared daily journeys."));
    for (const journeyId of consumers) if (!journeySet.has(journeyId)) diagnostics.push(diagnostic("PHASE13_OBJECT_UNMAPPED", `${path}/dailyJourneyIds`, `Object ${id} maps unknown journey ${journeyId}.`, "Reference declared daily journey."));
    if (strings(object.requiredFields).length === 0 || typeof object.retention !== "string" || object.retention === "") diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", path, `Object ${id} lacks required fields or retention.`, "Declare required fields and retention."));
  }

  const mappedObjects = new Set<string>();
  const mappedRoutes = new Set<string>();
  const mappedActions = new Set<string>();
  for (const [index, journey] of journeys.entries()) {
    const path = `$/journeys/${index}`;
    if (!ownerSet.has(String(journey.owner))) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `${path}/owner`, `Journey ${String(journey.id)} names unknown owner.`, "Reference declared owner ID."));
    for (const [kind, ids, known] of [["object", strings(journey.objectIds), objectSet], ["route", strings(journey.routeIds), routeSet], ["action", strings(journey.actionIds), actionSet]] as const) {
      if (ids.length === 0) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", `${path}/${kind}Ids`, `Journey ${String(journey.id)} has no ${kind} mapping.`, "Map each journey to product object, route, and action IDs."));
      for (const id of ids) {
        if (!known.has(id)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `${path}/${kind}Ids`, `Journey ${String(journey.id)} references unknown ${kind} ID ${id}.`, "Reference an ID declared by this contract."));
        if (kind === "object") mappedObjects.add(id);
        if (kind === "route") mappedRoutes.add(id);
        if (kind === "action") mappedActions.add(id);
      }
    }
  }
  for (const id of objectIds) if (id && !mappedObjects.has(id)) diagnostics.push(diagnostic("PHASE13_OBJECT_UNMAPPED", "$/journeys", `Object ${id} has no mapped daily journey.`, "Map every object through a daily journey."));
  for (const id of routeIds) if (id && !mappedRoutes.has(id)) diagnostics.push(diagnostic("PHASE13_OBJECT_UNMAPPED", "$/journeys", `Route ${id} has no mapped daily journey.`, "Map every route through a daily journey."));
  for (const id of actionIds) if (id && !mappedActions.has(id)) diagnostics.push(diagnostic("PHASE13_OBJECT_UNMAPPED", "$/journeys", `Action ${id} has no mapped daily journey.`, "Map every action through a daily journey."));

  const lifecycleObjectIds = new Set<string>();
  const lifecycleObjectReferencesAll: string[] = [];
  const lifecycleIds: string[] = [];
  for (const [index, lifecycle] of records(contract.lifecycles).entries()) {
    const path = `$/lifecycles/${index}`;
    lifecycleIds.push(typeof lifecycle.id === "string" ? lifecycle.id : "");
    const lifecycleObjectReferences = [typeof lifecycle.objectId === "string" ? lifecycle.objectId : "", ...strings(lifecycle.alsoAppliesTo)];
    for (const objectId of lifecycleObjectReferences) {
      if (!objectSet.has(objectId)) diagnostics.push(diagnostic("PHASE13_UNKNOWN_ID", `${path}/objectId`, `Lifecycle ${String(lifecycle.id)} references unknown object ${objectId || "<missing>"}.`, "Reference a declared object ID."));
      lifecycleObjectIds.add(objectId);
      lifecycleObjectReferencesAll.push(objectId);
    }
    const states = strings(lifecycle.states);
    const stateSet = new Set(states);
    const terminal = new Set(strings(lifecycle.terminalStates));
    for (const objectId of lifecycleObjectReferences) {
      const object = objects.find(({ id }) => id === objectId);
      if (states.length > 1 && object !== undefined && !strings(object.requiredFields).some((field) => field === "status" || field === "state") && typeof object.stateSource !== "string") diagnostics.push(diagnostic("PHASE13_ILLEGAL_TRANSITION", `${path}/objectId`, `Stateful object ${objectId} has no required state field or explicit state source.`, "Bind lifecycle to a persisted state field."));
    }
    if (states.length === 0 || duplicateIds(states).length > 0) diagnostics.push(diagnostic("PHASE13_ILLEGAL_TRANSITION", `${path}/states`, `Lifecycle ${String(lifecycle.id)} has missing or duplicate states.`, "Declare each lifecycle state once."));
    for (const state of terminal) if (!stateSet.has(state)) diagnostics.push(diagnostic("PHASE13_ILLEGAL_TRANSITION", `${path}/terminalStates`, `Terminal state ${state} is not declared.`, "Use declared lifecycle state."));
    const seenTransitions = new Set<string>();
    const transitionMechanisms = record(lifecycle.transitionMechanisms) ?? {};
    for (const [transitionIndex, transition] of (Array.isArray(lifecycle.transitions) ? lifecycle.transitions : []).entries()) {
      const pair = strings(transition);
      const [from, to] = pair;
      const key = `${from ?? ""}->${to ?? ""}`;
      if (pair.length !== 2 || from === undefined || to === undefined || !stateSet.has(from) || !stateSet.has(to) || from === to || terminal.has(from) || seenTransitions.has(key)) {
        diagnostics.push(diagnostic("PHASE13_ILLEGAL_TRANSITION", `${path}/transitions/${transitionIndex}`, `Illegal lifecycle transition for ${String(lifecycle.id)}.`, "Use one non-duplicate transition between declared non-terminal source and declared target."));
      }
      seenTransitions.add(key);
    }
    if (!sameSet(Object.keys(transitionMechanisms), [...seenTransitions]) || Object.values(transitionMechanisms).some((mechanism) => {
      const mechanisms = typeof mechanism === "string" ? [mechanism] : strings(mechanism);
      return mechanisms.length === 0 || mechanisms.some((id) => !id.startsWith("host:") && !actionSet.has(id));
    })) diagnostics.push(diagnostic("PHASE13_ILLEGAL_TRANSITION", `${path}/transitionMechanisms`, `Lifecycle ${String(lifecycle.id)} does not bind every transition to a declared action or host-owned mechanism.`, "Map every transition exactly once to a declared Sales action or explicit host job."));
  }
  if (duplicateIds(lifecycleIds).length > 0) diagnostics.push(diagnostic("PHASE13_DUPLICATE_OWNERSHIP", "$/lifecycles", "Lifecycle IDs must be unique.", "Keep one lifecycle definition per ID."));
  if (duplicateIds(lifecycleObjectReferencesAll).length > 0) diagnostics.push(diagnostic("PHASE13_DUPLICATE_OWNERSHIP", "$/lifecycles", "CRM object has more than one lifecycle owner.", "Map each object to exactly one lifecycle."));
  for (const objectId of objectIds) if (objectId && !lifecycleObjectIds.has(objectId)) diagnostics.push(diagnostic("PHASE13_ILLEGAL_TRANSITION", "$/lifecycles", `Object ${objectId} has no lifecycle coverage.`, "Map every object to a declared lifecycle."));
  const metricIds = records(contract.metrics).map(({ id }) => typeof id === "string" ? id : "");
  diagnostics.push(...setDiagnostics("metric", metricIds, "$/metrics"));
  if (!sameSet(metricIds, requiredMetricIds)) diagnostics.push(diagnostic("PHASE13_AMBIGUOUS_METRIC", "$/metrics", "Metric inventory must contain exactly the seven accepted CRM measures.", "Restore exact metric inventory."));
  for (const [index, metric] of records(contract.metrics).entries()) {
    const required = ["id", "owner", "source", "sourceRevision", "filters", "grouping", "formula", "windowField", "asOf", "timezone", "currency", "emptyResult"] as const;
    const missing = required.filter((field) => typeof metric[field] !== "string" || metric[field] === "");
    if (missing.length > 0 || !ownerSet.has(String(metric.owner)) || !["zero", "null"].includes(String(metric.emptyResult))) diagnostics.push(diagnostic("PHASE13_AMBIGUOUS_METRIC", `$/metrics/${index}`, `Metric ${String(metric.id)} lacks exact source/window/timezone/currency/empty-value semantics or owner.`, "Declare all metric semantics and a declared owner."));
  }
  const weightedForecast = records(contract.metrics).find(({ id }) => id === "sales.metric.weighted-forecast");
  const salesCycle = records(contract.metrics).find(({ id }) => id === "sales.metric.sales-cycle-duration");
  if (!String(weightedForecast?.formula ?? "").includes("half-up") || !String(weightedForecast?.formula ?? "").includes("reporting currency scale") || !String(salesCycle?.formula ?? "").includes("even cardinality") || !String(salesCycle?.formula ?? "").includes("floor each")) diagnostics.push(diagnostic("PHASE13_AMBIGUOUS_METRIC", "$/metrics", "Weighted forecast or sales-cycle rounding semantics are incomplete or unsupported.", "Use aggregate-once half-up money rounding and floor-before-exact-median cycle semantics."));
  const mapping = record(contract.migration)?.legacyOpportunityStageMap;
  const expected = { lead: "qualification", qualified: "discovery", won: "won", lost: "lost" };
  if (JSON.stringify(mapping) !== JSON.stringify(expected)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/migration/legacyOpportunityStageMap", "Legacy opportunity stage mapping is not canonical.", "Preserve exact predecessor mapping."));
  const migration = record(contract.migration);
  if (JSON.stringify(migration?.legacyTaskStatusMap) !== JSON.stringify({ open: "open", done: "completed" }) || migration?.stableIdsRequired !== true || migration?.stableTimestampsRequired !== true || migration?.dualWriteAllowed !== false || migration?.silentDefaultsAllowed !== false || migration?.pipelineStageOpaqueIdMigration !== pipelineStageOpaqueIdMigration || [migration?.legacyOpportunitySafety, migration?.legacyTaskSafety, migration?.persistedReferenceSafety].some((value) => typeof value !== "string" || value === "")) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/migration", "Predecessor maps, stable identity/timestamp rules, opaque-stage migration, or migration safety decisions are invalid.", "Restore lossless migration maps and safety flags."));
  const dataSemantics = record(contract.dataSemantics);
  const ownershipAssignment = record(dataSemantics?.ownershipAssignment);
  const leadQualification = record(dataSemantics?.leadQualification);
  const protectedFieldMutation = record(dataSemantics?.protectedFieldMutation);
  const opportunityMutation = record(dataSemantics?.opportunityMutation);
  const noteCorrection = record(dataSemantics?.noteCorrection);
  const configuredPipeline = record(dataSemantics?.pipelineConfiguration);
  const configuredSavedView = record(dataSemantics?.savedViewConfiguration);
  const dataMovement = record(dataSemantics?.dataMovement);
  const polymorphicRelatedTargets = record(dataSemantics?.polymorphicRelatedTargets);
  const objectSpecificRelatedIntent = record(polymorphicRelatedTargets?.objectSpecificIntent);
  const retention = record(contract.retention);
  const nonGoals = strings(contract.nonGoals);
  const ownershipInput = record(ownershipAssignment?.input); const ownershipOutput = record(ownershipAssignment?.output);
  const ownershipValid = ownershipAssignment?.actionId === "sales.ownership.assign" && ownershipAssignment?.version === 2 && sameSet(strings(ownershipAssignment?.recordTypes), ["sales.account", "sales.contact", "sales.lead", "sales.opportunity"]) &&
    JSON.stringify(ownershipInput) === JSON.stringify({ required: ["recordType", "id", "expectedRevision", "ownerId"], optional: ["teamId"], additionalProperties: false, teamNullAllowed: false }) &&
    JSON.stringify(ownershipOutput) === JSON.stringify({ required: ["recordType", "id", "revision", "ownerId"], optional: ["teamId"], additionalProperties: false }) && typeof ownershipAssignment?.admission === "string" && ownershipAssignment.admission.length > 0;
  const qualificationInput = record(leadQualification?.input); const qualificationConditional = record(qualificationInput?.conditional);
  const leadQualificationValid = leadQualification?.actionId === "sales.lead.qualify" && leadQualification?.version === 2 &&
    JSON.stringify(qualificationInput?.required) === JSON.stringify(["id", "expectedRevision", "accountMode", "contactMode", "opportunityName", "pipelineId"]) &&
    JSON.stringify(qualificationConditional) === JSON.stringify({ "create/create": ["accountName", "contactName"], "link/create": ["accountId", "contactName"], "link/link": ["accountId", "contactId"] }) &&
    JSON.stringify(qualificationInput?.rejected) === JSON.stringify(["create/link"]) && qualificationInput?.additionalProperties === false &&
    typeof leadQualification?.lineage === "string" && leadQualification.lineage.length > 0 && typeof leadQualification?.atomicity === "string" && leadQualification.atomicity.length > 0;
  const protectedFieldMutationValid = protectedFieldMutation?.contactLeadUpdateVersion === 2 && sameSet(strings(protectedFieldMutation?.modes), ["retain", "set", "clear"]) && typeof protectedFieldMutation?.input === "string" && typeof protectedFieldMutation?.admission === "string";
  const opportunityCreate = record(opportunityMutation?.create); const opportunityUpdate = record(opportunityMutation?.update);
  const opportunityMutationValid = opportunityMutation?.version === 2 && JSON.stringify(opportunityCreate) === JSON.stringify({ required: ["name", "accountId", "pipelineId", "stageId"], optional: ["primaryContactId", "amount", "expectedCloseDate"], additionalProperties: false }) && JSON.stringify(opportunityUpdate) === JSON.stringify({ required: ["id", "expectedRevision", "name", "primaryContactMode", "amountMode", "expectedCloseDateMode"], modes: ["retain", "set", "clear"], conditional: "primaryContactId, amount, and expectedCloseDate are present iff their corresponding mode is set", additionalProperties: false }) && typeof opportunityMutation?.money === "string" && typeof opportunityMutation?.admission === "string";
  const noteCorrectionValid = noteCorrection?.actionId === "sales.note.create" && noteCorrection?.version === 2 && typeof noteCorrection?.input === "string" && typeof noteCorrection?.immutability === "string";
  const opportunity = objects.find(({ id }) => id === "sales.object.opportunity");
  const pipelineStageObject = objects.find(({ id }) => id === "sales.object.pipeline-stage");
  const savedViewObject = objects.find(({ id }) => id === "sales.object.saved-view");
  const persistedObjectsValid = sameJson(pipelineStageObject?.requiredFields, ["stageId", "name", "semantic", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds", "status", "revision"]) && sameJson(savedViewObject?.requiredFields, ["name", "ownerId", "visibility", "definition", "status", "revision"]) && sameJson(savedViewObject?.derivedFields, { targetObjectId: "definition.targetObjectId exactly", viewKind: "definition.kind exactly" });
  if ([dataSemantics?.money, dataSemantics?.calendarDate, dataSemantics?.instant, dataSemantics?.reportingTimezone].some((value) => typeof value !== "string" || value === "") || !ownershipValid || !leadQualificationValid || !protectedFieldMutationValid || !opportunityMutationValid || !noteCorrectionValid || !persistedObjectsValid || !validPipelineConfiguration(configuredPipeline) || !validSavedViewConfiguration(configuredSavedView) || !validDataMovement(dataMovement, matrix) || opportunity?.stateSource !== opportunityStateSource || !sameSet(strings(polymorphicRelatedTargets?.vocabulary), requiredRelatedRecordTargets) || polymorphicRelatedTargets?.sharedIntent !== "Activities, Notes, Attachment references, and optional Task links may name only this closed target vocabulary and must resolve in their own application and environment." || JSON.stringify(objectSpecificRelatedIntent) !== JSON.stringify({ "sales.object.activity": "required interaction target", "sales.object.note": "required timeline target", "sales.object.attachment-reference": "required storage-reference target", "sales.object.task": "optional follow-up target" }) || retention?.defaultDeletion !== "soft-archive" || retention?.importExportArtifactsDays !== 30 || [retention?.domainRows, retention?.mergeLineage, retention?.audit, retention?.attachmentBytes].some((value) => typeof value !== "string" || value === "") || nonGoals.length < 10 || !nonGoals.includes("second-vertical") || !nonGoals.includes("public-cms") || duplicateIds(nonGoals).length > 0) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/dataSemantics", "Data semantics, stage identity, pipeline/saved-view bounds, import/export/merge safety, mutation admissions, polymorphic target vocabulary, retention, and non-goals must be closed, concrete, and preserve CRM-only scope.", "Restore complete product boundary semantics."));
  const beta = record(contract.betaCriteria);
  const dataset = record(beta?.representativeDataset);
  const dogfood = record(beta?.dogfood);
  const authorization = record(beta?.authorization);
  const importCriteria = record(beta?.import);
  const accessibility = record(beta?.accessibility);
  const performance = record(beta?.performance);
  const reminders = record(beta?.reminders);
  if (dataset?.leads !== 100 || dataset?.accounts !== 50 || dataset?.contacts !== 100 || dataset?.opportunities !== 50 || dataset?.activities !== 200 || dataset?.tasks !== 100 || dataset?.importReplayDuplicateLogicalRecords !== 0 || dataset?.moneyDeltaMinorUnits !== 0 || dogfood?.consecutiveBusinessDays !== 5 || dogfood?.activeHumanUsers !== 2 || dogfood?.unresolvedSev1Sev2Incidents !== 0 || dogfood?.restoreRtoHours !== 4 || dogfood?.backupRpoMinutes !== 15 || authorization?.unauthorizedRecordOrSensitiveValueExposures !== 0 || authorization?.staleMutationBusinessEffects !== 0 || importCriteria?.acceptedCsvRows !== 10000 || importCriteria?.replayDuplicateLogicalRecords !== 0 || importCriteria?.protectedFieldWrites !== 0 || accessibility?.criticalOrSeriousViolations !== 0 || performance?.serverP95Milliseconds !== 1000 || performance?.interactiveP95Milliseconds !== 2500 || performance?.declaredCiHardwareRequired !== true || reminders?.healthyOrRecoveredDeliverySeconds !== 60 || reminders?.crossRecipientDeliveries !== 0 || !sameSet(strings(beta?.requiredSignoffs), requiredOwnerIds)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/betaCriteria", "Limited-beta numeric criteria differ from accepted contract.", "Restore exact dataset, auth, import, accessibility, performance, reminder, dogfood, RTO, RPO, and signoff thresholds."));
  const attacks = records(contract.attacks);
  const attackIds = attacks.map(({ id }) => typeof id === "string" ? id : "");
  if (!sameSet(attackIds, requiredAttackIds) || duplicateIds(attackIds).length > 0) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/attacks", "Attack map must contain exact unique P13-ATK-01 through P13-ATK-15 identities.", "Restore complete unique attack inventory."));
  for (const [index, attack] of attacks.entries()) {
    const deliveryTasks = strings(attack.deliveryTasks);
    const verificationTasks = strings(attack.verificationTasks);
    if (typeof attack.scenario !== "string" || attack.scenario === "" || typeof attack.denial !== "string" || attack.denial === "" || deliveryTasks.length === 0 || deliveryTasks.some((task) => !taskId.test(task)) || duplicateIds(deliveryTasks).length > 0 || !sameSet(verificationTasks, ["P13.10"])) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", `$/attacks/${index}`, "Attack must have scenario, denial, delivery task ownership, and exact P13.10 verification ownership.", "Restore complete attack delivery and verification mapping."));
  }
  const expectedPipelineAttacks = [
    { id: "P13-ATK-02", scenario: "forged-owner-team-pipeline-stage-revision", denial: "deny-forged-mutation", deliveryTasks: ["P13.2", "P13.3", "P13.4"], verificationTasks: ["P13.10"] },
    { id: "P13-ATK-03", scenario: "forged-or-stale-saved-view-revision-or-kanban-transition", denial: "deny-forged-or-stale-view-or-transition", deliveryTasks: ["P13.4"], verificationTasks: ["P13.10"] }
  ];
  if (JSON.stringify(attacks.filter(({ id }) => id === "P13-ATK-02" || id === "P13-ATK-03")) !== JSON.stringify(expectedPipelineAttacks)) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/attacks", "P13.4 pipeline, stage, Kanban, and saved-view attacks must retain exact delivery and denial ownership.", "Restore the accepted P13.4 attack mapping."));
  if (!attacks.some(({ deliveryTasks }) => strings(deliveryTasks).includes("P13.2")) || !attacks.some(({ deliveryTasks }) => strings(deliveryTasks).includes("P13.5"))) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/attacks", "Core/migration and export attacks must be owned by P13.2 and P13.5 before closeout.", "Restore task-local attack delivery ownership."));
  return diagnostics;
}
