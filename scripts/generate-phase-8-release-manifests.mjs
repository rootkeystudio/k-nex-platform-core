import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { PackageReleaseManifestSchema, supportedFrameworkTuple } from "../packages/contracts/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "fixtures/customer-gate-1/packages");

function packageJson(archive) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim() || "0", 8);
    const start = offset + 512;
    if (name === "package/package.json") return JSON.parse(tar.subarray(start, start + size).toString("utf8"));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("Packed release artifact lacks package/package.json.");
}

const packages = readdirSync(artifacts).filter((name) => /^k-nex-.*\.tgz$/u.test(name)).map((name) => {
  const archive = readFileSync(resolve(artifacts, name));
  const manifest = packageJson(archive);
  const role = manifest.name.startsWith("@k-nex/theme-") ? "theme" : manifest.name.startsWith("@k-nex/provider-") ? "provider" :
    manifest.name.startsWith("@k-nex/module-") ? "plugin" : manifest.name.includes("builder") ? "builder" : "core";
  return {
    package: manifest.name, version: manifest.version, role,
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    peerCompatibility: supportedFrameworkTuple
  };
}).sort((left, right) => left.package.localeCompare(right.package));

for (const [version, supportedReleases] of [["0.1.0", ["0.1.0"]], ["0.2.0", ["0.2.0", "0.1.0"]]]) {
  const manifest = PackageReleaseManifestSchema.parse({
    $schema: "../../schemas/package-release-manifest.v1.schema.json", schemaVersion: 1,
    release: { version, channel: "pre-v1", versioningPolicy: "semver-pre-v1", compatibilityPolicy: "exact-framework-tuple" },
    framework: supportedFrameworkTuple, packages,
    supportWindow: { policy: "current-and-one-prior-minor", supportedReleases, securityFixes: "all-supported-releases" }
  });
  writeFileSync(resolve(root, `releases/${version}/package-release-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
process.stdout.write(`P8_RELEASE_MANIFESTS_GENERATED ${packages.length}\n`);
