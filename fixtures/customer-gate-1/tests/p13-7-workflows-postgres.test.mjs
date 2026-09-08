import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import pg from "pg";
import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up } from "../dist/src/migrations/20260908_000033_crm_workflows.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const app = "p13-workflows"; const environment = "production";
const fence = Object.freeze({ applicationId: app, environment, activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "worker-1", promotionRevision: 1 });
async function database(run) {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_workflows").start(); const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query("create table sales_notifications(id bigserial primary key,application_id text,environment text,recipient_id text,subject text,reference_kind text,reference_id text,state text,revision integer,metadata jsonb,audit jsonb,delivered_at timestamptz,read_at timestamptz,archived_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()); create table k_nex_outbox(id bigserial primary key,event_id varchar(128) unique,event_type varchar(128),schema_version integer,message_class varchar(32),occurred_at timestamptz,application_id varchar(128),plugin_id varchar(128),actor_id varchar(128),actor_type varchar(64),correlation_id varchar(128),causation_id varchar(128),idempotency_key varchar(128),payload jsonb,status varchar(32),retention_until timestamptz); create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment)); create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer); create table sales_current_authority_scopes(application_id text,environment text,principal_id text,state text,revision integer,mutation_allowed boolean default true,record_scope text default 'application',application_wide boolean default true,authorized_team_ids jsonb default '[]'::jsonb)");
    await up({ db: drizzle(pool) });
    await pool.query("create table sales_pipeline_stages(id bigserial primary key,application_id text,environment text,pipeline_id integer,stage_id text,status text,semantic text); create table sales_opportunities(id integer primary key,application_id text,environment text,revision integer,team_id text,pipeline_id integer,stage_id text,archive_status text,owner_id text); create table sales_leads(id integer primary key,application_id text,environment text,revision integer,owner_id text,archive_status text); create table sales_activities(id integer primary key,application_id text,environment text,revision integer,status text,actor_id text,scheduled_at timestamptz); create table sales_tasks(id bigserial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer,audit jsonb,due_date date,title text,status text,archive_status text,related_record_id text,related_record_type text); create table sales_reminders(id bigserial primary key,application_id text,environment text,recipient_id text,reference_kind text,reference_id text,subject text,scheduled_at timestamptz,state text,revision integer,attempt integer,idempotency_digest text unique,audit jsonb,created_at timestamptz default now(),updated_at timestamptz default now())");
    await run(pool);
  } finally { await pool.end(); await container.stop(); }
}
function payload(workflowId, effectKind, targetId, extra = {}) { return { applicationId: app, environment, workflowId, workflowVersion: 1, effectKind, targetId, acceptedRevision: 1, originalActorId: "actor-a", acceptedOwnerId: "owner-a", recipientId: "owner-a", authRevision: 1, lifecycleRevision: 1, scopeRevision: 1, acceptedAt: "2026-09-08T00:00:00.000Z", ...extra }; }
function digest(value) { return "sha256:" + createHash("sha256").update(canonicalJson(value)).digest("hex"); }
async function event(pool, eventId, eventType, value) { await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,idempotency_key,payload,status,retention_until) values($1,$2,1,'durable-workflow',now(),$3,'module.sales','actor-a','user',$1,$1,$4::jsonb,'pending',now()+interval '1 day')", [eventId,eventType,app,JSON.stringify(value)]); }
function transitionId(executionId, revision) { return "sales-workflow-execution-" + digest({ executionId:String(executionId),revision }).slice(7); }
function transitionEvidence(row, fromState, toState, revision, attempt, occurredAt, failureCode = null) {
  const idempotencyKey = `sales-workflow-execution-${row.id}-${revision}`;
  return { actionId:"sales.job.crm-workflow-execution",resourceId:String(row.id),applicationId:String(row.application_id),environment:String(row.environment),workflowId:String(row.workflow_id),effectKind:String(row.effect_kind),targetRecordId:String(row.target_record_id),sourceEventId:String(row.source_event_id),payloadDigest:String(row.payload_digest),effectKey:String(row.effect_key),fromState,toState,occurredAt,actorId:String(row.actor_id),revision,attempt,idempotencyKey,...(failureCode === null ? {} : { failureCode }) };
}
async function seedCanonicalExpiredThirdClaim(pool, row) {
  const history = [
    ["queued","running",2,1,"2026-09-08T00:00:01.000Z",null],
    ["running","queued",3,1,"2026-09-08T00:00:02.000Z","WORKFLOW_EFFECT_FAILED"],
    ["queued","running",4,2,"2026-09-08T00:00:03.000Z",null],
    ["running","queued",5,2,"2026-09-08T00:00:04.000Z","WORKFLOW_EFFECT_FAILED"],
    ["queued","running",6,3,"2026-09-08T00:00:05.000Z",null]
  ].map(([fromState,toState,revision,attempt,occurredAt,failureCode]) => transitionEvidence(row,fromState,toState,revision,attempt,occurredAt,failureCode));
  await pool.query("update sales_workflow_executions set state='running',attempt=3,next_attempt_at=now(),worker_generation_id=$2,worker_fencing_token=1,worker_promotion_revision=1,worker_lease_owner='crashed-worker',lease_revision=3,lease_expires_at=now()-interval '1 second',failure_code=null,terminal_at=null,revision=6,audit=$3::jsonb,updated_at=now() where id=$1", [row.id,fence.activeExecutionGeneration,JSON.stringify([...(row.audit ?? []),...history])]);
  for (const item of history) {
    await pool.query("insert into sales_workflow_execution_audit(application_id,environment,execution_id,revision,from_state,to_state,action_id,evidence,digest,occurred_at) values($1,$2,$3,$4,$5,$6,'sales.job.crm-workflow-execution',$7::jsonb,$8,$9::timestamptz)", [app,environment,row.id,item.revision,item.fromState,item.toState,JSON.stringify(item),digest(item),item.occurredAt]);
    const id = transitionId(row.id,item.revision);
    const payload = { actionId:"sales.job.crm-workflow-execution",resourceId:String(row.id),applicationId:app,environment,workflowId:row.workflow_id,effectKind:row.effect_kind,sourceEventId:row.source_event_id,payloadDigest:row.payload_digest,effectKey:row.effect_key,state:item.toState,revision:item.revision,idempotencyKey:item.idempotencyKey,...(item.failureCode === undefined ? {} : { failureCode:item.failureCode }) };
    const retentionUntil = new Date(Date.parse(item.occurredAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
    await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values($1,'sales.event.workflow-execution-changed',1,'durable-integration',$2::timestamptz,$3,'module.sales',$4,'system',$5,$6,$1,$7::jsonb,'pending',$8::timestamptz)", [id,item.occurredAt,app,row.actor_id,String(row.id),row.source_event_id,JSON.stringify(payload),retentionUntil]);
  }
}

test("P13.7 ingests only its closed dedicated durable-workflow catalog without touching generic outbox delivery", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await event(pool,"wf-opportunity","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","11"));
    await event(pool,"wf-lead","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","12"));
    await event(pool,"wf-activity","sales.event.workflow.activity-scheduled",payload("sales.workflow.scheduled-activity-reminder","schedule-reminder","13",{ scheduledAt: "2026-09-08T01:00:00.000Z",recipientId:"actor-a" }));
    await event(pool,"wf-generic","sales.event.lead-changed",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","14"));
    await event(pool,"wf-poison","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","15",{ code: "forbidden" }));
    await event(pool,"wf-reminder-recipient-poison","sales.event.workflow.activity-scheduled",payload("sales.workflow.scheduled-activity-reminder","schedule-reminder","16",{ scheduledAt:"2026-09-08T01:00:00.000Z",recipientId:"third-party" }));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),3);
    assert.deepEqual((await pool.query("select workflow_id,effect_kind,target_record_id,state,attempt from sales_workflow_executions order by workflow_id")).rows,[
      { workflow_id:"sales.workflow.lead-owner-assigned-notification",effect_kind:"notification",target_record_id:"12",state:"queued",attempt:0 },
      { workflow_id:"sales.workflow.opportunity-proposal-follow-up",effect_kind:"task",target_record_id:"11",state:"queued",attempt:0 },
      { workflow_id:"sales.workflow.scheduled-activity-reminder",effect_kind:"reminder",target_record_id:"13",state:"queued",attempt:0 }
    ]);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_id in ('wf-opportunity','wf-lead','wf-activity','wf-generic','wf-poison') and status='pending'")).rows[0].count),5,"workflow ingestion never claims or mutates source outbox delivery state");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.workflow-execution-changed' and status='pending'")).rows[0].count),3,"each accepted execution records one durable execution transition");
    assert.deepEqual((await pool.query("select source_event_id,state,failure_code from sales_workflow_trigger_receipts where source_event_id='wf-reminder-recipient-poison'")).rows,[{source_event_id:"wf-reminder-recipient-poison",state:"rejected",failure_code:"WORKFLOW_PAYLOAD_INVALID"}],"reminder recipient must be accepted actor or owner; malformed source is isolated");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_executions where source_event_id='wf-reminder-recipient-poison'")).rows[0].count),0);
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),0,"replay is unique by application/environment/source event");
  });
});

