import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import {
  buildPlatformReleaseTransition,
  parseCanonicalPackageReleaseManifest,
  sha256Canonical,
  verifyPlatformReleaseTransitionArtifact
} from "./lib/platform-release-transition.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const integrity = (character) => `sha512-${character.repeat(86)}==`;
const framework = (core) => ({ core, payload: "3.88.0", node: "24.19.0", pnpm: "11.9.0", payloadDatabaseAdapter: "postgres" });
const release = (version, characters, extra = []) => ({
  schemaVersion: 1,
  release: { version, channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" },
  framework: framework(version),
  packages: [
    { package: "@k-nex/module-sales", version, role: "plugin", integrity: integrity(characters[0]), peerCompatibility: framework(version) },
    { package: "@k-nex/runtime", version, role: "core", integrity: integrity(characters[1]), peerCompatibility: framework(version) },
    ...extra
  ].sort((left, right) => left.package.localeCompare(right.package)),
  factoryLockTemplates: {
    minimal: { preset: "sales-reference", theme: "minimal", digest: digest("1") },
    neobrutalism: { preset: "sales-reference", theme: "neobrutalism", digest: digest("2") }
  },
  supportWindow: { policy: "single-current-release", supportedReleases: [version], securityFixes: "all-supported-releases" }
});
const source = parseCanonicalPackageReleaseManifest(canonicalJson(release("1.0.0", "AB")), "source");
const target = parseCanonicalPackageReleaseManifest(canonicalJson(release("1.1.0", "CD")), "target");
const policy = {
  transitionId: "platform:1.0.0-to-1.1.0",
  sourceOnlyDispositions: [],
  generatorAdditions: [],
  pluginIds: [{ package: "@k-nex/module-sales", pluginId: "module.sales" }],
  generator: { package: "@k-nex/runtime", sourceSchemaVersion: 1, targetSchemaVersion: 2, managedOutputContractDigest: digest("3") },
  applicationManifest: { sourceSchemaVersion: 1, targetSchemaVersion: 1 },
  migrations: {
    steps: [{ id: "sales.000029.crm-expand", phase: "online-expand" }, { id: "sales.000030.crm-contract", phase: "offline-required" }],
    deliveryClassification: "maintenance-required", rollbackClassification: "source-restore-required"
  },
  compatibility: {
    storedDocuments: "migration-required", settings: "migration-required", themeProfiles: "compatible",
    hotApplicationHostAbiFrom: "1.0.0", hotApplicationHostAbiTo: "1.1.0",
    themeSkinHostAbiFrom: "1.0.0", themeSkinHostAbiTo: "1.1.0", catalogDigest: digest("4")
  },
  protection: {
    preUpgradeBackup: "fresh-required", maximumBackupAgeSeconds: 3600, cleanRestoreDrill: "required",
    failureRecovery: "restore-source-protection-point", postUpgradeBackup: "required", rollbackWindowSeconds: 86400
  },
  lifecycle: { publishedAt: "2026-09-15T10:00:00.000Z", expiresAt: "2027-09-15T10:00:00.000Z", support: "supported", security: "standard", revocation: { status: "active" } }
};

test("publication deterministically computes exact endpoints, mappings, and migration graph", () => {
  const first = buildPlatformReleaseTransition({ source, target, policy });
  const second = buildPlatformReleaseTransition({ source, target, policy: structuredClone(policy) });
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.source.manifestDigest, source.digest);
  assert.equal(first.target.manifestDigest, target.digest);
  assert.deepEqual(first.packages.map(({ identity, disposition }) => [identity.package, disposition]), [["@k-nex/module-sales", "upgrade"], ["@k-nex/runtime", "upgrade"]]);
  assert.deepEqual(first.migrations.phases, ["online-expand", "offline-required"]);
  assert.equal(first.migrations.graphDigest, sha256Canonical(policy.migrations.steps));
  assert.equal(first.protection.preUpgradeBackup, "fresh-required");
  assert.equal(first.protection.cleanRestoreDrill, "required");
  assert.equal(first.migrations.rollbackClassification, "source-restore-required");
  assert.equal(verifyPlatformReleaseTransitionArtifact(canonicalJson(first), { source, target, policy }).digest, sha256Canonical(first));
});

test("checker rejects tampering, omission, stale endpoints, and noncanonical bytes", () => {
  const manifest = buildPlatformReleaseTransition({ source, target, policy });
  const content = canonicalJson(manifest);
  const omitted = structuredClone(manifest);
  omitted.packages.shift();
  assert.throws(() => verifyPlatformReleaseTransitionArtifact(canonicalJson(omitted), { source, target, policy }), /stale, tampered, or incomplete|missing from the transition mapping/u);
  const tampered = structuredClone(manifest);
  tampered.migrations.graphDigest = digest("f");
  assert.throws(() => verifyPlatformReleaseTransitionArtifact(canonicalJson(tampered), { source, target, policy }), /stale, tampered, or incomplete/u);
  assert.throws(() => verifyPlatformReleaseTransitionArtifact(JSON.stringify(manifest), { source, target, policy }), /canonical JSON bytes/u);
  assert.throws(() => verifyPlatformReleaseTransitionArtifact(content, { source, target: { ...target, digest: digest("e") }, policy }), /endpoint digest does not equal/u);
});

test("publication requires explicit exact difference and plugin policy", () => {
  const addition = { package: "@k-nex/upgrade-tool", version: "1.1.0", role: "tooling", integrity: integrity("E"), peerCompatibility: framework("1.1.0") };
  const targetWithAddition = parseCanonicalPackageReleaseManifest(canonicalJson(release("1.1.0", "CD", [addition])), "target with addition");
  assert.throws(() => buildPlatformReleaseTransition({ source, target: targetWithAddition, policy }), /not an explicit generator addition/u);
  const added = buildPlatformReleaseTransition({ source, target: targetWithAddition, policy: { ...policy, generatorAdditions: ["@k-nex/upgrade-tool"] } });
  assert.equal(added.packages.find(({ identity }) => identity.package === "@k-nex/upgrade-tool").disposition, "add-for-generator");
  assert.throws(() => buildPlatformReleaseTransition({ source, target, policy: { ...policy, pluginIds: [] } }), /Plugin identity policy does not exactly cover/u);
  assert.throws(() => buildPlatformReleaseTransition({ source, target, policy: { ...policy, shell: "pnpm add" } }), /policy fields must be exactly/u);

  const targetWithoutSales = parseCanonicalPackageReleaseManifest(canonicalJson({ ...release("1.1.0", "CD"), packages: release("1.1.0", "CD").packages.filter(({ package: name }) => name !== "@k-nex/module-sales") }), "target without sales");
  assert.throws(() => buildPlatformReleaseTransition({ source, target: targetWithoutSales, policy }), /lacks an explicit removal disposition/u);
  const removed = buildPlatformReleaseTransition({ source, target: targetWithoutSales, policy: { ...policy, sourceOnlyDispositions: [{ package: "@k-nex/module-sales", disposition: "replacement-required" }] } });
  assert.equal(removed.packages.find(({ identity }) => identity.package === "@k-nex/module-sales").disposition, "replacement-required");
});

test("release inputs themselves must be canonical and schema-valid", () => {
  assert.throws(() => parseCanonicalPackageReleaseManifest(JSON.stringify(release("1.0.0", "AB"))), /canonical JSON bytes/u);
  assert.throws(() => parseCanonicalPackageReleaseManifest(canonicalJson({ ...release("1.0.0", "AB"), packages: [] })), /Too small|expected array to have/u);
});
