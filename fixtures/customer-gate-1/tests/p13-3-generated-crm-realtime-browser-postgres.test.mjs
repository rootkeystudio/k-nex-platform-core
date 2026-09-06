import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { chromium } from "playwright";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function login(browser, origin, persona) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function eventually(check, message, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let failure;
  while (Date.now() < deadline) {
    try { if (await check()) return; }
    catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw failure ?? new Error(message);
}

async function directAccountUpdate(page, id, expectedRevision, name, key) {
  return page.evaluate(async ({ expectedRevision: revision, id: recordId, key: idempotencyKey, nextName }) => {
    const response = await fetch("/api/k-nex/sales/actions/sales.account.update", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { id: recordId, expectedRevision: revision, name: nextName }, idempotencyKey })
    });
    return { status: response.status, body: await response.text() };
  }, { id, expectedRevision, nextName: name, key });
}

function opaqueNotification(applicationId, environment, correlation, dedupe) {
  return JSON.stringify({ applicationId, environment, type: "realtime", invalidation: {
    topic: "sales.realtime.accounts", source: "sales.accounts", event: "sales.event.account-changed", correlation, dedupe
  } });
}

function realtimeTelemetry(page) {
  const state = { sockets: 0, subscriptions: 0, authorizedTopics: new Map(), projections: 0, projectionResponses: [], eventTimes: new Map(), frames: [], malformedFrames: [], invalidations: new Map(), duplicateDedupe: [] };
  const projectionStarts = new WeakMap();
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/socket.io/")) return;
    const subscriptionAcks = new Map();
    state.sockets += 1;
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      const opening = frame.indexOf("[");
      const packet = opening < 0 ? undefined : /^42([0-9]+)$/u.exec(frame.slice(0, opening));
      if (packet === null || packet === undefined) return;
      let envelope;
      try { envelope = JSON.parse(frame.slice(opening)); } catch { return; }
      const request = Array.isArray(envelope) ? envelope[1] : undefined;
      if (envelope?.[0] !== "k-nex:subscribe" || !request || typeof request !== "object" || Array.isArray(request) || typeof request.topicId !== "string") return;
      state.subscriptions += 1;
      subscriptionAcks.set(packet[1], request.topicId);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = String(payload);
      state.frames.push(frame);
      if (frame.startsWith("43")) {
        const opening = frame.indexOf("[");
        const packet = opening < 0 ? undefined : /^43([0-9]+)$/u.exec(frame.slice(0, opening));
        if (packet === null || packet === undefined) return;
        const topicId = subscriptionAcks.get(packet[1]);
        if (topicId === undefined) return;
        subscriptionAcks.delete(packet[1]);
        let acknowledgement;
        try { acknowledgement = JSON.parse(frame.slice(opening)); } catch { return; }
        if (Array.isArray(acknowledgement) && acknowledgement.length === 1 && acknowledgement[0]?.ok === true && Object.keys(acknowledgement[0]).join("\0") === "ok") {
          state.authorizedTopics.set(topicId, (state.authorizedTopics.get(topicId) ?? 0) + 1);
        }
        return;
      }
      if (!frame.startsWith("42")) return;
      const malformed = (error) => {
        if (state.malformedFrames.length < 16) state.malformedFrames.push({ frame: frame.slice(0, 2_048), error });
      };
      const opening = frame.indexOf("[");
      if (opening < 0 || !/^42[0-9]*$/u.test(frame.slice(0, opening))) { malformed("Invalid Socket.IO event packet prefix."); return; }
      let envelope;
      try { envelope = JSON.parse(frame.slice(opening)); }
      catch (error) { malformed(error instanceof Error ? error.message : String(error)); return; }
      if (!Array.isArray(envelope) || typeof envelope[0] !== "string") { malformed("Invalid Socket.IO event envelope."); return; }
      if (envelope[0] !== "k-nex:event") return;
      try {
        assert.equal(envelope.length, 2, "Socket.IO event envelope gained ambient fields.");
        const message = envelope[1];
        assert.ok(message && typeof message === "object" && !Array.isArray(message));
        assert.deepEqual(Object.keys(message).sort(), ["correlationId", "event", "messageClass", "topicId"]);
        assert.equal(message.topicId, "sales.realtime.accounts");
        assert.equal(message.messageClass, "reconstructible-invalidation");
        assert.equal(typeof message.correlationId, "string");
        const invalidation = message.event;
        assert.ok(invalidation && typeof invalidation === "object" && !Array.isArray(invalidation));
        assert.deepEqual(Object.keys(invalidation).sort(), ["correlation", "dedupe", "event", "source", "topic"]);
        assert.equal(invalidation.topic, "sales.realtime.accounts");
        assert.equal(invalidation.source, "sales.accounts");
        assert.equal(invalidation.event, "sales.event.account-changed");
        assert.equal(invalidation.correlation, message.correlationId);
        assert.equal(typeof invalidation.dedupe, "string");
        if (state.invalidations.has(invalidation.dedupe)) state.duplicateDedupe.push(invalidation.dedupe);
        else state.invalidations.set(invalidation.dedupe, invalidation);
        state.eventTimes.set(invalidation.dedupe, performance.now());
      } catch (error) {
        malformed(error instanceof Error ? error.message : String(error));
      }
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/k-nex/sales/routes/sales.route.account-detail") projectionStarts.set(request, performance.now());
  });
  page.on("requestfinished", async (request) => {
    const startedAt = projectionStarts.get(request);
    if (startedAt === undefined) return;
    const response = await request.response().catch(() => null);
    if (!response?.ok()) return;
    const completedAt = performance.now();
    state.projections += 1;
    state.projectionResponses.push({ startedAt, completedAt });
  });
  return state;
}

