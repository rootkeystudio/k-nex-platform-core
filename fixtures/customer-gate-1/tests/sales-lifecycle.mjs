import assert from "node:assert/strict";

import { buildConfig, createPayloadRequest } from "payload";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { bootstrapFirstOwner } from "@k-nex/runtime";

import { bootGate1Application } from "../dist/src/boot.js";
import { createGate1Application } from "../dist/src/create-application.js";
import { installStaticAuthorizationEnvironment, staticAuthorizationBuild } from "./static-authorization-build.mjs";
import { migrations } from "../dist/src/migrations/index.js";

const databaseUrl = process.env.DATABASE_URL;
const payloadSecret = process.env.PAYLOAD_SECRET;
const baseKey = process.env.BOOT_KEY;
assert.ok(databaseUrl && payloadSecret && baseKey);

installStaticAuthorizationEnvironment();

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
const user = await enabled.payload.create({ collection: "users", data: { email: "sales-lifecycle@example.test", password: "sales-lifecycle-password" } });
const pool = enabled.payload.db?.pool;
assert.ok(pool && typeof pool === "object" && "connect" in pool && "query" in pool);
const store = new PostgresAuthorizationStore(pool, {
  validate: (applicationId, subject) => applicationId === "customer-gate-1" && subject.kind === "user" && subject.id === String(user.id)
    ? "accepted"
    : "rejected"
});
const state = await store.readState("customer-gate-1", "production") ?? (await bootstrapFirstOwner({
  store,
  expected: { applicationId: "customer-gate-1", environment: "production", authorizationRevision: 0, lifecycleRevision: 0 },
  firstOwner: { kind: "user", id: String(user.id) }
})).state;
const salesOwner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });
const existingGeneration = await pool.query(
  "select 1 from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and authorization_generation=1",
  ["customer-gate-1"]
);
const existingRuntime = await pool.query(
  "select 1 from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'",
  ["customer-gate-1", "production"]
);
await store.transaction({
  applicationId: "customer-gate-1",
  environment: "production",
  authorizationRevision: state.authorizationRevision,
  lifecycleRevision: state.lifecycleRevision
}, async (transaction) => {
  if (existingGeneration.rowCount === 0) await transaction.write({ kind: "extension-generation", generation: {
    schemaVersion: 1,
    applicationId: "customer-gate-1",
    owner: salesOwner,
    runtimeGenerationIds: ["static-module-sales-1"],
    state: "current",
    authorizationRevision: state.authorizationRevision,
    lifecycleRevision: state.lifecycleRevision
  } });
  await transaction.write({ kind: "role", role: {
    schemaVersion: 1,
    id: "fixture.sales-reader",
    applicationId: "customer-gate-1",
    label: "Fixture Sales reader",
    revision: 0
  } });
  for (const permissionId of ["sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read"]) {
    await transaction.write({ kind: "grant", grant: {
      schemaVersion: 1,
      id: `fixture.sales-reader.${permissionId}`,
      applicationId: "customer-gate-1",
      roleId: "fixture.sales-reader",
      permissionId,
      owner: salesOwner,
      revision: 0
    } });
  }
  await transaction.write({ kind: "assignment", assignment: {
    schemaVersion: 1,
    id: "fixture.sales-reader.user",
    applicationId: "customer-gate-1",
    roleId: "fixture.sales-reader",
    principal: { kind: "user", id: String(user.id) },
    state: "active",
    revision: 0
  } });
});
if (existingRuntime.rowCount === 0) await pool.query(
  "insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation) values ($1,$2,$3,$4,1,'active',$5,$6::jsonb)",
  ["customer-gate-1", "production", "platform-plugin", "module.sales", "static-module-sales-1", JSON.stringify(staticAuthorizationBuild)]
);
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
const retained = await disabled.payload.find({ collection: "sales-tasks", overrideAccess: true });
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
