import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { createNormalizedTarGz } from "@k-nex/extension-bundler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admitGeneratedReleaseExecutable, assertGeneratedExecutableBootstrap, assertGeneratedExecutableClosure,
  computeGeneratedMigrationClosure, sanitizedExecutableEnvironment, type MigrationFenceError
} from "../src/index.js";

const migrations = [
  "20260827_000001_sales_baseline",
  "20260827_000002_knex_bootstrap",
  "20260905_000026_release_preflight",
  "20260909_000036_release_revision"
];

const releasedPackages = Object.freeze([
  { package: "@k-nex/runtime", role: "core" },
  { package: "@k-nex/payload-adapter", role: "core" },
  { package: "@k-nex/theme-minimal", role: "theme" },
  { package: "@k-nex/theme-neobrutalism", role: "theme" }
]);

const roots: string[] = [];

type Files = Readonly<Record<string, string>>;

function releasedFiles(name: string): Files {
  return { "package.json": `{"name":"${name}","version":"1.1.0"}\n`, "dist/index.js": `export const released = ${JSON.stringify(name)};\n` };
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function install(root: string, into: string, files: Files): void {
  for (const [path, content] of Object.entries(files)) write(root, join(into, path), content);
}

/** The pnpm shape an importer actually walks: one real store directory, linked where it is imported from. */
function storePath(name: string): string {
  return `node_modules/.pnpm/${name.replace("/", "+")}@1.1.0/node_modules/${name}`;
}

function link(root: string, from: string, target: string): void {
  const path = join(root, from);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(join(root, target), path, "dir");
}

/** The directory @k-nex/runtime's own imports resolve through in a pnpm installation. */
const runtimeModules = "node_modules/.pnpm/@k-nex+runtime@1.1.0/node_modules";

/**
 * A released package as an application carries it: a packed archive the
 * manifest names by integrity, and the installed files an importer would load.
 */
function releasedArchive(files: Files) {
  const archive = createNormalizedTarGz(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path: `package/${path}`, bytes: Buffer.from(content) })));
  return { archive, integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}` };
}

interface ApplicationOptions {
  readonly adapterFiles?: Files;
  readonly linked?: boolean;
  readonly nested?: Files | "store";
  readonly absent?: readonly string[];
  readonly launcher?: string;
  readonly migrateScript?: string | null;
  readonly shim?: string;
  readonly payloadFiles?: Files;
  readonly loaderFiles?: Files;
  readonly databaseAdapterFiles?: Files;
  readonly patch?: string | null;
}

function generatedApplication(options: ApplicationOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "k-nex-executable-"));
  roots.push(root);
  mkdirSync(join(root, "src/migrations"), { recursive: true });
  mkdirSync(join(root, ".k-nex/packages"), { recursive: true });
  for (const name of migrations) write(root, join("src/migrations", `${name}.ts`), `export async function up(): Promise<void> {}\n// ${name}\n`);
  write(root, "src/migrations/index.ts", "export const migrations = [];\n");

  const absent = new Set(options.absent ?? ["@k-nex/theme-neobrutalism"]);
  const declared = releasedPackages.map((entry) => {
    const files = releasedFiles(entry.package);
    const packed = releasedArchive(files);
    writeFileSync(join(root, ".k-nex/packages", `${entry.package.replace("@", "").replace("/", "-")}-1.1.0.tgz`), packed.archive);
    return { ...entry, version: "1.1.0", integrity: packed.integrity, files };
  });
  for (const entry of declared) {
    if (absent.has(entry.package)) continue;
    const installed = entry.package === "@k-nex/payload-adapter" ? options.adapterFiles ?? entry.files : entry.files;
    install(root, storePath(entry.package), installed);
    if (entry.package !== "@k-nex/payload-adapter" || options.linked !== false) link(root, join("node_modules", entry.package), storePath(entry.package));
  }
  // What @k-nex/runtime's own resolution reaches, which a top-level link says
  // nothing about: normally the same store directory, and in the drift cases a
  // real directory of its own.
  if (!absent.has("@k-nex/payload-adapter")) {
    const nested = options.nested ?? "store";
    if (nested === "store") link(root, join(runtimeModules, "@k-nex/payload-adapter"), storePath("@k-nex/payload-adapter"));
    else install(root, join(runtimeModules, "@k-nex/payload-adapter"), nested);
  }

  install(root, "node_modules/payload", options.payloadFiles ?? { "package.json": '{"name":"payload","version":"3.88.0"}\n', "bin.js": "await (await import('tsx/esm/api')).tsImport('./dist/bin/index.js');\n" });
  install(root, "node_modules/tsx", options.loaderFiles ?? { "package.json": '{"name":"tsx","version":"4.22.4"}\n', "esm/api.js": "export const tsImport = () => undefined;\n" });
  install(root, "node_modules/@payloadcms/db-postgres", options.databaseAdapterFiles ?? { "package.json": '{"name":"@payloadcms/db-postgres","version":"3.88.0"}\n', "connect.js": "result.release();\n" });
  write(root, "node_modules/.bin/payload", options.shim ?? '#!/bin/sh\nexec node "$basedir/../payload/bin.js" "$@"\n');
  if (options.patch !== null) write(root, "patches/@payloadcms__db-postgres@3.88.0.patch", options.patch ?? "--- a/connect.js\n+++ b/connect.js\n");

  write(root, "k-nex-migrate.mjs", options.launcher ?? "import { assertGeneratedExecutableClosure } from \"@k-nex/runtime\";\n");
  const migrateScript = options.migrateScript === undefined ? "node --env-file-if-exists=.env k-nex-migrate.mjs" : options.migrateScript;
  write(root, "package.json", `${JSON.stringify({
    name: "generated", private: true, type: "module",
    scripts: migrateScript === null ? { build: "next build" } : { build: "next build", "knex:migrate": migrateScript }
  }, null, 2)}\n`);
  write(root, "pnpm-workspace.yaml", "packages:\n  - \".\"\n\npatchedDependencies:\n  \"@payloadcms/db-postgres@3.88.0\": \"patches/@payloadcms__db-postgres@3.88.0.patch\"\n");

  const lock = "lockfileVersion: '9.0'\n";
  write(root, "pnpm-lock.yaml", lock);
  const manifest = `${JSON.stringify({
    release: { version: "1.1.0" },
    packages: declared.map((entry) => ({ package: entry.package, version: entry.version, role: entry.role, integrity: entry.integrity })),
    factoryLockTemplates: { minimal: { digest: `sha256:${createHash("sha256").update(lock).digest("hex")}`, preset: "sales-reference", theme: "minimal" } }
  }, null, 2)}\n`;
  write(root, ".k-nex/package-release-manifest.json", manifest);
  const closure = computeGeneratedMigrationClosure(root, migrations);
  write(root, ".k-nex/migration-closure.json", `${JSON.stringify({ applicationId: "customer-alpha", release: "1.1.0", theme: "minimal", migrations, ...closure }, null, 2)}\n`);
  return { root, manifest, lock };
}

