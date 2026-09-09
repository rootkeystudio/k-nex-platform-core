import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const live = resolve(root, "modules/sales");
const release = resolve(root, "releases/sources/sales-1.0.0");
const check = process.argv.includes("--check");
const version = "1.0.0";

function files(directory, accept) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && accept(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function exactPackageJson() {
  const manifest = structuredClone(JSON.parse(readFileSync(resolve(live, "package.json"), "utf8")));
  assert.equal(manifest.name, "@k-nex/module-sales");
  assert.equal(manifest.version, version);
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[section] === undefined) continue;
    manifest[section] = Object.fromEntries(Object.entries(manifest[section]).map(([name, specifier]) => [
      name,
      name.startsWith("@k-nex/") ? version : specifier
    ]));
  }
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

const expected = new Map([
  ["package.json", exactPackageJson()],
  ["k-nex.plugin.json", readFileSync(resolve(live, "k-nex.plugin.json"))],
  ["release-source.json", Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    package: "@k-nex/module-sales",
    version,
    platformRelease: version,
    migrationRevision: 3,
    sourceKind: "immutable-package-source"
  }, null, 2)}\n`)]
]);

for (const name of files(resolve(live, "dist"), (value) => value.endsWith(".js") || value.endsWith(".d.ts"))) {
  expected.set(`dist/${name}`, readFileSync(resolve(live, "dist", name)));
}
for (const name of files(resolve(live, "assets"), (value) => value.endsWith(".sql"))) {
  expected.set(`assets/${name}`, readFileSync(resolve(live, "assets", name)));
}

const actual = new Set();
for (const name of ["package.json", "k-nex.plugin.json", "release-source.json"]) {
  if (existsSync(resolve(release, name))) actual.add(name);
}
for (const directory of ["dist", "assets"]) {
  if (!existsSync(resolve(release, directory))) continue;
  for (const entry of readdirSync(resolve(release, directory), { withFileTypes: true })) {
    assert.equal(entry.isFile(), true, `Release source contains a non-file entry: ${directory}/${entry.name}`);
    actual.add(`${directory}/${entry.name}`);
  }
}

const stale = [...actual].filter((path) => !expected.has(path)).sort();
const missing = [...expected].filter(([path]) => !actual.has(path)).map(([path]) => path).sort();
const changed = [...expected].filter(([path, content]) => actual.has(path) && !readFileSync(resolve(release, path)).equals(content)).map(([path]) => path).sort();

if (check) {
  assert.deepEqual(stale, [], `Current-v1 Sales release source has stale files: ${stale.join(", ")}`);
  assert.deepEqual(missing, [], `Current-v1 Sales release source is missing files: ${missing.join(", ")}`);
  assert.deepEqual(changed, [], `Current-v1 Sales release source has changed files: ${changed.join(", ")}`);
  process.stdout.write(`CURRENT_V1_SALES_RELEASE_SOURCE_CHECK_PASS ${expected.size}\n`);
} else {
  mkdirSync(resolve(release, "dist"), { recursive: true });
  mkdirSync(resolve(release, "assets"), { recursive: true });
  for (const path of stale) {
    const target = resolve(release, path);
    assert.equal(lstatSync(target).isFile(), true, `Refusing to remove a non-file release path: ${path}`);
    rmSync(target);
  }
  for (const [path, content] of expected) {
    const target = resolve(release, path);
    if (!existsSync(target) || !readFileSync(target).equals(content)) writeFileSync(target, content);
  }
  process.stdout.write(`CURRENT_V1_SALES_RELEASE_SOURCE_GENERATED ${expected.size}\n`);
}
