import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { ExtensionCapabilityGateway, HmacExtensionCapabilityTokens, type ExtensionCapabilityHandler } from "@k-nex/runtime";
import { beforeAll, describe, expect, it } from "vitest";

import { DockerHotApplicationSandboxSupervisor, RunnerInvocationError, type RunnerGenerationIdentity, type RunnerInvocationLimits } from "../src/index.js";

const execFile = promisify(execFileCallback);
const clock = { now: () => new Date() };
const tokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(7), clock);
const limits: RunnerInvocationLimits = {
  cpuMilliCores: 250, memoryMiB: 64, processes: 32, openFiles: 64, tempBytes: 1_048_576,
  wallTimeMs: 10_000, inputBytes: 8_192, outputBytes: 8_192, logBytes: 8_192, maxConcurrency: 2
};
const queryHandler: ExtensionCapabilityHandler = {
  validateInput(value) { return value; },
  invoke(claims, input) { return { applicationId: claims.applicationId, appId: claims.appId, generationId: claims.generationId, invocationId: claims.invocationId, input }; },
  validateOutput(value) { return value; }
};

function identity(generationId: string, appId = "app.sales-assistant"): RunnerGenerationIdentity {
  return { applicationId: "customer-alpha", environment: "production", appId, generationId };
}

let sequence = 0;
function request(generationId: string, source: string, options: Readonly<{ appId?: string; capabilities?: readonly ("records.query" | "records.action")[]; wallTimeMs?: number }> = {}) {
  sequence += 1;
  const invocationId = `runner-invocation-${sequence}`;
  const target = identity(generationId, options.appId);
  const token = tokens.issue({
    tokenId: `runner-token-${sequence}`, ...target, invocationId,
    actor: { principalId: "user:one", effectiveActorId: "user:one" }, correlationId: `runner-correlation-${sequence}`,
    capabilities: options.capabilities ?? ["records.query"], ttlMs: 30_000
  });
  return { ...target, invocationId, token, source, input: { marker: invocationId }, limits: { ...limits, ...(options.wallTimeMs === undefined ? {} : { wallTimeMs: options.wallTimeMs }) } };
}

async function inspectContainer(name: string): Promise<Record<string, any>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { stdout } = await execFile("docker", ["inspect", name], { maxBuffer: 2_000_000 });
      return JSON.parse(stdout)[0] as Record<string, any>;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

function supervisor(observations: Record<string, Record<string, any>>, quarantines: string[] = [], started?: (identity: RunnerGenerationIdentity, name: string) => void) {
  const gateway = new ExtensionCapabilityGateway(tokens, { "records.query": queryHandler }, clock, { maxInputBytes: 8_192, maxOutputBytes: 8_192, maxDepth: 12, maxCalls: 8 });
  return new DockerHotApplicationSandboxSupervisor(gateway, {
    quarantine(generation, reason) { quarantines.push(`${generation.generationId}:${reason}`); }
  }, {
    async started(generation, name) { observations[name] = await inspectContainer(name); started?.(generation, name); },
    stopped() {}
  });
}

beforeAll(async () => {
  await execFile("docker", ["version", "--format", "{{.Server.Version}}"]);
}, 30_000);