const admit = (root: string, theme = "minimal") => assertGeneratedExecutableClosure({ root, theme });

const denial = (act: () => unknown): MigrationFenceError => {
  try {
    act();
  } catch (error) {
    return error as MigrationFenceError;
  }
  throw new Error("The executable closure guard admitted a drifted installation.");
};

// The worker running this suite is itself started with --require, which is what
// the guard refuses; the refusal is proved from explicit arguments in its own
// case rather than from whatever the test runner happened to inject here.
const workerExecArgv = process.execArgv;

beforeEach(() => {
  process.execArgv = [];
});

afterEach(() => {
  process.execArgv = workerExecArgv;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("generated executable closure", () => {
  it("admits an installation whose packages are the bytes its release declares", () => {
    const application = generatedApplication();
    const closure = admit(application.root);
    expect(closure.release).toEqual("1.1.0");
    expect(closure.packages).toEqual(["@k-nex/payload-adapter@1.1.0", "@k-nex/runtime@1.1.0", "@k-nex/theme-minimal@1.1.0", "@k-nex/theme-neobrutalism@1.1.0"]);
    expect(closure.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(closure.recorded).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(closure.migration.migrations).toEqual(migrations);
    // The same installation answers the same closure, so the receipt it writes
    // is checkable by a later boot rather than by a fresh guess.
    expect(admit(application.root).digest).toEqual(closure.digest);
  });

  it("refuses an installed package implementation that drifted from its released archive", () => {
    const drifted = generatedApplication({
      adapterFiles: { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n', "dist/index.js": "export const released = 2;\n" }
    });
    expect(denial(() => admit(drifted.root)).message)
      .toContain("does not carry the dist/index.js its released archive declares");

    const missing = generatedApplication({ adapterFiles: { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n' } });
    expect(denial(() => admit(missing.root)).message).toContain("is installed without dist/index.js");
  });

  it("measures the package the importer resolves, not the copy the application links", () => {
    // Reachable only through @k-nex/runtime's own links, which is how a package
    // a released dependency imports is installed and how it has to be proved.
    const stored = generatedApplication({ linked: false });
    expect(admit(stored.root).packages).toContain("@k-nex/payload-adapter@1.1.0");

    const drifted = { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n', "dist/index.js": "export const released = 3;\n" };

    // A clean top-level copy beside a drifted copy under @k-nex/runtime is the
    // case a root-only proof admits and the migration then executes.
    const split = generatedApplication({ nested: drifted });
    expect(denial(() => admit(split.root)).message).toContain("is installed more than once");

    // The same drifted copy as the only one an importer can reach is measured
    // where it would load, not where the application happens to link.
    const resolved = generatedApplication({ linked: false, nested: drifted });
    expect(denial(() => admit(resolved.root)).message).toContain("does not carry the dist/index.js its released archive declares");
  });

  it("refuses a packed archive, lock, or manifest that is not the one this release was closed over", () => {
    const repacked = generatedApplication();
    writeFileSync(join(repacked.root, ".k-nex/packages/k-nex-payload-adapter-1.1.0.tgz"), Buffer.from("not an archive"));
    expect(denial(() => admit(repacked.root)).message).toContain("is not the release the manifest declares");

    const relocked = generatedApplication();
    writeFileSync(join(relocked.root, "pnpm-lock.yaml"), `${relocked.lock}# resolved elsewhere\n`);
    expect(denial(() => admit(relocked.root)).message).toContain("package lock is not the one this release was closed over");

    const rewritten = generatedApplication();
    writeFileSync(join(rewritten.root, ".k-nex/package-release-manifest.json"), `${rewritten.manifest} `);
    expect(denial(() => admit(rewritten.root)).code).toEqual("MIGRATION_SET_MISMATCH");

    const unthemed = generatedApplication();
    expect(denial(() => admit(unthemed.root, "neobrutalism")).message).toContain("declares no neobrutalism factory lock");
  });

  it("carries the migration closure refusal, because a drifted migration is not a different package", () => {
    const application = generatedApplication();
    writeFileSync(join(application.root, "src/migrations/20260905_000026_release_preflight.ts"), "export async function up(): Promise<void> { /* substituted */ }\n");
    expect(denial(() => admit(application.root)).message).toContain("migration closure on disk digests to");
  });

  it("records absence only for the theme class this application did not select", () => {
    // The unselected theme is the one package a release carries and an
    // application is not expected to install.
    expect(admit(generatedApplication({ absent: ["@k-nex/theme-neobrutalism"] }).root).release).toEqual("1.1.0");

    const unthemed = generatedApplication({ absent: ["@k-nex/theme-minimal", "@k-nex/theme-neobrutalism"] });
    expect(denial(() => admit(unthemed.root)).message)
      .toContain("@k-nex/theme-minimal is declared by this release and is not installed");

    const unpackaged = generatedApplication({ absent: ["@k-nex/payload-adapter", "@k-nex/theme-neobrutalism"] });
    expect(denial(() => admit(unpackaged.root)).message)
      .toContain("@k-nex/payload-adapter is declared by this release and is not installed");
  });

  it("measures the launcher and the command that starts it", () => {
    const baseline = admit(generatedApplication().root).digest;
    expect(admit(generatedApplication({ launcher: "process.exit(0);\n" }).root).digest).not.toEqual(baseline);
    expect(admit(generatedApplication({ migrateScript: "node node_modules/.bin/payload migrate" }).root).digest).not.toEqual(baseline);

    const unlaunched = generatedApplication();
    rmSync(join(unlaunched.root, "k-nex-migrate.mjs"));
    expect(denial(() => admit(unlaunched.root)).message).toContain("k-nex-migrate.mjs launcher is missing");

    const uncommanded = generatedApplication({ migrateScript: null });
    expect(denial(() => admit(uncommanded.root)).message).toContain("declares no knex:migrate command");
  });

  it("records the third-party executable the launcher spawns, and refuses it when it is absent", () => {
    const baseline = admit(generatedApplication().root);
    const drifted = [
      { name: "shim", application: generatedApplication({ shim: '#!/bin/sh\nexec node ./substituted.js "$@"\n' }) },
      { name: "payload", application: generatedApplication({ payloadFiles: { "package.json": '{"name":"payload","version":"3.88.0"}\n', "bin.js": "await import('./substituted.js');\n" } }) },
      { name: "loader", application: generatedApplication({ loaderFiles: { "package.json": '{"name":"tsx","version":"4.22.4"}\n', "esm/api.js": "export const tsImport = () => globalThis.substituted;\n" } }) },
      { name: "adapter", application: generatedApplication({ databaseAdapterFiles: { "package.json": '{"name":"@payloadcms/db-postgres","version":"3.88.0"}\n', "connect.js": "// repair removed\n" } }) },
      { name: "patch", application: generatedApplication({ patch: "--- a/connect.js\n+++ b/connect.js\n@@ substituted\n" }) }
    ];
    for (const { name, application } of drifted) {
      const closure = admit(application.root);
      expect(closure.recorded, `A drifted ${name} must change the recorded executable.`).not.toEqual(baseline.recorded);
      expect(closure.digest).not.toEqual(baseline.digest);
    }

    const unshimmed = generatedApplication();
    rmSync(join(unshimmed.root, "node_modules/.bin/payload"));
    expect(denial(() => admit(unshimmed.root)).message).toContain("Payload launcher shim it would spawn is not installed");

    const unpayloaded = generatedApplication();
    rmSync(join(unpayloaded.root, "node_modules/payload"), { recursive: true });
    expect(denial(() => admit(unpayloaded.root)).message).toContain("payload package its launcher shim executes is not installed");
  });

  it("re-proves the closure inside the migration process before the step's first statement", async () => {
    const statements: string[] = [];
    const step = (root: string) => admitGeneratedReleaseExecutable({
      applicationId: "generated-app", release: "1.1.0", step: migrations[0]!, theme: "minimal", root,
      execute: async (statement) => { statements.push(statement); }
    });

    const drifted = generatedApplication({
      adapterFiles: { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n', "dist/index.js": "export const released = 4;\n" }
    });
    await expect(step(drifted.root)).rejects.toThrow(/does not carry the dist\/index\.js its released archive declares/u);
    expect(statements, "A refused step must not have reached the database at all.").toEqual([]);

    await step(generatedApplication().root);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(migrations[0]);
  });

  it("refuses to measure anything from a process that was handed bootstrap authority", () => {
    expect(denial(() => assertGeneratedExecutableBootstrap({ NODE_OPTIONS: "--require ./inject.cjs" })).message)
      .toContain("NODE_OPTIONS is set, and it runs code before this proof does");
    expect(denial(() => assertGeneratedExecutableBootstrap({ NODE_LOADER: "./inject.mjs" })).message).toContain("NODE_LOADER is set");
    expect(denial(() => assertGeneratedExecutableBootstrap({}, ["--import=./inject.mjs"])).message)
      .toContain("it was started with --import=./inject.mjs");
    expect(denial(() => assertGeneratedExecutableBootstrap({}, ["-r", "./inject.cjs"])).message).toContain("it was started with -r");
    // The generated command's own flag loads configuration, not code.
    expect(assertGeneratedExecutableBootstrap({ NODE_OPTIONS: "" }, ["--env-file-if-exists=.env"])).toBeUndefined();

    const sanitized = sanitizedExecutableEnvironment({ NODE_OPTIONS: "--require ./inject.cjs", NODE_LOADER: "./inject.mjs", DATABASE_URL: "postgres://k-nex" });
    expect(sanitized).toEqual({ DATABASE_URL: "postgres://k-nex" });

    const application = generatedApplication();
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--import=./inject.mjs";
    try {
      expect(denial(() => admit(application.root)).message).toContain("NODE_OPTIONS is set");
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    }
  });
});
