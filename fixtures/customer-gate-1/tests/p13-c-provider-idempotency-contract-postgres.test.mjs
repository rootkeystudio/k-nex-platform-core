import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up } from "../dist/src/migrations/20260908_000032_communications.js";
import { startReferenceProvider } from "./p13-3-generated-crm-fixture.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "p13-c-provider-contract";
const environment = "production";
const emailProvider = "email.reference.v1";
const apiReference = "secret-ref:v1:email-reference:provider-api:default";
const webhookReference = "secret-ref:v1:email-reference:webhook-signature:default";
const slots = Object.freeze({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "outbound-credential", K_NEX_WEBHOOK_SECRET_EMAIL_REFERENCE: "signing-key" });
const current = Object.freeze({ applicationId, environment, activeExecutionGeneration: "sales-generation-2", fencingToken: 2, leaseOwner: "worker-2", promotionRevision: 2 });
const authority = Object.freeze({ context: Object.freeze({ applicationId, environment, actorId: "actor-a" }), authorizationRevision: 7, lifecycleRevision: 3, scopeRevision: 11, permissionGrants: Object.freeze(["sales.communications.email.send"]) });

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function communicationsDatabase(name, run) {
  const container = await new PostgreSqlContainer(image).withDatabase(name).withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`create table sales_activities(
      id serial primary key, application_id text, environment text, owner_id text, team_id text, created_by text, updated_by text,
      audit jsonb, status text, type text, subject text, actor_id text, scheduled_at timestamptz, occurred_at timestamptz, related_record_id text,
      related_record_type text, provider_metadata jsonb, revision integer default 1, updated_at timestamptz default now()
    )`);
    await pool.query("create table payload_locked_documents_rels(id bigserial primary key)");
    await pool.query(`create table k_nex_outbox(
      id bigserial primary key,event_id varchar(128) unique not null,event_type varchar(128) not null,schema_version integer not null,message_class varchar(32) not null,
      occurred_at timestamptz not null,application_id varchar(128) not null,plugin_id varchar(128) not null,actor_id varchar(128),actor_type varchar(64),impersonator_id varchar(128),
      correlation_id varchar(128) not null,causation_id varchar(128),idempotency_key varchar(128),payload jsonb not null,status varchar(32) not null default 'pending',attempt_count integer not null default 0,available_at timestamptz not null default now(),lease_expires_at timestamptz,claimed_at timestamptz,claim_token varchar(64),checkpoint jsonb,last_error_code varchar(128),dead_lettered_at timestamptz,processed_at timestamptz,retention_until timestamptz not null,updated_at timestamptz not null default now(),created_at timestamptz not null default now()
    )`);
    await up({ db: drizzle(pool) });
    await pool.query("create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment)); create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer); create table sales_current_authority_scopes(application_id text,environment text,principal_id text,state text,revision integer,record_scope text,application_wide boolean,authorized_team_ids jsonb); create table sales_contacts(id bigint primary key,application_id text,environment text,email text,owner_id text,team_id text)");
    await pool.query("insert into runtime_worker_generation_fences values ($1,$2,'sales-generation-2',2,'worker-2',now()+interval '1 hour',2)", [applicationId, environment]);
    await pool.query("insert into k_nex_authorization_state values ($1,7,3)", [applicationId]);
    await pool.query("insert into sales_current_authority_scopes values ($1,$2,'actor-a','active',11,'owned-or-assigned-team',false,'[\"team:actor-a\"]')", [applicationId, environment]);
    await pool.query("insert into sales_contacts values (17,$1,$2,'recipient@example.test','actor-a','team:actor-a')", [applicationId, environment]);
    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,$4,$5,'administrator')", [applicationId, environment, emailProvider, apiReference, webhookReference]);
    await run(pool);
  } finally {
    await pool.end();
    await container.stop();
  }
}

