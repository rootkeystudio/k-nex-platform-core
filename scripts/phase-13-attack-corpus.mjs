import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "fixtures/customer-gate-1");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const contract = JSON.parse(read("contracts/phase-13-crm-product-contract.v1.json"));

assert.equal(process.versions.node, "24.19.0", `Phase 13 attack corpus requires Node 24.19.0; found ${process.versions.node}.`);
assert.deepEqual(
  readdirSync(resolve(root, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  ["sales"],
  "Sales must remain the only first-party reference domain module through Gate 13."
);

function run(label, command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.error, undefined, `${label} could not start: ${result.error?.message}`);
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
  return `${result.stdout}\n${result.stderr}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function passedTapNames(output) {
  return output
    .split(/\r?\n/u)
    .filter((line) => /^ok \d+ - /u.test(line) && !/\s# (?:SKIP|TODO)(?:\s|$)/u.test(line))
    .map((line) => line.replace(/^ok \d+ - /u, "").replace(/\s+#.*$/u, "").trim());
}

function passMarkers(output) {
  return [...output.matchAll(/^# ([A-Z][A-Z0-9_]+)=PASS$/gmu)].map((match) => match[1]);
}

const exactHead = run("exact reviewed head", "git", ["rev-parse", "HEAD"]).trim();
assert.match(exactHead, /^[0-9a-f]{40}$/u, "Gate 13 requires one exact Git head.");
const initialWorktree = run("clean reviewed worktree", "git", ["status", "--porcelain=v1", "--untracked-files=all"]).trim();
assert.equal(initialWorktree, "", `Gate 13 refuses uncommitted evidence:\n${initialWorktree}`);

const proofResults = [];
const passedProofs = new Set();

function nodeProof(id, files, names) {
  for (const file of files) assert.ok(read(`fixtures/customer-gate-1/${file}`), `${id} proof file is missing: ${file}`);
  assert.ok(names.length > 0, `${id} has no exact named evidence.`);
  const pattern = `^(?:${names.map(escapeRegExp).join("|")})$`;
  const output = run(id, process.execPath, [
    "--test", "--test-force-exit", "--test-concurrency=1", "--test-reporter=tap",
    `--test-name-pattern=${pattern}`,
    ...files
  ], fixture);
  const passed = passedTapNames(output);
  for (const name of names) {
    assert.equal(passed.filter((actual) => actual === name).length, 1, `${id} omitted or skipped ${name}.`);
    passedProofs.add(`node:${id}:${name}`);
  }
  const result = { id, files, names, markers: passMarkers(output) };
  proofResults.push(result);
  return result;
}

run("customer fixture build", "pnpm", ["--filter", "@k-nex/customer-gate-1", "build"]);
run("current-v1 Sales release source", process.execPath, ["scripts/generate-current-v1-sales-release-source.mjs", "--check"]);
run("packed v1 closure", process.execPath, ["scripts/check-phase-8-packed-packages.mjs"]);
run("factory lock generation check", process.execPath, ["scripts/generate-phase-12-factory-locks.mjs", "--check"]);

const proofs = [
  nodeProof("core-migration", [
    "tests/p13-2-crm-core-migration-postgres.test.mjs",
    "tests/p13-3-crm-http-postgres.test.mjs"
  ], [
    "P13.2 CRM core migration proves clean install, exact upgrade, fail-closed preflight, and maintenance rollback",
    "P13.3 CRM HTTP/PG actions preserve replay, target scope, and protected-input boundaries"
  ]),
  nodeProof("crm-browser", ["tests/p13-3-generated-crm-browser-postgres.test.mjs"], [
    "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys"
  ]),
  nodeProof("crm-recovery", [
    "tests/p13-3-generated-crm-realtime-browser-postgres.test.mjs",
    "tests/p13-3-generated-crm-worker-shutdown-postgres.test.mjs",
    "tests/p13-3-generated-attachment-admission-postgres.test.mjs",
    "tests/p13-3-generated-sales-outbox-isolation-postgres.test.mjs",
    "tests/p13-3-generated-opportunity-amount-browser-postgres.test.mjs",
    "tests/p13-3-generated-packed-shutdown-postgres.test.mjs"
  ], [
    "P13.3 generated browser receives opaque Socket.IO invalidations, resyncs after a host loss, and drops revoked current authority",
    "P13.3 generated worker joins admitted work, bounds a blocked drain, and fails rejected dispatch shutdowns",
    "P13.3 generated attachment admission ledger denies unissued or mismatched storage and survives host restart",
    "P13.3 generated Sales worker claims only its closed application/plugin/event partition",
    "P13.3 generated opportunity detail selects amount only for the exact field grant",
    "P13.3 packed composition emits its embedded Payload patch and shuts down a generated Postgres app"
  ]),
  nodeProof("pipeline", [
    "tests/p13-4-pipeline-saved-views-postgres.test.mjs",
    "tests/p13-4-generated-config-http-postgres.test.mjs",
    "tests/p13-4-generated-pipeline-overlap-postgres.test.mjs",
    "tests/p13-4-generated-sales-ui-browser-postgres.test.mjs"
  ], [
    "P13.4 migrates opaque stage identities atomically, persists evidence, and replays safely",
    "P13.4 generated HTTP configuration actions commit CAS, audit, outbox, realtime delivery, and idempotency atomically",
    "P13.4 generated transactions serialize pipeline snapshots against create, stage, and close without loser residue",
    "P13.4 generated Chromium renders the native sales configuration surfaces with accessible controls"
  ]),
  nodeProof("data-movement", [
    "tests/p13-5-data-movement-postgres.test.mjs",
    "tests/p13-5-generated-data-movement-browser-postgres.test.mjs"
  ], [
    "P13.5 parser rejects malformed, oversized, formula, and protected-field input",
    "P13.5 fixture upload bounds chunked requests before authorization or database work",
    "P13.5 fixture upload admission CAS denies stale, revoked, disabled, raced, and promoted-away authority with zero rows",
    "P13.5 worker restarts exactly once, emits a partial artifact, fences revocation, purges payloads, and publishes snapshot-only CSV",
    "P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys"
  ]),
  nodeProof("communications", [
    "tests/p13-6-communications-postgres.test.mjs",
    "tests/p13-6-generated-communications-browser-postgres.test.mjs"
  ], [
    "P13.6 provider operations keep secret references opaque and make send/sync idempotency actor- and application-scoped",
    "P13.6 webhooks enforce body, signature, time, replay, application binding, and secret non-leak",
    "P13.6 provider outage retries are bounded, dead-lettered, and generation fenced",
    "P13.6 reminder delivery stays atomic and generation-fenced",
    "P13.6 provider effect is externally idempotent across a spawned worker restart",
    "P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys"
  ]),
  nodeProof("workflows", [
    "tests/p13-7-workflows-postgres.test.mjs",
    "tests/p13-7-generated-workflow-http-worker-postgres.test.mjs"
  ], [
    "P13.7 exact rules produce one task, fixed notice, and clamped reminder",
    "P13.7 concurrent worker ingestion is application/environment isolated and idempotent",
    "P13.7 terminal authority and lifecycle denials create zero effects; system effects survive actor auth revoke",
    "P13.7 expired crashed third claim restart dead-letters once with canonical audit/outbox and zero effect",
    "P13.7 actor-type mutation after accepted source isolates to canonical conflict terminalization",
    "P13.7 wrong immutable envelope for same transition id/payload is isolated while batch peer succeeds",
    "P13.7 effect receipt collision rolls back domain effect; 16-item batch leaves independent work healthy",
    "P13.7 generated HTTP action and restarted worker preserve one durable workflow effect"
  ]),
  nodeProof("reports", [
    "tests/p13-8-reports-postgres.test.mjs",
    "tests/p13-8-generated-reports-browser-postgres.test.mjs"
  ], [
    "P13.8 real PG processes exact closed seven-report catalog with one fenced artifact/audit/outbox chain",
    "P13.8 real PG denies already-produced artifact bytes after ownership, team, archive, or stage source mutation",
    "P13.8 real PG fixes report bytes, authorized count, watermark, and as-of to one repeatable-read snapshot across a blocked concurrent mutation",
    "P13.8 real PG derives money scale only from canonical ISO-4217 settings and rejects invalid currency",
    "P13.8 real PG activity report uses occurred-at and only current immutable activity facts",
    "P13.8 real PG due schedule enqueues once, advances canonically, and cancels a revoked recipient",
    "P13.8 real PG keeps scheduled and manual report authority origin-specific",
    "P13.8 generated HTTP/Chromium reports route queues one artifact and keeps unrelated CRM healthy"
  ]),
  nodeProof("upgrade-restore", [
    "tests/p13-9-upgrade-backup-restore-postgres.test.mjs",
    "tests/p13-9-generated-restore-browser-postgres.test.mjs"
  ], [
    "P13.9 upgrades the exact Phase-12 Sales predecessor and restores its current-v1 truth into a clean PostgreSQL database",
    "P13.9 generated Chromium proves physical Postgres restore preserves current CRM product"
  ]),
  nodeProof("fixture-readiness", [
    "tests/p13-10-limited-beta-fixture-postgres.test.mjs",
    "tests/p13-10-generated-fixture-browser-postgres.test.mjs"
  ], [
    "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings",
    "P13.10 generated fixture proves controlled browser readiness before and after restore"
  ])
];

const proofKey = (id, name) => `node:${id}:${name}`;
const evidence = (id, name) => proofKey(id, name);

const attackProofs = {
  "P13-ATK-01": [
    evidence("core-migration", "P13.3 CRM HTTP/PG actions preserve replay, target scope, and protected-input boundaries"),
    evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys"),
    evidence("reports", "P13.8 generated HTTP/Chromium reports route queues one artifact and keeps unrelated CRM healthy")
  ],
  "P13-ATK-02": [
    evidence("core-migration", "P13.3 CRM HTTP/PG actions preserve replay, target scope, and protected-input boundaries"),
    evidence("pipeline", "P13.4 generated HTTP configuration actions commit CAS, audit, outbox, realtime delivery, and idempotency atomically"),
    evidence("pipeline", "P13.4 generated transactions serialize pipeline snapshots against create, stage, and close without loser residue")
  ],
  "P13-ATK-03": [
    evidence("pipeline", "P13.4 migrates opaque stage identities atomically, persists evidence, and replays safely"),
    evidence("pipeline", "P13.4 generated transactions serialize pipeline snapshots against create, stage, and close without loser residue")
  ],
  "P13-ATK-04": [
    evidence("core-migration", "P13.3 CRM HTTP/PG actions preserve replay, target scope, and protected-input boundaries"),
    evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys")
  ],
  "P13-ATK-05": [
    evidence("data-movement", "P13.5 parser rejects malformed, oversized, formula, and protected-field input"),
    evidence("data-movement", "P13.5 fixture upload bounds chunked requests before authorization or database work")
  ],
  "P13-ATK-06": [
    evidence("data-movement", "P13.5 worker restarts exactly once, emits a partial artifact, fences revocation, purges payloads, and publishes snapshot-only CSV"),
    evidence("data-movement", "P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys"),
    evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")
  ],
  "P13-ATK-07": [
    evidence("data-movement", "P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys"),
    evidence("reports", "P13.8 real PG denies already-produced artifact bytes after ownership, team, archive, or stage source mutation"),
    evidence("reports", "P13.8 generated HTTP/Chromium reports route queues one artifact and keeps unrelated CRM healthy")
  ],
  "P13-ATK-08": [
    evidence("data-movement", "P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys")
  ],
  "P13-ATK-09": [
    evidence("communications", "P13.6 provider operations keep secret references opaque and make send/sync idempotency actor- and application-scoped"),
    evidence("communications", "P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys")
  ],
  "P13-ATK-10": [
    evidence("communications", "P13.6 webhooks enforce body, signature, time, replay, application binding, and secret non-leak")
  ],
  "P13-ATK-11": [
    evidence("workflows", "P13.7 exact rules produce one task, fixed notice, and clamped reminder"),
    evidence("workflows", "P13.7 wrong immutable envelope for same transition id/payload is isolated while batch peer succeeds"),
    evidence("workflows", "P13.7 effect receipt collision rolls back domain effect; 16-item batch leaves independent work healthy")
  ],
  "P13-ATK-12": [
    evidence("communications", "P13.6 reminder delivery stays atomic and generation-fenced"),
    evidence("communications", "P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys"),
    evidence("workflows", "P13.7 exact rules produce one task, fixed notice, and clamped reminder")
  ],
  "P13-ATK-13": [
    evidence("core-migration", "P13.2 CRM core migration proves clean install, exact upgrade, fail-closed preflight, and maintenance rollback"),
    evidence("reports", "P13.8 real PG derives money scale only from canonical ISO-4217 settings and rejects invalid currency"),
    evidence("reports", "P13.8 real PG activity report uses occurred-at and only current immutable activity facts"),
    evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")
  ],
  "P13-ATK-14": [
    evidence("crm-recovery", "P13.3 generated browser receives opaque Socket.IO invalidations, resyncs after a host loss, and drops revoked current authority"),
    evidence("crm-recovery", "P13.3 generated Sales worker claims only its closed application/plugin/event partition"),
    evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")
  ],
  "P13-ATK-15": [
    evidence("core-migration", "P13.2 CRM core migration proves clean install, exact upgrade, fail-closed preflight, and maintenance rollback"),
    evidence("upgrade-restore", "P13.9 upgrades the exact Phase-12 Sales predecessor and restores its current-v1 truth into a clean PostgreSQL database"),
    evidence("upgrade-restore", "P13.9 generated Chromium proves physical Postgres restore preserves current CRM product")
  ]
};

assert.deepEqual(
  Object.keys(attackProofs),
  contract.attacks.map(({ id }) => id),
  "Phase 13 attack proof IDs must match the frozen contract exactly."
);
for (const attack of contract.attacks) {
  assert.ok(attack.expectedDenial?.length || attack.denial?.length, `${attack.id} has no expected denial.`);
  assert.ok(attackProofs[attack.id].length > 0, `${attack.id} has no executable proof mapping.`);
  for (const proof of attackProofs[attack.id]) assert.ok(passedProofs.has(proof), `${attack.id} references unexecuted proof ${proof}.`);
}

const requiredAttackClasses = [
  ["cross-application account/contact/lead/opportunity access", "P13-ATK-01"],
  ["field/record permission bypass through list, detail, report, export, or dashboard", "P13-ATK-01"],
  ["forged owner/team/pipeline/stage/revision", "P13-ATK-02"],
  ["stale Kanban transition", "P13-ATK-03"],
  ["lead conversion replay or duplicate account/contact creation", "P13-ATK-04"],
  ["import formula, oversized file, malformed encoding, protected-field injection", "P13-ATK-05"],
  ["import crash/retry duplication", "P13-ATK-06"],
  ["unauthorized export or report recipient", "P13-ATK-07"],
  ["dedupe hidden-field leakage", "P13-ATK-08"],
  ["merge winner/loser substitution and stale revision", "P13-ATK-08"],
  ["email/calendar token or webhook-secret exfiltration", "P13-ATK-09"],
  ["forged/replayed inbound webhook", "P13-ATK-10"],
  ["unrestricted provider URL/network", "P13-ATK-09"],
  ["workflow arbitrary code/expression, loop, fan-out, or privilege escalation", "P13-ATK-11"],
  ["notification/reminder cross-user delivery", "P13-ATK-12"],
  ["money rounding/currency/timezone ambiguity", "P13-ATK-13"],
  ["lost outbox/realtime invalidation preserving stale authority", "P13-ATK-14"],
  ["prior-release migration or restore mismatch", "P13-ATK-15"],
  ["custom dashboard used to expand CRM data authority", "P13-ATK-07"]
].map(([scenario, contractAttack]) => ({ scenario, contractAttack, outcome: "observed", evidence: attackProofs[contractAttack] }));
assert.equal(requiredAttackClasses.length, 19, "Phase 13 plan attack corpus must cover all 19 required attack classes.");
for (const scenario of requiredAttackClasses) {
  assert.ok(attackProofs[scenario.contractAttack].every((proof) => passedProofs.has(proof)), `${scenario.scenario} has unexecuted evidence.`);
}

const journeys = [
  ["sales.journey.follow-up", [
    evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys"),
    evidence("communications", "P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys"),
    evidence("workflows", "P13.7 generated HTTP action and restarted worker preserve one durable workflow effect")
  ]],
  ["sales.journey.lead", [evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys")]],
  ["sales.journey.customer-context", [evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys")]],
  ["sales.journey.opportunity", [
    evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys"),
    evidence("pipeline", "P13.4 generated Chromium renders the native sales configuration surfaces with accessible controls")
  ]],
  ["sales.journey.activity", [
    evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys"),
    evidence("crm-recovery", "P13.3 generated browser receives opaque Socket.IO invalidations, resyncs after a host loss, and drops revoked current authority")
  ]],
  ["sales.journey.pipeline-config", [
    evidence("pipeline", "P13.4 migrates opaque stage identities atomically, persists evidence, and replays safely"),
    evidence("pipeline", "P13.4 generated Chromium renders the native sales configuration surfaces with accessible controls")
  ]],
  ["sales.journey.data-movement", [evidence("data-movement", "P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys")]],
  ["sales.journey.communication", [evidence("communications", "P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys")]],
  ["sales.journey.review", [
    evidence("reports", "P13.8 generated HTTP/Chromium reports route queues one artifact and keeps unrelated CRM healthy"),
    evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys"),
    evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")
  ]]
].map(([id, proofNames]) => {
  for (const proof of proofNames) assert.ok(passedProofs.has(proof), `${id} references unexecuted journey evidence.`);
  return { id, outcome: "observed", evidence: proofNames };
});
assert.deepEqual(journeys.map(({ id }) => id), contract.journeys.map(({ id }) => id), "Phase 13 journey evidence must match the frozen journey inventory.");

const evidenceClasses = [
  { id: "generated-application", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")] },
  { id: "real-postgresql", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")] },
  { id: "real-next-payload-http", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")] },
  { id: "real-chromium", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")] },
  { id: "at-least-two-roles", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")] },
  { id: "account-contact-lead-opportunity", outcome: "observed", evidence: [evidence("crm-browser", "P13.3 generated Payload and Next CRM routes pass real persona, keyboard, hidden-data, and accessibility journeys")] },
  { id: "configured-pipeline-kanban", outcome: "observed", evidence: [evidence("pipeline", "P13.4 generated Chromium renders the native sales configuration surfaces with accessible controls")] },
  { id: "activity-task-reminder", outcome: "observed", evidence: [evidence("communications", "P13.6 reminder delivery stays atomic and generation-fenced"), evidence("workflows", "P13.7 exact rules produce one task, fixed notice, and clamped reminder")] },
  { id: "custom-dashboard", outcome: "observed", evidence: [evidence("reports", "P13.8 generated HTTP/Chromium reports route queues one artifact and keeps unrelated CRM healthy")] },
  { id: "import-export", outcome: "observed", evidence: [evidence("data-movement", "P13.5 generated Chromium completes accessible imports, request-local merge, and export download journeys")] },
  { id: "communication-adapter", outcome: "observed", evidence: [evidence("communications", "P13.6 generated HTTP and Chromium prove webhook bounds and recipient-only notification journeys")] },
  { id: "reports", outcome: "observed", evidence: [evidence("reports", "P13.8 real PG processes exact closed seven-report catalog with one fenced artifact/audit/outbox chain")] },
  { id: "backup-restore-upgrade", outcome: "observed", evidence: [evidence("upgrade-restore", "P13.9 upgrades the exact Phase-12 Sales predecessor and restores its current-v1 truth into a clean PostgreSQL database"), evidence("upgrade-restore", "P13.9 generated Chromium proves physical Postgres restore preserves current CRM product")] },
  { id: "worker-realtime-recovery", outcome: "observed", evidence: [evidence("crm-recovery", "P13.3 generated browser receives opaque Socket.IO invalidations, resyncs after a host loss, and drops revoked current authority"), evidence("workflows", "P13.7 generated HTTP action and restarted worker preserve one durable workflow effect"), evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")] },
  { id: "representative-six-stage-dataset", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")] },
  { id: "ten-thousand-row-import-replay", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")] },
  { id: "independent-seven-metric-ledger", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")] },
  { id: "controlled-http-browser-performance", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")] },
  { id: "representative-role-accessibility", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 generated fixture proves controlled browser readiness before and after restore")] },
  { id: "reminder-delivery-recovery", outcome: "observed", evidence: [evidence("fixture-readiness", "P13.10 fixture-only real PostgreSQL evidence proves representative data, bounded import/report replay, independent metrics, reminders, and controlled DB timings")] }
];
for (const item of evidenceClasses) {
  assert.ok(item.evidence.length > 0, `${item.id} has no evidence.`);
  for (const proof of item.evidence) assert.ok(passedProofs.has(proof), `${item.id} references unexecuted proof ${proof}.`);
}

const unmetLimitedBetaCriteria = Object.freeze([
  "five-consecutive-business-days",
  "two-active-human-users",
  "all-sev1-sev2-incidents-closed",
  "observed-rto-four-hours",
  "observed-rpo-fifteen-minutes",
  "product-sales-security-operations-signoffs"
]);

const finalHead = run("exact head after corpus", "git", ["rev-parse", "HEAD"]).trim();
assert.equal(finalHead, exactHead, "Phase 13 corpus changed the reviewed Git head during execution.");
const finalWorktree = run("clean worktree after corpus", "git", ["status", "--porcelain=v1", "--untracked-files=all"]).trim();
assert.equal(finalWorktree, "", `Phase 13 corpus changed the reviewed worktree:\n${finalWorktree}`);

console.log(JSON.stringify({
  phase: 13,
  status: "FIXTURE_READY",
  exactHead,
  proofCount: proofs.length,
  proofs,
  attacks: contract.attacks.map(({ id, scenario, denial, deliveryTasks }) => ({
    id, scenario, denial, deliveryTasks, outcome: "observed", evidence: attackProofs[id]
  })),
  requiredAttackClasses,
  journeys,
  evidenceClasses,
  evidenceClass: {
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
  },
  limitedBetaDecision: {
    verdict: "REWORK CRM DAILY WORKFLOW, DATA MODEL, OR PILOT OPERATIONS",
    unmetCriteria: unmetLimitedBetaCriteria
  }
}, null, 2));
console.log("P13_FIXTURE_READINESS_PASS");
