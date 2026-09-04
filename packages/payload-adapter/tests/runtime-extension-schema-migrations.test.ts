import { describe, expect, it } from "vitest";

import {
  kNexRuntimeExtensionSchemaMigrations,
  kNexStaticLifecycleAdmissionSchemaMigration
} from "../src/runtime-extension-schema-migrations.js";

const names = [
  "20260829_000007_runtime_extensions",
  "20260829_000008_app_storage",
  "20260829_000009_extension_activation",
  "20260829_000010_theme_skin_profiles",
  "20260829_000011_static_deployment",
  "20260829_000012_verified_artifacts",
  "20260829_000013_catalog_checkpoints",
  "20260829_000014_theme_skin_verified_artifacts",
  "20260829_000015_extension_capability_authority",
  "20260829_000016_extension_security_quarantine",
  "20260829_000017_static_release_authority",
  "20260829_000018_runner_quarantine"
];

describe("production runtime-extension schema migrations", () => {
  it("exports the complete fixture-derived sequence in dependency order", () => {
    expect(kNexRuntimeExtensionSchemaMigrations.map(({ name }) => name)).toEqual(names);
    for (const migration of kNexRuntimeExtensionSchemaMigrations) {
      expect(migration.up).toBeTypeOf("function");
      expect(migration.down).toBeTypeOf("function");
    }
  });

  it("retains runtime authority, artifact, deployment, and quarantine constraints", () => {
    const source = kNexRuntimeExtensionSchemaMigrations.map(({ up }) => String(up)).join("\n");
    for (const fragment of [
      `CREATE TABLE "runtime_extensions"`,
      "runtime_extension_operations_idempotency_key",
      `CREATE TABLE "runtime_extension_artifact_bindings"`,
      `CREATE TABLE "runtime_static_deployments"`,
      `CREATE TABLE "runtime_extension_runner_quarantine_receipts"`,
      "runtime_extensions_activation_json_check",
      "runtime_extension_security_receipts_digest_check"
    ]) expect(source).toContain(fragment);
  });

  it("exports static lifecycle admission independently for placement after authorization", () => {
    expect(kNexStaticLifecycleAdmissionSchemaMigration.name).toBe("20260901_000022_static_lifecycle_admission");
    const up = String(kNexStaticLifecycleAdmissionSchemaMigration.up);
    const down = String(kNexStaticLifecycleAdmissionSchemaMigration.down);
    for (const name of [
      "k_nex_static_lifecycle_admission",
      "k_nex_static_impact_plan",
      "k_nex_static_shared_generation_rebind",
      "k_nex_static_serving_generation"
    ]) {
      expect(up).toContain(`CREATE FUNCTION public.${name}`);
      expect(down).toContain(`DROP FUNCTION public.${name}`);
    }
  });

  it("uses Payload migration tracking instead of fixture-only revision bookkeeping", () => {
    const source = [...kNexRuntimeExtensionSchemaMigrations, kNexStaticLifecycleAdmissionSchemaMigration]
      .flatMap(({ up, down }) => [String(up), String(down)])
      .join("\n");
    expect(source).not.toContain("k_nex_migration_revision");
  });
});
