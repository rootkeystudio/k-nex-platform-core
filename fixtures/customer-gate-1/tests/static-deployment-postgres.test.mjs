import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { loadInstalledPlatformPluginManifests, resolvePlatformPluginGraph, writeStaticArtifacts } from "@k-nex/composition";
import { ApplicationManifestSchema, PluginManifestSchema, canonicalJson, supportedFrameworkTuple } from "@k-nex/contracts";
import salesManifest from "@k-nex/module-sales-current/manifest" with { type: "json" };
import { salesRegistration } from "@k-nex/module-sales-current/server";
import { socketIoRealtimeProviderRegistration } from "@k-nex/provider-realtime-socketio/server";
import providerManifest from "@k-nex/provider-realtime-socketio/manifest" with { type: "json" };
import {
  AuthorizationLifecycleProjector,
  PostgresAuthorizationStore,
  PostgresRuntimeExtensionStore,
  PostgresStaticDeploymentStore,
  PostgresTrustedBuildDeploymentClient,
  SharedStaticPlatformPluginGenerationRebinder,
  createStaticPlatformPluginAuthorizationDescriptorResolver
} from "@k-nex/payload-adapter";
import {
  assertPlatformPluginUninstallSupported,
  createPlatformPluginLifecycleState,
  ExtensionOperatorApi,
  executeRegistration,
  PluginManager,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration,
  TrustedAutomationOperationAuthorizer,
  TrustedStaticApplicationBuildAuthority
} from "@k-nex/runtime";
import { startContinuousHttpProbe } from "./continuous-http-probe.mjs";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = join(fixtureDirectory, "..", "..");
const staticDeploymentDirectory = join(fixtureDirectory, "static-deployment");
const topologyProcess = join(staticDeploymentDirectory, "topology-process.mjs");
const npm = "npm";
const run = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const observeDeferred = (promise) => { promise.catch(() => undefined); return promise; };
const WEB_ADMIN_READY_TIMEOUT_MS = 30_000;
const WEB_ADMIN_PROBE_TIMEOUT_MS = 1_000;
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));
const operatorPackages = Object.freeze([
  { name: "@k-nex/contracts", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-contracts-1.0.0.tgz" },
  { name: "@k-nex/composition", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-composition-1.0.0.tgz" },
  { name: "@k-nex/extension-bundler", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-extension-bundler-1.0.0.tgz" },
  { name: "@k-nex/runtime", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-runtime-1.0.0.tgz" },
  { name: "@k-nex/payload-adapter", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-payload-adapter-1.0.0.tgz" }
]);
let supervisorControlToken;

function scopedStaticRegistration(includeRealtimeProvider = false) {
  const plugins = [
    { manifest: PluginManifestSchema.parse(salesManifest), registration: salesRegistration },
    ...(includeRealtimeProvider ? [{ manifest: PluginManifestSchema.parse(providerManifest), registration: socketIoRealtimeProviderRegistration }] : [])
  ];
  const registration = executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: plugins.map(({ manifest }) => ({
        id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version,
        integrity: "sha512-c2FsZXM=", required: [], optional: []
      })),
      capabilityProviders: includeRealtimeProvider
        ? [{ capability: "realtime.gateway", plugin: providerManifest.id, version: providerManifest.version }]
        : [],
      registrationOrder: plugins.map(({ manifest }) => manifest.id)
    },
    installed: plugins.map(({ manifest }) => ({
      package: { name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" }, manifest
    })),
    registrations: plugins.map(({ registration }) => registration)
  });
  return scopePlatformPluginRegistration(registration, plugins.map(({ manifest }) => reconcilePlatformPluginAvailability(
    registration,
    createPlatformPluginLifecycleState({
      pluginId: manifest.id,
      catalogStatus: "supported",
      package: { status: "installed", name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" },
      enabled: true,
      configuration: { revision: 1, ready: true },
      migration: { current: 1, required: 1, ready: true },
      dataState: "active",
      releaseStatus: "supported"
    })
  )));
}

function activeStaticPlatformPluginLifecycleEvent(applicationId, environment, extensionId, sourceCommit, generationId) {
  return {
    schemaVersion: 1,
    applicationId,
    environment,
    eventId: "p10-static-sales-install-event",
    eventType: "extension.lifecycle-transition",
    operationId: "p10-static-sales-install-operation",
    operation: "install",
    operationPhase: "completed",
    lifecycleState: "active",
    expectedRevision: 0,
    revision: 1,
    inventoryRevision: 1,
    actor: { kind: "trusted-automation", identity: "github-actions:phase-9" },
    receiptId: "p10-static-sales-install-receipt",
    auditId: "p10-static-sales-install-audit",
    idempotencyKey: "p10-static-sales-install",
    correlationId: "p10-static-sales-install",
    occurredAt: "2026-09-01T00:00:00.000Z",
    deliveryClass: "platform-plugin",
    id: extensionId,
    evidence: {
      sourceCommit,
      compositionChangePlanDigest: `sha256:${"a".repeat(64)}`,
      generationId
    }
  };
}

async function seedAuthorizationGeneration(pool, projector, transition, runtimeGenerationIds) {
  const session = await pool.connect();
  try {
    await session.query("begin");
    await projector.project({ session, transition, runtimeGenerationIds });
    await session.query("commit");
  } catch (error) {
    await session.query("rollback");
    throw error;
  } finally {
    session.release();
  }
}

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
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
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
  return { child, ready, exit, output: () => output, stop: () => new Promise((resolve) => {
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
  constructor(url) { this.url = url; this.leases = new Map(); this.receipts = new Map(); }
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
      operationId: operation.operationId, generationId: plan.generationId, buildRequestDigest: plan.deployment.buildRequestDigest, expectedRevision: operation.request.expectedRevision,
      lifecycleExpectedRevision: operation.request.expectedRevision, deliveryClass: operation.request.extension.deliveryClass, extensionId: operation.request.extension.id,
      ...this.lease(operation, "worker:phase-9-green")
    });
    if (result.result.outcome === "promoted") this.receipts.set(operation.operationId, result.result.receipt);
    return result.result;
  }
  async rollback(operation) {
    const plan = operation.plan;
    const receipt = (await supervisorCommand(this.url, {
      commandId: `rollback-${operation.operationId}`, operation: "rollback", applicationId: operation.request.applicationId, environment: operation.request.environment,
      generationId: plan.generationId, buildRequestDigest: plan.deployment.buildRequestDigest, expectedRevision: operation.request.expectedRevision,
      ...this.lease(operation, "worker:phase-9-blue")
    })).result;
    this.receipts.set(operation.operationId, receipt);
    return receipt;
  }
  async finalize(operation) {
    const receipt = this.receipts.get(operation.operationId);
    if (!receipt) throw new Error("Static release finalization requires its exact deployment receipt.");
    await supervisorCommand(this.url, {
      commandId: `finalize-${operation.operationId}`, operation: "recover", applicationId: operation.request.applicationId, environment: operation.request.environment,
      generationId: receipt.activeGenerationId, buildRequestDigest: operation.plan.deployment.buildRequestDigest, expectedRevision: receipt.revisionAfter
    });
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

async function waitForBuilderReady(builderProcess, sourceAuthorityProcess, label) {
  return Promise.race([
    builderProcess.ready,
    sourceAuthorityProcess.exit.then(({ code, signal }) => {
      throw new Error(`source-authority exited ${signal ?? code} while ${label} awaited artifact authority: ${sourceAuthorityProcess.output().slice(-4096)}`);
    })
  ]);
}

async function docker(args, options = {}) {
  return run("docker", args, { maxBuffer: 8 * 1024 * 1024, ...options });
}

function dockerContainerMissing(error) {
  return /\bno such (?:container|object)\b/iu.test(`${error?.stderr ?? ""}\n${error?.stdout ?? ""}\n${error?.message ?? ""}`);
}

async function dockerContainerPresent(name) {
  try {
    await docker(["inspect", name]);
    return true;
  } catch (error) {
    if (dockerContainerMissing(error)) return false;
    throw error;
  }
}

async function assertDockerContainerAbsent(name, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!await dockerContainerPresent(name)) return;
    await delay(100);
  }
  assert.fail(message);
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
  const provider = lock.packages["node_modules/@k-nex/provider-realtime-socketio"];
  const graph = {
    packageLockVersion: lock.lockfileVersion,
    moduleSales: { version: sales.version, resolved: sales.resolved, integrity: sales.integrity },
    ...(provider ? { providerRealtimeSocketio: { version: provider.version, resolved: provider.resolved, integrity: provider.integrity } } : {})
  };
  await mkdir(join(sourceDirectory, ".k-nex", "generated"), { recursive: true });
  await writeFile(join(sourceDirectory, ".k-nex", "generated", "resolved-graph.json"), `${canonicalJson(graph)}\n`);
}

async function resolveLock(sourceDirectory) {
  await command(npm, ["install", "--package-lock-only", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"], sourceDirectory);
  await writeResolvedGraph(sourceDirectory);
}

async function regenerateStaticApplicationArtifacts(sourceDirectory) {
  const applicationManifest = ApplicationManifestSchema.parse(JSON.parse(await readFile(join(sourceDirectory, "k-nex.app.json"), "utf8")));
  const prior = JSON.parse(await readFile(join(sourceDirectory, ".k-nex", "generated", "k-nex.resolved.json"), "utf8"));
  const framework = { core: supportedFrameworkTuple.core, payload: supportedFrameworkTuple.payload, node: applicationManifest.runtime.node, pnpm: applicationManifest.runtime.packageManagerVersion, payloadDatabaseAdapter: supportedFrameworkTuple.payloadDatabaseAdapter };
  const packages = [...applicationManifest.plugins.map(({ package: name, version }) => ({ name, version })), ...Object.values(applicationManifest.providers).map(({ package: name, version }) => ({ name, version }))]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((entry, index, entries) => index === 0 || entries[index - 1]?.name !== entry.name);
  const installed = loadInstalledPlatformPluginManifests({ applicationRoot: fixtureDirectory, lockfilePath: join(repositoryRoot, "pnpm-lock.yaml"), lockfileImporter: "fixtures/customer-gate-1", packages, framework });
  const resolvedGraph = resolvePlatformPluginGraph({ plugins: applicationManifest.plugins, providers: applicationManifest.providers, installed });
  writeStaticArtifacts(sourceDirectory, { applicationManifest, resolvedGraph, installed, framework, customerConfigFingerprint: prior.customerConfigFingerprint });
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
  await cp(join(fixtureDirectory, "src", "current-authority.ts"), join(sourceDirectory, "src", "current-authority.ts"));
  await rm(join(sourceDirectory, "src", "migrations"), { recursive: true, force: true });
  await cp(join(fixtureDirectory, "src", "migrations"), join(sourceDirectory, "src", "migrations"), { recursive: true, force: true });
  await mkdir(join(sourceDirectory, ".k-nex"), { recursive: true });
  await cp(join(fixtureDirectory, ".k-nex", "generated"), join(sourceDirectory, ".k-nex", "generated"), { recursive: true });
  await cp(join(fixtureDirectory, "..", "customer-alpha", "tsconfig.json"), join(sourceDirectory, "tsconfig.json"));
  await cp(join(fixtureDirectory, "packages"), join(sourceDirectory, "packages"), { recursive: true });
  const salesPackageDirectory = join(repositoryRoot, "modules", "sales");
  await command("pnpm", ["build"], salesPackageDirectory);
  await rm(join(sourceDirectory, "packages", "k-nex-module-sales-1.0.0.tgz"), { force: true });
  await command("pnpm", ["pack", "--pack-destination", join(sourceDirectory, "packages")], salesPackageDirectory);
  for (const name of ["builder-puck", "composition", "contracts", "extension-bundler", "payload-adapter", "payload-builder-storage", "realtime-socketio", "runtime", "theme-minimal", "theme-neobrutalism", "ui-builder-blocks", "ui-components", "ui-data", "ui-design-system-contracts", "ui-forms", "ui-pages", "ui-runtime"]) {
    await command("pnpm", ["pack", "--pack-destination", join(sourceDirectory, "packages")], join(repositoryRoot, "packages", name));
  }
  const manifestPath = join(sourceDirectory, "k-nex.app.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.plugins.push({ id: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.0.0", enabled: true });
  manifest.providers["realtime.gateway"] = { plugin: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.0.0" };
  manifest.runtime.realtime = { adapter: "memory", webInstances: 1, worker: "separate", workerInvalidationPath: "postgres-outbox-relay", realtimeGateway: "embedded", rollingDeployment: "stop-before-start" };
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`);
  const packagePath = join(sourceDirectory, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  pkg.dependencies["@k-nex/module-sales"] = "file:packages/k-nex-module-sales-1.0.0.tgz";
  pkg.dependencies["@k-nex/provider-realtime-socketio"] = "file:packages/k-nex-provider-realtime-socketio-1.0.0.tgz";
  await writeFile(packagePath, `${canonicalJson(pkg)}\n`);
  await writeFile(join(sourceDirectory, "src", "k-nex-provider-registry.ts"), [
    'import { socketIoRealtimeProviderRegistration } from "@k-nex/provider-realtime-socketio/server";',
    "",
    "export const kNexProviderRegistry = Object.freeze({",
    "  registration: socketIoRealtimeProviderRegistration,",
    '  capabilities: Object.freeze(["realtime.gateway"])',
    "});",
    ""
  ].join("\n"));
  const operatorPackages = join(sourceDirectory, "static-deployment", "operator-packages");
  await mkdir(operatorPackages, { recursive: true });
  for (const name of ["contracts", "composition", "extension-bundler", "runtime", "payload-adapter"]) {
    await command("pnpm", ["pack", "--pack-destination", operatorPackages], join(repositoryRoot, "packages", name));
  }
  await cp(join(fixtureDirectory, "src", "migrations", "20260829_000011_static_deployment.ts"), join(sourceDirectory, "static-deployment-migration.ts"));
  await resolveLock(sourceDirectory);
  await regenerateStaticApplicationArtifacts(sourceDirectory);
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
  const providerTarball = pkg.dependencies["@k-nex/provider-realtime-socketio"]?.replace("file:", "");
  const migrations = (await readdir(join(sourceDirectory, "src", "migrations"))).sort().map((name) => `src/migrations/${name}`);
  const paths = [
    "k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/environment-schema.ts", ".k-nex/generated/k-nex.resolved.json", ".k-nex/generated/payload-contributions.ts", ".k-nex/generated/plugin-registry.ts", ".k-nex/generated/runtime-registration.ts", ".k-nex/generated/resolved-graph.json",
    "tsconfig.json", "src/boot.ts", "src/current-authority.ts", "src/k-nex-readiness.ts", "src/k-nex-registry.ts", "src/payload.config.ts", ...migrations,
    "static-deployment/Dockerfile", "static-deployment/customer-application-gate.mjs", "static-deployment/deployment-supervisor-process.mjs", "static-deployment/healthcheck.mjs", "static-deployment/next.config.mjs", "static-deployment/payload.config.ts", "static-deployment/release-worker.mjs", "static-deployment/release.json", "static-deployment/static-runtime.ts", "static-deployment/topology-process.mjs", "static-deployment/tsconfig.customer.json", "static-deployment/tsconfig.next.json", "static-deployment/web-admin-container.mjs",
    "static-deployment/app/layout.tsx", "static-deployment/app/page.tsx", "static-deployment/app/api/[...slug]/route.ts", "static-deployment/app/[endpoint]/route.ts",
    "static-deployment-migration.ts", salesTarball, ...(providerTarball ? ["src/k-nex-provider-registry.ts", providerTarball] : [])
  ];
  paths.push(...operatorPackages.map(({ path }) => path));
  const digests = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await fileDigest(join(sourceDirectory, path))])));
  const pluginVersion = JSON.parse(await readFile(join(sourceDirectory, "static-deployment", "release.json"), "utf8")).plugin.version;
  const packageClosure = [{ name: "@k-nex/module-sales", version: pluginVersion, path: salesTarball }, ...(providerTarball ? [{ name: "@k-nex/provider-realtime-socketio", version: "1.0.0", path: providerTarball }] : []), ...operatorPackages]
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
  const imageGenerationId = JSON.parse(await readFile(join(sourceDirectory, "static-deployment", "release.json"), "utf8")).generationId;
  trackedImages.push({ tag });
  await docker(["build", "--pull=false", "--file", "static-deployment/Dockerfile", "--tag", tag,
    "--build-arg", `K_NEX_SOURCE_COMMIT=${commit}`, "--build-arg", `K_NEX_APPLICATION_DIGEST=${applicationDigest}`, "--build-arg", `K_NEX_IMAGE_GENERATION=${imageGenerationId}`, "--build-arg", `K_NEX_FIXTURE_LABEL=${fixtureLabel}`, "."], { cwd: sourceDirectory });
  const inspection = JSON.parse((await docker(["image", "inspect", tag])).stdout)[0];
  const imageDigest = inspection.Id;
  assert.match(imageDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(inspection.Config.Labels["org.opencontainers.image.revision"], commit);
  assert.equal(inspection.Config.Labels["dev.k-nex.application-digest"], applicationDigest);
  assert.equal(inspection.Config.Labels["dev.k-nex.image-generation"], imageGenerationId);
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
  assert.equal(inspection.Config.Env.some((entry) => /^(DOCKER_HOST|GITHUB_TOKEN|SOURCE_WRITE_TOKEN|P9_SOURCE_DIRECTORY|P9_ARTIFACTS_DIRECTORY|P9_BUILDER_SIGNING_KEY_PATH|P9_CONTROL_TOKEN)=/u.test(entry)), false);
  const url = `http://127.0.0.1:${port}`;
  let proof;
  const readyBy = Date.now() + WEB_ADMIN_READY_TIMEOUT_MS;
  while (Date.now() < readyBy) {
    const remaining = readyBy - Date.now();
    const response = await fetch(`${url}/p9-admin-isolation`, { signal: AbortSignal.timeout(Math.min(WEB_ADMIN_PROBE_TIMEOUT_MS, remaining)) }).catch(() => undefined);
    if (response?.ok) { proof = await response.json(); break; }
    await delay(Math.min(100, Math.max(0, readyBy - Date.now())));
  }
  if (!proof) {
    const logs = await docker(["logs", name]).then(({ stdout, stderr }) => `${stdout}${stderr}`).catch((error) => error.message);
    const state = await docker(["inspect", name]).then(({ stdout }) => {
      const inspection = JSON.parse(stdout)[0]?.State;
      return inspection && {
        status: inspection.Status, running: inspection.Running, oomKilled: inspection.OOMKilled,
        exitCode: inspection.ExitCode, error: inspection.Error, startedAt: inspection.StartedAt, finishedAt: inspection.FinishedAt
      };
    }).catch((error) => ({ inspectError: error.message }));
    assert.fail(`The isolated web/admin process did not become ready within ${WEB_ADMIN_READY_TIMEOUT_MS}ms: ${canonicalJson({ state, logs })}`);
  }
  assert.deepEqual(proof && { inventoryReadable: proof.inventoryReadable, deploymentTableDenied: proof.deploymentTableDenied, sourceWriteDenied: proof.sourceWriteDenied, buildDenied: proof.buildDenied, dockerDenied: proof.dockerDenied, supervisorDenied: proof.supervisorDenied, controlPlaneAbsent: proof.controlPlaneAbsent }, {
    inventoryReadable: true, deploymentTableDenied: true, sourceWriteDenied: true, buildDenied: true, dockerDenied: true, supervisorDenied: true, controlPlaneAbsent: true
  }, "The real isolated web/admin process must execute and reject source-write, build, Docker, and deployment-table attempts.");
  return { name, processId: proof.processId, url, stop: () => docker(["rm", "--force", name]) };
}

async function provisionStaticBinarySchema(pool) {
  await pool.query("create table p9_static_overlap (id integer primary key, legacy_value text not null); insert into p9_static_overlap values (1,'one'),(2,'two'),(3,'three'); create table p9_static_migration_authority (authority_id text primary key, revision integer not null, last_step_id text not null); insert into p9_static_migration_authority values ('customer-alpha',11,'base-11'); create table p9_static_binary_observations (id bigserial primary key, generation_id text not null, binary_revision integer not null, database_role text not null, observed_step text not null, observed_at timestamptz not null default now()); create table p9_static_process_routes (application_id text not null, environment text not null, generation_id text not null, url text not null, primary key (application_id, environment, generation_id)); create table p9_static_process_events (id bigserial primary key, role text not null, instance_id text not null, event text not null, generation_id text, deployment_revision integer, fencing_token bigint, detail jsonb not null, observed_at timestamptz not null default now()); create table p9_static_deployment_commands (command_id text primary key, command_digest text not null, command_json jsonb not null, status text not null check (status in ('running','succeeded','failed')), result_json jsonb, error_code text, error_message text, updated_at timestamptz not null default now()); create table p9_static_external_effects (idempotency_key text primary key, result_digest text not null, delivered_at timestamptz not null default now())");
  await pool.query("create view p9_static_sales_lifecycle_authority with (security_barrier=true) as select disposition from runtime_extensions where application_id='customer-alpha' and environment='production' and delivery_class='platform-plugin' and extension_id='module.sales'");
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
    grant select on p9_static_sales_lifecycle_authority to p9_static_blue, p9_static_green;
    grant select (application_id, environment, delivery_class, extension_id, disposition, active_generation_id, active_generation) on runtime_extensions to p9_static_blue, p9_static_green;
    grant select on k_nex_authorization_state, k_nex_extension_authorization_generations, k_nex_roles, k_nex_role_permission_grants, k_nex_role_assignments to p9_static_blue, p9_static_green;
    grant select on runtime_worker_generation_fences to p9_static_blue, p9_static_green;
    grant insert on p9_static_binary_observations to p9_static_blue, p9_static_green;
    grant insert (id, title, status, potential_revenue, private_note, updated_at, created_at) on sales_tasks to p9_static_blue, p9_static_green;
    grant select (id, title, status, potential_revenue, private_note, updated_at, created_at) on sales_tasks to p9_static_blue, p9_static_green;
    grant select (id, name, batch, updated_at, created_at) on payload_migrations to p9_static_blue, p9_static_green;
    grant insert (event_id, event_type, schema_version, message_class, occurred_at, application_id, plugin_id, actor_id, actor_type, impersonator_id, correlation_id, causation_id, idempotency_key, payload, retention_until) on k_nex_outbox to p9_static_blue, p9_static_green;
    grant usage on sequence p9_static_binary_observations_id_seq, p9_static_process_events_id_seq, sales_tasks_id_seq, k_nex_outbox_id_seq to p9_static_blue, p9_static_green;
    grant insert on p9_static_process_events to p9_static_blue, p9_static_green;
    grant select on runtime_static_deployments, runtime_worker_generation_fences to p9_static_source, p9_static_builder, p9_static_deployer, p9_static_supervisor, p9_static_worker, p9_static_gateway, p9_static_realtime;
    grant execute on function public.k_nex_static_lifecycle_admission(character varying, character varying, character varying, character varying) to p9_static_supervisor;
    grant execute on function public.k_nex_static_shared_generation_rebind(character varying, character varying, character varying, jsonb, character varying, character varying) to p9_static_supervisor;
    grant execute on function public.k_nex_static_serving_generation(character varying, character varying) to p9_static_supervisor, p9_static_gateway;
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
    grant select, insert, update on runtime_static_generation_retirements to p9_static_supervisor;
    grant select, insert, update on runtime_static_worker_activations to p9_static_supervisor;
    grant select on runtime_static_worker_activations to p9_static_worker;
    grant select, insert on runtime_static_worker_recovery_outbox to p9_static_supervisor;
    grant select on runtime_static_deployment_outbox to p9_static_supervisor;
    grant select, insert, update on p9_static_deployment_commands to p9_static_supervisor;
    grant select, insert, update, delete on p9_static_process_routes to p9_static_supervisor;
    grant select, insert, update on runtime_worker_effects to p9_static_worker;
    grant select, insert on p9_static_external_effects to p9_static_worker;
    -- SELECT FOR UPDATE is required to atomically claim an effect, but this role
    -- may renew only its lease: it cannot transfer the active generation/token.
    grant update (lease_expires_at, updated_at) on runtime_worker_generation_fences to p9_static_worker;
    grant select on p9_static_process_routes to p9_static_gateway, p9_static_realtime;
    grant select, insert, update on runtime_extensions, runtime_extension_inventory_revisions, runtime_extension_operations, runtime_extension_operation_budget, runtime_extension_transition_receipts, runtime_extension_audit, runtime_extension_outbox to p9_static_web_admin;
  `);
}

test("proves distinct customer binaries and deployment processes recover from PostgreSQL authority", { timeout: 900_000 }, async () => {
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
  let weakProfileVolumeName;
  let attackerNetwork;
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
      const present = await dockerContainerPresent(name);
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
    const networkInspection = JSON.parse((await docker(["network", "inspect", network])).stdout)[0];
    const networkGateway = networkInspection.IPAM.Config[0].Gateway;
    const managedRequest = {
      applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "platform-plugin", id: "module.sales" },
      operation: "update", targetVersion: "1.0.0", expectedRevision: 1,
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
      applicationId: "customer-alpha", environment: "production", plugin: { id: "module.sales", version: "1.0.0", packageSpec: "file:packages/k-nex-module-sales-1.0.0.tgz" },
      authority: { identity: "github-app:k-nex-change-authority" }, authorization, baseApplicationDigest: blueBuild.applicationDigest,
      rollbackClosesAt: new Date(now.valueOf() + 86_400_000).toISOString()
    };
    await writeFile(approvedInputPath, `${canonicalJson(approvedInput)}\n`);
    const approvedInputDigest = await fileDigest(approvedInputPath);
    const processCredentials = {
      blue: ["p9_static_blue", "p9-static-blue-password"], green: ["p9_static_green", "p9-static-green-password"],
      "source-authority": ["p9_static_source", "p9-static-source-password"], builder: ["p9_static_builder", "p9-static-builder-password"],
      deployer: ["p9_static_deployer", "p9-static-deployer-password"], supervisor: ["p9_static_supervisor", "p9-static-supervisor-password"],
      worker: ["p9_static_worker", "p9-static-worker-password"], gateway: ["p9_static_gateway", "p9-static-gateway-password"],
      "realtime-client": ["p9_static_realtime", "p9-static-realtime-password"], "web-admin": ["p9_static_web_admin", "p9-static-web-admin-password"]
    };
    const processBase = {
      P9_SOURCE_DIRECTORY: sourceDirectory, P9_EXPECTED_BASE_COMMIT: baseCommit, P9_APPROVED_INPUT_PATH: approvedInputPath,
      P9_APPROVED_INPUT_DIGEST: approvedInputDigest, P9_SOURCE_RESULT_PATH: sourceResultPath, P9_BUILD_RESULT_PATH: buildResultPath,
      P9_AUTHORITY_RESULT_PATH: authorityResultPath, P9_ARTIFACTS_DIRECTORY: artifactsDirectory,
      P9_BASE_BUILD_PATH: baseBuildPath, P9_BUILDER_SIGNING_KEY_PATH: builderSigningKeyPath, P9_BUILDER_TRUST_POLICY_PATH: builderTrustPolicyPath,
      P9_FIXTURE_LABEL: network, P9_WORKER_CLOCK_SKEW_MS: "60000", P9_ARTIFACT_WAIT_TIMEOUT_MS: "480000"
    };
    const processEnv = (role, extra) => {
      const database = new URL(postgres.getConnectionUri());
      [database.username, database.password] = processCredentials[role];
      const environment = { ...processBase, DATABASE_URL: database.toString(), ...extra };
      if (role !== "builder") delete environment.P9_BUILDER_SIGNING_KEY_PATH;
      if (role === "supervisor") {
        // Linux owns the bridge gateway. Docker Desktop cannot bind that VM address,
        // so its short-lived random-port test endpoint is bearer-token guarded.
        environment.P9_CONTROL_BIND_ADDRESS = process.platform === "linux" ? networkGateway : "0.0.0.0";
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
    assert.deepEqual(sourceResult.mutated, ["static-deployment/release.json"]);
    assert.deepEqual(
      (await git(sourceDirectory, ["show", "--format=", "--name-only", targetCommit])).stdout.trim().split("\n"),
      ["static-deployment/release.json"],
      "Same-version promotion must change only immutable generation metadata, not package or application versions."
    );
    assert.deepEqual((await pool.query(
      "select detail->'mutated' mutated from p9_static_process_events where role='source-authority' and event='source-committed' order by id desc limit 1"
    )).rows, [{ mutated: ["static-deployment/release.json"] }]);
    builtImages.push({ tag: `knex-p9-customer-alpha:${targetCommit.slice(0, 12)}` });
    let builderProcess = startTopologyProcess("builder", processEnv("builder", { P9_PROCESS_INSTANCE: "builder-1", P9_SOURCE_RESULT_DIGEST: sourceReady.sourceResultDigest, P9_STAY_ALIVE: "1", P9_READY_TIMEOUT_MS: "480000" }));
    topology.push(builderProcess);
    const builderReady = await waitForBuilderReady(builderProcess, sourceAuthorityProcess, "builder");
    const greenBuild = JSON.parse(await readFile(buildResultPath, "utf8"));
    now = new Date();
    assert.equal(builderReady.buildRequestDigest, greenBuild.buildRequestDigest);
    assert.equal(builderReady.buildResultDigest, await fileDigest(buildResultPath));
    assert.equal(greenBuild.state, "attested");
    const targetMaterials = await sourceMaterials(sourceDirectory);
    assert.equal(targetMaterials.paths.includes("src/k-nex-provider-registry.ts"), true, "The current signed composition must include the provider's generated static registry.");
    assert.equal(greenBuild.composition.packageClosureDigest, targetMaterials.composition.packageClosureDigest, "Signed composition must cover the exact package closure installed into the immutable image.");
    assert.deepEqual(
      greenBuild.sbom.components.map(({ name, version, hashes }) => ({ name, version, digest: `sha256:${hashes[0].content}` })),
      targetMaterials.packageClosure.map(({ name, version, digest }) => ({ name, version, digest })),
      "The signed SBOM must enumerate Sales, the schema-less provider, and every packaged operator/runtime tarball."
    );
    assert.equal(greenBuild.sbom.components.some(({ name }) => name === "@k-nex/provider-realtime-socketio"), true, "The current static application must contain the provider before its removal proof.");
    const durableCheckpoint = await pool.query("select checkpoint_id, status, expected_source_commit, change_digest from runtime_static_composition_checkpoints");
    assert.deepEqual(durableCheckpoint.rows, [{ checkpoint_id: greenBuild.checkpointId, status: "committed", expected_source_commit: baseCommit, change_digest: greenBuild.change.planDigest }]);
    await waitForProcessEvent(pool, "source-authority", "source-change-authorized");
    assert.notEqual(blueBuild.imageDigest, greenBuild.imageDigest);
    assert.notEqual(blueBuild.applicationDigest, greenBuild.applicationDigest);
    const plan = greenBuild.change.change;
    const change = greenBuild.change;
    assert.equal(plan.plugin.version, "1.0.0");
    assert.equal(plan.base.composition.packageClosureDigest, plan.target.composition.packageClosureDigest,
      "Blue/green proof changes immutable source/image generation, not unreleased package versions.");
    const blueInventoryGeneration = {
      authority: "static-build", generationId: "customer-alpha-blue-11", version: "1.0.0", sourceCommit: baseCommit,
      compositionChangePlanDigest: digestJson(plan.base), buildEvidenceDigest: digestJson({ sourceCommit: baseCommit, imageDigest: blueBuild.imageDigest }),
      applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, migrationRevision: 11,
      workerFencingToken: 1, receiptId: "receipt-customer-alpha-blue-11"
    };
    await pool.query(
      `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
       values ($1,$2,'platform-plugin','module.sales',1,'active',$3,$4::jsonb)`,
      [managedRequest.applicationId, managedRequest.environment, blueInventoryGeneration.generationId, JSON.stringify(blueInventoryGeneration)]
    );
    await pool.query(
      "insert into runtime_extension_inventory_revisions (application_id, environment, revision) values ($1,$2,1)",
      [managedRequest.applicationId, managedRequest.environment]
    );
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
    const salesScopedRegistration = scopedStaticRegistration();
    const salesAuthorizationProjector = new AuthorizationLifecycleProjector(
      createStaticPlatformPluginAuthorizationDescriptorResolver({
        applicationId: managedRequest.applicationId,
        registrations: [
          { sourceCommit: baseCommit, registration: salesScopedRegistration },
          { sourceCommit: targetCommit, registration: salesScopedRegistration }
        ]
      })
    );
    const managedStore = new PostgresRuntimeExtensionStore(pool, { now: () => now }, sha256("p9-static-web-admin-inventory"), {
      authorizationLifecycleProjector: salesAuthorizationProjector,
      sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder()
    });
    const deploymentBoundary = new SupervisorDeploymentClient(supervisorUrl);
    const staticReleases = new SupervisorStaticReleaseOperator(supervisorUrl);
    const installPlan = {
      schemaVersion: 1, planId: "sales-static-plan-12", operation: "update", version: plan.plugin.version,
      artifactDigest: plan.plugin.releaseManifestDigest, expectedRevision: 1, currentGenerationId: blueInventoryGeneration.generationId, targetGenerationId: "customer-alpha-green-12",
      approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    };
    const manager = new PluginManager(
      "p9-web-admin",
      new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      { validate: async () => undefined, plan: async (request) => ({ plan: managedRequest.operation === "update" ? { ...installPlan, operationId: request.operationId } : assert.fail("Unexpected static manager operation"), sourceCommit: baseCommit, generationId: "customer-alpha-green-12" }) },
      managedStore,
      { stage: async () => assert.fail("Platform Plugin delivery must not stage a live artifact."), reverify: async () => false },
      { request: async () => change },
      deploymentBoundary,
      undefined,
      { now: () => now }
    );
    const operatorApi = new ExtensionOperatorApi(
      manager,
      { list: async () => [{ extension: managedRequest.extension, version: plan.plugin.version, displayName: "Sales", support: "supported", review: "approved", security: "clear", revoked: false, availability: "static-release" }] },
      staticReleases,
      { observe: async () => ({ runnerIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "runner-isolation-profile.json"), "utf8")), remoteUiIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "remote-ui-isolation-profile.json"), "utf8")), health: [] }) }
    );
    const deploymentRequest = await deploymentClient.readRequest(greenBuild.buildRequestDigest);
    assert.ok(deploymentRequest, "The builder-owned durable request must exist before isolated web/admin planning.");
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
      supervisorUrl: process.platform === "linux" ? `http://${networkGateway}:${supervisorPort}` : `http://host.docker.internal:${supervisorPort}`
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
    const liveStore = new PostgresStaticDeploymentStore(pool, { now: () => new Date() }, build.authority);
    const blue = { generationId: "customer-alpha-blue-11", sourceCommit: baseCommit, compositionChangePlanDigest: digestJson(plan.base), buildEvidenceDigest: digestJson({ sourceCommit: baseCommit, imageDigest: blueBuild.imageDigest }), applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, imageReference: blueBuild.imageReference, migrationRevision: 11 };
    const owner = { applicationId: "customer-alpha", environment: "production" };
    const staticLifecycleAdmission = async (currentOwner, generationId, activeGeneration) => {
      let lifecycle = (await pool.query(
        "select revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'",
        [currentOwner.applicationId, currentOwner.environment]
      )).rows[0];
      if (!lifecycle) {
        await pool.query(
          `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
           values ($1,$2,'platform-plugin','module.sales',0,'active',$3,$4::jsonb)`,
          [currentOwner.applicationId, currentOwner.environment, activeGeneration.generationId, JSON.stringify(activeGeneration)]
        );
        lifecycle = { revision: 0 };
      }
      const operationId = `operation-${createHash("sha256").update(`${currentOwner.applicationId}:${generationId}:${lifecycle.revision}`).digest("hex").slice(0, 32)}`;
      await pool.query(
        `insert into runtime_extension_operations (
           operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
           request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json
         ) values ($1,$2,$3,'platform-plugin','module.sales','update',$4,$5,'{}'::jsonb,'{}'::jsonb,$6,'source-change-ready','worker:static-proof','lease-static-proof',$7,$8::jsonb)
         on conflict (operation_id) do update set expected_revision=excluded.expected_revision, phase=excluded.phase, plan_json=excluded.plan_json`,
        [operationId, currentOwner.applicationId, currentOwner.environment, `promote:${generationId}`, sha256(operationId), lifecycle.revision, leaseExpiresAt,
          JSON.stringify({
            executionClass: "static-release", operationId, generationId, quarantineRecovery: false,
            plan: { ...installPlan, operationId, expectedRevision: lifecycle.revision, targetGenerationId: generationId },
            sourceChange: change,
            deployment: { buildRequestDigest: deploymentRequest.buildRequestDigest, sourceCommit: greenBuild.change.targetSourceCommit }
          })]
      );
      await pool.query(
        "update runtime_extensions set last_operation_id=$1 where application_id=$2 and environment=$3 and delivery_class='platform-plugin' and extension_id='module.sales'",
        [operationId, currentOwner.applicationId, currentOwner.environment]
      );
      return { operationId, expectedRevision: lifecycle.revision, extensionId: "module.sales", quarantineRecovery: false };
    };
    await seedAuthorizationGeneration(
      pool,
      salesAuthorizationProjector,
      activeStaticPlatformPluginLifecycleEvent(owner.applicationId, owner.environment, "module.sales", baseCommit, blue.generationId),
      [blue.generationId]
    );
    const authorizationStore = new PostgresAuthorizationStore(pool, {
      validate: (id, subject) => id === owner.applicationId && subject.kind === "user" && subject.id === "p10-static-sales-user" ? "accepted" : "rejected"
    });
    let authorizationState = await authorizationStore.readState(owner.applicationId, owner.environment);
    authorizationState = (await authorizationStore.transaction({ applicationId: owner.applicationId, environment: owner.environment, authorizationRevision: authorizationState.authorizationRevision, lifecycleRevision: authorizationState.lifecycleRevision }, async (view) => {
      await view.write({ kind: "role", role: { schemaVersion: 1, applicationId: owner.applicationId, id: "p10-static-sales-role", label: "Static Sales", revision: authorizationState.authorizationRevision } });
      await view.write({ kind: "grant", grant: { schemaVersion: 1, applicationId: owner.applicationId, id: "p10-static-sales-write", roleId: "p10-static-sales-role", permissionId: "sales.tasks.write", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, revision: authorizationState.authorizationRevision } });
      await view.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId: owner.applicationId, id: "p10-static-sales-user", roleId: "p10-static-sales-role", principal: { kind: "user", id: "p10-static-sales-user" }, state: "active", revision: authorizationState.authorizationRevision } });
    })).state;
    const leaseExpiresAt = new Date(now.valueOf() + 299_000).toISOString();
    const rollbackValidationOwner = { applicationId: "customer-delta", environment: "production" };
    const rollbackValidationPlan = structuredClone(plan);
    rollbackValidationPlan.applicationId = rollbackValidationOwner.applicationId;
    rollbackValidationPlan.environment = rollbackValidationOwner.environment;
    rollbackValidationPlan.migration.applicationId = rollbackValidationOwner.applicationId;
    rollbackValidationPlan.migration.environment = rollbackValidationOwner.environment;
    const rollbackValidationEvidence = structuredClone(build.evidence);
    rollbackValidationEvidence.applicationId = rollbackValidationOwner.applicationId;
    rollbackValidationEvidence.environment = rollbackValidationOwner.environment;
    const rollbackValidationBuilds = new Map();
    const rollbackValidationStore = new PostgresStaticDeploymentStore(pool, { now: () => now }, {
      read(token) {
        const verified = rollbackValidationBuilds.get(token);
        assert.ok(verified, "Rollback-window validation must use a verified static build token.");
        return verified;
      }
    });
    const rollbackValidationGeneration = {
      generationId: "customer-delta-blue-11", sourceCommit: rollbackValidationPlan.base.sourceCommit,
      compositionChangePlanDigest: digestJson(rollbackValidationPlan.base), buildEvidenceDigest: digestJson({ applicationId: rollbackValidationOwner.applicationId, sourceCommit: rollbackValidationPlan.base.sourceCommit }),
      applicationDigest: rollbackValidationPlan.migration.rollbackWindow.previousApplicationDigest, imageDigest: blueBuild.imageDigest,
      imageReference: blueBuild.imageReference, migrationRevision: rollbackValidationPlan.migration.baseRevision
    };
    const rollbackValidationReadiness = {
      generationId: "customer-delta-green-12", sourceCommit: rollbackValidationPlan.target.sourceCommit,
      applicationDigest: rollbackValidationEvidence.applicationSubject.digest, imageDigest: rollbackValidationEvidence.imageSubject.digest,
      migrationRevision: rollbackValidationPlan.migration.targetRevision,
      completedMigrationSteps: rollbackValidationPlan.migration.steps.filter((step) => step.phase === "online-expand" || step.phase === "online-backfill").map((step) => step.stepId),
      publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: now.toISOString()
    };
    const rollbackValidationSnapshot = async () => Object.freeze({
      deployment: (await pool.query("select revision, active_generation_id, rollback_generation_id, rollback_window from runtime_static_deployments where application_id=$1 and environment=$2", [rollbackValidationOwner.applicationId, rollbackValidationOwner.environment])).rows,
      fence: (await pool.query("select active_execution_generation, fencing_token, promotion_revision from runtime_worker_generation_fences where application_id=$1 and environment=$2", [rollbackValidationOwner.applicationId, rollbackValidationOwner.environment])).rows,
      outbox: (await pool.query("select event_id, revision, event_json from runtime_static_deployment_outbox where application_id=$1 and environment=$2 order by revision", [rollbackValidationOwner.applicationId, rollbackValidationOwner.environment])).rows
    });
    const rollbackValidationToken = (rollbackWindow) => {
      const validationPlan = structuredClone(rollbackValidationPlan);
      validationPlan.migration.rollbackWindow = rollbackWindow;
      const token = {};
      rollbackValidationBuilds.set(token, {
        change: { status: "source-change-ready", planDigest: digestJson(validationPlan), targetSourceCommit: validationPlan.target.sourceCommit, change: validationPlan },
        evidence: rollbackValidationEvidence,
        evidenceDigest: digestJson(rollbackValidationEvidence)
      });
      return token;
    };
    await rollbackValidationStore.initialize({ ...rollbackValidationOwner, generation: rollbackValidationGeneration, workerOwner: "worker:p9-rollback-validation", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt });
    for (const rollbackWindow of [
      { ...rollbackValidationPlan.migration.rollbackWindow, previousApplicationDigest: greenBuild.applicationDigest },
      { ...rollbackValidationPlan.migration.rollbackWindow, closesAt: new Date(now.valueOf() - 1).toISOString() }
    ]) {
      const beforeRollbackRejection = await rollbackValidationSnapshot();
      await assert.rejects(
        rollbackValidationStore.promote({ ...rollbackValidationOwner, expectedRevision: 0, expectedFenceToken: 1, generationId: rollbackValidationReadiness.generationId, workerOwner: "worker:p9-rollback-validation", workerLeaseExpiresAt: leaseExpiresAt, build: rollbackValidationToken(rollbackWindow), readiness: rollbackValidationReadiness, lifecycleAdmission: await staticLifecycleAdmission(rollbackValidationOwner, rollbackValidationReadiness.generationId, rollbackValidationGeneration) }),
        { code: "READINESS_REJECTED" }
      );
      assert.deepEqual(await rollbackValidationSnapshot(), beforeRollbackRejection, "Rejected rollback-window evidence must not move the pointer, revision, worker fence, or outbox.");
    }
    const rollbackValidationReceipt = await rollbackValidationStore.promote({
      ...rollbackValidationOwner, expectedRevision: 0, expectedFenceToken: 1, generationId: rollbackValidationReadiness.generationId,
      workerOwner: "worker:p9-rollback-validation", workerLeaseExpiresAt: leaseExpiresAt,
      build: rollbackValidationToken(rollbackValidationPlan.migration.rollbackWindow), readiness: rollbackValidationReadiness,
      lifecycleAdmission: await staticLifecycleAdmission(rollbackValidationOwner, rollbackValidationReadiness.generationId, rollbackValidationGeneration)
    });
    assert.equal(rollbackValidationReceipt.revisionAfter, 1, "A rollback window bound to the active application and future store clock must promote.");
    const concurrentBuilds = new Map();
    const concurrentStore = new PostgresStaticDeploymentStore(pool, { now: () => now }, {
      read(token) {
        const verified = concurrentBuilds.get(token);
        assert.ok(verified, "Concurrent promotion must use a verified static build token.");
        return verified;
      }
    });
    const concurrentPromotions = ["customer-bravo", "customer-charlie"].map((applicationId) => {
      const concurrentOwner = { applicationId, environment: "production" };
      const concurrentChange = structuredClone(plan);
      concurrentChange.applicationId = applicationId;
      concurrentChange.environment = concurrentOwner.environment;
      concurrentChange.migration.applicationId = applicationId;
      concurrentChange.migration.environment = concurrentOwner.environment;
      const concurrentEvidence = structuredClone(build.evidence);
      concurrentEvidence.applicationId = applicationId;
      concurrentEvidence.environment = concurrentOwner.environment;
      const token = {};
      concurrentBuilds.set(token, {
        change: { status: "source-change-ready", planDigest: digestJson(concurrentChange), targetSourceCommit: concurrentChange.target.sourceCommit, change: concurrentChange },
        evidence: concurrentEvidence,
        evidenceDigest: digestJson(concurrentEvidence)
      });
      const baseGeneration = {
        generationId: `${applicationId}-blue-11`, sourceCommit: concurrentChange.base.sourceCommit,
        compositionChangePlanDigest: digestJson(concurrentChange.base), buildEvidenceDigest: digestJson({ applicationId, sourceCommit: concurrentChange.base.sourceCommit }),
        applicationDigest: concurrentChange.migration.rollbackWindow.previousApplicationDigest, imageDigest: `sha256:${"0".repeat(64)}`,
        imageReference: `ghcr.io/k-nex/${applicationId}@sha256:${"0".repeat(64)}`, migrationRevision: concurrentChange.migration.baseRevision
      };
      const generationId = `${applicationId}-green-12`;
      const readiness = {
        generationId, sourceCommit: concurrentChange.target.sourceCommit, applicationDigest: concurrentEvidence.applicationSubject.digest,
        imageDigest: concurrentEvidence.imageSubject.digest, migrationRevision: concurrentChange.migration.targetRevision,
        completedMigrationSteps: concurrentChange.migration.steps.filter((step) => step.phase === "online-expand" || step.phase === "online-backfill").map((step) => step.stepId),
        publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: now.toISOString()
      };
      return {
        concurrentOwner,
        initialize: () => concurrentStore.initialize({ ...concurrentOwner, generation: baseGeneration, workerOwner: "worker:p9-concurrent", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt }),
        promote: async () => concurrentStore.promote({ ...concurrentOwner, expectedRevision: 0, expectedFenceToken: 1, generationId, workerOwner: "worker:p9-concurrent", workerLeaseExpiresAt: leaseExpiresAt, build: token, readiness, lifecycleAdmission: await staticLifecycleAdmission(concurrentOwner, generationId, baseGeneration) })
      };
    });
    await Promise.all(concurrentPromotions.map(({ initialize }) => initialize()));
    const concurrentReceipts = await Promise.all(concurrentPromotions.map(({ promote }) => promote()));
    const concurrentOutbox = await pool.query(
      "select event_id, application_id, revision, event_json->>'receiptId' receipt_id from runtime_static_deployment_outbox where application_id = any($1::text[]) order by application_id",
      [concurrentPromotions.map(({ concurrentOwner }) => concurrentOwner.applicationId)]
    );
    assert.equal(new Set(concurrentReceipts.map(({ receiptId }) => receiptId)).size, 2, "Different deployment owners at revision zero must receive globally distinct receipt IDs.");
    assert.deepEqual(concurrentOutbox.rows.map(({ event_id, receipt_id, revision }) => ({ event_id, receipt_id, revision: Number(revision) })), concurrentReceipts
      .sort((left, right) => left.applicationId.localeCompare(right.applicationId))
      .map(({ receiptId, revisionAfter }) => ({ event_id: receiptId, receipt_id: receiptId, revision: revisionAfter })));
    for (const { receiptId } of concurrentReceipts) {
      assert.match(receiptId, /^[a-z][a-z0-9-]{2,127}$/u);
      assert.ok(receiptId.length <= 128);
    }
    await assert.rejects(supervisorCommand(supervisorUrl, { commandId: "migration-label-reject-12", operation: "validate-online-migration", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0, migration: relabeledMigration }), { code: "MIGRATION_LABEL_REJECTED" });
    await supervisorCommand(supervisorUrl, { commandId: "bootstrap-blue-11", operation: "bootstrap", ...owner, generationId: blue.generationId, buildRequestDigest: greenBuild.buildRequestDigest, compositionChangePlanDigest: blue.compositionChangePlanDigest, buildEvidenceDigest: blue.buildEvidenceDigest, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt });
    const alphaRoute = (await pool.query(
      "select url from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
      [owner.applicationId, owner.environment, blue.generationId]
    )).rows[0].url;
    await pool.query(
      "insert into p9_static_process_routes (application_id, environment, generation_id, url) values ($1,$2,$3,$4)",
      ["customer-bravo", owner.environment, blue.generationId, "http://127.0.0.1:9"]
    );
    assert.deepEqual(
      (await pool.query(
        "select application_id, url from p9_static_process_routes where environment=$1 and generation_id=$2 order by application_id",
        [owner.environment, blue.generationId]
      )).rows,
      [{ application_id: owner.applicationId, url: alphaRoute }, { application_id: "customer-bravo", url: "http://127.0.0.1:9" }],
      "Different owners may use the same generation ID without overwriting either route."
    );
    assert.equal(
      (await fetch(`${processGatewayUrl}/public`).then((response) => response.json())).generation,
      blue.generationId,
      "The stable gateway must resolve the route through the deployment owner, not generation ID alone."
    );
    await pool.query(
      "delete from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
      ["customer-bravo", owner.environment, blue.generationId]
    );
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
      assertRoleDenied("web-admin", "select * from runtime_static_release_requests"),
      assertRoleDenied("blue", "delete from sales_tasks"),
      assertRoleDenied("green", "update sales_tasks set title='forged'"),
      assertRoleDenied("blue", "insert into sales_opportunities (name, stage) values ('forged', 'lead')"),
      assertRoleDenied("green", "delete from k_nex_outbox")
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
    const blueFenceBeforeEffect = await liveStore.readFence(owner);
    await liveStore.renewWorkerFence({
      ...owner, generationId: blue.generationId, fencingToken: blueFenceBeforeEffect.fencingToken, owner: blueFenceBeforeEffect.lease.owner,
      expectedPromotionRevision: blueFenceBeforeEffect.promotionRevision, leaseDurationMs: 240_000
    });
    await assert.rejects(liveStore.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimantId: "worker:phase-9-green-a", claimLeaseDurationMs: 239_000 }), { code: "FENCE_REJECTED" });
    const blueEffect = await liveStore.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, claimantId: "worker:phase-9-blue", claimLeaseDurationMs: 239_000 });
    assert.equal((await deliverExternalEffect(pool, blueEffect.externalIdempotencyKey, "sales external effect")).duplicate, false);
    const partialOwnerId = createHash("sha256").update(`${owner.applicationId}:${owner.environment}`).digest("hex").slice(0, 16);
    const promotionCommand = async (commandId, generationId) => ({
      commandId, operation: "promote", ...owner, generationId,
      operationId: (await staticLifecycleAdmission(owner, generationId, blue)).operationId,
      lifecycleExpectedRevision: (await managedStore.observeActiveGeneration(owner.applicationId, owner.environment, managedRequest.extension)).revision,
      deliveryClass: "platform-plugin", extensionId: "module.sales",
      buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0,
      workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt
    });
    const staticBeforeMissingAdmission = await store.read(owner);
    const staticOutboxBeforeMissingAdmission = Number((await pool.query("select count(*) count from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].count);
    await assert.rejects(supervisorCommand(supervisorUrl, {
      commandId: "missing-lifecycle-admission-green-12", operation: "promote", ...owner,
      generationId: "customer-alpha-green-missing-admission-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0,
      workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt
    }), { code: "REVISION_CONFLICT" });
    assert.deepEqual(await store.read(owner), staticBeforeMissingAdmission, "Missing lifecycle admission mutated the static pointer or fence.");
    assert.equal(Number((await pool.query("select count(*) count from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].count), staticOutboxBeforeMissingAdmission);
    assert.equal((await pool.query("select count(*)::int count from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3", [owner.applicationId, owner.environment, "customer-alpha-green-missing-admission-12"])).rows[0].count, 0);
    const boundAdmission = await staticLifecycleAdmission(owner, "customer-alpha-green-authorized-12", blue);
    const migrationBeforeWrongOperation = (await pool.query("select revision, last_step_id from p9_static_migration_authority order by authority_id")).rows;
    for (const command of [
      {
        commandId: "wrong-target-lifecycle-admission-green-12", operation: "promote", ...owner,
        operationId: boundAdmission.operationId, lifecycleExpectedRevision: boundAdmission.expectedRevision, deliveryClass: "platform-plugin", extensionId: "module.sales",
        generationId: "customer-alpha-green-wrong-target-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0,
        workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt
      },
      {
        commandId: "wrong-owner-lifecycle-admission-green-12", operation: "promote", applicationId: "customer-other", environment: owner.environment,
        operationId: boundAdmission.operationId, lifecycleExpectedRevision: boundAdmission.expectedRevision, deliveryClass: "platform-plugin", extensionId: "module.sales",
        generationId: "customer-alpha-green-authorized-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0,
        workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt
      }
    ]) await assert.rejects(supervisorCommand(supervisorUrl, command), { code: "REVISION_CONFLICT" });
    assert.deepEqual((await pool.query("select revision, last_step_id from p9_static_migration_authority order by authority_id")).rows, migrationBeforeWrongOperation, "Wrong operation admission reached migration work.");
    assert.equal((await pool.query("select count(*)::int count from p9_static_process_events where generation_id=any($1::text[])", [["customer-alpha-green-wrong-target-12", "customer-alpha-green-authorized-12"]])).rows[0].count, 0, "Wrong operation admission started a generation.");
    assert.deepEqual(await store.read(owner), staticBeforeMissingAdmission);
    assert.equal(Number((await pool.query("select count(*) count from runtime_static_deployment_outbox where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].count), staticOutboxBeforeMissingAdmission);
    const assertRejectedGenerationRetired = async (generationId) => {
      const container = `knex-p9-${network}-${partialOwnerId}-${generationId}`;
      for (const name of [container, `${container}-worker`]) {
        await assertDockerContainerAbsent(name, `${name} survived rejected-generation retirement.`);
      }
      assert.equal((await pool.query(
        "select count(*)::int count from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
        [owner.applicationId, owner.environment, generationId]
      )).rows[0].count, 0, "Rejected partial generation retained a route.");
      assert.deepEqual((await pool.query(
        "select state, completed_at is not null completed from runtime_static_generation_retirements where application_id=$1 and environment=$2 and generation_id=$3",
        [owner.applicationId, owner.environment, generationId]
      )).rows, [{ state: "completed", completed: true }], "Retirement may complete only after both named processes and the route are absent.");
    };
    const partialGenerationId = "customer-alpha-green-partial-12";
    const partialCommand = await promotionCommand("partial-worker-green-12", partialGenerationId);
    await supervisorCommand(supervisorUrl, { commandId: "arm-partial-worker-green-12", operation: "arm-worker-start-failure" });
    await assert.rejects(supervisorCommand(supervisorUrl, partialCommand), /simulated worker start failure after web start/u);
    assert.deepEqual((await pool.query("select detail from p9_static_process_events where event='worker-start-failure-before-route' and generation_id=$1", [partialGenerationId])).rows, [{ detail: { webName: `knex-p9-${network}-${partialOwnerId}-${partialGenerationId}`, workerName: `knex-p9-${network}-${partialOwnerId}-${partialGenerationId}-worker`, routePublished: false } }]);
    await assertRejectedGenerationRetired(partialGenerationId);
    await supervisorProcess.stop();
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", {
      P9_PROCESS_INSTANCE: "supervisor-2", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1"
    }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    await waitForProcessEvent(pool, "supervisor", "supervisor-recovered", 2);
    await assert.rejects(supervisorCommand(supervisorUrl, partialCommand), { code: "STATE_UNAVAILABLE" });
    await assertRejectedGenerationRetired(partialGenerationId);

    const workerOnlyGenerationId = "customer-alpha-green-worker-only-12";
    const workerOnlyCommand = await promotionCommand("worker-only-survivor-green-12", workerOnlyGenerationId);
    await supervisorCommand(supervisorUrl, { commandId: "arm-worker-only-survivor-green-12", operation: "arm-worker-only-survivor" });
    await assert.rejects(supervisorCommand(supervisorUrl, workerOnlyCommand), /simulated web startup failure after passive worker startup/u);
    assert.deepEqual((await pool.query("select detail from p9_static_process_events where event='worker-only-survivor-before-route' and generation_id=$1", [workerOnlyGenerationId])).rows, [{ detail: { webName: `knex-p9-${network}-${partialOwnerId}-${workerOnlyGenerationId}`, workerName: `knex-p9-${network}-${partialOwnerId}-${workerOnlyGenerationId}-worker`, routePublished: false } }]);
    await assertRejectedGenerationRetired(workerOnlyGenerationId);
    await supervisorProcess.stop();
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", {
      P9_PROCESS_INSTANCE: "supervisor-3", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1"
    }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    await waitForProcessEvent(pool, "supervisor", "supervisor-recovered", 3);
    await assert.rejects(supervisorCommand(supervisorUrl, workerOnlyCommand), { code: "STATE_UNAVAILABLE" });
    await assertRejectedGenerationRetired(workerOnlyGenerationId);

    await supervisorCommand(supervisorUrl, { commandId: "arm-failed-green-12", operation: "arm-health-failure" });
    await assert.rejects(supervisorCommand(supervisorUrl, await promotionCommand("failed-green-12", "customer-alpha-green-health-12")), /failed health checks/);
    await assertRejectedGenerationRetired("customer-alpha-green-health-12");
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);

    const reservationCrashGenerationId = "customer-alpha-green-reserved-crash-12";
    const reservationCrashCommand = await promotionCommand("reserved-retirement-crash-green-12", reservationCrashGenerationId);
    await supervisorCommand(supervisorUrl, { commandId: "arm-reserved-retirement-readiness-failure", operation: "arm-readiness-failure" });
    await supervisorCommand(supervisorUrl, { commandId: "arm-reserved-retirement-crash", operation: "arm-retirement-reservation-crash" });
    await assert.rejects(supervisorCommand(supervisorUrl, reservationCrashCommand), /fetch failed|other side closed|socket/u);
    if (supervisorProcess.child.exitCode === null && supervisorProcess.child.signalCode === null) await new Promise((resolve) => supervisorProcess.child.once("exit", resolve));
    const reservedRetirement = (await pool.query(
      "select reservation_id, reserved_at, state from runtime_static_generation_retirements where application_id=$1 and environment=$2 and generation_id=$3",
      [owner.applicationId, owner.environment, reservationCrashGenerationId]
    )).rows[0];
    assert.ok(reservedRetirement?.reservation_id && reservedRetirement?.reserved_at, "The rejected target must receive a durable retirement reservation before host deletion.");
    assert.equal(reservedRetirement.state, "reserved");
    assert.equal((await pool.query("select status from p9_static_deployment_commands where command_id=$1", [reservationCrashCommand.commandId])).rows[0].status, "running");
    const reservationCrashContainer = `knex-p9-${network}-${partialOwnerId}-${reservationCrashGenerationId}`;
    for (const name of [reservationCrashContainer, `${reservationCrashContainer}-worker`]) {
      assert.equal(await dockerContainerPresent(name), true, `${name} must survive the crash before retirement deletion.`);
    }
    assert.equal((await pool.query("select count(*)::int count from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3", [owner.applicationId, owner.environment, reservationCrashGenerationId])).rows[0].count, 1);
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    await trafficProbe.waitForGeneration("install", blue.generationId);
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-4", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1" }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    await waitForProcessEvent(pool, "supervisor", "supervisor-recovered", 4);
    await assertRejectedGenerationRetired(reservationCrashGenerationId);
    const completedRetirement = (await pool.query(
      "select reservation_id, reserved_at, state, completed_at is not null completed from runtime_static_generation_retirements where application_id=$1 and environment=$2 and generation_id=$3",
      [owner.applicationId, owner.environment, reservationCrashGenerationId]
    )).rows[0];
    assert.deepEqual(completedRetirement, { ...reservedRetirement, state: "completed", completed: true }, "Recovery must complete the original reservation rather than minting a replacement.");
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    await assert.rejects(supervisorCommand(supervisorUrl, reservationCrashCommand), { code: "STATE_UNAVAILABLE" });
    await assertRejectedGenerationRetired(reservationCrashGenerationId);

    await pool.query("create function p9_fail_fence_transfer() returns trigger language plpgsql as $$ begin if new.fencing_token=2 then raise exception 'simulated fence transfer crash'; end if; return new; end $$");
    await pool.query("create trigger p9_fail_fence_transfer before update on runtime_worker_generation_fences for each row execute function p9_fail_fence_transfer()");
    await assert.rejects(supervisorCommand(supervisorUrl, await promotionCommand("fence-crash-green-12", "customer-alpha-green-fence-12")), /simulated fence transfer crash/);
    assert.equal((await store.read(owner)).active.generationId, blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    await supervisorCommand(supervisorUrl, { commandId: "restart-green-after-fence-crash", operation: "restart", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 0, sourceCommit: targetCommit, applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest, migrationRevision: 12, completedMigrationSteps: ["migration-expand-12", "migration-backfill-12"] });
    crashEvidence.add("warming:web-green");
    await pool.query("drop trigger p9_fail_fence_transfer on runtime_worker_generation_fences");
    await pool.query("drop function p9_fail_fence_transfer()");
    await pool.query(
      "update runtime_extensions set last_operation_id=$1 where application_id=$2 and environment=$3 and delivery_class='platform-plugin' and extension_id='module.sales'",
      [managedPlan.operationId, owner.applicationId, owner.environment]
    );

    const packagedBlueWorkerName = `knex-p9-${network}-${partialOwnerId}-${blue.generationId}-worker`;
    const packagedBlueWorkerPort = (await docker(["port", packagedBlueWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(packagedBlueWorkerPort, "Packaged Blue worker control port is unavailable.");
    const packagedBlueWorkerControlToken = sha256(`${network}:${owner.applicationId}:${owner.environment}:${blue.generationId}:release-worker-control`);
    const packagedWorkerEffect = observeDeferred(fetch(`http://127.0.0.1:${packagedBlueWorkerPort}/execute`, {
      method: "POST", headers: { "content-type": "application/json", "x-p9-worker-control": packagedBlueWorkerControlToken },
      body: JSON.stringify({ effectId: "packaged-worker-effect", payload: "packaged worker external effect", delayMs: 15_000 })
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Packaged Blue worker effect failed.");
      return { result };
    }));
    await waitForProcessEvent(pool, "release-worker", "worker-effect-started", 1);
    const packagedEffectClaim = (await pool.query(
      "select detail from p9_static_process_events where role='release-worker' and event='worker-effect-started' and generation_id=$1 order by id desc limit 1",
      [blue.generationId]
    )).rows[0]?.detail;
    assert.equal(packagedEffectClaim?.claimLeaseDurationMs, 19_000, "The bounded 15-second effect must hold a DB-clock claim long enough to prevent concurrent replay before dispatch.");
    assert.equal(packagedEffectClaim?.fixtureClockSkewMs, 60_000, "A packaged worker with a sixty-second local clock skew must still claim the effect after its database-authorized renewal.");
    const inFlightBlue = observeDeferred(fetch(`${processGatewayUrl}/slow`).then((response) => response.json()));
    await delay(30);
    await supervisorCommand(supervisorUrl, { commandId: "arm-transition-worker-loss-green-12", operation: "arm-transition-worker-loss" });
    await supervisorCommand(supervisorUrl, { commandId: "arm-post-commit-gateway-crash", operation: "arm-gateway-failure" });
    await supervisorCommand(supervisorUrl, { commandId: "arm-post-commit-response-crash", operation: "arm-response-crash" });
    trafficProbe.transition("update", [blue.generationId, "customer-alpha-green-12"]);
    await trafficProbe.waitForGeneration("update", blue.generationId);
    await assert.rejects(operatorApi.activate(managedPlan.operationId), /fetch failed|other side closed|socket/u);
    assert.equal((await store.read(owner)).active.generationId, "customer-alpha-green-12");
    assert.deepEqual((await store.read(owner)).transitionCheckpoint.completedSteps, [], "No target worker or traffic transition may run before runtime and authorization reconciliation.");
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, blue.generationId, "Committed static state must keep serving Blue until lifecycle reconciliation commits.");
    await assert.rejects(operatorApi.activate(managedPlan.operationId), /fetch failed|other side closed|socket/u);
    if (supervisorProcess.child.exitCode === null && supervisorProcess.child.signalCode === null) await new Promise((resolve) => supervisorProcess.child.once("exit", resolve));
    assert.equal((await pool.query("select status from p9_static_deployment_commands where command_id=$1", [`promote-${managedPlan.operationId}`])).rows[0].status, "running", "SIGKILL after commit must leave an in-flight durable command for recovery.");
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-5", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1" }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, blue.generationId, "Supervisor recovery must not advance target traffic before lifecycle reconciliation.");
    await supervisorCommand(supervisorUrl, { commandId: "arm-finalization-transition-worker-loss", operation: "arm-transition-worker-loss" });
    await supervisorCommand(supervisorUrl, { commandId: "arm-finalization-gateway-crash", operation: "arm-gateway-failure" });
    const salesRowsBeforeAuthenticationDenial = Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count);
    for (const [label, headers] of [
      ["anonymous", { "content-type": "application/json" }],
      ["wrong-user", { "content-type": "application/json", authorization: "Bearer trusted-smoke-token:p10-static-sales-other" }]
    ]) {
      const response = await fetch(`${alphaRoute}/sales-operation`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: `Denied ${label} Sales mutation`, status: "open", potentialRevenue: "1" })
      });
      assert.equal(response.status, 403, `${label} request borrowed the seeded Sales principal.`);
      assert.deepEqual(await response.json(), { authorized: false });
    }
    assert.equal(Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count), salesRowsBeforeAuthenticationDenial, "Authentication denial must precede Sales mutation.");
    const lifecycleRaceLock = await pool.connect();
    const waitingAdvisoryLocks = async () => Number((await pool.query("select count(*)::int count from pg_locks where locktype='advisory' and not granted")).rows[0].count);
    const waitingBeforeRace = await waitingAdvisoryLocks();
    let managedActivation;
    let pausedBlueMutation;
    let lifecycleRaceReleased = false;
    try {
      await lifecycleRaceLock.query("begin");
      await lifecycleRaceLock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([owner.applicationId, owner.environment, "platform-plugin", "module.sales"])]);
      managedActivation = observeDeferred(operatorApi.activate(managedPlan.operationId));
      for (let attempt = 0; attempt < 100 && await waitingAdvisoryLocks() < waitingBeforeRace + 1; attempt += 1) await delay(10);
      assert.equal(await waitingAdvisoryLocks() >= waitingBeforeRace + 1, true, "Green lifecycle reconciliation did not pause behind the extension lock.");
      pausedBlueMutation = observeDeferred(fetch(`${alphaRoute}/sales-operation`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer trusted-smoke-token:p10-static-sales-user", "x-idempotency-key": "p10-paused-blue-operation" },
        body: JSON.stringify({ title: "Paused Blue must not execute", status: "open", potentialRevenue: "1" })
      }).then((response) => ({ response }), (error) => ({ error })));
      for (let attempt = 0; attempt < 100 && await waitingAdvisoryLocks() < waitingBeforeRace + 2; attempt += 1) await delay(10);
      assert.equal(await waitingAdvisoryLocks() >= waitingBeforeRace + 2, true, "Blue Sales mutation did not pause behind Green reconciliation.");
      await lifecycleRaceLock.query("commit");
      lifecycleRaceLock.release();
      lifecycleRaceReleased = true;
    } finally {
      if (!lifecycleRaceReleased) {
        await lifecycleRaceLock.query("rollback").catch(() => undefined);
        lifecycleRaceLock.release();
      }
    }
    const [managedFailure, pausedBlueOutcome] = await Promise.all([managedActivation.then(() => assert.fail("Armed gateway failure was not observed."), (error) => error), pausedBlueMutation]);
    assert.match(managedFailure.message, /simulated post-commit gateway crash/);
    if (pausedBlueOutcome.response) assert.equal(pausedBlueOutcome.response.status, 403, "Blue authorized before promotion must recheck its immutable generation under the lifecycle lock.");
    else assert.match(pausedBlueOutcome.error?.message ?? "", /fetch failed|other side closed|socket/u, "A drained Blue request must fail closed.");
    assert.equal((await pool.query("select count(*)::int count from sales_tasks where title='Paused Blue must not execute'")).rows[0].count, 0, "Paused Blue reached the Sales handler after Green promotion.");
    assert.deepEqual((await store.read(owner)).transitionCheckpoint.completedSteps, ["activate-worker"]);
    assert.equal((await pool.query("select count(*)::int count from p9_static_process_events where event='transition-worker-lost-before-activation' and generation_id=$1", ["customer-alpha-green-12"])).rows[0].count, 1, "The transition ticket must rebuild an exact passive worker lost after fence transfer and before activation.");
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
    const releaseRoutes = await pool.query(
      "select generation_id, url from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id = any($3::text[]) order by generation_id",
      [owner.applicationId, owner.environment, [blue.generationId, "customer-alpha-green-12"]]
    );
    assert.equal(releaseRoutes.rows.length, 2, "Promotion must retain direct Blue and Green release processes until drain.");
    const releaseRoute = Object.fromEntries(releaseRoutes.rows.map(({ generation_id, url }) => [generation_id, url]));
    assert.deepEqual(
      (await pool.query(
        `select disposition, active_generation_id, active_generation->>'sourceCommit' source_commit,
                active_generation->>'applicationDigest' application_digest
         from runtime_extensions
         where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'`,
        [owner.applicationId, owner.environment]
      )).rows,
      [{ disposition: "active", active_generation_id: "customer-alpha-green-12", source_commit: targetCommit, application_digest: greenBuild.applicationDigest }],
      "Controller completion must bind Sales runtime identity to the promoted image before Green traffic authorization."
    );
    const authorizationAfterPromotion = await pool.query(
      `select g.authorization_generation, g.state, g.runtime_generation_ids, g.lifecycle_revision,
              s.lifecycle_revision state_lifecycle_revision
       from k_nex_extension_authorization_generations g
       join k_nex_authorization_state s using (application_id)
       where g.application_id=$1 and g.delivery_class='platform-plugin' and g.extension_id='module.sales'
       order by g.authorization_generation`,
      [owner.applicationId]
    );
    assert.deepEqual(
      authorizationAfterPromotion.rows,
      [{ authorization_generation: "1", state: "current", runtime_generation_ids: ["customer-alpha-green-12"], lifecycle_revision: authorizationAfterPromotion.rows[0]?.state_lifecycle_revision, state_lifecycle_revision: authorizationAfterPromotion.rows[0]?.state_lifecycle_revision }],
      "Compatible static promotion must preserve Sales authorization generation 1 while rebinding its exact runtime image."
    );
    const greenProcessIdentity = await fetch(`${releaseRoute["customer-alpha-green-12"]}/process-identity`).then((response) => response.json());
    assert.equal(greenProcessIdentity.generation, "customer-alpha-green-12", "Green route must address the promoted immutable generation.");
    assert.equal(greenProcessIdentity.payloadNextRuntime, true, "Green route must address the real customer Payload/Next process.");
    const releaseSalesRequest = () => ({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer trusted-smoke-token:p10-static-sales-user", "x-idempotency-key": "p10-current-authority-release-operation" },
      body: JSON.stringify({ title: "Current authority release proof", status: "open", potentialRevenue: "1" })
    });
    const [greenAuthorization, blueAuthorization] = await Promise.all([
      fetch(`${releaseRoute["customer-alpha-green-12"]}/sales-operation`, releaseSalesRequest()),
      fetch(`${releaseRoute[blue.generationId]}/sales-operation`, releaseSalesRequest())
    ]);
    const greenAuthorizationBody = await greenAuthorization.json();
    assert.equal(greenAuthorization.status, 200, `The actual promoted Green release process must pass current RBAC before its Sales action: ${JSON.stringify(greenAuthorizationBody)}`);
    assert.equal(greenAuthorizationBody.authorized, true);
    assert.equal(blueAuthorization.status, 403, "The still-running Blue release process must fail current RBAC after Green promotion.");
    assert.deepEqual(await blueAuthorization.json(), { authorized: false });
    assert.equal((await store.readFence(owner)).activeExecutionGeneration, "customer-alpha-green-12");
    const staleDrainTicket = {
      ...owner, generationId: "customer-alpha-green-12", activeGenerationId: blue.generationId,
      revision: 0, fencingToken: 1, checkpointKind: "promote", step: "drain-previous",
      reservationId: randomUUID(), reservationExpiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    await assert.rejects(
      supervisorCommand(supervisorUrl, { commandId: "stale-drain-active-green-12", operation: "drain-with-ticket", ...owner, generationId: "customer-alpha-green-12", ticket: staleDrainTicket }),
      { code: "REVISION_CONFLICT" },
      "A stale supervisor ticket cannot drain the newly fenced active worker."
    );
    const greenWorkerName = `knex-p9-${network}-${partialOwnerId}-customer-alpha-green-12-worker`;
    const greenWorkerPort = (await docker(["port", greenWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(greenWorkerPort, "The active green worker container must remain addressable after stale drain rejection.");
    assert.deepEqual(await fetch(`http://127.0.0.1:${greenWorkerPort}/status`).then((response) => response.json()), {
      mode: "active", generationId: "customer-alpha-green-12", fencingToken: 2, inFlight: 0,
      sourceCommit: targetCommit, applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest,
      module: "module.sales", pluginVersion: "1.0.0"
    });
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, "customer-alpha-green-12");
    assert.equal((await docker(["inspect", greenWorkerName])).stdout.length > 0, true);
    const preRecoveryFence = await liveStore.readFence(owner);
    assert.equal(preRecoveryFence.fencingToken, 2);
    await docker(["rm", "--force", greenWorkerName]);
    await assertDockerContainerAbsent(greenWorkerName, "Killed settled active worker remained present.");
    await pool.query("update runtime_worker_generation_fences set lease_expires_at=now()+interval '500 milliseconds' where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]);
    await delay(800);
    await supervisorCommand(supervisorUrl, { commandId: "recover-killed-green-worker-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    const recoveredGreenPort = (await docker(["port", greenWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(recoveredGreenPort, "Recovered active worker must publish its control port.");
    const recoveredGreen = await fetch(`http://127.0.0.1:${recoveredGreenPort}/status`).then((response) => response.json());
    assert.equal(recoveredGreen.mode, "active", "Recovery must activate the exact replacement worker only through its durable ticket.");
    assert.equal(recoveredGreen.fencingToken, 3, "Replacement must advance the fence instead of sharing authority with a possible zombie worker.");
    const forcedLeaseExpiry = new Date(Date.now() + 1_000);
    await pool.query("update runtime_worker_generation_fences set lease_expires_at=$3 where application_id=$1 and environment=$2", [owner.applicationId, owner.environment, forcedLeaseExpiry.toISOString()]);
    await delay(2_200);
    const renewals = await pool.query(
      "select detail from p9_static_process_events where role='release-worker' and event='worker-fence-renewed' and generation_id=$1 and fencing_token=3 order by id",
      ["customer-alpha-green-12"]
    );
    assert.ok(renewals.rows.length >= 3, "The replacement active worker must renew before activation and across two bounded heartbeat windows.");
    const recoveredFence = await liveStore.readFence(owner);
    assert.equal(renewals.rows.every((row) => row.detail.leaseOwner === recoveredFence.lease.owner && row.detail.promotionRevision === 1 && typeof row.detail.expiresAt === "string"), true);
    assert.match(recoveredFence.lease.owner, /^static-recovery:/u);
    assert.ok(Date.parse(recoveredFence.lease.expiresAt) > forcedLeaseExpiry.valueOf(), "A live worker heartbeat must extend beyond the deliberately elapsed short lease window.");
    assert.ok(Date.parse(recoveredFence.lease.expiresAt) <= Date.now() + 2_000, "Frequent heartbeat must not bank one-second leases into a longer stale-authority window.");
    const activationRows = await pool.query(
      "select generation_id, deployment_revision, fencing_token, promotion_revision, lease_owner, state, completed_at is not null completed from runtime_static_worker_activations where application_id=$1 and environment=$2 order by reserved_at desc limit 1",
      [owner.applicationId, owner.environment]
    );
    assert.deepEqual(activationRows.rows, [{ generation_id: "customer-alpha-green-12", deployment_revision: 1, fencing_token: "3", promotion_revision: 1, lease_owner: recoveredFence.lease.owner, state: "completed", completed: true }]);
    assert.deepEqual((await pool.query(
      "select previous_fencing_token, fencing_token, lease_owner, event_json->>'recoveryId' recovery_id from runtime_static_worker_recovery_outbox where application_id=$1 and environment=$2 and fencing_token=3",
      [owner.applicationId, owner.environment]
    )).rows, [{ previous_fencing_token: "2", fencing_token: "3", lease_owner: recoveredFence.lease.owner, recovery_id: recoveredFence.lease.owner.slice("static-recovery:".length) }]);
    await assert.rejects(liveStore.claimEffect({ ...owner, effectId: "zombie-green-effect", generationId: "customer-alpha-green-12", fencingToken: 2, claimantId: "worker:zombie-green", claimLeaseDurationMs: 500 }), { code: "FENCE_REJECTED" });
    const recoveredEffect = await supervisorCommand(supervisorUrl, {
      commandId: "recovered-green-worker-effect", operation: "worker-effect", ...owner, generationId: "customer-alpha-green-12", expectedRevision: 1,
      effectId: "recovered-green-effect", payload: "recovered worker effect", delayMs: 0
    });
    assert.equal(recoveredEffect.result.status, "completed", "The recovered, renewed worker must retain effect authority.");
    const recoveryCountBeforeNoop = (await pool.query("select count(*)::int count from runtime_static_worker_activations where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].count;
    await supervisorCommand(supervisorUrl, { commandId: "recover-healthy-green-worker-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    assert.equal((await liveStore.readFence(owner)).fencingToken, 3, "A healthy exact worker must not churn its fence token.");
    assert.equal((await pool.query("select count(*)::int count from runtime_static_worker_activations where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].count, recoveryCountBeforeNoop);

    const greenHeartbeatRejectionsBefore = (await pool.query(
      "select count(*)::int count from p9_static_process_events where role='release-worker' and event='worker-heartbeat-rejected' and generation_id=$1 and fencing_token=3",
      ["customer-alpha-green-12"]
    )).rows[0].count;
    await pool.query("update runtime_worker_generation_fences set lease_expires_at=now()-interval '1 second' where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]);
    let greenHeartbeatRejections = greenHeartbeatRejectionsBefore;
    for (let attempt = 0; attempt < 100 && greenHeartbeatRejections === greenHeartbeatRejectionsBefore; attempt += 1) {
      await delay(100);
      greenHeartbeatRejections = (await pool.query(
        "select count(*)::int count from p9_static_process_events where role='release-worker' and event='worker-heartbeat-rejected' and generation_id=$1 and fencing_token=3",
        ["customer-alpha-green-12"]
      )).rows[0].count;
    }
    assert.equal(greenHeartbeatRejections, greenHeartbeatRejectionsBefore + 1, "The exact Green fence epoch must emit one heartbeat rejection.");
    assert.equal((await fetch(`http://127.0.0.1:${recoveredGreenPort}/status`).then((response) => response.json())).mode, "passive", "Rejected renewal must self-fence the local worker.");
    await assert.rejects(supervisorCommand(supervisorUrl, {
      commandId: "self-fenced-green-worker-effect", operation: "worker-effect", ...owner, generationId: "customer-alpha-green-12", expectedRevision: 1,
      effectId: "self-fenced-green-effect", payload: "must not execute", delayMs: 0
    }), /Only the active fenced release worker/u);
    await supervisorCommand(supervisorUrl, { commandId: "recover-self-fenced-green-worker-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    assert.equal((await liveStore.readFence(owner)).fencingToken, 4);

    await docker(["rm", "--force", greenWorkerName]);
    const greenWorkerControlToken = sha256(`${network}:${owner.applicationId}:${owner.environment}:customer-alpha-green-12:release-worker-control`);
    await docker(["run", "--rm", "--detach", "--name", greenWorkerName, "--network", network, "--label", `p9-fixture=${network}`, "--label", "p9-role=release-worker",
      "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--ipc", "private", "--cgroupns", "private", "--pids-limit", "64", "--memory", "128m", "--memory-swap", "256m", "--cpus", "0.5",
      "--publish", "127.0.0.1::3002", "--env", "K_NEX_GENERATION=customer-alpha-green-12", "--env", `K_NEX_IMAGE_DIGEST=${blueBuild.imageDigest}`, "--env", `K_NEX_WORKER_CONTROL_TOKEN=${greenWorkerControlToken}`,
      "--env", "P9_RELEASE_WORKER_PORT=3002", "--env", "P9_WORKER_HEARTBEAT_MS=250", "--env", "P9_WORKER_LEASE_MS=1000", "--env", "DATABASE_URL=postgresql://p9_static_worker:p9-static-worker-password@p9-postgres:5432/static_deployment",
      blueBuild.imageDigest, "node", "release-worker.mjs"]);
    let tamperedWorkerPort;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      tamperedWorkerPort = (await docker(["port", greenWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
      const status = tamperedWorkerPort && await fetch(`http://127.0.0.1:${tamperedWorkerPort}/status`).then((response) => response.ok ? response.json() : undefined).catch(() => undefined);
      if (status?.mode === "passive") break;
      await delay(100);
    }
    assert.ok(tamperedWorkerPort, "Tampered retained worker fixture did not become observable.");
    assert.equal(JSON.parse((await docker(["inspect", greenWorkerName])).stdout)[0].Image, blueBuild.imageDigest);
    await supervisorCommand(supervisorUrl, { commandId: "recover-tampered-green-worker-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    const exactRecoveredPort = (await docker(["port", greenWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(exactRecoveredPort, "Exact worker recreation must publish a control port.");
    const exactRecovered = await fetch(`http://127.0.0.1:${exactRecoveredPort}/status`).then((response) => response.json());
    assert.deepEqual({ mode: exactRecovered.mode, fencingToken: exactRecovered.fencingToken, sourceCommit: exactRecovered.sourceCommit, applicationDigest: exactRecovered.applicationDigest, imageDigest: exactRecovered.imageDigest }, {
      mode: "active", fencingToken: 5, sourceCommit: targetCommit, applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest
    }, "Recovery must reject a same-name retained worker from the wrong immutable image and recreate exact authority.");
    assert.equal(JSON.parse((await docker(["inspect", greenWorkerName])).stdout)[0].Image, greenBuild.imageDigest);

    await docker(["rm", "--force", greenWorkerName]);
    weakProfileVolumeName = `knex-p9-weak-profile-${randomUUID()}`;
    await docker(["volume", "create", "--label", `p9-fixture=${network}`, weakProfileVolumeName]);
    await docker(["run", "--rm", "--detach", "--name", greenWorkerName, "--network", network, "--label", `p9-fixture=${network}`, "--label", "p9-role=release-worker",
      "--user", "0:0", "--userns", "host", "--cap-add", "SYS_ADMIN", "--pid", "host", "--ipc", "host", "--uts", "host", "--cgroupns", "host", "--device-cgroup-rule", "c 1:3 rwm", "--pids-limit", "128", "--memory", "256m", "--memory-swap", "-1", "--cpus", "1", "--mount", `type=volume,source=${weakProfileVolumeName},target=/weak`,
      "--publish", "127.0.0.1::3002", "--env", "K_NEX_GENERATION=customer-alpha-green-12", "--env", `K_NEX_IMAGE_DIGEST=${greenBuild.imageDigest}`, "--env", `K_NEX_WORKER_CONTROL_TOKEN=${greenWorkerControlToken}`,
      "--env", "P9_RELEASE_WORKER_PORT=3002", "--env", "P9_WORKER_HEARTBEAT_MS=250", "--env", "P9_WORKER_LEASE_MS=1000", "--env", "DATABASE_URL=postgresql://p9_static_worker:p9-static-worker-password@p9-postgres:5432/static_deployment",
      greenBuild.imageDigest, "node", "release-worker.mjs"]);
    let weakProfilePort;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      weakProfilePort = (await docker(["port", greenWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
      const status = weakProfilePort && await fetch(`http://127.0.0.1:${weakProfilePort}/status`).then((response) => response.ok ? response.json() : undefined).catch(() => undefined);
      if (status?.mode === "passive") break;
      await delay(100);
    }
    assert.ok(weakProfilePort, "Weak-profile retained worker fixture did not become observable.");
    const weakInspection = JSON.parse((await docker(["inspect", greenWorkerName])).stdout)[0];
    assert.equal(weakInspection.Config.User, "0:0");
    assert.equal(weakInspection.HostConfig.UsernsMode, "host");
    assert.equal(weakInspection.HostConfig.ReadonlyRootfs, false);
    assert.ok(weakInspection.HostConfig.CapAdd.includes("CAP_SYS_ADMIN"));
    assert.equal(weakInspection.HostConfig.PidMode, "host");
    assert.equal(weakInspection.HostConfig.IpcMode, "host");
    assert.equal(weakInspection.HostConfig.UTSMode, "host");
    assert.equal(weakInspection.HostConfig.CgroupnsMode, "host");
    assert.equal(weakInspection.HostConfig.MemorySwap, -1);
    assert.deepEqual(weakInspection.HostConfig.DeviceCgroupRules, ["c 1:3 rwm"]);
    assert.ok(weakInspection.Mounts.some((mount) => mount.Type === "volume"));
    await supervisorCommand(supervisorUrl, { commandId: "recover-weak-profile-green-worker-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    const profileRecovered = JSON.parse((await docker(["inspect", greenWorkerName])).stdout)[0];
    const profileRecoveredPort = (await docker(["port", greenWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(profileRecoveredPort);
    assert.equal((await fetch(`http://127.0.0.1:${profileRecoveredPort}/status`).then((response) => response.json())).fencingToken, 6);
    assert.equal(profileRecovered.Config.User, "65534:65534");
    assert.notEqual(profileRecovered.HostConfig.UsernsMode, "host");
    assert.equal(profileRecovered.HostConfig.ReadonlyRootfs, true);
    assert.equal(profileRecovered.HostConfig.PidsLimit, 64);
    assert.equal(profileRecovered.HostConfig.Memory, 128 * 1024 * 1024);
    assert.equal(profileRecovered.HostConfig.MemorySwap, 256 * 1024 * 1024);
    assert.equal(profileRecovered.HostConfig.NanoCpus, 500_000_000);
    assert.equal(profileRecovered.HostConfig.PidMode, "");
    assert.equal(profileRecovered.HostConfig.IpcMode, "private");
    assert.equal(profileRecovered.HostConfig.UTSMode, "");
    assert.equal(profileRecovered.HostConfig.CgroupnsMode, "private");
    assert.notEqual(profileRecovered.HostConfig.OomKillDisable, true);
    assert.equal(profileRecovered.HostConfig.DeviceCgroupRules, null);
    assert.match(profileRecovered.HostConfig.Tmpfs["/tmp"], /noexec/u);
    assert.equal(profileRecovered.HostConfig.CapAdd, null);
    assert.equal(profileRecovered.Mounts.some((mount) => mount.Type === "volume" || mount.Type === "bind"), false);
    await docker(["volume", "rm", weakProfileVolumeName]);
    weakProfileVolumeName = undefined;
    attackerNetwork = `knex-p9-attacker-${randomUUID()}`;
    await docker(["network", "create", "--label", `p9-fixture=${network}`, attackerNetwork]);
    await docker(["network", "connect", attackerNetwork, greenWorkerName]);
    assert.deepEqual(Object.keys(JSON.parse((await docker(["inspect", greenWorkerName])).stdout)[0].NetworkSettings.Networks).sort(), [network, attackerNetwork].sort());
    await supervisorCommand(supervisorUrl, { commandId: "recover-attacker-network-green-worker-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    const attackerRecovered = JSON.parse((await docker(["inspect", greenWorkerName])).stdout)[0];
    assert.notEqual(attackerRecovered.Id, profileRecovered.Id, "Recovery must replace, not retain, a worker attached to an attacker network.");
    assert.deepEqual(Object.keys(attackerRecovered.NetworkSettings.Networks), [network], "Recovery must recreate a worker attached to any non-authorized network.");
    assert.equal(Object.values(JSON.parse((await docker(["network", "inspect", attackerNetwork])).stdout)[0].Containers ?? {}).some((container) => container.Name === greenWorkerName || container.Name === `/${greenWorkerName}`), false, "Recovery must disconnect the replaced worker from the attacker network.");
    await docker(["network", "rm", attackerNetwork]);
    attackerNetwork = undefined;
    const activeGreenFence = await liveStore.readFence(owner);
    assert.equal(activeGreenFence.fencingToken, 7);
    await waitForProcessEvent(pool, "release-worker", "worker-activated", 1);
    await waitForProcessEvent(pool, "release-worker", "worker-drained", 1);
    assert.equal((await packagedWorkerEffect).result.status, "stale-completion-rejected", "Fence transfer must reject the packaged blue worker's stale database completion after its external delivery settles.");
    const releaseWorkerEvidence = await pool.query("select id, event, generation_id, fencing_token, detail from p9_static_process_events where role='release-worker' and event in ('worker-activated','worker-effect-started','worker-effect-delivered','worker-effect-completed','worker-stale-completion-rejected','worker-drain-rejected','worker-draining','worker-drained') order by id");
    assert.equal(releaseWorkerEvidence.rows.some((row) => row.event === "worker-activated" && row.generation_id === "customer-alpha-green-12" && Number(row.fencing_token) === 2 && row.detail.sourceCommit === targetCommit && row.detail.applicationDigest === greenBuild.applicationDigest && row.detail.imageDigest === greenBuild.imageDigest && row.detail.module === "module.sales"), true, "The supervisor must activate the green worker packaged in the exact attested release image after fence transfer.");
    assert.equal(releaseWorkerEvidence.rows.some((row) => row.event === "worker-drained" && row.generation_id === blue.generationId && row.detail.sourceCommit === baseCommit && row.detail.applicationDigest === blueBuild.applicationDigest && row.detail.imageDigest === blueBuild.imageDigest && row.detail.module === "module.sales"), true, "The supervisor must drain the prior worker binary instead of treating host checkout processes as workers.");
    assert.equal(releaseWorkerEvidence.rows.some((row) => row.event === "worker-drain-rejected" && row.generation_id === "customer-alpha-green-12" && row.detail.reason === "stale-ticket" && row.detail.ticketFencingToken === 1), true, "The release worker must record and reject the stale full transition ticket before changing mode.");
    const packagedEvents = releaseWorkerEvidence.rows.filter((row) => row.generation_id === blue.generationId && ["worker-effect-started", "worker-effect-delivered", "worker-stale-completion-rejected", "worker-draining", "worker-drained"].includes(row.event));
    assert.deepEqual(packagedEvents.map(({ event }) => event), ["worker-effect-started", "worker-draining", "worker-effect-delivered", "worker-stale-completion-rejected", "worker-drained"], "Drain must enter draining state, wait for the packaged worker's external delivery and stale-completion denial, then complete.");
    assert.equal(packagedEvents.find(({ event }) => event === "worker-draining").detail.inFlight, 1);
    assert.equal(packagedEvents.find(({ event }) => event === "worker-drained").detail.waitedFor, 1);
    assert.equal((await pool.query("select count(*)::int count from p9_static_external_effects where result_digest=$1", [sha256("packaged worker external effect")])).rows[0].count, 1);
    await supervisorCommand(supervisorUrl, { commandId: "recover-promote-green-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1 });
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, "customer-alpha-green-12");
    const [oldBinarySchema, newBinarySchema] = await Promise.all([
      pool.query(
        "select url from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
        [owner.applicationId, owner.environment, blue.generationId]
      ).then(({ rows }) => fetch(`${rows[0].url}/schema-proof`).then((response) => response.json())),
      fetch(`${processGatewayUrl}/schema-proof`).then((response) => response.json())
    ]);
    assert.deepEqual(oldBinarySchema, { databaseRole: "p9_static_blue", schemaRevision: 12, values: ["one", "two", "three"] });
    assert.deepEqual(newBinarySchema, { databaseRole: "p9_static_green", schemaRevision: 12, values: ["ONE", "TWO", "THREE"] });
    await supervisorCommand(supervisorUrl, { commandId: "restart-blue-rollback-window", operation: "restart", ...owner, generationId: blue.generationId, buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1, sourceCommit: baseCommit, applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, migrationRevision: 11, completedMigrationSteps: [] });
    crashEvidence.add("rollback-open:web-blue");
    await supervisorProcess.stop();
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", { P9_PROCESS_INSTANCE: "supervisor-6", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network, P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1" }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    await realtimeProcess.stop();
    realtimeProcess = startTopologyProcess("realtime-client", processEnv("realtime-client", { P9_PROCESS_INSTANCE: "realtime-2", P9_GATEWAY_URL: processGatewayUrl }));
    topology.push(realtimeProcess);
    await realtimeProcess.ready;
    await Promise.all([
      waitForProcessEvent(pool, "supervisor", "supervisor-recovered", 6), waitForProcessEvent(pool, "release-worker", "worker-activated", 1),
      waitForProcessEvent(pool, "realtime-client", "realtime-resynced", 2)
    ]);
    const deployedAuthority = {
      generationId: "customer-alpha-green-12", version: plan.plugin.version, sourceCommit: targetCommit,
      compositionChangePlanDigest: change.planDigest, buildEvidenceDigest: build.authority.read(build.token).evidenceDigest,
      applicationDigest: greenBuild.applicationDigest, imageDigest: greenBuild.imageDigest, migrationRevision: 12,
      workerFencingToken: 2, receiptId: managedReceipt.receipt.receiptId
    };
    assert.equal(await deploymentClient.reverify(deployedAuthority), true, "a restarted supervisor must publish only the durable source/build/deployment authority");
    assert.equal(await deploymentClient.reverify({ ...deployedAuthority, imageDigest: blueBuild.imageDigest }), false, "an arbitrary image cannot masquerade as a deployed static release");
    crashEvidence.add("promoted:supervisor");
    crashEvidence.add("promoted:worker-green");
    crashEvidence.add("promoted:realtime-client");
    await pool.query("update runtime_worker_effects set claim_expires_at=now()+interval '30 seconds' where application_id=$1 and environment=$2 and effect_id='sales-external-effect'", [owner.applicationId, owner.environment]);
    const liveBlueClaim = await liveStore.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: activeGreenFence.fencingToken, claimantId: "worker:phase-9-green-a", claimLeaseDurationMs: 500 });
    assert.equal(liveBlueClaim.status, "already-claimed", "Fence transfer must not reassign a live blue claim to green.");
    assert.equal(liveBlueClaim.externalIdempotencyKey, blueEffect.externalIdempotencyKey);
    await pool.query("update runtime_worker_effects set claim_expires_at=now()-interval '1 second' where application_id=$1 and environment=$2 and effect_id='sales-external-effect'", [owner.applicationId, owner.environment]);
    const greenEffect = await liveStore.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: activeGreenFence.fencingToken, claimantId: "worker:phase-9-green-a", claimLeaseDurationMs: 500 });
    assert.equal(greenEffect.status, "claimed");
    assert.equal(greenEffect.externalIdempotencyKey, blueEffect.externalIdempotencyKey, "Retries across a fence retain the external identity.");
    const reconciled = await deliverExternalEffect(pool, greenEffect.externalIdempotencyKey, "sales external effect");
    assert.equal(reconciled.duplicate, true, "The observable external sink must reject the replay even when the old database completion is stale.");
    await assert.rejects(liveStore.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, claimToken: blueEffect.claimToken, resultDigest: reconciled.resultDigest }), { code: "FENCE_REJECTED" });
    await liveStore.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: activeGreenFence.fencingToken, claimToken: greenEffect.claimToken, resultDigest: reconciled.resultDigest });
    assert.equal((await pool.query("select count(*)::int count from p9_static_external_effects where idempotency_key=$1", [blueEffect.externalIdempotencyKey])).rows[0].count, 1);
    scenarioEvidence.add("SCN-18");
    const overlap = await Promise.all([pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap"), pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap"), fetch(`${processGatewayUrl}/new-binary`).then((response) => response.json())]);
    assert.deepEqual(overlap[0].rows[0].values, ["one", "two", "three"]);
    assert.deepEqual(overlap[1].rows[0].values, ["ONE", "TWO", "THREE"]);
    assert.deepEqual({ generation: overlap[2].generation, module: overlap[2].module, pluginVersion: overlap[2].pluginVersion }, { generation: "customer-alpha-green-12", module: "module.sales", pluginVersion: "1.0.0" });
    assert.deepEqual((await pool.query("select step_id, last_id from p9_static_backfill_checkpoint")).rows, [{ step_id: "migration-backfill-12", last_id: 3 }]);

    trafficProbe.transition("rollback", ["customer-alpha-green-12", blue.generationId]);
    await trafficProbe.waitForGeneration("rollback", "customer-alpha-green-12");
    const lowLevelRollbackReceipt = (await supervisorCommand(supervisorUrl, { commandId: "rollback-green-to-blue-12", operation: "rollback", ...owner, generationId: blue.generationId, buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 1, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt })).result;
    await new SharedStaticPlatformPluginGenerationRebinder().rebind({ session: pool, applicationId: owner.applicationId, environment: owner.environment, previousGenerationId: lowLevelRollbackReceipt.previousGenerationId, receipt: lowLevelRollbackReceipt });
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, "customer-alpha-green-12", "A low-level rollback cannot serve before its exact lifecycle transition consumes the deployment receipt.");
    const rollbackOperationId = "operation-static-rollback-blue-12";
    const rollbackLifecycle = (await pool.query(
      "select revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'",
      [owner.applicationId, owner.environment]
    )).rows[0];
    await pool.query(
      `insert into runtime_extension_operations (
         operation_id, application_id, environment, delivery_class, extension_id, operation_kind, idempotency_key,
         request_digest, request_json, authorization_json, expected_revision, phase, lease_owner, lease_token, lease_expires_at, plan_json, result_json
       ) values ($1,$2,$3,'platform-plugin','module.sales','rollback','static-rollback-blue-12',$4,'{}'::jsonb,'{}'::jsonb,$5,'completed',
         'worker:static-rollback','lease-static-rollback',now() + interval '5 minutes',$6::jsonb,$7::jsonb)`,
      [rollbackOperationId, owner.applicationId, owner.environment, sha256(rollbackOperationId), rollbackLifecycle.revision - 1,
        JSON.stringify({ executionClass: "static-release", operationId: rollbackOperationId, generationId: lowLevelRollbackReceipt.activeGenerationId,
          sourceChange: { targetSourceCommit: lowLevelRollbackReceipt.sourceCommit, planDigest: lowLevelRollbackReceipt.compositionChangePlanDigest } }),
        JSON.stringify(lowLevelRollbackReceipt)]
    );
    await pool.query(
      "update runtime_extensions set last_operation_id=$1 where application_id=$2 and environment=$3 and delivery_class='platform-plugin' and extension_id='module.sales'",
      [rollbackOperationId, owner.applicationId, owner.environment]
    );
    await pool.query(
      `insert into runtime_extension_transition_receipts (receipt_id, operation_id, revision, event_json)
       values ($1,$2,$3,$4::jsonb)`,
      [lowLevelRollbackReceipt.receiptId, rollbackOperationId, rollbackLifecycle.revision, JSON.stringify({
        receiptId: lowLevelRollbackReceipt.receiptId, operationId: rollbackOperationId, operation: "rollback", operationPhase: "completed", lifecycleState: "active", revision: rollbackLifecycle.revision,
        evidence: {
          generationId: lowLevelRollbackReceipt.activeGenerationId, sourceCommit: lowLevelRollbackReceipt.sourceCommit,
          compositionChangePlanDigest: lowLevelRollbackReceipt.compositionChangePlanDigest,
          buildEvidenceDigest: lowLevelRollbackReceipt.buildEvidenceDigest, applicationDigest: lowLevelRollbackReceipt.applicationDigest,
          imageDigest: lowLevelRollbackReceipt.imageDigest
        }
      })]
    );
    await trafficProbe.waitForGeneration("rollback", blue.generationId);
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, blue.generationId);
    await supervisorCommand(supervisorUrl, { commandId: "recover-rollback-blue-12", operation: "recover", ...owner, generationId: blue.generationId, buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 2 });
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, blue.generationId);
    await waitForProcessEvent(pool, "release-worker", "worker-activated", 2);
    const completedBlueDrainTicket = (await pool.query(
      "select detail->'ticket' ticket from p9_static_process_events where role='supervisor' and event='drain-ticket-forwarded' and generation_id=$1 order by id limit 1",
      [blue.generationId]
    )).rows[0]?.ticket;
    assert.ok(completedBlueDrainTicket, "The real completed blue drain ticket must be retained as PostgreSQL fixture evidence.");
    await assert.rejects(
      supervisorCommand(supervisorUrl, { commandId: "replay-completed-blue-drain-ticket", operation: "drain-with-ticket", ...owner, generationId: blue.generationId, ticket: completedBlueDrainTicket }),
      { code: "REVISION_CONFLICT" },
      "A completed pre-rollback ticket cannot drain Blue after it becomes the newly fenced active generation."
    );
    const blueWorkerName = `knex-p9-${network}-${partialOwnerId}-${blue.generationId}-worker`;
    const blueWorkerPort = (await docker(["port", blueWorkerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.equal((await fetch(`http://127.0.0.1:${blueWorkerPort}/status`).then((response) => response.json())).mode, "active");
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, blue.generationId);
    crashEvidence.add("rolled-back:worker-blue");
    trafficProbe.transition("re-promotion", [blue.generationId, "customer-alpha-green-12"]);
    await trafficProbe.waitForGeneration("re-promotion", blue.generationId);
    const rePromotionAdmission = await staticLifecycleAdmission(owner, "customer-alpha-green-12", blue);
    const lowLevelRePromotionReceipt = (await supervisorCommand(supervisorUrl, { commandId: "re-promote-green-12", operation: "promote", ...owner, operationId: rePromotionAdmission.operationId, lifecycleExpectedRevision: rePromotionAdmission.expectedRevision, deliveryClass: "platform-plugin", extensionId: "module.sales", generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 2, workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt })).result.receipt;
    await new SharedStaticPlatformPluginGenerationRebinder().rebind({ session: pool, applicationId: owner.applicationId, environment: owner.environment, previousGenerationId: lowLevelRePromotionReceipt.previousGenerationId, receipt: lowLevelRePromotionReceipt });
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, blue.generationId, "A low-level re-promotion cannot serve before its exact lifecycle transition consumes the deployment receipt.");
    const rePromotionLifecycle = (await pool.query(
      "select revision from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'",
      [owner.applicationId, owner.environment]
    )).rows[0];
    await pool.query(
      "update runtime_extension_operations set phase='completed', result_json=$1::jsonb where operation_id=$2",
      [JSON.stringify(lowLevelRePromotionReceipt), rePromotionAdmission.operationId]
    );
    await pool.query(
      `insert into runtime_extension_transition_receipts (receipt_id, operation_id, revision, event_json)
       values ($1,$2,$3,$4::jsonb)`,
      [lowLevelRePromotionReceipt.receiptId, rePromotionAdmission.operationId, rePromotionLifecycle.revision, JSON.stringify({
        receiptId: lowLevelRePromotionReceipt.receiptId, operationId: rePromotionAdmission.operationId, operation: "update", operationPhase: "completed", lifecycleState: "active", revision: rePromotionLifecycle.revision,
        evidence: {
          generationId: lowLevelRePromotionReceipt.activeGenerationId, sourceCommit: lowLevelRePromotionReceipt.sourceCommit,
          compositionChangePlanDigest: lowLevelRePromotionReceipt.compositionChangePlanDigest,
          buildEvidenceDigest: lowLevelRePromotionReceipt.buildEvidenceDigest, applicationDigest: lowLevelRePromotionReceipt.applicationDigest,
          imageDigest: lowLevelRePromotionReceipt.imageDigest
        }
      })]
    );
    await supervisorCommand(supervisorUrl, { commandId: "recover-re-promotion-green-12", operation: "recover", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 3 });
    await trafficProbe.waitForGeneration("re-promotion", "customer-alpha-green-12");
    await assert.rejects(supervisorCommand(supervisorUrl, { commandId: "contract-before-close-12", operation: "contract-cleanup", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 3 }), { code: "CONTRACT_CLEANUP_BLOCKED" });
    const blueRetirement = await store.reserveRollbackRetirement({ ...owner, expectedRevision: 3, retiredGenerationId: blue.generationId });
    const blueRetirementTicket = await store.reserveTransitionStep({ ...owner, expectedRevision: 4, step: "drain-retained", reservationId: randomUUID() });
    const blueWorkerControlToken = sha256(`${network}:${owner.applicationId}:${owner.environment}:${blue.generationId}:release-worker-control`);
    const assertStaleDrainRejected = async (field, ticket) => {
      const before = await fetch(`http://127.0.0.1:${blueWorkerPort}/status`).then((value) => value.json());
      const response = await fetch(`http://127.0.0.1:${blueWorkerPort}/drain`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-p9-worker-control": blueWorkerControlToken },
        body: JSON.stringify(ticket)
      });
      assert.equal(response.status, 409, `A stale ${field} ticket field must be rejected by the release worker.`);
      assert.deepEqual(await fetch(`http://127.0.0.1:${blueWorkerPort}/status`).then((value) => value.json()), before, `Rejecting stale ${field} must not change worker state.`);
    };
    const staleTickets = [
      ["fencing token", { ...blueRetirementTicket, fencingToken: blueRetirementTicket.fencingToken - 1 }],
      ["deployment revision", { ...blueRetirementTicket, revision: blueRetirementTicket.revision - 1 }],
      ["promotion revision", { ...blueRetirementTicket, promotionRevision: blueRetirementTicket.promotionRevision - 1 }],
      ["lease owner", { ...blueRetirementTicket, leaseOwner: `${blueRetirementTicket.leaseOwner}-forged` }],
      ["missing lease owner", (({ leaseOwner: _leaseOwner, ...ticket }) => ticket)(blueRetirementTicket)],
      ["checkpoint kind", { ...blueRetirementTicket, checkpointKind: "rollback" }],
      ["step", { ...blueRetirementTicket, step: "drain-previous" }],
      ["reservation", { ...blueRetirementTicket, reservationId: randomUUID() }],
      ["reservation expiry", { ...blueRetirementTicket, reservationExpiresAt: new Date(Date.parse(blueRetirementTicket.reservationExpiresAt) + 1_000).toISOString() }],
      ["active generation", { ...blueRetirementTicket, activeGenerationId: blue.generationId }],
      ["application owner", { ...blueRetirementTicket, applicationId: "customer-bravo" }],
      ["environment owner", { ...blueRetirementTicket, environment: "staging" }],
      ["generation target", { ...blueRetirementTicket, generationId: "customer-alpha-green-12" }]
    ];
    for (const [field, ticket] of staleTickets) await assertStaleDrainRejected(field, ticket);
    await store.releaseTransitionStep(blueRetirementTicket);
    const closed = (await supervisorCommand(supervisorUrl, { commandId: "close-rollback-12", operation: "close-rollback", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 4 })).result;
    assert.equal(closed.contractCleanup, "eligible");
    const blueContainer = `knex-p9-${network}-${partialOwnerId}-${blue.generationId}`;
    await assertDockerContainerAbsent(blueContainer, "Normal rollback retirement retained the Blue web container.");
    await assertDockerContainerAbsent(`${blueContainer}-worker`, "Normal rollback retirement retained the Blue worker container.");
    assert.equal((await pool.query(
      "select count(*)::int count from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
      [owner.applicationId, owner.environment, blue.generationId]
    )).rows[0].count, 0, "Normal rollback retirement retained Blue's owner-scoped route.");
    assert.deepEqual((await pool.query(
      "select reservation_id, state, completed_at is not null completed from runtime_static_generation_retirements where application_id=$1 and environment=$2 and generation_id=$3",
      [owner.applicationId, owner.environment, blue.generationId]
    )).rows, [{ reservation_id: blueRetirement.reservationId, state: "completed", completed: true }], "Normal rollback retirement must complete its original durable tombstone before contract cleanup.");
    assert.deepEqual((await supervisorCommand(supervisorUrl, { commandId: "contract-after-close-12", operation: "contract-cleanup", ...owner, generationId: "customer-alpha-green-12", buildRequestDigest: deploymentRequest.buildRequestDigest, expectedRevision: 5 })).result.completed, ["migration-contract-12"]);
    scenarioEvidence.add("SCN-17");
    assert.equal((await pool.query("select count(*)::int count from information_schema.columns where table_name='p9_static_overlap' and column_name='legacy_value'")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int count from p9_static_process_events where role='realtime-client' and event='realtime-resynced'")).rows[0].count >= 3, true);
    const outbox = await pool.query("select revision, event_json->>'operation' operation from runtime_static_deployment_outbox where application_id=$1 and environment=$2 order by revision", [owner.applicationId, owner.environment]);
    assert.deepEqual(outbox.rows, [{ revision: 1, operation: "promote" }, { revision: 2, operation: "rollback" }, { revision: 3, operation: "promote" }, { revision: 4, operation: "reserve-rollback-retirement" }, { revision: 5, operation: "close-rollback" }]);
    const offlineSalesRevision = (await managedStore.observeActiveGeneration("customer-alpha", "production", managedRequest.extension)).revision;
    const offlineRequest = {
      ...managedRequest,
      expectedRevision: offlineSalesRevision,
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
      { validate: async () => undefined, plan: async (request) => ({
        plan: {
          schemaVersion: 1, planId: "sales-static-maintenance-plan-13", operationId: request.operationId, operation: "update", version: offlineComposition.plugin.version,
          artifactDigest: offlineComposition.plugin.releaseManifestDigest, expectedRevision: offlineSalesRevision, currentGenerationId: "customer-alpha-green-12", targetGenerationId: "customer-alpha-maintenance-13",
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
      }, reverify: async () => assert.fail("Maintenance refusal must not reverify a build placeholder.") },
      undefined,
      { now: () => now }
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
      routes: (await pool.query("select application_id, environment, generation_id, url from p9_static_process_routes order by application_id, environment, generation_id")).rows,
      containers: (await docker(["ps", "--all", "--filter", `label=p9-fixture=${network}`, "--format", "{{.Names}}"])).stdout.trim().split("\n").filter(Boolean).sort(),
      traffic: await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())
    });
    const refusalBefore = await snapshot();
    const releasedSyntheticAdmissions = await pool.query(
      `update runtime_extension_operations set phase='failed', updated_at=now()
       where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'
         and lease_owner='worker:static-proof' and phase not in ('completed','failed')
       returning operation_id`,
      [owner.applicationId, owner.environment]
    );
    assert.ok(releasedSyntheticAdmissions.rowCount > 0, "Static fixture admissions must be released before the independent maintenance plan.");
    assert.equal((await pool.query(
      `select count(*)::int count from runtime_extension_operations
       where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'
         and lease_owner='worker:static-proof' and phase not in ('completed','failed')`,
      [owner.applicationId, owner.environment]
    )).rows[0].count, 0, "No helper-owned static fixture admission may block the maintenance plan.");
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
    const releasedOfflineOperation = await pool.query(
      "update runtime_extension_operations set phase='failed' where operation_id=$1 and phase='source-change-ready' returning operation_id",
      [offlineManagedPlan.operationId]
    );
    if (releasedOfflineOperation.rowCount === 1) {
      await pool.query("update runtime_extension_operation_budget set active_count=greatest(active_count-1,0) where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]);
    }
    const salesManifest = JSON.parse(await readFile(join(repositoryRoot, "modules", "sales", "k-nex.plugin.json"), "utf8"));
    const lifecycleSales = (await managedStore.inventory(owner.applicationId, owner.environment)).extensions.platformPlugins["module.sales"];
    assert.equal(lifecycleSales.disposition, "active");
    const salesActionRequest = Object.freeze({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer trusted-smoke-token:p10-static-sales-user", "x-idempotency-key": "p9-static-sales-action-before-disable" },
      body: JSON.stringify({ title: "Phase 9 retained Sales task", status: "open", potentialRevenue: "42.00", privateNote: "lifecycle proof" })
    });
    const activeSalesOperation = await fetch(`${processGatewayUrl}/sales-operation`, salesActionRequest);
    const activeSalesBody = await activeSalesOperation.text();
    assert.equal(activeSalesOperation.status, 200, activeSalesBody);
    const activeSalesResult = JSON.parse(activeSalesBody);
    assert.equal(activeSalesResult.authorized, true);
    assert.equal(activeSalesResult.databaseRole, lifecycleSales.activeGeneration.generationId === "customer-alpha-blue-11" ? "p9_static_blue" : "p9_static_green");
    assert.deepEqual(
      { title: activeSalesResult.task.title, status: activeSalesResult.task.status },
      { title: "Phase 9 retained Sales task", status: "open" }
    );
    const salesDataAfterAction = {
      tasks: Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),
      outbox: Number((await pool.query("select count(*) count from k_nex_outbox where plugin_id='module.sales'")).rows[0].count)
    };
    assert.equal(salesDataAfterAction.tasks > 0, true);
    assert.equal(salesDataAfterAction.outbox > 0, true);
    const staticStateBeforeDisable = await store.read(owner);
    const fenceBeforeDisable = await liveStore.readFence(owner);
    const sourceHeadBeforeDisable = await sourceCommit(sourceDirectory);
    const releaseRequestsBeforeDisable = Number((await pool.query("select count(*) count from runtime_static_release_requests")).rows[0].count);
    const imagesBeforeDisable = (await docker(["image", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.ID}}"])).stdout.trim().split("\n").filter(Boolean).sort();
    const greenDrainCountBeforeDisable = Number((await pool.query(
      "select count(*) count from p9_static_process_events where role='release-worker' and event='worker-drained' and generation_id=$1",
      [lifecycleSales.activeGeneration.generationId]
    )).rows[0].count);
    const disableRequest = {
      ...managedRequest, operation: "disable", expectedRevision: lifecycleSales.revision,
      idempotencyKey: "static-runtime-disable-sales", correlationId: "static-runtime-disable-sales"
    };
    const disablePlan = {
      ...installPlan, planId: "sales-runtime-disable", operation: "disable", expectedRevision: lifecycleSales.revision,
      currentGenerationId: lifecycleSales.activeGeneration.generationId, targetGenerationId: lifecycleSales.activeGeneration.generationId
    };
    const lifecycleManager = new PluginManager(
      "p9-static-lifecycle", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      { validate: async () => undefined, plan: async (planned) => ({ plan: { ...disablePlan, operationId: planned.operationId }, sourceCommit: targetCommit, generationId: lifecycleSales.activeGeneration.generationId }) },
      managedStore,
      { stage: async () => assert.fail("Runtime-only Platform Plugin disable must not stage an artifact."), reverify: async () => false },
      { request: async () => assert.fail("Runtime-only Platform Plugin disable must not mutate customer source.") },
      { request: async () => assert.fail("Runtime-only Platform Plugin disable must not request a build/deployment."), reverify: async () => false },
      undefined,
      { now: () => now }
    );
    const lifecycleApi = new ExtensionOperatorApi(
      lifecycleManager,
      { list: async () => [] },
      staticReleases,
      { observe: async () => ({ runnerIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "runner-isolation-profile.json"), "utf8")), remoteUiIsolation: JSON.parse(await readFile(join(fixtureDirectory, "..", "extensions", "valid", "remote-ui-isolation-profile.json"), "utf8")), health: [] }) }
    );
    const runtimeDisablePlan = await lifecycleApi.plan(disableRequest);
    assert.equal(runtimeDisablePlan.executionClass, "live-generation");
    assert.equal(runtimeDisablePlan.generationId, lifecycleSales.activeGeneration.generationId);
    const disabledReceipt = await lifecycleApi.disable(runtimeDisablePlan.operationId);
    assert.deepEqual(await lifecycleApi.disable(runtimeDisablePlan.operationId), disabledReceipt, "runtime-only disable must replay its exact receipt");
    assert.equal(disabledReceipt.previousGenerationId, lifecycleSales.activeGeneration.generationId);
    const disabledInventory = await lifecycleManager.inventory(owner.applicationId, owner.environment);
    const disabledSales = disabledInventory.extensions.platformPlugins["module.sales"];
    assert.equal(disabledSales.disposition, "disabled");
    assert.deepEqual(disabledSales.retainedGeneration, lifecycleSales.activeGeneration);
    assert.deepEqual((await pool.query(
      "select event_json->>'operationPhase' phase from runtime_extension_audit where operation_id=$1 order by revision",
      [runtimeDisablePlan.operationId]
    )).rows, [{ phase: "planning" }, { phase: "completed" }]);
    assert.deepEqual((await pool.query(
      "select event_json->>'operationPhase' phase from runtime_extension_outbox where event_json->>'operationId'=$1 order by revision",
      [runtimeDisablePlan.operationId]
    )).rows, [{ phase: "planning" }, { phase: "completed" }]);
    const expectedDisableEvidence = {
      sourceCommit: lifecycleSales.activeGeneration.sourceCommit,
      compositionChangePlanDigest: lifecycleSales.activeGeneration.compositionChangePlanDigest,
      generationId: lifecycleSales.activeGeneration.generationId,
      buildEvidenceDigest: lifecycleSales.activeGeneration.buildEvidenceDigest,
      applicationDigest: lifecycleSales.activeGeneration.applicationDigest,
      imageDigest: lifecycleSales.activeGeneration.imageDigest
    };
    assert.deepEqual((await pool.query(
      "select event_json->'evidence' evidence from runtime_extension_audit where operation_id=$1 order by revision",
      [runtimeDisablePlan.operationId]
    )).rows, [{ evidence: expectedDisableEvidence }, { evidence: expectedDisableEvidence }]);
    assert.deepEqual(await store.read(owner), staticStateBeforeDisable, "runtime-only disable must not mutate the static deployment pointer");
    const fenceAfterDisable = await liveStore.readFence(owner);
    assert.deepEqual(
      { generationId: fenceAfterDisable.activeExecutionGeneration, fencingToken: fenceAfterDisable.fencingToken, promotionRevision: fenceAfterDisable.promotionRevision, owner: fenceAfterDisable.lease.owner },
      { generationId: fenceBeforeDisable.activeExecutionGeneration, fencingToken: fenceBeforeDisable.fencingToken, promotionRevision: fenceBeforeDisable.promotionRevision, owner: fenceBeforeDisable.lease.owner },
      "runtime-only disable must not transfer the application worker fence"
    );
    assert.equal(await sourceCommit(sourceDirectory), sourceHeadBeforeDisable);
    assert.equal(Number((await pool.query("select count(*) count from runtime_static_release_requests")).rows[0].count), releaseRequestsBeforeDisable);
    assert.deepEqual((await docker(["image", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.ID}}"])).stdout.trim().split("\n").filter(Boolean).sort(), imagesBeforeDisable);
    assert.equal(Number((await pool.query(
      "select count(*) count from p9_static_process_events where role='release-worker' and event='worker-drained' and generation_id=$1",
      [lifecycleSales.activeGeneration.generationId]
    )).rows[0].count), greenDrainCountBeforeDisable);
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, lifecycleSales.activeGeneration.generationId);
    const disabledSalesOperation = await fetch(`${processGatewayUrl}/sales-operation`, salesActionRequest);
    assert.equal(disabledSalesOperation.status, 403);
    assert.deepEqual(await disabledSalesOperation.json(), { authorized: false });
    assert.deepEqual({
      tasks: Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),
      outbox: Number((await pool.query("select count(*) count from k_nex_outbox where plugin_id='module.sales'")).rows[0].count)
    }, salesDataAfterAction, "Denied Sales action must not mutate Sales data or its durable outbox.");

    const uninstallRequest = {
      ...managedRequest, operation: "uninstall", expectedRevision: disabledSales.revision,
      idempotencyKey: "static-uninstall-sales-refused", correlationId: "static-uninstall-sales-refused"
    };
    const sourceHeadBeforeUninstall = await sourceCommit(sourceDirectory);
    const releaseRequestsBeforeUninstall = Number((await pool.query("select count(*) count from runtime_static_release_requests")).rows[0].count);
    const staticStateBeforeUninstall = await store.read(owner);
    const lifecycleStateBeforeUninstall = structuredClone(disabledSales);
    const operationsBeforeUninstall = Number((await pool.query("select count(*) count from runtime_extension_operations")).rows[0].count);
    const budgetBeforeUninstall = Number((await pool.query("select active_count from runtime_extension_operation_budget where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].active_count);
    const refusingManager = new PluginManager(
      "p9-static-uninstall-policy", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      {
        validate: async (candidate) => { if (candidate.operation === "uninstall") assertPlatformPluginUninstallSupported(salesManifest); },
        plan: async () => assert.fail("Rejected Sales uninstall reached planning.")
      },
      managedStore,
      { stage: async () => assert.fail("Rejected Sales uninstall must not stage an artifact."), reverify: async () => false },
      { request: async () => assert.fail("Rejected Sales uninstall must not mutate customer source.") },
      { request: async () => assert.fail("Rejected Sales uninstall must not request a build/deployment."), reverify: async () => false },
      undefined,
      { now: () => now }
    );
    await assert.rejects(refusingManager.plan(uninstallRequest), { code: "OPERATION_UNSUPPORTED" });
    assert.deepEqual((await refusingManager.inventory(owner.applicationId, owner.environment)).extensions.platformPlugins["module.sales"], lifecycleStateBeforeUninstall);
    assert.deepEqual(await store.read(owner), staticStateBeforeUninstall);
    assert.equal(await sourceCommit(sourceDirectory), sourceHeadBeforeUninstall);
    assert.equal(Number((await pool.query("select count(*) count from runtime_static_release_requests")).rows[0].count), releaseRequestsBeforeUninstall);
    assert.equal(Number((await pool.query("select count(*) count from runtime_extension_operations")).rows[0].count), operationsBeforeUninstall);
    assert.equal(Number((await pool.query("select active_count from runtime_extension_operation_budget where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].active_count), budgetBeforeUninstall);
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, lifecycleSales.activeGeneration.generationId);
    console.log(`P9_STATIC_RUNTIME_LIFECYCLE_EVIDENCE=${JSON.stringify({ disable: disabledReceipt, uninstall: "OPERATION_UNSUPPORTED", generationId: lifecycleSales.activeGeneration.generationId })}`);

    const forgedRequest = {
      ...uninstallRequest,
      idempotencyKey: "forged-live-platform-uninstall", correlationId: "forged-live-platform-uninstall"
    };
    const forgedRequestDigest = digestJson(forgedRequest);
    const forgedAuthorization = {
      actor: authorization.actor,
      decisionId: digestJson({ authority: "github-actions:phase-9", request: { ...forgedRequest, requestDigest: forgedRequestDigest } })
    };
    const forgedClaim = await managedStore.claimOperation({
      request: forgedRequest, requestDigest: forgedRequestDigest, authorization: forgedAuthorization, workerId: "p9-forged-store-regression"
    });
    assert.equal(forgedClaim.status, "claimed");
    const forgedLivePlan = {
      executionClass: "live-generation", operationId: forgedClaim.operation.operationId,
      sourceCommit: targetCommit, generationId: "customer-alpha-forged-uninstall-13",
      plan: {
        ...installPlan, planId: "forged-live-platform-uninstall", operationId: forgedClaim.operation.operationId,
        operation: "uninstall", expectedRevision: disabledSales.revision,
        currentGenerationId: lifecycleSales.activeGeneration.generationId, targetGenerationId: "customer-alpha-forged-uninstall-13"
      }
    };
    const forgedEvidenceSnapshot = async () => ({
      inventory: (await pool.query("select revision, disposition, active_generation_id, active_generation, retained_generation, last_operation_id from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales'", [owner.applicationId, owner.environment])).rows,
      inventoryRevision: (await pool.query("select revision from runtime_extension_inventory_revisions where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows,
      audit: (await pool.query("select audit_id, revision, event_json from runtime_extension_audit where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales' order by revision", [owner.applicationId, owner.environment])).rows,
      outbox: (await pool.query("select event_id, revision, event_json from runtime_extension_outbox where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id='module.sales' order by revision", [owner.applicationId, owner.environment])).rows,
      operation: (await pool.query("select operation_id, phase, plan_json, result_json from runtime_extension_operations where operation_id=$1", [forgedClaim.operation.operationId])).rows,
      budget: (await pool.query("select active_count, max_count from runtime_extension_operation_budget where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows
    });
    const beforeForgedSave = await forgedEvidenceSnapshot();
    await assert.rejects(managedStore.savePlan(forgedClaim.operation.operationId, forgedClaim.operation.leaseToken, forgedLivePlan), { code: "GENERATION_MISMATCH" });
    assert.deepEqual(await forgedEvidenceSnapshot(), beforeForgedSave, "Rejecting a forged live Platform uninstall plan must be transactionally inert.");
    await pool.query("update runtime_extension_operations set plan_json=$2::jsonb where operation_id=$1", [forgedClaim.operation.operationId, JSON.stringify(forgedLivePlan)]);
    const beforeForgedDirectUninstall = await forgedEvidenceSnapshot();
    await assert.rejects(managedStore.uninstallGeneration(forgedClaim.operation.operationId, forgedClaim.operation.leaseToken), { code: "PHASE_CONFLICT" });
    assert.deepEqual(await forgedEvidenceSnapshot(), beforeForgedDirectUninstall, "Direct execution of forged persisted Platform uninstall JSON must be transactionally inert.");
    await pool.query("delete from runtime_extension_operations where operation_id=$1", [forgedClaim.operation.operationId]);
    await pool.query("update runtime_extension_operation_budget set active_count=$3 where application_id=$1 and environment=$2", [owner.applicationId, owner.environment, budgetBeforeUninstall]);
    assert.equal(Number((await pool.query("select count(*) count from runtime_extension_operations")).rows[0].count), operationsBeforeUninstall);
    assert.equal(Number((await pool.query("select active_count from runtime_extension_operation_budget where application_id=$1 and environment=$2", [owner.applicationId, owner.environment])).rows[0].active_count), budgetBeforeUninstall);
    console.log(`P9_FORGED_PLATFORM_UNINSTALL_REJECTION=${JSON.stringify({ savePlan: "GENERATION_MISMATCH", directExecution: "PHASE_CONFLICT", stateUnchanged: true })}`);

    const providerManifest = JSON.parse(await readFile(join(repositoryRoot, "packages", "realtime-socketio", "k-nex.plugin.json"), "utf8"));
    assert.doesNotThrow(() => assertPlatformPluginUninstallSupported(providerManifest));
    const providerExtension = { deliveryClass: "platform-plugin", id: "provider.realtime.socketio" };
    const providerGeneration = { ...lifecycleSales.activeGeneration, version: "1.0.0" };
    assert.equal(providerGeneration.generationId, staticStateBeforeUninstall.active.generationId, "The bounded provider bootstrap fixture must bind the exact current static application generation.");
    assert.equal(staticStateBeforeUninstall.revision, 5, "The provider fixture bootstrap must bind the current static deployment revision.");
    const providerAuthorizationProjector = new AuthorizationLifecycleProjector(
      createStaticPlatformPluginAuthorizationDescriptorResolver({
        applicationId: owner.applicationId,
        registrations: [{ sourceCommit: targetCommit, registration: scopedStaticRegistration(true) }]
      })
    );
    const providerBootstrapSession = await pool.connect();
    try {
      await providerBootstrapSession.query("begin");
      await providerBootstrapSession.query(
        `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
         values ($1,$2,$3,$4,$5,'active',$6,$7::jsonb)`,
        [owner.applicationId, owner.environment, providerExtension.deliveryClass, providerExtension.id, staticStateBeforeUninstall.revision, providerGeneration.generationId, JSON.stringify(providerGeneration)]
      );
      await providerAuthorizationProjector.project({
        session: providerBootstrapSession,
        transition: activeStaticPlatformPluginLifecycleEvent(owner.applicationId, owner.environment, providerExtension.id, targetCommit, providerGeneration.generationId),
        runtimeGenerationIds: [providerGeneration.generationId]
      });
      await providerBootstrapSession.query("commit");
    } catch (error) {
      await providerBootstrapSession.query("rollback");
      throw error;
    } finally {
      providerBootstrapSession.release();
    }
    const providerRequest = {
      applicationId: owner.applicationId, environment: owner.environment, extension: providerExtension,
      operation: "uninstall", targetVersion: "1.0.0", expectedRevision: staticStateBeforeUninstall.revision,
      idempotencyKey: "static-uninstall-realtime-provider-13", correlationId: "static-uninstall-realtime-provider-13"
    };
    const providerAuthorization = {
      actor: authorization.actor,
      decisionId: digestJson({ authority: "github-actions:phase-9", request: { ...providerRequest, requestDigest: digestJson(providerRequest) } })
    };
    const providerApprovedPath = join(artifactsDirectory, "approved-provider-uninstall.json");
    const providerSourceResultPath = join(artifactsDirectory, "provider-source-result.json");
    const providerAuthorityResultPath = join(artifactsDirectory, "provider-authority-result.json");
    const providerBuildResultPath = join(artifactsDirectory, "provider-build-result.json");
    const providerGenerationId = "customer-alpha-provider-uninstall-13";
    const providerApproved = {
      applicationId: owner.applicationId, environment: owner.environment,
      plugin: { id: providerExtension.id, version: "1.0.0", packageSpec: "file:packages/k-nex-provider-realtime-socketio-1.0.0.tgz" },
      operation: "uninstall", generationId: providerGenerationId, currentGenerationId: providerGeneration.generationId,
      expectedRevision: providerRequest.expectedRevision, releaseSequence: 13,
      authority: { identity: "github-app:k-nex-change-authority" }, authorization: providerAuthorization,
      baseApplicationDigest: greenBuild.applicationDigest, rollbackClosesAt: new Date(now.valueOf() + 86_400_000).toISOString()
    };
    await writeFile(providerApprovedPath, `${canonicalJson(providerApproved)}\n`);
    await Promise.all([sourceAuthorityProcess.stop(), builderProcess.stop(), deployerProcess.stop()]);
    const providerBaseBuildPath = join(artifactsDirectory, "provider-base-build.json");
    await writeFile(providerBaseBuildPath, `${canonicalJson({ ...greenBuild, sourceCommit: targetCommit })}\n`);
    Object.assign(processBase, {
      P9_EXPECTED_BASE_COMMIT: targetCommit, P9_APPROVED_INPUT_PATH: providerApprovedPath,
      P9_APPROVED_INPUT_DIGEST: await fileDigest(providerApprovedPath), P9_SOURCE_RESULT_PATH: providerSourceResultPath,
      P9_BUILD_RESULT_PATH: providerBuildResultPath, P9_AUTHORITY_RESULT_PATH: providerAuthorityResultPath,
      P9_BASE_BUILD_PATH: providerBaseBuildPath
    });
    for (const key of ["P9_BUILD_REQUEST_DIGEST", "P9_BUILD_EVIDENCE_DIGEST", "P9_APPLICATION_DIGEST", "P9_SOURCE_COMMIT", "P9_SOURCE_RESULT_DIGEST"]) delete processBase[key];
    sourceAuthorityProcess = startTopologyProcess("source-authority", processEnv("source-authority", { P9_PROCESS_INSTANCE: "source-authority-provider-uninstall", P9_STAY_ALIVE: "1" }));
    topology.push(sourceAuthorityProcess);
    const providerSourceReady = await sourceAuthorityProcess.ready;
    const providerSource = JSON.parse(await readFile(providerSourceResultPath, "utf8"));
    assert.equal(providerSourceReady.sourceCommit, providerSource.targetSourceCommit);
    assert.notEqual(providerSource.targetSourceCommit, targetCommit);
    assert.deepEqual(providerSource.mutated, [
      ".k-nex/generated/k-nex.resolved.json",
      ".k-nex/generated/plugin-registry.ts",
      ".k-nex/generated/resolved-graph.json",
      ".k-nex/generated/runtime-registration.ts",
      "k-nex.app.json",
      "package-lock.json",
      "package.json",
      "src/k-nex-provider-registry.ts"
    ]);
    const providerManifestAfter = JSON.parse(await readFile(join(sourceDirectory, "k-nex.app.json"), "utf8"));
    const providerPackageAfter = JSON.parse(await readFile(join(sourceDirectory, "package.json"), "utf8"));
    const providerLockAfter = JSON.parse(await readFile(join(sourceDirectory, "package-lock.json"), "utf8"));
    const providerGraphAfter = JSON.parse(await readFile(join(sourceDirectory, ".k-nex", "generated", "resolved-graph.json"), "utf8"));
    assert.equal(providerManifestAfter.plugins.some(({ id }) => id === providerExtension.id), false);
    assert.equal("realtime.gateway" in providerManifestAfter.providers, false);
    assert.equal("@k-nex/provider-realtime-socketio" in providerPackageAfter.dependencies, false);
    assert.equal("node_modules/@k-nex/provider-realtime-socketio" in providerLockAfter.packages, false);
    assert.equal("providerRealtimeSocketio" in providerGraphAfter, false);
    await assert.rejects(readFile(join(sourceDirectory, "src", "k-nex-provider-registry.ts"), "utf8"), { code: "ENOENT" });
    assert.equal((await git(sourceDirectory, ["show", "--format=", "--name-status", providerSource.targetSourceCommit])).stdout.includes("D\tsrc/k-nex-provider-registry.ts"), true);
    assert.equal(providerManifestAfter.plugins.some(({ id }) => id === "module.sales"), true, "Schema-less provider removal must retain the Sales reference domain.");
    builtImages.push({ tag: `knex-p9-customer-alpha:${providerSource.targetSourceCommit.slice(0, 12)}` });
    builderProcess = startTopologyProcess("builder", processEnv("builder", {
      P9_PROCESS_INSTANCE: "builder-provider-uninstall", P9_SOURCE_RESULT_DIGEST: providerSourceReady.sourceResultDigest,
      P9_STAY_ALIVE: "1", P9_READY_TIMEOUT_MS: "480000"
    }));
    topology.push(builderProcess);
    const providerBuilderReady = await waitForBuilderReady(builderProcess, sourceAuthorityProcess, "provider builder");
    const providerBuild = JSON.parse(await readFile(providerBuildResultPath, "utf8"));
    assert.equal(providerBuild.state, "attested");
    assert.equal(providerBuilderReady.buildRequestDigest, providerBuild.buildRequestDigest);
    assert.notEqual(providerBuild.applicationDigest, greenBuild.applicationDigest);
    assert.notEqual(providerBuild.imageDigest, greenBuild.imageDigest);
    assert.deepEqual(
      { baseRevision: providerBuild.change.change.migration.baseRevision, targetRevision: providerBuild.change.change.migration.targetRevision, steps: providerBuild.change.change.migration.steps },
      { baseRevision: 12, targetRevision: 12, steps: [] }
    );
    assert.equal(providerBuild.sbom.components.some(({ name }) => name === "@k-nex/provider-realtime-socketio"), false);
    assert.equal(providerBuild.sbom.components.some(({ name }) => name === "@k-nex/module-sales"), true);
    const providerBuildAuthority = new TrustedStaticApplicationBuildAuthority({
      "builder:k-nex-phase-9": { publicKey: trustedBuilderKeys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: trustedBuilderAuthority }
    });
    const providerBuildToken = providerBuildAuthority.verify(providerBuild.change, providerBuild.evidence);
    Object.assign(processBase, {
      P9_BUILD_REQUEST_DIGEST: providerBuild.buildRequestDigest,
      P9_BUILD_EVIDENCE_DIGEST: providerBuildAuthority.read(providerBuildToken).evidenceDigest,
      P9_APPLICATION_DIGEST: providerBuild.applicationDigest,
      P9_SOURCE_COMMIT: providerSource.targetSourceCommit,
      P9_SOURCE_RESULT_DIGEST: providerSourceReady.sourceResultDigest
    });
    deployerProcess = startTopologyProcess("deployer", processEnv("deployer", { P9_PROCESS_INSTANCE: "deployer-provider-uninstall", P9_STAY_ALIVE: "1" }));
    topology.push(deployerProcess);
    await deployerProcess.ready;
    assert.equal((await deploymentClient.readRequest(providerBuild.buildRequestDigest)).status, "deployment-requested");
    await supervisorProcess.stop();
    supervisorProcess = startTopologyProcess("supervisor", processEnv("supervisor", {
      P9_PROCESS_INSTANCE: "supervisor-provider-uninstall", P9_CONTROL_PORT: String(supervisorPort), P9_DOCKER_NETWORK: network,
      P9_DOCKER_NAMESPACE: network, P9_GATEWAY_URL: processGatewayUrl, P9_STAY_ALIVE: "1"
    }));
    topology.push(supervisorProcess);
    supervisorUrl = (await supervisorProcess.ready).url;
    deploymentBoundary.url = supervisorUrl;
    staticReleases.url = supervisorUrl;
    const providerPlan = {
      schemaVersion: 1, planId: "provider-uninstall-13", operation: "uninstall", version: "1.0.0",
      artifactDigest: providerBuild.change.change.plugin.releaseManifestDigest, expectedRevision: providerRequest.expectedRevision,
      currentGenerationId: providerGeneration.generationId, targetGenerationId: providerGenerationId,
      approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 },
      deliveryClass: "platform-plugin", id: providerExtension.id,
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    };
    const providerStore = new PostgresRuntimeExtensionStore(pool, { now: () => now }, sha256("p9-provider-uninstall-inventory"), {
      authorizationLifecycleProjector: providerAuthorizationProjector,
      sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder()
    });
    const providerManager = new PluginManager(
      "p9-provider-uninstall", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"),
      {
        validate: async (candidate) => { if (candidate.operation === "uninstall") assertPlatformPluginUninstallSupported(providerManifest); },
        plan: async (candidate) => ({ plan: { ...providerPlan, operationId: candidate.operationId }, sourceCommit: targetCommit, generationId: providerGenerationId })
      },
      providerStore,
      { stage: async () => assert.fail("Platform Plugin uninstall must not stage a live artifact."), reverify: async () => false },
      { request: async (request, decision) => {
        assert.equal(request.expectedSourceCommit, targetCommit);
        assert.equal(request.generationId, providerGenerationId);
        assert.deepEqual(decision, providerAuthorization);
        return providerBuild.change;
      } },
      deploymentBoundary,
      undefined,
      { now: () => now }
    );
    const providerApi = new ExtensionOperatorApi(providerManager, { list: async () => [] }, staticReleases, { observe: async () => ({ health: [] }) });
    const providerManagedPlan = await providerApi.plan(providerRequest);
    assert.equal(providerManagedPlan.executionClass, "static-release");
    assert.equal(providerManagedPlan.sourceChange.targetSourceCommit, providerSource.targetSourceCommit);
    assert.equal(providerManagedPlan.deployment.buildRequestDigest, providerBuild.buildRequestDigest);
    trafficProbe.transition("provider-uninstall", [providerGeneration.generationId, providerGenerationId]);
    await trafficProbe.waitForGeneration("provider-uninstall", providerGeneration.generationId);
    const migrationBeforeProviderUninstall = (await pool.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha'")).rows;
    const providerOutcome = await providerApi.uninstall(providerManagedPlan.operationId);
    assert.equal(providerOutcome.outcome, "promoted");
    const providerReceipt = providerOutcome.receipt;
    await trafficProbe.waitForGeneration("provider-uninstall", providerGenerationId);
    assert.deepEqual((await pool.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha'")).rows, migrationBeforeProviderUninstall, "Schema-less uninstall must not mutate database migration authority.");
    assert.deepEqual((await pool.query(
      "select detail->'completedMigrationSteps' completed, (detail->>'migrationRevision')::int revision from p9_static_process_events where event='generation-readiness' and generation_id=$1 order by id desc limit 1",
      [providerGenerationId]
    )).rows, [{ completed: [], revision: 12 }]);
    assert.equal(providerReceipt.previousGenerationId, providerGeneration.generationId);
    assert.equal(providerReceipt.activeGenerationId, providerGenerationId);
    assert.notEqual(providerReceipt.activeGenerationId, providerReceipt.previousGenerationId);
    const providerInventory = await providerManager.inventory(owner.applicationId, owner.environment);
    assert.equal(providerInventory.extensions.platformPlugins[providerExtension.id].disposition, "removed");
    assert.equal((await fetch(`${processGatewayUrl}/p9-authority`).then((response) => response.json())).generation, providerGenerationId);
    assert.equal((await fetch(`${processGatewayUrl}/public`)).ok, true);
    assert.equal((await fetch(`${processGatewayUrl}/inventory`).then((response) => response.json())).generation, providerGenerationId);
    const providerAudit = await pool.query(
      "select event_json->>'operationPhase' phase, event_json->'evidence' evidence from runtime_extension_audit where operation_id=$1 order by revision",
      [providerManagedPlan.operationId]
    );
    assert.deepEqual(providerAudit.rows.map(({ phase }) => phase), ["planning", "source-change-required", "source-change-ready", "completed"]);
    const providerPlannedEvidence = {
      sourceCommit: providerSource.targetSourceCommit,
      compositionChangePlanDigest: providerBuild.change.planDigest,
      buildRequestDigest: providerBuild.buildRequestDigest,
      generationId: providerGenerationId
    };
    assert.deepEqual(providerAudit.rows.slice(0, -1).map(({ evidence }) => evidence), [providerPlannedEvidence, providerPlannedEvidence, providerPlannedEvidence]);
    assert.deepEqual(providerAudit.rows.at(-1).evidence, {
      ...providerPlannedEvidence,
      buildEvidenceDigest: providerReceipt.buildEvidenceDigest,
      applicationDigest: providerReceipt.applicationDigest,
      imageDigest: providerReceipt.imageDigest
    });
    console.log(`P9_SCHEMALESS_PLATFORM_UNINSTALL_EVIDENCE=${JSON.stringify({
      plugin: providerExtension.id, previousGenerationId: providerReceipt.previousGenerationId, activeGenerationId: providerReceipt.activeGenerationId,
      sourceCommit: providerSource.targetSourceCommit, buildEvidenceDigest: providerBuild.evidenceDigest,
      applicationDigest: providerBuild.applicationDigest, imageDigest: providerBuild.imageDigest, sourceGraphRemoved: true, packageClosureRemoved: true
    })}`);
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
    if (attackerNetwork) await cleanup("attacker network", () => docker(["network", "rm", attackerNetwork]));
    const labeledVolumes = await docker(["volume", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.Name}}"]).then(({ stdout }) => stdout.trim().split("\n").filter(Boolean));
    for (const name of labeledVolumes) await cleanup(`labeled volume ${name}`, () => docker(["volume", "rm", "--force", name]));
    weakProfileVolumeName = undefined;
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
    await cleanup("zero labeled volumes assertion", async () => assert.equal((await docker(["volume", "ls", "--filter", `label=p9-fixture=${network}`, "--format", "{{.Name}}"]).then(({ stdout }) => stdout.trim())).length, 0));
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "Phase 9 static deployment fixture cleanup failed.");
  }
  trafficProbe.assertEvidence({
    install: ["customer-alpha-blue-11"],
    update: ["customer-alpha-blue-11", "customer-alpha-green-12"],
    rollback: ["customer-alpha-green-12", "customer-alpha-blue-11"],
    "re-promotion": ["customer-alpha-blue-11", "customer-alpha-green-12"],
    "provider-uninstall": ["customer-alpha-green-12", "customer-alpha-provider-uninstall-13"]
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
