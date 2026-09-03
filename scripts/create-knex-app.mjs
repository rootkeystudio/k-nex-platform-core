#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { applyCreateKnexApplication, planCreateKnexApplication } from "../packages/composition/dist/index.js";
import { createGitHubHostedAttestationVerifier, createPackageReleaseManifestAuthority } from "../packages/runtime/dist/index.js";

const releaseRepository = "rootkeystudio/k-nex-platform-core";
const releasePredicateType = "https://k-nex.dev/release-manifest/v1";
const releaseWorkflow = "release-evidence.yml";
const repositoryRoot = resolve(import.meta.dirname, "..");
const bundledReleaseManifestPath = join(repositoryRoot, "releases/1.0.0/package-release-manifest.json");
const bundledPackageMirror = join(repositoryRoot, "fixtures/customer-gate-1/packages");

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const target = value("--target");
const applicationId = value("--id");
const applicationName = value("--name");
const theme = value("--theme") ?? "minimal";
const database = value("--database") ?? "docker-postgres";
const releaseManifestPath = value("--release-manifest");
const packageMirror = value("--package-mirror");
const workspace = args.includes("--workspace");
const planOnly = args.includes("--plan-only");
if (!target || !applicationId || !applicationName) {
  throw new Error("Usage: create-knex-app --target <dir> --id <id> --name <name> [--theme minimal|neobrutalism] [--database docker-postgres|external] [--release-manifest <json> --package-mirror <dir>] [--plan-only|--no-install]\nDefaults to the verified bundled v1 release. --workspace is deterministic developer planning only and requires --plan-only.");
}
if ((releaseManifestPath === undefined) !== (packageMirror === undefined)) throw new Error("Packed installation requires both --release-manifest and --package-mirror.");
if (workspace && (releaseManifestPath !== undefined || packageMirror !== undefined)) throw new Error("--workspace cannot be combined with release arguments.");
if (workspace && !planOnly) throw new Error("--workspace requires --plan-only and cannot install or write a target.");
if (workspace && args.includes("--no-install")) throw new Error("--workspace is plan-only and cannot use --no-install.");
const directory = resolve(target);
let packageSource;
if (!workspace) {
  const manifestPath = releaseManifestPath === undefined ? bundledReleaseManifestPath : resolve(releaseManifestPath);
  const mirrorPath = packageMirror === undefined ? bundledPackageMirror : resolve(packageMirror);
  const releaseManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const output = execFileSync("gh", ["attestation", "verify", manifestPath, "--repo", releaseRepository, "--predicate-type", releasePredicateType, "--format", "json"], { encoding: "utf8" });
  const entries = JSON.parse(output);
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Packed release manifest has no trusted hosted attestation.");
  const verifier = createGitHubHostedAttestationVerifier({ repository: releaseRepository, workflow: releaseWorkflow, predicateType: releasePredicateType });
  const authority = createPackageReleaseManifestAuthority(verifier);
  let release;
  for (const entry of entries) {
    try { release = await authority.verify(releaseManifest, entry); break; } catch { /* try another verified hosted statement */ }
  }
  if (release === undefined) throw new Error("Packed release manifest hosted identity is not trusted.");
  packageSource = { kind: "packed-mirror", directory: mirrorPath, authority, release };
}
const plan = planCreateKnexApplication({ applicationId, applicationName, theme, database, ...(packageSource === undefined ? {} : { packageSource }) });
if (planOnly) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  const result = applyCreateKnexApplication(plan, directory);
  if (!args.includes("--no-install")) {
    for (const [command, ...commandArgs] of plan.installCommands) execFileSync(command, commandArgs, { cwd: directory, stdio: "inherit" });
  }
  process.stdout.write(`Created ${plan.applicationId}: ${result.written.length} written, ${result.unchanged.length} unchanged.\n`);
}
