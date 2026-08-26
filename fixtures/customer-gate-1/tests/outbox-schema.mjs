import assert from "node:assert/strict";

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString });
await client.connect();

const envelopeColumns = [
  "event_id",
  "event_type",
  "schema_version",
  "message_class",
  "occurred_at",
  "application_id",
  "plugin_id",
  "actor_id",
  "actor_type",
  "impersonator_id",
  "correlation_id",
  "causation_id",
  "idempotency_key",
  "payload",
  "retention_until"
];
const baseRow = {
  event_id: "event-default",
  event_type: "sales.task.created",
  schema_version: 1,
  message_class: "durable-integration",
  occurred_at: "2026-08-26T12:00:00.000Z",
  application_id: "customer-gate-1",
  plugin_id: "module.sales",
  actor_id: "user-1",
  actor_type: "user",
  impersonator_id: null,
  correlation_id: "correlation-1",
  causation_id: "event-previous",
  idempotency_key: "idempotency-default",
  payload: { taskId: "task-1", status: "open" },
  retention_until: "2026-08-27T12:00:00.000Z"
};
let sequence = 0;

async function insert(overrides = {}) {
  const row = { ...baseRow, ...overrides };
  const columns = [...envelopeColumns, "status", "attempt_count", "claimed_at", "lease_expires_at", "checkpoint", "processed_at", "dead_lettered_at"]
    .filter((column) => row[column] !== undefined);
  const values = columns.map((column) => row[column]);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return client.query(
    `insert into k_nex_outbox (${columns.join(", ")}) values (${placeholders.join(", ")}) returning *`,
    values
  );
}

async function rejected(name, overrides) {
  sequence += 1;
  await client.query("savepoint outbox_schema_case");
  let error;
  try {
    await insert({
      event_id: `event-invalid-${sequence}`,
      idempotency_key: `idempotency-invalid-${sequence}`,
      ...overrides
    });
  } catch (candidate) {
    error = candidate;
  }
  assert.ok(error, `${name} must be rejected`);
  assert.ok(["23502", "23505", "23514"].includes(error.code), `${name} failed with ${error.code}`);
  await client.query("rollback to savepoint outbox_schema_case");
  await client.query("release savepoint outbox_schema_case");
}

