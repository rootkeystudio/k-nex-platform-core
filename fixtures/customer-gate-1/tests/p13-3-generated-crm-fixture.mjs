import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { createFixtureDeploymentVerifier } from "../../../scripts/lib/fixture-deployment-authority.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const applicationId = "p13-crm-browser";
const environmentName = "test";
const owner = Object.freeze({ kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 });
const stageNamespace = Buffer.from("13f5fa89b4655a7aa19d74ed6c5d1ef4", "hex");
function opaqueStageId(pipelineId, semantic) {
  const bytes = Buffer.from(createHash("sha1").update(stageNamespace).update(Buffer.from(["phase13/pipeline-stage/v1", applicationId, environmentName, String(pipelineId), semantic].join("\0"))).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128; const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const crmProductContract = Object.freeze(JSON.parse(readFileSync(resolve(repositoryRoot, "contracts/phase-13-crm-product-contract.v1.json"), "utf8")));

function canonicalPersona(personaId) {
  const scope = crmProductContract.personas.find((candidate) => candidate.id === personaId);
  const grant = crmProductContract.permissions.personaGrants.find((candidate) => candidate.personaId === personaId);
  assert.ok(scope, `CRM contract omits persona ${personaId}.`);
  assert.ok(grant, `CRM contract omits persona grants ${personaId}.`);
  assert.equal(grant.recordScope, scope.recordScope, `CRM contract scope mismatch for ${personaId}.`);
  return Object.freeze({ id: personaId, recordScope: scope.recordScope, mutationScope: scope.mutationScope, permissionIds: Object.freeze([...grant.permissionIds]) });
}

const canonicalPersonas = Object.freeze({
  manager: canonicalPersona("sales.manager"),
  representative: canonicalPersona("sales.representative"),
  viewer: canonicalPersona("sales.viewer-auditor")
});

function run(command, arguments_, options) {
  return execFileSync(command, arguments_, { ...options, encoding: "utf8", timeout: 240_000 });
}

function issueDoctorCredential(directory, uriSan) {
  const key = resolve(directory, "doctor-operator.key"); const certificate = resolve(directory, "doctor-operator.crt");
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=K-Nex P13 Doctor", "-addext", `subjectAltName=URI:${uriSan}`, "-keyout", key, "-out", certificate], { stdio: "pipe" });
  return { key, certificate };
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function startReferenceProvider() {
  const accepted = new Map();
  const server = createHttpServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/k-nex/reference-provider") { request.resume(); response.writeHead(404).end(); return; }
    const key = request.headers["idempotency-key"];
    const provider = request.headers["x-k-nex-provider"];
    if (typeof key !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(key) || (provider !== "email.reference.v1" && provider !== "calendar.reference.v1")) { request.resume(); response.writeHead(400).end(); return; }
    const chunks = []; let size = 0; let rejected = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) { rejected = true; request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      const digest = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
      const previous = accepted.get(key);
      if (previous !== undefined && previous !== `${provider}:${digest}`) { response.writeHead(409).end(); return; }
      accepted.set(key, `${provider}:${digest}`);
      response.writeHead(202).end();
    });
  });
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return Object.freeze({ endpoint: `http://127.0.0.1:${address.port}/k-nex/reference-provider`, server });
}

async function until(check, failure, child) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${failure}\nprocess exited ${child.exitCode}`);
    const result = await check().catch(() => undefined);
    if (result) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(failure);
}

async function stop(child, name, output, diagnose) {
  if (child === undefined) return;
  let exit = child.exitCode === null && child.signalCode === null ? undefined : { code: child.exitCode, signal: child.signalCode };
  let diagnostic = "";
  if (exit === undefined) {
    const closed = new Promise((resolveClose) => child.once("close", (code, signal) => resolveClose({ code, signal })));
    let diagnosticTimer;
    let diagnosticStarted = false;
    let resolveDiagnostic;
    const diagnosticResult = diagnose === undefined ? undefined : new Promise((resolveResult) => { resolveDiagnostic = resolveResult; });
    const captureDiagnostic = () => {
      if (diagnosticStarted || diagnose === undefined) return;
      diagnosticStarted = true;
      void diagnose().then(
        (snapshot) => resolveDiagnostic({ snapshot }),
        (error) => resolveDiagnostic({ snapshot: { diagnostic: "failed", error: error instanceof Error ? error.name : typeof error } })
      );
    };
    if (diagnose !== undefined) diagnosticTimer = setTimeout(captureDiagnostic, 25_000);
    const waitForClose = async (timeoutMs) => {
      let timer;
      try { return await Promise.race([closed, new Promise((resolveWait) => { timer = setTimeout(() => resolveWait(undefined), timeoutMs); })]); }
      finally { clearTimeout(timer); }
    };
    child.kill("SIGTERM");
    exit = await waitForClose(40_000);
    clearTimeout(diagnosticTimer);
    const failedExit = exit === undefined || exit.code !== 0 || exit.signal !== null;
    if (failedExit) captureDiagnostic();
    diagnostic = failedExit && diagnosticResult !== undefined ? `\npg_stat_activity=${JSON.stringify((await diagnosticResult).snapshot)}` : "";
    if (exit === undefined) {
      child.kill("SIGKILL");
      const killed = await waitForClose(5_000);
      throw new Error(`${name} ${killed === undefined ? "did not stop after SIGKILL" : "required SIGKILL after its shutdown deadline"}.${diagnostic}\n${output()}`);
    }
  }
  if ((exit.code !== 0 || exit.signal !== null) && diagnostic === "" && diagnose !== undefined) {
    diagnostic = await diagnose().then(
      (snapshot) => `\npg_stat_activity=${JSON.stringify(snapshot)}`,
      (error) => `\npg_stat_activity=${JSON.stringify({ diagnostic: "failed", error: error instanceof Error ? error.name : typeof error })}`
    );
  }
  assert.deepEqual(exit, { code: 0, signal: null }, `${name} did not exit cleanly.${diagnostic}\n${output()}`);
}

async function login(origin, email, password) {
  const response = await fetch(`${origin}/api/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return { userId: String((await response.json()).user.id), cookie };
}

