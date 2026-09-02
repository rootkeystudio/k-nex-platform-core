import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { bootstrapFirstOwner, currentProtectedPlatformRoleBaselineRelease, parseAuthorizationStoreMutation } from "@k-nex/runtime";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const tables = [
  "k_nex_roles",
  "k_nex_extension_authorization_generations",
  "k_nex_role_permission_grants",
  "k_nex_role_assignments",
  "k_nex_role_template_adoptions",
  "k_nex_permission_catalog_snapshots",
  "k_nex_authorization_state",
  "k_nex_authorization_bootstrap_receipts",
  "k_nex_authorization_audit",
  "k_nex_authorization_outbox"
];
const ownerRole = (applicationId) => ({ schemaVersion: 1, id: "system.role.owner", applicationId, label: "Owner", protectedRoleId: "system.role.owner", revision: 0 });
const ownerAssignment = (applicationId, id, subjectId, state = "active") => ({ schemaVersion: 1, id, applicationId, roleId: "system.role.owner", principal: { kind: "user", id: subjectId }, state, revision: 0 });
const bootstrapReceipt = (applicationId, id, assignmentId, subjectId) => ({ schemaVersion: 1, id, applicationId, ownerRoleId: "system.role.owner", ownerAssignmentId: assignmentId, ownerPrincipal: { kind: "user", id: subjectId }, protectedBaselineVersion: currentProtectedPlatformRoleBaselineRelease.version, protectedBaselineDigest: currentProtectedPlatformRoleBaselineRelease.digest, authorizationRevision: 0, state: "committed" });
const expectedRevision = ({ applicationId, environment, authorizationRevision, lifecycleRevision }) => ({ applicationId, environment, authorizationRevision, lifecycleRevision });

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        NODE_ENV: "production",
        PAYLOAD_SECRET: "p10-3-authorization-storage",
        BOOT_KEY: "p10-3-authorization-storage"
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

