import { createHash } from "node:crypto";

export const runnerSeccompProfile = JSON.stringify({
  // This is deliberately a Node 24 runner allowlist, not a general-purpose container profile.
  defaultAction: "SCMP_ACT_KILL_PROCESS",
  syscalls: [{
    names: [
      "arch_prctl", "brk", "capget", "chdir", "clock_getres", "clock_gettime", "clock_nanosleep", "clone", "clone3", "close", "close_range",
      "dup", "dup2", "dup3", "epoll_create1", "epoll_ctl", "epoll_pwait", "epoll_wait", "eventfd2", "execve", "exit", "exit_group",
      "faccessat", "fchdir", "fchmodat", "fcntl", "fdatasync", "fstat", "fstatfs", "fsync", "futex", "getcwd", "getdents64", "getegid",
      "geteuid", "getgid", "getgroups", "getpeername", "getpid", "getppid", "getrandom", "getresgid", "getresuid", "getrlimit", "getrusage",
      "getsid", "getsockname", "getsockopt", "gettid", "getuid", "ioctl", "kill", "lseek", "madvise", "memfd_create", "mmap", "mprotect",
      "membarrier", "mremap", "munmap", "newfstatat", "openat", "openat2", "pipe", "pipe2", "poll", "ppoll", "prctl", "pread64", "preadv", "prlimit64",
      "pselect6", "pwrite64", "read", "readlink", "readlinkat", "readv", "recvfrom", "recvmsg", "restart_syscall", "rseq", "rt_sigaction",
      "rt_sigpending", "rt_sigprocmask", "rt_sigreturn", "rt_sigsuspend", "rt_sigtimedwait", "sched_getaffinity", "sched_getparam", "sched_getscheduler",
      "sched_yield", "sendfile", "sendmsg", "sendto", "set_robust_list", "set_tid_address", "setrlimit", "sigaltstack", "statfs", "statx", "sysinfo",
      "tgkill", "time", "timerfd_create", "timerfd_gettime", "timerfd_settime", "uname", "unlinkat", "utimensat", "wait4", "write", "writev"
    ],
    action: "SCMP_ACT_ALLOW"
  }, {
    // Node probes io_uring and falls back when the kernel returns EPERM.
    names: ["io_uring_setup"],
    action: "SCMP_ACT_ERRNO",
    errnoRet: 1
  }]
});
export const runnerSeccompProfileDigest = "sha256:9e1b305927408a95032982bd0c5713e372cd2a3c205febc954df62e8a0de3ef8";

export type DockerIsolationPolicy =
  | Readonly<{ kind: "apparmor"; profile: string; source: string; digest: string }>
  | Readonly<{ kind: "local-docker-test-only"; operatingSystem: "Docker Desktop"; boundary: string; digest: string; productionEvidence: "forbidden" }>;

export type ProductionDockerIsolationPolicy = Exclude<DockerIsolationPolicy, { kind: "local-docker-test-only" }>;

export const runnerAppArmorProfile = String.raw`# This policy must be loaded by the host-owned Docker security-policy installer.
#include <tunables/global>

profile k-nex-extension-runner flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  file,
  deny /proc/** w,
  deny /sys/** w,
  deny /run/** w,
}`;
export const runnerAppArmorProfileDigest = "sha256:258d1e7e322b0dd4d9394ddc97e356e191076a89609cd07395fe5ac9656a1814";
export const runnerAppArmorProfileName = "k-nex-extension-runner";

export const dockerAppArmorPolicy: DockerIsolationPolicy = Object.freeze({
  kind: "apparmor",
  profile: runnerAppArmorProfileName,
  source: runnerAppArmorProfile,
  digest: runnerAppArmorProfileDigest
});
export const runnerLocalDockerTestBoundary = "Docker Desktop is a local test-only container runtime and supplies no Gate 9 production isolation evidence";
export const runnerLocalDockerTestBoundaryDigest = "sha256:f018d0490f5182c92873525401b413413b45e4a3d3fed6e2e75ee956b40f8082";
export const localDockerTestIsolationPolicy: DockerIsolationPolicy = Object.freeze({
  kind: "local-docker-test-only",
  operatingSystem: "Docker Desktop",
  boundary: runnerLocalDockerTestBoundary,
  digest: runnerLocalDockerTestBoundaryDigest,
  productionEvidence: "forbidden"
});

/** Production requires an explicit Linux MAC policy; Docker Desktop is test-only and never production evidence. */
export function dockerIsolationPolicyFromEnvironment(value: string | undefined): DockerIsolationPolicy {
  if (value === "apparmor") return dockerAppArmorPolicy;
  if (value === "local-docker-test-only") return localDockerTestIsolationPolicy;
  throw new TypeError("Runner Docker isolation policy selection is unsupported.");
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function assertDockerSecurityPolicy(policy: DockerIsolationPolicy): void {
  if (digest(runnerSeccompProfile) !== runnerSeccompProfileDigest) throw new TypeError("Runner seccomp policy digest does not match the approved profile.");
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new TypeError("Runner Docker isolation policy is malformed.");
  }
  if (policy.kind === "apparmor") {
    if (!hasExactKeys(policy, ["kind", "profile", "source", "digest"]) || policy.profile !== runnerAppArmorProfileName || policy.source !== runnerAppArmorProfile || policy.digest !== runnerAppArmorProfileDigest || digest(policy.source) !== policy.digest) {
      throw new TypeError("Runner AppArmor policy digest does not match the approved profile.");
    }
    return;
  }
  if (policy.kind === "local-docker-test-only") {
    if (!hasExactKeys(policy, ["kind", "operatingSystem", "boundary", "digest", "productionEvidence"]) || policy.operatingSystem !== "Docker Desktop" || policy.boundary !== runnerLocalDockerTestBoundary || policy.digest !== runnerLocalDockerTestBoundaryDigest || policy.productionEvidence !== "forbidden" || digest(policy.boundary) !== policy.digest) {
      throw new TypeError("Runner local Docker test boundary digest does not match the approved profile.");
    }
    return;
  }
  throw new TypeError("Runner Docker isolation policy kind is unsupported.");
}

export function assertProductionDockerSecurityPolicy(policy: DockerIsolationPolicy): asserts policy is ProductionDockerIsolationPolicy {
  assertDockerSecurityPolicy(policy);
  if (policy.kind === "local-docker-test-only") throw new TypeError("Docker Desktop local test policy cannot produce Gate 9 production isolation evidence.");
}
