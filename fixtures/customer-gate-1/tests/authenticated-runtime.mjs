import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createPayloadRequest } from "payload";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { bootstrapFirstOwner } from "@k-nex/runtime";

import { bootGate1Application } from "../dist/src/boot.js";
import { installStaticAuthorizationEnvironment, staticAuthorizationBuild } from "./static-authorization-build.mjs";

installStaticAuthorizationEnvironment();

const key = process.env.BOOT_KEY;
const password = "gate1-authenticated-query-password";
const payload = await bootGate1Application({ key });
const users = new Map();

for (const email of ["gate1@example.test", "gate1-peer@example.test", "done@example.test", "no-note@example.test", "required-denied@example.test"]) {
  users.set(email, await payload.create({ collection: "users", data: { email, password } }));
}
const userIds = new Set([...users.values()].map(({ id }) => String(id)));
const pool = payload.db?.pool;
assert.ok(pool && typeof pool === "object" && "connect" in pool && "query" in pool);
const store = new PostgresAuthorizationStore(pool, {
  validate: (applicationId, subject) => applicationId === "customer-gate-1" && subject.kind === "user" && userIds.has(subject.id)
    ? "accepted"
    : "rejected"
});
const firstOwner = await bootstrapFirstOwner({
  store,
  expected: { applicationId: "customer-gate-1", environment: "production", authorizationRevision: 0, lifecycleRevision: 0 },
  firstOwner: { kind: "user", id: String(users.get("gate1@example.test").id) }
});
const salesOwner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });
const salesScope = (user) => ({
  applicationId: "customer-gate-1",
  environment: "production",
  ownerId: String(user.id),
  teamId: `team:${user.id}`,
  createdBy: String(user.id),
  updatedBy: String(user.id)
});
const salesPermissions = [
  "sales.opportunities.read",
  "sales.opportunities.stage.update",
  "sales.opportunities.write",
  "sales.tasks.read",
  "sales.tasks.write"
];
await store.transaction({
  applicationId: "customer-gate-1",
  environment: "production",
  authorizationRevision: firstOwner.state.authorizationRevision,
  lifecycleRevision: firstOwner.state.lifecycleRevision
}, async (transaction) => {
  const seedRole = async (roleId, permissions, emails) => {
    await transaction.write({ kind: "role", role: {
      schemaVersion: 1,
      id: roleId,
      applicationId: "customer-gate-1",
      label: "Fixture Sales operator",
      revision: 0
    } });
    for (const permissionId of permissions) {
      await transaction.write({ kind: "grant", grant: {
        schemaVersion: 1,
        id: `${roleId}.${permissionId}`,
        applicationId: "customer-gate-1",
        roleId,
        permissionId,
        owner: salesOwner,
        revision: 0
      } });
    }
    for (const email of emails) {
      await transaction.write({ kind: "assignment", assignment: {
        schemaVersion: 1,
        id: `${roleId}.${email.replace(/@|\./gu, "-")}`,
        applicationId: "customer-gate-1",
        roleId,
        principal: { kind: "user", id: String(users.get(email).id) },
        state: "active",
        revision: 0
      } });
    }
  };
  await transaction.write({ kind: "extension-generation", generation: {
    schemaVersion: 1,
    applicationId: "customer-gate-1",
    owner: salesOwner,
    runtimeGenerationIds: ["static-module-sales-1"],
    state: "current",
    authorizationRevision: firstOwner.state.authorizationRevision + 1,
    lifecycleRevision: firstOwner.state.lifecycleRevision + 1
  } });
  await seedRole("fixture.sales-operator", salesPermissions, ["gate1@example.test", "gate1-peer@example.test", "done@example.test"]);
  await seedRole("fixture.sales-operator-no-note", salesPermissions.filter((permissionId) => permissionId !== "sales.tasks.private-note.read"), ["no-note@example.test"]);
});
await pool.query(
  "insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation) values ($1,$2,$3,$4,1,'active',$5,$6::jsonb)",
  ["customer-gate-1", "production", "platform-plugin", "module.sales", "static-module-sales-1", JSON.stringify(staticAuthorizationBuild)]
);
await pool.query(`insert into sales_current_authority_scopes
  (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision)
  values ('customer-gate-1','production',$1,'owned-or-assigned-team',false,true,'[]'::jsonb,'active',1),
         ('customer-gate-1','production',$2,'owned-or-assigned-team',false,true,'[]'::jsonb,'active',1),
         ('customer-gate-1','production',$3,'owned-or-assigned-team',false,true,'[]'::jsonb,'active',1),
         ('customer-gate-1','production',$4,'explicit-application-or-team-scope',false,false,'[]'::jsonb,'active',1),
         ('customer-gate-1','production',$5,'explicit-application-or-team-scope',false,false,'[]'::jsonb,'active',1)`,
  ["gate1@example.test", "gate1-peer@example.test", "done@example.test", "no-note@example.test", "required-denied@example.test"].map((email) => String(users.get(email).id)));
