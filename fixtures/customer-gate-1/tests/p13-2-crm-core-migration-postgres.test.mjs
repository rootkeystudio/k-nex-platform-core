import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { AuthorizationDecisionAuditSchema } from "@k-nex/contracts";
import { compareTemplateBaseline } from "@k-nex/runtime";
import pg from "pg";

import { down, up } from "../dist/src/migrations/20260905_000027_crm_core.js";
import { up as authorizationUp } from "../dist/src/migrations/20260901_000019_authorization_storage.js";
import { up as templateTombstonesUp } from "../dist/src/migrations/20260901_000020_template_tombstones.js";
import { up as authorizationOutboxUp } from "../dist/src/migrations/20260901_000021_authorization_outbox.js";
import { up as settingsUp } from "../dist/src/migrations/20260902_000023_system_settings.js";
import { up as workspacePagesUp } from "../dist/src/migrations/20260903_000026_workspace_pages.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const targetTables = [
  "sales_accounts", "sales_contacts", "sales_leads", "sales_pipelines", "sales_pipeline_stages",
  "sales_activities", "sales_opportunities", "sales_tasks", "sales_notes", "sales_attachment_references"
];

const drizzleQueryConfig = {
  escapeName: (name) => `"${name.replaceAll('"', '""')}"`,
  escapeParam: (index) => `$${index + 1}`,
  escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
  casing: { getColumnCasing: (column) => column.name }
};

function migrationDb(client) {
  return {
    async execute(statement) {
      const query = statement.toQuery({ ...drizzleQueryConfig, paramStartIndex: { value: 0 } });
      return client.query(query.sql, query.params);
    }
  };
}

const digest = (value) => `sha256:${createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex")}`;
const oldViewerBaseline = [
  "sales.navigation.read", "sales.opportunities.name.read", "sales.opportunities.read", "sales.opportunities.stage.read",
  "sales.tasks.read", "sales.tasks.status.read", "sales.tasks.title.read"
].sort();
const migratedViewerBaseline = ["sales.opportunities.read", "sales.reports.read", "sales.tasks.read"];
const oldManagerBaseline = [
  "sales.navigation.read", "sales.opportunities.name.read", "sales.opportunities.read", "sales.opportunities.stage.read",
  "sales.opportunities.value.read", "sales.opportunities.write", "sales.tasks.private-note.read", "sales.tasks.read",
  "sales.tasks.revenue.read", "sales.tasks.status.read", "sales.tasks.title.read", "sales.tasks.write"
].sort();
const migratedManagerBaseline = [
  "sales.notes.body.read", "sales.notes.read", "sales.opportunities.amount.read", "sales.opportunities.read",
  "sales.opportunities.stage.update", "sales.opportunities.write", "sales.reports.read", "sales.tasks.read", "sales.tasks.write"
].sort();

async function installPhase12ReferenceStorage(db, client) {
  await authorizationUp({ db });
  await templateTombstonesUp({ db });
  await authorizationOutboxUp({ db });
  await settingsUp({ db });
  await workspacePagesUp({ db });
  await client.query(`
    insert into k_nex_authorization_state (application_id,authorization_revision,lifecycle_revision) values ('customer-alpha',7,3);
    insert into k_nex_extension_authorization_generations
      (application_id,delivery_class,extension_id,authorization_generation,runtime_generation_ids,state)
      values ('customer-alpha','platform-plugin','module.sales',1,'[]'::jsonb,'current');
    insert into k_nex_roles (application_id,role_id,label) values ('customer-alpha','sales.customer-viewer','Viewer');
  `);
  for (const [index, permissionId] of oldViewerBaseline.entries()) {
    await client.query(`insert into k_nex_role_permission_grants
      (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
      values ('customer-alpha',$1,'sales.customer-viewer',$2,'extension','platform-plugin','module.sales',1)`, [`viewer-grant-${index}`, permissionId]);
  }
  await client.query(`insert into k_nex_role_template_adoptions
    (application_id,adoption_id,role_id,template_id,publisher_delivery_class,publisher_extension_id,owner_delivery_class,owner_extension_id,owner_generation,
     template_version,old_baseline_permission_ids,digest_algorithm,old_baseline_digest,kind,state)
    values ('customer-alpha','viewer-adoption','sales.customer-viewer','sales.template.viewer','platform-plugin','module.sales','platform-plugin','module.sales',1,
      1,$1::jsonb,'sha256-canonical-json-v1',$2,'instantiated-role','adopted')`, [JSON.stringify(oldViewerBaseline), digest(oldViewerBaseline)]);
  await client.query(`insert into k_nex_permission_catalog_snapshots
    (application_id,snapshot_id,source,permission_json,state) values
    ('customer-alpha','retired-title-snapshot','administrative-non-authoritative','{"id":"sales.tasks.title.read"}'::jsonb,'deprecated')`);
  await client.query("insert into k_nex_roles (application_id,role_id,label) values ('customer-alpha','sales.customer-manager','Manager'),('customer-alpha','sales.customer-nav-only','Navigation only'),('customer-alpha','sales.customer-permission-only','Permission only')");
  const currentManagerPermissions = [...oldManagerBaseline.filter((permissionId) => permissionId !== "sales.tasks.write"), "sales.contacts.read"].sort();
  for (const [index, permissionId] of currentManagerPermissions.entries()) {
    await client.query(`insert into k_nex_role_permission_grants
      (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
      values ('customer-alpha',$1,'sales.customer-manager',$2,'extension','platform-plugin','module.sales',1)`, [`manager-grant-${index}`, permissionId]);
  }
  await client.query(`insert into k_nex_role_template_adoptions
    (application_id,adoption_id,role_id,template_id,publisher_delivery_class,publisher_extension_id,owner_delivery_class,owner_extension_id,owner_generation,
     template_version,old_baseline_permission_ids,digest_algorithm,old_baseline_digest,kind,state)
    values ('customer-alpha','manager-adoption','sales.customer-manager','sales.template.manager','platform-plugin','module.sales','platform-plugin','module.sales',1,
      1,$1::jsonb,'sha256-canonical-json-v1',$2,'instantiated-role','adopted')`, [JSON.stringify(oldManagerBaseline), digest(oldManagerBaseline)]);
  await client.query(`insert into k_nex_role_permission_grants
    (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
    values ('customer-alpha','nav-only-grant','sales.customer-nav-only','sales.navigation.read','extension','platform-plugin','module.sales',1)`);
  await client.query(`insert into k_nex_role_permission_grants
    (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
    values ('customer-alpha','permission-only-write','sales.customer-permission-only','sales.opportunities.write','extension','platform-plugin','module.sales',1)`);
  await client.query(`
    insert into k_nex_extension_authorization_generations
      (application_id,delivery_class,extension_id,authorization_generation,runtime_generation_ids,state)
      values ('customer-alpha','platform-plugin','module.sales',2,'[]'::jsonb,'retired');
    insert into k_nex_roles (application_id,role_id,label) values
      ('customer-alpha','sales.customer-stale','Stale');
    insert into k_nex_role_permission_grants
      (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
      values
        ('customer-alpha','stale-task-read','sales.customer-stale','sales.tasks.read','extension','platform-plugin','module.sales',2),
        ('customer-alpha','stale-task-title','sales.customer-stale','sales.tasks.title.read','extension','platform-plugin','module.sales',2),
        ('customer-alpha','stale-task-status','sales.customer-stale','sales.tasks.status.read','extension','platform-plugin','module.sales',2);
    insert into k_nex_role_assignments (application_id,assignment_id,role_id,subject_kind,subject_id,state) values
      ('customer-alpha','reader-viewer','sales.customer-viewer','user','reader-1','active'),
      ('customer-alpha','writer-viewer','sales.customer-viewer','user','writer-1','active'),
      ('customer-alpha','writer-manager','sales.customer-manager','user','writer-1','active'),
      ('customer-alpha','permission-only-assignment','sales.customer-permission-only','user','permission-only-1','active'),
      ('customer-alpha','revoked-manager','sales.customer-manager','user','revoked-1','revoked'),
      ('customer-alpha','stale-user','sales.customer-stale','user','stale-1','active');
  `);
  await client.query(`
    insert into k_nex_system_settings_state (application_id,environment,settings_revision) values ('customer-alpha','production',7);
    insert into k_nex_system_settings_documents
      (application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json)
    values ('customer-alpha','production','sales.settings.workspace',1,'platform-plugin:module.sales:1','extension','platform-plugin','module.sales',1,4,2,
      '{"defaultTaskPageSize":25,"showPotentialRevenue":true,"defaultPage":"tasks","pipelineStages":["lead","qualified","won","lost"]}'::jsonb);
    update k_nex_migration_revision set predecessor_revision=23,revision=24 where id=1;
  `);
}

