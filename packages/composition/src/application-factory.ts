import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { ApplicationManifestSchema, canonicalJson, type ApplicationManifest } from "@k-nex/contracts";

export type SalesPresetTheme = "minimal" | "neobrutalism";
export type ApplicationDatabaseMode = "docker-postgres" | "external";

export interface CreateKnexApplicationOptions {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly theme: SalesPresetTheme;
  readonly database: ApplicationDatabaseMode;
}

export interface ApplicationFactoryPlan {
  readonly planVersion: 1;
  readonly preset: "sales-reference";
  readonly applicationId: string;
  readonly digest: string;
  readonly files: Readonly<Record<string, string>>;
  readonly installCommands: readonly (readonly string[])[];
}

export interface ApplicationFactoryApplyResult {
  readonly written: readonly string[];
  readonly unchanged: readonly string[];
}

const exactDependencies = Object.freeze({
  "@k-nex/composition": "0.0.0",
  "@k-nex/contracts": "0.0.0",
  "@k-nex/module-sales": "1.0.0",
  "@k-nex/payload-adapter": "0.0.0",
  "@k-nex/runtime": "0.0.0",
  "@payloadcms/db-postgres": "3.88.0",
  "@payloadcms/next": "3.88.0",
  "graphql": "16.14.2",
  "next": "16.3.1",
  "payload": "3.88.0",
  "react": "19.2.8",
  "react-dom": "19.2.8"
});

function registrySource(): string {
  return `import { salesOpportunitiesCollection, salesRegistration, salesTasksCollection } from "@k-nex/module-sales/server";
import { salesMigrationReadiness, salesUpgradeMigrations } from "@k-nex/module-sales/migrations";
import { salesPageTemplates } from "@k-nex/module-sales/contracts";

export const kNexSalesRegistry = Object.freeze({
  registration: salesRegistration,
  collections: Object.freeze([salesTasksCollection, salesOpportunitiesCollection]),
  migrations: salesUpgradeMigrations,
  readiness: salesMigrationReadiness,
  defaultPages: salesPageTemplates
});
`;
}

function payloadConfigSource(): string {
  return `import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";

import { kNexSalesRegistry } from "./k-nex-registry.js";

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.PAYLOAD_SECRET;
if (!databaseUrl || !secret) throw new Error("DATABASE_URL and PAYLOAD_SECRET are required.");

export default buildConfig({
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, prodMigrations: [] }),
  collections: [...kNexSalesRegistry.collections],
  secret
});
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
}

function applicationManifest(options: CreateKnexApplicationOptions): ApplicationManifest {
  return ApplicationManifestSchema.parse({
    schemaVersion: 1,
    application: { id: options.applicationId, name: options.applicationName, type: "customer-platform" },
    runtime: { node: "24.19.0", packageManager: "pnpm", packageManagerVersion: "11.9.0", deploymentMode: "container" },
    framework: { payload: { database: { adapter: "postgres", package: "@payloadcms/db-postgres", connectionEnvironmentVariable: "DATABASE_URL" } } },
    plugins: [{ id: "module.sales", package: "@k-nex/module-sales", version: "1.0.0", enabled: true }],
    providers: {},
    themes: { active: options.theme, package: `@k-nex/theme-${options.theme}`, version: "0.0.0" },
    development: { database: options.database === "docker-postgres" ? { mode: "docker-postgres", serviceName: "postgres" } : { mode: "external" } },
    build: { dockerfile: false, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true },
    environment: { required: ["DATABASE_URL", "PAYLOAD_SECRET"] }
  });
}

export function planCreateKnexApplication(options: CreateKnexApplicationOptions): ApplicationFactoryPlan {
  validOptions(options);
  const manifest = applicationManifest(options);
  const dependencies = { ...exactDependencies, [`@k-nex/theme-${options.theme}`]: "0.0.0" };
  const files: Record<string, string> = {
    ".env.example": "DATABASE_URL=postgres://knex:knex@127.0.0.1:5432/knex\nPAYLOAD_SECRET=replace-with-a-long-random-secret\n",
    ".k-nex/application-plan.json": json({
      planVersion: 1,
      preset: "sales-reference",
      composition: { plugins: ["module.sales@1.0.0"], theme: `${options.theme}@0.0.0`, databaseAdapter: "postgres" },
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
      name: options.applicationId, version: "0.0.0", private: true, type: "module", packageManager: "pnpm@11.9.0",
      engines: { node: "24.19.0", pnpm: "11.9.0" },
      scripts: { build: "next build", dev: "next dev", migrate: "payload migrate", readiness: "node --import tsx src/k-nex-readiness.ts", start: "next start" },
      dependencies
    }),
    "src/k-nex-registry.ts": registrySource(),
    "src/k-nex-readiness.ts": `import { kNexSalesRegistry } from "./k-nex-registry.js";\n\nif (kNexSalesRegistry.collections.length !== 2 || kNexSalesRegistry.registration.pluginId !== "module.sales" || kNexSalesRegistry.readiness.currentRevision < 1 || kNexSalesRegistry.defaultPages.length === 0) {\n  throw new Error("K-Nex Sales readiness is incomplete.");\n}\nconsole.log("K_NEX_SALES_READY");\n`,
    "src/payload.config.ts": payloadConfigSource()
  };
  if (options.database === "docker-postgres") {
    files["compose.yaml"] = "services:\n  postgres:\n    image: postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94\n    environment:\n      POSTGRES_DB: knex\n      POSTGRES_PASSWORD: knex\n      POSTGRES_USER: knex\n    ports:\n      - \"5432:5432\"\n    volumes:\n      - postgres-data:/var/lib/postgresql/data\nvolumes:\n  postgres-data:\n";
  }
  const orderedFiles = Object.freeze(Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))));
  const digest = `sha256:${createHash("sha256").update(canonicalJson(orderedFiles)).digest("hex")}`;
  return Object.freeze({
    planVersion: 1,
    preset: "sales-reference",
    applicationId: options.applicationId,
    digest,
    files: orderedFiles,
    installCommands: Object.freeze([Object.freeze(["pnpm", "install", "--lockfile-only"]), Object.freeze(["pnpm", "install", "--frozen-lockfile"])])
  });
}

export function applyCreateKnexApplication(plan: ApplicationFactoryPlan, targetDirectory: string): ApplicationFactoryApplyResult {
  if (!/^sha256:[0-9a-f]{64}$/u.test(plan.digest) || plan.digest !== `sha256:${createHash("sha256").update(canonicalJson(plan.files)).digest("hex")}`) {
    throw new Error("Application factory plan digest is invalid.");
  }
  const target = resolve(targetDirectory);
  const paths = Object.entries(plan.files);
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
    for (const [relativePath, content] of paths) {
      if (readFileSync(resolve(stage, relativePath), "utf8") !== content) throw new Error("Application factory staged validation failed.");
    }
    renameSync(stage, target);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ written: Object.freeze(paths.map(([relativePath]) => relativePath)), unchanged: Object.freeze([]) });
}