test("migrates P10.3 authorization storage with customer isolation and generation fences", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("authorization_storage").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const insertRole = (applicationId, roleId, protectedRoleId = null) => pool.query(
    "insert into k_nex_roles (application_id, role_id, label, protected_role_id) values ($1,$2,$3,$4)",
    [applicationId, roleId, roleId, protectedRoleId]
  );
  const insertGeneration = (applicationId, generation, state = "current") => pool.query(
    `insert into k_nex_extension_authorization_generations
       (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state)
     values ($1, 'platform-plugin', 'module.sales', $2, '["sales-generation"]'::jsonb, $3)`,
    [applicationId, generation, state]
  );
  try {
    await boot(container.getConnectionUri());

    const migrated = await pool.query(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name = any($1::text[]) order by table_name`,
      [tables]
    );
    assert.deepEqual(migrated.rows.map(({ table_name }) => table_name), [...tables].sort());
    assert.deepEqual((await pool.query("select predecessor_revision, revision from k_nex_migration_revision where id=1")).rows, [{ predecessor_revision: 21, revision: 22 }]);
    assert.equal((await pool.query("select count(*)::int as count from payload_migrations where name='20260901_000019_authorization_storage'")).rows[0].count, 1);
    assert.equal((await pool.query("select count(*)::int as count from payload_migrations where name='20260901_000020_template_tombstones'")).rows[0].count, 1);
    assert.equal((await pool.query("select count(*)::int as count from payload_migrations where name='20260901_000021_authorization_outbox'")).rows[0].count, 1);
    assert.equal((await pool.query("select count(*)::int as count from payload_migrations where name='20260901_000022_static_lifecycle_admission'")).rows[0].count, 1);

    await assert.rejects(insertRole("customer-alpha", "system.role.owner"), /k_nex_roles_protected_marker_check/u);
    await assert.rejects(insertRole("customer-alpha", "system.role.owner", "system.role.auditor"), /k_nex_roles_protected_marker_check/u);
    await insertRole("customer-alpha", "system.role.owner", "system.role.owner");
    await insertRole("customer-alpha", "sales.manager");
    await insertRole("customer-beta", "sales.manager");
    await assert.rejects(
      pool.query(
        `insert into k_nex_role_permission_grants
         (application_id, grant_id, role_id, permission_id, owner_kind)
         values ('customer-alpha', 'malformed-platform-owner', 'sales.manager', 'system.roles.read', 'platform')`
      ),
      /k_nex_role_permission_grants_owner_check/u,
      "A platform grant requires the exact system namespace, not SQL NULL."
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_role_permission_grants
         (application_id, grant_id, role_id, permission_id, owner_kind, owner_extension_id, owner_generation)
         values ('customer-alpha', 'malformed-extension-owner', 'sales.manager', 'sales.settings.read', 'extension', 'module.sales', 1)`
      ),
      /k_nex_role_permission_grants_owner_check/u,
      "An extension grant requires a non-NULL delivery class."
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_permission_catalog_snapshots
         (application_id, snapshot_id, source, permission_json, state, owner_kind)
         values ('customer-alpha', 'malformed-platform-snapshot', 'administrative-non-authoritative', '{}'::jsonb, 'deprecated', 'platform')`
      ),
      /k_nex_permission_catalog_snapshots_owner_check/u,
      "An administrative snapshot owner must also be complete rather than NULL-shaped."
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_permission_catalog_snapshots
         (application_id, snapshot_id, source, permission_json, state, owner_kind, owner_extension_id, owner_generation)
         values ('customer-alpha', 'malformed-extension-snapshot', 'administrative-non-authoritative', '{}'::jsonb, 'deprecated', 'extension', 'module.sales', 1)`
      ),
      /k_nex_permission_catalog_snapshots_owner_check/u,
      "An extension snapshot requires a non-NULL delivery class."
    );

    await pool.query(
      `insert into k_nex_role_assignments (application_id, assignment_id, role_id, subject_kind, subject_id, state)
       values ('customer-alpha', 'first-owner', 'system.role.owner', 'user', 'user:owner', 'active')`
    );
    await pool.query(
      `insert into k_nex_authorization_bootstrap_receipts
        (application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, protected_baseline_version, protected_baseline_digest, authorization_revision, state)
       values ('customer-alpha', 'first-owner-receipt', 'system.role.owner', 'first-owner', 'user', 'user:owner', $1, $2, 0, 'committed')`,
      [currentProtectedPlatformRoleBaselineRelease.version, currentProtectedPlatformRoleBaselineRelease.digest]
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_authorization_bootstrap_receipts
         (application_id, receipt_id, owner_role_id, owner_assignment_id, owner_principal_kind, owner_principal_id, protected_baseline_version, protected_baseline_digest, authorization_revision, state)
         values ('customer-alpha', 'replayed-owner-receipt', 'system.role.owner', 'first-owner', 'user', 'user:owner', $1, $2, 0, 'committed')`,
        [currentProtectedPlatformRoleBaselineRelease.version, currentProtectedPlatformRoleBaselineRelease.digest]
      ),
      /k_nex_authorization_bootstrap_receipts_(application|assignment)_key/u,
      "The persisted first-owner receipt must be single-use."
    );
    await assert.rejects(
      pool.query("delete from k_nex_role_assignments where application_id='customer-alpha' and assignment_id='first-owner'"),
      /k_nex_authorization_bootstrap_receipts_owner_assignment_fk/u,
      "A committed first-owner receipt retains its exact owner assignment."
    );

    await pool.query(
      `insert into k_nex_role_assignments (application_id, assignment_id, role_id, subject_kind, subject_id, state)
       values ('customer-alpha', 'sales-manager-user', 'sales.manager', 'user', 'user:alpha', 'active'),
              ('customer-beta', 'sales-manager-user', 'sales.manager', 'user', 'user:beta', 'active')`
    );
    await assert.rejects(
      pool.query("insert into k_nex_role_assignments (application_id, assignment_id, role_id, subject_kind, subject_id, state) values ('customer-alpha', 'duplicate-user', 'sales.manager', 'user', 'user:alpha', 'active')"),
      /k_nex_role_assignments_identity_key/u
    );
    assert.deepEqual((await pool.query("select application_id, subject_id from k_nex_role_assignments where assignment_id='sales-manager-user' order by application_id")).rows, [
      { application_id: "customer-alpha", subject_id: "user:alpha" },
      { application_id: "customer-beta", subject_id: "user:beta" }
    ]);

    await assert.rejects(
      parseAuthorizationStoreMutation({
        kind: "assignment",
        assignment: {
          schemaVersion: 1, id: "service-assignment", applicationId: "customer-alpha", roleId: "sales.manager",
          principal: { kind: "service", id: "service:sync" }, state: "active", revision: 0
        }
      }),
      { code: "SUBJECT_INVALID" },
      "No accepted authoritative validator means service assignment mutation must fail closed."
    );

    const store = new PostgresAuthorizationStore(pool, { validate: () => "accepted" });
    const gamma = { applicationId: "customer-gamma", environment: "production", authorizationRevision: 0, lifecycleRevision: 0 };
    const bootstrap = (suffix) => bootstrapFirstOwner({ store, expected: gamma, firstOwner: { kind: "user", id: `user:${suffix}` } });
    const bootstrapRace = await Promise.allSettled([bootstrap("one"), bootstrap("two")]);
    assert.equal(bootstrapRace.filter(({ status }) => status === "fulfilled").length, 1, "Exactly one first-owner transaction may commit.");
    const bootstrapFailure = bootstrapRace.find(({ status }) => status === "rejected");
    assert.equal(bootstrapFailure?.reason?.code, "REVISION_CONFLICT");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_bootstrap_receipts where application_id='customer-gamma'")).rows[0].count, 1);

    const revokedBootstrapApplication = "customer-epsilon";
    const revokedBootstrapAssignment = ownerAssignment(revokedBootstrapApplication, "revoked-owner", "user:revoked", "revoked");
    await assert.rejects(
      store.bootstrapFirstOwnerTransaction({ applicationId: revokedBootstrapApplication, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 }, async (transaction) => {
        await transaction.write({ kind: "role", role: ownerRole(revokedBootstrapApplication) });
        await transaction.write({ kind: "assignment", assignment: revokedBootstrapAssignment });
        await transaction.write({ kind: "bootstrap-receipt", receipt: bootstrapReceipt(revokedBootstrapApplication, "revoked-receipt", revokedBootstrapAssignment.id, revokedBootstrapAssignment.principal.id) });
      }),
      { code: "REVISION_CONFLICT" },
      "A bootstrap transaction rejects a revoked owner assignment before a receipt can close bootstrap."
    );
    assert.equal((await pool.query("select count(*)::int as count from k_nex_roles where application_id=$1", [revokedBootstrapApplication])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id=$1", [revokedBootstrapApplication])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_state where application_id=$1", [revokedBootstrapApplication])).rows[0].count, 0, "Rejected bootstrap must roll back state initialization and all writes.");

    const afterBootstrap = await store.readState(gamma.applicationId, gamma.environment);
    assert.ok(afterBootstrap);
    const ownerRows = await pool.query("select assignment_id, subject_id from k_nex_role_assignments where application_id='customer-gamma' and role_id='system.role.owner' and state='active'");
    assert.equal(ownerRows.rows.length, 1);
    const firstOwner = ownerRows.rows[0];
    const afterSecondOwner = await store.transaction(expectedRevision(afterBootstrap), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: ownerAssignment(gamma.applicationId, "owner-second", "user:second") });
    });
    assert.deepEqual((await pool.query(
      `select application_id, environment, authorization_revision, lifecycle_revision, event_json
       from k_nex_authorization_outbox
       where application_id=$1 and environment=$2 and authorization_revision=$3 and lifecycle_revision=$4`,
      [gamma.applicationId, gamma.environment, afterSecondOwner.state.authorizationRevision, afterSecondOwner.state.lifecycleRevision]
    )).rows, [{
      application_id: gamma.applicationId,
      environment: gamma.environment,
      authorization_revision: afterSecondOwner.state.authorizationRevision,
      lifecycle_revision: afterSecondOwner.state.lifecycleRevision,
      event_json: {
        applicationId: gamma.applicationId,
        environment: gamma.environment,
        scope: "application",
        authorizationRevision: afterSecondOwner.state.authorizationRevision,
        lifecycleRevision: afterSecondOwner.state.lifecycleRevision
      }
    }]);
    const revoke = (assignmentId, subjectId) => store.transaction(expectedRevision(afterSecondOwner.state), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: ownerAssignment(gamma.applicationId, assignmentId, subjectId, "revoked") });
    });
    const revokeRace = await Promise.allSettled([
      revoke(firstOwner.assignment_id, firstOwner.subject_id),
      revoke("owner-second", "user:second")
    ]);
    assert.equal(revokeRace.filter(({ status }) => status === "fulfilled").length, 1, "Revision-fenced concurrent owner revocations cannot both commit.");
    assert.equal(revokeRace.find(({ status }) => status === "rejected")?.reason?.code, "REVISION_CONFLICT");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id='customer-gamma' and role_id='system.role.owner' and state='active'")).rows[0].count, 1, "Concurrent revocation must leave one active owner.");
    const finalState = await store.readState(gamma.applicationId, gamma.environment);
    assert.ok(finalState);
    const finalOwner = (await pool.query("select assignment_id, subject_id from k_nex_role_assignments where application_id='customer-gamma' and role_id='system.role.owner' and state='active'")).rows[0];
    await assert.rejects(
      store.transaction(expectedRevision(finalState), async (transaction) => {
        await transaction.write({ kind: "assignment", assignment: ownerAssignment(gamma.applicationId, finalOwner.assignment_id, finalOwner.subject_id, "revoked") });
      }),
      { code: "REVISION_CONFLICT" },
      "The current last owner cannot be revoked."
    );
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id='customer-gamma' and role_id='system.role.owner' and state='active'")).rows[0].count, 1, "Rejected last-owner revocation must retain the owner.");

    const deltaProduction = { applicationId: "customer-delta", environment: "production", authorizationRevision: 0, lifecycleRevision: 0 };
    const deltaStaging = { ...deltaProduction, environment: "staging" };
    const deltaBootstrap = await bootstrapFirstOwner({ store, expected: deltaProduction, firstOwner: { kind: "user", id: "user:delta-one" } });
    const deltaOwnerOneId = (await pool.query("select assignment_id from k_nex_role_assignments where application_id=$1 and role_id='system.role.owner' and subject_id='user:delta-one'", [deltaProduction.applicationId])).rows[0].assignment_id;
    const deltaProductionState = await store.transaction(expectedRevision(deltaBootstrap.state), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: ownerAssignment(deltaProduction.applicationId, "delta-owner-two", "user:delta-two") });
    });
    const deltaStagingState = await store.readState(deltaStaging.applicationId, deltaStaging.environment);
    assert.ok(deltaStagingState);
    assert.deepEqual(
      [deltaStagingState.authorizationRevision, deltaStagingState.lifecycleRevision],
      [deltaProductionState.state.authorizationRevision, deltaProductionState.state.lifecycleRevision],
      "Production and staging read one application-global authorization state."
    );
    const deltaAfterProductionMutation = await store.transaction(expectedRevision(deltaProductionState.state), async (transaction) => {
      await transaction.write({ kind: "assignment", assignment: ownerAssignment(deltaProduction.applicationId, deltaOwnerOneId, "user:delta-one") });
    });
    await assert.rejects(
      store.transaction(expectedRevision(deltaStagingState), async (transaction) => {
        await transaction.write({ kind: "assignment", assignment: ownerAssignment(deltaStaging.applicationId, "delta-owner-two", "user:delta-two") });
      }),
      { code: "REVISION_CONFLICT" },
      "A production mutation must make staging's stale application-global revision conflict."
    );
    const deltaCurrentStagingState = await store.readState(deltaStaging.applicationId, deltaStaging.environment);
    assert.ok(deltaCurrentStagingState);
    assert.deepEqual(
      [deltaCurrentStagingState.authorizationRevision, deltaCurrentStagingState.lifecycleRevision],
      [deltaAfterProductionMutation.state.authorizationRevision, deltaAfterProductionMutation.state.lifecycleRevision]
    );
    const crossEnvironmentRevocations = await Promise.allSettled([
      store.transaction(expectedRevision(deltaAfterProductionMutation.state), async (transaction) => {
        await transaction.write({ kind: "assignment", assignment: ownerAssignment(deltaProduction.applicationId, deltaOwnerOneId, "user:delta-one", "revoked") });
      }),
      store.transaction(expectedRevision(deltaCurrentStagingState), async (transaction) => {
        await transaction.write({ kind: "assignment", assignment: ownerAssignment(deltaProduction.applicationId, "delta-owner-two", "user:delta-two", "revoked") });
      })
    ]);
    assert.equal(crossEnvironmentRevocations.filter(({ status }) => status === "fulfilled").length, 1, "Application-wide owner serialization must span environments.");
    assert.equal(crossEnvironmentRevocations.find(({ status }) => status === "rejected")?.reason?.code, "REVISION_CONFLICT");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_assignments where application_id='customer-delta' and role_id='system.role.owner' and state='active'")).rows[0].count, 1, "Cross-environment revocation races must retain one owner.");

    await insertGeneration("customer-alpha", 1);
    await insertGeneration("customer-beta", 1);
    await assert.rejects(insertGeneration("customer-alpha", 2), /k_nex_extension_authorization_generations_current_key/u);
    await insertGeneration("customer-alpha", 2, "retired");
    await pool.query(
      `insert into k_nex_role_permission_grants
       (application_id, grant_id, role_id, permission_id, owner_kind, owner_delivery_class, owner_extension_id, owner_generation)
       values ('customer-alpha', 'sales-read', 'sales.manager', 'sales.opportunity.read', 'extension', 'platform-plugin', 'module.sales', 1)`
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_role_permission_grants
         (application_id, grant_id, role_id, permission_id, owner_kind, owner_delivery_class, owner_extension_id, owner_generation)
         values ('customer-alpha', 'sales-read-duplicate', 'sales.manager', 'sales.opportunity.read', 'extension', 'platform-plugin', 'module.sales', 1)`
      ),
      /k_nex_role_permission_grants_identity_key/u
    );
    await assert.rejects(
      pool.query("delete from k_nex_extension_authorization_generations where application_id='customer-alpha' and delivery_class='platform-plugin' and extension_id='module.sales' and authorization_generation=1"),
      /k_nex_role_permission_grants_extension_owner_fk/u,
      "Referenced generation must be retained rather than destructively cascaded."
    );
    await assert.rejects(
      pool.query(
        `insert into k_nex_role_permission_grants
         (application_id, grant_id, role_id, permission_id, owner_kind, owner_delivery_class, owner_extension_id, owner_generation)
         values ('customer-beta', 'cross-application', 'sales.manager', 'sales.opportunity.write', 'extension', 'platform-plugin', 'module.sales', 2)`
      ),
      /k_nex_role_permission_grants_extension_owner_fk/u,
      "A generation from another customer application cannot fence a grant."
    );

    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("begin");
      await rollbackClient.query("insert into k_nex_authorization_state (application_id) values ('customer-alpha')");
      await rollbackClient.query("rollback");
    } catch (error) {
      try { await rollbackClient.query("rollback"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      rollbackClient.release();
    }
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_state where application_id='customer-alpha'")).rows[0].count, 0, "Real PostgreSQL rollback must leave no partial authorization state.");
  } finally {
    try {
      await pool.end();
    } finally {
      await container.stop();
    }
  }
});
