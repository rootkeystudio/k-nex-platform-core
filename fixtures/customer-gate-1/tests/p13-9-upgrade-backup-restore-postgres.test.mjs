import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { planCreateKnexApplication } from "@k-nex/composition";
import { PackageReleaseManifestSchema, canonicalJson } from "@k-nex/contracts";
import { createPackageReleaseManifestAuthority } from "@k-nex/runtime";
import pg from "pg";

import { down as crmDown, up as crmUp } from "../dist/src/migrations/20260905_000027_crm_core.js";
import { down as pipelineDown, up as pipelineUp } from "../dist/src/migrations/20260907_000030_pipeline_saved_views.js";
import { down as movementDown, up as movementUp } from "../dist/src/migrations/20260907_000031_data_movement.js";
import { down as communicationsDown, up as communicationsUp } from "../dist/src/migrations/20260908_000032_communications.js";
import { down as workflowsDown, up as workflowsUp } from "../dist/src/migrations/20260908_000033_crm_workflows.js";
import { down as reportsDown, up as reportsUp } from "../dist/src/migrations/20260908_000034_reports.js";
import { migrations } from "../dist/src/migrations/index.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const applicationId = "customer-phase13-upgrade";
const environment = "production";
const ownerId = "user:migration-owner";
const receiptDigest = `sha256:${"9".repeat(64)}`;
const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
const stageNamespace = Buffer.from("13f5fa89b4655a7aa19d74ed6c5d1ef4", "hex");
function opaqueStageId(semantic) {
  const bytes = Buffer.from(createHash("sha1").update(stageNamespace)
    .update(Buffer.from(["phase13/pipeline-stage/v1", applicationId, environment, "8001", semantic].join("\0"))).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const predecessorNames = [
  "20260826_000001_gate1", "20260826_000002_sales_sources", "20260826_000003_payload_mcp", "20260826_000004_event_outbox",
  "20260826_000005_outbox_processor", "20260827_000006_sales_opportunities", "20260829_000007_runtime_extensions",
  "20260829_000008_app_storage", "20260829_000009_extension_activation", "20260829_000010_theme_skin_profiles",
  "20260829_000011_static_deployment", "20260829_000012_verified_artifacts", "20260829_000013_catalog_checkpoints",
  "20260829_000014_theme_skin_verified_artifacts", "20260829_000015_extension_capability_authority",
  "20260829_000016_extension_security_quarantine", "20260829_000017_static_release_authority", "20260829_000018_runner_quarantine",
  "20260901_000019_authorization_storage", "20260901_000020_template_tombstones", "20260901_000021_authorization_outbox",
  "20260901_000022_static_lifecycle_admission", "20260902_000023_system_settings", "20260902_000024_catalog_mirror",
  "20260902_000025_system_operations", "20260903_000026_workspace_pages"
];
const phase13MigrationNames = [
  "20260905_000027_crm_core",
  "20260907_000030_pipeline_saved_views",
  "20260907_000031_data_movement",
  "20260908_000032_communications",
  "20260908_000033_crm_workflows",
  "20260908_000034_reports"
];

const drizzleQueryConfig = {
  escapeName: (name) => `"${name.replaceAll('"', '""')}"`,
  escapeParam: (index) => `$${index + 1}`,
  escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
  casing: { getColumnCasing: (column) => column.name }
};

const migrationDb = (client) => ({ execute: async (statement) => {
  const query = statement.toQuery({ ...drizzleQueryConfig, paramStartIndex: { value: 0 } });
  return client.query(query.sql, query.params);
} });

const canonicalDigest = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const baselineDigest = (value) => `sha256:${createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex")}`;
const viewerBaseline = [
  "sales.navigation.read", "sales.opportunities.name.read", "sales.opportunities.read", "sales.opportunities.stage.read",
  "sales.tasks.read", "sales.tasks.status.read", "sales.tasks.title.read"
].sort();

async function installRegisteredPhase12Predecessor(db, client) {
  const predecessor = migrations.slice(0, predecessorNames.length);
  assert.deepEqual(predecessor.map(({ name }) => name), predecessorNames, "Phase 12 predecessor migration registry/order changed.");
  assert.equal(migrations[predecessor.length]?.name, phase13MigrationNames[0], "Phase 13 cutover must immediately follow the accepted predecessor sequence.");
  for (const migration of predecessor) await migration.up({ db });
  assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision where id=1")).rows,
    [{ predecessor_revision: 23, revision: 24 }], "The complete registered predecessor must end at accepted revision 24.");
}

async function layerPhase12ProductState(client) {
  await client.query("insert into k_nex_authorization_state (application_id,authorization_revision,lifecycle_revision) values ($1,7,3)", [applicationId]);
  await client.query(`insert into k_nex_extension_authorization_generations
      (application_id,delivery_class,extension_id,authorization_generation,runtime_generation_ids,state)
      values ($1,'platform-plugin','module.sales',1,'[]'::jsonb,'current')`, [applicationId]);
  await client.query("insert into k_nex_roles (application_id,role_id,label) values ($1,'sales.customer-viewer','Customer viewer')", [applicationId]);
  for (const [index, permissionId] of viewerBaseline.entries()) {
    await client.query(`insert into k_nex_role_permission_grants
      (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
      values ($1,$2,'sales.customer-viewer',$3,'extension','platform-plugin','module.sales',1)`,
    [applicationId, `viewer-grant-${index}`, permissionId]);
  }
  await client.query(`insert into k_nex_role_assignments (application_id,assignment_id,role_id,subject_kind,subject_id,state)
      values ($1,'viewer-assignment','sales.customer-viewer','user','viewer-1','active')`, [applicationId]);
  await client.query(`insert into k_nex_role_template_adoptions
      (application_id,adoption_id,role_id,template_id,publisher_delivery_class,publisher_extension_id,owner_delivery_class,owner_extension_id,owner_generation,
       template_version,old_baseline_permission_ids,digest_algorithm,old_baseline_digest,kind,state)
      values ($1,'viewer-adoption','sales.customer-viewer','sales.template.viewer','platform-plugin','module.sales','platform-plugin','module.sales',1,
        1,$2::jsonb,'sha256-canonical-json-v1',$3,'instantiated-role','adopted')`, [applicationId, JSON.stringify(viewerBaseline), baselineDigest(viewerBaseline)]);
  await client.query("insert into k_nex_system_settings_state (application_id,environment,settings_revision) values ($1,$2,7)", [applicationId, environment]);
  await client.query(`insert into k_nex_system_settings_documents
      (application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json)
      values
        ($1,$2,'sales.settings.workspace',1,'platform-plugin:module.sales:1','extension',null,'platform-plugin','module.sales',1,4,2,
          '{"defaultTaskPageSize":25,"showPotentialRevenue":true,"defaultPage":"tasks","pipelineStages":["lead","qualified","won","lost"]}'::jsonb),
        ($1,$2,'system.general',1,'platform:system','platform','system',null,null,null,3,3,'{"siteName":"Phase 13 Upgrade"}'::jsonb)`, [applicationId, environment]);
  await client.query(`insert into k_nex_workspace_pages
      (application_id,environment,page_id,document_id,state,page_revision,working_copy_revision,access_revision,page_json,created_at,updated_at)
      values ($1,$2,'customer.upgrade-dashboard','customer.upgrade-dashboard-document','draft',3,1,2,
        '{"schemaVersion":1,"identity":{"applicationId":"customer-phase13-upgrade","environment":"production","pageId":"customer.upgrade-dashboard","documentId":"customer.upgrade-dashboard-document"},"access":{"readPermissionId":"sales.reports.read"}}'::jsonb,
        '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')`, [applicationId, environment]);
}

async function seedPhase12Rows(client) {
  await client.query(`
    insert into sales_tasks (id,title,status,potential_revenue,private_note,created_at,updated_at) values
      (41,'Open exact decimal','open','12.340','private alpha','2026-01-02T03:04:05.123Z','2026-02-03T04:05:06.456Z'),
      (42,'Completed no optionals','done',null,null,'2026-01-03T03:04:05.000Z','2026-02-04T04:05:06.000Z'),
      (43,'Completed integer decimal','done','5000',E'private unicode résumé','2026-01-04T03:04:05.000Z','2026-02-05T04:05:06.000Z');
    insert into sales_opportunities (id,name,stage,value,created_at,updated_at) values
      (51,'Legacy lead','lead','100.00','2026-01-05T00:00:00.001Z','2026-02-07T00:00:00.001Z'),
      (52,'Legacy qualified','qualified','900.000','2026-01-06T00:00:00.002Z','2026-02-08T00:00:00.002Z'),
      (53,'Legacy won','won','1500','2026-01-07T00:00:00.003Z','2026-02-09T00:00:00.003Z'),
      (54,'Legacy lost','lost',null,'2026-01-08T00:00:00.004Z','2026-02-10T00:00:00.004Z');
    insert into sales_tasks (id,title,status,created_at,updated_at)
      select id,'Representative predecessor task ' || id,
        case when id % 2 = 0 then 'open'::enum_sales_tasks_status else 'done'::enum_sales_tasks_status end,
        '2026-01-10T00:00:00Z'::timestamptz + id * interval '1 minute',
        '2026-02-10T00:00:00Z'::timestamptz + id * interval '1 minute'
      from generate_series(44,140) id;
    insert into sales_opportunities (id,name,stage,created_at,updated_at)
      select id,'Representative predecessor opportunity ' || id,
        (array['lead','qualified','won','lost']::enum_sales_opportunities_stage[])[1 + ((id - 55) % 4)],
        '2026-01-11T00:00:00Z'::timestamptz + id * interval '1 minute',
        '2026-02-11T00:00:00Z'::timestamptz + id * interval '1 minute'
      from generate_series(55,100) id;
  `);
}

async function snapshotPhase12Truth(client) {
  const temporal = (rows) => rows.map((row) => ({ ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() }));
  const tasks = temporal((await client.query("select id,title,status::text as status,potential_revenue,private_note,created_at,updated_at from sales_tasks order by id")).rows);
  const opportunities = temporal((await client.query("select id,name,stage::text as stage,value,created_at,updated_at from sales_opportunities order by id")).rows);
  assert.equal(tasks.length, 100);
  assert.equal(opportunities.length, 50);
  const value = { tasks, opportunities };
  return Object.freeze({ ...value, digest: canonicalDigest(value) });
}

function expectedTargetProjection(predecessor) {
  const ownershipGenesis = { ownerId, teamId: null };
  const stageMap = { lead: "qualification", qualified: "discovery", won: "won", lost: "lost" };
  const tasks = predecessor.tasks.map((task) => ({
    id: task.id, title: task.title, application_id: applicationId, environment, owner_id: ownerId, team_id: null,
    created_by: ownerId, updated_by: ownerId, revision: 1,
    audit: [{ kind: "phase-13-legacy-upgrade", receiptDigest, ownershipGenesis }],
    status: task.status === "done" ? "completed" : "open", due_date: null, related_record_id: null, related_record_type: null,
    archive_status: "active", created_at: task.created_at, updated_at: task.updated_at
  }));
  const opportunities = predecessor.opportunities.map((opportunity) => {
    const semantic = stageMap[opportunity.stage];
    return {
      id: opportunity.id, name: opportunity.name, application_id: applicationId, environment, owner_id: ownerId, team_id: null,
      created_by: ownerId, updated_by: ownerId, revision: 1,
      audit: [{ kind: "phase-13-legacy-upgrade", legacyStage: opportunity.stage, receiptDigest, ownershipGenesis }],
      account_id: 7001, primary_contact_id: null, pipeline_id: 8001, stage_id: opaqueStageId(semantic), semantic,
      amount: opportunity.value, currency: opportunity.value === null ? null : "USD", expected_close_date: null,
      closed_at: opportunity.stage === "won" || opportunity.stage === "lost" ? opportunity.updated_at : null,
      loss_reason: opportunity.stage === "lost" ? "legacy-migration-unspecified" : null,
      archive_status: "active", created_at: opportunity.created_at, updated_at: opportunity.updated_at
    };
  });
  const notes = predecessor.tasks.filter(({ private_note }) => private_note !== null).map((task, index) => ({
    id: index + 1, application_id: applicationId, environment, owner_id: ownerId, team_id: null, created_by: ownerId, updated_by: ownerId,
    revision: 1, audit: [{ kind: "phase-13-legacy-private-note", receiptDigest, taskId: task.id }], status: "recorded",
    body: task.private_note, author_id: ownerId, occurred_at: task.created_at, related_record_id: String(task.id),
    related_record_type: "sales.task", replaces_note_id: null
  }));
  return { tasks, opportunities, notes };
}

async function targetProjection(client) {
  const iso = (value) => value === null ? null : value.toISOString();
  const tasks = (await client.query(`select id,title,application_id,environment,owner_id,team_id,created_by,updated_by,revision,audit,status,
    due_date,related_record_id,related_record_type,archive_status,created_at,updated_at from sales_tasks order by id`)).rows
    .map((row) => ({ ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) }));
  const opportunities = (await client.query(`select opportunity.id,opportunity.name,opportunity.application_id,opportunity.environment,
    opportunity.owner_id,opportunity.team_id,opportunity.created_by,opportunity.updated_by,opportunity.revision,opportunity.audit,
    opportunity.account_id,opportunity.primary_contact_id,opportunity.pipeline_id,opportunity.stage_id,stage.semantic,opportunity.amount,
    opportunity.currency,opportunity.expected_close_date,opportunity.closed_at,opportunity.loss_reason,opportunity.archive_status,
    opportunity.created_at,opportunity.updated_at
    from sales_opportunities opportunity join sales_pipeline_stages stage
      on stage.application_id=opportunity.application_id and stage.environment=opportunity.environment
      and stage.pipeline_id=opportunity.pipeline_id and stage.stage_id=opportunity.stage_id order by opportunity.id`)).rows
    .map((row) => ({ ...row, closed_at: iso(row.closed_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at) }));
  const notes = (await client.query(`select id,application_id,environment,owner_id,team_id,created_by,updated_by,revision,audit,status,body,
    author_id,occurred_at,related_record_id,related_record_type,replaces_note_id from sales_notes order by id`)).rows
    .map((row) => ({ ...row, occurred_at: iso(row.occurred_at) }));
  return { tasks, opportunities, notes };
}