test("P13.7 exact rules produce one task, fixed notice, and clamped reminder", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into k_nex_authorization_state values($1,1,1)", [app]);
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'actor-a','active',1,true,'application',true,'[]'::jsonb)", [app,environment]);
    await pool.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,status,semantic) values($1,$2,101,'proposal','active','proposal')", [app,environment]);
    await pool.query("insert into sales_opportunities values(31,$1,$2,1,'team-a',101,'proposal','active','owner-a')", [app,environment]);
    await pool.query("insert into sales_leads values(32,$1,$2,1,'owner-a','active')", [app,environment]);
    await pool.query("insert into sales_activities values(33,$1,$2,1,'scheduled','actor-a','2026-09-08T01:00:00.000Z')", [app,environment]);
    await event(pool,"wf-effect-task","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","31"));
    await event(pool,"wf-effect-notice","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","32"));
    await event(pool,"wf-effect-reminder","sales.event.workflow.activity-scheduled",payload("sales.workflow.scheduled-activity-reminder","schedule-reminder","33",{ scheduledAt:"2026-09-08T01:00:00.000Z",recipientId:"actor-a" }));
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),3);
    assert.equal(Number((await pool.query("select count(*) count from sales_tasks where related_record_type='sales.opportunity' and related_record_id='31'")).rows[0].count),1);
    assert.deepEqual((await pool.query("select recipient_id,subject,reference_kind,reference_id from sales_notifications where reference_id='32'")).rows,[{recipient_id:"owner-a",subject:"Lead assigned to you; open Lead only after current authorization recheck",reference_kind:"lead",reference_id:"32"}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_reminders where reference_kind='activity' and reference_id='33'")).rows[0].count),1);
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_execution_audit")).rows[0].count)>=3,true,"terminal effects retain immutable execution audit");
  });
});

