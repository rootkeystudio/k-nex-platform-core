import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { salesTaskCreateHandler } from "@k-nex/module-sales/server";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { createPayloadRequest, getPayload } from "payload";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const testPath = fileURLToPath(import.meta.url);
const runtimeRole = "p9_sales_runtime";
const runtimeKey = "p9-sales-runtime-role";
const committedTitle = "Runtime role task";
const committedEventId = "p9-runtime-role-sales-task-created";

function run(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: fixtureDirectory, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function roleConnection(connectionString) {
  const url = new URL(connectionString);
  url.username = runtimeRole;
  url.password = "p9-sales-runtime-password";
  return url.toString();
}

async function runRuntimeRoleChild() {
  let payload;
  let runtime;
  try {
    const { default: config } = await import("../dist/src/payload.config.js");
    payload = await getPayload({ config, key: runtimeKey });
    const request = await createPayloadRequest({
      config: payload.config,
      payloadInstanceCacheKey: runtimeKey,
      request: new Request("http://localhost/api/sales-tasks", { headers: { "x-correlation-id": "p9-runtime-role" } })
    });
    const transactionID = await request.payload.db.beginTransaction();
    assert.ok(transactionID, "Payload must open the PostgreSQL transaction used by Sales and its outbox hook.");
    request.transactionID = transactionID;
    const task = await salesTaskCreateHandler({
      actor: { principal: { kind: "service", id: "p9-runtime-role" }, effectiveActor: { kind: "service", id: "p9-runtime-role" } },
      request,
      authorizationContext: { permissionFingerprint: "p9-runtime-role" },
      input: { title: committedTitle },
      idempotencyKey: committedEventId,
      signal: new AbortController().signal
    });
    assert.deepEqual(task, { id: "1", title: committedTitle, status: "open" });
    await payload.db.commitTransaction(transactionID);

    runtime = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await assert.rejects(runtime.query("create table p9_runtime_role_escape (id integer)"), /permission denied/u);
    await assert.rejects(runtime.query("update runtime_extensions set revision=revision+1"), /permission denied/u);
    process.stdout.write("P9_RUNTIME_ROLE_CHILD_PASS\n");
  } finally {
    await payload?.destroy();
    await runtime?.end();
  }
}

if (process.env.P9_RUNTIME_ROLE_CHILD === "1") {
  try {
    await runRuntimeRoleChild();
    process.exit(0);
  } catch (error) {
    console.error("P9_RUNTIME_ROLE_TEST_FAILURE", error);
    process.exit(1);
  }
} else {
  test("static Sales runtime role writes task and durable outbox only", { timeout: 180_000 }, async () => {
    const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_role").withStartupTimeout(120_000).start();
    const admin = new pg.Pool({ connectionString: postgres.getConnectionUri() });
    try {
      const boot = await run("tests/boot-once.mjs", {
        DATABASE_URL: postgres.getConnectionUri(), NODE_ENV: "production", PAYLOAD_SECRET: "p9-runtime-role-secret", BOOT_KEY: runtimeKey
      });
      assert.equal(boot.code, 0, boot.output);
      await admin.query(`
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        DROP ROLE IF EXISTS ${runtimeRole};
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD 'p9-sales-runtime-password';
        GRANT USAGE ON SCHEMA public TO ${runtimeRole};
        GRANT INSERT (id, title, status, potential_revenue, private_note, updated_at, created_at), SELECT (id, title, status, potential_revenue, private_note, updated_at, created_at) ON sales_tasks TO ${runtimeRole};
        GRANT SELECT (id, name, batch, updated_at, created_at) ON payload_migrations TO ${runtimeRole};
        GRANT INSERT (event_id, event_type, schema_version, message_class, occurred_at, application_id, plugin_id, actor_id, actor_type, impersonator_id, correlation_id, causation_id, idempotency_key, payload, retention_until) ON k_nex_outbox TO ${runtimeRole};
        GRANT USAGE ON SEQUENCE sales_tasks_id_seq, k_nex_outbox_id_seq TO ${runtimeRole};
      `);
      const result = await run(testPath, {
        P9_RUNTIME_ROLE_CHILD: "1", DATABASE_URL: roleConnection(postgres.getConnectionUri()), NODE_ENV: "production", PAYLOAD_SECRET: "p9-runtime-role-secret"
      });
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /^P9_RUNTIME_ROLE_CHILD_PASS$/m);
      assert.deepEqual((await admin.query("select title, status from sales_tasks")).rows, [{ title: committedTitle, status: "open" }]);
      assert.deepEqual((await admin.query("select event_id, event_type, application_id, plugin_id, payload from k_nex_outbox where event_id=$1", [committedEventId])).rows, [{
        event_id: committedEventId,
        event_type: "sales.event.task-changed",
        application_id: "customer-gate-1",
        plugin_id: "module.sales",
        payload: { resourceId: "1", operation: "create" }
      }]);
    } finally {
      await admin.end();
      await postgres.stop();
    }
  });
}
