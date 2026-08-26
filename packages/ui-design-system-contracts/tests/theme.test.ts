import { describe, expect, it } from "vitest";

import { createThemePresentation, createThemeRegistry, defineThemePackage, themeRootSelector, type ThemeTokenValues } from "../src/index.js";

function tokenSchema() {
  return {
    safeParse(value: unknown) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return { success: false as const, error: "invalid" };
      const values = value as Record<string, unknown>;
      return typeof values["color.accent"] === "string" && typeof values["spacing.content"] === "number"
        ? { success: true as const, data: values as ThemeTokenValues }
        : { success: false as const, error: "invalid" };
    }
  };
}

function themePackage() {
  return {
    id: "theme.minimal",
    version: "1.0.0",
    surfaces: ["public"] as const,
    tokenSchema: tokenSchema(),
    defaults: { "color.accent": "#2457ff", "spacing.content": 16 },
    palettes: [{ id: "default", values: {} }],
    recipes: { Button: ["primary", "quiet"] },
    structuralCss: `${themeRootSelector} [data-k-nex-primitive=stack]{display:flex}`,
    migrations: []
  };
}

const profile = {
  schemaVersion: 1,
  id: "theme-profile.public-default",
  surface: "public",
  themeId: "theme.minimal",
  themeVersion: "1.0.0",
  palette: "default",
  mode: "light",
  values: {},
  revision: { id: "theme-revision.public-1", number: 1, state: "draft", createdAt: "2026-08-26T20:00:00.000Z" }
};

describe("theme package and profile registry", () => {
  it("resolves only an installed package, surface, palette, and schema-valid profile", () => {
    const registry = createThemeRegistry([defineThemePackage(themePackage())]);
    const resolved = registry.resolveProfile(profile);
    expect(resolved.values).toEqual({ "color.accent": "#2457ff", "spacing.content": 16 });
    expect(Object.isFrozen(resolved.package)).toBe(true);
    expect(() => registry.resolveProfile({ ...profile, themeId: "theme.missing" })).toThrow(/not installed/);
    expect(() => registry.resolveProfile({ ...profile, surface: "admin" })).toThrow(/surface/);
    expect(() => registry.resolveProfile({ ...profile, palette: "missing" })).toThrow(/palette/);
  });

  it("snapshots package policy before source objects can mutate", () => {
    const source = themePackage();
    const registry = createThemeRegistry([source]);
    source.defaults["color.accent"] = "#ff0000";
    source.palettes[0]!.id = "changed";
    source.recipes.Button.push("danger");
    expect(registry.resolveProfile(profile).values["color.accent"]).toBe("#2457ff");
    expect(registry.get("theme.minimal", "1.0.0")?.palettes[0]?.id).toBe("default");
    expect(registry.get("theme.minimal", "1.0.0")?.recipes.Button).toEqual(["primary", "quiet"]);
  });

  it("rejects unsafe package CSS, invalid defaults, and unknown recipes", () => {
    expect(() => defineThemePackage({ ...themePackage(), structuralCss: "@import url(https://example.com/x.css)" })).toThrow(/remote/);
    expect(() => defineThemePackage({ ...themePackage(), defaults: {} })).toThrow(/defaults/);
    expect(() => defineThemePackage({ ...themePackage(), recipes: { DataGrid: ["dense"] } as never })).toThrow(/Unknown/);
    expect(() => defineThemePackage({ ...themePackage(), structuralCss: "[data-k-nex-primitive=stack]{display:flex}" })).toThrow(/selector/);
  });

  it("replaces every structural root with the exact profile revision selector", () => {
    const presentation = createThemePresentation(createThemeRegistry([themePackage()]).resolveProfile(profile));
    expect(presentation.cssText).not.toContain(themeRootSelector);
    expect(presentation.cssText).toContain('[data-k-nex-theme-profile="theme-revision.public-1"] [data-k-nex-primitive=stack]');
  });
});
