import assert from "node:assert/strict";
import test from "node:test";

import { requiredPluginEvidence, validateConformancePlan } from "./plugin-conformance.mjs";

function plan(covers = requiredPluginEvidence) {
  return {
    schemaVersion: 1,
    pluginId: "module.sales",
    proofs: [{ id: "all", kind: "pnpm-script", covers, script: "test", markers: ["PASS"] }]
  };
}

test("plugin conformance plans require every named evidence class", () => {
  assert.equal(validateConformancePlan(plan()).pluginId, "module.sales");
  assert.throws(() => validateConformancePlan(plan(requiredPluginEvidence.slice(1))), /evidence is incomplete/);
  assert.throws(() => validateConformancePlan(plan([...requiredPluginEvidence, "unknown-proof"])), /evidence is incomplete/);
});

test("plugin conformance plans reject duplicate proofs and arbitrary runner shapes", () => {
  const duplicate = plan();
  duplicate.proofs.push({ ...duplicate.proofs[0] });
  assert.throws(() => validateConformancePlan(duplicate), /Duplicate conformance proof id/);
  assert.throws(() => validateConformancePlan({ ...plan(), proofs: [{ ...plan().proofs[0], command: "true" }] }), /keys are invalid/);
});
