import { assertExecutableRegistrationAuthority, type ScopedRegistrationResult } from "./plugin-lifecycle.js";
import { isActionDefinition, type ActionDefinition, type ActionHandler } from "./action.js";

export interface ActionGatewayRequest {
  readonly correlationId: string;
  readonly rawRequest: unknown;
  readonly actionId: string;
  readonly input: unknown;
  readonly idempotencyKey?: string;
  readonly signal: AbortSignal;
}

export interface AuthenticatedActionRequest {
  readonly actor: unknown;
  readonly request: unknown;
  readonly authorizationContext: unknown;
}

export interface ActionGatewayAuthenticator {
  authenticate(request: ActionGatewayRequest): AuthenticatedActionRequest | Promise<AuthenticatedActionRequest>;
}

export interface ActionGatewayPolicy {
  authorize(context: {
    readonly action: ActionDefinition;
    readonly input: unknown;
    readonly authenticated: AuthenticatedActionRequest;
  }): unknown | Promise<unknown>;
}

export class ActionGatewayError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ActionGatewayError";
  }
}

export type ActionGatewayResponse =
  | { readonly ok: true; readonly status: 200; readonly body: { readonly action: { readonly id: string; readonly version: number }; readonly data: unknown } }
  | { readonly ok: false; readonly status: number; readonly body: { readonly code: string; readonly status: number; readonly detail: string; readonly correlationId: string } };

function knownAction(registration: ScopedRegistrationResult, actionId: string): { definition: ActionDefinition; handler: ActionHandler } {
  try { assertExecutableRegistrationAuthority(registration); } catch {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Action execution is forbidden until lifecycle availability is reconciled.");
  }
  const contribution = registration.contributions.actions.find((entry) => entry.id === actionId);
  const binding = registration.bindings.actions.find((entry) => entry.id === actionId);
  if (contribution === undefined || binding === undefined || contribution.pluginId !== binding.pluginId ||
    !isActionDefinition(contribution.value) || contribution.value.descriptor.id !== actionId ||
    contribution.value.descriptor.ownerPluginId !== contribution.pluginId || typeof binding.value !== "function") {
    throw new ActionGatewayError("ACTION_NOT_FOUND", 404, "Action is not available.");
  }
  return { definition: contribution.value, handler: binding.value as ActionHandler };
}

function failure(error: unknown, correlationId: string): ActionGatewayResponse {
  const known = error instanceof ActionGatewayError ? error : new ActionGatewayError("ACTION_FAILED", 500, "Action execution failed.");
  return {
    ok: false,
    status: known.status,
    body: { code: known.code, status: known.status, detail: known.message, correlationId: correlationId.slice(0, 128) }
  };
}

export class RegisteredActionGateway {
  constructor(
    private readonly registration: ScopedRegistrationResult,
    private readonly authenticator: ActionGatewayAuthenticator,
    private readonly policy: ActionGatewayPolicy
  ) {}

  async execute(request: ActionGatewayRequest): Promise<ActionGatewayResponse> {
    try {
      const { definition, handler } = knownAction(this.registration, request.actionId);
      if (definition.descriptor.idempotency === "required" && (request.idempotencyKey === undefined || request.idempotencyKey.trim() === "")) {
        throw new ActionGatewayError("IDEMPOTENCY_KEY_REQUIRED", 400, "Action requires an idempotency key.");
      }
      const parsedInput = definition.inputSchema.safeParse(request.input);
      if (!parsedInput.success) throw new ActionGatewayError("ACTION_INPUT_INVALID", 400, "Action input is invalid.");
      const authenticated = await this.authenticator.authenticate(request);
      const authorizationDecision = await this.policy.authorize({ action: definition, input: parsedInput.data, authenticated });
      if (request.signal.aborted) throw new ActionGatewayError("ACTION_CANCELLED", 499, "Action was cancelled.");
      const output = await handler({
        actor: authenticated.actor,
        request: authenticated.request,
        authorizationContext: authorizationDecision,
        input: parsedInput.data,
        signal: request.signal,
        ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey })
      });
      const parsedOutput = definition.outputSchema.safeParse(output);
      if (!parsedOutput.success) throw new ActionGatewayError("ACTION_OUTPUT_INVALID", 500, "Action output is invalid.");
      return { ok: true, status: 200, body: { action: { id: definition.descriptor.id, version: definition.descriptor.version }, data: parsedOutput.data } };
    } catch (error) {
      return failure(error, request.correlationId);
    }
  }
}
