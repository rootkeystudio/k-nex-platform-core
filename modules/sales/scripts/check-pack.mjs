import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const packageRoot = resolve(import.meta.dirname, "..");
const firstTemporaryRoot = mkdtempSync(join(tmpdir(), "k-nex-module-sales-pack-first-"));
const secondTemporaryRoot = mkdtempSync(join(tmpdir(), "k-nex-module-sales-pack-second-"));
const filename = "k-nex-module-sales-1.0.0.tgz";

function tarEntries(archive) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || name.length === 0 || entries.has(name)) {
      throw new Error("Packed Sales tar metadata is invalid.");
    }
    const contentStart = offset + 512;
    if (contentStart + size > archive.length) throw new Error("Packed Sales tar content is truncated.");
    entries.set(name, archive.subarray(contentStart, contentStart + size));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function canonicalPackageArchive(archive) {
  assert.ok(archive.length >= 10, "Packed Sales gzip archive is truncated.");
  assert.deepEqual([...archive.subarray(0, 3)], [0x1f, 0x8b, 0x08], "Packed Sales archive must use gzip.");
  const canonical = gzipSync(gunzipSync(archive), { level: 6, mtime: 0 });
  canonical[9] = 0xff;
  return canonical;
}

function assertDeclaredEntrypoints(archive) {
  const entries = tarEntries(archive);
  const packageJson = JSON.parse(entries.get("package/package.json")?.toString("utf8") ?? "null");
  assert.equal(Object.hasOwn(packageJson.exports, "."), false);

  const expectedFiles = new Set(["package/package.json"]);
  for (const value of Object.values(packageJson.exports)) {
    for (const target of typeof value === "string" ? [value] : Object.values(value)) {
      expectedFiles.add(`package/${target.replace(/^\.\//, "")}`);
    }
  }
  assert.deepEqual([...entries.keys()].sort(), [...expectedFiles].sort());
}

try {
  execFileSync("pnpm", ["pack", "--pack-destination", firstTemporaryRoot], { cwd: packageRoot, stdio: "ignore" });
  execFileSync("pnpm", ["pack", "--pack-destination", secondTemporaryRoot], { cwd: packageRoot, stdio: "ignore" });
  const firstArchive = readFileSync(join(firstTemporaryRoot, filename));
  const secondArchive = readFileSync(join(secondTemporaryRoot, filename));
  const committedArchive = readFileSync(resolve(packageRoot, "../../fixtures/customer-gate-1/packages", filename));
  assert.equal(firstArchive.equals(secondArchive), true, "Consecutive Sales package archives are not byte-reproducible.");
  assert.equal(committedArchive.equals(canonicalPackageArchive(committedArchive)), true, "The committed Sales package archive must use the cross-platform gzip OS marker.");
  const generated = gunzipSync(firstArchive);
  const committed = gunzipSync(committedArchive);
  assertDeclaredEntrypoints(generated);
  assertDeclaredEntrypoints(committed);
  console.log("The live Sales package is reproducible and the committed release archive is canonical.");
} finally {
  rmSync(firstTemporaryRoot, { recursive: true, force: true });
  rmSync(secondTemporaryRoot, { recursive: true, force: true });
}
