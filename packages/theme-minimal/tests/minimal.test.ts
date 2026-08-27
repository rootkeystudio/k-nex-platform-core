import { describe, expect, it } from "vitest";

import { semanticPrimitiveNames } from "@k-nex/ui-design-system-contracts";
import { minimalThemePackage, resolveMinimalThemeProfile } from "../src/index.js";

function profile(palette: "light" | "dark", mode: "light" | "dark") {
  return {
    schemaVersion: 1,
    id: "theme-profile.public-default",
    surface: "public",
    themeId: "theme.minimal",
    themeVersion: "1.0.0",
    palette,
    mode,
    values: {},
    revision: { id: `theme-revision.${mode}-1`, number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
  };
}

describe("Minimal theme", () => {
  it("implements the complete ABI and resolves deterministic namespaced CSS", () => {
    expect(Object.keys(minimalThemePackage.primitiveOverrides ?? {}).sort()).toEqual([...semanticPrimitiveNames].sort());
    const first = resolveMinimalThemeProfile(profile("light", "light"));
    const second = resolveMinimalThemeProfile(structuredClone(profile("light", "light")));
    expect(second).toEqual(first);
    expect(first.profileRevisionId).toBe("theme-revision.light-1");
    expect(first.cssVariables["--k-nex-public-color-background"]).toBe("#ffffff");
    expect(Object.keys(first.cssVariables)).toEqual([...Object.keys(first.cssVariables)].sort());
  });

  it("supports materially correct light and dark values without changing behavior", () => {
    const light = resolveMinimalThemeProfile(profile("light", "light"));
    const dark = resolveMinimalThemeProfile(profile("dark", "dark"));
    expect(dark.cssVariables["--k-nex-public-color-background"]).toBe("#15171a");
    expect(light.cssVariables["--k-nex-public-color-background"]).not.toBe(dark.cssVariables["--k-nex-public-color-background"]);
    expect(light.primitives.Button).toBe(dark.primitives.Button);
  });

  it("rejects unknown or malformed token overrides", () => {
    expect(() => resolveMinimalThemeProfile({ ...profile("light", "light"), values: { "color.unknown": "#ffffff" } })).toThrow(/schema/);
    expect(() => resolveMinimalThemeProfile({ ...profile("light", "light"), values: { "color.accent": "red" } })).toThrow(/schema/);
  });
});
