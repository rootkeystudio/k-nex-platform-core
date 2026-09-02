import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { buildConfig, getPayload } from "payload";
import pg from "pg";

import { PostgresSystemSettingsStore } from "@k-nex/payload-adapter";
import { createGate1Application } from "../dist/src/create-application.js";
import { migrations } from "../dist/src/migrations/index.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "customer-settings-alpha";
const environment = "production";
const migrationIndex = migrations.findIndex((migration) => migration.name === "20260902_000023_system_settings");
const migration = migrations[migrationIndex];
const migrationDirectory = fileURLToPath(new URL("../src/migrations/", import.meta.url));

const extensionOwner = ["extension", null, "platform-plugin", "module.sales", 1, "platform-plugin:module.sales:1"];
const platformOwner = ["platform", "system", null, null, null, "platform:system"];

function identityColumns(owner) {
  const [ownerKind, ownerNamespace, ownerDeliveryClass, ownerExtensionId, ownerGeneration, ownerScopeKey] = owner;
  return { ownerKind, ownerNamespace, ownerDeliveryClass, ownerExtensionId, ownerGeneration, ownerScopeKey };
}

async function insertState(pool, id, targetEnvironment = environment) {
  await pool.query("insert into k_nex_system_settings_state (application_id, environment) values ($1,$2)", [id, targetEnvironment]);
}

async function insertGeneration(pool, id, generation = 1) {
  await pool.query(
    `insert into k_nex_extension_authorization_generations
      (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state)
     values ($1,'platform-plugin','module.sales',$2,'[\"settings-generation\"]'::jsonb,'current')`,
    [id, generation]
  );
}

async function insertActiveLifecycle(pool, id, targetEnvironment = environment, generationId = "settings-generation") {
  await pool.query(
    `insert into runtime_extensions
      (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
     values ($1,$2,'platform-plugin','module.sales',1,'active',$3,'{}'::jsonb)`,
    [id, targetEnvironment, generationId]
  );
  await pool.query(
    `insert into runtime_extension_generations
      (application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest, state)
     values ($1,$2,'platform-plugin','module.sales',$3,'1.0.0','{}'::jsonb,$4,'active')`,
    [id, targetEnvironment, generationId, `sha256:${"0".repeat(64)}`]
  );
}

async function insertDocument(pool, id, targetEnvironment, descriptorId, owner, values = { timezone: "UTC" }) {
  const columns = identityColumns(owner);
  return pool.query(
    `insert into k_nex_system_settings_documents
      (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
       owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json)
     values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,1,1,$10::jsonb)`,
    [id, targetEnvironment, descriptorId, columns.ownerScopeKey, columns.ownerKind, columns.ownerNamespace,
      columns.ownerDeliveryClass, columns.ownerExtensionId, columns.ownerGeneration, JSON.stringify(values)]
  );
}

const ownerConstraintShapes = [
  { table: "k_nex_system_settings_documents", keyColumns: ["application_id", "environment", "descriptor_id", "descriptor_schema_version", "owner_scope_key"] },
  { table: "k_nex_system_settings_operations", keyColumns: ["operation_id"] },
  { table: "k_nex_system_settings_receipts", keyColumns: ["receipt_id"], immutable: true },
  { table: "k_nex_system_settings_audit", keyColumns: ["audit_id"] },
  { table: "k_nex_system_settings_outbox", keyColumns: ["event_id"] }
];

function ownerConstraintRow(table, owner, id) {
  const columns = identityColumns(owner);
  const extension = columns.ownerKind === "extension";
  const descriptorId = `${extension ? "sales" : "system"}.owner-${id}`;
  const identity = {
    application_id: applicationId,
    environment,
    descriptor_id: descriptorId,
    descriptor_schema_version: 1,
    owner_scope_key: columns.ownerScopeKey,
    owner_kind: columns.ownerKind,
    owner_namespace: columns.ownerNamespace,
    owner_delivery_class: columns.ownerDeliveryClass,
    owner_extension_id: columns.ownerExtensionId,
    owner_generation: columns.ownerGeneration
  };
  switch (table) {
    case "k_nex_system_settings_documents":
      return { ...identity, document_revision: 1, settings_revision: extension ? 101 : 100, values_json: {} };
    case "k_nex_system_settings_operations":
      return {
        operation_id: id,
        ...identity,
        pending_document_json: {},
        expected_document_revision: 0,
        expected_settings_revision: 0,
        state: "pending-validation",
        requested_by_kind: "user",
        requested_by_id: "user:owner",
        idempotency_key: `${id}-replay`,
        request_digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      };
    case "k_nex_system_settings_receipts":
      return {
        receipt_id: id,
        operation_id: `${id}-operation`,
        ...identity,
        requested_by_kind: "user",
        requested_by_id: "user:owner",
        idempotency_key: `${id}-replay`,
        request_digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        outcome: "promoted",
        receipt_json: {}
      };
    case "k_nex_system_settings_audit":
      return {
        audit_id: id,
        ...identity,
        requested_by_kind: "user",
        requested_by_id: "user:owner",
        outcome: "applied",
        changed_fields_json: []
      };
    case "k_nex_system_settings_outbox":
      return { event_id: id, ...identity, settings_revision: extension ? 103 : 102 };
    default:
      throw new Error(`Unknown owner constraint table: ${table}`);
  }
}

