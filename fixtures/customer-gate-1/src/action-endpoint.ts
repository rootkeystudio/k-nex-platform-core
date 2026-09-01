import {
  ActionGatewayError,
  CurrentAuthorityActionGatewayPolicy,
  RegisteredActionGateway,
  type AuthenticatedActionRequest,
  type ScopedRegistrationResult
} from "@k-nex/runtime";
import { createPayloadPersistenceCapability, CurrentAuthorityPayloadPersistenceAuthorizer } from "@k-nex/payload-adapter";
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority } from "./current-authority.js";

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

async function authorize(actionId: string, input: unknown, authenticated: AuthenticatedActionRequest): Promise<unknown> {
  const details = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  if (actionId === "sales.task.create") return Object.freeze({ actionId, operation: "create" });
  const id = details.id;
  if (typeof id !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action target is forbidden.");
  const context = authenticated.request as CapabilityRequest;
  const collection = actionId === "sales.task.update" ? "sales-tasks" : actionId === "sales.opportunity.stage.update" ? "sales-opportunities" : undefined;
  const scope = {};
  if (collection === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action is forbidden.");
  const result = await context.payload.find({
    collection,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { id: { equals: id } }
  });
  if (docs(result).length !== 1) throw new ActionGatewayError("ACTION_TARGET_FORBIDDEN", 403, "Action target is forbidden.");
  return Object.freeze({ actionId, resourceId: id, scope });
}

export function createActionEndpoint(registration: ScopedRegistrationResult, authority: FixtureCurrentAuthority): Endpoint {
  const policy = new CurrentAuthorityActionGatewayPolicy(
    authority.adapter,
    ({ authenticated }) => authenticated.authorizationContext as FixtureAuthorityContext,
    (action, input) => authority.action(action, input),
    { authorize: ({ action, input, authenticated }) => authorize(action.descriptor.id, input, authenticated) }
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
