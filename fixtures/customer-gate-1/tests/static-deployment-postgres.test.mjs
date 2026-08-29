import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { canonicalJson } from "@k-nex/contracts";
import { PostgresRuntimeExtensionStore, PostgresStaticDeploymentStore, PostgresTrustedBuildDeploymentClient } from "@k-nex/payload-adapter";
import {
  DurableStaticReleaseOperator,
  DeploymentSupervisor,
  ExtensionOperatorApi,
  PluginManager,
  TrustedAutomationOperationAuthorizer,
  TrustedStaticApplicationBuildAuthority
} from "@k-nex/runtime";
import { startContinuousHttpProbe } from "./continuous-http-probe.mjs";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const staticDeploymentDirectory = join(fixtureDirectory, "static-deployment");
const topologyProcess = join(staticDeploymentDirectory, "topology-process.mjs");
const npm = join(dirname(process.execPath), "npm");
const run = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));

async function deliverExternalEffect(pool, idempotencyKey, payload) {
  const resultDigest = sha256(payload);
  const inserted = await pool.query(
    "insert into p9_static_external_effects (idempotency_key, result_digest) values ($1,$2) on conflict (idempotency_key) do nothing returning result_digest",
    [idempotencyKey, resultDigest]
  );
  const recorded = inserted.rows[0] ?? (await pool.query("select result_digest from p9_static_external_effects where idempotency_key=$1", [idempotencyKey])).rows[0];
  assert.ok(recorded, "The external idempotency sink must retain the first accepted effect.");
  return { duplicate: inserted.rows.length === 0, resultDigest: recorded.result_digest };
}

