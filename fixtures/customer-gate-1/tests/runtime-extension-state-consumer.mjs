import { createServer } from "node:http";

import pg from "pg";

import { PostgresRuntimeExtensionStore } from "@k-nex/payload-adapter";
import { RuntimeExtensionRevisionConsumer } from "@k-nex/runtime";

const configuration = JSON.parse(process.env.P9_RUNTIME_CONSUMER_CONFIGURATION ?? "{}");
const required = ["databaseUrl", "role", "applicationId", "environment", "deliveryClass", "extensionId"];
if (!required.every((key) => typeof configuration[key] === "string" && configuration[key].length > 0) || !["web", "worker", "browser-host"].includes(configuration.role)) {
  throw new Error("Runtime extension consumer configuration is incomplete.");
}

const pool = new pg.Pool({ connectionString: configuration.databaseUrl });
const store = new PostgresRuntimeExtensionStore(pool, { now: () => new Date() }, configuration.auditKey ?? "sha256:7777777777777777777777777777777777777777777777777777777777777777");
const extension = { deliveryClass: configuration.deliveryClass, id: configuration.extensionId };
const pollIntervalMs = configuration.pollIntervalMs ?? 30_000;
if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 300_000) throw new Error("Runtime extension consumer polling interval is invalid.");

function emit(event, extra = {}) {
  process.stdout.write(`${JSON.stringify({ event, role: configuration.role, pid: process.pid, snapshot: consumer.snapshot(), ...extra })}\n`);
}

const consumer = new RuntimeExtensionRevisionConsumer(store, configuration.applicationId, configuration.environment, extension, {
  intervalMs: pollIntervalMs,
  onError(error) { emit("poll-error", { message: error instanceof Error ? error.message : "runtime-extension-poll-failed" }); }
});

async function combinedGeneration() {
  const result = await pool.query(
    `select g.generation_id, g.server_generation_id, g.ui_generation_id, g.storage_generation_id
       from runtime_extensions e join runtime_extension_generations g
         on g.application_id=e.application_id and g.environment=e.environment and g.delivery_class=e.delivery_class and g.extension_id=e.extension_id and g.generation_id=e.active_generation_id
      where e.application_id=$1 and e.environment=$2 and e.delivery_class=$3 and e.extension_id=$4`,
    [configuration.applicationId, configuration.environment, extension.deliveryClass, extension.id]
  );
  const generation = result.rows[0];
  return generation === undefined ? undefined : {
    generationId: generation.generation_id,
    serverGenerationId: generation.server_generation_id,
    uiGenerationId: generation.ui_generation_id,
    storageGenerationId: generation.storage_generation_id
  };
}

function respond(response, status, body, contentType = "application/json") {
  response.writeHead(status, { "cache-control": "no-store", "content-type": contentType, "x-content-type-options": "nosniff" });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

const browserDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; worker-src 'self'; script-src 'self'"></head><body><main id="runtime-extension-host">Runtime extension host</main><script type="module" src="/runtime-extension-browser-host.mjs"></script></body></html>`;

const browserHost = `
const worker = new Worker('/runtime-extension-browser-worker.mjs', { type: 'module' });
const channel = new MessageChannel(); let sequence = 0;
worker.postMessage({ type: 'connect' }, [channel.port2]);
window.runtimeExtensionState = (type) => new Promise((resolve, reject) => {
  const expected = ++sequence;
  const timeout = setTimeout(() => reject(new Error('Runtime extension browser host timed out.')), 5_000);
  channel.port1.onmessage = ({ data }) => { if (data?.sequence === expected) { clearTimeout(timeout); resolve(data); } };
  channel.port1.postMessage({ type, sequence: expected });
});
`;

const browserWorker = `let port; let polling = false; let timer; let latest; let autoPolls = 0;
const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/runtime-extension-state/poll', { method: 'POST', credentials: 'same-origin' });
    latest = await response.json(); autoPolls += 1;
  } finally {
    polling = false;
    timer = setTimeout(poll, ${pollIntervalMs});
  }
};
self.onmessage = ({ data, ports }) => {
  if (data?.type !== 'connect' || !ports[0]) return;
  port = ports[0];
  port.onmessage = async ({ data: command }) => {
    if (!['snapshot', 'poll'].includes(command?.type) || !Number.isSafeInteger(command.sequence)) return;
    if (command.type === 'poll') await poll();
    if (!latest) {
      const response = await fetch('/runtime-extension-state', { credentials: 'same-origin' });
      latest = await response.json();
    }
    port.postMessage({ ...latest, autoPolls, sequence: command.sequence });
  };
  port.start();
  void poll();
};`;

await consumer.poll();
consumer.start();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://runtime-extension.local");
    if (configuration.role === "browser-host" && request.method === "GET" && url.pathname === "/") return respond(response, 200, browserDocument, "text/html; charset=utf-8");
    if (configuration.role === "browser-host" && request.method === "GET" && url.pathname === "/runtime-extension-browser-host.mjs") return respond(response, 200, browserHost, "text/javascript; charset=utf-8");
    if (configuration.role === "browser-host" && request.method === "GET" && url.pathname === "/runtime-extension-browser-worker.mjs") return respond(response, 200, browserWorker, "text/javascript; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/runtime-extension-state") return respond(response, 200, { event: "snapshot", role: configuration.role, snapshot: consumer.snapshot(), combinedGeneration: await combinedGeneration() });
    if (request.method === "POST" && url.pathname === "/runtime-extension-state/poll") {
      const changed = await consumer.poll();
      return respond(response, 200, { event: "polled", role: configuration.role, changed, snapshot: consumer.snapshot(), combinedGeneration: await combinedGeneration() });
    }
    if (request.method === "POST" && url.pathname === "/shutdown") {
      respond(response, 200, { event: "closed" });
      consumer.stop();
      return void server.close(() => void pool.end().finally(() => process.exit(0)));
    }
    respond(response, 404, { error: "not-found" });
  } catch (error) {
    respond(response, 500, { error: error instanceof Error ? error.message : "runtime-extension-state-failed" });
  }
});

await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Runtime extension consumer service failed to listen.");
emit("ready", { url: `http://127.0.0.1:${address.port}`, combinedGeneration: await combinedGeneration() });
