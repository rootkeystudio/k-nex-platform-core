import assert from "node:assert/strict";
import test from "node:test";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function ownerSession(origin, persona) {
  const response = await fetch(`${origin}/api/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: persona.email, password: persona.password }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); return cookie;
}

async function action(origin, cookie, actionId, routeId, nodeId, input, idempotencyKey, selection = {}) {
  return fetch(`${origin}/api/k-nex/sales/actions/${actionId}`, { method: "POST", headers: { "content-type": "application/json", cookie, origin }, body: JSON.stringify({ routeId, nodeId, selection, input, idempotencyKey }) });
}

async function projection(origin, cookie, routeId, query = "page=1") {
  const response = await fetch(`${origin}/api/k-nex/sales/routes/${routeId}?${query}`, { headers: { cookie } });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}

const cell = (row, field) => row.values[field]?.value;

async function eventually(check, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(message);
}

const definition = Object.freeze({
  kind: "table", targetObjectId: "sales.object.account",
  source: { id: "sales.saved-view.table", version: 1, sourceSchema: { id: "sales.saved-view.table.output", version: 1 }, structuralCompatibilityHash: "sha256:9707080142ac16e3f0d540c439e7ae3bc8d2cc1f6fb5166a1879f355834c07d2" },
  fields: ["name"], filters: [], sorts: [], presentation: { density: "comfortable" }, pageSize: 25
});
const calendarDefinition = Object.freeze({
  kind: "calendar", targetObjectId: "sales.object.activity",
  source: { id: "sales.saved-view.calendar", version: 1, sourceSchema: { id: "sales.saved-view.calendar.output", version: 1 }, structuralCompatibilityHash: "sha256:8d9e0bc1f7f3c53b53f3e006c51f2e5e41e2198284c3ad827e10cbf32431f5f9" },
  fields: ["type", "subject", "status", "scheduled-at", "occurred-at", "related-record-type", "related-record-id", "revision"], filters: [], sorts: [], dateField: "scheduled-at", presentation: { mode: "month" }, pageSize: 25
});

async function evidence(pool) {
  return (await pool.query(`select
    (select count(*)::int from sales_saved_views) saved_views,
    (select coalesce(sum(jsonb_array_length(audit)),0)::int from sales_saved_views) saved_audit,
    (select count(*)::int from k_nex_outbox where payload->>'actionId' in ('sales.pipeline.update','sales.saved-view.create','sales.saved-view.update','sales.saved-view.archive')) outbox,
    (select count(*)::int from sales_action_idempotency where action_id in ('sales.pipeline.update','sales.saved-view.create','sales.saved-view.update','sales.saved-view.archive')) idempotency`)).rows[0];
}

test("P13.4 generated HTTP configuration actions commit CAS, audit, outbox, realtime delivery, and idempotency atomically", { timeout: 360_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, applicationOutput, runDoctor }) => {
    assert.match(runDoctor(), /K_NEX_APPLICATION_READY/u, "generated doctor must accept the exact system.general@2 reporting timezone document");
    const cookie = await ownerSession(origin, personas.owner);
    const initialEvidence = await evidence(pool);
    const pipeline = (await pool.query("select id,revision,name,ordered_stage_ids,audit from sales_pipelines where id=$1", [records.pipelineId])).rows[0];
    const stages = (await pool.query("select stage_id,revision,semantic,name,position,probability_basis_points,allowed_transition_stage_ids,required_field_ids from sales_pipeline_stages where pipeline_id=$1 order by position", [records.pipelineId])).rows;
    const configuredSemantics = ["discovery", "qualification", "proposal", "negotiation", "won", "lost"];
    const configuredStages = configuredSemantics.map((semantic, position) => { const stage = stages.find((candidate) => candidate.semantic === semantic); assert.ok(stage); return { ...stage, position, allowed_transition_stage_ids: semantic === "qualification" ? stage.allowed_transition_stage_ids.filter((id) => id !== stages.find((candidate) => candidate.semantic === "discovery").stage_id) : stage.allowed_transition_stage_ids }; });
    const pipelineInput = { id: String(pipeline.id), expectedRevision: pipeline.revision, name: "HTTP configured pipeline", orderedStageIds: configuredStages.map(({ stage_id }) => stage_id), stages: configuredStages.map((stage) => ({ stageId: stage.stage_id, expectedRevision: stage.revision, semantic: stage.semantic, name: stage.name, position: stage.position, probabilityBasisPoints: stage.probability_basis_points, allowedTransitionStageIds: stage.allowed_transition_stage_ids, requiredFieldIds: stage.required_field_ids })) };
    const pipelineResponse = await action(origin, cookie, "sales.pipeline.update", "sales.route.pipeline-settings", "pipeline-update", pipelineInput, "p134-http-pipeline-update");
    assert.equal(pipelineResponse.status, 200, `${await pipelineResponse.clone().text()}\nAUDIT=${JSON.stringify(pipeline.audit)}\n${applicationOutput()}`);
    const pipelineData = (await pipelineResponse.json()).data; assert.equal(pipelineData.revision, pipeline.revision + 1);

    const snapshotProjection = await projection(origin, cookie, "sales.route.pipeline-settings");
    const snapshot = snapshotProjection.sourceResults["pipeline-update"]; assert.equal(snapshot.state, "success");
    assert.deepEqual(snapshot.data.rows.map((row) => cell(row, "semantic")), configuredSemantics, "pipeline snapshot follows configured open-stage order");
    const kanbanProjection = await projection(origin, cookie, "sales.route.opportunities", "page=1&mode=kanban");
    const kanban = kanbanProjection.sourceResults["sales-opportunity-kanban"]; assert.equal(kanban.state, "success");
    assert.deepEqual(kanban.data.rows.slice(0, 6).map((row) => JSON.parse(cell(row, "stage-metadata")).stageSemantic), configuredSemantics, "Kanban follows configured open-stage order");

    const configuredPipeline = (await pool.query("select id,revision from sales_pipelines where id=$1", [records.pipelineId])).rows[0];
    const configuredStageRows = (await pool.query("select stage_id,revision,semantic from sales_pipeline_stages where pipeline_id=$1", [records.pipelineId])).rows;
    const sourceStage = configuredStageRows.find(({ semantic }) => semantic === "qualification"); const destinationStage = configuredStageRows.find(({ semantic }) => semantic === "discovery"); assert.ok(sourceStage && destinationStage);
    const opportunityBefore = (await pool.query("select revision,stage_id,audit from sales_opportunities where id=$1", [records.opportunityLossId])).rows[0];
    const removedEdgeKey = "p134-http-removed-pipeline-edge";
    const removedEdgeEvidence = async () => ({ opportunity: (await pool.query("select revision,stage_id,audit from sales_opportunities where id=$1", [records.opportunityLossId])).rows[0], outbox: (await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.opportunity.stage.update'")).rows[0].count, idempotency: (await pool.query("select count(*)::int count from sales_action_idempotency where action_id='sales.opportunity.stage.update' and idempotency_key=$1", [removedEdgeKey])).rows[0].count });
    const beforeRemovedEdge = await removedEdgeEvidence();
    const removedEdge = await action(origin, cookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", { id: String(records.opportunityLossId), expectedRevision: opportunityBefore.revision, expectedPipelineId: String(configuredPipeline.id), expectedPipelineRevision: configuredPipeline.revision, expectedSourceStageId: sourceStage.stage_id, expectedSourceStageRevision: sourceStage.revision, destinationStageId: destinationStage.stage_id, expectedDestinationStageRevision: destinationStage.revision }, removedEdgeKey);
    assert.equal(removedEdge.status, 409, `${await removedEdge.clone().text()}\n${applicationOutput()}`);
    assert.deepEqual(await removedEdgeEvidence(), beforeRemovedEdge, "removed configured edge leaves opportunity, audit, outbox, and idempotency unchanged");

    const racedPipeline = (await pool.query("select id,revision,name,ordered_stage_ids from sales_pipelines where id=$1", [records.pipelineId])).rows[0];
    const racedStages = (await pool.query("select stage_id,revision,semantic,name,position,probability_basis_points,allowed_transition_stage_ids,required_field_ids from sales_pipeline_stages where pipeline_id=$1 order by position", [records.pipelineId])).rows;
    const racedInput = (name) => ({ id: String(racedPipeline.id), expectedRevision: racedPipeline.revision, name, orderedStageIds: racedPipeline.ordered_stage_ids, stages: racedStages.map((stage) => ({ stageId: stage.stage_id, expectedRevision: stage.revision, semantic: stage.semantic, name: stage.name, position: stage.position, probabilityBasisPoints: stage.probability_basis_points, allowedTransitionStageIds: stage.allowed_transition_stage_ids, requiredFieldIds: stage.required_field_ids })) });
    const beforeRace = await evidence(pool);
    const raceResponses = await Promise.all([
      action(origin, cookie, "sales.pipeline.update", "sales.route.pipeline-settings", "pipeline-update", racedInput("Race A"), "p134-http-pipeline-race-a"),
      action(origin, cookie, "sales.pipeline.update", "sales.route.pipeline-settings", "pipeline-update", racedInput("Race B"), "p134-http-pipeline-race-b")
    ]);
    assert.deepEqual(raceResponses.map(({ status }) => status).sort(), [200, 409]);
    const afterRace = await evidence(pool);
    assert.equal(afterRace.outbox, beforeRace.outbox + 1);
    assert.equal(afterRace.idempotency, beforeRace.idempotency + 1);
    assert.deepEqual((await pool.query("select revision,jsonb_array_length(audit) audit_count from sales_pipelines where id=$1", [records.pipelineId])).rows, [{ revision: racedPipeline.revision + 1, audit_count: racedPipeline.revision + 1 }]);
    assert.equal((await pool.query("select count(*)::int count from sales_pipeline_stages where pipeline_id=$1 and revision=$2", [records.pipelineId, racedStages[0].revision + 1])).rows[0].count, 6, "one complete six-stage snapshot wins the overlap");

    const createInput = { name: "HTTP personal accounts", visibility: { kind: "personal" }, definition };
    const createdResponse = await action(origin, cookie, "sales.saved-view.create", "sales.route.saved-views", "saved-view-create", createInput, "p134-http-view-create");
    assert.equal(createdResponse.status, 200, await createdResponse.clone().text()); const created = (await createdResponse.json()).data;
    const afterCreate = await evidence(pool);
    const replay = await action(origin, cookie, "sales.saved-view.create", "sales.route.saved-views", "saved-view-create", createInput, "p134-http-view-create");
    assert.equal(replay.status, 200, await replay.clone().text()); assert.deepEqual((await replay.json()).data, created); assert.deepEqual(await evidence(pool), afterCreate);

    assert.equal(typeof created.id, "string"); assert.match(created.id, /^[1-9][0-9]*$/u); const savedViewId = created.id;
    const selectedRevision1 = { "saved-view-id": Number(savedViewId), "expected-revision": 1 };
    const stale = await action(origin, cookie, "sales.saved-view.update", "sales.route.saved-views", "saved-view-detail", { id: savedViewId, expectedRevision: 99, name: "Must not persist", visibility: { kind: "personal" }, definition }, "p134-http-view-stale", { "saved-view-id": Number(savedViewId), "expected-revision": 99 });
    assert.equal(stale.status, 409, await stale.clone().text()); assert.deepEqual(await evidence(pool), afterCreate, "stale CAS rolls back reservation, mutation, audit, and outbox");

    const updatedResponse = await action(origin, cookie, "sales.saved-view.update", "sales.route.saved-views", "saved-view-detail", { id: savedViewId, expectedRevision: 1, name: "HTTP accounts updated", visibility: { kind: "personal" }, definition }, "p134-http-view-update", selectedRevision1);
    assert.equal(updatedResponse.status, 200, await updatedResponse.clone().text()); const updated = (await updatedResponse.json()).data; assert.equal(updated.revision, 2);
    const archivedResponse = await action(origin, cookie, "sales.saved-view.archive", "sales.route.saved-views", "saved-view-archive", { id: savedViewId, expectedRevision: 2 }, "p134-http-view-archive", { "saved-view-id": Number(savedViewId), "expected-revision": 2 });
    assert.equal(archivedResponse.status, 200, await archivedResponse.clone().text()); assert.equal((await archivedResponse.json()).data.revision, 3);

    const generalBeforeUnrelated = (await pool.query("select document_revision,settings_revision,values_json from k_nex_system_settings_documents where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'")).rows[0];
    await assert.rejects(pool.query("update k_nex_system_settings_documents set owner_namespace='forged' where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'"), /k_nex_system_settings_documents_owner_check/u, "database rejects forged system.general ownership");
    const unrelatedStateRevision = (await pool.query("update k_nex_system_settings_state set settings_revision=settings_revision+1 where application_id='p13-crm-browser' and environment='test' returning settings_revision")).rows[0].settings_revision;
    await pool.query("insert into k_nex_system_settings_documents(application_id,environment,descriptor_id,descriptor_schema_version,owner_scope_key,owner_kind,owner_namespace,document_revision,settings_revision,values_json) values ('p13-crm-browser','test','system.unrelated',1,'platform:system','platform','system',1,$1,'{}'::jsonb)", [unrelatedStateRevision]);
    assert.deepEqual((await pool.query("select document_revision,settings_revision,values_json from k_nex_system_settings_documents where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'")).rows[0], generalBeforeUnrelated, "unrelated settings advance leaves system.general revision unchanged");
    assert.match(runDoctor(), /K_NEX_APPLICATION_READY/u, "doctor accepts system.general document revision behind the unrelated global revision");

    const calendarInput = { name: "HTTP reporting calendar", visibility: { kind: "personal" }, definition: calendarDefinition };
    const calendarResponse = await action(origin, cookie, "sales.saved-view.create", "sales.route.saved-views", "saved-view-create", calendarInput, "p134-http-calendar-create");
    assert.equal(calendarResponse.status, 200, await calendarResponse.clone().text()); const calendar = (await calendarResponse.json()).data;
    assert.equal(calendar.definition.calendarRange.timezone, "UTC");
    assert.match(calendar.definition.calendarRange.start, /^\d{4}-\d{2}-01T00:00:00\.000Z$/u);
    assert.match(calendar.definition.calendarRange.end, /^\d{4}-\d{2}-01T00:00:00\.000Z$/u);
    const afterCalendarCreate = await evidence(pool);
    const calendarReplay = await action(origin, cookie, "sales.saved-view.create", "sales.route.saved-views", "saved-view-create", calendarInput, "p134-http-calendar-create");
    assert.equal(calendarReplay.status, 200, await calendarReplay.clone().text()); assert.deepEqual((await calendarReplay.json()).data, calendar); assert.deepEqual(await evidence(pool), afterCalendarCreate);
    const calendarSelection = { "saved-view-id": Number(calendar.id), "expected-revision": 1 };
    const calendarUpdate = await action(origin, cookie, "sales.saved-view.update", "sales.route.saved-views", "saved-view-detail", { id: calendar.id, expectedRevision: 1, name: "HTTP reporting calendar updated", visibility: { kind: "personal" }, definition: calendar.definition }, "p134-http-calendar-update", calendarSelection);
    assert.equal(calendarUpdate.status, 200, await calendarUpdate.clone().text()); assert.equal((await calendarUpdate.json()).data.revision, 2);

    const afterCalendarUpdate = await evidence(pool);
    await pool.query("update k_nex_system_settings_documents set values_json=jsonb_set(values_json,'{reportingTimezone}','\"Mars/Olympus\"'::jsonb) where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'");
    const malformedCalendar = await action(origin, cookie, "sales.saved-view.update", "sales.route.saved-views", "saved-view-detail", { id: calendar.id, expectedRevision: 2, name: "Malformed timezone must roll back", visibility: { kind: "personal" }, definition: calendar.definition }, "p134-http-calendar-malformed-timezone", { "saved-view-id": Number(calendar.id), "expected-revision": 2 });
    assert.equal(malformedCalendar.status, 403, await malformedCalendar.clone().text()); assert.deepEqual(await evidence(pool), afterCalendarUpdate);
    assert.throws(() => runDoctor(), /Application reporting timezone readiness mismatch/u, "doctor rejects malformed system.general reporting timezone");
    await pool.query("update k_nex_system_settings_documents set values_json=$1::jsonb where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'", [JSON.stringify(generalBeforeUnrelated.values_json)]);
    await pool.query("update k_nex_system_settings_documents set settings_revision=$1 where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'", [unrelatedStateRevision + 1]);
    const futureCalendar = await action(origin, cookie, "sales.saved-view.update", "sales.route.saved-views", "saved-view-detail", { id: calendar.id, expectedRevision: 2, name: "Future timezone must roll back", visibility: { kind: "personal" }, definition: calendar.definition }, "p134-http-calendar-future-timezone", { "saved-view-id": Number(calendar.id), "expected-revision": 2 });
    assert.equal(futureCalendar.status, 403, await futureCalendar.clone().text()); assert.deepEqual(await evidence(pool), afterCalendarUpdate);
    assert.throws(() => runDoctor(), /Application reporting timezone readiness mismatch/u, "doctor rejects future system.general settings revision");
    await pool.query("update k_nex_system_settings_documents set settings_revision=$1 where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'", [generalBeforeUnrelated.settings_revision]);

    const beforeSettingsMismatch = await evidence(pool);
    const settingsState = (await pool.query("select settings_revision from k_nex_system_settings_state where application_id='p13-crm-browser' and environment='test'")).rows[0];
    const settingsDocument = (await pool.query("select document_revision,settings_revision,values_json from k_nex_system_settings_documents where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'")).rows[0];
    const settingsClient = await pool.connect(); await settingsClient.query("begin");
    try {
      await settingsClient.query("update k_nex_system_settings_state set settings_revision=settings_revision+1 where application_id='p13-crm-browser' and environment='test'");
      await settingsClient.query("update k_nex_system_settings_documents set document_revision=document_revision+1,settings_revision=settings_revision+1,values_json=jsonb_set(values_json,'{reportingTimezone}','\"Europe/Istanbul\"'::jsonb) where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'");
      await settingsClient.query("commit");
    } catch (error) { await settingsClient.query("rollback"); throw error; } finally { settingsClient.release(); }
    const mismatchedCalendar = await action(origin, cookie, "sales.saved-view.update", "sales.route.saved-views", "saved-view-detail", { id: calendar.id, expectedRevision: 2, name: "Must roll back", visibility: { kind: "personal" }, definition: calendar.definition }, "p134-http-calendar-settings-mismatch", { "saved-view-id": Number(calendar.id), "expected-revision": 2 });
    assert.equal(mismatchedCalendar.status, 403, await mismatchedCalendar.clone().text());
    assert.deepEqual(await evidence(pool), beforeSettingsMismatch, "settings-revision mismatch rolls back reservation, Saved View, audit, and outbox");
    await pool.query("update k_nex_system_settings_state set settings_revision=$1 where application_id='p13-crm-browser' and environment='test'", [settingsState.settings_revision]);
    await pool.query("update k_nex_system_settings_documents set document_revision=$1,settings_revision=$2,values_json=$3::jsonb where application_id='p13-crm-browser' and environment='test' and descriptor_id='system.general' and descriptor_schema_version=2 and owner_scope_key='platform:system'", [settingsDocument.document_revision, settingsDocument.settings_revision, JSON.stringify(settingsDocument.values_json)]);
    assert.match(runDoctor(), /K_NEX_APPLICATION_READY/u, "doctor remains ready after restoring the older coherent system.general document revision");

    assert.deepEqual((await pool.query("select revision,status,jsonb_array_length(audit) audit_count from sales_saved_views where id=$1", [savedViewId])).rows, [{ revision: 3, status: "archived", audit_count: 3 }]);
    assert.deepEqual((await pool.query("select revision,jsonb_array_length(audit) audit_count from sales_pipelines where id=$1", [records.pipelineId])).rows, [{ revision: pipeline.revision + 2, audit_count: pipeline.revision + 2 }]);
    assert.deepEqual(await evidence(pool), { saved_views: initialEvidence.saved_views + 2, saved_audit: initialEvidence.saved_audit + 5, outbox: initialEvidence.outbox + 7, idempotency: initialEvidence.idempotency + 7 });
    await eventually(async () => Number((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId' in ('sales.pipeline.update','sales.saved-view.create','sales.saved-view.update','sales.saved-view.archive') and status='delivered'")).rows[0].count) === initialEvidence.outbox + 7, "P13.4 durable invalidations were not delivered by the realtime worker");
  });
});
