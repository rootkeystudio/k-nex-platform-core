import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { startAdministrationOperatorWorkerFenceHeartbeat } from "./administration-operator-worker-fence.mjs";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("administration operator renews one exact fence serially and stops its heartbeat", async () => {
  let scheduled;
  const delays = [];
  let cancelCount = 0;
  let renewalCount = 0;
  let releaseRenewal;
  const pendingRenewal = new Promise((resolve) => { releaseRenewal = resolve; });
  const renewal = Object.freeze({ generationId: "generation-1", fencingToken: 7, owner: "worker:operator", expectedPromotionRevision: 3, leaseDurationMs: 240_000 });
  const heartbeat = startAdministrationOperatorWorkerFenceHeartbeat({
    intervalMs: 60_000,
    renewal,
    store: { async renewWorkerFence(input) {
      assert.equal(input, renewal);
      renewalCount += 1;
      if (renewalCount === 1) await pendingRenewal;
    } },
    onFailure: assert.fail,
    schedule(callback, delay) { scheduled = callback; delays.push(delay); return { unref() {} }; },
    cancel() { cancelCount += 1; }
  });

  scheduled();
  assert.equal(renewalCount, 0, "Renewal must enter the serialized promise queue.");
  await nextTurn();
  assert.equal(renewalCount, 1, "A slow renewal must not overlap another fence mutation.");
  assert.deepEqual(delays, [60_000], "Heartbeat must use the bounded quarter-lease cadence.");
  releaseRenewal();
  await nextTurn();
  assert.deepEqual(delays, [60_000, 60_000], "A successful renewal must arm exactly one next heartbeat.");
  scheduled();
  await nextTurn();
  assert.equal(renewalCount, 2);
  await heartbeat.stop();
  scheduled();
  await nextTurn();
  assert.equal(renewalCount, 2, "A stopped operator must not retain renewal authority.");
  assert.equal(cancelCount, 1);
});

test("administration operator fails closed when exact fence renewal is rejected", async () => {
  let scheduled;
  let cancelCount = 0;
  const failure = new Error("FENCE_REJECTED");
  const observed = [];
  startAdministrationOperatorWorkerFenceHeartbeat({
    intervalMs: 60_000,
    renewal: Object.freeze({ generationId: "generation-1" }),
    store: { async renewWorkerFence() { throw failure; } },
    onFailure: (error) => observed.push(error),
    schedule(callback) { scheduled = callback; return { unref() {} }; },
    cancel() { cancelCount += 1; }
  });

  scheduled();
  await nextTurn();
  await nextTurn();
  assert.deepEqual(observed, [failure]);
  assert.equal(cancelCount, 1);
  scheduled();
  await nextTurn();
  assert.deepEqual(observed, [failure], "A rejected fence must terminate renewal instead of retrying stale authority.");
});

test("administration operator stop waits for a blocked renewal and never rearms it", async () => {
  let scheduled;
  let cancelCount = 0;
  let renewalCount = 0;
  let releaseRenewal;
  let markRenewalStarted;
  const renewalStarted = new Promise((resolve) => { markRenewalStarted = resolve; });
  const pendingRenewal = new Promise((resolve) => { releaseRenewal = resolve; });
  const heartbeat = startAdministrationOperatorWorkerFenceHeartbeat({
    intervalMs: 60_000,
    renewal: Object.freeze({ generationId: "generation-1" }),
    store: { async renewWorkerFence() {
      renewalCount += 1;
      markRenewalStarted();
      await pendingRenewal;
    } },
    onFailure: assert.fail,
    schedule(callback) { scheduled = callback; return { unref() {} }; },
    cancel() { cancelCount += 1; }
  });

  scheduled();
  await renewalStarted;
  let stopResolved = false;
  const stopped = heartbeat.stop().then(() => { stopResolved = true; });
  await nextTurn();
  assert.equal(stopResolved, false, "Shutdown must wait while exact fence renewal remains in flight.");
  assert.equal(cancelCount, 1, "Shutdown must cancel its one armed timer exactly once.");
  releaseRenewal();
  await stopped;
  assert.equal(stopResolved, true);
  scheduled();
  await nextTurn();
  assert.equal(renewalCount, 1, "A callback retained across shutdown must not renew or rearm.");
  assert.equal(cancelCount, 1);
});

test("administration operator closes authority, heartbeat, server, and pool in order", () => {
  const source = readFileSync(new URL("./phase-12-administration-operator.mjs", import.meta.url), "utf8");
  const closeStart = source.indexOf("const close = () => closePromise");
  const unavailable = source.indexOf("operatorAvailable = false;", closeStart);
  const heartbeat = source.indexOf("await workerFenceHeartbeat?.stop();", closeStart);
  const server = source.indexOf("await server.close();", closeStart);
  const pool = source.indexOf("await pool.end();", closeStart);
  assert.ok(closeStart >= 0 && closeStart < unavailable && unavailable < heartbeat && heartbeat < server && server < pool,
    "Shutdown must reject new commands, settle renewal, stop HTTPS, then release PostgreSQL.");
});
