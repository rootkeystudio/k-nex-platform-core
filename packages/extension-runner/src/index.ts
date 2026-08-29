import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { ExtensionCapabilityGateway, ExtensionCapabilityId } from "@k-nex/runtime";

import { runnerServiceSource } from "./service-source.js";

export const extensionRunnerImage = "node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43";

export interface RunnerGenerationIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
}

export interface RunnerInvocationLimits {
  readonly cpuMilliCores: number;
  readonly memoryMiB: number;
  readonly processes: number;
  readonly openFiles: number;
  readonly tempBytes: number;
  readonly wallTimeMs: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly logBytes: number;
  readonly maxConcurrency: number;
}

export interface RunnerInvocationRequest extends RunnerGenerationIdentity {
  readonly invocationId: string;
  readonly token: string;
  readonly source: string;
  readonly input: unknown;
  readonly limits: RunnerInvocationLimits;
  readonly signal?: AbortSignal;
}

export interface RunnerHealth {
  readonly accepting: boolean;
  readonly activeInvocations: number;
  readonly quarantined: boolean;
  readonly failures: number;
}

export interface RunnerQuarantineSink {
  quarantine(identity: RunnerGenerationIdentity, reason: RunnerInvocationError["code"]): void | Promise<void>;
}

export interface RunnerObservationSink {
  started(identity: RunnerGenerationIdentity, containerName: string): void | Promise<void>;
  stopped(identity: RunnerGenerationIdentity, containerName: string): void | Promise<void>;
}

export class RunnerInvocationError extends Error {
  constructor(readonly code: "RUNNER_UNAVAILABLE" | "GENERATION_DRAINING" | "GENERATION_QUARANTINED" | "CONCURRENCY_EXHAUSTED" | "INVOCATION_INVALID" | "INVOCATION_TIMEOUT" | "OUTPUT_BUDGET_EXCEEDED" | "PROTOCOL_VIOLATION" | "CONTAINER_FAILED" | "APPLICATION_FAILED", message: string) {
    super(message);
    this.name = "RunnerInvocationError";
  }
}

interface GenerationState {
  accepting: boolean;
  active: number;
  failures: number;
  quarantined: boolean;
  readonly workloadUser: number;
  readonly containers: Set<string>;
}

interface RunnerFrame {
  readonly type: string;
  readonly schemaVersion: number;
  readonly invocationId?: string;
  readonly generationId?: string;
  readonly sequence?: number;
  readonly capability?: string;
  readonly payload?: unknown;
  readonly token?: string;
  readonly ok?: boolean;
  readonly output?: unknown;
  readonly error?: { readonly code?: string };
  readonly text?: string;
}

const applicationPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const environmentPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const appPattern = /^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const recordPattern = /^[a-z][a-z0-9-]{2,127}$/u;

function generationKey(identity: RunnerGenerationIdentity): string {
  return `${identity.applicationId}/${identity.environment}/${identity.appId}/${identity.generationId}`;
}

function validateIdentity(identity: RunnerGenerationIdentity): void {
  if (!applicationPattern.test(identity.applicationId) || !environmentPattern.test(identity.environment) || !appPattern.test(identity.appId) || !recordPattern.test(identity.generationId)) {
    throw new TypeError("Runner generation identity is invalid.");
  }
}

function jsonBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { throw new RunnerInvocationError("INVOCATION_INVALID", "Runner invocation payload must be JSON."); }
}

function validateRequest(request: RunnerInvocationRequest): void {
  validateIdentity(request);
  const limits = request.limits;
  if (!recordPattern.test(request.invocationId) ||
    request.token.length < 32 || request.token.length > 8192 || request.source.length < 1 || Buffer.byteLength(request.source) > 1_048_576 || jsonBytes(request.input) > limits.inputBytes ||
    !Number.isSafeInteger(limits.cpuMilliCores) || limits.cpuMilliCores < 1 || limits.cpuMilliCores > 2_000 ||
    !Number.isSafeInteger(limits.memoryMiB) || limits.memoryMiB < 16 || limits.memoryMiB > 512 ||
    !Number.isSafeInteger(limits.processes) || limits.processes < 1 || limits.processes > 256 ||
    !Number.isSafeInteger(limits.openFiles) || limits.openFiles < 16 || limits.openFiles > 4096 ||
    !Number.isSafeInteger(limits.tempBytes) || limits.tempBytes < 4096 || limits.tempBytes > 268_435_456 ||
    !Number.isSafeInteger(limits.wallTimeMs) || limits.wallTimeMs < 1 || limits.wallTimeMs > 30_000 ||
    !Number.isSafeInteger(limits.inputBytes) || limits.inputBytes < 1 || limits.inputBytes > 1_048_576 ||
    !Number.isSafeInteger(limits.outputBytes) || limits.outputBytes < 1 || limits.outputBytes > 4_194_304 ||
    !Number.isSafeInteger(limits.logBytes) || limits.logBytes < 1 || limits.logBytes > 1_048_576 ||
    !Number.isSafeInteger(limits.maxConcurrency) || limits.maxConcurrency < 1 || limits.maxConcurrency > 64) {
    throw new RunnerInvocationError("INVOCATION_INVALID", "Runner invocation identity or limits are invalid.");
  }
}