async function rawInsert(pool, table, row) {
  const columns = Object.keys(row);
  const jsonColumns = new Set(["values_json", "pending_document_json", "receipt_json", "changed_fields_json"]);
  const placeholders = columns.map((column, index) => `$${index + 1}${jsonColumns.has(column) ? "::jsonb" : ""}`);
  await pool.query(
    `insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")})`,
    columns.map((column) => jsonColumns.has(column) ? JSON.stringify(row[column]) : row[column])
  );
}

async function rawUpdate(pool, table, keyColumns, row, column, value) {
  const where = keyColumns.map((key, index) => `${key}=$${index + 2}`).join(" and ");
  await pool.query(`update ${table} set ${column}=$1 where ${where}`, [value, ...keyColumns.map((key) => row[key])]);
}

async function assertTwoValuedOwnerConstraints(pool) {
  for (const shape of ownerConstraintShapes) {
    const platformId = `owner-platform-${shape.table.slice(22)}`;
    const extensionId = `owner-extension-${shape.table.slice(22)}`;
    const platform = ownerConstraintRow(shape.table, platformOwner, platformId);
    const extension = ownerConstraintRow(shape.table, extensionOwner, extensionId);
    const constraint = new RegExp(`${shape.table}_owner_check`, "u");

    await rawInsert(pool, shape.table, platform);
    await rawInsert(pool, shape.table, extension);

    await assert.rejects(
      rawInsert(pool, shape.table, { ...ownerConstraintRow(shape.table, platformOwner, `${platformId}-null`), owner_namespace: null }),
      constraint,
      `${shape.table} rejects a platform owner with a NULL namespace.`
    );
    for (const column of ["owner_delivery_class", "owner_extension_id", "owner_generation"]) {
      const candidateId = `${extensionId}-${column.replaceAll("_", "-")}`;
      await assert.rejects(
        rawInsert(pool, shape.table, { ...ownerConstraintRow(shape.table, extensionOwner, candidateId), [column]: null }),
        constraint,
        `${shape.table} rejects an extension owner with NULL ${column}.`
      );
    }

    if (!shape.immutable) {
      await assert.rejects(rawUpdate(pool, shape.table, shape.keyColumns, platform, "owner_namespace", null), constraint);
      for (const column of ["owner_delivery_class", "owner_extension_id", "owner_generation"]) {
        await assert.rejects(rawUpdate(pool, shape.table, shape.keyColumns, extension, column, null), constraint);
      }
    }
  }
}

