import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { createAppStorageCapabilityHandlers, PostgresAppStorage } from "@k-nex/payload-adapter";
import { ExtensionCapabilityGateway, HmacExtensionCapabilityTokens, InMemoryExtensionCapabilitySequenceStoreForTests } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-4-storage-secret", BOOT_KEY: "p9-4-app-storage" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("proves revisioned, quota-limited, schema-validated, backed-up, cross-app isolated storage", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("app_storage").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const knownSecret = "never-store-this-secret";
  const storage = new PostgresAppStorage(pool, {
    validate(schemaId, value) {
      if (schemaId !== "sales.preferences" || typeof value !== "object" || value === null || Array.isArray(value) || typeof value.label !== "string") throw new Error("schema rejected");
      return { label: value.label };
    }
  }, {
    assertSafe(value) { if (JSON.stringify(value).includes(knownSecret)) throw new Error("secret material rejected"); }
  });
  const sales = { applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant", schemaId: "sales.preferences" };
  const forecast = { ...sales, appId: "app.forecast" };
  try {
    await boot(container.getConnectionUri());
    await storage.ensureNamespace(sales, 1, 256);
    await storage.ensureNamespace(forecast, 1, 256);
    await assert.rejects(storage.ensureNamespace(sales, 2, 256), { code: "NAMESPACE_CONFLICT" });
    const first = await storage.put(sales, "view.primary", { label: "Mine" }, 0);
    assert.equal(first.revision, 1);
    assert.equal(await storage.get(forecast, "view.primary"), undefined);
    await assert.rejects(storage.put(sales, "view.primary", { label: "Stale" }, 0), { code: "REVISION_CONFLICT" });
    await assert.rejects(storage.put(sales, "secret.probe", { label: knownSecret }, 0), /secret material rejected/u);
    await assert.rejects(storage.put(sales, "oversized", { label: "x".repeat(300) }, 0), { code: "QUOTA_EXCEEDED" });

    const raced = await Promise.allSettled([
      storage.put(sales, "view.primary", { label: "A" }, 1),
      storage.put(sales, "view.primary", { label: "B" }, 1)
    ]);
    assert.deepEqual(raced.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    assert.equal((await storage.query(sales, "view.", 10)).length, 1);

    const backup = await storage.exportBackup("customer-alpha", "production", "app.sales-assistant");
    await assert.rejects(storage.restoreBackup({ ...backup, digest: `sha256:${"0".repeat(64)}` }), { code: "BACKUP_INVALID" });
    const current = await storage.get(sales, "view.primary");
    await storage.delete(sales, "view.primary", current.revision);
    assert.equal(await storage.get(sales, "view.primary"), undefined);
    await storage.restoreBackup(backup);
    assert.deepEqual(await storage.get(sales, "view.primary"), backup.namespaces[0].records[0]);

    const namespaceRead = deferred();
    const mutationCommitted = deferred();
    const snapshotPool = {
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        return {
          release: () => client.release(),
          async query(statement, values) {
            const result = await client.query(statement, values);
            if (typeof statement === "string" && statement.includes("runtime_extension_storage_namespaces")) {
              namespaceRead.resolve();
              await mutationCommitted.promise;
            }
            return result;
          }
        };
      }
    };
    const snapshotStorage = new PostgresAppStorage(snapshotPool, {
      validate(schemaId, value) {
        if (schemaId !== "sales.preferences" || typeof value !== "object" || value === null || Array.isArray(value) || typeof value.label !== "string") throw new Error("schema rejected");
        return { label: value.label };
      }
    }, { assertSafe() {} });
    const snapshotExport = snapshotStorage.exportBackup("customer-alpha", "production", "app.sales-assistant");
    await namespaceRead.promise;
    const beforeConcurrentWrite = await storage.get(sales, "view.primary");
    await storage.put(sales, "view.primary", { label: "Concurrent" }, beforeConcurrentWrite.revision);
    mutationCommitted.resolve();
    const consistentSnapshot = await snapshotExport;
    assert.equal(consistentSnapshot.namespaces[0].revision, backup.namespaces[0].revision);
    assert.deepEqual(consistentSnapshot.namespaces[0].records, backup.namespaces[0].records, "backup namespace and records must come from one PostgreSQL snapshot");
    await storage.restoreBackup(consistentSnapshot);
    assert.deepEqual(await storage.get(sales, "view.primary"), consistentSnapshot.namespaces[0].records[0]);

    const restoreLockHeld = deferred();
    const releaseRestore = deferred();
    const mutationLockAttempted = deferred();
    const restoreStorage = new PostgresAppStorage({
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        return {
          release: () => client.release(),
          async query(statement, values) {
            const result = await client.query(statement, values);
            if (typeof statement === "string" && statement.includes("pg_advisory_xact_lock")) {
              restoreLockHeld.resolve();
              await releaseRestore.promise;
            }
            return result;
          }
        };
      }
    }, { validate: (_schemaId, value) => value }, { assertSafe() {} });
    const mutationStorage = new PostgresAppStorage({
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        return {
          release: () => client.release(),
          query(statement, values) {
            if (typeof statement === "string" && statement.includes("pg_advisory_xact_lock")) mutationLockAttempted.resolve();
            return client.query(statement, values);
          }
        };
      }
    }, { validate: (_schemaId, value) => value }, { assertSafe() {} });
    const restore = restoreStorage.restoreBackup(consistentSnapshot);
    await restoreLockHeld.promise;
    const mutation = mutationStorage.put(sales, "view.primary", { label: "After restore" }, consistentSnapshot.namespaces[0].records[0].revision);
    await mutationLockAttempted.promise;
    try {
      assert.equal(await Promise.race([
        mutation.then(() => true, () => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 25))
      ]), false, "mutation must wait for restore's application lock");
    } finally {
      releaseRestore.resolve();
    }
    const mutationRecord = await mutation;
    await restore;
    assert.equal(mutationRecord.revision, consistentSnapshot.namespaces[0].records[0].revision + 1);
    assert.deepEqual(mutationRecord.value, { label: "After restore" });
    assert.deepEqual(await storage.get(sales, "view.primary"), mutationRecord, "mutation must apply after restored state, never be lost beneath restore");

    const now = { now: () => new Date("2026-08-29T10:00:00.000Z") };
    const tokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(4), now);
    const token = tokens.issue({
      tokenId: "storage-token-1", applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant",
      generationId: "sales-assistant-generation-1", invocationId: "storage-invocation-1", actor: { principalId: "user:one", effectiveActorId: "user:one" },
      correlationId: "storage-correlation-1", grants: [{ kind: "app-storage", required: true, reason: "Read saved sales assistant preferences.", operations: ["get"], schemaIds: ["sales.preferences"] }], ttlMs: 30_000
    });
    const gateway = new ExtensionCapabilityGateway(tokens, createAppStorageCapabilityHandlers(storage), { reauthorize: () => true }, new InMemoryExtensionCapabilitySequenceStoreForTests(now), now, { maxInputBytes: 1024, maxOutputBytes: 2048, maxDepth: 8, maxCalls: 4 });
    await assert.rejects(gateway.invoke({
      token, invocationId: "storage-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "app-storage.get",
      payload: { applicationId: "other-customer", appId: "app.forecast", schemaId: "sales.preferences", key: "view.primary" }, signal: new AbortController().signal
    }), { code: "KEY_INVALID" });
    const throughGateway = await gateway.invoke({
      token, invocationId: "storage-invocation-1", generationId: "sales-assistant-generation-1", sequence: 1, capability: "app-storage.get",
      payload: { schemaId: "sales.preferences", key: "view.primary" }, signal: new AbortController().signal
    });
    assert.deepEqual(throughGateway, mutationRecord, "capability storage must use token-bound namespace identity");
    await assert.rejects(gateway.invoke({
      token, invocationId: "storage-invocation-1", generationId: "sales-assistant-generation-1", sequence: 2, capability: "app-storage.get",
      payload: { schemaId: "sales.private", key: "view.primary" }, signal: new AbortController().signal
    }), { code: "CAPABILITY_DENIED" }, "a token for one manifest-declared storage schema must not read a sibling schema");
  } finally {
    await pool.end();
    await container.stop();
  }
});
