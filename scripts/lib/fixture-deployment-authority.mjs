import { generateKeyPairSync } from "node:crypto";

import { createReleaseProvenance, signReleaseProvenance } from "../../packages/composition/dist/index.js";
import { createDeploymentEvidenceAuthority, signDeploymentReceipt } from "../../packages/runtime/dist/index.js";

const privatePem = (key) => key.export({ format: "pem", type: "pkcs8" }).toString();
const publicPem = (key) => key.export({ format: "pem", type: "spki" }).toString();

export function createFixtureDeploymentVerifier(sourceCommit) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("Fixture deployment verifier requires an exact source commit.");
  const releaseWorkflow = `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${sourceCommit}`;
  const deploymentWorkflow = `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}`;
  const releaseKeys = generateKeyPairSync("ed25519");
  const deploymentKeys = generateKeyPairSync("ed25519");
  const authority = createDeploymentEvidenceAuthority({
    provenancePublicKey: publicPem(releaseKeys.publicKey), deploymentPublicKey: publicPem(deploymentKeys.publicKey),
    trustedReleaseWorkflow: releaseWorkflow, trustedDeploymentWorkflow: deploymentWorkflow
  });
  return Object.freeze({
    authority,
    async verify(inventory, receipt, observe = async () => structuredClone(inventory)) {
      const salesVersion = inventory.plugins.find(({ id }) => id === "module.sales")?.version;
      if (typeof salesVersion !== "string") throw new Error("Fixture inventory does not declare Sales.");
      const provenance = createReleaseProvenance({
        subjectName: `k-nex-module-sales-${salesVersion}.tgz`, artifactDigest: inventory.artifactDigest, sourceCommit, workflowIdentity: releaseWorkflow,
        materials: [
          { name: "application-manifest", digest: inventory.releaseEvidence.manifestDigest },
          { name: "lockfile", digest: inventory.releaseEvidence.lockfileDigest },
          { name: "resolved-graph-or-plan", digest: inventory.releaseEvidence.resolvedGraphDigest },
          { name: "sbom", digest: inventory.releaseEvidence.sbomDigest }
        ]
      });
      return authority.verify({
        observe,
        receipt: signDeploymentReceipt(receipt, privatePem(deploymentKeys.privateKey)),
        provenance: signReleaseProvenance(provenance, privatePem(releaseKeys.privateKey))
      });
    }
  });
}
