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
    { slug: "sales-accounts", pluginId: "module.sales", contributionId: "sales.accounts.collection" },
    { slug: "sales-activities", pluginId: "module.sales", contributionId: "sales.activities.collection" },
    { slug: "sales-attachment-references", pluginId: "module.sales", contributionId: "sales.attachment-references.collection" },
    { slug: "sales-contacts", pluginId: "module.sales", contributionId: "sales.contacts.collection" },
    { slug: "sales-export-jobs", pluginId: "module.sales", contributionId: "sales.export-jobs.collection" },
    { slug: "sales-import-chunks", pluginId: "module.sales", contributionId: "sales.import-chunks.collection" },
    { slug: "sales-import-jobs", pluginId: "module.sales", contributionId: "sales.import-jobs.collection" },
    { slug: "sales-import-rows", pluginId: "module.sales", contributionId: "sales.import-rows.collection" },
    { slug: "sales-leads", pluginId: "module.sales", contributionId: "sales.leads.collection" },
    { slug: "sales-merge-lineage", pluginId: "module.sales", contributionId: "sales.merge-lineage.collection" },
    { slug: "sales-notes", pluginId: "module.sales", contributionId: "sales.notes.collection" },
    { slug: "sales-notifications", pluginId: "module.sales", contributionId: "sales.notifications.collection" },
    { slug: "sales-opportunities", pluginId: "module.sales", contributionId: "sales.opportunities.collection" },
    { slug: "sales-pipeline-stages", pluginId: "module.sales", contributionId: "sales.pipeline-stages.collection" },
    { slug: "sales-pipelines", pluginId: "module.sales", contributionId: "sales.pipelines.collection" },
    { slug: "sales-reminders", pluginId: "module.sales", contributionId: "sales.reminders.collection" },
    { slug: "sales-saved-views", pluginId: "module.sales", contributionId: "sales.saved-views.collection" },
    { slug: "sales-tasks", pluginId: "module.sales", contributionId: "sales.tasks.collection" }
  ]);
  assert.equal(await collection.access.read({ req: { user: null, context: {} } }), false);
  assert.equal(await collection.access.read({ req: { user: { id: "actor-1", collection: "users" }, context: {} } }), false);
  assert.equal(await collection.access.read({ req: { user: { id: "key-1", collection: "payload-mcp-api-keys" }, context: {} } }), false);
});
