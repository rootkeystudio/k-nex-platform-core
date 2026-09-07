import assert from "node:assert/strict";
import test from "node:test";

import { withGeneratedCrmBrowserFixture } from "./p13-3-generated-crm-fixture.mjs";

async function ownerSession(origin, persona) {
  const response = await fetch(`${origin}/api/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: persona.email, password: persona.password }) });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); return cookie;
}

function action(origin, cookie, actionId, routeId, nodeId, input, idempotencyKey) {
  return fetch(`${origin}/api/k-nex/sales/actions/${actionId}`, { method: "POST", headers: { "content-type": "application/json", cookie, origin }, body: JSON.stringify({ routeId, nodeId, selection: {}, input, idempotencyKey }) });
}

async function waitForBlockedRequests(pool, minimum) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = (await pool.query("select count(*)::int count from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).rows[0];
    if (row.count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${minimum} generated Sales requests to be blocked on transaction locks.`);
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
        const winner = action(origin, cookie, "sales.pipeline.update", "sales.route.pipeline-settings", "pipeline-update", snapshot.input, `p134-overlap-pipeline-${index + 1}`);
        await waitForBlockedRequests(pool, 1);
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
  });
});