const openTask = await payload.create({
  collection: "sales-tasks",
  data: { ...salesScope(users.get("gate1@example.test")), title: "Authenticated Gate 1 query", status: "open" }
});
const doneTask = await payload.create({
  collection: "sales-tasks",
  data: { ...salesScope(users.get("done@example.test")), title: "Done actor query", status: "completed" }
});
const sharedTask = await payload.create({
  collection: "sales-tasks",
  data: { ...salesScope(users.get("gate1@example.test")), teamId: "team:shared", title: "Shared team query", status: "open" }
});
const privateTask = await payload.create({
  collection: "sales-tasks",
  data: { ...salesScope(users.get("gate1@example.test")), teamId: "team:private", title: "Private team query", status: "open" }
});
const account = await payload.create({
  collection: "sales-accounts",
  data: { ...salesScope(users.get("gate1@example.test")), name: "Fixture account", status: "active" }
});
const pipeline = await payload.create({
  collection: "sales-pipelines",
  data: { ...salesScope(users.get("gate1@example.test")), name: "Fixture pipeline", status: "active" }
});
for (const [stageId, label, position] of [["qualification", "Qualification", 0], ["discovery", "Discovery", 1], ["won", "Won", 2]]) {
  await payload.create({
    collection: "sales-pipeline-stages",
    data: { ...salesScope(users.get("gate1@example.test")), pipelineId: pipeline.id, stageId, name: label, semantic: stageId, position, probabilityBasisPoints: 0, status: "active" }
  });
}
const leadOpportunity = await payload.create({
  collection: "sales-opportunities",
  data: { ...salesScope(users.get("gate1@example.test")), name: "Lead opportunity", accountId: account.id, pipelineId: pipeline.id, stageId: "qualification" }
});
await pool.query("update sales_opportunities set audit=jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-upgrade','receiptDigest',$2::text,'legacyStage','lead','ownershipGenesis',jsonb_build_object('ownerId',owner_id,'teamId',team_id))) where id=$1", [leadOpportunity.id, `sha256:${"0".repeat(64)}`]);
const wonOpportunity = await payload.create({
  collection: "sales-opportunities",
  data: { ...salesScope(users.get("done@example.test")), name: "Won opportunity", accountId: account.id, pipelineId: pipeline.id, stageId: "won", closedAt: new Date().toISOString() }
});

const loginAs = (email) => payload.login({ collection: "users", data: { email, password }, overrideAccess: false });
const login = await loginAs("gate1@example.test");
const peerLogin = await loginAs("gate1-peer@example.test");
assert.ok(login.token);
assert.ok(peerLogin.token);
assert.notEqual(login.user.id, peerLogin.user.id);

const authenticatedRequest = await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/runtime-inventory", {
    headers: { authorization: `JWT ${login.token}` }
  })
});
assert.ok(authenticatedRequest.user);

await assert.rejects(payload.find({
  collection: "sales-tasks",
  overrideAccess: false,
  req: authenticatedRequest
}), /not allowed|forbidden|permission/i);

const dataSourceEndpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/data-source-query");
assert.ok(dataSourceEndpoint);
const sourceBody = {
  sourceId: "sales.tasks",
  surface: "workspace",
  input: {},
  query: { page: { number: 1, size: 25 }, filters: [], sort: [] },
  selectedFields: ["title", "status"]
};
const sourceRequest = async (token, body = sourceBody) => createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/data-source-query", {
    method: "POST",
    headers: { authorization: `JWT ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  })
});
const callSource = async (token, body) => dataSourceEndpoint.handler(await sourceRequest(token, body));

const openResponse = await callSource(login.token);
assert.equal(openResponse.status, 200);
const openResult = await openResponse.json();
assert.deepEqual(openResult.data.fields, sourceBody.selectedFields);
assert.deepEqual(openResult.data.rows.map((row) => row.values.title.value), ["Authenticated Gate 1 query", "Shared team query", "Private team query"]);

const forgedScopeResponse = await callSource(login.token, {
  ...sourceBody,
  query: {
    ...sourceBody.query,
    recordScope: { kind: "sales.tasks", where: { status: { equals: "done" } } }
  }
});
assert.equal(forgedScopeResponse.status, 400);
assert.equal((await forgedScopeResponse.json()).code, "INVALID_QUERY_CONTROLS");

await assert.rejects(payload.update({
  collection: "sales-tasks",
  id: openTask.id,
  data: { title: "Mutated by authorized direct write" },
  user: login.user,
  overrideAccess: false
}), /not allowed|forbidden|permission/i);

const peerResponse = await callSource(peerLogin.token);
assert.equal(peerResponse.status, 200);
const peerResult = await peerResponse.json();
assert.deepEqual(peerResult.data.fields, openResult.data.fields);
assert.deepEqual(peerResult.data.rows, []);

await pool.query("update sales_current_authority_scopes set record_scope='explicit-application-or-team-scope', application_wide=false, mutation_allowed=false, authorized_team_ids='[\"team:shared\"]'::jsonb, revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1-peer@example.test").id)]);
const explicitTeamSource = await callSource(peerLogin.token);
assert.equal(explicitTeamSource.status, 200);
assert.deepEqual((await explicitTeamSource.json()).data.rows.map((row) => row.values.title.value), ["Shared team query"]);
await pool.query("update sales_current_authority_scopes set record_scope='explicit-application-or-team-scope', application_wide=true, mutation_allowed=false, authorized_team_ids='[]'::jsonb, revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1-peer@example.test").id)]);
const appWideSource = await callSource(peerLogin.token);
assert.equal(appWideSource.status, 200);
assert.deepEqual((await appWideSource.json()).data.rows.map((row) => row.values.title.value), ["Authenticated Gate 1 query", "Shared team query", "Private team query"]);

const unknownResponse = await callSource(login.token, { ...sourceBody, sourceId: "sales.tasks.other" });
assert.equal(unknownResponse.status, 404);
assert.equal((await unknownResponse.json()).code, "SOURCE_NOT_FOUND");

const deniedLogin = await loginAs("required-denied@example.test");
const deniedResponse = await callSource(deniedLogin.token, { ...sourceBody, selectedFields: sourceBody.selectedFields.slice(0, 3) });
assert.equal(deniedResponse.status, 403);
assert.equal((await deniedResponse.json()).code, "SOURCE_FORBIDDEN");

const noNoteLogin = await loginAs("no-note@example.test");
const noNoteResponse = await callSource(noNoteLogin.token);
assert.equal(noNoteResponse.status, 200);
const noNoteResult = await noNoteResponse.json();
assert.deepEqual(noNoteResult.data.fields, sourceBody.selectedFields.slice(0, 3));
assert.deepEqual(noNoteResult.data.rows, []);

const doneLogin = await loginAs("done@example.test");
const doneResponse = await callSource(doneLogin.token);
assert.equal(doneResponse.status, 200);
const doneResult = await doneResponse.json();
assert.deepEqual(doneResult.data.rows.map((row) => row.values.title.value), ["Done actor query"]);
assert.notDeepEqual(doneResult.data.rows, openResult.data.rows);

const opportunitiesBody = {
  ...sourceBody,
  sourceId: "sales.opportunities",
  selectedFields: ["name", "stage-id", "revision"]
};
const opportunitiesResponse = await callSource(login.token, opportunitiesBody);
assert.equal(opportunitiesResponse.status, 200);
const opportunitiesResult = await opportunitiesResponse.json();
assert.deepEqual(opportunitiesResult.data.rows.map((row) => row.values.name.value), ["Lead opportunity"]);
const wonScopeResponse = await callSource(doneLogin.token, opportunitiesBody);
assert.equal(wonScopeResponse.status, 200);
assert.deepEqual((await wonScopeResponse.json()).data.rows.map((row) => row.values.name.value), ["Won opportunity"]);

const actionEndpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/action");
assert.ok(actionEndpoint);
const callAction = async (token, actionId, input, idempotencyKey) => actionEndpoint.handler(await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/action", {
    method: "POST",
    headers: { authorization: `JWT ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ actionId, input })
  })
}));
await pool.query(`update sales_tasks set audit=jsonb_build_array(jsonb_build_object(
  'actionId','sales.task.create','resourceId',id::text,'applicationId','customer-gate-1','environment','production',
  'fromState','absent','toState','open','occurredAt','2026-09-06T00:00:00.000Z','actorId',$2::text,'revision',1,'idempotencyKey','shared-create'))
  where id=$1`, [sharedTask.id, String(users.get("gate1@example.test").id)]);
