import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ApplicationManifestSchema, canonicalJson, supportedFrameworkTuple, type ApplicationManifest, type PackageReleaseManifestAuthority, type VerifiedPackageReleaseManifest } from "@k-nex/contracts";
import { applicationAuthFiles } from "./application-auth-files.js";
import { platformInstallingState, platformReleaseIdentity, platformReleaseRevision, platformReleaseState, platformTransitionSource } from "./platform-release-revision.js";
import { crmCoreMigrationSource as canonicalCrmCoreMigrationSource } from "./crm-core-migration-template.js";
import { dataMovementMigrationSource } from "./data-movement-migration-template.js";
import { dataMovementHostSource } from "./data-movement-host-template.js";
import { communicationsMigrationSource } from "./communications-migration-template.js";
import { communicationsHostSource } from "./communications-host-template.js";
import { crmWorkflowsHostSource } from "./crm-workflows-host-template.js";
import { crmWorkflowsMigrationSource } from "./crm-workflows-migration-template.js";
import { reportsHostSource } from "./reports-host-template.js";
import { reportsMigrationSource } from "./reports-migration-template.js";
import { pipelineSavedViewsMigrationSource } from "./pipeline-saved-views-migration-template.js";
import { payloadPostgresPatchSource as embeddedPayloadPostgresPatchSource } from "./payload-postgres-patch.js";
import { runnableApplicationFiles } from "./runnable-application-files.js";
import { systemAccessApplicationFiles } from "./system-access-application-files.js";
import { systemExtensionApplicationFiles } from "./system-extension-application-files.js";
import { systemOperationsApplicationFiles } from "./system-operations-application-files.js";
import { systemThemeSettingsApplicationFiles } from "./system-theme-settings-application-files.js";
import { workspacePageApplicationFiles } from "./workspace-page-application-files.js";

export type SalesPresetTheme = "minimal" | "neobrutalism";
export type ApplicationDatabaseMode = "docker-postgres" | "external";

/** The release-less factory path always plans against the one signed current tuple. */
export const currentReleaseVersion = supportedFrameworkTuple.core;

/**
 * Phase 13 ships one intentionally non-generic compiler: the Sales reference
 * application. Its domain-specific output is closed here so a second domain or
 * an unreviewed Sales surface cannot enter the generated host by accretion.
 */
export const salesReferenceCompilerBoundary = Object.freeze({
  name: "sales-reference-compiler",
  owner: "Sales module maintainers",
  exitBefore: "1.2.0, Phase 14, a second domain, or any generic compiler claim (whichever comes first)",
  firstPartyDomains: Object.freeze(["module.sales"]),
  platformPaths: Object.freeze([
    ".env.example", ".gitignore", ".k-nex/application-plan.json", ".k-nex/migration-closure.json", ".k-nex/package-release-manifest.json", ".npmrc", "README.md", "compose.yaml", "k-nex-migrate.mjs", "k-nex.app.json", "next-env.d.ts", "next.config.ts", "package.json", "patches/@payloadcms__db-postgres@3.88.0.patch", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "src/app/(auth)/forbidden/page.tsx", "src/app/(auth)/login/page.tsx", "src/app/(payload)/api/[...slug]/route.ts", "src/app/(workspace)/layout.tsx", "src/app/(workspace)/page.tsx",
    "src/app/(workspace)/system/access/assignments/page.tsx", "src/app/(workspace)/system/access/audit/page.tsx", "src/app/(workspace)/system/access/permissions/page.tsx", "src/app/(workspace)/system/access/roles/[roleId]/page.tsx", "src/app/(workspace)/system/access/roles/page.tsx", "src/app/(workspace)/system/extensions/[extensionId]/page.tsx", "src/app/(workspace)/system/extensions/page.tsx", "src/app/(workspace)/system/operations/[operationId]/page.tsx", "src/app/(workspace)/system/operations/page.tsx", "src/app/(workspace)/system/settings/[settingsId]/page.tsx", "src/app/(workspace)/system/settings/page.tsx", "src/app/(workspace)/system/themes/page.tsx", "src/app/(workspace)/system/themes/profiles/[profileId]/page.tsx", "src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx", "src/app/(workspace)/system/workspace-pages/page.tsx", "src/app/(workspace)/workspace/pages/[pageId]/edit/page.tsx", "src/app/(workspace)/workspace/pages/[pageId]/page.tsx",
    "src/app/api/health/route.ts", "src/app/api/k-nex/account/credentials/route.ts", "src/app/api/k-nex/inventory/route.ts", "src/app/api/k-nex/navigation/revision/route.ts", "src/app/api/k-nex/navigation/sidebar/route.ts", "src/app/api/k-nex/workspace-folders/[folderId]/route.ts", "src/app/api/k-nex/workspace-folders/route.ts", "src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts", "src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts", "src/app/api/k-nex/workspace-pages/[pageId]/session/route.ts", "src/app/api/k-nex/workspace-pages/route.ts", "src/app/api/readiness/route.ts",
    "src/app/api/system/access/assignments/[assignmentId]/revoke/route.ts", "src/app/api/system/access/assignments/route.ts", "src/app/api/system/access/grants/[grantId]/remove/route.ts", "src/app/api/system/access/roles/[roleId]/permissions/route.ts", "src/app/api/system/access/roles/route.ts", "src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts", "src/app/api/system/extensions/[extensionId]/plan/route.ts", "src/app/api/system/settings/[settingsId]/route.ts", "src/app/api/system/themes/profiles/[profileId]/preview/route.ts", "src/app/api/system/themes/profiles/[profileId]/publish/route.ts", "src/app/api/system/themes/profiles/[profileId]/rollback/route.ts", "src/app/api/system/themes/profiles/[profileId]/stage/route.ts",
    "src/app/components/k-nex-workspace-page-editor.tsx", "src/app/components/k-nex-workspace-page-runtime.tsx", "src/app/components/k-nex-workspace-shell.tsx", "src/app/components/login-form.tsx", "src/app/components/logout-button.tsx", "src/app/layout.tsx", "src/app/styles.css",
    "src/boot.ts", "src/k-nex-authority.ts", "src/k-nex-bootstrap-owner.ts", "src/k-nex-bootstrap-token.ts", "src/k-nex-doctor.ts", "src/k-nex-identity.ts", "src/k-nex-issue-bootstrap-token.ts", "src/k-nex-readiness.ts", "src/k-nex-realtime.ts", "src/k-nex-registry.ts", "src/k-nex-system-access.ts", "src/k-nex-system-extensions.ts", "src/k-nex-system-operations.ts", "src/k-nex-system-theme-settings.ts", "src/k-nex-theme-runtime.ts", "src/k-nex-users.ts", "src/k-nex-web.ts", "src/k-nex-worker.ts", "src/k-nex-workspace-navigation.ts", "src/k-nex-workspace-page-http.ts", "src/k-nex-workspace-pages.ts",
    "src/migrations/20260827_000002_knex_bootstrap.ts", "src/migrations/20260829_000007_runtime_extensions.ts", "src/migrations/20260901_000019_authorization.ts", "src/migrations/20260901_000022_static_lifecycle_admission.ts", "src/migrations/20260902_000023_system_administration.ts", "src/migrations/20260903_000026_workspace_pages.ts", "src/migrations/20260903_000027_event_outbox.ts", "src/migrations/20260904_000028_workspace_sidebar_preferences.ts", "src/migrations/20260905_000026_release_preflight.ts", "src/migrations/20260909_000035_static_rebind_lock_protocol.ts", "src/migrations/20260909_000036_release_revision.ts", "src/migrations/index.ts", "src/payload.config.ts", "src/tests/generated-application.test.ts", "tsconfig.json", "tsconfig.scripts.json"
  ]),
  runtimePaths: Object.freeze([
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
  ]),
  migrationPaths: Object.freeze([
    "src/migrations/20260827_000001_sales_baseline.ts",
    "src/migrations/20260905_000027_crm_core.ts",
    "src/migrations/20260906_000029_attachment_upload_admissions.ts",
    "src/migrations/20260907_000030_pipeline_saved_views.ts",
    "src/migrations/20260907_000031_data_movement.ts",
    "src/migrations/20260908_000032_communications.ts",
    "src/migrations/20260908_000033_crm_workflows.ts",
    "src/migrations/20260908_000034_reports.ts"
  ])
});

export interface CreateKnexApplicationOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly theme: SalesPresetTheme;
  readonly database: ApplicationDatabaseMode;
  /** Canonical factory authority for clean-install reporting settings. Omit only to force migration maintenance. */
  readonly primaryCurrency?: string;
  readonly packageSource?: {
    readonly kind: "packed-mirror";
    readonly directory: string;
    readonly authority: PackageReleaseManifestAuthority;
    readonly release: VerifiedPackageReleaseManifest;
  };
}

declare const verifiedSourceApplicationManifest: unique symbol;
export interface VerifiedSourceApplicationManifest {
  readonly [verifiedSourceApplicationManifest]: true;
}

export interface SourceApplicationManifestAuthority {
  read(token: VerifiedSourceApplicationManifest): Readonly<{ manifest: ApplicationManifest; digest: string }>;
}

export type UpgradeTargetKnexApplicationOptions = Pick<CreateKnexApplicationOptions, "packageSource" | "primaryCurrency"> & {
  readonly sourceManifestAuthority: SourceApplicationManifestAuthority;
  readonly sourceManifest: VerifiedSourceApplicationManifest;
  readonly sourceManifestDigest: string;
};

export interface ApplicationFactoryPlan {
  readonly planVersion: 1;
  readonly preset: "sales-reference";
  readonly applicationId: string;
  readonly digest: string;
  readonly files: Readonly<Record<string, string>>;
  readonly artifactDigests: Readonly<Record<string, string>>;
  readonly installCommands: readonly (readonly string[])[];
}

export interface ApplicationFactoryApplyResult {
  readonly written: readonly string[];
  readonly unchanged: readonly string[];
}

const exactDependencies = Object.freeze({
  "@k-nex/builder-puck": currentReleaseVersion,
  "@k-nex/composition": currentReleaseVersion,
  "@k-nex/contracts": currentReleaseVersion,
  "@k-nex/module-sales": currentReleaseVersion,
  "@k-nex/payload-adapter": currentReleaseVersion,
  "@k-nex/provider-realtime-socketio": currentReleaseVersion,
  "@k-nex/runtime": currentReleaseVersion,
  "@k-nex/ui-builder-blocks": currentReleaseVersion,
  "@k-nex/ui-components": currentReleaseVersion,
  "@k-nex/ui-data": currentReleaseVersion,
  "@k-nex/ui-design-system-contracts": currentReleaseVersion,
  "@k-nex/ui-forms": currentReleaseVersion,
  "@k-nex/ui-pages": currentReleaseVersion,
  "@k-nex/ui-runtime": currentReleaseVersion,
  "@payloadcms/db-postgres": "3.88.0",
  "@payloadcms/next": "3.88.0",
  // No generated route serves GraphQL, but payload@3.88.0 declares graphql as a
  // required peer and its published types import from it, so the generated
  // application still has to resolve it to build.
  "graphql": "16.14.2",
  "next": "16.3.4",
  "payload": "3.88.0",
  "react": "19.2.8",
  "react-dom": "19.2.8",
  "sharp": "0.35.4",
  "socket.io-client": "4.8.3"
});

