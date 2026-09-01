import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { DockerCommandError, DockerHotApplicationSandboxSupervisor, RunnerInvocationError, dockerAppArmorPolicy, type RunnerGenerationIdentity } from "../src/index.js";

const orphan: RunnerGenerationIdentity = { applicationId: "customer-alpha", environment: "production", appId: "app.sales-assistant", generationId: "orphan-generation" };
const active: RunnerGenerationIdentity = { ...orphan, generationId: "active-generation" };

const drainLeaseId = "lease-00000000-0000-4000-8000-000000000000";

function request(overrides: Record<string, unknown> = {}) {
  return {
    owner: { applicationId: orphan.applicationId, environment: orphan.environment, deliveryClass: "hot-application" as const, extensionId: orphan.appId },
    generationId: orphan.generationId,
    artifactDigest: `sha256:${"a".repeat(64)}`,
    serverEntrypoint: "server/main.mjs",
    invocationId: "runner-invocation-restart",
    drainLeaseId,
    token: "x".repeat(32),
    authorizationRevision: 0,
    lifecycleRevision: 0,
    input: {},
    limits: { cpuMilliCores: 1, memoryMiB: 16, processes: 1, openFiles: 16, tempBytes: 4096, wallTimeMs: 1, inputBytes: 1024, outputBytes: 1024, logBytes: 1024, maxConcurrency: 1 },
    ...overrides
  };
}

function runner(
  authority: { active(identity: RunnerGenerationIdentity): Promise<boolean>; admit(identity: RunnerGenerationIdentity, leaseId: string): Promise<boolean> },
  tokenLeaseId = drainLeaseId,
  supervisorIdentity = "runner-supervisor-alpha"
) {
  return new DockerHotApplicationSandboxSupervisor({ assertInvocationIdentity() { return { drainLeaseId: tokenLeaseId, authorizationRevision: 0, lifecycleRevision: 0 }; } } as never, { async quarantine() {} }, authority, { async started() {}, async stopped() {} }, { async load() { throw new Error("artifact reads must not run"); } } as never, dockerAppArmorPolicy, supervisorIdentity);
}

function child() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  });
}

function frame(type: string, values: Record<string, unknown> = {}) {
  return JSON.stringify({ type, schemaVersion: 1, invocationId: "runner-invocation-restart", generationId: orphan.generationId, ...values });
}

const invocationAcknowledgement = (invocationId = "runner-invocation-restart", generationId = orphan.generationId) => JSON.stringify({ type: "invoke-ack", schemaVersion: 1, invocationId, generationId });

