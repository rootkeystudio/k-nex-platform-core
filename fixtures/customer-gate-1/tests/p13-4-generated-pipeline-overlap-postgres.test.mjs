import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalJson } from "@k-nex/contracts";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function ownerSession(origin, persona) {
  const response = await fetch(`${origin}/api/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: persona.email, password: persona.password }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); return cookie;
}

function action(origin, cookie, actionId, routeId, nodeId, input, idempotencyKey) {
  return fetch(`${origin}/api/k-nex/sales/actions/${actionId}`, { method: "POST", headers: { "content-type": "application/json", cookie, origin }, body: JSON.stringify({ routeId, nodeId, selection: {}, input, idempotencyKey }) });
}

/**
 * This proof depends on the winner reaching the contended lock before the
 * loser is fired. Counting every backend in a lock wait cannot express that:
 * unrelated activity satisfies the count, the loser can be queued first,
 * validate against the pre-winner snapshot, and commit - which is what the
 * two-core runner produced, both requests returning 200. So the winner is
 * observed blocked by this test's own blocking transaction before the loser
 * starts, and the loser only has to be blocked by something, because it queues
 * behind either the blocker or the winner.
 */
async function waitForBlockedRequests(pool, minimum, blockedBy) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const row = (await pool.query(`select count(*)::int count from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
        and cardinality(pg_blocking_pids(pid)) > 0
        and ($1::int is null or $1::int = any(pg_blocking_pids(pid)))`, [blockedBy ?? null])).rows[0];
    if (row.count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${minimum} generated Sales requests to be blocked${blockedBy === undefined ? "" : " by the contending transaction"}.`);
}

async function pipelineSnapshot(pool, pipelineId, name) {
  const pipeline = (await pool.query("select id,revision,ordered_stage_ids from sales_pipelines where id=$1", [pipelineId])).rows[0];
  const stages = (await pool.query("select stage_id,revision,semantic,name,position,probability_basis_points,allowed_transition_stage_ids,required_field_ids,audit from sales_pipeline_stages where pipeline_id=$1 order by position", [pipelineId])).rows;
  assert.equal(stages.length, 6);
  return {
    pipeline,
    stages,
    input: { id: String(pipeline.id), expectedRevision: pipeline.revision, name, orderedStageIds: pipeline.ordered_stage_ids, stages: stages.map((stage) => ({ stageId: stage.stage_id, expectedRevision: stage.revision, semantic: stage.semantic, name: stage.name, position: stage.position, probabilityBasisPoints: stage.probability_basis_points, allowedTransitionStageIds: stage.allowed_transition_stage_ids, requiredFieldIds: stage.required_field_ids })) }
  };
}

async function loserEvidence(pool, actionId, key, opportunityId) {
  const result = await pool.query(`select
    (select count(*)::int from sales_opportunities) opportunity_count,
    (select count(*)::int from k_nex_outbox where payload->>'actionId'=$1) outbox_count,
    (select count(*)::int from sales_action_idempotency where action_id=$1 and idempotency_key=$2) idempotency_count`, [actionId, key]);
  const opportunity = opportunityId === undefined ? undefined : (await pool.query("select revision,stage_id,closed_at,loss_reason,audit from sales_opportunities where id=$1", [opportunityId])).rows[0];
  return { ...result.rows[0], opportunity };
}

async function routeEvidence(pool, actionId, key, opportunityId) {
  return (await pool.query(`select
    (select revision from sales_opportunities where id=$3) opportunity_revision,
    (select count(*)::int from jsonb_array_elements((select audit from sales_opportunities where id=$3)) entry where entry->>'actionId'=$1) audit_count,
    (select count(*)::int from k_nex_outbox where payload->>'actionId'=$1) outbox_count,
    (select count(*)::int from sales_action_idempotency where action_id=$1 and idempotency_key=$2) idempotency_count`, [actionId, key, opportunityId])).rows[0];
}

function resultDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

async function canonicalActionProblem(response, status, code, detail) {
  assert.equal(response.status, status, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["code", "correlationId", "detail", "status"]);
  assert.deepEqual({ code: body.code, status: body.status, detail: body.detail }, { code, status, detail });
  assert.equal(typeof body.correlationId, "string");
  assert.match(body.correlationId, /^sales-route-action-[0-9a-f-]{36}$/u);
}

