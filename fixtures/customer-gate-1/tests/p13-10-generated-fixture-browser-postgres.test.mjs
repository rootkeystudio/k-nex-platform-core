import assert from "node:assert/strict";
import { cpus, totalmem } from "node:os";
import test from "node:test";

import { chromium } from "playwright";

import { seriousAccessibilityViolations } from "./p13-3-browser-accessibility.mjs";
import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

const applicationId = "p13-crm-browser";
const environment = "test";
const samplesPerOperation = 1;
const serverSamplesPerOperation = 20;
const profile = Object.freeze({
  evidenceClass: "controlled-ci-fixture",
  browserSamplesPerRoute: samplesPerOperation,
  serverSamplesPerOperation,
  concurrency: 1,
  platform: process.platform,
  architecture: process.arch,
  cpuModel: cpus()[0]?.model ?? "unknown",
  logicalCpus: cpus().length,
  memoryBytes: totalmem(),
  cacheState: "one cold browser navigation per route; server list/detail use 20 warm server-observed samples after one untimed request; action uses 20 sequential server-observed CAS mutations",
  productionCapacityClaim: false
});

const dailyRoutes = Object.freeze([
  { id: "dashboard", path: "/sales", heading: "Sales overview" },
  { id: "accounts", path: "/sales/accounts", heading: "Accounts" },
  { id: "contacts", path: "/sales/contacts", heading: "Contacts" },
  { id: "leads", path: "/sales/leads", heading: "Leads" },
  { id: "opportunities", path: "/sales/opportunities", heading: "Opportunities" },
  { id: "calendar", path: "/sales/calendar", heading: "Sales calendar" },
  { id: "reports", path: "/sales/reports", heading: "Reports" }
]);
const minimumRows = Object.freeze({ accounts: 50, contacts: 100, leads: 100, opportunities: 50, activities: 200, tasks: 100 });

function p95(values) {
  assert.ok(values.length > 0, "readiness sample set is empty");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)];
}

function timingDistribution(values) {
  assert.ok(values.length > 0, "timing distribution is empty");
  const ordered = [...values].sort((left, right) => left - right);
  const at = (quantile) => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)];
  const rounded = (value) => Number(value.toFixed(3));
  return Object.freeze({
    count: ordered.length,
    min: rounded(ordered[0]),
    p50: rounded(at(0.5)),
    p90: rounded(at(0.9)),
    p95: rounded(at(0.95)),
    max: rounded(ordered.at(-1)),
    samples: Object.freeze(values.map(rounded))
  });
}

async function login(browser, origin, persona, role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const response = await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, `${role} login route returned ${response?.status()}`);
  assert.deepEqual(await seriousAccessibilityViolations(page), [], `serious/critical accessibility violations at /login for ${role}`);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Password").fill(persona.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login");
  return { context, page };
}

async function visit(page, origin, route, role, phase, samples) {
  const timings = [];
  for (let sample = 0; sample < samplesPerOperation; sample += 1) {
    await page.goto("about:blank", { waitUntil: "commit" });
    const started = process.hrtime.bigint();
    let response;
    let navigationError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await page.goto(`${origin}${route.path}`, { waitUntil: "commit" });
        navigationError = undefined;
        if (response?.status() === 200) break;
      } catch (error) {
        navigationError = error;
      }
      if (attempt === 0) {
        await page.goto("about:blank", { waitUntil: "commit" });
        await page.waitForTimeout(250);
      }
    }
    if (navigationError !== undefined) throw navigationError;
    assert.equal(response?.status(), 200, `${phase}/${role}/${route.id} returned ${response?.status()}`);
    await page.locator("#workspace-main").waitFor();
    await page.getByRole("heading", { name: route.heading, exact: true }).waitFor();
    const ready = await page.locator("#workspace-main").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    assert.equal(ready, true, `${phase}/${role}/${route.id} workspace is not interactable`);
    timings.push(Number(process.hrtime.bigint() - started) / 1_000_000);

    if (sample === 0) {
      const verifyAccessibility = phase === "pre-restore" || ["dashboard", "reports", "account-detail"].includes(route.id);
      if (verifyAccessibility) assert.deepEqual(await seriousAccessibilityViolations(page), [], `serious/critical accessibility violations at ${route.path} for ${role} after ${phase}`);
      if (route.id === "reports") {
        const projection = await page.evaluate(async () => {
          const response = await fetch("/api/k-nex/sales/routes/sales.route.reports", { cache: "no-store" });
          return { status: response.status, body: await response.json() };
        });
        assert.equal(projection.status, 200, `${phase}/${role}/reports projection returned ${projection.status}`);
        assert.equal(Object.keys(projection.body.sourceResults ?? {}).length, 7, `${phase}/${role}/reports projection lost fixed report catalog`);
        const exports = await page.getByRole("button", { name: "Export report", exact: true }).count();
        assert.equal(exports, role === "manager" ? 6 : 0, `${role} report export visibility diverged from current authority`);
      }
    }
  }
  samples.push(...timings.map((milliseconds) => ({ phase, role, route: route.id, milliseconds })));
}

