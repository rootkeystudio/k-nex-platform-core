import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresAuthorizationOutboxDispatcher, PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import pg from "pg";

import { CustomerAuthorizationConvergence } from "../dist/src/authorization-convergence.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-convergence";
const expected = (state) => ({ applicationId, environment: "production", authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
const role = (id, revision) => ({ schemaVersion: 1, id, applicationId, label: id, revision });
const assignment = (state, revision) => ({ schemaVersion: 1, id: "revoked-user-assignment", applicationId, roleId: "baseline-role", principal: { kind: "user", id: "revoked-user" }, state, revision });

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-8-convergence", BOOT_KEY: "p10-8-convergence" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("converges authorization revisions through the durable outbox and polling recovery", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("authorization_convergence").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const store = new PostgresAuthorizationStore(pool, {
    validate: (targetApplicationId, subject) => targetApplicationId === applicationId && subject.kind === "user" && subject.id === "revoked-user" ? "accepted" : "rejected"
  });
  let convergence;
  try {
    await boot(container.getConnectionUri());

    await pool.query(`create function reject_authorization_outbox() returns trigger language plpgsql as $$ begin raise exception 'outbox rejected'; end $$`);
    await pool.query(`create trigger reject_authorization_outbox before insert on k_nex_authorization_outbox for each row execute function reject_authorization_outbox()`);
    await assert.rejects(store.transaction({ applicationId, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 }, async (transaction) => {
      await transaction.write({ kind: "role", role: role("atomic-failure", 0) });
    }), /outbox rejected/u);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_roles where application_id=$1", [applicationId])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0].count, 0);
    await pool.query("drop trigger reject_authorization_outbox on k_nex_authorization_outbox");
    await pool.query("drop function reject_authorization_outbox()");

    let state = (await store.transaction({ applicationId, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 }, async (transaction) => {
      await transaction.write({ kind: "role", role: role("baseline-role", 0) });
      await transaction.write({ kind: "assignment", assignment: assignment("active", 0) });
    })).state;
    await pool.query("update k_nex_authorization_outbox set status='delivered' where application_id=$1", [applicationId]);

    const advances = [];
    const boundaries = ["web", "worker", "runner", "gateway", "browser", "remoteUi", "realtime"];
    const environment = (name) => ({
      environment: name,
      boundaries: Object.fromEntries(boundaries.map((boundary) => [boundary, (next) => { advances.push({ boundary, environment: name, revision: next.authorizationRevision }); }]))
    });
    convergence = new CustomerAuthorizationConvergence(pool, applicationId, [environment("production"), environment("staging")], {
      dispatchIntervalMs: 300_000,
      pollIntervalMs: 300_000,
      onError(error) { assert.fail(error); }
    });
    convergence.start();
    await waitFor(() => advances.length === 14, "initial authoritative boundary state did not converge");
    advances.length = 0;

    state = (await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: assignment("revoked", 1) });
    })).state;
    assert.equal(await convergence.dispatchOnce(), 1);
    assert.equal(advances.length, 14);
    assert.deepEqual(new Set(advances.map(({ environment: name }) => name)), new Set(["production", "staging"]));
    assert.ok(advances.every(({ revision }) => revision === state.authorizationRevision));
    assert.equal((await pool.query("select event_json->>'scope' as scope from k_nex_authorization_outbox where application_id=$1 and authorization_revision=$2", [applicationId, state.authorizationRevision])).rows[0].scope, "application");
    advances.length = 0;

    state = (await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "role", role: role("lost-message-role", state.authorizationRevision) });
    })).state;
    assert.equal(await convergence.pollOnce(), 2);
    assert.equal(advances.length, 14);
    assert.ok(advances.every(({ revision }) => revision === state.authorizationRevision));
    convergence.stop();

    const releasePublish = deferred();
    let firstPublish = false;
    const first = new PostgresAuthorizationOutboxDispatcher(pool, { leaseMs: 1_000, publishTimeoutMs: 500 });
    const second = new PostgresAuthorizationOutboxDispatcher(pool, { leaseMs: 1_000, publishTimeoutMs: 500 });
    const firstClaim = first.dispatchNext({ publish: async () => { firstPublish = true; await releasePublish.promise; } });
    await waitFor(() => firstPublish, "first dispatcher did not claim the pending event");
    await assert.doesNotReject(async () => assert.deepEqual(await second.dispatchNext({ publish: async () => assert.fail("concurrent dispatcher published the same claim") }), { status: "idle" }));
    releasePublish.resolve();
    assert.equal((await firstClaim).status, "delivered");

    state = (await store.transaction(expected(state), async (transaction) => {
      await transaction.write({ kind: "role", role: role("redelivery-role", state.authorizationRevision) });
    })).state;
    let publications = 0;
    let dispatcherStopped = false;
    const interruptedPool = {
      connect: (...args) => pool.connect(...args),
      query: async (text, values) => {
        if (dispatcherStopped) throw new Error("dispatcher process stopped before acknowledgement");
        return pool.query(text, values);
      }
    };
    const interrupted = new PostgresAuthorizationOutboxDispatcher(interruptedPool, { leaseMs: 40, publishTimeoutMs: 10 });
    await assert.rejects(interrupted.dispatchNext({ publish: async () => { publications += 1; dispatcherStopped = true; } }), /stopped before acknowledgement/u);
    assert.equal((await pool.query("select status from k_nex_authorization_outbox where application_id=$1 and authorization_revision=$2", [applicationId, state.authorizationRevision])).rows[0].status, "processing");
    await new Promise((resolve) => setTimeout(resolve, 60));
    const restarted = new PostgresAuthorizationOutboxDispatcher(pool, { leaseMs: 40, publishTimeoutMs: 10 });
    assert.equal((await restarted.dispatchNext({ publish: async () => { publications += 1; } })).status, "delivered");
    assert.equal(publications, 2);
  } finally {
    convergence?.stop();
    await pool.end();
    await container.stop();
  }
});
