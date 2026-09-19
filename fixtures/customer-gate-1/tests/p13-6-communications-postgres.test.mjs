import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import pg from "pg";
import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";

import { up } from "../dist/src/migrations/20260908_000032_communications.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "p13-communications";
const environment = "production";
const emailProvider = "email.reference.v1";
const calendarProvider = "calendar.reference.v1";

async function database(name, run) {
  const container = await new PostgreSqlContainer(image).withDatabase(name).withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`create table sales_activities(
      id serial primary key, application_id text, environment text, owner_id text, team_id text, created_by text, updated_by text,
      audit jsonb, status text, type text, subject text, actor_id text, scheduled_at timestamptz, occurred_at timestamptz, related_record_id text,
      related_record_type text, provider_metadata jsonb, revision integer default 1, updated_at timestamptz default now()
    )`);
    // P13.6 extends the Payload lock relation created by the predecessor migration.
    await pool.query("create table payload_locked_documents_rels(id bigserial primary key)");
    await pool.query(`create table k_nex_outbox(
      id bigserial primary key,event_id varchar(128) unique not null,event_type varchar(128) not null,schema_version integer not null,message_class varchar(32) not null,
      occurred_at timestamptz not null,application_id varchar(128) not null,plugin_id varchar(128) not null,actor_id varchar(128),actor_type varchar(64),impersonator_id varchar(128),
      correlation_id varchar(128) not null,causation_id varchar(128),idempotency_key varchar(128),payload jsonb not null,status varchar(32) not null default 'pending',attempt_count integer not null default 0,available_at timestamptz not null default now(),lease_expires_at timestamptz,claimed_at timestamptz,claim_token varchar(64),checkpoint jsonb,last_error_code varchar(128),dead_lettered_at timestamptz,processed_at timestamptz,retention_until timestamptz not null,updated_at timestamptz not null default now(),created_at timestamptz not null default now()
    )`);
    await up({ db: drizzle(pool) });
    await run(pool, container.getConnectionUri());
  } finally {
    await pool.end();
    await container.stop();
  }
}

function authority(actorId, permissionGrants, app = applicationId) {
  return Object.freeze({
    context: Object.freeze({ applicationId: app, environment, actorId }),
    authorizationRevision: 7,
    lifecycleRevision: 3,
    scopeRevision: 11,
    permissionGrants: Object.freeze(permissionGrants)
  });
}

async function transactionRequest(pool, id, run) {
  const session = await pool.connect();
  try {
    await session.query("begin");
    const request = { transactionID: id, payload: { db: { sessions: { [id]: { db: drizzle(session) } } } } };
    const value = await run(request);
    await session.query("commit");
    return value;
  } catch (error) {
    await session.query("rollback");
    throw error;
  } finally {
    session.release();
  }
}

function signedWebhook(secret, event, overrides = {}) {
  const body = Buffer.from(JSON.stringify(event));
  const timestamp = overrides.timestamp ?? String(Date.now());
  const signature = overrides.signature ?? `v1=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}`;
  return { body, timestamp, signature };
}

async function createWorkerPrerequisites(pool) {
  await pool.query("create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment)); create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer); create table sales_current_authority_scopes(application_id text,environment text,principal_id text,state text,revision integer,record_scope text,application_wide boolean,authorized_team_ids jsonb); create table sales_contacts(id bigint primary key,application_id text,environment text,email text,owner_id text,team_id text)");
  await pool.query("insert into runtime_worker_generation_fences values ($1,$2,'sales-generation-2',2,'worker-2',now()+interval '1 hour',2)", [applicationId, environment]);
  await pool.query("insert into k_nex_authorization_state values ($1,7,3)", [applicationId]);
  await pool.query("insert into sales_current_authority_scopes values ($1,$2,'actor-a','active',11,'owned-or-assigned-team',false,'[\"team:actor-a\"]')", [applicationId, environment]);
  await pool.query("insert into sales_contacts values (17,$1,$2,'resolved-at-worker@example.test','actor-a','team:actor-a')", [applicationId, environment]);
}

async function workerActivity(pool, subject, relatedRecordId = "17", type = "email") {
  return (await pool.query("insert into sales_activities(application_id,environment,owner_id,team_id,created_by,updated_by,audit,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type,revision) values ($1,$2,'actor-a','team:actor-a','actor-a','actor-a','[]','scheduled',$3,$4,'actor-a',now(),$5,'sales.contact',1) returning id", [applicationId, environment, type, subject, relatedRecordId])).rows[0];
}

function spawnCommunicationWorker(connectionString, endpoint, fence) {
  const moduleUrl = new URL("../dist/src/k-nex-sales-communications.js", import.meta.url).href;
  const workerSource = `import pg from "pg"; import { createGeneratedBoundedReferenceProviderTransport, createGeneratedEnvironmentProviderSecretResolver, processGeneratedSalesCommunications } from ${JSON.stringify(moduleUrl)}; const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); try { const result = await processGeneratedSalesCommunications(pool, ${JSON.stringify(fence)}, createGeneratedEnvironmentProviderSecretResolver(process.env), createGeneratedBoundedReferenceProviderTransport(${JSON.stringify(endpoint)})); console.log(JSON.stringify({ result })); } finally { await pool.end(); }`;
  return spawn(process.execPath, ["--input-type=module", "-e", workerSource], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString, K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted", K_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE: "calendar-token-not-persisted" },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function childExit(child) {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

const referenceCapability = (providerId) => Object.freeze({ contractId: "k-nex.reference-provider.v1", version: 1, providerId, idempotency: "durable-key-scoped-exactly-once", idempotencyKeyFormat: "sha256-canonical-json-v1", reconciliation: "receipt-lookup-by-idempotency-key", durability: "survives-provider-restart" });
const referenceReceipt = (idempotencyKey, duplicate = false) => Object.freeze({ providerReceiptId: `reference-receipt-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`, idempotencyKey, duplicate });
// Every admitted provider declares durable exactly-once plus receipt lookup; a
// double that cannot answer both is not a provider this lane will call.
const admittedTransport = (behaviour) => Object.freeze({ capability: referenceCapability, reconcile: behaviour.reconcile ?? (async () => null), invoke: async (input) => await behaviour.invoke(input) ?? referenceReceipt(input.idempotencyKey) });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("P13.6 provider operations keep secret references opaque and make send/sync idempotency actor- and application-scoped", { timeout: 180_000 }, async () => {
  await database("p13_6_provider_operations", async (pool) => {
    const { GeneratedSalesCommunicationStore } = await import("../dist/src/k-nex-sales-communications.js");
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,$4,replace($4,':provider-api:',':webhook-signature:'),'administrator'),($1,$2,$5,$6,replace($6,':provider-api:',':webhook-signature:'),'administrator'),('p13-other',$2,$3,$7,replace($7,':provider-api:',':webhook-signature:'),'administrator')", [applicationId, environment, emailProvider, "secret-ref:v1:email-reference:provider-api:default", calendarProvider, "secret-ref:v1:calendar-reference:provider-api:default", "secret-ref:v1:email-reference:provider-api:other"]);

    const dispatch = async (actorId, intent, app = applicationId) => await transactionRequest(pool, `tx-${actorId}-${intent.idempotencyKey}-${app}`, async (request) => {
      const permissions = intent.actionId === "sales.email.send" ? ["sales.communications.email.send"] : ["sales.communications.calendar.sync"];
      return await new GeneratedSalesCommunicationStore(request, authority(actorId, permissions, app)).dispatch(intent);
    });
    const email = { actionId: "sales.email.send", idempotencyKey: "p136-email-idempotency", relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: "Follow up", body: "Hello", activityId: 101, expectedRevision: 1 } };
    const first = await dispatch("actor-a", email); const replay = await dispatch("actor-a", email);
    assert.deepEqual(replay, first, "same actor/application/key must replay the durable send receipt");
    const otherActor = await dispatch("actor-b", email); const otherApplication = await dispatch("actor-a", email, "p13-other");
    assert.notEqual(otherActor.operationId, first.operationId); assert.notEqual(otherApplication.operationId, first.operationId);

    const calendar = { actionId: "sales.calendar.sync", idempotencyKey: "p136-calendar-idempotency", relatedRecord: { type: "sales.task", id: 23 }, payload: { activityId: 91, expectedRevision: 1 } };
    const calendarFirst = await dispatch("actor-a", calendar); const calendarReplay = await dispatch("actor-a", calendar);
    assert.deepEqual(calendarReplay, calendarFirst, "calendar sync must replay one durable operation");
    assert.deepEqual((await pool.query("select provider_id,actor_id,count(*)::int count from sales_provider_operations group by provider_id,actor_id order by provider_id,actor_id")).rows, [
      { provider_id: calendarProvider, actor_id: "actor-a", count: 1 },
      { provider_id: emailProvider, actor_id: "actor-a", count: 2 },
      { provider_id: emailProvider, actor_id: "actor-b", count: 1 }
    ]);
    const serialized = JSON.stringify((await pool.query("select * from sales_provider_operations order by operation_id")).rows);
    assert.equal(serialized.includes("secret-ref:"), false, "operations must retain neither secret references nor values");
    assert.equal(serialized.includes("@"), false, "provider operations must not retain a caller-supplied mailbox address");

    const configure = await transactionRequest(pool, "tx-configure-provider", async (request) => await new GeneratedSalesCommunicationStore(request, authority("administrator", ["sales.settings.write"])).dispatch({ actionId: "sales.integration.configure", idempotencyKey: "p136-configure-email", relatedRecord: null, payload: { providerId: emailProvider, expectedRevision: 1, operation: "activate" } }));
    assert.equal(configure.operationId, "configuration-email-reference-v1");
    assert.match(configure.operationId, /^[a-z][a-z0-9-]{2,127}$/u, "configuration result must satisfy the Sales durable ID contract");
    assert.deepEqual((await pool.query("select provider_id,revision,audit_data->>'toState' to_state from sales_provider_configuration_audit where application_id=$1 and environment=$2", [applicationId, environment])).rows, [{ provider_id: emailProvider, revision: 2, to_state: "active" }]);
    await assert.rejects(() => pool.query("update sales_provider_configuration_audit set audit_data='{}'::jsonb"), /immutable/u);
    const configEvent = (await pool.query("select payload from k_nex_outbox where event_type='sales.event.provider-configuration-changed'")).rows[0]?.payload;
    assert.deepEqual(Object.keys(configEvent).sort(), ["providerId", "revision", "revokedAt", "state", "updatedAt"].sort());
    assert.equal(JSON.stringify(configEvent).includes("secret-ref:"), false);

    await pool.query("update sales_provider_configurations set state='revoked',revoked_at=now(),revision=revision+1 where application_id=$1 and environment=$2 and provider_id=$3", [applicationId, environment, emailProvider]);
    await assert.rejects(() => dispatch("actor-a", { ...email, idempotencyKey: "p136-revoked-provider" }), (error) => error?.code === "PROVIDER_UNAVAILABLE" && error?.status === 503);
    assert.equal(Number((await pool.query("select count(*) count from sales_provider_operations where idempotency_digest not in ($1,$2,$3,$4)", [first.receipt.idempotencyDigest, otherActor.receipt.idempotencyDigest, otherApplication.receipt.idempotencyDigest, calendarFirst.receipt.idempotencyDigest])).rows[0].count), 0, "revoked admission must persist no operation");
  });
});

