import { describe, expect, it } from "vitest";

import { MetricScalarSchema, type DataSourceDefinition } from "@k-nex/contracts";

import {
  DataSourceGatewayError,
  InMemoryDataSourceCachePolicy,
  type DataSourceActorContext,
  type DataSourceExecutionContext,
  type DataSourceSuccessEnvelope
} from "../src/index.js";

const schema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };
const baseDefinition: DataSourceDefinition = {
  descriptor: {
    id: "sales.total-revenue",
    version: 1,
    ownerPluginId: "module.sales",
    primaryContract: { id: "metric.scalar", version: 1 },
    sourceSchema: { id: "sales.total-revenue.output", version: 1 },
    audience: "authenticated",
    surfaces: ["workspace"],
    permission: "sales.revenue.read",
    structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
    presentationMetadataRevision: 1,
    title: "Total revenue",
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
  inputSchema: schema,
  outputSchema: MetricScalarSchema
};

const actor = (id: string): DataSourceActorContext => ({
  principal: { kind: "user", id },
  effectiveActor: { kind: "user", id }
});

function context(
  cacheClass: "no-store" | "actor" | "authorization-context" | "public" = "actor",
  actorContext: DataSourceActorContext = actor("user-1"),
  permissionFingerprint = "policy:r1:membership:m1"
): DataSourceExecutionContext {
  const isPublic = cacheClass === "public";
  const definition: DataSourceDefinition = {
    ...baseDefinition,
    descriptor: {
      ...baseDefinition.descriptor,
      audience: isPublic ? "public" : "authenticated",
      surfaces: isPublic ? ["public"] : ["workspace"],
      cacheClass
    }
  };
  return {
    correlationId: "corr-1",
    source: { definition, handler: () => undefined },
    surface: isPublic ? "public" : "workspace",
    authenticated: {
      actor: actorContext,
      request: {},
      authorizationContext: {
        permissionFingerprint,
        locale: "en-GB",
        timezone: "Europe/London",
        publicationRevision: "published:r3",
        featureRevision: "features:r2"
      }
    },
    query: { input: {}, controls: { filters: [], sort: [] }, selectedFields: [], recordScope: { tenant: "one" } },
    signal: new AbortController().signal
  };
}

const envelope: DataSourceSuccessEnvelope = {
  schemaVersion: 1,
  source: { id: baseDefinition.descriptor.id, version: 1 },
  contract: { id: "metric.scalar", version: 1 },
  structuralCompatibilityHash: baseDefinition.descriptor.structuralCompatibilityHash,
  data: { value: { kind: "integer", value: 7 } }
};

describe("P2.6 safe cache classifications", () => {
  it("never stores no-store sources", () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const request = context("no-store");
    cache.store(request, envelope);
    expect(cache.lookup(request)).toBeUndefined();
  });

  it("isolates actor entries and shares authorization-context entries only on the full stable fingerprint", () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const firstActor = context("actor", actor("user-1"));
    cache.store(firstActor, envelope);
    expect(cache.lookup(firstActor)).toEqual(envelope);
    expect(cache.lookup(context("actor", actor("user-2")))).toBeUndefined();

    const shared = context("authorization-context", actor("user-1"));
    cache.store(shared, envelope);
    expect(cache.lookup(context("authorization-context", actor("user-2")))).toEqual(envelope);
    expect(cache.lookup(context("authorization-context", actor("user-2"), "policy:r2:membership:m1"))).toBeUndefined();
  });

  it("keys authorization-sensitive query and presentation dimensions", () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const original = context("authorization-context");
    cache.store(original, envelope);
    expect(cache.lookup({ ...original, query: { ...original.query, recordScope: { tenant: "two" } } })).toBeUndefined();
    expect(cache.lookup({ ...original, query: { ...original.query, selectedFields: ["amount"] } })).toBeUndefined();
    expect(cache.lookup({
      ...original,
      authenticated: {
        ...original.authenticated,
        authorizationContext: { ...(original.authenticated.authorizationContext as object), locale: "tr-TR" }
      }
    })).toBeUndefined();
  });

  it("permits public sharing only for public sources, surfaces, and actors without impersonation", () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const publicActor: DataSourceActorContext = {
      principal: { kind: "public-session", id: "session-1" },
      effectiveActor: { kind: "public-session", id: "session-1" }
    };
    const first = context("public", publicActor);
    cache.store(first, envelope);
    expect(cache.lookup(context("public", { ...publicActor, principal: { kind: "public-session", id: "session-2" }, effectiveActor: { kind: "public-session", id: "session-2" } }))).toEqual(envelope);
    expect(() => cache.lookup({ ...first, surface: "workspace" })).toThrowError(DataSourceGatewayError);
    expect(() => cache.lookup({ ...first, authenticated: { ...first.authenticated, actor: actor("user-1") } })).toThrowError(DataSourceGatewayError);
  });

  it("rejects role-only or untracked authorization context", () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const request = context("actor");
    expect(() => cache.lookup({ ...request, authenticated: { ...request.authenticated, authorizationContext: { role: "admin" } } })).toThrowError(DataSourceGatewayError);
    expect(() => cache.lookup({
      ...request,
      authenticated: {
        ...request.authenticated,
        authorizationContext: { permissionFingerprint: "r1", untrackedSemanticState: "unsafe" }
      }
    })).toThrowError(DataSourceGatewayError);
  });

  it("expires, evicts, and returns mutation-isolated frozen values", () => {
    let now = 10;
    const cache = new InMemoryDataSourceCachePolicy({ ttlMs: 5, maxEntries: 1, now: () => now });
    const first = context("actor", actor("user-1"));
    cache.store(first, envelope);
    const hit = cache.lookup(first);
    expect(hit).toEqual(envelope);
    expect(Object.isFrozen(hit?.data)).toBe(true);

    const second = context("actor", actor("user-2"));
    cache.store(second, envelope);
    expect(cache.lookup(first)).toBeUndefined();
    expect(cache.lookup(second)).toEqual(envelope);
    now = 15;
    expect(cache.lookup(second)).toBeUndefined();
  });
});
