import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { createOutboxRealtimeRelay, processNextPayloadOutboxEvent } from "@k-nex/payload-adapter";
import { socketIoRealtimeProvider } from "@k-nex/provider-realtime-socketio/server";
import { createRealtimeTopicRegistry, defineRealtimeTopic } from "@k-nex/runtime";
import pg from "pg";
import { io as connect } from "socket.io-client";

import { bootGate1Application } from "../dist/src/boot.js";

const connectionString = process.env.DATABASE_URL;
const bootKey = process.env.BOOT_KEY;
const mode = process.env.MODE ?? "initial";
if (!connectionString || !bootKey) throw new Error("DATABASE_URL and BOOT_KEY are required.");
if (mode !== "initial" && mode !== "recovered") throw new Error("MODE must be initial or recovered.");

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
const gateway = socketIoRealtimeProvider.create({
  httpServer,
  topics: createRealtimeTopicRegistry([topic]),
  security: {
    acknowledgementTimeoutMs: 1_000,
    authenticationTimeoutMs: 1_000,
    allowedOrigins: ["https://customer.example.test"],
    allowedTransports: ["websocket"],
    maxBufferedMessagesPerConnection: 8,
    maxConnections: 100,
    maxRequestBytes: 16_384,
    maxSubscriptionRequestsPerMinute: 60,
    maxSubscriptionsPerConnection: 16,
    revalidationIntervalMs: 60_000
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
  if (mode === "initial") assert.match(await runWorker(), /^P3_6_WORKER_COMMIT_PASS$/m);
  await client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
  const received = new Promise((resolve) => client.once("k-nex:event", (message, acknowledge) => {
    acknowledge();
    resolve(message);
  }));
  const relay = createOutboxRealtimeRelay({
    gateway,
    project: (event) => event.id === "p3-6-worker-event" || event.id === "p3-9-backplane-event"
      ? { topicId: "sales.tasks", params: { ownerId: event.payload.ownerId }, message: { revision: event.payload.revision } }
      : null
  });
  const expected = mode === "initial"
    ? { id: "p3-6-worker-event", correlationId: "p3-6-worker-correlation", revision: 6 }
    : { id: "p3-9-backplane-event", correlationId: "p3-9-backplane-correlation", revision: 7 };
  assert.deepEqual(await processNextPayloadOutboxEvent({ payload, subscriber: relay }), {
    eventId: expected.id,
    status: "delivered"
  });
  assert.deepEqual(await received, {
    correlationId: expected.correlationId,
    topicId: "sales.tasks",
    messageClass: "reconstructible-invalidation",
    event: { revision: expected.revision }
  });

  const database = new pg.Client({ connectionString });
  await database.connect();
  const state = await database.query(`
    SELECT status, attempt_count, checkpoint FROM k_nex_outbox WHERE event_id = 'p3-6-worker-event'
  `);
  const recoveryState = await database.query("SELECT status, attempt_count, checkpoint, last_error_code FROM k_nex_outbox WHERE event_id = 'p3-9-backplane-event'");
  await database.end();
  assert.deepEqual(state.rows, [{ status: "delivered", attempt_count: 1, checkpoint: { realtimePublished: true } }]);
  assert.deepEqual(recoveryState.rows, mode === "initial" ? [{
    status: "pending",
    attempt_count: 0,
    checkpoint: null,
    last_error_code: null
  }] : [{
    status: "delivered",
    attempt_count: 1,
    checkpoint: { realtimePublished: true },
    last_error_code: null
  }]);
  process.stdout.write(mode === "initial" ? "P3_6_DISTRIBUTED_REALTIME_PASS\n" : "P3_9_BACKPLANE_RECOVERY_PASS\n");
} finally {
  client.disconnect();
  void gateway.close();
  void payload.destroy();
}

process.exit(0);
