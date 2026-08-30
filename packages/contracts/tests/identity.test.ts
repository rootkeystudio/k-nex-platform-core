import { describe, expect, it } from "vitest";

import { ExactSemverSchema, compareExactSemverPrecedence } from "../src/identity.js";

describe("exact SemVer precedence", () => {
  it("ignores build metadata and returns equality for identical release precedence", () => {
    expect(compareExactSemverPrecedence("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(compareExactSemverPrecedence("1.0.0", "1.0.0")).toBe(0);
  });

  it("orders prereleases without losing precision for numeric identifiers", () => {
    expect(compareExactSemverPrecedence("1.0.0-9007199254740992", "1.0.0-9007199254740993")).toBe(-1);
    expect(compareExactSemverPrecedence("1.0.0-alpha-beta", "1.0.0-alpha-gamma")).toBe(-1);
    expect(compareExactSemverPrecedence("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareExactSemverPrecedence("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareExactSemverPrecedence("1.0.0-rc.1", "1.0.0")).toBe(-1);
  });

  it("uses the existing exact-version grammar as its input boundary", () => {
    expect(ExactSemverSchema.safeParse("1.0.0-9007199254740993+build.2").success).toBe(true);
    expect(() => compareExactSemverPrecedence("1.0", "1.0.0")).toThrow(/invalid/u);
  });
});
