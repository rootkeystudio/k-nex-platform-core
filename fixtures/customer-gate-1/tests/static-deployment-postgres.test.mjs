import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
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
  ExtensionOperatorApi,
  PluginManager,
  TrustedAutomationOperationAuthorizer,
  TrustedStaticApplicationBuildAuthority
} from "@k-nex/runtime";
import { startContinuousHttpProbe } from "./continuous-http-probe.mjs";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = join(fixtureDirectory, "..", "..");
const staticDeploymentDirectory = join(fixtureDirectory, "static-deployment");
const topologyProcess = join(staticDeploymentDirectory, "topology-process.mjs");
const npm = join(dirname(process.execPath), "npm");
const run = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));
const operatorPackages = Object.freeze([
  { name: "@k-nex/contracts", version: "0.0.0", path: "static-deployment/operator-packages/k-nex-contracts-0.0.0.tgz" },
  { name: "@k-nex/composition", version: "0.0.0", path: "static-deployment/operator-packages/k-nex-composition-0.0.0.tgz" },
  { name: "@k-nex/extension-bundler", version: "0.0.0", path: "static-deployment/operator-packages/k-nex-extension-bundler-0.0.0.tgz" },
  { name: "@k-nex/runtime", version: "0.0.0", path: "static-deployment/operator-packages/k-nex-runtime-0.0.0.tgz" },
  { name: "@k-nex/payload-adapter", version: "0.0.0", path: "static-deployment/operator-packages/k-nex-payload-adapter-0.0.0.tgz" }
]);
let supervisorControlToken;

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

