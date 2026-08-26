import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

function runFixtureProcess(script, connectionString, environment = {}) {
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
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

test("proves customer-owned migrations and revision-aware Postgres boot", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("gate1")
    .withStartupTimeout(120_000)
    .start();

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
        to_regclass('public.payload_mcp_api_keys')::text as payload_mcp_api_keys,
        to_regclass('public.k_nex_outbox')::text as k_nex_outbox,
        to_regclass('public.sales_event_effects')::text as sales_event_effects,
        (select count(*)::int from payload_migrations where name = '20260826_000001_gate1') as migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000002_sales_sources') as sales_migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000003_payload_mcp') as mcp_migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000004_event_outbox') as outbox_migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000005_outbox_processor') as outbox_processor_migration_count,
        (select predecessor_revision from k_nex_migration_revision where id = 1) as predecessor_revision,
        (select revision from k_nex_migration_revision where id = 1) as revision
    `);
    assert.deepEqual(migrated.rows, [{
      sales_tasks: "sales_tasks",
      payload_mcp_api_keys: "payload_mcp_api_keys",
      k_nex_outbox: "k_nex_outbox",
      sales_event_effects: "sales_event_effects",
      migration_count: 1,
      sales_migration_count: 1,
      mcp_migration_count: 1,
      outbox_migration_count: 1,
      outbox_processor_migration_count: 1,
      predecessor_revision: 4,
      revision: 5
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
    assert.equal(current.rows[0].count, 5);

    const authenticated = await runFixtureProcess("tests/authenticated-runtime.mjs", connectionString, {
      BOOT_KEY: "gate1-authenticated-runtime"
    });
    assert.equal(authenticated.code, 0, `${authenticated.stdout}\n${authenticated.stderr}`);
    assert.match(authenticated.stdout, /^P1_8_PASS$/m);

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
        (select count(*)::int from k_nex_outbox where event_id = $2 and status = 'pending') as pending_count
    `, [p32Cases[0].title, p32Cases[0].eventId]);
    assert.deepEqual(committedState.rows, [{ task_count: 1, outbox_count: 1, pending_count: 1 }]);

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
    await container.stop();
  }
});
