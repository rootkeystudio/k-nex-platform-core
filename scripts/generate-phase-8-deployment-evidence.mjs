import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { resolvePnpmLock } from "../packages/composition/dist/index.js";
import { createDeploymentReceipt, createGitHubHostedAttestationVerifier, observeRuntimeInventory } from "../packages/runtime/dist/index.js";
import { assertPhase8ReleaseSnapshot } from "./lib/phase-8-provenance.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("A full source commit SHA is required.");
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const hostedVerifier = createGitHubHostedAttestationVerifier({ repository: "rootkeystudio/k-nex-platform-core", workflow: "release-evidence.yml", predicateType: "https://k-nex.dev/provenance/v1" });
const bundledText = (bundle, path) => {
  const file = bundle.files.find((entry) => entry.path === path);
  if (file === undefined || file.digest !== sha256(Buffer.from(file.content, "base64"))) throw new Error(`Hosted bundle file is missing or invalid: ${path}`);
  return Buffer.from(file.content, "base64").toString("utf8");
};

for (const [customer, target] of [["customer-alpha", false], ["customer-beta", false], ["customer-alpha", true], ["customer-beta", true]]) {
  const root = resolve(repositoryRoot, "fixtures", customer);
  const manifestPath = `fixtures/${customer}/k-nex.app.json`;
  const lockPath = `fixtures/${customer}/pnpm-lock.yaml`;
  const planPath = `fixtures/${customer}/.k-nex/application-plan.json`;
  const hostedRoot = target ? resolve(repositoryRoot, "release-evidence/phase-8/targets", customer) :
    resolve(repositoryRoot, "release-evidence/phase-8", customer === "customer-alpha" ? "" : "customer-beta");
  const bundle = JSON.parse(readFileSync(resolve(hostedRoot, `${customer}.application-bundle.json`), "utf8"));
  assert.equal(bundle.sourceCommit, sourceCommit);
  assertPhase8ReleaseSnapshot(repositoryRoot, bundle);
  const applicationManifest = JSON.parse(bundledText(bundle, "application/k-nex.app.json"));
  const salesVersion = applicationManifest.plugins.find(({ id }) => id === "module.sales")?.version;
  if (typeof salesVersion !== "string") throw new Error(`${customer} does not declare Sales.`);
  const verification = JSON.parse(readFileSync(resolve(hostedRoot, "hosted/application-verification.json"), "utf8"));
  const attestation = await hostedVerifier.verify(verification[0]);
  const materials = new Map(attestation.materials.map(({ name, digest }) => [name, digest]));
  const plan = JSON.parse(bundledText(bundle, "application/.k-nex/application-plan.json"));
  const overrides = JSON.parse(readFileSync(resolve(root, "customer-overrides.json"), "utf8"));
  const currentObservation = JSON.parse(readFileSync(resolve(root, "deployment-observation.json"), "utf8"));
  const observation = target ? { ...currentObservation, platformRelease: "0.2.1", migrationRevision: 8,
    deploymentId: `deploy:${customer}:security-0.2.1`, observedAt: customer === "customer-alpha" ? "2026-08-27T13:00:00.000Z" : "2026-08-27T13:10:00.000Z",
    deployedAt: customer === "customer-alpha" ? "2026-08-27T13:05:00.000Z" : "2026-08-27T13:15:00.000Z" } : currentObservation;
  const lockContent = bundledText(bundle, "application/pnpm-lock.yaml");
  if (!target) {
    assert.equal(canonicalJson(JSON.parse(readFileSync(resolve(root, "k-nex.app.json"), "utf8"))), canonicalJson(applicationManifest), `${manifestPath} differs from the signed application bundle.`);
    assert.equal(canonicalJson(JSON.parse(readFileSync(resolve(root, ".k-nex/application-plan.json"), "utf8"))), canonicalJson(plan), `${planPath} differs from the signed application bundle.`);
    assert.equal(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"), lockContent, `${lockPath} differs from the signed application bundle.`);
  }
  assert.equal(attestation.subjectDigest, sha256(canonicalJson(bundle)));
  const resolvedLock = resolvePnpmLock(lockContent);
  const packageInventory = resolvedLock.components.map(({ name, version, integrity }) => ({ package: name, version, integrity }))
    .sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
  assert.equal(canonicalJson(packageInventory), canonicalJson(bundle.installedPackages), `${customer} ${target ? "target" : "current"} bundle differs from its frozen lock closure.`);
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
      manifestDigest: materials.get("application-manifest"),
      lockfileDigest: materials.get("lockfile"),
      resolvedGraphDigest: materials.get("resolved-graph-or-plan"),
      frameworkDigest: bundle.frameworkDigest,
      sbomDigest: materials.get("sbom"),
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
  writeFileSync(resolve(root, target ? "security-target-runtime-inventory.json" : "runtime-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  writeFileSync(resolve(root, target ? "security-target-deployment-receipt.json" : "deployment-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
