import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const packageRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "k-nex-module-sales-pack-"));
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

function assertEquivalent(generated, committed) {
  const generatedEntries = tarEntries(generated);
  const committedEntries = tarEntries(committed);
  assert.deepEqual([...generatedEntries.keys()], [...committedEntries.keys()]);
  for (const [name, content] of generatedEntries) {
    const expected = committedEntries.get(name);
    if (expected === undefined) throw new Error(`Packed Sales entry ${name} is missing.`);
    if (name === "package/package.json") {
      assert.deepEqual(JSON.parse(content.toString("utf8")), JSON.parse(expected.toString("utf8")));
    } else if (!content.equals(expected)) {
      throw new Error(`Packed Sales entry ${name} is stale or non-deterministic.`);
    }
  }
}

function assertDeclaredEntrypoints(archive) {
  const entries = tarEntries(archive);
  const packageJson = JSON.parse(entries.get("package/package.json")?.toString("utf8") ?? "null");
  const entrypoints = ["./browser", "./contracts", "./manifest", "./migrations", "./server", "./testing", "./ui"];
  assert.deepEqual(Object.keys(packageJson.exports).sort(), entrypoints);

  const expectedFiles = new Set(["package/package.json"]);
  for (const value of Object.values(packageJson.exports)) {
    for (const target of typeof value === "string" ? [value] : Object.values(value)) {
      expectedFiles.add(`package/${target.replace(/^\.\//, "")}`);
    }
  }
  assert.deepEqual([...entries.keys()].sort(), [...expectedFiles].sort());
}

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporaryRoot], { cwd: packageRoot, stdio: "ignore" });
  const generated = gunzipSync(readFileSync(join(temporaryRoot, filename)));
  const committed = gunzipSync(readFileSync(resolve(packageRoot, "../../fixtures/customer-gate-1/packages", filename)));
  assertDeclaredEntrypoints(generated);
  assertEquivalent(generated, committed);
  console.log("The committed Sales package tar content is current and reproducible.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
