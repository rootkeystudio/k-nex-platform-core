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
});
