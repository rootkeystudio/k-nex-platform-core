import { dataSourceTableProjectionIsValid, resolveDataSourceFieldSelection, TableRecordsSchema, type DataSourceDescriptor } from "@k-nex/contracts";

import {
  DataSourceGatewayError,
  type AuthenticatedDataSourceRequest,
  type AuthorizationEvaluator,
  type AuthorizedDataSourceQuery,
  type DataSourceExecutionContext,
  type DataSourceGatewayRequest,
  type ProjectionRedactor,
  type RegisteredDataSource,
  type SurfaceAudienceGuard
} from "./data-source-gateway.js";

export const dataSourceActorKinds = ["public", "public-session", "user", "service", "system-job"] as const;
export type DataSourceActorKind = (typeof dataSourceActorKinds)[number];

export interface DataSourceActorIdentity {
  readonly kind: DataSourceActorKind;
  readonly id: string;
}

export interface DataSourceImpersonation {
  readonly reason: string;
  readonly approvedBy: string;
}

export interface DataSourceActorContext {
  readonly principal: DataSourceActorIdentity;
  readonly effectiveActor: DataSourceActorIdentity;
  readonly impersonation?: DataSourceImpersonation;
}

export interface DataSourcePolicyRequest {
  readonly actor: DataSourceActorContext;
  readonly authorizationContext: unknown;
  readonly descriptor: DataSourceDescriptor;
  readonly surface: DataSourceGatewayRequest["surface"];
}

export interface DataSourcePolicyDecision {
  readonly sourceAllowed: boolean;
  readonly recordScope: unknown;
  readonly allowedFields: readonly string[];
}

export interface DataSourcePolicyService {
  authorize(request: DataSourcePolicyRequest): DataSourcePolicyDecision | Promise<DataSourcePolicyDecision>;
}

function actorIdentity(value: unknown): value is DataSourceActorIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DataSourceActorIdentity>;
  return dataSourceActorKinds.some((kind) => kind === candidate.kind)
    && typeof candidate.id === "string"
    && candidate.id.length >= 1
    && candidate.id.length <= 128;
}

export function isDataSourceActorContext(value: unknown): value is DataSourceActorContext {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DataSourceActorContext>;
  if (!actorIdentity(candidate.principal) || !actorIdentity(candidate.effectiveActor)) return false;
  const changedActor = candidate.principal.id !== candidate.effectiveActor.id || candidate.principal.kind !== candidate.effectiveActor.kind;
  if (candidate.impersonation === undefined) return !changedActor;
  if (typeof candidate.impersonation !== "object" || candidate.impersonation === null) return false;
  const reason = candidate.impersonation.reason;
  const approvedBy = candidate.impersonation.approvedBy;
  return changedActor
    && typeof reason === "string"
    && reason.length >= 1
    && reason.length <= 256
    && typeof approvedBy === "string"
    && approvedBy.length >= 1
    && approvedBy.length <= 128;
}

function actorContext(authenticated: AuthenticatedDataSourceRequest): DataSourceActorContext {
  if (!isDataSourceActorContext(authenticated.actor)) {
    throw new DataSourceGatewayError("INVALID_ACTOR_CONTEXT", 401, "Authentication context is invalid.");
  }
  return authenticated.actor;
}

export class DescriptorSurfaceAudienceGuard implements SurfaceAudienceGuard {
  assertAllowed(source: RegisteredDataSource, surface: DataSourceGatewayRequest["surface"], authenticated: AuthenticatedDataSourceRequest): void {
    const descriptor = source.definition.descriptor;
    const actor = actorContext(authenticated).effectiveActor;
    if (!descriptor.surfaces.includes(surface)) {
      throw new DataSourceGatewayError("SOURCE_SURFACE_FORBIDDEN", 403, "Data source is unavailable on this surface.");
    }
    if (surface === "public" && descriptor.audience !== "public") {
      throw new DataSourceGatewayError("SOURCE_AUDIENCE_FORBIDDEN", 403, "Data source audience is not permitted.");
    }
    if ((actor.kind === "public" || actor.kind === "public-session") && descriptor.audience !== "public") {
      throw new DataSourceGatewayError("SOURCE_AUDIENCE_FORBIDDEN", 403, "Data source audience is not permitted.");
    }
    if (descriptor.audience === "internal" && actor.kind !== "service" && actor.kind !== "system-job") {
      throw new DataSourceGatewayError("SOURCE_AUDIENCE_FORBIDDEN", 403, "Data source audience is not permitted.");
    }
  }
}

export class PolicyAuthorizationEvaluator implements AuthorizationEvaluator {
  constructor(private readonly policy: DataSourcePolicyService) {}

  async authorize(
    source: RegisteredDataSource,
    request: DataSourceGatewayRequest,
    authenticated: AuthenticatedDataSourceRequest
  ): Promise<AuthorizedDataSourceQuery> {
    const descriptor = source.definition.descriptor;
    const actor = actorContext(authenticated);
    const decision = await this.policy.authorize({
      actor,
      authorizationContext: authenticated.authorizationContext,
      descriptor,
      surface: request.surface
    });
    if (!decision.sourceAllowed) throw new DataSourceGatewayError("SOURCE_FORBIDDEN", 403, "Data source access is forbidden.");

    const fields = new Map((descriptor.outputFields ?? []).map((field) => [field.id, field]));
    const allowed = new Set(decision.allowedFields.filter((fieldId) => fields.has(fieldId)));
    const selection = resolveDataSourceFieldSelection(descriptor, request.selectedFields, allowed);
    if (!selection.success) {
      const insufficient = selection.reason === "REQUIRED_FIELD_NOT_REQUESTED" || selection.reason === "REQUIRED_FIELD_NOT_ALLOWED" || selection.reason === "NO_ALLOWED_FIELDS";
      throw new DataSourceGatewayError(
        insufficient ? "INSUFFICIENT_FIELD_PERMISSION" : "INVALID_FIELD_SELECTION",
        insufficient ? 403 : 400,
        insufficient ? "A required or selected field is unavailable." : "Selected fields are invalid."
      );
    }
    return { selectedFields: selection.selectedFields, recordScope: decision.recordScope };
  }
}

export class TableProjectionRedactor implements ProjectionRedactor {
  redact(context: DataSourceExecutionContext, value: unknown): unknown {
    if (context.source.definition.descriptor.primaryContract.id === "metric.scalar") return value;
    const parsed = TableRecordsSchema.safeParse(value);
    if (!parsed.success) throw new DataSourceGatewayError("INVALID_OUTPUT_CONTRACT", 500, "Data source violated its output contract.");
    const permitted = new Set(context.query.selectedFields);
    if (!dataSourceTableProjectionIsValid(context.source.definition.descriptor, context.query.selectedFields, parsed.data, true)) {
      throw new DataSourceGatewayError("INVALID_SOURCE_OUTPUT", 500, "Data source omitted an authorized field.");
    }
    return {
      fields: parsed.data.fields.filter((fieldId) => permitted.has(fieldId)),
      rows: parsed.data.rows.map((row) => ({
        key: row.key,
        values: Object.fromEntries(Object.entries(row.values).filter(([fieldId]) => permitted.has(fieldId)))
      })),
      page: parsed.data.page
    };
  }
}