function startTopologyProcess(role, env) {
  const child = spawn(process.execPath, [topologyProcess], {
    cwd: fixtureDirectory,
    env: { ...process.env, ...env, P9_PROCESS_ROLE: role },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${role} process did not become ready: ${output}`)), Number(env.P9_READY_TIMEOUT_MS ?? 10_000));
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      const line = output.split("\n").find((value) => value.startsWith("{"));
      if (!line) return;
      try {
        const value = JSON.parse(line);
        if (value.type === "ready") { clearTimeout(timeout); resolve(value); }
      } catch { /* retain process output for the timeout diagnostic */ }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { if (code && code !== 0) { clearTimeout(timeout); reject(new Error(`${role} process exited ${code}: ${output}`)); } });
  });
  return { child, ready, output: () => output, stop: () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    if (!child.killed) child.kill("SIGKILL");
  }) };
}

async function nextPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForProcessEvent(pool, role, event, minimum = 1, process) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query("select count(*)::int count from p9_static_process_events where role=$1 and event=$2", [role, event]);
    if (result.rows[0].count >= minimum) return;
    await delay(25);
  }
  assert.fail(`Timed out waiting for ${role}/${event} PostgreSQL process evidence.${process ? ` Output: ${process.output()}` : ""}`);
}

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

async function docker(args, options = {}) {
  return run("docker", args, { maxBuffer: 8 * 1024 * 1024, ...options });
}

async function command(command, args, cwd) {
  return run(command, args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function fileDigest(path) {
  return sha256(await readFile(path));
}

async function writeResolvedGraph(sourceDirectory) {
  const lock = JSON.parse(await readFile(join(sourceDirectory, "package-lock.json"), "utf8"));
  const sales = lock.packages["node_modules/@k-nex/module-sales"];
  assert.ok(sales, "The source lock must resolve module.sales.");
  const graph = { packageLockVersion: lock.lockfileVersion, moduleSales: { version: sales.version, resolved: sales.resolved, integrity: sales.integrity } };
  await mkdir(join(sourceDirectory, ".k-nex", "generated"), { recursive: true });
  await writeFile(join(sourceDirectory, ".k-nex", "generated", "resolved-graph.json"), `${canonicalJson(graph)}\n`);
}

async function resolveLock(sourceDirectory) {
  await command(npm, ["install", "--package-lock-only", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"], sourceDirectory);
  await writeResolvedGraph(sourceDirectory);
}

async function git(sourceDirectory, args) {
  return command("git", args, sourceDirectory);
}

async function sourceCommit(sourceDirectory) {
  return (await git(sourceDirectory, ["rev-parse", "HEAD"])).stdout.trim();
}

async function prepareCustomerSource() {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "knex-p9-static-source-"));
  await mkdir(join(sourceDirectory, "packages"));
  await cp(join(fixtureDirectory, "k-nex.app.json"), join(sourceDirectory, "k-nex.app.json"));
  await cp(join(staticDeploymentDirectory, "customer-package.json"), join(sourceDirectory, "package.json"));
  await cp(staticDeploymentDirectory, join(sourceDirectory, "static-deployment"), { recursive: true });
  await cp(join(fixtureDirectory, "packages", "k-nex-module-sales-1.0.0.tgz"), join(sourceDirectory, "packages", "k-nex-module-sales-1.0.0.tgz"));
  await cp(join(fixtureDirectory, "packages", "k-nex-module-sales-1.0.1.tgz"), join(sourceDirectory, "packages", "k-nex-module-sales-1.0.1.tgz"));
  await cp(join(fixtureDirectory, "src", "migrations", "20260829_000011_static_deployment.ts"), join(sourceDirectory, "static-deployment-migration.ts"));
  await resolveLock(sourceDirectory);
  await git(sourceDirectory, ["init", "--quiet"]);
  await git(sourceDirectory, ["config", "user.email", "builder@k-nex.test"]);
  await git(sourceDirectory, ["config", "user.name", "K-Nex trusted builder"]);
  await git(sourceDirectory, ["add", "."]);
  await git(sourceDirectory, ["commit", "--quiet", "-m", "customer: module.sales 1.0.0"]);
  return sourceDirectory;
}

async function sourceMaterials(sourceDirectory) {
  const pkg = JSON.parse(await readFile(join(sourceDirectory, "package.json"), "utf8"));
  const salesTarball = pkg.dependencies["@k-nex/module-sales"].replace("file:", "");
  const paths = [
    "k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/resolved-graph.json",
    "static-deployment/Dockerfile", "static-deployment/healthcheck.mjs", "static-deployment/release.json", "static-deployment/server.mjs", "static-deployment/topology-process.mjs",
    "static-deployment-migration.ts", salesTarball
  ];
  const digests = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await fileDigest(join(sourceDirectory, path))])));
  const composition = {
    applicationManifestDigest: digests["k-nex.app.json"],
    lockfileDigest: digests["package-lock.json"],
    resolvedGraphDigest: digests[".k-nex/generated/resolved-graph.json"],
    generatedRegistriesDigest: digestJson({ dockerfile: digests["static-deployment/Dockerfile"], healthcheck: digests["static-deployment/healthcheck.mjs"], server: digests["static-deployment/server.mjs"], topology: digests["static-deployment/topology-process.mjs"] }),
    packageClosureDigest: digests[salesTarball],
    migrationPlanDigest: digests["static-deployment-migration.ts"]
  };
  return { composition, digests, paths, pluginVersion: JSON.parse(await readFile(join(sourceDirectory, "static-deployment", "release.json"), "utf8")).plugin.version };
}

async function prepareBaseImage(sourceDirectory, commit, artifactsDirectory) {
  const materials = await sourceMaterials(sourceDirectory);
  const applicationBundle = Buffer.from(canonicalJson({ sourceCommit: commit, files: materials.digests }));
  const applicationPath = join(artifactsDirectory, `${commit}.application.json`);
  await writeFile(applicationPath, applicationBundle);
  const applicationDigest = sha256(applicationBundle);
  const tag = `knex-p9-customer-alpha:${commit.slice(0, 12)}`;
  await docker(["build", "--pull=false", "--file", "static-deployment/Dockerfile", "--tag", tag,
    "--build-arg", `K_NEX_SOURCE_COMMIT=${commit}`, "--build-arg", `K_NEX_APPLICATION_DIGEST=${applicationDigest}`, "."], { cwd: sourceDirectory });
  const inspection = JSON.parse((await docker(["image", "inspect", tag])).stdout)[0];
  const imageDigest = inspection.Id;
  assert.match(imageDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(inspection.Config.Labels["org.opencontainers.image.revision"], commit);
  assert.equal(inspection.Config.Labels["dev.k-nex.application-digest"], applicationDigest);
  return { applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, tag };
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
        const upstream = await fetch(`${target}${request.url}`, { headers: request.headers });
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "text/plain" });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (error) { response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: `upstream unavailable: ${error.message}` })); }
    });
    await new Promise((resolve, reject) => { this.#server.once("error", reject); this.#server.listen(0, "127.0.0.1", resolve); });
    this.#url = `http://127.0.0.1:${this.#server.address().port}`;
    return this.#url;
  }

  async converge({ generationId }) { if (!this.#targets.has(generationId)) throw new Error(`Gateway target ${generationId} is unavailable.`); this.#active = generationId; }
  active() { return this.#active; }
  url() { return this.#url; }
  async close() { if (this.#server) await new Promise((resolve) => this.#server.close(resolve)); }
}

class LocalArtifactProvider {
  constructor(builds) { this.builds = builds; }

  async #resolve(imageDigest) {
    const build = this.builds.get(imageDigest);
    assert.ok(build, `No built customer image is registered for ${imageDigest}.`);
    const inspection = JSON.parse((await docker(["image", "inspect", imageDigest])).stdout)[0];
    assert.equal(inspection.Id, imageDigest, "The immutable local image ID no longer resolves to the attested image bytes.");
    return build;
  }

  async resolve(evidence) {
    const build = await this.#resolve(evidence.imageSubject.digest);
    return { imageReference: build.imageReference, applicationDigest: build.applicationDigest, imageDigest: build.imageDigest, runtimeImageDigest: build.imageDigest };
  }

  async reverify(generation) {
    const build = await this.#resolve(generation.imageDigest);
    return { imageReference: build.imageReference, applicationDigest: build.applicationDigest, imageDigest: build.imageDigest, runtimeImageDigest: build.imageDigest };
  }

  async imageId(imageReference) {
    const build = [...this.builds.values()].find((candidate) => candidate.imageReference === imageReference);
    assert.ok(build, `Immutable local image reference is unknown: ${imageReference}`);
    await this.#resolve(build.imageDigest);
    return build.imageDigest;
  }
}

class DockerGenerationHost {
  #containers = new Map();
  #databaseAuthorities = new Map();

  constructor(network, gateway, artifacts, now, routesPool) {
    this.network = network; this.gateway = gateway; this.artifacts = artifacts; this.now = now; this.routesPool = routesPool;
    this.workerActivations = []; this.drained = []; this.inspections = [];
  }

  registerDatabaseAuthority(generationId, authority) { this.#databaseAuthorities.set(generationId, authority); }

  async start({ generationId, imageReference, workerMode }) {
    assert.equal(workerMode, "passive");
    if (this.#containers.has(generationId)) return;
    const database = this.#databaseAuthorities.get(generationId);
    assert.ok(database, `Generation ${generationId} has no least-privilege database authority.`);
    const name = `knex-p9-${generationId}-${randomUUID().slice(0, 8)}`;
    const imageId = await this.artifacts.imageId(imageReference);
    await docker([
      "run", "--rm", "--detach", "--name", name, "--network", this.network,
      "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5",
      "--publish", "127.0.0.1::3000", "--env", `K_NEX_GENERATION=${generationId}`, "--env", "K_NEX_WORKER_MODE=passive", "--env", "K_NEX_SMOKE_TOKEN=trusted-smoke-token",
      "--env", `DATABASE_URL=${database.url}`, "--env", `K_NEX_SCHEMA_REVISION=${database.schemaRevision}`,
      "--env", `K_NEX_FAIL_HEALTH=${generationId.includes("failed") ? "1" : "0"}`, imageId
    ]);
    const port = (await docker(["port", name, "3000/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(port, "Docker did not publish a loopback port.");
    const container = { imageId, name, url: `http://127.0.0.1:${port}` };
    this.#containers.set(generationId, container);
    this.gateway.register(generationId, container.url);
    if (this.routesPool) await this.routesPool.query("insert into p9_static_process_routes values ($1,$2) on conflict (generation_id) do update set url=excluded.url", [generationId, container.url]);
  }

  async readiness(input) {
    const container = this.#containers.get(input.generationId);
    assert.ok(container);
    const database = this.#databaseAuthorities.get(input.generationId);
    assert.ok(database, `Generation ${input.generationId} has no least-privilege database authority.`);
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${container.url}/health`).catch(() => undefined);
      if (response?.ok) { healthy = true; break; }
      await delay(100);
    }
    if (!healthy) throw new Error(`Green generation ${input.generationId} failed health checks.`);
    const [publicSmoke, unauthenticatedSmoke, authenticatedSmoke, inventory, schemaProof, leastPrivilege] = await Promise.all([
      fetch(`${container.url}/public`), fetch(`${container.url}/authenticated`),
      fetch(`${container.url}/authenticated`, { headers: { "x-k-nex-smoke-auth": "trusted-smoke-token" } }), fetch(`${container.url}/inventory`),
      fetch(`${container.url}/schema-proof`), fetch(`${container.url}/least-privilege`)
    ]);
    assert.equal(publicSmoke.ok, true);
    assert.equal(unauthenticatedSmoke.status, 401);
    assert.equal(authenticatedSmoke.ok, true);
    assert.equal(schemaProof.ok, true);
    assert.equal(leastPrivilege.ok, true);
    const [publicBody, authenticatedBody, inventoryBody, schemaBody, leastPrivilegeBody] = await Promise.all([publicSmoke.json(), authenticatedSmoke.json(), inventory.json(), schemaProof.json(), leastPrivilege.json()]);
    for (const body of [publicBody, authenticatedBody, inventoryBody]) {
      assert.deepEqual({ module: body.module, sourceCommit: body.sourceCommit, applicationDigest: body.applicationDigest, workerMode: body.workerMode },
        { module: "module.sales", sourceCommit: input.sourceCommit, applicationDigest: input.applicationDigest, workerMode: "passive" });
    }
    assert.equal(schemaBody.databaseRole, database.role);
    assert.equal(schemaBody.schemaRevision >= database.schemaRevision, true);
    assert.equal(leastPrivilegeBody.rejected, true);
    const inspection = JSON.parse((await docker(["inspect", container.name])).stdout)[0];
    this.inspections.push(inspection);
    assert.equal(inspection.Image, container.imageId);
    assert.equal(inspection.HostConfig.NetworkMode, this.network);
    assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspection.HostConfig.CapDrop.includes("ALL"), true);
    assert.equal(inspection.HostConfig.SecurityOpt.includes("no-new-privileges"), true);
    assert.equal(inspection.Mounts.some((mount) => mount.Type === "bind" || String(mount.Source).includes("docker.sock")), false);
    assert.equal(inspection.Config.Env.some((entry) => /^(DOCKER_HOST|GITHUB_TOKEN|SOURCE_WRITE_TOKEN)=/u.test(entry)), false);
    assert.equal(inspection.Config.Env.includes(`DATABASE_URL=${database.url}`), true);
    await assert.rejects(docker(["exec", "--user", "65534:65534", container.name, "touch", "/source-write-test"]));
    return { ...input, publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: this.now().toISOString() };
  }

  async activateWorker(generationId, fence) { this.workerActivations.push({ generationId, fence }); }
  url(generationId) { return this.#containers.get(generationId)?.url; }
  async drain(generationId) { this.drained.push(generationId); }
  async retire(generationId) { const container = this.#containers.get(generationId); if (container) { await docker(["rm", "--force", container.name]); this.#containers.delete(generationId); } }
  async close() { await Promise.allSettled([...this.#containers.values()].map(({ name }) => docker(["rm", "--force", name]))); this.#containers.clear(); }
}

class PostgresCompatibilityMigrations {
  constructor(pool) { this.pool = pool; this.backfillBatches = 0; }
  async runOnline(plan) {
    const completed = [];
    for (const step of plan.steps) {
      if (step.phase === "online-expand") {
        if (step.stepId !== "migration-expand-12" || plan.baseRevision !== 11 || plan.targetRevision !== 12) throw Object.assign(new Error("Migration authority rejected an incompatible relabeled expand step."), { code: "MIGRATION_LABEL_REJECTED" });
        const session = await this.pool.connect();
        try {
          await session.query("begin");
          await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["customer-alpha:static-migration"]);
          const authority = await session.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha' for update");
          if (Number(authority.rows[0]?.revision) === 11 && authority.rows[0]?.last_step_id === "base-11") {
            await session.query("alter table p9_static_overlap add column expanded_value text; create table p9_static_backfill_checkpoint (step_id text primary key, last_id integer not null)");
            await session.query("update p9_static_migration_authority set revision=12, last_step_id=$1 where authority_id='customer-alpha'", [step.stepId]);
          } else if (Number(authority.rows[0]?.revision) !== 12 || !["migration-expand-12", "migration-backfill-12"].includes(authority.rows[0]?.last_step_id)) throw new Error("Migration authority revision lineage is incompatible.");
          await session.query("commit");
        } catch (error) { await session.query("rollback"); throw error; } finally { session.release(); }
        completed.push(step.stepId);
      }
      if (step.phase === "online-backfill") {
        if (step.stepId !== "migration-backfill-12") throw Object.assign(new Error("Migration authority rejected an incompatible relabeled backfill step."), { code: "MIGRATION_LABEL_REJECTED" });
        while (true) {
          const session = await this.pool.connect();
          try {
            await session.query("begin");
            await session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["customer-alpha:static-migration"]);
            const authority = await session.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha' for update");
            if (Number(authority.rows[0]?.revision) !== 12 || !["migration-expand-12", "migration-backfill-12"].includes(authority.rows[0]?.last_step_id)) throw new Error("Migration authority rejects a backfill without the accepted expand revision.");
            if (authority.rows[0]?.last_step_id === "migration-backfill-12") { await session.query("commit"); break; }
            const checkpoint = await session.query("select last_id from p9_static_backfill_checkpoint where step_id=$1 for update", [step.stepId]);
            const next = await session.query("select id from p9_static_overlap where id>$1 order by id limit 1", [checkpoint.rows[0]?.last_id ?? 0]);
            if (!next.rows[0]) { await session.query("update p9_static_migration_authority set last_step_id=$1 where authority_id='customer-alpha'", [step.stepId]); await session.query("commit"); break; }
            await session.query("update p9_static_overlap set expanded_value=upper(legacy_value) where id=$1 and expanded_value is null", [next.rows[0].id]);
            await session.query("insert into p9_static_backfill_checkpoint values ($1,$2) on conflict (step_id) do update set last_id=excluded.last_id", [step.stepId, next.rows[0].id]);
            await session.query("commit"); this.backfillBatches += 1;
          } catch (error) { await session.query("rollback"); throw error; } finally { session.release(); }
        }
        completed.push(step.stepId);
      }
    }
    return completed;
  }
  async runPostRetirement(plan) { const steps = plan.steps.filter((step) => step.phase === "post-retirement-contract"); for (const _step of steps) await this.pool.query("alter table p9_static_overlap drop column if exists legacy_value"); return steps.map((step) => step.stepId); }
}

async function provisionStaticBinarySchema(pool) {
  await pool.query("create table p9_static_overlap (id integer primary key, legacy_value text not null); insert into p9_static_overlap values (1,'one'),(2,'two'),(3,'three'); create table p9_static_migration_authority (authority_id text primary key, revision integer not null, last_step_id text not null); insert into p9_static_migration_authority values ('customer-alpha',11,'base-11'); create table p9_static_binary_observations (id bigserial primary key, generation_id text not null, binary_revision integer not null, database_role text not null, observed_step text not null, observed_at timestamptz not null default now()); create table p9_static_process_routes (generation_id text primary key, url text not null); create table p9_static_process_events (id bigserial primary key, role text not null, instance_id text not null, event text not null, generation_id text, deployment_revision integer, fencing_token bigint, detail jsonb not null, observed_at timestamptz not null default now()); create table p9_static_external_effects (idempotency_key text primary key, result_digest text not null, delivered_at timestamptz not null default now())");
  for (const [role, password] of [
    ["p9_static_blue", "p9-static-blue-password"], ["p9_static_green", "p9-static-green-password"],
    ["p9_static_source", "p9-static-source-password"], ["p9_static_builder", "p9-static-builder-password"],
    ["p9_static_deployer", "p9-static-deployer-password"], ["p9_static_supervisor", "p9-static-supervisor-password"],
    ["p9_static_worker", "p9-static-worker-password"], ["p9_static_gateway", "p9-static-gateway-password"],
    ["p9_static_realtime", "p9-static-realtime-password"], ["p9_static_web_admin", "p9-static-web-admin-password"]
  ]) {
    await pool.query(`create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
  }
  await pool.query(`
    revoke create on schema public from public;
    grant usage on schema public to p9_static_blue, p9_static_green, p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime, p9_static_web_admin;
    grant select, insert, update on p9_static_overlap, p9_static_migration_authority, p9_static_binary_observations to p9_static_blue, p9_static_green;
    grant usage, select on all sequences in schema public to p9_static_blue, p9_static_green;
    grant select on runtime_static_deployments, runtime_worker_generation_fences to p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime;
    grant select on runtime_static_deployments, runtime_worker_generation_fences to p9_static_web_admin;
    grant insert on p9_static_process_events to p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime;
    grant insert on p9_static_process_events to p9_static_web_admin;
    grant usage, select on sequence p9_static_process_events_id_seq to p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime;
    grant usage, select on sequence p9_static_process_events_id_seq to p9_static_web_admin;
    grant select on runtime_static_composition_checkpoints to p9_static_source;
    grant insert (checkpoint_id, application_id, environment, expected_source_commit, change_json, change_digest, status) on runtime_static_composition_checkpoints to p9_static_source;
    grant update (status, committed_at) on runtime_static_composition_checkpoints to p9_static_source;
    grant select on runtime_static_release_requests to p9_static_builder, p9_static_deployer, p9_static_supervisor;
    grant insert (request_digest, application_id, environment, version, source_commit, change_plan_digest, change_json, authorization_json, status) on runtime_static_release_requests to p9_static_builder;
    grant update (status, build_evidence_digest, application_digest, image_digest, updated_at) on runtime_static_release_requests to p9_static_builder;
    grant update (status, updated_at) on runtime_static_release_requests to p9_static_deployer;
    grant update (status, generation_id, migration_revision, worker_fencing_token, receipt_id, receipt_json, updated_at) on runtime_static_release_requests to p9_static_supervisor;
    grant select on runtime_static_deployment_outbox to p9_static_supervisor;
    grant select, insert, update on runtime_worker_effects to p9_static_worker;
    -- SELECT FOR UPDATE is required to atomically claim an effect, but this role
    -- may renew only its lease: it cannot transfer the active generation/token.
    grant update (lease_expires_at, updated_at) on runtime_worker_generation_fences to p9_static_worker;
    grant select on p9_static_process_routes to p9_static_gateway, p9_static_realtime;
    grant select on runtime_extension_inventory_revisions to p9_static_web_admin;
  `);
}

test("proves distinct customer binaries and deployment processes recover from PostgreSQL authority", { timeout: 300_000 }, async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_deployment").withStartupTimeout(120_000).start();
  const sourceDirectory = await prepareCustomerSource();
  const artifactsDirectory = await mkdtemp(join(tmpdir(), "knex-p9-static-artifacts-"));
  const pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
  const network = `knex-p9-${randomUUID()}`;
  const gateway = new StableGateway();
  // The PostgreSQL effect-claim predicate uses database `now()`, so the fixture
  // clock must share that wall-clock window rather than a historical timestamp.
  let now = new Date();
  const crashEvidence = new Set();
  const scenarioEvidence = new Set();
  let trafficProbe;
  let generations;
  const topology = [];
  const builtImages = [];
  try {
    const baseCommit = await sourceCommit(sourceDirectory);
    const blueBuild = await prepareBaseImage(sourceDirectory, baseCommit, artifactsDirectory);
    builtImages.push(blueBuild);
    await boot(postgres.getConnectionUri());
    await provisionStaticBinarySchema(pool);
    await docker(["network", "create", network]);
    await docker(["network", "connect", "--alias", "p9-postgres", network, postgres.getId()]);
    await gateway.start();
    const managedRequest = {
      applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "platform-plugin", id: "module.sales" },
      operation: "update", targetVersion: "1.0.1", expectedRevision: 0,
      idempotencyKey: "static-web-admin-update-12", correlationId: "static-web-admin-correlation-12"
    };
    const authorization = {
      actor: { kind: "trusted-automation", identity: "github-actions:phase-9" },
      decisionId: digestJson({ authority: "github-actions:phase-9", request: { ...managedRequest, requestDigest: digestJson(managedRequest) } })
    };
    const approvedInputPath = join(artifactsDirectory, "approved-static-update.json");
    const sourceResultPath = join(artifactsDirectory, "source-authority-result.json");
    const authorityResultPath = join(artifactsDirectory, "source-authority-checkpoint.json");
    const buildResultPath = join(artifactsDirectory, "builder-result.json");
    const approvedInput = {
      applicationId: "customer-alpha", environment: "production", plugin: { id: "module.sales", version: "1.0.1", packageSpec: "file:packages/k-nex-module-sales-1.0.1.tgz" },
      authority: { identity: "github-app:k-nex-change-authority" }, authorization, baseApplicationDigest: blueBuild.applicationDigest,
      rollbackClosesAt: new Date(now.valueOf() + 86_400_000).toISOString()
    };
    await writeFile(approvedInputPath, `${canonicalJson(approvedInput)}\n`);
    const approvedInputDigest = await fileDigest(approvedInputPath);
    const processCredentials = {
      "source-authority": ["p9_static_source", "p9-static-source-password"], builder: ["p9_static_builder", "p9-static-builder-password"],
      deployer: ["p9_static_deployer", "p9-static-deployer-password"], supervisor: ["p9_static_supervisor", "p9-static-supervisor-password"],
      worker: ["p9_static_worker", "p9-static-worker-password"], gateway: ["p9_static_gateway", "p9-static-gateway-password"],
      "realtime-client": ["p9_static_realtime", "p9-static-realtime-password"], "web-admin": ["p9_static_web_admin", "p9-static-web-admin-password"]
    };
    const processBase = {
      P9_SOURCE_DIRECTORY: sourceDirectory, P9_EXPECTED_BASE_COMMIT: baseCommit, P9_APPROVED_INPUT_PATH: approvedInputPath,
      P9_APPROVED_INPUT_DIGEST: approvedInputDigest, P9_SOURCE_RESULT_PATH: sourceResultPath, P9_BUILD_RESULT_PATH: buildResultPath,
      P9_AUTHORITY_RESULT_PATH: authorityResultPath, P9_ARTIFACTS_DIRECTORY: artifactsDirectory
    };
    const processEnv = (role, extra) => {
      const database = new URL(postgres.getConnectionUri());
      [database.username, database.password] = processCredentials[role];
      return { ...processBase, DATABASE_URL: database.toString(), ...extra };
    };
    let sourceAuthorityProcess = startTopologyProcess("source-authority", processEnv("source-authority", { P9_PROCESS_INSTANCE: "source-authority-1", P9_STAY_ALIVE: "1" }));
    topology.push(sourceAuthorityProcess);
    const sourceReady = await sourceAuthorityProcess.ready;
    const sourceResult = JSON.parse(await readFile(sourceResultPath, "utf8"));
    assert.equal(sourceReady.sourceCommit, sourceResult.targetSourceCommit);
    assert.equal(sourceReady.sourceResultDigest, await fileDigest(sourceResultPath));
    const targetCommit = sourceResult.targetSourceCommit;
    assert.notEqual(baseCommit, targetCommit);
    assert.equal((await git(sourceDirectory, ["show", "--format=", "--name-only", targetCommit])).stdout.includes("k-nex.app.json"), true);
    assert.equal((await git(sourceDirectory, ["show", "--format=", "--name-only", targetCommit])).stdout.includes("package-lock.json"), true);
    let builderProcess = startTopologyProcess("builder", processEnv("builder", { P9_PROCESS_INSTANCE: "builder-1", P9_SOURCE_RESULT_DIGEST: sourceReady.sourceResultDigest, P9_STAY_ALIVE: "1", P9_READY_TIMEOUT_MS: "120000" }));
    topology.push(builderProcess);
    const builderReady = await builderProcess.ready;
    const greenBuild = JSON.parse(await readFile(buildResultPath, "utf8"));
    assert.equal(builderReady.buildRequestDigest, greenBuild.buildRequestDigest);
    assert.equal(builderReady.buildResultDigest, await fileDigest(buildResultPath));
    assert.equal(greenBuild.state, "attested");
    const durableCheckpoint = await pool.query("select checkpoint_id, status, expected_source_commit, change_digest from runtime_static_composition_checkpoints");
    assert.deepEqual(durableCheckpoint.rows, [{ checkpoint_id: greenBuild.checkpointId, status: "committed", expected_source_commit: baseCommit, change_digest: greenBuild.change.planDigest }]);
    await waitForProcessEvent(pool, "source-authority", "source-change-authorized");
    builtImages.push(greenBuild);
    assert.notEqual(blueBuild.imageDigest, greenBuild.imageDigest);
    assert.notEqual(blueBuild.applicationDigest, greenBuild.applicationDigest);
    const plan = greenBuild.change.change;
    const change = greenBuild.change;
    const authority = new TrustedStaticApplicationBuildAuthority({
      "builder:k-nex-phase-9": { publicKey: greenBuild.publicKey, authority: greenBuild.evidence.authority }
    });
    const build = { authority, token: authority.verify(change, greenBuild.evidence), evidence: greenBuild.evidence };
    const deploymentClient = new PostgresTrustedBuildDeploymentClient(pool);
    assert.equal((await deploymentClient.readRequest(greenBuild.buildRequestDigest)).status, "builder-attested");
    Object.assign(processBase, {
      P9_BUILD_REQUEST_DIGEST: greenBuild.buildRequestDigest, P9_BUILD_EVIDENCE_DIGEST: build.authority.read(build.token).evidenceDigest,
      P9_APPLICATION_DIGEST: greenBuild.applicationDigest, P9_SOURCE_COMMIT: targetCommit, P9_SOURCE_RESULT_DIGEST: sourceReady.sourceResultDigest
    });
    // The web/admin boundary owns an operator API and a PluginManager only.  It
    // gets the immutable source result back from the separate source authority,
    // but never receives source, builder, Docker, or deployment credentials.
    const managedStore = new PostgresRuntimeExtensionStore(pool, { now: () => now }, sha256("p9-static-web-admin-inventory"));
    let staticReleases;
    const manager = new PluginManager(
      "p9-web-admin",
      new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      { plan: async (request) => ({ plan: managedRequest.operation === "update" ? {
        schemaVersion: 1, planId: "sales-static-plan-12", operationId: request.operationId, operation: "update", version: plan.plugin.version,
        artifactDigest: plan.plugin.releaseManifestDigest, expectedRevision: 0, targetGenerationId: "customer-alpha-green-12",
        approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
        availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
      } : assert.fail("Unexpected static manager operation"), sourceCommit: baseCommit, generationId: "customer-alpha-green-12" }) },
      managedStore,
      { stage: async () => assert.fail("Platform Plugin delivery must not stage a live artifact."), reverify: async () => false },
      { request: async () => change },
      deploymentClient
    );
    const operatorApi = new ExtensionOperatorApi(
      manager,
      { list: async () => [{ extension: managedRequest.extension, version: plan.plugin.version, displayName: "Sales", support: "supported", review: "approved", security: "clear", revoked: false, availability: "static-release" }] },
      { validate: async (operation) => staticReleases ? staticReleases.validate(operation) : assert.fail("Static release operator is configured after the trusted builder starts."), execute: async (operation) => staticReleases.execute(operation), rollback: async (operation) => staticReleases.rollback(operation) },
      { observe: async () => ({ runnerIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "runner-isolation-profile.json"), "utf8")), remoteUiIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "remote-ui-isolation-profile.json"), "utf8")), health: [] }) }
    );
    const managedPlan = await operatorApi.plan(managedRequest);
    assert.equal(managedPlan.executionClass, "static-release");
    const deploymentRequest = managedPlan.deployment;
    assert.equal(deploymentRequest.buildRequestDigest, greenBuild.buildRequestDigest, "PluginManager must reuse the builder-owned durable request.");
    assert.equal((await operatorApi.plan(managedRequest)).operationId, managedPlan.operationId, "web retries must reuse one durable PluginManager operation and release request");
    const artifacts = new LocalArtifactProvider(new Map([[blueBuild.imageDigest, blueBuild], [greenBuild.imageDigest, greenBuild]]));
    generations = new DockerGenerationHost(network, gateway, artifacts, () => now, pool);
    generations.registerDatabaseAuthority("customer-alpha-blue-11", { role: "p9_static_blue", schemaRevision: 11, url: "postgresql://p9_static_blue:p9-static-blue-password@p9-postgres:5432/static_deployment" });
    generations.registerDatabaseAuthority("customer-alpha-green-12", { role: "p9_static_green", schemaRevision: 12, url: "postgresql://p9_static_green:p9-static-green-password@p9-postgres:5432/static_deployment" });
    generations.registerDatabaseAuthority("customer-alpha-failed-12", { role: "p9_static_green", schemaRevision: 12, url: "postgresql://p9_static_green:p9-static-green-password@p9-postgres:5432/static_deployment" });
    const migrations = new PostgresCompatibilityMigrations(pool);
    const relabeledMigration = { ...plan.migration, steps: plan.migration.steps.map((step) => step.stepId === "migration-expand-12" ? { ...step, stepId: "migration-expand-renamed-12" } : step) };
    await assert.rejects(migrations.runOnline(relabeledMigration), { code: "MIGRATION_LABEL_REJECTED" });
    const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, build.authority);
    const blue = { generationId: "customer-alpha-blue-11", sourceCommit: baseCommit, compositionChangePlanDigest: digestJson(plan.base), buildEvidenceDigest: digestJson({ sourceCommit: baseCommit, imageDigest: blueBuild.imageDigest }), applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, imageReference: blueBuild.imageReference, migrationRevision: 11 };
    const owner = { applicationId: "customer-alpha", environment: "production" };
    const leaseExpiresAt = new Date(now.valueOf() + 240_000).toISOString();
    await store.initialize({ ...owner, generation: blue, workerOwner: "worker:phase-9-blue", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt });
    await generations.start({ ...owner, generationId: blue.generationId, imageReference: blueBuild.imageReference, workerMode: "passive" });
    await generations.readiness({ ...owner, generationId: blue.generationId, sourceCommit: baseCommit, applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, migrationRevision: 11, completedMigrationSteps: [] });
    await gateway.converge({ ...owner, generationId: blue.generationId, revision: 0 });
    trafficProbe = startContinuousHttpProbe({
      url: gateway.url(), path: "/public", initialWindow: "install", initialGenerations: [blue.generationId],
      generation: (body) => body.generation
    });
    await trafficProbe.waitForGeneration("install", blue.generationId);
    const assertRoleDenied = async (role, statement) => {
      const rolePool = new pg.Pool({ connectionString: processEnv(role, {}).DATABASE_URL });
      try { await assert.rejects(rolePool.query(statement), /permission denied/u); }
      finally { await rolePool.end(); }
    };
    await Promise.all([
      assertRoleDenied("builder", "update runtime_static_release_requests set generation_id='forged'"),
      assertRoleDenied("worker", "select * from runtime_static_release_requests"),
      assertRoleDenied("gateway", "update runtime_worker_generation_fences set fencing_token=fencing_token+1"),
      assertRoleDenied("source-authority", "update runtime_static_composition_checkpoints set change_json='{}'::jsonb"),
      assertRoleDenied("web-admin", "select * from runtime_static_release_requests")
    ]);
    const webAdminPort = await nextPort();
    const webAdminProcess = startTopologyProcess("web-admin", processEnv("web-admin", { P9_PROCESS_INSTANCE: "web-admin-1", P9_CONTROL_PORT: String(webAdminPort) }));
    topology.push(webAdminProcess);
    const webAdminReady = await webAdminProcess.ready;
    const webAdminStatus = await fetch(`${webAdminReady.url}/p9-admin-status`).then((response) => response.json());
    assert.equal(webAdminStatus.deniedAuthority, true);
    assert.equal(webAdminStatus.inventoryRevision >= 1, true);
    await waitForProcessEvent(pool, "web-admin", "web-admin-authority-denied");
    let deployerProcess = startTopologyProcess("deployer", processEnv("deployer", { P9_PROCESS_INSTANCE: "deployer-1", P9_STAY_ALIVE: "1" }));
    topology.push(deployerProcess);
    await deployerProcess.ready;
    let supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-1", P9_STAY_ALIVE: "1" }));
    topology.push(supervisorProcess);
    await supervisorProcess.ready;
    let blueWorkerProcess = startTopologyProcess("worker", processEnv("worker", { P9_PROCESS_INSTANCE: "worker-blue-1", P9_PROCESS_GENERATION: blue.generationId, P9_EFFECT_ID: "process-worker-effect" }));
    topology.push(blueWorkerProcess);
    await blueWorkerProcess.ready;
    let greenWorkerProcess = startTopologyProcess("worker", processEnv("worker", { P9_PROCESS_INSTANCE: "worker-green-1", P9_PROCESS_GENERATION: "customer-alpha-green-12", P9_EFFECT_ID: "process-worker-effect" }));
    topology.push(greenWorkerProcess);
    await greenWorkerProcess.ready;
    const gatewayPort = await nextPort();
    let processGateway = startTopologyProcess("gateway", processEnv("gateway", { P9_PROCESS_INSTANCE: "gateway-1", P9_CONTROL_PORT: String(gatewayPort) }));
    topology.push(processGateway);
    const processGatewayReady = await processGateway.ready;
    const processGatewayUrl = processGatewayReady.url;
    let realtimeProcess = startTopologyProcess("realtime-client", processEnv("realtime-client", { P9_PROCESS_INSTANCE: "realtime-1", P9_GATEWAY_URL: processGatewayUrl }));
    topology.push(realtimeProcess);
    await realtimeProcess.ready;
    await Promise.all([
      waitForProcessEvent(pool, "source-authority", "source-committed"), waitForProcessEvent(pool, "builder", "builder-built-and-attested"), waitForProcessEvent(pool, "deployer", "deployer-recovered"),
      waitForProcessEvent(pool, "supervisor", "supervisor-recovered"), waitForProcessEvent(pool, "worker", "worker-passive", 1),
      waitForProcessEvent(pool, "realtime-client", "realtime-resynced"), waitForProcessEvent(pool, "worker", "worker-effect-completed", 1, blueWorkerProcess)
    ]);
    await builderProcess.stop();
    builderProcess = startTopologyProcess("builder", processEnv("builder", { P9_PROCESS_INSTANCE: "builder-2", P9_STAY_ALIVE: "1" }));
    topology.push(builderProcess);
    await builderProcess.ready;
    await deployerProcess.stop();
    deployerProcess = startTopologyProcess("deployer", processEnv("deployer", { P9_PROCESS_INSTANCE: "deployer-2", P9_STAY_ALIVE: "1" }));
    topology.push(deployerProcess);
    await deployerProcess.ready;
    await sourceAuthorityProcess.stop();
    sourceAuthorityProcess = startTopologyProcess("source-authority", processEnv("source-authority", { P9_PROCESS_INSTANCE: "source-authority-2", P9_STAY_ALIVE: "1" }));
    topology.push(sourceAuthorityProcess);
    await sourceAuthorityProcess.ready;
    await Promise.all([waitForProcessEvent(pool, "source-authority", "source-recovered"), waitForProcessEvent(pool, "builder", "builder-recovered"), waitForProcessEvent(pool, "deployer", "deployer-recovered", 2)]);
    crashEvidence.add("source-attested:builder");
    crashEvidence.add("deployment-authorized:deployer");
    scenarioEvidence.add("SCN-21");
    const realtimeEvents = [];
    const realtime = { reconnectAndResync: async ({ activeGenerationId, ...event }) => { const response = await fetch(`${gateway.url()}/realtime-resync`); assert.equal((await response.json()).generation, activeGenerationId); realtimeEvents.push({ ...event, activeGenerationId }); } };
    const supervisor = new DeploymentSupervisor(build.authority, artifacts, migrations, generations, store, gateway, realtime);
    staticReleases = new DurableStaticReleaseOperator(
      deploymentClient,
      { verifiedBuild: async (request) => request.buildRequestDigest === deploymentRequest.buildRequestDigest ? build.token : undefined },
      build.authority,
      supervisor,
      { acquire: async () => ({ workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }) }
    );
    const effectLeaseExpiresAt = new Date(now.valueOf() + 120_000).toISOString();
    await assert.rejects(store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimantId: "worker:phase-9-green-a", claimLeaseExpiresAt: effectLeaseExpiresAt }), { code: "FENCE_REJECTED" });
    const blueEffect = await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, claimantId: "worker:phase-9-blue", claimLeaseExpiresAt: effectLeaseExpiresAt });
    assert.equal((await deliverExternalEffect(pool, blueEffect.externalIdempotencyKey, "sales external effect")).duplicate, false);
    await assert.rejects(supervisor.deploy({ build: build.token, generationId: "customer-alpha-failed-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /failed health checks/);
    assert.equal(gateway.active(), blue.generationId);

    await pool.query("create function p9_fail_fence_transfer() returns trigger language plpgsql as $$ begin if new.fencing_token=2 then raise exception 'simulated fence transfer crash'; end if; return new; end $$");
    await pool.query("create trigger p9_fail_fence_transfer before update on runtime_worker_generation_fences for each row execute function p9_fail_fence_transfer()");
    await assert.rejects(supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /simulated fence transfer crash/);
    assert.equal(gateway.active(), blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    crashEvidence.add("warming:web-green");
    await pool.query("drop trigger p9_fail_fence_transfer on runtime_worker_generation_fences");
    await pool.query("drop function p9_fail_fence_transfer()");

    const inFlightBlue = fetch(`${gateway.url()}/slow`).then((response) => response.json());
    await delay(30);
    const converge = gateway.converge.bind(gateway);
    let failPostCommitGateway = true;
    gateway.converge = async (input) => {
      if (failPostCommitGateway) throw new Error("simulated post-commit gateway crash");
      return converge(input);
    };
    trafficProbe.transition("update", [blue.generationId, "customer-alpha-green-12"]);
    await trafficProbe.waitForGeneration("update", blue.generationId);
    await assert.rejects(operatorApi.activate(managedPlan.operationId), /simulated post-commit gateway crash/);
    assert.equal((await store.read(owner)).active.generationId, "customer-alpha-green-12");
    assert.deepEqual((await store.read(owner)).transitionCheckpoint.completedSteps, ["activate-worker"]);
    failPostCommitGateway = false;
    const managedReceipt = await operatorApi.activate(managedPlan.operationId);
    assert.deepEqual(await operatorApi.activate(managedPlan.operationId), managedReceipt, "completed static activation must replay the exact persisted receipt");
    const managedInventory = await manager.inventory("customer-alpha", "production");
    const managedSales = managedInventory.extensions.platformPlugins["module.sales"];
    assert.equal(managedSales.disposition, "active");
    assert.deepEqual(managedSales.activeGeneration, {
      authority: "static-build", generationId: "customer-alpha-green-12", version: plan.plugin.version,
      sourceCommit: targetCommit, compositionChangePlanDigest: change.planDigest,
      buildEvidenceDigest: build.authority.read(build.token).evidenceDigest,
      applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest,
      migrationRevision: 12, workerFencingToken: 2, receiptId: managedReceipt.receipt.receiptId
    });
    await supervisor.recover(owner);
    await trafficProbe.waitForGeneration("update", "customer-alpha-green-12");
    assert.equal((await inFlightBlue).generation, blue.generationId);
    assert.equal(gateway.active(), "customer-alpha-green-12");
    assert.equal((await store.readFence(owner)).activeExecutionGeneration, "customer-alpha-green-12");
    await supervisor.recover(owner);
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, "customer-alpha-green-12");
    const [oldBinarySchema, newBinarySchema] = await Promise.all([
      fetch(`${generations.url(blue.generationId)}/schema-proof`).then((response) => response.json()),
      fetch(`${processGatewayUrl}/schema-proof`).then((response) => response.json())
    ]);
    assert.deepEqual(oldBinarySchema, { databaseRole: "p9_static_blue", schemaRevision: 12, values: ["one", "two", "three"] });
    assert.deepEqual(newBinarySchema, { databaseRole: "p9_static_green", schemaRevision: 12, values: ["ONE", "TWO", "THREE"] });
    crashEvidence.add("rollback-open:web-blue");
    await supervisorProcess.stop();
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-2" }));
    topology.push(supervisorProcess);
    await supervisorProcess.ready;
    await greenWorkerProcess.stop();
    greenWorkerProcess = startTopologyProcess("worker", processEnv("worker", { P9_PROCESS_INSTANCE: "worker-green-2", P9_PROCESS_GENERATION: "customer-alpha-green-12", P9_EFFECT_ID: "process-worker-effect" }));
    topology.push(greenWorkerProcess);
    await greenWorkerProcess.ready;
    await realtimeProcess.stop();
    realtimeProcess = startTopologyProcess("realtime-client", processEnv("realtime-client", { P9_PROCESS_INSTANCE: "realtime-2", P9_GATEWAY_URL: processGatewayUrl }));
    topology.push(realtimeProcess);
    await realtimeProcess.ready;
    await Promise.all([
      waitForProcessEvent(pool, "supervisor", "supervisor-recovered", 2), waitForProcessEvent(pool, "worker", "worker-active"),
      waitForProcessEvent(pool, "realtime-client", "realtime-resynced", 2)
    ]);
    const deployedAuthority = {
      generationId: "customer-alpha-green-12", version: plan.plugin.version, sourceCommit: targetCommit,
      compositionChangePlanDigest: change.planDigest, buildEvidenceDigest: build.authority.read(build.token).evidenceDigest,
      applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest, migrationRevision: 12,
      workerFencingToken: 2, receiptId: "static-promotion-1"
    };
    assert.equal(await deploymentClient.reverify(deployedAuthority), true, "a restarted supervisor must publish only the durable source/build/deployment authority");
    assert.equal(await deploymentClient.reverify({ ...deployedAuthority, imageDigest: blueBuild.imageDigest }), false, "an arbitrary image cannot masquerade as a deployed static release");
    crashEvidence.add("promoted:supervisor");
    crashEvidence.add("promoted:worker-green");
    crashEvidence.add("promoted:realtime-client");
    const liveBlueClaim = await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimantId: "worker:phase-9-green-a", claimLeaseExpiresAt: effectLeaseExpiresAt });
    assert.equal(liveBlueClaim.status, "already-claimed", "Fence transfer must not reassign a live blue claim to green.");
    assert.equal(liveBlueClaim.externalIdempotencyKey, blueEffect.externalIdempotencyKey);
    now = new Date(now.valueOf() + 121_000);
    const greenEffect = await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimantId: "worker:phase-9-green-a", claimLeaseExpiresAt: new Date(now.valueOf() + 60_000).toISOString() });
    assert.equal(greenEffect.status, "claimed");
    assert.equal(greenEffect.externalIdempotencyKey, blueEffect.externalIdempotencyKey, "Retries across a fence retain the external identity.");
    const reconciled = await deliverExternalEffect(pool, greenEffect.externalIdempotencyKey, "sales external effect");
    assert.equal(reconciled.duplicate, true, "The observable external sink must reject the replay even when the old database completion is stale.");
    await assert.rejects(store.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, claimToken: blueEffect.claimToken, resultDigest: reconciled.resultDigest }), { code: "FENCE_REJECTED" });
    await store.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimToken: greenEffect.claimToken, resultDigest: reconciled.resultDigest });
    assert.equal((await pool.query("select count(*)::int count from p9_static_external_effects where idempotency_key=$1", [blueEffect.externalIdempotencyKey])).rows[0].count, 1);
    scenarioEvidence.add("SCN-18");
    const overlap = await Promise.all([pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap"), pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap"), fetch(`${gateway.url()}/new-binary`).then((response) => response.json())]);
    assert.deepEqual(overlap[0].rows[0].values, ["one", "two", "three"]);
    assert.deepEqual(overlap[1].rows[0].values, ["ONE", "TWO", "THREE"]);
    assert.deepEqual({ generation: overlap[2].generation, module: overlap[2].module, pluginVersion: overlap[2].pluginVersion }, { generation: "customer-alpha-green-12", module: "module.sales", pluginVersion: "1.0.1" });
    assert.equal(migrations.backfillBatches >= 3, true);

    trafficProbe.transition("rollback", ["customer-alpha-green-12", blue.generationId]);
    await trafficProbe.waitForGeneration("rollback", "customer-alpha-green-12");
    await supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt });
    await trafficProbe.waitForGeneration("rollback", blue.generationId);
    assert.equal(gateway.active(), blue.generationId);
    await supervisor.recover(owner);
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, blue.generationId);
    await blueWorkerProcess.stop();
    blueWorkerProcess = startTopologyProcess("worker", processEnv("worker", { P9_PROCESS_INSTANCE: "worker-blue-2", P9_PROCESS_GENERATION: blue.generationId, P9_EFFECT_ID: "process-worker-effect" }));
    topology.push(blueWorkerProcess);
    await blueWorkerProcess.ready;
    await waitForProcessEvent(pool, "worker", "worker-active", 2);
    crashEvidence.add("rolled-back:worker-blue");
    trafficProbe.transition("re-promotion", [blue.generationId, "customer-alpha-green-12"]);
    await trafficProbe.waitForGeneration("re-promotion", blue.generationId);
    await supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt });
    await trafficProbe.waitForGeneration("re-promotion", "customer-alpha-green-12");
    await assert.rejects(supervisor.runContractCleanup(owner, plan.migration), { code: "CONTRACT_CLEANUP_BLOCKED" });
    const closed = await supervisor.closeRollback(owner);
    assert.equal(closed.contractCleanup, "eligible");
    assert.deepEqual(await supervisor.runContractCleanup(owner, plan.migration), ["migration-contract-12"]);
    scenarioEvidence.add("SCN-17");
    assert.equal((await pool.query("select count(*)::int count from information_schema.columns where table_name='p9_static_overlap' and column_name='legacy_value'")).rows[0].count, 0);
    assert.equal(realtimeEvents.length, 3);
    const outbox = await pool.query("select revision, event_json->>'operation' operation from runtime_static_deployment_outbox order by revision");
    assert.deepEqual(outbox.rows, [{ revision: 1, operation: "promote" }, { revision: 2, operation: "rollback" }, { revision: 3, operation: "promote" }, { revision: 4, operation: "reserve-rollback-retirement" }, { revision: 5, operation: "close-rollback" }]);
    await pool.query("update runtime_static_deployments set transition_checkpoint=$1::jsonb where application_id=$2 and environment=$3", [JSON.stringify({ kind: "promote", revision: 4, activeGenerationId: "customer-alpha-green-12", previousGenerationId: blue.generationId, completedSteps: ["converge-gateway"] }), owner.applicationId, owner.environment]);
    await assert.rejects(store.read(owner), { code: "INPUT_INVALID" }, "forged or out-of-order recovery checkpoints must fail closed");
    await pool.query("update runtime_static_deployments set transition_checkpoint=null where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]);
    await processGateway.stop();
    await delay(100);
    processGateway = startTopologyProcess("gateway", processEnv("gateway", { P9_PROCESS_INSTANCE: "gateway-2", P9_CONTROL_PORT: String(gatewayPort) }));
    topology.push(processGateway);
    await processGateway.ready;
    assert.equal((await fetch(`${processGatewayUrl}/probe`)).ok, true);
    await waitForProcessEvent(pool, "gateway", "gateway-recovered", 2);
    crashEvidence.add("post-transition:gateway");
  } finally {
    await trafficProbe?.stop();
    await Promise.allSettled(topology.map((process) => process.stop()));
    await generations?.close();
    await gateway.close();
    await docker(["network", "rm", network]).catch(() => undefined);
    await Promise.allSettled(builtImages.map(({ tag }) => docker(["image", "rm", "--force", tag])));
    await pool.end();
    await postgres.stop();
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(artifactsDirectory, { recursive: true, force: true });
  }
  trafficProbe.assertEvidence({
    install: ["customer-alpha-blue-11"],
    update: ["customer-alpha-blue-11", "customer-alpha-green-12"],
    rollback: ["customer-alpha-green-12", "customer-alpha-blue-11"],
    "re-promotion": ["customer-alpha-blue-11", "customer-alpha-green-12"]
  });
  scenarioEvidence.add("SCN-20");
  const expectedCrashEvidence = [
    "deployment-authorized:deployer", "post-transition:gateway", "promoted:realtime-client", "promoted:supervisor",
    "promoted:worker-green", "rollback-open:web-blue", "rolled-back:worker-blue", "source-attested:builder", "warming:web-green"
  ];
  assert.deepEqual([...crashEvidence].sort(), expectedCrashEvidence);
  assert.deepEqual([...scenarioEvidence].sort(), ["SCN-17", "SCN-18", "SCN-20", "SCN-21"]);
  console.log(`P9_STATIC_SCENARIO_EVIDENCE=${JSON.stringify({ crashMatrix: expectedCrashEvidence, scenarios: [...scenarioEvidence].sort(), continuousHttp: trafficProbe.summary() })}`);
});

