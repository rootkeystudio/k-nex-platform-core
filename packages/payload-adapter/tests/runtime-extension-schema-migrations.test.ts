import { describe, expect, it } from "vitest";

import {
  kNexRuntimeExtensionSchemaMigrations,
  kNexStaticRebindLockProtocolSchemaMigration,
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
      "runtime_extension_operations_execution_request_digest_check",
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
    expect(up).toContain("pg_catalog.to_json(p_application_id)::text");
    expect(up).toContain("authorization-state");
    expect(up).not.toContain("jsonb_build_array(p_application_id, 'authorization-state')::text");
  });

  it("uses Payload migration tracking instead of fixture-only revision bookkeeping", () => {
    const source = [...kNexRuntimeExtensionSchemaMigrations, kNexStaticLifecycleAdmissionSchemaMigration, kNexStaticRebindLockProtocolSchemaMigration]
      .flatMap(({ up, down }) => [String(up), String(down)])
      .join("\n");
    expect(source).not.toContain("k_nex_migration_revision");
  });

  it("replaces the deployed shared-generation writer with the global exclusive lock order", () => {
    expect(kNexStaticRebindLockProtocolSchemaMigration.name).toBe("20260909_000035_static_rebind_lock_protocol");
    const up = String(kNexStaticRebindLockProtocolSchemaMigration.up);
    expect(up).toContain("CREATE OR REPLACE FUNCTION public.k_nex_static_shared_generation_rebind");
    const deployment = up.indexOf('"static-deployment"');
    const identities = up.indexOf('"platform-plugin"');
    const deploymentRows = up.indexOf("FROM public.runtime_static_deployments AS d");
    const authorization = up.indexOf('"authorization-state"');
    const authorizationRows = up.indexOf("FROM public.k_nex_authorization_state");
    expect(deployment).toBeGreaterThan(-1);
    expect(deployment).toBeLessThan(identities);
    expect(identities).toBeLessThan(deploymentRows);
    expect(deploymentRows).toBeLessThan(authorization);
    expect(authorization).toBeLessThan(authorizationRows);
    expect(up).toContain('ORDER BY locked.extension_id COLLATE "C"');
    expect(up).not.toContain("already_locked");
  });
});