export const payloadPostgresPatchPackage = "@payloadcms/db-postgres@3.88.0";
export const payloadPostgresPatchFilename = "patches/@payloadcms__db-postgres@3.88.0.patch";
export const payloadPostgresPatchDigest = "sha256:0889c7c61e08478410dfcb1112415677fa9f50267901ee15c99e3deb1c9edf2f";
export const payloadPostgresPatchProvenance = Object.freeze({
  package: payloadPostgresPatchPackage,
  upstream: "payloadcms/payload#17831@134c89b7955d0dcde9137643ab86873ff542dbd4",
  fixes: ["#15674", "#16256"],
  digest: payloadPostgresPatchDigest
});

const deterministicReleaseOverrides = Object.freeze({
  // @puckeditor/core declares this transitive dependency as ^3.13.9. Keep
  // generated customer installs tied to the reviewed release closure instead
  // of allowing registry time to change the frozen lock configuration.
  "@puckeditor/core>@tanstack/react-virtual": "3.14.11"
});

export function payloadPostgresPatchSource(): string {
  const source = embeddedPayloadPostgresPatchSource;
  if (`sha256:${createHash("sha256").update(source).digest("hex")}` !== payloadPostgresPatchDigest) throw new Error("Payload Postgres patch provenance is invalid.");
  return source;
}

export function generatedPnpmWorkspace(providedOverrides: Readonly<Record<string, string>> = {}): string {
  const overrides = { ...providedOverrides, ...deterministicReleaseOverrides };
  return `packages:\n  - "."\n\nallowBuilds:\n  "cpu-features@0.0.10": false\n  "esbuild@0.18.20": true\n  "esbuild@0.25.12": true\n  "esbuild@0.28.2": true\n  "protobufjs@7.6.5": false\n  "sharp@0.35.4": true\n  "ssh2@1.17.0": false\n\npatchedDependencies:\n  "${payloadPostgresPatchPackage}": "${payloadPostgresPatchFilename}"\n\noverrides:\n${Object.entries(overrides).map(([name, specifier]) => `  "${name}": "${specifier}"`).join("\n")}\n`;
}

const verifiedPlanArtifacts = new WeakMap<ApplicationFactoryPlan, ReadonlyMap<string, Uint8Array>>();

const salesReferenceCompilerPaths = new Set([
  ...salesReferenceCompilerBoundary.runtimePaths,
  ...salesReferenceCompilerBoundary.migrationPaths
]);
const platformCompilerPaths = new Set(salesReferenceCompilerBoundary.platformPaths);

if ([...salesReferenceCompilerPaths].some((path) => platformCompilerPaths.has(path))) {
  throw new Error("Sales-reference compiler inventory overlaps platform paths.");
}

/**
 * The exit criterion is a platform release, so it must be read from the
 * platform release. Reading the generated customer `package.json` could never
 * fire it: the factory writes a fixed version there, so the guard was only ever
 * reachable from a test that rewrote that file.
 */
export function isReleaseBeforeSalesReferenceExit(version: string): boolean {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 1 || major === 1 && minor < 2;
}

type SalesReferenceCompilerTestMutation = "add-sales-output" | "remove-sales-output" | "second-domain" | undefined;
let salesReferenceCompilerTestMutation: SalesReferenceCompilerTestMutation;

/** @internal Test-only negative-path seam. It is unavailable in production. */
export function setSalesReferenceCompilerTestMutationForTests(mutation: SalesReferenceCompilerTestMutation): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Sales-reference compiler test mutation is unavailable outside tests.");
  salesReferenceCompilerTestMutation = mutation;
}

function applySalesReferenceCompilerTestMutation(files: Record<string, string>): void {
  switch (salesReferenceCompilerTestMutation) {
    case undefined: return;
    case "add-sales-output": files["src/k-nex-sales-unreviewed.ts"] = "export {};\n"; return;
    case "remove-sales-output": delete files[salesReferenceCompilerBoundary.runtimePaths[0]!]; return;
    case "second-domain": {
      const manifest = JSON.parse(files["k-nex.app.json"]!) as { plugins: Array<Record<string, unknown>> };
      manifest.plugins.push({ id: "module.inventory", package: "@k-nex/module-inventory", version: "1.0.0", enabled: true });
      files["k-nex.app.json"] = json(manifest);
      return;
    }
  }
}

function assertSalesReferenceCompilerInventory(files: Readonly<Record<string, string>>, salesFiles: Readonly<Record<string, string>>, platformFiles: Readonly<Record<string, string>>, platformRelease: string): void {
  if (!isReleaseBeforeSalesReferenceExit(platformRelease)) {
    throw new Error(`Sales-reference compiler expires before product release ${platformRelease}.`);
  }
  const generatedManifest = ApplicationManifestSchema.parse(JSON.parse(files["k-nex.app.json"]!));
  const firstPartyDomains = generatedManifest.plugins.filter((plugin) => plugin.id.startsWith("module.")).map((plugin) => plugin.id).sort();
  if (firstPartyDomains.length !== 1 || firstPartyDomains[0] !== "module.sales") {
    throw new Error("Sales-reference compiler requires module.sales as its sole first-party domain.");
  }
  const unknown = Object.keys(files).filter((path) => !salesReferenceCompilerPaths.has(path) && !platformCompilerPaths.has(path));
  const unclassifiedSales = Object.keys(salesFiles).filter((path) => !salesReferenceCompilerPaths.has(path));
  const missingSales = [...salesReferenceCompilerPaths].filter((path) => salesFiles[path] === undefined);
  const misclassifiedPlatform = Object.keys(platformFiles).filter((path) => !platformCompilerPaths.has(path));
  if (unknown.length > 0 || unclassifiedSales.length > 0 || missingSales.length > 0 || misclassifiedPlatform.length > 0) {
    throw new Error(`Sales-reference compiler inventory is invalid: unknown=${unknown.sort().join(",") || "none"}; unclassifiedSales=${unclassifiedSales.sort().join(",") || "none"}; missingSales=${missingSales.sort().join(",") || "none"}; misclassifiedPlatform=${misclassifiedPlatform.sort().join(",") || "none"}.`);
  }
}

function artifactFilename(packageName: string, version: string): string {
  return `${packageName.slice(1).replace("/", "-")}-${version}.tgz`;
}

function factoryLockFilename(theme: SalesPresetTheme, digest: string): string {
  return `factory-lock-sales-reference-${theme}-${digest.slice("sha256:".length)}.yaml`;
}

function packageIdentity(archive: Uint8Array): { readonly name: string; readonly version: string } {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.byteLength;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.byteLength) throw new Error("Packed release archive is malformed.");
    if (name === "package/package.json") {
      const value = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString("utf8")) as { name?: unknown; version?: unknown };
      if (typeof value.name !== "string" || typeof value.version !== "string") throw new Error("Packed release package identity is missing.");
      return { name: value.name, version: value.version };
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Packed release archive has no package identity.");
}

function registrySource(theme: SalesPresetTheme, applicationId: string, salesIntegrity: string, realtimeIntegrity: string, release: string, includeRealtime = true): string {
  if (!includeRealtime) return salesOnlyRegistrySource(theme, applicationId, salesIntegrity, release);
  const themeExport = theme === "minimal" ? "resolveMinimalThemeProfile" : "resolveNeobrutalismThemeProfile";
  return `import { PluginManifestSchema } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import { salesCoreCollections, salesCoreCollectionSlugs, salesCrmPermissionDescriptors, salesCrmPermissionPolicyBindings, salesNavigationDescriptors, salesPermissionPolicyExecutors, salesReferenceMetadata, salesRegistration, salesRouteDescriptors } from "@k-nex/module-sales/server";
import { salesMigrationReadiness, salesUpgradeMigrations } from "@k-nex/module-sales/migrations";
import realtimeManifestJson from "@k-nex/provider-realtime-socketio/manifest" with { type: "json" };
import { socketIoRealtimeProviderRegistration } from "@k-nex/provider-realtime-socketio/server";
import { createPlatformPluginLifecycleState, executeRegistration, reconcilePlatformPluginAvailability, scopePlatformPluginRegistration } from "@k-nex/runtime";
import { ${themeExport} } from "@k-nex/theme-${theme}";

const salesManifest = PluginManifestSchema.parse(manifestJson);
const realtimeManifest = PluginManifestSchema.parse(realtimeManifestJson);
const realtimeGateway = realtimeManifest.provides.find(({ capability }) => capability === "realtime.gateway");
if (realtimeGateway === undefined) throw new Error("Realtime gateway capability is unavailable.");
const registration = executeRegistration({
  graph: { resolverVersion: "1.0.0", plugins: [
    { id: realtimeManifest.id, kind: realtimeManifest.kind, package: realtimeManifest.package, version: realtimeManifest.version, integrity: ${JSON.stringify(realtimeIntegrity)}, required: [], optional: [] },
    { id: salesManifest.id, kind: salesManifest.kind, package: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)}, required: [], optional: [] }
  ], capabilityProviders: [{ capability: "realtime.gateway", plugin: realtimeManifest.id, version: realtimeGateway.version }], registrationOrder: [realtimeManifest.id, salesManifest.id] },
  installed: [
    { package: { name: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)} }, manifest: salesManifest },
    { package: { name: realtimeManifest.package, version: realtimeManifest.version, integrity: ${JSON.stringify(realtimeIntegrity)} }, manifest: realtimeManifest }
  ],
  registrations: [salesRegistration, socketIoRealtimeProviderRegistration]
});
const lifecycle = createPlatformPluginLifecycleState({
  pluginId: salesManifest.id, catalogStatus: "supported", package: { status: "installed", name: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)} },
  enabled: true, configuration: { revision: 1, ready: true }, migration: { current: salesMigrationReadiness.currentRevision, required: salesMigrationReadiness.currentRevision, ready: true }, dataState: "active", releaseStatus: "supported"
});
const scopedRegistration = scopePlatformPluginRegistration(registration, [reconcilePlatformPluginAvailability(registration, lifecycle)]);

export const kNexSalesRegistry = Object.freeze({
  registration: salesRegistration,
  scopedRegistration,
  staticRelease: Object.freeze({ package: Object.freeze({ name: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)} }), release: ${JSON.stringify(release)}, runtimeGenerationId: "sales-generation-1", authorizationGeneration: 1 }),
  authorizationGeneration: Object.freeze({ schemaVersion: 1 as const, applicationId: ${JSON.stringify(applicationId)}, owner: { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 }, runtimeGenerationIds: ["sales-generation-1"], state: "current" as const, authorizationRevision: 2, lifecycleRevision: 1 }),
  permissionDescriptors: salesCrmPermissionDescriptors,
  policyBindings: salesCrmPermissionPolicyBindings,
  policyExecutors: salesPermissionPolicyExecutors,
  navigationSection: Object.freeze({ id: "sales.navigation.root", pluginId: "module.sales", label: "Sales", icon: "sales" as const, order: 100, active: true, acceptsCustomerChildren: true, routes: salesRouteDescriptors, navigation: salesNavigationDescriptors, messages: salesReferenceMetadata.localization.messages }),
  collections: Object.freeze([...salesCoreCollections]),
  collectionSlugs: salesCoreCollectionSlugs,
  migrations: salesUpgradeMigrations,
  readiness: salesMigrationReadiness
});
export const kNexRealtimeRegistry = Object.freeze({
  provider: registration.phases.includes("providers") ? registration : undefined,
  scopedRegistration
});

const initialThemeTime = new Date(0).toISOString();
export const kNexInitialThemeProfile = Object.freeze({
  schemaVersion: 1,
  id: "workspace.default-theme",
  surface: "admin",
  themeId: "theme.${theme}",
  themeVersion: ${JSON.stringify(release)},
  palette: "${theme === "minimal" ? "light" : "primary"}",
  mode: "system",
  values: {},
  revision: { id: "workspace.theme.initial", number: 1, state: "published", createdAt: initialThemeTime, publishedAt: initialThemeTime }
});
export const kNexThemePresentation = ${themeExport}(kNexInitialThemeProfile);
`;
}

