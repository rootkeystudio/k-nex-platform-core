import { PluginManifestSchema, ResourceIdSchema, type PluginManifest } from "@k-nex/contracts";

import { scanPluginReferences, type PluginReference } from "./plugin-lifecycle.js";

export type PluginDataLifecycleDiagnosticCode =
  | "ACCESS_DENIED" | "ARCHIVE_REQUIRED" | "BACKUP_REQUIRED" | "DEPENDENCY_PRESENT" | "MIGRATION_REQUIRED"
  | "NOT_RESTORABLE" | "PURGE_UNSUPPORTED" | "REFERENCE_PRESENT" | "RETENTION_BLOCKED";

export interface PluginDataLifecycleDiagnostic {
  readonly code: PluginDataLifecycleDiagnosticCode;
  readonly message: string;
}

export interface PluginArchivePlan {
  readonly pluginId: string;
  readonly format: "k-nex-plugin-archive/v1";
  readonly schemaVersion: 1;
  readonly collections: readonly string[];
  readonly maximumDocuments: number;
  readonly encryptionKeyReference: string;
  readonly restoreReadPath: string;
}

export interface PluginArchiveReceipt {
  readonly pluginId: string;
  readonly format: "k-nex-plugin-archive/v1";
  readonly schemaVersion: 1;
  readonly contentDigest: string;
  readonly documentCount: number;
  readonly restoreVerified: true;
}

export interface BackupEvidence {
  readonly backupId: string;
  readonly contentDigest: string;
  readonly applicationId: string;
  readonly completed: true;
}

export interface RestoreEvidence {
  readonly backupId: string;
  readonly sourceDigest: string;
  readonly cleanEnvironment: true;
  readonly externalEffects: "disabled" | "redirected";
  readonly migrationRevision: number;
  readonly runtimeInventoryDigest: string;
}

export interface PluginPurgePlan {
  readonly pluginId: string;
  readonly migrationId: string;
  readonly expectedPredecessorRevision: number;
  readonly targetRevision: number;
  readonly approvalId: string;
  readonly ready: boolean;
  readonly diagnostics: readonly PluginDataLifecycleDiagnostic[];
}

