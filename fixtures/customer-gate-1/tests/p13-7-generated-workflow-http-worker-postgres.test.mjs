import assert from "node:assert/strict";
import test from "node:test";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const applicationId = "p13-crm-browser";
const environment = "test";

async function login(origin, email, password) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "generated authentication did not issue a session cookie");
  return cookie;
}

async function routeAction(origin, cookie, actionId, body) {
  const response = await fetch(`${origin}/api/k-nex/sales/actions/${encodeURIComponent(actionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin, referer: `${origin}/sales/calendar` },
    body: JSON.stringify(body)
  });
  const value = await response.json();
  assert.equal(response.status, 200, `${JSON.stringify(value)} input=${JSON.stringify(body)}`);
  return value;
}

async function until(check, message, diagnostics) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${message}\n${diagnostics()}`);
}

test("P13.7 generated HTTP action and restarted worker preserve one durable workflow effect", { timeout: 420_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, startWorker, stopWorker, workerOutput }) => {
    const cookie = await login(origin, personas.owner.email, personas.owner.password);
    await stopWorker();

    const request = {
      routeId: "sales.route.account-detail",
      nodeId: "sales-page-account-detail-main-action-3",
      input: { relatedRecordType: "sales.account", relatedRecordId: records.accountId, type: "call", subject: "P13.7 generated workflow reminder", scheduledAt: "2026-09-12T10:00:00.000Z" },
      selection: {},
      idempotencyKey: "p137-generated-scheduled-activity"
    };
    const accepted = await routeAction(origin, cookie, "sales.activity.create", request);
    const replay = await routeAction(origin, cookie, "sales.activity.create", request);
    assert.deepEqual(replay, accepted, "authenticated action replay returns its one accepted result");
    const activityId = accepted.data?.id;
    assert.equal(typeof activityId, "string");

    const trigger = (await pool.query(
      "select event_id,payload from k_nex_outbox where application_id=$1 and payload->>'environment'=$2 and event_type='sales.event.workflow.activity-scheduled'",
      [applicationId, environment]
    )).rows;
    assert.equal(trigger.length, 1, "accepted scheduled Activity creates exactly one dedicated durable trigger in its transaction");
    assert.deepEqual(Object.keys(trigger[0].payload).sort(), ["acceptedAt", "acceptedOwnerId", "acceptedRevision", "applicationId", "authRevision", "effectKind", "environment", "lifecycleRevision", "originalActorId", "recipientId", "scheduledAt", "scopeRevision", "targetId", "workflowId", "workflowVersion"].sort());
    assert.equal(trigger[0].payload.workflowId, "sales.workflow.scheduled-activity-reminder");
    assert.equal(trigger[0].payload.effectKind, "schedule-reminder");
    assert.equal(trigger[0].payload.targetId, activityId);

    await startWorker();
    await until(async () => (await pool.query(
      "select state from sales_workflow_executions where application_id=$1 and environment=$2 and source_event_id=$3",
      [applicationId, environment, trigger[0].event_id]
    )).rows[0]?.state === "succeeded", "generated worker did not consume the dedicated workflow trigger", workerOutput);
    await stopWorker();

    const beforeRestart = await pool.query(`select
      (select count(*)::int from sales_workflow_executions where application_id=$1 and environment=$2 and source_event_id=$3) executions,
      (select count(*)::int from sales_workflow_effect_receipts where application_id=$1 and environment=$2 and target_record_id=$4) receipts,
      (select count(*)::int from sales_reminders where application_id=$1 and environment=$2 and reference_kind='activity' and reference_id=$4) reminders`,
      [applicationId, environment, trigger[0].event_id, activityId]
    );
    assert.deepEqual(beforeRestart.rows, [{ executions: 1, receipts: 1, reminders: 1 }]);

    await startWorker();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await stopWorker();
    const afterRestart = await pool.query(`select
      (select count(*)::int from sales_workflow_executions where application_id=$1 and environment=$2 and source_event_id=$3) executions,
      (select count(*)::int from sales_workflow_effect_receipts where application_id=$1 and environment=$2 and target_record_id=$4) receipts,
      (select count(*)::int from sales_reminders where application_id=$1 and environment=$2 and reference_kind='activity' and reference_id=$4) reminders`,
      [applicationId, environment, trigger[0].event_id, activityId]
    );
    assert.deepEqual(afterRestart.rows, beforeRestart.rows, "worker restart/replay preserves one logical workflow effect");

    const unrelated = await routeAction(origin, cookie, "sales.account.create", {
      routeId: "sales.route.accounts",
      nodeId: "sales-page-accounts-main",
      input: { name: "P13.7 unrelated generated account" },
      selection: {},
      idempotencyKey: "p137-generated-unrelated-account"
    });
    assert.equal(typeof unrelated.data?.id, "string", "unrelated generated customer action remains healthy");
    assert.equal(Number((await pool.query("select count(*)::int count from k_nex_outbox where application_id=$1 and payload->>'environment'=$2 and event_type='sales.event.workflow.activity-scheduled'", [applicationId, environment])).rows[0].count), 1);
  });
});
