import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createPluginLifecycleState, executeRegistration, reconcilePluginAvailability, scopePluginRegistration, type RegistrationResult, type ScopedRegistrationResult } from "@k-nex/runtime";
import { PluginManifestSchema } from "@k-nex/contracts";
import { salesOpportunitiesCollection, salesRegistration, salesTasksCollection } from "@k-nex/module-sales/server";
import { salesTaskFixture } from "@k-nex/module-sales/testing";
import { composePayloadApplication, PayloadCompositionError } from "@k-nex/payload-adapter";
import { buildConfig, type CollectionConfig } from "payload";
import { describe, expect, it } from "vitest";

const salesManifest = PluginManifestSchema.parse(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../k-nex.plugin.json"),
  "utf8"
)));

function rawRegistration(): RegistrationResult {
  const integrity = `sha512-${"a".repeat(86)}==`;
  return executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [{
        id: "module.sales",
        kind: "module",
        package: "@k-nex/module-sales",
        version: "1.0.0",
        integrity,
        required: [],
        optional: []
      }],
      capabilityProviders: [],
      registrationOrder: ["module.sales"]
    },
    installed: [{
      package: { name: "@k-nex/module-sales", version: "1.0.0", integrity },
      manifest: salesManifest
    }],
    registrations: [salesRegistration]
  });
}

function scope(raw: RegistrationResult): ScopedRegistrationResult {
  const integrity = `sha512-${"a".repeat(86)}==`;
  const lifecycle = createPluginLifecycleState({
    pluginId: "module.sales", catalogStatus: "supported",
    package: { status: "installed", name: "@k-nex/module-sales", version: "1.0.0", integrity }, enabled: true,
    configuration: { revision: 1, ready: true }, migration: { current: 1, required: 1, ready: true }, dataState: "active", releaseStatus: "supported"
  });
  return scopePluginRegistration(raw, [reconcilePluginAvailability(raw, lifecycle)]);
}

function registration(): ScopedRegistrationResult { return scope(rawRegistration()); }

function compose(overrides: Partial<Parameters<typeof composePayloadApplication>[0]> = {}) {
  return composePayloadApplication({
    baseConfig: { secret: "fixture-only-secret" },
    databaseUrl: "postgres://fixture:fixture@127.0.0.1:5432/gate1",
    registration: registration(),
    ...overrides
  });
}

function registrationWith(collectionValue: unknown): ScopedRegistrationResult {
  const base = rawRegistration();
  return scope({
    ...base,
    contributions: {
      ...base.contributions,
      schema: [{ pluginId: "module.sales", id: "sales.tasks.collection", value: collectionValue }]
    }
  });
}

