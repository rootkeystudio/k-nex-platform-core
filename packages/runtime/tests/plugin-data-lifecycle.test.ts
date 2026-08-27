import { describe, expect, it } from "vitest";

import {
  backupIsRestorable, createPluginArchivePlan, executeCleanRestore, executeDatabaseBackup, executePluginArchive,
  executePluginPurge, planPluginPurge, type PluginPurgePlan
} from "../src/index.js";

const inventoryDigest = `sha256:${"b".repeat(64)}`;
const manifest = {
  apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales",
  compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] },
  provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"], contributions: {},
  lifecycle: { ownsPayloadSchema: true, ownsPersistentData: true, disable: "supported", uninstall: "unsupported", purge: "supported" }
} as const;

async function verifiedEvidence(applicationId = "customer.alpha", migrationRevision = 7) {
  const archivePlan = createPluginArchivePlan({
    manifest, applicationId, migrationRevision, actorPermissions: new Set(["plugin.archive.export"]), collections: ["sales-tasks"],
    maximumDocuments: 50, encryptionKeyReference: "secret:archive/key", restoreReadPath: "/admin/archive/sales"
  });
  const archive = await executePluginArchive(archivePlan, {
    exportDocuments: async () => [{ id: "task-1", title: "Archived task" }],
    readRestore: async ({ content, contentDigest, documentCount }) => {
      const envelope = JSON.parse(content) as { applicationId: string; pluginId: string; migrationRevision: number; documents: unknown[] };
      expect(envelope.documents).toHaveLength(1);
      return { applicationId: envelope.applicationId, pluginId: envelope.pluginId, migrationRevision: envelope.migrationRevision, contentDigest, documentCount };
    }
  });
  const backup = await executeDatabaseBackup({
    backupId: `${applicationId.replace(".", "-")}-${migrationRevision}`, applicationId, pluginId: manifest.id, migrationRevision,
    executor: { createBackup: async () => new TextEncoder().encode("physical backup content") }
  });
  const restore = await executeCleanRestore(backup, {
    restoreCleanEnvironment: async ({ applicationId: restoredApplicationId, pluginId, migrationRevision: restoredRevision, content }) => {
      expect(new TextDecoder().decode(content)).toBe("physical backup content");
      return { applicationId: restoredApplicationId, pluginId, migrationRevision: restoredRevision, cleanEnvironment: true, externalEffects: "disabled", runtimeInventoryDigest: inventoryDigest };
    }
  });
  return { archive, backup, restore };
}

async function readyPlan(): Promise<PluginPurgePlan> {
  const { archive, backup, restore } = await verifiedEvidence();
  return planPluginPurge({
    manifest, applicationId: "customer.alpha", references: [], dependentPluginIds: [], retentionSatisfied: true, archive, backup, restore,
    migration: { id: "sales.purge.v1", expectedPredecessorRevision: 7, targetRevision: 8 },
    authorization: { actorPermissions: new Set(["plugin.purge.execute"]), approvalId: "approval:change-42" }
  });
}

