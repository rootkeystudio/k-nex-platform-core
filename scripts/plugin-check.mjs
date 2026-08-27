import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runConformancePlan } from "./plugin-conformance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv[2];
if (requested === undefined || process.argv.length !== 3) throw new Error("Usage: pnpm plugin:check <plugin-directory>");
const pluginRoot = await realpath(resolve(root, requested));
assert.ok(pluginRoot.startsWith(`${root}${sep}`), "Plugin directory must be inside the repository.");

const [manifest, packageJson, plan] = await Promise.all([
  readFile(resolve(pluginRoot, "k-nex.plugin.json"), "utf8").then(JSON.parse),
  readFile(resolve(pluginRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(resolve(pluginRoot, "k-nex.conformance.json"), "utf8").then(JSON.parse)
]);
assert.equal(plan.pluginId, manifest.id, "Conformance plan pluginId must match the plugin manifest.");
assert.equal(packageJson.name, manifest.package, "Plugin package name must match the plugin manifest.");

const results = runConformancePlan({ plan, pluginPackage: packageJson.name, root });
console.log(JSON.stringify({ pluginId: manifest.id, evidence: results }, null, 2));
console.log("PLUGIN_CONFORMANCE_PASS");
