import { gunzipSync, gzipSync } from "node:zlib";

export type ArchiveEntry = Readonly<{ path: string; bytes: Uint8Array }>;
export type ExtractionLimits = Readonly<{ maxCompressedBytes: number; maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxPathDepth: number }>;

export const defaultExtractionLimits: ExtractionLimits = Object.freeze({
  maxCompressedBytes: 32 * 1024 * 1024,
  maxFiles: 512,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxPathDepth: 16
});

function fail(message: string): never { throw new Error(`Invalid extension archive: ${message}`); }

function safePath(path: string, maxPathDepth = Number.POSITIVE_INFINITY): string {
  const segments = path.split("/");
  if (!path || path.length > 256 || path.startsWith("/") || path.includes("\\") || segments.length > maxPathDepth || segments.some((segment) => !segment || segment === "." || segment === "..")) fail(`unsafe path ${JSON.stringify(path)}`);
  return path;
}

function casePath(path: string): string { return path.normalize("NFC").toLowerCase(); }

function octal(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]*$/u.test(text)) fail("invalid tar size");
  const value = Number.parseInt(text || "0", 8);
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid tar size");
  return value;
}

function checksum(header: Buffer): void {
  const claimed = octal(header.subarray(148, 156));
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  if (copy.reduce((sum, byte) => sum + byte, 0) !== claimed) fail("invalid tar checksum");
}

function writeString(target: Uint8Array, offset: number, width: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > width) throw new Error(`Tar field is too long: ${value}`);
  target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, width: number, value: number): void {
  const text = value.toString(8).padStart(width - 1, "0");
  writeString(target, offset, width - 1, text);
}

export function createNormalizedTarGz(entries: readonly ArchiveEntry[]): Buffer {
  const sorted = [...entries].map((entry) => ({ path: safePath(entry.path), bytes: Buffer.from(entry.bytes) })).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(sorted.map((entry) => entry.path)).size !== sorted.length) throw new Error("A normalized archive cannot contain duplicate paths.");
  if (new Set(sorted.map((entry) => casePath(entry.path))).size !== sorted.length) throw new Error("A normalized archive cannot contain case-colliding paths.");
  const chunks: Buffer[] = [];
  for (const entry of sorted) {
    const header = Buffer.alloc(512);
    writeString(header, 0, 100, entry.path);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.bytes.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    writeString(header, 257, 6, "ustar");
    writeString(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

export function extractNormalizedTarGz(archive: Uint8Array, limits: ExtractionLimits = defaultExtractionLimits): Map<string, Buffer> {
  if (archive.byteLength > limits.maxCompressedBytes) fail("compressed size exceeds limit");
  let tar: Buffer;
  try { tar = gunzipSync(archive, { maxOutputLength: limits.maxTotalBytes + limits.maxFiles * 1024 + 1024 }); } catch { fail("gzip payload is invalid or exceeds decompression limit"); }
  const files = new Map<string, Buffer>();
  const casePaths = new Set<string>();
  let offset = 0;
  let total = 0;
  while (offset < tar.length) {
    if (offset + 512 > tar.length) fail("truncated tar header");
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (tar.subarray(offset).some((byte) => byte !== 0)) fail("data follows tar terminator");
      break;
    }
    if (header.subarray(257, 263).toString("ascii") !== "ustar\0") fail("unsupported tar format");
    if (header.subarray(345, 500).some((byte) => byte !== 0)) fail("tar path prefixes are not allowed");
    checksum(header);
    const path = safePath(header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, ""), limits.maxPathDepth);
    const type = String.fromCharCode(header[156] ?? 0);
    if (type !== "\0" && type !== "0") fail(`unsupported tar entry type for ${path}`);
    const size = octal(header.subarray(124, 136));
    if (size > limits.maxFileBytes) fail(`file exceeds limit: ${path}`);
    if (files.size >= limits.maxFiles) fail("file count exceeds limit");
    total += size;
    if (total > limits.maxTotalBytes) fail("total size exceeds limit");
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) fail(`truncated file: ${path}`);
    if (files.has(path)) fail(`duplicate path: ${path}`);
    if (casePaths.has(casePath(path))) fail(`case-colliding path: ${path}`);
    files.set(path, Buffer.from(tar.subarray(bodyStart, bodyEnd)));
    casePaths.add(casePath(path));
    offset = bodyEnd + ((512 - (size % 512)) % 512);
  }
  if (files.size === 0) fail("archive contains no files");
  return files;
}