function salesOnlyRegistrySource(theme: SalesPresetTheme, applicationId: string, salesIntegrity: string, release: string): string {
  const themeExport = theme === "minimal" ? "resolveMinimalThemeProfile" : "resolveNeobrutalismThemeProfile";
  return `import { PluginManifestSchema } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import { salesCoreCollections, salesCoreCollectionSlugs, salesCrmPermissionDescriptors, salesCrmPermissionPolicyBindings, salesNavigationDescriptors, salesPermissionPolicyExecutors, salesReferenceMetadata, salesRegistration, salesRouteDescriptors } from "@k-nex/module-sales/server";
import { salesMigrationReadiness, salesUpgradeMigrations } from "@k-nex/module-sales/migrations";
import { createPlatformPluginLifecycleState, executeRegistration, reconcilePlatformPluginAvailability, scopePlatformPluginRegistration } from "@k-nex/runtime";
import { ${themeExport} } from "@k-nex/theme-${theme}";

const salesManifest = PluginManifestSchema.parse(manifestJson);
const registration = executeRegistration({
  graph: { resolverVersion: "1.0.0", plugins: [{ id: salesManifest.id, kind: salesManifest.kind, package: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)}, required: [], optional: [] }], capabilityProviders: [], registrationOrder: [salesManifest.id] },
  installed: [{ package: { name: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)} }, manifest: salesManifest }],
  registrations: [salesRegistration]
});
const lifecycle = createPlatformPluginLifecycleState({
  pluginId: salesManifest.id, catalogStatus: "supported", package: { status: "installed", name: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)} },
  enabled: true, configuration: { revision: 1, ready: true }, migration: { current: salesMigrationReadiness.currentRevision, required: salesMigrationReadiness.currentRevision, ready: true }, dataState: "active", releaseStatus: "supported"
});
const scopedRegistration = scopePlatformPluginRegistration(registration, [reconcilePlatformPluginAvailability(registration, lifecycle)]);

export const kNexSalesRegistry = Object.freeze({
  registration: salesRegistration,
  scopedRegistration,
  staticRelease: Object.freeze({ package: Object.freeze({ name: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)} }), release: ${JSON.stringify(release)}, runtimeGenerationId: "sales-generation-1", authorizationGeneration: 1 }),
  authorizationGeneration: Object.freeze({ schemaVersion: 1 as const, applicationId: ${JSON.stringify(applicationId)}, owner: { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 }, runtimeGenerationIds: ["sales-generation-1"], state: "current" as const, authorizationRevision: 2, lifecycleRevision: 1 }),
  permissionDescriptors: salesCrmPermissionDescriptors, policyBindings: salesCrmPermissionPolicyBindings, policyExecutors: salesPermissionPolicyExecutors,
  navigationSection: Object.freeze({ id: "sales.navigation.root", pluginId: "module.sales", label: "Sales", icon: "sales" as const, order: 100, active: true, acceptsCustomerChildren: true, routes: salesRouteDescriptors, navigation: salesNavigationDescriptors, messages: salesReferenceMetadata.localization.messages }),
  collections: Object.freeze([...salesCoreCollections]), collectionSlugs: salesCoreCollectionSlugs, migrations: salesUpgradeMigrations, readiness: salesMigrationReadiness
});

const initialThemeTime = new Date(0).toISOString();
export const kNexInitialThemeProfile = Object.freeze({ schemaVersion: 1, id: "workspace.default-theme", surface: "admin", themeId: "theme.${theme}", themeVersion: ${JSON.stringify(release)}, palette: "${theme === "minimal" ? "light" : "primary"}", mode: "system", values: {}, revision: { id: "workspace.theme.initial", number: 1, state: "published", createdAt: initialThemeTime, publishedAt: initialThemeTime } });
export const kNexThemePresentation = ${themeExport}(kNexInitialThemeProfile);
`;
}

function payloadConfigSource(applicationId: string): string {
  return `import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";
import { withTrustedSalesTaskCreateIdAdmission } from "@k-nex/payload-adapter";

import { kNexSalesRegistry } from "./k-nex-registry.js";
import { payloadSecret } from "./k-nex-identity.js";
import { usersCollection } from "./k-nex-users.js";
import { migrations } from "./migrations/index.js";
import { createGeneratedEnvironmentProviderSecretResolver, generatedSalesProviderWebhookEndpoints } from "./k-nex-sales-communications.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

export default buildConfig({
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, prodMigrations: migrations, push: false, allowIDOnCreate: true }),
  collections: [usersCollection, ...kNexSalesRegistry.collections].map(withTrustedSalesTaskCreateIdAdmission),
  endpoints: [...generatedSalesProviderWebhookEndpoints("${applicationId}", process.env.K_NEX_ENVIRONMENT ?? "", createGeneratedEnvironmentProviderSecretResolver())],
  custom: { kNexApplicationId: "${applicationId}", kNexEnvironment: process.env.K_NEX_ENVIRONMENT },
  // A running application never regenerates its own types: Payload otherwise
  // spawns a TypeScript generator from inside the host whenever NODE_ENV is not
  // production, which outlives the host that started it. These types are
  // generated bytes of this application, produced when it is built.
  typescript: { autoGenerate: false },
  admin: { importMap: { autoGenerate: false } },
  secret: payloadSecret
});
`;
}

function bootSource(): string {
  return `import { salesCoreCollectionSlugs } from "@k-nex/module-sales/server";
import { getPayload } from "payload";

import config from "./payload.config.js";

export async function bootKnexApplication(key = "k-nex-application") {
  const payload = await getPayload({ config, key: "k-nex-application" });
  const collections = Object.keys(payload.collections).sort();
  const requiredCollections = [...salesCoreCollectionSlugs, "users"];
  if (requiredCollections.some((collection) => !collections.includes(collection))) {
    throw new Error("K-Nex application collections did not register.");
  }
  return payload;
}
`;
}

function webHostSource(): string {
  return `import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import * as nextModule from "next";

import { bootKnexApplication } from "./boot.js";
import { shutdownKnexApplication } from "./k-nex-authority.js";
import { startKnexRealtime } from "./k-nex-realtime.js";
import { drainKnexWorkspacePages } from "./k-nex-workspace-pages.js";

const port = Number(process.env.PORT ?? "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");
const gracefulShutdownMs = 30_000;
const startupCleanupMs = 5_000;
const next = nextModule.default as unknown as Function;
const nextApp = next({ dev: false, hostname: process.env.HOSTNAME ?? "0.0.0.0", port });
let stopping = false;
let shutdown: Promise<void> | undefined;
const upgradedSockets = new Set<Duplex>();
type AdmittedHandlerMetadata = Readonly<{ kind: "request" | "upgrade"; method: string; pathname: string; startedAtMs: number }>;
const admittedHandlers = new Map<Promise<void>, AdmittedHandlerMetadata>();
const admittedHandlerFailures: unknown[] = [];
const maxRetainedHandlerFailures = 16;
const maxDiagnosticPathnameLength = 256;
const maxShutdownDiagnostics = 16;
type ShutdownSnapshot = Readonly<{ stage: string; totalCount: number; idleCount: number; waitingCount: number }>;
let shutdownStage = "running";
const shutdownHistory: ShutdownSnapshot[] = [];
const shutdownFailureStages: string[] = [];
const server = createServer();
let payload: Awaited<ReturnType<typeof bootKnexApplication>> | undefined;
let realtime: Awaited<ReturnType<typeof startKnexRealtime>> | undefined;
function boundedPoolCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000 ? Number(value) : 0;
}
function recordShutdownSnapshot(stage: string): void {
  shutdownStage = stage;
  if (shutdownHistory.length >= maxShutdownDiagnostics) return;
  const pool = payload?.db.pool as unknown as { totalCount?: number; idleCount?: number; waitingCount?: number } | undefined;
  shutdownHistory.push(Object.freeze({ stage, totalCount: boundedPoolCount(pool?.totalCount), idleCount: boundedPoolCount(pool?.idleCount), waitingCount: boundedPoolCount(pool?.waitingCount) }));
}
function handlerMetadata(kind: AdmittedHandlerMetadata["kind"], request: Readonly<{ method?: string; url?: string }>): AdmittedHandlerMetadata {
  const method = request.method?.toUpperCase();
  let pathname = "/";
  try { pathname = new URL(request.url ?? "/", "http://k-nex.invalid").pathname; } catch { pathname = "/<invalid>"; }
  return Object.freeze({ kind, method: method !== undefined && /^[A-Z]{1,16}$/u.test(method) ? method : "UNKNOWN", pathname: pathname.slice(0, maxDiagnosticPathnameLength), startedAtMs: performance.now() });
}
function shutdownDiagnostic(): string {
  return JSON.stringify({ stage: shutdownStage, activeHandlerCount: admittedHandlers.size, handlers: [...admittedHandlers.values()].slice(0, 16), history: shutdownHistory, failureStages: shutdownFailureStages });
}
function logShutdownExpiry(code: string): void {
  console.error(code, shutdownDiagnostic());
}
function logShutdownFailure(error: unknown): void {
  console.error(error);
  console.error("K_NEX_GRACEFUL_SHUTDOWN_FAILED", shutdownDiagnostic());
}
function retainHandlerFailure(error: unknown): void {
  process.exitCode = 1;
  console.error(error);
  if (admittedHandlerFailures.length < maxRetainedHandlerFailures) admittedHandlerFailures.push(error);
}
function trackHandler(metadata: AdmittedHandlerMetadata, operation: () => Promise<unknown>, close: (error: unknown) => void): void {
  const admitted = Promise.resolve().then(operation).then(
    () => undefined,
    (error: unknown) => {
      retainHandlerFailure(error);
      try { close(error); } catch (closeError) { retainHandlerFailure(closeError); }
    }
  );
  admittedHandlers.set(admitted, metadata);
  void admitted.then(() => admittedHandlers.delete(admitted), () => admittedHandlers.delete(admitted));
}
async function drainAdmittedHandlers(): Promise<void> {
  while (admittedHandlers.size > 0) await Promise.all([...admittedHandlers.keys()]);
  if (admittedHandlerFailures.length > 0) throw new AggregateError(admittedHandlerFailures, "K-Nex admitted web handler failed.");
}
async function failStartup(error: unknown, closeServer: boolean): Promise<never> {
  stopping = true;
  process.exitCode = 1;
  const deadline = setTimeout(() => { process.exitCode = 1; console.error("K_NEX_STARTUP_CLEANUP_EXPIRED"); process.exit(1); }, startupCleanupMs);
  const failures: unknown[] = [error];
  const attempt = async (operation: () => Promise<unknown>): Promise<void> => { try { await operation(); } catch (cleanupError) { failures.push(cleanupError); } };
  await attempt(async () => realtime?.close());
  for (const socket of upgradedSockets) socket.destroy();
  if (closeServer) await attempt(async () => new Promise<void>((resolveClose, reject) => server.close((closeError) => closeError === undefined || (closeError as NodeJS.ErrnoException | undefined)?.code === "ERR_SERVER_NOT_RUNNING" ? resolveClose() : reject(closeError))));
  await attempt(async () => nextApp.close());
  const initializedPayload = payload;
  if (initializedPayload !== undefined) {
    await attempt(async () => drainKnexWorkspacePages(initializedPayload));
    await attempt(async () => shutdownKnexApplication(initializedPayload));
  }
  clearTimeout(deadline);
  if (failures.length > 1) throw new AggregateError(failures, "K-Nex startup and cleanup failed.");
  throw error;
}
try {
  await nextApp.prepare();
  payload = await bootKnexApplication();
  realtime = await startKnexRealtime(payload, server);
} catch (error) {
  await failStartup(error, false);
}
const handler = nextApp.getRequestHandler();
const upgrade = nextApp.getUpgradeHandler();
server.on("request", (request, response) => {
  if (stopping) { response.writeHead(503, { connection: "close" }).end(); return; }
  trackHandler(handlerMetadata("request", request), async () => handler(request, response), (error) => {
    if (response.destroyed) return;
    if (!response.headersSent) response.writeHead(500, { connection: "close" }).end();
    else response.destroy(error instanceof Error ? error : undefined);
  });
});
server.on("upgrade", (request, socket, head) => {
  if (stopping) { socket.destroy(); return; }
  if (request.url?.startsWith("/socket.io/")) return;
  upgradedSockets.add(socket); socket.once("close", () => upgradedSockets.delete(socket));
  trackHandler(handlerMetadata("upgrade", request), async () => upgrade(request, socket, head), (error) => socket.destroy(error instanceof Error ? error : undefined));
});
try {
  await new Promise<void>((resolveListen, reject) => {
    const cleanup = () => { server.off("error", failed); server.off("listening", listening); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const listening = () => { cleanup(); resolveListen(); };
    server.once("error", failed); server.once("listening", listening); server.listen(port);
  });
} catch (error) {
  await failStartup(error, true);
}
server.on("error", (error) => {
  process.exitCode = 1;
  console.error(error);
  const deadline = setTimeout(() => { logShutdownExpiry("K_NEX_SERVER_FAILURE_CLEANUP_EXPIRED"); process.exit(1); }, 5_000);
  void stop().then(
    () => { clearTimeout(deadline); process.exit(1); },
    (shutdownError) => { clearTimeout(deadline); logShutdownFailure(shutdownError); process.exit(1); }
  );
});
async function stop(): Promise<void> {
  shutdown ??= (async () => {
    stopping = true;
    const failures: unknown[] = [];
    const attempt = async (stage: string, operation: () => Promise<unknown>): Promise<void> => { try { await operation(); } catch (error) { failures.push(error); if (shutdownFailureStages.length < maxShutdownDiagnostics) shutdownFailureStages.push(stage); } };
    recordShutdownSnapshot("shutdown-start");
    recordShutdownSnapshot("before-realtime");
    shutdownStage = "realtime-close";
    await attempt("realtime-close", async () => realtime?.close());
    recordShutdownSnapshot("after-realtime");
    shutdownStage = "upgrade-close";
    for (const socket of upgradedSockets) socket.destroy();
    shutdownStage = "server-close";
    await attempt("server-close", async () => new Promise<void>((resolveClose, reject) => server.close((error) => error === undefined || (error as NodeJS.ErrnoException | undefined)?.code === "ERR_SERVER_NOT_RUNNING" ? resolveClose() : reject(error))));
    recordShutdownSnapshot("after-server");
    shutdownStage = "handler-drain";
    await attempt("handler-drain", drainAdmittedHandlers);
    recordShutdownSnapshot("after-handler");
    shutdownStage = "next-close";
    await attempt("next-close", async () => nextApp.close());
    recordShutdownSnapshot("after-next");
    recordShutdownSnapshot("before-workspace");
    shutdownStage = "workspace-drain";
    await attempt("workspace-drain", async () => drainKnexWorkspacePages(payload!));
    recordShutdownSnapshot("after-workspace");
    shutdownStage = "payload-shutdown";
    await attempt("payload-shutdown", async () => shutdownKnexApplication(payload!, (progress) => {
      shutdownStage = "payload-" + progress.stage;
      if (progress.stage === "authority-drain") recordShutdownSnapshot("before-authority");
      else if (progress.stage === "payload-destroy") { recordShutdownSnapshot("after-authority"); recordShutdownSnapshot("before-payload-destroy"); }
      else if (progress.stage === "pool-end") { recordShutdownSnapshot("after-payload-destroy"); recordShutdownSnapshot("before-pool-end"); }
    }));
    shutdownStage = "complete";
    if (failures.length > 0) throw new AggregateError(failures, "K-Nex graceful shutdown failed.");
  })();
  return shutdown;
}
let signalSeen = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  if (signalSeen) { process.exitCode = 1; process.exit(1); return; }
  signalSeen = true;
  const grace = setTimeout(() => { process.exitCode = 1; logShutdownExpiry("K_NEX_GRACEFUL_SHUTDOWN_EXPIRED"); process.exit(1); }, gracefulShutdownMs);
  // Keep the watchdog referenced until teardown settles. A pending Promise does
  // not keep Node alive, so unref'ing this timer could falsely exit zero.
  void stop().then(
    () => clearTimeout(grace),
    (error) => { clearTimeout(grace); process.exitCode = 1; logShutdownFailure(error); process.exit(1); }
  );
});
`;
}