async function supervisorCommand(url, command) {
  if (!supervisorControlToken) throw new Error("Supervisor control token is not provisioned.");
  const response = await fetch(`${url}/commands`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${supervisorControlToken}` }, body: JSON.stringify(command) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error), { code: value.code, status: response.status });
  return value;
}

class SupervisorDeploymentClient {
  constructor(url) { this.url = url; }
  async request(change, authorization) {
    return (await supervisorCommand(this.url, {
      commandId: `release-${digestJson({ change, authorization }).slice(7, 31)}`,
      operation: "release-request",
      applicationId: change.change.applicationId,
      environment: change.change.environment,
      change,
      authorization
    })).result;
  }
  async reverify(authority) {
    return (await supervisorCommand(this.url, { commandId: `reverify-${digestJson(authority).slice(7, 31)}`, operation: "release-reverify", authority })).result.verified;
  }
}

class SupervisorStaticReleaseOperator {
  constructor(url) { this.url = url; this.leases = new Map(); }
  lease(operation, owner) {
    let lease = this.leases.get(operation.operationId);
    if (!lease) { lease = { workerOwner: owner, workerLeaseExpiresAt: new Date(Date.now() + 240_000).toISOString() }; this.leases.set(operation.operationId, lease); }
    return lease;
  }
  async validate(operation) {
    return { operationId: operation.operationId, executionClass: "static-release", phase: operation.phase, valid: true, checks: ["durable-source-change", "trusted-build", "exact-version", "supervisor-command-boundary"] };
  }
  async execute(operation) {
    const plan = operation.plan;
    if (plan.plan.availability.outcome === "maintenance-required") {
      return (await supervisorCommand(this.url, {
        commandId: `maintenance-${operation.operationId}`, operation: "maintenance-required", applicationId: operation.request.applicationId, environment: operation.request.environment,
        operationId: operation.operationId, generationId: plan.generationId, expectedRevision: operation.request.expectedRevision,
        deliveryClass: operation.request.extension.deliveryClass, extensionId: operation.request.extension.id
      })).result;
    }
    const result = await supervisorCommand(this.url, {
      commandId: `promote-${operation.operationId}`, operation: "promote", applicationId: operation.request.applicationId, environment: operation.request.environment,
      generationId: plan.generationId, buildRequestDigest: plan.deployment.buildRequestDigest, expectedRevision: operation.request.expectedRevision,
      ...this.lease(operation, "worker:phase-9-green")
    });
    return result.result;
  }
  async rollback(operation) {
    const plan = operation.plan;
    return (await supervisorCommand(this.url, {
      commandId: `rollback-${operation.operationId}`, operation: "rollback", applicationId: operation.request.applicationId, environment: operation.request.environment,
      generationId: plan.generationId, buildRequestDigest: plan.deployment.buildRequestDigest, expectedRevision: operation.request.expectedRevision,
      ...this.lease(operation, "worker:phase-9-blue")
    })).result;
  }
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
  await cp(join(fixtureDirectory, "..", "customer-alpha", "k-nex.app.json"), join(sourceDirectory, "k-nex.app.json"));
  await cp(join(staticDeploymentDirectory, "customer-package.json"), join(sourceDirectory, "package.json"));
  await cp(staticDeploymentDirectory, join(sourceDirectory, "static-deployment"), { recursive: true });
  await cp(join(fixtureDirectory, "..", "customer-alpha", "src"), join(sourceDirectory, "src"), { recursive: true });
  await cp(join(fixtureDirectory, "..", "customer-alpha", "tsconfig.json"), join(sourceDirectory, "tsconfig.json"));
  await cp(join(fixtureDirectory, "packages"), join(sourceDirectory, "packages"), { recursive: true });
  const operatorPackages = join(sourceDirectory, "static-deployment", "operator-packages");
  await mkdir(operatorPackages, { recursive: true });
  for (const name of ["contracts", "composition", "extension-bundler", "runtime", "payload-adapter"]) {
    await command("pnpm", ["pack", "--pack-destination", operatorPackages], join(repositoryRoot, "packages", name));
  }
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
    "tsconfig.json", "src/boot.ts", "src/k-nex-readiness.ts", "src/k-nex-registry.ts", "src/payload.config.ts", "src/migrations/20260827_000001_sales_baseline.ts", "src/migrations/20260827_000002_knex_bootstrap.ts", "src/migrations/index.ts",
    "static-deployment/Dockerfile", "static-deployment/customer-application-gate.mjs", "static-deployment/deployment-supervisor-process.mjs", "static-deployment/healthcheck.mjs", "static-deployment/next.config.mjs", "static-deployment/payload.config.ts", "static-deployment/release-worker.mjs", "static-deployment/release.json", "static-deployment/static-runtime.ts", "static-deployment/topology-process.mjs", "static-deployment/tsconfig.customer.json", "static-deployment/tsconfig.next.json", "static-deployment/web-admin-container.mjs",
    "static-deployment/app/layout.tsx", "static-deployment/app/page.tsx", "static-deployment/app/api/[...slug]/route.ts", "static-deployment/app/[endpoint]/route.ts",
    "static-deployment-migration.ts", salesTarball
  ];
  paths.push(...operatorPackages.map(({ path }) => path));
  const digests = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await fileDigest(join(sourceDirectory, path))])));
  const pluginVersion = JSON.parse(await readFile(join(sourceDirectory, "static-deployment", "release.json"), "utf8")).plugin.version;
  const packageClosure = [{ name: "@k-nex/module-sales", version: pluginVersion, path: salesTarball }, ...operatorPackages]
    .map((item) => ({ ...item, digest: digests[item.path] }));
  const composition = {
    applicationManifestDigest: digests["k-nex.app.json"],
    lockfileDigest: digests["package-lock.json"],
    resolvedGraphDigest: digests[".k-nex/generated/resolved-graph.json"],
    generatedRegistriesDigest: digestJson({ customerPayloadRegistry: Object.fromEntries(paths.filter((path) => path === "tsconfig.json" || path.startsWith("src/") || path.startsWith("static-deployment/app/") || ["static-deployment/customer-application-gate.mjs", "static-deployment/next.config.mjs", "static-deployment/payload.config.ts", "static-deployment/release-worker.mjs", "static-deployment/static-runtime.ts", "static-deployment/tsconfig.customer.json", "static-deployment/tsconfig.next.json"].includes(path)).map((path) => [path, digests[path]])), dockerfile: digests["static-deployment/Dockerfile"], healthcheck: digests["static-deployment/healthcheck.mjs"], topology: digests["static-deployment/topology-process.mjs"], supervisor: digests["static-deployment/deployment-supervisor-process.mjs"], webAdmin: digests["static-deployment/web-admin-container.mjs"] }),
    packageClosureDigest: digestJson(Object.fromEntries(packageClosure.map(({ path, digest }) => [path, digest]))),
    migrationPlanDigest: digests["static-deployment-migration.ts"]
  };
  return { composition, digests, paths, packageClosure, pluginVersion };
}

async function prepareBaseImage(sourceDirectory, commit, artifactsDirectory, fixtureLabel, trackedImages) {
  const materials = await sourceMaterials(sourceDirectory);
  const applicationBundle = Buffer.from(canonicalJson({ sourceCommit: commit, files: materials.digests }));
  const applicationPath = join(artifactsDirectory, `${commit}.application.json`);
  await writeFile(applicationPath, applicationBundle);
  const applicationDigest = sha256(applicationBundle);
  const tag = `knex-p9-customer-alpha:${commit.slice(0, 12)}`;
  trackedImages.push({ tag });
  await docker(["build", "--pull=false", "--file", "static-deployment/Dockerfile", "--tag", tag,
    "--build-arg", `K_NEX_SOURCE_COMMIT=${commit}`, "--build-arg", `K_NEX_APPLICATION_DIGEST=${applicationDigest}`, "--build-arg", `K_NEX_FIXTURE_LABEL=${fixtureLabel}`, "."], { cwd: sourceDirectory });
  const inspection = JSON.parse((await docker(["image", "inspect", tag])).stdout)[0];
  const imageDigest = inspection.Id;
  assert.match(imageDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(inspection.Config.Labels["org.opencontainers.image.revision"], commit);
  assert.equal(inspection.Config.Labels["dev.k-nex.application-digest"], applicationDigest);
  return { applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, tag };
}

async function startIsolatedWebAdminContainer({ network, imageId, databaseUrl, operator, supervisorUrl }) {
  const name = `knex-p9-web-admin-${randomUUID().slice(0, 8)}`;
  await docker([
    "run", "--detach", "--name", name, "--network", network, "--label", `p9-fixture=${network}`, "--label", "p9-role=web-admin",
    "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5",
    "--publish", "127.0.0.1::3001", "--env", "HOME=/tmp", "--env", `DATABASE_URL=${databaseUrl}`, "--env", "P9_WEB_ADMIN_PORT=3001", "--env", `P9_OPERATOR_CONFIGURATION=${JSON.stringify(operator)}`, "--env", `P9_SUPERVISOR_URL=${supervisorUrl}`,
    imageId, "node", "web-admin-container.mjs"
  ]);
  const port = (await docker(["port", name, "3001/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
  assert.ok(port, "The isolated web/admin container did not publish its fixed status port.");
  const inspection = JSON.parse((await docker(["inspect", name])).stdout)[0];
  assert.equal(inspection.Config.User, "65534:65534");
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspection.HostConfig.CapDrop.includes("ALL"), true);
  assert.equal(inspection.HostConfig.SecurityOpt.includes("no-new-privileges"), true);
  assert.equal(inspection.Mounts.length, 0, "The actual web/admin process must not receive source or artifact mounts.");
  assert.equal(inspection.Config.Env.some((entry) => /^(DOCKER_HOST|GITHUB_TOKEN|SOURCE_WRITE_TOKEN|P9_SOURCE_DIRECTORY|P9_ARTIFACTS_DIRECTORY|P9_BUILDER_SIGNING_KEY_PATH)=/u.test(entry)), false);
  const url = `http://127.0.0.1:${port}`;
  let proof;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${url}/p9-admin-isolation`).catch(() => undefined);
    if (response?.ok) { proof = await response.json(); break; }
    await delay(100);
  }
  if (!proof) {
    const logs = await docker(["logs", name]).then(({ stdout, stderr }) => `${stdout}${stderr}`).catch((error) => error.message);
    assert.fail(`The isolated web/admin process did not become ready: ${logs}`);
  }
  assert.deepEqual(proof && { inventoryReadable: proof.inventoryReadable, deploymentTableDenied: proof.deploymentTableDenied, sourceWriteDenied: proof.sourceWriteDenied, buildDenied: proof.buildDenied, dockerDenied: proof.dockerDenied, supervisorDenied: proof.supervisorDenied, controlPlaneAbsent: proof.controlPlaneAbsent }, {
    inventoryReadable: true, deploymentTableDenied: true, sourceWriteDenied: true, buildDenied: true, dockerDenied: true, supervisorDenied: true, controlPlaneAbsent: true
  }, "The real isolated web/admin process must execute and reject source-write, build, Docker, and deployment-table attempts.");
  return { name, processId: proof.processId, url, stop: () => docker(["rm", "--force", name]) };
}

async function provisionStaticBinarySchema(pool) {
  await pool.query("create table p9_static_overlap (id integer primary key, legacy_value text not null); insert into p9_static_overlap values (1,'one'),(2,'two'),(3,'three'); create table p9_static_migration_authority (authority_id text primary key, revision integer not null, last_step_id text not null); insert into p9_static_migration_authority values ('customer-alpha',11,'base-11'); create table p9_static_binary_observations (id bigserial primary key, generation_id text not null, binary_revision integer not null, database_role text not null, observed_step text not null, observed_at timestamptz not null default now()); create table p9_static_process_routes (generation_id text primary key, url text not null); create table p9_static_process_events (id bigserial primary key, role text not null, instance_id text not null, event text not null, generation_id text, deployment_revision integer, fencing_token bigint, detail jsonb not null, observed_at timestamptz not null default now()); create table p9_static_deployment_commands (command_id text primary key, command_digest text not null, command_json jsonb not null, status text not null check (status in ('running','succeeded','failed')), result_json jsonb, error_code text, error_message text, updated_at timestamptz not null default now()); create table p9_static_external_effects (idempotency_key text primary key, result_digest text not null, delivered_at timestamptz not null default now())");
  for (const [role, password] of [
    ["p9_static_blue", "p9-static-blue-password"], ["p9_static_green", "p9-static-green-password"],
    ["p9_static_source", "p9-static-source-password"], ["p9_static_builder", "p9-static-builder-password"],
    ["p9_static_deployer", "p9-static-deployer-password"], ["p9_static_supervisor", "p9-static-supervisor-password"],
    ["p9_static_worker", "p9-static-worker-password"], ["p9_static_gateway", "p9-static-gateway-password"],
    ["p9_static_realtime", "p9-static-realtime-password"], ["p9_static_web_admin", "p9-static-web-admin-password"]
  ]) {
    await pool.query(`create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
  }
  await pool.query("alter table p9_static_overlap owner to p9_static_supervisor; alter table p9_static_migration_authority owner to p9_static_supervisor");
  await pool.query(`
    revoke create on schema public from public;
    grant usage on schema public to p9_static_blue, p9_static_green, p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime, p9_static_web_admin;
    grant create on schema public to p9_static_supervisor;
    grant select on p9_static_overlap, p9_static_migration_authority to p9_static_blue, p9_static_green;
    grant select on runtime_worker_generation_fences to p9_static_blue, p9_static_green;
    grant insert on p9_static_binary_observations to p9_static_blue, p9_static_green;
    grant usage, select on all sequences in schema public to p9_static_blue, p9_static_green;
    grant insert on p9_static_process_events to p9_static_blue, p9_static_green;
    grant usage, select on sequence p9_static_process_events_id_seq to p9_static_blue, p9_static_green;
    grant select on runtime_static_deployments, runtime_worker_generation_fences to p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime;
    grant select on runtime_extension_operations to p9_static_supervisor;
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
    grant insert, update on runtime_static_deployments, runtime_worker_generation_fences, runtime_static_deployment_outbox to p9_static_supervisor;
    grant select on runtime_static_deployment_outbox to p9_static_supervisor;
    grant select, insert, update on p9_static_deployment_commands, p9_static_process_routes to p9_static_supervisor;
    grant select, insert, update on runtime_worker_effects to p9_static_worker;
    grant select, insert on p9_static_external_effects to p9_static_worker;
    -- SELECT FOR UPDATE is required to atomically claim an effect, but this role
    -- may renew only its lease: it cannot transfer the active generation/token.
    grant update (lease_expires_at, updated_at) on runtime_worker_generation_fences to p9_static_worker;
    grant select on p9_static_process_routes to p9_static_gateway, p9_static_realtime;
    grant select, insert, update on runtime_extensions, runtime_extension_inventory_revisions, runtime_extension_operations, runtime_extension_operation_budget, runtime_extension_transition_receipts, runtime_extension_audit, runtime_extension_outbox to p9_static_web_admin;
  `);
}

