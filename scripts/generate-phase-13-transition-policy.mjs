#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalJson, platformReleaseGeneratorContractDigest } from "../packages/contracts/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
};
const sourcePath = option("--source", "releases/1.0.0/package-release-manifest.json");
const targetPath = option("--target", "releases/1.1.0/package-release-manifest.json");
const fixturePath = option("--fixture", "fixtures/customer-gate-1/src/migrations/index.ts");
const migrationTestPath = option("--migration-test", "fixtures/customer-gate-1/tests/p13-9-upgrade-backup-restore-postgres.test.mjs");
const migrationSetPath = option("--migration-set", "docs/implementation/phase-13-migration-set.json");
const phase8VerificationPath = option("--phase8-verification", "release-evidence/phase-8-v1/hosted/package-manifest-verification.json");
const sourceTrustOutput = option("--source-trust-output");
const outputPath = option("--output");
const options = ["--source", "--target", "--fixture", "--migration-test", "--migration-set", "--phase8-verification", "--source-trust-output", "--output"];
if (outputPath === undefined || args.some((arg, index) => arg.startsWith("--") &&
  !options.includes(arg) || options.includes(arg) && (index === args.length - 1 || args[index + 1]?.startsWith("--")))) {
  throw new TypeError("Usage: generate-phase-13-transition-policy.mjs --output <policy.json> [--source <manifest>] [--target <manifest>] [--fixture <migration-index>] [--migration-test <p13.9-test>] [--migration-set <manifest>] [--phase8-verification <verification.json>] [--source-trust-output <trust.json>]");
}

const digest = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const source = readJson(sourcePath);
const target = readJson(targetPath);
assert.equal(canonicalJson(source), readFileSync(resolve(root, sourcePath), "utf8"), "Source release manifest must be canonical JSON.");
assert.equal(canonicalJson(target), readFileSync(resolve(root, targetPath), "utf8"), "Target release manifest must be canonical JSON.");
assert.equal(source.release.version, "1.0.0", "Transition source must be the accepted 1.0.0 release.");
assert.equal(target.release.version, "1.1.0", "Transition target must be the current 1.1.0 release.");

const acceptedSource = Object.freeze({
  release: "1.0.0",
  manifestDigest: "sha256:1d8b40e0073fb24d42f47bc3a0fd763db0a0fb5baf706120f7fe3a2768c13eea",
  sourceCommit: "c8fe7f2518c219957297155e307768837186ec5f",
  workflowIdentity: "rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@c8fe7f2518c219957297155e307768837186ec5f",
  predicateType: "https://k-nex.dev/release-manifest/v1"
});
assert.equal(digest(source), acceptedSource.manifestDigest, "Accepted source manifest digest changed; stop for explicit release review.");
const phase8Verification = readJson(phase8VerificationPath);
assert.ok(Array.isArray(phase8Verification), "Committed Phase 8 source verification must be an array.");
const sourceStatements = phase8Verification.filter((entry) => {
  const statement = entry?.verificationResult?.statement;
  const subject = statement?.subject;
  const predicate = statement?.predicate;
  return statement?._type === "https://in-toto.io/Statement/v1" && statement?.predicateType === acceptedSource.predicateType &&
    subject?.length === 1 && subject[0]?.name === "package-release-manifest.json" && `sha256:${subject[0]?.digest?.sha256}` === acceptedSource.manifestDigest &&
    predicate?.release === acceptedSource.release && predicate?.sourceCommit === acceptedSource.sourceCommit && predicate?.workflowIdentity === acceptedSource.workflowIdentity;
});
assert.ok(sourceStatements.length > 0, "Committed Phase 8 verification does not contain the accepted 1.0 source identity.");
assert.equal(new Set(sourceStatements.map((entry) => canonicalJson(entry.verificationResult.statement))).size, 1, "Committed Phase 8 source attestations are not cryptographically equivalent.");
if (sourceTrustOutput !== undefined) {
  const trustOutput = resolve(root, sourceTrustOutput);
  mkdirSync(dirname(trustOutput), { recursive: true });
  writeFileSync(trustOutput, canonicalJson({ schemaVersion: 1, ...acceptedSource, verificationPath: phase8VerificationPath, equivalentStatementCount: sourceStatements.length }), "utf8");
}

function namedArray(sourceText, name) {
  const start = sourceText.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `Migration source does not declare ${name}.`);
  const end = sourceText.indexOf("];", start);
  assert.ok(end > start, `Migration source has an unterminated ${name}.`);
  return [...sourceText.slice(start, end).matchAll(/"([^"\n]+)"/gu)].map(([, value]) => value);
}