/**
 * `payload migrate` selects migrations by reading this directory and never the
 * registry beside it, so an admission applied in `src/migrations/index.ts`
 * decides nothing about what the command executes. The first declared step
 * therefore admits itself: it proves the executable closure that the launcher
 * proved in a different process, and the ledger and release state this step may
 * run against, before the first statement of the first migration.
 *
 * Three declared steps re-prove the closure rather than all nineteen: this one,
 * the first a fresh installation executes; the release preflight, the first a
 * release transition executes; and the completion step, which proves the closure
 * it records. Cost is not the reason - one proof is about 0.25 s against a
 * migration of about eight - the reason is that seven declared steps are domain
 * migration templates this compiler does not author, and `payload migrate`
 * executes those files directly.
 */
function payloadBaselineMigrationSource(applicationId: string, platformRelease: string, theme: SalesPresetTheme): string {
  return `import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";
import { admitGeneratedReleaseExecutable } from "@k-nex/runtime";

const source = (path: string) => readFileSync(fileURLToPath(import.meta.resolve(path)), "utf8");

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await admitGeneratedReleaseExecutable({
    step: "20260827_000001_sales_baseline",
    execute: (statement: string) => db.execute(sql.raw(statement))
  });
  await db.execute(sql.raw(source("@k-nex/module-sales/payload-baseline-up.sql")));
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(source("@k-nex/module-sales/payload-baseline-down.sql")));
}
`;
}

function crmCoreMigrationSource(): string {
  return canonicalCrmCoreMigrationSource.trimStart();
}

/**
 * Attachment bytes live behind a storage provider, not in the CRM collection graph.
 * This host-owned ledger is the narrow bridge: an operator records a bounded immutable
 * receipt before a Sales attachment reference may bind the storage reference.
 */
function attachmentUploadAdmissionsMigrationSource(): string {
  return `import { sql } from "@payloadcms/db-postgres";
import type { MigrateDownArgs, MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql\`
    CREATE TABLE "k_nex_sales_attachment_upload_admissions" (
      "application_id" text NOT NULL,
      "environment" text NOT NULL,
      "storage_ref" text NOT NULL,
      "uploader_actor_id" text NOT NULL,
      "filename" text NOT NULL,
      "media_type" text NOT NULL,
      "byte_size" integer NOT NULL,
      "state" text NOT NULL DEFAULT 'ready',
      "revision" integer NOT NULL DEFAULT 1,
      "issued_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("application_id", "environment", "storage_ref"),
      CHECK (length("application_id") BETWEEN 1 AND 128),
      CHECK (length("environment") BETWEEN 1 AND 64),
      CHECK (length("storage_ref") BETWEEN 1 AND 512 AND "storage_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'),
      CHECK ("uploader_actor_id" ~ '^[A-Za-z0-9:_./-]{1,160}$'),
      CHECK (length("filename") BETWEEN 1 AND 256 AND "filename" !~ '[[:cntrl:]]'),
      CHECK (length("media_type") BETWEEN 1 AND 128 AND "media_type" !~ '[[:cntrl:]]'),
      CHECK ("byte_size" BETWEEN 0 AND 1073741824),
      CHECK ("state" = 'ready'),
      CHECK ("revision" BETWEEN 1 AND 1000000000)
    );
    CREATE INDEX "k_nex_sales_attachment_upload_admissions_lookup"
      ON "k_nex_sales_attachment_upload_admissions" ("application_id", "environment", "uploader_actor_id", "storage_ref");
  \`);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql\`DROP TABLE "k_nex_sales_attachment_upload_admissions"\`);
}
`;
}

/**
 * A fresh install reaches this release through the bootstrap migration, which
 * an upgraded install cannot re-run: its bytes are append-only and still name
 * the release that generated them. This step advances the database to the
 * release it is now running, so both arrive at the same identity, and it fails
 * closed rather than leaving readiness to discover a stale one. Rollback is by
 * source restore, so there is no reverse step to write.
 */
const tupleClause = (state: { readonly predecessorRevision: number; readonly revision: number; readonly identity: string }): string =>
  `("predecessor_revision" = ${state.predecessorRevision} AND "revision" = ${state.revision} AND "release_revision" = '${state.identity}')`;

/**
 * Release state is admitted as an exact tuple, never as a numeric comparison: a
 * row that merely counts as newer is not evidence of anything, and treating one
 * as trusted authority would admit a corrupt identity or an impossible chain
 * field. The states this step may see are enumerable - this installation still
 * running, this release already complete, or the predecessor this release
 * upgrades from - and everything else fails closed before any target migration
 * mutates customer schema.
 *
 * A transition from the predecessor belongs to the upgrade coordinator, which
 * holds the database authority across the whole set; this command refuses it
 * rather than performing an unfenced one.
 */
function releasePreflightMigrationSource(applicationId: string, platformRelease: string, theme: SalesPresetTheme): string {
  const installing = platformInstallingState(platformRelease);
  const complete = platformReleaseState(platformRelease);
  const source = platformTransitionSource(platformRelease);
  return `import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";
import { assertGeneratedExecutableClosure } from "@k-nex/runtime";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // An upgrade has already applied the first declared step, so this is where the
  // target set of a release transition starts and where its executable closure
  // is re-proved after the launcher proved it in a different process.
  assertGeneratedExecutableClosure({ theme: ${JSON.stringify(theme)} });
  await db.execute(sql.raw(\`DO $$
DECLARE admitted integer; transition integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('k-nex/release-revision/${applicationId}'));
  IF to_regclass('public.k_nex_release_revision') IS NULL THEN
    RAISE EXCEPTION 'Release ${platformRelease} refuses this database: ${applicationId} has no release record, and the bootstrap migration that creates it has already run';
  END IF;
  SELECT count(*) INTO admitted FROM "k_nex_release_revision"
   WHERE "application_id" = '${applicationId}' AND (${tupleClause(installing)} OR ${tupleClause(complete)});
  IF admitted = 1 THEN
    RETURN;
  END IF;
${source === undefined ? "" : `  SELECT count(*) INTO transition FROM "k_nex_release_revision"
   WHERE "application_id" = '${applicationId}' AND ${tupleClause(source)};
  IF transition = 1 THEN
    RAISE EXCEPTION 'Release ${platformRelease} will not migrate this database: an existing release must be transitioned by the upgrade coordinator, which holds the database authority across the whole transition, not by the application migration command';
  END IF;
`}  RAISE EXCEPTION 'Release ${platformRelease} refuses this database: ${applicationId} does not record a release state this application can run';
END $$;\`));
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  void db;
}
`;
}

/**
 * The release identity is a completion receipt. It is written here, last, and
 * only once this database's applied migration ledger is exactly the set this
 * release declares - so a direct invocation, a partial chain, a substituted or
 * missing step, and an unknown extra step all leave the recorded release
 * untouched. A database already carrying this release passes through, which is
 * what lets a later release replay the registry, but it passes through the same
 * ledger and migration-set checks: a receipt that were only true at the instant
 * it was written would make the first valid completion a permanent exemption
 * from the proof it stands for.
 */
