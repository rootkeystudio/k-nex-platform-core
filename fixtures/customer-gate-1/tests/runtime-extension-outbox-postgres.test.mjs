import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresRuntimeExtensionOutboxDispatcher } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const digest = (character) => `sha256:${character.repeat(64)}`;

function event(eventId, inventoryRevision) {
  return {
    schemaVersion: 1,
    applicationId: "customer-alpha",
    environment: "production",
    eventId,
    eventType: "extension.lifecycle-transition",
    operationId: `operation-${eventId}`,
    operation: "install",
    operationPhase: "completed",
    lifecycleState: "active",
    expectedRevision: 0,
    revision: inventoryRevision,
    inventoryRevision,
    actor: { kind: "trusted-automation", identity: "runtime-outbox-test" },
    receiptId: `receipt-${eventId}`,
    auditId: `audit-${eventId}`,
    idempotencyKey: `idempotency-${eventId}`,
    correlationId: `correlation-${eventId}`,
    occurredAt: "2026-08-31T00:00:00.000Z",
    deliveryClass: "hot-application",
    id: "app.sales-outbox",
    evidence: {
      sourceCommit: "a".repeat(40), artifactDigest: digest("a"), generationId: `generation-${eventId}`,
      manifestDigest: digest("b"), catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e")
    }
  };
}

async function insert(pool, eventId, inventoryRevision) {
  const body = event(eventId, inventoryRevision);
  await pool.query(
    `insert into runtime_extension_outbox
     (event_id, application_id, environment, delivery_class, extension_id, revision, inventory_revision, event_json)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [eventId, body.applicationId, body.environment, body.deliveryClass, body.id, body.revision, body.inventoryRevision, JSON.stringify(body)]
  );
}

async function waitForStatus(pool, eventId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = (await pool.query("select status from runtime_extension_outbox where event_id=$1", [eventId])).rows[0];
    if (row?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Outbox event ${eventId} did not enter ${status}.`);
}

test("leases runtime invalidations outside transactions, reclaims crashes, and bounds poison delivery", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_extension_outbox").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const options = { leaseMs: 100, maxAttempts: 2, publishTimeoutMs: 40 };
  try {
    await pool.query(`
      create table runtime_extension_outbox (
        event_id varchar(128) primary key not null,
        application_id varchar(128) not null,
        environment varchar(64) not null,
        delivery_class varchar(32) not null,
        extension_id varchar(128) not null,
        revision integer not null,
        inventory_revision integer not null unique,
        event_json jsonb not null,
        status varchar(32) default 'pending' not null,
        attempt_count integer default 0 not null,
        claimed_at timestamptz,
        lease_expires_at timestamptz,
        claim_token varchar(64),
        last_error_code varchar(64),
        dead_lettered_at timestamptz,
        created_at timestamptz default now() not null
      )
    `);

    await Promise.all([insert(pool, "event-001", 1), insert(pool, "event-002", 2)]);
    const delivered = [];
    const concurrent = await Promise.all([
      new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async (message) => { delivered.push(message.inventoryRevision); } }),
      new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async (message) => { delivered.push(message.inventoryRevision); } })
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), ["delivered", "delivered"]);
    assert.deepEqual(delivered.sort(), [1, 2], "concurrent dispatchers must own distinct claims");

    await insert(pool, "event-003", 3);
    await pool.query(
      "update runtime_extension_outbox set status='processing', attempt_count=1, claim_token='crashed-worker', lease_expires_at=now()-interval '1 second' where event_id='event-003'"
    );
    assert.equal((await new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async () => {} })).status, "delivered");
    assert.deepEqual((await pool.query("select status, attempt_count from runtime_extension_outbox where event_id='event-003'")).rows, [{ status: "delivered", attempt_count: 2 }]);

    await insert(pool, "event-004", 4);
    const hung = new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async () => new Promise(() => {}) });
    await waitForStatus(pool, "event-004", "processing");
    await insert(pool, "event-005", 5);
    await assert.rejects(hung, /timed out/i);
    assert.equal((await new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async () => {} })).eventId, "event-005", "a failed publish must not retain a database lock or block later work");
    assert.equal((await new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async () => {} })).eventId, "event-004");

    await insert(pool, "event-006", 6);
    const poison = new PostgresRuntimeExtensionOutboxDispatcher(pool, options);
    await assert.rejects(poison.dispatchNext({ publish: async () => { throw new Error("poison"); } }), /poison/i);
    await insert(pool, "event-007", 7);
    assert.equal((await poison.dispatchNext({ publish: async () => {} })).eventId, "event-007", "a retrying poison message must not monopolize the queue");
    await assert.rejects(poison.dispatchNext({ publish: async () => { throw new Error("poison"); } }), /poison/i);
    assert.deepEqual((await pool.query("select status, attempt_count, last_error_code from runtime_extension_outbox where event_id='event-006'")).rows, [{ status: "dead-letter", attempt_count: 2, last_error_code: "DELIVERY_FAILED" }]);

    await insert(pool, "event-008", 8);
    await pool.query(
      "update runtime_extension_outbox set status='processing', attempt_count=1, claim_token='lost-after-publish', lease_expires_at=now()-interval '1 second' where event_id='event-008'"
    );
    let deliveries = 1; // The first external publication happened before the worker crashed without an acknowledgement.
    assert.equal((await new PostgresRuntimeExtensionOutboxDispatcher(pool, options).dispatchNext({ publish: async () => { deliveries += 1; } })).status, "delivered");
    assert.equal(deliveries, 2, "recovery deliberately permits duplicate delivery after publish-before-ack crash");
  } finally {
    await pool.end();
    await container.stop();
  }
});
