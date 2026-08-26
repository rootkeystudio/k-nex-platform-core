import { describe, expect, it } from "vitest";

import {
  TABLE_FIELD_LIMIT,
  TABLE_ROW_LIMIT,
  TableCellSchema,
  TableRecordsSchema,
  TableRouteSchema
} from "../src/table-records.js";

const cells = [
  { kind: "text", value: "Task" },
  { kind: "integer", value: 3 },
  { kind: "number", value: 3.14 },
  { kind: "decimal", value: "3.1400", scale: 4 },
  { kind: "money", value: "12.50", currency: "USD", scale: 2 },
  { kind: "datetime", value: "2026-08-26T12:00:00Z" },
  { kind: "date", value: "2026-08-26" },
  { kind: "boolean", value: true },
  { kind: "status", value: "open" },
  { kind: "enum", value: "high" },
  {
    kind: "resource",
    resourceType: "user",
    id: "user-1",
    label: "Ali",
    route: { routeId: "system.users.detail", params: { userId: "user-1" } }
  }
] as const;

const baseTable = {
  fields: ["title", "count", "ratio", "amount", "created-at", "due-date", "active", "state", "priority", "assignee"],
  rows: [
    {
      key: "task-1",
      values: {
        title: cells[0],
        count: cells[1],
        ratio: cells[2],
        amount: cells[3],
        "created-at": cells[5],
        "due-date": cells[6],
        active: cells[7],
        state: cells[8],
        priority: cells[9],
        assignee: cells[10]
      }
    }
  ],
  page: { number: 1, pageSize: 25, hasNext: false }
};

describe("table.records@1", () => {
  it("accepts every canonical cell kind", () => {
    expect(TableCellSchema.array().safeParse(cells).success).toBe(true);
    expect(TableRecordsSchema.safeParse(baseTable).success).toBe(true);
  });

  it("rejects dotted storage paths as field IDs", () => {
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      fields: ["customer.name"]
    }).success).toBe(false);
  });

  it("rejects row values that are not selected fields", () => {
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      fields: ["title"],
      rows: [{ key: "task-1", values: { title: cells[0], secret: cells[1] } }]
    }).success).toBe(false);
  });

  it("distinguishes permitted null values from omitted values", () => {
    const result = TableRecordsSchema.safeParse({
      fields: ["title", "assignee"],
      rows: [
        { key: "task-1", values: { title: cells[0], assignee: null } },
        { key: "task-2", values: { title: cells[0] } }
      ],
      page: { number: 1, pageSize: 25, hasNext: false }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rows[0]?.values).toHaveProperty("assignee", null);
      expect(result.data.rows[1]?.values).not.toHaveProperty("assignee");
    }
  });

  it("enforces field, row, and page-size bounds", () => {
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      fields: Array.from({ length: TABLE_FIELD_LIMIT + 1 }, (_, index) => `field-${index}`)
    }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      rows: Array.from({ length: TABLE_ROW_LIMIT + 1 }, (_, index) => ({ key: `row-${index}`, values: {} }))
    }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({ ...baseTable, page: { number: 1, pageSize: TABLE_ROW_LIMIT + 1, hasNext: false } }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({ ...baseTable, page: { number: 1, pageSize: 1, hasNext: true }, rows: [baseTable.rows[0], { key: "task-2", values: {} }] }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({ ...baseTable, fields: [] }).success).toBe(false);
  });

  it("rejects duplicate selected field IDs and row keys", () => {
    expect(TableRecordsSchema.safeParse({ ...baseTable, fields: ["title", "title"] }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      rows: [baseTable.rows[0], { ...baseTable.rows[0], values: {} }]
    }).success).toBe(false);
  });

  it("accepts registered route references with bounded string parameters", () => {
    expect(TableRouteSchema.safeParse({
      routeId: "system.users.detail",
      params: { userId: "user-1" }
    }).success).toBe(true);
    expect(TableRouteSchema.safeParse({
      routeId: "https://example.com/user-1",
      params: {}
    }).success).toBe(false);
  });

  it("rejects unknown keys and forbidden URL/code/SQL/extension data", () => {
    expect(TableRecordsSchema.safeParse({ ...baseTable, extensions: {} }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({ ...baseTable, code: "return data" }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({ ...baseTable, sql: "select *" }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      rows: [{
        ...baseTable.rows[0],
        values: {
          assignee: {
            ...cells[10],
            href: "https://example.com/user-1"
          }
        }
      }]
    }).success).toBe(false);
    expect(TableRecordsSchema.safeParse({
      ...baseTable,
      rows: [{ ...baseTable.rows[0], metadata: {} }]
    }).success).toBe(false);
  });
});