/** The migration identities this release declares, in the order it applies them. */
function declaredMigrationRegistry(): readonly string[] {
  return [...salesReferenceCompilerBoundary.platformPaths, ...salesReferenceCompilerBoundary.migrationPaths]
    .filter((path) => /^src\/migrations\/(?!index\.ts$)[^/]+\.ts$/u.test(path))
    .map((path) => path.slice("src/migrations/".length, -".ts".length))
    .sort();
}

function releaseRevisionMigrationSource(applicationId: string, platformRelease: string, theme: SalesPresetTheme): string {
  const registry = declaredMigrationRegistry();
  const completionStep = registry[registry.length - 1]!;
  const precedingMigrations = registry.slice(0, -1);
  const installing = platformInstallingState(platformRelease);
  const complete = platformReleaseState(platformRelease);
  const source = platformTransitionSource(platformRelease);
  const ledger = (names: readonly string[]) => `ARRAY[${names.map((name) => `'${name}'`).join(",")}]::text[]`;
  return `import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

import { assertGeneratedExecutableClosure } from "@k-nex/runtime";

/**
 * The receipt records the closure that produced it, so the claim stays
 * checkable after the fact: the ledger proves which migrations ran, the
 * migration digest proves which registry and migration bytes those names stood
 * for, and the executable closure proves the packed archives and installed
 * package bytes those migrations executed from. The completion row is only read
 * as authority again while all three still hold.
 */
function completionStatement(digest: string, releaseClosure: string): string {
  const declared = "'" + digest + "'";
  const closure = "'" + releaseClosure + "'";
  return [
    "DO $$",
    "DECLARE applied text[]; recorded text; recordedClosure text; complete integer; advanced integer;",
    "BEGIN",
    "  PERFORM pg_advisory_xact_lock(hashtext('k-nex/release-revision/${applicationId}'));",
    "  IF to_regclass('public.k_nex_release_revision') IS NULL THEN",
    "    RAISE EXCEPTION 'Release ${platformRelease} will not record its identity: ${applicationId} has no release record';",
    "  END IF;",
    "  IF to_regclass('public.payload_migrations') IS NULL THEN",
    "    applied := ARRAY[]::text[];",
    "  ELSE",
    "    SELECT coalesce(array_agg(\\"name\\" ORDER BY \\"id\\"), ARRAY[]::text[]) INTO applied FROM \\"payload_migrations\\";",
    "  END IF;",
    "  IF applied IS DISTINCT FROM ${ledger(precedingMigrations)}",
    "     AND applied IS DISTINCT FROM ${ledger([...precedingMigrations, completionStep])} THEN",
    "    RAISE EXCEPTION 'Release ${platformRelease} will not record its identity: the applied migration ledger is not the exact set this release declares';",
    "  END IF;",
    "  ALTER TABLE \\"k_nex_release_revision\\" ADD COLUMN IF NOT EXISTS \\"migration_set_digest\\" varchar;",
    "  ALTER TABLE \\"k_nex_release_revision\\" ADD COLUMN IF NOT EXISTS \\"release_closure\\" varchar;",
    "  SELECT count(*) INTO complete FROM \\"k_nex_release_revision\\"",
    "   WHERE \\"application_id\\" = '${applicationId}' AND ${tupleClause(complete).replace(/"/gu, '\\"')};",
    "  IF complete = 1 THEN",
    "    SELECT \\"migration_set_digest\\", \\"release_closure\\" INTO recorded, recordedClosure",
    "      FROM \\"k_nex_release_revision\\" WHERE \\"application_id\\" = '${applicationId}';",
    "    IF recorded IS DISTINCT FROM " + declared + " OR recordedClosure IS DISTINCT FROM " + closure + " THEN",
    "      RAISE EXCEPTION 'Release ${platformRelease} refuses this database: its release identity was recorded for migration closure % of release closure %, and this artifact declares % of %',",
    "        coalesce(recorded, 'none'), coalesce(recordedClosure, 'none'), " + declared + ", coalesce(" + closure + ", 'none');",
    "    END IF;",
    "    RETURN;",
    "  END IF;",
    "  UPDATE \\"k_nex_release_revision\\"",
    "     SET \\"predecessor_revision\\" = ${complete.predecessorRevision}, \\"revision\\" = ${complete.revision},",
    "         \\"release_revision\\" = '${complete.identity}', \\"migration_set_digest\\" = " + declared + ", \\"release_closure\\" = " + closure,
    "   WHERE \\"application_id\\" = '${applicationId}' AND (${tupleClause(installing).replace(/"/gu, '\\"')}${source === undefined ? "" : ` OR ${tupleClause(source).replace(/"/gu, '\\"')}`});",
    "  GET DIAGNOSTICS advanced = ROW_COUNT;",
    "  IF advanced <> 1 THEN",
    "    RAISE EXCEPTION 'Release ${platformRelease} will not record its identity: ${applicationId} does not carry this installation or the exact predecessor release';",
    "  END IF;",
    "END $$;"
  ].join("\\n");
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const closure = assertGeneratedExecutableClosure({ theme: ${JSON.stringify(theme)} });
  await db.execute(sql.raw(completionStatement(closure.migration.digest, closure.digest)));
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  void db;
  throw new Error("Platform release ${platformRelease} is forward-only; recover the predecessor release by restoring its protected source and database.");
}
`;
}

/**
 * The closure a generated application is held to: the verified package release
 * manifest that identifies its package archives, every migration source, and
 * the registry file that decides which implementation runs under each ledger
 * name. The guard that checks it ships in @k-nex/runtime rather than in the
 * generated tree, so the value recorded in the database receipt is not a claim
 * the application makes about itself in a file it could edit alongside the
 * migration it is vouching for.
 */
function migrationClosureDigest(files: Readonly<Record<string, string>>): { readonly digest: string; readonly releaseManifestDigest: string | null } {
  const manifest = files[".k-nex/package-release-manifest.json"];
  const releaseManifestDigest = manifest === undefined ? null : `sha256:${createHash("sha256").update(manifest, "utf8").digest("hex")}`;
  const names = [...declaredMigrationRegistry().map((name) => `${name}.ts`), "index.ts"].sort();
  const digest = createHash("sha256");
  digest.update(`release-manifest ${releaseManifestDigest ?? "none"}\n`);
  for (const name of names) {
    const source = files[`src/migrations/${name}`];
    if (source === undefined) throw new Error(`The generated application does not carry the declared migration source ${name}.`);
    digest.update(`${name} ${createHash("sha256").update(source, "utf8").digest("hex")}\n`);
  }
  return { digest: digest.digest("hex"), releaseManifestDigest };
}


/**
 * `payload migrate` selects pending migrations and runs them; it has no opinion
 * about whether the code behind those migrations is the code this release was
 * closed over. Several declared steps are wrappers whose SQL lives in package
 * code, so a drifted installed package would change customer data and only be
 * discovered by readiness afterwards - which cannot undo a forward-only
 * migration. The generated command therefore proves the executable closure
 * first and hands over to Payload only if it holds.
 *
 * This launcher is inside the tree it measures. An operator who replaces it has
 * replaced the trusted authority rather than defeated a proof, and the honest
 * claim is the narrower one: a launcher that runs refuses a drifted closure,
 * spawns the child without the bootstrap authority it just refused for itself,
 * and is measured by the closure it records, so a substituted launcher cannot
 * produce the receipt this one writes.
 *
 * It ships as plain ESM rather than compiled output because it runs before the
 * application is built: a guard that only exists after a successful build is
 * not a guard on the first migration.
 */
function migrateCommandSource(theme: SalesPresetTheme): string {
  return `import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { assertGeneratedExecutableBootstrap, assertGeneratedExecutableClosure, sanitizedExecutableEnvironment } from "@k-nex/runtime";

assertGeneratedExecutableBootstrap();
const root = resolve(process.cwd());
const closure = assertGeneratedExecutableClosure({ root, theme: ${JSON.stringify(theme)} });
// Flushed before the child is spawned: a pipe write left queued behind a
// blocking spawn would put the admission after everything it admitted.
await new Promise((flushed) => process.stdout.write(\`K_NEX_MIGRATE_ADMITTED \${closure.digest} \${closure.recorded} \${closure.packages.length}\\n\`, flushed));

const payload = resolve(root, "node_modules/.bin/payload");
if (!existsSync(payload)) throw new Error("This application cannot migrate: its Payload command is not installed.");
const migration = spawnSync(payload, ["migrate"], { cwd: root, stdio: "inherit", env: sanitizedExecutableEnvironment() });
if (migration.error !== undefined) throw migration.error;
process.exit(migration.status ?? 1);
`;
}

/**
 * `payload migrate` selects migrations by reading `src/migrations` and skips
 * `index.ts`, so the registry's wrapper governs programmatic callers only. The
 * admission that governs the command has to live in the declared step files
 * the command actually loads, and it has to be on every step: a database whose
 * ledger lost one row has exactly that step re-selected, and no earlier step
 * runs to admit it. This wraps each emitted step once, at the point the step
 * sources are assembled, so a new step cannot be added without one.
 */
/**
 * The admission a declared step carries, applied to that step's implementation.
 * It is exported because the fixture lineage keeps the same implementations
 * without being a generated application: the factory's step is that file plus
 * this, and a proof that compares them says so rather than pinning bytes.
 */
export function admittedMigrationSource(step: string, source: string): string {
  if (source.includes("admitGeneratedReleaseExecutable(")) return source;
  // Aliased so the admission a step carries cannot collide with whatever that
  // step's own implementation already imports under those names.
  const preamble = 'import { sql as kNexAdmissionSql } from "@payloadcms/db-postgres";\n' +
    'import type { MigrateUpArgs as KNexAdmissionArgs } from "@payloadcms/db-postgres";\n' +
    'import { admitGeneratedReleaseExecutable } from "@k-nex/runtime";\n';
  const renamed = source
    .replace(/export async function up\(/u, "async function admittedStep(")
    .replace(/export const up = /u, "const admittedStep = ");
  if (renamed === source) throw new Error(`The generated migration ${step} does not export an up step this release can admit.`);
  return `${preamble}${renamed}\nexport async function up(args: KNexAdmissionArgs): Promise<void> {\n` +
    `  await admitGeneratedReleaseExecutable({\n` +
    `    step: ${JSON.stringify(step)},\n` +
    `    execute: (statement: string) => args.db.execute(kNexAdmissionSql.raw(statement))\n` +
    `  });\n  await admittedStep(args);\n}\n`;
}

/**
 * `payload migrate` selects migrations by reading `src/migrations` and skips
 * `index.ts`, so the registry's wrapper governs programmatic callers only. The
 * admission that governs the command has to live in the declared step files the
 * command actually loads, and it has to be on every step: a database whose
 * ledger lost one row has exactly that step re-selected, and no earlier step
 * runs to admit it.
 */
function admittedMigrationSources(files: Record<string, string>): void {
  for (const step of declaredMigrationRegistry()) {
    const path = `src/migrations/${step}.ts`;
    const source = files[path];
    if (source === undefined) throw new Error(`The generated application does not carry the declared migration ${step}.`);
    files[path] = admittedMigrationSource(step, source);
  }
}

function bootstrapMigrationSource(applicationId: string, platformRelease: string): string {
  return `import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(\`CREATE TABLE "k_nex_release_revision" (
    "application_id" varchar PRIMARY KEY NOT NULL, "predecessor_revision" integer NOT NULL,
    "revision" integer NOT NULL, "release_revision" varchar NOT NULL
  ); INSERT INTO "k_nex_release_revision" VALUES ('${applicationId}', ${platformInstallingState(platformRelease).predecessorRevision}, ${platformInstallingState(platformRelease).revision}, '${platformInstallingState(platformRelease).identity}');\`));
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw('DROP TABLE "k_nex_release_revision" CASCADE;'));
}
`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validOptions(options: CreateKnexApplicationOptions): void {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(options.applicationId) || options.applicationName.length < 1 || options.applicationName.length > 160 ||
    !["minimal", "neobrutalism"].includes(options.theme) || !["docker-postgres", "external"].includes(options.database)) {
    throw new Error("Application factory options are invalid.");
  }
  if (options.primaryCurrency !== undefined && !/^[A-Z]{3}$/u.test(options.primaryCurrency)) {
    throw new Error("Application factory primary currency must be an uppercase ISO-4217 code.");
  }
  if (options.packageSource !== undefined && (options.packageSource.kind !== "packed-mirror" ||
    !options.packageSource.directory.startsWith("/") || !existsSync(options.packageSource.directory) || !lstatSync(options.packageSource.directory).isDirectory())) {
    throw new Error("Application factory packed mirror is invalid.");
  }
}

function applicationManifest(options: CreateKnexApplicationOptions, packageVersions: ReadonlyMap<string, string>, includeRealtime = true): ApplicationManifest {
  return ApplicationManifestSchema.parse({
    schemaVersion: 1,
    application: { id: options.applicationId, name: options.applicationName, type: "customer-platform" },
    runtime: { node: "24.19.0", packageManager: "pnpm", packageManagerVersion: "11.9.0", deploymentMode: "container", ...(includeRealtime ? { realtime: { adapter: "memory", webInstances: 1, worker: "separate", workerInvalidationPath: "postgres-outbox-relay", realtimeGateway: "embedded", rollingDeployment: "stop-before-start" } } : {}) },
    framework: { payload: { database: { adapter: "postgres", package: "@payloadcms/db-postgres", connectionEnvironmentVariable: "DATABASE_URL" } } },
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: packageVersions.get("@k-nex/module-sales") ?? currentReleaseVersion, enabled: true },
      ...(includeRealtime ? [{ id: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: packageVersions.get("@k-nex/provider-realtime-socketio") ?? currentReleaseVersion, enabled: true }] : [])],
    providers: includeRealtime ? { "realtime.gateway": { plugin: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: packageVersions.get("@k-nex/provider-realtime-socketio") ?? currentReleaseVersion } } : {},
    builder: { plugin: "builder.puck", package: "@k-nex/builder-puck", version: packageVersions.get("@k-nex/builder-puck") ?? currentReleaseVersion, profiles: { workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } } },
    themes: { active: options.theme, package: `@k-nex/theme-${options.theme}`, version: packageVersions.get(`@k-nex/theme-${options.theme}`) ?? currentReleaseVersion },
    development: { database: options.database === "docker-postgres" ? { mode: "docker-postgres", serviceName: "postgres" } : { mode: "external" } },
    build: { dockerfile: false, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true },
    environment: { required: ["DATABASE_URL", "K_NEX_ADMINISTRATION_OPERATOR_CA_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY", "K_NEX_ADMINISTRATION_OPERATOR_HOST", "K_NEX_ADMINISTRATION_OPERATOR_IDENTITY", "K_NEX_ADMINISTRATION_OPERATOR_PORT", "K_NEX_ADMINISTRATION_OPERATOR_URI_SAN", "K_NEX_ENVIRONMENT", "K_NEX_GENERATION", "K_NEX_PUBLIC_ORIGIN", "PAYLOAD_SECRET"] }
  });
}

