import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

export const requiredPluginEvidence = Object.freeze([
  "accessibility-smoke", "component-runtime-puck", "default-page-seed", "deterministic-inventory",
  "fresh-migration-boot", "install-disable-reenable", "manifest-schema-fixtures", "package-export-boundaries",
  "packed-reproducibility", "settings-permission-attacks", "source-action-tool-event-realtime",
  "browser-query-action-factories", "reference-documentation-generation"
]);

const runnerProofIds = Object.freeze([
  "package-export-boundaries", "packed-reproducibility", "customer-postgres-lifecycle",
  "sales-platform-boundaries", "reference-documentation-generation"
]);
const runnerEvidence = Object.freeze({
  "package-export-boundaries": ["package-export-boundaries"],
  "packed-reproducibility": ["packed-reproducibility"],
  "customer-postgres-lifecycle": ["deterministic-inventory", "fresh-migration-boot", "install-disable-reenable"],
  "sales-platform-boundaries": ["source-action-tool-event-realtime"],
  "reference-documentation-generation": ["reference-documentation-generation"]
});
const protectedRunnerEvidence = new Set(Object.values(runnerEvidence).flat());

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
  assert.equal(plan.schemaVersion, 3, "Unsupported plugin conformance schema version.");
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
      assert.equal(proof.covers.some((evidence) => protectedRunnerEvidence.has(evidence)), false, `${proof.id} claims runner-owned evidence.`);
    } else {
      assert.ok(runnerProofIds.includes(proof.id), `${proof.id} is not a runner-owned proof.`);
      assert.deepEqual(proof.covers, runnerEvidence[proof.id], `${proof.id} runner evidence is invalid.`);
    }
  }
  assert.deepEqual(coverage.slice().sort(), [...requiredPluginEvidence].sort(), "Plugin conformance evidence must be exact, unique, and complete.");
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
  assertNoShellWrapper(inside(pluginRoot, proof.file, `${proof.id} file`), pluginRoot);
  const output = execute(process.execPath, ["--test", "--test-reporter=tap", `--test-name-pattern=^${escapeRegExp(proof.testName)}$`, inside(pluginRoot, proof.file, `${proof.id} file`)], root, proof.id, identity);
  assert.match(output, new RegExp(`^ok \\d+ - ${escapeRegExp(proof.testName)}$`, "m"), `${proof.id} did not execute its named target-plugin test.`);
  assert.match(output, /^# pass 1$/m, `${proof.id} did not pass exactly one named test.`);
  assert.match(output, /^# fail 0$/m, `${proof.id} reported a failure.`);
}

function importSpecifiers(content) {
  const values = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of content.matchAll(pattern)) values.push(match[1] ?? match[2] ?? match[3]);
  return values;
}

function localImport(origin, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const candidate = resolve(dirname(origin), specifier);
  const alternatives = [candidate, `${candidate}.ts`, `${candidate}.js`, candidate.replace(/\.js$/u, ".ts"), join(candidate, "index.ts"), join(candidate, "index.js")];
  return alternatives.find((value) => existsSync(value));
}

function walkImports(entry, pluginRoot, visit) {
  const canonicalRoot = realpathSync(pluginRoot);
  const pending = [realpathSync(entry)];
  const seen = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(file.startsWith(`${canonicalRoot}${sep}`), "Transitive plugin imports must stay inside the target plugin.");
    const content = readFileSync(file, "utf8");
    const specifiers = importSpecifiers(content);
    visit({ content, file, specifiers });
    for (const specifier of specifiers) {
      const local = localImport(file, specifier);
      if (local !== undefined) pending.push(realpathSync(local));
    }
  }
}

