import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { canonicalApplicationReleaseLock, canonicalGeneratedFileOwnershipManifest, canonicalJson } from "../../../packages/contracts/dist/index.js";
import { applicationUpgradeCompilerDigests, compileApplicationUpgrade, planUpgradeTargetKnexApplication } from "../../../packages/composition/dist/index.js";
import { buildPlatformReleaseTransition, parseCanonicalPackageReleaseManifest } from "../../../scripts/lib/platform-release-transition.mjs";
import { materializePreparedTreeAtomic, ownershipFromFactoryPlan, phase13UpgradePreparationDigests, readRepositorySnapshot, releaseLockFromFactoryPlan, targetGenerationFromFactoryPlan } from "../../../scripts/lib/phase-13-upgrade-preparation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const nodePath = "/Users/canersevince/.nvm/versions/node/v24.19.0/bin";
const acceptedSourceCommit = "c8fe7f2518c219957297155e307768837186ec5f";
const roots = [];
const digest = phase13UpgradePreparationDigests.value;
const encode = (value) => new TextEncoder().encode(value);
const decode = (value) => new TextDecoder().decode(value);
const cloneFiles = (files) => Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.kind === "symlink" ? file : { kind: "file", bytes: new Uint8Array(file.bytes) }]));
const migrationNames = (source) => [...source.matchAll(/name: "([^"\n]+)"/gu)].map(([, name]) => name);
const frozenPredecessorMigrationNames = [
  "20260826_000001_gate1", "20260826_000002_sales_sources", "20260826_000003_payload_mcp", "20260826_000004_event_outbox",
  "20260826_000005_outbox_processor", "20260827_000006_sales_opportunities", "20260829_000007_runtime_extensions",
  "20260829_000008_app_storage", "20260829_000009_extension_activation", "20260829_000010_theme_skin_profiles",
  "20260829_000011_static_deployment", "20260829_000012_verified_artifacts", "20260829_000013_catalog_checkpoints",
  "20260829_000014_theme_skin_verified_artifacts", "20260829_000015_extension_capability_authority",
  "20260829_000016_extension_security_quarantine", "20260829_000017_static_release_authority", "20260829_000018_runner_quarantine",
  "20260901_000019_authorization_storage", "20260901_000020_template_tombstones", "20260901_000021_authorization_outbox",
  "20260901_000022_static_lifecycle_admission", "20260902_000023_system_settings", "20260902_000024_catalog_mirror",
  "20260902_000025_system_operations", "20260903_000026_workspace_pages"
];
const frozenPhase13MigrationNames = [
  "20260905_000027_crm_core",
  "20260907_000030_pipeline_saved_views",
  "20260907_000031_data_movement",
  "20260908_000032_communications",
  "20260908_000033_crm_workflows",
  "20260908_000034_reports",
  "20260909_000035_static_rebind_lock_protocol"
];
function planWithMigrations(plan, directory) {
  const migrationSnapshot = readRepositorySnapshot(directory);
  const files = Object.fromEntries(Object.entries(plan.files).filter(([path]) => !path.startsWith("src/migrations/")));
  for (const [path, file] of Object.entries(migrationSnapshot)) {
    if (file.kind !== "file") throw new TypeError(`Migration fixture contains symlink ${path}.`);
    files[`src/migrations/${path}`] = decode(file.bytes);
  }
  return { ...plan, files };
}
function writePlanMigrations(plan, target) {
  rmSync(resolve(target, "src/migrations"), { recursive: true, force: true });
  for (const [path, content] of Object.entries(plan.files).filter(([path]) => path.startsWith("src/migrations/"))) {
    const output = resolve(target, path); mkdirSync(resolve(output, ".."), { recursive: true }); writeFileSync(output, content);
  }
}

function verifiedRelease(manifest) {
  const token = Object.freeze({});
  const record = Object.freeze({ manifest, digest: digest(manifest), attestation: Object.freeze({ localExactArtifact: true }) });
  return { authority: { read(candidate) { if (candidate !== token) throw new TypeError("unverified release"); return record; } }, token };
}