test("returns maintenance-required without building or starting a target generation", async () => {
  const offlinePlan = { migration: { steps: [{ phase: "offline-required" }] } };
  let starts = 0;
  const supervisor = new DeploymentSupervisor(
    { read: () => ({ change: { change: offlinePlan }, evidence: {} }) },
    { resolve: async () => { throw new Error("must not resolve"); } },
    { runOnline: async () => { throw new Error("must not migrate"); }, runPostRetirement: async () => [] },
    { start: async () => { starts += 1; }, readiness: async () => { throw new Error("must not probe"); }, activateWorker: async () => undefined, drain: async () => undefined, retire: async () => undefined },
    { read: async () => undefined, readFence: async () => undefined, promote: async () => { throw new Error("must not promote"); }, rollback: async () => { throw new Error("unused"); }, reserveRollbackRetirement: async () => { throw new Error("unused"); }, closeRollback: async () => { throw new Error("unused"); }, completeTransitionStep: async () => { throw new Error("unused"); }, assertContractCleanup: async () => undefined },
    { converge: async () => { throw new Error("must not route"); } }, { reconnectAndResync: async () => { throw new Error("must not reconnect"); } }
  );
  assert.deepEqual(await supervisor.deploy({ build: {}, generationId: "customer-alpha-green-12", workerOwner: "worker:green", workerLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }), { outcome: "maintenance-required", reasons: ["offline-migration"] });
  assert.equal(starts, 0);
});
