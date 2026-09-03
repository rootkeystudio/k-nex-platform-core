import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresSystemOperationsStore, SystemOperationsWorker } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-system-operations";
const environment = "production";
const inventoryDigest = `sha256:${"a".repeat(64)}`;
const actor = { kind: "user", id: "user:owner" };

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], { cwd: fixtureDirectory, env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p11-7-system-operations", BOOT_KEY: "p11-7-system-operations" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject).once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function request(kind, expectedOperationsRevision, idempotencyKey, requestedBy = actor, digest = inventoryDigest) {
  return { kind, applicationId, environment, expectedOperationsRevision, expectedInventoryDigest: digest, requestedBy, authorityEnvelope: envelope(kind, requestedBy), idempotencyKey };
}

function envelope(kind, requestedBy = actor) {
  return {
    schemaVersion: 1, applicationId, environment, principal: requestedBy, effectiveActor: requestedBy,
    authorizationRevision: 1, lifecycleRevision: 1,
    permissions: [{ decisionId: `decision-${kind}-1`, permissionId: kind === "backup" ? "system.operations.backup" : "system.operations.restore-drill", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.operations" } }]
  };
}

async function authorityDigest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

test("P11.7 persists replay-safe backup and restore-drill authority with leases, audit, and outbox", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("system_operations").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const clock = { now: () => new Date("2026-09-02T00:00:00.000Z") };
    const store = new PostgresSystemOperationsStore(pool, clock);
    await store.initialize({ applicationId, environment, inventoryDigest });

    const accepted = await store.submit(request("backup", 0, "backup-idempotency-1"));
    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.executionAuthority, "system-after-acceptance");
    assert.deepEqual(await store.submit(request("backup", 0, "backup-idempotency-1")), accepted, "response-loss retry returns exact accepted receipt");
    assert.equal(accepted.authorityDigest, await authorityDigest(envelope("backup")));
    assert.deepEqual(await store.replay({ kind: "backup", applicationId, environment, expectedOperationsRevision: 0, requestedBy: actor, authorityEnvelope: envelope("backup"), idempotencyKey: "backup-idempotency-1" }), accepted);
    const other = { kind: "user", id: "user:other" };
    await assert.rejects(store.replay({ kind: "backup", applicationId, environment, expectedOperationsRevision: 0, requestedBy: other, authorityEnvelope: envelope("backup", other), idempotencyKey: "backup-idempotency-1" }), { code: "REVISION_CONFLICT" });

    const claimed = await store.claim({ applicationId, environment, workerId: "backup-worker-1", leaseSeconds: 30 });
    assert.ok(claimed);
    await assert.rejects(store.complete(claimed.request.reference.operationId, claimed.leaseToken, { outcome: "completed", referenceReceiptId: "backup-proof-1" }), { code: "PROOF_INVALID" });
    const completed = await store.complete(claimed.request.reference.operationId, claimed.leaseToken, { outcome: "completed", referenceReceiptId: "backup-proof-1", cleanEnvironmentRestore: true });
    assert.equal(completed.outcome, "completed");
    assert.equal(completed.executionAuthority, "system-after-acceptance");
    assert.deepEqual(await store.submit(request("backup", 0, "backup-idempotency-1")), completed, "terminal replay returns exact immutable receipt");
    assert.deepEqual(await store.complete(claimed.request.reference.operationId, claimed.leaseToken, { outcome: "completed", referenceReceiptId: "backup-proof-1", cleanEnvironmentRestore: true }), completed, "post-commit response loss is idempotent");

    const restoreAccepted = await store.submit(request("restore-drill", 2, "restore-idempotency-1"));
    const firstLease = await store.claim({ applicationId, environment, workerId: "restore-worker-1", leaseSeconds: 30 });
    assert.ok(firstLease);
    await pool.query("update k_nex_system_operation_requests set lease_expires_at=now()-interval '1 second' where operation_id=$1", [firstLease.request.reference.operationId]);
    const secondLease = await store.claim({ applicationId, environment, workerId: "restore-worker-2", leaseSeconds: 30 });
    assert.ok(secondLease);
    assert.notEqual(secondLease.leaseToken, firstLease.leaseToken);
    await assert.rejects(store.complete(firstLease.request.reference.operationId, firstLease.leaseToken, { outcome: "failed", reason: "operator-unavailable", referenceReceiptId: "restore-proof-old" }), { code: "LEASE_CONFLICT" });
    await pool.query("update k_nex_system_operation_requests set state='pending', lease_owner=null, lease_token=null, lease_expires_at=null where operation_id=$1", [secondLease.request.reference.operationId]);
    const worker = new SystemOperationsWorker(store, { async execute() { throw new Error("raw operator secret must be contained"); } });
    const failed = await worker.runNext({ applicationId, environment, workerId: "restore-worker-3", leaseSeconds: 30 });
    assert.ok(failed);
    assert.equal(failed.outcome, "failed");
    assert.equal(restoreAccepted.requestId, failed.requestId);

    const current = await store.state(applicationId, environment);
    assert.equal(current.operationsRevision, 4);
    const counts = (await pool.query(`select
      (select count(*)::int from k_nex_system_operation_requests) requests,
      (select count(*)::int from k_nex_system_operation_receipts) receipts,
      (select count(*)::int from k_nex_system_operation_audit) audits,
      (select count(*)::int from k_nex_system_operation_outbox) outbox`)).rows[0];
    assert.deepEqual(counts, { requests: 2, receipts: 4, audits: 4, outbox: 4 });
    await assert.rejects(pool.query("update k_nex_system_operation_receipts set receipt_json='{}'::jsonb where receipt_id=$1", [accepted.receiptId]), /immutable/u);
    const audit = (await pool.query("select authority_json, authority_digest, execution_authority from k_nex_system_operation_audit order by created_at limit 1")).rows[0];
    assert.equal(audit.authority_digest, accepted.authorityDigest);
    assert.equal(audit.execution_authority, "system-after-acceptance");
    assert.deepEqual(audit.authority_json.principal, actor);
    const serialized = JSON.stringify(await pool.query("select request_json, authority_json, receipt_json from k_nex_system_operation_requests cross join k_nex_system_operation_receipts limit 1"));
    assert.doesNotMatch(serialized, /password|credential|encryptionKey|rawError/u);
    console.log("P11_7_SYSTEM_OPERATIONS_POSTGRES_EVIDENCE=PASS");
  } finally {
    await pool.end();
    await container.stop();
  }
});
