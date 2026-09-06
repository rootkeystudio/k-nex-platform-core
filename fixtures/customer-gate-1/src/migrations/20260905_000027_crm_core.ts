import { createHash } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

const bumpedFromOne = new Set([
  "sales.opportunity.stage.update", "sales.task.create", "sales.task.update", "sales.opportunity-kanban",
  "sales.settings-summary", "sales.task-quick-create", "sales.form.task-quick-create",
  "sales.list.opportunities", "sales.status.pipeline-stage", "sales.table.tasks", "sales.event.opportunity-changed", "sales.event.task-changed",
  "sales.health.runtime", "sales.job.pipeline-audit", "sales.lifecycle.reference", "sales.localization.en",
  "sales.page.overview", "sales.page.settings", "sales.page.tasks", "sales.realtime.opportunities", "sales.realtime.tasks",
  "sales.template.administrator", "sales.template.manager", "sales.template.representative", "sales.template.viewer", "sales.service.domain",
  "sales.opportunities", "sales.tasks", "sales.testing.conformance", "sales.tools.create-task", "sales.tools.search-tasks",
  "sales.contact.update", "sales.lead.update", "sales.opportunity.create", "sales.opportunity.update", "sales.note.create"
]);
const bumpedFromTwo = new Set(["sales.task-table", "sales.migration.initial"]);
const bumpedToThree = new Set(["sales.page.opportunities", "sales.detail.opportunity", "sales.opportunity-list", "sales.opportunity-detail"]);
const staticExecutableReferences = new Set([
  "sales.navigation.opportunities", "sales.navigation.overview", "sales.navigation.settings", "sales.navigation.tasks",
  "sales.route.opportunities", "sales.route.overview", "sales.route.settings", "sales.route.tasks", "sales.opportunities.collection",
  "sales.tasks.collection", "sales.settings.workspace"
]);
const predecessorPermissionIds = new Set([
  "sales.navigation.read", "sales.opportunities.name.read", "sales.opportunities.stage.read", "sales.opportunities.value.read",
  "sales.tasks.private-note.read", "sales.tasks.revenue.read", "sales.tasks.status.read", "sales.tasks.title.read"
]);
const retiredReferences = new Set([
  "sales.total-potential-revenue", "sales.revenue-metric", "sales.metric.total-potential-revenue", "sales.navigation.read",
  "sales.opportunities.name.read", "sales.opportunities.stage.read", "sales.opportunities.value.read", "sales.tasks.private-note.read",
  "sales.tasks.revenue.read", "sales.tasks.status.read", "sales.tasks.title.read", "sales.policy.opportunities.name.read",
  "sales.policy.opportunities.read", "sales.policy.opportunities.stage.read", "sales.policy.opportunities.value.read",
  "sales.policy.opportunities.write", "sales.policy.tasks.private-note.read", "sales.policy.tasks.read", "sales.policy.tasks.revenue.read",
  "sales.policy.tasks.status.read", "sales.policy.tasks.title.read", "sales.policy.tasks.write"
]);
const targetPermissionIds = new Set([
  "sales.accounts.archive", "sales.accounts.read", "sales.accounts.write", "sales.activities.read", "sales.activities.write",
  "sales.attachments.read", "sales.attachments.write", "sales.communications.calendar.sync", "sales.communications.email.send",
  "sales.communications.metadata.read", "sales.contacts.archive", "sales.contacts.channels.read", "sales.contacts.read", "sales.contacts.write",
  "sales.exports.execute", "sales.exports.read", "sales.imports.execute", "sales.imports.read", "sales.leads.archive", "sales.leads.channels.read",
  "sales.leads.disqualify", "sales.leads.qualify", "sales.leads.read", "sales.leads.write", "sales.notes.body.read", "sales.notes.read",
  "sales.notes.write", "sales.notifications.read", "sales.notifications.write", "sales.opportunities.amount.read", "sales.opportunities.archive",
  "sales.opportunities.close", "sales.opportunities.read", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.ownership.write",
  "sales.pipelines.configure", "sales.pipelines.read", "sales.records.merge", "sales.reminders.read", "sales.reminders.write", "sales.reports.read",
  "sales.reports.schedule", "sales.saved-views.read", "sales.saved-views.write", "sales.settings.read", "sales.settings.write", "sales.tasks.archive",
  "sales.tasks.read", "sales.tasks.write"
]);
const targetPermissionOnlyIds = new Set([
  "sales.accounts.read", "sales.activities.read", "sales.attachments.read", "sales.communications.metadata.read", "sales.contacts.channels.read",
  "sales.contacts.read", "sales.exports.read", "sales.imports.read", "sales.leads.channels.read", "sales.leads.read", "sales.notes.body.read",
  "sales.notes.read", "sales.notifications.read", "sales.opportunities.amount.read", "sales.opportunities.read", "sales.pipelines.read",
  "sales.reminders.read", "sales.reports.read", "sales.saved-views.read", "sales.settings.read", "sales.tasks.read"
]);
const targetMutationPermissionIds = new Set([
  "sales.accounts.archive", "sales.accounts.write", "sales.activities.write", "sales.attachments.write", "sales.communications.calendar.sync",
  "sales.communications.email.send", "sales.contacts.archive", "sales.contacts.write", "sales.exports.execute", "sales.imports.execute",
  "sales.leads.archive", "sales.leads.disqualify", "sales.leads.qualify", "sales.leads.write", "sales.notes.write", "sales.notifications.write",
  "sales.opportunities.archive", "sales.opportunities.close", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.ownership.write",
  "sales.pipelines.configure", "sales.records.merge", "sales.reminders.write", "sales.reports.schedule", "sales.saved-views.write",
  "sales.settings.write", "sales.tasks.archive", "sales.tasks.write"
]);
const persistedPermissionIds = new Set([...predecessorPermissionIds, ...targetPermissionIds]);
if (targetPermissionOnlyIds.size + targetMutationPermissionIds.size !== targetPermissionIds.size ||
  [...targetPermissionOnlyIds, ...targetMutationPermissionIds].some((permissionId) => !targetPermissionIds.has(permissionId))) {
  throw new Error("P13.2 target Sales permission classification is not closed");
}
const templateBaselines = new Map<string, readonly string[]>([
  ["sales.template.viewer", ["sales.accounts.read", "sales.activities.read", "sales.attachments.read", "sales.contacts.read", "sales.leads.read", "sales.notes.read", "sales.notifications.read", "sales.opportunities.read", "sales.pipelines.read", "sales.reminders.read", "sales.reports.read", "sales.saved-views.read", "sales.tasks.read"]],
  ["sales.template.representative", ["sales.accounts.read", "sales.accounts.write", "sales.activities.read", "sales.activities.write", "sales.attachments.read", "sales.attachments.write", "sales.contacts.channels.read", "sales.contacts.read", "sales.contacts.write", "sales.leads.channels.read", "sales.leads.disqualify", "sales.leads.qualify", "sales.leads.read", "sales.leads.write", "sales.notes.body.read", "sales.notes.read", "sales.notes.write", "sales.notifications.read", "sales.notifications.write", "sales.opportunities.read", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.pipelines.read", "sales.reminders.read", "sales.reminders.write", "sales.reports.read", "sales.saved-views.read", "sales.saved-views.write", "sales.tasks.read", "sales.tasks.write"]],
  ["sales.template.manager", ["sales.accounts.archive", "sales.accounts.read", "sales.accounts.write", "sales.activities.read", "sales.activities.write", "sales.attachments.read", "sales.attachments.write", "sales.contacts.archive", "sales.contacts.channels.read", "sales.contacts.read", "sales.contacts.write", "sales.exports.execute", "sales.exports.read", "sales.imports.execute", "sales.imports.read", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.disqualify", "sales.leads.qualify", "sales.leads.read", "sales.leads.write", "sales.notes.body.read", "sales.notes.read", "sales.notes.write", "sales.notifications.read", "sales.notifications.write", "sales.opportunities.amount.read", "sales.opportunities.archive", "sales.opportunities.close", "sales.opportunities.read", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.ownership.write", "sales.pipelines.read", "sales.records.merge", "sales.reminders.read", "sales.reminders.write", "sales.reports.read", "sales.reports.schedule", "sales.saved-views.read", "sales.saved-views.write", "sales.tasks.archive", "sales.tasks.read", "sales.tasks.write"]],
  ["sales.template.administrator", ["sales.accounts.archive", "sales.accounts.read", "sales.accounts.write", "sales.activities.read", "sales.activities.write", "sales.attachments.read", "sales.attachments.write", "sales.communications.calendar.sync", "sales.communications.email.send", "sales.communications.metadata.read", "sales.contacts.archive", "sales.contacts.channels.read", "sales.contacts.read", "sales.contacts.write", "sales.exports.execute", "sales.exports.read", "sales.imports.execute", "sales.imports.read", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.disqualify", "sales.leads.qualify", "sales.leads.read", "sales.leads.write", "sales.notes.body.read", "sales.notes.read", "sales.notes.write", "sales.notifications.read", "sales.notifications.write", "sales.opportunities.amount.read", "sales.opportunities.archive", "sales.opportunities.close", "sales.opportunities.read", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.ownership.write", "sales.pipelines.configure", "sales.pipelines.read", "sales.records.merge", "sales.reminders.read", "sales.reminders.write", "sales.reports.read", "sales.reports.schedule", "sales.saved-views.read", "sales.saved-views.write", "sales.settings.read", "sales.settings.write", "sales.tasks.archive", "sales.tasks.read", "sales.tasks.write"]]
]);
const explicitReferenceKeys = new Set(["actionId", "blockId", "componentId", "eventId", "permissionId", "routeId", "sourceId", "templateId", "topicId", "viewId"]);
const sourceHashes = new Map([
  ["sales.tasks", ["sha256:520d5f0bd7874a0b9c63fd3974ce355180314fcbd961ca9407a781d9fc768f26", "sha256:a0211668702800a1abd7ad5408847da099a84acc20d0cce098b672d4eea062c3"]],
  ["sales.opportunities", ["sha256:09311605c4c5afaab4ff5f902f88f5c206fc1c7dd5e925f713d72d6a2ddba066", "sha256:49a707b6f512bc0d8cad02c38a506066e6973e09468e1e3c8373c8e1287ade5d"]]
]);

type JsonObject = Record<string, unknown>;
type JsonPlan = { readonly value: unknown; readonly changed: boolean; readonly referenceCount: number };
type TableFlags = Record<string, string | null>;

function fail(message: string): never { throw new Error(`maintenance-required: ${message}`); }
function sha256(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (typeof result === "object" && result !== null && Array.isArray((result as { rows?: unknown }).rows)) return (result as { rows: T[] }).rows;
  return [];
}
function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }

function rebindJson(value: unknown, path = "$."): JsonPlan {
  if (Array.isArray(value)) {
    let changed = false;
    let referenceCount = 0;
    const migrated = value.map((entry, index) => {
      const plan = rebindJson(entry, `${path}[${index}]`);
      changed ||= plan.changed;
      referenceCount += plan.referenceCount;
      return plan.value;
    });
    return { value: migrated, changed, referenceCount };
  }
  if (!isObject(value)) return { value, changed: false, referenceCount: 0 };

  const migrated: JsonObject = {};
  let changed = false;
  let referenceCount = 0;
  for (const [key, entry] of Object.entries(value)) {
    const plan = rebindJson(entry, `${path}${key}.`);
    migrated[key] = plan.value;
    changed ||= plan.changed;
    referenceCount += plan.referenceCount;
  }

  const references = Object.entries(value).filter(([key, entry]) => typeof entry === "string" && entry.startsWith("sales.") &&
    (explicitReferenceKeys.has(key) || key === "type" || key === "id" && Number.isSafeInteger(value.version)));
  for (const [key, rawIdentity] of references) {
    const identity = rawIdentity as string;
    referenceCount += 1;
    if (retiredReferences.has(identity)) fail(`retired Sales reference ${identity} remains executable at ${path}${key}`);
    const targetVersion = bumpedToThree.has(identity) ? 3 : bumpedFromOne.has(identity) ? 2 : bumpedFromTwo.has(identity) ? 3 : undefined;
    if (targetVersion !== undefined) {
      const versionKeys = key === "templateId" ? ["adoptedTemplateVersion", "templateVersion", "version"]
        : key.endsWith("Id") ? [`${key.slice(0, -2)}Version`, "version"] : ["version"];
      const versionKey = versionKeys.find((candidate) => Number.isSafeInteger(value[candidate]));
      const acceptedVersions = bumpedToThree.has(identity) ? [1, 2] : [targetVersion - 1];
      if (versionKey === undefined || !acceptedVersions.includes(value[versionKey] as number)) fail(`Sales reference ${identity} has unresolved version at ${path}${key}`);
      migrated[versionKey] = targetVersion;
      changed = true;
      const hashes = sourceHashes.get(identity);
      if (hashes && value.structuralCompatibilityHash !== undefined) {
        if (value.structuralCompatibilityHash !== hashes[0]) fail(`Sales source ${identity} has unknown compatibility hash at ${path}${key}`);
        migrated.structuralCompatibilityHash = hashes[1];
      }
      if (identity === "sales.opportunities" && Array.isArray(value.selectedFields)) {
        const fields = value.selectedFields.map((field) => field === "stage" ? "stage-id" : field === "value" ? "amount" : field);
        if (fields.some((field) => !["name", "stage-id", "revision", "amount"].includes(String(field)))) fail(`Sales opportunity binding has unresolved selected fields at ${path}${key}`);
        migrated.selectedFields = [...new Set([...fields, "revision"])];
      }
      if (identity === "sales.tasks" && Array.isArray(value.selectedFields) && value.selectedFields.some((field) => !["title", "status"].includes(String(field)))) {
        fail(`Sales task binding contains retired selected fields at ${path}${key}`);
      }
    } else if (!staticExecutableReferences.has(identity) && !targetPermissionIds.has(identity)) {
      fail(`unknown Sales reference ${identity} at ${path}${key}`);
    }
  }

  if (isObject(migrated.source) && typeof migrated.source.id === "string" && sourceHashes.has(migrated.source.id)) {
    const identity = migrated.source.id;
    const hashes = sourceHashes.get(identity)!;
    if (value.structuralCompatibilityHash !== hashes[0]) fail(`Sales source ${identity} has unknown compatibility hash at ${path}source`);
    migrated.structuralCompatibilityHash = hashes[1];
    if (identity === "sales.opportunities" && Array.isArray(value.selectedFields)) {
      const fields = value.selectedFields.map((field) => field === "stage" ? "stage-id" : field === "value" ? "amount" : field);
      if (fields.some((field) => !["name", "stage-id", "revision", "amount"].includes(String(field)))) fail(`Sales opportunity binding has unresolved selected fields at ${path}source`);
      migrated.selectedFields = [...new Set([...fields, "revision"])];
    }
    if (identity === "sales.tasks" && Array.isArray(value.selectedFields) && value.selectedFields.some((field) => !["title", "status"].includes(String(field)))) {
      fail(`Sales task binding contains retired selected fields at ${path}source`);
    }
    changed = true;
  }

  if (changed && Array.isArray(migrated.entries) && typeof migrated.digest === "string") migrated.digest = sha256(migrated.entries);
  if (isObject(migrated.dependencies) && typeof migrated.dependencies.digest === "string" && isObject(migrated.page) && migrated.page.dependencyDigest !== undefined) {
    migrated.page = { ...migrated.page, dependencyDigest: migrated.dependencies.digest };
  }
  return { value: migrated, changed, referenceCount };
}

function migrateSettings(value: unknown): JsonObject {
  if (!isObject(value) || Object.keys(value).sort().join("\0") !== "defaultPage\0defaultTaskPageSize\0pipelineStages\0showPotentialRevenue" ||
    !Number.isInteger(value.defaultTaskPageSize) || (value.defaultTaskPageSize as number) < 1 || (value.defaultTaskPageSize as number) > 100 ||
    typeof value.showPotentialRevenue !== "boolean" || !["overview", "tasks", "opportunities"].includes(String(value.defaultPage)) || !Array.isArray(value.pipelineStages)) {
    fail("sales.settings.workspace contains unknown or invalid values");
  }
  const stages = value.pipelineStages.join("\0");
  if (stages !== "lead\0qualified\0won\0lost" && stages !== "qualification\0discovery\0proposal\0negotiation\0won\0lost") {
    fail("sales.settings.workspace has unknown or conflicting pipeline stages");
  }
  return { ...value, pipelineStages: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] };
}

