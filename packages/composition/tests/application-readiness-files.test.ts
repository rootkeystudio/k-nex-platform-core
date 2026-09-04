import { describe, expect, it } from "vitest";

import { applicationAuthFiles } from "../src/application-auth-files.js";

describe("generated application readiness", () => {
  it.each(["minimal", "neobrutalism"] as const)("shares one fail-closed reconciler for the %s application", (theme) => {
    const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme });
    const readiness = files["src/k-nex-readiness.ts"]!;
    const route = files["src/app/api/readiness/route.ts"]!;
    const doctor = files["src/k-nex-doctor.ts"]!;

    expect(readiness).toContain("export async function reconcileKnexReadiness(payload: Payload)");
    expect(readiness).toContain('export const kNexApplicationReadyMarker = "K_NEX_APPLICATION_READY"');
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
      "Puck builder manifest mismatch.",
      "Theme manifest mismatch.",
      "Sales static registration identity mismatch.",
      "Generated route source inventory mismatch.",
      "Generated migration inventory mismatch.",
      "Sales table schema mismatch.",
      "Sales enum schema mismatch.",
      "Authorization lifecycle state mismatch.",
      "Protected role baseline receipt mismatch.",
      "Bootstrap owner assignment mismatch.",
      "Sales authorization generation mismatch."
    ]) expect(readiness).toContain(guard);
    expect(readiness).toContain("ApplicationManifestSchema.parse");
    expect(readiness).toContain("PackageReleaseManifestSchema.parse");
    expect(readiness).toContain("assertMigrationReadiness");
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

    expect(route).toContain('status: "ready", applicationId: readiness.applicationId, authorizationRevision: readiness.authorizationRevision, lifecycleRevision: readiness.lifecycleRevision');
    expect(route).toContain('status: "not-ready" }, { status: 503');
    expect(route).not.toContain("readState(");
    expect(route).not.toContain("readProtectedRoleBaselineReceipt");
    expect(doctor).not.toContain("const missing =");
    expect(doctor).not.toContain("readState(");
  });
});