async function insertBetaSettingsScope(client) {
  await client.query(`
    insert into k_nex_extension_authorization_generations
      (application_id,delivery_class,extension_id,authorization_generation,runtime_generation_ids,state)
      values ('customer-beta','platform-plugin','module.sales',1,'[]'::jsonb,'current');
    insert into k_nex_system_settings_state (application_id,environment,settings_revision) values ('customer-beta','staging',11);
    insert into k_nex_system_settings_documents
      (application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json)
    values ('customer-beta','staging','sales.settings.workspace',1,'platform-plugin:module.sales:1','extension','platform-plugin','module.sales',1,3,4,
      '{"defaultTaskPageSize":50,"showPotentialRevenue":false,"defaultPage":"overview","pipelineStages":["lead","qualified","won","lost"]}'::jsonb);
  `);
}

async function insertWorkspaceReference(client, { retired = false } = {}) {
  const source = retired ? { id: "sales.total-potential-revenue", version: 1 } : { id: "sales.tasks", version: 1 };
  const document = {
    schemaVersion: 1, id: "customer.sales-board", version: 1, profile: "workspace",
    regions: { main: [{ id: "tasks", type: "sales.task-table", version: 2, props: { title: "Tasks" }, bindings: {
      source: { source, input: {}, structuralCompatibilityHash: retired ? `sha256:${"f".repeat(64)}` : "sha256:520d5f0bd7874a0b9c63fd3974ce355180314fcbd961ca9407a781d9fc768f26", selectedFields: retired ? ["value"] : ["title", "status"] },
      action: { id: "sales.task.update", version: 1 }
    } }] }
  };
  const oldDependencyDigest = digest([{ kind: "block", id: "sales.task-table", version: 2 }, { kind: "source", id: source.id, version: 1 }]);
  const page = { schemaVersion: 1, identity: { applicationId: "customer-alpha", environment: "production", pageId: "customer.sales-board", documentId: "customer.sales-document" }, dependencyDigest: oldDependencyDigest };
  const working = { schemaVersion: 1, identity: page.identity, revision: 1, document };
  const historicalRevision = { schemaVersion: 1, revisionId: "publication-1", identity: page.identity, documentRevision: 1, document, page,
    dependencies: { entries: [{ kind: "block", id: "sales.task-table", version: 2 }, { kind: "source", id: source.id, version: 1 }], digest: oldDependencyDigest } };
  const liveRevision = { ...historicalRevision, revisionId: "publication-2", documentRevision: 2 };
  await client.query(`insert into k_nex_workspace_pages
    (application_id,environment,page_id,document_id,state,page_revision,working_copy_revision,access_revision,published_revision_id,dependency_digest,page_json,created_at,updated_at)
    values ('customer-alpha','production','customer.sales-board','customer.sales-document','published',7,1,0,'publication-2',$1,$2::jsonb,now(),now())`, [oldDependencyDigest, JSON.stringify(page)]);
  await client.query(`insert into k_nex_workspace_working_copies
    (application_id,environment,page_id,document_id,working_copy_revision,working_copy_json,updated_at)
    values ('customer-alpha','production','customer.sales-board','customer.sales-document',1,$1::jsonb,now())`, [JSON.stringify(working)]);
  await client.query(`insert into k_nex_workspace_published_revisions
    (application_id,environment,page_id,revision_id,document_id,document_revision,dependency_digest,revision_json,published_at)
    values
      ('customer-alpha','production','customer.sales-board','publication-1','customer.sales-document',1,$1,$2::jsonb,now()),
      ('customer-alpha','production','customer.sales-board','publication-2','customer.sales-document',2,$1,$3::jsonb,now())`,
    [oldDependencyDigest, JSON.stringify(historicalRevision), JSON.stringify(liveRevision)]);
  return { document, oldDependencyDigest };
}

async function resetPredecessor(client) {
  await client.query(`
    reset all;
    drop schema public cascade;
    create schema public;
    create type enum_sales_tasks_status as enum ('open','done');
    create type enum_sales_opportunities_stage as enum ('lead','qualified','won','lost');
    create table sales_tasks (
      id serial primary key, title varchar not null, status enum_sales_tasks_status default 'open' not null,
      potential_revenue varchar, private_note varchar,
      updated_at timestamptz(3) default now() not null, created_at timestamptz(3) default now() not null
    );
    create index status_idx on sales_tasks(status);
    create table sales_opportunities (
      id serial primary key, name varchar not null, stage enum_sales_opportunities_stage default 'lead' not null, value varchar,
      updated_at timestamptz(3) default now() not null, created_at timestamptz(3) default now() not null
    );
    create index sales_opportunities_stage_idx on sales_opportunities(stage);
    create table payload_locked_documents (id serial primary key);
    create table payload_locked_documents_rels (id serial primary key, parent_id integer not null);
    create table payload_mcp_api_keys (
      id serial primary key,
      payload_mcp_tool_k_nex_sales_tools_search_tasks_v1 boolean default true,
      payload_mcp_tool_k_nex_sales_tools_create_task_v1 boolean default true
    );
    insert into payload_mcp_api_keys (payload_mcp_tool_k_nex_sales_tools_search_tasks_v1,payload_mcp_tool_k_nex_sales_tools_create_task_v1) values (false,true);
    create table k_nex_migration_revision (id integer primary key, predecessor_revision integer not null, revision integer not null);
    insert into k_nex_migration_revision values (1,23,24);
  `);
}

