import { readFileSync, realpathSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { ExactSemverSchema, PluginManifestSchema, supportedFrameworkTuple, type PluginFrameworkTuple, type PluginManifest } from "@k-nex/contracts";
import * as semver from "semver";
import { parse as parseYaml } from "yaml";

const importerDependencySections = ["dependencies", "optionalDependencies"] as const;
const packageNamePattern = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/;

export interface PluginPackageRequest {
  readonly name: string;
  readonly version: string;
}

export type FrameworkTuple = PluginFrameworkTuple;

export interface LoadInstalledPluginManifestsOptions {
  readonly applicationRoot: string;
  readonly lockfilePath: string;
  readonly lockfileImporter: string;
  readonly packages: readonly PluginPackageRequest[];
  readonly framework: FrameworkTuple;
}

export interface InstalledPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface InstalledPluginManifest {
  readonly package: InstalledPackageIdentity;
  readonly manifest: PluginManifest;
}

export type PluginManifestLoadErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_FRAMEWORK_VERSION"
  | "UNSUPPORTED_FRAMEWORK"
  | "LOCKFILE_UNREADABLE"
  | "LOCKFILE_INVALID"
  | "LOCKFILE_VERSION_UNSUPPORTED"
  | "LOCKFILE_ENTRY_MISSING"
  | "LOCKFILE_SPECIFIER_NOT_EXACT"
  | "LOCKFILE_INTEGRITY_MISSING"
  | "PACKAGE_REQUEST_INVALID"
  | "PACKAGE_NAME_MISMATCH"
  | "PACKAGE_VERSION_MISMATCH"
  | "PACKAGE_NOT_FOUND"
  | "PACKAGE_JSON_INVALID"
  | "MANIFEST_EXPORT_MISSING"
  | "MANIFEST_EXPORT_INVALID"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_INVALID_JSON"
  | "MANIFEST_INVALID"
  | "MANIFEST_VERSION_MISMATCH"
  | "DUPLICATE_PLUGIN_ID"
  | "FRAMEWORK_RANGE_INVALID"
  | "LOCKFILE_ENTRY_INVALID";

export class PluginManifestLoadError extends Error {
  readonly code: PluginManifestLoadErrorCode;

  constructor(code: PluginManifestLoadErrorCode, message: string) {
    super(message);
    this.name = "PluginManifestLoadError";
    this.code = code;
  }
}

interface RecordValue {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: PluginManifestLoadErrorCode, message: string): never {
  throw new PluginManifestLoadError(code, message);
}

function isExactSemver(value: unknown): value is string {
  return typeof value === "string" && ExactSemverSchema.safeParse(value).success && semver.valid(value, { loose: false }) !== null;
}

function validateOptions(options: LoadInstalledPluginManifestsOptions): void {
  if (!isRecord(options) || !isRecord(options.framework) || !Array.isArray(options.packages)) {
    fail("INVALID_OPTIONS", "Loader options must include an application root, lockfile, package requests, and framework tuple.");
  }
  if (typeof options.applicationRoot !== "string" || !options.applicationRoot || !isAbsolute(options.applicationRoot)) {
    fail("INVALID_OPTIONS", "The application root must be an absolute directory.");
  }
  if (typeof options.lockfilePath !== "string" || !options.lockfilePath || typeof options.lockfileImporter !== "string" || !options.lockfileImporter) {
    fail("INVALID_OPTIONS", "The lockfile path and importer key are required.");
  }
  const framework = options.framework;
  if (!isExactSemver(framework.core) || !isExactSemver(framework.payload) || !isExactSemver(framework.node) || framework.payloadDatabaseAdapter !== "postgres") {
    fail(framework.payloadDatabaseAdapter === "postgres" ? "INVALID_FRAMEWORK_VERSION" : "UNSUPPORTED_FRAMEWORK", "The framework tuple must use exact core, Payload, Node, and postgres adapter values.");
  }
  if (framework.core !== supportedFrameworkTuple.core || framework.payload !== supportedFrameworkTuple.payload || framework.node !== supportedFrameworkTuple.node) {
    fail("UNSUPPORTED_FRAMEWORK", "The requested framework tuple is not supported by this K-Nex release.");
  }
  const names = new Set<string>();
  for (const requested of options.packages) {
    if (!isRecord(requested) || typeof requested.name !== "string" || !packageNamePattern.test(requested.name) || !isExactSemver(requested.version)) {
      fail("PACKAGE_REQUEST_INVALID", "Each package request must contain a valid package name and exact version.");
    }
    if (names.has(requested.name)) {
      fail("PACKAGE_REQUEST_INVALID", "Each package may be requested only once.");
    }
    names.add(requested.name);
  }
}

function readLockfile(lockfilePath: string): RecordValue {
  let source: string;
  try {
    source = readFileSync(lockfilePath, "utf8");
  } catch {
    fail("LOCKFILE_UNREADABLE", "The pnpm lockfile could not be read.");
  }
  let lockfile: unknown;
  try {
    lockfile = parseYaml(source, { maxAliasCount: 0, uniqueKeys: true });
  } catch {
    fail("LOCKFILE_INVALID", "The pnpm lockfile is not valid YAML.");
  }
  if (!isRecord(lockfile)) {
    fail("LOCKFILE_INVALID", "The pnpm lockfile must contain a mapping.");
  }
  if (lockfile.lockfileVersion !== "9.0") {
    fail("LOCKFILE_VERSION_UNSUPPORTED", "Only pnpm lockfileVersion 9.0 is supported.");
  }
  if (!isRecord(lockfile.importers) || !isRecord(lockfile.packages)) {
    fail("LOCKFILE_INVALID", "The pnpm lockfile must contain importers and packages mappings.");
  }
  return lockfile;
}

function dependencyEntries(importer: RecordValue, name: string): readonly RecordValue[] {
  const entries: RecordValue[] = [];
  for (const section of importerDependencySections) {
    const dependencies = importer[section];
    if (dependencies === undefined) continue;
    if (!isRecord(dependencies)) {
      fail("LOCKFILE_INVALID", "The selected importer dependency sections must be mappings.");
    }
    if (hasOwn(dependencies, name)) {
      const entry = dependencies[name];
      if (!isRecord(entry)) {
        fail("LOCKFILE_ENTRY_INVALID", "A requested importer dependency entry is malformed.");
      }
      entries.push(entry);
    }
  }
  if (entries.length === 0) {
    fail("LOCKFILE_ENTRY_MISSING", `Requested package ${name} is not a direct dependency of the selected importer.`);
  }
  return entries;
}

function importerVersionMatches(value: unknown, requestedVersion: string): boolean {
  if (typeof value !== "string") return false;
  if (value === requestedVersion) return true;
  return value.startsWith(`${requestedVersion}(`) && value.endsWith(")") && value.length > requestedVersion.length + 2;
}

function fileTarball(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const peerSuffix = value.indexOf("(");
  const tarball = peerSuffix === -1 ? value : value.slice(0, peerSuffix);
  if (peerSuffix !== -1 && (!value.endsWith(")") || peerSuffix === value.length - 1)) return undefined;
  if (!tarball.startsWith("file:") || !tarball.endsWith(".tgz") || tarball.includes("\\")) return undefined;
  const path = tarball.slice("file:".length);
  return path.length > 0 && !path.startsWith("/") && !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ? tarball
    : undefined;
}

function packageIntegrity(lockfile: RecordValue, importer: RecordValue, request: PluginPackageRequest): string {
  const entries = dependencyEntries(importer, request.name);
  const registrySpecifier = entries.every((entry) => entry.specifier === request.version);
  const registryEntry = registrySpecifier && entries.every((entry) => importerVersionMatches(entry.version, request.version));
  const firstEntry = entries[0];
  const tarballSpecifier = fileTarball(firstEntry?.specifier);
  const tarballVersion = fileTarball(firstEntry?.version);
  const tarballEntry = tarballSpecifier !== undefined && tarballVersion !== undefined && entries.every(
    (entry) => fileTarball(entry.specifier) === tarballSpecifier && fileTarball(entry.version) === tarballVersion
  );
  if (!registryEntry && !tarballEntry) {
    if (registrySpecifier) fail("PACKAGE_VERSION_MISMATCH", `Requested package ${request.name} does not resolve to its requested version.`);
    fail("LOCKFILE_SPECIFIER_NOT_EXACT", `Requested package ${request.name} does not declare its exact requested version.`);
  }
  const packages = lockfile.packages;
  if (!isRecord(packages)) {
    fail("LOCKFILE_INVALID", "The pnpm lockfile packages section must be a mapping.");
  }
  const packageKey = `${request.name}@${tarballEntry ? tarballVersion : request.version}`;
  if (!hasOwn(packages, packageKey) || !isRecord(packages[packageKey])) {
    fail("LOCKFILE_ENTRY_MISSING", `The lockfile has no package record for ${request.name}.`);
  }
  const packageRecord = packages[packageKey];
  const resolution = packageRecord.resolution;
  if (!isRecord(resolution) || typeof resolution.integrity !== "string" || resolution.integrity.trim().length === 0) {
    fail("LOCKFILE_INTEGRITY_MISSING", `The lockfile package record for ${request.name} has no integrity.`);
  }
  return resolution.integrity;
}

function readJson(
  path: string,
  readCode: "PACKAGE_JSON_INVALID" | "MANIFEST_UNREADABLE",
  invalidCode: "PACKAGE_JSON_INVALID" | "MANIFEST_INVALID_JSON"
): unknown {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    fail(readCode, readCode === "PACKAGE_JSON_INVALID" ? "The installed package.json could not be read." : "The package manifest could not be read.");
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    fail(invalidCode, invalidCode === "PACKAGE_JSON_INVALID" ? "The installed package.json is not valid JSON." : "The package manifest is not valid JSON.");
  }
}

