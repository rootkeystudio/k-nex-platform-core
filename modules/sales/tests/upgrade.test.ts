import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PackageReleaseManifestSchema } from "@k-nex/contracts";
import { dryRunPluginUpgrade, planPluginUpgrade } from "@k-nex/runtime";

import { salesUpgradeMigrations, salesUpgradeTargets } from "../src/migrations.js";

describe("Sales upgrade fixture", () => {
  it("proves the customer-owned schema and every supported artifact migration", () => {
    const supportManifest = PackageReleaseManifestSchema.parse(JSON.parse(readFileSync(new URL("../../../releases/0.2.0/package-release-manifest.json", import.meta.url), "utf8")));
    const plan = planPluginUpgrade({
      pluginId: "module.sales",
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
      currentPlatformRelease: "0.1.0",
      targetPlatformRelease: "0.2.0",
      supportManifest,
      targets: salesUpgradeTargets,
      migrations: salesUpgradeMigrations
    });
    const artifacts = Object.fromEntries(salesUpgradeTargets.map(({ artifactId }) => [artifactId, { revision: 1, customerOwned: true }]));
    const result = dryRunPluginUpgrade(plan, artifacts);
    expect(plan.steps[0]?.kind).toBe("customer-schema");
    expect(result.ready).toBe(true);
    expect(Object.values(result.artifacts)).toEqual(salesUpgradeTargets.map(() => ({ revision: 2, customerOwned: true })));
  });
});
