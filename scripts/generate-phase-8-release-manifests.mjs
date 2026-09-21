import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { assertExactReleasePackageSet, releaseFrameworkTuple } from "./lib/release-train.mjs";

import { PackageReleaseManifestSchema, canonicalJson, supportedFrameworkTuple } from "../packages/contracts/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "fixtures/customer-gate-1/packages");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const result = args[index + 1];
  if (result === undefined || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
};
const releaseVersion = value("--version", "1.0.0");
if (!/^\d+\.\d+\.\d+$/u.test(releaseVersion) || args.some((arg, index) => arg.startsWith("--") && !["--version"].includes(arg) || arg === "--version" && (index === args.length - 1 || args[index + 1]?.startsWith("--")))) {
  throw new Error("Usage: generate-phase-8-release-manifests.mjs [--version <semver>]");
}

function factoryLockTemplates() {
  return Object.fromEntries(["minimal", "neobrutalism"].map((theme) => {
    const matches = readdirSync(artifacts).filter((name) => new RegExp(`^factory-lock-sales-reference-${theme}-[0-9a-f]{64}\\.yaml$`, "u").test(name));
    const versioned = matches.filter((name) => readFileSync(resolve(artifacts, name), "utf8").includes(`-${releaseVersion}.tgz`));
    if (versioned.length !== 1) throw new Error(`Expected exactly one ${releaseVersion} ${theme} factory lock template.`);
    const content = readFileSync(resolve(artifacts, versioned[0]));
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (!versioned[0].endsWith(`${digest.slice(7)}.yaml`)) throw new Error(`Factory lock filename digest differs for ${releaseVersion} ${theme}.`);
    return [theme, { preset: "sales-reference", theme, digest }];
  }));
}

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

const releaseFramework = releaseFrameworkTuple(releaseVersion, supportedFrameworkTuple);
const packedPackages = readdirSync(artifacts).filter((name) => new RegExp(`^k-nex-.*-${releaseVersion.replaceAll(".", "\\.")}\\.tgz$`, "u").test(name)).map((name) => {
  const archive = readFileSync(resolve(artifacts, name));
  const manifest = packageJson(archive);
  const role = manifest.name.startsWith("@k-nex/theme-") ? "theme" : manifest.name.startsWith("@k-nex/provider-") ? "provider" :
    manifest.name.startsWith("@k-nex/module-") ? "plugin" : manifest.name.includes("builder") ? "builder" : "core";
  return {
    package: manifest.name, version: (() => { if (manifest.version !== releaseVersion) throw new Error(`First-party packed artifact must be v${releaseVersion}: ${manifest.name}@${manifest.version}`); return manifest.version; })(), role,
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    peerCompatibility: releaseFramework
  };
}).sort((left, right) => left.package.localeCompare(right.package) || left.version.localeCompare(right.version));
assertExactReleasePackageSet(packedPackages, releaseVersion);

const releases = [{ version: releaseVersion, salesVersion: releaseVersion, supportedReleases: [releaseVersion] }];

for (const { version, salesVersion, supportedReleases } of releases) {
  const packages = packedPackages.filter((entry) => entry.package !== "@k-nex/module-sales" || entry.version === salesVersion);
  if (!packages.some((entry) => entry.package === "@k-nex/module-sales")) throw new Error(`Sales ${salesVersion} packed artifact is missing.`);
  const manifest = PackageReleaseManifestSchema.parse({
    $schema: "../../schemas/package-release-manifest.v1.schema.json", schemaVersion: 1,
    release: { version, channel: "current", versioningPolicy: "semver-v1", compatibilityPolicy: "exact-framework-tuple" },
    framework: releaseFramework, packages, factoryLockTemplates: factoryLockTemplates(),
    supportWindow: { policy: "single-current-release", supportedReleases, securityFixes: "all-supported-releases" }
  });
  mkdirSync(resolve(root, `releases/${version}`), { recursive: true });
  writeFileSync(resolve(root, `releases/${version}/package-release-manifest.json`), canonicalJson(manifest), "utf8");
}
process.stdout.write(`P8_RELEASE_MANIFESTS_GENERATED ${releaseVersion} ${releases.length}x${packedPackages.length}\n`);
