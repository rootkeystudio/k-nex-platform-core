import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const packageJson = JSON.parse(read("package.json"));

assert.equal(process.versions.node, "24.19.0", `Gate 9 requires Node 24.19.0; found ${process.versions.node}.`);
const gate = packageJson.scripts["gate:9"];
for (const command of [
  "pnpm gate:8",
  "pnpm phase:9:attacks",
  "pnpm --filter @k-nex/extension-bundler test",
  "pnpm --filter @k-nex/extension-runner test",
  "pnpm --filter @k-nex/runtime test",
  "pnpm --filter @k-nex/payload-adapter test",
  "pnpm --filter @k-nex/ui-testing test:browser",
  "pnpm --filter @k-nex/customer-gate-1 test:postgres",
  "node scripts/gate-9.mjs"
]) assert.ok(gate.includes(command), `Gate 9 omits mandatory command: ${command}`);

for (const schema of [
  "extension-bundle-manifest", "extension-generation", "extension-install-plan", "extension-install-receipt",
  "hot-application-manifest", "migration-compatibility-plan", "remote-ui-isolation-profile", "runner-isolation-profile",
  "static-composition-change-plan", "static-deployment-receipt", "theme-skin-manifest", "trusted-application-build-evidence",
  "worker-generation-fence"
]) assert.ok(read(`schemas/${schema}.v1.schema.json`).includes(`schemas.k-nex.dev/${schema}/v1.json`), `Gate 9 schema is missing or stale: ${schema}`);

const evidence = [
  ["packages/extension-bundler/tests/extension-bundler.test.ts", ["byte-identical self-contained payloads", "signed catalog", "traversal, links, duplicate paths, bombs"]],
  ["packages/extension-runner/tests/docker-sandbox.test.ts", ["execFile(\"docker\"", "ReadonlyRootfs", "keeps app/generation responses isolated", "quarantines only a timed-out generation"]],
  ["packages/ui-testing/scripts/remote-ui-browser.mjs", ["chromium.launch", "credentialless iframe", "P9_REMOTE_UI_BROWSER_PASS"]],
  ["packages/ui-testing/scripts/theme-skin-browser.mjs", ["chromium.launch", "P9_THEME_SKIN_BROWSER_PASS"]],
  ["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", ["PostgreSqlContainer", "const traffic = Array.from", "pg_dump", "blocked-irreversible", "disableGeneration", "uninstallGeneration"]],
  ["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", ["PostgreSqlContainer", '"run", "--rm", "--detach"', "simulated fence transfer crash", "sales-external-effect", "CONTRACT_CLEANUP_BLOCKED", "maintenance-required"]],
  ["packages/runtime/tests/static-composition-authority.test.ts", ["generateKeyPairSync(\"ed25519\")", "exact source, graph, application, and image"]],
  ["scripts/check-phase-8-packed-packages.mjs", ["packed"]],
  ["scripts/phase-9-attack-corpus.mjs", ["operator authorization bypass", "web process source/build/Docker authority"]]
];
for (const [path, anchors] of evidence) {
  const source = read(path);
  for (const anchor of anchors) assert.ok(source.includes(anchor), `Gate 9 mandatory non-mock evidence is missing from ${path}: ${anchor}`);
}

const modules = readdirSync(resolve(root, "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.deepEqual(modules, ["sales"], "Sales must remain the only first-party reference domain module through Gate 9.");

const result = read("docs/implementation/phase-9-result.md");
for (const marker of [
  "# Phase 9 Result", "**Decision:** **READY FOR PHASE REVIEW**", "GO PHASE 10 RBAC AND AUTHORIZATION",
  "P9_REMOTE_UI_BROWSER_PASS", "P9_THEME_SKIN_BROWSER_PASS", "22 required attacks", "P10.1"
]) assert.ok(result.includes(marker), `Phase 9 result is missing: ${marker}`);
for (let task = 1; task <= 10; task += 1) assert.ok(result.includes(`P9.${task}`), `Phase 9 result is missing task P9.${task}.`);

console.log(JSON.stringify({ gate: "Gate 9", schemas: 13, attacks: 22, postgresJourneys: 10, referenceModules: modules }, null, 2));
console.log("GATE_9_PASS");
