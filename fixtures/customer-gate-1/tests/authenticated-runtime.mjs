import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";

const key = process.env.BOOT_KEY;
const password = "gate1-authenticated-query-password";
const payload = await bootGate1Application({ key });

await payload.create({
  collection: "users",
  data: { email: "gate1@example.test", password }
});
await payload.create({
  collection: "sales-tasks",
  data: { title: "Authenticated Gate 1 query", status: "open" }
});

const login = await payload.login({
  collection: "users",
  data: { email: "gate1@example.test", password },
  overrideAccess: false
});
assert.ok(login.token);

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
assert.equal(query.docs.length, 1);
assert.equal(query.docs[0].title, "Authenticated Gate 1 query");

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
  expectedContributions: { schema: ["sales.tasks.collection"] },
  actualContributions: { schema: ["sales.tasks.collection"] }
}]);
assert.deepEqual(inventory.migrationRevision, {
  migrationName: "20260826_000001_gate1",
  predecessor: 0,
  current: 1
});
const serializedInventory = JSON.stringify(inventory);
for (const forbidden of [process.env.DATABASE_URL, process.env.PAYLOAD_SECRET, login.token, password, "gate1@example.test"]) {
  assert.equal(serializedInventory.includes(forbidden), false);
}

console.log("P1_8_PASS");
process.exit(0);
