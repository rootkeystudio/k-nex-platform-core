import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const supervisorLogin = "p10_static_lifecycle_supervisor";
const supervisorPassword = "p10-static-lifecycle-supervisor-password";
const identity = Object.freeze({ applicationId: "customer-alpha", environment: "production", extensionId: "module.sales" });
const operationId = "static-lifecycle-admission-operation";
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sharedGeneration = Object.freeze({
  generationId: "shared-green-12", sourceCommit: "b".repeat(40), compositionChangePlanDigest: digest("change"),
  buildEvidenceDigest: digest("build"), applicationDigest: digest("application"), imageDigest: digest("image"),
  imageReference: `ghcr.io/k-nex/customer@${digest("image")}`, migrationRevision: 12
});
const sharedReceipt = Object.freeze({
  schemaVersion: 1, receiptId: "receipt-shared-green-12", operation: "promote", applicationId: identity.applicationId,
  environment: identity.environment, activeGenerationId: sharedGeneration.generationId, previousGenerationId: "shared-blue-11",
  sourceCommit: sharedGeneration.sourceCommit, compositionChangePlanDigest: sharedGeneration.compositionChangePlanDigest,
  buildEvidenceDigest: sharedGeneration.buildEvidenceDigest, applicationDigest: sharedGeneration.applicationDigest,
  imageDigest: sharedGeneration.imageDigest, migrationRevision: 12, workerFencingToken: 2, promotionRevision: 1,
  revisionBefore: 0, revisionAfter: 1,
  rollbackWindow: { state: "open", windowId: "window-shared-green-12", closesAt: "2026-09-02T00:00:00.000Z" },
  contractCleanup: "blocked", occurredAt: "2026-09-01T00:00:00.000Z"
});

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-static-lifecycle-admission", BOOT_KEY: "p10-static-lifecycle-admission" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function roleConnection(connectionString) {
  const url = new URL(connectionString);
  url.username = supervisorLogin;
  url.password = supervisorPassword;
  return url.toString();
}

