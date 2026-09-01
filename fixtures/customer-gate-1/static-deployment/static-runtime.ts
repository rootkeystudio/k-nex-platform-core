import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { sql } from "@payloadcms/db-postgres";
import { createPayloadRequest, getPayload } from "payload";
import { salesTaskCreateHandler } from "@k-nex/module-sales/server";
import { activePayloadPostgresTransaction, runtimeExtensionIdentityKey } from "@k-nex/payload-adapter";

import config from "@payload-config";

let runtimePromise: ReturnType<typeof initializeRuntime> | undefined;

async function initializeRuntime() {
  const payload = await getPayload({ config });
  const release = JSON.parse(await readFile(join(process.cwd(), "release.json"), "utf8"));
  const generation = process.env.K_NEX_GENERATION;
  const sourceCommit = process.env.K_NEX_SOURCE_COMMIT;
  const applicationDigest = process.env.K_NEX_APPLICATION_DIGEST;
  const smokeToken = process.env.K_NEX_SMOKE_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;
  const expectedSchemaRevision = Number(process.env.K_NEX_SCHEMA_REVISION);
  const processIdentity = process.env.K_NEX_WEB_PROCESS_IDENTITY;
  if (!databaseUrl || !Number.isSafeInteger(expectedSchemaRevision) || !processIdentity || !payload.config.collections.some(({ slug }) => slug === "sales-opportunities") || !payload.config.collections.some(({ slug }) => slug === "sales-tasks")) {
    throw new Error("Customer Payload/Next runtime is missing its registry or versioned database authority.");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await pool.query(
    "insert into p9_static_process_events (role, instance_id, event, generation_id, detail) values ('web',$1,'web-started',$2,$3::jsonb)",
    [processIdentity, generation, JSON.stringify({ processId: process.pid, processIdentity, customerPayloadRegistry: true, payloadNextRuntime: true })]
  );
  return { applicationDigest, expectedSchemaRevision, generation, payload, pluginVersion: release.plugin.version, pool, processIdentity, smokeToken, sourceCommit };
}

function runtime() {
  return runtimePromise ??= initializeRuntime();
}

async function schemaProof() {
  const { expectedSchemaRevision, generation, pool } = await runtime();
  const authority = await pool.query("select revision, last_step_id from p9_static_migration_authority where authority_id='customer-alpha'");
  const revision = authority.rows[0];
  if (!revision || Number(revision.revision) < expectedSchemaRevision) throw new Error("INCOMPATIBLE_SCHEMA_REVISION");
  await pool.query(
    "insert into p9_static_binary_observations (generation_id, binary_revision, database_role, observed_step) values ($1,$2,current_user,$3)",
    [generation, expectedSchemaRevision, revision.last_step_id]
  );
  const role = await pool.query("select current_user database_role");
  const overlap = expectedSchemaRevision === 11
    ? await pool.query("select array_agg(legacy_value order by id) values from p9_static_overlap")
    : await pool.query("select array_agg(expanded_value order by id) values from p9_static_overlap");
  return { databaseRole: role.rows[0].database_role, schemaRevision: Number(revision.revision), values: overlap.rows[0].values };
}

async function leastPrivilegeProof() {
  const { pool } = await runtime();
  try { await pool.query("create table p9_static_privilege_escape (id integer)"); return { rejected: false }; }
  catch (error) { return { rejected: typeof error === "object" && error !== null && "code" in error && error.code === "42501" }; }
}

async function salesOperationProof(request: Request) {
  const { payload, pool } = await runtime();
  const payloadRequest = await createPayloadRequest({ config: payload.config, request });
  const transactionID = await payloadRequest.payload.db.beginTransaction();
  if (transactionID === null || transactionID === undefined) throw new Error("Sales action proof could not open a Payload transaction.");
  payloadRequest.transactionID = transactionID;
  try {
    const transaction = await activePayloadPostgresTransaction(payloadRequest);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runtimeExtensionIdentityKey({
      applicationId: "customer-alpha",
      environment: "production",
      deliveryClass: "platform-plugin",
      extensionId: "module.sales"
    })}, 0))`);
    const lifecycle = await transaction.execute(sql`select disposition from p9_static_sales_lifecycle_authority`);
    if (lifecycle.rows[0]?.disposition !== "active") {
      await payloadRequest.payload.db.rollbackTransaction(transactionID);
      return { authorized: false };
    }
    const task = await salesTaskCreateHandler({
      actor: { principal: { kind: "service", id: "p9-static-sales-proof" }, effectiveActor: { kind: "service", id: "p9-static-sales-proof" } },
      request: payloadRequest,
      authorizationContext: { permissionFingerprint: "p9-static-sales-proof" },
      input: await request.json(),
      idempotencyKey: request.headers.get("x-idempotency-key") ?? "p9-static-sales-action",
      signal: request.signal
    });
    await payloadRequest.payload.db.commitTransaction(transactionID);
    const role = await pool.query("select current_user database_role");
    return { authorized: true, databaseRole: role.rows[0]?.database_role, task };
  } catch (error) {
    await payloadRequest.payload.db.rollbackTransaction(transactionID);
    throw error;
  }
}

function json(status: number, value: unknown) {
  return Response.json(value, { status });
}

export async function handleStaticRuntimeRequest(request: Request) {
  const { applicationDigest, generation, pluginVersion, processIdentity, smokeToken, sourceCommit } = await runtime();
  const path = new URL(request.url).pathname;
  if (path === "/slow") await new Promise((resolve) => setTimeout(resolve, 250));
  if (path === "/health" && process.env.K_NEX_FAIL_HEALTH === "1") return json(500, { status: "failed" });
  if (path === "/authenticated" && request.headers.get("x-k-nex-smoke-auth") !== smokeToken) return json(401, { error: "authentication-required" });
  if (path === "/schema-proof") return json(200, await schemaProof());
  if (path === "/least-privilege") return json(200, await leastPrivilegeProof());
  if (path === "/sales-operation") {
    if (request.method !== "POST") return json(405, { error: "method-not-allowed" });
    try {
      const proof = await salesOperationProof(request);
      return json(proof.authorized ? 200 : 403, proof);
    } catch (error) {
      console.error("P9_SALES_OPERATION_FAILURE", error);
      return json(500, { error: error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: "Unknown Sales operation failure." } });
    }
  }
  if (path === "/process-identity") return json(200, { processIdentity, processId: process.pid, generation, payloadNextRuntime: true });
  return json(200, { applicationDigest, generation, module: "module.sales", path, payloadNextRuntime: true, pluginVersion, sourceCommit, workerMode: process.env.K_NEX_WORKER_MODE });
}
