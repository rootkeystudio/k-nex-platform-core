import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";

export const requiredPluginEvidence = Object.freeze([
  "accessibility-smoke",
  "component-runtime-puck",
  "default-page-seed",
  "deterministic-inventory",
  "fresh-migration-boot",
  "manifest-schema-fixtures",
  "package-export-boundaries",
  "packed-reproducibility",
  "settings-permission-attacks",
  "source-action-tool-event-realtime"
]);

const proofKinds = new Set(["node-test", "pnpm-script", "vitest"]);

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys are invalid.`);
}

function nonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string.`);
  assert.ok(value.length > 0 && value.length <= 512, `${label} must be bounded and non-empty.`);
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/u.test(value), false, `${label} contains control characters.`);
}

function repositoryPath(root, value, label) {
  nonEmptyString(value, label);
  const target = resolve(root, value);
  assert.ok(target === root || target.startsWith(`${root}${sep}`), `${label} escapes the repository.`);
  return target;
}

export function validateConformancePlan(plan) {
  assert.ok(plan && typeof plan === "object" && !Array.isArray(plan), "Plugin conformance plan must be an object.");
  exactKeys(plan, ["pluginId", "proofs", "schemaVersion"], "Plugin conformance plan");
  assert.equal(plan.schemaVersion, 1, "Unsupported plugin conformance schema version.");
  nonEmptyString(plan.pluginId, "pluginId");
  assert.ok(Array.isArray(plan.proofs) && plan.proofs.length > 0, "Plugin conformance plan requires proofs.");

  const ids = new Set();
  const coverage = [];
  for (const proof of plan.proofs) {
    assert.ok(proof && typeof proof === "object" && !Array.isArray(proof), "Conformance proof must be an object.");
    assert.ok(proofKinds.has(proof.kind), `Unsupported conformance proof kind: ${String(proof.kind)}.`);
    const common = ["covers", "id", "kind"];
    const kindKeys = proof.kind === "node-test"
      ? ["file", "testName"]
      : proof.kind === "vitest"
        ? ["file", "package", "testName"]
        : ["markers", "script", ...(proof.package === undefined ? [] : ["package"])];
    exactKeys(proof, [...common, ...kindKeys], `Conformance proof ${String(proof.id)}`);
    nonEmptyString(proof.id, "proof id");
    assert.equal(ids.has(proof.id), false, `Duplicate conformance proof id: ${proof.id}.`);
    ids.add(proof.id);
    assert.ok(Array.isArray(proof.covers) && proof.covers.length > 0, `Proof ${proof.id} requires evidence coverage.`);
    for (const evidence of proof.covers) nonEmptyString(evidence, `Proof ${proof.id} evidence`);
    coverage.push(...proof.covers);
    if (proof.kind === "node-test") {
      nonEmptyString(proof.file, `${proof.id} file`);
      nonEmptyString(proof.testName, `${proof.id} testName`);
    } else if (proof.kind === "vitest") {
      nonEmptyString(proof.package, `${proof.id} package`);
      nonEmptyString(proof.file, `${proof.id} file`);
      assert.equal(proof.file.startsWith("/") || proof.file.split(/[\\/]/u).includes(".."), false, `${proof.id} file must stay inside its package.`);
      nonEmptyString(proof.testName, `${proof.id} testName`);
    } else {
      nonEmptyString(proof.script, `${proof.id} script`);
      if (proof.package !== undefined) nonEmptyString(proof.package, `${proof.id} package`);
      assert.ok(Array.isArray(proof.markers) && proof.markers.length > 0, `${proof.id} requires output markers.`);
      for (const marker of proof.markers) nonEmptyString(marker, `${proof.id} marker`);
    }
  }
  assert.deepEqual([...new Set(coverage)].sort(), [...requiredPluginEvidence], "Plugin conformance evidence is incomplete or unknown.");
  return plan;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function execute(program, args, root, proofId) {
  try {
    return execFileSync(program, args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const output = `${error?.stdout?.toString?.() ?? ""}${error?.stderr?.toString?.() ?? ""}`;
    throw new Error(`Plugin conformance proof failed: ${proofId}\n${output}`, { cause: error });
  }
}

function runNodeTest(proof, root) {
  const output = execute(process.execPath, [
    "--test", "--test-reporter=tap", `--test-name-pattern=^${escapeRegExp(proof.testName)}$`, repositoryPath(root, proof.file, `${proof.id} file`)
  ], root, proof.id);
  assert.match(output, new RegExp(`^ok \\d+ - ${escapeRegExp(proof.testName)}$`, "m"), `${proof.id} did not execute its named test.`);
  assert.match(output, /^# pass 1$/m, `${proof.id} did not pass exactly one named test.`);
  assert.match(output, /^# fail 0$/m, `${proof.id} reported a failure.`);
}

function runVitest(proof, root) {
  const output = execute("pnpm", [
    "--filter", proof.package, "exec", "vitest", "run", proof.file,
    "--testNamePattern", escapeRegExp(proof.testName), "--reporter=json"
  ], root, proof.id);
  const report = JSON.parse(output);
  const assertions = report.testResults?.flatMap(({ assertionResults = [] }) => assertionResults) ?? [];
  assert.deepEqual(assertions.filter(({ status }) => status === "passed").map(({ title }) => title), [proof.testName], `${proof.id} did not pass exactly its named test.`);
}

function runPnpmScript(proof, root, pluginPackage) {
  const packageName = proof.package === "$plugin" ? pluginPackage : proof.package;
  const args = [...(packageName === undefined ? [] : ["--filter", packageName]), "run", proof.script];
  const output = execute("pnpm", args, root, proof.id);
  for (const marker of proof.markers) assert.ok(output.includes(marker), `${proof.id} omitted required marker: ${marker}.`);
}

export function runConformancePlan({ plan, pluginPackage, root }) {
  validateConformancePlan(plan);
  nonEmptyString(pluginPackage, "plugin package name");
  const results = [];
  for (const proof of plan.proofs) {
    if (proof.kind === "node-test") runNodeTest(proof, root);
    else if (proof.kind === "vitest") runVitest(proof, root);
    else runPnpmScript(proof, root, pluginPackage);
    results.push({ id: proof.id, covers: proof.covers, status: "pass" });
  }
  return Object.freeze(results);
}
