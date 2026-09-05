import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";

import { canonicalJson, supportedFrameworkTuple } from "../packages/contracts/dist/index.js";
import { FleetRegistry, createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createDeploymentReceipt, createPackageReleaseManifestAuthority, observeRuntimeInventory, planPluginUpgrade, signDeploymentReceipt } from "../packages/runtime/dist/index.js";

const sha = "a".repeat(40);
const sri = (value) => `sha512-${createHash("sha512").update(value).digest("base64")}`;
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fixturePackage = "@fixture/module-upgrade";
const release = (version, integrity) => ({ schemaVersion: 1,
  release: { version: "1.0.0", channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" }, framework: supportedFrameworkTuple,
  packages: [{ package: fixturePackage, version, role: "plugin", integrity, peerCompatibility: supportedFrameworkTuple }],
  factoryLockTemplates: {
    minimal: { preset: "sales-reference", theme: "minimal", digest: `sha256:${"1".repeat(64)}` },
    neobrutalism: { preset: "sales-reference", theme: "neobrutalism", digest: `sha256:${"2".repeat(64)}` }
  },
  supportWindow: { policy: "single-current-release", supportedReleases: ["1.0.0"], securityFixes: "all-supported-releases" } });
const prior = release("0.9.0", sri("fixture-prior"));
const target = release("1.0.1", sri("fixture-target"));
const issued = new WeakMap();
const verifier = { async verify(token) { const value = issued.get(token); if (value === undefined) throw new Error("untrusted fixture attestation"); return value; } };
const issue = (value) => { const token = Object.freeze({}); issued.set(token, value); return token; };
const releaseAuthority = createPackageReleaseManifestAuthority(verifier);
const applicationAuthority = createApplicationBundleAuthority(verifier, releaseAuthority);
const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const releaseToken = (manifest) => releaseAuthority.verify(manifest, issue({ subjectDigest: digest(canonicalJson(manifest)), sourceCommit: sha, workflowIdentity: `fixture/release@${sha}`, materials: [] }));
const priorToken = await releaseToken(prior);
const targetToken = await releaseToken(target);
const deploymentAuthority = createDeploymentEvidenceAuthority({ applicationBundleAuthority: applicationAuthority, packageReleaseAuthority: releaseAuthority,
  deploymentPublicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(), trustedDeploymentWorkflow: `fixture/deploy@${sha}` });

const deployment = async (applicationId, manifest, packageRelease, version, integrity, revision) => {
  const installedPackages = [{ package: fixturePackage, version, integrity }];
  const closure = canonicalJson(installedPackages);
  const sbom = canonicalJson({ components: installedPackages.map((entry) => ({ name: entry.package, version: entry.version, hashes: [{ alg: "SHA-512", content: Buffer.from(entry.integrity.slice(7), "base64").toString("hex") }] })) });
  const files = [["application/k-nex.app.json", canonicalJson({ applicationId })], ["application/pnpm-lock.yaml", `${applicationId}:${version}\n`],
    ["evidence/pnpm-lock-runtime-closure.json", closure], ["evidence/sbom.cdx.json", sbom]]
    .map(([path, content]) => ({ path, mode: 0o644, digest: digest(content), content: Buffer.from(content).toString("base64") }));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const releaseManifestDigest = digest(canonicalJson(manifest));
  const bundle = { schemaVersion: 1, format: "k-nex-deployable-application-bundle/v1", applicationId, sourceCommit: sha, release: "1.0.0", releaseManifestDigest,
    closureDigest: digest(closure), frameworkDigest: digest(canonicalJson(supportedFrameworkTuple)), migrationPlanDigest: digest(`fixture:${version}`), targetMigrationRevision: revision, installedPackages, files };
  const attestation = { subjectDigest: digest(canonicalJson(bundle)), sourceCommit: sha, workflowIdentity: `fixture/release@${sha}`, materials: [
    ["application-manifest", "application/k-nex.app.json"], ["lockfile", "application/pnpm-lock.yaml"], ["lock-runtime-closure"], ["resolved-graph-or-plan"], ["sbom", "evidence/sbom.cdx.json"], ["package-release-manifest"], ["release-closure"]
  ].map(([name, path]) => ({ name, digest: path ? byPath.get(path).digest : name === "package-release-manifest" ? releaseManifestDigest : name === "resolved-graph-or-plan" ? bundle.migrationPlanDigest : bundle.closureDigest })) };
  const applicationBundle = await applicationAuthority.verify(bundle, issue(attestation), packageRelease);
  const inventory = observeRuntimeInventory({ schemaVersion: 1, applicationId, repository: `fixture/${applicationId}`, environment: "test", platformRelease: "1.0.0", observedAt: `2026-09-01T00:0${revision}:00.000Z`, artifactDigest: attestation.subjectDigest,
    releaseEvidence: { sourceCommit: sha, workflowIdentity: `fixture/release@${sha}`, manifestDigest: byPath.get("application/k-nex.app.json").digest, lockfileDigest: byPath.get("application/pnpm-lock.yaml").digest, resolvedGraphDigest: bundle.migrationPlanDigest, frameworkDigest: bundle.frameworkDigest, sbomDigest: byPath.get("evidence/sbom.cdx.json").digest, provenanceDigest: digest(canonicalJson(attestation)) },
    packages: installedPackages, plugins: [{ id: "module.fixture", package: fixturePackage, version, enabled: true }], migrationRevision: revision, settings: [], templates: [], health: { status: "ready", checks: ["fixture"] } });
  const receipt = createDeploymentReceipt({ inventory, deploymentId: `fixture:${applicationId}:${revision}`, deployedAt: `2026-09-01T00:0${revision}:30.000Z`, approvedBy: { kind: "workflow", identity: `fixture/deploy@${sha}` }, smoke: { status: "passed", checks: ["fixture"] } });
  return { applicationBundle, evidence: await deploymentAuthority.verify({ observe: async () => structuredClone(inventory), receipt: signDeploymentReceipt(receipt, privateKey), applicationBundle, packageRelease }) };
};

const upgrade = planPluginUpgrade({ pluginId: "module.fixture", packageName: fixturePackage, currentVersion: "0.9.0", targetVersion: "1.0.1", currentPlatformRelease: "1.0.0", targetPlatformRelease: "1.0.0", currentReleaseManifest: prior, targetReleaseManifest: target,
  targets: [{ artifactId: "fixture.settings", kind: "settings", currentRevision: 1, targetRevision: 2 }], migrations: [{ id: "fixture.settings.v2", artifactId: "fixture.settings", kind: "settings", fromRevision: 1, toRevision: 2, predecessorRevisions: [1], migrate: (value) => ({ ...value, revision: 2 }), validate: (value) => value?.revision === 2 }] });
assert.equal(upgrade.ready, true);
const fleet = new FleetRegistry(priorToken, releaseAuthority, applicationAuthority, deploymentAuthority);
const alpha = await deployment("fixture-alpha", prior, priorToken, "0.9.0", sri("fixture-prior"), 1);
const beta = await deployment("fixture-beta", prior, priorToken, "0.9.0", sri("fixture-prior"), 1);
fleet.ingest(alpha.evidence); fleet.ingest(beta.evidence);
assert.equal(fleet.affected(fixturePackage, "<1.0.0").length, 2);
const targetAlpha = await deployment("fixture-alpha", target, targetToken, "1.0.1", sri("fixture-target"), 2);
const targetBeta = await deployment("fixture-beta", target, targetToken, "1.0.1", sri("fixture-target"), 2);
const patches = fleet.planSecurityPatch(fixturePackage, "<1.0.0", "1.0.1", targetToken, [targetAlpha.applicationBundle, targetBeta.applicationBundle]);
assert.equal(patches.length, 2);
fleet.applySecurityPatch(patches[0], targetAlpha.evidence); fleet.applySecurityPatch(patches[1], targetBeta.evidence);
assert.equal(fleet.affected(fixturePackage, "<1.0.0").length, 0);
console.log("P8_NEUTRAL_UPGRADE_FLEET_SECURITY_PASS");
