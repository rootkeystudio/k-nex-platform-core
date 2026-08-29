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
    "extension bundler verifies the signed catalog and every provenance/release binding before stage",
    "extension bundler rejects traversal, links, colliding paths, bombs, and every configured extraction bound"
  ]),
  vitestProof("remote-ui-assets", "@k-nex/extension-bundler", "tests/remote-ui-assets.test.ts", [
    "verified Remote UI assets rejects staged, mixed-generation, digest, traversal, and unverified assets"
  ]),
  vitestProof("runner-isolation", "@k-nex/extension-runner", "tests/docker-sandbox.test.ts", [
    "production extension runner runs app generations with container authority and only declared host capabilities",
    "production extension runner rejects mixed token identity before starting a container and keeps app/generation responses isolated",
    "production extension runner quarantines only a timed-out generation and drains old work without affecting a sibling generation",
    "production extension runner contains an out-of-memory generation failure"
  ]),
  vitestProof("remote-ui-host", "@k-nex/ui-runtime", "tests/remote-ui-host.test.ts", [
    "remote UI host session admits only the active generation and drains old sessions after promotion"
  ]),
  vitestProof("static-composition-authority", "@k-nex/runtime", "tests/static-composition-authority.test.ts", [
    "static source and trusted build authority commits only an exact-base deterministic customer source change",
    "static source and trusted build authority accepts only signed build evidence bound to the exact source, graph, application, and image"
  ]),
  vitestProof("plugin-manager", "@k-nex/runtime", "tests/plugin-manager.test.ts", [
    "PluginManager delegates module and executable theme Platform Plugins to source and trusted-build authorities",
    "PluginManager stops before planning or persistence when operation authorization rejects"
  ]),
  nodeProof("app-storage", "tests/app-storage-postgres.test.mjs", [
    "proves revisioned, quota-limited, schema-validated, backed-up, cross-app isolated storage"
  ]),
  nodeProof("runtime-extension-state", "tests/runtime-extension-state-postgres.test.mjs", [
    "proves persistent extension operation serialization, recovery, atomic evidence, and forged-authority rejection"
  ]),
  nodeProof("static-deployment", "tests/static-deployment-postgres.test.mjs", [
    "proves real module.sales customer images, PostgreSQL fencing, rollback, and no downtime",
    "returns maintenance-required without building or starting a target generation"
  ]),
  nodeProof("theme-skin-profile", "tests/theme-skin-profile-postgres.test.mjs", [
    "publishes and rolls back Theme Profiles atomically against exact active skin generations"
  ]),
  browserProof("remote-ui-browser", "packages/ui-testing/scripts/remote-ui-browser.mjs", "P9_REMOTE_UI_BROWSER_PASS"),
  browserProof("theme-skin-browser", "packages/ui-testing/scripts/theme-skin-browser.mjs", "P9_THEME_SKIN_BROWSER_PASS")
];

const attacks = [
  ["arbitrary repository/branch URL", ["static-composition-authority"]],
  ["unsigned/tampered/downgraded/revoked bundle", ["bundler-rejections"]],
  ["archive traversal/symlink/hardlink/collision/bomb", ["bundler-rejections"]],
  ["install script or runtime package-manager invocation", ["bundler-rejections"]],
  ["host dynamic import of downloaded code", ["runner-isolation"]],
  ["same-origin credentialed remote UI fetch/storage/network", ["remote-ui-browser"]],
  ["forbidden builtin/import/capability", ["runner-isolation"]],
  ["host/cross-app DB/Docker/secret/network/filesystem escape", ["runner-isolation"]],
  ["cross-app storage/token/revision reuse", ["app-storage", "runner-isolation"]],
  ["staged artifact served before verification", ["remote-ui-assets"]],
  ["mixed UI/server/storage generation", ["remote-ui-host", "runtime-extension-state"]],
  ["activation pointer race", ["runtime-extension-state"]],
  ["stale operation replay", ["runtime-extension-state"]],
  ["runtime DB-authored static graph", ["plugin-manager"]],
  ["arbitrary image/tag or unsigned/self-asserted build", ["static-composition-authority"]],
  ["rollback across irreversible migration", ["runtime-extension-state"]],
  ["contract cleanup while rollback open", ["static-deployment"]],
  ["blue/green worker duplicate claim/completion", ["static-deployment"]],
  ["worker/process crash during each state", ["runtime-extension-state", "static-deployment", "theme-skin-profile"]],
  ["false zero-downtime claim", ["static-deployment"]],
  ["web process source/build/Docker authority", ["static-deployment"]],
  ["operator authorization bypass", ["plugin-manager"]]
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
  return { id: proof.id, runner: proof.runner, passed: pass, names: proof.names };
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
  assert.equal(new Set(attacks.map(([attack]) => attack)).size, attacks.length, "Phase 9 attack names must be unique.");
  assert.equal(new Set(proofs.map(({ id }) => id)).size, proofs.length, "Phase 9 proof IDs must be unique.");
  run("pnpm", ["--filter", "@k-nex/customer-gate-1", "build"], { id: "customer-gate-1-build" });
  const results = new Map(proofs.map((proof) => [proof.id, executeProof(proof)]));
  const attackResults = attacks.map(([attack, requiredProofs]) => {
    const passed = requiredProofs.map((proof) => {
      const result = results.get(proof);
      assert.ok(result, `${attack}: required proof ${proof} was not run.`);
      assert.ok(result.passed > 0, `${attack}: required proof ${proof} has no passing named tests.`);
      return result.passed;
    });
    return { attack, proofs: requiredProofs, passed: passed.reduce((total, count) => total + count, 0) };
  });
  return { phase: 9, attacks: attackResults, proofs: [...results.values()], status: "PASS" };
};

if (process.argv[1]?.endsWith("scripts/phase-9-attack-corpus.mjs")) process.stdout.write(`${JSON.stringify(runAttackCorpus())}\n`);
