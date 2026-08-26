import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import pg from "pg";
import { createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";

const bootKey = process.env.BOOT_KEY;
const payload = await bootGate1Application({ key: bootKey });
const owner = await payload.create({
  collection: "users",
  data: { email: "mcp-lifecycle@example.test", password: "mcp-lifecycle-password" }
});
const actor = { ...owner, collection: "users" };
const validSecret = "f4ba11f7-8f49-40dd-8c4f-4bda4d5ec948";

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
