import assert from "node:assert/strict";

import { processNextPayloadOutboxEvent } from "@k-nex/payload-adapter";
import { createPayloadRequest } from "payload";

import { bootGate1Application } from "../dist/src/boot.js";
import { composedApplication } from "../dist/src/payload.config.js";

function binding(kind, id) {
  const found = composedApplication.registration.bindings[kind].find((entry) => entry.id === id && entry.pluginId === "module.sales");
  assert.equal(typeof found?.value, "function", `${kind}:${id} must resolve from scoped registration.`);
  return found.value;
}

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
  const task = await binding("actions", "sales.task.create")({
    actor, request: req, authorizationContext: {}, input: { title: "P6 durable Sales task" },
    idempotencyKey: "p6-sales-task-event", signal
  });
  const opportunity = await payload.create({
    collection: "sales-opportunities", data: { name: "P6 durable opportunity", stage: "lead", value: "100" }, overrideAccess: true
  });
  await binding("actions", "sales.opportunity.stage.update")({
    actor, request: req, authorizationContext: {}, input: { id: String(opportunity.id), expectedStage: "lead", expectedRevision: opportunity.updatedAt, stage: "qualified" },
    idempotencyKey: "p6-sales-opportunity-event", signal
  });

  const publications = [];
  const relay = binding("realtimeTopics", "sales.realtime.tasks")({
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
  const schemaHooks = composedApplication.registration.contributions.schema.flatMap(({ value }) => value.collection?.hooks?.afterChange ?? []);
  for (const event of composedApplication.registration.bindings.events) assert.equal(schemaHooks.includes(event.value), true);
  assert.deepEqual(await binding("jobs", "sales.job.pipeline-audit")({ opportunities: [{ stage: "lead" }, { stage: "won" }], signal }), {
    pluginId: "module.sales", jobId: "sales.job.pipeline-audit", stageCounts: { lead: 1, qualified: 0, won: 1, lost: 0 }
  });
  process.stdout.write("P6_SALES_EVENT_REALTIME_PASS\n");
} finally {
  await Promise.race([payload.destroy(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}
process.exit(0);
