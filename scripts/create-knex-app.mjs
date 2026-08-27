#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

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
if (!target || !applicationId || !applicationName) {
  throw new Error("Usage: create-knex-app --target <dir> --id <id> --name <name> [--theme minimal|neobrutalism] [--database docker-postgres|external] [--plan-only|--no-install]");
}
const plan = planCreateKnexApplication({ applicationId, applicationName, theme, database });
if (args.includes("--plan-only")) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}
const directory = resolve(target);
const result = applyCreateKnexApplication(plan, directory);
if (!args.includes("--no-install")) {
  for (const [command, ...commandArgs] of plan.installCommands) execFileSync(command, commandArgs, { cwd: directory, stdio: "inherit" });
}
process.stdout.write(`Created ${plan.applicationId}: ${result.written.length} written, ${result.unchanged.length} unchanged.\n`);
