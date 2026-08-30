import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  defaultDockerIsolationPolicy,
  dockerAppArmorPolicy,
  dockerIsolationPolicyFromEnvironment,
  dockerSelinuxPolicy,
  runnerAppArmorProfile,
  runnerAppArmorProfileDigest,
  runnerSeccompProfile,
  runnerSeccompProfileDigest,
  runnerSelinuxLabel,
  runnerSelinuxPolicyDigest
} from "../src/index.js";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("runner Docker security policy", () => {
  it("pins custom seccomp and supported MAC policy configuration to approved digests", () => {
    expect(JSON.parse(runnerSeccompProfile)).toMatchObject({ defaultAction: "SCMP_ACT_ALLOW" });
    expect(digest(runnerSeccompProfile)).toBe(runnerSeccompProfileDigest);
    expect(dockerAppArmorPolicy).toMatchObject({ kind: "apparmor", source: runnerAppArmorProfile, digest: runnerAppArmorProfileDigest });
    expect(digest(runnerAppArmorProfile)).toBe(runnerAppArmorProfileDigest);
    expect(dockerSelinuxPolicy).toEqual({ kind: "selinux", label: runnerSelinuxLabel, digest: runnerSelinuxPolicyDigest });
    expect(digest(runnerSelinuxLabel)).toBe(runnerSelinuxPolicyDigest);
    expect(defaultDockerIsolationPolicy).toMatchObject({ kind: "virtual-machine", operatingSystem: "Docker Desktop" });
  });

  it("accepts only the explicit Linux CI AppArmor selection", () => {
    expect(dockerIsolationPolicyFromEnvironment(undefined)).toBe(defaultDockerIsolationPolicy);
    expect(dockerIsolationPolicyFromEnvironment("apparmor")).toBe(dockerAppArmorPolicy);
    expect(() => dockerIsolationPolicyFromEnvironment("selinux")).toThrow("unsupported");
  });
});
