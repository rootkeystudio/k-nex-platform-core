import { describe, expect, it } from "vitest";

import { MetricScalarSchema, type DataSourceDefinition } from "@k-nex/contracts";

import {
  CanonicalOutputContractValidator,
  DataSourceGateway,
  DataSourceGatewayError,
  DefinitionSourceSchemaValidator,
  RegisteredHandlerDispatcher,
  SafeProblemDetailsSerializer,
  type DataSourceGatewayStages,
  type DataSourceSuccessEnvelope,
  type GatewayErrorObservation
} from "../src/index.js";

const metricValue = { value: { kind: "integer", value: 7 } } as const;
const emptyInputSchema = {
  safeParse(value: unknown) {
    const success = typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
    return success ? { success: true as const, data: {} } : { success: false as const, error: "Expected an empty object." };
  }
};

const definition: DataSourceDefinition = {
  descriptor: {
    id: "sales.total-potential-revenue",
    version: 2,
    ownerPluginId: "module.sales",
    primaryContract: { id: "metric.scalar", version: 1 },
    sourceSchema: { id: "sales.total-potential-revenue.output", version: 3 },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "sales.revenue.read",
    structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
    presentationMetadataRevision: 1,
    title: "Total potential revenue",
    inputFields: [],
    limits: {
      maxSelectedFields: 1,
      maxPageSize: 1,
      maxFilters: 0,
      maxSorts: 0,
      maxBodyBytes: 1_024,
      maxResultBytes: 4_096,
      maxDepth: 4,
      timeoutMs: 1_000,
      maxConcurrency: 2,
      ratePerMinute: 60,
      burst: 10,
      costClass: "low",
      maxCost: 10
    },
    cacheClass: "actor"
  },
  inputSchema: emptyInputSchema,
  outputSchema: MetricScalarSchema
};

const abort = new AbortController();
const request = {
  correlationId: "corr-1",
  rawRequest: { authorization: "secret-token" },
  sourceId: definition.descriptor.id,
  surface: "workspace" as const,
  input: { unsafe: true },
  query: {},
  selectedFields: ["secret"],
  signal: abort.signal
};

type StageName =
  | "authenticate"
  | "catalog"
  | "surface"
  | "authorize"
  | "budget"
  | "dispatch"
  | "source-schema"
  | "output-contract"
  | "redact"
  | "result-budget"
  | "cache-lookup"
  | "cache-store";

function recordingStages(trace: string[], failAt?: StageName): DataSourceGatewayStages {
  const step = (name: StageName): void => {
    trace.push(name);
    if (name === failAt) throw new Error("secret-stage-failure");
  };

  return {
    authenticator: {
      authenticate() {
        step("authenticate");
        return { actor: { id: "user-1" }, request: { payload: "opaque" }, authorizationContext: { revision: "r1" } };
      }
    },
    catalog: {
      lookup() {
        step("catalog");
        return { definition, handler: () => metricValue };
      }
    },
    surfaceAudience: { assertAllowed() { step("surface"); } },
    authorization: {
      authorize() {
        step("authorize");
        return { selectedFields: ["authorized"], recordScope: { tenantId: "tenant-1" } };
      }
    },
    budget: {
      evaluate(_source, gatewayRequest, _authenticated, authorized) {
        step("budget");
        expect(authorized.selectedFields).toEqual(["authorized"]);
        return {
          input: {},
          controls: { filters: [], sort: [] },
          signal: gatewayRequest.signal,
          lease: { release() {} }
        };
      },
      assertResult() { step("result-budget"); }
    },
    dispatcher: { dispatch() { step("dispatch"); return metricValue; } },
    sourceSchema: { validate(_definition, value) { step("source-schema"); return value; } },
    outputContract: { validate(_descriptor, value) { step("output-contract"); return value; } },
    redactor: { redact(_context, value) { step("redact"); return value; } },
    cache: {
      lookup() { step("cache-lookup"); return undefined; },
      store() { step("cache-store"); }
    },
    observability: {
      success() { trace.push("observe-success"); },
      failure() { trace.push("observe-failure"); }
    },
    problemDetails: {
      serialize(error, correlationId) {
        trace.push("problem");
        return new SafeProblemDetailsSerializer().serialize(error, correlationId);
      }
    }
  };
}

