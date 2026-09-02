import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { loadInstalledPlatformPluginManifests, resolvePlatformPluginGraph, writeStaticArtifacts } from "@k-nex/composition";
import { ApplicationManifestSchema, canonicalJson, supportedFrameworkTuple } from "@k-nex/contracts";
import { PostgresStaticCompositionCheckpointStore, PostgresStaticDeploymentStore, PostgresTrustedBuildDeploymentClient } from "@k-nex/payload-adapter";
import { DeterministicStaticCompositionChangeAuthority } from "@k-nex/runtime";
import { runDeploymentSupervisor } from "./deployment-supervisor-process.mjs";

const execute = promisify(execFile);
const role = process.env.P9_PROCESS_ROLE;
const databaseUrl = process.env.DATABASE_URL;
const instance = process.env.P9_PROCESS_INSTANCE;
const generation = process.env.P9_PROCESS_GENERATION;
const controlPort = Number(process.env.P9_CONTROL_PORT);
const fixtureRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryLock = fileURLToPath(new URL("../../../pnpm-lock.yaml", import.meta.url));

if (!role || !databaseUrl || !instance) throw new Error("Phase 9 process topology requires a role, instance, and PostgreSQL authority.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));
const operatorPackages = Object.freeze([
  { name: "@k-nex/contracts", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-contracts-1.0.0.tgz" },
  { name: "@k-nex/composition", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-composition-1.0.0.tgz" },
  { name: "@k-nex/extension-bundler", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-extension-bundler-1.0.0.tgz" },
  { name: "@k-nex/runtime", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-runtime-1.0.0.tgz" },
  { name: "@k-nex/payload-adapter", version: "1.0.0", path: "static-deployment/operator-packages/k-nex-payload-adapter-1.0.0.tgz" }
]);
const sourceFiles = Object.freeze([
  "k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/environment-schema.ts", ".k-nex/generated/k-nex.resolved.json", ".k-nex/generated/payload-contributions.ts", ".k-nex/generated/plugin-registry.ts", ".k-nex/generated/runtime-registration.ts", ".k-nex/generated/resolved-graph.json",
  "tsconfig.json", "src/boot.ts", "src/current-authority.ts", "src/k-nex-readiness.ts", "src/k-nex-registry.ts", "src/payload.config.ts", ...readdirSync(new URL("../src/migrations/", import.meta.url)).sort().map((name) => `src/migrations/${name}`),
  "static-deployment/Dockerfile", "static-deployment/customer-application-gate.mjs", "static-deployment/deployment-supervisor-process.mjs", "static-deployment/healthcheck.mjs", "static-deployment/next.config.mjs", "static-deployment/payload.config.ts", "static-deployment/release-worker.mjs", "static-deployment/release.json", "static-deployment/static-runtime.ts", "static-deployment/topology-process.mjs", "static-deployment/tsconfig.customer.json", "static-deployment/tsconfig.next.json", "static-deployment/web-admin-container.mjs",
  "static-deployment/app/layout.tsx", "static-deployment/app/page.tsx", "static-deployment/app/api/[...slug]/route.ts", "static-deployment/app/[endpoint]/route.ts",
  "static-deployment-migration.ts",
  ...operatorPackages.map(({ path }) => path)
]);
const event = async (name, detail = {}) => {
  const deployment = await pool.query("select revision, active_generation_id from runtime_static_deployments where application_id='customer-alpha' and environment='production'");
  const fence = await pool.query("select fencing_token, active_execution_generation from runtime_worker_generation_fences where application_id='customer-alpha' and environment='production'");
  await pool.query(
    "insert into p9_static_process_events (role, instance_id, event, generation_id, deployment_revision, fencing_token, detail) values ($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [role, instance, name, generation ?? deployment.rows[0]?.active_generation_id ?? null, deployment.rows[0]?.revision ?? null, fence.rows[0]?.fencing_token ?? null, JSON.stringify({ processId: process.pid, ...detail })]
  );
};

const ready = (detail = {}) => process.stdout.write(`${JSON.stringify({ type: "ready", role, instance, ...detail })}\n`);
const stayAlive = () => {
  if (process.env.P9_STAY_ALIVE === "1") setInterval(() => undefined, 60_000);
};

function requiredPath(name) {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name} must be a fixed absolute path.`);
  return value;
}

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${canonicalJson(value)}\n`); }
function artifactWaitTimeoutMs() {
  const raw = process.env.P9_ARTIFACT_WAIT_TIMEOUT_MS;
  const value = Number(raw);
  if (!/^[1-9]\d*$/u.test(raw ?? "") || !Number.isSafeInteger(value) || value > 480_000) {
    throw new Error("P9_ARTIFACT_WAIT_TIMEOUT_MS must be an integer between 1 and 480000.");
  }
  return value;
}
async function waitJson(path, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await readJson(path); }
    catch (error) { if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}.`);
}
async function git(sourceDirectory, args) { return execute("git", args, { cwd: sourceDirectory, maxBuffer: 8 * 1024 * 1024 }); }
async function sourceCommit(sourceDirectory) { return (await git(sourceDirectory, ["rev-parse", "HEAD"])).stdout.trim(); }
async function fileDigest(path) { return sha256(await readFile(path)); }

async function composition(sourceDirectory) {
  const pkg = await readJson(join(sourceDirectory, "package.json"));
  const salesTarball = pkg.dependencies?.["@k-nex/module-sales"]?.replace("file:", "");
  if (salesTarball !== "packages/k-nex-module-sales-1.0.0.tgz") throw new Error("Customer package closure is not an approved module.sales archive.");
  const providerTarball = pkg.dependencies?.["@k-nex/provider-realtime-socketio"]?.replace("file:", "");
  if (providerTarball && providerTarball !== "packages/k-nex-provider-realtime-socketio-1.0.0.tgz") throw new Error("Customer package closure contains an unapproved realtime provider archive.");
  const digests = Object.fromEntries(await Promise.all([...sourceFiles, salesTarball, ...(providerTarball ? ["src/k-nex-provider-registry.ts", providerTarball] : [])].map(async (path) => [path, await fileDigest(join(sourceDirectory, path))])));
  const pluginVersion = (await readJson(join(sourceDirectory, "static-deployment/release.json"))).plugin.version;
  const packageClosure = [{ name: "@k-nex/module-sales", version: pluginVersion, path: salesTarball }, ...(providerTarball ? [{ name: "@k-nex/provider-realtime-socketio", version: "1.0.0", path: providerTarball }] : []), ...operatorPackages]
    .map((item) => ({ ...item, digest: digests[item.path] }));
  return {
    composition: {
      applicationManifestDigest: digests["k-nex.app.json"], lockfileDigest: digests["package-lock.json"], resolvedGraphDigest: digests[".k-nex/generated/resolved-graph.json"],
      generatedRegistriesDigest: digestJson({ customerPayloadRegistry: Object.fromEntries(sourceFiles.filter((path) => path === "tsconfig.json" || path.startsWith("src/") || path.startsWith("static-deployment/app/") || ["static-deployment/customer-application-gate.mjs", "static-deployment/next.config.mjs", "static-deployment/payload.config.ts", "static-deployment/release-worker.mjs", "static-deployment/static-runtime.ts", "static-deployment/tsconfig.customer.json", "static-deployment/tsconfig.next.json"].includes(path)).map((path) => [path, digests[path]])), dockerfile: digests["static-deployment/Dockerfile"], healthcheck: digests["static-deployment/healthcheck.mjs"], topology: digests["static-deployment/topology-process.mjs"], supervisor: digests["static-deployment/deployment-supervisor-process.mjs"], webAdmin: digests["static-deployment/web-admin-container.mjs"] }),
      packageClosureDigest: digestJson(Object.fromEntries(packageClosure.map(({ path, digest }) => [path, digest]))), migrationPlanDigest: digests["static-deployment-migration.ts"]
    },
    digests,
    packageClosure,
    pluginVersion
  };
}

async function regenerateLockAndGraph(sourceDirectory) {
  const npm = "npm";
  await execute(npm, ["install", "--package-lock-only", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: sourceDirectory, maxBuffer: 8 * 1024 * 1024 });
  const lock = await readJson(join(sourceDirectory, "package-lock.json"));
  const sales = lock.packages?.["node_modules/@k-nex/module-sales"];
  if (!sales) throw new Error("Approved module.sales was absent from the regenerated lock.");
  const provider = lock.packages?.["node_modules/@k-nex/provider-realtime-socketio"];
  await writeJson(join(sourceDirectory, ".k-nex", "generated", "resolved-graph.json"), {
    packageLockVersion: lock.lockfileVersion,
    moduleSales: { version: sales.version, resolved: sales.resolved, integrity: sales.integrity },
    ...(provider ? { providerRealtimeSocketio: { version: provider.version, resolved: provider.resolved, integrity: provider.integrity } } : {})
  });
}

async function regenerateStaticArtifacts(sourceDirectory) {
  const applicationManifest = ApplicationManifestSchema.parse(await readJson(join(sourceDirectory, "k-nex.app.json")));
  const prior = await readJson(join(sourceDirectory, ".k-nex", "generated", "k-nex.resolved.json"));
  const framework = {
    core: supportedFrameworkTuple.core,
    payload: supportedFrameworkTuple.payload,
    node: applicationManifest.runtime.node,
    pnpm: applicationManifest.runtime.packageManagerVersion,
    payloadDatabaseAdapter: supportedFrameworkTuple.payloadDatabaseAdapter
  };
  const packages = [...applicationManifest.plugins.map(({ package: name, version }) => ({ name, version })), ...Object.values(applicationManifest.providers).map(({ package: name, version }) => ({ name, version }))]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((entry, index, entries) => index === 0 || entries[index - 1]?.name !== entry.name);
  const installed = loadInstalledPlatformPluginManifests({ applicationRoot: fixtureRoot, lockfilePath: repositoryLock, lockfileImporter: "fixtures/customer-gate-1", packages, framework });
  const resolvedGraph = resolvePlatformPluginGraph({ plugins: applicationManifest.plugins, providers: applicationManifest.providers, installed });
  writeStaticArtifacts(sourceDirectory, { applicationManifest, resolvedGraph, installed, framework, customerConfigFingerprint: prior.customerConfigFingerprint });
}

function staticChangeRequest(source, plan, approved) {
  const operation = approved.operation ?? "update";
  const operationId = approved.operationId;
  if (!/^operation-[0-9a-f]{32}$/u.test(operationId ?? "")) throw new Error("Approved static change is missing its durable lifecycle operation identity.");
  const generationId = approved.generationId ?? "customer-alpha-green-12";
  const sequence = approved.releaseSequence ?? 12;
  return {
    operationId,
    applicationId: source.applicationId,
    environment: source.environment,
    expectedSourceCommit: source.expectedBase,
    generationId,
    plan: {
      schemaVersion: 1, planId: `platform-static-plan-${sequence}`, operationId, operation,
      version: plan.plugin.version, artifactDigest: plan.plugin.releaseManifestDigest, expectedRevision: approved.expectedRevision ?? 0,
      ...(approved.currentGenerationId ? { currentGenerationId: approved.currentGenerationId } : {}),
      targetGenerationId: generationId, approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 },
      deliveryClass: "platform-plugin", id: approved.plugin.id,
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    }
  };
}

async function authorizeSourceChange(sourceDirectory, approved, source, buildResultPath, authorityResultPath, artifactWaitTimeout) {
  const built = await waitJson(buildResultPath, artifactWaitTimeout);
  if (!["built", "attested"].includes(built.state) || built.sourceResultDigest !== await fileDigest(requiredPath("P9_SOURCE_RESULT_PATH"))) throw new Error("Source authority rejected unbound builder materials.");
  const request = staticChangeRequest(source, built.plan, approved);
  const checkpoints = new PostgresStaticCompositionCheckpointStore(pool);
  const checkpointId = digestJson({ authority: approved.authority.identity, actor: approved.authorization.actor, request });
  const existing = await checkpoints.read(checkpointId);
  if (!existing) await git(sourceDirectory, ["checkout", "--quiet", "--detach", source.expectedBase]);
  const repository = {
    current: async () => {
      const current = await sourceCommit(sourceDirectory);
      return { sourceCommit: current, composition: current === source.targetSourceCommit ? source.target : source.base };
    },
    commit: async (expected, change) => {
      if (expected !== source.expectedBase || change.target.sourceCommit !== source.targetSourceCommit) throw new Error("Source authority rejected a commit outside the approved graph.");
      await git(sourceDirectory, ["checkout", "--quiet", "--detach", source.targetSourceCommit]);
      return sourceCommit(sourceDirectory);
    }
  };
  let simulatedCrash = false;
  const authority = new DeterministicStaticCompositionChangeAuthority(
    approved.authority.identity,
    repository,
    { resolve: async () => built.plan },
    {
      read: (id) => checkpoints.read(id),
      save: (checkpoint) => checkpoints.save(checkpoint),
      commit: async (id) => {
        if (!existing && !simulatedCrash) { simulatedCrash = true; throw new Error("simulated source service crash after git commit"); }
        return checkpoints.commit(id);
      }
    }
  );
  if (!existing) {
    try { await authority.request(request, approved.authorization); throw new Error("Source checkpoint crash was not exercised."); }
    catch (error) { if (error.message !== "simulated source service crash after git commit") throw error; }
  }
  const recovered = new DeterministicStaticCompositionChangeAuthority(
    approved.authority.identity,
    {
      current: repository.current,
      commit: async () => { throw new Error("Recovery attempted to duplicate the committed customer source change."); }
    },
    { resolve: async () => { throw new Error("Recovery attempted to replace the durable deterministic plan."); } },
    checkpoints
  );
  const change = await recovered.request(request, approved.authorization);
  const committed = await checkpoints.read(checkpointId);
  if (!committed || committed.status !== "committed") throw new Error("Source authority did not durably commit its checkpoint.");
  if (canonicalJson(await checkpoints.save(committed)) !== canonicalJson(committed)) throw new Error("Identical source checkpoint replay changed durable authority.");
  try {
    await checkpoints.save({ ...committed, change: { ...committed.change, target: { ...committed.change.target, sourceCommit: "c".repeat(40) } } });
    throw new Error("Conflicting source checkpoint was accepted.");
  } catch (error) { if (error.code !== "CHECKPOINT_CONFLICT") throw error; }
  try {
    await recovered.request({ ...request, generationId: `${request.generationId}-conflict` }, approved.authorization);
    throw new Error("Stale-base concurrent source change was accepted.");
  } catch (error) { if (error.code !== "SOURCE_CONFLICT") throw error; }
  await writeJson(authorityResultPath, { checkpointId, change });
  await event("source-change-authorized", { checkpointId, targetSourceCommit: change.targetSourceCommit, recoveredAfterCommit: !existing });
  return { checkpointId, change };
}

async function sourceAuthority() {
  const sourceDirectory = requiredPath("P9_SOURCE_DIRECTORY");
  const approvedPath = requiredPath("P9_APPROVED_INPUT_PATH");
  const resultPath = requiredPath("P9_SOURCE_RESULT_PATH");
  const buildResultPath = requiredPath("P9_BUILD_RESULT_PATH");
  const authorityResultPath = requiredPath("P9_AUTHORITY_RESULT_PATH");
  const artifactWaitTimeout = artifactWaitTimeoutMs();
  const approvedDigest = process.env.P9_APPROVED_INPUT_DIGEST;
  const expectedBase = process.env.P9_EXPECTED_BASE_COMMIT;
  if (!approvedDigest || !/^[0-9a-f]{40}$/u.test(expectedBase ?? "")) throw new Error("Source authority requires fixed approved input and expected base digests.");
  if (await fileDigest(approvedPath) !== approvedDigest) throw new Error("Source authority rejected altered approved input.");
  const approved = await readJson(approvedPath);
  const salesUpdate = approved.plugin?.id === "module.sales" && approved.plugin?.version === "1.0.0" && approved.plugin?.packageSpec === "file:packages/k-nex-module-sales-1.0.0.tgz" && (approved.operation ?? "update") === "update";
  const providerUninstall = approved.plugin?.id === "provider.realtime.socketio" && approved.plugin?.version === "1.0.0" && approved.plugin?.packageSpec === "file:packages/k-nex-provider-realtime-socketio-1.0.0.tgz" && approved.operation === "uninstall";
  if (approved.applicationId !== "customer-alpha" || approved.environment !== "production" || (!salesUpdate && !providerUninstall)) {
    throw new Error("Source authority rejected an unapproved static composition request.");
  }
  const head = await sourceCommit(sourceDirectory);
  if (head === expectedBase) {
    const base = await composition(sourceDirectory);
    const manifestPath = join(sourceDirectory, "k-nex.app.json");
    const manifest = await readJson(manifestPath);
    const plugin = manifest.plugins?.find((candidate) => candidate.id === approved.plugin.id);
    if (!plugin) throw new Error("Approved Platform Plugin is absent from the customer manifest.");
    if (providerUninstall) {
      manifest.plugins = manifest.plugins.filter((candidate) => candidate.id !== approved.plugin.id);
      delete manifest.providers["realtime.gateway"];
      delete manifest.runtime.realtime;
    } else plugin.version = approved.plugin.version;
    await writeJson(manifestPath, manifest);
    const packagePath = join(sourceDirectory, "package.json");
    const pkg = await readJson(packagePath);
    if (providerUninstall) delete pkg.dependencies["@k-nex/provider-realtime-socketio"];
    else pkg.dependencies["@k-nex/module-sales"] = approved.plugin.packageSpec;
    await writeJson(packagePath, pkg);
    if (providerUninstall) await rm(join(sourceDirectory, "src", "k-nex-provider-registry.ts"));
    const releasePath = join(sourceDirectory, "static-deployment", "release.json");
    if (!providerUninstall) {
      const release = await readJson(releasePath);
      release.plugin.version = approved.plugin.version;
      release.generationId = approved.generationId ?? "customer-alpha-green-12";
      await writeJson(releasePath, release);
    }
    await regenerateLockAndGraph(sourceDirectory);
    await regenerateStaticArtifacts(sourceDirectory);
    const mutated = (await git(sourceDirectory, ["diff", "--name-only", "--no-renames", "HEAD"])).stdout
      .trim().split("\n").filter(Boolean).sort();
    if (mutated.length === 0) throw new Error("Source authority rejected an empty approved composition change.");
    await git(sourceDirectory, ["add", "--all"]);
    await git(sourceDirectory, ["commit", "--quiet", "-m", providerUninstall ? "customer: uninstall realtime provider" : "customer: rebuild module.sales 1.0.0"]);
    const targetSourceCommit = await sourceCommit(sourceDirectory);
    const target = await composition(sourceDirectory);
    const result = { schemaVersion: 1, applicationId: approved.applicationId, environment: approved.environment, expectedBase, targetSourceCommit, base: base.composition, target: target.composition, plugin: { id: approved.plugin.id, version: approved.plugin.version }, approvedInputDigest: approvedDigest, mutated };
    await writeJson(resultPath, result);
    await event("source-committed", {
      expectedBase, targetSourceCommit, approvedInputDigest: approvedDigest,
      mutated
    });
    ready({ sourceCommit: targetSourceCommit, sourceResultDigest: await fileDigest(resultPath) });
    await authorizeSourceChange(sourceDirectory, approved, result, buildResultPath, authorityResultPath, artifactWaitTimeout);
  } else {
    const result = await readJson(resultPath);
    if (head !== result.targetSourceCommit || result.expectedBase !== expectedBase || result.approvedInputDigest !== approvedDigest) throw new Error("Source authority recovery rejected checkout or source result drift.");
    const authorized = await authorizeSourceChange(sourceDirectory, approved, result, buildResultPath, authorityResultPath, artifactWaitTimeout);
    await event("source-recovered", { sourceCommit: head, sourceResultDigest: await fileDigest(resultPath), checkpointId: authorized.checkpointId });
    ready({ sourceCommit: head, sourceResultDigest: await fileDigest(resultPath), checkpointId: authorized.checkpointId });
  }
  stayAlive();
}

async function builder() {
  const sourceDirectory = requiredPath("P9_SOURCE_DIRECTORY");
  const approvedPath = requiredPath("P9_APPROVED_INPUT_PATH");
  const sourceResultPath = requiredPath("P9_SOURCE_RESULT_PATH");
  const resultPath = requiredPath("P9_BUILD_RESULT_PATH");
  const authorityResultPath = requiredPath("P9_AUTHORITY_RESULT_PATH");
  const artifactsDirectory = requiredPath("P9_ARTIFACTS_DIRECTORY");
  const signingKeyPath = requiredPath("P9_BUILDER_SIGNING_KEY_PATH");
  const trustPolicyPath = requiredPath("P9_BUILDER_TRUST_POLICY_PATH");
  const artifactWaitTimeout = artifactWaitTimeoutMs();
  const approvedDigest = process.env.P9_APPROVED_INPUT_DIGEST;
  const sourceResultDigest = process.env.P9_SOURCE_RESULT_DIGEST;
  if (!approvedDigest || !sourceResultDigest || await fileDigest(approvedPath) !== approvedDigest || await fileDigest(sourceResultPath) !== sourceResultDigest) throw new Error("Builder rejected altered fixed source/build inputs.");
  const approved = await readJson(approvedPath);
  const source = await readJson(sourceResultPath);
  if (source.applicationId !== approved.applicationId || source.environment !== approved.environment || source.plugin.id !== approved.plugin.id || source.plugin.version !== approved.plugin.version || await sourceCommit(sourceDirectory) !== source.targetSourceCommit) {
    throw new Error("Builder rejected a source result not bound to its approved customer checkout.");
  }
  if (process.env.P9_BUILD_REQUEST_DIGEST) {
    const existing = await readJson(resultPath);
    const releases = new PostgresTrustedBuildDeploymentClient(pool);
    const request = await releases.readRequest(process.env.P9_BUILD_REQUEST_DIGEST);
    if (!request || request.status === "build-requested" || request.imageDigest !== existing.imageDigest || request.sourceCommit !== existing.change.targetSourceCommit) throw new Error("Builder recovery rejected durable build authority.");
    const inspection = JSON.parse((await execute("docker", ["image", "inspect", existing.imageDigest], { maxBuffer: 1024 * 1024 })).stdout)[0];
    if (inspection.Id !== existing.imageDigest) throw new Error("Builder recovery rejected immutable image identity.");
    await event("builder-recovered", { imageDigest: existing.imageDigest, sourceCommit: existing.change.targetSourceCommit });
    ready({ imageDigest: existing.imageDigest, buildRequestDigest: process.env.P9_BUILD_REQUEST_DIGEST });
    stayAlive();
    return;
  }
  const materials = await composition(sourceDirectory);
  const applicationBundle = Buffer.from(canonicalJson({ sourceCommit: source.targetSourceCommit, files: materials.digests }));
  await mkdir(artifactsDirectory, { recursive: true });
  const applicationPath = join(artifactsDirectory, `${source.targetSourceCommit}.application.json`);
  await writeFile(applicationPath, applicationBundle);
  const applicationDigest = sha256(applicationBundle);
  const tag = `knex-p9-customer-alpha:${source.targetSourceCommit.slice(0, 12)}`;
  const imageGenerationId = (await readJson(join(sourceDirectory, "static-deployment", "release.json"))).generationId;
  if (typeof imageGenerationId !== "string" || imageGenerationId.length === 0) throw new Error("Builder requires immutable image generation metadata.");
  const fixtureLabel = process.env.P9_FIXTURE_LABEL;
  if (!fixtureLabel) throw new Error("P9_FIXTURE_LABEL is required by the trusted builder.");
  await execute("docker", ["build", "--pull=false", "--file", "static-deployment/Dockerfile", "--tag", tag, "--build-arg", `K_NEX_SOURCE_COMMIT=${source.targetSourceCommit}`, "--build-arg", `K_NEX_APPLICATION_DIGEST=${applicationDigest}`, "--build-arg", `K_NEX_IMAGE_GENERATION=${imageGenerationId}`, "--build-arg", `K_NEX_FIXTURE_LABEL=${fixtureLabel}`, "."], { cwd: sourceDirectory, maxBuffer: 8 * 1024 * 1024 });
  const inspection = JSON.parse((await execute("docker", ["image", "inspect", tag], { maxBuffer: 1024 * 1024 })).stdout)[0];
  const imageDigest = inspection.Id;
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageDigest) || inspection.Config.Labels["org.opencontainers.image.revision"] !== source.targetSourceCommit || inspection.Config.Labels["dev.k-nex.application-digest"] !== applicationDigest || inspection.Config.Labels["dev.k-nex.image-generation"] !== imageGenerationId) throw new Error("Builder rejected immutable image labels or digest.");
  const sbom = { bomFormat: "CycloneDX", components: materials.packageClosure.map(({ name, version, digest }) => ({ name, version, hashes: [{ alg: "SHA-256", content: digest.slice(7) }] })), sourceCommit: source.targetSourceCommit };
  const sbomPath = join(artifactsDirectory, `${source.targetSourceCommit}.sbom.json`);
  await writeJson(sbomPath, sbom);
  const trustPolicy = await readJson(trustPolicyPath);
  const signingKey = await readFile(signingKeyPath, "utf8");
  const authority = trustPolicy.authority;
  if (trustPolicy.builderIdentity !== "builder:k-nex-phase-9" || authority?.builderIdentity !== trustPolicy.builderIdentity || typeof trustPolicy.publicKey !== "string" || !trustPolicy.publicKey.includes("BEGIN PUBLIC KEY") || !signingKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Builder rejected an independently provisioned trust policy or signing identity.");
  }
  const sequence = approved.releaseSequence ?? 12;
  const migrationFree = approved.operation === "uninstall" && approved.plugin.id === "provider.realtime.socketio";
  const plan = {
    schemaVersion: 1, planId: `composition-plan-${sequence}`, applicationId: approved.applicationId, environment: approved.environment, deliveryClass: "platform-plugin",
    plugin: { id: source.plugin.id, version: source.plugin.version, releaseManifestDigest: source.target.packageClosureDigest }, authority: { identity: approved.authority.identity, requestDigest: approved.authorization.decisionId },
    base: { sourceCommit: source.expectedBase, composition: source.base }, target: { sourceCommit: source.targetSourceCommit, composition: source.target, applicationSubjectDigest: applicationDigest, imageSubjectDigest: imageDigest },
    migration: { planId: `migration-plan-${sequence}`, applicationId: approved.applicationId, environment: approved.environment, sourceCommit: source.expectedBase, targetSourceCommit: source.targetSourceCommit, baseRevision: migrationFree ? 12 : 11, targetRevision: 12,
      steps: migrationFree ? [] : [
        { stepId: "migration-expand-12", phase: "online-expand", migrationDigest: source.target.migrationPlanDigest, overlapSafe: true },
        { stepId: "migration-backfill-12", phase: "online-backfill", migrationDigest: source.target.migrationPlanDigest, resumable: true, idempotent: true, checkpointSchemaDigest: source.target.migrationPlanDigest },
        { stepId: "migration-contract-12", phase: "post-retirement-contract", migrationDigest: source.target.migrationPlanDigest, requiresOldGenerationRetired: true, requiresRollbackWindowClosed: true }
      ], rollbackWindow: { state: "open", windowId: `rollback-window-${sequence}`, previousApplicationDigest: approved.baseApplicationDigest, closesAt: approved.rollbackClosesAt, contractCleanup: "blocked" }
    }, status: "source-change-ready"
  };
  const provenance = { applicationDigest, imageDigest, sourceCommit: source.targetSourceCommit, composition: source.target, builder: "fixture-static-builder" };
  const provenancePath = join(artifactsDirectory, `${source.targetSourceCommit}.provenance.json`);
  await writeJson(provenancePath, provenance);
  const statement = { schemaVersion: 1, applicationId: approved.applicationId, environment: approved.environment, sourceCommit: source.targetSourceCommit, authority, composition: source.target, sbomDigest: await fileDigest(sbomPath), provenanceDigest: await fileDigest(provenancePath), applicationSubject: { name: "customer-alpha.application.json", digest: applicationDigest }, imageSubject: { repository: "knex-p9-customer-alpha", digest: imageDigest } };
  const evidence = { ...statement, signature: { algorithm: "ed25519", keyId: trustPolicy.builderIdentity, value: sign(null, Buffer.from(canonicalJson(statement)), signingKey).toString("base64") } };
  await writeJson(resultPath, { state: "built", sourceResultDigest, plan, evidence, applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, tag, sbom, sbomPath, provenance, provenancePath, composition: source.target, pluginVersion: source.plugin.version });
  const authorized = await waitJson(authorityResultPath, artifactWaitTimeout);
  const request = staticChangeRequest(source, plan, approved);
  if (authorized.checkpointId !== digestJson({ authority: approved.authority.identity, actor: approved.authorization.actor, request }) || canonicalJson(authorized.change.change) !== canonicalJson(plan)) {
    throw new Error("Builder rejected an unbound source authority checkpoint.");
  }
  const change = authorized.change;
  const releases = new PostgresTrustedBuildDeploymentClient(pool);
  const deployment = await releases.request(change, approved.authorization, request.operationId);
  const evidenceDigest = digestJson(evidence);
  await releases.attestBuild({ buildRequestDigest: deployment.buildRequestDigest, expectedVersion: source.plugin.version, sourceCommit: source.targetSourceCommit, buildEvidenceDigest: evidenceDigest, applicationDigest, imageDigest });
  const result = { state: "attested", sourceResultDigest, plan, checkpointId: authorized.checkpointId, change, evidence, evidenceDigest, buildRequestDigest: deployment.buildRequestDigest, applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, tag, sbom, sbomPath, provenance, provenancePath, composition: source.target, pluginVersion: source.plugin.version };
  await writeJson(resultPath, result);
  await event("builder-built-and-attested", { sourceCommit: source.targetSourceCommit, imageDigest, applicationDigest, buildRequestDigest: deployment.buildRequestDigest, evidenceDigest });
  ready({ imageDigest, applicationDigest, buildRequestDigest: deployment.buildRequestDigest, buildResultDigest: await fileDigest(resultPath) });
  stayAlive();
}

async function observeAuthority() {
  const requestDigest = process.env.P9_BUILD_REQUEST_DIGEST;
  if (!requestDigest) throw new Error(`${role} process is missing its durable release request identity.`);
  const releases = new PostgresTrustedBuildDeploymentClient(pool);
  let authority = await releases.readRequest(requestDigest);
  if (!authority || !["builder-attested", "deployment-requested", "deployed"].includes(authority.status)) throw new Error(`${role} process cannot recover an attested PostgreSQL release authority.`);
  if (role === "deployer" && authority.status === "builder-attested") {
    const built = await readJson(requiredPath("P9_BUILD_RESULT_PATH"));
    const image = JSON.parse((await execute("docker", ["image", "inspect", built.imageDigest], { maxBuffer: 1024 * 1024 })).stdout)[0];
    if (image.Id !== authority.imageDigest || image.Config.Labels?.["org.opencontainers.image.revision"] !== authority.sourceCommit) {
      throw new Error("Deployer rejected a local image that does not match the independently attested source authority.");
    }
    authority = await releases.requestDeployment({ buildRequestDigest: requestDigest, expectedVersion: authority.version });
    await event("deployer-artifact-reverified", { imageDigest: image.Id, sourceCommit: authority.sourceCommit, operation: "content-addressed-pull-reverify" });
  }
  const deployment = await pool.query("select revision, active_generation from runtime_static_deployments where application_id='customer-alpha' and environment='production'");
  const active = deployment.rows[0]?.active_generation;
  if (role === "supervisor" && authority.status === "deployment-requested" && active?.sourceCommit === authority.sourceCommit && active?.imageDigest === authority.imageDigest) {
    const receipt = await pool.query("select event_json from runtime_static_deployment_outbox where application_id='customer-alpha' and environment='production' and revision=$1", [deployment.rows[0].revision]);
    if (receipt.rows.length !== 1) throw new Error("Supervisor process cannot recover the authoritative deployment receipt.");
    authority = await releases.recordDeployment({ buildRequestDigest: requestDigest, expectedVersion: authority.version, receipt: receipt.rows[0].event_json });
  }
  await event(`${role}-recovered`, authority);
  ready(authority);
  stayAlive();
}

async function worker() {
  const effectId = process.env.P9_EFFECT_ID;
  const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date() });
  let effectHandled = false;
  await event("worker-passive");
  ready({ mode: "passive" });
  const tick = async () => {
    const fence = await pool.query("select fencing_token, active_execution_generation from runtime_worker_generation_fences where application_id='customer-alpha' and environment='production'");
    const active = fence.rows[0]?.active_execution_generation === generation;
    await event(active ? "worker-active" : "worker-passive", { active });
    if (active && effectId && !effectHandled) {
      const claim = await store.claimEffect({ applicationId: "customer-alpha", environment: "production", effectId, generationId: generation, fencingToken: Number(fence.rows[0].fencing_token), claimantId: instance, claimLeaseDurationMs: 120_000 });
      if (claim.status === "claimed") {
        const resultDigest = `sha256:${createHash("sha256").update(`${effectId}:${generation}`).digest("hex")}`;
        await event("worker-effect-authorized", { effectId, claimToken: claim.claimToken });
        await store.completeEffect({ applicationId: "customer-alpha", environment: "production", effectId, generationId: generation, fencingToken: Number(fence.rows[0].fencing_token), claimToken: claim.claimToken, resultDigest });
        await event("worker-effect-completed", { effectId, resultDigest });
      } else await event("worker-effect-already-completed", { effectId });
      effectHandled = true;
    }
  };
  await tick();
  setInterval(() => { tick().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }); }, 40).unref();
}

async function gateway() {
  const server = createServer(async (request, response) => {
    try {
      const state = await pool.query("select d.revision, public.k_nex_static_serving_generation(d.application_id,d.environment) active_generation_id from runtime_static_deployments d where application_id='customer-alpha' and environment='production'");
      const current = state.rows[0];
      if (!current) throw new Error("No active PostgreSQL deployment authority.");
      if (request.url === "/p9-authority") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ generation: current.active_generation_id, revision: current.revision }));
        return;
      }
      const target = await pool.query(
        "select url from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
        ["customer-alpha", "production", current.active_generation_id]
      );
      if (!target.rows[0]) throw new Error("Active generation has no registered target.");
      const method = request.method ?? "GET";
      const upstream = await fetch(`${target.rows[0].url}${request.url}`, {
        method,
        headers: request.headers,
        ...(method === "GET" || method === "HEAD" ? {} : { body: request, duplex: "half" })
      });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "text/plain" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(controlPort, "127.0.0.1", resolve); });
  await event("gateway-recovered");
  ready({ url: `http://127.0.0.1:${server.address().port}` });
}

async function realtime() {
  const gatewayUrl = process.env.P9_GATEWAY_URL;
  if (!gatewayUrl) throw new Error("Realtime process is missing its fixed gateway URL.");
  let observed = -1;
  const tick = async () => {
    const response = await fetch(`${gatewayUrl}/p9-authority`);
    if (!response.ok) throw new Error(`Realtime reconnect failed with ${response.status}.`);
    const authority = await response.json();
    if (authority.revision > observed) {
      observed = authority.revision;
      await event("realtime-resynced", authority);
    }
  };
  await tick();
  ready({ revision: observed });
  setInterval(() => { tick().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }); }, 40).unref();
}

