import { describe, expect, it } from "vitest";
import ts from "typescript";

import { applicationAuthFiles } from "../src/application-auth-files.js";

describe("generated application readiness", () => {
  it.each(["minimal", "neobrutalism"] as const)("shares one fail-closed reconciler for the %s application", (theme) => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme });
    const readiness = files["src/k-nex-readiness.ts"]!;
    const route = files["src/app/api/readiness/route.ts"]!;
    const doctor = files["src/k-nex-doctor.ts"]!;

    expect(readiness).toContain("export async function reconcileKnexReadiness(payload: Payload)");
    expect(readiness).toContain('export const kNexApplicationReadyMarker = "K_NEX_APPLICATION_READY"');
    expect(readiness.indexOf("assertAdministrationOperatorConfiguration();")).toBeLessThan(readiness.indexOf("const { release } = reconcileSource(root);"));
    expect(route.match(/import \{ reconcileKnexReadiness \}/gu)).toHaveLength(1);
    expect(doctor.match(/import \{ kNexApplicationReadyMarker, reconcileKnexReadiness \}/gu)).toHaveLength(1);
    expect(route.match(/reconcileKnexReadiness\(payload\)/gu)).toHaveLength(1);
    expect(doctor.match(/reconcileKnexReadiness\(payload\)/gu)).toHaveLength(1);
    expect(doctor.indexOf("await reconcileKnexReadiness(payload)")).toBeLessThan(doctor.indexOf("console.log(kNexApplicationReadyMarker)"));

    for (const guard of [
      "Package release manifest digest mismatch.",
      "Package file dependency inventory mismatch.",
      "Package archive inventory mismatch.",
      "Package archive integrity mismatch for ",
      "Package lock digest mismatch.",
      "Sales application manifest mismatch.",
      "provider.realtime.socketio",
      "payloadPostgresPatch",
      "Puck builder manifest mismatch.",
      "Theme manifest mismatch.",
      "Sales static registration identity mismatch.",
      "Generated route source inventory mismatch.",
      "Generated migration inventory mismatch.",
      "Sales table schema mismatch.",
      "Sales legacy schema was not retired.",
      "Application reporting timezone readiness mismatch.",
      "Administration operator configuration is missing.",
      "Administration operator credential is unreadable.",
      "Administration operator configuration is invalid.",
      "Authorization lifecycle state mismatch.",
      "Protected role baseline receipt mismatch.",
      "Bootstrap owner assignment mismatch.",
      "Sales authorization generation mismatch."
    ]) expect(readiness).toContain(guard);
    expect(readiness).toContain('entry.package === "@k-nex/provider-realtime-socketio" && entry.role === "provider"');
    expect(readiness).toContain("async function assertReportingTimezone");
    expect(readiness).toContain("documents.rows.length !== 1");
    expect(readiness).toContain("row?.descriptor_schema_version !== 2");
    expect(readiness).toContain("row.settings_revision > state.rows[0]!.settings_revision");
    expect(readiness).toContain('row.owner_kind !== "platform"');
    expect(readiness).toContain('row.owner_namespace !== "system"');
    expect(readiness).toContain("row.owner_delivery_class !== null");
    expect(readiness.indexOf("await assertSalesSchema(pool)")).toBeLessThan(readiness.indexOf("await assertReportingTimezone(pool)"));
    expect(readiness).toContain('"sales-accounts"');
    expect(readiness).toContain('"sales-attachment-references"');
    expect(readiness).toContain('"allowed_transition_stage_ids", "required_field_ids"');
    expect(readiness).toContain('legacyStages?.has("allowed_transitions")');
    expect(readiness).toContain("currentRevision !== 3");
    expect(readiness).toContain("predecessorRevisions, [1, 2]");
    expect(readiness).toContain("ApplicationManifestSchema.parse");
    expect(readiness).toContain("PackageReleaseManifestSchema.parse");
    expect(readiness).toContain("assertMigrationReadiness");
    expect(readiness.indexOf("await assertMigrationReadiness")).toBeLessThan(readiness.indexOf("await assertSalesSchema(pool)"));
    expect(doctor.indexOf("await reconcileKnexReadiness(payload)")).toBeLessThan(doctor.indexOf("console.log(kNexApplicationReadyMarker)"));
    expect(readiness).toContain("new NodeHttpsAdministrationOperatorClient");
    expect(readiness).toContain("assertExactProtectedRoleBaselineState");
    expect(readiness).toContain("currentProtectedPlatformRoleBaselineRelease");
    expect(readiness).toContain("authority.store.readTransaction(expected");
    expect(readiness).toMatch(/receipt\.authorizationRevision < 1 \|\| receipt\.authorizationRevision > expected\.authorizationRevision/u);
    expect(readiness).toMatch(/assignment\.state !== "active" && assignment\.state !== "revoked" \|\| assignment\.revision < 1/u);
    expect(readiness).toContain("kNexSalesRegistry.staticRelease.runtimeGenerationId");
    expect(readiness).toMatch(/generation\.state !== "current"/u);
    expect(readiness).toMatch(/generation\.authorizationRevision < kNexSalesRegistry\.authorizationGeneration\.authorizationRevision \|\| generation\.authorizationRevision > expected\.authorizationRevision/u);
    expect(readiness).toMatch(/generation\.lifecycleRevision < kNexSalesRegistry\.authorizationGeneration\.lifecycleRevision \|\| generation\.lifecycleRevision > expected\.lifecycleRevision/u);
    expect(readiness).not.toContain("receipt.authorizationRevision !== 1");
    expect(readiness).not.toContain("same(salesRole,");
    expect(readiness).not.toContain("expectedSalesGrants");
    expect(readiness).not.toContain("same(salesGenerations, [kNexSalesRegistry.authorizationGeneration])");
    expect(readiness).not.toContain('assignment.id === "customer.initial-sales-administrator.owner"');
    expect(readiness).toContain("expectedMigrationNames");
    expect(readiness).toContain("expectedRouteSources");
    expect(readiness).toContain('"src/app/(workspace)/system/extensions/[extensionId]/page.tsx"');
    expect(readiness).toContain('"src/app/api/system/themes/profiles/[profileId]/publish/route.ts"');
    expect(readiness).not.toContain("payload.destroy()");

    for (const name of ["K_NEX_ADMINISTRATION_OPERATOR_HOST", "K_NEX_ADMINISTRATION_OPERATOR_PORT", "K_NEX_ADMINISTRATION_OPERATOR_URI_SAN", "K_NEX_ADMINISTRATION_OPERATOR_IDENTITY"]) {
      expect(readiness).toContain(`requiredAdministrationOperatorConfiguration("${name}")`);
    }
    for (const name of ["K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY", "K_NEX_ADMINISTRATION_OPERATOR_CA_CERT"]) {
      expect(readiness).toContain(`administrationOperatorCredential("${name}")`);
    }
    expect(readiness).toContain('allowedCommandFamilies: ["extension-lifecycle"]');
    expect(readiness).toContain("const certificate = administrationOperatorCredential");
    expect(readiness).toContain("const privateKey = administrationOperatorCredential");
    expect(readiness).toContain("const certificateAuthority = administrationOperatorCredential");
    expect(readiness).toContain("Number(requiredAdministrationOperatorConfiguration(\"K_NEX_ADMINISTRATION_OPERATOR_PORT\"))");
    expect(readiness).toContain('catch { fail("Administration operator configuration is invalid."); }');

    expect(route).toContain('status: "ready", applicationId: readiness.applicationId, authorizationRevision: readiness.authorizationRevision, lifecycleRevision: readiness.lifecycleRevision');
    expect(route).toContain('status: "not-ready" }, { status: 503');
    expect(route).not.toContain("readState(");
    expect(route).not.toContain("readProtectedRoleBaselineReceipt");
    expect(doctor).not.toContain("const missing =");
    expect(doctor).not.toContain("readState(");
  });

  it("executes readiness against the persisted general document revision and owner", async () => {
    const readiness = applicationAuthFiles({ applicationId: "customer-alpha" })["src/k-nex-readiness.ts"]!;
    const body = readiness.slice(readiness.indexOf("async function assertReportingTimezone"), readiness.indexOf("export async function reconcileKnexReadiness"));
    const executable = ts.transpileModule(`${body}\nreturn assertReportingTimezone;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const validate = new Function("kNexIdentity", "canonicalIana", "fail", executable)({ applicationId: "app", environment: "production" }, (value: unknown) => value === "UTC", (message: string) => { throw new Error(message); }) as (pool: unknown) => Promise<void>;
    const document = { descriptor_schema_version: 2, owner_scope_key: "platform:system", owner_kind: "platform", owner_namespace: "system", owner_delivery_class: null, owner_extension_id: null, owner_generation: null, document_revision: 4, settings_revision: 3, values_json: { reportingTimezone: "UTC" } };
    const pool = (stateRevision: number, row: unknown) => ({ query: async (statement: string) => ({ rows: statement.includes("k_nex_system_settings_state") ? [{ settings_revision: stateRevision }] : [row] }) });
    await expect(validate(pool(5, document))).resolves.toBeUndefined();
    await expect(validate(pool(2, document))).rejects.toThrow("readiness mismatch");
    await expect(validate(pool(5, { ...document, owner_kind: "extension" }))).rejects.toThrow("readiness mismatch");
  });
});
