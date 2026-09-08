import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up } from "../dist/src/migrations/20260908_000034_reports.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const app = "p13-reports"; const environment = "production";
const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const fence = Object.freeze({ applicationId: app, environment, activeExecutionGeneration: "reports-generation-1", fencingToken: 1, leaseOwner: "reports-worker", promotionRevision: 1 });
const reportGrants = Object.freeze([
  "sales.exports.execute", "sales.reports.read", "sales.reports.schedule", "sales.activities.read", "sales.leads.read",
  "sales.opportunities.read", "sales.opportunities.amount.read", "sales.pipelines.read", "sales.tasks.read"
]);

async function database(run) {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_reports").start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`
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
      create table sales_opportunities(id integer primary key,application_id text,environment text,owner_id text,team_id text,pipeline_id integer,stage_id text,amount text,currency text,archive_status text,closed_at timestamptz,created_at timestamptz);
      create table sales_leads(id integer primary key,application_id text,environment text,owner_id text,team_id text,status text,archive_status text,decided_at timestamptz);
      create table sales_activities(id integer primary key,application_id text,environment text,owner_id text,team_id text,actor_id text,status text,scheduled_at timestamptz,occurred_at timestamptz,supersedes_activity_id integer);
      create table sales_tasks(id integer primary key,application_id text,environment text,owner_id text,team_id text,status text,due_date date);
    `);
    await pool.query("insert into k_nex_system_settings_state values($1,$2,1)", [app, environment]);
    await pool.query("insert into k_nex_system_settings_documents values($1,$2,'system.general','platform:system',3,1,1,$3::jsonb)", [app, environment, JSON.stringify({ reportingTimezone: "America/New_York", reportingCurrency: "USD" })]);
    await up({ db: drizzle(pool) });
    await pool.query("insert into runtime_worker_generation_fences values($1,$2,$3,1,$4,now()+interval '1 hour',1)", [app, environment, fence.activeExecutionGeneration, fence.leaseOwner]);
    await pool.query("insert into k_nex_authorization_state values($1,1,0)", [app]);
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'report-user',1,'active','application-sales-scope',true,true,'[]'::jsonb)", [app, environment]);
    await pool.query("insert into users values('report-user')");
    await pool.query("insert into k_nex_role_assignments values($1,'report-role','user','report-user','active')", [app]);
    await pool.query("insert into k_nex_extension_authorization_generations values($1,'platform-plugin','module.sales',1,$2::jsonb,'current',1,0)", [app, JSON.stringify([fence.activeExecutionGeneration])]);
    await pool.query("insert into k_nex_role_permission_grants(application_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,state) select $1,'report-role',permission_id,'extension','platform-plugin','module.sales',1,'active' from unnest($2::text[]) permission_id", [app, reportGrants]);
    await pool.query("insert into sales_pipeline_stages values($1,$2,1,'discovery','Discovery','discovery',1,3000),($1,$2,1,'proposal','Proposal','proposal',2,6000),($1,$2,1,'won','Won','won',3,10000),($1,$2,1,'lost','Lost','lost',4,0)", [app, environment]);
    await pool.query("insert into sales_opportunities values (1,$1,$2,'report-user','team-a',1,'discovery','10.005','USD','active',null,now()-interval '3 days'),(2,$1,$2,'report-user','team-a',1,'proposal','10.005','USD','active',null,now()-interval '2 days'),(3,$1,$2,'report-user','team-a',1,'won','11.00','USD','active',now(),now()-interval '8 days'),(4,$1,$2,'report-user','team-a',1,'lost','9.00','USD','active',now(),now()-interval '4 days'),(5,$1,$2,'other','team-z',1,'proposal','999.00','USD','archived',null,now())", [app, environment]);
    await pool.query("insert into sales_leads values(1,$1,$2,'report-user','team-a','qualified','active',now()),(2,$1,$2,'report-user','team-a','disqualified','active',now())", [app, environment]);
    await pool.query("insert into sales_activities values(1,$1,$2,'report-user','team-a','report-user','completed',now(),now(),null),(2,$1,$2,'report-user','team-a','report-user','cancelled',now(),null,null)", [app, environment]);
    await pool.query("insert into sales_tasks values(1,$1,$2,'report-user','team-a','open',current_date-1),(2,$1,$2,'report-user','team-a','open',null)", [app, environment]);
    await run(pool);
  } finally { await pool.end(); await container.stop(); }
}

async function queue(pool, runId, reportId, windowMode = "as-of", overrides = {}) {
  await pool.query(`insert into sales_report_runs(run_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,requested_at,authorization_revision,lifecycle_revision,scope_revision,report_revision,report_digest,idempotency_key,state,revision,attempt,next_attempt_at,runtime_generation_id,report_permission_grants,object_permission_grants,field_permission_grants,audit)
    values($1,$2,$3,'report-user',$4,$5,$6,now(),1,0,1,1,$7,$8,'queued',1,0,now(),$9,$10::jsonb,$11::jsonb,$12::jsonb,'[]'::jsonb)`, [runId, app, environment, overrides.recipientId ?? "report-user", reportId, windowMode, digest(runId), `report-${runId}`, fence.activeExecutionGeneration, JSON.stringify(["sales.exports.execute", "sales.reports.read"]), JSON.stringify(["sales.activities.read", "sales.leads.read", "sales.opportunities.read", "sales.pipelines.read", "sales.tasks.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
}

function artifactValue(csv) {
  const line = csv.split("\r\n")[1] ?? "";
  const match = /^"([^"]*)","([^"]*)","((?:""|[^"])*)"$/u.exec(line);
  assert.ok(match, `invalid canonical report CSV row: ${line}`);
  return JSON.parse(match[3].replaceAll('""', '"'));
}

test("P13.8 real PG processes exact closed seven-report catalog with one fenced artifact/audit/outbox chain", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    const reports = [
      ["pipeline", "sales.report.pipeline-value-by-stage", "as-of"], ["weighted", "sales.report.weighted-forecast", "as-of"],
      ["won-lost", "sales.report.won-lost-conversion", "current-reporting-week"], ["lead", "sales.report.lead-conversion", "current-reporting-week"],
      ["activity", "sales.report.activity-by-owner-team", "current-reporting-week"], ["aging", "sales.report.task-aging", "as-of"],
      ["cycle", "sales.report.sales-cycle-duration", "current-reporting-week"]
    ];
    for (const [runId, reportId, windowMode] of reports) await queue(pool, runId, reportId, windowMode);
    assert.equal(await processGeneratedSalesReports(pool, fence), 7);
    assert.deepEqual((await pool.query("select report_id,state,attempt from sales_report_runs order by report_id")).rows, reports.map(([runId, reportId]) => ({ report_id: reportId, state: "succeeded", attempt: 1 })).sort((a, b) => a.report_id.localeCompare(b.report_id)));
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts")).rows[0].count), 7);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_delivery_receipts")).rows[0].count), 7);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_run_audit where action_id='sales.job.report-delivery'")).rows[0].count), 14, "queued→running and running→succeeded evidence is immutable per run");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.report-run-changed' and message_class='durable-integration'")).rows[0].count), 14);
    const byReport = new Map((await pool.query("select r.report_id,convert_from(a.bytes,'UTF8') csv from sales_report_artifacts a join sales_report_runs r on r.run_id=a.run_id")).rows.map((row) => [row.report_id, artifactValue(row.csv)]));
    const weighted = (await pool.query("select convert_from(a.bytes,'UTF8') csv from sales_report_artifacts a join sales_report_runs r on r.run_id=a.run_id where r.report_id='sales.report.weighted-forecast'" )).rows[0].csv;
    assert.match(weighted, /9\.00/u, "weighted forecast aggregates exact terms then rounds once at USD scale");
    assert.match(weighted, /\r\n$/u, "artifact is CRLF terminated"); assert.equal(weighted.codePointAt(0), 114, "artifact has no UTF-8 BOM");
    assert.deepEqual(byReport.get("sales.report.pipeline-value-by-stage"), {
      fields: ["stage-id", "stage-name", "value"], rows: [
        { key: "row-1", values: { "stage-id": { kind: "enum", value: "discovery" }, "stage-name": { kind: "text", value: "Discovery" }, value: { kind: "money", value: "10.01", currency: "USD", scale: 2 } } },
        { key: "row-2", values: { "stage-id": { kind: "enum", value: "proposal" }, "stage-name": { kind: "text", value: "Proposal" }, value: { kind: "money", value: "10.01", currency: "USD", scale: 2 } } }
      ], page: { number: 1, pageSize: 2, hasNext: false }
    }, "pipeline report retains decimal/currency/stage values");
    assert.deepEqual(byReport.get("sales.report.weighted-forecast"), { value: { kind: "money", value: "9.00", currency: "USD", scale: 2, rounding: "half-up" } });
    assert.deepEqual(byReport.get("sales.report.won-lost-conversion"), { value: { kind: "percentage", value: "50.00" } });
    assert.deepEqual(byReport.get("sales.report.lead-conversion"), { value: { kind: "percentage", value: "50.00" } });
    assert.deepEqual(byReport.get("sales.report.activity-by-owner-team"), { fields: ["actor-id", "team-id", "count"], rows: [{ key: "row-1", values: { "actor-id": { kind: "text", value: "report-user" }, "team-id": { kind: "text", value: "team-a" }, count: { kind: "integer", value: 1 } } }], page: { number: 1, pageSize: 1, hasNext: false } });
    assert.deepEqual(byReport.get("sales.report.task-aging"), { fields: ["bucket", "count"], rows: [
      { key: "row-1", values: { bucket: { kind: "enum", value: "not-due" }, count: { kind: "integer", value: 1 } } }, { key: "row-2", values: { bucket: { kind: "enum", value: "due-today" }, count: { kind: "integer", value: 0 } } },
      { key: "row-3", values: { bucket: { kind: "enum", value: "1-7" }, count: { kind: "integer", value: 1 } } }, { key: "row-4", values: { bucket: { kind: "enum", value: "8-30" }, count: { kind: "integer", value: 0 } } },
      { key: "row-5", values: { bucket: { kind: "enum", value: "31-plus" }, count: { kind: "integer", value: 0 } } }
    ], page: { number: 1, pageSize: 5, hasNext: false } });
    assert.deepEqual(byReport.get("sales.report.sales-cycle-duration"), { value: { kind: "duration", value: "6", unit: "days" } });
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "restart/replay creates no second artifact, receipt, or transition");
  });
});

test("P13.8 real PG fences stale workers, isolates recipient authority failure, and preserves healthy peer", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await queue(pool, "healthy", "sales.report.weighted-forecast");
    await queue(pool, "denied", "sales.report.weighted-forecast", "as-of", { recipientId: "revoked-user" });
    const stale = { ...fence, fencingToken: 0 };
    assert.equal(await processGeneratedSalesReports(pool, stale), 0, "old fence cannot claim or emit an artifact");
    assert.equal(await processGeneratedSalesReports(pool, fence), 2);
    assert.deepEqual((await pool.query("select run_id,state,failure_code,attempt from sales_report_runs order by run_id")).rows, [
      { run_id: "denied", state: "dead-letter", failure_code: "REPORT_RECIPIENT_FORBIDDEN", attempt: 1 },
      { run_id: "healthy", state: "succeeded", failure_code: null, attempt: 1 }
    ]);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts")).rows[0].count), 1, "revoked recipient creates zero artifact");
    assert.deepEqual((await pool.query("select from_state,to_state,evidence->>'failureCode' failure_code from sales_report_run_audit where run_id='denied' order by revision")).rows, [
      { from_state: "queued", to_state: "running", failure_code: null },
      { from_state: "running", to_state: "dead-letter", failure_code: "REPORT_RECIPIENT_FORBIDDEN" }
    ]);
  });
});

test("P13.8 real PG rechecks each report's closed underlying object and amount grants immediately before bytes", { timeout: 180000 }, async () => {
  const cases = [
    ["sales.report.pipeline-value-by-stage", "sales.opportunities.read"], ["sales.report.pipeline-value-by-stage", "sales.pipelines.read"], ["sales.report.pipeline-value-by-stage", "sales.opportunities.amount.read"],
    ["sales.report.weighted-forecast", "sales.opportunities.read"], ["sales.report.weighted-forecast", "sales.pipelines.read"], ["sales.report.weighted-forecast", "sales.opportunities.amount.read"],
    ["sales.report.won-lost-conversion", "sales.opportunities.read"], ["sales.report.won-lost-conversion", "sales.pipelines.read"],
    ["sales.report.lead-conversion", "sales.leads.read"], ["sales.report.activity-by-owner-team", "sales.activities.read"],
    ["sales.report.task-aging", "sales.tasks.read"], ["sales.report.sales-cycle-duration", "sales.opportunities.read"]
  ];
  for (const [reportId, revokedGrant] of cases) {
    await database(async (pool) => {
      const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
      const windowMode = ["sales.report.pipeline-value-by-stage", "sales.report.weighted-forecast", "sales.report.task-aging"].includes(reportId) ? "as-of" : "current-reporting-week";
      await queue(pool, `grant-${reportId}-${revokedGrant}`, reportId, windowMode);
      await pool.query("delete from k_nex_role_permission_grants where application_id=$1 and role_id='report-role' and permission_id=$2", [app, revokedGrant]);
      assert.equal(await processGeneratedSalesReports(pool, fence), 1, `${reportId} must settle its claimed run after ${revokedGrant} revocation`);
      const run = (await pool.query("select state,failure_code from sales_report_runs where run_id=$1", [`grant-${reportId}-${revokedGrant}`])).rows[0];
      assert.equal(run?.state, "dead-letter", `${reportId} cannot aggregate after ${revokedGrant} revocation`);
      assert.match(String(run?.failure_code), /^REPORT_(?:AUTHORITY_STALE|RECIPIENT_FORBIDDEN)$/u, `${reportId} must use a safe terminal authority code`);
      assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id=$1", [`grant-${reportId}-${revokedGrant}`])).rows[0].count), 0, `${reportId} cannot persist bytes after ${revokedGrant} revocation`);
    });
  }
});

test("P13.8 real PG denies already-produced artifact bytes after ownership, team, archive, or stage source mutation", { timeout: 180000 }, async () => {
  const mutations = [
    "update sales_opportunities set owner_id='transferred-owner' where id=1",
    "update sales_opportunities set team_id='transferred-team' where id=1",
    "update sales_opportunities set archive_status='archived' where id=1",
    "update sales_opportunities set stage_id='proposal' where id=1"
  ];
  for (const [index, mutation] of mutations.entries()) {
    await database(async (pool) => {
      const { processGeneratedSalesReports, readGeneratedSalesReportArtifact } = await import("../dist/src/k-nex-sales-reports.js");
      await queue(pool, `artifact-watermark-${index}`, "sales.report.weighted-forecast");
      assert.equal(await processGeneratedSalesReports(pool, fence), 1);
      const artifactId = (await pool.query("select artifact_id from sales_report_runs where run_id=$1", [`artifact-watermark-${index}`])).rows[0]?.artifact_id;
      assert.equal(typeof artifactId, "string");
      await pool.query(mutation);
      const authority = Object.freeze({ context: Object.freeze({ applicationId: app, environment, actorId: "report-user" }), authorizationRevision: 1, lifecycleRevision: 0, scopeRevision: 1, recordScope: "application-sales-scope", applicationWide: true, authorizedTeamIds: [], runtimeGenerationId: fence.activeExecutionGeneration, permissionGrants: reportGrants, reportPermissionGrants: ["sales.reports.read"], objectPermissionGrants: ["sales.opportunities.read", "sales.pipelines.read"], fieldPermissionGrants: ["sales.opportunities.amount.read"] });
      await assert.rejects(readGeneratedSalesReportArtifact(pool, authority, artifactId), /REPORT_ARTIFACT_FORBIDDEN/u, "source mutation must deny retained artifact bytes without relying on a scope revision");
    });
  }
});

test("P13.8 real PG fixes report bytes, authorized count, watermark, and as-of to one repeatable-read snapshot across a blocked concurrent mutation", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports, readGeneratedSalesReportArtifact } = await import("../dist/src/k-nex-sales-reports.js");
    const lockKey = 9138001;
    await pool.query(`create function p13_report_snapshot_barrier() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(${lockKey}); return new; end $$; create trigger p13_report_snapshot_barrier before insert on sales_report_artifacts for each row execute function p13_report_snapshot_barrier();`);
    const blocker = await pool.connect();
    try {
      await blocker.query(`select pg_advisory_lock(${lockKey})`);
      await queue(pool, "snapshot-race", "sales.report.weighted-forecast");
      const processing = processGeneratedSalesReports(pool, fence);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiters = await pool.query("select count(*)::integer count from pg_locks where locktype='advisory' and objid=$1 and granted=false", [lockKey]);
        if (Number(waiters.rows[0]?.count) > 0) break;
        if (attempt === 99) throw new Error("artifact barrier was never reached");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const mutation = pool.query("update sales_opportunities set amount='100.00' where id=1");
      await blocker.query(`select pg_advisory_unlock(${lockKey})`);
      assert.equal(await processing, 1);
      await mutation;
    } finally { await blocker.query(`select pg_advisory_unlock(${lockKey})`).catch(() => undefined); blocker.release(); }
    const artifact = (await pool.query("select a.artifact_id,convert_from(a.bytes,'UTF8') csv,r.execution_metadata metadata from sales_report_artifacts a join sales_report_runs r on r.run_id=a.run_id where r.run_id='snapshot-race'")).rows[0];
    assert.deepEqual(artifactValue(artifact.csv), { value: { kind: "money", value: "9.00", currency: "USD", scale: 2, rounding: "half-up" } }, "blocked mutation cannot mix new amount into a pre-barrier report snapshot");
    assert.equal(artifact.metadata.authorizedRecordCount, 2, "metadata count is from the same old snapshot as report bytes");
    assert.match(String(artifact.metadata.asOf), /^\d{4}-\d{2}-\d{2}T/u, "asOf is database transaction evidence, not a later process clock");
    const authority = Object.freeze({ context: Object.freeze({ applicationId: app, environment, actorId: "report-user" }), authorizationRevision: 1, lifecycleRevision: 0, scopeRevision: 1, recordScope: "application-sales-scope", applicationWide: true, authorizedTeamIds: [], runtimeGenerationId: fence.activeExecutionGeneration, permissionGrants: reportGrants, reportPermissionGrants: ["sales.reports.read"], objectPermissionGrants: ["sales.opportunities.read", "sales.pipelines.read"], fieldPermissionGrants: ["sales.opportunities.amount.read"] });
    await assert.rejects(readGeneratedSalesReportArtifact(pool, authority, artifact.artifact_id), /REPORT_ARTIFACT_FORBIDDEN/u, "post-snapshot mutation advances the watermark and denies stale artifact bytes");
  });
});

test("P13.8 real PG emits null—not zero—for empty conversion and cycle denominators", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("delete from sales_opportunities; delete from sales_leads");
    await queue(pool, "empty-conversion", "sales.report.won-lost-conversion", "current-reporting-week");
    await queue(pool, "empty-cycle", "sales.report.sales-cycle-duration", "current-reporting-week");
    assert.equal(await processGeneratedSalesReports(pool, fence), 2);
    const artifacts = (await pool.query("select r.run_id,convert_from(a.bytes,'UTF8') csv from sales_report_runs r join sales_report_artifacts a on a.run_id=r.run_id order by r.run_id")).rows;
    assert.equal(artifacts.length, 2);
    for (const artifact of artifacts) assert.match(artifact.csv, /""value"":null/u, `${artifact.run_id} must retain empty metric null semantics`);
  });
});

test("P13.8 real PG rejects a reporting settings revision race before aggregation or artifact bytes", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await queue(pool, "settings-race", "sales.report.weighted-forecast");
    await pool.query("update k_nex_system_settings_state set settings_revision=2 where application_id=$1 and environment=$2", [app, environment]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "an authority-terminal run must not count as a successful report effect");
    assert.deepEqual((await pool.query("select state,failure_code from sales_report_runs where run_id='settings-race'")).rows[0], { state: "dead-letter", failure_code: "REPORT_AUTHORITY_STALE" });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='settings-race'")).rows[0].count), 0);
    assert.deepEqual((await pool.query("select from_state,to_state from sales_report_run_audit where run_id='settings-race' order by revision")).rows, [{ from_state: "queued", to_state: "running" }, { from_state: "running", to_state: "dead-letter" }]);
  });
});

test("P13.8 real PG derives money scale only from canonical ISO-4217 settings and rejects invalid currency", { timeout: 180000 }, async () => {
  const cases = [
    { currency: "JPY", amount: "10", expected: "9", scale: 0 },
    { currency: "BHD", amount: "10.005", expected: "9.005", scale: 3 }
  ];
  for (const item of cases) {
    await database(async (pool) => {
      const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
      await pool.query("update k_nex_system_settings_state set settings_revision=2 where application_id=$1 and environment=$2", [app, environment]);
      await pool.query("update k_nex_system_settings_documents set document_revision=2,settings_revision=2,values_json=$3::jsonb where application_id=$1 and environment=$2 and descriptor_id='system.general'", [app, environment, JSON.stringify({ reportingTimezone: "America/New_York", reportingCurrency: item.currency })]);
      await pool.query("update sales_opportunities set currency=$3,amount=$4 where application_id=$1 and environment=$2 and stage_id in ('discovery','proposal')", [app, environment, item.currency, item.amount]);
      await queue(pool, `currency-${item.currency}`, "sales.report.weighted-forecast");
      assert.equal(await processGeneratedSalesReports(pool, fence), 1);
      const value = artifactValue((await pool.query("select convert_from(bytes,'UTF8') csv from sales_report_artifacts where run_id=$1", [`currency-${item.currency}`])).rows[0].csv);
      assert.deepEqual(value, { value: { kind: "money", value: item.expected, currency: item.currency, scale: item.scale, rounding: "half-up" } });
    });
  }
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("update k_nex_system_settings_state set settings_revision=2 where application_id=$1 and environment=$2", [app, environment]);
    await pool.query("update k_nex_system_settings_documents set document_revision=2,settings_revision=2,values_json=$3::jsonb where application_id=$1 and environment=$2 and descriptor_id='system.general'", [app, environment, JSON.stringify({ reportingTimezone: "America/New_York", reportingCurrency: "ZZZ" })]);
    await queue(pool, "currency-invalid", "sales.report.weighted-forecast");
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "an invalid canonical currency must terminalize before report bytes are produced");
    assert.deepEqual((await pool.query("select state,failure_code from sales_report_runs where run_id='currency-invalid'")).rows[0], { state: "dead-letter", failure_code: "REPORT_AUTHORITY_STALE" });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='currency-invalid'")).rows[0].count), 0);
  });
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("update sales_opportunities set currency='EUR' where id=1");
    await queue(pool, "currency-mixed", "sales.report.weighted-forecast");
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "mixed-currency aggregate must terminalize without an artifact");
    assert.deepEqual((await pool.query("select state,failure_code from sales_report_runs where run_id='currency-mixed'")).rows[0], { state: "dead-letter", failure_code: "REPORT_CURRENCY_MIXED" });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='currency-mixed'")).rows[0].count), 0);
    assert.deepEqual((await pool.query("select from_state,to_state,evidence->>'failureCode' failure_code from sales_report_run_audit where run_id='currency-mixed' order by revision")).rows, [{ from_state: "queued", to_state: "running", failure_code: null }, { from_state: "running", to_state: "dead-letter", failure_code: "REPORT_CURRENCY_MIXED" }]);
  });
});

test("P13.8 real PG reclaims an expired lease and dead-letters a crashed exhausted claim without another effect", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await queue(pool, "reclaimable", "sales.report.weighted-forecast");
    await pool.query("update sales_report_runs set state='running',attempt=1,revision=2,worker_generation_id='crashed',worker_fencing_token=2,worker_promotion_revision=2,worker_lease_owner='crashed',lease_revision=1,lease_expires_at=now()-interval '1 second' where run_id='reclaimable'");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1, "current fenced worker reclaims an expired claim");
    assert.deepEqual((await pool.query("select state,attempt from sales_report_runs where run_id='reclaimable'")).rows[0], { state: "succeeded", attempt: 2 });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='reclaimable'")).rows[0].count), 1);

    await queue(pool, "exhausted", "sales.report.weighted-forecast");
    await pool.query("update sales_report_runs set state='running',attempt=3,revision=4,worker_generation_id='crashed',worker_fencing_token=2,worker_promotion_revision=2,worker_lease_owner='crashed',lease_revision=1,lease_expires_at=now()-interval '1 second' where run_id='exhausted'");
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "exhaustion terminalization must not execute a report");
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_report_runs where run_id='exhausted'")).rows[0], { state: "dead-letter", attempt: 3, failure_code: "REPORT_RETRY_EXHAUSTED" });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='exhausted'")).rows[0].count), 0, "exhausted crash recovery has zero effect");
    assert.deepEqual((await pool.query("select from_state,to_state,evidence->>'failureCode' failure_code from sales_report_run_audit where run_id='exhausted' order by revision")).rows, [{ from_state: "running", to_state: "dead-letter", failure_code: "REPORT_RETRY_EXHAUSTED" }]);
  });
});

test("P13.8 real PG retries poison at 15/30 then dead-letters it while a healthy peer completes", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query(`create function p13_poison_report_artifact() returns trigger language plpgsql as $$ begin if new.run_id='poison' then raise exception 'p13 forced artifact failure'; end if; return new; end $$; create trigger p13_poison_report_artifact before insert on sales_report_artifacts for each row execute function p13_poison_report_artifact();`);
    await queue(pool, "poison", "sales.report.weighted-forecast");
    await queue(pool, "healthy-peer", "sales.report.weighted-forecast");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1, "one poison cannot starve a same-batch healthy peer");
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_report_runs where run_id='poison'")).rows[0], { state: "queued", attempt: 1, failure_code: "REPORT_SOURCE_STALE" });
    assert.deepEqual((await pool.query("select state,attempt from sales_report_runs where run_id='healthy-peer'")).rows[0], { state: "succeeded", attempt: 1 });
    await pool.query("update sales_report_runs set next_attempt_at=now()-interval '1 second' where run_id='poison'");
    assert.equal(await processGeneratedSalesReports(pool, fence), 0);
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_report_runs where run_id='poison'")).rows[0], { state: "queued", attempt: 2, failure_code: "REPORT_SOURCE_STALE" });
    await pool.query("update sales_report_runs set next_attempt_at=now()-interval '1 second' where run_id='poison'");
    assert.equal(await processGeneratedSalesReports(pool, fence), 0);
    assert.deepEqual((await pool.query("select state,attempt,failure_code from sales_report_runs where run_id='poison'")).rows[0], { state: "dead-letter", attempt: 3, failure_code: "REPORT_RETRY_EXHAUSTED" });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='poison'")).rows[0].count), 0);
    assert.deepEqual((await pool.query("select from_state,to_state,evidence->>'failureCode' failure_code from sales_report_run_audit where run_id='poison' order by revision")).rows, [
      { from_state: "queued", to_state: "running", failure_code: null }, { from_state: "running", to_state: "queued", failure_code: "REPORT_SOURCE_STALE" },
      { from_state: "queued", to_state: "running", failure_code: null }, { from_state: "running", to_state: "queued", failure_code: "REPORT_SOURCE_STALE" },
      { from_state: "queued", to_state: "running", failure_code: null }, { from_state: "running", to_state: "dead-letter", failure_code: "REPORT_RETRY_EXHAUSTED" }
    ]);
  });
});

test("P13.8 real PG rechecks record scope at claim and rejects an authorization-revision race with no artifact", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("insert into sales_opportunities values(99,$1,$2,'other','team-z',1,'proposal','999.99','USD','active',null,now())", [app, environment]);
    await pool.query("update sales_current_authority_scopes set revision=2,record_scope='owned-or-assigned-team',application_wide=false,authorized_team_ids='[]'::jsonb where application_id=$1 and environment=$2 and principal_id='report-user'", [app, environment]);
    await queue(pool, "scoped", "sales.report.weighted-forecast");
    await pool.query("update sales_report_runs set scope_revision=2 where run_id='scoped'");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    const scoped = artifactValue((await pool.query("select convert_from(a.bytes,'UTF8') csv from sales_report_artifacts a join sales_report_runs r on r.run_id=a.run_id where r.run_id='scoped'")).rows[0].csv);
    assert.deepEqual(scoped, { value: { kind: "money", value: "9.00", currency: "USD", scale: 2, rounding: "half-up" } }, "foreign-team USD opportunity cannot widen scoped report value");

    await queue(pool, "authority-race", "sales.report.weighted-forecast");
    await pool.query("update sales_report_runs set scope_revision=2 where run_id='authority-race'");
    await pool.query("update k_nex_authorization_state set authorization_revision=2 where application_id=$1", [app]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    assert.deepEqual((await pool.query("select state,failure_code from sales_report_runs where run_id='authority-race'")).rows[0], { state: "dead-letter", failure_code: "REPORT_AUTHORITY_STALE" });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='authority-race'")).rows[0].count), 0, "authority race has zero artifact/effect");
  });
});

test("P13.8 real PG explicit-team report scope never widens to an actor-owned record", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("update sales_current_authority_scopes set revision=2,record_scope='explicit-application-or-team-scope',application_wide=false,authorized_team_ids='[\"team-allowed\"]'::jsonb where application_id=$1 and environment=$2 and principal_id='report-user'", [app, environment]);
    await pool.query("insert into sales_opportunities values(61,$1,$2,'other','team-allowed',1,'proposal','100.00','USD','active',null,now()),(62,$1,$2,'report-user','team-denied',1,'proposal','999.00','USD','active',null,now())", [app, environment]);
    await queue(pool, "explicit-team", "sales.report.weighted-forecast");
    await pool.query("update sales_report_runs set scope_revision=2 where run_id='explicit-team'");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    const body = artifactValue((await pool.query("select convert_from(bytes,'UTF8') csv from sales_report_artifacts where run_id='explicit-team'")).rows[0].csv);
    assert.deepEqual(body, { value: { kind: "money", value: "60.00", currency: "USD", scale: 2, rounding: "half-up" } }, "only explicitly authorized team rows may contribute; ownership is irrelevant");
  });
});

test("P13.8 real PG retains authorized archived terminal history for conversion, lead, and cycle metrics", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("delete from sales_opportunities; delete from sales_leads");
    await pool.query("insert into sales_opportunities values(71,$1,$2,'report-user','team-a',1,'won','10.00','USD','archived',now()-interval '1 day',now()-interval '3 days'),(72,$1,$2,'report-user','team-a',1,'lost','10.00','USD','archived',now()-interval '1 day',now()-interval '5 days')", [app, environment]);
    await pool.query("insert into sales_leads values(71,$1,$2,'report-user','team-a','qualified','archived',now()-interval '1 day'),(72,$1,$2,'report-user','team-a','disqualified','archived',now()-interval '1 day')", [app, environment]);
    await queue(pool, "archived-won-lost", "sales.report.won-lost-conversion", "current-reporting-week");
    await queue(pool, "archived-leads", "sales.report.lead-conversion", "current-reporting-week");
    await queue(pool, "archived-cycle", "sales.report.sales-cycle-duration", "current-reporting-week");
    assert.equal(await processGeneratedSalesReports(pool, fence), 3);
    const results = new Map((await pool.query("select r.run_id,convert_from(a.bytes,'UTF8') csv from sales_report_runs r join sales_report_artifacts a on a.run_id=r.run_id order by r.run_id")).rows.map((row) => [row.run_id, artifactValue(row.csv)]));
    assert.deepEqual(results.get("archived-won-lost"), { value: { kind: "percentage", value: "50.00" } });
    assert.deepEqual(results.get("archived-leads"), { value: { kind: "percentage", value: "50.00" } });
    assert.deepEqual(results.get("archived-cycle"), { value: { kind: "duration", value: "3", unit: "days" } });
  });
});

test("P13.8 real PG activity report uses occurred-at and only current immutable activity facts", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("delete from sales_activities");
    await pool.query("insert into sales_activities values(81,$1,$2,'report-user','team-a','superseded-actor','completed',now()-interval '2 months',now(),null),(82,$1,$2,'report-user','team-b','current-actor','completed',now(),now(),81),(83,$1,$2,'report-user','team-a','scheduled-actor','scheduled',now(),null,null)", [app, environment]);
    await queue(pool, "activity-current", "sales.report.activity-by-owner-team", "current-reporting-week");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    const result = artifactValue((await pool.query("select convert_from(bytes,'UTF8') csv from sales_report_artifacts where run_id='activity-current'")).rows[0].csv);
    assert.deepEqual(result, { fields: ["actor-id", "team-id", "count"], rows: [{ key: "row-1", values: { "actor-id": { kind: "text", value: "current-actor" }, "team-id": { kind: "text", value: "team-b" }, count: { kind: "integer", value: 1 } } }], page: { number: 1, pageSize: 1, hasNext: false } });
  });
});

test("P13.8 real PG uses floor/non-negative exact odd and even sales-cycle medians", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("delete from sales_opportunities");
    await pool.query("insert into sales_opportunities values(91,$1,$2,'report-user','team-a',1,'won','1.00','USD','active',now(),now()-interval '1 day'),(92,$1,$2,'report-user','team-a',1,'lost','1.00','USD','active',now(),now()-interval '3 days'),(93,$1,$2,'report-user','team-a',1,'won','1.00','USD','active',now(),now()-interval '5 days'),(94,$1,$2,'report-user','team-a',1,'lost','1.00','USD','active',now()-interval '1 day',now())", [app, environment]);
    await queue(pool, "cycle-odd", "sales.report.sales-cycle-duration", "current-reporting-week");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    assert.deepEqual(artifactValue((await pool.query("select convert_from(bytes,'UTF8') csv from sales_report_artifacts where run_id='cycle-odd'")).rows[0].csv), { value: { kind: "duration", value: "2", unit: "days" } }, "negative elapsed time is clamped to zero; sorted 0/1/3/5 median is 2");

    await pool.query("delete from sales_opportunities");
    await pool.query("insert into sales_opportunities values(97,$1,$2,'report-user','team-a',1,'won','1.00','USD','active',now(),now()-interval '1 day'),(98,$1,$2,'report-user','team-a',1,'lost','1.00','USD','active',now(),now()-interval '3 days'),(99,$1,$2,'report-user','team-a',1,'won','1.00','USD','active',now(),now()-interval '5 days')", [app, environment]);
    assert.deepEqual((await pool.query("select id,floor(greatest(extract(epoch from (closed_at at time zone 'UTC' - created_at at time zone 'UTC')),0)/86400.0)::integer whole_days from sales_opportunities order by id")).rows, [{ id: 97, whole_days: 1 }, { id: 98, whole_days: 3 }, { id: 99, whole_days: 5 }], "cycle seed is exactly the intended odd 1/3/5 ledger");
    await queue(pool, "cycle-odd-cardinality", "sales.report.sales-cycle-duration", "current-reporting-week");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    assert.deepEqual(artifactValue((await pool.query("select convert_from(bytes,'UTF8') csv from sales_report_artifacts where run_id='cycle-odd-cardinality'")).rows[0].csv), { value: { kind: "duration", value: "3", unit: "days" } }, "sorted 1/3/5 odd median is 3");

    await pool.query("delete from sales_opportunities");
    await pool.query("insert into sales_opportunities values(95,$1,$2,'report-user','team-a',1,'won','1.00','USD','active',now(),now()-interval '2 days'),(96,$1,$2,'report-user','team-a',1,'lost','1.00','USD','active',now(),now()-interval '4 days')", [app, environment]);
    await queue(pool, "cycle-even", "sales.report.sales-cycle-duration", "current-reporting-week");
    assert.equal(await processGeneratedSalesReports(pool, fence), 1);
    assert.deepEqual(artifactValue((await pool.query("select convert_from(bytes,'UTF8') csv from sales_report_artifacts where run_id='cycle-even'")).rows[0].csv), { value: { kind: "duration", value: "3", unit: "days" } }, "sorted 2/4 median is their exact mean, 3");
  });
});

test("P13.8 real PG due schedule enqueues once, advances canonically, and cancels a revoked recipient", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query(`insert into sales_report_schedules(schedule_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,weekday,local_time,authorization_revision,lifecycle_revision,scope_revision,revision,state,next_run_at,audit)
      values('due',$1,$2,'report-user','report-user','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb),
            ('revoked',$1,$2,'revoked-user','revoked-user','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb)`, [app, environment]);
    await pool.query("update sales_report_schedules set runtime_generation_id=$3,report_permission_grants=$4::jsonb,object_permission_grants=$5::jsonb,field_permission_grants=$6::jsonb where application_id=$1 and environment=$2", [app, environment, fence.activeExecutionGeneration, JSON.stringify(["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"]), JSON.stringify(["sales.opportunities.read", "sales.pipelines.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
    await pool.query("insert into users values('revoked-user'),('inactive-user')");
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'inactive-user',1,'active','application-sales-scope',true,true,'[]'::jsonb)", [app, environment]);
    await pool.query("insert into k_nex_role_assignments values($1,'inactive-report-role','user','inactive-user','active')", [app]);
    await pool.query("insert into k_nex_role_permission_grants values($1,'inactive-report-role','sales.reports.read','extension','platform-plugin','module.sales',1,'active')", [app]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 1, "one valid due schedule creates exactly one fenced effect");
    assert.deepEqual((await pool.query("select creator_id,recipient_id,state,scheduled_for is not null scheduled from sales_report_runs where run_id like 'report-run-schedule-%'")).rows, [{ creator_id: "report-user", recipient_id: "report-user", state: "succeeded", scheduled: true }]);
    assert.deepEqual((await pool.query("select state,revision,next_run_at>now() advanced from sales_report_schedules where schedule_id='due'")).rows[0], { state: "active", revision: 2, advanced: true });
    assert.deepEqual((await pool.query("select state,revision,next_run_at is null cleared from sales_report_schedules where schedule_id='revoked'")).rows[0], { state: "cancelled", revision: 2, cleared: true });
    await pool.query("insert into sales_report_schedules(schedule_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,weekday,local_time,authorization_revision,lifecycle_revision,scope_revision,revision,state,next_run_at,audit) values('inactive-snapshot',$1,$2,'inactive-user','inactive-user','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb)", [app, environment]);
    await pool.query("update sales_report_schedules set runtime_generation_id=$3,report_permission_grants=$4::jsonb,object_permission_grants=$5::jsonb,field_permission_grants=$6::jsonb where application_id=$1 and environment=$2 and schedule_id='inactive-snapshot'", [app, environment, fence.activeExecutionGeneration, JSON.stringify(["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"]), JSON.stringify(["sales.opportunities.read", "sales.pipelines.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
    await pool.query("insert into k_nex_permission_catalog_snapshots values($1,'module.sales-inactive','administrative-non-authoritative','{}'::jsonb,'inactive-extension-disabled','extension',null,'platform-plugin','module.sales',1,0)", [app]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 0, "inactive catalog snapshot blocks a due recipient before enqueue");
    assert.deepEqual((await pool.query("select state,revision,next_run_at is null cleared from sales_report_schedules where schedule_id='inactive-snapshot'")).rows[0], { state: "cancelled", revision: 2, cleared: true });
    assert.equal(Number((await pool.query("select count(*) count from sales_report_runs where recipient_id in ('revoked-user','inactive-user')")).rows[0].count), 0, "recipient/grant revocation prevents enqueue/effect");
    assert.deepEqual((await pool.query("select evidence->>'fromState' from_state,evidence->>'toState' to_state,evidence->>'failureCode' failure_code from sales_report_schedule_audit where schedule_id='revoked'")).rows, [{ from_state: "active", to_state: "cancelled", failure_code: "REPORT_AUTHORITY_STALE" }]);
    assert.deepEqual((await pool.query("select evidence->>'fromState' from_state,evidence->>'toState' to_state,evidence->>'failureCode' failure_code from sales_report_schedule_audit where schedule_id='inactive-snapshot'")).rows, [{ from_state: "active", to_state: "cancelled", failure_code: "REPORT_AUTHORITY_STALE" }]);
  });
});

test("P13.8 real PG isolates a due schedule whose current object, amount, or runtime-generation authority is revoked", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
    await pool.query("insert into users values('due-missing-grant')");
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'due-missing-grant',1,'active','application-sales-scope',true,true,'[]'::jsonb)", [app, environment]);
    await pool.query("insert into k_nex_role_assignments values($1,'due-missing-grant-role','user','due-missing-grant','active')", [app]);
    await pool.query("insert into k_nex_role_permission_grants values($1,'due-missing-grant-role','sales.reports.read','extension','platform-plugin','module.sales',1,'active')", [app]);
    await pool.query(`insert into sales_report_schedules(schedule_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,weekday,local_time,authorization_revision,lifecycle_revision,scope_revision,revision,state,next_run_at,audit,runtime_generation_id,report_permission_grants,object_permission_grants,field_permission_grants)
      values('due-healthy',$1,$2,'report-user','report-user','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb),
            ('due-missing-grant',$1,$2,'due-missing-grant','due-missing-grant','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb)`, [app, environment, fence.activeExecutionGeneration, JSON.stringify(["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"]), JSON.stringify(["sales.opportunities.read", "sales.pipelines.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 1, "a revoked due recipient cannot starve a healthy same-batch schedule");
    assert.deepEqual((await pool.query("select schedule_id,state,next_run_at is null cleared from sales_report_schedules order by schedule_id")).rows, [{ schedule_id: "due-healthy", state: "active", cleared: false }, { schedule_id: "due-missing-grant", state: "cancelled", cleared: true }]);
    assert.equal(Number((await pool.query("select count(*) count from sales_report_runs where recipient_id='due-missing-grant'")).rows[0].count), 0, "current missing amount/pipeline/object authority creates no durable run");
    assert.equal(Number((await pool.query("select count(*) count from sales_report_run_audit a join sales_report_runs r on r.run_id=a.run_id where r.recipient_id='due-missing-grant'")).rows[0].count), 0, "revoked due recipient creates no report-run audit");
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where payload->>'recipientId'='due-missing-grant'")).rows[0].count), 0, "revoked due recipient creates no report-run outbox event");
    assert.deepEqual((await pool.query("select evidence->>'failureCode' failure_code from sales_report_schedule_audit where schedule_id='due-missing-grant'")).rows, [{ failure_code: "REPORT_AUTHORITY_STALE" }]);
  });
});

test("P13.8 real PG keeps scheduled and manual report authority origin-specific", { timeout: 180000 }, async () => {
  await database(async (pool) => {
    const { processGeneratedSalesReports, readGeneratedSalesReportArtifact } = await import("../dist/src/k-nex-sales-reports.js");
    const scheduledOnlyGrants = ["sales.reports.read", "sales.reports.schedule", "sales.opportunities.read", "sales.pipelines.read", "sales.opportunities.amount.read"];
    await pool.query("insert into users values('schedule-only')");
    await pool.query("insert into sales_current_authority_scopes values($1,$2,'schedule-only',1,'active','application-sales-scope',true,true,'[]'::jsonb)", [app, environment]);
    await pool.query("insert into k_nex_role_assignments values($1,'schedule-only-role','user','schedule-only','active')", [app]);
    await pool.query("insert into k_nex_role_permission_grants(application_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,state) select $1,'schedule-only-role',permission_id,'extension','platform-plugin','module.sales',1,'active' from unnest($2::text[]) permission_id", [app, scheduledOnlyGrants]);
    await pool.query(`insert into sales_report_schedules(schedule_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,weekday,local_time,authorization_revision,lifecycle_revision,scope_revision,revision,state,next_run_at,audit,runtime_generation_id,report_permission_grants,object_permission_grants,field_permission_grants)
      values('schedule-only',$1,$2,'schedule-only','schedule-only','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb)`, [app, environment, fence.activeExecutionGeneration, JSON.stringify(["sales.reports.read", "sales.reports.schedule"]), JSON.stringify(["sales.opportunities.read", "sales.pipelines.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 1, "schedule-only authority enqueues and completes a due report without exports.execute");
    const completed = (await pool.query("select run_id,artifact_id,state,scheduled_for is not null scheduled from sales_report_runs where recipient_id='schedule-only'")).rows[0];
    assert.deepEqual(completed, { run_id: completed.run_id, artifact_id: completed.artifact_id, state: "succeeded", scheduled: true });
    const authority = { context: { applicationId: app, environment, actorId: "schedule-only" }, authorizationRevision: 1, lifecycleRevision: 0, scopeRevision: 1, recordScope: "application-sales-scope", applicationWide: true, authorizedTeamIds: [], runtimeGenerationId: fence.activeExecutionGeneration, permissionGrants: ["sales.reports.read", "sales.reports.schedule"], reportPermissionGrants: ["sales.reports.read", "sales.reports.schedule"], objectPermissionGrants: ["sales.opportunities.read", "sales.pipelines.read"], fieldPermissionGrants: ["sales.opportunities.amount.read"] };
    const artifact = await readGeneratedSalesReportArtifact(pool, authority, completed.artifact_id);
    assert.equal(artifact.contentType, "text/csv", "schedule-only authority can download its scheduled artifact");

    await pool.query("insert into sales_report_runs(run_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,requested_at,authorization_revision,lifecycle_revision,scope_revision,report_revision,report_digest,idempotency_key,state,revision,attempt,next_attempt_at,runtime_generation_id,report_permission_grants,object_permission_grants,field_permission_grants,audit) values('manual-schedule-only',$1,$2,'schedule-only','schedule-only','sales.report.weighted-forecast','as-of',now(),1,0,1,1,$3,'manual-schedule-only','queued',1,0,now(),$4,$5::jsonb,$6::jsonb,$7::jsonb,'[]'::jsonb)", [app, environment, digest("manual-schedule-only"), fence.activeExecutionGeneration, JSON.stringify(["sales.reports.read"]), JSON.stringify(["sales.opportunities.read", "sales.pipelines.read"]), JSON.stringify(["sales.opportunities.amount.read"])]);
    assert.equal(await processGeneratedSalesReports(pool, fence), 1, "manual run still reaches worker origin gate");
    assert.deepEqual((await pool.query("select state,failure_code from sales_report_runs where run_id='manual-schedule-only'")).rows, [{ state: "dead-letter", failure_code: "REPORT_RECIPIENT_FORBIDDEN" }], "manual origin without exports.execute is denied before effect");
    assert.equal(Number((await pool.query("select count(*) count from sales_report_artifacts where run_id='manual-schedule-only'")).rows[0].count), 0);
  });
});

test("P13.8 real PG rejects each independently revoked scheduled report grant without starving a healthy peer", { timeout: 180000 }, async () => {
  for (const revoked of ["sales.reports.schedule", "sales.opportunities.read", "sales.pipelines.read", "sales.opportunities.amount.read"]) {
    await database(async (pool) => {
      const { processGeneratedSalesReports } = await import("../dist/src/k-nex-sales-reports.js");
      await pool.query("insert into users values('due-grant-user')");
      await pool.query("insert into sales_current_authority_scopes values($1,$2,'due-grant-user',1,'active','application-sales-scope',true,true,'[]'::jsonb)", [app, environment]);
      await pool.query("insert into k_nex_role_assignments values($1,'due-grant-role','user','due-grant-user','active')", [app]);
      await pool.query("insert into k_nex_role_permission_grants(application_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,state) select $1,'due-grant-role',permission_id,'extension','platform-plugin','module.sales',1,'active' from unnest($2::text[]) permission_id", [app, reportGrants.filter((grant) => grant !== revoked)]);
      const reportSnapshot = JSON.stringify(["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"]);
      const objectSnapshot = JSON.stringify(["sales.opportunities.read", "sales.pipelines.read"]);
      const fieldSnapshot = JSON.stringify(["sales.opportunities.amount.read"]);
      await pool.query(`insert into sales_report_schedules(schedule_id,application_id,environment,creator_id,recipient_id,report_id,window_mode,weekday,local_time,authorization_revision,lifecycle_revision,scope_revision,revision,state,next_run_at,audit,runtime_generation_id,report_permission_grants,object_permission_grants,field_permission_grants) values
        ('due-peer',$1,$2,'report-user','report-user','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb),
        ('due-revoked',$1,$2,'due-grant-user','due-grant-user','sales.report.weighted-forecast','as-of',1,'09:00',1,0,1,1,'active',now()-interval '1 second','[]'::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb)`, [app, environment, fence.activeExecutionGeneration, reportSnapshot, objectSnapshot, fieldSnapshot]);
      assert.equal(await processGeneratedSalesReports(pool, fence), 1, `${revoked} revoked due schedule must not starve peer`);
      assert.equal(Number((await pool.query("select count(*) count from sales_report_runs where recipient_id='due-grant-user'")).rows[0].count), 0, `${revoked} creates no run`);
      assert.equal(Number((await pool.query("select count(*) count from sales_report_run_audit a join sales_report_runs r on r.run_id=a.run_id where r.recipient_id='due-grant-user'")).rows[0].count), 0, `${revoked} creates no audit`);
      assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where payload->>'recipientId'='due-grant-user'")).rows[0].count), 0, `${revoked} creates no run outbox`);
    });
  }
});
