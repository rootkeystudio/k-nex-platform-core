import assert from "node:assert/strict";

import { sql } from "@payloadcms/db-postgres";
import {
  activePayloadPostgresTransaction,
  admitTrustedSalesTaskCreateId,
  createPayloadPersistenceCapability,
  processNextPayloadOutboxEvent,
  revokeTrustedSalesTaskCreateId
} from "@k-nex/payload-adapter";
import { salesPipelineStageId } from "@k-nex/module-sales/server";
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
  const taskPersistence = createPayloadPersistenceCapability(req, [{ collection: "sales-tasks", operations: ["create"] }], { authorize: () => true });
  await taskPersistence.transaction.begin();
  let task;
  try {
    const transaction = await activePayloadPostgresTransaction(req);
    const allocated = await transaction.execute(sql`SELECT nextval(pg_get_serial_sequence('public.sales_tasks', 'id')) AS "id"`);
    const numericTaskId = Number(allocated.rows[0]?.id);
    assert.ok(Number.isSafeInteger(numericTaskId) && numericTaskId > 0 && numericTaskId <= 2_147_483_647);
    const resourceId = String(numericTaskId);
    await admitTrustedSalesTaskCreateId(req, { id: numericTaskId, resourceId });
    task = await binding("actions", "sales.task.create")({
      actor, request: taskPersistence, authorizationContext: authorization("sales.task.create", resourceId), input: { title: "P6 durable Sales task" },
      idempotencyKey: "p6-sales-task-event", signal
    });
    await taskPersistence.transaction.commit();
  } catch (error) {
    await taskPersistence.transaction.rollback();
    throw error;
  } finally {
    revokeTrustedSalesTaskCreateId(req);
  }
  const taskGenesis = (await payload.find({ collection: "sales-tasks", overrideAccess: true, limit: 1, where: { id: { equals: task.id } } })).docs[0];
  assert.equal(String(taskGenesis.id), task.id);
  assert.deepEqual(taskGenesis.audit, [{
    actionId: "sales.task.create", resourceId: task.id, applicationId: "customer-gate-1", environment: "production",
    fromState: "absent", toState: "open", occurredAt: taskGenesis.audit[0].occurredAt, actorId: actor.effectiveActor.id,
    revision: 1, idempotencyKey: "p6-sales-task-event"
  }]);
  const account = await payload.create({
    collection: "sales-accounts", data: { ...salesScope, name: "P6 durable account", status: "active" }, overrideAccess: true
  });
  const existingPipelines = await payload.find({
    collection: "sales-pipelines", overrideAccess: true, limit: 2,
    where: { and: [{ applicationId: { equals: salesScope.applicationId } }, { environment: { equals: salesScope.environment } }, { status: { equals: "active" } }, { isActive: { equals: true } }] }
  });
  assert.ok(existingPipelines.docs.length <= 1, "Sales permits at most one active pipeline per application environment.");
  const pipeline = existingPipelines.docs[0] ?? await payload.create({
    collection: "sales-pipelines", data: { ...salesScope, name: "P6 durable pipeline", status: "active", isActive: true, orderedStageIds: [] }, overrideAccess: true
  });
  const stageDefinitions = [
    ["qualification", "Qualification", 0, 0, ["discovery", "lost"]],
    ["discovery", "Discovery", 1, 2_500, ["proposal", "lost"]],
    ["proposal", "Proposal", 2, 5_000, ["negotiation", "lost"]],
    ["negotiation", "Negotiation", 3, 7_500, ["won", "lost"]],
    ["won", "Won", 4, 10_000, []],
    ["lost", "Lost", 5, 0, []]
  ];
  const stageIds = Object.fromEntries(stageDefinitions.map(([semantic]) => [semantic, salesPipelineStageId("customer-gate-1", "production", Number(pipeline.id), semantic)]));
  let configuredPipeline = pipeline;
  if (existingPipelines.docs.length === 0) {
    for (const [semantic, name, position, probabilityBasisPoints, transitions] of stageDefinitions) {
      await payload.create({
        collection: "sales-pipeline-stages", data: {
          ...salesScope, pipelineId: pipeline.id, stageId: stageIds[semantic], name, semantic, position, probabilityBasisPoints,
          allowedTransitionStageIds: transitions.map((destination) => stageIds[destination]), requiredFieldIds: semantic === "lost" ? ["lossReason"] : [], status: "active"
        }, overrideAccess: true
      });
    }
    configuredPipeline = await payload.update({ collection: "sales-pipelines", id: pipeline.id, data: { orderedStageIds: stageDefinitions.map(([semantic]) => stageIds[semantic]) }, overrideAccess: true });
  }
  const opportunity = await payload.create({
    collection: "sales-opportunities", data: {
      ...salesScope, name: "P6 durable opportunity", accountId: account.id, pipelineId: pipeline.id,
      stageId: stageIds.qualification, amount: "100", currency: "USD", archiveStatus: "active"
    }, overrideAccess: true
  });
  const pool = payload.db?.pool;
  assert.ok(pool && typeof pool === "object" && "query" in pool);
  assert.equal((await pool.query("select payload->>'operation' operation from k_nex_outbox where event_id='p6-sales-task-event'")).rows[0]?.operation, "create");
  await pool.query("update sales_opportunities set audit=jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-upgrade','receiptDigest',$2::text,'legacyStage','lead','ownershipGenesis',jsonb_build_object('ownerId',owner_id,'teamId',team_id))) where id=$1", [opportunity.id, `sha256:${"0".repeat(64)}`]);
  await binding("actions", "sales.opportunity.stage.update")({
    actor, request: req, authorizationContext: authorization("sales.opportunity.stage.update", String(opportunity.id)),
    input: {
      id: String(opportunity.id), expectedRevision: opportunity.revision, expectedPipelineId: String(pipeline.id), expectedPipelineRevision: configuredPipeline.revision,
      expectedSourceStageId: stageIds.qualification, expectedSourceStageRevision: 1, destinationStageId: stageIds.discovery, expectedDestinationStageRevision: 1
    },
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
  assert.deepEqual(publications.map(({ channel, message }) => ({ topicId: channel.topicId, topic: message.topic, source: message.source, event: message.event, dedupe: message.dedupe })).sort((a, b) => a.topicId.localeCompare(b.topicId)), [
    { topicId: "sales.realtime.opportunities", topic: "sales.realtime.opportunities", source: "sales.opportunities", event: "sales.event.opportunity-changed", dedupe: "p6-sales-opportunity-event" },
    { topicId: "sales.realtime.tasks", topic: "sales.realtime.tasks", source: "sales.tasks", event: "sales.event.task-changed", dedupe: "p6-sales-task-event" }
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