async function bindMigration(client) {
  for (const [key, value] of Object.entries({
    application_id: applicationId, environment, owner_id: ownerId,
    account_id: "7001", account_name: "Explicit legacy import account", pipeline_id: "8001", pipeline_name: "Primary pipeline",
    currency: "USD", receipt_digest: receiptDigest
  })) await client.query("select set_config($1,$2,false)", [`k_nex.sales_migration_${key}`, value]);
}

async function applyPhase13(db) {
  assert.deepEqual(migrations.slice(-phase13MigrationNames.length).map(({ name }) => name), phase13MigrationNames,
    "The generated fixture must expose the exact Phase 13 migration sequence.");
  for (const migrate of [crmUp, pipelineUp, movementUp, communicationsUp, workflowsUp, reportsUp]) await migrate({ db });
}

async function migratedLegacyProjection(client) {
  const taskRows = (await client.query("select id,title,status,due_date,related_record_id,created_at,updated_at,audit from sales_tasks order by id")).rows;
  const notes = new Map((await client.query("select related_record_id,body from sales_notes where related_record_type='sales.task' order by related_record_id")).rows
    .map(({ related_record_id, body }) => [Number(related_record_id), body]));
  const receipt = (await client.query("select legacy_decimal_evidence from sales_crm_migration_receipts where receipt_digest=$1", [receiptDigest])).rows[0];
  const revenue = new Map(receipt.legacy_decimal_evidence.map(({ taskId, value }) => [taskId, value]));
  const tasks = taskRows.map((row) => ({
    id: row.id, title: row.title, status: row.status === "completed" ? "done" : row.status,
    potential_revenue: revenue.get(row.id) ?? null, private_note: notes.get(row.id) ?? null,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString()
  }));
  assert.equal(taskRows.every(({ due_date, related_record_id }) => due_date === null && related_record_id === null), true, "Absent Task optionals must not be invented.");
  assert.equal(taskRows.every(({ audit }) => audit.length === 1 && audit[0].kind === "phase-13-legacy-upgrade" && audit[0].receiptDigest === receiptDigest), true,
    "Every migrated Task must retain one receipt-bound genesis audit.");
  const opportunityRows = (await client.query(`select opportunity.id,opportunity.name,stage.semantic,opportunity.amount,opportunity.currency,
      opportunity.primary_contact_id,opportunity.expected_close_date,opportunity.created_at,opportunity.updated_at,opportunity.audit,
      opportunity.closed_at is not null as closed,opportunity.loss_reason
    from sales_opportunities opportunity join sales_pipeline_stages stage
      on stage.pipeline_id=opportunity.pipeline_id and stage.stage_id=opportunity.stage_id
    order by opportunity.id`)).rows;
  const stageToLegacy = { qualification: "lead", discovery: "qualified", won: "won", lost: "lost" };
  const opportunities = opportunityRows.map((row) => ({ id: row.id, name: row.name, stage: stageToLegacy[row.semantic], value: row.amount,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() }));
  assert.equal(opportunityRows.every(({ primary_contact_id, expected_close_date }) => primary_contact_id === null && expected_close_date === null), true,
    "Absent Opportunity optionals must not be invented.");
  assert.equal(opportunityRows.every(({ amount, currency }) => amount === null ? currency === null : currency === "USD"), true, "Currency is added only for exact predecessor money.");
  assert.equal(opportunityRows.every(({ semantic, closed, loss_reason }) => semantic === "lost" ? closed && loss_reason === "legacy-migration-unspecified" : semantic === "won" ? closed && loss_reason === null : !closed && loss_reason === null), true,
    "Terminal mapping must add only the declared close evidence.");
  assert.equal(opportunityRows.every(({ audit, semantic }) => audit.length === 1 && audit[0].kind === "phase-13-legacy-upgrade" &&
    audit[0].receiptDigest === receiptDigest && audit[0].legacyStage === stageToLegacy[semantic]), true,
    "Every migrated Opportunity must retain one receipt-bound genesis audit.");
  return { tasks, opportunities };
}

