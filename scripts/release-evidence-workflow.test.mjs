import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/release-evidence.yml"), "utf8");
const target = workflow.slice(workflow.indexOf("  attest-phase-13-v1-1:"));

test("release evidence keeps historical and Phase 13 namespaces separate", () => {
  assert.match(workflow, /tags: \["v1\.0\.0", "v1\.1\.0"\]/u);
  assert.match(workflow, /attest-current-v1:\n    if: github\.event_name == 'push' && github\.ref == 'refs\/tags\/v1\.0\.0'/u);
  assert.match(target, /attest-phase-13-v1-1:/u);
  assert.match(target, /release-evidence\/phase-13-v1\.1/u);
  assert.match(target, /name: phase-13-v1\.1-release-evidence/u);
  assert.doesNotMatch(target, /phase-8-v1/u);
  assert.match(target, /source-package-release-manifest\.json/u);
  assert.match(target, /target-package-release-manifest\.json/u);
  assert.match(target, /1d8b40e0073fb24d42f47bc3a0fd763db0a0fb5baf706120f7fe3a2768c13eea/u);
  assert.match(target, /c8fe7f2518c219957297155e307768837186ec5f/u);
});

test("Phase 13 workflow pins actions and binds downloaded transition evidence", () => {
  for (const match of workflow.matchAll(/^\s+- uses: (\S+)$/gmu)) {
    assert.match(match[1], /@[0-9a-f]{40}$/u, "Action is not pinned: " + match[1]);
  }
  for (const command of [
    "generate-current-v1-sales-release-source.mjs --check --version 1.1.0",
    "generate-phase-8-release-manifests.mjs --version 1.1.0",
    "generate-phase-12-factory-locks.mjs --check --version 1.1.0",
    "check-phase-8-packed-packages.mjs --version 1.1.0",
    "generate-phase-13-transition-policy.mjs",
    "publish-platform-release-transition.mjs",
    "--source-attestation-bundle",
    "--target-attestation-bundle",
    "--transition-attestation-bundle",
    "--source-trust",
    "--target-attestation-source-commit",
    "--transition-attestation-source-commit",
    "--check"
  ]) assert.ok(target.includes(command), "Target workflow omits: " + command);
  assert.match(target, /predicate-type: https:\/\/k-nex\.dev\/platform-release-transition\/v1/u);
});
