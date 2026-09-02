import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter/static-deployment-store";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the release worker.`);
  return value;
};

const generationId = required("K_NEX_GENERATION");
const imageGenerationId = required("K_NEX_IMAGE_GENERATION");
const controlToken = required("K_NEX_WORKER_CONTROL_TOKEN");
const port = Number(required("P9_RELEASE_WORKER_PORT"));
const sourceCommit = required("K_NEX_SOURCE_COMMIT");
const applicationDigest = required("K_NEX_APPLICATION_DIGEST");
const imageDigest = required("K_NEX_IMAGE_DIGEST");
if (!Number.isInteger(port)) throw new Error("The release worker control port must be an integer.");

const release = JSON.parse(await readFile(new URL("./release.json", import.meta.url), "utf8"));
if (release.plugin?.id !== "module.sales") throw new Error("The release worker image must carry only the attested Sales module fixture.");
if (release.generationId !== imageGenerationId) throw new Error("The release worker image generation must match its immutable image metadata.");
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 1 });
const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date() });
let mode = "passive";
let fencingToken;
let workerAuthority;
let heartbeat;
let heartbeatEpoch = 0;
let renewalQueue = Promise.resolve();
const inFlight = new Set();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const heartbeatMs = Number(process.env.P9_WORKER_HEARTBEAT_MS ?? "250");
const leaseDurationMs = Number(process.env.P9_WORKER_LEASE_MS ?? "1000");
const fixtureClockSkewMs = Number(process.env.P9_WORKER_CLOCK_SKEW_MS ?? "0");
if (!Number.isInteger(heartbeatMs) || heartbeatMs < 100 || heartbeatMs > 30_000) throw new Error("P9_WORKER_HEARTBEAT_MS must be between 100 and 30000.");
if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 300_000 || heartbeatMs >= leaseDurationMs) throw new Error("P9_WORKER_LEASE_MS must be 1000..300000 and exceed P9_WORKER_HEARTBEAT_MS.");
if (!Number.isInteger(fixtureClockSkewMs) || Math.abs(fixtureClockSkewMs) > 300_000) throw new Error("P9_WORKER_CLOCK_SKEW_MS must be an integer between -300000 and 300000.");
if (fixtureClockSkewMs) {
  // Fixture-only: makes a retained local-clock lease admission fail under skew.
  const dateNow = Date.now.bind(Date);
  Date.now = () => dateNow() + fixtureClockSkewMs;
}

async function event(name, detail = {}) {
  await pool.query(
    "insert into p9_static_process_events (role, instance_id, event, generation_id, fencing_token, detail) values ('release-worker',$1,$2,$3,$4,$5::jsonb)",
    [`release-worker-${generationId}`, name, generationId, fencingToken ?? null, JSON.stringify({ sourceCommit, applicationDigest, imageDigest, module: release.plugin.id, version: release.plugin.version, fixtureClockSkewMs, ...detail })]
  );
}

async function currentFence(authority = workerAuthority) {
  if (!authority) throw new Error("Release worker has no validated authority.");
  const result = await pool.query(
    "select fencing_token, active_execution_generation, lease_owner, lease_expires_at, promotion_revision from runtime_worker_generation_fences where application_id=$1 and environment=$2",
    [authority.applicationId, authority.environment]
  );
  return result.rows[0];
}

async function renewWorkerFence(authority, durationMs = leaseDurationMs) {
  if (!authority) throw new Error("Release worker has no validated authority.");
  const fence = await store.renewWorkerFence({
    applicationId: authority.applicationId, environment: authority.environment, generationId,
    fencingToken: authority.fencingToken, owner: authority.leaseOwner,
    expectedPromotionRevision: authority.promotionRevision, leaseDurationMs: durationMs
  });
  await event("worker-fence-renewed", { leaseOwner: authority.leaseOwner, promotionRevision: authority.promotionRevision, expiresAt: fence.lease.expiresAt, fixtureClockSkewMs });
}

