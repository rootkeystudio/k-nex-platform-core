import type {
  ToolAuditDecorator,
  ToolExecutionContext,
  ToolGatewayError,
  ToolGatewayRequest,
  ToolSuccessEnvelope
} from "./tool-gateway.js";

export interface ToolAuditIdentity {
  readonly principalId?: string;
  readonly agentClientId?: string;
  readonly agentSessionId?: string;
  readonly delegationId?: string;
  readonly approvalId?: string;
  readonly idempotencyReference?: string;
  readonly inputDigest?: string;
}

export interface ToolAuditIdentityResolver {
  resolve(request: ToolGatewayRequest, context?: ToolExecutionContext): ToolAuditIdentity;
}

export interface ToolAuditClock {
  now(): number;
}

export interface ToolAuditRecord {
  readonly occurredAtEpochMs: number;
  readonly correlationId: string;
  readonly tool: { readonly id: string; readonly version: number; readonly ownerPluginId?: string };
  readonly category?: string;
  readonly principalId?: string;
  readonly agentClientId?: string;
  readonly agentSessionId?: string;
  readonly delegationId?: string;
  readonly approvalId?: string;
  readonly idempotencyReference?: string;
  readonly inputDigest?: string;
  readonly hasIdempotencyKey: boolean;
  readonly outcome: "attempt" | "success" | "failure";
  readonly code: string;
}

export interface ToolAuditSink {
  write(record: ToolAuditRecord): void | Promise<void>;
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : undefined;
}

function safeDigest(value: unknown): string | undefined {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value) ? value : undefined;
}

export class SafeToolAuditDecorator implements ToolAuditDecorator {
  constructor(
    private readonly clock: ToolAuditClock,
    private readonly identities: ToolAuditIdentityResolver,
    private readonly sink: ToolAuditSink
  ) {}

  beforeDispatch(context: ToolExecutionContext): void | Promise<void> {
    return this.write(context.request, "attempt", "DISPATCH_ATTEMPT", context);
  }

  success(context: ToolExecutionContext, _result: ToolSuccessEnvelope): void | Promise<void> {
    return this.write(context.request, "success", "OK", context);
  }

  failure(request: ToolGatewayRequest, error: ToolGatewayError, context?: ToolExecutionContext): void | Promise<void> {
    return this.write(request, "failure", safeId(error.code) ?? "INTERNAL_ERROR", context);
  }

  private write(
    request: ToolGatewayRequest,
    outcome: ToolAuditRecord["outcome"],
    code: string,
    context?: ToolExecutionContext
  ): void | Promise<void> {
    const now = this.clock.now();
    if (!Number.isSafeInteger(now)) throw new TypeError("Tool audit clock must return a safe integer.");
    const identity = this.identities.resolve(request, context);
    const descriptor = context?.descriptor;
    const ownerPluginId = safeId(descriptor?.ownerPluginId);
    const category = safeId(descriptor?.audit.category);
    const principalId = safeId(identity.principalId);
    const agentClientId = safeId(identity.agentClientId);
    const agentSessionId = safeId(identity.agentSessionId);
    const delegationId = safeId(identity.delegationId);
    const approvalId = safeId(identity.approvalId);
    const idempotencyReference = safeDigest(identity.idempotencyReference);
    const digest = safeDigest(identity.inputDigest);
    const record: ToolAuditRecord = Object.freeze({
      occurredAtEpochMs: now,
      correlationId: safeId(request.correlationId) ?? "unavailable",
      tool: Object.freeze({
        id: safeId(descriptor?.id ?? request.tool.id) ?? "unavailable",
        version: Number.isSafeInteger(descriptor?.version ?? request.tool.version) ? (descriptor?.version ?? request.tool.version) : 0,
        ...(ownerPluginId === undefined ? {} : { ownerPluginId })
      }),
      ...(category === undefined ? {} : { category }),
      ...(principalId === undefined ? {} : { principalId }),
      ...(agentClientId === undefined ? {} : { agentClientId }),
      ...(agentSessionId === undefined ? {} : { agentSessionId }),
      ...(delegationId === undefined ? {} : { delegationId }),
      ...(approvalId === undefined ? {} : { approvalId }),
      ...(idempotencyReference === undefined ? {} : { idempotencyReference }),
      ...(digest === undefined ? {} : { inputDigest: digest }),
      hasIdempotencyKey: request.idempotencyKey !== undefined,
      outcome,
      code
    });
    return this.sink.write(record);
  }
}
