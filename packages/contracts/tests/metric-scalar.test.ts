import { describe, expect, it } from "vitest";

import { MetricIntegerValueSchema, MetricScalarSchema, MetricScalarValueSchema } from "../src/metric-scalar.js";

const validValues = [
  { kind: "integer", value: 12 },
  { kind: "number", value: 12.5 },
  { kind: "decimal", value: "12.50", scale: 2, unit: "items", rounding: "half-up" },
  { kind: "money", value: "-12.50", currency: "USD", scale: 2, rounding: "half-even" },
  { kind: "percentage", value: "-0.125" },
  { kind: "duration", value: "1.5", unit: "hours" },
  { kind: "text", value: "Open" }
] as const;

describe("metric.scalar@1", () => {
  it.each(validValues)("accepts the $kind scalar discriminant", (value) => {
    expect(MetricScalarValueSchema.safeParse(value).success).toBe(true);
  });

  it("accepts only safe integers", () => {
    expect(MetricIntegerValueSchema.safeParse({ kind: "integer", value: 12 }).success).toBe(true);
    expect(MetricIntegerValueSchema.safeParse({ kind: "integer", value: 12.5 }).success).toBe(false);
    expect(MetricIntegerValueSchema.safeParse({ kind: "integer", value: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    expect(MetricIntegerValueSchema.safeParse({ kind: "integer", value: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(MetricIntegerValueSchema.safeParse({ kind: "integer", value: Number.MIN_SAFE_INTEGER - 1 }).success).toBe(false);
  });

  it("accepts canonical decimal strings, including negative fractions", () => {
    for (const value of ["0", "12", "12.50", "-0.5", "-12.50"]) {
      expect(MetricScalarValueSchema.safeParse({ kind: "decimal", value, scale: 2 }).success).toBe(true);
    }
  });

  it("rejects non-canonical decimal strings", () => {
    for (const value of ["01", "-01.5", "+1.5", "1e3", "1E3", ".5", "-.5"]) {
      expect(MetricScalarValueSchema.safeParse({ kind: "decimal", value, scale: 2 }).success).toBe(false);
    }
  });

  it("requires bounded money metadata", () => {
    expect(MetricScalarValueSchema.safeParse({ kind: "money", value: "10.00", currency: "USD", scale: 2 }).success).toBe(true);
    expect(MetricScalarValueSchema.safeParse({ kind: "money", value: "10.00", currency: "usd", scale: 2 }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "money", value: "10.00", currency: "US", scale: 2 }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "money", value: "10.00", currency: "USDD", scale: 2 }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "money", value: "10.00", currency: "USD", scale: -1 }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "money", value: "10.00", currency: "USD", scale: 19 }).success).toBe(false);
  });

  it("bounds decimal, unit, and text strings", () => {
    expect(MetricScalarValueSchema.safeParse({ kind: "decimal", value: `1${"0".repeat(128)}`, scale: 2 }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "decimal", value: "1", scale: 2, unit: "u".repeat(33) }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "text", value: "x".repeat(513) }).success).toBe(false);
  });

  it.each(["positive", "neutral", "negative"])("accepts explicit %s comparison sentiment", (sentiment) => {
    expect(MetricScalarSchema.safeParse({
      value: { kind: "money", value: "10.00", currency: "USD", scale: 2 },
      comparison: { value: { kind: "money", value: "-1.00", currency: "USD", scale: 2 }, sentiment }
    }).success).toBe(true);
  });

  it("rejects a missing or unknown comparison sentiment", () => {
    const metric = {
      value: { kind: "money", value: "10.00", currency: "USD", scale: 2 },
      comparison: { value: { kind: "money", value: "-1.00", currency: "USD", scale: 2 } }
    };
    expect(MetricScalarSchema.safeParse(metric).success).toBe(false);
    expect(MetricScalarSchema.safeParse({ ...metric, comparison: { ...metric.comparison, sentiment: "up" } }).success).toBe(false);
  });

  it("rejects comparisons with incompatible kinds, currencies, or units", () => {
    const metric = {
      value: { kind: "money", value: "10.00", currency: "USD", scale: 2 },
      comparison: { value: { kind: "money", value: "1.00", currency: "EUR", scale: 2 }, sentiment: "positive" as const }
    };
    expect(MetricScalarSchema.safeParse(metric).success).toBe(false);
    expect(MetricScalarSchema.safeParse({
      ...metric,
      comparison: { value: { kind: "number", value: 1 }, sentiment: "positive" as const }
    }).success).toBe(false);
    expect(MetricScalarSchema.safeParse({
      value: { kind: "duration", value: "1", unit: "hours" },
      comparison: { value: { kind: "duration", value: "60", unit: "minutes" }, sentiment: "positive" as const }
    }).success).toBe(false);
    expect(MetricScalarSchema.safeParse({
      value: { kind: "decimal", value: "1", scale: 0 },
      comparison: { value: { kind: "decimal", value: "1", scale: 0, unit: "items" }, sentiment: "positive" as const }
    }).success).toBe(false);
  });

  it("rejects unknown keys, URLs, code, and extension bags", () => {
    expect(MetricScalarSchema.safeParse({ value: { kind: "text", value: "Open" }, extensions: {} }).success).toBe(false);
    expect(MetricScalarSchema.safeParse({ value: { kind: "text", value: "Open", url: "https://example.test" } }).success).toBe(false);
    expect(MetricScalarSchema.safeParse({ value: { kind: "text", value: "Open", code: "alert(1)" } }).success).toBe(false);
    expect(MetricScalarValueSchema.safeParse({ kind: "decimal", value: "1.5", scale: 2, unit: "https://example.test" }).success).toBe(false);
  });
});
