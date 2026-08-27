#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { applyCreateKnexApplication, planCreateKnexApplication } from "../packages/composition/dist/index.js";

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
if (!target || !applicationId || !applicationName) {
  throw new Error("Usage: create-knex-app --target <dir> --id <id> --name <name> [--theme minimal|neobrutalism] [--database docker-postgres|external] [--release-manifest <json> --package-mirror <dir>] [--plan-only|--no-install]");
}
if ((releaseManifestPath === undefined) !== (packageMirror === undefined)) throw new Error("Packed installation requires both --release-manifest and --package-mirror.");
const directory = resolve(target);
let packageSource;
if (releaseManifestPath !== undefined && packageMirror !== undefined) {
  const releaseManifest = JSON.parse(readFileSync(resolve(releaseManifestPath), "utf8"));
  const mirror = resolve(packageMirror);
  for (const entry of releaseManifest.packages ?? []) {
    const filename = `${entry.package.slice(1).replace("/", "-")}-${entry.version}.tgz`;
    const archive = readFileSync(resolve(mirror, filename));
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    if (integrity !== entry.integrity) throw new Error(`Packed release integrity mismatch for ${entry.package}@${entry.version}.`);
  }
  packageSource = { kind: "packed-mirror", directory: relative(directory, mirror).split(sep).join("/"), releaseManifest };
}
const plan = planCreateKnexApplication({ applicationId, applicationName, theme, database, ...(packageSource === undefined ? {} : { packageSource }) });
if (args.includes("--plan-only")) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}
const result = applyCreateKnexApplication(plan, directory);
if (!args.includes("--no-install")) {
  for (const [command, ...commandArgs] of plan.installCommands) execFileSync(command, commandArgs, { cwd: directory, stdio: "inherit" });
}
process.stdout.write(`Created ${plan.applicationId}: ${result.written.length} written, ${result.unchanged.length} unchanged.\n`);
