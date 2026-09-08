import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ApplicationManifestSchema, canonicalJson, type ApplicationManifest, type PackageReleaseManifestAuthority, type VerifiedPackageReleaseManifest } from "@k-nex/contracts";
import { applicationAuthFiles } from "./application-auth-files.js";
import { crmCoreMigrationSource as canonicalCrmCoreMigrationSource } from "./crm-core-migration-template.js";
import { dataMovementMigrationSource } from "./data-movement-migration-template.js";
import { dataMovementHostSource } from "./data-movement-host-template.js";
import { communicationsMigrationSource } from "./communications-migration-template.js";
import { communicationsHostSource } from "./communications-host-template.js";
import { crmWorkflowsHostSource } from "./crm-workflows-host-template.js";
import { crmWorkflowsMigrationSource } from "./crm-workflows-migration-template.js";
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

export interface CreateKnexApplicationOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly theme: SalesPresetTheme;
  readonly database: ApplicationDatabaseMode;
  readonly packageSource?: {
    readonly kind: "packed-mirror";
    readonly directory: string;
    readonly authority: PackageReleaseManifestAuthority;
    readonly release: VerifiedPackageReleaseManifest;
  };
}

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
  "@k-nex/builder-puck": "1.0.0",
  "@k-nex/composition": "1.0.0",
  "@k-nex/contracts": "1.0.0",
  "@k-nex/module-sales": "1.0.0",
  "@k-nex/payload-adapter": "1.0.0",
  "@k-nex/provider-realtime-socketio": "1.0.0",
  "@k-nex/runtime": "1.0.0",
  "@k-nex/ui-builder-blocks": "1.0.0",
  "@k-nex/ui-components": "1.0.0",
  "@k-nex/ui-data": "1.0.0",
  "@k-nex/ui-design-system-contracts": "1.0.0",
  "@k-nex/ui-forms": "1.0.0",
  "@k-nex/ui-pages": "1.0.0",
  "@k-nex/ui-runtime": "1.0.0",
  "@payloadcms/db-postgres": "3.88.0",
  "@payloadcms/next": "3.88.0",
  "graphql": "16.14.2",
  "next": "16.3.1",
  "payload": "3.88.0",
  "react": "19.2.8",
  "react-dom": "19.2.8",
  "sharp": "0.35.3",
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

export function payloadPostgresPatchSource(): string {
  const source = embeddedPayloadPostgresPatchSource;
  if (`sha256:${createHash("sha256").update(source).digest("hex")}` !== payloadPostgresPatchDigest) throw new Error("Payload Postgres patch provenance is invalid.");
  return source;
}

export function generatedPnpmWorkspace(overrides: Readonly<Record<string, string>> = {}): string {
  return `packages:\n  - "."\n\nallowBuilds:\n  "cpu-features@0.0.10": false\n  "esbuild@0.18.20": true\n  "esbuild@0.25.12": true\n  "esbuild@0.28.2": true\n  "protobufjs@7.6.5": false\n  "sharp@0.35.3": true\n  "ssh2@1.17.0": false\n\npatchedDependencies:\n  "${payloadPostgresPatchPackage}": "${payloadPostgresPatchFilename}"\n\noverrides:\n${Object.entries(overrides).map(([name, specifier]) => `  "${name}": "${specifier}"`).join("\n")}\n`;
}

const verifiedPlanArtifacts = new WeakMap<ApplicationFactoryPlan, ReadonlyMap<string, Uint8Array>>();

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