function planKnexApplication(options: CreateKnexApplicationOptions, includeRealtime: boolean, sourceManifest?: ApplicationManifest): ApplicationFactoryPlan {
  validOptions(options);
  const release = options.packageSource === undefined ? undefined : options.packageSource.authority.read(options.packageSource.release).manifest;
  // The generated host is compiled against the exact package surface of this
  // release: the registry it emits imports symbols that earlier releases do
  // not export, so pinning an earlier release produces an application that
  // cannot even run its migrations. The support policy is single-current-
  // release, so refuse instead of emitting that dead end. An application for
  // an earlier release is produced by that release's own compiler, which is
  // how the upgrade proofs reproduce their 1.0 source.
  if (release !== undefined && release.release.version !== currentReleaseVersion) {
    throw new Error(`This compiler generates ${currentReleaseVersion} applications; ${release.release.version} must be generated by the ${release.release.version} compiler.`);
  }
  const releaseManifest = release === undefined ? undefined : canonicalJson(release);
  const releaseManifestDigest = releaseManifest === undefined ? undefined : `sha256:${createHash("sha256").update(releaseManifest).digest("hex")}`;
  const releasedPackages = new Map(release?.packages.map((entry) => [entry.package, entry.version]) ?? []);
  const dependencyVersions = { ...exactDependencies, [`@k-nex/theme-${options.theme}`]: currentReleaseVersion };
  const artifacts = new Map<string, Uint8Array>();
  const artifactDigests: Record<string, string> = {};
  let factoryLock: string | undefined;
  if (release !== undefined && options.packageSource !== undefined) {
    for (const entry of release.packages) {
      const filename = artifactFilename(entry.package, entry.version);
      const path = resolve(options.packageSource.directory, filename);
      if (dirname(path) !== resolve(options.packageSource.directory) || !existsSync(path) || lstatSync(path).isSymbolicLink()) {
        throw new Error(`Packed release artifact is unavailable for ${entry.package}@${entry.version}.`);
      }
      const bytes = readFileSync(path);
      const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
      if (integrity !== entry.integrity) throw new Error(`Packed release integrity mismatch for ${entry.package}@${entry.version}.`);
      const identity = packageIdentity(bytes);
      if (identity.name !== entry.package || identity.version !== entry.version) throw new Error(`Packed release package identity mismatch for ${entry.package}@${entry.version}.`);
      artifacts.set(filename, new Uint8Array(bytes));
      artifactDigests[filename] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    }
    const lock = release.factoryLockTemplates[options.theme];
    const filename = factoryLockFilename(options.theme, lock.digest);
    const path = resolve(options.packageSource.directory, filename);
    if (dirname(path) !== resolve(options.packageSource.directory) || !existsSync(path) || lstatSync(path).isSymbolicLink()) {
      throw new Error(`Packed release factory lock is unavailable for ${options.theme}.`);
    }
    factoryLock = readFileSync(path, "utf8");
    if (`sha256:${createHash("sha256").update(factoryLock).digest("hex")}` !== lock.digest) {
      throw new Error(`Packed release factory lock integrity mismatch for ${options.theme}.`);
    }
  }
  const dependencies = Object.fromEntries(Object.entries(dependencyVersions).map(([name, version]) => {
    if (!name.startsWith("@k-nex/") || options.packageSource === undefined) return [name, version];
    const releasedVersion = releasedPackages.get(name);
    if (releasedVersion === undefined) throw new Error(`Packed release does not contain ${name}.`);
    return [name, `file:.k-nex/packages/${artifactFilename(name, releasedVersion)}`];
  }));
  const manifest = sourceManifest === undefined ? applicationManifest(options, releasedPackages, includeRealtime) : ApplicationManifestSchema.parse({
    ...sourceManifest,
    schemaVersion: 1,
    runtime: { ...sourceManifest.runtime, node: supportedFrameworkTuple.node, packageManagerVersion: supportedFrameworkTuple.pnpm },
    plugins: sourceManifest.plugins.map((plugin) => ({ ...plugin, version: releasedPackages.get(plugin.package) ?? currentReleaseVersion })),
    providers: Object.fromEntries(Object.entries(sourceManifest.providers).map(([capability, provider]) => [capability, { ...provider, version: releasedPackages.get(provider.package) ?? currentReleaseVersion }])),
    ...(sourceManifest.builder === undefined ? {} : { builder: { ...sourceManifest.builder, version: releasedPackages.get(sourceManifest.builder.package) ?? currentReleaseVersion } }),
    themes: { ...sourceManifest.themes, version: releasedPackages.get(String(sourceManifest.themes.package)) ?? currentReleaseVersion }
  });
  const files: Record<string, string> = {
    ...runnableApplicationFiles({ applicationId: options.applicationId, applicationName: options.applicationName, database: options.database, theme: options.theme }),
    ...applicationAuthFiles({ applicationId: options.applicationId, applicationName: options.applicationName, ...(options.primaryCurrency === undefined ? {} : { primaryCurrency: options.primaryCurrency }), theme: options.theme, themeReleaseVersion: release?.release.version ?? currentReleaseVersion }),
    ...systemAccessApplicationFiles({ applicationId: options.applicationId }),
    ...systemExtensionApplicationFiles({ applicationId: options.applicationId }),
    ...systemThemeSettingsApplicationFiles({ applicationId: options.applicationId }),
    ...systemOperationsApplicationFiles({ applicationId: options.applicationId }),
    ...workspacePageApplicationFiles({ applicationId: options.applicationId }),
    ".env.example": "DATABASE_URL=\nK_NEX_ADMINISTRATION_OPERATOR_CA_CERT=\nK_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT=\nK_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY=\nK_NEX_ADMINISTRATION_OPERATOR_HOST=\nK_NEX_ADMINISTRATION_OPERATOR_IDENTITY=\nK_NEX_ADMINISTRATION_OPERATOR_PORT=\nK_NEX_ADMINISTRATION_OPERATOR_URI_SAN=\nK_NEX_ENVIRONMENT=\nK_NEX_GENERATION=\nK_NEX_OWNER_EMAIL=\nK_NEX_OWNER_PASSWORD=\nK_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE=\nK_NEX_PROVIDER_SECRET_EMAIL_REFERENCE=\nK_NEX_PUBLIC_ORIGIN=\nK_NEX_REFERENCE_PROVIDER_ENDPOINT=\nK_NEX_WEBHOOK_SECRET_CALENDAR_REFERENCE=\nK_NEX_WEBHOOK_SECRET_EMAIL_REFERENCE=\nPAYLOAD_SECRET=\n",
    [payloadPostgresPatchFilename]: payloadPostgresPatchSource(),
    "pnpm-workspace.yaml": generatedPnpmWorkspace(),
    ".k-nex/application-plan.json": json({
      planVersion: 1,
      preset: "sales-reference",
      composition: { plugins: manifest.plugins.map((plugin) => `${plugin.id}@${plugin.version}`).sort(), builder: `${manifest.builder!.plugin}@${manifest.builder!.version}`, theme: `${options.theme}@${manifest.themes.version}`, databaseAdapter: "postgres" },
      packageSource: release === undefined ? { kind: "workspace" } : {
        kind: "packed-mirror", release: release.release.version,
        manifestDigest: releaseManifestDigest
      },
      payloadPostgresPatch: payloadPostgresPatchProvenance,
      reporting: { primaryCurrency: options.primaryCurrency ?? null, provenance: options.primaryCurrency === undefined ? "unconfigured" : "factory-configured" },
      migration: { owner: "customer", action: "review-and-apply", expectedPredecessorRevision: 0 },
      readiness: ["exact-package-inventory", "migration-revision", "sales-registration"],
      lifecyclePlans: ["add", "disable", "enable", "upgrade"]
    }),
    "k-nex.app.json": json(manifest),
    "package.json": json({
      name: options.applicationId, version: "1.0.0", private: true, type: "module", packageManager: "pnpm@11.9.0",
      engines: { node: ">=24 <25", pnpm: "11.9.0" },
      scripts: {
        build: "pnpm build:scripts && next build --webpack",
        "build:scripts": "tsc -p tsconfig.scripts.json",
        dev: "next dev --webpack",
        // next and payload load .env themselves; these plain node entrypoints
        // do not, so without this an operator who configured .env would watch
        // knex:migrate succeed and knex:doctor report missing configuration.
        "knex:bootstrap-owner": "node --env-file-if-exists=.env dist/k-nex-bootstrap-owner.js",
        ...(options.database === "docker-postgres" ? { "knex:db:up": "docker compose up -d postgres" } : {}),
        "knex:doctor": "node --env-file-if-exists=.env dist/k-nex-doctor.js",
        "knex:issue-attachment-upload-receipt": "node --env-file-if-exists=.env dist/k-nex-issue-attachment-upload-receipt.js",
        "knex:issue-bootstrap-token": "node --env-file-if-exists=.env dist/k-nex-issue-bootstrap-token.js",
        "knex:migrate": "node --env-file-if-exists=.env k-nex-migrate.mjs",
        start: "node --env-file-if-exists=.env dist/k-nex-web.js",
        test: "node --test dist/tests/*.test.js",
        "knex:worker": "node --env-file-if-exists=.env dist/k-nex-worker.js"
      },
      dependencies,
      devDependencies: { "@types/node": "24.13.3", "@types/react": "19.2.18", "@types/react-dom": "19.2.4", typescript: "6.0.3" }
    }),
    "src/boot.ts": bootSource(),
    "k-nex-migrate.mjs": migrateCommandSource(options.theme),
    "src/k-nex-web.ts": webHostSource(),
    "src/k-nex-registry.ts": registrySource(options.theme, options.applicationId, release?.packages.find(({ package: packageName }) => packageName === "@k-nex/module-sales")?.integrity ?? "sha512-d29ya3NwYWNl", release?.packages.find(({ package: packageName }) => packageName === "@k-nex/provider-realtime-socketio")?.integrity ?? "sha512-d29ya3NwYWNl", release?.release.version ?? currentReleaseVersion, includeRealtime),
    "src/k-nex-sales-data-movement.ts": dataMovementHostSource(),
    "src/k-nex-sales-communications.ts": communicationsHostSource(),
    "src/k-nex-sales-workflows.ts": crmWorkflowsHostSource(),
    "src/k-nex-sales-reports.ts": reportsHostSource(),
    "src/migrations/20260827_000001_sales_baseline.ts": payloadBaselineMigrationSource(options.applicationId, release?.release.version ?? currentReleaseVersion, options.theme),
    "src/migrations/20260827_000002_knex_bootstrap.ts": bootstrapMigrationSource(options.applicationId, release?.release.version ?? currentReleaseVersion),
    "src/migrations/20260829_000007_runtime_extensions.ts": `import { kNexRuntimeExtensionSchemaMigrations, type CustomerPayloadMigration } from "@k-nex/payload-adapter";\n\nexport async function up(args: Parameters<CustomerPayloadMigration["up"]>[0]): Promise<void> {\n  for (const migration of kNexRuntimeExtensionSchemaMigrations) await migration.up(args);\n}\n\nexport async function down(args: Parameters<CustomerPayloadMigration["down"]>[0]): Promise<void> {\n  for (const migration of [...kNexRuntimeExtensionSchemaMigrations].reverse()) await migration.down(args);\n}\n`,
    "src/migrations/20260901_000019_authorization.ts": `import { kNexAuthorizationSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexAuthorizationSchemaMigration.up;\nexport const down = kNexAuthorizationSchemaMigration.down;\n`,
    "src/migrations/20260901_000022_static_lifecycle_admission.ts": `import { kNexStaticLifecycleAdmissionSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexStaticLifecycleAdmissionSchemaMigration.up;\nexport const down = kNexStaticLifecycleAdmissionSchemaMigration.down;\n`,
    "src/migrations/20260902_000023_system_administration.ts": `import { kNexSystemAdministrationSchemaMigrations, type CustomerPayloadMigration } from "@k-nex/payload-adapter";\n\nexport async function up(args: Parameters<CustomerPayloadMigration["up"]>[0]): Promise<void> {\n  for (const migration of kNexSystemAdministrationSchemaMigrations) await migration.up(args);\n}\n\nexport async function down(args: Parameters<CustomerPayloadMigration["down"]>[0]): Promise<void> {\n  for (const migration of [...kNexSystemAdministrationSchemaMigrations].reverse()) await migration.down(args);\n}\n`,
    "src/migrations/20260903_000026_workspace_pages.ts": `import { kNexWorkspacePageSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexWorkspacePageSchemaMigration.up;\nexport const down = kNexWorkspacePageSchemaMigration.down;\n`,
    "src/migrations/20260903_000027_event_outbox.ts": `import { kNexEventOutboxSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexEventOutboxSchemaMigration.up;\nexport const down = kNexEventOutboxSchemaMigration.down;\n`,
    "src/migrations/20260904_000028_workspace_sidebar_preferences.ts": `import { kNexWorkspaceSidebarPreferenceSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexWorkspaceSidebarPreferenceSchemaMigration.up;\nexport const down = kNexWorkspaceSidebarPreferenceSchemaMigration.down;\n`,
    "src/migrations/20260905_000027_crm_core.ts": crmCoreMigrationSource(),
    "src/migrations/20260906_000029_attachment_upload_admissions.ts": attachmentUploadAdmissionsMigrationSource(),
    "src/migrations/20260907_000030_pipeline_saved_views.ts": pipelineSavedViewsMigrationSource(),
    "src/migrations/20260907_000031_data_movement.ts": dataMovementMigrationSource(),
    "src/migrations/20260908_000032_communications.ts": communicationsMigrationSource(),
    "src/migrations/20260908_000033_crm_workflows.ts": crmWorkflowsMigrationSource(),
    "src/migrations/20260908_000034_reports.ts": reportsMigrationSource(options.primaryCurrency === undefined ? {} : { primaryCurrency: options.primaryCurrency }),
    "src/migrations/20260909_000035_static_rebind_lock_protocol.ts": `import { kNexStaticRebindLockProtocolSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexStaticRebindLockProtocolSchemaMigration.up;\nexport const down = kNexStaticRebindLockProtocolSchemaMigration.down;\n`,
    "src/migrations/20260905_000026_release_preflight.ts": releasePreflightMigrationSource(options.applicationId, release?.release.version ?? currentReleaseVersion, options.theme),
    "src/migrations/20260909_000036_release_revision.ts": releaseRevisionMigrationSource(options.applicationId, release?.release.version ?? currentReleaseVersion, options.theme),
    "src/migrations/index.ts": `import { sql, type MigrateUpArgs } from "@payloadcms/db-postgres";\nimport { admitGeneratedReleaseExecutable } from "@k-nex/runtime";\n\nimport * as baseline from "./20260827_000001_sales_baseline.js";\nimport * as bootstrap from "./20260827_000002_knex_bootstrap.js";\nimport * as runtimeExtensions from "./20260829_000007_runtime_extensions.js";\nimport * as authorization from "./20260901_000019_authorization.js";\nimport * as staticLifecycleAdmission from "./20260901_000022_static_lifecycle_admission.js";\nimport * as systemAdministration from "./20260902_000023_system_administration.js";\nimport * as workspacePages from "./20260903_000026_workspace_pages.js";\nimport * as eventOutbox from "./20260903_000027_event_outbox.js";\nimport * as workspaceSidebarPreferences from "./20260904_000028_workspace_sidebar_preferences.js";\nimport * as releasePreflight from "./20260905_000026_release_preflight.js";\nimport * as crmCore from "./20260905_000027_crm_core.js";\nimport * as attachmentUploadAdmissions from "./20260906_000029_attachment_upload_admissions.js";\nimport * as pipelineSavedViews from "./20260907_000030_pipeline_saved_views.js";\nimport * as dataMovement from "./20260907_000031_data_movement.js";\nimport * as communications from "./20260908_000032_communications.js";\nimport * as crmWorkflows from "./20260908_000033_crm_workflows.js";\nimport * as reports from "./20260908_000034_reports.js";\nimport * as staticRebindLockProtocol from "./20260909_000035_static_rebind_lock_protocol.js";\nimport * as releaseRevision from "./20260909_000036_release_revision.js";\n\n/**\n * Any caller handed this registry is handed the admitted step, never the bare\n * implementation. It is not the path \`payload migrate\` takes: that command\n * selects migrations by reading this directory and skips this file, so the\n * admission that governs the command is written into the declared steps\n * themselves. Both forms call the same platform guard, so neither is a\n * generated copy of it.\n */\nconst admitted = <Args extends { readonly db: MigrateUpArgs["db"] }>(step: string, up: (args: Args) => Promise<void>): ((args: Args) => Promise<void>) =>\n  async (args: Args): Promise<void> => {\n    await admitGeneratedReleaseExecutable({\n      step,\n      execute: (statement) => args.db.execute(sql.raw(statement))\n    });\n    await up(args);\n  };\n\nexport const migrations = [\n  { name: "20260827_000001_sales_baseline", up: admitted("20260827_000001_sales_baseline", baseline.up), down: baseline.down },\n  { name: "20260827_000002_knex_bootstrap", up: admitted("20260827_000002_knex_bootstrap", bootstrap.up), down: bootstrap.down },\n  { name: "20260829_000007_runtime_extensions", up: admitted("20260829_000007_runtime_extensions", runtimeExtensions.up), down: runtimeExtensions.down },\n  { name: "20260901_000019_authorization", up: admitted("20260901_000019_authorization", authorization.up), down: authorization.down },\n  { name: "20260901_000022_static_lifecycle_admission", up: admitted("20260901_000022_static_lifecycle_admission", staticLifecycleAdmission.up), down: staticLifecycleAdmission.down },\n  { name: "20260902_000023_system_administration", up: admitted("20260902_000023_system_administration", systemAdministration.up), down: systemAdministration.down },\n  { name: "20260903_000026_workspace_pages", up: admitted("20260903_000026_workspace_pages", workspacePages.up), down: workspacePages.down },\n  { name: "20260903_000027_event_outbox", up: admitted("20260903_000027_event_outbox", eventOutbox.up), down: eventOutbox.down },\n  { name: "20260904_000028_workspace_sidebar_preferences", up: admitted("20260904_000028_workspace_sidebar_preferences", workspaceSidebarPreferences.up), down: workspaceSidebarPreferences.down },\n  { name: "20260905_000026_release_preflight", up: admitted("20260905_000026_release_preflight", releasePreflight.up), down: releasePreflight.down },\n  { name: "20260905_000027_crm_core", up: admitted("20260905_000027_crm_core", crmCore.up), down: crmCore.down },\n  { name: "20260906_000029_attachment_upload_admissions", up: admitted("20260906_000029_attachment_upload_admissions", attachmentUploadAdmissions.up), down: attachmentUploadAdmissions.down },\n  { name: "20260907_000030_pipeline_saved_views", up: admitted("20260907_000030_pipeline_saved_views", pipelineSavedViews.up), down: pipelineSavedViews.down },\n  { name: "20260907_000031_data_movement", up: admitted("20260907_000031_data_movement", dataMovement.up), down: dataMovement.down },\n  { name: "20260908_000032_communications", up: admitted("20260908_000032_communications", communications.up), down: communications.down },\n  { name: "20260908_000033_crm_workflows", up: admitted("20260908_000033_crm_workflows", crmWorkflows.up), down: crmWorkflows.down },\n  { name: "20260908_000034_reports", up: admitted("20260908_000034_reports", reports.up), down: reports.down },\n  { name: "20260909_000035_static_rebind_lock_protocol", up: admitted("20260909_000035_static_rebind_lock_protocol", staticRebindLockProtocol.up), down: staticRebindLockProtocol.down },\n  { name: "20260909_000036_release_revision", up: admitted("20260909_000036_release_revision", releaseRevision.up), down: releaseRevision.down }\n];\n`,
    "src/payload.config.ts": payloadConfigSource(options.applicationId),
  };
  if (releaseManifest !== undefined) files[".k-nex/package-release-manifest.json"] = releaseManifest;
  if (factoryLock !== undefined) files["pnpm-lock.yaml"] = factoryLock;
  if (release !== undefined && options.packageSource !== undefined) {
    const overrides = Object.fromEntries([...release.packages].sort((left, right) => left.package.localeCompare(right.package)).map((entry) => [entry.package,
      `file:.k-nex/packages/${artifactFilename(entry.package, entry.version)}`]));
    files[".npmrc"] = "link-workspace-packages=false\nshared-workspace-lockfile=false\n";
    files["pnpm-workspace.yaml"] = generatedPnpmWorkspace(overrides);
  }
  if (options.database === "docker-postgres") {
    files["compose.yaml"] = "services:\n  postgres:\n    image: postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94\n    environment:\n      POSTGRES_DB: knex\n      POSTGRES_PASSWORD: knex\n      POSTGRES_USER: knex\n    ports:\n      - \"5432:5432\"\n    volumes:\n      - postgres-data:/var/lib/postgresql/data\nvolumes:\n  postgres-data:\n";
  }
  // Declared last, so it covers the manifest this plan actually writes: the
  // closure is a statement about the files on disk, and the guard that checks
  // it recomputes exactly this over the same directory.
  admittedMigrationSources(files);
  files[".k-nex/migration-closure.json"] = json({
    applicationId: options.applicationId, release: release?.release.version ?? currentReleaseVersion, theme: options.theme,
    migrations: declaredMigrationRegistry(), ...migrationClosureDigest(files)
  });
  applySalesReferenceCompilerTestMutation(files);
  const salesFiles = Object.fromEntries([...salesReferenceCompilerPaths].flatMap((path) => files[path] === undefined ? [] : [[path, files[path]]]));
  const platformFiles = Object.fromEntries(Object.entries(files).filter(([path]) => !salesReferenceCompilerPaths.has(path)));
  assertSalesReferenceCompilerInventory(files, salesFiles, platformFiles, release?.release.version ?? currentReleaseVersion);
  const orderedFiles = Object.freeze(Object.fromEntries(Object.entries({ ...platformFiles, ...salesFiles }).sort(([left], [right]) => left.localeCompare(right))));
  const orderedArtifactDigests = Object.freeze(Object.fromEntries(Object.entries(artifactDigests).sort(([left], [right]) => left.localeCompare(right))));
  const digest = `sha256:${createHash("sha256").update(canonicalJson({ files: orderedFiles, artifactDigests: orderedArtifactDigests })).digest("hex")}`;
  const plan = Object.freeze({
    planVersion: 1,
    preset: "sales-reference",
    applicationId: options.applicationId,
    digest,
    files: orderedFiles,
    artifactDigests: orderedArtifactDigests,
    installCommands: Object.freeze(options.packageSource === undefined ? [] : [Object.freeze(["pnpm", "install", "--frozen-lockfile"])])
  });
  if (options.packageSource !== undefined) {
    verifiedPlanArtifacts.set(plan, new Map([...artifacts].map(([name, bytes]) => [name, new Uint8Array(bytes)])));
  }
  return plan;
}

