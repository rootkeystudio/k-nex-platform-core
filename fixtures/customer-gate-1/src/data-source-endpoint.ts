import type { DataSourceDefinition } from "@k-nex/contracts";
import {
  BoundedQueryBudgetEvaluator,
  CanonicalOutputContractValidator,
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
import { createPayloadPersistenceCapability, PayloadRequestAuthenticator } from "@k-nex/payload-adapter";
import type { Endpoint, PayloadRequest } from "payload";

interface QueryBody {
  readonly sourceId?: unknown;
  readonly surface?: unknown;
  readonly input?: unknown;
  readonly query?: unknown;
  readonly selectedFields?: unknown;
}

interface SalesAuthorizationContext {
  readonly permissionFingerprint: string;
}

function fingerprint(request: PayloadRequest): string {
  const email = typeof request.user === "object" && request.user !== null && "email" in request.user
    ? request.user.email
    : undefined;
  if (typeof email !== "string") return "sales:none";
  if (email.startsWith("required-denied@")) return "sales:open:required-denied";
  if (email.startsWith("no-note@")) return "sales:open:required";
  if (email.startsWith("done@")) return "sales:done:full";
  return "sales:open:full";
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
  authorize({ authorizationContext, descriptor }) {
    const context = authorizationContext as Partial<SalesAuthorizationContext>;
    const permissionFingerprint = context.permissionFingerprint;
    const sourceAllowed = typeof permissionFingerprint === "string" && permissionFingerprint.startsWith("sales:");
    const status = permissionFingerprint?.includes(":done:") ? "done" : "open";
    const taskFields = permissionFingerprint?.endsWith(":full")
      ? ["title", "status", "potential-revenue", "private-note"]
      : permissionFingerprint?.endsWith(":required")
        ? ["title", "status", "potential-revenue"]
        : ["title", "status"];
    if (descriptor.id === "sales.tasks") return {
      sourceAllowed,
      recordScope: { kind: "sales.tasks", where: { status: { equals: status } } },
      allowedFields: taskFields
    };
    if (descriptor.id === "sales.opportunities") return {
      sourceAllowed,
      recordScope: { kind: "sales.opportunities", where: { stage: { equals: status === "open" ? "lead" : "won" } } },
      allowedFields: permissionFingerprint?.endsWith(":full") ? ["name", "stage", "value"] : ["name", "stage"]
    };
    return {
      sourceAllowed: sourceAllowed && descriptor.id === "sales.total-potential-revenue",
      recordScope: { kind: "sales.tasks", where: { status: { equals: status } } },
      allowedFields: []
    };
  }
};

function queryGateway(registration: RegistrationResult): DataSourceGateway {
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
        return { permissionFingerprint: fingerprint(request) };
      },
      requestContext(request) {
        return createPayloadPersistenceCapability(request, [
          { collection: "sales-tasks", operations: ["find"] },
          { collection: "sales-opportunities", operations: ["find"] }
        ]);
      }
    }),
    catalog: catalog(registration),
    surfaceAudience: new DescriptorSurfaceAudienceGuard(),
    authorization: new PolicyAuthorizationEvaluator(salesPolicy),
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

export function createDataSourceQueryEndpoint(registration: RegistrationResult): Endpoint {
  const gateway = queryGateway(registration);
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
