import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, DataSourceDescriptorSchema, type DataSourceDefinition, type DataSourceDescriptor } from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import { validateFixtures } from "../src/fixture-validation.js";
import { validatePhase13ProductContract } from "../src/phase-13-product-contract-validation.js";
import { registerPluginContributionOwnershipKeyword } from "../src/plugin-contribution-ownership.js";
import { BoundedQueryBudgetEvaluator } from "../../runtime/src/data-source-budget.js";
import type { DataSourceGatewayRequest, RegisteredDataSource } from "../../runtime/src/data-source-gateway.js";
import {
  declaredFixtureSchema,
  formatDiagnostics,
  parseJsonDocument,
  repositoryFileExists,
  validateEvidenceRegistry,
  validateExpectedDiagnostics,
  validateFixtureInventory,
  validateForbiddenGeneratedKeys,
  validateGeneratedArtifacts,
  validateGeneratedDocument,
  validateGeneratedInventory,
  validateLegacyText,
  validateMarkdownText,
  validateRepository,
  validateValidFixtureCoverage
} from "../src/repository-validation.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function phase13Contract(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(repositoryRoot, "contracts/phase-13-crm-product-contract.v1.json"), "utf8")) as Record<string, unknown>;
}

function stageUuidV5(applicationId: string, environment: string, pipelineStableId: string, semantic: string): string {
  const namespace = Buffer.from("13f5fa89b4655a7aa19d74ed6c5d1ef4", "hex");
  const name = ["phase13/pipeline-stage/v1", applicationId, environment, pipelineStableId, semantic].map((part) => part.normalize("NFC")).join("\0");
  const bytes = createHash("sha1").update(namespace).update(Buffer.from(name, "utf8")).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function budgetSource(descriptor: DataSourceDescriptor): RegisteredDataSource {
  const schema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
  const definition: DataSourceDefinition = { descriptor, inputSchema: schema, outputSchema: schema };
  return { definition, handler: () => undefined };
}

const budgetActor = {
  actor: { principal: { kind: "user" as const, id: "phase13-reviewer" }, effectiveActor: { kind: "user" as const, id: "phase13-reviewer" } },
  request: {},
  authorizationContext: {}
};

function budgetRequest(sourceId: string, size: number, selectedFields: string[]): DataSourceGatewayRequest {
  return { correlationId: `phase13-${sourceId}`, rawRequest: {}, sourceId, surface: "workspace", input: {}, query: { page: { number: 1, size }, filters: [], sort: [] }, selectedFields, signal: new AbortController().signal };
}

describe("P0.4 executable repository validation", () => {
  it("admits the exact Phase 13 administration source cost bounds with the real evaluator", async () => {
    const contract = await phase13Contract();
    const descriptors = ((((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors) as Record<string, DataSourceDescriptor>);
    for (const [id, size] of [["sales.pipeline.snapshot", 6], ["sales.saved-view.detail", 33]] as const) {
      const descriptor = descriptors[id]!;
      const selectedFields = descriptor.outputFields!.map(({ id: fieldId }) => fieldId);
      const source = budgetSource(descriptor);
      const request = budgetRequest(id, size, selectedFields);
      const lease = new BoundedQueryBudgetEvaluator().evaluate(source, request, budgetActor, { selectedFields, recordScope: {} }).lease;
      lease.release();
      const undersized = budgetSource({ ...descriptor, limits: { ...descriptor.limits, maxCost: 13 } });
      expect(() => new BoundedQueryBudgetEvaluator().evaluate(undersized, request, budgetActor, { selectedFields, recordScope: {} })).toThrowError(expect.objectContaining({ code: "QUERY_COST_EXCEEDED" }));
    }
  });

  it("rejects Phase 13 duplicate ownership, unknown IDs, illegal transitions, ambiguous metrics, and unmapped objects", async () => {
    const duplicateOwner = structuredClone(await phase13Contract());
    (duplicateOwner.owners as Array<unknown>).push((duplicateOwner.owners as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicateOwner).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const unknownJourney = structuredClone(await phase13Contract());
    ((unknownJourney.journeys as Array<Record<string, unknown>>)[0]!.routeIds as string[])[0] = "sales.route.unknown";
    expect(validatePhase13ProductContract(unknownJourney).map(({ code }) => code)).toContain("PHASE13_UNKNOWN_ID");

    const illegalTransition = structuredClone(await phase13Contract());
    ((illegalTransition.lifecycles as Array<Record<string, unknown>>)[0]!.transitions as unknown[]).push(["qualified", "working"]);
    expect(validatePhase13ProductContract(illegalTransition).map(({ code }) => code)).toContain("PHASE13_ILLEGAL_TRANSITION");

    const ambiguousMetric = structuredClone(await phase13Contract());
    (ambiguousMetric.metrics as Array<Record<string, unknown>>)[0]!.timezone = "";
    expect(validatePhase13ProductContract(ambiguousMetric).map(({ code }) => code)).toContain("PHASE13_AMBIGUOUS_METRIC");

    const unmappedObject = structuredClone(await phase13Contract());
    (unmappedObject.objects as Array<Record<string, unknown>>)[0]!.dailyJourneyIds = [];
    expect(validatePhase13ProductContract(unmappedObject).map(({ code }) => code)).toContain("PHASE13_OBJECT_UNMAPPED");

    const orphanedLifecycle = structuredClone(await phase13Contract());
    ((orphanedLifecycle.lifecycles as Array<Record<string, unknown>>)[1]!.alsoAppliesTo as string[]).splice(0, 1);
    expect(validatePhase13ProductContract(orphanedLifecycle).map(({ code }) => code)).toContain("PHASE13_ILLEGAL_TRANSITION");

    const deletedMatrixRow = structuredClone(await phase13Contract());
    (deletedMatrixRow.permissions as Record<string, unknown>).objectFieldActionMatrix = (deletedMatrixRow.permissions as Record<string, unknown>).objectFieldActionMatrix as Array<unknown>;
    ((deletedMatrixRow.permissions as Record<string, unknown>).objectFieldActionMatrix as Array<unknown>).shift();
    expect(validatePhase13ProductContract(deletedMatrixRow).map(({ code }) => code)).toContain("PHASE13_UNKNOWN_ID");

    const misassignedPermission = structuredClone(await phase13Contract());
    (((misassignedPermission.permissions as Record<string, unknown>).personaGrants as Array<Record<string, unknown>>)[0]!.permissionIds as string[])[0] = "sales.permission.unknown";
    expect(validatePhase13ProductContract(misassignedPermission).map(({ code }) => code)).toContain("PHASE13_UNKNOWN_ID");

    const missingRouteAuthority = structuredClone(await phase13Contract());
    ((missingRouteAuthority.permissions as Record<string, unknown>).routePermissions as unknown[]).pop();
    expect(validatePhase13ProductContract(missingRouteAuthority).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    for (const section of ["target", "permissions", "lifecycles", "metrics", "attacks", "nonGoals", "dataSemantics", "retention"]) {
      const missingSection = structuredClone(await phase13Contract());
      delete missingSection[section];
      expect(validatePhase13ProductContract(missingSection).map(({ code }) => code), section).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");
    }

    const extraSection = structuredClone(await phase13Contract());
    extraSection.future = {};
    expect(validatePhase13ProductContract(extraSection).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const orphanRoute = structuredClone(await phase13Contract());
    (orphanRoute.routes as string[]).push("sales.route.orphan");
    expect(validatePhase13ProductContract(orphanRoute).map(({ code }) => code)).toContain("PHASE13_OBJECT_UNMAPPED");

    const orphanAction = structuredClone(await phase13Contract());
    (orphanAction.actions as string[]).push("sales.action.orphan");
    expect(validatePhase13ProductContract(orphanAction).map(({ code }) => code)).toContain("PHASE13_OBJECT_UNMAPPED");

    const duplicateLifecycle = structuredClone(await phase13Contract());
    (duplicateLifecycle.lifecycles as Array<unknown>).push((duplicateLifecycle.lifecycles as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicateLifecycle).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const duplicatePersona = structuredClone(await phase13Contract());
    (duplicatePersona.personas as Array<unknown>).push((duplicatePersona.personas as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicatePersona).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const duplicateGrant = structuredClone(await phase13Contract());
    const duplicateGrantPermissions = duplicateGrant.permissions as Record<string, unknown>;
    (duplicateGrantPermissions.personaGrants as Array<unknown>).push((duplicateGrantPermissions.personaGrants as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicateGrant).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const missingPredecessor = structuredClone(await phase13Contract());
    ((missingPredecessor.predecessorInventory as Record<string, unknown>).identities as string[]).pop();
    expect(validatePhase13ProductContract(missingPredecessor).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeMigration = structuredClone(await phase13Contract());
    (unsafeMigration.migration as Record<string, unknown>).legacyTaskStatusMap = { open: "open", done: "done" };
    expect(validatePhase13ProductContract(unsafeMigration).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeScopeAdministration = structuredClone(await phase13Contract());
    ((unsafeScopeAdministration.permissions as Record<string, unknown>).scopeAdministration as Record<string, unknown>).lifecycle = "revoked scopes may auto-reactivate";
    expect(validatePhase13ProductContract(unsafeScopeAdministration).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeRelatedVocabulary = structuredClone(await phase13Contract());
    ((((unsafeRelatedVocabulary.dataSemantics as Record<string, unknown>).polymorphicRelatedTargets as Record<string, unknown>).vocabulary as string[])).pop();
    expect(validatePhase13ProductContract(unsafeRelatedVocabulary).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeLeadQualification = structuredClone(await phase13Contract());
    (((unsafeLeadQualification.dataSemantics as Record<string, unknown>).leadQualification as Record<string, unknown>).input as Record<string, unknown>).rejected = [];
    expect(validatePhase13ProductContract(unsafeLeadQualification).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    for (const semantic of ["protectedFieldMutation", "opportunityMutation", "noteCorrection", "pipelineConfiguration", "savedViewConfiguration"]) {
      const unsafeMutation = structuredClone(await phase13Contract());
      delete (unsafeMutation.dataSemantics as Record<string, unknown>)[semantic];
      expect(validatePhase13ProductContract(unsafeMutation).map(({ code }) => code), semantic).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");
    }

    const invalidPipelineUuid = structuredClone(await phase13Contract());
    const invalidPipelineConfiguration = (invalidPipelineUuid.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>;
    (invalidPipelineConfiguration.stageIds as Record<string, unknown>).namespace = "00000000-0000-0000-0000-000000000000";
    expect(validatePhase13ProductContract(invalidPipelineUuid).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const pipelineStageIds = (((await phase13Contract()).dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).stageIds as Record<string, unknown>;
    const goldenVectors = pipelineStageIds.goldenVectors as Array<Record<string, string>>;
    for (const vector of goldenVectors) expect(stageUuidV5(vector.applicationId!, vector.environment!, vector.pipelineStableId!, vector.semantic!)).toBe(vector.uuid);
    const baseline = stageUuidV5("customer-gate-1", "production", "17", "qualification");
    expect(new Set([baseline, stageUuidV5("customer-gate-2", "production", "17", "qualification"), stageUuidV5("customer-gate-1", "staging", "17", "qualification"), stageUuidV5("customer-gate-1", "production", "18", "qualification"), stageUuidV5("customer-gate-1", "production", "17", "discovery")]).size).toBe(5);

    const immutableEvidenceRewrite = structuredClone(await phase13Contract());
    const immutableMigration = ((immutableEvidenceRewrite.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).migration as Record<string, unknown>;
    (immutableMigration.mutableReferences as string[]).push("idempotency result bodies");
    expect(validatePhase13ProductContract(immutableEvidenceRewrite).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unfencedStageMove = structuredClone(await phase13Contract());
    const unfencedStageInput = ((((unfencedStageMove.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).stageMove as Record<string, unknown>).input as Record<string, unknown>);
    (unfencedStageInput.required as string[]).pop();
    expect(validatePhase13ProductContract(unfencedStageMove).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const compatibilityShim = structuredClone(await phase13Contract());
    const successorPipeline = (compatibilityShim.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>;
    const successorActions = ((successorPipeline.successorContracts as Record<string, unknown>).actions as Record<string, unknown>);
    (successorActions["sales.opportunity.stage.update"] as Record<string, unknown>).toVersion = 2;
    expect(validatePhase13ProductContract(compatibilityShim).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeSavedSource = structuredClone(await phase13Contract());
    const unsafeSavedConfiguration = (unsafeSavedSource.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>;
    ((unsafeSavedConfiguration.sourceDescriptors as Record<string, unknown>)["sales.saved-view.table"] as Record<string, unknown>).version = 2;
    expect(validatePhase13ProductContract(unsafeSavedSource).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const acceptedSavedSources = (((await phase13Contract()).dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>;
    for (const [id, descriptor] of Object.entries(acceptedSavedSources)) expect(DataSourceDescriptorSchema.safeParse(descriptor).success, id).toBe(true);

    const unsafeSavedFilter = structuredClone(await phase13Contract());
    const unsafeDefinition = ((unsafeSavedFilter.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).definition as Record<string, unknown>;
    (unsafeDefinition.filters as Record<string, unknown>).conjunction = "or";
    expect(validatePhase13ProductContract(unsafeSavedFilter).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeSavedActionVersion = structuredClone(await phase13Contract());
    const unsafeSavedVersions = ((unsafeSavedActionVersion.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).versions as Record<string, unknown>;
    unsafeSavedVersions["sales.saved-view.update"] = 1;
    expect(validatePhase13ProductContract(unsafeSavedActionVersion).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const missingTransitionTranslation = structuredClone(await phase13Contract());
    const translationMigration = ((missingTransitionTranslation.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).migration as Record<string, unknown>;
    (translationMigration.mutableReferences as string[]).splice((translationMigration.mutableReferences as string[]).indexOf("sales_pipeline_stages.allowed_transition_stage_ids"), 1);
    expect(validatePhase13ProductContract(missingTransitionTranslation).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const crossVersionReplay = structuredClone(await phase13Contract());
    const crossVersionBindings = ((((crossVersionReplay.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>));
    crossVersionBindings.bindings = "compatibility alias";
    expect(validatePhase13ProductContract(crossVersionReplay).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeCalendarVariant = structuredClone(await phase13Contract());
    const unsafeVariants = (((unsafeCalendarVariant.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).definition as Record<string, unknown>).variants as Record<string, unknown>;
    ((unsafeVariants.calendar as Record<string, unknown>).dateField as string[]).pop();
    expect(validatePhase13ProductContract(unsafeCalendarVariant).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeFieldAuthority = structuredClone(await phase13Contract());
    const savedOpportunity = (((((unsafeFieldAuthority.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).authorityMatrix as Record<string, unknown>).table as Record<string, unknown>)["sales.object.opportunity"] as Record<string, unknown>);
    ((((savedOpportunity.fields as Record<string, unknown>).amount as Record<string, unknown>))).permission = "sales.opportunities.read";
    expect(validatePhase13ProductContract(unsafeFieldAuthority).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const invalidPlatformKind = structuredClone(await phase13Contract());
    const tableDescriptor = ((((invalidPlatformKind.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>)["sales.saved-view.table"] as Record<string, unknown>);
    (tableDescriptor.outputFields as Array<Record<string, unknown>>)[0]!.kind = "stage";
    expect(validatePhase13ProductContract(invalidPlatformKind).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const excessiveFieldOperators = structuredClone(await phase13Contract());
    const excessiveTable = ((((excessiveFieldOperators.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>)["sales.saved-view.table"] as Record<string, unknown>);
    ((excessiveTable.outputFields as Array<Record<string, unknown>>)[0]!.filterOperators as string[]).push("ends-with");
    expect(validatePhase13ProductContract(excessiveFieldOperators).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const wrongSavedViewRegistry = structuredClone(await phase13Contract());
    const registries = (((wrongSavedViewRegistry.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).registries as Record<string, unknown>);
    ((registries.routes as Array<Record<string, unknown>>)[2]!).pageId = "sales.page.saved-view-management";
    expect(validatePhase13ProductContract(wrongSavedViewRegistry).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const missingSourceSuccessor = structuredClone(await phase13Contract());
    const sourceSuccessors = ((((missingSourceSuccessor.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).sources as Record<string, unknown>);
    delete sourceSuccessors["sales.opportunities"];
    expect(validatePhase13ProductContract(missingSourceSuccessor).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const forgedSourceHash = structuredClone(await phase13Contract());
    const forgedDescriptor = ((((forgedSourceHash.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>)["sales.saved-view.kanban"] as Record<string, unknown>);
    forgedDescriptor.structuralCompatibilityHash = `sha256:${"0".repeat(64)}`;
    expect(validatePhase13ProductContract(forgedSourceHash).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const widenedTableResult = structuredClone(await phase13Contract());
    const widenedExecution = (((widenedTableResult.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>);
    (widenedExecution.result as Record<string, unknown>).required = ["source", "fields", "rows", "page"];
    expect(validatePhase13ProductContract(widenedTableResult).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const invalidNullFilter = structuredClone(await phase13Contract());
    const invalidFilterDefinition = (((invalidNullFilter.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).definition as Record<string, unknown>);
    (invalidFilterDefinition.filters as Record<string, unknown>).itemRequired = ["fieldId", "operator", "value"];
    expect(validatePhase13ProductContract(invalidNullFilter).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const widenedReadAuthority = structuredClone(await phase13Contract());
    const widenedAuthority = ((((widenedReadAuthority.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>).authority as Record<string, unknown>);
    widenedAuthority.read = "current sales.saved-views.read";
    expect(validatePhase13ProductContract(widenedReadAuthority).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const ambiguousLostClose = structuredClone(await phase13Contract());
    const ambiguousClose = (((((ambiguousLostClose.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).actions as Record<string, unknown>)["sales.opportunity.close"] as Record<string, unknown>);
    delete (ambiguousClose.input as Record<string, unknown>).optional;
    expect(validatePhase13ProductContract(ambiguousLostClose).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const openPipelineResult = structuredClone(await phase13Contract());
    const openPipelineAction = (((((openPipelineResult.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).actions as Record<string, unknown>)["sales.pipeline.update"] as Record<string, unknown>);
    delete (openPipelineAction.output as Record<string, unknown>).stageItem;
    expect(validatePhase13ProductContract(openPipelineResult).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const inventedUiHash = structuredClone(await phase13Contract());
    const changedContribution = (((((inventedUiHash.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).contributions as Record<string, unknown>)["sales.opportunity-kanban"] as Record<string, unknown>);
    changedContribution.structuralCompatibilityHash = `sha256:${"a".repeat(64)}`;
    expect(validatePhase13ProductContract(inventedUiHash).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const terminalStageUpdate = structuredClone(await phase13Contract());
    const terminalInput = (((((terminalStageUpdate.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).actions as Record<string, unknown>)["sales.opportunity.stage.update"] as Record<string, unknown>).input as Record<string, unknown>;
    terminalInput.destination = "terminal semantic won or lost only";
    expect(validatePhase13ProductContract(terminalStageUpdate).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const missingDataMovement = structuredClone(await phase13Contract());
    delete (missingDataMovement.dataSemantics as Record<string, unknown>).dataMovement;
    expect(validatePhase13ProductContract(missingDataMovement).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeImportFormula = structuredClone(await phase13Contract());
    const unsafeSchema = (((unsafeImportFormula.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).importSchema as Record<string, unknown>);
    unsafeSchema.formulaLeading = ["="];
    expect(validatePhase13ProductContract(unsafeImportFormula).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeImportChunk = structuredClone(await phase13Contract());
    const unsafeLimits = (((((unsafeImportChunk.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).csv as Record<string, unknown>).limits as Record<string, unknown>));
    unsafeLimits.workerChunkRows = 251;
    expect(validatePhase13ProductContract(unsafeImportChunk).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeCandidateLeak = structuredClone(await phase13Contract());
    const unsafeCandidates = (((((unsafeCandidateLeak.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).dedupeAndMerge as Record<string, unknown>).candidateSource as Record<string, unknown>));
    unsafeCandidates.authority = "show candidate count";
    expect(validatePhase13ProductContract(unsafeCandidateLeak).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeMergeRewrite = structuredClone(await phase13Contract());
    const unsafeRewrite = ((((((unsafeMergeRewrite.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).dedupeAndMerge as Record<string, unknown>).merge as Record<string, unknown>).relatedRewriteSets as Record<string, unknown>)["sales.object.account"] as string[]);
    unsafeRewrite.pop();
    expect(validatePhase13ProductContract(unsafeMergeRewrite).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeActionEnvelope = structuredClone(await phase13Contract());
    const unsafeInput = (((((unsafeActionEnvelope.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).descriptors as Record<string, unknown>).actions as Record<string, unknown>)["sales.import.commit"] as Record<string, unknown>).inputSchema as Record<string, unknown>;
    unsafeInput.additionalProperties = true;
    expect(validatePhase13ProductContract(unsafeActionEnvelope).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafePurge = structuredClone(await phase13Contract());
    const unsafePurgeSet = ((((unsafePurge.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).purge as Record<string, unknown>).delete as string[]);
    unsafePurgeSet.pop();
    expect(validatePhase13ProductContract(unsafePurge).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeDedupeOrder = structuredClone(await phase13Contract());
    (((unsafeDedupeOrder.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).dedupeSchema as Record<string, unknown>).order = "database order";
    expect(validatePhase13ProductContract(unsafeDedupeOrder).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeContactMerge = structuredClone(await phase13Contract());
    (((unsafeContactMerge.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).mergeSchema as Record<string, unknown>).contactAccount = "any contact";
    expect(validatePhase13ProductContract(unsafeContactMerge).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const p135Mutations: Array<[string, (movement: Record<string, unknown>) => void]> = [
      ["idempotency duplicated inside input", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const input = ((actions["sales.import.commit"] as Record<string, unknown>).inputSchema as Record<string, unknown>); ((input.properties as Record<string, unknown>).idempotencyKey) = { type: "string" }; }],
      ["array item schema removed", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const input = ((actions["sales.import.dry-run"] as Record<string, unknown>).inputSchema as Record<string, unknown>); const request = ((input.properties as Record<string, unknown>).request as Record<string, unknown>); const branch = (request.oneOf as Array<Record<string, unknown>>)[0]!; delete (((branch.properties as Record<string, unknown>).columnMapping as Record<string, unknown>).items); }],
      ["output schema opened", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); ((actions["sales.merge.commit"] as Record<string, unknown>).outputSchema as Record<string, unknown>).additionalProperties = true; }],
      ["source structural hash drift", (movement) => { const sources = ((movement.descriptors as Record<string, unknown>).sources as Record<string, unknown>); (sources["sales.dedupe.candidates"] as Record<string, unknown>).structuralCompatibilityHash = `sha256:${"0".repeat(64)}`; }],
      ["fatal dry-run persistence", (movement) => { (movement.workerProtocol as Record<string, unknown>).genesis = "persist fatal job"; }],
      ["lease expiry removed", (movement) => { const persistence = (((movement.import as Record<string, unknown>).persistence as Record<string, unknown>).importChunk as string[]); persistence.splice(persistence.indexOf("leaseExpiresAt"), 1); }],
      ["snapshot identity removed", (movement) => { const persistence = (((movement.export as Record<string, unknown>).persistence as Record<string, unknown>).snapshotRow as string[]); persistence.splice(persistence.indexOf("recordId"), 1); }],
      ["contact relation rewrite removed", (movement) => { const merge = ((movement.dedupeAndMerge as Record<string, unknown>).merge as Record<string, unknown>); const rewrites = ((merge.relatedRewriteSets as Record<string, unknown>)["sales.object.contact"] as string[]); rewrites.pop(); }],
      ["match-kind mismatch", (movement) => { const candidate = ((movement.dedupeAndMerge as Record<string, unknown>).candidateSource as Record<string, unknown>); (candidate.matchKinds as string[])[3] = "contact-both"; }],
      ["merge revision rule removed", (movement) => { (movement.mergeSchema as Record<string, unknown>).output = "revisions unspecified"; }],
      ["raw payload retained", (movement) => { const purge = movement.purge as Record<string, unknown>; (purge.delete as string[]).splice((purge.delete as string[]).indexOf("canonicalMappedJson"), 1); }],
      ["record policy substitution", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); (actions["sales.import.commit"] as Record<string, unknown>).policy = "sales.imports.execute.policy"; }],
      ["wrong target field", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const input = ((actions["sales.import.dry-run"] as Record<string, unknown>).inputSchema as Record<string, unknown>); const request = ((input.properties as Record<string, unknown>).request as Record<string, unknown>); const branch = (request.oneOf as Array<Record<string, unknown>>)[0]!; const mapping = ((branch.properties as Record<string, unknown>).columnMapping as Record<string, unknown>); const item = mapping.items as Record<string, unknown>; ((((item.properties as Record<string, unknown>).fieldId as Record<string, unknown>).enum as string[])).push("name"); }],
      ["mismatched export source", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const input = ((actions["sales.export.create"] as Record<string, unknown>).inputSchema as Record<string, unknown>); const request = ((input.properties as Record<string, unknown>).request as Record<string, unknown>); const branch = (request.oneOf as Array<Record<string, unknown>>)[0]!; (((branch.properties as Record<string, unknown>).sourceId as Record<string, unknown>).enum as string[])[0] = "sales.accounts"; }],
      ["duplicate field enum", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const input = ((actions["sales.export.create"] as Record<string, unknown>).inputSchema as Record<string, unknown>); const request = ((input.properties as Record<string, unknown>).request as Record<string, unknown>); const branch = (request.oneOf as Array<Record<string, unknown>>)[0]!; const fields = ((((branch.properties as Record<string, unknown>).selectedFields as Record<string, unknown>).items as Record<string, unknown>).enum as string[]); fields.push(fields[0]!); }],
      ["unsafe integer bound", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const input = ((actions["sales.import.commit"] as Record<string, unknown>).inputSchema as Record<string, unknown>); (((input.properties as Record<string, unknown>).importJobId as Record<string, unknown>).maximum) = 9007199254740992; }],
      ["selection mapping drift", (movement) => { ((movement.selectionResolver as Record<string, unknown>).mapping as Record<string, unknown>).recordId = "record-id"; }],
      ["export worker fence removed", (movement) => { const worker = ((movement.export as Record<string, unknown>).worker as Record<string, unknown>); delete worker.cancelRace; }],
      ["referenced error undeclared", (movement) => { (movement.publicErrors as string[]).splice((movement.publicErrors as string[]).indexOf("IMPORT_WORKER_RETRY_EXHAUSTED"), 1); }],
      ["merge relation ID widened", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); const output = ((actions["sales.merge.commit"] as Record<string, unknown>).outputSchema as Record<string, unknown>); const counts = ((output.properties as Record<string, unknown>).rewrittenRelationCounts as Record<string, unknown>); const item = counts.items as Record<string, unknown>; ((((item.properties as Record<string, unknown>).relationId as Record<string, unknown>).enum as string[])).push("sales_unknown.id"); }],
      ["action permission drift", (movement) => { const actions = ((movement.descriptors as Record<string, unknown>).actions as Record<string, unknown>); (actions["sales.export.create"] as Record<string, unknown>).permission = "sales.imports.execute"; }],
      ["node action binding drift", (movement) => { const pages = ((movement.descriptors as Record<string, unknown>).pages as Array<Record<string, unknown>>); const page = pages[0]!; const nodes = ((((page.document as Record<string, unknown>).regions as Record<string, unknown>).main) as Array<Record<string, unknown>>); (((nodes[0]!.bindings as Record<string, unknown>).action as Record<string, unknown>).id) = "sales.import.cancel"; }],
      ["page permission drift", (movement) => { const pages = ((movement.descriptors as Record<string, unknown>).pages as Array<Record<string, unknown>>); pages[0]!.permission = "sales.exports.read"; }],
      ["selected field requirement drift", (movement) => { const pages = ((movement.descriptors as Record<string, unknown>).pages as Array<Record<string, unknown>>); const nodes = (((pages[0]!.document as Record<string, unknown>).regions as Record<string, unknown>).main) as Array<Record<string, unknown>>; (((nodes[0]!.bindings as Record<string, unknown>).source as Record<string, unknown>).selectedFields as string[]).pop(); }],
      ["runtime rule drift", (movement) => { (movement.runtimeSchemaChecks as Record<string, unknown>).digests = "any digest"; }],
      ["invalid empty table", (movement) => { const tables = ((movement.selectionResolver as Record<string, unknown>).emptyTables as Record<string, unknown>); const table = tables["sales.dedupe.candidates"] as Record<string, unknown>; table.page = { mode: "cursor", hasNext: false }; }],
      ["flat import mapping prose", (movement) => { (movement.csv as Record<string, unknown>).mapping = "dry-run input is flat"; }],
      ["merge direction removed", (movement) => { (movement.mergeSchema as Record<string, unknown>).direction = "either survives"; }],
      ["merge audit action drift", (movement) => { const audit = ((movement.mergeSchema as Record<string, unknown>).audit as Record<string, unknown>); audit.winner = "sales.record.merge-survivor"; }],
      ["header-only import admitted", (movement) => { (movement.csv as Record<string, unknown>).header = "exactly one first record"; }],
      ["export reclaim fence handoff removed", (movement) => { const worker = ((movement.export as Record<string, unknown>).worker as Record<string, unknown>); worker.reclaim = "expired lease uses same current fence at most 3"; }],
      ["duplicate contribution identity", (movement) => { const contributions = ((movement.descriptors as Record<string, unknown>).contributions as Array<Record<string, unknown>>); contributions[1] = structuredClone(contributions[0]!); }],
      ["duplicate page identity", (movement) => { const pages = ((movement.descriptors as Record<string, unknown>).pages as Array<Record<string, unknown>>); pages[1] = structuredClone(pages[0]!); }]
    ];
    for (const [name, mutate] of p135Mutations) {
      const invalid = structuredClone(await phase13Contract());
      const movement = ((invalid.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>);
      mutate(movement);
      const descriptors = movement.descriptors as Record<string, unknown>;
      const descriptorDigests = descriptors.descriptorDigests as Record<string, unknown>;
      for (const key of Object.keys(descriptorDigests)) descriptorDigests[key] = `sha256:${createHash("sha256").update(canonicalJson(descriptors[key])).digest("hex")}`;
      const semanticDigests = movement.semanticDigests as Record<string, unknown>;
      for (const key of Object.keys(semanticDigests)) semanticDigests[key] = `sha256:${createHash("sha256").update(canonicalJson(movement[key])).digest("hex")}`;
      expect(validatePhase13ProductContract(invalid).map(({ code }) => code), name).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");
    }

    const p134Mutations: Array<(contract: Record<string, unknown>) => void> = [
      (contract) => { const registry = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).registries as Record<string, unknown>); ((registry.contributions as Array<Record<string, unknown>>)[1]!).id = "sales.calendar"; },
      (contract) => { const sources = ((((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).sources as Record<string, unknown>); (sources["sales.opportunities"] as Record<string, unknown>).structuralCompatibilityHash = `sha256:${"0".repeat(64)}`; },
      (contract) => { const matrix = ((((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).authorityMatrix as Record<string, unknown>).kanban as Record<string, unknown>); delete (((matrix["sales.object.opportunity"] as Record<string, unknown>).fields as Record<string, unknown>)["stage-metadata"]); },
      (contract) => { const execution = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>); ((execution.query as Record<string, unknown>).selectedFields) = "subset of definition.fields"; },
      (contract) => { const execution = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>); const filters = ((execution.query as Record<string, unknown>).filters as Record<string, unknown>); ((filters.valueOperators as Record<string, unknown>).value) = "any JSON"; },
      (contract) => { const descriptors = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>); delete descriptors["sales.pipeline.snapshot"]; },
      (contract) => { const settings = (((((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>).settings as Record<string, unknown>)["sales.settings.workspace"] as Record<string, unknown>); settings.removedEditableFields = []; },
      (contract) => { const stage = (contract.objects as Array<Record<string, unknown>>).find(({ id }) => id === "sales.object.pipeline-stage")!; (stage.requiredFields as string[]).splice((stage.requiredFields as string[]).indexOf("requiredFieldIds"), 1); },
      (contract) => { const update = (((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).update as Record<string, unknown>); update.positions = "all stages configurable"; },
      (contract) => { const kanban = (((((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).authorityMatrix as Record<string, unknown>).kanban as Record<string, unknown>)["sales.object.opportunity"] as Record<string, unknown>); (((kanban.fields as Record<string, unknown>)["stage-metadata"] as Record<string, unknown>).permission) = "sales.pipelines.read"; },
      (contract) => { const calendar = (((((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).authorityMatrix as Record<string, unknown>).calendar as Record<string, unknown>)["sales.object.activity"] as Record<string, unknown>); (((calendar.fields as Record<string, unknown>).subject as Record<string, unknown>).permission) = "sales.saved-views.read"; },
      (contract) => { const execution = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>); const kinds = (((((execution.query as Record<string, unknown>).filters as Record<string, unknown>).valueOperators as Record<string, unknown>).kinds as Record<string, unknown>)); kinds.integer = "number"; },
      (contract) => { const execution = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>); const nulls = ((((execution.query as Record<string, unknown>).filters as Record<string, unknown>).nullOperators as Record<string, unknown>)); nulls.value = "optional"; },
      (contract) => { const execution = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>); ((execution.persistedSourceBinding as Record<string, unknown>).definitionSourceEquality) = "compatible source"; },
      (contract) => { const execution = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).execution as Record<string, unknown>); execution.compiler = "recheck saved-view revision and current authorization revision"; },
      (contract) => { const descriptors = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>); (descriptors["sales.pipeline.snapshot"] as Record<string, unknown>).permission = "sales.saved-views.read"; },
      (contract) => { const pages = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).registries as Record<string, unknown>).pages as Array<Record<string, unknown>>; delete (((((pages[1]!.document as Record<string, unknown>).regions as Record<string, unknown>).main as Array<Record<string, unknown>>)[0]!).bindings); },
      (contract) => { const pages = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).registries as Record<string, unknown>).pages as Array<Record<string, unknown>>; const node = ((((pages[1]!.document as Record<string, unknown>).regions as Record<string, unknown>).main as Array<Record<string, unknown>>)[0]!); ((((node.bindings as Record<string, unknown>).source as Record<string, unknown>).selectedFields as string[])).pop(); },
      (contract) => { const descriptors = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>); ((descriptors["sales.saved-view.detail"] as Record<string, unknown>).outputFields as Array<Record<string, unknown>>)[4]!.kind = "text"; }
      ,(contract) => { const descriptors = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).sourceDescriptors as Record<string, unknown>); (((descriptors["sales.pipeline.snapshot"] as Record<string, unknown>).limits as Record<string, unknown>).maxCost) = 13; }
      ,(contract) => { const migration = ((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).migration as Record<string, unknown>; ((migration.fieldMapping as Record<string, unknown>).predecessorDatabase) = "allowed_transition_stage_ids"; }
      ,(contract) => { const pipeline = ((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>); ((pipeline.opportunityRevisionAuthority as Record<string, unknown>).permission) = "sales.pipelines.read"; }
      ,(contract) => { const topology = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).topology as Record<string, unknown>; ((((topology.nodes as Record<string, unknown>)["sales.page.calendar/calendar"] as Record<string, unknown>).sourceId)) = "sales.pipeline.snapshot"; }
      ,(contract) => { const successors = (((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>); const contribution = ((successors.contributions as Record<string, unknown>)["sales.opportunity-kanban"] as Record<string, unknown>); ((contribution.descriptor as Record<string, unknown>).permission) = "sales.pipelines.read"; }
      ,(contract) => { const successors = (((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).successorContracts as Record<string, unknown>); const page = ((successors.pages as Record<string, unknown>)["sales.page.opportunities"] as Record<string, unknown>); ((page.descriptor as Record<string, unknown>).permission) = "sales.pipelines.read"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (((closure.savedViewBindingInput as Record<string, unknown>).variants as Array<Record<string, unknown>>)[1]!.required as string[]).pop(); }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (closure.resolver as Record<string, unknown>).owner = "gateway-only override"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; delete ((closure.resolver as Record<string, unknown>).empty as Record<string, unknown>).fields; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (closure.kanbanRows as Record<string, unknown>).pagination = "shared offset"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (closure.canonicalTextCells as Record<string, unknown>).requiredFieldIds = "CSV"; }
      ,(contract) => { const pages = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).registries as Record<string, unknown>).pages as Array<Record<string, unknown>>; const nodes = (((pages[1]!.document as Record<string, unknown>).regions as Record<string, unknown>).main as Array<Record<string, unknown>>); nodes.pop(); }
      ,(contract) => { const registries = (((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).registries as Record<string, unknown>); (registries.contributions as Array<Record<string, unknown>>).pop(); }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (closure.routeExecution as Record<string, unknown>).savedViewDetail = "generic detail size 25"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (closure.routeExecution as Record<string, unknown>).opportunities = "both modes load"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; (closure.savedViewMutationAuthority as Record<string, unknown>).update = "authorize destination only"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const pair = (((closure.savedViewBindingInput as Record<string, unknown>).embeddedMapping as Record<string, unknown>).reservedPair as Record<string, unknown>); (pair.requiredTogether as string[]).pop(); }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const kinds = ((((closure.savedViewBindingInput as Record<string, unknown>).embeddedMapping as Record<string, unknown>).reservedPair as Record<string, unknown>).kinds as Record<string, unknown>); kinds.savedViewId = "string"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const mapping = ((closure.savedViewBindingInput as Record<string, unknown>).embeddedMapping as Record<string, unknown>); (mapping.calendarTableRawVariants as string[])[1] = "exact {savedViewId,expectedRevision,extra}"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const empty = ((closure.resolver as Record<string, unknown>).empty as Record<string, unknown>); (((empty.page as Record<string, unknown>).pageSize as Record<string, unknown>)["sales.page.opportunities/sales-opportunity-kanban"]) = 6; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const detail = ((closure.canonicalTextCells as Record<string, unknown>).detailRows as Record<string, unknown>); (detail.wireMetadata as string[]).pop(); }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const kanban = (closure.kanbanRows as Record<string, unknown>); kanban.crossRowValidation = "stage keys need not match cells"; }
      ,(contract) => { const closure = ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).runtimeClosure as Record<string, unknown>; const input = ((closure.kanbanRows as Record<string, unknown>).stageUpdateInput as Record<string, unknown>); delete input.expectedDestinationStageRevision; }
    ];
    for (const mutate of p134Mutations) {
      const invalid = structuredClone(await phase13Contract());
      mutate(invalid);
      expect(validatePhase13ProductContract(invalid).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");
    }

    const missingAttackDelivery = structuredClone(await phase13Contract());
    ((missingAttackDelivery.attacks as Array<Record<string, unknown>>)[0]!).deliveryTasks = [];
    expect(validatePhase13ProductContract(missingAttackDelivery).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const wrongAttackVerification = structuredClone(await phase13Contract());
    ((wrongAttackVerification.attacks as Array<Record<string, unknown>>)[0]!).verificationTasks = ["P13.9"];
    expect(validatePhase13ProductContract(wrongAttackVerification).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const driftMutations: Array<[string, (contract: Record<string, unknown>) => void]> = [
      ["predecessor substitution", (contract) => { ((contract.predecessorInventory as Record<string, unknown>).identities as string[])[0] = "sales.substituted"; }],
      ["dropped retirement", (contract) => { ((((contract.predecessorInventory as Record<string, unknown>).decisionGroups as Array<Record<string, unknown>>)[3]!.ids as string[])).pop(); }],
      ["added permission", (contract) => { ((contract.permissions as Record<string, unknown>).definitions as string[]).push("sales.extra.read"); }],
      ["viewer privilege widening", (contract) => { ((((contract.permissions as Record<string, unknown>).personaGrants as Array<Record<string, unknown>>)[3]!.permissionIds as string[])).push("sales.accounts.write"); }],
      ["sensitive field remap", (contract) => { (((((contract.permissions as Record<string, unknown>).objectFieldActionMatrix as Array<Record<string, unknown>>)[1]!.sensitiveFields as Record<string, unknown>))).email = "sales.contacts.read"; }],
      ["required owner removal", (contract) => { (((contract.objects as Array<Record<string, unknown>>)[0]!.requiredFields as string[])).splice(1, 1); }],
      ["lifecycle transition removal", (contract) => { (((contract.lifecycles as Array<Record<string, unknown>>)[0]!.transitions as unknown[])).pop(); }],
      ["metric formula replacement", (contract) => { (contract.metrics as Array<Record<string, unknown>>)[0]!.formula = "always zero"; }],
      ["attack task reassignment", (contract) => { (contract.attacks as Array<Record<string, unknown>>)[0]!.deliveryTasks = ["P13.9"]; }]
      ,["opportunity mutation widening", (contract) => { ((((contract.dataSemantics as Record<string, unknown>).opportunityMutation as Record<string, unknown>).create as Record<string, unknown>).additionalProperties = true); }]
      ,["protected channel retain drift", (contract) => { (((contract.dataSemantics as Record<string, unknown>).protectedFieldMutation as Record<string, unknown>).modes as string[]).pop(); }]
      ,["note correction scope drift", (contract) => { ((contract.dataSemantics as Record<string, unknown>).noteCorrection as Record<string, unknown>).input = "any note"; }]
      ,["pipeline snapshot CAS widening", (contract) => { ((((contract.dataSemantics as Record<string, unknown>).pipelineConfiguration as Record<string, unknown>).update as Record<string, unknown>).input as Record<string, unknown>).additionalProperties = true; }]
      ,["saved-view public visibility widening", (contract) => { ((contract.dataSemantics as Record<string, unknown>).savedViewConfiguration as Record<string, unknown>).visibility = "public"; }]
      ,["stage semantic source drift", (contract) => { ((contract.objects as Array<Record<string, unknown>>).find(({ id }) => id === "sales.object.opportunity")!).stateSource = "stage ID spelling"; }]
      ,["pipeline attack delivery drift", (contract) => { ((contract.attacks as Array<Record<string, unknown>>).find(({ id }) => id === "P13-ATK-03")!).deliveryTasks = ["P13.5"]; }]
      ,["P13.5 receipt-retention drift", (contract) => { ((contract.dataSemantics as Record<string, unknown>).dataMovement as Record<string, unknown>).retention = "delete receipts"; }]
    ];
    for (const [name, mutate] of driftMutations) {
      const changed = structuredClone(await phase13Contract());
      mutate(changed);
      expect(validatePhase13ProductContract(changed).map(({ code }) => code), name).toContain("PHASE13_PRODUCT_CONTRACT_DRIFT");
    }
  });

  it("accepts the repository through the complete TypeScript validator", async () => {
    expect(await validateRepository(repositoryRoot)).toEqual([]);
  }, 30_000);

  it("reports malformed JSON without throwing", () => {
    const result = parseJsonDocument("broken.json", "{");
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["JSON_INVALID"]);
  });

  it("reports schema-invalid input", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormatsModule.default(ajv);
    registerPluginContributionOwnershipKeyword(ajv);
    const pluginSchema = JSON.parse(await readFile(resolve(repositoryRoot, "schemas/plugin-manifest.v1.schema.json"), "utf8")) as AnySchema;
    const diagnostics = validateFixtures(
      [{ fixturePath: "invalid-plugin.json", schema: "plugin", value: {} }],
      { forbiddenLegacySymbols: [], identity: { capabilityIdPattern: "^.+$", pluginIdPattern: "^.+$" } },
      { application: ajv.compile({}), plugin: ajv.compile(pluginSchema) },
      new Map()
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(["SCHEMA_INVALID"]);
  });

  it("keeps generated extension-plan SemVer grammar aligned with contracts", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormatsModule.default(ajv);
    const schema = JSON.parse(await readFile(resolve(repositoryRoot, "schemas/extension-install-plan.v1.schema.json"), "utf8")) as AnySchema;
    const validate = ajv.compile(schema);
    const plan = {
      schemaVersion: 1, planId: "plan-semver-1", operationId: "operation-semver-1", operation: "install", version: "1.0.0-rc.1+build.2",
      artifactDigest: `sha256:${"a".repeat(64)}`, expectedRevision: 0, approvalRequired: false, rollback: { available: false, reason: "not-requested" },
      deliveryClass: "platform-plugin", id: "module.sales", availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] }
    };
    expect(validate(plan), ajv.errorsText(validate.errors)).toBe(true);
    const maxVersion = `1.0.0+${"a".repeat(58)}`;
    expect(maxVersion).toHaveLength(64);
    expect(validate({ ...plan, version: maxVersion }), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate({ ...plan, version: `${maxVersion}a` })).toBe(false);
    for (const version of ["1.0.0-01", "1.0.0-alpha..1", "1.0.0-.", "1.0.0+build..1"]) {
      expect(validate({ ...plan, version }), version).toBe(false);
    }
  });

  it("collects multiple simultaneous evidence diagnostics deterministically", () => {
    const diagnostics = validateEvidenceRegistry(
      { levels: ["design-only"], records: { "9999": { level: "unknown", evidence: ["missing.txt"] } } },
      new Set(["0001"]),
      () => false
    );
    expect(diagnostics).toHaveLength(4);
    expect(formatDiagnostics(diagnostics, "json")).toBe(formatDiagnostics([...diagnostics].reverse(), "json"));
  });

  it("catches legacy text, missing links, missing evidence, and nondeterministic generated keys", () => {
    expect(validateLegacyText("active.md", "database.primary", ["database.primary"]).map(({ code }) => code)).toEqual(["LEGACY_SYMBOL_FORBIDDEN"]);
    expect(validateMarkdownText("docs/page.md", "[missing](./missing.md)", () => false).map(({ code }) => code)).toEqual(["MARKDOWN_LINK_INVALID"]);
    expect(validateEvidenceRegistry({ levels: [], records: {} }, new Set(["0001"]), () => true).map(({ code }) => code)).toEqual(["ADR_EVIDENCE_INVALID"]);
    expect(validateGeneratedDocument("generated.json", canonicalJson({ generatedAt: "now" }), { generatedAt: "now" }).map(({ code }) => code)).toEqual(["GENERATED_ARTIFACT_INVALID"]);
    expect(validateGeneratedDocument("generated.json", canonicalJson({ note: "generatedAt" }), { note: "generatedAt" })).toEqual([]);
    expect(validateForbiddenGeneratedKeys("generated.json", { nested: { hostname: "value" } })).toHaveLength(1);
  });

  it("validates bare relative Markdown links and ignores external links", () => {
    const checked: string[] = [];
    const diagnostics = validateMarkdownText(
      "docs/page.md",
      "[bare](guide.md) [dot](./guide.md) [external](https://example.com) [fragment](#section)",
      (target) => { checked.push(target); return false; }
    );
    expect(checked).toEqual(["guide.md", "./guide.md"]);
    expect(diagnostics).toHaveLength(2);
  });

  it("rejects malformed expected diagnostic declarations without throwing", () => {
    const result = validateExpectedDiagnostics({
      "fixtures/contracts/invalid/null.json": null,
      "fixtures/contracts/invalid/schema.json": { code: "SCHEMA_INVALID", schema: "unknown", validator: "json-schema" }
    });
    expect(result.expected).toEqual({});
    expect(result.declaredPaths).toHaveLength(2);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("requires every P0.3 valid fixture category", () => {
    expect(validateValidFixtureCoverage([]).map(({ code }) => code)).toEqual([
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING"
    ]);
  });

  it("identifies fixture schemas from declarations instead of filenames", () => {
    expect(declaredFixtureSchema({ $schema: "../../../schemas/application-manifest.v1.schema.json" })).toBe("application");
    expect(declaredFixtureSchema({ $schema: "../../../schemas/plugin-manifest.v1.schema.json" })).toBe("plugin");
    expect(declaredFixtureSchema({ $schema: "https://schemas.k-nex.dev/authorization.v1.schema.json" })).toBe("authorization");
    expect(declaredFixtureSchema({})).toBeUndefined();
  });

  it("discovers missing and stale invalid-fixture declarations", () => {
    expect(validateFixtureInventory(["fixtures/contracts/invalid/new.json"], [])).toHaveLength(1);
    expect(validateFixtureInventory([], ["fixtures/contracts/invalid/stale.json"])).toHaveLength(1);
  });

  it("rejects duplicate, unsafe, and missing generated inventory entries", () => {
    const result = validateGeneratedInventory(
      { artifacts: ["contracts/valid.json", "contracts/valid.json", "../outside.json", "contracts/missing.json"] },
      (path) => path === "contracts/valid.json"
    );
    expect(result.artifacts).toEqual(["contracts/valid.json", "contracts/missing.json"]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports malformed sidecar JSON at repository level", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "k-nex-sidecar-"));
    try {
      await mkdir(resolve(root, "contracts"));
      await writeFile(resolve(root, "contracts/generated-contracts.v1.json"), "{", "utf8");
      expect((await validateGeneratedArtifacts(root)).map(({ code }) => code)).toEqual(["JSON_INVALID"]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("validates forbidden keys in every inventoried artifact", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "k-nex-artifact-"));
    try {
      await mkdir(resolve(root, "contracts"));
      await writeFile(resolve(root, "contracts/generated-contracts.v1.json"), canonicalJson({ artifacts: ["artifact.json"], generator: "test", version: 1 }), "utf8");
      await writeFile(resolve(root, "artifact.json"), canonicalJson({ generatedAt: "now" }), "utf8");
      const diagnostics = await validateGeneratedArtifacts(root);
      expect(diagnostics.map(({ sourcePath, code }) => ({ sourcePath, code }))).toEqual([
        { sourcePath: "artifact.json", code: "GENERATED_ARTIFACT_INVALID" }
      ]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("rejects evidence paths that escape the repository", () => {
    const absolutePath = resolve(repositoryRoot, "README.md");
    const evidence = {
      levels: ["design-only"],
      records: { "0001": { level: "design-only", evidence: ["../outside", absolutePath, "C:/outside/file"] } }
    };
    const diagnostics = validateEvidenceRegistry(evidence, new Set(["0001"]), (path) => repositoryFileExists(repositoryRoot, path));
    expect(diagnostics).toHaveLength(3);
    expect(repositoryFileExists(repositoryRoot, "")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "../outside")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "/outside")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "C:/outside/file")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "C:outside/file")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "C:")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "README.md")).toBe(true);
  });

  it("requires repository paths to name regular non-symlink files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "k-nex-files-"));
    const outside = await mkdtemp(resolve(tmpdir(), "k-nex-outside-"));
    try {
      await mkdir(resolve(root, "directory"));
      await writeFile(resolve(outside, "target.json"), "{}\n", "utf8");
      await symlink(resolve(outside, "target.json"), resolve(root, "link.json"));
      expect(repositoryFileExists(root, "directory")).toBe(false);
      expect(repositoryFileExists(root, "link.json")).toBe(false);

      await mkdir(resolve(root, "contracts"));
      await writeFile(resolve(root, "contracts/generated-contracts.v1.json"), canonicalJson({ artifacts: ["directory", "link.json"], generator: "test", version: 1 }), "utf8");
      const diagnostics = await validateGeneratedArtifacts(root);
      expect(diagnostics.filter(({ message }) => message.includes("missing"))).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true });
      await rm(outside, { recursive: true });
    }
  });

  it("rejects non-array ADR evidence fields", () => {
    const diagnostics = validateEvidenceRegistry(
      { levels: ["design-only"], records: { "0001": { level: "design-only", evidence: "README.md" } } },
      new Set(["0001"]),
      () => true
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(["ADR_EVIDENCE_INVALID"]);
  });
});