async function bind(client) {
  for (const [key, value] of Object.entries({
    application_id: "customer-alpha", environment: "production", owner_id: "user:migration-owner",
    account_id: "7001", account_name: "Legacy imported account", pipeline_id: "8001", pipeline_name: "Primary pipeline",
    currency: "USD", receipt_digest: `sha256:${"a".repeat(64)}`
  })) await client.query("select set_config($1,$2,false)", [`k_nex.sales_migration_${key}`, value]);
}

async function targetTableCount(client) {
  const result = await client.query(
    "select count(*)::int as count from pg_tables where schemaname='public' and tablename = any($1::text[])",
    [targetTables]
  );
  return result.rows[0].count;
}

async function assertMcpShapeRefusal(client, db, mutate, label) {
  await resetPredecessor(client);
  await client.query(mutate);
  const columnsBefore = await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='payload_mcp_api_keys' order by ordinal_position");
  const rowsBefore = await client.query("select to_jsonb(payload_mcp_api_keys) as value from payload_mcp_api_keys order by id");
  await assert.rejects(up({ db }), /maintenance-required: Payload MCP Sales tool columns are missing, partial, mixed, versioned, or have an incompatible predecessor contract/u, label);
  assert.deepEqual((await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='payload_mcp_api_keys' order by ordinal_position")).rows, columnsBefore.rows, `${label}: schema remains unchanged.`);
  assert.deepEqual((await client.query("select to_jsonb(payload_mcp_api_keys) as value from payload_mcp_api_keys order by id")).rows, rowsBefore.rows, `${label}: per-key authority remains unchanged.`);
  assert.equal(await targetTableCount(client), 2, `${label}: no CRM target schema mutation.`);
  assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision")).rows, [{ predecessor_revision: 23, revision: 24 }], `${label}: revision remains unchanged.`);
}

test("P13.2 CRM core migration proves clean install, exact upgrade, fail-closed preflight, and maintenance rollback", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("p13_crm_core").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 1 });
  const client = await pool.connect();
  const db = migrationDb(client);
  try {
    await resetPredecessor(client);
    await up({ db });
    assert.equal(await targetTableCount(client), targetTables.length, "Clean install creates one canonical table per core object.");
    assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision where id=1")).rows, [{ predecessor_revision: 24, revision: 25 }]);
    assert.equal((await client.query("select count(*)::int as count from sales_crm_migration_receipts")).rows[0].count, 0, "Empty predecessor needs no invented bindings or receipt.");
    assert.equal((await client.query("select to_regclass('public.sales_current_authority_scopes')::text as table_name")).rows[0].table_name, "sales_current_authority_scopes");
    await client.query(`insert into sales_current_authority_scopes
      (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids)
      values ('customer-alpha','production','rep-1','owned-or-assigned-team',false,true,'["team-a"]'::jsonb),
             ('customer-alpha','production','manager-1','managed-teams-and-own',false,true,'["team-a","team-b"]'::jsonb),
             ('customer-alpha','production','admin-1','application-sales-scope',true,true,'[]'::jsonb),
             ('customer-alpha','production','viewer-1','explicit-application-or-team-scope',false,false,'["team-b"]'::jsonb)`);
    await assert.rejects(client.query(`insert into sales_current_authority_scopes
      (application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids)
      values ('customer-alpha','production','forged-viewer','explicit-application-or-team-scope',true,true,'[]'::jsonb)`), { code: "23514" });
    assert.deepEqual((await client.query(`select payload_mcp_tool_k_nex_sales_tools_search_tasks_v2 as search_v2,
      payload_mcp_tool_k_nex_sales_tools_create_task_v2 as create_v2 from payload_mcp_api_keys`)).rows, [{ search_v2: false, create_v2: true }], "MCP per-key tool authority follows the version bump.");
    assert.deepEqual((await client.query("select column_name from information_schema.columns where table_name='payload_mcp_api_keys' and column_name like 'payload_mcp_tool_k_nex_sales_tools_%' order by column_name")).rows, [
      { column_name: "payload_mcp_tool_k_nex_sales_tools_create_task_v2" },
      { column_name: "payload_mcp_tool_k_nex_sales_tools_search_tasks_v2" }
    ], "No executable v1 MCP field remains after cutover.");
    await assert.rejects(down({ db }), /maintenance-required.*backup restore/u);

    await resetPredecessor(client);
    await client.query(`create function p13_cancel_revision_cutover() returns trigger language plpgsql as $$ begin new.revision=999; return new; end $$;
      create trigger p13_cancel_revision_cutover before update on k_nex_migration_revision for each row execute function p13_cancel_revision_cutover()`);
    await client.query("begin");
    await assert.rejects(up({ db }), /maintenance-required: fixture migration revision changed before cutover/u);
    await client.query("rollback");
    assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision")).rows, [{ predecessor_revision: 23, revision: 24 }], "Stale revision cutover refuses rather than reporting a successful migration.");

    await resetPredecessor(client);
    await client.query("insert into sales_tasks (id,title,status,potential_revenue,private_note,created_at,updated_at) values (41,'Follow up','done','12.340','private context','2026-01-02T03:04:05Z','2026-02-03T04:05:06Z')");
    await client.query("insert into sales_opportunities (id,name,stage,value,created_at,updated_at) values (51,'Renewal','qualified','900.00','2026-01-05T00:00:00Z','2026-02-07T00:00:00Z'),(52,'Lost bid','lost',null,'2026-01-06T00:00:00Z','2026-02-08T00:00:00Z')");
    const before = await client.query("select id,created_at,updated_at from sales_tasks union all select id,created_at,updated_at from sales_opportunities order by id");
    await bind(client);
    await up({ db });
    assert.equal(await targetTableCount(client), targetTables.length);
    assert.deepEqual((await client.query("select id,created_at,updated_at from sales_tasks union all select id,created_at,updated_at from sales_opportunities order by id")).rows, before.rows, "IDs and timestamps remain stable.");
    assert.deepEqual((await client.query("select id,status,revision,application_id,owner_id,archive_status from sales_tasks")).rows, [{ id: 41, status: "completed", revision: 1, application_id: "customer-alpha", owner_id: "user:migration-owner", archive_status: "active" }]);
    assert.deepEqual((await client.query("select id,stage_id,amount,currency,closed_at is not null as closed,loss_reason from sales_opportunities order by id")).rows, [
      { id: 51, stage_id: "discovery", amount: "900.00", currency: "USD", closed: false, loss_reason: null },
      { id: 52, stage_id: "lost", amount: null, currency: null, closed: true, loss_reason: "legacy-migration-unspecified" }
    ]);
    assert.deepEqual((await client.query("select character_maximum_length from information_schema.columns where table_schema='public' and table_name='sales_opportunities' and column_name='amount'")).rows, [{ character_maximum_length: 128 }]);
    await assert.rejects(client.query("update sales_opportunities set amount='1.1234567890123456789' where id=51"), { code: "23514" });
    await assert.rejects(client.query("update sales_opportunities set currency=null where id=51"), { code: "23514" });
    assert.deepEqual((await client.query("select body,author_id,related_record_id,related_record_type from sales_notes")).rows, [{ body: "private context", author_id: "user:migration-owner", related_record_id: "41", related_record_type: "sales.task" }]);
    assert.deepEqual((await client.query("select ordered_stage_ids from sales_pipelines")).rows, [{ ordered_stage_ids: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] }]);
    assert.deepEqual((await client.query("select stage_id,probability_basis_points,allowed_transitions from sales_pipeline_stages order by position")).rows, [
      { stage_id: "qualification", probability_basis_points: 1000, allowed_transitions: ["discovery", "lost"] },
      { stage_id: "discovery", probability_basis_points: 3000, allowed_transitions: ["proposal", "lost"] },
      { stage_id: "proposal", probability_basis_points: 6000, allowed_transitions: ["negotiation", "lost"] },
      { stage_id: "negotiation", probability_basis_points: 8000, allowed_transitions: ["won", "lost"] },
      { stage_id: "won", probability_basis_points: 10000, allowed_transitions: [] },
      { stage_id: "lost", probability_basis_points: 0, allowed_transitions: [] }
    ]);
    await assert.rejects(client.query(`insert into sales_activities
      (application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,related_record_id,related_record_type)
      values ('customer-alpha','production','user:owner','team:sales','user:owner','user:owner','scheduled','call','Missing schedule','user:actor','41','sales.task')`), { code: "23514" });
    await client.query(`insert into sales_activities
      (application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type)
      values ('customer-alpha','production','user:owner','team:sales','user:owner','user:owner','scheduled','call','Scheduled call','user:actor','2026-03-01T10:00:00Z','41','sales.task')`);
    await client.query(`insert into sales_accounts (id,application_id,environment,owner_id,created_by,updated_by,name) values
      (7002,'customer-alpha','production','user:owner','user:owner','user:owner','Merged target'),
      (7003,'customer-beta','production','user:owner','user:owner','user:owner','Foreign account');
      insert into sales_contacts (id,application_id,environment,owner_id,created_by,updated_by,account_id,display_name) values
      (7101,'customer-alpha','production','user:owner','user:owner','user:owner',7002,'Qualified contact');`);
    await client.query(`insert into sales_activities
      (id,application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type)
      values
        (7201,'customer-alpha','production','user:owner','team:sales','user:owner','user:owner','scheduled','call','Alpha original','user:actor','2026-03-01T10:00:00Z','7002','sales.account'),
        (7202,'customer-alpha','production','user:owner','team:sales','user:owner','user:owner','scheduled','call','Alpha replacement','user:actor','2026-03-01T11:00:00Z','7002','sales.account'),
        (7203,'customer-beta','production','user:owner','team:sales','user:owner','user:owner','scheduled','call','Beta original','user:actor','2026-03-01T12:00:00Z','7003','sales.account')`);
    await client.query("update sales_activities set supersedes_activity_id=7201 where id=7202");
    await assert.rejects(client.query("update sales_activities set supersedes_activity_id=7202 where id=7202"), { code: "23514" });
    await assert.rejects(client.query("update sales_activities set supersedes_activity_id=999999 where id=7202"), { code: "23503" });
    await assert.rejects(client.query("update sales_activities set supersedes_activity_id=7203 where id=7202"), { code: "23503" });
    assert.deepEqual((await client.query("select id,supersedes_activity_id from sales_activities where id in (7201,7202) order by id")).rows,
      [{ id: 7201, supersedes_activity_id: null }, { id: 7202, supersedes_activity_id: 7201 }], "Activity replacement permits a scoped chain while rejecting self, missing, and cross-scope targets.");
    await assert.rejects(client.query(`insert into sales_activities
      (application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,scheduled_at,related_record_id,related_record_type)
      values ('customer-alpha','production','user:owner','team:sales','user:owner','user:owner','scheduled','call','Cross application','user:actor','2026-03-01T10:00:00Z','7003','sales.account')`), /Sales related-record scope is invalid/u);
    await assert.rejects(client.query(`update sales_accounts set status='merged',merged_into_id='7003',merge_lineage='{"kind":"dedupe"}'::jsonb where id=7001`), /Sales merge lineage scope is invalid/u);
    await client.query(`update sales_accounts set status='merged',merged_into_id='7002',merge_lineage='{"kind":"dedupe"}'::jsonb where id=7001;
      insert into sales_leads (application_id,environment,owner_id,created_by,updated_by,status,display_name,source,decided_at,qualified_at,qualified_account_id,qualified_contact_id,qualified_opportunity_id)
      values ('customer-alpha','production','user:owner','user:owner','user:owner','qualified','Qualified lead','event','2026-03-01T10:00:00Z','2026-03-01T10:00:00Z','7002','7101','51')`);
    await assert.rejects(client.query(`insert into sales_leads (application_id,environment,owner_id,created_by,updated_by,status,display_name,source,decided_at,qualified_at,qualified_account_id,qualified_contact_id,qualified_opportunity_id)
      values ('customer-alpha','production','user:owner','user:owner','user:owner','qualified','Foreign lead','event','2026-03-01T10:00:00Z','2026-03-01T10:00:00Z','7003','7101','51')`), /Sales lead qualification scope is invalid/u);
    const receipt = (await client.query("select task_count,opportunity_count,note_count,legacy_decimal_evidence,rollback_classification from sales_crm_migration_receipts")).rows[0];
    assert.deepEqual(receipt, { task_count: 1, opportunity_count: 2, note_count: 1, legacy_decimal_evidence: [{ taskId: 41, value: "12.340" }], rollback_classification: "maintenance-required" });
    const removed = await client.query("select column_name from information_schema.columns where table_schema='public' and ((table_name='sales_tasks' and column_name in ('potential_revenue','private_note')) or (table_name='sales_opportunities' and column_name in ('stage','value')))");
    assert.deepEqual(removed.rows, [], "Legacy writable truth is removed, not shadowed.");

    await resetPredecessor(client);
    await client.query("insert into sales_tasks (title) values ('Task only')");
    await bind(client);
    await up({ db });
    assert.deepEqual((await client.query("select (select count(*)::int from sales_accounts) as accounts, (select count(*)::int from sales_pipelines) as pipelines")).rows, [{ accounts: 0, pipelines: 0 }], "Task-only migration does not invent account or pipeline truth.");
    assert.deepEqual((await client.query("select legacy_account_id,pipeline_id,currency,task_count,opportunity_count from sales_crm_migration_receipts")).rows,
      [{ legacy_account_id: null, pipeline_id: null, currency: null, task_count: 1, opportunity_count: 0 }], "Task-only receipt carries no fabricated object identity.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("delete from k_nex_system_settings_documents; delete from k_nex_system_settings_state; insert into sales_tasks (title) values ('Receipt-scoped authority')");
    await bind(client);
    await up({ db });
    assert.deepEqual((await client.query("select distinct application_id,environment from sales_current_authority_scopes order by application_id,environment")).rows,
      [{ application_id: "customer-alpha", environment: "production" }], "Exact legacy receipt binding supplies otherwise absent environment for active Sales authority.");
    assert.deepEqual((await client.query("select application_id,environment,title from sales_tasks")).rows,
      [{ application_id: "customer-alpha", environment: "production", title: "Receipt-scoped authority" }]);

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("delete from k_nex_system_settings_documents; delete from k_nex_system_settings_state; insert into sales_tasks (title) values ('Wrong receipt scope')");
    await bind(client);
    await client.query("select set_config('k_nex.sales_migration_application_id','customer-beta',false)");
    const wrongReceiptGrants = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    await assert.rejects(up({ db }), /maintenance-required: active Sales authority for .* requires one receipt-bound environment/u);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, wrongReceiptGrants.rows, "Wrong receipt scope fails before authority rewrite.");
    assert.equal(await targetTableCount(client), 2, "Wrong receipt scope fails before CRM schema mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("insert into sales_tasks (title) values ('Conflicting receipt environment')");
    await bind(client);
    await client.query("select set_config('k_nex.sales_migration_environment','staging',false)");
    const conflictingSettings = await client.query("select application_id,environment,document_revision,settings_revision,values_json from k_nex_system_settings_documents");
    await assert.rejects(up({ db }), /maintenance-required: exact receipt-bound Sales migration bindings are required/u);
    assert.deepEqual((await client.query("select application_id,environment,document_revision,settings_revision,values_json from k_nex_system_settings_documents")).rows,
      conflictingSettings.rows, "Conflicting receipt environment fails before settings rewrite.");
    assert.equal(await targetTableCount(client), 2, "Conflicting receipt environment fails before CRM schema mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await up({ db });
    assert.deepEqual((await client.query("select (select count(*)::int from sales_accounts) as accounts, (select count(*)::int from sales_pipelines) as pipelines, (select count(*)::int from sales_pipeline_stages) as stages")).rows,
      [{ accounts: 0, pipelines: 1, stages: 6 }], "Settings-only migration seeds only required canonical pipeline semantics.");
    assert.equal((await client.query("select count(*)::int as count from sales_crm_migration_receipts")).rows[0].count, 0, "Settings-only migration creates no legacy-object receipt.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await insertBetaSettingsScope(client);
    await up({ db });
    assert.deepEqual((await client.query(`select pipeline.application_id,pipeline.environment,count(stage.id)::int as stages,
      bool_and(stage.application_id=pipeline.application_id and stage.environment=pipeline.environment) as isolated
      from sales_pipelines pipeline join sales_pipeline_stages stage on stage.pipeline_id=pipeline.id
      group by pipeline.id,pipeline.application_id,pipeline.environment order by pipeline.application_id`)).rows, [
      { application_id: "customer-alpha", environment: "production", stages: 6, isolated: true },
      { application_id: "customer-beta", environment: "staging", stages: 6, isolated: true }
    ], "Each settings scope receives its own pipeline/stages without cross-binding.");
    assert.deepEqual((await client.query("select application_id,environment,document_revision,settings_revision from k_nex_system_settings_documents where descriptor_id='sales.settings.workspace' order by application_id")).rows, [
      { application_id: "customer-alpha", environment: "production", document_revision: 5, settings_revision: 8 },
      { application_id: "customer-beta", environment: "staging", document_revision: 4, settings_revision: 12 }
    ], "Document revisions advance independently to each scope's next global settings revision.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await insertBetaSettingsScope(client);
    const settingsBeforeCancelledCutover = await client.query("select application_id,environment,document_revision,settings_revision,values_json from k_nex_system_settings_documents order by application_id");
    const settingsStateBeforeCancelledCutover = await client.query("select application_id,environment,settings_revision from k_nex_system_settings_state order by application_id");
    await client.query(`create function p13_cancel_beta_settings_state() returns trigger language plpgsql as $$ begin
      if old.application_id='customer-beta' then return null; end if; return new; end $$;
      create trigger p13_cancel_beta_settings_state before update on k_nex_system_settings_state for each row execute function p13_cancel_beta_settings_state()`);
    await client.query("begin");
    await assert.rejects(up({ db }), /maintenance-required: Sales settings state changed before rewrite for customer-beta/u);
    await client.query("rollback");
    assert.deepEqual((await client.query("select application_id,environment,document_revision,settings_revision,values_json from k_nex_system_settings_documents order by application_id")).rows,
      settingsBeforeCancelledCutover.rows, "Late second-scope CAS refusal rolls back every settings document rewrite.");
    assert.deepEqual((await client.query("select application_id,environment,settings_revision from k_nex_system_settings_state order by application_id")).rows,
      settingsStateBeforeCancelledCutover.rows, "Late second-scope CAS refusal rolls back prior global revision changes.");
    assert.equal(await targetTableCount(client), 2, "Late settings CAS refusal leaves no partial CRM schema.");

    await resetPredecessor(client);
    await workspacePagesUp({ db });
    await insertWorkspaceReference(client);
    await up({ db });
    assert.deepEqual((await client.query("select (select count(*)::int from sales_accounts) as accounts, (select count(*)::int from sales_pipelines) as pipelines, (select count(*)::int from sales_crm_migration_receipts) as receipts")).rows,
      [{ accounts: 0, pipelines: 0, receipts: 0 }], "Page-only migration rebinds executable references without inventing CRM rows.");

    await resetPredecessor(client);
    await client.query("insert into sales_tasks (title) values ('Needs explicit binding')");
    await assert.rejects(up({ db }), /maintenance-required: exact receipt-bound Sales migration bindings are required/u);
    assert.equal(await targetTableCount(client), 2, "Binding refusal creates no target table; only predecessor task/opportunity remain.");
    assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision")).rows, [{ predecessor_revision: 23, revision: 24 }]);

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("update k_nex_role_permission_grants set permission_id='sales.unknown.read' where grant_id='permission-only-write'");
    await bind(client);
    const unknownPermissionGrants = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    await assert.rejects(up({ db }), /maintenance-required: unknown persisted Sales permission sales\.unknown\.read/u);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, unknownPermissionGrants.rows, "Unknown persisted permission fails before any grant rewrite.");
    assert.equal(await targetTableCount(client), 2, "Unknown persisted permission fails before CRM schema mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("update k_nex_role_template_adoptions set old_baseline_permission_ids='[\"sales.unknown.read\"]'::jsonb, old_baseline_digest=$1 where adoption_id='viewer-adoption'", [digest(["sales.unknown.read"])]);
    await bind(client);
    const unknownBaseline = await client.query("select old_baseline_permission_ids,old_baseline_digest,revision from k_nex_role_template_adoptions where adoption_id='viewer-adoption'");
    await assert.rejects(up({ db }), /maintenance-required: unknown Sales permission in role-template baseline viewer-adoption/u);
    assert.deepEqual((await client.query("select old_baseline_permission_ids,old_baseline_digest,revision from k_nex_role_template_adoptions where adoption_id='viewer-adoption'")).rows, unknownBaseline.rows, "Unknown baseline permission fails before adoption rewrite.");
    assert.equal(await targetTableCount(client), 2, "Unknown baseline permission fails before CRM schema mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("alter table k_nex_role_permission_grants drop constraint k_nex_role_permission_grants_extension_owner_fk, drop constraint k_nex_role_permission_grants_owner_check");
    await client.query("update k_nex_role_permission_grants set owner_extension_id='module.foreign-sales' where grant_id='permission-only-write'");
    await bind(client);
    const foreignGrant = await client.query("select grant_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,revision from k_nex_role_permission_grants where grant_id='permission-only-write'");
    await assert.rejects(up({ db }), /maintenance-required: Sales grant provenance is invalid for permission-only-write/u);
    assert.deepEqual((await client.query("select grant_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,revision from k_nex_role_permission_grants where grant_id='permission-only-write'")).rows, foreignGrant.rows, "Foreign-owned Sales grant cannot seed scope or be rewritten.");
    assert.equal(await targetTableCount(client), 2, "Foreign-owned Sales grant fails before CRM schema mutation.");

    await resetPredecessor(client);
    await client.query("insert into sales_opportunities (name,value) values ('Bad decimal','1e3')");
    await bind(client);
    await assert.rejects(up({ db }), /maintenance-required: legacy Sales decimal is not canonical/u);
    assert.equal(await targetTableCount(client), 2, "Decimal refusal is mutation-free.");
    assert.equal((await client.query("select value from sales_opportunities")).rows[0].value, "1e3");

    await resetPredecessor(client);
    await client.query("insert into sales_opportunities (name,value) values ('Scale boundary','1.123456789012345678')");
    await bind(client);
    await up({ db });
    assert.deepEqual((await client.query("select amount,currency from sales_opportunities")).rows, [{ amount: "1.123456789012345678", currency: "USD" }], "Scale-18 legacy money projects exactly into 128-byte current storage.");

    await resetPredecessor(client);
    await client.query("insert into sales_opportunities (name,value) values ('Too precise','1.1234567890123456789')");
    await bind(client);
    await assert.rejects(up({ db }), /maintenance-required: legacy Sales decimal is not canonical/u);
    assert.equal(await targetTableCount(client), 2, "Scale-19 legacy money refuses before schema mutation.");

    await resetPredecessor(client);
    await client.query("insert into sales_opportunities (name,value) values ('Too long',$1)", [`1${"0".repeat(128)}`]);
    await bind(client);
    await assert.rejects(up({ db }), /maintenance-required: legacy Sales decimal is not canonical/u);
    assert.equal(await targetTableCount(client), 2, "Over-128 legacy money refuses before schema mutation.");

    await resetPredecessor(client);
    await client.query("drop table k_nex_migration_revision; drop table payload_mcp_api_keys; alter index sales_opportunities_stage_idx rename to stage_idx");
    await up({ db });
    assert.equal(await targetTableCount(client), targetTables.length, "Payload-led generated predecessor needs no fixture-only revision table.");
    assert.equal((await client.query("select to_regclass('public.payload_mcp_api_keys')::text as table_name")).rows[0].table_name, null, "Table-absent clean install does not invent Payload MCP storage.");

    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys drop column payload_mcp_tool_k_nex_sales_tools_search_tasks_v1, drop column payload_mcp_tool_k_nex_sales_tools_create_task_v1",
      "Missing v1 tool columns fail preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys drop column payload_mcp_tool_k_nex_sales_tools_create_task_v1",
      "Partial v1 tool columns fail preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys rename column payload_mcp_tool_k_nex_sales_tools_create_task_v1 to payload_mcp_tool_k_nex_sales_tools_create_task_v2",
      "Mixed v1/v2 tool columns fail preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys add column payload_mcp_tool_k_nex_sales_tools_search_tasks_v2 boolean default true, add column payload_mcp_tool_k_nex_sales_tools_create_task_v2 boolean default true",
      "Both-version tool columns fail preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys add column payload_mcp_tool_k_nex_sales_tools_search_tasks_v3 boolean default true",
      "Unexpected v3 tool column fails preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys alter column payload_mcp_tool_k_nex_sales_tools_search_tasks_v1 type text using payload_mcp_tool_k_nex_sales_tools_search_tasks_v1::text",
      "Wrong v1 tool type fails preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys alter column payload_mcp_tool_k_nex_sales_tools_search_tasks_v1 set not null",
      "Wrong v1 tool nullability fails preflight");
    await assertMcpShapeRefusal(client, db,
      "alter table payload_mcp_api_keys alter column payload_mcp_tool_k_nex_sales_tools_search_tasks_v1 drop default",
      "Wrong v1 tool default fails preflight");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query(`insert into k_nex_role_permission_grants
      (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation)
      values ('customer-alpha','manager-target-collision','sales.customer-manager','sales.opportunities.amount.read','extension','platform-plugin','module.sales',1)`);
    await bind(client);
    const collisionGrants = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    await assert.rejects(up({ db }), /maintenance-required: Sales permission mapping collision/u);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, collisionGrants.rows, "Permission collision refusal preserves every grant and revision.");
    assert.equal(await targetTableCount(client), 2, "Permission collision fails before CRM schema mutation.");
    assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision")).rows, [{ predecessor_revision: 23, revision: 24 }]);

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query("delete from k_nex_role_permission_grants where role_id='sales.customer-manager' and permission_id='sales.tasks.title.read'");
    await bind(client);
    const authorityDeltaGrants = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    await assert.rejects(up({ db }), /maintenance-required: Sales task field-authority removal cannot be represented/u);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, authorityDeltaGrants.rows, "Unrepresentable authority-delta refusal preserves grants.");
    assert.equal(await targetTableCount(client), 2, "Unrepresentable authority delta fails before CRM schema mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query(`insert into k_nex_roles (application_id,role_id,label) values ('customer-alpha','sales.cross-nav','Cross nav'),('customer-alpha','sales.cross-task','Cross task');
      insert into k_nex_role_permission_grants (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation) values
        ('customer-alpha','cross-nav','sales.cross-nav','sales.navigation.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-task-read','sales.cross-task','sales.tasks.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-task-title','sales.cross-task','sales.tasks.title.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-task-status','sales.cross-task','sales.tasks.status.read','extension','platform-plugin','module.sales',1);
      insert into k_nex_role_assignments (application_id,assignment_id,role_id,subject_kind,subject_id,state) values
        ('customer-alpha','cross-nav-assignment','sales.cross-nav','user','cross-1','active'),
        ('customer-alpha','cross-task-assignment','sales.cross-task','user','cross-1','active')`);
    await bind(client);
    const crossRoleGrants = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    await assert.rejects(up({ db }), /maintenance-required: active Sales principal cross-1 requires a nonrepresentable cross-role overview split/u);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, crossRoleGrants.rows, "Cross-role navigation refusal preserves grants.");
    assert.equal(await targetTableCount(client), 2, "Cross-role navigation refusal is pre-mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    await client.query(`insert into k_nex_roles (application_id,role_id,label) values ('customer-alpha','sales.cross-note-task','Cross note task'),('customer-alpha','sales.cross-note-private','Cross note private');
      insert into k_nex_role_permission_grants (application_id,grant_id,role_id,permission_id,owner_kind,owner_delivery_class,owner_extension_id,owner_generation) values
        ('customer-alpha','cross-note-navigation','sales.cross-note-task','sales.navigation.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-note-task-read','sales.cross-note-task','sales.tasks.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-note-task-title','sales.cross-note-task','sales.tasks.title.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-note-task-status','sales.cross-note-task','sales.tasks.status.read','extension','platform-plugin','module.sales',1),
        ('customer-alpha','cross-note-private','sales.cross-note-private','sales.tasks.private-note.read','extension','platform-plugin','module.sales',1);
      insert into k_nex_role_assignments (application_id,assignment_id,role_id,subject_kind,subject_id,state) values
        ('customer-alpha','cross-note-task-assignment','sales.cross-note-task','user','cross-note-1','active'),
        ('customer-alpha','cross-note-private-assignment','sales.cross-note-private','user','cross-note-1','active')`);
    await bind(client);
    const crossRoleNoteGrants = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    const crossRoleNoteState = await client.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id='customer-alpha'");
    await assert.rejects(up({ db }), /maintenance-required: active Sales principal cross-note-1 requires a nonrepresentable cross-role private-note split/u);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, crossRoleNoteGrants.rows, "Cross-role private-note refusal preserves grants and revisions.");
    assert.deepEqual((await client.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id='customer-alpha'")).rows, crossRoleNoteState.rows, "Cross-role private-note refusal preserves authority revisions.");
    assert.equal(await targetTableCount(client), 2, "Cross-role private-note refusal is pre-schema-mutation.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    const { oldDependencyDigest } = await insertWorkspaceReference(client);
    await bind(client);
    await client.query("begin");
    try {
      await up({ db });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    assert.deepEqual((await client.query("select permission_id from k_nex_role_permission_grants where role_id='sales.customer-viewer' order by permission_id")).rows,
      [{ permission_id: "sales.opportunities.read" }, { permission_id: "sales.reports.read" }, { permission_id: "sales.tasks.read" }], "Retired navigation maps only to executable overview authority.");
    assert.deepEqual((await client.query("select permission_id from k_nex_role_permission_grants where role_id='sales.customer-nav-only' order by permission_id")).rows,
      [], "Navigation-only predecessor grant has no faithful executable replacement and cannot widen data/overview authority.");
    assert.deepEqual((await client.query("select authorization_revision,lifecycle_revision from k_nex_authorization_state where application_id='customer-alpha'")).rows,
      [{ authorization_revision: 8, lifecycle_revision: 3 }], "Grant/adoption rewrite advances exact authorization CAS revision once.");
    const authorityAudits = (await client.query("select permission_id,outcome,reason,authorization_revision,lifecycle_revision,audit_json from k_nex_authorization_audit where application_id='customer-alpha' order by audit_id")).rows;
    assert.deepEqual(authorityAudits.map(({ permission_id, outcome, reason, authorization_revision, lifecycle_revision }) => ({ permission_id, outcome, reason, authorization_revision, lifecycle_revision })),
      [{ permission_id: "system.role-assignments.manage", outcome: "allow", reason: "granted", authorization_revision: 8, lifecycle_revision: 3 }], "Authority rewrite leaves immutable audit evidence.");
    assert.deepEqual(AuthorizationDecisionAuditSchema.parse(authorityAudits[0].audit_json), {
      schemaVersion: 1, auditId: authorityAudits[0].audit_json.auditId, decisionId: authorityAudits[0].audit_json.decisionId, correlationId: authorityAudits[0].audit_json.correlationId,
      applicationId: "customer-alpha", environment: "production", permissionId: "system.role-assignments.manage", owner: { kind: "platform", namespace: "system" },
      principal: { kind: "service", id: "system:p13-2-migration" }, effectiveActor: { kind: "service", id: "system:p13-2-migration" },
      scope: { kind: "application", resource: "system.role-assignments" }, operation: "migrate-sales-authority", target: "sales.role-grants", authorizationRevision: 8, lifecycleRevision: 3,
      outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required"
    }, "Authority rewrite audit remains listable by the strict canonical projection.");
    assert.deepEqual((await client.query("select authorization_revision,lifecycle_revision,event_json from k_nex_authorization_outbox where application_id='customer-alpha' order by authorization_revision")).rows,
      [{ authorization_revision: 8, lifecycle_revision: 3, event_json: { applicationId: "customer-alpha", environment: "production", scope: "application", authorizationRevision: 8, lifecycleRevision: 3 } }], "Authority rewrite writes one canonical invalidation event.");
    assert.deepEqual((await client.query("select template_version::int as template_version,old_baseline_permission_ids,old_baseline_digest,revision from k_nex_role_template_adoptions where adoption_id='viewer-adoption'")).rows, [{
      template_version: 2, old_baseline_permission_ids: migratedViewerBaseline,
      old_baseline_digest: digest(migratedViewerBaseline), revision: 1
    }], "Adoption baseline truthfully records the migrated predecessor baseline without adding grants.");
    const managerPermissions = (await client.query("select permission_id from k_nex_role_permission_grants where role_id='sales.customer-manager' order by permission_id")).rows.map(({ permission_id }) => permission_id);
    assert.deepEqual(managerPermissions, [
      "sales.contacts.read", "sales.notes.body.read", "sales.notes.read", "sales.opportunities.amount.read",
      "sales.opportunities.read", "sales.opportunities.stage.update", "sales.opportunities.write", "sales.reports.read", "sales.tasks.read"
    ], "Custom role grant keeps executable overview and stage action while the customer's removed task-write grant stays removed.");
    assert.deepEqual((await client.query("select principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,revision from sales_current_authority_scopes order by principal_id")).rows, [
      { principal_id: "permission-only-1", record_scope: "application-sales-scope", application_wide: true, mutation_allowed: true, authorized_team_ids: [], revision: 1 },
      { principal_id: "reader-1", record_scope: "explicit-application-or-team-scope", application_wide: true, mutation_allowed: false, authorized_team_ids: [], revision: 1 },
      { principal_id: "writer-1", record_scope: "application-sales-scope", application_wide: true, mutation_allowed: true, authorized_team_ids: [], revision: 1 }
    ], "Permission-only current grants remain active scope inputs without inventing navigation/read authority; multi-role grants aggregate and revoked/retired grants cannot revive scope.");
    const managerAdoption = (await client.query("select template_version::int as template_version,old_baseline_permission_ids,old_baseline_digest from k_nex_role_template_adoptions where adoption_id='manager-adoption'")).rows[0];
    assert.deepEqual(managerAdoption, { template_version: 2, old_baseline_permission_ids: migratedManagerBaseline, old_baseline_digest: digest(migratedManagerBaseline) });
    const comparison = compareTemplateBaseline({
      stored: { digestAlgorithm: "sha256-canonical-json-v1", oldBaselineDigest: managerAdoption.old_baseline_digest, oldBaselinePermissionIds: managerAdoption.old_baseline_permission_ids },
      currentOwnerPermissionIds: managerPermissions,
      newBaselinePermissionIds: [...migratedManagerBaseline, "sales.accounts.read"].sort()
    });
    assert.deepEqual(comparison.customerAddedPermissionIds, ["sales.contacts.read"]);
    assert.deepEqual(comparison.customerRemovedPermissionIds, ["sales.tasks.write"]);
    assert.deepEqual(comparison.templateAddedPermissionIds, ["sales.accounts.read"]);
    assert.deepEqual(comparison.templateRemovedPermissionIds, [], "Subsequent three-way comparison retains independent customer and template deltas.");
    assert.deepEqual((await client.query("select values_json,document_revision,settings_revision from k_nex_system_settings_documents where descriptor_id='sales.settings.workspace'")).rows, [{
      values_json: { defaultTaskPageSize: 25, showPotentialRevenue: true, defaultPage: "tasks", pipelineStages: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] },
      document_revision: 5, settings_revision: 8
    }]);
    assert.deepEqual((await client.query("select settings_revision from k_nex_system_settings_state where application_id='customer-alpha' and environment='production'")).rows,
      [{ settings_revision: 8 }], "Document CAS uses its own stale snapshot while global settings revision advances independently.");
    assert.deepEqual((await client.query("select ordered_stage_ids from sales_pipelines where is_active")).rows,
      [{ ordered_stage_ids: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] }], "Legacy ordered names seed exactly one canonical pipeline.");
    const workingReference = (await client.query("select working_copy_json from k_nex_workspace_working_copies")).rows[0].working_copy_json.regions?.main?.[0]
      ?? (await client.query("select working_copy_json from k_nex_workspace_working_copies")).rows[0].working_copy_json.document.regions.main[0];
    assert.equal(workingReference.version, 3);
    assert.deepEqual(workingReference.props, { title: "Tasks" }, "Compatible customer block props survive the version rebind exactly.");
    assert.deepEqual(workingReference.bindings.action, { id: "sales.task.update", version: 2 });
    assert.deepEqual(workingReference.bindings.source.source, { id: "sales.tasks", version: 2 });
    assert.equal(workingReference.bindings.source.structuralCompatibilityHash, "sha256:a0211668702800a1abd7ad5408847da099a84acc20d0cce098b672d4eea062c3");
    const published = (await client.query("select revision_id,document_revision,dependency_digest,revision_json from k_nex_workspace_published_revisions order by document_revision")).rows;
    assert.deepEqual(published.map(({ revision_id, document_revision }) => ({ revision_id, document_revision })), [
      { revision_id: "publication-1", document_revision: 1 },
      { revision_id: "publication-2", document_revision: 2 }
    ], "Historical publication document revisions remain distinct from live page revision.");
    for (const revision of published) {
      assert.notEqual(revision.dependency_digest, oldDependencyDigest);
      assert.equal(revision.revision_json.dependencies.digest, revision.dependency_digest);
      assert.deepEqual(revision.revision_json.dependencies.entries.map(({ id, version }) => [id, version]), [["sales.task-table", 3], ["sales.tasks", 2]]);
    }
    assert.deepEqual((await client.query("select page_revision,published_revision_id,dependency_digest,page_json->>'dependencyDigest' as json_digest from k_nex_workspace_pages")).rows, [{
      page_revision: 7,
      published_revision_id: "publication-2",
      dependency_digest: published[1].dependency_digest,
      json_digest: published[1].dependency_digest
    }], "Live pointer CAS follows only current publication; page and document revisions need not match.");
    assert.deepEqual((await client.query("select count(*)::int as count,bool_or(executable) as executable from sales_retired_identity_tombstones")).rows,
      [{ count: 22, executable: false }]);
    assert.equal((await client.query("select count(*)::int as count from sales_crm_migration_receipts")).rows[0].count, 0, "Persisted authorization/page evidence does not fabricate legacy-object receipts.");
    assert.deepEqual((await client.query("select permission_json,state from k_nex_permission_catalog_snapshots")).rows,
      [{ permission_json: { id: "sales.tasks.title.read" }, state: "deprecated" }], "Retired administrative snapshot remains diagnostic and non-authoritative.");

    await resetPredecessor(client);
    await installPhase12ReferenceStorage(db, client);
    const unresolved = await insertWorkspaceReference(client, { retired: true });
    await bind(client);
    const beforeRefusal = await client.query("select working_copy_json from k_nex_workspace_working_copies");
    const grantsBeforeRefusal = await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id");
    await assert.rejects(up({ db }), /maintenance-required: retired Sales reference sales.total-potential-revenue remains executable/u);
    assert.equal(await targetTableCount(client), 2, "Unresolved persisted reference fails before CRM schema mutation.");
    assert.deepEqual((await client.query("select working_copy_json from k_nex_workspace_working_copies")).rows, beforeRefusal.rows);
    assert.equal((await client.query("select dependency_digest from k_nex_workspace_published_revisions")).rows[0].dependency_digest, unresolved.oldDependencyDigest);
    assert.deepEqual((await client.query("select grant_id,permission_id,revision from k_nex_role_permission_grants order by grant_id")).rows, grantsBeforeRefusal.rows, "Unresolved page reference cannot partially migrate grants.");
    assert.deepEqual((await client.query("select predecessor_revision,revision from k_nex_migration_revision")).rows, [{ predecessor_revision: 23, revision: 24 }]);
  } finally {
    client.release();
    await pool.end();
    await container.stop();
  }
});
