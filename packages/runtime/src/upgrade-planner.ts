import { compare, valid as validSemver } from "semver";

import { PackageReleaseManifestSchema, type PackageReleaseManifest } from "@k-nex/contracts";

export const upgradeArtifactKinds = [
  "customer-schema", "source", "action", "tool", "block", "theme", "template", "settings"
] as const;

export type UpgradeArtifactKind = typeof upgradeArtifactKinds[number];

export interface UpgradeTarget {
  readonly artifactId: string;
  readonly kind: UpgradeArtifactKind;
  readonly currentRevision: number;
  readonly targetRevision: number;
}

export interface UpgradeMigration {
  readonly id: string;
  readonly artifactId: string;
  readonly kind: UpgradeArtifactKind;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly predecessorRevisions: readonly number[];
  readonly dependsOn?: readonly string[];
  migrate(value: unknown): unknown;
  validate(value: unknown): boolean;
}

export interface UpgradeDiagnostic {
  readonly severity: "error" | "info";
  readonly code: "CYCLE" | "DUPLICATE" | "GAP" | "INVALID" | "MIGRATION_FAILED" | "READY" | "REVISION_MISMATCH" | "UNSUPPORTED_RELEASE";
  readonly artifactId?: string;
  readonly message: string;
}

export interface UpgradePlanStep extends UpgradeMigration {
  readonly key: string;
}

export interface UpgradePlan {
  readonly pluginId: string;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly currentPlatformRelease: string;
  readonly targetPlatformRelease: string;
  readonly ready: boolean;
  readonly steps: readonly UpgradePlanStep[];
  readonly diagnostics: readonly UpgradeDiagnostic[];
}

export interface UpgradeDryRun {
  readonly ready: boolean;
  readonly diagnostics: readonly UpgradeDiagnostic[];
  readonly artifacts: Readonly<Record<string, unknown>>;
}

const kindOrder = new Map(upgradeArtifactKinds.map((kind, index) => [kind, index]));
const validId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function diagnostic(
  code: UpgradeDiagnostic["code"], message: string, artifactId?: string, severity: UpgradeDiagnostic["severity"] = "error"
): UpgradeDiagnostic {
  return Object.freeze({ code, message, severity, ...(artifactId === undefined ? {} : { artifactId }) });
}

