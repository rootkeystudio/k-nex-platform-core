import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const sha256 = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;
const sha512 = (content) => `sha512-${createHash("sha512").update(content).digest("base64")}`;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ?
  Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)])) : value;
const canonicalJson = (value) => `${JSON.stringify(canonical(value), null, 2)}\n`;

function packedIdentity(archive) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    const start = offset + 512;
    if (name === "package/package.json") {
      const { name: packageName, version } = JSON.parse(tar.subarray(start, start + size).toString("utf8"));
      return `${packageName}@${version}`;
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("Packed release artifact lacks package/package.json.");
}

function artifactName(packageName, version) {
  return `${packageName.slice(1).replace("/", "-")}-${version}.tgz`;
}

export function bundledFile(bundle, path) {
  const file = bundle.files.find((entry) => entry.path === path);
  assert.ok(file, `Signed application bundle is missing ${path}.`);
  const content = Buffer.from(file.content, "base64");
  assert.equal(file.digest, sha256(content), `Signed application bundle has an invalid digest for ${path}.`);
  return content;
}

export function assertPhase8ReleaseSnapshot(root, bundle) {
  assert.match(bundle.sourceCommit, /^[0-9a-f]{40}$/u, "Phase 8 source commit metadata must be a full SHA.");
  const manifestPath = resolve(root, `releases/${bundle.release}/package-release-manifest.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(bundle.releaseManifestDigest, sha256(canonicalJson(manifest)), `Release ${bundle.release} manifest differs from the signed application bundle.`);

  const expectedPaths = manifest.packages.map(({ package: packageName, version }) => `packages/${artifactName(packageName, version)}`).sort();
  const bundledPaths = bundle.files.map(({ path }) => path).filter((path) => /^packages\/[^/]+\.tgz$/u.test(path)).sort();
  assert.deepEqual(bundledPaths, expectedPaths, `Release ${bundle.release} package set differs from the signed application bundle.`);
  for (const expected of manifest.packages) {
    const name = artifactName(expected.package, expected.version);
    const bundled = bundledFile(bundle, `packages/${name}`);
    const repository = readFileSync(resolve(root, "fixtures/customer-gate-1/packages", name));
    assert.ok(repository.equals(bundled), `${name} differs from the signed application bundle.`);
    assert.equal(sha512(repository), expected.integrity, `${name} has an invalid release-manifest integrity.`);
    assert.equal(packedIdentity(repository), `${expected.package}@${expected.version}`, `${name} has the wrong package identity.`);
  }
}