function queueFenceRenewal(authority, durationMs = leaseDurationMs) {
  const result = renewalQueue.then(() => renewWorkerFence(authority, durationMs), () => renewWorkerFence(authority, durationMs));
  renewalQueue = result.catch(() => undefined);
  return result;
}

function stopHeartbeat() {
  heartbeatEpoch += 1;
  clearTimeout(heartbeat);
  heartbeat = undefined;
}

function startHeartbeat(authority) {
  stopHeartbeat();
  const epoch = heartbeatEpoch;
  const tick = () => {
    heartbeat = setTimeout(async () => {
      try {
        await queueFenceRenewal(authority);
        if (mode === "active" && heartbeatEpoch === epoch && workerAuthority === authority) tick();
      } catch (error) {
        if (heartbeatEpoch !== epoch || workerAuthority !== authority) return;
        mode = "passive";
        stopHeartbeat();
        await event("worker-heartbeat-rejected", { code: error?.code ?? "FENCE_REJECTED" }).catch(() => undefined);
      }
    }, heartbeatMs);
    heartbeat.unref();
  };
  tick();
}

function authenticated(request) {
  return request.headers["x-p9-worker-control"] === controlToken;
}

async function executeEffect(command) {
  if (mode !== "active") throw new Error("Only the active fenced release worker may execute effects.");
  if (!workerAuthority) throw new Error("Active release worker has no validated deployment owner.");
  const authority = workerAuthority;
  if (typeof command.effectId !== "string" || !command.effectId || typeof command.payload !== "string" || !Number.isInteger(command.delayMs) || command.delayMs < 0 || command.delayMs > 30_000) {
    throw new Error("Release worker effect command is invalid.");
  }
  const effectLeaseDurationMs = Math.max(leaseDurationMs, command.delayMs + 5_000);
  await queueFenceRenewal(authority, effectLeaseDurationMs);
  const fence = await currentFence(authority);
  if (fence?.active_execution_generation !== generationId || Number(fence?.fencing_token) !== fencingToken) throw new Error("Persisted worker fence no longer authorizes this release worker.");
  const claimLeaseDurationMs = command.delayMs + 4_000;
  const claim = await store.claimEffect({
    applicationId: workerAuthority.applicationId, environment: workerAuthority.environment, effectId: command.effectId, generationId, fencingToken,
    claimantId: `release-worker-${generationId}`, claimLeaseDurationMs
  });
  if (claim.status !== "claimed") return { status: claim.status, externalIdempotencyKey: claim.externalIdempotencyKey };
  await event("worker-effect-started", { effectId: command.effectId, claimToken: claim.claimToken, claimLeaseDurationMs });
  await delay(command.delayMs);
  const resultDigest = sha256(command.payload);
  const inserted = await pool.query(
    "insert into p9_static_external_effects (idempotency_key, result_digest) values ($1,$2) on conflict (idempotency_key) do nothing returning result_digest",
    [claim.externalIdempotencyKey, resultDigest]
  );
  const recorded = inserted.rows[0] ?? (await pool.query("select result_digest from p9_static_external_effects where idempotency_key=$1", [claim.externalIdempotencyKey])).rows[0];
  if (!recorded || recorded.result_digest !== resultDigest) throw new Error("External effect idempotency reconciliation failed.");
  await event("worker-effect-delivered", { effectId: command.effectId, resultDigest, externalIdempotencyKey: claim.externalIdempotencyKey });
  try {
    await store.completeEffect({ applicationId: workerAuthority.applicationId, environment: workerAuthority.environment, effectId: command.effectId, generationId, fencingToken, claimToken: claim.claimToken, resultDigest });
    await event("worker-effect-completed", { effectId: command.effectId, resultDigest, externalIdempotencyKey: claim.externalIdempotencyKey });
    return { status: "completed", resultDigest, externalIdempotencyKey: claim.externalIdempotencyKey };
  } catch (error) {
    if (error?.code !== "FENCE_REJECTED") throw error;
    await event("worker-stale-completion-rejected", { effectId: command.effectId, resultDigest, externalIdempotencyKey: claim.externalIdempotencyKey });
    return { status: "stale-completion-rejected", resultDigest, externalIdempotencyKey: claim.externalIdempotencyKey };
  }
}

