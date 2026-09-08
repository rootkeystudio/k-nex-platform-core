import {
  ActionGatewayError,
  CurrentAuthorityActionGatewayPolicy,
  RegisteredActionGateway,
  type AuthenticatedActionRequest,
  type ScopedRegistrationResult
} from "@k-nex/runtime";
import { sql } from "@payloadcms/db-postgres";
import {
  activePayloadPostgresTransaction,
  createPayloadPersistenceCapability,
  CurrentAuthorityPayloadPersistenceAuthorizer,
  type RuntimeExtensionPool,
  type PayloadPersistenceCapabilityContext
} from "@k-nex/payload-adapter";
import { createHash } from "node:crypto";
import { canonicalJson } from "@k-nex/contracts";
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority, FixtureDurableSalesAuthority } from "./current-authority.js";
import { FixtureSalesDataMovementStore } from "./data-movement-host.js";
import { createGeneratedSalesProviderGateway } from "./k-nex-sales-communications.js";
import { createGeneratedSalesReportingGateway } from "./k-nex-sales-reports.js";
import { readGeneratedSalesReportArtifact } from "./k-nex-sales-reports.js";

interface ActionBody {
  readonly actionId?: unknown;
  readonly input?: unknown;
}

interface CapabilityRequest {
  readonly transaction: { begin(): Promise<void> };
  guard(input: Readonly<Record<string, unknown>>): Promise<boolean>;
}
interface ActionOperation { readonly request: PayloadRequest; readonly actionId: string; readonly key: string; readonly digest: string; readonly durable: FixtureDurableSalesAuthority; replay?: unknown; }

type FixtureActionAuthorizationContext = FixtureAuthorityContext & Readonly<{
  authorizationRevision: number;
  lifecycleRevision: number;
  salesScopeRevision: number;
}>;

function actionAuthorizationContext(context: FixtureAuthorityContext, durable: FixtureDurableSalesAuthority): FixtureActionAuthorizationContext {
  const { authorizationRevision, lifecycleRevision, scopeRevision } = durable;
  if (!Number.isSafeInteger(authorizationRevision) || authorizationRevision < 1 ||
    !Number.isSafeInteger(lifecycleRevision) || lifecycleRevision < 0 ||
    !Number.isSafeInteger(scopeRevision) || scopeRevision < 1) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales current-authority revisions are unavailable.");
  }
  return Object.freeze({ ...context, authorizationRevision, lifecycleRevision, salesScopeRevision: scopeRevision });
}

