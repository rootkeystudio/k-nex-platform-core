import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { canonicalJson } from "@k-nex/contracts";
import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter";
import { DeploymentSupervisor, TrustedStaticApplicationBuildAuthority } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const NODE_DIGEST = "sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43";
const NODE_IMAGE = `node@${NODE_DIGEST}`;
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
const digest = (character) => `sha256:${character.repeat(64)}`;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-8-postgres-secret", BOOT_KEY: "p9-8-static-deployment" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function docker(args) {
  return run("docker", args, { maxBuffer: 4 * 1024 * 1024 });
}

class StableGateway {
  #active;
  #targets = new Map();
  #server;
  #url;

  register(generationId, url) { this.#targets.set(generationId, url); }

  async start() {
    this.#server = createServer(async (request, response) => {
      const target = this.#targets.get(this.#active);
      if (!target) { response.writeHead(503).end("no active generation"); return; }
      try {
        const upstream = await fetch(`${target}${request.url}`);
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "text/plain" });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        response.writeHead(502).end("upstream unavailable");
      }
    });
    await new Promise((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.#server.address();
    this.#url = `http://127.0.0.1:${address.port}`;
    return this.#url;
  }

  async converge({ generationId }) {
    if (!this.#targets.has(generationId)) throw new Error(`Gateway target ${generationId} is unavailable.`);
    this.#active = generationId;
  }

  active() { return this.#active; }
  url() { return this.#url; }
  async close() { if (this.#server) await new Promise((resolve) => this.#server.close(resolve)); }
}

class DockerGenerationHost {
  #containers = new Map();

  constructor(network, gateway, now) {
    this.network = network;
    this.gateway = gateway;
    this.now = now;
    this.workerActivations = [];
    this.drained = [];
    this.inspections = [];
  }

  async start({ generationId, imageReference, workerMode }) {
    assert.equal(imageReference, NODE_IMAGE);
    assert.equal(workerMode, "passive");
    if (this.#containers.has(generationId)) return;
    const name = `knex-p9-${generationId}-${randomUUID().slice(0, 8)}`;
    const unhealthy = generationId.includes("failed");
    const server = `const http=require('http');const generation=process.env.K_NEX_GENERATION;const failed=process.env.K_NEX_FAIL_HEALTH==='1';http.createServer((request,response)=>{const send=()=>{if(request.url==='/health'&&failed){response.writeHead(500).end('failed');return;}response.setHeader('content-type','application/json');response.end(JSON.stringify({generation,path:request.url,workerMode:'passive',revision:12}));};request.url==='/slow'?setTimeout(send,250):send();}).listen(3000,'0.0.0.0');`;
    await docker([
      "run", "--rm", "--detach", "--name", name, "--network", this.network,
      "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5",
      "--publish", "127.0.0.1::3000", "--env", `K_NEX_GENERATION=${generationId}`, "--env", `K_NEX_FAIL_HEALTH=${unhealthy ? "1" : "0"}`,
      "--health-cmd", "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
      "--health-interval", "100ms", "--health-timeout", "1s", "--health-retries", "5", "--health-start-period", "100ms",
      NODE_IMAGE, "node", "-e", server
    ]);
    const { stdout } = await docker(["port", name, "3000/tcp"]);
    const port = stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(port, `Docker did not publish a loopback port: ${stdout}`);
    const value = { name, url: `http://127.0.0.1:${port}` };
    this.#containers.set(generationId, value);
    this.gateway.register(generationId, value.url);
  }

  async readiness(input) {
    const container = this.#containers.get(input.generationId);
    assert.ok(container);
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`${container.url}/health`);
        if (response.ok) { healthy = true; break; }
        throw new Error("unhealthy");
      } catch (error) {
        if (String(error).includes("unhealthy")) break;
      }
      await delay(100);
    }
    if (!healthy) throw new Error(`Green generation ${input.generationId} failed health checks.`);
    const [publicSmoke, authenticatedSmoke, inventory] = await Promise.all([
      fetch(`${container.url}/public`), fetch(`${container.url}/authenticated`), fetch(`${container.url}/inventory`)
    ]);
    assert.equal(publicSmoke.ok && authenticatedSmoke.ok && inventory.ok, true);
    const inventoryBody = await inventory.json();
    assert.equal(inventoryBody.generation, input.generationId);
    const { stdout } = await docker(["inspect", container.name]);
    const inspection = JSON.parse(stdout)[0];
    this.inspections.push(inspection);
    assert.equal(inspection.HostConfig.NetworkMode, this.network);
    assert.equal(inspection.Config.Healthcheck.Test[0], "CMD-SHELL");
    assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspection.HostConfig.CapDrop.includes("ALL"), true);
    assert.equal(inspection.HostConfig.SecurityOpt.includes("no-new-privileges"), true);
    assert.equal(inspection.Mounts.some((mount) => mount.Type === "bind" || String(mount.Source).includes("docker.sock")), false);
    assert.equal(inspection.Config.Env.some((entry) => /^(DOCKER_HOST|DATABASE_URL|GITHUB_TOKEN|SOURCE_WRITE_TOKEN)=/u.test(entry)), false);
    await assert.rejects(docker(["exec", container.name, "touch", "/source-write-test"]));
    return {
      ...input,
      publicSmoke: true,
      authenticatedSmoke: true,
      inventoryReconciled: true,
      workerMode: "passive",
      gatewayCapacity: true,
      realtimeReady: true,
      observedAt: this.now().toISOString()
    };
  }

  async activateWorker(generationId, fence) { this.workerActivations.push({ generationId, fence }); }
  async drain(generationId) { this.drained.push(generationId); }

  async retire(generationId) {
    const container = this.#containers.get(generationId);
    if (!container) return;
    await docker(["rm", "--force", container.name]);
    this.#containers.delete(generationId);
  }

  async close() {
    await Promise.allSettled([...this.#containers.values()].map(({ name }) => docker(["rm", "--force", name])));
    this.#containers.clear();
  }
}

class PostgresCompatibilityMigrations {
  constructor(pool) { this.pool = pool; this.backfillBatches = 0; }

  async runOnline(plan) {
    const completed = [];
    for (const step of plan.steps) {
      if (step.phase === "online-expand") {
        await this.pool.query(`
          create table if not exists p9_static_overlap (id integer primary key, legacy_value text not null, expanded_value text);
          insert into p9_static_overlap values (1,'one',null),(2,'two',null),(3,'three',null) on conflict do nothing;
          create table if not exists p9_static_backfill_checkpoint (step_id text primary key, last_id integer not null);
        `);
        completed.push(step.stepId);
      }
      if (step.phase === "online-backfill") {
        while (true) {
          const session = await this.pool.connect();
          try {
            await session.query("begin");
            const checkpoint = await session.query("select last_id from p9_static_backfill_checkpoint where step_id=$1 for update", [step.stepId]);
            const lastId = checkpoint.rows[0]?.last_id ?? 0;
            const next = await session.query("select id from p9_static_overlap where id>$1 order by id limit 1", [lastId]);
            if (!next.rows[0]) { await session.query("commit"); break; }
            await session.query("update p9_static_overlap set expanded_value=upper(legacy_value) where id=$1 and expanded_value is null", [next.rows[0].id]);
            await session.query("insert into p9_static_backfill_checkpoint values ($1,$2) on conflict (step_id) do update set last_id=excluded.last_id", [step.stepId, next.rows[0].id]);
            await session.query("commit");
            this.backfillBatches += 1;
          } catch (error) {
            await session.query("rollback");
            throw error;
          } finally { session.release(); }
        }
        completed.push(step.stepId);
      }
    }
    return completed;
  }

  async runPostRetirement(plan) {
    const steps = plan.steps.filter((step) => step.phase === "post-retirement-contract");
    for (const step of steps) await this.pool.query("alter table p9_static_overlap drop column if exists legacy_value");
    return steps.map((step) => step.stepId);
  }
}

function changePlan(now) {
  return {
    schemaVersion: 1,
    planId: "composition-plan-12",
    applicationId: "customer-alpha",
    environment: "production",
    deliveryClass: "platform-plugin",
    plugin: { id: "module.sales", version: "1.1.0", releaseManifestDigest: digest("1") },
    authority: { identity: "github-app:k-nex-change-authority", requestDigest: digest("2") },
    base: { sourceCommit: "a".repeat(40), composition: { applicationManifestDigest: digest("3"), lockfileDigest: digest("4"), resolvedGraphDigest: digest("5"), generatedRegistriesDigest: digest("6"), packageClosureDigest: digest("7"), migrationPlanDigest: digest("8") } },
    target: { sourceCommit: "b".repeat(40), composition: { applicationManifestDigest: digest("9"), lockfileDigest: digest("a"), resolvedGraphDigest: digest("b"), generatedRegistriesDigest: digest("c"), packageClosureDigest: digest("d"), migrationPlanDigest: digest("e") }, applicationSubjectDigest: digest("f"), imageSubjectDigest: NODE_DIGEST },
    migration: {
      planId: "migration-plan-12", applicationId: "customer-alpha", environment: "production", sourceCommit: "a".repeat(40), targetSourceCommit: "b".repeat(40), baseRevision: 11, targetRevision: 12,
      steps: [
        { stepId: "migration-expand-12", phase: "online-expand", migrationDigest: digest("1"), overlapSafe: true },
        { stepId: "migration-backfill-12", phase: "online-backfill", migrationDigest: digest("2"), resumable: true, idempotent: true, checkpointSchemaDigest: digest("3") },
        { stepId: "migration-contract-12", phase: "post-retirement-contract", migrationDigest: digest("4"), requiresOldGenerationRetired: true, requiresRollbackWindowClosed: true }
      ],
      rollbackWindow: { state: "open", windowId: "rollback-window-12", previousApplicationDigest: digest("5"), closesAt: new Date(now.valueOf() + 86_400_000).toISOString(), contractCleanup: "blocked" }
    },
    status: "source-change-ready"
  };
}

function verifiedBuild(change) {
  const keys = generateKeyPairSync("ed25519");
  const statement = {
    schemaVersion: 1,
    applicationId: change.applicationId,
    environment: change.environment,
    sourceCommit: change.target.sourceCommit,
    authority: { kind: "self-hosted-trusted", builderIdentity: "builder:k-nex-phase-9", trustPolicyDigest: digest("6"), ref: "source-commit" },
    composition: change.target.composition,
    sbomDigest: digest("7"),
    provenanceDigest: digest("8"),
    applicationSubject: { name: "customer-alpha-application.tar.gz", digest: change.target.applicationSubjectDigest },
    imageSubject: { repository: "node", digest: change.target.imageSubjectDigest }
  };
  const evidence = { ...statement, signature: { algorithm: "ed25519", keyId: "builder:k-nex-phase-9", value: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64") } };
  const authority = new TrustedStaticApplicationBuildAuthority({ "builder:k-nex-phase-9": keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
  const source = { status: "source-change-ready", planDigest: digest("9"), targetSourceCommit: change.target.sourceCommit, change };
  return { authority, token: authority.verify(source, evidence), evidence };
}

test("proves trusted Docker blue/green delivery, PostgreSQL fencing, rollback, and cleanup", { timeout: 240_000 }, async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_deployment").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
  const network = `knex-p9-${randomUUID()}`;
  const gateway = new StableGateway();
  const now = new Date("2026-08-29T12:00:00.000Z");
  let probing = false;
  let probePromise;
  const probeFailures = [];
  const generations = new DockerGenerationHost(network, gateway, () => now);
  try {
    await boot(postgres.getConnectionUri());
    await docker(["network", "create", network]);
    await gateway.start();
    const change = changePlan(now);
    const build = verifiedBuild(change);
    const migrations = new PostgresCompatibilityMigrations(pool);
    const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, build.authority);
    const blue = { generationId: "customer-alpha-blue-11", sourceCommit: change.base.sourceCommit, compositionChangePlanDigest: digest("a"), buildEvidenceDigest: digest("b"), applicationDigest: change.migration.rollbackWindow.previousApplicationDigest, imageDigest: NODE_DIGEST, migrationRevision: 11 };
    const owner = { applicationId: change.applicationId, environment: change.environment };
    const leaseExpiresAt = new Date(now.valueOf() + 240_000).toISOString();
    await store.initialize({ ...owner, generation: blue, workerOwner: "worker:phase-9-blue", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt });
    await generations.start({ ...owner, generationId: blue.generationId, imageReference: NODE_IMAGE, workerMode: "passive" });
    await gateway.converge({ ...owner, generationId: blue.generationId, revision: 0 });
    const realtimeEvents = [];
    const realtime = {
      reconnectAndResync: async ({ activeGenerationId, ...event }) => {
        const response = await fetch(`${gateway.url()}/realtime-resync`);
        assert.equal((await response.json()).generation, activeGenerationId);
        realtimeEvents.push({ ...event, activeGenerationId });
      }
    };
    const supervisor = new DeploymentSupervisor(
      build.authority,
      { resolve: async (evidence) => ({ imageReference: `${evidence.imageSubject.repository}@${evidence.imageSubject.digest}`, applicationDigest: evidence.applicationSubject.digest, imageDigest: evidence.imageSubject.digest }) },
      migrations, generations, store, gateway, realtime
    );
    probing = true;
    probePromise = (async () => {
      while (probing) {
        try {
          const response = await fetch(`${gateway.url()}/probe`);
          if (!response.ok) probeFailures.push(`status:${response.status}`);
          else await response.arrayBuffer();
        } catch (error) { probeFailures.push(String(error)); }
        await delay(10);
      }
    })();

    await assert.rejects(store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2 }), { code: "FENCE_REJECTED" });
    await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1 });

    await assert.rejects(supervisor.deploy({ build: build.token, generationId: "customer-alpha-failed-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /failed health checks/);
    assert.equal(gateway.active(), blue.generationId);
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);

    await pool.query(`create function p9_fail_fence_transfer() returns trigger language plpgsql as $$ begin if new.fencing_token=2 then raise exception 'simulated fence transfer crash'; end if; return new; end $$`);
    await pool.query(`create trigger p9_fail_fence_transfer before update on runtime_worker_generation_fences for each row execute function p9_fail_fence_transfer()`);
    await assert.rejects(supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /simulated fence transfer crash/);
    assert.equal(gateway.active(), blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    assert.equal((await pool.query("select count(*)::int count from runtime_static_deployment_outbox")).rows[0].count, 0);
    await pool.query("drop trigger p9_fail_fence_transfer on runtime_worker_generation_fences");
    await pool.query("drop function p9_fail_fence_transfer()");

    const inFlightBlue = fetch(`${gateway.url()}/slow`).then((response) => response.json());
    await delay(30);
    const promoted = await supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt });
    assert.equal(promoted.outcome, "promoted");
    assert.equal((await inFlightBlue).generation, blue.generationId);
    assert.equal(gateway.active(), "customer-alpha-green-12");
    assert.equal((await store.readFence(owner)).activeExecutionGeneration, "customer-alpha-green-12");
    await assert.rejects(store.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, resultDigest: digest("1") }), { code: "FENCE_REJECTED" });
    assert.deepEqual(await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2 }), { status: "claimed", attempts: 2 });
    await store.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, resultDigest: digest("1") });
    const effects = await pool.query("select state, attempts, result_digest from runtime_worker_effects where effect_id='sales-external-effect'");
    assert.deepEqual(effects.rows, [{ state: "completed", attempts: 2, result_digest: digest("1") }]);

    const overlap = await Promise.all([
      pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap"),
      pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap"),
      fetch(`${gateway.url()}/new-binary`).then((response) => response.json())
    ]);
    assert.deepEqual(overlap[0].rows[0].values, ["one", "two", "three"]);
    assert.deepEqual(overlap[1].rows[0].values, ["ONE", "TWO", "THREE"]);
    assert.equal(overlap[2].generation, "customer-alpha-green-12");
    assert.equal(migrations.backfillBatches >= 3, true);

    await supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt });
    assert.equal(gateway.active(), blue.generationId);
    await supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt });
    assert.equal(gateway.active(), "customer-alpha-green-12");
    await assert.rejects(supervisor.runContractCleanup(owner, change.migration), { code: "CONTRACT_CLEANUP_BLOCKED" });
    const closed = await supervisor.closeRollback(owner);
    assert.equal(closed.contractCleanup, "eligible");
    assert.deepEqual(await supervisor.runContractCleanup(owner, change.migration), ["migration-contract-12"]);
    const legacyColumn = await pool.query("select count(*)::int count from information_schema.columns where table_name='p9_static_overlap' and column_name='legacy_value'");
    assert.equal(legacyColumn.rows[0].count, 0);
    assert.equal(realtimeEvents.length, 3);
    const outbox = await pool.query("select revision, event_json->>'operation' operation from runtime_static_deployment_outbox order by revision");
    assert.deepEqual(outbox.rows, [{ revision: 1, operation: "promote" }, { revision: 2, operation: "rollback" }, { revision: 3, operation: "promote" }, { revision: 4, operation: "close-rollback" }]);
  } finally {
    probing = false;
    if (probePromise) await probePromise;
    await generations.close();
    await gateway.close();
    await docker(["network", "rm", network]).catch(() => undefined);
    await pool.end();
    await postgres.stop();
  }
  assert.deepEqual(probeFailures, []);
});

