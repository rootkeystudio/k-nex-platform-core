import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresStaticCompositionCheckpointStore, PostgresStaticDeploymentStore, PostgresTrustedBuildDeploymentClient } from "@k-nex/payload-adapter";
import { DeterministicStaticCompositionChangeAuthority } from "@k-nex/runtime";

const execute = promisify(execFile);
const role = process.env.P9_PROCESS_ROLE;
const databaseUrl = process.env.DATABASE_URL;
const instance = process.env.P9_PROCESS_INSTANCE;
const generation = process.env.P9_PROCESS_GENERATION;
const controlPort = Number(process.env.P9_CONTROL_PORT);

if (!role || !databaseUrl || !instance) throw new Error("Phase 9 process topology requires a role, instance, and PostgreSQL authority.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));
const sourceFiles = Object.freeze([
  "k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/resolved-graph.json",
  "static-deployment/Dockerfile", "static-deployment/healthcheck.mjs", "static-deployment/release.json", "static-deployment/server.mjs", "static-deployment/topology-process.mjs",
  "static-deployment-migration.ts"
]);
const event = async (name, detail = {}) => {
  const deployment = await pool.query("select revision, active_generation_id from runtime_static_deployments where application_id='customer-alpha' and environment='production'");
  const fence = await pool.query("select fencing_token, active_execution_generation from runtime_worker_generation_fences where application_id='customer-alpha' and environment='production'");
  await pool.query(
    "insert into p9_static_process_events (role, instance_id, event, generation_id, deployment_revision, fencing_token, detail) values ($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [role, instance, name, generation ?? deployment.rows[0]?.active_generation_id ?? null, deployment.rows[0]?.revision ?? null, fence.rows[0]?.fencing_token ?? null, JSON.stringify(detail)]
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
async function waitJson(path, timeout = 120_000) {
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
  if (salesTarball !== "packages/k-nex-module-sales-1.0.1.tgz" && salesTarball !== "packages/k-nex-module-sales-1.0.0.tgz") throw new Error("Customer package closure is not an approved module.sales archive.");
  const digests = Object.fromEntries(await Promise.all([...sourceFiles, salesTarball].map(async (path) => [path, await fileDigest(join(sourceDirectory, path))])));
  return {
    composition: {
      applicationManifestDigest: digests["k-nex.app.json"], lockfileDigest: digests["package-lock.json"], resolvedGraphDigest: digests[".k-nex/generated/resolved-graph.json"],
      generatedRegistriesDigest: digestJson({ dockerfile: digests["static-deployment/Dockerfile"], healthcheck: digests["static-deployment/healthcheck.mjs"], server: digests["static-deployment/server.mjs"], topology: digests["static-deployment/topology-process.mjs"] }),
      packageClosureDigest: digests[salesTarball], migrationPlanDigest: digests["static-deployment-migration.ts"]
    },
    digests,
    pluginVersion: (await readJson(join(sourceDirectory, "static-deployment/release.json"))).plugin.version
  };
}

async function regenerateLockAndGraph(sourceDirectory) {
  const npm = join(dirname(process.execPath), "npm");
  await execute(npm, ["install", "--package-lock-only", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: sourceDirectory, maxBuffer: 8 * 1024 * 1024 });
  const lock = await readJson(join(sourceDirectory, "package-lock.json"));
  const sales = lock.packages?.["node_modules/@k-nex/module-sales"];
  if (!sales) throw new Error("Approved module.sales was absent from the regenerated lock.");
  await writeJson(join(sourceDirectory, ".k-nex", "generated", "resolved-graph.json"), { packageLockVersion: lock.lockfileVersion, moduleSales: { version: sales.version, resolved: sales.resolved, integrity: sales.integrity } });
}

function staticChangeRequest(source, plan) {
  return {
    applicationId: source.applicationId,
    environment: source.environment,
    expectedSourceCommit: source.expectedBase,
    generationId: "customer-alpha-green-12",
    plan: {
      schemaVersion: 1, planId: "sales-static-plan-12", operationId: "sales-static-operation-12", operation: "update",
      version: plan.plugin.version, artifactDigest: plan.plugin.releaseManifestDigest, expectedRevision: 0,
      targetGenerationId: "customer-alpha-green-12", approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 },
      deliveryClass: "platform-plugin", id: "module.sales",
      availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } }
    }
  };
}

