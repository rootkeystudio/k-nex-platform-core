import { createHash } from "node:crypto";

import { PluginManifestSchema, ResourceIdSchema, assertJsonValue, canonicalJson, type JsonValue, type PluginManifest } from "@k-nex/contracts";

import { scanPluginReferences, type PluginReference } from "./plugin-lifecycle.js";

export type PluginDataLifecycleDiagnosticCode =
  | "ACCESS_DENIED" | "ARCHIVE_REQUIRED" | "BACKUP_REQUIRED" | "DEPENDENCY_PRESENT" | "MIGRATION_REQUIRED"
  | "NOT_RESTORABLE" | "PURGE_UNSUPPORTED" | "REFERENCE_PRESENT" | "RETENTION_BLOCKED";

export interface PluginDataLifecycleDiagnostic {
  readonly code: PluginDataLifecycleDiagnosticCode;
  readonly message: string;
}

export interface PluginArchivePlan {
  readonly applicationId: string;
  readonly pluginId: string;
  readonly migrationRevision: number;
  readonly format: "k-nex-plugin-archive/v1";
  readonly schemaVersion: 1;
  readonly collections: readonly string[];
  readonly maximumDocuments: number;
  readonly maximumDocumentBytes: number;
  readonly maximumBytes: number;
  readonly encryptionKeyReference: string;
  readonly restoreReadPath: string;
}

declare const verifiedArchiveReceipt: unique symbol;
declare const verifiedBackupReceipt: unique symbol;
declare const verifiedRestoreReceipt: unique symbol;

export interface VerifiedPluginArchiveReceipt {
  readonly applicationId: string;
  readonly pluginId: string;
  readonly migrationRevision: number;
  readonly format: "k-nex-plugin-archive/v1";
  readonly schemaVersion: 1;
  readonly contentDigest: string;
  readonly documentCount: number;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly encryptionKeyReference: string;
  readonly [verifiedArchiveReceipt]: true;
}

export interface VerifiedBackupReceipt {
  readonly backupId: string;
  readonly applicationId: string;
  readonly pluginId: string;
  readonly migrationRevision: number;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly encryptionKeyReference: string;
  readonly [verifiedBackupReceipt]: true;
}

export interface VerifiedRestoreReceipt {
  readonly backupId: string;
  readonly applicationId: string;
  readonly pluginId: string;
  readonly migrationRevision: number;
  readonly sourceDigest: string;
  readonly cleanEnvironment: true;
  readonly externalEffects: "disabled" | "redirected";
  readonly runtimeInventoryDigest: string;
  readonly [verifiedRestoreReceipt]: true;
}

export interface PluginArchiveExecutor {
  exportDocuments(plan: PluginArchivePlan): AsyncIterable<JsonValue>;
  readonly store: ContentAddressedStore;
  readRestore(input: {
    readonly plan: PluginArchivePlan;
    readonly content: AsyncIterable<Uint8Array>;
    readonly storageKey: string;
    readonly contentDigest: string;
    readonly documentCount: number;
    readonly byteLength: number;
  }): Promise<{
    readonly applicationId: string;
    readonly pluginId: string;
    readonly migrationRevision: number;
    readonly contentDigest: string;
    readonly documentCount: number;
    readonly byteLength: number;
  }>;
}

export interface DatabaseBackupExecutor {
  createBackup(): AsyncIterable<Uint8Array>;
  readonly store: ContentAddressedStore;
  readonly maximumBytes: number;
  readonly encryptionKeyReference: string;
}

export interface ContentAddressedStore {
  write(input: {
    readonly content: AsyncIterable<Uint8Array>;
    readonly maximumBytes: number;
    readonly encryptionKeyReference: string;
  }): Promise<{ readonly storageKey: string; readonly byteLength: number; readonly encryptionKeyReference: string }>;
  read(storageKey: string): AsyncIterable<Uint8Array>;
}

