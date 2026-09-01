import type { DataSourceDefinition } from "@k-nex/contracts";
import {
  BoundedQueryBudgetEvaluator,
  CanonicalOutputContractValidator,
  CurrentAuthorityDataSourcePolicy,
  DataSourceGateway,
  DataSourceGatewayError,
  DefinitionSourceSchemaValidator,
  DescriptorSurfaceAudienceGuard,
  InMemoryDataSourceCachePolicy,
  PolicyAuthorizationEvaluator,
  RegisteredHandlerDispatcher,
  SafeProblemDetailsSerializer,
  TableProjectionRedactor,
  type DataSourceHandler,
  type DataSourcePolicyService,
  type RegistrationResult,
  type RegisteredDataSource
} from "@k-nex/runtime";
import { createPayloadPersistenceCapability, CurrentAuthorityPayloadPersistenceAuthorizer, PayloadRequestAuthenticator } from "@k-nex/payload-adapter";
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority } from "./current-authority.js";

interface QueryBody {
  readonly sourceId?: unknown;
  readonly surface?: unknown;
  readonly input?: unknown;
  readonly query?: unknown;
  readonly selectedFields?: unknown;
}

function catalog(registration: RegistrationResult) {
  const definitions = new Map(registration.contributions.sources
    .map((entry) => [entry.id, entry.value as DataSourceDefinition]));
  const handlers = new Map(registration.bindings.sources.map((entry) => [entry.id, entry.value as DataSourceHandler]));
  const sources = new Map<string, RegisteredDataSource>();
  for (const [id, definition] of definitions) {
    const handler = handlers.get(id);
    if (handler !== undefined) sources.set(id, Object.freeze({ definition, handler }));
  }
  return { lookup: (sourceId: string) => sources.get(sourceId) };
}

const salesPolicy: DataSourcePolicyService = {
  authorize({ descriptor }) {
    if (descriptor.id === "sales.tasks") return {
      sourceAllowed: true,
      recordScope: { kind: "sales.tasks", where: {} },
      allowedFields: ["title", "status", "potential-revenue", "private-note"]
    };
    if (descriptor.id === "sales.opportunities") return {
      sourceAllowed: true,
      recordScope: { kind: "sales.opportunities", where: {} },
      allowedFields: ["name", "stage", "value"]
    };
    return {
      sourceAllowed: descriptor.id === "sales.total-potential-revenue",
      recordScope: { kind: "sales.tasks", where: {} },
      allowedFields: []
    };
  }
};

function context(request: PayloadRequest, correlationId: string, authority: FixtureCurrentAuthority): FixtureAuthorityContext {
  return authority.context(request, correlationId);
}

function queryGateway(registration: RegistrationResult, authority: FixtureCurrentAuthority): DataSourceGateway {
  return new DataSourceGateway({
    authenticator: new PayloadRequestAuthenticator({
      actor(request) {
        if (request.user === null || request.user === undefined || request.user.collection !== "users" ||
          request.user.id === null || request.user.id === undefined) {
          throw new DataSourceGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
        }
        const actorId = String(request.user.id);
        return {
          principal: { kind: "user", id: actorId },
          effectiveActor: { kind: "user", id: actorId }
        };
      },
      authorizationContext(request) {
        return context(request, request.headers.get("x-correlation-id") ?? "fixture-query", authority);
      },
      requestContext(request) {
        const current = context(request, request.headers.get("x-correlation-id") ?? "fixture-query", authority);
        return createPayloadPersistenceCapability(request, [
          { collection: "sales-tasks", operations: ["find"] },
          { collection: "sales-opportunities", operations: ["find"] }
        ], new CurrentAuthorityPayloadPersistenceAuthorizer(authority.adapter, current, ({ collection, operation }) => authority.payload(collection, operation)));
      }
    }),
    catalog: catalog(registration),
    surfaceAudience: new DescriptorSurfaceAudienceGuard(),
    authorization: new PolicyAuthorizationEvaluator(new CurrentAuthorityDataSourcePolicy(
      authority.adapter,
      (request) => request.authorizationContext as FixtureAuthorityContext,
      { source: (descriptor, surface) => authority.source(descriptor, surface), field: (descriptor, fieldId, surface) => authority.field(descriptor, fieldId, surface) },
      salesPolicy
    )),
    budget: new BoundedQueryBudgetEvaluator(),
    dispatcher: new RegisteredHandlerDispatcher(),
    sourceSchema: new DefinitionSourceSchemaValidator(),
    outputContract: new CanonicalOutputContractValidator(),
    redactor: new TableProjectionRedactor(),
    cache: new InMemoryDataSourceCachePolicy(),
    observability: { success() {}, failure() {} },
    problemDetails: new SafeProblemDetailsSerializer()
  });
}

export function createDataSourceQueryEndpoint(registration: RegistrationResult, authority: FixtureCurrentAuthority): Endpoint {
  const gateway = queryGateway(registration, authority);
  const problemDetails = new SafeProblemDetailsSerializer();
  return {
    method: "post",
    path: "/k-nex/data-source-query",
    handler: async (request) => {
      let body: QueryBody;
      try {
        body = typeof request.json === "function" ? await request.json() as QueryBody : {};
      } catch {
        body = {};
      }
      if (
        typeof body.sourceId !== "string" ||
        body.surface !== "workspace" ||
        !Array.isArray(body.selectedFields) ||
        body.selectedFields.some((value) => typeof value !== "string")
      ) {
        const problem = problemDetails.serialize(
          new DataSourceGatewayError("INVALID_GATEWAY_REQUEST", 400, "Data-source request is invalid."),
          request.headers.get("x-correlation-id") ?? "fixture-query"
        );
        return Response.json(problem, { status: problem.status });
      }
      const response = await gateway.query({
        correlationId: request.headers.get("x-correlation-id") ?? "fixture-query",
        rawRequest: request,
        sourceId: body.sourceId,
        surface: body.surface,
        input: body.input,
        query: body.query,
        selectedFields: body.selectedFields,
        signal: request.signal ?? new AbortController().signal
      });
      return Response.json(response.body, { status: response.status });
    }
  };
}