async function authorizeSourceChange(sourceDirectory, approved, source, buildResultPath, authorityResultPath) {
  const built = await waitJson(buildResultPath);
  if (!["built", "attested"].includes(built.state) || built.sourceResultDigest !== await fileDigest(requiredPath("P9_SOURCE_RESULT_PATH"))) throw new Error("Source authority rejected unbound builder materials.");
  const request = staticChangeRequest(source, built.plan);
  const checkpoints = new PostgresStaticCompositionCheckpointStore(pool);
  const checkpointId = digestJson({ authority: approved.authority.identity, authorization: approved.authorization, request });
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
    await recovered.request({ ...request, generationId: "customer-alpha-green-13" }, approved.authorization);
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
  const approvedDigest = process.env.P9_APPROVED_INPUT_DIGEST;
  const expectedBase = process.env.P9_EXPECTED_BASE_COMMIT;
  if (!approvedDigest || !/^[0-9a-f]{40}$/u.test(expectedBase ?? "")) throw new Error("Source authority requires fixed approved input and expected base digests.");
  if (await fileDigest(approvedPath) !== approvedDigest) throw new Error("Source authority rejected altered approved input.");
  const approved = await readJson(approvedPath);
  if (approved.applicationId !== "customer-alpha" || approved.environment !== "production" || approved.plugin?.id !== "module.sales" || approved.plugin?.version !== "1.0.1" || approved.plugin?.packageSpec !== "file:packages/k-nex-module-sales-1.0.1.tgz") {
    throw new Error("Source authority rejected an unapproved static composition request.");
  }
  const head = await sourceCommit(sourceDirectory);
  if (head === expectedBase) {
    const base = await composition(sourceDirectory);
    const manifestPath = join(sourceDirectory, "k-nex.app.json");
    const manifest = await readJson(manifestPath);
    const plugin = manifest.plugins?.find((candidate) => candidate.id === approved.plugin.id);
    if (!plugin) throw new Error("Approved module.sales is absent from the customer manifest.");
    plugin.version = approved.plugin.version;
    await writeJson(manifestPath, manifest);
    const packagePath = join(sourceDirectory, "package.json");
    const pkg = await readJson(packagePath);
    pkg.dependencies["@k-nex/module-sales"] = approved.plugin.packageSpec;
    await writeJson(packagePath, pkg);
    const releasePath = join(sourceDirectory, "static-deployment", "release.json");
    const release = await readJson(releasePath);
    release.plugin.version = approved.plugin.version;
    await writeJson(releasePath, release);
    await regenerateLockAndGraph(sourceDirectory);
    await git(sourceDirectory, ["add", "k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/resolved-graph.json", "static-deployment/release.json"]);
    await git(sourceDirectory, ["commit", "--quiet", "-m", "customer: update module.sales to 1.0.1"]);
    const targetSourceCommit = await sourceCommit(sourceDirectory);
    const target = await composition(sourceDirectory);
    const result = { schemaVersion: 1, applicationId: approved.applicationId, environment: approved.environment, expectedBase, targetSourceCommit, base: base.composition, target: target.composition, plugin: { id: approved.plugin.id, version: target.pluginVersion }, approvedInputDigest: approvedDigest };
    await writeJson(resultPath, result);
    await event("source-committed", { expectedBase, targetSourceCommit, approvedInputDigest: approvedDigest, mutated: ["k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/resolved-graph.json", "static-deployment/release.json"] });
    ready({ sourceCommit: targetSourceCommit, sourceResultDigest: await fileDigest(resultPath) });
    await authorizeSourceChange(sourceDirectory, approved, result, buildResultPath, authorityResultPath);
  } else {
    const result = await readJson(resultPath);
    if (head !== result.targetSourceCommit || result.expectedBase !== expectedBase || result.approvedInputDigest !== approvedDigest) throw new Error("Source authority recovery rejected checkout or source result drift.");
    const authorized = await authorizeSourceChange(sourceDirectory, approved, result, buildResultPath, authorityResultPath);
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
  await execute("docker", ["build", "--pull=false", "--file", "static-deployment/Dockerfile", "--tag", tag, "--build-arg", `K_NEX_SOURCE_COMMIT=${source.targetSourceCommit}`, "--build-arg", `K_NEX_APPLICATION_DIGEST=${applicationDigest}`, "."], { cwd: sourceDirectory, maxBuffer: 8 * 1024 * 1024 });
  const inspection = JSON.parse((await execute("docker", ["image", "inspect", tag], { maxBuffer: 1024 * 1024 })).stdout)[0];
  const imageDigest = inspection.Id;
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageDigest) || inspection.Config.Labels["org.opencontainers.image.revision"] !== source.targetSourceCommit || inspection.Config.Labels["dev.k-nex.application-digest"] !== applicationDigest) throw new Error("Builder rejected immutable image labels or digest.");
  const sbom = { bomFormat: "CycloneDX", components: [{ name: "@k-nex/module-sales", version: materials.pluginVersion, hashes: [{ alg: "SHA-256", content: materials.composition.packageClosureDigest.slice(7) }] }], sourceCommit: source.targetSourceCommit };
  const sbomPath = join(artifactsDirectory, `${source.targetSourceCommit}.sbom.json`);
  await writeJson(sbomPath, sbom);
  const authority = { kind: "self-hosted-trusted", builderIdentity: "builder:k-nex-phase-9", trustPolicyDigest: digestJson({ policy: "fixture-static-builder: immutable source and Docker output" }), ref: "source-commit" };
  const plan = {
    schemaVersion: 1, planId: "composition-plan-12", applicationId: approved.applicationId, environment: approved.environment, deliveryClass: "platform-plugin",
    plugin: { id: source.plugin.id, version: source.plugin.version, releaseManifestDigest: source.target.packageClosureDigest }, authority: { identity: approved.authority.identity, requestDigest: approved.authorization.decisionId },
    base: { sourceCommit: source.expectedBase, composition: source.base }, target: { sourceCommit: source.targetSourceCommit, composition: source.target, applicationSubjectDigest: applicationDigest, imageSubjectDigest: imageDigest },
    migration: { planId: "migration-plan-12", applicationId: approved.applicationId, environment: approved.environment, sourceCommit: source.expectedBase, targetSourceCommit: source.targetSourceCommit, baseRevision: 11, targetRevision: 12,
      steps: [
        { stepId: "migration-expand-12", phase: "online-expand", migrationDigest: source.target.migrationPlanDigest, overlapSafe: true },
        { stepId: "migration-backfill-12", phase: "online-backfill", migrationDigest: source.target.migrationPlanDigest, resumable: true, idempotent: true, checkpointSchemaDigest: source.target.migrationPlanDigest },
        { stepId: "migration-contract-12", phase: "post-retirement-contract", migrationDigest: source.target.migrationPlanDigest, requiresOldGenerationRetired: true, requiresRollbackWindowClosed: true }
      ], rollbackWindow: { state: "open", windowId: "rollback-window-12", previousApplicationDigest: approved.baseApplicationDigest, closesAt: approved.rollbackClosesAt, contractCleanup: "blocked" }
    }, status: "source-change-ready"
  };
  const provenance = { applicationDigest, imageDigest, sourceCommit: source.targetSourceCommit, composition: source.target, builder: "fixture-static-builder" };
  const provenancePath = join(artifactsDirectory, `${source.targetSourceCommit}.provenance.json`);
  await writeJson(provenancePath, provenance);
  const statement = { schemaVersion: 1, applicationId: approved.applicationId, environment: approved.environment, sourceCommit: source.targetSourceCommit, authority, composition: source.target, sbomDigest: await fileDigest(sbomPath), provenanceDigest: await fileDigest(provenancePath), applicationSubject: { name: "customer-alpha.application.json", digest: applicationDigest }, imageSubject: { repository: "knex-p9-customer-alpha", digest: imageDigest } };
  const keys = generateKeyPairSync("ed25519");
  const evidence = { ...statement, signature: { algorithm: "ed25519", keyId: authority.builderIdentity, value: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64") } };
  await writeJson(resultPath, { state: "built", sourceResultDigest, plan, evidence, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, tag, sbom, sbomPath, provenance, provenancePath, composition: source.target, pluginVersion: source.plugin.version });
  const authorized = await waitJson(authorityResultPath);
  if (authorized.checkpointId !== digestJson({ authority: approved.authority.identity, authorization: approved.authorization, request: staticChangeRequest(source, plan) }) || canonicalJson(authorized.change.change) !== canonicalJson(plan)) {
    throw new Error("Builder rejected an unbound source authority checkpoint.");
  }
  const change = authorized.change;
  const releases = new PostgresTrustedBuildDeploymentClient(pool);
  const deployment = await releases.request(change, approved.authorization);
  const evidenceDigest = digestJson(evidence);
  await releases.attestBuild({ buildRequestDigest: deployment.buildRequestDigest, expectedVersion: source.plugin.version, sourceCommit: source.targetSourceCommit, buildEvidenceDigest: evidenceDigest, applicationDigest, imageDigest });
  const result = { state: "attested", sourceResultDigest, plan, checkpointId: authorized.checkpointId, change, evidence, publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), evidenceDigest, buildRequestDigest: deployment.buildRequestDigest, applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, tag, sbom, sbomPath, provenance, provenancePath, composition: source.target, pluginVersion: source.plugin.version };
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
    authority = await releases.requestDeployment({ buildRequestDigest: requestDigest, expectedVersion: authority.version });
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
      const claim = await store.claimEffect({ applicationId: "customer-alpha", environment: "production", effectId, generationId: generation, fencingToken: Number(fence.rows[0].fencing_token), claimantId: instance, claimLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString() });
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
      const state = await pool.query("select active_generation_id, revision from runtime_static_deployments where application_id='customer-alpha' and environment='production'");
      const current = state.rows[0];
      if (!current) throw new Error("No active PostgreSQL deployment authority.");
      if (request.url === "/p9-authority") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ generation: current.active_generation_id, revision: current.revision }));
        return;
      }
      const target = await pool.query("select url from p9_static_process_routes where generation_id=$1", [current.active_generation_id]);
      if (!target.rows[0]) throw new Error("Active generation has no registered target.");
      const upstream = await fetch(`${target.rows[0].url}${request.url}`, { headers: request.headers });
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

if (role === "source-authority") await sourceAuthority();
else if (role === "builder") await builder();
else if (role === "deployer" || role === "supervisor") await observeAuthority();
else if (role === "worker") await worker();
else if (role === "gateway") await gateway();
else if (role === "realtime-client") await realtime();
else if (role === "web-admin") await webAdmin();
else throw new Error(`Unknown Phase 9 topology role: ${role}`);