function authority(record) {
  const token = Object.freeze({}); const records = new WeakMap([[token, Object.freeze(record)]]);
  return { token, authority: { read(candidate) { const value = records.get(candidate); if (value === undefined) throw new TypeError("unverified token"); return value; } } };
}

function sourceBinding(applicationId, sourceCommit, sourceLock, transition) {
  return { applicationId, sourceCommit, applicationManifestSchemaVersion: transition.applicationManifest.sourceSchemaVersion, sourceReleaseLockDigest: digest(sourceLock), packageAndLockClosureDigest: digest(sourceLock.packages), applicationManifestPluginGraphDigest: digest(sourceLock.plugins) };
}

function compileInput({ sourceFiles, sourceCommit, sourceLock, sourceOwnership, transition, targetRelease, targetGeneration }) {
  const sourceAuth = authority({ files: sourceFiles, digest: applicationUpgradeCompilerDigests.repository(sourceFiles), binding: sourceBinding(sourceLock.applicationId, sourceCommit, sourceLock, transition) });
  const transitionAuth = authority({ manifest: transition, digest: digest(transition), attestation: Object.freeze({ localExactCanonicalPolicy: true }) });
  const releaseAuth = authority({ manifest: targetRelease, digest: digest(targetRelease), attestation: Object.freeze({ localExactArtifact: true }) });
  const sourceApplicationManifest = JSON.parse(decode(sourceFiles["k-nex.app.json"].bytes));
  const targetAuth = authority({ generation: targetGeneration, digest: applicationUpgradeCompilerDigests.targetGeneration(targetGeneration), provenance: {
    sourceApplicationManifestDigest: digest(sourceApplicationManifest), sourceCommit, sourceTreeDigest: applicationUpgradeCompilerDigests.repository(sourceFiles)
  } });
  const inventory = { packages: sourceLock.packages, plugins: sourceLock.plugins };
  return {
    expectedSourceCommit: sourceCommit, actualSourceCommit: sourceCommit, sourceSnapshotAuthority: sourceAuth.authority, sourceSnapshotToken: sourceAuth.token,
    currentFilesDigest: applicationUpgradeCompilerDigests.repository(sourceFiles), sourceReleaseLock: sourceLock, sourceReleaseLockDigest: digest(sourceLock),
    sourceOwnership, sourceOwnershipDigest: digest(sourceOwnership), installedInventory: inventory, installedInventoryDigest: digest(inventory),
    transitionAuthority: transitionAuth.authority, transitionToken: transitionAuth.token, transitionManifestDigest: digest(transition),
    targetReleaseAuthority: releaseAuth.authority, targetReleaseToken: releaseAuth.token, targetReleaseManifestDigest: digest(targetRelease), evaluatedAt: "2026-09-16T00:00:00.000Z",
    targetGenerationAuthority: targetAuth.authority, targetGenerationToken: targetAuth.token, targetGenerationDigest: applicationUpgradeCompilerDigests.targetGeneration(targetGeneration)
  };
}

