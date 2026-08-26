import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));

async function query(connectionString, text) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await client.query(text);
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
        (select count(*)::int from payload_migrations where name = '20260826_000001_gate1') as migration_count,
        (select count(*)::int from payload_migrations where name = '20260826_000002_sales_sources') as sales_migration_count,
        (select predecessor_revision from k_nex_migration_revision where id = 1) as predecessor_revision,
        (select revision from k_nex_migration_revision where id = 1) as revision
    `);
    assert.deepEqual(migrated.rows, [{
      sales_tasks: "sales_tasks",
      migration_count: 1,
      sales_migration_count: 1,
      predecessor_revision: 1,
      revision: 2
    }]);

    const currentBoot = await runFixtureProcess("tests/boot-once.mjs", connectionString, {
      BOOT_KEY: "gate1-already-current"
    });
    assert.equal(currentBoot.code, 0, `${currentBoot.stdout}\n${currentBoot.stderr}`);
    assert.match(currentBoot.stdout, /^READY$/m);
    const current = await query(connectionString, "select count(*)::int as count from payload_migrations");
    assert.equal(current.rows[0].count, 2);

    const authenticated = await runFixtureProcess("tests/authenticated-runtime.mjs", connectionString, {
      BOOT_KEY: "gate1-authenticated-runtime"
    });
    assert.equal(authenticated.code, 0, `${authenticated.stdout}\n${authenticated.stderr}`);
    assert.match(authenticated.stdout, /^P1_8_PASS$/m);

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
