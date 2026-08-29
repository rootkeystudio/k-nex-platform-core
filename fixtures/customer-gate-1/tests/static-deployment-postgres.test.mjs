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
import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter";
import {
  DeploymentSupervisor,
  DeterministicStaticCompositionChangeAuthority,
  TrustedStaticApplicationBuildAuthority
} from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const staticDeploymentDirectory = join(fixtureDirectory, "static-deployment");
const npm = join(dirname(process.execPath), "npm");
const run = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));

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

async function updateCustomerSource(sourceDirectory) {
  const manifestPath = join(sourceDirectory, "k-nex.app.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.plugins.find((plugin) => plugin.id === "module.sales").version = "1.0.1";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const packagePath = join(sourceDirectory, "package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  pkg.dependencies["@k-nex/module-sales"] = "file:packages/k-nex-module-sales-1.0.1.tgz";
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  const releasePath = join(sourceDirectory, "static-deployment", "release.json");
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  release.plugin.version = "1.0.1";
  await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
  await resolveLock(sourceDirectory);
  await git(sourceDirectory, ["add", "."]);
  await git(sourceDirectory, ["commit", "--quiet", "-m", "customer: update module.sales to 1.0.1"]);
}

async function sourceMaterials(sourceDirectory) {
  const pkg = JSON.parse(await readFile(join(sourceDirectory, "package.json"), "utf8"));
  const salesTarball = pkg.dependencies["@k-nex/module-sales"].replace("file:", "");
  const paths = [
    "k-nex.app.json", "package.json", "package-lock.json", ".k-nex/generated/resolved-graph.json",
    "static-deployment/Dockerfile", "static-deployment/healthcheck.mjs", "static-deployment/release.json", "static-deployment/server.mjs",
    "static-deployment-migration.ts", salesTarball
  ];
  const digests = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await fileDigest(join(sourceDirectory, path))])));
  const composition = {
    applicationManifestDigest: digests["k-nex.app.json"],
    lockfileDigest: digests["package-lock.json"],
    resolvedGraphDigest: digests[".k-nex/generated/resolved-graph.json"],
    generatedRegistriesDigest: digestJson({ dockerfile: digests["static-deployment/Dockerfile"], healthcheck: digests["static-deployment/healthcheck.mjs"], server: digests["static-deployment/server.mjs"] }),
    packageClosureDigest: digests[salesTarball],
    migrationPlanDigest: digests["static-deployment-migration.ts"]
  };
  return { composition, digests, paths, pluginVersion: JSON.parse(await readFile(join(sourceDirectory, "static-deployment", "release.json"), "utf8")).plugin.version };
}

