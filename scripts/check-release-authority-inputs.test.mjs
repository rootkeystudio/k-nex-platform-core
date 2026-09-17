import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { salesReferenceCompilerBoundary } from "../packages/composition/dist/index.js";
import { assertAcceptedMigrationSetMatchesFactory, assertReleaseAuthorityInputs, releaseAuthorityScripts } from "./check-release-authority-inputs.mjs";
import { acceptedSourceMigrationRegistry, factoryMigrationRegistry } from "./lib/platform-release-transition.mjs";

const root = resolve(import.meta.dirname, "..");
const shippedSteps = factoryMigrationRegistry(salesReferenceCompilerBoundary)
  .slice(acceptedSourceMigrationRegistry.length)
  .map((id) => ({ id, phase: "offline-required" }));

function withScript(source) {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-release-authority-"));
  mkdirSync(resolve(directory, "scripts"));
  writeFileSync(resolve(directory, "scripts/candidate.mjs"), source);
  return directory;
}

test("every shipped release-authority script reads only the product", () => {
  assert.ok(releaseAuthorityScripts.length > 0);
  assertReleaseAuthorityInputs({ root });
});

test("a release-authority script may read the packed artifact mirror", () => {
  const directory = withScript('const artifacts = resolve(root, "fixtures/customer-gate-1/packages");\n');
  try {
    assertReleaseAuthorityInputs({ root: directory, scripts: ["scripts/candidate.mjs"] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a release-authority script may not read the customer fixture lineage", () => {
  for (const reference of [
    "fixtures/customer-gate-1/src/migrations/index.ts",
    "fixtures/customer-gate-1/tests/p13-9-upgrade-backup-restore-postgres.test.mjs",
    "fixtures/customer-gate-1/k-nex.app.json"
  ]) {
    const directory = withScript(`const source = readFileSync(resolve(root, "${reference}"), "utf8");\n`);
    try {
      assert.throws(() => assertReleaseAuthorityInputs({ root: directory, scripts: ["scripts/candidate.mjs"] }),
        new RegExp(reference.replaceAll(".", "\\."), "u"), `${reference} was accepted as a release-authority input.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("the accepted migration set must equal what the shipped factory appends", () => {
  const boundary = salesReferenceCompilerBoundary;
  assertAcceptedMigrationSetMatchesFactory({ boundary, migrationSet: { steps: shippedSteps } });
  for (const [name, steps] of [
    ["omission", shippedSteps.filter(({ id }) => id !== "20260906_000029_attachment_upload_admissions")],
    ["reorder", [shippedSteps[1], shippedSteps[0], ...shippedSteps.slice(2)]],
    ["addition", [...shippedSteps, { id: "20260909_999999_unshipped_migration", phase: "offline-required" }]],
    ["substitution", [{ id: "20260905_000027_substituted", phase: "offline-required" }, ...shippedSteps.slice(1)]]
  ]) {
    assert.throws(() => assertAcceptedMigrationSetMatchesFactory({ boundary, migrationSet: { steps } }),
      /Accepted migration set differs/u, `Migration set ${name} was accepted.`);
  }
});

test("the attested source registry must remain the shipped factory's exact prefix", () => {
  const drifted = {
    platformPaths: salesReferenceCompilerBoundary.platformPaths.filter((path) => path !== "src/migrations/20260903_000027_event_outbox.ts"),
    migrationPaths: salesReferenceCompilerBoundary.migrationPaths
  };
  assert.throws(() => assertAcceptedMigrationSetMatchesFactory({ boundary: drifted, migrationSet: { steps: shippedSteps } }),
    /exact prefix/u, "A factory that drops an attested 1.0 migration was accepted.");
});
