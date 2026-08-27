import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ApplicationManifestSchema, DeploymentReceiptSchema, RuntimeInventorySchema } from "../packages/contracts/dist/index.js";
import { applyCreateKnexApplication, planCreateKnexApplication } from "../packages/composition/dist/index.js";
import { FleetRegistry, reconcileDeploymentReceipt, restoredInventoryMatches } from "../packages/runtime/dist/index.js";

const root = resolve(import.meta.dirname, "..");
if (process.versions.node !== "24.19.0") throw new Error(`Gate 8 requires Node 24.19.0; found ${process.versions.node}.`);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
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
const fleet = new FleetRegistry(supportManifest);
for (const customer of ["customer-alpha", "customer-beta"]) {
  const manifest = ApplicationManifestSchema.parse(readJson(`fixtures/${customer}/k-nex.app.json`));
  const inventory = RuntimeInventorySchema.parse(readJson(`fixtures/${customer}/runtime-inventory.json`));
  const receipt = DeploymentReceiptSchema.parse(readJson(`fixtures/${customer}/deployment-receipt.json`));
  assert.deepEqual(manifest.plugins.map(({ id }) => id), ["module.sales"]);
  assert.equal(reconcileDeploymentReceipt(receipt, inventory), true);
  assert.equal(execFileSync("git", ["merge-base", "--is-ancestor", inventory.releaseEvidence.sourceCommit, "HEAD"], { cwd: root }).length, 0);
  assert.doesNotMatch(JSON.stringify(inventory), /password|secret|token/iu);
  fleet.ingest(receipt, inventory);
}
assert.deepEqual(fleet.list().map(({ inventory }) => inventory.platformRelease), ["0.2.0", "0.1.0"]);
assert.deepEqual(fleet.affected("@k-nex/module-sales", "<1.0.1").map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
assert.deepEqual(fleet.affected("semver", "<7.8.6").map(({ inventory }) => inventory.applicationId), ["customer-alpha", "customer-beta"]);
assert.equal(fleet.planSecurityPatch("@k-nex/module-sales", "<1.0.1", "1.0.1").length, 2);
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
const expected = RuntimeInventorySchema.parse(readJson("fixtures/customer-alpha/runtime-inventory.json"));
assert.equal(restoredInventoryMatches(expected, structuredClone(expected)), true);
const restore = readJson("fixtures/customer-alpha/restore-redeployment-proof.json");
assert.equal(restore.matches, true);
assert.equal(restore.expectedInventoryDigest, restore.restoredInventoryDigest);

const target = mkdtempSync(join(tmpdir(), "gate-8-create-knex-app-"));
try {
  const plan = planCreateKnexApplication({ applicationId: "gate-eight-clean", applicationName: "Gate Eight Clean", theme: "minimal", database: "docker-postgres" });
  const applied = applyCreateKnexApplication(plan, target);
  assert.ok(applied.written.includes("k-nex.app.json") && applied.written.includes("compose.yaml"));
  assert.deepEqual(ApplicationManifestSchema.parse(JSON.parse(readFileSync(join(target, "k-nex.app.json"), "utf8"))).plugins.map(({ id }) => id), ["module.sales"]);
  assert.equal(applyCreateKnexApplication(plan, target).unchanged.length, Object.keys(plan.files).length);
} finally {
  rmSync(target, { recursive: true, force: true });
}

for (const marker of [
  "# Phase 8 Result", "**Decision:** **PLATFORM FOUNDATION ACCEPTED**", "P8_9_FLEET_EVIDENCE_PASS",
  "Payload Import/Export", "CycloneDX", "signed provenance", "Customer Alpha", "Customer Beta", "DO NOT START DOMAIN EXPANSION"
]) assert.ok(result.includes(marker), `Phase 8 result is missing: ${marker}.`);
for (const commit of ["3f830ae", "5efea55", "790a0df", "2a38c44", "d8984c6", "4e0a77a", "60a433b", "c4117fb", "6720839"]) {
  execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root, stdio: "ignore" });
}
console.log(JSON.stringify({ gate: "Gate 8", customers: fleet.list().length, affectedDeployments: fleet.affected("@k-nex/module-sales", "<1.0.1").length, patchPlans: 2, priorUpgradeSteps: priorUpgrade.reviewedMigrationIds.length, restoreInventoryMatch: true }, null, 2));
console.log("GATE_8_PASS");
