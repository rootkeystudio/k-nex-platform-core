import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";
import { canonicalJson, ExtensionInstallPlanSchema, StaticCompositionChangePlanSchema } from "@k-nex/contracts";
import { PostgresStaticDeploymentStore, PostgresTrustedBuildDeploymentClient } from "@k-nex/payload-adapter";
import { DeploymentSupervisor, StaticDeploymentEffectNotDispatchedError, TrustedStaticApplicationBuildAuthority } from "@k-nex/runtime";

const execute = promisify(execFile);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digestJson = (value) => sha256(canonicalJson(value));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const greenGenerationIds = new Set(["customer-alpha-green-partial-12", "customer-alpha-green-worker-only-12", "customer-alpha-green-reserved-crash-12", "customer-alpha-green-health-12", "customer-alpha-green-fence-12", "customer-alpha-green-12", "customer-alpha-provider-uninstall-13"]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the deployment supervisor.`);
  return value;
}

async function docker(args) {
  return execute("docker", args, { maxBuffer: 8 * 1024 * 1024 });
}

function dockerContainerMissing(error) {
  return /\bno such (?:container|object)\b/iu.test(`${error?.stderr ?? ""}\n${error?.stdout ?? ""}\n${error?.message ?? ""}`);
}

async function removeContainer(name) {
  try { await docker(["rm", "--force", name]); }
  catch (error) {
    if (!dockerContainerMissing(error)) throw error;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await docker(["inspect", name]); }
    catch (error) { if (dockerContainerMissing(error)) return; throw error; }
    await delay(100);
  }
  throw new Error(`Container ${name} remained after retirement.`);
}

function exactIsolationProfile(container, network, { pidsLimit, memory, nanoCpus }) {
  const tmpfs = new Set(String(container?.HostConfig?.Tmpfs?.["/tmp"] ?? "").toLowerCase().split(",").filter(Boolean));
  const exactTmpfs = ["rw", "noexec", "nosuid", "nodev"].every((flag) => tmpfs.has(flag)) &&
    [...tmpfs].some((flag) => flag === "size=16m" || flag === "size=16777216");
  const mounts = container?.Mounts ?? [];
  const networks = Object.keys(container?.NetworkSettings?.Networks ?? {});
  return Boolean(container?.Config?.User === "65534:65534" && container?.HostConfig?.NetworkMode === network &&
    networks.length === 1 && networks[0] === network &&
    container.HostConfig.ReadonlyRootfs === true && container.HostConfig.Privileged === false && container.HostConfig.PidsLimit === pidsLimit &&
    container.HostConfig.Memory === memory && container.HostConfig.MemorySwap === memory * 2 && container.HostConfig.NanoCpus === nanoCpus && exactTmpfs &&
    container.HostConfig.PidMode === "" && container.HostConfig.IpcMode === "private" && container.HostConfig.UTSMode === "" &&
    container.HostConfig.CgroupnsMode === "private" && container.HostConfig.OomKillDisable !== true && !container.HostConfig.DeviceCgroupRules?.length &&
    container.HostConfig.CapDrop?.length === 1 && container.HostConfig.CapDrop[0] === "ALL" && !container.HostConfig.CapAdd?.length &&
    container.HostConfig.SecurityOpt?.length === 1 && container.HostConfig.SecurityOpt[0] === "no-new-privileges" &&
    !container.HostConfig.Binds?.length && !container.HostConfig.Devices?.length && !container.HostConfig.DeviceRequests?.length &&
    !mounts.some((mount) => mount.Type !== "tmpfs" || mount.Destination !== "/tmp" || String(mount.Source).includes("docker.sock")));
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
  constructor({ network, artifacts, pool, now, transitionAuthority }) {
    this.network = network; this.namespace = required("P9_DOCKER_NAMESPACE"); this.artifacts = artifacts; this.pool = pool; this.now = now; this.transitionAuthority = transitionAuthority;
    this.containers = new Map(); this.failGatewayOnce = false; this.failHealthOnce = false; this.failWorkerStartOnce = false;
    this.failReadinessOnce = false; this.failWebAfterWorkerStartOnce = false; this.crashAfterRetirementReservationOnce = false; this.loseTransitionWorkerOnce = false;
    this.workerHeartbeatMs = Number(process.env.P9_WORKER_HEARTBEAT_MS ?? "250");
    this.workerLeaseMs = Number(process.env.P9_WORKER_LEASE_MS ?? "1000");
    this.workerClockSkewMs = Number(process.env.P9_WORKER_CLOCK_SKEW_MS ?? "0");
    if (!Number.isInteger(this.workerHeartbeatMs) || this.workerHeartbeatMs < 100 || this.workerHeartbeatMs > 30_000 ||
      !Number.isInteger(this.workerLeaseMs) || this.workerLeaseMs < 1_000 || this.workerLeaseMs > 300_000 || this.workerHeartbeatMs >= this.workerLeaseMs ||
      !Number.isInteger(this.workerClockSkewMs) || Math.abs(this.workerClockSkewMs) > 300_000) {
      throw new Error("Fixture worker heartbeat and lease settings are invalid.");
    }
  }

  key({ applicationId, environment, generationId }) { return `${applicationId}:${environment}:${generationId}`; }
  name(input) {
    const ownerId = createHash("sha256").update(`${input.applicationId}:${input.environment}`).digest("hex").slice(0, 16);
    return `knex-p9-${this.namespace}-${ownerId}-${input.generationId}`;
  }

  database(generationId) {
    if (generationId === "customer-alpha-blue-11") return { role: "p9_static_blue", schemaRevision: 11, url: "postgresql://p9_static_blue:p9-static-blue-password@p9-postgres:5432/static_deployment" };
    if (greenGenerationIds.has(generationId)) return { role: "p9_static_green", schemaRevision: 12, url: "postgresql://p9_static_green:p9-static-green-password@p9-postgres:5432/static_deployment" };
    throw new Error(`No least-privilege database authority exists for ${generationId}.`);
  }

  workerDatabaseUrl() {
    return "postgresql://p9_static_worker:p9-static-worker-password@p9-postgres:5432/static_deployment";
  }

  async start(input) {
    const { generationId, imageReference, workerMode } = input;
    if (workerMode !== "passive") throw new Error("Static generation workers must begin passive.");
    const database = this.database(generationId);
    const name = this.name(input);
    const workerName = `${name}-worker`;
    let imageId = await this.artifacts.imageId(imageReference);
    let port;
    try {
      const inspection = JSON.parse((await docker(["inspect", name])).stdout)[0];
      if (inspection.Image !== imageId || !exactIsolationProfile(inspection, this.network, { pidsLimit: 128, memory: 512 * 1024 * 1024, nanoCpus: 1_000_000_000 })) throw new Error("A retained container does not match its immutable image and isolation profile.");
      port = (await docker(["port", name, "3000/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    } catch {
      await removeContainer(name);
      const identity = `web-${generationId}-${crypto.randomUUID()}`;
      const failHealth = this.failHealthOnce;
      this.failHealthOnce = false;
      await docker(["run", "--rm", "--detach", "--name", name, "--network", this.network, "--label", `p9-fixture=${this.namespace}`, "--label", "p9-role=release-web",
        "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--ipc", "private", "--cgroupns", "private", "--pids-limit", "128", "--memory", "512m", "--memory-swap", "1g", "--cpus", "1",
        "--publish", "127.0.0.1::3000", "--env", `K_NEX_GENERATION=${generationId}`, "--env", `K_NEX_WEB_PROCESS_IDENTITY=${identity}`, "--env", "K_NEX_WORKER_MODE=passive", "--env", "K_NEX_SMOKE_TOKEN=trusted-smoke-token", "--env", "PAYLOAD_SECRET=p9-static-payload-secret",
        "--env", `DATABASE_URL=${database.url}`, "--env", `K_NEX_SCHEMA_REVISION=${database.schemaRevision}`,
        "--env", `K_NEX_FAIL_HEALTH=${failHealth ? "1" : "0"}`, imageId
      ]);
      port = (await docker(["port", name, "3000/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    }
    if (!port) throw new Error("Docker did not publish a loopback port.");
    if (this.failWorkerStartOnce) {
      this.failWorkerStartOnce = false;
      await this.pool.query(
        "insert into p9_static_process_events (role, instance_id, event, generation_id, detail) values ('supervisor', $1, 'worker-start-failure-before-route', $2, $3::jsonb)",
        [`supervisor-${process.pid}`, generationId, JSON.stringify({ webName: name, workerName, routePublished: false })]
      );
      throw new Error("simulated worker start failure after web start");
    }
    const workerControlToken = sha256(`${this.namespace}:${input.applicationId}:${input.environment}:${generationId}:release-worker-control`);
    let workerPort;
    try {
      const inspection = JSON.parse((await docker(["inspect", workerName])).stdout)[0];
      if (inspection.Image !== imageId || !exactIsolationProfile(inspection, this.network, { pidsLimit: 64, memory: 128 * 1024 * 1024, nanoCpus: 500_000_000 })) throw new Error("A retained worker does not match its immutable release image and isolation profile.");
      workerPort = (await docker(["port", workerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
      const status = workerPort && await fetch(`http://127.0.0.1:${workerPort}/status`).then((response) => response.ok ? response.json() : undefined);
      if (!status || status.mode !== "passive" || status.fencingToken !== undefined) {
        await docker(["rm", "--force", workerName]);
        workerPort = undefined;
      }
    } catch {
      await removeContainer(workerName);
      workerPort = undefined;
    }
    if (!workerPort) {
      await docker(["run", "--rm", "--detach", "--name", workerName, "--network", this.network, "--label", `p9-fixture=${this.namespace}`, "--label", "p9-role=release-worker",
        "--user", "65534:65534", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--ipc", "private", "--cgroupns", "private", "--pids-limit", "64", "--memory", "128m", "--memory-swap", "256m", "--cpus", "0.5",
        "--publish", "127.0.0.1::3002", "--env", `K_NEX_GENERATION=${generationId}`, "--env", `K_NEX_IMAGE_DIGEST=${imageId}`, "--env", `K_NEX_WORKER_CONTROL_TOKEN=${workerControlToken}`, "--env", "P9_RELEASE_WORKER_PORT=3002", "--env", `P9_WORKER_HEARTBEAT_MS=${this.workerHeartbeatMs}`, "--env", `P9_WORKER_LEASE_MS=${this.workerLeaseMs}`, "--env", `P9_WORKER_CLOCK_SKEW_MS=${this.workerClockSkewMs}`, "--env", `DATABASE_URL=${this.workerDatabaseUrl()}`,
        imageId, "node", "release-worker.mjs"
      ]);
      workerPort = (await docker(["port", workerName, "3002/tcp"])).stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1];
    }
    if (!workerPort) throw new Error("Docker did not publish the release worker control port.");
    let workerReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await fetch(`http://127.0.0.1:${workerPort}/status`).then((response) => response.ok ? response.json() : undefined).catch(() => undefined);
      if (status?.mode === "passive" && status.generationId === generationId && status.imageDigest === imageId) { workerReady = true; break; }
      await delay(100);
    }
    if (!workerReady) {
      const logs = await docker(["logs", workerName]).then(({ stdout, stderr }) => `${stdout}${stderr}`).catch((error) => error.message);
      throw new Error(`Release worker ${generationId} did not become passive and ready: ${logs}`);
    }
    if (this.failWebAfterWorkerStartOnce) {
      this.failWebAfterWorkerStartOnce = false;
      await removeContainer(name);
      await this.pool.query(
        "insert into p9_static_process_events (role, instance_id, event, generation_id, detail) values ('supervisor', $1, 'worker-only-survivor-before-route', $2, $3::jsonb)",
        [`supervisor-${process.pid}`, generationId, JSON.stringify({ webName: name, workerName, routePublished: false })]
      );
      throw new Error("simulated web startup failure after passive worker startup and before route publication");
    }
    const container = { applicationId: input.applicationId, environment: input.environment, generationId, name, workerName, imageId, url: `http://127.0.0.1:${port}`, workerUrl: `http://127.0.0.1:${workerPort}`, workerControlToken };
    this.containers.set(this.key(input), container);
    await this.pool.query(
      `insert into p9_static_process_routes (application_id, environment, generation_id, url) values ($1,$2,$3,$4)
       on conflict (application_id, environment, generation_id) do update set url=excluded.url`,
      [input.applicationId, input.environment, generationId, container.url]
    );
  }

  async readiness(input) {
    const container = this.containers.get(this.key(input));
    if (!container) throw new Error(`Generation ${input.generationId} was not started.`);
    const database = this.database(input.generationId);
    if (this.failReadinessOnce) {
      this.failReadinessOnce = false;
      throw new Error("simulated web readiness failure after both generation processes and route publication");
    }
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
    const [publicSmoke, unauthenticatedSmoke, authenticatedSmoke, inventory, schemaProof, leastPrivilege, worker] = await Promise.all([
      fetch(`${container.url}/public`), fetch(`${container.url}/authenticated`), fetch(`${container.url}/authenticated`, { headers: { "x-k-nex-smoke-auth": "trusted-smoke-token" } }),
      fetch(`${container.url}/inventory`), fetch(`${container.url}/schema-proof`), fetch(`${container.url}/least-privilege`), fetch(`${container.workerUrl}/status`)
    ]);
    if (!publicSmoke.ok || unauthenticatedSmoke.status !== 401 || !authenticatedSmoke.ok || !inventory.ok || !schemaProof.ok || !leastPrivilege.ok || !worker.ok) {
      throw new Error(`Generation smoke checks failed: ${canonicalJson({ public: publicSmoke.status, unauthenticated: unauthenticatedSmoke.status, authenticated: authenticatedSmoke.status, inventory: inventory.status, schema: schemaProof.status, leastPrivilege: leastPrivilege.status, worker: worker.status })}`);
    }
    const [publicBody, authenticatedBody, inventoryBody, schemaBody, privilegeBody, workerBody] = await Promise.all([publicSmoke.json(), authenticatedSmoke.json(), inventory.json(), schemaProof.json(), leastPrivilege.json(), worker.json()]);
    for (const body of [publicBody, authenticatedBody, inventoryBody]) {
      if (body.module !== "module.sales" || body.sourceCommit !== input.sourceCommit || body.applicationDigest !== input.applicationDigest || body.workerMode !== "passive") throw new Error("Generation inventory is not bound to the attested target.");
    }
    if (schemaBody.databaseRole !== database.role || schemaBody.schemaRevision < database.schemaRevision || privilegeBody.rejected !== true) throw new Error("Generation schema or least-privilege proof failed.");
    if (workerBody.mode !== "passive" || workerBody.generationId !== input.generationId || workerBody.sourceCommit !== input.sourceCommit || workerBody.applicationDigest !== input.applicationDigest || workerBody.imageDigest !== input.imageDigest || workerBody.module !== "module.sales") throw new Error("Release worker is not the exact passive attested module.sales image.");
    const inspection = JSON.parse((await docker(["inspect", container.name])).stdout)[0];
    const workerInspection = JSON.parse((await docker(["inspect", container.workerName])).stdout)[0];
    if (inspection.Image !== container.imageId || workerInspection.Image !== container.imageId ||
      !exactIsolationProfile(inspection, this.network, { pidsLimit: 128, memory: 512 * 1024 * 1024, nanoCpus: 1_000_000_000 }) ||
      !exactIsolationProfile(workerInspection, this.network, { pidsLimit: 64, memory: 128 * 1024 * 1024, nanoCpus: 500_000_000 })) throw new Error("Generation container isolation does not match the accepted profile.");
    await this.pool.query(
      "insert into p9_static_process_events (role, instance_id, event, generation_id, detail) values ('supervisor',$1,'generation-readiness',$2,$3::jsonb)",
      [`supervisor-${process.pid}`, input.generationId, JSON.stringify({ migrationRevision: input.migrationRevision, completedMigrationSteps: input.completedMigrationSteps })]
    );
    return { ...input, publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive", gatewayCapacity: true, realtimeReady: true, observedAt: this.now().toISOString() };
  }

  async workerCommand(input, path, payload = {}) {
    const container = await this.discover(input);
    const { generationId } = input;
    if (!container) throw new Error(`Release worker ${generationId} is not running.`);
    const response = await fetch(`${container.workerUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-p9-worker-control": container.workerControlToken }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? `Release worker ${path} failed.`), { status: response.status, code: result.code });
    return result;
  }
  async activateWorker(ticket) {
    await this.transitionAuthority.assertTransitionTicket(ticket);
    const probe = await this.activeProbe(ticket);
    if (this.loseTransitionWorkerOnce) {
      this.loseTransitionWorkerOnce = false;
      const workerName = `${this.name(ticket)}-worker`;
      await removeContainer(workerName);
      this.containers.delete(this.key(ticket));
      await this.pool.query(
        "insert into p9_static_process_events (role, instance_id, event, generation_id, fencing_token, detail) values ('supervisor',$1,'transition-worker-lost-before-activation',$2,$3,$4::jsonb)",
        [`supervisor-${process.pid}`, ticket.generationId, ticket.fencingToken, JSON.stringify({ reservationId: ticket.reservationId })]
      );
    }
    if (await this.hasExactWorker(probe, "active", ticket.fencingToken)) return;
    if (!(await this.hasExactWorker(probe, "passive"))) {
      await this.transitionAuthority.assertTransitionTicket(ticket);
      this.containers.delete(this.key(ticket));
      await this.start({ ...ticket, imageReference: probe.imageReference, workerMode: "passive" });
      if (!(await this.hasExactWorker(probe, "passive"))) throw new Error("Recovered transition worker is not the exact passive immutable generation.");
    }
    await this.transitionAuthority.assertTransitionTicket(ticket);
    const result = await this.workerCommand(ticket, "/activate", ticket);
    if (result.mode !== "active" || result.generationId !== ticket.generationId || result.fencingToken !== ticket.fencingToken) throw new Error("Release worker activation did not bind the persisted transition authority.");
  }
  async recoverActiveWorker(ticket) {
    await this.transitionAuthority.assertWorkerRecoveryActivation(ticket);
    const probe = await this.activeProbe(ticket);
    if (await this.hasHealthyActiveWorker(probe)) return;
    if (!(await this.hasExactWorker(probe, "passive"))) {
      await this.transitionAuthority.assertWorkerRecoveryActivation(ticket);
      this.containers.delete(this.key(ticket));
      await this.start({ ...ticket, imageReference: probe.imageReference, workerMode: "passive" });
      if (!(await this.hasExactWorker(probe, "passive"))) throw new Error("Recovered release worker is not the exact passive immutable generation.");
    }
    await this.transitionAuthority.assertWorkerRecoveryActivation(ticket);
    const result = await this.workerCommand(ticket, "/activate-recovery", ticket);
    if (result.mode !== "active" || result.generationId !== ticket.generationId || result.fencingToken !== ticket.fencingToken) throw new Error("Release worker recovery activation did not bind persisted authority.");
  }
  async hasHealthyActiveWorker(probe) {
    return this.hasExactWorker(probe, "active", probe.fencingToken);
  }
  async hasExactWorker(probe, expectedMode, expectedFencingToken) {
    let container;
    try { container = await this.discover(probe); } catch { return false; }
    if (!container || container.imageId !== probe.imageDigest) return false;
    try {
      const [worker, web, webInspection, workerInspection] = await Promise.all([
        fetch(`${container.workerUrl}/status`).then((response) => response.ok ? response.json() : undefined),
        fetch(`${container.url}/inventory`).then((response) => response.ok ? response.json() : undefined),
        docker(["inspect", container.name]).then(({ stdout }) => JSON.parse(stdout)[0]),
        docker(["inspect", container.workerName]).then(({ stdout }) => JSON.parse(stdout)[0])
      ]);
      const isolated = webInspection?.Image === probe.imageDigest && workerInspection?.Image === probe.imageDigest &&
        exactIsolationProfile(webInspection, this.network, { pidsLimit: 128, memory: 512 * 1024 * 1024, nanoCpus: 1_000_000_000 }) &&
        exactIsolationProfile(workerInspection, this.network, { pidsLimit: 64, memory: 128 * 1024 * 1024, nanoCpus: 500_000_000 });
      return Boolean(isolated && worker?.mode === expectedMode && worker.generationId === probe.generationId && worker.fencingToken === expectedFencingToken &&
        worker.sourceCommit === probe.sourceCommit && worker.applicationDigest === probe.applicationDigest && worker.imageDigest === probe.imageDigest && worker.module === "module.sales" &&
        web?.generation === probe.generationId && web?.sourceCommit === probe.sourceCommit && web?.applicationDigest === probe.applicationDigest && web?.module === "module.sales");
    } catch { return false; }
  }
  async activeProbe(input) {
    const row = await this.pool.query(
      "select active_generation from runtime_static_deployments where application_id=$1 and environment=$2 and active_generation_id=$3",
      [input.applicationId, input.environment, input.generationId]
    );
    const active = row.rows[0]?.active_generation;
    if (!active || typeof active.imageReference !== "string" || typeof active.sourceCommit !== "string" || typeof active.applicationDigest !== "string" || typeof active.imageDigest !== "string") throw new Error("Active static worker recovery is missing immutable generation evidence.");
    return { applicationId: input.applicationId, environment: input.environment, generationId: input.generationId, sourceCommit: active.sourceCommit, applicationDigest: active.applicationDigest, imageDigest: active.imageDigest, imageReference: active.imageReference, fencingToken: input.fencingToken };
  }
  async executeEffect(input, effect) {
    return this.workerCommand(input, "/execute", effect);
  }
  async drain(input) {
    await this.pool.query(
      "insert into p9_static_process_events (role, instance_id, event, generation_id, deployment_revision, fencing_token, detail) values ('supervisor', $1, 'drain-ticket-forwarded', $2, $3, $4, $5::jsonb)",
      [`supervisor-${process.pid}`, input.generationId, input.revision, input.fencingToken, JSON.stringify({ ticket: input })]
    );
    const result = await this.workerCommand(input, "/drain", input);
    if (result.mode !== "drained" || result.generationId !== input.generationId) throw new Error("Release worker drain did not complete.");
  }
  async retire({ reservation, ticket }) {
    if (ticket) await this.transitionAuthority.assertTransitionTicket(ticket, reservation);
    await this.assertRetirementReservation(reservation, ticket);
    if (this.crashAfterRetirementReservationOnce) {
      this.crashAfterRetirementReservationOnce = false;
      await this.pool.query(
        "insert into p9_static_process_events (role, instance_id, event, generation_id, detail) values ('supervisor', $1, 'retirement-reserved-before-delete', $2, $3::jsonb)",
        [`supervisor-${process.pid}`, reservation.generationId, JSON.stringify({ applicationId: reservation.applicationId, environment: reservation.environment, generationId: reservation.generationId, reservationId: reservation.reservationId })]
      );
      process.kill(process.pid, "SIGKILL");
      await new Promise(() => {});
    }
    await this.removeGeneration(reservation);
  }
  async restart(input) {
    await this.removeGeneration(input);
    await this.start({ applicationId: input.applicationId, environment: input.environment, generationId: input.generationId, imageReference: input.imageReference, workerMode: "passive" });
    return this.readiness(input);
  }
  async close() { for (const container of [...this.containers.values()]) await this.removeGeneration(container); }

  async removeGeneration(input) {
    const name = this.name(input);
    await removeContainer(`${name}-worker`);
    await removeContainer(name);
    await this.pool.query(
      "delete from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
      [input.applicationId, input.environment, input.generationId]
    );
    const route = await this.pool.query(
      "select 1 from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
      [input.applicationId, input.environment, input.generationId]
    );
    if (route.rows[0]) throw new Error("Removed static generation route remained registered.");
    this.containers.delete(this.key(input));
  }

  async assertRetirementReservation(input, ticket) {
    const result = await this.pool.query(
      `select r.reservation_id, r.state, d.active_generation_id, d.rollback_generation_id,
              d.rollback_window, d.transition_checkpoint
         from runtime_static_generation_retirements r
         join runtime_static_deployments d using (application_id, environment)
        where r.application_id=$1 and r.environment=$2 and r.generation_id=$3`,
      [input.applicationId, input.environment, input.generationId]
    );
    const row = result.rows[0];
    if (!row || row.reservation_id !== input.reservationId || !["reserved", "completed"].includes(row.state)) {
      throw new Error("Static generation retirement requires its exact durable tombstone.");
    }
    if (row.active_generation_id === input.generationId) {
      throw new Error("Active static generation cannot be destructively retired.");
    }
    if (row.rollback_generation_id === input.generationId) {
      const rollbackWindow = row.rollback_window;
      const checkpoint = row.transition_checkpoint;
      if (!ticket || rollbackWindow?.state !== "retirement-reserved" || checkpoint?.kind !== "retire-rollback" ||
        checkpoint?.previousGenerationId !== input.generationId || checkpoint?.reservedStep !== "retire-retained" ||
        checkpoint?.reservationId !== ticket.reservationId || checkpoint?.reservationExpiresAt !== ticket.reservationExpiresAt) {
        throw new Error("Retained static generation lacks the protected retirement transition authority.");
      }
    }
  }

  async discover(input) {
    const { generationId } = input;
    const key = this.key(input);
    const retained = this.containers.get(key);
    if (retained) return retained;
    const name = this.name(input);
    const workerName = `${name}-worker`;
    try {
      const [webInspection, workerInspection, webPort, workerPort] = await Promise.all([
        docker(["inspect", name]).then(({ stdout }) => JSON.parse(stdout)[0]),
        docker(["inspect", workerName]).then(({ stdout }) => JSON.parse(stdout)[0]),
        docker(["port", name, "3000/tcp"]).then(({ stdout }) => stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1]),
        docker(["port", workerName, "3002/tcp"]).then(({ stdout }) => stdout.trim().match(/127\.0\.0\.1:(\d+)$/u)?.[1])
      ]);
      if (!webPort || !workerPort || webInspection.Image !== workerInspection.Image || webInspection.Config.Labels?.["p9-fixture"] !== this.namespace || workerInspection.Config.Labels?.["p9-fixture"] !== this.namespace) {
        throw new Error("Retained release generation identity is invalid.");
      }
      const container = {
        applicationId: input.applicationId, environment: input.environment, generationId,
        name, workerName, imageId: webInspection.Image, url: `http://127.0.0.1:${webPort}`, workerUrl: `http://127.0.0.1:${workerPort}`,
        workerControlToken: sha256(`${this.namespace}:${input.applicationId}:${input.environment}:${generationId}:release-worker-control`)
      };
      this.containers.set(key, container);
      return container;
    } catch {
      return undefined;
    }
  }
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
  const controlToken = required("P9_CONTROL_TOKEN");
  const gatewayUrl = required("P9_GATEWAY_URL");
  if (!Number.isInteger(controlPort)) throw new Error("Deployment supervisor requires a fixed control port.");
  const [greenBuild, blueBuild, trust] = await Promise.all([json(required("P9_BUILD_RESULT_PATH")), json(required("P9_BASE_BUILD_PATH")), json(required("P9_BUILDER_TRUST_POLICY_PATH"))]);
  const authority = new TrustedStaticApplicationBuildAuthority({ [trust.builderIdentity]: { publicKey: trust.publicKey, authority: trust.authority } });
  const artifacts = new ArtifactProvider(new Map([[blueBuild.imageDigest, blueBuild], [greenBuild.imageDigest, greenBuild]]));
  const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date() }, authority);
  const migrations = new CompatibilityMigrations(pool);
  const generations = new DockerGenerationHost({ network, artifacts, pool, now: () => new Date(), transitionAuthority: store });
  const releases = new PostgresTrustedBuildDeploymentClient(pool);
  const gateway = { converge: async (ticket) => {
    await store.assertTransitionTicket(ticket);
    if (await store.readServingGeneration(ticket) !== ticket.generationId) throw new StaticDeploymentEffectNotDispatchedError("Static runtime and authorization inventory has not converged to the promoted generation.");
    if (generations.failGatewayOnce) { generations.failGatewayOnce = false; throw new StaticDeploymentEffectNotDispatchedError("simulated post-commit gateway crash"); }
    const route = await pool.query(
      "select url from p9_static_process_routes where application_id=$1 and environment=$2 and generation_id=$3",
      [ticket.applicationId, ticket.environment, ticket.generationId]
    );
    if (!route.rows[0]) throw new Error("Stable process gateway cannot resolve the promoted generation route.");
  } };
  const realtime = { reconnectAndResync: async (ticket) => {
    await store.assertTransitionTicket(ticket);
    const response = await fetch(`${gatewayUrl}/p9-authority`);
    const current = response.ok && await response.json();
    if (!current || current.generation !== ticket.activeGenerationId) throw new Error("Stable process gateway has not consumed the atomic PostgreSQL promotion.");
  } };
  const supervisor = new DeploymentSupervisor(authority, artifacts, migrations, generations, store, gateway, realtime);
  let crashAfterCommitOnce = false;

  function authenticated(request) {
    const supplied = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(controlToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

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
    if (!inserted.rows[0]) await pool.query("update p9_static_deployment_commands set status='running', result_json=null, error_code=null, error_message=null, updated_at=now() where command_id=$1", [command.commandId]);
    return { digest, recovering: !inserted.rows[0] && ["running", "failed"].includes(row.status) };
  }
  async function releaseContext(command) {
    const request = await releases.readRequest(command.buildRequestDigest);
    if (!request || !["builder-attested", "deployment-requested", "deployed"].includes(request.status) ||
      request.applicationId !== command.applicationId || request.environment !== command.environment ||
      request.sourceCommit !== greenBuild.change.targetSourceCommit || request.changePlanDigest !== greenBuild.change.planDigest ||
      request.buildEvidenceDigest !== digestJson(greenBuild.evidence) || request.applicationDigest !== greenBuild.applicationDigest ||
      request.imageDigest !== greenBuild.imageDigest) {
      throw commandError(409, "Deployment command is not bound to the attested durable release authority.", "AUTHORITY_MISMATCH");
    }
    return request;
  }
  async function verified(command) {
    const request = await releaseContext(command);
    if (!["deployment-requested", "deployed"].includes(request.status) || !greenGenerationIds.has(command.generationId)) {
      throw commandError(409, "Promotion command does not match its trusted static release.", "AUTHORITY_MISMATCH");
    }
    return { request, build: authority.verify(greenBuild.change, greenBuild.evidence) };
  }
  async function promotionContext(command) {
    if (!command.operationId) throw commandError(409, "Promotion command requires durable lifecycle admission.", "REVISION_CONFLICT");
    if (command.deliveryClass !== "platform-plugin") throw commandError(409, "Promotion command has an invalid lifecycle delivery class.", "REVISION_CONFLICT");
    const operation = (await pool.query(
      "select * from public.k_nex_static_lifecycle_admission($1,$2,$3,$4)",
      [command.operationId, command.applicationId, command.environment, command.extensionId]
    )).rows[0];
    const plan = operation?.plan_json;
    const install = plan?.plan;
    const invalid = !operation ? ["operation"] : [
      ["expected-revision", operation.expected_revision === command.lifecycleExpectedRevision],
      ["phase", ["source-change-ready", "build-attested", "zero-downtime-eligible", "rollback-window-open"].includes(operation.phase)],
      ["execution-class", plan?.executionClass === "static-release"],
      ["operation-id", plan?.operationId === operation.operation_id],
      ["generation", plan?.generationId === command.generationId],
      ["install-operation", install?.operationId === operation.operation_id],
      ["extension", install?.id === command.extensionId],
      ["install-revision", install?.expectedRevision === operation.expected_revision],
      ["install-generation", install?.targetGenerationId === command.generationId],
      ["source-change", canonicalJson(plan?.sourceChange) === canonicalJson(greenBuild.change)],
      ["build-request", plan?.deployment?.buildRequestDigest === command.buildRequestDigest],
      ["source-commit", plan?.deployment?.sourceCommit === greenBuild.change.targetSourceCommit]
    ].filter(([, valid]) => !valid).map(([name]) => name);
    if (invalid.length > 0) {
      throw commandError(409, `Promotion command does not bind the exact persisted lifecycle release plan: ${invalid.join(", ")}.`, "REVISION_CONFLICT");
    }
    return {
      operationId: operation.operation_id,
      expectedRevision: operation.expected_revision,
      extensionId: command.extensionId,
      quarantineRecovery: plan.quarantineRecovery === true
    };
  }
  async function maintenanceContext(command) {
    if (command.deliveryClass !== "platform-plugin") throw commandError(409, "Maintenance command has an invalid lifecycle delivery class.", "MAINTENANCE_OPERATION_MISMATCH");
    const operation = (await pool.query(
      "select * from public.k_nex_static_impact_plan($1,$2,$3,$4)",
      [command.operationId, command.applicationId, command.environment, command.extensionId]
    )).rows[0];
    if (!operation || operation.phase !== "planning" ||
      operation.expected_revision !== command.expectedRevision) {
      throw commandError(409, "Maintenance command does not bind the persisted runtime operation owner or revision.", "MAINTENANCE_OPERATION_MISMATCH");
    }
    let plan;
    try {
      plan = operation.plan_json;
      if (plan?.executionClass !== "static-release" || plan.operationId !== operation.operation_id || plan.generationId !== command.generationId ||
        plan.preparation !== "impact-only") {
        throw new Error("invalid static operation plan");
      }
      const install = ExtensionInstallPlanSchema.parse(plan.plan);
      if (install.deliveryClass !== "platform-plugin" || install.id !== command.extensionId || install.operationId !== operation.operation_id ||
        install.expectedRevision !== operation.expected_revision || install.targetGenerationId !== command.generationId ||
        operation.application_id !== command.applicationId || operation.environment !== command.environment) {
        throw new Error("static plan binding mismatch");
      }
      if (install.availability.outcome !== "maintenance-required") {
        throw new Error("online operation cannot be relabeled as maintenance");
      }
    } catch {
      throw commandError(409, "Maintenance command is not bound to an offline-required persisted static plan.", "MAINTENANCE_OPERATION_MISMATCH");
    }
    return { plan };
  }
  async function receiptForRevision(owner, revision) {
    const row = await pool.query("select event_json from runtime_static_deployment_outbox where application_id=$1 and environment=$2 and revision=$3", [owner.applicationId, owner.environment, revision]);
    if (!row.rows[0]) throw commandError(409, "PostgreSQL promotion receipt is unavailable for recovery.");
    return row.rows[0].event_json;
  }
  async function execute(command, recovering) {
    const owner = { applicationId: command.applicationId, environment: command.environment };
    if (command.operation === "bootstrap") {
      await releaseContext(command);
      if (command.generationId !== "customer-alpha-blue-11" || command.buildRequestDigest !== greenBuild.buildRequestDigest ||
        command.compositionChangePlanDigest !== digestJson(greenBuild.change.change.base) ||
        command.buildEvidenceDigest !== digestJson({ sourceCommit: blueBuild.sourceCommit, imageDigest: blueBuild.imageDigest })) {
        throw commandError(409, "Bootstrap command is not bound to the approved static release context.", "AUTHORITY_MISMATCH");
      }
      const blue = { generationId: command.generationId, sourceCommit: blueBuild.sourceCommit, compositionChangePlanDigest: command.compositionChangePlanDigest, buildEvidenceDigest: command.buildEvidenceDigest, applicationDigest: blueBuild.applicationDigest, imageDigest: blueBuild.imageDigest, imageReference: blueBuild.imageReference, migrationRevision: 11 };
      await store.initialize({ ...owner, generation: blue, workerOwner: command.workerOwner, workerFencingToken: 1, workerLeaseExpiresAt: command.workerLeaseExpiresAt });
      await generations.start({ ...owner, generationId: blue.generationId, imageReference: blue.imageReference, workerMode: "passive" });
      await generations.readiness({ ...owner, generationId: blue.generationId, sourceCommit: blue.sourceCommit, applicationDigest: blue.applicationDigest, imageDigest: blue.imageDigest, migrationRevision: 11, completedMigrationSteps: [] });
      await supervisor.recover(owner, { initialActivation: true, workerLeaseDurationMs: generations.workerLeaseMs });
      return { operation: "bootstrap", generationId: blue.generationId, revision: 0 };
    }
    if (command.operation === "release-request") {
      const request = await releases.readRequest(digestJson({ operationId: command.operationId, actor: command.authorization?.actor, change: command.change }));
      if (!request || canonicalJson(command.change) !== canonicalJson(greenBuild.change) || request.buildRequestDigest !== greenBuild.buildRequestDigest) throw commandError(409, "PluginManager release intent does not match the builder-owned durable request.", "AUTHORITY_MISMATCH");
      return request;
    }
    if (command.operation === "release-reverify") return { verified: await releases.reverify(command.authority) };
    if (command.operation === "validate-online-migration") {
      await releaseContext(command);
      if (canonicalJson(command.migration) !== canonicalJson(greenBuild.change.change.migration)) throw Object.assign(new Error("Migration authority rejected an incompatible relabeled plan."), { code: "MIGRATION_LABEL_REJECTED" });
      return { completed: await migrations.runOnline(greenBuild.change.change.migration) };
    }
    if (command.operation === "maintenance-required") {
      await maintenanceContext(command);
      return Object.freeze({ outcome: "maintenance-required", reasons: ["offline-migration"] });
    }
    if (command.operation === "worker-effect") {
      const state = await store.read(owner);
      if (!state || state.active.generationId !== command.generationId || state.revision !== command.expectedRevision) throw commandError(409, "Worker effect command is not bound to the active deployment revision.", "REVISION_CONFLICT");
      return generations.executeEffect({ ...owner, generationId: command.generationId }, { effectId: command.effectId, payload: command.payload, delayMs: command.delayMs });
    }
    if (command.operation === "drain-with-ticket") return generations.drain(command.ticket);
    if (command.operation === "arm-gateway-failure") { generations.failGatewayOnce = true; return { armed: true }; }
    if (command.operation === "arm-health-failure") { generations.failHealthOnce = true; return { armed: true }; }
    if (command.operation === "arm-worker-start-failure") { generations.failWorkerStartOnce = true; return { armed: true }; }
    if (command.operation === "arm-readiness-failure") { generations.failReadinessOnce = true; return { armed: true }; }
    if (command.operation === "arm-worker-only-survivor") { generations.failWebAfterWorkerStartOnce = true; return { armed: true }; }
    if (command.operation === "arm-transition-worker-loss") { generations.loseTransitionWorkerOnce = true; return { armed: true }; }
    if (command.operation === "arm-retirement-reservation-crash") { generations.crashAfterRetirementReservationOnce = true; return { armed: true }; }
    if (command.operation === "arm-response-crash") { crashAfterCommitOnce = true; return { armed: true }; }
    if (command.operation === "cleanup") { await generations.close(); return { cleaned: true }; }
    if (["restart", "recover", "close-rollback", "contract-cleanup", "rollback"].includes(command.operation)) await releaseContext(command);
    if (["restart", "recover", "close-rollback", "contract-cleanup"].includes(command.operation)) {
      const state = await store.read(owner);
      const generationBound = state && [state.active.generationId, state.rollback?.generationId].includes(command.generationId);
      const authorizedRestart = command.operation === "restart" && command.generationId === "customer-alpha-green-12";
      if (!state || state.revision !== command.expectedRevision || (!generationBound && !authorizedRestart)) {
        throw commandError(409, "Deployment command revision or generation binding is stale.", "REVISION_CONFLICT");
      }
    }
    if (command.operation === "restart") return generations.restart({ ...command, imageReference: command.generationId === "customer-alpha-blue-11" ? blueBuild.imageReference : greenBuild.imageReference });
    if (command.operation === "recover") { await supervisor.recover(owner, { workerLeaseDurationMs: generations.workerLeaseMs }); return { operation: "recover", generationId: (await store.read(owner))?.active.generationId }; }
    if (command.operation === "close-rollback") return supervisor.closeRollback(owner);
    if (command.operation === "contract-cleanup") return { completed: await supervisor.runContractCleanup(owner, greenBuild.change.change.migration) };
    if (command.operation === "rollback") {
      const state = await store.read(owner);
      if (!state || state.revision !== command.expectedRevision || state.rollback?.generationId !== command.generationId) throw commandError(409, "Rollback command revision or retained generation is stale.", "REVISION_CONFLICT");
      return supervisor.rollback({ ...owner, workerOwner: command.workerOwner, workerLeaseExpiresAt: command.workerLeaseExpiresAt });
    }
    if (command.operation !== "promote") throw commandError(400, "Deployment command operation is not accepted.");
    const lifecycleAdmission = await promotionContext(command);
    const { request, build } = await verified(command);
    const state = await store.read(owner);
    if (!state) throw commandError(409, "Static deployment is not initialized.");
    if (recovering && state.active.generationId === command.generationId) {
      await supervisor.recover(owner, { workerLeaseDurationMs: generations.workerLeaseMs });
      const receipt = await receiptForRevision(owner, state.revision);
      if (receipt.activeGenerationId !== command.generationId) throw commandError(409, "Recovered promotion receipt does not bind the active generation.", "REVISION_CONFLICT");
      if (request.status === "deployment-requested") await releases.recordDeployment({ buildRequestDigest: request.buildRequestDigest, expectedVersion: request.version, receipt });
      return { outcome: "promoted", receipt, recovered: true };
    }
    const outcome = await supervisor.deploy({ build, generationId: command.generationId, workerOwner: command.workerOwner, workerLeaseExpiresAt: command.workerLeaseExpiresAt, lifecycleAdmission });
    if (outcome.outcome === "promoted" && request.status === "deployment-requested") await releases.recordDeployment({ buildRequestDigest: request.buildRequestDigest, expectedVersion: request.version, receipt: outcome.receipt });
    await event("supervisor-lifecycle-executed", { operation: command.operation, generationId: command.generationId, buildRequestDigest: command.buildRequestDigest, outcome: outcome.outcome, backfillBatches: migrations.backfillBatches });
    return outcome;
  }

  const server = createServer(async (request, response) => {
    const send = (status, value) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    try {
      if (request.method !== "POST" || request.url !== "/commands") throw commandError(404, "Unknown deployment supervisor endpoint.");
      if (!authenticated(request)) throw commandError(401, "Deployment supervisor command authentication failed.", "COMMAND_UNAUTHORIZED");
      const command = await requestBody(request);
      const started = await begin(command);
      if (started.replay) return send(200, started.replay);
      try {
        const result = await execute(command, command.operation === "promote" && started.recovering === true);
        if (crashAfterCommitOnce && command.operation === "promote" && result?.outcome === "promoted") process.kill(process.pid, "SIGKILL");
        const envelope = { commandId: command.commandId, commandDigest: started.digest, operation: command.operation, generationId: command.generationId, buildRequestDigest: command.buildRequestDigest, result };
        await save(command, "succeeded", envelope);
        return send(200, envelope);
      } catch (error) {
        await save(command, "failed", undefined, error);
        throw error;
      }
    } catch (error) { return send(error.status ?? 500, { error: error.message, code: error.code ?? "SUPERVISOR_FAILURE" }); }
  });
  const controlBindAddress = process.env.P9_CONTROL_BIND_ADDRESS ?? "127.0.0.1";
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(controlPort, controlBindAddress, resolve); });
  const owner = { applicationId: "customer-alpha", environment: "production" };
  if (await store.read(owner)) await supervisor.recover(owner, { workerLeaseDurationMs: generations.workerLeaseMs });
  await event("supervisor-recovered", { controlPort, processId: process.pid });
  const controlUrlHost = controlBindAddress === "0.0.0.0" ? "127.0.0.1" : controlBindAddress;
  ready({ url: `http://${controlUrlHost}:${server.address().port}` });
}
