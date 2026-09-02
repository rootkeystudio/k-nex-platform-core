import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  currentProtectedPlatformRoleBaselineRelease,
  protectedPlatformRoleLabels,
  protectedRoleBaselineReconciliationOperation,
  protectedRoleBaselineReconciliationTarget,
  protectedRoleBootstrapId,
  reconcileProtectedRoleBaseline,
  recognizedProtectedPlatformRoleBaselineReleases
} from "@k-nex/runtime";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const environment = "production";
const prior = recognizedProtectedPlatformRoleBaselineReleases.find(({ version }) => version === 1);
assert.ok(prior, "The v1 protected baseline must remain a compiled upgrade source.");

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        NODE_ENV: "production",
        PAYLOAD_SECRET: "p10-protected-baseline-upgrade",
        BOOT_KEY: "p10-protected-baseline-upgrade"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function expected(state, applicationId) {
  return { applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
}

function audit(applicationId, state, suffix) {
  return {
    schemaVersion: 1,
    auditId: `protected-baseline-audit-${suffix}`,
    decisionId: `protected-baseline-decision-${suffix}`,
    correlationId: `protected-baseline-correlation-${suffix}`,
    applicationId,
    environment,
    permissionId: "system.roles.manage",
    owner: { kind: "platform", namespace: "system" },
    principal: { kind: "user", id: "user:release-operator" },
    effectiveActor: { kind: "user", id: "user:release-operator" },
    scope: { kind: "application", resource: "system.roles" },
    operation: protectedRoleBaselineReconciliationOperation,
    target: protectedRoleBaselineReconciliationTarget,
    authorizationRevision: state.authorizationRevision,
    lifecycleRevision: state.lifecycleRevision,
    outcome: "allow",
    reason: "granted",
    approval: "not-required",
    reauthentication: "not-required"
  };
}

async function seedRecognizedV1(pool, applicationId, options = {}) {
  await pool.query(
    "insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1, 7, 0)",
    [applicationId]
  );
  for (const baseline of prior.baselines) {
    await pool.query(
      "insert into k_nex_roles (application_id, role_id, label, protected_role_id, revision) values ($1,$2,$3,$2,1)",
      [applicationId, baseline.id, protectedPlatformRoleLabels[baseline.id]]
    );
    for (const permissionId of baseline.permissionIds) {
      await pool.query(
        `insert into k_nex_role_permission_grants
         (application_id, grant_id, role_id, permission_id, owner_kind, owner_namespace, revision)
         values ($1,$2,$3,$4,'platform','system',1)`,
        [applicationId, protectedRoleBootstrapId(applicationId, "grant", baseline.id, permissionId), baseline.id, permissionId]
      );
    }
  }
  if (options.tamperGrant === true) {
    await pool.query(
      "update k_nex_role_permission_grants set permission_id='system.settings.manage' where application_id=$1 and role_id='system.role.user-admin' and permission_id='system.permissions.read'",
      [applicationId]
    );
  }
  await pool.query(
    `insert into k_nex_role_assignments (application_id, assignment_id, role_id, subject_kind, subject_id, state, revision)
     values ($1,'protected-v1-owner','system.role.owner','user','user:owner','active',1)`,
    [applicationId]
  );
  await pool.query(
    `insert into k_nex_authorization_bootstrap_receipts
     (application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, protected_baseline_version, protected_baseline_digest, authorization_revision, state)
     values ($1,'protected-v1-receipt','system.role.owner','protected-v1-owner','user','user:owner',$2,$3,1,'committed')`,
    [applicationId, prior.version, options.tamperDigest === true ? `sha256:${"0".repeat(64)}` : prior.digest]
  );
}

async function durableCounts(pool, applicationId) {
  const [state, grants, receipts, audits, outbox] = await Promise.all([
    pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId]),
    pool.query("select grant_id, role_id, permission_id, owner_kind, owner_namespace from k_nex_role_permission_grants where application_id=$1 and role_id like 'system.role.%' order by grant_id", [applicationId]),
    pool.query("select protected_baseline_version, protected_baseline_digest, authorization_revision from k_nex_authorization_bootstrap_receipts where application_id=$1", [applicationId]),
    pool.query("select audit_id from k_nex_authorization_audit where application_id=$1 order by audit_id", [applicationId]),
    pool.query("select event_id from k_nex_authorization_outbox where application_id=$1 order by event_id", [applicationId])
  ]);
  return { state: state.rows, grants: grants.rows, receipts: receipts.rows, audits: audits.rows, outbox: outbox.rows };
}

