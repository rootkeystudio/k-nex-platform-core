import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const generator = resolve(root, "scripts/generate-phase-13-transition-policy.mjs");
const fixture = resolve(root, "fixtures/customer-gate-1/src/migrations/index.ts");
const migrationSet = resolve(root, "docs/implementation/phase-13-migration-set.json");

function runGenerator(directory, fixturePath = fixture, migrationSetPath = migrationSet) {
  return spawnSync(process.execPath, [generator, "--output", resolve(directory, "policy.json"), "--fixture", fixturePath, "--migration-set", migrationSetPath], {
    cwd: root,
    encoding: "utf8"
  });
}

test("transition policy accepts only the frozen migration set", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-p13-policy-test-"));
  try {
    const result = runGenerator(directory);
    assert.equal(result.status, 0, result.stderr);
    const policy = JSON.parse(readFileSync(resolve(directory, "policy.json"), "utf8"));
    assert.deepEqual(policy.migrations.steps, JSON.parse(readFileSync(migrationSet, "utf8")).steps);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transition policy rejects migration substitution, reorder, and comment injection", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-p13-policy-mutation-test-"));
  const source = readFileSync(fixture, "utf8");
  const first = "20260905_000027_crm_core";
  const second = "20260907_000030_pipeline_saved_views";
  const mutations = [
    source.replace("name: \"" + first + "\"", "name: \"" + first + "-substituted\""),
    source.replace("name: \"" + first + "\"", "name: \"__temporary_migration_name__\"").replace("name: \"" + second + "\"", "name: \"" + first + "\"").replace("name: \"__temporary_migration_name__\"", "name: \"" + second + "\""),
    source + "\n// name: \"20260909_999999_comment_injection\"\n"
  ];
  try {
    for (const [index, mutated] of mutations.entries()) {
      const path = resolve(directory, "mutated-" + index + ".ts");
      writeFileSync(path, mutated);
      const result = runGenerator(directory, path);
      assert.notEqual(result.status, 0, "Mutation " + index + " unexpectedly passed.");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transition policy rejects a substituted frozen migration-set entry", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-p13-policy-set-test-"));
  try {
    const mutatedPath = resolve(directory, "migration-set.json");
    const mutated = JSON.parse(readFileSync(migrationSet, "utf8"));
    mutated.steps[0].id = "20260905_000027_substituted";
    writeFileSync(mutatedPath, JSON.stringify(mutated, null, 2) + "\n");
    const result = runGenerator(directory, fixture, mutatedPath);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
