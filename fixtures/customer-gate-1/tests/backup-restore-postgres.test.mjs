import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { backupIsRestorable } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";

test("proves a physical backup restores complete Sales runtime state into a clean database", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("backup_source").withStartupTimeout(120_000).start();
  const source = new pg.Pool({ connectionString: container.getConnectionUri() });
  let restored;
  try {
    await source.query(`
      create table sales_tasks (id integer primary key, title text not null);
      create table payload_versions (id integer primary key, document jsonb not null);
      create table workspace_layouts (id integer primary key, layout jsonb not null);
      create table runtime_settings (id integer primary key, external_integrations_enabled boolean not null);
      create table durable_outbox (id integer primary key, status text not null);
      create table k_nex_release_revision (application_id text primary key, predecessor_revision integer not null, revision integer not null, release_revision text not null);
      insert into sales_tasks values (1, 'restore me');
      insert into payload_versions values (1, '{"version":2}');
      insert into workspace_layouts values (1, '{"theme":"minimal"}');
      insert into runtime_settings values (1, true);
      insert into durable_outbox values (1, 'delivered');
      insert into k_nex_release_revision values ('customer.alpha', 6, 7, 'release-7');
    `);

    const user = container.getUsername();
    const sourceDatabase = container.getDatabase();
    const dump = await container.exec(["pg_dump", "-U", user, "-Fc", "-f", "/tmp/customer.backup", sourceDatabase]);
    assert.equal(dump.exitCode, 0, dump.stderr);
    const checksum = await container.exec(["sha256sum", "/tmp/customer.backup"]);
    assert.equal(checksum.exitCode, 0, checksum.stderr);
    const contentDigest = `sha256:${checksum.stdout.trim().split(/\s+/u)[0]}`;
    const create = await container.exec(["createdb", "-U", user, "restore_clean"]);
    assert.equal(create.exitCode, 0, create.stderr);
    const restore = await container.exec(["pg_restore", "-U", user, "-d", "restore_clean", "--exit-on-error", "/tmp/customer.backup"]);
    assert.equal(restore.exitCode, 0, restore.stderr);

    const restoredUrl = new URL(container.getConnectionUri());
    restoredUrl.pathname = "/restore_clean";
    restored = new pg.Pool({ connectionString: restoredUrl.toString() });
    await restored.query("update runtime_settings set external_integrations_enabled = false");
    const evidence = await restored.query(`
      select
        (select title from sales_tasks where id = 1) as task,
        (select document->>'version' from payload_versions where id = 1) as content_version,
        (select layout->>'theme' from workspace_layouts where id = 1) as theme,
        (select external_integrations_enabled from runtime_settings where id = 1) as integrations_enabled,
        (select status from durable_outbox where id = 1) as outbox_status,
        (select revision from k_nex_release_revision where application_id = 'customer.alpha') as migration_revision
    `);
    assert.deepEqual(evidence.rows, [{ task: "restore me", content_version: "2", theme: "minimal", integrations_enabled: false, outbox_status: "delivered", migration_revision: 7 }]);
    assert.equal(backupIsRestorable(
      { backupId: "customer-alpha-7", contentDigest, applicationId: "customer.alpha", completed: true },
      { backupId: "customer-alpha-7", sourceDigest: contentDigest, cleanEnvironment: true, externalEffects: "disabled", migrationRevision: 7, runtimeInventoryDigest: `sha256:${"b".repeat(64)}` }
    ), true);
  } finally {
    await restored?.end();
    await source.end();
    await container.stop();
  }
});
