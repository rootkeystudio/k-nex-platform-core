import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PostgresRuntimeExtensionStore } from "@k-nex/payload-adapter";
import { ExtensionRevisionTracker, PluginManager, TrustedAutomationOperationAuthorizer } from "@k-nex/runtime";

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

function request(id, key, options = {}) {
  return {
    applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id }, operation: options.operation ?? "install",
    targetVersion: options.version ?? "1.0.0", expectedRevision: options.expectedRevision ?? 0, idempotencyKey: key, correlationId: `correlation-${id.replaceAll(".", "-")}`
  };
}

function claim(store, extensionRequest, requestDigest, workerId) {
  return store.claimOperation({
    request: extensionRequest, requestDigest, workerId,
    authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("9") }
  });
}

function livePlan(operationId, extensionRequest, generation = 1, artifact = "a") {
  const generationId = `${extensionRequest.extension.id.replaceAll(".", "-")}-generation-${generation}`;
  return {
    executionClass: "live-generation", operationId, sourceCommit: "a".repeat(40), generationId,
    plan: {
      schemaVersion: 1, planId: `${extensionRequest.extension.id.replaceAll(".", "-")}-plan-${generation}`, operationId, operation: extensionRequest.operation, version: extensionRequest.targetVersion,
      artifactDigest: digest(artifact), expectedRevision: extensionRequest.expectedRevision, targetGenerationId: generationId,
      approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "hot-application", id: extensionRequest.extension.id,
      availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
    }
  };
}

function authority(generationId, artifact = "a") {
  return {
    generationId, sourceCommit: "a".repeat(40), artifactDigest: digest(artifact), manifestDigest: digest("b"),
    catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e")
  };
}

function activationStage(generationAuthority, version, now, compatibility) {
  return {
    authority: generationAuthority, version,
    readiness: {
      generationId: generationAuthority.generationId, serverGenerationId: generationAuthority.generationId,
      uiGenerationId: generationAuthority.generationId, storageGenerationId: generationAuthority.generationId,
      leaseToken: `ready:${generationAuthority.generationId}`, readyAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 60_000).toISOString()
    },
    compatibility,
    metadata: { navigation: `${generationAuthority.generationId}:navigation` },
    settings: { locale: "en" },
    storageSchemaVersions: { "sales.records": Number(generationAuthority.generationId.at(-1)) }
  };
}

