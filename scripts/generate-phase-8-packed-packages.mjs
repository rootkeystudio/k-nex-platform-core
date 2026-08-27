import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "fixtures/customer-gate-1/packages");
const release = JSON.parse(readFileSync(resolve(root, "releases/0.2.0/package-release-manifest.json"), "utf8"));

function packageRoot(name) {
  if (name === "@k-nex/module-sales") return resolve(root, "modules/sales");
  if (name === "@k-nex/provider-realtime-socketio") return resolve(root, "packages/realtime-socketio");
  return resolve(root, "packages", name.replace("@k-nex/", ""));
}

function canonicalArchive(archive) {
  if (archive.length < 10 || !archive.subarray(0, 3).equals(Buffer.from([0x1f, 0x8b, 0x08]))) throw new Error("pnpm pack did not produce gzip.");
  const canonical = Buffer.from(archive);
  canonical[9] = 0xff;
  return canonical;
}

function pack(directory, expectedFilename) {
  const first = mkdtempSync(join(tmpdir(), "k-nex-phase-8-pack-first-"));
  const second = mkdtempSync(join(tmpdir(), "k-nex-phase-8-pack-second-"));
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", first], { cwd: directory, stdio: "ignore" });
    execFileSync("pnpm", ["pack", "--pack-destination", second], { cwd: directory, stdio: "ignore" });
    const archive = readFileSync(resolve(first, expectedFilename));
    assert.equal(archive.equals(readFileSync(resolve(second, expectedFilename))), true, `${basename(expectedFilename)} is not byte-reproducible.`);
    writeFileSync(resolve(destination, expectedFilename), canonicalArchive(archive));
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
}

for (const entry of release.packages) {
  const filename = `${entry.package.replace(/^@k-nex\//u, "k-nex-")}-${entry.version}.tgz`;
  pack(packageRoot(entry.package), filename);
}

const salesRoot = packageRoot("@k-nex/module-sales");
const salesManifestPath = resolve(salesRoot, "package.json");
const salesManifestText = readFileSync(salesManifestPath, "utf8");
const salesManifest = JSON.parse(salesManifestText);
try {
  for (const version of ["0.9.0", "1.0.1"]) {
    writeFileSync(salesManifestPath, `${JSON.stringify({ ...salesManifest, version }, null, 2)}\n`, "utf8");
    pack(salesRoot, `k-nex-module-sales-${version}.tgz`);
  }
} finally {
  writeFileSync(salesManifestPath, salesManifestText, "utf8");
}

process.stdout.write(`P8_PACKED_RELEASES_GENERATED ${release.packages.length + 2}\n`);
