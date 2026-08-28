import { createHash, generateKeyPairSync } from "node:crypto";

import { canonicalJson } from "../../packages/contracts/dist/index.js";
import { createCycloneDxSbom } from "../../packages/composition/dist/index.js";
import {
  createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createPackageReleaseManifestAuthority, runtimeInventoryDigest, signDeploymentReceipt
} from "../../packages/runtime/dist/index.js";

const privatePem = (key) => key.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = (key) => key.export({ format: "pem", type: "spki" }).toString();
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const file = (path, content) => ({ path, mode: 0o644, digest: sha256(content), content: Buffer.from(content).toString("base64") });

function completeBundle(bundle) {
  const installedPackages = [...bundle.installedPackages].sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
  const closure = canonicalJson(installedPackages);
  const sbom = canonicalJson(createCycloneDxSbom(bundle.applicationId, installedPackages.map(({ package: name, version, integrity }) => ({ name, version, integrity }))));
  const files = [...bundle.files.filter(({ path }) => !["application/k-nex.app.json", "application/pnpm-lock.yaml", "evidence/sbom.cdx.json", "evidence/pnpm-lock-runtime-closure.json"].includes(path)),
    file("application/k-nex.app.json", canonicalJson({ applicationId: bundle.applicationId })), file("application/pnpm-lock.yaml", `fixture-lock:${bundle.applicationId}\n`),
    file("evidence/sbom.cdx.json", sbom), file("evidence/pnpm-lock-runtime-closure.json", closure)].sort((left, right) => left.path.localeCompare(right.path));
  return { ...bundle, closureDigest: sha256(closure), installedPackages, files };
}

