import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import salesManifest from "@k-nex/module-sales-current/manifest" with { type: "json" };
import { salesRegistration } from "@k-nex/module-sales-current/server";
import {
  createPlatformPluginLifecycleState,
  executeRegistration,
  reconcilePlatformPluginAvailability,
  scopePlatformPluginRegistration
} from "@k-nex/runtime";
import pg from "pg";
import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up } from "../dist/src/migrations/20260907_000031_data_movement.js";
import { parseSalesImportCsv } from "@k-nex/module-sales-current/server";
import { canonicalJson } from "@k-nex/contracts";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonicalDigest = (value) => digest(canonicalJson(value));

function scopedSalesRegistration() {
  const registration = executeRegistration({
    graph: { resolverVersion: "1.0.0", plugins: [{ id: salesManifest.id, kind: salesManifest.kind, package: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=", required: [], optional: [] }], capabilityProviders: [], registrationOrder: [salesManifest.id] },
    installed: [{ package: { name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" }, manifest: salesManifest }],
    registrations: [salesRegistration]
  });
  const lifecycle = reconcilePlatformPluginAvailability(registration, createPlatformPluginLifecycleState({
    pluginId: "module.sales", catalogStatus: "supported", package: { status: "installed", name: salesManifest.package, version: salesManifest.version, integrity: "sha512-c2FsZXM=" },
    enabled: true, configuration: { revision: 1, ready: true }, migration: { current: 1, required: 1, ready: true }, dataState: "active", releaseStatus: "supported"
  }));
  return scopePlatformPluginRegistration(registration, [lifecycle]);
}

test("P13.5 parser rejects malformed, oversized, formula, and protected-field input", () => {
  const mapping = [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }];
  for (const [bytes, code, selected = mapping] of [
    [Buffer.from("Name,Source\nOne,Web\n"), "IMPORT_INVALID_CSV"],
    [Buffer.alloc(16_777_217, 0x61), "IMPORT_LIMIT_EXCEEDED"],
    [Buffer.from("Name,Source\r\n =2+2,Web\r\n"), "IMPORT_UNSAFE_FORMULA"],
    [Buffer.from("Owner,Source\r\none,Web\r\n"), "IMPORT_PROTECTED_FIELD", [{ header: "Owner", fieldId: "ownerId" }, { header: "Source", fieldId: "source" }]]
  ]) assert.throws(() => parseSalesImportCsv(bytes, "sales.object.lead", selected), (error) => error?.code === code);
});

test("P13.5 fixture upload bounds chunked requests before authorization or database work", async () => {
  const { createSalesDataMovementEndpoints } = await import("../dist/src/data-movement-host.js"); let chunks = 0; let authorized = false;
  const body = new ReadableStream({ pull(controller) { if (chunks++ < 23) controller.enqueue(new Uint8Array(1_000_000)); else controller.close(); } });
  const request = new Request("http://localhost/k-nex/sales/import-upload", { method: "POST", body, duplex: "half", headers: { "content-type": "application/json" } });
  const upload = createSalesDataMovementEndpoints({ resolveDurableSalesAuthority() { authorized = true; throw new Error("must not authorize"); } }).find(({ path }) => path === "/k-nex/sales/import-upload");
  const response = await upload.handler(request); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: "IMPORT_LIMIT_EXCEEDED", status: 400 }); assert.equal(authorized, false);
});

test("P13.5 fixture upload admission CAS denies stale, revoked, disabled, raced, and promoted-away authority with zero rows", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_5_upload_admission").withStartupTimeout(120_000).start(); const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`create table payload_locked_documents_rels(id bigserial primary key);
      create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer);
      create table sales_current_authority_scopes(application_id text,environment text,principal_id text,record_scope text,application_wide boolean,mutation_allowed boolean,authorized_team_ids jsonb,state text,revision integer);
      create table k_nex_role_assignments(application_id text,role_id text,subject_kind text,subject_id text,state text);
      create table k_nex_role_permission_grants(application_id text,role_id text,permission_id text,owner_kind text,owner_delivery_class text,owner_extension_id text,owner_generation bigint);
      create table k_nex_extension_authorization_generations(application_id text,delivery_class text,extension_id text,authorization_generation bigint,runtime_generation_ids jsonb,state text,authorization_revision integer,lifecycle_revision integer);
      create table runtime_extensions(application_id text,environment text,delivery_class text,extension_id text,disposition text,active_generation_id text,active_generation jsonb);
      create table k_nex_permission_catalog_snapshots(application_id text,snapshot_id text,source text,permission_json jsonb,state text,owner_kind text,owner_delivery_class text,owner_extension_id text,owner_generation bigint);`);
    await up({ db: drizzle(pool) });
    await pool.query(`insert into k_nex_authorization_state values ('customer-gate-1',7,3);
      insert into sales_current_authority_scopes values ('customer-gate-1','production','upload-user','owned-or-assigned-team',false,true,'["team:upload-user"]'::jsonb,'active',11);
      insert into k_nex_role_assignments values ('customer-gate-1','sales.manager','user','upload-user','active');
      insert into k_nex_extension_authorization_generations values ('customer-gate-1','platform-plugin','module.sales',41,'["sales-generation-1"]'::jsonb,'current',7,3);
      insert into k_nex_role_permission_grants values ('customer-gate-1','sales.manager','sales.imports.execute','extension','platform-plugin','module.sales',41);
      insert into runtime_extensions values ('customer-gate-1','production','platform-plugin','module.sales','active','sales-generation-1','{"authority":"static-build","generationId":"sales-generation-1","sourceCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","applicationDigest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb);`);
    const [{ createSalesDataMovementEndpoints }, { createFixtureCurrentAuthority, createFixtureStaticProcessIdentityProvider }] = await Promise.all([import("../dist/src/data-movement-host.js"), import("../dist/src/current-authority.js")]);
    const durable = Object.freeze({ context: Object.freeze({ applicationId: "customer-gate-1", environment: "production", actorId: "upload-user", ownerId: "upload-user", teamId: "team:upload-user", permissionFingerprint: "p13-5-upload" }), recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: Object.freeze(["team:upload-user"]), scopeRevision: 11, authorizationRevision: 7, lifecycleRevision: 3, moduleSalesAuthorizationGeneration: 41, moduleSalesRuntimeGenerationIds: Object.freeze(["sales-generation-1"]), permissionGrants: Object.freeze(["sales.imports.execute"]) });
    const upload = createSalesDataMovementEndpoints({ async resolveDurableSalesAuthority() { return durable; } }).find(({ path }) => path === "/k-nex/sales/import-upload");
    const requestFor = (transactionID, session, artifactId) => Object.assign(new Request("http://localhost/k-nex/sales/import-upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId, bytesBase64: Buffer.from("Name,Source\\r\\nOne,Web\\r\\n").toString("base64"), contentType: "text/csv" }) }), { transactionID, user: { collection: "users", id: "upload-user", email: "upload@example.test" }, payload: { db: { pool, sessions: { [transactionID]: { db: drizzle(session) } } } } });
    const invokeWith = async (endpoint, artifactId) => {
      const session = await pool.connect(); const transactionID = `upload-${artifactId}`;
      try { await session.query("begin"); const response = await endpoint.handler(requestFor(transactionID, session, artifactId)); await session.query("commit"); return response; }
      catch (error) { await session.query("rollback"); throw error; } finally { session.release(); }
    };
    const invoke = async (artifactId) => await invokeWith(upload, artifactId);
    assert.equal((await invoke("upload-admitted")).status, 201);
    assert.equal(Number((await pool.query("select count(*) count from sales_import_uploads where artifact_id='upload-admitted'")).rows[0].count), 1);

    const processIdentity = (generationId, sourceCommit, applicationDigest) => createFixtureStaticProcessIdentityProvider(
      { applicationId: "customer-gate-1", environment: "production" },
      { K_NEX_GENERATION: generationId, K_NEX_SOURCE_COMMIT: sourceCommit, K_NEX_APPLICATION_DIGEST: applicationDigest }
    );
    const processAuthorityGen1 = createFixtureCurrentAuthority(scopedSalesRegistration(), processIdentity("sales-generation-1", "a".repeat(40), `sha256:${"c".repeat(64)}`));
    const uploadProcessGen1 = createSalesDataMovementEndpoints(processAuthorityGen1).find(({ path }) => path === "/k-nex/sales/import-upload");
    assert.equal((await invokeWith(uploadProcessGen1, "upload-process-gen1")).status, 201, "The public generation 1 authority must admit while its generation is current.");

    await pool.query("update sales_current_authority_scopes set mutation_allowed=false,revision=12 where principal_id='upload-user'");
    assert.equal((await invoke("upload-mutation-revoked")).status, 403);
    await pool.query("update sales_current_authority_scopes set mutation_allowed=true,revision=11 where principal_id='upload-user'");
    await pool.query("insert into k_nex_permission_catalog_snapshots values ('customer-gate-1','sales-disabled','administrative-non-authoritative','{}'::jsonb,'inactive-extension-disabled','extension','platform-plugin','module.sales',41)");
    assert.equal((await invoke("upload-disabled")).status, 403);
    await pool.query("delete from k_nex_permission_catalog_snapshots where snapshot_id='sales-disabled'");
    await pool.query("update k_nex_authorization_state set authorization_revision=8 where application_id='customer-gate-1'");
    assert.equal((await invoke("upload-stale-authorization")).status, 403);
    await pool.query("update k_nex_authorization_state set authorization_revision=7 where application_id='customer-gate-1'");

    const blocked = await pool.connect(); const contender = await pool.connect();
    try {
      await blocked.query("begin"); await blocked.query("update k_nex_authorization_state set authorization_revision=8 where application_id='customer-gate-1'");
      await contender.query("begin"); const raced = upload.handler(requestFor("upload-race", contender, "upload-raced-authority"));
      await new Promise((resolve) => setTimeout(resolve, 25)); await blocked.query("commit");
      assert.equal((await raced).status, 403); await contender.query("commit");
    } finally { await blocked.query("rollback").catch(() => undefined); await contender.query("rollback").catch(() => undefined); blocked.release(); contender.release(); }

    await pool.query("update k_nex_authorization_state set authorization_revision=7 where application_id='customer-gate-1'");
    await pool.query("begin; update k_nex_extension_authorization_generations set state='retired' where application_id='customer-gate-1' and authorization_generation=41; insert into k_nex_extension_authorization_generations values ('customer-gate-1','platform-plugin','module.sales',42,'[\"sales-generation-2\"]'::jsonb,'current',7,3); update k_nex_role_permission_grants set owner_generation=42 where application_id='customer-gate-1' and permission_id='sales.imports.execute'; update runtime_extensions set active_generation_id='sales-generation-2',active_generation='{\"authority\":\"static-build\",\"generationId\":\"sales-generation-2\",\"sourceCommit\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"applicationDigest\":\"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\"}'::jsonb where application_id='customer-gate-1' and environment='production' and delivery_class='platform-plugin' and extension_id='module.sales'; commit");
    const oldProcessSession = await pool.connect(); const oldProcessRequest = requestFor("upload-old-process-resolve", oldProcessSession, "upload-promoted-away-gen1");
    try { await assert.rejects(() => processAuthorityGen1.resolveDurableSalesAuthority(oldProcessRequest, "upload-old-process-resolve"), /Static Sales authorization generation is unavailable/u); }
    finally { oldProcessSession.release(); }
    const oldProcessUpload = await invokeWith(uploadProcessGen1, "upload-promoted-away-gen1");
    assert.equal(oldProcessUpload.status, 403, "The generation 1 process must not upload after the DB promotion.");
    const processAuthorityGen2 = createFixtureCurrentAuthority(scopedSalesRegistration(), processIdentity("sales-generation-2", "b".repeat(40), `sha256:${"d".repeat(64)}`));
    const uploadProcessGen2 = createSalesDataMovementEndpoints(processAuthorityGen2).find(({ path }) => path === "/k-nex/sales/import-upload");
    assert.equal((await invokeWith(uploadProcessGen2, "upload-promoted-gen2")).status, 201, "The public generation 2 authority must admit after promotion.");
    assert.equal(Number((await pool.query("select count(*) count from sales_import_uploads where artifact_id not in ('upload-admitted','upload-process-gen1','upload-promoted-gen2')")).rows[0].count), 0);
  } finally { await pool.end(); await container.stop(); }
});

test("P13.5 worker restarts exactly once, emits a partial artifact, fences revocation, purges payloads, and publishes snapshot-only CSV", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("p13_5_data").withStartupTimeout(120_000).start(); const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`create table payload_locked_documents_rels(id bigserial primary key);
      create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer);
      create table runtime_worker_generation_fences(application_id text,environment text,active_execution_generation text,fencing_token bigint,lease_owner text,lease_expires_at timestamptz,promotion_revision integer,primary key(application_id,environment));
      create table sales_current_authority_scopes(application_id text,environment text,principal_id text,record_scope text,application_wide boolean,mutation_allowed boolean,authorized_team_ids jsonb,state text,revision integer);
      create table sales_accounts(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',status text default 'active',name text,merged_into_id text,merge_lineage jsonb,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_contacts(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',status text default 'active',account_id integer,display_name text,email text,phone text,merged_into_id text,merge_lineage jsonb,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_leads(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]',status text default 'new',archive_status text default 'active',display_name text,source text,email text,phone text,qualified_account_id text,qualified_contact_id text,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_opportunities(id serial primary key,application_id text,environment text,account_id text,primary_contact_id text);
      create table sales_activities(id serial primary key,application_id text,environment text,related_record_type text,related_record_id text);
      create table sales_notes(id serial primary key,application_id text,environment text,related_record_type text,related_record_id text);
      create table sales_attachment_references(id serial primary key,application_id text,environment text,related_record_type text,related_record_id text);
      create table sales_tasks(id serial primary key,application_id text,environment text,related_record_type text,related_record_id text);
      create table k_nex_outbox(id bigserial primary key,event_id text unique,event_type text,schema_version integer,message_class text,occurred_at timestamptz,application_id text,plugin_id text,actor_id text,actor_type text,correlation_id text,idempotency_key text,payload jsonb,retention_until timestamptz);`);
    await up({ db: drizzle(pool) }); const { FixtureSalesDataMovementStore, processSalesDataMovement } = await import("../dist/src/data-movement-host.js");
    await pool.query("insert into k_nex_authorization_state(application_id,authorization_revision,lifecycle_revision) values ('customer-gate-1',1,0)");
    await pool.query("insert into runtime_worker_generation_fences values ('customer-gate-1','production','sales-generation-1',1,'sales-worker',now()+interval '1 hour',1)");
    await pool.query("insert into sales_current_authority_scopes(application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ('customer-gate-1','production','worker-user','owned-or-assigned-team',false,true,'[\"team:worker-user\"]'::jsonb,'active',1)");
    const uploadBytes = Buffer.from("Name,Source\r\nOne,Web\r\nTwo,Event\r\nBad,\r\n"); const uploadDigest = digest(uploadBytes); const mapping = [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }]; const mappingDigest = canonicalDigest(mapping);
    await pool.query("insert into sales_import_uploads(artifact_id,application_id,environment,actor_id,bytes,digest,byte_length,expires_at) values ('worker-upload','customer-gate-1','production','worker-user',$1,$2,$3,now()+interval '30 days')", [uploadBytes, uploadDigest, uploadBytes.length]);
    const job = (await pool.query(`insert into sales_import_jobs(application_id,environment,actor_id,target_object_type,upload_artifact_id,upload_digest,mapping_canonical_json,mapping_digest,schema_revision,authorization_revision,lifecycle_revision,scope_revision,permission_grants,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.lead','worker-upload',$1,$2::jsonb,$3,1,1,0,1,'["sales.imports.execute","sales.leads.write"]'::jsonb,'queued',3,3,'import-worker',now()+interval '30 days') returning id`, [uploadDigest, JSON.stringify(mapping), mappingDigest])).rows[0].id;
    const inputRows = [];
    for (const [number, value] of [[1, { displayName: "One", source: "Web" }], [2, { displayName: "Two", source: "Event" }], [3, { displayName: "Bad", source: null }]]) { const rowDigest = canonicalDigest({ targetObjectType: "sales.object.lead", values: value, oneBasedDataRow: number }); const mappedDigest = canonicalDigest(value); inputRows.push({ one_based_data_row: number, row_digest: rowDigest, mapped_digest: mappedDigest }); await pool.query("insert into sales_import_rows(import_job_id,one_based_data_row,row_digest,canonical_mapped_json,mapped_digest) values ($1,$2,$3,$4::jsonb,$5)", [job, number, rowDigest, JSON.stringify(value), mappedDigest]); }
    await pool.query("insert into sales_import_chunks(import_job_id,chunk_index,row_start,row_end_exclusive,input_digest) values ($1,0,0,3,$2)", [job, canonicalDigest(inputRows)]);
    const fence1 = { activeExecutionGeneration: "sales-generation-1", fencingToken: 1, leaseOwner: "sales-worker", promotionRevision: 1 };
    await assert.rejects(() => processSalesDataMovement(pool, fence1, { afterRowCommit(row) { if (row === 1) throw new Error("crash-after-row"); } }), /crash-after-row/u);
    assert.equal(Number((await pool.query("select count(*) count from sales_leads where owner_id='worker-user'")).rows[0].count), 1);
    await pool.query("update sales_import_chunks set lease_expires_at=now()-interval '1 second' where import_job_id=$1", [job]);
    await pool.query("update runtime_worker_generation_fences set fencing_token=2,promotion_revision=2 where application_id='customer-gate-1'"); const fence2 = { ...fence1, fencingToken: 2, promotionRevision: 2 };
    assert.equal(await processSalesDataMovement(pool, fence1), "idle");
    assert.equal(Number((await pool.query("select count(*) count from sales_leads where owner_id='worker-user'")).rows[0].count), 1);
    assert.equal(await processSalesDataMovement(pool, fence2), "import"); assert.equal(await processSalesDataMovement(pool, fence2), "idle");
    assert.deepEqual((await pool.query("select state,accepted_rows,rejected_rows from sales_import_jobs where id=$1", [job])).rows, [{ state: "partially-failed", accepted_rows: 2, rejected_rows: 1 }]);
    assert.equal(Number((await pool.query("select count(*) count from sales_leads where owner_id='worker-user'")).rows[0].count), 2);
    assert.match((await pool.query("select convert_from(bytes,'UTF8') csv from sales_import_diagnostic_artifacts where import_job_id=$1", [job])).rows[0].csv, /IMPORT_REQUIRED_VALUE/u);
    assert.equal(Number((await pool.query("select count(*) count from sales_data_movement_audit where resource_id=$1", [String(job)])).rows[0].count), 2);
    assert.deepEqual((await pool.query("select event_type,message_class,payload->>'environment' environment,payload->>'state' state from k_nex_outbox where payload->>'jobId'=$1 order by id", [String(job)])).rows, [
      { event_type: "sales.event.import-job-changed", message_class: "durable-integration", environment: "production", state: "running" },
      { event_type: "sales.event.import-job-changed", message_class: "durable-integration", environment: "production", state: "partially-failed" }
    ]);
    assert.equal(Number((await pool.query("select count(*) count from k_nex_outbox where event_type='sales.event.lead-changed' and payload->>'environment'='production' and payload ? 'resourceId'")).rows[0].count), 2);
    const importReceipt = (await pool.query("select receipt_id,evidence,digest from sales_import_receipts where job_id=$1", [job])).rows[0];
    assert.equal(importReceipt.receipt_id, "import-worker"); assert.equal(importReceipt.digest, canonicalDigest(importReceipt.evidence));
    assert.deepEqual(Object.keys(importReceipt.evidence).sort(), ["acceptedRows", "actionId", "actionVersion", "actorId", "applicationId", "authorizationRevision", "chunkResultDigests", "diagnosticArtifactDigest", "diagnosticArtifactId", "diagnosticDigest", "environment", "failureCode", "jobId", "lifecycleRevision", "mappingDigest", "rejectedRows", "revision", "rowCount", "schemaRevision", "scopeRevision", "state", "targetObjectType", "uploadDigest"].sort());
    assert.deepEqual(importReceipt.evidence.chunkResultDigests.length, 1); assert.match(importReceipt.evidence.chunkResultDigests[0], /^sha256:[0-9a-f]{64}$/u); assert.equal(importReceipt.evidence.schemaRevision, 1);
    assert.equal(await processSalesDataMovement(pool, fence2), "idle"); assert.deepEqual((await pool.query("select receipt_id,evidence,digest from sales_import_receipts where job_id=$1", [job])).rows[0], importReceipt);

    const account = (await pool.query("insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name) values ('customer-gate-1','production','worker-user','team:worker-user','worker-user','worker-user','=unsafe') returning id,revision")).rows[0];
    const row = { name: "=unsafe", revision: account.revision }; const rowDigest = canonicalDigest(row); const snapshotDigest = canonicalDigest([{ recordId: account.id, recordRevision: account.revision, authorizedRedactedRowDigest: rowDigest }]);
    const exportJob = (await pool.query(`insert into sales_export_jobs(application_id,environment,actor_id,target_object_type,source_id,source_version,source_schema_version,source_hash,query_canonical_json,query_digest,selected_fields,authorization_revision,lifecycle_revision,scope_revision,permission_grants,snapshot_revision,snapshot_digest,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.account','sales.accounts',1,1,$1,'{}'::jsonb,$2,'["name","revision"]'::jsonb,1,0,1,'["sales.exports.execute","sales.accounts.read"]'::jsonb,1,$3,'queued',1,1,'export-worker',now()+interval '30 days') returning id`, ["sha256:9610899be1f882239297a5aea011ac2860e5dd7b57afe821bc8e08257aeffe11", canonicalDigest({}), snapshotDigest])).rows[0].id;
    await pool.query("insert into sales_export_snapshot_rows(export_job_id,ordinal,record_id,record_revision,row_json,row_digest) values ($1,0,$2,$3,$4::jsonb,$5)", [exportJob, account.id, account.revision, JSON.stringify(row), rowDigest]);
    assert.equal(await processSalesDataMovement(pool, fence2), "export"); const artifact = (await pool.query("select convert_from(bytes,'UTF8') csv from sales_export_artifacts where export_job_id=$1", [exportJob])).rows[0].csv; assert.equal(artifact, "name,revision\r\n'=unsafe,1\r\n");
    assert.deepEqual((await pool.query("select evidence->>'state' state from sales_export_receipts where job_id=$1", [exportJob])).rows, [{ state: "succeeded" }]);
    const coordinatedRow = { name: "coordinated", revision: account.revision }; const coordinatedBytes = Buffer.from("name,revision\r\ncoordinated,1\r\n");
    await assert.rejects(() => pool.query("update sales_export_snapshot_rows set row_json=$2::jsonb,row_digest=$3 where export_job_id=$1", [exportJob, JSON.stringify(coordinatedRow), canonicalDigest(coordinatedRow)]), (error) => error?.code === "55000");
    await assert.rejects(() => pool.query("update sales_export_artifacts set bytes=$2,digest=$3,byte_length=$4 where export_job_id=$1", [exportJob, coordinatedBytes, digest(coordinatedBytes), coordinatedBytes.length]), (error) => error?.code === "55000");
    await assert.rejects(() => pool.query("delete from sales_export_artifacts where export_job_id=$1", [exportJob]), (error) => error?.code === "55000");
    const tamperedExport = (await pool.query(`insert into sales_export_jobs(application_id,environment,actor_id,target_object_type,source_id,source_version,source_schema_version,source_hash,query_canonical_json,query_digest,selected_fields,authorization_revision,lifecycle_revision,scope_revision,permission_grants,snapshot_revision,snapshot_digest,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.account','sales.accounts',1,1,$1,'{}'::jsonb,$2,'["name","revision"]'::jsonb,1,0,1,'["sales.exports.execute","sales.accounts.read"]'::jsonb,1,$3,'queued',1,1,'export-tampered',now()+interval '30 days') returning id`, ["sha256:9610899be1f882239297a5aea011ac2860e5dd7b57afe821bc8e08257aeffe11", canonicalDigest({}), snapshotDigest])).rows[0].id;
    await pool.query("insert into sales_export_snapshot_rows(export_job_id,ordinal,record_id,record_revision,row_json,row_digest) values ($1,0,$2,$3,$4::jsonb,$5)", [tamperedExport, account.id, account.revision, JSON.stringify({ name: "mutated", revision: account.revision }), rowDigest]);
    assert.equal(await processSalesDataMovement(pool, fence2), "export");
    assert.deepEqual((await pool.query("select state,artifact_id from sales_export_jobs where id=$1", [tamperedExport])).rows, [{ state: "failed", artifact_id: null }]);
    const lifecycleExport = (await pool.query(`insert into sales_export_jobs(application_id,environment,actor_id,target_object_type,source_id,source_version,source_schema_version,source_hash,query_canonical_json,query_digest,selected_fields,authorization_revision,lifecycle_revision,scope_revision,permission_grants,snapshot_revision,snapshot_digest,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.account','sales.accounts',1,1,$1,'{}'::jsonb,$2,'["name","revision"]'::jsonb,1,0,1,'["sales.exports.execute","sales.accounts.read"]'::jsonb,1,$3,'queued',1,1,'export-lifecycle',now()+interval '30 days') returning id`, ["sha256:9610899be1f882239297a5aea011ac2860e5dd7b57afe821bc8e08257aeffe11", canonicalDigest({}), snapshotDigest])).rows[0].id;
    await pool.query("insert into sales_export_snapshot_rows(export_job_id,ordinal,record_id,record_revision,row_json,row_digest) values ($1,0,$2,$3,$4::jsonb,$5)", [lifecycleExport, account.id, account.revision, JSON.stringify(row), rowDigest]);
    await pool.query("update k_nex_authorization_state set lifecycle_revision=1 where application_id='customer-gate-1'");
    assert.equal(await processSalesDataMovement(pool, fence2), "export");
    assert.deepEqual((await pool.query("select state,artifact_id from sales_export_jobs where id=$1", [lifecycleExport])).rows, [{ state: "failed", artifact_id: null }]);
    assert.deepEqual((await pool.query("select evidence->>'reason' reason from sales_export_receipts where job_id=$1", [lifecycleExport])).rows, [{ reason: "ACTION_FORBIDDEN" }]);
    await pool.query("update k_nex_authorization_state set lifecycle_revision=0 where application_id='customer-gate-1'");

    const revokedValue = { displayName: "Denied", source: "Web" }; const revokedRowDigest = canonicalDigest({ targetObjectType: "sales.object.lead", values: revokedValue, oneBasedDataRow: 1 }); const revokedMappedDigest = canonicalDigest(revokedValue);
    const revokedJob = (await pool.query(`insert into sales_import_jobs(application_id,environment,actor_id,target_object_type,upload_artifact_id,upload_digest,mapping_canonical_json,mapping_digest,schema_revision,authorization_revision,lifecycle_revision,scope_revision,permission_grants,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.lead','worker-upload',$1,$2::jsonb,$3,1,1,0,1,'["sales.imports.execute","sales.leads.write"]'::jsonb,'queued',3,1,'import-revoked',now()+interval '30 days') returning id`, [uploadDigest, JSON.stringify(mapping), mappingDigest])).rows[0].id;
    await pool.query("insert into sales_import_rows(import_job_id,one_based_data_row,row_digest,canonical_mapped_json,mapped_digest) values ($1,1,$2,$3::jsonb,$4)", [revokedJob, revokedRowDigest, JSON.stringify(revokedValue), revokedMappedDigest]);
    await pool.query("insert into sales_import_chunks(import_job_id,chunk_index,row_start,row_end_exclusive,input_digest) values ($1,0,0,1,$2)", [revokedJob, canonicalDigest([{ one_based_data_row: 1, row_digest: revokedRowDigest, mapped_digest: revokedMappedDigest }])]);
    await pool.query("update sales_current_authority_scopes set state='revoked' where principal_id='worker-user'");
    assert.equal(await processSalesDataMovement(pool, fence2), "import");
    assert.deepEqual((await pool.query("select state,accepted_rows,rejected_rows from sales_import_jobs where id=$1", [revokedJob])).rows, [{ state: "failed", accepted_rows: 0, rejected_rows: 1 }]);
    assert.deepEqual((await pool.query("select state from sales_import_chunks where import_job_id=$1", [revokedJob])).rows, [{ state: "failed" }]);
    assert.deepEqual((await pool.query("select evidence->>'failureCode' code from sales_import_receipts where job_id=$1", [revokedJob])).rows, [{ code: "ACTION_FORBIDDEN" }]);

    await pool.query("update sales_current_authority_scopes set state='active' where principal_id='worker-user'");
    const tamperedJob = (await pool.query(`insert into sales_import_jobs(application_id,environment,actor_id,target_object_type,upload_artifact_id,upload_digest,mapping_canonical_json,mapping_digest,schema_revision,authorization_revision,lifecycle_revision,scope_revision,permission_grants,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.lead','worker-upload',$1,$2::jsonb,$3,1,1,0,1,'["sales.imports.execute","sales.leads.write"]'::jsonb,'queued',3,1,'import-tampered',now()+interval '30 days') returning id`, [uploadDigest, JSON.stringify(mapping), mappingDigest])).rows[0].id;
    await pool.query("insert into sales_import_rows(import_job_id,one_based_data_row,row_digest,canonical_mapped_json,mapped_digest) values ($1,1,$2,$3::jsonb,$4)", [tamperedJob, revokedRowDigest, JSON.stringify(revokedValue), revokedMappedDigest]);
    await pool.query("insert into sales_import_chunks(import_job_id,chunk_index,row_start,row_end_exclusive,input_digest) values ($1,0,0,1,$2)", [tamperedJob, canonicalDigest([{ one_based_data_row: 1, row_digest: revokedRowDigest, mapped_digest: revokedMappedDigest }])]);
    await pool.query("update sales_import_jobs set mapping_canonical_json='[]'::jsonb where id=$1", [tamperedJob]);
    assert.equal(await processSalesDataMovement(pool, fence2), "import");
    assert.deepEqual((await pool.query("select state,accepted_rows,rejected_rows from sales_import_jobs where id=$1", [tamperedJob])).rows, [{ state: "failed", accepted_rows: 0, rejected_rows: 1 }]);
    assert.equal(Number((await pool.query("select count(*) count from sales_leads where display_name='Denied'")).rows[0].count), 0);
    const effectCounts = async () => ({ targets: Number((await pool.query("select count(*) count from sales_leads")).rows[0].count), audits: Number((await pool.query("select count(*) count from sales_data_movement_audit")).rows[0].count), events: Number((await pool.query("select count(*) count from k_nex_outbox")).rows[0].count), receipts: Number((await pool.query("select count(*) count from sales_import_receipts")).rows[0].count) });
    for (const [suffix, invalidValue] of [["extra", { displayName: "No effect", source: "Web", ownerId: "attacker" }], ["type", { displayName: "No effect", source: 7 }], ["length", { displayName: "x".repeat(121), source: "Web" }]]) {
      const invalidMappedDigest = canonicalDigest(invalidValue); const invalidRowDigest = canonicalDigest({ targetObjectType: "sales.object.lead", values: invalidValue, oneBasedDataRow: 1 });
      const invalidJob = (await pool.query(`insert into sales_import_jobs(application_id,environment,actor_id,target_object_type,upload_artifact_id,upload_digest,mapping_canonical_json,mapping_digest,schema_revision,authorization_revision,lifecycle_revision,scope_revision,permission_grants,state,revision,row_count,receipt_id,expires_at) values ('customer-gate-1','production','worker-user','sales.object.lead','worker-upload',$1,$2::jsonb,$3,1,1,0,1,'["sales.imports.execute","sales.leads.write"]'::jsonb,'queued',3,1,$4,now()+interval '30 days') returning id`, [uploadDigest, JSON.stringify(mapping), mappingDigest, `import-invalid-${suffix}`])).rows[0].id;
      await pool.query("insert into sales_import_rows(import_job_id,one_based_data_row,row_digest,canonical_mapped_json,mapped_digest) values ($1,1,$2,$3::jsonb,$4)", [invalidJob, invalidRowDigest, JSON.stringify(invalidValue), invalidMappedDigest]);
      await pool.query("insert into sales_import_chunks(import_job_id,chunk_index,row_start,row_end_exclusive,input_digest) values ($1,0,0,1,$2)", [invalidJob, canonicalDigest([{ one_based_data_row: 1, row_digest: invalidRowDigest, mapped_digest: invalidMappedDigest }])]);
      const before = await effectCounts(); await assert.rejects(() => processSalesDataMovement(pool, fence2), /durable row schema/u); assert.deepEqual(await effectCounts(), before);
      await pool.query("update sales_import_rows set outcome='rejected',canonical_mapped_json=null,diagnostic_code='IMPORT_VALUE_INVALID' where import_job_id=$1", [invalidJob]);
      await pool.query("update sales_import_chunks set state='failed' where import_job_id=$1", [invalidJob]); await pool.query("update sales_import_jobs set state='failed',revision=revision+1,rejected_rows=1 where id=$1", [invalidJob]);
    }
    const session = await pool.connect();
    try {
      const transactionId = "p13-5-direct"; const request = { transactionID: transactionId, payload: { db: { sessions: { [transactionId]: { db: drizzle(session) } } } } };
      const durable = Object.freeze({ context: Object.freeze({ applicationId: "customer-gate-1", environment: "production", actorId: "worker-user", ownerId: "worker-user", teamId: "team:worker-user", permissionFingerprint: "p13-5" }), recordScope: "owned-or-assigned-team", applicationWide: false, mutationAllowed: true, authorizedTeamIds: Object.freeze(["team:worker-user"]), scopeRevision: 1, authorizationRevision: 1, lifecycleRevision: 0, permissionGrants: Object.freeze(["sales.imports.execute", "sales.leads.write", "sales.records.merge", "sales.accounts.read", "sales.exports.execute"]) });
      const store = new FixtureSalesDataMovementStore(request, durable);
      await session.query("begin");
      const protectedBytes = Buffer.from("Name,Source,Email\r\nDenied,Web,denied@example.test\r\n"); const protectedDigest = digest(protectedBytes);
      await session.query("insert into sales_import_uploads(artifact_id,application_id,environment,actor_id,bytes,digest,byte_length,expires_at) values ('protected-upload','customer-gate-1','production','worker-user',$1,$2,$3,now()+interval '30 days')", [protectedBytes, protectedDigest, protectedBytes.length]);
      const executeOnly = new FixtureSalesDataMovementStore(request, { ...durable, permissionGrants: ["sales.imports.execute"] });
      await assert.rejects(() => executeOnly.dryRunImport({ input: { request: { uploadArtifactId: "protected-upload", targetObjectType: "sales.object.lead", columnMapping: [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }], expectedAuthorizationRevision: 1 } } }), (error) => error?.code === "ACTION_FORBIDDEN");
      await assert.rejects(() => store.dryRunImport({ input: { request: { uploadArtifactId: "protected-upload", targetObjectType: "sales.object.lead", columnMapping: [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }, { header: "Email", fieldId: "email" }], expectedAuthorizationRevision: 1 } } }), (error) => error?.code === "ACTION_FORBIDDEN");
      assert.equal(Number((await session.query("select count(*) count from sales_import_jobs where upload_artifact_id='protected-upload'")).rows[0].count), 0);

      await session.query("savepoint export_snapshot_race");
      const lockedExport = await store.createExport({ input: { request: { targetObjectType: "sales.object.account", sourceId: "sales.accounts", sourceVersion: 1, sourceSchemaVersion: 1, selectedFields: ["name", "revision"], expectedAuthorizationRevision: 1 } } });
      let concurrentUpdateSettled = false; const concurrentUpdate = pool.query("update sales_accounts set name='raced',revision=revision+1 where id=$1", [account.id]).then(() => { concurrentUpdateSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(concurrentUpdateSettled, false, "Export snapshot row lock must block a concurrent source update.");
      await session.query("rollback to savepoint export_snapshot_race"); await concurrentUpdate;
      assert.equal(Number((await session.query("select count(*) count from sales_export_jobs where id=$1", [lockedExport.exportJobId])).rows[0].count), 0, "Rolling back the locked snapshot transaction must publish no export job.");

      const winner = (await session.query("insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name) values ('customer-gate-1','production','worker-user','team:worker-user','worker-user','worker-user',' Same Name ') returning id,revision,name")).rows[0];
      await session.query("insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name) select 'customer-gate-1','production','worker-user','team:worker-user','worker-user','worker-user','same name' from generate_series(1,101)");
      const loser = (await session.query("insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name) values ('customer-gate-1','production','worker-user','team:worker-user','worker-user','worker-user','same name') returning id,revision")).rows[0];
      await session.query("insert into sales_contacts(application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name) values ('customer-gate-1','production','worker-user','team:worker-user','worker-user','worker-user',$1,'Relation')", [loser.id]);
      await session.query("insert into sales_opportunities(application_id,environment,account_id) values ('customer-gate-1','production',$1)", [String(loser.id)]);
      await session.query("insert into sales_leads(application_id,environment,qualified_account_id) values ('customer-gate-1','production',$1)", [String(loser.id)]);
      for (const table of ["sales_activities", "sales_notes", "sales_attachment_references", "sales_tasks"]) await session.query(`insert into ${table}(application_id,environment,related_record_type,related_record_id) values ('customer-gate-1','production','sales.account',$1)`, [String(loser.id)]);
      const candidates = await store.findDedupeCandidates({ input: { "target-object-type": "sales.object.account", id: winner.id, "expected-revision": winner.revision }, query: { cursor: { size: 100 } }, selectedFields: ["candidate-id", "candidate-revision", "match-kind"] });
      assert.equal(candidates.rows.length, 100); assert.equal(candidates.page.hasNext, true);
      const candidateTail = await store.findDedupeCandidates({ input: { "target-object-type": "sales.object.account", id: winner.id, "expected-revision": winner.revision }, query: { cursor: { size: 100, after: candidates.page.nextCursor } }, selectedFields: ["candidate-id", "candidate-revision", "match-kind"] });
      assert.equal(candidateTail.rows.some((entry) => entry.values["candidate-id"].value === loser.id), true);
      const mergeInput = { targetObjectType: "sales.object.account", winnerId: winner.id, winnerExpectedRevision: winner.revision, loserId: loser.id, loserExpectedRevision: loser.revision, expectedAuthorizationRevision: 1 };
      await assert.rejects(() => store.mergeRecords({ input: { ...mergeInput, winnerExpectedRevision: winner.revision + 1 } }), (error) => error?.code === "STALE_RECORD");
      const merged = await store.mergeRecords({ input: mergeInput });
      assert.match(merged.lineageDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(merged.rewrittenRelationCounts.length, 7);
      assert.equal(merged.rewrittenRelationCounts.every(({ count }) => count === 1), true);
      assert.deepEqual((await session.query("select name,revision from sales_accounts where id=$1", [winner.id])).rows, [{ name: winner.name, revision: winner.revision + 1 }]);
      assert.deepEqual((await session.query("select status,merged_into_id,revision from sales_accounts where id=$1", [loser.id])).rows, [{ status: "merged", merged_into_id: String(winner.id), revision: loser.revision + 1 }]);
      assert.equal(Number((await session.query("select count(*) count from sales_merge_lineage where winner_id=$1 and loser_id=$2", [winner.id, loser.id])).rows[0].count), 1);
      assert.deepEqual((await session.query("select message_class,payload->>'environment' environment,(payload->>'winnerId')::integer winner_id,payload->>'lineageId' lineage_id from k_nex_outbox where idempotency_key=$1", [`${merged.lineageId}-survivor`])).rows, [{ message_class: "durable-integration", environment: "production", winner_id: winner.id, lineage_id: merged.lineageId }]);
      assert.equal(Number((await session.query("select count(*) count from k_nex_outbox where idempotency_key=$1", [`${merged.lineageId}-merged`])).rows[0].count), 0);
      await session.query("commit");

      await session.query("begin");
      await assert.rejects(() => store.mergeRecords({ input: mergeInput }), (error) => error?.code === "ACTION_FORBIDDEN" || error?.code === "STALE_RECORD");
      assert.equal(Number((await session.query("select count(*) count from sales_merge_lineage where winner_id=$1 and loser_id=$2", [winner.id, loser.id])).rows[0].count), 1);
      await session.query("rollback");
      assert.equal((await pool.query("select account_id from sales_contacts where display_name='Relation'")).rows[0].account_id, winner.id);
      assert.equal((await pool.query("select account_id from sales_opportunities where account_id=$1", [String(winner.id)])).rowCount, 1);
      assert.equal((await pool.query("select qualified_account_id from sales_leads where qualified_account_id=$1", [String(winner.id)])).rowCount, 1);
      for (const table of ["sales_activities", "sales_notes", "sales_attachment_references", "sales_tasks"]) assert.equal((await pool.query(`select related_record_id from ${table} where related_record_type='sales.account' and related_record_id=$1`, [String(winner.id)])).rowCount, 1);
    } finally { session.release(); }

    await pool.query("update sales_import_jobs set state='cancelled',revision=revision+1 where id=$1 and state='queued'", [revokedJob]);
    await pool.query("update sales_import_chunks set state='failed' where import_job_id=$1", [revokedJob]);
    await pool.query("update sales_import_jobs set created_at=created_at-interval '31 days',expires_at=expires_at-interval '31 days' where id=$1", [job]);
    await pool.query("update sales_export_jobs set created_at=created_at-interval '31 days',expires_at=expires_at-interval '31 days' where id=$1", [lifecycleExport]);
    await pool.query("update sales_import_diagnostic_artifacts set created_at=created_at-interval '31 days',expires_at=expires_at-interval '31 days' where import_job_id=$1", [job]);
    const expiredBytes = Buffer.from("expired\r\n"); await pool.query("insert into sales_export_artifacts(artifact_id,export_job_id,bytes,digest,byte_length,created_at,expires_at) values ('expired-artifact',$1,$2,$3,$4,now()-interval '31 days',now()-interval '1 day')", [lifecycleExport, expiredBytes, digest(expiredBytes), expiredBytes.length]);
    assert.equal(await processSalesDataMovement(pool, fence2), "idle");
    assert.equal((await pool.query("select bytes from sales_import_diagnostic_artifacts where import_job_id=$1", [job])).rows[0].bytes, null);
    assert.equal((await pool.query("select bytes from sales_export_artifacts where artifact_id='expired-artifact'")).rows[0].bytes, null);
    assert.equal((await pool.query("select row_json from sales_export_snapshot_rows where export_job_id=$1", [lifecycleExport])).rows[0].row_json, null);
    assert.notEqual((await pool.query("select bytes from sales_export_artifacts where export_job_id=$1", [exportJob])).rows[0].bytes, null);
    assert.deepEqual((await pool.query("select code,public_message from sales_import_diagnostics where job_id=$1 order by one_based_data_row", [job])).rows, [{ code: "IMPORT_REQUIRED_VALUE", public_message: null }]);
  } finally { await pool.end(); await container.stop(); }
});
