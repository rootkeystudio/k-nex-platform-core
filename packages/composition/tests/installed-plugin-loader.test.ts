import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { supportedFrameworkTuple } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import { loadInstalledPlatformPluginManifests, PlatformPluginManifestLoadError } from "../src/installed-plugin-loader.js";

const framework = {
  core: supportedFrameworkTuple.core,
  payload: supportedFrameworkTuple.payload,
  node: supportedFrameworkTuple.node,
  payloadDatabaseAdapter: supportedFrameworkTuple.payloadDatabaseAdapter
};

const compatibility = {
  core: ">=1.0.0 <2.0.0",
  payload: ">=3.0.0 <4.0.0",
  node: ">=24.0.0 <25.0.0",
  payloadDatabaseAdapters: ["postgres"]
};

type Manifest = Record<string, unknown>;
type PackageFixture = {
  name: string;
  id?: string;
  installedVersion?: string;
  requestedVersion?: string;
  packageJsonName?: string;
  packageJsonVersion?: string;
  manifestVersion?: string;
  manifest?: Partial<Manifest>;
  exportManifest?: string | null;
  manifestPath?: string;
  lockDependencySection?: "dependencies" | "devDependencies" | "optionalDependencies";
  lockEntry?: boolean;
  lockSpecifier?: string;
  lockResolvedVersion?: string;
  lockIntegrity?: string | null;
  fileTarball?: boolean;
};
type ApplicationFixture = {
  applicationRoot: string;
  lockfilePath: string;
  markerPath: string;
  packages: Array<{ name: string; version: string }>;
  integrity: Map<string, string>;
};

const integrity = "sha512-ZmFrZS1wbHVnaW4=";

function manifestFor(name: string, id: string, version: string): Manifest {
  const namespace = id.split(".")[1];
  return {
    apiVersion: 1,
    id,
    kind: "module",
    displayName: id,
    version,
    package: name,
    compatibility,
    provides: [{ capability: "sales.tasks", version: "1.0.0" }],
    requires: [{ plugin: "module.sales.core", version: "^1.0.0", reason: "owned records" }],
    optional: [{ capability: "realtime.gateway", version: "^1.0.0", reason: "live updates" }],
    conflicts: [{ plugin: "module.sales.legacy", version: "^1.0.0", reason: "same collection" }],
    surfaces: ["workspace", "public"],
    environment: [{ name: "SALES_SECRET", secret: true, requiredWhen: "enabled", description: "signs links" }],
    lifecycle: { ownsPayloadSchema: true, ownsPersistentData: true, disable: "supported", uninstall: "unsupported", purge: "supported" },
    contributions: {
      permissions: { [`${namespace}.tasks.read`]: "required" },
      schema: { [`${namespace}.task-schema`]: "required" },
      services: { [`${namespace}.task-service`]: "required" },
      jobs: { [`${namespace}.task-reminder`]: "required" },
      sources: { [`${namespace}.tasks`]: "required" },
      actions: { [`${namespace}.task.create`]: "required" },
      blocks: { [`${namespace}.task-list`]: "required" },
      navigation: { [`${namespace}.tasks.navigation`]: "required" },
      routes: { [`${namespace}.tasks.admin`]: "optional" }
    }
  };
}

function yamlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function makeApplication(fixtures: PackageFixture[]): Promise<ApplicationFixture> {
  const applicationRoot = await mkdtemp(join(tmpdir(), "k-nex-plugin-loader-"));
  const lockfilePath = join(applicationRoot, "pnpm-lock.yaml");
  const markerPath = join(applicationRoot, "server-executed");
  const lockLines = ["lockfileVersion: '9.0'", "", "importers:", "  .:"];
  const requestedPackages: Array<{ name: string; version: string }> = [];
  const resolvedIntegrity = new Map<string, string>();

  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const sectionFixtures = fixtures.filter((fixture) => fixture.lockEntry !== false && (fixture.lockDependencySection ?? "dependencies") === section);
    if (sectionFixtures.length === 0) {
      if (section === "dependencies") lockLines.push("    dependencies: {}");
      continue;
    }
    lockLines.push(`    ${section}:`);
    for (const fixture of sectionFixtures) {
      const requestedVersion = fixture.requestedVersion ?? fixture.installedVersion ?? "1.0.0";
      const lockSpecifier = fixture.lockSpecifier ?? (fixture.fileTarball ? `file:packages/${fixture.name.split("/").at(-1)}.tgz` : requestedVersion);
      const lockResolvedVersion = fixture.lockResolvedVersion ?? (fixture.fileTarball ? `file:fixtures/app/packages/${fixture.name.split("/").at(-1)}.tgz` : requestedVersion);
      const lockIntegrity = fixture.lockIntegrity === undefined ? integrity : fixture.lockIntegrity;
      lockLines.push(`      ${yamlQuote(fixture.name)}:`, `        specifier: ${yamlQuote(lockSpecifier)}`, `        version: ${yamlQuote(lockResolvedVersion)}`);
      resolvedIntegrity.set(fixture.name, lockIntegrity ?? "");
    }
  }

  await writeFile(join(applicationRoot, "package.json"), JSON.stringify({ name: "loader-fixture", private: true }, null, 2));

  for (const fixture of fixtures) {
    const installedVersion = fixture.installedVersion ?? "1.0.0";
    const requestedVersion = fixture.requestedVersion ?? installedVersion;
    const packageJsonName = fixture.packageJsonName ?? fixture.name;
    const packageJsonVersion = fixture.packageJsonVersion ?? installedVersion;
    const manifest = { ...manifestFor(fixture.name, fixture.id ?? `module.${fixture.name.split("/").at(-1)}`, fixture.manifestVersion ?? installedVersion), ...fixture.manifest };
    const packageDir = join(applicationRoot, "node_modules", ...fixture.name.split("/"));
    const manifestPath = fixture.manifestPath ?? "k-nex.plugin.json";
    const manifestFile = join(packageDir, manifestPath);
    const exportManifest = fixture.exportManifest === undefined ? "./k-nex.plugin.json" : fixture.exportManifest;
    const packageJson = {
      name: packageJsonName,
      version: packageJsonVersion,
      type: "module",
      main: "./server.js",
      exports: {
        ...(exportManifest === null ? {} : { "./manifest": exportManifest }),
        "./server": "./server.js"
      }
    };

    requestedPackages.push({ name: fixture.name, version: requestedVersion });
    await mkdir(dirname(manifestFile), { recursive: true });
    await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJson, null, 2));
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await writeFile(join(packageDir, "server.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(markerPath)}, "executed");`);
  }

  const packageFixtures = fixtures.filter(({ lockEntry }) => lockEntry !== false);
  lockLines.push("", packageFixtures.length === 0 ? "packages: {}" : "packages:");
  for (const fixture of packageFixtures) {
    const installedVersion = fixture.installedVersion ?? "1.0.0";
    const requestedVersion = fixture.requestedVersion ?? installedVersion;
    const lockResolvedVersion = fixture.lockResolvedVersion ?? (fixture.fileTarball ? `file:fixtures/app/packages/${fixture.name.split("/").at(-1)}.tgz` : requestedVersion);
    const lockIntegrity = fixture.lockIntegrity === undefined ? integrity : fixture.lockIntegrity;
    const packageVersion = fixture.fileTarball ? lockResolvedVersion.replace(/\(.*\)$/, "") : lockResolvedVersion;
    lockLines.push(`  ${yamlQuote(`${fixture.name}@${packageVersion}`)}:`, "    resolution:");
    if (lockIntegrity !== null) lockLines.push(`      integrity: ${yamlQuote(lockIntegrity)}`);
  }
  await writeFile(lockfilePath, `${lockLines.join("\n")}\n`);
  return { applicationRoot, lockfilePath, markerPath, packages: requestedPackages, integrity: resolvedIntegrity };
}

function input(fixture: ApplicationFixture, overrides: Partial<{ framework: typeof framework }> = {}) {
  return {
    applicationRoot: fixture.applicationRoot,
    lockfilePath: fixture.lockfilePath,
    lockfileImporter: ".",
    packages: fixture.packages,
    framework: overrides.framework ?? framework
  };
}

