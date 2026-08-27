import assert from "node:assert/strict";
import test from "node:test";

import { requiredPluginEvidence, validateConformancePlan } from "./plugin-conformance.mjs";

function plan() {
  return {
    schemaVersion: 2,
    pluginId: "module.sales",
    pluginPackage: "@k-nex/module-sales",
    proofs: requiredPluginEvidence.map((evidence) => evidence === "package-export-boundaries" || evidence === "packed-reproducibility"
      ? { id: evidence, kind: "pnpm-script", covers: [evidence], script: evidence === "package-export-boundaries" ? "check:boundaries" : "check:pack" }
      : { id: evidence, kind: "node-test", covers: [evidence], file: "tests/conformance.test.mjs", testName: evidence })
  };
}

test("plugin conformance plans require exact unique evidence and target identity", () => {
  assert.equal(validateConformancePlan(plan()).pluginId, "module.sales");
  const missing = plan();
  missing.proofs.pop();
  assert.throws(() => validateConformancePlan(missing), /exact, unique, and complete/);
  const duplicateCoverage = plan();
  duplicateCoverage.proofs[0].covers.push(duplicateCoverage.proofs[1].covers[0]);
  assert.throws(() => validateConformancePlan(duplicateCoverage), /exact, unique, and complete/);
});

test("plugin conformance plans reject external runners, fabricated scripts, and arbitrary shapes", () => {
  const external = plan();
  external.proofs[0].file = "../packages/runtime/tests/plugin-settings.test.ts";
  assert.throws(() => validateConformancePlan(external), /inside the target plugin/);
  const script = plan();
  script.proofs.find(({ id }) => id === "packed-reproducibility").script = "test";
  assert.throws(() => validateConformancePlan(script), /runner-owned target-plugin script/);
  assert.throws(() => validateConformancePlan({ ...plan(), command: "true" }), /keys are invalid/);
});