export interface CleanRestoreExecutor {
  restoreCleanEnvironment(input: {
    readonly backupId: string;
    readonly applicationId: string;
    readonly pluginId: string;
    readonly migrationRevision: number;
    readonly content: AsyncIterable<Uint8Array>;
    readonly storageKey: string;
    readonly contentDigest: string;
    readonly byteLength: number;
    readonly encryptionKeyReference: string;
  }): Promise<{
    readonly applicationId: string;
    readonly pluginId: string;
    readonly migrationRevision: number;
    readonly cleanEnvironment: true;
    readonly externalEffects: "disabled" | "redirected";
    readonly runtimeInventoryDigest: string;
  }>;
}

export interface PluginPurgePlan {
  readonly applicationId: string;
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
  applyMigration(migration: {
    readonly id: string;
    readonly expectedPredecessorRevision: number;
    readonly targetRevision: number;
  }): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface EvidenceBinding {
  readonly applicationId: string;
  readonly pluginId: string;
  readonly migrationRevision: number;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly encryptionKeyReference: string;
}

interface BackupBinding extends EvidenceBinding {
  readonly backupId: string;
  readonly store: ContentAddressedStore;
}

const authoritativePurgePlans = new WeakSet<object>();
const archivePlans = new WeakSet<object>();
const archiveReceipts = new WeakMap<object, EvidenceBinding>();
const backupReceipts = new WeakMap<object, BackupBinding>();
const restoreReceipts = new WeakMap<object, EvidenceBinding & { readonly backupId: string }>();
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function issue(code: PluginDataLifecycleDiagnosticCode, message: string): PluginDataLifecycleDiagnostic {
  return Object.freeze({ code, message });
}

async function writeContentAddressed(input: {
  readonly content: AsyncIterable<Uint8Array>;
  readonly store: ContentAddressedStore;
  readonly maximumBytes: number;
  readonly encryptionKeyReference: string;
}): Promise<{ readonly contentDigest: string; readonly byteLength: number; readonly storageKey: string; readonly encryptionKeyReference: string }> {
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1 || input.maximumBytes > 1024 ** 4 ||
    !/^secret:[a-zA-Z0-9._/-]+$/u.test(input.encryptionKeyReference)) throw new Error("Content-addressed storage bounds are invalid.");
  const hash = createHash("sha256");
  let byteLength = 0;
  let complete = false;
  const bounded = async function* () {
    for await (const chunk of input.content) {
      if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) throw new Error("Content stream produced an invalid chunk.");
      byteLength += chunk.byteLength;
      if (byteLength > input.maximumBytes) throw new Error("Content stream exceeded its byte bound.");
      hash.update(chunk);
      yield chunk;
    }
    complete = true;
  };
  const stored = await input.store.write({ content: bounded(), maximumBytes: input.maximumBytes, encryptionKeyReference: input.encryptionKeyReference });
  if (!complete || byteLength === 0) throw new Error("Content store did not consume the complete bounded stream.");
  const contentDigest = `sha256:${hash.digest("hex")}`;
  if (stored.storageKey !== contentDigest || stored.byteLength !== byteLength || stored.encryptionKeyReference !== input.encryptionKeyReference) {
    throw new Error("Content store receipt does not match the streamed content.");
  }
  return Object.freeze({ contentDigest, byteLength, storageKey: stored.storageKey, encryptionKeyReference: stored.encryptionKeyReference });
}

function validRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 0;
}

function validArchiveBinding(receipt: unknown, applicationId: string, pluginId: string, migrationRevision: number): boolean {
  if (receipt === null || typeof receipt !== "object") return false;
  const binding = archiveReceipts.get(receipt);
  return binding?.applicationId === applicationId && binding.pluginId === pluginId && binding.migrationRevision === migrationRevision;
}

