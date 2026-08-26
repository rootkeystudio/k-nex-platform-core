import type { DataSourceDefinition, DataSourceDescriptor, DataSourceQueryControls, DataSourceSurface } from "@k-nex/contracts";
import { MetricScalarSchema, TableRecordsSchema } from "@k-nex/contracts";

export interface DataSourceHandlerRequest {
  readonly actor: unknown;
  readonly request: unknown;
  readonly input: unknown;
  readonly query: DataSourceQueryControls;
  readonly selectedFields: readonly string[];
  readonly recordScope: unknown;
  readonly signal: AbortSignal;
}

export type DataSourceHandler = (request: DataSourceHandlerRequest) => unknown | Promise<unknown>;

export interface RegisteredDataSource {
  readonly definition: DataSourceDefinition;
  readonly handler: DataSourceHandler;
}

export interface DataSourceGatewayRequest {
  readonly correlationId: string;
  readonly rawRequest: unknown;
  readonly sourceId: string;
  readonly surface: DataSourceSurface;
  readonly input: unknown;
  readonly query: unknown;
  readonly selectedFields: readonly string[];
  readonly signal: AbortSignal;
}

export interface AuthenticatedDataSourceRequest {
  readonly actor: unknown;
  readonly request: unknown;
  readonly authorizationContext: unknown;
}

export interface AuthorizedDataSourceQuery {
  readonly selectedFields: readonly string[];
  readonly recordScope: unknown;
}

export interface BudgetedDataSourceQuery {
  readonly input: unknown;
  readonly controls: DataSourceQueryControls;
  readonly signal: AbortSignal;
  readonly lease: QueryBudgetLease;
}

export interface QueryBudgetLease {
  release(): void;
}

export interface ExecutableDataSourceQuery extends AuthorizedDataSourceQuery {
  readonly input: unknown;
  readonly controls: DataSourceQueryControls;
}

export interface DataSourceExecutionContext {
  readonly correlationId: string;
  readonly source: RegisteredDataSource;
  readonly surface: DataSourceSurface;
  readonly authenticated: AuthenticatedDataSourceRequest;
  readonly query: ExecutableDataSourceQuery;
  readonly signal: AbortSignal;
}

export interface DataSourceSuccessEnvelope {
  readonly schemaVersion: 1;
  readonly source: { readonly id: string; readonly version: number };
  readonly contract: { readonly id: "metric.scalar" | "table.records"; readonly version: 1 };
  readonly structuralCompatibilityHash: string;
  readonly data: unknown;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly correlationId: string;
}

export type DataSourceGatewayResponse =
  | { readonly ok: true; readonly status: 200; readonly body: DataSourceSuccessEnvelope }
  | { readonly ok: false; readonly status: number; readonly body: ProblemDetails };

export interface RequestAuthenticator {
  authenticate(request: DataSourceGatewayRequest): AuthenticatedDataSourceRequest | Promise<AuthenticatedDataSourceRequest>;
}

export interface SourceCatalog {
  lookup(sourceId: string): RegisteredDataSource | undefined | Promise<RegisteredDataSource | undefined>;
}

export interface SurfaceAudienceGuard {
  assertAllowed(source: RegisteredDataSource, surface: DataSourceSurface, authenticated: AuthenticatedDataSourceRequest): void | Promise<void>;
}

export interface AuthorizationEvaluator {
  authorize(
    source: RegisteredDataSource,
    request: DataSourceGatewayRequest,
    authenticated: AuthenticatedDataSourceRequest
  ): AuthorizedDataSourceQuery | Promise<AuthorizedDataSourceQuery>;
}

export interface QueryBudgetEvaluator {
  evaluate(
    source: RegisteredDataSource,
    request: DataSourceGatewayRequest,
    authenticated: AuthenticatedDataSourceRequest,
    authorized: AuthorizedDataSourceQuery
  ): BudgetedDataSourceQuery | Promise<BudgetedDataSourceQuery>;
  assertResult(source: RegisteredDataSource, value: unknown): void;
}

export interface HandlerDispatcher {
  dispatch(context: DataSourceExecutionContext): unknown | Promise<unknown>;
}

export interface SourceSchemaValidator {
  validate(definition: DataSourceDefinition, value: unknown): unknown;
}

export interface OutputContractValidator {
  validate(descriptor: DataSourceDescriptor, value: unknown): unknown;
}

export interface ProjectionRedactor {
  redact(context: DataSourceExecutionContext, value: unknown): unknown | Promise<unknown>;
}

export interface CachePolicyEvaluator {
  apply(context: DataSourceExecutionContext, envelope: DataSourceSuccessEnvelope): void | Promise<void>;
}

export interface GatewayErrorObservation {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string;
}

export interface ObservabilityDecorator {
  success(context: DataSourceExecutionContext, envelope: DataSourceSuccessEnvelope): void | Promise<void>;
  failure(observation: GatewayErrorObservation): void | Promise<void>;
}

export interface ProblemDetailsSerializer {
  serialize(error: DataSourceGatewayError, correlationId: string): ProblemDetails;
}

export class DataSourceGatewayError extends Error {
  readonly code: string;
  readonly status: number;
  readonly safeDetail: string;

  constructor(code: string, status: number, title: string, safeDetail = title) {
    super(title);
    this.name = "DataSourceGatewayError";
    this.code = code;
    this.status = status;
    this.safeDetail = safeDetail;
  }
}

function bounded(value: string, fallback: string, maximum: number): string {
  const normalized = value.trim();
  return (normalized === "" ? fallback : normalized).slice(0, maximum);
}

