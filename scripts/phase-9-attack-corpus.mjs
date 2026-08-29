import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const proofs = [
  ["arbitrary repository/branch URL", [["fixtures/extensions/invalid/static-change.branch-base.json", '"sourceCommit": "main"']]],
  ["unsigned/tampered/downgraded/revoked bundle", [["packages/extension-bundler/tests/extension-bundler.test.ts", "verifies the signed catalog and every provenance/release binding before stage"], ["packages/extension-bundler/tests/extension-bundler.test.ts", "revoked: true"]]],
  ["archive traversal/symlink/hardlink/collision/bomb", [["packages/extension-bundler/tests/extension-bundler.test.ts", "rejects traversal, links, duplicate paths, bombs"]]],
  ["install script or runtime package-manager invocation", [["packages/extension-bundler/tests/extension-bundler.test.ts", "rejects module access and package lifecycle representation"]]],
  ["host dynamic import of downloaded code", [["packages/extension-runner/tests/docker-sandbox.test.ts", "requireType: \"undefined\""]]],
  ["same-origin credentialed remote UI fetch/storage/network", [["packages/ui-testing/scripts/remote-ui-browser.mjs", "authenticatedFetch"], ["packages/ui-testing/scripts/remote-ui-browser.mjs", "credentialless iframe sent extension-origin cookies"]]],
  ["forbidden builtin/import/capability", [["packages/extension-runner/tests/docker-sandbox.test.ts", "CAPABILITY_DENIED"]]],
  ["host/cross-app DB/Docker/secret/network/filesystem escape", [["packages/extension-runner/tests/docker-sandbox.test.ts", "DATABASE_URL|DOCKER_HOST|PAYLOAD_SECRET"], ["packages/extension-runner/tests/docker-sandbox.test.ts", "keeps app/generation responses isolated"]]],
  ["cross-app storage/token/revision reuse", [["fixtures/customer-gate-1/tests/app-storage-postgres.test.mjs", "cross-app isolated storage"], ["packages/extension-runner/tests/docker-sandbox.test.ts", "mixed token identity"]]],
  ["staged artifact served before verification", [["packages/extension-bundler/tests/remote-ui-assets.test.ts", "rejects staged, mixed-generation"]]],
  ["mixed UI/server/storage generation", [["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", "serverGenerationId"], ["packages/ui-runtime/tests/remote-ui-host.test.ts", "admits only the active generation"]]],
  ["activation pointer race", [["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", "const traffic = Array.from"]]],
  ["stale operation replay", [["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", "IDEMPOTENCY_CONFLICT"], ["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", "resumeOperation"]]],
  ["runtime DB-authored static graph", [["packages/runtime/tests/plugin-manager.test.ts", "delegates module and executable theme Platform Plugins to source and trusted-build authorities"]]],
  ["arbitrary image/tag or unsigned/self-asserted build", [["packages/runtime/tests/static-composition-authority.test.ts", "accepts only signed build evidence bound to the exact source, graph, application, and image"]]],
  ["rollback across irreversible migration", [["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", "blocked-irreversible"]]],
  ["contract cleanup while rollback open", [["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", "CONTRACT_CLEANUP_BLOCKED"]]],
  ["blue/green worker duplicate claim/completion", [["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", "sales-external-effect"], ["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", "FENCE_REJECTED"]]],
  ["worker/process crash during each state", [["fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs", "simulated crash before commit"], ["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", "simulated fence transfer crash"], ["fixtures/customer-gate-1/tests/theme-skin-profile-postgres.test.mjs", "simulated profile crash before commit"]]],
  ["false zero-downtime claim", [["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", "returns maintenance-required without starting a Docker generation"]]],
  ["web process source/build/Docker authority", [["fixtures/customer-gate-1/tests/static-deployment-postgres.test.mjs", "DOCKER_HOST|DATABASE_URL|GITHUB_TOKEN|SOURCE_WRITE_TOKEN"], ["packages/runtime/src/static-composition-authority.ts", "TrustedStaticApplicationBuildAuthority"]]],
  ["operator authorization bypass", [["packages/runtime/tests/plugin-manager.test.ts", "stops before planning or persistence when operation authorization rejects"]]]
];

assert.equal(new Set(proofs.map(([attack]) => attack)).size, proofs.length, "Phase 9 attack names must be unique.");
for (const [attack, evidence] of proofs) {
  assert.ok(evidence.length > 0, `${attack} has no executable evidence.`);
  for (const [path, anchor] of evidence) {
    const source = await readFile(resolve(root, path), "utf8");
    assert.ok(source.includes(anchor), `${attack} evidence anchor is missing from ${path}: ${anchor}`);
  }
}

process.stdout.write(`${JSON.stringify({ phase: 9, attacks: proofs.length, status: "PASS" })}\n`);