export function createPluginArchivePlan(input: {
  readonly manifest: PluginManifest;
  readonly applicationId: string;
  readonly migrationRevision: number;
  readonly actorPermissions: ReadonlySet<string>;
  readonly collections: readonly string[];
  readonly maximumDocuments: number;
  readonly maximumDocumentBytes: number;
  readonly maximumBytes: number;
  readonly encryptionKeyReference: string;
  readonly restoreReadPath: string;
}): PluginArchivePlan {
  const manifest = PluginManifestSchema.parse(input.manifest);
  ResourceIdSchema.parse(input.applicationId);
  if (!validRevision(input.migrationRevision)) throw new Error("Plugin archive migration revision is invalid.");
  if (!input.actorPermissions.has("plugin.archive.export")) throw new Error("Plugin archive export access is denied.");
  const collections = [...new Set(input.collections)].sort();
  if (collections.length === 0 || collections.some((value) => !/^[a-z][a-z0-9-]{1,63}$/u.test(value)) ||
    !Number.isSafeInteger(input.maximumDocuments) || input.maximumDocuments < 1 || input.maximumDocuments > 100_000 ||
    !Number.isSafeInteger(input.maximumDocumentBytes) || input.maximumDocumentBytes < 1 || input.maximumDocumentBytes > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < input.maximumDocumentBytes || input.maximumBytes > 1024 ** 4 ||
    !/^secret:[a-zA-Z0-9._/-]+$/u.test(input.encryptionKeyReference) || !input.restoreReadPath.startsWith("/")) {
    throw new Error("Plugin archive export bounds are invalid.");
  }
  const plan = Object.freeze({
    applicationId: input.applicationId,
    pluginId: manifest.id,
    migrationRevision: input.migrationRevision,
    format: "k-nex-plugin-archive/v1",
    schemaVersion: 1,
    collections: Object.freeze(collections),
    maximumDocuments: input.maximumDocuments,
    maximumDocumentBytes: input.maximumDocumentBytes,
    maximumBytes: input.maximumBytes,
    encryptionKeyReference: input.encryptionKeyReference,
    restoreReadPath: input.restoreReadPath
  });
  archivePlans.add(plan);
  return plan;
}

export async function executePluginArchive(plan: PluginArchivePlan, executor: PluginArchiveExecutor): Promise<VerifiedPluginArchiveReceipt> {
  if (!archivePlans.has(plan)) throw new Error("Plugin archive plan was not issued by the archive planner.");
  let documentCount = 0;
  const content = async function* () {
    yield new TextEncoder().encode(`${canonicalJson({ format: plan.format, schemaVersion: plan.schemaVersion, applicationId: plan.applicationId, pluginId: plan.pluginId, migrationRevision: plan.migrationRevision })}\n`);
    for await (const document of executor.exportDocuments(plan)) {
      if (documentCount >= plan.maximumDocuments) throw new Error("Plugin archive export exceeded its document bound.");
      assertJsonValue(document, `$[${documentCount}]`);
      const bytes = new TextEncoder().encode(`${canonicalJson(document)}\n`);
      if (bytes.byteLength > plan.maximumDocumentBytes) throw new Error("Plugin archive document exceeded its byte bound.");
      documentCount += 1;
      yield bytes;
    }
  };
  const stored = await writeContentAddressed({ content: content(), store: executor.store, maximumBytes: plan.maximumBytes, encryptionKeyReference: plan.encryptionKeyReference });
  const read = await executor.readRestore({ plan, content: executor.store.read(stored.storageKey), storageKey: stored.storageKey, contentDigest: stored.contentDigest, documentCount, byteLength: stored.byteLength });
  if (read.applicationId !== plan.applicationId || read.pluginId !== plan.pluginId || read.migrationRevision !== plan.migrationRevision ||
    read.contentDigest !== stored.contentDigest || read.documentCount !== documentCount || read.byteLength !== stored.byteLength) throw new Error("Plugin archive read/restore proof does not match the bounded export.");
  const receipt = Object.freeze({
    applicationId: plan.applicationId, pluginId: plan.pluginId, migrationRevision: plan.migrationRevision,
    format: plan.format, schemaVersion: plan.schemaVersion, contentDigest: stored.contentDigest, documentCount,
    byteLength: stored.byteLength, storageKey: stored.storageKey, encryptionKeyReference: stored.encryptionKeyReference
  }) as VerifiedPluginArchiveReceipt;
  archiveReceipts.set(receipt, { applicationId: plan.applicationId, pluginId: plan.pluginId, migrationRevision: plan.migrationRevision, ...stored });
  return receipt;
}

