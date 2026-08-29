import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PostgresRuntimeExtensionStore } from "@k-nex/payload-adapter";
import { PluginManager, TrustedAutomationOperationAuthorizer } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const digest = (character) => `sha256:${character.repeat(64)}`;

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-3-postgres-secret", BOOT_KEY: "p9-3-runtime-state" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function request(id, key) {
  return {
    applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id }, operation: "install",
    targetVersion: "1.0.0", expectedRevision: 0, idempotencyKey: key, correlationId: `correlation-${id.replaceAll(".", "-")}`
  };
}

function claim(store, extensionRequest, requestDigest, workerId) {
  return store.claimOperation({
    request: extensionRequest, requestDigest, workerId,
    authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("9") }
  });
}

function livePlan(operationId, extensionRequest) {
  return {
    executionClass: "live-generation", operationId, sourceCommit: "a".repeat(40), generationId: `${extensionRequest.extension.id.replaceAll(".", "-")}-generation-1`,
    plan: {
      schemaVersion: 1, planId: `${extensionRequest.extension.id.replaceAll(".", "-")}-plan-1`, operationId, operation: "install", version: "1.0.0",
      artifactDigest: digest("a"), expectedRevision: 0, targetGenerationId: `${extensionRequest.extension.id.replaceAll(".", "-")}-generation-1`,
      approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "hot-application", id: extensionRequest.extension.id,
      availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
    }
  };
}

test("proves persistent extension operation serialization, recovery, atomic evidence, and forged-authority rejection", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_extensions").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let now = new Date("2026-08-29T09:00:00.000Z");
  const clock = { now: () => now };
  const storeA = new PostgresRuntimeExtensionStore(pool, clock, digest("7"), { leaseMs: 1_000, maxConcurrentOperations: 2 });
  const storeB = new PostgresRuntimeExtensionStore(pool, clock, digest("7"), { leaseMs: 1_000, maxConcurrentOperations: 2 });
  try {
    await boot(container.getConnectionUri());
    const tableShape = await pool.query("select to_regclass('public.runtime_extension_operations')::text operations, to_regclass('public.runtime_extension_outbox')::text outbox, to_regclass('public.runtime_extension_inventory_revisions')::text inventory_revisions");
    assert.deepEqual(tableShape.rows, [{ operations: "runtime_extension_operations", outbox: "runtime_extension_outbox", inventory_revisions: "runtime_extension_inventory_revisions" }]);

    const firstRequest = request("app.sales-assistant", "install:app.sales-assistant:1");
    const secondRequest = request("app.forecast", "install:app.forecast:1");
    const first = await claim(storeA, firstRequest, digest("1"), "worker-a");
    assert.equal(first.status, "claimed");
    assert.equal((await claim(storeA, firstRequest, digest("1"), "worker-a")).status, "replay");
    await assert.rejects(claim(storeA, firstRequest, digest("2"), "worker-a"), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(claim(storeB, request("app.sales-assistant", "install:app.sales-assistant:2"), digest("3"), "worker-b"), { code: "OPERATION_IN_PROGRESS" });

    const second = await claim(storeB, secondRequest, digest("4"), "worker-b");
    assert.equal(second.status, "claimed");
    await assert.rejects(claim(storeB, request("app.pipeline", "install:app.pipeline:1"), digest("5"), "worker-b"), { code: "GLOBAL_BUDGET_EXHAUSTED" });

    const firstSaved = await storeA.savePlan(first.operation.operationId, first.operation.leaseToken, livePlan(first.operation.operationId, firstRequest));
    await storeB.savePlan(second.operation.operationId, second.operation.leaseToken, livePlan(second.operation.operationId, secondRequest));
    const raced = await Promise.allSettled([
      storeA.transition({ operationId: first.operation.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "planning", phase: "downloading" }),
      storeB.transition({ operationId: first.operation.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "planning", phase: "downloading" })
    ]);
    assert.deepEqual(raced.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);

    const evidenceBeforeInvalid = await pool.query("select (select count(*)::int from runtime_extension_transition_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox) outbox");
    await assert.rejects(storeA.transition({ operationId: first.operation.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "downloading", phase: "completed" }), { code: "PHASE_CONFLICT" });
    const evidenceAfterInvalid = await pool.query("select (select count(*)::int from runtime_extension_transition_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox) outbox");
    assert.deepEqual(evidenceAfterInvalid.rows, evidenceBeforeInvalid.rows);

    now = new Date(now.valueOf() + 1_001);
    const resumed = await storeB.resumeOperation(first.operation.operationId, "worker-recovery");
    assert.notEqual(resumed.leaseToken, firstSaved.leaseToken);
    await storeB.transition({ operationId: resumed.operationId, leaseToken: resumed.leaseToken, expectedPhase: "downloading", phase: "failed" });
    const secondResumed = await storeB.resumeOperation(second.operation.operationId, "worker-b");
    await storeB.transition({ operationId: secondResumed.operationId, leaseToken: secondResumed.leaseToken, expectedPhase: "planning", phase: "failed" });

    const evidence = await pool.query("select (select count(*)::int from runtime_extension_transition_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox) outbox, (select active_count from runtime_extension_operation_budget where application_id='customer-alpha' and environment='production') active_count");
    assert.deepEqual(evidence.rows, [{ receipts: 5, audits: 5, outbox: 5, active_count: 0 }]);
    const converged = await storeA.inventory("customer-alpha", "production");
    assert.equal(converged.revision, 5);
    assert.deepEqual(converged, await storeB.inventory("customer-alpha", "production"));

    const forged = { authority: "verified-bundle", generationId: "forecast-generation-1", version: "1.0.0", sourceCommit: "a".repeat(40), artifactDigest: digest("a"), manifestDigest: digest("b"), catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e"), receiptId: "forged-receipt-1" };
    await pool.query("update runtime_extensions set disposition='active', active_generation_id=$1, active_generation=$2::jsonb where application_id='customer-alpha' and environment='production' and delivery_class='hot-application' and extension_id='app.forecast'", [forged.generationId, JSON.stringify(forged)]);
    const rawInventory = await storeA.inventory("customer-alpha", "production");
    assert.equal(rawInventory.extensions.hotApplications["app.forecast"].disposition, "active");
    const manager = new PluginManager(
      "authority-reader", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), { plan: async () => { throw new Error("unused"); } }, storeA,
      { stage: async () => { throw new Error("unused"); }, reverify: async () => false }, { request: async () => { throw new Error("unused"); } },
      { request: async () => { throw new Error("unused"); }, reverify: async () => false }
    );
    await assert.rejects(manager.inventory("customer-alpha", "production"), { code: "ARTIFACT_AUTHORITY_REJECTED" });
  } finally {
    await pool.end();
    await container.stop();
  }
});
