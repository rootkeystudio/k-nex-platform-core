import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ApplicationManifestSchema } from "@k-nex/contracts";

import { resolvePluginGraph } from "./deterministic-resolver.js";
import { loadInstalledPluginManifests } from "./installed-plugin-loader.js";
import {
  fingerprintCustomerConfigSources,
  writeStaticArtifacts,
  type StaticArtifactFrameworkTuple
} from "./static-artifact-generator.js";

function fixtureRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "fixtures/customer-gate-1");
}

function readApplicationManifest(root: string) {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(root, "k-nex.app.json"), "utf8")) as unknown;
  } catch {
    throw new Error("The customer Gate 1 application manifest could not be read.");
  }
  const parsed = ApplicationManifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("The customer Gate 1 application manifest is invalid.");
  return parsed.data;
}

function run(check: boolean): void {
  const root = fixtureRoot();
  const applicationManifest = readApplicationManifest(root);
  const configPath = "k-nex.config.ts";
  let configContent: string;
  try {
    configContent = readFileSync(resolve(root, configPath), "utf8");
  } catch {
    throw new Error("The customer Gate 1 config source could not be read.");
  }

  const framework: StaticArtifactFrameworkTuple = {
    core: "1.0.0",
    payload: "3.88.0",
    node: applicationManifest.runtime.node,
    pnpm: applicationManifest.runtime.packageManagerVersion,
    payloadDatabaseAdapter: "postgres"
  };
  const packageRequests = [
    ...applicationManifest.plugins.map(({ package: name, version }) => ({ name, version })),
    ...Object.values(applicationManifest.providers).map(({ package: name, version }) => ({ name, version }))
  ].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .filter((entry, index, entries) => index === 0 || entries[index - 1]?.name !== entry.name);
  const installed = loadInstalledPluginManifests({
    applicationRoot: root,
    lockfilePath: resolve(root, "../..", "pnpm-lock.yaml"),
    lockfileImporter: "fixtures/customer-gate-1",
    packages: packageRequests,
    framework
  });
  const resolvedGraph = resolvePluginGraph({
    plugins: applicationManifest.plugins,
    providers: applicationManifest.providers,
    installed
  });
  const report = writeStaticArtifacts(
    root,
    {
      applicationManifest,
      resolvedGraph,
      installed,
      framework,
      customerConfigFingerprint: fingerprintCustomerConfigSources([{ path: configPath, content: configContent }])
    },
    { check }
  );

  const differences = [...report.missing, ...report.stale];
  if (differences.length > 0) {
    throw new Error(`${check ? "Generated artifacts are missing or stale" : "Generated artifacts could not be written"}: ${differences.join(", ")}.`);
  }
  console.log(check ? "Gate 1 static artifacts are current." : "Gate 1 static artifacts generated.");
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  console.error("Usage: generate-gate-1-fixture [--check]");
  process.exitCode = 2;
} else {
  try {
    run(args[0] === "--check");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gate 1 static artifact generation failed.");
    process.exitCode = 1;
  }
}
