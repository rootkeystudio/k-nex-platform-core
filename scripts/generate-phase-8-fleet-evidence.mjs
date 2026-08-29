import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { salesUpgradeMigrations, salesUpgradeTargets } from "../modules/sales/dist/migrations.js";
import {
  FleetRegistry, createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createGitHubHostedAttestationVerifier,
  createPackageReleaseManifestAuthority, planPluginUpgrade, runtimeInventoryDigest, runtimeInventoryStateDigest, signDeploymentReceipt
} from "../packages/runtime/dist/index.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (customer, name) => JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures", customer, name), "utf8"));
const write = (path, value) => writeFileSync(resolve(repositoryRoot, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const customers = ["customer-alpha", "customer-beta"];
const targetReleaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.2.0/package-release-manifest.json"), "utf8"));
const currentReleaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.1.0/package-release-manifest.json"), "utf8"));
const patchReleaseManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "releases/0.2.1/package-release-manifest.json"), "utf8"));
const sourceCommit = read("customer-alpha", "runtime-inventory.json").releaseEvidence.sourceCommit;
const applicationVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/provenance/v1" });
const manifestVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/release-manifest/v1" });
const releaseAuthority = createPackageReleaseManifestAuthority(manifestVerifier);
const applicationAuthority = createApplicationBundleAuthority(applicationVerifier, releaseAuthority);
const verification = (path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"))[0];
const supportRelease = await releaseAuthority.verify(targetReleaseManifest, verification("release-evidence/phase-8/hosted/manifest-verification.json"));
const priorRelease = await releaseAuthority.verify(currentReleaseManifest, verification("release-evidence/phase-8/customer-beta/hosted/manifest-verification.json"));
const patchRelease = await releaseAuthority.verify(patchReleaseManifest, verification("release-evidence/phase-8/targets/customer-alpha/hosted/manifest-verification.json"));
const application = async (customer, target, release) => {
  const base = target ? `release-evidence/phase-8/targets/${customer}` : `release-evidence/phase-8/${customer === "customer-alpha" ? "" : "customer-beta"}`;
  const bundle = JSON.parse(readFileSync(resolve(repositoryRoot, base, `${customer}.application-bundle.json`), "utf8"));
  return applicationAuthority.verify(bundle, verification(`${base}/hosted/application-verification.json`), release);
};
const currentApplications = new Map([
  ["customer-alpha", await application("customer-alpha", false, supportRelease)],
  ["customer-beta", await application("customer-beta", false, priorRelease)]
]);
const targetApplications = await Promise.all(customers.map((customer) => application(customer, true, patchRelease)));
const deploymentKeys = generateKeyPairSync("ed25519");
const privateKey = deploymentKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const deploymentAuthority = createDeploymentEvidenceAuthority({
  applicationBundleAuthority: applicationAuthority, packageReleaseAuthority: releaseAuthority,
  deploymentPublicKey: deploymentKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  trustedDeploymentWorkflow: `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}`
});
const verifiedDeployment = (customer, target) => deploymentAuthority.verify({
  observe: async () => read(customer, target ? "security-target-runtime-inventory.json" : "runtime-inventory.json"),
  receipt: signDeploymentReceipt(read(customer, target ? "security-target-deployment-receipt.json" : "deployment-receipt.json"), privateKey),
  applicationBundle: target ? targetApplications[customers.indexOf(customer)] : currentApplications.get(customer),
  packageRelease: target ? patchRelease : customer === "customer-alpha" ? supportRelease : priorRelease
});
const fleet = new FleetRegistry(supportRelease, releaseAuthority, applicationAuthority, deploymentAuthority);
for (const customer of customers) fleet.ingest(await verifiedDeployment(customer, false));

const deployments = fleet.list();
assert.deepEqual(deployments.map(({ inventory }) => inventory.platformRelease), ["0.2.0", "0.1.0"]);
const affected = fleet.affected("@k-nex/module-sales", "<1.0.1");
assert.equal(affected.length, 2);
const patches = fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", patchRelease, targetApplications);
for (const patch of patches) {
  write(`fixtures/${patch.applicationId}/security-patch-plan.json`, {
    schemaVersion: 1,
    branch: `security/sales-1.0.1-${patch.applicationId}`,
    title: `security: update Sales to 1.0.1 for ${patch.applicationId}`,
    ...patch
  });
}
for (const patch of patches) assert.equal(fleet.applySecurityPatch(patch, await verifiedDeployment(patch.applicationId, true)).inventory.platformRelease, "0.2.1");
assert.deepEqual(fleet.list().map(({ inventory }) => inventory.platformRelease), ["0.2.1", "0.2.1"]);

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
