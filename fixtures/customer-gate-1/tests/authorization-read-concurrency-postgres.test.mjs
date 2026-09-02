import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { bootstrapFirstOwner } from "@k-nex/runtime";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-authorization-read-concurrency";
const environment = "production";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-read-concurrency", BOOT_KEY: "p10-read-concurrency" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject).once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

test("P10.10 slow administration reads do not block authorization mutations", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("authorization_read_concurrency").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const store = new PostgresAuthorizationStore(pool, { validate: () => "accepted" });
    const bootstrapped = await bootstrapFirstOwner({
      store,
      expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 },
      firstOwner: { kind: "user", id: "user:owner" }
    });
    const expected = { applicationId, environment, authorizationRevision: bootstrapped.state.authorizationRevision, lifecycleRevision: bootstrapped.state.lifecycleRevision };
    const readerEntered = deferred();
    const releaseReader = deferred();

    const read = store.readTransaction(expected, async (transaction) => {
      const before = await transaction.listRoles(applicationId);
      readerEntered.resolve();
      await releaseReader.promise;
      const after = await transaction.listRoles(applicationId);
      return { before, after };
    });
    await readerEntered.promise;

    const write = store.transaction(expected, async (transaction) => {
      await transaction.write({ kind: "role", role: {
        schemaVersion: 1,
        id: "customer.concurrent-writer",
        applicationId,
        label: "Concurrent writer",
        revision: expected.authorizationRevision + 1
      } });
    });
    const writeOutcome = await Promise.race([
      write,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Authorization mutation was blocked by the held read transaction.")), 1_000))
    ]);
    assert.equal(writeOutcome.state.authorizationRevision, expected.authorizationRevision + 1);

    releaseReader.resolve();
    const readOutcome = await read;
    assert.equal(readOutcome.state.authorizationRevision, expected.authorizationRevision);
    assert.equal(readOutcome.value.before.some(({ id }) => id === "customer.concurrent-writer"), false);
    assert.equal(readOutcome.value.after.some(({ id }) => id === "customer.concurrent-writer"), false, "Repeatable-read administration view must remain internally consistent.");
    const nextExpected = { applicationId, environment, authorizationRevision: writeOutcome.state.authorizationRevision, lifecycleRevision: writeOutcome.state.lifecycleRevision };
    assert.equal((await store.readTransaction(nextExpected, (transaction) => transaction.readRole(applicationId, "customer.concurrent-writer"))).value?.label, "Concurrent writer");
    assert.equal((await pool.query(
      "select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and authorization_revision=$2",
      [applicationId, writeOutcome.state.authorizationRevision]
    )).rows[0].count, 1);
  } finally {
    await pool.end();
    await container.stop();
  }
});
