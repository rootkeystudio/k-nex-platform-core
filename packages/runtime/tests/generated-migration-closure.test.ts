import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertGeneratedMigrationClosure, computeGeneratedMigrationClosure, generatedReleaseStepStatement,
  readGeneratedMigrationClosure, type MigrationFenceError
} from "../src/index.js";

const migrations = [
  "20260827_000001_sales_baseline",
  "20260827_000002_knex_bootstrap",
  "20260905_000026_release_preflight",
  "20260905_000027_crm_core",
  "20260909_000036_release_revision"
];

const registrySource = `import { admitGeneratedReleaseStep } from "@k-nex/runtime";
import * as crmCore from "./20260905_000027_crm_core.js";

export const migrations = [
  { name: "20260905_000027_crm_core", up: admitted("20260905_000027_crm_core", crmCore.up), down: crmCore.down }
];
`;

const roots: string[] = [];

function generatedApplication(options: { manifest?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "k-nex-closure-"));
  roots.push(root);
  mkdirSync(join(root, "src/migrations"), { recursive: true });
  mkdirSync(join(root, ".k-nex"), { recursive: true });
  for (const name of migrations) writeFileSync(join(root, "src/migrations", `${name}.ts`), `export async function up(): Promise<void> {}\n// ${name}\n`);
  writeFileSync(join(root, "src/migrations/index.ts"), registrySource);
  if (options.manifest !== undefined) writeFileSync(join(root, ".k-nex/package-release-manifest.json"), options.manifest);
  const declared = computeGeneratedMigrationClosure(root, migrations);
  writeFileSync(join(root, ".k-nex/migration-closure.json"), `${JSON.stringify({ migrations, ...declared }, null, 2)}\n`);
  return { root, declared };
}

const denial = async (act: () => unknown): Promise<MigrationFenceError> => {
  try {
    act();
  } catch (error) {
    return error as MigrationFenceError;
  }
  throw new Error("The migration closure guard admitted a tampered application.");
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("generated migration closure", () => {
  it("admits the application it was generated for and names its release manifest", () => {
    const untouched = generatedApplication({ manifest: '{"release":{"version":"1.1.0"}}\n' });
    const closure = assertGeneratedMigrationClosure(untouched.root);
    expect(closure.digest).toEqual(untouched.declared.digest);
    expect(closure.releaseManifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(closure.migrations).toEqual(migrations);
    expect(readGeneratedMigrationClosure(untouched.root).digest).toEqual(closure.digest);
  });

  it("refuses a registry that re-points, unwraps, or widens what executes under a declared name", async () => {
    const remapped = generatedApplication();
    writeFileSync(join(remapped.root, "src/migrations/index.ts"),
      registrySource.replace('admitted("20260905_000027_crm_core", crmCore.up)', "crmCore.up"));
    expect((await denial(() => assertGeneratedMigrationClosure(remapped.root))).code).toEqual("MIGRATION_SET_MISMATCH");

    const unadmitted = generatedApplication();
    writeFileSync(join(unadmitted.root, "src/migrations/index.ts"), registrySource.replace("admitted(", "unguarded("));
    await denial(() => assertGeneratedMigrationClosure(unadmitted.root));

    const imported = generatedApplication();
    writeFileSync(join(imported.root, "src/migrations/index.ts"), `import * as elsewhere from "../../elsewhere.js";\n${registrySource}`);
    await denial(() => assertGeneratedMigrationClosure(imported.root));
  });

  it("refuses a migration changed under its own name, and an added or removed implementation", async () => {
    const substituted = generatedApplication();
    writeFileSync(join(substituted.root, "src/migrations/20260905_000027_crm_core.ts"), "export async function up(): Promise<void> { /* substituted */ }\n");
    await denial(() => assertGeneratedMigrationClosure(substituted.root));

    const added = generatedApplication();
    writeFileSync(join(added.root, "src/migrations/20260910_000037_extra.ts"), "export async function up(): Promise<void> {}\n");
    expect((await denial(() => assertGeneratedMigrationClosure(added.root))).message).toContain("is not the set it declares");

    const removed = generatedApplication();
    rmSync(join(removed.root, "src/migrations/20260905_000027_crm_core.ts"));
    expect((await denial(() => assertGeneratedMigrationClosure(removed.root))).message).toContain("is not the set it declares");
  });

  it("refuses a different package release closure behind identical migration sources", async () => {
    const republished = generatedApplication({ manifest: '{"release":{"version":"1.1.0"}}\n' });
    writeFileSync(join(republished.root, ".k-nex/package-release-manifest.json"), '{"release":{"version":"1.1.0"} }\n');
    await denial(() => assertGeneratedMigrationClosure(republished.root));

    const dropped = generatedApplication({ manifest: '{"release":{"version":"1.1.0"}}\n' });
    rmSync(join(dropped.root, ".k-nex/package-release-manifest.json"));
    expect((await denial(() => assertGeneratedMigrationClosure(dropped.root))).message).toContain("package release manifest");
  });

  it("re-reads the closure on every call rather than trusting its first success", async () => {
    const application = generatedApplication();
    expect(assertGeneratedMigrationClosure(application.root).digest).toEqual(application.declared.digest);
    // The same process, after a success: a cached verdict here would make every
    // step after the first one assert nothing at all.
    writeFileSync(join(application.root, "src/migrations/20260905_000027_crm_core.ts"), "export async function up(): Promise<void> { /* swapped mid-run */ }\n");
    await denial(() => assertGeneratedMigrationClosure(application.root));
    writeFileSync(join(application.root, "src/migrations/20260905_000027_crm_core.ts"), "export async function up(): Promise<void> {}\n// 20260905_000027_crm_core\n");
    expect(assertGeneratedMigrationClosure(application.root).digest).toEqual(application.declared.digest);
  });

  it("refuses a declared closure that is not a release migration closure", async () => {
    const application = generatedApplication();
    writeFileSync(join(application.root, ".k-nex/migration-closure.json"), JSON.stringify({ migrations, digest: "not-a-digest", releaseManifestDigest: null }));
    await denial(() => readGeneratedMigrationClosure(application.root));

    rmSync(join(application.root, ".k-nex/migration-closure.json"));
    expect((await denial(() => assertGeneratedMigrationClosure(application.root))).message).toContain("does not declare a migration closure");
  });

  it("admits a step only against the exact ledger prefix it was ordered against", () => {
    const statement = generatedReleaseStepStatement({
      applicationId: "customer-alpha", release: "1.1.0", step: "20260905_000027_crm_core", migrations
    });
    expect(statement).toContain("ARRAY['20260827_000001_sales_baseline','20260827_000002_knex_bootstrap','20260905_000026_release_preflight']::text[]");
    expect(statement).toContain("'platform-1.1.0-installing'");
    expect(statement).toContain("'platform-1.1.0-release'");
    expect(statement).toContain("already completed 1.1.0");
    expect(statement).not.toContain("RETURN;");

    const bootstrap = generatedReleaseStepStatement({
      applicationId: "customer-alpha", release: "1.1.0", step: "20260827_000002_knex_bootstrap", migrations
    });
    expect(bootstrap).toContain("RETURN;");
    expect(bootstrap).toContain("a database carrying the predecessor release has already applied this step");
    expect(() => generatedReleaseStepStatement({ applicationId: "customer-alpha", release: "1.1.0", step: "20260910_000037_unknown", migrations }))
      .toThrow(/not a migration this release declares/u);
  });
});
