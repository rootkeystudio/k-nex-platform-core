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
  const salesScope = {
    applicationId: "customer-gate-1",
    environment: "production",
    ownerId: actor.effectiveActor.id,
    teamId: `team:${actor.effectiveActor.id}`,
    createdBy: actor.effectiveActor.id,
    updatedBy: actor.effectiveActor.id,
    revision: 1,
    audit: []
  };
  const authorization = (actionId, resourceId) => ({
    actionId,
    applicationId: salesScope.applicationId,
    environment: salesScope.environment,
    actorId: actor.effectiveActor.id,
    ownerId: salesScope.ownerId,
    teamId: salesScope.teamId,
    ...(resourceId === undefined ? {} : { resourceId })
  });
  const signal = new AbortController().signal;
  const task = await binding("actions", "sales.task.create")({
    actor, request: req, authorizationContext: authorization("sales.task.create"), input: { title: "P6 durable Sales task" },
    idempotencyKey: "p6-sales-task-event", signal
  });
  const account = await payload.create({
    collection: "sales-accounts", data: { ...salesScope, name: "P6 durable account", status: "active" }, overrideAccess: true
  });
  const pipeline = await payload.create({
    collection: "sales-pipelines", data: { ...salesScope, name: "P6 durable pipeline", status: "active", orderedStageIds: [] }, overrideAccess: true
  });
  await payload.create({
    collection: "sales-pipeline-stages", data: {
      ...salesScope, pipelineId: pipeline.id, stageId: "qualification", name: "Qualification", semantic: "qualification",
      position: 0, probabilityBasisPoints: 0, allowedTransitions: ["discovery"], status: "active"
    }, overrideAccess: true
  });
  await payload.create({
    collection: "sales-pipeline-stages", data: {
      ...salesScope, pipelineId: pipeline.id, stageId: "discovery", name: "Discovery", semantic: "discovery",
      position: 1, probabilityBasisPoints: 0, allowedTransitions: [], status: "active"
    }, overrideAccess: true
  });
  const opportunity = await payload.create({
    collection: "sales-opportunities", data: {
      ...salesScope, name: "P6 durable opportunity", accountId: account.id, pipelineId: pipeline.id,
      stageId: "qualification", amount: "100", currency: "USD", archiveStatus: "active"
    }, overrideAccess: true
  });
  const pool = payload.db?.pool;
  assert.ok(pool && typeof pool === "object" && "query" in pool);
  await pool.query("update sales_opportunities set audit=jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-upgrade','receiptDigest',$2::text,'legacyStage','lead')) where id=$1", [opportunity.id, `sha256:${"0".repeat(64)}`]);
  await binding("actions", "sales.opportunity.stage.update")({
    actor, request: req, authorizationContext: authorization("sales.opportunity.stage.update", String(opportunity.id)),
    input: { id: String(opportunity.id), expectedStage: "qualification", expectedRevision: opportunity.revision, stage: "discovery" },
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
  assert.deepEqual(await binding("jobs", "sales.job.pipeline-audit")({ opportunities: [{ stage: "qualification" }, { stage: "won" }], signal }), {
    pluginId: "module.sales", jobId: "sales.job.pipeline-audit", stageCounts: { qualification: 1, discovery: 0, proposal: 0, negotiation: 0, won: 1, lost: 0 }
  });
  process.stdout.write("P6_SALES_EVENT_REALTIME_PASS\n");
} finally {
  await Promise.race([payload.destroy(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}
process.exit(0);
