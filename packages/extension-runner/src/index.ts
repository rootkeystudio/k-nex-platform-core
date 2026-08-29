import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { VerifiedArtifactOwner, VerifiedArtifactRunnerSource } from "@k-nex/extension-bundler";
import type { ExtensionCapabilityGateway, ExtensionCapabilityId } from "@k-nex/runtime";

import { assertDockerSecurityPolicy, defaultDockerIsolationPolicy, runnerSeccompProfile, type DockerIsolationPolicy } from "./policy.js";
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

export type RunnerTerminalQuarantineReason = "INVOCATION_TIMEOUT" | "OUTPUT_BUDGET_EXCEEDED" | "PROTOCOL_VIOLATION" | "CONTAINER_FAILED" | "POLICY_UNAVAILABLE";

export interface RunnerQuarantineSink {
  quarantine(identity: RunnerGenerationIdentity, reason: RunnerTerminalQuarantineReason): void | Promise<void>;
}

/** Durable inventory is the authority; container labels only locate candidates. */
export interface RunnerGenerationAuthority {
  active(identity: RunnerGenerationIdentity): Promise<boolean>;
}

export interface RunnerObservationSink {
  started(identity: RunnerGenerationIdentity, containerName: string): void | Promise<void>;
  stopped(identity: RunnerGenerationIdentity, containerName: string): void | Promise<void>;
}

export class RunnerInvocationError extends Error {
  constructor(readonly code: "RUNNER_UNAVAILABLE" | "GENERATION_DRAINING" | "GENERATION_QUARANTINED" | "CONCURRENCY_EXHAUSTED" | "INVOCATION_INVALID" | "INVOCATION_TIMEOUT" | "OUTPUT_BUDGET_EXCEEDED" | "PROTOCOL_VIOLATION" | "POLICY_UNAVAILABLE" | "CONTAINER_FAILED" | "APPLICATION_FAILED", message: string) {
    super(message);
    this.name = "RunnerInvocationError";
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
    request.token.length < 32 || request.token.length > 8192 || jsonBytes(request.input) > limits.inputBytes ||
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

function isNoFileLimit(value: unknown, expected: number): boolean {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).Name === "nofile" && (value as Record<string, unknown>).Soft === expected && (value as Record<string, unknown>).Hard === expected;
}

function isTerminalQuarantineReason(code: RunnerInvocationError["code"]): code is RunnerTerminalQuarantineReason {
  return ["INVOCATION_TIMEOUT", "OUTPUT_BUDGET_EXCEEDED", "PROTOCOL_VIOLATION", "CONTAINER_FAILED", "POLICY_UNAVAILABLE"].includes(code);
}

export class DockerHotApplicationSandboxSupervisor {
  private readonly generations = new Map<string, GenerationState>();
  private readonly workloadUsers = new Map<number, string>();
  private startup?: Promise<number>;

  constructor(
    private readonly gateway: ExtensionCapabilityGateway,
    private readonly quarantineSink: RunnerQuarantineSink,
    private readonly authority: RunnerGenerationAuthority,
    private readonly observationSink: RunnerObservationSink,
    private readonly artifacts: VerifiedArtifactRunnerSource,
    private readonly isolationPolicy: DockerIsolationPolicy = defaultDockerIsolationPolicy,
    private readonly image = extensionRunnerImage
  ) {
    if (!/^node:24\.19\.0-alpine@sha256:[0-9a-f]{64}$/u.test(image)) throw new TypeError("Runner image must be pinned to the approved Node release digest.");
    assertDockerSecurityPolicy(isolationPolicy);
  }

