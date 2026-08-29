import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresStaticDeploymentStore, PostgresTrustedBuildDeploymentClient } from "@k-nex/payload-adapter";
import { DeploymentSupervisor, TrustedStaticApplicationBuildAuthority } from "@k-nex/runtime";

const execute = promisify(execFile);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the deployment supervisor.`);
  return value;
}

async function docker(args) {
  return execute("docker", args, { maxBuffer: 8 * 1024 * 1024 });
}

async function json(path) { return JSON.parse(await readFile(path, "utf8")); }

class ArtifactProvider {
  constructor(builds) { this.builds = builds; }

  async #build(imageDigest) {
    const build = this.builds.get(imageDigest);
    if (!build) throw new Error(`The deployment supervisor has no immutable build for ${imageDigest}.`);
    const image = JSON.parse((await docker(["image", "inspect", imageDigest])).stdout)[0];
    if (image?.Id !== imageDigest) throw new Error("Content-addressed image pull did not resolve the attested image bytes.");
    return build;
  }

  async resolve(evidence) {
    const build = await this.#build(evidence.imageSubject.digest);
    return { imageReference: build.imageReference, applicationDigest: build.applicationDigest, imageDigest: build.imageDigest, runtimeImageDigest: build.imageDigest };
  }

  async reverify(generation) {
    const build = await this.#build(generation.imageDigest);
    return { imageReference: build.imageReference, applicationDigest: build.applicationDigest, imageDigest: build.imageDigest, runtimeImageDigest: build.imageDigest };
  }

  async imageId(reference) {
    const build = [...this.builds.values()].find((candidate) => candidate.imageReference === reference);
    if (!build) throw new Error(`Immutable image reference ${reference} is not authorized.`);
    return (await this.#build(build.imageDigest)).imageDigest;
  }
}

class CompatibilityMigrations {
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

  async runPostRetirement(plan) {
    const steps = plan.steps.filter((step) => step.phase === "post-retirement-contract");
    for (const _step of steps) await this.pool.query("alter table p9_static_overlap drop column if exists legacy_value");
    return steps.map((step) => step.stepId);
  }
}

class DockerGenerationHost {
  constructor({ network, artifacts, pool, now }) {
    this.network = network; this.namespace = required("P9_DOCKER_NAMESPACE"); this.artifacts = artifacts; this.pool = pool; this.now = now;
    this.containers = new Map(); this.failGatewayOnce = false; this.failHealthOnce = false;
  }

  database(generationId) {
    if (generationId === "customer-alpha-blue-11") return { role: "p9_static_blue", schemaRevision: 11, url: "postgresql://p9_static_blue:p9-static-blue-password@p9-postgres:5432/static_deployment" };
    if (generationId === "customer-alpha-green-12") return { role: "p9_static_green", schemaRevision: 12, url: "postgresql://p9_static_green:p9-static-green-password@p9-postgres:5432/static_deployment" };
    throw new Error(`No least-privilege database authority exists for ${generationId}.`);
  }

  async start({ generationId, imageReference, workerMode }) {
    if (workerMode !== "passive") throw new Error("Static generation workers must begin passive.");
    const database = this.database(generationId);
    const name = `knex-p9-${this.namespace}-${generationId}`;
    let imageId = await this.artifacts.imageId(imageReference);
    let port;
    try {
      const inspection = JSON.parse((await docker(["inspect", name])).stdout)[0];
      if (inspection.Image !== imageId) throw new Error("A retained container does not match its content-addressed image.");
      port = (await docker(["port", name, "3000/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    } catch {
      const identity = `web-${generationId}-${crypto.randomUUID()}`;
      const failHealth = this.failHealthOnce;
      this.failHealthOnce = false;
      await docker(["run", "--rm", "--detach", "--name", name, "--network", this.network, "--label", `p9-fixture=${this.namespace}`,
        "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m", "--cpus", "1",
        "--publish", "127.0.0.1::3000", "--env", `K_NEX_GENERATION=${generationId}`, "--env", `K_NEX_WEB_PROCESS_IDENTITY=${identity}`, "--env", "K_NEX_WORKER_MODE=passive", "--env", "K_NEX_SMOKE_TOKEN=trusted-smoke-token", "--env", "PAYLOAD_SECRET=p9-static-payload-secret",
        "--env", `DATABASE_URL=${database.url}`, "--env", `K_NEX_SCHEMA_REVISION=${database.schemaRevision}`,
        "--env", `K_NEX_FAIL_HEALTH=${failHealth ? "1" : "0"}`, imageId
      ]);
      port = (await docker(["port", name, "3000/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    }
    if (!port) throw new Error("Docker did not publish a loopback port.");
    const container = { name, imageId, url: `http://127.0.0.1:${port}` };
    this.containers.set(generationId, container);
    await this.pool.query("insert into p9_static_process_routes values ($1,$2) on conflict (generation_id) do update set url=excluded.url", [generationId, container.url]);
  }

  async readiness(input) {
    const container = this.containers.get(input.generationId);
    if (!container) throw new Error(`Generation ${input.generationId} was not started.`);
    const database = this.database(input.generationId);
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fetch(`${container.url}/health`).catch(() => undefined);
      if (response?.ok) { healthy = true; break; }
      await delay(100);
    }
    if (!healthy) {
      const logs = await docker(["logs", container.name]).then(({ stdout, stderr }) => `${stdout}${stderr}`).catch((error) => error.message);
      throw new Error(`Green generation ${input.generationId} failed health checks: ${logs}`);
    }
    const [publicSmoke, unauthenticatedSmoke, authenticatedSmoke, inventory, schemaProof, leastPrivilege] = await Promise.all([
      fetch(`${container.url}/public`), fetch(`${container.url}/authenticated`), fetch(`${container.url}/authenticated`, { headers: { "x-k-nex-smoke-auth": "trusted-smoke-token" } }),
      fetch(`${container.url}/inventory`), fetch(`${container.url}/schema-proof`), fetch(`${container.url}/least-privilege`)
    ]);
    if (!publicSmoke.ok || unauthenticatedSmoke.status !== 401 || !authenticatedSmoke.ok || !inventory.ok || !schemaProof.ok || !leastPrivilege.ok) throw new Error("Generation smoke checks failed.");
    const [publicBody, authenticatedBody, inventoryBody, schemaBody, privilegeBody] = await Promise.all([publicSmoke.json(), authenticatedSmoke.json(), inventory.json(), schemaProof.json(), leastPrivilege.json()]);
    for (const body of [publicBody, authenticatedBody, inventoryBody]) {
      if (body.module !== "module.sales" || body.sourceCommit !== input.sourceCommit || body.applicationDigest !== input.applicationDigest || body.workerMode !== "passive") throw new Error("Generation inventory is not bound to the attested target.");
    }
    if (schemaBody.databaseRole !== database.role || schemaBody.schemaRevision < database.schemaRevision || privilegeBody.rejected !== true) throw new Error("Generation schema or least-privilege proof failed.");
    const inspection = JSON.parse((await docker(["inspect", container.name])).stdout)[0];
    if (inspection.Image !== container.imageId || inspection.HostConfig.NetworkMode !== this.network || !inspection.HostConfig.ReadonlyRootfs || !inspection.HostConfig.CapDrop.includes("ALL") || !inspection.HostConfig.SecurityOpt.includes("no-new-privileges") || inspection.Mounts.some((mount) => mount.Type === "bind" || String(mount.Source).includes("docker.sock"))) throw new Error("Generation container isolation does not match the accepted profile.");
    return { ...input, publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: this.now().toISOString() };
  }

  async activateWorker() {}
  async drain() {}
  async retire(generationId) {
    const container = this.containers.get(generationId);
    if (container) await docker(["rm", "--force", container.name]).catch(() => undefined);
    this.containers.delete(generationId);
  }
  async restart(input) {
    await this.retire(input.generationId);
    await this.start({ generationId: input.generationId, imageReference: input.imageReference, workerMode: "passive" });
    return this.readiness(input);
  }
  async close() { await Promise.all([...this.containers.keys()].map((generationId) => this.retire(generationId))); }
}

