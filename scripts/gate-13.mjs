import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

assert.equal(process.versions.node, "24.19.0", `Gate 13 requires Node 24.19.0; found ${process.versions.node}.`);
assert.deepEqual(
  readdirSync(resolve(root, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  ["sales"],
  "Sales must remain the only first-party reference domain module through Gate 13."
);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.scripts?.["gate:13"], "pnpm gate:12 && node scripts/gate-13.mjs", "Gate 13 must invoke the cumulative Gate 0–12 chain first.");
assert.equal(packageJson.scripts?.["gate:13:focused"], "node scripts/gate-13.mjs", "Gate 13 focused entrypoint must be deterministic and direct.");

const phase12Result = read("docs/implementation/phase-12-result.md");
for (const marker of [
  "# Phase 12 Result",
  "**Decision:** **READY FOR PHASE REVIEW**",
  "GO PHASE 13 CRM-FIRST PRODUCTIZATION"
]) assert.ok(phase12Result.includes(marker), `Phase 12 result is missing inherited handoff evidence: ${marker}`);
for (let task = 1; task <= 10; task += 1) assert.ok(phase12Result.includes(`P12.${task}`), `Phase 12 result is missing task P12.${task}.`);

const phase13Plan = read("docs/implementation/phase-13-crm-first-productization.md");
for (const attack of [
  "cross-application account/contact/lead/opportunity access",
  "field/record permission bypass through list, detail, report, export, or dashboard",
  "forged owner/team/pipeline/stage/revision",
  "stale Kanban transition",
  "lead conversion replay or duplicate account/contact creation",
  "import formula, oversized file, malformed encoding, protected-field injection",
  "import crash/retry duplication",
  "unauthorized export or report recipient",
  "dedupe hidden-field leakage",
  "merge winner/loser substitution and stale revision",
  "email/calendar token or webhook-secret exfiltration",
  "forged/replayed inbound webhook",
  "unrestricted provider URL/network",
  "workflow arbitrary code/expression, loop, fan-out, or privilege escalation",
  "notification/reminder cross-user delivery",
  "money rounding/currency/timezone ambiguity",
  "lost outbox/realtime invalidation preserving stale authority",
  "prior-release migration or restore mismatch",
  "custom dashboard used to expand CRM data authority"
]) assert.ok(phase13Plan.includes(attack), `Phase 13 plan is missing required attack class: ${attack}`);

const corpus = spawnSync(process.execPath, ["scripts/phase-13-attack-corpus.mjs"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
});
assert.equal(corpus.error, undefined, `Phase 13 attack corpus could not start: ${corpus.error?.message}`);
assert.equal(corpus.status, 0, `Phase 13 attack corpus failed:\n${corpus.stderr || corpus.stdout}`);
const marker = corpus.stdout.lastIndexOf("\nP13_FIXTURE_READINESS_PASS");
assert.ok(marker >= 0, "Phase 13 fixture-readiness marker is missing.");
let evidence;
try {
  evidence = JSON.parse(corpus.stdout.slice(0, marker).trim());
} catch (error) {
  assert.fail(`Phase 13 attack corpus did not emit one machine-readable report: ${error.message}`);
}

assert.equal(evidence.phase, 13, "Phase 13 corpus reported the wrong phase.");
assert.equal(evidence.status, "FIXTURE_READY", "Phase 13 controlled fixture is not ready.");
assert.match(evidence.exactHead, /^[0-9a-f]{40}$/u, "Phase 13 corpus did not report one exact Git head.");
assert.equal(evidence.proofCount, 10, "Gate 13 must execute exactly ten focused process proof groups.");
assert.equal(evidence.proofs.length, evidence.proofCount, "Gate 13 proof count does not match executed proof groups.");
assert.equal(evidence.attacks.length, 15, "Gate 13 must execute all 15 frozen contract attack classes.");
assert.equal(evidence.requiredAttackClasses.length, 19, "Gate 13 must cover all 19 plan attack classes.");
assert.equal(evidence.journeys.length, 9, "Gate 13 must execute all nine frozen CRM journeys.");
assert.ok(evidence.evidenceClasses.length >= 20, "Gate 13 fixture-readiness evidence matrix is incomplete.");
for (const collection of [evidence.attacks, evidence.requiredAttackClasses, evidence.journeys, evidence.evidenceClasses]) {
  for (const item of collection) {
    assert.equal(item.outcome, "observed", `Gate 13 evidence was not observed: ${item.id || item.scenario}`);
    assert.ok(Array.isArray(item.evidence) && item.evidence.length > 0, `Gate 13 evidence has no executed proof: ${item.id || item.scenario}`);
  }
}
assert.deepEqual(evidence.evidenceClass, {
  classification: "controlled-fixture",
  applicationRelease: "1.0.0",
  operators: ["fixture-persona:sales-representative", "fixture-persona:sales-manager"],
  humanOperators: [],
  dates: { startedOn: "2026-09-09", endedOn: "2026-09-09", consecutiveBusinessDays: 0 },
  supportOwner: null,
  incidents: { recordClass: "not-observed-in-human-operation", sev1Closed: null, sev2Closed: null },
  observedResults: ["technical-controlled-fixture-ready", "limited-beta-operations-not-observed"],
  verdict: "REWORK-PILOT-OPERATIONS",
  externalPilotClaim: false,
  note: "Automated fixture evidence is not a real external pilot or human dogfood record."
}, "Gate 13 must report an honest fixture-only limited-beta verdict.");
assert.deepEqual(evidence.limitedBetaDecision, {
  verdict: "REWORK CRM DAILY WORKFLOW, DATA MODEL, OR PILOT OPERATIONS",
  unmetCriteria: [
    "five-consecutive-business-days",
    "two-active-human-users",
    "all-sev1-sev2-incidents-closed",
    "observed-rto-four-hours",
    "observed-rpo-fifteen-minutes",
    "product-sales-security-operations-signoffs"
  ]
}, "Gate 13 must fail closed on missing human pilot and sign-off evidence.");
assert.doesNotMatch(corpus.stdout, /real external pilot[^\n]{0,120}\bPASS\b/iu, "Gate 13 must not invent an external pilot PASS.");

const phase13Result = read("docs/implementation/phase-13-result.md");
for (const markerText of ["# Phase 13 Result", "fixture", "P13.10"]) {
  assert.ok(phase13Result.includes(markerText), `Phase 13 result is missing: ${markerText}`);
}
assert.doesNotMatch(phase13Result, /real external pilot[^\n]{0,120}\bPASS\b/iu, "Phase 13 result must not invent an external pilot PASS.");
for (let task = 1; task <= 10; task += 1) assert.ok(phase13Result.includes(`P13.${task}`), `Phase 13 result is missing task P13.${task}.`);

const finalHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
assert.equal(finalHead.status, 0, `Gate 13 could not read final Git head: ${finalHead.stderr}`);
assert.equal(finalHead.stdout.trim(), evidence.exactHead, "Gate 13 did not remain on one exact reviewed head.");

console.log(JSON.stringify({
  gate: "Gate 13",
  status: "FIXTURE_READY",
  exactHead: evidence.exactHead,
  cumulativeEntry: packageJson.scripts["gate:13"],
  attackCorpus: {
    status: evidence.status,
    contractAttacks: evidence.attacks.length,
    planAttackClasses: evidence.requiredAttackClasses.length,
    journeys: evidence.journeys.length,
    proofGroups: evidence.proofCount,
    evidenceClasses: evidence.evidenceClasses.length
  },
  evidenceClass: evidence.evidenceClass,
  limitedBetaDecision: evidence.limitedBetaDecision
}, null, 2));
console.log("GATE_13_FIXTURE_READINESS_PASS");
