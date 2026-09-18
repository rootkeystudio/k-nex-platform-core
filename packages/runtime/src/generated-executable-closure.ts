import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { extractNormalizedTarGz } from "@k-nex/extension-bundler";

import { assertGeneratedMigrationClosure, type GeneratedMigrationClosure } from "./generated-migration-closure.js";
import { MigrationFenceError } from "./migration-fence.js";

/**
 * Several generated migrations are wrappers: the SQL they execute lives in
 * package code, and the guard that admits them executes from a package too. A
 * release manifest names the archives those implementations should come from,
 * but naming an archive is not evidence that the archive, or the module the
 * migration process will actually import, is the same bytes. Without this the
 * first thing to notice a drifted package implementation would be readiness,
 * long after a forward-only migration had already changed customer data.
 *
 * This is that proof, and it runs before Payload is allowed to select a single
 * pending migration: the manifest identifies the archives, each archive is
 * checked against the integrity the manifest declares, the selected factory
 * lock is checked against the digest the manifest declares, and every file the
 * archive carries is compared with the file installed under the same path. The
 * value it returns is what the completion receipt records, so a later boot is
 * measured against the executable closure rather than against a manifest file.
 */
const packageDirectory = ".k-nex/packages";
const releaseManifestPath = ".k-nex/package-release-manifest.json";
const lockPath = "pnpm-lock.yaml";
const archivePrefix = "package/";

/** Generated closures are whole released packages, not the small extension bundles the default limits size. */
const releaseArchiveLimits = Object.freeze({
  maxCompressedBytes: 64 * 1024 * 1024,
  maxFiles: 16_384,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxPathDepth: 32
});

export interface GeneratedExecutableClosure {
  readonly migration: GeneratedMigrationClosure;
  readonly release: string;
  readonly packages: readonly string[];
  readonly digest: string;
}

interface ReleaseManifestPackage {
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
}

function fail(message: string): never {
  throw new MigrationFenceError("MIGRATION_SET_MISMATCH", message);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function archiveName(name: string, version: string): string {
  return `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
}

function readManifest(root: string): { readonly source: Buffer; readonly release: string; readonly packages: readonly ReleaseManifestPackage[]; readonly locks: Readonly<Record<string, { readonly digest: string }>> } | undefined {
  const path = resolve(root, releaseManifestPath);
  if (!existsSync(path)) return undefined;
  const source = readFileSync(path);
  let value: {
    release?: { version?: unknown };
    packages?: readonly { package?: unknown; version?: unknown; integrity?: unknown }[];
    factoryLockTemplates?: Record<string, { digest?: unknown }>;
  };
  try {
    value = JSON.parse(source.toString("utf8")) as typeof value;
  } catch (error) {
    fail(`This application's package release manifest is not readable: ${(error as Error).message}`);
  }
  const packages = value.packages;
  if (typeof value.release?.version !== "string" || !Array.isArray(packages) || packages.length === 0 ||
    packages.some((entry) => typeof entry.package !== "string" || typeof entry.version !== "string" || typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-"))) {
    fail("This application's package release manifest does not declare its released packages.");
  }
  const locks = value.factoryLockTemplates ?? {};
  return {
    source,
    release: value.release.version,
    packages: packages as readonly ReleaseManifestPackage[],
    locks: locks as Readonly<Record<string, { readonly digest: string }>>
  };
}

/**
 * Where the migration process would import this package from. A pnpm
 * installation links the application's own dependencies at the top level and
 * keeps everything else - including packages only a released package depends on
 * - under one store directory per resolved package. Both are the same bytes to
 * an importer, so both are checked; two copies of one released package are
 * refused rather than resolved, because then which bytes execute is a question
 * about import order.
 */
function installedRoot(root: string, entry: ReleaseManifestPackage): string | undefined {
  const linked = resolve(root, "node_modules", entry.package);
  if (existsSync(linked)) return linked;
  const store = resolve(root, "node_modules/.pnpm");
  if (!existsSync(store)) return undefined;
  const prefix = `${entry.package.replace("/", "+")}@`;
  const resolved = readdirSync(store)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(store, name, "node_modules", entry.package))
    .filter((path) => existsSync(path));
  if (resolved.length > 1) {
    fail(`This application cannot prove its executable closure: ${entry.package} is installed more than once, so which bytes a migration imports is not decided by this release.`);
  }
  return resolved[0];
}

