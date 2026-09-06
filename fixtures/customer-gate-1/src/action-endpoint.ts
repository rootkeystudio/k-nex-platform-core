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
  type PayloadPersistenceCapabilityContext
} from "@k-nex/payload-adapter";
import { createHash } from "node:crypto";
import { canonicalJson } from "@k-nex/contracts";
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority, FixtureDurableSalesAuthority } from "./current-authority.js";

interface ActionBody {
  readonly actionId?: unknown;
  readonly input?: unknown;
}

interface CapabilityRequest {
  readonly transaction: { begin(): Promise<void> };
  guard(input: Readonly<Record<string, unknown>>): Promise<boolean>;
}
interface ActionOperation { readonly request: PayloadRequest; readonly actionId: string; readonly key: string; readonly digest: string; readonly durable: FixtureDurableSalesAuthority; replay?: unknown; }

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
  if (actionId === "sales.task.create") return [{ collection: "sales-tasks", operations: ["create", "update"] }] as const;
  if (actionId === "sales.task.update") return [{ collection: "sales-tasks", operations: ["find", "update"] }] as const;
  if (actionId === "sales.opportunity.stage.update") return [{ collection: "sales-opportunities", operations: ["find", "update"] }] as const;
  throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden.");
}

async function durableFence(request: PayloadRequest, durable: FixtureDurableSalesAuthority): Promise<boolean> {
  const transaction = await activePayloadPostgresTransaction(request);
  const state = resultRows(await transaction.execute(sql`SELECT "authorization_revision", "lifecycle_revision" FROM "k_nex_authorization_state" WHERE "application_id"=${durable.context.applicationId} FOR SHARE`))[0] as Record<string, unknown> | undefined;
  const scope = resultRows(await transaction.execute(sql`SELECT "revision" FROM "sales_current_authority_scopes" WHERE "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} AND "principal_id"=${durable.context.actorId} AND "state"='active' AND "mutation_allowed"=true FOR SHARE`))[0] as Record<string, unknown> | undefined;
  return state?.authorization_revision === durable.authorizationRevision && state?.lifecycle_revision === durable.lifecycleRevision && scope?.revision === durable.scopeRevision;
}

function capability(request: PayloadRequest, actionId: string, context: FixtureAuthorityContext, durable: FixtureDurableSalesAuthority, authority: FixtureCurrentAuthority) {
  return createPayloadPersistenceCapability(request, actionGrants(actionId), new CurrentAuthorityPayloadPersistenceAuthorizer(authority.adapter, context, ({ collection, operation }) => authority.payloadAction(actionId, collection, operation)), {
    guard: async (input) => await durableFence(request, durable) && (typeof input.id !== "string" || await lockScopedSalesTarget(request, durable, input) !== undefined)
  });
}

function resultRows(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("Sales scope guard received an invalid Postgres result.");
  }
  return value.rows;
}

/** The table and scope-column branches are fixed host mappings, never request-controlled SQL identifiers. */
async function lockScopedSalesTarget(request: PayloadRequest, durable: FixtureDurableSalesAuthority, input: Readonly<Record<string, unknown>>): Promise<Readonly<{ ownerId: string; teamId?: string }> | undefined> {
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
      SELECT "owner_id","team_id" FROM "sales_tasks"
      WHERE "id" = ${input.id} AND "application_id" = ${context.applicationId} AND "environment" = ${context.environment}
        AND ${recordAllowed}
      FOR UPDATE
    `))[0] as Record<string, unknown> | undefined;
    return typeof row?.owner_id === "string" ? Object.freeze({ ownerId: row.owner_id, ...(typeof row.team_id === "string" ? { teamId: row.team_id } : {}) }) : undefined;
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
  return undefined;
}

function targetScope(collection: "sales-tasks" | "sales-opportunities", id: string | undefined, durable: FixtureDurableSalesAuthority) {
  const context = durable.context;
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
    kind: collection === "sales-tasks" ? "sales.tasks" as const : "sales.opportunities" as const,
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
  if (actionId === "sales.task.create") {
    await context.transaction.begin();
    if (await context.guard({ collection: "sales-tasks" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action authority changed.");
    return Object.freeze({
      actionId,
      operation: "create",
      ...identity,
      scope: targetScope("sales-tasks", undefined, durable)
    });
  }
  const id = details.id;
  if (typeof id !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action target is forbidden.");
  const collection = actionId === "sales.task.update" ? "sales-tasks" : actionId === "sales.opportunity.stage.update" ? "sales-opportunities" : undefined;
  if (collection === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden.");
  const scope = targetScope(collection, id, durable);
  await context.transaction.begin();
  if (await context.guard({ collection, id }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  const target = await lockScopedSalesTarget(request, durable, { collection, id });
  if (target === undefined) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  return Object.freeze({ actionId, resourceId: id, ...identity, ownerId: target.ownerId, ...(target.teamId === undefined ? {} : { teamId: target.teamId }), scope });
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
      return Object.freeze({ ...facts, eventId: eventId(operation), ...(operation.replay === undefined ? {} : { idempotencyReplay: operation.replay }) });
    } }
  );
  const gateway = new RegisteredActionGateway(registration, {
    async authenticate(request) {
      const raw = request.rawRequest as PayloadRequest;
      const context = authority.context(raw, request.correlationId);
      const durable = authority.durableSalesAuthority(raw);
      if (!durable.mutationAllowed) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action scope is unavailable.");
      const persistence = capability(raw, request.actionId, context, durable, authority);
      scopedRequests.set(raw, persistence);
      const operation = operations.get(raw);
      if (operation === undefined) throw new ActionGatewayError("IDEMPOTENCY_KEY_REQUIRED", 400, "Sales action idempotency key is required.");
      capabilityOperations.set(persistence, operation);
      return {
        actor: actor(raw),
        request: persistence,
        authorizationContext: context
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
        throw error;
      } finally {
        scopedRequests.delete(request);
        operations.delete(request);
      }
    }
  };
}