test("P13.7 concurrent worker ingestion is application/environment isolated and idempotent", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await event(pool,"wf-concurrent","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","21"));
    await event(pool,"wf-other-environment","sales.event.workflow.opportunity-proposal-entered",{ ...payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","22"), environment:"staging" });
    const results = await Promise.all([ingestGeneratedSalesWorkflowTriggers(pool,fence),ingestGeneratedSalesWorkflowTriggers(pool,fence)]);
    assert.equal(results.reduce((total,value) => total + value,0),1,"two workers cannot duplicate a trigger execution");
    assert.deepEqual((await pool.query("select source_event_id,application_id,environment,state from sales_workflow_executions")).rows,[{ source_event_id:"wf-concurrent",application_id:app,environment,state:"queued" }]);
  });
});

test("P13.7 terminal authority and lifecycle denials create zero effects; system effects survive actor auth revoke", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into k_nex_authorization_state values($1,2,2)", [app]);
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'actor-a','active',2,true,'application',true,'[]'::jsonb)", [app,environment]);
    await pool.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,status,semantic) values($1,$2,201,'proposal','active','proposal')", [app,environment]);
    await pool.query("insert into sales_opportunities values(41,$1,$2,2,'team-a',201,'proposal','active','owner-b'),(46,$1,$2,1,'team-a',201,'proposal','active','owner-a'),(47,$1,$2,2,'team-a',201,'proposal','active','owner-b')", [app,environment]);
    await pool.query("insert into sales_leads values(42,$1,$2,2,'owner-b','active'),(44,$1,$2,1,'owner-a','active')", [app,environment]);
    await pool.query("insert into sales_activities values(43,$1,$2,2,'completed','actor-a','2026-09-08T01:00:00.000Z'),(45,$1,$2,1,'scheduled','actor-a','2026-09-08T01:00:00.000Z')", [app,environment]);
    await event(pool,"wf-deny-task","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","41"));
    await event(pool,"wf-deny-scope","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","46",{ authRevision:2,lifecycleRevision:2 }));
    await event(pool,"wf-deny-target","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","47",{ authRevision:2,lifecycleRevision:2,scopeRevision:2 }));
    await event(pool,"wf-deny-lead","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","42"));
    await event(pool,"wf-deny-activity","sales.event.workflow.activity-scheduled",payload("sales.workflow.scheduled-activity-reminder","schedule-reminder","43",{ scheduledAt:"2026-09-08T01:00:00.000Z",recipientId:"actor-a" }));
    await event(pool,"wf-system-lead","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","44"));
    await event(pool,"wf-system-activity","sales.event.workflow.activity-scheduled",payload("sales.workflow.scheduled-activity-reminder","schedule-reminder","45",{ scheduledAt:"2026-09-08T01:00:00.000Z",recipientId:"actor-a" }));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),7);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),7);
    assert.equal(Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),0);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='42'")).rows[0].count),0);
    assert.equal(Number((await pool.query("select count(*) count from sales_reminders where reference_id='43'")).rows[0].count),0);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='44'")).rows[0].count),1,"notification uses accepted target facts, not revoked actor authority");
    assert.equal(Number((await pool.query("select count(*) count from sales_reminders where reference_id='45'")).rows[0].count),1,"reminder uses accepted target facts, not revoked actor authority");
    assert.deepEqual((await pool.query("select source_event_id,state,failure_code,attempt from sales_workflow_executions where source_event_id like 'wf-deny-%' order by source_event_id")).rows,[
      { source_event_id:"wf-deny-activity",state:"dead-letter",failure_code:"WORKFLOW_TARGET_MISSING",attempt:1 },
      { source_event_id:"wf-deny-lead",state:"dead-letter",failure_code:"WORKFLOW_TARGET_MISSING",attempt:1 },
      { source_event_id:"wf-deny-scope",state:"dead-letter",failure_code:"WORKFLOW_SCOPE_RECHECK_FAILED",attempt:1 },
      { source_event_id:"wf-deny-target",state:"dead-letter",failure_code:"WORKFLOW_TARGET_MISSING",attempt:1 },
      { source_event_id:"wf-deny-task",state:"dead-letter",failure_code:"WORKFLOW_AUTH_RECHECK_FAILED",attempt:1 }
    ]);
  });
});

