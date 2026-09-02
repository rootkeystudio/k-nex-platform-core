import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import pg from "pg";
import { createPayloadRequest } from "payload";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { bootstrapFirstOwner } from "@k-nex/runtime";

import { bootGate1Application } from "../dist/src/boot.js";
import { installStaticAuthorizationEnvironment, staticAuthorizationBuild } from "./static-authorization-build.mjs";

installStaticAuthorizationEnvironment();

const bootKey = process.env.BOOT_KEY;
const payload = await bootGate1Application({ key: bootKey });
const owner = await payload.create({
  collection: "users",
  data: { email: "mcp-lifecycle@example.test", password: "mcp-lifecycle-password" }
});
const actor = { ...owner, collection: "users" };
const validSecret = "f4ba11f7-8f49-40dd-8c4f-4bda4d5ec948";
const pool = payload.db?.pool;
assert.ok(pool && typeof pool === "object" && "connect" in pool && "query" in pool);
const store = new PostgresAuthorizationStore(pool, {
  validate: (applicationId, subject) => applicationId === "customer-gate-1" && subject.kind === "user" && subject.id === String(owner.id)
    ? "accepted"
    : "rejected"
});
const initialState = await store.readState("customer-gate-1", "production");
const state = initialState === undefined
  ? (await bootstrapFirstOwner({
    store,
    expected: { applicationId: "customer-gate-1", environment: "production", authorizationRevision: 0, lifecycleRevision: 0 },
    firstOwner: { kind: "user", id: String(owner.id) }
  })).state
  : initialState;
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
    id: "fixture.mcp-sales-tools",
    applicationId: "customer-gate-1",
    label: "Fixture MCP Sales tools",
    revision: 0
  } });
  for (const permissionId of ["sales.tasks.read", "sales.tasks.write"]) {
    await transaction.write({ kind: "grant", grant: {
      schemaVersion: 1,
      id: `fixture.mcp-sales-tools.${permissionId}`,
      applicationId: "customer-gate-1",
      roleId: "fixture.mcp-sales-tools",
      permissionId,
      owner: salesOwner,
      revision: 0
    } });
  }
  await transaction.write({ kind: "assignment", assignment: {
    schemaVersion: 1,
    id: "fixture.mcp-sales-tools.owner",
    applicationId: "customer-gate-1",
    roleId: "fixture.mcp-sales-tools",
    principal: { kind: "user", id: String(owner.id) },
    state: "active",
    revision: 0
  } });
});
if (existingRuntime.rowCount === 0) await pool.query(
  "insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation) values ($1,$2,$3,$4,1,'active',$5,$6::jsonb)",
  ["customer-gate-1", "production", "platform-plugin", "module.sales", "static-module-sales-1", JSON.stringify(staticAuthorizationBuild)]
);

