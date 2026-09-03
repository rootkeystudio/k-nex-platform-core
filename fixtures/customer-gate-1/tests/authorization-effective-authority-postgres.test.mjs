import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  CurrentAuthorityOperationAuthorizer,
  EffectiveAuthorityResolver,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationCatalog,
  createEffectiveAuthorizationRequest,
  createTrustedAuthorizationSession
} from "@k-nex/runtime";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-alpha";
const environment = "production";
const platform = Object.freeze({ kind: "platform", namespace: "system" });
const sales = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 7 });
const digest = (character) => `sha256:${character.repeat(64)}`;
const expected = (state) => ({ applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
const role = (id) => ({ schemaVersion: 1, id, applicationId, label: id, revision: 0 });
const grant = (id, roleId, permissionId, owner) => ({ schemaVersion: 1, id, applicationId, roleId, permissionId, owner, revision: 0 });
const assignment = (id, roleId, user, state = "active") => ({ schemaVersion: 1, id, applicationId, roleId, principal: { kind: "user", id: user }, state, revision: 0 });
const authorityRequest = (permissionId, scope) => createEffectiveAuthorizationRequest({ schemaVersion: 1, decisionId: `decision:${permissionId}`, permissionId, scope, facts: {} });

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        NODE_ENV: "production",
        PAYLOAD_SECRET: "p10-4-effective-authority",
        BOOT_KEY: "p10-4-effective-authority"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function session(user, correlationId) {
  return createTrustedAuthorizationSession({
    schemaVersion: 1,
    applicationId,
    environment,
    correlationId,
    principal: { kind: "user", id: user },
    effectiveActor: { kind: "user", id: user }
  });
}

function lifecycleRequest() {
  return Object.freeze({
    applicationId,
    environment,
    extension: { deliveryClass: "hot-application", id: "app.sales-assistant" },
    operation: "install",
    requestDigest: digest("a"),
    expectedRevision: 0
  });
}

function operationAuthorizer(resolver, trustedSession) {
  return new CurrentAuthorityOperationAuthorizer({
    current: async () => Object.freeze({
      session: trustedSession,
      actor: Object.freeze({ kind: "actor", id: trustedSession.effectiveActor.id, approvalId: "approval:phase-10" })
    })
  }, resolver);
}

test("P10.4 resolves current PostgreSQL authority without cache or client-forgery reuse", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("effective_authority").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());

    const store = new PostgresAuthorizationStore(pool, {
      validate: (currentApplicationId, subject) => currentApplicationId === applicationId && subject.kind === "user" &&
        ["user:admin", "user:other", "user:mixed"].includes(subject.id) ? "accepted" : "rejected"
    });
    const catalogs = new Map([0, 1].map((lifecycleRevision) => [
      lifecycleRevision,
      createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [], executables: [] })
    ]));
    const resolver = new EffectiveAuthorityResolver({
      store,
      catalogProvider: createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) =>
        requested === applicationId && catalogs.has(lifecycleRevision)
          ? Object.freeze({ applicationId, lifecycleRevision, catalog: catalogs.get(lifecycleRevision) })
          : undefined)
    });
    const admin = session("user:admin", "correlation:admin");
    const other = session("user:other", "correlation:other");
    const mixed = session("user:mixed", "correlation:mixed");

    const seeded = await store.transaction({ applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, async (transaction) => {
      await transaction.write({ kind: "role", role: role("extensions-admin") });
      await transaction.write({ kind: "grant", grant: grant("plan", "extensions-admin", "system.extensions.plan", platform) });
      await transaction.write({ kind: "grant", grant: grant("install-live", "extensions-admin", "system.extensions.install-live", platform) });
      await transaction.write({ kind: "assignment", assignment: assignment("admin-assignment", "extensions-admin", "user:admin") });
    });
    assert.deepEqual([seeded.state.authorizationRevision, seeded.state.lifecycleRevision], [1, 0]);

    const planRequest = authorityRequest("system.extensions.plan", { kind: "application", resource: "system.extensions" });
    const initialDecision = await resolver.authorize(admin, planRequest);
    assert.deepEqual([initialDecision.authorizationRevision, initialDecision.lifecycleRevision, initialDecision.outcome], [1, 0, "allow"]);
    assert.equal((await resolver.authorize(other, planRequest)).outcome, "deny", "An actor without assignments must not reuse the admin cache entry.");
    const lifecycleDecision = await operationAuthorizer(resolver, admin).authorize(lifecycleRequest());
    assert.deepEqual(lifecycleDecision.actor, { kind: "actor", id: "user:admin", approvalId: "approval:phase-10" });
    assert.match(lifecycleDecision.decisionId, /^sha256:[0-9a-f]{64}$/u);

    await assert.rejects(
      resolver.authorize({ ...admin }, planRequest),
      { code: "UNTRUSTED_SESSION" }
    );
    await assert.rejects(
      resolver.authorize(structuredClone(admin), planRequest),
      { code: "UNTRUSTED_SESSION" }
    );
    await assert.rejects(
      resolver.authorize(admin, { ...planRequest }),
      { code: "INVALID_REQUEST" }
    );
    await assert.rejects(
      operationAuthorizer(resolver, other).authorize({
        ...lifecycleRequest(),
        permissionId: "system.extensions.plan",
        scope: { kind: "record", resource: "sales.records", recordId: "record:forged" },
        actor: { kind: "actor", id: "user:admin", approvalId: "approval:forged" }
      }),
      { code: "UNAUTHORIZED" }
    );

    const mixedState = await store.transaction(expected(seeded.state), async (transaction) => {
      await transaction.write({ kind: "role", role: role("mixed-role") });
      await transaction.write({ kind: "grant", grant: grant("mixed-plan", "mixed-role", "system.extensions.plan", platform) });
      await transaction.write({ kind: "extension-generation", generation: {
        schemaVersion: 1, applicationId, owner: sales, runtimeGenerationIds: ["sales-generation-7"], state: "current",
        authorizationRevision: seeded.state.authorizationRevision, lifecycleRevision: seeded.state.lifecycleRevision
      } });
      await transaction.write({ kind: "grant", grant: grant("mixed-sales", "mixed-role", "sales.records.read", sales) });
      await transaction.write({ kind: "assignment", assignment: assignment("mixed-assignment", "mixed-role", "user:mixed") });
    });
    assert.deepEqual([mixedState.state.authorizationRevision, mixedState.state.lifecycleRevision], [2, 1]);

    const mixedPlan = await resolver.authorize(mixed, planRequest);
    assert.deepEqual([mixedPlan.authorizationRevision, mixedPlan.lifecycleRevision, mixedPlan.outcome], [2, 1, "allow"]);
    const dormant = await resolver.authorize(mixed, authorityRequest("sales.records.read", { kind: "record", resource: "sales.records", recordId: "record:one" }));
    assert.deepEqual([dormant.outcome, dormant.reason, dormant.authorizationRevision, dormant.lifecycleRevision], ["deny", "owner-not-effective", 2, 1]);

    const revoked = await store.transaction(expected(mixedState.state), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: assignment("admin-assignment", "extensions-admin", "user:admin", "revoked") });
    });
    assert.deepEqual([revoked.state.authorizationRevision, revoked.state.lifecycleRevision], [3, 1]);
    const denied = await resolver.authorize(admin, planRequest);
    assert.deepEqual([denied.outcome, denied.reason, denied.authorizationRevision, denied.lifecycleRevision], ["deny", "assignment-revoked", 3, 1]);
    await assert.rejects(operationAuthorizer(resolver, admin).authorize(lifecycleRequest()), { code: "UNAUTHORIZED" });
  } finally {
    await pool.end();
    await container.stop();
  }
});
