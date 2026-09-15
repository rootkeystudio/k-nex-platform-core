export declare const salesMigrationReadiness: Readonly<{
    currentRevision: 3;
    predecessorRevisions: readonly number[];
}>;
import type { UpgradeMigration, UpgradeTarget } from "@k-nex/runtime";
export declare const salesUpgradeTargets: readonly UpgradeTarget[];
/** Exact prior-state rules; execution stays in trusted deployment migration authority. */
export declare const salesCrmMigrationPlan: Readonly<{
    id: "sales.migration.initial";
    version: 3;
    classification: "offline-required";
    predecessorRevisions: readonly number[];
    task: Readonly<{
        collection: "sales-tasks";
        status: Readonly<{
            open: "open";
            done: "completed";
        }>;
        preserve: readonly string[];
        potentialRevenue: "migration-evidence-only";
        privateNote: "immutable-authorized-note";
    }>;
    opportunity: Readonly<{
        collection: "sales-opportunities";
        preserve: readonly string[];
        stage: "stageId";
        value: "amount";
        stageState: "derived-not-persisted";
    }>;
    rollback: "maintenance-required";
}>;
export declare const salesUpgradeMigrations: readonly UpgradeMigration[];
//# sourceMappingURL=migrations.d.ts.map