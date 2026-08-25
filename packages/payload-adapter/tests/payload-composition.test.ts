import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { executeRegistration, type RegistrationResult } from "@k-nex/composition";
import { PluginManifestSchema } from "@k-nex/contracts";
import { salesRegistration, salesTasksCollection } from "@k-nex/module-sales/server";
import { buildConfig, type CollectionConfig } from "payload";
import { describe, expect, it } from "vitest";

import { composePayloadApplication, PayloadCompositionError } from "../src/index.js";

const salesManifest = PluginManifestSchema.parse(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../../../modules/sales/k-nex.plugin.json"),
  "utf8"
)));

function registration(): RegistrationResult {
  return executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [{
        id: "module.sales",
        kind: "module",
        package: "@k-nex/module-sales",
        version: "1.0.0",
        integrity: "sha512-sales",
        required: [],
        optional: []
      }],
      capabilityProviders: [],
      registrationOrder: ["module.sales"]
    },
    installed: [{
      package: { name: "@k-nex/module-sales", version: "1.0.0", integrity: "sha512-sales" },
      manifest: salesManifest
    }],
    registrations: [salesRegistration]
  });
}

function compose(overrides: Partial<Parameters<typeof composePayloadApplication>[0]> = {}) {
  return composePayloadApplication({
    baseConfig: { secret: "fixture-only-secret" },
    databaseUrl: "postgres://fixture:fixture@127.0.0.1:5432/gate1",
    registration: registration(),
    ...overrides
  });
}

function registrationWith(collectionValue: unknown): RegistrationResult {
  const base = registration();
  return {
    ...base,
    contributions: {
      ...base.contributions,
      schema: [{ pluginId: "module.sales", id: "sales.tasks.collection", value: collectionValue }]
    }
  };
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
  it("composes the owned Sales collection with the Postgres adapter and sanitizes through public Payload APIs", async () => {
    const application = compose();
    expect(application.config.db.name).toBe("postgres");
    expect(application.config.collections?.map(({ slug }) => slug)).toEqual(["sales-tasks"]);
    expect(application.collectionOwnership).toEqual([{
      slug: "sales-tasks",
      pluginId: "module.sales",
      contributionId: "sales.tasks.collection"
    }]);

    const sanitized = await buildConfig(application.config);
    expect(sanitized.collections.map(({ slug }) => slug)).toContain("sales-tasks");
  });

  it("requires an authenticated actor and preserves the Payload request context", async () => {
    const access = salesTasksCollection.access?.read;
    expect(access).toBeTypeOf("function");
    const context = { correlationId: "gate-1-request" };
    const anonymousRequest = { user: null, context };
    const actorRequest = { user: { id: "actor-1" }, context };

    await expect(Promise.resolve(access?.({ req: anonymousRequest } as never))).resolves.toBe(false);
    await expect(Promise.resolve(access?.({ req: actorRequest } as never))).resolves.toBe(true);
    expect(anonymousRequest.context).toBe(context);
    expect(actorRequest.context).toBe(context);
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

  it("keeps the package server-only and ships one domain-neutral fixture", () => {
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../modules/sales/package.json"), "utf8"));
    expect(Object.hasOwn(packageJson.exports, ".")).toBe(false);
    expect(packageJson.exports).toHaveProperty("./manifest", "./k-nex.plugin.json");
    expect(packageJson.exports).toHaveProperty("./server");
    expect(packageJson.exports).not.toHaveProperty("./browser");

    const task = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../modules/sales/testing/task-fixture.json"), "utf8"));
    expect(task).toEqual({ title: "Prepare customer follow-up", status: "open" });
  });

  it("does not accept an empty database connection setting", () => {
    expectCode(() => compose({ databaseUrl: "  " }), "INVALID_DATABASE_URL");
  });
});
