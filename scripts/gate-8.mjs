import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ApplicationManifestSchema, DeploymentReceiptSchema, RuntimeInventorySchema, canonicalJson } from "../packages/contracts/dist/index.js";
import { applyCreateKnexApplication, planCreateKnexApplication } from "../packages/composition/dist/index.js";
import { FleetRegistry, createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createGitHubHostedAttestationVerifier, createPackageReleaseManifestAuthority, reconcileDeploymentReceipt, runtimeInventoryStateDigest, signDeploymentReceipt } from "../packages/runtime/dist/index.js";
import { assertPhase8ReleaseSnapshot, bundledFile } from "./lib/phase-8-provenance.mjs";

const root = resolve(import.meta.dirname, "..");
if (process.versions.node !== "24.19.0") throw new Error(`Gate 8 requires Node 24.19.0; found ${process.versions.node}.`);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const assertNoSecretKeys = (value, path = "$") => {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /password|secret|token/iu, `Runtime inventory contains a secret-bearing key at ${path}.${key}.`);
    assertNoSecretKeys(child, `${path}.${key}`);
  }
};
const result = readFileSync(resolve(root, "docs/implementation/phase-8-result.md"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/release-evidence.yml"), "utf8");
const modules = readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
assert.deepEqual(modules, ["sales"], "Sales must remain the only first-party domain module through Gate 8.");
for (const usage of workflow.matchAll(/uses:\s*([^\s#]+)/gu)) assert.match(usage[1], /@[0-9a-f]{40}$/u, `Workflow action is not pinned to a full SHA: ${usage[1]}`);
assert.match(workflow, /id-token:\s*write/u);
assert.match(workflow, /attestations:\s*write/u);
assert.match(workflow, /predicate-type:\s*https:\/\/k-nex\.dev\/provenance\/v1/u);
assert.match(workflow, /predicate-path:\s*release-evidence\/provenance-predicate\.json/u);
assert.match(workflow, /gh attestation verify[\s\S]*--predicate-type https:\/\/k-nex\.dev\/provenance\/v1/u);
assert.doesNotMatch(workflow, /SLSA Build L[0-9]/u);

const hostedRoot = resolve(root, "release-evidence/phase-8");
const verifyHosted = (subject, bundle, predicateType) => JSON.parse(execFileSync("gh", [
  "attestation", "verify", subject, "--bundle", bundle, "--repo", "rootkeystudio/k-nex-platform-core",
  "--predicate-type", predicateType, "--format", "json"
], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
const applicationVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/provenance/v1" });
const manifestVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/release-manifest/v1" });
const releaseAuthority = createPackageReleaseManifestAuthority(manifestVerifier);
const applicationAuthority = createApplicationBundleAuthority(applicationVerifier, releaseAuthority);
const verifiedManifest = async (location, repositoryPath) => {
  const manifestPath = resolve(location, "release-manifest.json");
  const manifestVerification = verifyHosted(manifestPath, resolve(location, "hosted/manifest/manifest-attestation.jsonl"), "https://k-nex.dev/release-manifest/v1");
  assert.equal(manifestVerification.length, 1);
  const manifest = readJson(repositoryPath);
  assert.equal(canonicalJson(JSON.parse(readFileSync(manifestPath, "utf8"))), canonicalJson(manifest));
  return releaseAuthority.verify(manifest, manifestVerification[0]);
};
const verifiedApplication = async (location, customer, release) => {
  const bundlePath = resolve(location, `${customer}.application-bundle.json`);
  const applicationVerification = verifyHosted(bundlePath, resolve(location, "hosted/application/application-attestation.jsonl"), "https://k-nex.dev/provenance/v1");
  assert.equal(applicationVerification.length, 1);
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  for (const file of bundle.files) assert.equal(file.digest, sha256(Buffer.from(file.content, "base64")), `Deployable bundle file digest differs: ${file.path}`);
  assert.equal(bundle.closureDigest, sha256(canonicalJson(bundle.installedPackages)));
  const application = await applicationAuthority.verify(bundle, applicationVerification[0], release);
  const attestation = applicationAuthority.read(application).attestation;
  const materials = new Map(attestation.materials.map(({ name, digest }) => [name, digest]));
  const applicationFiles = bundle.files.filter(({ path }) => path.startsWith("application/"));
  const buildFiles = bundle.files.filter(({ path }) => path.startsWith("application/dist/"));
  assert.equal(materials.get("application-manifest"), sha256(bundledFile(bundle, "application/k-nex.app.json")));
  assert.equal(materials.get("resolved-graph-or-plan"), sha256(canonicalJson(JSON.parse(bundledFile(bundle, "application/.k-nex/application-plan.json").toString("utf8")))));
  assert.equal(materials.get("package-release-manifest"), bundle.releaseManifestDigest);
  assert.equal(materials.get("generated-application-tree"), sha256(canonicalJson(applicationFiles)));
  assert.equal(materials.get("application-build-output"), sha256(canonicalJson(buildFiles)));
  assertPhase8ReleaseSnapshot(root, bundle);
  return { release, application, attestation, bundle, sbom: JSON.parse(readFileSync(resolve(location, "sbom.cdx.json"), "utf8")) };
};
const supportRelease = await verifiedManifest(hostedRoot, "releases/0.2.0/package-release-manifest.json");
const priorRoot = resolve(hostedRoot, "customer-beta");
const priorRelease = await verifiedManifest(priorRoot, "releases/0.1.0/package-release-manifest.json");
const targetAlphaRoot = resolve(hostedRoot, "targets/customer-alpha");
const targetBetaRoot = resolve(hostedRoot, "targets/customer-beta");
const patchRelease = await verifiedManifest(targetAlphaRoot, "releases/0.2.1/package-release-manifest.json");
const hostedTokens = new Map([
  ["customer-alpha", await verifiedApplication(hostedRoot, "customer-alpha", supportRelease)],
  ["customer-beta", await verifiedApplication(priorRoot, "customer-beta", priorRelease)]
]);
const targetTokens = new Map([
  ["customer-alpha", await verifiedApplication(targetAlphaRoot, "customer-alpha", patchRelease)],
  ["customer-beta", await verifiedApplication(targetBetaRoot, "customer-beta", patchRelease)]
]);

const sourceCommit = readJson("fixtures/customer-alpha/runtime-inventory.json").releaseEvidence.sourceCommit;
assert.match(sourceCommit, /^[0-9a-f]{40}$/u);
const deploymentKeys = generateKeyPairSync("ed25519");
const deploymentAuthority = createDeploymentEvidenceAuthority({
  applicationBundleAuthority: applicationAuthority, packageReleaseAuthority: releaseAuthority,
  deploymentPublicKey: deploymentKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  trustedDeploymentWorkflow: `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}`
});
const fleet = new FleetRegistry(supportRelease, releaseAuthority, applicationAuthority, deploymentAuthority);
for (const customer of ["customer-alpha", "customer-beta"]) {
  const manifest = ApplicationManifestSchema.parse(readJson(`fixtures/${customer}/k-nex.app.json`));
  const inventory = RuntimeInventorySchema.parse(readJson(`fixtures/${customer}/runtime-inventory.json`));
  const receipt = DeploymentReceiptSchema.parse(readJson(`fixtures/${customer}/deployment-receipt.json`));
  const hosted = hostedTokens.get(customer);
  const signedManifest = bundledFile(hosted.bundle, "application/k-nex.app.json");
  const signedLock = bundledFile(hosted.bundle, "application/pnpm-lock.yaml");
  const signedPlan = bundledFile(hosted.bundle, "application/.k-nex/application-plan.json");
  assert.ok(readFileSync(resolve(root, `fixtures/${customer}/k-nex.app.json`)).equals(signedManifest), `${customer} manifest differs from the signed application bundle.`);
  assert.ok(readFileSync(resolve(root, `fixtures/${customer}/pnpm-lock.yaml`)).equals(signedLock), `${customer} lock differs from the signed application bundle.`);
  assert.ok(readFileSync(resolve(root, `fixtures/${customer}/.k-nex/application-plan.json`)).equals(signedPlan), `${customer} plan differs from the signed application bundle.`);
  assert.equal(inventory.artifactDigest, sha256(canonicalJson(hosted.bundle)));
  assert.equal(inventory.releaseEvidence.manifestDigest, sha256(signedManifest));
  assert.equal(inventory.releaseEvidence.lockfileDigest, sha256(signedLock));
  assert.equal(inventory.releaseEvidence.resolvedGraphDigest, sha256(canonicalJson(JSON.parse(signedPlan.toString("utf8")))));
  assert.equal(inventory.releaseEvidence.frameworkDigest, hosted.bundle.frameworkDigest);
  assert.equal(inventory.releaseEvidence.sbomDigest, sha256(canonicalJson(hosted.sbom)));
  assert.equal(inventory.releaseEvidence.sourceCommit, sourceCommit);
  assert.equal(inventory.releaseEvidence.provenanceDigest, sha256(canonicalJson(hosted.attestation)));
  assert.deepEqual(manifest.plugins.map(({ id }) => id), ["module.sales"]);
  assert.equal(reconcileDeploymentReceipt(receipt, inventory), true);
  assertNoSecretKeys(inventory);
  fleet.ingest(await deploymentAuthority.verify({
    observe: async () => structuredClone(inventory), receipt: signDeploymentReceipt(receipt, deploymentKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString()),
    applicationBundle: hosted.application, packageRelease: hosted.release
  }));
}
assert.deepEqual(fleet.list().map(({ inventory }) => inventory.platformRelease), ["0.2.0", "0.1.0"]);
assert.deepEqual(fleet.affected("@k-nex/module-sales", "<1.0.1").map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
assert.deepEqual(fleet.affected("semver", "<7.8.6").map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
const patches = fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", patchRelease, [...targetTokens.values()].map(({ application }) => application));
for (const patch of patches) {
  const customer = patch.applicationId;
  assert.deepEqual(readJson(`fixtures/${customer}/security-patch-plan.json`), {
    schemaVersion: 1, branch: `security/sales-1.0.1-${customer}`, title: `security: update Sales to 1.0.1 for ${customer}`, ...patch
  });
  const target = targetTokens.get(customer);
  const inventory = RuntimeInventorySchema.parse(readJson(`fixtures/${customer}/security-target-runtime-inventory.json`));
  const receipt = DeploymentReceiptSchema.parse(readJson(`fixtures/${customer}/security-target-deployment-receipt.json`));
  const evidence = await deploymentAuthority.verify({
    observe: async () => structuredClone(inventory), receipt: signDeploymentReceipt(receipt, deploymentKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString()),
    applicationBundle: target.application, packageRelease: patchRelease
  });
  assert.equal(fleet.applySecurityPatch(patch, evidence).inventory.platformRelease, "0.2.1");
}
assert.deepEqual(fleet.list().map(({ inventory }) => inventory.platformRelease), ["0.2.1", "0.2.1"]);
assert.deepEqual(fleet.affected("@k-nex/module-sales", "<1.0.1"), []);
const priorUpgrade = readJson("fixtures/customer-beta/previous-release-upgrade.json");
assert.deepEqual(priorUpgrade.platformRelease, { current: "0.1.0", target: "0.2.0" });
assert.equal(priorUpgrade.reviewedMigrationIds.length, 8);
assert.equal(priorUpgrade.preservedArtifacts.length, 8);
assert.equal(priorUpgrade.postgresProof.test, "fixtures/customer-gate-1/tests/previous-release-upgrade-postgres.test.mjs");
const expected = RuntimeInventorySchema.parse(readJson("fixtures/customer-alpha/runtime-inventory.json"));
const restore = readJson("fixtures/customer-alpha/restore-redeployment-proof.json");
assert.equal(restore.backupRestoreFixture, "fixtures/customer-gate-1/tests/backup-restore-postgres.test.mjs");
assert.equal(restore.expectedOperationalInventoryDigest, runtimeInventoryStateDigest(expected));

const target = realpathSync(mkdtempSync(join(tmpdir(), "gate-8-create-knex-app-")));
try {
  const plan = planCreateKnexApplication({ applicationId: "gate-eight-clean", applicationName: "Gate Eight Clean", theme: "minimal", database: "docker-postgres" });
  const applied = applyCreateKnexApplication(plan, target);
  assert.ok(applied.written.includes("k-nex.app.json") && applied.written.includes("compose.yaml"));
  assert.ok(applied.written.includes("src/boot.ts") && applied.written.includes("src/migrations/20260827_000002_knex_bootstrap.ts"));
  assert.deepEqual(ApplicationManifestSchema.parse(JSON.parse(readFileSync(join(target, "k-nex.app.json"), "utf8"))).plugins.map(({ id }) => id), ["module.sales"]);
  assert.equal(applyCreateKnexApplication(plan, target).unchanged.length, Object.keys(plan.files).length);
} finally {
  rmSync(target, { recursive: true, force: true });
}

for (const marker of [
  "# Phase 8 Result", "**Decision:** **READY FOR PHASE REVIEW**", "P8_9_FLEET_EVIDENCE_PASS",
  "Payload Import/Export", "CycloneDX", "signed provenance", "Customer Alpha", "Customer Beta", "DO NOT START DOMAIN EXPANSION"
]) assert.ok(result.includes(marker), `Phase 8 result is missing: ${marker}.`);
for (const task of ["P8.1", "P8.2", "P8.3", "P8.4", "P8.5", "P8.6", "P8.7", "P8.8", "P8.9", "P8.10"]) {
  assert.ok(result.includes(task), `Phase 8 result is missing task mapping: ${task}.`);
}
console.log(JSON.stringify({ gate: "Gate 8", customers: fleet.list().length, affectedDeployments: fleet.affected("@k-nex/module-sales", "<1.0.1").length, patchPlans: 2, priorUpgradeSteps: priorUpgrade.reviewedMigrationIds.length, postgresRecoveryProofs: 2 }, null, 2));
console.log("GATE_8_PASS");
