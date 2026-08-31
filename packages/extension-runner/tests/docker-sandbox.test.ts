import { execFile as execFileCallback, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ArtifactVerifier, buildBundle, canonicalJson, CatalogClient, InMemoryCatalogCheckpointStore, sha256, type CatalogEntry, type SignedCatalog, VerifiedArtifactStore } from "@k-nex/extension-bundler";
import { ExtensionCapabilityGateway, HmacExtensionCapabilityTokens, InMemoryExtensionCapabilitySequenceStoreForTests, type ExtensionCapabilityHandler, type ExtensionCapabilitySequenceStore } from "@k-nex/runtime";
import { beforeAll, describe, expect, it } from "vitest";

import { DockerHotApplicationSandboxSupervisor, RunnerInvocationError, dockerAppArmorPolicy, dockerIsolationPolicyFromEnvironment, extensionRunnerImage, runnerAppArmorProfileName, runnerSeccompProfile, type RunnerGenerationIdentity, type RunnerInvocationLimits } from "../src/index.js";

const execFile = promisify(execFileCallback);
const clock = { now: () => new Date() };
const tokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(7), clock);
const extensionKeys = generateKeyPairSync("ed25519");
const extensionPublisher = { identity: "k-nex-extension-runner", publicKey: extensionKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const isolationPolicy = dockerIsolationPolicyFromEnvironment(process.env.K_NEX_RUNNER_ISOLATION_POLICY);
const catalogKeys = generateKeyPairSync("ed25519");
const catalogSigner = { identity: "k-nex-runner-catalog", publicKey: catalogKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
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

let catalogSequence = 0;
function signedCatalog(entry: CatalogEntry): SignedCatalog {
  const payload = { schemaVersion: 1 as const, sequence: ++catalogSequence, expiresAt: "2030-01-01T00:00:00.000Z", entries: [entry] };
  return { schemaVersion: 1, signer: catalogSigner, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), catalogKeys.privateKey).toString("base64") };
}

function artifactStore() {
  return new VerifiedArtifactStore(new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [extensionPublisher.identity]: extensionPublisher.publicKey }));
}

