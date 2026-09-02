import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "fixtures/customer-gate-1");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.equal(process.versions.node, "24.19.0", `Gate 10 requires Node 24.19.0; found ${process.versions.node}.`);

const run = (label, command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
  assert.equal(result.error, undefined, `${label} could not start: ${result.error?.message}`);
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
};

const authorizationSchema = JSON.parse(read("schemas/authorization.v1.schema.json"));
assert.equal(authorizationSchema.$id, "https://schemas.k-nex.dev/authorization.v1.schema.json", "Authorization schema must retain its canonical ID.");
assert.equal(authorizationSchema.kNexAuthorizationOwnership, true, "Authorization schema must retain canonical ownership validation.");
assert.ok(read("contracts/generated-contracts.v1.json").includes("schemas/authorization.v1.schema.json"), "Generated contract inventory omits the authorization schema.");
assert.deepEqual(
  readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
  ["sales"],
  "Sales must remain the only first-party reference domain module through Gate 10."
);

run("Architecture contract tools", "pnpm", ["--filter", "@k-nex/architecture-contract-tools", "test"]);
run("Customer Gate 1 build", "pnpm", ["--filter", "@k-nex/customer-gate-1", "build"]);

const testFiles = [
  "authorization-storage-postgres.test.mjs",
  "authorization-effective-authority-postgres.test.mjs",
  "current-authority-boundaries-postgres.test.mjs",
  "sales-record-scope-race-postgres.test.mjs",
  "authorization-read-concurrency-postgres.test.mjs",
  "system-access-delegation-postgres.test.mjs",
  "authorization-template-bootstrap-postgres.test.mjs",
  "protected-role-baseline-upgrade-postgres.test.mjs",
  "template-tombstones-migration-down-postgres.test.mjs",
  "authorization-lifecycle-postgres.test.mjs",
  "current-authority-lifecycle-postgres.test.mjs",
  "authorization-convergence-postgres.test.mjs",
  "hot-application-fixed-route-host-admission.test.mjs",
  "system-administration-postgres-browser.test.mjs"
];
const expectedTests = [
  "migrates P10.3 authorization storage with customer isolation and generation fences",
  "P10.4 resolves current PostgreSQL authority without cache or client-forgery reuse",
  "P10.5 current authority denies fixture source/action before handler, cache, and Payload",
  "P10.10 atomically rejects a Sales update after concurrent scope exit without write or event",
  "P10.10 slow administration reads do not block authorization mutations",
  "P10.10 blocks User Admin and Security Admin escalation at the PostgreSQL administration boundary",
  "P10.6 persists protected roles and Sales template bootstrap through PostgreSQL",
  "reconciles only an exact recognized protected baseline through real PostgreSQL",
  "rolls back independent template tombstones through Payload's migration API",
  "P10.7 projects Sales lifecycle generations and retained-grant adoption through PostgreSQL",
  "P10.7 durable lifecycle catalog binds and revokes Sales and Hot authority",
  "converges authorization revisions through the durable outbox and polling recovery",
  "P10.8 fixed route binds emitted authorization admission to current authority",
  "P10.8 fixed route sessions cannot replay after revocation and regrant",
  "P10.9 proves fixed host routes, RBAC actions, lifecycle truth, and Chromium semantics against PostgreSQL"
];
const tap = run(
  "Phase 10 PostgreSQL and Chromium evidence",
  process.execPath,
  ["--test", "--test-concurrency=1", "--test-reporter=tap", ...testFiles.map((file) => `tests/${file}`)],
  { cwd: fixture }
);
const passed = [...tap.matchAll(/^ok \d+ - (.+)$/gmu)].map(([, name]) => name);
const passCount = Number(/^# pass (\d+)$/mu.exec(tap)?.[1]);
assert.equal(passCount, expectedTests.length, `Phase 10 evidence must pass exactly ${expectedTests.length} named tests; found ${passCount}.`);
for (const name of expectedTests) assert.equal(passed.filter((actual) => actual === name).length, 1, `Phase 10 evidence did not run and pass exactly once: ${name}`);
assert.match(tap, /^# P10_9_SYSTEM_ADMIN_POSTGRES_CHROMIUM_EVIDENCE=PASS$/mu, "P10.9 Chromium evidence marker was not emitted by its passing test.");

const phaseResult = read("docs/implementation/phase-10-result.md");
for (const marker of [
  "# Phase 10 Result",
  "**Decision:** **READY FOR PHASE REVIEW**",
  "GO SYSTEM SETTINGS AND FULL EXTENSION ADMINISTRATION PRODUCTIZATION",
  "Convergence evidence covers seven callback boundaries, but it does not claim seven independent processes."
]) assert.ok(phaseResult.includes(marker), `Phase 10 result is missing: ${marker}`);
for (let task = 1; task <= 10; task += 1) assert.ok(phaseResult.includes(`P10.${task}`), `Phase 10 result is missing task P10.${task}.`);

console.log(JSON.stringify({
  gate: "Gate 10",
  postgresAndChromiumTests: expectedTests.length,
  marker: "P10_9_SYSTEM_ADMIN_POSTGRES_CHROMIUM_EVIDENCE=PASS",
  referenceModules: ["sales"]
}, null, 2));
console.log("GATE_10_PASS");
