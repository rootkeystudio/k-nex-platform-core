import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { PostgresStaticDeploymentStore, PostgresTrustedBuildDeploymentClient } from "@k-nex/payload-adapter";

const execute = promisify(execFile);
const role = process.env.P9_PROCESS_ROLE;
const databaseUrl = process.env.DATABASE_URL;
const instance = process.env.P9_PROCESS_INSTANCE;
const generation = process.env.P9_PROCESS_GENERATION;
const controlPort = Number(process.env.P9_CONTROL_PORT);

if (!role || !databaseUrl || !instance) throw new Error("Phase 9 process topology requires a role, instance, and PostgreSQL authority.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
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

async function verifyBuilder() {
  const reference = process.env.P9_IMAGE_DIGEST;
  const sourceCommit = process.env.P9_SOURCE_COMMIT;
  const requestDigest = process.env.P9_BUILD_REQUEST_DIGEST;
  const evidenceDigest = process.env.P9_BUILD_EVIDENCE_DIGEST;
  const applicationDigest = process.env.P9_APPLICATION_DIGEST;
  if (!reference || !sourceCommit || !requestDigest || !evidenceDigest || !applicationDigest) throw new Error("Builder process is missing immutable source/build request authority.");
  const releases = new PostgresTrustedBuildDeploymentClient(pool);
  const request = await releases.readRequest(requestDigest);
  if (!request || request.sourceCommit !== sourceCommit || !["build-requested", "builder-attested", "deployment-requested", "deployed"].includes(request.status)) {
    throw new Error("Builder process rejected an unknown or conflicting durable build request.");
  }
  const inspection = JSON.parse((await execute("docker", ["image", "inspect", reference], { maxBuffer: 1024 * 1024 })).stdout)[0];
  if (inspection.Id !== reference || inspection.Config.Labels["org.opencontainers.image.revision"] !== sourceCommit) {
    throw new Error("Builder process rejected image/source attestation.");
  }
  await releases.attestBuild({ buildRequestDigest: requestDigest, expectedVersion: request.version, sourceCommit, buildEvidenceDigest: evidenceDigest, applicationDigest, imageDigest: inspection.Id });
  await event("builder-attested", { imageDigest: inspection.Id, sourceCommit });
  ready({ imageDigest: inspection.Id });
  stayAlive();
}

async function recoverSourceAuthority() {
  const sourceDirectory = process.env.P9_SOURCE_DIRECTORY;
  const sourceCommit = process.env.P9_SOURCE_COMMIT;
  if (!sourceDirectory || !sourceCommit) throw new Error("Source authority process is missing its customer checkout identity.");
  const checkpoint = await pool.query(
    "select change_json->'target'->>'sourceCommit' target_source_commit from runtime_static_composition_checkpoints where application_id='customer-alpha' and environment='production' and status='committed' order by committed_at desc limit 1"
  );
  const head = (await execute("git", ["rev-parse", "HEAD"], { cwd: sourceDirectory })).stdout.trim();
  if (checkpoint.rows.length !== 1 || checkpoint.rows[0].target_source_commit !== sourceCommit || head !== sourceCommit) {
    throw new Error("Source authority process rejected a checkout not bound to the committed expected-base composition checkpoint.");
  }
  await event("source-recovered", { sourceCommit: head });
  ready({ sourceCommit: head });
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
  const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date("2026-08-29T12:00:00.000Z") });
  let effectHandled = false;
  await event("worker-passive");
  ready({ mode: "passive" });
  const tick = async () => {
    const fence = await pool.query("select fencing_token, active_execution_generation from runtime_worker_generation_fences where application_id='customer-alpha' and environment='production'");
    const active = fence.rows[0]?.active_execution_generation === generation;
    await event(active ? "worker-active" : "worker-passive", { active });
    if (active && effectId && !effectHandled) {
      const claim = await store.claimEffect({ applicationId: "customer-alpha", environment: "production", effectId, generationId: generation, fencingToken: Number(fence.rows[0].fencing_token), claimantId: instance, claimLeaseExpiresAt: "2026-08-29T12:02:00.000Z" });
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

if (role === "source-authority") await recoverSourceAuthority();
else if (role === "builder") await verifyBuilder();
else if (role === "deployer" || role === "supervisor") await observeAuthority();
else if (role === "worker") await worker();
else if (role === "gateway") await gateway();
else if (role === "realtime-client") await realtime();
else throw new Error(`Unknown Phase 9 topology role: ${role}`);
