import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.equal(process.versions.node, "24.19.0", `Gate 11 requires Node 24.19.0; found ${process.versions.node}.`);
assert.deepEqual(
  readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
  ["sales"],
  "Sales must remain the only first-party reference domain module through Gate 11."
);

const corpus = spawnSync(process.execPath, ["scripts/phase-11-attack-corpus.mjs"], {
  cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024
});
assert.equal(corpus.error, undefined, `Phase 11 attack corpus could not start: ${corpus.error?.message}`);
assert.equal(corpus.status, 0, `Phase 11 attack corpus failed:\n${corpus.stderr || corpus.stdout}`);
assert.match(corpus.stdout, /^P11_ATTACK_CORPUS_PASS$/mu, "Phase 11 attack corpus pass marker is missing.");

const result = read("docs/implementation/phase-11-result.md");
for (const marker of [
  "# Phase 11 Result",
  "**Decision:** **ACCEPTED**",
  "GO EXPLICIT CRM/CMS PRODUCTIZATION DECISION"
]) assert.ok(result.includes(marker), `Phase 11 result is missing: ${marker}`);
for (let task = 1; task <= 10; task += 1) assert.ok(result.includes(`P11.${task}`), `Phase 11 result is missing task P11.${task}.`);

console.log(JSON.stringify({ gate: "Gate 11", attackCorpus: "PASS", processProofs: 9, referenceModules: ["sales"] }, null, 2));
console.log("GATE_11_PASS");