export function planCreateKnexApplication(options: CreateKnexApplicationOptions): ApplicationFactoryPlan {
  return planKnexApplication(options, true);
}

function assertSupportedUpgradeSourceManifest(sourceManifest: ApplicationManifest): { options: CreateKnexApplicationOptions; includeRealtime: boolean } {
  const selectedIds = sourceManifest.plugins.map(({ id }) => id).sort();
  const includeRealtime = selectedIds.includes("provider.realtime.socketio");
  const expectedIds = includeRealtime ? ["module.sales", "provider.realtime.socketio"] : ["module.sales"];
  if (canonicalJson(selectedIds) !== canonicalJson(expectedIds) || includeRealtime !== (sourceManifest.providers["realtime.gateway"] !== undefined)) throw new Error("Upgrade target supports only the exact source Sales/realtime selected graph.");
  const plugins = new Map(sourceManifest.plugins.map((plugin) => [plugin.id, plugin]));
  if (plugins.get("module.sales")?.package !== "@k-nex/module-sales" || plugins.get("module.sales")?.enabled !== true || plugins.get("module.sales")?.options !== undefined ||
    includeRealtime && (plugins.get("provider.realtime.socketio")?.package !== "@k-nex/provider-realtime-socketio" || plugins.get("provider.realtime.socketio")?.enabled !== true || plugins.get("provider.realtime.socketio")?.options !== undefined)) {
    throw new Error("Upgrade target cannot preserve this compiled plugin state or configuration.");
  }
  const realtimeProvider = sourceManifest.providers["realtime.gateway"];
  if (realtimeProvider !== undefined && (realtimeProvider.plugin !== "provider.realtime.socketio" || realtimeProvider.package !== "@k-nex/provider-realtime-socketio" || realtimeProvider.options !== undefined)) {
    throw new Error("Upgrade target cannot preserve this provider configuration.");
  }
  const expectedRealtime = { adapter: "memory", webInstances: 1, worker: "separate", workerInvalidationPath: "postgres-outbox-relay", realtimeGateway: "embedded", rollingDeployment: "stop-before-start" };
  if (sourceManifest.application.type !== "customer-platform" || sourceManifest.application.defaultLocale !== undefined || sourceManifest.application.locales !== undefined ||
    sourceManifest.runtime.packageManager !== "pnpm" || sourceManifest.runtime.deploymentMode !== "container" || (includeRealtime ? canonicalJson(sourceManifest.runtime.realtime) !== canonicalJson(expectedRealtime) : sourceManifest.runtime.realtime !== undefined) ||
    sourceManifest.framework.payload.database.adapter !== "postgres" || sourceManifest.framework.payload.database.package !== "@payloadcms/db-postgres" || sourceManifest.framework.payload.database.connectionEnvironmentVariable !== "DATABASE_URL") {
    throw new Error("Upgrade target cannot preserve this application/runtime/framework configuration.");
  }
  if (sourceManifest.builder?.plugin !== "builder.puck" || sourceManifest.builder.package !== "@k-nex/builder-puck" || canonicalJson(sourceManifest.builder.profiles) !== canonicalJson({ workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } })) {
    throw new Error("Upgrade target cannot preserve this builder configuration.");
  }
  const theme = sourceManifest.themes.active;
  if ((theme !== "minimal" && theme !== "neobrutalism") || sourceManifest.themes.package !== `@k-nex/theme-${theme}` || Object.keys(sourceManifest.themes).sort().join(",") !== "active,package,version") {
    throw new Error("Upgrade target cannot preserve this theme configuration.");
  }
  const database = sourceManifest.development.database.mode;
  if (database !== "external" && database !== "docker-postgres" || database === "docker-postgres" && sourceManifest.development.database.serviceName !== "postgres" ||
    canonicalJson(sourceManifest.build) !== canonicalJson({ dockerfile: false, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true })) {
    throw new Error("Upgrade target cannot preserve this development/build configuration.");
  }
  return { options: { applicationId: sourceManifest.application.id, applicationName: sourceManifest.application.name, theme, database }, includeRealtime };
}

