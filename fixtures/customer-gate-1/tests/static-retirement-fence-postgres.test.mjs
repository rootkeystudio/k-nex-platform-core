import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const now = new Date("2026-08-29T12:00:00.000Z");
const leaseExpiresAt = "2026-08-29T12:04:59.000Z";
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => digest(canonicalJson(value));

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-static-retirement-fence", BOOT_KEY: "p9-static-retirement-fence" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function release(owner) {
  const [planFixture, evidenceFixture] = await Promise.all([
    readFile(new URL("../../extensions/valid/static-composition-change-plan.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../extensions/valid/trusted-application-build-evidence.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const change = structuredClone(planFixture);
  change.applicationId = owner.applicationId;
  change.environment = owner.environment;
  change.migration.applicationId = owner.applicationId;
  change.migration.environment = owner.environment;
  const evidence = structuredClone(evidenceFixture);
  delete evidence.$schema;
  evidence.applicationId = owner.applicationId;
  evidence.environment = owner.environment;
  evidence.sourceCommit = change.target.sourceCommit;
  evidence.composition = change.target.composition;
  evidence.applicationSubject.digest = change.target.applicationSubjectDigest;
  evidence.imageSubject.digest = change.target.imageSubjectDigest;
  return {
    change,
    evidence,
    verified: { change: { status: "source-change-ready", planDigest: digestJson(change), targetSourceCommit: change.target.sourceCommit, change }, evidence, evidenceDigest: digestJson(evidence) }
  };
}

function baseGeneration(change) {
  return {
    generationId: "shared-blue-11",
    sourceCommit: change.base.sourceCommit,
    compositionChangePlanDigest: digestJson(change.base),
    buildEvidenceDigest: digestJson({ sourceCommit: change.base.sourceCommit }),
    applicationDigest: change.migration.rollbackWindow.previousApplicationDigest,
    imageDigest: `sha256:${"0".repeat(64)}`,
    imageReference: `ghcr.io/k-nex/shared@sha256:${"0".repeat(64)}`,
    migrationRevision: change.migration.baseRevision
  };
}

function readiness(release, generationId) {
  return {
    generationId,
    sourceCommit: release.change.target.sourceCommit,
    applicationDigest: release.evidence.applicationSubject.digest,
    imageDigest: release.evidence.imageSubject.digest,
    migrationRevision: release.change.migration.targetRevision,
    completedMigrationSteps: release.change.migration.steps.filter((step) => step.phase === "online-expand" || step.phase === "online-backfill").map((step) => step.stepId),
    publicSmoke: true,
    authenticatedSmoke: true,
    inventoryReconciled: true,
    workerMode: "passive",
    gatewayCapacity: true,
    realtimeReady: true,
    observedAt: now.toISOString()
  };
}

function barrierPool(pool) {
  let arrived = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  return {
    query: (...input) => pool.query(...input),
    async connect() {
      const session = await pool.connect();
      return {
        async query(statement, values) {
          if (typeof statement === "string" && statement.startsWith("select pg_advisory_xact_lock")) {
            arrived += 1;
            if (arrived === 2) release();
            await barrier;
          }
          return session.query(statement, values);
        },
        release: () => session.release()
      };
    }
  };
}

test("rejected-generation retirement is atomic, durable, and owner scoped", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_retirement_fence").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 6 });
  try {
    await boot(container.getConnectionUri());
    const alpha = { applicationId: "customer-alpha", environment: "production" };
    const beta = { applicationId: "customer-beta", environment: "production" };
    const gamma = { applicationId: "customer-gamma", environment: "production" };
    const alphaRelease = await release(alpha);
    const betaRelease = await release(beta);
    const gammaRelease = await release(gamma);
    const alphaToken = {};
    const betaToken = {};
    const gammaToken = {};
    const builds = new Map([[alphaToken, alphaRelease.verified], [betaToken, betaRelease.verified], [gammaToken, gammaRelease.verified]]);
    const reader = { read: (token) => {
      const value = builds.get(token);
      assert.ok(value, "Static build token must be verified.");
      return value;
    } };
    const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, reader);
    await Promise.all([
      store.initialize({ ...alpha, generation: baseGeneration(alphaRelease.change), workerOwner: "worker:alpha", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt }),
      store.initialize({ ...beta, generation: baseGeneration(betaRelease.change), workerOwner: "worker:beta", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt }),
      store.initialize({ ...gamma, generation: baseGeneration(gammaRelease.change), workerOwner: "worker:gamma", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt })
    ]);

    const oneShotGenerationId = "completed-tombstone-green-12";
    const completedReservation = await store.reserveGenerationRetirement({ ...alpha, generationId: oneShotGenerationId });
    assert.ok(completedReservation);
    await store.completeGenerationRetirement(completedReservation);
    await assert.rejects(
      store.promote({
        ...alpha, expectedRevision: 0, expectedFenceToken: 1, generationId: oneShotGenerationId,
        workerOwner: "worker:alpha", workerLeaseExpiresAt: leaseExpiresAt,
        build: alphaToken, readiness: readiness(alphaRelease, oneShotGenerationId)
      }),
      { code: "REVISION_CONFLICT" },
      "A completed cleanup tombstone must keep the same owner/generation identity one-shot so stale retirement cannot race a reused ID."
    );

    const normalGenerationId = "normal-rollback-green-12";
    await store.promote({
      ...gamma, expectedRevision: 0, expectedFenceToken: 1, generationId: normalGenerationId,
      workerOwner: "worker:gamma-green", workerLeaseExpiresAt: leaseExpiresAt,
      build: gammaToken, readiness: readiness(gammaRelease, normalGenerationId)
    });
    await assert.rejects(
      store.reserveRollbackRetirement({ ...gamma, expectedRevision: 1, retiredGenerationId: "shared-blue-11" }),
      { code: "REVISION_CONFLICT" },
      "Rollback retirement must not overwrite an unfinished promotion checkpoint."
    );
    for (const step of ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"]) {
      const ticket = await store.reserveTransitionStep({ ...gamma, expectedRevision: 1, step, reservationId: randomUUID() });
      await store.assertTransitionTicket(ticket);
      await store.completeTransitionStep(ticket);
    }
    const normalReservation = await store.reserveRollbackRetirement({ ...gamma, expectedRevision: 1, retiredGenerationId: "shared-blue-11" });
    assert.deepEqual(await store.readGenerationRetirement({ ...gamma, generationId: "shared-blue-11" }), normalReservation, "Normal rollback retirement must retain the exact durable one-shot reservation.");
    const drainTicket = await store.reserveTransitionStep({ ...gamma, expectedRevision: 2, step: "drain-retained", reservationId: randomUUID() });
    await store.assertTransitionTicket(drainTicket);
    await store.completeTransitionStep(drainTicket);
    const retireTicket = await store.reserveTransitionStep({ ...gamma, expectedRevision: 2, step: "retire-retained", reservationId: randomUUID() });
    await store.assertTransitionTicket(retireTicket, normalReservation);
    await store.completeGenerationRetirement(normalReservation);
    await store.completeTransitionStep(retireTicket);
    const closeReceipt = await store.closeRollback({ ...gamma, expectedRevision: 2, retiredGenerationId: "shared-blue-11" });
    assert.equal(closeReceipt.operation, "close-rollback");
    assert.equal((await store.read(gamma)).rollbackWindow.state, "closed");
    await assert.rejects(
      store.promote({
        ...gamma, expectedRevision: 3, expectedFenceToken: 2, generationId: "shared-blue-11",
        workerOwner: "worker:gamma-reused", workerLeaseExpiresAt: leaseExpiresAt,
        build: gammaToken, readiness: readiness(gammaRelease, "shared-blue-11")
      }),
      { code: "REVISION_CONFLICT" },
      "Completed normal rollback retirement must preserve the protected same-owner tombstone."
    );

    const raceGenerationId = "shared-race-green-12";
    const racedStore = new PostgresStaticDeploymentStore(barrierPool(pool), { now: () => now }, reader);
    const [reservationOutcome, promotionOutcome] = await Promise.allSettled([
      racedStore.reserveGenerationRetirement({ ...alpha, generationId: raceGenerationId }),
      racedStore.promote({
        ...alpha, expectedRevision: 0, expectedFenceToken: 1, generationId: raceGenerationId,
        workerOwner: "worker:alpha", workerLeaseExpiresAt: leaseExpiresAt,
        build: alphaToken, readiness: readiness(alphaRelease, raceGenerationId)
      })
    ]);
    assert.equal(reservationOutcome.status, "fulfilled", reservationOutcome.reason?.stack ?? reservationOutcome.reason?.message);
    if (reservationOutcome.value) {
      assert.equal(promotionOutcome.status, "rejected");
      assert.equal(promotionOutcome.reason.code, "REVISION_CONFLICT");
      assert.equal((await store.read(alpha)).active.generationId, "shared-blue-11");
    } else {
      assert.equal(promotionOutcome.status, "fulfilled");
      assert.equal((await store.read(alpha)).active.generationId, raceGenerationId);
    }

    const sharedGenerationId = "shared-owner-green-12";
    const alphaReservation = await store.reserveGenerationRetirement({ ...alpha, generationId: sharedGenerationId });
    assert.ok(alphaReservation, "Alpha must reserve its passive rejected target.");
    const betaReceipt = await store.promote({
      ...beta, expectedRevision: 0, expectedFenceToken: 1, generationId: sharedGenerationId,
      workerOwner: "worker:beta", workerLeaseExpiresAt: leaseExpiresAt,
      build: betaToken, readiness: readiness(betaRelease, sharedGenerationId)
    });
    assert.equal(betaReceipt.activeGenerationId, sharedGenerationId, "Alpha's reservation must not fence Beta's same-ID generation.");
    await store.completeGenerationRetirement(alphaReservation);
    await store.completeGenerationRetirement(alphaReservation);
    const rows = await pool.query(
      "select application_id, generation_id, state, completed_at is not null completed from runtime_static_generation_retirements where generation_id=$1",
      [sharedGenerationId]
    );
    assert.deepEqual(rows.rows, [{ application_id: alpha.applicationId, generation_id: sharedGenerationId, state: "completed", completed: true }]);
    assert.equal((await store.read(beta)).active.generationId, sharedGenerationId);
  } finally {
    await pool.end();
    await container.stop();
  }
});