export class SafeProblemDetailsSerializer implements ProblemDetailsSerializer {
  serialize(error: DataSourceGatewayError, correlationId: string): ProblemDetails {
    const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "INTERNAL_ERROR";
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const title = bounded(error.message, "Data-source request failed.", 120);
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

export class RegisteredHandlerDispatcher implements HandlerDispatcher {
  dispatch(context: DataSourceExecutionContext): unknown | Promise<unknown> {
    return context.source.handler({
      actor: context.authenticated.actor,
      request: context.authenticated.request,
      input: context.query.input,
      query: context.query.controls,
      selectedFields: context.query.selectedFields,
      recordScope: context.query.recordScope,
      signal: context.signal
    });
  }
}

export class DefinitionSourceSchemaValidator implements SourceSchemaValidator {
  validate(definition: DataSourceDefinition, value: unknown): unknown {
    const result = definition.outputSchema.safeParse(value);
    if (!result.success) throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Data source returned invalid output.");
    return result.data;
  }
}

export class CanonicalOutputContractValidator implements OutputContractValidator {
  validate(descriptor: DataSourceDescriptor, value: unknown): unknown {
    const schema = descriptor.primaryContract.id === "metric.scalar" ? MetricScalarSchema : TableRecordsSchema;
    const result = schema.safeParse(value);
    if (!result.success) throw new DataSourceGatewayError("INVALID_OUTPUT_CONTRACT", 500, "Data source violated its output contract.");
    return result.data;
  }
}

export interface DataSourceGatewayStages {
  readonly authenticator: RequestAuthenticator;
  readonly catalog: SourceCatalog;
  readonly surfaceAudience: SurfaceAudienceGuard;
  readonly authorization: AuthorizationEvaluator;
  readonly budget: QueryBudgetEvaluator;
  readonly dispatcher: HandlerDispatcher;
  readonly sourceSchema: SourceSchemaValidator;
  readonly outputContract: OutputContractValidator;
  readonly redactor: ProjectionRedactor;
  readonly cache: CachePolicyEvaluator;
  readonly observability: ObservabilityDecorator;
  readonly problemDetails: ProblemDetailsSerializer;
}

function normalizedError(error: unknown): DataSourceGatewayError {
  return error instanceof DataSourceGatewayError
    ? error
    : new DataSourceGatewayError("INTERNAL_ERROR", 500, "Data-source request failed.");
}

function abortedError(callerSignal: AbortSignal): DataSourceGatewayError {
  return callerSignal.aborted
    ? new DataSourceGatewayError("QUERY_CANCELLED", 499, "The query was cancelled.")
    : new DataSourceGatewayError("QUERY_TIMEOUT", 504, "The data-source query timed out.");
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

export class DataSourceGateway {
  constructor(private readonly stages: DataSourceGatewayStages) {}

  async query(request: DataSourceGatewayRequest): Promise<DataSourceGatewayResponse> {
    const correlationId = bounded(request.correlationId, "unavailable", 128);
    let lease: QueryBudgetLease | undefined;
    try {
      const authenticated = await this.stages.authenticator.authenticate(request);
      const source = await this.stages.catalog.lookup(request.sourceId);
      if (source === undefined) throw new DataSourceGatewayError("SOURCE_NOT_FOUND", 404, "Data source was not found.");
      await this.stages.surfaceAudience.assertAllowed(source, request.surface, authenticated);
      const authorized = await this.stages.authorization.authorize(source, request, authenticated);
      const budgeted = await this.stages.budget.evaluate(source, request, authenticated, authorized);
      lease = budgeted.lease;
      const parsedInput = source.definition.inputSchema.safeParse(budgeted.input);
      if (!parsedInput.success) throw new DataSourceGatewayError("INVALID_QUERY_INPUT", 400, "Data-source input is invalid.");
      const query: ExecutableDataSourceQuery = {
        input: parsedInput.data,
        controls: budgeted.controls,
        selectedFields: authorized.selectedFields,
        recordScope: authorized.recordScope
      };
      const context: DataSourceExecutionContext = {
        correlationId,
        source,
        surface: request.surface,
        authenticated,
        query,
        signal: budgeted.signal
      };
      if (context.signal.aborted) throw abortedError(request.signal);
      const handlerResult = this.stages.dispatcher.dispatch(context);
      const handlerLease = lease;
      lease = undefined;
      const handlerSettled = Promise.resolve(handlerResult).finally(() => handlerLease?.release());
      const dispatched = await dispatchWithSignal(handlerSettled, context.signal, request.signal);
      const sourceValid = this.stages.sourceSchema.validate(source.definition, dispatched);
      const contractValid = this.stages.outputContract.validate(source.definition.descriptor, sourceValid);
      const data = await this.stages.redactor.redact(context, contractValid);
      this.stages.budget.assertResult(source, data);
      const descriptor = source.definition.descriptor;
      const envelope: DataSourceSuccessEnvelope = {
        schemaVersion: 1,
        source: { id: descriptor.id, version: descriptor.version },
        contract: descriptor.primaryContract,
        structuralCompatibilityHash: descriptor.structuralCompatibilityHash,
        data
      };
      await this.stages.cache.apply(context, envelope);
      try {
        await this.stages.observability.success(context, envelope);
      } catch {
        // Observability cannot change an already validated response.
      }
      return { ok: true, status: 200, body: envelope };
    } catch (cause) {
      const error = normalizedError(cause);
      try {
        await this.stages.observability.failure({ code: error.code, status: error.status, correlationId });
      } catch {
        // Error reporting cannot replace the safe problem response.
      }
      const body = this.stages.problemDetails.serialize(error, correlationId);
      return { ok: false, status: body.status, body };
    } finally {
      lease?.release();
    }
  }
}
