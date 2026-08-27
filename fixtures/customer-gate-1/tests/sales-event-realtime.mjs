import assert from "node:assert/strict";

import {
  createSalesRealtimeRelay,
  salesOpportunityStageUpdateHandler,
  salesTaskCreateHandler
} from "@k-nex/module-sales/server";
import { processNextPayloadOutboxEvent } from "@k-nex/payload-adapter";
import { createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";

const payload = await bootGate1Application({ key: process.env.BOOT_KEY });
try {
  const password = "sales-event-realtime-password";
  await payload.create({ collection: "users", data: { email: "sales-event-realtime@example.test", password } });
  const login = await payload.login({ collection: "users", data: { email: "sales-event-realtime@example.test", password }, overrideAccess: false });
  const req = await createPayloadRequest({
    config: payload.config,
    payloadInstanceCacheKey: process.env.BOOT_KEY,
    request: new Request("http://localhost/api/k-nex/actions", {
      headers: { authorization: `JWT ${login.token}`, "x-correlation-id": "p6-sales-events" }
    })
  });
  assert.ok(req.user);
  const actor = {
    principal: { kind: "user", id: String(req.user.id) },
    effectiveActor: { kind: "user", id: String(req.user.id) }
  };
  const signal = new AbortController().signal;
  const task = await salesTaskCreateHandler({
    actor, request: req, authorizationContext: {}, input: { title: "P6 durable Sales task" },
    idempotencyKey: "p6-sales-task-event", signal
  });
  const opportunity = await payload.create({
    collection: "sales-opportunities", data: { name: "P6 durable opportunity", stage: "lead", value: "100" }, overrideAccess: true
  });
  await salesOpportunityStageUpdateHandler({
    actor, request: req, authorizationContext: {}, input: { id: String(opportunity.id), stage: "qualified" },
    idempotencyKey: "p6-sales-opportunity-event", signal
  });

  const publications = [];
  const relay = createSalesRealtimeRelay({
    publish: async (input) => { publications.push(input); return { accepted: true }; }
  });
  const delivered = new Set();
  for (let attempt = 0; attempt < 100 && delivered.size < 2; attempt += 1) {
    const result = await processNextPayloadOutboxEvent({ payload, subscriber: relay });
    if (result.status === "idle") break;
    if (result.eventId === "p6-sales-task-event" || result.eventId === "p6-sales-opportunity-event") delivered.add(result.eventId);
  }
  assert.deepEqual([...delivered].sort(), ["p6-sales-opportunity-event", "p6-sales-task-event"]);
  assert.deepEqual(publications.map(({ channel, message }) => ({ topicId: channel.topicId, sourceId: message.sourceId, resourceId: message.resourceId })).sort((a, b) => a.topicId.localeCompare(b.topicId)), [
    { topicId: "sales.realtime.opportunities", sourceId: "sales.opportunities", resourceId: String(opportunity.id) },
    { topicId: "sales.realtime.tasks", sourceId: "sales.tasks", resourceId: task.id }
  ]);
  process.stdout.write("P6_SALES_EVENT_REALTIME_PASS\n");
} finally {
  await Promise.race([payload.destroy(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}
process.exit(0);
