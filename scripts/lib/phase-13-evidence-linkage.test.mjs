import assert from "node:assert/strict";
import { test } from "node:test";

import { assertEvidenceLinkage } from "./phase-13-evidence-linkage.mjs";

const proofKey = (id, name) => `node:${id}:${name}`;

function evidenceReport(mutate = () => {}) {
  const proofs = [
    { id: "core-migration", files: ["tests/a.test.mjs"], names: ["proves the core migration"], markers: [] },
    { id: "upgrade-restore", files: ["tests/b.test.mjs"], names: ["proves the restore"], markers: [] }
  ];
  const core = proofKey("core-migration", "proves the core migration");
  const restore = proofKey("upgrade-restore", "proves the restore");
  const report = {
    proofs,
    executedProofs: [core, restore].sort(),
    attacks: [{ id: "P13-ATK-01", outcome: "observed", evidence: [core] }],
    requiredAttackClasses: [{ scenario: "cross-application access", outcome: "observed", evidence: [core] }],
    journeys: [{ id: "sales.journey.follow-up", outcome: "observed", evidence: [restore] }],
    evidenceClasses: [{ id: "backup-restore-upgrade", outcome: "observed", evidence: [core, restore] }]
  };
  mutate(report, { core, restore });
  return report;
}

test("accepts a report whose every claim cites a proof the run executed", () => {
  const executed = assertEvidenceLinkage(evidenceReport());
  assert.equal(executed.size, 2);
});

test("rejects an outcome asserted without an executed proof behind it", () => {
  assert.throws(() => assertEvidenceLinkage(evidenceReport((report) => {
    report.attacks[0].evidence = [proofKey("core-migration", "a proof nobody ran")];
  })), /cites a proof this run did not execute/u);
  assert.throws(() => assertEvidenceLinkage(evidenceReport((report) => {
    report.journeys[0].evidence = [];
  })), /has no executed proof/u);
  assert.throws(() => assertEvidenceLinkage(evidenceReport((report) => {
    report.evidenceClasses[0].outcome = "assumed";
  })), /was not observed/u);
});

test("rejects an executed set that does not match the declared proof groups", () => {
  assert.throws(() => assertEvidenceLinkage(evidenceReport((report, { core }) => {
    report.executedProofs = [core, proofKey("invented-group", "invented proof")].sort();
  })), /differ from the proof groups/u);
  assert.throws(() => assertEvidenceLinkage(evidenceReport((report, { core }) => {
    report.executedProofs = [core];
  })), /differ from the proof groups/u);
  assert.throws(() => assertEvidenceLinkage(evidenceReport((report, { core, restore }) => {
    report.executedProofs = [core, restore, core];
  })), /duplicate executed proofs/u);
});

test("rejects a report that declares no proofs at all", () => {
  for (const mutate of [
    (report) => { report.proofs = []; },
    (report) => { report.executedProofs = []; },
    (report) => { report.proofs[0].names = []; },
    (report) => { report.attacks = []; }
  ]) {
    assert.throws(() => assertEvidenceLinkage(evidenceReport(mutate)));
  }
});
