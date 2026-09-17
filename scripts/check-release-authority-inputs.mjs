#!/usr/bin/env node
/**
 * A release-authority script is one whose output is cryptographically attested
 * and then handed to customers as the description of their upgrade. Such a
 * script may only read the product: the shipped packages, the signed release
 * manifests, and the compiler boundary the factory emits from.
 *
 * The repository also carries a hand-maintained customer fixture whose source
 * tree is a different lineage from the factory output - different migration
 * identities, different file names, different length. Reading that lineage
 * from a release-authority script produces an attested document that describes
 * an application nobody ships, which is exactly how the 1.0->1.1 migration set
 * came to omit 20260906_000029_attachment_upload_admissions.
 *
 * Fixture packages are the packed release artifacts themselves, so the mirror
 * directory stays readable; everything else under fixtures/ does not.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { acceptedSourceMigrationRegistry, factoryMigrationRegistry } from "./lib/platform-release-transition.mjs";

export const releaseAuthorityScripts = Object.freeze([
  "scripts/generate-phase-13-transition-policy.mjs",
  "scripts/publish-platform-release-transition.mjs",
  "scripts/generate-phase-8-release-manifests.mjs",
  "scripts/generate-current-v1-sales-release-source.mjs",
  "scripts/generate-release-evidence.mjs"
]);

export const permittedFixturePrefix = "fixtures/customer-gate-1/packages";

export function assertReleaseAuthorityInputs({ root, scripts = releaseAuthorityScripts }) {
  for (const script of scripts) {
    const source = readFileSync(resolve(root, script), "utf8");
    for (const [reference] of source.matchAll(/fixtures\/[^"'`\s)]*/gu)) {
      assert.ok(reference.startsWith(permittedFixturePrefix),
        `${script} reads the customer fixture lineage (${reference}); a release-authority script may only read ${permittedFixturePrefix}.`);
    }
  }
}

export function assertAcceptedMigrationSetMatchesFactory({ boundary, migrationSet }) {
  const targetMigrations = factoryMigrationRegistry(boundary);
  assert.deepEqual(targetMigrations.slice(0, acceptedSourceMigrationRegistry.length), [...acceptedSourceMigrationRegistry],
    "Shipped factory no longer retains the attested 1.0.0 migration registry as its exact prefix.");
  assert.deepEqual(migrationSet.steps.map(({ id }) => id), targetMigrations.slice(acceptedSourceMigrationRegistry.length),
    "Accepted migration set differs from the migrations the shipped factory appends; the attested upgrade would describe a different application.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = resolve(import.meta.dirname, "..");
  const { salesReferenceCompilerBoundary } = await import("../packages/composition/dist/index.js");
  const policySource = readFileSync(resolve(root, "scripts/generate-phase-13-transition-policy.mjs"), "utf8");
  assertReleaseAuthorityInputs({ root });
  assert.match(policySource, /salesReferenceCompilerBoundary/u,
    "The transition policy must derive its target migration registry from the shipped compiler boundary.");
  assertAcceptedMigrationSetMatchesFactory({
    boundary: salesReferenceCompilerBoundary,
    migrationSet: JSON.parse(readFileSync(resolve(root, "docs/implementation/phase-13-migration-set.json"), "utf8"))
  });
  process.stdout.write(`RELEASE_AUTHORITY_INPUTS_PASS ${releaseAuthorityScripts.length}\n`);
}
