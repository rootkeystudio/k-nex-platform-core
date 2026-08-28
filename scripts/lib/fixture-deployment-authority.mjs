import { createHash, generateKeyPairSync } from "node:crypto";

import { canonicalJson } from "../../packages/contracts/dist/index.js";
import {
  createApplicationBundleAuthority, createDeploymentEvidenceAuthority, createPackageReleaseManifestAuthority, runtimeInventoryDigest, signDeploymentReceipt
} from "../../packages/runtime/dist/index.js";

const privatePem = (key) => key.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = (key) => key.export({ format: "pem", type: "spki" }).toString();
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

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
    const verifiedManifest = packageReleaseAuthority.read(packageRelease);
    const attestation = {
      subjectDigest: sha256(canonicalJson(bundle)), sourceCommit, workflowIdentity: releaseWorkflow,
      materials: [
        { name: "application-manifest", digest: bundle.files.find(({ path }) => path === "application/k-nex.app.json")?.digest ?? sha256("manifest") },
        { name: "lockfile", digest: bundle.files.find(({ path }) => path === "application/pnpm-lock.yaml")?.digest ?? sha256("lock") },
        { name: "resolved-graph-or-plan", digest: bundle.migrationPlanDigest },
        { name: "sbom", digest: sha256("sbom") },
        { name: "package-release-manifest", digest: verifiedManifest.digest }
      ]
    };
    return applicationBundleAuthority.verify(bundle, issue(attestation), packageRelease);
  };
  const verifyTargetApplication = async (inventory, packageRelease, installedPackages, targetMigrationRevision, migrationPlanDigest = inventory.releaseEvidence.resolvedGraphDigest) => {
    const release = packageReleaseAuthority.read(packageRelease);
    const sorted = [...installedPackages].filter(({ package: packageName }) => packageName.startsWith("@k-nex/")).sort((left, right) => left.package.localeCompare(right.package));
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
      const installedPackages = inventory.packages.filter(({ package: packageName }) => packageName.startsWith("@k-nex/")).sort((left, right) => left.package.localeCompare(right.package));
      const bundle = {
        schemaVersion: 1, format: "k-nex-deployable-application-bundle/v1", applicationId: inventory.applicationId, sourceCommit,
        release: inventory.platformRelease, releaseManifestDigest: verifiedManifest.digest, closureDigest: sha256(canonicalJson(installedPackages)),
        frameworkDigest: inventory.releaseEvidence.frameworkDigest, migrationPlanDigest: inventory.releaseEvidence.resolvedGraphDigest,
        targetMigrationRevision: inventory.migrationRevision, installedPackages, files: []
      };
      const attestation = {
        subjectDigest: sha256(canonicalJson(bundle)), sourceCommit, workflowIdentity: releaseWorkflow,
        materials: [
          { name: "application-manifest", digest: inventory.releaseEvidence.manifestDigest },
          { name: "lockfile", digest: inventory.releaseEvidence.lockfileDigest },
          { name: "resolved-graph-or-plan", digest: inventory.releaseEvidence.resolvedGraphDigest },
          { name: "sbom", digest: inventory.releaseEvidence.sbomDigest },
          { name: "package-release-manifest", digest: verifiedManifest.digest }
        ]
      };
      const applicationBundle = await applicationBundleAuthority.verify(bundle, issue(attestation), packageRelease);
      const observed = structuredClone(await observe());
      observed.artifactDigest = sha256(canonicalJson(bundle));
      observed.releaseEvidence = { ...observed.releaseEvidence, provenanceDigest: sha256(canonicalJson(attestation)) };
      const boundReceipt = { ...receipt, artifactDigest: observed.artifactDigest, inventoryDigest: runtimeInventoryDigest(observed) };
      return authority.verify({
        observe: async () => observed,
        receipt: signDeploymentReceipt(boundReceipt, privatePem(deploymentKeys.privateKey)),
        applicationBundle, packageRelease
      });
    }
  });
}
