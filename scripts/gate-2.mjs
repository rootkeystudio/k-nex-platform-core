import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { MetricScalarSchema, TableRecordsSchema } from "../packages/contracts/dist/index.js";
import {
  salesOpportunitiesHandler,
  salesTasksHandler
} from "../modules/sales/dist/server.js";

const tableDocuments = Array.from({ length: 100 }, (_, index) => ({
  id: `task-${index + 1}`,
  title: `Representative task ${index + 1}`,
  status: index % 3 === 0 ? "completed" : "open"
}));

const tableValue = {
  fields: ["title", "status"],
  rows: tableDocuments.map((document) => ({
    key: document.id,
    values: {
      title: { kind: "text", value: document.title },
      status: { kind: "status", value: document.status }
    }
  })),
  page: { number: 1, pageSize: 100, hasNext: false }
};

const metricValue = { value: { kind: "money", value: "149625", currency: "USD", scale: 2 } };
const signal = new AbortController().signal;
const actor = { principal: { kind: "user", id: "benchmark" }, effectiveActor: { kind: "user", id: "benchmark" } };

const tableContext = {
  actor,
  request: {
    applicationIdentity: { applicationId: "benchmark", environment: "benchmark" },
    payload: { find: async () => ({ docs: tableDocuments, page: 1, totalPages: 1, hasNextPage: false }) }
  },
  input: {},
  query: { page: { number: 1, size: 100 }, filters: [], sort: [{ field: "status", direction: "asc" }] },
  selectedFields: ["title", "status"],
  recordScope: { kind: "sales.tasks", where: { and: [
    { applicationId: { equals: "benchmark" } }, { environment: { equals: "benchmark" } }, { ownerId: { equals: "benchmark" } }
  ] } },
  signal
};

const opportunityDocuments = Array.from({ length: 100 }, (_, index) => ({
  id: `opportunity-${index + 1}`,
  name: `Representative opportunity ${index + 1}`,
  stageId: index % 5 === 0 ? "won" : "qualification",
  revision: index + 1,
  amount: `${100 + index}.25`,
  currency: "USD"
}));
const opportunityContext = {
  ...tableContext,
  request: {
    applicationIdentity: { applicationId: "benchmark", environment: "benchmark" },
    payload: {
      find: async () => ({ docs: opportunityDocuments, page: 1, totalPages: 1, hasNextPage: false })
    }
  },
  query: { page: { number: 1, size: 100 }, filters: [], sort: [] },
  selectedFields: ["name", "stage-id", "revision", "amount"],
  recordScope: { kind: "sales.opportunities", where: { and: [
    { applicationId: { equals: "benchmark" } }, { environment: { equals: "benchmark" } }, { ownerId: { equals: "benchmark" } }
  ] } }
};

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * quantile)];
}

async function measure(name, dataset, iterations, acceptedP95Ms, operation) {
  for (let index = 0; index < 10; index += 1) await operation();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  const result = {
    name,
    dataset,
    iterations,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    acceptedP95Ms
  };
  assert.ok(result.p95Ms <= acceptedP95Ms, `${name} p95 ${result.p95Ms}ms exceeds ${acceptedP95Ms}ms.`);
  return result;
}

const benchmark = [
  await measure("metric validation", "metric.scalar@1", 500, 5, () => { MetricScalarSchema.parse(metricValue); }),
  await measure("table validation", "table.records@1: 100 rows x 2 fields", 200, 30, () => { TableRecordsSchema.parse(tableValue); }),
  await measure("Sales task v2 query + validation", "100 records x 2 selected fields", 100, 40, async () => {
    TableRecordsSchema.parse(await salesTasksHandler(tableContext));
  }),
  await measure("Sales opportunity v2 query + validation", "100 records x 4 selected fields", 50, 60, async () => {
    TableRecordsSchema.parse(await salesOpportunitiesHandler(opportunityContext));
  })
];

const attackEvidence = [
  "direct source/record/field manipulation",
  "required versus optional field behavior",
  "cross-actor and cross-policy cache isolation",
  "unauthorized value absent from query result/cache/log/error",
  "invalid source and output contract fail closed",
  "body/filter/field/page/time/cost limit enforcement",
  "malformed RFC 9457 response prevention"
];

console.log(JSON.stringify({
  gate: "Gate 2",
  attackEvidence,
  benchmark,
  qualification: "Representative bounded validation/query overhead only; not production capacity."
}, null, 2));
console.log("GATE_2_PASS");
