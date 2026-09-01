import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const packedPackages = readdirSync(artifacts).filter((name) => /^k-nex-.*-1\.0\.0\.tgz$/u.test(name)).map((name) => {
  const archive = readFileSync(resolve(artifacts, name));
  const manifest = packageJson(archive);
  const role = manifest.name.startsWith("@k-nex/theme-") ? "theme" : manifest.name.startsWith("@k-nex/provider-") ? "provider" :
    manifest.name.startsWith("@k-nex/module-") ? "plugin" : manifest.name.includes("builder") ? "builder" : "core";
  return {
    package: manifest.name, version: (() => { if (manifest.version !== "1.0.0") throw new Error(`First-party packed artifact must be v1.0.0: ${manifest.name}@${manifest.version}`); return manifest.version; })(), role,
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    peerCompatibility: supportedFrameworkTuple
  };
}).sort((left, right) => left.package.localeCompare(right.package) || left.version.localeCompare(right.version));

const releases = [{ version: "1.0.0", salesVersion: "1.0.0", supportedReleases: ["1.0.0"] }];

for (const { version, salesVersion, supportedReleases } of releases) {
  const packages = packedPackages.filter((entry) => entry.package !== "@k-nex/module-sales" || entry.version === salesVersion);
  if (!packages.some((entry) => entry.package === "@k-nex/module-sales")) throw new Error(`Sales ${salesVersion} packed artifact is missing.`);
  const manifest = PackageReleaseManifestSchema.parse({
    $schema: "../../schemas/package-release-manifest.v1.schema.json", schemaVersion: 1,
    release: { version, channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" },
    framework: supportedFrameworkTuple, packages,
    supportWindow: { policy: "single-current-release", supportedReleases, securityFixes: "all-supported-releases" }
  });
  mkdirSync(resolve(root, `releases/${version}`), { recursive: true });
  writeFileSync(resolve(root, `releases/${version}/package-release-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
process.stdout.write(`P8_RELEASE_MANIFESTS_GENERATED ${releases.length}x${packedPackages.length}\n`);
