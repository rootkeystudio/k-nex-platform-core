import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { createNormalizedTarGz } from "@k-nex/extension-bundler";
import { afterEach, describe, expect, it } from "vitest";

import { assertGeneratedExecutableClosure, computeGeneratedMigrationClosure, type MigrationFenceError } from "../src/index.js";

const migrations = [
  "20260827_000001_sales_baseline",
  "20260827_000002_knex_bootstrap",
  "20260905_000026_release_preflight",
  "20260909_000036_release_revision"
];

const roots: string[] = [];

/**
 * A released package as an application carries it: a packed archive the
 * manifest names by integrity, and the installed files an importer would load.
 */
function releasedPackage(name: string, files: Readonly<Record<string, string>>) {
  const archive = createNormalizedTarGz(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path: `package/${path}`, bytes: Buffer.from(content) })));
  return { name, archive, files, integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}` };
}

function generatedApplication(options: { installed?: Readonly<Record<string, string>>; linked?: boolean; duplicate?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "k-nex-executable-"));
  roots.push(root);
  mkdirSync(join(root, "src/migrations"), { recursive: true });
  mkdirSync(join(root, ".k-nex/packages"), { recursive: true });
  for (const name of migrations) writeFileSync(join(root, "src/migrations", `${name}.ts`), `export async function up(): Promise<void> {}\n// ${name}\n`);
  writeFileSync(join(root, "src/migrations/index.ts"), "export const migrations = [];\n");

  const declaredFiles = { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n', "dist/index.js": "export const migration = 1;\n" };
  const released = releasedPackage("@k-nex/payload-adapter", declaredFiles);
  writeFileSync(join(root, ".k-nex/packages/k-nex-payload-adapter-1.1.0.tgz"), released.archive);
  const installedFiles = options.installed ?? declaredFiles;
  const install = (into: string) => {
    mkdirSync(join(into, "dist"), { recursive: true });
    for (const [path, content] of Object.entries(installedFiles)) writeFileSync(join(into, path), content);
  };
  if (options.linked !== false) install(join(root, "node_modules/@k-nex/payload-adapter"));
  if (options.linked === false || options.duplicate === true) {
    install(join(root, "node_modules/.pnpm/@k-nex+payload-adapter@file+one/node_modules/@k-nex/payload-adapter"));
  }
  if (options.duplicate === true) {
    install(join(root, "node_modules/.pnpm/@k-nex+payload-adapter@file+two/node_modules/@k-nex/payload-adapter"));
  }

  const lock = "lockfileVersion: '9.0'\n";
  writeFileSync(join(root, "pnpm-lock.yaml"), lock);
  const manifest = `${JSON.stringify({
    release: { version: "1.1.0" },
    packages: [{ package: "@k-nex/payload-adapter", version: "1.1.0", role: "plugin", integrity: released.integrity }],
    factoryLockTemplates: { minimal: { digest: `sha256:${createHash("sha256").update(lock).digest("hex")}`, preset: "sales-reference", theme: "minimal" } }
  }, null, 2)}\n`;
  writeFileSync(join(root, ".k-nex/package-release-manifest.json"), manifest);
  const declared = computeGeneratedMigrationClosure(root, migrations);
  writeFileSync(join(root, ".k-nex/migration-closure.json"), `${JSON.stringify({ migrations, ...declared }, null, 2)}\n`);
  return { root, manifest, lock };
}

const denial = (act: () => unknown): MigrationFenceError => {
  try {
    act();
  } catch (error) {
    return error as MigrationFenceError;
  }
  throw new Error("The executable closure guard admitted a drifted installation.");
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("generated executable closure", () => {
  it("admits an installation whose packages are the bytes its release declares", () => {
    const application = generatedApplication();
    const closure = assertGeneratedExecutableClosure({ root: application.root, theme: "minimal" });
    expect(closure.release).toEqual("1.1.0");
    expect(closure.packages).toEqual(["@k-nex/payload-adapter@1.1.0"]);
    expect(closure.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(closure.migration.migrations).toEqual(migrations);
    // The same installation answers the same closure, so the receipt it writes
    // is checkable by a later boot rather than by a fresh guess.
    expect(assertGeneratedExecutableClosure({ root: application.root, theme: "minimal" }).digest).toEqual(closure.digest);
  });

  it("refuses an installed package implementation that drifted from its released archive", () => {
    const drifted = generatedApplication({
      installed: { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n', "dist/index.js": "export const migration = 2;\n" }
    });
    expect(denial(() => assertGeneratedExecutableClosure({ root: drifted.root, theme: "minimal" })).message)
      .toContain("does not carry the dist/index.js its released archive declares");

    const missing = generatedApplication({ installed: { "package.json": '{"name":"@k-nex/payload-adapter","version":"1.1.0"}\n' } });
    expect(denial(() => assertGeneratedExecutableClosure({ root: missing.root, theme: "minimal" })).message)
      .toContain("is installed without dist/index.js");
  });

  it("verifies the package a store-resolved importer would load, and refuses two copies of one release", () => {
    const stored = generatedApplication({ linked: false });
    expect(assertGeneratedExecutableClosure({ root: stored.root, theme: "minimal" }).packages).toEqual(["@k-nex/payload-adapter@1.1.0"]);

    const duplicated = generatedApplication({ linked: false, duplicate: true });
    expect(denial(() => assertGeneratedExecutableClosure({ root: duplicated.root, theme: "minimal" })).message)
      .toContain("is installed more than once");
  });

  it("refuses a packed archive, lock, or manifest that is not the one this release was closed over", () => {
    const repacked = generatedApplication();
    writeFileSync(join(repacked.root, ".k-nex/packages/k-nex-payload-adapter-1.1.0.tgz"), Buffer.from("not an archive"));
    expect(denial(() => assertGeneratedExecutableClosure({ root: repacked.root, theme: "minimal" })).message)
      .toContain("is not the release the manifest declares");

    const relocked = generatedApplication();
    writeFileSync(join(relocked.root, "pnpm-lock.yaml"), `${relocked.lock}# resolved elsewhere\n`);
    expect(denial(() => assertGeneratedExecutableClosure({ root: relocked.root, theme: "minimal" })).message)
      .toContain("package lock is not the one this release was closed over");

    const rewritten = generatedApplication();
    writeFileSync(join(rewritten.root, ".k-nex/package-release-manifest.json"), `${rewritten.manifest} `);
    expect(denial(() => assertGeneratedExecutableClosure({ root: rewritten.root, theme: "minimal" })).code).toEqual("MIGRATION_SET_MISMATCH");

    const unthemed = generatedApplication();
    expect(denial(() => assertGeneratedExecutableClosure({ root: unthemed.root, theme: "neobrutalism" })).message)
      .toContain("declares no neobrutalism factory lock");
  });

  it("carries the migration closure refusal, because a drifted migration is not a different package", () => {
    const application = generatedApplication();
    writeFileSync(join(application.root, "src/migrations/20260905_000026_release_preflight.ts"), "export async function up(): Promise<void> { /* substituted */ }\n");
    expect(denial(() => assertGeneratedExecutableClosure({ root: application.root, theme: "minimal" })).message)
      .toContain("migration closure on disk digests to");
  });
});
