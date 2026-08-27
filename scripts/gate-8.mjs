import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ApplicationManifestSchema, DeploymentReceiptSchema, RuntimeInventorySchema, canonicalJson } from "../packages/contracts/dist/index.js";
import { applyCreateKnexApplication, createCycloneDxSbom, planCreateKnexApplication, resolvePnpmLock } from "../packages/composition/dist/index.js";
import { FleetRegistry, reconcileDeploymentReceipt, runtimeInventoryStateDigest } from "../packages/runtime/dist/index.js";
import { createFixtureDeploymentVerifier } from "./lib/fixture-deployment-authority.mjs";
import { assertPhase8SourceRelease, sourceFile } from "./lib/phase-8-provenance.mjs";

const root = resolve(import.meta.dirname, "..");
if (process.versions.node !== "24.19.0") throw new Error(`Gate 8 requires Node 24.19.0; found ${process.versions.node}.`);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const assertNoSecretKeys = (value, path = "$") => {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /password|secret|token/iu, `Runtime inventory contains a secret-bearing key at ${path}.${key}.`);
    assertNoSecretKeys(child, `${path}.${key}`);
  }
};
const result = readFileSync(resolve(root, "docs/implementation/phase-8-result.md"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/release-evidence.yml"), "utf8");
const modules = readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
assert.deepEqual(modules, ["sales"], "Sales must remain the only first-party domain module through Gate 8.");
for (const usage of workflow.matchAll(/uses:\s*([^\s#]+)/gu)) assert.match(usage[1], /@[0-9a-f]{40}$/u, `Workflow action is not pinned to a full SHA: ${usage[1]}`);
assert.match(workflow, /id-token:\s*write/u);
assert.match(workflow, /attestations:\s*write/u);
assert.match(workflow, /predicate-type:\s*https:\/\/k-nex\.dev\/provenance\/v1/u);
assert.match(workflow, /predicate-path:\s*release-evidence\/provenance-predicate\.json/u);
assert.match(workflow, /gh attestation verify[\s\S]*--predicate-type https:\/\/k-nex\.dev\/provenance\/v1/u);
assert.doesNotMatch(workflow, /SLSA Build L[0-9]/u);

const supportManifest = readJson("releases/0.2.0/package-release-manifest.json");
const patchManifest = readJson("releases/0.2.1/package-release-manifest.json");
const sourceCommit = readJson("fixtures/customer-alpha/runtime-inventory.json").releaseEvidence.sourceCommit;
assertPhase8SourceRelease(root, sourceCommit);
const verifier = createFixtureDeploymentVerifier(sourceCommit);
const fleet = new FleetRegistry(supportManifest, verifier.authority);
for (const customer of ["customer-alpha", "customer-beta"]) {
  const manifest = ApplicationManifestSchema.parse(readJson(`fixtures/${customer}/k-nex.app.json`));
  const inventory = RuntimeInventorySchema.parse(readJson(`fixtures/${customer}/runtime-inventory.json`));
  const receipt = DeploymentReceiptSchema.parse(readJson(`fixtures/${customer}/deployment-receipt.json`));
  const sourceManifest = JSON.parse(sourceFile(root, sourceCommit, `fixtures/${customer}/k-nex.app.json`).toString("utf8"));
  const sourceLock = sourceFile(root, sourceCommit, `fixtures/${customer}/pnpm-lock.yaml`).toString("utf8");
  const sourcePlan = JSON.parse(sourceFile(root, sourceCommit, `fixtures/${customer}/.k-nex/application-plan.json`).toString("utf8"));
  const salesVersion = sourceManifest.plugins.find(({ id }) => id === "module.sales")?.version;
  const sourceArtifact = sourceFile(root, sourceCommit, `fixtures/customer-gate-1/packages/k-nex-module-sales-${salesVersion}.tgz`);
  const resolvedLock = resolvePnpmLock(sourceLock);
  const salesRef = `pkg:npm/%40k-nex/module-sales@${salesVersion}`;
  const sourceSbom = createCycloneDxSbom(customer, resolvedLock.components, resolvedLock.dependencies, [...resolvedLock.rootDependencies, salesRef]);
  assert.equal(inventory.artifactDigest, sha256(sourceArtifact));
  assert.equal(inventory.releaseEvidence.manifestDigest, sha256(canonicalJson(sourceManifest)));
  assert.equal(inventory.releaseEvidence.lockfileDigest, sha256(sourceLock));
  assert.equal(inventory.releaseEvidence.resolvedGraphDigest, sha256(canonicalJson(sourcePlan)));
  assert.equal(inventory.releaseEvidence.sbomDigest, sha256(canonicalJson(sourceSbom)));
  assert.equal(inventory.releaseEvidence.sourceCommit, sourceCommit);
  assert.deepEqual(manifest.plugins.map(({ id }) => id), ["module.sales"]);
  assert.equal(reconcileDeploymentReceipt(receipt, inventory), true);
  assertNoSecretKeys(inventory);
  fleet.ingest(await verifier.verify(inventory, receipt));
}
assert.deepEqual(fleet.list().map(({ inventory }) => inventory.platformRelease), ["0.2.0", "0.1.0"]);
assert.deepEqual(fleet.affected("@k-nex/module-sales", "<1.0.1").map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
assert.deepEqual(fleet.affected("semver", "<7.8.6").map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
assert.equal(fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1", patchManifest).length, 2);
for (const customer of ["customer-alpha", "customer-beta"]) {
  const patch = readJson(`fixtures/${customer}/security-patch-plan.json`);
  assert.equal(patch.applicationId, customer);
  assert.equal(patch.targetVersion, "1.0.1");
  assert.deepEqual(patch.operations, ["update-lockfile", "plan-upgrade", "run-migrations", "deploy-and-receipt"]);
}
const priorUpgrade = readJson("fixtures/customer-beta/previous-release-upgrade.json");
assert.deepEqual(priorUpgrade.platformRelease, { current: "0.1.0", target: "0.2.0" });
assert.equal(priorUpgrade.reviewedMigrationIds.length, 8);
assert.equal(priorUpgrade.preservedArtifacts.length, 8);
assert.equal(priorUpgrade.postgresProof.test, "fixtures/customer-gate-1/tests/previous-release-upgrade-postgres.test.mjs");
const expected = RuntimeInventorySchema.parse(readJson("fixtures/customer-alpha/runtime-inventory.json"));
const restore = readJson("fixtures/customer-alpha/restore-redeployment-proof.json");
assert.equal(restore.backupRestoreFixture, "fixtures/customer-gate-1/tests/backup-restore-postgres.test.mjs");
assert.equal(restore.expectedOperationalInventoryDigest, runtimeInventoryStateDigest(expected));

const target = realpathSync(mkdtempSync(join(tmpdir(), "gate-8-create-knex-app-")));
try {
  const plan = planCreateKnexApplication({ applicationId: "gate-eight-clean", applicationName: "Gate Eight Clean", theme: "minimal", database: "docker-postgres" });
  const applied = applyCreateKnexApplication(plan, target);
  assert.ok(applied.written.includes("k-nex.app.json") && applied.written.includes("compose.yaml"));
  assert.ok(applied.written.includes("src/boot.ts") && applied.written.includes("src/migrations/20260827_000002_knex_bootstrap.ts"));
  assert.deepEqual(ApplicationManifestSchema.parse(JSON.parse(readFileSync(join(target, "k-nex.app.json"), "utf8"))).plugins.map(({ id }) => id), ["module.sales"]);
  assert.equal(applyCreateKnexApplication(plan, target).unchanged.length, Object.keys(plan.files).length);
} finally {
  rmSync(target, { recursive: true, force: true });
}

for (const marker of [
  "# Phase 8 Result", "**Decision:** **PLATFORM FOUNDATION ACCEPTED**", "P8_9_FLEET_EVIDENCE_PASS",
  "Payload Import/Export", "CycloneDX", "signed provenance", "Customer Alpha", "Customer Beta", "DO NOT START DOMAIN EXPANSION"
]) assert.ok(result.includes(marker), `Phase 8 result is missing: ${marker}.`);
for (const task of ["P8.1", "P8.2", "P8.3", "P8.4", "P8.5", "P8.6", "P8.7", "P8.8", "P8.9", "P8.10"]) {
  assert.ok(result.includes(task), `Phase 8 result is missing task mapping: ${task}.`);
}
console.log(JSON.stringify({ gate: "Gate 8", customers: fleet.list().length, affectedDeployments: fleet.affected("@k-nex/module-sales", "<1.0.1").length, patchPlans: 2, priorUpgradeSteps: priorUpgrade.reviewedMigrationIds.length, postgresRecoveryProofs: 2 }, null, 2));
console.log("GATE_8_PASS");
