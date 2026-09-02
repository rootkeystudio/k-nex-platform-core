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
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority, FixtureSalesProfile } from "./current-authority.js";

interface ActionBody {
  readonly actionId?: unknown;
  readonly input?: unknown;
}

interface CapabilityRequest {
  readonly transaction: { begin(): Promise<void> };
  guard(input: Readonly<Record<string, unknown>>): Promise<boolean>;
}

function actor(request: PayloadRequest) {
  if (request.user === null || request.user === undefined || request.user.collection !== "users" || request.user.id === null || request.user.id === undefined) {
    throw new ActionGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
  }
  const id = String(request.user.id);
  return { principal: { kind: "user", id }, effectiveActor: { kind: "user", id } };
}

function capability(request: PayloadRequest, context: FixtureAuthorityContext, authority: FixtureCurrentAuthority) {
  const profile = authority.salesProfile(context);
  return createPayloadPersistenceCapability(request, [
    { collection: "sales-tasks", operations: ["find", "create", "update"] },
    { collection: "sales-opportunities", operations: ["find", "update"] }
  ], new CurrentAuthorityPayloadPersistenceAuthorizer(authority.adapter, context, ({ collection, operation }) => authority.payload(collection, operation)), {
    guard: (input) => lockScopedSalesTarget(request, profile, input)
  });
}

function resultRows(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("Sales scope guard received an invalid Postgres result.");
  }
  return value.rows;
}

/** The table and scope-column branches are fixed host mappings, never request-controlled SQL identifiers. */
async function lockScopedSalesTarget(request: PayloadRequest, profile: FixtureSalesProfile, input: Readonly<Record<string, unknown>>): Promise<boolean> {
  if (typeof input.id !== "string") return false;
  const transaction = await activePayloadPostgresTransaction(request);
  if (input.collection === "sales-tasks") {
    const status = profile === "done" ? "done" : "open";
    return resultRows(await transaction.execute(sql`
      SELECT "id" FROM "sales_tasks" WHERE "id" = ${input.id} AND "status" = ${status} FOR UPDATE
    `)).length === 1;
  }
  if (input.collection === "sales-opportunities") {
    const stage = profile === "done" ? "won" : "lead";
    return resultRows(await transaction.execute(sql`
      SELECT "id" FROM "sales_opportunities" WHERE "id" = ${input.id} AND "stage" = ${stage} FOR UPDATE
    `)).length === 1;
  }
  return false;
}

function targetScope(collection: "sales-tasks" | "sales-opportunities", id: string, profile: FixtureSalesProfile) {
  const field = collection === "sales-tasks" ? "status" : "stage";
  const value = profile === "done"
    ? collection === "sales-tasks" ? "done" : "won"
    : collection === "sales-tasks" ? "open" : "lead";
  return Object.freeze({
    kind: collection === "sales-tasks" ? "sales.tasks" as const : "sales.opportunities" as const,
    where: Object.freeze({ and: Object.freeze([{ id: Object.freeze({ equals: id }) }, { [field]: Object.freeze({ equals: value }) }]) })
  });
}

async function authorize(authority: FixtureCurrentAuthority, actionId: string, input: unknown, authenticated: AuthenticatedActionRequest): Promise<unknown> {
  const details = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  if (actionId === "sales.task.create") return Object.freeze({ actionId, operation: "create" });
  const id = details.id;
  if (typeof id !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action target is forbidden.");
  const context = authenticated.request as CapabilityRequest;
  const collection = actionId === "sales.task.update" ? "sales-tasks" : actionId === "sales.opportunity.stage.update" ? "sales-opportunities" : undefined;
  if (collection === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden.");
  const scope = targetScope(collection, id, authority.salesProfile(authenticated.authorizationContext as FixtureAuthorityContext));
  await context.transaction.begin();
  if (await context.guard({ collection, id }) !== true) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  return Object.freeze({ actionId, resourceId: id, scope });
}

export function createActionEndpoint(registration: ScopedRegistrationResult, authority: FixtureCurrentAuthority): Endpoint {
  const scopedRequests = new WeakMap<PayloadRequest, PayloadPersistenceCapabilityContext>();
  const policy = new CurrentAuthorityActionGatewayPolicy(
    authority.adapter,
    ({ authenticated }) => authenticated.authorizationContext as FixtureAuthorityContext,
    (action, input) => authority.action(action, input),
    { authorize: ({ action, input, authenticated }) => authorize(authority, action.descriptor.id, input, authenticated) }
  );
  const gateway = new RegisteredActionGateway(registration, {
    async authenticate(request) {
      const raw = request.rawRequest as PayloadRequest;
      const context = authority.context(raw, request.correlationId);
      const persistence = capability(raw, context, authority);
      if (request.actionId === "sales.task.update" || request.actionId === "sales.opportunity.stage.update") {
        scopedRequests.set(raw, persistence);
      }
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
      try {
        const response = await gateway.execute({
          correlationId: request.headers.get("x-correlation-id") ?? "fixture-action",
          rawRequest: request,
          actionId: body.actionId,
          input: body.input,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          signal: request.signal ?? new AbortController().signal
        });
        const persistence = scopedRequests.get(request);
        if (response.ok) await persistence?.transaction.commit();
        else await persistence?.transaction.rollback();
        return Response.json(response.body, { status: response.status });
      } catch (error) {
        await scopedRequests.get(request)?.transaction.rollback();
        throw error;
      } finally {
        scopedRequests.delete(request);
      }
    }
  };
}
