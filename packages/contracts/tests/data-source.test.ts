import * as z from "zod";
import { describe, expect, it } from "vitest";

import {
  assertDataSourceDefinition,
  DataSourceDescriptorSchema,
  isDataSourceDefinition,
  MetricScalarSchema,
  TableRecordsSchema
} from "../src/index.js";

const limits = {
  maxSelectedFields: 16,
  maxPageSize: 50,
  maxFilters: 8,
  maxSorts: 2,
  maxBodyBytes: 16_384,
  maxResultBytes: 262_144,
  maxDepth: 4,
  timeoutMs: 2_000,
  maxConcurrency: 4,
  ratePerMinute: 120,
  burst: 20,
  costClass: "low",
  maxCost: 100
} as const;

const metricDescriptor = {
  id: "sales.total-potential-revenue",
  version: 3,
  ownerPluginId: "module.sales",
  primaryContract: { id: "metric.scalar", version: 1 },
  sourceSchema: { id: "sales.total-potential-revenue.output", version: 2 },
  audience: "authenticated",
  surfaces: ["workspace"],
  permission: "sales.revenue.read",
  structuralCompatibilityHash: `sha256:${"a".repeat(64)}`,
  presentationMetadataRevision: 4,
  title: "Total potential revenue",
  inputFields: [],
  limits,
  cacheClass: "actor"
} as const;

const taskField = {
  id: "title",
  kind: "text",
  binding: "required",
  nullable: false,
  permission: "sales.tasks.title.read",
  sortable: true,
  filterOperators: ["eq", "contains"]
} as const;

const tableDescriptor = {
  ...metricDescriptor,
  id: "sales.tasks",
  version: 1,
  primaryContract: { id: "table.records", version: 1 },
  sourceSchema: { id: "sales.tasks.output", version: 1 },
  permission: "sales.tasks.read",
  title: "Sales tasks",
  inputFields: [{ id: "status", kind: "enum", required: false, nullable: false }],
  outputFields: [taskField]
} as const;

describe("P2.2 data-source contracts", () => {
  it("keeps source, source-schema, and output-contract versions independent", () => {
    const result = DataSourceDescriptorSchema.safeParse(metricDescriptor);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(3);
      expect(result.data.sourceSchema.version).toBe(2);
      expect(result.data.primaryContract.version).toBe(1);
    }
  });

  it("accepts declared table field semantics and bounded operations", () => {
    expect(DataSourceDescriptorSchema.safeParse(tableDescriptor).success).toBe(true);
  });

  it("enforces one primary projection shape", () => {
    expect(DataSourceDescriptorSchema.safeParse({ ...metricDescriptor, outputFields: [taskField] }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...tableDescriptor, outputFields: [] }).success).toBe(false);
  });

  it("rejects duplicate or storage-shaped field identities", () => {
    expect(DataSourceDescriptorSchema.safeParse({ ...tableDescriptor, outputFields: [taskField, taskField] }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...tableDescriptor, outputFields: [{ ...taskField, id: "customer.name" }] }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...tableDescriptor, inputFields: [tableDescriptor.inputFields[0], tableDescriptor.inputFields[0]] }).success).toBe(false);
  });

  it("separates public and authenticated source policy", () => {
    const publicSource = { ...metricDescriptor, audience: "public", surfaces: ["public"], cacheClass: "public" };
    expect(DataSourceDescriptorSchema.safeParse(publicSource).success).toBe(true);
    expect(DataSourceDescriptorSchema.safeParse({ ...publicSource, surfaces: ["workspace"] }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...publicSource, cacheClass: "actor" }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...metricDescriptor, surfaces: ["public"] }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...metricDescriptor, cacheClass: "public" }).success).toBe(false);
  });

  it("enforces platform ceilings and known contract majors", () => {
    for (const raised of [
      { maxPageSize: 101 },
      { maxDepth: 9 },
      { maxConcurrency: 65 },
      { ratePerMinute: 601 },
      { burst: 61 },
      { maxCost: 1_001 }
    ]) {
      expect(DataSourceDescriptorSchema.safeParse({ ...tableDescriptor, limits: { ...limits, ...raised } }).success).toBe(false);
    }
    expect(DataSourceDescriptorSchema.safeParse({ ...tableDescriptor, limits: { ...limits, costClass: "unbounded" } }).success).toBe(false);
    expect(DataSourceDescriptorSchema.safeParse({ ...metricDescriptor, primaryContract: { id: "metric.scalar", version: 2 } }).success).toBe(false);
  });

  it("rejects unknown, executable, URL, and query metadata", () => {
    for (const extra of [
      { extensions: {} },
      { endpoint: "https://example.test" },
      { sql: "select *" },
      { code: "return records" },
      { query: { collection: "sales-tasks" } }
    ]) {
      expect(DataSourceDescriptorSchema.safeParse({ ...metricDescriptor, ...extra }).success).toBe(false);
    }
  });

  it("requires exact definition keys and executable schemas", () => {
    const definition = { descriptor: metricDescriptor, inputSchema: z.strictObject({}), outputSchema: MetricScalarSchema };
    expect(isDataSourceDefinition(definition)).toBe(true);
    expect(() => assertDataSourceDefinition(definition)).not.toThrow();
    expect(isDataSourceDefinition({ ...definition, extra: true })).toBe(false);
    expect(isDataSourceDefinition({ ...definition, outputSchema: {} })).toBe(false);

    const tableDefinition = { descriptor: tableDescriptor, inputSchema: z.strictObject({}), outputSchema: TableRecordsSchema };
    expect(() => assertDataSourceDefinition(tableDefinition)).not.toThrow();
  });
});