async function stageOperation(store, extensionRequest, requestDigest, workerId, generation, artifact) {
  const claimed = await claim(store, extensionRequest, requestDigest, workerId);
  assert.equal(claimed.status, "claimed");
  let operation = await store.savePlan(claimed.operation.operationId, claimed.operation.leaseToken, livePlan(claimed.operation.operationId, extensionRequest, generation, artifact));
  operation = (await store.transition({ operationId: operation.operationId, leaseToken: operation.leaseToken, expectedPhase: "planning", phase: "downloading" })).operation;
  const verified = authority(operation.plan.generationId, artifact);
  operation = (await store.transition({ operationId: operation.operationId, leaseToken: operation.leaseToken, expectedPhase: "downloading", phase: "verified", authority: verified })).operation;
  operation = (await store.transition({ operationId: operation.operationId, leaseToken: operation.leaseToken, expectedPhase: "verified", phase: "staged", authority: verified })).operation;
  return { operation, authority: verified };
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

    const liveIdentity = { deliveryClass: "hot-application", id: "app.sales-live" };
    const installRequest = request(liveIdentity.id, "install:app.sales-live:1");
    const install = await stageOperation(storeA, installRequest, digest("6"), "activation-worker", 1, "1");
    await storeA.stageGeneration({
      operationId: install.operation.operationId, leaseToken: install.operation.leaseToken,
      stage: activationStage(install.authority, "1.0.0", now, {
        status: "compatible", windowId: "sales-window-1", closesAt: new Date(now.valueOf() + 86_400_000).toISOString(), migrationDigest: digest("1"), dataRevision: 1
      })
    });
    const installWarming = await storeA.readOperation(install.operation.operationId);
    const installed = await storeA.activateGeneration(install.operation.operationId, installWarming.leaseToken);
    assert.equal(installed.generationId, "app-sales-live-generation-1");
    assert.equal((await storeA.observeActiveGeneration("customer-alpha", "production", liveIdentity)).generationId, installed.generationId);
    const runtimeConsumers = new Map(["web", "worker", "runner", "browser"].map((name) => [name, new ExtensionRevisionTracker()]));
    const installedObservation = await storeA.observeActiveGeneration("customer-alpha", "production", liveIdentity);
    for (const tracker of runtimeConsumers.values()) tracker.observe(installedObservation);

    const oldLease = await storeA.acquireGenerationLease({
      applicationId: "customer-alpha", environment: "production", extension: liveIdentity, generationId: installed.generationId,
      holder: "web-request-1", ttlMs: 120_000
    });
    const updateRequest = request(liveIdentity.id, "update:app.sales-live:2", { operation: "update", version: "1.1.0", expectedRevision: installed.revisionAfter });
    const update = await stageOperation(storeA, updateRequest, digest("7"), "activation-worker", 2, "2");
    await storeA.stageGeneration({
      operationId: update.operation.operationId, leaseToken: update.operation.leaseToken,
      stage: activationStage(update.authority, "1.1.0", now, {
        status: "compatible", windowId: "sales-window-2", closesAt: new Date(now.valueOf() + 86_400_000).toISOString(), migrationDigest: digest("2"), dataRevision: 2
      })
    });
    const updateWarming = await storeA.readOperation(update.operation.operationId);
    await pool.query(`create function p9_fail_activation() returns trigger language plpgsql as $$ begin raise exception 'simulated crash before commit'; end $$`);
    await pool.query(`create trigger p9_fail_activation after update on runtime_extensions for each row when (new.active_generation_id='app-sales-live-generation-2') execute function p9_fail_activation()`);
    await assert.rejects(storeA.activateGeneration(update.operation.operationId, updateWarming.leaseToken), /simulated crash before commit/);
    assert.equal((await storeB.observeActiveGeneration("customer-alpha", "production", liveIdentity)).generationId, installed.generationId);
    await pool.query(`drop trigger p9_fail_activation on runtime_extensions`);
    await pool.query(`drop function p9_fail_activation()`);
    now = new Date(now.valueOf() + 60_001);
    const updateRecovered = await storeB.resumeOperation(update.operation.operationId, "activation-recovery");
    await assert.rejects(storeA.activateGeneration(update.operation.operationId, updateRecovered.leaseToken), { code: "READINESS_EXPIRED" });
    await storeA.refreshGenerationReadiness({
      operationId: update.operation.operationId, leaseToken: updateRecovered.leaseToken,
      stage: activationStage(update.authority, "1.1.0", now, {
        status: "compatible", windowId: "sales-window-2", closesAt: new Date(now.valueOf() + 86_339_999).toISOString(), migrationDigest: digest("2"), dataRevision: 2
      })
    });

    const traffic = Array.from({ length: 24 }, () => storeB.observeActiveGeneration("customer-alpha", "production", liveIdentity));
    const [updated, ...observations] = await Promise.all([storeA.activateGeneration(update.operation.operationId, updateRecovered.leaseToken), ...traffic]);
    assert.equal(updated.previousGenerationId, installed.generationId);
    assert.equal(updated.rollback, "available");
    assert.deepEqual(updated.compatibility, {
      status: "compatible", windowId: "sales-window-2", closesAt: new Date(now.valueOf() + 86_339_999).toISOString(), migrationDigest: digest("2"), dataRevision: 2
    });
    assert.equal(observations.every(({ generationId }) => [installed.generationId, updated.generationId].includes(generationId)), true);
    assert.equal((await storeB.observeActiveGeneration("customer-alpha", "production", liveIdentity)).generationId, updated.generationId);
    const polledAfterLostInvalidation = await storeB.observeActiveGeneration("customer-alpha", "production", liveIdentity);
    for (const tracker of runtimeConsumers.values()) tracker.observe(polledAfterLostInvalidation);
    assert.deepEqual([...runtimeConsumers.entries()].map(([name, tracker]) => [name, tracker.snapshot().generationId]), [
      ["web", updated.generationId], ["worker", updated.generationId], ["runner", updated.generationId], ["browser", updated.generationId]
    ]);
    assert.equal(await storeA.liveGenerationLeaseCount("customer-alpha", "production", liveIdentity, installed.generationId), 1);
    await assert.rejects(storeA.acquireGenerationLease({
      applicationId: "customer-alpha", environment: "production", extension: liveIdentity, generationId: installed.generationId,
      holder: "late-old-request", ttlMs: 30_000
    }), { code: "GENERATION_MISMATCH" });
    await storeA.releaseGenerationLease(oldLease);
    assert.equal(await storeA.liveGenerationLeaseCount("customer-alpha", "production", liveIdentity, installed.generationId), 0);

    const beforeRestore = await storeA.inventory("customer-alpha", "production");
    const liveBeforeRestore = beforeRestore.extensions.hotApplications[liveIdentity.id];
    assert.equal(liveBeforeRestore.activeGeneration.generationId, updated.generationId);
    assert.equal(liveBeforeRestore.rollbackGeneration.generationId, installed.generationId);
    const artifactStore = new Set([installed.generationId, updated.generationId]);
    const artifactBackup = new Set(artifactStore);
    const uri = new URL(container.getConnectionUri());
    uri.hostname = "127.0.0.1";
    uri.port = "5432";
    const dumped = await container.exec(["pg_dump", "--format=custom", "--file=/tmp/p9-extension.dump", uri.toString()]);
    assert.equal(dumped.exitCode, 0, dumped.output);
    await pool.query(`update runtime_extensions set metadata_json='{"corrupt":true}'::jsonb where application_id='customer-alpha' and environment='production' and extension_id='app.sales-live'`);
    artifactStore.clear();
    const restored = await container.exec(["pg_restore", "--clean", "--if-exists", "--no-owner", `--dbname=${uri.toString()}`, "/tmp/p9-extension.dump"]);
    assert.equal(restored.exitCode, 0, restored.output);
    for (const generationId of artifactBackup) artifactStore.add(generationId);
    assert.deepEqual(await storeA.inventory("customer-alpha", "production"), beforeRestore);
    assert.deepEqual([...artifactStore].sort(), [installed.generationId, updated.generationId].sort());

    const rollbackRequest = request(liveIdentity.id, "rollback:app.sales-live:1", { operation: "rollback", version: "1.0.0", expectedRevision: updated.revisionAfter });
    const rollbackClaim = await claim(storeA, rollbackRequest, digest("8"), "rollback-worker");
    const rollbackPlan = await storeA.savePlan(rollbackClaim.operation.operationId, rollbackClaim.operation.leaseToken, livePlan(rollbackClaim.operation.operationId, rollbackRequest, 1, "1"));
    const rolledBack = await storeA.rollbackGeneration(rollbackPlan.operationId, rollbackPlan.leaseToken);
    assert.equal(rolledBack.generationId, installed.generationId);
    assert.equal(rolledBack.previousGenerationId, updated.generationId);
    assert.equal(rolledBack.compatibility.windowId, "sales-window-2");
    const retainedCompatibility = await pool.query(`select rollback_compatibility_json from runtime_extensions where application_id='customer-alpha' and environment='production' and extension_id='app.sales-live'`);
    assert.equal(retainedCompatibility.rows[0].rollback_compatibility_json.windowId, "sales-window-2");

    const irreversibleRequest = request(liveIdentity.id, "update:app.sales-live:3", { operation: "update", version: "2.0.0", expectedRevision: rolledBack.revisionAfter });
    const irreversible = await stageOperation(storeA, irreversibleRequest, digest("a"), "activation-worker", 3, "3");
    await storeA.stageGeneration({
      operationId: irreversible.operation.operationId, leaseToken: irreversible.operation.leaseToken,
      stage: activationStage(irreversible.authority, "2.0.0", now, {
        status: "irreversible", decisionId: "sales-contract-cutover", reason: "The storage contract no longer supports generation 1.", migrationDigest: digest("3"), dataRevision: 3
      })
    });
    const irreversibleWarming = await storeA.readOperation(irreversible.operation.operationId);
    const cutover = await storeA.activateGeneration(irreversible.operation.operationId, irreversibleWarming.leaseToken);
    assert.equal(cutover.rollback, "blocked-irreversible");
    const blockedRequest = request(liveIdentity.id, "rollback:app.sales-live:blocked", { operation: "rollback", version: "1.0.0", expectedRevision: cutover.revisionAfter });
    const blockedClaim = await claim(storeA, blockedRequest, digest("b"), "rollback-worker");
    const blockedPlan = await storeA.savePlan(blockedClaim.operation.operationId, blockedClaim.operation.leaseToken, livePlan(blockedClaim.operation.operationId, blockedRequest, 1, "1"));
    await assert.rejects(storeA.rollbackGeneration(blockedPlan.operationId, blockedPlan.leaseToken), { code: "ROLLBACK_BLOCKED" });
    await storeA.transition({ operationId: blockedPlan.operationId, leaseToken: blockedPlan.leaseToken, expectedPhase: "planning", phase: "failed" });

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
