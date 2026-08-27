import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const runGit = (root, args, options = {}) => execFileSync("git", args, { cwd: root, ...options });
const sha512 = (content) => `sha512-${createHash("sha512").update(content).digest("base64")}`;
const phaseSevenFinal = "9056043602fc046537978167e4f23bfcb53c1616";
const releaseManifest = /^releases\/[^/]+\/package-release-manifest\.json$/u;
const artifact = /^fixtures\/customer-gate-1\/packages\/[^/]+\.tgz$/u;

function trackedPaths(root, revision, pattern) {
  return runGit(root, ["ls-tree", "-r", "--name-only", revision], { encoding: "utf8" })
    .split("\n").filter((path) => pattern.test(path)).sort();
}

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

export function sourceFile(root, sourceCommit, path) {
  return runGit(root, ["show", `${sourceCommit}:${path}`], { maxBuffer: 4 * 1024 * 1024 });
}

export function assertPhase8SourceTopology(root, sourceCommit, finalHead = "HEAD") {
  assert.match(sourceCommit, /^[0-9a-f]{40}$/u, "Phase 8 source commit must be a full SHA.");
  runGit(root, ["cat-file", "-e", `${sourceCommit}^{commit}`]);
  const isAncestor = (base, head) => {
    try {
      runGit(root, ["merge-base", "--is-ancestor", base, head]);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(isAncestor(sourceCommit, finalHead), "Phase 8 source commit must be an ancestor of the final head.");
  assert.ok(isAncestor(phaseSevenFinal, sourceCommit), "Phase 8 source commit must descend from the Phase 7 final base.");
}

export function assertPhase8SourceRelease(root, sourceCommit, finalHead = "HEAD") {
  assertPhase8SourceTopology(root, sourceCommit, finalHead);
  const currentManifests = readdirSync(resolve(root, "releases"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => `releases/${name}/package-release-manifest.json`).sort();
  const sourceManifests = trackedPaths(root, sourceCommit, releaseManifest);
  assert.deepEqual(sourceManifests, currentManifests, "Source release manifest set differs from the final tree.");

  const sourceArtifacts = trackedPaths(root, sourceCommit, artifact);
  const currentArtifacts = readdirSync(resolve(root, "fixtures/customer-gate-1/packages"))
    .filter((name) => name.endsWith(".tgz")).map((name) => `fixtures/customer-gate-1/packages/${name}`).sort();
  assert.deepEqual(sourceArtifacts, currentArtifacts, "Source artifact set differs from the final tree.");

  const artifacts = new Map();
  for (const path of sourceArtifacts) {
    const source = sourceFile(root, sourceCommit, path);
    assert.ok(readFileSync(resolve(root, path)).equals(source), `${path} differs from source commit.`);
    const identity = packedIdentity(source);
    assert.ok(!artifacts.has(identity), `Source has duplicate packed artifact ${identity}.`);
    artifacts.set(identity, source);
  }
  const released = new Set();
  for (const path of currentManifests) {
    const source = sourceFile(root, sourceCommit, path);
    assert.ok(readFileSync(resolve(root, path)).equals(source), `${path} differs from source commit.`);
    for (const expected of JSON.parse(source.toString("utf8")).packages) {
      const identity = `${expected.package}@${expected.version}`;
      const packed = artifacts.get(identity);
      assert.ok(packed, `Source release artifact ${identity} is missing.`);
      assert.equal(sha512(packed), expected.integrity, `Source release artifact ${identity} has an invalid integrity hash.`);
      released.add(identity);
    }
  }
  assert.deepEqual([...artifacts.keys()].sort(), [...released].sort(), "Source release artifacts and manifests differ.");
}
