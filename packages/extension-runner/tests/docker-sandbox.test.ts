import { execFile as execFileCallback } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { promisify } from "node:util";

import { ArtifactVerifier, buildBundle, canonicalJson, CatalogClient, InMemoryCatalogCheckpointStore, sha256, type CatalogEntry, type SignedCatalog, VerifiedArtifactStore } from "@k-nex/extension-bundler";
import { ExtensionCapabilityGateway, HmacExtensionCapabilityTokens, InMemoryExtensionCapabilitySequenceStoreForTests, type ExtensionCapabilityHandler } from "@k-nex/runtime";
import { beforeAll, describe, expect, it } from "vitest";

import { DockerHotApplicationSandboxSupervisor, RunnerInvocationError, extensionRunnerImage, runnerSeccompProfile, type RunnerGenerationIdentity, type RunnerInvocationLimits } from "../src/index.js";

const execFile = promisify(execFileCallback);
const clock = { now: () => new Date() };
const tokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(7), clock);
const extensionKeys = generateKeyPairSync("ed25519");
const extensionPublisher = { identity: "k-nex-extension-runner", publicKey: extensionKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
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

function supervisor(observations: Record<string, Record<string, any>>, store: VerifiedArtifactStore, quarantines: string[] = [], started?: (identity: RunnerGenerationIdentity, name: string) => void) {
  const gateway = new ExtensionCapabilityGateway(tokens, { "records.query": queryHandler }, { reauthorize: () => true }, new InMemoryExtensionCapabilitySequenceStoreForTests(clock), clock, { maxInputBytes: 8_192, maxOutputBytes: 8_192, maxDepth: 12, maxCalls: 8 });
  return new DockerHotApplicationSandboxSupervisor(gateway, {
    quarantine(generation, reason) { quarantines.push(`${generation.generationId}:${reason}`); }
  }, {
    active() { return Promise.resolve(true); },
    admit() { return Promise.resolve(true); }
  }, {
    async started(generation, name) { observations[name] = await inspectContainer(name); started?.(generation, name); },
    stopped() {}
  }, store.runnerSource());
}

beforeAll(async () => {
  await execFile("docker", ["version", "--format", "{{.Server.Version}}"]);
}, 30_000);

describe("production extension runner", () => {
  it("refuses to send source when Docker inspection omits any required effective control", async () => {
    const runner = supervisor({}, artifactStore()) as any;
    const secure = {
      Config: { User: "10000:10000", WorkingDir: "/tmp", Image: extensionRunnerImage, Env: ["HOME=/tmp", "NODE_NO_WARNINGS=1"] },
      HostConfig: {
        NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true", `seccomp=${runnerSeccompProfile}`],
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
      (value: any) => { value.HostConfig.Binds = ["/:/host:ro"]; },
      (value: any) => { value.Mounts = [{ Type: "bind", Source: "/", Destination: "/host" }]; },
      (value: any) => { value.HostConfig.Tmpfs = {}; },
      (value: any) => { value.Config.Env.push("DATABASE_URL=postgres://host-secret"); },
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
    expect(inspected.AppArmorProfile).toBe("");
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

    await expect(runner.invoke(await request(store, "hung-generation-one", `() => { while (true) {} }`, { wallTimeMs: 500 }))).rejects.toMatchObject({ code: "INVOCATION_TIMEOUT" });
    expect(runner.health(identity("hung-generation-one"))).toMatchObject({ accepting: false, quarantined: true });
    expect(quarantines).toEqual(["hung-generation-one:INVOCATION_TIMEOUT"]);
    await expect(runner.invoke(await request(store, "healthy-generation-one", `({ input }) => input`))).resolves.toMatchObject({ marker: expect.any(String) });
    await expect(runner.invoke(await request(store, "crashed-generation-one", `() => { throw new Error("fixture crash"); }`))).rejects.toMatchObject({ code: "APPLICATION_FAILED" });
    await expect(runner.invoke(await request(store, "healthy-generation-two", `() => ({ stillHealthy: true })`))).resolves.toEqual({ stillHealthy: true });

    const oldWork = runner.invoke(await request(store, "draining-generation-one", `async () => new Promise(() => {})`));
    await started;
    await expect(runner.drain(identity("draining-generation-one"), 100)).resolves.toEqual({ graceful: false, terminated: 1 });
    await expect(oldWork).rejects.toBeInstanceOf(RunnerInvocationError);
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
