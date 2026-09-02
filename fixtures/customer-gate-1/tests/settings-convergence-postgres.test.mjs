import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresSystemSettingsStore } from "@k-nex/payload-adapter";
import pg from "pg";

import { CustomerSettingsConvergence } from "../dist/src/settings-convergence.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-settings-convergence";
const environment = "production";
const identity = {
  applicationId, environment, descriptorId: "system.runtime-settings", descriptorSchemaVersion: 1,
  owner: { kind: "platform", namespace: "system" }
};

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p11-settings-convergence", BOOT_KEY: "p11-settings-convergence" },
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

function write(revision, enabled, target = identity, prefix = "settings") {
  const next = revision + 1;
  return {
    identity: target,
    document: { expectedDocumentRevision: revision, expectedSettingsRevision: revision, values: { enabled } },
    operation: { operationId: `${prefix}-operation-${next}`, idempotencyKey: `${prefix}-convergence-${next}` },
    receipt: { receiptId: `${prefix}-receipt-${next}`, invalidationId: `${prefix}-event-${next}`, occurredAt: `2026-09-02T00:00:0${next}.000Z` },
    actor: { kind: "user", id: "user:owner" },
    authority: { schemaVersion: 1, applicationId: target.applicationId, environment: target.environment, authorizationRevision: 0, lifecycleRevision: 0 },
    auditId: `${prefix}-audit-${next}`,
    changedFields: ["enabled"]
  };
}

test("web, worker, and runner converge after delivered and lost settings invalidations", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("settings_convergence").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let convergence;
  try {
    await boot(container.getConnectionUri());
    await pool.query("insert into k_nex_authorization_state (application_id) values ($1)", [applicationId]);
    const store = new PostgresSystemSettingsStore(pool);
    await store.writeImmediate(write(0, true));
    await pool.query("update k_nex_system_settings_outbox set status='delivered' where application_id=$1", [applicationId]);
    const foreignIdentity = { ...identity, applicationId: "customer-settings-foreign" };
    await pool.query("insert into k_nex_authorization_state (application_id) values ($1)", [foreignIdentity.applicationId]);
    await store.writeImmediate(write(0, true, foreignIdentity, "foreign-settings"));

    const advances = [];
    const boundary = (name) => (settingsRevision) => { advances.push({ name, settingsRevision }); };
    convergence = new CustomerSettingsConvergence(pool, applicationId, environment, {
      web: boundary("web"), worker: boundary("worker"), runner: boundary("runner")
    }, { dispatchIntervalMs: 300_000, pollIntervalMs: 300_000, onError(error) { assert.fail(error); } });
    convergence.start();
    await waitFor(() => advances.length === 3, "initial settings state did not converge");
    assert.ok(advances.every(({ settingsRevision }) => settingsRevision === 1));
    advances.length = 0;

    await store.writeImmediate(write(1, false));
    assert.equal(await convergence.dispatchOnce(), 1);
    assert.deepEqual(advances, [
      { name: "web", settingsRevision: 2 },
      { name: "worker", settingsRevision: 2 },
      { name: "runner", settingsRevision: 2 }
    ]);
    assert.equal((await pool.query("select status from k_nex_system_settings_outbox where application_id=$1", [foreignIdentity.applicationId])).rows[0].status, "pending", "App-local dispatch cannot claim another tenant's event.");
    const delivered = (await pool.query("select * from k_nex_system_settings_outbox where application_id=$1 and settings_revision=2", [applicationId])).rows[0];
    assert.equal(JSON.stringify(delivered).includes("enabled"), false, "Settings invalidation contains no values.");
    advances.length = 0;

    await store.writeImmediate(write(2, true));
    await pool.query("update k_nex_system_settings_outbox set status='delivered' where application_id=$1 and settings_revision=3", [applicationId]);
    assert.equal(await convergence.pollOnce(), true, "Authoritative polling repairs a lost invalidation.");
    assert.deepEqual(advances.map(({ name }) => name), ["web", "worker", "runner"]);
    assert.ok(advances.every(({ settingsRevision }) => settingsRevision === 3));
  } finally {
    convergence?.stop();
    await pool.end();
    await container.stop();
  }
});
