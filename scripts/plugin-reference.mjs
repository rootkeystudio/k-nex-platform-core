import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { generateReferenceDocumentation, validateConformancePlan } from "./plugin-conformance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv[2];
if (requested === undefined || process.argv.length !== 3) throw new Error("Usage: pnpm plugin:reference <plugin-directory>");
const pluginRoot = await realpath(resolve(root, requested));
assert.ok(pluginRoot.startsWith(`${root}${sep}`), "Plugin directory must be inside the repository.");

const [manifest, packageJson, plan] = await Promise.all([
  readFile(resolve(pluginRoot, "k-nex.plugin.json"), "utf8").then(JSON.parse),
  readFile(resolve(pluginRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(resolve(pluginRoot, "k-nex.conformance.json"), "utf8").then(JSON.parse)
]);
validateConformancePlan(plan);
assert.equal(manifest.id, "module.sales", "Only the Sales reference documentation is generated through Gate 8.");
assert.equal(plan.pluginId, manifest.id);
assert.equal(packageJson.name, manifest.package);

await writeFile(resolve(root, "docs/generated/module-sales-reference.md"), generateReferenceDocumentation(manifest, packageJson, plan));
console.log("Sales plugin reference documentation generated.");