function revision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function planPluginUpgrade(input: {
  readonly pluginId: string;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly currentPlatformRelease: string;
  readonly targetPlatformRelease: string;
  readonly currentReleaseManifest: PackageReleaseManifest;
  readonly targetReleaseManifest: PackageReleaseManifest;
  readonly targets: readonly UpgradeTarget[];
  readonly migrations: readonly UpgradeMigration[];
}): UpgradePlan {
  const diagnostics: UpgradeDiagnostic[] = [];
  const currentRelease = PackageReleaseManifestSchema.safeParse(input.currentReleaseManifest);
  const targetRelease = PackageReleaseManifestSchema.safeParse(input.targetReleaseManifest);
  if (!currentRelease.success || !targetRelease.success) {
    diagnostics.push(diagnostic("UNSUPPORTED_RELEASE", "Platform release manifests are invalid."));
  } else if (input.currentPlatformRelease !== currentRelease.data.release.version || input.targetPlatformRelease !== targetRelease.data.release.version ||
    !targetRelease.data.supportWindow.supportedReleases.includes(input.currentPlatformRelease)) {
    diagnostics.push(diagnostic("UNSUPPORTED_RELEASE", "Platform upgrade source and target must belong to the declared support window."));
  } else {
    const currentPackage = currentRelease.data.packages.find((entry) => entry.package === `@k-nex/${input.pluginId.replace("module.", "module-")}`);
    const targetPackage = targetRelease.data.packages.find((entry) => entry.package === `@k-nex/${input.pluginId.replace("module.", "module-")}`);
    if (currentPackage?.version !== input.currentVersion || targetPackage?.version !== input.targetVersion || currentPackage.integrity === targetPackage.integrity) {
      diagnostics.push(diagnostic("UNSUPPORTED_RELEASE", "Plugin source and target must be distinct trusted release artifacts."));
    }
  }
  if (!validId.test(input.pluginId) || validSemver(input.currentVersion) === null || validSemver(input.targetVersion) === null) {
    diagnostics.push(diagnostic("INVALID", "Plugin identity and release versions must be valid."));
  } else if (compare(input.targetVersion, input.currentVersion) < 0) {
    diagnostics.push(diagnostic("INVALID", "Upgrade target version cannot precede the installed version."));
  }

  const targets = new Map<string, UpgradeTarget>();
  for (const target of input.targets) {
    if (!validId.test(target.artifactId) || !kindOrder.has(target.kind) || !revision(target.currentRevision) ||
      !revision(target.targetRevision) || target.targetRevision < target.currentRevision) {
      diagnostics.push(diagnostic("INVALID", "Upgrade target is invalid.", target.artifactId));
      continue;
    }
    if (targets.has(target.artifactId)) {
      diagnostics.push(diagnostic("DUPLICATE", "Upgrade target is declared more than once.", target.artifactId));
      continue;
    }
    targets.set(target.artifactId, target);
  }

  const migrations = new Map<string, UpgradeMigration>();
  for (const migration of input.migrations) {
    const target = targets.get(migration.artifactId);
    const key = `${migration.artifactId}@${migration.fromRevision}`;
    if (!validId.test(migration.id) || target === undefined || migration.kind !== target.kind || !revision(migration.fromRevision) ||
      migration.toRevision !== migration.fromRevision + 1 || !migration.predecessorRevisions.includes(migration.fromRevision) ||
      typeof migration.migrate !== "function" || typeof migration.validate !== "function") {
      diagnostics.push(diagnostic("INVALID", "Upgrade migration identity, kind, revisions, or handlers are invalid.", migration.artifactId));
      continue;
    }
    if (migrations.has(key)) {
      diagnostics.push(diagnostic("DUPLICATE", "Upgrade migration revision is declared more than once.", migration.artifactId));
      continue;
    }
    migrations.set(key, migration);
  }

  const pending = new Map<string, UpgradePlanStep>();
  for (const target of targets.values()) {
    for (let current = target.currentRevision; current < target.targetRevision; current += 1) {
      const migration = migrations.get(`${target.artifactId}@${current}`);
      if (migration === undefined) {
        diagnostics.push(diagnostic("GAP", `Migration ${current} -> ${current + 1} is missing.`, target.artifactId));
        break;
      }
      const step = Object.freeze({ ...migration, key: `${migration.artifactId}@${migration.toRevision}` });
      pending.set(step.key, step);
    }
  }

  const stepKeys = new Set(pending.keys());
  for (const step of pending.values()) {
    for (const dependency of step.dependsOn ?? []) {
      if (!stepKeys.has(dependency)) diagnostics.push(diagnostic("INVALID", `Dependency ${dependency} is not part of the upgrade graph.`, step.artifactId));
    }
  }

  const ordered: UpgradePlanStep[] = [];
  while (pending.size > 0) {
    const candidates = [...pending.values()].filter((step) => {
      const previous = step.fromRevision === targets.get(step.artifactId)?.currentRevision
        ? undefined : `${step.artifactId}@${step.fromRevision}`;
      const dependencies = [...(step.dependsOn ?? []), ...(previous === undefined ? [] : [previous])];
      return dependencies.every((dependency) => !pending.has(dependency));
    }).sort((left, right) => (kindOrder.get(left.kind)! - kindOrder.get(right.kind)!) || left.key.localeCompare(right.key));
    if (candidates.length === 0) {
      diagnostics.push(diagnostic("CYCLE", "Upgrade migration dependencies contain a cycle or unknown future step."));
      break;
    }
    for (const step of candidates) {
      pending.delete(step.key);
      ordered.push(step);
    }
  }

  const ready = diagnostics.every(({ severity }) => severity !== "error");
  if (ready) diagnostics.push(diagnostic("READY", `Upgrade plan contains ${ordered.length} ordered step(s).`, undefined, "info"));
  return immutable({
    pluginId: input.pluginId,
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    currentPlatformRelease: input.currentPlatformRelease,
    targetPlatformRelease: input.targetPlatformRelease,
    ready,
    steps: ordered,
    diagnostics
  });
}

export function dryRunPluginUpgrade(plan: UpgradePlan, artifacts: Readonly<Record<string, unknown>>): UpgradeDryRun {
  const diagnostics: UpgradeDiagnostic[] = [...plan.diagnostics];
  const output: Record<string, unknown> = clone(artifacts);
  if (!plan.ready) return immutable({ ready: false, diagnostics, artifacts: output });

  for (const step of plan.steps) {
    if (!(step.artifactId in output)) {
      diagnostics.push(diagnostic("REVISION_MISMATCH", "Dry-run input is missing the migration artifact.", step.artifactId));
      break;
    }
    const current = output[step.artifactId];
    if (typeof current !== "object" || current === null || !("revision" in current) || current.revision !== step.fromRevision) {
      diagnostics.push(diagnostic("REVISION_MISMATCH", `Dry-run artifact does not match predecessor revision ${step.fromRevision}.`, step.artifactId));
      break;
    }
    try {
      const migrated = step.migrate(immutable(clone(current)));
      if (!step.validate(migrated)) throw new Error("validation failed");
      output[step.artifactId] = clone(migrated);
    } catch {
      diagnostics.push(diagnostic("MIGRATION_FAILED", `Dry-run migration ${step.id} failed.`, step.artifactId));
      break;
    }
  }
  const ready = diagnostics.every(({ severity }) => severity !== "error");
  if (ready) diagnostics.push(diagnostic("READY", "Upgrade dry-run completed without mutating source artifacts.", undefined, "info"));
  return immutable({ ready, diagnostics, artifacts: output });
}
