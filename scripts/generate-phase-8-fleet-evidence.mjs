import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { salesUpgradeMigrations, salesUpgradeTargets } from "../modules/sales/dist/migrations.js";
import {
  FleetRegistry, planPluginUpgrade, runtimeInventoryDigest, runtimeInventoryStateDigest
} from "../packages/runtime/dist/index.js";
import { createFixtureDeploymentVerifier } from "./lib/fixture-deployment-authority.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (customer, name) => JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures", customer, name), "utf8"));
const write = (path, value) => writeFileSync(resolve(repositoryRoot, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const customers = ["customer-alpha", "customer-beta"];
const targetReleaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.2.0/package-release-manifest.json"), "utf8"));
const currentReleaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.1.0/package-release-manifest.json"), "utf8"));
const patchReleaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.2.1/package-release-manifest.json"), "utf8"));
const sourceCommit = read("customer-alpha", "runtime-inventory.json").releaseEvidence.sourceCommit;
const verifier = createFixtureDeploymentVerifier(sourceCommit);
const targetRelease = await verifier.verifyManifest(targetReleaseManifest);
const currentRelease = await verifier.verifyManifest(currentReleaseManifest);
const patchRelease = await verifier.verifyManifest(patchReleaseManifest);
const fleet = new FleetRegistry(targetRelease, verifier.packageReleaseAuthority, verifier.applicationBundleAuthority, verifier.authority);
for (const customer of customers) {
  const inventory = read(customer, "runtime-inventory.json");
  fleet.ingest(await verifier.verify(inventory, read(customer, "deployment-receipt.json"), inventory.platformRelease === "0.2.0" ? targetRelease : currentRelease));
}

const deployments = fleet.list();
assert.deepEqual(deployments.map(({ inventory }) => inventory.platformRelease), ["0.2.0", "0.1.0"]);
const affected = fleet.affected("@k-nex/module-sales", "<1.0.1");
assert.equal(affected.length, 2);
const targetApplications = await Promise.all(customers.map(async (customer) => {
  const inventory = read(customer, "runtime-inventory.json");
  const existing = read(customer, "security-patch-plan.json");
  return verifier.verifyTargetApplication(inventory, patchRelease, existing.targetDeploymentClosure, existing.targetMigrationRevision ?? 8);
}));
const patches = fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", patchRelease, targetApplications);
for (const patch of patches) {
  write(`fixtures/${patch.applicationId}/security-patch-plan.json`, {
    schemaVersion: 1,
    branch: `security/sales-1.0.1-${patch.applicationId}`,
    title: `security: update Sales to 1.0.1 for ${patch.applicationId}`,
    ...patch
  });
}

const upgradePlan = planPluginUpgrade({
  pluginId: "module.sales", currentVersion: "0.9.0", targetVersion: "1.0.0",
  currentPlatformRelease: "0.1.0", targetPlatformRelease: "0.2.0", currentReleaseManifest, targetReleaseManifest,
  targets: salesUpgradeTargets, migrations: salesUpgradeMigrations
});
assert.equal(upgradePlan.ready, true);
write("fixtures/customer-beta/previous-release-upgrade.json", {
  schemaVersion: 1,
  platformRelease: { current: "0.1.0", target: "0.2.0" },
  packageRelease: { current: "0.9.0", target: "1.0.0" },
  expectedPredecessorMigrationRevision: 6,
  targetMigrationRevision: 7,
  reviewedMigrationIds: upgradePlan.steps.map(({ id }) => id),
  preservedArtifacts: salesUpgradeTargets.map(({ artifactId }) => artifactId).sort(),
  postgresProof: { test: "fixtures/customer-gate-1/tests/previous-release-upgrade-postgres.test.mjs", database: "postgres:17.6", execution: "required-by-customer-postgres-suite" }
});

const alpha = read("customer-alpha", "runtime-inventory.json");
write("fixtures/customer-alpha/restore-redeployment-proof.json", {
  schemaVersion: 1,
  backupRestoreFixture: "fixtures/customer-gate-1/tests/backup-restore-postgres.test.mjs",
  expectedOperationalInventoryDigest: runtimeInventoryStateDigest(alpha),
  observation: "clean-restored PostgreSQL runtime inventory",
  execution: "required-by-customer-postgres-suite",
  externalEffects: "disabled-before-readiness"
});

write("docs/implementation/phase-8-fleet-evidence.json", {
  schemaVersion: 1,
  deployments: deployments.map(({ inventory, receipt }) => ({ applicationId: inventory.applicationId, platformRelease: inventory.platformRelease, deploymentId: receipt.deploymentId, inventoryDigest: runtimeInventoryDigest(inventory) })),
  vulnerability: { package: "@k-nex/module-sales", affectedRange: "<1.0.1", targetVersion: "1.0.1", affectedApplications: patches.map(({ applicationId }) => applicationId) },
  generatedPatchUpdates: patches.map(({ applicationId, repository, baseInventoryDigest }) => ({ applicationId, repository, baseInventoryDigest })),
  previousReleaseUpgrade: { applicationId: "customer-beta", postgresProof: "previous-release-upgrade-postgres.test.mjs", stepCount: upgradePlan.steps.length },
  restore: { applicationId: "customer-alpha", postgresProof: "backup-restore-postgres.test.mjs", expectedOperationalInventoryDigest: runtimeInventoryStateDigest(alpha) }
});
process.stdout.write("P8_9_FLEET_EVIDENCE_PASS\n");
