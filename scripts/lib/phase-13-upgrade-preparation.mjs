import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  ApplicationReleaseLockSchema,
  GeneratedFileOwnershipManifestSchema,
  canonicalApplicationReleaseLock,
  canonicalGeneratedFileOwnershipManifest,
  canonicalJson
} from "../../packages/contracts/dist/index.js";
import { applicationUpgradeCompilerDigests } from "../../packages/composition/dist/index.js";

export const phase13ReleaseControlPaths = Object.freeze([
  ".k-nex/application-plan.json", ".k-nex/generated-files.json", ".k-nex/package-release-manifest.json", ".k-nex/release-lock.json",
  "k-nex.app.json", "package.json", "pnpm-lock.yaml"
]);
const releaseControls = new Set(phase13ReleaseControlPaths);
const customerOwnedGeneratorPaths = new Set(["k-nex.config.ts"]);
const templatePaths = new Set([".env.example", "README.md"]);
const digestBytes = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const digestValue = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const archiveName = (entry) => `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;

export function ownershipFromFactoryPlan({ plan, release, previousOwnership }) {
  const prior = new Map(previousOwnership?.files.map((record) => [record.path, record]) ?? []);
  const files = Object.keys(plan.files).filter((path) => !releaseControls.has(path) && !path.startsWith(".k-nex/packages/") && !customerOwnedGeneratorPaths.has(path)).sort(compareCodeUnits).map((path) => {
    const bytes = new TextEncoder().encode(plan.files[path]);
    const mode = path.startsWith("src/migrations/") && path !== "src/migrations/index.ts" ? "append-only" : templatePaths.has(path) ? "template" : "managed";
    const historical = prior.get(path);
    if (mode === "append-only" && historical !== undefined) {
      if (historical.mode !== mode) throw new TypeError(`Target generator changed predecessor migration ownership ${path}.`);
      return historical;
    }
    return { path, mode, producer: { package: "@k-nex/runtime", version: release.release.version, generatorId: "sales-reference" }, digest: digestBytes(bytes) };
  });
  return GeneratedFileOwnershipManifestSchema.parse({ schemaVersion: 1, applicationId: plan.applicationId, files });
}

function selectedPlugins(plan, release) {
  const manifest = JSON.parse(plan.files["k-nex.app.json"]);
  const selections = [
    ...manifest.plugins.map(({ id, package: packageName }) => ({ id, package: packageName })),
    ...Object.values(manifest.providers).map(({ plugin: id, package: packageName }) => ({ id, package: packageName })),
    ...(manifest.builder === undefined ? [] : [{ id: manifest.builder.plugin, package: manifest.builder.package }]),
    { id: `theme.${manifest.themes.active}`, package: manifest.themes.package }
  ];
  const packages = new Map(release.packages.map((entry) => [entry.package, entry]));
  return [...new Map(selections.map((selection) => [selection.id, selection])).values()].sort((left, right) => compareCodeUnits(left.id, right.id)).map(({ id, package: packageName }) => {
    const entry = packages.get(packageName);
    if (entry === undefined) throw new TypeError(`Selected plugin package is absent from release: ${packageName}.`);
    return { id, package: packageName, version: entry.version, integrity: entry.integrity };
  });
}

export function releaseLockFromFactoryPlan({ plan, release, releaseManifestDigest, ownership, migrationSetDigest, transitionChain = [] }) {
  const runtime = release.packages.find((entry) => entry.package === "@k-nex/runtime");
  if (runtime === undefined) throw new TypeError("Release generator package is absent.");
  return ApplicationReleaseLockSchema.parse({
    schemaVersion: 1, applicationId: plan.applicationId, platformRelease: release.release.version, releaseManifestDigest,
    frameworkTupleDigest: digestValue(release.framework),
    packages: release.packages.map(({ package: packageName, version, role, integrity }) => ({ package: packageName, version, role, integrity })).sort((left, right) => compareCodeUnits(left.package, right.package)),
    plugins: selectedPlugins(plan, release), generator: { package: runtime.package, version: runtime.version, schemaVersion: release.release.version === "1.0.0" ? 1 : 2, generatorId: "sales-reference" },
    sourceOwnershipDigest: digestValue(ownership), migrationSetDigest, transitionChain
  });
}

export function targetGenerationFromFactoryPlan({ plan, release, releaseContent, releaseLock, ownership, packageMirror, previousFiles = {} }) {
  const controlFiles = {
    ".k-nex/application-plan.json": new TextEncoder().encode(plan.files[".k-nex/application-plan.json"]),
    ".k-nex/generated-files.json": new TextEncoder().encode(canonicalGeneratedFileOwnershipManifest(ownership)),
    ".k-nex/package-release-manifest.json": new TextEncoder().encode(releaseContent),
    ".k-nex/release-lock.json": new TextEncoder().encode(canonicalApplicationReleaseLock(releaseLock)),
    "k-nex.app.json": new TextEncoder().encode(plan.files["k-nex.app.json"]),
    "package.json": new TextEncoder().encode(plan.files["package.json"]),
    "pnpm-lock.yaml": new TextEncoder().encode(plan.files["pnpm-lock.yaml"])
  };
  for (const entry of releaseLock.packages) controlFiles[`.k-nex/packages/${archiveName(entry)}`] = new Uint8Array(readFileSync(resolve(packageMirror, archiveName(entry))));
  const files = Object.fromEntries(ownership.files.map((record) => {
    const historical = record.mode === "append-only" && record.producer.version !== release.release.version ? previousFiles[record.path] : undefined;
    if (historical !== undefined && historical.kind !== "file") throw new TypeError(`Historical append-only path is not a file: ${record.path}.`);
    return [record.path, historical === undefined ? new TextEncoder().encode(plan.files[record.path]) : new Uint8Array(historical.bytes)];
  }));
  return { files, ownership, releaseLock, controlFiles };
}

export function readRepositorySnapshot(root) {
  const result = {};
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort(compareCodeUnits)) {
      if (prefix === "" && (name === ".git" || name === "node_modules")) continue;
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) result[relative] = { kind: "symlink" };
      else if (stat.isDirectory()) visit(path, relative);
      else if (stat.isFile()) result[relative] = { kind: "file", bytes: new Uint8Array(readFileSync(path)) };
    }
  };
  visit(resolve(root));
  return result;
}

export function materializePreparedTreeAtomic(files, targetDirectory) {
  const target = resolve(targetDirectory); const staging = `${target}.staging`;
  rmSync(staging, { recursive: true, force: true });
  if (lstatSafe(target) !== undefined) throw new TypeError("Prepared target directory must not already exist.");
  try {
    mkdirSync(staging, { recursive: false });
    for (const path of Object.keys(files).sort(compareCodeUnits)) {
      const output = resolve(staging, path);
      if (!output.startsWith(`${staging}/`)) throw new TypeError(`Prepared path escapes target: ${path}.`);
      mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, files[path]);
    }
    renameSync(staging, target);
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
  return applicationUpgradeCompilerDigests.repository(readRepositorySnapshot(target));
}

function lstatSafe(path) { try { return lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return undefined; throw error; } }

export const phase13UpgradePreparationDigests = Object.freeze({ value: digestValue, bytes: digestBytes });
