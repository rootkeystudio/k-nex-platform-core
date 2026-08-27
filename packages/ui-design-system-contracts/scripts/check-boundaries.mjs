import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");

async function filesUnder(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path, suffix) : extname(path) === suffix ? [path] : [];
  }));
  return nested.flat();
}

const declarationFiles = await filesUnder(join(packageRoot, "dist"), ".ts");
for (const file of declarationFiles.filter((path) => path.endsWith(".d.ts"))) {
  assert(!/react-aria-components|@react-types|react-stately/.test(await readFile(file, "utf8")), `Public declaration leaks React Aria types: ${file}`);
}

const sourceRoots = [join(repositoryRoot, "packages"), join(repositoryRoot, "modules")];
const componentPackageRoot = join(repositoryRoot, "packages/ui-components");
const implementations = new Set([
  join(packageRoot, "src/aria.tsx"),
  join(componentPackageRoot, "src/navigation.tsx")
]);
for (const root of sourceRoots) {
  for (const extension of [".ts", ".tsx"]) {
    for (const file of await filesUnder(root, extension)) {
      if (!implementations.has(file)) assert(!/from\s+["']react-aria-components(?:\/[^"']*)?["']/.test(await readFile(file, "utf8")), `React Aria import escaped its approved K-Nex adapter boundary: ${file}`);
    }
  }
}

const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.dependencies["react-aria-components"], "1.20.0", "React Aria Components must remain exact-pinned.");
const componentManifest = JSON.parse(await readFile(join(componentPackageRoot, "package.json"), "utf8"));
assert.equal(componentManifest.dependencies["react-aria-components"], "1.20.0", "The compound adapter must exact-pin React Aria Components.");
for (const file of (await filesUnder(join(componentPackageRoot, "dist"), ".ts")).filter((path) => path.endsWith(".d.ts"))) {
  assert(!/react-aria-components|@react-types|react-stately/.test(await readFile(file, "utf8")), `Public component declaration leaks React Aria types: ${file}`);
}
const module = await import(join(packageRoot, "dist/index.js"));
assert.deepEqual(Object.keys(module.reactAriaPrimitives).sort(), [...module.semanticPrimitiveNames].sort());
assert(!["DataGrid", "DatePicker", "Chart", "Map", "RichText", "CommandMenu", "ResizableGrid"].some((name) => name in module.reactAriaPrimitives), "A complex adapter entered the V1 primitive ABI.");
console.log("Semantic primitive ABI and React Aria boundaries passed.");
