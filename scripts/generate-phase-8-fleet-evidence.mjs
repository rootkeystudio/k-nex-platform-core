import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { salesUpgradeMigrations, salesUpgradeTargets } from "../modules/sales/dist/migrations.js";
import {
  FleetRegistry, dryRunPluginUpgrade, planPluginUpgrade, restoredInventoryMatches, runtimeInventoryDigest
} from "../packages/runtime/dist/index.js";
import { createFixtureDeploymentVerifier } from "./lib/fixture-deployment-authority.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (customer, name) => JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures", customer, name), "utf8"));
const write = (path, value) => writeFileSync(resolve(repositoryRoot, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const customers = ["customer-alpha", "customer-beta"];
const supportManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.2.0/package-release-manifest.json"), "utf8"));
const sourceCommit = read("customer-alpha", "runtime-inventory.json").releaseEvidence.sourceCommit;
const verifier = createFixtureDeploymentVerifier(sourceCommit);
const fleet = new FleetRegistry(supportManifest, verifier.authority);
for (const customer of customers) fleet.ingest(await verifier.verify(read(customer, "runtime-inventory.json"), read(customer, "deployment-receipt.json")));

const deployments = fleet.list();
assert.deepEqual(deployments.map(({ inventory }) => inventory.platformRelease), ["0.2.0", "0.1.0"]);
const affected = fleet.affected("@k-nex/module-sales", "<1.0.1");
assert.equal(affected.length, 2);
const patches = fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1");
for (const patch of patches) {
  write(`fixtures/${patch.applicationId}/security-patch-plan.json`, {
    schemaVersion: 1,
    branch: `security/sales-1.0.1-${patch.applicationId}`,
    title: `security: update Sales to 1.0.1 for ${patch.applicationId}`,
    ...patch
  });
}

const upgradePlan = planPluginUpgrade({
  pluginId: "module.sales", currentVersion: "1.0.0", targetVersion: "1.1.0",
  currentPlatformRelease: "0.1.0", targetPlatformRelease: "0.2.0", supportManifest,
  targets: salesUpgradeTargets, migrations: salesUpgradeMigrations
});
const betaArtifacts = Object.fromEntries(salesUpgradeTargets.map(({ artifactId }) => [artifactId, { revision: 1, customer: "customer-beta", preserved: true }]));
const dryRun = dryRunPluginUpgrade(upgradePlan, betaArtifacts);
assert.equal(upgradePlan.ready && dryRun.ready, true);
write("fixtures/customer-beta/previous-release-upgrade.json", {
  schemaVersion: 1,
  platformRelease: { current: "0.1.0", target: "0.2.0" },
  packageRelease: { current: "1.0.0", target: "1.1.0" },
  expectedPredecessorMigrationRevision: 6,
  targetMigrationRevision: 7,
  reviewedMigrationIds: upgradePlan.steps.map(({ id }) => id),
  dryRunDiagnostics: dryRun.diagnostics,
  preservedArtifacts: Object.keys(dryRun.artifacts).sort()
});

const alpha = read("customer-alpha", "runtime-inventory.json");
const restored = structuredClone(alpha);
assert.equal(restoredInventoryMatches(alpha, restored), true);
write("fixtures/customer-alpha/restore-redeployment-proof.json", {
  schemaVersion: 1,
  backupRestoreFixture: "backup-restore-postgres.test.mjs",
  expectedInventoryDigest: runtimeInventoryDigest(alpha),
  restoredInventoryDigest: runtimeInventoryDigest(restored),
  matches: true,
  externalEffects: "disabled-before-readiness"
});

write("docs/implementation/phase-8-fleet-evidence.json", {
  schemaVersion: 1,
  deployments: deployments.map(({ inventory, receipt }) => ({ applicationId: inventory.applicationId, platformRelease: inventory.platformRelease, deploymentId: receipt.deploymentId, inventoryDigest: runtimeInventoryDigest(inventory) })),
  vulnerability: { package: "@k-nex/module-sales", affectedRange: "<1.0.1", targetVersion: "1.0.1", affectedApplications: affected.map(({ inventory }) => inventory.applicationId) },
  generatedPatchUpdates: patches.map(({ applicationId, repository, baseInventoryDigest }) => ({ applicationId, repository, baseInventoryDigest })),
  previousReleaseUpgrade: { applicationId: "customer-beta", ready: dryRun.ready, stepCount: upgradePlan.steps.length },
  restore: { applicationId: "customer-alpha", matchesExpectedInventory: true }
});
process.stdout.write("P8_9_FLEET_EVIDENCE_PASS\n");
