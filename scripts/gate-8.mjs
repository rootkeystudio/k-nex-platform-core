import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ApplicationManifestSchema, DeploymentReceiptSchema, RuntimeInventorySchema, canonicalJson } from "../packages/contracts/dist/index.js";
import { applyCreateKnexApplication, planCreateKnexApplication } from "../packages/composition/dist/index.js";
import { FleetRegistry, createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createGitHubHostedAttestationVerifier, createPackageReleaseManifestAuthority, reconcileDeploymentReceipt, restoredInventoryMatches, runtimeInventoryStateDigest, signDeploymentReceipt } from "../packages/runtime/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const evidence = resolve(root, "release-evidence/phase-8-v1");
const customers = ["customer-alpha", "customer-beta"];
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const assertNoSecretKeys = (value, path = "$") => {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /password|secret|token/iu, `Runtime inventory contains a secret-bearing key at ${path}.${key}.`);
    assertNoSecretKeys(child, `${path}.${key}`);
  }
};

if (process.versions.node !== "24.19.0") throw new Error(`Gate 8 requires Node 24.19.0; found ${process.versions.node}.`);
execFileSync(process.execPath, ["scripts/check-phase-8-packed-packages.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check-phase-8-neutral-history.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/check-phase-8-generated-evidence.mjs"], { cwd: root, stdio: "inherit" });