let sequence = 0;
async function request(store: VerifiedArtifactStore, generationId: string, source: string, options: Readonly<{ appId?: string; wallTimeMs?: number }> = {}) {
  sequence += 1;
  const invocationId = `runner-invocation-${sequence}`;
  const drainLeaseId = `lease-00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  const target = identity(generationId, options.appId);
  const manifest = {
    schemaVersion: 1 as const, deliveryClass: "hot-application" as const, id: target.appId, displayName: "Runner fixture", version: "1.0.0", runtimeAbi: "1.0.0",
    entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] },
    capabilities: [],
    resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 1_024, maxStorageBytes: 1_024, maxMemoryMiB: 64, maxCpuMilliCores: 250, maxWallTimeMs: 10_000, maxInputBytes: 8_192, maxOutputBytes: 8_192, maxLogBytes: 8_192, maxConcurrency: 2 },
    settings: [], screens: [{ id: "runner.screen", route: "/", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: [], localization: [], healthChecks: []
  };
  const releaseSource = { repository: "https://github.com/k-nex/runner-fixtures", commit: "0123456789abcdef0123456789abcdef01234567" };
  const bundle = buildBundle({ manifest, files: [
    { path: "server/main.mjs", bytes: Buffer.from(`export default ${source}`), contentType: "application/javascript" },
    { path: "ui/main.mjs", bytes: Buffer.from("export default () => null"), contentType: "application/javascript" }
  ], source: releaseSource, workflowIdentity: `${releaseSource.repository}/.github/workflows/release.yml@${releaseSource.commit}` });
  const entry: CatalogEntry = {
    deliveryClass: "hot-application", id: target.appId, version: "1.0.0", runtimeAbi: "1.0.0", publisher: extensionPublisher,
    source: { ...releaseSource, assetUrl: "https://github.com/k-nex/runner-fixtures/releases/download/v1.0.0/bundle.tar.gz" },
    artifactDigest: sha256(bundle.artifact), manifestDigest: sha256(Buffer.from(canonicalJson(bundle.manifest))), sbomDigest: sha256(bundle.sbom), provenanceDigest: sha256(bundle.provenance), support: "supported", review: "approved", security: "clear", revoked: false
  };
  const catalog = signedCatalog(entry);
  const owner = { applicationId: target.applicationId, environment: target.environment, deliveryClass: "hot-application" as const, extensionId: target.appId, generationId };
  const verified = await store.stageForOwner(owner, { catalog, artifact: bundle.artifact, provenance: bundle.provenance, deliveryClass: "hot-application", id: target.appId, version: "1.0.0", runtimeAbi: "1.0.0" });
  const token = tokens.issue({
    tokenId: `runner-token-${sequence}`, ...target, invocationId,
    actor: { principalId: "user:one", effectiveActorId: "user:one" }, correlationId: `runner-correlation-${sequence}`,
    drainLeaseId, grants: [{ kind: "records", required: true, reason: "Read fixture records.", operations: ["query"], resources: [{ id: "sales.tasks", version: 1 }] }], ttlMs: 30_000
  });
  return { owner: { applicationId: owner.applicationId, environment: owner.environment, deliveryClass: owner.deliveryClass, extensionId: owner.extensionId }, generationId, artifactDigest: verified.artifactDigest, serverEntrypoint: "server/main.mjs", invocationId, drainLeaseId, token, input: { marker: invocationId }, limits: { ...limits, ...(options.wallTimeMs === undefined ? {} : { wallTimeMs: options.wallTimeMs }) } };
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

function supervisor(observations: Record<string, Record<string, any>>, store: VerifiedArtifactStore, quarantines: string[] = [], started?: (identity: RunnerGenerationIdentity, name: string) => void, handler: ExtensionCapabilityHandler = queryHandler, sequences: ExtensionCapabilitySequenceStore = new InMemoryExtensionCapabilitySequenceStoreForTests(clock)) {
  const gateway = new ExtensionCapabilityGateway(tokens, { "records.query": handler }, { reauthorize: () => true }, sequences, clock, { maxInputBytes: 8_192, maxOutputBytes: 8_192, maxDepth: 12, maxCalls: 8 });
  return new DockerHotApplicationSandboxSupervisor(gateway, {
    quarantine(generation, reason) { quarantines.push(`${generation.generationId}:${reason}`); }
  }, {
    active() { return Promise.resolve(true); },
    admit() { return Promise.resolve(true); }
  }, {
    async started(generation, name) { observations[name] = await inspectContainer(name); started?.(generation, name); },
    stopped() {}
  }, store.runnerSource(), isolationPolicy);
}

beforeAll(async () => {
  await execFile("docker", ["version", "--format", "{{.Server.Version}}"]);
}, 30_000);

describe("production extension runner", () => {
  it("kills a real forbidden socket syscall under the pinned default-deny profile", async () => {
    const directory = mkdtempSync(join(tmpdir(), "k-nex-seccomp-proof-"));
    const profilePath = join(directory, "policy.json");
    const containerName = `k-nex-seccomp-proof-${randomUUID().slice(0, 8)}`;
    writeFileSync(profilePath, runnerSeccompProfile, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      await expect(execFile("docker", [
        "run", "--name", containerName, "--network", "none", "--read-only", "--user", "10000:10000", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges=true", "--security-opt", `seccomp=${profilePath}`, "--entrypoint", "node", extensionRunnerImage,
        "-e", "require('node:net').createServer().listen(0)"
      ])).rejects.toBeDefined();
      const inspected = await inspectContainer(containerName);
      expect(inspected.State).toMatchObject({ Running: false, ExitCode: 128 + 31 });
    } finally {
      await execFile("docker", ["rm", "-f", containerName]).catch(() => {});
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("causally quarantines once after an acknowledged real forbidden syscall", async () => {
    const quarantines: string[] = [];
    const store = artifactStore();
    const runner = supervisor({}, store, quarantines) as any;
    const originalObservedPolicyViolation = runner.observedPolicyViolation.bind(runner);
    let observedExitCode: number | undefined;
    runner.observedPolicyViolation = async (containerName: string) => {
      observedExitCode = (await inspectContainer(containerName)).State.ExitCode;
      return originalObservedPolicyViolation(containerName);
    };
    runner.runContainer = (invocation: any, containerName: string, workloadUser: number) => {
      const directory = mkdtempSync(join(tmpdir(), "k-nex-supervisor-seccomp-proof-"));
      const seccompPath = join(directory, "policy.json");
      writeFileSync(seccompPath, runnerSeccompProfile, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const isolationOptions = isolationPolicy.kind === "apparmor" ? ["--security-opt", `apparmor=${isolationPolicy.profile}`] : [];
      const child = spawn("docker", [
        "run", "-i", "--name", containerName,
        "--label", "k-nex.runner=hot-application-v1", "--label", `k-nex.application=${invocation.applicationId}`, "--label", `k-nex.environment=${invocation.environment}`, "--label", `k-nex.app=${invocation.appId}`, "--label", `k-nex.generation=${invocation.generationId}`,
        "--network", "none", "--read-only", "--user", `${workloadUser}:${workloadUser}`, "--workdir", "/tmp",
        "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${invocation.limits.tempBytes},mode=700,uid=${workloadUser},gid=${workloadUser}`,
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--security-opt", `seccomp=${seccompPath}`, ...isolationOptions, "--pids-limit", String(invocation.limits.processes),
        "--memory", `${invocation.limits.memoryMiB}m`, "--memory-swap", `${invocation.limits.memoryMiB}m`, "--cpus", String(invocation.limits.cpuMilliCores / 1000),
        "--ulimit", `nofile=${invocation.limits.openFiles}:${invocation.limits.openFiles}`, "--env", "HOME=/tmp", "--env", "NODE_NO_WARNINGS=1", "--entrypoint", "node",
        extensionRunnerImage, "-e", "process.stdin.once('data', chunk => { const frame = JSON.parse(chunk); process.stdout.write(JSON.stringify({ type: 'invoke-ack', schemaVersion: 1, invocationId: frame.invocationId, generationId: frame.generationId }) + '\\n'); setImmediate(() => require('node:net').createServer().listen(0)); });"
      ], { stdio: ["pipe", "pipe", "pipe"] });
      return runner.exchange(child, invocation, containerName, workloadUser, () => rmSync(directory, { recursive: true, force: true }));
    };

    await expect(runner.invoke(await request(store, "seccomp-quarantine-generation", "() => ({ ignored: true })"))).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    expect(observedExitCode).toBe(128 + 31);
    expect(quarantines).toEqual(["seccomp-quarantine-generation:POLICY_VIOLATION"]);
    expect(runner.health(identity("seccomp-quarantine-generation"))).toMatchObject({ accepting: false, quarantined: true });
  }, 30_000);

  it("refuses to send source when Docker inspection omits any required effective control", async () => {
    const runner = supervisor({}, artifactStore()) as any;
    const secure = {
      Config: { User: "10000:10000", WorkingDir: "/tmp", Image: extensionRunnerImage, Env: ["HOME=/tmp", "NODE_NO_WARNINGS=1"] },
      HostConfig: {
        NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], CapAdd: null, SecurityOpt: ["no-new-privileges=true", `seccomp=${runnerSeccompProfile}`],
        Binds: [], Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=1048576,mode=700,uid=10000,gid=10000" },
        PidsLimit: 32, Memory: 67_108_864, MemorySwap: 67_108_864, NanoCpus: 250_000_000,
        Ulimits: [{ Name: "nofile", Soft: 64, Hard: 64 }], UsernsMode: ""
      },
      Mounts: [], State: { Pid: 1 }
    };
    runner.dockerOperatingSystem = async () => "Docker Desktop";
    for (const mutate of [
      (value: any) => { value.HostConfig.NetworkMode = "bridge"; },
      (value: any) => { value.HostConfig.ReadonlyRootfs = false; },
      (value: any) => { value.HostConfig.CapDrop = []; },
      (value: any) => { value.HostConfig.CapAdd = "SYS_ADMIN"; },
      (value: any) => { value.HostConfig.Binds = ["/:/host:ro"]; },
      (value: any) => { value.Mounts = [{ Type: "bind", Source: "/", Destination: "/host" }]; },
      (value: any) => { value.HostConfig.Tmpfs = {}; },
      (value: any) => { value.HostConfig.Tmpfs["/tmp"] = "rw,noexec,nosuid,nodev,size=1048576,mode=755,uid=10000,gid=10000"; },
      (value: any) => { value.Config.Env.push("DATABASE_URL=postgres://host-secret"); },
      (value: any) => { value.Config.User = { uid: 10_000 }; },
      (value: any) => { value.HostConfig.SecurityOpt = "no-new-privileges=true"; },
      (value: any) => { value.HostConfig.PidsLimit = 0; },
      (value: any) => { value.HostConfig.Memory = 0; },
      (value: any) => { value.HostConfig.MemorySwap = 0; },
      (value: any) => { value.HostConfig.NanoCpus = 0; },
      (value: any) => { value.HostConfig.Ulimits = []; }
    ]) {
      const inspected = structuredClone(secure);
      mutate(inspected);
      runner.inspectRunningContainer = async () => inspected;
      await expect(runner.inspectSecurity("runner-control-test", limits, 10_000)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    }
  });

  it("fails closed when Linux inspection does not expose a numeric container PID", async () => {
    const runner = supervisor({}, artifactStore()) as any;
    runner.isolationPolicy = dockerAppArmorPolicy;
    runner.inspectRunningContainer = async () => ({
      Config: { User: "10000:10000", WorkingDir: "/tmp", Image: extensionRunnerImage, Env: ["HOME=/tmp", "NODE_NO_WARNINGS=1"] },
      HostConfig: {
        NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, CapDrop: ["ALL"], CapAdd: null,
        SecurityOpt: ["no-new-privileges=true", `seccomp=${runnerSeccompProfile}`, `apparmor=${runnerAppArmorProfileName}`],
        Binds: [], Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=1048576,mode=700,uid=10000,gid=10000" },
        PidsLimit: 32, Memory: 67_108_864, MemorySwap: 67_108_864, NanoCpus: 250_000_000,
        Ulimits: [{ Name: "nofile", Soft: 64, Hard: 64 }], UsernsMode: ""
      },
      Mounts: [], AppArmorProfile: runnerAppArmorProfileName, State: { Pid: "1" }
    });
    await expect(runner.inspectSecurity("runner-control-test", limits, 10_000)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });

  it("runs app generations with container authority and only declared host capabilities", async () => {
    const observations: Record<string, Record<string, any>> = {};
    const store = artifactStore();
    const runner = supervisor(observations, store);
    process.env.K_NEX_RUNNER_HOST_SECRET_PROBE = "must-not-enter-container";
    const source = `async ({ input, host }) => {
      let constructorEscape = "allowed";
      try { constructorEscape = ({}).constructor.constructor("return process")(); } catch { constructorEscape = "blocked"; }
      const authority = await host.call("records.query", input);
      let denied = "missing";
      try { await host.call("records.action", {}); } catch (error) { denied = error.message; }
      return { authority, denied, processType: typeof process, requireType: typeof require, fetchType: typeof fetch, constructorEscape, trustedResult: true };
    }`;
    const trusted = await request(store, "sales-generation-one", source);
    const result = await runner.invoke({ ...trusted, source: "export default () => ({ attacker: true })" } as typeof trusted & { source: string });
    expect(result).toMatchObject({
      authority: { applicationId: "customer-alpha", appId: "app.sales-assistant", generationId: "sales-generation-one" },
      denied: "CAPABILITY_DENIED", processType: "undefined", requireType: "undefined", fetchType: "undefined", constructorEscape: "blocked", trustedResult: true
    });
    await expect(runner.invoke(await request(store, "sales-generation-one", source))).resolves.toMatchObject({ trustedResult: true });

    const inspected = Object.values(observations)[0]!;
    expect(Number(inspected.Config.User.split(":")[0])).toBeGreaterThanOrEqual(10_000);
    expect(inspected.HostConfig).toMatchObject({ NetworkMode: "none", ReadonlyRootfs: true, PidsLimit: 32, Memory: 67_108_864, MemorySwap: 67_108_864, NanoCpus: 250_000_000 });
    expect(inspected.HostConfig.CapDrop).toContain("ALL");
    expect(inspected.HostConfig.SecurityOpt).toContain("no-new-privileges=true");
    expect(inspected.HostConfig.SecurityOpt).toContain(`seccomp=${runnerSeccompProfile}`);
    if (isolationPolicy.kind === "apparmor") {
      expect(inspected.HostConfig.SecurityOpt).toContain(`apparmor=${runnerAppArmorProfileName}`);
      expect(inspected.AppArmorProfile).toBe(runnerAppArmorProfileName);
    } else expect(inspected.AppArmorProfile).toBe("");
    expect(inspected.HostConfig.UsernsMode).not.toBe("host");
    expect(inspected.HostConfig.Binds ?? []).toEqual([]);
    expect(inspected.Mounts.every((mount: Record<string, unknown>) => mount.Type !== "bind")).toBe(true);
    expect(inspected.Config.Env.sort()).toEqual([
      "HOME=/tmp", "NODE_NO_WARNINGS=1", "NODE_VERSION=24.19.0",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "YARN_VERSION=1.22.22"
    ]);
    expect(inspected.Config.Env.join("\n")).not.toMatch(/K_NEX_RUNNER_HOST_SECRET_PROBE|DATABASE_URL|DOCKER_HOST|PAYLOAD_SECRET/u);
    expect(inspected.HostConfig.Tmpfs["/tmp"]).toContain("noexec");
  }, 120_000);

  it("waits for fire-and-forget and concurrent capability calls before returning", async () => {
    const store = artifactStore();
    const wireSequences: number[] = [];
    const recordedSequences = new InMemoryExtensionCapabilitySequenceStoreForTests(clock);
    const pending = new Map<string, { promise: Promise<unknown>; resolve(value: unknown): void }>();
    for (const call of ["fire-and-forget", "first", "second"]) {
      let resolve!: (value: unknown) => void;
      pending.set(call, { promise: new Promise((done) => { resolve = done; }), resolve });
    }
    const handler: ExtensionCapabilityHandler = {
      validateInput(value) { return value as { call: string }; },
      invoke(_claims, input) {
        const call = (input as { call: string }).call;
        const gate = pending.get(call);
        if (!gate) throw new Error(`Unknown Docker capability gate: ${call}`);
        return gate.promise;
      },
      validateOutput(value) { return value; }
    };
    const sequences: ExtensionCapabilitySequenceStore = {
      claim(claims, sequence, maxCalls) {
        wireSequences.push(sequence);
        return recordedSequences.claim(claims, sequence, maxCalls);
      }
    };
    const runner = supervisor({}, store, [], undefined, handler, sequences);
    const invocation = runner.invoke(await request(store, "capability-order-generation", `async ({ host }) => {
      host.call("records.query", { call: "fire-and-forget" });
      const [first, second] = await Promise.all([
        host.call("records.query", { call: "first" }),
        host.call("records.query", { call: "second" })
      ]);
      return { first, second };
    }`));
    let settled = false;
    void invocation.then(() => { settled = true; }, () => { settled = true; });

    try {
      await expect.poll(() => wireSequences, { timeout: 30_000 }).toEqual([1]);
      expect(settled).toBe(false);
      pending.get("fire-and-forget")!.resolve("fire");
      await expect.poll(() => wireSequences, { timeout: 5_000 }).toEqual([1, 2]);
      expect(settled).toBe(false);
      pending.get("first")!.resolve("first");
      await expect.poll(() => wireSequences, { timeout: 5_000 }).toEqual([1, 2, 3]);
      expect(settled).toBe(false);
      pending.get("second")!.resolve("second");
      await expect(invocation).resolves.toEqual({ first: "first", second: "second" });
    } finally {
      for (const call of pending.values()) call.resolve(null);
      await invocation.catch(() => {});
    }
  }, 120_000);

  it("rejects mixed token identity before starting a container and keeps app/generation responses isolated", async () => {
    const observations: Record<string, Record<string, any>> = {};
    const store = artifactStore();
    const runner = supervisor(observations, store);
    const first = await request(store, "sales-generation-two", `async ({ input, host }) => host.call("records.query", input)`);
    await expect(runner.invoke({ ...first, owner: { ...first.owner, extensionId: "app.forecast" } })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(Object.keys(observations)).toHaveLength(0);

    const [sales, forecast] = await Promise.all([
      runner.invoke(first),
      runner.invoke(await request(store, "forecast-generation-one", `async ({ input, host }) => host.call("records.query", input)`, { appId: "app.forecast" }))
    ]);
    expect(sales).toMatchObject({ appId: "app.sales-assistant", generationId: "sales-generation-two" });
    expect(forecast).toMatchObject({ appId: "app.forecast", generationId: "forecast-generation-one" });
    const workloadUsers = Object.values(observations).map((entry) => entry.Config.User);
    expect(new Set(workloadUsers).size).toBe(2);
  }, 120_000);

  it("quarantines only a timed-out generation and drains old work without affecting a sibling generation", async () => {
    const observations: Record<string, Record<string, any>> = {};
    const quarantines: string[] = [];
    const store = artifactStore();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const runner = supervisor(observations, store, quarantines, (generation) => { if (generation.generationId === "draining-generation-one") notifyStarted?.(); });

    await expect(runner.invoke(await request(store, "hung-generation-one", `() => { while (true) {} }`, { wallTimeMs: 5_000 }))).rejects.toMatchObject({ code: "INVOCATION_TIMEOUT" });
    expect(runner.health(identity("hung-generation-one"))).toMatchObject({ accepting: false, quarantined: true });
    expect(quarantines).toEqual(["hung-generation-one:INVOCATION_TIMEOUT"]);
    await expect(runner.invoke(await request(store, "healthy-generation-one", `({ input }) => input`))).resolves.toMatchObject({ marker: expect.any(String) });
    await expect(runner.invoke(await request(store, "crashed-generation-one", `() => { throw new Error("fixture crash"); }`))).rejects.toMatchObject({ code: "APPLICATION_FAILED" });
    await expect(runner.invoke(await request(store, "healthy-generation-two", `() => ({ stillHealthy: true })`))).resolves.toEqual({ stillHealthy: true });

    const oldWork = runner.invoke(await request(store, "draining-generation-one", `async () => new Promise(() => {})`));
    const oldWorkFailure = expect(oldWork).rejects.toBeInstanceOf(RunnerInvocationError);
    await started;
    await expect(runner.drain(identity("draining-generation-one"), 100)).resolves.toEqual({ graceful: false, terminated: 1 });
    await oldWorkFailure;
    await expect(runner.invoke(await request(store, "healthy-generation-three", `() => ({ healthy: true })`))).resolves.toEqual({ healthy: true });
  }, 120_000);

  it("contains an out-of-memory generation failure", async () => {
    const quarantines: string[] = [];
    const store = artifactStore();
    const runner = supervisor({}, store, quarantines);
    const exhaustMemory = `() => { const retained = []; while (true) { const block = new Uint8Array(4 * 1024 * 1024); block.fill(1); retained.push(block); } }`;
    await expect(runner.invoke(await request(store, "memory-generation-one", exhaustMemory))).rejects.toMatchObject({ code: "CONTAINER_FAILED" });
    expect(quarantines).toEqual(["memory-generation-one:CONTAINER_FAILED"]);
    await expect(runner.invoke(await request(store, "memory-sibling-one", `() => ({ healthy: true })`))).resolves.toEqual({ healthy: true });
  }, 120_000);
});