function exactKeys(value: RunnerFrame, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export class DockerHotApplicationSandboxSupervisor {
  private readonly generations = new Map<string, GenerationState>();
  private readonly workloadUsers = new Map<number, string>();

  constructor(
    private readonly gateway: ExtensionCapabilityGateway,
    private readonly quarantineSink: RunnerQuarantineSink,
    private readonly observationSink: RunnerObservationSink,
    private readonly image = extensionRunnerImage
  ) {
    if (!/^node:24\.19\.0-alpine@sha256:[0-9a-f]{64}$/u.test(image)) throw new TypeError("Runner image must be pinned to the approved Node release digest.");
  }

  async invoke(request: RunnerInvocationRequest): Promise<unknown> {
    validateRequest(request);
    if (request.signal?.aborted) throw new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation was aborted.");
    this.gateway.assertInvocationIdentity(request.token, request);
    const state = this.state(request);
    if (state.quarantined) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is quarantined.");
    if (!state.accepting) throw new RunnerInvocationError("GENERATION_DRAINING", "Runner generation is draining.");
    if (state.active >= request.limits.maxConcurrency) throw new RunnerInvocationError("CONCURRENCY_EXHAUSTED", "Runner generation concurrency is exhausted.");
    state.active += 1;
    const containerName = `k-nex-${request.appId.replaceAll(".", "-")}-${request.generationId}-${randomUUID().slice(0, 8)}`.slice(0, 120);
    state.containers.add(containerName);
    try {
      return await this.runContainer(request, containerName, state.workloadUser);
    } catch (error) {
      const normalized = error instanceof RunnerInvocationError ? error : new RunnerInvocationError("CONTAINER_FAILED", "Runner container failed.");
      state.failures += 1;
      if (["INVOCATION_TIMEOUT", "OUTPUT_BUDGET_EXCEEDED", "PROTOCOL_VIOLATION", "CONTAINER_FAILED"].includes(normalized.code)) {
        state.quarantined = true;
        state.accepting = false;
        await this.quarantineSink.quarantine(request, normalized.code);
      }
      throw normalized;
    } finally {
      state.active -= 1;
      state.containers.delete(containerName);
      await this.observationSink.stopped(request, containerName);
    }
  }

  health(identity: RunnerGenerationIdentity): RunnerHealth {
    validateIdentity(identity);
    const state = this.state(identity);
    return Object.freeze({ accepting: state.accepting, activeInvocations: state.active, quarantined: state.quarantined, failures: state.failures });
  }

  async drain(identity: RunnerGenerationIdentity, timeoutMs: number): Promise<Readonly<{ graceful: boolean; terminated: number }>> {
    validateIdentity(identity);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError("Runner drain timeout is invalid.");
    const state = this.state(identity);
    state.accepting = false;
    const deadline = Date.now() + timeoutMs;
    while (state.active > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    if (state.active === 0) return Object.freeze({ graceful: true, terminated: 0 });
    const containers = [...state.containers];
    await Promise.all(containers.map((name) => this.kill(name)));
    return Object.freeze({ graceful: false, terminated: containers.length });
  }

  private state(identity: RunnerGenerationIdentity): GenerationState {
    const key = generationKey(identity);
    let state = this.generations.get(key);
    if (!state) {
      let workloadUser = 10_000 + createHash("sha256").update(key).digest().readUInt32BE(0) % 50_000;
      while (this.workloadUsers.has(workloadUser) && this.workloadUsers.get(workloadUser) !== key) workloadUser = workloadUser === 59_999 ? 10_000 : workloadUser + 1;
      this.workloadUsers.set(workloadUser, key);
      state = { accepting: true, active: 0, failures: 0, quarantined: false, workloadUser, containers: new Set() };
      this.generations.set(key, state);
    }
    return state;
  }

  private runContainer(request: RunnerInvocationRequest, containerName: string, workloadUser: number): Promise<unknown> {
    const args = [
      "run", "--rm", "-i", "--name", containerName,
      "--label", `k-nex.application=${request.applicationId}`, "--label", `k-nex.app=${request.appId}`, "--label", `k-nex.generation=${request.generationId}`,
      "--network", "none", "--read-only", "--user", `${workloadUser}:${workloadUser}`, "--workdir", "/tmp",
      "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${request.limits.tempBytes},mode=700,uid=${workloadUser},gid=${workloadUser}`,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pids-limit", String(request.limits.processes),
      "--memory", `${request.limits.memoryMiB}m`, "--memory-swap", `${request.limits.memoryMiB}m`, "--cpus", String(request.limits.cpuMilliCores / 1000),
      "--ulimit", `nofile=${request.limits.openFiles}:${request.limits.openFiles}`, "--env", "HOME=/tmp", "--env", "NODE_NO_WARNINGS=1",
      this.image, "node", "--permission", "-e", runnerServiceSource
    ];
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    return this.exchange(child, request, containerName);
  }

  private exchange(child: ChildProcessWithoutNullStreams, request: RunnerInvocationRequest, containerName: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let protocolBytes = 0;
      let logBytes = 0;
      let stderr = "";
      const controller = new AbortController();
      const fail = (error: RunnerInvocationError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        void this.kill(containerName);
        reject(error);
      };
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        child.stdin.end();
        void this.kill(containerName).then(() => resolve(value));
      };
      const abort = () => fail(new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation was aborted."));
      request.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => fail(new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation exceeded its wall-time budget.")), request.limits.wallTimeMs);
      child.once("error", () => fail(new RunnerInvocationError("RUNNER_UNAVAILABLE", "Docker runner is unavailable.")));
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (Buffer.byteLength(stderr) > request.limits.logBytes) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner stderr exceeded its log budget."));
      });
      child.stdout.on("data", (chunk: Buffer) => {
        protocolBytes += chunk.byteLength;
        if (protocolBytes > request.limits.outputBytes + request.limits.logBytes + 1_048_576) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner protocol output exceeded its budget."));
      });
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity, terminal: false });
      lines.on("line", (line) => { void this.handleFrame(line, request, child, controller.signal, (bytes) => { logBytes += bytes; if (logBytes > request.limits.logBytes) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner logs exceeded their budget.")); }, finish, fail); });
      child.once("spawn", () => {
        Promise.resolve(this.observationSink.started(request, containerName)).then(() => {
          child.stdin.write(`${JSON.stringify({ type: "invoke", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, token: request.token, source: request.source, input: request.input, maxInputBytes: request.limits.inputBytes, maxOutputBytes: request.limits.outputBytes })}\n`);
        }).catch(() => fail(new RunnerInvocationError("CONTAINER_FAILED", "Runner container observation failed.")));
      });
      child.once("close", (code) => {
        controller.abort();
        if (!settled) fail(new RunnerInvocationError(code === 0 ? "PROTOCOL_VIOLATION" : "CONTAINER_FAILED", code === 0 ? "Runner exited without a result." : "Runner container exited unsuccessfully."));
      });
    });
  }

  private async handleFrame(
    line: string,
    request: RunnerInvocationRequest,
    child: ChildProcessWithoutNullStreams,
    signal: AbortSignal,
    log: (bytes: number) => void,
    finish: (value: unknown) => void,
    fail: (error: RunnerInvocationError) => void
  ): Promise<void> {
    let frame: RunnerFrame;
    try { frame = JSON.parse(line) as RunnerFrame; } catch { fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted malformed JSON.")); return; }
    if (frame.type === "log" && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "text"]) && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId && typeof frame.text === "string") {
      log(Buffer.byteLength(frame.text));
      return;
    }
    if (frame.type === "capability-request" && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "sequence", "capability", "payload", "token"]) && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId && frame.token === request.token && Number.isSafeInteger(frame.sequence) && typeof frame.capability === "string") {
      try {
        const output = await this.gateway.invoke({ token: frame.token, invocationId: request.invocationId, generationId: request.generationId, sequence: frame.sequence!, capability: frame.capability as ExtensionCapabilityId, payload: frame.payload, signal });
        child.stdin.write(`${JSON.stringify({ type: "capability-response", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, sequence: frame.sequence, ok: true, output, error: null })}\n`);
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "CAPABILITY_FAILED";
        child.stdin.write(`${JSON.stringify({ type: "capability-response", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, sequence: frame.sequence, ok: false, output: null, error: { code } })}\n`);
      }
      return;
    }
    if (frame.type === "result" && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId) {
      if (frame.ok === true && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "ok", "output"])) {
        if (jsonBytes(frame.output) > request.limits.outputBytes) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner result exceeded its output budget.")); else finish(frame.output);
        return;
      }
      if (frame.ok === false && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "ok", "error"]) && frame.error?.code === "APPLICATION_FAILED") {
        fail(new RunnerInvocationError("APPLICATION_FAILED", "Hot Application invocation failed."));
        return;
      }
    }
    fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted an invalid protocol frame."));
  }

  private async kill(containerName: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const child = spawn("docker", ["kill", containerName], { stdio: "ignore" });
      child.once("error", () => resolve());
      child.once("close", () => resolve());
    });
  }
}

export { runnerServiceSource } from "./service-source.js";
