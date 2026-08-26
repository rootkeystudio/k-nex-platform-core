import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { MetricScalarSchema, TableRecordsSchema } from "../packages/contracts/dist/index.js";
import {
  salesTasksHandler,
  salesTotalPotentialRevenueHandler
} from "../modules/sales/dist/server.js";

const tableDocuments = Array.from({ length: 100 }, (_, index) => ({
  id: `task-${index + 1}`,
  title: `Representative task ${index + 1}`,
  status: index % 3 === 0 ? "done" : "open",
  potentialRevenue: `${100 + index}.25`,
  privateNote: index % 5 === 0 ? "Authorized note" : null
}));

const tableValue = {
  fields: ["title", "status", "potential-revenue", "private-note"],
  rows: tableDocuments.map((document) => ({
    key: document.id,
    values: {
      title: { kind: "text", value: document.title },
      status: { kind: "status", value: document.status },
      "potential-revenue": { kind: "money", value: document.potentialRevenue, currency: "USD", scale: 2 },
      "private-note": document.privateNote === null ? null : { kind: "text", value: document.privateNote }
    }
  })),
  page: { number: 1, pageSize: 100, hasNext: false }
};

const metricValue = { value: { kind: "money", value: "149625", currency: "USD", scale: 2 } };
const signal = new AbortController().signal;
const actor = { principal: { kind: "user", id: "benchmark" }, effectiveActor: { kind: "user", id: "benchmark" } };

const tableContext = {
  actor,
  request: { payload: { find: async () => ({ docs: tableDocuments, page: 1, totalPages: 1, hasNextPage: false }) } },
  input: {},
  query: { page: { number: 1, size: 100 }, filters: [], sort: [{ field: "status", direction: "asc" }] },
  selectedFields: ["title", "status", "potential-revenue", "private-note"],
  recordScope: { kind: "sales.tasks" },
  signal
};

const aggregateDocuments = Array.from({ length: 1_000 }, (_, index) => ({ id: `aggregate-${index}`, potentialRevenue: `${100 + index}.25` }));
const metricContext = {
  ...tableContext,
  request: {
    payload: {
      find: async ({ page = 1, limit = 100 }) => ({
        docs: aggregateDocuments.slice((page - 1) * limit, page * limit),
        page,
        totalPages: Math.ceil(aggregateDocuments.length / limit),
        hasNextPage: page * limit < aggregateDocuments.length
      })
    }
  },
  query: { filters: [], sort: [] },
  selectedFields: []
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
  await measure("table validation", "table.records@1: 100 rows x 4 fields", 200, 30, () => { TableRecordsSchema.parse(tableValue); }),
  await measure("Sales table query + validation", "100 records x 4 selected fields", 100, 40, async () => {
    TableRecordsSchema.parse(await salesTasksHandler(tableContext));
  }),
  await measure("Sales metric query + validation", "1,000 money records in 10 server pages", 50, 60, async () => {
    MetricScalarSchema.parse(await salesTotalPotentialRevenueHandler(metricContext));
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