  async invoke(request: RunnerInvocationRequest): Promise<unknown> {
    validateRequest(request);
    if (request.signal?.aborted) throw new RunnerInvocationError("INVOCATION_TIMEOUT", "Runner invocation was aborted.");
    const runnerIdentity = identity(request);
    await this.start();
    if (!await this.authority.active(runnerIdentity)) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is not authoritatively active.");
    this.gateway.assertInvocationIdentity(request.token, { ...runnerIdentity, invocationId: request.invocationId });
    let source: string;
    try { source = (await this.artifacts.load({ owner: { ...request.owner, generationId: request.generationId }, artifactDigest: request.artifactDigest, serverEntrypoint: request.serverEntrypoint })).source; } catch {
      throw new RunnerInvocationError("INVOCATION_INVALID", "Runner artifact identity is not present in the verified inventory.");
    }
    const resolved = { ...request, ...runnerIdentity, source };
    const state = this.state(runnerIdentity);
    if (state.quarantined) throw new RunnerInvocationError("GENERATION_QUARANTINED", "Runner generation is quarantined.");
    if (!state.accepting) throw new RunnerInvocationError("GENERATION_DRAINING", "Runner generation is draining.");
    if (state.active >= request.limits.maxConcurrency) throw new RunnerInvocationError("CONCURRENCY_EXHAUSTED", "Runner generation concurrency is exhausted.");
    state.active += 1;
    const containerName = `k-nex-${resolved.appId.replaceAll(".", "-")}-${resolved.generationId}-${randomUUID().slice(0, 8)}`.slice(0, 120);
    state.containers.add(containerName);
    try {
      return await this.runContainer(resolved, containerName, state.workloadUser);
    } catch (error) {
      const normalized = error instanceof RunnerInvocationError ? error : new RunnerInvocationError("CONTAINER_FAILED", "Runner container failed.");
      state.failures += 1;
      if (isTerminalQuarantineReason(normalized.code)) {
        state.quarantined = true;
        state.accepting = false;
        await this.quarantineSink.quarantine(resolved, normalized.code);
      }
      throw normalized;
    } finally {
      state.active -= 1;
      state.containers.delete(containerName);
      await this.observationSink.stopped(resolved, containerName);
    }
  }

  health(identity: RunnerGenerationIdentity): RunnerHealth {
    validateIdentity(identity);
    const state = this.state(identity);
    return Object.freeze({ accepting: state.accepting, activeInvocations: state.active, quarantined: state.quarantined, failures: state.failures });
  }

  /** Reap only runner-marked containers whose exact generation is no longer durable authority. */
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
      state = { accepting: true, active: 0, failures: 0, quarantined: false, workloadUser, containers: new Set() };
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
      : this.isolationPolicy.kind === "selinux" ? ["--security-opt", this.isolationPolicy.label] : [];
    const args = [
      "run", "--rm", "-i", "--name", containerName,
      "--label", "k-nex.runner=hot-application-v1", "--label", `k-nex.application=${request.applicationId}`, "--label", `k-nex.environment=${request.environment}`, "--label", `k-nex.app=${request.appId}`, "--label", `k-nex.generation=${request.generationId}`,
      "--network", "none", "--read-only", "--user", `${workloadUser}:${workloadUser}`, "--workdir", "/tmp",
      "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${request.limits.tempBytes},mode=700,uid=${workloadUser},gid=${workloadUser}`,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--security-opt", `seccomp=${seccompPath}`, ...isolationOptions, "--pids-limit", String(request.limits.processes),
      "--memory", `${request.limits.memoryMiB}m`, "--memory-swap", `${request.limits.memoryMiB}m`, "--cpus", String(request.limits.cpuMilliCores / 1000),
      "--ulimit", `nofile=${request.limits.openFiles}:${request.limits.openFiles}`, "--env", "HOME=/tmp", "--env", "NODE_NO_WARNINGS=1",
      this.image, "node", "--permission", "--experimental-vm-modules", "-e", runnerServiceSource
    ];
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    return this.exchange(child, request, containerName, workloadUser, () => rmSync(policyDirectory, { recursive: true, force: true }));
  }

