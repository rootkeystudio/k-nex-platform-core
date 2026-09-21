import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const packageRoot = resolve(import.meta.dirname, "..");
const filename = "k-nex-provider-realtime-socketio-1.0.0.tgz";

function tarEntries(archive) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || name.length === 0 || entries.has(name)) throw new Error("Packed realtime provider tar metadata is invalid.");
    const contentStart = offset + 512;
    if (contentStart + size > archive.length) throw new Error("Packed realtime provider tar content is truncated.");
    entries.set(name, archive.subarray(contentStart, contentStart + size));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const archivePath = resolve(packageRoot, "../../fixtures/customer-gate-1/packages", filename);
const archive = readFileSync(archivePath);
const release = JSON.parse(readFileSync(resolve(packageRoot, "../../releases/1.0.0/package-release-manifest.json"), "utf8"));
const entry = release.packages?.find((candidate) => candidate?.package === "@k-nex/provider-realtime-socketio");
assert.equal(entry?.version, "1.0.0");
assert.equal(entry?.integrity, `sha512-${createHash("sha512").update(archive).digest("base64")}`);
const entries = tarEntries(gunzipSync(archive));
assert.deepEqual([...entries.keys()].sort(), ["package/dist/index.d.ts", "package/dist/index.d.ts.map", "package/dist/index.js", "package/dist/index.js.map", "package/dist/server.d.ts", "package/dist/server.d.ts.map", "package/dist/server.js", "package/dist/server.js.map", "package/k-nex.plugin.json", "package/package.json"]);
const manifestEntry = entries.get("package/k-nex.plugin.json");
assert.ok(manifestEntry);
const manifest = JSON.parse(manifestEntry.toString("utf8"));
assert.deepEqual({ id: manifest.id, version: manifest.version, package: manifest.package }, { id: "provider.realtime.socketio", version: "1.0.0", package: "@k-nex/provider-realtime-socketio" });
console.log("The immutable 1.0.0 realtime provider archive matches release evidence.");
