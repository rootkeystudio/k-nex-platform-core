import { describe, expect, it } from "vitest";

import { DataSourceQueryControlsSchema } from "../src/data-source-query.js";

describe("data-source query controls", () => {
  it("parses bounded page, filter, and sort controls", () => {
    expect(DataSourceQueryControlsSchema.parse({
      page: { number: 2, size: 25 },
      filters: [
        { field: "status", operator: "in", value: ["open", "blocked"] },
        { field: "closed-at", operator: "is-null" }
      ],
      sort: [{ field: "created-at", direction: "desc" }]
    })).toEqual({
      page: { number: 2, size: 25 },
      filters: [
        { field: "status", operator: "in", value: ["open", "blocked"] },
        { field: "closed-at", operator: "is-null" }
      ],
      sort: [{ field: "created-at", direction: "desc" }]
    });
  });

  it("defaults omitted filter and sort collections", () => {
    expect(DataSourceQueryControlsSchema.parse({})).toEqual({ filters: [], sort: [] });
  });

  it("accepts one bounded opaque cursor mode", () => {
    expect(DataSourceQueryControlsSchema.parse({ cursor: { after: "opaque-next", size: 50 } })).toEqual({ cursor: { after: "opaque-next", size: 50 }, filters: [], sort: [] });
    expect(DataSourceQueryControlsSchema.safeParse({ page: { number: 1, size: 25 }, cursor: { size: 25 } }).success).toBe(false);
    expect(DataSourceQueryControlsSchema.safeParse({ cursor: { after: "a", before: "b", size: 25 } }).success).toBe(false);
  });

  it.each([
    { filters: [{ field: "status", operator: "eq" }] },
    { filters: [{ field: "status", operator: "is-null", value: null }] },
    { filters: [{ field: "status", operator: "eq", value: { raw: true } }] },
    { page: { number: 0, size: 10 } },
    { page: { number: 1, size: 101 } },
    { cursor: { after: "a", size: 101 } },
    { sort: [{ field: "status", direction: "sideways" }] },
    { batch: [{ page: { number: 1, size: 10 } }] },
    { queries: [] },
    { path: "payload.collections.sales" }
  ])("rejects invalid or undeclared query syntax %#", (value) => {
    expect(DataSourceQueryControlsSchema.safeParse(value).success).toBe(false);
  });
});
