import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { canonicalJson } from "../packages/contracts/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(root, "fixtures/customer-gate-1/packages");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const result = args[index + 1];
  if (result === undefined || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
};
const releaseVersion = value("--version", "1.0.0");
if (!/^\d+\.\d+\.\d+$/u.test(releaseVersion) || args.some((arg, index) => arg.startsWith("--") && !["--version"].includes(arg) || arg === "--version" && (index === args.length - 1 || args[index + 1]?.startsWith("--")))) {
  throw new Error("Usage: check-phase-8-packed-packages.mjs [--version <semver>]");
}
const releases = [releaseVersion].map((version) => {
  const content = readFileSync(resolve(root, `releases/${version}/package-release-manifest.json`), "utf8");
  const manifest = JSON.parse(content);
  assert.equal(content, canonicalJson(manifest), `Release ${version} manifest must be canonical so its hosted subject digest equals its authority digest.`);
  return manifest;
});
const immutableManifest = readFileSync(resolve(root, "releases/1.0.0/package-release-manifest.json"));
assert.equal(createHash("sha256").update(immutableManifest).digest("hex"), "1d8b40e0073fb24d42f47bc3a0fd763db0a0fb5baf706120f7fe3a2768c13eea", "Accepted 1.0.0 release manifest was modified.");
const workspaceSpecifier = /^(?:workspace:|link:|file:)/u;

function entries(archive) {
  const tar = gunzipSync(archive);
  const result = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    assert.ok(name.length > 0 && Number.isSafeInteger(size) && size >= 0 && !result.has(name), "Packed release tar metadata is invalid.");
    const start = offset + 512;
    assert.ok(start + size <= tar.length, `Packed release artifact ${name} is truncated.`);
    result.set(name, tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return result;
}

function exportedNames(packed, path, seen = new Set()) {
  if (seen.has(path)) return new Set();
  seen.add(path);
  const source = packed.get(path)?.toString("utf8");
  assert.ok(source, `Packed ABI entrypoint ${path} is missing.`);
  const names = new Set([...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gu)].map((match) => match[1]));
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/gu)) {
    for (const binding of match[1].split(",")) names.add(binding.trim().split(/\s+as\s+/u).at(-1));
  }
  for (const match of source.matchAll(/export\s*\*\s*from\s*["'](\.\/[^"']+)["']/gu)) {
    for (const name of exportedNames(packed, posix.normalize(posix.join(posix.dirname(path), match[1])), seen)) names.add(name);
  }
  return names;
}

const archives = new Map();
for (const filename of readdirSync(artifactDirectory).filter((name) => name.endsWith(".tgz")).sort()) {
  const archive = readFileSync(resolve(artifactDirectory, filename));
  const packed = entries(archive);
  const packageJson = packed.get("package/package.json");
  assert.ok(packageJson, `${filename} does not contain package/package.json.`);
  const metadata = JSON.parse(packageJson.toString("utf8"));
  assert.equal(typeof metadata.name, "string", `${filename} package name is invalid.`);
  assert.equal(typeof metadata.version, "string", `${filename} package version is invalid.`);
  const identity = `${metadata.name}@${metadata.version}`;
  assert.ok(!archives.has(identity), `Multiple packed artifacts declare ${identity}.`);
  archives.set(identity, { filename, archive, packed, metadata });
}

const releasedIdentities = new Set();
const releaseArchives = new Map([...archives].filter(([identity]) => identity.endsWith(`@${releaseVersion}`)));
for (const release of releases) for (const expected of release.packages) {
  const expectedIdentity = `${expected.package}@${expected.version}`;
  releasedIdentities.add(expectedIdentity);
  const actual = releaseArchives.get(expectedIdentity);
  assert.ok(actual, `Release artifact for ${expected.package}@${expected.version} is missing.`);
  assert.equal(actual.metadata.version, expected.version, `Packed artifact version differs for ${expected.package}.`);
  assert.equal(`sha512-${createHash("sha512").update(actual.archive).digest("base64")}`, expected.integrity, `Packed artifact digest differs for ${expected.package}.`);

  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependency, specifier] of Object.entries(actual.metadata[section] ?? {})) {
      assert.equal(typeof specifier, "string", `${expected.package} ${section}.${dependency} must be a string.`);
      assert.ok(!workspaceSpecifier.test(specifier), `${expected.package} has a non-release ${section} specifier for ${dependency}.`);
      if (dependency.startsWith("@k-nex/")) {
        const dependencyArtifact = releaseArchives.get(`${dependency}@${specifier}`);
        assert.ok(dependencyArtifact, `${expected.package} depends on ${dependency}, but no packed release artifact exists.`);
        assert.equal(specifier, dependencyArtifact.metadata.version, `${expected.package} must depend on the exact packed ${dependency} version.`);
      }
    }
  }
}

assert.deepEqual([...releaseArchives.keys()].filter((identity) => identity.startsWith("@k-nex/")).sort(), [...releasedIdentities].sort(), `Packed release ${releaseVersion} closure and manifest package sets differ.`);
for (const identity of releasedIdentities) assert.match(identity, new RegExp(`@${releaseVersion.replaceAll(".", "\\.")}$`, "u"), `First-party packed identity must remain v${releaseVersion}: ${identity}`);
for (const release of releases) for (const lock of Object.values(release.factoryLockTemplates)) {
  const filename = `factory-lock-sales-reference-${lock.theme}-${lock.digest.slice(7)}.yaml`;
  const content = readFileSync(resolve(artifactDirectory, filename));
  assert.equal(`sha256:${createHash("sha256").update(content).digest("hex")}`, lock.digest, `Factory lock digest differs for ${lock.theme}.`);
}
const salesServer = releaseArchives.get(`@k-nex/module-sales@${releaseVersion}`)?.packed.get("package/dist/server.js")?.toString("utf8");
assert.ok(salesServer, "Packed Sales server entrypoint is missing.");
const runtimeImports = [...salesServer.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@k-nex\/runtime["']/gu)]
  .flatMap((match) => match[1].split(",").map((binding) => binding.trim().split(/\s+as\s+/u)[0]));
const runtimeExports = exportedNames(releaseArchives.get(`@k-nex/runtime@${releaseVersion}`).packed, "package/dist/index.js");
assert.ok(runtimeImports.length > 0, "Packed Sales server must import its runtime ABI explicitly.");
for (const name of runtimeImports) assert.ok(runtimeExports.has(name), `Packed @k-nex/runtime does not export ${name} required by packed Sales.`);
process.stdout.write("P8_PACKED_ABI_EXPORT_PASS\n");
process.stdout.write(`P8_PACKED_RELEASE_CLOSURE_PASS ${releasedIdentities.size}\n`);
