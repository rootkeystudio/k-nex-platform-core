import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { backupIsRestorable, executeCleanRestore, executeDatabaseBackup, observeRuntimeInventory, restoredInventoryMatches, runtimeInventoryDigest } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";

function memoryStore() {
  const values = new Map();
  return {
    async write({ content, encryptionKeyReference }) {
      const chunks = [];
      const hash = createHash("sha256");
      let byteLength = 0;
      for await (const chunk of content) { const copy = Buffer.from(chunk); chunks.push(copy); hash.update(copy); byteLength += copy.byteLength; }
      const storageKey = `sha256:${hash.digest("hex")}`;
      values.set(storageKey, chunks);
      return { storageKey, byteLength, encryptionKeyReference };
    },
    async *read(storageKey) {
      const chunks = values.get(storageKey);
      if (!chunks) throw new Error("backup object missing");
      yield* chunks;
    }
  };
}

test("proves a physical backup restores complete Sales runtime state into a clean database", { timeout: 180_000 }, async () => {
  const expectedInventory = observeRuntimeInventory(JSON.parse(readFileSync(new URL("../../customer-alpha/runtime-inventory.json", import.meta.url), "utf8")));
  const expectedMigrationRevision = expectedInventory.migrationRevision;
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
      insert into k_nex_release_revision values ('customer.alpha', ${expectedMigrationRevision - 1}, ${expectedMigrationRevision}, 'release-${expectedMigrationRevision}');
    `);

    const user = container.getUsername();
    const sourceDatabase = container.getDatabase();
    const dump = await container.exec(["pg_dump", "-U", user, "-Fc", "-f", "/tmp/customer.backup", sourceDatabase]);
    assert.equal(dump.exitCode, 0, dump.stderr);
    const encodedBackup = await container.exec(["base64", "/tmp/customer.backup"]);
    assert.equal(encodedBackup.exitCode, 0, encodedBackup.stderr);
    const backupContent = Buffer.from(encodedBackup.stdout.replace(/\s/gu, ""), "base64");
    const store = memoryStore();
    const backup = await executeDatabaseBackup({
      backupId: `customer-alpha-${expectedMigrationRevision}`, applicationId: "customer.alpha", pluginId: "module.sales", migrationRevision: expectedMigrationRevision,
      executor: {
        store, maximumBytes: 64 * 1024 * 1024, encryptionKeyReference: "secret:backup/customer-alpha",
        createBackup: async function* () { for (let offset = 0; offset < backupContent.byteLength; offset += 16 * 1024) yield backupContent.subarray(offset, offset + 16 * 1024); }
      }
    });
    let restoredInventory;
    const restoreProof = await executeCleanRestore(backup, {
      restoreCleanEnvironment: async ({ applicationId, pluginId, migrationRevision, content, contentDigest }) => {
        const create = await container.exec(["createdb", "-U", user, "restore_clean"]);
        assert.equal(create.exitCode, 0, create.stderr);
        await container.copyContentToContainer([{ content: Readable.from(content), target: "/tmp/restored-by-receipt.backup" }]);
        const restore = await container.exec(["pg_restore", "-U", user, "-d", "restore_clean", "--exit-on-error", "/tmp/restored-by-receipt.backup"]);
        assert.equal(restore.exitCode, 0, restore.stderr);
        assert.match(contentDigest, /^sha256:[0-9a-f]{64}$/u);
        const restoredUrl = new URL(container.getConnectionUri());
        restoredUrl.pathname = "/restore_clean";
        const observer = new pg.Pool({ connectionString: restoredUrl.toString() });
        try {
          await observer.query("update runtime_settings set external_integrations_enabled = false");
          const state = await observer.query("select revision from k_nex_release_revision where application_id = 'customer.alpha'");
          restoredInventory = observeRuntimeInventory({ ...expectedInventory, observedAt: "2026-08-27T13:00:00.000Z", migrationRevision: state.rows[0].revision });
        } finally { await observer.end(); }
        return { applicationId, pluginId, migrationRevision, cleanEnvironment: true, externalEffects: "disabled", runtimeInventoryDigest: runtimeInventoryDigest(restoredInventory) };
      }
    });

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
    assert.deepEqual(evidence.rows, [{ task: "restore me", content_version: "2", theme: "minimal", integrations_enabled: false, outbox_status: "delivered", migration_revision: expectedMigrationRevision }]);
    assert.equal(restoredInventoryMatches(expectedInventory, restoredInventory), true);
    assert.equal(backupIsRestorable(backup, restoreProof), true);
  } finally {
    await restored?.end();
    await source.end();
    await container.stop();
  }
});
