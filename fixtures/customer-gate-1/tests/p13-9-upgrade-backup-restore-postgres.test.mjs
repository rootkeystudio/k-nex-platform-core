import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { planCreateKnexApplication } from "@k-nex/composition";
import { PackageReleaseManifestSchema, PluginManifestSchema, StaticCompositionChangePlanSchema, canonicalJson } from "@k-nex/contracts";
import salesManifest from "@k-nex/module-sales-current/manifest" with { type: "json" };
import { salesRegistration } from "@k-nex/module-sales-current/server";
import { AuthorizationLifecycleProjector, PostgresRuntimeExtensionStore, PostgresStaticDeploymentStore, PostgresSystemOperationsStore, SharedStaticPlatformPluginGenerationRebinder, createStaticPlatformPluginAuthorizationDescriptorResolver } from "@k-nex/payload-adapter";
import { DeploymentSupervisor, TrustedStaticApplicationBuildAuthority, backupIsRestorable, createPackageReleaseManifestAuthority, createPlatformPluginLifecycleState, executeCleanRestore, executeDatabaseBackup, executeRegistration, reconcilePlatformPluginAvailability, runtimeInventoryDigest, scopePlatformPluginRegistration } from "@k-nex/runtime";
import pg from "pg";

import { ownershipFromFactoryPlan, releaseLockFromFactoryPlan } from "../../../scripts/lib/phase-13-upgrade-preparation.mjs";

import { down as crmDown, up as crmUp } from "../dist/src/migrations/20260905_000027_crm_core.js";
import { down as pipelineDown, up as pipelineUp } from "../dist/src/migrations/20260907_000030_pipeline_saved_views.js";
import { down as movementDown, up as movementUp } from "../dist/src/migrations/20260907_000031_data_movement.js";
import { down as communicationsDown, up as communicationsUp } from "../dist/src/migrations/20260908_000032_communications.js";
import { down as workflowsDown, up as workflowsUp } from "../dist/src/migrations/20260908_000033_crm_workflows.js";
import { down as reportsDown, up as reportsUp } from "../dist/src/migrations/20260908_000034_reports.js";
import { down as staticRebindLockProtocolDown, up as staticRebindLockProtocolUp } from "../dist/src/migrations/20260909_000035_static_rebind_lock_protocol.js";
import { migrations } from "../dist/src/migrations/index.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
// The source checkout and database use the exact accepted application id. The
// branded backup API requires a namespaced ResourceId; it is only a referenced
// proof, while durable system-operation and deployment receipts use this app id.
const applicationId = "customer-gate-1";
const lifecycleApplicationId = "backup.customer-gate-1";
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
// This is the hand-maintained fixture migration lineage, not the registry the
// shipped factory emits: the two have different identities and lengths. It
// exercises the physical backup/restore journey only. Nothing that describes a
// customer upgrade may be derived from it — the attested transition policy
// reads the shipped compiler boundary instead.
const fixturePredecessorNames = [
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
const fixturePhase13MigrationNames = [
  "20260905_000027_crm_core",
  "20260907_000030_pipeline_saved_views",
  "20260907_000031_data_movement",
  "20260908_000032_communications",
  "20260908_000033_crm_workflows",
  "20260908_000034_reports",
  "20260909_000035_static_rebind_lock_protocol"
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
  const predecessor = migrations.slice(0, fixturePredecessorNames.length);
  assert.deepEqual(predecessor.map(({ name }) => name), fixturePredecessorNames, "Phase 12 predecessor migration registry/order changed.");
  assert.equal(migrations[predecessor.length]?.name, fixturePhase13MigrationNames[0], "Phase 13 cutover must immediately follow the accepted predecessor sequence.");
  for (const migration of predecessor) await migration.up({ db });
  assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision where id=1")).rows,
    [{ predecessor_revision: 23, revision: 24 }], "The complete registered predecessor must end at accepted revision 24.");
}