test("proves distinct customer binaries and deployment processes recover from PostgreSQL authority", { timeout: 360_000 }, async () => {
  supervisorControlToken = sha256(randomUUID());
  const network = `knex-p9-${randomUUID()}`;
  let postgres;
  let sourceDirectory;
  let artifactsDirectory;
  let builderTrustDirectory;
  let pool;
  // The PostgreSQL effect-claim predicate uses database `now()`, so the fixture
  // clock must share that wall-clock window rather than a historical timestamp.
  let now = new Date();
  const crashEvidence = new Set();
  const scenarioEvidence = new Set();
  let trafficProbe;
  let webAdminContainer;
  let supervisorUrl;
  const topology = [];
  const builtImages = [];
  let networkCreated = false;
  const cleanupFailures = [];
  const cleanup = async (name, operation) => {
    try { await operation(); }
    catch (error) { cleanupFailures.push(new Error(`${name}: ${error.message}`, { cause: error })); }
  };
  const removeLabeledContainer = async (name) => {
    try { await docker(["rm", "--force", name]); return; }
    catch (error) { if (!/removal of container .* is already in progress/u.test(error.message)) throw error; }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const present = await docker(["inspect", name]).then(() => true).catch(() => false);
      if (!present) return;
      await delay(100);
    }
    throw new Error(`Container ${name} remained after Docker reported removal in progress.`);
  };
  try {
    postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_deployment").withLabels({ "p9-fixture": network }).withStartupTimeout(120_000).start();
    sourceDirectory = await prepareCustomerSource();
    artifactsDirectory = await mkdtemp(join(tmpdir(), "knex-p9-static-artifacts-"));
    builderTrustDirectory = await mkdtemp(join(tmpdir(), "knex-p9-static-builder-trust-"));
    pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
    const baseCommit = await sourceCommit(sourceDirectory);
    const blueBuild = await prepareBaseImage(sourceDirectory, baseCommit, artifactsDirectory, network, builtImages);
    const baseBuildPath = join(artifactsDirectory, "base-build.json");
    await writeFile(baseBuildPath, `${canonicalJson({ ...blueBuild, sourceCommit: baseCommit })}\n`);
    await boot(postgres.getConnectionUri());
    await provisionStaticBinarySchema(pool);
    await docker(["network", "create", "--label", `p9-fixture=${network}`, network]);
    networkCreated = true;
    await docker(["network", "connect", "--alias", "p9-postgres", network, postgres.getId()]);
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
    const trustedBuilderKeys = generateKeyPairSync("ed25519");
    const untrustedBuilderKeys = generateKeyPairSync("ed25519");
    const trustedBuilderAuthority = {
      kind: "self-hosted-trusted", builderIdentity: "builder:k-nex-phase-9",
      trustPolicyDigest: digestJson({ policy: "fixture-static-builder: immutable source and Docker output" }), ref: "source-commit"
    };
    const builderSigningKeyPath = join(builderTrustDirectory, "trusted-builder-private.pem");
    const builderTrustPolicyPath = join(builderTrustDirectory, "trusted-builder-policy.json");
    await writeFile(builderSigningKeyPath, trustedBuilderKeys.privateKey.export({ type: "pkcs8", format: "pem" }));
    await writeFile(builderTrustPolicyPath, `${canonicalJson({ builderIdentity: trustedBuilderAuthority.builderIdentity, publicKey: trustedBuilderKeys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: trustedBuilderAuthority })}\n`);
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
      P9_AUTHORITY_RESULT_PATH: authorityResultPath, P9_ARTIFACTS_DIRECTORY: artifactsDirectory,
      P9_BASE_BUILD_PATH: baseBuildPath, P9_BUILDER_SIGNING_KEY_PATH: builderSigningKeyPath, P9_BUILDER_TRUST_POLICY_PATH: builderTrustPolicyPath, P9_FIXTURE_LABEL: network
    };
    const processEnv = (role, extra) => {
      const database = new URL(postgres.getConnectionUri());
      [database.username, database.password] = processCredentials[role];
      const environment = { ...processBase, DATABASE_URL: database.toString(), ...extra };
      if (role !== "builder") delete environment.P9_BUILDER_SIGNING_KEY_PATH;
      if (role === "supervisor") {
        environment.P9_CONTROL_TOKEN = supervisorControlToken;
        delete environment.P9_SOURCE_DIRECTORY;
        delete environment.P9_EXPECTED_BASE_COMMIT;
        delete environment.P9_APPROVED_INPUT_PATH;
        delete environment.P9_APPROVED_INPUT_DIGEST;
        delete environment.P9_SOURCE_RESULT_PATH;
        delete environment.P9_AUTHORITY_RESULT_PATH;
        delete environment.P9_ARTIFACTS_DIRECTORY;
      }
      return environment;
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
    builtImages.push({ tag: `knex-p9-customer-alpha:${targetCommit.slice(0, 12)}` });
    let builderProcess = startTopologyProcess("builder", processEnv("builder", { P9_PROCESS_INSTANCE: "builder-1", P9_SOURCE_RESULT_DIGEST: sourceReady.sourceResultDigest, P9_STAY_ALIVE: "1", P9_READY_TIMEOUT_MS: "120000" }));
    topology.push(builderProcess);
    const builderReady = await builderProcess.ready;
    const greenBuild = JSON.parse(await readFile(buildResultPath, "utf8"));
    now = new Date();
    assert.equal(builderReady.buildRequestDigest, greenBuild.buildRequestDigest);
    assert.equal(builderReady.buildResultDigest, await fileDigest(buildResultPath));
    assert.equal(greenBuild.state, "attested");
    const targetMaterials = await sourceMaterials(sourceDirectory);
    assert.equal(greenBuild.composition.packageClosureDigest, targetMaterials.composition.packageClosureDigest, "Signed composition must cover the exact package closure installed into the immutable image.");
    assert.deepEqual(
      greenBuild.sbom.components.map(({ name, version, hashes }) => ({ name, version, digest: `sha256:${hashes[0].content}` })),
      targetMaterials.packageClosure.map(({ name, version, digest }) => ({ name, version, digest })),
      "The signed SBOM must enumerate Sales and every packaged operator/runtime tarball."
    );
    const durableCheckpoint = await pool.query("select checkpoint_id, status, expected_source_commit, change_digest from runtime_static_composition_checkpoints");
    assert.deepEqual(durableCheckpoint.rows, [{ checkpoint_id: greenBuild.checkpointId, status: "committed", expected_source_commit: baseCommit, change_digest: greenBuild.change.planDigest }]);
    await waitForProcessEvent(pool, "source-authority", "source-change-authorized");
    assert.notEqual(blueBuild.imageDigest, greenBuild.imageDigest);
    assert.notEqual(blueBuild.applicationDigest, greenBuild.applicationDigest);
    const plan = greenBuild.change.change;
    const change = greenBuild.change;
    const authority = new TrustedStaticApplicationBuildAuthority({
      "builder:k-nex-phase-9": { publicKey: trustedBuilderKeys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: trustedBuilderAuthority }
    });
    const build = { authority, token: authority.verify(change, greenBuild.evidence), evidence: greenBuild.evidence };
    const { signature: _trustedSignature, ...untrustedStatement } = greenBuild.evidence;
    const untrustedEvidence = {
      ...untrustedStatement,
      signature: { algorithm: "ed25519", keyId: trustedBuilderAuthority.builderIdentity, value: sign(null, Buffer.from(canonicalJson(untrustedStatement)), untrustedBuilderKeys.privateKey).toString("base64") }
    };
    assert.throws(() => authority.verify(change, untrustedEvidence), { code: "BUILD_EVIDENCE_INVALID" }, "A valid signature from an unprovisioned key must not be accepted as the trusted builder.");
    const deploymentClient = new PostgresTrustedBuildDeploymentClient(pool);
    assert.equal((await deploymentClient.readRequest(greenBuild.buildRequestDigest)).status, "builder-attested");
    Object.assign(processBase, {
      P9_BUILD_REQUEST_DIGEST: greenBuild.buildRequestDigest, P9_BUILD_EVIDENCE_DIGEST: build.authority.read(build.token).evidenceDigest,
      P9_APPLICATION_DIGEST: greenBuild.applicationDigest, P9_SOURCE_COMMIT: targetCommit, P9_SOURCE_RESULT_DIGEST: sourceReady.sourceResultDigest
    });
    const gatewayPort = await nextPort();
    let processGateway = startTopologyProcess("gateway", processEnv("gateway", { P9_PROCESS_INSTANCE: "gateway-1", P9_CONTROL_PORT: String(gatewayPort) }));
    topology.push(processGateway);
    const processGatewayUrl = (await processGateway.ready).url;
    let deployerProcess = startTopologyProcess("deployer", processEnv("deployer", { P9_PROCESS_INSTANCE: "deployer-1", P9_STAY_ALIVE: "1" }));
    topology.push(deployerProcess);
    await deployerProcess.ready;
    const supervisorPort = await nextPort();
    let supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", {
      P9_PROCESS_INSTANCE: "supervisor-1", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1"
    }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    assert.equal((await fetch(`${supervisorUrl}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401, "The supervisor must reject unauthenticated loopback callers.");
    // The controller reconnects to the operation planned by the isolated
    // web/admin process, while all release execution remains supervisor-owned.
    const managedStore = new PostgresRuntimeExtensionStore(pool, { now: () => now }, sha256("p9-static-web-admin-inventory"));
    const deploymentBoundary = new SupervisorDeploymentClient(supervisorUrl);
    const staticReleases = new SupervisorStaticReleaseOperator(supervisorUrl);
    const installPlan = {
      schemaVersion: 1, planId: "sales-static-plan-12", operation: "update", version: plan.plugin.version,
      artifactDigest: plan.plugin.releaseManifestDigest, expectedRevision: 0, targetGenerationId: "customer-alpha-green-12",
      approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    };
    const manager = new PluginManager(
      "p9-web-admin",
      new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      { plan: async (request) => ({ plan: managedRequest.operation === "update" ? { ...installPlan, operationId: request.operationId } : assert.fail("Unexpected static manager operation"), sourceCommit: baseCommit, generationId: "customer-alpha-green-12" }) },
      managedStore,
      { stage: async () => assert.fail("Platform Plugin delivery must not stage a live artifact."), reverify: async () => false },
      { request: async () => change },
      deploymentBoundary
    );
    const operatorApi = new ExtensionOperatorApi(
      manager,
      { list: async () => [{ extension: managedRequest.extension, version: plan.plugin.version, displayName: "Sales", support: "supported", review: "approved", security: "clear", revoked: false, availability: "static-release" }] },
      staticReleases,
      { observe: async () => ({ runnerIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "runner-isolation-profile.json"), "utf8")), remoteUiIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "remote-ui-isolation-profile.json"), "utf8")), health: [] }) }
    );
    const deploymentRequest = await deploymentClient.readRequest(greenBuild.buildRequestDigest);
    assert.ok(deploymentRequest, "The builder-owned durable request must exist before isolated web/admin planning.");
    const networkInspection = JSON.parse((await docker(["network", "inspect", network])).stdout)[0];
    const networkGateway = networkInspection.IPAM.Config[0].Gateway;
    const webAdminDatabase = new URL(processEnv("web-admin", {}).DATABASE_URL);
    webAdminDatabase.hostname = "p9-postgres";
    webAdminDatabase.port = "5432";
    webAdminContainer = await startIsolatedWebAdminContainer({
      network,
      imageId: greenBuild.imageDigest,
      databaseUrl: webAdminDatabase.toString(),
      operator: {
        workerId: "p9-web-admin", automationIdentity: "github-actions:phase-9", hostInventoryDigest: sha256("p9-static-web-admin-inventory"),
        request: managedRequest, authorization, installPlan, sourceCommit: baseCommit, generationId: "customer-alpha-green-12",
        sourceChange: change, deployment: deploymentRequest
      },
      supervisorUrl: `http://${networkGateway}:${supervisorPort}`
    });
    const initiated = await fetch(`${webAdminContainer.url}/p9-change-request`, { method: "POST" });
    const initiatedBody = await initiated.json();
    assert.equal(initiated.status, 202, `The actual isolated web/admin client must initiate only its authorized change request: ${initiatedBody.error ?? "unknown error"}`);
    assert.match(initiatedBody.operationId, /^operation-[0-9a-f]{32}$/u);
    assert.equal(initiatedBody.executionClass, "static-release");
    const managedPlan = await operatorApi.plan(managedRequest);
    assert.equal(managedPlan.executionClass, "static-release");
    assert.equal(managedPlan.operationId, initiatedBody.operationId, "The controller must resume the exact operation durably planned inside the isolated web/admin image.");
    assert.equal(managedPlan.deployment.buildRequestDigest, greenBuild.buildRequestDigest, "PluginManager must reuse the builder-owned durable request.");
    assert.equal((await operatorApi.plan(managedRequest)).operationId, managedPlan.operationId, "web retries must reuse one durable PluginManager operation and release request");
    const relabeledMigration = { ...plan.migration, steps: plan.migration.steps.map((step) => step.stepId === "migration-expand-12" ? { ...step, stepId: "migration-expand-renamed-12" } : step) };
    const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, build.authority);
    const blue = { generationId: "customer-alpha-blue-11", sourceCommit: baseCommit, compositionChangePlanDigest: digestJson(plan.base), buildEvidenceDigest: digestJson({ sourceCommit: baseCommit, imageDigest: blueBuild.imageDigest }), applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, imageReference: blueBuild.imageReference, migrationRevision: 11 };
    const owner = { applicationId: "customer-alpha", environment: "production" };
    const leaseExpiresAt = new Date(now.valueOf() + 299_000).toISOString();
    await assert.rejects(supervisorCommand(supervisorUrl, { commandId: "migration-label-reject-12", operation: "validate-online-migration", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0, migration: relabeledMigration }), { code: "MIGRATION_LABEL_REJECTED" });
    await supervisorCommand(supervisorUrl, { commandId: "bootstrap-blue-11", operation: "bootstrap", ...owner, generationId: blue.generationId, buildRequestDigest: greenBuild.buildRequestDigest, compositionChangePlanDigest: blue.compositionChangePlanDigest, buildEvidenceDigest: blue.buildEvidenceDigest, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt });
    trafficProbe = startContinuousHttpProbe({
      url: processGatewayUrl, path: "/public", initialWindow: "install", initialGenerations: [blue.generationId],
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
      assertRoleDenied("supervisor", "update runtime_extension_operations set phase='failed'"),
      assertRoleDenied("source-authority", "update runtime_static_composition_checkpoints set change_json='{}'::jsonb"),
      assertRoleDenied("web-admin", "select * from runtime_static_release_requests")
    ]);
    let realtimeProcess = startTopologyProcess("realtime-client", processEnv("realtime-client", { P9_PROCESS_INSTANCE: "realtime-1", P9_GATEWAY_URL: processGatewayUrl }));
    topology.push(realtimeProcess);
    await realtimeProcess.ready;
    await Promise.all([
      waitForProcessEvent(pool, "source-authority", "source-committed"), waitForProcessEvent(pool, "builder", "builder-built-and-attested"), waitForProcessEvent(pool, "deployer", "deployer-recovered"),
      waitForProcessEvent(pool, "deployer", "deployer-artifact-reverified"),
      waitForProcessEvent(pool, "supervisor", "supervisor-recovered"), waitForProcessEvent(pool, "release-worker", "worker-passive", 1),
      waitForProcessEvent(pool, "realtime-client", "realtime-resynced")
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
    const effectLeaseExpiresAt = new Date(now.valueOf() + 120_000).toISOString();
    await assert.rejects(store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimantId: "worker:phase-9-green-a", claimLeaseExpiresAt: effectLeaseExpiresAt }), { code: "FENCE_REJECTED" });
    const blueEffect = await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, claimantId: "worker:phase-9-blue", claimLeaseExpiresAt: effectLeaseExpiresAt });
    assert.equal((await deliverExternalEffect(pool, blueEffect.externalIdempotencyKey, "sales external effect")).duplicate, false);
    await supervisorCommand(supervisorUrl, { commandId: "arm-failed-green-12", operation: "arm-health-failure" });
    await assert.rejects(supervisorCommand(supervisorUrl, { commandId: "failed-green-12", operation: "promote", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /failed health checks/);
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);

    await pool.query("create function p9_fail_fence_transfer() returns trigger language plpgsql as $$ begin if new.fencing_token=2 then raise exception 'simulated fence transfer crash'; end if; return new; end $$");
    await pool.query("create trigger p9_fail_fence_transfer before update on runtime_worker_generation_fences for each row execute function p9_fail_fence_transfer()");
    await assert.rejects(supervisorCommand(supervisorUrl, { commandId: "fence-crash-green-12", operation: "promote", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /simulated fence transfer crash/);
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    await supervisorCommand(supervisorUrl, { commandId: "restart-green-after-fence-crash", operation: "restart", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0, sourceCommit: targetCommit, applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest, migrationRevision: 12, completedMigrationSteps: ["migration-expand-12", "migration-backfill-12"] });
    crashEvidence.add("warming:web-green");
    await pool.query("drop trigger p9_fail_fence_transfer on runtime_worker_generation_fences");
    await pool.query("drop function p9_fail_fence_transfer()");

    const packagedWorkerEffect = supervisorCommand(supervisorUrl, {
      commandId: "packaged-blue-worker-effect", operation: "worker-effect", ...owner, generationId: blue.generationId, expectedRevision: 0,
      effectId: "packaged-worker-effect", payload: "packaged worker external effect", delayMs: 15_000
    });
    await waitForProcessEvent(pool, "release-worker", "worker-effect-started", 1);
    const inFlightBlue = fetch(`${processGatewayUrl}/slow`).then((response) => response.json());
    await delay(30);
    await supervisorCommand(supervisorUrl, { commandId: "arm-post-commit-gateway-crash", operation: "arm-gateway-failure" });
    await supervisorCommand(supervisorUrl, { commandId: "arm-post-commit-response-crash", operation: "arm-response-crash" });
    trafficProbe.transition("update", [blue.generationId, "customer-alpha-green-12"]);
    await trafficProbe.waitForGeneration("update", blue.generationId);
    await assert.rejects(operatorApi.activate(managedPlan.operationId), /simulated post-commit gateway crash/);
    assert.equal((await store.read(owner)).active.generationId, "customer-alpha-green-12");
    assert.deepEqual((await store.read(owner)).transitionCheckpoint.completedSteps, ["activate-worker"]);
    await assert.rejects(operatorApi.activate(managedPlan.operationId), /fetch failed|other side closed|socket/u);
    if (supervisorProcess.child.exitCode === null && supervisorProcess.child.signalCode === null) await new Promise((resolve) => supervisorProcess.child.once("exit", resolve));
    assert.equal((await pool.query("select status from p9_static_deployment_commands where command_id=$1", [`promote-${managedPlan.operationId}`])).rows[0].status, "running", "SIGKILL after commit must leave an in-flight durable command for recovery.");
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-2", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1" }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    const managedReceipt = await operatorApi.activate(managedPlan.operationId);
    assert.equal((await pool.query("select status from p9_static_deployment_commands where command_id=$1", [`promote-${managedPlan.operationId}`])).rows[0].status, "succeeded");
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
    await supervisorCommand(supervisorUrl, { commandId: "recover-promote-green-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    await trafficProbe.waitForGeneration("update", "customer-alpha-green-12");
    assert.equal((await inFlightBlue).generation, blue.generationId);
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, "customer-alpha-green-12");
    assert.equal((await store.readFence(owner)).activeExecutionGeneration, "customer-alpha-green-12");
    await waitForProcessEvent(pool, "release-worker", "worker-activated", 1);
    await waitForProcessEvent(pool, "release-worker", "worker-drained", 1);
    assert.equal((await packagedWorkerEffect).result.status, "stale-completion-rejected", "Fence transfer must reject the packaged blue worker's stale database completion after its external delivery settles.");
    const releaseWorkerEvidence = await pool.query("select id, event, generation_id, fencing_token, detail from p9_static_process_events where role='release-worker' and event in ('worker-activated','worker-effect-started','worker-effect-delivered','worker-effect-completed','worker-stale-completion-rejected','worker-draining','worker-drained') order by id");
    assert.equal(releaseWorkerEvidence.rows.some((row) => row.event === "worker-activated" && row.generation_id === "customer-alpha-green-12" && Number(row.fencing_token) === 2 && row.detail.sourceCommit === targetCommit && row.detail.applicationDigest === greenBuild.applicationDigest && row.detail.imageDigest === greenBuild.imageDigest && row.detail.module === "module.sales"), true, "The supervisor must activate the green worker packaged in the exact attested release image after fence transfer.");
    assert.equal(releaseWorkerEvidence.rows.some((row) => row.event === "worker-drained" && row.generation_id === blue.generationId && row.detail.sourceCommit === baseCommit && row.detail.applicationDigest === blueBuild.applicationDigest && row.detail.imageDigest === blueBuild.imageDigest && row.detail.module === "module.sales"), true, "The supervisor must drain the prior worker binary instead of treating host checkout processes as workers.");
    const packagedEvents = releaseWorkerEvidence.rows.filter((row) => row.generation_id === blue.generationId && ["worker-effect-started", "worker-effect-delivered", "worker-stale-completion-rejected", "worker-draining", "worker-drained"].includes(row.event));
    assert.deepEqual(packagedEvents.map(({ event }) => event), ["worker-effect-started", "worker-draining", "worker-effect-delivered", "worker-stale-completion-rejected", "worker-drained"], "Drain must enter draining state, wait for the packaged worker's external delivery and stale-completion denial, then complete.");
    assert.equal(packagedEvents.find(({ event }) => event === "worker-draining").detail.inFlight, 1);
    assert.equal(packagedEvents.find(({ event }) => event === "worker-drained").detail.waitedFor, 1);
    assert.equal((await pool.query("select count(*)::int count from p9_static_external_effects where result_digest=$1", [sha256("packaged worker external effect")])).rows[0].count, 1);
    await supervisorCommand(supervisorUrl, { commandId: "recover-promote-green-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, "customer-alpha-green-12");
    const [oldBinarySchema, newBinarySchema] = await Promise.all([
      pool.query("select url from p9_static_process_routes where generation_id=$1", [blue.generationId]).then(({ rows }) => fetch(`${rows[0].url}/schema-proof`).then((response) => response.json())),
      fetch(`${processGatewayUrl}/schema-proof`).then((response) => response.json())
    ]);
    assert.deepEqual(oldBinarySchema, { databaseRole: "p9_static_blue", schemaRevision: 12, values: ["one", "two", "three"] });
    assert.deepEqual(newBinarySchema, { databaseRole: "p9_static_green", schemaRevision: 12, values: ["ONE", "TWO", "THREE"] });
    await supervisorCommand(supervisorUrl, { commandId: "restart-blue-rollback-window", operation: "restart", ...owner, generationId: blue.generationId, buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1, sourceCommit: baseCommit, applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, migrationRevision: 11, completedMigrationSteps: [] });
    crashEvidence.add("rollback-open:web-blue");
    await supervisorProcess.stop();
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-3", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1" }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    await realtimeProcess.stop();
    realtimeProcess = startTopologyProcess("realtime-client", processEnv("realtime-client", { P9_PROCESS_INSTANCE: "realtime-2", P9_GATEWAY_URL: processGatewayUrl }));
    topology.push(realtimeProcess);
    await realtimeProcess.ready;
    await Promise.all([
      waitForProcessEvent(pool, "supervisor", "supervisor-recovered", 3), waitForProcessEvent(pool, "release-worker", "worker-activated", 1),
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
    const overlap = await Promise.all([pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap"), pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap"), fetch(`${processGatewayUrl}/new-binary`).then((response) => response.json())]);
    assert.deepEqual(overlap[0].rows[0].values, ["one", "two", "three"]);
    assert.deepEqual(overlap[1].rows[0].values, ["ONE", "TWO", "THREE"]);
    assert.deepEqual({ generation: overlap[2].generation, module: overlap[2].module, pluginVersion: overlap[2].pluginVersion }, { generation: "customer-alpha-green-12", module: "module.sales", pluginVersion: "1.0.1" });
    assert.deepEqual((await pool.query("select step_id, last_id from p9_static_backfill_checkpoint")).rows, [{ step_id: "migration-backfill-12", last_id: 3 }]);

    trafficProbe.transition("rollback", ["customer-alpha-green-12", blue.generationId]);
    await trafficProbe.waitForGeneration("rollback", "customer-alpha-green-12");
    await supervisorCommand(supervisorUrl, { commandId: "rollback-green-to-blue-12", operation: "rollback", ...owner, generationId: blue.generationId, buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt });
    await trafficProbe.waitForGeneration("rollback", blue.generationId);
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, blue.generationId);
    await supervisorCommand(supervisorUrl, { commandId: "recover-rollback-blue-12", operation: "recover", ...owner, generationId: blue.generationId, buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 2 });
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, blue.generationId);
    await waitForProcessEvent(pool, "release-worker", "worker-activated", 2);
    crashEvidence.add("rolled-back:worker-blue");
    trafficProbe.transition("re-promotion", [blue.generationId, "customer-alpha-green-12"]);
    await trafficProbe.waitForGeneration("re-promotion", blue.generationId);
    await supervisorCommand(supervisorUrl, { commandId: "re-promote-green-12", operation: "promote", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 2, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt });
    await trafficProbe.waitForGeneration("re-promotion", "customer-alpha-green-12");
    await assert.rejects(supervisorCommand(supervisorUrl, { commandId: "contract-before-close-12", operation: "contract-cleanup", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 3 }), { code: "CONTRACT_CLEANUP_BLOCKED" });
    const closed = (await supervisorCommand(supervisorUrl, { commandId: "close-rollback-12", operation: "close-rollback", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 3 })).result;
    assert.equal(closed.contractCleanup, "eligible");
    assert.deepEqual((await supervisorCommand(supervisorUrl, { commandId: "contract-after-close-12", operation: "contract-cleanup", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 5 })).result.completed, ["migration-contract-12"]);
    scenarioEvidence.add("SCN-17");
    assert.equal((await pool.query("select count(*)::int count from information_schema.columns where table_name='p9_static_overlap' and column_name='legacy_value'")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from p9_static_process_events where role='realtime-client' and event='realtime-resynced'")).rows[0].count >= 3, true);
    const outbox = await pool.query("select revision, event_json->>'operation' operation from runtime_static_deployment_outbox order by revision");
    assert.deepEqual(outbox.rows, [{ revision: 1, operation: "promote" }, { revision: 2, operation: "rollback" }, { revision: 3, operation: "promote" }, { revision: 4, operation: "reserve-rollback-retirement" }, { revision: 5, operation: "close-rollback" }]);

    const offlineRequest = {
      ...managedRequest,
      expectedRevision: managedSales.revision,
      idempotencyKey: "static-web-admin-maintenance-13",
      correlationId: "static-web-admin-maintenance-correlation-13"
    };
    const offlineAuthorization = {
      actor: authorization.actor,
      decisionId: digestJson({ authority: "github-actions:phase-9", request: { ...offlineRequest, requestDigest: digestJson(offlineRequest) } })
    };
    const offlineComposition = {
      ...structuredClone(change.change),
      planId: "composition-plan-maintenance-13",
      authority: { ...change.change.authority, requestDigest: offlineAuthorization.decisionId },
      base: { ...change.change.base, sourceCommit: targetCommit, composition: change.change.target.composition },
      target: {
        ...change.change.target,
        applicationSubjectDigest: digestJson({ maintenance: "unbuilt-application", sourceCommit: targetCommit }),
        imageSubjectDigest: digestJson({ maintenance: "unbuilt-image", sourceCommit: targetCommit })
      },
      migration: {
        ...change.change.migration,
        planId: "migration-plan-maintenance-13",
        sourceCommit: targetCommit,
        targetSourceCommit: targetCommit,
        baseRevision: 12,
        targetRevision: 13,
        steps: [{
          stepId: "migration-offline-13",
          phase: "offline-required",
          migrationDigest: change.change.migration.steps[0].migrationDigest,
          availability: "maintenance-required"
        }]
      }
    };
    const offlineChange = Object.freeze({
      planDigest: digestJson(offlineComposition),
      targetSourceCommit: targetCommit,
      status: "source-change-ready",
      change: offlineComposition
    });
    const maintenancePlaceholder = Object.freeze({
      buildRequestDigest: digestJson({ operation: "maintenance-only", sourceChange: offlineChange.planDigest }),
      sourceCommit: targetCommit,
      status: "build-requested"
    });
    const offlineManager = new PluginManager(
      "p9-web-admin-maintenance",
      new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      { plan: async (request) => ({
        plan: {
          schemaVersion: 1, planId: "sales-static-maintenance-plan-13", operationId: request.operationId, operation: "update", version: offlineComposition.plugin.version,
          artifactDigest: offlineComposition.plugin.releaseManifestDigest, expectedRevision: managedSales.revision, currentGenerationId: "customer-alpha-green-12", targetGenerationId: "customer-alpha-maintenance-13",
          approvalRequired: true, rollback: { available: false, reason: "maintenance-required" }, deliveryClass: "platform-plugin", id: "module.sales",
          availability: { outcome: "maintenance-required", reasons: ["incompatible-overlap"] }
        },
        sourceCommit: targetCommit,
        generationId: "customer-alpha-maintenance-13"
      }) },
      managedStore,
      { stage: async () => assert.fail("Platform Plugin delivery must not stage a live artifact."), reverify: async () => false },
      { request: async (request, decision) => {
        assert.equal(request.expectedSourceCommit, targetCommit);
        assert.equal(request.plan.availability.outcome, "maintenance-required");
        assert.deepEqual(decision, offlineAuthorization);
        return offlineChange;
      } },
      { request: async (sourceChange, decision) => {
        assert.deepEqual(sourceChange, offlineChange);
        assert.deepEqual(decision, offlineAuthorization);
        return maintenancePlaceholder;
      }, reverify: async () => assert.fail("Maintenance refusal must not reverify a build placeholder.") }
    );
    const offlineOperatorApi = new ExtensionOperatorApi(
      offlineManager,
      { list: async () => [] },
      staticReleases,
      { observe: async () => ({ runnerIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "runner-isolation-profile.json"), "utf8")), remoteUiIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "remote-ui-isolation-profile.json"), "utf8")), health: [] }) }
    );
    const snapshot = async () => Object.freeze({
      sourceHead: await sourceCommit(sourceDirectory),
      buildResult: await fileDigest(buildResultPath),
      imageInventory: (await docker(["image", "ls", "--filter", "label=org.opencontainers.image.revision", "--format", "{{.ID}} {{.Repository}}:{{.Tag}}"]) ).stdout.trim().split("\n").filter(Boolean).sort(),
      images: await Promise.all([blueBuild.imageDigest, greenBuild.imageDigest].map(async (imageDigest) => JSON.parse((await docker(["image", "inspect", imageDigest])).stdout).map((image) => ({ id: image.Id, repoDigests: image.RepoDigests, labels: image.Config.Labels })))),
      releaseRequests: (await pool.query("select request_digest, status, generation_id, migration_revision, worker_fencing_token, receipt_id, receipt_json from runtime_static_release_requests order by request_digest")).rows,
      migrations: (await pool.query("select revision, last_step_id from p9_static_migration_authority order by authority_id")).rows,
      deployment: (await pool.query("select revision, active_generation_id, active_generation, rollback_generation_id, rollback_generation, rollback_window, transition_checkpoint from runtime_static_deployments order by application_id, environment")).rows,
      fence: (await pool.query("select active_execution_generation, fencing_token, lease_owner, lease_expires_at, promotion_revision from runtime_worker_generation_fences order by application_id, environment")).rows,
      outbox: (await pool.query("select revision, event_json from runtime_static_deployment_outbox order by revision")).rows,
      routes: (await pool.query("select generation_id, url from p9_static_process_routes order by generation_id")).rows,
      containers: (await docker(["ps", "--all", "--filter", `label=p9-fixture=${network}`, "--format", "{{.Names}}"])).stdout.trim().split("\n").filter(Boolean).sort(),
      traffic: await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())
    });
    const refusalBefore = await snapshot();
    const offlineManagedPlan = await offlineOperatorApi.plan(offlineRequest);
    assert.equal(offlineManagedPlan.executionClass, "static-release");
    assert.deepEqual((await offlineManager.operation(offlineManagedPlan.operationId)).plan, offlineManagedPlan, "PluginManager must durably retain the offline static-release plan before the supervisor sees it.");
    assert.equal((await pool.query("select count(*)::int count from runtime_static_release_requests where request_digest=$1", [maintenancePlaceholder.buildRequestDigest])).rows[0].count, 0, "The maintenance placeholder must not mint a durable release request.");
    await assert.rejects(
      supervisorCommand(supervisorUrl, {
        commandId: "maintenance-relabeled-online-12", operation: "maintenance-required", ...owner,
        operationId: managedPlan.operationId, generationId: "customer-alpha-green-12", expectedRevision: 0,
        deliveryClass: "platform-plugin", extensionId: "module.sales"
      }),
      { code: "MAINTENANCE_OPERATION_MISMATCH" },
      "An online static operation cannot be relabeled as maintenance."
    );
    assert.deepEqual(await offlineOperatorApi.activate(offlineManagedPlan.operationId), { outcome: "maintenance-required", reasons: ["offline-migration"] });
    assert.deepEqual(await snapshot(), refusalBefore, "An offline-required operation must not mutate source/build, release authority, migration, container, fence, traffic, deployment, or outbox state.");
    const refusalCommand = await pool.query("select status, result_json->'result' result from p9_static_deployment_commands where command_id=$1", [`maintenance-${offlineManagedPlan.operationId}`]);
    assert.deepEqual(refusalCommand.rows, [{ status: "succeeded", result: { outcome: "maintenance-required", reasons: ["offline-migration"] } }], "The supervisor must durably audit the refusal without creating a deployment receipt.");
    console.log(`P9_MAINTENANCE_REFUSAL_EVIDENCE=${JSON.stringify({ durablePlan: true, onlineRelabelRejected: true, stateUnchanged: true, durableAudit: true, outcome: "maintenance-required" })}`);
    await pool.query("update runtime_static_deployments set transition_checkpoint=$1::jsonb where application_id=$2 and environment=$3", [JSON.stringify({ kind: "promote", revision: 4, activeGenerationId: "customer-alpha-green-12", previousGenerationId: blue.generationId, completedSteps: ["converge-gateway"] }), owner.applicationId, owner.environment]);
    await assert.rejects(store.read(owner), { code: "INPUT_INVALID" }, "forged or out-of-order recovery checkpoints must fail closed");
    await pool.query("update runtime_static_deployments set transition_checkpoint=null where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]);
    await trafficProbe.pause();
    await processGateway.stop();
    await delay(100);
    processGateway = startTopologyProcess("gateway", processEnv("gateway", { P9_PROCESS_INSTANCE: "gateway-2", P9_CONTROL_PORT: String(gatewayPort) }));
    topology.push(processGateway);
    await processGateway.ready;
    assert.equal((await fetch(`${processGatewayUrl}/probe`)).ok, true);
    trafficProbe.resume();
    await waitForProcessEvent(pool, "gateway", "gateway-recovered", 2);
    crashEvidence.add("post-transition:gateway");
  } finally {
    await cleanup("continuous traffic probe", () => trafficProbe?.stop());
    for (const process of topology) await cleanup(`topology process ${process.output().slice(0, 80)}`, () => process.stop());
    await cleanup("isolated web/admin container", () => webAdminContainer?.stop());
    await cleanup("PostgreSQL pool", () => pool?.end());
    await cleanup("PostgreSQL container", () => postgres?.stop());
    const labeledContainers = await docker(["ps", "--all", "--filter", `label=p9-fixture=${network}`, "--format", "{{.Names}}"]).then(({ stdout }) => stdout.trim().split("\n").filter(Boolean));
    for (const name of labeledContainers) await cleanup(`labeled container ${name}`, () => removeLabeledContainer(name));
    if (networkCreated) await cleanup("fixture network", () => docker(["network", "rm", network]));
    const labeledImages = new Set((await docker(["image", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.ID}}"]).then(({ stdout }) => stdout.trim().split("\n").filter(Boolean))));
    for (const imageId of labeledImages) await cleanup(`labeled image ${imageId}`, () => docker(["image", "rm", "--force", imageId]));
    const presentTags = new Set((await docker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"]).then(({ stdout }) => stdout.trim().split("\n").filter(Boolean))));
    for (const { tag } of builtImages) if (presentTags.has(tag)) await cleanup(`tracked image ${tag}`, () => docker(["image", "rm", "--force", tag]));
    if (sourceDirectory) await cleanup("source fixture directory", () => rm(sourceDirectory, { recursive: true, force: true }));
    if (artifactsDirectory) await cleanup("artifact fixture directory", () => rm(artifactsDirectory, { recursive: true, force: true }));
    if (builderTrustDirectory) await cleanup("builder trust fixture directory", () => rm(builderTrustDirectory, { recursive: true, force: true }));
    await cleanup("zero labeled containers assertion", async () => assert.equal((await docker(["ps", "--all", "--filter", `label=p9-fixture=${network}`, "--format", "{{.ID}}"]).then(({ stdout }) => stdout.trim())).length, 0));
    await cleanup("zero labeled images assertion", async () => assert.equal((await docker(["image", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.ID}}"]).then(({ stdout }) => stdout.trim())).length, 0));
    await cleanup("zero labeled networks assertion", async () => assert.equal((await docker(["network", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.ID}}"]).then(({ stdout }) => stdout.trim())).length, 0));
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "Phase 9 static deployment fixture cleanup failed.");
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
