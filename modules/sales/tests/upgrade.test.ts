import { describe, expect, it } from "vitest";

import { dryRunPluginUpgrade, planPluginUpgrade } from "@k-nex/runtime";

import { salesUpgradeMigrations, salesUpgradeTargets } from "../src/migrations.js";

describe("Sales upgrade fixture", () => {
  it("proves the customer-owned schema and every supported artifact migration", () => {
    const plan = planPluginUpgrade({
      pluginId: "module.sales",
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
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
