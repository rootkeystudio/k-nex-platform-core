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
import { sql } from "@payloadcms/db-postgres";
import { activePayloadPostgresTransaction, createPayloadPersistenceCapability, CurrentAuthorityPayloadPersistenceAuthorizer, PayloadRequestAuthenticator } from "@k-nex/payload-adapter";
import type { Endpoint, PayloadRequest } from "payload";
import type { FixtureAuthorityContext, FixtureCurrentAuthority, FixtureDurableSalesAuthority, FixtureSalesProfile } from "./current-authority.js";

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

function taskStatus(profile: FixtureSalesProfile): "open" | "completed" {
  return profile === "done" ? "completed" : "open";
}

function opportunityStage(profile: FixtureSalesProfile): "qualification" | "won" {
  return profile === "done" ? "won" : "qualification";
}

function ownedScope(context: FixtureAuthorityContext, stateField: "status" | "stageId", state: string) {
  return {
    and: [
      { applicationId: { equals: context.applicationId } },
      { environment: { equals: context.environment } },
      { or: [{ ownerId: { equals: context.ownerId } }, { teamId: { equals: context.teamId } }] },
      { [stateField]: { equals: state } }
    ]
  };
}

function durableScope(current: FixtureDurableSalesAuthority, stateField: "status" | "stageId", state: string) {
  const identity = [{ applicationId: { equals: current.context.applicationId } }, { environment: { equals: current.context.environment } }];
  const teams = current.authorizedTeamIds.length === 0 ? undefined : { teamId: { in: current.authorizedTeamIds } };
  const records = current.recordScope === "application-sales-scope" || current.recordScope === "explicit-application-or-team-scope" && current.applicationWide
    ? identity : current.recordScope === "explicit-application-or-team-scope"
      ? [...identity, teams ?? { id: { equals: "__denied__" } }]
      : [...identity, { or: [{ ownerId: { equals: current.context.actorId } }, ...(teams === undefined ? [] : [teams])] }];
  return { and: [...records, { [stateField]: { equals: state } }] };
}

function durableCrmScope(current: FixtureDurableSalesAuthority) {
  const identity = [{ applicationId: { equals: current.context.applicationId } }, { environment: { equals: current.context.environment } }];
  const teams = current.authorizedTeamIds.length === 0 ? undefined : { teamId: { in: current.authorizedTeamIds } };
  const records = current.recordScope === "application-sales-scope" || current.recordScope === "explicit-application-or-team-scope" && current.applicationWide
    ? identity : current.recordScope === "explicit-application-or-team-scope"
      ? [...identity, teams ?? { id: { equals: "__denied__" } }]
      : [...identity, { or: [{ ownerId: { equals: current.context.actorId } }, ...(teams === undefined ? [] : [teams])] }];
  return { and: records };
}

function salesPolicy(authority: FixtureCurrentAuthority, resolve: (value: unknown) => FixtureDurableSalesAuthority): DataSourcePolicyService {
  return {
    authorize({ descriptor, authorizationContext }) {
      const durable = resolve(authorizationContext);
      const current = durable.context;
      const profile = authority.salesProfile(current);
    if (descriptor.id === "sales.tasks") return {
      sourceAllowed: true,
      recordScope: { kind: "sales.tasks", where: durableScope(durable, "status", taskStatus(profile)) },
      allowedFields: ["title", "status"]
    };
    if (descriptor.id === "sales.opportunities") return {
      sourceAllowed: true,
      recordScope: { kind: "sales.opportunities", where: durableScope(durable, "stageId", opportunityStage(profile)) },
      allowedFields: ["name", "stage-id", "revision", "amount"]
    };
    const crm = descriptor.id === "sales.accounts" || descriptor.id === "sales.account.detail" ? { kind: descriptor.id, fields: ["name", "owner-id", "team-id", "status", "revision"] }
      : descriptor.id === "sales.contacts" || descriptor.id === "sales.contact.detail" ? { kind: descriptor.id, fields: ["display-name", "owner-id", "team-id", "account-id", "status", "revision", "email", "phone"] }
        : descriptor.id === "sales.leads" ? { kind: descriptor.id, fields: ["display-name", "owner-id", "team-id", "status", "archive-status", "revision", "email", "phone"] }
          : descriptor.id === "sales.lead.detail" ? { kind: descriptor.id, fields: ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "email", "phone", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"] }
            : descriptor.id === "sales.opportunity.detail" ? { kind: descriptor.id, fields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "stage-id", "archive-status", "expected-close-date", "revision", "amount"] }
            : descriptor.id === "sales.timeline" ? { kind: "sales.timeline", fields: ["kind", "subject", "status", "occurred-at", "revision", "body"] } : undefined;
    if (crm !== undefined) return { sourceAllowed: true, recordScope: { kind: crm.kind, where: durableCrmScope(durable) }, allowedFields: crm.fields };
    return {
      sourceAllowed: false,
      recordScope: { kind: "sales.denied", where: { id: { equals: "__denied__" } } },
      allowedFields: []
    };
    }
  }
}