function loadPackageJson(applicationRoot: string, request: PluginPackageRequest): { readonly path: string; readonly value: RecordValue } {
  const base = resolve(applicationRoot, "package.json");
  let packageJsonPath: string | undefined;
  try {
    packageJsonPath = findPackageJSON(request.name, base);
  } catch {
    fail("PACKAGE_NOT_FOUND", `Installed package ${request.name} could not be located.`);
  }
  if (!packageJsonPath) {
    fail("PACKAGE_NOT_FOUND", `Installed package ${request.name} could not be located.`);
  }
  const value = readJson(packageJsonPath, "PACKAGE_JSON_INVALID", "PACKAGE_JSON_INVALID");
  if (!isRecord(value) || value.name !== request.name) {
    fail("PACKAGE_NAME_MISMATCH", `Installed package ${request.name} does not match its requested name.`);
  }
  if (value.version !== request.version) {
    fail("PACKAGE_VERSION_MISMATCH", `Installed package ${request.name} does not match its requested identity.`);
  }
  return { path: packageJsonPath, value };
}

function resolveManifest(applicationRoot: string, request: PluginPackageRequest, packageJsonPath: string, packageJson: RecordValue): string {
  const exportsValue = packageJson.exports;
  if (!isRecord(exportsValue) || !hasOwn(exportsValue, "./manifest")) {
    fail("MANIFEST_EXPORT_MISSING", `Installed package ${request.name} does not explicitly export ./manifest.`);
  }
  if (exportsValue["./manifest"] !== "./k-nex.plugin.json") {
    fail("MANIFEST_EXPORT_INVALID", `Installed package ${request.name} ./manifest must export ./k-nex.plugin.json directly.`);
  }
  const requireFromApplication = createRequire(resolve(applicationRoot, "package.json"));
  let manifestPath: string;
  try {
    manifestPath = requireFromApplication.resolve(`${request.name}/manifest`);
  } catch {
    fail("MANIFEST_EXPORT_INVALID", `Installed package ${request.name} has an unusable ./manifest export.`);
  }
  const packageRoot = dirname(packageJsonPath);
  try {
    if (realpathSync(manifestPath) !== join(realpathSync(packageRoot), "k-nex.plugin.json")) {
      fail("MANIFEST_EXPORT_INVALID", `Installed package ${request.name} ./manifest must stay inside its package root.`);
    }
  } catch {
    fail("MANIFEST_EXPORT_INVALID", `Installed package ${request.name} ./manifest must resolve to its package-root k-nex.plugin.json.`);
  }
  return manifestPath;
}