async function createUser(origin, cookie, email, password) {
  const response = await fetch(`${origin}/api/users`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 201, await response.clone().text());
  return String((await response.json()).doc.id);
}

async function grantPersonas(pool, ids) {
  const accepted = new Set(Object.values(ids));
  const store = new PostgresAuthorizationStore(pool, { validate: (candidate, subject) => candidate === applicationId && subject.kind === "user" && accepted.has(subject.id) ? "accepted" : "rejected" });
  const state = await store.readState(applicationId, environmentName);
  assert.ok(state);
  const roles = [
    ["p13.crm.manager", ids.manager, canonicalPersonas.manager.permissionIds],
    ["p13.crm.representative", ids.representative, canonicalPersonas.representative.permissionIds],
    ["p13.crm.viewer", ids.viewer, canonicalPersonas.viewer.permissionIds],
    // Candidate/linker model narrow capability admissions, never a canonical persona.
    ["p13.crm.candidate", ids.candidate, ["sales.accounts.read", "sales.accounts.write"]],
    ["p13.crm.linker", ids.linker, ["sales.leads.read", "sales.leads.write", "sales.leads.qualify", "sales.accounts.read", "sales.contacts.read", "sales.opportunities.write", "sales.pipelines.read"]]
  ];
  await store.transaction({ applicationId, environment: environmentName, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision }, async (transaction) => {
    for (const [roleId, principalId, permissions] of roles) {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: roleId, label: roleId, revision: 0 } });
      for (const permissionId of permissions) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `${roleId}.${permissionId}`, roleId, permissionId, owner, revision: 0 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: `${roleId}.assignment`, roleId, principal: { kind: "user", id: principalId }, state: "active", revision: 0 } });
    }
  });
  await pool.query("update sales_current_authority_scopes set record_scope='application-sales-scope',application_wide=true,mutation_allowed=true,authorized_team_ids='[]'::jsonb,state='active' where application_id=$1 and environment=$2 and principal_id=$3", [applicationId, environmentName, ids.owner]);
  const writeScope = async (principalId, persona, applicationWide, mutationAllowed, teamIds) => {
    assert.equal(mutationAllowed, persona.mutationScope !== "none", `Fixture mutation scope diverges from ${persona.id}.`);
    await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,$2,$3,$4,$5,$6,$7::jsonb,'active',1)",
      [applicationId, environmentName, principalId, persona.recordScope, applicationWide, mutationAllowed, JSON.stringify(teamIds)]);
  };
  await writeScope(ids.manager, canonicalPersonas.manager, false, true, [`team:${ids.representative}`]);
  await writeScope(ids.representative, canonicalPersonas.representative, false, true, [`team:${ids.representative}`]);
  await writeScope(ids.viewer, canonicalPersonas.viewer, true, false, []);
  await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,$2,$3,'owned-or-assigned-team',false,true,$4::jsonb,'active',1)",
    [applicationId, environmentName, ids.candidate, JSON.stringify([`team:${ids.candidate}`])]);
  await pool.query("insert into sales_current_authority_scopes (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,$2,$3,'owned-or-assigned-team',false,true,$4::jsonb,'active',1)", [applicationId, environmentName, ids.linker, JSON.stringify([`team:${ids.owner}`])]);
}

function audit(actionId, resourceId, actorId, fromState, toState, revision, key, ownershipGenesis) {
  return { actionId, resourceId: String(resourceId), applicationId, environment: environmentName, fromState, toState, occurredAt: "2026-09-06T00:00:00.000Z", actorId, revision, idempotencyKey: key, ...(ownershipGenesis === undefined ? {} : { ownershipGenesis }) };
}

