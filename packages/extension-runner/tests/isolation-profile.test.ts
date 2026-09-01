import { describe, expect, it } from "vitest";

import {
  dockerAppArmorPolicy,
  localDockerTestIsolationPolicy,
  runnerAppArmorProfileDigest,
  runnerSeccompProfileDigest
} from "../src/policy.js";
import { createDockerRunnerIsolationProfile, dockerRunnerHardLimits } from "../src/isolation-profile.js";

describe("Docker runner isolation profile", () => {
  it("is deeply frozen and binds exact Linux AppArmor policy to enforced ceilings", () => {
    const profile = createDockerRunnerIsolationProfile(dockerAppArmorPolicy);

    expect(profile.policy).toEqual(expect.objectContaining({ syscallProfile: runnerSeccompProfileDigest, macProfile: runnerAppArmorProfileDigest }));
    expect(profile.limits).toEqual(dockerRunnerHardLimits);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.policy)).toBe(true);
    expect(Object.isFrozen(profile.limits)).toBe(true);
  });

  it("rejects an unapproved MAC policy and Docker Desktop before a production profile exists", () => {
    expect(() => createDockerRunnerIsolationProfile({ ...dockerAppArmorPolicy, digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).toThrow(/digest/i);
    expect(() => createDockerRunnerIsolationProfile(localDockerTestIsolationPolicy)).toThrow(/cannot produce Gate 9 production isolation evidence/i);
  });
});
