import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { bootstrapFirstOwner } from "@k-nex/runtime";
import { canonicalJson } from "@k-nex/contracts";
import { createHash } from "node:crypto";
import { createPayloadRequest } from "payload";
import pg from "pg";

import { installStaticAuthorizationEnvironment, staticAuthorizationBuild } from "./static-authorization-build.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const directory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-gate-1";
const owner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });

installStaticAuthorizationEnvironment();

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p13-3-http", BOOT_KEY: "p13-3-http" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function startHttp(payload, cacheKey) {
  const action = payload.config.endpoints.find(({ path }) => path === "/k-nex/action");
  const source = payload.config.endpoints.find(({ path }) => path === "/k-nex/data-source-query");
  assert.ok(action && source);
  const server = createServer(async (incoming, outgoing) => {
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.once("end", () => resolve(Buffer.concat(chunks)));
      incoming.once("error", reject);
    }).catch(() => undefined);
    const endpoint = incoming.url === "/k-nex/action" ? action : incoming.url === "/k-nex/data-source-query" ? source : undefined;
    if (endpoint === undefined) { outgoing.writeHead(404).end(); return; }
    const request = await createPayloadRequest({
      config: payload.config,
      payloadInstanceCacheKey: cacheKey,
      request: new Request(`http://127.0.0.1${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(body === undefined || incoming.method === "GET" ? {} : { body }) })
    });
    const response = await endpoint.handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return Object.freeze({ origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolveClose, reject) => server.close((error) => error === undefined ? resolveClose() : reject(error))) });
}

async function seed(pool, userId) {
  const store = new PostgresAuthorizationStore(pool, { validate: (candidate, subject) => candidate === applicationId && subject.kind === "user" && subject.id === String(userId) ? "accepted" : "rejected" });
  const bootstrap = await bootstrapFirstOwner({ store, expected: { applicationId, environment: "production", authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: String(userId) } });
  const permissions = [
    "sales.accounts.read", "sales.accounts.write", "sales.accounts.archive",
    "sales.contacts.read", "sales.contacts.write", "sales.contacts.archive", "sales.contacts.channels.read",
    "sales.leads.read", "sales.leads.write", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.qualify", "sales.leads.disqualify",
    "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.stage.update", "sales.opportunities.archive", "sales.opportunities.amount.read", "sales.opportunities.close", "sales.pipelines.read",
    "sales.activities.read", "sales.activities.write", "sales.notes.read", "sales.notes.write", "sales.notes.body.read", "sales.attachments.read", "sales.attachments.write", "sales.tasks.read", "sales.tasks.write"
  ];
  const state = await store.transaction({ applicationId, environment: "production", authorizationRevision: bootstrap.state.authorizationRevision, lifecycleRevision: bootstrap.state.lifecycleRevision }, async (transaction) => {
    await transaction.write({ kind: "extension-generation", generation: { schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["static-module-sales-1"], state: "current", authorizationRevision: 0, lifecycleRevision: 0 } });
    await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: "p13-3.operator", label: "P13.3 operator", revision: 0 } });
    await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: "p13-3.operator.user", roleId: "p13-3.operator", principal: { kind: "user", id: String(userId) }, state: "active", revision: 0 } });
    for (const permissionId of permissions) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `p13-3.${permissionId}`, roleId: "p13-3.operator", permissionId, owner, revision: 0 } });
  });
  await pool.query("insert into runtime_extensions (application_id,environment,delivery_class,extension_id,revision,disposition,active_generation_id,active_generation) values ($1,'production','platform-plugin','module.sales',1,'active',$2,$3::jsonb)", [applicationId, "static-module-sales-1", JSON.stringify(staticAuthorizationBuild)]);
  await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,'production',$2,'owned-or-assigned-team',false,true,$3::jsonb,'active',1)", [applicationId, String(userId), JSON.stringify([`team:${userId}`])]);
  return state;
}

async function seedViewer(pool, userId) {
  const store = new PostgresAuthorizationStore(pool, { validate: (candidate, subject) => candidate === applicationId && subject.kind === "user" ? "accepted" : "rejected" });
  const state = (await pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0];
  await store.transaction({ applicationId, environment: "production", authorizationRevision: state.authorization_revision, lifecycleRevision: state.lifecycle_revision }, async (transaction) => {
    await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: "p13-3.viewer", label: "P13.3 viewer", revision: 0 } });
    await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: "p13-3.viewer.user", roleId: "p13-3.viewer", principal: { kind: "user", id: String(userId) }, state: "active", revision: 0 } });
    for (const permissionId of ["sales.accounts.read", "sales.contacts.read", "sales.leads.read", "sales.opportunities.read", "sales.activities.read", "sales.notes.read", "sales.attachments.read"]) {
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `p13-3.viewer.${permissionId}`, roleId: "p13-3.viewer", permissionId, owner, revision: 0 } });
    }
  });
  await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,'production',$2,'explicit-application-or-team-scope',true,false,'[]'::jsonb,'active',1)", [applicationId, String(userId)]);
}

async function seedSalesUser(pool, userId, roleId, permissions, scope) {
  const store = new PostgresAuthorizationStore(pool, { validate: (candidate, subject) => candidate === applicationId && subject.kind === "user" ? "accepted" : "rejected" });
  const state = (await pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0];
  await store.transaction({ applicationId, environment: "production", authorizationRevision: state.authorization_revision, lifecycleRevision: state.lifecycle_revision }, async (transaction) => {
    await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: roleId, label: roleId, revision: 0 } });
    await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: `${roleId}.user`, roleId, principal: { kind: "user", id: String(userId) }, state: "active", revision: 0 } });
    for (const permissionId of permissions) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `${roleId}.${permissionId}`, roleId, permissionId, owner, revision: 0 } });
  });
  await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,'production',$2,$3,$4,$5,$6::jsonb,'active',1)", [applicationId, String(userId), scope.recordScope, scope.applicationWide, scope.mutationAllowed, JSON.stringify(scope.authorizedTeamIds)]);
}

async function seedAdditionalPermissionRole(pool, userId, roleId, permissionId, grantOwner = owner) {
  const store = new PostgresAuthorizationStore(pool, { validate: (candidate, subject) => candidate === applicationId && subject.kind === "user" ? "accepted" : "rejected" });
  const state = (await pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0];
  await store.transaction({ applicationId, environment: "production", authorizationRevision: state.authorization_revision, lifecycleRevision: state.lifecycle_revision }, async (transaction) => {
    await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: roleId, label: roleId, revision: 0 } });
    await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: `${roleId}.user`, roleId, principal: { kind: "user", id: String(userId) }, state: "active", revision: 0 } });
    await transaction.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `${roleId}.${permissionId}`, roleId, permissionId, owner: grantOwner, revision: 0 } });
  });
}

test("P13.3 CRM HTTP/PG actions preserve replay, target scope, and protected-input boundaries", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_3_crm_http").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let payload;
  let http;
  try {
    await boot(container.getConnectionUri());
    await pool.query(`CREATE TABLE k_nex_sales_attachment_upload_admissions (
      storage_ref text PRIMARY KEY, application_id text NOT NULL, environment text NOT NULL, uploader_actor_id text NOT NULL,
      filename text NOT NULL, media_type text NOT NULL, byte_size integer NOT NULL, state text NOT NULL, revision integer NOT NULL
    )`);
    process.env.DATABASE_URL = container.getConnectionUri(); process.env.NODE_ENV = "production"; process.env.PAYLOAD_SECRET = "p13-3-http";
    const { bootGate1Application, shutdownGate1Application } = await import("../dist/src/boot.js");
    payload = await bootGate1Application({ key: "p13-3-http" });
    const password = "p13-3-http-password";
    const user = await payload.create({ collection: "users", data: { email: "p13-3@example.test", password } });
    await seed(pool, user.id);
    const viewer = await payload.create({ collection: "users", data: { email: "p13-3-viewer@example.test", password } });
    await seedViewer(pool, viewer.id);
    const manager = await payload.create({ collection: "users", data: { email: "p13-3-manager@example.test", password } });
    const representative = await payload.create({ collection: "users", data: { email: "p13-3-representative@example.test", password } });
    const candidate = await payload.create({ collection: "users", data: { email: "p13-3-candidate@example.test", password } });
    const linker = await payload.create({ collection: "users", data: { email: "p13-3-linker@example.test", password } });
    const noAccountRead = await payload.create({ collection: "users", data: { email: "p13-3-no-account-read@example.test", password } });
    const admin = await payload.create({ collection: "users", data: { email: "p13-3-admin@example.test", password } });
    const protectedDenied = await payload.create({ collection: "users", data: { email: "p13-3-protected-denied@example.test", password } });
    await seedSalesUser(pool, manager.id, "p13-3.manager", ["sales.ownership.write", "sales.accounts.read", "sales.accounts.write", "sales.contacts.read", "sales.contacts.write", "sales.contacts.channels.read", "sales.leads.read", "sales.leads.write", "sales.leads.qualify", "sales.leads.channels.read", "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.amount.read", "sales.pipelines.read", "sales.activities.read", "sales.notes.read", "sales.notes.body.read", "sales.attachments.read"], { recordScope: "managed-teams-and-own", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [`team:${user.id}`, `team:${representative.id}`, "team:crm-owner"] });
    await seedSalesUser(pool, representative.id, "p13-3.representative", ["sales.accounts.read", "sales.accounts.write", "sales.leads.read", "sales.leads.write", "sales.activities.read", "sales.activities.write", "sales.tasks.read", "sales.notes.read", "sales.attachments.read"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [`team:${representative.id}`] });
    await seedSalesUser(pool, candidate.id, "p13-3.candidate", ["sales.accounts.read", "sales.accounts.write", "sales.activities.read", "sales.activities.write", "sales.tasks.read", "sales.notes.read", "sales.notes.write", "sales.attachments.read", "sales.attachments.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [`team:${candidate.id}`] });
    await seedSalesUser(pool, linker.id, "p13-3.linker", ["sales.accounts.read", "sales.contacts.read", "sales.leads.read", "sales.leads.write", "sales.leads.qualify", "sales.opportunities.write", "sales.pipelines.read"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [`team:${linker.id}`] });
    await seedSalesUser(pool, noAccountRead.id, "p13-3.no-account-read", ["sales.contacts.read", "sales.leads.read", "sales.leads.write", "sales.leads.qualify", "sales.opportunities.write", "sales.pipelines.read"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [`team:${noAccountRead.id}`] });
    await seedSalesUser(pool, admin.id, "p13-3.admin", ["sales.ownership.write"], { recordScope: "application-sales-scope", applicationWide: true, mutationAllowed: true, authorizedTeamIds: [] });
    await seedSalesUser(pool, "user:crm-owner", "p13-3.nonnumeric-owner", ["sales.accounts.read", "sales.accounts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: ["team:crm-owner"] });
    await seedAdditionalPermissionRole(pool, user.id, "p13-3.overlapping-channels", "sales.contacts.channels.read");
    await seedSalesUser(pool, protectedDenied.id, "p13-3.protected-denied", ["sales.accounts.read", "sales.accounts.write", "sales.contacts.read", "sales.contacts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [`team:${protectedDenied.id}`] });
    const login = await payload.login({ collection: "users", data: { email: "p13-3@example.test", password }, overrideAccess: false });
    const viewerLogin = await payload.login({ collection: "users", data: { email: "p13-3-viewer@example.test", password }, overrideAccess: false });
    const managerLogin = await payload.login({ collection: "users", data: { email: "p13-3-manager@example.test", password }, overrideAccess: false });
    const representativeLogin = await payload.login({ collection: "users", data: { email: "p13-3-representative@example.test", password }, overrideAccess: false });
    const candidateLogin = await payload.login({ collection: "users", data: { email: "p13-3-candidate@example.test", password }, overrideAccess: false });
    const linkerLogin = await payload.login({ collection: "users", data: { email: "p13-3-linker@example.test", password }, overrideAccess: false });
    const noAccountReadLogin = await payload.login({ collection: "users", data: { email: "p13-3-no-account-read@example.test", password }, overrideAccess: false });
    const adminLogin = await payload.login({ collection: "users", data: { email: "p13-3-admin@example.test", password }, overrideAccess: false });
    const protectedDeniedLogin = await payload.login({ collection: "users", data: { email: "p13-3-protected-denied@example.test", password }, overrideAccess: false });
    assert.ok(login.token);
    http = await startHttp(payload, "p13-3-http");
    const post = async (path, body, key = "p13-3-key-0001") => fetch(`${http.origin}${path}`, { method: "POST", headers: { authorization: `JWT ${login.token}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const postAs = async (token, path, body, key) => fetch(`${http.origin}${path}`, { method: "POST", headers: { authorization: `JWT ${token}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const sourceAs = async (token, body) => fetch(`${http.origin}/k-nex/data-source-query`, { method: "POST", headers: { authorization: `JWT ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

    const createBody = { actionId: "sales.account.create", input: { name: "HTTP account" } };
    const created = await post("/k-nex/action", createBody, "p13-3-account-create");
    assert.equal(created.status, 200);
    const createdData = (await created.json()).data;
    const overlappingProtectedGrants = await pool.query(`select count(*)::int as count from k_nex_role_assignments a
      join k_nex_role_permission_grants g on g.application_id=a.application_id and g.role_id=a.role_id
      join k_nex_extension_authorization_generations x on x.application_id=g.application_id and x.delivery_class=g.owner_delivery_class and x.extension_id=g.owner_extension_id and x.authorization_generation=g.owner_generation
      where a.application_id=$1 and a.subject_kind='user' and a.subject_id=$2 and a.state='active' and g.permission_id='sales.contacts.channels.read'
        and g.owner_kind='extension' and g.owner_delivery_class='platform-plugin' and g.owner_extension_id='module.sales' and x.state='current'`, [applicationId, String(user.id)]);
    assert.deepEqual(overlappingProtectedGrants.rows, [{ count: 2 }]);
    const overlappingProtectedContact = await post("/k-nex/action", { actionId: "sales.contact.create", input: { accountId: createdData.id, displayName: "Overlapping protected contact", email: "overlap@example.test" } }, "p13-3-overlapping-protected-contact");
    assert.equal(overlappingProtectedContact.status, 200, await overlappingProtectedContact.clone().text());
    assert.deepEqual((await pool.query("select email from sales_contacts where id=$1", [(await overlappingProtectedContact.json()).data.id])).rows, [{ email: "overlap@example.test" }]);
    const protectedAccount = await postAs(protectedDeniedLogin.token, "/k-nex/action", { actionId: "sales.account.create", input: { name: "Protected denial account" } }, "p13-3-protected-denial-account");
    assert.equal(protectedAccount.status, 200, await protectedAccount.clone().text());
    const protectedContactBody = { actionId: "sales.contact.create", input: { accountId: (await protectedAccount.json()).data.id, displayName: "Protected denial contact", email: "denied@example.test" } };
    const protectedDeniedBefore = (await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const zeroGrantDenied = await postAs(protectedDeniedLogin.token, "/k-nex/action", protectedContactBody, "p13-3-protected-zero-grant");
    assert.equal(zeroGrantDenied.status, 403, await zeroGrantDenied.clone().text());
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], protectedDeniedBefore);
    const replay = await post("/k-nex/action", createBody, "p13-3-account-create");
    assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).data, createdData);
    for (const [suffix, forged] of [
      ["secret", { id: createdData.id, revision: 1, status: "active", secret: "must-not-leak" }],
      ["status", { id: createdData.id, revision: 1, status: "qualified" }],
      ["id", { id: "not-an-id", revision: 1, status: "active" }]
    ]) {
      const key = `p13-3-output-${suffix}`;
      const body = { actionId: "sales.account.create", input: { name: `Output ${suffix}` } };
      assert.equal((await post("/k-nex/action", body, key)).status, 200);
      const result = { state: "succeeded", data: forged };
      const resultDigest = `sha256:${createHash("sha256").update(canonicalJson(result)).digest("hex")}`;
      await pool.query("update sales_action_idempotency set result_json=$1::jsonb,result_digest=$2 where application_id=$3 and environment='production' and effective_actor_id=$4 and action_id='sales.account.create' and idempotency_key=$5", [JSON.stringify(result), resultDigest, applicationId, String(user.id), key]);
      const rejectedReplay = await post("/k-nex/action", body, key);
      assert.equal(rejectedReplay.status, 403, await rejectedReplay.clone().text());
      assert.equal((await rejectedReplay.text()).includes("must-not-leak"), false);
    }
    const conflict = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "changed" } }, "p13-3-account-create");
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual((await pool.query("select count(*)::int count from sales_accounts where name='HTTP account'" )).rows, [{ count: 1 }]);
    const ownershipBody = { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: createdData.id, expectedRevision: 1, ownerId: String(candidate.id), teamId: `team:${user.id}` } };
    const ownershipStale = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { ...ownershipBody.input, expectedRevision: 2 } }, "p13-3-ownership-stale");
    assert.equal(ownershipStale.status, 409, await ownershipStale.clone().text());
    const ownershipOutboxBefore = Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.ownership.assign'" )).rows[0].count);
    const owned = await postAs(managerLogin.token, "/k-nex/action", ownershipBody, "p13-3-ownership-manager");
    assert.equal(owned.status, 200, await owned.clone().text());
    const ownedData = (await owned.json()).data;
    assert.deepEqual(ownedData, { recordType: "sales.account", id: createdData.id, revision: 2, ownerId: String(candidate.id), teamId: `team:${user.id}` });
    const ownershipReplay = await postAs(managerLogin.token, "/k-nex/action", ownershipBody, "p13-3-ownership-manager");
    assert.equal(ownershipReplay.status, 200); assert.deepEqual((await ownershipReplay.json()).data, ownedData);
    const ownershipNoChange = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { ...ownershipBody.input, expectedRevision: 2 } }, "p13-3-ownership-no-change");
    assert.equal(ownershipNoChange.status, 409, await ownershipNoChange.clone().text());
    const foreignOwner = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { ...ownershipBody.input, expectedRevision: 2, ownerId: String(viewer.id) } }, "p13-3-ownership-foreign-owner");
    assert.equal(foreignOwner.status, 403, await foreignOwner.clone().text());
    const foreignTeam = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { ...ownershipBody.input, expectedRevision: 2, teamId: "team:foreign" } }, "p13-3-ownership-foreign-team");
    assert.equal(foreignTeam.status, 403, await foreignTeam.clone().text());
    const representativeDenied = await postAs(representativeLogin.token, "/k-nex/action", ownershipBody, "p13-3-ownership-representative");
    assert.equal(representativeDenied.status, 403, await representativeDenied.clone().text());
    const viewerDenied = await postAs(viewerLogin.token, "/k-nex/action", ownershipBody, "p13-3-ownership-viewer");
    assert.equal(viewerDenied.status, 403, await viewerDenied.clone().text());
    const adminOwned = await postAs(adminLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: createdData.id, expectedRevision: 2, ownerId: String(candidate.id), teamId: `team:${candidate.id}` } }, "p13-3-ownership-admin");
    assert.equal(adminOwned.status, 200, await adminOwned.clone().text());
    const restored = await postAs(adminLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: createdData.id, expectedRevision: 3, ownerId: String(user.id), teamId: `team:${user.id}` } }, "p13-3-ownership-admin-restore");
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.deepEqual((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.ownership.assign'" )).rows, [{ count: ownershipOutboxBefore + 3 }]);
    assert.deepEqual((await pool.query("select audit->-1->>'actionId' action_id, revision from sales_accounts where id=$1", [createdData.id])).rows, [{ action_id: "sales.ownership.assign", revision: 4 }]);
    const nonnumericAccount = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Nonnumeric owner target" } }, "p13-3-nonnumeric-account");
    const nonnumericAccountData = (await nonnumericAccount.json()).data;
    const nonnumericOwnershipBody = { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: nonnumericAccountData.id, expectedRevision: 1, ownerId: "user:crm-owner", teamId: "team:crm-owner" } };
    const nonnumericOwnership = await postAs(managerLogin.token, "/k-nex/action", nonnumericOwnershipBody, "p13-3-nonnumeric-owner");
    assert.equal(nonnumericOwnership.status, 200, await nonnumericOwnership.clone().text());
    assert.deepEqual((await nonnumericOwnership.json()).data, { recordType: "sales.account", id: nonnumericAccountData.id, revision: 2, ownerId: "user:crm-owner", teamId: "team:crm-owner" });
    const nonnumericReplay = await postAs(managerLogin.token, "/k-nex/action", nonnumericOwnershipBody, "p13-3-nonnumeric-owner");
    assert.equal(nonnumericReplay.status, 200, await nonnumericReplay.clone().text());
    assert.deepEqual((await nonnumericReplay.json()).data, { recordType: "sales.account", id: nonnumericAccountData.id, revision: 2, ownerId: "user:crm-owner", teamId: "team:crm-owner" });
    const forgedOwnershipResult = { state: "succeeded", data: { recordType: "sales.account", id: nonnumericAccountData.id, revision: 2, ownerId: "bad owner", teamId: "team:crm-owner" } };
    const forgedOwnershipDigest = `sha256:${createHash("sha256").update(canonicalJson(forgedOwnershipResult)).digest("hex")}`;
    await pool.query("update sales_action_idempotency set result_json=$1::jsonb,result_digest=$2 where application_id=$3 and environment='production' and effective_actor_id=$4 and action_id='sales.ownership.assign' and idempotency_key='p13-3-nonnumeric-owner'", [JSON.stringify(forgedOwnershipResult), forgedOwnershipDigest, applicationId, String(manager.id)]);
    assert.equal((await postAs(managerLogin.token, "/k-nex/action", nonnumericOwnershipBody, "p13-3-nonnumeric-owner")).status, 403);
    const deniedOwner = async (ownerId, key) => {
      const response = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: nonnumericAccountData.id, expectedRevision: 2, ownerId } }, key);
      assert.equal(response.status, 403, await response.clone().text());
    };
    await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,'production','user:scope-only','owned-or-assigned-team',false,true,'[]'::jsonb,'active',1)", [applicationId]);
    await deniedOwner("user:scope-only", "p13-3-owner-scope-only");
    await seedSalesUser(pool, "user:assignment-only", "p13-3.assignment-only", ["sales.accounts.read", "sales.accounts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [] });
    await pool.query("delete from sales_current_authority_scopes where application_id=$1 and environment='production' and principal_id='user:assignment-only'", [applicationId]);
    await deniedOwner("user:assignment-only", "p13-3-owner-assignment-only");
    await seedSalesUser(pool, "user:revoked", "p13-3.revoked", ["sales.accounts.read", "sales.accounts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [] });
    await pool.query("update k_nex_role_assignments set state='revoked' where application_id=$1 and subject_id='user:revoked'", [applicationId]);
    await deniedOwner("user:revoked", "p13-3-owner-revoked");
    await seedSalesUser(pool, "user:read-only", "p13-3.read-only", ["sales.accounts.read", "sales.accounts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [] });
    await pool.query("update sales_current_authority_scopes set record_scope='explicit-application-or-team-scope',mutation_allowed=false where application_id=$1 and environment='production' and principal_id='user:read-only'", [applicationId]);
    await deniedOwner("user:read-only", "p13-3-owner-read-only");
    await seedSalesUser(pool, "user:wrong-env", "p13-3.wrong-env", ["sales.accounts.read", "sales.accounts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [] });
    await pool.query("update sales_current_authority_scopes set environment='staging' where application_id=$1 and environment='production' and principal_id='user:wrong-env'", [applicationId]);
    await deniedOwner("user:wrong-env", "p13-3-owner-wrong-env");
    await seedSalesUser(pool, "user:stale-generation", "p13-3.stale-generation", ["sales.accounts.read", "sales.accounts.write"], { recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: [] });
    await pool.query("insert into k_nex_extension_authorization_generations (application_id,delivery_class,extension_id,authorization_generation,runtime_generation_ids,state,authorization_revision,lifecycle_revision) select application_id,delivery_class,extension_id,2,runtime_generation_ids,'retired',authorization_revision,lifecycle_revision from k_nex_extension_authorization_generations where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and state='current'", [applicationId]);
    await pool.query("update k_nex_role_permission_grants set owner_generation=2 where application_id=$1 and role_id='p13-3.stale-generation'", [applicationId]);
    await deniedOwner("user:stale-generation", "p13-3-owner-stale-generation");
    const mismatchedProtectedBefore = (await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    await seedAdditionalPermissionRole(pool, protectedDenied.id, "p13-3.protected-mismatched-generation", "sales.contacts.channels.read", { ...owner, generation: 2 });
    const mismatchedGrantDenied = await postAs(protectedDeniedLogin.token, "/k-nex/action", protectedContactBody, "p13-3-protected-mismatched-grant");
    assert.equal(mismatchedGrantDenied.status, 403, await mismatchedGrantDenied.clone().text());
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], mismatchedProtectedBefore);
    for (const [ownerId, key] of [["bad owner", "p13-3-owner-malformed"], [`u${"x".repeat(160)}`, "p13-3-owner-overlong"]]) {
      const response = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: nonnumericAccountData.id, expectedRevision: 2, ownerId } }, key);
      assert.notEqual(response.status, 200, await response.clone().text());
    }

    const pipeline = await payload.create({ collection: "sales-pipelines", overrideAccess: true, data: { applicationId, environment: "production", createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", name: "HTTP pipeline", orderedStageIds: ["qualification"], isActive: true } });
    await payload.create({ collection: "sales-pipeline-stages", overrideAccess: true, data: { applicationId, environment: "production", createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", pipelineId: Number(pipeline.id), stageId: "qualification", name: "Qualification", semantic: "qualification", position: 0, probabilityBasisPoints: 0, allowedTransitions: ["won", "lost"] } });
    await payload.create({ collection: "sales-pipeline-stages", overrideAccess: true, data: { applicationId, environment: "production", createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", pipelineId: Number(pipeline.id), stageId: "won", name: "Won", semantic: "won", position: 1, probabilityBasisPoints: 10_000, allowedTransitions: [] } });
    await payload.create({ collection: "sales-pipeline-stages", overrideAccess: true, data: { applicationId, environment: "production", createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", pipelineId: Number(pipeline.id), stageId: "lost", name: "Lost", semantic: "lost", position: 2, probabilityBasisPoints: 0, allowedTransitions: [] } });
    const linkerAccount = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${linker.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", name: "Read-only linked account" } });
    const linkerContact = await payload.create({ collection: "sales-contacts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${linker.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", accountId: Number(linkerAccount.id), displayName: "Read-only linked contact" } });
    const linkerLead = await postAs(linkerLogin.token, "/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Read-only linker lead", source: "referral" } }, "p13-3-linker-lead");
    assert.equal(linkerLead.status, 200, await linkerLead.clone().text());
    const linkerLeadData = (await linkerLead.json()).data;
    const linkerQualification = await postAs(linkerLogin.token, "/k-nex/action", { actionId: "sales.lead.qualify", input: { id: linkerLeadData.id, expectedRevision: 1, accountMode: "link", accountId: String(linkerAccount.id), contactMode: "link", contactId: String(linkerContact.id), opportunityName: "Read-only link opportunity", pipelineId: String(pipeline.id) } }, "p13-3-linker-qualify");
    assert.equal(linkerQualification.status, 200, await linkerQualification.clone().text());
    assert.deepEqual((await pool.query("select owner_id,team_id,account_id::text,primary_contact_id::text from sales_opportunities where id=$1", [(await linkerQualification.json()).data.opportunityId])).rows, [{ owner_id: String(linker.id), team_id: `team:${linker.id}`, account_id: String(linkerAccount.id), primary_contact_id: String(linkerContact.id) }]);
    assert.deepEqual((await pool.query("select owner_id,team_id from sales_accounts where id=$1 union all select owner_id,team_id from sales_contacts where id=$2", [linkerAccount.id, linkerContact.id])).rows, [{ owner_id: String(user.id), team_id: `team:${linker.id}` }, { owner_id: String(user.id), team_id: `team:${linker.id}` }], "Managed-scope linking never re-owns existing records.");
    const noReadAccount = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${noAccountRead.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", name: "Unreadable linked account" } });
    const noReadContact = await payload.create({ collection: "sales-contacts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${noAccountRead.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", accountId: Number(noReadAccount.id), displayName: "Readable linked contact" } });
    const noReadLead = await postAs(noAccountReadLogin.token, "/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Missing account read lead", source: "referral" } }, "p13-3-no-account-read-lead");
    assert.equal(noReadLead.status, 200, await noReadLead.clone().text());
    const noReadLeadData = (await noReadLead.json()).data;
    const noReadBefore = (await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const noReadQualification = await postAs(noAccountReadLogin.token, "/k-nex/action", { actionId: "sales.lead.qualify", input: { id: noReadLeadData.id, expectedRevision: 1, accountMode: "link", accountId: String(noReadAccount.id), contactMode: "link", contactId: String(noReadContact.id), opportunityName: "Must not exist", pipelineId: String(pipeline.id) } }, "p13-3-no-account-read-qualify");
    assert.equal(noReadQualification.status, 403, await noReadQualification.clone().text());
    assert.deepEqual((await pool.query("select status,revision from sales_leads where id=$1", [noReadLeadData.id])).rows, [{ status: "new", revision: 1 }]);
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], noReadBefore);
    const linkerCreateLead = await postAs(linkerLogin.token, "/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Denied linker create lead", source: "referral" } }, "p13-3-linker-create-lead");
    const linkerCreateLeadData = (await linkerCreateLead.json()).data;
    const linkerCreateDenied = await postAs(linkerLogin.token, "/k-nex/action", { actionId: "sales.lead.qualify", input: { id: linkerCreateLeadData.id, expectedRevision: 1, accountMode: "create", accountName: "Forbidden account", contactMode: "create", contactName: "Forbidden contact", opportunityName: "Forbidden opportunity", pipelineId: String(pipeline.id) } }, "p13-3-linker-create-denied");
    assert.equal(linkerCreateDenied.status, 403, await linkerCreateDenied.clone().text());
    assert.deepEqual((await pool.query("select status,revision from sales_leads where id=$1", [linkerCreateLeadData.id])).rows, [{ status: "new", revision: 1 }]);
    const crossScopeAccount = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(manager.id), teamId: `team:${manager.id}`, createdBy: String(manager.id), updatedBy: String(manager.id), revision: 1, audit: [], status: "active", name: "Cross-scope linked account" } });
    const crossScopeContact = await payload.create({ collection: "sales-contacts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(manager.id), teamId: `team:${manager.id}`, createdBy: String(manager.id), updatedBy: String(manager.id), revision: 1, audit: [], status: "active", accountId: Number(crossScopeAccount.id), displayName: "Cross-scope linked contact" } });
    const crossScopeBefore = (await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const crossScopeLink = await postAs(linkerLogin.token, "/k-nex/action", { actionId: "sales.lead.qualify", input: { id: linkerCreateLeadData.id, expectedRevision: 1, accountMode: "link", accountId: String(crossScopeAccount.id), contactMode: "link", contactId: String(crossScopeContact.id), opportunityName: "Cross-scope opportunity", pipelineId: String(pipeline.id) } }, "p13-3-linker-cross-scope");
    assert.equal(crossScopeLink.status, 403, await crossScopeLink.clone().text());
    assert.deepEqual((await pool.query("select status,revision from sales_leads where id=$1", [linkerCreateLeadData.id])).rows, [{ status: "new", revision: 1 }]);
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], crossScopeBefore);
    await pool.query("update k_nex_role_assignments set state='revoked' where application_id=$1 and subject_id=$2", [applicationId, String(linker.id)]);
    const revokedLink = await postAs(linkerLogin.token, "/k-nex/action", { actionId: "sales.lead.qualify", input: { id: linkerCreateLeadData.id, expectedRevision: 1, accountMode: "link", accountId: String(linkerAccount.id), contactMode: "link", contactId: String(linkerContact.id), opportunityName: "Revoked opportunity", pipelineId: String(pipeline.id) } }, "p13-3-linker-revoked");
    assert.equal(revokedLink.status, 403, await revokedLink.clone().text());
    assert.deepEqual((await pool.query("select status,revision from sales_leads where id=$1", [linkerCreateLeadData.id])).rows, [{ status: "new", revision: 1 }]);
    const representativeAccount = await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.account.create", input: { name: "Representative account" } }, "p13-3-representative-account");
    assert.equal(representativeAccount.status, 200, await representativeAccount.clone().text());
    const representativeAccountData = (await representativeAccount.json()).data;
    const representativeActivity = await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: representativeAccountData.id, type: "call", subject: "Representative follow-up", scheduledAt: "2026-09-11T10:00:00.000Z" } }, "p13-3-representative-activity");
    assert.equal(representativeActivity.status, 200, await representativeActivity.clone().text());
    assert.deepEqual((await pool.query("select owner_id,team_id,created_by from sales_activities where id=$1", [(await representativeActivity.json()).data.id])).rows, [{ owner_id: String(representative.id), team_id: `team:${representative.id}`, created_by: String(representative.id) }]);
    const linkedTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), teamId: `team:${representative.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "open", title: "Linked legacy task", relatedRecordType: "sales.account", relatedRecordId: representativeAccountData.id, archiveStatus: "active" } });
    const taskActivity = await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(linkedTask.id), type: "call", subject: "Task-parent activity", scheduledAt: "2026-09-11T11:00:00.000Z" } }, "p13-3-task-parent-activity");
    assert.equal(taskActivity.status, 200, await taskActivity.clone().text());
    const taskActivityData = (await taskActivity.json()).data;
    assert.deepEqual((await pool.query("select owner_id,team_id,related_record_type,related_record_id::text from sales_activities where id=$1", [taskActivityData.id])).rows, [{ owner_id: String(representative.id), team_id: `team:${representative.id}`, related_record_type: "sales.task", related_record_id: String(linkedTask.id) }]);
    const taskActivityToCancel = await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(linkedTask.id), type: "email", subject: "Task-parent cancellation", scheduledAt: "2026-09-11T11:30:00.000Z" } }, "p13-3-task-parent-cancel-create");
    assert.equal(taskActivityToCancel.status, 200, await taskActivityToCancel.clone().text());
    const taskActivityToCancelData = (await taskActivityToCancel.json()).data;
    const parentTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), teamId: `team:${representative.id}`, createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "open", title: "Immediate parent task", relatedRecordType: "sales.account", relatedRecordId: representativeAccountData.id, archiveStatus: "active" } });
    const childTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "open", title: "Task-linked child", relatedRecordType: "sales.task", relatedRecordId: String(parentTask.id), archiveStatus: "active" } });
    const taskToTaskActivity = await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(childTask.id), type: "call", subject: "Immediate task-parent activity", scheduledAt: "2026-09-11T11:45:00.000Z" } }, "p13-3-task-to-task-activity");
    assert.equal(taskToTaskActivity.status, 200, await taskToTaskActivity.clone().text());
    assert.deepEqual((await pool.query("select owner_id,team_id from sales_activities where id=$1", [(await taskToTaskActivity.json()).data.id])).rows, [{ owner_id: String(representative.id), team_id: `team:${representative.id}` }]);
    const teamlessParentTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "open", title: "Teamless parent task", relatedRecordType: "sales.account", relatedRecordId: representativeAccountData.id, archiveStatus: "active" } });
    const teamlessChildTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "open", title: "Teamless task child", relatedRecordType: "sales.task", relatedRecordId: String(teamlessParentTask.id), archiveStatus: "active" } });
    assert.equal((await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(teamlessChildTask.id), type: "call", subject: "Denied teamless task parent", scheduledAt: "2026-09-11T11:50:00.000Z" } }, "p13-3-task-to-teamless-task-activity")).status, 403);
    const unlinkedTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "open", title: "Unlinked task", archiveStatus: "active" } });
    assert.equal((await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(unlinkedTask.id), type: "call", subject: "Denied unlinked", scheduledAt: "2026-09-11T12:00:00.000Z" } }, "p13-3-task-unlinked-activity")).status, 403);
    const removedParent = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), teamId: `team:${representative.id}`, createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "active", name: "Removed parent" } });
    const missingParentTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "open", title: "Missing parent task", relatedRecordType: "sales.account", relatedRecordId: String(removedParent.id), archiveStatus: "active" } });
    await pool.query("delete from sales_accounts where id=$1", [removedParent.id]);
    assert.equal((await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(missingParentTask.id), type: "call", subject: "Denied missing parent", scheduledAt: "2026-09-11T13:00:00.000Z" } }, "p13-3-task-missing-parent-activity")).status, 403);
    const teamlessParent = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "active", name: "Teamless parent" } });
    const teamlessTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "open", title: "Teamless parent task", relatedRecordType: "sales.account", relatedRecordId: String(teamlessParent.id), archiveStatus: "active" } });
    assert.equal((await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(teamlessTask.id), type: "call", subject: "Denied teamless parent", scheduledAt: "2026-09-11T14:00:00.000Z" } }, "p13-3-task-teamless-parent-activity")).status, 403);
    await payload.create({ collection: "sales-notes", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), teamId: `team:${representative.id}`, createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "recorded", body: "Task direct private note", authorId: String(representative.id), occurredAt: "2026-09-11T14:30:00.000Z", relatedRecordType: "sales.task", relatedRecordId: String(linkedTask.id) } });
    await payload.create({ collection: "sales-attachment-references", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(representative.id), teamId: `team:${representative.id}`, createdBy: String(representative.id), updatedBy: String(representative.id), revision: 1, audit: [], status: "active", storageReference: "p13-3/task-direct", filename: "task-direct.txt", mediaType: "text/plain", byteSize: 1, uploaderId: String(representative.id), relatedRecordType: "sales.task", relatedRecordId: String(linkedTask.id) } });
    await pool.query("update sales_accounts set owner_id=$1,team_id=$2 where id=$3", [String(candidate.id), `team:${candidate.id}`, representativeAccountData.id]);
    assert.equal((await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(linkedTask.id), type: "email", subject: "Denied stale task parent", scheduledAt: "2026-09-11T15:00:00.000Z" } }, "p13-3-task-stale-parent-activity")).status, 403);
    assert.equal((await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.activity.complete", input: { id: taskActivityData.id, expectedRevision: 1 } }, "p13-3-task-stale-parent-complete")).status, 403);
    const taskTimelineInput = { sourceId: "sales.timeline", surface: "workspace", input: { "related-record-type": "sales.task", "related-record-id": String(linkedTask.id) }, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision"] };
    const staleTaskTimeline = await sourceAs(representativeLogin.token, taskTimelineInput);
    assert.equal(staleTaskTimeline.status, 200, await staleTaskTimeline.clone().text());
    const staleTaskTimelineText = JSON.stringify(await staleTaskTimeline.json());
    assert.equal(staleTaskTimelineText.includes("Task-parent activity"), false);
    assert.equal(staleTaskTimelineText.includes("Task direct private note"), false, "note body remains field-redacted");
    assert.equal(staleTaskTimelineText.includes('"value":"Note"'), true, "direct Task scope exposes redacted Note metadata");
    assert.equal(staleTaskTimelineText.includes("task-direct.txt"), true, "direct Task scope exposes direct attachment metadata");
    const currentTaskTimeline = await sourceAs(candidateLogin.token, taskTimelineInput);
    assert.equal(currentTaskTimeline.status, 200, await currentTaskTimeline.clone().text());
    const currentTaskTimelineText = JSON.stringify(await currentTaskTimeline.json());
    assert.equal(currentTaskTimelineText.includes("Task-parent activity"), true);
    assert.equal(currentTaskTimelineText.includes("Task-parent cancellation"), true);
    assert.equal(currentTaskTimelineText.includes('"value":"Note"'), false, "parent-only scope cannot expose direct Task notes");
    assert.equal(currentTaskTimelineText.includes("task-direct.txt"), false, "parent-only scope cannot expose direct Task attachments");
    assert.equal((await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.activity.complete", input: { id: taskActivityData.id, expectedRevision: 1 } }, "p13-3-task-current-parent-complete")).status, 200);
    assert.equal((await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.activity.cancel", input: { id: taskActivityToCancelData.id, expectedRevision: 1 } }, "p13-3-task-current-parent-cancel")).status, 200);
    const reassignedTaskActivity = await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.task", relatedRecordId: String(linkedTask.id), type: "email", subject: "Current task parent", scheduledAt: "2026-09-11T16:00:00.000Z" } }, "p13-3-task-current-parent-activity");
    assert.equal(reassignedTaskActivity.status, 200, await reassignedTaskActivity.clone().text());
    assert.deepEqual((await pool.query("select owner_id,team_id from sales_activities where id=$1", [(await reassignedTaskActivity.json()).data.id])).rows, [{ owner_id: String(candidate.id), team_id: `team:${candidate.id}` }]);
    const representativeLead = await postAs(representativeLogin.token, "/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Representative lead", source: "referral" } }, "p13-3-representative-lead");
    assert.equal(representativeLead.status, 200, await representativeLead.clone().text());
    const representativeLeadData = (await representativeLead.json()).data;
    const managerQualification = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.lead.qualify", input: { id: representativeLeadData.id, expectedRevision: 1, accountMode: "create", accountName: "Manager converted account", contactMode: "create", contactName: "Manager converted contact", opportunityName: "Manager converted opportunity", pipelineId: String(pipeline.id) } }, "p13-3-manager-qualification");
    assert.equal(managerQualification.status, 200, await managerQualification.clone().text());
    const managerQualificationData = (await managerQualification.json()).data;
    for (const [table, id] of [["sales_accounts", managerQualificationData.accountId], ["sales_contacts", managerQualificationData.contactId], ["sales_opportunities", managerQualificationData.opportunityId]]) {
      const derived = (await pool.query(`select owner_id,team_id,created_by,audit->0->>'actorId' audit_actor,audit->0->'ownershipGenesis'->>'ownerId' genesis_owner,audit->0->'ownershipGenesis'->>'teamId' genesis_team from ${table} where id=$1`, [id])).rows;
      assert.deepEqual(derived, [{ owner_id: String(representative.id), team_id: `team:${representative.id}`, created_by: String(manager.id), audit_actor: String(manager.id), genesis_owner: String(representative.id), genesis_team: `team:${representative.id}` }]);
    }
    const contact = await post("/k-nex/action", { actionId: "sales.contact.create", input: { accountId: createdData.id, displayName: "HTTP contact", email: "contact@example.test" } }, "p13-3-contact-create");
    assert.equal(contact.status, 200, await contact.clone().text());
    const contactData = (await contact.json()).data;
    assert.deepEqual((await pool.query("select owner_id,team_id from sales_contacts where id=$1", [contactData.id])).rows, [{ owner_id: String(user.id), team_id: `team:${user.id}` }]);
    const contactUpdate = await post("/k-nex/action", { actionId: "sales.contact.update", input: { id: contactData.id, expectedRevision: 1, displayName: "HTTP contact edited", emailMode: "retain", phoneMode: "set", phone: "+905550000000" } }, "p13-3-contact-update");
    assert.equal(contactUpdate.status, 200, await contactUpdate.clone().text());
    assert.deepEqual((await pool.query("select email,phone from sales_contacts where id=$1", [contactData.id])).rows, [{ email: "contact@example.test", phone: "+905550000000" }]);
    const contactClear = await post("/k-nex/action", { actionId: "sales.contact.update", input: { id: contactData.id, expectedRevision: 2, displayName: "HTTP contact edited", emailMode: "retain", phoneMode: "clear" } }, "p13-3-contact-clear");
    assert.equal(contactClear.status, 200, await contactClear.clone().text());
    assert.deepEqual((await pool.query("select email,phone from sales_contacts where id=$1", [contactData.id])).rows, [{ email: "contact@example.test", phone: null }]);
    const boundaryPhoneBody = { actionId: "sales.contact.create", input: { accountId: createdData.id, displayName: "Boundary phone contact", phone: "p".repeat(64) } };
    const boundaryPhone = await post("/k-nex/action", boundaryPhoneBody, "p13-3-contact-phone-64");
    assert.equal(boundaryPhone.status, 200, await boundaryPhone.clone().text());
    const boundaryPhoneData = (await boundaryPhone.json()).data;
    assert.equal((await pool.query("select phone from sales_contacts where id=$1", [boundaryPhoneData.id])).rows[0].phone, "p".repeat(64));
    assert.equal((await post("/k-nex/action", boundaryPhoneBody, "p13-3-contact-phone-64")).status, 200);
    const invalidPhoneBefore = (await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const invalidPhone = await post("/k-nex/action", { actionId: "sales.contact.create", input: { accountId: createdData.id, displayName: "Invalid phone contact", phone: "p".repeat(65) } }, "p13-3-contact-phone-65");
    assert.equal(invalidPhone.status, 400, await invalidPhone.clone().text());
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], invalidPhoneBefore);

    const linkCreateLead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Link account lead", source: "campaign" } }, "p13-3-link-create-lead");
    const linkCreateLeadData = (await linkCreateLead.json()).data;
    const linkCreate = await post("/k-nex/action", { actionId: "sales.lead.qualify", input: { id: linkCreateLeadData.id, expectedRevision: 1, accountMode: "link", accountId: createdData.id, contactMode: "create", contactName: "Created under linked account", opportunityName: "Link create opportunity", pipelineId: String(pipeline.id) } }, "p13-3-link-create-qualify");
    assert.equal(linkCreate.status, 200, await linkCreate.clone().text());
    const linkCreateData = (await linkCreate.json()).data;
    assert.equal(linkCreateData.accountId, createdData.id);
    assert.deepEqual((await pool.query("select account_id::text,owner_id,team_id from sales_contacts where id=$1", [linkCreateData.contactId])).rows, [{ account_id: createdData.id, owner_id: String(user.id), team_id: `team:${user.id}` }]);

    const linkLinkLead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Link lineage lead", source: "campaign" } }, "p13-3-link-link-lead");
    const linkLinkLeadData = (await linkLinkLead.json()).data;
    const linkedOwnershipBefore = (await pool.query("select owner_id,team_id,revision from sales_contacts where id=$1", [contactData.id])).rows[0];
    const linkLink = await post("/k-nex/action", { actionId: "sales.lead.qualify", input: { id: linkLinkLeadData.id, expectedRevision: 1, accountMode: "link", accountId: createdData.id, contactMode: "link", contactId: contactData.id, opportunityName: "Linked lineage opportunity", pipelineId: String(pipeline.id) } }, "p13-3-link-link-qualify");
    assert.equal(linkLink.status, 200, await linkLink.clone().text());
    const linkLinkData = (await linkLink.json()).data;
    assert.deepEqual({ accountId: linkLinkData.accountId, contactId: linkLinkData.contactId }, { accountId: createdData.id, contactId: contactData.id });
    assert.deepEqual((await pool.query("select owner_id,team_id,revision from sales_contacts where id=$1", [contactData.id])).rows[0], linkedOwnershipBefore, "Qualification never re-owns or rewrites a linked contact.");
    assert.deepEqual((await pool.query("select account_id::text,primary_contact_id::text from sales_opportunities where id=$1", [linkLinkData.opportunityId])).rows, [{ account_id: createdData.id, primary_contact_id: contactData.id }]);

    const wrongAccount = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Wrong lineage account" } }, "p13-3-wrong-lineage-account");
    const wrongAccountData = (await wrongAccount.json()).data;
    const wrongLineageLead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Wrong lineage lead", source: "campaign" } }, "p13-3-wrong-lineage-lead");
    const wrongLineageLeadData = (await wrongLineageLead.json()).data;
    const wrongLineageBefore = (await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const wrongLineage = await post("/k-nex/action", { actionId: "sales.lead.qualify", input: { id: wrongLineageLeadData.id, expectedRevision: 1, accountMode: "link", accountId: wrongAccountData.id, contactMode: "link", contactId: contactData.id, opportunityName: "Must not exist", pipelineId: String(pipeline.id) } }, "p13-3-wrong-lineage-qualify");
    assert.equal(wrongLineage.status, 403, await wrongLineage.clone().text());
    assert.deepEqual((await pool.query("select status,revision,qualified_account_id from sales_leads where id=$1", [wrongLineageLeadData.id])).rows, [{ status: "new", revision: 1, qualified_account_id: null }]);
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], wrongLineageBefore);
    assert.equal((await post("/k-nex/action", { actionId: "sales.lead.qualify", input: { id: wrongLineageLeadData.id, expectedRevision: 1, accountMode: "create", accountName: "Invalid", contactMode: "link", contactId: contactData.id, opportunityName: "Must not exist", pipelineId: String(pipeline.id) } }, "p13-3-invalid-create-link")).status, 400);

    const invalidDateBefore = (await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const invalidDate = await post("/k-nex/action", { actionId: "sales.opportunity.create", input: { name: "Invalid date opportunity", accountId: createdData.id, pipelineId: String(pipeline.id), stageId: "qualification", expectedCloseDate: "0000-01-01" } }, "p13-3-opportunity-date-year-zero");
    assert.equal(invalidDate.status, 400, await invalidDate.clone().text());
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], invalidDateBefore);
    const opportunity = await post("/k-nex/action", { actionId: "sales.opportunity.create", input: { name: "HTTP opportunity", accountId: createdData.id, pipelineId: String(pipeline.id), stageId: "qualification" } }, "p13-3-opportunity-create");
    assert.equal(opportunity.status, 200, await opportunity.clone().text());
    const opportunityData = (await opportunity.json()).data;
    assert.deepEqual((await pool.query("select owner_id,team_id from sales_opportunities where id=$1", [opportunityData.id])).rows, [{ owner_id: String(user.id), team_id: `team:${user.id}` }]);
    const richOpportunityBody = { actionId: "sales.opportunity.create", input: { name: "Priced opportunity", accountId: createdData.id, primaryContactId: contactData.id, pipelineId: String(pipeline.id), stageId: "qualification", amount: { kind: "money", value: "12", currency: "USD", scale: 2 }, expectedCloseDate: "2026-09-30" } };
    const richOpportunity = await post("/k-nex/action", richOpportunityBody, "p13-3-opportunity-rich-create");
    assert.equal(richOpportunity.status, 200, await richOpportunity.clone().text());
    const richOpportunityData = (await richOpportunity.json()).data;
    assert.deepEqual((await pool.query("select primary_contact_id::text,amount::text,currency,expected_close_date::text from sales_opportunities where id=$1", [richOpportunityData.id])).rows, [{ primary_contact_id: contactData.id, amount: "12.00", currency: "USD", expected_close_date: "2026-09-30" }]);
    const richReplay = await post("/k-nex/action", richOpportunityBody, "p13-3-opportunity-rich-create");
    assert.equal(richReplay.status, 200); assert.deepEqual((await richReplay.json()).data, richOpportunityData);
    const clearOpportunity = await post("/k-nex/action", { actionId: "sales.opportunity.update", input: { id: richOpportunityData.id, expectedRevision: 1, name: "Priced opportunity retained", primaryContactMode: "clear", amountMode: "clear", expectedCloseDateMode: "clear" } }, "p13-3-opportunity-rich-clear");
    assert.equal(clearOpportunity.status, 200, await clearOpportunity.clone().text());
    assert.deepEqual((await pool.query("select primary_contact_id,amount,currency,expected_close_date from sales_opportunities where id=$1", [richOpportunityData.id])).rows, [{ primary_contact_id: null, amount: null, currency: null, expected_close_date: null }]);
    const staleOpportunity = await post("/k-nex/action", { actionId: "sales.opportunity.update", input: { id: opportunityData.id, expectedRevision: 2, name: "stale", primaryContactMode: "retain", amountMode: "retain", expectedCloseDateMode: "retain" } }, "p13-3-opportunity-stale");
    assert.equal(staleOpportunity.status, 409);
    const missingLossReason = await post("/k-nex/action", { actionId: "sales.opportunity.close", input: { id: opportunityData.id, expectedRevision: 1, expectedStage: "qualification", stage: "lost" } }, "p13-3-opportunity-missing-loss");
    assert.equal(missingLossReason.status, 403);
    assert.deepEqual((await pool.query("select revision, stage_id from sales_opportunities where id=$1", [opportunityData.id])).rows, [{ revision: 1, stage_id: "qualification" }]);
    const lostOpportunity = await post("/k-nex/action", { actionId: "sales.opportunity.close", input: { id: opportunityData.id, expectedRevision: 1, expectedStage: "qualification", stage: "lost", lossReason: "budget" } }, "p13-3-opportunity-lost");
    assert.equal(lostOpportunity.status, 200, await lostOpportunity.clone().text());

    const terminalParent = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Terminal parent" } }, "p13-3-terminal-parent");
    const terminalParentData = (await terminalParent.json()).data;
    assert.equal((await post("/k-nex/action", { actionId: "sales.account.archive", input: { id: terminalParentData.id, expectedRevision: 1 } }, "p13-3-terminal-parent-archive")).status, 200);
    const mergedParent = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Merged parent" } }, "p13-3-merged-parent");
    const mergedParentData = (await mergedParent.json()).data;
    await pool.query("update sales_accounts set status='merged',merged_into_id=$1,merge_lineage='{\"kind\":\"dedupe\"}'::jsonb where id=$2", [createdData.id, mergedParentData.id]);
    const terminalCounts = (await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    for (const [parentId, suffix] of [[terminalParentData.id, "archived"], [mergedParentData.id, "merged"]]) {
      const contactDenied = await post("/k-nex/action", { actionId: "sales.contact.create", input: { accountId: parentId, displayName: `Denied ${suffix} contact` } }, `p13-3-${suffix}-parent-contact`);
      assert.equal(contactDenied.status, 409, await contactDenied.clone().text());
      const opportunityDenied = await post("/k-nex/action", { actionId: "sales.opportunity.create", input: { name: `Denied ${suffix} opportunity`, accountId: parentId, pipelineId: String(pipeline.id), stageId: "qualification" } }, `p13-3-${suffix}-parent-opportunity`);
      assert.equal(opportunityDenied.status, 409, await opportunityDenied.clone().text());
    }
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_contacts) contacts,(select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], terminalCounts);

    const archiveLead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Archive integrity lead", source: "audit" } }, "p13-3-archive-lead-create");
    const archiveLeadData = (await archiveLead.json()).data;
    assert.equal((await post("/k-nex/action", { actionId: "sales.lead.archive", input: { id: archiveLeadData.id, expectedRevision: 1 } }, "p13-3-archive-lead")).status, 200);
    const archivedLeadBefore = (await pool.query("select status,archive_status,revision,audit from sales_leads where id=$1", [archiveLeadData.id])).rows[0];
    const archivedLeadCounts = (await pool.query("select (select count(*)::int from sales_accounts) accounts,(select count(*)::int from sales_contacts) contacts,(select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const archivedQualification = await post("/k-nex/action", { actionId: "sales.lead.qualify", input: { id: archiveLeadData.id, expectedRevision: 2, accountMode: "create", accountName: "Archived derivative", contactMode: "create", contactName: "Archived derivative", opportunityName: "Archived derivative", pipelineId: String(pipeline.id) } }, "p13-3-archived-lead-qualify");
    assert.equal(archivedQualification.status, 409, await archivedQualification.clone().text());
    assert.deepEqual((await pool.query("select status,archive_status,revision,audit from sales_leads where id=$1", [archiveLeadData.id])).rows[0], archivedLeadBefore);
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_accounts) accounts,(select count(*)::int from sales_contacts) contacts,(select count(*)::int from sales_opportunities) opportunities,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], archivedLeadCounts);
    const archiveOpportunity = await post("/k-nex/action", { actionId: "sales.opportunity.create", input: { name: "Archive integrity opportunity", accountId: createdData.id, pipelineId: String(pipeline.id), stageId: "qualification" } }, "p13-3-archive-opportunity-create");
    const archiveOpportunityData = (await archiveOpportunity.json()).data;
    assert.equal((await post("/k-nex/action", { actionId: "sales.opportunity.archive", input: { id: archiveOpportunityData.id, expectedRevision: 1 } }, "p13-3-archive-opportunity")).status, 200);
    const archivedOpportunityBeforeStage = (await pool.query("select revision,stage_id,archive_status,audit from sales_opportunities where id=$1", [archiveOpportunityData.id])).rows[0];
    const archivedOpportunityStageCounts = (await pool.query("select (select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const archivedOpportunityStage = await post("/k-nex/action", { actionId: "sales.opportunity.stage.update", input: { id: archiveOpportunityData.id, expectedStage: "qualification", expectedRevision: 2, stage: "discovery" } }, "p13-3-archived-opportunity-stage");
    assert.equal(archivedOpportunityStage.status, 409, await archivedOpportunityStage.clone().text());
    assert.deepEqual((await pool.query("select revision,stage_id,archive_status,audit from sales_opportunities where id=$1", [archiveOpportunityData.id])).rows[0], archivedOpportunityBeforeStage);
    assert.deepEqual((await pool.query("select (select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], archivedOpportunityStageCounts);
    await pool.query("update sales_leads set archive_status='active' where id=$1", [archiveLeadData.id]);
    await pool.query("update sales_opportunities set archive_status='active' where id=$1", [archiveOpportunityData.id]);
    const integrityCounts = (await pool.query("select (select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const tamperedLeadUpdate = await post("/k-nex/action", { actionId: "sales.lead.update", input: { id: archiveLeadData.id, expectedRevision: 2, displayName: "Must not update", source: "audit", emailMode: "retain", phoneMode: "retain" } }, "p13-3-tampered-lead-update");
    assert.equal(tamperedLeadUpdate.status, 409, await tamperedLeadUpdate.clone().text());
    const tamperedLeadOwnership = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.lead", id: archiveLeadData.id, expectedRevision: 2, ownerId: String(representative.id), teamId: `team:${representative.id}` } }, "p13-3-tampered-lead-owner");
    assert.equal(tamperedLeadOwnership.status, 409, await tamperedLeadOwnership.clone().text());
    const tamperedOpportunityUpdate = await post("/k-nex/action", { actionId: "sales.opportunity.update", input: { id: archiveOpportunityData.id, expectedRevision: 2, name: "Must not update", primaryContactMode: "retain", amountMode: "retain", expectedCloseDateMode: "retain" } }, "p13-3-tampered-opportunity-update");
    assert.equal(tamperedOpportunityUpdate.status, 409, await tamperedOpportunityUpdate.clone().text());
    const tamperedOpportunityOwnership = await postAs(managerLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.opportunity", id: archiveOpportunityData.id, expectedRevision: 2, ownerId: String(user.id), teamId: `team:${user.id}` } }, "p13-3-tampered-opportunity-owner");
    assert.equal(tamperedOpportunityOwnership.status, 409, await tamperedOpportunityOwnership.clone().text());
    assert.deepEqual((await pool.query("select revision,archive_status,audit->-1->>'actionId' action_id from sales_leads where id=$1", [archiveLeadData.id])).rows, [{ revision: 2, archive_status: "active", action_id: "sales.lead.archive" }]);
    assert.deepEqual((await pool.query("select revision,archive_status,audit->-1->>'actionId' action_id from sales_opportunities where id=$1", [archiveOpportunityData.id])).rows, [{ revision: 2, archive_status: "active", action_id: "sales.opportunity.archive" }]);
    assert.deepEqual((await pool.query("select (select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], integrityCounts);

    const lead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "HTTP lead", source: "campaign", email: "lead@example.test" } }, "p13-3-lead-create");
    assert.equal(lead.status, 200, await lead.clone().text());
    const leadData = (await lead.json()).data;
    const leadUpdate = await post("/k-nex/action", { actionId: "sales.lead.update", input: { id: leadData.id, expectedRevision: 1, displayName: "HTTP lead working", source: "campaign", emailMode: "retain", phoneMode: "retain" } }, "p13-3-lead-update");
    assert.equal(leadUpdate.status, 200, await leadUpdate.clone().text());
    const qualifyBody = { actionId: "sales.lead.qualify", input: { id: leadData.id, expectedRevision: 2, accountMode: "create", accountName: "Converted account", contactMode: "create", contactName: "Converted contact", opportunityName: "Converted opportunity", pipelineId: String(pipeline.id) } };
    const qualifyOutboxBefore = Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.lead.qualify'")).rows[0].count);
    const qualified = await post("/k-nex/action", qualifyBody, "p13-3-lead-qualify");
    assert.equal(qualified.status, 200, await qualified.clone().text());
    const qualifiedData = (await qualified.json()).data;
    const qualifiedOwnership = await Promise.all([
      pool.query("select owner_id,team_id from sales_accounts where id=$1", [qualifiedData.accountId]),
      pool.query("select owner_id,team_id from sales_contacts where id=$1", [qualifiedData.contactId]),
      pool.query("select owner_id,team_id from sales_opportunities where id=$1", [qualifiedData.opportunityId])
    ]);
    assert.equal(qualifiedOwnership.every(({ rows }) => rows.length === 1 && rows[0].owner_id === String(user.id) && rows[0].team_id === `team:${user.id}`), true);
    const qualifyReplay = await post("/k-nex/action", qualifyBody, "p13-3-lead-qualify");
    assert.equal(qualifyReplay.status, 200); assert.deepEqual((await qualifyReplay.json()).data, qualifiedData);
    const qualifyConflict = await post("/k-nex/action", { ...qualifyBody, input: { ...qualifyBody.input, accountName: "duplicate" } }, "p13-3-lead-qualify");
    assert.equal(qualifyConflict.status, 409);
    assert.deepEqual((await pool.query("select count(*)::int count from sales_accounts where name='Converted account'" )).rows, [{ count: 1 }]);
    assert.deepEqual((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.lead.qualify'" )).rows, [{ count: qualifyOutboxBefore + 4 }]);
    const raceLead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Concurrent qualify", source: "campaign" } }, "p13-3-lead-race-create");
    const raceLeadData = (await raceLead.json()).data;
    const raceBody = { actionId: "sales.lead.qualify", input: { id: raceLeadData.id, expectedRevision: 1, accountMode: "create", accountName: "Concurrent converted account", contactMode: "create", contactName: "Concurrent converted contact", opportunityName: "Concurrent converted opportunity", pipelineId: String(pipeline.id) } };
    const race = await Promise.all([post("/k-nex/action", raceBody, "p13-3-lead-race-a"), post("/k-nex/action", raceBody, "p13-3-lead-race-b")]);
    assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
    assert.deepEqual((await pool.query("select count(*)::int count from sales_accounts where name='Concurrent converted account'" )).rows, [{ count: 1 }]);

    const disqualifiedLead = await post("/k-nex/action", { actionId: "sales.lead.create", input: { displayName: "Disqualify lead", source: "campaign" } }, "p13-3-lead-disqualify-create");
    const disqualifiedLeadData = (await disqualifiedLead.json()).data;
    const disqualified = await post("/k-nex/action", { actionId: "sales.lead.disqualify", input: { id: disqualifiedLeadData.id, expectedRevision: 1 } }, "p13-3-lead-disqualify");
    assert.equal(disqualified.status, 200, await disqualified.clone().text());

    const activity = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "call", subject: "HTTP interaction", scheduledAt: "2026-09-07T10:00:00.000Z" } }, "p13-3-activity-create");
    assert.equal(activity.status, 200, await activity.clone().text());
    assert.deepEqual((await pool.query("select count(*)::int count from sales_activities where related_record_type='sales.account' and related_record_id=$1", [createdData.id])).rows, [{ count: 1 }]);
    const activityData = (await activity.clone().json()).data;
    const completeActivity = await post("/k-nex/action", { actionId: "sales.activity.complete", input: { id: activityData.id, expectedRevision: 1 } }, "p13-3-activity-complete");
    assert.equal(completeActivity.status, 200, await completeActivity.clone().text());
    const cancellingActivity = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "email", subject: "Cancel interaction", scheduledAt: "2026-09-08T10:00:00.000Z" } }, "p13-3-activity-cancel-create");
    const cancellingActivityData = (await cancellingActivity.json()).data;
    const cancelActivity = await post("/k-nex/action", { actionId: "sales.activity.cancel", input: { id: cancellingActivityData.id, expectedRevision: 1 } }, "p13-3-activity-cancel");
    assert.equal(cancelActivity.status, 200, await cancelActivity.clone().text());
    const note = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, body: "private HTTP note" } }, "p13-3-note-create");
    assert.equal(note.status, 200, await note.clone().text());
    const noteData = (await note.clone().json()).data;
    const correction = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, body: "corrected private HTTP note", replacesNoteId: noteData.id } }, "p13-3-note-correction");
    assert.equal(correction.status, 200, await correction.clone().text());
    const correctionData = (await correction.json()).data;
    assert.deepEqual((await pool.query("select replaces_note_id::text from sales_notes where id=$1", [correctionData.id])).rows, [{ replaces_note_id: noteData.id }]);
    assert.deepEqual((await pool.query("select status,revision,body from sales_notes where id=$1", [noteData.id])).rows, [{ status: "recorded", revision: 1, body: "private HTTP note" }]);
    const otherNoteAccount = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Other note account" } }, "p13-3-note-other-account");
    const otherNoteAccountData = (await otherNoteAccount.json()).data;
    const correctionBefore = (await pool.query("select (select count(*)::int from sales_notes) notes,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0];
    const crossParentCorrection = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: otherNoteAccountData.id, body: "must not persist", replacesNoteId: noteData.id } }, "p13-3-note-cross-parent");
    assert.equal(crossParentCorrection.status, 403, await crossParentCorrection.clone().text());
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_notes) notes,(select count(*)::int from k_nex_outbox) outbox_count,(select count(*)::int from sales_action_idempotency) idempotency_count")).rows[0], correctionBefore);
    const transferableNote = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: otherNoteAccountData.id, body: "pre-transfer note" } }, "p13-3-note-before-transfer");
    const transferableNoteData = (await transferableNote.json()).data;
    assert.equal((await postAs(adminLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: otherNoteAccountData.id, expectedRevision: 1, ownerId: String(candidate.id), teamId: `team:${candidate.id}` } }, "p13-3-note-parent-transfer")).status, 200);
    assert.equal((await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: otherNoteAccountData.id, body: "old owner denied", replacesNoteId: transferableNoteData.id } }, "p13-3-note-old-owner-after-transfer")).status, 403);
    const transferredCorrection = await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: otherNoteAccountData.id, body: "new owner correction", replacesNoteId: transferableNoteData.id } }, "p13-3-note-new-owner-after-transfer");
    assert.equal(transferredCorrection.status, 200, await transferredCorrection.clone().text());
    assert.deepEqual((await pool.query("select body,replaces_note_id::text from sales_notes where id in ($1,$2) order by id", [transferableNoteData.id, (await transferredCorrection.json()).data.id])).rows, [{ body: "pre-transfer note", replaces_note_id: null }, { body: "new owner correction", replaces_note_id: transferableNoteData.id }]);
    const longNoteBody = `${"n".repeat(512)}SECRET_TAIL${"n".repeat(10_000 - 523)}`;
    const longNote = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, body: longNoteBody } }, "p13-3-note-long");
    assert.equal(longNote.status, 200, await longNote.clone().text());
    const longNoteData = (await longNote.json()).data;
    const oversizedNote = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, body: "n".repeat(10_001) } }, "p13-3-note-oversized");
    assert.equal(oversizedNote.status, 400, await oversizedNote.clone().text());
    const noteBoundaryTimeline = async (size = 25) => sourceAs(login.token, { sourceId: "sales.timeline", surface: "workspace", input: { "related-record-type": "sales.account", "related-record-id": createdData.id }, query: { page: { number: 1, size }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision", "body"] });
    const noteBoundary = await noteBoundaryTimeline();
    assert.equal(noteBoundary.status, 200, await noteBoundary.clone().text());
    const noteBoundaryBody = await noteBoundary.json();
    assert.equal(noteBoundaryBody.data.rows.find(({ key }) => key === `note:${longNoteData.id}`).values.body.value, "n".repeat(512));
    assert.equal(JSON.stringify(noteBoundaryBody).includes("SECRET_TAIL"), false);
    const noteConstraint = (await pool.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='sales_notes'::regclass and conname='sales_notes_check'")).rows[0].definition;
    await pool.query("alter table sales_notes drop constraint sales_notes_check");
    await pool.query("update sales_notes set body='' where id=$1", [longNoteData.id]);
    const corruptNoteTimeline = await noteBoundaryTimeline(24);
    assert.equal(corruptNoteTimeline.status, 500, await corruptNoteTimeline.clone().text());
    assert.equal((await corruptNoteTimeline.text()).includes("n".repeat(257)), false);
    await pool.query("update sales_notes set body=$1 where id=$2", [longNoteBody, longNoteData.id]);
    await pool.query(`alter table sales_notes add constraint sales_notes_check ${noteConstraint}`);
    await pool.query("update sales_activities set subject='' where id=$1", [activityData.id]);
    const corruptActivityTimeline = await noteBoundaryTimeline(23);
    assert.equal(corruptActivityTimeline.status, 500, await corruptActivityTimeline.clone().text());
    assert.equal((await corruptActivityTimeline.text()).includes("HTTP interaction"), false);
    await pool.query("update sales_activities set subject='HTTP interaction' where id=$1", [activityData.id]);
    const attachmentCountBeforeRejections = Number((await pool.query("select count(*)::int count from sales_attachment_references")).rows[0].count);
    const missingUpload = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/missing", filename: "missing.txt", mediaType: "text/plain", byteSize: 1 } }, "p13-3-attachment-missing");
    assert.equal(missingUpload.status, 403, await missingUpload.clone().text());
    await pool.query("insert into k_nex_sales_attachment_upload_admissions values ($1,$2,'production','foreign-actor','foreign.txt','text/plain',7,'ready',1)", ["p13-3/foreign", applicationId]);
    const foreignUpload = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/foreign", filename: "foreign.txt", mediaType: "text/plain", byteSize: 7 } }, "p13-3-attachment-foreign");
    assert.equal(foreignUpload.status, 403, await foreignUpload.clone().text());
    await pool.query("insert into k_nex_sales_attachment_upload_admissions values ($1,$2,'production',$3,'proof.txt','text/plain',3,'ready',1)", ["p13-3/object", applicationId, String(user.id)]);
    const mismatchedUpload = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/object", filename: "forged.txt", mediaType: "text/plain", byteSize: 3 } }, "p13-3-attachment-mismatch");
    assert.equal(mismatchedUpload.status, 403, await mismatchedUpload.clone().text());
    assert.equal(Number((await pool.query("select count(*)::int count from sales_attachment_references")).rows[0].count), attachmentCountBeforeRejections);
    const attachment = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/object", filename: "proof.txt", mediaType: "text/plain", byteSize: 3 } }, "p13-3-attachment-link");
    assert.equal(attachment.status, 200, await attachment.clone().text());
    const attachmentData = (await attachment.json()).data;
    const boundaryMediaType = "m".repeat(128);
    await pool.query("insert into k_nex_sales_attachment_upload_admissions values ($1,$2,'production',$3,'boundary.bin',$4,12,'ready',1)", ["p13-3/media-128", applicationId, String(user.id), boundaryMediaType]);
    const boundaryAttachmentBody = { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/media-128", filename: "boundary.bin", mediaType: boundaryMediaType, byteSize: 12 } };
    const boundaryAttachment = await post("/k-nex/action", boundaryAttachmentBody, "p13-3-attachment-media-128");
    assert.equal(boundaryAttachment.status, 200, await boundaryAttachment.clone().text());
    const boundaryAttachmentData = (await boundaryAttachment.json()).data;
    const boundaryReplay = await post("/k-nex/action", boundaryAttachmentBody, "p13-3-attachment-media-128");
    assert.equal(boundaryReplay.status, 200, await boundaryReplay.clone().text());
    assert.deepEqual((await boundaryReplay.json()).data, boundaryAttachmentData);
    assert.deepEqual((await pool.query("select media_type from sales_attachment_references where id=$1", [boundaryAttachmentData.id])).rows, [{ media_type: boundaryMediaType }]);
    await pool.query("insert into k_nex_sales_attachment_upload_admissions values ($1,$2,'production',$3,'too-long.bin',$4,13,'ready',1)", ["p13-3/media-129", applicationId, String(user.id), "m".repeat(129)]);
    const mediaBoundaryBefore = (await pool.query("select (select count(*)::int from sales_attachment_references) rows,(select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_attachment_references) audit_entries,(select count(*)::int from k_nex_outbox where payload->>'actionId'='sales.attachment.link') outbox_count,(select count(*)::int from sales_action_idempotency where action_id='sales.attachment.link') idempotency_count")).rows[0];
    const tooLongMedia = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/media-129", filename: "too-long.bin", mediaType: "m".repeat(129), byteSize: 13 } }, "p13-3-attachment-media-129");
    assert.equal(tooLongMedia.status, 403, await tooLongMedia.clone().text());
    assert.deepEqual((await pool.query("select (select count(*)::int from sales_attachment_references) rows,(select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_attachment_references) audit_entries,(select count(*)::int from k_nex_outbox where payload->>'actionId'='sales.attachment.link') outbox_count,(select count(*)::int from sales_action_idempotency where action_id='sales.attachment.link') idempotency_count")).rows[0], mediaBoundaryBefore);
    await pool.query("update sales_attachment_references set filename='' where id=$1", [attachmentData.id]);
    const corruptAttachmentTimeline = await noteBoundaryTimeline(22);
    assert.equal(corruptAttachmentTimeline.status, 500, await corruptAttachmentTimeline.clone().text());
    assert.equal((await corruptAttachmentTimeline.text()).includes("proof.txt"), false);
    await pool.query("update sales_attachment_references set filename='proof.txt' where id=$1", [attachmentData.id]);
    const corruptibleTask = await payload.create({ collection: "sales-tasks", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${user.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [{ actionId: "sales.task.create", resourceId: "1", applicationId, environment: "production", fromState: "absent", toState: "open", occurredAt: "2026-09-06T00:00:00.000Z", actorId: String(user.id), revision: 1, idempotencyKey: "corrupt-task-create" }], status: "open", title: "Timeline task", relatedRecordType: "sales.account", relatedRecordId: createdData.id, archiveStatus: "active" } });
    await pool.query("update sales_tasks set title='' where id=$1", [corruptibleTask.id]);
    const corruptTaskTimeline = await noteBoundaryTimeline(21);
    assert.equal(corruptTaskTimeline.status, 500, await corruptTaskTimeline.clone().text());
    assert.equal((await corruptTaskTimeline.text()).includes("Timeline task"), false);
    await pool.query("update sales_tasks set title='Timeline task' where id=$1", [corruptibleTask.id]);
    const removeAttachment = await post("/k-nex/action", { actionId: "sales.attachment.remove", input: { id: attachmentData.id, expectedRevision: 1 } }, "p13-3-attachment-remove");
    assert.equal(removeAttachment.status, 200, await removeAttachment.clone().text());
    const parentAccount = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Reassigned attachment parent" } }, "p13-3-attachment-parent");
    assert.equal(parentAccount.status, 200, await parentAccount.clone().text());
    const parentAccountData = (await parentAccount.json()).data;
    await pool.query("insert into k_nex_sales_attachment_upload_admissions values ($1,$2,'production',$3,'reassigned.txt','text/plain',11,'ready',1)", ["p13-3/reassigned", applicationId, String(user.id)]);
    const reassignedAttachment = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: parentAccountData.id, storageReference: "p13-3/reassigned", filename: "reassigned.txt", mediaType: "text/plain", byteSize: 11 } }, "p13-3-attachment-reassigned-link");
    assert.equal(reassignedAttachment.status, 200, await reassignedAttachment.clone().text());
    const reassignedAttachmentData = (await reassignedAttachment.json()).data;
    const reassignedActivityOne = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: parentAccountData.id, type: "call", subject: "Reassigned activity complete", scheduledAt: "2026-09-11T10:00:00.000Z" } }, "p13-3-reassigned-activity-one");
    const reassignedActivityOneData = (await reassignedActivityOne.json()).data;
    const reassignedActivityTwo = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: parentAccountData.id, type: "email", subject: "Reassigned activity cancel", scheduledAt: "2026-09-12T10:00:00.000Z" } }, "p13-3-reassigned-activity-two");
    const reassignedActivityTwoData = (await reassignedActivityTwo.json()).data;
    const reassignedNote = await post("/k-nex/action", { actionId: "sales.note.create", input: { relatedRecordType: "sales.account", relatedRecordId: parentAccountData.id, body: "Reassigned note" } }, "p13-3-reassigned-note");
    const reassignedNoteData = (await reassignedNote.json()).data;
    const reassignParent = await postAs(adminLogin.token, "/k-nex/action", { actionId: "sales.ownership.assign", input: { recordType: "sales.account", id: parentAccountData.id, expectedRevision: 1, ownerId: String(candidate.id), teamId: `team:${candidate.id}` } }, "p13-3-attachment-parent-reassign");
    assert.equal(reassignParent.status, 200, await reassignParent.clone().text());
    const oldOwnerRemove = await post("/k-nex/action", { actionId: "sales.attachment.remove", input: { id: reassignedAttachmentData.id, expectedRevision: 1 } }, "p13-3-attachment-old-owner-remove");
    assert.equal(oldOwnerRemove.status, 403, await oldOwnerRemove.clone().text());
    const oldOwnerComplete = await post("/k-nex/action", { actionId: "sales.activity.complete", input: { id: reassignedActivityOneData.id, expectedRevision: 1 } }, "p13-3-activity-old-owner-complete");
    assert.equal(oldOwnerComplete.status, 403, await oldOwnerComplete.clone().text());
    const reassignedTimelineInput = { "related-record-type": "sales.account", "related-record-id": parentAccountData.id };
    const oldOwnerTimeline = await sourceAs(login.token, { sourceId: "sales.timeline", surface: "workspace", input: reassignedTimelineInput, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision"] });
    assert.equal(oldOwnerTimeline.status, 200, await oldOwnerTimeline.clone().text());
    assert.deepEqual((await oldOwnerTimeline.json()).data.rows, []);
    const newOwnerTimeline = await sourceAs(candidateLogin.token, { sourceId: "sales.timeline", surface: "workspace", input: reassignedTimelineInput, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision"] });
    assert.equal(newOwnerTimeline.status, 200, await newOwnerTimeline.clone().text());
    const newOwnerTimelineKeys = (await newOwnerTimeline.json()).data.rows.map(({ key }) => key);
    assert.equal(newOwnerTimelineKeys.includes(`attachment:${reassignedAttachmentData.id}`), true);
    assert.equal(newOwnerTimelineKeys.includes(`activity:${reassignedActivityOneData.id}`), true);
    assert.equal(newOwnerTimelineKeys.includes(`activity:${reassignedActivityTwoData.id}`), true);
    assert.equal(newOwnerTimelineKeys.includes(`note:${reassignedNoteData.id}`), true);
    const newOwnerComplete = await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.activity.complete", input: { id: reassignedActivityOneData.id, expectedRevision: 1 } }, "p13-3-activity-new-owner-complete");
    assert.equal(newOwnerComplete.status, 200, await newOwnerComplete.clone().text());
    const newOwnerCancel = await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.activity.cancel", input: { id: reassignedActivityTwoData.id, expectedRevision: 1 } }, "p13-3-activity-new-owner-cancel");
    assert.equal(newOwnerCancel.status, 200, await newOwnerCancel.clone().text());
    const newOwnerRemove = await postAs(candidateLogin.token, "/k-nex/action", { actionId: "sales.attachment.remove", input: { id: reassignedAttachmentData.id, expectedRevision: 1 } }, "p13-3-attachment-new-owner-remove");
    assert.equal(newOwnerRemove.status, 200, await newOwnerRemove.clone().text());
    const foreignEnvironmentAccount = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "staging", ownerId: String(user.id), teamId: `team:${user.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", name: "Foreign environment parent" } });
    const foreignEnvironmentAttachment = await payload.create({ collection: "sales-attachment-references", overrideAccess: true, data: { applicationId, environment: "staging", ownerId: String(user.id), teamId: `team:${user.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", storageReference: "p13-3/foreign-environment", filename: "foreign-environment.txt", mediaType: "text/plain", byteSize: 1, uploaderId: String(user.id), relatedRecordType: "sales.account", relatedRecordId: String(foreignEnvironmentAccount.id) } });
    const foreignEnvironmentRemove = await post("/k-nex/action", { actionId: "sales.attachment.remove", input: { id: String(foreignEnvironmentAttachment.id), expectedRevision: 1 } }, "p13-3-attachment-foreign-environment-remove");
    assert.equal(foreignEnvironmentRemove.status, 403, await foreignEnvironmentRemove.clone().text());
    const foreignEnvironmentActivity = await payload.create({ collection: "sales-activities", overrideAccess: true, data: { applicationId, environment: "staging", ownerId: String(user.id), teamId: `team:${user.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "scheduled", type: "call", subject: "Foreign environment activity", actorId: String(user.id), scheduledAt: "2026-09-13T10:00:00.000Z", relatedRecordType: "sales.account", relatedRecordId: String(foreignEnvironmentAccount.id) } });
    const foreignEnvironmentComplete = await post("/k-nex/action", { actionId: "sales.activity.complete", input: { id: String(foreignEnvironmentActivity.id), expectedRevision: 1 } }, "p13-3-activity-foreign-environment-complete");
    assert.equal(foreignEnvironmentComplete.status, 403, await foreignEnvironmentComplete.clone().text());
    const foreign = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: "foreign-owner", createdBy: "foreign-owner", updatedBy: "foreign-owner", revision: 1, audit: [], status: "active", name: "Foreign account" } });
    const foreignContact = await post("/k-nex/action", { actionId: "sales.contact.create", input: { accountId: String(foreign.id), displayName: "forged contact" } }, "p13-3-foreign-contact");
    assert.equal(foreignContact.status, 403, await foreignContact.clone().text());
    const foreignOpportunity = await post("/k-nex/action", { actionId: "sales.opportunity.create", input: { name: "forged opportunity", accountId: String(foreign.id), pipelineId: String(pipeline.id), stageId: "qualification" } }, "p13-3-foreign-opportunity");
    assert.equal(foreignOpportunity.status, 403, await foreignOpportunity.clone().text());
    const foreignActivity = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: String(foreign.id), type: "call", subject: "forged target", scheduledAt: "2026-09-07T10:00:00.000Z" } }, "p13-3-foreign-target");
    assert.equal(foreignActivity.status, 403, await foreignActivity.clone().text());
    const forbidden = await post("/k-nex/action", { actionId: "sales.account.update", input: { id: createdData.id, expectedRevision: 1, name: "forged", ownerId: "other" } }, "p13-3-forged-input");
    assert.equal(forbidden.status, 400);
    const source = await post("/k-nex/data-source-query", { sourceId: "sales.account.detail", surface: "workspace", input: { id: createdData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["name", "owner-id", "revision", "unknown-field"] }, "p13-3-source-field");
    assert.equal(source.status, 400);
    const viewerContact = await sourceAs(viewerLogin.token, { sourceId: "sales.contact.detail", surface: "workspace", input: { id: contactData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["display-name", "owner-id", "account-id", "status", "revision"] });
    assert.equal(viewerContact.status, 200, await viewerContact.clone().text());
    assert.equal((await viewerContact.text()).includes("contact@example.test"), false);
    const protectedViewerContact = await sourceAs(viewerLogin.token, { sourceId: "sales.contact.detail", surface: "workspace", input: { id: contactData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["display-name", "owner-id", "account-id", "status", "revision", "email"] });
    assert.equal(protectedViewerContact.status, 200, await protectedViewerContact.clone().text());
    const protectedViewerContactBody = await protectedViewerContact.json();
    assert.equal(JSON.stringify(protectedViewerContactBody).includes("contact@example.test"), false);
    assert.equal(protectedViewerContactBody.data.fields.includes("email"), false);
    const ownerAccount = await sourceAs(login.token, { sourceId: "sales.account.detail", surface: "workspace", input: { id: createdData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["name", "owner-id", "team-id", "status", "revision"] });
    assert.equal(ownerAccount.status, 200, await ownerAccount.clone().text());
    const managerContact = await sourceAs(managerLogin.token, { sourceId: "sales.contact.detail", surface: "workspace", input: { id: contactData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["display-name", "owner-id", "account-id", "email", "phone", "status", "revision"] });
    assert.equal(managerContact.status, 200, await managerContact.clone().text());
    assert.equal((await managerContact.text()).includes("contact@example.test"), true);
    const managerLead = await sourceAs(managerLogin.token, { sourceId: "sales.lead.detail", surface: "workspace", input: { id: leadData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["display-name", "source", "owner-id", "team-id", "archive-status", "email", "status", "revision"] });
    assert.equal(managerLead.status, 200, await managerLead.clone().text());
    await pool.query("update sales_opportunities set amount='10.00', currency='USD' where id=$1", [opportunityData.id]);
    const managerOpportunity = await sourceAs(managerLogin.token, { sourceId: "sales.opportunity.detail", surface: "workspace", input: { id: opportunityData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["name", "owner-id", "account-id", "pipeline-id", "amount", "stage-id", "archive-status", "revision"] });
    assert.equal(managerOpportunity.status, 200, await managerOpportunity.clone().text());
    assert.equal((await managerOpportunity.json()).data.fields.includes("amount"), true);
    const viewerAmount = await sourceAs(viewerLogin.token, { sourceId: "sales.opportunity.detail", surface: "workspace", input: { id: opportunityData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["name", "owner-id", "account-id", "pipeline-id", "amount", "stage-id", "archive-status", "revision"] });
    assert.equal(viewerAmount.status, 200, await viewerAmount.clone().text());
    const viewerAmountBody = await viewerAmount.json();
    assert.equal(JSON.stringify(viewerAmountBody).includes("10.00"), false);
    assert.equal(viewerAmountBody.data.fields.includes("amount"), false);
    const timelineInput = { "related-record-type": "sales.account", "related-record-id": createdData.id };
    const managerTimeline = await sourceAs(managerLogin.token, { sourceId: "sales.timeline", surface: "workspace", input: timelineInput, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision", "body"] });
    assert.equal(managerTimeline.status, 200, await managerTimeline.clone().text());
    const managerTimelineText = await managerTimeline.text();
    assert.equal(managerTimelineText.includes("private HTTP note"), true, managerTimelineText);
    const viewerTimeline = await sourceAs(viewerLogin.token, { sourceId: "sales.timeline", surface: "workspace", input: timelineInput, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision", "body"] });
    assert.equal(viewerTimeline.status, 200, await viewerTimeline.clone().text());
    const viewerTimelineBody = await viewerTimeline.json();
    assert.equal(JSON.stringify(viewerTimelineBody).includes("private HTTP note"), false);
    assert.equal(viewerTimelineBody.data.fields.includes("body"), false);
    const representativeList = await sourceAs(representativeLogin.token, { sourceId: "sales.accounts", surface: "workspace", input: {}, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["name", "owner-id", "status", "revision"] });
    assert.equal(representativeList.status, 200, await representativeList.clone().text());
    assert.deepEqual((await representativeList.json()).data.rows.map(({ key }) => key).sort(), [String(teamlessParent.id), managerQualificationData.accountId].sort());
    const correctionB = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "call", subject: "Correction B", scheduledAt: "2026-09-09T08:00:00.000Z", supersedesActivityId: String(activityData.id) } }, "p13-3-activity-correction-b");
    assert.equal(correctionB.status, 200, await correctionB.clone().text());
    const correctionBData = (await correctionB.json()).data;
    assert.equal((await post("/k-nex/action", { actionId: "sales.activity.complete", input: { id: correctionBData.id, expectedRevision: 1 } }, "p13-3-activity-correction-b-complete")).status, 200);
    const correctionC = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "call", subject: "Correction C", scheduledAt: "2026-09-09T09:00:00.000Z", supersedesActivityId: String(correctionBData.id) } }, "p13-3-activity-correction-c");
    assert.equal(correctionC.status, 200, await correctionC.clone().text());
    const seedActivity = async (subject, supersedesActivityId = null, relatedRecordId = createdData.id) => (await pool.query(
      "insert into sales_activities (application_id,environment,owner_id,team_id,created_by,updated_by,revision,audit,status,type,subject,actor_id,scheduled_at,occurred_at,related_record_id,related_record_type,supersedes_activity_id) values ($1,'production',$2,$3,$2,$2,1,'[]'::jsonb,'completed','call',$4,$2,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z',$5,'sales.account',$6) returning id",
      [applicationId, String(user.id), `team:${user.id}`, subject, relatedRecordId, supersedesActivityId]
    )).rows[0].id;
    const foreignSupersessionAccount = await post("/k-nex/action", { actionId: "sales.account.create", input: { name: "Foreign supersession account" } }, "p13-3-supersession-account");
    const foreignSupersessionActivity = await seedActivity("foreign-supersession", null, (await foreignSupersessionAccount.json()).data.id);
    const foreignSupersessionRejected = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "call", subject: "foreign rejected", scheduledAt: "2026-09-09T09:30:00.000Z", supersedesActivityId: String(foreignSupersessionActivity) } }, "p13-3-activity-foreign-supersession");
    assert.equal(foreignSupersessionRejected.status, 403, await foreignSupersessionRejected.clone().text());
    const cycleFirst = await seedActivity("cycle-first");
    const cycleSecond = await seedActivity("cycle-second", cycleFirst);
    await pool.query("update sales_activities set supersedes_activity_id=$1 where id=$2", [cycleSecond, cycleFirst]);
    const timelineOutboxBeforeRejectedSupersession = Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.activity.create'" )).rows[0].count);
    const cycleRejected = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "call", subject: "cycle rejected", scheduledAt: "2026-09-09T10:00:00.000Z", supersedesActivityId: String(cycleSecond) } }, "p13-3-activity-cycle");
    assert.equal(cycleRejected.status, 403, await cycleRejected.clone().text());
    assert.equal(Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.activity.create'" )).rows[0].count), timelineOutboxBeforeRejectedSupersession);
    let tail = null;
    for (let depth = 0; depth < 33; depth += 1) tail = await seedActivity(`depth-${depth}`, tail);
    const depthRejected = await post("/k-nex/action", { actionId: "sales.activity.create", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, type: "call", subject: "depth rejected", scheduledAt: "2026-09-10T10:00:00.000Z", supersedesActivityId: String(tail) } }, "p13-3-activity-depth");
    assert.equal(depthRejected.status, 403, await depthRejected.clone().text());
    const timelineAccount = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${user.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", name: "Timeline window" } });
    const sameInstantActivityIds = [];
    for (let index = 0; index < 105; index += 1) sameInstantActivityIds.push(`activity:${await seedActivity(`window-${index}`, null, String(timelineAccount.id))}`);
    const windowTimelineInput = { "related-record-type": "sales.account", "related-record-id": String(timelineAccount.id) };
    const pagedTimeline = async (number) => sourceAs(login.token, { sourceId: "sales.timeline", surface: "workspace", input: windowTimelineInput, query: { page: { number, size: 25 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision"] });
    const timelinePageOne = await pagedTimeline(1);
    assert.equal(timelinePageOne.status, 200, await timelinePageOne.clone().text());
    const timelinePageOneBody = (await timelinePageOne.json()).data;
    assert.equal(timelinePageOneBody.rows.length, 25);
    assert.equal(timelinePageOneBody.page.hasNext, true);
    const timelinePageOneRepeat = await pagedTimeline(1);
    assert.equal(timelinePageOneRepeat.status, 200, await timelinePageOneRepeat.clone().text());
    assert.deepEqual((await timelinePageOneRepeat.json()).data.rows.map(({ key }) => key), timelinePageOneBody.rows.map(({ key }) => key));
    const timelinePageTwo = await pagedTimeline(2);
    assert.equal(timelinePageTwo.status, 200, await timelinePageTwo.clone().text());
    const timelinePageTwoBody = (await timelinePageTwo.json()).data;
    assert.equal(timelinePageTwoBody.rows.length, 25);
    assert.equal(timelinePageTwoBody.page.hasNext, true);
    const timelinePageThree = await pagedTimeline(3);
    assert.equal(timelinePageThree.status, 200, await timelinePageThree.clone().text());
    const timelinePageThreeBody = (await timelinePageThree.json()).data;
    assert.equal(timelinePageThreeBody.rows.length, 25);
    assert.equal(timelinePageThreeBody.page.hasNext, true);
    const timelinePageFour = await pagedTimeline(4);
    assert.equal(timelinePageFour.status, 200, await timelinePageFour.clone().text());
    const timelinePageFourBody = (await timelinePageFour.json()).data;
    assert.equal(timelinePageFourBody.rows.length, 25);
    assert.equal(timelinePageFourBody.page.hasNext, false);
    const pageKeys = [timelinePageOneBody, timelinePageTwoBody, timelinePageThreeBody, timelinePageFourBody].flatMap(({ rows }) => rows.map(({ key }) => key));
    assert.equal(new Set(pageKeys).size, pageKeys.length);
    assert.deepEqual(pageKeys, [...sameInstantActivityIds].reverse().slice(0, 100));
    const nonDivisorTimeline = async (number) => sourceAs(login.token, { sourceId: "sales.timeline", surface: "workspace", input: windowTimelineInput, query: { page: { number, size: 60 }, filters: [], sort: [] }, selectedFields: ["kind", "subject", "status", "occurred-at", "revision"] });
    const nonDivisorPageOne = (await (await nonDivisorTimeline(1)).json()).data;
    const nonDivisorPageTwoResponse = await nonDivisorTimeline(2);
    assert.equal(nonDivisorPageTwoResponse.status, 200, await nonDivisorPageTwoResponse.clone().text());
    const nonDivisorPageTwo = (await nonDivisorPageTwoResponse.json()).data;
    assert.equal(nonDivisorPageOne.rows.length, 60);
    assert.equal(nonDivisorPageOne.page.hasNext, true);
    assert.equal(nonDivisorPageTwo.rows.length, 40);
    assert.equal(nonDivisorPageTwo.page.hasNext, false);
    assert.deepEqual([...nonDivisorPageOne.rows, ...nonDivisorPageTwo.rows].map(({ key }) => key), pageKeys);
    const boundedAccount = await payload.create({ collection: "sales-accounts", overrideAccess: true, data: { applicationId, environment: "production", ownerId: String(user.id), teamId: `team:${user.id}`, createdBy: String(user.id), updatedBy: String(user.id), revision: 1, audit: [], status: "active", name: "Audit boundary" } });
    const boundedAudit = Array.from({ length: 100 }, (_, index) => ({
      actionId: index === 0 ? "sales.account.create" : "sales.account.update", resourceId: String(boundedAccount.id), applicationId, environment: "production",
      fromState: index === 0 ? "absent" : "active", toState: "active", occurredAt: "2026-09-06T00:00:00.000Z", actorId: String(user.id), revision: index + 1, idempotencyKey: `audit-boundary-${index + 1}`
    }));
    await pool.query("update sales_accounts set revision=100,audit=$2::jsonb where id=$1", [boundedAccount.id, JSON.stringify(boundedAudit)]);
    const boundedOutboxBefore = Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'resourceId'=$1", [String(boundedAccount.id)])).rows[0].count);
    const boundedIdempotencyBefore = Number((await pool.query("select count(*)::int count from sales_action_idempotency where idempotency_key='p13-3-audit-entry-101'")).rows[0].count);
    const boundedRejected = await post("/k-nex/action", { actionId: "sales.account.update", input: { id: String(boundedAccount.id), expectedRevision: 100, name: "Must not persist" } }, "p13-3-audit-entry-101");
    assert.equal(boundedRejected.status, 409, await boundedRejected.clone().text());
    assert.deepEqual((await pool.query("select name,revision,jsonb_array_length(audit) audit_count from sales_accounts where id=$1", [boundedAccount.id])).rows, [{ name: "Audit boundary", revision: 100, audit_count: 100 }]);
    assert.equal(Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'resourceId'=$1", [String(boundedAccount.id)])).rows[0].count), boundedOutboxBefore);
    assert.equal(Number((await pool.query("select count(*)::int count from sales_action_idempotency where idempotency_key='p13-3-audit-entry-101'")).rows[0].count), boundedIdempotencyBefore);
    const accountCreateOutboxBeforeRestart = Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.account.create'" )).rows[0].count);
    const authorityRevisionBeforeRestart = (await pool.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0];
    const delayedAuthorityLock = new pg.Client({ connectionString: container.getConnectionUri() });
    await delayedAuthorityLock.connect();
    await delayedAuthorityLock.query("begin");
    await delayedAuthorityLock.query("lock table k_nex_role_permission_grants in access exclusive mode");
    const delayedAuthority = await sourceAs(login.token, { sourceId: "sales.account.detail", surface: "workspace", input: { id: createdData.id }, query: { page: { number: 1, size: 1 }, filters: [], sort: [] }, selectedFields: ["name", "status", "revision"] });
    assert.notEqual(delayedAuthority.status, 200, await delayedAuthority.clone().text());
    const closedPayloadPool = payload.db.pool;
    await http.close();
    let shutdownDone = false;
    const shutdown = shutdownGate1Application(payload).then(() => { shutdownDone = true; });
    await Promise.resolve();
    assert.equal(shutdownDone, false);
    await delayedAuthorityLock.query("commit");
    await delayedAuthorityLock.end();
    await shutdown;
    await assert.rejects(closedPayloadPool.query("select 1"));
    const [{ bootGate1Application: bootRestartedApplication }, { createGate1Application }, { migrations }, { buildConfig }] = await Promise.all([
      import("../dist/src/boot.js"), import("../dist/src/create-application.js"), import("../dist/src/migrations/index.js"), import("payload")
    ]);
    const restartedApplication = createGate1Application({ databaseUrl: container.getConnectionUri(), migrations, payloadSecret: "p13-3-http" });
    payload = await bootRestartedApplication({ key: "p13-3-http-restart", config: Promise.resolve(buildConfig(restartedApplication.config)), authority: restartedApplication.authority });
    assert.notEqual(payload.db.pool, closedPayloadPool);
    http = await startHttp(payload, "p13-3-http-restart");
    const restartedReplay = await post("/k-nex/action", createBody, "p13-3-account-create");
    assert.equal(restartedReplay.status, 200, await restartedReplay.clone().text());
    assert.deepEqual((await restartedReplay.json()).data, createdData);
    assert.equal(Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.account.create'" )).rows[0].count), accountCreateOutboxBeforeRestart);
    assert.deepEqual((await pool.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id=$1", [applicationId])).rows[0], authorityRevisionBeforeRestart);
    const boundaryRestartReplay = await post("/k-nex/action", boundaryAttachmentBody, "p13-3-attachment-media-128");
    assert.equal(boundaryRestartReplay.status, 200, await boundaryRestartReplay.clone().text());
    assert.deepEqual((await boundaryRestartReplay.json()).data, boundaryAttachmentData);
    assert.deepEqual((await pool.query("select media_type from sales_attachment_references where id=$1", [boundaryAttachmentData.id])).rows, [{ media_type: boundaryMediaType }]);
    await pool.query("insert into k_nex_sales_attachment_upload_admissions values ($1,$2,'production',$3,'restart.txt','text/plain',9,'ready',1)", ["p13-3/restart", applicationId, String(user.id)]);
    const restartedAttachment = await post("/k-nex/action", { actionId: "sales.attachment.link", input: { relatedRecordType: "sales.account", relatedRecordId: createdData.id, storageReference: "p13-3/restart", filename: "restart.txt", mediaType: "text/plain", byteSize: 9 } }, "p13-3-attachment-restart");
    assert.equal(restartedAttachment.status, 200, await restartedAttachment.clone().text());
  } finally {
    await http?.close();
    if (payload !== undefined) {
      const { shutdownGate1Application } = await import("../dist/src/boot.js");
      await shutdownGate1Application(payload);
    }
    await pool.end(); await container.stop();
  }
});
