import { describe, expect, it } from "vitest";

import { type DataSourceDefinition, TableRecordsSchema } from "@k-nex/contracts";

import {
  DataSourceGatewayError,
  DescriptorSurfaceAudienceGuard,
  PolicyAuthorizationEvaluator,
  TableProjectionRedactor,
  type AuthenticatedDataSourceRequest,
  type DataSourceActorContext,
  type DataSourceGatewayRequest,
  type DataSourcePolicyDecision,
  type DataSourcePolicyRequest,
  type DataSourcePolicyService,
  type RegisteredDataSource
} from "../src/index.js";

const descriptor = {
  id: "sales.tasks",
  version: 1,
  ownerPluginId: "module.sales",
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks.output", version: 1 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.tasks.read",
  structuralCompatibilityHash: `sha256:${"b".repeat(64)}`,
  presentationMetadataRevision: 1,
  title: "Sales tasks",
  inputFields: [],
  outputFields: [
    { id: "title", kind: "text", binding: "required", nullable: false, permission: "sales.tasks.title.read", sortable: true, filterOperators: ["eq"] },
    { id: "assignee", kind: "resource", binding: "optional", nullable: true, permission: "sales.tasks.assignee.read", sortable: false, filterOperators: [] },
    { id: "private-note", kind: "text", binding: "optional", nullable: true, permission: "sales.tasks.private-note.read", sortable: false, filterOperators: [] }
  ],
  paginationModes: ["offset"],
  limits: {
    maxSelectedFields: 3,
    maxPageSize: 50,
    maxFilters: 2,
    maxSorts: 1,
    maxBodyBytes: 4_096,
    maxResultBytes: 65_536,
    maxDepth: 4,
    timeoutMs: 1_000,
    maxConcurrency: 2,
    ratePerMinute: 60,
    burst: 10,
    costClass: "low",
    maxCost: 10
  },
  cacheClass: "actor"
} as const;

const definition: DataSourceDefinition = {
  descriptor,
  inputSchema: {
    safeParse(value: unknown) {
      const success = typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
      return success ? { success: true as const, data: {} } : { success: false as const, error: "Expected an empty object." };
    }
  },
  outputSchema: TableRecordsSchema
};
const source: RegisteredDataSource = { definition, handler: () => undefined };
const userActor: DataSourceActorContext = {
  principal: { kind: "user", id: "admin-1" },
  effectiveActor: { kind: "user", id: "user-1" },
  impersonation: { reason: "Support investigation", approvedBy: "admin-1" }
};
const authenticated: AuthenticatedDataSourceRequest = { actor: userActor, request: {}, authorizationContext: {} };
const baseRequest: DataSourceGatewayRequest = {
  correlationId: "corr-1",
  rawRequest: {},
  sourceId: descriptor.id,
  surface: "workspace",
  input: {},
  query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
  selectedFields: ["title", "assignee"],
  signal: new AbortController().signal
};

class FixedPolicy implements DataSourcePolicyService {
  seen: DataSourcePolicyRequest | undefined;
  constructor(private readonly decision: DataSourcePolicyDecision) {}
  authorize(request: DataSourcePolicyRequest): DataSourcePolicyDecision {
    this.seen = request;
    return this.decision;
  }
}

function evaluator(decision: Partial<DataSourcePolicyDecision> = {}): { policy: FixedPolicy; evaluator: PolicyAuthorizationEvaluator } {
  const policy = new FixedPolicy({ sourceAllowed: true, recordScope: { ownerId: "user-1" }, allowedFields: ["title", "assignee"], ...decision });
  return { policy, evaluator: new PolicyAuthorizationEvaluator(policy) };
}