describe("P2.3 staged data-source gateway", () => {
  it("executes the secure stages in exact order", async () => {
    const trace: string[] = [];
    const result = await new DataSourceGateway(recordingStages(trace)).query(request);

    expect(result.ok).toBe(true);
    expect(trace).toEqual([
      "authenticate",
      "catalog",
      "surface",
      "authorize",
      "budget",
      "cache-lookup",
      "dispatch",
      "source-schema",
      "output-contract",
      "redact",
      "result-budget",
      "cache-store",
      "observe-success"
    ]);
    if (result.ok) {
      expect(result.body).toEqual({
        schemaVersion: 1,
        source: { id: definition.descriptor.id, version: 2 },
        contract: { id: "metric.scalar", version: 1 },
        structuralCompatibilityHash: definition.descriptor.structuralCompatibilityHash,
        data: metricValue
      });
    }
  });

  it.each<StageName>([
    "authenticate",
    "catalog",
    "surface",
    "authorize",
    "budget",
    "dispatch",
    "source-schema",
    "output-contract",
    "redact",
    "result-budget",
    "cache-lookup",
    "cache-store"
  ])("short-circuits safely when %s fails", async (failedStage) => {
    const trace: string[] = [];
    const result = await new DataSourceGateway(recordingStages(trace, failedStage)).query(request);

    expect(result.ok).toBe(false);
    expect(trace.at(-2)).toBe("observe-failure");
    expect(trace.at(-1)).toBe("problem");
    expect(JSON.stringify(result)).not.toContain("secret-stage-failure");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    if (!result.ok) expect(result.body.code).toBe("INTERNAL_ERROR");
  });

  it("passes only authorized, budgeted input to the registered handler", async () => {
    let received: unknown;
    const handler = (value: unknown) => { received = value; return metricValue; };
    const base = recordingStages([]);
    const stages: DataSourceGatewayStages = {
      ...base,
      catalog: { lookup: () => ({ definition, handler }) },
      dispatcher: new RegisteredHandlerDispatcher()
    };

    const result = await new DataSourceGateway(stages).query(request);
    expect(result.ok).toBe(true);
    expect(received).toMatchObject({
      input: {},
      query: { filters: [], sort: [] },
      selectedFields: ["authorized"],
      recordScope: { tenantId: "tenant-1" },
      signal: abort.signal
    });
    expect(received).not.toMatchObject({ input: request.input, selectedFields: request.selectedFields });
  });

  it("returns cache hits before dispatch and releases the query lease", async () => {
    let dispatched = false;
    let releases = 0;
    const stages = recordingStages([]);
    stages.budget.evaluate = (_source, gatewayRequest) => ({
      input: {},
      controls: { filters: [], sort: [] },
      signal: gatewayRequest.signal,
      lease: { release: () => { releases += 1; } }
    });
    stages.cache.lookup = () => ({
      schemaVersion: 1,
      source: { id: definition.descriptor.id, version: definition.descriptor.version },
      contract: definition.descriptor.primaryContract,
      structuralCompatibilityHash: definition.descriptor.structuralCompatibilityHash,
      data: metricValue
    });
    stages.dispatcher.dispatch = () => { dispatched = true; return metricValue; };

    const result = await new DataSourceGateway(stages).query(request);
    expect(result.ok).toBe(true);
    expect(dispatched).toBe(false);
    expect(releases).toBe(1);
  });

  it("rejects invalid input and cannot let budgets expand authorized fields", async () => {
    let dispatched = false;
    const invalidStages = recordingStages([]);
    invalidStages.budget.evaluate = (_source, gatewayRequest) => ({
      input: { undeclared: true },
      controls: { filters: [], sort: [] },
      signal: gatewayRequest.signal,
      lease: { release() {} }
    });
    invalidStages.dispatcher.dispatch = () => { dispatched = true; return metricValue; };
    const invalid = await new DataSourceGateway(invalidStages).query(request);
    expect(invalid.ok).toBe(false);
    expect(dispatched).toBe(false);
    if (!invalid.ok) expect(invalid.body.code).toBe("INVALID_QUERY_INPUT");

    let selectedFields: readonly string[] = [];
    const expandedStages = recordingStages([]);
    expandedStages.budget.evaluate = (_source, gatewayRequest) => ({
      input: {},
      controls: { filters: [], sort: [] },
      signal: gatewayRequest.signal,
      lease: { release() {} },
      selectedFields: ["secret"]
    } as never);
    expandedStages.dispatcher.dispatch = (context) => { selectedFields = context.query.selectedFields; return metricValue; };
    expect((await new DataSourceGateway(expandedStages).query(request)).ok).toBe(true);
    expect(selectedFields).toEqual(["authorized"]);
  });

  it("enforces timeout/cancellation even when handlers ignore signals and releases leases", async () => {
    let releases = 0;
    const timeoutStages = recordingStages([]);
    timeoutStages.budget.evaluate = () => ({
      input: {},
      controls: { filters: [], sort: [] },
      signal: AbortSignal.timeout(1),
      lease: { release: () => { releases += 1; } }
    });
    let finishTimedOut: (() => void) | undefined;
    timeoutStages.dispatcher.dispatch = () => new Promise<void>((resolve) => { finishTimedOut = resolve; });
    const timeout = await new DataSourceGateway(timeoutStages).query(request);
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.body.code).toBe("QUERY_TIMEOUT");
    expect(releases).toBe(0);
    finishTimedOut?.();
    await Promise.resolve();
    expect(releases).toBe(1);

    const caller = new AbortController();
    const cancelledStages = recordingStages([]);
    cancelledStages.budget.evaluate = () => ({
      input: {},
      controls: { filters: [], sort: [] },
      signal: caller.signal,
      lease: { release: () => { releases += 1; } }
    });
    let finishCancelled: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    cancelledStages.dispatcher.dispatch = () => new Promise<void>((resolve) => {
      finishCancelled = resolve;
      markStarted?.();
    });
    const pending = new DataSourceGateway(cancelledStages).query({ ...request, signal: caller.signal });
    await started;
    caller.abort();
    const cancelled = await pending;
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.body.code).toBe("QUERY_CANCELLED");
    expect(releases).toBe(1);
    finishCancelled?.();
    await Promise.resolve();
    expect(releases).toBe(2);
  });

  it("validates the exact source schema before the canonical contract", () => {
    const source = new DefinitionSourceSchemaValidator();
    const contract = new CanonicalOutputContractValidator();

    expect(source.validate(definition, metricValue)).toEqual(metricValue);
    expect(() => source.validate(definition, { ...metricValue, undeclared: true })).toThrowError(DataSourceGatewayError);
    expect(contract.validate(definition.descriptor, metricValue)).toEqual(metricValue);
    expect(() => contract.validate(definition.descriptor, { value: { kind: "integer", value: 1 }, extensions: {} })).toThrowError(DataSourceGatewayError);
  });

  it("fails closed for an unknown source and normalizes malformed problem metadata", async () => {
    let dispatched = false;
    const stages = recordingStages([]);
    stages.catalog.lookup = () => undefined;
    stages.dispatcher.dispatch = () => { dispatched = true; return metricValue; };
    const missing = await new DataSourceGateway(stages).query(request);
    expect(missing.ok).toBe(false);
    expect(dispatched).toBe(false);
    if (!missing.ok) expect(missing.body.code).toBe("SOURCE_NOT_FOUND");

    const malformed = new SafeProblemDetailsSerializer().serialize(
      new DataSourceGatewayError("invalid code", 200, "x".repeat(200), "y".repeat(700)),
      "c".repeat(200)
    );
    expect(malformed.code).toBe("INTERNAL_ERROR");
    expect(malformed.status).toBe(500);
    expect(malformed.title).toHaveLength(120);
    expect(malformed.detail).toHaveLength(512);
    expect(malformed.correlationId).toHaveLength(128);
  });

  it("allows only redacted data into cache, success observation, and response", async () => {
    const secret = "unauthorized-secret";
    const seen: unknown[] = [];
    const stages = recordingStages([]);
    stages.outputContract.validate = (_descriptor, value) => value;
    stages.dispatcher.dispatch = () => ({ title: "Task", secret });
    stages.sourceSchema.validate = (_definition, value) => value;
    stages.redactor.redact = (_context, value) => {
      const { title } = value as { title: string };
      return { title };
    };
    stages.cache.store = (_context, envelope) => { seen.push(envelope); };
    stages.observability.success = (_context, envelope) => { seen.push(envelope); };

    const result = await new DataSourceGateway(stages).query(request);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("exposes only bounded RFC 9457 data for unknown failures", async () => {
    const observations: GatewayErrorObservation[] = [];
    const stages = recordingStages([]);
    stages.dispatcher.dispatch = () => { throw new Error("database password=secret"); };
    stages.observability.failure = (observation) => { observations.push(observation); };

    const result = await new DataSourceGateway(stages).query({ ...request, correlationId: "c".repeat(200) });
    expect(result.ok).toBe(false);
    expect(observations).toEqual([{ code: "INTERNAL_ERROR", status: 500, correlationId: "c".repeat(128) }]);
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("secret");
    if (!result.ok) {
      expect(result.body.type).toBe("urn:k-nex:problem:internal-error");
      expect(result.body.correlationId).toHaveLength(128);
      expect(result.body.status).toBe(500);
    }
  });

  it("does not let observation failures replace validated responses", async () => {
    const stages = recordingStages([]);
    stages.observability.success = () => { throw new Error("telemetry unavailable"); };
    expect((await new DataSourceGateway(stages).query(request)).ok).toBe(true);

    stages.dispatcher.dispatch = () => { throw new DataSourceGatewayError("FORBIDDEN", 403, "Forbidden."); };
    stages.observability.failure = () => { throw new Error("telemetry unavailable"); };
    const failure = await new DataSourceGateway(stages).query(request);
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.body.code).toBe("FORBIDDEN");
  });

  it("never lets the cache stage replace the validated envelope", async () => {
    let cached: DataSourceSuccessEnvelope | undefined;
    const stages = recordingStages([]);
    stages.cache.store = (_context, envelope) => { cached = envelope; };
    const result = await new DataSourceGateway(stages).query(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe(cached);
  });
});
