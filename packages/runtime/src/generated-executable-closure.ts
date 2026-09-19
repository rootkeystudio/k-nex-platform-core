import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { extractNormalizedTarGz } from "@k-nex/extension-bundler";

import { admitGeneratedReleaseStep, assertGeneratedMigrationClosure, readGeneratedMigrationClosure, type GeneratedMigrationClosure } from "./generated-migration-closure.js";
import { MigrationFenceError } from "./migration-fence.js";

/**
 * The trusted authority here is the deployment filesystem and the launcher an
 * operator runs, not this module. The launcher and this verifier are both
 * installed inside the tree they measure, so whoever can write that tree has
 * already replaced the authority: a substituted launcher never calls this, and a
 * substituted @k-nex/runtime answers whatever it likes. Nothing that executes
 * below that boundary can prove otherwise about itself, and this module does not
 * pretend to.
 *
 * What it is, stated plainly: a drift detector under that boundary. Everything
 * it can measure it measures, and the value it returns is recorded in the
 * database when the release completes, so the durable receipt - not a file
 * beside the code - is what every later migration and every readiness check is
 * held to. A replaced launcher can skip its own check; it cannot produce the
 * receipt this closure records, and it cannot get past per-step admission or
 * readiness, both of which recompute this closure from inside the process that
 * is executing.
 *
 * Two kinds of evidence go into the value, and they are not equally strong:
 *  - released packages have a packed archive this release declares by integrity,
 *    so they are compared file by file against a declaration that came with the
 *    release;
 *  - the third-party executable the migration actually runs - the Payload
 *    launcher shim, the payload package, the loader that package registers, the
 *    Postgres adapter, and the patch this application applies to it - has no
 *    archive here. It is measured, folded into the same digest, and therefore
 *    recorded by the completion receipt and re-proved against that recording by
 *    every readiness check afterwards. Nothing in the deployment declares those
 *    bytes before a receipt exists, so a first migration cannot deny drift in
 *    them: this is trust on first use anchored by a durable receipt, not
 *    independent attestation, and `recorded` is named for exactly that.
 */
const packageDirectory = ".k-nex/packages";
const releaseManifestPath = ".k-nex/package-release-manifest.json";
const lockPath = "pnpm-lock.yaml";
const workspacePath = "pnpm-workspace.yaml";
const patchDirectory = "patches";
const launcherPath = "k-nex-migrate.mjs";
const applicationManifestPath = "package.json";
const migrateScriptName = "knex:migrate";
const payloadShimPath = "node_modules/.bin/payload";
const archivePrefix = "package/";

/**
 * The chain the launcher hands the migration to, in the order it runs: the shim
 * pnpm wrote, the package that shim executes, the loader that package registers
 * before it loads its own CLI, and the database adapter every migration writes
 * through. It is not the whole transitive dependency graph of the migration
 * process, and it does not claim to be.
 */
const recordedExecutables = Object.freeze(["payload", "tsx", "@payloadcms/db-postgres"]);

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
  readonly recorded: string;
  readonly digest: string;
}

interface ReleaseManifestPackage {
  readonly package: string;
  readonly version: string;
  readonly role: string;
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

/**
 * Node runs --require, --import and loader hooks before the first line of this
 * module, so a process started with that authority could have replaced every
 * function this proof calls, including the ones that read the bytes it reports.
 * It cannot detect that from inside itself, so it refuses to run at all rather
 * than produce a measurement whose meaning it cannot state.
 */
export const executableBootstrapVariables = Object.freeze(["NODE_OPTIONS", "NODE_LOADER", "NODE_REPL_EXTERNAL_MODULE"]);
const bootstrapFlag = /^(?:-r|--require|--import|--loader|--experimental-loader)(?:=|$)/u;

export function assertGeneratedExecutableBootstrap(
  environment: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv
): void {
  for (const name of executableBootstrapVariables) {
    const value = environment[name];
    if (typeof value === "string" && value.trim() !== "") {
      fail(`This application cannot prove its executable closure: ${name} is set, and it runs code before this proof does.`);
    }
  }
  const injected = execArgv.find((flag) => bootstrapFlag.test(flag));
  if (injected !== undefined) {
    fail(`This application cannot prove its executable closure: it was started with ${injected}, which runs code before this proof does.`);
  }
}

/** The same authority, withheld from the process the launcher spawns. */
export function sanitizedExecutableEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = { ...environment };
  for (const name of executableBootstrapVariables) delete sanitized[name];
  return sanitized;
}

