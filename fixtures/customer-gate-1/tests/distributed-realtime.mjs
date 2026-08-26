import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { createOutboxRealtimeRelay, processNextPayloadOutboxEvent } from "@k-nex/payload-adapter";
import { createSocketIoMemoryGateway } from "@k-nex/realtime-socketio";
import { createRealtimeTopicRegistry, defineRealtimeTopic } from "@k-nex/runtime";
import pg from "pg";
import { io as connect } from "socket.io-client";

import { bootGate1Application } from "../dist/src/boot.js";

const connectionString = process.env.DATABASE_URL;
const bootKey = process.env.BOOT_KEY;
if (!connectionString || !bootKey) throw new Error("DATABASE_URL and BOOT_KEY are required.");

function runWorker() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/distributed-realtime-worker.mjs"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${stdout}\n${stderr}`)));
  });
}

const topic = defineRealtimeTopic({
  id: "sales.tasks",
  authorize: ({ actor, params }) => actor.id === params.ownerId,
  parseEvent(value) {
    if (typeof value !== "object" || value === null || !("revision" in value) || !Number.isSafeInteger(value.revision)) throw new TypeError();
    return value;
  },
  parseParams(value) {
    if (typeof value !== "object" || value === null || !("ownerId" in value) || typeof value.ownerId !== "string") throw new TypeError();
    return { ownerId: value.ownerId };
  }
});

const payload = await bootGate1Application({ key: bootKey });
const httpServer = createServer();
const gateway = createSocketIoMemoryGateway({
  httpServer,
  topics: createRealtimeTopicRegistry([topic]),
  security: {
    acknowledgementTimeoutMs: 1_000,
    allowedOrigins: ["https://customer.example.test"],
    allowedTransports: ["websocket"],
    maxBufferedMessagesPerConnection: 8,
    maxConnections: 100,
    maxRequestBytes: 16_384,
    maxSubscriptionRequestsPerMinute: 60,
    maxSubscriptionsPerConnection: 16
  },
  authenticate: async ({ actor }) => actor === "owner-1" ? { id: actor, type: "user" } : null,
  isActorActive: async () => true
});
await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
const address = httpServer.address();
assert.ok(address && typeof address === "object");
const client = connect(`http://127.0.0.1:${address.port}`, {
  auth: { actor: "owner-1" },
  transports: ["websocket"],
  extraHeaders: { origin: "https://customer.example.test" }
});
await new Promise((resolve, reject) => {
  client.once("connect", resolve);
  client.once("connect_error", reject);
});

try {
  assert.match(await runWorker(), /^P3_6_WORKER_COMMIT_PASS$/m);
  await client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
  const received = new Promise((resolve) => client.once("k-nex:event", (message, acknowledge) => {
    acknowledge();
    resolve(message);
  }));
  const relay = createOutboxRealtimeRelay({
    gateway,
    project: (event) => event.id === "p3-6-worker-event" || event.id === "p3-9-backplane-event"
      ? { topicId: "sales.tasks", params: { ownerId: event.payload.ownerId }, event: { revision: event.payload.revision } }
      : null
  });
  assert.deepEqual(
    await processNextPayloadOutboxEvent({ payload, subscriber: relay }),
    { eventId: "p3-6-worker-event", status: "delivered" }
  );
  assert.deepEqual(await received, { topicId: "sales.tasks", event: { revision: 6 } });

  const unavailableRelay = createOutboxRealtimeRelay({
    gateway: { publish: async () => { throw new Error("private backplane failure"); } },
    project: (event) => ({
      topicId: "sales.tasks",
      params: { ownerId: event.payload.ownerId },
      event: { revision: event.payload.revision }
    })
  });
  assert.deepEqual(
    await processNextPayloadOutboxEvent({ payload, subscriber: unavailableRelay, backoffMs: 5 }),
    { eventId: "p3-9-backplane-event", status: "retry-scheduled" }
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const recovered = new Promise((resolve) => client.once("k-nex:event", (message, acknowledge) => {
    acknowledge();
    resolve(message);
  }));
  assert.deepEqual(
    await processNextPayloadOutboxEvent({ payload, subscriber: relay, backoffMs: 5 }),
    { eventId: "p3-9-backplane-event", status: "delivered" }
  );
  assert.deepEqual(await recovered, { topicId: "sales.tasks", event: { revision: 7 } });

  const database = new pg.Client({ connectionString });
  await database.connect();
  const state = await database.query(`
    SELECT status, attempt_count, checkpoint FROM k_nex_outbox WHERE event_id = 'p3-6-worker-event'
  `);
  const recoveryState = await database.query(`
    SELECT status, attempt_count, checkpoint, last_error_code
    FROM k_nex_outbox WHERE event_id = 'p3-9-backplane-event'
  `);
  await database.end();
  assert.deepEqual(state.rows, [{ status: "delivered", attempt_count: 1, checkpoint: { realtimePublished: true } }]);
  assert.deepEqual(recoveryState.rows, [{
    status: "delivered",
    attempt_count: 2,
    checkpoint: { realtimePublished: true },
    last_error_code: null
  }]);
  process.stdout.write("P3_6_DISTRIBUTED_REALTIME_PASS\nP3_9_BACKPLANE_RECOVERY_PASS\n");
} finally {
  client.disconnect();
  void gateway.close();
  void payload.destroy();
}

process.exit(0);
