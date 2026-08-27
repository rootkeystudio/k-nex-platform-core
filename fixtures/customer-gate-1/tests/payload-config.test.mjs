import assert from "node:assert/strict";
import test from "node:test";

test("loads the packed Sales module through generated registries and composes public Payload config", async () => {
  process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5432/gate1";
  process.env.PAYLOAD_SECRET = "fixture-only-secret";
  const fixture = await import("../dist/src/payload.config.js");
  const config = await fixture.default;
  const collection = config.collections.find(({ slug }) => slug === "sales-tasks");
  const opportunities = config.collections.find(({ slug }) => slug === "sales-opportunities");
  const mcpKeys = config.collections.find(({ slug }) => slug === "payload-mcp-api-keys");

  assert.equal(config.db.name, "postgres");
  assert.ok(collection);
  assert.ok(opportunities);
  assert.ok(mcpKeys);
  assert.ok(config.endpoints.some(({ method, path }) => method === "post" && path === "/mcp"));
  assert.deepEqual(fixture.composedApplication.collectionOwnership, [
    { slug: "sales-opportunities", pluginId: "module.sales", contributionId: "sales.opportunities.collection" },
    { slug: "sales-tasks", pluginId: "module.sales", contributionId: "sales.tasks.collection" }
  ]);
  assert.equal(await collection.access.read({ req: { user: null, context: {} } }), false);
  assert.equal(await collection.access.read({ req: { user: { id: "actor-1", collection: "users" }, context: {} } }), false);
  assert.equal(await collection.access.read({ req: { user: { id: "key-1", collection: "payload-mcp-api-keys" }, context: {} } }), false);
});
