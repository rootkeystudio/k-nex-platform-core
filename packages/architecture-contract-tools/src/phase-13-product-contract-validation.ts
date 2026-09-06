import { createHash } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";

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
const acceptedContractDigest = "sha256:8e5a3f9783dbfaab65d53221ec5f0196a79756bccc61f33b1727cdd8bebf83b9";

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
    if (actualDigest !== acceptedContractDigest) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_DRIFT", "$", `Contract digest ${actualDigest} differs from accepted P13.1 digest.`, "Review the semantic change and update the accepted digest only with an accepted product-contract decision."));
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
  if (predecessorIds.length !== 76 || duplicateIds(predecessorIds).length > 0 || predecessorIds.some((id) => !salesId.test(id)) || decisionGroups.length !== 4 || decisionGroups.some((group) => !validDecisionGroup(group)) || duplicateIds(assignedPredecessorIds).length > 0 || !sameSet(assignedPredecessorIds, predecessorIds) || strings(predecessor?.persistedReferences).length !== 4) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/predecessorInventory", "Predecessor inventory must map each of 76 current Sales identities exactly once to an explicit version bump, static replacement, or fail-closed retirement and name persisted-reference migration.", "Restore the complete category-aware predecessor identity decision map."));
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
  if (JSON.stringify(migration?.legacyTaskStatusMap) !== JSON.stringify({ open: "open", done: "completed" }) || migration?.stableIdsRequired !== true || migration?.stableTimestampsRequired !== true || migration?.dualWriteAllowed !== false || migration?.silentDefaultsAllowed !== false || [migration?.legacyOpportunitySafety, migration?.legacyTaskSafety, migration?.persistedReferenceSafety].some((value) => typeof value !== "string" || value === "")) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/migration", "Predecessor maps, stable identity/timestamp rules, or migration safety decisions are invalid.", "Restore lossless migration maps and safety flags."));
  const dataSemantics = record(contract.dataSemantics);
  const polymorphicRelatedTargets = record(dataSemantics?.polymorphicRelatedTargets);
  const objectSpecificRelatedIntent = record(polymorphicRelatedTargets?.objectSpecificIntent);
  const retention = record(contract.retention);
  const nonGoals = strings(contract.nonGoals);
  if ([dataSemantics?.money, dataSemantics?.calendarDate, dataSemantics?.instant, dataSemantics?.reportingTimezone].some((value) => typeof value !== "string" || value === "") || !sameSet(strings(polymorphicRelatedTargets?.vocabulary), requiredRelatedRecordTargets) || polymorphicRelatedTargets?.sharedIntent !== "Activities, Notes, Attachment references, and optional Task links may name only this closed target vocabulary and must resolve in their own application and environment." || JSON.stringify(objectSpecificRelatedIntent) !== JSON.stringify({ "sales.object.activity": "required interaction target", "sales.object.note": "required timeline target", "sales.object.attachment-reference": "required storage-reference target", "sales.object.task": "optional follow-up target" }) || retention?.defaultDeletion !== "soft-archive" || retention?.importExportArtifactsDays !== 30 || [retention?.domainRows, retention?.mergeLineage, retention?.audit, retention?.attachmentBytes].some((value) => typeof value !== "string" || value === "") || nonGoals.length < 10 || !nonGoals.includes("second-vertical") || !nonGoals.includes("public-cms") || duplicateIds(nonGoals).length > 0) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/dataSemantics", "Data semantics, polymorphic target vocabulary, retention, and non-goals must be closed, concrete, and preserve CRM-only scope.", "Restore complete product boundary semantics."));
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
  if (!attacks.some(({ deliveryTasks }) => strings(deliveryTasks).includes("P13.2")) || !attacks.some(({ deliveryTasks }) => strings(deliveryTasks).includes("P13.5"))) diagnostics.push(diagnostic("PHASE13_PRODUCT_CONTRACT_INVALID", "$/attacks", "Core/migration and export attacks must be owned by P13.2 and P13.5 before closeout.", "Restore task-local attack delivery ownership."));
  return diagnostics;
}
