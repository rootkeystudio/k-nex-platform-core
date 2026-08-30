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

const runnerSource = readFileSync("packages/extension-runner/src/index.ts", "utf8");
const runnerImageMatches = [...runnerSource.matchAll(/^export const extensionRunnerImage = "(node:24\.19\.0-alpine@(sha256:[0-9a-f]{64}))";$/gmu)];
const extensionRunnerImage = runnerImageMatches[0]?.[1];
const extensionRunnerImageDigest = runnerImageMatches[0]?.[2];
if (typeof extensionRunnerImage !== "string" || typeof extensionRunnerImageDigest !== "string" || runnerImageMatches.length !== 1) {
  throw new Error("The approved digest-pinned extension runner image is unavailable or ambiguous.");
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.stdio ?? "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
};

const dockerSocket = "/var/run/docker.sock";

const dockremapRootUid = () => {
  const mappings = readFileSync("/etc/subuid", "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter((line) => line.split(":", 1)[0] === "dockremap");
  if (mappings.length !== 1) throw new Error("Docker user namespace mapping must contain exactly one dockremap entry in /etc/subuid.");

  const [name, start, count, extra] = mappings[0].split(":");
  if (name !== "dockremap" || extra !== undefined || !/^[1-9]\d*$/u.test(start ?? "") || !/^[1-9]\d*$/u.test(count ?? "")) {
    throw new Error("Docker user namespace mapping has a malformed dockremap entry in /etc/subuid.");
  }
  const rootUid = Number(start);
  const rangeSize = Number(count);
  if (!Number.isSafeInteger(rootUid) || !Number.isSafeInteger(rangeSize) || rootUid + rangeSize - 1 > 4_294_967_294) {
    throw new Error("Docker user namespace mapping has an invalid dockremap UID range in /etc/subuid.");
  }
  return rootUid;
};

const socketAccess = () => ({
  metadata: run("sudo", ["stat", "--format=%u:%g:%a", dockerSocket], { stdio: "pipe" }).trim(),
  acl: run("sudo", ["getfacl", "--absolute-names", "--numeric", "--omit-header", dockerSocket], { stdio: "pipe" })
    .split(/\r?\n/u)
    .filter((line) => line.length > 0),
});

const grantRyukSocketAccess = () => {
  const rootUid = dockremapRootUid();
  const before = socketAccess();
  const entry = `user:${rootUid}:rw-`;
  const existingMappedRootEntries = before.acl.filter((line) => line.startsWith(`user:${rootUid}:`));
  if (existingMappedRootEntries.length > 1 || (existingMappedRootEntries.length === 1 && existingMappedRootEntries[0] !== entry)) {
    throw new Error("Docker socket has a conflicting ACL for the remapped Ryuk root UID.");
  }
  const mask = before.acl.find((line) => line.startsWith("mask::"));
  if (mask ? mask !== "mask::rw-" : !before.acl.includes("group::rw-")) {
    throw new Error("Docker socket ACL mask cannot grant the remapped Ryuk root UID read/write access without broadening existing access.");
  }

  // This test-only Ryuk exception never applies to production Hot Applications, whose runner forbids Docker socket mounts.
  run("sudo", ["setfacl", "--no-mask", "--modify", entry, dockerSocket]);

  const after = socketAccess();
  if (after.metadata !== before.metadata) throw new Error("Granting Ryuk Docker socket access changed its owner, group, or mode.");
  if (!before.acl.every((line) => after.acl.includes(line))) throw new Error("Granting Ryuk Docker socket access changed an existing Docker socket ACL.");
  const additions = after.acl.filter((line) => !before.acl.includes(line));
  if (!additions.every((line) => line === entry || line === "mask::rw-")) {
    throw new Error("Granting Ryuk Docker socket access added an unexpected Docker socket ACL.");
  }
  const mappedRootEntries = after.acl.filter((line) => line.startsWith(`user:${rootUid}:`));
  if (mappedRootEntries.length !== 1 || mappedRootEntries[0] !== entry) {
    throw new Error("Docker socket ACL does not grant exactly the remapped Ryuk root UID read/write access.");
  }
};

const pullAndInspectRunnerImage = () => {
  run("docker", ["pull", extensionRunnerImage]);
  let repoDigests;
  try {
    repoDigests = JSON.parse(run("docker", ["image", "inspect", extensionRunnerImage, "--format", "{{json .RepoDigests}}"], { stdio: "pipe" }));
  } catch {
    throw new Error("The approved digest-pinned extension runner image is not locally inspectable.");
  }
  if (!Array.isArray(repoDigests) || !repoDigests.every((digest) => typeof digest === "string") || !repoDigests.includes(`node@${extensionRunnerImageDigest}`)) {
    throw new Error("The locally inspected extension runner image does not retain its approved digest.");
  }
};

run("sudo", ["apt-get", "update"]);
run("sudo", ["apt-get", "install", "--yes", "apparmor", "acl"]);

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
  pullAndInspectRunnerImage();
  grantRyukSocketAccess();
} finally {
  rmSync(setupDirectory, { recursive: true, force: true });
}
