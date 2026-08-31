import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.equal(process.versions.node, "24.19.0", `Gate 9 requires Node 24.19.0; found ${process.versions.node}.`);

for (const schema of [
  "extension-bundle-manifest", "extension-generation", "extension-install-plan", "extension-install-receipt",
  "hot-application-manifest", "migration-compatibility-plan", "remote-ui-isolation-profile", "runner-isolation-profile",
  "static-composition-change-plan", "static-deployment-receipt", "theme-skin-manifest", "trusted-application-build-evidence",
  "worker-generation-fence"
]) assert.ok(read(`schemas/${schema}.v1.schema.json`).includes(`schemas.k-nex.dev/${schema}/v1.json`), `Gate 9 schema is missing or stale: ${schema}`);

const result = spawnSync(process.execPath, ["scripts/phase-9-attack-corpus.mjs"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024
});
assert.equal(result.error, undefined, `Gate 9 could not start the attack corpus: ${result.error?.message}`);
assert.equal(result.status, 0, `Gate 9 attack corpus failed:\n${result.stderr || result.stdout}`);
let evidence;
try {
  evidence = JSON.parse(result.stdout.trim());
} catch (error) {
  assert.fail(`Gate 9 attack corpus did not emit one machine-readable report: ${error.message}`);
}
assert.equal(evidence.status, "PASS", "Gate 9 attack corpus did not pass.");
assert.equal(evidence.scenarios.length, 22, "Gate 9 must execute all 22 named attack scenarios.");
assert.equal(evidence.proofs.length, 12, "Gate 9 must execute exactly 12 named proof groups.");
const runtimeExtensionStateProof = evidence.proofs.find(({ id }) => id === "runtime-extension-state");
assert.ok(runtimeExtensionStateProof, "Gate 9 must execute the merged PostgreSQL runtime-extension-state proof.");
assert.ok(runtimeExtensionStateProof.names.includes("PostgreSQL Remote UI reads are generation-linearized, restart-safe, and fail closed"), "Gate 9 merged PostgreSQL proof did not report the exact Remote UI test.");
assert.ok(runtimeExtensionStateProof.markers?.P9_REMOTE_UI_POSTGRES_EVIDENCE, "Gate 9 merged PostgreSQL proof did not report durable asset evidence.");
for (const scenario of evidence.scenarios) {
  assert.match(scenario.id, /^SCN-\d{2}$/u, "Gate 9 scenario has no stable identifier.");
  assert.ok(typeof scenario.expected === "string" && scenario.expected.length > 0, `Gate 9 scenario lacks an expected outcome: ${scenario.id}`);
  assert.equal(scenario.outcome, "observed", `Gate 9 scenario did not observe its expected outcome: ${scenario.id}`);
  assert.ok(Array.isArray(scenario.evidence) && scenario.evidence.length > 0, `Gate 9 scenario lacks executed evidence: ${scenario.id}`);
  for (const observation of scenario.evidence) assert.ok(typeof observation.name === "string" && observation.name.length > 0, `Gate 9 scenario has no exact named test evidence: ${scenario.id}`);
  if (scenario.id === "SCN-19") {
    assert.equal(scenario.matrix.length, 9, "Gate 9 crash scenario must cover every required state/process boundary.");
    for (const entry of scenario.matrix) {
      assert.ok(entry.state && entry.process && entry.expected, "Gate 9 crash matrix entry is incomplete.");
      assert.equal(entry.evidence, `${entry.state}:${entry.process}`, `Gate 9 crash matrix evidence is not exact: ${entry.state}/${entry.process}`);
      assert.equal(entry.outcome, "recovered", `Gate 9 crash matrix entry was not recovered: ${entry.state}/${entry.process}`);
    }
  }
}

const modules = readdirSync(resolve(root, "modules"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(modules, ["sales"], "Sales must remain the only first-party reference domain module through Gate 9.");

const phaseResult = read("docs/implementation/phase-9-result.md");
for (const marker of [
  "# Phase 9 Result", "**Decision:** **READY FOR PHASE REVIEW**", "GO PHASE 10 RBAC AND AUTHORIZATION",
  "P9_REMOTE_UI_BROWSER_PASS", "P9_THEME_SKIN_BROWSER_PASS", "22 required attacks", "P10.1"
]) assert.ok(phaseResult.includes(marker), `Phase 9 result is missing: ${marker}`);
for (let task = 1; task <= 10; task += 1) assert.ok(phaseResult.includes(`P9.${task}`), `Phase 9 result is missing task P9.${task}.`);

console.log(JSON.stringify({ gate: "Gate 9", scenarios: evidence.scenarios.length, proofs: evidence.proofs.length, referenceModules: modules }, null, 2));
console.log("GATE_9_PASS");
