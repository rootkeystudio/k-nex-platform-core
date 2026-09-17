import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationManifestSchema, PackageReleaseManifestSchema, PluginManifestSchema, canonicalJson, supportedFrameworkTuple, type PackageReleaseManifest, type PackageReleaseManifestAuthority, type VerifiedPackageReleaseManifest } from "@k-nex/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { executeRegistration } from "../../runtime/src/registration-runtime.js";
import { socketIoRealtimeProviderRegistration } from "../../realtime-socketio/src/server.js";
import { salesRegistration } from "../../../modules/sales/src/server.js";
import { applicationAuthFiles } from "../src/application-auth-files.js";
import { applyCreateKnexApplication, isReleaseBeforeSalesReferenceExit, payloadPostgresPatchDigest, payloadPostgresPatchFilename, payloadPostgresPatchProvenance, payloadPostgresPatchSource, planCreateKnexApplication, planUpgradeTargetKnexApplication, salesReferenceCompilerBoundary, setSalesReferenceCompilerTestMutationForTests, type SourceApplicationManifestAuthority, type VerifiedSourceApplicationManifest } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function verifiedPackageSource(manifestInput: unknown, directory: string) {
  const manifest = PackageReleaseManifestSchema.parse(manifestInput);
  const values = new WeakMap<object, { manifest: PackageReleaseManifest; digest: string; attestation: unknown }>();
  const authority: PackageReleaseManifestAuthority = {
    async verify() { throw new Error("Test authority does not accept unissued manifests."); },
    read(token) {
      const value = values.get(token);
      if (value === undefined) throw new Error("Test release manifest was not issued by this authority.");
      return value;
    }
  };
  const release = Object.freeze({}) as VerifiedPackageReleaseManifest;
  values.set(release, { manifest, digest: `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`, attestation: Object.freeze({}) });
  return { kind: "packed-mirror" as const, directory, authority, release };
}

function bundledPackageSource() {
  const release = JSON.parse(readFileSync(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url), "utf8"));
  const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
  return verifiedPackageSource(release, mirror);
}

function verifiedSourceManifest(manifestInput: unknown) {
  const manifest = ApplicationManifestSchema.parse(manifestInput);
  const digest = `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`;
  const values = new WeakMap<object, { manifest: typeof manifest; digest: string }>();
  const authority: SourceApplicationManifestAuthority = { read(token) { const value = values.get(token); if (value === undefined) throw new Error("Source application manifest was not issued by this authority."); return value; } };
  const token = Object.freeze({}) as VerifiedSourceApplicationManifest;
  values.set(token, { manifest, digest });
  return { authority, token, digest };
}

const realtimeManifestInput = JSON.parse(readFileSync(new URL("../../realtime-socketio/k-nex.plugin.json", import.meta.url), "utf8"));
const salesManifestInput = JSON.parse(readFileSync(new URL("../../../modules/sales/k-nex.plugin.json", import.meta.url), "utf8"));

function executeEmittedRegistry(releaseVersion: "1.0.0" | "1.1.0") {
  const realtimeManifest = PluginManifestSchema.parse({ ...realtimeManifestInput, version: releaseVersion });
  const salesManifest = PluginManifestSchema.parse({ ...salesManifestInput, version: releaseVersion });
  const realtimeGateway = realtimeManifest.provides.find(({ capability }) => capability === "realtime.gateway");
  if (realtimeGateway === undefined) throw new Error("Realtime gateway capability fixture is unavailable.");
  const salesIntegrity = `sha512-${"a".repeat(86)}==`;
  const realtimeIntegrity = `sha512-${"b".repeat(86)}==`;
  return executeRegistration({
    graph: {
      resolverVersion: "1.0.0",
      plugins: [
        { id: realtimeManifest.id, kind: realtimeManifest.kind, package: realtimeManifest.package, version: realtimeManifest.version, integrity: realtimeIntegrity, required: [], optional: [] },
        { id: salesManifest.id, kind: salesManifest.kind, package: salesManifest.package, version: salesManifest.version, integrity: salesIntegrity, required: [], optional: [] }
      ],
      capabilityProviders: [{ capability: realtimeGateway.capability, plugin: realtimeManifest.id, version: realtimeGateway.version }],
      registrationOrder: [realtimeManifest.id, salesManifest.id]
    },
    installed: [
      { package: { name: realtimeManifest.package, version: realtimeManifest.version, integrity: realtimeIntegrity }, manifest: realtimeManifest },
      { package: { name: salesManifest.package, version: salesManifest.version, integrity: salesIntegrity }, manifest: salesManifest }
    ],
    registrations: [socketIoRealtimeProviderRegistration, salesRegistration]
  });
}

function hostedVerification(manifestInput: unknown) {
  const manifest = PackageReleaseManifestSchema.parse(manifestInput);
  const sourceCommit = "a".repeat(40);
  const workflowIdentity = `rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@${sourceCommit}`;
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "package-release-manifest.json", digest: { sha256: createHash("sha256").update(canonicalJson(manifest)).digest("hex") } }],
    predicateType: "https://k-nex.dev/release-manifest/v1",
    predicate: { sourceCommit, workflowIdentity, materials: [] }
  };
  return [{
    attestation: { bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } },
    verificationResult: { statement, signature: { certificate: {
      githubWorkflowRepository: "rootkeystudio/k-nex-platform-core", runnerEnvironment: "github-hosted", sourceRepositoryDigest: sourceCommit,
      githubWorkflowSHA: sourceCommit, buildConfigDigest: sourceCommit, githubWorkflowRef: "refs/heads/main",
      buildConfigURI: "https://github.com/rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml@refs/heads/main"
    } } }
  }];
}

function fakeGh(root: string, verification: unknown) {
  const directory = join(root, "bin"); mkdirSync(directory);
  const path = join(directory, "gh");
  writeFileSync(path, `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.GH_ARGS_LOG, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(JSON.stringify(verification))});\n`);
  chmodSync(path, 0o755);
  return directory;
}

