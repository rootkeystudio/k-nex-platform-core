import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { VerifiedArtifactOwner, VerifiedArtifactRunnerSource } from "@k-nex/extension-bundler";
import type { ExtensionCapabilityGateway, ExtensionCapabilityId } from "@k-nex/runtime";

import { createDockerRunnerIsolationProfile, dockerRunnerHardLimits, type DockerRunnerIsolationProfile } from "./isolation-profile.js";
import { assertDockerSecurityPolicy, runnerSeccompProfile, type DockerIsolationPolicy } from "./policy.js";
import { runnerServiceSource } from "./service-source.js";

export const extensionRunnerImage = "node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43";

export interface RunnerArtifactOwner extends VerifiedArtifactOwner {
  readonly deliveryClass: "hot-application";
}

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

export interface RunnerInvocationRequest {
  readonly owner: RunnerArtifactOwner;
  readonly generationId: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly serverEntrypoint: string;
  readonly invocationId: string;
  readonly drainLeaseId: string;
  readonly token: string;
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

export type RunnerTerminalQuarantineReason = "INVOCATION_TIMEOUT" | "OUTPUT_BUDGET_EXCEEDED" | "PROTOCOL_VIOLATION" | "CONTAINER_FAILED" | "POLICY_VIOLATION";

export interface RunnerQuarantineSink {
  quarantine(identity: RunnerGenerationIdentity, reason: RunnerTerminalQuarantineReason): void | Promise<void>;
}

/** Durable inventory is the authority; container labels only locate candidates. */
export interface RunnerGenerationAuthority {
  active(identity: RunnerGenerationIdentity): Promise<boolean>;
  admit(identity: RunnerGenerationIdentity, drainLeaseId: string): Promise<boolean>;
}

export interface RunnerObservationSink {
  started(identity: RunnerGenerationIdentity, containerName: string): void | Promise<void>;
  stopped(identity: RunnerGenerationIdentity, containerName: string): void | Promise<void>;
}

export class RunnerInvocationError extends Error {
  cleanupFailed = false;