function parseManifest(manifestPath: string, request: PluginPackageRequest): PluginManifest {
  const value = readJson(manifestPath, "MANIFEST_UNREADABLE", "MANIFEST_INVALID_JSON");
  const parsed = PluginManifestSchema.safeParse(value);
  if (!parsed.success) {
    fail("MANIFEST_INVALID", `Installed package ${request.name} has invalid plugin manifest metadata.`);
  }
  if (parsed.data.package !== request.name) {
    fail("PACKAGE_NAME_MISMATCH", `Installed package ${request.name} manifest does not match its package name.`);
  }
  if (parsed.data.version !== request.version) {
    fail("MANIFEST_VERSION_MISMATCH", `Installed package ${request.name} manifest does not match its package version.`);
  }
  return parsed.data;
}

function validateCompatibility(manifest: PluginManifest, framework: FrameworkTuple): void {
  const versions = [
    ["core", framework.core],
    ["payload", framework.payload],
    ["node", framework.node]
  ] as const;
  for (const [field, version] of versions) {
    const range = manifest.compatibility[field];
    if (semver.validRange(range, { loose: false }) === null) {
      fail("FRAMEWORK_RANGE_INVALID", `Plugin ${manifest.id} declares an invalid ${field} compatibility range.`);
    }
    if (!semver.satisfies(version, range, { loose: false })) {
      fail("UNSUPPORTED_FRAMEWORK", `Plugin ${manifest.id} is incompatible with the requested ${field} framework version.`);
    }
  }
  if (!manifest.compatibility.payloadDatabaseAdapters.includes(framework.payloadDatabaseAdapter)) {
    fail("UNSUPPORTED_FRAMEWORK", `Plugin ${manifest.id} does not support the requested postgres Payload database adapter.`);
  }
}

