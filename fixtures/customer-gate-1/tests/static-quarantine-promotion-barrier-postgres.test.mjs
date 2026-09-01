import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const now = new Date("2026-09-01T00:00:00.000Z");
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => digest(canonicalJson(value));

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-static-quarantine-barrier", BOOT_KEY: "p10-static-quarantine-barrier" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function release(owner) {
  const [planFixture, evidenceFixture] = await Promise.all([
    readFile(new URL("../../extensions/valid/static-composition-change-plan.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../extensions/valid/trusted-application-build-evidence.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const change = structuredClone(planFixture);
  change.applicationId = owner.applicationId;
  change.environment = owner.environment;
  change.migration.applicationId = owner.applicationId;
  change.migration.environment = owner.environment;
  const evidence = structuredClone(evidenceFixture);
  delete evidence.$schema;
  evidence.applicationId = owner.applicationId;
  evidence.environment = owner.environment;
  evidence.sourceCommit = change.target.sourceCommit;
  evidence.composition = change.target.composition;
  evidence.applicationSubject.digest = change.target.applicationSubjectDigest;
  evidence.imageSubject.digest = change.target.imageSubjectDigest;
  return {
    change,
    evidence,
    verified: { change: { status: "source-change-ready", planDigest: digestJson(change), targetSourceCommit: change.target.sourceCommit, change }, evidence, evidenceDigest: digestJson(evidence) }
  };
}

function baseGeneration(change) {
  return {
    generationId: "customer-alpha-blue-11",
    sourceCommit: change.base.sourceCommit,
    compositionChangePlanDigest: digestJson(change.base),
    buildEvidenceDigest: digestJson({ sourceCommit: change.base.sourceCommit }),
    applicationDigest: change.migration.rollbackWindow.previousApplicationDigest,
    imageDigest: `sha256:${"0".repeat(64)}`,
    imageReference: `ghcr.io/k-nex/customer-alpha@sha256:${"0".repeat(64)}`,
    migrationRevision: change.migration.baseRevision
  };
}

function readiness(release, generationId) {
  return {
    generationId,
    sourceCommit: release.change.target.sourceCommit,
    applicationDigest: release.evidence.applicationSubject.digest,
    imageDigest: release.evidence.imageSubject.digest,
    migrationRevision: release.change.migration.targetRevision,
    completedMigrationSteps: release.change.migration.steps.filter(({ phase }) => phase === "online-expand" || phase === "online-backfill").map(({ stepId }) => stepId),
    publicSmoke: true,
    authenticatedSmoke: true,
    inventoryReconciled: true,
    workerMode: "passive",
    gatewayCapacity: true,
    realtimeReady: true,
    observedAt: now.toISOString()
  };
}

test("a plan made while active cannot promote after quarantine", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_quarantine_barrier").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const owner = { applicationId: "customer-alpha", environment: "production" };
    const extensionId = "module.sales";
    const operationId = "operation-static-active-plan-1";
    const targetGenerationId = "customer-alpha-green-12";
    const value = await release(owner);
    const build = {};
    const base = baseGeneration(value.change);
    const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, { read: (token) => {
      assert.equal(token, build);
      return value.verified;
    } });
    await store.initialize({ ...owner, generation: base, workerOwner: "worker:blue", workerFencingToken: 1, workerLeaseExpiresAt: "2026-09-01T00:05:00.000Z" });
    await pool.query(
      `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
       values ($1,$2,'platform-plugin',$3,0,'active',$4,$5::jsonb)`,
      [owner.applicationId, owner.environment, extensionId, base.generationId, JSON.stringify(base)]
    );
    const plan = { executionClass: "static-release", operationId, generationId: targetGenerationId, quarantineRecovery: false };
    await pool.query(
      `insert into runtime_extension_operations (
         operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
         request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json
       ) values ($1,$2,$3,'platform-plugin',$4,'update','active-plan-1',$5,'{}'::jsonb,'{}'::jsonb,0,'source-change-ready','worker:plan','lease-plan-1',$6,$7::jsonb)`,
      [operationId, owner.applicationId, owner.environment, extensionId, digest("active-plan"), "2026-09-01T00:05:00.000Z", JSON.stringify(plan)]
    );

    await pool.query(
      `update runtime_extensions set revision=1, disposition='quarantined', active_generation_id=null, active_generation=null, retained_generation=$4::jsonb
       where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3`,
      [owner.applicationId, owner.environment, extensionId, JSON.stringify(base)]
    );

    const promotion = {
      ...owner,
      expectedRevision: 0,
      expectedFenceToken: 1,
      generationId: targetGenerationId,
      workerOwner: "worker:green",
      workerLeaseExpiresAt: "2026-09-01T00:05:00.000Z",
      build,
      readiness: readiness(value, targetGenerationId)
    };
    await assert.rejects(store.promote(promotion), { code: "INPUT_INVALID" }, "Omitted lifecycle admission must fail before static mutation.");
    assert.equal((await store.read(owner)).revision, 0);
    assert.equal((await pool.query("select count(*)::int count from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].count, 0);

    await assert.rejects(store.promote({
      ...promotion,
      lifecycleAdmission: { operationId, expectedRevision: 0, extensionId, quarantineRecovery: false }
    }), { code: "REVISION_CONFLICT" });

    const [deployment, lifecycle, outbox, retirements] = await Promise.all([
      store.read(owner),
      pool.query("select revision, disposition, active_generation_id from runtime_extensions where application_id=$1 and environment=$2 and extension_id=$3", [owner.applicationId, owner.environment, extensionId]),
      pool.query("select count(*)::int count from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]),
      pool.query("select count(*)::int count from runtime_static_generation_retirements where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])
    ]);
    assert.equal(deployment.active.generationId, base.generationId);
    assert.equal(deployment.rollback, undefined, "The stale plan must not create rollback authority.");
    assert.equal(deployment.revision, 0);
    assert.deepEqual(lifecycle.rows, [{ revision: 1, disposition: "quarantined", active_generation_id: null }], "The quarantined generation remains unservable.");
    assert.equal(outbox.rows[0].count, 0);
    assert.equal(retirements.rows[0].count, 0);
  } finally {
    await pool.end();
    await container.stop();
  }
});