export function assertNoShellWrapper(entry, pluginRoot) {
  const forbidden = new Set(["child_process", "node:child_process", "execa", "zx"]);
  walkImports(entry, pluginRoot, ({ content, file, specifiers }) => {
    assert.equal(specifiers.some((specifier) => forbidden.has(specifier)), false, `${file} imports a forbidden process runner.`);
    assert.equal(/\b(?:execFile|execFileSync|spawn|spawnSync)\s*\(/u.test(content), false, `${file} invokes a process runner.`);
  });
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

export function runBoundaryProof(pluginRoot) {
  const forbidden = ["@k-nex/runtime", "@modelcontextprotocol/sdk", "@puckeditor/core", "@tanstack/", "payload", "react", "socket.io", "./server.js"];
  for (const entrypoint of ["contracts", "browser", "ui"]) {
    walkImports(inside(pluginRoot, `src/${entrypoint}.ts`, `${entrypoint} source`), pluginRoot, ({ content, file, specifiers }) => {
      const normalized = content.toLowerCase();
      for (const dependency of forbidden) assert.equal(normalized.includes(dependency.toLowerCase()), false, `${file} imports forbidden dependency ${dependency}`);
      assert.equal(specifiers.some((specifier) => specifier.startsWith(".") && specifier.includes("server")), false, `${file} reaches a server entrypoint.`);
    });
  }
  for (const entrypoint of ["contracts", "browser", "ui", "migrations", "testing"]) {
    const declaration = readFileSync(inside(pluginRoot, `dist/${entrypoint}.d.ts`, `${entrypoint} declaration`), "utf8").toLowerCase();
    for (const dependency of ["payload", "react", "@puckeditor", "@modelcontextprotocol", "@tanstack", "socket.io"]) assert.equal(declaration.includes(dependency), false);
  }
}

function runCustomerPostgresProof(root, identity) {
  assert.deepEqual(identity, { pluginId: "module.sales", pluginPackage: "@k-nex/module-sales" });
  const output = execute("pnpm", ["--dir", "fixtures/customer-gate-1", "test:postgres"], root, "customer-postgres-lifecycle", identity);
  assert.match(output, /proves customer-owned migrations and revision-aware Postgres boot/);
  assert.match(output, /pass 1/);
  assert.match(output, /fail 0/);
}

function runSalesPlatformProof(root, pluginRoot, identity) {
  assert.deepEqual(identity, { pluginId: "module.sales", pluginPackage: "@k-nex/module-sales" });
  const eventOutput = execute(process.execPath, [
    "--test", "--test-reporter=tap", "--test-name-pattern=^Sales durable events project task and opportunity invalidations through the realtime gateway$",
    inside(pluginRoot, "tests/server.test.mjs", "Sales event proof")
  ], root, "sales-platform-boundaries", identity);
  assert.match(eventOutput, /^# pass 1$/m);
  const toolOutput = execute("pnpm", ["--filter", identity.pluginPackage, "exec", "vitest", "run", "tests/mcp-sales-proof.test.ts"], root, "sales-platform-boundaries", identity);
  assert.match(toolOutput, /Test Files\s+1 passed/);
  assert.match(toolOutput, /Tests\s+1 passed/);
}

export function generateReferenceDocumentation(manifest, packageJson, plan) {
  const rows = Object.entries(manifest.contributions).sort(([left], [right]) => left.localeCompare(right))
    .map(([category, entries]) => `| ${category} | ${Object.keys(entries).sort().join(", ")} |`);
  return [
    "# Sales Plugin Generated Reference", "", "<!-- Generated by scripts/plugin-conformance.mjs; do not edit manually. -->", "",
    `- Plugin: \`${manifest.id}\``, `- Package: \`${packageJson.name}@${packageJson.version}\``,
    `- Entrypoints: ${Object.keys(packageJson.exports).sort().map((entry) => `\`${entry}\``).join(", ")}`, "",
    "## Contributions", "", "| Category | IDs |", "|---|---|", ...rows, "",
    "## Conformance evidence", "", ...requiredPluginEvidence.map((evidence) => `- \`${evidence}\``), ""
  ].join("\n");
}

function runReferenceDocumentationProof(root, pluginRoot, identity, plan) {
  const manifest = JSON.parse(readFileSync(inside(pluginRoot, "k-nex.plugin.json", "plugin manifest"), "utf8"));
  const packageJson = JSON.parse(readFileSync(inside(pluginRoot, "package.json", "package manifest"), "utf8"));
  assert.equal(manifest.id, identity.pluginId);
  assert.equal(packageJson.name, identity.pluginPackage);
  const expected = generateReferenceDocumentation(manifest, packageJson, plan);
  const actual = readFileSync(resolve(root, "docs/generated/module-sales-reference.md"), "utf8");
  assert.equal(actual, expected, "Generated Sales reference documentation is stale.");
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
    else if (proof.id === "packed-reproducibility") runPackProof(root, pluginRoot, identity);
    else if (proof.id === "customer-postgres-lifecycle") runCustomerPostgresProof(root, identity);
    else if (proof.id === "sales-platform-boundaries") runSalesPlatformProof(root, pluginRoot, identity);
    else runReferenceDocumentationProof(root, pluginRoot, identity, plan);
    results.push({ id: proof.id, covers: proof.covers, pluginId, status: "pass" });
  }
  return Object.freeze(results);
}
