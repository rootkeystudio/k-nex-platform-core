import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";

const key = process.env.BOOT_KEY;
const password = "gate1-authenticated-query-password";
const payload = await bootGate1Application({ key });

for (const email of ["gate1@example.test", "gate1-peer@example.test", "done@example.test", "no-note@example.test", "required-denied@example.test"]) {
  await payload.create({ collection: "users", data: { email, password } });
}
const openTask = await payload.create({
  collection: "sales-tasks",
  data: { title: "Authenticated Gate 1 query", status: "open", potentialRevenue: "100", privateNote: "open-secret" }
});
const doneTask = await payload.create({
  collection: "sales-tasks",
  data: { title: "Done actor query", status: "done", potentialRevenue: "25", privateNote: "done-secret" }
});
const leadOpportunity = await payload.create({
  collection: "sales-opportunities",
  data: { name: "Lead opportunity", stage: "lead", value: "250" }
});
const wonOpportunity = await payload.create({
  collection: "sales-opportunities",
  data: { name: "Won opportunity", stage: "won", value: "500" }
});

const loginAs = (email) => payload.login({ collection: "users", data: { email, password }, overrideAccess: false });
const login = await loginAs("gate1@example.test");
const peerLogin = await loginAs("gate1-peer@example.test");
assert.ok(login.token);
assert.ok(peerLogin.token);
assert.notEqual(login.user.id, peerLogin.user.id);

const authenticatedRequest = await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/runtime-inventory", {
    headers: { authorization: `JWT ${login.token}` }
  })
});
assert.ok(authenticatedRequest.user);

await assert.rejects(payload.find({
  collection: "sales-tasks",
  overrideAccess: false,
  req: authenticatedRequest
}), /not allowed|forbidden|permission/i);

const dataSourceEndpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/data-source-query");
assert.ok(dataSourceEndpoint);
const sourceBody = {
  sourceId: "sales.tasks",
  surface: "workspace",
  input: {},
  query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
  selectedFields: ["title", "status", "potential-revenue", "private-note"]
};
const sourceRequest = async (token, body = sourceBody) => createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/data-source-query", {
    method: "POST",
    headers: { authorization: `JWT ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  })
});
const callSource = async (token, body) => dataSourceEndpoint.handler(await sourceRequest(token, body));

const openResponse = await callSource(login.token);
assert.equal(openResponse.status, 200);
const openResult = await openResponse.json();
assert.deepEqual(openResult.data.fields, sourceBody.selectedFields);
assert.deepEqual(openResult.data.rows.map((row) => row.values.title.value), ["Authenticated Gate 1 query"]);

const forgedScopeResponse = await callSource(login.token, {
  ...sourceBody,
  query: {
    ...sourceBody.query,
    recordScope: { kind: "sales.tasks", where: { status: { equals: "done" } } }
  }
});
assert.equal(forgedScopeResponse.status, 400);
assert.equal((await forgedScopeResponse.json()).code, "INVALID_QUERY_CONTROLS");

await assert.rejects(payload.update({
  collection: "sales-tasks",
  id: openTask.id,
  data: { title: "Mutated by authorized direct write" },
  user: login.user,
  overrideAccess: false
}), /not allowed|forbidden|permission/i);

const peerResponse = await callSource(peerLogin.token);
assert.equal(peerResponse.status, 200);
const peerResult = await peerResponse.json();
assert.deepEqual(peerResult.data.fields, openResult.data.fields);
assert.deepEqual(peerResult.data.rows.map((row) => row.values.title.value), ["Authenticated Gate 1 query"]);
assert.deepEqual(peerResult.data.rows.map((row) => row.values.status.value), ["open"]);

const unknownResponse = await callSource(login.token, { ...sourceBody, sourceId: "sales.tasks.other" });
assert.equal(unknownResponse.status, 404);
assert.equal((await unknownResponse.json()).code, "SOURCE_NOT_FOUND");

const deniedLogin = await loginAs("required-denied@example.test");
const deniedResponse = await callSource(deniedLogin.token, { ...sourceBody, selectedFields: sourceBody.selectedFields.slice(0, 3) });
assert.equal(deniedResponse.status, 403);
assert.equal((await deniedResponse.json()).code, "INSUFFICIENT_FIELD_PERMISSION");

const noNoteLogin = await loginAs("no-note@example.test");
const noNoteResponse = await callSource(noNoteLogin.token);
assert.equal(noNoteResponse.status, 200);
const noNoteResult = await noNoteResponse.json();
assert.deepEqual(noNoteResult.data.fields, sourceBody.selectedFields.slice(0, 3));
assert.equal("private-note" in noNoteResult.data.rows[0].values, false);

const doneLogin = await loginAs("done@example.test");
const doneResponse = await callSource(doneLogin.token);
assert.equal(doneResponse.status, 200);
const doneResult = await doneResponse.json();
assert.deepEqual(doneResult.data.rows.map((row) => row.values.title.value), ["Done actor query"]);
assert.notDeepEqual(doneResult.data.rows, openResult.data.rows);

const opportunitiesBody = {
  ...sourceBody,
  sourceId: "sales.opportunities",
  selectedFields: ["name", "stage", "value"]
};
const opportunitiesResponse = await callSource(login.token, opportunitiesBody);
assert.equal(opportunitiesResponse.status, 200);
const opportunitiesResult = await opportunitiesResponse.json();
assert.deepEqual(opportunitiesResult.data.rows.map((row) => row.values.name.value), ["Lead opportunity"]);
const wonScopeResponse = await callSource(doneLogin.token, opportunitiesBody);
assert.equal(wonScopeResponse.status, 200);
assert.deepEqual((await wonScopeResponse.json()).data.rows.map((row) => row.values.name.value), ["Won opportunity"]);

const metricResponse = await callSource(login.token, {
  sourceId: "sales.total-potential-revenue",
  surface: "workspace",
  input: {},
  query: { filters: [], sort: [] },
  selectedFields: []
});
assert.equal(metricResponse.status, 200);
assert.equal((await metricResponse.json()).data.value.value, "100");

const actionEndpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/action");
assert.ok(actionEndpoint);
const callAction = async (token, actionId, input, idempotencyKey) => actionEndpoint.handler(await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/action", {
    method: "POST",
    headers: { authorization: `JWT ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ actionId, input })
  })
}));
const createResponse = await callAction(login.token, "sales.task.create", { title: "Gateway-created task", status: "open" }, "action-create-1");
assert.equal(createResponse.status, 200);
const createdTask = (await createResponse.json()).data;
const updateResponse = await callAction(login.token, "sales.task.update", { id: createdTask.id, status: "done" }, "action-update-1");
assert.equal(updateResponse.status, 200);
assert.equal((await updateResponse.json()).data.status, "done");
const stageResponse = await callAction(login.token, "sales.opportunity.stage.update", { id: String(leadOpportunity.id), stage: "qualified" }, "action-stage-1");
assert.equal(stageResponse.status, 200);
assert.equal((await stageResponse.json()).data.stage, "qualified");
const forbiddenTask = await callAction(login.token, "sales.task.update", { id: String(doneTask.id), status: "open" }, "action-forbidden-task");
assert.equal(forbiddenTask.status, 403);
assert.equal((await forbiddenTask.json()).code, "ACTION_TARGET_FORBIDDEN");
const forbiddenOpportunity = await callAction(login.token, "sales.opportunity.stage.update", { id: String(wonOpportunity.id), stage: "lost" }, "action-forbidden-opportunity");
assert.equal(forbiddenOpportunity.status, 403);
assert.equal((await forbiddenOpportunity.json()).code, "ACTION_TARGET_FORBIDDEN");