await pool.query("update sales_current_authority_scopes set record_scope='managed-teams-and-own', application_wide=false, mutation_allowed=true, authorized_team_ids='[\"team:shared\"]'::jsonb, revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1-peer@example.test").id)]);
const managerCrossOwner = await callAction(peerLogin.token, "sales.task.update", { id: String(sharedTask.id), expectedRevision: 1, expectedStatus: "open", status: "completed" }, "managed-shared-update");
assert.equal(managerCrossOwner.status, 200);
const managerOutOfScope = await callAction(peerLogin.token, "sales.task.update", { id: String(privateTask.id), expectedRevision: 1, expectedStatus: "open", status: "completed" }, "managed-private-update");
assert.equal(managerOutOfScope.status, 403);
assert.equal((await managerOutOfScope.json()).code, "ACTION_TARGET_FORBIDDEN");
const createResponse = await callAction(login.token, "sales.task.create", { title: "Gateway-created task" }, "action-create-1");
assert.equal(createResponse.status, 200);
const createdTask = (await createResponse.json()).data;
const createReplay = await callAction(login.token, "sales.task.create", { title: "Gateway-created task" }, "action-create-1");
assert.equal(createReplay.status, 200);
assert.deepEqual((await createReplay.json()).data, createdTask);
const changedDigest = await callAction(login.token, "sales.task.create", { title: "Changed replay input" }, "action-create-1");
assert.equal(changedDigest.status, 409);
assert.equal((await changedDigest.json()).code, "IDEMPOTENCY_CONFLICT");
const concurrentKey = "action-create-concurrent";
const concurrentInput = { title: "Gateway concurrent task" };
const [concurrentLeft, concurrentRight] = await Promise.all([
  callAction(login.token, "sales.task.create", concurrentInput, concurrentKey),
  callAction(login.token, "sales.task.create", concurrentInput, concurrentKey)
]);
assert.equal(concurrentLeft.status, 200);
assert.equal(concurrentRight.status, 200);
assert.deepEqual((await concurrentLeft.json()).data, await concurrentRight.json().then(({ data }) => data));
const concurrentRequestDigest = `sha256:${createHash("sha256").update(canonicalJson({ actionId: "sales.task.create", input: concurrentInput })).digest("hex")}`;
const concurrentEventId = `sales-action-${createHash("sha256").update(canonicalJson({ applicationId: "customer-gate-1", environment: "production", actorId: String(users.get("gate1@example.test").id), actionId: "sales.task.create", key: concurrentKey, digest: concurrentRequestDigest })).digest("hex")}`;
assert.deepEqual((await pool.query(`select
  (select count(*)::int from sales_tasks where title='Gateway concurrent task') as task_count,
  (select count(*)::int from sales_tasks, jsonb_array_elements(audit) entry where entry->>'idempotencyKey'=$1) as audit_count,
  (select count(*)::int from k_nex_outbox where event_id=$1) as outbox_count,
  (select count(*)::int from sales_action_idempotency where effective_actor_id=$2 and action_id='sales.task.create' and idempotency_key=$3 and request_digest=$4 and result_json->>'state'='succeeded') as idempotency_count`,
  [concurrentEventId, String(users.get("gate1@example.test").id), concurrentKey, concurrentRequestDigest])).rows[0], { task_count: 1, audit_count: 1, outbox_count: 1, idempotency_count: 1 });