async function acknowledge(supervisor: any, process: ReturnType<typeof child>, invocationId = "runner-invocation-restart") {
  supervisor.inspectSecurity = vi.fn(async () => {});
  supervisor.observationSink = { async started() {}, async stopped() {} };
  const sent = vi.fn();
  process.stdin.once("data", sent);
  process.emit("spawn");
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(sent).toHaveBeenCalledOnce();
  process.stdout.write(`${invocationAcknowledgement(invocationId)}\n`);
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

describe("runner startup reconciliation", () => {
  it("reaps every owned startup container because no invocation can be reattached", async () => {
    const supervisor = runner({ active: async (identity) => identity.generationId === active.generationId, admit: async () => true }) as any;
    const output = vi.fn(async (args: string[]) => {
      if (args[0] === "ps") return "orphan-container\nactive-container\n";
      return "";
    });
    supervisor.dockerOutput = output;

    await expect(supervisor.start()).resolves.toBe(2);
    expect(output).toHaveBeenCalledWith(["ps", "-aq", "--filter", "label=k-nex.runner=hot-application-v1", "--filter", "label=k-nex.supervisor=runner-supervisor-alpha"]);
    expect(output).toHaveBeenCalledWith(["kill", "orphan-container"]);
    expect(output).toHaveBeenCalledWith(["rm", "-f", "orphan-container"]);
    expect(output).toHaveBeenCalledWith(["kill", "active-container"]);
  });

  it("reaps only its own orphan when another supervisor has a healthy invocation on the same daemon", async () => {
    const alpha = runner({ active: async () => true, admit: async () => true }, drainLeaseId, "runner-supervisor-alpha") as any;
    const bravo = runner({ active: async () => true, admit: async () => true }, drainLeaseId, "runner-supervisor-bravo") as any;
    const containers = new Set(["alpha-orphan", "bravo-healthy-invocation"]);
    const daemon = vi.fn(async (args: string[]) => {
      if (args[0] === "ps") {
        return args.includes("label=k-nex.supervisor=runner-supervisor-alpha") && containers.has("alpha-orphan") ? "alpha-orphan\n" : "";
      }
      if (args[0] === "rm") containers.delete(args[2]!);
      return "";
    });
    alpha.dockerOutput = daemon;
    bravo.dockerOutput = daemon;

    await expect(alpha.start()).resolves.toBe(1);

    expect(daemon).toHaveBeenCalledWith(["ps", "-aq", "--filter", "label=k-nex.runner=hot-application-v1", "--filter", "label=k-nex.supervisor=runner-supervisor-alpha"]);
    expect(daemon).toHaveBeenCalledWith(["kill", "alpha-orphan"]);
    expect(daemon).not.toHaveBeenCalledWith(["kill", "bravo-healthy-invocation"]);
    expect(containers).toEqual(new Set(["bravo-healthy-invocation"]));
  });

  it("rejects an invalid supervisor identity at construction", () => {
    expect(() => runner({ active: async () => true, admit: async () => true }, drainLeaseId, "not stable")).toThrow("Runner supervisor identity is invalid.");
  });

  it("reaps an active-generation hung orphan before a fresh admitted invocation starts", async () => {
    const supervisor = runner({ active: vi.fn(async () => true), admit: vi.fn(async () => true) }) as any;
    supervisor.dockerOutput = vi.fn(async (args: string[]) => {
      if (args[0] === "ps") return "hung-active-container\n";
      return "";
    });

    await expect(supervisor.start()).resolves.toBe(1);
    expect(supervisor.dockerOutput).toHaveBeenCalledWith(["kill", "hung-active-container"]);
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.runContainer = vi.fn(async () => ({ fresh: true }));

    await expect(supervisor.invoke(request({ generationId: active.generationId, limits: { ...request().limits, wallTimeMs: 10_000 } }))).resolves.toEqual({ fresh: true });
    expect(supervisor.runContainer).toHaveBeenCalledOnce();
  });

  it("retries failed durable quarantine through public invoke before rejecting locally quarantined work", async () => {
    let durablyQuarantined = false;
    const quarantine = vi.fn().mockRejectedValueOnce(new Error("store down")).mockImplementationOnce(async () => { durablyQuarantined = true; });
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.quarantineSink = { quarantine };
    supervisor.runContainer = vi.fn(async () => { throw new RunnerInvocationError("POLICY_VIOLATION", "seccomp killed workload"); });

    await expect(supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toMatchObject({ code: "POLICY_VIOLATION", cleanupFailed: true });
    expect(supervisor.health(orphan)).toMatchObject({ accepting: false, quarantined: true });
    await expect(supervisor.invoke(request({ invocationId: "runner-invocation-retry", limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toMatchObject({ code: "GENERATION_QUARANTINED", cleanupFailed: false });
    expect(quarantine).toHaveBeenCalledTimes(2);

    const freshAuthority = { active: vi.fn(async () => false), admit: vi.fn(async () => !durablyQuarantined) };
    const fresh = runner(freshAuthority) as any;
    fresh.dockerOutput = vi.fn(async () => "");
    fresh.artifacts = { load: vi.fn() };
    fresh.runContainer = vi.fn();
    await expect(fresh.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toMatchObject({ code: "GENERATION_QUARANTINED" });
    expect(freshAuthority.admit).toHaveBeenCalledWith(orphan, drainLeaseId);
    expect(fresh.artifacts.load).not.toHaveBeenCalled();
    expect(fresh.runContainer).not.toHaveBeenCalled();
  });

  it("awaits every sibling containment attempt and preserves POLICY_VIOLATION", async () => {
    const quarantine = vi.fn(async () => {});
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const delayed = deferred<void>();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.quarantineSink = { quarantine };
    supervisor.kill = vi.fn((name: string) => {
      if (name === "policy-sibling-now") return Promise.reject(new Error("sibling remains"));
      if (name === "policy-sibling-later") return delayed.promise;
      return Promise.resolve();
    });
    supervisor.runContainer = vi.fn(async () => {
      const state = supervisor.state(orphan);
      state.containers.add("policy-sibling-now");
      state.containers.add("policy-sibling-later");
      throw new RunnerInvocationError("POLICY_VIOLATION", "seccomp killed workload");
    });

    const invocation = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.kill).toHaveBeenCalledTimes(2));
    let settled = false;
    void invocation.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    expect(settled).toBe(false);
    delayed.resolve();

    await expect(invocation).rejects.toMatchObject({ code: "POLICY_VIOLATION", cleanupFailed: true });
    expect(supervisor.kill.mock.calls.map(([name]: [string]) => name).sort()).toEqual(["policy-sibling-later", "policy-sibling-now"]);
    expect(quarantine).toHaveBeenCalledTimes(1);
    expect(quarantine).toHaveBeenCalledWith(expect.objectContaining(orphan), "POLICY_VIOLATION");
  });

  it("does not retain a rejected durable quarantine promise", async () => {
    const quarantine = vi.fn().mockRejectedValueOnce(new Error("store down")).mockResolvedValueOnce(undefined);
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const state = supervisor.state(orphan);
    supervisor.quarantineSink = { quarantine };

    await expect(supervisor.quarantineGeneration(state, orphan, "POLICY_VIOLATION", "policy-current")).resolves.toBe(true);
    await expect(supervisor.quarantineGeneration(state, orphan, "POLICY_VIOLATION", "policy-current")).resolves.toBe(false);
    expect(quarantine).toHaveBeenCalledTimes(2);
  });

  it("reaps malformed candidates, awaits every cleanup, then blocks all fresh work if one remains", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const delayed = deferred<void>();
    supervisor.dockerOutput = vi.fn(async (args: string[]) => args[0] === "ps" ? "malformed-runner-container\nvalid-runner-container\n" : "");
    supervisor.kill = vi.fn((name: string) => name === "malformed-runner-container" ? Promise.reject(new Error("malformed runner remains")) : delayed.promise);
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.runContainer = vi.fn(async () => null);

    const start = supervisor.start();
    await vi.waitFor(() => expect(supervisor.kill).toHaveBeenCalledTimes(2));
    let settled = false;
    void start.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    expect(settled).toBe(false);
    delayed.resolve();

    await expect(start).rejects.toThrow("malformed runner remains");
    expect(supervisor.kill.mock.calls.map(([name]: [string]) => name).sort()).toEqual(["malformed-runner-container", "valid-runner-container"]);
    await expect(supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toThrow("malformed runner remains");
    expect(supervisor.runContainer).not.toHaveBeenCalled();
  });

  it("treats only an explicit Docker not-found response as already cleaned up", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const output = vi.fn(async () => { throw new DockerCommandError(["kill", "gone"], 1, "Error response from daemon: No such container: gone"); });
    supervisor.dockerOutput = output;

    await expect(supervisor.kill("gone")).resolves.toBeUndefined();
    expect(output).toHaveBeenCalledTimes(1);
  });

  it("continues from an explicitly stopped container to forced removal", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const output = vi.fn(async (args: string[]) => {
      if (args[0] === "kill") throw new DockerCommandError(args, 1, "Error response from daemon: container runner-stopped is not running");
      return "";
    });
    supervisor.dockerOutput = output;

    await expect(supervisor.kill("runner-stopped")).resolves.toBeUndefined();
    expect(output).toHaveBeenCalledWith(["rm", "-f", "runner-stopped"]);
  });

  it("rejects cleanup when rm and its confirmatory inspect fail at the Docker control plane", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    supervisor.dockerOutput = vi.fn(async (args: string[]) => {
      if (args[0] === "kill") return "";
      if (args[0] === "rm") throw new DockerCommandError(args, 1, "Docker daemon failed to remove container");
      if (args[0] === "inspect") throw new DockerCommandError(args, 1, "Docker daemon unavailable");
      return "";
    });

    await expect(supervisor.kill("runner-control-plane-failure")).rejects.toMatchObject({ stderr: "Docker daemon unavailable" });
  });

  it("rejects a restarted quarantined generation before artifact or container work", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => false }) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    await expect(supervisor.invoke(request())).rejects.toBeInstanceOf(RunnerInvocationError);
    await expect(supervisor.invoke(request())).rejects.toMatchObject({ code: "GENERATION_QUARANTINED" });
  });

  it("rejects a missing or token-mismatched drain lease before artifact or container work", async () => {
    const authority = { active: vi.fn(async () => false), admit: vi.fn(async () => true) };
    const missing = runner(authority) as any;
    await expect(missing.invoke(request({ drainLeaseId: "" }))).rejects.toMatchObject({ code: "INVOCATION_INVALID" });
    expect(authority.admit).not.toHaveBeenCalled();

    const mismatched = runner(authority, "lease-00000000-0000-4000-8000-000000000001") as any;
    mismatched.dockerOutput = vi.fn(async () => "");
    await expect(mismatched.invoke(request())).rejects.toMatchObject({ code: "INVOCATION_INVALID" });
    expect(authority.admit).not.toHaveBeenCalled();
  });

  it("passes only the exact token-bound drain lease to durable admission", async () => {
    const authority = { active: vi.fn(async () => false), admit: vi.fn(async () => false) };
    const supervisor = runner(authority) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    await expect(supervisor.invoke(request())).rejects.toMatchObject({ code: "GENERATION_QUARANTINED" });
    expect(authority.admit).toHaveBeenCalledWith(orphan, drainLeaseId);
  });

  it("reserves capacity before a delayed artifact read and never launches after drain", async () => {
    const supervisor = runner({ active: async () => false, admit: vi.fn(async () => true) }) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    const source = deferred<{ source: string }>();
    supervisor.artifacts = { load: vi.fn(() => source.promise) };
    supervisor.runContainer = vi.fn(async () => null);

    const first = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.artifacts.load).toHaveBeenCalledOnce());
    await expect(supervisor.invoke(request({ invocationId: "runner-invocation-second", limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toMatchObject({ code: "CONCURRENCY_EXHAUSTED" });
    expect(supervisor.artifacts.load).toHaveBeenCalledOnce();

    const draining = supervisor.drain(orphan, 100);
    source.resolve({ source: "export default () => null" });
    await expect(first).rejects.toMatchObject({ code: "GENERATION_DRAINING" });
    await expect(draining).resolves.toEqual({ graceful: true, terminated: 0 });
    expect(supervisor.runContainer).not.toHaveBeenCalled();
  });

  it("rechecks durable admission after a delayed artifact read before launch", async () => {
    const admit = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const supervisor = runner({ active: async () => false, admit }) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    const source = deferred<{ source: string }>();
    supervisor.artifacts = { load: vi.fn(() => source.promise) };
    supervisor.runContainer = vi.fn(async () => null);

    const invocation = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.artifacts.load).toHaveBeenCalledOnce());
    expect(admit).toHaveBeenCalledOnce();
    source.resolve({ source: "export default () => null" });

    await expect(invocation).rejects.toMatchObject({ code: "GENERATION_QUARANTINED" });
    expect(admit).toHaveBeenCalledWith(orphan, drainLeaseId);
    expect(supervisor.runContainer).not.toHaveBeenCalled();
  });

  it("does not launch or hand off source when authorization advances after final admission", async () => {
    let supervisor: any;
    const admit = vi.fn(async () => {
      if (admit.mock.calls.length === 2) {
        supervisor.invalidateAuthorization({ applicationId: orphan.applicationId, environment: orphan.environment, scope: "application", authorizationRevision: 1, lifecycleRevision: 0 });
      }
      return true;
    });
    supervisor = runner({ active: async () => false, admit }) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.runContainer = vi.fn(async () => ({ stale: true }));

    await expect(supervisor.invoke(request({ invocationId: "runner-revoked-after-final-admission", limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    expect(admit).toHaveBeenCalledTimes(2);
    expect(supervisor.runContainer).not.toHaveBeenCalled();
  });

  it("revokes only active work for an advanced authorization revision without quarantining the generation", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const quarantine = vi.fn();
    supervisor.quarantineSink = { quarantine };
    supervisor.kill = vi.fn(async () => {});
    const matchingProcess = child();
    const environmentProcess = child();
    const applicationProcess = child();
    const matching = { ...request({ invocationId: "runner-revoked-active", limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const otherEnvironment = { ...matching, owner: { ...matching.owner, environment: "staging" }, environment: "staging", invocationId: "runner-revoked-staging" };
    const otherApplication = { ...matching, owner: { ...matching.owner, applicationId: "customer-bravo" }, applicationId: "customer-bravo", invocationId: "runner-revoked-other-application" };
    const matchingOutcome = supervisor.exchange(matchingProcess, matching, "runner-revoked-active", 10_000, vi.fn());
    const environmentOutcome = supervisor.exchange(environmentProcess, otherEnvironment, "runner-revoked-staging", 10_000, vi.fn());
    const applicationOutcome = supervisor.exchange(applicationProcess, otherApplication, "runner-revoked-other-application", 10_000, vi.fn());

    await acknowledge(supervisor, matchingProcess, matching.invocationId);
    await acknowledge(supervisor, environmentProcess, otherEnvironment.invocationId);
    await acknowledge(supervisor, applicationProcess, otherApplication.invocationId);
    const invalidation = { applicationId: orphan.applicationId, environment: orphan.environment, scope: "application" as const, authorizationRevision: 7, lifecycleRevision: 4 };
    expect(supervisor.invalidateAuthorization(invalidation)).toBe(true);
    expect(supervisor.invalidateAuthorization(invalidation)).toBe(false);
    matchingProcess.emit("close", 137);

    await expect(matchingOutcome).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    expect(supervisor.health(orphan)).toMatchObject({ accepting: true, quarantined: false, failures: 0 });
    expect(quarantine).not.toHaveBeenCalled();

    environmentProcess.emit("close", 137);
    applicationProcess.stdout.write(`${frame("result", { invocationId: otherApplication.invocationId, ok: true, output: { application: "survived" } })}\n`);
    applicationProcess.emit("close", 0);
    await expect(environmentOutcome).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    await expect(applicationOutcome).resolves.toEqual({ application: "survived" });

    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.runContainer = vi.fn(async () => ({ newlyAuthorized: true }));
    supervisor.gateway = { assertInvocationIdentity() { return { drainLeaseId, authorizationRevision: 7, lifecycleRevision: 4 }; } };
    await expect(supervisor.invoke(request({ invocationId: "runner-newly-authorized", authorizationRevision: 7, lifecycleRevision: 4, limits: { ...request().limits, wallTimeMs: 10_000 } }))).resolves.toEqual({ newlyAuthorized: true });

    const lifecycleProcess = child();
    const lifecycleInvocation = { ...matching, invocationId: "runner-lifecycle-revoked", authorizationRevision: 7, lifecycleRevision: 4 };
    const lifecycleOutcome = supervisor.exchange(lifecycleProcess, lifecycleInvocation, "runner-lifecycle-revoked", 10_000, vi.fn());
    await acknowledge(supervisor, lifecycleProcess, lifecycleInvocation.invocationId);
    const lifecycleInvalidation = { ...invalidation, scope: "environment" as const, lifecycleRevision: 5 };
    expect(supervisor.invalidateAuthorization(lifecycleInvalidation)).toBe(true);
    expect(supervisor.invalidateAuthorization(lifecycleInvalidation)).toBe(false);
    expect(supervisor.invalidateAuthorization({ ...lifecycleInvalidation, authorizationRevision: 6 })).toBe(false);
    lifecycleProcess.emit("close", 137);
    await expect(lifecycleOutcome).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
  });

  it("does not launch an invocation when authorization revokes during its artifact read", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const source = deferred<{ source: string }>();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(() => source.promise) };
    supervisor.runContainer = vi.fn(async () => null);
    const invocation = supervisor.invoke(request({ invocationId: "runner-revoked-before-launch", limits: { ...request().limits, wallTimeMs: 10_000 } }));

    await vi.waitFor(() => expect(supervisor.artifacts.load).toHaveBeenCalledOnce());
    expect(supervisor.invalidateAuthorization({ applicationId: orphan.applicationId, environment: orphan.environment, scope: "environment", authorizationRevision: 0, lifecycleRevision: 1 })).toBe(true);
    source.resolve({ source: "export default () => null" });

    await expect(invocation).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    expect(supervisor.runContainer).not.toHaveBeenCalled();
    expect(supervisor.health(orphan)).toMatchObject({ accepting: true, quarantined: false, failures: 0 });
  });

  it("rejects a stale token at an already-observed authorization floor before artifact work and preserves the next revision", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.runContainer = vi.fn(async () => ({ current: true }));
    expect(supervisor.invalidateAuthorization({ applicationId: orphan.applicationId, environment: orphan.environment, scope: "application", authorizationRevision: 4, lifecycleRevision: 2 })).toBe(true);

    supervisor.gateway = { assertInvocationIdentity() { return { drainLeaseId, authorizationRevision: 3, lifecycleRevision: 2 }; } };
    await expect(supervisor.invoke(request({ authorizationRevision: 3, lifecycleRevision: 2, limits: { ...request().limits, wallTimeMs: 10_000 } }))).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    expect(supervisor.artifacts.load).not.toHaveBeenCalled();

    supervisor.gateway = { assertInvocationIdentity() { return { drainLeaseId, authorizationRevision: 4, lifecycleRevision: 2 }; } };
    await expect(supervisor.invoke(request({ invocationId: "runner-current-after-floor", authorizationRevision: 4, lifecycleRevision: 2, limits: { ...request().limits, wallTimeMs: 10_000 } }))).resolves.toEqual({ current: true });
    expect(supervisor.artifacts.load).toHaveBeenCalledOnce();
  });

  it("cancels an invocation invalidated after runner registration and before source handoff", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    const writes: string[] = [];
    process.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });
    process.kill = vi.fn(() => { process.emit("close", 137); return true; });
    const invocation = { ...request({ invocationId: "runner-revoked-before-handoff", limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-revoked-before-handoff", 10_000, vi.fn());

    expect(supervisor.invalidateAuthorization({ applicationId: orphan.applicationId, environment: orphan.environment, scope: "application", authorizationRevision: 1, lifecycleRevision: 0 })).toBe(true);
    process.emit("spawn");

    await expect(outcome).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    expect(writes).toEqual([]);
  });

  it("does not write an invoke frame when deferred inspection resolves after timeout", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
      let resolveInspection!: () => void;
      const inspection = new Promise<void>((resolve) => { resolveInspection = resolve; });
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(() => true)
      });
      const writes: string[] = [];
      child.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });
      const started = vi.fn(async () => {});
      supervisor.inspectSecurity = vi.fn(() => inspection);
      supervisor.observationSink = { started, async stopped() {} };
      supervisor.kill = vi.fn(async () => {});
      const cleanup = vi.fn();
      const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(child, invocation, "runner-deferred-inspection", 10_000, cleanup);

      child.emit("spawn");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      resolveInspection();
      await Promise.resolve();

      expect(started).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
      child.emit("close", 137);
      await expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(supervisor.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the bounded inspection result when Docker closes before source handoff", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const inspection = deferred<void>();
    const process = child();
    supervisor.inspectSecurity = vi.fn(() => inspection.promise);
    supervisor.kill = vi.fn(async () => {});
    const secretSource = 'export const secret = "runner-source-secret"';
    const secretToken = "runner-token-secret".padEnd(32, "x");
    const invocation = { ...request({ token: secretToken, input: { secret: "runner-input-secret" }, limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: secretSource };
    const outcome = supervisor.exchange(process, invocation, "runner-close-before-inspection", 10_000, vi.fn());

    process.emit("spawn");
    await vi.waitFor(() => expect(supervisor.inspectSecurity).toHaveBeenCalledOnce());
    process.emit("close", 137);
    inspection.reject(new RunnerInvocationError("POLICY_UNAVAILABLE", "Host could not verify the effective container security state (running=false,status=exited,exitCode=137,oomKilled=false)."));

    await expect(outcome).rejects.toMatchObject({
      code: "POLICY_UNAVAILABLE",
      message: "Host could not verify the effective container security state (running=false,status=exited,exitCode=137,oomKilled=false)."
    });
    const error = await outcome.catch((caught: RunnerInvocationError) => caught);
    expect(error.message).not.toContain(secretSource);
    expect(error.message).not.toContain(secretToken);
    expect(error.message).not.toContain("runner-input-secret");
  });

  it("reaps the docker CLI before container cleanup when timeout wins before spawn", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
      const events: string[] = [];
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn((signal: string) => {
          events.push(`cli:${signal}`);
          return true;
        })
      });
      child.on("close", () => { events.push("cli:close"); });
      const cleanup = vi.fn(() => { events.push("policy"); });
      supervisor.kill = vi.fn(async () => { events.push("container"); });
      const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(child, invocation, "runner-before-spawn", 10_000, cleanup);
      const rejection = expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
      const observed = outcome.catch((error: RunnerInvocationError) => {
        events.push(`settled:${error.code}`);
        return error;
      });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(events).toEqual(["cli:SIGKILL"]);
      expect(cleanup).not.toHaveBeenCalled();
      expect(supervisor.kill).not.toHaveBeenCalled();
      child.emit("close", 137);
      await Promise.all([rejection, observed]);
      expect(events).toEqual(["cli:SIGKILL", "cli:close", "container", "policy", "settled:POLICY_UNAVAILABLE"]);

      child.stdout.write('{"type":"result"}\n');
      child.emit("error", new Error("late docker error"));
      child.emit("close", 0);
      await Promise.resolve();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(supervisor.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed for unavailable host policy without quarantining the generation or sending source", async () => {
    const quarantine = vi.fn(async () => {});
    const started = vi.fn(async () => {});
    const stopped = vi.fn(async () => {});
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    const cleanup = vi.fn();
    const source = vi.fn(async () => ({ source: "export default () => null" }));
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: source };
    supervisor.quarantineSink = { quarantine };
    supervisor.observationSink = { started, stopped };
    supervisor.inspectSecurity = vi.fn(async () => { throw new RunnerInvocationError("POLICY_UNAVAILABLE", "inspection omitted a required control"); });
    supervisor.kill = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => supervisor.exchange(process, invocation, containerName, workloadUser, cleanup));
    const writes: string[] = [];
    process.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });

    const outcome = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledTimes(1));
    process.emit("spawn");
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledWith("SIGKILL"));
    process.emit("close", 137);

    await expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(source).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
    expect(started).not.toHaveBeenCalled();
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(supervisor.kill).toHaveBeenCalledTimes(1);
    expect(quarantine).not.toHaveBeenCalled();
    expect(supervisor.health(orphan)).toMatchObject({ accepting: true, quarantined: false, failures: 1 });
  });

  it("observes a seccomp SIGSYS exit, quarantines only that generation, and blocks new work", async () => {
    const quarantine = vi.fn(async () => {});
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const processes = [child(), child()];
    const writes: string[] = [];
    for (const process of processes) process.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });
    const loaded = vi.fn(async () => ({ source: "export default () => null" }));
    const names: string[] = [];
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: loaded };
    supervisor.quarantineSink = { quarantine };
    supervisor.kill = vi.fn(async () => {});
    supervisor.dockerJson = vi.fn(async () => [{ State: { ExitCode: 128 + 31 } }]);
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => {
      names.push(containerName);
      return supervisor.exchange(processes[names.length - 1], invocation, containerName, workloadUser, vi.fn());
    });
    const limits = { ...request().limits, maxConcurrency: 2, wallTimeMs: 10_000 };
    const first = supervisor.invoke(request({ limits, invocationId: "runner-policy-first" }));
    const second = supervisor.invoke(request({ limits, invocationId: "runner-policy-second" }));
    void second.catch(() => {});
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledTimes(2));
    processes[0].emit("spawn");
    processes[1].emit("spawn");
    await vi.waitFor(() => expect(supervisor.inspectSecurity).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    processes[0].stdout.write(`${invocationAcknowledgement("runner-policy-first")}\n`);
    processes[0].emit("close", 1);

    await expect(first).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    expect(quarantine).toHaveBeenCalledTimes(1);
    expect(quarantine).toHaveBeenCalledWith(expect.objectContaining(orphan), "POLICY_VIOLATION");
    expect(new Set(supervisor.kill.mock.calls.map(([name]: [string]) => name))).toEqual(new Set(names));
    expect(supervisor.health(orphan)).toMatchObject({ accepting: false, quarantined: true });
    await expect(supervisor.invoke(request({ limits, invocationId: "runner-policy-blocked" }))).rejects.toMatchObject({ code: "GENERATION_QUARANTINED" });
    expect(loaded).toHaveBeenCalledTimes(2);

    processes[1].emit("close", 1);
    await second.catch(() => {});
  });

  it("treats SIGSYS before source handoff as unavailable host policy without quarantine", async () => {
    const quarantine = vi.fn(async () => {});
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    const started = deferred<void>();
    supervisor.kill = vi.fn(async () => {});
    supervisor.dockerJson = vi.fn(async () => [{ State: { ExitCode: 128 + 31 } }]);
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { started: vi.fn(() => started.promise), stopped: vi.fn(async () => {}) };
    supervisor.quarantineSink = { quarantine };
    const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-policy-before-source", 10_000, vi.fn());

    process.emit("spawn");
    await vi.waitFor(() => expect(supervisor.inspectSecurity).toHaveBeenCalledOnce());
    process.emit("close", 128 + 31);
    started.resolve();

    await expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(quarantine).not.toHaveBeenCalled();
  });

  it("publishes an acknowledged policy violation before current cleanup so sibling work cannot return", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const processes = [child(), child()];
    const names: string[] = [];
    const writes = [[], []] as string[][];
    for (const [index, process] of processes.entries()) process.stdin.on("data", (chunk: Buffer) => { writes[index]!.push(chunk.toString("utf8")); });
    const capability = deferred<unknown>();
    let capabilitySignal: AbortSignal | undefined;
    let capabilityCompleted = false;
    capability.promise.finally(() => { capabilityCompleted = true; }).catch(() => {});
    const invoke = vi.fn(({ signal }: { signal: AbortSignal }) => {
      capabilitySignal = signal;
      return capability.promise;
    });
    supervisor.gateway = { assertInvocationIdentity() { return { drainLeaseId, authorizationRevision: 0, lifecycleRevision: 0 }; }, invoke };
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { async started() {}, async stopped() {} };
    supervisor.dockerJson = vi.fn(async () => [{ State: { ExitCode: 128 + 31 } }]);
    const currentCleanup = deferred<void>();
    supervisor.kill = vi.fn(async (name: string) => {
      if (name === names[0]) await currentCleanup.promise;
    });
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => {
      names.push(containerName);
      return supervisor.exchange(processes[names.length - 1], invocation, containerName, workloadUser, vi.fn());
    });
    const limits = { ...request().limits, maxConcurrency: 2, wallTimeMs: 10_000 };
    const first = supervisor.invoke(request({ limits, invocationId: "runner-inert-first" }));
    const second = supervisor.invoke(request({ limits, invocationId: "runner-inert-second" }));
    const firstError = first.then(() => undefined, (error) => error);
    const secondError = second.then(() => undefined, (error) => error);
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledTimes(2));
    processes[0].emit("spawn");
    processes[1].emit("spawn");
    await vi.waitFor(() => expect(writes[0]).toHaveLength(1));
    await vi.waitFor(() => expect(writes[1]).toHaveLength(1));
    processes[0].stdout.write(`${invocationAcknowledgement("runner-inert-first")}\n`);
    processes[1].stdout.write(`${invocationAcknowledgement("runner-inert-second")}\n`);
    processes[1].stdout.write(`${frame("capability-request", { invocationId: "runner-inert-second", sequence: 1, capability: "records.query", payload: {}, token: "x".repeat(32) })}\n`);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(capabilitySignal?.aborted).toBe(false);
    processes[0].emit("close", 128 + 31);

    await vi.waitFor(() => expect(capabilitySignal?.aborted).toBe(true));
    expect(writes[1]).toHaveLength(1);
    expect(capabilityCompleted).toBe(false);
    processes[1].stdout.write(`${frame("result", { invocationId: "runner-inert-second", ok: true, output: { done: true } })}\n`);
    processes[1].emit("close", 0);

    await expect(secondError).resolves.toMatchObject({ code: "GENERATION_QUARANTINED" });
    expect(writes[1]).toHaveLength(1);
    expect(capabilityCompleted).toBe(false);
    currentCleanup.resolve();
    await expect(firstError).resolves.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("does not return a completed result when quarantine wins during stop observation", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const processes = [child(), child()];
    const names: string[] = [];
    const stopped = deferred<void>();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = {
      async started() {},
      stopped: vi.fn((request: { invocationId: string }) => request.invocationId === "runner-stop-race-success" ? stopped.promise : Promise.resolve())
    };
    supervisor.dockerJson = vi.fn(async () => [{ State: { ExitCode: 128 + 31 } }]);
    supervisor.kill = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => {
      names.push(containerName);
      return supervisor.exchange(processes[names.length - 1], invocation, containerName, workloadUser, vi.fn());
    });
    const limits = { ...request().limits, maxConcurrency: 2, wallTimeMs: 10_000 };
    const success = supervisor.invoke(request({ limits, invocationId: "runner-stop-race-success" }));
    const successError = success.then(() => undefined, (error) => error);
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledOnce());
    processes[0].emit("spawn");
    await vi.waitFor(() => expect(processes[0].stdin.readableLength).toBeGreaterThan(0));
    processes[0].stdout.write(`${invocationAcknowledgement("runner-stop-race-success")}\n${frame("result", { invocationId: "runner-stop-race-success", ok: true, output: { done: true } })}\n`);
    processes[0].emit("close", 0);
    await vi.waitFor(() => expect(supervisor.observationSink.stopped).toHaveBeenCalledOnce());

    const violation = supervisor.invoke(request({ limits, invocationId: "runner-stop-race-violation" }));
    const violationError = violation.then(() => undefined, (error) => error);
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledTimes(2));
    processes[1].emit("spawn");
    await vi.waitFor(() => expect(processes[1].stdin.readableLength).toBeGreaterThan(0));
    processes[1].stdout.write(`${invocationAcknowledgement("runner-stop-race-violation")}\n`);
    processes[1].emit("close", 128 + 31);
    await vi.waitFor(() => expect(supervisor.health(orphan)).toMatchObject({ quarantined: true }));

    stopped.resolve();
    await expect(successError).resolves.toMatchObject({ code: "GENERATION_QUARANTINED" });
    await expect(violationError).resolves.toMatchObject({ code: "POLICY_VIOLATION" });
    expect(supervisor.observationSink.stopped).toHaveBeenCalledTimes(2);
  });

  it("does not return a completed result when authorization or lifecycle revision revokes during stop observation", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    const stopped = deferred<void>();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { async started() {}, stopped: vi.fn(() => stopped.promise) };
    supervisor.kill = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => supervisor.exchange(process, invocation, containerName, workloadUser, vi.fn()));

    const outcome = supervisor.invoke(request({ invocationId: "runner-stop-race-revoked", limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledOnce());
    process.emit("spawn");
    await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
    process.stdout.write(`${invocationAcknowledgement("runner-stop-race-revoked")}\n${frame("result", { invocationId: "runner-stop-race-revoked", ok: true, output: { done: true } })}\n`);
    process.emit("close", 0);
    await vi.waitFor(() => expect(supervisor.observationSink.stopped).toHaveBeenCalledOnce());

    expect(supervisor.invalidateAuthorization({ applicationId: orphan.applicationId, environment: orphan.environment, scope: "application", authorizationRevision: 1, lifecycleRevision: 0 })).toBe(true);
    expect(supervisor.invalidateAuthorization({ applicationId: orphan.applicationId, environment: orphan.environment, scope: "environment", authorizationRevision: 1, lifecycleRevision: 1 })).toBe(true);
    stopped.resolve();

    await expect(outcome).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" });
    expect(supervisor.health(orphan)).toMatchObject({ accepting: true, quarantined: false, failures: 0 });
  });

  it("treats rejected start observation as host-only policy failure before source handoff", async () => {
    const quarantine = vi.fn(async () => {});
    const started = vi.fn(async () => { throw new Error("observation unavailable"); });
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    const writes: string[] = [];
    process.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { started, async stopped() {} };
    supervisor.quarantineSink = { quarantine };
    supervisor.kill = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => supervisor.exchange(process, invocation, containerName, workloadUser, vi.fn()));

    const outcome = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledOnce());
    process.emit("spawn");
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledWith("SIGKILL"));
    process.emit("close", 137);

    await expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(writes).toEqual([]);
    expect(quarantine).not.toHaveBeenCalled();
    expect(supervisor.health(orphan)).toMatchObject({ accepting: true, quarantined: false });
  });

  it("preserves an acknowledged SIGSYS violation when stop observation fails", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { async started() {}, async stopped() { throw new Error("stop observation unavailable"); } };
    supervisor.dockerJson = vi.fn(async () => [{ State: { ExitCode: 128 + 31 } }]);
    supervisor.kill = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => supervisor.exchange(process, invocation, containerName, workloadUser, vi.fn()));

    const outcome = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledOnce());
    process.emit("spawn");
    await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
    process.stdout.write(`${invocationAcknowledgement()}\n`);
    process.emit("close", 128 + 31);

    await expect(outcome).rejects.toMatchObject({ code: "POLICY_VIOLATION", cleanupFailed: true });
  });

  it("returns a typed container failure when stop observation rejects after success", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { load: vi.fn(async () => ({ source: "export default () => null" })) };
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { async started() {}, async stopped() { throw new Error("stop observation unavailable"); } };
    supervisor.kill = vi.fn(async () => {});
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => supervisor.exchange(process, invocation, containerName, workloadUser, vi.fn()));

    const outcome = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledOnce());
    process.emit("spawn");
    await vi.waitFor(() => expect(process.stdin.readableLength).toBeGreaterThan(0));
    process.stdout.write(`${invocationAcknowledgement()}\n`);
    process.stdout.write(`${frame("result", { ok: true, output: { done: true } })}\n`);
    process.emit("close", 0);

    await expect(outcome).rejects.toMatchObject({ code: "CONTAINER_FAILED" });
  });

  it("freezes the acknowledged SIGSYS classification before EPIPE or late frames can race exit inspection", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
      const inspection = deferred<boolean>();
      const process = child();
      const writes: string[] = [];
      process.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });
      supervisor.inspectSecurity = vi.fn(async () => {});
      supervisor.observedPolicyViolation = vi.fn(() => inspection.promise);
      supervisor.kill = vi.fn(async () => {});
      const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(process, invocation, "runner-acknowledged-sigsys", 10_000, vi.fn());

      process.emit("spawn");
      await vi.waitFor(() => expect(supervisor.inspectSecurity).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toHaveLength(1);
      process.stdout.write(`${invocationAcknowledgement()}\n`);
      process.emit("close", 128 + 31);
      process.stdin.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
      process.stdout.write(`${frame("result", { ok: true, output: { late: true } })}\n`);
      await vi.advanceTimersByTimeAsync(10_000);
      inspection.resolve(true);

      await expect(outcome).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
      expect(supervisor.observedPolicyViolation).toHaveBeenCalledWith("runner-acknowledged-sigsys");
    } finally {
      vi.useRealTimers();
    }
  });

  it("quarantines when application failure cleanup cannot reap the container", async () => {
    const quarantine = vi.fn(async () => {});
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const process = child();
    const cleanup = vi.fn();
    supervisor.dockerOutput = vi.fn(async () => "");
    supervisor.artifacts = { async load() { return { source: "export default () => null" }; } };
    supervisor.kill = vi.fn(async () => { throw new Error("container remains"); });
    supervisor.quarantineSink = { quarantine };
    supervisor.runContainer = vi.fn((invocation: unknown, containerName: string, workloadUser: number) => supervisor.exchange(process, invocation, containerName, workloadUser, cleanup));

    const outcome = supervisor.invoke(request({ limits: { ...request().limits, wallTimeMs: 10_000 } }));
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledTimes(1));
    await acknowledge(supervisor, process);
    process.stdout.write(`${frame("result", { ok: false, error: { code: "APPLICATION_FAILED" } })}\n`);
    process.emit("close", 137);

    await expect(outcome).rejects.toMatchObject({ code: "APPLICATION_FAILED" });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(quarantine).toHaveBeenCalledWith(expect.objectContaining(orphan), "CONTAINER_FAILED");
    expect(supervisor.health(orphan)).toMatchObject({ accepting: false, quarantined: true, failures: 1 });
  });

  it("runs accepted capability frames in wire order without serializing host calls", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const calls: number[] = [];
    supervisor.gateway = { invoke: vi.fn(({ sequence }: { sequence: number }) => {
      calls.push(sequence);
      return sequence === 1 ? first.promise : second.promise;
    }) };
    supervisor.kill = vi.fn(async () => {});
    const process = child();
    const writes: Record<string, unknown>[] = [];
    process.stdin.on("data", (chunk: Buffer) => { writes.push(JSON.parse(chunk.toString("utf8"))); });
    const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-ordered-capabilities", 10_000, vi.fn());

    await acknowledge(supervisor, process);

    process.stdout.write(`${frame("capability-request", { sequence: 1, capability: "records.query", payload: {}, token: invocation.token })}\n${frame("capability-request", { sequence: 2, capability: "records.query", payload: {}, token: invocation.token })}\n`);
    await Promise.resolve();
    expect(calls).toEqual([1]);

    first.resolve({ first: true });
    await vi.waitFor(() => expect(calls).toEqual([1, 2]));
    second.resolve({ second: true });
    await vi.waitFor(() => expect(writes.filter((value) => value.type === "capability-response")).toHaveLength(2));
    expect(writes.filter((value) => value.type === "capability-response").map((value) => value.sequence)).toEqual([1, 2]);

    process.stdout.write(`${frame("result", { ok: true, output: { done: true } })}\n`);
    process.emit("close", 0);
    await expect(outcome).resolves.toEqual({ done: true });
  });

  it("rejects a premature result and waits for its accepted capability task to settle", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    const capability = deferred<unknown>();
    supervisor.gateway = { invoke: vi.fn(() => capability.promise) };
    supervisor.kill = vi.fn(async () => {});
    const process = child();
    const writes: string[] = [];
    process.stdin.on("data", (chunk: Buffer) => { writes.push(chunk.toString("utf8")); });
    const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-premature-result", 10_000, vi.fn());

    await acknowledge(supervisor, process);

    process.stdout.write(`${frame("capability-request", { sequence: 1, capability: "records.query", payload: {}, token: invocation.token })}\n`);
    await Promise.resolve();
    process.stdout.write(`${frame("result", { ok: true, output: null })}\n`);
    process.emit("close", 137);
    let settled = false;
    void outcome.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(writes).toHaveLength(1);

    capability.resolve({ ignored: true });
    await expect(outcome).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
    expect(writes).toHaveLength(1);
  });

  it("times out after cleanup without waiting for an accepted capability task", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
      const capability = deferred<unknown>();
      const reaping = deferred<void>();
      supervisor.gateway = { invoke: vi.fn(() => capability.promise) };
      const observedReapingFailure = vi.fn((error: unknown) => { throw error; });
      supervisor.kill = vi.fn(() => reaping.promise.catch(observedReapingFailure));
      const process = child();
      const invocation = { ...request(), ...orphan, source: "export default () => null" };
      const cleanup = vi.fn();
      const outcome = supervisor.exchange(process, invocation, "runner-timeout-join", 10_000, cleanup);

      await acknowledge(supervisor, process);
      process.stdout.write(`${frame("capability-request", { sequence: 1, capability: "records.query", payload: {}, token: invocation.token })}\n`);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      process.emit("close", 137);
      let settled = false;
      void outcome.then(() => { settled = true; }, () => { settled = true; });
      await vi.waitFor(() => expect(supervisor.kill).toHaveBeenCalledTimes(1));
      reaping.reject(new Error("container already gone"));
      await vi.waitFor(() => expect(observedReapingFailure).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
      await expect(outcome).rejects.toMatchObject({ code: "INVOCATION_TIMEOUT" });
      expect(settled).toBe(true);
      capability.resolve({ ignored: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects every workload frame before invoke acknowledgement without executing a capability", async () => {
    for (const payload of [
      frame("log", { text: "too early" }),
      frame("capability-request", { sequence: 1, capability: "records.query", payload: {}, token: "x".repeat(32) }),
      frame("result", { ok: true, output: null })
    ]) {
      const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
      supervisor.gateway = { invoke: vi.fn() };
      supervisor.kill = vi.fn(async () => {});
      const process = child();
      const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(process, invocation, "runner-before-ack-frame", 10_000, vi.fn());

      process.stdout.write(`${payload}\n`);
      process.emit("close", 137);

      await expect(outcome).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
      expect(supervisor.gateway.invoke).not.toHaveBeenCalled();
    }
  });

  it("treats abort before invoke acknowledgement as host-only policy failure", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    supervisor.kill = vi.fn(async () => {});
    const process = child();
    const controller = new AbortController();
    const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 }, signal: controller.signal }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-before-ack-abort", 10_000, vi.fn());

    controller.abort();
    process.emit("close", 137);

    await expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });

  it("fails closed for null, malformed, and duplicate terminal frames", async () => {
    const invalid = async (line: string) => {
      const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
      supervisor.kill = vi.fn(async () => {});
      const process = child();
      const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(process, invocation, "runner-invalid-frame", 10_000, vi.fn());
      process.stdout.write(`${line}\n`);
      process.emit("close", 137);
      await expect(outcome).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
    };
    await invalid("null");
    await invalid("{");

    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    supervisor.kill = vi.fn(async () => {});
    const process = child();
    const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-duplicate-result", 10_000, vi.fn());
    await acknowledge(supervisor, process);
    const result = frame("result", { ok: true, output: null });
    process.stdout.write(`${result}\n${result}\n`);
    process.emit("close", 0);
    await expect(outcome).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
  });

  it("contains stdin EPIPE write callbacks within the invocation", async () => {
    const supervisor = runner({ active: async () => false, admit: async () => true }) as any;
    supervisor.inspectSecurity = vi.fn(async () => {});
    supervisor.observationSink = { async started() {}, async stopped() {} };
    supervisor.kill = vi.fn(async () => {});
    const stdin = Object.assign(new EventEmitter(), {
      destroyed: false,
      writable: true,
      end: vi.fn(),
      write: vi.fn((_value: string, callback: (error?: Error) => void) => {
        queueMicrotask(() => callback(Object.assign(new Error("closed"), { code: "EPIPE" })));
        return false;
      })
    });
    const process = Object.assign(new EventEmitter(), { stdin, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
    const invocation = { ...request({ limits: { ...request().limits, wallTimeMs: 10_000 } }), ...orphan, source: "export default () => null" };
    const outcome = supervisor.exchange(process, invocation, "runner-stdin-epipe", 10_000, vi.fn());

    process.emit("spawn");
    await vi.waitFor(() => expect(stdin.write).toHaveBeenCalledOnce());
    await Promise.resolve();
    process.emit("close", 137);
    await expect(outcome).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });
});