  constructor(readonly code: "RUNNER_UNAVAILABLE" | "GENERATION_DRAINING" | "GENERATION_QUARANTINED" | "CONCURRENCY_EXHAUSTED" | "INVOCATION_INVALID" | "INVOCATION_TIMEOUT" | "OUTPUT_BUDGET_EXCEEDED" | "PROTOCOL_VIOLATION" | "POLICY_UNAVAILABLE" | "POLICY_VIOLATION" | "CONTAINER_FAILED" | "APPLICATION_FAILED", message: string) {
    super(message);
    this.name = "RunnerInvocationError";
  }
}

export class DockerCommandError extends Error {
  constructor(readonly args: readonly string[], readonly exitCode: number | null, readonly stderr: string) {
    super(`docker ${args.join(" ")} failed${exitCode === null ? "" : ` with exit code ${exitCode}`}.`);
    this.name = "DockerCommandError";
  }
}

interface ResolvedRunnerInvocation extends RunnerInvocationRequest, RunnerGenerationIdentity {
  readonly source: string;
}

interface GenerationState {
  accepting: boolean;
  active: number;
  failures: number;
  quarantined: boolean;
  readonly workloadUser: number;
  readonly containers: Set<string>;
  readonly invocations: Map<string, { readonly containerName: string; readonly cancel: () => void }>;
  terminalQuarantine?: {
    readonly identity: RunnerGenerationIdentity;
    readonly reason: RunnerTerminalQuarantineReason;
    durable?: Promise<void>;
  };
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
const drainLeasePattern = /^lease-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

function generationKey(identity: RunnerGenerationIdentity): string {
  return `${identity.applicationId}/${identity.environment}/${identity.appId}/${identity.generationId}`;
}

function identity(request: RunnerInvocationRequest): RunnerGenerationIdentity {
  return { applicationId: request.owner.applicationId, environment: request.owner.environment, appId: request.owner.extensionId, generationId: request.generationId };
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
  const runnerIdentity = identity(request);
  validateIdentity(runnerIdentity);
  const limits = request.limits;
  if (!recordPattern.test(request.invocationId) ||
    request.owner.deliveryClass !== "hot-application" || !/^sha256:[0-9a-f]{64}$/u.test(request.artifactDigest) || !/^server\/[a-zA-Z0-9._/-]+\.mjs$/u.test(request.serverEntrypoint) || request.serverEntrypoint.includes("..") ||
    !drainLeasePattern.test(request.drainLeaseId) || request.token.length < 32 || request.token.length > 8192 || jsonBytes(request.input) > limits.inputBytes ||
    !Number.isSafeInteger(limits.cpuMilliCores) || limits.cpuMilliCores < 1 || limits.cpuMilliCores > dockerRunnerHardLimits.cpuMilliCores ||
    !Number.isSafeInteger(limits.memoryMiB) || limits.memoryMiB < 16 || limits.memoryMiB > dockerRunnerHardLimits.memoryMiB ||
    !Number.isSafeInteger(limits.processes) || limits.processes < 1 || limits.processes > dockerRunnerHardLimits.processes ||
    !Number.isSafeInteger(limits.openFiles) || limits.openFiles < 16 || limits.openFiles > dockerRunnerHardLimits.openFiles ||
    !Number.isSafeInteger(limits.tempBytes) || limits.tempBytes < 4096 || limits.tempBytes > dockerRunnerHardLimits.tempBytes ||
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNoFileLimit(value: unknown, expected: number): boolean {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).Name === "nofile" && (value as Record<string, unknown>).Soft === expected && (value as Record<string, unknown>).Hard === expected;
}

function isTerminalQuarantineReason(code: RunnerInvocationError["code"]): code is RunnerTerminalQuarantineReason {
  return ["INVOCATION_TIMEOUT", "OUTPUT_BUDGET_EXCEEDED", "PROTOCOL_VIOLATION", "CONTAINER_FAILED", "POLICY_VIOLATION"].includes(code);
}

function isDockerNotFound(error: unknown): error is DockerCommandError {
  return error instanceof DockerCommandError && /\bno such (?:container|object)\b/iu.test(error.stderr);
}

function isDockerNotRunning(error: unknown): error is DockerCommandError {
  return error instanceof DockerCommandError && /\bis not running\b/iu.test(error.stderr);
}

function safeStateValue(value: unknown): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^[a-z-]{1,32}$/u.test(value)) return value;
  return "unavailable";
}

function containerStateSummary(state: Record<string, unknown> | undefined): string {
  return `running=${safeStateValue(state?.Running)},status=${safeStateValue(state?.Status)},exitCode=${safeStateValue(state?.ExitCode)},oomKilled=${safeStateValue(state?.OOMKilled)}`;
}

function isTerminalContainerState(state: Record<string, unknown>): boolean {
  return state.Status === "exited" || state.Status === "dead" || state.Status === "removing" ||
    ((state.OOMKilled === true || (typeof state.ExitCode === "number" && state.ExitCode !== 0)) && state.Status !== "created");
}

function safeProcValue(value: string | undefined, pattern: RegExp): string {
  return value !== undefined && pattern.test(value) ? value : "unavailable";
}

function procReadFailure(file: "uid_map" | "status", error: unknown): string {
  return `proc-read-failed(file=${file},reason=${error instanceof Error && /\bENOENT\b/u.test(error.message) ? "enoent" : "other"})`;
}

export class DockerHotApplicationSandboxSupervisor {
  readonly isolationProfile?: DockerRunnerIsolationProfile;
  private readonly generations = new Map<string, GenerationState>();
  private readonly workloadUsers = new Map<number, string>();
  private startup?: Promise<number>;

  constructor(
    private readonly gateway: ExtensionCapabilityGateway,
    private readonly quarantineSink: RunnerQuarantineSink,
    private readonly authority: RunnerGenerationAuthority,
    private readonly observationSink: RunnerObservationSink,
    private readonly artifacts: VerifiedArtifactRunnerSource,
    private readonly isolationPolicy: DockerIsolationPolicy,
    private readonly image = extensionRunnerImage
  ) {
    if (image !== extensionRunnerImage) throw new TypeError("Runner image must match the approved Node release digest.");
    assertDockerSecurityPolicy(isolationPolicy);
    if (isolationPolicy.kind !== "local-docker-test-only") this.isolationProfile = createDockerRunnerIsolationProfile(isolationPolicy);
  }