const auditFailureTitle = "Gateway audit finalization failure";
const auditFailureKey = "action-create-audit-finalization-failure";
await pool.query(`
  create function p13_action_audit_finalization_failure() returns trigger language plpgsql as $$
  begin
    if new.title = '${auditFailureTitle}' then raise exception 'intentional audit finalization failure'; end if;
    return new;
  end;
  $$;
  create trigger p13_action_audit_finalization_failure before update on sales_tasks
  for each row execute function p13_action_audit_finalization_failure();
`);
const auditFailureResponse = await callAction(login.token, "sales.task.create", { title: auditFailureTitle }, auditFailureKey);
assert.equal(auditFailureResponse.status, 500);
assert.equal((await auditFailureResponse.json()).code, "ACTION_FAILED");
assert.deepEqual((await pool.query(`
  select
    (select count(*)::int from sales_tasks where title = $1) as task_count,
    (select count(*)::int from k_nex_outbox where event_id = $2) as event_count,
    (select count(*)::int from sales_tasks, jsonb_array_elements(audit) as entry where entry->>'idempotencyKey' = $2) as audit_count
`, [auditFailureTitle, auditFailureKey])).rows[0], { task_count: 0, event_count: 0, audit_count: 0 });
await pool.query("drop trigger p13_action_audit_finalization_failure on sales_tasks; drop function p13_action_audit_finalization_failure();");
const updateResponse = await callAction(login.token, "sales.task.update", { id: createdTask.id, expectedRevision: createdTask.revision, expectedStatus: "open", status: "completed" }, "action-update-1");
assert.equal(updateResponse.status, 200);
assert.equal((await updateResponse.json()).data.status, "completed");
const stageResponse = await callAction(login.token, "sales.opportunity.stage.update", { id: String(leadOpportunity.id), expectedStage: "qualification", expectedRevision: leadOpportunity.revision, stage: "discovery" }, "action-stage-1");
assert.equal(stageResponse.status, 200);
assert.equal((await stageResponse.json()).data.stage, "discovery");
const forbiddenTask = await callAction(login.token, "sales.task.update", { id: String(doneTask.id), expectedRevision: doneTask.revision, expectedStatus: "open", status: "completed" }, "action-forbidden-task");
assert.equal(forbiddenTask.status, 403);
assert.equal((await forbiddenTask.json()).code, "ACTION_TARGET_FORBIDDEN");
const forbiddenOpportunity = await callAction(login.token, "sales.opportunity.stage.update", { id: String(wonOpportunity.id), expectedStage: "qualification", expectedRevision: wonOpportunity.revision, stage: "discovery" }, "action-forbidden-opportunity");
assert.equal(forbiddenOpportunity.status, 403);
assert.equal((await forbiddenOpportunity.json()).code, "ACTION_TARGET_FORBIDDEN");
const doneTaskUpdate = await callAction(doneLogin.token, "sales.task.update", { id: String(doneTask.id), expectedRevision: doneTask.revision, expectedStatus: "open", status: "completed" }, "action-done-task");
assert.equal(doneTaskUpdate.status, 409);
const doneOpportunityUpdate = await callAction(doneLogin.token, "sales.opportunity.stage.update", { id: String(wonOpportunity.id), expectedStage: "won", expectedRevision: wonOpportunity.revision, stage: "lost" }, "action-done-opportunity");
assert.equal(doneOpportunityUpdate.status, 400);

