import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertDockerSecurityPolicy,
  assertProductionDockerSecurityPolicy,
  dockerAppArmorPolicy,
  dockerIsolationPolicyFromEnvironment,
  localDockerTestIsolationPolicy,
  runnerAppArmorProfile,
  runnerAppArmorProfileDigest,
  runnerLocalDockerTestBoundary,
  runnerLocalDockerTestBoundaryDigest,
  runnerSeccompProfile,
  runnerSeccompProfileDigest,
} from "../src/policy.js";
import type { DockerIsolationPolicy } from "../src/policy.js";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("runner Docker security policy", () => {
  it("pins custom seccomp and supported MAC policy configuration to approved digests", () => {
    const seccomp = JSON.parse(runnerSeccompProfile) as { defaultAction: string; syscalls: readonly { names: readonly string[]; action: string }[] };
    expect(seccomp).toMatchObject({ defaultAction: "SCMP_ACT_KILL_PROCESS" });
    expect(seccomp.syscalls).toEqual([
      expect.objectContaining({ action: "SCMP_ACT_ALLOW", names: expect.arrayContaining(["capget", "clone", "clone3", "futex", "membarrier", "nanosleep", "openat", "rseq", "statx"]) }),
      { names: ["io_uring_setup"], action: "SCMP_ACT_ERRNO", errnoRet: 1 }
    ]);
    const admitted = seccomp.syscalls.flatMap(({ names }) => names);
    for (const forbidden of ["bpf", "mount", "ptrace", "socket"]) expect(admitted).not.toContain(forbidden);
    expect(digest(runnerSeccompProfile)).toBe(runnerSeccompProfileDigest);
    expect(dockerAppArmorPolicy).toMatchObject({ kind: "apparmor", source: runnerAppArmorProfile, digest: runnerAppArmorProfileDigest });
    expect(digest(runnerAppArmorProfile)).toBe(runnerAppArmorProfileDigest);
    expect(localDockerTestIsolationPolicy).toEqual({
      kind: "local-docker-test-only",
      operatingSystem: "Docker Desktop",
      boundary: runnerLocalDockerTestBoundary,
      digest: runnerLocalDockerTestBoundaryDigest,
      productionEvidence: "forbidden"
    });
    expect(digest(runnerLocalDockerTestBoundary)).toBe(runnerLocalDockerTestBoundaryDigest);
  });

  it("requires an explicit production Linux policy and isolates the Docker Desktop route to tests", () => {
    expect(dockerIsolationPolicyFromEnvironment("apparmor")).toBe(dockerAppArmorPolicy);
    expect(dockerIsolationPolicyFromEnvironment("local-docker-test-only")).toBe(localDockerTestIsolationPolicy);
    expect(() => dockerIsolationPolicyFromEnvironment(undefined)).toThrow("unsupported");
    expect(() => dockerIsolationPolicyFromEnvironment("")).toThrow("unsupported");
    expect(() => dockerIsolationPolicyFromEnvironment("AppArmor")).toThrow("unsupported");
    expect(() => assertProductionDockerSecurityPolicy(localDockerTestIsolationPolicy)).toThrow("cannot produce Gate 9 production isolation evidence");
    expect(() => assertProductionDockerSecurityPolicy(dockerAppArmorPolicy)).not.toThrow();
  });

  it("fails closed for malformed or unknown Docker isolation policies", () => {
    for (const policy of [
      { kind: "unknown" },
      { kind: "apparmor", profile: "unapproved", source: runnerAppArmorProfile, digest: runnerAppArmorProfileDigest },
      { kind: "apparmor", profile: "k-nex-extension-runner", source: "", digest: runnerAppArmorProfileDigest },
      { kind: "virtual-machine", operatingSystem: "Docker Desktop", boundary: "unapproved", digest: "sha256:bad" },
      { ...localDockerTestIsolationPolicy, unexpected: true }
    ]) {
      expect(() => assertDockerSecurityPolicy(policy as unknown as DockerIsolationPolicy)).toThrow();
    }
  });
});
