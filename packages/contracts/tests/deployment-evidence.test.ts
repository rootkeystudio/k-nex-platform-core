import { describe, expect, it } from "vitest";

import { DeploymentReceiptSchema, RuntimeInventorySchema } from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sourceCommit = "a".repeat(40);
const inventory = {
  schemaVersion: 1, applicationId: "customer-alpha", repository: "rootkeystudio/customer-alpha", environment: "production", platformRelease: "0.2.0", observedAt: "2026-08-27T12:00:00.000Z",
  artifactDigest: digest("1"),
  releaseEvidence: { sourceCommit, workflowIdentity: `repo/workflow@${sourceCommit}`, manifestDigest: digest("2"), lockfileDigest: digest("3"), resolvedGraphDigest: digest("4"), sbomDigest: digest("5"), provenanceDigest: digest("6") },
  packages: [{ package: "@k-nex/module-sales", version: "1.0.0", integrity: `sha512-${"a".repeat(86)}==` }],
  plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }],
  migrationRevision: 7, settings: [{ id: "sales.settings", schemaVersion: 2, revision: 3 }],
  templates: [{ id: "sales.page.tasks", templateVersion: 2, revision: 4 }], health: { status: "ready", checks: ["database", "sales"] }
} as const;

describe("deployment evidence contracts", () => {
  it("accepts non-secret observed inventory and reconciles plugins to packages", () => {
    expect(RuntimeInventorySchema.parse(inventory)).toEqual(inventory);
    expect(RuntimeInventorySchema.safeParse({ ...inventory, plugins: [{ ...inventory.plugins[0], version: "1.1.0" }] }).success).toBe(false);
    expect(RuntimeInventorySchema.safeParse({ ...inventory, releaseEvidence: { ...inventory.releaseEvidence, workflowIdentity: "repo/workflow@main" } }).success).toBe(false);
  });

  it("requires exact deployment outcomes and approval identity", () => {
    const receipt = { schemaVersion: 1, deploymentId: "deploy:alpha:7", applicationId: "customer-alpha", environment: "production", deployedAt: "2026-08-27T12:05:00.000Z", approvedBy: { kind: "workflow", identity: `repo/deploy@${sourceCommit}` }, artifactDigest: digest("1"), inventoryDigest: digest("7"), migrationRevision: 7, smoke: { status: "passed", checks: ["authenticated", "public"] }, readiness: "ready" } as const;
    expect(DeploymentReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(DeploymentReceiptSchema.safeParse({ ...receipt, smoke: { status: "passed", checks: [] } }).success).toBe(false);
  });
});