type SettingsPlan = { applicationId: string; environment: string; ownerScopeKey: string; expectedDocumentRevision: number; expectedDocumentSettingsRevision: number; expectedGlobalSettingsRevision: number; targetSettingsRevision: number; value: JsonObject };
type PagePointerPlan = { expectedPageRevision: number; expectedPublishedRevisionId: string; expectedDigest: string | null };
type PagePlan = { table: "k_nex_workspace_pages" | "k_nex_workspace_working_copies" | "k_nex_workspace_published_revisions"; applicationId: string; environment: string; pageId: string; expectedRevision: number; revisionId?: string; value: unknown; digest?: string; pointer?: PagePointerPlan };
type GrantRow = { application_id: string; grant_id: string; role_id: string; permission_id: string; owner_kind: string; owner_namespace: string | null; owner_delivery_class: string | null; owner_extension_id: string | null; owner_generation: string | number | null; generation_state: string | null; revision: number };
type GrantPlan = { row: GrantRow; permissionIds: readonly string[] };
type AdoptionPlan = { applicationId: string; adoptionId: string; revision: number; baseline: readonly string[] };
type AuthorityScopePlan = { applicationId: string; environment: string; principalId: string; recordScope: "application-sales-scope" | "explicit-application-or-team-scope"; mutationAllowed: boolean };
type AuthorizationTransitionPlan = { applicationId: string; environment: string; authorizationRevision: number; lifecycleRevision: number };
type ReferencePlan = { applications: Set<string>; environments: Set<string>; referenceCount: number; settings: SettingsPlan[]; pages: PagePlan[]; grants: GrantPlan[]; adoptions: AdoptionPlan[]; scopes: AuthorityScopePlan[]; authorizationTransitions: AuthorizationTransitionPlan[]; hasAuthorizationTables: boolean };

function mapPredecessorPermissions(permissionIds: readonly string[]): readonly string[] {
  const source = new Set(permissionIds);
  for (const permissionId of source) {
    if (!persistedPermissionIds.has(permissionId)) fail(`unknown persisted Sales permission ${permissionId}`);
  }
  if (source.has("sales.opportunities.read") && (!source.has("sales.opportunities.name.read") || !source.has("sales.opportunities.stage.read"))) {
    fail("Sales opportunity field-authority removal cannot be represented by the target permission model");
  }
  if (source.has("sales.tasks.read") && (!source.has("sales.tasks.title.read") || !source.has("sales.tasks.status.read"))) {
    fail("Sales task field-authority removal cannot be represented by the target permission model");
  }
  const mapped = new Set<string>();
  for (const permissionId of source) {
    if (permissionId === "sales.opportunities.value.read") mapped.add("sales.opportunities.amount.read");
    else if (permissionId === "sales.opportunities.write") {
      mapped.add("sales.opportunities.write");
      mapped.add("sales.opportunities.stage.update");
    } else if (permissionId === "sales.navigation.read") {
      if (source.has("sales.tasks.read")) mapped.add("sales.reports.read");
    }
    else if (permissionId === "sales.tasks.private-note.read") {
      if (source.has("sales.tasks.read")) {
        mapped.add("sales.notes.read");
        mapped.add("sales.notes.body.read");
      }
    } else if (targetPermissionIds.has(permissionId)) mapped.add(permissionId);
  }
  return [...mapped].sort();
}

