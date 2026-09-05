import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { createApplicationBundleAuthority, createGitHubHostedAttestationVerifier, createPackageReleaseManifestAuthority } from "../packages/runtime/dist/index.js";
import { assertPhase8ReleaseSnapshot, bundledFile } from "./lib/phase-8-provenance.mjs";

const root = resolve(import.meta.dirname, "..");
const evidence = resolve(process.env.P8_EVIDENCE_ROOT ?? resolve(root, "release-evidence/phase-8-v1"));
const customers = ["customer-alpha", "customer-beta"];
const required = [
  resolve(evidence, "release-manifest.json"),
  resolve(evidence, "release-manifest-predicate.json"),
  resolve(evidence, "hosted/manifest/manifest-attestation.jsonl"),
  resolve(evidence, "hosted/manifest-verification.json"),
  resolve(evidence, "hosted/package-manifest/package-manifest-attestation.jsonl"),
  resolve(evidence, "hosted/package-manifest-verification.json"),
  resolve(root, "docs/implementation/phase-8-fleet-evidence.json"),
  ...customers.flatMap((customer) => [
    resolve(evidence, `customers/${customer}/${customer}.application-bundle.json`),
    resolve(evidence, `customers/${customer}/sbom.cdx.json`),
    resolve(evidence, `customers/${customer}/provenance-predicate.json`),
    resolve(evidence, `customers/${customer}/hosted/application/application-attestation.jsonl`),
    resolve(evidence, `customers/${customer}/hosted/application-verification.json`),
    resolve(evidence, `customers/${customer}/hosted/sbom/sbom-attestation.jsonl`),
    resolve(evidence, `customers/${customer}/hosted/sbom-verification.json`),
    resolve(root, `fixtures/${customer}/runtime-inventory.json`),
    resolve(root, `fixtures/${customer}/deployment-receipt.json`),
    resolve(root, `fixtures/${customer}/restore-redeployment-proof.json`)
  ])
];
if (required.some((path) => !existsSync(path))) {
  throw new Error("P8_SIGNED_EVIDENCE_REGENERATION_REQUIRED: run release-evidence.yml and commit the phase-8-v1 artifact, including the package release manifest, both current v1 customer bundles, hosted application/manifest/SBOM attestation bundles, and generated runtime/fleet evidence.");
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const stableVerification = (entries) => entries.map(({ verificationResult }) => ({
  mediaType: verificationResult.mediaType,
  signature: verificationResult.signature,
  statement: verificationResult.statement,
  verifiedIdentity: verificationResult.verifiedIdentity,
  verifiedTimestamps: verificationResult.verifiedTimestamps.map((entry) => ({
    ...entry,
    timestamp: new Date(entry.timestamp).toISOString()
  }))
}));
const verify = (subject, bundle, predicateType, committed) => {
  const fresh = JSON.parse(execFileSync("gh", ["attestation", "verify", subject, "--bundle", bundle,
    "--repo", "rootkeystudio/k-nex-platform-core", "--predicate-type", predicateType, "--format", "json"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  const expected = readJson(committed);
  const statements = new Set(expected.map((entry) => canonicalJson(entry.verificationResult.statement)));
  const selected = fresh.filter((entry) => statements.has(canonicalJson(entry.verificationResult.statement)));
  assert.equal(canonicalJson(stableVerification(selected)), canonicalJson(stableVerification(expected)), `Committed ${predicateType} verification output is stale or does not verify the hosted bundle.`);
  assert.equal(selected.length, 1, `Expected exactly one committed ${predicateType} attestation for ${subject}.`);
  return selected[0];
};

const release = readJson(resolve(root, "releases/1.0.0/package-release-manifest.json"));
assert.equal(release.release.version, "1.0.0");
assert.ok(release.packages.every((entry) => entry.version === "1.0.0"), "The product release must contain only v1.0.0 packages.");
assert.equal(canonicalJson(readJson(resolve(evidence, "release-manifest.json"))), canonicalJson(release));

const manifestVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/release-manifest/v1" });
const applicationVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/provenance/v1" });
const releases = createPackageReleaseManifestAuthority(manifestVerifier);
const applications = createApplicationBundleAuthority(applicationVerifier, releases);
const manifestVerification = verify(resolve(evidence, "release-manifest.json"), resolve(evidence, "hosted/manifest/manifest-attestation.jsonl"), "https://k-nex.dev/release-manifest/v1", resolve(evidence, "hosted/manifest-verification.json"));
assert.equal(canonicalJson(manifestVerification.verificationResult.statement.predicate), canonicalJson(readJson(resolve(evidence, "release-manifest-predicate.json"))), "Hosted manifest attestation must bind the committed manifest predicate exactly.");
const packageManifestVerification = verify(resolve(root, "releases/1.0.0/package-release-manifest.json"), resolve(evidence, "hosted/package-manifest/package-manifest-attestation.jsonl"), "https://k-nex.dev/release-manifest/v1", resolve(evidence, "hosted/package-manifest-verification.json"));
assert.equal(canonicalJson(packageManifestVerification.verificationResult.statement.predicate), canonicalJson(readJson(resolve(evidence, "release-manifest-predicate.json"))), "Hosted package manifest attestation must bind the official release predicate exactly.");
const verifiedRelease = await releases.verify(release, packageManifestVerification);

for (const customer of customers) {
  const location = resolve(evidence, "customers", customer);
  const bundlePath = resolve(location, `${customer}.application-bundle.json`);
  const bundle = readJson(bundlePath);
  const applicationVerification = verify(bundlePath, resolve(location, "hosted/application/application-attestation.jsonl"), "https://k-nex.dev/provenance/v1", resolve(location, "hosted/application-verification.json"));
  const sbomVerification = verify(bundlePath, resolve(location, "hosted/sbom/sbom-attestation.jsonl"), "https://cyclonedx.org/bom", resolve(location, "hosted/sbom-verification.json"));
  assert.equal(canonicalJson(applicationVerification.verificationResult.statement.predicate), canonicalJson(readJson(resolve(location, "provenance-predicate.json"))), `${customer} hosted provenance attestation must bind the committed predicate exactly.`);
  const sbom = readJson(resolve(location, "sbom.cdx.json"));
  assert.equal(canonicalJson(sbomVerification.verificationResult.statement.predicate), canonicalJson(sbom), `${customer} hosted CycloneDX attestation must bind the committed SBOM exactly.`);
  assert.equal(bundle.release, "1.0.0");
  assertPhase8ReleaseSnapshot(root, bundle);
  for (const file of bundle.files) assert.equal(file.digest, digest(Buffer.from(file.content, "base64")), `Bundle file digest differs: ${file.path}`);
  const application = await applications.verify(bundle, applicationVerification, verifiedRelease);
  const attestation = applications.read(application).attestation;
  const materials = new Map(attestation.materials.map(({ name, digest: value }) => [name, value]));
  const appManifest = bundledFile(bundle, "application/k-nex.app.json");
  const lock = bundledFile(bundle, "application/pnpm-lock.yaml");
  const plan = bundledFile(bundle, "application/.k-nex/application-plan.json");
  const bundledSbom = bundledFile(bundle, "evidence/sbom.cdx.json");
  const closure = bundledFile(bundle, "evidence/pnpm-lock-runtime-closure.json");
  const applicationFiles = bundle.files.filter(({ path }) => path.startsWith("application/"));
  const buildFiles = bundle.files.filter(({ path }) => path.startsWith("application/dist/"));
  assert.equal(canonicalJson(sbom), bundledSbom.toString("utf8"));
  assert.equal(materials.get("application-manifest"), digest(appManifest));
  assert.equal(materials.get("lockfile"), digest(lock));
  assert.equal(materials.get("lock-runtime-closure"), bundle.closureDigest);
  assert.equal(materials.get("resolved-graph-or-plan"), digest(canonicalJson(JSON.parse(plan.toString("utf8")))));
  assert.equal(materials.get("sbom"), digest(bundledSbom));
  assert.equal(materials.get("package-release-manifest"), bundle.releaseManifestDigest);
  assert.equal(materials.get("release-closure"), bundle.closureDigest);
  assert.equal(materials.get("generated-application-tree"), digest(canonicalJson(applicationFiles)));
  assert.equal(materials.get("application-build-output"), digest(canonicalJson(buildFiles)));
  assert.equal(digest(closure), bundle.closureDigest);
  assert.ok(readFileSync(resolve(root, `fixtures/${customer}/k-nex.app.json`)).equals(appManifest), `${customer} manifest differs from its signed application bundle.`);
  assert.ok(readFileSync(resolve(root, `fixtures/${customer}/pnpm-lock.yaml`)).equals(lock), `${customer} lock differs from its signed application bundle.`);
  assert.equal(canonicalJson(readJson(resolve(root, `fixtures/${customer}/.k-nex/application-plan.json`))), canonicalJson(JSON.parse(plan.toString("utf8"))), `${customer} plan differs from its signed application bundle.`);
}
const generatedPaths = [
  resolve(root, "docs/implementation/phase-8-fleet-evidence.json"),
  ...customers.flatMap((customer) => [
    resolve(root, `fixtures/${customer}/runtime-inventory.json`),
    resolve(root, `fixtures/${customer}/deployment-receipt.json`),
    resolve(root, `fixtures/${customer}/restore-redeployment-proof.json`)
  ])
];
const before = new Map(generatedPaths.map((path) => [path, readFileSync(path)]));
let stale = [];
try {
  execFileSync(process.execPath, ["scripts/generate-phase-8-deployment-evidence.mjs"], { cwd: root, stdio: "pipe" });
  stale = generatedPaths.filter((path) => !before.get(path).equals(readFileSync(path)));
} finally {
  for (const [path, content] of before) writeFileSync(path, content);
}
assert.deepEqual(stale, [], `Phase 8 current-v1 generated evidence is stale: ${stale.join(", ")}`);
console.log("P8_GENERATED_EVIDENCE_CLEAN");
