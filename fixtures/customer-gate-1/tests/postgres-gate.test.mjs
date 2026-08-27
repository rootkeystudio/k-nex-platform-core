import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));

async function query(connectionString, text, values = []) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

function runFixtureProcess(script, connectionString, environment = {}, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        NODE_ENV: "production",
        PAYLOAD_SECRET: "gate1-postgres-acceptance-secret",
        ...environment
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });
}

async function waitForPostgres(connectionString) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await query(connectionString, "select 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("PostgreSQL did not recover after the injected outage.");
}

test("proves customer-owned migrations and revision-aware Postgres boot", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("gate1")
    .withStartupTimeout(120_000)
    .start();
  let databaseStopped = false;

  try {
    const connectionString = container.getConnectionUri();
    process.env.DATABASE_URL = connectionString;
    process.env.NODE_ENV = "production";
    process.env.PAYLOAD_SECRET = "gate1-postgres-acceptance-secret";

    const firstBoot = await runFixtureProcess("tests/boot-once.mjs", connectionString, {
      BOOT_KEY: "gate1-empty-database"
    });
    assert.equal(firstBoot.code, 0, `${firstBoot.stdout}\n${firstBoot.stderr}`);
    assert.match(firstBoot.stdout, /^READY$/m);

    const migrated = await query(connectionString, `
      select
        to_regclass('public.sales_tasks')::text as sales_tasks,
        to_regclass('public.sales_opportunities')::text as sales_opportunities,
        to_regclass('public.payload_mcp_api_keys')::text as payload_mcp_api_keys,
        to_regclass('public.k_nex_outbox')::text as k_nex_outbox,
        to_regclass('public.sales_event_effects')::text as sales_event_effects,
        (select count(*)::int from payload_migrations where name = '20260826_000001_gate1') as migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000002_sales_sources') as sales_migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000003_payload_mcp') as mcp_migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000004_event_outbox') as outbox_migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000005_outbox_processor') as outbox_processor_migration_count,
        (select count(*)::int from payload_migrations where name = '20260827_000006_sales_opportunities') as opportunities_migration_count,
        (select predecessor_revision from k_nex_migration_revision where id = 1) as predecessor_revision,
        (select revision from k_nex_migration_revision where id = 1) as revision
    `);
    assert.deepEqual(migrated.rows, [{
      sales_tasks: "sales_tasks",
      sales_opportunities: "sales_opportunities",
      payload_mcp_api_keys: "payload_mcp_api_keys",
      k_nex_outbox: "k_nex_outbox",
      sales_event_effects: "sales_event_effects",
      migration_count: 1,
      sales_migration_count: 1,
      mcp_migration_count: 1,
      outbox_migration_count: 1,
      outbox_processor_migration_count: 1,
      opportunities_migration_count: 1,
      predecessor_revision: 5,
      revision: 6
    }]);

    const outboxSchema = await runFixtureProcess("tests/outbox-schema.mjs", connectionString);
    assert.equal(outboxSchema.code, 0, `${outboxSchema.stdout}\n${outboxSchema.stderr}`);
    assert.match(outboxSchema.stdout, /^P3_1_OUTBOX_SCHEMA_PASS$/m);

    const keyOwner = await query(connectionString, `
      insert into users (email) values ('mcp-key-owner@example.test') returning id
    `);
    await query(connectionString, `
      insert into payload_mcp_api_keys (user_id, expires_at, api_key_index)
      values (${Number(keyOwner.rows[0].id)}, now() + interval '1 day', 'deletion-proof-key')
    `);
    await query(connectionString, `delete from users where id = ${Number(keyOwner.rows[0].id)}`);
    const deletedKeys = await query(connectionString, `
      select count(*)::int as count from payload_mcp_api_keys where api_key_index = 'deletion-proof-key'
    `);
    assert.equal(deletedKeys.rows[0].count, 0, "deleting a user must cascade to owned MCP API keys");

    const currentBoot = await runFixtureProcess("tests/boot-once.mjs", connectionString, {
      BOOT_KEY: "gate1-already-current"
    });
    assert.equal(currentBoot.code, 0, `${currentBoot.stdout}\n${currentBoot.stderr}`);
    assert.match(currentBoot.stdout, /^READY$/m);
    const current = await query(connectionString, "select count(*)::int as count from payload_migrations");
    assert.equal(current.rows[0].count, 6);

    const authenticated = await runFixtureProcess("tests/authenticated-runtime.mjs", connectionString, {
      BOOT_KEY: "gate1-authenticated-runtime"
    });
    assert.equal(authenticated.code, 0, `${authenticated.stdout}\n${authenticated.stderr}`);
    assert.match(authenticated.stdout, /^P1_8_PASS$/m);

    const salesLifecycle = await runFixtureProcess("tests/sales-lifecycle.mjs", connectionString, {
      BOOT_KEY: "gate6-sales-lifecycle"
    });
    assert.equal(salesLifecycle.code, 0, `${salesLifecycle.stdout}\n${salesLifecycle.stderr}`);
    assert.match(salesLifecycle.stdout, /^P6_9_SALES_LIFECYCLE_PASS$/m);

    const mcpLifecycle = await runFixtureProcess("tests/mcp-lifecycle.mjs", connectionString, {
      BOOT_KEY: "gate2a-mcp-lifecycle"
    });
    assert.equal(mcpLifecycle.code, 0, `${mcpLifecycle.stdout}\n${mcpLifecycle.stderr}`);
    assert.match(mcpLifecycle.stdout, /^P2A_MCP_LIFECYCLE_PASS$/m);

    const outboxProcessing = await runFixtureProcess("tests/outbox-processing.mjs", connectionString, {
      BOOT_KEY: "gate3-3-outbox-processing"
    });
    assert.equal(outboxProcessing.code, 0, `${outboxProcessing.stdout}\n${outboxProcessing.stderr}`);
    assert.match(outboxProcessing.stdout, /^P3_3_OUTBOX_PROCESSING_PASS$/m);
    assert.match(outboxProcessing.stdout, /^P3_9_DUPLICATE_OUTBOX_PASS$/m);

    const salesEventRealtime = await runFixtureProcess("tests/sales-event-realtime.mjs", connectionString, {
      BOOT_KEY: "gate6-sales-event-realtime"
    });
    assert.equal(salesEventRealtime.code, 0, `${salesEventRealtime.stdout}\n${salesEventRealtime.stderr}`);
    assert.match(salesEventRealtime.stdout, /^P6_SALES_EVENT_REALTIME_PASS$/m);

    const distributedRealtime = await runFixtureProcess("tests/distributed-realtime.mjs", connectionString, {
      BOOT_KEY: "gate3-6-distributed-realtime",
      MODE: "initial"
    });
    assert.equal(distributedRealtime.code, 0, `${distributedRealtime.stdout}\n${distributedRealtime.stderr}`);
    assert.match(distributedRealtime.stdout, /^P3_6_DISTRIBUTED_REALTIME_PASS$/m);

    execFileSync("docker", ["pause", container.getId()], { stdio: "ignore" });
    databaseStopped = true;
    const unavailableUrl = new URL(connectionString);
    unavailableUrl.searchParams.set("connect_timeout", "2");
    const unavailableRelay = await runFixtureProcess("tests/distributed-realtime.mjs", unavailableUrl.toString(), {
      BOOT_KEY: "gate3-9-backplane-unavailable",
      MODE: "recovered"
    }, 2_000);
    assert.notEqual(unavailableRelay.code, 0, `${unavailableRelay.stdout}\n${unavailableRelay.stderr}`);
    assert.doesNotMatch(unavailableRelay.stdout, /^P3_9_BACKPLANE_RECOVERY_PASS$/m);

    execFileSync("docker", ["unpause", container.getId()], { stdio: "ignore" });
    databaseStopped = false;
    await waitForPostgres(connectionString);
    const recoveredRelay = await runFixtureProcess("tests/distributed-realtime.mjs", connectionString, {
      BOOT_KEY: "gate3-9-backplane-recovered",
      MODE: "recovered"
    });
    assert.equal(recoveredRelay.code, 0, `${recoveredRelay.stdout}\n${recoveredRelay.stderr}`);
    assert.match(recoveredRelay.stdout, /^P3_9_BACKPLANE_RECOVERY_PASS$/m);

    const p32Cases = [
      {
        mode: "commit",
        title: "P3.2 committed sales task",
        eventId: "p3-2-event-commit"
      },
      {
        mode: "rollback",
        title: "P3.2 rolled back sales task",
        eventId: "p3-2-event-rollback"
      },
      {
        mode: "crash",
        title: "P3.2 crash-survivor sales task",
        eventId: "p3-2-event-crash"
      }
    ];

    const committed = await runFixtureProcess("tests/transaction-atomicity.mjs", connectionString, {
      MODE: "commit",
      BOOT_KEY: "gate3-2-commit"
    });
    assert.equal(committed.code, 0, `${committed.stdout}\n${committed.stderr}`);
    assert.match(committed.stdout, /^P3_2_COMMIT_PASS$/m);
    const committedState = await query(connectionString, `
      select
        (select count(*)::int from sales_tasks where title = $1) as task_count,
        (select count(*)::int from k_nex_outbox where event_id = $2) as outbox_count,
        (select count(*)::int from k_nex_outbox where event_id = $2 and status = 'pending') as pending_count,
        (select occurred_at from k_nex_outbox where event_id = $2) as occurred_at,
        (select retention_until from k_nex_outbox where event_id = $2) as retention_until
    `, [p32Cases[0].title, p32Cases[0].eventId]);
    assert.deepEqual({ ...committedState.rows[0], occurred_at: committedState.rows[0].occurred_at.toISOString(), retention_until: committedState.rows[0].retention_until.toISOString() }, {
      task_count: 1,
      outbox_count: 1,
      pending_count: 1,
      occurred_at: "2026-08-26T12:00:00.123Z",
      retention_until: "2026-08-27T12:00:00.456Z"
    });

    const rollbackProcess = await runFixtureProcess("tests/transaction-atomicity.mjs", connectionString, {
      MODE: "rollback",
      BOOT_KEY: "gate3-2-rollback"
    });
    assert.equal(rollbackProcess.code, 0, `${rollbackProcess.stdout}\n${rollbackProcess.stderr}`);
    assert.match(rollbackProcess.stdout, /^P3_2_ROLLBACK_PASS$/m);
    const rolledBackState = await query(connectionString, `
      select
        (select count(*)::int from sales_tasks where title = $1) as task_count,
        (select count(*)::int from k_nex_outbox where event_id = $2) as outbox_count,
        (select count(*)::int from k_nex_outbox where event_id = $2 and status = 'pending') as pending_count
    `, [p32Cases[1].title, p32Cases[1].eventId]);
    assert.deepEqual(rolledBackState.rows, [{ task_count: 0, outbox_count: 0, pending_count: 0 }]);

    const crashed = await runFixtureProcess("tests/transaction-atomicity.mjs", connectionString, {
      MODE: "crash",
      BOOT_KEY: "gate3-2-crash"
    });
    assert.equal(crashed.code, 73, `${crashed.stdout}\n${crashed.stderr}`);
    assert.match(crashed.stdout, /^P3_2_CRASH_COMMITTED$/m);
    const crashState = await query(connectionString, `
      select
        (select count(*)::int from sales_tasks where title = $1) as task_count,
        (select count(*)::int from k_nex_outbox where event_id = $2) as outbox_count,
        (select count(*)::int from k_nex_outbox where event_id = $2 and status = 'pending') as pending_count
    `, [p32Cases[2].title, p32Cases[2].eventId]);
    assert.deepEqual(crashState.rows, [{ task_count: 1, outbox_count: 1, pending_count: 1 }]);

    await query(connectionString, "update k_nex_migration_revision set revision = 0 where id = 1");
    const incompatible = await runFixtureProcess("tests/boot-once.mjs", connectionString, {
      BOOT_KEY: "gate1-incompatible-revision",
      EXPECT_ERROR: "INCOMPATIBLE_REVISION"
    });
    assert.equal(incompatible.code, 0, `${incompatible.stdout}\n${incompatible.stderr}`);
    assert.match(incompatible.stdout, /^INCOMPATIBLE_REVISION$/m);

    await query(connectionString, "create database gate1_failed");
    const failedUrl = new URL(connectionString);
    failedUrl.pathname = "/gate1_failed";
    const failed = await runFixtureProcess("tests/failed-migration.mjs", failedUrl.toString());
    assert.notEqual(failed.code, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.doesNotMatch(failed.stdout, /^READY$/m);

    const rolledBack = await query(failedUrl.toString(), `
      select
        to_regclass('public.failed_migration_marker')::text as marker,
        to_regclass('public.payload_migrations')::text as migration_table
    `);
    assert.deepEqual(rolledBack.rows, [{ marker: null, migration_table: null }]);
  } finally {
    if (databaseStopped) execFileSync("docker", ["unpause", container.getId()], { stdio: "ignore" });
    await container.stop();
  }
});