async function planPersistedReferences(db: MigrateUpArgs["db"], receiptScope?: { applicationId: string; environment: string }): Promise<ReferencePlan> {
  const flags = resultRows<TableFlags>(await db.execute(sql`SELECT
    to_regclass('public.k_nex_role_permission_grants')::text AS grants,
    to_regclass('public.k_nex_role_template_adoptions')::text AS adoptions,
    to_regclass('public.k_nex_role_assignments')::text AS assignments,
    to_regclass('public.k_nex_extension_authorization_generations')::text AS authorization_generations,
    to_regclass('public.k_nex_authorization_state')::text AS authorization_state,
    to_regclass('public.k_nex_authorization_audit')::text AS authorization_audit,
    to_regclass('public.k_nex_authorization_outbox')::text AS authorization_outbox,
    to_regclass('public.k_nex_permission_catalog_snapshots')::text AS catalog,
    to_regclass('public.k_nex_system_settings_documents')::text AS settings,
    to_regclass('public.k_nex_workspace_pages')::text AS pages,
    to_regclass('public.k_nex_workspace_working_copies')::text AS working,
    to_regclass('public.k_nex_workspace_published_revisions')::text AS published,
    to_regclass('public.payload_mcp_api_keys')::text AS mcp_keys,
    to_regclass('public.sales_saved_views')::text AS saved_views`))[0] ?? {};
  const applications = new Set<string>();
  const environments = new Set<string>();
  let referenceCount = 0;
  const settings: SettingsPlan[] = [];
  const pages: PagePlan[] = [];
  const grantPlans: GrantPlan[] = [];
  const adoptionPlans: AdoptionPlan[] = [];
  const scopes: AuthorityScopePlan[] = [];
  const authorizationTransitions: AuthorizationTransitionPlan[] = [];
  if (Boolean(flags.grants) !== Boolean(flags.adoptions)) fail("predecessor authorization reference storage is incomplete");
  if (flags.grants && (!flags.assignments || !flags.authorization_generations || !flags.authorization_state || !flags.authorization_audit || !flags.authorization_outbox)) fail("predecessor authorization mutation storage is incomplete");
  if ([flags.pages, flags.working, flags.published].some(Boolean) && ![flags.pages, flags.working, flags.published].every(Boolean)) fail("predecessor workspace-page reference storage is incomplete");
  if (flags.mcp_keys) {
    const columns = resultRows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(await db.execute(sql`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='payload_mcp_api_keys' AND column_name LIKE 'payload_mcp_tool_k_nex_sales_tools_%' ORDER BY column_name`));
    const expected = ["payload_mcp_tool_k_nex_sales_tools_create_task_v1", "payload_mcp_tool_k_nex_sales_tools_search_tasks_v1"];
    if (columns.length !== expected.length || columns.some((column, index) => column.column_name !== expected[index] || column.data_type !== "boolean" || column.is_nullable !== "YES" || column.column_default !== "true")) {
      fail("Payload MCP Sales tool columns are missing, partial, mixed, versioned, or have an incompatible predecessor contract");
    }
  }

  if (flags.grants) {
    const grants = resultRows<GrantRow>(await db.execute(sql`SELECT role_grant.application_id,role_grant.grant_id,role_grant.role_id,role_grant.permission_id,role_grant.owner_kind,role_grant.owner_namespace,role_grant.owner_delivery_class,role_grant.owner_extension_id,role_grant.owner_generation,generation.state AS generation_state,role_grant.revision
      FROM k_nex_role_permission_grants role_grant
      LEFT JOIN k_nex_extension_authorization_generations generation ON generation.application_id=role_grant.application_id AND generation.delivery_class=role_grant.owner_delivery_class AND generation.extension_id=role_grant.owner_extension_id AND generation.authorization_generation=role_grant.owner_generation
      WHERE role_grant.permission_id LIKE 'sales.%' ORDER BY role_grant.application_id,role_grant.role_id,role_grant.permission_id`));
    const activeAssignments = resultRows<{ application_id: string; principal_id: string; role_id: string; permission_id: string }>(await db.execute(sql`SELECT assignment.application_id, assignment.subject_id AS principal_id, assignment.role_id, permission_grant.permission_id
      FROM k_nex_role_assignments assignment
      JOIN k_nex_role_permission_grants permission_grant ON permission_grant.application_id=assignment.application_id AND permission_grant.role_id=assignment.role_id
      JOIN k_nex_extension_authorization_generations generation ON generation.application_id=permission_grant.application_id
        AND generation.delivery_class=permission_grant.owner_delivery_class AND generation.extension_id=permission_grant.owner_extension_id
        AND generation.authorization_generation=permission_grant.owner_generation
      WHERE assignment.subject_kind='user' AND assignment.state='active' AND permission_grant.permission_id LIKE 'sales.%' AND permission_grant.owner_kind='extension' AND permission_grant.owner_delivery_class='platform-plugin' AND permission_grant.owner_extension_id='module.sales' AND generation.state='current'
      ORDER BY assignment.application_id, assignment.subject_id, assignment.role_id, permission_grant.permission_id`));
    const rawPermissionsByPrincipal = new Map<string, Set<string>>();
    for (const assignment of activeAssignments) {
      const key = `${assignment.application_id}\0${assignment.principal_id}`;
      (rawPermissionsByPrincipal.get(key) ?? rawPermissionsByPrincipal.set(key, new Set<string>()).get(key)!).add(assignment.permission_id);
    }
    for (const [key, permissions] of rawPermissionsByPrincipal) {
      const [applicationId, principalId] = key.split("\0");
      if (applicationId === undefined || principalId === undefined) fail("active Sales authority principal key is malformed");
      for (const permissionId of ["sales.tasks.read", "sales.opportunities.read", "sales.settings.read"] as const) {
        if (permissions.has(permissionId) && !permissions.has("sales.navigation.read")) fail(`active Sales principal ${principalId} has non-representable ${permissionId} route authority`);
      }
      if (permissions.has("sales.navigation.read") && permissions.has("sales.tasks.read") && !activeAssignments.some((assignment) => assignment.application_id === applicationId && assignment.principal_id === principalId && assignment.permission_id === "sales.navigation.read" && activeAssignments.some((candidate) => candidate.application_id === applicationId && candidate.principal_id === principalId && candidate.role_id === assignment.role_id && candidate.permission_id === "sales.tasks.read"))) fail(`active Sales principal ${principalId} requires a nonrepresentable cross-role overview split`);
      if (permissions.has("sales.tasks.read") && permissions.has("sales.tasks.private-note.read") && !activeAssignments.some((assignment) => assignment.application_id === applicationId && assignment.principal_id === principalId && assignment.permission_id === "sales.tasks.read" && activeAssignments.some((candidate) => candidate.application_id === applicationId && candidate.principal_id === principalId && candidate.role_id === assignment.role_id && candidate.permission_id === "sales.tasks.private-note.read"))) fail(`active Sales principal ${principalId} requires a nonrepresentable cross-role private-note split`);
    }
    const permissionKeys = new Set(grants.map((grant) => `${grant.application_id}\0${grant.role_id}\0${grant.permission_id}`));
    const grantIds = new Set(resultRows<{ application_id: string; grant_id: string }>(await db.execute(sql`SELECT application_id,grant_id FROM k_nex_role_permission_grants`)).map((grant) => `${grant.application_id}\0${grant.grant_id}`));
    for (const grant of grants) {
      if (grant.owner_kind !== "extension" || grant.owner_delivery_class !== "platform-plugin" || grant.owner_extension_id !== "module.sales" || !Number.isSafeInteger(Number(grant.owner_generation)) || Number(grant.owner_generation) < 1 || !["current", "retired"].includes(grant.generation_state ?? "")) fail(`Sales grant provenance is invalid for ${grant.grant_id}`);
      if (!persistedPermissionIds.has(grant.permission_id)) fail(`unknown persisted Sales permission ${grant.permission_id}`);
      const rolePermissions = grants.filter((candidate) => candidate.application_id === grant.application_id && candidate.role_id === grant.role_id).map(({ permission_id }) => permission_id);
      const mapped = mapPredecessorPermissions(rolePermissions);
      const replacements = grant.permission_id === "sales.opportunities.value.read" ? ["sales.opportunities.amount.read"]
        : grant.permission_id === "sales.opportunities.write" ? ["sales.opportunities.write", "sales.opportunities.stage.update"]
        : grant.permission_id === "sales.navigation.read" && rolePermissions.includes("sales.tasks.read") ? ["sales.reports.read"]
          : grant.permission_id === "sales.navigation.read" ? []
        : grant.permission_id === "sales.tasks.private-note.read" && rolePermissions.includes("sales.tasks.read") ? ["sales.notes.body.read", "sales.notes.read"]
          : predecessorPermissionIds.has(grant.permission_id) ? [] : [grant.permission_id];
      for (const replacement of replacements) {
        if (replacement !== grant.permission_id && permissionKeys.has(`${grant.application_id}\0${grant.role_id}\0${replacement}`)) fail(`Sales permission mapping collision for ${grant.role_id}:${replacement}`);
      }
      if (replacements.length > 1) {
        const cloneId = `p13-note-read-${createHash("sha256").update(`${grant.application_id}\0${grant.grant_id}`).digest("hex").slice(0, 32)}`;
        if (grantIds.has(`${grant.application_id}\0${cloneId}`)) fail(`Sales permission mapping grant-id collision for ${grant.grant_id}`);
      }
      if (grant.revision >= 1_000_000_000) fail(`Sales permission grant revision cannot be migrated for ${grant.grant_id}`);
      if (replacements[0] !== grant.permission_id || replacements.length !== 1) grantPlans.push({ row: grant, permissionIds: replacements });
      if (mapped.some((permissionId) => !targetPermissionIds.has(permissionId))) fail(`Sales permission mapping is unresolved for ${grant.role_id}`);
      applications.add(grant.application_id);
      referenceCount += 1;
    }
  }
  if (flags.adoptions) {
    const adoptions = resultRows<{ application_id: string; adoption_id: string; template_id: string; template_version: string | number; old_baseline_permission_ids: unknown; old_baseline_digest: string; state: string; revision: number }>(await db.execute(sql`SELECT application_id, adoption_id, template_id, template_version, old_baseline_permission_ids, old_baseline_digest, state, revision FROM k_nex_role_template_adoptions WHERE template_id LIKE 'sales.%'`));
    for (const adoption of adoptions) {
      const knownTemplate = templateBaselines.has(adoption.template_id);
      if (!knownTemplate || adoption.state === "adopted" && Number(adoption.template_version) !== 1) fail(`unresolved Sales role-template adoption ${adoption.adoption_id}`);
      if (!Array.isArray(adoption.old_baseline_permission_ids) || adoption.old_baseline_permission_ids.some((id) => typeof id !== "string") ||
        adoption.old_baseline_digest !== sha256([...new Set(adoption.old_baseline_permission_ids as string[])].sort())) fail(`invalid Sales role-template baseline digest ${adoption.adoption_id}`);
      if ((adoption.old_baseline_permission_ids as string[]).some((id) => !persistedPermissionIds.has(id))) fail(`unknown Sales permission in role-template baseline ${adoption.adoption_id}`);
      const canonicalBaseline = [...new Set(adoption.old_baseline_permission_ids as string[])].sort();
      if (canonicalJson(adoption.old_baseline_permission_ids) !== canonicalJson(canonicalBaseline)) fail(`non-canonical Sales role-template baseline ${adoption.adoption_id}`);
      if (!Number.isInteger(adoption.revision) || adoption.revision < 0 || adoption.revision >= 1_000_000_000) fail(`Sales role-template adoption revision cannot be migrated for ${adoption.adoption_id}`);
      if (adoption.state === "adopted") adoptionPlans.push({ applicationId: adoption.application_id, adoptionId: adoption.adoption_id, revision: adoption.revision, baseline: mapPredecessorPermissions(canonicalBaseline) });
      applications.add(adoption.application_id);
      referenceCount += 1;
    }
  }
  if (flags.catalog) {
    const snapshots = resultRows<{ application_id: string; permission_json: unknown }>(await db.execute(sql`SELECT application_id, permission_json FROM k_nex_permission_catalog_snapshots WHERE permission_json::text LIKE '%sales.%'`));
    for (const snapshot of snapshots) { applications.add(snapshot.application_id); referenceCount += 1; }
  }
  if (flags.settings) {
    const documents = resultRows<{ application_id: string; environment: string; descriptor_schema_version: number; owner_scope_key: string; document_revision: number; settings_revision: number; state_revision: number | null; values_json: unknown }>(await db.execute(sql`SELECT document.application_id, document.environment, document.descriptor_schema_version, document.owner_scope_key, document.document_revision, document.settings_revision, state.settings_revision AS state_revision, document.values_json FROM k_nex_system_settings_documents document LEFT JOIN k_nex_system_settings_state state USING (application_id,environment) WHERE document.descriptor_id='sales.settings.workspace' ORDER BY document.application_id,document.environment`));
    for (const document of documents) {
      if (document.descriptor_schema_version !== 1 || document.document_revision >= 1_000_000_000 || document.settings_revision >= 1_000_000_000 || document.state_revision === null || document.state_revision < document.settings_revision || document.state_revision >= 1_000_000_000) fail("sales.settings.workspace version/revision cannot be migrated");
      settings.push({ applicationId: document.application_id, environment: document.environment, ownerScopeKey: document.owner_scope_key,
        expectedDocumentRevision: document.document_revision, expectedDocumentSettingsRevision: document.settings_revision,
        expectedGlobalSettingsRevision: document.state_revision, targetSettingsRevision: document.state_revision + 1, value: migrateSettings(document.values_json) });
      applications.add(document.application_id);
      environments.add(`${document.application_id}\0${document.environment}`);
      referenceCount += 1;
    }
  }

  const pageTables = [
    [flags.pages, "k_nex_workspace_pages", "page_json"],
    [flags.working, "k_nex_workspace_working_copies", "working_copy_json"],
    [flags.published, "k_nex_workspace_published_revisions", "revision_json"]
  ] as const;
  for (const [exists, table, column] of pageTables) {
    if (!exists) continue;
    const query = table === "k_nex_workspace_pages" ? sql`SELECT application_id, environment, page_id, page_revision AS row_revision, page_json AS value FROM k_nex_workspace_pages`
      : table === "k_nex_workspace_working_copies" ? sql`SELECT application_id, environment, page_id, working_copy_revision AS row_revision, working_copy_json AS value FROM k_nex_workspace_working_copies`
        : sql`SELECT published.application_id, published.environment, published.page_id, published.revision_id,
            published.document_revision AS row_revision, published.revision_json AS value,
            page.page_revision AS live_page_revision, page.published_revision_id AS live_published_revision_id,
            page.dependency_digest AS live_dependency_digest
          FROM k_nex_workspace_published_revisions published
          LEFT JOIN k_nex_workspace_pages page USING (application_id,environment,page_id)`;
    const rows = resultRows<{ application_id: string; environment: string; page_id: string; row_revision: number; revision_id?: string; value: unknown; live_page_revision?: number | null; live_published_revision_id?: string | null; live_dependency_digest?: string | null }>(await db.execute(query));
    for (const row of rows) {
      const plan = rebindJson(row.value);
      if (plan.referenceCount === 0) continue;
      applications.add(row.application_id);
      environments.add(`${row.application_id}\0${row.environment}`);
      referenceCount += plan.referenceCount;
      if (plan.changed) {
        const digest = table === "k_nex_workspace_published_revisions" && isObject(plan.value) && isObject(plan.value.dependencies) && typeof plan.value.dependencies.digest === "string" ? plan.value.dependencies.digest : undefined;
        if (table === "k_nex_workspace_published_revisions" && digest === undefined) fail(`published Sales page ${row.page_id} has no compatible dependency digest`);
        if (!Number.isInteger(row.row_revision) || row.row_revision < 0 || row.row_revision >= 1_000_000_000) fail(`Sales page ${row.page_id} revision cannot be migrated`);
        let pointer: PagePointerPlan | undefined;
        if (table === "k_nex_workspace_published_revisions" && row.revision_id === row.live_published_revision_id) {
          if (typeof row.revision_id !== "string" || !Number.isInteger(row.live_page_revision) || row.live_page_revision! < 0 || row.live_page_revision! >= 1_000_000_000) fail(`Sales published-page pointer ${row.page_id} revision cannot be migrated`);
          pointer = { expectedPageRevision: row.live_page_revision!, expectedPublishedRevisionId: row.revision_id, expectedDigest: row.live_dependency_digest ?? null };
        }
        pages.push({ table, applicationId: row.application_id, environment: row.environment, pageId: row.page_id, expectedRevision: row.row_revision,
          ...(row.revision_id === undefined ? {} : { revisionId: row.revision_id }), value: plan.value, ...(digest ? { digest } : {}), ...(pointer === undefined ? {} : { pointer }) });
      }
    }
  }
  if (flags.saved_views) {
    const count = resultRows<{ count: number }>(await db.execute(sql`SELECT count(*)::int AS count FROM sales_saved_views`))[0]?.count ?? 0;
    if (count > 0) fail("predecessor saved views have no accepted P13.2 storage contract");
  }
  if (flags.grants) {
    const activeAssignments = resultRows<{ application_id: string; principal_id: string; role_id: string; permission_id: string }>(await db.execute(sql`SELECT assignment.application_id, assignment.subject_id AS principal_id, assignment.role_id, permission_grant.permission_id
      FROM k_nex_role_assignments assignment
      JOIN k_nex_role_permission_grants permission_grant ON permission_grant.application_id=assignment.application_id AND permission_grant.role_id=assignment.role_id
      JOIN k_nex_extension_authorization_generations generation ON generation.application_id=permission_grant.application_id
        AND generation.delivery_class=permission_grant.owner_delivery_class AND generation.extension_id=permission_grant.owner_extension_id
        AND generation.authorization_generation=permission_grant.owner_generation
      WHERE assignment.subject_kind='user' AND assignment.state='active' AND permission_grant.permission_id LIKE 'sales.%' AND permission_grant.owner_kind='extension' AND permission_grant.owner_delivery_class='platform-plugin' AND permission_grant.owner_extension_id='module.sales' AND generation.state='current'
      ORDER BY assignment.application_id, assignment.subject_id, assignment.role_id, permission_grant.permission_id`));
    const permissionsByPrincipal = new Map<string, Set<string>>();
    for (const assignment of activeAssignments) {
      const rolePermissions = activeAssignments.filter((candidate) => candidate.application_id === assignment.application_id && candidate.principal_id === assignment.principal_id && candidate.role_id === assignment.role_id)
        .map((candidate) => candidate.permission_id);
      const key = `${assignment.application_id}\0${assignment.principal_id}`;
      const permissions = permissionsByPrincipal.get(key) ?? new Set<string>();
      for (const permissionId of mapPredecessorPermissions(rolePermissions)) permissions.add(permissionId);
      permissionsByPrincipal.set(key, permissions);
    }
    for (const [key, permissionIds] of permissionsByPrincipal) {
      if (permissionIds.size === 0) continue;
      const [applicationId, principalId] = key.split("\0");
      if (applicationId === undefined || principalId === undefined) fail("active Sales authority scope key is malformed");
      let environmentsForApplication = [...environments].filter((scope) => scope.startsWith(`${applicationId}\0`));
      if (environmentsForApplication.length === 0 && receiptScope?.applicationId === applicationId) {
        environments.add(`${receiptScope.applicationId}\0${receiptScope.environment}`);
        environmentsForApplication = [`${receiptScope.applicationId}\0${receiptScope.environment}`];
      }
      if (environmentsForApplication.length !== 1) fail(`active Sales authority for ${principalId} requires one receipt-bound environment`);
      const [, environment] = environmentsForApplication[0]!.split("\0");
      if (environment === undefined) fail(`active Sales authority for ${principalId} has malformed receipt-bound environment`);
      if ([...permissionIds].some((permissionId) => !targetPermissionIds.has(permissionId))) fail(`active Sales authority for ${principalId} has unresolved permission classification`);
      const mutationAllowed = [...permissionIds].some((permissionId) => targetMutationPermissionIds.has(permissionId));
      scopes.push({ applicationId, environment, principalId,
        recordScope: mutationAllowed ? "application-sales-scope" : "explicit-application-or-team-scope", mutationAllowed });
    }
  }
  const authorityMutationApplications = new Set([...grantPlans.map((grant) => grant.row.application_id), ...adoptionPlans.map((adoption) => adoption.applicationId), ...scopes.map((scope) => scope.applicationId)]);
  for (const applicationId of authorityMutationApplications) {
    const scopedEnvironments = [...environments].filter((scope) => scope.startsWith(`${applicationId}\0`));
    if (scopedEnvironments.length !== 1) fail(`Sales authorization rewrite for ${applicationId} requires one exact environment`);
    const [, environment] = scopedEnvironments[0]!.split("\0");
    const state = resultRows<{ authorization_revision: number; lifecycle_revision: number }>(await db.execute(sql`SELECT authorization_revision,lifecycle_revision FROM k_nex_authorization_state WHERE application_id=${applicationId}`))[0];
    if (environment === undefined || state === undefined || !Number.isInteger(state.authorization_revision) || !Number.isInteger(state.lifecycle_revision) || state.authorization_revision < 0 || state.lifecycle_revision < 0 || state.authorization_revision >= 1_000_000_000 || state.lifecycle_revision > 1_000_000_000) fail(`Sales authorization state for ${applicationId} is unavailable or invalid`);
    const occupied = resultRows<{ occupied: boolean }>(await db.execute(sql`SELECT EXISTS(SELECT 1 FROM k_nex_authorization_outbox WHERE application_id=${applicationId} AND environment=${environment} AND authorization_revision=${state.authorization_revision + 1} AND lifecycle_revision=${state.lifecycle_revision}) AS occupied`))[0];
    if (occupied?.occupied) fail(`Sales authorization revision event is already occupied for ${applicationId}`);
    authorizationTransitions.push({ applicationId, environment, authorizationRevision: state.authorization_revision, lifecycleRevision: state.lifecycle_revision });
  }
  return { applications, environments, referenceCount, settings, pages, grants: grantPlans, adoptions: adoptionPlans, scopes, authorizationTransitions, hasAuthorizationTables: Boolean(flags.grants && flags.adoptions) };
}