async function webAdmin() {
  // This is deliberately a separate, long-lived binary from source/build/deploy.
  // Its database login can read the reconciled inventory only; authoritative
  // source, build, Docker, and deployment tables must remain unavailable.
  let denied = false;
  try { await pool.query("select * from runtime_static_release_requests"); }
  catch (error) { denied = error && error.code === "42501"; }
  if (!denied) throw new Error("Web/admin process received static deployment authority.");
  const server = createServer(async (request, response) => {
    if (request.url !== "/p9-admin-status") { response.writeHead(404).end(); return; }
    try {
      const inventory = await pool.query("select revision from runtime_extension_inventory_revisions where application_id='customer-alpha' and environment='production'");
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ deniedAuthority: true, inventoryRevision: inventory.rows[0]?.revision ?? 0 }));
    } catch (error) { response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(controlPort, "127.0.0.1", resolve); });
  await event("web-admin-authority-denied", { deniedTables: ["runtime_static_release_requests", "runtime_static_composition_checkpoints"] });
  ready({ url: `http://127.0.0.1:${server.address().port}`, deniedAuthority: true });
}

async function artifactWaitProbe() {
  const artifactWaitTimeout = artifactWaitTimeoutMs();
  const path = requiredPath("P9_ARTIFACT_WAIT_PROBE_PATH");
  ready({ artifactWaitTimeout, waitingForArtifact: true });
  const artifact = await waitJson(path, artifactWaitTimeout);
  process.stdout.write(`${JSON.stringify({ type: "artifact-wait-complete", artifactWaitTimeout, artifact })}\n`);
}

if (role === "source-authority") await sourceAuthority();
else if (role === "builder") await builder();
else if (role === "deployer") await observeAuthority();
else if (role === "supervisor") await runDeploymentSupervisor({ event, ready });
else if (role === "worker") await worker();
else if (role === "gateway") await gateway();
else if (role === "realtime-client") await realtime();
else if (role === "web-admin") await webAdmin();
else if (role === "artifact-wait-probe") await artifactWaitProbe();
else throw new Error(`Unknown Phase 9 topology role: ${role}`);