async function seedRecords(pool, ids) {
  const teamId = `team:${ids.owner}`;
  await pool.query("insert into k_nex_system_settings_state (application_id,environment,settings_revision) values ($1,$2,1) on conflict (application_id,environment) do update set settings_revision=greatest(k_nex_system_settings_state.settings_revision,1)", [applicationId, environmentName]);
  await pool.query("insert into k_nex_system_settings_documents (application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json) values ($1,$2,'system.general',3,'platform:system','platform','system',null,null,null,1,1,$3::jsonb)", [applicationId, environmentName, JSON.stringify({ reportingTimezone: "UTC", reportingCurrency: "USD" })]);
  const insertAccount = async (name, ownerId = ids.owner, team = teamId) => {
    const row = (await pool.query("insert into sales_accounts (application_id,environment,owner_id,team_id,created_by,updated_by,name) values ($1,$2,$3,$4,$3,$3,$5) returning id", [applicationId, environmentName, ownerId, team, name])).rows[0];
    await pool.query("update sales_accounts set audit=$2::jsonb where id=$1", [row.id, JSON.stringify([audit("sales.account.create", row.id, ownerId, "absent", "active", 1, `account-create-${row.id}`, { ownerId, teamId: team })])]);
    return String(row.id);
  };
  const accountId = await insertAccount("Browser account");
  const managerAccountId = await insertAccount("Manager account", ids.manager, `team:${ids.manager}`);
  const repAccountId = await insertAccount("Representative account", ids.representative, `team:${ids.representative}`);
  const page2AccountName = "P13 page 2 account 26";
  for (let index = 1; index <= 26; index += 1) await insertAccount(index === 26 ? page2AccountName : `P13 pagination account ${index}`);
  const pipeline = (await pool.query("insert into sales_pipelines (application_id,environment,created_by,updated_by,name,ordered_stage_ids,is_active) values ($1,$2,$3,$3,'Browser pipeline',$4::jsonb,true) returning id", [applicationId, environmentName, ids.owner, JSON.stringify(["qualification", "discovery", "proposal", "negotiation", "won", "lost"])])).rows[0];
  for (const [position, stageId] of ["qualification", "discovery", "proposal", "negotiation", "won", "lost"].entries()) {
    const opaqueId = opaqueStageId(pipeline.id, stageId);
    const allowed = stageId === "qualification" ? ["discovery", "lost"] : stageId === "discovery" ? ["proposal", "lost"] : stageId === "proposal" ? ["negotiation", "lost"] : stageId === "negotiation" ? ["won", "lost"] : [];
    await pool.query("insert into sales_pipeline_stages (application_id,environment,created_by,updated_by,pipeline_id,stage_id,name,semantic,position,probability_basis_points,allowed_transition_stage_ids,required_field_ids) values ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)", [applicationId, environmentName, ids.owner, pipeline.id, opaqueId, stageId[0].toUpperCase() + stageId.slice(1), stageId, position, stageId === "won" ? 10_000 : 0, JSON.stringify(allowed.map((semantic) => opaqueStageId(pipeline.id, semantic))), JSON.stringify(stageId === "lost" ? ["lossReason"] : [])]);
  }
  const pipelineIdentityAudit = [{ kind: "phase-13-pipeline-stage-identity", receiptDigest: `sha256:${"0".repeat(64)}`, sourceRevision: 0, targetRevision: 1 }];
  await pool.query("update sales_pipelines set ordered_stage_ids=$2::jsonb,audit=$3::jsonb where id=$1", [pipeline.id, JSON.stringify(["qualification", "discovery", "proposal", "negotiation", "won", "lost"].map((semantic) => opaqueStageId(pipeline.id, semantic))), JSON.stringify(pipelineIdentityAudit)]);
  await pool.query("update sales_pipeline_stages set audit=$2::jsonb where pipeline_id=$1", [pipeline.id, JSON.stringify(pipelineIdentityAudit)]);
  assert.deepEqual((await pool.query("select revision,audit from sales_pipelines where id=$1", [pipeline.id])).rows, [{ revision: 1, audit: pipelineIdentityAudit }], "fixture pipeline must carry exact migration identity genesis");
  assert.equal((await pool.query("select count(*)::int count from sales_pipeline_stages where pipeline_id=$1 and revision=1 and audit=$2::jsonb", [pipeline.id, JSON.stringify(pipelineIdentityAudit)])).rows[0].count, 6, "fixture Stages must carry exact migration identity genesis");
  const kanbanDefinition = { kind: "kanban", targetObjectId: "sales.object.opportunity", source: { id: "sales.saved-view.kanban", version: 1, sourceSchema: { id: "sales.saved-view.kanban.output", version: 1 }, structuralCompatibilityHash: "sha256:c54433c895722e63dd499720e37e8f2ae9b1390c28bab9f0c5111c4f7ea1233a" }, fields: ["row-kind", "name", "stage-id", "stage-metadata", "revision"], filters: [], sorts: [], grouping: "stage-id", presentation: { density: "comfortable" }, pageSize: 25 };
  const teamKanbanView = (await pool.query("insert into sales_saved_views (application_id,environment,owner_id,created_by,updated_by,name,visibility,visibility_team_id,view_kind,target_object_id,definition) values ($1,$2,$3,$3,$3,'Team opportunity Kanban','team',$4,'kanban','sales.object.opportunity',$5::jsonb) returning id", [applicationId, environmentName, ids.owner, teamId, JSON.stringify(kanbanDefinition)])).rows[0];
  await pool.query("update sales_saved_views set audit=$2::jsonb where id=$1", [teamKanbanView.id, JSON.stringify([audit("sales.saved-view.create", teamKanbanView.id, ids.owner, "absent", "active", 1, `saved-view-create-${teamKanbanView.id}`, { ownerId: ids.owner, teamId })])]);
  const kanbanView = (await pool.query("insert into sales_saved_views (application_id,environment,owner_id,created_by,updated_by,name,visibility,visibility_team_id,view_kind,target_object_id,definition) values ($1,$2,$3,$3,$3,'Browser opportunity Kanban','personal',null,'kanban','sales.object.opportunity',$4::jsonb) returning id", [applicationId, environmentName, ids.owner, JSON.stringify(kanbanDefinition)])).rows[0];
  await pool.query("update sales_saved_views set audit=$2::jsonb where id=$1", [kanbanView.id, JSON.stringify([audit("sales.saved-view.create", kanbanView.id, ids.owner, "absent", "active", 1, `saved-view-create-${kanbanView.id}`, { ownerId: ids.owner, teamId: null })])]);
  const contactPhone = "+15550100001";
  const contact = (await pool.query("insert into sales_contacts (application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name,email,phone) values ($1,$2,$3,$4,$3,$3,$5,'Browser contact seed','owner-contact-secret@example.test',$6) returning id", [applicationId, environmentName, ids.owner, teamId, accountId, contactPhone])).rows[0];
  await pool.query("update sales_contacts set audit=$2::jsonb where id=$1", [contact.id, JSON.stringify([audit("sales.contact.create", contact.id, ids.owner, "absent", "active", 1, `contact-create-${contact.id}`, { ownerId: ids.owner, teamId })])]);
  const managerTeamId = `team:${ids.manager}`;
  const managerContact = (await pool.query("insert into sales_contacts (application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name,email,phone) values ($1,$2,$3,$4,$3,$3,$5,'Manager browser contact','manager-contact-secret@example.test','+15550100003') returning id", [applicationId, environmentName, ids.manager, managerTeamId, managerAccountId])).rows[0];
  await pool.query("update sales_contacts set audit=$2::jsonb where id=$1", [managerContact.id, JSON.stringify([audit("sales.contact.create", managerContact.id, ids.manager, "absent", "active", 1, `contact-create-${managerContact.id}`, { ownerId: ids.manager, teamId: managerTeamId })])]);
  const representativeTeamId = `team:${ids.representative}`;
  const representativeContact = (await pool.query("insert into sales_contacts (application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name,email,phone) values ($1,$2,$3,$4,$3,$3,$5,'Representative browser contact','representative-contact-secret@example.test','+15550100004') returning id", [applicationId, environmentName, ids.representative, representativeTeamId, repAccountId])).rows[0];
  await pool.query("update sales_contacts set audit=$2::jsonb where id=$1", [representativeContact.id, JSON.stringify([audit("sales.contact.create", representativeContact.id, ids.representative, "absent", "active", 1, `contact-create-${representativeContact.id}`, { ownerId: ids.representative, teamId: representativeTeamId })])]);
  const leadIds = [];
  const leadPhone = "+15550100002";
  for (const [name, email, phone] of [["Qualify lead", "qualify-secret@example.test", leadPhone], ["Archive lead", "archive-secret@example.test", leadPhone], ["Linker qualify lead", "linker-qualify-secret@example.test", leadPhone]]) {
    const lead = (await pool.query("insert into sales_leads (application_id,environment,owner_id,team_id,created_by,updated_by,display_name,source,email,phone) values ($1,$2,$3,$4,$3,$3,$5,'browser',$6,$7) returning id", [applicationId, environmentName, ids.owner, teamId, name, email, phone])).rows[0];
    await pool.query("update sales_leads set audit=$2::jsonb where id=$1", [lead.id, JSON.stringify([audit("sales.lead.create", lead.id, ids.owner, "absent", "new", 1, `lead-create-${lead.id}`, { ownerId: ids.owner, teamId })])]);
    leadIds.push(String(lead.id));
  }
  const insertOpportunity = async (name, stageId, amount, { ownerId = ids.owner, team = teamId, account = accountId, primaryContactId = null } = {}) => {
    const stageSemantic = stageId; stageId = /^[a-z]+$/u.test(stageId) ? opaqueStageId(pipeline.id, stageId) : stageId;
    const opportunity = (await pool.query("insert into sales_opportunities (application_id,environment,owner_id,team_id,created_by,updated_by,name,account_id,pipeline_id,stage_id,amount,currency,primary_contact_id) values ($1,$2,$3,$4,$3,$3,$5,$6,$7,$8,$9,'USD',$10) returning id", [applicationId, environmentName, ownerId, team, name, account, pipeline.id, stageId, amount, primaryContactId])).rows[0];
    const history = [audit("sales.opportunity.create", opportunity.id, ownerId, "absent", opaqueStageId(pipeline.id, "qualification"), 1, `opportunity-create-${opportunity.id}`, { ownerId, teamId: team })];
    for (const [index, [from, to]] of [["qualification", "discovery"], ["discovery", "proposal"], ["proposal", "negotiation"]].entries()) {
      if (["qualification", "discovery", "proposal", "negotiation"].indexOf(stageSemantic) <= index) break;
      history.push(audit("sales.opportunity.stage.update", opportunity.id, ownerId, opaqueStageId(pipeline.id, from), opaqueStageId(pipeline.id, to), index + 2, `opportunity-stage-${opportunity.id}-${index + 2}`));
    }
    await pool.query("update sales_opportunities set revision=$2,audit=$3::jsonb where id=$1", [opportunity.id, history.length, JSON.stringify(history)]);
    return String(opportunity.id);
  };
  const opportunityWinId = await insertOpportunity("Browser win", "negotiation", "98765.43");
  const opportunityLossId = await insertOpportunity("Browser loss", "qualification", "98765.43");
  const opportunityArchiveId = await insertOpportunity("Browser archive", "qualification", "98765.43");
  const managerOpportunityAmount = "54321.00";
  const managerOpportunityId = await insertOpportunity("Manager amount opportunity", "qualification", managerOpportunityAmount, { ownerId: ids.manager, team: managerTeamId, account: managerAccountId, primaryContactId: managerContact.id });
  const repOpportunityAmount = "12345.67";
  const repOpportunityId = await insertOpportunity("Representative amount opportunity", "qualification", repOpportunityAmount, { ownerId: ids.representative, team: representativeTeamId, account: repAccountId, primaryContactId: representativeContact.id });
  const insertActivity = async (subject) => {
    const activity = (await pool.query("insert into sales_activities (application_id,environment,owner_id,team_id,created_by,updated_by,type,subject,actor_id,scheduled_at,related_record_id,related_record_type) values ($1,$2,$3,$4,$3,$3,'call',$5,$3,'2026-09-12T10:00:00.000Z',$6,'sales.account') returning id", [applicationId, environmentName, ids.owner, teamId, subject, accountId])).rows[0];
    await pool.query("update sales_activities set audit=$2::jsonb where id=$1", [activity.id, JSON.stringify([audit("sales.activity.create", activity.id, ids.owner, "absent", "scheduled", 1, `activity-create-${activity.id}`, { ownerId: ids.owner, teamId })])]);
    return String(activity.id);
  };
  const activityId = await insertActivity("Complete browser activity");
  const activityCancelId = await insertActivity("Cancel browser activity");
  const noteBody = "private generated browser note";
  const note = (await pool.query("insert into sales_notes (application_id,environment,owner_id,team_id,created_by,updated_by,body,author_id,occurred_at,related_record_id,related_record_type) values ($1,$2,$3,$4,$3,$3,$5,$3,'2026-09-10T00:00:00.000Z',$6,'sales.account') returning id", [applicationId, environmentName, ids.owner, teamId, noteBody, accountId])).rows[0];
  await pool.query("update sales_notes set audit=$2::jsonb where id=$1", [note.id, JSON.stringify([audit("sales.note.create", note.id, ids.owner, "absent", "recorded", 1, `note-create-${note.id}`, { ownerId: ids.owner, teamId })])]);
  const page2TimelineBody = "P13 timeline page 26";
  for (let index = 1; index <= 26; index += 1) {
    const body = index === 26 ? page2TimelineBody : `P13 pagination timeline ${index}`;
    const occurredAt = `2026-08-${String(27 - index).padStart(2, "0")}T00:00:00.000Z`;
    const row = (await pool.query("insert into sales_notes (application_id,environment,owner_id,team_id,created_by,updated_by,body,author_id,occurred_at,related_record_id,related_record_type) values ($1,$2,$3,$4,$3,$3,$5,$3,$6,$7,'sales.account') returning id", [applicationId, environmentName, ids.owner, teamId, body, occurredAt, accountId])).rows[0];
    await pool.query("update sales_notes set audit=$2::jsonb where id=$1", [row.id, JSON.stringify([audit("sales.note.create", row.id, ids.owner, "absent", "recorded", 1, `note-create-${row.id}`, { ownerId: ids.owner, teamId })])]);
  }
  const attachment = (await pool.query("insert into sales_attachment_references (application_id,environment,owner_id,team_id,created_by,updated_by,storage_reference,filename,media_type,byte_size,uploader_id,related_record_id,related_record_type) values ($1,$2,$3,$4,$3,$3,'browser/object','browser.txt','text/plain',7,$3,$5,'sales.account') returning id", [applicationId, environmentName, ids.owner, teamId, accountId])).rows[0];
  await pool.query("update sales_attachment_references set audit=$2::jsonb where id=$1", [attachment.id, JSON.stringify([audit("sales.attachment.link", attachment.id, ids.owner, "absent", "active", 1, `attachment-link-${attachment.id}`, { ownerId: ids.owner, teamId })])]);
  return { accountId, managerAccountId, managerOpportunityId, managerOpportunityAmount, managerOpportunityCurrency: "USD", repAccountId, representativeActorId: ids.representative, repOpportunityId, repOpportunityAmount, repOpportunityCurrency: "USD", page2AccountName, page2TimelineBody, candidateOwnerId: ids.candidate, pipelineId: String(pipeline.id), contactId: String(contact.id), contactEmail: "owner-contact-secret@example.test", contactPhone, leadQualifyId: leadIds[0], leadArchiveId: leadIds[1], linkerLeadId: leadIds[2], leadEmail: "archive-secret@example.test", leadPhone, opportunityWinId, opportunityLossId, opportunityArchiveId, amount: "98765.43", activityId, activityCancelId, attachmentId: String(attachment.id), noteBody };
}