async function applyPersistedReferences(db: MigrateUpArgs["db"], plan: ReferencePlan): Promise<void> {
  if (plan.referenceCount === 0) return;
  if (plan.hasAuthorizationTables) {
    for (const grant of plan.grants) {
      if (grant.permissionIds.length === 0) {
        const removed = await db.execute(sql`DELETE FROM k_nex_role_permission_grants WHERE application_id=${grant.row.application_id} AND grant_id=${grant.row.grant_id} AND revision=${grant.row.revision} RETURNING grant_id`);
        if (resultRows(removed).length !== 1) fail(`Sales permission grant changed before rewrite for ${grant.row.grant_id}`);
      } else {
        const updated = await db.execute(sql`UPDATE k_nex_role_permission_grants SET permission_id=${grant.permissionIds[0]!}, revision=revision+1, updated_at=now()
          WHERE application_id=${grant.row.application_id} AND grant_id=${grant.row.grant_id} AND revision=${grant.row.revision} RETURNING grant_id`);
        if (resultRows(updated).length !== 1) fail(`Sales permission grant changed before rewrite for ${grant.row.grant_id}`);
        if (grant.permissionIds.length === 2) {
          const cloneId = `p13-note-read-${createHash("sha256").update(`${grant.row.application_id}\0${grant.row.grant_id}`).digest("hex").slice(0, 32)}`;
          await db.execute(sql`INSERT INTO k_nex_role_permission_grants
            (application_id,grant_id,role_id,permission_id,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,revision)
            VALUES (${grant.row.application_id},${cloneId},${grant.row.role_id},${grant.permissionIds[1]!},${grant.row.owner_kind},${grant.row.owner_namespace},
              ${grant.row.owner_delivery_class},${grant.row.owner_extension_id},${grant.row.owner_generation},${grant.row.revision + 1})`);
        }
      }
    }
    for (const adoption of plan.adoptions) {
      const updated = await db.execute(sql`UPDATE k_nex_role_template_adoptions SET template_version=2, old_baseline_permission_ids=${JSON.stringify(adoption.baseline)}::jsonb,
        old_baseline_digest=${sha256(adoption.baseline)}, revision=revision+1, updated_at=now()
        WHERE application_id=${adoption.applicationId} AND adoption_id=${adoption.adoptionId} AND state='adopted' AND revision=${adoption.revision} RETURNING adoption_id`);
      if (resultRows(updated).length !== 1) fail(`Sales role-template adoption changed before rewrite for ${adoption.adoptionId}`);
    }
    for (const transition of plan.authorizationTransitions) {
      const nextAuthorizationRevision = transition.authorizationRevision + 1;
      const state = await db.execute(sql`UPDATE k_nex_authorization_state SET authorization_revision=${nextAuthorizationRevision}, updated_at=now()
        WHERE application_id=${transition.applicationId} AND authorization_revision=${transition.authorizationRevision} AND lifecycle_revision=${transition.lifecycleRevision} RETURNING application_id`);
      if (resultRows(state).length !== 1) fail(`Sales authorization state changed before rewrite for ${transition.applicationId}`);
      const event = { applicationId: transition.applicationId, environment: transition.environment, scope: "application", authorizationRevision: nextAuthorizationRevision, lifecycleRevision: transition.lifecycleRevision };
      const digest = sha256([transition.applicationId, transition.environment, transition.authorizationRevision, transition.lifecycleRevision]);
      const auditId = `p13-2-sales-authority-${digest.slice(7)}`;
      const audit = { schemaVersion: 1, auditId, decisionId: `p13-2-sales-authority-decision-${digest.slice(7)}`, correlationId: `p13-2-sales-authority-migration-${digest.slice(7)}`,
        applicationId: transition.applicationId, environment: transition.environment, permissionId: "system.role-assignments.manage", owner: { kind: "platform", namespace: "system" },
        principal: { kind: "service", id: "system:p13-2-migration" }, effectiveActor: { kind: "service", id: "system:p13-2-migration" },
        scope: { kind: "application", resource: "system.role-assignments" }, operation: "migrate-sales-authority", target: "sales.role-grants", authorizationRevision: nextAuthorizationRevision,
        lifecycleRevision: transition.lifecycleRevision, outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required" };
      await db.execute(sql`INSERT INTO k_nex_authorization_audit
        (audit_id,application_id,environment,permission_id,outcome,reason,authorization_revision,lifecycle_revision,audit_json)
        VALUES (${auditId},${transition.applicationId},${transition.environment},'system.role-assignments.manage','allow','granted',${nextAuthorizationRevision},${transition.lifecycleRevision},${JSON.stringify(audit)}::jsonb)`);
      await db.execute(sql`INSERT INTO k_nex_authorization_outbox
        (event_id,application_id,environment,authorization_revision,lifecycle_revision,event_json)
        VALUES (${`${digest.slice(7, 15)}-${digest.slice(15, 19)}-${digest.slice(19, 23)}-${digest.slice(23, 27)}-${digest.slice(27, 39)}`},${transition.applicationId},${transition.environment},${nextAuthorizationRevision},${transition.lifecycleRevision},${JSON.stringify(event)}::jsonb)`);
    }
  }
  for (const document of plan.settings) {
    const updated = await db.execute(sql`UPDATE k_nex_system_settings_documents SET values_json=${JSON.stringify(document.value)}::jsonb,
      document_revision=document_revision+1, settings_revision=${document.targetSettingsRevision}, updated_at=now()
      WHERE application_id=${document.applicationId} AND environment=${document.environment} AND descriptor_id='sales.settings.workspace'
        AND descriptor_schema_version=1 AND owner_scope_key=${document.ownerScopeKey} AND document_revision=${document.expectedDocumentRevision} AND settings_revision=${document.expectedDocumentSettingsRevision} RETURNING descriptor_id`);
    if (resultRows(updated).length !== 1) fail(`Sales settings document changed before rewrite for ${document.applicationId}`);
  }
  for (const scope of new Set(plan.settings.map((document) => `${document.applicationId}\0${document.environment}`))) {
    const [applicationId, environment] = scope.split("\0");
    const targetRevision = plan.settings.find((document) => document.applicationId === applicationId && document.environment === environment)!.targetSettingsRevision;
    const document = plan.settings.find((candidate) => candidate.applicationId === applicationId && candidate.environment === environment)!;
    const updated = await db.execute(sql`UPDATE k_nex_system_settings_state SET settings_revision=${targetRevision}, updated_at=now() WHERE application_id=${applicationId} AND environment=${environment} AND settings_revision=${document.expectedGlobalSettingsRevision} RETURNING application_id`);
    if (resultRows(updated).length !== 1) fail(`Sales settings state changed before rewrite for ${applicationId}`);
  }
  const published = plan.pages.filter((page) => page.table === "k_nex_workspace_published_revisions");
  if (published.length > 0) await db.execute(sql`ALTER TABLE k_nex_workspace_published_revisions DISABLE TRIGGER k_nex_workspace_published_revisions_immutable`);
  for (const page of plan.pages) {
    if (page.table === "k_nex_workspace_pages") {
      const updated = await db.execute(sql`UPDATE k_nex_workspace_pages SET page_json=${JSON.stringify(page.value)}::jsonb WHERE application_id=${page.applicationId} AND environment=${page.environment} AND page_id=${page.pageId} AND page_revision=${page.expectedRevision} RETURNING page_id`);
      if (resultRows(updated).length !== 1) fail(`Sales page ${page.pageId} changed before rewrite`);
    } else if (page.table === "k_nex_workspace_working_copies") {
      const updated = await db.execute(sql`UPDATE k_nex_workspace_working_copies SET working_copy_json=${JSON.stringify(page.value)}::jsonb WHERE application_id=${page.applicationId} AND environment=${page.environment} AND page_id=${page.pageId} AND working_copy_revision=${page.expectedRevision} RETURNING page_id`);
      if (resultRows(updated).length !== 1) fail(`Sales working copy ${page.pageId} changed before rewrite`);
    } else {
      const updated = await db.execute(sql`UPDATE k_nex_workspace_published_revisions SET revision_json=${JSON.stringify(page.value)}::jsonb, dependency_digest=${page.digest!} WHERE application_id=${page.applicationId} AND environment=${page.environment} AND page_id=${page.pageId} AND revision_id=${page.revisionId ?? ""} AND document_revision=${page.expectedRevision} RETURNING page_id`);
      if (resultRows(updated).length !== 1) fail(`Sales published page ${page.pageId} changed before rewrite`);
    }
  }
  if (published.length > 0) await db.execute(sql`ALTER TABLE k_nex_workspace_published_revisions ENABLE TRIGGER k_nex_workspace_published_revisions_immutable`);
  for (const page of published.filter((candidate) => candidate.pointer !== undefined)) {
    const pointer = page.pointer!;
    const updated = await db.execute(sql`UPDATE k_nex_workspace_pages SET dependency_digest=${page.digest ?? null}, page_json=jsonb_set(page_json,'{dependencyDigest}',to_jsonb(${page.digest ?? null}::text),true)
      WHERE application_id=${page.applicationId} AND environment=${page.environment} AND page_id=${page.pageId}
        AND published_revision_id=${pointer.expectedPublishedRevisionId} AND page_revision=${pointer.expectedPageRevision}
        AND dependency_digest IS NOT DISTINCT FROM ${pointer.expectedDigest} RETURNING page_id`);
    if (resultRows(updated).length !== 1) fail(`Sales published-page pointer ${page.pageId} changed before rewrite`);
  }
  for (const scope of plan.scopes) {
    await db.execute(sql`INSERT INTO sales_current_authority_scopes
      (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,revision)
      VALUES (${scope.applicationId},${scope.environment},${scope.principalId},${scope.recordScope},true,${scope.mutationAllowed},'[]'::jsonb,1)`);
  }
}

/** P13.2 is an offline cutover: removed legacy columns cannot be reconstructed safely. */
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("maintenance-required: P13.2 CRM core rollback needs a Phase 12 backup restore.");
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const legacy = resultRows<{ task_count: number; opportunity_count: number }>(await db.execute(sql`SELECT (SELECT count(*)::int FROM sales_tasks) AS task_count,
    (SELECT count(*)::int FROM sales_opportunities) AS opportunity_count`))[0] ?? { task_count: 0, opportunity_count: 0 };
  const needsLegacyReceipt = legacy.task_count > 0 || legacy.opportunity_count > 0;
  const bindings = needsLegacyReceipt ? resultRows<{ application_id: string | null; environment: string | null; owner_id: string | null; account_id: string | null; account_name: string | null; pipeline_id: string | null; pipeline_name: string | null; currency: string | null; receipt_digest: string | null }>(await db.execute(sql`SELECT
    current_setting('k_nex.sales_migration_application_id',true) AS application_id,
    current_setting('k_nex.sales_migration_environment',true) AS environment,
    current_setting('k_nex.sales_migration_owner_id',true) AS owner_id,
    current_setting('k_nex.sales_migration_account_id',true) AS account_id,
    current_setting('k_nex.sales_migration_account_name',true) AS account_name,
    current_setting('k_nex.sales_migration_pipeline_id',true) AS pipeline_id,
    current_setting('k_nex.sales_migration_pipeline_name',true) AS pipeline_name,
    current_setting('k_nex.sales_migration_currency',true) AS currency,
    current_setting('k_nex.sales_migration_receipt_digest',true) AS receipt_digest`))[0] : undefined;
  const receiptScope = bindings?.application_id?.match(/^[a-z][a-z0-9-]{2,127}$/u) && bindings.environment?.match(/^[a-z][a-z0-9-]{1,63}$/u)
    ? { applicationId: bindings.application_id, environment: bindings.environment } : undefined;
  const persisted = await planPersistedReferences(db, receiptScope);
  if (needsLegacyReceipt) {
    if (!bindings || !bindings.application_id?.match(/^[a-z][a-z0-9-]{2,127}$/u) || !bindings.environment?.match(/^[a-z][a-z0-9-]{1,63}$/u) ||
      !bindings.owner_id?.match(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u) ||
      !bindings.receipt_digest?.match(/^sha256:[0-9a-f]{64}$/u) ||
      [...persisted.environments].some((scope) => scope.startsWith(`${bindings.application_id}\0`) && scope !== `${bindings.application_id}\0${bindings.environment}`) ||
      legacy.opportunity_count > 0 && (!bindings.account_id?.match(/^[1-9][0-9]{0,9}$/u) || !bindings.account_name || bindings.account_name.length > 256 ||
        !bindings.pipeline_id?.match(/^[1-9][0-9]{0,9}$/u) || !bindings.pipeline_name || bindings.pipeline_name.length > 256 || bindings.currency !== "USD")) {
      fail("exact receipt-bound Sales migration bindings are required");
    }
  }
  await db.execute(sql`SELECT
    set_config('k_nex.sales_migration_application_id', COALESCE(NULLIF(current_setting('k_nex.sales_migration_application_id',true),''),'migration-unbound'), false),
    set_config('k_nex.sales_migration_environment', COALESCE(NULLIF(current_setting('k_nex.sales_migration_environment',true),''),'migration-unbound'), false),
    set_config('k_nex.sales_migration_owner_id', COALESCE(NULLIF(current_setting('k_nex.sales_migration_owner_id',true),''),'system:p13-2-migration'), false),
    set_config('k_nex.sales_migration_account_id', COALESCE(NULLIF(current_setting('k_nex.sales_migration_account_id',true),''),'1'), false),
    set_config('k_nex.sales_migration_account_name', COALESCE(NULLIF(current_setting('k_nex.sales_migration_account_name',true),''),'Migrated Sales account'), false),
    set_config('k_nex.sales_migration_pipeline_id', COALESCE(NULLIF(current_setting('k_nex.sales_migration_pipeline_id',true),''),'1'), false),
    set_config('k_nex.sales_migration_pipeline_name', COALESCE(NULLIF(current_setting('k_nex.sales_migration_pipeline_name',true),''),'Migrated Sales pipeline'), false),
    set_config('k_nex.sales_migration_currency', COALESCE(NULLIF(current_setting('k_nex.sales_migration_currency',true),''),'USD'), false),
    set_config('k_nex.sales_migration_receipt_digest', COALESCE(NULLIF(current_setting('k_nex.sales_migration_receipt_digest',true),''),'sha256:0000000000000000000000000000000000000000000000000000000000000000'), false)`);
  await db.execute(sql`SELECT set_config('k_nex.sales_migration_reference_count', ${String(persisted.referenceCount)}, false)`);
  await db.execute(sql`SELECT set_config('k_nex.sales_migration_settings_pipeline_scopes', ${JSON.stringify(persisted.settings.map(({ applicationId, environment }) => ({ application_id: applicationId, environment })))}, false)`);
  await db.execute(sql`SELECT set_config('k_nex.sales_migration_needs_account', ${legacy.opportunity_count > 0 ? "true" : "false"}, false),
    set_config('k_nex.sales_migration_needs_receipt', ${needsLegacyReceipt ? "true" : "false"}, false)`);
  // Keep preflight mutation-free. Payload runs each migration transactionally; direct proofs also
  // show missing authority/bindings and invalid decimals fail before any schema or row change.
  await db.execute(sql`
    DO $$
    DECLARE
      legacy_count bigint;
      application_binding text := current_setting('k_nex.sales_migration_application_id', true);
      environment_binding text := current_setting('k_nex.sales_migration_environment', true);
      owner_binding text := current_setting('k_nex.sales_migration_owner_id', true);
      account_binding text := current_setting('k_nex.sales_migration_account_id', true);
      account_name_binding text := current_setting('k_nex.sales_migration_account_name', true);
      pipeline_binding text := current_setting('k_nex.sales_migration_pipeline_id', true);
      pipeline_name_binding text := current_setting('k_nex.sales_migration_pipeline_name', true);
      currency_binding text := current_setting('k_nex.sales_migration_currency', true);
      receipt_binding text := current_setting('k_nex.sales_migration_receipt_digest', true);
      revision_matches boolean;
    BEGIN
      IF to_regclass('public.k_nex_migration_revision') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM k_nex_migration_revision WHERE id=1 AND predecessor_revision=23 AND revision=24)' INTO revision_matches;
        IF NOT revision_matches THEN RAISE EXCEPTION 'maintenance-required: expected fixture migration revision 24'; END IF;
      END IF;
      IF to_regclass('public.sales_accounts') IS NOT NULL OR to_regclass('public.sales_crm_migration_receipts') IS NOT NULL THEN
        RAISE EXCEPTION 'maintenance-required: CRM core target schema already exists';
      END IF;

      SELECT (SELECT count(*) FROM sales_tasks) + (SELECT count(*) FROM sales_opportunities) INTO legacy_count;
      IF EXISTS (SELECT 1 FROM sales_tasks WHERE potential_revenue IS NOT NULL AND (length(potential_revenue) NOT BETWEEN 1 AND 128 OR potential_revenue !~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,18})?$'))
        OR EXISTS (SELECT 1 FROM sales_opportunities WHERE value IS NOT NULL AND (length(value) NOT BETWEEN 1 AND 128 OR value !~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,18})?$')) THEN
        RAISE EXCEPTION 'maintenance-required: legacy Sales decimal is not canonical';
      END IF;

      IF legacy_count > 0 AND (
        application_binding IS NULL OR application_binding !~ '^[a-z][a-z0-9-]{2,127}$' OR
        environment_binding IS NULL OR environment_binding !~ '^[a-z][a-z0-9-]{1,63}$' OR
        owner_binding IS NULL OR owner_binding !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$' OR
        (EXISTS (SELECT 1 FROM sales_opportunities) AND (account_binding IS NULL OR account_binding !~ '^[1-9][0-9]{0,9}$' OR
          account_name_binding IS NULL OR length(account_name_binding) NOT BETWEEN 1 AND 256 OR pipeline_binding IS NULL OR pipeline_binding !~ '^[1-9][0-9]{0,9}$' OR
          pipeline_name_binding IS NULL OR length(pipeline_name_binding) NOT BETWEEN 1 AND 256 OR currency_binding IS DISTINCT FROM 'USD')) OR
        receipt_binding IS NULL OR receipt_binding !~ '^sha256:[0-9a-f]{64}$'
      ) THEN
        RAISE EXCEPTION 'maintenance-required: exact receipt-bound Sales migration bindings are required';
      END IF;
    END $$;
  `);

  await db.execute(sql`
    CREATE TABLE "sales_crm_migration_receipts" (
      "receipt_digest" varchar(71) PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160) NOT NULL,
      "legacy_account_id" integer,
      "pipeline_id" integer,
      "currency" varchar(3),
      "task_count" integer NOT NULL,
      "opportunity_count" integer NOT NULL,
      "note_count" integer NOT NULL,
      "legacy_decimal_evidence" jsonb NOT NULL,
      "persisted_reference_count" integer DEFAULT 0 NOT NULL,
      "rollback_classification" varchar(32) DEFAULT 'maintenance-required' NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_crm_migration_receipts_check" CHECK (
        receipt_digest ~ '^sha256:[0-9a-f]{64}$' AND application_id ~ '^[a-z][a-z0-9-]{2,127}$' AND
        environment ~ '^[a-z][a-z0-9-]{1,63}$' AND owner_id <> '' AND
        task_count >= 0 AND opportunity_count >= 0 AND note_count >= 0 AND persisted_reference_count >= 0 AND
        ((opportunity_count=0 AND legacy_account_id IS NULL AND pipeline_id IS NULL AND currency IS NULL) OR
         (opportunity_count>0 AND legacy_account_id IS NOT NULL AND pipeline_id IS NOT NULL AND currency='USD')) AND
        jsonb_typeof(legacy_decimal_evidence)='array' AND rollback_classification='maintenance-required'
      )
    );

    CREATE TABLE "sales_retired_identity_tombstones" (
      "identity_id" varchar(160) PRIMARY KEY NOT NULL,
      "decision" varchar(32) DEFAULT 'retire-fail-closed' NOT NULL,
      "executable" boolean DEFAULT false NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_retired_identity_tombstones_check" CHECK (decision='retire-fail-closed' AND executable=false)
    );

    CREATE TABLE "sales_current_authority_scopes" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "principal_id" varchar(160) NOT NULL,
      "record_scope" varchar(40) NOT NULL,
      "application_wide" boolean DEFAULT false NOT NULL,
      "mutation_allowed" boolean DEFAULT false NOT NULL,
      "authorized_team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "state" varchar(16) DEFAULT 'active' NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id", "environment", "principal_id"),
      CONSTRAINT "sales_current_authority_scopes_check" CHECK (
        application_id<>'' AND environment<>'' AND principal_id<>'' AND revision BETWEEN 1 AND 1000000000 AND
        jsonb_typeof(authorized_team_ids)='array' AND jsonb_array_length(authorized_team_ids)<=32 AND
        state IN ('active','revoked') AND
        ((record_scope='application-sales-scope' AND application_wide AND mutation_allowed AND jsonb_array_length(authorized_team_ids)=0) OR
         (record_scope='explicit-application-or-team-scope' AND NOT mutation_allowed) OR
         (record_scope IN ('owned-or-assigned-team','managed-teams-and-own') AND NOT application_wide AND mutation_allowed))
      )
    );

    CREATE TABLE "sales_scope_administration_operations" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "actor_id" varchar(160) NOT NULL,
      "principal_id" varchar(160) NOT NULL,
      "operation" varchar(16) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "request_digest" varchar(71) NOT NULL,
      "response_json" jsonb NOT NULL,
      "target_state" varchar(16) NOT NULL,
      "authorization_revision" integer NOT NULL,
      "lifecycle_revision" integer NOT NULL,
      "scope_revision" integer NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id","environment","actor_id","principal_id","operation","idempotency_key"),
      CONSTRAINT "sales_scope_administration_operations_check" CHECK (
        application_id ~ '^[a-z][a-z0-9-]{2,127}$' AND environment ~ '^[a-z][a-z0-9-]{1,63}$' AND actor_id<>'' AND principal_id<>'' AND
        operation IN ('upsert','revoke') AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' AND request_digest ~ '^sha256:[0-9a-f]{64}$' AND
        target_state IN ('active','revoked') AND authorization_revision BETWEEN 0 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000 AND
        scope_revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(response_json)='object'
      )
    );

    CREATE TABLE "sales_action_idempotency" (
      "application_id" varchar(128) NOT NULL,
      "environment" varchar(64) NOT NULL,
      "effective_actor_id" varchar(160) NOT NULL,
      "action_id" varchar(160) NOT NULL,
      "idempotency_key" varchar(160) NOT NULL,
      "request_digest" varchar(71) NOT NULL,
      "result_json" jsonb NOT NULL,
      "result_digest" varchar(71) NOT NULL,
      "authorization_revision" integer NOT NULL,
      "lifecycle_revision" integer NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("application_id","environment","effective_actor_id","action_id","idempotency_key"),
      CONSTRAINT "sales_action_idempotency_check" CHECK (
        application_id ~ '^[a-z][a-z0-9-]{2,127}$' AND environment ~ '^[a-z][a-z0-9-]{1,63}$' AND
        effective_actor_id<>'' AND action_id<>'' AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$' AND
        request_digest ~ '^sha256:[0-9a-f]{64}$' AND result_digest ~ '^sha256:[0-9a-f]{64}$' AND jsonb_typeof(result_json)='object' AND
        authorization_revision BETWEEN 0 AND 1000000000 AND lifecycle_revision BETWEEN 0 AND 1000000000
      )
    );
    CREATE INDEX "sales_action_idempotency_created_idx" ON "sales_action_idempotency" ("application_id","environment","created_at");
    INSERT INTO sales_retired_identity_tombstones (identity_id) VALUES
      ('sales.total-potential-revenue'),('sales.revenue-metric'),('sales.metric.total-potential-revenue'),('sales.navigation.read'),
      ('sales.opportunities.name.read'),('sales.opportunities.stage.read'),('sales.opportunities.value.read'),('sales.tasks.private-note.read'),
      ('sales.tasks.revenue.read'),('sales.tasks.status.read'),('sales.tasks.title.read'),('sales.policy.opportunities.name.read'),
      ('sales.policy.opportunities.read'),('sales.policy.opportunities.stage.read'),('sales.policy.opportunities.value.read'),
      ('sales.policy.opportunities.write'),('sales.policy.tasks.private-note.read'),('sales.policy.tasks.read'),('sales.policy.tasks.revenue.read'),
      ('sales.policy.tasks.status.read'),('sales.policy.tasks.title.read'),('sales.policy.tasks.write');

    DO $$ BEGIN
      IF to_regclass('public.payload_mcp_api_keys') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE payload_mcp_api_keys RENAME COLUMN payload_mcp_tool_k_nex_sales_tools_search_tasks_v1 TO payload_mcp_tool_k_nex_sales_tools_search_tasks_v2';
        EXECUTE 'ALTER TABLE payload_mcp_api_keys RENAME COLUMN payload_mcp_tool_k_nex_sales_tools_create_task_v1 TO payload_mcp_tool_k_nex_sales_tools_create_task_v2';
      END IF;
    END $$;

    CREATE TABLE "sales_accounts" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160) NOT NULL, "team_id" varchar(160),
      "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "status" varchar(16) DEFAULT 'active' NOT NULL, "name" varchar(256) NOT NULL,
      "merged_into_id" varchar(128), "merge_lineage" jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_accounts_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_accounts_check" CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('active','archived','merged') AND ((status='merged' AND merged_into_id ~ '^[1-9][0-9]*$' AND jsonb_typeof(merge_lineage)='object' AND merge_lineage<>'{}'::jsonb) OR (status<>'merged' AND merged_into_id IS NULL AND merge_lineage IS NULL)))
    );
    CREATE INDEX "sales_accounts_scope_idx" ON "sales_accounts" ("application_id", "environment", "owner_id", "status");

    CREATE TABLE "sales_contacts" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160) NOT NULL, "team_id" varchar(160), "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'active' NOT NULL,
      "account_id" integer NOT NULL, "display_name" varchar(256) NOT NULL, "given_name" varchar(256), "email" varchar(320), "phone" varchar(64),
      "merged_into_id" varchar(128), "merge_lineage" jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_contacts_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_contacts_account_fk" FOREIGN KEY ("account_id", "application_id", "environment") REFERENCES "sales_accounts" ("id", "application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "sales_contacts_check" CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('active','archived','merged') AND ((status='merged' AND merged_into_id ~ '^[1-9][0-9]*$' AND jsonb_typeof(merge_lineage)='object' AND merge_lineage<>'{}'::jsonb) OR (status<>'merged' AND merged_into_id IS NULL AND merge_lineage IS NULL)))
    );
    CREATE INDEX "sales_contacts_scope_idx" ON "sales_contacts" ("application_id", "environment", "account_id", "status");

    CREATE TABLE "sales_leads" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160) NOT NULL, "team_id" varchar(160), "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'new' NOT NULL,
      "archive_status" varchar(16) DEFAULT 'active' NOT NULL,
      "display_name" varchar(256) NOT NULL, "source" varchar(256) NOT NULL, "email" varchar(320), "phone" varchar(64),
      "decided_at" timestamp(3) with time zone, "qualified_at" timestamp(3) with time zone, "disqualified_at" timestamp(3) with time zone,
      "qualified_account_id" varchar(128), "qualified_contact_id" varchar(128), "qualified_opportunity_id" varchar(128),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_leads_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_leads_check" CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('new','working','qualified','disqualified') AND archive_status IN ('active','archived') AND (status<>'qualified' OR (decided_at IS NOT NULL AND qualified_at IS NOT NULL AND qualified_account_id ~ '^[1-9][0-9]*$' AND qualified_contact_id ~ '^[1-9][0-9]*$' AND qualified_opportunity_id ~ '^[1-9][0-9]*$')) AND (status<>'qualified' OR (qualified_account_id IS NOT NULL AND qualified_contact_id IS NOT NULL AND qualified_opportunity_id IS NOT NULL)) AND (status='qualified' OR (qualified_account_id IS NULL AND qualified_contact_id IS NULL AND qualified_opportunity_id IS NULL)) AND (status<>'disqualified' OR (decided_at IS NOT NULL AND disqualified_at IS NOT NULL)))
    );
    CREATE INDEX "sales_leads_scope_idx" ON "sales_leads" ("application_id", "environment", "owner_id", "status");

    CREATE TABLE "sales_pipelines" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160), "team_id" varchar(160), "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'active' NOT NULL,
      "name" varchar(256) NOT NULL, "ordered_stage_ids" jsonb DEFAULT '[]'::jsonb NOT NULL, "is_active" boolean DEFAULT false NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_pipelines_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_pipelines_check" CHECK (application_id<>'' AND environment<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND jsonb_typeof(ordered_stage_ids)='array' AND status IN ('active','archived'))
    );
    CREATE UNIQUE INDEX "sales_pipelines_one_active_idx" ON "sales_pipelines" ("application_id", "environment") WHERE "is_active";

    CREATE TABLE "sales_pipeline_stages" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160), "team_id" varchar(160), "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'active' NOT NULL,
      "pipeline_id" integer NOT NULL, "stage_id" varchar(128) NOT NULL, "name" varchar(256) NOT NULL,
      "semantic" varchar(16) NOT NULL, "position" integer NOT NULL, "probability_basis_points" integer NOT NULL, "allowed_transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_pipeline_stages_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_pipeline_stages_identity_key" UNIQUE ("application_id", "environment", "pipeline_id", "stage_id"),
      CONSTRAINT "sales_pipeline_stages_pipeline_fk" FOREIGN KEY ("pipeline_id", "application_id", "environment") REFERENCES "sales_pipelines" ("id", "application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "sales_pipeline_stages_check" CHECK (application_id<>'' AND environment<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('active','archived') AND semantic IN ('qualification','discovery','proposal','negotiation','won','lost') AND position>=0 AND probability_basis_points BETWEEN 0 AND 10000 AND jsonb_typeof(allowed_transitions)='array')
    );

    CREATE TABLE "sales_activities" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160) NOT NULL, "team_id" varchar(160) NOT NULL, "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'scheduled' NOT NULL,
      "type" varchar(16) NOT NULL, "subject" varchar(256) NOT NULL, "actor_id" varchar(160) NOT NULL,
      "scheduled_at" timestamp(3) with time zone, "occurred_at" timestamp(3) with time zone,
      "related_record_id" varchar(128) NOT NULL, "related_record_type" varchar(64) NOT NULL, "supersedes_activity_id" integer, "provider_metadata" jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_activities_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_activities_supersedes_fk" FOREIGN KEY ("supersedes_activity_id", "application_id", "environment") REFERENCES "sales_activities" ("id", "application_id", "environment") ON DELETE RESTRICT,
      CONSTRAINT "sales_activities_check" CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND team_id<>'' AND actor_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('scheduled','completed','cancelled') AND type IN ('call','meeting','email') AND (status<>'scheduled' OR scheduled_at IS NOT NULL) AND (status<>'completed' OR occurred_at IS NOT NULL) AND (supersedes_activity_id IS NULL OR supersedes_activity_id<>id))
    );
    CREATE INDEX "sales_activities_scope_idx" ON "sales_activities" ("application_id", "environment", "owner_id", "status", "occurred_at");

    CREATE TABLE "sales_notes" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160), "team_id" varchar(160), "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'recorded' NOT NULL,
      "body" text NOT NULL, "author_id" varchar(160) NOT NULL, "occurred_at" timestamp(3) with time zone NOT NULL,
      "related_record_id" varchar(128) NOT NULL, "related_record_type" varchar(64) NOT NULL, "replaces_note_id" varchar(128),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_notes_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_notes_check" CHECK (application_id<>'' AND environment<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status='recorded' AND body<>'')
    );
    CREATE INDEX "sales_notes_timeline_idx" ON "sales_notes" ("application_id", "environment", "related_record_type", "related_record_id", "occurred_at");

    CREATE TABLE "sales_attachment_references" (
      "id" serial PRIMARY KEY NOT NULL,
      "application_id" varchar(128) NOT NULL, "environment" varchar(64) NOT NULL,
      "owner_id" varchar(160), "team_id" varchar(160), "created_by" varchar(160) NOT NULL, "updated_by" varchar(160) NOT NULL,
      "revision" integer DEFAULT 1 NOT NULL, "audit" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'active' NOT NULL,
      "storage_reference" varchar(512) NOT NULL, "filename" varchar(256) NOT NULL, "media_type" varchar(128) NOT NULL,
      "byte_size" integer NOT NULL, "uploader_id" varchar(160) NOT NULL, "related_record_id" varchar(128) NOT NULL, "related_record_type" varchar(64) NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL, "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "sales_attachment_references_scope_key" UNIQUE ("id", "application_id", "environment"),
      CONSTRAINT "sales_attachment_references_check" CHECK (application_id<>'' AND environment<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('active','removed') AND byte_size>=0)
    );
    CREATE INDEX "sales_attachment_references_scope_idx" ON "sales_attachment_references" ("application_id", "environment", "related_record_type", "related_record_id", "status");

    ALTER TABLE "payload_locked_documents_rels"
      ADD COLUMN "sales_accounts_id" integer, ADD COLUMN "sales_contacts_id" integer, ADD COLUMN "sales_leads_id" integer,
      ADD COLUMN "sales_pipelines_id" integer, ADD COLUMN "sales_pipeline_stages_id" integer, ADD COLUMN "sales_activities_id" integer,
      ADD COLUMN "sales_notes_id" integer, ADD COLUMN "sales_attachment_references_id" integer;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_sales_accounts_fk" FOREIGN KEY ("sales_accounts_id") REFERENCES "sales_accounts"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_contacts_fk" FOREIGN KEY ("sales_contacts_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_leads_fk" FOREIGN KEY ("sales_leads_id") REFERENCES "sales_leads"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_pipelines_fk" FOREIGN KEY ("sales_pipelines_id") REFERENCES "sales_pipelines"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_pipeline_stages_fk" FOREIGN KEY ("sales_pipeline_stages_id") REFERENCES "sales_pipeline_stages"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_activities_fk" FOREIGN KEY ("sales_activities_id") REFERENCES "sales_activities"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_notes_fk" FOREIGN KEY ("sales_notes_id") REFERENCES "sales_notes"("id") ON DELETE CASCADE,
      ADD CONSTRAINT "payload_locked_documents_rels_sales_attachment_references_fk" FOREIGN KEY ("sales_attachment_references_id") REFERENCES "sales_attachment_references"("id") ON DELETE CASCADE;
    CREATE INDEX "payload_locked_documents_rels_sales_accounts_id_idx" ON "payload_locked_documents_rels" ("sales_accounts_id");
    CREATE INDEX "payload_locked_documents_rels_sales_contacts_id_idx" ON "payload_locked_documents_rels" ("sales_contacts_id");
    CREATE INDEX "payload_locked_documents_rels_sales_leads_id_idx" ON "payload_locked_documents_rels" ("sales_leads_id");
    CREATE INDEX "payload_locked_documents_rels_sales_pipelines_id_idx" ON "payload_locked_documents_rels" ("sales_pipelines_id");
    CREATE INDEX "payload_locked_documents_rels_sales_pipeline_stages_id_idx" ON "payload_locked_documents_rels" ("sales_pipeline_stages_id");
    CREATE INDEX "payload_locked_documents_rels_sales_activities_id_idx" ON "payload_locked_documents_rels" ("sales_activities_id");
    CREATE INDEX "payload_locked_documents_rels_sales_notes_id_idx" ON "payload_locked_documents_rels" ("sales_notes_id");
    CREATE INDEX "payload_locked_documents_rels_sales_attachment_references_id_idx" ON "payload_locked_documents_rels" ("sales_attachment_references_id");

    ALTER TABLE "sales_tasks"
      ADD COLUMN "application_id" varchar(128), ADD COLUMN "environment" varchar(64), ADD COLUMN "owner_id" varchar(160), ADD COLUMN "team_id" varchar(160),
      ADD COLUMN "created_by" varchar(160), ADD COLUMN "updated_by" varchar(160), ADD COLUMN "revision" integer,
      ADD COLUMN "audit" jsonb, ADD COLUMN "due_date" varchar(10), ADD COLUMN "related_record_id" varchar(128), ADD COLUMN "related_record_type" varchar(64),
      ADD COLUMN "archive_status" varchar(16), ADD COLUMN "status_v2" varchar(16);
    ALTER TABLE "sales_opportunities"
      ADD COLUMN "application_id" varchar(128), ADD COLUMN "environment" varchar(64), ADD COLUMN "owner_id" varchar(160), ADD COLUMN "team_id" varchar(160),
      ADD COLUMN "created_by" varchar(160), ADD COLUMN "updated_by" varchar(160), ADD COLUMN "revision" integer, ADD COLUMN "audit" jsonb,
      ADD COLUMN "account_id" integer, ADD COLUMN "primary_contact_id" integer, ADD COLUMN "pipeline_id" integer, ADD COLUMN "stage_id" varchar(128),
      ADD COLUMN "amount" varchar(128), ADD COLUMN "currency" varchar(3), ADD COLUMN "expected_close_date" varchar(10), ADD COLUMN "closed_at" timestamp(3) with time zone,
      ADD COLUMN "loss_reason" varchar(256), ADD COLUMN "archive_status" varchar(16);

    INSERT INTO sales_accounts (id, application_id, environment, owner_id, created_by, updated_by, audit, name)
      SELECT current_setting('k_nex.sales_migration_account_id')::integer, current_setting('k_nex.sales_migration_application_id'), current_setting('k_nex.sales_migration_environment'),
        current_setting('k_nex.sales_migration_owner_id'), current_setting('k_nex.sales_migration_owner_id'), current_setting('k_nex.sales_migration_owner_id'),
        jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-import','receiptDigest',current_setting('k_nex.sales_migration_receipt_digest'),'ownershipGenesis',jsonb_build_object('ownerId',current_setting('k_nex.sales_migration_owner_id'),'teamId',NULL))), current_setting('k_nex.sales_migration_account_name')
      WHERE current_setting('k_nex.sales_migration_needs_account')::boolean;
    INSERT INTO sales_pipelines (id, application_id, environment, created_by, updated_by, audit, name, ordered_stage_ids, is_active)
      SELECT current_setting('k_nex.sales_migration_pipeline_id')::integer,
        current_setting('k_nex.sales_migration_application_id'), current_setting('k_nex.sales_migration_environment'),
        current_setting('k_nex.sales_migration_owner_id'), current_setting('k_nex.sales_migration_owner_id'),
        jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-import','receiptDigest',current_setting('k_nex.sales_migration_receipt_digest',true))),
        COALESCE(current_setting('k_nex.sales_migration_pipeline_name',true),'Migrated Sales pipeline'),
        '["qualification","discovery","proposal","negotiation","won","lost"]'::jsonb, true
      WHERE current_setting('k_nex.sales_migration_needs_account')::boolean;
    SELECT setval(pg_get_serial_sequence('sales_pipelines','id'), COALESCE((SELECT max(id) FROM sales_pipelines),1), EXISTS (SELECT 1 FROM sales_pipelines));
    INSERT INTO sales_pipelines (id, application_id, environment, created_by, updated_by, audit, name, ordered_stage_ids, is_active)
      SELECT nextval(pg_get_serial_sequence('sales_pipelines','id')), scope.application_id, scope.environment,
        'system:p13-2-migration', 'system:p13-2-migration', jsonb_build_array(jsonb_build_object('kind','phase-13-settings-migration')),
        'Migrated Sales pipeline', '["qualification","discovery","proposal","negotiation","won","lost"]'::jsonb, true
      FROM jsonb_to_recordset(current_setting('k_nex.sales_migration_settings_pipeline_scopes')::jsonb)
        AS scope(application_id text, environment text)
      WHERE NOT EXISTS (SELECT 1 FROM sales_pipelines existing WHERE existing.application_id=scope.application_id AND existing.environment=scope.environment AND existing.is_active);
    INSERT INTO sales_pipeline_stages (application_id, environment, created_by, updated_by, audit, pipeline_id, stage_id, name, semantic, position, probability_basis_points, allowed_transitions)
      SELECT pipeline.application_id, pipeline.environment, pipeline.created_by, pipeline.updated_by, pipeline.audit,
        pipeline.id, stage.stage_id, stage.name, stage.stage_id, stage.position, stage.probability_basis_points, stage.allowed_transitions
      FROM sales_pipelines pipeline CROSS JOIN (VALUES
        ('qualification','Qualification',0,1000,'["discovery","lost"]'::jsonb), ('discovery','Discovery',1,3000,'["proposal","lost"]'::jsonb),
        ('proposal','Proposal',2,6000,'["negotiation","lost"]'::jsonb), ('negotiation','Negotiation',3,8000,'["won","lost"]'::jsonb),
        ('won','Won',4,10000,'[]'::jsonb), ('lost','Lost',5,0,'[]'::jsonb)
      ) AS stage(stage_id,name,position,probability_basis_points,allowed_transitions);

    UPDATE sales_tasks SET
      application_id=current_setting('k_nex.sales_migration_application_id'), environment=current_setting('k_nex.sales_migration_environment'),
      owner_id=current_setting('k_nex.sales_migration_owner_id'), created_by=current_setting('k_nex.sales_migration_owner_id'), updated_by=current_setting('k_nex.sales_migration_owner_id'), revision=1,
      audit=jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-upgrade','receiptDigest',current_setting('k_nex.sales_migration_receipt_digest'),'ownershipGenesis',jsonb_build_object('ownerId',current_setting('k_nex.sales_migration_owner_id'),'teamId',NULL))),
      archive_status='active', status_v2=CASE status::text WHEN 'open' THEN 'open' WHEN 'done' THEN 'completed' END;
    UPDATE sales_opportunities SET
      application_id=current_setting('k_nex.sales_migration_application_id'), environment=current_setting('k_nex.sales_migration_environment'),
      owner_id=current_setting('k_nex.sales_migration_owner_id'), created_by=current_setting('k_nex.sales_migration_owner_id'), updated_by=current_setting('k_nex.sales_migration_owner_id'), revision=1,
      audit=jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-upgrade','receiptDigest',current_setting('k_nex.sales_migration_receipt_digest'),'legacyStage',stage::text,'ownershipGenesis',jsonb_build_object('ownerId',current_setting('k_nex.sales_migration_owner_id'),'teamId',NULL))),
      account_id=current_setting('k_nex.sales_migration_account_id')::integer, pipeline_id=(SELECT id FROM sales_pipelines WHERE application_id=current_setting('k_nex.sales_migration_application_id') AND environment=current_setting('k_nex.sales_migration_environment') AND is_active),
      stage_id=CASE stage::text WHEN 'lead' THEN 'qualification' WHEN 'qualified' THEN 'discovery' WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' END,
      amount=value, currency=CASE WHEN value IS NULL THEN NULL ELSE current_setting('k_nex.sales_migration_currency') END,
      closed_at=CASE WHEN stage::text IN ('won','lost') THEN updated_at ELSE NULL END,
      loss_reason=CASE WHEN stage::text='lost' THEN 'legacy-migration-unspecified' ELSE NULL END, archive_status='active';

    INSERT INTO sales_notes (application_id, environment, owner_id, created_by, updated_by, audit, body, author_id, occurred_at, related_record_id, related_record_type)
      SELECT application_id, environment, owner_id, created_by, updated_by,
        jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-private-note','receiptDigest',current_setting('k_nex.sales_migration_receipt_digest'),'taskId',id)),
        private_note, created_by, created_at, id::text, 'sales.task'
      FROM sales_tasks WHERE private_note IS NOT NULL AND private_note<>'';

    INSERT INTO sales_crm_migration_receipts (receipt_digest, application_id, environment, owner_id, legacy_account_id, pipeline_id, currency, task_count, opportunity_count, note_count, legacy_decimal_evidence, persisted_reference_count)
      SELECT current_setting('k_nex.sales_migration_receipt_digest'), current_setting('k_nex.sales_migration_application_id'), current_setting('k_nex.sales_migration_environment'),
        current_setting('k_nex.sales_migration_owner_id'), CASE WHEN EXISTS (SELECT 1 FROM sales_opportunities) THEN current_setting('k_nex.sales_migration_account_id')::integer END,
        CASE WHEN EXISTS (SELECT 1 FROM sales_opportunities) THEN (SELECT id FROM sales_pipelines WHERE application_id=current_setting('k_nex.sales_migration_application_id') AND environment=current_setting('k_nex.sales_migration_environment') AND is_active) END,
        CASE WHEN EXISTS (SELECT 1 FROM sales_opportunities) THEN current_setting('k_nex.sales_migration_currency') END, (SELECT count(*) FROM sales_tasks), (SELECT count(*) FROM sales_opportunities), (SELECT count(*) FROM sales_notes),
        COALESCE((SELECT jsonb_agg(jsonb_build_object('taskId',id,'value',potential_revenue) ORDER BY id) FROM sales_tasks WHERE potential_revenue IS NOT NULL), '[]'::jsonb),
        current_setting('k_nex.sales_migration_reference_count')::integer
      WHERE current_setting('k_nex.sales_migration_needs_receipt')::boolean;

    DROP INDEX "status_idx";
    ALTER TABLE sales_tasks DROP COLUMN status;
    ALTER TABLE sales_tasks RENAME COLUMN status_v2 TO status;
    DROP TYPE enum_sales_tasks_status;
    ALTER TABLE sales_tasks DROP COLUMN potential_revenue, DROP COLUMN private_note;
    ALTER TABLE sales_tasks ALTER COLUMN application_id SET NOT NULL, ALTER COLUMN environment SET NOT NULL, ALTER COLUMN owner_id SET NOT NULL,
      ALTER COLUMN created_by SET NOT NULL, ALTER COLUMN updated_by SET NOT NULL, ALTER COLUMN revision SET NOT NULL, ALTER COLUMN revision SET DEFAULT 1,
      ALTER COLUMN audit SET NOT NULL, ALTER COLUMN audit SET DEFAULT '[]'::jsonb, ALTER COLUMN archive_status SET NOT NULL, ALTER COLUMN archive_status SET DEFAULT 'active', ALTER COLUMN status SET NOT NULL, ALTER COLUMN status SET DEFAULT 'open';
    ALTER TABLE sales_tasks ADD CONSTRAINT "sales_tasks_scope_key" UNIQUE (id,application_id,environment),
      ADD CONSTRAINT "sales_tasks_check" CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND status IN ('open','completed','cancelled') AND archive_status IN ('active','archived') AND (due_date IS NULL OR due_date=(due_date::date)::text));
    CREATE INDEX "sales_tasks_scope_idx" ON sales_tasks (application_id,environment,owner_id,status,due_date);

    DROP INDEX IF EXISTS "sales_opportunities_stage_idx";
    DROP INDEX IF EXISTS "stage_idx";
    ALTER TABLE sales_opportunities DROP COLUMN stage, DROP COLUMN value;
    DROP TYPE enum_sales_opportunities_stage;
    ALTER TABLE sales_opportunities ALTER COLUMN application_id SET NOT NULL, ALTER COLUMN environment SET NOT NULL, ALTER COLUMN owner_id SET NOT NULL,
      ALTER COLUMN created_by SET NOT NULL, ALTER COLUMN updated_by SET NOT NULL, ALTER COLUMN revision SET NOT NULL, ALTER COLUMN revision SET DEFAULT 1,
      ALTER COLUMN audit SET NOT NULL, ALTER COLUMN audit SET DEFAULT '[]'::jsonb, ALTER COLUMN account_id SET NOT NULL, ALTER COLUMN pipeline_id SET NOT NULL,
      ALTER COLUMN stage_id SET NOT NULL, ALTER COLUMN archive_status SET NOT NULL, ALTER COLUMN archive_status SET DEFAULT 'active';
    ALTER TABLE sales_opportunities ADD CONSTRAINT "sales_opportunities_scope_key" UNIQUE (id,application_id,environment),
      ADD CONSTRAINT "sales_opportunities_account_fk" FOREIGN KEY (account_id,application_id,environment) REFERENCES sales_accounts(id,application_id,environment) ON DELETE RESTRICT,
      ADD CONSTRAINT "sales_opportunities_pipeline_fk" FOREIGN KEY (pipeline_id,application_id,environment) REFERENCES sales_pipelines(id,application_id,environment) ON DELETE RESTRICT,
      ADD CONSTRAINT "sales_opportunities_contact_fk" FOREIGN KEY (primary_contact_id,application_id,environment) REFERENCES sales_contacts(id,application_id,environment) ON DELETE RESTRICT,
      ADD CONSTRAINT "sales_opportunities_stage_fk" FOREIGN KEY (application_id,environment,pipeline_id,stage_id) REFERENCES sales_pipeline_stages(application_id,environment,pipeline_id,stage_id) ON DELETE RESTRICT,
      ADD CONSTRAINT "sales_opportunities_check" CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND archive_status IN ('active','archived') AND (amount IS NULL)=(currency IS NULL) AND (amount IS NULL OR (length(amount) BETWEEN 1 AND 128 AND amount ~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,18})?$')) AND (currency IS NULL OR currency ~ '^[A-Z]{3}$') AND (expected_close_date IS NULL OR expected_close_date=(expected_close_date::date)::text) AND (stage_id NOT IN ('won','lost') OR closed_at IS NOT NULL) AND (stage_id<>'lost' OR loss_reason IS NOT NULL));
    CREATE INDEX "sales_opportunities_scope_idx" ON sales_opportunities (application_id,environment,owner_id,pipeline_id,stage_id);

    CREATE FUNCTION sales_assert_related_record_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_table text; target_exists boolean;
    BEGIN
      IF (NEW.related_record_id IS NULL) <> (NEW.related_record_type IS NULL) THEN
        RAISE EXCEPTION 'Sales related-record identity must be paired';
      END IF;
      IF NEW.related_record_id IS NULL THEN
        IF TG_TABLE_NAME <> 'sales_tasks' THEN RAISE EXCEPTION 'Sales related-record identity is required'; END IF;
        RETURN NEW;
      END IF;
      target_table := CASE NEW.related_record_type
        WHEN 'sales.account' THEN 'sales_accounts' WHEN 'sales.contact' THEN 'sales_contacts' WHEN 'sales.lead' THEN 'sales_leads'
        WHEN 'sales.opportunity' THEN 'sales_opportunities' WHEN 'sales.task' THEN 'sales_tasks' ELSE NULL END;
      IF target_table IS NULL OR NEW.related_record_id !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Sales related-record type is invalid'; END IF;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id::text=$1 AND application_id=$2 AND environment=$3)', target_table)
        INTO target_exists USING NEW.related_record_id, NEW.application_id, NEW.environment;
      IF NOT target_exists THEN RAISE EXCEPTION 'Sales related-record scope is invalid'; END IF;
      RETURN NEW;
    END $$;

    CREATE FUNCTION sales_assert_merge_lineage_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_exists boolean;
    BEGIN
      IF NEW.status <> 'merged' THEN RETURN NEW; END IF;
      IF NEW.merged_into_id = NEW.id::text THEN RAISE EXCEPTION 'Sales merge cannot target itself'; END IF;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id::text=$1 AND application_id=$2 AND environment=$3)', TG_TABLE_NAME)
        INTO target_exists USING NEW.merged_into_id, NEW.application_id, NEW.environment;
      IF NOT target_exists THEN RAISE EXCEPTION 'Sales merge lineage scope is invalid'; END IF;
      RETURN NEW;
    END $$;

    CREATE FUNCTION sales_assert_lead_qualification_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE account_exists boolean; contact_exists boolean; opportunity_exists boolean;
    BEGIN
      IF NEW.status <> 'qualified' THEN RETURN NEW; END IF;
      SELECT EXISTS (SELECT 1 FROM sales_accounts WHERE id::text=NEW.qualified_account_id AND application_id=NEW.application_id AND environment=NEW.environment AND status='active') INTO account_exists;
      SELECT EXISTS (SELECT 1 FROM sales_contacts WHERE id::text=NEW.qualified_contact_id AND application_id=NEW.application_id AND environment=NEW.environment AND status='active' AND account_id::text=NEW.qualified_account_id) INTO contact_exists;
      SELECT EXISTS (SELECT 1 FROM sales_opportunities WHERE id::text=NEW.qualified_opportunity_id AND application_id=NEW.application_id AND environment=NEW.environment AND archive_status='active' AND account_id::text=NEW.qualified_account_id AND primary_contact_id::text=NEW.qualified_contact_id) INTO opportunity_exists;
      IF NOT account_exists OR NOT contact_exists OR NOT opportunity_exists THEN RAISE EXCEPTION 'Sales lead qualification scope is invalid'; END IF;
      RETURN NEW;
    END $$;

    CREATE FUNCTION sales_assert_active_account_parent() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE account_active boolean;
    BEGIN
      SELECT EXISTS (SELECT 1 FROM sales_accounts WHERE id=NEW.account_id AND application_id=NEW.application_id AND environment=NEW.environment AND status='active') INTO account_active;
      IF NOT account_active THEN RAISE EXCEPTION 'Sales account parent is not active'; END IF;
      RETURN NEW;
    END $$;

    CREATE FUNCTION sales_assert_note_replacement_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_exists boolean;
    BEGIN
      IF NEW.replaces_note_id IS NULL THEN RETURN NEW; END IF;
      IF NEW.replaces_note_id !~ '^[1-9][0-9]*$' OR NEW.replaces_note_id=NEW.id::text THEN RAISE EXCEPTION 'Sales note replacement is invalid'; END IF;
      SELECT EXISTS (SELECT 1 FROM sales_notes WHERE id::text=NEW.replaces_note_id AND application_id=NEW.application_id AND environment=NEW.environment
        AND status='recorded' AND related_record_type=NEW.related_record_type AND related_record_id=NEW.related_record_id) INTO target_exists;
      IF NOT target_exists THEN RAISE EXCEPTION 'Sales note replacement scope is invalid'; END IF;
      RETURN NEW;
    END $$;

    CREATE TRIGGER sales_tasks_related_record_scope BEFORE INSERT OR UPDATE OF related_record_id,related_record_type,application_id,environment ON sales_tasks FOR EACH ROW EXECUTE FUNCTION sales_assert_related_record_scope();
    CREATE TRIGGER sales_activities_related_record_scope BEFORE INSERT OR UPDATE OF related_record_id,related_record_type,application_id,environment ON sales_activities FOR EACH ROW EXECUTE FUNCTION sales_assert_related_record_scope();
    CREATE TRIGGER sales_notes_related_record_scope BEFORE INSERT OR UPDATE OF related_record_id,related_record_type,application_id,environment ON sales_notes FOR EACH ROW EXECUTE FUNCTION sales_assert_related_record_scope();
    CREATE TRIGGER sales_attachment_references_related_record_scope BEFORE INSERT OR UPDATE OF related_record_id,related_record_type,application_id,environment ON sales_attachment_references FOR EACH ROW EXECUTE FUNCTION sales_assert_related_record_scope();
    CREATE TRIGGER sales_accounts_merge_lineage_scope BEFORE INSERT OR UPDATE OF merged_into_id,merge_lineage,status,application_id,environment ON sales_accounts FOR EACH ROW EXECUTE FUNCTION sales_assert_merge_lineage_scope();
    CREATE TRIGGER sales_contacts_merge_lineage_scope BEFORE INSERT OR UPDATE OF merged_into_id,merge_lineage,status,application_id,environment ON sales_contacts FOR EACH ROW EXECUTE FUNCTION sales_assert_merge_lineage_scope();
    CREATE TRIGGER sales_leads_qualification_scope BEFORE INSERT OR UPDATE OF qualified_account_id,qualified_contact_id,qualified_opportunity_id,status,application_id,environment ON sales_leads FOR EACH ROW EXECUTE FUNCTION sales_assert_lead_qualification_scope();
    CREATE TRIGGER sales_contacts_active_account_parent BEFORE INSERT ON sales_contacts FOR EACH ROW EXECUTE FUNCTION sales_assert_active_account_parent();
    CREATE TRIGGER sales_opportunities_active_account_parent BEFORE INSERT ON sales_opportunities FOR EACH ROW EXECUTE FUNCTION sales_assert_active_account_parent();
    CREATE TRIGGER sales_notes_replacement_scope BEFORE INSERT OR UPDATE OF replaces_note_id,related_record_id,related_record_type,application_id,environment,status ON sales_notes FOR EACH ROW EXECUTE FUNCTION sales_assert_note_replacement_scope();

    SELECT setval(pg_get_serial_sequence('sales_accounts','id'), COALESCE((SELECT max(id) FROM sales_accounts),1), EXISTS (SELECT 1 FROM sales_accounts));
    SELECT setval(pg_get_serial_sequence('sales_pipelines','id'), COALESCE((SELECT max(id) FROM sales_pipelines),1), EXISTS (SELECT 1 FROM sales_pipelines));
    SELECT setval(pg_get_serial_sequence('sales_tasks','id'), COALESCE((SELECT max(id) FROM sales_tasks),1), EXISTS (SELECT 1 FROM sales_tasks));
    SELECT setval(pg_get_serial_sequence('sales_opportunities','id'), COALESCE((SELECT max(id) FROM sales_opportunities),1), EXISTS (SELECT 1 FROM sales_opportunities));
    DO $$ DECLARE revision_rows integer; target_revision integer; BEGIN
      IF to_regclass('public.k_nex_migration_revision') IS NOT NULL THEN
        EXECUTE 'UPDATE k_nex_migration_revision SET predecessor_revision=24, revision=25 WHERE id=1 AND predecessor_revision=23 AND revision=24 RETURNING revision' INTO target_revision;
        GET DIAGNOSTICS revision_rows = ROW_COUNT;
        IF revision_rows <> 1 OR target_revision <> 25 THEN RAISE EXCEPTION 'maintenance-required: fixture migration revision changed before cutover'; END IF;
      END IF;
    END $$;
  `);
  await applyPersistedReferences(db, persisted);
}
