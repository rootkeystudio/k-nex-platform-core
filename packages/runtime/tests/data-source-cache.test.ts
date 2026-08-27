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
  it("never stores no-store sources", async () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const request = context("no-store");
    await cache.store(request, envelope);
    await expect(cache.lookup(request)).resolves.toBeUndefined();
  });

  it("isolates actor entries and shares authorization-context entries only on the full stable fingerprint", async () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const firstActor = context("actor", actor("user-1"));
    await cache.store(firstActor, envelope);
    await expect(cache.lookup(firstActor)).resolves.toEqual(envelope);
    await expect(cache.lookup(context("actor", actor("user-2")))).resolves.toBeUndefined();

    const shared = context("authorization-context", actor("user-1"));
    await cache.store(shared, envelope);
    await expect(cache.lookup(context("authorization-context", actor("user-2")))).resolves.toEqual(envelope);
    await expect(cache.lookup(context("authorization-context", actor("user-2"), "policy:r2:membership:m1"))).resolves.toBeUndefined();
  });

  it("keys authorization-sensitive query and presentation dimensions", async () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const original = context("authorization-context");
    await cache.store(original, envelope);
    const keys = [...(cache as unknown as { entries: Map<string, unknown> }).entries.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain("sales.total-revenue");
    expect(keys[0]).not.toContain("tenant");
    await expect(cache.lookup({ ...original, query: { ...original.query, recordScope: { tenant: "two" } } })).resolves.toBeUndefined();
    await expect(cache.lookup({ ...original, query: { ...original.query, selectedFields: ["amount"] } })).resolves.toBeUndefined();
    await expect(cache.lookup({
      ...original,
      authenticated: {
        ...original.authenticated,
        authorizationContext: { ...(original.authenticated.authorizationContext as object), locale: "tr-TR" }
      }
    })).resolves.toBeUndefined();

    const cursorPage = { ...original, query: { ...original.query, controls: { cursor: { size: 25, after: "next-page" }, filters: [], sort: [] } } };
    await cache.store(cursorPage, envelope);
    await expect(cache.lookup({ ...cursorPage, query: { ...cursorPage.query, controls: { cursor: { size: 25, after: "other-page" }, filters: [], sort: [] } } })).resolves.toBeUndefined();
  });

  it("permits public sharing only for public sources, surfaces, and actors without impersonation", async () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const publicActor: DataSourceActorContext = {
      principal: { kind: "public-session", id: "session-1" },
      effectiveActor: { kind: "public-session", id: "session-1" }
    };
    const first = context("public", publicActor);
    await cache.store(first, envelope);
    await expect(cache.lookup(context("public", { ...publicActor, principal: { kind: "public-session", id: "session-2" }, effectiveActor: { kind: "public-session", id: "session-2" } }))).resolves.toEqual(envelope);
    await expect(cache.lookup({ ...first, surface: "workspace" })).rejects.toThrowError(DataSourceGatewayError);
    await expect(cache.lookup({ ...first, authenticated: { ...first.authenticated, actor: actor("user-1") } })).rejects.toThrowError(DataSourceGatewayError);
  });

  it("rejects role-only or untracked authorization context", async () => {
    const cache = new InMemoryDataSourceCachePolicy();
    const request = context("actor");
    await expect(cache.lookup({ ...request, authenticated: { ...request.authenticated, authorizationContext: { role: "admin" } } })).rejects.toThrowError(DataSourceGatewayError);
    await expect(cache.lookup({
      ...request,
      authenticated: {
        ...request.authenticated,
        authorizationContext: { permissionFingerprint: "r1", untrackedSemanticState: "unsafe" }
      }
    })).rejects.toThrowError(DataSourceGatewayError);
  });

  it("expires, evicts, and returns mutation-isolated frozen values", async () => {
    let now = 10;
    const cache = new InMemoryDataSourceCachePolicy({ ttlMs: 5, maxEntries: 1, now: () => now });
    const first = context("actor", actor("user-1"));
    await cache.store(first, envelope);
    const hit = await cache.lookup(first);
    expect(hit).toEqual(envelope);
    expect(Object.isFrozen(hit?.data)).toBe(true);

    const second = context("actor", actor("user-2"));
    await cache.store(second, envelope);
    await expect(cache.lookup(first)).resolves.toBeUndefined();
    await expect(cache.lookup(second)).resolves.toEqual(envelope);
    now = 15;
    await expect(cache.lookup(second)).resolves.toBeUndefined();
  });
});