test("P13.6 webhooks enforce body, signature, time, replay, application binding, and secret non-leak", { timeout: 180_000 }, async () => {
  await database("p13_6_webhooks", async (pool) => {
    const { acceptGeneratedSalesProviderWebhook } = await import("../dist/src/k-nex-sales-communications.js");
    const secret = "fixture-webhook-signature-secret"; const reference = "secret-ref:v1:email-reference:webhook-signature:default"; const apiReference = "secret-ref:v1:email-reference:provider-api:default"; const resolved = [];
    const resolver = { async resolve(candidate, purpose) { resolved.push({ candidate, purpose }); assert.equal(candidate, reference); assert.equal(purpose, "webhook-signature"); return { value: secret }; } };
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,$4,$5,'administrator')", [applicationId, environment, emailProvider, apiReference, reference]);
    const operationId = "provider-webhook-operation-001";
    await pool.query(`insert into sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,effect_claim_id,effect_dispatched_at,provider_receipt_id,provider_receipt_at,accepted_at)
      values($1,$2,$3,$4,'sales.email.send','recipient-a','sales.contact',17,$5,'{}',1,7,3,11,'accepted',1,now(),'seeded-effect-claim',now(),'reference-receipt-seeded-001',now(),now())`, [operationId, applicationId, environment, emailProvider, `sha256:${"2".repeat(64)}`]);
    const event = { applicationId, environment, eventId: "p136-event-001", operationId, recipientId: "recipient-a", kind: "message-delivered", metadata: { providerMessageId: "opaque-provider-message" } };
    const valid = signedWebhook(secret, event);
    const invoke = async (request, app = applicationId) => await acceptGeneratedSalesProviderWebhook({ pool, resolver, providerId: emailProvider, applicationId: app, environment, ...request });
    assert.deepEqual(await invoke(valid), { accepted: true, replay: false });
    assert.deepEqual(await invoke(valid), { accepted: true, replay: true });
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where recipient_id='recipient-a'")).rows[0].count), 1);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.notification-changed'")).rows[0].count), 1, "webhook replay must not add another realtime event");

    const altered = signedWebhook(secret, { ...event, metadata: { providerMessageId: "altered" } });
    await assert.rejects(() => invoke(altered), (error) => error?.code === "WEBHOOK_INVALID" || error?.code === "WEBHOOK_REPLAY_CONFLICT");
    for (const invalid of [
      { ...valid, signature: `v1=${"0".repeat(64)}` },
      signedWebhook(secret, event, { timestamp: String(Date.now() - 300_001) }),
      { body: Buffer.alloc(65_537), timestamp: String(Date.now()), signature: `v1=${"0".repeat(64)}` }
    ]) await assert.rejects(() => invoke(invalid), (error) => error?.code === "WEBHOOK_INVALID");
    await assert.rejects(() => invoke(valid, "p13-cross-application"), (error) => error?.code === "WEBHOOK_INVALID");
    const unknownMetadata = signedWebhook(secret, { ...event, eventId: "p136-event-unknown-metadata", metadata: { providerMessageId: "safe", rawMailbox: "forbidden@example.test" } });
    await assert.rejects(() => invoke(unknownMetadata), (error) => error?.code === "WEBHOOK_INVALID");
    const crossRecipient = signedWebhook(secret, { ...event, eventId: "p136-event-cross-recipient", recipientId: "recipient-b" });
    await assert.rejects(() => invoke(crossRecipient), (error) => error?.code === "WEBHOOK_INVALID");

    const externalId = (prefix) => `${prefix}${"._:-".repeat(80)}`.slice(0, 160);
    const longOperationId = externalId("O");
    const longEventId = externalId("E");
    await pool.query(`insert into sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,effect_claim_id,effect_dispatched_at,provider_receipt_id,provider_receipt_at,accepted_at)
      values($1,$2,$3,$4,'sales.email.send','recipient-a','sales.contact',17,$5,'{}',1,7,3,11,'accepted',0,now(),'seeded-effect-claim-2',now(),'reference-receipt-seeded-002',now(),now())`, [longOperationId, applicationId, environment, emailProvider, `sha256:${"3".repeat(64)}`]);
    const longEvent = { applicationId, environment, eventId: longEventId, operationId: longOperationId, recipientId: "recipient-a", kind: "message-delivered", metadata: { providerMessageId: "long-provider-message" } };
    const longSigned = signedWebhook(secret, longEvent);
    assert.deepEqual(await invoke(longSigned), { accepted: true, replay: false }, "the bounded external-ID grammar permits noncanonical IDs at its 160-character limit");
    const longWebhookRow = (await pool.query("select event_id,operation_id from sales_provider_webhook_events where event_id=$1", [longEventId])).rows[0];
    assert.deepEqual(longWebhookRow, { event_id: longEventId, operation_id: longOperationId });
    const expectedLongOutboxId = `sales-webhook-${createHash("sha256").update(canonicalJson({ applicationId, environment, providerId: emailProvider, eventId: longEventId })).digest("hex")}`;
    const longOutboxRow = (await pool.query("select event_id,payload->>'resourceId' resource_id from k_nex_outbox where event_id=$1", [expectedLongOutboxId])).rows[0];
    assert.deepEqual(longOutboxRow, { event_id: expectedLongOutboxId, resource_id: String((await pool.query("select id from sales_notifications where reference_kind='provider-webhook' and reference_id=$1", [longEventId])).rows[0]?.id) });
    assert.ok(expectedLongOutboxId.length <= 128, "outbox identity must stay within varchar(128) regardless of provider ID length");

    const collisionOperationId = externalId("P");
    const collisionEventId = externalId("C");
    await pool.query(`insert into sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,effect_claim_id,effect_dispatched_at,provider_receipt_id,provider_receipt_at,accepted_at)
      values($1,$2,$3,$4,'sales.email.send','recipient-a','sales.contact',17,$5,'{}',1,7,3,11,'accepted',0,now(),'seeded-effect-claim-2',now(),'reference-receipt-seeded-002',now(),now())`, [collisionOperationId, applicationId, environment, emailProvider, `sha256:${"4".repeat(64)}`]);
    const collisionEvent = { applicationId, environment, eventId: collisionEventId, operationId: collisionOperationId, recipientId: "recipient-a", kind: "message-delivered", metadata: { providerMessageId: "collision-provider-message" } };
    const collisionSigned = signedWebhook(secret, collisionEvent);
    const collisionOutboxId = `sales-webhook-${createHash("sha256").update(canonicalJson({ applicationId, environment, providerId: emailProvider, eventId: collisionEventId })).digest("hex")}`;
    await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values ($1,'sales.event.notification-changed',1,'durable-integration',now(),$2,'module.sales','collision-seed','user','collision-correlation','collision-causation','collision-idempotency','{\"collision\":true}'::jsonb,'pending',now()+interval '30 days')", [collisionOutboxId, applicationId]);
    const collisionBefore = (await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [collisionOutboxId])).rows;
    const evidenceBefore = Number((await pool.query("select count(*) count from sales_provider_webhook_events")).rows[0].count);
    const notificationBefore = Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count);
    await assert.rejects(() => invoke(collisionSigned), (error) => error?.code === "WEBHOOK_INVALID" && error?.status === 409);
    assert.equal(Number((await pool.query("select count(*) count from sales_provider_webhook_events")).rows[0].count), evidenceBefore, "webhook outbox collision must roll back evidence");
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count), notificationBefore, "webhook outbox collision must roll back notification creation");
    assert.deepEqual((await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [collisionOutboxId])).rows, collisionBefore, "preexisting webhook outbox collision must remain unchanged");

    assert.deepEqual((await pool.query("select application_id,environment,provider_id,event_id,recipient_id,event_kind from sales_provider_webhook_events order by event_id")).rows, [
      { application_id: applicationId, environment, provider_id: emailProvider, event_id: longEventId, recipient_id: longEvent.recipientId, event_kind: longEvent.kind },
      { application_id: applicationId, environment, provider_id: emailProvider, event_id: event.eventId, recipient_id: event.recipientId, event_kind: event.kind }
    ]);
    await assert.rejects(() => pool.query("update sales_provider_webhook_events set recipient_id='attacker'"), /immutable/u);
    assert.ok(resolved.length >= 2); assert.equal(JSON.stringify((await pool.query("select * from sales_provider_webhook_events")).rows).includes(secret), false);
  });
});