function digest(value: unknown) { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function eventId(operation: ActionOperation) { return `sales-action-${createHash("sha256").update(canonicalJson({ applicationId: operation.durable.context.applicationId, environment: operation.durable.context.environment, actorId: operation.durable.context.actorId, actionId: operation.actionId, key: operation.key, digest: operation.digest })).digest("hex")}`; }
async function reserve(operation: ActionOperation): Promise<void> {
  const transaction = await activePayloadPostgresTransaction(operation.request); const pending = { state: "pending" };
  let row = resultRows(await transaction.execute(sql`INSERT INTO "sales_action_idempotency" ("application_id","environment","effective_actor_id","action_id","idempotency_key","request_digest","result_json","result_digest","authorization_revision","lifecycle_revision") VALUES (${operation.durable.context.applicationId},${operation.durable.context.environment},${operation.durable.context.actorId},${operation.actionId},${operation.key},${operation.digest},${JSON.stringify(pending)}::jsonb,${digest(pending)},${operation.durable.authorizationRevision},${operation.durable.lifecycleRevision}) ON CONFLICT ("application_id","environment","effective_actor_id","action_id","idempotency_key") DO NOTHING RETURNING "request_digest","result_json","result_digest"`))[0] as Record<string, unknown> | undefined;
  if (row === undefined) row = resultRows(await transaction.execute(sql`SELECT "request_digest","result_json","result_digest" FROM "sales_action_idempotency" WHERE "application_id"=${operation.durable.context.applicationId} AND "environment"=${operation.durable.context.environment} AND "effective_actor_id"=${operation.durable.context.actorId} AND "action_id"=${operation.actionId} AND "idempotency_key"=${operation.key} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
  if (row === undefined) throw new Error("Sales action idempotency reservation was lost.");
  if (row?.request_digest !== operation.digest) throw new ActionGatewayError("IDEMPOTENCY_CONFLICT", 409, "Sales action idempotency key was reused for different input.");
  if (row.result_json === null || typeof row.result_json !== "object" || Array.isArray(row.result_json) || row.result_digest !== digest(row.result_json)) throw new Error("Sales action idempotency evidence is invalid.");
  const result = row.result_json as Record<string, unknown>;
  if (result.state === "succeeded" && Object.keys(result).sort().join("\0") === "data\0state") operation.replay = result.data;
  else if (result.state !== "pending" || Object.keys(result).join("\0") !== "state") throw new Error("Sales action idempotency state is invalid.");
}
async function complete(operation: ActionOperation, data: unknown): Promise<void> {
  const transaction = await activePayloadPostgresTransaction(operation.request); const result = { state: "succeeded", data };
  if (resultRows(await transaction.execute(sql`UPDATE "sales_action_idempotency" SET "result_json"=${JSON.stringify(result)}::jsonb,"result_digest"=${digest(result)} WHERE "application_id"=${operation.durable.context.applicationId} AND "environment"=${operation.durable.context.environment} AND "effective_actor_id"=${operation.durable.context.actorId} AND "action_id"=${operation.actionId} AND "idempotency_key"=${operation.key} AND "request_digest"=${operation.digest} AND "result_json"='{"state":"pending"}'::jsonb RETURNING "idempotency_key"`)).length !== 1) throw new Error("Sales action idempotency finalization was lost.");
}

function actor(request: PayloadRequest) {
  if (request.user === null || request.user === undefined || request.user.collection !== "users" || request.user.id === null || request.user.id === undefined) {
    throw new ActionGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
  }
  const id = String(request.user.id);
  return { principal: { kind: "user", id }, effectiveActor: { kind: "user", id } };
}

function actionGrants(actionId: string) {
  if (actionId.startsWith("sales.import.") || actionId.startsWith("sales.export.") || actionId === "sales.merge.commit") return [] as const;
  if (actionId === "sales.integration.configure") return [] as const;
  if (actionId === "sales.report.run" || actionId === "sales.report.schedule") return [] as const;
  if (actionId === "sales.email.send") return [
    { collection: "sales-activities", operations: ["create", "update"] },
    { collection: "sales-contacts", operations: ["find"] },
    { collection: "sales-leads", operations: ["find"] }
  ] as const;
  if (actionId === "sales.calendar.sync") return [{ collection: "sales-activities", operations: ["find"] }] as const;
  if (actionId === "sales.reminder.schedule") return [
    { collection: "sales-reminders", operations: ["create", "update"] },
    { collection: "sales-tasks", operations: ["find"] },
    { collection: "sales-activities", operations: ["find"] }
  ] as const;
  if (actionId === "sales.notification.read" || actionId === "sales.notification.archive") return [{ collection: "sales-notifications", operations: ["find", "update"] }] as const;
  if (actionId === "sales.reminder.dismiss") return [{ collection: "sales-reminders", operations: ["find", "update"] }] as const;
  if (actionId === "sales.ownership.assign") return [
    { collection: "sales-accounts", operations: ["find", "update"] }, { collection: "sales-contacts", operations: ["find", "update"] },
    { collection: "sales-leads", operations: ["find", "update"] }, { collection: "sales-opportunities", operations: ["find", "update"] }
  ] as const;
  if (actionId === "sales.task.create") return [{ collection: "sales-tasks", operations: ["create", "update"] }] as const;
  if (actionId === "sales.task.update") return [{ collection: "sales-tasks", operations: ["find", "update"] }] as const;
  if (actionId === "sales.opportunity.stage.update") return [
    { collection: "sales-opportunities", operations: ["find", "update"] },
    { collection: "sales-pipelines", operations: ["find"] },
    { collection: "sales-pipeline-stages", operations: ["find"] }
  ] as const;
  const collection = workflowActionCollection(actionId);
  if (collection === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden.");
  if (actionId === "sales.lead.qualify") return [
    { collection: "sales-leads", operations: ["find", "update"] },
    { collection: "sales-accounts", operations: ["create", "find", "update"] },
    { collection: "sales-contacts", operations: ["create", "find", "update"] },
    { collection: "sales-opportunities", operations: ["create", "update"] },
    { collection: "sales-pipelines", operations: ["find"] },
    { collection: "sales-pipeline-stages", operations: ["find"] }
  ] as const;
  const related = actionId.startsWith("sales.activity.") || actionId === "sales.note.create" || actionId === "sales.attachment.link" || actionId === "sales.attachment.remove"
    ? [{ collection: "sales-accounts", operations: ["find"] as const }, { collection: "sales-contacts", operations: ["find"] as const }, { collection: "sales-leads", operations: ["find"] as const }, { collection: "sales-opportunities", operations: ["find"] as const }, { collection: "sales-tasks", operations: ["find"] as const }] as const
    : [] as const;
  const operations = actionId.endsWith(".create") || actionId === "sales.attachment.link" ? ["create", "update", "find"] as const : ["find", "update"] as const;
  const references = actionId === "sales.contact.create"
    ? [{ collection: "sales-accounts", operations: ["find"] as const }]
    : actionId === "sales.opportunity.create"
      ? [{ collection: "sales-accounts", operations: ["find"] as const }, { collection: "sales-contacts", operations: ["find"] as const }, { collection: "sales-pipelines", operations: ["find"] as const }, { collection: "sales-pipeline-stages", operations: ["find"] as const }]
      : actionId === "sales.opportunity.update"
        ? [{ collection: "sales-contacts", operations: ["find"] as const }]
      : [] as const;
  return [{ collection, operations }, ...related, ...references] as const;
}

function protectedFieldRequests(actionId: string, input: Readonly<Record<string, unknown>>) {
  if (actionId.startsWith("sales.contact.") || actionId.startsWith("sales.lead.")) {
    const permissionId = actionId.startsWith("sales.contact.") ? "sales.contacts.channels.read" as const : "sales.leads.channels.read" as const;
    return ["email", "phone"].filter((fieldId) => actionId.endsWith(".update") ? input[`${fieldId}Mode`] !== "retain" : input[fieldId] !== undefined).map((fieldId) => Object.freeze({ fieldId: fieldId as "email" | "phone", permissionId }));
  }
  return actionId === "sales.opportunity.create" && input.amount !== undefined || actionId === "sales.opportunity.update" && input.amountMode !== "retain"
    ? [Object.freeze({ fieldId: "amount" as const, permissionId: "sales.opportunities.amount.read" as const })] : [];
}

async function admitProtectedFields(request: PayloadRequest, durable: FixtureDurableSalesAuthority, actionId: string, input: Readonly<Record<string, unknown>>) {
  const admissions = protectedFieldRequests(actionId, input);
  if (admissions.length === 0) return admissions;
  const transaction = await activePayloadPostgresTransaction(request);
  for (const { permissionId } of admissions) {
    const rows = resultRows(await transaction.execute(sql`
      SELECT 1 FROM "k_nex_role_assignments" a
      JOIN "k_nex_role_permission_grants" g ON g."application_id"=a."application_id" AND g."role_id"=a."role_id"
      JOIN "k_nex_extension_authorization_generations" x ON x."application_id"=g."application_id" AND x."delivery_class"=g."owner_delivery_class" AND x."extension_id"=g."owner_extension_id" AND x."authorization_generation"=g."owner_generation"
      WHERE a."application_id"=${durable.context.applicationId} AND a."subject_kind"='user' AND a."subject_id"=${durable.context.actorId} AND a."state"='active'
        AND g."permission_id"=${permissionId} AND g."owner_kind"='extension' AND g."owner_delivery_class"='platform-plugin' AND g."owner_extension_id"='module.sales'
        AND x."state"='current' FOR SHARE OF a,g,x
    `));
    if (rows.length === 0) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales protected field is unavailable.");
  }
  return admissions;
}

type WorkflowCollection = "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities" | "sales-activities" | "sales-notes" | "sales-attachment-references" | "sales-notifications" | "sales-reminders";
function workflowActionCollection(actionId: string): WorkflowCollection | undefined {
  if (actionId.startsWith("sales.account.")) return "sales-accounts";
  if (actionId.startsWith("sales.contact.")) return "sales-contacts";
  if (actionId.startsWith("sales.lead.")) return "sales-leads";
  if (actionId.startsWith("sales.opportunity.")) return "sales-opportunities";
  if (actionId.startsWith("sales.activity.")) return "sales-activities";
  if (actionId === "sales.note.create") return "sales-notes";
  if (actionId.startsWith("sales.attachment.")) return "sales-attachment-references";
  if (actionId.startsWith("sales.notification.")) return "sales-notifications";
  if (actionId.startsWith("sales.reminder.")) return "sales-reminders";
  return undefined;
}
function ownershipCollection(input: Readonly<Record<string, unknown>>): "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities" | undefined {
  return input.recordType === "sales.account" ? "sales-accounts" : input.recordType === "sales.contact" ? "sales-contacts" : input.recordType === "sales.lead" ? "sales-leads" : input.recordType === "sales.opportunity" ? "sales-opportunities" : undefined;
}

async function durableFence(request: PayloadRequest, durable: FixtureDurableSalesAuthority): Promise<boolean> {
  const transaction = await activePayloadPostgresTransaction(request);
  const state = resultRows(await transaction.execute(sql`SELECT "authorization_revision", "lifecycle_revision" FROM "k_nex_authorization_state" WHERE "application_id"=${durable.context.applicationId} FOR SHARE`))[0] as Record<string, unknown> | undefined;
  const scope = resultRows(await transaction.execute(sql`SELECT "revision" FROM "sales_current_authority_scopes" WHERE "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} AND "principal_id"=${durable.context.actorId} AND "state"='active' AND "mutation_allowed"=true FOR SHARE`))[0] as Record<string, unknown> | undefined;
  return state?.authorization_revision === durable.authorizationRevision && state?.lifecycle_revision === durable.lifecycleRevision && scope?.revision === durable.scopeRevision;
}

const ownershipPermissions = Object.freeze({
  "sales.account": Object.freeze(["sales.accounts.read", "sales.accounts.write"]),
  "sales.contact": Object.freeze(["sales.contacts.read", "sales.contacts.write"]),
  "sales.lead": Object.freeze(["sales.leads.read", "sales.leads.write"]),
  "sales.opportunity": Object.freeze(["sales.opportunities.read", "sales.opportunities.write"])
} as const);

/** Locks all mutable authority facts which admit a prospective owner. Team IDs have no free-form namespace: canonical owner team or an active scope fact only. */
async function lockOwnershipAdmission(request: PayloadRequest, durable: FixtureDurableSalesAuthority, input: Readonly<Record<string, unknown>>): Promise<Readonly<{ ownershipNewOwnerId: string; ownershipTeamCleared: boolean; ownershipNewTeamId?: string }>> {
  const recordType = input.recordType;
  const ownerId = input.ownerId;
  const teamId = input.teamId;
  if ((recordType !== "sales.account" && recordType !== "sales.contact" && recordType !== "sales.lead" && recordType !== "sales.opportunity") || typeof ownerId !== "string" || teamId !== undefined && typeof teamId !== "string") {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership admission is invalid.");
  }
  const transaction = await activePayloadPostgresTransaction(request);
  const permissions = ownershipPermissions[recordType];
  const grants = resultRows(await transaction.execute(sql`
    SELECT g."permission_id" FROM "k_nex_role_assignments" a
    JOIN "k_nex_role_permission_grants" g ON g."application_id"=a."application_id" AND g."role_id"=a."role_id"
    JOIN "k_nex_extension_authorization_generations" x ON x."application_id"=g."application_id" AND x."delivery_class"=g."owner_delivery_class" AND x."extension_id"=g."owner_extension_id" AND x."authorization_generation"=g."owner_generation"
    WHERE a."application_id"=${durable.context.applicationId} AND a."subject_kind"='user' AND a."subject_id"=${ownerId} AND a."state"='active'
      AND g."permission_id" IN (${sql.join(permissions.map((permissionId) => sql`${permissionId}`), sql`, `)})
      AND g."owner_kind"='extension' AND g."owner_delivery_class"='platform-plugin' AND g."owner_extension_id"='module.sales'
      AND x."delivery_class"='platform-plugin' AND x."extension_id"='module.sales' AND x."state"='current'
    FOR SHARE OF a,g,x
  `)).map((row) => (row as Record<string, unknown>).permission_id);
  if (!permissions.every((permissionId) => grants.includes(permissionId))) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership owner lacks current object authority.");
  const ownerScope = resultRows(await transaction.execute(sql`SELECT "record_scope","application_wide","mutation_allowed","authorized_team_ids","revision" FROM "sales_current_authority_scopes" WHERE "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} AND "principal_id"=${ownerId} AND "state"='active' AND "mutation_allowed"=true FOR SHARE`))[0] as Record<string, unknown> | undefined;
  if (ownerScope === undefined || typeof ownerScope.record_scope !== "string" || typeof ownerScope.application_wide !== "boolean" || ownerScope.mutation_allowed !== true || !Array.isArray(ownerScope.authorized_team_ids) || !Number.isSafeInteger(ownerScope.revision)) {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership owner scope is unavailable.");
  }
  if (teamId !== undefined) {
    if (!durable.applicationWide && !durable.authorizedTeamIds.includes(teamId)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership team is outside caller scope.");
    const teamFacts = resultRows(await transaction.execute(sql`SELECT "principal_id","authorized_team_ids" FROM "sales_current_authority_scopes" WHERE "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} AND "state"='active' AND ("principal_id"=${ownerId} OR "authorized_team_ids" @> ${JSON.stringify([teamId])}::jsonb) FOR SHARE`));
    const exists = teamId === `team:${ownerId}` || teamFacts.some((row) => Array.isArray((row as Record<string, unknown>).authorized_team_ids) && ((row as Record<string, unknown>).authorized_team_ids as unknown[]).includes(teamId));
    if (!exists) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership team is unavailable.");
  }
  return Object.freeze({ ownershipNewOwnerId: ownerId, ownershipTeamCleared: teamId === undefined, ...(teamId === undefined ? {} : { ownershipNewTeamId: teamId }) });
}

function capability(request: PayloadRequest, actionId: string, context: FixtureAuthorityContext, durable: FixtureDurableSalesAuthority, authority: FixtureCurrentAuthority) {
  return createPayloadPersistenceCapability(request, actionGrants(actionId), new CurrentAuthorityPayloadPersistenceAuthorizer(authority.adapter, context, ({ collection, operation }) => authority.payloadAction(actionId, collection, operation)), {
    guard: async (input) => {
      if (!await durableFence(request, durable)) return false;
      const operation = input.operation;
      if ((operation !== "find" && operation !== "create" && operation !== "update") || typeof input.collection !== "string") return false;
      try { if (!await authority.adapter.allows(context, authority.payloadAction(actionId, input.collection, operation))) return false; }
      catch { return false; }
      const target = actionTarget(actionId, input);
      return typeof input.id !== "string" && target === undefined || await lockScopedSalesTarget(request, durable, target ?? input) !== undefined;
    }
  });
}

function resultRows(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("Sales scope guard received an invalid Postgres result.");
  }
  return value.rows;
}

async function resolveAttachmentUpload(request: PayloadRequest, durable: FixtureDurableSalesAuthority, input: Readonly<{ applicationId: string; environmentId: string; actorId: string; storageRef: string }>) {
  if (input.applicationId !== durable.context.applicationId || input.environmentId !== durable.context.environment || input.actorId !== durable.context.actorId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Attachment upload authority is invalid.");
  const transaction = await activePayloadPostgresTransaction(request);
  const row = resultRows(await transaction.execute(sql`
    SELECT "storage_ref","application_id","environment","uploader_actor_id","filename","media_type","byte_size","state","revision"
    FROM "k_nex_sales_attachment_upload_admissions"
    WHERE "storage_ref"=${input.storageRef} AND "application_id"=${input.applicationId} AND "environment"=${input.environmentId}
      AND "uploader_actor_id"=${input.actorId} AND "state"='ready'
    FOR SHARE
  `))[0] as Record<string, unknown> | undefined;
  if (row === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Attachment upload is unavailable.");
  return Object.freeze({ storageRef: row.storage_ref, applicationId: row.application_id, environmentId: row.environment, uploaderActorId: row.uploader_actor_id, filename: row.filename, mediaType: row.media_type, byteSize: row.byte_size, state: row.state, revision: row.revision });
}

function relatedTarget(input: Readonly<Record<string, unknown>>): Readonly<{ collection: "sales-tasks" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities"; id: string }> | undefined {
  if (typeof input.relatedRecordId !== "string") return undefined;
  const collection = input.relatedRecordType === "sales.account" ? "sales-accounts"
    : input.relatedRecordType === "sales.contact" ? "sales-contacts"
      : input.relatedRecordType === "sales.lead" ? "sales-leads"
        : input.relatedRecordType === "sales.opportunity" ? "sales-opportunities"
          : input.relatedRecordType === "sales.task" ? "sales-tasks" : undefined;
  return collection === undefined ? undefined : Object.freeze({ collection, id: input.relatedRecordId });
}

function actionTarget(actionId: string, input: Readonly<Record<string, unknown>>) {
  const related = relatedTarget(input);
  if (related !== undefined) return related;
  if ((actionId === "sales.contact.create" || actionId === "sales.opportunity.create") && typeof input.accountId === "string") {
    return Object.freeze({ collection: "sales-accounts" as const, id: input.accountId });
  }
  return undefined;
}

async function activityAuthorityTarget(request: PayloadRequest, durable: FixtureDurableSalesAuthority, actionId: string, input: Readonly<Record<string, unknown>>) {
  const target = actionTarget(actionId, input);
  if (actionId !== "sales.activity.create" || target?.collection !== "sales-tasks") return target;
  const transaction = await activePayloadPostgresTransaction(request);
  const row = resultRows(await transaction.execute(sql`
    SELECT "related_record_type","related_record_id" FROM "sales_tasks"
    WHERE "id"=${target.id} AND "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment}
    FOR UPDATE
  `))[0] as Record<string, unknown> | undefined;
  const relatedId = typeof row?.related_record_id === "number" && Number.isSafeInteger(row.related_record_id) && row.related_record_id > 0
    ? String(row.related_record_id) : typeof row?.related_record_id === "string" ? row.related_record_id : undefined;
  if (typeof row?.related_record_type !== "string" || relatedId === undefined) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales activity task parent is unavailable.");
  const parent = relatedTarget({ relatedRecordType: row.related_record_type, relatedRecordId: relatedId });
  if (parent === undefined) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales activity task parent is unavailable.");
  return parent;
}

/** The table and scope-column branches are fixed host mappings, never request-controlled SQL identifiers. */
async function lockScopedSalesTarget(request: PayloadRequest, durable: FixtureDurableSalesAuthority, input: Readonly<Record<string, unknown>>): Promise<Readonly<{ ownerId: string; teamId?: string; status?: string; archiveStatus?: string; revision?: number; accountId?: string; relatedRecordType?: string; relatedRecordId?: string }> | undefined> {
  if (typeof input.id !== "string") return undefined;
  const transaction = await activePayloadPostgresTransaction(request);
  const context = durable.context;
  const assignedTeams = durable.authorizedTeamIds.length === 0 ? sql`FALSE` : sql`"team_id" IN (${sql.join(durable.authorizedTeamIds.map((teamId) => sql`${teamId}`), sql`, `)})`;
  const recordAllowed = durable.recordScope === "application-sales-scope" || durable.recordScope === "explicit-application-or-team-scope" && durable.applicationWide
    ? sql`TRUE`
    : durable.recordScope === "explicit-application-or-team-scope"
      ? assignedTeams
      : sql`("owner_id" = ${context.actorId} OR ${assignedTeams})`;
  if (input.collection === "sales-tasks") {
    const row = resultRows(await transaction.execute(sql`
      SELECT "owner_id","team_id","status","revision" FROM "sales_tasks"
      WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment}
        AND ${recordAllowed}
      FOR UPDATE
    `))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}), ...(typeof row.status === "string" ? { status: row.status } : {}), ...(Number.isSafeInteger(row.revision) ? { revision: row.revision as number } : {}) }) : undefined;
  }
  if (input.collection === "sales-opportunities") {
    const row = resultRows(await transaction.execute(sql`
      SELECT "owner_id","team_id" FROM "sales_opportunities"
      WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment}
        AND ${recordAllowed}
      FOR UPDATE
    `))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}) }) : undefined;
  }
  if (input.collection === "sales-accounts") {
    const row = resultRows(await transaction.execute(sql`SELECT "owner_id","team_id","status" FROM "sales_accounts" WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment} AND ${recordAllowed} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}), ...(typeof row.status === "string" ? { status: row.status } : {}) }) : undefined;
  }
  if (input.collection === "sales-contacts") {
    const row = resultRows(await transaction.execute(sql`SELECT "owner_id","team_id","status","revision","account_id" FROM "sales_contacts" WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment} AND ${recordAllowed} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}), ...(typeof row.status === "string" ? { status: row.status } : {}), ...(Number.isSafeInteger(row.revision) ? { revision: row.revision as number } : {}), ...(Number.isSafeInteger(row.account_id) ? { accountId: String(row.account_id) } : {}) }) : undefined;
  }
  if (input.collection === "sales-leads") {
    const row = resultRows(await transaction.execute(sql`SELECT "owner_id","team_id","status","archive_status","revision" FROM "sales_leads" WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment} AND ${recordAllowed} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}), ...(typeof row.status === "string" ? { status: row.status } : {}), ...(typeof row.archive_status === "string" ? { archiveStatus: row.archive_status } : {}), ...(Number.isSafeInteger(row.revision) ? { revision: row.revision as number } : {}) }) : undefined;
  }
  if (input.collection === "sales-activities") {
    const row = resultRows(await transaction.execute(sql`SELECT "owner_id","team_id","status","revision" FROM "sales_activities" WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment} AND ${recordAllowed} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}), ...(typeof row.status === "string" ? { status: row.status } : {}), ...(Number.isSafeInteger(row.revision) ? { revision: row.revision as number } : {}) }) : undefined;
  }
  if (input.collection === "sales-notes") {
    const row = resultRows(await transaction.execute(sql`SELECT "owner_id","team_id","status","related_record_type","related_record_id" FROM "sales_notes" WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment} AND ${recordAllowed} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}), ...(typeof row.status === "string" ? { status: row.status } : {}), ...(typeof row.related_record_type === "string" ? { relatedRecordType: row.related_record_type } : {}), ...(typeof row.related_record_id === "string" || Number.isSafeInteger(row.related_record_id) ? { relatedRecordId: String(row.related_record_id) } : {}) }) : undefined;
  }
  if (input.collection === "sales-attachment-references") {
    const row = resultRows(await transaction.execute(sql`SELECT "owner_id","team_id" FROM "sales_attachment_references" WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment} AND ${recordAllowed} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}) }) : undefined;
  }
  if (input.collection === "sales-notifications") {
    const row = resultRows(await transaction.execute(sql`SELECT "recipient_id","state","revision" FROM "sales_notifications" WHERE "id"=${input.id} AND "application_id"=${context.applicationId} AND "environment"=${context.environment} AND "recipient_id"=${context.actorId} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return row?.recipient_id === context.actorId ? Object.freeze({ ownerId: context.actorId, ...(typeof row.state === "string" ? { status: row.state } : {}), ...(Number.isSafeInteger(row.revision) ? { revision: row.revision as number } : {}) }) : undefined;
  }
  if (input.collection === "sales-reminders") {
    const row = resultRows(await transaction.execute(sql`SELECT "recipient_id","state","revision" FROM "sales_reminders" WHERE "id"=${input.id} AND "application_id"=${context.applicationId} AND "environment"=${context.environment} AND "recipient_id"=${context.actorId} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
    return row?.recipient_id === context.actorId ? Object.freeze({ ownerId: context.actorId, ...(typeof row.state === "string" ? { status: row.state } : {}), ...(Number.isSafeInteger(row.revision) ? { revision: row.revision as number } : {}) }) : undefined;
  }
  return undefined;
}

async function lockNoteReplacementIdentity(request: PayloadRequest, durable: FixtureDurableSalesAuthority, id: string) {
  const transaction = await activePayloadPostgresTransaction(request);
  const row = resultRows(await transaction.execute(sql`SELECT "status","related_record_type","related_record_id" FROM "sales_notes" WHERE "id"=${id} AND "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} FOR UPDATE`))[0] as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.freeze({ status: row.status, relatedRecordType: row.related_record_type, relatedRecordId: Number.isSafeInteger(row.related_record_id) || typeof row.related_record_id === "string" ? String(row.related_record_id) : undefined });
}

async function lockRelatedMutationParent(request: PayloadRequest, durable: FixtureDurableSalesAuthority, childCollection: "sales-activities" | "sales-attachment-references", id: string): Promise<Readonly<{ collection: "sales-tasks" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities"; id: string }>> {
  const transaction = await activePayloadPostgresTransaction(request);
  const row = resultRows(await (childCollection === "sales-activities" ? transaction.execute(sql`
    SELECT "related_record_type","related_record_id" FROM "sales_activities" WHERE "id"=${id} AND "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} FOR UPDATE
  `) : transaction.execute(sql`
    SELECT "related_record_type","related_record_id" FROM "sales_attachment_references" WHERE "id"=${id} AND "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} FOR UPDATE
  `)))[0] as Record<string, unknown> | undefined;
  const collection = row?.related_record_type === "sales.account" ? "sales-accounts" : row?.related_record_type === "sales.contact" ? "sales-contacts"
    : row?.related_record_type === "sales.lead" ? "sales-leads" : row?.related_record_type === "sales.opportunity" ? "sales-opportunities"
      : row?.related_record_type === "sales.task" ? "sales-tasks" : undefined;
  if (collection === undefined || !(Number.isSafeInteger(row?.related_record_id) || typeof row?.related_record_id === "string" && /^[1-9][0-9]*$/u.test(row.related_record_id))) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales related mutation target is forbidden.");
  const target = Object.freeze({ collection, id: String(row!.related_record_id) });
  if (childCollection === "sales-activities" && target.collection === "sales-tasks") {
    const parent = await activityAuthorityTarget(request, durable, "sales.activity.create", { relatedRecordType: "sales.task", relatedRecordId: target.id });
    if (parent === undefined) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales activity task parent is forbidden.");
    return parent;
  }
  return target;
}

function targetScope(collection: "sales-tasks" | "sales-opportunities" | WorkflowCollection, id: string | undefined, durable: FixtureDurableSalesAuthority) {
  const context = durable.context;
  if (collection === "sales-notifications" || collection === "sales-reminders") return Object.freeze({
    kind: collection === "sales-notifications" ? "sales.notifications" as const : "sales.reminders" as const,
    where: Object.freeze({ and: Object.freeze([...(id === undefined ? [] : [{ id: Object.freeze({ equals: id }) }]), { applicationId: Object.freeze({ equals: context.applicationId }) }, { environment: Object.freeze({ equals: context.environment }) }, { recipientId: Object.freeze({ equals: context.actorId }) }]) })
  });
  const conditions: Readonly<Record<string, unknown>>[] = [
    { applicationId: Object.freeze({ equals: context.applicationId }) },
    { environment: Object.freeze({ equals: context.environment }) }
  ];
  if (!(durable.recordScope === "application-sales-scope" || durable.recordScope === "explicit-application-or-team-scope" && durable.applicationWide)) {
    if (durable.recordScope === "explicit-application-or-team-scope") conditions.push({ teamId: Object.freeze({ in: durable.authorizedTeamIds }) });
    else conditions.push({ or: Object.freeze([{ ownerId: Object.freeze({ equals: context.actorId }) }, { teamId: Object.freeze({ in: durable.authorizedTeamIds }) }]) });
  }
  if (id !== undefined) conditions.unshift({ id: Object.freeze({ equals: id }) });
  return Object.freeze({
    kind: collection === "sales-tasks" ? "sales.tasks" as const : collection === "sales-opportunities" ? "sales.opportunities" as const
      : collection === "sales-accounts" ? "sales.accounts" as const : collection === "sales-contacts" ? "sales.contacts" as const : collection === "sales-leads" ? "sales.leads" as const : collection === "sales-activities" || collection === "sales-notes" || collection === "sales-attachment-references" ? "sales.timeline" as const : "sales.leads" as const,
    where: Object.freeze({ and: Object.freeze(conditions) })
  });
}

async function authorize(authority: FixtureCurrentAuthority, actionId: string, input: unknown, authenticated: AuthenticatedActionRequest, durable: FixtureDurableSalesAuthority, request: PayloadRequest): Promise<unknown> {
  const details = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const current = authenticated.authorizationContext as FixtureAuthorityContext;
  const identity = {
    applicationId: current.applicationId,
    environment: current.environment,
    actorId: current.actorId,
    ownerId: current.ownerId,
    teamId: current.teamId
  };
  const context = authenticated.request as CapabilityRequest;
  if (actionId.startsWith("sales.import.") || actionId.startsWith("sales.export.") || actionId === "sales.merge.commit") {
    return Object.freeze({ actionId, ...identity, dataMovement: new FixtureSalesDataMovementStore(request, durable), recordScope: durable.recordScope, applicationWide: durable.applicationWide, mutationAllowed: durable.mutationAllowed, authorizedTeamIds: durable.authorizedTeamIds, salesScopeRevision: durable.scopeRevision, recordEnvironment: current.environment, recordId: "collection", collectionScope: true, scope: Object.freeze({ kind: "sales.leads", where: Object.freeze({ and: Object.freeze([{ applicationId: { equals: current.applicationId } }, { environment: { equals: current.environment } }]) }) }) });
  }
  if (actionId === "sales.integration.configure") {
    await context.transaction.begin();
    if (!await durableFence(request, durable)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales provider authority changed.");
    return Object.freeze({ actionId, ...identity });
  }
  if (actionId === "sales.report.run" || actionId === "sales.report.schedule") {
    if (!durable.permissionGrants.includes("sales.reports.read") || actionId === "sales.report.schedule" && !durable.permissionGrants.includes("sales.reports.schedule")) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report authority is unavailable.");
    await context.transaction.begin();
    if (!await durableFence(request, durable)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales report authority changed.");
    return Object.freeze({ actionId, ...identity, recordScope: durable.recordScope, applicationWide: durable.applicationWide, authorizedTeamIds: durable.authorizedTeamIds, settingsRevision: durable.settingsRevision, reportingTimezone: durable.reportingTimezone, reportingCurrency: durable.reportingCurrency });
  }
  if (actionId === "sales.email.send" || actionId === "sales.calendar.sync" || actionId === "sales.reminder.schedule") {
    const relation = actionId === "sales.email.send"
      ? details.relatedRecordType === "sales.contact" ? { collection: "sales-contacts" as const, recordType: "sales.contact" as const, id: details.relatedRecordId }
        : details.relatedRecordType === "sales.lead" ? { collection: "sales-leads" as const, recordType: "sales.lead" as const, id: details.relatedRecordId } : undefined
      : actionId === "sales.calendar.sync" ? { collection: "sales-activities" as const, recordType: "sales.activity" as const, id: details.activityId }
        : details.referenceKind === "task" ? { collection: "sales-tasks" as const, recordType: "sales.task" as const, id: details.referenceId }
          : details.referenceKind === "activity" ? { collection: "sales-activities" as const, recordType: "sales.activity" as const, id: details.referenceId } : undefined;
    await context.transaction.begin();
    if (relation === undefined || typeof relation.id !== "string" || await context.guard({ collection: relation.collection, id: relation.id, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales communication relation is forbidden.");
    const target = await lockScopedSalesTarget(request, durable, relation);
    const expectedRevision = actionId === "sales.email.send" ? target?.revision : details.expectedRevision;
    const emailActive = relation.recordType === "sales.contact" ? target?.status === "active" && target.archiveStatus === undefined
      : relation.recordType === "sales.lead" ? (target?.status === "new" || target?.status === "working") && target.archiveStatus === "active" : false;
    const referenceActive = relation.recordType === "sales.task" ? target?.status === "open" : relation.recordType === "sales.activity" ? target?.status === "scheduled" : false;
    if (target === undefined || !Number.isSafeInteger(target.revision) || expectedRevision !== target.revision || (actionId === "sales.email.send" ? !emailActive : !referenceActive)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales communication relation changed before action.");
    const communicationRelationAdmission = Object.freeze({ actionId, recordType: relation.recordType, recordId: relation.id, applicationId: current.applicationId, environment: current.environment, revision: target.revision, status: target.status, archiveStatus: relation.recordType === "sales.lead" ? target.archiveStatus : null, ownerId: target.ownerId, teamId: target.teamId ?? null });
    return Object.freeze({ actionId, operation: actionId === "sales.calendar.sync" ? "find" : "create", ...identity, ownerId: target.ownerId, ...(target.teamId === undefined ? {} : { teamId: target.teamId }), resourceId: relation.id, communicationRelationAdmission, scope: targetScope(relation.collection, relation.id, durable) });
  }
  const workflowCollection = workflowActionCollection(actionId);
  if (actionId === "sales.task.create" || workflowCollection !== undefined && (actionId.endsWith(".create") || actionId === "sales.attachment.link")) {
    const collection = actionId === "sales.task.create" ? "sales-tasks" : workflowCollection!;
    await context.transaction.begin();
    const related = await activityAuthorityTarget(request, durable, actionId, details);
    if (await context.guard(related === undefined ? { collection, operation: "create" } : { ...related, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action authority changed.");
    const target = related === undefined ? undefined : await lockScopedSalesTarget(request, durable, related);
    if (related !== undefined && target === undefined) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
    const topLevelOwnedCreate = actionId === "sales.account.create" || actionId === "sales.lead.create";
    const personalTeam = `team:${current.actorId}`;
    if (topLevelOwnedCreate && !durable.applicationWide && !durable.authorizedTeamIds.includes(personalTeam)) {
      throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Personal Sales team is outside current scope.");
    }
    if (actionId === "sales.opportunity.create" && typeof details.primaryContactId === "string") {
      if (await context.guard({ collection: "sales-contacts", id: details.primaryContactId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales opportunity contact is forbidden.");
      const contact = await lockScopedSalesTarget(request, durable, { collection: "sales-contacts", id: details.primaryContactId });
      if (contact?.status !== "active" || contact.accountId !== details.accountId) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales opportunity contact is forbidden.");
    }
    let noteReplacementAdmission: Readonly<Record<string, unknown>> | undefined;
    if (actionId === "sales.note.create" && typeof details.replacesNoteId === "string") {
      const predecessor = await lockNoteReplacementIdentity(request, durable, details.replacesNoteId);
      if (predecessor?.status !== "recorded" || predecessor.relatedRecordType !== details.relatedRecordType || predecessor.relatedRecordId !== details.relatedRecordId) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales replaced note is forbidden.");
      noteReplacementAdmission = Object.freeze({ recordId: details.replacesNoteId, applicationId: current.applicationId, environment: current.environment, relatedRecordType: details.relatedRecordType, relatedRecordId: details.relatedRecordId });
    }
    const protectedFieldAdmissions = await admitProtectedFields(request, durable, actionId, details);
    return Object.freeze({
      actionId,
      operation: "create",
      ...identity,
      ...(target === undefined ? topLevelOwnedCreate ? { ownerId: current.actorId, teamId: personalTeam } : {} : { ownerId: target.ownerId, ...(target.teamId === undefined ? {} : { teamId: target.teamId }) }),
      ...(actionId === "sales.attachment.link" ? { resolveAttachmentUpload: (upload: Readonly<{ applicationId: string; environmentId: string; actorId: string; storageRef: string }>) => resolveAttachmentUpload(request, durable, upload) } : {}),
      ...(noteReplacementAdmission === undefined ? {} : { noteReplacementAdmission }),
      ...(protectedFieldAdmissions.length === 0 ? {} : { protectedFieldAdmissions: Object.freeze(protectedFieldAdmissions) }),
      scope: targetScope(collection, undefined, durable)
    });
  }
  const id = details.id;
  if (typeof id !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action target is forbidden.");
  const collection = actionId === "sales.task.update" ? "sales-tasks" : actionId === "sales.opportunity.stage.update" ? "sales-opportunities" : actionId === "sales.ownership.assign" ? ownershipCollection(details) : workflowCollection;
  if (collection === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden.");
  await context.transaction.begin();
  const relatedMutationCollection = actionId === "sales.attachment.remove" ? "sales-attachment-references" : actionId === "sales.activity.complete" || actionId === "sales.activity.cancel" ? "sales-activities" : undefined;
  const authorityTarget = relatedMutationCollection === undefined ? { collection, id } : await lockRelatedMutationParent(request, durable, relatedMutationCollection, id);
  if (await context.guard({ ...authorityTarget, operation: relatedMutationCollection === undefined ? "update" : "find" }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  const target = await lockScopedSalesTarget(request, durable, authorityTarget);
  if (target === undefined) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  const scope = targetScope(collection, id, durable);
  const ownership = actionId === "sales.ownership.assign" ? await lockOwnershipAdmission(request, durable, details) : undefined;
  const linkedRecordAdmissions: Array<Readonly<{ recordType: "sales.account" | "sales.contact"; recordId: string; applicationId: string; environment: string }>> = [];
  if (actionId === "sales.lead.qualify" && details.accountMode === "link") {
    if (typeof details.accountId !== "string" || await context.guard({ collection: "sales-accounts", id: details.accountId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Linked Sales account is forbidden.");
    const account = await lockScopedSalesTarget(request, durable, { collection: "sales-accounts", id: details.accountId });
    if (account?.status !== "active") throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Linked Sales account is forbidden.");
    linkedRecordAdmissions.push(Object.freeze({ recordType: "sales.account", recordId: details.accountId, applicationId: current.applicationId, environment: current.environment }));
  }
  if (actionId === "sales.lead.qualify" && details.contactMode === "link") {
    if (typeof details.contactId !== "string" || typeof details.accountId !== "string" || await context.guard({ collection: "sales-contacts", id: details.contactId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Linked Sales contact is forbidden.");
    const contact = await lockScopedSalesTarget(request, durable, { collection: "sales-contacts", id: details.contactId });
    if (contact?.status !== "active" || contact.accountId !== details.accountId) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Linked Sales contact is forbidden.");
    linkedRecordAdmissions.push(Object.freeze({ recordType: "sales.contact", recordId: details.contactId, applicationId: current.applicationId, environment: current.environment }));
  }
  if (actionId === "sales.opportunity.update" && details.primaryContactMode === "set" && typeof details.primaryContactId === "string") {
    if (await context.guard({ collection: "sales-contacts", id: details.primaryContactId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales opportunity contact is forbidden.");
    const contact = await lockScopedSalesTarget(request, durable, { collection: "sales-contacts", id: details.primaryContactId });
    if (contact?.status !== "active" || contact.accountId !== target.accountId) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Sales opportunity contact is forbidden.");
  }
  const protectedFieldAdmissions = await admitProtectedFields(request, durable, actionId, details);
  return Object.freeze({ actionId, resourceId: id, ...identity, ownerId: target.ownerId, ...(target.teamId === undefined ? {} : { teamId: target.teamId }), ...(ownership ?? {}), ...(linkedRecordAdmissions.length === 0 ? {} : { linkedRecordAdmissions: Object.freeze(linkedRecordAdmissions) }), ...(protectedFieldAdmissions.length === 0 ? {} : { protectedFieldAdmissions: Object.freeze(protectedFieldAdmissions) }), scope });
}

export function createActionEndpoint(registration: ScopedRegistrationResult, authority: FixtureCurrentAuthority): Endpoint {
  const scopedRequests = new WeakMap<PayloadRequest, PayloadPersistenceCapabilityContext>();
  const operations = new WeakMap<PayloadRequest, ActionOperation>();
  const capabilityOperations = new WeakMap<PayloadPersistenceCapabilityContext, ActionOperation>();
  const policy = new CurrentAuthorityActionGatewayPolicy(
    authority.adapter,
    ({ authenticated }) => authenticated.authorizationContext as FixtureAuthorityContext,
    (action, input) => authority.action(action, input),
    { authorize: async ({ action, input, authenticated }) => {
      const operation = capabilityOperations.get(authenticated.request as PayloadPersistenceCapabilityContext);
      if (operation === undefined) throw new ActionGatewayError("IDEMPOTENCY_KEY_REQUIRED", 400, "Sales action idempotency key is required.");
      await (authenticated.request as CapabilityRequest).transaction.begin();
      await reserve(operation);
      const facts = await authorize(authority, action.descriptor.id, input, authenticated, operation.durable, operation.request) as Record<string, unknown>;
      const communicationAuthority = Object.freeze({ context: Object.freeze({ applicationId: operation.durable.context.applicationId, environment: operation.durable.context.environment, actorId: operation.durable.context.actorId }), authorizationRevision: operation.durable.authorizationRevision, lifecycleRevision: operation.durable.lifecycleRevision, scopeRevision: operation.durable.scopeRevision, permissionGrants: operation.durable.permissionGrants });
      const providerGateway = ["sales.email.send", "sales.calendar.sync", "sales.integration.configure"].includes(action.descriptor.id)
        ? createGeneratedSalesProviderGateway(operation.request, communicationAuthority) : undefined;
      const reportingAuthority = Object.freeze({ context: Object.freeze({ applicationId: operation.durable.context.applicationId, environment: operation.durable.context.environment, actorId: operation.durable.context.actorId }), authorizationRevision: operation.durable.authorizationRevision, lifecycleRevision: operation.durable.lifecycleRevision, scopeRevision: operation.durable.scopeRevision, recordScope: operation.durable.recordScope, applicationWide: operation.durable.applicationWide, authorizedTeamIds: operation.durable.authorizedTeamIds, permissionGrants: operation.durable.permissionGrants });
      const reportingGateway = ["sales.report.run", "sales.report.schedule"].includes(action.descriptor.id)
        ? createGeneratedSalesReportingGateway(operation.request, reportingAuthority) : undefined;
      return Object.freeze({ ...facts, authorizationRevision: operation.durable.authorizationRevision, lifecycleRevision: operation.durable.lifecycleRevision, salesScopeRevision: operation.durable.scopeRevision, settingsRevision: operation.durable.settingsRevision, reportingTimezone: operation.durable.reportingTimezone, reportingCurrency: operation.durable.reportingCurrency, reportingAuthority: Object.freeze({ authorizationRevision: operation.durable.authorizationRevision, lifecycleRevision: operation.durable.lifecycleRevision, salesScopeRevision: operation.durable.scopeRevision, settingsRevision: operation.durable.settingsRevision, reportingTimezone: operation.durable.reportingTimezone, reportingCurrency: operation.durable.reportingCurrency }), ...(providerGateway === undefined ? {} : { providerGateway }), ...(reportingGateway === undefined ? {} : { reporting: reportingGateway }), eventId: eventId(operation), ...(operation.replay === undefined ? {} : { idempotencyReplay: operation.replay }) });
    } }
  );
  const gateway = new RegisteredActionGateway(registration, {
    async authenticate(request) {
      const raw = request.rawRequest as PayloadRequest;
      const context = authority.context(raw, request.correlationId);
      const durable = authority.durableSalesAuthority(raw);
      if (!durable.mutationAllowed) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action scope is unavailable.");
      const authorizationContext = actionAuthorizationContext(context, durable);
      const persistence = capability(raw, request.actionId, context, durable, authority);
      scopedRequests.set(raw, persistence);
      const operation = operations.get(raw);
      if (operation === undefined) throw new ActionGatewayError("IDEMPOTENCY_KEY_REQUIRED", 400, "Sales action idempotency key is required.");
      capabilityOperations.set(persistence, operation);
      return {
        actor: actor(raw),
        request: persistence,
        authorizationContext
      };
    }
  }, {
    authorize: policy.authorize.bind(policy)
  });
  return {
    method: "post",
    path: "/k-nex/action",
    handler: async (request) => {
      let body: ActionBody = {};
      try { body = typeof request.json === "function" ? await request.json() as ActionBody : {}; } catch {}
      if (typeof body.actionId !== "string") {
        return Response.json({ code: "INVALID_ACTION_REQUEST", status: 400, detail: "Action request is invalid.", correlationId: "fixture-action" }, { status: 400 });
      }
      const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
      let durable: FixtureDurableSalesAuthority;
      try { durable = await authority.resolveDurableSalesAuthority(request, request.headers.get("x-correlation-id") ?? "fixture-action"); }
      catch { return Response.json({ code: "ACTION_FORBIDDEN", status: 403, detail: "Sales current authority is unavailable.", correlationId: "fixture-action" }, { status: 403 }); }
      try {
        if (idempotencyKey === undefined) return Response.json({ code: "IDEMPOTENCY_KEY_REQUIRED", status: 400 }, { status: 400 });
        operations.set(request, { request, actionId: body.actionId, key: idempotencyKey, digest: digest({ actionId: body.actionId, input: body.input }), durable });
        const response = await gateway.execute({
          correlationId: request.headers.get("x-correlation-id") ?? "fixture-action",
          rawRequest: request,
          actionId: body.actionId,
          input: body.input,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          signal: request.signal ?? new AbortController().signal
        });
        const persistence = scopedRequests.get(request);
        const operation = operations.get(request);
        if (response.ok && operation !== undefined && operation.replay === undefined) await complete(operation, response.body.data);
        if (response.ok) await persistence?.transaction.commit();
        else await persistence?.transaction.rollback();
        return Response.json(response.body, { status: response.status });
      } catch (error) {
        await scopedRequests.get(request)?.transaction.rollback();
        if (error instanceof Error && ["Payload persistence capability denied the collection operation.", "Current authority denied the Payload persistence operation."].includes(error.message)) {
          return Response.json({ code: "ACTION_FORBIDDEN", status: 403, detail: "Sales action persistence is forbidden.", correlationId: "fixture-action" }, { status: 403 });
        }
        throw error;
      } finally {
        scopedRequests.delete(request);
        operations.delete(request);
      }
    }
  };
}

export function createSalesReportArtifactEndpoint(authority: FixtureCurrentAuthority): Endpoint {
  return {
    method: "get",
    path: "/k-nex/sales/report-artifact",
    handler: async (request) => {
      if (request.user === null || request.user === undefined || request.user.collection !== "users") return Response.json({ code: "REPORT_ARTIFACT_FORBIDDEN" }, { status: 403 });
      if (typeof request.url !== "string") return Response.json({ code: "REPORT_ARTIFACT_FORBIDDEN" }, { status: 403 });
      const artifactId = new URL(request.url).searchParams.get("artifactId");
      if (artifactId === null) return Response.json({ code: "REPORT_ARTIFACT_FORBIDDEN" }, { status: 403 });
      try {
        const durable = await authority.resolveDurableSalesAuthority(request, request.headers.get("x-correlation-id") ?? "fixture-report-artifact");
        const reportAuthority = Object.freeze({ context: Object.freeze({ applicationId: durable.context.applicationId, environment: durable.context.environment, actorId: durable.context.actorId }), authorizationRevision: durable.authorizationRevision, lifecycleRevision: durable.lifecycleRevision, scopeRevision: durable.scopeRevision, recordScope: durable.recordScope, applicationWide: durable.applicationWide, authorizedTeamIds: durable.authorizedTeamIds, permissionGrants: durable.permissionGrants });
        const result = await readGeneratedSalesReportArtifact(request.payload.db.pool as RuntimeExtensionPool, reportAuthority, artifactId);
        return new Response(result.bytes as BodyInit, { status: 200, headers: { "content-type": result.contentType, "cache-control": "no-store", "content-disposition": "attachment; filename=report.csv" } });
      } catch { return Response.json({ code: "REPORT_ARTIFACT_FORBIDDEN" }, { status: 403 }); }
    }
  };
}
