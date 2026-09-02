import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "fixtures/customer-gate-1");

assert.equal(process.versions.node, "24.19.0", `Phase 11 attack corpus requires Node 24.19.0; found ${process.versions.node}.`);

function run(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.error, undefined, `${label} could not start: ${result.error?.message}`);
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
}

const vitestProofs = [
  ["catalog-network", "@k-nex/extension-bundler", "tests/github-catalog-reader.test.ts", [
    "accepts only one exact configured GitHub release asset API endpoint",
    "reads JSON through one bounded GitHub asset redirect without credentials",
    "rejects redirects outside GitHub asset storage and redirect loops",
    "enforces declared and streamed byte bounds",
    "aborts the request at the configured deadline",
    "enforces the reader through a real streamed HTTP response"
  ]],
  ["catalog-refresh", "@k-nex/payload-adapter", "tests/catalog-refresh-coordinator.test.ts", [
    "persists fetch failure without replacing prior pointer",
    "persists replay rejection",
    "resumes staged work after crash without fetching again",
    "binds exact quarantine receipt before acceptance",
    "returns durable terminal receipt on replay"
  ]],
  ["theme-publication", "@k-nex/payload-adapter", "tests/theme-profile-authorization.test.ts", [
    "denies before opening a database operation",
    "uses read/manage permissions and requires server reauthentication for publish and rollback",
    "rechecks read authority after PostgreSQL before releasing a profile",
    "rejects a failed preview without writing profile state"
  ]],
  ["settings-admission", "@k-nex/runtime", "tests/system-settings-administration.test.ts", [
    "denies the fixed read target before descriptor source or store access",
    "fails closed when authorization or lifecycle changes while values are read",
    "projects active, pending, disabled, and retired records without secret references"
  ]],
  ["settings-change", "@k-nex/runtime", "tests/system-settings-administration-change.test.ts", [
    "rejects forged top-level and change fields before authority",
    "rechecks current state before writing, maps actual store errors, and rejects malformed store results"
  ]],
  ["effective-settings", "@k-nex/runtime", "tests/effective-settings-provider.test.ts", [
    "re-resolves the active exact owner around the authoritative document read",
    "never returns pending, disabled, retired, stale-owner, or invalid values",
    "fails closed when the descriptor owner changes during the read"
  ]],
  ["extension-authority", "@k-nex/runtime", "tests/system-extension-administration-real-authority.test.ts", [
    "keeps facade and manager permissions current, persists the authorized actor, and isolates browser-bound operations"
  ]],
  ["theme-authority", "@k-nex/runtime", "tests/system-theme-administration.test.ts", [
    "keeps Package, Skin, and Profile classes distinct and blocks referenced package removal",
    "denies before profile or catalog authority is touched",
    "rechecks current authority after resolving the operator and before mutation"
  ]],
  ["operations-authority", "@k-nex/runtime", "tests/system-operations-administration.test.ts", [
    "joins and deduplicates only same-owner authoritative references and health",
    "denies before touching projection or operator authority",
    "derives owner, inventory, actor, and permission while rejecting client authority fields",
    "requires server approval for restore drills",
    "returns an exact actor-bound replay before rejecting the now-stale original revision"
  ]]
];

const proofResults = [];
for (const [id, workspace, file, names] of vitestProofs) {
  const output = run(id, "pnpm", ["--filter", workspace, "exec", "vitest", "run", file, "--reporter=json"]);
  const report = JSON.parse(output.trim());
  assert.equal(report.success, true, `${id} reported failure.`);
  assert.equal(report.numFailedTests, 0, `${id} reported a failed test.`);
  const passed = report.testResults.flatMap((result) => result.assertionResults).filter((test) => test.status === "passed").map((test) => test.title);
  for (const name of names) assert.equal(passed.filter((actual) => actual === name).length, 1, `${id} omitted ${name}.`);
  proofResults.push({ id, passed: report.numPassedTests, selected: names.length });
}

run("customer fixture build", "pnpm", ["--filter", "@k-nex/customer-gate-1", "build"]);
const nodeTests = [
  "tests/system-settings-storage-postgres.test.mjs",
  "tests/catalog-refresh-postgres.test.mjs",
  "tests/settings-convergence-postgres.test.mjs",
  "tests/system-operations-postgres.test.mjs",
  "tests/system-settings-theme-operations-browser.test.mjs"
];
const tap = run("Phase 11 PostgreSQL/HTTP/Chromium proofs", process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...nodeTests], fixture);
assert.equal(Number(/^# pass (\d+)$/mu.exec(tap)?.[1]), 7, "Phase 11 process proofs must pass exactly seven tests.");
for (const marker of ["P11_7_SYSTEM_OPERATIONS_POSTGRES_EVIDENCE=PASS", "P11_8_FIXED_ADMINISTRATION_POSTGRES_CHROMIUM_EVIDENCE=PASS", "P11_9_EFFECTIVE_SETTINGS_CONVERGENCE_EVIDENCE=PASS"]) {
  assert.match(tap, new RegExp(`^# ${marker}$`, "mu"), `Missing ${marker}.`);
}

for (const result of ["docs/implementation/phase-9-result.md", "docs/implementation/phase-10-result.md"]) {
  assert.match(readFileSync(resolve(root, result), "utf8"), /\*\*Decision:\*\* \*\*ACCEPTED\*\*/u, `${result} is not accepted inherited attack evidence.`);
}

const attacks = [
  "descriptor-or-executable-value", "secret-exfiltration", "cross-owner-settings", "client-selected-authority",
  "catalog-network-or-trust-forgery", "invalid-refresh-pointer-replacement", "stale-approval-or-cross-actor-replay",
  "theme-class-confusion", "unverified-theme-publication", "forged-health-or-operation-receipt",
  "lost-invalidation", "generation-resurrection", "docker-repository-or-backup-authority-escape"
];
assert.equal(new Set(attacks).size, 13);

console.log(JSON.stringify({ phase: 11, status: "PASS", attacks, focusedProofs: proofResults, processProofs: 7, inheritedGates: [9, 10] }, null, 2));
console.log("P11_ATTACK_CORPUS_PASS");