// Test-only adapter. Production Gate 8 consumes GitHub/Sigstore verification output.
export function createFixtureDeploymentVerifier(sourceCommit) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("Fixture deployment verifier requires an exact source commit.");
  const releaseWorkflow = `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${sourceCommit}`;
  const deploymentWorkflow = `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}`;
  const deploymentKeys = generateKeyPairSync("ed25519");
  const issued = new WeakMap();
  const releaseVerifier = Object.freeze({
    async verify(token) {
      const value = token !== null && typeof token === "object" ? issued.get(token) : undefined;
      if (value === undefined) throw new Error("Fixture hosted attestation was not issued by the test adapter.");
      return value;
    }
  });
  const issue = (value) => { const token = Object.freeze({}); issued.set(token, Object.freeze(value)); return token; };
  const packageReleaseAuthority = createPackageReleaseManifestAuthority(releaseVerifier);
  const applicationBundleAuthority = createApplicationBundleAuthority(releaseVerifier, packageReleaseAuthority);
  const authority = createDeploymentEvidenceAuthority({
    applicationBundleAuthority, packageReleaseAuthority, deploymentPublicKey: publicPem(deploymentKeys.publicKey), trustedDeploymentWorkflow: deploymentWorkflow
  });
  const verifyApplicationBundle = async (bundle, packageRelease) => {
    bundle = completeBundle(bundle);
    const verifiedManifest = packageReleaseAuthority.read(packageRelease);
    const byPath = new Map(bundle.files.map((entry) => [entry.path, entry]));
    const attestation = {
      subjectDigest: sha256(canonicalJson(bundle)), sourceCommit, workflowIdentity: releaseWorkflow,
      materials: [
        { name: "application-manifest", digest: byPath.get("application/k-nex.app.json").digest },
        { name: "lockfile", digest: byPath.get("application/pnpm-lock.yaml").digest },
        { name: "lock-runtime-closure", digest: bundle.closureDigest },
        { name: "resolved-graph-or-plan", digest: bundle.migrationPlanDigest },
        { name: "sbom", digest: byPath.get("evidence/sbom.cdx.json").digest },
        { name: "package-release-manifest", digest: verifiedManifest.digest },
        { name: "release-closure", digest: bundle.closureDigest }
      ]
    };
    return applicationBundleAuthority.verify(bundle, issue(attestation), packageRelease);
  };
  const verifyTargetApplication = async (inventory, packageRelease, installedPackages, targetMigrationRevision, migrationPlanDigest = inventory.releaseEvidence.resolvedGraphDigest) => {
    const release = packageReleaseAuthority.read(packageRelease);
    const sorted = [...installedPackages].sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
    return verifyApplicationBundle({
      schemaVersion: 1, format: "k-nex-deployable-application-bundle/v1", applicationId: inventory.applicationId, sourceCommit,
      release: release.manifest.release.version, releaseManifestDigest: release.digest, closureDigest: sha256(canonicalJson(sorted)),
      frameworkDigest: sha256(canonicalJson(release.manifest.framework)), migrationPlanDigest,
      targetMigrationRevision, installedPackages: sorted, files: []
    }, packageRelease);
  };
  return Object.freeze({
    authority,
    applicationBundleAuthority,
    packageReleaseAuthority,
    verifyApplicationBundle,
    verifyTargetApplication,
    async verifyManifest(manifest) {
      return packageReleaseAuthority.verify(manifest, issue({ subjectDigest: sha256(canonicalJson(manifest)), sourceCommit, workflowIdentity: releaseWorkflow, materials: [] }));
    },
    async verify(inventory, receipt, packageRelease, observe = async () => structuredClone(inventory)) {
      const verifiedManifest = packageReleaseAuthority.read(packageRelease);
      const installedPackages = [...inventory.packages].sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
      const bundle = completeBundle({
        schemaVersion: 1, format: "k-nex-deployable-application-bundle/v1", applicationId: inventory.applicationId, sourceCommit,
        release: inventory.platformRelease, releaseManifestDigest: verifiedManifest.digest, closureDigest: sha256(canonicalJson(installedPackages)),
        frameworkDigest: inventory.releaseEvidence.frameworkDigest, migrationPlanDigest: inventory.releaseEvidence.resolvedGraphDigest,
        targetMigrationRevision: inventory.migrationRevision, installedPackages, files: []
      });
      const byPath = new Map(bundle.files.map((entry) => [entry.path, entry]));
      const attestation = {
        subjectDigest: sha256(canonicalJson(bundle)), sourceCommit, workflowIdentity: releaseWorkflow,
        materials: [
          { name: "application-manifest", digest: byPath.get("application/k-nex.app.json").digest },
          { name: "lockfile", digest: byPath.get("application/pnpm-lock.yaml").digest },
          { name: "lock-runtime-closure", digest: bundle.closureDigest },
          { name: "resolved-graph-or-plan", digest: inventory.releaseEvidence.resolvedGraphDigest },
          { name: "sbom", digest: byPath.get("evidence/sbom.cdx.json").digest },
          { name: "package-release-manifest", digest: verifiedManifest.digest },
          { name: "release-closure", digest: bundle.closureDigest }
        ]
      };
      const applicationBundle = await applicationBundleAuthority.verify(bundle, issue(attestation), packageRelease);
      const observed = structuredClone(await observe());
      observed.artifactDigest = sha256(canonicalJson(bundle));
      observed.releaseEvidence = { ...observed.releaseEvidence, manifestDigest: byPath.get("application/k-nex.app.json").digest,
        lockfileDigest: byPath.get("application/pnpm-lock.yaml").digest, sbomDigest: byPath.get("evidence/sbom.cdx.json").digest,
        provenanceDigest: sha256(canonicalJson(attestation)) };
      const boundReceipt = { ...receipt, artifactDigest: observed.artifactDigest, inventoryDigest: runtimeInventoryDigest(observed) };
      return authority.verify({
        observe: async () => observed,
        receipt: signDeploymentReceipt(boundReceipt, privatePem(deploymentKeys.privateKey)),
        applicationBundle, packageRelease
      });
    }
  });
}