async function withApplication<T>(fixtures: PackageFixture[], run: (fixture: ApplicationFixture) => Promise<T>): Promise<T> {
  const fixture = await makeApplication(fixtures);
  try {
    return await run(fixture);
  } finally {
    await rm(fixture.applicationRoot, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function expectLoadCode(fixture: ApplicationFixture, code: string, options?: Partial<{ framework: typeof framework }>): Promise<void> {
  let caught: unknown;
  try {
    await loadInstalledPlatformPluginManifests(input(fixture, options));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PlatformPluginManifestLoadError);
  expect((caught as { code: string }).code).toBe(code);
}

describe("installed plugin manifest loader", () => {
  it("loads every static field, returns lockfile identity, sorts by plugin ID, and never executes server entrypoints", async () => {
    await withApplication(
      [
        { name: "@k-nex/plugin-zeta", id: "module.zeta" },
        { name: "@k-nex/plugin-alpha", id: "module.alpha" }
      ],
      async (fixture) => {
        const records = await loadInstalledPlatformPluginManifests(input(fixture));
        expect(records.map(({ manifest }) => manifest.id)).toEqual(["module.alpha", "module.zeta"]);
        expect(records.map(({ package: installed }) => installed)).toEqual([
          { name: "@k-nex/plugin-alpha", version: "1.0.0", integrity },
          { name: "@k-nex/plugin-zeta", version: "1.0.0", integrity }
        ]);
        expect(records[0]?.manifest).toEqual(manifestFor("@k-nex/plugin-alpha", "module.alpha", "1.0.0"));
        expect(await exists(fixture.markerPath)).toBe(false);
      }
    );
  });

  it.each([
    {
      label: "manifest package name",
      fixture: { manifest: { package: "@k-nex/other" } },
      code: "PACKAGE_NAME_MISMATCH"
    },
    {
      label: "package.json name",
      fixture: { packageJsonName: "@k-nex/other" },
      code: "PACKAGE_NAME_MISMATCH"
    }
  ])("rejects $label mismatches", async ({ fixture, code }) => {
    await withApplication([{ name: "@k-nex/plugin-alpha", ...fixture }], (application) => expectLoadCode(application, code));
  });

  it.each([
    { label: "installed package version", fixture: { requestedVersion: "2.0.0", packageJsonVersion: "1.0.0", manifestVersion: "2.0.0" }, code: "PACKAGE_VERSION_MISMATCH" },
    { label: "manifest version", fixture: { manifestVersion: "2.0.0" }, code: "MANIFEST_VERSION_MISMATCH" }
  ])("rejects $label mismatches", async ({ fixture, code }) => {
    await withApplication([{ name: "@k-nex/plugin-alpha", ...fixture }], (application) => expectLoadCode(application, code));
  });

  it("rejects malformed static metadata", async () => {
    await withApplication([{ name: "@k-nex/plugin-alpha", manifest: { kind: "not-a-plugin-kind" } }], (fixture) => expectLoadCode(fixture, "MANIFEST_INVALID"));
  });

  it("rejects duplicate plugin IDs", async () => {
    await withApplication(
      [
        { name: "@k-nex/plugin-alpha", id: "module.same" },
        { name: "@k-nex/plugin-beta", id: "module.same" }
      ],
      (fixture) => expectLoadCode(fixture, "DUPLICATE_PLUGIN_ID")
    );
  });

  it.each([
    { label: "core", manifest: { compatibility: { ...compatibility, core: ">=2.0.0 <3.0.0" } } },
    { label: "Payload", manifest: { compatibility: { ...compatibility, payload: ">=4.0.0 <5.0.0" } } },
    { label: "Node", manifest: { compatibility: { ...compatibility, node: ">=25.0.0 <26.0.0" } } },
    { label: "database adapter", framework: { ...framework, payloadDatabaseAdapter: "sqlite" } }
  ])("rejects unsupported $label tuple", async ({ manifest, framework: requestedFramework }) => {
    await withApplication([{ name: "@k-nex/plugin-alpha", manifest }], (fixture) => expectLoadCode(fixture, "UNSUPPORTED_FRAMEWORK", { framework: requestedFramework ?? framework }));
  });

  it.each([
    { label: "core", framework: { ...framework, core: "2.0.0" } },
    { label: "Payload", framework: { ...framework, payload: "4.0.0" } },
    { label: "Node", framework: { ...framework, node: "25.0.0" } }
  ])("rejects an unsupported $label tuple before inspecting an empty package set", async ({ framework: requestedFramework }) => {
    await withApplication([], (fixture) => expectLoadCode(fixture, "UNSUPPORTED_FRAMEWORK", { framework: requestedFramework }));
  });

  it("rejects an unsupported tuple even when a plugin declares broad compatibility ranges", async () => {
    await withApplication(
      [{
        name: "@k-nex/plugin-alpha",
        manifest: {
          compatibility: {
            core: ">=0.0.0",
            payload: ">=0.0.0",
            node: ">=0.0.0",
            payloadDatabaseAdapters: ["postgres"]
          }
        }
      }],
      (fixture) => expectLoadCode(fixture, "UNSUPPORTED_FRAMEWORK", { framework: { ...framework, payload: "4.0.0" } })
    );
  });

  it("requires an exported manifest and ignores an undeclared file that merely has the canonical filename", async () => {
    await withApplication([{ name: "@k-nex/plugin-alpha", exportManifest: null }], (fixture) => expectLoadCode(fixture, "MANIFEST_EXPORT_MISSING"));
  });

  it.each([
    { label: "missing lock entry", fixture: { lockEntry: false }, code: "LOCKFILE_ENTRY_MISSING" },
    { label: "non-exact importer specifier", fixture: { lockSpecifier: "^1.0.0" }, code: "LOCKFILE_SPECIFIER_NOT_EXACT" },
    { label: "missing integrity", fixture: { lockIntegrity: null }, code: "LOCKFILE_INTEGRITY_MISSING" }
  ])("rejects $label", async ({ fixture, code }) => {
    await withApplication([{ name: "@k-nex/plugin-alpha", ...fixture }], (application) => expectLoadCode(application, code));
  });

  it("rejects an importer resolved version mismatch", async () => {
    await withApplication([{ name: "@k-nex/plugin-alpha", lockResolvedVersion: "2.0.0" }], (fixture) => expectLoadCode(fixture, "PACKAGE_VERSION_MISMATCH"));
  });

  it("accepts an exact file tarball locked by integrity", async () => {
    await withApplication([{ name: "@k-nex/plugin-alpha", fileTarball: true }], async (fixture) => {
      const result = loadInstalledPlatformPluginManifests(input(fixture));
      expect(result).toHaveLength(1);
      expect(result[0]?.package).toEqual({ name: "@k-nex/plugin-alpha", version: "1.0.0", integrity });
    });
  });

  it("accepts pnpm peer-qualified file tarball resolutions", async () => {
    await withApplication([{
      name: "@k-nex/plugin-alpha",
      fileTarball: true,
      lockResolvedVersion: "file:fixtures/app/packages/plugin-alpha.tgz(@k-nex/contracts@0.0.0)"
    }], async (fixture) => {
      const result = loadInstalledPlatformPluginManifests(input(fixture));
      expect(result[0]?.package.integrity).toBe(integrity);
    });
  });

  it("rejects file directories and unsafe tarball paths", async () => {
    for (const lockSpecifier of ["file:packages/plugin-alpha", "file:../plugin-alpha.tgz"]) {
      await withApplication(
        [{ name: "@k-nex/plugin-alpha", fileTarball: true, lockSpecifier }],
        (fixture) => expectLoadCode(fixture, "LOCKFILE_SPECIFIER_NOT_EXACT")
      );
    }
  });

  it("does not treat devDependencies as direct plugin dependencies", async () => {
    await withApplication([{ name: "@k-nex/plugin-alpha", lockDependencySection: "devDependencies" }], (fixture) => expectLoadCode(fixture, "LOCKFILE_ENTRY_MISSING"));
  });

  it("rejects a manifest export that resolves to a nested or wrong filename", async () => {
    await withApplication(
      [{ name: "@k-nex/plugin-alpha", exportManifest: "./nested/wrong.json", manifestPath: "nested/wrong.json" }],
      (fixture) => expectLoadCode(fixture, "MANIFEST_EXPORT_INVALID")
    );
  });
});