test("P11.2a migrates constrained generation-fenced settings storage through real PostgreSQL", { timeout: 180_000 }, async () => {
  assert.ok(migrationIndex > 0);
  assert.ok(migration);
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("system_settings_storage").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pool.on("error", () => {});
  let payload;
  let payloadPool;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const application = createGate1Application({
      databaseUrl: container.getConnectionUri(),
      migrations: migrations.slice(0, migrationIndex),
      payloadSecret: "p11-system-settings-storage"
    });
    payload = await getPayload({ config: buildConfig(application.config), key: "p11-system-settings-storage" });
    payloadPool = payload.db.pool;
    payloadPool.on("error", () => {});
    payload.db.migrationDir = migrationDirectory;
    await payload.db.migrate({ migrations: [migration] });

    assert.deepEqual((await pool.query("select predecessor_revision, revision from k_nex_migration_revision where id=1")).rows, [{ predecessor_revision: 22, revision: 23 }]);
    assert.equal((await pool.query("select count(*)::int as count from payload_migrations where name=$1", [migration.name])).rows[0].count, 1);
    assert.deepEqual((await pool.query(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name = any($1::text[]) order by table_name`,
      [["k_nex_system_settings_state", "k_nex_system_settings_documents", "k_nex_system_settings_operations", "k_nex_system_settings_receipts", "k_nex_system_settings_audit", "k_nex_system_settings_outbox"]]
    )).rows.map(({ table_name }) => table_name), ["k_nex_system_settings_audit", "k_nex_system_settings_documents", "k_nex_system_settings_operations", "k_nex_system_settings_outbox", "k_nex_system_settings_receipts", "k_nex_system_settings_state"]);

    await insertState(pool, applicationId);
    await insertState(pool, applicationId, "staging");
    await insertState(pool, "customer-settings-beta");
    await insertState(pool, "customer-settings-beta", "staging");
    await insertState(pool, "customer-settings-gamma", "staging");
    await insertGeneration(pool, applicationId);
    await insertGeneration(pool, "customer-settings-beta");
    await insertDocument(pool, applicationId, environment, "sales.workspace", extensionOwner, { timezone: "UTC" });
    await insertDocument(pool, applicationId, "staging", "sales.workspace", extensionOwner, { timezone: "Europe/Istanbul" });
    await insertDocument(pool, "customer-settings-beta", environment, "sales.workspace", extensionOwner, { timezone: "America/New_York" });
    await insertDocument(pool, applicationId, environment, "system.audit", platformOwner, { enabled: true });
    assert.deepEqual((await pool.query(
      "select application_id, environment, descriptor_id, owner_scope_key from k_nex_system_settings_documents order by application_id, environment, descriptor_id"
    )).rows, [
      { application_id: applicationId, environment: "production", descriptor_id: "sales.workspace", owner_scope_key: "platform-plugin:module.sales:1" },
      { application_id: applicationId, environment: "production", descriptor_id: "system.audit", owner_scope_key: "platform:system" },
      { application_id: applicationId, environment: "staging", descriptor_id: "sales.workspace", owner_scope_key: "platform-plugin:module.sales:1" },
      { application_id: "customer-settings-beta", environment: "production", descriptor_id: "sales.workspace", owner_scope_key: "platform-plugin:module.sales:1" }
    ]);

    await assert.rejects(
      insertDocument(pool, applicationId, environment, "sales.workspace", extensionOwner),
      /k_nex_system_settings_documents_pkey/u,
      "A scope has exactly one effective document."
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_system_settings_documents
          (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
           owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json)
         values ($1,$2,'system.audit',1,'platform:system','platform','system','platform-plugin','module.sales',1,1,1,'{}'::jsonb)`,
        [applicationId, environment]
      ),
      /k_nex_system_settings_documents_owner_check/u
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_system_settings_documents
          (application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
           owner_delivery_class, owner_extension_id, owner_generation, document_revision, settings_revision, values_json)
         values ('customer-settings-gamma','staging','sales.workspace',1,'platform-plugin:module.sales:1','extension',null,'platform-plugin','module.sales',1,1,1,'{}'::jsonb)`
      ),
      /k_nex_system_settings_documents_extension_owner_fk/u,
      "A generation owned by another application cannot be referenced."
    );
    await assert.rejects(
      insertDocument(pool, applicationId, environment, "sales.reports", extensionOwner, []),
      /k_nex_system_settings_documents_values_object_check/u
    );

    await assertTwoValuedOwnerConstraints(pool);

    const owner = identityColumns(extensionOwner);
    await pool.query(
      `insert into k_nex_system_settings_operations
        (operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, pending_document_json, expected_document_revision, expected_settings_revision,
         state, requested_by_kind, requested_by_id, idempotency_key, request_digest)
       values ('settings-operation-1',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,$9::jsonb,1,1,'pending-validation','user','user:owner','settings-replay-0001','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`,
      [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, JSON.stringify({ schemaVersion: 1, values: { apiKey: { kind: "secret-reference", reference: "vault:settings-api" } } })]
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_system_settings_operations
          (operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
           owner_delivery_class, owner_extension_id, owner_generation, pending_document_json, expected_document_revision, expected_settings_revision,
           state, requested_by_kind, requested_by_id, idempotency_key, request_digest)
         values ('settings-operation-2',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,'{}'::jsonb,1,1,'pending-validation','user','user:owner','settings-replay-0001','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')`,
        [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration]
      ),
      /k_nex_system_settings_operations_replay_key/u
    );
    await assert.rejects(
      pool.query("update k_nex_system_settings_operations set request_digest='invalid' where operation_id='settings-operation-1'"),
      /k_nex_system_settings_operations_identity_check/u
    );

    await pool.query(
      `insert into k_nex_system_settings_receipts
        (receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json)
       values ('settings-receipt-1','settings-operation-1',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,'user','user:owner','settings-replay-0002','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','promoted',$9::jsonb)`,
      [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass,
        owner.ownerExtensionId, owner.ownerGeneration, JSON.stringify({ schemaVersion: 1, receiptId: "settings-receipt-1", outcome: "promoted", changedFields: ["timezone"] })]
    );
    await assert.rejects(
      pool.query("update k_nex_system_settings_receipts set outcome='validation-failed' where receipt_id='settings-receipt-1'"),
      /System settings terminal receipts are immutable/u
    );
    await assert.rejects(
      pool.query("delete from k_nex_system_settings_receipts where receipt_id='settings-receipt-1'"),
      /System settings terminal receipts are immutable/u
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_system_settings_receipts
          (receipt_id, operation_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
           owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, idempotency_key, request_digest, outcome, receipt_json)
         values ('settings-receipt-2','settings-operation-2',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,'user','user:owner','settings-replay-0003','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','promoted','{"values":{"apiKey":"leak"}}'::jsonb)`,
        [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration]
      ),
      /k_nex_system_settings_receipts_safe_object_check/u
    );

    await pool.query(
      `insert into k_nex_system_settings_audit
        (audit_id, operation_id, receipt_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind,
         owner_namespace, owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome,
         document_revision, settings_revision, changed_fields_json)
       values ('settings-audit-1','settings-operation-1','settings-receipt-1',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,'user','user:owner','applied',2,2,'["timezone"]'::jsonb)`,
      [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration]
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_system_settings_audit
          (audit_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
           owner_delivery_class, owner_extension_id, owner_generation, requested_by_kind, requested_by_id, outcome, changed_fields_json)
         values ('settings-audit-2',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,'user','user:owner','applied','{}'::jsonb)`,
        [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration]
      ),
      /k_nex_system_settings_audit_safe_fields_check/u
    );
    await pool.query(
      `insert into k_nex_system_settings_outbox
        (event_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         owner_delivery_class, owner_extension_id, owner_generation, settings_revision)
       values ('settings-invalidation-1',$1,$2,'sales.workspace',1,$3,$4,$5,$6,$7,$8,2)`,
      [applicationId, environment, owner.ownerScopeKey, owner.ownerKind, owner.ownerNamespace, owner.ownerDeliveryClass, owner.ownerExtensionId, owner.ownerGeneration]
    );
    assert.deepEqual((await pool.query(
      `select table_name, bool_or(column_name ~ '(value|secret|reference)') as leaks
       from information_schema.columns
       where table_schema='public' and table_name in ('k_nex_system_settings_audit','k_nex_system_settings_outbox')
       group by table_name order by table_name`
    )).rows, [
      { table_name: "k_nex_system_settings_audit", leaks: false },
      { table_name: "k_nex_system_settings_outbox", leaks: false }
    ]);

    await payload.db.migrateDown();
    assert.deepEqual((await pool.query("select predecessor_revision, revision from k_nex_migration_revision where id=1")).rows, [{ predecessor_revision: 21, revision: 22 }]);
    assert.deepEqual((await pool.query("select to_regclass('public.k_nex_system_settings_documents')::text as document_table")).rows, [{ document_table: null }]);
    assert.equal((await pool.query("select count(*)::int as count from payload_migrations where name=$1", [migration.name])).rows[0].count, 0);
  } finally {
    try {
      await payload?.destroy();
      for (const client of payloadPool?._clients ?? []) {
        try {
          client.release();
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("already been released")) throw error;
        }
      }
      await payloadPool?.end();
    } finally {
      try {
        await pool.end();
      } finally {
        try {
          await container.stop();
        } finally {
          if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = originalNodeEnv;
        }
      }
    }
  }
});

test("P11.2b persists immediate settings atomically through real PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("system_settings_immediate").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pool.on("error", () => {});
  let payload;
  let payloadPool;
  const originalNodeEnv = process.env.NODE_ENV;
  const identity = {
    applicationId,
    environment,
    descriptorId: "system.audit",
    descriptorSchemaVersion: 1,
    owner: { kind: "platform", namespace: "system" }
  };
  const extensionIdentity = {
    applicationId,
    environment,
    descriptorId: "sales.workspace",
    descriptorSchemaVersion: 1,
    owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }
  };
  const extensionGenerationTwo = { ...extensionIdentity, owner: { ...extensionIdentity.owner, generation: 2 } };
  const write = ({
    target = identity,
    expectedDocumentRevision = 0,
    expectedSettingsRevision = 0,
    idempotencyKey,
    operationId,
    receiptId,
    invalidationId,
    auditId,
    changedFields,
    values
  }) => ({
    identity: target,
    document: { expectedDocumentRevision, expectedSettingsRevision, values },
    operation: { operationId, idempotencyKey },
    receipt: { receiptId, invalidationId, occurredAt: "2026-09-02T00:00:00.000Z" },
    actor: { kind: "user", id: "user:owner" },
    auditId,
    changedFields
  });
  try {
    process.env.NODE_ENV = "production";
    const application = createGate1Application({
      databaseUrl: container.getConnectionUri(),
      migrations,
      payloadSecret: "p11-system-settings-immediate"
    });
    payload = await getPayload({ config: buildConfig(application.config), key: "p11-system-settings-immediate" });
    payloadPool = payload.db.pool;
    payloadPool.on("error", () => {});
    const store = new PostgresSystemSettingsStore(pool);
    const first = write({
      idempotencyKey: "p11-immediate-replay-0001",
      operationId: "settings-immediate-operation-1",
      receiptId: "settings-immediate-receipt-1",
      invalidationId: "settings-immediate-event-1",
      auditId: "settings-immediate-audit-1",
      changedFields: ["enabled"],
      values: { enabled: true }
    });
    const receipt = await store.writeImmediate(first);
    assert.deepEqual(receipt, {
      schemaVersion: 1,
      receiptId: "settings-immediate-receipt-1",
      operationId: "settings-immediate-operation-1",
      identity,
      requestedBy: { kind: "user", id: "user:owner" },
      idempotencyKey: "p11-immediate-replay-0001",
      occurredAt: "2026-09-02T00:00:00.000Z",
      outcome: "promoted",
      documentRevision: 1,
      settingsRevision: 1,
      changedFields: ["enabled"],
      invalidationId: "settings-immediate-event-1"
    });
    assert.deepEqual(await store.writeImmediate(first), receipt, "Exact response-lost replay returns immutable receipt.");
    await assert.rejects(
      store.writeImmediate({ ...first, document: { ...first.document, values: { enabled: false } } }),
      (error) => error?.code === "IDEMPOTENCY"
    );
    await assert.rejects(
      store.writeImmediate(write({
        expectedDocumentRevision: 0,
        expectedSettingsRevision: 0,
        idempotencyKey: "p11-immediate-stale-0001",
        operationId: "settings-immediate-operation-2",
        receiptId: "settings-immediate-receipt-2",
        invalidationId: "settings-immediate-event-2",
        auditId: "settings-immediate-audit-2",
        changedFields: ["enabled"],
        values: { enabled: false }
      })),
      (error) => error?.code === "REVISION"
    );
    await assert.rejects(
      store.writeImmediate(write({
        expectedDocumentRevision: 1,
        expectedSettingsRevision: 1,
        idempotencyKey: "p11-immediate-fields-0001",
        operationId: "settings-immediate-fields-operation-1",
        receiptId: "settings-immediate-fields-receipt-1",
        invalidationId: "settings-immediate-fields-event-1",
        auditId: "settings-immediate-fields-audit-1",
        changedFields: [],
        values: { enabled: false }
      })),
      (error) => error?.code === "INVALID",
      "Caller-asserted change metadata cannot disagree with the locked document diff."
    );
    assert.equal((await store.read(identity))?.state.settingsRevision, 1);

    await insertGeneration(pool, applicationId, 1);
    await insertActiveLifecycle(pool, applicationId);
    await store.writeImmediate(write({
      target: extensionIdentity,
      expectedSettingsRevision: 1,
      idempotencyKey: "p11-immediate-extension-0001",
      operationId: "settings-immediate-operation-3",
      receiptId: "settings-immediate-receipt-3",
      invalidationId: "settings-immediate-event-3",
      auditId: "settings-immediate-audit-3",
      changedFields: ["apiKey"],
      values: { apiKey: { kind: "secret-reference", provider: "environment", key: "SETTINGS_TEST_SECRET" } }
    }));
    await pool.query(
      "update k_nex_extension_authorization_generations set state='retired' where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and authorization_generation=1",
      [applicationId]
    );
    await insertGeneration(pool, applicationId, 2);
    await assert.rejects(
      store.writeImmediate(write({
        target: extensionIdentity,
        expectedDocumentRevision: 1,
        expectedSettingsRevision: 2,
        idempotencyKey: "p11-immediate-retired-0001",
        operationId: "settings-immediate-retired-operation-1",
        receiptId: "settings-immediate-retired-receipt-1",
        invalidationId: "settings-immediate-retired-event-1",
        auditId: "settings-immediate-retired-audit-1",
        changedFields: ["apiKey"],
        values: { apiKey: { kind: "secret-reference", provider: "environment", key: "SETTINGS_RETIRED_SECRET" } }
      })),
      (error) => error?.code === "STATE",
      "A retired authorization generation cannot mutate effective settings."
    );
    assert.equal((await pool.query("select count(*)::int as count from k_nex_system_settings_receipts where operation_id='settings-immediate-retired-operation-1'")).rows[0].count, 0);
    assert.equal((await store.read(extensionGenerationTwo))?.document, undefined, "A different owner generation cannot read retained values.");
    assert.equal(await store.read({ ...identity, environment: "staging" }), undefined, "A different environment cannot read production values.");

    await pool.query(
      `insert into k_nex_system_settings_audit
        (audit_id, application_id, environment, descriptor_id, descriptor_schema_version, owner_scope_key, owner_kind, owner_namespace,
         requested_by_kind, requested_by_id, outcome, changed_fields_json)
       values ('settings-immediate-audit-conflict',$1,$2,'system.audit',1,'platform:system','platform','system','user','user:owner','applied','[]'::jsonb)`,
      [applicationId, environment]
    );
    await assert.rejects(
      store.writeImmediate(write({
        expectedDocumentRevision: 1,
        expectedSettingsRevision: 2,
        idempotencyKey: "p11-immediate-rollback-0001",
        operationId: "settings-immediate-operation-4",
        receiptId: "settings-immediate-receipt-4",
        invalidationId: "settings-immediate-event-4",
        auditId: "settings-immediate-audit-conflict",
        changedFields: ["enabled"],
        values: { enabled: false }
      })),
      (error) => error?.code === "STATE"
    );
    assert.deepEqual((await pool.query(
      "select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2",
      [applicationId, environment]
    )).rows, [{ settings_revision: 2 }], "Audit failure rolls back state revision.");
    assert.deepEqual((await pool.query(
      "select document_revision, settings_revision, values_json from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id='system.audit'",
      [applicationId, environment]
    )).rows, [{ document_revision: 1, settings_revision: 1, values_json: { enabled: true } }], "Audit failure rolls back document.");
    assert.deepEqual((await pool.query(
      "select count(*)::int as count from k_nex_system_settings_receipts where receipt_id='settings-immediate-receipt-4'"
    )).rows, [{ count: 0 }], "Audit failure rolls back receipt.");
    assert.deepEqual((await pool.query(
      "select count(*)::int as count from k_nex_system_settings_outbox where event_id='settings-immediate-event-4'"
    )).rows, [{ count: 0 }], "Audit failure rolls back invalidation.");
    const safeRows = await pool.query(
      `select (select jsonb_agg(changed_fields_json) from k_nex_system_settings_audit)::text as audit,
              (select jsonb_agg(to_jsonb(k_nex_system_settings_outbox)) from k_nex_system_settings_outbox)::text as outbox`
    );
    assert.equal(`${safeRows.rows[0].audit}${safeRows.rows[0].outbox}`.includes("SETTINGS_TEST_SECRET"), false, "Audit/outbox never contain settings reference values.");
  } finally {
    try {
      await payload?.destroy();
      for (const client of payloadPool?._clients ?? []) {
        try { client.release(); } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("already been released")) throw error;
        }
      }
      await payloadPool?.end();
    } finally {
      try { await pool.end(); } finally {
        try { await container.stop(); } finally {
          if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = originalNodeEnv;
        }
      }
    }
  }
});

test("P11.2c resumes generation-validated settings operations through real PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("system_settings_pending").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pool.on("error", () => {});
  let payload;
  let payloadPool;
  const originalNodeEnv = process.env.NODE_ENV;
  const identity = {
    applicationId,
    environment,
    descriptorId: "sales.workspace",
    descriptorSchemaVersion: 1,
    owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }
  };
  const write = ({
    target = identity,
    descriptorId = target.descriptorId,
    expectedDocumentRevision = 0,
    expectedSettingsRevision = 0,
    idempotencyKey,
    operationId,
    receiptId,
    invalidationId,
    auditId,
    changedFields,
    values
  }) => ({
    identity: { ...target, descriptorId },
    document: { expectedDocumentRevision, expectedSettingsRevision, values },
    operation: { operationId, idempotencyKey },
    receipt: { receiptId, invalidationId, occurredAt: "2026-09-02T00:00:00.000Z" },
    actor: { kind: "user", id: "user:owner" },
    auditId,
    changedFields
  });
  try {
    process.env.NODE_ENV = "production";
    const application = createGate1Application({ databaseUrl: container.getConnectionUri(), migrations, payloadSecret: "p11-system-settings-pending" });
    payload = await getPayload({ config: buildConfig(application.config), key: "p11-system-settings-pending" });
    payloadPool = payload.db.pool;
    payloadPool.on("error", () => {});
    await insertGeneration(pool, applicationId, 1);
    await insertActiveLifecycle(pool, applicationId);
    const store = new PostgresSystemSettingsStore(pool);
    const first = write({
      expectedSettingsRevision: 0,
      idempotencyKey: "p11-pending-replay-0001",
      operationId: "settings-pending-operation-1",
      receiptId: "settings-pending-receipt-1",
      invalidationId: "settings-pending-event-1",
      auditId: "settings-pending-audit-1",
      changedFields: ["timezone"],
      values: { timezone: "Europe/Istanbul" }
    });
    const pending = await store.beginGenerationValidated(first);
    assert.equal(pending.state, "pending-validation");
    assert.equal((await store.read(identity))?.document, undefined, "Pending values never become effective.");
    assert.equal((await store.read(identity))?.state.settingsRevision, 0);
    assert.deepEqual(await store.beginGenerationValidated(first), pending, "Exact pending replay returns the same operation.");
    await assert.rejects(
      store.beginGenerationValidated({ ...first, document: { ...first.document, values: { timezone: "UTC" } } }),
      (error) => error?.code === "IDEMPOTENCY"
    );
    await assert.rejects(
      store.beginGenerationValidated({ ...first, operation: { ...first.operation, operationId: "settings-pending-operation-other" } }),
      (error) => error?.code === "IDEMPOTENCY"
    );
    assert.deepEqual(await store.readGenerationValidated({ identity, operationId: first.operation.operationId }), pending, "A new process can resume pending work.");
    await assert.rejects(
      store.readGenerationValidated({ identity: { ...identity, environment: "staging" }, operationId: first.operation.operationId }),
      (error) => error?.code === "STATE",
      "Operation identity is application/environment/generation fenced."
    );
    await assert.rejects(
      store.readGenerationValidated({ identity: { ...identity, applicationId: "customer-settings-beta" }, operationId: first.operation.operationId }),
      (error) => error?.code === "STATE"
    );
    await assert.rejects(
      store.readGenerationValidated({ identity: { ...identity, owner: { ...identity.owner, generation: 2 } }, operationId: first.operation.operationId }),
      (error) => error?.code === "STATE"
    );
    const validating = await store.transitionGenerationValidated({ identity, operationId: first.operation.operationId, expectedOperationRevision: 1, state: "validating" });
    assert.deepEqual({ state: validating.state, attempts: validating.attempts, revision: validating.revision }, { state: "validating", attempts: 1, revision: 2 });
    await assert.rejects(
      store.transitionGenerationValidated({ identity, operationId: first.operation.operationId, expectedOperationRevision: 1, state: "validating" }),
      (error) => error?.code === "REVISION"
    );
    const [promoted, promotedReplay] = await Promise.all([
      new PostgresSystemSettingsStore(pool).promoteGenerationValidated({ ...first, expectedOperationRevision: 2 }),
      new PostgresSystemSettingsStore(pool).promoteGenerationValidated({ ...first, expectedOperationRevision: 2 })
    ]);
    assert.equal(promoted.outcome, "promoted");
    assert.deepEqual(promotedReplay, promoted, "Concurrent exact terminal calls serialize to the immutable receipt.");
    assert.deepEqual((await store.read(identity))?.document?.values, { timezone: "Europe/Istanbul" });
    assert.equal((await store.read(identity))?.state.settingsRevision, 1);
    assert.equal((await store.read({ ...identity, owner: { ...identity.owner, generation: 2 } }))?.document, undefined, "A different generation cannot adopt effective values.");
    assert.equal(await store.read({ ...identity, applicationId: "customer-settings-beta" }), undefined, "A different application cannot read effective values.");
    assert.equal(await store.read({ ...identity, environment: "staging" }), undefined, "A different environment cannot read effective values.");
    assert.deepEqual(await store.readGenerationValidated({ identity, operationId: first.operation.operationId }), promoted, "Crash/restart resumes terminal receipt.");

    await assert.rejects(
      store.beginGenerationValidated(write({
        descriptorId: "sales.badfields",
        expectedSettingsRevision: 1,
        idempotencyKey: "p11-pending-fields-0001",
        operationId: "settings-pending-fields-operation-1",
        receiptId: "settings-pending-fields-receipt-1",
        invalidationId: "settings-pending-fields-event-1",
        auditId: "settings-pending-fields-audit-1",
        changedFields: ["wrong"],
        values: { enabled: true }
      })),
      (error) => error?.code === "INVALID"
    );
    assert.equal((await pool.query("select count(*)::int as count from k_nex_system_settings_operations where operation_id='settings-pending-fields-operation-1'")).rows[0].count, 0);

    const failure = write({
      descriptorId: "sales.notifications",
      expectedSettingsRevision: 1,
      idempotencyKey: "p11-pending-replay-0002",
      operationId: "settings-pending-operation-2",
      receiptId: "settings-pending-receipt-2",
      invalidationId: "settings-pending-event-2",
      auditId: "settings-pending-audit-2",
      changedFields: ["enabled"],
      values: { enabled: false }
    });
    const failurePending = await store.beginGenerationValidated(failure);
    const failureValidating = await store.transitionGenerationValidated({ identity: failure.identity, operationId: failure.operation.operationId, expectedOperationRevision: failurePending.revision, state: "validating" });
    await assert.rejects(
      store.transitionGenerationValidated({ identity: failure.identity, operationId: failure.operation.operationId, expectedOperationRevision: failurePending.revision, state: "promotion-blocked" }),
      (error) => error?.code === "REVISION"
    );
    const blocked = await store.transitionGenerationValidated({ identity: failure.identity, operationId: failure.operation.operationId, expectedOperationRevision: failureValidating.revision, state: "promotion-blocked" });
    await assert.rejects(
      store.failGenerationValidated({ ...failure, expectedOperationRevision: 1, reason: "descriptor-disabled" }),
      (error) => error?.code === "REVISION"
    );
    const failed = await store.failGenerationValidated({ ...failure, expectedOperationRevision: blocked.revision, reason: "descriptor-disabled" });
    assert.deepEqual(await store.failGenerationValidated({ ...failure, expectedOperationRevision: blocked.revision, reason: "descriptor-disabled" }), failed);
    assert.equal(failed.outcome, "promotion-invalidated");
    assert.equal((await store.read(failure.identity))?.document, undefined, "Terminal failure leaves no effective candidate.");
    assert.equal((await store.read(identity))?.state.settingsRevision, 1, "Terminal failure leaves global settings state unchanged.");

    const schemaMigration = write({
      target: { ...identity, descriptorSchemaVersion: 2 },
      expectedSettingsRevision: 1,
      idempotencyKey: "p11-pending-schema-migration-0001",
      operationId: "settings-pending-schema-operation-1",
      receiptId: "settings-pending-schema-receipt-1",
      invalidationId: "settings-pending-schema-event-1",
      auditId: "settings-pending-schema-audit-1",
      changedFields: ["timezone"],
      values: { timezone: "invalid-for-v2" }
    });
    const schemaPending = await store.beginGenerationValidated(schemaMigration);
    const schemaValidating = await store.transitionGenerationValidated({
      identity: schemaMigration.identity,
      operationId: schemaMigration.operation.operationId,
      expectedOperationRevision: schemaPending.revision,
      state: "validating"
    });
    const schemaFailed = await store.failGenerationValidated({
      ...schemaMigration,
      expectedOperationRevision: schemaValidating.revision,
      reason: "schema-validation-failed"
    });
    assert.equal(schemaFailed.outcome, "validation-failed");
    assert.equal((await store.read(schemaMigration.identity))?.document, undefined);
    assert.deepEqual((await store.read(identity))?.document?.values, { timezone: "Europe/Istanbul" }, "Schema migration failure preserves the last valid document.");

    const collision = write({
      descriptorId: "sales.reports",
      expectedSettingsRevision: 1,
      idempotencyKey: "p11-pending-replay-0003",
      operationId: "settings-pending-operation-3",
      receiptId: "settings-pending-receipt-3",
      invalidationId: "settings-pending-event-3",
      auditId: "settings-pending-audit-1",
      changedFields: ["enabled"],
      values: { enabled: true }
    });
    const collisionPending = await store.beginGenerationValidated(collision);
    const collisionValidating = await store.transitionGenerationValidated({ identity: collision.identity, operationId: collision.operation.operationId, expectedOperationRevision: collisionPending.revision, state: "validating" });
    await assert.rejects(
      store.promoteGenerationValidated({ ...collision, expectedOperationRevision: collisionValidating.revision }),
      (error) => error?.code === "STATE"
    );
    assert.equal((await store.read(identity))?.state.settingsRevision, 1, "Forced audit collision rolls back promotion state.");
    assert.equal((await store.read(collision.identity))?.document, undefined, "Forced audit collision rolls back candidate promotion.");
    assert.equal((await store.readGenerationValidated({ identity: collision.identity, operationId: collision.operation.operationId }))?.state, "validating", "Failed transaction preserves resumable work.");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_system_settings_outbox")).rows[0].count, 1, "Only successful promotion emits invalidation.");
    const safeRows = await pool.query("select jsonb_agg(to_jsonb(k_nex_system_settings_audit))::text as audit, jsonb_agg(to_jsonb(k_nex_system_settings_outbox))::text as outbox from k_nex_system_settings_audit cross join k_nex_system_settings_outbox");
    assert.equal(`${safeRows.rows[0].audit}${safeRows.rows[0].outbox}`.includes("Europe/Istanbul"), false, "Audit and outbox omit settings values.");

    const raceOne = write({
      descriptorId: "sales.raceone",
      expectedSettingsRevision: 1,
      idempotencyKey: "p11-pending-race-one-0001",
      operationId: "settings-pending-race-operation-1",
      receiptId: "settings-pending-race-receipt-1",
      invalidationId: "settings-pending-race-event-1",
      auditId: "settings-pending-race-audit-1",
      changedFields: ["enabled"],
      values: { enabled: true }
    });
    const raceTwo = write({
      descriptorId: "sales.racetwo",
      expectedSettingsRevision: 1,
      idempotencyKey: "p11-pending-race-two-0001",
      operationId: "settings-pending-race-operation-2",
      receiptId: "settings-pending-race-receipt-2",
      invalidationId: "settings-pending-race-event-2",
      auditId: "settings-pending-race-audit-2",
      changedFields: ["enabled"],
      values: { enabled: false }
    });
    const [raceOnePending, raceTwoPending] = await Promise.all([store.beginGenerationValidated(raceOne), store.beginGenerationValidated(raceTwo)]);
    const [raceOneValidating, raceTwoValidating] = await Promise.all([
      store.transitionGenerationValidated({ identity: raceOne.identity, operationId: raceOne.operation.operationId, expectedOperationRevision: raceOnePending.revision, state: "validating" }),
      store.transitionGenerationValidated({ identity: raceTwo.identity, operationId: raceTwo.operation.operationId, expectedOperationRevision: raceTwoPending.revision, state: "validating" })
    ]);
    const raceResults = await Promise.allSettled([
      new PostgresSystemSettingsStore(pool).promoteGenerationValidated({ ...raceOne, expectedOperationRevision: raceOneValidating.revision }),
      new PostgresSystemSettingsStore(pool).promoteGenerationValidated({ ...raceTwo, expectedOperationRevision: raceTwoValidating.revision })
    ]);
    const winners = raceResults.filter((result) => result.status === "fulfilled");
    const losers = raceResults.filter((result) => result.status === "rejected");
    assert.equal(winners.length, 1, "Only one same-revision candidate can promote.");
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason?.code, "REVISION", "The losing global revision race is deterministic.");
    const loser = raceResults[0].status === "rejected" ? [raceOne, raceOneValidating] : [raceTwo, raceTwoValidating];
    const terminalized = await store.failGenerationValidated({ ...loser[0], expectedOperationRevision: loser[1].revision, reason: "generation-not-ready" });
    assert.equal(terminalized.outcome, "validation-failed", "The stale global-revision loser remains resumable and terminalizable.");

    const disableRace = write({
      descriptorId: "sales.disable-race",
      expectedSettingsRevision: 2,
      idempotencyKey: "p11-pending-disable-race-0001",
      operationId: "settings-pending-disable-operation-1",
      receiptId: "settings-pending-disable-receipt-1",
      invalidationId: "settings-pending-disable-event-1",
      auditId: "settings-pending-disable-audit-1",
      changedFields: ["enabled"],
      values: { enabled: true }
    });
    const disablePending = await store.beginGenerationValidated(disableRace);
    const disableValidating = await store.transitionGenerationValidated({
      identity: disableRace.identity,
      operationId: disableRace.operation.operationId,
      expectedOperationRevision: disablePending.revision,
      state: "validating"
    });
    const lifecycle = await pool.connect();
    try {
      await lifecycle.query("begin");
      await lifecycle.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([applicationId, environment, "platform-plugin", "module.sales"])]);
      await lifecycle.query(
        `update runtime_extensions set disposition='disabled', active_generation_id=null, active_generation=null
         where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'`,
        [applicationId, environment]
      );
      let settled = false;
      const racedPromotion = store.promoteGenerationValidated({ ...disableRace, expectedOperationRevision: disableValidating.revision });
      void racedPromotion.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(settled, false, "Promotion waits behind the established lifecycle transaction lock.");
      await lifecycle.query("commit");
      await assert.rejects(racedPromotion, (error) => error?.code === "STATE");
    } finally {
      try { await lifecycle.query("rollback"); } catch { /* transaction already committed */ }
      lifecycle.release();
    }
    assert.equal((await store.read(disableRace.identity))?.document, undefined);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_system_settings_receipts where operation_id=$1", [disableRace.operation.operationId])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_system_settings_audit where operation_id=$1", [disableRace.operation.operationId])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_system_settings_outbox where event_id=$1", [disableRace.receipt.invalidationId])).rows[0].count, 0);
  } finally {
    try {
      await payload?.destroy();
      for (const client of payloadPool?._clients ?? []) {
        try { client.release(); } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("already been released")) throw error;
        }
      }
      await payloadPool?.end();
    } finally {
      try { await pool.end(); } finally {
        try { await container.stop(); } finally {
          if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = originalNodeEnv;
        }
      }
    }
  }
});