function context(request: PayloadRequest, correlationId: string, authority: FixtureCurrentAuthority): FixtureAuthorityContext {
  return authority.context(request, correlationId);
}

function resultRows(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("Sales source authority fence received an invalid Postgres result.");
  return value.rows as readonly Record<string, unknown>[];
}

async function durableFence(request: PayloadRequest, durable: FixtureDurableSalesAuthority): Promise<boolean> {
  const transaction = await activePayloadPostgresTransaction(request);
  const state = resultRows(await transaction.execute(sql`SELECT "authorization_revision","lifecycle_revision" FROM "k_nex_authorization_state" WHERE "application_id"=${durable.context.applicationId} FOR SHARE`))[0];
  const scope = resultRows(await transaction.execute(sql`SELECT "revision" FROM "sales_current_authority_scopes" WHERE "application_id"=${durable.context.applicationId} AND "environment"=${durable.context.environment} AND "principal_id"=${durable.context.actorId} AND "state"='active' FOR SHARE`))[0];
  return state?.authorization_revision === durable.authorizationRevision && state?.lifecycle_revision === durable.lifecycleRevision && scope?.revision === durable.scopeRevision;
}

function queryGateway(registration: RegistrationResult, authority: FixtureCurrentAuthority): DataSourceGateway {
  const authorityContexts = new WeakMap<PayloadRequest, FixtureAuthorityContext>();
  const durableContexts = new WeakMap<object, FixtureDurableSalesAuthority>();
  const resolveAuthorityContext = (value: unknown) => {
    if (typeof value !== "object" || value === null) throw new TypeError("Data-source authority context is invalid.");
    const current = durableContexts.get(value);
    if (current === undefined) throw new TypeError("Data-source authority context is unavailable.");
    return current;
  };
  const cacheContext = (request: PayloadRequest) => {
    const current = authorityContexts.get(request) ?? context(request, request.headers.get("x-correlation-id") ?? "fixture-query", authority);
    authorityContexts.set(request, current);
    const durable = authority.durableSalesAuthority(request);
    const cacheContext = Object.freeze({ permissionFingerprint: `${current.permissionFingerprint}:a${durable.authorizationRevision}:l${durable.lifecycleRevision}:s${durable.scopeRevision}:${durable.recordScope}:${durable.applicationWide}:${durable.authorizedTeamIds.join(",")}` });
    durableContexts.set(cacheContext, durable);
    return cacheContext;
  };
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
        if (request.user === null) return Object.freeze({});
        return cacheContext(request);
      },
      requestContext(request) {
        if (request.user === null) return Object.freeze({});
        const current = authorityContexts.get(request) ?? context(request, request.headers.get("x-correlation-id") ?? "fixture-query", authority);
        authorityContexts.set(request, current);
        const durable = authority.durableSalesAuthority(request);
        return createPayloadPersistenceCapability(request, [
          { collection: "sales-tasks", operations: ["find"] },
          { collection: "sales-opportunities", operations: ["find"] },
          { collection: "sales-accounts", operations: ["find"] },
          { collection: "sales-contacts", operations: ["find"] },
          { collection: "sales-leads", operations: ["find"] },
          { collection: "sales-activities", operations: ["find"] },
          { collection: "sales-notes", operations: ["find"] },
          { collection: "sales-attachment-references", operations: ["find"] }
        ], new CurrentAuthorityPayloadPersistenceAuthorizer(authority.adapter, current, ({ collection, operation }) => authority.payload(collection, operation)), {
          guard: async () => durableFence(request, durable)
        });
      }
    }),
    catalog: catalog(registration),
    surfaceAudience: new DescriptorSurfaceAudienceGuard(),
    authorization: new PolicyAuthorizationEvaluator(new CurrentAuthorityDataSourcePolicy(
      authority.adapter,
      (request) => resolveAuthorityContext(request.authorizationContext).context,
      { source: (descriptor, surface) => authority.source(descriptor, surface), field: (descriptor, fieldId, surface) => authority.field(descriptor, fieldId, surface) },
      salesPolicy(authority, resolveAuthorityContext)
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
      let durable: FixtureDurableSalesAuthority | undefined;
      if (request.user !== null && request.user !== undefined && request.user.collection === "users") {
        try { durable = await authority.resolveDurableSalesAuthority(request, request.headers.get("x-correlation-id") ?? "fixture-query"); }
        catch {
          const problem = problemDetails.serialize(new DataSourceGatewayError("PERMISSION_DENIED", 403, "Sales current authority is unavailable."), request.headers.get("x-correlation-id") ?? "fixture-query");
          return Response.json(problem, { status: problem.status });
        }
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
      if (response.status < 400 && durable !== undefined) {
        try {
          if (await authority.revalidateDurableSalesAuthority(request, durable) !== true) throw new Error("Sales authority changed.");
        } catch {
          const problem = problemDetails.serialize(new DataSourceGatewayError("PERMISSION_DENIED", 403, "Sales current authority changed."), request.headers.get("x-correlation-id") ?? "fixture-query");
          return Response.json(problem, { status: problem.status });
        }
      }
      return Response.json(response.body, { status: response.status });
    }
  };
}