test("P13.7 retries transient effect failure at 15/30 seconds then dead-letters third attempt", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into k_nex_authorization_state values($1,1,1)", [app]);
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'actor-a','active',1,true,'application',true,'[]'::jsonb)", [app,environment]);
    await pool.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,status,semantic) values($1,$2,301,'proposal','active','proposal')", [app,environment]);
    await pool.query("insert into sales_opportunities values(51,$1,$2,1,'team-a',301,'proposal','active','owner-a')", [app,environment]);
    await pool.query("create function p137_fail_task() returns trigger language plpgsql as $$ begin raise exception 'forced transient'; end $$; create trigger p137_fail_task before insert on sales_tasks for each row execute function p137_fail_task()");
    await event(pool,"wf-retry","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","51"));
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1);
    assert.deepEqual((await pool.query("select state,attempt,failure_code,round(extract(epoch from next_attempt_at-updated_at)) delay from sales_workflow_executions where source_event_id='wf-retry'")).rows,[{state:"queued",attempt:1,failure_code:"WORKFLOW_EFFECT_FAILED",delay:"15"}]);
    await pool.query("update sales_workflow_executions set next_attempt_at=now() where source_event_id='wf-retry'");
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1);
    assert.deepEqual((await pool.query("select state,attempt,failure_code,round(extract(epoch from next_attempt_at-updated_at)) delay from sales_workflow_executions where source_event_id='wf-retry'")).rows,[{state:"queued",attempt:2,failure_code:"WORKFLOW_EFFECT_FAILED",delay:"30"}]);
    await pool.query("update sales_workflow_executions set next_attempt_at=now() where source_event_id='wf-retry'");
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1);
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_workflow_executions where source_event_id='wf-retry'")).rows,[{state:"dead-letter",attempt:3,failure_code:"WORKFLOW_RETRY_EXHAUSTED"}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),0);
  });
});

