import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";

export const requiredPluginEvidence = Object.freeze([
  "accessibility-smoke", "component-runtime-puck", "default-page-seed", "deterministic-inventory",
  "fresh-migration-boot", "install-disable-reenable", "manifest-schema-fixtures", "package-export-boundaries",
  "packed-reproducibility", "settings-permission-attacks", "source-action-tool-event-realtime"
]);

const runnerOwnedScripts = Object.freeze({
  "package-export-boundaries": "check:boundaries",
  "packed-reproducibility": "check:pack"
});

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys are invalid.`);
}

function nonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string.`);
  assert.ok(value.length > 0 && value.length <= 512, `${label} must be bounded and non-empty.`);
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/u.test(value), false, `${label} contains control characters.`);
}

function inside(root, value, label) {
  nonEmptyString(value, label);
  const target = resolve(root, value);
  assert.ok(target.startsWith(`${root}${sep}`), `${label} must stay inside the target plugin.`);
  return target;
}

export function validateConformancePlan(plan) {
  assert.ok(plan && typeof plan === "object" && !Array.isArray(plan), "Plugin conformance plan must be an object.");
  exactKeys(plan, ["pluginId", "pluginPackage", "proofs", "schemaVersion"], "Plugin conformance plan");
  assert.equal(plan.schemaVersion, 2, "Unsupported plugin conformance schema version.");
  nonEmptyString(plan.pluginId, "pluginId");
  nonEmptyString(plan.pluginPackage, "pluginPackage");
  assert.ok(Array.isArray(plan.proofs) && plan.proofs.length > 0, "Plugin conformance plan requires proofs.");
  const ids = new Set();
  const coverage = [];
  for (const proof of plan.proofs) {
    assert.ok(proof && typeof proof === "object" && !Array.isArray(proof), "Conformance proof must be an object.");
    assert.ok(proof.kind === "node-test" || proof.kind === "pnpm-script", `Unsupported conformance proof kind: ${String(proof.kind)}.`);
    exactKeys(proof, proof.kind === "node-test" ? ["covers", "file", "id", "kind", "testName"] : ["covers", "id", "kind", "script"], `Conformance proof ${String(proof.id)}`);
    nonEmptyString(proof.id, "proof id");
    assert.equal(ids.has(proof.id), false, `Duplicate conformance proof id: ${proof.id}.`);
    ids.add(proof.id);
    assert.ok(Array.isArray(proof.covers) && proof.covers.length > 0, `Proof ${proof.id} requires evidence coverage.`);
    for (const evidence of proof.covers) nonEmptyString(evidence, `Proof ${proof.id} evidence`);
    coverage.push(...proof.covers);
    if (proof.kind === "node-test") {
      nonEmptyString(proof.file, `${proof.id} file`);
      assert.equal(proof.file.startsWith("/") || proof.file.split(/[\\/]/u).includes(".."), false, `${proof.id} file must stay inside the target plugin.`);
      nonEmptyString(proof.testName, `${proof.id} testName`);
    } else {
      assert.equal(runnerOwnedScripts[proof.id], proof.script, `${proof.id} must use its runner-owned target-plugin script.`);
    }
  }
  assert.deepEqual(coverage.slice().sort(), [...requiredPluginEvidence], "Plugin conformance evidence must be exact, unique, and complete.");
  return plan;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function execute(program, args, root, proofId, identity) {
  try {
    return execFileSync(program, args, {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`, K_NEX_CONFORMANCE_PLUGIN_ID: identity.pluginId, K_NEX_CONFORMANCE_PLUGIN_PACKAGE: identity.pluginPackage }
    });
  } catch (error) {
    const output = `${error?.stdout?.toString?.() ?? ""}${error?.stderr?.toString?.() ?? ""}`;
    throw new Error(`Plugin conformance proof failed: ${proofId}\n${output}`, { cause: error });
  }
}

function runNodeTest(proof, root, pluginRoot, identity) {
  const output = execute(process.execPath, ["--test", "--test-reporter=tap", `--test-name-pattern=^${escapeRegExp(proof.testName)}$`, inside(pluginRoot, proof.file, `${proof.id} file`)], root, proof.id, identity);
  assert.match(output, new RegExp(`^ok \\d+ - ${escapeRegExp(proof.testName)}$`, "m"), `${proof.id} did not execute its named target-plugin test.`);
  assert.match(output, /^# pass 1$/m, `${proof.id} did not pass exactly one named test.`);
  assert.match(output, /^# fail 0$/m, `${proof.id} reported a failure.`);
}

function runPnpmScript(proof, root, identity) {
  execute("pnpm", ["--filter", identity.pluginPackage, "run", proof.script], root, proof.id, identity);
}

export function runConformancePlan({ plan, pluginId, pluginPackage, pluginRoot, root }) {
  validateConformancePlan(plan);
  assert.equal(plan.pluginId, pluginId, "Conformance plan pluginId must match the target plugin.");
  assert.equal(plan.pluginPackage, pluginPackage, "Conformance plan pluginPackage must match the target plugin.");
  const identity = Object.freeze({ pluginId, pluginPackage });
  const results = [];
  for (const proof of plan.proofs) {
    if (proof.kind === "node-test") runNodeTest(proof, root, pluginRoot, identity);
    else runPnpmScript(proof, root, identity);
    results.push({ id: proof.id, covers: proof.covers, pluginId, status: "pass" });
  }
  return Object.freeze(results);
}
