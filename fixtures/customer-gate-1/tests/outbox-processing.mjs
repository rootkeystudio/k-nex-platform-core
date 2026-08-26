import assert from "node:assert/strict";

import { processNextPayloadOutboxEvent, readPayloadOutboxHealth } from "@k-nex/payload-adapter";
import pg from "pg";

import { bootGate1Application } from "../dist/src/boot.js";

const connectionString = process.env.DATABASE_URL;
const bootKey = process.env.BOOT_KEY;
if (!connectionString || !bootKey) throw new Error("DATABASE_URL and BOOT_KEY are required.");

const client = new pg.Client({ connectionString });
await client.connect();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function seed(eventId, taskId, availableAt = new Date(Date.now() - 1_000), occurredAt = new Date()) {
  const occurredAtDate = new Date(occurredAt);
  await client.query(`
    INSERT INTO k_nex_outbox (
      event_id, event_type, schema_version, message_class, occurred_at,
      application_id, plugin_id, correlation_id, idempotency_key, payload,
      available_at, retention_until
    ) VALUES ($1, 'sales.task.created', 1, 'durable-workflow', $2,
      'customer-gate-1', 'module.sales', $3, $1, $4::jsonb, $5, $6)
  `, [
    eventId,
    occurredAt,
    `correlation-${eventId}`,
    JSON.stringify({ taskId, title: `Task ${taskId}` }),
    availableAt,
    new Date(occurredAtDate.getTime() + 86_400_000)
  ]);
}

