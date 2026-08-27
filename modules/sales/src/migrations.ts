export const salesMigrationReadiness = Object.freeze({
  currentRevision: 2,
  predecessorRevisions: Object.freeze([1])
});

import type { UpgradeMigration, UpgradeTarget } from "@k-nex/runtime";

const artifactKinds = ["customer-schema", "source", "action", "tool", "block", "theme", "template", "settings"] as const;

export const salesUpgradeTargets: readonly UpgradeTarget[] = Object.freeze(artifactKinds.map((kind) => Object.freeze({
  artifactId: `sales.${kind}`,
  kind,
  currentRevision: 1,
  targetRevision: 2
})));

export const salesUpgradeMigrations: readonly UpgradeMigration[] = Object.freeze(artifactKinds.map((kind) => Object.freeze({
  id: `sales.migration.${kind}.v2`,
  artifactId: `sales.${kind}`,
  kind,
  fromRevision: 1,
  toRevision: 2,
  predecessorRevisions: Object.freeze([1]),
  ...(kind === "customer-schema" ? {} : { dependsOn: Object.freeze(["sales.customer-schema@2"]) }),
  migrate(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Sales artifact must be a record.");
    return { ...value, revision: 2 };
  },
  validate(value: unknown): boolean {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "revision" in value && value.revision === 2;
  }
})));