describe("plugin archive, purge, backup, and restore", () => {
  it("requires archive permission and executes a bounded export plus read/restore proof", async () => {
    expect(() => createPluginArchivePlan({ manifest, applicationId: "customer.alpha", migrationRevision: 7, actorPermissions: new Set(), collections: ["sales-tasks"], maximumDocuments: 50, encryptionKeyReference: "secret:archive/key", restoreReadPath: "/admin/archive/sales" })).toThrow("access is denied");
    const { archive } = await verifiedEvidence();
    expect(archive).toMatchObject({ applicationId: "customer.alpha", pluginId: "module.sales", migrationRevision: 7, format: "k-nex-plugin-archive/v1", schemaVersion: 1, documentCount: 1 });
  });

  it("accepts backup evidence only after an executor-issued clean-environment restore proof", async () => {
    const { backup, restore } = await verifiedEvidence();
    expect(backupIsRestorable(backup, restore)).toBe(true);
    expect(backupIsRestorable(
      { backupId: backup.backupId, applicationId: backup.applicationId, pluginId: backup.pluginId, migrationRevision: backup.migrationRevision, contentDigest: backup.contentDigest } as typeof backup,
      { ...restore } as typeof restore
    )).toBe(false);
    await expect(executeCleanRestore({ ...backup } as typeof backup, { restoreCleanEnvironment: async () => { throw new Error("must not run"); } })).rejects.toThrow("not issued");
  });

  it("refuses purge until references, dependents, retention, executor receipts, migration, and approval are resolved", async () => {
    const blocked = planPluginPurge({
      manifest, applicationId: "customer.alpha", references: [{ kind: "document", id: "page.sales", pluginId: "module.sales" }], dependentPluginIds: ["module.consumer"], retentionSatisfied: false
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["REFERENCE_PRESENT", "DEPENDENCY_PRESENT", "RETENTION_BLOCKED", "ARCHIVE_REQUIRED", "BACKUP_REQUIRED", "MIGRATION_REQUIRED", "ACCESS_DENIED"]));
    expect((await readyPlan()).ready).toBe(true);
  });

  it("rejects fabricated or substituted lifecycle evidence even when its fields look valid", async () => {
    const { archive, backup, restore } = await verifiedEvidence();
    const fabricated = planPluginPurge({
      manifest, applicationId: "customer.alpha", references: [], dependentPluginIds: [], retentionSatisfied: true,
      archive: { ...archive } as typeof archive, backup: { ...backup } as typeof backup, restore: { ...restore } as typeof restore,
      migration: { id: "sales.purge.v1", expectedPredecessorRevision: 7, targetRevision: 8 },
      authorization: { actorPermissions: new Set(["plugin.purge.execute"]), approvalId: "approval:change-42" }
    });
    expect(fabricated.ready).toBe(false);
    expect(fabricated.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["ARCHIVE_REQUIRED", "BACKUP_REQUIRED"]));

    const otherApplication = await verifiedEvidence("customer.beta");
    const substituted = planPluginPurge({
      manifest, applicationId: "customer.alpha", references: [], dependentPluginIds: [], retentionSatisfied: true,
      archive: otherApplication.archive, backup: otherApplication.backup, restore: otherApplication.restore,
      migration: { id: "sales.purge.v1", expectedPredecessorRevision: 7, targetRevision: 8 },
      authorization: { actorPermissions: new Set(["plugin.purge.execute"]), approvalId: "approval:change-42" }
    });
    expect(substituted.ready).toBe(false);
    expect(substituted.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["ARCHIVE_REQUIRED", "BACKUP_REQUIRED"]));
  });

  it("binds an authoritative purge to its reviewed revisions and consumes its plan", async () => {
    const events: string[] = [];
    const plan = await readyPlan();
    await executePluginPurge(plan, {
      begin: async () => { events.push("begin"); },
      applyMigration: async (migration) => {
        events.push("apply");
        expect(migration).toEqual({ id: "sales.purge.v1", expectedPredecessorRevision: 7, targetRevision: 8 });
      },
      commit: async () => { events.push("commit"); }, rollback: async () => { events.push("rollback"); }
    });
    expect(events).toEqual(["begin", "apply", "commit"]);
    await expect(executePluginPurge(plan, {
      begin: async () => { events.push("replayed-begin"); }, applyMigration: async () => { events.push("replayed-apply"); },
      commit: async () => { events.push("replayed-commit"); }, rollback: async () => { events.push("replayed-rollback"); }
    })).rejects.toThrow("not authoritative or ready");
    expect(events).toEqual(["begin", "apply", "commit"]);
  });

  it("consumes an attempted purge plan while preserving rollback for transaction failures", async () => {
    const failed: string[] = [];
    const plan = await readyPlan();
    await expect(executePluginPurge(plan, { begin: async () => { failed.push("begin"); }, applyMigration: async () => { failed.push("apply"); throw new Error("purge failed"); }, commit: async () => { failed.push("commit"); }, rollback: async () => { failed.push("rollback"); } })).rejects.toThrow("purge failed");
    expect(failed).toEqual(["begin", "apply", "rollback"]);
    await expect(executePluginPurge(plan, { begin: async () => { failed.push("replayed-begin"); }, applyMigration: async () => { failed.push("replayed-apply"); }, commit: async () => { failed.push("replayed-commit"); }, rollback: async () => { failed.push("replayed-rollback"); } })).rejects.toThrow("not authoritative or ready");
    expect(failed).toEqual(["begin", "apply", "rollback"]);
  });

  it("requires a new plan when transaction begin fails before purge work", async () => {
    const plan = await readyPlan();
    const events: string[] = [];
    await expect(executePluginPurge(plan, {
      begin: async () => { events.push("begin"); throw new Error("begin failed"); },
      applyMigration: async () => { events.push("apply"); }, commit: async () => { events.push("commit"); }, rollback: async () => { events.push("rollback"); }
    })).rejects.toThrow("begin failed");
    expect(events).toEqual(["begin"]);
    await expect(executePluginPurge(plan, {
      begin: async () => { events.push("replayed-begin"); }, applyMigration: async () => { events.push("replayed-apply"); },
      commit: async () => { events.push("replayed-commit"); }, rollback: async () => { events.push("replayed-rollback"); }
    })).rejects.toThrow("not authoritative or ready");
    expect(events).toEqual(["begin"]);
  });
});