test("P13.6 provider outage retries are bounded, dead-lettered, and generation fenced", { timeout: 180_000 }, async () => {
  await database("p13_6_provider_worker", async (pool) => {
    const { GeneratedSalesCommunicationStore, processGeneratedSalesCommunications, createGeneratedBoundedReferenceProviderTransport, createGeneratedEnvironmentProviderSecretResolver } = await import("../dist/src/k-nex-sales-communications.js");
    await pool.query("create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment)); create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer); create table sales_current_authority_scopes(application_id text,environment text,principal_id text,state text,revision integer,record_scope text,application_wide boolean,authorized_team_ids jsonb); create table sales_contacts(id bigint primary key,application_id text,environment text,email text,owner_id text,team_id text)");
    await pool.query("insert into runtime_worker_generation_fences values ($1,$2,'sales-generation-2',2,'worker-2',now()+interval '1 hour',2)", [applicationId, environment]);
    await pool.query("insert into k_nex_authorization_state values ($1,7,3)", [applicationId]);
    await pool.query("insert into sales_current_authority_scopes values ($1,$2,'actor-a','active',11,'owned-or-assigned-team',false,'[\"team:actor-a\"]')", [applicationId, environment]);
    await pool.query("insert into sales_contacts values (17,$1,$2,'resolved-at-worker@example.test','actor-a','team:actor-a')", [applicationId, environment]);
    const activity = (await pool.query("insert into sales_activities(application_id,environment,owner_id,team_id,created_by,updated_by,audit,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type,revision) values ($1,$2,'actor-a','team:actor-a','actor-a','actor-a','[]','scheduled','email','Follow up','actor-a',now(), '17','sales.contact',1) returning id", [applicationId, environment])).rows[0];
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const queued = await transactionRequest(pool, "tx-worker", async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: "p136-worker-outage", relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: "Follow up", body: "Hello", activityId: activity.id, expectedRevision: 1 } }));
    const resolver = { async resolve(reference, purpose) { assert.equal(reference, "secret-ref:v1:email-reference:provider-api:default"); assert.equal(purpose, "provider-api"); return { value: "not-persisted-provider-token" }; }, async invoke(input) { attempts.push(input); throw new Error("fixture provider outage"); } };
    const attempts = [];
    {
      const stale = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
      const outageTransport = admittedTransport({ async invoke(input) { attempts.push(input); throw new Error("fixture provider outage"); } });
      assert.equal(await processGeneratedSalesCommunications(pool, stale, resolver, outageTransport), 0, "promoted-out generation must not claim work");
      assert.deepEqual((await pool.query("select state,attempt from sales_provider_operations where operation_id=$1", [queued.operationId])).rows, [{ state: "queued", attempt: 0 }]);
      const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await pool.query("update sales_provider_operations set next_attempt_at=now() where operation_id=$1", [queued.operationId]);
        assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, outageTransport), 1);
        const row = (await pool.query("select state,attempt,failure_code from sales_provider_operations where operation_id=$1", [queued.operationId])).rows[0];
        assert.equal(row.attempt, attempt); assert.equal(row.state, attempt < 3 ? "queued" : "dead-letter"); assert.equal(row.failure_code, "PROVIDER_OUTAGE");
      }
      assert.equal(await processGeneratedSalesCommunications(pool, current, resolver), 0);
      assert.equal(attempts.length, 3); assert.equal(new Set(attempts.map(({ idempotencyKey }) => idempotencyKey)).size, 1, "all provider attempts must use one stable outbound idempotency key");
      assert.equal(attempts[0].idempotencyKey, queued.receipt.idempotencyDigest); assert.equal(attempts[0].payload.recipient, "resolved-at-worker@example.test", "worker must resolve the current authorized CRM channel transiently");
      const serialized = JSON.stringify((await pool.query("select * from sales_provider_operations where operation_id=$1", [queued.operationId])).rows);
      assert.equal(serialized.includes("not-persisted-provider-token"), false);

      await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:calendar-reference:provider-api:default','secret-ref:v1:calendar-reference:webhook-signature:default','administrator')", [applicationId, environment, calendarProvider]);
      const calendarActivity = (await pool.query("insert into sales_activities(application_id,environment,owner_id,team_id,created_by,updated_by,audit,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type,revision) values ($1,$2,'actor-a','team:actor-a','actor-a','actor-a','[]','scheduled','meeting','Calendar sync','actor-a',now(), '17','sales.contact',1) returning id", [applicationId, environment])).rows[0];
      const calendarOperation = await transactionRequest(pool, "tx-calendar-worker", async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.calendar.sync"])).dispatch({ actionId: "sales.calendar.sync", idempotencyKey: "p136-calendar-worker", relatedRecord: { type: "sales.contact", id: 17 }, payload: { activityId: calendarActivity.id, expectedRevision: 1 } }));
      const observed = []; const provider = createServer((request, response) => { const key = request.headers["idempotency-key"]; observed.push({ key, provider: request.headers["x-k-nex-provider"] }); request.resume(); response.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify(referenceReceipt(String(key)))); }); await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve)); const address = provider.address(); assert.ok(address && typeof address === "object"); const generatedTransport = createGeneratedBoundedReferenceProviderTransport(`http://127.0.0.1:${address.port}/k-nex/reference-provider`);
      const generatedAdapter = createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted", K_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE: "calendar-token-not-persisted" });
      assert.equal(await processGeneratedSalesCommunications(pool, current, generatedAdapter, generatedTransport), 1);
      assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_provider_operations where operation_id=$1", [calendarOperation.operationId])).rows, [{ state: "accepted", attempt: 0, failure_code: null }], "generated fixed adapter must accept the worker effect");
      assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_provider_operations where operation_id=$1", [calendarOperation.operationId])).rows, [{ state: "accepted", attempt: 0, failure_code: null }]);
      assert.deepEqual(observed, [{ key: calendarOperation.receipt.idempotencyDigest, provider: calendarProvider }], "bounded reference provider receives one durable idempotency key");
      assert.deepEqual((await pool.query("select status,revision,provider_metadata->>'operationId' operation_id from sales_activities where id=$1", [calendarActivity.id])).rows, [{ status: "completed", revision: 2, operation_id: calendarOperation.operationId }]);
      assert.deepEqual((await pool.query("select audit->0->>'actionId' action_id,audit->0->>'fromState' from_state,audit->0->>'toState' to_state,audit->0->>'idempotencyKey' idempotency_key from sales_activities where id=$1", [calendarActivity.id])).rows, [{ action_id: "sales.activity.complete", from_state: "scheduled", to_state: "completed", idempotency_key: `sales-provider-activity-complete-${calendarOperation.operationId}` }]);
      assert.deepEqual((await pool.query("select operation_id,activity_id from sales_provider_activity_receipts where operation_id=$1", [calendarOperation.operationId])).rows, [{ operation_id: calendarOperation.operationId, activity_id: calendarActivity.id }]);
      assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.timeline-changed' and payload->>'resourceId'=$1", [String(calendarActivity.id)])).rows[0].count), 1, "accepted provider effect must create one timeline outbox event");
      assert.equal(Number((await pool.query("select count(*) count from sales_activities")).rows[0].count), 2, "provider success must complete the scheduled Activity in place");

      const takeoverActivity = (await pool.query("insert into sales_activities(application_id,environment,owner_id,team_id,created_by,updated_by,audit,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type,revision) values ($1,$2,'actor-a','team:actor-a','actor-a','actor-a','[]','scheduled','email','Crash takeover','actor-a',now(), '17','sales.contact',1) returning id", [applicationId, environment])).rows[0];
      const takeover = await transactionRequest(pool, "tx-provider-takeover", async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: "p136-provider-crash-takeover", relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: "Crash takeover", body: "One effect", activityId: takeoverActivity.id, expectedRevision: 1 } }));
      await pool.query("update sales_provider_operations set state='running',worker_generation_id='crashed-generation',worker_fencing_token=1,worker_promotion_revision=1,worker_lease_owner='crashed-worker' where operation_id=$1", [takeover.operationId]);
      const restartedAdapter = createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted", K_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE: "calendar-token-not-persisted" });
      assert.equal(await processGeneratedSalesCommunications(pool, current, restartedAdapter, generatedTransport), 1, "current generation must reclaim a stale running claim after worker crash");
      assert.deepEqual((await pool.query("select state,attempt,worker_generation_id from sales_provider_operations where operation_id=$1", [takeover.operationId])).rows, [{ state: "accepted", attempt: 0, worker_generation_id: null }]);
      assert.equal(observed.length, 2, "restarted worker uses same bounded host adapter path");
      assert.deepEqual((await pool.query("select status,revision from sales_activities where id=$1", [takeoverActivity.id])).rows, [{ status: "completed", revision: 2 }]);
      await new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
    }
  });
});

