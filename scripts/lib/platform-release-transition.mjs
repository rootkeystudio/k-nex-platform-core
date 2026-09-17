import { createHash } from "node:crypto";

import {
  PackageReleaseManifestSchema,
  PlatformReleaseTransitionManifestSchema,
  canonicalJson,
  validatePlatformReleaseTransition
} from "../../packages/contracts/dist/index.js";

const packageNamePattern = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u;
const pluginIdPattern = /^(?:module|provider|builder|theme|integration|preset)(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sourceDisposition = new Set(["remove", "replacement-required"]);

export const sha256Canonical = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/**
 * The generator is the package that emits the application tree. The factory
 * and the upgrade compiler both live in Composition, and create-knex-app
 * imports them from there, so ownership records and the managed-output
 * contract digest must name it: binding them to Runtime meant a Composition
 * change could rewrite every generated file without moving either.
 */
export const generatorPackage = "@k-nex/composition";

/**
 * The attested 1.0.0 composition archive ships exactly this ordered migration
 * registry. It is a frozen historical fact rather than a live derivation: the
 * 1.0 factory cannot change. Every release-authority input derives the 1.0
 * side of a transition from this list, and the P13.9 preparation proof
 * reproduces the 1.0 factory from its accepted commit to re-prove it.
 */
export const acceptedSourceMigrationRegistry = Object.freeze([
  "20260827_000001_sales_baseline",
  "20260827_000002_knex_bootstrap",
  "20260829_000007_runtime_extensions",
  "20260901_000019_authorization",
  "20260901_000022_static_lifecycle_admission",
  "20260902_000023_system_administration",
  "20260903_000026_workspace_pages",
  "20260903_000027_event_outbox",
  "20260904_000028_workspace_sidebar_preferences"
]);

/**
 * Registry order is migration identity order. The shipped compiler boundary
 * declares migration paths in two arrays (platform and domain), so the target
 * registry is their identity-ordered union; the P13.9 preparation proof
 * asserts this derivation against the src/migrations/index.ts the factory
 * actually emits.
 */
export function factoryMigrationRegistry(boundary) {
  return [...boundary.platformPaths, ...boundary.migrationPaths]
    .filter((path) => /^src\/migrations\/(?!index\.ts$)[^/]+\.ts$/u.test(path))
    .map((path) => path.slice("src/migrations/".length, -".ts".length))
    .sort();
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function exactKeys(value, keys, label) {
  const object = record(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new TypeError(`${label} fields must be exactly: ${expected.join(", ")}.`);
  return object;
}

function string(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function uniqueEntries(values, key, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array.`);
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    const identity = key(value, index);
    if (seen.has(identity)) throw new TypeError(`${label} contains duplicate ${identity}.`);
    seen.add(identity);
  }
  return values;
}

function parsePolicy(input) {
  const policy = exactKeys(input, ["transitionId", "sourceOnlyDispositions", "generatorAdditions", "pluginIds", "generator", "applicationManifest", "migrations", "compatibility", "protection", "lifecycle"], "policy");
  const sourceOnlyDispositions = uniqueEntries(policy.sourceOnlyDispositions, (entry, index) => {
    const item = exactKeys(entry, ["package", "disposition"], `policy.sourceOnlyDispositions[${index}]`);
    string(item.package, `policy.sourceOnlyDispositions[${index}].package`, packageNamePattern);
    if (!sourceDisposition.has(item.disposition)) throw new TypeError(`policy.sourceOnlyDispositions[${index}].disposition is invalid.`);
    return item.package;
  }, "policy.sourceOnlyDispositions");
  const generatorAdditions = uniqueEntries(policy.generatorAdditions, (entry, index) => string(entry, `policy.generatorAdditions[${index}]`, packageNamePattern), "policy.generatorAdditions");
  const pluginIds = uniqueEntries(policy.pluginIds, (entry, index) => {
    const item = exactKeys(entry, ["package", "pluginId"], `policy.pluginIds[${index}]`);
    string(item.package, `policy.pluginIds[${index}].package`, packageNamePattern);
    string(item.pluginId, `policy.pluginIds[${index}].pluginId`, pluginIdPattern);
    return item.package;
  }, "policy.pluginIds");
  if (new Set(pluginIds.map(({ pluginId }) => pluginId)).size !== pluginIds.length) throw new TypeError("policy.pluginIds contains a duplicate pluginId.");
  exactKeys(policy.generator, ["package", "sourceSchemaVersion", "targetSchemaVersion", "managedOutputContractDigest"], "policy.generator");
  exactKeys(policy.applicationManifest, ["sourceSchemaVersion", "targetSchemaVersion"], "policy.applicationManifest");
  exactKeys(policy.migrations, ["steps", "deliveryClassification", "rollbackClassification"], "policy.migrations");
  uniqueEntries(policy.migrations.steps, (entry, index) => exactKeys(entry, ["id", "phase"], `policy.migrations.steps[${index}]`).id, "policy.migrations.steps");
  exactKeys(policy.compatibility, ["storedDocuments", "settings", "themeProfiles", "hotApplicationHostAbiFrom", "hotApplicationHostAbiTo", "themeSkinHostAbiFrom", "themeSkinHostAbiTo", "catalogDigest"], "policy.compatibility");
  exactKeys(policy.protection, ["preUpgradeBackup", "maximumBackupAgeSeconds", "cleanRestoreDrill", "failureRecovery", "postUpgradeBackup", "rollbackWindowSeconds"], "policy.protection");
  exactKeys(policy.lifecycle, ["publishedAt", "expiresAt", "support", "security", "revocation"], "policy.lifecycle");
  const revocation = record(policy.lifecycle.revocation, "policy.lifecycle.revocation");
  exactKeys(revocation, revocation.status === "active" ? ["status"] : ["status", "revokedAt", "reasonCode"], "policy.lifecycle.revocation");
  string(policy.transitionId, "policy.transitionId", /^[a-z0-9][a-z0-9._:-]{2,159}$/u);
  string(policy.generator.package, "policy.generator.package", packageNamePattern);
  string(policy.generator.managedOutputContractDigest, "policy.generator.managedOutputContractDigest", digestPattern);
  string(policy.compatibility.catalogDigest, "policy.compatibility.catalogDigest", digestPattern);
  return { ...policy, sourceOnlyDispositions, generatorAdditions, pluginIds };
}

export function parseCanonicalPackageReleaseManifest(content, label = "package release manifest") {
  if (typeof content !== "string") throw new TypeError(`${label} content must be a string.`);
  const manifest = PackageReleaseManifestSchema.parse(JSON.parse(content));
  if (content !== canonicalJson(manifest)) throw new TypeError(`${label} must use canonical JSON bytes.`);
  return Object.freeze({ manifest, digest: sha256Canonical(manifest) });
}

export function buildPlatformReleaseTransition({ source, target, policy: policyInput }) {
  const policy = parsePolicy(policyInput);
  for (const [label, endpoint] of [["source", source], ["target", target]]) {
    const manifest = PackageReleaseManifestSchema.parse(endpoint?.manifest);
    if (endpoint?.digest !== sha256Canonical(manifest)) throw new TypeError(`${label} endpoint digest does not equal its canonical release manifest.`);
  }
  const sourcePackages = new Map(source.manifest.packages.map((entry) => [entry.package, entry]));
  const targetPackages = new Map(target.manifest.packages.map((entry) => [entry.package, entry]));
  const sourceOnly = new Map(policy.sourceOnlyDispositions.map((entry) => [entry.package, entry.disposition]));
  const additions = new Set(policy.generatorAdditions);
  const pluginIds = new Map(policy.pluginIds.map((entry) => [entry.package, entry.pluginId]));
  const packageNames = [...new Set([...sourcePackages.keys(), ...targetPackages.keys()])].sort();

  const packages = packageNames.map((packageName) => {
    const sourcePackage = sourcePackages.get(packageName);
    const targetPackage = targetPackages.get(packageName);
    if (sourcePackage !== undefined && targetPackage !== undefined && sourcePackage.role !== targetPackage.role) throw new TypeError(`Package role changed across releases: ${packageName}.`);
    const role = sourcePackage?.role ?? targetPackage?.role;
    const pluginId = pluginIds.get(packageName);
    if ((role === "plugin") !== (pluginId !== undefined)) throw new TypeError(`Plugin identity policy does not exactly cover ${packageName}.`);
    const identity = { package: packageName, role, ...(pluginId === undefined ? {} : { pluginId }) };
    if (sourcePackage !== undefined && targetPackage !== undefined) return { identity, disposition: "upgrade", source: { version: sourcePackage.version, integrity: sourcePackage.integrity }, target: { version: targetPackage.version, integrity: targetPackage.integrity } };
    if (targetPackage !== undefined) {
      if (!additions.delete(packageName)) throw new TypeError(`Target-only package is not an explicit generator addition: ${packageName}.`);
      return { identity, disposition: "add-for-generator", target: { version: targetPackage.version, integrity: targetPackage.integrity } };
    }
    const disposition = sourceOnly.get(packageName);
    if (sourcePackage === undefined || disposition === undefined) throw new TypeError(`Source-only package lacks an explicit removal disposition: ${packageName}.`);
    sourceOnly.delete(packageName);
    return { identity, disposition, source: { version: sourcePackage.version, integrity: sourcePackage.integrity } };
  });
  if (additions.size > 0 || sourceOnly.size > 0) throw new TypeError("Package disposition policy contains entries absent from the exact endpoint difference.");
  for (const packageName of pluginIds.keys()) if (!packageNames.includes(packageName)) throw new TypeError(`Plugin identity policy contains unknown package ${packageName}.`);

  const generatorMapping = packages.find(({ identity }) => identity.package === policy.generator.package);
  if (generatorMapping?.disposition !== "upgrade") throw new TypeError("Generator package must be present in both release closures.");
  const phases = [...new Set(policy.migrations.steps.map(({ phase }) => phase))];
  const transition = PlatformReleaseTransitionManifestSchema.parse({
    $schema: "../../schemas/platform-release-transition-manifest.v1.schema.json",
    schemaVersion: 1,
    transitionId: policy.transitionId,
    source: { release: source.manifest.release.version, manifestDigest: source.digest },
    target: { release: target.manifest.release.version, manifestDigest: target.digest },
    directPredecessors: [source.manifest.release.version],
    packages,
    generator: {
      package: policy.generator.package,
      sourceVersion: generatorMapping.source.version,
      targetVersion: generatorMapping.target.version,
      sourceSchemaVersion: policy.generator.sourceSchemaVersion,
      targetSchemaVersion: policy.generator.targetSchemaVersion,
      managedOutputContractDigest: policy.generator.managedOutputContractDigest
    },
    applicationManifest: policy.applicationManifest,
    framework: { source: source.manifest.framework, target: target.manifest.framework },
    migrations: { graphDigest: sha256Canonical(policy.migrations.steps), phases, steps: policy.migrations.steps, deliveryClassification: policy.migrations.deliveryClassification, rollbackClassification: policy.migrations.rollbackClassification },
    compatibility: policy.compatibility,
    protection: policy.protection,
    lifecycle: policy.lifecycle
  });
  validatePlatformReleaseTransition(transition, source, target, transition.lifecycle.publishedAt);
  return transition;
}

export function verifyPlatformReleaseTransitionArtifact(content, input) {
  if (typeof content !== "string") throw new TypeError("Transition artifact content must be a string.");
  const actual = PlatformReleaseTransitionManifestSchema.parse(JSON.parse(content));
  if (content !== canonicalJson(actual)) throw new TypeError("Transition artifact must use canonical JSON bytes.");
  const expected = buildPlatformReleaseTransition(input);
  if (content !== canonicalJson(expected)) throw new TypeError("Transition artifact is stale, tampered, or incomplete.");
  return Object.freeze({ manifest: actual, digest: sha256Canonical(actual) });
}
