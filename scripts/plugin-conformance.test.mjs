import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertByteReproducible, assertNoShellWrapper, assertVitestExactTestProof, requiredPluginEvidence, runBoundaryProof, validateConformancePlan } from "./plugin-conformance.mjs";

function plan() {
  return {
    schemaVersion: 3,
    pluginId: "module.sales",
    pluginPackage: "@k-nex/module-sales",
    proofs: [
      { id: "package-export-boundaries", kind: "runner-proof", covers: ["package-export-boundaries"] },
      { id: "packed-reproducibility", kind: "runner-proof", covers: ["packed-reproducibility"] },
      { id: "customer-postgres-lifecycle", kind: "runner-proof", covers: ["deterministic-inventory", "fresh-migration-boot", "install-disable-reenable"] },
      { id: "sales-platform-boundaries", kind: "runner-proof", covers: ["source-action-tool-event-realtime"] },
      { id: "reference-documentation-generation", kind: "runner-proof", covers: ["reference-documentation-generation"] },
      ...requiredPluginEvidence.filter((evidence) => !["package-export-boundaries", "packed-reproducibility", "deterministic-inventory", "fresh-migration-boot", "install-disable-reenable", "source-action-tool-event-realtime", "reference-documentation-generation"].includes(evidence))
        .map((evidence) => ({ id: evidence, kind: "node-test", covers: [evidence], file: "tests/conformance.test.mjs", testName: evidence }))
    ]
  };
}

test("plugin conformance plans require exact unique evidence and target identity", () => {
  assert.equal(validateConformancePlan(plan()).pluginId, "module.sales");
  const missing = plan();
  missing.proofs.pop();
  assert.throws(() => validateConformancePlan(missing), /exact, unique, and complete/);
  const duplicateCoverage = plan();
  duplicateCoverage.proofs[0].covers.push(duplicateCoverage.proofs[1].covers[0]);
  assert.throws(() => validateConformancePlan(duplicateCoverage), /runner evidence is invalid|exact, unique, and complete/);
});

test("plugin conformance plans reject external runners, fabricated scripts, and arbitrary shapes", () => {
  const external = plan();
  external.proofs.find(({ kind }) => kind === "node-test").file = "../packages/runtime/tests/plugin-settings.test.ts";
  assert.throws(() => validateConformancePlan(external), /inside the target plugin/);
  const script = plan();
  script.proofs.find(({ id }) => id === "packed-reproducibility").script = "test";
  assert.throws(() => validateConformancePlan(script), /keys are invalid/);
  assert.throws(() => validateConformancePlan({ ...plan(), command: "true" }), /keys are invalid/);
  const wrapper = plan();
  const protectedProof = wrapper.proofs.find(({ kind }) => kind === "node-test");
  protectedProof.covers = ["fresh-migration-boot"];
  assert.throws(() => validateConformancePlan(wrapper), /runner-owned evidence/);
});

test("plugin conformance rejects direct and transitive process wrappers", () => {
  const root = mkdtempSync(join(tmpdir(), "k-nex-conformance-negative-"));
  try {
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests", "direct.mjs"), 'import { execFileSync } from "node:child_process";\nexecFileSync("true");\n');
    writeFileSync(join(root, "tests", "indirect.mjs"), 'import "./wrapper.mjs";\n');
    writeFileSync(join(root, "tests", "wrapper.mjs"), 'import { spawn } from "node:child_process";\nexport { spawn };\n');
    assert.throws(() => assertNoShellWrapper(join(root, "tests", "direct.mjs"), root), /forbidden process runner/);
    assert.throws(() => assertNoShellWrapper(join(root, "tests", "indirect.mjs"), root), /forbidden process runner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin conformance rejects transitive forbidden entrypoint imports", () => {
  const root = mkdtempSync(join(tmpdir(), "k-nex-boundary-negative-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "src", "contracts.ts"), 'export * from "./hidden.js";\n');
    writeFileSync(join(root, "src", "hidden.ts"), 'import type { Payload } from "payload";\nexport type Hidden = Payload;\n');
    for (const entrypoint of ["browser", "ui"]) writeFileSync(join(root, "src", `${entrypoint}.ts`), "export {};\n");
    for (const entrypoint of ["contracts", "browser", "ui", "migrations", "testing"]) writeFileSync(join(root, "dist", `${entrypoint}.d.ts`), "export {};\n");
    assert.throws(() => runBoundaryProof(root), /forbidden dependency payload/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin conformance accepts only one exact passed Vitest file and test", () => {
  const report = {
    success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numFailedTestSuites: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{
      name: "/plugin/tests/mcp-sales-proof.test.ts", status: "passed",
      assertionResults: [{ fullName: "Sales proof runs the Sales proof", title: "runs the Sales proof", status: "passed", failureMessages: [] }]
    }]
  };
  const expected = { file: "/plugin/tests/mcp-sales-proof.test.ts", testName: "runs the Sales proof", fullName: "Sales proof runs the Sales proof" };
  assert.doesNotThrow(() => assertVitestExactTestProof(report, expected));
  assert.throws(() => assertVitestExactTestProof({ ...report, numPassedTests: 0, numPendingTests: 1 }, expected), /pass exactly one test/);
  assert.throws(() => assertVitestExactTestProof({ ...report, testResults: [{ ...report.testResults[0], name: "/other.test.ts" }] }, expected), /unexpected test file/);
  assert.throws(() => assertVitestExactTestProof({ ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ ...report.testResults[0].assertionResults[0], fullName: "other" }] }] }, expected), /intended test/);
});

test("plugin conformance requires repeated and committed archive bytes to match", () => {
  const linux = Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0x03, 1, 2, 3]);
  const committed = Buffer.from(linux);
  committed[9] = 0xff;
  assert.doesNotThrow(() => assertByteReproducible(linux, Buffer.from(linux), committed, "sales.tgz"));
  const changed = Buffer.from(linux);
  changed[12] = 4;
  assert.throws(() => assertByteReproducible(linux, changed, committed, "sales.tgz"), /repeated pack bytes are non-deterministic/);
  assert.throws(() => assertByteReproducible(changed, Buffer.from(changed), committed, "sales.tgz"), /committed bytes are stale/);
  assert.throws(() => assertByteReproducible(linux, Buffer.from(linux), linux, "sales.tgz"), /gzip OS marker is not cross-platform/);
});