test("P13.7 expired crashed third claim restart dead-letters once with canonical audit/outbox and zero effect", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into k_nex_authorization_state values($1,1,1)", [app]);
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'actor-a','active',1,true,'application',true,'[]'::jsonb)", [app,environment]);
    await pool.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,status,semantic) values($1,$2,351,'proposal','active','proposal')", [app,environment]);
    await pool.query("insert into sales_opportunities values(52,$1,$2,1,'team-a',351,'proposal','active','owner-a')", [app,environment]);
    await pool.query("create function p137_crash_third() returns trigger language plpgsql as $$ begin raise exception 'crashed effect'; end $$; create trigger p137_crash_third before insert on sales_tasks for each row execute function p137_crash_third()");
    await event(pool,"wf-crash-third","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","52"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    await pool.query("update sales_workflow_executions set state='running',attempt=2,worker_generation_id=$2,worker_fencing_token=1,worker_promotion_revision=1,worker_lease_owner='crashed-worker',lease_revision=1,lease_expires_at=now()-interval '1 second' where source_event_id=$1", ["wf-crash-third",fence.activeExecutionGeneration]);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1);
    assert.deepEqual((await pool.query("select state,attempt,failure_code,revision,jsonb_array_length(audit) audit_length from sales_workflow_executions where source_event_id='wf-crash-third'")).rows,[{state:"dead-letter",attempt:3,failure_code:"WORKFLOW_RETRY_EXHAUSTED",revision:3,audit_length:3}]);
    assert.deepEqual((await pool.query("select revision,from_state,to_state,action_id from sales_workflow_execution_audit order by revision")).rows,[
      {revision:1,from_state:"absent",to_state:"queued",action_id:"sales.job.crm-workflow-execution"},
      {revision:2,from_state:"running",to_state:"running",action_id:"sales.job.crm-workflow-execution"},
      {revision:3,from_state:"running",to_state:"dead-letter",action_id:"sales.job.crm-workflow-execution"}
    ]);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.workflow-execution-changed'")).rows[0].count),3,"one event per canonical transition; no retry duplicate");
    assert.equal(Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),0,"crashed third claim commits no effect");
  });
});

test("P13.7 canonical expired running third claim terminalizes running-to-dead-letter without effect", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await event(pool,"wf-canonical-expired-third","sales.event.workflow.opportunity-proposal-entered",payload("sales.workflow.opportunity-proposal-follow-up","create-owner-follow-up-task","53"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    const row = (await pool.query("select * from sales_workflow_executions where source_event_id='wf-canonical-expired-third'")).rows[0];
    await seedCanonicalExpiredThirdClaim(pool,row);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),0,"exhausted crash terminalizes before a new claim/effect");
    assert.deepEqual((await pool.query("select state,attempt,failure_code,revision,jsonb_array_length(audit) audit_length from sales_workflow_executions where id=$1", [row.id])).rows,[{state:"dead-letter",attempt:3,failure_code:"WORKFLOW_RETRY_EXHAUSTED",revision:7,audit_length:7}]);
    assert.deepEqual((await pool.query("select revision,from_state,to_state from sales_workflow_execution_audit where execution_id=$1 order by revision desc limit 1", [row.id])).rows,[{revision:7,from_state:"running",to_state:"dead-letter"}]);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.workflow-execution-changed' and correlation_id=$1", [String(row.id)])).rows[0].count),7,"canonical history plus exactly one terminal event");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_effect_receipts where execution_id=$1", [row.id])).rows[0].count),0);
    assert.equal(Number((await pool.query("select count(*) count from sales_tasks")).rows[0].count),0);
  });
});

test("P13.7 actor-type mutation after accepted source isolates to canonical conflict terminalization", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await event(pool,"wf-actor-type-tamper","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","83"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    await pool.query("update k_nex_outbox set actor_type='system' where event_id='wf-actor-type-tamper'");
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),0,"corrupt accepted source cannot abort unrelated worker loop");
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_workflow_executions where source_event_id='wf-actor-type-tamper'")).rows,[{state:"dead-letter",attempt:1,failure_code:"WORKFLOW_IDEMPOTENCY_CONFLICT"}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_executions where source_event_id='wf-actor-type-tamper'")).rows[0].count),1,"tamper cannot create another execution");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_effect_receipts")).rows[0].count),0);
    assert.deepEqual((await pool.query("select from_state,to_state from sales_workflow_execution_audit where execution_id=(select id from sales_workflow_executions where source_event_id='wf-actor-type-tamper') order by revision")).rows,[
      {from_state:"absent",to_state:"queued"}, {from_state:"queued",to_state:"running"}, {from_state:"running",to_state:"dead-letter"}
    ]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count),0);
  });
});

