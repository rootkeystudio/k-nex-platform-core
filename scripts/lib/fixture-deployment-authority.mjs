import { createHash, generateKeyPairSync } from "node:crypto";

import { canonicalJson } from "../../packages/contracts/dist/index.js";
import {
  createDeploymentEvidenceAuthority, createPackageReleaseManifestAuthority, runtimeInventoryDigest, signDeploymentReceipt
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
  const authority = createDeploymentEvidenceAuthority({
    releaseVerifier, packageReleaseAuthority, deploymentPublicKey: publicPem(deploymentKeys.publicKey), trustedDeploymentWorkflow: deploymentWorkflow
  });
  return Object.freeze({
    authority,
    packageReleaseAuthority,
    async verifyManifest(manifest) {
      return packageReleaseAuthority.verify(manifest, issue({ subjectDigest: sha256(canonicalJson(manifest)), sourceCommit, workflowIdentity: releaseWorkflow, materials: [] }));
    },
    async verify(inventory, receipt, packageRelease, observe = async () => structuredClone(inventory)) {
      const verifiedManifest = packageReleaseAuthority.read(packageRelease);
      const attestation = {
        subjectDigest: inventory.artifactDigest, sourceCommit, workflowIdentity: releaseWorkflow,
        materials: [
          { name: "application-manifest", digest: inventory.releaseEvidence.manifestDigest },
          { name: "lockfile", digest: inventory.releaseEvidence.lockfileDigest },
          { name: "resolved-graph-or-plan", digest: inventory.releaseEvidence.resolvedGraphDigest },
          { name: "sbom", digest: inventory.releaseEvidence.sbomDigest },
          { name: "package-release-manifest", digest: verifiedManifest.digest }
        ]
      };
      const observed = structuredClone(await observe());
      observed.releaseEvidence = { ...observed.releaseEvidence, provenanceDigest: sha256(canonicalJson(attestation)) };
      const boundReceipt = { ...receipt, inventoryDigest: runtimeInventoryDigest(observed) };
      return authority.verify({
        observe: async () => observed,
        receipt: signDeploymentReceipt(boundReceipt, privatePem(deploymentKeys.privateKey)),
        releaseAttestation: issue(attestation), packageRelease
      });
    }
  });
}
