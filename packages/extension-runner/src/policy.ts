import { createHash } from "node:crypto";

export const runnerSeccompProfile = JSON.stringify({
  defaultAction: "SCMP_ACT_ALLOW",
  syscalls: [{
    names: [
      "acct", "add_key", "afs_syscall", "bpf", "clock_adjtime", "clock_settime", "create_module", "delete_module", "fanotify_init",
      "finit_module", "get_kernel_syms", "init_module", "ioperm", "iopl", "kexec_load", "keyctl", "lookup_dcookie", "mount",
      "move_mount", "name_to_handle_at", "nfsservctl", "open_by_handle_at", "open_tree", "perf_event_open", "pivot_root", "process_vm_readv",
      "process_vm_writev", "ptrace", "query_module", "quotactl", "reboot", "request_key", "setdomainname", "sethostname", "setns",
      "settimeofday", "swapoff", "swapon", "syslog", "tuxcall", "umount2", "uselib", "userfaultfd", "vhangup"
    ],
    action: "SCMP_ACT_ERRNO"
  }]
});
export const runnerSeccompProfileDigest = "sha256:8a0cc556505d2562e8b52692e2d13ec716ff6576f6fe955d56d1399a7649f763";

export type DockerIsolationPolicy =
  | Readonly<{ kind: "apparmor"; profile: string; source: string; digest: string }>
  | Readonly<{ kind: "selinux"; label: string; digest: string }>
  | Readonly<{ kind: "virtual-machine"; operatingSystem: "Docker Desktop"; boundary: string; digest: string }>;

export const runnerAppArmorProfile = String.raw`# This policy must be loaded by the host-owned Docker security-policy installer.
#include <tunables/global>

profile k-nex-extension-runner flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  deny /proc/** w,
  deny /sys/** w,
  deny /run/** w,
}`;
export const runnerAppArmorProfileDigest = "sha256:6f708e61834119404df0e4ae5c743580dbb4327e2025c71771bfae7817e0ebe0";
export const runnerAppArmorProfileName = "k-nex-extension-runner";

export const dockerAppArmorPolicy: DockerIsolationPolicy = Object.freeze({
  kind: "apparmor",
  profile: runnerAppArmorProfileName,
  source: runnerAppArmorProfile,
  digest: runnerAppArmorProfileDigest
});
export const runnerSelinuxLabel = "label=type:k_nex_extension_runner_t";
export const runnerSelinuxPolicyDigest = "sha256:2ad01de44b51c8503ab0107fae6a06d6642f8abaf14e4621ce0e330b0e589eda";
export const dockerSelinuxPolicy: DockerIsolationPolicy = Object.freeze({ kind: "selinux", label: runnerSelinuxLabel, digest: runnerSelinuxPolicyDigest });
export const runnerVirtualMachineBoundary = "Docker Desktop Linux VM isolates container kernel authority from the macOS host";
export const runnerVirtualMachineBoundaryDigest = "sha256:9277d75562011f1d1c286522d61e1b353ffe42ad1f3596d87c49fb2804dc5504";
export const defaultDockerIsolationPolicy: DockerIsolationPolicy = Object.freeze({
  kind: "virtual-machine",
  operatingSystem: "Docker Desktop",
  boundary: runnerVirtualMachineBoundary,
  digest: runnerVirtualMachineBoundaryDigest
});

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertDockerSecurityPolicy(policy: DockerIsolationPolicy): void {
  if (digest(runnerSeccompProfile) !== runnerSeccompProfileDigest) throw new TypeError("Runner seccomp policy digest does not match the approved profile.");
  if (policy.kind === "apparmor") {
    if (policy.profile !== runnerAppArmorProfileName || policy.source !== runnerAppArmorProfile || policy.digest !== runnerAppArmorProfileDigest || digest(policy.source) !== policy.digest) {
      throw new TypeError("Runner AppArmor policy digest does not match the approved profile.");
    }
    return;
  }
  if (policy.kind === "selinux" && (policy.label !== runnerSelinuxLabel || policy.digest !== runnerSelinuxPolicyDigest || digest(policy.label) !== policy.digest)) {
    throw new TypeError("Runner SELinux policy digest does not match the approved profile.");
  }
  if (policy.kind === "virtual-machine" && (policy.operatingSystem !== "Docker Desktop" || policy.boundary !== runnerVirtualMachineBoundary || policy.digest !== runnerVirtualMachineBoundaryDigest || digest(policy.boundary) !== policy.digest)) {
    throw new TypeError("Runner virtual-machine boundary digest does not match the approved profile.");
  }
}