try {
  await assert.rejects(payload.create({
    collection: "payload-mcp-api-keys",
    data: {
      label: "overlong-create",
      expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000).toISOString(),
      enableAPIKey: true,
      apiKey: "gate-2a-overlong-create-key"
    },
    overrideAccess: false,
    user: actor
  }), (error) => error?.status === 400);

  const validKey = await payload.create({
    collection: "payload-mcp-api-keys",
    data: {
      label: "valid-lifecycle",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      enableAPIKey: true,
      apiKey: validSecret
    },
    overrideAccess: false,
    user: actor
  });
  assert.equal(validKey.user.id ?? validKey.user, owner.id);

  const validDigest = createHmac("sha256", payload.secret).update(validSecret).digest("hex");
  const createdKey = await payload.find({
    collection: "payload-mcp-api-keys",
    overrideAccess: true,
    pagination: false,
    where: { apiKeyIndex: { equals: validDigest } }
  });
  assert.equal(createdKey.docs.length, 1);

  await assert.rejects(payload.update({
    collection: "payload-mcp-api-keys",
    id: validKey.id,
    data: { expiresAt: new Date(Date.parse(validKey.createdAt) + 31 * 24 * 60 * 60 * 1_000).toISOString() },
    overrideAccess: false,
    user: actor
  }), (error) => error?.status === 400);

  const updatedKey = await payload.update({
    collection: "payload-mcp-api-keys",
    id: validKey.id,
    data: { label: "valid-lifecycle-updated" },
    overrideAccess: false,
    user: actor
  });
  assert.equal(updatedKey.label, "valid-lifecycle-updated");

  const mcpEndpoint = payload.config.endpoints.find(({ method, path }) => method === "post" && path === "/mcp");
  assert.ok(mcpEndpoint);
  const mcpRequest = (secret) => createPayloadRequest({
    config: payload.config,
    payloadInstanceCacheKey: bootKey,
    request: new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    })
  });
  const validResponse = await mcpEndpoint.handler(await mcpRequest(validSecret));
  const validText = await validResponse.text();
  const validData = validText.startsWith("{")
    ? validText
    : validText.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  assert.ok(validData);
  assert.deepEqual(JSON.parse(validData).result.tools.map(({ name }) => name), [
    "k-nex-sales-tools-create-task-v1",
    "k-nex-sales-tools-search-tasks-v1"
  ]);

  const apiKeyRequest = await createPayloadRequest({
    config: payload.config,
    payloadInstanceCacheKey: bootKey,
    request: new Request("http://localhost/api/sales-tasks", {
      headers: { authorization: `payload-mcp-api-keys API-Key ${validSecret}` }
    })
  });
  assert.equal(apiKeyRequest.user, null);
  assert.equal(payload.authStrategies.some(({ name }) => name === "payload-mcp-api-keys-api-key"), false);
  await assert.rejects(payload.find({
    collection: "sales-tasks",
    overrideAccess: false,
    req: apiKeyRequest
  }), (error) => error?.status === 403);

  const inventoryEndpoint = payload.config.endpoints.find(({ method, path }) => method === "get" && path === "/k-nex/runtime-inventory");
  assert.equal((await inventoryEndpoint.handler(apiKeyRequest)).status, 401);
  const sourceEndpoint = payload.config.endpoints.find(({ method, path }) => method === "post" && path === "/k-nex/data-source-query");
  const sourceRequest = await createPayloadRequest({
    config: payload.config,
    payloadInstanceCacheKey: bootKey,
    request: new Request("http://localhost/api/k-nex/data-source-query", {
      method: "POST",
      headers: {
        authorization: `payload-mcp-api-keys API-Key ${validSecret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sourceId: "sales.tasks",
        surface: "workspace",
        input: {},
        query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
        selectedFields: ["title"]
      })
    })
  });
  const sourceDenied = await sourceEndpoint.handler(sourceRequest);
  assert.equal(sourceDenied.status, 403);
  assert.equal((await sourceDenied.json()).code, "SOURCE_AUDIENCE_FORBIDDEN");

  const disabledKey = await payload.update({
    collection: "payload-mcp-api-keys",
    id: validKey.id,
    data: { enableAPIKey: false },
    overrideAccess: false,
    user: actor
  });
  assert.equal(disabledKey.enableAPIKey, false);
  await assert.rejects(mcpEndpoint.handler(await mcpRequest(validSecret)), (error) => error?.status === 401);

  const dormantSecret = "gate-2a-dormant-overlong-key";
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query({
      text: `
        insert into payload_mcp_api_keys
          (user_id, label, expires_at, created_at, updated_at, enable_a_p_i_key, api_key_index)
        values ($1, 'dormant-overlong', now() + interval '20 days', now() - interval '365 days', now(), true, $2)
      `,
      values: [owner.id, createHmac("sha256", payload.secret).update(dormantSecret).digest("hex")]
    });
  } finally {
    await client.end();
  }
  await assert.rejects(mcpEndpoint.handler(await mcpRequest(dormantSecret)), (error) => error?.status === 401);

  console.log("P2A_MCP_LIFECYCLE_PASS");
} finally {
  void payload.destroy();
}
process.exit(0);
