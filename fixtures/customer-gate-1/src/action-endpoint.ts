import {
  ActionGatewayError,
  CurrentAuthorityActionGatewayPolicy,
  RegisteredActionGateway,
  type AuthenticatedActionRequest,
  type ScopedRegistrationResult
} from "@k-nex/runtime";
import { createPayloadPersistenceCapability, CurrentAuthorityPayloadPersistenceAuthorizer } from "@k-nex/payload-adapter";
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority, FixtureSalesProfile } from "./current-authority.js";

interface ActionBody {
  readonly actionId?: unknown;
  readonly input?: unknown;
}

interface CapabilityRequest {
  readonly payload: { find(options: Readonly<Record<string, unknown>>): Promise<unknown> };
}

function actor(request: PayloadRequest) {
  if (request.user === null || request.user === undefined || request.user.collection !== "users" || request.user.id === null || request.user.id === undefined) {
    throw new ActionGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
  }
  const id = String(request.user.id);
  return { principal: { kind: "user", id }, effectiveActor: { kind: "user", id } };
}

function capability(request: PayloadRequest, context: FixtureAuthorityContext, authority: FixtureCurrentAuthority) {
  return createPayloadPersistenceCapability(request, [
    { collection: "sales-tasks", operations: ["find", "create", "update"] },
    { collection: "sales-opportunities", operations: ["find", "update"] }
  ], new CurrentAuthorityPayloadPersistenceAuthorizer(authority.adapter, context, ({ collection, operation }) => authority.payload(collection, operation)));
}

function docs(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("docs" in result) || !Array.isArray(result.docs)) return [];
  return result.docs.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
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
  const result = await context.payload.find({
    collection,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: scope.where
  });
  if (docs(result).length !== 1) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  return Object.freeze({ actionId, resourceId: id, scope });
}

export function createActionEndpoint(registration: ScopedRegistrationResult, authority: FixtureCurrentAuthority): Endpoint {
  const policy = new CurrentAuthorityActionGatewayPolicy(
    authority.adapter,
    ({ authenticated }) => authenticated.authorizationContext as FixtureAuthorityContext,
    (action, input) => authority.action(action, input),
    { authorize: ({ action, input, authenticated }) => authorize(authority, action.descriptor.id, input, authenticated) }
  );
  const gateway = new RegisteredActionGateway(registration, {
    authenticate(request) {
      const raw = request.rawRequest as PayloadRequest;
      const context = authority.context(raw, request.correlationId);
      return {
        actor: actor(raw),
        request: capability(raw, context, authority),
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
      const response = await gateway.execute({
        correlationId: request.headers.get("x-correlation-id") ?? "fixture-action",
        rawRequest: request,
        actionId: body.actionId,
        input: body.input,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        signal: request.signal ?? new AbortController().signal
      });
      return Response.json(response.body, { status: response.status });
    }
  };
}