function completedProjectionAfter(state, baseline, eventAt) {
  return state.projectionResponses.slice(baseline).some(({ startedAt, completedAt }) => startedAt >= eventAt && completedAt >= startedAt);
}

function assertTelemetryClean(state, checkpoint) {
  assert.deepEqual(state.malformedFrames, [], `${checkpoint} observed malformed k-nex:event frames: ${JSON.stringify(state.malformedFrames)}`);
}

function authorizedAccountSubscriptions(state) {
  return state.authorizedTopics.get("sales.realtime.accounts") ?? 0;
}

async function revokeScope(page, input) {
  return page.evaluate(async (body) => {
    const response = await fetch("/api/k-nex/sales/authority-scopes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.text() };
  }, input);
}

test("P13.3 generated browser receives opaque Socket.IO invalidations, resyncs after a host loss, and drops revoked current authority", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, startWeb, stopWeb, startWorker, stopWorker, workerOutput }) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const owner = await login(browser, origin, personas.owner);
      const ownerRealtime = realtimeTelemetry(owner.page);
      await owner.page.goto(`${origin}/sales/accounts/${records.accountId}`);
      await owner.page.getByRole("heading", { name: "Account detail", exact: true }).waitFor();
      await eventually(() => authorizedAccountSubscriptions(ownerRealtime) > 0, "Generated browser never received a successful account-topic subscription acknowledgement.", 10_000);
      const readinessBarrier = "p13-realtime-readiness-barrier";
      const projectionsBeforeReadinessBarrier = ownerRealtime.projections;
      await pool.query("select pg_notify($1,$2)", ["k_nex_runtime_invalidation", opaqueNotification("p13-crm-browser", "test", readinessBarrier, readinessBarrier)]);
      await eventually(() => ownerRealtime.invalidations.has(readinessBarrier), "Realtime readiness barrier did not reach the subscribed browser.", 3_000);
      const readinessEventAt = ownerRealtime.eventTimes.get(readinessBarrier);
      await eventually(() => completedProjectionAfter(ownerRealtime, projectionsBeforeReadinessBarrier, readinessEventAt), "Realtime readiness barrier did not complete its authoritative projection.", 3_000);
      assertTelemetryClean(ownerRealtime, "readiness barrier");
      const firstKey = "p13-realtime-socket-update-001";
      const projectionsBeforeAction = ownerRealtime.projections;
      const first = await directAccountUpdate(owner.page, records.accountId, 1, "Realtime socket update", firstKey);
      assert.equal(first.status, 200, first.body);
      const firstEventId = (await pool.query("select audit->-1->>'idempotencyKey' event_id from sales_accounts where id=$1", [records.accountId])).rows[0]?.event_id;
      assert.match(firstEventId, /^sales-action-[0-9a-f]{64}$/u);
      assert.notEqual(firstEventId, firstKey);
      assert.deepEqual((await pool.query("select event_id,idempotency_key,payload->>'idempotencyKey' payload_event_id from k_nex_outbox where event_id=$1", [firstEventId])).rows,
        [{ event_id: firstEventId, idempotency_key: firstEventId, payload_event_id: firstEventId }]);
      try { await eventually(() => ownerRealtime.invalidations.has(firstEventId), "Committed account action did not reach the browser Socket.IO topic.", 800); }
      catch (error) {
        const outbox = await pool.query("select event_type,status,last_error_code from k_nex_outbox order by id desc limit 5");
        throw new Error(`${error}\nworker=${workerOutput()}\noutbox=${JSON.stringify(outbox.rows)}\nframes=${JSON.stringify(ownerRealtime.frames.slice(-8))}`);
      }
      assertTelemetryClean(ownerRealtime, "initial delivery");
      const firstEventAt = ownerRealtime.eventTimes.get(firstEventId);
      await eventually(() => completedProjectionAfter(ownerRealtime, projectionsBeforeAction, firstEventAt), "Socket.IO invalidation did not trigger an authoritative account projection refetch.", 3_000);
      await owner.page.getByText("Realtime socket update", { exact: true }).waitFor({ timeout: 2_000 });
      const firstProjection = ownerRealtime.projectionResponses.slice(projectionsBeforeAction).find(({ startedAt, completedAt }) => startedAt >= firstEventAt && completedAt >= startedAt);
      assert.ok(firstProjection);
      assert.ok(firstProjection.completedAt - firstEventAt < 3_000, "Account projection was not refetched before the polling fallback.");

      const recoveryKey = "p13-realtime-worker-recovery-001";
      await stopWorker();
      const recovery = await directAccountUpdate(owner.page, records.accountId, 2, "Realtime worker recovery", recoveryKey);
      assert.equal(recovery.status, 200, recovery.body);
      const recoveryCommit = (await pool.query("select name,revision,audit->-1->>'idempotencyKey' event_id,(select count(*)::int from sales_action_idempotency where action_id='sales.account.update' and idempotency_key=$2) idempotency_count from sales_accounts where id=$1", [records.accountId, recoveryKey])).rows[0];
      assert.equal(recoveryCommit.name, "Realtime worker recovery");
      assert.equal(recoveryCommit.revision, 3);
      assert.equal(recoveryCommit.idempotency_count, 1);
      const recoveryEventId = recoveryCommit.event_id;
      assert.match(recoveryEventId, /^sales-action-[0-9a-f]{64}$/u);
      assert.notEqual(recoveryEventId, recoveryKey);
      assert.deepEqual((await pool.query("select event_id,idempotency_key,status,attempt_count,payload->>'actionId' action_id,payload->>'idempotencyKey' payload_event_id from k_nex_outbox where event_id=$1", [recoveryEventId])).rows,
        [{ event_id: recoveryEventId, idempotency_key: recoveryEventId, status: "pending", attempt_count: 0, action_id: "sales.account.update", payload_event_id: recoveryEventId }]);
      const socketsBeforeLoss = ownerRealtime.sockets;
      const accountSubscriptionsBeforeLoss = authorizedAccountSubscriptions(ownerRealtime);
      await stopWeb();
      await startWeb();
      await eventually(() => ownerRealtime.sockets > socketsBeforeLoss && authorizedAccountSubscriptions(ownerRealtime) > accountSubscriptionsBeforeLoss, "Browser Socket.IO client did not reconnect and receive a successful account-topic subscription acknowledgement after host loss.", 15_000);
      await owner.page.getByText("Realtime worker recovery", { exact: true }).waitFor({ timeout: 6_000 });
      const projectionsBeforeRecoveryDelivery = ownerRealtime.projections;
      assert.equal(ownerRealtime.invalidations.has(recoveryEventId), false, "Durable recovery marker arrived before the worker restarted.");
      await startWorker();
      await eventually(() => ownerRealtime.invalidations.has(recoveryEventId), "Restarted worker did not deliver the durable account invalidation.", 10_000);
      assert.equal(ownerRealtime.duplicateDedupe.includes(recoveryEventId), false, "Recovered event was delivered more than once.");
      assertTelemetryClean(ownerRealtime, "recovery delivery");
      const recoveryEventAt = ownerRealtime.eventTimes.get(recoveryEventId);
      await eventually(() => completedProjectionAfter(ownerRealtime, projectionsBeforeRecoveryDelivery, recoveryEventAt), "Recovered invalidation did not trigger an authoritative projection.", 3_000);
      await eventually(async () => (await pool.query("select status from k_nex_outbox where event_id=$1", [recoveryEventId])).rows[0]?.status === "delivered", "Recovered outbox event was not durably delivered.", 5_000);
      const replay = await directAccountUpdate(owner.page, records.accountId, 2, "Realtime worker recovery", recoveryKey);
      assert.equal(replay.status, 200, replay.body);
      assert.deepEqual(JSON.parse(replay.body), JSON.parse(recovery.body), "Idempotency replay changed the committed action result.");
      assert.deepEqual((await pool.query("select revision,(select count(*)::int from jsonb_array_elements(audit) entry where entry->>'idempotencyKey'=$2) audit_count,(select count(*)::int from k_nex_outbox where event_id=$2) outbox_count,(select count(*)::int from sales_action_idempotency where action_id='sales.account.update' and idempotency_key=$3) idempotency_count from sales_accounts where id=$1", [records.accountId, recoveryEventId, recoveryKey])).rows,
        [{ revision: 3, audit_count: 1, outbox_count: 1, idempotency_count: 1 }]);

      const foreignApplication = "p13-realtime-foreign-app";
      const foreignEnvironment = "p13-realtime-foreign-env";
      const barrier = "p13-realtime-local-barrier";
      await pool.query("select pg_notify($1,$2)", ["k_nex_runtime_invalidation", opaqueNotification("foreign-app", "test", foreignApplication, foreignApplication)]);
      await pool.query("select pg_notify($1,$2)", ["k_nex_runtime_invalidation", opaqueNotification("p13-crm-browser", "staging", foreignEnvironment, foreignEnvironment)]);
      await pool.query("select pg_notify($1,$2)", ["k_nex_runtime_invalidation", opaqueNotification("p13-crm-browser", "test", barrier, barrier)]);
      await eventually(() => ownerRealtime.invalidations.has(barrier), "Authorized socket did not receive the exact local barrier.", 5_000);
      assertTelemetryClean(ownerRealtime, "foreign/local barrier");
      assert.equal(ownerRealtime.duplicateDedupe.includes(recoveryEventId), false, "Later traffic duplicated the recovered durable event.");
      assert.equal(ownerRealtime.invalidations.has(foreignApplication), false, "Foreign application notification reached the socket.");
      assert.equal(ownerRealtime.invalidations.has(foreignEnvironment), false, "Foreign environment notification reached the socket.");

      const viewer = await login(browser, origin, personas.viewer);
      const viewerRealtime = realtimeTelemetry(viewer.page);
      await viewer.page.goto(`${origin}/sales/accounts/${records.accountId}`);
      await viewer.page.getByRole("heading", { name: "Account detail", exact: true }).waitFor();
      await eventually(() => authorizedAccountSubscriptions(viewerRealtime) > 0, "Application-wide viewer did not receive a successful account-topic subscription acknowledgement.", 10_000);
      const authority = (await pool.query("select s.principal_id,s.revision scope_revision,a.authorization_revision,a.lifecycle_revision from sales_current_authority_scopes s join k_nex_authorization_state a on a.application_id=s.application_id where s.application_id=$1 and s.environment=$2 and s.principal_id=(select owner_id from sales_accounts where id=$3)", ["p13-crm-browser", "test", records.accountId])).rows[0];
      assert.ok(authority);
      const revocation = await revokeScope(owner.page, { operation: "revoke", principalId: authority.principal_id, expectedAuthorizationRevision: authority.authorization_revision, expectedLifecycleRevision: authority.lifecycle_revision, expectedScopeRevision: authority.scope_revision, idempotencyKey: "p13-realtime-owner-revoke-001" });
      assert.equal(revocation.status, 200, revocation.body);
      const revocationBody = JSON.parse(revocation.body);
      assert.deepEqual(revocationBody, { authorizationRevision: authority.authorization_revision + 1, lifecycleRevision: authority.lifecycle_revision, scopeRevision: authority.scope_revision + 1, state: "revoked" });
      assert.deepEqual((await pool.query("select s.state,s.revision scope_revision,a.authorization_revision,a.lifecycle_revision,(select count(*)::int from sales_scope_administration_operations where principal_id=$3 and idempotency_key='p13-realtime-owner-revoke-001') operation_count from sales_current_authority_scopes s join k_nex_authorization_state a on a.application_id=s.application_id where s.application_id=$1 and s.environment=$2 and s.principal_id=$3", ["p13-crm-browser", "test", authority.principal_id])).rows,
        [{ state: "revoked", scope_revision: authority.scope_revision + 1, authorization_revision: authority.authorization_revision + 1, lifecycle_revision: authority.lifecycle_revision, operation_count: 1 }]);
      await owner.page.waitForTimeout(36_000);
      const postRevalidation = "p13-realtime-post-revalidation-control";
      await pool.query("select pg_notify($1,$2)", ["k_nex_runtime_invalidation", opaqueNotification("p13-crm-browser", "test", postRevalidation, postRevalidation)]);
      await eventually(() => viewerRealtime.invalidations.has(postRevalidation), "Application-wide viewer missed the exact post-revalidation control marker.", 5_000);
      await owner.page.waitForTimeout(500);
      assertTelemetryClean(ownerRealtime, "revoked owner control");
      assertTelemetryClean(viewerRealtime, "application-wide viewer control");
      assert.equal(ownerRealtime.invalidations.has(postRevalidation), false, "Revoked owner received the post-revalidation control marker.");
      await owner.page.locator('section[role="alert"][data-k-nex-sales-route="unavailable"]').filter({ hasText: /^Sales route unavailable$/u }).waitFor({ timeout: 3_000 });
      await viewer.context.close();
      await owner.context.close();
    } finally {
      await browser.close();
    }
  });
});
