import { valid as validSemver } from "semver";
import { parse } from "yaml";

export interface ResolvedLockComponent {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface ResolvedLockDependency {
  readonly ref: string;
  readonly dependsOn: readonly string[];
}

export interface ResolvedPnpmLock {
  readonly components: readonly ResolvedLockComponent[];
  readonly dependencies: readonly ResolvedLockDependency[];
  readonly rootDependencies: readonly string[];
}

const integrityPattern = /^(?:sha512-[A-Za-z0-9+/]{86}==|sha256:[0-9a-f]{64})$/u;

function identity(key: string): { name: string; version: string } | undefined {
  const file = /^(?<name>.+)@file:.*-(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/u.exec(key);
  if (file?.groups !== undefined && validSemver(file.groups.version) !== null) return { name: file.groups.name!, version: file.groups.version! };
  const match = /^(?<name>.+)@(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\(.*\))?$/u.exec(key);
  if (match?.groups === undefined || validSemver(match.groups.version) === null) return undefined;
  return { name: match.groups.name!, version: match.groups.version! };
}

function ref(name: string, version: string): string {
  return `pkg:npm/${name.replace("@", "%40")}@${version}`;
}

function dependencyRef(name: string, resolution: unknown): string | undefined {
  if (typeof resolution !== "string" || resolution.startsWith("link:") || resolution.startsWith("workspace:")) return undefined;
  const parsed = identity(`${name}@${resolution}`);
  return parsed === undefined ? undefined : ref(parsed.name, parsed.version);
}

export function resolvePnpmLock(lockContent: string): ResolvedPnpmLock {
  const lock = parse(lockContent) as {
    packages?: Record<string, { resolution?: { integrity?: string } }>;
    snapshots?: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
    importers?: Record<string, { dependencies?: Record<string, { version?: string }> }>;
  };
  if (lock.packages === undefined || lock.snapshots === undefined || lock.importers?.["."] === undefined) throw new Error("A complete pnpm lockfile is required for release evidence.");

  const components = Object.entries(lock.packages).map(([key, entry]) => {
    const parsed = identity(key);
    const integrity = entry.resolution?.integrity;
    if (parsed === undefined || integrity === undefined || !integrityPattern.test(integrity)) throw new Error(`Lock package ${key} lacks an exact version or integrity.`);
    return Object.freeze({ ...parsed, integrity });
  }).sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
  const componentRefs = new Set(components.map(({ name, version }) => ref(name, version)));
  const dependencies = Object.entries(lock.snapshots).flatMap(([key, snapshot]) => {
    const parsed = identity(key);
    if (parsed === undefined) return [];
    const ownRef = ref(parsed.name, parsed.version);
    if (!componentRefs.has(ownRef)) return [];
    const targets = Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })
      .map(([name, resolution]) => dependencyRef(name, resolution)).filter((value): value is string => value !== undefined && componentRefs.has(value)).sort();
    return [Object.freeze({ ref: ownRef, dependsOn: Object.freeze([...new Set(targets)]) })];
  }).sort((left, right) => left.ref.localeCompare(right.ref));
  const rootDependencies = Object.entries(lock.importers["."]!.dependencies ?? {})
    .map(([name, resolution]) => dependencyRef(name, resolution.version)).filter((value): value is string => value !== undefined && componentRefs.has(value)).sort();
  return Object.freeze({ components: Object.freeze(components), dependencies: Object.freeze(dependencies), rootDependencies: Object.freeze([...new Set(rootDependencies)]) });
}