describe("P2.4 data-source authorization", () => {
  it("returns only permitted fields and an opaque pre-query record scope", async () => {
    const { policy, evaluator: authorization } = evaluator();
    const result = await authorization.authorize(source, baseRequest, authenticated);
    expect(result).toEqual({ selectedFields: ["title", "assignee"], recordScope: { ownerId: "user-1" } });
    expect(policy.seen?.actor).toEqual(userActor);
    expect(policy.seen?.actor.impersonation).toEqual(userActor.impersonation);
    expect(policy.seen?.authorizationContext).toEqual({});
  });

  it("denies source permission before returning policy scope", async () => {
    const { evaluator: authorization } = evaluator({ sourceAllowed: false });
    await expect(authorization.authorize(source, baseRequest, authenticated)).rejects.toMatchObject({ code: "SOURCE_FORBIDDEN" });
  });

  it("rejects duplicate, undeclared, and metric field manipulation", async () => {
    const { evaluator: authorization } = evaluator();
    for (const selectedFields of [["title", "title"], ["title", "payload.secret"]]) {
      await expect(authorization.authorize(source, { ...baseRequest, selectedFields }, authenticated)).rejects.toMatchObject({ code: "INVALID_FIELD_SELECTION" });
    }
    const metricSource: RegisteredDataSource = {
      ...source,
      definition: { ...definition, descriptor: { ...descriptor, primaryContract: { id: "metric.scalar", version: 1 }, outputFields: undefined, paginationModes: [] } }
    };
    await expect(authorization.authorize(metricSource, { ...baseRequest, selectedFields: ["title"] }, authenticated)).rejects.toMatchObject({ code: "INVALID_FIELD_SELECTION" });
  });

  it("distinguishes required denial from optional omission", async () => {
    const requiredDenied = evaluator({ allowedFields: ["assignee"] }).evaluator;
    await expect(requiredDenied.authorize(source, baseRequest, authenticated)).rejects.toMatchObject({ code: "INSUFFICIENT_FIELD_PERMISSION" });
    await expect(evaluator().evaluator.authorize(source, { ...baseRequest, selectedFields: ["assignee"] }, authenticated)).rejects.toMatchObject({ code: "INSUFFICIENT_FIELD_PERMISSION" });

    const optionalDenied = evaluator({ allowedFields: ["title"] }).evaluator;
    await expect(optionalDenied.authorize(source, baseRequest, authenticated)).resolves.toMatchObject({ selectedFields: ["title"] });
  });

  it("does not echo manipulated or unauthorized field values in errors", async () => {
    const { evaluator: authorization } = evaluator();
    const secret = "payload.secret-token";
    try {
      await authorization.authorize(source, { ...baseRequest, selectedFields: [secret] }, authenticated);
      throw new Error("Expected authorization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(DataSourceGatewayError);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("enforces public, authenticated, and internal audience boundaries", () => {
    const guard = new DescriptorSurfaceAudienceGuard();
    expect(() => guard.assertAllowed(source, "workspace", authenticated)).not.toThrow();
    expect(() => guard.assertAllowed(source, "public", authenticated)).toThrowError(DataSourceGatewayError);

    const publicActor = { actor: { principal: { kind: "public", id: "anonymous" }, effectiveActor: { kind: "public", id: "anonymous" } }, request: {}, authorizationContext: {} } as const;
    expect(() => guard.assertAllowed(source, "workspace", publicActor)).toThrowError(DataSourceGatewayError);

    const publicSource: RegisteredDataSource = {
      ...source,
      definition: { ...definition, descriptor: { ...descriptor, audience: "public", surfaces: ["public"], cacheClass: "public" } }
    };
    expect(() => guard.assertAllowed(publicSource, "public", publicActor)).not.toThrow();

    const internalSource: RegisteredDataSource = {
      ...source,
      definition: { ...definition, descriptor: { ...descriptor, audience: "internal" } }
    };
    expect(() => guard.assertAllowed(internalSource, "workspace", authenticated)).toThrowError(DataSourceGatewayError);
    const serviceActor = { actor: { principal: { kind: "service", id: "service-1" }, effectiveActor: { kind: "service", id: "service-1" } }, request: {}, authorizationContext: {} } as const;
    expect(() => guard.assertAllowed(internalSource, "workspace", serviceActor)).not.toThrow();
    expect(() => guard.assertAllowed(source, "workspace", { ...authenticated, actor: { ...userActor, impersonation: null } })).toThrowError(DataSourceGatewayError);
  });

  it("redacts unselected fields while preserving permitted null", () => {
    const redactor = new TableProjectionRedactor();
    const context = {
      correlationId: "corr-1",
      source,
      surface: "workspace" as const,
      authenticated,
      query: {
        input: {},
        controls: { page: { number: 1, size: 25 }, filters: [], sort: [] },
        selectedFields: ["title", "assignee"],
        recordScope: {}
      },
      signal: baseRequest.signal
    };
    const value = {
      fields: ["title", "assignee", "private-note"],
      rows: [{
        key: "task-1",
        values: {
          title: { kind: "text", value: "Task" },
          assignee: null,
          "private-note": { kind: "text", value: "secret" }
        }
      }],
      page: { number: 1, pageSize: 25, hasNext: false }
    };
    expect(redactor.redact(context, value)).toEqual({
      fields: ["title", "assignee"],
      rows: [{ key: "task-1", values: { title: { kind: "text", value: "Task" }, assignee: null } }],
      page: value.page
    });
    expect(() => redactor.redact(context, { ...value, fields: ["assignee", "private-note"] })).toThrowError(DataSourceGatewayError);
    expect(() => redactor.redact(context, {
      ...value,
      rows: [{ key: "task-1", values: { title: { kind: "status", value: "wrong-kind" }, assignee: null } }]
    })).toThrowError(DataSourceGatewayError);
  });
});
