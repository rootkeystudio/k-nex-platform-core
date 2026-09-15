import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { assertExactReleasePackageSet, officialFirstPartyPackages } from "./lib/release-train.mjs";

const root = resolve(import.meta.dirname, "..");
const oldManifestPath = resolve(root, "releases/1.0.0/package-release-manifest.json");
const targetManifestPath = resolve(root, "releases/1.1.0/package-release-manifest.json");
const mirror = resolve(root, "fixtures/customer-gate-1/packages");

function archivePackageJson(archive) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    if (name === "package/package.json") return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString("utf8"));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Archive has no package manifest.");
}

test("accepted 1.0 release manifest remains byte-identical while 1.1 is complete", () => {
  const oldManifest = readFileSync(oldManifestPath);
  assert.equal(createHash("sha256").update(oldManifest).digest("hex"), "1d8b40e0073fb24d42f47bc3a0fd763db0a0fb5baf706120f7fe3a2768c13eea");

  const targetManifest = JSON.parse(readFileSync(targetManifestPath, "utf8"));
  assert.equal(targetManifest.framework.core, "1.1.0");
  assert.equal(targetManifest.framework.payload, "3.88.0");
  assert.equal(targetManifest.framework.node, "24.19.0");
  assertExactReleasePackageSet(targetManifest.packages, "1.1.0");
  assert.deepEqual(targetManifest.packages.map(({ package: name }) => name), [...officialFirstPartyPackages].sort((left, right) => left.localeCompare(right)));
  const currentGraph = JSON.parse(readFileSync(resolve(root, "fixtures/customer-gate-1/.k-nex/generated/k-nex.resolved.json"), "utf8"));
  assert.deepEqual(currentGraph.framework, targetManifest.framework);
  for (const entry of targetManifest.packages) {
    const filename = `${entry.package.replace(/^@k-nex\//u, "k-nex-")}-1.1.0.tgz`;
    const archive = readFileSync(resolve(mirror, filename));
    assert.equal(entry.integrity, `sha512-${createHash("sha512").update(archive).digest("base64")}`, filename);
    const metadata = archivePackageJson(archive);
    assert.equal(metadata.name, entry.package);
    assert.equal(metadata.version, "1.1.0");
    assert.deepEqual(entry.peerCompatibility, targetManifest.framework);
  }
});

test("release train closure rejects an omitted package", () => {
  const incomplete = officialFirstPartyPackages.slice(0, -1).map((name) => ({ package: name, version: "1.1.0" }));
  assert.throws(() => assertExactReleasePackageSet(incomplete, "1.1.0"), /missing=@k-nex\/ui-runtime/u);
});
