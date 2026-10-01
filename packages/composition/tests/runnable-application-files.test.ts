import { describe, expect, it } from "vitest";

import { runnableApplicationFiles } from "../src/runnable-application-files.js";

describe("generated runnable workspace styles", () => {
  /**
   * The workspace is laid out by the installed theme, which owns every surface
   * under its own root. The generated stylesheet is what a theme cannot reach:
   * the document, and the screens shown before a theme resolves. Keeping shell
   * rules in both places is how a theme ends up unable to change a layout that
   * something else already painted.
   */
  it("leaves the workspace to the theme and styles only what a theme cannot reach", () => {
    const styles = runnableApplicationFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", database: "docker-postgres", theme: "minimal" })["src/app/styles.css"]!;

    expect(styles).toContain(".workspace-home");
    expect(styles).toContain(".workspace-home form");
    expect(styles).toContain(".workspace-home button");
    expect(styles).not.toContain(".workspace-shell");
    expect(styles).not.toContain(".workspace-sidebar");
    expect(styles).not.toContain(".workspace-header");
    expect(styles).not.toContain(".workspace-drawer");
    expect(styles).not.toContain("background: Canvas");
    expect(styles).not.toContain("background: Highlight");
  });

  /**
   * Sign-in renders before any theme, so nothing a theme guarantees about
   * contrast applies to it. Each pairing the entry screens actually paint is
   * held to WCAG AA in both color schemes: 4.5:1 for text, 3:1 for the focus
   * ring against what it is drawn over.
   */
  it("keeps every entry-screen pairing at WCAG AA in both color schemes", () => {
    const styles = runnableApplicationFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", database: "docker-postgres", theme: "minimal" })["src/app/styles.css"]!;
    const palette = new Map([...styles.matchAll(/--k-nex-entry-([a-z-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/gu)]
      .map(([, name, light, dark]) => [name!, { light: light!, dark: dark! }]));
    const luminance = (hex: string) => {
      const [red, green, blue] = [1, 3, 5].map((offset) => {
        const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const ratio = (left: string, right: string) => {
      const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
      return (high! + 0.05) / (low! + 0.05);
    };
    const pairings: readonly (readonly [string, string, number])[] = [
      ["foreground", "background", 4.5], ["foreground", "surface", 4.5],
      ["muted", "background", 4.5], ["muted", "surface", 4.5],
      ["accent", "background", 4.5], ["accent-contrast", "accent", 4.5],
      ["critical", "background", 4.5], ["critical", "surface", 4.5],
      ["accent", "surface", 3]
    ];

    for (const scheme of ["light", "dark"] as const) {
      for (const [text, ground, minimum] of pairings) {
        const textColor = palette.get(text)?.[scheme];
        const groundColor = palette.get(ground)?.[scheme];
        expect(textColor, `--k-nex-entry-${text} is not declared`).toBeDefined();
        expect(groundColor, `--k-nex-entry-${ground} is not declared`).toBeDefined();
        expect(ratio(textColor!, groundColor!), `${scheme} ${text} on ${ground}`).toBeGreaterThanOrEqual(minimum);
      }
    }
  });
});