export function planUpgradeTargetKnexApplication(options: UpgradeTargetKnexApplicationOptions): ApplicationFactoryPlan {
  const record = options.sourceManifestAuthority.read(options.sourceManifest);
  const sourceManifest = ApplicationManifestSchema.parse(record.manifest);
  const canonicalDigest = `sha256:${createHash("sha256").update(canonicalJson(sourceManifest)).digest("hex")}`;
  if (record.digest !== options.sourceManifestDigest || canonicalDigest !== record.digest) throw new Error("Verified source application manifest digest is stale.");
  const supported = assertSupportedUpgradeSourceManifest(sourceManifest);
  return planKnexApplication({ ...supported.options, ...(options.primaryCurrency === undefined ? {} : { primaryCurrency: options.primaryCurrency }), ...(options.packageSource === undefined ? {} : { packageSource: options.packageSource }) }, supported.includeRealtime, sourceManifest);
}

export function applyCreateKnexApplication(plan: ApplicationFactoryPlan, targetDirectory: string): ApplicationFactoryApplyResult {
  const artifacts = verifiedPlanArtifacts.get(plan);
  if (artifacts === undefined) {
    throw new Error("Application factory apply requires a verified packed release plan.");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(plan.digest) ||
    plan.digest !== `sha256:${createHash("sha256").update(canonicalJson({ files: plan.files, artifactDigests: plan.artifactDigests })).digest("hex")}`) {
    throw new Error("Application factory plan digest is invalid.");
  }
  const target = resolve(targetDirectory);
  const paths = Object.entries(plan.files);
  const artifactPaths = [...artifacts].map(([name, bytes]) => [`.k-nex/packages/${name}`, bytes] as const);
  const unchanged: string[] = [];
  const pending: string[] = [];
  const components = target.split("/").filter(Boolean);
  let ancestor = "/";
  for (const component of components) {
    ancestor = join(ancestor, component);
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) {
      throw new Error("Application factory refuses symlinked target paths.");
    }
  }
  for (const [relativePath, content] of paths) {
    if (relativePath.startsWith("/") || relativePath.split("/").some((segment) => segment === ".." || segment === "")) throw new Error("Application factory path is invalid.");
    const path = resolve(target, relativePath);
    if (relative(target, path).startsWith("..")) throw new Error("Application factory path escapes its target.");
    if (!existsSync(path)) { pending.push(relativePath); continue; }
    if (lstatSync(path).isSymbolicLink()) throw new Error("Application factory refuses symlinked destination paths.");
    if (readFileSync(path, "utf8") !== content) throw new Error(`Application factory refuses to overwrite ${relativePath}.`);
    unchanged.push(relativePath);
  }
  for (const [relativePath, bytes] of artifactPaths) {
    const path = resolve(target, relativePath);
    if (!existsSync(path)) { pending.push(relativePath); continue; }
    if (lstatSync(path).isSymbolicLink() || !readFileSync(path).equals(bytes)) throw new Error(`Application factory refuses to overwrite ${relativePath}.`);
    unchanged.push(relativePath);
  }
  if (pending.length === 0) return Object.freeze({ written: Object.freeze([]), unchanged: Object.freeze(unchanged) });
  if (existsSync(target)) {
    if (!lstatSync(target).isDirectory() || readdirSync(target).length !== 0) throw new Error("Application factory only promotes a complete fresh application target.");
    rmdirSync(target);
  }
  mkdirSync(dirname(target), { recursive: true });
  const stage = mkdtempSync(join(dirname(target), ".k-nex-app-stage-"));
  try {
    for (const [relativePath, content] of paths) {
      const path = resolve(stage, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    }
    for (const [relativePath, bytes] of artifactPaths) {
      const path = resolve(stage, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes, { flag: "wx" });
    }
    for (const [relativePath, content] of paths) {
      if (readFileSync(resolve(stage, relativePath), "utf8") !== content) throw new Error("Application factory staged validation failed.");
    }
    for (const [relativePath, bytes] of artifactPaths) {
      if (!readFileSync(resolve(stage, relativePath)).equals(bytes)) throw new Error("Application factory staged artifact validation failed.");
    }
    renameSync(stage, target);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ written: Object.freeze([...paths.map(([relativePath]) => relativePath), ...artifactPaths.map(([relativePath]) => relativePath)]), unchanged: Object.freeze([]) });
}
