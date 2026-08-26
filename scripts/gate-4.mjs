import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.versions.node !== "24.19.0") {
  throw new Error(`Gate 4 requires Node 24.19.0; found ${process.versions.node}.`);
}

const proofs = [
  ["canonical-round-trip", "@k-nex/builder-puck", "tests/adapter.test.ts", "round-trips canonical documents without semantic loss"],
  ["shared-renderer", "@k-nex/builder-puck", "tests/adapter.test.ts", "uses the full runtime policy and shared browser presenter inside and outside Puck"],
  ["fixed-shell", "@k-nex/builder-puck", "tests/fixed-shell-host.test.ts", "keeps security and platform regions outside the editor canvas"],
  ["profile-authority", "@k-nex/builder-puck", "tests/profile.test.ts", "uses one engine with distinct palettes and authority allowlists"],
  ["profile-publication-readiness", "@k-nex/builder-puck", "tests/profile.test.ts", "threads preview authority through the resolved profile and rejects publication-incompatible bindings"],
  ["phase-2-selection-parity", "@k-nex/builder-puck", "tests/profile.test.ts", "matches the real Phase 2 required-field selection rules before publication"],
  ["trusted-edit-constraints", "@k-nex/builder-puck", "tests/profile.test.ts", "enforces trusted field and movement constraints on edits"],
  ["static-public-block", "@k-nex/ui-runtime", "tests/spike-blocks.test.ts", "renders one shared static block on the public CMS surface"],
  ["authenticated-block", "@k-nex/ui-runtime", "tests/spike-blocks.test.ts", "renders the authenticated workspace table from the Phase 2 sales.tasks projection"],
  ["source-result-authority", "@k-nex/ui-runtime", "tests/spike-blocks.test.ts", "rejects undeclared or unauthorized fields reintroduced by a source result"],
  ["optional-source-omission", "@k-nex/ui-runtime", "tests/spike-blocks.test.ts", "accepts omitted nullable cells and drops a denied optional selection exactly like the Phase 2 gateway"],
  ["public-internal-separation", "@k-nex/ui-runtime", "tests/spike-blocks.test.ts", "does not turn the workspace source into publishable authority during authenticated CMS preview"],
  ["safe-fallback", "@k-nex/ui-runtime", "tests/fallback-readiness.test.ts", "identifies a missing plugin while preserving its node and rendered children"],
  ["editor-independent-runtime", "@k-nex/ui-runtime", "tests/document-runtime.test.ts", "renders validated props outside an editor and preserves node order"],
  ["keyboard-selection", "@k-nex/builder-puck", "tests/accessibility.test.ts", "selects a block through a labelled native control so its fields can be edited by keyboard"],
  ["non-drag-reorder", "@k-nex/builder-puck", "tests/accessibility.test.ts", "provides named native buttons as a non-drag reorder alternative"],
  ["nested-keyboard-reorder", "@k-nex/builder-puck", "tests/accessibility.test.ts", "enumerates and moves blocks inside canonical child slots"],
  ["cross-container-keyboard-move", "@k-nex/builder-puck", "tests/accessibility.test.ts", "moves an unlocked child between sibling containers without drag"],
  ["screen-reader-status", "@k-nex/builder-puck", "tests/accessibility.test.ts", "exposes selected position through a polite status and bounds reorder actions"]
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runProof([id, packageName, file, testName]) {
  let output;
  try {
    output = execFileSync("pnpm", [
      "--filter", packageName, "exec", "vitest", "run", file,
      "--testNamePattern", escapeRegExp(testName), "--reporter=json"
    ], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    const stderr = error?.stderr?.toString?.() ?? "";
    throw new Error(`Gate 4 proof failed: ${id}\n${stdout}${stderr}`, { cause: error });
  }
  const report = JSON.parse(output);
  const assertions = report.testResults?.flatMap(({ assertionResults = [] }) => assertionResults) ?? [];
  assert.deepEqual(
    assertions.filter(({ status }) => status === "passed").map(({ title }) => title),
    [testName],
    `Gate 4 proof did not execute exactly one test: ${id}.`
  );
  return { id, status: "pass", target: `${file} :: ${testName}` };
}

console.log(JSON.stringify({
  gate: "Gate 4",
  boundaryProof: "@k-nex/builder-puck scripts/check-boundaries.mjs",
  browserProof: "@k-nex/builder-puck scripts/browser-accessibility.mjs",
  focusedProofs: proofs.map(runProof)
}, null, 2));
console.log("GATE_4_PASS");
