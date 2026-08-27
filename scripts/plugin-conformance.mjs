import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const requiredPluginEvidence = Object.freeze([
  "accessibility-smoke", "component-runtime-puck", "default-page-seed", "deterministic-inventory",
  "fresh-migration-boot", "install-disable-reenable", "manifest-schema-fixtures", "package-export-boundaries",
  "packed-reproducibility", "settings-permission-attacks", "source-action-tool-event-realtime"
]);

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
  const canonicalRoot = realpathSync(root);
  const target = realpathSync(resolve(canonicalRoot, value));
  assert.ok(target.startsWith(`${canonicalRoot}${sep}`), `${label} must stay inside the target plugin.`);
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
    assert.ok(proof.kind === "node-test" || proof.kind === "runner-proof", `Unsupported conformance proof kind: ${String(proof.kind)}.`);
    exactKeys(proof, proof.kind === "node-test" ? ["covers", "file", "id", "kind", "testName"] : ["covers", "id", "kind"], `Conformance proof ${String(proof.id)}`);
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
    } else assert.ok(["package-export-boundaries", "packed-reproducibility"].includes(proof.id), `${proof.id} is not a runner-owned proof.`);
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

function tarEntries(file) {
  const archive = gunzipSync(readFileSync(file));
  const entries = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && !entries.has(name));
    const start = offset + 512;
    entries.set(name, archive.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function runBoundaryProof(pluginRoot) {
  const forbidden = ["@k-nex/runtime", "@modelcontextprotocol/sdk", "@puckeditor/core", "@tanstack/", "payload", "react", "socket.io", "./server.js"];
  for (const entrypoint of ["contracts", "browser", "ui"]) {
    const content = readFileSync(inside(pluginRoot, `src/${entrypoint}.ts`, `${entrypoint} source`), "utf8").toLowerCase();
    for (const dependency of forbidden) assert.equal(content.includes(dependency.toLowerCase()), false, `${entrypoint} imports forbidden dependency ${dependency}`);
  }
  for (const entrypoint of ["contracts", "browser", "ui", "migrations", "testing"]) {
    const declaration = readFileSync(inside(pluginRoot, `dist/${entrypoint}.d.ts`, `${entrypoint} declaration`), "utf8").toLowerCase();
    for (const dependency of ["payload", "react", "@puckeditor", "@modelcontextprotocol", "@tanstack", "socket.io"]) assert.equal(declaration.includes(dependency), false);
  }
}

function runPackProof(root, pluginRoot, identity) {
  const packageJson = JSON.parse(readFileSync(inside(pluginRoot, "package.json", "package manifest"), "utf8"));
  assert.equal(packageJson.name, identity.pluginPackage);
  const temporary = mkdtempSync(join(tmpdir(), "k-nex-conformance-pack-"));
  const filename = `${identity.pluginPackage.replace(/^@k-nex\//u, "k-nex-")}-${packageJson.version}.tgz`;
  try {
    execute("pnpm", ["pack", "--pack-destination", temporary], pluginRoot, "packed-reproducibility", identity);
    const generated = tarEntries(join(temporary, filename));
    const committed = tarEntries(resolve(root, "fixtures/customer-gate-1/packages", filename));
    assert.deepEqual([...generated.keys()], [...committed.keys()]);
    for (const [name, content] of generated) {
      const expected = committed.get(name);
      assert.ok(expected);
      if (name === "package/package.json") assert.deepEqual(JSON.parse(content.toString()), JSON.parse(expected.toString()));
      else assert.equal(content.equals(expected), true, `${basename(filename)}:${name} is stale.`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function runConformancePlan({ plan, pluginId, pluginPackage, pluginRoot, root }) {
  validateConformancePlan(plan);
  assert.equal(plan.pluginId, pluginId, "Conformance plan pluginId must match the target plugin.");
  assert.equal(plan.pluginPackage, pluginPackage, "Conformance plan pluginPackage must match the target plugin.");
  const identity = Object.freeze({ pluginId, pluginPackage });
  const results = [];
  for (const proof of plan.proofs) {
    if (proof.kind === "node-test") runNodeTest(proof, root, pluginRoot, identity);
    else if (proof.id === "package-export-boundaries") runBoundaryProof(pluginRoot);
    else runPackProof(root, pluginRoot, identity);
    results.push({ id: proof.id, covers: proof.covers, pluginId, status: "pass" });
  }
  return Object.freeze(results);
}
