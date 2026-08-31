import { RunnerIsolationProfileSchema, type RunnerIsolationProfile } from "@k-nex/contracts";

import { assertProductionDockerSecurityPolicy, runnerSeccompProfileDigest, type DockerIsolationPolicy } from "./policy.js";

export type DockerRunnerIsolationProfile = Extract<RunnerIsolationProfile, { scope: "production" }>;

/** These are the production runner's admitted Docker ceilings. */
export const dockerRunnerHardLimits = Object.freeze({
  cpuMilliCores: 2_000,
  memoryMiB: 512,
  processes: 256,
  openFiles: 4_096,
  tempBytes: 268_435_456
});

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

/** The supervisor, not traffic callers, owns the profile it actually enforces. */
export function createDockerRunnerIsolationProfile(policy: DockerIsolationPolicy): DockerRunnerIsolationProfile {
  assertProductionDockerSecurityPolicy(policy);
  return deepFreeze(RunnerIsolationProfileSchema.parse({
    schemaVersion: 1,
    scope: "production",
    profile: "os-container-per-generation-v1",
    isolation: "os-container-per-generation",
    workloadIdentity: "unique-non-root",
    namespaces: { pid: "separate", mount: "separate", user: "separate", network: "separate" },
    filesystem: { root: "read-only", code: "read-only", temporaryStorage: "bounded-tmpfs", hostMounts: "none" },
    privileges: { linuxCapabilities: "dropped", noNewPrivileges: true, dockerSocket: "none", databaseCredential: "none", hostSecrets: "none" },
    policy: { syscallProfile: runnerSeccompProfileDigest, macProfile: policy.digest, rawEgress: "denied", inboundListener: "denied", hostNetworkAdapter: "allowlisted-proxy-only" },
    limits: dockerRunnerHardLimits,
    rpc: { transport: "structured-host-rpc-only", schemaValidated: true, shortLivedGenerationActorIdentity: true }
  })) as DockerRunnerIsolationProfile;
}
