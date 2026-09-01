import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { bootstrapFirstOwner } from "@k-nex/runtime";
import { createPayloadRequest } from "payload";
import pg from "pg";

import { installStaticAuthorizationEnvironment, staticAuthorizationBuild } from "./static-authorization-build.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const directory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-gate-1";
const owner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });

installStaticAuthorizationEnvironment();

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-sales-scope-race", BOOT_KEY: "p10-sales-scope-race" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function seed(pool, userId) {
  const store = new PostgresAuthorizationStore(pool, {
    validate: (candidate, subject) => candidate === applicationId && subject.kind === "user" && subject.id === String(userId) ? "accepted" : "rejected"
  });
  const bootstrap = await bootstrapFirstOwner({
    store,
    expected: { applicationId, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 },
    firstOwner: { kind: "user", id: String(userId) }
  });
  const first = await store.transaction({
    applicationId, environment: "production", authorizationRevision: bootstrap.state.authorizationRevision, lifecycleRevision: bootstrap.state.lifecycleRevision
  }, async (transaction) => {
    await transaction.write({ kind: "extension-generation", generation: {
      schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["static-module-sales-1"], state: "current", authorizationRevision: 0, lifecycleRevision: 0
    } });
    await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: "sales.scope-race", label: "Sales scope race", revision: 0 } });
    await transaction.write({ kind: "assignment", assignment: {
      schemaVersion: 1, applicationId, id: "sales.scope-race.user", roleId: "sales.scope-race", principal: { kind: "user", id: String(userId) }, state: "active", revision: 0
    } });
  });
  await store.transaction({
    applicationId, environment: "production", authorizationRevision: first.state.authorizationRevision, lifecycleRevision: first.state.lifecycleRevision
  }, async (transaction) => {
    await transaction.write({ kind: "grant", grant: {
      schemaVersion: 1, applicationId, id: "sales.scope-race.write", roleId: "sales.scope-race", permissionId: "sales.tasks.write", owner, revision: 0
    } });
  });
  await pool.query(
    "insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation) values ($1,$2,$3,$4,1,'active',$5,$6::jsonb)",
    [applicationId, "production", "platform-plugin", "module.sales", "static-module-sales-1", JSON.stringify(staticAuthorizationBuild)]
  );
}

async function assertPendingWhileRowIsLocked(promise) {
  const settled = await Promise.race([
    promise.then(() => true, () => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 250))
  ]);
  assert.equal(settled, false, "Sales action must wait while the competing transaction owns the target row lock.");
}

test("P10.10 atomically rejects a Sales update after concurrent scope exit without write or event", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("sales_scope_race").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let payload;
  let locker;
  let pending;
  try {
    await boot(container.getConnectionUri());
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_SECRET = "p10-sales-scope-race";
    const { bootGate1Application } = await import("../dist/src/boot.js");
    payload = await bootGate1Application({ key: "p10-sales-scope-race" });
    const password = "p10-sales-scope-race-password";
    const user = await payload.create({ collection: "users", data: { email: "scope-race@example.test", password } });
    await seed(pool, user.id);
    const login = await payload.login({ collection: "users", data: { email: "scope-race@example.test", password }, overrideAccess: false });
    assert.ok(login.token);
    const action = payload.config.endpoints.find(({ path }) => path === "/k-nex/action");
    assert.ok(action);
    const request = (input, idempotencyKey) => createPayloadRequest({
      config: payload.config,
      payloadInstanceCacheKey: "p10-sales-scope-race",
      request: new Request("http://localhost/api/k-nex/action", {
        method: "POST",
        headers: { authorization: `JWT ${login.token}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ actionId: "sales.task.update", input })
      })
    });

    const positive = await payload.create({ collection: "sales-tasks", data: { title: "Scoped success", status: "open" }, overrideAccess: true });
    const positiveResponse = await action.handler(await request({ id: String(positive.id), title: "Updated in scope" }, "p10-sales-scope-positive"));
    assert.equal(positiveResponse.status, 200);
    assert.deepEqual((await pool.query("select title, status from sales_tasks where id=$1", [positive.id])).rows, [{ title: "Updated in scope", status: "open" }]);
    assert.deepEqual((await pool.query("select count(*)::int count from k_nex_outbox where event_id=$1", ["p10-sales-scope-positive"])).rows, [{ count: 1 }]);

    const target = await payload.create({ collection: "sales-tasks", data: { title: "Must not update", status: "open" }, overrideAccess: true });
    locker = await pool.connect();
    await locker.query("begin");
    await locker.query("update sales_tasks set status='done' where id=$1", [target.id]);
    pending = action.handler(await request({ id: String(target.id), title: "Forbidden after scope exit" }, "p10-sales-scope-race"));
    await assertPendingWhileRowIsLocked(pending);
    await locker.query("commit");
    locker.release();
    locker = undefined;

    const blocked = await pending;
    pending = undefined;
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, "ACTION_TARGET_FORBIDDEN");
    assert.deepEqual((await pool.query("select title, status from sales_tasks where id=$1", [target.id])).rows, [{ title: "Must not update", status: "done" }]);
    assert.deepEqual((await pool.query("select count(*)::int count from k_nex_outbox where event_id=$1", ["p10-sales-scope-race"])).rows, [{ count: 0 }]);
  } finally {
    await locker?.query("rollback").catch(() => undefined);
    locker?.release();
    await pending?.catch(() => undefined);
    const payloadPool = payload?.db?.pool;
    // Payload 3.88's adapter destroy does not close its pool; absorb expected idle-client termination during container teardown.
    payloadPool?.on("error", () => undefined);
    await payload?.destroy();
    await pool.end();
    await container.stop();
  }
});
