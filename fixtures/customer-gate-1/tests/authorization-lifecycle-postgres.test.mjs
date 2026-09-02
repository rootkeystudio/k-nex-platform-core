import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import salesManifest from "@k-nex/module-sales-current/manifest" with { type: "json" };
import { salesRegistration, salesPermissionDescriptors } from "@k-nex/module-sales-current/server";
import {
  EffectiveAuthorityResolver,
  adoptRetainedExtensionGrants,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationCatalog,
  createEffectiveAuthorizationRequest,
  createPlatformPluginLifecycleState,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution,
  createTrustedAuthorizationSession,
  executeRegistration,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration
} from "@k-nex/runtime";
import {
  AuthorizationLifecycleProjector,
  PostgresAuthorizationStore,
  createStaticPlatformPluginAuthorizationDescriptorResolver
} from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-lifecycle-proof";
const environment = "production";
const extensionId = "module.sales";
const sourceCommitOne = "a".repeat(40);
const sourceCommitTwo = "b".repeat(40);
const platformOwner = Object.freeze({ kind: "platform", namespace: "system" });
const salesOwner = (generation) => Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId, generation });
const expected = (state) => ({ applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        NODE_ENV: "production",
        PAYLOAD_SECRET: "p10-7-authorization-lifecycle",
        BOOT_KEY: "p10-7-authorization-lifecycle"
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

function graph(manifest) {
  return {
    resolverVersion: "1.0.0",
    plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=", required: [], optional: [] }],
    capabilityProviders: [],
    registrationOrder: [manifest.id]
  };
}

function scopedSalesRegistration() {
  const executed = executeRegistration({
    graph: graph(salesManifest),
    installed: [{ package: { name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" }, manifest: salesManifest }],
    registrations: [salesRegistration]
  });
  const lifecycle = reconcilePlatformPluginAvailability(executed, createPlatformPluginLifecycleState({
    pluginId: extensionId,
    catalogStatus: "supported",
    package: { status: "installed", name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" },
    enabled: true,
    configuration: { revision: 1, ready: true },
    migration: { current: 1, required: 1, ready: true },
    dataState: "active",
    releaseStatus: "supported"
  }));
  return scopePlatformPluginRegistration(executed, [lifecycle]);
}

function lifecycleEvent(operation, lifecycleState, revision, generationId, sourceCommit) {
  return {
    schemaVersion: 1,
    applicationId,
    environment,
    eventId: `p10-7-event-${revision}`,
    eventType: "extension.lifecycle-transition",
    operationId: `p10-7-operation-${revision}`,
    operation,
    operationPhase: "completed",
    lifecycleState,
    expectedRevision: revision - 1,
    revision,
    inventoryRevision: revision,
    actor: { kind: "trusted-automation", identity: "test.p10-7" },
    receiptId: `p10-7-receipt-${revision}`,
    auditId: `p10-7-audit-${revision}`,
    idempotencyKey: `p10-7:${operation}:${revision}`,
    correlationId: `p10-7-correlation-${revision}`,
    occurredAt: "2026-09-01T00:00:00.000Z",
    deliveryClass: "platform-plugin",
    id: extensionId,
    evidence: {
      sourceCommit,
      compositionChangePlanDigest: `sha256:${"c".repeat(64)}`,
      generationId
    }
  };
}

function catalog(registration, generation, state) {
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({
    registration,
    generation: {
      schemaVersion: 1,
      applicationId,
      owner: salesOwner(generation),
      runtimeGenerationIds: ["sales-gen-two"],
      state: "current",
      authorizationRevision: state.authorizationRevision,
      lifecycleRevision: state.lifecycleRevision
    }
  });
  const executables = registration.contributions.policyBindings
    .filter(({ pluginId }) => pluginId === extensionId)
    .map(({ value }) => createPlatformPluginPolicyExecutable({
      kind: "platform-plugin",
      publisher: value.publisher,
      bindingId: value.id,
      policyReference: value.policyReference,
      executor: { evaluate: () => ({ schemaVersion: 1, outcome: "allow" }) }
    }));
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision: state.lifecycleRevision, extensions: [contribution], executables });
}

async function transaction(pool, work) {
  const session = await pool.connect();
  try {
    await session.query("begin");
    const result = await work(session);
    await session.query("commit");
    return result;
  } catch (error) {
    await session.query("rollback");
    throw error;
  } finally {
    session.release();
  }
}

async function runtimeRow(pool) {
  const result = await pool.query(
    "select revision, disposition, active_generation_id, active_generation, retained_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
    [applicationId, environment, extensionId]
  );
  return result.rows[0];
}

async function authorizationRows(pool) {
  const [state, generations, snapshots] = await Promise.all([
    pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId]),
    pool.query("select authorization_generation::int as authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id=$2 order by authorization_generation", [applicationId, extensionId]),
    pool.query("select snapshot_id, state, owner_generation::int as owner_generation, permission_json, revision from k_nex_permission_catalog_snapshots where application_id=$1 and owner_extension_id=$2 order by snapshot_id", [applicationId, extensionId])
  ]);
  return { state: state.rows, generations: generations.rows, snapshots: snapshots.rows };
}

test("P10.7 projects Sales lifecycle generations and retained-grant adoption through PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("authorization_lifecycle").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const registration = scopedSalesRegistration();
    const resolver = createStaticPlatformPluginAuthorizationDescriptorResolver({
      applicationId,
      registrations: [
        { sourceCommit: sourceCommitOne, registration },
        { sourceCommit: sourceCommitTwo, registration }
      ]
    });
    const projector = new AuthorizationLifecycleProjector(resolver);
    const store = new PostgresAuthorizationStore(pool, {
      validate: (currentApplicationId, subject) => currentApplicationId === applicationId && subject.kind === "user" && subject.id === "user:mixed" ? "accepted" : "rejected"
    });

    await pool.query(
      "insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation) values ($1,$2,'platform-plugin',$3,0,'removed',null,null)",
      [applicationId, environment, extensionId]
    );

    async function project(event, runtimeGenerationIds, runtimeSql, runtimeValues, updateCompatibility, priorGenerationEvidence) {
      return transaction(pool, async (session) => {
        await session.query(runtimeSql, runtimeValues);
        return projector.project({
          session,
          transition: event,
          runtimeGenerationIds,
          ...(updateCompatibility === undefined ? {} : { updateCompatibility }),
          ...(priorGenerationEvidence === undefined ? {} : { priorGenerationEvidence })
        });
      });
    }

    const installOne = lifecycleEvent("install", "active", 1, "sales-gen-one", sourceCommitOne);
    await project(
      installOne,
      ["sales-gen-one"],
      "update runtime_extensions set revision=1, disposition='active', active_generation_id=$4, active_generation='{}'::jsonb, retained_generation=null where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [applicationId, environment, extensionId, "sales-gen-one"]
    );
    assert.deepEqual((await authorizationRows(pool)).generations, [{ authorization_generation: 1, runtime_generation_ids: ["sales-gen-one"], state: "current", authorization_revision: 0, lifecycle_revision: 1 }]);

    const seeded = await store.transaction({ applicationId, environment, authorizationRevision: 0, lifecycleRevision: 1 }, async (view) => {
      await view.write({ kind: "role", role: { schemaVersion: 1, id: "role.mixed", applicationId, label: "Mixed Sales manager", revision: 1 } });
      await view.write({ kind: "grant", grant: { schemaVersion: 1, id: "grant.sales.read", applicationId, roleId: "role.mixed", permissionId: "sales.tasks.read", owner: salesOwner(1), revision: 1 } });
      await view.write({ kind: "grant", grant: { schemaVersion: 1, id: "grant.system.roles.read", applicationId, roleId: "role.mixed", permissionId: "system.roles.read", owner: platformOwner, revision: 1 } });
      await view.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "assignment.mixed", applicationId, roleId: "role.mixed", principal: { kind: "user", id: "user:mixed" }, state: "active", revision: 1 } });
    });
    assert.deepEqual([seeded.state.authorizationRevision, seeded.state.lifecycleRevision], [1, 1]);
    const customerData = await Promise.all([
      pool.query("select role_id, label, revision from k_nex_roles where application_id=$1 and role_id='role.mixed'", [applicationId]),
      pool.query("select grant_id, permission_id, owner_kind, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and role_id='role.mixed' order by grant_id", [applicationId]),
      pool.query("select assignment_id, role_id, subject_id, state, revision from k_nex_role_assignments where application_id=$1 and assignment_id='assignment.mixed'", [applicationId])
    ]);

    const disable = lifecycleEvent("disable", "disabled", 2, "sales-gen-one", sourceCommitOne);
    await project(
      disable,
      ["sales-gen-one"],
      "update runtime_extensions set revision=2, disposition='disabled', active_generation_id=null, active_generation=null where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [applicationId, environment, extensionId]
    );
    assert.deepEqual(await Promise.all([
      pool.query("select role_id, label, revision from k_nex_roles where application_id=$1 and role_id='role.mixed'", [applicationId]),
      pool.query("select grant_id, permission_id, owner_kind, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and role_id='role.mixed' order by grant_id", [applicationId]),
      pool.query("select assignment_id, role_id, subject_id, state, revision from k_nex_role_assignments where application_id=$1 and assignment_id='assignment.mixed'", [applicationId])
    ]).then((rows) => rows.map(({ rows: values }) => values)), customerData.map(({ rows }) => rows));
    const disabledRows = await authorizationRows(pool);
    assert.deepEqual(disabledRows.generations, [{ authorization_generation: 1, runtime_generation_ids: ["sales-gen-one"], state: "current", authorization_revision: 1, lifecycle_revision: 2 }]);
    assert.equal(disabledRows.snapshots.length, salesPermissionDescriptors.length);
    assert.ok(disabledRows.snapshots.every(({ state, owner_generation }) => state === "inactive-extension-disabled" && owner_generation === 1));

    const reenable = lifecycleEvent("install", "active", 3, "sales-gen-reenabled", sourceCommitOne);
    await project(
      reenable,
      ["sales-gen-reenabled"],
      "update runtime_extensions set revision=3, disposition='active', active_generation_id=$4, active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [applicationId, environment, extensionId, "sales-gen-reenabled"]
    );
    const reenabledRows = await authorizationRows(pool);
    assert.deepEqual(reenabledRows.generations, [{ authorization_generation: 1, runtime_generation_ids: ["sales-gen-reenabled"], state: "current", authorization_revision: 1, lifecycle_revision: 3 }]);
    assert.deepEqual(reenabledRows.snapshots, []);

    const compatibleUpdate = lifecycleEvent("update", "active", 4, "sales-gen-compatible", sourceCommitTwo);
    await project(
      compatibleUpdate,
      ["sales-gen-compatible"],
      "update runtime_extensions set revision=4, disposition='active', active_generation_id=$4, active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [applicationId, environment, extensionId, "sales-gen-compatible"],
      "compatible",
      { authority: "static-build", sourceCommit: sourceCommitOne, generationId: "sales-gen-reenabled" }
    );
    assert.deepEqual((await authorizationRows(pool)).generations, [{ authorization_generation: 1, runtime_generation_ids: ["sales-gen-compatible"], state: "current", authorization_revision: 1, lifecycle_revision: 4 }]);

    const uninstall = lifecycleEvent("uninstall", "removed", 5, "sales-gen-uninstalled", sourceCommitOne);
    await project(
      uninstall,
      ["sales-gen-compatible"],
      "update runtime_extensions set revision=5, disposition='removed', active_generation_id=null, active_generation=null, retained_generation=$4::jsonb where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [applicationId, environment, extensionId, JSON.stringify({ authority: "static-build", sourceCommit: sourceCommitTwo, generationId: "sales-gen-compatible" })]
    );
    const uninstalledRows = await authorizationRows(pool);
    assert.deepEqual(uninstalledRows.generations, [{ authorization_generation: 1, runtime_generation_ids: ["sales-gen-compatible"], state: "retired", authorization_revision: 1, lifecycle_revision: 5 }]);
    assert.equal(uninstalledRows.snapshots.length, salesPermissionDescriptors.length);
    assert.ok(uninstalledRows.snapshots.every(({ state, owner_generation }) => state === "orphaned-after-removal" && owner_generation === 1));
    assert.deepEqual((await runtimeRow(pool)).retained_generation, { authority: "static-build", sourceCommit: sourceCommitTwo, generationId: "sales-gen-compatible" });

    const reinstall = lifecycleEvent("install", "active", 6, "sales-gen-two", sourceCommitOne);
    await project(
      reinstall,
      ["sales-gen-two"],
      "update runtime_extensions set revision=6, disposition='active', active_generation_id=$4, active_generation='{}'::jsonb, retained_generation=null where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
      [applicationId, environment, extensionId, "sales-gen-two"]
    );
    assert.deepEqual((await authorizationRows(pool)).generations, [
      { authorization_generation: 1, runtime_generation_ids: ["sales-gen-compatible"], state: "retired", authorization_revision: 1, lifecycle_revision: 5 },
      { authorization_generation: 2, runtime_generation_ids: ["sales-gen-two"], state: "current", authorization_revision: 1, lifecycle_revision: 6 }
    ]);
    const reinstalledSnapshots = (await authorizationRows(pool)).snapshots;
    assert.equal(reinstalledSnapshots.length, salesPermissionDescriptors.length);
    assert.ok(reinstalledSnapshots.every(({ state, owner_generation }) => state === "orphaned-after-removal" && owner_generation === 1));
    assert.deepEqual((await pool.query("select grant_id, owner_generation::int as owner_generation from k_nex_role_permission_grants where application_id=$1 and grant_id='grant.sales.read'", [applicationId])).rows, [{ grant_id: "grant.sales.read", owner_generation: 1 }]);

    const current = await store.readState(applicationId, environment);
    assert.deepEqual(current && [current.authorizationRevision, current.lifecycleRevision], [1, 6]);
    const effectiveCatalog = catalog(registration, 2, current);
    const authority = new EffectiveAuthorityResolver({
      store,
      catalogProvider: createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) =>
        requested === applicationId && lifecycleRevision === 6 ? Object.freeze({ applicationId, lifecycleRevision, catalog: effectiveCatalog }) : undefined)
    });
    const session = createTrustedAuthorizationSession({
      schemaVersion: 1,
      applicationId,
      environment,
      correlationId: "p10-7-retired-grant",
      principal: { kind: "user", id: "user:mixed" },
      effectiveActor: { kind: "user", id: "user:mixed" }
    });
    const request = createEffectiveAuthorizationRequest({
      schemaVersion: 1,
      decisionId: "p10-7-sales-tasks-read",
      permissionId: "sales.tasks.read",
      scope: { kind: "record", resource: "sales.tasks", recordId: "task-one" },
      facts: {}
    });
    const retiredDecision = await authority.authorize(session, request);
    assert.deepEqual([retiredDecision.outcome, retiredDecision.reason], ["deny", "owner-not-effective"]);

    const unchangedBeforeAdoption = await Promise.all([
      pool.query("select role_id, label, revision from k_nex_roles where application_id=$1 and role_id='role.mixed'", [applicationId]),
      pool.query("select grant_id, permission_id, owner_kind, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and grant_id='grant.system.roles.read'", [applicationId]),
      pool.query("select assignment_id, role_id, subject_id, state, revision from k_nex_role_assignments where application_id=$1 and assignment_id='assignment.mixed'", [applicationId])
    ]);
    const adoption = await adoptRetainedExtensionGrants({
      store,
      expected: expected(current),
      effectiveCatalog,
      targetOwner: salesOwner(2),
      roleId: "role.mixed",
      selectedGrantIds: ["grant.sales.read"]
    });
    assert.deepEqual(adoption.value.map(({ id, owner }) => [id, owner.generation]), [["grant.sales.read", 2]]);
    assert.deepEqual(await Promise.all([
      pool.query("select role_id, label, revision from k_nex_roles where application_id=$1 and role_id='role.mixed'", [applicationId]),
      pool.query("select grant_id, permission_id, owner_kind, owner_generation, revision from k_nex_role_permission_grants where application_id=$1 and grant_id='grant.system.roles.read'", [applicationId]),
      pool.query("select assignment_id, role_id, subject_id, state, revision from k_nex_role_assignments where application_id=$1 and assignment_id='assignment.mixed'", [applicationId])
    ]).then((rows) => rows.map(({ rows: values }) => values)), unchangedBeforeAdoption.map(({ rows }) => rows));
    assert.deepEqual((await authority.authorize(session, request)).outcome, "allow");

    const beforeFault = { runtime: await runtimeRow(pool), authorization: await authorizationRows(pool) };
    const failingProjector = new AuthorizationLifecycleProjector(async () => { throw new Error("descriptor resolver fault"); });
    const fault = lifecycleEvent("update", "active", 7, "sales-gen-fault", sourceCommitTwo);
    await assert.rejects(transaction(pool, async (session) => {
      await session.query(
        "update runtime_extensions set revision=7, active_generation_id='sales-gen-fault', active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class='platform-plugin' and extension_id=$3",
        [applicationId, environment, extensionId]
      );
      await failingProjector.project({ session, transition: fault, runtimeGenerationIds: ["sales-gen-fault"], updateCompatibility: "compatible" });
    }), /descriptor resolver fault/u);
    assert.deepEqual({ runtime: await runtimeRow(pool), authorization: await authorizationRows(pool) }, beforeFault);
  } finally {
    await pool.end();
    await container.stop();
  }
});