test("P13.9 prepares an exact generated 1.0.0 repository for deterministic 1.1.0 upgrade without touching source", { timeout: 120_000 }, async (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p13-9-upgrade-repository-"))); roots.push(root);
  context.after(() => {
    for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  });
  const oldTree = join(root, "accepted-source");
  execFileSync("git", ["worktree", "add", "--detach", oldTree, acceptedSourceCommit], { cwd: repositoryRoot, stdio: "ignore" });
  context.after(() => { try { execFileSync("git", ["worktree", "remove", "--force", oldTree], { cwd: repositoryRoot, stdio: "ignore" }); } catch {} });
  execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"], { cwd: oldTree, env: { ...process.env, PATH: `${nodePath}:${process.env.PATH}` }, stdio: "ignore" });
  execFileSync("pnpm", ["--filter", "@k-nex/composition", "build"], { cwd: oldTree, env: { ...process.env, PATH: `${nodePath}:${process.env.PATH}` }, stdio: "ignore" });
  const predecessorFactory = await import(`${pathToFileURL(join(oldTree, "packages/composition/dist/application-factory.js")).href}?p139=${Date.now()}`);

  const sourceContent = readFileSync(resolve(repositoryRoot, "releases/1.0.0/package-release-manifest.json"), "utf8");
  const targetContent = readFileSync(resolve(repositoryRoot, "releases/1.1.0/package-release-manifest.json"), "utf8");
  const sourceEndpoint = parseCanonicalPackageReleaseManifest(sourceContent, "source release");
  const targetEndpoint = parseCanonicalPackageReleaseManifest(targetContent, "target release");
  const mirror = resolve(repositoryRoot, "fixtures/customer-gate-1/packages");
  const sourceVerified = verifiedRelease(sourceEndpoint.manifest); const targetVerified = verifiedRelease(targetEndpoint.manifest);
  assert.equal(sourceEndpoint.manifest.packages.length, 17, "Accepted 1.0 release must contain exact 17-package train.");
  const options = { applicationId: "p139-upgrade-customer", applicationName: "P13.9 Upgrade Customer", theme: "minimal", database: "external" };
  const rawSourcePlan = predecessorFactory.planCreateKnexApplication({ ...options, packageSource: { kind: "packed-mirror", directory: mirror, authority: sourceVerified.authority, release: sourceVerified.token } });
  assert.ok(rawSourcePlan.files["src/migrations/20260903_000027_event_outbox.ts"], "Accepted 1.0 factory output must include event-outbox migration.");
  assert.ok(rawSourcePlan.files["src/migrations/20260904_000028_workspace_sidebar_preferences.ts"], "Accepted 1.0 factory output must include workspace-sidebar migration.");
  assert.equal(Object.keys(rawSourcePlan.artifactDigests).length, 17, "Frozen 1.0 factory must verify all 17 archive identities.");
  for (const entry of sourceEndpoint.manifest.packages) assert.equal(`sha512-${createHash("sha512").update(readFileSync(resolve(mirror, `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`))).digest("base64")}`, entry.integrity);
  assert.equal(`sha256:${createHash("sha256").update(rawSourcePlan.files["pnpm-lock.yaml"]).digest("hex")}`, sourceEndpoint.manifest.factoryLockTemplates.minimal.digest, "Frozen 1.0 factory lock must be exact.");
  const sourcePlan = planWithMigrations(rawSourcePlan, resolve(oldTree, "fixtures/customer-gate-1/src/migrations"));
  const predecessorNames = migrationNames(sourcePlan.files["src/migrations/index.ts"]);
  assert.deepEqual(predecessorNames, frozenPredecessorMigrationNames, "Accepted Phase 12 migration identities/order changed.");
  assert.deepEqual(Object.keys(sourcePlan.files).filter((path) => /^src\/migrations\/.*\.ts$/u.test(path) && path !== "src/migrations/index.ts").map((path) => path.slice("src/migrations/".length, -3)).sort(), [...frozenPredecessorMigrationNames].sort(), "Accepted Phase 12 migration path closure has extras or omissions.");
  const sourceDirectory = join(root, "source-repository"); predecessorFactory.applyCreateKnexApplication(rawSourcePlan, sourceDirectory); writePlanMigrations(sourcePlan, sourceDirectory);
  const sourceManifest = JSON.parse(sourcePlan.files["k-nex.app.json"]);
  assert.deepEqual(sourceManifest.plugins.map(({ id }) => id), ["module.sales"]); assert.deepEqual(sourceManifest.providers, {});
  const verifiedSourceApplicationManifest = authority({ manifest: sourceManifest, digest: digest(sourceManifest) });
  const rawTargetPlan = planUpgradeTargetKnexApplication({
    packageSource: { kind: "packed-mirror", directory: mirror, authority: targetVerified.authority, release: targetVerified.token },
    sourceManifestAuthority: verifiedSourceApplicationManifest.authority, sourceManifest: verifiedSourceApplicationManifest.token, sourceManifestDigest: digest(sourceManifest)
  });
  const targetApplicationManifest = JSON.parse(rawTargetPlan.files["k-nex.app.json"]); const targetPackageVersions = new Map(targetEndpoint.manifest.packages.map((entry) => [entry.package, entry.version]));
  const expectedTargetApplicationManifest = structuredClone(sourceManifest);
  expectedTargetApplicationManifest.plugins = expectedTargetApplicationManifest.plugins.map((plugin) => ({ ...plugin, version: targetPackageVersions.get(plugin.package) }));
  expectedTargetApplicationManifest.providers = Object.fromEntries(Object.entries(expectedTargetApplicationManifest.providers).map(([capability, provider]) => [capability, { ...provider, version: targetPackageVersions.get(provider.package) }]));
  expectedTargetApplicationManifest.builder.version = targetPackageVersions.get(expectedTargetApplicationManifest.builder.package);
  expectedTargetApplicationManifest.themes.version = targetPackageVersions.get(expectedTargetApplicationManifest.themes.package);
  expectedTargetApplicationManifest.runtime.node = targetEndpoint.manifest.framework.node; expectedTargetApplicationManifest.runtime.packageManagerVersion = targetEndpoint.manifest.framework.pnpm;
  assert.deepEqual(targetApplicationManifest, expectedTargetApplicationManifest, "Upgrade target may change only target-authorized schema/package/framework version fields.");
  const targetPlan = planWithMigrations(rawTargetPlan, resolve(repositoryRoot, "fixtures/customer-gate-1/src/migrations"));
  const targetNames = migrationNames(targetPlan.files["src/migrations/index.ts"]); const additionNames = targetNames.slice(predecessorNames.length);
  assert.equal(targetNames.length, 33); assert.deepEqual(targetNames.slice(0, 26), predecessorNames); assert.deepEqual(additionNames, frozenPhase13MigrationNames, "Phase 13 append identities/order changed.");
  assert.deepEqual(JSON.parse(targetPlan.files["k-nex.app.json"]).plugins.map(({ id }) => id), ["module.sales"]); assert.doesNotMatch(targetPlan.files["src/k-nex-registry.ts"], /provider\.realtime|kNexRealtimeRegistry/u);
  const policyPath = join(root, "transition-policy.json");
  execFileSync(process.execPath, [resolve(repositoryRoot, "scripts/generate-phase-13-transition-policy.mjs"), "--output", policyPath], { cwd: repositoryRoot, env: { ...process.env, PATH: `${nodePath}:${process.env.PATH}` }, stdio: "ignore" });
  const policy = JSON.parse(readFileSync(policyPath, "utf8")); const transition = buildPlatformReleaseTransition({ source: sourceEndpoint, target: targetEndpoint, policy });
  assert.deepEqual(transition.migrations.steps.map(({ id }) => id), additionNames); assert.equal(transition.migrations.graphDigest, digest(transition.migrations.steps));
  for (const name of predecessorNames) assert.equal(targetPlan.files[`src/migrations/${name}.ts`], sourcePlan.files[`src/migrations/${name}.ts`], `Predecessor migration ${name} changed bytes.`);
  assert.deepEqual(Object.keys(targetPlan.files).filter((path) => /^src\/migrations\/.*\.ts$/u.test(path) && path !== "src/migrations/index.ts").map((path) => path.slice("src/migrations/".length, -3)).sort(), [...targetNames].sort(), "Target migration path closure has extras or omissions.");
  const sourceOwnership = ownershipFromFactoryPlan({ plan: sourcePlan, release: sourceEndpoint.manifest });
  const sourceMigrationSetDigest = digest(sourceOwnership.files.filter(({ mode }) => mode === "append-only").map(({ path, digest: fileDigest }) => ({ path, digest: fileDigest })));
  const sourceLock = releaseLockFromFactoryPlan({ plan: sourcePlan, release: sourceEndpoint.manifest, releaseManifestDigest: sourceEndpoint.digest, ownership: sourceOwnership, migrationSetDigest: sourceMigrationSetDigest });
  mkdirSync(join(sourceDirectory, ".k-nex"), { recursive: true });
  writeFileSync(join(sourceDirectory, ".k-nex/generated-files.json"), canonicalGeneratedFileOwnershipManifest(sourceOwnership));
  writeFileSync(join(sourceDirectory, ".k-nex/release-lock.json"), canonicalApplicationReleaseLock(sourceLock));
  writeFileSync(join(sourceDirectory, "k-nex.config.ts"), "export const customerOverride = 'preserved';\n");
  writeFileSync(join(sourceDirectory, ".env.example"), `${readFileSync(join(sourceDirectory, ".env.example"), "utf8")}CUSTOMER_TEMPLATE_VALUE=kept\n`);
  mkdirSync(join(sourceDirectory, "customer")); writeFileSync(join(sourceDirectory, "customer/custom.ts"), "export const customerCode = true;\n");
  execFileSync("git", ["init", "-q"], { cwd: sourceDirectory }); execFileSync("git", ["config", "user.email", "p139@example.invalid"], { cwd: sourceDirectory }); execFileSync("git", ["config", "user.name", "P13.9 Fixture"], { cwd: sourceDirectory });
  execFileSync("git", ["add", "."], { cwd: sourceDirectory }); execFileSync("git", ["commit", "-qm", "accepted generated 1.0.0 source"], { cwd: sourceDirectory });
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceDirectory, encoding: "utf8" }).trim();
  const sourceFiles = readRepositorySnapshot(sourceDirectory); const untouchedDigest = applicationUpgradeCompilerDigests.repository(sourceFiles);

  const targetOwnership = ownershipFromFactoryPlan({ plan: targetPlan, release: targetEndpoint.manifest, previousOwnership: sourceOwnership });
  const transitionDigest = digest(transition);
  const targetLock = releaseLockFromFactoryPlan({ plan: targetPlan, release: targetEndpoint.manifest, releaseManifestDigest: targetEndpoint.digest, ownership: targetOwnership, migrationSetDigest: transition.migrations.graphDigest, transitionChain: [{ transitionId: transition.transitionId, sourceRelease: transition.source.release, targetRelease: transition.target.release, manifestDigest: transitionDigest }] });
  assert.equal(targetLock.migrationSetDigest, transition.migrations.graphDigest); assert.deepEqual(targetLock.plugins.map(({ id }) => id), sourceLock.plugins.map(({ id }) => id));
  const targetGeneration = targetGenerationFromFactoryPlan({ plan: targetPlan, release: targetEndpoint.manifest, releaseContent: targetContent, releaseLock: targetLock, ownership: targetOwnership, packageMirror: mirror, previousFiles: sourceFiles });
  const input = compileInput({ sourceFiles, sourceCommit, sourceLock, sourceOwnership, transition, targetRelease: targetEndpoint.manifest, targetGeneration });
  const first = compileApplicationUpgrade(input); const replay = compileApplicationUpgrade(input);
  assert.equal(first.outcome, "prepared"); assert.deepEqual(replay.plan, first.plan);
  assert.ok(first.plan.operations.some(({ kind }) => kind === "append"), "Upgrade must append Phase 13 migrations.");
  assert.equal(applicationUpgradeCompilerDigests.repository(readRepositorySnapshot(sourceDirectory)), untouchedDigest, "Pure preparation must not mutate source checkout.");
  const preparedA = join(root, "prepared-a"); const preparedB = join(root, "prepared-b");
  assert.equal(materializePreparedTreeAtomic(first.preparedFiles, preparedA), first.evidence.preparedTreeDigest); assert.equal(materializePreparedTreeAtomic(first.preparedFiles, preparedB), first.evidence.preparedTreeDigest);
  assert.equal(readFileSync(join(preparedA, "k-nex.config.ts"), "utf8"), "export const customerOverride = 'preserved';\n");
  assert.equal(readFileSync(join(preparedA, "customer/custom.ts"), "utf8"), "export const customerCode = true;\n");
  assert.match(readFileSync(join(preparedA, ".env.example"), "utf8"), /CUSTOMER_TEMPLATE_VALUE=kept/u);
  assert.equal(readFileSync(join(preparedA, "src/k-nex-registry.ts"), "utf8"), targetPlan.files["src/k-nex-registry.ts"]);
  assert.equal(readFileSync(join(preparedA, "package.json"), "utf8"), targetPlan.files["package.json"]);
  assert.equal(readFileSync(join(preparedA, "pnpm-lock.yaml"), "utf8"), targetPlan.files["pnpm-lock.yaml"]);
  assert.equal(readFileSync(join(preparedA, ".k-nex/generated-files.json"), "utf8"), canonicalGeneratedFileOwnershipManifest(targetOwnership));
  assert.equal(readFileSync(join(preparedA, ".k-nex/release-lock.json"), "utf8"), canonicalApplicationReleaseLock(targetLock));
  assert.equal(readFileSync(join(preparedA, ".k-nex/application-plan.json"), "utf8"), targetPlan.files[".k-nex/application-plan.json"]);
  assert.equal(readFileSync(join(preparedA, ".k-nex/package-release-manifest.json"), "utf8"), targetContent);
  assert.equal(Object.keys(readRepositorySnapshot(preparedA)).filter((path) => path.startsWith(".k-nex/packages/")).length, targetEndpoint.manifest.packages.length, "Prepared archive closure must contain target packages only.");
  for (const record of targetOwnership.files) {
    const actual = readFileSync(join(preparedA, record.path));
    const preserved = record.mode === "template" || record.mode === "append-only" && record.producer.version === "1.0.0";
    const expected = preserved ? sourceFiles[record.path].bytes : encode(targetPlan.files[record.path]);
    assert.deepEqual(actual, Buffer.from(expected), `Prepared ${record.path} must equal ${preserved ? "preserved source" : "fresh target generator"} bytes.`);
  }

  const managedPath = sourceOwnership.files.find(({ mode }) => mode === "managed").path;
  const modified = cloneFiles(sourceFiles); modified[managedPath] = { kind: "file", bytes: encode("customer modified managed") };
  assert.equal(compileApplicationUpgrade(compileInput({ sourceFiles: modified, sourceCommit, sourceLock, sourceOwnership, transition, targetRelease: targetEndpoint.manifest, targetGeneration })).outcome, "blocked");
  const targetOnly = targetOwnership.files.find(({ path }) => !sourceOwnership.files.some((source) => source.path === path)).path;
  const collision = cloneFiles(sourceFiles); collision[targetOnly] = { kind: "file", bytes: encode("customer collision") };
  assert.equal(compileApplicationUpgrade(compileInput({ sourceFiles: collision, sourceCommit, sourceLock, sourceOwnership, transition, targetRelease: targetEndpoint.manifest, targetGeneration })).outcome, "blocked");
  assert.throws(() => compileApplicationUpgrade({ ...input, actualSourceCommit: "f".repeat(40) }));
  assert.throws(() => compileApplicationUpgrade({ ...input, sourceReleaseLockDigest: `sha256:${"0".repeat(64)}` }));
  assert.throws(() => compileApplicationUpgrade({ ...input, installedInventory: { packages: [], plugins: [] }, installedInventoryDigest: digest({ packages: [], plugins: [] }) }));
  const symlink = cloneFiles(sourceFiles); symlink["customer/link"] = { kind: "symlink" };
  assert.throws(() => compileApplicationUpgrade(compileInput({ sourceFiles: symlink, sourceCommit, sourceLock, sourceOwnership, transition, targetRelease: targetEndpoint.manifest, targetGeneration })));
  const occupied = join(root, "occupied"); mkdirSync(occupied); writeFileSync(join(occupied, "sentinel"), "keep");
  assert.throws(() => materializePreparedTreeAtomic(first.preparedFiles, occupied)); assert.equal(readFileSync(join(occupied, "sentinel"), "utf8"), "keep");
  assert.equal(applicationUpgradeCompilerDigests.repository(readRepositorySnapshot(sourceDirectory)), untouchedDigest, "All negative preparation paths must leave source untouched.");
});
