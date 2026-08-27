import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pluginContributionCategoryKeys } from "../packages/contracts/dist/index.js";
import { generateReferenceDocumentation, requiredPluginEvidence, validateConformancePlan } from "./plugin-conformance.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
if (process.versions.node !== "24.19.0") throw new Error(`Gate 6 requires Node 24.19.0; found ${process.versions.node}.`);

export async function validateGate6(root = repositoryRoot) {
  const [authorGuide, generatedReference, result, salesManifest, salesPackage, conformancePlan, moduleEntries] = await Promise.all([
    readFile(resolve(root, "docs/plugin-authoring.md"), "utf8"),
    readFile(resolve(root, "docs/generated/module-sales-reference.md"), "utf8"),
    readFile(resolve(root, "docs/implementation/phase-6-result.md"), "utf8"),
    readFile(resolve(root, "modules/sales/k-nex.plugin.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "modules/sales/package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "modules/sales/k-nex.conformance.json"), "utf8").then(JSON.parse),
    readdir(resolve(root, "modules"), { withFileTypes: true })
  ]);

  assert.deepEqual(moduleEntries.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort(), ["sales"], "Sales must remain the only first-party domain module through Gate 8.");
  assert.deepEqual(Object.keys(salesManifest.contributions).sort(), [...pluginContributionCategoryKeys].sort(), "Sales must declare every supported contribution category.");
  validateConformancePlan(conformancePlan);
  assert.deepEqual([...new Set(conformancePlan.proofs.flatMap(({ covers }) => covers))].sort(), [...requiredPluginEvidence].sort(), "Sales conformance evidence must remain complete.");
  assert.equal(generatedReference, generateReferenceDocumentation(salesManifest, salesPackage, conformancePlan), "Generated Sales reference documentation is stale.");
  for (const marker of [
    "## Quick start", "## Contribution matrix", "## Entrypoints and package boundary", "## Sources, actions, and tools",
    "## UI, Puck, routes, and default pages", "## Settings and permissions", "## Migrations and lifecycle",
    "## Conformance command", "## Diagnostic catalog", "pnpm plugin:check modules/sales"
  ]) assert.ok(authorGuide.includes(marker), `Plugin author guide is missing: ${marker}.`);
  for (const obsolete of ["definePluginQueries", "definePluginActions", "helper names are provisional"]) {
    assert.equal(authorGuide.includes(obsolete), false, `Plugin author guide retains obsolete pre-v1 helper: ${obsolete}.`);
  }
  for (const task of ["P6.1", "P6.2", "P6.3", "P6.4", "P6.5", "P6.6", "P6.7", "P6.8", "P6.9", "P6.10"]) {
    assert.ok(result.includes(task), `Phase 6 result is missing task mapping: ${task}.`);
  }
  for (const marker of ["all 13 evidence classes", "runtime 200", "Payload adapter 32", "conformance-plan 5"]) {
    assert.ok(result.includes(marker), `Phase 6 result is missing: ${marker}.`);
  }
  for (const stale of ["all 11 evidence classes", "runtime 175", "runtime 178", "runtime 189", "Payload adapter 31", "conformance-plan 2", "conformance-plan 4", "this closeout commit"]) {
    assert.equal(result.includes(stale), false, `Phase 6 result retains stale evidence: ${stale}.`);
  }

  return {
    gate: "Gate 6",
    referencePlugin: salesManifest.id,
    contributionCategories: Object.keys(salesManifest.contributions).length,
    conformanceEvidenceClasses: requiredPluginEvidence.length,
    firstPartyDomainModules: ["module.sales"]
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await validateGate6(), null, 2));
  console.log("GATE_6_PASS");
}
