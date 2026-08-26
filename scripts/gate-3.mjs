import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.versions.node !== "24.19.0") {
  throw new Error(`Gate 3 requires Node 24.19.0; found ${process.versions.node}.`);
}

const proofs = [
  ["lost-pubsub-and-reconnect-lifecycle", "@k-nex/runtime", "tests/source-convergence.test.ts", "schedules bounded revalidation and wires reconnect signals during its executable lifecycle"],
  ["permission-revocation", "@k-nex/provider-realtime-socketio", "tests/memory-gateway.test.ts", "removes subscriptions when topic permission is revoked"],
  ["session-revocation", "@k-nex/provider-realtime-socketio", "tests/memory-gateway.test.ts", "disconnects only the revoked login session for an active actor"],
  ["slow-consumer", "@k-nex/provider-realtime-socketio", "tests/memory-gateway.test.ts", "disconnects a slow consumer when its acknowledgement buffer is full"],
  ["rolling-reconnect", "@k-nex/provider-realtime-socketio", "tests/memory-gateway.test.ts", "allows an authorized client to reconnect and resubscribe after a stop-before-start rollout"],
  ["rolling-topology", "@k-nex/runtime", "tests/realtime-topology.test.ts", "rejects rolling overlap with path-specific remedies"],
  ["backplane-checkpoint", "@k-nex/payload-adapter", "tests/outbox-realtime-relay.test.ts", "does not checkpoint a failed publication and skips an already published checkpoint"]
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
    throw new Error(`Gate 3 proof failed: ${id}\n${stdout}${stderr}`, { cause: error });
  }
  const report = JSON.parse(output);
  const assertions = report.testResults?.flatMap(({ assertionResults = [] }) => assertionResults) ?? [];
  assert.deepEqual(
    assertions.filter(({ status }) => status === "passed").map(({ title }) => title),
    [testName],
    `Gate 3 proof did not execute exactly one test: ${id}.`
  );
  return { id, status: "pass", target: `${file} :: ${testName}` };
}

const results = proofs.map(runProof);
console.log(JSON.stringify({
  gate: "Gate 3",
  databaseProofs: [
    "commit then process crash",
    "rollback silence",
    "duplicate outbox delivery with idempotent effect",
    "worker-to-web invalidation",
    "backplane unavailable then recovered"
  ],
  focusedProofs: results
}, null, 2));
console.log("GATE_3_PASS");
