import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { createCycloneDxSbom, createReleaseProvenance } from "../packages/composition/dist/index.js";
import { createDeploymentReceipt, observeRuntimeInventory } from "../packages/runtime/dist/index.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromComposition = createRequire(resolve(repositoryRoot, "packages/composition/package.json"));
const YAML = requireFromComposition("yaml");
const sourceCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("A full source commit SHA is required.");
const artifactPath = resolve(repositoryRoot, "fixtures/customer-gate-1/packages/k-nex-module-sales-1.0.0.tgz");
const artifact = readFileSync(artifactPath);
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const salesIntegrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;

for (const customer of ["customer-alpha", "customer-beta"]) {
  const root = resolve(repositoryRoot, "fixtures", customer);
  const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const applicationManifest = JSON.parse(readFileSync(resolve(root, "k-nex.app.json"), "utf8"));
  const plan = JSON.parse(readFileSync(resolve(root, ".k-nex/application-plan.json"), "utf8"));
  const overrides = JSON.parse(readFileSync(resolve(root, "customer-overrides.json"), "utf8"));
  const observation = JSON.parse(readFileSync(resolve(root, "deployment-observation.json"), "utf8"));
  const lockContent = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
  const lock = YAML.parse(lockContent);
  const components = Object.entries(packageManifest.dependencies).map(([name, specifier]) => ({ name, version: specifier.replace(/^workspace:/u, "") }));
  const sbom = createCycloneDxSbom(customer, components);
  const sbomContent = canonicalJson(sbom);
  const provenance = createReleaseProvenance({
    subjectName: basename(artifactPath), artifactDigest: sha256(artifact), sourceCommit,
    workflowIdentity: `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${sourceCommit}`,
    materials: [
      { name: "application-manifest", digest: sha256(canonicalJson(applicationManifest)) },
      { name: "lockfile", digest: sha256(lockContent) },
      { name: "resolved-graph-or-plan", digest: sha256(canonicalJson(plan)) },
      { name: "sbom", digest: sha256(sbomContent) }
    ]
  });
  const packageInventory = Object.entries(lock.importers["."].dependencies).map(([name, resolution]) => {
    const version = resolution.specifier.replace(/^workspace:/u, "");
    if (name === "@k-nex/module-sales") return { package: name, version, integrity: salesIntegrity };
    const entry = Object.entries(lock.packages).find(([key]) => key === `${name}@${version}` || key.startsWith(`${name}@${version}(`));
    const integrity = entry?.[1]?.resolution?.integrity;
    return { package: name, version, integrity: integrity ?? sha256(canonicalJson({ name, version, source: resolution.version })) };
  }).sort((left, right) => left.package.localeCompare(right.package));
  const inventory = observeRuntimeInventory({
    schemaVersion: 1,
    applicationId: customer,
    repository: `rootkeystudio/${customer}`,
    environment: observation.environment,
    platformRelease: observation.platformRelease,
    observedAt: observation.observedAt,
    artifactDigest: sha256(artifact),
    releaseEvidence: {
      sourceCommit,
      workflowIdentity: provenance.predicate.workflowIdentity,
      manifestDigest: sha256(canonicalJson(applicationManifest)),
      lockfileDigest: sha256(lockContent),
      resolvedGraphDigest: sha256(canonicalJson(plan)),
      sbomDigest: sha256(sbomContent),
      provenanceDigest: sha256(canonicalJson(provenance))
    },
    packages: packageInventory,
    plugins: applicationManifest.plugins,
    migrationRevision: observation.migrationRevision,
    settings: [{ id: "sales.settings", schemaVersion: 1, revision: 1 }],
    templates: overrides.defaultPages.map((id) => ({ id, templateVersion: 1, revision: 1 })),
    health: { status: "ready", checks: observation.healthChecks }
  });
  const receipt = createDeploymentReceipt({
    inventory,
    deploymentId: observation.deploymentId,
    deployedAt: observation.deployedAt,
    approvedBy: { kind: "workflow", identity: `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${sourceCommit}` },
    smoke: { status: "passed", checks: observation.smokeChecks }
  });
  writeFileSync(resolve(root, "runtime-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  writeFileSync(resolve(root, "deployment-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
