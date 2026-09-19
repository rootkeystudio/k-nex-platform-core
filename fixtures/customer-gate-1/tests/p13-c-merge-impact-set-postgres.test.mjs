import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  assertSalesMergeRelationCapability,
  createSalesMergeRelationAuditTransition,
  issueSalesMergeRelationCapability,
  salesMergeImpactLimit,
  salesMergeRelationDescriptors
} from "@k-nex/module-sales-current/server";
import pg from "pg";

import { drizzle } from "../../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.js";
import { up } from "../dist/src/migrations/20260907_000031_data_movement.js";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const applicationId = "customer-gate-1";
const environment = "production";
const actorId = "merge-user";

const durable = Object.freeze({
  context: Object.freeze({ applicationId, environment, actorId }),
  recordScope: "owned-or-assigned-team",
  applicationWide: false,
  mutationAllowed: true,
  authorizedTeamIds: Object.freeze([`team:${actorId}`]),
  scopeRevision: 1,
  authorizationRevision: 1,
  lifecycleRevision: 0,
  fieldGrants: Object.freeze([]),
  permissionGrants: Object.freeze(["sales.records.merge", "sales.accounts.read"])
});

const capabilityInput = Object.freeze({ lineageId: "merge-capability-proof", applicationId, environment, targetObjectType: "sales.object.account", winnerId: 1, loserId: 2, actorId, authorizationRevision: 1, issuedAt: "2026-09-19T00:00:00.000Z" });
const accountRelation = "sales_contacts.account_id";

async function withMergeDatabase(name, run) {
  const container = await new PostgreSqlContainer(image).withDatabase(name).withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(`create table payload_locked_documents_rels(id bigserial primary key);
      create table k_nex_authorization_state(application_id text primary key,authorization_revision integer,lifecycle_revision integer);
      create table sales_current_authority_scopes(application_id text,environment text,principal_id text,record_scope text,application_wide boolean,mutation_allowed boolean,authorized_team_ids jsonb,state text,revision integer);
      create table sales_accounts(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,status text default 'active',name text,merged_into_id text,merge_lineage jsonb,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_contacts(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,status text default 'active',account_id integer,display_name text,email text,phone text,merged_into_id text,merge_lineage jsonb,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_leads(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,status text default 'new',archive_status text default 'active',display_name text,source text,email text,phone text,qualified_account_id text,qualified_contact_id text,updated_at timestamptz default now(),created_at timestamptz default now());
      create table sales_opportunities(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,updated_at timestamptz default now(),account_id text,primary_contact_id text);
      create table sales_activities(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,updated_at timestamptz default now(),related_record_type text,related_record_id text);
      create table sales_notes(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,updated_at timestamptz default now(),related_record_type text,related_record_id text);
      create table sales_attachment_references(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,updated_at timestamptz default now(),related_record_type text,related_record_id text);
      create table sales_tasks(id serial primary key,application_id text,environment text,owner_id text,team_id text,created_by text,updated_by text,revision integer default 1,audit jsonb default '[]'::jsonb,updated_at timestamptz default now(),related_record_type text,related_record_id text);
      create table k_nex_outbox(id bigserial primary key,event_id text unique,event_type text,schema_version integer,message_class text,occurred_at timestamptz,application_id text,plugin_id text,actor_id text,actor_type text,correlation_id text,idempotency_key text,payload jsonb,retention_until timestamptz);`);
    await up({ db: drizzle(pool) });
    await pool.query("insert into k_nex_authorization_state(application_id,authorization_revision,lifecycle_revision) values ($1,1,0)", [applicationId]);
    await pool.query("insert into sales_current_authority_scopes(application_id,environment,principal_id,record_scope,application_wide,mutation_allowed,authorized_team_ids,state,revision) values ($1,$2,$3,'owned-or-assigned-team',false,true,$4::jsonb,'active',1)", [applicationId, environment, actorId, JSON.stringify([`team:${actorId}`])]);
    const { FixtureSalesDataMovementStore } = await import("../dist/src/data-movement-host.js");
    await run({ pool, FixtureSalesDataMovementStore });
  } finally {
    await pool.end();
    await container.stop();
  }
}

