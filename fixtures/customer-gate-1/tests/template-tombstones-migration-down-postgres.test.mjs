import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { digestTemplateBaseline } from "@k-nex/runtime";
import { buildConfig, getPayload } from "payload";
import pg from "pg";

import { createGate1Application } from "../dist/src/create-application.js";
import { migrations } from "../dist/src/migrations/index.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "customer-template-tombstone-down";
const tombstoneMigration = migrations.at(-2);
const migrationDirectory = fileURLToPath(new URL("../src/migrations/", import.meta.url));

test("rolls back independent template tombstones through Payload's migration API", { timeout: 180_000 }, async () => {
  assert.ok(tombstoneMigration);
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("template_tombstone_down").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  pool.on("error", () => {});
  const nodeEnvironment = process.env.NODE_ENV;
  let payload;
  let payloadPool;
  try {
    process.env.NODE_ENV = "production";
    const application = createGate1Application({
      databaseUrl: container.getConnectionUri(),
      migrations: migrations.slice(0, -2),
      payloadSecret: "p10-6-template-tombstone-down"
    });
    payload = await getPayload({ config: buildConfig(application.config), key: "p10-6-template-tombstone-down" });
    payloadPool = payload.db.pool;
    payloadPool.on("error", () => {});
    payload.db.migrationDir = migrationDirectory;
    await payload.db.migrate({ migrations: [tombstoneMigration] });

    await pool.query(
      `insert into k_nex_extension_authorization_generations
        (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state)
       values ($1, 'platform-plugin', 'module.sales', 1, '["sales-template-generation"]'::jsonb, 'current')`,
      [applicationId]
    );
    await pool.query(
      `insert into k_nex_role_template_adoptions
        (application_id, adoption_id, role_id, template_id, publisher_delivery_class, publisher_extension_id,
         owner_delivery_class, owner_extension_id, owner_generation, template_version, old_baseline_permission_ids,
         digest_algorithm, old_baseline_digest, kind, state, revision)
       values ($1, 'sales.template.rollback-probe.tombstone', null, 'sales.template.rollback-probe',
         'platform-plugin', 'module.sales', 'platform-plugin', 'module.sales', 1, 1, '["sales.tasks.read"]'::jsonb,
         'sha256-canonical-json-v1', $2, 'instantiated-role', 'tombstoned', 0)`,
      [applicationId, digestTemplateBaseline(["sales.tasks.read"])]
    );

    await payload.db.migrateDown();

    assert.deepEqual((await pool.query(
      "select count(*)::int as count from k_nex_role_template_adoptions where application_id=$1",
      [applicationId]
    )).rows, [{ count: 0 }]);
    assert.deepEqual((await pool.query(
      `select attnotnull from pg_attribute
       where attrelid = 'k_nex_role_template_adoptions'::regclass and attname = 'role_id' and not attisdropped`
    )).rows, [{ attnotnull: true }]);
    assert.deepEqual((await pool.query(
      `select conname from pg_constraint
       where conrelid = 'k_nex_role_template_adoptions'::regclass
         and conname = 'k_nex_role_template_adoptions_tombstone_role_check'`
    )).rows, []);
    assert.deepEqual((await pool.query(
      "select to_regclass('public.k_nex_role_template_adoptions_tombstone_identity_key')::text as index_name"
    )).rows, [{ index_name: null }]);
    assert.deepEqual((await pool.query(
      "select predecessor_revision, revision from k_nex_migration_revision where id=1"
    )).rows, [{ predecessor_revision: 18, revision: 19 }]);
    assert.deepEqual((await pool.query(
      "select count(*)::int as count from payload_migrations where name=$1",
      [tombstoneMigration.name]
    )).rows, [{ count: 0 }]);

    await payload.db.migrate({ migrations: [tombstoneMigration] });
    assert.deepEqual((await pool.query(
      "select predecessor_revision, revision from k_nex_migration_revision where id=1"
    )).rows, [{ predecessor_revision: 19, revision: 20 }]);
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
          if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = nodeEnvironment;
        }
      }
    }
  }
});