async function assertMigratedTruth(client, predecessor) {
  const projection = await migratedLegacyProjection(client);
  assert.deepEqual(projection, { tasks: predecessor.tasks, opportunities: predecessor.opportunities }, "Every preserved predecessor field must survive only its declared mapping.");
  assert.equal(canonicalDigest(projection), predecessor.digest, "The complete 100-Task/50-Opportunity predecessor truth digest must survive migration and restore.");
  const expectedTarget = expectedTargetProjection(predecessor);
  const actualTarget = await targetProjection(client);
  assert.deepEqual(actualTarget, expectedTarget, "Every migration-owned target field for all Tasks, Opportunities, and generated Notes must equal the deterministic binding-derived projection.");
  assert.equal(canonicalDigest(actualTarget), canonicalDigest(expectedTarget), "The complete target projection digest must survive upgrade and restore.");
  assert.deepEqual((await client.query(`select id,application_id,environment,owner_id,team_id,created_by,updated_by,revision,audit,status,name,
    merged_into_id,merge_lineage from sales_accounts where id=7001`)).rows, [{
    id: 7001, application_id: applicationId, environment, owner_id: ownerId, team_id: null, created_by: ownerId, updated_by: ownerId, revision: 1,
    audit: [{ kind: "phase-13-legacy-import", receiptDigest, ownershipGenesis: { ownerId, teamId: null } }], status: "active",
    name: "Explicit legacy import account", merged_into_id: null, merge_lineage: null
  }], "The exact receipt-bound legacy Account must own every migrated Opportunity.");
  const pipeline = (await client.query(`select id,application_id,environment,owner_id,team_id,created_by,updated_by,revision,audit,status,name,
    ordered_stage_ids,is_active from sales_pipelines where id=8001`)).rows[0];
  assert.deepEqual({ ...pipeline, audit: pipeline.audit.slice(0, 1) }, {
    id: 8001, application_id: applicationId, environment, owner_id: null, team_id: null, created_by: ownerId, updated_by: ownerId, revision: 2,
    audit: [{ kind: "phase-13-legacy-import", receiptDigest }], status: "active", name: "Primary pipeline",
    ordered_stage_ids: semantics.map(opaqueStageId), is_active: true
  });
  const stageReceipt = (await client.query("select receipt_digest,predecessor_revision,target_revision,mapping from sales_pipeline_stage_migration_receipts where pipeline_id=8001")).rows[0];
  assert.equal(pipeline.audit.length, 2);
  assert.deepEqual(pipeline.audit[1], { kind: "phase-13-pipeline-stage-identity", receiptDigest: stageReceipt.receipt_digest, sourceRevision: 1, targetRevision: 2 });
  assert.deepEqual(stageReceipt.mapping.map(({ semantic, oldStageId, newStageId, sourceRevision, targetRevision }) => ({ semantic, oldStageId, newStageId, sourceRevision, targetRevision })).sort((a, b) => a.semantic.localeCompare(b.semantic)),
    semantics.map((semantic) => ({ semantic, oldStageId: semantic, newStageId: opaqueStageId(semantic), sourceRevision: 1, targetRevision: 2 })).sort((a, b) => a.semantic.localeCompare(b.semantic)),
    "Pipeline 8001 must carry an exact receipt-bound old-ID to UUID mapping.");
  assert.deepEqual((await client.query(`select stage.semantic,count(*)::int as count from sales_opportunities opportunity
    join sales_pipeline_stages stage on stage.pipeline_id=opportunity.pipeline_id and stage.stage_id=opportunity.stage_id
    group by stage.semantic order by stage.semantic`)).rows, [
    { semantic: "discovery", count: 13 }, { semantic: "lost", count: 12 },
    { semantic: "qualification", count: 13 }, { semantic: "won", count: 12 }
  ], "The representative predecessor covers every legacy stage without coercion.");
  assert.deepEqual((await client.query("select related_record_id,body from sales_notes order by related_record_id")).rows,
    predecessor.tasks.filter(({ private_note }) => private_note !== null).map(({ id, private_note }) => ({ related_record_id: String(id), body: private_note })).sort((left, right) => left.related_record_id.localeCompare(right.related_record_id)));
  assert.deepEqual((await client.query("select task_count,opportunity_count,note_count,legacy_decimal_evidence,rollback_classification from sales_crm_migration_receipts")).rows, [{
    task_count: 100, opportunity_count: 50, note_count: predecessor.tasks.filter(({ private_note }) => private_note !== null).length,
    legacy_decimal_evidence: predecessor.tasks.filter(({ potential_revenue }) => potential_revenue !== null).map(({ id, potential_revenue }) => ({ taskId: id, value: potential_revenue })),
    rollback_classification: "maintenance-required"
  }]);
  assert.deepEqual((await client.query("select semantic from sales_pipeline_stages order by position")).rows.map(({ semantic }) => semantic), semantics);
  assert.equal((await client.query("select count(*)::int as count from sales_pipeline_stage_translation_evidence")).rows[0].count, 6);
  assert.deepEqual((await client.query("select descriptor_schema_version,values_json from k_nex_system_settings_documents where descriptor_id='system.general'")).rows,
    [{ descriptor_schema_version: 3, values_json: { siteName: "Phase 13 Upgrade", reportingCurrency: "USD", reportingTimezone: "UTC" } }]);
  assert.deepEqual((await client.query("select permission_id from k_nex_role_permission_grants where role_id='sales.customer-viewer' order by permission_id")).rows,
    [{ permission_id: "sales.opportunities.read" }, { permission_id: "sales.reports.read" }, { permission_id: "sales.tasks.read" }]);
  assert.deepEqual((await client.query("select page_id,page_revision,access_revision from k_nex_workspace_pages")).rows,
    [{ page_id: "customer.upgrade-dashboard", page_revision: 3, access_revision: 2 }]);
  assert.deepEqual((await client.query(`select
    count(*) filter (where jsonb_array_length(audit)>0)::int as audited_tasks,
    (select count(*)::int from sales_opportunities where jsonb_array_length(audit)>0) as audited_opportunities
    from sales_tasks`)).rows, [{ audited_tasks: 100, audited_opportunities: 50 }]);
  assert.equal((await client.query("select count(*)::int as count from information_schema.columns where table_schema='public' and ((table_name='sales_tasks' and column_name in ('potential_revenue','private_note')) or (table_name='sales_opportunities' and column_name in ('stage','value')))")).rows[0].count, 0);
}

