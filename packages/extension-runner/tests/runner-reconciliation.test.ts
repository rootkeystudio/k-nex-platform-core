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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
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

    const outcome = supervisor.invoke(request());
    await vi.waitFor(() => expect(supervisor.runContainer).toHaveBeenCalledTimes(1));
    process.stdout.write(`${frame("result", { ok: false, error: { code: "APPLICATION_FAILED" } })}\n`);
    process.emit("close", 137);

    await expect(outcome).rejects.toMatchObject({ code: "CONTAINER_FAILED" });
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

    process.stdout.write(`${frame("capability-request", { sequence: 1, capability: "records.query", payload: {}, token: invocation.token })}\n${frame("capability-request", { sequence: 2, capability: "records.query", payload: {}, token: invocation.token })}\n`);
    await Promise.resolve();
    expect(calls).toEqual([1]);

    first.resolve({ first: true });
    await vi.waitFor(() => expect(calls).toEqual([1, 2]));
    second.resolve({ second: true });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((value) => value.sequence)).toEqual([1, 2]);

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

    process.stdout.write(`${frame("capability-request", { sequence: 1, capability: "records.query", payload: {}, token: invocation.token })}\n`);
    await Promise.resolve();
    process.stdout.write(`${frame("result", { ok: true, output: null })}\n`);
    process.emit("close", 137);
    let settled = false;
    void outcome.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(writes).toEqual([]);

    capability.resolve({ ignored: true });
    await expect(outcome).rejects.toMatchObject({ code: "PROTOCOL_VIOLATION" });
    expect(writes).toEqual([]);
  });

  it("reports failed cleanup after waiting for an accepted capability task", async () => {
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
      expect(settled).toBe(false);

      capability.resolve({ ignored: true });
      await expect(outcome).rejects.toMatchObject({ code: "CONTAINER_FAILED" });
    } finally {
      vi.useRealTimers();
    }
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
    await Promise.resolve();
    await Promise.resolve();
    process.emit("close", 137);
    await expect(outcome).rejects.toMatchObject({ code: "CONTAINER_FAILED" });
  });
});
