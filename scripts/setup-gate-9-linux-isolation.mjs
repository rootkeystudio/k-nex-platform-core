import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform !== "linux") throw new Error("Gate 9 Linux isolation setup requires a Linux host.");

const policySource = readFileSync("packages/extension-runner/src/policy.ts", "utf8");
const profile = policySource.match(/runnerAppArmorProfile = String\.raw`([\s\S]*?)`;/u)?.[1];
const profileName = policySource.match(/runnerAppArmorProfileName = "([a-z0-9-]+)";/u)?.[1];
const profileDigest = policySource.match(/runnerAppArmorProfileDigest = "(sha256:[0-9a-f]{64})";/u)?.[1];
if (!profile || !profileName || !profileDigest || `sha256:${createHash("sha256").update(profile).digest("hex")}` !== profileDigest) {
  throw new Error("The approved runner AppArmor profile is unavailable or has an invalid digest.");
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.stdio ?? "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
};

run("sudo", ["apt-get", "update"]);
run("sudo", ["apt-get", "install", "--yes", "apparmor"]);

const existingDaemon = existsSync("/etc/docker/daemon.json") ? JSON.parse(readFileSync("/etc/docker/daemon.json", "utf8")) : {};
if (typeof existingDaemon !== "object" || existingDaemon === null || Array.isArray(existingDaemon) ||
  ("userns-remap" in existingDaemon && existingDaemon["userns-remap"] !== "default")) {
  throw new Error("Docker daemon user namespace remapping has an incompatible existing configuration.");
}
const setupDirectory = mkdtempSync(join(tmpdir(), "k-nex-gate-9-isolation-"));
const profilePath = join(setupDirectory, profileName);
const daemonPath = join(setupDirectory, "daemon.json");
try {
  writeFileSync(profilePath, profile, { encoding: "utf8", mode: 0o644, flag: "wx" });
  writeFileSync(daemonPath, `${JSON.stringify({ ...existingDaemon, "userns-remap": "default" }, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });

  run("sudo", ["install", "-d", "-m", "0755", "/etc/apparmor.d"]);
  run("sudo", ["install", "-m", "0644", profilePath, `/etc/apparmor.d/${profileName}`]);
  run("sudo", ["apparmor_parser", "-r", "-W", `/etc/apparmor.d/${profileName}`]);
  run("sudo", ["install", "-d", "-m", "0755", "/etc/docker"]);
  run("sudo", ["install", "-m", "0644", daemonPath, "/etc/docker/daemon.json"]);
  run("sudo", ["systemctl", "restart", "docker"]);
  const securityOptions = run("docker", ["info", "--format", "{{json .SecurityOptions}}"], { stdio: "pipe" });
  if (!securityOptions.includes("name=apparmor") || !securityOptions.includes("name=userns")) {
    throw new Error("Docker did not report both AppArmor and user-namespace remapping after Gate 9 setup.");
  }
} finally {
  rmSync(setupDirectory, { recursive: true, force: true });
}
