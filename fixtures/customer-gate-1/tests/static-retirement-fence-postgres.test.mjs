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
    const retirementIndex = await pool.query(
      "select indexdef from pg_indexes where schemaname='public' and indexname='runtime_static_generation_retirements_pending_idx'"
    );
    const pendingIndexDefinition = retirementIndex.rows[0]?.indexdef ?? "";
    assert.match(pendingIndexDefinition, /\(application_id, environment, reserved_at, generation_id\)/u);
    assert.match(pendingIndexDefinition, /WHERE/u);
    assert.match(pendingIndexDefinition, /reserved/u, "Pending retirement pagination must use the durable owner/time/generation partial index.");
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
    const liveStore = new PostgresStaticDeploymentStore(pool, { now: () => new Date() }, reader);
    const skewedStore = new PostgresStaticDeploymentStore(pool, { now: () => new Date("2000-01-01T00:00:00.000Z") }, reader);
    const recoveryInput = async (owner) => {
      const [state, fence] = await Promise.all([store.read(owner), store.readFence(owner)]);
      return { ...owner, expectedRevision: state.revision, expectedFencingToken: fence.fencingToken, expectedPromotionRevision: fence.promotionRevision, generationId: state.active.generationId, executionLeaseDurationMs: 1_000 };
    };
    await Promise.all([
      store.initialize({ ...alpha, generation: baseGeneration(alphaRelease.change), workerOwner: "worker:alpha", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt }),
      store.initialize({ ...beta, generation: baseGeneration(betaRelease.change), workerOwner: "worker:beta", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt }),
      store.initialize({ ...gamma, generation: baseGeneration(gammaRelease.change), workerOwner: "worker:gamma", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt })
    ]);
    const lifecycleAdmission = async (currentOwner, generationId, expectedRevision) => {
      const state = await store.read(currentOwner);
      const operationId = `operation-${createHash("sha256").update(`${currentOwner.applicationId}:${generationId}:${expectedRevision}`).digest("hex").slice(0, 32)}`;
      await pool.query(
        `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation, last_operation_id)
         values ($1,$2,'platform-plugin','module.sales',$3,'active',$4,$5::jsonb,$6)
         on conflict (application_id, environment, delivery_class, extension_id) do update
         set revision=excluded.revision, disposition='active', active_generation_id=excluded.active_generation_id, active_generation=excluded.active_generation, retained_generation=null, last_operation_id=excluded.last_operation_id`,
        [currentOwner.applicationId, currentOwner.environment, expectedRevision, state.active.generationId, JSON.stringify(state.active), operationId]
      );
      await pool.query(
        `insert into runtime_extension_operations (
           operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
           request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json
         ) values ($1,$2,$3,'platform-plugin','module.sales','update',$4,$5,'{}'::jsonb,'{}'::jsonb,$6,'source-change-ready','worker:test','lease-test',$7,$8::jsonb)
         on conflict (operation_id) do update set expected_revision=excluded.expected_revision, phase=excluded.phase, plan_json=excluded.plan_json`,
        [operationId, currentOwner.applicationId, currentOwner.environment, `promote:${generationId}`, digest(operationId), expectedRevision, leaseExpiresAt,
          JSON.stringify({ executionClass: "static-release", operationId, generationId, quarantineRecovery: false, plan: { id: "module.sales" } })]
      );
      return { operationId, expectedRevision, extensionId: "module.sales", quarantineRecovery: false };
    };

    const alphaInitialRecoveryInput = await recoveryInput(alpha);
    const recovery = await store.reserveWorkerRecoveryActivation(alphaInitialRecoveryInput);
    await store.assertWorkerRecoveryActivation(recovery);
    assert.deepEqual(await store.readWorkerRecoveryActivation(alpha), recovery, "A response-lost recovery must remain discoverable for exact completion replay.");
    assert.deepEqual(await store.reserveWorkerRecoveryActivation(await recoveryInput(alpha)), recovery, "A live recovery claim must replay its exact durable ticket.");
    await assert.rejects(
      store.promote({ ...alpha, expectedRevision: 0, expectedFenceToken: 1, generationId: "recovery-blocked-green-12", workerOwner: "worker:alpha", workerLeaseExpiresAt: leaseExpiresAt, build: alphaToken, readiness: readiness(alphaRelease, "recovery-blocked-green-12"), lifecycleAdmission: await lifecycleAdmission(alpha, "recovery-blocked-green-12", 0) }),
      { code: "REVISION_CONFLICT" },
      "A live worker-recovery ticket must fence competing pointer mutation."
    );
    await assert.rejects(store.assertWorkerRecoveryActivation({ ...recovery, fencingToken: recovery.fencingToken + 1 }), { code: "FENCE_REJECTED" });
    await store.completeWorkerRecoveryActivation(recovery);
    await store.completeWorkerRecoveryActivation(recovery);
    assert.equal(await store.readWorkerRecoveryActivation(alpha), undefined);
    const completedRecoveryFence = await store.readFence(alpha);
    assert.ok(Date.parse(completedRecoveryFence.lease.expiresAt) <= Date.now() + 1_100, "Recovery completion must replace its 60-second activation ticket with the configured one-second execution lease.");
    assert.ok(Date.parse(recovery.recoveryExpiresAt) > Date.parse(completedRecoveryFence.lease.expiresAt) + 50_000, "Activation ticket TTL and live execution lease must remain distinct.");
    await assert.rejects(store.reserveWorkerRecoveryActivation(alphaInitialRecoveryInput), { code: "REVISION_CONFLICT" }, "A delayed stale probe cannot mint a second recovery epoch after completion.");
    assert.deepEqual(
      (await pool.query("select generation_id, deployment_revision, fencing_token, promotion_revision, lease_owner, state, completed_at is not null completed from runtime_static_worker_activations where recovery_id=$1", [recovery.recoveryId])).rows,
      [{ generation_id: "shared-blue-11", deployment_revision: 0, fencing_token: "2", promotion_revision: 0, lease_owner: `static-recovery:${recovery.recoveryId}`, state: "completed", completed: true }],
      "A completed recovery ticket remains a permanent exact audit record."
    );
    assert.deepEqual(
      (await pool.query("select event_id, recovery_id, deployment_revision, promotion_revision, previous_fencing_token, fencing_token from runtime_static_worker_recovery_outbox where recovery_id=$1", [recovery.recoveryId])).rows,
      [{ event_id: recovery.recoveryId, recovery_id: recovery.recoveryId, deployment_revision: 0, promotion_revision: 0, previous_fencing_token: "1", fencing_token: "2" }],
      "Recovery takeover must atomically retain one durable fence-convergence event."
    );
    const expiredRecovery = await store.reserveWorkerRecoveryActivation(await recoveryInput(alpha));
    await pool.query("update runtime_static_worker_activations set recovery_expires_at=$2 where recovery_id=$1", [expiredRecovery.recoveryId, new Date(now.valueOf() - 1_000).toISOString()]);
    assert.equal(await store.expireWorkerRecoveryActivation(alpha), true, "A late restart must durably reconcile an expired response-lost activation claim.");
    assert.equal(await store.readWorkerRecoveryActivation(alpha), undefined);
    assert.equal((await pool.query("select state from runtime_static_worker_activations where recovery_id=$1", [expiredRecovery.recoveryId])).rows[0].state, "expired");
    const takeoverRecovery = await store.reserveWorkerRecoveryActivation({ ...await recoveryInput(alpha), executionLeaseDurationMs: 300_000 });
    assert.notEqual(takeoverRecovery.recoveryId, expiredRecovery.recoveryId, "An expired recovery ticket must be replaced rather than revived.");
    await assert.rejects(store.assertWorkerRecoveryActivation(expiredRecovery), { code: "FENCE_REJECTED" });
    await store.completeWorkerRecoveryActivation(takeoverRecovery);
    assert.equal(takeoverRecovery.fencingToken, 4, "The replacement recovery must advance Alpha to its next monotonic fence epoch.");
    const betaRecoveryInput = await recoveryInput(beta);
    const [concurrentRecoveryA, concurrentRecoveryB] = await Promise.all([store.reserveWorkerRecoveryActivation(betaRecoveryInput), store.reserveWorkerRecoveryActivation(betaRecoveryInput)]);
    assert.deepEqual(concurrentRecoveryA, concurrentRecoveryB, "Concurrent recovery callers must share the sole live owner ticket.");
    await store.completeWorkerRecoveryActivation(concurrentRecoveryA);
    const oneShotGenerationId = "completed-tombstone-green-12";
    const completedReservation = await store.reserveGenerationRetirement({ ...alpha, generationId: oneShotGenerationId });
    assert.ok(completedReservation);
    await store.completeGenerationRetirement(completedReservation);
    await assert.rejects(
      store.promote({
        ...alpha, expectedRevision: 0, expectedFenceToken: 3, generationId: oneShotGenerationId,
        workerOwner: "worker:alpha", workerLeaseExpiresAt: leaseExpiresAt,
        build: alphaToken, readiness: readiness(alphaRelease, oneShotGenerationId), lifecycleAdmission: await lifecycleAdmission(alpha, oneShotGenerationId, 0)
      }),
      { code: "REVISION_CONFLICT" },
      "A completed cleanup tombstone must keep the same owner/generation identity one-shot so stale retirement cannot race a reused ID."
    );

    const normalGenerationId = "normal-rollback-green-12";
    await store.promote({
      ...gamma, expectedRevision: 0, expectedFenceToken: 1, generationId: normalGenerationId,
      workerOwner: "worker:gamma-green", workerLeaseExpiresAt: leaseExpiresAt,
      build: gammaToken, readiness: readiness(gammaRelease, normalGenerationId), lifecycleAdmission: await lifecycleAdmission(gamma, normalGenerationId, 0)
    });
    await assert.rejects(
      store.promote({
        ...gamma, expectedRevision: 1, expectedFenceToken: 2, generationId: "unfinished-promotion-green-13",
        workerOwner: "worker:gamma-green", workerLeaseExpiresAt: leaseExpiresAt,
        build: gammaToken, readiness: readiness(gammaRelease, "unfinished-promotion-green-13"), lifecycleAdmission: await lifecycleAdmission(gamma, "unfinished-promotion-green-13", 1)
      }),
      { code: "REVISION_CONFLICT" },
      "Promotion must not overwrite an unfinished prior transition checkpoint."
    );
    await assert.rejects(
      store.rollback({ ...gamma, expectedRevision: 1, expectedFenceToken: 2, workerOwner: "worker:gamma-blue", workerLeaseExpiresAt: leaseExpiresAt }),
      { code: "REVISION_CONFLICT" },
      "Rollback must not overwrite an unfinished prior transition checkpoint."
    );
    await assert.rejects(
      store.reserveRollbackRetirement({ ...gamma, expectedRevision: 1, retiredGenerationId: "shared-blue-11" }),
      { code: "REVISION_CONFLICT" },
      "Rollback retirement must not overwrite an unfinished promotion checkpoint."
    );
    for (const step of ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"]) {
      const ticket = await store.reserveTransitionStep({ ...gamma, expectedRevision: 1, step, reservationId: randomUUID() });
      await store.assertTransitionTicket(ticket);
      await store.completeTransitionStep(ticket);
      if (step === "activate-worker") {
        const recoveryDuringTransition = await store.reserveWorkerRecoveryActivation(await recoveryInput(gamma));
        assert.equal(recoveryDuringTransition.fencingToken, 3, "An activated worker may recover before later post-commit steps finish.");
        await store.completeWorkerRecoveryActivation(recoveryDuringTransition);
      }
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
        build: gammaToken, readiness: readiness(gammaRelease, "shared-blue-11"), lifecycleAdmission: await lifecycleAdmission(gamma, "shared-blue-11", 3)
      }),
      { code: "REVISION_CONFLICT" },
      "Completed normal rollback retirement must preserve the protected same-owner tombstone."
    );

    const raceGenerationId = "shared-race-green-12";
    const racedStore = new PostgresStaticDeploymentStore(barrierPool(pool), { now: () => now }, reader);
    const raceLifecycleAdmission = await lifecycleAdmission(alpha, raceGenerationId, 0);
    const [reservationOutcome, promotionOutcome] = await Promise.allSettled([
      racedStore.reserveGenerationRetirement({ ...alpha, generationId: raceGenerationId }),
      racedStore.promote({
        ...alpha, expectedRevision: 0, expectedFenceToken: takeoverRecovery.fencingToken, generationId: raceGenerationId,
        workerOwner: "worker:alpha", workerLeaseExpiresAt: leaseExpiresAt,
        build: alphaToken, readiness: readiness(alphaRelease, raceGenerationId), lifecycleAdmission: raceLifecycleAdmission
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
      ...beta, expectedRevision: 0, expectedFenceToken: 2, generationId: sharedGenerationId,
      workerOwner: "worker:beta", workerLeaseExpiresAt: leaseExpiresAt,
      build: betaToken, readiness: readiness(betaRelease, sharedGenerationId), lifecycleAdmission: await lifecycleAdmission(beta, sharedGenerationId, 0)
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
    await pool.query("update runtime_worker_generation_fences set lease_expires_at=now()+interval '5 minutes' where application_id=$1 and environment=$2", [alpha.applicationId, alpha.environment]);
    const activeFence = await store.readFence(alpha);
    const renewal = { ...alpha, generationId: activeFence.activeExecutionGeneration, fencingToken: activeFence.fencingToken, owner: activeFence.lease.owner, expectedPromotionRevision: activeFence.promotionRevision, leaseDurationMs: 300_000 };
    const firstRenewal = await store.renewWorkerFence(renewal);
    const secondRenewal = await store.renewWorkerFence(renewal);
    assert.ok(Date.parse(secondRenewal.lease.expiresAt) >= Date.parse(firstRenewal.lease.expiresAt));
    assert.ok(Date.parse(secondRenewal.lease.expiresAt) <= Date.now() + 300_100, "Frequent heartbeats must stay bounded to one configured lease from database now.");
    await assert.rejects(store.renewWorkerFence({ ...renewal, owner: "worker:stale" }), { code: "FENCE_REJECTED" });
    await assert.rejects(store.renewWorkerFence({ ...renewal, expectedPromotionRevision: activeFence.promotionRevision + 1 }), { code: "FENCE_REJECTED" });
    const expiredFenceInput = await recoveryInput(alpha);
    await pool.query("update runtime_worker_generation_fences set lease_expires_at=now()-interval '1 second' where application_id=$1 and environment=$2", [alpha.applicationId, alpha.environment]);
    await assert.rejects(store.renewWorkerFence(renewal), { code: "FENCE_REJECTED" }, "An expired execution lease must never be revived.");
    const delayedRecovery = await store.reserveWorkerRecoveryActivation(expiredFenceInput);
    assert.equal(delayedRecovery.fencingToken, activeFence.fencingToken + 1, "Expired active-worker authority must recover only through a new monotonic fence epoch.");
    assert.match(delayedRecovery.leaseOwner, /^static-recovery:/u);
    await assert.rejects(store.claimEffect({ ...alpha, effectId: "stale-recovery-effect", generationId: activeFence.activeExecutionGeneration, fencingToken: activeFence.fencingToken, claimantId: "worker:stale", claimLeaseDurationMs: 1_000 }), { code: "FENCE_REJECTED" });
    await store.completeWorkerRecoveryActivation(delayedRecovery);
    const effectFence = await liveStore.readFence(alpha);
    await liveStore.renewWorkerFence({
      ...alpha, generationId: effectFence.activeExecutionGeneration, fencingToken: effectFence.fencingToken, owner: effectFence.lease.owner,
      expectedPromotionRevision: effectFence.promotionRevision, leaseDurationMs: 5_000
    });
    const skewedClaimInput = {
      ...alpha, effectId: "db-clock-effect-claim", generationId: effectFence.activeExecutionGeneration, fencingToken: effectFence.fencingToken,
      claimantId: "worker:skewed-clock", claimLeaseDurationMs: 1_000
    };
    const concurrentClaims = await Promise.all([skewedStore.claimEffect(skewedClaimInput), skewedStore.claimEffect(skewedClaimInput)]);
    assert.deepEqual(concurrentClaims.map((claim) => claim.status).sort(), ["already-claimed", "claimed"], "DB-clock lease creation must serialize concurrent claims even with a wildly skewed process clock.");
    await pool.query("update runtime_worker_generation_fences set fencing_token=$3 where application_id=$1 and environment=$2", [alpha.applicationId, alpha.environment, Number.MAX_SAFE_INTEGER - 1]);
    await assert.rejects(store.reserveWorkerRecoveryActivation(await recoveryInput(alpha)), { code: "FENCE_REJECTED" }, "Fence exhaustion must fail closed instead of persisting an unusable token.");
    assert.equal((await store.readFence(alpha)).fencingToken, Number.MAX_SAFE_INTEGER - 1);
  } finally {
    await pool.end();
    await container.stop();
  }
});
