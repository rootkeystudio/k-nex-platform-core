import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PostgresStaticDeploymentStore } from "@k-nex/payload-adapter";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the release worker.`);
  return value;
};

const generationId = required("K_NEX_GENERATION");
const controlToken = required("K_NEX_WORKER_CONTROL_TOKEN");
const port = Number(required("P9_RELEASE_WORKER_PORT"));
const sourceCommit = required("K_NEX_SOURCE_COMMIT");
const applicationDigest = required("K_NEX_APPLICATION_DIGEST");
const imageDigest = required("K_NEX_IMAGE_DIGEST");
if (!Number.isInteger(port)) throw new Error("The release worker control port must be an integer.");

const release = JSON.parse(await readFile(new URL("./release.json", import.meta.url), "utf8"));
if (release.plugin?.id !== "module.sales") throw new Error("The release worker image must carry only the attested Sales module fixture.");
const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 1 });
const store = new PostgresStaticDeploymentStore(pool, { now: () => new Date() });
let mode = "passive";
let fencingToken;
const inFlight = new Set();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function event(name, detail = {}) {
  await pool.query(
    "insert into p9_static_process_events (role, instance_id, event, generation_id, fencing_token, detail) values ('release-worker',$1,$2,$3,$4,$5::jsonb)",
    [`release-worker-${generationId}`, name, generationId, fencingToken ?? null, JSON.stringify({ sourceCommit, applicationDigest, imageDigest, module: release.plugin.id, version: release.plugin.version, ...detail })]
  );
}

async function currentFence() {
  const result = await pool.query("select fencing_token, active_execution_generation from runtime_worker_generation_fences where application_id='customer-alpha' and environment='production'");
  return result.rows[0];
}

function authenticated(request) {
  return request.headers["x-p9-worker-control"] === controlToken;
}

async function executeEffect(command) {
  if (mode !== "active") throw new Error("Only the active fenced release worker may execute effects.");
  if (typeof command.effectId !== "string" || !command.effectId || typeof command.payload !== "string" || !Number.isInteger(command.delayMs) || command.delayMs < 0 || command.delayMs > 30_000) {
    throw new Error("Release worker effect command is invalid.");
  }
  const fence = await currentFence();
  if (fence?.active_execution_generation !== generationId || Number(fence?.fencing_token) !== fencingToken) throw new Error("Persisted worker fence no longer authorizes this release worker.");
  const claim = await store.claimEffect({
    applicationId: "customer-alpha", environment: "production", effectId: command.effectId, generationId, fencingToken,
    claimantId: `release-worker-${generationId}`, claimLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString()
  });
  if (claim.status !== "claimed") return { status: claim.status, externalIdempotencyKey: claim.externalIdempotencyKey };
  await event("worker-effect-started", { effectId: command.effectId, claimToken: claim.claimToken });
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
    await store.completeEffect({ applicationId: "customer-alpha", environment: "production", effectId: command.effectId, generationId, fencingToken, claimToken: claim.claimToken, resultDigest });
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
    if (request.method !== "POST" || !["/activate", "/activate-bootstrap", "/drain", "/execute"].includes(request.url ?? "") || !authenticated(request)) return send(401, { error: "Release worker command is unauthorized." });
    if (request.url === "/activate") {
      const command = await body(request);
      if (command.generationId !== generationId) return send(409, { error: "Transition ticket does not target this immutable release worker.", code: "FENCE_REJECTED" });
      try {
        await store.assertTransitionTicket(command);
      } catch (error) {
        await event("worker-activation-rejected", { code: error?.code ?? "FENCE_REJECTED", ticketRevision: command.revision, ticketFencingToken: command.fencingToken });
        return send(409, { error: error.message, code: error?.code ?? "FENCE_REJECTED" });
      }
      const fence = await currentFence();
      if (fence?.active_execution_generation !== generationId || Number(fence?.fencing_token) !== command.fencingToken) return send(409, { error: "Persisted worker fence does not authorize this immutable release worker." });
      fencingToken = Number(fence.fencing_token);
      mode = "active";
      await event("worker-activated", { mode, promotionRevision: command.promotionRevision });
    } else if (request.url === "/activate-bootstrap") {
      const command = await body(request);
      const fence = await currentFence();
      if (fence?.active_execution_generation !== generationId || Number(fence?.fencing_token) !== command.fencingToken) return send(409, { error: "Persisted worker fence does not authorize this immutable release worker." });
      fencingToken = Number(fence.fencing_token);
      mode = "active";
      await event("worker-bootstrap-activated", { mode, promotionRevision: command.promotionRevision });
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