test("P13.6 absent or malformed provider host config dead-letters communications without blocking reminders", { timeout: 180_000 }, async () => {
  await database("p13_6_provider_host_config", async (pool) => {
    const { GeneratedSalesCommunicationStore, createGeneratedBoundedReferenceProviderTransport, createGeneratedEnvironmentProviderSecretResolver, processGeneratedSalesCommunications, processGeneratedSalesReminders } = await import("../dist/src/k-nex-sales-communications.js");
    await createWorkerPrerequisites(pool);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    const resolver = createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted" });
    const invalidEndpoints = [["absent", undefined], ["empty", ""], ["malformed", "not a provider URL"], ["non-loopback", "https://attacker.example/k-nex/reference-provider"]];
    for (const [label, endpoint] of invalidEndpoints) {
      const activity = await workerActivity(pool, `Host config ${label}`);
      const operation = await transactionRequest(pool, `tx-p136-provider-host-${label}`, async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: `p136-provider-host-${label}`, relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: `Host config ${label}`, body: "Must fail closed", activityId: activity.id, expectedRevision: 1 } }));
      const reminderKey = `p136-reminder-host-${label}`;
      const reminder = (await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit) values($1,$2,'recipient-a','task',$3,$4,'2000-01-01T00:00:00.000Z','scheduled',1,0,$5,jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId','seed','applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','scheduled','occurredAt','2000-01-01T00:00:00.000Z','actorId','recipient-a','revision',1,'idempotencyKey',$6::text))) returning id", [applicationId, environment, label, `Reminder ${label}`, `sha256:${createHash("sha256").update(reminderKey).digest("hex")}`, reminderKey])).rows[0];
      let transport;
      assert.doesNotThrow(() => { transport = createGeneratedBoundedReferenceProviderTransport(endpoint); }, `${label} config must not crash worker construction`);
      assert.equal(await processGeneratedSalesReminders(pool, current), 1, `${label} config must not block the reminder lane`);
      assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, transport), 1, `${label} config must durably process queued communications`);
      assert.deepEqual((await pool.query("select state,revision from sales_reminders where id=$1", [reminder.id])).rows, [{ state: "delivered", revision: 2 }]);
      assert.deepEqual((await pool.query("select state,attempt,failure_code,worker_generation_id from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "dead-letter", attempt: 1, failure_code: "HOST_INVARIANT", worker_generation_id: null }]);
      assert.deepEqual((await pool.query("select status,revision from sales_activities where id=$1", [activity.id])).rows, [{ status: "scheduled", revision: 1 }], "invalid host config must cause no external provider success state");
    }
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where subject like 'Reminder %'")).rows[0].count), invalidEndpoints.length, "every reminder must create its recipient notification");
  });
});

