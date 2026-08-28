import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { createCycloneDxSbom, resolvePnpmLock } from "../packages/composition/dist/index.js";
import { createDeploymentReceipt, createGitHubHostedAttestationVerifier, observeRuntimeInventory } from "../packages/runtime/dist/index.js";
import { assertPhase8SourceRelease, sourceFile } from "./lib/phase-8-provenance.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("A full source commit SHA is required.");
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
assertPhase8SourceRelease(repositoryRoot, sourceCommit);
const hostedVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/provenance/v1" });

for (const customer of ["customer-alpha", "customer-beta"]) {
  const root = resolve(repositoryRoot, "fixtures", customer);
  const manifestPath = `fixtures/${customer}/k-nex.app.json`;
  const lockPath = `fixtures/${customer}/pnpm-lock.yaml`;
  const planPath = `fixtures/${customer}/.k-nex/application-plan.json`;
  const applicationManifest = JSON.parse(sourceFile(repositoryRoot, sourceCommit, manifestPath).toString("utf8"));
  const salesVersion = applicationManifest.plugins.find(({ id }) => id === "module.sales")?.version;
  if (typeof salesVersion !== "string") throw new Error(`${customer} does not declare Sales.`);
  const hostedRoot = resolve(repositoryRoot, "release-evidence/phase-8", customer === "customer-alpha" ? "" : "customer-beta");
  const bundle = JSON.parse(readFileSync(resolve(hostedRoot, `${customer}.application-bundle.json`), "utf8"));
  const verification = JSON.parse(readFileSync(resolve(hostedRoot, "hosted/application-verification.json"), "utf8"));
  const attestation = await hostedVerifier.verify(verification[0]);
  const plan = JSON.parse(sourceFile(repositoryRoot, sourceCommit, planPath).toString("utf8"));
  const overrides = JSON.parse(readFileSync(resolve(root, "customer-overrides.json"), "utf8"));
  const observation = JSON.parse(readFileSync(resolve(root, "deployment-observation.json"), "utf8"));
  const lockContent = sourceFile(repositoryRoot, sourceCommit, lockPath).toString("utf8");
  assert.equal(canonicalJson(JSON.parse(readFileSync(resolve(root, "k-nex.app.json"), "utf8"))), canonicalJson(applicationManifest), `${manifestPath} differs from source commit.`);
  assert.equal(canonicalJson(JSON.parse(readFileSync(resolve(root, ".k-nex/application-plan.json"), "utf8"))), canonicalJson(plan), `${planPath} differs from source commit.`);
  assert.equal(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"), lockContent, `${lockPath} differs from source commit.`);
  assert.equal(bundle.sourceCommit, sourceCommit);
  const resolvedLock = resolvePnpmLock(lockContent);
  const salesRef = `pkg:npm/%40k-nex/module-sales@${salesVersion}`;
  const sbom = createCycloneDxSbom(customer, resolvedLock.components, resolvedLock.dependencies, [...resolvedLock.rootDependencies, salesRef]);
  const sbomContent = canonicalJson(sbom);
  const packageInventory = resolvedLock.components.map(({ name, version, integrity }) => ({ package: name, version, integrity }))
    .sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
  const inventory = observeRuntimeInventory({
    schemaVersion: 1,
    applicationId: customer,
    repository: `rootkeystudio/${customer}`,
    environment: observation.environment,
    platformRelease: observation.platformRelease,
    observedAt: observation.observedAt,
    artifactDigest: sha256(canonicalJson(bundle)),
    releaseEvidence: {
      sourceCommit,
      workflowIdentity: attestation.workflowIdentity,
      manifestDigest: sha256(canonicalJson(applicationManifest)),
      lockfileDigest: sha256(lockContent),
      resolvedGraphDigest: sha256(canonicalJson(plan)),
      frameworkDigest: bundle.frameworkDigest,
      sbomDigest: sha256(sbomContent),
      provenanceDigest: sha256(canonicalJson(attestation))
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