export async function executeDatabaseBackup(input: {
  readonly backupId: string;
  readonly applicationId: string;
  readonly pluginId: string;
  readonly migrationRevision: number;
  readonly executor: DatabaseBackupExecutor;
}): Promise<VerifiedBackupReceipt> {
  ResourceIdSchema.parse(input.applicationId);
  ResourceIdSchema.parse(input.pluginId);
  if (!/^[a-z][a-z0-9._-]{2,127}$/u.test(input.backupId) || !validRevision(input.migrationRevision)) throw new Error("Database backup identity is invalid.");
  const stored = await writeContentAddressed({ content: input.executor.createBackup(), store: input.executor.store, maximumBytes: input.executor.maximumBytes, encryptionKeyReference: input.executor.encryptionKeyReference });
  const receipt = Object.freeze({
    backupId: input.backupId, applicationId: input.applicationId, pluginId: input.pluginId,
    migrationRevision: input.migrationRevision, contentDigest: stored.contentDigest, byteLength: stored.byteLength,
    storageKey: stored.storageKey, encryptionKeyReference: stored.encryptionKeyReference
  }) as VerifiedBackupReceipt;
  backupReceipts.set(receipt, { backupId: input.backupId, applicationId: input.applicationId, pluginId: input.pluginId, migrationRevision: input.migrationRevision, ...stored, store: input.executor.store });
  return receipt;
}

export async function executeCleanRestore(backup: VerifiedBackupReceipt, executor: CleanRestoreExecutor): Promise<VerifiedRestoreReceipt> {
  const backupBinding = backupReceipts.get(backup);
  if (backupBinding === undefined) throw new Error("Database backup receipt was not issued by the backup executor.");
  const restored = await executor.restoreCleanEnvironment({
    backupId: backupBinding.backupId, applicationId: backupBinding.applicationId, pluginId: backupBinding.pluginId,
    migrationRevision: backupBinding.migrationRevision, content: backupBinding.store.read(backupBinding.storageKey), storageKey: backupBinding.storageKey,
    contentDigest: backupBinding.contentDigest, byteLength: backupBinding.byteLength, encryptionKeyReference: backupBinding.encryptionKeyReference
  });
  if (restored.applicationId !== backupBinding.applicationId || restored.pluginId !== backupBinding.pluginId ||
    restored.migrationRevision !== backupBinding.migrationRevision || restored.cleanEnvironment !== true ||
    (restored.externalEffects !== "disabled" && restored.externalEffects !== "redirected") || !digestPattern.test(restored.runtimeInventoryDigest)) {
    throw new Error("Clean restore proof does not match the backup receipt.");
  }
  const receipt = Object.freeze({
    backupId: backupBinding.backupId, applicationId: backupBinding.applicationId, pluginId: backupBinding.pluginId,
    migrationRevision: backupBinding.migrationRevision, sourceDigest: backupBinding.contentDigest, cleanEnvironment: true as const,
    externalEffects: restored.externalEffects, runtimeInventoryDigest: restored.runtimeInventoryDigest
  }) as VerifiedRestoreReceipt;
  restoreReceipts.set(receipt, { ...backupBinding, backupId: backupBinding.backupId });
  return receipt;
}

export function backupIsRestorable(backup: VerifiedBackupReceipt, restore: VerifiedRestoreReceipt): boolean {
  const backupBinding = backupReceipts.get(backup);
  const restoreBinding = restoreReceipts.get(restore);
  return backupBinding !== undefined && restoreBinding !== undefined && backupBinding.backupId === restoreBinding.backupId &&
    backupBinding.applicationId === restoreBinding.applicationId && backupBinding.pluginId === restoreBinding.pluginId &&
    backupBinding.migrationRevision === restoreBinding.migrationRevision && backupBinding.contentDigest === restoreBinding.contentDigest;
}

