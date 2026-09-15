import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import { parseSalesImportCsv } from "@k-nex/module-sales-current/server";
import pg from "pg";
import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up as dataMovementUp } from "../dist/src/migrations/20260907_000031_data_movement.js";
import { up as communicationsUp } from "../dist/src/migrations/20260908_000032_communications.js";
import { up as reportsUp } from "../dist/src/migrations/20260908_000034_reports.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "p13-10-fixture";
const environment = "production";
const actorId = "fixture-manager";
const teamId = "team:fixture";
const generation = "p13-10-generation-1";
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonicalDigest = (value) => digest(canonicalJson(value));
const fence = Object.freeze({ applicationId, environment, activeExecutionGeneration: generation, fencingToken: 1, leaseOwner: "p13-10-worker", promotionRevision: 1 });
const reportGrants = Object.freeze([
  "sales.exports.execute", "sales.reports.read", "sales.reports.schedule", "sales.activities.read", "sales.leads.read",
  "sales.opportunities.read", "sales.opportunities.amount.read", "sales.pipelines.read", "sales.tasks.read"
]);
const reports = Object.freeze([
  ["pipeline", "sales.report.pipeline-value-by-stage", "as-of"],
  ["weighted", "sales.report.weighted-forecast", "as-of"],
  ["won-lost", "sales.report.won-lost-conversion", "current-reporting-week"],
  ["lead", "sales.report.lead-conversion", "current-reporting-week"],
  ["activity", "sales.report.activity-by-owner-team", "current-reporting-week"],
  ["aging", "sales.report.task-aging", "as-of"],
  ["cycle", "sales.report.sales-cycle-duration", "current-reporting-week"]
]);

function artifactValue(csv) {
  const line = csv.split("\r\n")[1] ?? "";
  const match = /^"([^"]*)","([^"]*)","((?:""|[^"])*)"$/u.exec(line);
  assert.ok(match, `invalid canonical report CSV row: ${line}`);
  return JSON.parse(match[3].replaceAll('""', '"'));
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function measure(samples, operation) {
  const timings = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await operation(index);
    timings.push(performance.now() - started);
  }
  return percentile95(timings);
}

function halfUpRationalToCents(numerator, denominator) {
  const quotient = numerator / denominator;
  return numerator % denominator * 2n >= denominator ? quotient + 1n : quotient;
}

