import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function until(check, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function childExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Generated worker did not exit before its bounded deadline.")), timeoutMs);
    child.once("close", (code) => { clearTimeout(timeout); resolve(code); });
  });
}

test("P13.3 generated worker joins admitted work, bounds a blocked drain, and fails rejected dispatch shutdowns", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ acknowledgeAbnormalWorkerExit, application, pool, startWorker, stopWorker, workerOutput, workerProcess }) => {
    const initiallyRunning = workerProcess();
    assert.ok(initiallyRunning);
    await stopWorker();
    assert.equal(initiallyRunning.exitCode, 0, "Generated worker success shutdown must exit zero.");
    const identity = { applicationId: "p13-crm-browser", environment: "test" };
    const state = await pool.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1", [identity.applicationId]);
    assert.equal(state.rows.length, 1);
    const event = {
      applicationId: identity.applicationId,
      environment: identity.environment,
      scope: "application",
      authorizationRevision: 999_999,
      lifecycleRevision: Number(state.rows[0].lifecycle_revision)
    };
    const eventId = randomUUID();
    await pool.query(
      "insert into k_nex_authorization_outbox (event_id,application_id,environment,authorization_revision,lifecycle_revision,event_json) values ($1,$2,$3,$4,$5,$6::jsonb)",
      [eventId, event.applicationId, event.environment, event.authorizationRevision, event.lifecycleRevision, JSON.stringify(event)]
    );
    const lock = await pool.connect();
    try {
      await lock.query("begin");
      await lock.query("lock table k_nex_authorization_outbox in access exclusive mode");
      const deliveredOutputStart = workerOutput().length;
      await startWorker();
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const activity = await pool.query("select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%k_nex_authorization_outbox%'");
        if (Number(activity.rows[0]?.count) > 0) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(blocked, true, "Generated worker never admitted the locked authorization dispatch.");
      let exited = false;
      const stopping = stopWorker().then(() => { exited = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(exited, false, "Generated worker closed its pool before its admitted dispatch resolved.");
      await lock.query("commit");
      await stopping;
      const delivered = await pool.query("select status from k_nex_authorization_outbox where event_id=$1", [eventId]);
      assert.deepEqual(delivered.rows, [{ status: "delivered" }]);
      assert.doesNotMatch(workerOutput().slice(deliveredOutputStart), /K_NEX_(?:AUTHORIZATION|WORKSPACE|REALTIME)_OUTBOX_ERROR|Connection terminated/u);
    } finally {
      await lock.query("rollback").catch(() => undefined);
      lock.release();
    }

    const blockedEventId = randomUUID();
    await pool.query(
      "insert into k_nex_authorization_outbox (event_id,application_id,environment,authorization_revision,lifecycle_revision,event_json) values ($1,$2,$3,$4,$5,$6::jsonb)",
      [blockedEventId, identity.applicationId, identity.environment, 999_998, Number(state.rows[0].lifecycle_revision), JSON.stringify({ applicationId: identity.applicationId, environment: identity.environment, scope: "application", authorizationRevision: 999_998, lifecycleRevision: Number(state.rows[0].lifecycle_revision) })]
    );
    const held = await pool.connect();
    try {
      await held.query("begin");
      await held.query("lock table k_nex_authorization_outbox in access exclusive mode");
      const blockedOutputStart = workerOutput().length;
      await startWorker();
      await until(async () => Number((await pool.query("select count(*)::int count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%k_nex_authorization_outbox%'")).rows[0]?.count) > 0, "Generated worker never admitted the indefinitely blocked dispatch.");
      const blockedWorker = workerProcess();
      assert.ok(blockedWorker);
      blockedWorker.kill("SIGTERM");
      assert.equal(await childExit(blockedWorker, 35_000), 1, "Blocked worker must hit its explicit nonzero shutdown watchdog.");
      assert.match(workerOutput().slice(blockedOutputStart), /K_NEX_WORKER_SHUTDOWN_EXPIRED/u);
      acknowledgeAbnormalWorkerExit(blockedWorker);
      await held.query("commit");
      await startWorker();
      await until(async () => (await pool.query("select status from k_nex_authorization_outbox where event_id=$1", [blockedEventId])).rows[0]?.status === "delivered", "Blocked authorization event was not recoverable after the watchdog exit.");
      await stopWorker();
    } finally {
      await held.query("rollback").catch(() => undefined);
      held.release();
    }

    const rejectedEventId = randomUUID();
    await pool.query(
      "insert into k_nex_authorization_outbox (event_id,application_id,environment,authorization_revision,lifecycle_revision,event_json) values ($1,$2,$3,$4,$5,$6::jsonb)",
      [rejectedEventId, identity.applicationId, identity.environment, 999_997, Number(state.rows[0].lifecycle_revision), JSON.stringify({})]
    );
    const priorOutputLength = workerOutput().length;
    await startWorker();
    await until(async () => workerOutput().slice(priorOutputLength).includes("K_NEX_AUTHORIZATION_OUTBOX_ERROR"), "Generated worker did not report the rejected admitted dispatch.");
    const rejectedWorker = workerProcess();
    assert.ok(rejectedWorker);
    rejectedWorker.kill("SIGTERM");
    assert.equal(await childExit(rejectedWorker, 35_000), 1, "Rejected dispatch shutdown must be nonzero after pool cleanup.");
    assert.match(workerOutput().slice(priorOutputLength), /K_NEX_AUTHORIZATION_OUTBOX_ERROR/u);
    acknowledgeAbnormalWorkerExit(rejectedWorker);
    assert.deepEqual((await pool.query("select status from k_nex_authorization_outbox where event_id=$1", [rejectedEventId])).rows, [{ status: "pending" }]);
    assert.doesNotMatch(workerOutput().slice(priorOutputLength), /Connection terminated|unhandled|uncaught/iu);
    assert.deepEqual((await pool.query("select 1 as ready")).rows, [{ ready: 1 }]);
    assert.deepEqual((await pool.query("delete from k_nex_authorization_outbox where event_id=$1 returning event_id", [rejectedEventId])).rows, [{ event_id: rejectedEventId }]);

    const workerPath = resolve(application, "dist/k-nex-worker.js");
    const workerSource = readFileSync(workerPath, "utf8");
    const shortenedWatchdog = workerSource.replace(
      'const shutdownDeadline = setTimeout(() => { process.exitCode = 1; console.error("K_NEX_WORKER_SHUTDOWN_EXPIRED"); process.exit(1); }, 30_000);',
      'const shutdownDeadline = setTimeout(() => { process.exitCode = 1; console.error("K_NEX_WORKER_SHUTDOWN_EXPIRED"); process.exit(1); }, 150);'
    );
    assert.notEqual(shortenedWatchdog, workerSource, "Generated worker shutdown deadline seam changed.");
    const handleFreeNever = shortenedWatchdog.replace(
      "clearTimeout(shutdownDeadline);\nprocess.exit(0);",
      "await new Promise(() => {});\nclearTimeout(shutdownDeadline);\nprocess.exit(0);"
    );
    assert.notEqual(handleFreeNever, shortenedWatchdog, "Generated worker final shutdown seam changed.");
    writeFileSync(workerPath, handleFreeNever);
    const neverOutputStart = workerOutput().length;
    await startWorker();
    await until(async () => workerOutput().slice(neverOutputStart).includes("K_NEX_WORKER_READY"), "Injected worker never installed its signal listener.");
    assert.ok(workerOutput().indexOf("K_NEX_WORKER_READY", neverOutputStart) >= neverOutputStart, "Injected worker reused a prior readiness marker.");
    const neverWorker = workerProcess();
    assert.ok(neverWorker);
    const neverStartedAt = Date.now();
    neverWorker.kill("SIGTERM");
    assert.equal(await childExit(neverWorker, 5_000), 1, "Handle-free worker shutdown must hit its referenced watchdog.");
    assert.match(workerOutput().slice(neverOutputStart), /K_NEX_WORKER_SHUTDOWN_EXPIRED/u);
    assert.ok(Date.now() - neverStartedAt >= 100, "Worker did not wait for its shutdown watchdog.");
    acknowledgeAbnormalWorkerExit(neverWorker);

    const settledRejection = shortenedWatchdog.replace(
      "let shutdownFailure;",
      'admittedFailures.push(new Error("P13_3_INJECTED_SETTLED_WORKER_FAILURE"));\nlet shutdownFailure;'
    );
    assert.notEqual(settledRejection, shortenedWatchdog, "Generated worker settled rejection seam changed.");
    writeFileSync(workerPath, settledRejection);
    const rejectionOutputStart = workerOutput().length;
    await startWorker();
    await until(async () => workerOutput().slice(rejectionOutputStart).includes("K_NEX_WORKER_READY"), "Injected rejecting worker never installed its signal listener.");
    assert.ok(workerOutput().indexOf("K_NEX_WORKER_READY", rejectionOutputStart) >= rejectionOutputStart, "Injected rejecting worker reused a prior readiness marker.");
    const rejectedImmediately = workerProcess();
    assert.ok(rejectedImmediately);
    const rejectionStartedAt = Date.now();
    rejectedImmediately.kill("SIGTERM");
    assert.equal(await childExit(rejectedImmediately, 5_000), 1, "Settled worker shutdown rejection must exit nonzero.");
    assert.match(workerOutput().slice(rejectionOutputStart), /P13_3_INJECTED_SETTLED_WORKER_FAILURE/u);
    assert.ok(Date.now() - rejectionStartedAt < 2_000, "Worker waited for its watchdog after a settled rejection.");
    acknowledgeAbnormalWorkerExit(rejectedImmediately);
    writeFileSync(workerPath, workerSource);
  });
});