async function seedPostUpgradeEvidence(client) {
  const pipeline = (await client.query("select id from sales_pipelines where application_id=$1 and environment=$2 and is_active", [applicationId, environment])).rows[0];
  await client.query(`insert into sales_activities
    (id,application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,occurred_at,related_record_id,related_record_type,audit)
    values (9001,$1,$2,$3,'team:sales',$3,$3,'completed','meeting','Restored customer meeting',$3,'2026-03-02T10:00:00Z','51','sales.opportunity','[{"kind":"fixture-completed-activity"}]'::jsonb)`,
  [applicationId, environment, ownerId]);
  await client.query(`insert into sales_saved_views
    (id,application_id,environment,owner_id,created_by,updated_by,name,visibility,view_kind,target_object_id,definition,audit)
    values (9101,$1,$2,$3,$3,$3,'Restored pipeline','personal','kanban','sales.object.opportunity',$4::jsonb,'[{"kind":"fixture-saved-view"}]'::jsonb)`,
  [applicationId, environment, ownerId, JSON.stringify({ fields: ["name", "stage-id"], grouping: "stage-id", pageSize: 25, pipelineId: pipeline.id })]);
}

async function releaseProof() {
  const manifest = PackageReleaseManifestSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8")));
  const packageDirectory = resolve(repositoryRoot, "fixtures/customer-gate-1/packages");
  for (const entry of manifest.packages) {
    const archive = resolve(packageDirectory, `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`);
    assert.equal(existsSync(archive), true, `Current-v1 package closure is missing ${entry.package}.`);
    assert.equal(`sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`, entry.integrity, `${entry.package} package bytes do not match release closure.`);
  }
  for (const [theme, lock] of Object.entries(manifest.factoryLockTemplates)) {
    const path = resolve(packageDirectory, `factory-lock-sales-reference-${theme}-${lock.digest.slice(7)}.yaml`);
    assert.equal(existsSync(path), true, `Current-v1 factory lock closure is missing ${theme}.`);
    assert.equal(`sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`, lock.digest, `${theme} factory lock bytes do not match release closure.`);
  }
  const issued = new WeakMap();
  const authority = createPackageReleaseManifestAuthority({ async verify(token) {
    const evidence = issued.get(token);
    if (evidence === undefined) throw new Error("Release attestation is not issued.");
    return evidence;
  } });
  const attestation = Object.freeze({});
  issued.set(attestation, { subjectDigest: canonicalDigest(manifest), sourceCommit: "c".repeat(40), workflowIdentity: `fixture/p13.9@${"c".repeat(40)}`, materials: [] });
  const release = await authority.verify(manifest, attestation);
  assert.equal(manifest.release.version, "1.0.0");
  assert.doesNotThrow(() => planCreateKnexApplication({
    applicationId: "p139-lock-closure", applicationName: "P13.9 lock closure", theme: "minimal", database: "external",
    packageSource: { kind: "packed-mirror", directory: packageDirectory, authority, release }
  }));
  const forged = Object.freeze({});
  issued.set(forged, { subjectDigest: `sha256:${"0".repeat(64)}`, sourceCommit: "c".repeat(40), workflowIdentity: `fixture/p13.9@${"c".repeat(40)}`, materials: [] });
  await assert.rejects(authority.verify(manifest, forged), /does not bind/u);
  const missingLockManifest = PackageReleaseManifestSchema.parse({ ...manifest, factoryLockTemplates: {
    ...manifest.factoryLockTemplates, minimal: { ...manifest.factoryLockTemplates.minimal, digest: `sha256:${"0".repeat(64)}` }
  } });
  const missingLockAttestation = Object.freeze({});
  issued.set(missingLockAttestation, { subjectDigest: canonicalDigest(missingLockManifest), sourceCommit: "c".repeat(40), workflowIdentity: `fixture/p13.9@${"c".repeat(40)}`, materials: [] });
  const missingLockRelease = await authority.verify(missingLockManifest, missingLockAttestation);
  assert.throws(() => planCreateKnexApplication({
    applicationId: "p139-lock-absence", applicationName: "P13.9 missing lock", theme: "minimal", database: "external",
    packageSource: { kind: "packed-mirror", directory: packageDirectory, authority, release: missingLockRelease }
  }), /factory lock is unavailable/u, "A correctly attested release still fails closed when its exact factory lock is absent.");
}

