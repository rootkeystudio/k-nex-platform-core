import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

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

test("deployment evidence generator rejects a source commit that lacks the exact release materials", () => {
  const result = spawnSync(process.execPath, ["scripts/generate-phase-8-deployment-evidence.mjs", "793927d83c8fa0cc945b274c4c2ac0c22621df0f"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /differs from source commit|does not exist in/u);
});
