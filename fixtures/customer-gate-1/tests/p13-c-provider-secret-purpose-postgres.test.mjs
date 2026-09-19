import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up } from "../dist/src/migrations/20260908_000032_communications.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "p13-c-provider-secrets";
const environment = "production";
const emailProvider = "email.reference.v1";
const apiReference = "secret-ref:v1:email-reference:provider-api:default";
const webhookReference = "secret-ref:v1:email-reference:webhook-signature:default";
const apiSecret = "outbound-api-credential-not-a-signing-key";
const webhookSecret = "inbound-webhook-signing-key-not-a-credential";
const slots = Object.freeze({ K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: apiSecret, K_NEX_WEBHOOK_SECRET_EMAIL_REFERENCE: webhookSecret });

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
    await run(pool);
  } finally {
    await pool.end();
    await container.stop();
  }
}

function signed(secret, event) {
  const body = Buffer.from(JSON.stringify(event));
  const timestamp = String(Date.now());
  return { body, timestamp, signature: `v1=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}` };
}

test("P13.C a provider credential and a webhook signing key cannot satisfy each other", { timeout: 180_000 }, async () => {
  await communicationsDatabase("p13_c_provider_secret_purpose", async (pool) => {
    const { acceptGeneratedSalesProviderWebhook, createGeneratedEnvironmentProviderSecretResolver } = await import("../dist/src/k-nex-sales-communications.js");
    const resolver = createGeneratedEnvironmentProviderSecretResolver(slots);

    // Separate slots: the two purposes resolve to different values.
    assert.deepEqual(await resolver.resolve(apiReference, "provider-api"), { value: apiSecret });
    assert.deepEqual(await resolver.resolve(webhookReference, "webhook-signature"), { value: webhookSecret });
    assert.notEqual(apiSecret, webhookSecret);

    // Cross-purpose resolution is refused, so holding one reference is not
    // authority to act in the other direction.
    await assert.rejects(() => resolver.resolve(apiReference, "webhook-signature"), /Provider secret reference is unavailable\./u);
    await assert.rejects(() => resolver.resolve(webhookReference, "provider-api"), /Provider secret reference is unavailable\./u);
    await assert.rejects(() => resolver.resolve("secret-ref:v1:email-reference:default", "provider-api"), /Provider secret reference is unavailable\./u, "the purposeless legacy reference grammar is no longer resolvable");

    // Independent rotation: rotating the outbound credential leaves inbound
    // signature verification untouched, and the reverse holds too.
    const rotatedApi = createGeneratedEnvironmentProviderSecretResolver({ ...slots, K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "rotated-outbound-credential" });
    assert.deepEqual(await rotatedApi.resolve(apiReference, "provider-api"), { value: "rotated-outbound-credential" });
    assert.deepEqual(await rotatedApi.resolve(webhookReference, "webhook-signature"), { value: webhookSecret });
    const rotatedWebhook = createGeneratedEnvironmentProviderSecretResolver({ ...slots, K_NEX_WEBHOOK_SECRET_EMAIL_REFERENCE: "rotated-signing-key" });
    assert.deepEqual(await rotatedWebhook.resolve(apiReference, "provider-api"), { value: apiSecret });
    assert.deepEqual(await rotatedWebhook.resolve(webhookReference, "webhook-signature"), { value: "rotated-signing-key" });

    await pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ($1,$2,$3,$4,$5,'administrator')", [applicationId, environment, emailProvider, apiReference, webhookReference]);
    const operationId = "provider-secret-purpose-operation";
    await pool.query(`insert into sales_provider_operations(operation_id,application_id,environment,provider_id,action_id,actor_id,related_record_type,related_record_id,idempotency_digest,payload_json,configuration_revision,authorization_revision,lifecycle_revision,scope_revision,state,attempt,next_attempt_at,effect_claim_id,effect_dispatched_at,provider_receipt_id,provider_receipt_at,accepted_at)
      values($1,$2,$3,$4,'sales.email.send','recipient-a','sales.contact',17,$5,'{}',1,7,3,11,'accepted',0,now(),'purpose-effect-claim',now(),'reference-receipt-purpose-001',now(),now())`, [operationId, applicationId, environment, emailProvider, `sha256:${"5".repeat(64)}`]);

    const event = { applicationId, environment, eventId: "p13c-purpose-event-001", operationId, recipientId: "recipient-a", kind: "message-delivered", metadata: { providerMessageId: "opaque-provider-message" } };
    const post = async (request) => await acceptGeneratedSalesProviderWebhook({ pool, resolver, providerId: emailProvider, applicationId, environment, ...request });

    // A webhook forged with the outbound API credential is rejected.
    await assert.rejects(() => post(signed(apiSecret, event)), (error) => error?.code === "WEBHOOK_INVALID", "compromising the outbound credential must not grant webhook-forgery authority");
    assert.equal(Number((await pool.query("select count(*) count from sales_provider_webhook_events")).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count), 0);

    // Only the webhook signing key admits the delivery.
    assert.deepEqual(await post(signed(webhookSecret, event)), { accepted: true, replay: false });
    assert.equal(Number((await pool.query("select count(*) count from sales_provider_webhook_events")).rows[0].count), 1);

    // A configuration whose slots collapse into one secret is rejected by the
    // schema, so the two purposes can never silently share a slot again.
    await assert.rejects(
      () => pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ('p13-c-shared-slot',$1,$2,$3,$3,'administrator')", [environment, emailProvider, apiReference]),
      (error) => error?.code === "23514"
    );
    await assert.rejects(
      () => pool.query("insert into sales_provider_configurations(application_id,environment,provider_id,secret_reference,webhook_secret_reference,configured_by) values ('p13-c-swapped-slot',$1,$2,$3,$4,'administrator')", [environment, emailProvider, webhookReference, apiReference]),
      (error) => error?.code === "23514",
      "a configuration cannot file the signing key in the outbound slot"
    );
  });
});
