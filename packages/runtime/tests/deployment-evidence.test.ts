import { describe, expect, it } from "vitest";

import { createDeploymentReceipt, observeRuntimeInventory, reconcileDeploymentReceipt, runtimeInventoryDigest } from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sha = "a".repeat(40);
const inventory = {
  schemaVersion: 1, applicationId: "customer-alpha", repository: "rootkeystudio/customer-alpha", environment: "production", platformRelease: "0.2.0", observedAt: "2026-08-27T12:00:00.000Z", artifactDigest: digest("1"),
  releaseEvidence: { sourceCommit: sha, workflowIdentity: `repo/release@${sha}`, manifestDigest: digest("2"), lockfileDigest: digest("3"), resolvedGraphDigest: digest("4"), sbomDigest: digest("5"), provenanceDigest: digest("6") },
  packages: [{ package: "@k-nex/module-sales", version: "1.0.0", integrity: `sha512-${"a".repeat(86)}==` }],
  plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }], migrationRevision: 7,
  settings: [{ id: "sales.settings", schemaVersion: 2, revision: 3 }], templates: [{ id: "sales.page.tasks", templateVersion: 2, revision: 4 }],
  health: { status: "ready", checks: ["database", "sales"] }
} as const;

describe("runtime deployment evidence", () => {
  it("freezes secret-free observed inventory and produces a stable digest", () => {
    const observed = observeRuntimeInventory(inventory);
    expect(Object.isFrozen(observed.releaseEvidence)).toBe(true);
    expect(runtimeInventoryDigest(observed)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(observed)).not.toMatch(/password|secret|token/iu);
  });

  it("binds deployment receipt to exact observed inventory and outcomes", () => {
    const observed = observeRuntimeInventory(inventory);
    const receipt = createDeploymentReceipt({ inventory: observed, deploymentId: "deploy:alpha:7", deployedAt: "2026-08-27T12:05:00.000Z", approvedBy: { kind: "workflow", identity: `repo/deploy@${sha}` }, smoke: { status: "passed", checks: ["authenticated", "public"] } });
    expect(reconcileDeploymentReceipt(receipt, observed)).toBe(true);
    expect(reconcileDeploymentReceipt(receipt, observeRuntimeInventory({ ...inventory, migrationRevision: 8 }))).toBe(false);
    expect(reconcileDeploymentReceipt({ ...receipt, smoke: { status: "failed", checks: ["public"] } }, observed)).toBe(false);
  });
});