async function buildCustomerApplication(sourceDirectory, commit, artifactsDirectory) {
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
  const sbom = { bomFormat: "CycloneDX", components: [{ name: "@k-nex/module-sales", version: materials.pluginVersion, hashes: [{ alg: "SHA-256", content: materials.composition.packageClosureDigest.slice(7) }] }], sourceCommit: commit };
  const sbomPath = join(artifactsDirectory, `${commit}.sbom.json`);
  await writeFile(sbomPath, `${canonicalJson(sbom)}\n`);
  const provenance = { applicationDigest, imageDigest, sourceCommit: commit, composition: materials.composition, builder: "fixture-static-builder" };
  const provenancePath = join(artifactsDirectory, `${commit}.provenance.json`);
  await writeFile(provenancePath, `${canonicalJson(provenance)}\n`);
  return { ...materials, applicationDigest, applicationPath, imageDigest, imageReference: `knex-p9-customer-alpha@${imageDigest}`, provenance, provenancePath, sbom, sbomPath, tag };
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
      } catch { response.writeHead(502).end("upstream unavailable"); }
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
    return { imageReference: build.imageReference, applicationDigest: build.applicationDigest, imageDigest: build.imageDigest };
  }

  async reverify(generation) {
    const build = await this.#resolve(generation.imageDigest);
    return { imageReference: build.imageReference, applicationDigest: build.applicationDigest, imageDigest: build.imageDigest };
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

  constructor(network, gateway, artifacts, now) {
    this.network = network; this.gateway = gateway; this.artifacts = artifacts; this.now = now;
    this.workerActivations = []; this.drained = []; this.inspections = [];
  }

  async start({ generationId, imageReference, workerMode }) {
    assert.equal(workerMode, "passive");
    if (this.#containers.has(generationId)) return;
    const name = `knex-p9-${generationId}-${randomUUID().slice(0, 8)}`;
    const imageId = await this.artifacts.imageId(imageReference);
    await docker([
      "run", "--rm", "--detach", "--name", name, "--network", this.network,
      "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5",
      "--publish", "127.0.0.1::3000", "--env", `K_NEX_GENERATION=${generationId}`, "--env", "K_NEX_WORKER_MODE=passive", "--env", "K_NEX_SMOKE_TOKEN=trusted-smoke-token",
      "--env", `K_NEX_FAIL_HEALTH=${generationId.includes("failed") ? "1" : "0"}`, imageId
    ]);
    const port = (await docker(["port", name, "3000/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(port, "Docker did not publish a loopback port.");
    const container = { imageId, name, url: `http://127.0.0.1:${port}` };
    this.#containers.set(generationId, container);
    this.gateway.register(generationId, container.url);
  }

  async readiness(input) {
    const container = this.#containers.get(input.generationId);
    assert.ok(container);
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${container.url}/health`).catch(() => undefined);
      if (response?.ok) { healthy = true; break; }
      await delay(100);
    }
    if (!healthy) throw new Error(`Green generation ${input.generationId} failed health checks.`);
    const [publicSmoke, unauthenticatedSmoke, authenticatedSmoke, inventory] = await Promise.all([
      fetch(`${container.url}/public`), fetch(`${container.url}/authenticated`),
      fetch(`${container.url}/authenticated`, { headers: { "x-k-nex-smoke-auth": "trusted-smoke-token" } }), fetch(`${container.url}/inventory`)
    ]);
    assert.equal(publicSmoke.ok, true);
    assert.equal(unauthenticatedSmoke.status, 401);
    assert.equal(authenticatedSmoke.ok, true);
    const [publicBody, authenticatedBody, inventoryBody] = await Promise.all([publicSmoke.json(), authenticatedSmoke.json(), inventory.json()]);
    for (const body of [publicBody, authenticatedBody, inventoryBody]) {
      assert.deepEqual({ module: body.module, sourceCommit: body.sourceCommit, applicationDigest: body.applicationDigest, workerMode: body.workerMode },
        { module: "module.sales", sourceCommit: input.sourceCommit, applicationDigest: input.applicationDigest, workerMode: "passive" });
    }
    const inspection = JSON.parse((await docker(["inspect", container.name])).stdout)[0];
    this.inspections.push(inspection);
    assert.equal(inspection.Image, container.imageId);
    assert.equal(inspection.HostConfig.NetworkMode, this.network);
    assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspection.HostConfig.CapDrop.includes("ALL"), true);
    assert.equal(inspection.HostConfig.SecurityOpt.includes("no-new-privileges"), true);
    assert.equal(inspection.Mounts.some((mount) => mount.Type === "bind" || String(mount.Source).includes("docker.sock")), false);
    assert.equal(inspection.Config.Env.some((entry) => /^(DOCKER_HOST|DATABASE_URL|GITHUB_TOKEN|SOURCE_WRITE_TOKEN)=/u.test(entry)), false);
    await assert.rejects(docker(["exec", "--user", "65534:65534", container.name, "touch", "/source-write-test"]));
    return { ...input, publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: this.now().toISOString() };
  }

  async activateWorker(generationId, fence) { this.workerActivations.push({ generationId, fence }); }
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
        await this.pool.query("create table if not exists p9_static_overlap (id integer primary key, legacy_value text not null, expanded_value text); insert into p9_static_overlap values (1,'one',null),(2,'two',null),(3,'three',null) on conflict do nothing; create table if not exists p9_static_backfill_checkpoint (step_id text primary key, last_id integer not null);");
        completed.push(step.stepId);
      }
      if (step.phase === "online-backfill") {
        while (true) {
          const session = await this.pool.connect();
          try {
            await session.query("begin");
            const checkpoint = await session.query("select last_id from p9_static_backfill_checkpoint where step_id=$1 for update", [step.stepId]);
            const next = await session.query("select id from p9_static_overlap where id>$1 order by id limit 1", [checkpoint.rows[0]?.last_id ?? 0]);
            if (!next.rows[0]) { await session.query("commit"); break; }
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

function changePlan(baseCommit, targetCommit, base, target, now) {
  const requestDigest = digestJson({ applicationId: "customer-alpha", plugin: "module.sales", target: target.pluginVersion, baseCommit });
  const migrationDigest = target.composition.migrationPlanDigest;
  return {
    schemaVersion: 1, planId: "composition-plan-12", applicationId: "customer-alpha", environment: "production", deliveryClass: "platform-plugin",
    plugin: { id: "module.sales", version: target.pluginVersion, releaseManifestDigest: target.composition.packageClosureDigest },
    authority: { identity: "github-app:k-nex-change-authority", requestDigest },
    base: { sourceCommit: baseCommit, composition: base.composition },
    target: { sourceCommit: targetCommit, composition: target.composition, applicationSubjectDigest: target.applicationDigest, imageSubjectDigest: target.imageDigest },
    migration: {
      planId: "migration-plan-12", applicationId: "customer-alpha", environment: "production", sourceCommit: baseCommit, targetSourceCommit: targetCommit, baseRevision: 11, targetRevision: 12,
      steps: [
        { stepId: "migration-expand-12", phase: "online-expand", migrationDigest, overlapSafe: true },
        { stepId: "migration-backfill-12", phase: "online-backfill", migrationDigest, resumable: true, idempotent: true, checkpointSchemaDigest: target.composition.migrationPlanDigest },
        { stepId: "migration-contract-12", phase: "post-retirement-contract", migrationDigest, requiresOldGenerationRetired: true, requiresRollbackWindowClosed: true }
      ],
      rollbackWindow: { state: "open", windowId: "rollback-window-12", previousApplicationDigest: base.applicationDigest, closesAt: new Date(now.valueOf() + 86_400_000).toISOString(), contractCleanup: "blocked" }
    }, status: "source-change-ready"
  };
}

async function authorityChange(sourceDirectory, baseCommit, targetCommit, plan) {
  const checkpoints = new Map();
  const authority = new DeterministicStaticCompositionChangeAuthority(
    plan.authority.identity,
    {
      current: async () => ({ sourceCommit: await sourceCommit(sourceDirectory), composition: plan.base.composition }),
      commit: async (expected, change) => {
        assert.equal(expected, baseCommit);
        assert.equal(change.target.sourceCommit, targetCommit);
        await git(sourceDirectory, ["checkout", "--quiet", "--detach", targetCommit]);
        return sourceCommit(sourceDirectory);
      }
    },
    { resolve: async () => plan },
    {
      read: async (id) => checkpoints.get(id),
      save: async (checkpoint) => { checkpoints.set(checkpoint.checkpointId, checkpoint); return checkpoint; },
      commit: async (id) => { const checkpoint = checkpoints.get(id); assert.ok(checkpoint); const committed = { ...checkpoint, status: "committed" }; checkpoints.set(id, committed); return committed; }
    }
  );
  const request = {
    applicationId: plan.applicationId, environment: plan.environment, expectedSourceCommit: baseCommit, generationId: "customer-alpha-green-12",
    plan: { schemaVersion: 1, planId: "sales-static-plan-12", operationId: "sales-static-operation-12", operation: "update", version: plan.plugin.version, artifactDigest: plan.plugin.releaseManifestDigest, expectedRevision: 0, currentGenerationId: "customer-alpha-blue-11", targetGenerationId: "customer-alpha-green-12", approvalRequired: true, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "platform-plugin", id: "module.sales", availability: { outcome: "zero-downtime-eligible", checks: ["source-build-evidence", "migration-overlap", "worker-fence", "gateway-capacity", "rollback-window"] } }
  };
  return authority.request(request, { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: plan.authority.requestDigest });
}

async function verifiedBuild(change, target) {
  const keys = generateKeyPairSync("ed25519");
  const statement = {
    schemaVersion: 1, applicationId: change.change.applicationId, environment: change.change.environment, sourceCommit: change.targetSourceCommit,
    authority: { kind: "self-hosted-trusted", builderIdentity: "builder:k-nex-phase-9", trustPolicyDigest: digestJson({ policy: "fixture-static-builder: immutable source and Docker output" }), ref: "source-commit" },
    composition: change.change.target.composition, sbomDigest: await fileDigest(target.sbomPath), provenanceDigest: await fileDigest(target.provenancePath),
    applicationSubject: { name: "customer-alpha.application.json", digest: target.applicationDigest }, imageSubject: { repository: "knex-p9-customer-alpha", digest: target.imageDigest }
  };
  assert.equal(target.sbom.sourceCommit, statement.sourceCommit);
  assert.equal(target.provenance.imageDigest, statement.imageSubject.digest);
  const evidence = { ...statement, signature: { algorithm: "ed25519", keyId: "builder:k-nex-phase-9", value: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64") } };
  const authority = new TrustedStaticApplicationBuildAuthority({ "builder:k-nex-phase-9": keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
  return { authority, token: authority.verify(change, evidence), evidence };
}

test("proves real module.sales customer images, PostgreSQL fencing, rollback, and no downtime", { timeout: 300_000 }, async () => {
  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("static_deployment").withStartupTimeout(120_000).start();
  const sourceDirectory = await prepareCustomerSource();
  const artifactsDirectory = await mkdtemp(join(tmpdir(), "knex-p9-static-artifacts-"));
  const pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
  const network = `knex-p9-${randomUUID()}`;
  const gateway = new StableGateway();
  const now = new Date("2026-08-29T12:00:00.000Z");
  const probeFailures = [];
  let probing = false;
  let probePromise;
  let generations;
  const builtImages = [];
  try {
    const baseCommit = await sourceCommit(sourceDirectory);
    const blueBuild = await buildCustomerApplication(sourceDirectory, baseCommit, artifactsDirectory);
    builtImages.push(blueBuild);
    await updateCustomerSource(sourceDirectory);
    const targetCommit = await sourceCommit(sourceDirectory);
    const greenBuild = await buildCustomerApplication(sourceDirectory, targetCommit, artifactsDirectory);
    builtImages.push(greenBuild);
    assert.notEqual(baseCommit, targetCommit);
    assert.notEqual(blueBuild.imageDigest, greenBuild.imageDigest);
    assert.notEqual(blueBuild.applicationDigest, greenBuild.applicationDigest);
    assert.equal((await git(sourceDirectory, ["show", "--format=", "--name-only", targetCommit])).stdout.includes("k-nex.app.json"), true);
    assert.equal((await git(sourceDirectory, ["show", "--format=", "--name-only", targetCommit])).stdout.includes("package-lock.json"), true);
    await git(sourceDirectory, ["checkout", "--quiet", "--detach", baseCommit]);
    await boot(postgres.getConnectionUri());
    await docker(["network", "create", network]);
    await gateway.start();
    const plan = changePlan(baseCommit, targetCommit, blueBuild, greenBuild, now);
    const change = await authorityChange(sourceDirectory, baseCommit, targetCommit, plan);
    assert.equal(await sourceCommit(sourceDirectory), targetCommit);
    const build = await verifiedBuild(change, greenBuild);
    const artifacts = new LocalArtifactProvider(new Map([[blueBuild.imageDigest, blueBuild], [greenBuild.imageDigest, greenBuild]]));
    generations = new DockerGenerationHost(network, gateway, artifacts, () => now);
    const migrations = new PostgresCompatibilityMigrations(pool);
    const store = new PostgresStaticDeploymentStore(pool, { now: () => now }, build.authority);
    const blue = { generationId: "customer-alpha-blue-11", sourceCommit: baseCommit, compositionChangePlanDigest: digestJson(plan.base), buildEvidenceDigest: digestJson({ sourceCommit: baseCommit, imageDigest: blueBuild.imageDigest }), applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, migrationRevision: 11 };
    const owner = { applicationId: "customer-alpha", environment: "production" };
    const leaseExpiresAt = new Date(now.valueOf() + 240_000).toISOString();
    await store.initialize({ ...owner, generation: blue, workerOwner: "worker:phase-9-blue", workerFencingToken: 1, workerLeaseExpiresAt: leaseExpiresAt });
    await generations.start({ ...owner, generationId: blue.generationId, imageReference: blueBuild.imageReference, workerMode: "passive" });
    await generations.readiness({ ...owner, generationId: blue.generationId, sourceCommit: baseCommit, applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, migrationRevision: 11, completedMigrationSteps: [] });
    await gateway.converge({ ...owner, generationId: blue.generationId, revision: 0 });
    const realtimeEvents = [];
    const realtime = { reconnectAndResync: async ({ activeGenerationId, ...event }) => { const response = await fetch(`${gateway.url()}/realtime-resync`); assert.equal((await response.json()).generation, activeGenerationId); realtimeEvents.push({ ...event, activeGenerationId }); } };
    const supervisor = new DeploymentSupervisor(build.authority, artifacts, migrations, generations, store, gateway, realtime);
    probing = true;
    probePromise = (async () => { while (probing) { try { const response = await fetch(`${gateway.url()}/probe`); if (!response.ok) probeFailures.push(`status:${response.status}`); else await response.arrayBuffer(); } catch (error) { probeFailures.push(String(error)); } await delay(10); } })();

    await assert.rejects(store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2 }), { code: "FENCE_REJECTED" });
    await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1 });
    await assert.rejects(supervisor.deploy({ build: build.token, generationId: "customer-alpha-failed-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /failed health checks/);
    assert.equal(gateway.active(), blue.generationId);

    await pool.query("create function p9_fail_fence_transfer() returns trigger language plpgsql as $$ begin if new.fencing_token=2 then raise exception 'simulated fence transfer crash'; end if; return new; end $$");
    await pool.query("create trigger p9_fail_fence_transfer before update on runtime_worker_generation_fences for each row execute function p9_fail_fence_transfer()");
    await assert.rejects(supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt }), /simulated fence transfer crash/);
    assert.equal(gateway.active(), blue.generationId);
    assert.equal((await store.readFence(owner)).fencingToken, 1);
    await pool.query("drop trigger p9_fail_fence_transfer on runtime_worker_generation_fences");
    await pool.query("drop function p9_fail_fence_transfer()");

    const inFlightBlue = fetch(`${gateway.url()}/slow`).then((response) => response.json());
    await delay(30);
    const promoted = await supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt });
    assert.equal(promoted.outcome, "promoted");
    assert.equal((await inFlightBlue).generation, blue.generationId);
    assert.equal(gateway.active(), "customer-alpha-green-12");
    assert.equal((await store.readFence(owner)).activeExecutionGeneration, "customer-alpha-green-12");
    await assert.rejects(store.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: blue.generationId, fencingToken: 1, resultDigest: sha256("blue completion") }), { code: "FENCE_REJECTED" });
    assert.deepEqual(await store.claimEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2 }), { status: "claimed", attempts: 2 });
    await store.completeEffect({ ...owner, effectId: "sales-external-effect", generationId: "customer-alpha-green-12", fencingToken: 2, resultDigest: sha256("green completion") });
    const overlap = await Promise.all([pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap"), pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap"), fetch(`${gateway.url()}/new-binary`).then((response) => response.json())]);
    assert.deepEqual(overlap[0].rows[0].values, ["one", "two", "three"]);
    assert.deepEqual(overlap[1].rows[0].values, ["ONE", "TWO", "THREE"]);
    assert.deepEqual({ generation: overlap[2].generation, module: overlap[2].module, pluginVersion: overlap[2].pluginVersion }, { generation: "customer-alpha-green-12", module: "module.sales", pluginVersion: "1.0.1" });
    assert.equal(migrations.backfillBatches >= 3, true);

    await supervisor.rollback({ ...owner, workerOwner: "worker:phase-9-blue", workerLeaseExpiresAt: leaseExpiresAt });
    assert.equal(gateway.active(), blue.generationId);
    await supervisor.deploy({ build: build.token, generationId: "customer-alpha-green-12", workerOwner: "worker:phase-9-green", workerLeaseExpiresAt: leaseExpiresAt });
    await assert.rejects(supervisor.runContractCleanup(owner, plan.migration), { code: "CONTRACT_CLEANUP_BLOCKED" });
    const closed = await supervisor.closeRollback(owner);
    assert.equal(closed.contractCleanup, "eligible");
    assert.deepEqual(await supervisor.runContractCleanup(owner, plan.migration), ["migration-contract-12"]);
    assert.equal((await pool.query("select count(*)::int count from information_schema.columns where table_name='p9_static_overlap' and column_name='legacy_value'")).rows[0].count, 0);
    assert.equal(realtimeEvents.length, 3);
    const outbox = await pool.query("select revision, event_json->>'operation' operation from runtime_static_deployment_outbox order by revision");
    assert.deepEqual(outbox.rows, [{ revision: 1, operation: "promote" }, { revision: 2, operation: "rollback" }, { revision: 3, operation: "promote" }, { revision: 4, operation: "close-rollback" }]);
  } finally {
    probing = false;
    if (probePromise) await probePromise;
    await generations?.close();
    await gateway.close();
    await docker(["network", "rm", network]).catch(() => undefined);
    await Promise.allSettled(builtImages.map(({ tag }) => docker(["image", "rm", "--force", tag])));
    await pool.end();
    await postgres.stop();
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(artifactsDirectory, { recursive: true, force: true });
  }
  assert.deepEqual(probeFailures, []);
});

test("returns maintenance-required without building or starting a target generation", async () => {
  const offlinePlan = { migration: { steps: [{ phase: "offline-required" }] } };
  let starts = 0;
  const supervisor = new DeploymentSupervisor(
    { read: () => ({ change: { change: offlinePlan }, evidence: {} }) },
    { resolve: async () => { throw new Error("must not resolve"); } },
    { runOnline: async () => { throw new Error("must not migrate"); }, runPostRetirement: async () => [] },
    { start: async () => { starts += 1; }, readiness: async () => { throw new Error("must not probe"); }, activateWorker: async () => undefined, drain: async () => undefined, retire: async () => undefined },
    { read: async () => undefined, readFence: async () => undefined, promote: async () => { throw new Error("must not promote"); }, rollback: async () => { throw new Error("unused"); }, closeRollback: async () => { throw new Error("unused"); }, assertContractCleanup: async () => undefined },
    { converge: async () => { throw new Error("must not route"); } }, { reconnectAndResync: async () => { throw new Error("must not reconnect"); } }
  );
  assert.deepEqual(await supervisor.deploy({ build: {}, generationId: "customer-alpha-green-12", workerOwner: "worker:green", workerLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }), { outcome: "maintenance-required", reasons: ["offline-migration"] });
  assert.equal(starts, 0);
});