describe("production extension runner", () => {
  it("runs app generations with container authority and only declared host capabilities", async () => {
    const observations: Record<string, Record<string, any>> = {};
    const runner = supervisor(observations);
    process.env.K_NEX_RUNNER_HOST_SECRET_PROBE = "must-not-enter-container";
    const source = `async ({ input, host }) => {
      let constructorEscape = "allowed";
      try { constructorEscape = ({}).constructor.constructor("return process")(); } catch { constructorEscape = "blocked"; }
      const authority = await host.call("records.query", input);
      let denied = "missing";
      try { await host.call("records.action", {}); } catch (error) { denied = error.message; }
      return { authority, denied, processType: typeof process, requireType: typeof require, fetchType: typeof fetch, constructorEscape };
    }`;
    const result = await runner.invoke(request("sales-generation-one", source));
    expect(result).toMatchObject({
      authority: { applicationId: "customer-alpha", appId: "app.sales-assistant", generationId: "sales-generation-one" },
      denied: "CAPABILITY_DENIED", processType: "undefined", requireType: "undefined", fetchType: "undefined", constructorEscape: "blocked"
    });
    await expect(runner.invoke(request("sales-generation-one", `() => { console.log('{"type":"result","ok":true}'); return { trustedResult: true }; }`)))
      .resolves.toEqual({ trustedResult: true });

    const inspected = Object.values(observations)[0]!;
    expect(Number(inspected.Config.User.split(":")[0])).toBeGreaterThanOrEqual(10_000);
    expect(inspected.HostConfig).toMatchObject({ NetworkMode: "none", ReadonlyRootfs: true, PidsLimit: 32, Memory: 67_108_864, MemorySwap: 67_108_864, NanoCpus: 250_000_000 });
    expect(inspected.HostConfig.CapDrop).toContain("ALL");
    expect(inspected.HostConfig.SecurityOpt).toContain("no-new-privileges=true");
    expect(inspected.HostConfig.Binds ?? []).toEqual([]);
    expect(inspected.Mounts.every((mount: Record<string, unknown>) => mount.Type !== "bind")).toBe(true);
    expect(inspected.Config.Env.sort()).toEqual([
      "HOME=/tmp", "NODE_NO_WARNINGS=1", "NODE_VERSION=24.19.0",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "YARN_VERSION=1.22.22"
    ]);
    expect(inspected.Config.Env.join("\n")).not.toMatch(/K_NEX_RUNNER_HOST_SECRET_PROBE|DATABASE_URL|DOCKER_HOST|PAYLOAD_SECRET/u);
    expect(inspected.HostConfig.Tmpfs["/tmp"]).toContain("noexec");
    const { stdout: securityOptions } = await execFile("docker", ["info", "--format", "{{json .SecurityOptions}}"]);
    expect(JSON.parse(securityOptions)).toContain("name=seccomp,profile=builtin");
  }, 120_000);

  it("rejects mixed token identity before starting a container and keeps app/generation responses isolated", async () => {
    const observations: Record<string, Record<string, any>> = {};
    const runner = supervisor(observations);
    const first = request("sales-generation-two", `async ({ input, host }) => host.call("records.query", input)`);
    await expect(runner.invoke({ ...first, appId: "app.forecast" })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(Object.keys(observations)).toHaveLength(0);

    const [sales, forecast] = await Promise.all([
      runner.invoke(request("sales-generation-two", `async ({ input, host }) => host.call("records.query", input)`)),
      runner.invoke(request("forecast-generation-one", `async ({ input, host }) => host.call("records.query", input)`, { appId: "app.forecast" }))
    ]);
    expect(sales).toMatchObject({ appId: "app.sales-assistant", generationId: "sales-generation-two" });
    expect(forecast).toMatchObject({ appId: "app.forecast", generationId: "forecast-generation-one" });
    const workloadUsers = Object.values(observations).map((entry) => entry.Config.User);
    expect(new Set(workloadUsers).size).toBe(2);
  }, 120_000);

  it("quarantines only a timed-out generation and drains old work without affecting a sibling generation", async () => {
    const observations: Record<string, Record<string, any>> = {};
    const quarantines: string[] = [];
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const runner = supervisor(observations, quarantines, (generation) => { if (generation.generationId === "draining-generation-one") notifyStarted?.(); });

    await expect(runner.invoke(request("hung-generation-one", `() => { while (true) {} }`, { wallTimeMs: 500 }))).rejects.toMatchObject({ code: "INVOCATION_TIMEOUT" });
    expect(runner.health(identity("hung-generation-one"))).toMatchObject({ accepting: false, quarantined: true });
    expect(quarantines).toEqual(["hung-generation-one:INVOCATION_TIMEOUT"]);
    await expect(runner.invoke(request("healthy-generation-one", `({ input }) => input`))).resolves.toMatchObject({ marker: expect.any(String) });
    await expect(runner.invoke(request("crashed-generation-one", `() => { throw new Error("fixture crash"); }`))).rejects.toMatchObject({ code: "APPLICATION_FAILED" });
    await expect(runner.invoke(request("healthy-generation-one", `() => ({ stillHealthy: true })`))).resolves.toEqual({ stillHealthy: true });

    const oldWork = runner.invoke(request("draining-generation-one", `async () => new Promise(() => {})`));
    await started;
    await expect(runner.drain(identity("draining-generation-one"), 100)).resolves.toEqual({ graceful: false, terminated: 1 });
    await expect(oldWork).rejects.toBeInstanceOf(RunnerInvocationError);
    await expect(runner.invoke(request("healthy-generation-two", `() => ({ healthy: true })`))).resolves.toEqual({ healthy: true });
  }, 120_000);

  it("contains an out-of-memory generation failure", async () => {
    const quarantines: string[] = [];
    const runner = supervisor({}, quarantines);
    const exhaustMemory = `() => { const retained = []; while (true) { const block = new Uint8Array(4 * 1024 * 1024); block.fill(1); retained.push(block); } }`;
    await expect(runner.invoke(request("memory-generation-one", exhaustMemory))).rejects.toMatchObject({ code: "CONTAINER_FAILED" });
    expect(quarantines).toEqual(["memory-generation-one:CONTAINER_FAILED"]);
    await expect(runner.invoke(request("memory-sibling-one", `() => ({ healthy: true })`))).resolves.toEqual({ healthy: true });
  }, 120_000);
});