function money(cents) {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

async function queueReport(pool, runId, reportId, windowMode) {
  await pool.query(`insert into sales_report_runs(run_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,requested_at,authorization_revision,lifecycle_revision,scope_revision,report_revision,report_digest,idempotency_key,state,revision,attempt,next_attempt_at,runtime_generation_id,report_permission_grants,object_permission_grants,field_permission_grants,audit)
    values($1,$2,$3,$4,$4,$5,$6,now(),1,0,1,1,$7,$8,'queued',1,0,now(),$9,$10::jsonb,$11::jsonb,$12::jsonb,'[]'::jsonb)`, [runId, applicationId, environment, actorId, reportId, windowMode, digest(runId), `p13-10-${runId}`, generation, JSON.stringify(["sales.exports.execute", "sales.reports.read"]), JSON.stringify(["sales.activities.read", "sales.leads.read", "sales.opportunities.read", "sales.pipelines.read", "sales.tasks.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
}

test("P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings", { timeout: 600_000 }, async (context) => {
  assert.equal(process.versions.node, "24.19.0", "fixture is frozen to Node 24.19.0");
  const container = await new PostgreSqlContainer(image).withDatabase("p13_10_fixture").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 });
  try {
    await pool.query(`
      create table payload_locked_documents_rels(id bigserial primary key);
      create table k_nex_outbox(id bigserial primary key,event_id text unique,event_type text,schema_version integer,message_class text,occurred_at timestamptz,application_id text,plugin_id text,actor_id text,actor_type text,correlation_id text,causation_id text,idempotency_key text,payload jsonb,status text,retention_until timestamptz);
      create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment));
      create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer);
      create table sales_current_authority_scopes(application_id text,environment text,principal_id text,revision integer,state text,record_scope text,application_wide boolean,mutation_allowed boolean,authorized_team_ids jsonb);
      create table users(id text primary key);
      create table k_nex_role_assignments(application_id text,role_id text,subject_kind text,subject_id text,state text);
      create table k_nex_role_permission_grants(application_id text,role_id text,permission_id text,owner_kind text,owner_delivery_class text,owner_extension_id text,owner_generation bigint,state text);
      create table k_nex_extension_authorization_generations(application_id text,delivery_class text,extension_id text,authorization_generation bigint,runtime_generation_ids jsonb,state text,authorization_revision integer,lifecycle_revision integer);
      create table k_nex_permission_catalog_snapshots(application_id text,snapshot_id text,source text,permission_json jsonb,state text,owner_kind text,owner_namespace text,owner_delivery_class text,owner_extension_id text,owner_generation bigint,revision integer);
      create table k_nex_system_settings_state(application_id text,environment text,settings_revision integer);
      create table k_nex_system_settings_documents(application_id text,environment text,descriptor_id text,owner_scope_key text,descriptor_schema_version integer,document_revision integer,settings_revision integer,values_json jsonb);
      create table sales_pipeline_stages(application_id text,environment text,pipeline_id integer,stage_id text,name text,semantic text,position integer,probability_basis_points integer);
      create table sales_accounts(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',status text default 'active',name text,merged_into_id text,merge_lineage jsonb,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_contacts(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',status text default 'active',account_id integer,display_name text,email text,phone text,merged_into_id text,merge_lineage jsonb,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_leads(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',status text default 'new',archive_status text default 'active',display_name text,source text,email text,phone text,qualified_account_id text,qualified_contact_id text,decided_at timestamptz,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_opportunities(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',archive_status text default 'active',status text default 'active',account_id text,primary_contact_id text,pipeline_id integer,stage_id text,amount text,currency text,closed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
      create table sales_activities(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,audit jsonb default '[]',status text,type text,subject text,actor_id text,scheduled_at timestamptz,occurred_at timestamptz,supersedes_activity_id integer,related_record_type text,related_record_id text,provider_metadata jsonb,revision integer default 1,updated_at timestamptz default now());
      create table sales_tasks(id serial primary key,application_id text,environment text,owner_id text,team_id text,status text,due_date date,related_record_type text,related_record_id text);
      create table sales_notes(id serial primary key,application_id text,environment text,related_record_type text,related_record_id text);
      create table sales_attachment_references(id serial primary key,application_id text,environment text,related_record_type text,related_record_id text);
    `);
    await pool.query("insert into k_nex_system_settings_state values($1,$2,1)", [applicationId, environment]);
    await pool.query("insert into k_nex_system_settings_documents values($1,$2,'system.general','platform:system',3,1,1,$3::jsonb)", [applicationId, environment, JSON.stringify({ reportingTimezone: "America/New_York", reportingCurrency: "USD" })]);
    await dataMovementUp({ db: drizzle(pool) });
    await communicationsUp({ db: drizzle(pool) });
    await reportsUp({ db: drizzle(pool) });
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,$4,now()+interval '1 hour',1)", [applicationId, environment, generation, fence.leaseOwner]);
    await pool.query("insert into k_nex_authorization_state values($1,1,0)", [applicationId]);
    await pool.query("insert into sales_current_authority_scopes values($1,$2,$3,1,'active','application-sales-scope',true,true,$4::jsonb)", [applicationId, environment, actorId, JSON.stringify([teamId])]);
    await pool.query("insert into users values($1)", [actorId]);
    await pool.query("insert into k_nex_role_assignments values($1,'fixture-manager-role','user',$2,'active')", [applicationId, actorId]);
    await pool.query("insert into k_nex_extension_authorization_generations values($1,'platform-plugin','module.sales',1,$2::jsonb,'current',1,0)", [applicationId, JSON.stringify([generation])]);
    await pool.query("insert into k_nex_role_permission_grants(application_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,state) select $1,'fixture-manager-role',permission_id,'extension','platform-plugin','module.sales',1,'active' from unnest($2::text[]) permission_id", [applicationId, reportGrants]);

    const week = (await pool.query("select (date_trunc('week',now() at time zone 'America/New_York') at time zone 'America/New_York') boundary,to_char((now() at time zone 'America/New_York')::date,'YYYY-MM-DD') today")).rows[0];
    const boundary = new Date(week.boundary);
    const insideWeek = new Date(boundary.getTime() + 30 * 60_000);
    const beforeWeek = new Date(boundary.getTime() - 30 * 60_000);
    const today = String(week.today);
    const stages = [
      { id: "qualification", name: "Qualification", semantic: "qualification", probability: 1000 },
      { id: "discovery", name: "Discovery", semantic: "discovery", probability: 3000 },
      { id: "proposal", name: "Proposal", semantic: "proposal", probability: 6000 },
      { id: "negotiation", name: "Negotiation", semantic: "negotiation", probability: 8000 },
      { id: "won", name: "Won", semantic: "won", probability: 10000 },
      { id: "lost", name: "Lost", semantic: "lost", probability: 0 }
    ];
    await pool.query("insert into sales_pipeline_stages select $1,$2,1,x.id,x.name,x.semantic,x.position,x.probability from jsonb_to_recordset($3::jsonb) x(id text,name text,semantic text,position integer,probability integer)", [applicationId, environment, JSON.stringify(stages.map((stage, index) => ({ ...stage, position: index + 1 })))]);
    await pool.query("insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name) select $1,$2,$3,$4,$3,$3,'Account '||n from generate_series(1,50) n", [applicationId, environment, actorId, teamId]);
    await pool.query("insert into sales_contacts(application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name,email) select $1,$2,$3,$4,$3,$3,((n-1)%50)+1,'Contact '||n,'contact-'||n||'@example.test' from generate_series(1,100) n", [applicationId, environment, actorId, teamId]);
    await pool.query("insert into sales_leads(application_id,environment,owner_id,team_id,created_by,updated_by,status,display_name,source,decided_at) select $1,$2,$3,$4,$3,$3,case when n<=50 then 'qualified' else 'disqualified' end,'Baseline Lead '||n,'fixture',$5 from generate_series(1,100) n", [applicationId, environment, actorId, teamId, insideWeek]);

    const opportunityRows = Array.from({ length: 50 }, (_, index) => {
      const stage = stages[index % stages.length];
      const closed = stage.semantic === "won" || stage.semantic === "lost";
      const durationDays = (index % 9) + 1;
      return { id: index + 1, stageId: stage.id, amount: `${100 + index * 4}.00`, closedAt: closed ? insideWeek.toISOString() : null, createdAt: new Date(insideWeek.getTime() - durationDays * 86_400_000).toISOString() };
    });
    await pool.query(`insert into sales_opportunities(id,application_id,environment,owner_id,team_id,created_by,updated_by,account_id,primary_contact_id,pipeline_id,stage_id,amount,currency,closed_at,created_at)
      select x.id,$1,$2,$3,$4,$3,$3,(((x.id-1)%50)+1)::text,(((x.id-1)%100)+1)::text,1,x."stageId",x.amount,'USD',x."closedAt",x."createdAt"
      from jsonb_to_recordset($5::jsonb) x(id integer,"stageId" text,amount text,"closedAt" timestamptz,"createdAt" timestamptz)`, [applicationId, environment, actorId, teamId, JSON.stringify(opportunityRows)]);
    await pool.query(`insert into sales_activities(id,application_id,environment,owner_id,team_id,created_by,updated_by,audit,status,type,subject,actor_id,scheduled_at,occurred_at,related_record_type,related_record_id)
      select n,$1,$2,$3,$4,$3,$3,'[]'::jsonb,'completed','meeting','Fixture activity '||n,$3,case when n=200 then $5::timestamptz else $6::timestamptz end,case when n=200 then $5::timestamptz else $6::timestamptz end,'sales.object.account',(((n-1)%50)+1)::text from generate_series(1,200) n`, [applicationId, environment, actorId, teamId, beforeWeek, insideWeek]);
    await pool.query(`insert into sales_tasks(id,application_id,environment,owner_id,team_id,status,due_date,related_record_type,related_record_id)
      select n,$1,$2,$3,$4,'open',case when n<=20 then $5::date+1 when n<=40 then $5::date when n<=60 then $5::date-3 when n<=80 then $5::date-12 else $5::date-40 end,'sales.object.account',(((n-1)%50)+1)::text from generate_series(1,100) n`, [applicationId, environment, actorId, teamId, today]);

    const baseline = (await pool.query(`select
      (select count(*)::integer from sales_leads where application_id=$1) leads,
      (select count(*)::integer from sales_accounts where application_id=$1) accounts,
      (select count(*)::integer from sales_contacts where application_id=$1) contacts,
      (select count(*)::integer from sales_opportunities where application_id=$1) opportunities,
      (select count(distinct stage_id)::integer from sales_opportunities where application_id=$1) represented_stages,
      (select jsonb_agg(distinct stage_id order by stage_id) from sales_opportunities where application_id=$1) stage_inventory,
      (select count(*)::integer from sales_activities where application_id=$1) activities,
      (select count(*)::integer from sales_tasks where application_id=$1) tasks`, [applicationId])).rows[0];
    assert.deepEqual(baseline, { leads: 100, accounts: 50, contacts: 100, opportunities: 50, represented_stages: 6, stage_inventory: ["discovery", "lost", "negotiation", "proposal", "qualification", "won"], activities: 200, tasks: 100 });

    const csv = Buffer.from(`Name,Source\r\n${Array.from({ length: 10_000 }, (_, index) => `Imported Lead ${index + 1},bounded-fixture`).join("\r\n")}\r\n`);
    const mapping = [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }];
    const parsed = parseSalesImportCsv(csv, "sales.object.lead", mapping);
    assert.deepEqual({ accepted: parsed.acceptedRows, rejected: parsed.rejectedRows, chunks: parsed.chunks.length }, { accepted: 10_000, rejected: 0, chunks: 40 });
    const rejected = parseSalesImportCsv(Buffer.from("Name,Source\r\nRejected,\r\n"), "sales.object.lead", mapping);
    assert.deepEqual(rejected.diagnostics, [{ oneBasedDataRow: 1, code: "IMPORT_REQUIRED_VALUE" }]);

    await pool.query("insert into sales_import_uploads(artifact_id,application_id,environment,actor_id,bytes,digest,byte_length,expires_at) values('p13-10-upload',$1,$2,$3,$4,$5,$6,now()+interval '30 days')", [applicationId, environment, actorId, csv, parsed.uploadDigest, csv.length]);
    const mappingDigest = canonicalDigest(mapping);
    const importJobId = (await pool.query(`insert into sales_import_jobs(application_id,environment,actor_id,target_object_type,upload_artifact_id,upload_digest,mapping_canonical_json,mapping_digest,schema_revision,authorization_revision,lifecycle_revision,scope_revision,permission_grants,state,revision,row_count,receipt_id,expires_at)
      values($1,$2,$3,'sales.object.lead','p13-10-upload',$4,$5::jsonb,$6,1,1,0,1,'["sales.imports.execute","sales.leads.write"]'::jsonb,'queued',1,10000,'p13-10-import-receipt',now()+interval '30 days') returning id`, [applicationId, environment, actorId, parsed.uploadDigest, JSON.stringify(mapping), mappingDigest])).rows[0].id;
    const durableRows = parsed.rows.map((row) => ({ number: row.oneBasedDataRow, rowDigest: row.rowDigest, values: row.values, mappedDigest: canonicalDigest(row.values) }));
    await pool.query(`insert into sales_import_rows(import_job_id,one_based_data_row,row_digest,canonical_mapped_json,mapped_digest)
      select $1,x.number,x."rowDigest",x.values,x."mappedDigest" from jsonb_to_recordset($2::jsonb) x(number integer,"rowDigest" text,values jsonb,"mappedDigest" text)`, [importJobId, JSON.stringify(durableRows)]);
    for (const chunk of parsed.chunks) {
      const identities = durableRows.slice(chunk.rowStart, chunk.rowEndExclusive).map((row) => ({ one_based_data_row: row.number, row_digest: row.rowDigest, mapped_digest: row.mappedDigest }));
      await pool.query("insert into sales_import_chunks(import_job_id,chunk_index,row_start,row_end_exclusive,input_digest) values($1,$2,$3,$4,$5)", [importJobId, chunk.chunkIndex, chunk.rowStart, chunk.rowEndExclusive, canonicalDigest(identities)]);
    }
    const { processSalesDataMovement } = await import("../dist/src/data-movement-host.js");
    await assert.rejects(() => processSalesDataMovement(pool, fence, { afterRowCommit(oneBasedRow) { if (oneBasedRow === 125) throw new Error("fixture-worker-restart"); } }), /fixture-worker-restart/u);
    assert.equal(Number((await pool.query("select count(*) count from sales_leads where source='bounded-fixture'")).rows[0].count), 125);
    await pool.query("update sales_import_chunks set lease_expires_at=now()-interval '1 second' where import_job_id=$1 and state='claimed'", [importJobId]);
    for (let iteration = 0; iteration < 42; iteration += 1) if (await processSalesDataMovement(pool, fence) === "idle") break;
    assert.deepEqual((await pool.query("select state,accepted_rows,rejected_rows from sales_import_jobs where id=$1", [importJobId])).rows, [{ state: "succeeded", accepted_rows: 10_000, rejected_rows: 0 }]);
    assert.equal(Number((await pool.query("select count(*) count from sales_leads where source='bounded-fixture'")).rows[0].count), 10_000);
    assert.equal(Number((await pool.query("select count(distinct display_name) count from sales_leads where source='bounded-fixture'")).rows[0].count), 10_000);
    assert.deepEqual((await pool.query("select outcome,count(*)::integer count,count(distinct target_record_id)::integer distinct_targets from sales_import_rows where import_job_id=$1 group by outcome", [importJobId])).rows, [{ outcome: "accepted", count: 10_000, distinct_targets: 10_000 }]);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.lead-changed' and payload->>'environment'=$1", [environment])).rows[0].count), 10_000, "worker restart preserves every accepted import effect exactly once");
    const importReceipt = (await pool.query("select evidence,digest from sales_import_receipts where job_id=$1", [importJobId])).rows[0];
    assert.equal(importReceipt.digest, canonicalDigest(importReceipt.evidence));
    assert.equal(await processSalesDataMovement(pool, fence), "idle", "exact replay has no second logical effect");
    assert.equal(Number((await pool.query("select count(*) count from sales_import_receipts where job_id=$1", [importJobId])).rows[0].count), 1);

    for (const [runId, reportId, windowMode] of reports) await queueReport(pool, runId, reportId, windowMode);
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    assert.equal(await processGeneratedSalesReports(pool, { ...fence, fencingToken: 0 }), 0, "stale worker cannot claim report effects");
    assert.equal(await processGeneratedSalesReports(pool, fence), 7);
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "report worker restart/replay emits no second artifact");
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts")).rows[0].count), 7);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_delivery_receipts")).rows[0].count), 7);

    const artifacts = new Map((await pool.query("select r.report_id,convert_from(a.bytes,'UTF8') csv,r.execution_metadata metadata from sales_report_artifacts a join sales_report_runs r on r.run_id=a.run_id")).rows.map((row) => [row.report_id, { value: artifactValue(row.csv), metadata: row.metadata }]));
    const open = opportunityRows.filter((row) => !["won", "lost"].includes(row.stageId));
    const byStage = stages.filter((stage) => !["won", "lost"].includes(stage.semantic)).map((stage, index) => {
      const cents = open.filter((row) => row.stageId === stage.id).reduce((sum, row) => sum + BigInt(row.amount.replace(".", "")), 0n);
      return { key: `row-${index + 1}`, values: { "stage-id": { kind: "enum", value: stage.id }, "stage-name": { kind: "text", value: stage.name }, value: { kind: "money", value: money(cents), currency: "USD", scale: 2 } } };
    });
    const weightedNumerator = open.reduce((sum, row) => sum + BigInt(row.amount.replace(".", "")) * BigInt(stages.find((stage) => stage.id === row.stageId).probability), 0n);
    const closed = opportunityRows.filter((row) => ["won", "lost"].includes(row.stageId));
    const won = closed.filter((row) => row.stageId === "won").length;
    const durations = closed.map((row) => Math.floor((new Date(row.closedAt).getTime() - new Date(row.createdAt).getTime()) / 86_400_000)).sort((left, right) => left - right);
    const middle = durations.length / 2;
    const median = durations.length % 2 === 0 ? (durations[middle - 1] + durations[middle]) / 2 : durations[Math.floor(middle)];
    const independentLedger = new Map([
      ["sales.report.pipeline-value-by-stage", { fields: ["stage-id", "stage-name", "value"], rows: byStage, page: { number: 1, pageSize: 4, hasNext: false } }],
      ["sales.report.weighted-forecast", { value: { kind: "money", value: money(halfUpRationalToCents(weightedNumerator, 10_000n)), currency: "USD", scale: 2, rounding: "half-up" } }],
      ["sales.report.won-lost-conversion", { value: { kind: "percentage", value: (100 * won / closed.length).toFixed(2) } }],
      ["sales.report.lead-conversion", { value: { kind: "percentage", value: "50.00" } }],
      ["sales.report.activity-by-owner-team", { fields: ["actor-id", "team-id", "count"], rows: [{ key: "row-1", values: { "actor-id": { kind: "text", value: actorId }, "team-id": { kind: "text", value: teamId }, count: { kind: "integer", value: 199 } } }], page: { number: 1, pageSize: 1, hasNext: false } }],
      ["sales.report.task-aging", { fields: ["bucket", "count"], rows: ["not-due", "due-today", "1-7", "8-30", "31-plus"].map((bucket, index) => ({ key: `row-${index + 1}`, values: { bucket: { kind: "enum", value: bucket }, count: { kind: "integer", value: 20 } } })), page: { number: 1, pageSize: 5, hasNext: false } }],
      ["sales.report.sales-cycle-duration", { value: { kind: "duration", value: String(median), unit: "days" } }]
    ]);
    const expectedAuthorizedCounts = new Map([
      ["sales.report.pipeline-value-by-stage", open.length], ["sales.report.weighted-forecast", open.length],
      ["sales.report.won-lost-conversion", closed.length], ["sales.report.sales-cycle-duration", closed.length],
      ["sales.report.lead-conversion", 100], ["sales.report.activity-by-owner-team", 199], ["sales.report.task-aging", 100]
    ]);
    for (const [, reportId] of reports) {
      assert.deepEqual(artifacts.get(reportId)?.value, independentLedger.get(reportId), `${reportId} must exactly reconcile to test-owned ledger`);
      assert.equal(artifacts.get(reportId)?.metadata.reportingTimezone, "America/New_York");
      assert.equal(artifacts.get(reportId)?.metadata.reportingCurrency, "USD");
      assert.equal(artifacts.get(reportId)?.metadata.authorizedRecordCount, expectedAuthorizedCounts.get(reportId));
      assert.deepEqual(artifacts.get(reportId)?.metadata.source, { id: reportId, version: 1 });
    }
    assert.equal(artifacts.get("sales.report.weighted-forecast").value.value.value, independentLedger.get("sales.report.weighted-forecast").value.value, "money delta is zero at USD scale 2");
    assert.equal(artifacts.get("sales.report.activity-by-owner-team").metadata.authorizedRecordCount, 199, "UTC instants straddling America/New_York week boundary land in expected bucket");

    const reminderDigest = digest("p13-10-reminder");
    const reminderSeed = (await pool.query(`insert into sales_reminders(application_id,environment,recipient_id,reference_kind,reference_id,subject,scheduled_at,state,revision,attempt,idempotency_digest,audit)
      values($1,$2,$3,'task','1','P13.10 fixture reminder',now()-interval '1 second','scheduled',1,0,$4,jsonb_build_array(jsonb_build_object('actionId','sales.reminder.schedule','resourceId','fixture-reminder','applicationId',$1::text,'environment',$2::text,'fromState','absent','toState','scheduled','occurredAt',to_char((now()-interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'actorId',$3::text,'revision',1,'idempotencyKey','p13-10-reminder'))) returning id,scheduled_at`, [applicationId, environment, actorId, reminderDigest])).rows[0];
    const reminderId = reminderSeed.id;
    const { processGeneratedSalesReminders } = await import("../dist/src/k-nex-sales-communications.js");
    assert.equal(await processGeneratedSalesReminders(pool, { ...fence, fencingToken: 0 }), 0, "stale reminder worker has zero effect");
    assert.equal(await processGeneratedSalesReminders(pool, fence), 1);
    assert.equal(await processGeneratedSalesReminders(pool, fence), 0, "reminder worker replay has zero duplicate effect");
    const reminder = (await pool.query("select state,revision,delivered_at from sales_reminders where id=$1", [reminderId])).rows[0];
    assert.deepEqual({ state: reminder.state, revision: reminder.revision }, { state: "delivered", revision: 2 });
    assert.ok(new Date(reminder.delivered_at).getTime() - new Date(reminderSeed.scheduled_at).getTime() <= 60_000, "healthy-path reminder delivery exceeds 60 seconds");
    assert.equal(Number((await pool.query("select count(*) count from sales_notifications where reference_kind='task' and reference_id='1' and recipient_id=$1", [actorId])).rows[0].count), 1, "reminder replay creates one authorized notification");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type in ('sales.event.reminder-changed','sales.event.notification-changed') and payload->>'resourceId' in ($1,$2)", [String(reminderId), String((await pool.query("select id from sales_notifications where reference_kind='task' and reference_id='1' and recipient_id=$1", [actorId])).rows[0].id)])).rows[0].count), 2);

    const samples = 50;
    const profile = Object.freeze({ evidenceClass: "controlled-ci-database-fixture", samplesPerOperation: samples, concurrency: 1, cpuModel: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), cacheState: "warm-after-one-full-import-and-report-run", serverObservedHttpClaim: false, productionCapacityClaim: false });
    const p95 = {
      databaseListQuery: await measure(samples, () => pool.query("select id,display_name,status,revision from sales_leads where application_id=$1 and environment=$2 order by id limit 50", [applicationId, environment])),
      databaseDetailQuery: await measure(samples, (index) => pool.query("select id,display_name,status,revision from sales_leads where application_id=$1 and environment=$2 and id=$3", [applicationId, environment, (index % 100) + 1])),
      idleWorkerAction: await measure(samples, async () => assert.equal(await processSalesDataMovement(pool, fence), "idle"))
    };
    assert.deepEqual(Object.keys(profile), ["evidenceClass", "samplesPerOperation", "concurrency", "cpuModel", "logicalCpus", "memoryBytes", "cacheState", "serverObservedHttpClaim", "productionCapacityClaim"]);
    for (const [operation, milliseconds] of Object.entries(p95)) assert.ok(milliseconds <= 1_000, `${operation} p95 ${milliseconds.toFixed(2)}ms exceeds fixture database-layer budget`);
    context.diagnostic(JSON.stringify({ profile, p95Milliseconds: p95 }));
  } finally {
    await pool.end();
    await container.stop();
  }
});