test("P13.6 reminder delivery stays atomic and generation-fenced", { timeout: 180_000 }, async () => {
  await database("p13_6_reminder_delivery", async (pool) => {
    const { processGeneratedSalesReminders } = await import("../dist/src/k-nex-sales-communications.js");
    await pool.query("create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment))");
    await pool.query("insert into runtime_worker_generation_fences values ($1,$2,'sales-generation-2',2,'worker-2',now()+interval '1 hour',2)", [applicationId, environment]);
    // Action lifecycle coverage uses the registered HTTP path in Chromium. This focused worker proof seeds only its accepted precondition.
    const seedReminder = async (key, subject = "Durable follow-up") => {
      const digest = `sha256:${createHash("sha256").update(key).digest("hex")}`;
      const inserted = await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit) values($1,$2,'recipient-a','task','44',$3,'2000-01-01T00:00:00.000Z','scheduled',1,0,$4,jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId','seed','applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','scheduled','occurredAt','2000-01-01T00:00:00.000Z','actorId','recipient-a','revision',1,'idempotencyKey',$5::text))) returning id,state", [applicationId, environment, subject, digest, key]);
      return { reminderId: String(inserted.rows[0].id), state: inserted.rows[0].state };
    };
    const first = await seedReminder("p136-reminder-idempotency");

    const stale = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
    assert.equal(await processGeneratedSalesReminders(pool, stale), 0);
    const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    assert.equal(await processGeneratedSalesReminders(pool, current), 1); assert.equal(await processGeneratedSalesReminders(pool, current), 0);
    assert.deepEqual((await pool.query("select recipient_id,state,revision from sales_reminders where id=$1", [first.reminderId])).rows, [{ recipient_id: "recipient-a", state: "delivered", revision: 2 }]);
    const notification = (await pool.query("select id,recipient_id,state,revision from sales_notifications where reference_kind='task' and reference_id='44'")).rows[0];
    assert.deepEqual({ recipient_id: notification.recipient_id, state: notification.state, revision: notification.revision }, { recipient_id: "recipient-a", state: "unread", revision: 1 });
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type in ('sales.event.reminder-changed','sales.event.notification-changed')")).rows[0].count), 2, "delivery and notification must converge through one event each");

    const collision = await seedReminder("p136-reminder-outbox-collision", "Outbox collision");
    const collisionReminderEventId = `sales-reminder-delivered-${collision.reminderId}`;
    await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values ($1,'sales.event.reminder-changed',1,'durable-integration',now(),$2,'module.sales','collision-seed','user','collision-correlation','collision-causation','collision-idempotency','{\"collision\":true}'::jsonb,'pending',now()+interval '30 days')", [collisionReminderEventId, applicationId]);
    const reminderCollisionBefore = (await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [collisionReminderEventId])).rows;
    const reminderOutboxCountBefore = Number((await pool.query("select count(*) count from k_nex_outbox")).rows[0].count);
    assert.equal(await processGeneratedSalesReminders(pool, current), 0, "one colliding reminder must not count as delivered");
    assert.deepEqual((await pool.query("select state,revision,attempt,delivered_at from sales_reminders where id=$1", [collision.reminderId])).rows, [{ state: "scheduled", revision: 1, attempt: 1, delivered_at: null }], "reminder outbox collision must roll back delivery state");
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where subject='Outbox collision'")).rows[0].count), 0, "reminder outbox collision must roll back notification creation");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox")).rows[0].count), reminderOutboxCountBefore, "reminder outbox collision must not leave either delivery event");
    assert.deepEqual((await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [collisionReminderEventId])).rows, reminderCollisionBefore, "preexisting reminder outbox collision must remain unchanged");

    const failed = await seedReminder("p136-reminder-atomic-failure", "Atomic failure");
    await pool.query("alter table sales_notifications add constraint p136_notification_insert_failure check(subject <> 'Atomic failure')");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assert.equal(await processGeneratedSalesReminders(pool, current), 0, "notification insertion failure must not count as delivered");
      const row = (await pool.query("select state,revision,attempt,failure_reason,dead_letter_reference from sales_reminders where id=$1", [failed.reminderId])).rows[0];
      assert.equal(row.attempt, attempt); assert.equal(row.state, attempt < 3 ? "scheduled" : "failed"); assert.equal(row.revision, attempt < 3 ? 1 : 2);
      assert.equal(row.failure_reason, attempt < 3 ? null : "REMINDER_DELIVERY_FAILED"); assert.equal(row.dead_letter_reference, attempt < 3 ? null : `sales-reminder-dead-letter-${failed.reminderId}`);
      assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_kind='task' and reference_id='44' and subject='Atomic failure'")).rows[0].count), 0, "failed notification insert must roll reminder delivery back atomically");
      if (attempt < 3) assert.equal((await pool.query("select delivered_at from sales_reminders where id=$1", [failed.reminderId])).rows[0].delivered_at, null);
    }
  });
});

test("P13.6 provider admission linearizes promotion and revocation, while stale workers produce no effects", { timeout: 180_000 }, async () => {
  await database("p13_6_worker_races", async (pool) => {
    const { GeneratedSalesCommunicationStore, processGeneratedSalesCommunications, createGeneratedEnvironmentProviderSecretResolver } = await import("../dist/src/k-nex-sales-communications.js");
    await createWorkerPrerequisites(pool);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const dispatch = async (key, activityId) => await transactionRequest(pool, `tx-race-${key}`, async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: key, relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: key, body: "Race proof", activityId, expectedRevision: 1 } }));
    const resolver = createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted" });
    const stale = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
    const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };

    const recoveryActivity = await workerActivity(pool, "Current generation recovery");
    const recovery = await dispatch("p136-worker-race-recovery", recoveryActivity.id);
    const staleKeys = [];
    const staleTransport = admittedTransport({ async invoke(input) { staleKeys.push(input.idempotencyKey); } });
    assert.equal(await processGeneratedSalesCommunications(pool, stale, resolver, staleTransport), 0, "stale generation must not claim a queued operation");
    assert.deepEqual(staleKeys, [], "stale generation must not invoke the provider");
    const observedKeys = [];
    const externallyIdempotent = admittedTransport({ async invoke(input) { observedKeys.push(input.idempotencyKey); } });
    assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, externallyIdempotent), 1);
    assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, externallyIdempotent), 0, "accepted operation replay must not invoke the provider again");
    assert.deepEqual(observedKeys, [recovery.receipt.idempotencyDigest]);
    assert.deepEqual((await pool.query("select state,attempt from sales_provider_operations where operation_id=$1", [recovery.operationId])).rows, [{ state: "accepted", attempt: 0 }]);

    const barrierActivity = await workerActivity(pool, "Promotion and revocation barrier");
    const barrierOperation = await dispatch("p136-worker-race-barrier", barrierActivity.id);
    let invokeStartedResolve;
    let releaseInvoke;
    const invokeStarted = new Promise((resolve) => { invokeStartedResolve = resolve; });
    const invokeRelease = new Promise((resolve) => { releaseInvoke = resolve; });
    const barrierTransport = admittedTransport({ async invoke(input) { invokeStartedResolve(input); await invokeRelease; observedKeys.push(input.idempotencyKey); } });
    const processing = processGeneratedSalesCommunications(pool, current, resolver, barrierTransport);
    await invokeStarted;
    let updatesFinished = false;
    const promotionAndRevocation = Promise.all([
      pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-3',fencing_token=3,lease_owner='worker-3',promotion_revision=3 where application_id=$1 and environment=$2", [applicationId, environment]),
      pool.query("update sales_provider_configurations set state='revoked',revoked_at=now(),revision=revision+1 where application_id=$1 and environment=$2 and provider_id=$3", [applicationId, environment, emailProvider])
    ]).finally(() => { updatesFinished = true; });
    await delay(50);
    // The effect no longer runs inside the fence transaction, so an operator can
    // promote and revoke while a bounded provider call is still in flight.
    await promotionAndRevocation;
    assert.equal(updatesFinished, true, "promotion and revocation must not queue behind an in-flight provider effect");
    releaseInvoke();
    await processing;
    const fenced = (await pool.query("select state,attempt,provider_receipt_id,effect_dispatched_at from sales_provider_operations where operation_id=$1", [barrierOperation.operationId])).rows;
    assert.equal(fenced.length, 1); assert.equal(fenced[0].state, "running", "a promoted-out worker leaves its claim reclaimable rather than terminal");
    assert.match(String(fenced[0].provider_receipt_id), /^reference-receipt-[0-9a-f]{32}$/u, "the effect the provider already accepted survives as an opaque receipt");
    assert.notEqual(fenced[0].effect_dispatched_at, null);
    assert.deepEqual((await pool.query("select status,revision from sales_activities where id=$1", [barrierActivity.id])).rows, [{ status: "scheduled", revision: 1 }], "a promoted-out worker writes no local domain transition");
    assert.deepEqual((await pool.query("select active_execution_generation,fencing_token,promotion_revision from runtime_worker_generation_fences where application_id=$1 and environment=$2", [applicationId, environment])).rows, [{ active_execution_generation: "sales-generation-3", fencing_token: "3", promotion_revision: 3 }]);
    assert.deepEqual((await pool.query("select state,revision from sales_provider_configurations where application_id=$1 and environment=$2 and provider_id=$3", [applicationId, environment, emailProvider])).rows, [{ state: "revoked", revision: 2 }]);
    const beforeStaleRetry = observedKeys.length;
    assert.equal(await processGeneratedSalesCommunications(pool, stale, resolver, staleTransport), 0);
    assert.equal(observedKeys.length, beforeStaleRetry, "a stale worker remains unable to create a provider effect after promotion");
    const promoted = { applicationId, environment, activeExecutionGeneration: "sales-generation-3", fencingToken: 3, leaseOwner: "worker-3", promotionRevision: 3 };
    assert.equal(await processGeneratedSalesCommunications(pool, promoted, resolver, barrierTransport), 1, "the promoted generation reclaims the in-flight claim");
    assert.equal(observedKeys.length, beforeStaleRetry, "a reclaimed operation whose receipt is durable is never sent a second time");
    assert.deepEqual((await pool.query("select state,failure_code,provider_receipt_id is not null has_receipt from sales_provider_operations where operation_id=$1", [barrierOperation.operationId])).rows, [{ state: "dead-letter", failure_code: "PROVIDER_REVOKED", has_receipt: true }], "a revoked configuration stops the reclaim without pretending the effect never happened");
  });
});