function registrySource(theme: SalesPresetTheme, applicationId: string, salesIntegrity: string, realtimeIntegrity: string, release: string): string {
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
const registration = executeRegistration({
  graph: { resolverVersion: "1.0.0", plugins: [
    { id: realtimeManifest.id, kind: realtimeManifest.kind, package: realtimeManifest.package, version: realtimeManifest.version, integrity: ${JSON.stringify(realtimeIntegrity)}, required: [], optional: [] },
    { id: salesManifest.id, kind: salesManifest.kind, package: salesManifest.package, version: salesManifest.version, integrity: ${JSON.stringify(salesIntegrity)}, required: [], optional: [] }
  ], capabilityProviders: [{ capability: "realtime.gateway", plugin: realtimeManifest.id, version: "1.0.0" }], registrationOrder: [realtimeManifest.id, salesManifest.id] },
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
  themeVersion: "1.0.0",
  palette: "${theme === "minimal" ? "light" : "primary"}",
  mode: "system",
  values: {},
  revision: { id: "workspace.theme.initial", number: 1, state: "published", createdAt: initialThemeTime, publishedAt: initialThemeTime }
});
export const kNexThemePresentation = ${themeExport}(kNexInitialThemeProfile);
`;
}

function payloadConfigSource(applicationId: string): string {
  return `import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";

import { kNexSalesRegistry } from "./k-nex-registry.js";
import { payloadSecret } from "./k-nex-identity.js";
import { usersCollection } from "./k-nex-users.js";
import { migrations } from "./migrations/index.js";
import { createGeneratedEnvironmentProviderSecretResolver, generatedSalesProviderWebhookEndpoints } from "./k-nex-sales-communications.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

export default buildConfig({
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, prodMigrations: migrations, push: false }),
  collections: [usersCollection, ...kNexSalesRegistry.collections],
  endpoints: [...generatedSalesProviderWebhookEndpoints("${applicationId}", process.env.K_NEX_ENVIRONMENT ?? "", createGeneratedEnvironmentProviderSecretResolver())],
  custom: { kNexApplicationId: "${applicationId}", kNexEnvironment: process.env.K_NEX_ENVIRONMENT },
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

function payloadBaselineMigrationSource(): string {
  return `import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

const source = (path: string) => readFileSync(fileURLToPath(import.meta.resolve(path)), "utf8");

export async function up({ db }: MigrateUpArgs): Promise<void> {
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

function bootstrapMigrationSource(applicationId: string, platformRelease: string): string {
  return `import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-postgres";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(\`CREATE TABLE "k_nex_release_revision" (
    "application_id" varchar PRIMARY KEY NOT NULL, "predecessor_revision" integer NOT NULL,
    "revision" integer NOT NULL, "release_revision" varchar NOT NULL
  ); INSERT INTO "k_nex_release_revision" VALUES ('${applicationId}', 0, 1, 'platform-${platformRelease}-bootstrap');\`));
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
  if (options.packageSource !== undefined && (options.packageSource.kind !== "packed-mirror" ||
    !options.packageSource.directory.startsWith("/") || !existsSync(options.packageSource.directory) || !lstatSync(options.packageSource.directory).isDirectory())) {
    throw new Error("Application factory packed mirror is invalid.");
  }
}

function applicationManifest(options: CreateKnexApplicationOptions, packageVersions: ReadonlyMap<string, string>): ApplicationManifest {
  return ApplicationManifestSchema.parse({
    schemaVersion: 1,
    application: { id: options.applicationId, name: options.applicationName, type: "customer-platform" },
    runtime: { node: "24.19.0", packageManager: "pnpm", packageManagerVersion: "11.9.0", deploymentMode: "container", realtime: { adapter: "memory", webInstances: 1, worker: "separate", workerInvalidationPath: "postgres-outbox-relay", realtimeGateway: "embedded", rollingDeployment: "stop-before-start" } },
    framework: { payload: { database: { adapter: "postgres", package: "@payloadcms/db-postgres", connectionEnvironmentVariable: "DATABASE_URL" } } },
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: packageVersions.get("@k-nex/module-sales") ?? "1.0.0", enabled: true },
      { id: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: packageVersions.get("@k-nex/provider-realtime-socketio") ?? "1.0.0", enabled: true }],
    providers: { "realtime.gateway": { plugin: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: packageVersions.get("@k-nex/provider-realtime-socketio") ?? "1.0.0" } },
    builder: { plugin: "builder.puck", package: "@k-nex/builder-puck", version: packageVersions.get("@k-nex/builder-puck") ?? "1.0.0", profiles: { workspace: { enabled: true, drafts: true, surfaces: ["workspace"] } } },
    themes: { active: options.theme, package: `@k-nex/theme-${options.theme}`, version: packageVersions.get(`@k-nex/theme-${options.theme}`) ?? "1.0.0" },
    development: { database: options.database === "docker-postgres" ? { mode: "docker-postgres", serviceName: "postgres" } : { mode: "external" } },
    build: { dockerfile: false, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true },
    environment: { required: ["DATABASE_URL", "K_NEX_ADMINISTRATION_OPERATOR_CA_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT", "K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY", "K_NEX_ADMINISTRATION_OPERATOR_HOST", "K_NEX_ADMINISTRATION_OPERATOR_IDENTITY", "K_NEX_ADMINISTRATION_OPERATOR_PORT", "K_NEX_ADMINISTRATION_OPERATOR_URI_SAN", "K_NEX_ENVIRONMENT", "K_NEX_GENERATION", "K_NEX_PUBLIC_ORIGIN", "PAYLOAD_SECRET"] }
  });
}

export function planCreateKnexApplication(options: CreateKnexApplicationOptions): ApplicationFactoryPlan {
  validOptions(options);
  const release = options.packageSource === undefined ? undefined : options.packageSource.authority.read(options.packageSource.release).manifest;
  const releaseManifest = release === undefined ? undefined : canonicalJson(release);
  const releaseManifestDigest = releaseManifest === undefined ? undefined : `sha256:${createHash("sha256").update(releaseManifest).digest("hex")}`;
  const releasedPackages = new Map(release?.packages.map((entry) => [entry.package, entry.version]) ?? []);
  const dependencyVersions = { ...exactDependencies, [`@k-nex/theme-${options.theme}`]: "1.0.0" };
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
  const manifest = applicationManifest(options, releasedPackages);
  const files: Record<string, string> = {
    ...runnableApplicationFiles({ applicationId: options.applicationId, applicationName: options.applicationName, database: options.database, theme: options.theme }),
    ...applicationAuthFiles({ applicationId: options.applicationId, applicationName: options.applicationName, theme: options.theme }),
    ...systemAccessApplicationFiles({ applicationId: options.applicationId }),
    ...systemExtensionApplicationFiles({ applicationId: options.applicationId }),
    ...systemThemeSettingsApplicationFiles({ applicationId: options.applicationId }),
    ...systemOperationsApplicationFiles({ applicationId: options.applicationId }),
    ...workspacePageApplicationFiles({ applicationId: options.applicationId }),
    ".env.example": "DATABASE_URL=\nK_NEX_ADMINISTRATION_OPERATOR_CA_CERT=\nK_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT=\nK_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY=\nK_NEX_ADMINISTRATION_OPERATOR_HOST=\nK_NEX_ADMINISTRATION_OPERATOR_IDENTITY=\nK_NEX_ADMINISTRATION_OPERATOR_PORT=\nK_NEX_ADMINISTRATION_OPERATOR_URI_SAN=\nK_NEX_ENVIRONMENT=\nK_NEX_GENERATION=\nK_NEX_OWNER_EMAIL=\nK_NEX_OWNER_PASSWORD=\nK_NEX_PROVIDER_SECRET_CALENDAR_REFERENCE=\nK_NEX_PROVIDER_SECRET_EMAIL_REFERENCE=\nK_NEX_PUBLIC_ORIGIN=\nK_NEX_REFERENCE_PROVIDER_ENDPOINT=\nPAYLOAD_SECRET=\n",
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
        "knex:bootstrap-owner": "node dist/k-nex-bootstrap-owner.js",
        ...(options.database === "docker-postgres" ? { "knex:db:up": "docker compose up -d postgres" } : {}),
        "knex:doctor": "node dist/k-nex-doctor.js",
        "knex:issue-attachment-upload-receipt": "node dist/k-nex-issue-attachment-upload-receipt.js",
        "knex:issue-bootstrap-token": "node dist/k-nex-issue-bootstrap-token.js",
        "knex:migrate": "payload migrate",
        start: "node dist/k-nex-web.js",
        test: "node --test dist/tests/*.test.js",
        "knex:worker": "node dist/k-nex-worker.js"
      },
      dependencies,
      devDependencies: { "@types/node": "24.13.3", "@types/react": "19.2.18", "@types/react-dom": "19.2.4", typescript: "6.0.3" }
    }),
    "src/boot.ts": bootSource(),
    "src/k-nex-web.ts": webHostSource(),
    "src/k-nex-registry.ts": registrySource(options.theme, options.applicationId, release?.packages.find(({ package: packageName }) => packageName === "@k-nex/module-sales")?.integrity ?? "sha512-d29ya3NwYWNl", release?.packages.find(({ package: packageName }) => packageName === "@k-nex/provider-realtime-socketio")?.integrity ?? "sha512-d29ya3NwYWNl", release?.release.version ?? "1.0.0"),
    "src/k-nex-sales-data-movement.ts": dataMovementHostSource(),
    "src/k-nex-sales-communications.ts": communicationsHostSource(),
    "src/k-nex-sales-workflows.ts": crmWorkflowsHostSource(),
    "src/migrations/20260827_000001_sales_baseline.ts": payloadBaselineMigrationSource(),
    "src/migrations/20260827_000002_knex_bootstrap.ts": bootstrapMigrationSource(options.applicationId, release?.release.version ?? "1.0.0"),
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
    "src/migrations/index.ts": `import * as baseline from "./20260827_000001_sales_baseline.js";\nimport * as bootstrap from "./20260827_000002_knex_bootstrap.js";\nimport * as runtimeExtensions from "./20260829_000007_runtime_extensions.js";\nimport * as authorization from "./20260901_000019_authorization.js";\nimport * as staticLifecycleAdmission from "./20260901_000022_static_lifecycle_admission.js";\nimport * as systemAdministration from "./20260902_000023_system_administration.js";\nimport * as workspacePages from "./20260903_000026_workspace_pages.js";\nimport * as eventOutbox from "./20260903_000027_event_outbox.js";\nimport * as workspaceSidebarPreferences from "./20260904_000028_workspace_sidebar_preferences.js";\nimport * as crmCore from "./20260905_000027_crm_core.js";\nimport * as attachmentUploadAdmissions from "./20260906_000029_attachment_upload_admissions.js";\nimport * as pipelineSavedViews from "./20260907_000030_pipeline_saved_views.js";\nimport * as dataMovement from "./20260907_000031_data_movement.js";\nimport * as communications from "./20260908_000032_communications.js";\nimport * as crmWorkflows from "./20260908_000033_crm_workflows.js";\n\nexport const migrations = [\n  { name: "20260827_000001_sales_baseline", up: baseline.up, down: baseline.down },\n  { name: "20260827_000002_knex_bootstrap", up: bootstrap.up, down: bootstrap.down },\n  { name: "20260829_000007_runtime_extensions", up: runtimeExtensions.up, down: runtimeExtensions.down },\n  { name: "20260901_000019_authorization", up: authorization.up, down: authorization.down },\n  { name: "20260901_000022_static_lifecycle_admission", up: staticLifecycleAdmission.up, down: staticLifecycleAdmission.down },\n  { name: "20260902_000023_system_administration", up: systemAdministration.up, down: systemAdministration.down },\n  { name: "20260903_000026_workspace_pages", up: workspacePages.up, down: workspacePages.down },\n  { name: "20260903_000027_event_outbox", up: eventOutbox.up, down: eventOutbox.down },\n  { name: "20260904_000028_workspace_sidebar_preferences", up: workspaceSidebarPreferences.up, down: workspaceSidebarPreferences.down },\n  { name: "20260905_000027_crm_core", up: crmCore.up, down: crmCore.down },\n  { name: "20260906_000029_attachment_upload_admissions", up: attachmentUploadAdmissions.up, down: attachmentUploadAdmissions.down },\n  { name: "20260907_000030_pipeline_saved_views", up: pipelineSavedViews.up, down: pipelineSavedViews.down },\n  { name: "20260907_000031_data_movement", up: dataMovement.up, down: dataMovement.down },\n  { name: "20260908_000032_communications", up: communications.up, down: communications.down },\n  { name: "20260908_000033_crm_workflows", up: crmWorkflows.up, down: crmWorkflows.down }\n];\n`,
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
  const orderedFiles = Object.freeze(Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))));
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