test("P13.7 sixteen poisoned transition envelopes terminalize boundedly; later healthy work progresses", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into sales_leads(id,application_id,environment,revision,owner_id,archive_status) select i,$1,$2,1,'owner-a','active' from generate_series(101,117) i", [app,environment]);
    for (let id = 101; id <= 116; id += 1) await event(pool,`wf-envelope-poison-${id}`,"sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner",String(id)));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),16);
    const poisoned = (await pool.query("select * from sales_workflow_executions where source_event_id like 'wf-envelope-poison-%' order by id")).rows;
    assert.equal(poisoned.length,16);
    for (const row of poisoned) {
      const revision = 2; const idempotencyKey = `sales-workflow-execution-${row.id}-${revision}`;
      const forgedPayload = { actionId:"sales.job.crm-workflow-execution",resourceId:String(row.id),applicationId:app,environment,workflowId:row.workflow_id,effectKind:row.effect_kind,sourceEventId:row.source_event_id,payloadDigest:row.payload_digest,effectKey:row.effect_key,state:"running",revision,idempotencyKey };
      await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values($1,'sales.event.workflow-execution-changed',1,'durable-integration',now(),$2,'module.sales',$3,'user',$4,$5,$6,$7::jsonb,'pending',now()+interval '1 day')", [transitionId(row.id,revision),app,row.actor_id,String(row.id),row.source_event_id,transitionId(row.id,revision),JSON.stringify(forgedPayload)]);
    }
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),0,"forged envelopes never claim/effect");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_executions where source_event_id like 'wf-envelope-poison-%' and state='dead-letter' and failure_code='WORKFLOW_IDEMPOTENCY_CONFLICT'")).rows[0].count),16,"every poisoned execution has bounded terminal outcome");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_execution_audit where to_state='dead-letter' and evidence->>'failureCode'='WORKFLOW_IDEMPOTENCY_CONFLICT'")).rows[0].count),16,"each terminal collision is immutable audited evidence");
    assert.equal(Number((await pool.query("select count(*) count from (select execution_id,array_agg(from_state||'>'||to_state order by revision) path from sales_workflow_execution_audit where execution_id=any($1::bigint[]) group by execution_id) history where path=array['absent>queued','queued>running','running>dead-letter']", [poisoned.map((row) => row.id)])).rows[0].count),16,"each poison records canonical claim then canonical conflict terminal transition");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where correlation_id=any($1::text[]) and actor_type='system' and payload->>'state'='running'", [poisoned.map((row) => String(row.id))])).rows[0].count),16);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where correlation_id=any($1::text[]) and actor_type='system' and payload->>'state'='dead-letter' and payload->>'failureCode'='WORKFLOW_IDEMPOTENCY_CONFLICT'", [poisoned.map((row) => String(row.id))])).rows[0].count),16);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_id=any($1::text[]) and actor_type='system'", [poisoned.map((row) => transitionId(row.id,2))])).rows[0].count),0,"forged exact transition ids remain unaccepted user envelopes");
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count),0);
    await event(pool,"wf-envelope-healthy-after-poison","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","117"));
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1,"poisoned batch cannot starve later healthy source");
    assert.deepEqual((await pool.query("select state,failure_code from sales_workflow_executions where source_event_id='wf-envelope-healthy-after-poison'")).rows,[{state:"succeeded",failure_code:null}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='117'")).rows[0].count),1);
  });
});

