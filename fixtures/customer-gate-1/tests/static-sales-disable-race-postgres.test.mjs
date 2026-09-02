import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { sql } from "@payloadcms/db-postgres";
import salesManifest from "@k-nex/module-sales/manifest" with { type: "json" };
import { salesRegistration, salesTaskCreateHandler } from "@k-nex/module-sales/server";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  AuthorizationLifecycleProjector,
  activePayloadPostgresTransaction,
  PostgresRuntimeExtensionStore,
  SharedStaticPlatformPluginGenerationRebinder,
  createStaticPlatformPluginAuthorizationDescriptorResolver,
  runtimeExtensionIdentityKey
} from "@k-nex/payload-adapter";
import {
  createPlatformPluginLifecycleState,
  executeRegistration,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration
} from "@k-nex/runtime";
import pg from "pg";
import { createPayloadRequest, getPayload } from "payload";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const testFile = fileURLToPath(import.meta.url);
const identity = Object.freeze({ applicationId: "customer-alpha", environment: "production", deliveryClass: "platform-plugin", extensionId: "module.sales" });
const identityKey = runtimeExtensionIdentityKey(identity);
const activeGeneration = Object.freeze({
  authority: "static-build", generationId: "customer-alpha-blue-11", version: "1.0.0",
  sourceCommit: "a".repeat(40), compositionChangePlanDigest: `sha256:${"b".repeat(64)}`,
  buildEvidenceDigest: `sha256:${"c".repeat(64)}`, applicationDigest: `sha256:${"d".repeat(64)}`,
  imageDigest: `sha256:${"e".repeat(64)}`, migrationRevision: 11, workerFencingToken: 1, receiptId: "receipt-sales-race"
});

function scopedSalesRegistration() {
  const registration = executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [{
        id: salesManifest.id, kind: salesManifest.kind, package: salesManifest.package, version: salesManifest.version,
        integrity: "sha512-c2FsZXM=", required: [], optional: []
      }],
      capabilityProviders: [],
      registrationOrder: [salesManifest.id]
    },
    installed: [{
      package: { name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" }, manifest: salesManifest
    }],
    registrations: [salesRegistration]
  });
  const availability = reconcilePlatformPluginAvailability(registration, createPlatformPluginLifecycleState({
    pluginId: salesManifest.id,
    catalogStatus: "supported",
    package: { status: "installed", name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" },
    enabled: true,
    configuration: { revision: 1, ready: true },
    migration: { current: 1, required: 1, ready: true },
    dataState: "active",
    releaseStatus: "supported"
  }));
  return scopePlatformPluginRegistration(registration, [availability]);
}

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-sales-race-secret", BOOT_KEY: "p9-sales-disable-race" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function waitForDisableLock(pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query(
      "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select pg_advisory_xact_lock%' limit 1"
    );
    if (result.rowCount === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Disable transition never waited on the Sales runtime identity advisory lock.");
}

function disablePlan(operationId) {
  return {
    executionClass: "live-generation", operationId, sourceCommit: activeGeneration.sourceCommit, generationId: activeGeneration.generationId,
    plan: {
      schemaVersion: 1, planId: "sales-disable-race-plan", operationId, operation: "disable", version: "1.0.0",
      artifactDigest: `sha256:${"f".repeat(64)}`, expectedRevision: 0, currentGenerationId: activeGeneration.generationId,
      targetGenerationId: activeGeneration.generationId, approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 },
      deliveryClass: "platform-plugin", id: "module.sales", availability: { outcome: "live-generation", activation: "atomic-generation-pointer" },
      requiredCapabilities: [], resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
    }
  };
}

function activeSalesLifecycleEvent() {
  return {
    schemaVersion: 1,
    applicationId: identity.applicationId,
    environment: identity.environment,
    eventId: "p10-sales-race-install-event",
    eventType: "extension.lifecycle-transition",
    operationId: "p10-sales-race-install-operation",
    operation: "install",
    operationPhase: "completed",
    lifecycleState: "active",
    expectedRevision: 0,
    revision: 1,
    inventoryRevision: 1,
    actor: { kind: "trusted-automation", identity: "github-actions:phase-9" },
    receiptId: "p10-sales-race-install-receipt",
    auditId: "p10-sales-race-install-audit",
    idempotencyKey: "p10-sales-race-install",
    correlationId: "p10-sales-race-install",
    occurredAt: "2026-08-31T00:00:00.000Z",
    deliveryClass: identity.deliveryClass,
    id: identity.extensionId,
    evidence: {
      sourceCommit: activeGeneration.sourceCommit,
      compositionChangePlanDigest: activeGeneration.compositionChangePlanDigest,
      generationId: activeGeneration.generationId
    }
  };
}

