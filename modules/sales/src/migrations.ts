export const salesMigrationReadiness = Object.freeze({
  currentRevision: 3,
  predecessorRevisions: Object.freeze([1, 2])
});

import type { UpgradeMigration, UpgradeTarget } from "@k-nex/runtime";

const artifactKinds = ["customer-schema", "source", "action", "tool", "block", "theme", "template", "settings"] as const;
type SalesArtifactKind = typeof artifactKinds[number];

const migrationMarkers = {
  "customer-schema": ["indexContractVersion", 2],
  source: ["queryPolicyVersion", 2], action: ["idempotencyPolicyVersion", 2], tool: ["approvalPolicyVersion", 2],
  block: ["accessibilityContractVersion", 2], theme: ["tokenContractVersion", 2], template: ["requirementsVersion", 2],
  settings: ["settingsMigrationVersion", 2]
} as const satisfies Readonly<Record<SalesArtifactKind, readonly [string, number]>>;

export const salesUpgradeTargets: readonly UpgradeTarget[] = Object.freeze(artifactKinds.map((kind) => Object.freeze({
  artifactId: `sales.${kind}`,
  kind,
  currentRevision: 2,
  targetRevision: 3
})));

const v2Migrations: readonly UpgradeMigration[] = Object.freeze(artifactKinds.map((kind) => Object.freeze({
  id: `sales.migration.${kind}.v2`,
  artifactId: `sales.${kind}`,
  kind,
  fromRevision: 1,
  toRevision: 2,
  predecessorRevisions: Object.freeze([1]),
  ...(kind === "customer-schema" ? {} : { dependsOn: Object.freeze(["sales.customer-schema@2"]) }),
  migrate(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Sales artifact must be a record.");
    const [marker, markerRevision] = migrationMarkers[kind];
    return { ...value, revision: 2, [marker]: markerRevision };
  },
  validate(value: unknown): boolean {
    const [marker, markerRevision] = migrationMarkers[kind];
    return typeof value === "object" && value !== null && !Array.isArray(value) && "revision" in value && value.revision === 2 && marker in value && (value as Record<string, unknown>)[marker] === markerRevision;
  }
})));

const v3Migrations: readonly UpgradeMigration[] = Object.freeze(artifactKinds.map((kind) => Object.freeze({
  id: `sales.migration.${kind}.v3`,
  artifactId: `sales.${kind}`,
  kind,
  fromRevision: 2,
  toRevision: 3,
  predecessorRevisions: Object.freeze([1, 2]),
  ...(kind === "customer-schema" ? {} : { dependsOn: Object.freeze(["sales.customer-schema@3"]) }),
  migrate(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Sales artifact must be a record.");
    return { ...value, revision: 3, crmCoreContractVersion: 3 };
  },
  validate(value: unknown): boolean {
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
      (value as Record<string, unknown>).revision === 3 && (value as Record<string, unknown>).crmCoreContractVersion === 3;
  }
})));

/** Exact prior-state rules; execution stays in trusted deployment migration authority. */
export const salesCrmMigrationPlan = Object.freeze({
  id: "sales.migration.initial",
  version: 3,
  classification: "offline-required" as const,
  predecessorRevisions: Object.freeze([1, 2]),
  task: Object.freeze({ collection: "sales-tasks", status: Object.freeze({ open: "open", done: "completed" }), preserve: Object.freeze(["id", "createdAt", "updatedAt"]), potentialRevenue: "migration-evidence-only", privateNote: "immutable-authorized-note" }),
  opportunity: Object.freeze({ collection: "sales-opportunities", preserve: Object.freeze(["id", "createdAt", "updatedAt"]), stage: "stageId", value: "amount", stageState: "derived-not-persisted" }),
  rollback: "maintenance-required"
});

export const salesUpgradeMigrations: readonly UpgradeMigration[] = Object.freeze([...v2Migrations, ...v3Migrations]);
