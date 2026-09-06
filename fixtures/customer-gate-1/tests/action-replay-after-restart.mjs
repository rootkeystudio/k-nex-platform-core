import assert from "node:assert/strict";

import { createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";
import { installStaticAuthorizationEnvironment } from "./static-authorization-build.mjs";

installStaticAuthorizationEnvironment();

const key = process.env.BOOT_KEY;
const payload = await bootGate1Application({ key });
const login = await payload.login({ collection: "users", data: { email: "gate1@example.test", password: "gate1-authenticated-query-password" }, overrideAccess: false });
const endpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/action");
assert.ok(endpoint);
const pool = payload.db?.pool;
assert.ok(pool && typeof pool === "object" && "query" in pool);
const before = await pool.query(`select result_json->'data' as data from sales_action_idempotency
  where application_id='customer-gate-1' and environment='production' and effective_actor_id=$1 and action_id='sales.task.create' and idempotency_key='action-create-1'`, [String(login.user.id)]);
assert.equal(before.rowCount, 1);
const response = await endpoint.handler(await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/action", {
    method: "POST",
    headers: { authorization: `JWT ${login.token}`, "content-type": "application/json", "idempotency-key": "action-create-1" },
    body: JSON.stringify({ actionId: "sales.task.create", input: { title: "Gateway-created task" } })
  })
}));
assert.equal(response.status, 200);
assert.deepEqual((await response.json()).data, before.rows[0].data);
assert.equal((await pool.query("select count(*)::int as count from sales_tasks where title='Gateway-created task'")).rows[0].count, 1);
await payload.destroy();
console.log("P13_ACTION_RESTART_REPLAY_PASS");
process.exit(0);