try {
  await client.query("begin");

  const columns = await client.query(`
    select column_name, data_type, character_maximum_length, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'k_nex_outbox'
    order by ordinal_position
  `);
  assert.deepEqual(columns.rows.map(({ column_name }) => column_name), [
    "id", "event_id", "event_type", "schema_version", "message_class", "occurred_at", "application_id", "plugin_id",
    "actor_id", "actor_type", "impersonator_id", "correlation_id", "causation_id", "idempotency_key", "payload",
    "status", "attempt_count", "available_at", "claimed_at", "lease_expires_at", "checkpoint", "last_error_code",
    "dead_lettered_at", "processed_at", "retention_until", "updated_at", "created_at"
  ]);
  const column = (name) => columns.rows.find((entry) => entry.column_name === name);
  assert.equal(column("id").data_type, "bigint");
  assert.equal(column("event_id").character_maximum_length, 128);
  assert.equal(column("event_type").character_maximum_length, 128);
  assert.equal(column("actor_type").character_maximum_length, 64);
  assert.equal(column("payload").data_type, "jsonb");
  for (const required of ["event_id", "event_type", "schema_version", "message_class", "occurred_at", "application_id", "plugin_id", "correlation_id", "payload", "status", "attempt_count", "available_at", "retention_until", "updated_at", "created_at"]) {
    assert.equal(column(required).is_nullable, "NO", `${required} is required`);
  }

  const indexes = await client.query(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and tablename = 'k_nex_outbox'
    order by indexname
  `);
  assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
    "k_nex_outbox_claim_order_idx",
    "k_nex_outbox_correlation_idx",
    "k_nex_outbox_event_id_key",
    "k_nex_outbox_idempotency_scope_key",
    "k_nex_outbox_lease_recovery_idx",
    "k_nex_outbox_pkey",
    "k_nex_outbox_retention_cleanup_idx"
  ]);
  const index = (name) => indexes.rows.find((entry) => entry.indexname === name).indexdef;
  assert.match(index("k_nex_outbox_claim_order_idx"), /\(status, available_at, id\).*status.*'pending'::text/);
  assert.match(index("k_nex_outbox_lease_recovery_idx"), /\(lease_expires_at, id\).*status.*'processing'::text.*lease_expires_at IS NOT NULL/);
  assert.match(index("k_nex_outbox_retention_cleanup_idx"), /\(retention_until, id\)$/);
  assert.match(index("k_nex_outbox_correlation_idx"), /\(correlation_id\)/);
  assert.match(index("k_nex_outbox_idempotency_scope_key"), /\(application_id, plugin_id, event_type, idempotency_key\).*WHERE \(idempotency_key IS NOT NULL\)/);

  const constraints = await client.query(`
    select conname
    from pg_constraint
    where conrelid = 'public.k_nex_outbox'::regclass
    order by conname
  `);
  assert.deepEqual(constraints.rows.map(({ conname }) => conname), [
    "k_nex_outbox_actor_pair_check",
    "k_nex_outbox_attempt_count_check",
    "k_nex_outbox_checkpoint_object_check",
    "k_nex_outbox_claim_state_check",
    "k_nex_outbox_event_id_key",
    "k_nex_outbox_impersonator_check",
    "k_nex_outbox_message_class_check",
    "k_nex_outbox_payload_object_check",
    "k_nex_outbox_pkey",
    "k_nex_outbox_retention_check",
    "k_nex_outbox_schema_version_check",
    "k_nex_outbox_status_check",
    "k_nex_outbox_status_timestamps_check"
  ]);

  const defaults = await insert();
  assert.equal(defaults.rows[0].status, "pending");
  assert.equal(defaults.rows[0].attempt_count, 0);
  assert.ok(defaults.rows[0].available_at);
  assert.ok(defaults.rows[0].created_at);
  assert.ok(defaults.rows[0].updated_at);
  assert.equal(defaults.rows[0].retention_until.toISOString(), "2026-08-27T12:00:00.000Z");
  assert.equal(defaults.rows[0].claimed_at, null);
  assert.equal(defaults.rows[0].lease_expires_at, null);

  await rejected("duplicate event_id", { event_id: "event-default" });
  await rejected("durable-only message class", { message_class: "ephemeral-hint" });
  await rejected("JSON object payload", { payload: "[]" });
  await rejected("actor id/type pairing", { actor_type: null });
  await rejected("actor id/type pairing", { actor_id: null });
  await rejected("impersonator actor requirement", { actor_id: null, actor_type: null, impersonator_id: "user-impersonator" });
  await rejected("nonnegative attempt count", { attempt_count: -1 });
  await rejected("retention is required", { retention_until: null });
  await rejected("retention after occurred_at", { retention_until: "2026-08-26T11:59:59.999Z" });
  await rejected("delivered timestamp coherence", { status: "delivered" });
  await rejected("processing requires lease", { status: "processing", claimed_at: "2026-08-26T12:01:00.000Z" });
  await rejected("processing requires claim", { status: "processing", lease_expires_at: "2026-08-26T12:02:00.000Z" });
  await rejected("pending cannot have claim", { status: "pending", claimed_at: "2026-08-26T12:01:00.000Z", lease_expires_at: "2026-08-26T12:02:00.000Z" });
  await rejected("checkpoint JSON object", { checkpoint: "[]" });

  await rejected("scoped idempotency uniqueness", { event_id: "event-duplicate-idempotency", idempotency_key: "idempotency-default" });
  await insert({ event_id: "event-other-application", application_id: "other-application" });
  await insert({ event_id: "event-other-plugin", plugin_id: "module.other" });
  await insert({ event_id: "event-other-type", event_type: "sales.task.updated" });

  await client.query("rollback");
  console.log("P3_1_OUTBOX_SCHEMA_PASS");
} finally {
  await client.end();
}