/**
 * The bytes a released package will actually be imported from. Only the paths
 * the archive declares are compared: an install adds its own nested dependency
 * links beside them, and those are not this package's implementation.
 */
function installedPackageDigest(root: string, entry: ReleaseManifestPackage): string {
  const archivePath = resolve(root, packageDirectory, archiveName(entry.package, entry.version));
  if (!existsSync(archivePath)) fail(`This application cannot prove its executable closure: ${entry.package} has no packed archive at ${packageDirectory}.`);
  const archive = readFileSync(archivePath);
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (integrity !== entry.integrity) fail(`This application cannot prove its executable closure: the packed archive for ${entry.package} is not the release the manifest declares.`);
  const installed = installedRoot(root, entry);
  // A release carries every theme it can generate, and an application installs
  // the one it selected. A package nothing imports is recorded as absent rather
  // than demanded, and an absent package cannot execute anything.
  if (installed === undefined) return "not-installed";
  const files = extractNormalizedTarGz(archive, releaseArchiveLimits);
  const rollup = createHash("sha256");
  for (const path of [...files.keys()].sort()) {
    if (!path.startsWith(archivePrefix)) continue;
    const relative = path.slice(archivePrefix.length);
    const target = join(installed, relative);
    if (!existsSync(target)) fail(`This application cannot prove its executable closure: ${entry.package} is installed without ${relative}.`);
    const declared = sha256(files.get(path)!);
    if (sha256(readFileSync(target)) !== declared) {
      fail(`This application cannot prove its executable closure: the installed ${entry.package} does not carry the ${relative} its released archive declares. The code that would run is not the code this release was closed over.`);
    }
    rollup.update(`${relative} ${declared}\n`);
  }
  return rollup.digest("hex");
}

/**
 * Proves the whole closure a migration would execute inside: the generated
 * migration sources and registry, the release manifest, the selected factory
 * lock, every packed archive, and the installed bytes of every released
 * package. Returns the digest the completion receipt records.
 */
export function assertGeneratedExecutableClosure(input: { readonly root?: string; readonly theme: string }): GeneratedExecutableClosure {
  const root = resolve(input.root ?? process.cwd());
  const migration = assertGeneratedMigrationClosure(root);
  const manifest = readManifest(root);
  const digest = createHash("sha256");
  digest.update(`migration-closure ${migration.digest}\n`);
  if (manifest === undefined) {
    // A release-less application has no packed closure to prove; it also has no
    // release manifest to claim one, and the migration closure records that.
    digest.update("release none\n");
    return Object.freeze({ migration, release: "none", packages: Object.freeze([]), digest: `sha256:${digest.digest("hex")}` });
  }
  const lock = resolve(root, lockPath);
  const declaredLock = manifest.locks[input.theme]?.digest;
  if (typeof declaredLock !== "string") fail(`This application cannot prove its executable closure: the manifest declares no ${input.theme} factory lock.`);
  if (!existsSync(lock)) fail("This application cannot prove its executable closure: its package lock is missing.");
  const lockDigest = `sha256:${sha256(readFileSync(lock))}`;
  if (lockDigest !== declaredLock) fail("This application cannot prove its executable closure: its package lock is not the one this release was closed over.");
  digest.update(`release ${manifest.release}\n`);
  digest.update(`release-manifest sha256:${sha256(manifest.source)}\n`);
  digest.update(`factory-lock ${input.theme} ${lockDigest}\n`);
  const packages: string[] = [];
  for (const entry of [...manifest.packages].sort((left, right) => left.package.localeCompare(right.package))) {
    digest.update(`${entry.package}@${entry.version} ${entry.integrity} ${installedPackageDigest(root, entry)}\n`);
    packages.push(`${entry.package}@${entry.version}`);
  }
  return Object.freeze({
    migration, release: manifest.release, packages: Object.freeze(packages), digest: `sha256:${digest.digest("hex")}`
  });
}