test("P13.7 sixteen corrupted accepted sources outside newest-16 terminalize at claim while healthy later source runs", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into sales_leads(id,application_id,environment,revision,owner_id,archive_status) select i,$1,$2,1,'owner-a','active' from generate_series(201,217) i", [app,environment]);
    for (let id = 201; id <= 217; id += 1) await event(pool,`wf-source-poison-${id}`,"sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner",String(id)));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),16);
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    const poisonIds = Array.from({length:16},(_, index) => `wf-source-poison-${201 + index}`);
    await pool.query("update k_nex_outbox set actor_type='system' where event_id=any($1::text[])", [poisonIds]);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),0,"claim-time source revalidation isolates all corrupted accepted receipts, including oldest outside old newest-16 scan");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_executions where source_event_id=any($1::text[]) and state='dead-letter' and failure_code='WORKFLOW_IDEMPOTENCY_CONFLICT'", [poisonIds])).rows[0].count),16);
    assert.equal(Number((await pool.query("select count(*) count from (select execution_id,array_agg(from_state||'>'||to_state order by revision) path from sales_workflow_execution_audit where execution_id in (select id from sales_workflow_executions where source_event_id=any($1::text[])) group by execution_id) history where path=array['absent>queued','queued>running','running>dead-letter']", [poisonIds])).rows[0].count),16,"each corrupted source gets both canonical claim and conflict-terminal audit transitions");
    const poisonedExecutionIds = (await pool.query("select id from sales_workflow_executions where source_event_id=any($1::text[])", [poisonIds])).rows.map((row) => String(row.id));
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where correlation_id=any($1::text[]) and actor_type='system' and payload->>'state'='running'", [poisonedExecutionIds])).rows[0].count),16);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where correlation_id=any($1::text[]) and actor_type='system' and payload->>'state'='dead-letter' and payload->>'failureCode'='WORKFLOW_IDEMPOTENCY_CONFLICT'", [poisonedExecutionIds])).rows[0].count),16);
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_effect_receipts where execution_id=any($1::bigint[])", [poisonedExecutionIds])).rows[0].count),0);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id=any($1::text[])", [Array.from({length:16},(_, index) => String(201 + index))])).rows[0].count),0);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1,"healthy source survives 16 corrupt accepted receipts");
    assert.deepEqual((await pool.query("select state,failure_code from sales_workflow_executions where source_event_id='wf-source-poison-217'")).rows,[{state:"succeeded",failure_code:null}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='217'")).rows[0].count),1);
  });
});

test("P13.7 effect receipt evidence rejects UPDATE and DELETE", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await event(pool,"wf-receipt-immutable","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","81"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    const row = (await pool.query("select * from sales_workflow_executions where source_event_id='wf-receipt-immutable'")).rows[0];
    await pool.query("insert into sales_workflow_effect_receipts(effect_key,execution_id,application_id,environment,effect_kind,target_object_type,target_record_id,recipient_id) values($1,$2,$3,$4,$5,$6,$7,$8)", [row.effect_key,row.id,app,environment,row.effect_kind,row.target_object_type,row.target_record_id,row.recipient_id]);
    await assert.rejects(pool.query("update sales_workflow_effect_receipts set recipient_id='forged' where effect_key=$1", [row.effect_key]), (error) => error?.code === "55000");
    await assert.rejects(pool.query("delete from sales_workflow_effect_receipts where effect_key=$1", [row.effect_key]), (error) => error?.code === "55000");
  });
});

test("P13.7 execution storage rejects WORKFLOW_PAYLOAD_INVALID failure code", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await event(pool,"wf-failure-code","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","82"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    const row = (await pool.query("select id from sales_workflow_executions where source_event_id='wf-failure-code'")).rows[0];
    await assert.rejects(pool.query("update sales_workflow_executions set failure_code='WORKFLOW_PAYLOAD_INVALID' where id=$1", [row.id]), (error) => error?.code === "23514");
  });
});

test("P13.7 wrong immutable envelope for same transition id/payload is isolated while batch peer succeeds", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into sales_leads values(91,$1,$2,1,'owner-a','active'),(92,$1,$2,1,'owner-a','active')", [app,environment]);
    await event(pool,"wf-envelope-bad","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","91"));
    await event(pool,"wf-envelope-peer","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","92"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),2);
    const bad = (await pool.query("select * from sales_workflow_executions where source_event_id='wf-envelope-bad'")).rows[0];
    const revision = 2; const idempotencyKey = `sales-workflow-execution-${bad.id}-${revision}`;
    const transitionPayload = { actionId:"sales.job.crm-workflow-execution",resourceId:String(bad.id),applicationId:app,environment,workflowId:bad.workflow_id,effectKind:bad.effect_kind,sourceEventId:bad.source_event_id,payloadDigest:bad.payload_digest,effectKey:bad.effect_key,state:"running",revision,idempotencyKey };
    const transitionId = "sales-workflow-execution-" + digest({ executionId:String(bad.id),revision }).slice(7);
    await pool.query("insert into k_nex_outbox(event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,retention_until) values($1,'sales.event.workflow-execution-changed',1,'durable-integration',now(),$2,'module.sales',$3,'user',$4,$5,$6,$7::jsonb,'pending',now()+interval '1 day')", [transitionId,app,bad.actor_id,String(bad.id),bad.source_event_id,idempotencyKey,JSON.stringify(transitionPayload)]);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1,"collision is isolated before claim; only healthy peer executes");
    assert.deepEqual((await pool.query("select source_event_id,state,failure_code from sales_workflow_executions order by source_event_id")).rows,[
      {source_event_id:"wf-envelope-bad",state:"dead-letter",failure_code:"WORKFLOW_IDEMPOTENCY_CONFLICT"},
      {source_event_id:"wf-envelope-peer",state:"succeeded",failure_code:null}
    ]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='91'")).rows[0].count),0,"wrong envelope cannot authorize bad effect");
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='92'")).rows[0].count),1,"peer remains healthy");
  });
});