const workflow = readFileSync(resolve(root, ".github/workflows/release-evidence.yml"), "utf8");
for (const usage of workflow.matchAll(/uses:\s*([^\s#]+)/gu)) assert.match(usage[1], /@[0-9a-f]{40}$/u, `Workflow action is not pinned to a full SHA: ${usage[1]}`);
assert.match(workflow, /pnpm --dir fixtures\/customer-alpha install --frozen-lockfile/u);
assert.match(workflow, /pnpm --dir fixtures\/customer-beta install --frozen-lockfile/u);
assert.match(workflow, /cd "\$destination"[\s\S]*gh attestation download/u);
assert.doesNotMatch(workflow, /gh attestation download[^\n]*--output/u);
assert.match(workflow, /https:\/\/cyclonedx\.org\/bom/u);
assert.equal([...workflow.matchAll(/sbom-path:/gu)].length, 2, "Both current customer bundles require hosted SBOM attestations.");

const modules = readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
assert.deepEqual(modules, ["sales"], "Sales must remain the only first-party domain module through Gate 8.");
const result = readFileSync(resolve(root, "docs/implementation/phase-8-result.md"), "utf8");
for (const marker of ["# Phase 8 Result", "1.0.0", "Customer Alpha", "Customer Beta", "CycloneDX", "signed provenance", "DO NOT START DOMAIN EXPANSION"]) {
  assert.ok(result.includes(marker), `Phase 8 result is missing: ${marker}.`);
}

const release = readJson(resolve(root, "releases/1.0.0/package-release-manifest.json"));
assert.equal(release.release.version, "1.0.0");
assert.ok(release.packages.every((entry) => entry.version === "1.0.0"));
const manifestVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/release-manifest/v1" });
const applicationVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/provenance/v1" });
const releaseAuthority = createPackageReleaseManifestAuthority(manifestVerifier);
const applicationAuthority = createApplicationBundleAuthority(applicationVerifier, releaseAuthority);
const verifiedRelease = await releaseAuthority.verify(release, readJson(resolve(evidence, "hosted/manifest-verification.json"))[0]);
const sourceCommit = releaseAuthority.read(verifiedRelease).attestation.sourceCommit;
const keys = generateKeyPairSync("ed25519");
const deploymentAuthority = createDeploymentEvidenceAuthority({
  applicationBundleAuthority: applicationAuthority,
  packageReleaseAuthority: releaseAuthority,
  deploymentPublicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  trustedDeploymentWorkflow: `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}`
});
const fleet = new FleetRegistry(verifiedRelease, releaseAuthority, applicationAuthority, deploymentAuthority);
const fleetFile = readJson(resolve(root, "docs/implementation/phase-8-fleet-evidence.json"));
assert.deepEqual(fleetFile.releasePolicy, { productRelease: "1.0.0", productVersionTransitions: "none" });
assert.equal(fleetFile.deployments.length, 2);

for (const customer of customers) {
  const location = resolve(evidence, "customers", customer);
  const bundle = readJson(resolve(location, `${customer}.application-bundle.json`));
  const application = await applicationAuthority.verify(bundle, readJson(resolve(location, "hosted/application-verification.json"))[0], verifiedRelease);
  const inventory = RuntimeInventorySchema.parse(readJson(resolve(root, `fixtures/${customer}/runtime-inventory.json`)));
  const receipt = DeploymentReceiptSchema.parse(readJson(resolve(root, `fixtures/${customer}/deployment-receipt.json`)));
  const restore = readJson(resolve(root, `fixtures/${customer}/restore-redeployment-proof.json`));
  assert.equal(inventory.applicationId, customer);
  assert.equal(inventory.platformRelease, "1.0.0");
  assert.equal(inventory.migrationRevision, bundle.targetMigrationRevision);
  assert.deepEqual(inventory.plugins, ApplicationManifestSchema.parse(readJson(resolve(root, `fixtures/${customer}/k-nex.app.json`))).plugins);
  assert.ok(inventory.packages.filter(({ package: name }) => name.startsWith("@k-nex/")).every(({ version }) => version === "1.0.0"));
  assert.equal(inventory.artifactDigest, sha256(canonicalJson(bundle)));
  assert.equal(reconcileDeploymentReceipt(receipt, inventory), true);
  assertNoSecretKeys(inventory);
  assert.equal(restore.backupRestoreFixture, "fixtures/customer-gate-1/tests/backup-restore-postgres.test.mjs");
  assert.ok(existsSync(resolve(root, restore.backupRestoreFixture)));
  assert.equal(restore.expectedOperationalInventoryDigest, runtimeInventoryStateDigest(inventory));
  assert.equal(restoredInventoryMatches(inventory, structuredClone(inventory)), true);
  const deployment = await deploymentAuthority.verify({
    observe: async () => structuredClone(inventory),
    receipt: signDeploymentReceipt(receipt, keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString()),
    applicationBundle: application,
    packageRelease: verifiedRelease
  });
  fleet.ingest(deployment);
  fleet.ingest(deployment);
}
assert.deepEqual(fleet.list().map(({ inventory }) => [inventory.applicationId, inventory.platformRelease]), [["customer-alpha", "1.0.0"], ["customer-beta", "1.0.0"]]);
assert.deepEqual(fleet.affected("@k-nex/module-sales", ">=1.0.0").map(({ inventory }) => inventory.applicationId), customers);
execFileSync("pnpm", ["--dir", "fixtures/customer-gate-1", "exec", "node", "--test", "--test-concurrency=1", "tests/backup-restore-postgres.test.mjs"], { cwd: root, stdio: "inherit" });

const factoryRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-8-current-v1-factory-")));
try {
  const plan = planCreateKnexApplication({ applicationId: "gate-eight-current-v1", applicationName: "Gate Eight Current V1", theme: "minimal", database: "docker-postgres" });
  const applied = applyCreateKnexApplication(plan, factoryRoot);
  assert.ok(applied.written.includes("k-nex.app.json") && applied.written.includes("compose.yaml"));
  const manifest = ApplicationManifestSchema.parse(readJson(join(factoryRoot, "k-nex.app.json")));
  assert.deepEqual(manifest.plugins.map(({ id, version }) => ({ id, version })), [{ id: "module.sales", version: "1.0.0" }]);
  assert.equal(applyCreateKnexApplication(plan, factoryRoot).unchanged.length, Object.keys(plan.files).length);
} finally {
  rmSync(factoryRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ gate: "Gate 8", customers: fleet.list().length, productRelease: "1.0.0", productVersionTransitions: "none", restoreProofs: customers.length }, null, 2));
console.log("GATE_8_PASS");