function expectCode(action: () => unknown, code: PayloadCompositionError["code"]): void {
  try {
    action();
    throw new Error("Expected Payload composition to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(PayloadCompositionError);
    expect((error as PayloadCompositionError).code).toBe(code);
  }
}

describe("Payload application composition", () => {
  it("rejects lifecycle-owned schema composition before authoritative reconciliation", () => {
    expect(() => compose({ registration: rawRegistration() as never })).toThrow(/authoritative lifecycle scoping/);
  });
  it("composes the owned Sales collection with the Postgres adapter and sanitizes through public Payload APIs", async () => {
    const application = compose();
    expect(application.config.db.name).toBe("postgres");
    expect(application.config.collections?.map(({ slug }) => slug)).toEqual(["sales-opportunities", "sales-tasks"]);
    expect(application.collectionOwnership).toEqual([
      { slug: "sales-opportunities", pluginId: "module.sales", contributionId: "sales.opportunities.collection" },
      { slug: "sales-tasks", pluginId: "module.sales", contributionId: "sales.tasks.collection" }
    ]);

    const sanitized = await buildConfig(application.config);
    expect(sanitized.collections.map(({ slug }) => slug)).toContain("sales-tasks");
    expect(sanitized.collections.map(({ slug }) => slug)).toContain("sales-opportunities");
  });

  it("rejects direct collection access even for authenticated actors and preserves the Payload request context", async () => {
    const access = salesTasksCollection.access?.read;
    expect(access).toBeTypeOf("function");
    const context = { correlationId: "gate-1-request" };
    const anonymousRequest = { user: null, context };
    const actorRequest = { user: { id: "actor-1", collection: "users" }, context };
    const mcpKeyRequest = { user: { id: "key-1", collection: "payload-mcp-api-keys" }, context };

    await expect(Promise.resolve(access?.({ req: anonymousRequest } as never))).resolves.toBe(false);
    await expect(Promise.resolve(access?.({ req: actorRequest } as never))).resolves.toBe(false);
    await expect(Promise.resolve(access?.({ req: mcpKeyRequest } as never))).resolves.toBe(false);
    expect(anonymousRequest.context).toBe(context);
    expect(actorRequest.context).toBe(context);
  });

  it("applies the same internal-only collection boundary to Sales opportunities", () => {
    const access = salesOpportunitiesCollection.access?.read;
    expect(access).toBeTypeOf("function");
    expect((access as Function)({ req: { user: null } })).toBe(false);
    expect((access as Function)({ req: { user: { id: "actor-1", collection: "users" } } })).toBe(false);
  });

  it("retains disabled plugin schema while direct collection access stays closed", async () => {
    const raw = rawRegistration();
    const integrity = `sha512-${"a".repeat(86)}==`;
    const lifecycle = createPluginLifecycleState({
      pluginId: "module.sales", catalogStatus: "supported",
      package: { status: "installed", name: "@k-nex/module-sales", version: "1.0.0", integrity }, enabled: false,
      configuration: { revision: 1, ready: true }, migration: { current: 1, required: 1, ready: true }, dataState: "retained", releaseStatus: "supported"
    });
    const composed = composePayloadApplication({
      baseConfig: { secret: "payload-composition-test-secret" }, databaseUrl: "postgres://test:test@localhost:5432/test",
      registration: scopePluginRegistration(raw, [reconcilePluginAvailability(raw, lifecycle)])
    });
    const collection = composed.config.collections?.find(({ slug }) => slug === "sales-tasks");
    expect(collection).toBeDefined();
    expect(await collection?.access?.read?.({ req: { user: { id: "actor-1", collection: "users" } } } as never)).toBe(false);
    expect(await collection?.access?.create?.({} as never)).toBe(false);
    expect(await collection?.access?.update?.({} as never)).toBe(false);
    expect(await collection?.access?.delete?.({} as never)).toBe(false);
  });

  it("rejects duplicate collection slugs before Payload initialization", () => {
    expectCode(() => compose({ baseCollections: [{ ...salesTasksCollection }] }), "DUPLICATE_COLLECTION_SLUG");
  });

  it("rejects duplicate collection routes", () => {
    const collection: CollectionConfig = {
      ...salesTasksCollection,
      endpoints: [
        { method: "get", path: "/export", handler: () => Response.json({}) },
        { method: "get", path: "export/", handler: () => Response.json({}) }
      ]
    };
    expectCode(() => compose({ registration: registrationWith({ type: "payload.collection", collection }) }), "ROUTE_COLLISION");
  });

  it("rejects collisions between root and collection routes", () => {
    const collection: CollectionConfig = {
      ...salesTasksCollection,
      endpoints: [{ method: "get", path: "/export", handler: () => Response.json({}) }]
    };
    expectCode(() => compose({
      baseConfig: {
        secret: "fixture-only-secret",
        endpoints: [{ method: "get", path: "/sales-tasks/export", handler: () => Response.json({}) }]
      },
      registration: registrationWith({ type: "payload.collection", collection })
    }), "ROUTE_COLLISION");
  });

  it("rejects duplicate compound indexes", () => {
    const collection: CollectionConfig = {
      ...salesTasksCollection,
      indexes: [{ fields: ["status"] }, { fields: ["status"] }]
    };
    expectCode(() => compose({ registration: registrationWith({ type: "payload.collection", collection }) }), "INDEX_COLLISION");
  });

  it("rejects schema values outside the explicit owned-collection adapter", () => {
    expectCode(() => compose({ registration: registrationWith({ arbitraryPayloadPatch: true }) }), "INVALID_SCHEMA_CONTRIBUTION");
  });

  it("exposes separated runtime, migration, SQL baseline, and testing entrypoints", () => {
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    expect(Object.hasOwn(packageJson.exports, ".")).toBe(false);
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      "./browser", "./contracts", "./manifest", "./migrations", "./pages", "./payload-baseline-down.sql",
      "./payload-baseline-up.sql", "./server", "./testing", "./ui"
    ]);
    expect(salesTaskFixture).toEqual({ title: "Prepare customer follow-up", status: "open" });
  });

  it("does not accept an empty database connection setting", () => {
    expectCode(() => compose({ databaseUrl: "  " }), "INVALID_DATABASE_URL");
  });
});
