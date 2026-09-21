import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { down, up } from "../dist/src/migrations/20260907_000030_pipeline_saved_views.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
const drizzle = {
  escapeName: (name) => `"${name.replaceAll('"', '""')}"`,
  escapeParam: (index) => `$${index + 1}`,
  escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
  casing: { getColumnCasing: (column) => column.name }
};
const migrationDb = (client) => ({ execute: async (statement) => {
  const query = statement.toQuery({ ...drizzle, paramStartIndex: { value: 0 } });
  return client.query(query.sql, query.params);
} });

async function predecessor(client, stageCount = 6) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS k_nex_system_settings_state (application_id text NOT NULL,environment text NOT NULL,settings_revision integer NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,environment));
    CREATE TABLE IF NOT EXISTS k_nex_system_settings_documents (application_id text NOT NULL,environment text NOT NULL,descriptor_id text NOT NULL,descriptor_schema_version integer NOT NULL,owner_scope_key text NOT NULL,owner_kind text NOT NULL,owner_namespace text,owner_delivery_class text,owner_extension_id text,owner_generation bigint,document_revision integer NOT NULL,settings_revision integer NOT NULL,values_json jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key));
    CREATE TABLE IF NOT EXISTS k_nex_workspace_pages (id serial PRIMARY KEY,application_id text NOT NULL,environment text NOT NULL,state text NOT NULL,page_json jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS k_nex_workspace_working_copies (id serial PRIMARY KEY,application_id text NOT NULL,environment text NOT NULL,working_copy_json jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS k_nex_workspace_published_revisions (application_id text NOT NULL,environment text NOT NULL,page_id text NOT NULL,revision_id text NOT NULL,document_json jsonb NOT NULL,PRIMARY KEY(application_id,environment,page_id,revision_id));
    CREATE TABLE IF NOT EXISTS sales_action_idempotency (application_id text NOT NULL,environment text NOT NULL,effective_actor_id text NOT NULL,action_id text NOT NULL,idempotency_key text NOT NULL,result_json jsonb NOT NULL,PRIMARY KEY(application_id,environment,effective_actor_id,action_id,idempotency_key));
    CREATE TABLE sales_pipelines (
      id serial PRIMARY KEY, application_id varchar(128) NOT NULL, environment varchar(64) NOT NULL,
      revision integer NOT NULL DEFAULT 1, status varchar(16) NOT NULL DEFAULT 'active', name text NOT NULL,
      ordered_stage_ids jsonb NOT NULL, is_active boolean NOT NULL DEFAULT false, audit jsonb NOT NULL,
      UNIQUE(id,application_id,environment)
    );
    CREATE UNIQUE INDEX sales_pipelines_one_active_idx ON sales_pipelines(application_id,environment) WHERE is_active;
    CREATE TABLE sales_pipeline_stages (
      id serial PRIMARY KEY, application_id varchar(128) NOT NULL, environment varchar(64) NOT NULL,
      revision integer NOT NULL DEFAULT 1, status varchar(16) NOT NULL DEFAULT 'active', pipeline_id integer NOT NULL,
      stage_id varchar(128) NOT NULL, name text NOT NULL, semantic varchar(16) NOT NULL, position integer NOT NULL,
      probability_basis_points integer NOT NULL, allowed_transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
      audit jsonb NOT NULL,
      UNIQUE(application_id,environment,pipeline_id,stage_id),
      FOREIGN KEY(pipeline_id,application_id,environment) REFERENCES sales_pipelines(id,application_id,environment)
    );
    CREATE TABLE sales_opportunities (
      id serial PRIMARY KEY, application_id varchar(128) NOT NULL, environment varchar(64) NOT NULL,
      pipeline_id integer NOT NULL, stage_id varchar(128) NOT NULL, owner_id text NOT NULL,created_by text NOT NULL,updated_by text NOT NULL,
      revision integer NOT NULL,audit jsonb NOT NULL,archive_status text NOT NULL,amount text,currency text,expected_close_date text,closed_at timestamptz,loss_reason text,
      CONSTRAINT sales_opportunities_check CHECK (application_id<>'' AND environment<>'' AND owner_id<>'' AND created_by<>'' AND updated_by<>'' AND revision BETWEEN 1 AND 1000000000 AND jsonb_typeof(audit)='array' AND archive_status IN ('active','archived') AND (stage_id NOT IN ('won','lost') OR closed_at IS NOT NULL) AND (stage_id<>'lost' OR loss_reason IS NOT NULL))
    );
  `);
  await client.query("insert into k_nex_system_settings_state(application_id,environment,settings_revision) values ('app-a','production',1) on conflict do nothing");
  await client.query("insert into k_nex_system_settings_documents(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json) values ('app-a','production','sales.settings.workspace',1,'platform-plugin:module.sales:1','extension','platform-plugin','module.sales',1,1,1,$1::jsonb) on conflict do nothing", [JSON.stringify({ defaultRoute: "sales.route.overview", pipelineStages: semantics })]);
  await client.query("insert into sales_pipelines(id,application_id,environment,revision,name,ordered_stage_ids,is_active,audit) values (17,'app-a','production',1,'Primary',$1::jsonb,true,$2::jsonb)", [JSON.stringify(semantics.slice(0, stageCount)), JSON.stringify([{ kind: "phase-13-settings-migration" }])]);
  for (const [position, semantic] of semantics.slice(0, stageCount).entries()) {
    const next = position < 4 ? semantics[position + 1] : undefined; const audit = [{ kind: "phase-13-settings-migration" }];
    await client.query(`insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,name,semantic,position,probability_basis_points,allowed_transitions,audit)
      values ('app-a','production',17,$1,$2,$1,$3,$4,$5::jsonb,$6::jsonb)`, [semantic, semantic, position, position * 2000, JSON.stringify(next === undefined ? [] : [next]), JSON.stringify(audit)]);
  }
  if (stageCount === 6) {
    await client.query("insert into sales_pipelines(id,application_id,environment,revision,status,name,ordered_stage_ids,is_active,audit) values (18,'app-a','production',1,'archived','Archived',$1::jsonb,false,$2::jsonb)", [JSON.stringify(semantics), JSON.stringify([{ kind: "phase-13-settings-migration" }])]);
    for (const [position, semantic] of semantics.entries()) {
      const next = position < 4 ? semantics[position + 1] : undefined;
      await client.query(`insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,name,semantic,position,probability_basis_points,allowed_transitions,audit)
        values ('app-a','production',18,$1,$2,$1,$3,$4,$5::jsonb,$6::jsonb)`, [semantic, `Archived ${semantic}`, position, position * 2000, JSON.stringify(next === undefined ? [] : [next]), JSON.stringify([{ kind: "phase-13-settings-migration" }])]);
    }
    await client.query("insert into sales_opportunities(application_id,environment,pipeline_id,stage_id,owner_id,created_by,updated_by,revision,audit,archive_status) values ('app-a','production',17,'discovery','seller-1','seller-1','seller-1',1,'[]','active')");
    const editable = { id: "page-a", version: 1, schemaVersion: 1, profile: "workspace", regions: { main: [
      { id: "sales-node", type: "sales.opportunity-list", version: 3, props: { stageId: "discovery", destinationStageId: "won", fieldId: "stage-id", value: ["qualification", "won"] }, bindings: { source: { source: { id: "sales.opportunities", version: 2 }, input: {}, structuralCompatibilityHash: "sha256:49a707b6f512bc0d8cad02c38a506066e6973e09468e1e3c8373c8e1287ade5d", selectedFields: ["name", "stage-id"] }, action: { id: "sales.opportunity.stage.update", version: 2 } } },
      { id: "custom-lookalike", type: "customer.custom", version: 1, props: { stageId: "discovery", destinationStageId: "won", orderedStageIds: semantics, filter: { fieldId: "stage-id", value: ["qualification", "won"] } }, bindings: { source: { source: { id: "customer.lookalike", version: 2 }, input: { stageId: "discovery" }, structuralCompatibilityHash: "old", selectedFields: [] } } }
    ] } };
    await client.query("insert into k_nex_workspace_pages(application_id,environment,state,page_json) values ('app-a','production','draft',$1::jsonb)", [JSON.stringify(editable)]);
    await client.query("insert into k_nex_workspace_working_copies(application_id,environment,working_copy_json) values ('app-a','production',$1::jsonb)", [JSON.stringify(editable)]);
    await client.query("insert into k_nex_workspace_published_revisions values ('app-a','production','page-a','r1',$1::jsonb) on conflict do nothing", [JSON.stringify(editable)]);
    await client.query("insert into sales_action_idempotency values ('app-a','production','seller-1','sales.task.create','idem-a',$1::jsonb) on conflict do nothing", [JSON.stringify({ id: "1", revision: 1, status: "open", title: "Frozen" })]);
  }
}

test("P13.4 migrates opaque stage identities atomically, persists evidence, and replays safely", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_4_pipeline").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 1 });
  const client = await pool.connect();
  const db = migrationDb(client);
  try {
    await client.query("create table payload_locked_documents_rels (id serial primary key)");
    await predecessor(client, 5);
    await client.query("update sales_pipelines set is_active=false where id=17");
    await client.query("begin");
    await assert.rejects(up({ db }), /maintenance-required: P13\.4 requires one complete active pipeline/u);
    await client.query("rollback");
    await client.query("update sales_pipelines set is_active=true where id=17");
    await client.query("begin");
    await assert.rejects(up({ db }), /maintenance-required: P13\.4 requires one complete active pipeline/u);
    await client.query("rollback");
    assert.deepEqual((await client.query("select column_name from information_schema.columns where table_name='sales_pipeline_stages' and column_name in ('allowed_transitions','required_field_ids') order by column_name")).rows, [{ column_name: "allowed_transitions" }], "failed preflight has no schema side effects");

    await client.query("drop table sales_opportunities,sales_pipeline_stages,sales_pipelines cascade");
    await predecessor(client);
    const assertPreflightClean = async () => {
      assert.deepEqual((await client.query("select column_name from information_schema.columns where table_name='sales_pipeline_stages' and column_name in ('allowed_transitions','required_field_ids') order by column_name")).rows, [{ column_name: "allowed_transitions" }]);
      assert.equal((await client.query("select to_regclass('public.sales_pipeline_stage_migration_receipts') name")).rows[0].name, null);
    };
    const malformedStage = async (setup) => {
      await client.query("begin"); await setup();
      await assert.rejects(up({ db }), /requires one complete active pipeline|receipt plan is not an exact six-Stage snapshot/u);
      await client.query("rollback"); await assertPreflightClean();
    };
    await malformedStage(() => client.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,name,semantic,position,probability_basis_points,allowed_transitions,audit,status) values ('app-a','production',17,'archived-extra','Archived extra','qualification',7,0,'[]','[{\"kind\":\"phase-13-settings-migration\"}]','archived')"));
    await malformedStage(() => client.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,name,semantic,position,probability_basis_points,allowed_transitions,audit) values ('app-a','production',17,'active-extra','Active extra','custom',7,0,'[]','[{\"kind\":\"phase-13-settings-migration\"}]')"));
    await malformedStage(async () => { await client.query("delete from sales_pipeline_stages where pipeline_id=17 and semantic='lost'"); await client.query("insert into sales_pipeline_stages(application_id,environment,pipeline_id,stage_id,name,semantic,position,probability_basis_points,allowed_transitions,audit) values ('app-a','production',17,'qualification-copy','Qualification copy','qualification',5,0,'[]','[{\"kind\":\"phase-13-settings-migration\"}]')"); });
    await malformedStage(() => client.query("update sales_pipelines set ordered_stage_ids='[\"qualification\",\"discovery\",\"proposal\",\"negotiation\",\"won\",\"won\"]'::jsonb where id=17"));
    await malformedStage(() => client.query("update sales_pipeline_stages set position=9 where pipeline_id=17 and semantic='qualification'"));
    await malformedStage(() => client.query("update sales_pipeline_stages set position=0 where pipeline_id=17 and semantic='discovery'"));
    await malformedStage(() => client.query("update sales_pipeline_stages set allowed_transitions='[\"lost\"]'::jsonb where pipeline_id=17 and semantic='won'"));
    await malformedStage(() => client.query("update sales_pipelines set status='archived' where id=17 and is_active"));
    const malformedIdentity = async (setup) => { await client.query("begin"); await setup(); await assert.rejects(up({ db }), /UUID identity dimensions are invalid/u); await client.query("rollback"); await assertPreflightClean(); };
    const insertMalformedScope = async (application, environment, pipelineId) => {
      await client.query("insert into k_nex_system_settings_state(application_id,environment,settings_revision) values ($1,$2,1)", [application, environment]);
      await client.query("insert into k_nex_system_settings_documents(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json) values ($1,$2,'sales.settings.workspace',1,'platform-plugin:module.sales:1','extension','platform-plugin','module.sales',1,1,1,$3::jsonb)", [application, environment, JSON.stringify({ defaultRoute: "sales.route.overview", pipelineStages: semantics })]);
      await client.query("insert into sales_pipelines(id,application_id,environment,revision,name,ordered_stage_ids,is_active,audit) values ($1,$2,$3,1,'Malformed',$4::jsonb,true,$5::jsonb)", [pipelineId, application, environment, JSON.stringify(semantics), JSON.stringify([{ kind: "phase-13-settings-migration" }])]);
    };
    await malformedIdentity(() => insertMalformedScope("é".repeat(65), "production", 19));
    await malformedIdentity(() => insertMalformedScope("app-b", "é".repeat(33), 19));
    await malformedIdentity(() => insertMalformedScope("app-b", "production", 0));
    const insertGeneral = async (version, values) => client.query("insert into k_nex_system_settings_documents(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,document_revision,settings_revision,values_json) values ('app-a','production','system.general',$1,'platform:system','platform','system',1,1,$2::jsonb)", [version, JSON.stringify(values)]);
    await client.query("insert into k_nex_system_settings_documents(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,document_revision,settings_revision,values_json) values ('app-a','production','system.general',1,'forged:owner','platform','system',1,1,$1::jsonb)", [JSON.stringify({ siteName: "Forged" })]);
    await client.query("begin"); await assert.rejects(up({ db }), /system\.general predecessor ownership or schema conflicts/u); await client.query("rollback"); await client.query("delete from k_nex_system_settings_documents where descriptor_id='system.general'"); await assertPreflightClean();
    await insertGeneral(1, { siteName: "Acme" });
    await insertGeneral(2, { siteName: "Acme", reportingTimezone: "UTC" });
    await client.query("begin");
    await assert.rejects(up({ db }), /system\.general predecessor ownership or schema conflicts/u);
    await client.query("rollback");
    await client.query("delete from k_nex_system_settings_documents where descriptor_id='system.general'");
    await insertGeneral(1, { siteName: "Future" });
    await client.query("update k_nex_system_settings_documents set document_revision=2,settings_revision=2 where descriptor_id='system.general'");
    await client.query("begin");
    await assert.rejects(up({ db }), /system\.general predecessor ownership or schema conflicts/u);
    await client.query("rollback");
    await client.query("delete from k_nex_system_settings_documents where descriptor_id='system.general'");
    await insertGeneral(1, { siteName: "Advanced" });
    await client.query("update k_nex_system_settings_documents set document_revision=2,settings_revision=2 where descriptor_id='system.general'");
    await client.query("update k_nex_system_settings_state set settings_revision=5 where application_id='app-a' and environment='production'");
    await client.query("begin");
    await up({ db });
    assert.deepEqual((await client.query("select d.document_revision,d.settings_revision,s.settings_revision state_revision from k_nex_system_settings_documents d join k_nex_system_settings_state s using(application_id,environment) where d.descriptor_id='system.general' and d.descriptor_schema_version=2")).rows[0], { document_revision: 3, settings_revision: 6, state_revision: 6 }, "an unrelated global settings advance preserves the document fence while upgrading v1");
    await client.query("rollback");
    await client.query("update k_nex_system_settings_state set settings_revision=1 where application_id='app-a' and environment='production'");
    await client.query("delete from k_nex_system_settings_documents where descriptor_id='system.general'");
    await insertGeneral(1, { siteName: "Acme", forged: true });
    await client.query("begin");
    await assert.rejects(up({ db }), /system\.general v1 is invalid/u);
    await client.query("rollback");
    await client.query("delete from k_nex_system_settings_documents where descriptor_id='system.general'");
    await insertGeneral(1, { siteName: "Acme" });
    await client.query("begin");
    await up({ db });
    assert.deepEqual((await client.query("select values_json from k_nex_system_settings_documents where descriptor_id='system.general' and descriptor_schema_version=2")).rows[0].values_json, { siteName: "Acme", reportingTimezone: "UTC" }, "valid v1 materializes as coherent v2 UTC");
    await client.query("rollback");
    assert.equal((await client.query("select descriptor_schema_version from k_nex_system_settings_documents where descriptor_id='system.general'")).rows[0].descriptor_schema_version, 1, "full v1 migration rolls back atomically");
    await client.query("delete from k_nex_system_settings_documents where descriptor_id='system.general'");
    await client.query("begin");
    await up({ db });
    await client.query("commit");

    const stages = (await client.query("select stage_id,semantic,allowed_transition_stage_ids,required_field_ids,audit,revision from sales_pipeline_stages where pipeline_id=17 order by position")).rows;
    assert.equal(stages.length, 6);
    assert.ok(stages.every(({ stage_id }) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(stage_id)));
    assert.deepEqual(stages.at(-1).required_field_ids, ["lossReason"]);
    assert.ok(stages.every(({ audit, revision }) => revision === 2 && audit.length === 2 && audit[1].kind === "phase-13-pipeline-stage-identity"), "all six Stage histories append the exact migration revision");
    assert.equal((await client.query("select stage_id from sales_opportunities")).rows[0].stage_id, stages[1].stage_id, "mutable reference follows the immutable translation map");
    const pipeline = (await client.query("select revision,audit,ordered_stage_ids from sales_pipelines where id=17")).rows[0];
    assert.equal(pipeline.revision, 2);
    assert.equal(pipeline.audit.length, 2);
    assert.equal(pipeline.audit[1].kind, "phase-13-pipeline-stage-identity");
    assert.deepEqual(pipeline.ordered_stage_ids, stages.map(({ stage_id }) => stage_id));
    const settings = (await client.query("select descriptor_schema_version,values_json from k_nex_system_settings_documents where descriptor_id='sales.settings.workspace'")).rows[0];
    assert.equal(settings.descriptor_schema_version, 2);
    assert.equal(Object.hasOwn(settings.values_json, "pipelineStages"), false);
    const general = (await client.query("select d.document_revision,d.settings_revision,d.values_json,s.settings_revision state_revision from k_nex_system_settings_documents d join k_nex_system_settings_state s using(application_id,environment) where d.descriptor_id='system.general' and d.descriptor_schema_version=2 and d.owner_scope_key='platform:system'")).rows[0];
    assert.deepEqual(general, { document_revision: 1, settings_revision: 2, values_json: { siteName: "K-Nex", reportingTimezone: "UTC" }, state_revision: 2 });
    for (const table of ["k_nex_workspace_pages", "k_nex_workspace_working_copies"]) {
      const column = table.endsWith("pages") ? "page_json" : "working_copy_json";
      const editable = (await client.query(`select ${column} document from ${table}`)).rows[0].document;
      const salesNode = editable.regions.main[0]; const lookalike = editable.regions.main[1];
      assert.equal(salesNode.bindings.source.source.version, 3);
      assert.equal(salesNode.bindings.source.structuralCompatibilityHash, "sha256:82668a173c4ee1ce38924b5f99846f86644f437a3926299927cf979426f826ad");
      assert.equal(salesNode.bindings.action.version, 3);
      assert.deepEqual(salesNode.props, { stageId: "discovery", destinationStageId: "won", fieldId: "stage-id", value: ["qualification", "won"] }, "unowned lookalikes inside a Sales node are unchanged");
      assert.equal(lookalike.bindings.source.input.stageId, "discovery");
      assert.deepEqual(lookalike.props.orderedStageIds, semantics, "custom lookalike references remain byte-semantic equivalents");
    }
    const frozenPublished = (await client.query("select document_json from k_nex_workspace_published_revisions")).rows[0].document_json;
    assert.equal(frozenPublished.regions.main[0].bindings.source.source.version, 2, "published evidence bytes remain immutable");
    assert.equal((await client.query("select result_json->>'title' title from sales_action_idempotency")).rows[0].title, "Frozen");
    assert.equal((await client.query("select count(*)::int count from sales_pipeline_stage_migration_receipts")).rows[0].count, 2, "active and archived pipelines receive receipts");
    assert.equal((await client.query("select count(*)::int count from sales_pipeline_stage_translation_evidence")).rows[0].count, 12);
    assert.equal((await client.query("select count(*)::int count from sales_pipeline_stages where pipeline_id=18 and stage_id ~ '^[0-9a-f-]{36}$' and revision=2")).rows[0].count, 6, "archived pipeline mapping is complete");
    await assert.rejects(client.query("update sales_pipeline_stage_translation_evidence set source_revision=9"), { code: "55000" });
    assert.equal((await client.query("select to_regclass('public.sales_saved_views')::text name")).rows[0].name, "sales_saved_views");
    assert.deepEqual((await client.query("select column_name from information_schema.columns where table_name='payload_locked_documents_rels' and column_name='sales_saved_views_id'")).rows, [{ column_name: "sales_saved_views_id" }]);

    const exactDefinition = JSON.stringify({ x: "a".repeat(16_376) });
    assert.equal(Buffer.byteLength(exactDefinition), 16_384);
    await client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1','Résumé','personal','table','sales.object.account',$1::jsonb)", [exactDefinition]);
    assert.equal((await client.query("select public.sales_saved_view_canonical_json($1::jsonb) value", ['{ \"z\": 1, \"a\": [ true, null ] }'])).rows[0].value, '{"a":[true,null],"z":1}', "database canonicalization is sorted and whitespace-free");
    await assert.rejects(client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1','Too large','personal','table','sales.object.account',$1::jsonb)", [JSON.stringify({ x: "a".repeat(16_377) })]), { code: "23514" });
    await assert.rejects(client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1',$1,'personal','table','sales.object.account','{}')", ["Re\u0301sume\u0301"]), { code: "23514" });
    await assert.rejects(client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1',' Padded ','personal','table','sales.object.account','{}')"), { code: "23514" });
    await assert.rejects(client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,visibility_team_id,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1','Team','team',$1,'table','sales.object.account','{}')", ["e\u0301"]), { code: "23514" });
    await client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,visibility_team_id,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1','Team exact','team',$1,'table','sales.object.account','{}')", ["é".repeat(60)]);
    await assert.rejects(client.query("insert into sales_saved_views(application_id,environment,owner_id,created_by,updated_by,name,visibility,visibility_team_id,view_kind,target_object_id,definition) values ('app-a','production','seller-1','seller-1','seller-1','Team too long','team',$1,'table','sales.object.account','{}')", ["é".repeat(61)]), { code: "23514" });

    const won = stages.find(({ semantic }) => semantic === "won").stage_id;
    const lost = stages.find(({ semantic }) => semantic === "lost").stage_id;
    const qualification = stages.find(({ semantic }) => semantic === "qualification").stage_id;
    const rejected = async (query, parameters) => {
      await client.query("savepoint lifecycle_case");
      await assert.rejects(client.query(query, parameters), /lifecycle does not match referenced Stage semantic/u);
      await client.query("rollback to savepoint lifecycle_case");
    };
    await client.query("begin");
    await rejected("update sales_opportunities set stage_id=$1,closed_at=null,loss_reason=null where id=1", [won]);
    await rejected("update sales_opportunities set stage_id=$1,closed_at=now(),loss_reason=null where id=1", [qualification]);
    await rejected("update sales_opportunities set stage_id=$1,closed_at=now(),loss_reason=null where id=1", [lost]);
    await client.query("update sales_opportunities set stage_id=$1,closed_at=now(),loss_reason='No fit' where id=1", [lost]);
    await client.query("rollback");

    const snapshot = JSON.stringify((await client.query("select pipeline_id,stage_id,semantic,required_field_ids,audit from sales_pipeline_stages order by pipeline_id,position")).rows);
    await up({ db });
    assert.equal(JSON.stringify((await client.query("select pipeline_id,stage_id,semantic,required_field_ids,audit from sales_pipeline_stages order by pipeline_id,position")).rows), snapshot, "committed receipt makes replay idempotent");
    await client.query("update k_nex_system_settings_state set settings_revision=settings_revision+1 where application_id='app-a' and environment='production'");
    await up({ db });
    assert.deepEqual((await client.query("select d.document_revision,d.settings_revision,s.settings_revision state_revision from k_nex_system_settings_documents d join k_nex_system_settings_state s using(application_id,environment) where d.descriptor_id='system.general' and d.descriptor_schema_version=2")).rows[0], { document_revision: 1, settings_revision: 2, state_revision: 3 }, "replay tolerates an unrelated global settings advance without rewriting the system.general fence");
    await client.query("begin");
    await client.query("delete from k_nex_system_settings_state where application_id='app-a' and environment='production'");
    await assert.rejects(up({ db }), /receipt mapping or predecessor state conflicts/u);
    await client.query("rollback");
    assert.equal((await client.query("select count(*)::int count from sales_pipeline_stage_migration_receipts")).rows[0].count, 2, "missing-state replay has no receipt effect");
    await client.query("update sales_pipelines set is_active=false where id=17");
    await assert.rejects(up({ db }), /receipt mapping or predecessor state conflicts/u);
    await client.query("update sales_pipelines set is_active=true where id=17");
    await client.query("alter table sales_pipeline_stage_migration_receipts disable trigger sales_pipeline_stage_receipts_immutable");
    await client.query("update sales_pipeline_stage_migration_receipts set target_revision=99");
    await client.query("alter table sales_pipeline_stage_migration_receipts enable trigger sales_pipeline_stage_receipts_immutable");
    await assert.rejects(up({ db }), /receipt mapping or predecessor state conflicts/u);
    await client.query("alter table sales_pipeline_stage_migration_receipts disable trigger sales_pipeline_stage_receipts_immutable");
    await client.query("update sales_pipeline_stage_migration_receipts set target_revision=2");
    await client.query("alter table sales_pipeline_stage_migration_receipts enable trigger sales_pipeline_stage_receipts_immutable");
    await assert.rejects(down({ db }), /maintenance-required.*forward-only/u);
  } finally {
    client.release();
    await pool.end();
    await container.stop();
  }
});
