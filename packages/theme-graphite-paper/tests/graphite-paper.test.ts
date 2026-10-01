import { describe, expect, it } from "vitest";

import { semanticPrimitiveNames } from "@k-nex/ui-design-system-contracts";
import { graphitePaperThemePackage, resolveGraphitePaperThemeProfile } from "../src/index.js";

function profile(palette: "graphite" | "paper", mode: "light" | "dark") {
  return {
    schemaVersion: 1,
    id: "theme-profile.workspace-default",
    surface: "admin",
    themeId: "theme.graphite-paper",
    themeVersion: graphitePaperThemePackage.version,
    palette,
    mode,
    values: {},
    revision: { id: `theme-revision.${palette}-1`, number: 1, state: "published", createdAt: "2026-09-22T00:00:00.000Z", publishedAt: "2026-09-22T00:01:00.000Z" }
  };
}

describe("Graphite & Paper theme", () => {
  it("implements the complete ABI and resolves deterministic namespaced CSS", () => {
    expect(Object.keys(graphitePaperThemePackage.primitiveOverrides ?? {}).sort()).toEqual([...semanticPrimitiveNames].sort());
    const first = resolveGraphitePaperThemeProfile(profile("graphite", "dark"));
    const second = resolveGraphitePaperThemeProfile(structuredClone(profile("graphite", "dark")));
    expect(second).toEqual(first);
    expect(first.cssVariables["--k-nex-admin-color-background"]).toBe("#121212");
    expect(first.cssVariables["--k-nex-admin-color-accent"]).toBe("#ff6b35");
    expect(Object.keys(first.cssVariables)).toEqual([...Object.keys(first.cssVariables)].sort());
  });

  /**
   * The two tones are the whole idea: chrome a person navigates with, paper
   * they read and write on. A palette that lost the distinction would still
   * resolve, and would no longer be this theme.
   */
  it("keeps chrome and paper distinct in both palettes", () => {
    for (const palette of ["graphite", "paper"] as const) {
      const presentation = resolveGraphitePaperThemeProfile(profile(palette, palette === "graphite" ? "dark" : "light"));
      expect(presentation.cssVariables["--k-nex-admin-color-chrome"]).not.toBe(presentation.cssVariables["--k-nex-admin-color-paper"]);
      expect(presentation.cssVariables["--k-nex-admin-color-paper-foreground"]).not.toBe(presentation.cssVariables["--k-nex-admin-color-paper"]);
    }
  });

  it("lays out the workspace and carries its own design language", () => {
    const css = graphitePaperThemePackage.structuralCss;
    expect(css).toContain(".workspace-shell");
    expect(css).toContain(".workspace-sidebar");
    expect(css).toContain('[data-k-nex-component="data-grid"]');
    expect(css).toContain('[data-k-nex-surface="paper"]');
    expect(css).toContain('.workspace-sidebar a[aria-current="page"]');
    expect(css).toContain("text-transform:uppercase");
  });

  it("rejects unknown or malformed token overrides", () => {
    expect(() => resolveGraphitePaperThemeProfile({ ...profile("graphite", "dark"), values: { "color.unknown": "#ffffff" } }))
      .toThrow("Theme profile values do not satisfy the installed package schema.");
  });
});
