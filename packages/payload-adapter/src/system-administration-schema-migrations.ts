import { kNexCatalogMirrorSchemaMigration } from "./catalog-mirror-schema-migration.js";
import { kNexSystemOperationsSchemaMigration } from "./system-operations-schema-migration.js";
import { kNexSystemSettingsSchemaMigration } from "./system-settings-schema-migration.js";

/** Ordered Phase 11 system-administration migrations for generated Payload applications. */
export const kNexSystemAdministrationSchemaMigrations = Object.freeze([
  kNexSystemSettingsSchemaMigration,
  kNexCatalogMirrorSchemaMigration,
  kNexSystemOperationsSchemaMigration
]);
