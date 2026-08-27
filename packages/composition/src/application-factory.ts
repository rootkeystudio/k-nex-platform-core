import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
      scripts: { build: "next build", dev: "next dev", migrate: "payload migrate", start: "next start" },
      dependencies
    }),
    "src/payload.config.ts": `import { postgresAdapter } from "@payloadcms/db-postgres";\nimport { buildConfig } from "payload";\n\nconst databaseUrl = process.env.DATABASE_URL;\nconst secret = process.env.PAYLOAD_SECRET;\nif (!databaseUrl || !secret) throw new Error("DATABASE_URL and PAYLOAD_SECRET are required.");\n\nexport default buildConfig({ db: postgresAdapter({ pool: { connectionString: databaseUrl } }), secret });\n`
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
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const [relativePath, content] of Object.entries(plan.files)) {
    if (relativePath.startsWith("/") || relativePath.split("/").some((segment) => segment === ".." || segment === "")) throw new Error("Application factory path is invalid.");
    const path = resolve(target, relativePath);
    let existing: string | undefined;
    try { existing = readFileSync(path, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing === content) { unchanged.push(relativePath); continue; }
    if (existing !== undefined) throw new Error(`Application factory refuses to overwrite ${relativePath}.`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    written.push(relativePath);
  }
  return Object.freeze({ written: Object.freeze(written), unchanged: Object.freeze(unchanged) });
}
