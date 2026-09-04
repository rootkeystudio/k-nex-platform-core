import { describe, expect, it } from "vitest";

import { runnableApplicationFiles } from "../src/runnable-application-files.js";

describe("generated runnable workspace styles", () => {
  it("keeps compact desktop navigation available as an icon rail", () => {
    const styles = runnableApplicationFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", database: "docker-postgres", theme: "minimal" })["src/app/styles.css"]!;

    expect(styles).toContain('.workspace-shell[data-sidebar="collapsed"] .workspace-desktop-navigation-expanded { display: none; }');
    expect(styles).toContain('.workspace-shell[data-sidebar="collapsed"] .workspace-desktop-navigation-rail { display: block; }');
    expect(styles).toContain('.workspace-desktop-navigation-rail .workspace-rail-item[data-active]');
  });
});
