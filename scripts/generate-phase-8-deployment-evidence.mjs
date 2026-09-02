import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson } from "../packages/contracts/dist/index.js";
import { resolvePnpmLock } from "../packages/composition/dist/index.js";
import { createDeploymentReceipt, createGitHubHostedAttestationVerifier, observeRuntimeInventory, runtimeInventoryDigest, runtimeInventoryStateDigest } from "../packages/runtime/dist/index.js";
import { assertPhase8ReleaseSnapshot, bundledFile } from "./lib/phase-8-provenance.mjs";

const root = resolve(import.meta.dirname, "..");
const evidence = resolve(root, "release-evidence/phase-8-v1");
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const hostedVerifier = createGitHubHostedAttestationVerifier({
  repository: "rootkeystudio/k-nex-platform-core",
  workflow: "release-evidence.yml",
  predicateType: "https://k-nex.dev/provenance/v1"
});

const deployments = [];
for (const [customer, environment, observedAt, deployedAt] of [
  ["customer-alpha", "production", "2026-09-01T12:00:00.000Z", "2026-09-01T12:05:00.000Z"],
  ["customer-beta", "staging", "2026-09-01T12:10:00.000Z", "2026-09-01T12:15:00.000Z"]
]) {
  const customerRoot = resolve(root, "fixtures", customer);
  const location = resolve(evidence, "customers", customer);
  const bundle = readJson(resolve(location, `${customer}.application-bundle.json`));
  assert.equal(bundle.release, "1.0.0");
  assertPhase8ReleaseSnapshot(root, bundle);
  const verification = readJson(resolve(location, "hosted/application-verification.json"));
  assert.equal(verification.length, 1, `${customer} must have exactly one hosted application verification.`);
  const attestation = await hostedVerifier.verify(verification[0]);
  assert.equal(bundle.sourceCommit, attestation.sourceCommit);
  const materials = new Map(attestation.materials.map(({ name, digest }) => [name, digest]));
  const applicationManifest = bundledFile(bundle, "application/k-nex.app.json");
  const lockContent = bundledFile(bundle, "application/pnpm-lock.yaml").toString("utf8");
  const planContent = bundledFile(bundle, "application/.k-nex/application-plan.json").toString("utf8");
  const sbom = readJson(resolve(location, "sbom.cdx.json"));
  const bundleSbom = bundledFile(bundle, "evidence/sbom.cdx.json");
  assert.equal(canonicalJson(sbom), bundleSbom.toString("utf8"), `${customer} SBOM differs from its application bundle.`);
  assert.ok(readFileSync(resolve(customerRoot, "k-nex.app.json")).equals(applicationManifest), `${customer} manifest differs from its signed application bundle.`);
  assert.ok(readFileSync(resolve(customerRoot, "pnpm-lock.yaml")).equals(Buffer.from(lockContent)), `${customer} lock differs from its signed application bundle.`);
  assert.equal(canonicalJson(readJson(resolve(customerRoot, ".k-nex/application-plan.json"))), canonicalJson(JSON.parse(planContent)), `${customer} plan differs from its signed application bundle.`);
  const resolvedLock = resolvePnpmLock(lockContent);
  const packages = resolvedLock.components.map(({ name, version, integrity }) => ({ package: name, version, integrity }))
    .sort((left, right) => `${left.package}@${left.version}`.localeCompare(`${right.package}@${right.version}`));
  assert.equal(canonicalJson(packages), canonicalJson(bundle.installedPackages), `${customer} bundle differs from its frozen lock closure.`);
  assert.equal(materials.get("application-manifest"), sha256(applicationManifest));
  assert.equal(materials.get("lockfile"), sha256(lockContent));
  assert.equal(materials.get("resolved-graph-or-plan"), sha256(canonicalJson(JSON.parse(planContent))));
  assert.equal(materials.get("sbom"), sha256(canonicalJson(sbom)));
  assert.equal(materials.get("package-release-manifest"), bundle.releaseManifestDigest);
  assert.equal(materials.get("lock-runtime-closure"), bundle.closureDigest);
  assert.equal(materials.get("release-closure"), bundle.closureDigest);

  const manifest = JSON.parse(applicationManifest.toString("utf8"));
  const overrides = readJson(resolve(customerRoot, "customer-overrides.json"));
  const inventory = observeRuntimeInventory({
    schemaVersion: 1,
    applicationId: customer,
    repository: `rootkeystudio/${customer}`,
    environment,
    platformRelease: "1.0.0",
    observedAt,
    artifactDigest: sha256(canonicalJson(bundle)),
    releaseEvidence: {
      sourceCommit: attestation.sourceCommit,
      workflowIdentity: attestation.workflowIdentity,
      manifestDigest: materials.get("application-manifest"),
      lockfileDigest: materials.get("lockfile"),
      resolvedGraphDigest: materials.get("resolved-graph-or-plan"),
      frameworkDigest: bundle.frameworkDigest,
      sbomDigest: materials.get("sbom"),
      provenanceDigest: sha256(canonicalJson(attestation))
    },
    packages,
    plugins: manifest.plugins,
    migrationRevision: bundle.targetMigrationRevision,
    settings: [{ id: "sales.settings", schemaVersion: 1, revision: 1 }],
    templates: overrides.defaultPages.map((id) => ({ id, templateVersion: 1, revision: 1 })),
    health: { status: "ready", checks: ["database", "default-pages", "sales-registration"] }
  });
  const receipt = createDeploymentReceipt({
    inventory,
    deploymentId: `deploy:${customer}:1.0.0`,
    deployedAt,
    approvedBy: { kind: "workflow", identity: `rootkeystudio/k-nex-platform-core/.github/workflows/deploy.yml@${attestation.sourceCommit}` },
    smoke: { status: "passed", checks: ["authenticated-sales", "public-shell"] }
  });
  const restore = {
    schemaVersion: 1,
    backupRestoreFixture: "fixtures/customer-gate-1/tests/backup-restore-postgres.test.mjs",
    expectedOperationalInventoryDigest: runtimeInventoryStateDigest(inventory),
    observation: "clean-restored PostgreSQL runtime inventory",
    execution: "required-by-customer-postgres-suite",
    externalEffects: "disabled-before-readiness"
  };
  writeJson(resolve(customerRoot, "runtime-inventory.json"), inventory);
  writeJson(resolve(customerRoot, "deployment-receipt.json"), receipt);
  writeJson(resolve(customerRoot, "restore-redeployment-proof.json"), restore);
  deployments.push({ applicationId: customer, platformRelease: inventory.platformRelease, deploymentId: receipt.deploymentId, inventoryDigest: runtimeInventoryDigest(inventory), restoreInventoryDigest: restore.expectedOperationalInventoryDigest });
}

writeJson(resolve(root, "docs/implementation/phase-8-fleet-evidence.json"), {
  schemaVersion: 1,
  deployments,
  releasePolicy: { productRelease: "1.0.0", productVersionTransitions: "none" },
  restore: {
    postgresProof: "fixtures/customer-gate-1/tests/backup-restore-postgres.test.mjs",
    applications: deployments.map(({ applicationId, restoreInventoryDigest }) => ({ applicationId, expectedOperationalInventoryDigest: restoreInventoryDigest }))
  }
});
process.stdout.write(`P8_V1_DEPLOYMENT_EVIDENCE_GENERATED ${deployments.length}\n`);