async function seedDuplicatePair(pool, relatedRows = 1) {
  const insertAccount = "insert into sales_accounts(application_id,environment,owner_id,team_id,created_by,updated_by,name) values ($1,$2,$3,$4,$3,$3,'Same name') returning id,revision";
  const winner = (await pool.query(insertAccount, [applicationId, environment, actorId, `team:${actorId}`])).rows[0];
  const loser = (await pool.query(insertAccount, [applicationId, environment, actorId, `team:${actorId}`])).rows[0];
  // Every related record belongs to a different owner and team than the merging
  // actor, which is the ordinary case a merge has to be able to complete.
  await pool.query("insert into sales_contacts(application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name) select $1,$2,'other-user','team:other-user','other-user','other-user',$3,'Related contact' from generate_series(1,$4)", [applicationId, environment, loser.id, relatedRows]);
  await pool.query("insert into sales_opportunities(application_id,environment,owner_id,team_id,created_by,updated_by,account_id) select $1,$2,'other-user','team:other-user','other-user','other-user',$3 from generate_series(1,$4)", [applicationId, environment, String(loser.id), relatedRows]);
  await pool.query("insert into sales_leads(application_id,environment,owner_id,team_id,created_by,updated_by,display_name,source,qualified_account_id) select $1,$2,'other-user','team:other-user','other-user','other-user','Qualified lead','Web',$3 from generate_series(1,$4)", [applicationId, environment, String(loser.id), relatedRows]);
  for (const table of ["sales_activities", "sales_notes", "sales_attachment_references", "sales_tasks"]) {
    await pool.query(`insert into ${table}(application_id,environment,owner_id,team_id,created_by,updated_by,related_record_type,related_record_id) select $1,$2,'other-user','team:other-user','other-user','other-user','sales.account',$3 from generate_series(1,$4)`, [applicationId, environment, String(loser.id), relatedRows]);
  }
  return { winner, loser };
}

function mergeInput(winner, loser) {
  return { targetObjectType: "sales.object.account", winnerId: winner.id, winnerExpectedRevision: winner.revision, loserId: loser.id, loserExpectedRevision: loser.revision, expectedAuthorizationRevision: 1 };
}

async function inSession(pool, FixtureSalesDataMovementStore, transactionID, run) {
  const session = await pool.connect();
  try {
    await session.query("begin");
    const request = { transactionID, payload: { db: { pool, sessions: { [transactionID]: { db: drizzle(session) } } } } };
    const store = new FixtureSalesDataMovementStore(request, durable);
    return await run(store, session);
  } finally {
    session.release();
  }
}

