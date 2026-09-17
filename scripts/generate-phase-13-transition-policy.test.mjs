import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { canonicalJson } from "../packages/contracts/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const generator = resolve(root, "scripts/generate-phase-13-transition-policy.mjs");
const migrationSet = resolve(root, "docs/implementation/phase-13-migration-set.json");

function runGenerator(directory, migrationSetPath = migrationSet) {
  return spawnSync(process.execPath, [generator, "--output", resolve(directory, "policy.json"), "--migration-set", migrationSetPath], {
    cwd: root,
    encoding: "utf8"
  });
}

function withMutatedMigrationSet(directory, name, mutate) {
  const mutated = JSON.parse(readFileSync(migrationSet, "utf8"));
  mutate(mutated);
  const path = resolve(directory, `${name}.json`);
  writeFileSync(path, canonicalJson(mutated));
  return path;
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

test("transition policy rejects migration substitution, reorder, omission, and addition", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-p13-policy-mutation-test-"));
  const mutations = [
    ["substitution", (set) => { set.steps[0].id = "20260905_000027_substituted"; }],
    ["reorder", (set) => { set.steps = [set.steps[1], set.steps[0], ...set.steps.slice(2)]; }],
    ["omission", (set) => { set.steps = set.steps.filter(({ id }) => id !== "20260906_000029_attachment_upload_admissions"); }],
    ["addition", (set) => { set.steps = [...set.steps, { id: "20260909_999999_unshipped_migration", phase: "offline-required" }]; }],
    ["predecessor_promotion", (set) => { set.steps = [{ id: "20260904_000028_workspace_sidebar_preferences", phase: "offline-required" }, ...set.steps]; }]
  ];
  try {
    for (const [name, mutate] of mutations) {
      const result = runGenerator(directory, withMutatedMigrationSet(directory, name, mutate));
      assert.notEqual(result.status, 0, `Mutation ${name} unexpectedly passed.`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transition policy rejects a non-canonical or malformed migration set", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-p13-policy-shape-test-"));
  try {
    const nonCanonical = resolve(directory, "non-canonical.json");
    writeFileSync(nonCanonical, `${JSON.stringify(JSON.parse(readFileSync(migrationSet, "utf8")), null, 4)}\n`);
    assert.notEqual(runGenerator(directory, nonCanonical).status, 0, "Non-canonical migration set unexpectedly passed.");
    const onlineStep = withMutatedMigrationSet(directory, "online-step", (set) => { set.steps[0].phase = "online-expand"; });
    assert.notEqual(runGenerator(directory, onlineStep).status, 0, "Unreviewed migration phase unexpectedly passed.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