const unauthenticatedRequest = await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/runtime-inventory")
});
await assert.rejects(
  payload.find({
    collection: "sales-tasks",
    overrideAccess: false,
    req: unauthenticatedRequest
  }),
  (error) => error?.status === 403
);

const endpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/runtime-inventory");
assert.ok(endpoint);
const deniedInventory = await endpoint.handler(unauthenticatedRequest);
assert.equal(deniedInventory.status, 401);

const inventoryResponse = await endpoint.handler(authenticatedRequest);
assert.equal(inventoryResponse.status, 200);
assert.equal(inventoryResponse.headers.get("cache-control"), "private, no-store");
const inventory = await inventoryResponse.json();
assert.equal(inventory.applicationId, "customer-gate-1");
const resolvedGraphDigest = `sha256:${createHash("sha256")
  .update(readFileSync(new URL("../.k-nex/generated/k-nex.resolved.json", import.meta.url)))
  .digest("hex")}`;
assert.equal(inventory.resolvedGraphDigest, resolvedGraphDigest);
assert.match(inventory.sourceArtifact.digest, /^sha256:[0-9a-f]{64}$/);
assert.match(inventory.applicationManifestDigest, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(inventory.plugins, [{
  id: "module.sales",
  package: "@k-nex/module-sales",
  version: "1.0.0",
  integrity: inventory.plugins[0].integrity,
  expectedContributions: {
    actions: {
      "sales.opportunity.stage.update": "required",
      "sales.task.create": "required",
      "sales.task.update": "required"
    },
    blocks: {
      "sales.opportunity-detail": "required",
      "sales.opportunity-list": "required",
      "sales.revenue-metric": "required",
      "sales.settings-summary": "required",
      "sales.task-quick-create": "required",
      "sales.task-table": "required"
    },
    components: {
      "sales.detail.opportunity": "required",
      "sales.form.task-quick-create": "required",
      "sales.list.opportunities": "required",
      "sales.metric.total-potential-revenue": "required",
      "sales.status.pipeline-stage": "required",
      "sales.table.tasks": "required"
    },
    events: {
      "sales.event.opportunity-changed": "required",
      "sales.event.task-changed": "required"
    },
    healthAudit: { "sales.health.runtime": "required" },
    jobs: { "sales.job.pipeline-audit": "required" },
    lifecycle: { "sales.lifecycle.reference": "required" },
    localization: { "sales.localization.en": "required" },
    migrations: { "sales.migration.initial": "required" },
    navigation: {
      "sales.navigation.opportunities": "required",
      "sales.navigation.overview": "required",
      "sales.navigation.settings": "required",
      "sales.navigation.tasks": "required"
    },
    pageTemplates: {
      "sales.page.opportunities": "required",
      "sales.page.overview": "required",
      "sales.page.settings": "required",
      "sales.page.tasks": "required"
    },
    permissions: {
      "sales.opportunities.name.read": "required",
      "sales.opportunities.read": "required",
      "sales.opportunities.stage.read": "required",
      "sales.opportunities.value.read": "required",
      "sales.opportunities.write": "required",
      "sales.settings.read": "required",
      "sales.settings.write": "required",
      "sales.tasks.private-note.read": "required",
      "sales.tasks.read": "required",
      "sales.tasks.revenue.read": "required",
      "sales.tasks.status.read": "required",
      "sales.tasks.title.read": "required",
      "sales.tasks.write": "required"
    },
    realtimeTopics: {
      "sales.realtime.opportunities": "required",
      "sales.realtime.tasks": "required"
    },
    routes: {
      "sales.route.opportunities": "required",
      "sales.route.overview": "required",
      "sales.route.settings": "required",
      "sales.route.tasks": "required"
    },
    schema: {
      "sales.opportunities.collection": "required",
      "sales.tasks.collection": "required"
    },
    services: { "sales.service.domain": "required" },
    settings: { "sales.settings.workspace": "required" },
    sources: {
      "sales.opportunities": "required",
      "sales.tasks": "required",
      "sales.total-potential-revenue": "required"
    },
    testingMetadata: { "sales.testing.conformance": "required" },
    tools: { "sales.tools.create-task": "required", "sales.tools.search-tasks": "required" }
  },
  actualContributions: {
    actions: ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"],
    blocks: ["sales.opportunity-detail", "sales.opportunity-list", "sales.revenue-metric", "sales.settings-summary", "sales.task-quick-create", "sales.task-table"],
    components: ["sales.detail.opportunity", "sales.form.task-quick-create", "sales.list.opportunities", "sales.metric.total-potential-revenue", "sales.status.pipeline-stage", "sales.table.tasks"],
    events: ["sales.event.opportunity-changed", "sales.event.task-changed"],
    healthAudit: ["sales.health.runtime"],
    jobs: ["sales.job.pipeline-audit"],
    lifecycle: ["sales.lifecycle.reference"],
    localization: ["sales.localization.en"],
    migrations: ["sales.migration.initial"],
    navigation: ["sales.navigation.opportunities", "sales.navigation.overview", "sales.navigation.settings", "sales.navigation.tasks"],
    pageTemplates: ["sales.page.opportunities", "sales.page.overview", "sales.page.settings", "sales.page.tasks"],
    permissions: ["sales.opportunities.name.read", "sales.opportunities.read", "sales.opportunities.stage.read", "sales.opportunities.value.read", "sales.opportunities.write", "sales.settings.read", "sales.settings.write", "sales.tasks.private-note.read", "sales.tasks.read", "sales.tasks.revenue.read", "sales.tasks.status.read", "sales.tasks.title.read", "sales.tasks.write"],
    realtimeTopics: ["sales.realtime.opportunities", "sales.realtime.tasks"],
    routes: ["sales.route.opportunities", "sales.route.overview", "sales.route.settings", "sales.route.tasks"],
    schema: ["sales.opportunities.collection", "sales.tasks.collection"],
    services: ["sales.service.domain"],
    settings: ["sales.settings.workspace"],
    sources: ["sales.opportunities", "sales.tasks", "sales.total-potential-revenue"],
    testingMetadata: ["sales.testing.conformance"],
    tools: ["sales.tools.create-task", "sales.tools.search-tasks"]
  }
}, {
  id: "provider.realtime.socketio",
  package: "@k-nex/provider-realtime-socketio",
  version: "1.0.0",
  integrity: inventory.plugins[1].integrity,
  expectedContributions: {},
  actualContributions: {}
}]);
assert.deepEqual(inventory.migrationRevision, {
  migrationName: "20260829_000007_runtime_extensions",
  predecessor: 6,
  current: 7
});
const serializedInventory = JSON.stringify(inventory);
for (const forbidden of [process.env.DATABASE_URL, process.env.PAYLOAD_SECRET, login.token, password, "gate1@example.test"]) {
  assert.equal(serializedInventory.includes(forbidden), false);
}

console.log("P1_8_PASS");
process.exit(0);
