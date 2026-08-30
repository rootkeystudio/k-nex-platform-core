import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { DockerHotApplicationSandboxSupervisor, RunnerInvocationError, type RunnerGenerationIdentity } from "../src/index.js";

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
    input: {},
    limits: { cpuMilliCores: 1, memoryMiB: 16, processes: 1, openFiles: 16, tempBytes: 4096, wallTimeMs: 1, inputBytes: 1024, outputBytes: 1024, logBytes: 1024, maxConcurrency: 1 },
    ...overrides
  };
}

function runner(
  authority: { active(identity: RunnerGenerationIdentity): Promise<boolean>; admit(identity: RunnerGenerationIdentity, leaseId: string): Promise<boolean> },
  tokenLeaseId = drainLeaseId
) {
  return new DockerHotApplicationSandboxSupervisor({ assertInvocationIdentity() { return { drainLeaseId: tokenLeaseId }; } } as never, { async quarantine() {} }, authority, { async started() {}, async stopped() {} }, { async load() { throw new Error("artifact reads must not run"); } } as never);
}

function labels(identity: RunnerGenerationIdentity) {
  return {
    "k-nex.runner": "hot-application-v1",
    "k-nex.application": identity.applicationId,
    "k-nex.environment": identity.environment,
    "k-nex.app": identity.appId,
    "k-nex.generation": identity.generationId
  };
}

describe("runner startup reconciliation", () => {
  it("SIGKILLs only labeled runner orphans after checking durable authority", async () => {
    const supervisor = runner({ active: async (identity) => identity.generationId === active.generationId, admit: async () => true }) as any;
    const output = vi.fn(async (args: string[]) => {
      if (args[0] === "ps") return "orphan-container\nactive-container\n";
      if (args[0] === "inspect") return JSON.stringify([{ Config: { Labels: labels(args[1] === "orphan-container" ? orphan : active) } }]);
      return "";
    });
    supervisor.dockerOutput = output;

    await expect(supervisor.start()).resolves.toBe(1);
    expect(output).toHaveBeenCalledWith(["ps", "-aq", "--filter", "label=k-nex.runner=hot-application-v1"]);
    expect(output).toHaveBeenCalledWith(["kill", "orphan-container"]);
    expect(output).toHaveBeenCalledWith(["rm", "-f", "orphan-container"]);
    expect(output).not.toHaveBeenCalledWith(["kill", "active-container"]);
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
      const invocation = { ...request(), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(child, invocation, "runner-deferred-inspection", 10_000, cleanup);

      child.emit("spawn");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
      resolveInspection();
      await Promise.resolve();

      expect(started).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
      child.emit("close", 137);
      await expect(outcome).rejects.toMatchObject({ code: "INVOCATION_TIMEOUT" });
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(supervisor.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
      const invocation = { ...request(), ...orphan, source: "export default () => null" };
      const outcome = supervisor.exchange(child, invocation, "runner-before-spawn", 10_000, cleanup);
      const rejection = expect(outcome).rejects.toMatchObject({ code: "INVOCATION_TIMEOUT" });
      const observed = outcome.catch((error: RunnerInvocationError) => {
        events.push(`settled:${error.code}`);
        return error;
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual(["cli:SIGKILL"]);
      expect(cleanup).not.toHaveBeenCalled();
      expect(supervisor.kill).not.toHaveBeenCalled();
      child.emit("close", 137);
      await Promise.all([rejection, observed]);
      expect(events).toEqual(["cli:SIGKILL", "cli:close", "container", "policy", "settled:INVOCATION_TIMEOUT"]);

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
});