async function effectCounts(pool) {
  const row = (await pool.query(`select
    (select count(*) from sales_merge_lineage) lineage,
    (select count(*) from sales_merge_impacts) impacts,
    (select count(*) from sales_data_movement_audit) audits,
    (select count(*) from k_nex_outbox) events,
    (select coalesce(sum(revision),0) from sales_contacts) contact_revisions,
    (select coalesce(sum(revision),0) from sales_opportunities) opportunity_revisions,
    (select coalesce(sum(revision),0) from sales_tasks) task_revisions,
    (select coalesce(sum(revision),0) from sales_accounts) account_revisions`)).rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

test("P13.C merge capability refuses every binding it was not issued for", async () => {
  const capability = issueSalesMergeRelationCapability(capabilityInput);
  assert.match(capability.capabilityDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual([...capability.relationIds], salesMergeRelationDescriptors.filter(({ targetObjectType }) => targetObjectType === "sales.object.account").map(({ relationId }) => relationId));
  const demand = Object.freeze({ relationId: accountRelation, applicationId, environment, fromRelatedRecordId: "2", toRelatedRecordId: "1" });
  assert.equal(assertSalesMergeRelationCapability(capability, demand).table, "sales_contacts");
  const rejected = [
    ["a relation outside the issued target set", capability, { ...demand, relationId: "sales_opportunities.primary_contact_id" }],
    ["a redirect to a record that is not the accepted winner", capability, { ...demand, toRelatedRecordId: "99" }],
    ["a redirect away from a record that is not the accepted loser", capability, { ...demand, fromRelatedRecordId: "99" }],
    ["another application", capability, { ...demand, applicationId: "other-application" }],
    ["another environment", capability, { ...demand, environment: "staging" }],
    ["a tampered digest", { ...capability, capabilityDigest: `sha256:${"0".repeat(64)}` }, demand],
    ["a widened relation set", { ...capability, relationIds: [...capability.relationIds, "sales_opportunities.primary_contact_id"] }, demand],
    ["a swapped winner", { ...capability, winnerId: 3 }, demand]
  ];
  for (const [reason, tampered, attempt] of rejected) {
    assert.throws(() => assertSalesMergeRelationCapability(tampered, attempt), (error) => error?.code === "ACTION_FORBIDDEN", reason);
  }
  const transition = createSalesMergeRelationAuditTransition({ capability, relationId: accountRelation, resourceId: "44", preRevision: 7, occurredAt: "2026-09-19T00:00:00.000Z", fromRelatedRecordId: "2", toRelatedRecordId: "1" });
  assert.equal(transition.actionId, "sales.merge.relation-rewrite");
  assert.equal(transition.revision, 8);
  assert.equal(transition.idempotencyKey, "merge-capability-proof-relation-contacts-account-44");
  assert.deepEqual(transition.derivedAuthority, { kind: "sales.merge.relation-rewrite", lineageId: capability.lineageId, capabilityDigest: capability.capabilityDigest });
  assert.throws(() => createSalesMergeRelationAuditTransition({ capability, relationId: accountRelation, resourceId: "44", preRevision: 7, occurredAt: "2026-09-19T00:00:00.000Z", fromRelatedRecordId: "2", toRelatedRecordId: "99" }), (error) => error?.code === "ACTION_FORBIDDEN", "an audit transition cannot record a redirect the capability never authorized");
});

test("P13.C merge rollback and replay leave the whole impact set byte-identical", { timeout: 180_000 }, async () => {
  await withMergeDatabase("p13_c_merge_atomicity", async ({ pool, FixtureSalesDataMovementStore }) => {
    const { winner, loser } = await seedDuplicatePair(pool);
    const before = await effectCounts(pool);

    // Rollback: a merge that never commits moves no related record, writes no
    // lineage, no impact ledger row, and no invalidation evidence.
    await inSession(pool, FixtureSalesDataMovementStore, "tx-merge-rollback", async (store, session) => {
      const result = await store.mergeRecords({ input: mergeInput(winner, loser) });
      assert.equal(result.rewrittenRelationCounts.length, 7);
      await session.query("rollback");
    });
    assert.deepEqual(await effectCounts(pool), before, "a rolled back merge leaves zero effects across records, lineage, impacts, audit, and outbox");

    // Crash before the lineage commit: a second duplicate pair whose lineage
    // identity is already taken fails at the lineage boundary, after its
    // relation rewrites are already in the transaction.
    const conflicting = await seedDuplicatePair(pool);
    await pool.query("insert into sales_merge_lineage(lineage_id,application_id,environment,target_object_type,winner_id,winner_pre_revision,winner_post_revision,loser_id,loser_pre_revision,loser_post_revision,match_kind,normalizer_version,actor_id,authorization_revision,winner_pre_digest,winner_post_digest,loser_pre_digest,loser_post_digest,rewritten_relation_counts,relation_capability_digest,impact_count,impact_digest,lineage_digest,committed_at) values ('merge-lineage-squatter',$1,$2,'sales.object.account',$3,1,2,$4,1,2,'account-name','node24.19-unicode17-v1',$5,1,$6,$6,$6,$6,'[]'::jsonb,$6,0,$6,$6,now())", [applicationId, environment, conflicting.winner.id, conflicting.loser.id, actorId, `sha256:${"c".repeat(64)}`]);
    const afterSquatter = await effectCounts(pool);
    await inSession(pool, FixtureSalesDataMovementStore, "tx-merge-lineage-conflict", async (store, session) => {
      await assert.rejects(() => store.mergeRecords({ input: mergeInput(conflicting.winner, conflicting.loser) }), /.*/u, "a lineage identity collision must fail the whole merge");
      await session.query("rollback");
    });
    assert.deepEqual(await effectCounts(pool), afterSquatter, "a failure at the lineage boundary undoes every relation rewrite it already performed");

    const committed = await inSession(pool, FixtureSalesDataMovementStore, "tx-merge-commit", async (store, session) => {
      const result = await store.mergeRecords({ input: mergeInput(winner, loser) });
      await session.query("commit");
      return result;
    });
    const settled = await effectCounts(pool);
    assert.equal(settled.impacts, 7);
    assert.equal(settled.lineage, 2, "the squatter lineage plus this merge");
    assert.equal(settled.events, 9, "one survivor event, one merged-loser event, and one per rewritten collection");

    // Exact replay: the same accepted input is denied and adds nothing.
    await inSession(pool, FixtureSalesDataMovementStore, "tx-merge-replay", async (store, session) => {
      await assert.rejects(() => store.mergeRecords({ input: mergeInput(winner, loser) }), (error) => error?.code === "ACTION_FORBIDDEN" || error?.code === "STALE_RECORD");
      await session.query("rollback");
    });
    assert.deepEqual(await effectCounts(pool), settled, "an exact replay of a committed merge is inert");
    assert.equal(committed.rewrittenRelationCounts.every(({ count }) => count === 1), true);
  });
});

test("P13.C a stale editor of a rewritten related record loses optimistic concurrency", { timeout: 180_000 }, async () => {
  await withMergeDatabase("p13_c_merge_stale_editor", async ({ pool, FixtureSalesDataMovementStore }) => {
    const { winner, loser } = await seedDuplicatePair(pool);
    // An editor opened the Opportunity before the merge and still holds revision 1.
    const staleView = (await pool.query("select id,revision from sales_opportunities limit 1")).rows[0];
    assert.equal(staleView.revision, 1);
    await inSession(pool, FixtureSalesDataMovementStore, "tx-merge-stale-editor", async (store, session) => {
      await store.mergeRecords({ input: mergeInput(winner, loser) });
      await session.query("commit");
    });
    const staleWrite = await pool.query("update sales_opportunities set updated_by='stale-editor',revision=revision+1 where id=$1 and revision=$2", [staleView.id, staleView.revision]);
    assert.equal(staleWrite.rowCount, 0, "the pre-merge revision no longer passes optimistic concurrency");
    const currentWrite = await pool.query("update sales_opportunities set updated_by='current-editor',revision=revision+1 where id=$1 and revision=$2", [staleView.id, staleView.revision + 1]);
    assert.equal(currentWrite.rowCount, 1, "an editor that re-read after the merge still writes");
    const audit = (await pool.query("select audit->-1 transition,account_id from sales_opportunities where id=$1", [staleView.id])).rows[0];
    assert.equal(audit.account_id, String(winner.id));
    assert.equal(audit.transition.actionId, "sales.merge.relation-rewrite");
    assert.equal(audit.transition.actorId, actorId, "history names who moved the relation, not the record's own owner");
  });
});

test("P13.C an impact set larger than its bound is denied before any mutation", { timeout: 180_000 }, async () => {
  await withMergeDatabase("p13_c_merge_impact_bound", async ({ pool, FixtureSalesDataMovementStore }) => {
    const { winner, loser } = await seedDuplicatePair(pool, 1);
    await pool.query("insert into sales_tasks(application_id,environment,owner_id,team_id,created_by,updated_by,related_record_type,related_record_id) select $1,$2,'other-user','team:other-user','other-user','other-user','sales.account',$3 from generate_series(1,$4)", [applicationId, environment, String(loser.id), salesMergeImpactLimit]);
    const before = await effectCounts(pool);
    await inSession(pool, FixtureSalesDataMovementStore, "tx-merge-impact-bound", async (store, session) => {
      await assert.rejects(() => store.mergeRecords({ input: mergeInput(winner, loser) }), (error) => error?.code === "ACTION_FORBIDDEN");
      await session.query("rollback");
    });
    assert.deepEqual(await effectCounts(pool), before, "the bound is enforced while locking, before the first rewrite");
  });
});
