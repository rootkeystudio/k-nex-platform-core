import { describe, expect, it } from "vitest";

import { kNexCatalogMirrorSchemaMigration } from "../src/catalog-mirror-schema-migration.js";
import { kNexSystemAdministrationSchemaMigrations } from "../src/system-administration-schema-migrations.js";
import { kNexSystemOperationsSchemaMigration } from "../src/system-operations-schema-migration.js";
import { kNexSystemSettingsSchemaMigration } from "../src/system-settings-schema-migration.js";

const migrations = Object.freeze([
  kNexSystemSettingsSchemaMigration,
  kNexCatalogMirrorSchemaMigration,
  kNexSystemOperationsSchemaMigration
] as const);

describe("production system-administration schema migrations", () => {
  it("exports the ordered Phase 11 Payload migration units", () => {
    expect(kNexSystemAdministrationSchemaMigrations).toEqual(migrations);
    expect(migrations.map((migration) => migration.name)).toEqual([
      "20260902_000023_system_settings",
      "20260902_000024_catalog_mirror",
      "20260902_000025_system_operations"
    ]);
    for (const migration of migrations) {
      expect(Object.isFrozen(migration)).toBe(true);
      expect(typeof migration.up).toBe("function");
      expect(typeof migration.down).toBe("function");
    }
  });

  it("preserves the administration state, receipt immutability, and clean reversals", () => {
    const settingsUp = String(kNexSystemSettingsSchemaMigration.up);
    const settingsDown = String(kNexSystemSettingsSchemaMigration.down);
    for (const fragment of ["k_nex_system_settings_state", "k_nex_system_settings_documents", "k_nex_system_settings_operations", "k_nex_system_settings_receipts", "k_nex_system_settings_audit", "k_nex_system_settings_outbox", "k_nex_system_settings_receipts_immutable"]) expect(settingsUp).toContain(fragment);
    for (const fragment of ["k_nex_system_settings_outbox", "k_nex_system_settings_audit", "k_nex_system_settings_receipts", "k_nex_system_settings_operations", "k_nex_system_settings_documents", "k_nex_system_settings_state"]) expect(settingsDown).toContain(`DROP TABLE "${fragment}"`);

    const catalogUp = String(kNexCatalogMirrorSchemaMigration.up);
    const catalogDown = String(kNexCatalogMirrorSchemaMigration.down);
    for (const fragment of ["k_nex_catalog_mirror_state", "k_nex_catalog_mirror_snapshots", "k_nex_catalog_refresh_operations", "k_nex_catalog_refresh_receipts", "k_nex_catalog_reconciliation_requirements", "k_nex_catalog_refresh_outbox", "k_nex_catalog_refresh_receipts_immutable"]) expect(catalogUp).toContain(fragment);
    for (const fragment of ["k_nex_catalog_refresh_outbox", "k_nex_catalog_refresh_audit", "k_nex_catalog_reconciliation_requirements", "k_nex_catalog_refresh_receipts", "k_nex_catalog_refresh_operations", "k_nex_catalog_mirror_snapshots", "k_nex_catalog_mirror_state"]) expect(catalogDown).toContain(`DROP TABLE "${fragment}"`);

    const operationsUp = String(kNexSystemOperationsSchemaMigration.up);
    const operationsDown = String(kNexSystemOperationsSchemaMigration.down);
    for (const fragment of ["k_nex_system_operations_state", "k_nex_system_operation_requests", "k_nex_system_operation_receipts", "k_nex_system_operation_audit", "k_nex_system_operation_outbox", "k_nex_system_operation_receipts_immutable"]) expect(operationsUp).toContain(fragment);
    for (const fragment of ["k_nex_system_operation_outbox", "k_nex_system_operation_audit", "k_nex_system_operation_receipts", "k_nex_system_operation_requests", "k_nex_system_operations_state"]) expect(operationsDown).toContain(`DROP TABLE "${fragment}"`);
  });

  it("uses Payload migration tracking rather than the fixture-only revision table", () => {
    for (const migration of migrations) {
      expect(String(migration.up)).not.toContain("k_nex_migration_revision");
      expect(String(migration.down)).not.toContain("k_nex_migration_revision");
    }
  });
});
