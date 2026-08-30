import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import pg from "pg";

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
let mode = "passive";
let fencingToken;

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
    if (request.method === "GET" && request.url === "/status") return send(200, { mode, generationId, fencingToken, sourceCommit, applicationDigest, imageDigest, module: release.plugin.id, pluginVersion: release.plugin.version });
    if (request.method !== "POST" || !["/activate", "/drain"].includes(request.url ?? "") || !authenticated(request)) return send(401, { error: "Release worker command is unauthorized." });
    if (request.url === "/activate") {
      const command = await body(request);
      const fence = await currentFence();
      if (fence?.active_execution_generation !== generationId || Number(fence?.fencing_token) !== command.fencingToken) return send(409, { error: "Persisted worker fence does not authorize this immutable release worker." });
      fencingToken = Number(fence.fencing_token);
      mode = "active";
      await event("worker-activated", { mode, promotionRevision: command.promotionRevision });
    } else {
      mode = "drained";
      await event("worker-drained", { mode });
    }
    return send(200, { mode, generationId, fencingToken });
  } catch (error) {
    return send(500, { error: error.message });
  }
}).listen(port, "0.0.0.0");
