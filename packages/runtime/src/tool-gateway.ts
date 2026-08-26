import type { AgentToolDescriptor, DataSourceSurface } from "@k-nex/contracts";

export interface ToolGatewayRequest {
  readonly correlationId: string;
  readonly rawRequest: unknown;
  readonly tool: { readonly id: string; readonly version: number };
  readonly surface: DataSourceSurface;
  readonly features: readonly string[];
  readonly input: unknown;
  readonly signal: AbortSignal;
  readonly idempotencyKey?: string;
}

export interface PrincipalAuthentication {
  readonly actor: unknown;
  readonly request: unknown;
  readonly authorizationContext: unknown;
}

export interface AgentClientAuthentication {
  readonly client: unknown;
  readonly session: unknown;
}

export interface ToolExecutionContext {
  readonly request: ToolGatewayRequest;
  readonly principal: PrincipalAuthentication;
  readonly agentClient: AgentClientAuthentication;
  readonly delegation: unknown;
  readonly descriptor: AgentToolDescriptor;
  readonly input: unknown;
  readonly authorization: unknown;
  readonly budget: unknown;
  readonly signal: AbortSignal;
  readonly approval?: unknown;
  readonly idempotency?: unknown;
}

export interface ToolBudgetLease {
  readonly context: unknown;
  readonly signal: AbortSignal;
  release(): void;
}

export interface ToolIdempotencyClaim {
  readonly context: unknown;
  readonly replay?: unknown;
  complete(result: unknown): void | Promise<void>;
  fail(): void | Promise<void>;
}

export interface PrincipalAuthenticator {
  authenticate(request: ToolGatewayRequest): PrincipalAuthentication | Promise<PrincipalAuthentication>;
}

export interface AgentClientAuthenticator {
  authenticate(request: ToolGatewayRequest, principal: PrincipalAuthentication): AgentClientAuthentication | Promise<AgentClientAuthentication>;
}

export interface DelegationEvaluator {
  evaluate(request: ToolGatewayRequest, principal: PrincipalAuthentication, client: AgentClientAuthentication): unknown | Promise<unknown>;
}

export interface ToolCatalogLookup {
  lookup(
    id: string,
    version: number,
    context: Readonly<{
      principal: PrincipalAuthentication;
      agentClient: AgentClientAuthentication;
      delegation: unknown;
      surface: DataSourceSurface;
      features: readonly string[];
    }>
  ): AgentToolDescriptor | undefined | Promise<AgentToolDescriptor | undefined>;
}

export interface ToolInputValidator {
  validate(descriptor: AgentToolDescriptor, input: unknown): unknown;
}

export interface ToolAuthorizationEvaluator {
  authorize(context: Omit<ToolExecutionContext, "authorization" | "budget" | "signal">): unknown | Promise<unknown>;
}

export interface ToolRiskBudgetEvaluator {
  evaluate(context: Omit<ToolExecutionContext, "budget" | "signal">): ToolBudgetLease | Promise<ToolBudgetLease>;
}

export interface ToolApprovalEvaluator {
  evaluate(context: ToolExecutionContext): unknown | Promise<unknown>;
  prepare(context: ToolExecutionContext): unknown | Promise<unknown>;
  submit(context: ToolExecutionContext, approval: unknown): unknown | Promise<unknown>;
}

export interface ToolIdempotencyCoordinator {
  claim(context: ToolExecutionContext): ToolIdempotencyClaim | Promise<ToolIdempotencyClaim>;
}

export interface SourceActionDispatcher {
  dispatch(context: ToolExecutionContext): unknown | Promise<unknown>;
}

export interface ToolOutputValidator {
  validate(descriptor: AgentToolDescriptor, output: unknown): unknown;
}

export interface ToolProjectionRedactor {
  redact(context: ToolExecutionContext, output: unknown): unknown | Promise<unknown>;
}

export interface ToolAuditDecorator {
  readonly beforeDispatch?: (context: ToolExecutionContext) => void | Promise<void>;
  success(context: ToolExecutionContext, result: ToolSuccessEnvelope): void | Promise<void>;
  failure(request: ToolGatewayRequest, error: ToolGatewayError, context?: ToolExecutionContext): void | Promise<void>;
}

export interface ToolProblemSerializer {
  serialize(error: ToolGatewayError, correlationId: string): ToolProblemDetails;
}

export interface ToolSuccessEnvelope {
  readonly schemaVersion: 1;
  readonly correlationId: string;
  readonly tool: { readonly id: string; readonly version: number };
  readonly provenance: "k-nex-tool";
  readonly trust: "structured-untrusted-content";
  readonly data: unknown;
}

export interface ToolProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly correlationId: string;
}

