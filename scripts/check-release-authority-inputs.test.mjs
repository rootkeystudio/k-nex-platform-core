import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import { salesReferenceCompilerBoundary } from "../packages/composition/dist/index.js";
import { assertAcceptedMigrationSetMatchesFactory, assertReleaseAuthorityInputs, releaseAuthorityScripts } from "./check-release-authority-inputs.mjs";
import { acceptedSourceMigrationRegistry, factoryMigrationRegistry, generatorPackage } from "./lib/platform-release-transition.mjs";

const root = resolve(import.meta.dirname, "..");
const shippedSteps = factoryMigrationRegistry(salesReferenceCompilerBoundary)
  .slice(acceptedSourceMigrationRegistry.length)
  .map((id) => ({ id, phase: "offline-required" }));

function withScript(source, helpers = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "k-nex-release-authority-"));
  mkdirSync(resolve(directory, "scripts/lib"), { recursive: true });
  writeFileSync(resolve(directory, "scripts/candidate.mjs"), source);
  for (const [path, contents] of Object.entries(helpers)) writeFileSync(resolve(directory, path), contents);
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

test("a release-authority script may not reach the fixture lineage through a helper", () => {
  for (const [name, helpers, source] of [
    ["direct import", { "scripts/lib/registry.mjs": 'export const path = "fixtures/customer-gate-1/src/migrations/index.ts";\n' },
      'import { path } from "./lib/registry.mjs";\nexport default path;\n'],
    ["transitive import", {
      "scripts/lib/registry.mjs": 'export { path } from "./inner.mjs";\n',
      "scripts/lib/inner.mjs": 'export const path = "fixtures/customer-gate-1/tests/p13-9-upgrade-backup-restore-postgres.test.mjs";\n'
    }, 'import { path } from "./lib/registry.mjs";\nexport default path;\n'],
    ["dynamic import", { "scripts/lib/registry.mjs": 'export const path = "fixtures/customer-gate-1/k-nex.app.json";\n' },
      'const { path } = await import("./lib/registry.mjs");\nexport default path;\n']
  ]) {
    const directory = withScript(source, helpers);
    try {
      assert.throws(() => assertReleaseAuthorityInputs({ root: directory, scripts: ["scripts/candidate.mjs"] }),
        /reads the customer fixture lineage through/u, `${name} was accepted as a release-authority input.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("the walk follows every static reference form, not just from-imports", () => {
  const leak = 'export const path = "fixtures/customer-gate-1/src/migrations/index.ts";\n';
  for (const [name, source] of [
    ["side-effect import", 'import "./lib/registry.mjs";\n'],
    ["require", 'const { path } = require("./lib/registry.mjs");\nexport default path;\n'],
    ["new URL", 'const href = new URL("./lib/registry.mjs", import.meta.url);\nexport default href;\n'],
    ["export from", 'export { path } from "./lib/registry.mjs";\n']
  ]) {
    const directory = withScript(source, { "scripts/lib/registry.mjs": leak });
    try {
      assert.throws(() => assertReleaseAuthorityInputs({ root: directory, scripts: ["scripts/candidate.mjs"] }),
        /reads the customer fixture lineage through/u, `${name} bypassed the release-authority walk.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("a reference a release-authority input builds at runtime is refused outright", () => {
  for (const [name, source] of [
    ["computed import", 'const helper = await import(process.env.HELPER);\nexport default helper;\n'],
    ["computed require", 'const helper = require(helperPath);\nexport default helper;\n'],
    ["computed URL", 'const href = new URL(relativePath, import.meta.url);\nexport default href;\n'],
    ["interpolated fixture path", 'export const path = `fixtures/customer-gate-1/${directory}/index.ts`;\n']
  ]) {
    const directory = withScript(source);
    try {
      assert.throws(() => assertReleaseAuthorityInputs({ root: directory, scripts: ["scripts/candidate.mjs"] }),
        /must name what it reads/u, `${name} was accepted as a release-authority input.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("the permitted fixture prefix ends at a path boundary", () => {
  for (const reference of ["fixtures/customer-gate-1/packages-old/manifest.json", "fixtures/customer-gate-1/packages.bak/x.tgz"]) {
    const directory = withScript(`const mirror = resolve(root, "${reference}");\n`);
    try {
      assert.throws(() => assertReleaseAuthorityInputs({ root: directory, scripts: ["scripts/candidate.mjs"] }),
        /may only read fixtures\/customer-gate-1\/packages/u, `${reference} was accepted as the packed artifact mirror.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("the walk reaches the helper modules the shipped release scripts import", () => {
  const visited = assertReleaseAuthorityInputs({ root });
  for (const helper of ["scripts/lib/platform-release-transition.mjs", "scripts/lib/release-train.mjs"]) {
    assert.ok([...visited].some((path) => path.endsWith(helper)), `Release-authority walk never reached ${helper}.`);
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

test("the managed-output contract digest tracks the package that generates the tree", async () => {
  const { platformReleaseGeneratorContractDigest } = await import("../packages/contracts/dist/index.js");
  const sourceManifest = JSON.parse(readFileSync(resolve(root, "releases/1.0.0/package-release-manifest.json"), "utf8"));
  const targetManifest = JSON.parse(readFileSync(resolve(root, "releases/1.1.0/package-release-manifest.json"), "utf8"));
  const entry = (manifest, name) => {
    const found = manifest.packages.find(({ package: packageName }) => packageName === name);
    assert.ok(found, `Release manifest does not contain ${name}.`);
    return found;
  };
  assert.equal(generatorPackage, "@k-nex/composition", "The generator must be the package that emits the application tree.");
  const baseline = platformReleaseGeneratorContractDigest(entry(sourceManifest, generatorPackage), entry(targetManifest, generatorPackage));
  // Changing only the generator's own bytes must move the contract digest;
  // naming a package that generates nothing left it unmoved.
  const drifted = { ...entry(targetManifest, generatorPackage), integrity: `sha512-${"A".repeat(86)}==` };
  assert.notEqual(platformReleaseGeneratorContractDigest(entry(sourceManifest, generatorPackage), drifted), baseline,
    "A Composition integrity change must move the managed-output contract digest.");
  const runtimeDigest = platformReleaseGeneratorContractDigest(entry(sourceManifest, "@k-nex/runtime"), entry(targetManifest, "@k-nex/runtime"));
  assert.notEqual(runtimeDigest, baseline, "The generator contract must not resolve to the Runtime package bytes.");
});

test("the attested source registry must remain the shipped factory's exact prefix", () => {
  const drifted = {
    platformPaths: salesReferenceCompilerBoundary.platformPaths.filter((path) => path !== "src/migrations/20260903_000027_event_outbox.ts"),
    migrationPaths: salesReferenceCompilerBoundary.migrationPaths
  };
  assert.throws(() => assertAcceptedMigrationSetMatchesFactory({ boundary: drifted, migrationSet: { steps: shippedSteps } }),
    /exact prefix/u, "A factory that drops an attested 1.0 migration was accepted.");
});
