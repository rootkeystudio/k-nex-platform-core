import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { canonicalArchive, rebuildPackage } from "./generate-phase-8-packed-packages.mjs";

const fixture = readFileSync(resolve(import.meta.dirname, "../fixtures/customer-gate-1/packages/k-nex-contracts-1.0.0.tgz"));

function entries(archive) {
  const tar = gunzipSync(archive);
  const result = [];
  for (let offset = 0; !tar.subarray(offset, offset + 512).every((byte) => byte === 0);) {
    const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString("ascii").replace(/[\0 ]+$/u, ""), 8);
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    result.push(Buffer.from(tar.subarray(offset, end)));
    offset = end;
  }
  return result;
}

function tarChecksum(entry) {
  entry.fill(0x20, 148, 156);
  const checksum = entry.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  entry.write(`${checksum}\0 `, 148, 8, "ascii");
}

test("packed archives canonicalize platform metadata, order, and build caches", () => {
  const changed = entries(fixture).reverse();
  let buildInfo = changed.find((entry) => entry.subarray(0, 100).toString("ascii").replace(/\0.*$/su, "").endsWith("tsconfig.tsbuildinfo"));
  if (!buildInfo) {
    buildInfo = Buffer.from(changed[0]);
    buildInfo.fill(0, 0, 100);
    buildInfo.write("package/dist/tsconfig.tsbuildinfo", 0, "ascii");
    tarChecksum(buildInfo);
    changed.push(buildInfo);
  }
  buildInfo.fill(0x78, 512, 520);

  const header = changed.find((entry) => entry !== buildInfo);
  header.write("0000664 ", 100, 8, "ascii");
  header.write("000123 ", 108, 8, "ascii");
  header.write("000456 ", 116, 8, "ascii");
  header.write("00000000001 ", 136, 12, "ascii");
  header.write("linux", 265, 5, "ascii");
  header.write("runner", 297, 6, "ascii");
  tarChecksum(header);

  const variant = gzipSync(Buffer.concat([...changed, Buffer.alloc(1024)]));
  variant[9] = 0x03;
  assert.deepEqual(canonicalArchive(variant), canonicalArchive(fixture));
  assert.equal(gunzipSync(canonicalArchive(fixture)).includes(Buffer.from("tsconfig.tsbuildinfo")), false);

  const unsafe = entries(fixture);
  unsafe[0].write("../escape", 0, 9, "ascii");
  tarChecksum(unsafe[0]);
  assert.throws(() => canonicalArchive(gzipSync(Buffer.concat([...unsafe, Buffer.alloc(1024)]))), /unsafe path/u);
});

test("packed TypeScript packages rebuild from a clean output directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "k-nex-phase-8-pack-build-"));
  try {
    writeFileSync(resolve(directory, "package.json"), JSON.stringify({ type: "module", scripts: { build: "node build.mjs" } }));
    writeFileSync(resolve(directory, "tsconfig.json"), "{}\n");
    writeFileSync(resolve(directory, "build.mjs"), 'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist", { recursive: true }); writeFileSync("dist/current.js", "current\\n");\n');
    mkdirSync(resolve(directory, "dist"));
    writeFileSync(resolve(directory, "dist/stale.js"), "stale\n");

    rebuildPackage(directory);

    assert.equal(existsSync(resolve(directory, "dist/stale.js")), false);
    assert.equal(readFileSync(resolve(directory, "dist/current.js"), "utf8"), "current\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