async function seedActiveSalesAuthorization(pool, projector) {
  const session = await pool.connect();
  try {
    await session.query("begin");
    await projector.project({ session, transition: activeSalesLifecycleEvent(), runtimeGenerationIds: [activeGeneration.generationId] });
    await session.query("commit");
  } catch (error) {
    await session.query("rollback");
    throw error;
  } finally {
    session.release();
  }
}

async function admitSales(payload, input, idempotencyKey) {
  const request = await createPayloadRequest({
    config: payload.config,
    request: new Request("http://localhost/api/sales-tasks", { headers: { "x-correlation-id": "p9-sales-disable-race" } })
  });
  const transactionID = await request.payload.db.beginTransaction();
  assert.ok(transactionID, "Sales admission must use a Payload PostgreSQL transaction.");
  request.transactionID = transactionID;
  try {
    const transaction = await activePayloadPostgresTransaction(request);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))`);
    const lifecycle = await transaction.execute(sql`
      select disposition from runtime_extensions
      where application_id=${identity.applicationId} and environment=${identity.environment}
        and delivery_class=${identity.deliveryClass} and extension_id=${identity.extensionId}
      for share
    `);
    if (lifecycle.rows[0]?.disposition !== "active") {
      await request.payload.db.rollbackTransaction(transactionID);
      return { authorized: false };
    }
    const task = await salesTaskCreateHandler({
      actor: { principal: { kind: "service", id: "p9-sales-disable-race" }, effectiveActor: { kind: "service", id: "p9-sales-disable-race" } },
      request, authorizationContext: { permissionFingerprint: "p9-sales-disable-race" }, input, idempotencyKey, signal: new AbortController().signal
    });
    return { authorized: true, request, transactionID, task };
  } catch (error) {
    await request.payload.db.rollbackTransaction(transactionID);
    throw error;
  }
}

function runProofChild(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [testFile], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, P9_SALES_RACE_CHILD: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

async function proveRace(connectionString) {
  const pool = new pg.Pool({ connectionString });
  let payload;
  let admitted;
  let salesCommitted = false;
  let pendingDisable;
  try {
    await pool.query(
      `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
       values ($1,$2,$3,$4,0,'active',$5,$6::jsonb)`,
      [identity.applicationId, identity.environment, identity.deliveryClass, identity.extensionId, activeGeneration.generationId, JSON.stringify(activeGeneration)]
    );
    await pool.query("insert into runtime_extension_inventory_revisions (application_id, environment, revision) values ($1,$2,0)", [identity.applicationId, identity.environment]);
    const authorizationLifecycleProjector = new AuthorizationLifecycleProjector(
      createStaticPlatformPluginAuthorizationDescriptorResolver({
        applicationId: identity.applicationId,
        registrations: [{ sourceCommit: activeGeneration.sourceCommit, registration: scopedSalesRegistration() }]
      })
    );
    await seedActiveSalesAuthorization(pool, authorizationLifecycleProjector);
    const store = new PostgresRuntimeExtensionStore(pool, { now: () => new Date("2026-08-31T00:00:00.000Z") }, `sha256:${"a".repeat(64)}`, {
      authorizationLifecycleProjector,
      sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder()
    });
    const change = {
      ...identity, extension: { deliveryClass: identity.deliveryClass, id: identity.extensionId }, operation: "disable", targetVersion: "1.0.0", expectedRevision: 0,
      idempotencyKey: "p9-sales-disable-race", correlationId: "p9-sales-disable-race"
    };
    const claimed = await store.claimOperation({
      request: change, requestDigest: `sha256:${"1".repeat(64)}`, workerId: "worker:p9-sales-disable-race",
      authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: `sha256:${"2".repeat(64)}` }
    });
    assert.equal(claimed.status, "claimed");
    const operation = await store.savePlan(claimed.operation.operationId, claimed.operation.leaseToken, disablePlan(claimed.operation.operationId));

    process.env.DATABASE_URL = connectionString;
    process.env.PAYLOAD_SECRET = "p9-sales-race-secret";
    const { default: config } = await import("../dist/src/payload.config.js");
    payload = await getPayload({ config, key: "p9-sales-disable-race" });
    admitted = await admitSales(payload, { title: "Commit before disable", status: "open" }, "p9-sales-disable-race-task");
    assert.equal(admitted.authorized, true);
    assert.deepEqual({ title: admitted.task.title, status: admitted.task.status }, { title: "Commit before disable", status: "open" });

    pendingDisable = store.disableGeneration(operation.operationId, operation.leaseToken);
    await waitForDisableLock(pool);
    console.error("P9_SALES_RACE_DISABLE_BLOCKED");
    assert.deepEqual((await pool.query("select count(*)::int count from sales_tasks")).rows, [{ count: 0 }], "Uncommitted Sales task must remain invisible while disable waits.");
    assert.deepEqual((await pool.query("select count(*)::int count from k_nex_outbox where plugin_id='module.sales'")).rows, [{ count: 0 }], "Uncommitted Sales outbox must remain invisible while disable waits.");

    await admitted.request.payload.db.commitTransaction(admitted.transactionID);
    salesCommitted = true;
    console.error("P9_SALES_RACE_SALES_COMMITTED");
    const receipt = await pendingDisable;
    pendingDisable = undefined;
    console.error("P9_SALES_RACE_DISABLE_COMMITTED");
    assert.equal(receipt.disposition, "disabled");
    assert.equal(receipt.revisionBefore, 1);
    assert.equal(receipt.revisionAfter, 2);
    assert.deepEqual((await pool.query("select disposition from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4", [identity.applicationId, identity.environment, identity.deliveryClass, identity.extensionId])).rows, [{ disposition: "disabled" }]);
    const committed = {
      tasks: Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),
      outbox: Number((await pool.query("select count(*) count from k_nex_outbox where plugin_id='module.sales'")).rows[0].count)
    };
    assert.deepEqual(committed, { tasks: 1, outbox: 1 });

    assert.deepEqual(await admitSales(payload, { title: "Must be denied", status: "open" }, "p9-sales-disable-race-denied"), { authorized: false });
    assert.deepEqual({
      tasks: Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),
      outbox: Number((await pool.query("select count(*) count from k_nex_outbox where plugin_id='module.sales'")).rows[0].count)
    }, committed, "Post-disable locked lifecycle read must deny Sales without task/outbox mutation.");
    console.error("P9_SALES_RACE_ASSERTIONS_PASS");
  } catch (error) {
    console.error("P9_SALES_DISABLE_RACE_FAILURE", error);
    throw error;
  } finally {
    if (admitted?.authorized && !salesCommitted) await admitted.request.payload.db.rollbackTransaction(admitted.transactionID).catch(() => undefined);
    await pendingDisable?.catch(() => undefined);
    console.error("P9_SALES_RACE_CLEANUP_PAYLOAD_START");
    await payload?.destroy();
    console.error("P9_SALES_RACE_CLEANUP_PAYLOAD_DONE");
    await pool.end();
    console.error("P9_SALES_RACE_CLEANUP_POOL_DONE");
  }
}

if (process.env.P9_SALES_RACE_CHILD === "1") {
  try {
    await proveRace(process.env.DATABASE_URL);
    process.stdout.write("P9_SALES_DISABLE_RACE_PASS\n");
    process.exit(0);
  } catch (error) {
    console.error("P9_SALES_DISABLE_RACE_CHILD_FAILURE", error);
    process.exit(1);
  }
} else {
  test("Sales admission and durable outbox commit before the same-key disable transition", { timeout: 90_000 }, async () => {
    const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("sales_disable_race").withStartupTimeout(60_000).start();
    try {
      await boot(postgres.getConnectionUri());
      assert.match(await runProofChild(postgres.getConnectionUri()), /P9_SALES_DISABLE_RACE_PASS/u);
    } finally {
      await postgres.stop();
    }
  });
}
