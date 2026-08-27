import { describe, expect, it } from "vitest";

import { backupIsRestorable, createPluginArchivePlan, executePluginPurge, planPluginPurge, type BackupEvidence, type PluginPurgePlan, type RestoreEvidence } from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const inventoryDigest = `sha256:${"b".repeat(64)}`;
const manifest = {
  apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
  compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
  provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"], contributions: {},
  lifecycle: { ownsPayloadSchema: true, ownsPersistentData: true, disable: "supported", uninstall: "unsupported", purge: "supported" }
} as const;
const backup: BackupEvidence = { backupId: "backup-1", contentDigest: digest, applicationId: "customer.alpha", completed: true };
const restore: RestoreEvidence = { backupId: "backup-1", sourceDigest: digest, cleanEnvironment: true, externalEffects: "disabled", migrationRevision: 7, runtimeInventoryDigest: inventoryDigest };

function readyPlan(): PluginPurgePlan {
  return planPluginPurge({
    manifest, references: [], dependentPluginIds: [], retentionSatisfied: true,
    archive: { pluginId: "module.sales", format: "k-nex-plugin-archive/v1", schemaVersion: 1, contentDigest: digest, documentCount: 3, restoreVerified: true },
    backup, restore, migration: { id: "sales.purge.v1", expectedPredecessorRevision: 7, targetRevision: 8 },
    authorization: { actorPermissions: new Set(["plugin.purge.execute"]), approvalId: "approval:change-42" }
  });
}

describe("plugin archive, purge, backup, and restore", () => {
  it("requires archive permission and emits a bounded versioned transfer plan", () => {
    expect(() => createPluginArchivePlan({ manifest, actorPermissions: new Set(), collections: ["sales-tasks"], maximumDocuments: 50, encryptionKeyReference: "secret:archive/key", restoreReadPath: "/admin/archive/sales" })).toThrow("access is denied");
    expect(createPluginArchivePlan({ manifest, actorPermissions: new Set(["plugin.archive.export"]), collections: ["sales-tasks"], maximumDocuments: 50, encryptionKeyReference: "secret:archive/key", restoreReadPath: "/admin/archive/sales" })).toMatchObject({ format: "k-nex-plugin-archive/v1", schemaVersion: 1, maximumDocuments: 50 });
  });

  it("accepts backup evidence only after clean-environment restore proof", () => {
    expect(backupIsRestorable(backup, restore)).toBe(true);
    expect(backupIsRestorable(backup, { ...restore, cleanEnvironment: false as true })).toBe(false);
    expect(backupIsRestorable(backup, { ...restore, externalEffects: "enabled" as "disabled" })).toBe(false);
  });

  it("refuses purge until references, dependents, retention, archive, backup, migration, and approval are resolved", () => {
    const blocked = planPluginPurge({
      manifest, references: [{ kind: "document", id: "page.sales", pluginId: "module.sales" }], dependentPluginIds: ["module.consumer"], retentionSatisfied: false
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["REFERENCE_PRESENT", "DEPENDENCY_PRESENT", "RETENTION_BLOCKED", "ARCHIVE_REQUIRED", "BACKUP_REQUIRED", "MIGRATION_REQUIRED", "ACCESS_DENIED"]));
    expect(readyPlan().ready).toBe(true);
  });

  it("commits an authoritative purge and rolls back failed purge work", async () => {
    const events: string[] = [];
    await executePluginPurge(readyPlan(), { begin: async () => { events.push("begin"); }, applyMigration: async () => { events.push("apply"); }, commit: async () => { events.push("commit"); }, rollback: async () => { events.push("rollback"); } });
    expect(events).toEqual(["begin", "apply", "commit"]);

    const failed: string[] = [];
    await expect(executePluginPurge(readyPlan(), { begin: async () => { failed.push("begin"); }, applyMigration: async () => { failed.push("apply"); throw new Error("purge failed"); }, commit: async () => { failed.push("commit"); }, rollback: async () => { failed.push("rollback"); } })).rejects.toThrow("purge failed");
    expect(failed).toEqual(["begin", "apply", "rollback"]);
  });
});
