import assert from "node:assert/strict";
import { writeSync } from "node:fs";
import http from "node:http";
import https from "node:https";

import pg from "pg";
import { createPayloadRequest } from "payload";
import { writeTransactionalOutboxEvent } from "@k-nex/payload-adapter";

import { bootGate1Application } from "../dist/src/boot.js";

const mode = process.env.MODE;
const bootKey = process.env.BOOT_KEY;
const password = "gate3-2-transaction-password";
const cases = {
  commit: {
    actorEmail: "p3-2-commit-actor@example.test",
    title: "P3.2 committed sales task",
    eventId: "p3-2-event-commit",
    correlationId: "p3-2-correlation-commit"
  },
  rollback: {
    actorEmail: "p3-2-rollback-actor@example.test",
    title: "P3.2 rolled back sales task",
    eventId: "p3-2-event-rollback",
    correlationId: "p3-2-correlation-rollback"
  },
  crash: {
    actorEmail: "p3-2-crash-actor@example.test",
    title: "P3.2 crash-survivor sales task",
    eventId: "p3-2-event-crash",
    correlationId: "p3-2-correlation-crash"
  }
};
const selectedCase = cases[mode];
const CRASH_EXIT_CODE = 73;

if (!selectedCase || !bootKey) throw new Error("MODE and BOOT_KEY are required.");

async function query(connectionString, text, values = []) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

function instrumentPublicationPaths() {
  const calls = [];
  let transactionActive = false;
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;

  globalThis.fetch = (...args) => {
    if (transactionActive) calls.push("fetch");
    return originalFetch(...args);
  };
  http.request = function instrumentedHttpRequest(...args) {
    if (transactionActive) calls.push("http.request");
    return originalHttpRequest.apply(this, args);
  };
  http.get = function instrumentedHttpGet(...args) {
    if (transactionActive) calls.push("http.get");
    return originalHttpGet.apply(this, args);
  };
  https.request = function instrumentedHttpsRequest(...args) {
    if (transactionActive) calls.push("https.request");
    return originalHttpsRequest.apply(this, args);
  };
  https.get = function instrumentedHttpsGet(...args) {
    if (transactionActive) calls.push("https.get");
    return originalHttpsGet.apply(this, args);
  };

  return {
    start() {
      transactionActive = true;
    },
    stop() {
      transactionActive = false;
    },
    assertSilent() {
      assert.deepEqual(calls, [], "no HTTP/fetch publication path may run in a database transaction");
    }
  };
}

async function visibleState(connectionString) {
  const result = await query(connectionString, `
    select
      (select count(*)::int from sales_tasks where title = $1) as task_count,
      (select count(*)::int from k_nex_outbox where event_id = $2) as outbox_count,
      (select count(*)::int from k_nex_outbox where event_id = $2 and status = 'pending') as pending_count
  `, [selectedCase.title, selectedCase.eventId]);
  return result.rows[0];
}

const payload = await bootGate1Application({ key: bootKey });
const publication = instrumentPublicationPaths();

try {
  const actor = await payload.create({
    collection: "users",
    data: { email: selectedCase.actorEmail, password }
  });
  const login = await payload.login({
    collection: "users",
    data: { email: selectedCase.actorEmail, password },
    overrideAccess: false
  });
  assert.ok(login.token);

  const req = await createPayloadRequest({
    config: payload.config,
    payloadInstanceCacheKey: bootKey,
    request: new Request("http://localhost/api/sales-tasks", {
      headers: { authorization: `JWT ${login.token}` }
    })
  });
  assert.equal(req.user?.collection, "users");
  assert.equal(String(req.user?.id), String(actor.id));

  const transactionID = await payload.db.beginTransaction();
  assert.ok(transactionID);
  req.transactionID = transactionID;
  assert.equal(await req.transactionID, transactionID);
  publication.start();

  const task = await payload.create({
    collection: "sales-tasks",
    data: { title: selectedCase.title, status: "open" },
    overrideAccess: false,
    req
  });
  assert.equal(task.title, selectedCase.title);
  assert.equal(await req.transactionID, transactionID);

  const occurredAt = "2026-08-26T12:00:00.123Z";
  await writeTransactionalOutboxEvent({
    req,
    event: {
      id: selectedCase.eventId,
      type: "sales.task.created",
      schemaVersion: 1,
      messageClass: "durable-workflow",
      occurredAt,
      applicationId: "customer-gate-1",
      pluginId: "module.sales",
      actor: { id: String(req.user.id), type: "user" },
      correlationId: selectedCase.correlationId,
      idempotencyKey: selectedCase.eventId,
      payload: { taskId: String(task.id), title: task.title }
    },
    retentionUntil: "2026-08-27T12:00:00.456Z"
  });
  assert.equal(await req.transactionID, transactionID);

  const beforeCommit = await visibleState(process.env.DATABASE_URL);
  assert.deepEqual(beforeCommit, { task_count: 0, outbox_count: 0, pending_count: 0 });
  publication.assertSilent();

  if (mode === "rollback") {
    await payload.db.rollbackTransaction(transactionID);
    publication.assertSilent();
    publication.stop();
    assert.deepEqual(await visibleState(process.env.DATABASE_URL), { task_count: 0, outbox_count: 0, pending_count: 0 });
    writeSync(1, "P3_2_ROLLBACK_PASS\n");
    process.exit(0);
  } else {
    await payload.db.commitTransaction(transactionID);
    publication.assertSilent();
    publication.stop();
    if (mode === "crash") {
      writeSync(1, "P3_2_CRASH_COMMITTED\n");
      process.exit(CRASH_EXIT_CODE);
    } else {
      assert.deepEqual(await visibleState(process.env.DATABASE_URL), { task_count: 1, outbox_count: 1, pending_count: 1 });
      writeSync(1, "P3_2_COMMIT_PASS\n");
      process.exit(0);
    }
  }
} finally {
  publication.stop();
  await payload.destroy();
}
