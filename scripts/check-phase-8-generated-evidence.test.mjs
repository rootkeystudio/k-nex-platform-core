import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

import { assertPhase8SourceTopology } from "./lib/phase-8-provenance.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "fixtures/customer-alpha/security-patch-plan.json");

test("Gate 8 rejects and does not silently repair stale committed evidence", () => {
  const original = readFileSync(target);
  try {
    const stale = JSON.parse(original.toString("utf8"));
    stale.targetVersion = "9.9.9";
    const staleContent = Buffer.from(`${JSON.stringify(stale, null, 2)}\n`);
    writeFileSync(target, staleContent);
    const result = spawnSync(process.execPath, ["scripts/check-phase-8-generated-evidence.mjs"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /generated evidence is stale/u);
    assert.deepEqual(readFileSync(target), staleContent, "The check must not repair the stale committed artifact it rejected.");
  } finally {
    writeFileSync(target, original);
  }
});

test("deployment evidence rejects an existing non-ancestor source commit", () => {
  const sourceCommit = execFileSync("git", ["commit-tree", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
    input: "detached Phase 8 source\n",
    env: { ...process.env, GIT_AUTHOR_NAME: "Gate 8", GIT_AUTHOR_EMAIL: "gate8@example.invalid", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_NAME: "Gate 8", GIT_COMMITTER_EMAIL: "gate8@example.invalid", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" }
  }).trim();
  assert.match(sourceCommit, /^[0-9a-f]{40}$/u, "The repository needs a non-ancestor commit for this topology test.");
  assert.throws(() => assertPhase8SourceTopology(root, sourceCommit), /must be an ancestor of the final head/u);
});
