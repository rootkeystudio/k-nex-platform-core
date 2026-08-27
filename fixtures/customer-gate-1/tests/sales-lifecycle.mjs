import assert from "node:assert/strict";

import { buildConfig, createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";
import { createGate1Application } from "../dist/src/create-application.js";
import { migrations } from "../dist/src/migrations/index.js";

const databaseUrl = process.env.DATABASE_URL;
const payloadSecret = process.env.PAYLOAD_SECRET;
const baseKey = process.env.BOOT_KEY;
assert.ok(databaseUrl && payloadSecret && baseKey);

async function boot(enabled, suffix) {
  const application = createGate1Application({ databaseUrl, migrations, payloadSecret, salesEnabled: enabled });
  const key = `${baseKey}-${suffix}`;
  const payload = await bootGate1Application({ config: buildConfig(application.config), key });
  return { application, key, payload };
}

async function login(payload) {
  return payload.login({ collection: "users", data: { email: "sales-lifecycle@example.test", password: "sales-lifecycle-password" }, overrideAccess: false });
}

async function sourceRequest(payload, key, token) {
  const endpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/data-source-query");
  assert.ok(endpoint);
  const req = await createPayloadRequest({
    config: payload.config,
    payloadInstanceCacheKey: key,
    request: new Request("http://localhost/api/k-nex/data-source-query", {
      method: "POST",
      headers: { authorization: `JWT ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: "sales.tasks", surface: "workspace", input: {},
        query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
        selectedFields: ["title", "status", "potential-revenue"]
      })
    })
  });
  return endpoint.handler(req);
}

const enabled = await boot(true, "enabled");
await enabled.payload.create({ collection: "users", data: { email: "sales-lifecycle@example.test", password: "sales-lifecycle-password" } });
await enabled.payload.create({ collection: "sales-tasks", data: { title: "Lifecycle retained task", status: "open", potentialRevenue: "42" } });
const enabledLogin = await login(enabled.payload);
assert.equal((await sourceRequest(enabled.payload, enabled.key, enabledLogin.token)).status, 200);
assert.equal(enabled.application.salesAvailability.isAvailable("actions", "sales.task.create"), true);
await enabled.payload.destroy();

const disabled = await boot(false, "disabled");
const disabledLogin = await login(disabled.payload);
assert.equal(disabled.application.salesAvailability.isAvailable("schema", "sales.tasks.collection"), true);
for (const [kind, id] of [
  ["sources", "sales.tasks"], ["actions", "sales.task.create"], ["tools", "sales.tools.create-task"],
  ["jobs", "sales.job.pipeline-audit"], ["navigation", "sales.navigation.tasks"],
  ["components", "sales.table.tasks"], ["blocks", "sales.task-table"]
]) assert.equal(disabled.application.salesAvailability.isAvailable(kind, id), false);
assert.equal((await sourceRequest(disabled.payload, disabled.key, disabledLogin.token)).status, 404);
const retained = await disabled.payload.find({ collection: "sales-tasks", user: disabledLogin.user, overrideAccess: false });
assert.equal(retained.docs.some(({ title }) => title === "Lifecycle retained task"), true);
await assert.rejects(
  disabled.payload.update({ collection: "sales-tasks", id: retained.docs[0].id, data: { status: "done" }, user: disabledLogin.user, overrideAccess: false }),
  (error) => error?.status === 403
);
await disabled.payload.destroy();

const reenabled = await boot(true, "reenabled");
const reenabledLogin = await login(reenabled.payload);
const restored = await sourceRequest(reenabled.payload, reenabled.key, reenabledLogin.token);
assert.equal(restored.status, 200);
assert.equal((await restored.json()).data.rows.some(({ values }) => values.title.value === "Lifecycle retained task"), true);
await reenabled.payload.destroy();

console.log("P6_9_SALES_LIFECYCLE_PASS");
process.exit(0);