test("returns maintenance-required without starting a Docker generation", async () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  const change = changePlan(now);
  change.migration.steps = [{ stepId: "migration-offline-12", phase: "offline-required", migrationDigest: digest("f"), availability: "maintenance-required" }];
  const build = verifiedBuild(change);
  let starts = 0;
  const supervisor = new DeploymentSupervisor(
    build.authority,
    { resolve: async () => { throw new Error("must not resolve"); } },
    { runOnline: async () => { throw new Error("must not migrate"); }, runPostRetirement: async () => [] },
    { start: async () => { starts += 1; }, readiness: async () => { throw new Error("must not probe"); }, activateWorker: async () => undefined, drain: async () => undefined, retire: async () => undefined },
    { read: async () => undefined, readFence: async () => undefined, promote: async () => { throw new Error("must not promote"); }, rollback: async () => { throw new Error("unused"); }, closeRollback: async () => { throw new Error("unused"); }, assertContractCleanup: async () => undefined },
    { converge: async () => { throw new Error("must not route"); } },
    { reconnectAndResync: async () => { throw new Error("must not reconnect"); } }
  );
  assert.deepEqual(await supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:green", workerLeaseExpiresAt: new Date(now.valueOf() + 60_000).toISOString() }), { outcome: "maintenance-required", reasons: ["offline-migration"] });
  assert.equal(starts, 0);
});
