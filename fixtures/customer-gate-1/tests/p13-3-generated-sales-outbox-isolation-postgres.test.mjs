import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function until(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

function durableRow({ eventId, applicationId, environment, pluginId, eventType, resourceId }) {
  return [
    eventId, eventType, 1, "durable-workflow", new Date(), applicationId, pluginId,
    `correlation-${eventId}`, eventId, JSON.stringify({ actionId: "sales.account.update", environment, resourceId }),
    new Date(Date.now() + 86_400_000)
  ];
}

test("P13.3 generated Sales worker claims only its closed application/plugin/event partition", { timeout: 240_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ pool, connectionString, records, startWorker, stopWorker }) => {
    const identity = { applicationId: "p13-crm-browser", environment: "test" };
    const salesEventId = "p13-sales-owned-outbox-event";
    const foreignApplicationId = "foreign-worker-app";
    const foreignPluginEventId = "p13-foreign-plugin-outbox-event";
    const foreignTypeEventId = "p13-foreign-type-outbox-event";
    const foreignEnvironmentEventId = "p13-foreign-environment-outbox-event";
    const listener = new pg.Client({ connectionString });
    const notifications = [];

    await stopWorker();
    try {
      await pool.query("delete from k_nex_outbox where event_id = any($1::text[])", [[salesEventId, foreignPluginEventId, foreignTypeEventId, foreignEnvironmentEventId]]);
      await pool.query(
        `insert into k_nex_outbox (event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,correlation_id,idempotency_key,payload,available_at,retention_until)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),$11),($12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,now(),$22),($23,$24,$25,$26,$27,$28,$29,$30,$31,$32::jsonb,now(),$33),($34,$35,$36,$37,$38,$39,$40,$41,$42,$43::jsonb,now(),$44)`,
        [
          ...durableRow({ eventId: salesEventId, applicationId: identity.applicationId, environment: identity.environment, pluginId: "module.sales", eventType: "sales.event.account-changed", resourceId: records.accountId }),
          ...durableRow({ eventId: foreignPluginEventId, applicationId: identity.applicationId, environment: identity.environment, pluginId: "module.other", eventType: "sales.event.account-changed", resourceId: records.accountId }),
          ...durableRow({ eventId: foreignTypeEventId, applicationId: foreignApplicationId, environment: identity.environment, pluginId: "module.sales", eventType: "sales.event.account-changed", resourceId: records.accountId }),
          ...durableRow({ eventId: foreignEnvironmentEventId, applicationId: identity.applicationId, environment: "staging", pluginId: "module.sales", eventType: "sales.event.account-changed", resourceId: records.accountId })
        ]
      );
      const unknownTypeEventId = "p13-unknown-sales-type-outbox-event";
      await pool.query(
        `insert into k_nex_outbox (event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,correlation_id,idempotency_key,payload,available_at,retention_until)
         values ($1,$2,1,'durable-workflow',now(),$3,'module.sales',$4,$1,$5::jsonb,now(),now()+interval '1 day')`,
        [unknownTypeEventId, "sales.event.unowned-changed", identity.applicationId, `correlation-${unknownTypeEventId}`, JSON.stringify({ environment: identity.environment, resourceId: records.accountId })]
      );

      await listener.connect();
      listener.on("notification", (notification) => {
        if (notification.channel === "k_nex_runtime_invalidation" && notification.payload) notifications.push(JSON.parse(notification.payload));
      });
      await listener.query("listen k_nex_runtime_invalidation");
      await startWorker();

      await until(async () => (await pool.query("select status from k_nex_outbox where event_id=$1", [salesEventId])).rows[0]?.status === "delivered", "Generated Sales worker did not deliver its owned event.");
      await until(() => notifications.some((message) => message?.type === "realtime" && message?.invalidation?.dedupe === salesEventId), "Delivered Sales event produced no opaque realtime invalidation.");
      const sales = (await pool.query("select status,attempt_count from k_nex_outbox where event_id=$1", [salesEventId])).rows[0];
      assert.deepEqual(sales, { status: "delivered", attempt_count: 1 });
      const foreign = await pool.query(
        "select event_id,status,attempt_count,claim_token,claimed_at,lease_expires_at,processed_at,last_error_code from k_nex_outbox where event_id = any($1::text[]) order by event_id",
        [[foreignPluginEventId, foreignTypeEventId, foreignEnvironmentEventId, unknownTypeEventId]]
      );
      assert.deepEqual(foreign.rows, [
        { event_id: foreignPluginEventId, status: "pending", attempt_count: 0, claim_token: null, claimed_at: null, lease_expires_at: null, processed_at: null, last_error_code: null },
        { event_id: foreignEnvironmentEventId, status: "pending", attempt_count: 0, claim_token: null, claimed_at: null, lease_expires_at: null, processed_at: null, last_error_code: null },
        { event_id: foreignTypeEventId, status: "pending", attempt_count: 0, claim_token: null, claimed_at: null, lease_expires_at: null, processed_at: null, last_error_code: null },
        { event_id: unknownTypeEventId, status: "pending", attempt_count: 0, claim_token: null, claimed_at: null, lease_expires_at: null, processed_at: null, last_error_code: null }
      ].sort((left, right) => left.event_id.localeCompare(right.event_id)));
    } finally {
      await listener.query("unlisten k_nex_runtime_invalidation").catch(() => undefined);
      await listener.end().catch(() => undefined);
    }
  });
});
