import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Sales release fixture", () => {
  it("keeps the first product release at v1.0.0", () => {
    const release = JSON.parse(readFileSync(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url), "utf8"));
    expect(release.release.version).toBe("1.0.0");
    expect(release.packages.every((entry: { version: string }) => entry.version === "1.0.0")).toBe(true);
  });
});