test("P13.4 generated transactions serialize pipeline snapshots against create, stage, and close without loser residue", { timeout: 480_000 }, async () => {
  await withGeneratedCrmBrowserFixture(async ({ origin, personas, records, pool, runDoctor, applicationOutput }) => {
    const cookie = await ownerSession(origin, personas.owner);
    const kanban = await fetch(`${origin}/sales/opportunities?mode=kanban`, { headers: { cookie } });
    assert.equal(kanban.status, 200, `${await kanban.text()}\n${applicationOutput()}`);
    assert.match(runDoctor(), /K_NEX_APPLICATION_READY/u, "generated doctor must accept the post-migration successor schema");
    const cases = [
      {
        actionId: "sales.opportunity.create", routeId: "sales.route.opportunities", nodeId: "sales-opportunities", key: "p134-overlap-create",
        opportunityId: undefined,
        input: async (pipeline, stages) => { const destination = stages.find(({ semantic }) => semantic === "qualification"); assert.ok(destination); return { name: "Must not be created", accountId: records.accountId, pipelineId: String(pipeline.id), expectedPipelineRevision: pipeline.revision, stageId: destination.stage_id, expectedStageRevision: destination.revision }; }
      },
      {
        actionId: "sales.opportunity.stage.update", routeId: "sales.route.opportunity-detail", nodeId: "sales-page-opportunity-detail-main-action-1", key: "p134-overlap-stage",
        opportunityId: records.opportunityLossId,
        input: async (pipeline, stages) => { const current = (await pool.query("select revision,stage_id from sales_opportunities where id=$1", [records.opportunityLossId])).rows[0]; const source = stages.find(({ stage_id }) => stage_id === current.stage_id); const destination = stages.find(({ semantic }) => semantic === "discovery"); assert.ok(source && destination); return { id: String(records.opportunityLossId), expectedRevision: current.revision, expectedPipelineId: String(pipeline.id), expectedPipelineRevision: pipeline.revision, expectedSourceStageId: source.stage_id, expectedSourceStageRevision: source.revision, destinationStageId: destination.stage_id, expectedDestinationStageRevision: destination.revision }; }
      },
      {
        actionId: "sales.opportunity.close", routeId: "sales.route.opportunity-detail", nodeId: "sales-page-opportunity-detail-main-action-2", key: "p134-overlap-close",
        opportunityId: records.opportunityWinId,
        input: async (pipeline, stages) => { const current = (await pool.query("select revision,stage_id from sales_opportunities where id=$1", [records.opportunityWinId])).rows[0]; const source = stages.find(({ stage_id }) => stage_id === current.stage_id); const destination = stages.find(({ semantic }) => semantic === "won"); assert.ok(source && destination); return { id: String(records.opportunityWinId), expectedRevision: current.revision, expectedPipelineId: String(pipeline.id), expectedPipelineRevision: pipeline.revision, expectedSourceStageId: source.stage_id, expectedSourceStageRevision: source.revision, destinationStageId: destination.stage_id, expectedDestinationStageRevision: destination.revision }; }
      }
    ];

    for (const [index, candidate] of cases.entries()) {
      const snapshot = await pipelineSnapshot(pool, records.pipelineId, `Serialized pipeline ${index + 1}`);
      const loserInput = await candidate.input(snapshot.pipeline, snapshot.stages);
      const before = await loserEvidence(pool, candidate.actionId, candidate.key, candidate.opportunityId);
      const blocker = await pool.connect();
      try {
        await blocker.query("begin");
        await blocker.query("lock table sales_action_idempotency in access exclusive mode");
        const blockerPid = (await blocker.query("select pg_backend_pid() as pid")).rows[0].pid;
        const winner = action(origin, cookie, "sales.pipeline.update", "sales.route.pipeline-settings", "pipeline-update", snapshot.input, `p134-overlap-pipeline-${index + 1}`);
        await waitForBlockedRequests(pool, 1, blockerPid);
        const loser = action(origin, cookie, candidate.actionId, candidate.routeId, candidate.nodeId, loserInput, candidate.key);
        await waitForBlockedRequests(pool, 2);
        await blocker.query("rollback");
        const [winnerResponse, loserResponse] = await Promise.all([winner, loser]);
        assert.equal(winnerResponse.status, 200, `${await winnerResponse.clone().text()}\n${applicationOutput()}`);
        assert.equal(loserResponse.status, 409, await loserResponse.clone().text());
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
      const after = await loserEvidence(pool, candidate.actionId, candidate.key, candidate.opportunityId);
      assert.deepEqual(after, before, `${candidate.actionId} loser must leave row, audit, outbox, and idempotency unchanged`);
      assert.deepEqual((await pool.query("select revision from sales_pipelines where id=$1", [records.pipelineId])).rows, [{ revision: snapshot.pipeline.revision + 1 }]);
      const winnerStages = (await pool.query("select stage_id,revision,audit from sales_pipeline_stages where pipeline_id=$1 order by position", [records.pipelineId])).rows;
      assert.equal(winnerStages.length, 6, "the committed update must retain one coherent six-stage snapshot");
      let winnerAuditKey; let winnerActorId;
      for (const winnerStage of winnerStages) {
        const prior = snapshot.stages.find(({ stage_id }) => stage_id === winnerStage.stage_id); assert.ok(prior);
        assert.equal(winnerStage.revision, prior.revision + 1);
        assert.deepEqual(winnerStage.audit.slice(0, -1), prior.audit, "winner must preserve the exact Stage history prefix");
        const entry = winnerStage.audit.at(-1);
        assert.deepEqual(Object.keys(entry).sort(), ["actionId", "actorId", "applicationId", "environment", "fromState", "idempotencyKey", "occurredAt", "resourceId", "revision", "toState"]);
        assert.deepEqual({ actionId: entry.actionId, resourceId: entry.resourceId, applicationId: entry.applicationId, environment: entry.environment, fromState: entry.fromState, toState: entry.toState, revision: entry.revision }, { actionId: "sales.pipeline.update", resourceId: winnerStage.stage_id, applicationId: "p13-crm-browser", environment: "test", fromState: "active", toState: "active", revision: winnerStage.revision });
        assert.match(entry.idempotencyKey, /^sales-action-[0-9a-f]{64}$/u); winnerAuditKey ??= entry.idempotencyKey; assert.equal(entry.idempotencyKey, winnerAuditKey);
        assert.equal(typeof entry.actorId, "string"); winnerActorId ??= entry.actorId; assert.equal(entry.actorId, winnerActorId); assert.match(entry.occurredAt, /^\d{4}-\d{2}-\d{2}T/u);
      }
    }

    // Route-private semantic inputs retain their digest, but a replay must still
    // pass current target, scope, authority, and registered output validation.
    const representativeCookie = await ownerSession(origin, personas.representative);
    const representativeStage = (await pool.query("select revision from sales_opportunities where id=$1", [records.repOpportunityId])).rows[0];
    const representativeInput = { id: records.repOpportunityId, expectedRevision: representativeStage.revision, stage: "discovery" };
    const representativeKey = "p134-route-private-replay";
    const representativeResponse = await action(origin, representativeCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", representativeInput, representativeKey);
    assert.equal(representativeResponse.status, 200, await representativeResponse.clone().text());
    const representativeBody = await representativeResponse.json();
    assert.deepEqual(Object.keys(representativeBody.data).sort(), ["id", "pipelineId", "revision", "stageId"]);
    const replayBefore = await routeEvidence(pool, "sales.opportunity.stage.update", representativeKey, records.repOpportunityId);
    const replayResponse = await action(origin, representativeCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", representativeInput, representativeKey);
    assert.equal(replayResponse.status, 200, await replayResponse.clone().text());
    assert.deepEqual(await replayResponse.json(), representativeBody, "exact private intent replay must return the registered canonical output without another effect");
    assert.deepEqual(await routeEvidence(pool, "sales.opportunity.stage.update", representativeKey, records.repOpportunityId), replayBefore, "exact private replay adds no audit, outbox, revision, or idempotency effect");

    const changedIntent = await action(origin, representativeCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", { ...representativeInput, stage: "proposal" }, representativeKey);
    await canonicalActionProblem(changedIntent, 409, "IDEMPOTENCY_CONFLICT", "Sales action idempotency key was reused for different input.");
    assert.deepEqual(await routeEvidence(pool, "sales.opportunity.stage.update", representativeKey, records.repOpportunityId), replayBefore, "changed private bytes conflict without a second effect");

    const staleKey = "p134-route-private-stale";
    const stale = await action(origin, representativeCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", representativeInput, staleKey);
    assert.equal(stale.status, 409, await stale.clone().text());
    assert.equal((await routeEvidence(pool, "sales.opportunity.stage.update", staleKey, records.repOpportunityId)).idempotency_count, 0, "stale private resolution rolls back its pending reservation");

    const managerCookie = await ownerSession(origin, personas.manager);
    const managerStage = (await pool.query("select revision from sales_opportunities where id=$1", [records.repOpportunityId])).rows[0];
    const managerInput = { id: records.repOpportunityId, expectedRevision: managerStage.revision, stage: "proposal" };
    const managerKey = "p134-route-private-owner-scope";
    const managerResponse = await action(origin, managerCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", managerInput, managerKey);
    assert.equal(managerResponse.status, 200, await managerResponse.clone().text());
    const ownerId = String((await pool.query("select id from users where email=$1", [personas.owner.email])).rows[0]?.id); assert.notEqual(ownerId, "undefined");
    await pool.query("update sales_opportunities set owner_id=$2,team_id=$3,updated_by=$2 where id=$1", [records.repOpportunityId, ownerId, `team:${ownerId}`]);
    const scopeBefore = await routeEvidence(pool, "sales.opportunity.stage.update", managerKey, records.repOpportunityId);
    const scopeDenied = await action(origin, managerCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", managerInput, managerKey);
    await canonicalActionProblem(scopeDenied, 403, "ACTION_FORBIDDEN", "Sales action target is unavailable.");
    assert.deepEqual(await routeEvidence(pool, "sales.opportunity.stage.update", managerKey, records.repOpportunityId), scopeBefore, "owner/scope change denies completed private replay without durable delta");

    const malformedStage = (await pool.query("select revision from sales_opportunities where id=$1", [records.opportunityLossId])).rows[0];
    const malformedInput = { id: records.opportunityLossId, expectedRevision: malformedStage.revision, stage: "discovery" };
    const malformedKey = "p134-route-private-malformed";
    const ownerCookie = await ownerSession(origin, personas.owner);
    const malformedSuccess = await action(origin, ownerCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", malformedInput, malformedKey);
    assert.equal(malformedSuccess.status, 200, await malformedSuccess.clone().text());
    const malformedResult = { state: "succeeded", data: { id: records.opportunityLossId } };
    await pool.query("update sales_action_idempotency set result_json=$1::jsonb,result_digest=$2 where action_id='sales.opportunity.stage.update' and idempotency_key=$3", [JSON.stringify(malformedResult), resultDigest(malformedResult), malformedKey]);
    const malformedBefore = await routeEvidence(pool, "sales.opportunity.stage.update", malformedKey, records.opportunityLossId);
    const malformedReplay = await action(origin, ownerCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", malformedInput, malformedKey);
    assert.equal(malformedReplay.status, 403, await malformedReplay.clone().text());
    assert.equal((await malformedReplay.json()).code, "ACTION_FORBIDDEN");
    assert.deepEqual(await routeEvidence(pool, "sales.opportunity.stage.update", malformedKey, records.opportunityLossId), malformedBefore, "malformed stored replay is rejected through the registered output schema without a leak or effect");

    // The route adapter locks the graph before the target, matching canonical
    // Stage actions. The canonical winner changes the target revision; the
    // private loser must roll back its reservation instead of deadlocking.
    const overlapSnapshot = await pipelineSnapshot(pool, records.pipelineId, "P13.4 route/private overlap");
    const overlapCurrent = (await pool.query("select revision,stage_id,audit from sales_opportunities where id=$1", [records.opportunityArchiveId])).rows[0];
    const overlapSource = overlapSnapshot.stages.find(({ stage_id }) => stage_id === overlapCurrent.stage_id);
    const overlapDestination = overlapSnapshot.stages.find(({ semantic }) => semantic === "discovery");
    assert.ok(overlapSource && overlapDestination);
    const canonicalOverlapInput = {
      id: String(records.opportunityArchiveId), expectedRevision: overlapCurrent.revision,
      expectedPipelineId: String(overlapSnapshot.pipeline.id), expectedPipelineRevision: overlapSnapshot.pipeline.revision,
      expectedSourceStageId: overlapSource.stage_id, expectedSourceStageRevision: overlapSource.revision,
      destinationStageId: overlapDestination.stage_id, expectedDestinationStageRevision: overlapDestination.revision
    };
    const privateOverlapKey = "p134-route-private-overlap";
    const privateOverlapInput = { id: records.opportunityArchiveId, expectedRevision: overlapCurrent.revision, stage: "lost", lossReason: "Route overlap stale loser" };
    const overlapOutboxBefore = (await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.opportunity.stage.update'")).rows[0].count;
    const overlapBlocker = await pool.connect();
    try {
      await overlapBlocker.query("begin");
      await overlapBlocker.query("lock table sales_action_idempotency in access exclusive mode");
      const overlapBlockerPid = (await overlapBlocker.query("select pg_backend_pid() as pid")).rows[0].pid;
      const canonicalWinner = action(origin, ownerCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", canonicalOverlapInput, "p134-canonical-overlap-winner");
      await waitForBlockedRequests(pool, 1, overlapBlockerPid);
      const privateLoser = action(origin, ownerCookie, "sales.opportunity.close", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-2", privateOverlapInput, privateOverlapKey);
      await waitForBlockedRequests(pool, 2);
      await overlapBlocker.query("rollback");
      const [winnerResponse, loserResponse] = await Promise.all([canonicalWinner, privateLoser]);
      const [winnerText, loserText] = await Promise.all([winnerResponse.clone().text(), loserResponse.clone().text()]);
      assert.equal(winnerResponse.status, 200, winnerText);
      assert.equal(loserResponse.status, 409, loserText);
      assert.doesNotMatch(`${winnerText}\n${loserText}`, /40P01|deadlock detected/iu, "route/private overlap must complete without a PostgreSQL deadlock");
    } finally {
      await overlapBlocker.query("rollback").catch(() => undefined);
      overlapBlocker.release();
    }
    const overlapAfter = (await pool.query("select revision,stage_id,audit from sales_opportunities where id=$1", [records.opportunityArchiveId])).rows[0];
    assert.equal(overlapAfter.revision, overlapCurrent.revision + 1, "canonical action is the sole deterministic winner");
    assert.equal(overlapAfter.stage_id, overlapDestination.stage_id);
    assert.deepEqual(overlapAfter.audit.slice(0, -1), overlapCurrent.audit, "loser cannot append an audit record");
    assert.equal(overlapAfter.audit.at(-1)?.actionId, "sales.opportunity.stage.update");
    assert.equal((await pool.query("select count(*)::int count from k_nex_outbox where payload->>'actionId'='sales.opportunity.stage.update'")).rows[0].count, overlapOutboxBefore + 1, "only canonical winner emits an outbox record");
    assert.equal((await routeEvidence(pool, "sales.opportunity.close", privateOverlapKey, records.opportunityArchiveId)).idempotency_count, 0, "private loser leaves no pending idempotency row");

    const resolverFailureKey = "p134-route-private-resolver-failure";
    const resolverCurrent = (await pool.query("select revision from sales_opportunities where id=$1", [records.opportunityWinId])).rows[0];
    await pool.query("update sales_opportunities set archive_status='archived' where id=$1", [records.opportunityWinId]);
    const resolverFailure = await action(origin, ownerCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", { id: records.opportunityWinId, expectedRevision: resolverCurrent.revision, stage: "discovery" }, resolverFailureKey);
    await canonicalActionProblem(resolverFailure, 409, "STALE_RECORD", "Sales opportunity or pipeline changed before route action.");
    assert.equal((await routeEvidence(pool, "sales.opportunity.stage.update", resolverFailureKey, records.opportunityWinId)).idempotency_count, 0, "resolver denial never leaves an idempotency reservation");

    // Permission revocation plus the current authority revision must deny a
    // previously completed private replay before its stored result is exposed.
    const authorizationBefore = await routeEvidence(pool, "sales.opportunity.stage.update", representativeKey, records.repOpportunityId);
    await pool.query("delete from k_nex_role_permission_grants where application_id='p13-crm-browser' and role_id='p13.crm.representative' and permission_id='sales.opportunities.stage.update'");
    await pool.query("update k_nex_authorization_state set authorization_revision=authorization_revision+1 where application_id='p13-crm-browser'");
    const authorizationDenied = await action(origin, representativeCookie, "sales.opportunity.stage.update", "sales.route.opportunity-detail", "sales-page-opportunity-detail-main-action-1", representativeInput, representativeKey);
    await canonicalActionProblem(authorizationDenied, 403, "ACTION_FORBIDDEN", "Current authority does not permit this action.");
    assert.deepEqual(await routeEvidence(pool, "sales.opportunity.stage.update", representativeKey, records.repOpportunityId), authorizationBefore, "permission/auth-revision change denies replay without a target, audit, outbox, or idempotency delta");
  });
});
