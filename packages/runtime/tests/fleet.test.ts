import { describe, expect, it } from "vitest";

import { FleetRegistry, createDeploymentReceipt, observeRuntimeInventory, restoredInventoryMatches } from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sha = "a".repeat(40);
function deployment(applicationId: "customer-alpha" | "customer-beta", release: "0.2.0" | "0.1.0") {
  const inventory = observeRuntimeInventory({
    schemaVersion: 1, applicationId, repository: `rootkeystudio/${applicationId}`, environment: "production", platformRelease: release,
    observedAt: "2026-08-27T12:00:00.000Z", artifactDigest: digest("1"), releaseEvidence: { sourceCommit: sha, workflowIdentity: `repo/release@${sha}`, manifestDigest: digest("2"), lockfileDigest: digest(applicationId === "customer-alpha" ? "3" : "4"), resolvedGraphDigest: digest("5"), sbomDigest: digest("6"), provenanceDigest: digest("7") },
    packages: [{ package: "@k-nex/module-sales", version: "1.0.0", integrity: `sha512-${"a".repeat(86)}==` }],
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }], migrationRevision: release === "0.2.0" ? 7 : 6,
    settings: [{ id: "sales.settings", schemaVersion: 1, revision: 1 }], templates: [{ id: "sales.page.tasks", templateVersion: 1, revision: 1 }], health: { status: "ready", checks: ["sales"] }
  });
  const receipt = createDeploymentReceipt({ inventory, deploymentId: `deploy:${applicationId}:1`, deployedAt: "2026-08-27T12:05:00.000Z", approvedBy: { kind: "workflow", identity: `repo/deploy@${sha}` }, smoke: { status: "passed", checks: ["sales"] } });
  return { inventory, receipt };
}

describe("fleet evidence and patch propagation", () => {
  it("ingests receipt-bound deployments and preserves current/prior release state", () => {
    const fleet = new FleetRegistry();
    const alpha = deployment("customer-alpha", "0.2.0");
    const beta = deployment("customer-beta", "0.1.0");
    fleet.ingest(alpha.receipt, alpha.inventory); fleet.ingest(beta.receipt, beta.inventory);
    expect(fleet.list().map(({ inventory }) => inventory.platformRelease)).toEqual(["0.2.0", "0.1.0"]);
    expect(() => fleet.ingest({ ...alpha.receipt, inventoryDigest: digest("f") }, alpha.inventory)).toThrow("reconciled");
  });

  it("finds every vulnerable deployment and creates customer-specific patch updates", () => {
    const fleet = new FleetRegistry();
    for (const item of [deployment("customer-alpha", "0.2.0"), deployment("customer-beta", "0.1.0")]) fleet.ingest(item.receipt, item.inventory);
    expect(fleet.affected("@k-nex/module-sales", "<1.0.1")).toHaveLength(2);
    expect(fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: "rootkeystudio/customer-alpha", operations: ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"] }),
      expect.objectContaining({ repository: "rootkeystudio/customer-beta" })
    ]));
  });

  it("requires restore/redeploy inventory to exactly reproduce expected observed state", () => {
    const expected = deployment("customer-alpha", "0.2.0").inventory;
    expect(restoredInventoryMatches(expected, structuredClone(expected))).toBe(true);
    expect(restoredInventoryMatches(expected, observeRuntimeInventory({ ...expected, migrationRevision: 8 }))).toBe(false);
  });
});
