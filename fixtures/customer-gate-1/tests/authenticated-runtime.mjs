import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createPayloadRequest } from "payload";
import { canonicalJson } from "@k-nex/contracts";
import { salesPipelineStageId } from "@k-nex/module-sales/server";
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
  "sales.pipelines.read",
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
await pool.query(
  "insert into k_nex_system_settings_state (application_id,environment,settings_revision) values ('customer-gate-1','production',1)"
);
await pool.query(
  "insert into k_nex_system_settings_documents (application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,document_revision,settings_revision,values_json) values ('customer-gate-1','production','system.general',3,'platform:system','platform','system',1,1,$1::jsonb)",
  [JSON.stringify({ siteName: "K-Nex", reportingTimezone: "UTC", reportingCurrency: "USD" })]
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
  data: { ...salesScope(users.get("gate1@example.test")), name: "Fixture pipeline", status: "active", isActive: true }
});
const stageDefinitions = [
  ["qualification", "Qualification", 0, 0, ["discovery", "lost"]],
  ["discovery", "Discovery", 1, 2_500, ["proposal", "lost"]],
  ["proposal", "Proposal", 2, 5_000, ["negotiation", "lost"]],
  ["negotiation", "Negotiation", 3, 7_500, ["won", "lost"]],
  ["won", "Won", 4, 10_000, []],
  ["lost", "Lost", 5, 0, []]
];
const stageIds = Object.fromEntries(stageDefinitions.map(([semantic]) => [semantic, salesPipelineStageId("customer-gate-1", "production", Number(pipeline.id), semantic)]));
for (const [semantic, label, position, probabilityBasisPoints, transitions] of stageDefinitions) {
  await payload.create({
    collection: "sales-pipeline-stages",
    data: {
      ...salesScope(users.get("gate1@example.test")), pipelineId: pipeline.id, stageId: stageIds[semantic], name: label, semantic, position, probabilityBasisPoints,
      allowedTransitionStageIds: transitions.map((destination) => stageIds[destination]), requiredFieldIds: semantic === "lost" ? ["lossReason"] : [], status: "active"
    }
  });
}
const configuredPipeline = await payload.update({
  collection: "sales-pipelines",
  id: pipeline.id,
  data: { orderedStageIds: stageDefinitions.map(([semantic]) => stageIds[semantic]) }
});
const leadOpportunity = await payload.create({
  collection: "sales-opportunities",
  data: { ...salesScope(users.get("gate1@example.test")), name: "Lead opportunity", accountId: account.id, pipelineId: pipeline.id, stageId: stageIds.qualification }
});
await pool.query("update sales_opportunities set audit=jsonb_build_array(jsonb_build_object('kind','phase-13-legacy-upgrade','receiptDigest',$2::text,'legacyStage','lead','ownershipGenesis',jsonb_build_object('ownerId',owner_id,'teamId',team_id))) where id=$1", [leadOpportunity.id, `sha256:${"0".repeat(64)}`]);
const wonOpportunity = await payload.create({
  collection: "sales-opportunities",
  data: { ...salesScope(users.get("done@example.test")), name: "Won opportunity", accountId: account.id, pipelineId: pipeline.id, stageId: stageIds.won, closedAt: new Date().toISOString() }
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
  selectedFields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision"]
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
const actionRequest = async (token, actionId, input, idempotencyKey, signal) => createPayloadRequest({
  config: payload.config,
  payloadInstanceCacheKey: key,
  request: new Request("http://localhost/api/k-nex/action", {
    method: "POST",
    headers: { authorization: `JWT ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ actionId, input }),
    ...(signal === undefined ? {} : { signal })
  })
});
const callAction = async (token, actionId, input, idempotencyKey, signal) => actionEndpoint.handler(await actionRequest(token, actionId, input, idempotencyKey, signal));
const createActionEventId = (input, idempotencyKey) => {
  const requestDigest = `sha256:${createHash("sha256").update(canonicalJson({ actionId: "sales.task.create", input })).digest("hex")}`;
  return `sales-action-${createHash("sha256").update(canonicalJson({ applicationId: "customer-gate-1", environment: "production", actorId: String(users.get("gate1@example.test").id), actionId: "sales.task.create", key: idempotencyKey, digest: requestDigest })).digest("hex")}`;
};
const assertNoCreateEffects = async (title, idempotencyKey) => {
  const eventId = createActionEventId({ title }, idempotencyKey);
  assert.deepEqual((await pool.query(`select
    (select count(*)::int from sales_tasks where title=$1) task_count,
    (select count(*)::int from sales_action_idempotency where action_id='sales.task.create' and idempotency_key=$2) idempotency_count,
    (select count(*)::int from k_nex_outbox where event_id=$3) outbox_count`, [title, idempotencyKey, eventId])).rows[0],
  { task_count: 0, idempotency_count: 0, outbox_count: 0 });
};
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
const unavailableAction = await callAction(login.token, "sales.task.unavailable", { title: "Unavailable registration" }, "unavailable-registration");
assert.equal(unavailableAction.status, 404);
assert.equal((await unavailableAction.json()).code, "ACTION_NOT_FOUND");
assert.equal((await pool.query("select count(*)::int count from sales_action_idempotency where idempotency_key='unavailable-registration'")).rows[0].count, 0);
const postPolicyAbortTitle = "Abort after policy";
const postPolicyAbortKey = "abort-after-policy";
const postPolicyAbort = new AbortController();
postPolicyAbort.abort();
const postPolicyAbortResponse = await callAction(login.token, "sales.task.create", { title: postPolicyAbortTitle }, postPolicyAbortKey, postPolicyAbort.signal);
assert.equal(postPolicyAbortResponse.status, 499);
assert.equal((await postPolicyAbortResponse.json()).code, "ACTION_CANCELLED");
await assertNoCreateEffects(postPolicyAbortTitle, postPolicyAbortKey);
const postCreateAbortTitle = "Abort after create";
const postCreateAbortKey = "abort-after-create";
const postCreateAbort = new AbortController();
const postCreateRequest = await actionRequest(login.token, "sales.task.create", { title: postCreateAbortTitle }, postCreateAbortKey, postCreateAbort.signal);
const originalPayloadCreate = postCreateRequest.payload.create;
postCreateRequest.payload.create = async (options) => {
  const result = await originalPayloadCreate.call(postCreateRequest.payload, options);
  if (options.collection === "sales-tasks" && options.data?.title === postCreateAbortTitle) postCreateAbort.abort();
  return result;
};
let postCreateAbortResponse;
try { postCreateAbortResponse = await actionEndpoint.handler(postCreateRequest); }
finally { postCreateRequest.payload.create = originalPayloadCreate; }
assert.equal(postCreateAbortResponse.status, 500);
assert.equal((await postCreateAbortResponse.json()).code, "ACTION_FAILED");
await assertNoCreateEffects(postCreateAbortTitle, postCreateAbortKey);
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
  create function p13_action_create_failure() returns trigger language plpgsql as $$
  begin
    if new.title = '${auditFailureTitle}' then raise exception 'intentional audit finalization failure'; end if;
    return new;
  end;
  $$;
  create trigger p13_action_create_failure before insert on sales_tasks
  for each row execute function p13_action_create_failure();
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
await pool.query("drop trigger p13_action_create_failure on sales_tasks; drop function p13_action_create_failure();");
const updateResponse = await callAction(login.token, "sales.task.update", { id: createdTask.id, expectedRevision: createdTask.revision, expectedStatus: "open", status: "completed" }, "action-update-1");
assert.equal(updateResponse.status, 200);
assert.equal((await updateResponse.json()).data.status, "completed");
const stageResponse = await callAction(login.token, "sales.opportunity.stage.update", {
  id: String(leadOpportunity.id), expectedRevision: leadOpportunity.revision, expectedPipelineId: String(pipeline.id), expectedPipelineRevision: configuredPipeline.revision,
  expectedSourceStageId: stageIds.qualification, expectedSourceStageRevision: 1, destinationStageId: stageIds.discovery, expectedDestinationStageRevision: 1
}, "action-stage-1");
assert.equal(stageResponse.status, 200);
assert.equal((await stageResponse.json()).data.stageId, stageIds.discovery);
const forbiddenTask = await callAction(login.token, "sales.task.update", { id: String(doneTask.id), expectedRevision: doneTask.revision, expectedStatus: "open", status: "completed" }, "action-forbidden-task");
assert.equal(forbiddenTask.status, 403);
assert.equal((await forbiddenTask.json()).code, "ACTION_TARGET_FORBIDDEN");
const forbiddenOpportunity = await callAction(login.token, "sales.opportunity.stage.update", {
  id: String(wonOpportunity.id), expectedRevision: wonOpportunity.revision, expectedPipelineId: String(pipeline.id), expectedPipelineRevision: configuredPipeline.revision,
  expectedSourceStageId: stageIds.won, expectedSourceStageRevision: 1, destinationStageId: stageIds.lost, expectedDestinationStageRevision: 1
}, "action-forbidden-opportunity");
assert.equal(forbiddenOpportunity.status, 403);
assert.equal((await forbiddenOpportunity.json()).code, "ACTION_TARGET_FORBIDDEN");
const doneTaskUpdate = await callAction(doneLogin.token, "sales.task.update", { id: String(doneTask.id), expectedRevision: doneTask.revision, expectedStatus: "open", status: "completed" }, "action-done-task");
assert.equal(doneTaskUpdate.status, 409);
const doneOpportunityUpdate = await callAction(doneLogin.token, "sales.opportunity.stage.update", {
  id: String(wonOpportunity.id), expectedRevision: wonOpportunity.revision, expectedPipelineId: String(pipeline.id), expectedPipelineRevision: configuredPipeline.revision,
  expectedSourceStageId: stageIds.won, expectedSourceStageRevision: 1, destinationStageId: stageIds.lost, expectedDestinationStageRevision: 1
}, "action-done-opportunity");
assert.equal(doneOpportunityUpdate.status, 409);

await pool.query("update sales_current_authority_scopes set state='revoked', revision=revision+1 where application_id='customer-gate-1' and environment='production' and principal_id=$1", [String(users.get("gate1@example.test").id)]);
const revokedSource = await callSource(login.token);
assert.equal(revokedSource.status, 403);
const revokedAction = await callAction(login.token, "sales.task.create", { title: "Revoked action" }, "revoked-action");
assert.equal(revokedAction.status, 403);
assert.equal((await revokedAction.json()).code, "ACTION_FORBIDDEN");
await assertNoCreateEffects("Revoked action", "revoked-action");
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
const resolvedGraph = JSON.parse(readFileSync(new URL("../.k-nex/generated/k-nex.resolved.json", import.meta.url), "utf8"));
const resolvedGraphDigest = `sha256:${createHash("sha256")
  .update(canonicalJson(resolvedGraph))
  .digest("hex")}`;
assert.equal(inventory.resolvedGraphDigest, resolvedGraphDigest);
assert.match(inventory.sourceArtifact.digest, /^sha256:[0-9a-f]{64}$/);
assert.match(inventory.applicationManifestDigest, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(inventory.plugins, resolvedGraph.plugins.map(({ id, package: packageName, version, integrity, contributions }) => ({
  id,
  package: packageName,
  version,
  integrity,
  expectedContributions: contributions,
  actualContributions: Object.fromEntries(Object.entries(contributions).map(([kind, entries]) => [kind, Object.keys(entries)]))
})));
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