test("P13.7 claim blocked by promotion leaves stale worker zero mutation; current generation recovers", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    const current = Object.freeze({ ...fence, activeExecutionGeneration:"sales-generation-2", fencingToken:2, leaseOwner:"worker-2", promotionRevision:2 });
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into sales_leads values(61,$1,$2,1,'owner-a','active')", [app,environment]);
    await event(pool,"wf-promote","sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner","61"));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),1);
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query("select 1 from runtime_worker_generation_fences where application_id=$1 and environment=$2 for update", [app,environment]);
    const stale = processGeneratedSalesWorkflows(pool,fence);
    await holder.query("update runtime_worker_generation_fences set active_execution_generation=$3,fencing_token=2,lease_owner='worker-2',promotion_revision=2 where application_id=$1 and environment=$2", [app,environment,current.activeExecutionGeneration]);
    await holder.query("commit"); holder.release();
    assert.equal(await stale,0);
    assert.deepEqual((await pool.query("select state,attempt from sales_workflow_executions where source_event_id='wf-promote'")).rows,[{state:"queued",attempt:0}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count),0);
    assert.equal(await processGeneratedSalesWorkflows(pool,current),1);
    assert.deepEqual((await pool.query("select state,attempt from sales_workflow_executions where source_event_id='wf-promote'")).rows,[{state:"succeeded",attempt:1}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_id='61'")).rows[0].count),1);
  });
});

test("P13.7 effect receipt collision rolls back domain effect; 16-item batch leaves independent work healthy", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { ingestGeneratedSalesWorkflowTriggers, processGeneratedSalesWorkflows } = await import("../dist/src/k-nex-sales-workflows.js");
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,'worker-1',now()+interval '1 hour',1)", [app,environment,fence.activeExecutionGeneration]);
    await pool.query("insert into sales_leads(id,application_id,environment,revision,owner_id,archive_status) select i,$1,$2,1,'owner-a','active' from generate_series(71,87) i", [app,environment]);
    for (let id = 71; id <= 87; id += 1) await event(pool,`wf-batch-${id}`,"sales.event.workflow.lead-owner-assigned",payload("sales.workflow.lead-owner-assigned-notification","notify-new-owner",String(id)));
    assert.equal(await ingestGeneratedSalesWorkflowTriggers(pool,fence),16);
    const collision = (await pool.query("select * from sales_workflow_executions where source_event_id='wf-batch-71'")).rows[0];
    await pool.query("insert into sales_workflow_effect_receipts(effect_key,execution_id,application_id,environment,effect_kind,target_object_type,target_record_id,recipient_id) values($1,$2,$3,$4,$5,$6,$7,$8)", [collision.effect_key,collision.id,app,environment,collision.effect_kind,collision.target_object_type,collision.target_record_id,collision.recipient_id]);
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),16,"batch is exact 16 and collision cannot poison peers");
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_workflow_executions where source_event_id='wf-batch-71'")).rows,[{state:"queued",attempt:1,failure_code:"WORKFLOW_IDEMPOTENCY_CONFLICT"}]);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count),15,"collision leaves its effect absent while independent batch effects commit");
    assert.equal(await processGeneratedSalesWorkflows(pool,fence),1,"immutable collision stays isolated while remaining source continues");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_executions")).rows[0].count),17);
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications")).rows[0].count),16);
    assert.deepEqual((await pool.query("select distinct event_type,message_class,plugin_id,actor_type from k_nex_outbox where event_type='sales.event.workflow-execution-changed'")).rows,[{event_type:"sales.event.workflow-execution-changed",message_class:"durable-integration",plugin_id:"module.sales",actor_type:"system"}],"execution events use non-trigger integration envelope");
    assert.equal(Number((await pool.query("select count(*) count from sales_workflow_trigger_receipts")).rows[0].count),17,"integration execution events never self-ingest or chain");
  });
});
