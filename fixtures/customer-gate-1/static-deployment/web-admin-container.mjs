import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import pg from "pg";

const execute = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.P9_WEB_ADMIN_PORT);
if (!databaseUrl || !Number.isInteger(port)) throw new Error("Web/admin container requires only its inventory database authority and fixed port.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const rejected = async (attempt) => {
  try { await attempt(); return false; }
  catch { return true; }
};

const proof = await (async () => {
  const deploymentTableDenied = await rejected(() => pool.query("select * from runtime_static_release_requests"));
  const sourceWriteDenied = await rejected(() => writeFile("/customer-source/.p9-write-attempt", "denied\n", { flag: "wx" }));
  const buildDenied = await rejected(() => execute("npm", ["install", "--prefix", "/app/p9-build-attempt", "--ignore-scripts", "--no-audit", "--no-fund", "pg@8.20.0"], { cwd: "/app", timeout: 5_000 }));
  const dockerDenied = await rejected(() => execute("docker", ["build", "."], { cwd: "/app", timeout: 5_000 }));
  const controlPlaneAbsent = (await Promise.all([
    "deployment-supervisor-process.mjs", "topology-process.mjs", "Dockerfile"
  ].map((path) => rejected(() => access(`/app/${path}`))))).every(Boolean);
  if (!deploymentTableDenied || !sourceWriteDenied || !buildDenied || !dockerDenied || !controlPlaneAbsent) throw new Error("Web/admin isolation attempt unexpectedly gained static deployment authority.");
  return Object.freeze({ deploymentTableDenied, sourceWriteDenied, buildDenied, dockerDenied, controlPlaneAbsent, processId: process.pid });
})();

createServer((request, response) => {
  if (request.url !== "/p9-admin-isolation") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(proof));
}).listen(port, "0.0.0.0");