  private exchange(child: ChildProcessWithoutNullStreams, request: ResolvedRunnerInvocation, containerName: string, workloadUser: number, cleanup: () => void): Promise<unknown> {
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
        void this.kill(containerName).then(
          () => { cleanup(); reject(error); },
          () => { cleanup(); reject(new RunnerInvocationError("CONTAINER_FAILED", "Runner container could not be forcibly terminated.")); }
        );
      };
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        child.stdin.end();
        void this.kill(containerName).then(
          () => { cleanup(); resolve(value); },
          () => { cleanup(); reject(new RunnerInvocationError("CONTAINER_FAILED", "Runner container could not be forcibly terminated.")); }
        );
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
        Promise.resolve(this.inspectSecurity(containerName, request.limits, workloadUser)).then(() => this.observationSink.started(request, containerName)).then(() => {
          child.stdin.write(`${JSON.stringify({ type: "invoke", schemaVersion: 1, invocationId: request.invocationId, generationId: request.generationId, token: request.token, source: request.source, input: request.input, maxInputBytes: request.limits.inputBytes, maxOutputBytes: request.limits.outputBytes })}\n`);
        }).catch((error) => fail(error instanceof RunnerInvocationError ? error : new RunnerInvocationError("CONTAINER_FAILED", "Runner container observation failed.")));
      });
      child.once("close", (code) => {
        controller.abort();
        if (!settled) {
          const policyFailure = /(?:apparmor|selinux|seccomp|user\s*namespace|userns)/iu.test(stderr);
          fail(new RunnerInvocationError(code === 0 ? "PROTOCOL_VIOLATION" : policyFailure ? "POLICY_UNAVAILABLE" : "CONTAINER_FAILED", code === 0 ? "Runner exited without a result." : policyFailure ? "Docker could not apply the required isolation policy." : "Runner container exited unsuccessfully."));
        }
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

  private async inspectSecurity(containerName: string, limits: RunnerInvocationLimits, workloadUser: number): Promise<void> {
    let inspected: Record<string, unknown>;
    try { inspected = await this.inspectRunningContainer(containerName); }
    catch { throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not expose the launched container security state."); }
    const host = inspected.HostConfig as Record<string, unknown> | undefined;
    const config = inspected.Config as Record<string, unknown> | undefined;
    const unavailable = (message: string): never => { throw new RunnerInvocationError("POLICY_UNAVAILABLE", message); };
    if (!host || !config) throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not expose the container configuration.");
    if (host.NetworkMode !== "none" || host.ReadonlyRootfs !== true || host.Privileged === true || host.PidsLimit !== limits.processes || host.Memory !== limits.memoryMiB * 1024 * 1024 || host.MemorySwap !== limits.memoryMiB * 1024 * 1024 || host.NanoCpus !== limits.cpuMilliCores * 1_000_000) unavailable("Docker did not apply the required network, root, privilege, or cgroup controls.");
    if (!Array.isArray(host.CapDrop) || host.CapDrop.length !== 1 || host.CapDrop[0] !== "ALL" || (Array.isArray(host.CapAdd) && host.CapAdd.length > 0)) unavailable("Docker did not drop every Linux capability.");
    if ((host.Binds != null && (!Array.isArray(host.Binds) || host.Binds.length !== 0)) || !Array.isArray(inspected.Mounts) || (inspected.Mounts as readonly Record<string, unknown>[]).some((mount) => mount.Type !== "tmpfs" || mount.Destination !== "/tmp")) unavailable("Docker exposed an unexpected mount.");
    const tmpfs = host.Tmpfs as Record<string, unknown> | undefined;
    const tmpSetting = tmpfs?.["/tmp"];
    if (typeof tmpSetting !== "string" || ![`size=${limits.tempBytes}`, "noexec", "nosuid", "nodev", `uid=${workloadUser}`, `gid=${workloadUser}`].every((control) => tmpSetting.includes(control))) unavailable("Docker did not apply the bounded temporary filesystem.");
    const env = config.Env;
    const allowedEnvironment = new Set(["HOME=/tmp", "NODE_NO_WARNINGS=1", "NODE_VERSION=24.19.0", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "YARN_VERSION=1.22.22"]);
    if (!Array.isArray(env) || !env.includes("HOME=/tmp") || !env.includes("NODE_NO_WARNINGS=1") || env.some((entry) => typeof entry !== "string" || !allowedEnvironment.has(entry))) unavailable("Docker exposed an unexpected runner environment.");
    const ulimits = host.Ulimits;
    if (!Array.isArray(ulimits) || ulimits.length !== 1 || !isNoFileLimit(ulimits[0], limits.openFiles)) unavailable("Docker did not apply the open-file limit.");
    const securityOptions = host.SecurityOpt;
    const options = Array.isArray(securityOptions) ? securityOptions : [];
    if (!options.includes("no-new-privileges=true") || !options.includes(`seccomp=${runnerSeccompProfile}`)) {
      throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the required custom seccomp policy.");
    }
    if (this.isolationPolicy.kind === "apparmor" && (!options.includes(`apparmor=${this.isolationPolicy.profile}`) || inspected.AppArmorProfile !== this.isolationPolicy.profile)) {
      throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the required AppArmor profile.");
    }
    if (this.isolationPolicy.kind === "selinux" && (!options.includes(this.isolationPolicy.label) || typeof inspected.ProcessLabel !== "string" || inspected.ProcessLabel.length === 0)) {
      throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the required SELinux label.");
    }
    if (config?.User !== `${workloadUser}:${workloadUser}` || config.WorkingDir !== "/tmp" || config.Image !== this.image) throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not apply the generation-specific non-root identity.");
    if (this.isolationPolicy.kind === "virtual-machine") {
      const operatingSystem = await this.dockerOperatingSystem();
      if (operatingSystem !== this.isolationPolicy.operatingSystem || host.UsernsMode === "host") {
        throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker Desktop did not provide the approved VM and container user boundary.");
      }
      return;
    }
    const state = inspected.State as Record<string, unknown> | undefined;
    const pid = state?.Pid;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker did not expose a running container PID for user-namespace verification.");
    let uidMap: string;
    try { uidMap = readFileSync(`/proc/${pid}/uid_map`, "utf8"); } catch { throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Host cannot verify the container user namespace."); }
    if (/^\s*0\s+0\s+/u.test(uidMap)) throw new RunnerInvocationError("POLICY_UNAVAILABLE", "Docker launched the runner without a remapped user namespace.");
  }

  private async inspectRunningContainer(containerName: string): Promise<Record<string, unknown>> {
    let error: unknown;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const value = await this.dockerJson(["inspect", containerName]);
        if (Array.isArray(value) && value[0] && typeof value[0] === "object") return value[0] as Record<string, unknown>;
      } catch (caught) { error = caught; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw error ?? new Error("container inspect unavailable");
  }

  private async reconcileStartupContainers(): Promise<number> {
    const output = await this.dockerOutput(["ps", "-aq", "--filter", "label=k-nex.runner=hot-application-v1"]);
    let terminated = 0;
    for (const containerName of output.split(/\s+/u).filter(Boolean)) {
      let labels: Record<string, unknown> | undefined;
      try {
        const inspected = await this.dockerJson(["inspect", containerName]) as unknown[];
        labels = (inspected[0] as { Config?: { Labels?: Record<string, unknown> } } | undefined)?.Config?.Labels;
      } catch {
        continue;
      }
      const runnerIdentity = {
        applicationId: labels?.["k-nex.application"],
        environment: labels?.["k-nex.environment"],
        appId: labels?.["k-nex.app"],
        generationId: labels?.["k-nex.generation"]
      };
      if (labels?.["k-nex.runner"] !== "hot-application-v1" || !Object.values(runnerIdentity).every((value) => typeof value === "string")) continue;
      try { validateIdentity(runnerIdentity as RunnerGenerationIdentity); } catch { continue; }
      if (!await this.authority.active(runnerIdentity as RunnerGenerationIdentity)) {
        await this.kill(containerName);
        terminated += 1;
      }
    }
    return terminated;
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
      const child = spawn("docker", [...args], { stdio: ["ignore", "pipe", "ignore"] });
      const output: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(Buffer.concat(output).toString("utf8")) : reject(new Error("docker command failed")));
    });
  }

  private async kill(containerName: string): Promise<void> {
    try { await this.dockerOutput(["kill", containerName]); } catch { /* Docker may have already stopped --rm container. */ }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { await this.dockerOutput(["rm", "-f", containerName]); return; } catch {
        try { await this.dockerJson(["inspect", containerName]); }
        catch { return; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw new Error("docker container remained after forced termination");
  }
}

export { runnerServiceSource } from "./service-source.js";
export {
  defaultDockerIsolationPolicy,
  dockerAppArmorPolicy,
  dockerSelinuxPolicy,
  runnerAppArmorProfile,
  runnerAppArmorProfileDigest,
  runnerAppArmorProfileName,
  runnerSeccompProfile,
  runnerSeccompProfileDigest,
  runnerSelinuxLabel,
  runnerSelinuxPolicyDigest,
  runnerVirtualMachineBoundary,
  runnerVirtualMachineBoundaryDigest,
  type DockerIsolationPolicy
} from "./policy.js";