export function loadInstalledPluginManifests(options: LoadInstalledPluginManifestsOptions): readonly InstalledPluginManifest[] {
  validateOptions(options);
  const lockfile = readLockfile(options.lockfilePath);
  const importers = lockfile.importers;
  if (!isRecord(importers) || !hasOwn(importers, options.lockfileImporter) || !isRecord(importers[options.lockfileImporter])) {
    fail("LOCKFILE_INVALID", "The selected lockfile importer is missing or malformed.");
  }
  const importer = importers[options.lockfileImporter];
  if (!isRecord(importer)) {
    fail("LOCKFILE_INVALID", "The selected lockfile importer is missing or malformed.");
  }
  const requests = [...options.packages].sort((left, right) => compareStrings(left.name, right.name));
  const loaded: InstalledPluginManifest[] = [];
  const pluginIds = new Set<string>();
  for (const request of requests) {
    const integrity = packageIntegrity(lockfile, importer, request);
    const packageJson = loadPackageJson(options.applicationRoot, request);
    const manifestPath = resolveManifest(options.applicationRoot, request, packageJson.path, packageJson.value);
    const manifest = parseManifest(manifestPath, request);
    if (pluginIds.has(manifest.id)) {
      fail("DUPLICATE_PLUGIN_ID", `Plugin ID ${manifest.id} is declared by more than one installed package.`);
    }
    validateCompatibility(manifest, options.framework);
    pluginIds.add(manifest.id);
    loaded.push({ package: { name: request.name, version: request.version, integrity }, manifest });
  }
  loaded.sort((left, right) => compareStrings(left.manifest.id, right.manifest.id));
  return loaded;
}