export function planPluginPurge(input: {
  readonly manifest: PluginManifest;
  readonly applicationId: string;
  readonly references: readonly PluginReference[];
  readonly dependentPluginIds: readonly string[];
  readonly retentionSatisfied: boolean;
  readonly archive?: VerifiedPluginArchiveReceipt;
  readonly backup?: VerifiedBackupReceipt;
  readonly restore?: VerifiedRestoreReceipt;
  readonly migration?: { readonly id: string; readonly expectedPredecessorRevision: number; readonly targetRevision: number };
  readonly authorization?: { readonly actorPermissions: ReadonlySet<string>; readonly approvalId: string };
}): PluginPurgePlan {
  const manifest = PluginManifestSchema.parse(input.manifest);
  ResourceIdSchema.parse(input.applicationId);
  const diagnostics: PluginDataLifecycleDiagnostic[] = [];
  if (manifest.lifecycle.purge !== "supported") diagnostics.push(issue("PURGE_UNSUPPORTED", "Plugin manifest does not support purge."));
  const references = scanPluginReferences(manifest.id, input.references);
  if (references.length > 0) diagnostics.push(issue("REFERENCE_PRESENT", `${references.length} active plugin reference(s) remain.`));
  const dependents = [...new Set(input.dependentPluginIds)];
  for (const pluginId of dependents) ResourceIdSchema.parse(pluginId);
  if (dependents.length > 0) diagnostics.push(issue("DEPENDENCY_PRESENT", `${dependents.length} dependent plugin(s) remain.`));
  if (!input.retentionSatisfied) diagnostics.push(issue("RETENTION_BLOCKED", "Retention or legal-hold requirements are unresolved."));
  const migration = input.migration;
  const validMigration = migration !== undefined && /^[a-z][a-z0-9._-]{2,127}$/u.test(migration.id) &&
    validRevision(migration.expectedPredecessorRevision) && migration.targetRevision === migration.expectedPredecessorRevision + 1;
  if (!validMigration) diagnostics.push(issue("MIGRATION_REQUIRED", "A reviewed, sequential customer purge migration is required."));
  const expectedRevision = validMigration ? migration.expectedPredecessorRevision : -1;
  if (!validArchiveBinding(input.archive, input.applicationId, manifest.id, expectedRevision)) {
    diagnostics.push(issue("ARCHIVE_REQUIRED", "An executor-verified, restore-read plugin archive is required."));
  }
  if (input.backup === undefined || input.restore === undefined || !backupIsRestorable(input.backup, input.restore)) {
    diagnostics.push(issue("BACKUP_REQUIRED", "An executor-verified database backup restored into a clean environment is required."));
  } else {
    const backupBinding = backupReceipts.get(input.backup);
    if (backupBinding?.applicationId !== input.applicationId || backupBinding.pluginId !== manifest.id || backupBinding.migrationRevision !== expectedRevision) {
      diagnostics.push(issue("BACKUP_REQUIRED", "The backup and clean restore must match this application, plugin, and migration revision."));
    }
  }
  if (input.authorization === undefined || !input.authorization.actorPermissions.has("plugin.purge.execute") ||
    !/^approval:[a-zA-Z0-9._-]{3,128}$/u.test(input.authorization.approvalId)) {
    diagnostics.push(issue("ACCESS_DENIED", "Explicit purge permission and approval are required."));
  }
  const ready = diagnostics.length === 0;
  const plan = Object.freeze({
    applicationId: input.applicationId, pluginId: manifest.id, migrationId: migration?.id ?? "unavailable",
    expectedPredecessorRevision: migration?.expectedPredecessorRevision ?? -1, targetRevision: migration?.targetRevision ?? -1,
    approvalId: input.authorization?.approvalId ?? "unavailable", ready, diagnostics: Object.freeze(diagnostics)
  });
  if (ready) authoritativePurgePlans.add(plan);
  return plan;
}

export async function executePluginPurge(plan: PluginPurgePlan, transaction: PurgeTransaction): Promise<void> {
  if (!plan.ready || !authoritativePurgePlans.has(plan)) throw new Error("Plugin purge plan is not authoritative or ready.");
  authoritativePurgePlans.delete(plan);
  await transaction.begin();
  try {
    await transaction.applyMigration({
      id: plan.migrationId,
      expectedPredecessorRevision: plan.expectedPredecessorRevision,
      targetRevision: plan.targetRevision
    });
    await transaction.commit();
  } catch (error) {
    try { await transaction.rollback(); } catch { /* preserve the purge failure */ }
    throw error;
  }
}