test("P13.6 provider receipt and timeline-outbox collisions roll back completion state", { timeout: 180_000 }, async () => {
  await database("p13_6_provider_collisions", async (pool) => {
    const { GeneratedSalesCommunicationStore, processGeneratedSalesCommunications, createGeneratedEnvironmentProviderSecretResolver } = await import("../dist/src/k-nex-sales-communications.js");
    await createWorkerPrerequisites(pool);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const dispatch = async (key, activityId) => await transactionRequest(pool, `tx-collision-${key}`, async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: key, relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: key, body: "Collision proof", activityId, expectedRevision: 1 } }));
    const resolver = createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted" });
    const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    const transport = admittedTransport({ async invoke() {} });

    const receiptTarget = await workerActivity(pool, "Receipt collision target");
    const receiptOperation = await dispatch("p136-provider-receipt-collision", receiptTarget.id);
    const receiptOtherActivity = await workerActivity(pool, "Receipt collision preexisting receipt");
    const fakeReceiptDigest = `sha256:${"a".repeat(64)}`;
    await pool.query("insert into sales_provider_activity_receipts(operation_id,activity_id,receipt_digest,provider_receipt_id) values ($1,$2,$3,'reference-receipt-collision-seed')", [receiptOperation.operationId, receiptOtherActivity.id, fakeReceiptDigest]);
    assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, transport), 1);
    assert.deepEqual((await pool.query("select status,revision,occurred_at,provider_metadata from sales_activities where id=$1", [receiptTarget.id])).rows, [{ status: "scheduled", revision: 1, occurred_at: null, provider_metadata: null }], "receipt collision must roll back Activity completion");
    assert.deepEqual((await pool.query("select operation_id,activity_id,receipt_digest from sales_provider_activity_receipts where operation_id=$1", [receiptOperation.operationId])).rows, [{ operation_id: receiptOperation.operationId, activity_id: receiptOtherActivity.id, receipt_digest: fakeReceiptDigest }], "preexisting receipt must remain unchanged");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.timeline-changed' and payload->>'resourceId'=$1", [String(receiptTarget.id)])).rows[0].count), 0, "receipt collision must not emit a timeline event");
    assert.deepEqual((await pool.query("select state,failure_code from sales_provider_operations where operation_id=$1", [receiptOperation.operationId])).rows, [{ state: "dead-letter", failure_code: "PROVIDER_EFFECT_UNRECONCILED" }]);

    const outboxTarget = await workerActivity(pool, "Timeline outbox collision target");
    const outboxOperation = await dispatch("p136-provider-outbox-collision", outboxTarget.id);
    const collisionEventId = `sales-provider-activity-${outboxOperation.operationId}`;
    await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values ($1,'sales.event.timeline-changed',1,'durable-integration',now(),$2,'module.sales','collision-seed','user','collision-correlation','collision-causation','collision-idempotency','{\"collision\":true}'::jsonb,'pending',now()+interval '30 days')", [collisionEventId, applicationId]);
    const collisionBefore = (await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [collisionEventId])).rows;
    assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, transport), 1);
    assert.deepEqual((await pool.query("select status,revision,occurred_at,provider_metadata from sales_activities where id=$1", [outboxTarget.id])).rows, [{ status: "scheduled", revision: 1, occurred_at: null, provider_metadata: null }], "outbox collision must roll back Activity completion");
    assert.equal(Number((await pool.query("select count(*) count from sales_provider_activity_receipts where operation_id=$1", [outboxOperation.operationId])).rows[0].count), 0, "outbox collision must roll back the provider receipt");
    assert.deepEqual((await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [collisionEventId])).rows, collisionBefore, "outbox collision row must remain unchanged");
    assert.deepEqual((await pool.query("select state,failure_code from sales_provider_operations where operation_id=$1", [outboxOperation.operationId])).rows, [{ state: "dead-letter", failure_code: "PROVIDER_EFFECT_UNRECONCILED" }]);
  });
});