describe("create-knex-app", () => {
  it("keeps the exact source selected graph in upgrade target generation", () => {
    const options = { applicationId: "sales-only-upgrade", applicationName: "Sales-only Upgrade", theme: "minimal", database: "external" } as const;
    const creation = planCreateKnexApplication(options);
    const source = JSON.parse(creation.files["k-nex.app.json"]!);
    delete source.runtime.realtime; source.plugins = source.plugins.filter(({ id }: { id: string }) => id === "module.sales"); source.providers = {};
    source.application.name = "Preserved source name";
    const verified = verifiedSourceManifest(source);
    const target = planUpgradeTargetKnexApplication({ sourceManifestAuthority: verified.authority, sourceManifest: verified.token, sourceManifestDigest: verified.digest });
    const targetManifest = JSON.parse(target.files["k-nex.app.json"]!);
    expect(targetManifest.plugins.map(({ id }: { id: string }) => id)).toEqual(["module.sales"]);
    expect(targetManifest.application.name).toBe("Preserved source name");
    expect(targetManifest).toEqual(source);
    expect(target.files["src/k-nex-registry.ts"]).not.toMatch(/provider\.realtime|kNexRealtimeRegistry/u);
    expect(JSON.parse(creation.files["k-nex.app.json"]!).plugins.map(({ id }: { id: string }) => id)).toContain("provider.realtime.socketio");
    const unsupportedGraph = verifiedSourceManifest({ ...source, plugins: [...source.plugins, { id: "integration.unknown", package: "@k-nex/unknown", version: "1.0.0", enabled: true }] });
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: unsupportedGraph.authority, sourceManifest: unsupportedGraph.token, sourceManifestDigest: unsupportedGraph.digest })).toThrow(/exact source Sales\/realtime selected graph/u);
    const disabled = verifiedSourceManifest({ ...source, plugins: source.plugins.map((plugin: Record<string, unknown>) => ({ ...plugin, enabled: false })) });
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: disabled.authority, sourceManifest: disabled.token, sourceManifestDigest: disabled.digest })).toThrow(/compiled plugin state/u);
    const configured = verifiedSourceManifest({ ...source, plugins: source.plugins.map((plugin: Record<string, unknown>) => ({ ...plugin, options: { tenant: "customer" } })) });
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: configured.authority, sourceManifest: configured.token, sourceManifestDigest: configured.digest })).toThrow(/compiled plugin state/u);
    const realtimeSource = JSON.parse(creation.files["k-nex.app.json"]!);
    const configuredProvider = verifiedSourceManifest({ ...realtimeSource, providers: { "realtime.gateway": { ...realtimeSource.providers["realtime.gateway"], options: { channel: "customer" } } } });
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: configuredProvider.authority, sourceManifest: configuredProvider.token, sourceManifestDigest: configuredProvider.digest })).toThrow(/provider configuration/u);
    const configuredBuilder = verifiedSourceManifest({ ...source, builder: { ...source.builder, profiles: { workspace: { enabled: true, drafts: false, surfaces: ["workspace"] } } } });
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: configuredBuilder.authority, sourceManifest: configuredBuilder.token, sourceManifestDigest: configuredBuilder.digest })).toThrow(/builder configuration/u);
    const nondefaultCreation = planCreateKnexApplication({ applicationId: "preserved-nondefault", applicationName: "Preserved Nondefault", theme: "neobrutalism", database: "docker-postgres" });
    const nondefaultSource = JSON.parse(nondefaultCreation.files["k-nex.app.json"]!);
    nondefaultSource.$schema = "https://customer.invalid/k-nex-application-schema.json";
    nondefaultSource.environment.required.push("CUSTOMER_REQUIRED_SETTING");
    const nondefaultVerified = verifiedSourceManifest(nondefaultSource);
    expect(JSON.parse(planUpgradeTargetKnexApplication({ sourceManifestAuthority: nondefaultVerified.authority, sourceManifest: nondefaultVerified.token, sourceManifestDigest: nondefaultVerified.digest }).files["k-nex.app.json"]!)).toEqual(nondefaultSource);
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: verified.authority, sourceManifest: verified.token, sourceManifestDigest: `sha256:${"0".repeat(64)}` })).toThrow(/digest is stale/u);
    expect(() => planUpgradeTargetKnexApplication({ sourceManifestAuthority: verified.authority, sourceManifest: Object.freeze({}) as VerifiedSourceApplicationManifest, sourceManifestDigest: verified.digest })).toThrow(/not issued/u);
  });
  it("freezes the temporary Sales-reference compiler boundary", () => {
    expect(salesReferenceCompilerBoundary).toMatchObject({
      name: "sales-reference-compiler",
      owner: "Sales module maintainers",
      exitBefore: "1.2.0, Phase 14, a second domain, or any generic compiler claim (whichever comes first)",
      firstPartyDomains: ["module.sales"],
      runtimePaths: [
        "src/app/(workspace)/sales/accounts/[id]/page.tsx",
        "src/app/(workspace)/sales/accounts/page.tsx",
        "src/app/(workspace)/sales/calendar/page.tsx",
        "src/app/(workspace)/sales/contacts/[id]/page.tsx",
        "src/app/(workspace)/sales/contacts/page.tsx",
        "src/app/(workspace)/sales/exports/page.tsx",
        "src/app/(workspace)/sales/imports/page.tsx",
        "src/app/(workspace)/sales/leads/[id]/page.tsx",
        "src/app/(workspace)/sales/leads/page.tsx",
        "src/app/(workspace)/sales/notifications/page.tsx",
        "src/app/(workspace)/sales/opportunities/[id]/page.tsx",
        "src/app/(workspace)/sales/opportunities/page.tsx",
        "src/app/(workspace)/sales/page.tsx",
        "src/app/(workspace)/sales/reports/page.tsx",
        "src/app/(workspace)/sales/settings/page.tsx",
        "src/app/(workspace)/sales/settings/pipeline/page.tsx",
        "src/app/(workspace)/sales/tasks/page.tsx",
        "src/app/(workspace)/sales/views/page.tsx",
        "src/app/api/k-nex/sales/actions/[actionId]/route.ts",
        "src/app/api/k-nex/sales/authority-scopes/route.ts",
        "src/app/api/k-nex/sales/export-artifact/route.ts",
        "src/app/api/k-nex/sales/import-upload/route.ts",
        "src/app/api/k-nex/sales/providers/calendar-reference/webhook/route.ts",
        "src/app/api/k-nex/sales/providers/email-reference/webhook/route.ts",
        "src/app/api/k-nex/sales/report-artifact/route.ts",
        "src/app/api/k-nex/sales/routes/[routeId]/route.ts",
        "src/app/components/k-nex-sales-route-runtime.tsx",
        "src/k-nex-issue-attachment-upload-receipt.ts",
        "src/k-nex-sales-communications.ts",
        "src/k-nex-sales-data-movement.ts",
        "src/k-nex-sales-reports.ts",
        "src/k-nex-sales-routes.ts",
        "src/k-nex-sales-scope-administration.ts",
        "src/k-nex-sales-workflows.ts",
        "src/k-nex-sales-workspace.ts"
      ],
      migrationPaths: [
        "src/migrations/20260827_000001_sales_baseline.ts",
        "src/migrations/20260905_000027_crm_core.ts",
        "src/migrations/20260906_000029_attachment_upload_admissions.ts",
        "src/migrations/20260907_000030_pipeline_saved_views.ts",
        "src/migrations/20260907_000031_data_movement.ts",
        "src/migrations/20260908_000032_communications.ts",
        "src/migrations/20260908_000033_crm_workflows.ts",
        "src/migrations/20260908_000034_reports.ts"
      ]
    });

    expect(salesReferenceCompilerBoundary.platformPaths).toHaveLength(103);
    const options = { applicationId: "sales-boundary", applicationName: "Sales Boundary", theme: "minimal", database: "external", primaryCurrency: "USD" } as const;
    expect(() => planCreateKnexApplication(options)).not.toThrow();
    const expectRejectedPlan = (mutation: "add-sales-output" | "remove-sales-output" | "second-domain", error: RegExp): void => {
      setSalesReferenceCompilerTestMutationForTests(mutation);
      try { expect(() => planCreateKnexApplication(options)).toThrow(error); } finally { setSalesReferenceCompilerTestMutationForTests(undefined); }
    };
    expectRejectedPlan("add-sales-output", /unknown=src\/k-nex-sales-unreviewed\.ts/u);
    expectRejectedPlan("remove-sales-output", /missingSales=src\/app\/\(workspace\)\/sales\/accounts\/\[id\]\/page\.tsx/u);
    expectRejectedPlan("second-domain", /sole first-party domain/u);
  });

  it("expires the Sales-reference compiler on the platform release, not the generated package version", () => {
    // The generated package.json carries a fixed version, so a guard reading it
    // could never fire. These are the releases the boundary must refuse.
    for (const release of ["1.2.0", "1.2.0-rc.1", "1.3.4", "2.0.0"]) {
      expect(isReleaseBeforeSalesReferenceExit(release)).toBe(false);
    }
    for (const release of ["1.0.0", "1.1.0", "1.1.9", "0.9.0"]) {
      expect(isReleaseBeforeSalesReferenceExit(release)).toBe(true);
    }
    expect(isReleaseBeforeSalesReferenceExit(supportedFrameworkTuple.core)).toBe(true);
    expect(isReleaseBeforeSalesReferenceExit("not-a-release")).toBe(false);
  });

  it("serializes generated JSX application names", () => {
    for (const applicationName of ["Workspace {alpha}", 'Workspace "alpha"', "Workspace\nalpha", "Workspace\u0000\u001f\talpha"]) {
      const files = applicationAuthFiles({ applicationId: "customer-alpha", applicationName, theme: "minimal" });
      const expression = `{${JSON.stringify(applicationName)}}`;
      expect(files["src/app/(workspace)/page.tsx"]).toContain(`<h1>${expression}</h1>`);
      expect(files["src/app/(workspace)/layout.tsx"]).toContain(`applicationLabel=${expression}`);
    }
  });

  it("emits exact-token owner bootstrap recovery across every commit boundary", () => {
    const source = applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", primaryCurrency: "USD", theme: "minimal" })["src/k-nex-bootstrap-owner.ts"]!;
    expect(source).toContain("assertResumableOwnerReceipt(priorReceipt, String(user.id))");
    expect(source).toContain("on conflict (application_id,environment) do nothing returning settings_revision");
    expect(source).toContain('reportingCurrency: "USD"');
    expect(source.indexOf("if (priorReceipt !== undefined && existing.docs[0] === undefined)")).toBeLessThan(source.indexOf("await payload.create"));
    expect(source.indexOf('crashAfterCommit("protected-owner")')).toBeLessThan(source.indexOf('crashAfterCommit("sales-authority")'));
    expect(source.indexOf("await ensureInitialSystemSettings(payload)")).toBeLessThan(source.indexOf("await ensureInitialSalesOwner(payload"));
    expect(source.indexOf('crashAfterCommit("sales-authority")')).toBeLessThan(source.indexOf('crashAfterCommit("token-consumption")'));
    expect(source).not.toContain('if (priorReceipt !== undefined) throw new Error("First owner already exists.")');
    expect(applicationAuthFiles({ applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal" })["src/k-nex-bootstrap-owner.ts"]).not.toContain("ensureInitialSystemSettings");
  });

  it("plans deterministic exact Sales applications for local or external Postgres", () => {
    const options = { applicationId: "customer-alpha", applicationName: "Customer Alpha", theme: "minimal", database: "docker-postgres", primaryCurrency: "USD" } as const;
    const first = planCreateKnexApplication(options);
    expect(planCreateKnexApplication(options)).toEqual(first);
    expect(first.files["compose.yaml"]).toContain("postgres:17.6-alpine@sha256:");
    const manifest = ApplicationManifestSchema.parse(JSON.parse(first.files["k-nex.app.json"]!));
    expect(manifest.plugins).toEqual([
      { id: "module.sales", package: "@k-nex/module-sales", version: "1.1.0", enabled: true },
      { id: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.1.0", enabled: true }
    ]);
    expect(manifest.providers).toEqual({ "realtime.gateway": { plugin: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.1.0" } });
    expect(manifest.builder).toEqual({ plugin: "builder.puck", package: "@k-nex/builder-puck", version: "1.1.0", profiles: { workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } } });
    expect(manifest.environment.required).toEqual(["DATABASE_URL", "K_NEX_ADMINISTRATION_OPERATOR_CA_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY", "K_NEX_ADMINISTRATION_OPERATOR_HOST", "K_NEX_ADMINISTRATION_OPERATOR_IDENTITY", "K_NEX_ADMINISTRATION_OPERATOR_PORT", "K_NEX_ADMINISTRATION_OPERATOR_URI_SAN", "K_NEX_ENVIRONMENT", "K_NEX_GENERATION", "K_NEX_PUBLIC_ORIGIN", "PAYLOAD_SECRET"]);
    expect(supportedFrameworkTuple.core).toBe("1.1.0");
    expect(manifest.plugins.every((plugin) => plugin.version === supportedFrameworkTuple.core)).toBe(true);
    expect(manifest.providers["realtime.gateway"]?.version).toBe(supportedFrameworkTuple.core);
    expect(manifest.builder?.version).toBe(supportedFrameworkTuple.core);
    expect(manifest.themes.version).toBe(supportedFrameworkTuple.core);
    const generatedPackageJson = JSON.parse(first.files["package.json"]!);
    expect(Object.entries(generatedPackageJson.dependencies).filter(([name]) => name.startsWith("@k-nex/")).every(([, version]) => version === supportedFrameworkTuple.core)).toBe(true);
    expect(generatedPackageJson.dependencies).toMatchObject({ payload: "3.88.0", "@k-nex/builder-puck": "1.1.0", "@k-nex/module-sales": "1.1.0", "@k-nex/provider-realtime-socketio": "1.1.0", "@k-nex/theme-minimal": "1.1.0" });
    expect(first.files["src/payload.config.ts"]).toContain("kNexSalesRegistry.collections");
    expect(first.files["src/app/(workspace)/system/access/roles/page.tsx"]).toContain("SystemRolesPage");
    expect(first.files["src/app/(workspace)/system/access/permissions/page.tsx"]).toContain("SystemPermissionsPage");
    expect(first.files["src/app/(workspace)/system/access/assignments/page.tsx"]).toContain("SystemAssignmentsPage");
    expect(first.files["src/app/(workspace)/system/access/audit/page.tsx"]).toContain("SystemAuthorizationAuditPage");
    expect(first.files["src/app/(workspace)/system/themes/page.tsx"]).toContain("SystemThemesPage");
    expect(first.files["src/app/(workspace)/system/settings/page.tsx"]).toContain("SystemSettingsPage");
    expect(first.files["src/app/(workspace)/system/extensions/page.tsx"]).toContain("SystemExtensionsPage");
    expect(first.files["src/app/(workspace)/system/operations/page.tsx"]).toContain("SystemOperationsPage");
    expect(first.files["src/payload.config.ts"]).toContain("prodMigrations: migrations");
    expect(first.files["src/payload.config.ts"]).toContain("allowIDOnCreate: true");
    expect(first.files["src/payload.config.ts"]).toContain('import { withTrustedSalesTaskCreateIdAdmission } from "@k-nex/payload-adapter";');
    expect(first.files["src/payload.config.ts"]).toContain(".map(withTrustedSalesTaskCreateIdAdmission)");
    expect(first.files["src/payload.config.ts"]).toContain('kNexApplicationId: "customer-alpha"');
    expect(first.files["src/boot.ts"]).toContain("bootKnexApplication");
    expect(first.files["src/boot.ts"]).toContain('import { salesCoreCollectionSlugs } from "@k-nex/module-sales/server"');
    expect(first.files["src/boot.ts"]).toContain('const requiredCollections = [...salesCoreCollectionSlugs, "users"]');
    const generatedMigrationNames = [...first.files["src/migrations/index.ts"]!.matchAll(/name: "([^"]+)"/gu)].map(([, name]) => name);
    expect(generatedMigrationNames).toEqual([
      "20260827_000001_sales_baseline",
      "20260827_000002_knex_bootstrap",
      "20260829_000007_runtime_extensions",
      "20260901_000019_authorization",
      "20260901_000022_static_lifecycle_admission",
      "20260902_000023_system_administration",
      "20260903_000026_workspace_pages",
      "20260903_000027_event_outbox",
      "20260904_000028_workspace_sidebar_preferences",
      "20260905_000027_crm_core",
      "20260906_000029_attachment_upload_admissions",
      "20260907_000030_pipeline_saved_views",
      "20260907_000031_data_movement",
      "20260908_000032_communications",
      "20260908_000033_crm_workflows",
      "20260908_000034_reports",
      "20260909_000035_static_rebind_lock_protocol"
    ]);
    const attachmentAdmissions = first.files["src/migrations/20260906_000029_attachment_upload_admissions.ts"]!;
    expect(attachmentAdmissions).toContain('CREATE TABLE "k_nex_sales_attachment_upload_admissions"');
    expect(attachmentAdmissions).toContain('length("storage_ref") BETWEEN 1 AND 512');
    expect(attachmentAdmissions).toContain('length("media_type") BETWEEN 1 AND 128');
    expect(attachmentAdmissions).not.toContain("{0,511}");
    expect(attachmentAdmissions).toContain('PRIMARY KEY ("application_id", "environment", "storage_ref")');
    expect(first.files["src/k-nex-issue-attachment-upload-receipt.ts"]).toContain("K_NEX_ATTACHMENT_UPLOAD_RECEIPT_ISSUED");
    expect(first.files["src/k-nex-issue-attachment-upload-receipt.ts"]).toContain("mediaType.length > 128");
    expect(first.files["package.json"]).toContain("knex:issue-attachment-upload-receipt");
    expect(first.files["tsconfig.json"]).toContain('"moduleResolution": "bundler"');
    expect(first.files["tsconfig.scripts.json"]).toContain('"module": "NodeNext"');
    expect(first.files["src/k-nex-registry.ts"]).toContain("salesRegistration");
    expect(first.files["src/k-nex-registry.ts"]).toContain("socketIoRealtimeProviderRegistration");
    expect(first.files["src/k-nex-registry.ts"]).toContain('const realtimeGateway = realtimeManifest.provides.find(({ capability }) => capability === "realtime.gateway");');
    expect(first.files["src/k-nex-registry.ts"]).toContain('capability: "realtime.gateway", plugin: realtimeManifest.id, version: realtimeGateway.version');
    expect(first.files["src/k-nex-theme-runtime.ts"]).toContain(`profile.themeId !== "theme.minimal" || profile.themeVersion !== "${supportedFrameworkTuple.core}"`);
    expect(first.files["src/migrations/20260827_000002_knex_bootstrap.ts"]).toContain("platform-1.1.0-bootstrap");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("createSocketIoMemoryGateway");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("currentPayloadAuthentication");
    expect(first.files["src/k-nex-realtime.ts"]).toContain('channel = "k_nex_runtime_invalidation"');
    expect(first.files["src/k-nex-realtime.ts"]).toContain('exactObject(JSON.parse(notification.payload), ["applicationId", "environment", "invalidation", "type"])');
    expect(first.files["src/k-nex-realtime.ts"]).toContain("envelope.applicationId !== kNexIdentity.applicationId || envelope.environment !== kNexIdentity.environment || envelope.type !== \"realtime\"");
    expect(first.files["src/k-nex-realtime.ts"]).toContain('envelope.type !== "realtime"');
    expect(first.files["src/k-nex-realtime.ts"]).toContain("listener?.release(true)");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("await gateway.close().catch(() => undefined)");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("await currentSalesGeneration(payload)");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("sales_current_authority_scopes");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("recordScope: scope.recordScope");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("salesScopeRevision: scope.revision");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("createCurrentAuthorityTarget");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("pendingAuthorizations");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("const actorHeaders = new WeakMap<object, Headers>()");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("trackAuthorization(Promise.resolve().then(() => currentPayloadAuthentication");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("await Promise.allSettled([...pendingAuthorizations])");
    expect(first.files["src/k-nex-realtime.ts"]).toContain("finalGeneration.state.authorizationRevision === initialGeneration.state.authorizationRevision");
    expect(first.files["src/k-nex-web.ts"]).toContain("startKnexRealtime(payload, server)");
    expect(first.files["src/k-nex-web.ts"]).toContain("realtime?.close()");
    expect(first.files["src/k-nex-web.ts"]).toContain("const admittedHandlers = new Map<Promise<void>, AdmittedHandlerMetadata>();");
    expect(first.files["src/k-nex-web.ts"]).toContain("const maxRetainedHandlerFailures = 16;");
    expect(first.files["src/k-nex-web.ts"]).toContain("const admitted = Promise.resolve().then(operation).then(");
    expect(first.files["src/k-nex-web.ts"]).toContain("admittedHandlers.set(admitted, metadata);");
    expect(first.files["src/k-nex-web.ts"]).toContain("while (admittedHandlers.size > 0) await Promise.all([...admittedHandlers.keys()]);");
    expect(first.files["src/k-nex-web.ts"]).toContain('throw new AggregateError(admittedHandlerFailures, "K-Nex admitted web handler failed.");');
    expect(first.files["src/k-nex-web.ts"]).toContain('trackHandler(handlerMetadata("request", request), async () => handler(request, response)');
    expect(first.files["src/k-nex-web.ts"]).toContain('trackHandler(handlerMetadata("upgrade", request), async () => upgrade(request, socket, head)');
    expect(first.files["src/k-nex-web.ts"]).toContain('JSON.stringify({ stage: shutdownStage, activeHandlerCount: admittedHandlers.size, handlers: [...admittedHandlers.values()].slice(0, 16), history: shutdownHistory, failureStages: shutdownFailureStages })');
    const webHandlerDiagnostics = first.files["src/k-nex-web.ts"]!.slice(first.files["src/k-nex-web.ts"]!.indexOf("function handlerMetadata"), first.files["src/k-nex-web.ts"]!.indexOf("function retainHandlerFailure"));
    expect(webHandlerDiagnostics).toContain('new URL(request.url ?? "/", "http://k-nex.invalid").pathname');
    expect(webHandlerDiagnostics).toContain("pathname.slice(0, maxDiagnosticPathnameLength)");
    expect(webHandlerDiagnostics).toContain("performance.now()");
    expect(webHandlerDiagnostics).not.toMatch(/headers|cookie|body|search|query/iu);
    expect(first.files["src/k-nex-web.ts"]).toContain('shutdownStage = "payload-" + progress.stage;');
    expect(first.files["src/k-nex-web.ts"]).toContain("const maxShutdownDiagnostics = 16;");
    expect(first.files["src/k-nex-web.ts"]).toContain('type ShutdownSnapshot = Readonly<{ stage: string; totalCount: number; idleCount: number; waitingCount: number }>;');
    expect(first.files["src/k-nex-web.ts"]).toContain('shutdownHistory.push(Object.freeze({ stage, totalCount: boundedPoolCount(pool?.totalCount), idleCount: boundedPoolCount(pool?.idleCount), waitingCount: boundedPoolCount(pool?.waitingCount) }));');
    expect(first.files["src/k-nex-web.ts"]).toContain('if (shutdownHistory.length >= maxShutdownDiagnostics) return;');
    expect(first.files["src/k-nex-web.ts"]).toContain('if (shutdownFailureStages.length < maxShutdownDiagnostics) shutdownFailureStages.push(stage);');
    expect(first.files["src/k-nex-web.ts"]).toContain('console.error("K_NEX_GRACEFUL_SHUTDOWN_FAILED", shutdownDiagnostic());');
    const poolDiagnostics = first.files["src/k-nex-web.ts"]!.slice(first.files["src/k-nex-web.ts"]!.indexOf("type ShutdownSnapshot"), first.files["src/k-nex-web.ts"]!.indexOf("function handlerMetadata"));
    expect(poolDiagnostics).not.toMatch(/_clients|_idle|connection|backend|sql|actor|principal|headers|cookie/iu);
    expect(first.files["src/k-nex-web.ts"]).not.toContain("closeAllConnections");
    const webShutdown = first.files["src/k-nex-web.ts"]!;
    const shutdownSnapshots = ["shutdown-start", "before-realtime", "after-realtime", "after-server", "after-handler", "after-next", "before-workspace", "after-workspace", "before-authority", "after-authority", "before-payload-destroy", "after-payload-destroy", "before-pool-end"];
    let priorSnapshot = webShutdown.indexOf("async function stop");
    for (const stage of shutdownSnapshots) {
      const snapshot = webShutdown.indexOf(`recordShutdownSnapshot(${JSON.stringify(stage)})`, priorSnapshot);
      expect(snapshot).toBeGreaterThan(priorSnapshot);
      priorSnapshot = snapshot;
    }
    expect(webShutdown.indexOf('await attempt("realtime-close", async () => realtime?.close());', webShutdown.indexOf("async function stop"))).toBeLessThan(webShutdown.indexOf("for (const socket of upgradedSockets) socket.destroy();", webShutdown.indexOf("async function stop")));
    expect(webShutdown.indexOf("for (const socket of upgradedSockets) socket.destroy();", webShutdown.indexOf("async function stop"))).toBeLessThan(webShutdown.indexOf("server.close((error)", webShutdown.indexOf("async function stop")));
    expect(webShutdown.indexOf("server.close((error)", webShutdown.indexOf("async function stop"))).toBeLessThan(webShutdown.indexOf('await attempt("handler-drain", drainAdmittedHandlers);', webShutdown.indexOf("async function stop")));
    expect(webShutdown.indexOf('await attempt("handler-drain", drainAdmittedHandlers);', webShutdown.indexOf("async function stop"))).toBeLessThan(webShutdown.indexOf('await attempt("next-close", async () => nextApp.close());', webShutdown.indexOf("async function stop")));
    expect(first.files["src/k-nex-web.ts"]).toContain("const startupCleanupMs = 5_000;");
    expect(first.files["src/k-nex-web.ts"]).toContain("K_NEX_STARTUP_CLEANUP_EXPIRED");
    expect(first.files["src/k-nex-web.ts"]).toContain('throw new AggregateError(failures, "K-Nex startup and cleanup failed.");');
    expect(first.files["src/k-nex-web.ts"]).not.toContain("await realtime?.close().catch(() => undefined);");
    expect(first.files["src/k-nex-web.ts"]!.indexOf("startKnexRealtime(payload, server)")).toBeLessThan(first.files["src/k-nex-web.ts"]!.indexOf('server.once("error", failed)'));
    expect(first.files["src/k-nex-worker.ts"]).toContain("K_NEX_WORKER_SHUTDOWN_EXPIRED");
    expect(first.files["src/k-nex-worker.ts"]).not.toContain("shutdownDeadline.unref()");
    expect(first.files["src/k-nex-worker.ts"]!.indexOf('process.on("SIGINT", stop); process.on("SIGTERM", stop);')).toBeLessThan(first.files["src/k-nex-worker.ts"]!.indexOf('console.log("K_NEX_WORKER_READY");'));
    expect(first.files["src/k-nex-worker.ts"]).toContain("authorizationWorker.idle()");
    expect(first.files["src/k-nex-worker.ts"]).toContain("const admittedFailures: unknown[] = [];");
    expect(first.files["src/k-nex-worker.ts"]).toContain("function failShutdown(error: unknown): never");
    expect(first.files["src/k-nex-worker.ts"]).toContain('failShutdown(new AggregateError(admittedFailures, "K-Nex worker admitted dispatch failed."));');
    expect(first.files["src/k-nex-web.ts"]).toContain('server.off("error", failed)');
    expect(first.files["src/k-nex-web.ts"]).toContain('server.on("error", (error) => {');
    expect(first.files["src/k-nex-web.ts"]).toContain('K_NEX_SERVER_FAILURE_CLEANUP_EXPIRED');
    expect(first.files["src/k-nex-web.ts"]).toContain("async function failStartup(error: unknown, closeServer: boolean): Promise<never>");
    expect(first.files["src/k-nex-web.ts"]).toContain("await failStartup(error, false);");
    expect(first.files["src/k-nex-web.ts"]).toContain("await failStartup(error, true);");
    expect(first.files["src/k-nex-web.ts"]).not.toContain(".catch(() => undefined)");
    expect(first.files["src/k-nex-web.ts"]).toContain("if (signalSeen) { process.exitCode = 1; process.exit(1); return; }");
    expect(first.files["src/k-nex-web.ts"]).not.toContain("grace.unref()");
    expect(first.files["src/k-nex-web.ts"]).toContain("clearTimeout(grace); process.exitCode = 1; logShutdownFailure(error); process.exit(1);");
    expect(first.files["src/k-nex-worker.ts"]).toContain("createSalesRealtimeRelay");
    expect(first.files["src/k-nex-worker.ts"]).toContain('notify("realtime", message');
    expect(first.files["src/k-nex-registry.ts"]).toContain("salesCoreCollections");
    expect(first.files["src/k-nex-registry.ts"]).toContain("salesCoreCollectionSlugs");
    expect(first.files["src/k-nex-registry.ts"]).toContain("collections: Object.freeze([...salesCoreCollections])");
    expect(first.files["src/k-nex-registry.ts"]).toContain("collectionSlugs: salesCoreCollectionSlugs");
    expect(first.files["src/k-nex-readiness.ts"]).toContain('"sales-saved-views", "sales-import-jobs", "sales-import-rows", "sales-import-chunks", "sales-export-jobs", "sales-merge-lineage"');
    expect(first.files["src/k-nex-readiness.ts"]).toContain('sales_saved_views: ["name", "visibility", "visibility_team_id", "view_kind", "target_object_id", "definition", "status"]');
    expect(first.files["src/k-nex-registry.ts"]).not.toContain("salesTasksCollection");
    expect(first.files["src/k-nex-registry.ts"]).not.toContain("salesOpportunitiesCollection");
    expect(first.files["src/k-nex-registry.ts"]).toContain("staticRelease: Object.freeze");
    expect(first.files["src/k-nex-registry.ts"]).toContain('runtimeGenerationId: "sales-generation-1"');
    expect(first.files["src/k-nex-authority.ts"]).toContain("lifecycleOverride: Object.freeze({ enabled: !unavailable, ready: !unavailable })");
    expect(first.files["src/k-nex-authority.ts"]).toContain("inactive-extension-disabled");
    expect(first.files["src/k-nex-authority.ts"]).toContain("kNexSalesRegistry.staticRelease.runtimeGenerationId");
    expect(first.files["src/k-nex-authority.ts"]).toContain("export async function drainKnexAuthority(payload: Payload): Promise<void>");
    expect(first.files["src/k-nex-authority.ts"]).toContain("const runtime = runtimes.get(payload);");
    expect(first.files["src/k-nex-authority.ts"]).toContain("await runtime.adapter.drain();");
    expect(first.files["src/k-nex-authority.ts"]).toContain("requestAuthentications.delete(payload);");
    expect(first.files["src/k-nex-authority.ts"]).toContain("export async function shutdownKnexApplication(payload: Payload, progress?: (value: KnexShutdownProgress) => void): Promise<void>");
    expect(first.files["src/k-nex-authority.ts"]).toContain('progress?.(Object.freeze({ stage: "authority-drain" }));');
    expect(first.files["src/k-nex-authority.ts"]).toContain('progress?.(Object.freeze({ stage: "payload-destroy" }));');
    expect(first.files["src/k-nex-authority.ts"]).toContain('progress?.(Object.freeze({ stage: "pool-end", pool: Object.freeze({ totalCount: boundedPoolCount(pool.totalCount), idleCount: boundedPoolCount(pool.idleCount), waitingCount: boundedPoolCount(pool.waitingCount) }) }));');
    expect(first.files["src/k-nex-authority.ts"]).toContain('progress?.(Object.freeze({ stage: "complete" }));');
    const authoritySource = first.files["src/k-nex-authority.ts"]!;
    const shutdownProgressContract = authoritySource.slice(authoritySource.indexOf("export type KnexShutdownProgress"), authoritySource.indexOf("export function currentPayloadAuthentication"));
    const shutdownProgressImplementation = authoritySource.slice(authoritySource.indexOf("export async function shutdownKnexApplication"), authoritySource.indexOf("export async function currentSalesGeneration"));
    expect(shutdownProgressContract + shutdownProgressImplementation).not.toMatch(/connection|string|backend|sql|actor|principal|header|cookie/iu);
    expect(first.files["src/k-nex-authority.ts"]).toContain("await drainKnexAuthority(payload);");
    expect(first.files["src/k-nex-authority.ts"]).toContain("const shutdowns = new WeakMap<Payload, Promise<void>>();");
    expect(first.files["src/k-nex-authority.ts"]).toContain("const existing = shutdowns.get(payload);");
    expect(first.files["src/k-nex-authority.ts"]).toContain("await payload.destroy(); } catch (error) { destroyError = error; }");
    expect(first.files["src/k-nex-authority.ts"]).toContain("if (typeof pool.end !== \"function\") { reject(new TypeError(\"K-Nex Payload Postgres pool cannot close.\")); return; }");
    expect(first.files["src/k-nex-authority.ts"]).toContain("try { await pool.end(); } catch (error) { endError = error; }");
    expect(first.files["src/k-nex-authority.ts"]).toContain("if (shutdowns.has(payload)) throw new Error(\"K-Nex authority runtime is closed.\");");
    expect(first.files["src/k-nex-registry.ts"]).toContain('surface: "admin"');
    expect(first.files["src/k-nex-registry.ts"]).toContain('palette: "light"');
    expect(first.files["src/k-nex-registry.ts"]).toContain("resolveMinimalThemeProfile(kNexInitialThemeProfile)");
    expect(first.files["src/k-nex-registry.ts"]).not.toContain("salesPageTemplates");
    expect(first.files["next.config.ts"]).not.toContain('"@k-nex/module-sales"');
    expect(first.files["src/k-nex-workspace-pages.ts"]).toContain("CurrentAuthorityWorkspacePageService");
    expect(first.files["src/k-nex-workspace-pages.ts"]).toContain("registered?.descriptor ?? registered");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("new DataSourceGateway({");
    expect(first.files["src/app/components/k-nex-workspace-page-runtime.tsx"]).not.toMatch(/builder-puck|module-sales\/puck/u);
    expect(first.files["src/app/components/k-nex-workspace-page-editor.tsx"]).toMatch(/builder-puck|module-sales\/puck/u);
    expect(first.files["src/k-nex-readiness.ts"]).toContain("K_NEX_APPLICATION_READY");
    expect(first.files["src/app/(payload)/api/[...slug]/route.ts"]).toContain("REST_GET(config)");
    expect(first.files["src/app/(workspace)/page.tsx"]).toContain("Customer Alpha");
    expect(first.files["src/app/api/health/route.ts"]).toContain('status: "alive"');
    expect(first.files["src/app/api/readiness/route.ts"]).toContain("bootKnexApplication");
    expect(first.files["src/k-nex-users.ts"]).toContain("removeTokenFromResponses: true");
    expect(first.files["src/k-nex-users.ts"]).toContain("useSessions: true");
    expect(first.files["src/k-nex-bootstrap-token.ts"]).toContain("timingSafeEqual");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain("bootstrapFirstOwner");
    expect(first.files["src/k-nex-bootstrap-token.ts"]).toContain("update k_nex_owner_bootstrap_tokens set consumed_at=now() where application_id=$1 and environment=$2 and consumed_at is null");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain("acquireBootstrapLock");
    for (const path of ["src/k-nex-bootstrap-owner.ts", "src/k-nex-issue-bootstrap-token.ts", "src/k-nex-doctor.ts", "src/k-nex-worker.ts"]) {
      expect(first.files[path]).toContain("shutdownKnexApplication(payload)");
      expect(first.files[path]).not.toContain("payload.destroy()");
    }
    expect(first.files["src/k-nex-bootstrap-owner.ts"]!.indexOf("const priorReceipt")).toBeLessThan(first.files["src/k-nex-bootstrap-owner.ts"]!.indexOf("const existing = await payload.find"));
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain("assertResumableOwnerReceipt(priorReceipt, String(user.id))");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain('crashAfterCommit("protected-owner")');
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain('crashAfterCommit("sales-authority")');
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain('crashAfterCommit("token-consumption")');
    expect(first.files["src/migrations/20260901_000019_authorization.ts"]).toContain("kNexAuthorizationSchemaMigration");
    expect(first.files["src/migrations/20260901_000022_static_lifecycle_admission.ts"]).toContain("kNexStaticLifecycleAdmissionSchemaMigration");
    expect(first.files["src/migrations/20260909_000035_static_rebind_lock_protocol.ts"]).toContain("kNexStaticRebindLockProtocolSchemaMigration");
    expect(first.files["src/migrations/20260909_000035_static_rebind_lock_protocol.ts"]).toBe(readFileSync(
      new URL("../../../fixtures/customer-gate-1/src/migrations/20260909_000035_static_rebind_lock_protocol.ts", import.meta.url), "utf8"
    ));
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain("insert into k_nex_system_settings_state(application_id,environment,settings_revision)");
    expect(first.files["src/k-nex-bootstrap-owner.ts"]).toContain('reportingCurrency: "USD"');
    expect(first.files["src/migrations/20260908_000034_reports.ts"]).toContain("configured_primary_currency text := 'USD'::text");
    expect(first.files["src/migrations/20260902_000023_system_administration.ts"]).toContain("kNexSystemAdministrationSchemaMigrations");
    expect(first.files["src/migrations/20260902_000023_system_administration.ts"]).toContain("[...kNexSystemAdministrationSchemaMigrations].reverse()");
    expect(first.files["src/migrations/20260903_000026_workspace_pages.ts"]).toContain("kNexWorkspacePageSchemaMigration");
    expect(first.files["src/migrations/20260903_000027_event_outbox.ts"]).toContain("kNexEventOutboxSchemaMigration");
    expect(first.files["src/migrations/20260905_000027_crm_core.ts"]).toContain("maintenance-required: P13.2 CRM core rollback");
    expect(first.files["src/migrations/20260905_000027_crm_core.ts"]).toContain('CREATE TABLE "sales_accounts"');
    expect(first.files["src/migrations/20260905_000027_crm_core.ts"]).toBe(readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260905_000027_crm_core.ts", import.meta.url), "utf8"));
    const crmCore = first.files["src/migrations/20260905_000027_crm_core.ts"]!;
    expect(crmCore).toContain("function authorizationStateLockKey(applicationId: string): string");
    expect(crmCore).toContain("export function compareCanonicalAuthorizationStateLockKeys(left: string, right: string): number");
    expect(crmCore).toContain("return [...transitions].sort((left, right) => compareCanonicalAuthorizationStateLockKeys(authorizationStateLockKey(left.applicationId), authorizationStateLockKey(right.applicationId)))");
    expect(crmCore.indexOf("const authorizationTransitions = await lockAndRevalidateAuthorizationTransitions(db, plan.authorizationTransitions)"))
      .toBeLessThan(crmCore.indexOf("DELETE FROM k_nex_role_permission_grants"));
    expect(crmCore.indexOf("SELECT authorization_revision,lifecycle_revision FROM k_nex_authorization_state WHERE application_id=${transition.applicationId} FOR UPDATE"))
      .toBeGreaterThan(crmCore.indexOf("pg_advisory_xact_lock(hashtextextended(${authorizationStateLockKey(transition.applicationId)},0))"));
    const pipelineSavedViews = first.files["src/migrations/20260907_000030_pipeline_saved_views.ts"]!;
    expect(pipelineSavedViews).toContain("13f5fa89-b465-5a7a-a19d-74ed6c5d1ef4");
    expect(pipelineSavedViews).toContain("sales_pipeline_stage_translation_evidence");
    expect(pipelineSavedViews).toContain("maintenance-required: P13.4 opaque stage-ID cutover is forward-only");
    expect(pipelineSavedViews).toBe(readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260907_000030_pipeline_saved_views.ts", import.meta.url), "utf8"));
    const dataMovement = first.files["src/migrations/20260907_000031_data_movement.ts"]!;
    expect(dataMovement).toContain("worker_generation_id text");
    expect(dataMovement).toContain("worker_fencing_token bigint");
    expect(dataMovement).toContain("permission_grants jsonb NOT NULL");
    expect(dataMovement).not.toContain("sales_data_worker_generations");
    expect(dataMovement).toContain("sales_export_artifacts");
    expect(dataMovement).toContain("P13.5 durable data-movement evidence is forward-only");
    expect(dataMovement).toBe(readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260907_000031_data_movement.ts", import.meta.url), "utf8"));
    const communications = first.files["src/migrations/20260908_000032_communications.ts"]!;
    expect(communications).toContain("sales_provider_configurations");
    expect(communications).toContain("sales_provider_webhook_events");
    expect(communications).toContain("sales_reminders");
    expect(communications).toContain("sales_notifications");
    expect(communications).toBe(readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260908_000032_communications.ts", import.meta.url), "utf8"));
    const workflows = first.files["src/migrations/20260908_000033_crm_workflows.ts"]!;
    expect(workflows).toContain("sales_workflow_executions");
    expect(workflows).toContain("sales_workflow_execution_audit");
    expect(workflows).toBe(readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260908_000033_crm_workflows.ts", import.meta.url), "utf8"));
    const importUploadRoute = first.files["src/app/api/k-nex/sales/import-upload/route.ts"]!;
    expect(importUploadRoute).toContain("sales_import_uploads");
    expect(importUploadRoute).toContain("async function boundedUploadBody(request: Request)");
    expect(importUploadRoute).toContain("request.body.getReader()");
    expect(importUploadRoute).toContain("total > importUploadRequestByteLimit");
    expect(importUploadRoute).toContain("uploaded[0] === 0xef && uploaded[1] === 0xbb && uploaded[2] === 0xbf ? uploaded.subarray(3) : uploaded");
    expect(importUploadRoute).toContain("createHash(\"sha256\").update(bytes)");
    expect(importUploadRoute).toContain("IMPORT_LIMIT_EXCEEDED");
    expect(importUploadRoute).not.toContain("IMPORT_UPLOAD_FORBIDDEN");
    expect(importUploadRoute).toContain('workspaceSalesPermissions(payload, context)).includes("sales.imports.execute")');
    expect(importUploadRoute).toContain("WITH current_authority AS");
    expect(importUploadRoute).toContain("s.revision=$10");
    expect(importUploadRoute).toContain("a.authorization_revision=$8 AND a.lifecycle_revision=$9");
    expect(importUploadRoute).toContain("x.delivery_class='platform-plugin' AND x.extension_id='module.sales' AND x.state='current'");
    expect(importUploadRoute).toContain("x.runtime_generation_ids=$12::jsonb");
    expect(importUploadRoute).toContain("JOIN k_nex_role_assignments r");
    expect(importUploadRoute).toContain("g.permission_id='sales.imports.execute'");
    expect(importUploadRoute).toContain("inactive-extension-disabled','inactive-extension-not-ready");
    expect(importUploadRoute).toContain("FOR SHARE OF a,s,r,g,x");
    expect(first.files["src/app/api/k-nex/sales/export-artifact/route.ts"]).toContain("readGeneratedSalesExportArtifact");
    const dataMovementHost = first.files["src/k-nex-sales-data-movement.ts"]!;
    expect(dataMovementHost).toContain("sales_export_artifacts");
    expect(dataMovementHost).toContain("const importUploadReadIdleTimeoutMs = 1_000");
    expect(dataMovementHost).toContain("const importUploadReadDeadlineMs = 30_000");
    expect(dataMovementHost).toContain("await readUploadChunk(reader, deadline)");
    expect(dataMovementHost).toContain("void reader.cancel().catch(() => undefined)");
    expect(dataMovementHost).toContain("let settled = false");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("parseSalesImportCsv");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("buildSalesExportCsv");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("salesDedupeMatch");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("async function assertWorkerExportFence");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("JOIN runtime_worker_generation_fences f");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("f.active_execution_generation=$3 AND f.fencing_token=$4");
    expect(first.files["src/k-nex-sales-data-movement.ts"]).toContain("jsonb_array_elements_text(s.authorized_team_ids)");
    expect(first.files["src/k-nex-sales-communications.ts"]).toContain("createGeneratedSalesProviderGateway");
    expect(first.files["src/k-nex-sales-communications.ts"]).toContain("createHmac(\"sha256\"");
    expect(first.files["src/k-nex-sales-communications.ts"]).toContain("timingSafeEqual");
    expect(first.files["src/k-nex-sales-communications.ts"]).toContain("processGeneratedSalesReminders");
    expect(first.files["src/k-nex-sales-workflows.ts"]).toContain("processGeneratedSalesWorkflows");
    expect(first.files["src/app/api/k-nex/sales/providers/email-reference/webhook/route.ts"]).toContain('from "../../../../../../../k-nex-sales-communications.js"');
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("new GeneratedSalesDataMovementStore(request");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("request.dataMovement = dataMovement");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain('grants.push("sales.object.contact:email", "sales.object.contact:phone")');
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("const dataMovementPermissionIds = Object.freeze([");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain('"sales.imports.execute", "sales.exports.execute", "sales.records.merge"');
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("authorizedTeamIds: current.salesScope.authorizedTeamIds, fieldGrants, permissionGrants");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("providerGateway: current.providerGateway");
    expect(first.files["src/k-nex-sales-workspace.ts"]).not.toContain("reminderGateway");
    expect(first.files["src/k-nex-worker.ts"]).toContain("type SalesWorkerFence = Readonly<{ applicationId: string; environment: string; activeExecutionGeneration: string; fencingToken: number; leaseOwner: string; promotionRevision: number }>");
    expect(first.files["src/k-nex-worker.ts"]).toContain("const executionGeneration = process.env.K_NEX_GENERATION");
    expect(first.files["src/k-nex-worker.ts"]).toContain("from runtime_worker_generation_fences where application_id=$1 and environment=$2 and active_execution_generation=$3 and lease_expires_at>now()");
    expect(first.files["src/k-nex-worker.ts"]).toContain("await processSalesDataMovement(pool, salesWorkerFence)");
    expect(first.files["src/k-nex-worker.ts"]).toContain("createGeneratedBoundedReferenceProviderTransport(process.env.K_NEX_REFERENCE_PROVIDER_ENDPOINT)");
    expect(first.files["src/k-nex-worker.ts"]).not.toContain("process.env.K_NEX_REFERENCE_PROVIDER_ENDPOINT === undefined ? undefined");
    expect(first.files["src/k-nex-worker.ts"]).toContain("await processGeneratedSalesCommunications(pool, salesWorkerFence, providerSecrets, providerTransport)");
    expect(first.files["src/k-nex-worker.ts"]).toContain("await processGeneratedSalesReminders(pool, salesWorkerFence)");
    expect(first.files["src/k-nex-worker.ts"]!.indexOf("await processGeneratedSalesReminders(pool, salesWorkerFence)")).toBeLessThan(first.files["src/k-nex-worker.ts"]!.indexOf("await processGeneratedSalesCommunications(pool, salesWorkerFence, providerSecrets, providerTransport)"));
    expect(first.files["src/k-nex-sales-communications.ts"]).toContain('return Object.freeze({ invoke: async (input) => { let origin: URL; try { origin = new URL(endpoint ?? ""); }');
    expect(first.files["src/k-nex-sales-communications.ts"]).toContain("limit 4");
    expect(first.files["src/k-nex-sales-routes.ts"]).toContain("function registeredRouteActionDescriptor(value: unknown): RegisteredRouteActionDescriptor | undefined");
    expect(first.files["src/k-nex-sales-routes.ts"]).toContain("binding !== undefined && binding.id === descriptor.id");
    expect(first.files["src/k-nex-worker.ts"]).not.toContain("staticRelease.authorizationGeneration");
    expect(first.files["src/k-nex-worker.ts"]).not.toContain("kNexSalesRegistry.staticRelease.runtimeGenerationId");
    expect(first.files["src/app/(workspace)/sales/accounts/[id]/page.tsx"]).toContain("resolveMergedSalesDetailRedirect");
    expect(first.files["src/k-nex-sales-workspace.ts"]).toContain("Merged Sales winner is denied.");
    expect(first.files["src/app/api/k-nex/sales/export-artifact/route.ts"]).toContain("workspaceSalesPermissions(payload, context)");
    expect(first.files["src/app/api/k-nex/sales/export-artifact/route.ts"]).toContain("authorizationRevision: generation.state.authorizationRevision, lifecycleRevision: generation.state.lifecycleRevision, scopeRevision, fieldGrants, permissionGrants: permissions");
    expect(first.files["src/app/api/k-nex/inventory/route.ts"]).toContain("system.extensions.read");
    expect(Object.values(first.files).every((source) => !source.includes("fixtures/customer-gate-1"))).toBe(true);
    const packageJson = JSON.parse(first.files["package.json"]!);
    expect(packageJson.engines.node).toBe(">=24 <25");
    expect(packageJson.scripts).toMatchObject({
      build: "pnpm build:scripts && next build --webpack",
      dev: "next dev --webpack",
      "knex:bootstrap-owner": "node --env-file-if-exists=.env dist/k-nex-bootstrap-owner.js",
      "knex:issue-bootstrap-token": "node --env-file-if-exists=.env dist/k-nex-issue-bootstrap-token.js",
      "knex:db:up": "docker compose up -d postgres",
      "knex:doctor": "node --env-file-if-exists=.env dist/k-nex-doctor.js",
      "knex:migrate": "payload migrate",
      "knex:worker": "node --env-file-if-exists=.env dist/k-nex-worker.js",
      start: "node --env-file-if-exists=.env dist/k-nex-web.js"
    });
    expect(packageJson.scripts).not.toHaveProperty("knex:readiness");
    const applicationPlan = JSON.parse(first.files[".k-nex/application-plan.json"]!);
    expect(applicationPlan.packageSource.kind).toBe("workspace");
    expect(applicationPlan.payloadPostgresPatch).toEqual(payloadPostgresPatchProvenance);
    expect(first.files[payloadPostgresPatchFilename]).toBe(payloadPostgresPatchSource());
    expect(`sha256:${createHash("sha256").update(first.files[payloadPostgresPatchFilename]!).digest("hex")}`).toBe(payloadPostgresPatchDigest);
    expect(first.files["pnpm-workspace.yaml"]).toContain(`"@payloadcms/db-postgres@3.88.0": "${payloadPostgresPatchFilename}"`);
    expect(applicationPlan.composition).toMatchObject({ plugins: ["module.sales@1.1.0", "provider.realtime.socketio@1.1.0"], builder: "builder.puck@1.1.0" });
    expect(first.files[".k-nex/default-pages.json"]).toBeUndefined();
    expect(first.files[".k-nex/package-release-manifest.json"]).toBeUndefined();
    expect(Object.values(first.files).every((source) => !source.includes("defaultPages") && !source.includes("default-pages") && !source.includes("salesPageTemplates"))).toBe(true);
    expect(first.files[".env.example"]!.split("\n").filter(Boolean).every((line) => line.endsWith("="))).toBe(true);
    expect(first.files["src/k-nex-users.ts"]).toContain('secure: kNexIdentity.publicOrigin.protocol === "https:"');
    expect(Object.values(first.files).some((source) => source.includes("K_NEX_OWNER_PASSWORD="))).toBe(true);
    expect(Object.values(first.files).every((source) => !source.includes("K_NEX_OWNER_PASSWORD=secret"))).toBe(true);
    expect(first.files["pnpm-lock.yaml"]).toBeUndefined();
    expect(first.installCommands).toEqual([]);
  });

  it("executes emitted registry capability selection for the release it compiles", () => {
    const releaseVersion = "1.1.0";
    for (const plan of [
      planCreateKnexApplication({ applicationId: "registry-current", applicationName: "Registry Current", theme: "minimal", database: "external" }),
      planCreateKnexApplication({ applicationId: "registry-packed", applicationName: "Registry Packed", theme: "minimal", database: "external", packageSource: bundledPackageSource() })
    ]) {
      const source = plan.files["src/k-nex-registry.ts"]!;
      expect(source).toContain('const realtimeGateway = realtimeManifest.provides.find(({ capability }) => capability === "realtime.gateway");');
      expect(source).toContain('capability: "realtime.gateway", plugin: realtimeManifest.id, version: realtimeGateway.version');
      expect(source).not.toContain(`capability: "realtime.gateway", plugin: realtimeManifest.id, version: "${releaseVersion}"`);
      const registration = executeEmittedRegistry(releaseVersion);
      expect(registration.phases).toContain("providers");
      expect(registration.inventory.map(({ id }) => id)).toEqual(["module.sales", "provider.realtime.socketio"]);
    }
  });

  it("refuses to generate an application pinned to a release it does not compile", () => {
    const historical = JSON.parse(readFileSync(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url), "utf8"));
    const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    // The emitted registry imports Phase 13 CRM symbols that 1.0.0 packages do
    // not export, so a 1.0.0-pinned application cannot run its own migrations.
    expect(() => planCreateKnexApplication({
      applicationId: "historical-customer", applicationName: "Historical Customer", theme: "minimal", database: "external",
      packageSource: verifiedPackageSource(historical, mirror)
    })).toThrow("This compiler generates 1.1.0 applications; 1.0.0 must be generated by the 1.0.0 compiler.");
  });

  it("binds a generated application to every exact artifact in a packed release mirror", () => {
    const release = JSON.parse(readFileSync(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url), "utf8"));
    const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const plan = planCreateKnexApplication({
      applicationId: "packed-customer", applicationName: "Packed Customer", theme: "minimal", database: "external",
      packageSource: verifiedPackageSource(release, mirror)
    });
    const packageJson = JSON.parse(plan.files["package.json"]!);
    const sales = release.packages.find((entry: { package: string }) => entry.package === "@k-nex/module-sales");
    expect(release.release.version).toBe("1.1.0");
    expect(sales.version).toBe("1.1.0");
    expect(packageJson.dependencies["@k-nex/module-sales"]).toBe(`file:.k-nex/packages/k-nex-module-sales-${sales.version}.tgz`);
    expect(plan.files["pnpm-workspace.yaml"]).toContain('"@k-nex/module-sales": "file:.k-nex/packages/k-nex-module-sales-');
    expect(plan.files[payloadPostgresPatchFilename]).toBe(payloadPostgresPatchSource());
    expect(JSON.parse(plan.files[".k-nex/application-plan.json"]!).payloadPostgresPatch).toEqual(payloadPostgresPatchProvenance);
    expect(packageJson.scripts["knex:db:up"]).toBeUndefined();
    expect(plan.files["README.md"]).not.toContain("knex:db:up");
    expect(plan.files["README.md"]).toContain("deploy the K-Nex administration operator as a separate private service");
    expect(plan.files["README.md"]).toContain("does not generate or run that deployment-owned authority");
    expect(plan.files["README.md"]).toContain("K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT");
    expect(plan.files["README.md"]).toContain("/v1/commands");
    expect(JSON.parse(plan.files["k-nex.app.json"]!).plugins[0].version).toBe(sales.version);
    expect(plan.files["src/k-nex-registry.ts"]).toContain('capability: "realtime.gateway", plugin: realtimeManifest.id, version: realtimeGateway.version');
    expect(plan.files["src/k-nex-registry.ts"]).toContain('themeVersion: "1.1.0"');
    expect(plan.files["src/k-nex-theme-runtime.ts"]).toContain('profile.themeId !== "theme.minimal" || profile.themeVersion !== "1.1.0"');
    expect(plan.files["src/migrations/20260827_000002_knex_bootstrap.ts"]).toContain("platform-1.1.0-bootstrap");
    expect(Object.keys(plan.artifactDigests)).toHaveLength(release.packages.length);
    const packageReleaseManifest = plan.files[".k-nex/package-release-manifest.json"]!;
    expect(packageReleaseManifest).toBe(canonicalJson(PackageReleaseManifestSchema.parse(release)));
    expect(`sha256:${createHash("sha256").update(packageReleaseManifest).digest("hex")}`).toBe(JSON.parse(plan.files[".k-nex/application-plan.json"]!).packageSource.manifestDigest);
    expect(plan.files["pnpm-lock.yaml"]).toContain("lockfileVersion: '9.0'");
    const neobrutalism = planCreateKnexApplication({
      applicationId: "packed-neobrutalism", applicationName: "Packed Neobrutalism", theme: "neobrutalism", database: "external",
      packageSource: verifiedPackageSource(release, mirror)
    });
    expect(neobrutalism.files["pnpm-lock.yaml"]).not.toBe(plan.files["pnpm-lock.yaml"]);
    expect(neobrutalism.files["pnpm-lock.yaml"]).toContain("k-nex-theme-neobrutalism-1.1.0.tgz");
    expect(neobrutalism.files["src/k-nex-registry.ts"]).toContain('palette: "primary"');
    expect(neobrutalism.files["src/k-nex-registry.ts"]).toContain("resolveNeobrutalismThemeProfile(kNexInitialThemeProfile)");
    expect(plan.installCommands).toEqual([["pnpm", "install", "--frozen-lockfile"]]);
  });

  it("rejects tampered mirrors and installs immutable bytes captured by the verified plan", () => {
    const release = JSON.parse(readFileSync(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url), "utf8"));
    const source = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-mirror-"))); roots.push(root);
    const mirror = join(root, "mirror"); mkdirSync(mirror);
    for (const entry of release.packages) {
      const filename = `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;
      copyFileSync(join(source, filename), join(mirror, filename));
    }
    for (const entry of Object.values(release.factoryLockTemplates) as { theme: string; digest: string }[]) {
      const filename = `factory-lock-sales-reference-${entry.theme}-${entry.digest.slice(7)}.yaml`;
      copyFileSync(join(source, filename), join(mirror, filename));
    }
    const options = { applicationId: "packed-customer", applicationName: "Packed Customer", theme: "minimal", database: "external", packageSource: verifiedPackageSource(release, mirror) } as const;
    const plan = planCreateKnexApplication(options);
    const sales = release.packages.find((entry: { package: string }) => entry.package === "@k-nex/module-sales");
    expect(release.release.version).toBe("1.1.0");
    expect(sales.version).toBe("1.1.0");
    const filename = `${sales.package.slice(1).replace("/", "-")}-${sales.version}.tgz`;
    writeFileSync(join(mirror, filename), "replacement after planning");
    const target = join(root, "application");
    applyCreateKnexApplication(plan, target);
    expect(`sha256:${createHash("sha256").update(readFileSync(join(target, ".k-nex/packages", filename))).digest("hex")}`).toBe(plan.artifactDigests[filename]);
    expect(() => planCreateKnexApplication(options)).toThrow("integrity mismatch");

    copyFileSync(join(source, filename), join(mirror, filename));
    const other = release.packages.find((entry: { package: string }) => entry.package === "@k-nex/composition");
    const otherFilename = `${other.package.slice(1).replace("/", "-")}-${other.version}.tgz`;
    copyFileSync(join(source, filename), join(mirror, otherFilename));
    const forgedRelease = { ...release, packages: release.packages.map((entry: { package: string }) => entry.package === other.package ? { ...entry, integrity: sales.integrity } : entry) };
    expect(() => planCreateKnexApplication({ ...options, packageSource: verifiedPackageSource(forgedRelease, mirror) })).toThrow("package identity mismatch");
    expect(() => planCreateKnexApplication({ ...options, packageSource: { ...options.packageSource, release: release as never } })).toThrow("not issued by this authority");
  });

  it("applies idempotently and refuses to overwrite customer files", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-beta", applicationName: "Customer Beta", theme: "neobrutalism", database: "external", packageSource: bundledPackageSource() });
    const first = applyCreateKnexApplication(plan, root);
    expect(first.written).toContain("k-nex.app.json");
    expect(first.written).not.toContain("compose.yaml");
    expect(applyCreateKnexApplication(plan, root).unchanged).toEqual([
      ...Object.keys(plan.files),
      ...Object.keys(plan.artifactDigests).map((filename) => `.k-nex/packages/${filename}`)
    ]);
    expect(existsSync(join(root, ".k-nex/default-pages.json"))).toBe(false);
    writeFileSync(join(root, "package.json"), "customer edit\n");
    expect(() => applyCreateKnexApplication(plan, root)).toThrow("refuses to overwrite package.json");
  });

  it("writes byte-identical controlled source to different clean targets", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-determinism-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-deterministic", applicationName: "Customer Deterministic", theme: "minimal", database: "external", packageSource: bundledPackageSource() });
    const first = join(root, "first");
    const second = join(root, "second");
    applyCreateKnexApplication(plan, first);
    applyCreateKnexApplication(plan, second);
    for (const path of Object.keys(plan.files)) expect(readFileSync(join(first, path))).toEqual(readFileSync(join(second, path)));
  }, 60_000);

  it("uses workspace only for side-effect-free planning and selects current or historical bundled releases explicitly", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-cli-"))); roots.push(root);
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    const planned = join(root, "planned");
    const output = execFileSync(process.execPath, [script, "--target", planned, "--id", "cli-planned", "--name", "CLI Planned", "--database", "external", "--workspace", "--plan-only"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    expect(JSON.parse(output).applicationId).toBe("cli-planned");
    expect(JSON.parse(output).installCommands).toEqual([]);
    expect(existsSync(planned)).toBe(false);
    const manifestPath = fileURLToPath(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const argsLog = join(root, "gh-args.json");
    const bin = fakeGh(root, hostedVerification(manifest));
    const written = join(root, "written");
    execFileSync(process.execPath, [script, "--target", written, "--id", "cli-written", "--name", "CLI Written", "--database", "external", "--primary-currency", "USD", "--no-install"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: argsLog }
    });
    expect(readdirSync(written)).toEqual(expect.arrayContaining([".env.example", "package.json", "pnpm-lock.yaml", "src"]));
    expect(existsSync(join(written, "node_modules"))).toBe(false);
    expect(JSON.parse(readFileSync(argsLog, "utf8"))).toEqual([
      "attestation", "verify", manifestPath, "--repo", "rootkeystudio/k-nex-platform-core",
      "--signer-workflow", "rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml", "--deny-self-hosted-runners",
      "--predicate-type", "https://k-nex.dev/release-manifest/v1", "--format", "json"
    ]);
    const explicitRoot = join(root, "explicit-gh"); mkdirSync(explicitRoot);
    const explicitManifestPath = fileURLToPath(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url));
    const explicitBin = fakeGh(explicitRoot, hostedVerification(JSON.parse(readFileSync(explicitManifestPath, "utf8"))));
    const explicit = join(root, "explicit");
    const explicitArgsLog = join(root, "explicit-gh-args.json");
    execFileSync(process.execPath, [script, "--target", explicit, "--id", "cli-explicit", "--name", "CLI Explicit", "--database", "external", "--primary-currency", "USD", "--release-version", "1.1.0", "--no-install"], {
      encoding: "utf8", env: { ...process.env, PATH: `${explicitBin}:${process.env.PATH}`, GH_ARGS_LOG: explicitArgsLog }
    });
    expect(existsSync(join(explicit, "pnpm-lock.yaml"))).toBe(true);
    expect(JSON.parse(readFileSync(explicitArgsLog, "utf8"))).toEqual([
      "attestation", "verify", explicitManifestPath, "--repo", "rootkeystudio/k-nex-platform-core",
      "--signer-workflow", "rootkeystudio/k-nex-platform-core/.github/workflows/release-evidence.yml", "--deny-self-hosted-runners",
      "--predicate-type", "https://k-nex.dev/release-manifest/v1", "--format", "json"
    ]);

    const historicalRoot = join(root, "historical-gh"); mkdirSync(historicalRoot);
    const historicalManifestPath = fileURLToPath(new URL("../../../releases/1.0.0/package-release-manifest.json", import.meta.url));
    const historicalBin = fakeGh(historicalRoot, hostedVerification(JSON.parse(readFileSync(historicalManifestPath, "utf8"))));
    const historical = join(root, "historical");
    expect(() => execFileSync(process.execPath, [script, "--target", historical, "--id", "cli-historical", "--name", "CLI Historical", "--database", "external", "--primary-currency", "USD", "--release-version", "1.0.0", "--no-install"], {
      encoding: "utf8", stdio: "pipe", env: { ...process.env, PATH: `${historicalBin}:${process.env.PATH}`, GH_ARGS_LOG: join(root, "historical-gh-args.json") }
    })).toThrow("must be generated by the 1.0.0 compiler");
    expect(existsSync(historical)).toBe(false);
  }, 15_000);

  it("rejects workspace apply or no-install before target write", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-workspace-"))); roots.push(root);
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    for (const [name, mode, error] of [["apply", [], "--workspace requires --plan-only"], ["no-install", ["--plan-only", "--no-install"], "--workspace is plan-only"]] as const) {
      const target = join(root, name);
      expect(() => execFileSync(process.execPath, [script, "--target", target, "--id", `workspace-${name}`, "--name", "Workspace Rejected", "--workspace", ...mode], { encoding: "utf8", stdio: "pipe" })).toThrow(error);
      expect(existsSync(target)).toBe(false);
    }
  }, 15_000);

  it("refuses to generate an application that can never report ready", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-currency-"))); roots.push(root);
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    for (const [name, currency, error] of [
      ["missing", [], "--primary-currency <ISO-4217> is required"],
      ["lowercase", ["--primary-currency", "usd"], "must be an ISO-4217 alphabetic code"],
      ["numeric", ["--primary-currency", "840"], "must be an ISO-4217 alphabetic code"]
    ] as const) {
      const target = join(root, name);
      expect(() => execFileSync(process.execPath, [script, "--target", target, "--id", `currency-${name}`, "--name", "Currency Rejected", "--database", "external", ...currency, "--no-install"], { encoding: "utf8", stdio: "pipe" })).toThrow(error);
      expect(existsSync(target)).toBe(false);
    }
  }, 15_000);

  it("keeps release-less plans side-effect-free when application is called directly", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-workspace-plan-"))); roots.push(root);
    const target = join(root, "application");
    const plan = planCreateKnexApplication({ applicationId: "workspace-plan", applicationName: "Workspace Plan", theme: "minimal", database: "external" });
    expect(() => applyCreateKnexApplication(plan, target)).toThrow("requires a verified packed release plan");
    expect(existsSync(target)).toBe(false);
  });

  it("rejects a coherently forged manifest, tarball, and lock before target write", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-forged-"))); roots.push(root);
    const sourceManifestPath = fileURLToPath(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url));
    const original = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    const mirrorSource = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const mirror = join(root, "mirror"); mkdirSync(mirror);
    for (const filename of readdirSync(mirrorSource)) copyFileSync(join(mirrorSource, filename), join(mirror, filename));
    const forged = structuredClone(original);
    const packed = forged.packages.find((entry: { package: string }) => entry.package === "@k-nex/module-sales");
    const packedPath = join(mirror, `k-nex-module-sales-${packed.version}.tgz`);
    const packedBytes = readFileSync(packedPath); packedBytes[9] = packedBytes[9] === 0xff ? 0x03 : 0xff; writeFileSync(packedPath, packedBytes);
    packed.integrity = `sha512-${createHash("sha512").update(packedBytes).digest("base64")}`;
    const lock = forged.factoryLockTemplates.minimal;
    const oldLock = join(mirror, `factory-lock-sales-reference-minimal-${lock.digest.slice(7)}.yaml`);
    const lockContent = `${readFileSync(oldLock, "utf8")}# forged\n`;
    lock.digest = `sha256:${createHash("sha256").update(lockContent).digest("hex")}`;
    const newLock = join(mirror, `factory-lock-sales-reference-minimal-${lock.digest.slice(7)}.yaml`);
    writeFileSync(newLock, lockContent); rmSync(oldLock);
    const manifestPath = join(root, "package-release-manifest.json"); writeFileSync(manifestPath, `${JSON.stringify(forged, null, 2)}\n`);
    const bin = fakeGh(root, hostedVerification(original));
    const target = join(root, "target");
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url)), "--target", target, "--id", "forged", "--name", "Forged", "--database", "external", "--primary-currency", "USD", "--release-manifest", manifestPath, "--package-mirror", mirror, "--no-install"], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: join(root, "forged-gh-args.json") }, stdio: "pipe"
    })).toThrow();
    expect(existsSync(target)).toBe(false);
  }, 15_000);

  it("rejects nonofficial hosted workflow and source identities before target write", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-identity-"))); roots.push(root);
    const manifestPath = fileURLToPath(new URL("../../../releases/1.1.0/package-release-manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const mirror = fileURLToPath(new URL("../../../fixtures/customer-gate-1/packages", import.meta.url));
    const script = fileURLToPath(new URL("../../../scripts/create-knex-app.mjs", import.meta.url));
    for (const [name, mutate] of [
      ["workflow", (entry: any) => { entry.verificationResult.signature.certificate.githubWorkflowRepository = "attacker/repository"; }],
      ["source", (entry: any) => { entry.verificationResult.signature.certificate.sourceRepositoryDigest = "b".repeat(40); }]
    ] as const) {
      const verification = hostedVerification(manifest); mutate(verification[0]);
      const caseRoot = join(root, name); mkdirSync(caseRoot);
      const bin = fakeGh(caseRoot, verification);
      const target = join(caseRoot, "target");
      expect(() => execFileSync(process.execPath, [script, "--target", target, "--id", `identity-${name}`, "--name", `Identity ${name}`, "--database", "external", "--primary-currency", "USD", "--release-manifest", manifestPath, "--package-mirror", mirror, "--no-install"], {
        encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_ARGS_LOG: join(caseRoot, "gh-args.json") }, stdio: "pipe"
      })).toThrow();
      expect(existsSync(target)).toBe(false);
    }
  }, 15_000);

  it("preflights every destination and never partially writes or follows symlinks", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "create-knex-app-"))); roots.push(root);
    const plan = planCreateKnexApplication({ applicationId: "customer-gamma", applicationName: "Customer Gamma", theme: "minimal", database: "external", packageSource: bundledPackageSource() });
    writeFileSync(join(root, "package.json"), "customer edit\n");
    expect(() => applyCreateKnexApplication(plan, root)).toThrow("refuses to overwrite package.json");
    expect(existsSync(join(root, "src", "payload.config.ts"))).toBe(false);

    const outside = mkdtempSync(join(tmpdir(), "create-knex-app-outside-")); roots.push(outside);
    const linkedRoot = join(root, "linked");
    symlinkSync(outside, linkedRoot);
    expect(() => applyCreateKnexApplication(plan, join(linkedRoot, "app"))).toThrow("symlinked target paths");
    expect(existsSync(join(outside, "app"))).toBe(false);
  });
});