  async invoke(request: RunnerInvocationRequest): Promise<unknown> {
    validateRequest(request);
    if (request.signal?.aborted) throw new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation was aborted.");
    const runnerIdentity = identity(request);
    await this.start();
    const state = this.state(runnerIdentity);
    if (state.quarantined) {
      const error = new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is quarantined.");
      error.cleanupFailed = await this.retryTerminalQuarantine(state);
      throw error;
    }
    const claims = this.gateway.assertInvocationIdentity(request.token, { ...runnerIdentity, invocationId: request.invocationId });
    if (claims.drainLeaseId !== request.drainLeaseId) throw new RunnerInvocationError("INVOCATION_INVALID", "Runner invocation drain lease does not match its token.");
    if (!await this.authority.admit(runnerIdentity, request.drainLeaseId)) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is not authoritatively admitted.");
    if (!state.accepting) throw new RunnerInvocationError("GENERATION_DRAINING", "Runner generation is draining.");
    if (state.active >= request.limits.maxConcurrency) throw new RunnerInvocationError("CONCURRENCY_EXHAUSTED", "Runner generation concurrency is exhausted.");
    state.active += 1;
    let resolved: ResolvedRunnerInvocation | undefined;
    let containerName: string | undefined;
    let result: unknown;
    let invocationError: RunnerInvocationError | undefined;
    try {
      let source: string;
      try { source = (await this.artifacts.load({ owner: { ...request.owner, generationId: request.generationId }, artifactDigest: request.artifactDigest, serverEntrypoint: request.serverEntrypoint })).source; } catch {
        throw new RunnerInvocationError("INVOCATION_INVALID", "Runner artifact identity is not present in the verified inventory.");
      }
      if (state.quarantined) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is quarantined.");
      if (!state.accepting) throw new RunnerInvocationError("GENERATION_DRAINING", "Runner generation is draining.");
      if (!await this.authority.admit(runnerIdentity, request.drainLeaseId)) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is not authoritatively admitted.");
      if (state.quarantined) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is quarantined.");
      if (!state.accepting) throw new RunnerInvocationError("GENERATION_DRAINING", "Runner generation is draining.");
      resolved = { ...request, ...runnerIdentity, source };
      containerName = `k-nex-${resolved.appId.replaceAll(".", "-")}-${resolved.generationId}-${randomUUID().slice(0, 8)}`.slice(0, 120);
      state.containers.add(containerName);
      result = await this.runContainer(resolved, containerName, state.workloadUser);
      if (state.quarantined) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation was quarantined while this invocation was running.");
    } catch (error) {
      const normalized = error instanceof RunnerInvocationError ? error : new RunnerInvocationError("CONTAINER_FAILED", "Runner container failed.");
      state.failures += 1;
      const quarantineReason = isTerminalQuarantineReason(normalized.code) ? normalized.code : normalized.cleanupFailed ? "CONTAINER_FAILED" : undefined;
      if (resolved && containerName && quarantineReason) {
        state.quarantined = true;
        state.accepting = false;
        const containmentFailed = await this.quarantineGeneration(state, resolved, quarantineReason, containerName);
        normalized.cleanupFailed ||= containmentFailed;
      }
      invocationError = normalized;
    } finally {
      state.active -= 1;
      if (resolved && containerName) {
        state.containers.delete(containerName);
        try { await this.observationSink.stopped(resolved, containerName); }
        catch {
          if (invocationError) invocationError.cleanupFailed = true;
          else invocationError = new RunnerInvocationError("CONTAINER_FAILED", "Runner container stop observation failed.");
        }
        if (!invocationError && state.quarantined) {
          invocationError = new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation was quarantined while this invocation was stopping.");
        }
      }
    }
    if (invocationError) throw invocationError;
    return result;
  }

  health(identity: RunnerGenerationIdentity): RunnerHealth {
    validateIdentity(identity);
    const state = this.state(identity);
    return Object.freeze({ accepting: state.accepting, activeInvocations: state.active, quarantined: state.quarantined, failures: state.failures });
  }

  /** No runner survives a supervisor restart: protocol state cannot be reattached safely. */
  async start(): Promise<number> {
    this.startup ??= this.reconcileStartupContainers();
    return this.startup;
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
      state = { accepting: true, active: 0, failures: 0, quarantined: false, workloadUser, containers: new Set(), invocations: new Map() };
      this.generations.set(key, state);
    }
    return state;
  }