function commandError(status, message, code = "COMMAND_REJECTED") {
  const error = new Error(message); error.status = status; error.code = code; return error;
}

async function requestBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw commandError(413, "Deployment command exceeds its bounded input size.");
  }
  try { return JSON.parse(raw); } catch { throw commandError(400, "Deployment command must be JSON."); }
}

export async function runDeploymentSupervisor({ event, ready }) {
  const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 3 });
  const network = required("P9_DOCKER_NETWORK");
  const controlPort = Number(required("P9_CONTROL_PORT"));
  const gatewayUrl = required("P9_GATEWAY_URL");
  if (!Number.isInteger(controlPort)) throw new Error("Deployment supervisor requires a fixed control port.");
  const [greenBuild, blueBuild, trust] = await Promise.all([json(required("P9_BUILD_RESULT_PATH")), json(required("P9_BASE_BUILD_PATH")), json(required("P9_BUILDER_TRUST_POLICY_PATH"))]);
  const authority = new TrustedStaticApplicationBuildAuthority({ [trust.builderIdentity]: { publicKey: trust.publicKey, authority: trust.authority } });
  const artifacts = new ArtifactProvider(new Map([[blueBuild.imageDigest, blueBuild], [greenBuild.imageDigest, greenBuild]]));
  const migrations = new CompatibilityMigrations(pool);
  const generations = new DockerGenerationHost({ network, artifacts, pool, now: () => new Date() });
  const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date() }, authority);
  const releases = new PostgresTrustedBuildDeploymentClient(pool);
  const gateway = { converge: async ({ generationId }) => {
    if (generations.failGatewayOnce) { generations.failGatewayOnce = false; throw new Error("simulated post-commit gateway crash"); }
    const route = await pool.query("select url from p9_static_process_routes where generation_id=$1", [generationId]);
    if (!route.rows[0]) throw new Error("Stable process gateway cannot resolve the promoted generation route.");
  } };
  const realtime = { reconnectAndResync: async ({ activeGenerationId }) => {
    const response = await fetch(`${gatewayUrl}/p9-authority`);
    const current = response.ok && await response.json();
    if (!current || current.generation !== activeGenerationId) throw new Error("Stable process gateway has not consumed the atomic PostgreSQL promotion.");
  } };
  const supervisor = new DeploymentSupervisor(authority, artifacts, migrations, generations, store, gateway, realtime);

  async function save(command, status, result, error) {
    await pool.query("update p9_static_deployment_commands set status=$2, result_json=$3::jsonb, error_code=$4, error_message=$5, updated_at=now() where command_id=$1", [command.commandId, status, result ? JSON.stringify(result) : null, error?.code ?? null, error?.message ?? null]);
  }
  async function begin(command) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u.test(command.commandId ?? "")) throw commandError(400, "Deployment command identity is invalid.");
    const { commandId: _commandId, ...bound } = command;
    const digest = digestJson(bound);
    const inserted = await pool.query("insert into p9_static_deployment_commands (command_id, command_digest, command_json, status) values ($1,$2,$3::jsonb,'running') on conflict do nothing returning command_id", [command.commandId, digest, JSON.stringify(command)]);
    const row = inserted.rows[0] ?? (await pool.query("select command_digest, status, result_json from p9_static_deployment_commands where command_id=$1", [command.commandId])).rows[0];
    if (!inserted.rows[0] && row.command_digest !== digest) throw commandError(409, "Deployment command replay changed its operation, generation, or build binding.", "COMMAND_REPLAY_MISMATCH");
    if (!inserted.rows[0] && row.status === "succeeded") return { replay: row.result_json };
    return { digest };
  }
  async function verified(command) {
    const request = await releases.readRequest(command.buildRequestDigest);
    if (!request || !["deployment-requested", "deployed"].includes(request.status) || request.applicationId !== command.applicationId || request.environment !== command.environment || request.sourceCommit !== greenBuild.change.targetSourceCommit || request.buildEvidenceDigest !== digestJson(greenBuild.evidence) || request.applicationDigest !== greenBuild.applicationDigest || request.imageDigest !== greenBuild.imageDigest) throw commandError(409, "Deployment command is not bound to the attested durable release authority.", "AUTHORITY_MISMATCH");
    if (command.generationId !== "customer-alpha-green-12") throw commandError(409, "Promotion command generation does not match its trusted static release.", "AUTHORITY_MISMATCH");
    return { request, build: authority.verify(greenBuild.change, greenBuild.evidence) };
  }
  async function receiptForRevision(owner, revision) {
    const row = await pool.query("select event_json from runtime_static_deployment_outbox where application_id=$1 and environment=$2 and revision=$3", [owner.applicationId, owner.environment, revision]);
    if (!row.rows[0]) throw commandError(409, "PostgreSQL promotion receipt is unavailable for recovery.");
    return row.rows[0].event_json;
  }
  async function execute(command, recovering) {
    const owner = { applicationId: command.applicationId, environment: command.environment };
    if (command.operation === "bootstrap") {
      if (command.generationId !== "customer-alpha-blue-11" || command.buildRequestDigest !== greenBuild.buildRequestDigest) throw commandError(409, "Bootstrap command is not bound to the approved static release context.");
      const blue = { generationId: command.generationId, sourceCommit: blueBuild.sourceCommit, compositionChangePlanDigest: command.compositionChangePlanDigest, buildEvidenceDigest: command.buildEvidenceDigest, applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, imageReference: blueBuild.imageReference, migrationRevision: 11 };
      await store.initialize({ ...owner, generation: blue, workerOwner: command.workerOwner, workerFencingToken: 1, workerLeaseExpiresAt: command.workerLeaseExpiresAt });
      await generations.start({ ...owner, generationId: blue.generationId, imageReference: blue.imageReference, workerMode: "passive" });
      await generations.readiness({ ...owner, generationId: blue.generationId, sourceCommit: blue.sourceCommit, applicationDigest: blue.applicationDigest, imageDigest: blue.imageDigest, migrationRevision: 11, completedMigrationSteps: [] });
      return { operation: "bootstrap", generationId: blue.generationId, revision: 0 };
    }
    if (command.operation === "release-request") {
      const request = await releases.readRequest(digestJson({ change: command.change, authorization: command.authorization }));
      if (!request || canonicalJson(command.change) !== canonicalJson(greenBuild.change) || request.buildRequestDigest !== greenBuild.buildRequestDigest) throw commandError(409, "PluginManager release intent does not match the builder-owned durable request.", "AUTHORITY_MISMATCH");
      return request;
    }
    if (command.operation === "release-reverify") return { verified: await releases.reverify(command.authority) };
    if (command.operation === "validate-online-migration") return { completed: await migrations.runOnline(command.migration) };
    if (command.operation === "maintenance-required") {
      if (!command.migration?.steps?.some((step) => step.phase === "offline-required")) throw commandError(409, "Maintenance refusal requires an offline migration plan.");
      return { outcome: "maintenance-required", reasons: ["offline-migration"] };
    }
    if (command.operation === "arm-gateway-failure") { generations.failGatewayOnce = true; return { armed: true }; }
    if (command.operation === "arm-health-failure") { generations.failHealthOnce = true; return { armed: true }; }
    if (command.operation === "cleanup") { await generations.close(); return { cleaned: true }; }
    if (command.operation === "restart") return generations.restart({ ...command, imageReference: command.generationId === "customer-alpha-blue-11" ? blueBuild.imageReference : greenBuild.imageReference });
    if (command.operation === "recover") { await supervisor.recover(owner); return { operation: "recover", generationId: (await store.read(owner))?.active.generationId }; }
    if (command.operation === "close-rollback") return supervisor.closeRollback(owner);
    if (command.operation === "contract-cleanup") return { completed: await supervisor.runContractCleanup(owner, greenBuild.change.change.migration) };
    if (command.operation === "rollback") {
      const state = await store.read(owner);
      if (!state || state.revision !== command.expectedRevision || state.rollback?.generationId !== command.generationId) throw commandError(409, "Rollback command revision or retained generation is stale.", "REVISION_CONFLICT");
      return supervisor.rollback({ ...owner, workerOwner: command.workerOwner, workerLeaseExpiresAt: command.workerLeaseExpiresAt });
    }
    if (command.operation !== "promote") throw commandError(400, "Deployment command operation is not accepted.");
    const { request, build } = await verified(command);
    const state = await store.read(owner);
    if (!state) throw commandError(409, "Static deployment is not initialized.");
    if (recovering && state.active.generationId === command.generationId && state.revision === command.expectedRevision + 1) {
      await supervisor.recover(owner);
      const receipt = await receiptForRevision(owner, state.revision);
      if (request.status === "deployment-requested") await releases.recordDeployment({ buildRequestDigest: request.buildRequestDigest, expectedVersion: request.version, receipt });
      return { outcome: "promoted", receipt, recovered: true };
    }
    if (state.revision !== command.expectedRevision) throw commandError(409, "Promotion command revision is stale.", "REVISION_CONFLICT");
    const outcome = await supervisor.deploy({ build, generationId: command.generationId, workerOwner: command.workerOwner, workerLeaseExpiresAt: command.workerLeaseExpiresAt });
    if (outcome.outcome === "promoted" && request.status === "deployment-requested") await releases.recordDeployment({ buildRequestDigest: request.buildRequestDigest, expectedVersion: request.version, receipt: outcome.receipt });
    await event("supervisor-lifecycle-executed", { operation: command.operation, generationId: command.generationId, buildRequestDigest: command.buildRequestDigest, outcome: outcome.outcome, backfillBatches: migrations.backfillBatches });
    return outcome;
  }

  const server = createServer(async (request, response) => {
    const send = (status, value) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    try {
      if (request.method !== "POST" || request.url !== "/commands") throw commandError(404, "Unknown deployment supervisor endpoint.");
      const command = await requestBody(request);
      const started = await begin(command);
      if (started.replay) return send(200, started.replay);
      try {
        const result = await execute(command, command.operation === "promote" && (await pool.query("select status from p9_static_deployment_commands where command_id=$1", [command.commandId])).rows[0]?.status === "failed");
        const envelope = { commandId: command.commandId, commandDigest: started.digest, operation: command.operation, generationId: command.generationId, buildRequestDigest: command.buildRequestDigest, result };
        await save(command, "succeeded", envelope);
        return send(200, envelope);
      } catch (error) {
        await save(command, "failed", undefined, error);
        throw error;
      }
    } catch (error) { return send(error.status ?? 500, { error: error.message, code: error.code ?? "SUPERVISOR_FAILURE" }); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(controlPort, "127.0.0.1", resolve); });
  const owner = { applicationId: "customer-alpha", environment: "production" };
  if (await store.read(owner)) await supervisor.recover(owner);
  await event("supervisor-recovered", { controlPort, processId: process.pid });
  ready({ url: `http://127.0.0.1:${server.address().port}` });
}
