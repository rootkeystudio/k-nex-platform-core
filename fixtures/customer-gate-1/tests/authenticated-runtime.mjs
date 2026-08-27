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
await payload.create({
  collection: "sales-tasks",
  data: { title: "Done actor query", status: "done", potentialRevenue: "25", privateNote: "done-secret" }
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

const query = await payload.find({
  collection: "sales-tasks",
  overrideAccess: false,
  req: authenticatedRequest
});
assert.equal(query.docs.length, 2);
assert.equal(query.docs.some((document) => document.title === "Authenticated Gate 1 query"), true);

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

const updatedOpenTask = await payload.update({
  collection: "sales-tasks",
  id: openTask.id,
  data: { title: "Mutated by authorized direct write" },
  user: login.user,
  overrideAccess: false
});
assert.equal(updatedOpenTask.title, "Mutated by authorized direct write");

const peerResponse = await callSource(peerLogin.token);
assert.equal(peerResponse.status, 200);
const peerResult = await peerResponse.json();
assert.deepEqual(peerResult.data.fields, openResult.data.fields);
assert.deepEqual(peerResult.data.rows.map((row) => row.values.title.value), ["Mutated by authorized direct write"]);
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
    actions: { "sales.task.create": "required" },
    schema: { "sales.tasks.collection": "required" },
    sources: { "sales.tasks": "required", "sales.total-potential-revenue": "required" },
    tools: { "sales.tools.create-task": "required", "sales.tools.search-tasks": "required" }
  },
  actualContributions: {
    actions: ["sales.task.create"],
    schema: ["sales.tasks.collection"],
    sources: ["sales.tasks", "sales.total-potential-revenue"],
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
  migrationName: "20260826_000005_outbox_processor",
  predecessor: 4,
  current: 5
});
const serializedInventory = JSON.stringify(inventory);
for (const forbidden of [process.env.DATABASE_URL, process.env.PAYLOAD_SECRET, login.token, password, "gate1@example.test"]) {
  assert.equal(serializedInventory.includes(forbidden), false);
}

console.log("P1_8_PASS");
process.exit(0);
