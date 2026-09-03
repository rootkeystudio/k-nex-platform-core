import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ApplicationManifestSchema, PackageReleaseManifestSchema, canonicalJson, type ApplicationManifest, type PackageReleaseManifest } from "@k-nex/contracts";
import { applicationAuthFiles } from "./application-auth-files.js";
import { runnableApplicationFiles } from "./runnable-application-files.js";

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
    readonly releaseManifest: PackageReleaseManifest;
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
  "@k-nex/composition": "1.0.0",
  "@k-nex/contracts": "1.0.0",
  "@k-nex/module-sales": "1.0.0",
  "@k-nex/payload-adapter": "1.0.0",
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
  "sharp": "0.35.3"
});

const verifiedPlanArtifacts = new WeakMap<ApplicationFactoryPlan, ReadonlyMap<string, Uint8Array>>();

function artifactFilename(packageName: string, version: string): string {
  return `${packageName.slice(1).replace("/", "-")}-${version}.tgz`;
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

function registrySource(theme: SalesPresetTheme, applicationId: string, salesIntegrity: string): string {
  const themeExport = theme === "minimal" ? "resolveMinimalThemeProfile" : "resolveNeobrutalismThemeProfile";
  return `import { PluginManifestSchema } from "@k-nex/contracts";
import manifestJson from "@k-nex/module-sales/manifest" with { type: "json" };
import { salesNavigationDescriptors, salesOpportunitiesCollection, salesPermissionDescriptors, salesPermissionPolicyBindings, salesPermissionPolicyExecutors, salesReferenceMetadata, salesRegistration, salesRouteDescriptors, salesTasksCollection } from "@k-nex/module-sales/server";
import { salesMigrationReadiness, salesUpgradeMigrations } from "@k-nex/module-sales/migrations";
import { salesPageTemplates } from "@k-nex/module-sales/contracts";
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
  authorizationGeneration: Object.freeze({ schemaVersion: 1 as const, applicationId: ${JSON.stringify(applicationId)}, owner: { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 }, runtimeGenerationIds: ["sales-generation-1"], state: "current" as const, authorizationRevision: 2, lifecycleRevision: 1 }),
  permissionDescriptors: salesPermissionDescriptors,
  policyBindings: salesPermissionPolicyBindings,
  policyExecutors: salesPermissionPolicyExecutors,
  navigationSection: Object.freeze({ id: "sales.navigation.root", pluginId: "module.sales", label: "Sales", icon: "sales" as const, order: 100, active: true, acceptsCustomerChildren: true, routes: salesRouteDescriptors, navigation: salesNavigationDescriptors, messages: salesReferenceMetadata.localization.messages }),
  collections: Object.freeze([salesTasksCollection, salesOpportunitiesCollection]),
  migrations: salesUpgradeMigrations,
  readiness: salesMigrationReadiness,
  defaultPages: salesPageTemplates
});

const initialThemeTime = new Date(0).toISOString();
export const kNexThemePresentation = ${themeExport}({
  schemaVersion: 1,
  id: "workspace.default-theme",
  surface: "public",
  themeId: "theme.${theme}",
  themeVersion: "1.0.0",
  palette: "light",
  mode: "system",
  values: {},
  revision: { id: "workspace.theme.initial", number: 1, state: "published", createdAt: initialThemeTime, publishedAt: initialThemeTime }
});
`;
}

function payloadConfigSource(applicationId: string): string {
  return `import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";

import { kNexSalesRegistry } from "./k-nex-registry.js";
import { payloadSecret } from "./k-nex-identity.js";
import { usersCollection } from "./k-nex-users.js";
import { migrations } from "./migrations/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

export default buildConfig({
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, prodMigrations: migrations, push: false }),
  collections: [usersCollection, ...kNexSalesRegistry.collections],
  custom: { kNexApplicationId: "${applicationId}" },
  secret: payloadSecret
});
`;
}

function bootSource(): string {
  return `import { getPayload } from "payload";

import config from "./payload.config.js";

export async function bootKnexApplication(key = "k-nex-application") {
  const payload = await getPayload({ config, key: "k-nex-application" });
  const collections = Object.keys(payload.collections).sort();
  if (!collections.includes("sales-opportunities") || !collections.includes("sales-tasks") || !collections.includes("users")) {
    throw new Error("K-Nex application collections did not register.");
  }
  return payload;
}
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
    runtime: { node: "24.19.0", packageManager: "pnpm", packageManagerVersion: "11.9.0", deploymentMode: "container" },
    framework: { payload: { database: { adapter: "postgres", package: "@payloadcms/db-postgres", connectionEnvironmentVariable: "DATABASE_URL" } } },
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: packageVersions.get("@k-nex/module-sales") ?? "1.0.0", enabled: true }],
    providers: {},
    themes: { active: options.theme, package: `@k-nex/theme-${options.theme}`, version: packageVersions.get(`@k-nex/theme-${options.theme}`) ?? "1.0.0" },
    development: { database: options.database === "docker-postgres" ? { mode: "docker-postgres", serviceName: "postgres" } : { mode: "external" } },
    build: { dockerfile: false, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true },
    environment: { required: ["DATABASE_URL", "K_NEX_ENVIRONMENT", "K_NEX_PUBLIC_ORIGIN", "PAYLOAD_SECRET"] }
  });
}

export function planCreateKnexApplication(options: CreateKnexApplicationOptions): ApplicationFactoryPlan {
  validOptions(options);
  const release = options.packageSource === undefined ? undefined : PackageReleaseManifestSchema.parse(options.packageSource.releaseManifest);
  const releasedPackages = new Map(release?.packages.map((entry) => [entry.package, entry.version]) ?? []);
  const dependencyVersions = { ...exactDependencies, [`@k-nex/theme-${options.theme}`]: "1.0.0" };
  const artifacts = new Map<string, Uint8Array>();
  const artifactDigests: Record<string, string> = {};
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
    ".env.example": "DATABASE_URL=\nK_NEX_ENVIRONMENT=\nK_NEX_OWNER_EMAIL=\nK_NEX_OWNER_PASSWORD=\nK_NEX_PUBLIC_ORIGIN=\nPAYLOAD_SECRET=\n",
    ".k-nex/application-plan.json": json({
      planVersion: 1,
      preset: "sales-reference",
      composition: { plugins: [`module.sales@${manifest.plugins[0]!.version}`], theme: `${options.theme}@${manifest.themes.version}`, databaseAdapter: "postgres" },
      packageSource: release === undefined ? { kind: "workspace" } : {
        kind: "packed-mirror", release: release.release.version,
        manifestDigest: `sha256:${createHash("sha256").update(canonicalJson(release)).digest("hex")}`
      },
      migration: { owner: "customer", action: "review-and-apply", expectedPredecessorRevision: 0 },
      readiness: ["exact-package-inventory", "migration-revision", "sales-registration", "default-pages"],
      defaultPages: ["sales.page.tasks", "sales.page.opportunities"],
      lifecyclePlans: ["add", "disable", "enable", "upgrade"]
    }),
    ".k-nex/default-pages.json": json({ schemaVersion: 1, instances: [
      { templateId: "sales.page.tasks", ownership: "customer", instantiate: "if-missing" },
      { templateId: "sales.page.opportunities", ownership: "customer", instantiate: "if-missing" }
    ] }),
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
        "knex:issue-bootstrap-token": "node dist/k-nex-issue-bootstrap-token.js",
        "knex:migrate": "payload migrate",
        "knex:readiness": "node dist/k-nex-readiness.js",
        start: "next start",
        test: "node --test dist/tests/*.test.js",
        "knex:worker": "node dist/k-nex-worker.js"
      },
      dependencies,
      devDependencies: { "@types/node": "24.13.3", "@types/react": "19.2.18", "@types/react-dom": "19.2.4", typescript: "6.0.3" }
    }),
    "src/boot.ts": bootSource(),
    "src/k-nex-registry.ts": registrySource(options.theme, options.applicationId, release?.packages.find(({ package: packageName }) => packageName === "@k-nex/module-sales")?.integrity ?? "sha512-d29ya3NwYWNl"),
    "src/migrations/20260827_000001_sales_baseline.ts": payloadBaselineMigrationSource(),
    "src/migrations/20260827_000002_knex_bootstrap.ts": bootstrapMigrationSource(options.applicationId, release?.release.version ?? "1.0.0"),
    "src/migrations/20260903_000003_knex_authorization.ts": `import { kNexAuthorizationSchemaMigration } from "@k-nex/payload-adapter";\n\nexport const up = kNexAuthorizationSchemaMigration.up;\nexport const down = kNexAuthorizationSchemaMigration.down;\n`,
    "src/migrations/index.ts": `import * as baseline from "./20260827_000001_sales_baseline.js";\nimport * as bootstrap from "./20260827_000002_knex_bootstrap.js";\nimport * as authorization from "./20260903_000003_knex_authorization.js";\n\nexport const migrations = [\n  { name: "20260827_000001_sales_baseline", up: baseline.up, down: baseline.down },\n  { name: "20260827_000002_knex_bootstrap", up: bootstrap.up, down: bootstrap.down },\n  { name: "20260903_000003_knex_authorization", up: authorization.up, down: authorization.down }\n];\n`,
    "src/payload.config.ts": payloadConfigSource(options.applicationId),
  };
  if (release !== undefined && options.packageSource !== undefined) {
    const overrides = Object.fromEntries([...release.packages].sort((left, right) => left.package.localeCompare(right.package)).map((entry) => [entry.package,
      `file:.k-nex/packages/${artifactFilename(entry.package, entry.version)}`]));
    files[".npmrc"] = "link-workspace-packages=false\nshared-workspace-lockfile=false\n";
    files["pnpm-workspace.yaml"] = `packages:\n  - "."\n\nallowBuilds:\n  "cpu-features@0.0.10": false\n  "esbuild@0.18.20": true\n  "esbuild@0.25.12": true\n  "esbuild@0.28.2": true\n  "protobufjs@7.6.5": false\n  "sharp@0.35.3": true\n  "ssh2@1.17.0": false\n\noverrides:\n${Object.entries(overrides).map(([name, specifier]) => `  "${name}": "${specifier}"`).join("\n")}\n`;
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
    installCommands: Object.freeze([Object.freeze(["pnpm", "install", "--lockfile-only"]), Object.freeze(["pnpm", "install", "--frozen-lockfile"])])
  });
  verifiedPlanArtifacts.set(plan, new Map([...artifacts].map(([name, bytes]) => [name, new Uint8Array(bytes)])));
  return plan;
}

export function applyCreateKnexApplication(plan: ApplicationFactoryPlan, targetDirectory: string): ApplicationFactoryApplyResult {
  const artifacts = verifiedPlanArtifacts.get(plan);
  if (artifacts === undefined || !/^sha256:[0-9a-f]{64}$/u.test(plan.digest) ||
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