async function preflightState(client) {
  const tables = (await client.query("select table_name,table_type from information_schema.tables where table_schema='public' order by table_name")).rows;
  const columns = (await client.query(`select table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,is_nullable,column_default,
    character_maximum_length,numeric_precision,numeric_scale,datetime_precision
    from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)).rows;
  const constraints = (await client.query(`select relation.relname as table_name,constraint_record.conname as constraint_name,
    constraint_record.contype as constraint_type,pg_get_constraintdef(constraint_record.oid,true) as definition
    from pg_constraint constraint_record join pg_class relation on relation.oid=constraint_record.conrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public'
    order by relation.relname,constraint_record.conname`)).rows;
  const indexes = (await client.query("select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname")).rows;
  const triggers = (await client.query(`select event_object_table,trigger_name,event_manipulation,action_timing,action_orientation,action_statement
    from information_schema.triggers where trigger_schema='public' order by event_object_table,trigger_name,event_manipulation`)).rows;
  const sequences = (await client.query(`select sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value
    from pg_sequences where schemaname='public' order by sequencename`)).rows;
  const contents = [];
  for (const { table_name } of tables) {
    const quoted = `"${table_name.replaceAll('"', '""')}"`;
    const rows = (await client.query(`select to_jsonb(row_value) as value from ${quoted} row_value order by to_jsonb(row_value)::text collate "C"`)).rows.map(({ value }) => value);
    contents.push({ table: table_name, rows });
  }
  const value = JSON.parse(JSON.stringify({ tables, columns, constraints, indexes, triggers, sequences, contents }));
  return { value, digest: canonicalDigest(value) };
}

async function provePredecessorMismatch(container) {
  const user = container.getUsername();
  assert.equal((await container.exec(["createdb", "-U", user, "p139_mismatch"])).exitCode, 0);
  const mismatchUrl = new URL(container.getConnectionUri()); mismatchUrl.pathname = "/p139_mismatch";
  const pool = new pg.Pool({ connectionString: mismatchUrl.toString(), max: 1 });
  const client = await pool.connect();
  try {
    const db = migrationDb(client);
    await installRegisteredPhase12Predecessor(db, client);
    await layerPhase12ProductState(client);
    await seedPhase12Rows(client);
    await bindMigration(client);
    await client.query("update k_nex_migration_revision set predecessor_revision=22,revision=23 where id=1");
    const before = await preflightState(client);
    await assert.rejects(crmUp({ db }), /maintenance-required: expected fixture migration revision 24/u);
    const after = await preflightState(client);
    assert.deepEqual(after.value, before.value, "A predecessor revision mismatch must preserve all schema, data, revision, and absence-of-evidence state.");
    assert.equal(after.digest, before.digest, "A predecessor mismatch must produce zero mutation before serve.");
  } finally {
    client.release();
    await pool.end();
  }
}

test("P13.9 upgrades the exact Phase-12 Sales predecessor and restores its current-v1 truth into a clean PostgreSQL database", { timeout: 240_000 }, async () => {
  await releaseProof();
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p139_source").withStartupTimeout(120_000).start();
  const source = new pg.Pool({ connectionString: container.getConnectionUri(), max: 1 });
  let restored;
  try {
    const sourceClient = await source.connect();
    let predecessor;
    try {
      const db = migrationDb(sourceClient);
      await installRegisteredPhase12Predecessor(db, sourceClient);
      await layerPhase12ProductState(sourceClient);
      await seedPhase12Rows(sourceClient);
      predecessor = await snapshotPhase12Truth(sourceClient);
      await bindMigration(sourceClient);
      await sourceClient.query("begin");
      try { await applyPhase13(db); await sourceClient.query("commit"); }
      catch (error) { await sourceClient.query("rollback"); throw error; }
      await assertMigratedTruth(sourceClient, predecessor);
      await seedPostUpgradeEvidence(sourceClient);
      const beforeRollback = await sourceClient.query("select count(*)::int as tasks,(select count(*)::int from sales_opportunities) as opportunities,(select count(*)::int from sales_notes) as notes from sales_tasks");
      for (const rollback of [reportsDown, workflowsDown, communicationsDown, movementDown, pipelineDown, crmDown]) {
        await assert.rejects(rollback({ db }), /maintenance-required/u);
      }
      assert.deepEqual(await sourceClient.query("select count(*)::int as tasks,(select count(*)::int from sales_opportunities) as opportunities,(select count(*)::int from sales_notes) as notes from sales_tasks"), beforeRollback);
    } finally { sourceClient.release(); }

    const user = container.getUsername();
    assert.equal((await container.exec(["pg_dump", "-U", user, "--format=custom", "--file=/tmp/p139.dump", "p139_source"])).exitCode, 0);
    assert.equal((await container.exec(["createdb", "-U", user, "p139_restore"])).exitCode, 0);
    const restoredResult = await container.exec(["pg_restore", "-U", user, "--dbname=p139_restore", "--exit-on-error", "--no-owner", "/tmp/p139.dump"]);
    assert.equal(restoredResult.exitCode, 0, restoredResult.stderr);

    const restoredUrl = new URL(container.getConnectionUri()); restoredUrl.pathname = "/p139_restore";
    restored = new pg.Pool({ connectionString: restoredUrl.toString(), max: 1 });
    await assertMigratedTruth(restored, predecessor);
    assert.deepEqual((await restored.query(`select
      (select count(*)::int from sales_activities) as activities,
      (select count(*)::int from sales_saved_views) as saved_views,
      (select count(*)::int from k_nex_role_assignments where state='active') as active_assignments,
      (select count(*)::int from sales_crm_migration_receipts) as migration_receipts,
      (select count(*)::int from sales_pipeline_stage_migration_receipts) as stage_receipts`)).rows, [{
      activities: 1, saved_views: 1, active_assignments: 1, migration_receipts: 1, stage_receipts: 1
    }]);
    assert.deepEqual((await restored.query("select subject,status,occurred_at from sales_activities where id=9001")).rows,
      [{ subject: "Restored customer meeting", status: "completed", occurred_at: new Date("2026-03-02T10:00:00Z") }]);

    await restored.end(); restored = undefined;
    restored = new pg.Pool({ connectionString: restoredUrl.toString(), max: 1 });
    assert.deepEqual((await restored.query("select id,title,status from sales_tasks where id <= 43 order by id")).rows,
      [{ id: 41, title: "Open exact decimal", status: "open" }, { id: 42, title: "Completed no optionals", status: "completed" }, { id: 43, title: "Completed integer decimal", status: "completed" }],
      "A fresh application database session observes restored pipeline/activity/permission/audit truth after restart.");
    await provePredecessorMismatch(container);
  } finally {
    await restored?.end();
    await source.end();
    await container.stop();
  }
});