async function waitForLockedUpdate(pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query(
      "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'update runtime_extensions set revision=revision+1%' limit 1"
    );
    if (result.rowCount === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Lifecycle writer did not block on the supervisor admission row lock.");
}

test("first-install crash stays on the prior generation and blocks a second plugin promotion", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_first_install_crash").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const owner = { applicationId: "customer-first-install", environment: "production" };
  const baseGeneration = { ...sharedGeneration, generationId: "first-install-blue-1", migrationRevision: 1 };
  const targetGeneration = { ...sharedGeneration, generationId: "first-install-green-2", migrationRevision: 2 };
  const receipt = {
    ...sharedReceipt,
    receiptId: "receipt-first-install-green-2",
    applicationId: owner.applicationId,
    activeGenerationId: targetGeneration.generationId,
    previousGenerationId: baseGeneration.generationId,
    migrationRevision: targetGeneration.migrationRevision
  };
  let buildRead = false;
  try {
    await boot(container.getConnectionUri());
    await pool.query(
      `INSERT INTO runtime_static_deployments (
         application_id, environment, revision, active_generation_id, active_generation,
         rollback_generation_id, rollback_generation, rollback_window, state_digest
       ) VALUES ($1,$2,1,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8)`,
      [owner.applicationId, owner.environment, targetGeneration.generationId, JSON.stringify(targetGeneration),
        baseGeneration.generationId, JSON.stringify(baseGeneration), JSON.stringify(receipt.rollbackWindow), digest("first-install-state")]
    );
    await pool.query(
      `INSERT INTO runtime_worker_generation_fences (
         application_id, environment, active_execution_generation, fencing_token, lease_owner, lease_expires_at, promotion_revision
       ) VALUES ($1,$2,$3,2,'worker:first-install',now() + interval '5 minutes',1)`,
      [owner.applicationId, owner.environment, targetGeneration.generationId]
    );
    await pool.query(
      `INSERT INTO runtime_static_deployment_outbox (event_id, application_id, environment, revision, event_json)
       VALUES ($1,$2,$3,1,$4::jsonb)`,
      [receipt.receiptId, owner.applicationId, owner.environment, JSON.stringify(receipt)]
    );
    await pool.query(
      `INSERT INTO runtime_extensions (
         application_id, environment, delivery_class, extension_id, revision, disposition, last_operation_id
       ) VALUES
         ($1,$2,'platform-plugin','module.sales',0,'removed','operation-first-install-sales'),
         ($1,$2,'platform-plugin','provider.realtime.socketio',0,'removed','operation-second-provider')`,
      [owner.applicationId, owner.environment]
    );

    assert.deepEqual((await pool.query(
      "select public.k_nex_static_serving_generation($1,$2) generation_id",
      [owner.applicationId, owner.environment]
    )).rows, [{ generation_id: baseGeneration.generationId }], "A promoted first install must not serve before its exact lifecycle receipt converges.");

    const before = {
      deployment: (await pool.query("select * from runtime_static_deployments where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      fence: (await pool.query("select * from runtime_worker_generation_fences where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      outbox: (await pool.query("select * from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      extensions: (await pool.query("select * from runtime_extensions where application_id=$1 and environment=$2 order by extension_id", [owner.applicationId, owner.environment])).rows
    };
    const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date("2026-09-01T00:00:00.000Z") }, {
      read() { buildRead = true; throw new Error("An unconverged deployment must reject before reading another plugin build."); }
    });
    await assert.rejects(store.promote({
      ...owner,
      expectedRevision: 1,
      expectedFenceToken: 2,
      generationId: "first-install-provider-green-3",
      workerOwner: "worker:second-provider",
      workerLeaseExpiresAt: "2026-09-01T00:05:00.000Z",
      build: {},
      readiness: {},
      lifecycleAdmission: { operationId: "operation-second-provider", expectedRevision: 0, extensionId: "provider.realtime.socketio", quarantineRecovery: false }
    }), { code: "REVISION_CONFLICT" });
    assert.equal(buildRead, false);
    assert.deepEqual({
      deployment: (await pool.query("select * from runtime_static_deployments where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      fence: (await pool.query("select * from runtime_worker_generation_fences where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      outbox: (await pool.query("select * from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      extensions: (await pool.query("select * from runtime_extensions where application_id=$1 and environment=$2 order by extension_id", [owner.applicationId, owner.environment])).rows
    }, before, "A second plugin operation must be transactionally inert while the first promotion is unconverged.");
  } finally {
    await pool.end();
    await container.stop();
  }
});

test("static lifecycle admission gives the supervisor one locked read without lifecycle table grants", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_lifecycle_admission").withStartupTimeout(120_000).start();
  const admin = new pg.Pool({ connectionString: container.getConnectionUri() });
  const supervisor = new pg.Client({ connectionString: roleConnection(container.getConnectionUri()) });
  let connected = false;
  let transaction = false;
  try {
    await boot(container.getConnectionUri());
    await admin.query(`
      CREATE ROLE ${supervisorLogin} LOGIN PASSWORD '${supervisorPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO ${supervisorLogin};
      GRANT EXECUTE ON FUNCTION public.k_nex_static_lifecycle_admission(character varying, character varying, character varying, character varying) TO ${supervisorLogin};
      GRANT EXECUTE ON FUNCTION public.k_nex_static_shared_generation_rebind(character varying, character varying, character varying, jsonb, character varying, character varying) TO ${supervisorLogin};
      GRANT EXECUTE ON FUNCTION public.k_nex_static_serving_generation(character varying, character varying) TO ${supervisorLogin};
    `);
    await admin.query(`
      INSERT INTO runtime_extensions (
        application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation, last_operation_id
      ) VALUES ($1,$2,'platform-plugin',$3,7,'active','shared-blue-11','{}'::jsonb,$4)
    `, [identity.applicationId, identity.environment, identity.extensionId, operationId]);
    await admin.query(`
      INSERT INTO runtime_extension_operations (
        operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
        request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json
      ) VALUES ($4,$1,$2,'platform-plugin',$3,'update','static-lifecycle-admission',$5,'{}'::jsonb,'{}'::jsonb,7,
        'source-change-ready','worker:static-admission','lease-static-admission',now() + interval '5 minutes',$6::jsonb)
    `, [identity.applicationId, identity.environment, identity.extensionId, operationId, digest(operationId), JSON.stringify({
      executionClass: "static-release", operationId, generationId: "shared-green-12", quarantineRecovery: false,
      sourceChange: { targetSourceCommit: sharedReceipt.sourceCommit, planDigest: sharedReceipt.compositionChangePlanDigest }
    })]);

    await supervisor.connect();
    connected = true;
    await assert.rejects(
      supervisor.query("select * from runtime_extension_operations"),
      /permission denied/u,
      "The login must not inherit a lifecycle table grant."
    );
    await assert.rejects(supervisor.query("update runtime_extensions set revision=revision+1"), /permission denied/u);
    await assert.rejects(supervisor.query("select * from runtime_extensions"), /permission denied/u);
    await supervisor.query("begin");
    transaction = true;
    const admission = await supervisor.query(
      "select * from public.k_nex_static_lifecycle_admission($1,$2,$3,$4)",
      [operationId, identity.applicationId, identity.environment, identity.extensionId]
    );
    assert.deepEqual(admission.rows, [{
      operation_id: operationId, expected_revision: 7, phase: "source-change-ready",
      plan_json: {
        executionClass: "static-release", operationId, generationId: "shared-green-12", quarantineRecovery: false,
        sourceChange: { targetSourceCommit: sharedReceipt.sourceCommit, planDigest: sharedReceipt.compositionChangePlanDigest }
      },
      authorization_json: {}, lifecycle_revision: 7, disposition: "active"
    }]);

    const writer = admin.query(
      "update runtime_extensions set revision=revision+1 where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [identity.applicationId, identity.environment, identity.extensionId]
    );
    await waitForLockedUpdate(admin);
    await supervisor.query("commit");
    transaction = false;
    await writer;
    assert.deepEqual(
      (await admin.query("select revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3", [identity.applicationId, identity.environment, identity.extensionId])).rows,
      [{ revision: 8 }],
      "The competing lifecycle transition must run only after the admission transaction releases its exact row lock."
    );

    const providerOperationId = "static-provider-operation";
    const priorProviderEvidence = {
      authority: "static-build", generationId: "shared-blue-11", version: "1.0.0", sourceCommit: "a".repeat(40),
      compositionChangePlanDigest: digest("prior-change"), buildEvidenceDigest: digest("prior-build"),
      applicationDigest: digest("prior-application"), imageDigest: digest("prior-image"), migrationRevision: 11,
      workerFencingToken: 1, receiptId: "receipt-shared-blue-11"
    };
    await admin.query(
      `INSERT INTO runtime_extensions (
         application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation, last_operation_id
       ) VALUES ($1,$2,'platform-plugin','provider.realtime.socketio',3,'active','shared-blue-11',$3::jsonb,$4)`,
      [identity.applicationId, identity.environment, JSON.stringify(priorProviderEvidence), providerOperationId]
    );
    await admin.query(
      `INSERT INTO runtime_extension_operations (
         operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
         request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json
       ) VALUES ($3,$1,$2,'platform-plugin','provider.realtime.socketio','update','static-provider-operation',$4,'{}'::jsonb,'{}'::jsonb,3,
         'completed','worker:static-admission','lease-static-provider',now() + interval '5 minutes',$5::jsonb)`,
      [identity.applicationId, identity.environment, providerOperationId, digest(providerOperationId), JSON.stringify({ executionClass: "static-release", operationId: providerOperationId, generationId: sharedGeneration.generationId })]
    );
    await admin.query(
      `INSERT INTO runtime_static_deployments (
         application_id, environment, revision, active_generation_id, active_generation, rollback_generation_id, rollback_generation, rollback_window, state_digest
       ) VALUES ($1,$2,1,$3,$4::jsonb,'shared-blue-11',$5::jsonb,$6::jsonb,$7)`,
      [identity.applicationId, identity.environment, sharedGeneration.generationId, JSON.stringify(sharedGeneration), JSON.stringify({ ...sharedGeneration, generationId: "shared-blue-11" }), JSON.stringify(sharedReceipt.rollbackWindow), digest("static-state")]
    );
    await admin.query(
      `INSERT INTO runtime_static_deployment_outbox (event_id, application_id, environment, revision, event_json)
       VALUES ($1,$2,$3,1,$4::jsonb)`,
      [sharedReceipt.receiptId, identity.applicationId, identity.environment, JSON.stringify(sharedReceipt)]
    );
    await admin.query("INSERT INTO runtime_extension_inventory_revisions (application_id, environment, revision) VALUES ($1,$2,9)", [identity.applicationId, identity.environment]);
    await admin.query("INSERT INTO k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) VALUES ($1,4,6)", [identity.applicationId]);
    await admin.query(
      `INSERT INTO k_nex_extension_authorization_generations (
         application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision
       ) VALUES
         ($1,'platform-plugin','provider.realtime.socketio',2,$2::jsonb,'current',4,6),
         ($1,'platform-plugin',$3,1,$2::jsonb,'current',4,6)`,
      [identity.applicationId, JSON.stringify(["shared-blue-11"]), identity.extensionId]
    );
    await assert.rejects(supervisor.query("update k_nex_authorization_state set lifecycle_revision=7"), /permission denied/u);
    assert.deepEqual((await supervisor.query(
      "select public.k_nex_static_serving_generation($1,$2) generation_id",
      [identity.applicationId, identity.environment]
    )).rows, [{ generation_id: "shared-blue-11" }], "Serving must retain prior generation while target and retained identities still bind it.");

    const targetEvidence = {
      authority: "static-build", generationId: sharedGeneration.generationId, version: "1.0.0", sourceCommit: sharedReceipt.sourceCommit,
      compositionChangePlanDigest: sharedReceipt.compositionChangePlanDigest, buildEvidenceDigest: sharedReceipt.buildEvidenceDigest,
      applicationDigest: sharedReceipt.applicationDigest, imageDigest: sharedReceipt.imageDigest, migrationRevision: sharedReceipt.migrationRevision,
      workerFencingToken: sharedReceipt.workerFencingToken, receiptId: sharedReceipt.receiptId
    };
    const targetEvent = {
      receiptId: sharedReceipt.receiptId, operationId, operation: "update", operationPhase: "completed", lifecycleState: "active", revision: 9,
      evidence: {
        generationId: sharedReceipt.activeGenerationId, sourceCommit: sharedReceipt.sourceCommit,
        compositionChangePlanDigest: sharedReceipt.compositionChangePlanDigest, buildEvidenceDigest: sharedReceipt.buildEvidenceDigest,
        applicationDigest: sharedReceipt.applicationDigest, imageDigest: sharedReceipt.imageDigest
      }
    };
    await admin.query(
      `UPDATE runtime_extensions SET revision=9, active_generation_id=$4, active_generation=$5::jsonb,
         rollback_generation_id='shared-blue-11', last_operation_id=$3, last_receipt_id=$6
       WHERE application_id=$1 AND environment=$2 AND delivery_class='platform-plugin' AND extension_id=$7`,
      [identity.applicationId, identity.environment, operationId, sharedGeneration.generationId, JSON.stringify(targetEvidence), sharedReceipt.receiptId, identity.extensionId]
    );
    await admin.query(
      `INSERT INTO runtime_extension_transition_receipts (receipt_id, operation_id, revision, event_json)
       VALUES ($1,$2,9,$3::jsonb)`,
      [sharedReceipt.receiptId, operationId, JSON.stringify(targetEvent)]
    );
    await admin.query(
      "UPDATE runtime_extension_operations SET phase='completed', result_json=$2::jsonb WHERE operation_id=$1",
      [operationId, JSON.stringify(sharedReceipt)]
    );
    await admin.query(
      `UPDATE k_nex_extension_authorization_generations SET runtime_generation_ids=$2::jsonb
       WHERE application_id=$1 AND extension_id=$3 AND state='current'`,
      [identity.applicationId, JSON.stringify([sharedGeneration.generationId]), identity.extensionId]
    );

    const beforeRejected = (await admin.query(
      "select revision, active_generation_id, last_receipt_id from runtime_extensions where application_id=$1 and environment=$2 and extension_id='provider.realtime.socketio'",
      [identity.applicationId, identity.environment]
    )).rows;
    await assert.rejects(
      supervisor.query("select public.k_nex_static_shared_generation_rebind($1,$2,$3,$4::jsonb,$5,$6)", [
        identity.applicationId, identity.environment, "shared-blue-11", JSON.stringify(sharedReceipt), identity.extensionId, providerOperationId
      ]),
      /not owned by the admitted lifecycle operation/u
    );
    await assert.rejects(
      supervisor.query("select public.k_nex_static_shared_generation_rebind($1,$2,$3,$4::jsonb,$5,$6)", [
        identity.applicationId, identity.environment, "stale-blue-10", JSON.stringify(sharedReceipt), identity.extensionId, operationId
      ]),
      /input is invalid|not bound to the committed deployment receipt/u
    );
    assert.deepEqual((await admin.query(
      "select revision, active_generation_id, last_receipt_id from runtime_extensions where application_id=$1 and environment=$2 and extension_id='provider.realtime.socketio'",
      [identity.applicationId, identity.environment]
    )).rows, beforeRejected, "Rejected rebinds must leave retained runtime state unchanged.");

    const rebound = await supervisor.query(
      "select public.k_nex_static_shared_generation_rebind($1,$2,$3,$4::jsonb,$5,$6) count",
      [identity.applicationId, identity.environment, "shared-blue-11", JSON.stringify(sharedReceipt), identity.extensionId, operationId]
    );
    assert.deepEqual(rebound.rows, [{ count: 1 }]);
    assert.deepEqual((await admin.query(
      "select revision, active_generation_id, rollback_generation_id, last_receipt_id from runtime_extensions where application_id=$1 and environment=$2 and extension_id='provider.realtime.socketio'",
      [identity.applicationId, identity.environment]
    )).rows, [{ revision: 4, active_generation_id: "shared-green-12", rollback_generation_id: "shared-blue-11", last_receipt_id: sharedReceipt.receiptId }]);
    assert.deepEqual((await admin.query(
      "select runtime_generation_ids, authorization_generation, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and extension_id='provider.realtime.socketio'",
      [identity.applicationId]
    )).rows, [{ runtime_generation_ids: ["shared-green-12"], authorization_generation: "2", lifecycle_revision: 7 }]);
    const event = (await admin.query(
      "select event_json from runtime_extension_outbox where application_id=$1 and environment=$2 and extension_id='provider.realtime.socketio'",
      [identity.applicationId, identity.environment]
    )).rows[0].event_json;
    assert.deepEqual({ eventType: event.eventType, id: event.id, previousGenerationId: event.previousGenerationId, revision: event.revision, inventoryRevision: event.inventoryRevision }, {
      eventType: "extension.shared-static-generation-rebind", id: "provider.realtime.socketio", previousGenerationId: "shared-blue-11", revision: 4, inventoryRevision: 10
    });
    assert.deepEqual((await admin.query(
      "select authorization_revision, lifecycle_revision, event_json->>'scope' scope from k_nex_authorization_outbox where application_id=$1 and environment=$2",
      [identity.applicationId, identity.environment]
    )).rows, [{ authorization_revision: 4, lifecycle_revision: 7, scope: "environment" }]);
    assert.deepEqual((await supervisor.query(
      "select public.k_nex_static_serving_generation($1,$2) generation_id",
      [identity.applicationId, identity.environment]
    )).rows, [{ generation_id: "shared-green-12" }], "Serving may expose active generation only after target and retained authorization identities converge.");
    const newerOperationId = "static-lifecycle-newer-plan";
    await admin.query(
      `INSERT INTO runtime_extension_operations (
         operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
         request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json
       ) VALUES ($1,$2,$3,'platform-plugin',$4,'update','static-lifecycle-newer-plan',$5,'{}'::jsonb,'{}'::jsonb,9,
         'planning','worker:newer-plan','lease-newer-plan',now() + interval '5 minutes','{}'::jsonb)`,
      [newerOperationId, identity.applicationId, identity.environment, identity.extensionId, digest(newerOperationId)]
    );
    await admin.query(
      "UPDATE runtime_extensions SET last_operation_id=$1 WHERE application_id=$2 AND environment=$3 AND delivery_class='platform-plugin' AND extension_id=$4",
      [newerOperationId, identity.applicationId, identity.environment, identity.extensionId]
    );
    assert.deepEqual((await supervisor.query(
      "select public.k_nex_static_serving_generation($1,$2) generation_id",
      [identity.applicationId, identity.environment]
    )).rows, [{ generation_id: "shared-green-12" }], "A newer planned operation must not invalidate immutable completed promotion evidence.");
    await admin.query(
      `UPDATE runtime_extensions SET revision=revision+1, disposition='disabled', active_generation_id=NULL, active_generation=NULL,
         rollback_generation_id=NULL, rollback_generation=NULL, retained_generation=$1::jsonb, last_receipt_id='receipt-runtime-disable'
       WHERE application_id=$2 AND environment=$3 AND delivery_class='platform-plugin' AND extension_id=$4`,
      [JSON.stringify(targetEvidence), identity.applicationId, identity.environment, identity.extensionId]
    );
    await admin.query(
      "DELETE FROM k_nex_extension_authorization_generations WHERE application_id=$1 AND extension_id=$2 AND state='current'",
      [identity.applicationId, identity.extensionId]
    );
    assert.deepEqual((await supervisor.query(
      "select public.k_nex_static_serving_generation($1,$2) generation_id",
      [identity.applicationId, identity.environment]
    )).rows, [{ generation_id: "shared-green-12" }], "A later runtime-only disable must not invalidate immutable completed promotion evidence.");
  } finally {
    if (transaction) await supervisor.query("rollback").catch(() => undefined);
    if (connected) await supervisor.end().catch(() => undefined);
    await admin.end();
    await container.stop();
  }
});
