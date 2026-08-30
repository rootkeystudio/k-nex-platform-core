import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import pg from "pg";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresRuntimeExtensionStore } from "@k-nex/payload-adapter";
import { ExtensionOperatorApi, PluginManager, TrustedAutomationOperationAuthorizer } from "@k-nex/runtime";

const execute = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.P9_WEB_ADMIN_PORT);
const operator = process.env.P9_OPERATOR_CONFIGURATION && JSON.parse(process.env.P9_OPERATOR_CONFIGURATION);
const supervisorUrl = process.env.P9_SUPERVISOR_URL;
if (!databaseUrl || !Number.isInteger(port) || !operator || !supervisorUrl) throw new Error("Web/admin container requires only operation-planning authority and a fixed port.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const rejected = async (attempt) => {
  try { await attempt(); return false; }
  catch { return true; }
};

const proof = await (async () => {
  const inventoryReadable = await pool.query("select count(*)::int count from runtime_extension_inventory_revisions").then(() => true, () => false);
  const deploymentTableDenied = await rejected(() => pool.query("select * from runtime_static_release_requests"));
  const sourceWriteDenied = await rejected(() => writeFile("/customer-source/.p9-write-attempt", "denied\n", { flag: "wx" }));
  const buildDenied = await rejected(() => execute("npm", ["install", "--prefix", "/app/p9-build-attempt", "--ignore-scripts", "--no-audit", "--no-fund", "pg@8.20.0"], { cwd: "/app", timeout: 5_000 }));
  const dockerDenied = await rejected(() => execute("docker", ["build", "."], { cwd: "/app", timeout: 5_000 }));
  let supervisorDenied = false;
  try {
    const response = await fetch(`${supervisorUrl}/commands`, { method: "POST", headers: { authorization: "Bearer absent-supervisor-token", "content-type": "application/json" }, body: "{}" });
    supervisorDenied = response.status === 401;
  } catch { supervisorDenied = true; }
  const controlPlaneAbsent = (await Promise.all([
    "deployment-supervisor-process.mjs", "topology-process.mjs", "Dockerfile"
  ].map((path) => rejected(() => access(`/app/${path}`))))).every(Boolean);
  if (!inventoryReadable || !deploymentTableDenied || !sourceWriteDenied || !buildDenied || !dockerDenied || !supervisorDenied || !controlPlaneAbsent) throw new Error("Web/admin isolation or database-connectivity proof failed.");
  return Object.freeze({ inventoryReadable, deploymentTableDenied, sourceWriteDenied, buildDenied, dockerDenied, supervisorDenied, controlPlaneAbsent, processId: process.pid });
})();

const operationClock = { now: () => new Date() };
const operationStore = new PostgresRuntimeExtensionStore(pool, operationClock, operator.hostInventoryDigest);
const manager = new PluginManager(
  operator.workerId,
  new TrustedAutomationOperationAuthorizer(operator.automationIdentity),
  { plan: async (request) => ({ plan: { ...operator.installPlan, operationId: request.operationId }, sourceCommit: operator.sourceCommit, generationId: operator.generationId }) },
  operationStore,
  { stage: async () => { throw new Error("Static web/admin planning cannot stage runtime artifacts."); }, reverify: async () => false },
  { request: async (request, decision) => {
    const expected = { applicationId: operator.request.applicationId, environment: operator.request.environment, expectedSourceCommit: operator.sourceCommit, generationId: operator.generationId, plan: { ...operator.installPlan, operationId: request.plan.operationId } };
    if (canonicalJson(request) !== canonicalJson(expected) || canonicalJson(decision) !== canonicalJson(operator.authorization)) throw new Error("Static source-change authority does not match the authorized web/admin operation.");
    return operator.sourceChange;
  } },
  { request: async (sourceChange, decision) => {
    if (canonicalJson(sourceChange) !== canonicalJson(operator.sourceChange) || canonicalJson(decision) !== canonicalJson(operator.authorization)) throw new Error("Trusted build request does not match the authorized web/admin operation.");
    return operator.deployment;
  }, reverify: async () => false },
  undefined,
  operationClock
);
const operatorApi = new ExtensionOperatorApi(
  manager,
  { list: async () => [] },
  { validate: async () => { throw new Error("Static release execution is supervisor-owned."); }, execute: async () => { throw new Error("Static release execution is supervisor-owned."); }, rollback: async () => { throw new Error("Static release execution is supervisor-owned."); } },
  { observe: async () => { throw new Error("Web/admin planning does not own runtime health authority."); } }
);

createServer(async (request, response) => {
  if (request.url === "/p9-admin-isolation") return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(proof));
  if (request.method === "POST" && request.url === "/p9-change-request") {
    try {
      const plan = await operatorApi.plan(operator.request);
      return response.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ operationId: plan.operationId, executionClass: plan.executionClass }));
    } catch (error) {
      const causes = error instanceof AggregateError ? [...error.errors].map((cause) => cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)).join(" | ") : "";
      const diagnostic = error instanceof Error ? `${error.name}: ${error.message}${causes ? ` (${causes})` : ""}` : JSON.stringify(error);
      return response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: diagnostic || String(error) }));
    }
  }
  response.writeHead(404).end();
}).listen(port, "0.0.0.0");