export type ToolGatewayResponse =
  | { readonly ok: true; readonly status: 200; readonly body: ToolSuccessEnvelope }
  | { readonly ok: false; readonly status: number; readonly body: ToolProblemDetails };

export type ToolPreparationResponse =
  | { readonly ok: true; readonly status: 200; readonly body: unknown }
  | { readonly ok: false; readonly status: number; readonly body: ToolProblemDetails };

export class ToolGatewayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    title: string,
    readonly safeDetail = title
  ) {
    super(title);
    this.name = "ToolGatewayError";
  }
}

function bounded(value: string, fallback: string, maximum: number): string {
  const normalized = value.trim();
  return (normalized === "" ? fallback : normalized).slice(0, maximum);
}

export class SafeToolProblemSerializer implements ToolProblemSerializer {
  serialize(error: ToolGatewayError, correlationId: string): ToolProblemDetails {
    const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "INTERNAL_ERROR";
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const title = bounded(error.message, "Tool request failed.", 120);
    return {
      type: `urn:k-nex:problem:${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      detail: bounded(error.safeDetail, title, 512),
      code,
      correlationId: bounded(correlationId, "unavailable", 128)
    };
  }
}

export interface ToolGatewayStages {
  readonly principal: PrincipalAuthenticator;
  readonly agentClient: AgentClientAuthenticator;
  readonly delegation: DelegationEvaluator;
  readonly catalog: ToolCatalogLookup;
  readonly input: ToolInputValidator;
  readonly authorization: ToolAuthorizationEvaluator;
  readonly budget: ToolRiskBudgetEvaluator;
  readonly approval: ToolApprovalEvaluator;
  readonly idempotency: ToolIdempotencyCoordinator;
  readonly dispatcher: SourceActionDispatcher;
  readonly output: ToolOutputValidator;
  readonly redactor: ToolProjectionRedactor;
  readonly audit: ToolAuditDecorator;
  readonly problem: ToolProblemSerializer;
}

function normalizedError(error: unknown): ToolGatewayError {
  return error instanceof ToolGatewayError
    ? error
    : new ToolGatewayError("INTERNAL_ERROR", 500, "Tool request failed.");
}

function correlationId(request: ToolGatewayRequest): string {
  return bounded(request.correlationId, "unavailable", 128);
}

function replayEnvelope(value: unknown, descriptor: AgentToolDescriptor): ToolSuccessEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).sort().join("\u0000") !== "correlationId\u0000data\u0000provenance\u0000schemaVersion\u0000tool\u0000trust") {
    throw new ToolGatewayError("IDEMPOTENCY_RESULT_INVALID", 500, "The idempotent result is invalid.");
  }
  const envelope = value as Partial<ToolSuccessEnvelope>;
  if (envelope.schemaVersion !== 1 || envelope.provenance !== "k-nex-tool" ||
    envelope.trust !== "structured-untrusted-content" || typeof envelope.correlationId !== "string" ||
    envelope.correlationId.length < 1 || envelope.correlationId.length > 128 ||
    typeof envelope.tool !== "object" || envelope.tool === null ||
    envelope.tool.id !== descriptor.id || envelope.tool.version !== descriptor.version) {
    throw new ToolGatewayError("IDEMPOTENCY_RESULT_INVALID", 500, "The idempotent result is invalid.");
  }
  return value as ToolSuccessEnvelope;
}

function abortedError(callerSignal: AbortSignal): ToolGatewayError {
  return callerSignal.aborted
    ? new ToolGatewayError("TOOL_CANCELLED", 499, "The tool request was cancelled.")
    : new ToolGatewayError("TOOL_TIMEOUT", 504, "The tool request timed out.");
}

async function dispatchWithSignal(
  dispatched: Promise<unknown>,
  signal: AbortSignal,
  callerSignal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) throw abortedError(callerSignal);
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(abortedError(callerSignal));
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    return await Promise.race([dispatched, aborted]);
  } finally {
    if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
  }
}

export class ToolExecutionGateway {
  constructor(private readonly stages: ToolGatewayStages) {}

  async execute(request: ToolGatewayRequest): Promise<ToolGatewayResponse> {
    let lease: ToolBudgetLease | undefined;
    let claim: ToolIdempotencyClaim | undefined;
    let executionContext: ToolExecutionContext | undefined;
    let dispatchStarted = false;
    try {
      const authorized = await this.authorize(request);
      lease = authorized.lease;
      executionContext = authorized.context;
      const approval = await this.stages.approval.evaluate(authorized.context);
      let context: ToolExecutionContext = Object.freeze({ ...authorized.context, approval });
      executionContext = context;
      claim = await this.stages.idempotency.claim(context);
      context = Object.freeze({ ...context, idempotency: claim.context });
      executionContext = context;
      if (context.signal.aborted || request.signal.aborted) {
        throw abortedError(request.signal);
      }
      if (claim.replay !== undefined) {
        const body = replayEnvelope(claim.replay, context.descriptor);
        await this.stages.audit.success(context, body);
        return { ok: true, status: 200, body };
      }
      if (this.stages.audit.beforeDispatch === undefined) {
        throw new ToolGatewayError("AUDIT_UNAVAILABLE", 503, "Tool audit is unavailable.");
      }
      await this.stages.audit.beforeDispatch(context);
      dispatchStarted = true;
      const handlerResult = this.stages.dispatcher.dispatch(context);
      const handlerLease = lease;
      lease = undefined;
      const handlerSettled = Promise.resolve(handlerResult).finally(() => handlerLease.release());
      const dispatched = await dispatchWithSignal(handlerSettled, context.signal, request.signal);
      const validated = this.stages.output.validate(context.descriptor, dispatched);
      const data = await this.stages.redactor.redact(context, validated);
      const body: ToolSuccessEnvelope = Object.freeze({
        schemaVersion: 1,
        correlationId: correlationId(request),
        tool: Object.freeze({ id: context.descriptor.id, version: context.descriptor.version }),
        provenance: "k-nex-tool",
        trust: "structured-untrusted-content",
        data
      });
      await claim.complete(body);
      await this.stages.audit.success(context, body);
      return { ok: true, status: 200, body };
    } catch (cause) {
      const error = normalizedError(cause);
      try {
        if (!dispatchStarted) await claim?.fail();
      } catch {
        // Idempotency cleanup cannot replace the safe failure.
      }
      try {
        await this.stages.audit.failure(request, error, executionContext);
      } catch {
        // Audit transport failure cannot replace the safe failure.
      }
      const body = this.stages.problem.serialize(error, correlationId(request));
      return { ok: false, status: body.status, body };
    } finally {
      lease?.release();
    }
  }

  async prepare(request: ToolGatewayRequest): Promise<ToolPreparationResponse> {
    let lease: ToolBudgetLease | undefined;
    let executionContext: ToolExecutionContext | undefined;
    try {
      const authorized = await this.authorize(request);
      lease = authorized.lease;
      executionContext = authorized.context;
      if (authorized.context.signal.aborted || request.signal.aborted) {
        throw abortedError(request.signal);
      }
      return { ok: true, status: 200, body: await this.stages.approval.prepare(authorized.context) };
    } catch (cause) {
      const error = normalizedError(cause);
      try {
        await this.stages.audit.failure(request, error, executionContext);
      } catch {
        // Audit transport failure cannot replace the safe failure.
      }
      const body = this.stages.problem.serialize(error, correlationId(request));
      return { ok: false, status: body.status, body };
    } finally {
      lease?.release();
    }
  }

  async submitApproval(request: ToolGatewayRequest, approval: unknown): Promise<ToolPreparationResponse> {
    let lease: ToolBudgetLease | undefined;
    let executionContext: ToolExecutionContext | undefined;
    try {
      const authorized = await this.authorize(request);
      lease = authorized.lease;
      executionContext = authorized.context;
      if (authorized.context.signal.aborted || request.signal.aborted) {
        throw abortedError(request.signal);
      }
      return { ok: true, status: 200, body: await this.stages.approval.submit(authorized.context, approval) };
    } catch (cause) {
      const error = normalizedError(cause);
      try {
        await this.stages.audit.failure(request, error, executionContext);
      } catch {
        // Audit transport failure cannot replace the safe failure.
      }
      const body = this.stages.problem.serialize(error, correlationId(request));
      return { ok: false, status: body.status, body };
    } finally {
      lease?.release();
    }
  }

  private async authorize(request: ToolGatewayRequest): Promise<Readonly<{ context: ToolExecutionContext; lease: ToolBudgetLease }>> {
    const principal = await this.stages.principal.authenticate(request);
    const agentClient = await this.stages.agentClient.authenticate(request, principal);
    const delegation = await this.stages.delegation.evaluate(request, principal, agentClient);
    const descriptor = await this.stages.catalog.lookup(request.tool.id, request.tool.version, Object.freeze({
      principal,
      agentClient,
      delegation,
      surface: request.surface,
      features: request.features
    }));
    if (descriptor === undefined) throw new ToolGatewayError("TOOL_NOT_FOUND", 404, "Tool was not found.");
    const input = this.stages.input.validate(descriptor, request.input);
    const beforeAuthorization = Object.freeze({ request, principal, agentClient, delegation, descriptor, input });
    const authorization = await this.stages.authorization.authorize(beforeAuthorization);
    const beforeBudget = Object.freeze({ ...beforeAuthorization, authorization });
    const lease = await this.stages.budget.evaluate(beforeBudget);
    return Object.freeze({ context: Object.freeze({ ...beforeBudget, budget: lease.context, signal: lease.signal }), lease });
  }
}
