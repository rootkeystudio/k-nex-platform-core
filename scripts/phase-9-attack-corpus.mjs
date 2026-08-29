import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const customerFixture = new URL("../fixtures/customer-gate-1/", import.meta.url);

const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
const exactPattern = (names) => `^(?:${names.map(escapeRegex).join("|")})$`;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  assert.equal(result.error, undefined, `${options.id}: could not start ${command}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${options.id}: ${command} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
};

const vitestProof = (id, filter, file, names) => ({ id, runner: "vitest", filter, file, names });
const nodeProof = (id, file, names) => ({ id, runner: "node:test", file, names });
const browserProof = (id, script, marker) => ({ id, runner: "chromium", script, marker });

const proofs = [
  vitestProof("bundler-rejections", "@k-nex/extension-bundler", "tests/extension-bundler.test.ts", [
    "extension bundler builds byte-identical self-contained payloads with closed inventory, SBOM, and provenance",
    "extension bundler rejects module access and package lifecycle representation without false comment matches",
    "extension bundler enforces declared entrypoint, asset, skin CSS, and no-executable-skin inventories",
    "extension bundler verifies the signed catalog and every provenance/release binding before stage",
    "extension bundler rejects expired, replayed, revoked, and downgraded signed catalog indexes",
    "extension bundler binds runner code to the verified owner, generation, artifact, and declared entrypoint",
    "extension bundler rejects traversal, links, colliding paths, bombs, and every configured extraction bound"
  ]),
  vitestProof("remote-ui-assets", "@k-nex/extension-bundler", "tests/remote-ui-assets.test.ts", [
    "verified Remote UI assets rejects staged, mixed-generation, digest, traversal, and unverified assets"
  ]),
  vitestProof("runner-isolation", "@k-nex/extension-runner", "tests/docker-sandbox.test.ts", [
    "production extension runner refuses to send source when Docker inspection omits any required effective control",
    "production extension runner runs app generations with container authority and only declared host capabilities",
    "production extension runner rejects mixed token identity before starting a container and keeps app/generation responses isolated",
    "production extension runner quarantines only a timed-out generation and drains old work without affecting a sibling generation",
    "production extension runner contains an out-of-memory generation failure"
  ]),
  vitestProof("remote-ui-host", "@k-nex/ui-runtime", "tests/remote-ui-host.test.ts", [
    "remote UI host session removes the owned realm after a malformed frame",
    "remote UI host session validates identity, sequence, registry, events, and declared source transport",
    "remote UI host session admits only the active generation and drains old sessions after promotion"
  ]),
  vitestProof("static-composition-authority", "@k-nex/runtime", "tests/static-composition-authority.test.ts", [
    "static source and trusted build authority commits only an exact-base deterministic customer source change",
    "static source and trusted build authority rejects arbitrary repository and branch controls in a static source change",
    "static source and trusted build authority accepts only signed build evidence bound to the exact source, graph, application, and image",
    "static source and trusted build authority rejects a valid signature whose trusted key is not authorized for the claimed builder identity"
  ]),
  vitestProof("plugin-manager", "@k-nex/runtime", "tests/plugin-manager.test.ts", [
    "PluginManager delegates module and executable theme Platform Plugins to source and trusted-build authorities",
    "PluginManager rejects planner mismatches and unverified inventory authority",
    "PluginManager stops before planning or persistence when operation authorization rejects"
  ]),
  nodeProof("app-storage", "tests/app-storage-postgres.test.mjs", [
    "proves revisioned, quota-limited, schema-validated, backed-up, cross-app isolated storage"
  ]),
  nodeProof("runtime-extension-state", "tests/runtime-extension-state-postgres.test.mjs", [
    "rejects SCN-12 activation races and SCN-13 stale operation replays in PostgreSQL",
    "proves PostgreSQL-backed Hot Application install, update, restore, rollback, and execution through the durable runtime"
  ]),
  nodeProof("static-deployment", "tests/static-deployment-postgres.test.mjs", [
    "proves distinct customer binaries and deployment processes recover from PostgreSQL authority",
    "returns maintenance-required without building or starting a target generation"
  ]),
  nodeProof("theme-skin-profile", "tests/theme-skin-profile-postgres.test.mjs", [
    "publishes and rolls back Theme Profiles atomically against exact active skin generations"
  ]),
  browserProof("remote-ui-browser", "packages/ui-testing/scripts/remote-ui-browser.mjs", "P9_REMOTE_UI_BROWSER_PASS"),
  browserProof("theme-skin-browser", "packages/ui-testing/scripts/theme-skin-browser.mjs", "P9_THEME_SKIN_BROWSER_PASS")
];

const crashMatrix = [
  { state: "source-attested", process: "builder", expected: "a restarted builder re-attests the immutable source/image pair" },
  { state: "deployment-authorized", process: "deployer", expected: "a restarted deployer reads the single PostgreSQL authority row" },
  { state: "warming", process: "web-green", expected: "the new binary remains unavailable until expanded-schema readiness succeeds" },
  { state: "promoted", process: "supervisor", expected: "a restarted supervisor observes the committed generation and fence" },
  { state: "promoted", process: "worker-green", expected: "a restarted green worker activates only under the committed fence" },
  { state: "promoted", process: "realtime-client", expected: "a restarted client reconnects through the fixed gateway and resyncs the revision" },
  { state: "rollback-open", process: "web-blue", expected: "the retained old binary can restart against the expanded schema" },
  { state: "rolled-back", process: "worker-blue", expected: "a restarted blue worker activates only after PostgreSQL transfers the fence" },
  { state: "post-transition", process: "gateway", expected: "a restarted gateway routes from PostgreSQL active-generation authority" }
];

const exactEvidence = (proof, name, marker) => ({ proof, name, ...(marker ? { marker } : {}) });
const staticProofName = "proves distinct customer binaries and deployment processes recover from PostgreSQL authority";
const runtimeJourneyName = "proves PostgreSQL-backed Hot Application install, update, restore, rollback, and execution through the durable runtime";
const runtimeCoordinationName = "rejects SCN-12 activation races and SCN-13 stale operation replays in PostgreSQL";

const assertRuntimeJourneyEvidence = (marker) => {
  const docker = marker.productionDockerExecution;
  const drain = marker.oldGenerationDrain;
  assert.equal(docker?.runner, "DockerHotApplicationSandboxSupervisor", "P9 runtime journey did not prove Docker runner execution.");
  assert.equal(docker?.image, "node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43", "P9 runtime journey used an unapproved production runner image.");
  assert.equal(typeof drain?.generationId, "string", "P9 runtime journey did not identify the drained old generation.");
  assert.equal(drain.leaseObserved, true, "P9 runtime journey did not observe the old-generation lease.");
  assert.equal(drain.completed, true, "P9 runtime journey did not prove old-generation drain completion.");
  assert.equal(docker.startedGenerationIds?.includes(drain.generationId), true, "P9 runtime journey did not start the drained generation in Docker.");
  assert.equal(docker.stoppedGenerationIds?.includes(drain.generationId), true, "P9 runtime journey did not stop the drained generation in Docker.");
};

const scenarios = [
  { id: "SCN-01", attack: "arbitrary repository/branch URL", expected: "reject unpinned source", evidence: [exactEvidence("static-composition-authority", "static source and trusted build authority rejects arbitrary repository and branch controls in a static source change")] },
  { id: "SCN-02", attack: "unsigned/tampered/downgraded/revoked bundle", expected: "reject verification failure", evidence: [exactEvidence("bundler-rejections", "extension bundler verifies the signed catalog and every provenance/release binding before stage"), exactEvidence("bundler-rejections", "extension bundler rejects expired, replayed, revoked, and downgraded signed catalog indexes")] },
  { id: "SCN-03", attack: "archive traversal/symlink/hardlink/collision/bomb", expected: "reject unsafe extraction", evidence: [exactEvidence("bundler-rejections", "extension bundler rejects traversal, links, colliding paths, bombs, and every configured extraction bound")] },
  { id: "SCN-04", attack: "install script or runtime package-manager invocation", expected: "reject lifecycle/package-manager surface", evidence: [exactEvidence("bundler-rejections", "extension bundler rejects module access and package lifecycle representation without false comment matches")] },
  { id: "SCN-05", attack: "host dynamic import of downloaded code", expected: "reject host execution", evidence: [exactEvidence("bundler-rejections", "extension bundler binds runner code to the verified owner, generation, artifact, and declared entrypoint"), exactEvidence("runner-isolation", "production extension runner runs app generations with container authority and only declared host capabilities")] },
  { id: "SCN-06", attack: "same-origin credentialed remote UI fetch/storage/network", expected: "deny browser authority", evidence: [exactEvidence("remote-ui-browser", "P9_REMOTE_UI_BROWSER_PASS")] },
  { id: "SCN-07", attack: "forbidden builtin/import/capability", expected: "reject undeclared capability", evidence: [exactEvidence("bundler-rejections", "extension bundler rejects module access and package lifecycle representation without false comment matches"), exactEvidence("runner-isolation", "production extension runner runs app generations with container authority and only declared host capabilities")] },
  { id: "SCN-08", attack: "host/cross-app DB/Docker/secret/network/filesystem escape", expected: "contain the application generation", evidence: [exactEvidence("runner-isolation", "production extension runner refuses to send source when Docker inspection omits any required effective control"), exactEvidence("runner-isolation", "production extension runner runs app generations with container authority and only declared host capabilities")] },
  { id: "SCN-09", attack: "cross-app storage/token/revision reuse", expected: "isolate app identity", evidence: [exactEvidence("app-storage", "proves revisioned, quota-limited, schema-validated, backed-up, cross-app isolated storage"), exactEvidence("runner-isolation", "production extension runner rejects mixed token identity before starting a container and keeps app/generation responses isolated")] },
  { id: "SCN-10", attack: "staged artifact served before verification", expected: "deny unverified asset", evidence: [exactEvidence("remote-ui-assets", "verified Remote UI assets rejects staged, mixed-generation, digest, traversal, and unverified assets")] },
  { id: "SCN-11", attack: "mixed UI/server/storage generation", expected: "reject mixed generation", evidence: [exactEvidence("remote-ui-host", "remote UI host session admits only the active generation and drains old sessions after promotion"), exactEvidence("runtime-extension-state", runtimeJourneyName, "P9_RUNTIME_JOURNEY_EVIDENCE")] },
  { id: "SCN-12", attack: "activation pointer race", expected: "serialize the revision transition", evidence: [exactEvidence("runtime-extension-state", runtimeCoordinationName, "P9_RUNTIME_COORDINATION_EVIDENCE")] },
  { id: "SCN-13", attack: "stale operation replay", expected: "reject replay", evidence: [exactEvidence("runtime-extension-state", runtimeCoordinationName, "P9_RUNTIME_COORDINATION_EVIDENCE")] },
  { id: "SCN-14", attack: "runtime DB-authored static graph", expected: "require source authority", evidence: [exactEvidence("plugin-manager", "PluginManager delegates module and executable theme Platform Plugins to source and trusted-build authorities"), exactEvidence("plugin-manager", "PluginManager rejects planner mismatches and unverified inventory authority")] },
  { id: "SCN-15", attack: "arbitrary image/tag or unsigned/self-asserted build", expected: "require immutable signed build", evidence: [exactEvidence("static-composition-authority", "static source and trusted build authority accepts only signed build evidence bound to the exact source, graph, application, and image"), exactEvidence("static-composition-authority", "static source and trusted build authority rejects a valid signature whose trusted key is not authorized for the claimed builder identity")] },
  { id: "SCN-16", attack: "rollback across irreversible migration", expected: "reject incompatible rollback", evidence: [exactEvidence("runtime-extension-state", runtimeJourneyName, "P9_RUNTIME_JOURNEY_EVIDENCE")] },
  { id: "SCN-17", attack: "contract cleanup while rollback open", expected: "block destructive cleanup", evidence: [exactEvidence("static-deployment", staticProofName, "P9_STATIC_SCENARIO_EVIDENCE")] },
  { id: "SCN-18", attack: "blue/green worker duplicate claim/completion", expected: "permit one leased effect", evidence: [exactEvidence("static-deployment", staticProofName, "P9_STATIC_SCENARIO_EVIDENCE")] },
  { id: "SCN-19", attack: "process crash at required lifecycle boundaries", expected: "recover each matrix entry from PostgreSQL authority", evidence: [exactEvidence("static-deployment", staticProofName, "P9_STATIC_SCENARIO_EVIDENCE")], matrix: crashMatrix },
  { id: "SCN-20", attack: "false zero-downtime claim", expected: "prove concurrent old/new binary overlap during expand/backfill", evidence: [exactEvidence("static-deployment", staticProofName, "P9_STATIC_SCENARIO_EVIDENCE")] },
  { id: "SCN-21", attack: "web process source/build/Docker authority", expected: "keep source/build/Docker authority out of web binaries", evidence: [exactEvidence("static-deployment", staticProofName, "P9_STATIC_SCENARIO_EVIDENCE")] },
  { id: "SCN-22", attack: "operator authorization bypass", expected: "reject unauthorized operation", evidence: [exactEvidence("plugin-manager", "PluginManager stops before planning or persistence when operation authorization rejects")] }
];

const parseVitest = (proof, output) => {
  let report;
  try {
    report = JSON.parse(output.trim());
  } catch (error) {
    assert.fail(`${proof.id}: Vitest did not emit one machine-readable JSON report: ${error.message}`);
  }
  assert.equal(report.success, true, `${proof.id}: Vitest reported failure.`);
  assert.equal(report.numFailedTests, 0, `${proof.id}: Vitest reported failed tests.`);
  assert.equal(report.numPassedTests, proof.names.length, `${proof.id}: expected exactly ${proof.names.length} passing named tests; found ${report.numPassedTests}.`);
  const passed = report.testResults.flatMap((result) => result.assertionResults)
    .filter((test) => test.status === "passed")
    .map((test) => test.fullName);
  for (const name of proof.names) assert.equal(passed.filter((actual) => actual === name).length, 1, `${proof.id}: expected named test did not pass exactly once: ${name}`);
  return { id: proof.id, runner: proof.runner, passed: report.numPassedTests, names: proof.names };
};

const parseTap = (proof, output) => {
  const passed = [...output.matchAll(/^ok \d+ - (.+)$/gm)].map(([, name]) => name);
  const pass = Number(/^# pass (\d+)$/m.exec(output)?.[1]);
  assert.ok(Number.isInteger(pass), `${proof.id}: node:test did not emit a TAP pass count.`);
  assert.equal(pass, proof.names.length, `${proof.id}: expected exactly ${proof.names.length} passing named tests; found ${pass}.`);
  for (const name of proof.names) assert.equal(passed.filter((actual) => actual === name).length, 1, `${proof.id}: expected named test did not pass exactly once: ${name}`);
  const markers = {};
  for (const [, marker, serialized] of output.matchAll(/^# (P9_[A-Z0-9_]+)=(\{.*\})$/gm)) {
    assert.equal(markers[marker], undefined, `${proof.id}: duplicate evidence marker ${marker}.`);
    try {
      markers[marker] = JSON.parse(serialized);
    } catch (error) {
      assert.fail(`${proof.id}: invalid ${marker} JSON evidence: ${error.message}`);
    }
  }
  return { id: proof.id, runner: proof.runner, passed: pass, names: proof.names, markers };
};

const executeProof = (proof) => {
  if (proof.runner === "vitest") {
    const output = run("pnpm", ["--filter", proof.filter, "exec", "vitest", "run", proof.file, "--reporter=json", `--testNamePattern=${exactPattern(proof.names)}`], proof);
    return parseVitest(proof, output);
  }
  if (proof.runner === "node:test") {
    const output = run(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", `--test-name-pattern=${exactPattern(proof.names)}`, proof.file], { ...proof, cwd: customerFixture });
    return parseTap(proof, output);
  }
  const output = run(process.execPath, [proof.script], proof);
  assert.ok(output.includes(`${proof.marker}\n`), `${proof.id}: Chromium proof did not report ${proof.marker}.`);
  return { id: proof.id, runner: proof.runner, passed: 1, names: [proof.marker] };
};

export const runAttackCorpus = () => {
  assert.equal(process.versions.node, "24.19.0", `Phase 9 attack corpus requires Node 24.19.0; found ${process.versions.node}.`);
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length, "Gate 9 scenario IDs must be unique.");
  assert.equal(new Set(scenarios.map(({ attack }) => attack)).size, scenarios.length, "Gate 9 scenario attacks must be unique.");
  assert.equal(new Set(crashMatrix.map(({ state, process }) => `${state}:${process}`)).size, crashMatrix.length, "Gate 9 crash matrix entries must be unique.");
  assert.equal(new Set(proofs.map(({ id }) => id)).size, proofs.length, "Phase 9 proof IDs must be unique.");
  run("pnpm", ["--filter", "@k-nex/customer-gate-1", "build"], { id: "customer-gate-1-build" });
  const results = new Map(proofs.map((proof) => [proof.id, executeProof(proof)]));
  const scenarioResults = scenarios.map((scenario) => {
    const observations = scenario.evidence.map((required) => {
      const result = results.get(required.proof);
      assert.ok(result, `${scenario.id}: required evidence ${required.proof} was not run.`);
      assert.equal(result.names.includes(required.name), true, `${scenario.id}: exact named proof did not pass: ${required.name}`);
      if (required.marker) {
        const marker = result.markers?.[required.marker];
        assert.ok(marker, `${scenario.id}: exact runtime marker ${required.marker} was not emitted.`);
        if (required.marker === "P9_RUNTIME_JOURNEY_EVIDENCE") assertRuntimeJourneyEvidence(marker);
        if (scenario.id !== "SCN-19") assert.equal(marker.scenarios?.includes(scenario.id), true, `${scenario.id}: ${required.marker} did not record the scenario outcome.`);
      }
      return { proof: required.proof, name: required.name, ...(required.marker ? { marker: required.marker } : {}) };
    });
    const matrixEvidence = scenario.id === "SCN-19" ? results.get("static-deployment")?.markers?.P9_STATIC_SCENARIO_EVIDENCE?.crashMatrix : undefined;
    const matrix = scenario.matrix?.map((entry) => {
      const key = `${entry.state}:${entry.process}`;
      assert.equal(matrixEvidence?.includes(key), true, `${scenario.id}: crash recovery evidence was not emitted for ${key}.`);
      return { ...entry, evidence: key, outcome: "recovered" };
    });
    return { id: scenario.id, attack: scenario.attack, expected: scenario.expected, evidence: observations, ...(matrix ? { matrix } : {}), outcome: "observed" };
  });
  return { phase: 9, scenarios: scenarioResults, proofs: [...results.values()], status: "PASS" };
};

if (process.argv[1]?.endsWith("scripts/phase-9-attack-corpus.mjs")) process.stdout.write(`${JSON.stringify(runAttackCorpus())}\n`);