const fixtureSource = readFileSync(resolve(root, fixturePath), "utf8");
const fixtureNames = [...fixtureSource.matchAll(/name: "([^"\n]+)"/gu)].map(([, value]) => value);
assert.equal(fixtureNames.length, 33, "Phase13 fixture migration registry must contain the complete ordered chain.");
const migrationTest = readFileSync(resolve(root, migrationTestPath), "utf8");
const predecessorNames = namedArray(migrationTest, "predecessorNames");
const phase13MigrationNames = namedArray(migrationTest, "phase13MigrationNames");
const migrationSet = readJson(migrationSetPath);
assert.equal(canonicalJson(migrationSet), readFileSync(resolve(root, migrationSetPath), "utf8"), "Accepted Phase13 migration-set manifest must be canonical JSON.");
assert.deepEqual(Object.keys(migrationSet).sort(), ["$schema", "schemaVersion", "sourceRelease", "targetRelease", "steps"].sort(), "Accepted Phase13 migration-set manifest fields changed.");
assert.equal(migrationSet.schemaVersion, 1, "Accepted Phase13 migration-set schema changed.");
assert.equal(migrationSet.sourceRelease, source.release.version, "Accepted Phase13 migration-set source release changed.");
assert.equal(migrationSet.targetRelease, target.release.version, "Accepted Phase13 migration-set target release changed.");
assert.ok(Array.isArray(migrationSet.steps), "Accepted Phase13 migration-set steps must be an array.");
for (const [index, step] of migrationSet.steps.entries()) {
  assert.deepEqual(Object.keys(step).sort(), ["id", "phase"], `Accepted Phase13 migration-set step ${index} fields changed.`);
  assert.match(step.id, /^[0-9]{8}_[0-9]{6}_[a-z0-9_]+$/u, `Accepted Phase13 migration-set step ${index} ID is invalid.`);
  assert.equal(step.phase, "offline-required", `Accepted Phase13 migration-set step ${index} phase changed.`);
}
assert.equal(migrationSet.steps.length, 7, "Accepted Phase13 migration-set length changed; stop for explicit migration review.");
assert.deepEqual(phase13MigrationNames, migrationSet.steps.map(({ id }) => id), "Executable P13.9 migration split differs from the accepted migration-set manifest.");
assert.deepEqual(fixtureNames, [...predecessorNames, ...migrationSet.steps.map(({ id }) => id)], "Phase13 migration policy must use the exact current fixture order and executable predecessor split.");
assert.equal(predecessorNames.length, 26, "Accepted predecessor migration prefix changed; stop for an explicit migration review.");

const sourcePackages = new Map(source.packages.map((entry) => [entry.package, entry]));
const targetPackages = new Map(target.packages.map((entry) => [entry.package, entry]));
assert.deepEqual([...sourcePackages.keys()].sort(), [...targetPackages.keys()].sort(), "Release transition package sets must remain lockstep.");
for (const [packageName, sourcePackage] of sourcePackages) {
  const targetPackage = targetPackages.get(packageName);
  assert.equal(sourcePackage.version, source.release.version, `Source package ${packageName} is outside source release.`);
  assert.equal(targetPackage?.version, target.release.version, `Target package ${packageName} is outside target release.`);
}
const sourceGenerator = sourcePackages.get("@k-nex/runtime");
const targetGenerator = targetPackages.get("@k-nex/runtime");
assert.ok(sourceGenerator && targetGenerator, "Release transition generator package is missing.");

const policy = {
  transitionId: "platform:1.0.0-to-1.1.0",
  sourceOnlyDispositions: [],
  generatorAdditions: [],
  pluginIds: [{ package: "@k-nex/module-sales", pluginId: "module.sales" }],
  generator: {
    package: "@k-nex/runtime",
    sourceSchemaVersion: 1,
    targetSchemaVersion: 2,
    managedOutputContractDigest: platformReleaseGeneratorContractDigest(sourceGenerator, targetGenerator)
  },
  applicationManifest: { sourceSchemaVersion: 1, targetSchemaVersion: 1 },
  migrations: {
    steps: migrationSet.steps,
    deliveryClassification: "maintenance-required",
    rollbackClassification: "source-restore-required"
  },
  compatibility: {
    storedDocuments: "migration-required",
    settings: "migration-required",
    themeProfiles: "compatible",
    hotApplicationHostAbiFrom: "1.0.0",
    hotApplicationHostAbiTo: "1.1.0",
    themeSkinHostAbiFrom: "1.0.0",
    themeSkinHostAbiTo: "1.1.0",
    catalogDigest: digest({ packages: target.packages })
  },
  protection: {
    preUpgradeBackup: "fresh-required",
    maximumBackupAgeSeconds: 3_600,
    cleanRestoreDrill: "required",
    failureRecovery: "restore-source-protection-point",
    postUpgradeBackup: "required",
    rollbackWindowSeconds: 86_400
  },
  lifecycle: {
    publishedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2027-09-15T00:00:00.000Z",
    support: "supported",
    security: "standard",
    revocation: { status: "active" }
  }
};

const output = resolve(root, outputPath);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, canonicalJson(policy), "utf8");
process.stdout.write(`PHASE13_TRANSITION_POLICY_GENERATED ${policy.transitionId} ${phase13MigrationNames.length}\n`);