test("P13.6 provider effect is externally idempotent across a spawned worker restart", { timeout: 180_000 }, async () => {
  await database("p13_6_worker_restart", async (pool, connectionString) => {
    const { GeneratedSalesCommunicationStore } = await import("../dist/src/k-nex-sales-communications.js");
    await createWorkerPrerequisites(pool);
    await pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-1',fencing_token=1,lease_owner='worker-1',promotion_revision=1 where application_id=$1 and environment=$2", [applicationId, environment]);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const activity = await workerActivity(pool, "Spawned worker restart");
    const operation = await transactionRequest(pool, "tx-spawned-worker-restart", async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: "p136-spawned-worker-restart", relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: "Spawned worker restart", body: "One external effect", activityId: activity.id, expectedRevision: 1 } }));

    const effects = [];
    const reconciliations = [];
    const externalEffectKeys = new Set();
    let firstRequestResolve;
    let releaseFirstRequest;
    const firstRequest = new Promise((resolve) => { firstRequestResolve = resolve; });
    const firstResponseRelease = new Promise((resolve) => { releaseFirstRequest = resolve; });
    // The reference provider commits the effect and then loses its response to a
    // killed worker, which is the only case a receipt lookup has to survive.
    const provider = createServer(async (request, response) => {
      assert.equal(request.url, "/k-nex/reference-provider");
      assert.equal(request.headers["x-k-nex-provider"], emailProvider);
      assert.equal(request.headers.authorization, "Bearer email-token-not-persisted");
      const key = request.headers["idempotency-key"];
      assert.equal(typeof key, "string");
      request.resume();
      const answer = (status, body) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      const receiptId = `reference-receipt-${createHash("sha256").update(String(key)).digest("hex").slice(0, 32)}`;
      if (request.headers["x-k-nex-reconcile"] === "1") {
        reconciliations.push(key);
        if (!externalEffectKeys.has(key)) { response.writeHead(404).end(); return; }
        answer(200, { providerReceiptId: receiptId, idempotencyKey: key, duplicate: true });
        return;
      }
      effects.push(key);
      const duplicate = externalEffectKeys.has(key);
      externalEffectKeys.add(key);
      if (effects.length === 1) { firstRequestResolve(); await firstResponseRelease; }
      answer(202, { providerReceiptId: receiptId, idempotencyKey: key, duplicate });
    });
    await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    assert.ok(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}/k-nex/reference-provider`;
    const firstFence = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
    const firstWorker = spawnCommunicationWorker(connectionString, endpoint, firstFence);
    let firstStdout = ""; let firstStderr = "";
    firstWorker.stdout.on("data", (chunk) => { firstStdout += chunk; }); firstWorker.stderr.on("data", (chunk) => { firstStderr += chunk; });
    await firstRequest;
    let promotionFinished = false;
    const promotion = pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-2',fencing_token=2,lease_owner='worker-2',promotion_revision=2 where application_id=$1 and environment=$2", [applicationId, environment]).finally(() => { promotionFinished = true; });
    await delay(50);
    await promotion;
    assert.equal(promotionFinished, true, "promotion must not wait on a worker that is inside a bounded provider call");
    firstWorker.kill("SIGKILL");
    const firstExit = await childExit(firstWorker);
    assert.equal(firstExit.signal, "SIGKILL", `first worker unexpectedly completed: ${firstStdout}${firstStderr}`);
    releaseFirstRequest();
    assert.deepEqual((await pool.query("select state,worker_generation_id,worker_fencing_token,provider_receipt_id,effect_dispatched_at is not null dispatched from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "running", worker_generation_id: "sales-generation-1", worker_fencing_token: "1", provider_receipt_id: null, dispatched: true }], "a killed worker leaves a dispatch marker and no receipt, which is exactly the response-loss case");

    const currentFence = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    const secondWorker = spawnCommunicationWorker(connectionString, endpoint, currentFence);
    let secondStdout = ""; let secondStderr = "";
    secondWorker.stdout.on("data", (chunk) => { secondStdout += chunk; }); secondWorker.stderr.on("data", (chunk) => { secondStderr += chunk; });
    const secondExit = await childExit(secondWorker);
    assert.equal(secondExit.code, 0, `restarted worker failed: ${secondStdout}${secondStderr}`);
    assert.deepEqual(effects, [operation.receipt.idempotencyDigest], "the restarted worker must not send a second message for a dispatch that may already have landed");
    assert.deepEqual(reconciliations, [operation.receipt.idempotencyDigest], "the restarted worker resolves the lost response by receipt lookup");
    assert.equal(externalEffectKeys.size, 1, "exactly one external effect exists for this idempotency key");
    assert.deepEqual((await pool.query("select state,attempt,worker_generation_id,provider_receipt_id is not null has_receipt from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "accepted", attempt: 0, worker_generation_id: null, has_receipt: true }]);
    assert.deepEqual((await pool.query("select status,revision from sales_activities where id=$1", [activity.id])).rows, [{ status: "completed", revision: 2 }]);
    await new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  });
});

test("P13.6 promoted provider work rejects stale claims, retries a current failure, and recovers once", { timeout: 180_000 }, async () => {
  await database("p13_6_promoted_provider_recovery", async (pool) => {
    const { GeneratedSalesCommunicationStore, createGeneratedEnvironmentProviderSecretResolver, processGeneratedSalesCommunications } = await import("../dist/src/k-nex-sales-communications.js");
    await createWorkerPrerequisites(pool);
    await pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-1',fencing_token=1,lease_owner='worker-1',promotion_revision=1 where application_id=$1 and environment=$2", [applicationId, environment]);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const activity = await workerActivity(pool, "Promotion recovery");
    const operation = await transactionRequest(pool, "tx-p136-promoted-provider-recovery", async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: "p136-promoted-provider-recovery", relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: "Promotion recovery", body: "Exactly one current effect", activityId: activity.id, expectedRevision: 1 } }));
    await pool.query("update sales_provider_operations set state='running',worker_generation_id='sales-generation-1',worker_fencing_token=1,worker_promotion_revision=1,worker_lease_owner='worker-1' where operation_id=$1", [operation.operationId]);
    await pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-2',fencing_token=2,lease_owner='worker-2',promotion_revision=2 where application_id=$1 and environment=$2", [applicationId, environment]);

    const resolver = createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted" });
    const stale = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
    const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    const staleEffects = [];
    assert.equal(await processGeneratedSalesCommunications(pool, stale, resolver, admittedTransport({ async invoke(input) { staleEffects.push(input.idempotencyKey); } })), 0, "promoted-out worker cannot reclaim a stale running operation");
    assert.deepEqual(staleEffects, [], "stale provider worker must have zero external effects");

    assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, admittedTransport({ async invoke() { throw new Error("current worker transient outage"); } })), 1, "current worker alone reclaims stale work");
    assert.deepEqual((await pool.query("select state,attempt,failure_code,worker_generation_id from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "queued", attempt: 1, failure_code: "PROVIDER_OUTAGE", worker_generation_id: null }], "current failed attempt remains retryable without stale ownership");
    await pool.query("update sales_provider_operations set next_attempt_at=now() where operation_id=$1", [operation.operationId]);
    const currentEffects = [];
    assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, admittedTransport({ async invoke(input) { currentEffects.push(input.idempotencyKey); } })), 1);
    assert.deepEqual(currentEffects, [operation.receipt.idempotencyDigest], "recovery emits exactly one current-generation effect key");
    assert.deepEqual((await pool.query("select state,attempt,worker_generation_id from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "accepted", attempt: 1, worker_generation_id: null }]);
  });
});

test("P13.6 provider claim holds its exact fence through promotion arbitration", { timeout: 180_000 }, async () => {
  await database("p13_6_provider_claim_promotion", async (pool) => {
    const { GeneratedSalesCommunicationStore, createGeneratedEnvironmentProviderSecretResolver, processGeneratedSalesCommunications } = await import("../dist/src/k-nex-sales-communications.js");
    await createWorkerPrerequisites(pool);
    await pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-1',fencing_token=1,lease_owner='worker-1',promotion_revision=1 where application_id=$1 and environment=$2", [applicationId, environment]);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,'secret-ref:v1:email-reference:provider-api:default','secret-ref:v1:email-reference:webhook-signature:default','administrator')", [applicationId, environment, emailProvider]);
    const activity = await workerActivity(pool, "Claim/promotion arbitration");
    const operation = await transactionRequest(pool, "tx-p136-provider-claim-promotion", async (request) => await new GeneratedSalesCommunicationStore(request, authority("actor-a", ["sales.communications.email.send"])).dispatch({ actionId: "sales.email.send", idempotencyKey: "p136-provider-claim-promotion", relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject: "Claim/promotion arbitration", body: "No stale side effect", activityId: activity.id, expectedRevision: 1 } }));
    await pool.query("create function public.p136_provider_claim_barrier() returns trigger language plpgsql as $$ begin perform pg_advisory_lock(13,61); perform pg_sleep(0.25); perform pg_advisory_unlock(13,61); return new; end; $$; create trigger p136_provider_claim_barrier before update of worker_generation_id on sales_provider_operations for each row when (old.state='queued' and new.state='running') execute function public.p136_provider_claim_barrier()");
    const oldFence = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
    const effects = [];
    const processing = processGeneratedSalesCommunications(pool, oldFence, createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted" }), admittedTransport({ async invoke(input) { effects.push(input.idempotencyKey); } }));
    let claimAtBarrier = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const probe = (await pool.query("select pg_try_advisory_lock(13,61) acquired")).rows[0];
      if (probe?.acquired === false) { claimAtBarrier = true; break; }
      await pool.query("select pg_advisory_unlock(13,61)");
      await delay(5);
    }
    assert.equal(claimAtBarrier, true, "claim barrier must be reached after the exact fence lock and before operation fields change");
    let promoted = false;
    const promotion = pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-2',fencing_token=2,lease_owner='worker-2',promotion_revision=2 where application_id=$1 and environment=$2", [applicationId, environment]).finally(() => { promoted = true; });
    await delay(50);
    assert.equal(promoted, false, "promotion cannot pass while the old generation holds the claim transaction's exact fence lock");
    assert.equal(await processing, 1, "claim transaction commits before the queued promotion arbitrates the next worker step");
    await promotion;
    assert.deepEqual(effects, [], "after promotion wins, old generation emits zero provider effects");
    assert.deepEqual((await pool.query("select state,worker_generation_id,worker_fencing_token from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "running", worker_generation_id: "sales-generation-1", worker_fencing_token: "1" }], "claim committed before promotion leaves a fenced, reclaimable old-generation claim");
    const currentFence = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    const currentEffects = [];
    assert.equal(await processGeneratedSalesCommunications(pool, currentFence, createGeneratedEnvironmentProviderSecretResolver({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "email-token-not-persisted" }), admittedTransport({ async invoke(input) { currentEffects.push(input.idempotencyKey); } })), 1, "new generation reclaims the old fenced claim");
    assert.deepEqual(currentEffects, [operation.receipt.idempotencyDigest]);
    assert.deepEqual((await pool.query("select state,worker_generation_id,worker_fencing_token from sales_provider_operations where operation_id=$1", [operation.operationId])).rows, [{ state: "accepted", worker_generation_id: null, worker_fencing_token: null }]);
  });
});

test("P13.6 reminder delivery linearizes promotion; stale worker has zero effects and current worker recovers", { timeout: 180_000 }, async () => {
  await database("p13_6_reminder_promotion", async (pool) => {
    const { processGeneratedSalesReminders } = await import("../dist/src/k-nex-sales-communications.js");
    await pool.query("create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment))");
    await pool.query("insert into runtime_worker_generation_fences values ($1,$2,'sales-generation-1',1,'worker-1',now()+interval '1 hour',1)", [applicationId, environment]);
    const reminder = (await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit) values($1,$2,'recipient-a','task','promotion','Promotion reminder','2000-01-01T00:00:00.000Z','scheduled',1,0,$3,jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId','seed','applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','scheduled','occurredAt','2000-01-01T00:00:00.000Z','actorId','recipient-a','revision',1,'idempotencyKey','p136-reminder-promotion'))) returning id", [applicationId, environment, `sha256:${"6".repeat(64)}`])).rows[0];
    await pool.query("create function public.p136_reminder_delivery_barrier() returns trigger language plpgsql as $$ begin perform pg_advisory_lock(13,6); perform pg_sleep(0.25); perform pg_advisory_unlock(13,6); return new; end; $$; create trigger p136_reminder_delivery_barrier before update of state on sales_reminders for each row when (new.state='delivered') execute function public.p136_reminder_delivery_barrier()");
      const stale = { applicationId, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 };
      const processing = processGeneratedSalesReminders(pool, stale);
      let deliveryAdmitted = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const probe = (await pool.query("select pg_try_advisory_lock(13,6) acquired")).rows[0];
        if (probe?.acquired === false) { deliveryAdmitted = true; break; }
        await pool.query("select pg_advisory_unlock(13,6)");
        await delay(5);
      }
      assert.equal(deliveryAdmitted, true, "delivery must reach its pre-commit barrier before promotion starts");
      let promoted = false;
      const promotion = pool.query("update runtime_worker_generation_fences set active_execution_generation='sales-generation-2',fencing_token=2,lease_owner='worker-2',promotion_revision=2 where application_id=$1 and environment=$2", [applicationId, environment]).finally(() => { promoted = true; });
      await delay(50);
      assert.equal(promoted, false, "promotion must wait while stale generation has admitted a reminder delivery");
      assert.equal(await processing, 1);
      await promotion;
      assert.deepEqual((await pool.query("select state,revision from sales_reminders where id=$1", [reminder.id])).rows, [{ state: "delivered", revision: 2 }], "pre-promotion delivery linearizes before fence change");
      const staleEffectsBefore = Number((await pool.query("select count(*) count from sales_notifications where reference_id='promotion'")).rows[0].count);
      assert.equal(await processGeneratedSalesReminders(pool, stale), 0, "promoted-out reminder worker cannot produce another effect");
      assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='promotion'")).rows[0].count), staleEffectsBefore, "stale reminder worker produces zero additional notifications");

      const recovery = (await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit) values($1,$2,'recipient-a','task','recovery','Current reminder recovery','2000-01-01T00:00:00.000Z','scheduled',1,0,$3,jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId','seed','applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','scheduled','occurredAt','2000-01-01T00:00:00.000Z','actorId','recipient-a','revision',1,'idempotencyKey','p136-reminder-recovery'))) returning id", [applicationId, environment, `sha256:${"7".repeat(64)}`])).rows[0];
      const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
      assert.equal(await processGeneratedSalesReminders(pool, current), 1, "current generation recovers later scheduled reminder");
    assert.deepEqual((await pool.query("select state,revision from sales_reminders where id=$1", [recovery.id])).rows, [{ state: "delivered", revision: 2 }]);
  });
});

test("P13.6 terminal reminder-failure outbox collision rolls back state, audit, and attempts", { timeout: 180_000 }, async () => {
  await database("p13_6_reminder_terminal_collision", async (pool) => {
    const { processGeneratedSalesReminders } = await import("../dist/src/k-nex-sales-communications.js");
    await pool.query("create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment))");
    await pool.query("insert into runtime_worker_generation_fences values ($1,$2,'sales-generation-2',2,'worker-2',now()+interval '1 hour',2)", [applicationId, environment]);
    const reminder = (await pool.query("insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit) values($1,$2,'recipient-a','task','terminal','Terminal collision','2000-01-01T00:00:00.000Z','scheduled',1,2,$3,jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId','seed','applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','scheduled','occurredAt','2000-01-01T00:00:00.000Z','actorId','recipient-a','revision',1,'idempotencyKey','p136-reminder-terminal-collision'))) returning id,audit", [applicationId, environment, `sha256:${"8".repeat(64)}`])).rows[0];
    const failureEventId = `sales-reminder-failed-${reminder.id}`;
    await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values ($1,'sales.event.reminder-changed',1,'durable-integration',now(),$2,'module.sales','collision-seed','user','collision-correlation','collision-causation','collision-idempotency','{\"collision\":true}'::jsonb,'pending',now()+interval '30 days')", [failureEventId, applicationId]);
    const outboxBefore = (await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [failureEventId])).rows;
    await pool.query("alter table sales_notifications add constraint p136_terminal_notification_failure check(subject <> 'Terminal collision')");
    const current = { applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 };
    assert.equal(await processGeneratedSalesReminders(pool, current), 0);
    assert.deepEqual((await pool.query("select state,revision,attempt,audit,failure_reason,dead_letter_reference from sales_reminders where id=$1", [reminder.id])).rows, [{ state: "scheduled", revision: 1, attempt: 2, audit: reminder.audit, failure_reason: null, dead_letter_reference: null }], "terminal failure must not mutate reminder if its durable event collides");
    assert.deepEqual((await pool.query("select event_id,event_type,payload,status from k_nex_outbox where event_id=$1", [failureEventId])).rows, outboxBefore, "pre-existing terminal failure event remains immutable");
  });
});

test("P13.6 provider configuration audit is canonical across absent, active, revoked, and active", { timeout: 180_000 }, async () => {
  await database("p13_6_configuration_audit", async (pool) => {
    const { GeneratedSalesCommunicationStore } = await import("../dist/src/k-nex-sales-communications.js");
    const configure = async (idempotencyKey, expectedRevision, operation) => await transactionRequest(pool, `tx-${idempotencyKey}`, async (request) => await new GeneratedSalesCommunicationStore(request, authority("administrator", ["sales.settings.write"])).dispatch({ actionId: "sales.integration.configure", idempotencyKey, relatedRecord: null, payload: { providerId: emailProvider, expectedRevision, operation } }));
    const activated = await configure("p136-config-audit-active", 0, "activate");
    const revoked = await configure("p136-config-audit-revoked", 1, "revoke");
    const reactivated = await configure("p136-config-audit-reactivated", 2, "activate");
    assert.deepEqual((await pool.query("select revision,audit_data->>'actionId' action_id,audit_data->>'resourceId' resource_id,audit_data->>'fromState' from_state,audit_data->>'toState' to_state,audit_data->>'actorId' actor_id,audit_data->>'revision' audit_revision,audit_data->>'idempotencyKey' idempotency_key from sales_provider_configuration_audit where application_id=$1 and environment=$2 and provider_id=$3 order by revision", [applicationId, environment, emailProvider])).rows, [
      { revision: 1, action_id: "sales.integration.configure", resource_id: emailProvider, from_state: "absent", to_state: "active", actor_id: "administrator", audit_revision: "1", idempotency_key: activated.receipt.idempotencyDigest },
      { revision: 2, action_id: "sales.integration.configure", resource_id: emailProvider, from_state: "active", to_state: "revoked", actor_id: "administrator", audit_revision: "2", idempotency_key: revoked.receipt.idempotencyDigest },
      { revision: 3, action_id: "sales.integration.configure", resource_id: emailProvider, from_state: "revoked", to_state: "active", actor_id: "administrator", audit_revision: "3", idempotency_key: reactivated.receipt.idempotencyDigest }
    ]);
    assert.deepEqual((await pool.query("select state,revision,revoked_at is null revoked_at_is_null from sales_provider_configurations where application_id=$1 and environment=$2 and provider_id=$3", [applicationId, environment, emailProvider])).rows, [{ state: "active", revision: 3, revoked_at_is_null: true }]);
  });
});