async function body(request) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 16 * 1024) throw new Error("Release worker command is too large.");
  }
  return JSON.parse(value || "{}");
}

await event("worker-passive", { mode });
createServer(async (request, response) => {
  const send = (status, value) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  try {
    if (request.method === "GET" && request.url === "/status") return send(200, { mode, generationId, fencingToken, inFlight: inFlight.size, sourceCommit, applicationDigest, imageDigest, module: release.plugin.id, pluginVersion: release.plugin.version });
    if (request.method !== "POST" || !["/activate", "/activate-recovery", "/drain", "/execute"].includes(request.url ?? "") || !authenticated(request)) return send(401, { error: "Release worker command is unauthorized." });
    if (request.url === "/activate") {
      const command = await body(request);
      if (command.generationId !== generationId) return send(409, { error: "Transition ticket does not target this immutable release worker.", code: "FENCE_REJECTED" });
      try {
        await store.assertTransitionTicket(command);
      } catch (error) {
        await event("worker-activation-rejected", { code: error?.code ?? "FENCE_REJECTED", ticketRevision: command.revision, ticketFencingToken: command.fencingToken });
        return send(409, { error: error.message, code: error?.code ?? "FENCE_REJECTED" });
      }
      try {
        await queueFenceRenewal(command);
        await store.assertTransitionTicket(command);
      } catch (error) {
        return send(409, { error: error.message, code: error?.code ?? "FENCE_REJECTED" });
      }
      workerAuthority = command;
      fencingToken = command.fencingToken;
      mode = "active";
      startHeartbeat(command);
      await event("worker-activated", { mode, promotionRevision: command.promotionRevision });
    } else if (request.url === "/activate-recovery") {
      const command = await body(request);
      if (command.generationId !== generationId) return send(409, { error: "Recovery ticket does not target this immutable release worker.", code: "FENCE_REJECTED" });
      try {
        await store.assertWorkerRecoveryActivation(command);
        await queueFenceRenewal(command);
        await store.assertWorkerRecoveryActivation(command);
      } catch (error) {
        await event("worker-recovery-activation-rejected", { code: error?.code ?? "FENCE_REJECTED", ticketRevision: command.revision, ticketFencingToken: command.fencingToken });
        return send(409, { error: error.message, code: error?.code ?? "FENCE_REJECTED" });
      }
      workerAuthority = command;
      fencingToken = command.fencingToken;
      mode = "active";
      startHeartbeat(command);
      await event("worker-recovery-activated", { mode, promotionRevision: command.promotionRevision });
    } else if (request.url === "/execute") {
      const command = await body(request);
      const work = executeEffect(command);
      inFlight.add(work);
      try { return send(200, await work); }
      finally { inFlight.delete(work); }
    } else {
      const command = await body(request);
      if (command.generationId !== generationId) {
        await event("worker-drain-rejected", { reason: "generation-mismatch", ticketGenerationId: command.generationId });
        return send(409, { error: "Drain ticket does not target this immutable release worker.", code: "FENCE_REJECTED" });
      }
      try {
        await store.assertTransitionTicket(command);
      } catch (error) {
        await event("worker-drain-rejected", { reason: "stale-ticket", code: error?.code ?? "FENCE_REJECTED", ticketRevision: command.revision, ticketFencingToken: command.fencingToken });
        return send(409, { error: error.message, code: error?.code ?? "FENCE_REJECTED" });
      }
      const draining = [...inFlight];
      mode = "draining";
      stopHeartbeat();
      await event("worker-draining", { mode, inFlight: draining.length });
      await Promise.all(draining);
      mode = "drained";
      await event("worker-drained", { mode, waitedFor: draining.length });
    }
    return send(200, { mode, generationId, fencingToken });
  } catch (error) {
    return send(500, { error: error.message });
  }
}).listen(port, "0.0.0.0");