  private runContainer(request: ResolvedRunnerInvocation, containerName: string, workloadUser: number): Promise<unknown> {
    const policyDirectory = mkdtempSync(join(tmpdir(), "k-nex-runner-seccomp-"));
    const seccompPath = join(policyDirectory, "policy.json");
    writeFileSync(seccompPath, runnerSeccompProfile, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const isolationOptions = this.isolationPolicy.kind === "apparmor"
      ? ["--security-opt", `apparmor=${this.isolationPolicy.profile}`]
      : [];
    const args = [
      "run", "-i", "--name", containerName,
      "--label", "k-nex.runner=hot-application-v1", "--label", `k-nex.application=${request.applicationId}`, "--label", `k-nex.environment=${request.environment}`, "--label", `k-nex.app=${request.appId}`, "--label", `k-nex.generation=${request.generationId}`,
      "--network", "none", "--read-only", "--user", `${workloadUser}:${workloadUser}`, "--workdir", "/tmp",
      "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${request.limits.tempBytes},mode=700,uid=${workloadUser},gid=${workloadUser}`,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--security-opt", `seccomp=${seccompPath}`, ...isolationOptions, "--pids-limit", String(request.limits.processes),
      "--memory", `${request.limits.memoryMiB}m`, "--memory-swap", `${request.limits.memoryMiB}m`, "--cpus", String(request.limits.cpuMilliCores / 1000),
      "--ulimit", `nofile=${request.limits.openFiles}:${request.limits.openFiles}`, "--env", "HOME=/tmp", "--env", "NODE_NO_WARNINGS=1", "--entrypoint", "node",
      this.image, "--permission", "--experimental-vm-modules", "-e", runnerServiceSource
    ];
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    return this.exchange(child, request, containerName, workloadUser, () => rmSync(policyDirectory, { recursive: true, force: true }));
  }

  private exchange(child: ChildProcessWithoutNullStreams, request: ResolvedRunnerInvocation, containerName: string, workloadUser: number, cleanup: () => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const state = this.state(request);
      const invocationKey = `${containerName}\0${request.invocationId}`;
      let registered = false;
      const unregister = () => {
        if (!registered) return;
        registered = false;
        state.invocations.delete(invocationKey);
      };
      let closed = false;
      let resolveClose!: () => void;
      const close = new Promise<void>((resolveClosePromise) => { resolveClose = resolveClosePromise; });
      let protocolBytes = 0;
      let logBytes = 0;
      let stderr = "";
      const controller = new AbortController();
      let terminal: { value: unknown } | { error: RunnerInvocationError } | undefined;
      let acceptingFrames = true;
      let policyInspected = false;
      let invokeSent = false;
      let invokeAcknowledged = false;
      let exitObserved = false;
      let startupInspection: Promise<void> | undefined;
      let startupInspectionError: RunnerInvocationError | undefined;
      let capabilityQueue = Promise.resolve();
      const acceptedCapabilities = new Set<Promise<void>>();
      let reaping: Promise<void> | undefined;
      let cleaned = false;
      const cleanupOnce = () => {
        if (cleaned) return;
        cleaned = true;
        cleanup();
      };
      const startupUnavailable = (message: string) => new RunnerInvocationError("POLICY_UNAVAILABLE", message);
      const fail = (error: RunnerInvocationError) => {
        if (invokeAcknowledged && isTerminalQuarantineReason(error.code)) this.publishTerminalQuarantine(state, request, error.code, containerName);
        settle({ error });
      };
      const write = (frame: unknown): boolean => {
        if (!acceptingFrames || controller.signal.aborted || child.stdin.destroyed || !child.stdin.writable) return false;
        try {
          child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
            if (error && !controller.signal.aborted) fail(invokeAcknowledged
              ? new RunnerInvocationError("CONTAINER_FAILED", "Runner stdin could not accept a protocol frame.")
              : startupUnavailable("Runner stdin closed before acknowledging the invocation."));
          });
          return true;
        } catch {
          if (!controller.signal.aborted) fail(invokeAcknowledged
            ? new RunnerInvocationError("CONTAINER_FAILED", "Runner stdin could not accept a protocol frame.")
            : startupUnavailable("Runner stdin closed before acknowledging the invocation."));
          return false;
        }
      };
      const settle = (result: { readonly value: unknown } | { readonly error: RunnerInvocationError }) => {
        if (terminal) return;
        terminal = result;
        unregister();
        acceptingFrames = false;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        controller.abort();
        try { child.stdin.end(); } catch { /* The child is being reaped below. */ }
        reaping ??= (async () => {
          let cleanupFailed = false;
          try {
            if (!closed) {
              child.kill("SIGKILL");
              await close;
            }
            await this.kill(containerName);
          } catch {
            cleanupFailed = true;
          } finally {
            try { cleanupOnce(); } catch { cleanupFailed = true; }
          }
          if (cleanupFailed) throw new RunnerInvocationError("CONTAINER_FAILED", "Runner container could not be forcibly terminated.");
        })();
        // A terminal error must not wait for a gateway implementation that ignores abort.
        void Promise.allSettled([reaping]).then((settled) => {
          const final = terminal!;
          if (settled.at(-1)?.status === "rejected") {
            if ("error" in final) {
              final.error.cleanupFailed = true;
              reject(final.error);
            } else reject(new RunnerInvocationError("CONTAINER_FAILED", "Runner container could not be forcibly terminated."));
            return;
          }
          "error" in final ? reject(final.error) : resolve(final.value);
        });
      };
      const finish = (value: unknown) => settle({ value });
      state.invocations.set(invocationKey, {
        containerName,
        cancel: () => fail(new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation was quarantined while this invocation was running."))
      });
      registered = true;
      const abort = () => fail(invokeAcknowledged
        ? new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation was aborted.")
        : startupUnavailable("Runner invocation aborted before the runner acknowledged source handoff."));
      request.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => fail(invokeAcknowledged
        ? new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation exceeded its wall-time budget.")
        : startupUnavailable("Runner invocation timed out before the runner acknowledged source handoff.")), request.limits.wallTimeMs);
      child.on("error", () => { if (!terminal && !exitObserved) fail(new RunnerInvocationError("RUNNER_UNAVAILABLE", "Docker runner is unavailable.")); });
      child.stdin.on("error", () => { if (!terminal && !exitObserved) fail(invokeAcknowledged
        ? new RunnerInvocationError("CONTAINER_FAILED", "Runner stdin could not accept a protocol frame.")
        : startupUnavailable("Runner stdin closed before acknowledging the invocation.")); });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (!terminal && Buffer.byteLength(stderr) > request.limits.logBytes) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner stderr exceeded its log budget."));
      });
      child.stdout.on("data", (chunk: Buffer) => {
        protocolBytes += chunk.byteLength;
        if (!terminal && protocolBytes > request.limits.outputBytes + request.limits.logBytes + 1_048_576) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner protocol output exceeded its budget."));
      });
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity, terminal: false });
      const queueCapability = (frame: RunnerFrame) => {
        const run = async () => {
          if (controller.signal.aborted || state.quarantined) return;
          try {
            if (controller.signal.aborted || state.quarantined) return;
            const output = await this.gateway.invoke({ token: frame.token!, invocationId: request.invocationId, generationId: request.generationId, sequence: frame.sequence!, capability: frame.capability as ExtensionCapabilityId, payload: frame.payload, signal: controller.signal });
            if (!controller.signal.aborted && !state.quarantined) write({ type: "capability-response", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, sequence: frame.sequence, ok: true, output, error: null });
          } catch (error) {
            if (!controller.signal.aborted && !state.quarantined) {
              const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "CAPABILITY_FAILED";
              write({ type: "capability-response", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, sequence: frame.sequence, ok: false, output: null, error: { code } });
            }
          }
        };
        const task = capabilityQueue.then(run, run).catch(() => { fail(new RunnerInvocationError("CONTAINER_FAILED", "Runner capability queue failed.")); });
        capabilityQueue = task;
        acceptedCapabilities.add(task);
        void task.then(() => { acceptedCapabilities.delete(task); });
      };
      const valid = (frame: unknown): frame is RunnerFrame => typeof frame === "object" && frame !== null && !Array.isArray(frame);
      lines.on("line", (line) => {
        let frame: unknown;
        try { frame = JSON.parse(line); } catch { fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted malformed JSON.")); return; }
        if (!valid(frame)) { fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted an invalid protocol frame.")); return; }
        if (!acceptingFrames) {
          if (terminal && "value" in terminal && (frame as RunnerFrame).type === "result") {
            terminal = { error: new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted a duplicate terminal frame.") };
          }
          return;
        }
        if (state.quarantined) {
          fail(new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation was quarantined while this invocation was running."));
          return;
        }
        if (frame.type === "invoke-ack" && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId"]) && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId) {
          if (!invokeSent || invokeAcknowledged) fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted an invalid invocation acknowledgement."));
          else invokeAcknowledged = true;
          return;
        }
        if (!invokeAcknowledged) {
          fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted a protocol frame before acknowledging the invocation."));
          return;
        }
        if (frame.type === "log" && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "text"]) && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId && typeof frame.text === "string") {
          logBytes += Buffer.byteLength(frame.text);
          if (logBytes > request.limits.logBytes) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner logs exceeded their budget."));
          return;
        }
        if (frame.type === "capability-request" && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "sequence", "capability", "payload", "token"]) && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId && frame.token === request.token && Number.isSafeInteger(frame.sequence) && typeof frame.capability === "string") {
          queueCapability(frame);
          return;
        }
        if (frame.type === "result" && frame.schemaVersion === 1 && frame.invocationId === request.invocationId && frame.generationId === request.generationId) {
          if (acceptedCapabilities.size > 0) { fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted a terminal frame before accepted capability calls settled.")); return; }
          if (frame.ok === true && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "ok", "output"])) {
            try {
              if (jsonBytes(frame.output) > request.limits.outputBytes) fail(new RunnerInvocationError("OUTPUT_BUDGET_EXCEEDED", "Runner result exceeded its output budget.")); else finish(frame.output);
            } catch (error) { fail(error instanceof RunnerInvocationError ? error : new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted an invalid result.")); }
            return;
          }
          if (frame.ok === false && exactKeys(frame, ["type", "schemaVersion", "invocationId", "generationId", "ok", "error"]) && typeof frame.error === "object" && frame.error !== null && !Array.isArray(frame.error) && exactKeys(frame.error as RunnerFrame, ["code"]) && frame.error.code === "APPLICATION_FAILED") {
            fail(new RunnerInvocationError("APPLICATION_FAILED", "Hot Application invocation failed."));
            return;
          }
        }
        fail(new RunnerInvocationError("PROTOCOL_VIOLATION", "Runner emitted an invalid protocol frame."));
      });
      child.once("spawn", () => {
        void (async () => {
          try {
            startupInspection = this.inspectSecurity(containerName, request.limits, workloadUser);
            await startupInspection;
          } catch (error) {
            startupInspectionError = error instanceof RunnerInvocationError ? error : new RunnerInvocationError("CONTAINER_FAILED", "Runner container observation failed.");
            if (controller.signal.aborted) return;
            fail(startupInspectionError);
            return;
          }
          if (controller.signal.aborted) return;
          policyInspected = true;
          try { await this.observationSink.started(request, containerName); }
          catch { fail(startupUnavailable("Runner start observation did not complete before source handoff.")); return; }
          if (controller.signal.aborted) return;
          invokeSent = write({ type: "invoke", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, token: request.token, source: request.source, input: request.input, maxInputBytes: request.limits.inputBytes, maxOutputBytes: request.limits.outputBytes });
        })();
      });
      child.once("close", (code) => {
        closed = true;
        resolveClose();
        controller.abort();
        if (!terminal) {
          acceptingFrames = false;
          exitObserved = true;
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", abort);
          if (!policyInspected || !invokeSent || !invokeAcknowledged) {
            const closedBeforeHandoff = () => !terminal && fail(startupInspectionError ?? new RunnerInvocationError("POLICY_UNAVAILABLE", `Docker closed before the runner security policy and source handoff were established (exitCode=${safeStateValue(code)}).`));
            startupInspection ? void startupInspection.then(closedBeforeHandoff, closedBeforeHandoff) : closedBeforeHandoff();
            return;
          }
          void this.observedPolicyViolation(containerName).then((policyViolation) => {
            if (terminal) return;
            fail(new RunnerInvocationError(code === 0 ? "PROTOCOL_VIOLATION" : policyViolation ? "POLICY_VIOLATION" : "CONTAINER_FAILED", code === 0 ? "Runner exited without a result." : policyViolation ? "Runner was terminated by the enforced isolation policy." : "Runner container exited unsuccessfully."));
          }, () => {
            if (!terminal) fail(new RunnerInvocationError(code === 0 ? "PROTOCOL_VIOLATION" : "CONTAINER_FAILED", code === 0 ? "Runner exited without a result." : "Runner container exited unsuccessfully."));
          });
        }
      });
    });
  }

  private async inspectSecurity(containerName: string, limits: RunnerInvocationLimits, workloadUser: number): Promise<void> {
    let inspected: Record<string, unknown>;
    try { inspected = await this.inspectRunningContainer(containerName); }
    catch { throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not expose the launched container security state."); }
    const host = isRecord(inspected.HostConfig) ? inspected.HostConfig : undefined;
    const config = isRecord(inspected.Config) ? inspected.Config : undefined;
    const unavailable = (message: string): never => { throw new RunnerInvocationError("POLICY_UNAVAILABLE", message); };
    if (!host || !config) throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not expose the container configuration.");
    if (host.NetworkMode !== "none" || host.ReadonlyRootfs !== true || host.Privileged !== false || host.PidsLimit !== limits.processes || host.Memory !== limits.memoryMiB * 1024 * 1024 || host.MemorySwap !== limits.memoryMiB * 1024 * 1024 || host.NanoCpus !== limits.cpuMilliCores * 1_000_000) unavailable("Docker did not apply the required network, root, privilege, or cgroup controls.");
    if (!Array.isArray(host.CapDrop) || host.CapDrop.length !== 1 || host.CapDrop[0] !== "ALL" || !(host.CapAdd === null || (Array.isArray(host.CapAdd) && host.CapAdd.length === 0))) unavailable("Docker did not drop every Linux capability.");
    if ((host.Binds != null && (!Array.isArray(host.Binds) || host.Binds.length !== 0)) || !Array.isArray(inspected.Mounts) || inspected.Mounts.some((mount) => !isRecord(mount) || mount.Type !== "tmpfs" || mount.Destination !== "/tmp")) unavailable("Docker exposed an unexpected mount.");
    const tmpfs = isRecord(host.Tmpfs) ? host.Tmpfs : undefined;
    const tmpSetting = tmpfs?.["/tmp"];
    const expectedTmpfs = new Set(["rw", "noexec", "nosuid", "nodev", `size=${limits.tempBytes}`, "mode=700", `uid=${workloadUser}`, `gid=${workloadUser}`]);
    const tmpfsControls = typeof tmpSetting === "string" ? tmpSetting.split(",") : [];
    if (tmpfsControls.length !== expectedTmpfs.size || new Set(tmpfsControls).size !== expectedTmpfs.size || tmpfsControls.some((control) => !expectedTmpfs.has(control))) unavailable("Docker did not apply the bounded temporary filesystem.");
    const env = config.Env;
    const allowedEnvironment = new Set(["HOME=/tmp", "NODE_NO_WARNINGS=1", "NODE_VERSION=24.19.0", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "YARN_VERSION=1.22.22"]);
    if (!Array.isArray(env) || !env.includes("HOME=/tmp") || !env.includes("NODE_NO_WARNINGS=1") || env.some((entry) => typeof entry !== "string" || !allowedEnvironment.has(entry))) unavailable("Docker exposed an unexpected runner environment.");
    const ulimits = host.Ulimits;
    if (!Array.isArray(ulimits) || ulimits.length !== 1 || !isNoFileLimit(ulimits[0], limits.openFiles)) unavailable("Docker did not apply the open-file limit.");
    const securityOptions = host.SecurityOpt;
    const options = isStringArray(securityOptions) ? securityOptions : unavailable("Docker did not expose valid security options.");
    if (!options.includes("no-new-privileges=true") || !options.includes(`seccomp=${runnerSeccompProfile}`)) {
      throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the required custom seccomp policy.");
    }
    if (this.isolationPolicy.kind === "apparmor" && (!options.includes(`apparmor=${this.isolationPolicy.profile}`) || inspected.AppArmorProfile !== this.isolationPolicy.profile)) {
      throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the required AppArmor profile.");
    }
    if (config?.User !== `${workloadUser}:${workloadUser}` || config.WorkingDir !== "/tmp" || config.Image !== this.image) throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the generation-specific non-root identity.");
    if (this.isolationPolicy.kind === "local-docker-test-only") {
      const operatingSystem = await this.dockerOperatingSystem();
      if (operatingSystem !== this.isolationPolicy.operatingSystem || host.UsernsMode === "host") {
        throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker Desktop did not provide the bounded local test container boundary.");
      }
      return;
    }
    let lastObservation = "inspect-failed";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let effective: Record<string, unknown>;
      try { effective = await this.inspectContainerOnce(containerName); }
      catch { lastObservation = "inspect-failed"; if (attempt < 49) await this.waitForSecurityStatus(); continue; }
      const state = isRecord(effective.State) ? effective.State : undefined;
      if (!state) {
        lastObservation = "state-unavailable";
      } else if (state.Running === false && isTerminalContainerState(state)) {
        unavailable(`Host could not verify the effective container security state (${containerStateSummary(state)}).`);
      } else if (state.Running === false) {
        lastObservation = `container-not-running(${containerStateSummary(state)})`;
      } else {
        const pid = state.Pid;
        if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
          lastObservation = "container-pid-unavailable";
        } else {
          let uidMap: string;
          try { uidMap = this.readProcFile(`/proc/${pid}/uid_map`); }
          catch (error) { lastObservation = procReadFailure("uid_map", error); if (attempt < 49) await this.waitForSecurityStatus(); continue; }
          let status: string;
          try { status = this.readProcFile(`/proc/${pid}/status`); }
          catch (error) { lastObservation = procReadFailure("status", error); if (attempt < 49) await this.waitForSecurityStatus(); continue; }
          if (!/^\s*0\s+[1-9][0-9]*\s+[1-9][0-9]*\s*$/mu.test(uidMap)) {
            lastObservation = "uid-map-mismatch";
          } else {
            const proc = new Map<string, string>();
            for (const line of status.split("\n")) {
              const match = /^(CapEff|NoNewPrivs|Seccomp):\s*(\S+)\s*$/u.exec(line);
              if (match) proc.set(match[1]!, match[2]!);
            }
            const capEff = safeProcValue(proc.get("CapEff"), /^[0-9a-f]{1,32}$/iu);
            const noNewPrivs = safeProcValue(proc.get("NoNewPrivs"), /^[0-9]{1,8}$/u);
            const seccomp = safeProcValue(proc.get("Seccomp"), /^[0-9]{1,8}$/u);
            if (/^0+$/u.test(proc.get("CapEff") ?? "") && proc.get("NoNewPrivs") === "1" && proc.get("Seccomp") === "2") return;
            lastObservation = `effective-tuple(capEff=${capEff},noNewPrivs=${noNewPrivs},seccomp=${seccomp})`;
          }
        }
      }
      if (attempt < 49) await this.waitForSecurityStatus();
    }
    unavailable(`Host could not verify the effective container security state (${lastObservation}).`);
  }

  private readProcFile(path: string): string {
    return readFileSync(path, "utf8");
  }

  private waitForSecurityStatus(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  private async observedPolicyViolation(containerName: string): Promise<boolean> {
    const inspected = await this.dockerJson(["inspect", containerName]);
    if (!Array.isArray(inspected) || !isRecord(inspected[0]) || !isRecord(inspected[0].State)) return false;
    // SCMP_ACT_KILL_PROCESS makes a forbidden syscall terminate the workload with SIGSYS.
    return inspected[0].State.ExitCode === 128 + 31;
  }

  private async retryTerminalQuarantine(state: GenerationState): Promise<boolean> {
    const quarantine = state.terminalQuarantine;
    if (!quarantine) return false;
    const durable = quarantine.durable ??= Promise.resolve().then(() => this.quarantineSink.quarantine(quarantine.identity, quarantine.reason));
    const result = await Promise.allSettled([durable]);
    if (result[0]!.status === "fulfilled") return false;
    if (quarantine.durable === durable) delete quarantine.durable;
    return true;
  }

  private async quarantineGeneration(state: GenerationState, identity: RunnerGenerationIdentity, reason: RunnerTerminalQuarantineReason, currentContainer: string): Promise<boolean> {
    this.publishTerminalQuarantine(state, identity, reason, currentContainer);
    const [durableFailed, containment] = await Promise.all([
      this.retryTerminalQuarantine(state),
      Promise.allSettled([...state.containers].filter((name) => name !== currentContainer).map((name) => this.kill(name)))
    ]);
    return durableFailed || containment.some((result) => result.status === "rejected");
  }

  private publishTerminalQuarantine(state: GenerationState, identity: RunnerGenerationIdentity, reason: RunnerTerminalQuarantineReason, currentContainer: string): void {
    state.quarantined = true;
    state.accepting = false;
    state.terminalQuarantine ??= {
      identity: {
        applicationId: identity.applicationId,
        environment: identity.environment,
        appId: identity.appId,
        generationId: identity.generationId
      },
      reason
    };
    for (const { containerName, cancel } of state.invocations.values()) if (containerName !== currentContainer) cancel();
  }

  private async inspectRunningContainer(containerName: string): Promise<Record<string, unknown>> {
    let error: unknown;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { return await this.inspectContainerOnce(containerName); }
      catch (caught) { error = caught; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw error ?? new Error("container inspect unavailable");
  }

  private async inspectContainerOnce(containerName: string): Promise<Record<string, unknown>> {
    const value = await this.dockerJson(["inspect", containerName]);
    if (Array.isArray(value) && value[0] && typeof value[0] === "object") return value[0] as Record<string, unknown>;
    throw new Error("container inspect unavailable");
  }

  private async reconcileStartupContainers(): Promise<number> {
    const output = await this.dockerOutput(["ps", "-aq", "--filter", "label=k-nex.runner=hot-application-v1"]);
    const containers = output.split(/\s+/u).filter(Boolean);
    const cleanup = await Promise.allSettled(containers.map((containerName) => this.kill(containerName)));
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return containers.length;
  }

  private async dockerOperatingSystem(): Promise<string> {
    const value = await this.dockerOutput(["info", "--format", "{{.OperatingSystem}}"]);
    return value.trim();
  }

  private async dockerJson(args: readonly string[]): Promise<unknown> {
    return JSON.parse(await this.dockerOutput(args));
  }

  private dockerOutput(args: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", [...args], { stdio: ["ignore", "pipe", "pipe"] });
      const output: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", () => reject(new DockerCommandError(args, null, Buffer.concat(stderr).toString("utf8"))));
      child.once("close", (code) => code === 0 ? resolve(Buffer.concat(output).toString("utf8")) : reject(new DockerCommandError(args, code, Buffer.concat(stderr).toString("utf8"))));
    });
  }

  private async kill(containerName: string): Promise<void> {
    try { await this.dockerOutput(["kill", containerName]); }
    catch (error) {
      if (isDockerNotFound(error)) return;
      if (!isDockerNotRunning(error)) throw error;
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { await this.dockerOutput(["rm", "-f", containerName]); return; }
      catch (error) {
        if (isDockerNotFound(error)) return;
        try { await this.dockerJson(["inspect", containerName]); }
        catch (inspectError) {
          if (isDockerNotFound(inspectError)) return;
          throw inspectError;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw new Error("docker container remained after forced termination");
  }
}

export { runnerServiceSource } from "./service-source.js";
export { createDockerRunnerIsolationProfile, dockerRunnerHardLimits, type DockerRunnerIsolationProfile } from "./isolation-profile.js";
export {
  dockerAppArmorPolicy,
  dockerIsolationPolicyFromEnvironment,
  localDockerTestIsolationPolicy,
  runnerAppArmorProfile,
  runnerAppArmorProfileDigest,
  runnerAppArmorProfileName,
  runnerSeccompProfile,
  runnerSeccompProfileDigest,
  type DockerIsolationPolicy
} from "./policy.js";
