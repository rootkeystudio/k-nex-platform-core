import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertPhase8ReleaseSnapshot } from "./lib/phase-8-provenance.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "fixtures/customer-alpha/security-patch-plan.json");

test("Gate 8 rejects and does not silently repair stale committed evidence", () => {
  const original = readFileSync(target);
  try {
    const stale = JSON.parse(original.toString("utf8"));
    stale.targetVersion = "9.9.9";
    const staleContent = Buffer.from(`${JSON.stringify(stale, null, 2)}\n`);
    writeFileSync(target, staleContent);
    const result = spawnSync(process.execPath, ["scripts/check-phase-8-generated-evidence.mjs"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /generated evidence is stale/u);
    assert.deepEqual(readFileSync(target), staleContent, "The check must not repair the stale committed artifact it rejected.");
  } finally {
    writeFileSync(target, original);
  }
});

test("Gate 8 validates a squash-style signed release snapshot without Git topology and rejects missing or modified artifacts", () => {
  const snapshot = mkdtempSync(join(tmpdir(), "k-nex-gate-8-squash-"));
  const manifest = "releases/0.2.0/package-release-manifest.json";
  const bundlePath = "release-evidence/phase-8/customer-alpha.application-bundle.json";
  try {
    for (const path of [manifest, bundlePath]) {
      mkdirSync(resolve(snapshot, path, ".."), { recursive: true });
      cpSync(resolve(root, path), resolve(snapshot, path));
    }
    mkdirSync(resolve(snapshot, "fixtures/customer-gate-1"), { recursive: true });
    cpSync(resolve(root, "fixtures/customer-gate-1/packages"), resolve(snapshot, "fixtures/customer-gate-1/packages"), { recursive: true });
    assert.equal(existsSync(resolve(snapshot, ".git")), false);
    const bundle = JSON.parse(readFileSync(resolve(snapshot, bundlePath), "utf8"));
    assert.doesNotThrow(() => assertPhase8ReleaseSnapshot(snapshot, bundle));

    const artifact = resolve(snapshot, "fixtures/customer-gate-1/packages/k-nex-runtime-0.0.0.tgz");
    const original = readFileSync(artifact);
    rmSync(artifact);
    assert.throws(() => assertPhase8ReleaseSnapshot(snapshot, bundle), /ENOENT/u);
    writeFileSync(artifact, "modified");
    assert.throws(() => assertPhase8ReleaseSnapshot(snapshot, bundle), /differs from the signed application bundle/u);
    writeFileSync(artifact, original);
    assert.doesNotThrow(() => assertPhase8ReleaseSnapshot(snapshot, bundle));
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
});
