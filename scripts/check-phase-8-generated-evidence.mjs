import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = [
  "releases/0.1.0/package-release-manifest.json",
  "releases/0.2.0/package-release-manifest.json",
  "releases/0.2.1/package-release-manifest.json",
  "fixtures/customer-alpha/runtime-inventory.json",
  "fixtures/customer-alpha/deployment-receipt.json",
  "fixtures/customer-alpha/security-patch-plan.json",
  "fixtures/customer-alpha/security-target-runtime-inventory.json",
  "fixtures/customer-alpha/security-target-deployment-receipt.json",
  "fixtures/customer-alpha/restore-redeployment-proof.json",
  "fixtures/customer-beta/runtime-inventory.json",
  "fixtures/customer-beta/deployment-receipt.json",
  "fixtures/customer-beta/security-patch-plan.json",
  "fixtures/customer-beta/security-target-runtime-inventory.json",
  "fixtures/customer-beta/security-target-deployment-receipt.json",
  "fixtures/customer-beta/previous-release-upgrade.json",
  "docs/implementation/phase-8-fleet-evidence.json"
];
const before = new Map(paths.map((path) => [path, readFileSync(resolve(root, path))]));
const sourceCommit = JSON.parse(before.get("fixtures/customer-alpha/runtime-inventory.json").toString("utf8")).releaseEvidence.sourceCommit;
let changed = [];
try {
  execFileSync(process.execPath, ["scripts/generate-phase-8-release-manifests.mjs"], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, ["scripts/generate-phase-8-deployment-evidence.mjs", sourceCommit], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, ["scripts/generate-phase-8-fleet-evidence.mjs"], { cwd: root, stdio: "pipe" });
  changed = paths.filter((path) => !before.get(path).equals(readFileSync(resolve(root, path))));
} finally {
  for (const [path, content] of before) writeFileSync(resolve(root, path), content);
}
assert.deepEqual(changed, [], `Phase 8 generated evidence is stale: ${changed.join(", ")}`);
process.stdout.write("P8_GENERATED_EVIDENCE_CLEAN\n");
