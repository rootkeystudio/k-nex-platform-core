import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
assert.equal(manifest.dependencies["@puckeditor/core"], undefined);
assert.equal(manifest.dependencies.react, undefined);
for (const name of readdirSync(resolve(root, "dist")).filter((name) => name.endsWith(".d.ts"))) {
  const declaration = readFileSync(resolve(root, "dist", name), "utf8");
  assert.equal(/@puckeditor|react|module-sales|theme-/.test(declaration), false, `Builder block declaration leaks implementation type: ${name}`);
}
console.log("UI builder block boundaries passed.");