async function queueSend(pool, key, subject) {
  const { GeneratedSalesCommunicationStore } = await import("../dist/src/k-nex-sales-communications.js");
  const activity = (await pool.query("insert into sales_activities(application_id,environment,owner_id,team_id,created_by,updated_by,audit,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type,revision) values ($1,$2,'actor-a','team:actor-a','actor-a','actor-a','[]','scheduled','email',$3,'actor-a',now(),'17','sales.contact',1) returning id", [applicationId, environment, subject])).rows[0];
  const session = await pool.connect();
  const transactionID = `tx-${key}`;
  try {
    await session.query("begin");
    const request = { transactionID, payload: { db: { sessions: { [transactionID]: { db: drizzle(session) } } } } };
    const queued = await new GeneratedSalesCommunicationStore(request, authority).dispatch({ actionId: "sales.email.send", idempotencyKey: key, relatedRecord: { type: "sales.contact", id: 17 }, payload: { subject, body: "Contract proof", activityId: activity.id, expectedRevision: 1 } });
    await session.query("commit");
    return { queued, activity };
  } catch (error) { await session.query("rollback"); throw error; } finally { session.release(); }
}

test("P13.C the bundled reference provider keeps a durable idempotency store across a restart", { timeout: 180_000 }, async () => {
  const { createGeneratedBoundedReferenceProviderTransport } = await import("../dist/src/k-nex-sales-communications.js");
  const first = await startReferenceProvider();
  const key = `sha256:${createHash("sha256").update("p13c-durable-store").digest("hex")}`;
  const payload = { activityId: 1, expectedRevision: 1 };
  let receipt;
  try {
    const transport = createGeneratedBoundedReferenceProviderTransport(first.endpoint);
    assert.deepEqual(transport.capability(emailProvider), { contractId: "k-nex.reference-provider.v1", version: 1, providerId: emailProvider, idempotency: "durable-key-scoped-exactly-once", idempotencyKeyFormat: "sha256-canonical-json-v1", reconciliation: "receipt-lookup-by-idempotency-key", durability: "survives-provider-restart" });
    assert.equal(await transport.reconcile({ providerId: "calendar.reference.v1", credential: "outbound-credential", idempotencyKey: key }), null, "an unknown key has no receipt to reconcile");
    receipt = await transport.invoke({ providerId: "calendar.reference.v1", credential: "outbound-credential", idempotencyKey: key, payload });
    assert.match(receipt.providerReceiptId, /^reference-receipt-[0-9a-f]{32}$/u);
    assert.equal(receipt.duplicate, false);
  } finally { await closeServer(first.server); }

  // The declared durability is the store on disk, not process memory: a brand
  // new provider process over the same store still answers the receipt lookup.
  const restarted = await startReferenceProvider(first.storeDirectory);
  try {
    const transport = createGeneratedBoundedReferenceProviderTransport(restarted.endpoint);
    const reconciled = await transport.reconcile({ providerId: "calendar.reference.v1", credential: "outbound-credential", idempotencyKey: key });
    assert.deepEqual(reconciled, { providerReceiptId: receipt.providerReceiptId, idempotencyKey: key, duplicate: true }, "a restarted provider still resolves the effect it already committed");
    const replayed = await transport.invoke({ providerId: "calendar.reference.v1", credential: "outbound-credential", idempotencyKey: key, payload });
    assert.deepEqual(replayed, { providerReceiptId: receipt.providerReceiptId, idempotencyKey: key, duplicate: true }, "the same key and body is one effect, and the provider says so");
  } finally { await closeServer(restarted.server); }
});

