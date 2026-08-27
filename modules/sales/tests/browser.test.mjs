import assert from "node:assert/strict";
import test from "node:test";

import {
  salesCreateTaskMutation,
  salesOpportunitiesQuery,
  salesOpportunityStageMutation,
  salesTasksQuery,
  salesTotalPotentialRevenueQuery,
  salesUpdateTaskMutation,
  salesWorkspacePresentation
} from "../dist/browser.js";

const signal = new AbortController().signal;
const context = {
  surface: "workspace",
  authorizationBoundary: { kind: "actor", actorFingerprint: `sha256:${"a".repeat(64)}` },
  signal
};

test("Sales browser factories use stable platform query/action metadata", async () => {
  assert.deepEqual(salesTasksQuery.source, { id: "sales.tasks", version: 1 });
  assert.deepEqual(salesTasksQuery.selectedFields, ["title", "status", "potential-revenue"]);
  assert.deepEqual(salesTotalPotentialRevenueQuery.invalidation.sources, ["sales.total-potential-revenue"]);
  assert.deepEqual(salesCreateTaskMutation.invalidation.sources, ["sales.tasks", "sales.total-potential-revenue"]);
  assert.deepEqual(salesOpportunitiesQuery.source, { id: "sales.opportunities", version: 1 });
  assert.deepEqual(salesOpportunityStageMutation.invalidation.sources, ["sales.opportunities"]);
  assert.deepEqual(salesUpdateTaskMutation.invalidation.sources, ["sales.tasks", "sales.total-potential-revenue"]);

  const identity = await salesTasksQuery.identity({}, context);
  assert.match(identity.key, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(identity).includes("actorFingerprint"), true);
});

test("Sales workspace settings drive default routing and source presentation", () => {
  assert.deepEqual(salesWorkspacePresentation({
    defaultTaskPageSize: 50,
    showPotentialRevenue: false,
    defaultPage: "opportunities",
    pipelineStages: ["lead", "qualified", "won", "lost"]
  }), {
    routeId: "sales.route.opportunities",
    taskPageSize: 50,
    showPotentialRevenue: false,
    pipelineStages: ["lead", "qualified", "won", "lost"]
  });
});

test("Sales browser factories execute only through injected platform transport", async () => {
  const calls = [];
  const transport = {
    async query(request) {
      calls.push(["query", request.source.id]);
      return { ok: true, data: { fields: ["title", "status", "potential-revenue"], rows: [], page: { number: 1, pageSize: 25, hasNext: false } } };
    },
    async mutate(request) {
      calls.push(["mutate", request.action.id]);
      return { ok: true, data: { id: "task-1", title: request.input.title, status: "open" } };
    }
  };
  assert.deepEqual(await salesTasksQuery.execute(transport, {}, context), { state: "empty" });
  assert.deepEqual(await salesCreateTaskMutation.execute(transport, { title: "Follow up" }, { signal, idempotencyKey: "task-1" }), {
    state: "success",
    data: { id: "task-1", title: "Follow up", status: "open" }
  });
  assert.deepEqual(calls, [["query", "sales.tasks"], ["mutate", "sales.task.create"]]);
});