function auditEntry(actionId, resourceId, actorId, fromState, toState, revision, idempotencyKey, ownershipGenesis) {
  return { actionId, resourceId: String(resourceId), applicationId, environment, fromState, toState, occurredAt: `2026-09-09T0${revision - 1}:00:00.000Z`, actorId, revision, idempotencyKey, ...(ownershipGenesis === undefined ? {} : { ownershipGenesis }) };
}

async function reserveIds(client, table, count) {
  if (count === 0) return [];
  const result = await client.query("select nextval(pg_get_serial_sequence($1,'id'))::int as id from generate_series(1,$2::int)", [table, count]);
  assert.equal(result.rows.length, count, `${table} ID reservation diverged`);
  return result.rows.map(({ id }) => Number(id));
}

async function seedRepresentativeMinimum(pool, records, personas) {
  const representativeResult = await pool.query("select id from users where email=$1", [personas.representative.email]);
  const representativeId = String(representativeResult.rows[0]?.id);
  assert.equal(representativeId, records.representativeActorId, "generated fixture representative actor diverged");
  const teamId = `team:${representativeId}`;
  const ownershipGenesis = Object.freeze({ ownerId: representativeId, teamId });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const count = async (table) => Number((await client.query(`select count(*)::int as count from ${table} where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)`, [applicationId, environment, representativeId, teamId])).rows[0].count);
    const range = (start, end) => Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => start + offset);
    const accountIndexes = range(await count("sales_accounts") + 1, minimumRows.accounts);
    const accountIds = await reserveIds(client, "sales_accounts", accountIndexes.length);
    const accountRows = accountIndexes.map((index, offset) => ({ id: accountIds[offset], name: `P13.10 readiness account ${index}`, audit: JSON.stringify([auditEntry("sales.account.create", accountIds[offset], representativeId, "absent", "active", 1, `p13-10-readiness-account-${index}`, ownershipGenesis)]) }));
    if (accountRows.length > 0) await client.query("insert into sales_accounts(id,application_id,environment,owner_id,team_id,created_by,updated_by,name,audit) select row.id,$1,$2,$3,$4,$3,$3,row.name,row.audit::jsonb from jsonb_to_recordset($5::jsonb) row(id int,name text,audit text)", [applicationId, environment, representativeId, teamId, JSON.stringify(accountRows)]);

    const contactIndexes = range(await count("sales_contacts") + 1, minimumRows.contacts);
    const contactIds = await reserveIds(client, "sales_contacts", contactIndexes.length);
    const contactRows = contactIndexes.map((index, offset) => ({ id: contactIds[offset], displayName: `P13.10 readiness contact ${index}`, email: `p13-10-readiness-contact-${index}@example.test`, audit: JSON.stringify([auditEntry("sales.contact.create", contactIds[offset], representativeId, "absent", "active", 1, `p13-10-readiness-contact-${index}`, ownershipGenesis)]) }));
    if (contactRows.length > 0) await client.query("insert into sales_contacts(id,application_id,environment,owner_id,team_id,created_by,updated_by,account_id,display_name,email,audit) select row.id,$1,$2,$3,$4,$3,$3,$5,row.\"displayName\",row.email,row.audit::jsonb from jsonb_to_recordset($6::jsonb) row(id int,\"displayName\" text,email text,audit text)", [applicationId, environment, representativeId, teamId, records.repAccountId, JSON.stringify(contactRows)]);

    const leadIndexes = range(await count("sales_leads") + 1, minimumRows.leads);
    const leadIds = await reserveIds(client, "sales_leads", leadIndexes.length);
    const leadRows = leadIndexes.map((index, offset) => ({ id: leadIds[offset], displayName: `P13.10 readiness lead ${index}`, email: `p13-10-readiness-lead-${index}@example.test`, phone: `+1555011${String(index).padStart(4, "0")}`, audit: JSON.stringify([auditEntry("sales.lead.create", leadIds[offset], representativeId, "absent", "new", 1, `p13-10-readiness-lead-${index}`, ownershipGenesis)]) }));
    if (leadRows.length > 0) await client.query("insert into sales_leads(id,application_id,environment,owner_id,team_id,created_by,updated_by,display_name,source,email,phone,audit) select row.id,$1,$2,$3,$4,$3,$3,row.\"displayName\",'p13-10-browser-readiness',row.email,row.phone,row.audit::jsonb from jsonb_to_recordset($5::jsonb) row(id int,\"displayName\" text,email text,phone text,audit text)", [applicationId, environment, representativeId, teamId, JSON.stringify(leadRows)]);

    const stages = (await client.query("select stage_id,semantic from sales_pipeline_stages where pipeline_id=$1 and application_id=$2 and environment=$3 order by position", [records.pipelineId, applicationId, environment])).rows;
    assert.equal(stages.length, 6, "generated fixture pipeline must expose six stages before readiness seeding");
    assert.deepEqual(stages.map(({ semantic }) => semantic), ["qualification", "discovery", "proposal", "negotiation", "won", "lost"], "generated fixture pipeline semantic order diverged");
    const stageBySemantic = new Map(stages.map((stage) => [stage.semantic, stage.stage_id]));
    const opportunityIndexes = range(await count("sales_opportunities") + 1, minimumRows.opportunities);
    const opportunityIds = await reserveIds(client, "sales_opportunities", opportunityIndexes.length);
    const opportunityRows = opportunityIndexes.map((index, offset) => {
      const stage = stages[(index - 1) % stages.length];
      const id = opportunityIds[offset];
      const transitions = stage.semantic === "lost" ? [["qualification", "lost", "sales.opportunity.close"]] : [["qualification", "discovery", "sales.opportunity.stage.update"], ["discovery", "proposal", "sales.opportunity.stage.update"], ["proposal", "negotiation", "sales.opportunity.stage.update"], ["negotiation", "won", "sales.opportunity.close"]].slice(0, ["qualification", "discovery", "proposal", "negotiation", "won"].indexOf(stage.semantic));
      const audit = [auditEntry("sales.opportunity.create", id, representativeId, "absent", stageBySemantic.get("qualification"), 1, `p13-10-readiness-opportunity-${index}-create`, ownershipGenesis), ...transitions.map(([from, to, actionId], transitionIndex) => auditEntry(actionId, id, representativeId, stageBySemantic.get(from), stageBySemantic.get(to), transitionIndex + 2, `p13-10-readiness-opportunity-${index}-transition-${transitionIndex + 1}`))];
      return { id, name: `P13.10 readiness opportunity ${index}`, stageId: stage.stage_id, amount: `${1000 + index}.00`, revision: audit.length, primaryContactId: contactIds[0], closedAt: stage.semantic === "won" || stage.semantic === "lost" ? "2026-09-09T12:00:00.000Z" : null, lossReason: stage.semantic === "lost" ? "p13-10-readiness-loss" : null, audit: JSON.stringify(audit) };
    });
    if (opportunityRows.length > 0) await client.query("insert into sales_opportunities(id,application_id,environment,owner_id,team_id,created_by,updated_by,name,account_id,primary_contact_id,pipeline_id,stage_id,amount,currency,revision,closed_at,loss_reason,audit) select row.id,$1,$2,$3,$4,$3,$3,row.name,$5,row.\"primaryContactId\",$6,row.\"stageId\",row.amount,'USD',row.revision,row.\"closedAt\",row.\"lossReason\",row.audit::jsonb from jsonb_to_recordset($7::jsonb) row(id int,name text,\"primaryContactId\" int,\"stageId\" text,amount text,revision int,\"closedAt\" timestamptz,\"lossReason\" text,audit text)", [applicationId, environment, representativeId, teamId, records.repAccountId, records.pipelineId, JSON.stringify(opportunityRows)]);

    const activityIndexes = range(await count("sales_activities") + 1, minimumRows.activities);
    const activityIds = await reserveIds(client, "sales_activities", activityIndexes.length);
    const activityRows = activityIndexes.map((index, offset) => ({ id: activityIds[offset], subject: `P13.10 readiness activity ${index}`, audit: JSON.stringify([auditEntry("sales.activity.create", activityIds[offset], representativeId, "absent", "scheduled", 1, `p13-10-readiness-activity-${index}-create`, ownershipGenesis), auditEntry("sales.activity.complete", activityIds[offset], representativeId, "scheduled", "completed", 2, `p13-10-readiness-activity-${index}-complete`)]) }));
    if (activityRows.length > 0) await client.query("insert into sales_activities(id,application_id,environment,owner_id,team_id,created_by,updated_by,status,type,subject,actor_id,scheduled_at,occurred_at,related_record_id,related_record_type,revision,audit) select row.id,$1,$2,$3,$4,$3,$3,'completed','call',row.subject,$3,'2026-09-09T10:00:00.000Z','2026-09-09T10:00:00.000Z',$5,'sales.account',2,row.audit::jsonb from jsonb_to_recordset($6::jsonb) row(id int,subject text,audit text)", [applicationId, environment, representativeId, teamId, records.repAccountId, JSON.stringify(activityRows)]);

    const taskIndexes = range(await count("sales_tasks") + 1, minimumRows.tasks);
    const taskIds = await reserveIds(client, "sales_tasks", taskIndexes.length);
    const taskRows = taskIndexes.map((index, offset) => ({ id: taskIds[offset], title: `P13.10 readiness task ${index}`, audit: JSON.stringify([auditEntry("sales.task.create", taskIds[offset], representativeId, "absent", "open", 1, `p13-10-readiness-task-${index}`, ownershipGenesis)]) }));
    if (taskRows.length > 0) await client.query("insert into sales_tasks(id,application_id,environment,owner_id,team_id,created_by,updated_by,title,status,archive_status,revision,audit,due_date,related_record_id,related_record_type) select row.id,$1,$2,$3,$4,$3,$3,row.title,'open','active',1,row.audit::jsonb,'2026-09-09',$5,'sales.account' from jsonb_to_recordset($6::jsonb) row(id int,title text,audit text)", [applicationId, environment, representativeId, teamId, records.repAccountId, JSON.stringify(taskRows)]);

    const visibleIds = (await client.query(`select
      (select jsonb_agg(id::text order by id) from sales_accounts where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) accounts,
      (select jsonb_agg(id::text order by id) from sales_contacts where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) contacts,
      (select jsonb_agg(id::text order by id) from sales_leads where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) leads,
      (select jsonb_agg(id::text order by id) from sales_opportunities where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) opportunities,
      (select jsonb_agg(id::text order by id) from sales_activities where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) activities,
      (select jsonb_agg(id::text order by id) from sales_tasks where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) tasks`, [applicationId, environment, representativeId, teamId])).rows[0];
    await client.query("commit");
    return Object.freeze({ representativeId, teamId, visibleIds: Object.freeze(Object.fromEntries(Object.entries(visibleIds).map(([key, ids]) => [key, Object.freeze(ids)]))) });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function createPersonaCalendarView(origin, persona, role) {
  const loginResponse = await fetch(`${origin}/api/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: persona.email, password: persona.password }) });
  assert.equal(loginResponse.status, 200, `calendar fixture login failed: ${await loginResponse.clone().text()}`);
  const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "calendar fixture login omitted session cookie");
  const definition = { kind: "calendar", targetObjectId: "sales.object.activity", source: { id: "sales.saved-view.calendar", version: 1, sourceSchema: { id: "sales.saved-view.calendar.output", version: 1 }, structuralCompatibilityHash: "sha256:8d9e0bc1f7f3c53b53f3e006c51f2e5e41e2198284c3ad827e10cbf32431f5f9" }, fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], filters: [], sorts: [], dateField: "scheduled-at", presentation: { mode: "month" }, pageSize: 25 };
  const response = await fetch(`${origin}/api/k-nex/sales/actions/sales.saved-view.create`, { method: "POST", headers: { "content-type": "application/json", cookie, origin }, body: JSON.stringify({ routeId: "sales.route.saved-views", nodeId: "saved-view-create", selection: {}, input: { name: `P13.10 ${role} activity evidence`, visibility: { kind: "personal" }, definition }, idempotencyKey: `p13-10-${role}-calendar-create` }) });
  assert.equal(response.status, 200, `calendar fixture creation failed: ${await response.clone().text()}`);
  const data = (await response.json()).data;
  assert.match(data?.id, /^[1-9][0-9]*$/u, "calendar fixture creation omitted canonical ID");
  assert.equal(data.revision, 1, "calendar fixture creation revision diverged");
  assert.equal(data.definition?.calendarRange?.timezone, "UTC", "calendar fixture creation omitted server-owned UTC range");
  return Object.freeze({ id: Number(data.id), revision: data.revision });
}

async function verifySeed(pool, records, fixtureSeed, { expectOriginalName = false } = {}) {
  const result = await pool.query(`
    select
      (select count(*)::int from sales_accounts where application_id=$1 and environment=$2) as accounts,
      (select count(*)::int from sales_contacts where application_id=$1 and environment=$2) as contacts,
      (select count(*)::int from sales_leads where application_id=$1 and environment=$2) as leads,
      (select count(*)::int from sales_opportunities where application_id=$1 and environment=$2) as opportunities,
      (select count(*)::int from sales_pipelines where application_id=$1 and environment=$2) as pipelines,
      (select count(*)::int from sales_activities where application_id=$1 and environment=$2) as activities,
      (select count(*)::int from sales_tasks where application_id=$1 and environment=$2) as tasks,
      (select count(*)::int from sales_notes where application_id=$1 and environment=$2) as notes
  `, [applicationId, environment]);
  const counts = result.rows[0];
  for (const [key, minimum] of Object.entries(minimumRows)) assert.ok(counts[key] >= minimum, `generated fixture has ${counts[key]} ${key}; minimum is ${minimum}`);
  assert.ok(counts.pipelines > 0, "generated fixture missing pipelines");
  const account = await pool.query("select name, jsonb_array_length(audit)::int as audit_entries from sales_accounts where id=$1 and application_id=$2 and environment=$3", [records.repAccountId, applicationId, environment]);
  assert.equal(account.rows.length, 1, "representative account seed disappeared");
  assert.ok(account.rows[0].audit_entries >= 1, "representative account lost canonical audit evidence");
  if (expectOriginalName) assert.equal(account.rows[0].name, "Representative account", "representative account seed name diverged");
  const pipeline = await pool.query("select count(*)::int as count from sales_pipeline_stages where pipeline_id=$1 and application_id=$2 and environment=$3", [records.pipelineId, applicationId, environment]);
  assert.equal(pipeline.rows[0].count, 6, "generated fixture pipeline lost one of six stage rows");
  const representedStages = await pool.query("select count(distinct stage_id)::int as count from sales_opportunities where pipeline_id=$1 and application_id=$2 and environment=$3", [records.pipelineId, applicationId, environment]);
  assert.equal(representedStages.rows[0].count, 6, "readiness opportunities do not represent all six pipeline stages");
  const scopedCounts = (await pool.query(`
    select
      (select count(*)::int from sales_accounts where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) accounts,
      (select count(*)::int from sales_contacts where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) contacts,
      (select count(*)::int from sales_leads where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) leads,
      (select count(*)::int from sales_opportunities where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) opportunities,
      (select count(*)::int from sales_activities where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) activities,
      (select count(*)::int from sales_tasks where application_id=$1 and environment=$2 and (owner_id=$3 or team_id=$4)) tasks
  `, [applicationId, environment, fixtureSeed.representativeId, fixtureSeed.teamId])).rows[0];
  assert.deepEqual(scopedCounts, minimumRows, "representative-team fixture counts diverged from the declared minimum");
  const lifecycleCounts = (await pool.query(`
    select
      (select count(*)::int from sales_opportunities row join sales_pipeline_stages stage on stage.application_id=row.application_id and stage.environment=row.environment and stage.pipeline_id=row.pipeline_id and stage.stage_id=row.stage_id where row.application_id=$1 and row.environment=$2 and (row.owner_id=$3 or row.team_id=$4) and row.revision=jsonb_array_length(row.audit) and row.revision=case stage.semantic when 'qualification' then 1 when 'discovery' then 2 when 'proposal' then 3 when 'negotiation' then 4 when 'won' then 5 when 'lost' then 2 end and row.audit->0->>'actionId'='sales.opportunity.create' and row.audit->0->>'fromState'='absent' and row.audit->0->>'toState'=(select stage_id from sales_pipeline_stages where application_id=row.application_id and environment=row.environment and pipeline_id=row.pipeline_id and semantic='qualification') and row.audit->-1->>'toState'=row.stage_id and (stage.semantic in ('won','lost'))=(row.closed_at is not null) and (stage.semantic='lost')=(row.loss_reason is not null) and jsonb_path_query_array(row.audit,'$[*].actionId')=case stage.semantic when 'qualification' then '["sales.opportunity.create"]'::jsonb when 'discovery' then '["sales.opportunity.create","sales.opportunity.stage.update"]'::jsonb when 'proposal' then '["sales.opportunity.create","sales.opportunity.stage.update","sales.opportunity.stage.update"]'::jsonb when 'negotiation' then '["sales.opportunity.create","sales.opportunity.stage.update","sales.opportunity.stage.update","sales.opportunity.stage.update"]'::jsonb when 'won' then '["sales.opportunity.create","sales.opportunity.stage.update","sales.opportunity.stage.update","sales.opportunity.stage.update","sales.opportunity.close"]'::jsonb when 'lost' then '["sales.opportunity.create","sales.opportunity.close"]'::jsonb end and not exists (select 1 from jsonb_array_elements(row.audit) with ordinality entry(value,ordinal) where value->>'resourceId' is distinct from row.id::text or value->>'applicationId' is distinct from row.application_id or value->>'environment' is distinct from row.environment or value->>'actorId' is distinct from $3 or (value->>'revision')::int is distinct from ordinal::int or ordinal>1 and value->>'fromState' is distinct from row.audit->(ordinal::int-2)->>'toState')) opportunities,
      (select count(*)::int from sales_activities row where row.application_id=$1 and row.environment=$2 and (row.owner_id=$3 or row.team_id=$4) and row.status='completed' and row.revision=2 and jsonb_array_length(row.audit)=2 and row.audit->0->>'actionId'='sales.activity.create' and row.audit->0->>'fromState'='absent' and row.audit->0->>'toState'='scheduled' and row.audit->1->>'actionId'='sales.activity.complete' and row.audit->1->>'fromState'='scheduled' and row.audit->1->>'toState'='completed' and row.audit->0->>'resourceId'=row.id::text and row.audit->1->>'resourceId'=row.id::text) activities,
      (select count(*)::int from sales_tasks row where row.application_id=$1 and row.environment=$2 and (row.owner_id=$3 or row.team_id=$4) and row.status='open' and row.archive_status='active' and row.revision=1 and jsonb_array_length(row.audit)=1 and row.audit->0->>'actionId'='sales.task.create' and row.audit->0->>'fromState'='absent' and row.audit->0->>'toState'='open' and row.audit->0->>'resourceId'=row.id::text) tasks
  `, [applicationId, environment, fixtureSeed.representativeId, fixtureSeed.teamId])).rows[0];
  assert.deepEqual(lifecycleCounts, { opportunities: minimumRows.opportunities, activities: minimumRows.activities, tasks: minimumRows.tasks }, "representative lifecycle/audit evidence is non-canonical");
  return Object.freeze({ ...counts });
}

async function projectedRows(page, role, { routeId, nodeId, expectedCount, selection = {} }) {
  const rows = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    assert.ok(pageNumber <= Math.ceil(expectedCount / 25) + 2, `${role}/${routeId} projection pagination exceeded its bound`);
    const result = await page.evaluate(async ({ selectedRouteId, selectedPage, selectedSelection }) => {
      const query = new URLSearchParams({ page: String(selectedPage), ...Object.fromEntries(Object.entries(selectedSelection).map(([key, value]) => [key, String(value)])) });
      const response = await fetch(`/api/k-nex/sales/routes/${selectedRouteId}?${query}`, { cache: "no-store" });
      return { status: response.status, body: await response.text() };
    }, { selectedRouteId: routeId, selectedPage: pageNumber, selectedSelection: selection });
    assert.equal(result.status, 200, `${role}/${routeId} actor projection returned ${result.status}: ${result.body}`);
    const body = JSON.parse(result.body);
    const binding = body.sourceResults?.[nodeId];
    assert.equal(binding?.state, "success", `${role}/${routeId}/${nodeId} actor projection is not successful`);
    assert.ok(Array.isArray(binding.data?.rows), `${role}/${routeId}/${nodeId} actor projection omitted rows`);
    rows.push(...binding.data.rows);
    if (binding.data.page?.hasNext !== true) break;
  }
  assert.ok(rows.length >= expectedCount, `${role}/${routeId} actor-authorized row count is below ${expectedCount}`);
  assert.equal(new Set(rows.map(({ key }) => key)).size, rows.length, `${role}/${routeId} actor projection repeated rows`);
  return rows;
}

async function assertActorRepresentativeDataset(page, role, fixtureSeed) {
  const specifications = [
    { key: "accounts", routeId: "sales.route.accounts", nodeId: "sales-page-accounts-main" },
    { key: "contacts", routeId: "sales.route.contacts", nodeId: "sales-page-contacts-main" },
    { key: "leads", routeId: "sales.route.leads", nodeId: "sales-page-leads-main" },
    { key: "opportunities", routeId: "sales.route.opportunities", nodeId: "sales-opportunities" },
    { key: "tasks", routeId: "sales.route.tasks", nodeId: "sales-tasks" }
  ];
  const projections = {};
  for (const specification of specifications) projections[specification.key] = await projectedRows(page, role, { ...specification, expectedCount: minimumRows[specification.key] });
  const calendarView = fixtureSeed.calendarViews[role];
  projections.activities = await projectedRows(page, role, { routeId: "sales.route.calendar", nodeId: "calendar", expectedCount: minimumRows.activities, selection: { "saved-view-id": calendarView.id, "expected-revision": calendarView.revision } });
  const opportunityStages = new Set(projections.opportunities.map((row) => row.values?.["stage-semantic"]?.value));
  assert.deepEqual([...opportunityStages].sort(), ["discovery", "lost", "negotiation", "proposal", "qualification", "won"], `${role} actor projection did not expose all six opportunity stages`);
  for (const [key, rows] of Object.entries(projections)) {
    if (role === "representative") assert.equal(rows.length, minimumRows[key], `${role} actor-authorized row count diverged for ${key}`);
    const projectedIds = new Set(rows.map(({ key: id }) => id));
    assert.equal(fixtureSeed.visibleIds[key].every((id) => projectedIds.has(id)), true, `${role} did not expose every representative-team ${key} row`);
  }
}

async function timedHttp(page, request) {
  return page.evaluate(async ({ path, method, body }) => {
    const started = performance.now();
    const response = await fetch(path, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const responseBody = await response.text();
    return { status: response.status, body: responseBody, clientMilliseconds: performance.now() - started, serverTiming: response.headers.get("server-timing") };
  }, request);
}

async function timedHttpWithRetry(page, request) {
  let totalClientMilliseconds = 0;
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await timedHttp(page, request);
    totalClientMilliseconds += result.clientMilliseconds;
    if (result.status === 200) return { ...result, clientMilliseconds: totalClientMilliseconds };
    if (attempt === 0) {
      await page.waitForTimeout(250);
      totalClientMilliseconds += 250;
    }
  }
  return { ...result, clientMilliseconds: totalClientMilliseconds };
}

function serverMilliseconds(value, operation) {
  assert.equal(typeof value, "string", `${operation} omitted Server-Timing`);
  assert.match(value, /^knex;dur=(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u, `${operation} Server-Timing must contain exactly one knex duration`);
  const duration = Number(value.slice("knex;dur=".length));
  assert.ok(Number.isFinite(duration) && duration >= 0, `${operation} Server-Timing duration is invalid`);
  return duration;
}

async function serverProof(page, records, pool, serverTimings) {
  const samples = [
    { operation: "list", path: "/api/k-nex/sales/routes/sales.route.accounts" },
    { operation: "detail", path: `/api/k-nex/sales/routes/sales.route.account-detail?id=${encodeURIComponent(records.repAccountId)}` }
  ];
  for (const request of samples) {
    const warmup = await timedHttpWithRetry(page, request);
    assert.equal(warmup.status, 200, `pre-restore/manager/${request.operation} warm-up returned ${warmup.status}: ${warmup.body}`);
    serverMilliseconds(warmup.serverTiming, `pre-restore/manager/${request.operation} warm-up`);
    for (let sample = 0; sample < serverSamplesPerOperation; sample += 1) {
      const result = await timedHttp(page, request);
      assert.equal(result.status, 200, `pre-restore/manager/${request.operation} returned ${result.status}: ${result.body}`);
      assert.doesNotThrow(() => JSON.parse(result.body), `pre-restore/manager/${request.operation} returned invalid JSON`);
      serverTimings.push({ operation: request.operation, serverMilliseconds: serverMilliseconds(result.serverTiming, `pre-restore/manager/${request.operation}`), clientMilliseconds: result.clientMilliseconds });
    }
  }

  const beforeRow = (await pool.query("select revision,name from sales_accounts where id=$1 and application_id=$2 and environment=$3", [records.repAccountId, applicationId, environment])).rows[0];
  const expectedRevision = Number(beforeRow?.revision);
  assert.ok(Number.isSafeInteger(expectedRevision) && expectedRevision >= 1, "pre-restore/manager action CAS baseline diverged");
  let finalActionName;
  for (let sample = 0; sample < serverSamplesPerOperation; sample += 1) {
    const actionName = `P13.10 manager readiness update ${sample + 1}`;
    finalActionName = actionName;
    const actionRequest = {
      operation: "action",
      path: "/api/k-nex/sales/actions/sales.account.update",
      method: "POST",
      body: {
        routeId: "sales.route.account-detail",
        nodeId: "sales-page-account-detail-main",
        input: { id: records.repAccountId, expectedRevision: expectedRevision + sample, name: actionName },
        selection: {},
        idempotencyKey: `p13-10-browser-readiness-manager-account-update-${sample + 1}`
      }
    };
    const result = await timedHttp(page, actionRequest);
    assert.equal(result.status, 200, `pre-restore/manager/action returned ${result.status}: ${result.body}`);
    const actionBody = JSON.parse(result.body);
    assert.equal(typeof actionBody.data?.id, "string", "pre-restore/manager/action omitted canonical account id");
    assert.equal(Number.isSafeInteger(actionBody.data?.revision), true, "pre-restore/manager/action omitted revision");
    serverTimings.push({ operation: "action", serverMilliseconds: serverMilliseconds(result.serverTiming, "pre-restore/manager/action"), clientMilliseconds: result.clientMilliseconds });
  }
  const afterRow = (await pool.query("select revision,name from sales_accounts where id=$1 and application_id=$2 and environment=$3", [records.repAccountId, applicationId, environment])).rows[0];
  assert.deepEqual(afterRow, { revision: expectedRevision + serverSamplesPerOperation, name: finalActionName }, "pre-restore/manager action logical effect diverged");
}

async function durableSnapshot(pool) {
  const result = await pool.query(`
    select
      (select count(*)::int from sales_accounts where application_id=$1 and environment=$2) as accounts,
      (select count(*)::int from sales_contacts where application_id=$1 and environment=$2) as contacts,
      (select count(*)::int from sales_leads where application_id=$1 and environment=$2) as leads,
      (select count(*)::int from sales_opportunities where application_id=$1 and environment=$2) as opportunities,
      (select count(*)::int from sales_pipelines where application_id=$1 and environment=$2) as pipelines,
      (select count(*)::int from sales_pipeline_stages where application_id=$1 and environment=$2) as stages,
      (select count(*)::int from sales_activities where application_id=$1 and environment=$2) as activities,
      (select count(*)::int from sales_tasks where application_id=$1 and environment=$2) as tasks,
      (select count(*)::int from sales_notes where application_id=$1 and environment=$2) as notes,
      (select count(*)::int from sales_attachment_references where application_id=$1 and environment=$2) as attachments,
      (select count(*)::int from k_nex_outbox) as outbox
  `, [applicationId, environment]);
  return Object.freeze({ ...result.rows[0] });
}

async function runPreRestorePersona(browser, origin, persona, role, records, fixtureSeed, pool, timings, serverTimings) {
  const session = await login(browser, origin, persona, role);
  try {
    for (const route of dailyRoutes) {
      const calendarView = fixtureSeed.calendarViews[role];
      const selectedRoute = route.id === "calendar" ? { ...route, path: `${route.path}?saved-view-id=${calendarView.id}&expected-revision=${calendarView.revision}` } : route;
      await visit(session.page, origin, selectedRoute, role, "pre-restore", timings);
    }
    const detailRoute = { id: "account-detail", path: `/sales/accounts/${records.repAccountId}`, heading: "Account detail" };
    await visit(session.page, origin, detailRoute, role, "pre-restore", timings);
    for (const region of ["Ownership", "Timeline", "Tasks and reminders", "State history", "Authorized actions"]) await session.page.getByRole("region", { name: region }).waitFor();
    assert.equal(await session.page.getByRole("button", { name: "Account Update", exact: true }).count(), 1, `${role} lost authorized account update visibility`);
    assert.equal(await session.page.getByRole("button", { name: "Account Archive", exact: true }).count(), role === "manager" ? 1 : 0, `${role} account archive visibility diverged from current authority`);
    await assertActorRepresentativeDataset(session.page, role, fixtureSeed);
    if (role === "manager") await serverProof(session.page, records, pool, serverTimings);
  } finally {
    await session.context.close();
  }
}

async function runPostRestoreSmoke(browser, origin, persona, role, records, timings) {
  const session = await login(browser, origin, persona, `${role}/post-restore`);
  try {
    for (const route of [dailyRoutes[0], dailyRoutes[6], { id: "account-detail", path: `/sales/accounts/${records.repAccountId}`, heading: "Account detail" }]) {
      await visit(session.page, origin, route, role, "post-restore", timings);
    }
    assert.equal(await session.page.getByRole("button", { name: "Account Update", exact: true }).count(), 1, `${role} lost account update after restore`);
    assert.equal(await session.page.getByRole("button", { name: "Account Archive", exact: true }).count(), role === "manager" ? 1 : 0, `${role} archive authority changed after restore`);
  } finally {
    await session.context.close();
  }
}

test("P13.10 generated fixture proves controlled browser readiness before and after restore", { timeout: 900_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, stopWorker, stopWeb, startWorker, startWeb, restoreToCleanDatabase }) => {
    assert.deepEqual(Object.keys(profile).sort(), ["architecture", "browserSamplesPerRoute", "cacheState", "concurrency", "cpuModel", "evidenceClass", "logicalCpus", "memoryBytes", "platform", "productionCapacityClaim", "serverSamplesPerOperation"], "controlled fixture profile is incomplete");
    assert.equal(profile.browserSamplesPerRoute, samplesPerOperation);
    assert.equal(profile.serverSamplesPerOperation, serverSamplesPerOperation);
    assert.equal(profile.concurrency, 1);
    assert.equal(profile.productionCapacityClaim, false);
    process.stdout.write(`P13_10_BROWSER_PROFILE ${JSON.stringify(profile)}\n`);

    const browser = await chromium.launch({ headless: true });
    const timings = [];
    const postRestoreSmokeTimings = [];
    const serverTimings = [];
    let activePool = pool;
    try {
      const representativeSeed = await seedRepresentativeMinimum(activePool, records, personas);
      const fixtureSeed = Object.freeze({ ...representativeSeed, calendarViews: Object.freeze({ representative: await createPersonaCalendarView(origin, personas.representative, "representative"), manager: await createPersonaCalendarView(origin, personas.manager, "manager") }) });
      const beforeSeed = await verifySeed(activePool, records, fixtureSeed, { expectOriginalName: true });
      for (const [role, persona] of [["representative", personas.representative], ["manager", personas.manager]]) {
        await runPreRestorePersona(browser, origin, persona, role, records, fixtureSeed, activePool, timings, serverTimings);
      }
      const beforeRestore = await durableSnapshot(activePool);

      await stopWorker();
      await stopWeb();
      activePool = await restoreToCleanDatabase();
      assert.deepEqual(await durableSnapshot(activePool), beforeRestore, "physical restore changed controlled fixture record/effect counts");
      const afterSeed = await verifySeed(activePool, records, fixtureSeed);
      for (const key of Object.keys(minimumRows)) assert.equal(afterSeed[key], beforeSeed[key], `physical restore changed representative ${key} count`);
      await startWeb();
      await startWorker();

      for (const [role, persona] of [["representative", personas.representative], ["manager", personas.manager]]) {
        await runPostRestoreSmoke(browser, origin, persona, role, records, postRestoreSmokeTimings);
      }

      const readinessP95 = p95(timings.map(({ milliseconds }) => milliseconds));
      const distributions = Object.fromEntries(["list", "detail", "action"].map((operation) => {
        const samples = serverTimings.filter((sample) => sample.operation === operation);
        return [operation, Object.freeze({ server: timingDistribution(samples.map(({ serverMilliseconds }) => serverMilliseconds)), client: timingDistribution(samples.map(({ clientMilliseconds }) => clientMilliseconds)) })];
      }));
      process.stdout.write(`P13_10_SERVER_DISTRIBUTION ${JSON.stringify({ unit: "milliseconds", samplesPerOperation: serverSamplesPerOperation, operations: distributions })}\n`);
      const serverP95 = Object.fromEntries(Object.entries(distributions).map(([operation, distribution]) => {
        assert.equal(distribution.server.count, serverSamplesPerOperation, `authenticated ${operation} server-observed sample count diverged`);
        assert.equal(distribution.client.count, serverSamplesPerOperation, `authenticated ${operation} client diagnostic sample count diverged`);
        assert.ok(distribution.server.p95 <= 1_000, `authenticated ${operation} server-observed p95 ${distribution.server.p95.toFixed(3)}ms exceeds 1000ms`);
        return [operation, distribution.server.p95];
      }));
      const clientP95 = Object.fromEntries(Object.entries(distributions).map(([operation, distribution]) => [operation, distribution.client.p95]));
      process.stdout.write(`P13_10_BROWSER_READINESS ${JSON.stringify({ sampleCount: timings.length, postRestoreSmokeCount: postRestoreSmokeTimings.length, serverSampleCount: serverTimings.length, browserSamplesPerRoute: samplesPerOperation, serverSamplesPerOperation, p95Milliseconds: Number(readinessP95.toFixed(2)), serverObservedP95Milliseconds: serverP95, clientHttpP95Milliseconds: clientP95, cacheState: profile.cacheState })}\n`);
      assert.ok(readinessP95 <= 2_500, `controlled fixture browser readiness p95 ${readinessP95.toFixed(2)}ms exceeds 2500ms`);
      assert.equal(timings.length, (dailyRoutes.length + 1) * 2 * samplesPerOperation, "pre-restore readiness sample count diverged from declared role/route matrix");
      assert.equal(postRestoreSmokeTimings.length, 3 * 2, "post-restore smoke sample count diverged from declared role/route matrix");
      assert.equal(serverTimings.length, 3 * serverSamplesPerOperation, "manager server sample count diverged from declared operation matrix");
      assert.deepEqual(await durableSnapshot(activePool), beforeRestore, "browser readiness journey changed restored record/effect counts");
    } finally {
      await browser.close();
    }
  });
});