export interface PurgeTransaction {
  begin(): Promise<void>;
  applyMigration(migrationId: string): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

const authoritativePurgePlans = new WeakSet<object>();
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function issue(code: PluginDataLifecycleDiagnosticCode, message: string): PluginDataLifecycleDiagnostic {
  return Object.freeze({ code, message });
}

export function createPluginArchivePlan(input: {
  readonly manifest: PluginManifest;
  readonly actorPermissions: ReadonlySet<string>;
  readonly collections: readonly string[];
  readonly maximumDocuments: number;
  readonly encryptionKeyReference: string;
  readonly restoreReadPath: string;
}): PluginArchivePlan {
  const manifest = PluginManifestSchema.parse(input.manifest);
  if (!input.actorPermissions.has("plugin.archive.export")) throw new Error("Plugin archive export access is denied.");
  const collections = [...new Set(input.collections)].sort();
  if (collections.length === 0 || collections.some((value) => !/^[a-z][a-z0-9-]{1,63}$/u.test(value)) ||
    !Number.isSafeInteger(input.maximumDocuments) || input.maximumDocuments < 1 || input.maximumDocuments > 100_000 ||
    !/^secret:[a-zA-Z0-9._/-]+$/u.test(input.encryptionKeyReference) || !input.restoreReadPath.startsWith("/")) {
    throw new Error("Plugin archive export bounds are invalid.");
  }
  return Object.freeze({
    pluginId: manifest.id,
    format: "k-nex-plugin-archive/v1",
    schemaVersion: 1,
    collections: Object.freeze(collections),
    maximumDocuments: input.maximumDocuments,
    encryptionKeyReference: input.encryptionKeyReference,
    restoreReadPath: input.restoreReadPath
  });
}

export function backupIsRestorable(backup: BackupEvidence, restore: RestoreEvidence): boolean {
  return backup.completed && digestPattern.test(backup.contentDigest) && backup.backupId === restore.backupId &&
    backup.contentDigest === restore.sourceDigest && restore.cleanEnvironment &&
    (restore.externalEffects === "disabled" || restore.externalEffects === "redirected") &&
    Number.isSafeInteger(restore.migrationRevision) && restore.migrationRevision >= 0 && digestPattern.test(restore.runtimeInventoryDigest);
}

export function planPluginPurge(input: {
  readonly manifest: PluginManifest;
  readonly references: readonly PluginReference[];
  readonly dependentPluginIds: readonly string[];
  readonly retentionSatisfied: boolean;
  readonly archive?: PluginArchiveReceipt;
  readonly backup?: BackupEvidence;
  readonly restore?: RestoreEvidence;
  readonly migration?: { readonly id: string; readonly expectedPredecessorRevision: number; readonly targetRevision: number };
  readonly authorization?: { readonly actorPermissions: ReadonlySet<string>; readonly approvalId: string };
}): PluginPurgePlan {
  const manifest = PluginManifestSchema.parse(input.manifest);
  const diagnostics: PluginDataLifecycleDiagnostic[] = [];
  if (manifest.lifecycle.purge !== "supported") diagnostics.push(issue("PURGE_UNSUPPORTED", "Plugin manifest does not support purge."));
  const references = scanPluginReferences(manifest.id, input.references);
  if (references.length > 0) diagnostics.push(issue("REFERENCE_PRESENT", `${references.length} active plugin reference(s) remain.`));
  const dependents = [...new Set(input.dependentPluginIds)];
  for (const pluginId of dependents) ResourceIdSchema.parse(pluginId);
  if (dependents.length > 0) diagnostics.push(issue("DEPENDENCY_PRESENT", `${dependents.length} dependent plugin(s) remain.`));
  if (!input.retentionSatisfied) diagnostics.push(issue("RETENTION_BLOCKED", "Retention or legal-hold requirements are unresolved."));
  if (input.archive === undefined || input.archive.pluginId !== manifest.id || input.archive.format !== "k-nex-plugin-archive/v1" ||
    input.archive.schemaVersion !== 1 || !digestPattern.test(input.archive.contentDigest) || !input.archive.restoreVerified ||
    !Number.isSafeInteger(input.archive.documentCount) || input.archive.documentCount < 0) {
    diagnostics.push(issue("ARCHIVE_REQUIRED", "A versioned, restore-verified plugin archive is required."));
  }
  if (input.backup === undefined || input.restore === undefined || !backupIsRestorable(input.backup, input.restore)) {
    diagnostics.push(issue("BACKUP_REQUIRED", "A database backup restored into a clean environment is required."));
  }
  const migration = input.migration;
  if (migration === undefined || !/^[a-z][a-z0-9._-]{2,127}$/u.test(migration.id) ||
    !Number.isSafeInteger(migration.expectedPredecessorRevision) || migration.expectedPredecessorRevision < 0 ||
    migration.targetRevision !== migration.expectedPredecessorRevision + 1) {
    diagnostics.push(issue("MIGRATION_REQUIRED", "A reviewed, sequential customer purge migration is required."));
  }
  if (input.authorization === undefined || !input.authorization.actorPermissions.has("plugin.purge.execute") ||
    !/^approval:[a-zA-Z0-9._-]{3,128}$/u.test(input.authorization.approvalId)) {
    diagnostics.push(issue("ACCESS_DENIED", "Explicit purge permission and approval are required."));
  }
  const ready = diagnostics.length === 0;
  const plan = Object.freeze({
    pluginId: manifest.id,
    migrationId: migration?.id ?? "unavailable",
    expectedPredecessorRevision: migration?.expectedPredecessorRevision ?? -1,
    targetRevision: migration?.targetRevision ?? -1,
    approvalId: input.authorization?.approvalId ?? "unavailable",
    ready,
    diagnostics: Object.freeze(diagnostics)
  });
  if (ready) authoritativePurgePlans.add(plan);
  return plan;
}

export async function executePluginPurge(plan: PluginPurgePlan, transaction: PurgeTransaction): Promise<void> {
  if (!plan.ready || !authoritativePurgePlans.has(plan)) throw new Error("Plugin purge plan is not authoritative or ready.");
  await transaction.begin();
  try {
    await transaction.applyMigration(plan.migrationId);
    await transaction.commit();
  } catch (error) {
    try { await transaction.rollback(); } catch { /* preserve the purge failure */ }
    throw error;
  }
}