export async function withGeneratedCrmBrowserFixture(runBrowser) {
  const stage = (value) => process.stdout.write(`P13_3_CRM_FIXTURE_STAGE ${value}\n`);
  stage("container-start");
  const container = await new PostgreSqlContainer(image).withDatabase("p13_crm_browser").withStartupTimeout(120_000).start();
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "p13-crm-browser-")));
  const administrator = new pg.Pool({ connectionString: container.getConnectionUri() });
  let pool;
  let child;
  let worker;
  let referenceProvider;
  const closedWorkers = new WeakSet();
  let output = "";
  let workerOutput = "";
  let applicationBackendSnapshot;
  let primaryFailure;
  const applicationDatabase = { name: "p13_crm_browser_application" };
  try {
    const mirror = resolve(directory, "mirror"); mkdirSync(mirror);
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8"));
    for (const entry of manifest.packages) copyFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/packages", `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`), resolve(mirror, `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`));
    for (const lock of Object.values(manifest.factoryLockTemplates)) copyFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/packages", `factory-lock-sales-reference-${lock.theme}-${lock.digest.slice(7)}.yaml`), resolve(mirror, `factory-lock-sales-reference-${lock.theme}-${lock.digest.slice(7)}.yaml`));
    manifest.release.version = "1.0.0-p13.3.browser"; manifest.supportWindow.supportedReleases = [manifest.release.version];
    for (const [name, source] of [["@k-nex/contracts", "packages/contracts"], ["@k-nex/composition", "packages/composition"], ["@k-nex/runtime", "packages/runtime"], ["@k-nex/payload-adapter", "packages/payload-adapter"], ["@k-nex/ui-runtime", "packages/ui-runtime"], ["@k-nex/module-sales", "modules/sales"], ["@k-nex/provider-realtime-socketio", "packages/realtime-socketio"]]) {
      run("pnpm", ["build"], { cwd: resolve(repositoryRoot, source), stdio: "pipe" });
      run("pnpm", ["pack", "--pack-destination", mirror], { cwd: resolve(repositoryRoot, source), stdio: "pipe" });
      const entry = manifest.packages.find((candidate) => candidate.package === name); assert.ok(entry);
      entry.integrity = `sha512-${createHash("sha512").update(readFileSync(resolve(mirror, `${name.slice(1).replace("/", "-")}-1.0.0.tgz`))).digest("base64")}`;
    }
    const consumer = resolve(directory, "consumer"); mkdirSync(consumer);
    writeFileSync(resolve(consumer, "package.json"), JSON.stringify({ name: "p13-crm-browser-consumer", private: true, type: "module", dependencies: { "@k-nex/composition": `file:${resolve(mirror, "k-nex-composition-1.0.0.tgz")}`, "@k-nex/contracts": `file:${resolve(mirror, "k-nex-contracts-1.0.0.tgz")}` } }));
    writeFileSync(resolve(consumer, "pnpm-workspace.yaml"), `packages:\n  - "."\n\noverrides:\n  "@k-nex/contracts": "file:${resolve(mirror, "k-nex-contracts-1.0.0.tgz")}"\n`);
    run("pnpm", ["install", "--ignore-scripts"], { cwd: consumer, stdio: "pipe" });
    const factory = await import(pathToFileURL(resolve(consumer, "node_modules/@k-nex/composition/dist/index.js")));
    const verifier = createFixtureDeploymentVerifier("b".repeat(40));
    const provisional = await verifier.verifyManifest(manifest);
    for (const theme of ["minimal", "neobrutalism"]) {
      const lockApp = resolve(directory, `lock-${theme}`);
      factory.applyCreateKnexApplication(factory.planCreateKnexApplication({ applicationId: `p13-crm-lock-${theme}`, applicationName: "P13 CRM lock", theme, database: "external", primaryCurrency: "USD", packageSource: { kind: "packed-mirror", directory: mirror, authority: verifier.packageReleaseAuthority, release: provisional } }), lockApp);
      run("pnpm", ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"], { cwd: lockApp, stdio: "pipe" });
      const lock = readFileSync(resolve(lockApp, "pnpm-lock.yaml")); const digest = `sha256:${createHash("sha256").update(lock).digest("hex")}`;
      writeFileSync(resolve(mirror, `factory-lock-sales-reference-${theme}-${digest.slice(7)}.yaml`), lock); manifest.factoryLockTemplates[theme].digest = digest;
    }
    const release = await verifier.verifyManifest(manifest);
    const application = resolve(directory, "application");
    factory.applyCreateKnexApplication(factory.planCreateKnexApplication({ applicationId, applicationName: "P13 CRM Browser", theme: "minimal", database: "external", primaryCurrency: "USD", packageSource: { kind: "packed-mirror", directory: mirror, authority: verifier.packageReleaseAuthority, release } }), application);
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: application, stdio: "pipe" });
    const applicationRequire = createRequire(resolve(application, "package.json"));
    const payloadPostgresEntry = applicationRequire.resolve("@payloadcms/db-postgres");
    const payloadPostgresConnect = readFileSync(resolve(dirname(payloadPostgresEntry), "connect.js"), "utf8");
    assert.ok(payloadPostgresConnect.includes("result.release();"), "Generated application omitted the required Payload Postgres reconnect release repair.");
    await administrator.query(`create database ${applicationDatabase.name}`);
    const databaseUrl = new URL(container.getConnectionUri()); databaseUrl.pathname = `/${applicationDatabase.name}`;
    const port = await unusedPort(); const operatorPort = await unusedPort();
    referenceProvider = await startReferenceProvider();
    const operatorUriSan = `spiffe://k-nex.test/applications/${applicationId}/environments/${environmentName}/administration`; const operatorCredential = issueDoctorCredential(directory, operatorUriSan);
    const staticSourceCommit = "a".repeat(40); const staticApplicationDigest = `sha256:${"b".repeat(64)}`;
    const environment = { ...process.env, DATABASE_URL: databaseUrl.toString(), K_NEX_ENVIRONMENT: environmentName, K_NEX_GENERATION: "sales-generation-1", K_NEX_SOURCE_COMMIT: staticSourceCommit, K_NEX_APPLICATION_DIGEST: staticApplicationDigest, K_NEX_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, PAYLOAD_SECRET: randomBytes(32).toString("hex"), K_NEX_PROVIDER_SECRET_EMAIL_REFERENCE: "p136-fixture-email-provider-secret", K_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE: "p136-fixture-calendar-provider-secret", K_NEX_REFERENCE_PROVIDER_ENDPOINT: referenceProvider.endpoint, K_NEX_ADMINISTRATION_OPERATOR_HOST: "127.0.0.1", K_NEX_ADMINISTRATION_OPERATOR_PORT: String(operatorPort), K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT: operatorCredential.certificate, K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY: operatorCredential.key, K_NEX_ADMINISTRATION_OPERATOR_CA_CERT: operatorCredential.certificate, K_NEX_ADMINISTRATION_OPERATOR_URI_SAN: operatorUriSan, K_NEX_ADMINISTRATION_OPERATOR_IDENTITY: "fixture.p13-doctor" };
    const origin = `http://127.0.0.1:${port}`;
    applicationBackendSnapshot = async () => {
      const result = await administrator.query({
        text: "select state, coalesce(wait_event_type,'none') as wait_event_type, count(*)::int as count from pg_stat_activity where datname=$1 group by state, wait_event_type order by state, wait_event_type",
        values: [applicationDatabase.name], query_timeout: 2_000
      });
      return result.rows.map((row) => Object.freeze({ state: String(row.state), waitEventType: String(row.wait_event_type), count: Number(row.count) }));
    };
    const startWeb = async () => {
      assert.equal(child, undefined, "Generated CRM web host is already running.");
      output = "";
      // package.json's production start contract is this exact compiled host.
      // Starting it directly keeps the test-owned child observable: pnpm's
      // launcher can absorb SIGTERM while leaving the host alive.
      child = spawn(process.execPath, ["dist/k-nex-web.js"], {
        cwd: application,
        env: { ...environment, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; }); child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      await until(async () => (await fetch(`${origin}/api/health`)).ok, `Generated CRM application did not start.\n${output}`, child);
    };
    const stopWeb = async () => { await stop(child, "Generated CRM web host", () => output, applicationBackendSnapshot); child = undefined; };
    stage("generated-build");
    run("pnpm", ["knex:migrate"], { cwd: application, env: environment, stdio: "pipe" });
    run("pnpm", ["build"], { cwd: application, env: environment, stdio: "pipe" });
    stage("generated-build-complete");
    const ownerEmail = "owner@p13-browser.example.test"; const password = "p13-browser-password-123";
    const tokenFile = resolve(directory, "owner.token");
    run("pnpm", ["knex:issue-bootstrap-token", "--output", tokenFile], { cwd: application, env: environment, stdio: "pipe" });
    run("pnpm", ["knex:bootstrap-owner", "--token-file", tokenFile], { cwd: application, env: { ...environment, K_NEX_OWNER_EMAIL: ownerEmail, K_NEX_OWNER_PASSWORD: password }, stdio: "pipe" });
    await startWeb();
    stage("bootstrap-web-ready");
    const ownerLogin = await login(origin, ownerEmail, password);
    const personas = { owner: { email: ownerEmail, password }, manager: { email: "manager@p13-browser.example.test", password }, representative: { email: "representative@p13-browser.example.test", password }, viewer: { email: "viewer@p13-browser.example.test", password }, linker: { email: "linker@p13-browser.example.test", password } };
    const ids = { owner: ownerLogin.userId };
    ids.manager = await createUser(origin, ownerLogin.cookie, personas.manager.email, password);
    ids.representative = await createUser(origin, ownerLogin.cookie, personas.representative.email, password);
    ids.viewer = await createUser(origin, ownerLogin.cookie, personas.viewer.email, password);
    ids.candidate = await createUser(origin, ownerLogin.cookie, "candidate@p13-browser.example.test", password);
    ids.linker = await createUser(origin, ownerLogin.cookie, personas.linker.email, password);
    pool = new pg.Pool({ connectionString: databaseUrl.toString() });
    // Generated product workers bind data movement to the same durable deployment
    // fence as release-worker ownership; a bare test worker is never active by default.
    await pool.query(
      `insert into runtime_static_deployments(application_id,environment,revision,active_generation_id,active_generation,rollback_window,state_digest)
       values($1,$2,1,'sales-generation-1','{"generationId":"sales-generation-1"}'::jsonb,'{"state":"open"}'::jsonb,$3)`,
      [applicationId, environmentName, `sha256:${createHash("sha256").update("p13-crm-browser-static-generation-1").digest("hex")}`]
    );
    await pool.query(
      `insert into runtime_extensions(application_id,environment,delivery_class,extension_id,revision,disposition,active_generation_id,active_generation,state_digest)
       values($1,$2,'platform-plugin','module.sales',1,'active','sales-generation-1',$3::jsonb,$4)`,
      [applicationId, environmentName, JSON.stringify({ authority: "static-build", generationId: "sales-generation-1", sourceCommit: staticSourceCommit, applicationDigest: staticApplicationDigest }), `sha256:${createHash("sha256").update("p13-crm-browser-runtime-sales-generation-1").digest("hex")}`]
    );
    await pool.query(
      `insert into runtime_worker_generation_fences(application_id,environment,active_execution_generation,fencing_token,lease_owner,lease_expires_at,promotion_revision)
       values($1,$2,'sales-generation-1',1,'fixture:p13-crm-browser:worker',now()+interval '10 minutes',1)`,
      [applicationId, environmentName]
    );
    await grantPersonas(pool, ids);
    const records = await seedRecords(pool, ids);
    stage("records-seeded");
    await stopWeb();
    await startWeb();
    stage("browser-web-ready");
    const startWorker = async (executionGeneration = environment.K_NEX_GENERATION) => {
      assert.equal(worker, undefined, "Generated CRM realtime worker is already running.");
      assert.match(executionGeneration, /^[a-z][a-z0-9-]{2,127}$/u);
      const outputStart = workerOutput.length;
      worker = spawn(process.execPath, ["dist/k-nex-worker.js"], { cwd: application, env: { ...environment, K_NEX_GENERATION: executionGeneration }, stdio: ["ignore", "pipe", "pipe"] });
      const startedWorker = worker;
      startedWorker.once("close", () => closedWorkers.add(startedWorker));
      worker.stdout.setEncoding("utf8").on("data", (chunk) => { workerOutput += chunk; }); worker.stderr.setEncoding("utf8").on("data", (chunk) => { workerOutput += chunk; });
      await until(async () => workerOutput.slice(outputStart).includes("K_NEX_WORKER_READY"), `Generated CRM realtime worker did not start.\n${workerOutput.slice(outputStart)}`, worker);
    };
    const stopWorker = async () => { await stop(worker, "Generated CRM worker", () => workerOutput); worker = undefined; };
    const restoreToCleanDatabase = async () => {
      assert.equal(child, undefined, "Physical restore requires the generated CRM web host to be stopped.");
      assert.equal(worker, undefined, "Physical restore requires the generated CRM worker to be stopped.");
      const sourceDatabase = applicationDatabase.name;
      const restoredDatabase = `p13_crm_browser_restore_${Date.now().toString(36)}`;
      const backupPath = `/tmp/${restoredDatabase}.backup`;
      const user = container.getUsername();
      const dump = await container.exec(["pg_dump", "-U", user, "-Fc", "-f", backupPath, sourceDatabase]);
      assert.equal(dump.exitCode, 0, dump.stderr);
      const create = await container.exec(["createdb", "-U", user, restoredDatabase]);
      assert.equal(create.exitCode, 0, create.stderr);
      const restore = await container.exec(["pg_restore", "-U", user, "-d", restoredDatabase, "--exit-on-error", backupPath]);
      assert.equal(restore.exitCode, 0, restore.stderr);
      if (pool !== undefined) await pool.end();
      applicationDatabase.name = restoredDatabase;
      databaseUrl.pathname = `/${restoredDatabase}`;
      environment.DATABASE_URL = databaseUrl.toString();
      pool = new pg.Pool({ connectionString: databaseUrl.toString() });
      return pool;
    };
    const acknowledgeAbnormalWorkerExit = (closedWorker) => {
      assert.equal(worker, closedWorker, "Only the current generated CRM worker exit may be acknowledged.");
      assert.equal(closedWorkers.has(closedWorker), true, "Generated CRM worker close must be observed before acknowledging its abnormal exit.");
      assert.deepEqual({ code: closedWorker.exitCode, signal: closedWorker.signalCode }, { code: 1, signal: null }, "Only an exact expected abnormal generated CRM worker exit may be acknowledged.");
      worker = undefined;
    };
    const issueAttachmentUploadReceipt = ({ storageRef, uploaderActorId, filename, mediaType, byteSize, revision = 1 }) => {
      assert.equal(typeof storageRef, "string"); assert.equal(typeof uploaderActorId, "string");
      assert.equal(typeof filename, "string"); assert.equal(typeof mediaType, "string");
      assert.ok(Number.isSafeInteger(byteSize)); assert.ok(Number.isSafeInteger(revision));
      return run("pnpm", ["knex:issue-attachment-upload-receipt", "--storage-ref", storageRef, "--uploader-actor-id", uploaderActorId,
        "--filename", filename, "--media-type", mediaType, "--byte-size", String(byteSize), "--revision", String(revision)], { cwd: application, env: environment, stdio: "pipe" });
    };
    await startWorker();
    stage("worker-ready");
    stage("browser-callback-start");
    const runDoctor = () => run("pnpm", ["knex:doctor"], { cwd: application, env: environment, stdio: "pipe" });
    await runBrowser({ application, origin, personas, records, pool, connectionString: databaseUrl.toString(), applicationOutput: () => output, workerOutput: () => workerOutput, workerProcess: () => worker, startWorker, stopWorker, acknowledgeAbnormalWorkerExit, startWeb, stopWeb, restoreToCleanDatabase, issueAttachmentUploadReceipt, runDoctor });
    stage("browser-callback-complete");
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    const cleanup = async (operation) => { try { await operation(); } catch (error) { cleanupFailures.push(error); } };
    const assertExited = (process, name) => {
      if (process !== undefined && process.exitCode === null && process.signalCode === null) throw new Error(`${name} did not exit.`);
    };
    stage("cleanup-start");
    await cleanup(async () => { await stop(worker, "Generated CRM worker", () => workerOutput); assertExited(worker, "Generated CRM worker"); });
    stage("worker-stopped");
    await cleanup(async () => { await stop(child, "Generated CRM web host", () => output, applicationBackendSnapshot); assertExited(child, "Generated CRM web host"); });
    stage("web-stopped");
    await cleanup(async () => {
      if (referenceProvider === undefined) return;
      referenceProvider.server.closeAllConnections();
      await new Promise((resolveClose, reject) => referenceProvider.server.close((error) => error ? reject(error) : resolveClose()));
    });
    await cleanup(async () => { if (pool !== undefined) await pool.end(); });
    await cleanup(async () => {
      const active = await administrator.query("select count(*)::int as count from pg_stat_activity where datname=$1", [applicationDatabase.name]);
      assert.equal(active.rows[0]?.count, 0, "Generated CRM fixture retained an application PostgreSQL backend.");
    });
    await cleanup(async () => administrator.end());
    await cleanup(async () => container.stop());
    stage("container-stopped");
    await cleanup(async () => { rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); assert.equal(existsSync(directory), false, "Generated CRM fixture temporary root remains."); });
    stage("cleanup-complete");
    if (cleanupFailures.length > 0) {
      const format = (error) => error instanceof Error ? error.stack ?? error.message : String(error);
      const cleanupDetail = cleanupFailures.map((error, index) => `Cleanup ${index + 1}: ${format(error)}`).join("\n");
      if (primaryFailure !== undefined) throw new AggregateError([primaryFailure, ...cleanupFailures], `Generated CRM fixture callback and cleanup failed.\nPrimary: ${format(primaryFailure)}\n${cleanupDetail}`);
      throw new AggregateError(cleanupFailures, `Generated CRM fixture cleanup failed.\n${cleanupDetail}`);
    }
  }
}