await pool.query("update sales_current_authority_scopes set state='revoked', revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1@example.test").id)]);
const revokedSource = await callSource(login.token);
assert.equal(revokedSource.status, 403);
const revokedAction = await callAction(login.token, "sales.task.create", { title: "Revoked action" }, "revoked-action");
assert.equal(revokedAction.status, 403);
await pool.query("update sales_current_authority_scopes set state='active', record_scope='explicit-application-or-team-scope', application_wide=true, mutation_allowed=false, revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1@example.test").id)]);
const demotedSource = await callSource(login.token);
assert.equal(demotedSource.status, 200);
const demotedAction = await callAction(login.token, "sales.task.create", { title: "Demoted action" }, "demoted-action");
assert.equal(demotedAction.status, 403);
await pool.query("update sales_current_authority_scopes set record_scope='owned-or-assigned-team', application_wide=false, mutation_allowed=true, revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1@example.test").id)]);

const unauthenticatedRequest = await createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/runtime-inventory")
});
await assert.rejects(
  payload.find({
    collection: "sales-tasks",
    overrideAccess: false,
    req: unauthenticatedRequest
  }),
  (error) => error?.status === 403
);

const endpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/runtime-inventory");
assert.ok(endpoint);
const deniedInventory = await endpoint.handler(unauthenticatedRequest);
assert.equal(deniedInventory.status, 401);

const inventoryResponse = await endpoint.handler(authenticatedRequest);
assert.equal(inventoryResponse.status, 200);
assert.equal(inventoryResponse.headers.get("cache-control"), "private, no-store");
const inventory = await inventoryResponse.json();
assert.equal(inventory.applicationId, "customer-gate-1");
const resolvedGraphDigest = `sha256:${createHash("sha256")
  .update(canonicalJson(JSON.parse(readFileSync(new URL("../.k-nex/generated/k-nex.resolved.json", import.meta.url), "utf8"))))
  .digest("hex")}`;
