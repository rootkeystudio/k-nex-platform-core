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
    "returns durable terminal receipt on replay",
    "durably rejects a resumed refresh when requester authority was revoked",
    "rechecks requester authority immediately before accepted-pointer CAS"
  ]],
  ["catalog-administration", "@k-nex/runtime", "tests/system-catalog-administration.test.ts", [
    "uses one stable server identity and returns a terminal receipt after response loss"
  ]],
  ["catalog-current-authority", "@k-nex/runtime", "tests/catalog-operation-current-authority.test.ts", [
    "binds persisted scope, actor, refresh and phase to one current decision"
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
    "projects active, pending, disabled, and retired records without secret references",
    "projects missing required values only for a pending configuration generation",
    "starts reviewed adoption without accepting source generation or retained values from the browser"
  ]],
  ["settings-coordinator", "@k-nex/payload-adapter", "tests/settings-validation-coordinator.test.ts", [
    "leases, validates, and promotes only the exact staged runtime generation",
    "returns the immutable terminal receipt after response loss without validation"
  ]],
  ["settings-change", "@k-nex/runtime", "tests/system-settings-administration-change.test.ts", [
    "rejects forged top-level and change fields before authority",
    "requires current, bound reauthentication evidence and persists only safe proof metadata",
    "rejects missing, stale, substituted, cross-actor, and replayed reauthentication evidence",
    "binds and unbinds only host-owned secret slots with reauthentication",
    "rechecks current state before writing, maps actual store errors, and rejects malformed store results"
  ]],
  ["settings-current-authority", "@k-nex/runtime", "tests/settings-operation-current-authority.test.ts", [
    "denies promotion after either captured permission is revoked",
    "binds scope, identity and one current revision"
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
const passedProofs = new Set();
for (const [id, workspace, file, names] of vitestProofs) {
  const output = run(id, "pnpm", ["--filter", workspace, "exec", "vitest", "run", file, "--reporter=json"]);
  const report = JSON.parse(output.trim());
  assert.equal(report.success, true, `${id} reported failure.`);
  assert.equal(report.numFailedTests, 0, `${id} reported a failed test.`);
  const passed = report.testResults.flatMap((result) => result.assertionResults).filter((test) => test.status === "passed").map((test) => test.title);
  for (const name of names) {
    assert.equal(passed.filter((actual) => actual === name).length, 1, `${id} omitted ${name}.`);
    passedProofs.add(`vitest:${id}:${name}`);
  }
  proofResults.push({ id, passed: report.numPassedTests, selected: names.length });
}

run("customer fixture build", "pnpm", ["--filter", "@k-nex/customer-gate-1", "build"]);
const nodeTests = [
  "tests/protected-role-baseline-upgrade-postgres.test.mjs",
  "tests/system-settings-storage-postgres.test.mjs",
  "tests/catalog-refresh-postgres.test.mjs",
  "tests/settings-convergence-postgres.test.mjs",
  "tests/system-operations-postgres.test.mjs",
  "tests/system-settings-theme-operations-browser.test.mjs"
];
const tap = run("Phase 11 PostgreSQL/HTTP/Chromium proofs", process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...nodeTests], fixture);
assert.equal(Number(/^# pass (\d+)$/mu.exec(tap)?.[1]), 9, "Phase 11 process proofs must pass exactly nine tests.");
for (const marker of ["P12_PROTECTED_BASELINE_RELEASE_UPGRADE_EVIDENCE=PASS", "P11_4_CATALOG_REFRESH_POSTGRES_HTTP_EVIDENCE=PASS", "P11_7_SYSTEM_OPERATIONS_POSTGRES_EVIDENCE=PASS", "P11_8_FIXED_ADMINISTRATION_POSTGRES_CHROMIUM_EVIDENCE=PASS", "P11_9_EFFECTIVE_SETTINGS_CONVERGENCE_EVIDENCE=PASS"]) {
  assert.match(tap, new RegExp(`^# ${marker}$`, "mu"), `Missing ${marker}.`);
  passedProofs.add(`process:${marker}`);
}

for (const result of ["docs/implementation/phase-9-result.md", "docs/implementation/phase-10-result.md"]) {
  assert.match(readFileSync(resolve(root, result), "utf8"), /\*\*Decision:\*\* \*\*ACCEPTED\*\*/u, `${result} is not accepted inherited attack evidence.`);
  passedProofs.add(`inherited:${result}`);
}

const attackProofs = {
  "descriptor-or-executable-value": ["vitest:settings-admission:projects active, pending, disabled, and retired records without secret references"],
  "secret-exfiltration": ["vitest:settings-change:binds and unbinds only host-owned secret slots with reauthentication", "process:P11_8_FIXED_ADMINISTRATION_POSTGRES_CHROMIUM_EVIDENCE=PASS"],
  "cross-owner-settings": ["vitest:effective-settings:never returns pending, disabled, retired, stale-owner, or invalid values"],
  "client-selected-authority": ["vitest:settings-change:rejects forged top-level and change fields before authority", "vitest:operations-authority:derives owner, inventory, actor, and permission while rejecting client authority fields", "process:P12_PROTECTED_BASELINE_RELEASE_UPGRADE_EVIDENCE=PASS"],
  "catalog-network-or-trust-forgery": ["vitest:catalog-network:accepts only one exact configured GitHub release asset API endpoint", "vitest:catalog-network:rejects redirects outside GitHub asset storage and redirect loops"],
  "invalid-refresh-pointer-replacement": ["vitest:catalog-refresh:persists fetch failure without replacing prior pointer", "vitest:catalog-refresh:rechecks requester authority immediately before accepted-pointer CAS", "process:P11_4_CATALOG_REFRESH_POSTGRES_HTTP_EVIDENCE=PASS"],
  "stale-approval-or-cross-actor-replay": ["vitest:catalog-administration:uses one stable server identity and returns a terminal receipt after response loss", "vitest:catalog-current-authority:binds persisted scope, actor, refresh and phase to one current decision", "vitest:settings-change:rejects missing, stale, substituted, cross-actor, and replayed reauthentication evidence", "vitest:settings-current-authority:denies promotion after either captured permission is revoked", "vitest:operations-authority:returns an exact actor-bound replay before rejecting the now-stale original revision"],
  "theme-class-confusion": ["vitest:theme-authority:keeps Package, Skin, and Profile classes distinct and blocks referenced package removal"],
  "unverified-theme-publication": ["vitest:theme-publication:rejects a failed preview without writing profile state"],
  "forged-health-or-operation-receipt": ["vitest:operations-authority:derives owner, inventory, actor, and permission while rejecting client authority fields", "process:P11_7_SYSTEM_OPERATIONS_POSTGRES_EVIDENCE=PASS"],
  "lost-invalidation": ["process:P11_9_EFFECTIVE_SETTINGS_CONVERGENCE_EVIDENCE=PASS"],
  "generation-resurrection": ["vitest:settings-coordinator:leases, validates, and promotes only the exact staged runtime generation", "vitest:effective-settings:never returns pending, disabled, retired, stale-owner, or invalid values"],
  "docker-repository-or-backup-authority-escape": ["process:P11_7_SYSTEM_OPERATIONS_POSTGRES_EVIDENCE=PASS", "inherited:docs/implementation/phase-10-result.md"]
};
const attacks = Object.keys(attackProofs);
assert.equal(new Set(attacks).size, 13, "Phase 11 must machine-map exactly 13 attack classes.");
for (const [attack, proofs] of Object.entries(attackProofs)) {
  assert.ok(proofs.length > 0, `${attack} has no executable proof mapping.`);
  for (const proof of proofs) assert.ok(passedProofs.has(proof), `${attack} references an unexecuted proof: ${proof}`);
}

console.log(JSON.stringify({ phase: 11, status: "PASS", attacks: attackProofs, focusedProofs: proofResults, processProofs: 9, inheritedGates: [9, 10] }, null, 2));
console.log("P11_ATTACK_CORPUS_PASS");
