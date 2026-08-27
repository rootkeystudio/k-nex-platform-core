import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const artifactDirectory = resolve(root, "fixtures/customer-gate-1/packages");
const release = JSON.parse(readFileSync(resolve(root, "releases/0.2.0/package-release-manifest.json"), "utf8"));
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

function packageRoot(name) {
  if (name === "@k-nex/module-sales") return resolve(root, "modules/sales");
  if (name === "@k-nex/provider-realtime-socketio") return resolve(root, "packages/realtime-socketio");
  return resolve(root, "packages", name.replace("@k-nex/", ""));
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
  assert.ok(!archives.has(metadata.name), `Multiple packed artifacts declare ${metadata.name}.`);
  archives.set(metadata.name, { filename, archive, packed, metadata });
}

const releasedNames = new Set();
for (const expected of release.packages) {
  assert.ok(!releasedNames.has(expected.package), `Release manifest duplicates ${expected.package}.`);
  releasedNames.add(expected.package);
  const actual = archives.get(expected.package);
  assert.ok(actual, `Release artifact for ${expected.package}@${expected.version} is missing.`);
  assert.equal(actual.metadata.version, expected.version, `Packed artifact version differs for ${expected.package}.`);
  assert.equal(`sha512-${createHash("sha512").update(actual.archive).digest("base64")}`, expected.integrity, `Packed artifact digest differs for ${expected.package}.`);

  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependency, specifier] of Object.entries(actual.metadata[section] ?? {})) {
      assert.equal(typeof specifier, "string", `${expected.package} ${section}.${dependency} must be a string.`);
      assert.ok(!workspaceSpecifier.test(specifier), `${expected.package} has a non-release ${section} specifier for ${dependency}.`);
      if (dependency.startsWith("@k-nex/")) {
        const dependencyArtifact = archives.get(dependency);
        assert.ok(dependencyArtifact, `${expected.package} depends on ${dependency}, but no packed release artifact exists.`);
        assert.equal(specifier, dependencyArtifact.metadata.version, `${expected.package} must depend on the exact packed ${dependency} version.`);
      }
    }
  }

  const source = packageRoot(expected.package);
  for (const [name, content] of actual.packed) {
    if (!/^package\/dist\/.*\.(?:js|d\.ts)$/u.test(name)) continue;
    assert.ok(content.equals(readFileSync(resolve(source, name.slice("package/".length)))), `Packed runtime export ${expected.package}:${name} is stale.`);
  }
}

assert.deepEqual([...archives.keys()].filter((name) => name.startsWith("@k-nex/")).sort(), [...releasedNames].sort(), "Packed release closure and manifest package sets differ.");
process.stdout.write(`P8_PACKED_RELEASE_CLOSURE_PASS ${release.packages.length}\n`);