assert.equal(inventory.resolvedGraphDigest, resolvedGraphDigest);
assert.match(inventory.sourceArtifact.digest, /^sha256:[0-9a-f]{64}$/);
assert.match(inventory.applicationManifestDigest, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(inventory.plugins, [{
  id: "module.sales",
  package: "@k-nex/module-sales",
  version: "1.0.0",
  integrity: inventory.plugins[0].integrity,
  expectedContributions: {
    actions: {
      "sales.opportunity.stage.update": "required",
      "sales.task.create": "required",
      "sales.task.update": "required"
    },
    blocks: {
      "sales.opportunity-detail": "required",
      "sales.opportunity-kanban": "required",
      "sales.opportunity-list": "required",
      "sales.revenue-metric": "required",
      "sales.settings-summary": "required",
      "sales.task-quick-create": "required",
      "sales.task-table": "required"
    },
    components: {
      "sales.detail.opportunity": "required",
      "sales.form.task-quick-create": "required",
      "sales.list.opportunities": "required",
      "sales.metric.total-potential-revenue": "required",
      "sales.status.pipeline-stage": "required",
      "sales.table.tasks": "required"
    },
    events: {
      "sales.event.opportunity-changed": "required",
      "sales.event.task-changed": "required"
    },
    healthAudit: { "sales.health.runtime": "required" },
    jobs: { "sales.job.pipeline-audit": "required" },
    lifecycle: { "sales.lifecycle.reference": "required" },
    localization: { "sales.localization.en": "required" },
    migrations: { "sales.migration.initial": "required" },
    navigation: {
      "sales.navigation.opportunities": "required",
      "sales.navigation.overview": "required",
      "sales.navigation.settings": "required",
      "sales.navigation.tasks": "required"
    },
    pageTemplates: {
      "sales.page.opportunities": "required",
      "sales.page.overview": "required",
      "sales.page.settings": "required",
      "sales.page.tasks": "required"
    },
    permissions: {
      "sales.navigation.read": "required",
      "sales.opportunities.name.read": "required",
      "sales.opportunities.read": "required",
      "sales.opportunities.stage.read": "required",
      "sales.opportunities.value.read": "required",
      "sales.opportunities.write": "required",
      "sales.settings.read": "required",
      "sales.settings.write": "required",
      "sales.tasks.private-note.read": "required",
      "sales.tasks.read": "required",
      "sales.tasks.revenue.read": "required",
      "sales.tasks.status.read": "required",
      "sales.tasks.title.read": "required",
      "sales.tasks.write": "required"
    },
    policyBindings: {
      "sales.policy.opportunities.name.read": "required",
      "sales.policy.opportunities.read": "required",
      "sales.policy.opportunities.stage.read": "required",
      "sales.policy.opportunities.value.read": "required",
      "sales.policy.opportunities.write": "required",
      "sales.policy.tasks.private-note.read": "required",
      "sales.policy.tasks.read": "required",
      "sales.policy.tasks.revenue.read": "required",
      "sales.policy.tasks.status.read": "required",
      "sales.policy.tasks.title.read": "required",
      "sales.policy.tasks.write": "required"
    },
    realtimeTopics: {
      "sales.realtime.opportunities": "required",
      "sales.realtime.tasks": "required"
    },
    roleTemplates: {
      "sales.template.administrator": "required",
      "sales.template.manager": "required",
      "sales.template.representative": "required",
      "sales.template.viewer": "required"
    },
    routes: {
      "sales.route.opportunities": "required",
      "sales.route.overview": "required",
      "sales.route.settings": "required",
      "sales.route.tasks": "required"
    },
    schema: {
      "sales.opportunities.collection": "required",
      "sales.tasks.collection": "required"
    },
    services: { "sales.service.domain": "required" },
    settings: { "sales.settings.workspace": "required" },
    sources: {
      "sales.opportunities": "required",
      "sales.tasks": "required",
      "sales.total-potential-revenue": "required"
    },
    testingMetadata: { "sales.testing.conformance": "required" },
    tools: { "sales.tools.create-task": "required", "sales.tools.search-tasks": "required" }
  },
  actualContributions: {
    actions: ["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"],
    blocks: ["sales.opportunity-detail", "sales.opportunity-kanban", "sales.opportunity-list", "sales.settings-summary", "sales.task-quick-create", "sales.task-table"],
    components: ["sales.detail.opportunity", "sales.form.task-quick-create", "sales.list.opportunities", "sales.status.pipeline-stage", "sales.table.tasks"],
    events: ["sales.event.opportunity-changed", "sales.event.task-changed"],
    healthAudit: ["sales.health.runtime"],
    jobs: ["sales.job.pipeline-audit"],
    lifecycle: ["sales.lifecycle.reference"],
    localization: ["sales.localization.en"],
    migrations: ["sales.migration.initial"],
    navigation: ["sales.navigation.opportunities", "sales.navigation.overview", "sales.navigation.settings", "sales.navigation.tasks"],
    pageTemplates: ["sales.page.opportunities", "sales.page.overview", "sales.page.settings", "sales.page.tasks"],
    permissions: ["sales.accounts.archive", "sales.accounts.read", "sales.accounts.write", "sales.activities.read", "sales.activities.write", "sales.attachments.read", "sales.attachments.write", "sales.communications.calendar.sync", "sales.communications.email.send", "sales.communications.metadata.read", "sales.contacts.archive", "sales.contacts.channels.read", "sales.contacts.read", "sales.contacts.write", "sales.exports.execute", "sales.exports.read", "sales.imports.execute", "sales.imports.read", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.disqualify", "sales.leads.qualify", "sales.leads.read", "sales.leads.write", "sales.notes.body.read", "sales.notes.read", "sales.notes.write", "sales.notifications.read", "sales.notifications.write", "sales.opportunities.amount.read", "sales.opportunities.archive", "sales.opportunities.close", "sales.opportunities.read", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.ownership.write", "sales.pipelines.configure", "sales.pipelines.read", "sales.records.merge", "sales.reminders.read", "sales.reminders.write", "sales.reports.read", "sales.reports.schedule", "sales.saved-views.read", "sales.saved-views.write", "sales.settings.read", "sales.settings.write", "sales.tasks.archive", "sales.tasks.read", "sales.tasks.write"],
    policyBindings: ["sales.accounts.archive.policy", "sales.accounts.read.policy", "sales.accounts.write.policy", "sales.activities.read.policy", "sales.activities.write.policy", "sales.attachments.read.policy", "sales.attachments.write.policy", "sales.communications.calendar.sync.policy", "sales.communications.email.send.policy", "sales.communications.metadata.read.policy", "sales.contacts.archive.policy", "sales.contacts.channels.read.policy", "sales.contacts.read.policy", "sales.contacts.write.policy", "sales.exports.execute.policy", "sales.exports.read.policy", "sales.imports.execute.policy", "sales.imports.read.policy", "sales.leads.archive.policy", "sales.leads.channels.read.policy", "sales.leads.disqualify.policy", "sales.leads.qualify.policy", "sales.leads.read.policy", "sales.leads.write.policy", "sales.notes.body.read.policy", "sales.notes.read.policy", "sales.notes.write.policy", "sales.notifications.read.policy", "sales.notifications.write.policy", "sales.opportunities.amount.read.policy", "sales.opportunities.archive.policy", "sales.opportunities.close.policy", "sales.opportunities.read.policy", "sales.opportunities.stage.update.policy", "sales.opportunities.write.policy", "sales.ownership.write.policy", "sales.pipelines.configure.policy", "sales.pipelines.read.policy", "sales.records.merge.policy", "sales.reminders.read.policy", "sales.reminders.write.policy", "sales.reports.read.policy", "sales.saved-views.read.policy", "sales.saved-views.write.policy", "sales.tasks.archive.policy", "sales.tasks.read.policy", "sales.tasks.write.policy"],
    realtimeTopics: ["sales.realtime.opportunities", "sales.realtime.tasks"],
    roleTemplates: ["sales.template.administrator", "sales.template.manager", "sales.template.representative", "sales.template.viewer"],
    routes: ["sales.route.opportunities", "sales.route.overview", "sales.route.settings", "sales.route.tasks"],
    schema: ["sales.accounts.collection", "sales.activities.collection", "sales.attachment-references.collection", "sales.contacts.collection", "sales.leads.collection", "sales.notes.collection", "sales.opportunities.collection", "sales.pipeline-stages.collection", "sales.pipelines.collection", "sales.tasks.collection"],
    services: ["sales.service.domain"],
    settings: ["sales.settings.workspace"],
    sources: ["sales.opportunities", "sales.tasks"],
    testingMetadata: ["sales.testing.conformance"],
    tools: ["sales.tools.create-task", "sales.tools.search-tasks"]
  }
}, {
  id: "provider.realtime.socketio",
  package: "@k-nex/provider-realtime-socketio",
  version: "1.0.0",
  integrity: inventory.plugins[1].integrity,
  expectedContributions: {},
  actualContributions: {}
}]);
assert.deepEqual(inventory.migrationRevision, {
  migrationName: "20260905_000027_crm_core",
  predecessor: 24,
  current: 25
});
const serializedInventory = JSON.stringify(inventory);
for (const forbidden of [process.env.DATABASE_URL, process.env.PAYLOAD_SECRET, login.token, password, "gate1@example.test"]) {
  assert.equal(serializedInventory.includes(forbidden), false);
}

console.log("P1_8_PASS");
process.exit(0);
