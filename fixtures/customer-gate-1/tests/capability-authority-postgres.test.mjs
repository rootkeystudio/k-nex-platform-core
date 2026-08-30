import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PostgresExtensionCapabilityAuthority, PostgresExtensionCapabilitySequenceStore } from "@k-nex/payload-adapter";
import { ExtensionCapabilityGateway, HmacExtensionCapabilityTokens } from "@k-nex/runtime";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const owner = { applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant" };

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-4-capability-secret", BOOT_KEY: "p9-4-capability-authority" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

const handler = {
  validateInput(value) { return value; },
  invoke(claims, input) { return { generationId: claims.generationId, actor: claims.actor, input }; },
  validateOutput(value) { return value; }
};

test("reauthorizes generation and actor authority and keeps replay denial across gateway restart", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("capability_authority").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const clock = { value: new Date("2026-08-29T10:00:00.000Z"), now() { return this.value; } };
  const revokedDelegations = new Set();
  const revokedActors = new Set();
  const principalAuthority = { reauthorize(claims) {
    return !revokedDelegations.has(`${claims.actor.principalId}:${claims.actor.delegationId ?? ""}`) &&
      !revokedActors.has(`${claims.actor.principalId}:${claims.actor.effectiveActorId}`);
  } };
  const tokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(5), clock);
  const authority = new PostgresExtensionCapabilityAuthority(pool, principalAuthority, clock);
  const gateway = () => new ExtensionCapabilityGateway(tokens, { "records.query": handler }, authority, new PostgresExtensionCapabilitySequenceStore(pool, clock), clock, { maxInputBytes: 1024, maxOutputBytes: 1024, maxDepth: 4, maxCalls: 4 });
  const issue = ({ tokenId, invocationId, generationId, drainLeaseId, delegationId } = {}) => tokens.issue({
    tokenId: tokenId ?? "capability-token-1", ...owner, generationId: generationId ?? "sales-generation-old", invocationId: invocationId ?? "capability-invocation-1",
    actor: { principalId: "user:one", effectiveActorId: "user:one", ...(delegationId ? { delegationId } : {}) }, correlationId: "capability-correlation-1",
    grants: [{ kind: "records", required: true, reason: "Read assigned sales tasks.", operations: ["query"], resources: [{ id: "sales.tasks", version: 1 }] }],
    ...(drainLeaseId ? { drainLeaseId } : {}), ttlMs: 30_000
  });
  const call = (token, generationId, sequence) => ({ token, invocationId: token === oldToken ? "capability-invocation-1" : token === revokedToken ? "capability-invocation-2" : token === actorRevokedToken ? "capability-invocation-actor-revoked" : "capability-invocation-3", generationId, sequence, capability: "records.query", payload: { query: "mine" }, signal: new AbortController().signal });
  let oldToken;
  let revokedToken;
  let actorRevokedToken;
  try {
    await boot(container.getConnectionUri());
    await pool.query(
      `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
       values ($1,$2,'hot-application',$3,1,'active','sales-generation-old','{}'::jsonb)`,
      [owner.applicationId, owner.environment, owner.appId]
    );
    for (const generationId of ["sales-generation-old", "sales-generation-new"]) {
      await pool.query(
        `insert into runtime_extension_generations (application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest, state)
         values ($1,$2,'hot-application',$3,$4,'1.0.0','{}'::jsonb,$5,$6)`,
        [owner.applicationId, owner.environment, owner.appId, generationId, `sha256:${"0".repeat(64)}`, generationId === "sales-generation-old" ? "active" : "warming"]
      );
    }
    const drainLeaseId = "lease-11111111-1111-4111-8111-111111111111";
    await pool.query(
      `insert into runtime_extension_generation_leases (lease_id, application_id, environment, delivery_class, extension_id, generation_id, holder, expires_at)
       values ($1,$2,$3,'hot-application',$4,'sales-generation-old','runner:old',$5)`,
      [drainLeaseId, owner.applicationId, owner.environment, owner.appId, "2026-08-29T10:00:10.000Z"]
    );
    await assert.equal(await authority.reauthorize(tokens.verify(issue())), false, "an active generation must reject a capability token without its drain lease");
    oldToken = issue({ drainLeaseId });
    await assert.doesNotReject(gateway().invoke(call(oldToken, "sales-generation-old", 1)), "active generation must be authorized");
    const leaseClaims = tokens.verify(oldToken);
    await assert.equal(await authority.reauthorize(leaseClaims), true, "an exact live lease must authorize an active generation");
    await assert.equal(await authority.reauthorize({ ...leaseClaims, applicationId: "customer-beta" }), false, "an active generation must not bypass another application's lease binding");
    await assert.equal(await authority.reauthorize({ ...leaseClaims, appId: "app.forecast" }), false, "an active generation must not bypass another extension's lease binding");
    await assert.equal(await authority.reauthorize({ ...leaseClaims, generationId: "sales-generation-new" }), false, "an active generation must not bypass another generation's lease binding");
    clock.value = new Date("2026-08-29T10:00:11.000Z");
    await assert.equal(await authority.reauthorize(leaseClaims), false, "an active generation must reject an expired drain lease");
    clock.value = new Date("2026-08-29T10:00:00.000Z");
    await pool.query("delete from runtime_extension_generation_leases where lease_id=$1", [drainLeaseId]);
    await assert.equal(await authority.reauthorize(leaseClaims), false, "an active generation must reject a released drain lease");
    await pool.query(
      `insert into runtime_extension_generation_leases (lease_id, application_id, environment, delivery_class, extension_id, generation_id, holder, expires_at)
       values ($1,$2,$3,'hot-application',$4,'sales-generation-old','runner:old',$5)`,
      [drainLeaseId, owner.applicationId, owner.environment, owner.appId, "2026-08-29T10:00:10.000Z"]
    );

    await pool.query(
      `update runtime_extensions set active_generation_id='sales-generation-new', active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3`,
      [owner.applicationId, owner.environment, owner.appId]
    );
    await assert.doesNotReject(gateway().invoke(call(oldToken, "sales-generation-old", 2)), "old generation may drain through its persisted lease");
    clock.value = new Date("2026-08-29T10:00:11.000Z");
    await assert.rejects(gateway().invoke(call(oldToken, "sales-generation-old", 3)), { code: "AUTHORITY_DENIED" }, "expired drain lease must deny an old generation");

    const activeLeaseId = "lease-22222222-2222-4222-8222-222222222222";
    await pool.query(
      `insert into runtime_extension_generation_leases (lease_id, application_id, environment, delivery_class, extension_id, generation_id, holder, expires_at)
       values ($1,$2,$3,'hot-application',$4,'sales-generation-new','runner:new',$5)`,
      [activeLeaseId, owner.applicationId, owner.environment, owner.appId, "2026-08-29T10:01:00.000Z"]
    );
    revokedToken = issue({ tokenId: "capability-token-2", invocationId: "capability-invocation-2", generationId: "sales-generation-new", drainLeaseId: activeLeaseId, delegationId: "delegation-revoked" });
    revokedDelegations.add("user:one:delegation-revoked");
    await assert.rejects(gateway().invoke(call(revokedToken, "sales-generation-new", 1)), { code: "AUTHORITY_DENIED" }, "delegation revocation must take effect on the next call");
    revokedDelegations.clear();

    actorRevokedToken = issue({ tokenId: "capability-token-actor-revoked", invocationId: "capability-invocation-actor-revoked", generationId: "sales-generation-new", drainLeaseId: activeLeaseId });
    revokedActors.add("user:one:user:one");
    await assert.rejects(gateway().invoke(call(actorRevokedToken, "sales-generation-new", 1)), { code: "AUTHORITY_DENIED" }, "principal/effective-actor revocation must deny the very next current-generation call");
    revokedActors.clear();

    clock.value = new Date("2026-08-29T10:00:12.000Z");
    const restartToken = issue({ tokenId: "capability-token-3", invocationId: "capability-invocation-3", generationId: "sales-generation-new", drainLeaseId: activeLeaseId });
    await assert.rejects(gateway().invoke(call(restartToken, "sales-generation-new", 2)), { code: "SEQUENCE_INVALID" }, "a fresh invocation must start at sequence one");
    await assert.doesNotReject(gateway().invoke(call(restartToken, "sales-generation-new", 1)));
    await assert.rejects(gateway().invoke(call(restartToken, "sales-generation-new", 1)), { code: "SEQUENCE_INVALID" }, "a fresh gateway instance must preserve replay denial");
  } finally {
    await pool.end();
    await container.stop();
  }
});
