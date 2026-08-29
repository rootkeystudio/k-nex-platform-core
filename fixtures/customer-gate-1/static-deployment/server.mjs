import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import pg from "pg";

const release = JSON.parse(await readFile(new URL("./release.json", import.meta.url), "utf8"));
const installedPlugin = JSON.parse(await readFile(new URL("./node_modules/@k-nex/module-sales/package.json", import.meta.url), "utf8"));
if (installedPlugin.name !== release.plugin.id.replace("module.", "@k-nex/module-") || installedPlugin.version !== release.plugin.version) {
  throw new Error("Installed module.sales package does not match the customer release.");
}
const generation = process.env.K_NEX_GENERATION;
const sourceCommit = process.env.K_NEX_SOURCE_COMMIT;
const applicationDigest = process.env.K_NEX_APPLICATION_DIGEST;
const smokeToken = process.env.K_NEX_SMOKE_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
const expectedSchemaRevision = Number(process.env.K_NEX_SCHEMA_REVISION);

if (!databaseUrl || !Number.isSafeInteger(expectedSchemaRevision)) {
  throw new Error("Customer static binary requires its versioned least-privilege PostgreSQL authority.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function schemaProof() {
  const authority = await pool.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha' ");
  const revision = authority.rows[0];
  if (!revision || Number(revision.revision) < expectedSchemaRevision) throw new Error("INCOMPATIBLE_SCHEMA_REVISION");
  const observation = await pool.query(
    "insert into p9_static_binary_observations (generation_id, binary_revision, database_role, observed_step) values ($1,$2,current_user,$3) returning database_role",
    [generation, expectedSchemaRevision, revision.last_step_id]
  );
  const overlap = expectedSchemaRevision === 11
    ? await pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap")
    : await pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap");
  return { databaseRole: observation.rows[0].database_role, schemaRevision: Number(revision.revision), values: overlap.rows[0].values };
}

async function leastPrivilegeProof() {
  try {
    await pool.query("create table p9_static_privilege_escape (id integer)");
    return { rejected: false };
  } catch (error) {
    return { rejected: error?.code === "42501" };
  }
}

createServer((request, response) => {
  const respond = async () => {
    if (request.url === "/health" && process.env.K_NEX_FAIL_HEALTH === "1") return send(response, 500, { status: "failed" });
    if (request.url === "/authenticated" && request.headers["x-k-nex-smoke-auth"] !== smokeToken) return send(response, 401, { error: "authentication-required" });
    if (request.url === "/schema-proof") return send(response, 200, await schemaProof());
    if (request.url === "/least-privilege") return send(response, 200, await leastPrivilegeProof());
    return send(response, 200, {
      applicationDigest,
      generation,
      module: release.plugin.id,
      path: request.url,
      pluginVersion: installedPlugin.version,
      sourceCommit,
      workerMode: process.env.K_NEX_WORKER_MODE
    });
  };
  const handle = () => respond().catch((error) => send(response, 503, { error: error.message }));
  if (request.url === "/slow") setTimeout(handle, 250); else handle();
}).listen(3000, "0.0.0.0");