test("reconciles only an exact recognized protected baseline through real PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("protected_baseline_upgrade").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const store = new PostgresAuthorizationStore(pool);
    const misuseApplicationId = "customer-protected-direct-misuse";
    await seedRecognizedV1(pool, misuseApplicationId);
    const misuseState = await store.readState(misuseApplicationId, environment);
    assert.ok(misuseState);
    const misuseBefore = await durableCounts(pool, misuseApplicationId);
    await assert.rejects(store.reconcileProtectedRoleBaselineTransaction(
      expected(misuseState, misuseApplicationId),
      { version: prior.version, digest: prior.digest },
      async (transaction) => {
        const receipt = await transaction.readBootstrapReceipt(misuseApplicationId);
        assert.ok(receipt);
        await transaction.write({ kind: "bootstrap-receipt", receipt: {
          ...receipt,
          protectedBaselineVersion: currentProtectedPlatformRoleBaselineRelease.version,
          protectedBaselineDigest: currentProtectedPlatformRoleBaselineRelease.digest,
          authorizationRevision: misuseState.authorizationRevision + 1
        } });
        await transaction.write({ kind: "audit", audit: audit(misuseApplicationId, misuseState, "direct-misuse") });
      }
    ), { code: "REVISION_CONFLICT" });
    assert.deepEqual(await durableCounts(pool, misuseApplicationId), misuseBefore, "Direct receipt-only capability misuse rolls back without revision or durable writes.");
    await assert.rejects(store.reconcileProtectedRoleBaselineTransaction(
      expected(misuseState, misuseApplicationId),
      { version: prior.version, digest: `sha256:${"0".repeat(64)}` },
      async () => assert.fail("Unknown predecessor must fail before the reconciliation callback.")
    ), { code: "MUTATION_INVALID" });
    assert.deepEqual(await durableCounts(pool, misuseApplicationId), misuseBefore, "Unknown direct predecessor rolls back without writes.");

    const applicationId = "customer-protected-upgrade";
    await seedRecognizedV1(pool, applicationId);
    const before = await store.readState(applicationId, environment);
    assert.ok(before);

    const upgraded = await reconcileProtectedRoleBaseline({
      store,
      expected: expected(before, applicationId),
      expectedPrior: { version: prior.version, digest: prior.digest },
      audit: audit(applicationId, before, "success")
    });
    assert.deepEqual([upgraded.state.authorizationRevision, upgraded.state.lifecycleRevision], [8, 0]);
    assert.deepEqual([upgraded.value.protectedBaselineVersion, upgraded.value.protectedBaselineDigest, upgraded.value.authorizationRevision], [
      currentProtectedPlatformRoleBaselineRelease.version,
      currentProtectedPlatformRoleBaselineRelease.digest,
      8
    ]);
    const grants = await pool.query(
      "select role_id, array_agg(permission_id order by permission_id) as permission_ids from k_nex_role_permission_grants where application_id=$1 and role_id like 'system.role.%' group by role_id order by role_id",
      [applicationId]
    );
    assert.deepEqual(grants.rows, currentProtectedPlatformRoleBaselineRelease.baselines.map(({ id, permissionIds }) => ({ role_id: id, permission_ids: permissionIds })).sort((left, right) => left.role_id.localeCompare(right.role_id)));
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and subject_kind='user' and state='active'", [applicationId])).rows[0].count, 1);
    assert.deepEqual((await pool.query(
      "select audit_json->>'operation' as operation, audit_json->>'target' as target, authorization_revision, lifecycle_revision from k_nex_authorization_audit where application_id=$1",
      [applicationId]
    )).rows, [{ operation: protectedRoleBaselineReconciliationOperation, target: protectedRoleBaselineReconciliationTarget, authorization_revision: 7, lifecycle_revision: 0 }]);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and authorization_revision=8 and lifecycle_revision=0", [applicationId])).rows[0].count, 1);

    const afterSuccess = await durableCounts(pool, applicationId);
    await assert.rejects(reconcileProtectedRoleBaseline({
      store,
      expected: expected(upgraded.state, applicationId),
      expectedPrior: { version: prior.version, digest: prior.digest },
      audit: audit(applicationId, upgraded.state, "replay")
    }), { code: "REVISION_CONFLICT" });
    assert.deepEqual(await durableCounts(pool, applicationId), afterSuccess, "Replay conflicts without writes.");

    for (const [suffix, options] of [["grant", { tamperGrant: true }], ["digest", { tamperDigest: true }]]) {
      const tamperedApplicationId = `customer-protected-${suffix}-tamper`;
      await seedRecognizedV1(pool, tamperedApplicationId, options);
      const tamperedState = await store.readState(tamperedApplicationId, environment);
      assert.ok(tamperedState);
      const tamperedBefore = await durableCounts(pool, tamperedApplicationId);
      await assert.rejects(reconcileProtectedRoleBaseline({
        store,
        expected: expected(tamperedState, tamperedApplicationId),
        expectedPrior: { version: prior.version, digest: prior.digest },
        audit: audit(tamperedApplicationId, tamperedState, suffix)
      }), { code: "REVISION_CONFLICT" });
      assert.deepEqual(await durableCounts(pool, tamperedApplicationId), tamperedBefore, `Tampered ${suffix} prior state fails closed without writes.`);
    }
  } finally {
    try {
      await pool.end();
    } finally {
      await container.stop();
    }
  }
});
