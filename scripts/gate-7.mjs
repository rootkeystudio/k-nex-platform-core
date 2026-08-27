import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import * as components from "../packages/ui-components/dist/index.js";
import * as data from "../packages/ui-data/dist/index.js";
import * as forms from "../packages/ui-forms/dist/index.js";
import * as pages from "../packages/ui-pages/dist/index.js";
import { componentInventory, referenceComponentNames } from "../packages/ui-components/dist/index.js";
import { componentStateMatrix, componentThemeMatrix } from "../packages/ui-testing/dist/index.js";
import { genericPuckBlockBridges } from "../packages/ui-builder-blocks/dist/index.js";
import { salesDefaultPageContract } from "../modules/sales/dist/pages.js";
import { salesPuckBlockBridges } from "../modules/sales/dist/ui.js";
import { minimalThemePackage } from "../packages/theme-minimal/dist/index.js";
import { neobrutalismThemePackage } from "../packages/theme-neobrutalism/dist/index.js";

const root = resolve(import.meta.dirname, "..");
if (process.versions.node !== "24.19.0") throw new Error(`Gate 7 requires Node 24.19.0; found ${process.versions.node}.`);

const [result, salesPages, modules, componentManifest, dataManifest] = await Promise.all([
  readFile(resolve(root, "docs/implementation/phase-7-result.md"), "utf8"),
  readFile(resolve(root, "modules/sales/src/pages.tsx"), "utf8"),
  readdir(resolve(root, "modules"), { withFileTypes: true }),
  readFile(resolve(root, "packages/ui-components/package.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "packages/ui-data/package.json"), "utf8").then(JSON.parse)
]);

assert.deepEqual(modules.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort(), ["sales"], "Sales must remain the only first-party domain module through Gate 8.");
assert.equal(componentInventory.filter(({ origin }) => origin === "component-gallery").length, 60);
assert.equal(componentInventory.length, 131);
const packageExports = { "@k-nex/ui-components": components, "@k-nex/ui-data": data, "@k-nex/ui-forms": forms, "@k-nex/ui-pages": pages };
assert.deepEqual(componentInventory.filter((entry) => packageExports[entry.packageTarget]?.[entry.name] === undefined).map(({ name }) => name), [], "Every inventory family must be executable from its declared package.");
assert.deepEqual(componentInventory.filter(({ maturity }) => maturity === "reference").map(({ name }) => name).sort(), [...referenceComponentNames].sort());
assert.equal(componentStateMatrix.length, 16);
assert.deepEqual(componentThemeMatrix, ["theme.minimal", "theme.neobrutalism"]);
assert.equal(minimalThemePackage.primitiveOverrides?.Button, neobrutalismThemePackage.primitiveOverrides?.Button, "themes cannot fork component behavior");
assert.equal(genericPuckBlockBridges.length, 13);
assert.equal(salesPuckBlockBridges.length, 6);
assert.equal(salesDefaultPageContract.templates.length, 4);
assert.equal(/from\s+["'](?:payload|@k-nex\/theme-|@tanstack\/|@puckeditor\/)/.test(salesPages), false, "Sales pages bypass platform UI boundaries.");
assert.equal(componentManifest.dependencies["@react-aria/focus"], "3.22.1");
assert.equal(dataManifest.dependencies["@tanstack/react-table"], "8.21.3");
assert.equal(dataManifest.dependencies.lexical, "0.49.0");

for (const marker of [
  "# Phase 7 Result", "**Decision:** **GO Phase 8**", "60 Component Gallery", "131 executable families",
  "P7_COMPONENT_MATRIX_BROWSER_PASS", "P7_COMPONENT_PERFORMANCE_PASS", "Sales remains the only first-party domain module",
  "P8.1"
]) assert.ok(result.includes(marker), `Phase 7 result is missing: ${marker}.`);
const taskCommits = ["581c179", "5bd9c93", "5301d53", "827fc24", "aa6abf4", "b70815a", "f3cf1c6", "e31af8d", "b557058"];
for (const commit of taskCommits) execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root, stdio: "ignore" });

console.log(JSON.stringify({ gate: "Gate 7", galleryFamilies: 60, executableFamilies: componentInventory.length, referenceFamilies: referenceComponentNames.length, stateMatrix: componentStateMatrix.length, themes: componentThemeMatrix, genericBlocks: genericPuckBlockBridges.length, salesBlocks: salesPuckBlockBridges.length, salesPages: salesDefaultPageContract.templates.length }, null, 2));
console.log("GATE_7_PASS");