async function state(eventId) {
  const result = await client.query(`
    SELECT status, attempt_count, checkpoint, last_error_code,
           claim_token, claimed_at, lease_expires_at, processed_at, dead_lettered_at
    FROM k_nex_outbox WHERE event_id = $1
  `, [eventId]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function effectCount(eventId) {
  const result = await client.query(
    "SELECT count(*)::int AS count FROM sales_event_effects WHERE event_id = $1",
    [eventId]
  );
  return result.rows[0].count;
}

const invocations = new Map();
const subscriber = async (context) => {
  assert.deepEqual(Object.keys(context).sort(), ["actor", "checkpoint", "event", "idempotencyKey", "saveCheckpoint"]);
  assert.deepEqual(context.actor, { kind: "system", id: "outbox.processor" });
  assert.equal(context.idempotencyKey, context.event.id);

  const eventId = context.event.id;
  if (eventId === "p3-3-success") assert.equal(context.event.occurredAt, "2026-08-26T12:00:00.123Z");
  const taskId = context.event.payload.taskId;
  assert.equal(typeof taskId, "string");
  const count = (invocations.get(eventId) ?? 0) + 1;
  invocations.set(eventId, count);

  if (eventId === "p3-3-poison") throw new Error("secret provider detail must not be persisted");

  await client.query(`
    INSERT INTO sales_event_effects (event_id, task_id, system_actor_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (event_id) DO NOTHING
  `, [eventId, taskId, context.actor.id]);

  if (context.checkpoint?.effectRecorded !== true) {
    await context.saveCheckpoint({ effectRecorded: true });
  }
  if (eventId === "p3-3-retry" && count === 1) throw new Error("transient secret failure");
  if (eventId === "p3-3-lease" && count === 1) await wait(80);
};

const payload = await bootGate1Application({ key: bootKey });

try {
  await client.query("DELETE FROM sales_event_effects WHERE event_id LIKE 'p3-3-%'");
  await client.query("DELETE FROM k_nex_outbox WHERE event_id LIKE 'p3-3-%'");

  await seed("p3-3-success", "task-success", new Date(Date.now() - 1_000), "2026-08-26T12:00:00.123Z");
  const success = await processNextPayloadOutboxEvent({ payload, subscriber });
  assert.deepEqual(success, { eventId: "p3-3-success", status: "delivered" });
  assert.equal((await state("p3-3-success")).attempt_count, 1);
  assert.equal(await effectCount("p3-3-success"), 1);

  await seed("p3-3-concurrent-a", "task-concurrent-a");
  await seed("p3-3-concurrent-b", "task-concurrent-b");
  const concurrent = await Promise.all([
    processNextPayloadOutboxEvent({ payload, subscriber }),
    processNextPayloadOutboxEvent({ payload, subscriber })
  ]);
  assert.deepEqual(new Set(concurrent.map(({ eventId }) => eventId)), new Set(["p3-3-concurrent-a", "p3-3-concurrent-b"]));
  assert.ok(concurrent.every(({ status }) => status === "delivered"));
  assert.equal(await effectCount("p3-3-concurrent-a"), 1);
  assert.equal(await effectCount("p3-3-concurrent-b"), 1);

  await seed("p3-3-retry", "task-retry");
  assert.equal((await processNextPayloadOutboxEvent({ payload, subscriber, backoffMs: 5 })).status, "retry-scheduled");
  const retryPending = await state("p3-3-retry");
  assert.equal(retryPending.status, "pending");
  assert.equal(retryPending.attempt_count, 1);
  assert.deepEqual(retryPending.checkpoint, { effectRecorded: true });
  await wait(20);
  assert.equal((await processNextPayloadOutboxEvent({ payload, subscriber, backoffMs: 5 })).status, "delivered");
  assert.equal((await state("p3-3-retry")).attempt_count, 2);
  assert.equal(await effectCount("p3-3-retry"), 1, "retry must not duplicate the subscriber effect");

  await seed("p3-3-lease", "task-lease");
  const staleWorker = processNextPayloadOutboxEvent({ payload, subscriber, leaseMs: 20 });
  await wait(40);
  const replacementWorker = await processNextPayloadOutboxEvent({ payload, subscriber, leaseMs: 20 });
  assert.equal(replacementWorker.status, "delivered");
  assert.equal((await staleWorker).status, "lease-lost");
  assert.equal((await state("p3-3-lease")).attempt_count, 2);
  assert.equal(await effectCount("p3-3-lease"), 1, "lease recovery must not duplicate the subscriber effect");

  await seed("p3-3-expired-fair", "task-expired-fair");
  await client.query(`
    UPDATE k_nex_outbox
    SET status = 'processing', attempt_count = 1, claimed_at = now() - interval '2 seconds',
        lease_expires_at = now() - interval '1 second', claim_token = 'abandoned-claim'
    WHERE event_id = 'p3-3-expired-fair'
  `);
  for (let index = 0; index < 3; index += 1) {
    await seed(`p3-3-arrival-${index}`, `task-arrival-${index}`, new Date(Date.now() - 100));
  }
  const fairRecovery = await processNextPayloadOutboxEvent({ payload, subscriber, leaseMs: 20 });
  assert.deepEqual(fairRecovery, { eventId: "p3-3-expired-fair", status: "delivered" });
  assert.equal((await state("p3-3-expired-fair")).attempt_count, 2);
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await state(`p3-3-arrival-${index}`)).status, "pending");
  }
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(
      await processNextPayloadOutboxEvent({ payload, subscriber }),
      { eventId: `p3-3-arrival-${index}`, status: "delivered" }
    );
  }

  await seed("p3-3-poison", "task-poison");
  for (const expected of ["retry-scheduled", "retry-scheduled", "dead-lettered"]) {
    const outcome = await processNextPayloadOutboxEvent({ payload, subscriber, backoffMs: 1, maxAttempts: 3 });
    assert.equal(outcome.status, expected);
    await wait(5);
  }
  const poison = await state("p3-3-poison");
  assert.equal(poison.status, "dead-letter");
  assert.equal(poison.attempt_count, 3);
  assert.equal(poison.last_error_code, "DELIVERY_FAILED");
  assert.equal(poison.claim_token, null);
  assert.equal(poison.claimed_at, null);
  assert.equal(poison.lease_expires_at, null);
  assert.ok(poison.dead_lettered_at);
  assert.equal(await effectCount("p3-3-poison"), 0);
  const leaked = await client.query(
    "SELECT count(*)::int AS count FROM k_nex_outbox WHERE last_error_code LIKE '%secret%'"
  );
  assert.equal(leaked.rows[0].count, 0);

  await seed("p3-3-reduced-attempts", "task-reduced-attempts");
  await client.query("UPDATE k_nex_outbox SET attempt_count = 5 WHERE event_id = 'p3-3-reduced-attempts'");
  assert.deepEqual(
    await processNextPayloadOutboxEvent({ payload, subscriber, maxAttempts: 3 }),
    { eventId: "p3-3-reduced-attempts", status: "dead-lettered" }
  );
  assert.equal((await state("p3-3-reduced-attempts")).status, "dead-letter");

  await seed("p3-3-future", "task-future", new Date(Date.now() + 60_000));
  const health = await readPayloadOutboxHealth(payload);
  assert.deepEqual(health, {
    pending: 1,
    processing: 0,
    delivered: 9,
    deadLetter: 2,
    expiredLeases: 0,
    oldestPendingAt: health.oldestPendingAt
  });
  assert.ok(health.oldestPendingAt);

  process.stdout.write("P3_3_OUTBOX_PROCESSING_PASS\nP3_9_DUPLICATE_OUTBOX_PASS\n");
} finally {
  await client.end();
  void payload.destroy();
}

process.exit(0);
