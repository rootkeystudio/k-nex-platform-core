import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import {
  CurrentAuthorityAdapter,
  EffectiveAuthorityResolver,
  SystemAccessAdministrationService,
  bootstrapFirstOwner,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationCatalog,
  createTrustedAuthorizationSession
} from "@k-nex/runtime";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-system-access-delegation";
const environment = "production";

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-delegation", BOOT_KEY: "p10-delegation" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject).once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function expected(store) {
  const state = await store.readState(applicationId, environment);
  assert.ok(state);
  return { applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
}

async function durableState(pool) {
  const [state, roles, grants, assignments, audits, outbox] = await Promise.all([
    pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId]),
    pool.query("select role_id from k_nex_roles where application_id=$1 order by role_id", [applicationId]),
    pool.query("select grant_id, role_id, permission_id from k_nex_role_permission_grants where application_id=$1 order by grant_id", [applicationId]),
    pool.query("select assignment_id, role_id, subject_kind, subject_id, state from k_nex_role_assignments where application_id=$1 order by assignment_id", [applicationId]),
    pool.query("select audit_id from k_nex_authorization_audit where application_id=$1 order by audit_id", [applicationId]),
    pool.query("select event_id from k_nex_authorization_outbox where application_id=$1 order by event_id", [applicationId])
  ]);
  return { state: state.rows, roles: roles.rows, grants: grants.rows, assignments: assignments.rows, audits: audits.rows, outbox: outbox.rows };
}

test("P10.10 blocks User Admin and Security Admin escalation at the PostgreSQL administration boundary", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("system_access_delegation").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const acceptedUsers = new Set(["user:owner", "user:user-admin", "user:security-admin", "user:second-owner"]);
    const store = new PostgresAuthorizationStore(pool, { validate: (_applicationId, subject) => subject.kind === "user" && acceptedUsers.has(subject.id) ? "accepted" : "rejected" });
    await bootstrapFirstOwner({ store, expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: "user:owner" } });

    const catalog = createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision: 0, extensions: [], executables: [] });
    const provider = createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) => requested === applicationId && lifecycleRevision === 0 ? { applicationId, lifecycleRevision, catalog } : undefined);
    const sessions = new Map(["owner", "user-admin", "security-admin"].map((name) => [name, createTrustedAuthorizationSession({
      schemaVersion: 1,
      applicationId,
      environment,
      correlationId: `p10-delegation-${name}`,
      principal: { kind: "user", id: `user:${name}` },
      effectiveActor: { kind: "user", id: `user:${name}` }
    })]));
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: provider });
    const authority = new CurrentAuthorityAdapter({ current: (context) => sessions.get(context.session) }, resolver);
    const protectedAdmissions = [];
    const access = new SystemAccessAdministrationService({
      store,
      catalogProvider: provider,
      authority,
      protectedAssignmentAdmission: { verify: async (input) => {
        protectedAdmissions.push({ operation: input.operation, roleId: input.role.id, protectedRoleId: input.role.protectedRoleId, assignmentId: input.assignmentId, principal: input.principal });
        return { approval: "satisfied", reauthentication: "satisfied" };
      } }
    });
    const context = (session) => ({ session });

    await access.createAssignment({ context: context("owner"), expected: await expected(store), assignment: { id: "user-admin-assignment", roleId: "system.role.user-admin", principal: { kind: "user", id: "user:user-admin" } } });
    await access.createAssignment({ context: context("owner"), expected: await expected(store), assignment: { id: "security-admin-assignment", roleId: "system.role.security-admin", principal: { kind: "user", id: "user:security-admin" } } });
    await access.createRole({ context: context("owner"), expected: await expected(store), role: { id: "customer.synthesized", label: "Synthesized escalation target" } });

    const beforeDenied = await durableState(pool);
    const deniedExpected = await expected(store);
    await assert.rejects(access.createAssignment({ context: context("user-admin"), expected: deniedExpected, assignment: { id: "forged-owner", roleId: "system.role.owner", principal: { kind: "user", id: "user:second-owner" } } }), { code: "UNAUTHORIZED" });
    await assert.rejects(access.createAssignment({ context: context("security-admin"), expected: deniedExpected, assignment: { id: "forged-extension-admin", roleId: "system.role.extension-admin", principal: { kind: "user", id: "user:second-owner" } } }), { code: "UNAUTHORIZED" });
    await assert.rejects(access.addPermission({ context: context("security-admin"), expected: deniedExpected, roleId: "customer.synthesized", permissionId: "system.extensions.deploy-platform-plugin" }), { code: "UNAUTHORIZED" });
    await assert.rejects(access.createAssignment({ context: context("security-admin"), expected: deniedExpected, assignment: { id: "self-escalation", roleId: "customer.synthesized", principal: { kind: "user", id: "user:security-admin" } } }), { code: "UNAUTHORIZED" });
    assert.deepEqual(await durableState(pool), beforeDenied, "Denied direct and synthesized/self escalation writes no state, grant, assignment, audit, revision, or outbox row.");

    const beforeOwner = await expected(store);
    const ownerResult = await access.createAssignment({ context: context("owner"), expected: beforeOwner, assignment: { id: "second-owner", roleId: "system.role.owner", principal: { kind: "user", id: "user:second-owner" } } });
    assert.equal(ownerResult.state.authorizationRevision, beforeOwner.authorizationRevision + 1);
    assert.deepEqual(protectedAdmissions.at(-1), {
      operation: "create-assignment",
      roleId: "system.role.owner",
      protectedRoleId: "system.role.owner",
      assignmentId: "second-owner",
      principal: { kind: "user", id: "user:second-owner" }
    });
    const ownerAudit = await pool.query("select audit_json from k_nex_authorization_audit where application_id=$1 and audit_json->>'operation'='create-assignment' and audit_json->>'target' like 'access.protected-assignment.%' order by created_at desc limit 1", [applicationId]);
    assert.equal(ownerAudit.rows[0].audit_json.approval, "satisfied");
    assert.equal(ownerAudit.rows[0].audit_json.reauthentication, "satisfied");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and authorization_revision=$2", [applicationId, ownerResult.state.authorizationRevision])).rows[0].count, 1);
  } finally {
    await pool.end();
    await container.stop();
  }
});