function readManifest(root: string): { readonly source: Buffer; readonly release: string; readonly packages: readonly ReleaseManifestPackage[]; readonly locks: Readonly<Record<string, { readonly digest: string }>> } | undefined {
  const path = resolve(root, releaseManifestPath);
  if (!existsSync(path)) return undefined;
  const source = readFileSync(path);
  let value: {
    release?: { version?: unknown };
    packages?: readonly { package?: unknown; version?: unknown; role?: unknown; integrity?: unknown }[];
    factoryLockTemplates?: Record<string, { digest?: unknown }>;
  };
  try {
    value = JSON.parse(source.toString("utf8")) as typeof value;
  } catch (error) {
    fail(`This application's package release manifest is not readable: ${(error as Error).message}`);
  }
  const packages = value.packages;
  if (typeof value.release?.version !== "string" || !Array.isArray(packages) || packages.length === 0 ||
    packages.some((entry) => typeof entry.package !== "string" || typeof entry.version !== "string" || typeof entry.role !== "string" ||
      typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-"))) {
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
 * Where Node would load this package from, asked from the directory that
 * imports it. This is the node_modules chain an ESM import walks upward from the
 * importer, and it is walked here rather than taken from
 * `require.resolve.paths`, which also appends the calling module's own paths and
 * Node's global folders: those answer where this verifier was loaded from, not
 * what the importer can reach, and a package proved somewhere the importer
 * cannot resolve is not the package that runs. Realpath is applied because Node
 * applies it: a pnpm link and the store directory it points into are the same
 * module only once the link is followed.
 */
function resolvedPackageRoot(importer: string, name: string): string | undefined {
  let directory = importer;
  for (;;) {
    if (basename(directory) !== "node_modules") {
      const manifest = join(directory, "node_modules", name, applicationManifestPath);
      if (existsSync(manifest)) return realpathSync(dirname(manifest));
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * The one installation a package resolves to across every importer that can
 * reach it. A clean top-level link is not the answer on its own: @k-nex/runtime
 * depends on released packages of its own, and a package imported from inside it
 * resolves through that package's links, so a clean top-level copy beside a
 * drifted nested one would otherwise be the copy proved and not the copy
 * executed. Two distinct real paths are refused rather than reconciled, because
 * then which bytes execute is a question about import order.
 */
function boundInstallation(importers: readonly string[], name: string): string | undefined {
  const bound = new Set<string>();
  for (const importer of importers) {
    const installed = resolvedPackageRoot(importer, name);
    if (installed !== undefined) bound.add(installed);
  }
  if (bound.size > 1) {
    fail(`This application cannot prove its executable closure: ${name} is installed more than once (${[...bound].sort().join(", ")}), so which bytes a migration imports is not decided by this release.`);
  }
  return [...bound][0];
}

/**
 * Every place that imports a released package, found by following resolution
 * from the application until it stops finding new ones. Starting from the
 * application alone would miss a package only a released dependency reaches, and
 * that is the copy whose drift the application's own links cannot show.
 */
function executableImporters(root: string, packages: readonly ReleaseManifestPackage[]): readonly string[] {
  const importers = new Set<string>([root]);
  for (let pass = 0; pass <= packages.length; pass += 1) {
    const before = importers.size;
    for (const importer of [...importers]) {
      for (const entry of packages) {
        const installed = resolvedPackageRoot(importer, entry.package);
        if (installed !== undefined) importers.add(installed);
      }
    }
    if (importers.size === before) break;
  }
  return [...importers];
}

/**
 * Every byte an installed package carries, at the path resolution bound it to.
 * A nested node_modules is skipped: those entries are other packages, each one
 * proved or recorded under its own name, and walking them would fold one
 * package's dependency tree into another package's identity.
 */
function installedTreeDigest(installed: string): string {
  const digest = createHash("sha256");
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) digest.update(`${name} link ${readlinkSync(path)}\n`);
      else if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(path, name); }
      else if (entry.isFile()) digest.update(`${name} ${sha256(readFileSync(path))}\n`);
      else fail(`This application cannot prove its executable closure: ${installed} carries ${name}, which is not a regular file.`);
    }
  };
  walk(installed, "");
  return digest.digest("hex");
}

/**
 * The bytes a released package will actually be imported from. Only the paths
 * the archive declares are compared: an install adds its own nested dependency
 * links beside them, and those are not this package's implementation.
 */
function installedPackageDigest(root: string, importers: readonly string[], entry: ReleaseManifestPackage, theme: string): string {
  const archivePath = resolve(root, packageDirectory, archiveName(entry.package, entry.version));
  if (!existsSync(archivePath)) fail(`This application cannot prove its executable closure: ${entry.package} has no packed archive at ${packageDirectory}.`);
  const archive = readFileSync(archivePath);
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (integrity !== entry.integrity) fail(`This application cannot prove its executable closure: the packed archive for ${entry.package} is not the release the manifest declares.`);
  const installed = boundInstallation(importers, entry.package);
  if (installed === undefined) {
    // A release carries every theme it can generate and an application installs
    // the one it selected, so the unselected theme class is the only absence a
    // closure may record. Every other declared package is one a migration would
    // import, and an import this application cannot resolve is a broken closure
    // rather than a hole to record silently.
    if (entry.role !== "theme" || entry.package === `@k-nex/theme-${theme}`) {
      fail(`This application cannot prove its executable closure: ${entry.package} is declared by this release and is not installed, so the code a migration would import is not present.`);
    }
    return "not-installed";
  }
  const files = extractNormalizedTarGz(archive, releaseArchiveLimits);
  const rollup = createHash("sha256");
  for (const path of [...files.keys()].sort()) {
    if (!path.startsWith(archivePrefix)) continue;
    const relativePath = path.slice(archivePrefix.length);
    const target = join(installed, relativePath);
    if (!existsSync(target)) fail(`This application cannot prove its executable closure: ${entry.package} is installed without ${relativePath}.`);
    const declared = sha256(files.get(path)!);
    if (sha256(readFileSync(target)) !== declared) {
      fail(`This application cannot prove its executable closure: the installed ${entry.package} does not carry the ${relativePath} its released archive declares. The code that would run is not the code this release was closed over.`);
    }
    rollup.update(`${relativePath} ${declared}\n`);
  }
  return rollup.digest("hex");
}

/**
 * The third-party executable the launcher spawns into. None of it has a packed
 * archive in this release, so none of it is checked against a declaration that
 * shipped with the release: it is measured here, carried into the closure digest
 * the completion receipt records, and re-proved against that recording by every
 * readiness check on a database that carries one. The shim is measured at its
 * real path because that is the file the launcher executes, and the patched
 * adapter is measured as installed because an applied patch is only visible in
 * the installed bytes.
 */
function recordedExecutableDigest(root: string): string {
  const digest = createHash("sha256");
  const shim = resolve(root, payloadShimPath);
  if (!existsSync(shim)) fail("This application cannot prove its executable closure: the Payload launcher shim it would spawn is not installed.");
  const target = realpathSync(shim);
  digest.update(`shim ${payloadShimPath} ${relative(root, target)} ${sha256(readFileSync(target))}\n`);
  const payload = resolvedPackageRoot(root, "payload");
  if (payload === undefined) fail("This application cannot prove its executable closure: the payload package its launcher shim executes is not installed.");
  const importers = [root, payload];
  for (const name of recordedExecutables) {
    const installed = boundInstallation(importers, name);
    if (installed === undefined) fail(`This application cannot prove its executable closure: ${name}, which the migration process executes, is not installed.`);
    digest.update(`${name} ${relative(root, installed)} ${installedTreeDigest(installed)}\n`);
  }
  const patches = resolve(root, patchDirectory);
  digest.update(`patches ${existsSync(patches) ? installedTreeDigest(patches) : "none"}\n`);
  const workspace = resolve(root, workspacePath);
  if (!existsSync(workspace)) fail(`This application cannot prove its executable closure: ${workspacePath}, which declares the patch applied to its database adapter, is missing.`);
  digest.update(`${workspacePath} ${sha256(readFileSync(workspace))}\n`);
  return digest.digest("hex");
}

/**
 * The launcher and the command that starts it, measured by the thing they start.
 * A replaced launcher does skip its own check - it is above this boundary - but
 * it cannot make the closure it replaced: the bytes it substituted are in the
 * digest the completion receipt records, so a restored application computes a
 * different one and refuses to serve the database that launcher migrated.
 */
function selfMeasurement(root: string, digest: ReturnType<typeof createHash>): void {
  const launcher = resolve(root, launcherPath);
  if (!existsSync(launcher)) fail(`This application cannot prove its executable closure: its ${launcherPath} launcher is missing.`);
  digest.update(`launcher ${launcherPath} ${sha256(readFileSync(launcher))}\n`);
  const manifest = resolve(root, applicationManifestPath);
  if (!existsSync(manifest)) fail(`This application cannot prove its executable closure: its ${applicationManifestPath} is missing.`);
  let scripts: { scripts?: Record<string, unknown> };
  try {
    scripts = JSON.parse(readFileSync(manifest, "utf8")) as typeof scripts;
  } catch (error) {
    fail(`This application's ${applicationManifestPath} is not readable: ${(error as Error).message}`);
  }
  const command = scripts.scripts?.[migrateScriptName];
  if (typeof command !== "string") fail(`This application cannot prove its executable closure: its ${applicationManifestPath} declares no ${migrateScriptName} command.`);
  digest.update(`${migrateScriptName} ${command}\n`);
}

/**
 * Proves the whole closure a migration would execute inside: the generated
 * migration sources and registry, the launcher and the command that runs it, the
 * third-party executable that command spawns, the release manifest, the selected
 * factory lock, every packed archive, and the installed bytes of every released
 * package at the path resolution binds them to. Returns the digest the
 * completion receipt records.
 */
export function assertGeneratedExecutableClosure(input: { readonly root?: string; readonly theme: string }): GeneratedExecutableClosure {
  assertGeneratedExecutableBootstrap();
  const root = realpathSync(resolve(input.root ?? process.cwd()));
  const migration = assertGeneratedMigrationClosure(root);
  const digest = createHash("sha256");
  digest.update(`migration-closure ${migration.digest}\n`);
  selfMeasurement(root, digest);
  const recorded = `sha256:${recordedExecutableDigest(root)}`;
  digest.update(`recorded-executable ${recorded}\n`);
  const manifest = readManifest(root);
  if (manifest === undefined) {
    // A release-less application has no packed closure to prove; it also has no
    // release manifest to claim one, and the migration closure records that.
    digest.update("release none\n");
    return Object.freeze({ migration, release: "none", packages: Object.freeze([]), recorded, digest: `sha256:${digest.digest("hex")}` });
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
  const importers = executableImporters(root, manifest.packages);
  const packages: string[] = [];
  for (const entry of [...manifest.packages].sort((left, right) => left.package.localeCompare(right.package))) {
    digest.update(`${entry.package}@${entry.version} ${entry.integrity} ${installedPackageDigest(root, importers, entry, input.theme)}\n`);
    packages.push(`${entry.package}@${entry.version}`);
  }
  return Object.freeze({
    migration, release: manifest.release, packages: Object.freeze(packages), recorded, digest: `sha256:${digest.digest("hex")}`
  });
}

/**
 * The one admission a declared step runs before its first statement: the
 * executable closure the launcher proved in a different process, then the ledger
 * prefix and the release state this step may run against. Re-proving the closure
 * here is what closes the window the launcher's handover opens, and it happens
 * inside the step's own transaction, so a refusal costs nothing.
 *
 * The whole proof reads the packed archives, the installed released packages and
 * the third-party executable tree. On the reference host that is about 0.25 s
 * against a migration of about eight, so it is not the cost that decides which
 * steps carry it; the steps decide that themselves, where they are authored.
 */
export async function admitGeneratedReleaseExecutable(input: {
  readonly step: string;
  readonly root?: string;
  execute(statement: string): Promise<unknown>;
}): Promise<GeneratedMigrationClosure> {
  const root = resolve(input.root ?? process.cwd());
  // The identity comes from the application's declared closure, not from the
  // step file: the domain steps are byte-identical across applications, and a
  // step that named its own application would make the fixture that mirrors
  // them a different file from the one the factory emits.
  const declared = readGeneratedMigrationClosure(root);
  assertGeneratedExecutableClosure({ root, theme: declared.theme });
  return admitGeneratedReleaseStep({
    applicationId: declared.applicationId, release: declared.release, step: input.step, root, execute: input.execute
  });
}
