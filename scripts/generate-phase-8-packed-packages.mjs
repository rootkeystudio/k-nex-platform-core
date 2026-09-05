import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gunzipSync, gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "fixtures/customer-gate-1/packages");
const blockSize = 512;
const canonicalMtime = 499_162_500; // npm's fixed 1985-10-26 package timestamp.
const maxTarBytes = 64 * 1024 * 1024;

function packageRoot(name) {
  if (name === "@k-nex/module-sales") return resolve(root, "modules/sales");
  if (name === "@k-nex/provider-realtime-socketio") return resolve(root, "packages/realtime-socketio");
  return resolve(root, "packages", name.replace("@k-nex/", ""));
}

function readTarString(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  const value = field.subarray(0, end < 0 ? field.length : end);
  if ([...value].some((byte) => byte < 0x20 || byte > 0x7e) || (end >= 0 && field.subarray(end).some((byte) => byte !== 0))) {
    throw new Error("Packed archive contains a non-canonical tar string.");
  }
  return value.toString("ascii");
}

function readTarOctal(header, offset, length) {
  const value = header.subarray(offset, offset + length).toString("ascii").replace(/[\0 ]+$/u, "");
  if (!/^[0-7]+$/u.test(value)) throw new Error("Packed archive contains an invalid tar number.");
  return Number.parseInt(value, 8);
}

function writeTarString(header, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > length) throw new Error(`Packed path cannot fit a ustar header: ${value}`);
  bytes.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0") + " ";
  if (encoded.length !== length) throw new Error("Packed archive value cannot fit a ustar header.");
  header.write(encoded, offset, length, "ascii");
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`Packed path cannot fit a ustar header: ${path}`);
}

function parseTar(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: maxTarBytes });
  const entries = [];
  const paths = new Set();
  let offset = 0;
  while (offset + blockSize <= tar.length && !tar.subarray(offset, offset + blockSize).every((byte) => byte === 0)) {
    const header = tar.subarray(offset, offset + blockSize);
    const checksum = readTarOctal(header, 148, 8);
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte), 0);
    if (checksum !== actualChecksum) throw new Error("Packed archive contains an invalid tar checksum.");
    if (readTarString(header, 257, 6) !== "ustar" || readTarString(header, 263, 2) !== "00") {
      throw new Error("Packed archive is not ustar.");
    }
    const prefix = readTarString(header, 345, 155);
    const name = readTarString(header, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    if (!path.startsWith("package/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Packed archive contains an unsafe path: ${path}`);
    }
    if (paths.has(path)) throw new Error(`Packed archive contains a duplicate path: ${path}`);
    paths.add(path);
    const type = readTarString(header, 156, 1);
    if (type !== "0" && type !== "") throw new Error(`Packed archive contains unsupported entry type ${type}: ${path}`);
    const size = readTarOctal(header, 124, 12);
    const dataOffset = offset + blockSize;
    const nextOffset = dataOffset + Math.ceil(size / blockSize) * blockSize;
    if (!Number.isSafeInteger(size) || nextOffset > tar.length) throw new Error(`Packed archive contains an invalid size: ${path}`);
    if (tar.subarray(dataOffset + size, nextOffset).some((byte) => byte !== 0)) throw new Error(`Packed archive contains non-zero padding: ${path}`);
    entries.push({ path, mode: readTarOctal(header, 100, 8), data: tar.subarray(dataOffset, dataOffset + size) });
    offset = nextOffset;
  }
  if (tar.length - offset < blockSize * 2 || tar.subarray(offset).some((byte) => byte !== 0)) {
    throw new Error("Packed archive has an invalid tar trailer.");
  }
  if (!paths.has("package/package.json")) throw new Error("Packed archive has no package manifest.");
  return entries.filter(({ path }) => !path.endsWith(".tsbuildinfo"));
}

function tarHeader(entry) {
  const header = Buffer.alloc(blockSize);
  const { name, prefix } = splitTarPath(entry.path);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, entry.mode & 0o111 ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, entry.data.length);
  writeTarOctal(header, 136, 12, canonicalMtime);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  writeTarString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  header.write(`${checksum}\0 `, 148, 8, "ascii");
  return header;
}

export function canonicalArchive(archive) {
  if (archive.length < 10 || !archive.subarray(0, 3).equals(Buffer.from([0x1f, 0x8b, 0x08]))) throw new Error("pnpm pack did not produce gzip.");
  const entries = parseTar(archive).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const blocks = [];
  for (const entry of entries) {
    blocks.push(tarHeader(entry), entry.data);
    const padding = entry.data.length % blockSize;
    if (padding) blocks.push(Buffer.alloc(blockSize - padding));
  }
  blocks.push(Buffer.alloc(blockSize * 2));
  const canonical = gzipSync(Buffer.concat(blocks), { level: constants.Z_BEST_COMPRESSION });
  canonical[9] = 0xff;
  return canonical;
}

export function rebuildPackage(directory) {
  if (!existsSync(resolve(directory, "tsconfig.json"))) return;
  rmSync(resolve(directory, "dist"), { recursive: true, force: true });
  execFileSync("pnpm", ["run", "build", "--force"], { cwd: directory, stdio: "inherit" });
}

function pack(directory, expectedFilename) {
  rebuildPackage(directory);
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

function main() {
  const release = JSON.parse(readFileSync(resolve(root, "releases/1.0.0/package-release-manifest.json"), "utf8"));
  for (const entry of new Map([...release.packages, { package: "@k-nex/extension-bundler", version: "1.0.0" }].map((entry) => [entry.package, entry])).values()) {
    if (entry.package === "@k-nex/module-sales") continue;
    const filename = `${entry.package.replace(/^@k-nex\//u, "k-nex-")}-${entry.version}.tgz`;
    pack(packageRoot(entry.package), filename);
  }

  for (const version of ["1.0.0"]) {
    const source = resolve(root, `releases/sources/sales-${version}`);
    const metadata = JSON.parse(readFileSync(resolve(source, "release-source.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(resolve(source, "package.json"), "utf8"));
    assert.equal(metadata.version, version);
    assert.equal(manifest.name, "@k-nex/module-sales");
    assert.equal(manifest.version, version);
    assert.equal(version, "1.0.0");
    pack(source, `k-nex-module-sales-${version}.tgz`);
  }

  process.stdout.write(`P8_PACKED_RELEASES_GENERATED ${release.packages.length}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