async function layerPhase12ProductState(client, protectedBaselineRuntime) {
  await client.query("insert into k_nex_authorization_state (application_id,authorization_revision,lifecycle_revision) values ($1,7,3)", [applicationId]);
  if (protectedBaselineRuntime) {
    const release = protectedBaselineRuntime.currentProtectedPlatformRoleBaselineRelease;
    for (const baseline of release.baselines) {
      await client.query("insert into k_nex_roles(application_id,role_id,label,protected_role_id,revision) values ($1,$2,$3,$2,1)",
        [applicationId, baseline.id, protectedBaselineRuntime.protectedPlatformRoleLabels[baseline.id]]);
      for (const permissionId of baseline.permissionIds) {
        await client.query(`insert into k_nex_role_permission_grants
          (application_id,grant_id,role_id,permission_id,owner_kind,owner_namespace,revision) values ($1,$2,$3,$4,'platform','system',1)`,
        [applicationId, protectedBaselineRuntime.protectedRoleBootstrapId(applicationId, "grant", baseline.id, permissionId), baseline.id, permissionId]);
      }
    }
    await client.query(`insert into k_nex_role_assignments(application_id,assignment_id,role_id,subject_kind,subject_id,state,revision)
      values ($1,'p139-protected-owner','system.role.owner','user','user:migration-owner','active',1)`, [applicationId]);
    await client.query(`insert into k_nex_authorization_bootstrap_receipts
      (application_id,receipt_id,owner_role_id,owner_assignment_id,owner_principal_kind,owner_principal_id,protected_baseline_version,protected_baseline_digest,authorization_revision,state)
      values ($1,'p139-protected-receipt','system.role.owner','p139-protected-owner','user','user:migration-owner',$2,$3,7,'committed')`,
    [applicationId, release.version, release.digest]);
  }
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
        '{"schemaVersion":1,"identity":{"applicationId":"customer-gate-1","environment":"production","pageId":"customer.upgrade-dashboard","documentId":"customer.upgrade-dashboard-document"},"access":{"readPermissionId":"sales.reports.read"}}'::jsonb,
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
  assert.deepEqual(migrations.slice(-fixturePhase13MigrationNames.length).map(({ name }) => name), fixturePhase13MigrationNames,
    "This fixture registry must expose the exact Phase 13 fixture migration sequence; the shipped factory registry is proved separately by the P13.9 preparation proof.");
  for (const migrate of [crmUp, pipelineUp, movementUp, communicationsUp, workflowsUp, reportsUp, staticRebindLockProtocolUp]) await migrate({ db });
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
    constraint_record.contype as constraint_type,constraint_record.convalidated as validated,pg_get_constraintdef(constraint_record.oid,true) as definition
    from pg_constraint constraint_record join pg_class relation on relation.oid=constraint_record.conrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace where namespace.nspname='public'
    order by relation.relname,constraint_record.conname`)).rows;
  const indexes = (await client.query(`select table_record.relname as tablename,index_record.relname as indexname,
    index_state.indisvalid,index_state.indisready,index_state.indisunique,index_state.indisprimary,pg_get_indexdef(index_record.oid) as indexdef
    from pg_index index_state join pg_class index_record on index_record.oid=index_state.indexrelid
    join pg_class table_record on table_record.oid=index_state.indrelid
    join pg_namespace namespace on namespace.oid=table_record.relnamespace where namespace.nspname='public'
    order by table_record.relname,index_record.relname`)).rows;
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
      for (const rollback of [staticRebindLockProtocolDown, reportsDown, workflowsDown, communicationsDown, movementDown, pipelineDown, crmDown]) {
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

// P13.9 protection proof. This intentionally uses the accepted source commit and its
// 1.0 package mirror. The current fixture is the 1.1 target and must never be used as
// the recovery application in this test.
const p139AcceptedSourceCommit = "c8fe7f2518c219957297155e307768837186ec5f";
const p139AcceptedManifestDigest = "sha256:1d8b40e0073fb24d42f47bc3a0fd763db0a0fb5baf706120f7fe3a2768c13eea";
const p139SourceGeneration = "p139-source-generation-1";
const p139TargetGeneration = "p139-target-generation-2";
const p139SourceFenceOwner = "p139-upgrade-quiesce";
const p139TargetFenceOwner = "p139-target-worker";

function p139Freeze(value) {
  if (ArrayBuffer.isView(value)) return value;
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) p139Freeze(child);
    Object.freeze(value);
  }
  return value;
}

function p139MemoryStore() {
  const values = new Map();
  return {
    async write({ content, encryptionKeyReference }) {
      const chunks = []; const hash = createHash("sha256"); let byteLength = 0;
      for await (const chunk of content) { const copy = Buffer.from(chunk); chunks.push(copy); hash.update(copy); byteLength += copy.byteLength; }
      const storageKey = `sha256:${hash.digest("hex")}`; values.set(storageKey, chunks);
      return { storageKey, byteLength, encryptionKeyReference };
    },
    async *read(storageKey) {
      const chunks = values.get(storageKey); if (!chunks) throw new Error("P13.9 backup object is unavailable.");
      yield* chunks;
    }
  };
}

function p139PlanWithMigrations(plan, directory) {
  const migrationFiles = execFileSync("find", [directory, "-maxdepth", "1", "-type", "f", "-name", "*.ts", "-print"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const files = Object.fromEntries(Object.entries(plan.files).filter(([path]) => !path.startsWith("src/migrations/")));
  for (const path of migrationFiles) files[`src/migrations/${path.slice(path.lastIndexOf("/") + 1)}`] = readFileSync(path, "utf8");
  return { ...plan, files };
}

async function p139AssertOperationAwaitingRestore(pool, operation) {
  const result = await pool.query(`select request.state,
    count(receipt.receipt_id) filter (where receipt.terminal)::int as terminal_receipts
    from k_nex_system_operation_requests request
    left join k_nex_system_operation_receipts receipt on receipt.operation_id=request.operation_id
    where request.operation_id=$1
    group by request.state`, [operation.claim.request.reference.operationId]);
  assert.deepEqual(result.rows, [{ state: "processing", terminal_receipts: 0 }],
    "Backup operation must remain nonterminal until an actual clean restore verifies the backup.");
}

function p139AcceptedSourceIdentity(predecessorFactory, sourceTree) {
  const sourceManifestContent = readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"));
  assert.equal(`sha256:${createHash("sha256").update(sourceManifestContent).digest("hex")}`, p139AcceptedManifestDigest,
    "P13.9 source must use the immutable accepted 1.0 manifest.");
  const sourceManifest = PackageReleaseManifestSchema.parse(JSON.parse(sourceManifestContent));
  const token = Object.freeze({});
  const authority = { read(candidate) { if (candidate !== token) throw new TypeError("unverified accepted release"); return { manifest: sourceManifest, digest: canonicalDigest(sourceManifest), attestation: { localExactArtifact: true } }; } };
  const factoryInput = {
    applicationId, applicationName: "Customer Gate 1", theme: "minimal", database: "external",
    packageSource: { kind: "packed-mirror", directory: resolve(repositoryRoot, "fixtures/customer-gate-1/packages"), authority, release: token }
  };
  const rawPlan = predecessorFactory.planCreateKnexApplication(factoryInput);
  const replayedRawPlan = predecessorFactory.planCreateKnexApplication(factoryInput);
  assert.deepEqual(replayedRawPlan, rawPlan, "Accepted c8fe factory inputs must reproduce every managed/control byte and artifact digest.");
  assert.equal(rawPlan.applicationId, applicationId);
  assert.equal(Object.keys(rawPlan.artifactDigests).length, sourceManifest.packages.length,
    "Accepted factory must verify the complete immutable 1.0 package closure.");
  assert.equal(`sha256:${createHash("sha256").update(rawPlan.files["pnpm-lock.yaml"]).digest("hex")}`,
    sourceManifest.factoryLockTemplates.minimal.digest, "Accepted factory must reproduce the exact minimal lock bytes.");
  const sourcePlan = p139PlanWithMigrations(rawPlan, resolve(sourceTree, "fixtures/customer-gate-1/src/migrations"));
  for (const [path, content] of Object.entries(sourcePlan.files).filter(([path]) => path.startsWith("src/migrations/"))) {
    assert.equal(content, execFileSync("git", ["show", `${p139AcceptedSourceCommit}:fixtures/customer-gate-1/${path}`], { cwd: repositoryRoot, encoding: "utf8" }),
      `Accepted migration bytes changed: ${path}`);
  }
  const sourceApplicationManifest = JSON.parse(sourcePlan.files["k-nex.app.json"]);
  assert.deepEqual(sourceApplicationManifest.plugins.map(({ id }) => id), ["module.sales"]);
  assert.deepEqual(sourceApplicationManifest.providers, {}, "Accepted factory selected no realtime provider; checkout runtime defaults cannot invent one.");
  assert.equal(sourceApplicationManifest.builder.plugin, "builder.puck");
  assert.equal(sourceApplicationManifest.themes.active, "minimal");
  const sourceTreeDigest = canonicalDigest(Object.fromEntries(Object.entries(sourcePlan.files).sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => [path, `sha256:${createHash("sha256").update(content).digest("hex")}`])));
  const ownership = ownershipFromFactoryPlan({ plan: sourcePlan, release: sourceManifest });
  for (const record of ownership.files) assert.equal(record.digest, `sha256:${createHash("sha256").update(sourcePlan.files[record.path]).digest("hex")}`,
    `Accepted ownership digest does not bind exact factory bytes: ${record.path}`);
  const migrationSetDigest = canonicalDigest(ownership.files.filter(({ mode }) => mode === "append-only").map(({ path, digest }) => ({ path, digest })));
  const sourceLock = releaseLockFromFactoryPlan({ plan: sourcePlan, release: sourceManifest, releaseManifestDigest: p139AcceptedManifestDigest, ownership, migrationSetDigest });
  assert.equal(ownership.applicationId, applicationId);
  assert.equal(sourceLock.applicationId, applicationId);
  const selectedPluginIds = [
    ...sourceApplicationManifest.plugins.map(({ id }) => id),
    ...Object.values(sourceApplicationManifest.providers).map(({ plugin }) => plugin),
    sourceApplicationManifest.builder.plugin,
    `theme.${sourceApplicationManifest.themes.active}`
  ].sort();
  assert.deepEqual(sourceLock.plugins.map(({ id }) => id), selectedPluginIds,
    "Accepted release lock must bind exactly the plugins/providers selected by the reproduced factory plan.");
  const packages = sourceLock.packages;
  return p139Freeze({
    sourceCommit: p139AcceptedSourceCommit, sourceTreeDigest, sourceManifestDigest: p139AcceptedManifestDigest,
    sourceManifest, sourceApplicationManifest, sourceLock, sourceLockDigest: canonicalDigest(sourceLock),
    ownership, ownershipDigest: canonicalDigest(ownership), resolvedGraphDigest: canonicalDigest(sourceLock.plugins),
    packageClosureDigest: canonicalDigest(packages)
  });
}

function p139RuntimeInventory(identity, release, migrationRevision, target = false) {
  const manifest = target ? PackageReleaseManifestSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.1.0/package-release-manifest.json"), "utf8"))) : identity.sourceManifest;
  const applicationManifest = target ? JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/k-nex.app.json"), "utf8")) : identity.sourceApplicationManifest;
  const manifestDigest = target ? canonicalDigest(manifest) : identity.sourceManifestDigest;
  const packages = manifest.packages.map(({ package: packageName, version, integrity }) => ({ package: packageName, version, integrity }));
  const plugins = applicationManifest.plugins.map(({ id, package: packageName, version, enabled }) => ({ id, package: packageName, version, enabled }));
  const graphDigest = target ? canonicalDigest(JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/.k-nex/generated/k-nex.resolved.json"), "utf8"))) : identity.resolvedGraphDigest;
  return p139Freeze({
    schemaVersion: 1, applicationId, repository: "rootkeystudio/k-nex-platform-core", environment, platformRelease: release,
    observedAt: "2026-09-16T00:00:00.000Z", artifactDigest: target ? canonicalDigest({ target: p139TargetGeneration }) : identity.sourceTreeDigest,
    releaseEvidence: {
      sourceCommit: target ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim() : identity.sourceCommit,
      workflowIdentity: `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${target ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim() : identity.sourceCommit}`,
      manifestDigest, lockfileDigest: target ? canonicalDigest(manifest.packages) : identity.sourceLockDigest, resolvedGraphDigest: graphDigest,
      frameworkDigest: canonicalDigest(manifest.framework), sbomDigest: canonicalDigest(packages), provenanceDigest: canonicalDigest({ release, sourceCommit: target ? "target" : identity.sourceCommit })
    },
    packages, plugins, migrationRevision,
    settings: [{ id: "system.general", schemaVersion: target ? 3 : 1, revision: target ? 3 : 3 }],
    templates: [{ id: "customer.upgrade-dashboard", templateVersion: 1, revision: 3 }],
    health: { status: "ready", checks: ["database", "migration-ledger", "worker-fence", "sales-registration"] }
  });
}

const p139Operator = Object.freeze({ kind: "service", id: "phase-13-upgrade-operator" });

function p139OperationEnvelope(kind) {
  return p139Freeze({
    schemaVersion: 1, applicationId, environment, principal: p139Operator, effectiveActor: p139Operator,
    authorizationRevision: 7, lifecycleRevision: 3,
    permissions: [{ decisionId: `p139-${kind}-authority`, permissionId: kind === "backup" ? "system.operations.backup" : "system.operations.restore-drill",
      owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.operations" } }]
  });
}

function p139OperationRequest(kind, expectedOperationsRevision, idempotencyKey, expectedInventoryDigest) {
  return p139Freeze({ kind, applicationId, environment, expectedOperationsRevision, expectedInventoryDigest,
    requestedBy: p139Operator, authorityEnvelope: p139OperationEnvelope(kind), idempotencyKey });
}

async function p139ClaimOperation(store, request, workerId) {
  const accepted = await store.submit(request);
  assert.equal(accepted.outcome, "accepted");
  assert.deepEqual(await store.submit(request), accepted, "Response-loss submit replay must return the exact durable receipt.");
  assert.deepEqual(await store.replay({ kind: request.kind, applicationId, environment, expectedOperationsRevision: request.expectedOperationsRevision,
    requestedBy: p139Operator, authorityEnvelope: request.authorityEnvelope, idempotencyKey: request.idempotencyKey }), accepted);
  const claim = await store.claim({ applicationId, environment, workerId, leaseSeconds: 300 });
  assert.ok(claim);
  assert.equal(claim.request.reference.operationId, accepted.reference.operationId);
  return { accepted, claim, request };
}

async function p139CompleteOperation(store, operation, referenceReceiptId) {
  const proof = { outcome: "completed", referenceReceiptId, cleanEnvironmentRestore: true };
  const completed = await store.complete(operation.claim.request.reference.operationId, operation.claim.leaseToken, proof);
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.reference.receiptId, referenceReceiptId);
  assert.deepEqual(await store.complete(operation.claim.request.reference.operationId, operation.claim.leaseToken, proof), completed,
    "Post-commit response loss must replay the immutable completion receipt.");
  assert.deepEqual(await store.submit(operation.request), completed, "Terminal submit replay must return the exact completion receipt.");
  return completed;
}

function p139TrustedBuild(identity, targetCommit) {
  const fixture = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/extensions/valid/static-composition-change-plan.json"), "utf8"));
  const targetManifest = PackageReleaseManifestSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, "releases/1.1.0/package-release-manifest.json"), "utf8")));
  const baseComposition = { ...fixture.base.composition, applicationManifestDigest: canonicalDigest(identity.sourceApplicationManifest),
    lockfileDigest: identity.sourceLockDigest, packageClosureDigest: identity.packageClosureDigest, resolvedGraphDigest: identity.resolvedGraphDigest };
  const targetComposition = { ...fixture.target.composition,
    applicationManifestDigest: canonicalDigest(JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/k-nex.app.json"), "utf8"))),
    lockfileDigest: canonicalDigest(targetManifest.packages), packageClosureDigest: canonicalDigest(targetManifest.packages),
    resolvedGraphDigest: canonicalDigest(JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/customer-gate-1/.k-nex/generated/k-nex.resolved.json"), "utf8"))) };
  const targetApplicationDigest = canonicalDigest({ applicationId, release: "1.1.0", targetCommit });
  const targetImageDigest = canonicalDigest({ image: applicationId, release: "1.1.0", targetCommit });
  delete fixture.$schema;
  const change = StaticCompositionChangePlanSchema.parse({
    ...fixture, applicationId, environment, planId: "p139-release-transition-1-0-to-1-1", status: "source-change-ready",
    base: { composition: baseComposition, sourceCommit: identity.sourceCommit },
    plugin: { ...fixture.plugin, id: "module.sales", version: "1.1.0", releaseManifestDigest: canonicalDigest(targetManifest) },
    migration: { ...fixture.migration, applicationId, environment, baseRevision: 24, targetRevision: 25,
      planId: "p139-exact-seven-migrations", sourceCommit: identity.sourceCommit, targetSourceCommit: targetCommit,
      rollbackWindow: { state: "open", windowId: "p139-source-protection", closesAt: new Date(Date.now() + 60 * 60_000).toISOString(), contractCleanup: "blocked", previousApplicationDigest: identity.sourceTreeDigest },
      steps: fixturePhase13MigrationNames.map((migrationName) => ({ stepId: `migration-${migrationName.replaceAll("_", "-")}`, phase: "online-expand", migrationDigest: canonicalDigest({ migrationName }), overlapSafe: true })) },
    target: { applicationSubjectDigest: targetApplicationDigest, imageSubjectDigest: targetImageDigest, composition: targetComposition, sourceCommit: targetCommit }
  });
  const keys = generateKeyPairSync("ed25519");
  const buildAuthority = { kind: "self-hosted-trusted", builderIdentity: "builder:p139-upgrade", trustPolicyDigest: canonicalDigest({ policy: "p139" }), ref: "source-commit" };
  const statement = { schemaVersion: 1, applicationId, environment, sourceCommit: targetCommit, authority: buildAuthority,
    composition: targetComposition, sbomDigest: canonicalDigest(targetManifest.packages), provenanceDigest: canonicalDigest({ targetCommit, release: "1.1.0" }),
    applicationSubject: { name: "customer-gate-1-application.tar.gz", digest: targetApplicationDigest },
    imageSubject: { repository: "ghcr.io/rootkeystudio/customer-gate-1", digest: targetImageDigest } };
  const evidence = { ...statement, signature: { algorithm: "ed25519", keyId: buildAuthority.builderIdentity,
    value: sign(null, Buffer.from(canonicalJson(statement)), keys.privateKey).toString("base64") } };
  const verifiedChange = { status: "source-change-ready", planDigest: canonicalDigest(change), targetSourceCommit: targetCommit, change };
  const authority = new TrustedStaticApplicationBuildAuthority({ [buildAuthority.builderIdentity]: {
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), authority: buildAuthority
  } });
  return p139Freeze({ authority, token: authority.verify(verifiedChange, evidence), verifiedChange, evidence,
    sourceGeneration: { generationId: p139SourceGeneration, sourceCommit: identity.sourceCommit, compositionChangePlanDigest: canonicalDigest(change.base),
      buildEvidenceDigest: canonicalDigest({ sourceCommit: identity.sourceCommit }), applicationDigest: identity.sourceTreeDigest,
      imageDigest: canonicalDigest({ image: applicationId, release: "1.0.0" }), imageReference: `ghcr.io/rootkeystudio/customer-gate-1@${canonicalDigest({ image: applicationId, release: "1.0.0" })}`, migrationRevision: 24 } });
}

function p139ScopedSalesRegistration() {
  const manifest = PluginManifestSchema.parse(salesManifest);
  const registration = executeRegistration({
    graph: { resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version,
      integrity: "sha512-c2FsZXM=", required: [], optional: [] }], capabilityProviders: [], registrationOrder: [manifest.id] },
    installed: [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" }, manifest }],
    registrations: [salesRegistration]
  });
  return scopePlatformPluginRegistration(registration, [reconcilePlatformPluginAvailability(registration,
    createPlatformPluginLifecycleState({ pluginId: manifest.id, catalogStatus: "supported",
      package: { status: "installed", name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" }, enabled: true,
      configuration: { revision: 1, ready: true }, migration: { current: 25, required: 25, ready: true }, dataState: "active", releaseStatus: "supported" }))]);
}

async function p139InstallSourceRuntime(client, identity, deploymentStore, build, workerLeaseExpiresAt) {
  await deploymentStore.initialize({ applicationId, environment, generation: build.sourceGeneration, workerOwner: p139SourceFenceOwner,
    workerFencingToken: 1, workerLeaseExpiresAt });
  const generation = { authority: "static-build", generationId: p139SourceGeneration, version: "1.0.0", sourceCommit: identity.sourceCommit,
    compositionChangePlanDigest: build.sourceGeneration.compositionChangePlanDigest, buildEvidenceDigest: build.sourceGeneration.buildEvidenceDigest,
    applicationDigest: build.sourceGeneration.applicationDigest, imageDigest: build.sourceGeneration.imageDigest, migrationRevision: 24,
    workerFencingToken: 1, receiptId: "p139-source-accepted" };
  const operationId = "operation-p139-upgrade-1-0-to-1-1";
  await client.query(`insert into runtime_extensions
      (application_id,environment,delivery_class,extension_id,revision,disposition,active_generation_id,active_generation,last_operation_id)
      values ($1,$2,'platform-plugin','module.sales',0,'active',$3,$4::jsonb,$5)`, [applicationId, environment, p139SourceGeneration, JSON.stringify(generation), operationId]);
  await client.query("insert into runtime_extension_inventory_revisions(application_id,environment,revision) values ($1,$2,0)", [applicationId, environment]);
  await client.query("update k_nex_extension_authorization_generations set runtime_generation_ids=$2::jsonb where application_id=$1 and extension_id='module.sales' and state='current'",
    [applicationId, JSON.stringify([p139SourceGeneration])]);
  await client.query(`insert into runtime_extension_operations
      (operation_id,application_id,environment,delivery_class,extension_id,operation_kind,idempotency_key,request_digest,request_json,authorization_json,
       expected_revision,phase,lease_owner,lease_token,lease_expires_at,plan_json)
      values ($1,$2,$3,'platform-plugin','module.sales','update','p139-upgrade',$4,
       '{"idempotencyKey":"p139-upgrade","correlationId":"p139-upgrade"}'::jsonb,
       '{"actor":{"kind":"trusted-automation","identity":"phase-13-upgrade"},"decisionId":"sha256:9999999999999999999999999999999999999999999999999999999999999999"}'::jsonb,
       0,'source-change-ready',
       'worker:p139','lease-p139',$5,$6::jsonb)`, [operationId, applicationId, environment, canonicalDigest({ operationId }), workerLeaseExpiresAt,
      JSON.stringify({ executionClass: "static-release", preparation: "prepared", operationId, generationId: p139TargetGeneration, quarantineRecovery: false,
        sourceCommit: identity.sourceCommit, sourceChange: build.verifiedChange,
        deployment: { buildRequestDigest: canonicalDigest({ operationId, target: p139TargetGeneration }), sourceCommit: build.verifiedChange.targetSourceCommit, status: "builder-attested" },
        plan: { schemaVersion: 1, operationId, operation: "update", version: "1.1.0", artifactDigest: build.verifiedChange.change.plugin.releaseManifestDigest,
          expectedRevision: 0, currentGenerationId: p139SourceGeneration, targetGenerationId: p139TargetGeneration, approvalRequired: true,
          rollback: { available: true, windowSeconds: 3600 }, deliveryClass: "platform-plugin", id: "module.sales",
          availability: { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true,
            writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } } } })]);
  await client.query(`insert into k_nex_outbox
      (event_id,event_type,schema_version,message_class,occurred_at,application_id,plugin_id,actor_id,actor_type,correlation_id,causation_id,idempotency_key,payload,status,attempt_count,retention_until)
      values ('p139-source-event','sales.upgrade.source-marker',1,'durable-integration','2026-09-16T00:00:00Z',$1,'module.sales','p139-owner','service','p139-upgrade','p139-upgrade','p139-source-idempotency','{"source":"1.0.0"}'::jsonb,'pending',0,'2026-10-16T00:00:00Z')
      on conflict do nothing`, [applicationId]);
  await client.query("insert into payload_migrations(name,batch) select name,12 from unnest($1::text[]) as names(name)", [fixturePredecessorNames]);
  return p139Freeze({ operationId, expectedRevision: 0, extensionId: "module.sales", quarantineRecovery: false });
}

async function p139ReadBoundary(client) {
  const deployment = (await client.query(`select active_generation_id,active_generation,revision,transition_checkpoint,state_digest from runtime_static_deployments where application_id=$1 and environment=$2`, [applicationId, environment])).rows[0];
  const fence = (await client.query(`select active_execution_generation,fencing_token,lease_owner,promotion_revision from runtime_worker_generation_fences where application_id=$1 and environment=$2`, [applicationId, environment])).rows[0];
  const outbox = (await client.query("select event_id,event_type,idempotency_key,status from k_nex_outbox where application_id=$1 order by event_id", [applicationId])).rows;
  const staticOutbox = (await client.query("select event_id,revision,status from runtime_static_deployment_outbox where application_id=$1 and environment=$2 order by event_id", [applicationId, environment])).rows;
  return p139Freeze({ deployment, fence, outbox, staticOutbox,
    targetGenerations: Number((await client.query("select count(*)::int as count from runtime_extension_generations where application_id=$1 and environment=$2", [applicationId, environment])).rows[0].count),
    targetActivations: Number((await client.query("select count(*)::int as count from runtime_static_worker_activations where application_id=$1 and environment=$2", [applicationId, environment])).rows[0].count),
    releaseRequests: Number((await client.query("select count(*)::int as count from runtime_static_release_requests where application_id=$1 and environment=$2", [applicationId, environment])).rows[0].count) });
}

async function p139ReadSourceTruth(client) {
  return p139Freeze({
    revision: (await client.query("select predecessor_revision,revision from k_nex_migration_revision where id=1")).rows,
    ledger: (await client.query("select name,batch from payload_migrations order by id")).rows,
    tasks: (await client.query("select id,title,status,potential_revenue,private_note from sales_tasks where id<=43 order by id")).rows,
    opportunities: (await client.query("select id,name,stage,value from sales_opportunities where id<=54 order by id")).rows,
    grants: (await client.query("select role_id,permission_id from k_nex_role_permission_grants where application_id=$1 order by role_id,permission_id", [applicationId])).rows,
    settings: (await client.query("select descriptor_id,descriptor_schema_version,document_revision,settings_revision,values_json from k_nex_system_settings_documents where application_id=$1 order by descriptor_id", [applicationId])).rows,
    pages: (await client.query("select page_id,page_revision,working_copy_revision,access_revision from k_nex_workspace_pages where application_id=$1 order by page_id", [applicationId])).rows,
    outbox: (await client.query("select event_id,idempotency_key,status,payload from k_nex_outbox where application_id=$1", [applicationId])).rows
  });
}

async function p139AssertNoTargetWrites(client) {
  const counts = (await client.query(`select
    (select count(*)::int from sales_action_idempotency) as idempotency,
    (select count(*)::int from sales_provider_operations) as provider_operations,
    (select count(*)::int from sales_workflow_executions) as workflow_executions,
    (select count(*)::int from sales_report_runs) as report_runs,
    (select count(*)::int from sales_activities) as activities,
    (select count(*)::int from sales_saved_views) as saved_views,
    (select count(*)::int from sales_notifications) as notifications,
    (select count(*)::int from sales_reminders) as reminders`)).rows[0];
  assert.deepEqual(counts, { idempotency: 0, provider_operations: 0, workflow_executions: 0, report_runs: 0, activities: 0, saved_views: 0, notifications: 0, reminders: 0 },
    "Failure before target readiness must not create user, worker, or integration writes.");
}

async function p139PhysicalBackup(container, database, backupId, pluginId = "module.sales", migrationRevision = 24) {
  const user = container.getUsername();
  const path = `/tmp/${backupId}.dump`;
  const dump = await container.exec(["pg_dump", "-U", user, "--format=custom", `--file=${path}`, database]);
  assert.equal(dump.exitCode, 0, dump.stderr);
  const encoded = await container.exec(["base64", path]); assert.equal(encoded.exitCode, 0, encoded.stderr);
  const content = Buffer.from(encoded.stdout.replace(/\s/gu, ""), "base64");
  const store = p139MemoryStore();
  const backup = await executeDatabaseBackup({
    backupId, applicationId: lifecycleApplicationId, pluginId, migrationRevision,
    executor: { store, maximumBytes: 128 * 1024 * 1024, encryptionKeyReference: `secret:backup/${backupId}`, createBackup: async function* () {
      for (let offset = 0; offset < content.byteLength; offset += 16 * 1024) yield content.subarray(offset, offset + 16 * 1024);
    } }
  });
  assert.equal(backup.contentDigest, `sha256:${createHash("sha256").update(content).digest("hex")}`);
  return p139Freeze({ backup, content, user, path });
}

async function p139RestoreDatabase(container, user, content, database, path) {
  const created = await container.exec(["createdb", "-U", user, database]); assert.equal(created.exitCode, 0, created.stderr);
  await container.copyContentToContainer([{ content: Readable.from(content), target: path }]);
  const restored = await container.exec(["pg_restore", "-U", user, "--dbname", database, "--exit-on-error", "--no-owner", path]);
  assert.equal(restored.exitCode, 0, restored.stderr);
}

async function p139CleanRestore(container, user, backup, database, path, inventory) {
  const restore = await executeCleanRestore(backup, {
    restoreCleanEnvironment: async ({ applicationId: restoredApplicationId, pluginId, migrationRevision, content, contentDigest, byteLength }) => {
      assert.equal(restoredApplicationId, lifecycleApplicationId);
      assert.equal(pluginId, "module.sales");
      assert.equal(migrationRevision, inventory.migrationRevision);
      const chunks = []; const hash = createHash("sha256"); let restoredBytes = 0;
      for await (const chunk of content) {
        const copy = Buffer.from(chunk); chunks.push(copy); hash.update(copy); restoredBytes += copy.byteLength;
      }
      assert.equal(restoredBytes, byteLength, "Clean restore must consume the complete verified backup stream.");
      assert.equal(`sha256:${hash.digest("hex")}`, contentDigest, "Clean restore must consume the exact verified backup bytes.");
      await p139RestoreDatabase(container, user, Buffer.concat(chunks), database, path);
      return {
        applicationId: restoredApplicationId, pluginId, migrationRevision, cleanEnvironment: true,
        externalEffects: "disabled", runtimeInventoryDigest: runtimeInventoryDigest(inventory)
      };
    }
  });
  assert.equal(backupIsRestorable(backup, restore), true, "Clean restore must be issued from the same verified backup receipt.");
  const url = new URL(container.getConnectionUri()); url.pathname = `/${database}`;
  return p139Freeze({ restore, url });
}

function p139RestoreComparable(preflight) {
  const deparse = (value) => value
    .replace(/\((('[^']*')::character varying)\)::text/gu, "$1")
    .replace(/::character varying::text/gu, "::character varying")
    .replace(/\(ARRAY\[([^\]]*)\]\)::text\[\]/gu, "ARRAY[$1]")
    .replace(/ARRAY\[([^\]]*)\]::text\[\]/gu, "ARRAY[$1]");
  return {
    ...preflight.value,
    columns: preflight.value.columns.map(({ ordinal_position: _physicalAttnum, ...semantic }) => semantic),
    constraints: preflight.value.constraints.map((constraint) => ({ ...constraint, definition: deparse(constraint.definition) })),
    indexes: preflight.value.indexes.map((index) => ({ ...index, indexdef: deparse(index.indexdef) }))
  };
}

function p139RollbackComparable(preflight) {
  return {
    ...preflight.value,
    sequences: preflight.value.sequences.map(({ last_value: _lastValue, ...configuration }) => configuration)
  };
}

function p139RunExactSourceApplication(sourceTree, connectionString) {
  const fixture = resolve(sourceTree, "fixtures/customer-gate-1");
  const child = spawn(process.execPath, ["tests/boot-once.mjs"], { cwd: fixture, env: {
      ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p13-9-exact-v1-source", BOOT_KEY: "p13-9-exact-v1-source"
    }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (value) => { output += value; });
  child.stderr.setEncoding("utf8").on("data", (value) => { output += value; });
  let deadline;
  const finished = new Promise((resolveProcess, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(deadline); resolveProcess({ code, signal, output }); });
  });
  deadline = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000); killTimer.unref();
    }
  }, 30_000); deadline.unref();
  const stop = async () => {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([finished, new Promise((resolveStop) => setTimeout(resolveStop, 2_000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    return finished;
  };
  return { child, finished, stop };
}

async function p139ApplyTargetWithFailpoint(db, client, failAfter) {
  const migrations13 = [crmUp, pipelineUp, movementUp, communicationsUp, workflowsUp, reportsUp, staticRebindLockProtocolUp];
  for (const [index, migrate] of migrations13.entries()) {
    await migrate({ db });
    if (failAfter !== undefined && index + 1 === failAfter) throw new Error("P13_9_MIGRATION_FAILPOINT");
  }
  await client.query("insert into payload_migrations(name,batch) select name,13 from unnest($1::text[]) as names(name)", [fixturePhase13MigrationNames]);
}

function p139DeploymentSupervisor({ client, db, store, build, failBeforeReadiness = false }) {
  const events = [];
  let workerHealthy = false;
  const migrationsAdapter = {
    async runOnline() {
      const existing = (await client.query("select name from payload_migrations where name=any($1::text[]) order by id", [fixturePhase13MigrationNames])).rows.map(({ name }) => name);
      if (existing.length === 0) {
        await client.query("begin");
        try { await p139ApplyTargetWithFailpoint(db, client); await client.query("commit"); }
        catch (error) { await client.query("rollback"); throw error; }
      } else assert.deepEqual(existing, fixturePhase13MigrationNames, "Deployment may acknowledge only the exact already-applied seven-migration set.");
      events.push("exact-seven-migrations");
      return build.verifiedChange.change.migration.steps.map(({ stepId }) => stepId);
    },
    async runPostRetirement() { return []; }
  };
  const artifacts = {
    async resolve(evidence) { return { imageReference: `${evidence.imageSubject.repository}@${evidence.imageSubject.digest}`,
      applicationDigest: evidence.applicationSubject.digest, imageDigest: evidence.imageSubject.digest, runtimeImageDigest: evidence.imageSubject.digest }; },
    async reverify(generation) { return { imageReference: generation.imageReference, applicationDigest: generation.applicationDigest,
      imageDigest: generation.imageDigest, runtimeImageDigest: generation.imageDigest }; }
  };
  const generations = {
    async start({ workerMode }) { assert.equal(workerMode, "passive"); events.push("start-passive"); },
    async readiness(input) {
      if (failBeforeReadiness) throw new Error("P13_9_FAILPOINT_AFTER_MIGRATIONS_BEFORE_READINESS");
      events.push("passive-readiness");
      return { ...input, publicSmoke: true, authenticatedSmoke: true, inventoryReconciled: true, workerMode: "passive",
        gatewayCapacity: true, realtimeReady: true, observedAt: new Date().toISOString() };
    },
    async activateWorker(ticket) { await store.assertTransitionTicket(ticket); workerHealthy = true; events.push("activate-worker"); },
    async hasHealthyActiveWorker() { return workerHealthy; },
    async recoverActiveWorker(ticket) { await store.assertWorkerRecoveryActivation(ticket); workerHealthy = true; events.push("recover-worker"); },
    async drain(ticket) { await store.assertTransitionTicket(ticket); events.push("drain-source"); },
    async retire({ reservation, ticket }) { if (ticket) await store.assertTransitionTicket(ticket); events.push(`retire:${reservation.generationId}`); }
  };
  const gateway = { async converge(ticket) { await store.assertTransitionTicket(ticket); events.push("converge-gateway"); } };
  const realtime = { async reconnectAndResync(ticket) { await store.assertTransitionTicket(ticket); events.push("reconnect-realtime"); } };
  return { events, supervisor: new DeploymentSupervisor(build.authority, artifacts, migrationsAdapter, generations, store, gateway, realtime, { now: () => new Date() }) };
}

async function p139RunUpgradeOperation({ client, db, sourceBackup, container, user, restoreDatabase, restorePath, sourceInventory, beforeBoundary, store, build, lifecycleAdmission, workerLeaseExpiresAt }) {
  const deployment = p139DeploymentSupervisor({ client, db, store, build, failBeforeReadiness: true });
  await assert.rejects(deployment.supervisor.deploy({ build: build.token, generationId: p139TargetGeneration, workerOwner: p139TargetFenceOwner,
    workerLeaseExpiresAt, lifecycleAdmission }), /P13_9_FAILPOINT_AFTER_MIGRATIONS_BEFORE_READINESS/u);
  const afterMigrationBoundary = await p139ReadBoundary(client);
  assert.equal(afterMigrationBoundary.deployment.active_generation_id, beforeBoundary.deployment.active_generation_id, "Target migration cannot promote a generation.");
  assert.equal(afterMigrationBoundary.fence.active_execution_generation, beforeBoundary.fence.active_execution_generation);
  assert.equal(afterMigrationBoundary.fence.fencing_token, beforeBoundary.fence.fencing_token);
  assert.equal(afterMigrationBoundary.fence.lease_owner, p139SourceFenceOwner);
  assert.deepEqual(deployment.events.slice(0, 2), ["exact-seven-migrations", "start-passive"]);
  await p139AssertNoTargetWrites(client);
  const clean = await p139CleanRestore(container, user, sourceBackup.backup, restoreDatabase, restorePath, sourceInventory);
  return { afterMigrationBoundary, events: deployment.events, ...clean };
}

test("P13.9 protects source with an exact 1.0 process, fences target promotion, and emits immutable recovery evidence", { timeout: 600_000 }, async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "p139-exact-v1-source-")));
  const oldTree = join(temp, "accepted-source");
  let container; let source; let sourceProtectionDrill; let sourceDrill; let targetDrill;
  try {
    execFileSync("git", ["worktree", "add", "--detach", oldTree, p139AcceptedSourceCommit], { cwd: repositoryRoot, stdio: "ignore" });
    const nodeDirectory = resolve(process.execPath, "..");
    const env = { ...process.env, PATH: `${nodeDirectory}:${process.env.PATH}` };
    execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], { cwd: oldTree, env, stdio: "ignore" });
    // The accepted 1.0 customer script bundles before tsc; build its complete
    // workspace dependency closure explicitly so this test never falls back to
    // the current 1.1 tree.
    try {
      execFileSync("pnpm", ["--filter", "@k-nex/customer-gate-1...", "build"], { cwd: oldTree, env, stdio: "pipe", encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      throw new Error(`Accepted 1.0 source dependency build failed:\n${error.stdout ?? ""}\n${error.stderr ?? ""}`, { cause: error });
    }
    const predecessorFactory = await import(`${pathToFileURL(join(oldTree, "packages/composition/dist/application-factory.js")).href}?p139=${Date.now()}`);
    const predecessorRuntime = await import(`${pathToFileURL(join(oldTree, "packages/runtime/dist/index.js")).href}?p139=${Date.now()}`);
    const identity = p139AcceptedSourceIdentity(predecessorFactory, oldTree);
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p139_source_protection").withStartupTimeout(120_000).start();
    source = new pg.Pool({ connectionString: container.getConnectionUri(), max: 6 });
    const sourceClient = await source.connect();
    try {
      const db = migrationDb(sourceClient);
      await installRegisteredPhase12Predecessor(db, sourceClient);
      await layerPhase12ProductState(sourceClient, predecessorRuntime); await seedPhase12Rows(sourceClient);
      const predecessor = await snapshotPhase12Truth(sourceClient);
      const targetSourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
      const build = p139TrustedBuild(identity, targetSourceCommit);
      const deploymentStore = new PostgresStaticDeploymentStore(source, { now: () => new Date() }, build.authority);
      const workerLeaseExpiresAt = new Date(Date.now() + 240_000).toISOString();
      const lifecycleAdmission = await p139InstallSourceRuntime(sourceClient, identity, deploymentStore, build, workerLeaseExpiresAt);
      await bindMigration(sourceClient);
      const beforeTruth = await p139ReadSourceTruth(sourceClient); const beforeBoundary = await p139ReadBoundary(sourceClient);
      assert.equal(beforeBoundary.deployment.active_generation_id, p139SourceGeneration);
      assert.equal(beforeBoundary.fence.active_execution_generation, p139SourceGeneration);
      const failedBackupStore = p139MemoryStore();
      await assert.rejects(executeDatabaseBackup({ backupId: "p139.backup-missing", applicationId: lifecycleApplicationId, pluginId: "module.sales", migrationRevision: 24,
        executor: { store: failedBackupStore, maximumBytes: 1024 * 1024, encryptionKeyReference: "secret:backup/p139-missing", createBackup: async function* () {} } }), /complete bounded stream/u,
      "Upgrade must fail before migration when the source backup stream is incomplete.");
      const sourceInventory = p139RuntimeInventory(identity, "1.0.0", 24);
      const sourceInventoryDigest = runtimeInventoryDigest(sourceInventory);
      const operationStore = new PostgresSystemOperationsStore(source, { now: () => new Date() });
      await operationStore.initialize({ applicationId, environment, inventoryDigest: sourceInventoryDigest });
      const backupOperation = await p139ClaimOperation(operationStore,
        p139OperationRequest("backup", 0, "p139-source-backup", sourceInventoryDigest), "p139-backup-worker");
      await assert.rejects(operationStore.submit(p139OperationRequest("backup", 1, "p139-stale-backup", `sha256:${"0".repeat(64)}`)),
        { code: "INVENTORY_CHANGED" }, "A stale/tampered inventory binding must fail before operator execution.");
      const protectedPreflight = await preflightState(sourceClient);
      const sourceBackup = await p139PhysicalBackup(container, container.getDatabase(), "p139-source-pre-upgrade");
      assert.notEqual(sourceBackup.backup.applicationId, applicationId, "The namespaced backup ResourceId is reference proof, not the customer application identity.");
      await p139AssertOperationAwaitingRestore(source, backupOperation);
      const sourceProtectionRestore = await p139CleanRestore(container, sourceBackup.user, sourceBackup.backup,
        "p139_source_protection_drill", "/tmp/p139-source-protection-drill.dump", sourceInventory);
      sourceProtectionDrill = new pg.Pool({ connectionString: sourceProtectionRestore.url.toString(), max: 6 });
      assert.equal(sourceProtectionRestore.restore.backupId, sourceBackup.backup.backupId);
      assert.equal(sourceProtectionRestore.restore.sourceDigest, sourceBackup.backup.contentDigest);
      assert.deepEqual(p139RestoreComparable(await preflightState(sourceProtectionDrill)), p139RestoreComparable(protectedPreflight),
        "Source protection receipt requires a real clean restore of the exact pre-upgrade backup.");
      assert.deepEqual(await p139ReadSourceTruth(sourceProtectionDrill), beforeTruth);
      assert.deepEqual(await p139ReadBoundary(sourceProtectionDrill), beforeBoundary);
      const sourceBackupReceipt = await p139CompleteOperation(operationStore, backupOperation, sourceBackup.backup.backupId);
      assert.equal(sourceBackupReceipt.reference.receiptId, sourceBackup.backup.backupId);
      assert.equal(sourceBackup.backup.migrationRevision, 24);

      const beforeMigrationFailure = await preflightState(sourceClient);
      await sourceClient.query("begin");
      await assert.rejects(p139ApplyTargetWithFailpoint(db, sourceClient, 3), /P13_9_MIGRATION_FAILPOINT/u);
      await sourceClient.query("rollback");
      // PostgreSQL sequence increments are non-transactional; unused values may be
      // consumed, but schema, rows, and sequence configuration must be unchanged.
      assert.deepEqual(p139RollbackComparable(await preflightState(sourceClient)), p139RollbackComparable(beforeMigrationFailure),
        "A migration failure must roll back all target schema/data changes.");

      const recovery = await p139RunUpgradeOperation({
        client: sourceClient, db, sourceBackup, container, user: sourceBackup.user, restoreDatabase: "p139_source_recovery",
        restorePath: "/tmp/p139-source-recovery.dump", sourceInventory, beforeBoundary, store: deploymentStore,
        build, lifecycleAdmission, workerLeaseExpiresAt
      });
      const sourceRestoreProof = recovery.restore;
      assert.equal(sourceRestoreProof.backupId, sourceBackup.backup.backupId,
        "Injected-failure recovery must consume the same pre-upgrade backup id as the protection drill.");
      assert.equal(sourceRestoreProof.sourceDigest, sourceBackup.backup.contentDigest,
        "Injected-failure recovery must consume the same pre-upgrade backup bytes as the protection drill.");
      const sourceRestoreUrl = recovery.url;
      sourceDrill = new pg.Pool({ connectionString: sourceRestoreUrl.toString(), max: 6 });
      const sourceRestoreBefore = await preflightState(sourceDrill);
      assert.deepEqual(p139RestoreComparable(sourceRestoreBefore), p139RestoreComparable(protectedPreflight),
        "Source clean restore changed schema definitions, object validity/readiness, sequences, or rows from the protection point.");
      const sourceRestoreOperations = new PostgresSystemOperationsStore(sourceDrill, { now: () => new Date() });
      const replayedBackupReceipt = await p139CompleteOperation(sourceRestoreOperations, backupOperation, sourceBackup.backup.backupId);
      assert.equal(replayedBackupReceipt.reference.receiptId, sourceBackup.backup.backupId);
      const restoreOperation = await p139ClaimOperation(sourceRestoreOperations,
        p139OperationRequest("restore-drill", 2, "p139-source-restore-drill", sourceInventoryDigest), "p139-restore-worker");
      const sourceRestoreReceipt = await p139CompleteOperation(sourceRestoreOperations, restoreOperation, sourceRestoreProof.backupId);
      assert.equal(sourceRestoreReceipt.reference.receiptId, sourceBackup.backup.backupId);
      assert.deepEqual(await p139ReadSourceTruth(sourceDrill), beforeTruth, "Clean restore changed source product truth.");
      assert.deepEqual(await p139ReadBoundary(sourceDrill), beforeBoundary, "Clean restore changed the quiesced source runtime boundary.");
      const exactSource = p139RunExactSourceApplication(oldTree, sourceRestoreUrl.toString());
      try {
        const exactSourceResult = await exactSource.finished;
        assert.equal(exactSourceResult.code, 0, `Accepted 1.0 source process failed to boot:\n${exactSourceResult.output}`); assert.match(exactSourceResult.output, /READY/u);
      } finally { await exactSource.stop(); }
      assert.deepEqual(await p139ReadSourceTruth(sourceDrill), beforeTruth, "Exact 1.0 restart changed source truth.");
      assert.deepEqual(await p139ReadBoundary(sourceDrill), beforeBoundary, "Exact 1.0 restart changed the quiesced source runtime boundary.");

      assert.deepEqual((await sourceDrill.query("select receipt_json->'reference'->>'receiptId' reference_receipt_id from k_nex_system_operation_receipts where terminal order by occurred_at")).rows,
        [{ reference_receipt_id: sourceBackup.backup.backupId }, { reference_receipt_id: sourceRestoreProof.backupId }]);
      const sourceAfterReceipt = await p139ReadSourceTruth(sourceDrill); assert.deepEqual(sourceAfterReceipt, beforeTruth, "Production operation receipts must not rewrite source product truth.");

      const successDb = "p139_success_target";
      const successRestore = await p139CleanRestore(container, sourceBackup.user, sourceBackup.backup, successDb, "/tmp/p139-success-target.dump", sourceInventory);
      const successUrl = successRestore.url;
      const success = new pg.Pool({ connectionString: successUrl.toString(), max: 6 });
      try {
        const successClient = await success.connect();
        try {
          const successOperations = new PostgresSystemOperationsStore(success, { now: () => new Date() });
          await p139CompleteOperation(successOperations, backupOperation, sourceBackup.backup.backupId);
          const successRestoreOperation = await p139ClaimOperation(successOperations,
            p139OperationRequest("restore-drill", 2, "p139-success-source-restore", sourceInventoryDigest), "p139-success-restore-worker");
          await p139CompleteOperation(successOperations, successRestoreOperation, successRestore.restore.backupId);
          const successDbAdapter = migrationDb(successClient); await bindMigration(successClient);
          const successDeploymentStore = new PostgresStaticDeploymentStore(success, { now: () => new Date() }, build.authority);
          const successDeployment = p139DeploymentSupervisor({ client: successClient, db: successDbAdapter, store: successDeploymentStore, build });
          const deployed = await successDeployment.supervisor.deploy({ build: build.token, generationId: p139TargetGeneration,
            workerOwner: p139TargetFenceOwner, workerLeaseExpiresAt: new Date(Date.now() + 240_000).toISOString(), lifecycleAdmission });
          assert.equal(deployed.outcome, "promoted");
          const committedBeforeRecovery = await p139ReadBoundary(successClient);
          assert.equal(committedBeforeRecovery.deployment.active_generation_id, p139TargetGeneration);
          assert.equal(committedBeforeRecovery.fence.active_execution_generation, p139TargetGeneration);
          assert.equal(committedBeforeRecovery.fence.fencing_token, "2");
          assert.deepEqual(successDeployment.events.slice(0, 3), ["exact-seven-migrations", "start-passive", "passive-readiness"]);
          const trustedSalesRegistration = p139ScopedSalesRegistration();
          const lifecycleStore = new PostgresRuntimeExtensionStore(success, { now: () => new Date() }, canonicalDigest({ fixture: "p139-runtime-inventory" }), {
            authorizationLifecycleProjector: new AuthorizationLifecycleProjector(createStaticPlatformPluginAuthorizationDescriptorResolver({
              applicationId, registrations: [{ sourceCommit: identity.sourceCommit, registration: trustedSalesRegistration },
                { sourceCommit: targetSourceCommit, registration: trustedSalesRegistration }]
            })),
            sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder()
          });
          assert.deepEqual(await lifecycleStore.completeStaticRelease(lifecycleAdmission.operationId, "lease-p139", deployed.receipt), deployed.receipt);
          assert.deepEqual(await lifecycleStore.completeStaticRelease(lifecycleAdmission.operationId, "lease-p139", deployed.receipt), deployed.receipt,
            "Lifecycle receipt response-loss replay must return the exact production receipt.");
          await successDeployment.supervisor.recover({ applicationId, environment }, { workerLeaseDurationMs: 240_000 });
          const settled = await successDeploymentStore.read({ applicationId, environment });
          assert.deepEqual(settled.transitionCheckpoint?.completedSteps, ["activate-worker", "converge-gateway", "reconnect-realtime", "drain-previous"],
            "Promotion checkpoint must finish every production convergence step before target protection.");
          const eventCount = successDeployment.events.length;
          await successDeployment.supervisor.recover({ applicationId, environment }, { workerLeaseDurationMs: 240_000 });
          assert.equal(successDeployment.events.length, eventCount, "Recovery replay after response loss must be idempotent once promotion is settled.");
          const targetInventory = p139RuntimeInventory(identity, "1.1.0", 25, true);
          const targetInventoryDigest = runtimeInventoryDigest(targetInventory);
          assert.equal(await successOperations.observeInventory({ applicationId, environment, expectedOperationsRevision: 4,
            expectedInventoryDigest: sourceInventoryDigest, inventoryDigest: targetInventoryDigest }), 5);
          const targetBackupOperation = await p139ClaimOperation(successOperations,
            p139OperationRequest("backup", 5, "p139-target-backup", targetInventoryDigest), "p139-target-backup-worker");
          const targetBeforeProtection = await preflightState(successClient);
          const targetBackup = await p139PhysicalBackup(container, successDb, "p139-target-post-upgrade", "module.sales", 25);
          await p139AssertOperationAwaitingRestore(success, targetBackupOperation);
          const targetRestore = await p139CleanRestore(container, targetBackup.user, targetBackup.backup, "p139_target_drill", "/tmp/p139-target-drill.dump", targetInventory);
          const targetRestoreProof = targetRestore.restore;
          assert.equal(targetRestoreProof.backupId, targetBackup.backup.backupId);
          assert.equal(targetRestoreProof.sourceDigest, targetBackup.backup.contentDigest);
          targetDrill = new pg.Pool({ connectionString: targetRestore.url.toString(), max: 6 });
          assert.deepEqual(p139RestoreComparable(await preflightState(targetDrill)), p139RestoreComparable(targetBeforeProtection),
            "Target clean restore must preserve the complete migrated schema/object metadata, validity/readiness, inventory, and rows.");
          const targetBackupReceipt = await p139CompleteOperation(successOperations, targetBackupOperation, targetBackup.backup.backupId);
          assert.equal(targetBackupReceipt.reference.receiptId, targetBackup.backup.backupId);
          const targetDrillOperations = new PostgresSystemOperationsStore(targetDrill, { now: () => new Date() });
          await p139CompleteOperation(targetDrillOperations, targetBackupOperation, targetBackup.backup.backupId);
          const targetRestoreOperation = await p139ClaimOperation(targetDrillOperations,
            p139OperationRequest("restore-drill", 7, "p139-target-restore-drill", targetInventoryDigest), "p139-target-restore-worker");
          const targetRestoreReceipt = await p139CompleteOperation(targetDrillOperations, targetRestoreOperation, targetRestoreProof.backupId);
          assert.equal(targetRestoreReceipt.reference.receiptId, targetBackup.backup.backupId);
          assert.equal((await targetDrill.query("select count(*)::int as count from payload_migrations")).rows[0].count, 33);
          assert.deepEqual((await targetDrill.query("select predecessor_revision,revision from k_nex_migration_revision where id=1")).rows, [{ predecessor_revision: 24, revision: 25 }]);
          assert.equal((await targetDrill.query("select active_execution_generation,fencing_token,lease_owner from runtime_worker_generation_fences where application_id=$1 and environment=$2", [applicationId, environment])).rows[0].fencing_token, "2");
          await assertMigratedTruth(targetDrill, predecessor);
          console.log(`P13_9_PROTECTION_PASS source=${identity.sourceCommit} sourceBackup=${sourceBackup.backup.contentDigest} targetBackup=${targetBackup.backup.contentDigest} outcome=protected-complete`);
        } finally { successClient.release(); }
      } finally { await success.end(); }
    } finally { sourceClient.release(); }
  } finally {
    await targetDrill?.end(); await sourceDrill?.end(); await sourceProtectionDrill?.end(); await source?.end(); if (container) await container.stop();
    try { execFileSync("git", ["worktree", "remove", "--force", oldTree], { cwd: repositoryRoot, stdio: "ignore" }); } catch {}
    rmSync(temp, { recursive: true, force: true });
  }
});