test("P13.C an undeclared provider capability never reaches the network", { timeout: 180_000 }, async () => {
  await communicationsDatabase("p13_c_provider_capability", async (pool) => {
    const { processGeneratedSalesCommunications, createGeneratedEnvironmentProviderSecretResolver } = await import("../dist/src/k-nex-sales-communications.js");
    const resolver = createGeneratedEnvironmentProviderSecretResolver(slots);
    const admitted = Object.freeze({ contractId: "k-nex.reference-provider.v1", version: 1, providerId: emailProvider, idempotency: "durable-key-scoped-exactly-once", idempotencyKeyFormat: "sha256-canonical-json-v1", reconciliation: "receipt-lookup-by-idempotency-key", durability: "survives-provider-restart" });
    const undeclared = [
      ["no capability at all", undefined],
      ["best-effort idempotency", { ...admitted, idempotency: "best-effort" }],
      ["no reconciliation lookup", { ...admitted, reconciliation: "none" }],
      ["memory-only durability", { ...admitted, durability: "process-lifetime" }],
      ["an unadmitted provider family", { ...admitted, contractId: "vendor.smtp.v1" }]
    ];
    for (const [index, [label, capability]] of undeclared.entries()) {
      const key = `p13c-capability-${index}-refused`;
      const effects = [];
      const { queued, activity } = await queueSend(pool, key, `Capability ${label}`);
      const transport = { invoke: async (input) => { effects.push(input.idempotencyKey); return { providerReceiptId: "should-never-be-reached", idempotencyKey: input.idempotencyKey, duplicate: false }; }, reconcile: async () => null, ...(capability === undefined ? {} : { capability: () => capability }) };
      assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, transport), 1, `${label} must still be claimed and resolved`);
      assert.deepEqual(effects, [], `${label} must not produce an external effect`);
      assert.deepEqual((await pool.query("select state,failure_code,provider_receipt_id,effect_dispatched_at from sales_provider_operations where operation_id=$1", [queued.operationId])).rows, [{ state: "dead-letter", failure_code: "HOST_INVARIANT", provider_receipt_id: null, effect_dispatched_at: null }], `${label} must fail closed before the dispatch marker`);
      assert.deepEqual((await pool.query("select status,revision from sales_activities where id=$1", [activity.id])).rows, [{ status: "scheduled", revision: 1 }]);
    }
  });
});

test("P13.C a provider that rejects a duplicate key never completes the local transition", { timeout: 180_000 }, async () => {
  await communicationsDatabase("p13_c_provider_duplicate_key", async (pool) => {
    const { createGeneratedBoundedReferenceProviderTransport, createGeneratedEnvironmentProviderSecretResolver, processGeneratedSalesCommunications } = await import("../dist/src/k-nex-sales-communications.js");
    const resolver = createGeneratedEnvironmentProviderSecretResolver(slots);
    const provider = await startReferenceProvider();
    try {
      const { queued, activity } = await queueSend(pool, "p13c-duplicate-key-conflict", "Duplicate key conflict");
      // The provider already holds this key bound to different bytes, which is
      // the one case exactly-once must refuse rather than silently accept.
      writeFileSync(provider.storePath, JSON.stringify({ [queued.receipt.idempotencyDigest]: `${emailProvider}:${"f".repeat(64)}` }));
      const transport = createGeneratedBoundedReferenceProviderTransport(provider.endpoint);
      assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, transport), 1, "first pass must claim the queued operation");
      // A refused duplicate key is a permanent statement about that key, so it
      // is terminal: no retry, and no later reconcile that could adopt a receipt
      // the provider bound to different bytes.
      assert.deepEqual((await pool.query("select state,attempt,failure_code,provider_receipt_id,effect_dispatched_at is not null dispatched from sales_provider_operations where operation_id=$1", [queued.operationId])).rows, [{ state: "dead-letter", attempt: 1, failure_code: "PROVIDER_DUPLICATE_KEY", provider_receipt_id: null, dispatched: true }]);
      assert.deepEqual((await pool.query("select status,revision from sales_activities where id=$1", [activity.id])).rows, [{ status: "scheduled", revision: 1 }], "a refused duplicate must not complete the Activity");
      await pool.query("update sales_provider_operations set next_attempt_at=now() where operation_id=$1", [queued.operationId]);
      assert.equal(await processGeneratedSalesCommunications(pool, current, resolver, transport), 0, "a dead-lettered duplicate key is never reclaimed");
      assert.equal(Number((await pool.query("select count(*) count from sales_provider_activity_receipts where operation_id=$1", [queued.operationId])).rows[0].count), 0);
      assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.timeline-changed'")).rows[0].count), 0);
    } finally { await closeServer(provider.server); }
  });
});
