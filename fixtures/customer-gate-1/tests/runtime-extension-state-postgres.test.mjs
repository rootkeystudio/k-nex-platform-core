import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { chromium } from "playwright";

import { ArtifactVerifier, buildBundle, canonicalJson, CatalogClient, InMemoryCatalogCheckpointStore, sha256 } from "@k-nex/extension-bundler";
import { DockerHotApplicationSandboxSupervisor } from "@k-nex/extension-runner";
import { ActiveExtensionSecurityReconciler, PostgresExtensionCapabilityAuthority, PostgresExtensionCapabilitySequenceStore, PostgresRuntimeExtensionOutboxDispatcher, PostgresRuntimeExtensionStore, PostgresVerifiedArtifactStore, RuntimeStoreRunnerQuarantineAdapter } from "@k-nex/payload-adapter";
import { AuthoritativeHotApplicationRuntime, DurableDynamicArtifactPipeline, DurableDynamicGenerationRuntime, ExtensionCapabilityGateway, HmacExtensionCapabilityTokens, PluginManager, ReferenceHotApplicationGenerationWarmer, TrustedAutomationOperationAuthorizer } from "@k-nex/runtime";
import { startContinuousHttpProbe } from "./continuous-http-probe.mjs";
import { startHotApplicationFixedRouteHost } from "./hot-application-fixed-route-host.mjs";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const digest = (character) => `sha256:${character.repeat(64)}`;
const source = { repository: "https://github.com/k-nex/customer-gate-1-apps", commit: "0123456789abcdef0123456789abcdef01234567" };
const publisherKeys = generateKeyPairSync("ed25519");
const catalogKeys = generateKeyPairSync("ed25519");
const publisher = { identity: "customer-gate-1-hot-app-publisher", publicKey: publisherKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const catalogSigner = { identity: "customer-gate-1-hot-app-catalog", publicKey: catalogKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const runnerIsolationProfile = {
  schemaVersion: 1, scope: "production", profile: "os-container-per-generation-v1", isolation: "os-container-per-generation", workloadIdentity: "unique-non-root",
  namespaces: { pid: "separate", mount: "separate", user: "separate", network: "separate" },
  filesystem: { root: "read-only", code: "read-only", temporaryStorage: "bounded-tmpfs", hostMounts: "none" },
  privileges: { linuxCapabilities: "dropped", noNewPrivileges: true, dockerSocket: "none", databaseCredential: "none", hostSecrets: "none" },
  policy: { syscallProfile: digest("a"), macProfile: digest("b"), rawEgress: "denied", inboundListener: "denied", hostNetworkAdapter: "allowlisted-proxy-only" },
  limits: { cpuMilliCores: 500, memoryMiB: 128, processes: 16, openFiles: 64, tempBytes: 1_048_576 },
  rpc: { transport: "structured-host-rpc-only", schemaValidated: true, shortLivedGenerationActorIdentity: true }
};

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-3-postgres-secret", BOOT_KEY: "p9-3-runtime-state" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function startRuntimeExtensionService(connectionString, role) {
  const child = spawn(process.execPath, ["tests/runtime-extension-state-consumer.mjs"], {
    cwd: fixtureDirectory,
    env: {
      ...process.env,
      P9_RUNTIME_CONSUMER_CONFIGURATION: JSON.stringify({
        databaseUrl: connectionString, role, applicationId: "customer-alpha", environment: "production",
        deliveryClass: "hot-application", extensionId: "app.sales-live", auditKey: digest("7"), pollIntervalMs: 200
      })
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = [];
  const waiters = [];
  let failure;
  let stderr = "";
  let stdout = "";
  const fail = (error) => {
    if (failure) return;
    failure = error;
    while (waiters.length > 0) waiters.shift().reject(error);
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const waiter = waiters.findIndex((candidate) => candidate.event === message.event);
        if (waiter >= 0) waiters.splice(waiter, 1)[0].resolve(message);
        else pending.push(message);
      } catch (error) { fail(error); }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", fail);
  child.on("close", (code) => {
    if (code !== 0 && code !== null) fail(new Error(`Runtime extension ${role} consumer exited ${code}: ${stderr}`));
  });
  const next = (event) => {
    if (failure) return Promise.reject(failure);
    const index = pending.findIndex((message) => message.event === event);
    if (index >= 0) return Promise.resolve(pending.splice(index, 1)[0]);
    return new Promise((resolve, reject) => waiters.push({ event, resolve, reject }));
  };
  return {
    role, child,
    async ready() { const ready = await next("ready"); this.url = ready.url; return ready; },
    async state(path, method = "GET") {
      const response = await fetch(`${this.url}${path}`, { method });
      if (!response.ok) throw new Error(`Runtime extension ${role} service failed: ${await response.text()}`);
      return response.json();
    },
    async close() {
      if (child.exitCode !== null) return;
      try { await fetch(`${this.url}/shutdown`, { method: "POST" }); } catch {}
      await new Promise((resolve) => child.once("close", resolve));
    }
  };
}

async function fixedRouteScriptDigest(host) {
  const response = await fetch(`${host.url}/host-route.js`);
  assert.equal(response.status, 200, "the immutable customer host script must remain available");
  return sha256(Buffer.from(await response.arrayBuffer()));
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function request(operation, version, expectedRevision) {
  return {
    applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id: "app.sales-live" }, operation,
    targetVersion: version, expectedRevision, idempotencyKey: `${operation}:app.sales-live:${version}:${expectedRevision}`, correlationId: `runtime-state-${operation}-${version.replaceAll(".", "-")}`
  };
}

function stateRequest(id, key, options = {}) {
  return {
    applicationId: "customer-alpha", environment: "production", extension: { deliveryClass: "hot-application", id },
    operation: options.operation ?? "install", targetVersion: options.version ?? "1.0.0", expectedRevision: options.expectedRevision ?? 0,
    idempotencyKey: key, correlationId: `state-${id.replaceAll(".", "-")}`
  };
}

function statePlan(operationId, change, generation = 1) {
  const generationId = `${change.extension.id.replaceAll(".", "-")}-generation-${generation}`;
  return {
    executionClass: "live-generation", operationId, sourceCommit: "a".repeat(40), generationId,
    plan: {
      schemaVersion: 1, planId: `${generationId}-plan`, operationId, operation: change.operation, version: change.targetVersion,
      artifactDigest: digest(String(generation)), expectedRevision: change.expectedRevision, targetGenerationId: generationId,
      approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "hot-application", id: change.extension.id,
      availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
    }
  };
}

function stateAuthority(change, generationId, generation = 1) {
  return {
    applicationId: change.applicationId, environment: change.environment, deliveryClass: change.extension.deliveryClass,
    extensionId: change.extension.id, generationId, sourceCommit: "a".repeat(40), artifactDigest: digest(String(generation)),
    manifestDigest: digest("b"), catalogDigest: digest("c"), provenanceDigest: digest("d"), sbomDigest: digest("e")
  };
}

function stateActivation(authority, now) {
  return {
    authority, version: "1.0.0",
    readiness: { generationId: authority.generationId, serverGenerationId: authority.generationId, uiGenerationId: authority.generationId, storageGenerationId: authority.generationId, leaseToken: `ready:${authority.generationId}`, readyAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 60_000).toISOString() },
    compatibility: { status: "compatible", windowId: "state-window-1", closesAt: new Date(now.valueOf() + 86_400_000).toISOString(), migrationDigest: digest("1"), dataRevision: 1 },
    metadata: {}, settings: {}, storageSchemaVersions: {}
  };
}

function claimState(store, change, requestDigest, workerId) {
  return store.claimOperation({
    request: change, requestDigest, workerId,
    authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("9") }
  });
}

async function prepareStateGeneration(store, change, requestDigest, workerId, now) {
  const claimed = await claimState(store, change, requestDigest, workerId);
  assert.equal(claimed.status, "claimed");
  let operation = await store.savePlan(claimed.operation.operationId, claimed.operation.leaseToken, statePlan(claimed.operation.operationId, change));
  operation = (await store.transition({ operationId: operation.operationId, leaseToken: operation.leaseToken, expectedPhase: "planning", phase: "downloading" })).operation;
  const authority = stateAuthority(change, operation.plan.generationId);
  operation = (await store.transition({ operationId: operation.operationId, leaseToken: operation.leaseToken, expectedPhase: "downloading", phase: "verified", authority })).operation;
  operation = (await store.transition({ operationId: operation.operationId, leaseToken: operation.leaseToken, expectedPhase: "verified", phase: "staged", authority })).operation;
  await store.stageGeneration({ operationId: operation.operationId, leaseToken: operation.leaseToken, stage: stateActivation(authority, now) });
  return store.readOperation(operation.operationId);
}

function releaseDefinition(generation, version, marker, compatibility) {
  const generationId = `app-sales-live-generation-${generation}`;
  const bundle = buildBundle({
    manifest: {
      schemaVersion: 1, deliveryClass: "hot-application", id: "app.sales-live", displayName: "Sales live", version, runtimeAbi: "1.0.0",
      entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] },
      capabilities: [{ kind: "records", required: true, reason: "Read the bounded Hot Application fixture.", operations: ["query"], resources: [{ id: "sales.records", version: 1 }] }],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 },
      settings: [], screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }, { id: "sales.activity", route: "/activity/:activityid", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: ["assets/marker.txt"], localization: [], healthChecks: []
    },
    files: [
      { path: "server/main.mjs", bytes: Buffer.from(`export default async ({ input, host }) => { const scope = await host.call("records.query", input); return { marker: ${JSON.stringify(marker)}, generationId: scope.generationId }; };\n`), contentType: "application/javascript" },
      { path: "ui/main.mjs", bytes: Buffer.from(`let port;let sequence=0;const send=(type,body={})=>port.postMessage({schemaVersion:1,sessionId:'route-'+${JSON.stringify(generationId)},appId:'app.sales-live',generationId:${JSON.stringify(generationId)},sequence:++sequence,direction:'realm-to-host',type,...body});self.onmessage=({data,ports})=>{if(data?.type!=='connect'||!ports[0])return;port=ports[0];port.onmessage=({data})=>{if(data?.type==='bootstrap'){send('ready');send('render',{root:{nodeId:'root',component:'heading',props:{level:1,text:${JSON.stringify(marker)}},events:[],children:[]}});}};port.start();};\n`), contentType: "application/javascript" },
      { path: "assets/marker.txt", bytes: Buffer.from(marker), contentType: "text/plain" }
    ],
    source,
    workflowIdentity: `${source.repository}/.github/workflows/release.yml@${source.commit}`
  });
  return {
    generationId, version, marker, bundle, compatibility,
    entry: {
      deliveryClass: "hot-application", id: "app.sales-live", version, runtimeAbi: "1.0.0", publisher,
      source: { ...source, assetUrl: `https://github.com/k-nex/customer-gate-1-apps/releases/download/${version}/app.sales-live.tar.gz` },
      artifactDigest: sha256(bundle.artifact), manifestDigest: sha256(Buffer.from(canonicalJson(bundle.manifest))), sbomDigest: sha256(bundle.sbom), provenanceDigest: sha256(bundle.provenance),
      support: "supported", review: "approved", security: "clear", revoked: false
    }
  };
}

function signedCatalog(entries, sequence = 1, expiresAt = "2030-01-01T00:00:00.000Z") {
  const payload = { schemaVersion: 1, sequence, expiresAt, entries };
  return { schemaVersion: 1, signer: catalogSigner, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), catalogKeys.privateKey).toString("base64") };
}

function securityEntry(id, state, security = "clear") {
  return {
    deliveryClass: "hot-application", id, version: "1.0.0", runtimeAbi: "1.0.0", publisher,
    source: { repository: source.repository, commit: state.sourceCommit, assetUrl: `${source.repository}/releases/download/v1.0.0/${id}.tar.gz` },
    artifactDigest: state.artifactDigest, manifestDigest: state.manifestDigest, provenanceDigest: state.provenanceDigest, sbomDigest: state.sbomDigest,
    support: security === "unsupported" ? "unsupported" : "supported", review: "approved", security: security === "compromised" ? "compromised" : "clear", revoked: security === "revoked"
  };
}

function verifiedRelease(release, catalog) {
  const authority = {
    applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-live", generationId: release.generationId,
    sourceCommit: source.commit, artifactDigest: release.entry.artifactDigest, manifestDigest: release.entry.manifestDigest, catalogDigest: sha256(Buffer.from(canonicalJson(catalog))), provenanceDigest: release.entry.provenanceDigest, sbomDigest: release.entry.sbomDigest
  };
  return {
    ...release,
    authority,
    stage: {
      owner: { applicationId: authority.applicationId, environment: authority.environment, deliveryClass: authority.deliveryClass, extensionId: authority.extensionId, generationId: authority.generationId },
      verification: { catalog, artifact: release.bundle.artifact, provenance: release.bundle.provenance, deliveryClass: "hot-application", id: "app.sales-live", version: release.version, runtimeAbi: "1.0.0" },
      authority,
      activation: { compatibility: release.compatibility, metadata: { navigation: `${release.generationId}:navigation` }, settings: { locale: "en" }, storageSchemaVersions: { "sales.records": Number(release.generationId.at(-1)) } }
    }
  };
}

test("preserves accepted artifacts while reconciling fresh revocation decisions atomically in PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_extension_security").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let now = new Date("2026-08-29T09:00:00.000Z");
  const clock = { now: () => now };
  const storeA = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  const storeB = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  try {
    await boot(container.getConnectionUri());

    const release = releaseDefinition(9, "1.0.0", "accepted-bytes", { status: "compatible", windowId: "accepted-window", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("9"), dataRevision: 1 });
    const acceptedCatalog = signedCatalog([release.entry], 1, "2026-08-29T09:01:00.000Z");
    const checkpoints = new InMemoryCatalogCheckpointStore();
    const verifier = new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, checkpoints, () => now.valueOf()), { [publisher.identity]: publisher.publicKey });
    const artifacts = new PostgresVerifiedArtifactStore(pool, verifier);
    const acceptedRelease = verifiedRelease(release, acceptedCatalog);
    await artifacts.stage(acceptedRelease.stage);
    now = new Date("2026-08-29T09:02:00.000Z");
    await verifier.currentSecurityDecision(signedCatalog([release.entry], 2, "2030-01-01T00:00:00.000Z"), {
      deliveryClass: "hot-application", id: release.entry.id, version: release.version, sourceCommit: source.commit,
      artifactDigest: release.entry.artifactDigest, manifestDigest: release.entry.manifestDigest, provenanceDigest: release.entry.provenanceDigest, sbomDigest: release.entry.sbomDigest
    });
    assert.equal((await artifacts.resolve({ owner: acceptedRelease.stage.owner, generationId: release.generationId, artifactDigest: release.entry.artifactDigest }))?.authority.generationId, release.generationId);
    await pool.query("update runtime_extension_artifacts set artifact_bytes=set_byte(artifact_bytes, 0, (get_byte(artifact_bytes, 0)+1)%256) where artifact_digest=$1", [release.entry.artifactDigest]);
    await assert.rejects(artifacts.read(release.entry.artifactDigest), { code: "ARTIFACT_INVALID" });

    const change = stateRequest("app.sales-security", "security-reconcile");
    const warming = await prepareStateGeneration(storeA, change, digest("a"), "security-worker", now);
    const activated = await storeA.activateGeneration(warming.operationId, warming.leaseToken);
    const extension = change.extension;
    const active = (await storeA.inventory(change.applicationId, change.environment)).extensions.hotApplications[extension.id].activeGeneration;
    const revocation = signedCatalog([securityEntry(extension.id, active, "revoked")], 5, "2030-01-01T00:00:00.000Z");
    const reconciler = new ActiveExtensionSecurityReconciler(verifier, storeA);
    const quarantined = await reconciler.reconcile({ applicationId: change.applicationId, environment: change.environment, extension, expectedRevision: activated.revisionAfter, catalog: revocation });
    assert.equal(quarantined.status, "quarantined");
    const replay = await reconciler.reconcile({ applicationId: change.applicationId, environment: change.environment, extension, expectedRevision: activated.revisionAfter, catalog: revocation });
    assert.equal(replay.status, "quarantined");
    assert.deepEqual(replay.receipt, quarantined.receipt);
    assert.deepEqual((await pool.query("select count(*)::int receipts, (select count(*)::int from runtime_extension_security_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine') outbox from runtime_extension_security_receipts")).rows, [{ receipts: 1, audits: 1, outbox: 1 }]);
    const dispatcher = new PostgresRuntimeExtensionOutboxDispatcher(pool);
    for (;;) {
      const dispatched = await dispatcher.dispatchNext({ publish: async () => {} });
      if (dispatched.status === "idle") break;
    }
    assert.equal((await pool.query("select status from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine'")).rows[0].status, "delivered");
    const evidenceBeforeStale = await pool.query("select (select count(*)::int from runtime_extension_security_receipts) receipts, (select count(*)::int from runtime_extension_security_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine') outbox");
    await assert.rejects(reconciler.reconcile({ applicationId: change.applicationId, environment: change.environment, extension, expectedRevision: activated.revisionAfter, catalog: signedCatalog([securityEntry(extension.id, active, "revoked")], 4, "2030-01-01T00:00:00.000Z") }), /checkpoint|stale|replay/i);
    assert.deepEqual((await pool.query("select (select count(*)::int from runtime_extension_security_receipts) receipts, (select count(*)::int from runtime_extension_security_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine') outbox")).rows, evidenceBeforeStale.rows);

    const raceChange = stateRequest("app.sales-security-race", "security-race");
    const raceWarming = await prepareStateGeneration(storeA, raceChange, digest("b"), "security-race-worker", now);
    const raceActivated = await storeA.activateGeneration(raceWarming.operationId, raceWarming.leaseToken);
    const raceActive = (await storeA.inventory(raceChange.applicationId, raceChange.environment)).extensions.hotApplications[raceChange.extension.id].activeGeneration;
    const decision = {
      catalogDigest: digest("c"), catalogSignerIdentity: catalogSigner.identity, catalogSequence: 7, disposition: "compromised",
      release: { deliveryClass: "hot-application", id: raceChange.extension.id, version: raceActive.version, sourceCommit: raceActive.sourceCommit, artifactDigest: raceActive.artifactDigest, manifestDigest: raceActive.manifestDigest, provenanceDigest: raceActive.provenanceDigest, sbomDigest: raceActive.sbomDigest }
    };
    const exact = { applicationId: raceChange.applicationId, environment: raceChange.environment, extension: raceChange.extension, expectedRevision: raceActivated.revisionAfter, generationId: raceActive.generationId, decision };
    const race = await Promise.allSettled([
      storeA.quarantineActiveGeneration(exact),
      storeB.quarantineActiveGeneration({ ...exact, expectedRevision: exact.expectedRevision - 1 })
    ]);
    assert.deepEqual(race.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    const exactReceipt = race.find(({ status }) => status === "fulfilled").value;
    assert.deepEqual(await storeA.quarantineActiveGeneration(exact), exactReceipt);
    await assert.rejects(storeA.quarantineActiveGeneration({ ...exact, expectedRevision: exact.expectedRevision - 1 }), { code: "REVISION_CONFLICT" });
    const stateAfterRace = await storeA.inventory(raceChange.applicationId, raceChange.environment);
    assert.equal(stateAfterRace.extensions.hotApplications[raceChange.extension.id].disposition, "quarantined");
    const evidenceBeforeDifferent = await pool.query("select (select count(*)::int from runtime_extension_security_receipts) receipts, (select count(*)::int from runtime_extension_security_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine') outbox");
    await assert.rejects(storeB.quarantineActiveGeneration({ ...exact, decision: { ...decision, catalogDigest: digest("d"), catalogSequence: 8 } }), { code: "REVISION_CONFLICT" });
    assert.deepEqual((await pool.query("select (select count(*)::int from runtime_extension_security_receipts) receipts, (select count(*)::int from runtime_extension_security_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine') outbox")).rows, evidenceBeforeDifferent.rows);
    console.log('P9_ACCEPTED_ARTIFACT_SECURITY_EVIDENCE={"scenarios":["accepted-expiry","checkpoint-advance","altered-bytes","revocation","outbox","idempotent-replay","stale-race"]}');
  } finally {
    await pool.end();
    await container.stop();
  }
});

test("persists terminal runner quarantine, audit, and outbox evidence across a runner restart", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_runner_quarantine").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const now = new Date("2026-08-29T09:00:00.000Z");
  const clock = { now: () => now };
  const store = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  try {
    await boot(container.getConnectionUri());
    const change = stateRequest("app.sales-runner-quarantine", "runner-quarantine");
    const warming = await prepareStateGeneration(store, change, digest("a"), "runner-quarantine-worker", now);
    const activated = await store.activateGeneration(warming.operationId, warming.leaseToken);
    const active = (await store.inventory(change.applicationId, change.environment)).extensions.hotApplications[change.extension.id].activeGeneration;
    const request = {
      applicationId: change.applicationId,
      environment: change.environment,
      appId: change.extension.id,
      generationId: active.generationId,
      expectedRevision: activated.revisionAfter,
      reason: "INVOCATION_TIMEOUT"
    };
    const receipt = await store.quarantineRunnerGeneration(request);
    assert.equal(receipt.reason, "INVOCATION_TIMEOUT");
    assert.deepEqual(await store.quarantineRunnerGeneration(request), receipt);
    assert.equal((await store.inventory(change.applicationId, change.environment)).extensions.hotApplications[change.extension.id].disposition, "quarantined");
    const restartedAdapter = new RuntimeStoreRunnerQuarantineAdapter(new PostgresRuntimeExtensionStore(pool, clock, digest("7")));
    assert.equal(await restartedAdapter.active({ applicationId: change.applicationId, environment: change.environment, appId: change.extension.id, generationId: active.generationId }), false);
    assert.deepEqual((await pool.query("select reason, count(*)::int count from runtime_extension_runner_quarantine_receipts group by reason")).rows, [{ reason: "INVOCATION_TIMEOUT", count: 1 }]);
    assert.deepEqual((await pool.query("select count(*)::int audits, (select count(*)::int from runtime_extension_outbox where event_json->>'operationPhase'='failed' and event_json->>'lifecycleState'='quarantined') outbox from runtime_extension_audit where event_json->>'operationPhase'='failed' and event_json->>'lifecycleState'='quarantined'")).rows, [{ audits: 1, outbox: 1 }]);
  } finally {
    await pool.end();
    await container.stop();
  }
});

function plan(operationId, change, release) {
  return {
    executionClass: "live-generation", operationId, sourceCommit: release.authority.sourceCommit, generationId: release.generationId,
    plan: {
      schemaVersion: 1, planId: `${release.generationId}-plan`, operationId, operation: change.operation, version: change.targetVersion,
      artifactDigest: release.authority.artifactDigest, expectedRevision: change.expectedRevision,
      ...(change.currentGenerationId ? { currentGenerationId: change.currentGenerationId } : {}), targetGenerationId: release.generationId,
      approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "hot-application", id: "app.sales-live",
      availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: release.bundle.manifest.capabilities,
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
    }
  };
}

test("rejects SCN-12 activation races and SCN-13 stale operation replays in PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_coordination").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let now = new Date("2026-08-29T09:00:00.000Z");
  const clock = { now: () => now };
  const storeA = new PostgresRuntimeExtensionStore(pool, clock, digest("7"), { leaseMs: 1_000, maxConcurrentOperations: 2 });
  const storeB = new PostgresRuntimeExtensionStore(pool, clock, digest("7"), { leaseMs: 1_000, maxConcurrentOperations: 2 });
  try {
    await boot(container.getConnectionUri());
    const firstRequest = stateRequest("app.sales-race", "install:app.sales-race:1");
    const secondRequest = stateRequest("app.forecast", "install:app.forecast:1");
    const first = await claimState(storeA, firstRequest, digest("1"), "worker-a");
    assert.equal(first.status, "claimed");
    assert.equal((await claimState(storeA, firstRequest, digest("1"), "worker-a")).status, "replay");
    await assert.rejects(claimState(storeA, firstRequest, digest("2"), "worker-a"), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(claimState(storeB, stateRequest("app.sales-race", "install:app.sales-race:2"), digest("3"), "worker-b"), { code: "OPERATION_IN_PROGRESS" });
    const second = await claimState(storeB, secondRequest, digest("4"), "worker-b");
    assert.equal(second.status, "claimed");
    await assert.rejects(claimState(storeB, stateRequest("app.pipeline", "install:app.pipeline:1"), digest("5"), "worker-b"), { code: "GLOBAL_BUDGET_EXHAUSTED" });

    const firstSaved = await storeA.savePlan(first.operation.operationId, first.operation.leaseToken, statePlan(first.operation.operationId, firstRequest));
    const secondSaved = await storeB.savePlan(second.operation.operationId, second.operation.leaseToken, statePlan(second.operation.operationId, secondRequest));
    const racedPhase = await Promise.allSettled([
      storeA.transition({ operationId: firstSaved.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "planning", phase: "downloading" }),
      storeB.transition({ operationId: firstSaved.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "planning", phase: "downloading" })
    ]);
    assert.deepEqual(racedPhase.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    const evidenceBeforeInvalid = await pool.query("select (select count(*)::int from runtime_extension_transition_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox) outbox");
    await assert.rejects(storeA.transition({ operationId: firstSaved.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "downloading", phase: "completed" }), { code: "PHASE_CONFLICT" });
    assert.deepEqual((await pool.query("select (select count(*)::int from runtime_extension_transition_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox) outbox")).rows, evidenceBeforeInvalid.rows);

    now = new Date(now.valueOf() + 1_001);
    const resumed = await storeB.resumeOperation(firstSaved.operationId, "worker-recovery");
    await assert.rejects(storeA.transition({ operationId: firstSaved.operationId, leaseToken: firstSaved.leaseToken, expectedPhase: "downloading", phase: "failed" }), { code: "LEASE_CONFLICT" });
    await storeB.transition({ operationId: resumed.operationId, leaseToken: resumed.leaseToken, expectedPhase: "downloading", phase: "failed" });
    const secondResumed = await storeB.resumeOperation(secondSaved.operationId, "worker-recovery");
    await storeB.transition({ operationId: secondResumed.operationId, leaseToken: secondResumed.leaseToken, expectedPhase: "planning", phase: "failed" });

    const activationRequest = stateRequest("app.sales-activation", "install:app.sales-activation:1");
    const warming = await prepareStateGeneration(storeA, activationRequest, digest("6"), "activation-worker", now);
    await pool.query("create function p9_fail_activation_race() returns trigger language plpgsql as $$ begin raise exception 'simulated crash before pointer commit'; end $$");
    await pool.query("create trigger p9_fail_activation_race after update on runtime_extensions for each row when (new.active_generation_id='app-sales-activation-generation-1') execute function p9_fail_activation_race()");
    await assert.rejects(storeA.activateGeneration(warming.operationId, warming.leaseToken), /simulated crash before pointer commit/);
    assert.deepEqual((await pool.query("select active_generation_id from runtime_extensions where extension_id='app.sales-activation'")).rows, [{ active_generation_id: null }]);
    await pool.query("drop trigger p9_fail_activation_race on runtime_extensions");
    await pool.query("drop function p9_fail_activation_race()");
    const racedActivation = await Promise.allSettled([
      storeA.activateGeneration(warming.operationId, warming.leaseToken),
      storeB.activateGeneration(warming.operationId, warming.leaseToken)
    ]);
    assert.deepEqual(racedActivation.map(({ status }) => status), ["fulfilled", "fulfilled"]);
    assert.deepEqual(racedActivation[0].value, racedActivation[1].value);
    assert.equal((await storeA.observeActiveGeneration("customer-alpha", "production", activationRequest.extension)).generationId, "app-sales-activation-generation-1");
    assert.equal((await pool.query("select count(*)::int count from runtime_extension_transition_receipts where operation_id=$1 and event_json->>'operationPhase'='completed'", [warming.operationId])).rows[0].count, 1);
    console.log('P9_RUNTIME_COORDINATION_EVIDENCE={"scenarios":["SCN-12","SCN-13"]}');
  } finally {
    await pool.end();
    await container.stop();
  }
});

test("proves PostgreSQL-backed Hot Application install, update, restore, rollback, and execution through the durable runtime", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_extensions").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const now = new Date();
  const clock = { now: () => now };
  const storeA = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  const storeB = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  const hosts = [];
  const consumerFleet = [];
  let browser;
  let browserContext;
  let trafficProbe;
  let continuousHttp;
  let lostInvalidationRecovery;
  try {
    await boot(container.getConnectionUri());
    const tables = await pool.query("select to_regclass('public.runtime_extension_artifacts')::text artifacts, to_regclass('public.runtime_extension_artifact_bindings')::text bindings");
    assert.deepEqual(tables.rows, [{ artifacts: "runtime_extension_artifacts", bindings: "runtime_extension_artifact_bindings" }]);

    const releaseDrafts = [
      releaseDefinition(1, "1.0.0", "sales-live-v1", { status: "compatible", windowId: "sales-window-1", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("1"), dataRevision: 1 }),
      releaseDefinition(2, "1.1.0", "sales-live-v2", { status: "compatible", windowId: "sales-window-2", closesAt: "2026-08-30T09:59:59.000Z", migrationDigest: digest("2"), dataRevision: 2 }),
      releaseDefinition(3, "2.0.0", "sales-live-v3", { status: "irreversible", decisionId: "sales-contract-cutover", reason: "The storage contract no longer supports generation 1.", migrationDigest: digest("3"), dataRevision: 3 })
    ];
    const catalog = signedCatalog(releaseDrafts.map((release) => release.entry));
    const releases = releaseDrafts.map((release) => verifiedRelease(release, catalog));
    const byVersion = new Map(releases.map((release) => [release.version, release]));
    const byGeneration = new Map(releases.map((release) => [release.generationId, release]));
    const verifier = new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [publisher.identity]: publisher.publicKey });
    const artifacts = new PostgresVerifiedArtifactStore(pool, verifier);
    await Promise.all(releases.map((release) => artifacts.stage(release.stage)));
    const storedBytes = await pool.query("select artifact_digest, octet_length(artifact_bytes)::int artifact_bytes, octet_length(provenance_bytes)::int provenance_bytes from runtime_extension_artifacts order by artifact_digest");
    assert.equal(storedBytes.rows.length, 3);
    assert.equal(storedBytes.rows.every((row) => row.artifact_bytes > 0 && row.provenance_bytes > 0), true);

    const warmed = [];
    const warmer = new ReferenceHotApplicationGenerationWarmer({
      runner: { prepareServer: async ({ artifact }) => { assert.match((await artifacts.runnerSource().load({ owner: { ...artifact.authority, generationId: artifact.authority.generationId }, artifactDigest: artifact.authority.artifactDigest, serverEntrypoint: "server/main.mjs" })).source, /export default async/u); warmed.push(`runner:${artifact.authority.generationId}`); } },
      remoteUi: { prepareRemoteUi: async ({ artifact }) => { assert.ok((await artifacts.read(artifact.authority.artifactDigest))?.verified.files.get("ui/main.mjs")); warmed.push(`remote-ui:${artifact.authority.generationId}`); } },
      storage: { prepareStorage: async ({ artifact }) => { assert.equal((await pool.query("select to_regclass('public.runtime_extension_storage_namespaces')::text storage")).rows[0].storage, "runtime_extension_storage_namespaces"); warmed.push(`storage:${artifact.authority.generationId}`); } },
      surfaces: { prepareFixedSurfaces: async ({ manifest, artifact }) => { assert.equal(manifest.screens.some((screen) => screen.route === "/activity/:activityid"), true); warmed.push(`surfaces:${artifact.authority.generationId}`); } },
      clock
    });
    const pipeline = new DurableDynamicArtifactPipeline(artifacts);
    const manager = new PluginManager("activation-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), {
      plan: async (change) => {
        const release = byVersion.get(change.targetVersion);
        if (!release) throw new Error("Fixture release is unavailable.");
        return { plan: plan(change.operationId, change, release).plan, sourceCommit: release.authority.sourceCommit, generationId: release.generationId };
      }
    }, storeA, pipeline, { request: async () => { throw new Error("Static delivery is not used."); } }, { request: async () => { throw new Error("Static delivery is not used."); }, reverify: async () => false }, new DurableDynamicGenerationRuntime(artifacts, warmer));

    const identity = { deliveryClass: "hot-application", id: "app.sales-live" };

    const capabilityTokens = new HmacExtensionCapabilityTokens(new Uint8Array(32).fill(9), clock);
    const runnerGateway = new ExtensionCapabilityGateway(capabilityTokens, {
      "records.query": {
        validateInput: (value) => value,
        invoke: async (claims, input) => {
          if (input && typeof input === "object" && input.delayMs === 500) await new Promise((resolve) => setTimeout(resolve, 500));
          return { generationId: claims.generationId };
        },
        validateOutput: (value) => value
      }
    }, new PostgresExtensionCapabilityAuthority(pool, { reauthorize: () => true }, clock), new PostgresExtensionCapabilitySequenceStore(pool, clock), clock, {
      maxInputBytes: 65_536, maxOutputBytes: 131_072, maxDepth: 12, maxCalls: 8
    });
    const dockerExecutions = [];
    const runnerQuarantine = new RuntimeStoreRunnerQuarantineAdapter(storeB);
    let admissionBarrier;
    const runnerAuthority = {
      active: (runnerIdentity) => runnerQuarantine.active(runnerIdentity),
      async admit(runnerIdentity, drainLeaseId) {
        if (admissionBarrier?.generationId === runnerIdentity.generationId) {
          admissionBarrier.leaseId ??= drainLeaseId;
          admissionBarrier.reached.resolve();
          await admissionBarrier.release.promise;
          const admitted = await runnerQuarantine.admit(runnerIdentity, drainLeaseId);
          admissionBarrier.admitted = admitted;
          return admitted;
        }
        return runnerQuarantine.admit(runnerIdentity, drainLeaseId);
      }
    };
    const runner = new DockerHotApplicationSandboxSupervisor(runnerGateway, runnerQuarantine, runnerAuthority, {
      started(identity) { dockerExecutions.push({ event: "started", generationId: identity.generationId }); },
      stopped(identity) { dockerExecutions.push({ event: "stopped", generationId: identity.generationId }); }
    }, artifacts.runnerSource());
    const trafficRuntime = new AuthoritativeHotApplicationRuntime(storeB, artifacts, capabilityTokens, runner, {
      applicationId: "customer-alpha", environment: "production", appId: "app.sales-live"
    }, runnerIsolationProfile, "runtime-traffic-gateway");
    let trafficSequence = 0;
    const invokeTraffic = (input = {}) => trafficRuntime.invoke({
      input,
      actor: { principalId: "user:one", effectiveActorId: "user:one" },
      correlationId: `traffic-correlation-${++trafficSequence}`
    });
    let applicationTrafficReady = false;
    const gateway = await listen(async (_request, response) => {
      try {
        response.end(JSON.stringify(applicationTrafficReady
          ? await invokeTraffic()
          : { marker: "host-baseline", generationId: "host-gateway-generation-0" }));
      } catch (error) { response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message })); }
    });
    hosts.push(gateway);
    trafficProbe = startContinuousHttpProbe({
      url: gateway.url, path: "/continuous", initialWindow: "install",
      initialGenerations: ["host-gateway-generation-0", "app-sales-live-generation-1"]
    });
    await trafficProbe.waitForGeneration("install", "host-gateway-generation-0");
    const fixedRouteHost = await startHotApplicationFixedRouteHost({ store: storeA, artifacts, applicationId: "customer-alpha", environment: "production", extension: identity });
    hosts.push(fixedRouteHost);
    const preInstallRoute = await fetch(`${fixedRouteHost.url}/apps/sales-live/activity/42`);
    assert.equal(preInstallRoute.status, 404, "the immutable customer route host must exist and fail closed before app installation");
    assert.equal(fixedRouteHost.scriptBuilds, 1, "the customer fixed route must be built exactly once before app installation");
    const preInstallHostScriptDigest = await fixedRouteScriptDigest(fixedRouteHost);

    const install = await manager.plan(request("install", "1.0.0", 0));
    await manager.stage(install.operationId);
    assert.equal((await manager.validate(install.operationId)).valid, true);
    const installed = await manager.activate(install.operationId);
    assert.deepEqual(await invokeTraffic(), { marker: "sales-live-v1", generationId: installed.generationId }, "the active generation must answer before the gateway exposes it to continuous traffic");
    applicationTrafficReady = true;
    await trafficProbe.waitForGeneration("install", installed.generationId);
    assert.equal(installed.generationId, "app-sales-live-generation-1");
    assert.deepEqual(await manager.activate(install.operationId), installed);
    await trafficProbe.pause();
    consumerFleet.push(...["web", "worker", "runner", "browser-host"].map((role) => startRuntimeExtensionService(container.getConnectionUri(), role)));
    const [webService, workerService, runnerService, browserHost] = consumerFleet;
    const baselineServices = await Promise.all(consumerFleet.map((consumer) => consumer.ready()));
    assert.equal(new Set(baselineServices.map((consumer) => consumer.pid)).size, 4, "web, worker, runner, and browser host must be distinct service processes");
    assert.equal(baselineServices.every((consumer) => consumer.pid !== process.pid), true, "runtime consumers must not run in the node:test parent process");
    browser = await chromium.launch();
    browserContext = await browser.newContext();
    const browserPage = await browserContext.newPage();
    await browserPage.goto(browserHost.url);
    await browserPage.waitForFunction(() => typeof window.runtimeExtensionState === "function");
    const routePage = await browserContext.newPage();
    const routeDiagnostics = [];
    routePage.on("pageerror", (error) => routeDiagnostics.push(error.message));
    routePage.on("console", (message) => routeDiagnostics.push(`${message.type()}:${message.text()}`));
    const installedRoute = await routePage.goto(`${fixedRouteHost.url}/apps/sales-live/activity/42`);
    assert.equal(installedRoute?.status(), 200, `the preinstalled /apps/:appId/* route must host an installed app: ${fixedRouteHost.routeErrors.join(" | ")}`);
    await routePage.getByRole("heading", { name: "sales-live-v1" }).waitFor({ timeout: 5_000 }).catch(async (error) => { throw new Error(`${error.message}; route=${await routePage.content()}; diagnostics=${routeDiagnostics.join(" | ")}`); });
    assert.deepEqual(await routePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: installed.generationId, route: "/apps/sales-live/activity/42", actorSessionId: "customer-session-1" });
    const runnerBaseline = await runnerService.state("/runtime-extension-state");
    const browserBaseline = await browserPage.evaluate(() => window.runtimeExtensionState("snapshot"));
    assert.equal(await browserPage.evaluate(() => typeof globalThis.process), "undefined", "Chromium browser consumer received a Node process surface.");
    assert.equal(Object.hasOwn(browserBaseline, "databaseUrl"), false, "Browser host exposed PostgreSQL credentials.");
    const baselineConsumers = [
      await webService.state("/runtime-extension-state"),
      await workerService.state("/runtime-extension-state"),
      runnerBaseline,
      { ...browserBaseline, role: "browser" }
    ];
    assert.deepEqual(baselineConsumers.map((consumer) => [consumer.role, consumer.snapshot.generationId, consumer.combinedGeneration.generationId, consumer.combinedGeneration.serverGenerationId, consumer.combinedGeneration.uiGenerationId, consumer.combinedGeneration.storageGenerationId]), [
      ["web", installed.generationId, installed.generationId, installed.generationId, installed.generationId, installed.generationId],
      ["worker", installed.generationId, installed.generationId, installed.generationId, installed.generationId, installed.generationId],
      ["runner", installed.generationId, installed.generationId, installed.generationId, installed.generationId, installed.generationId],
      ["browser", installed.generationId, installed.generationId, installed.generationId, installed.generationId, installed.generationId]
    ]);
    assert.equal((await invokeTraffic()).generationId, installed.generationId, "DockerHotApplicationSandboxSupervisor did not execute the runner consumer's observed generation.");
    trafficProbe.resume();

    const update = await manager.plan(request("update", "1.1.0", installed.revisionAfter));
    await manager.stage(update.operationId);
    trafficProbe.transition("update", [installed.generationId, "app-sales-live-generation-2"]);
    await trafficProbe.waitForGeneration("update", installed.generationId);
    const barrier = {
      generationId: installed.generationId,
      reached: Promise.withResolvers(),
      release: Promise.withResolvers(),
      admitted: undefined,
      leaseId: undefined
    };
    admissionBarrier = barrier;
    const draining = invokeTraffic({ delayMs: 500 });
    await barrier.reached.promise;
    assert.equal(await storeA.liveGenerationLeaseCount("customer-alpha", "production", identity, installed.generationId) >= 1, true, "the old generation invocation must hold a durable lease before cutover");
    assert.equal(await runnerQuarantine.admit({ applicationId: "customer-beta", environment: "production", appId: identity.id, generationId: installed.generationId }, barrier.leaseId), false, "a live lease must not admit another application");
    assert.equal(await runnerQuarantine.admit({ applicationId: "customer-alpha", environment: "production", appId: "app.sales-other", generationId: installed.generationId }, barrier.leaseId), false, "a live lease must not admit another application extension");
    assert.equal(await runnerQuarantine.admit({ applicationId: "customer-alpha", environment: "production", appId: identity.id, generationId: "app-sales-live-generation-2" }, barrier.leaseId), false, "a live lease must not admit another generation");
    let updated;
    try {
      updated = await manager.activate(update.operationId);
    } finally {
      admissionBarrier = undefined;
      barrier.release.resolve();
    }
    const drained = await draining;
    assert.equal(barrier.admitted, true, "the old generation must be admitted through its exact live lease after cutover");
    await trafficProbe.waitForGeneration("update", updated.generationId);
    assert.equal(updated.previousGenerationId, installed.generationId);
    assert.deepEqual(await manager.activate(update.operationId), updated);
    assert.deepEqual(drained, { marker: "sales-live-v1", generationId: installed.generationId });
    assert.equal(await storeA.liveGenerationLeaseCount("customer-alpha", "production", identity, installed.generationId), 0);
    const staleInvocationId = "stale-drain-invocation";
    const staleToken = capabilityTokens.issue({
      tokenId: "stale-drain-token",
      applicationId: "customer-alpha",
      environment: "production",
      appId: identity.id,
      generationId: installed.generationId,
      invocationId: staleInvocationId,
      actor: { principalId: "user:one", effectiveActorId: "user:one" },
      correlationId: "stale-drain-correlation",
      drainLeaseId: barrier.leaseId,
      grants: byGeneration.get(installed.generationId).bundle.manifest.capabilities,
      ttlMs: 6_000
    });
    await assert.rejects(runner.invoke({
      owner: { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: identity.id },
      generationId: installed.generationId,
      artifactDigest: byGeneration.get(installed.generationId).authority.artifactDigest,
      serverEntrypoint: "server/main.mjs",
      invocationId: staleInvocationId,
      drainLeaseId: barrier.leaseId,
      token: staleToken,
      input: {},
      limits: { cpuMilliCores: 500, memoryMiB: 128, processes: 16, openFiles: 64, tempBytes: 1_048_576, wallTimeMs: 5_000, inputBytes: 65_536, outputBytes: 131_072, logBytes: 65_536, maxConcurrency: 4 }
    }), { code: "GENERATION_QUARANTINED" });
    assert.equal(dockerExecutions.some((execution) => execution.event === "started" && execution.generationId === installed.generationId), true);
    assert.equal(dockerExecutions.some((execution) => execution.event === "stopped" && execution.generationId === installed.generationId), true);
    assert.equal((await storeB.observeActiveGeneration("customer-alpha", "production", identity)).generationId, updated.generationId);
    await assert.rejects(manager.plan(request("update", "1.0.0", updated.revisionAfter)), { code: "PLAN_MISMATCH" });
    const updatedRoute = await routePage.goto(`${fixedRouteHost.url}/apps/sales-live/activity/42`);
    assert.equal(updatedRoute?.status(), 200, "the fixed route must resolve the active updated generation without a rebuild");
    await routePage.getByRole("heading", { name: "sales-live-v2" }).waitFor();
    assert.deepEqual(await routePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: updated.generationId, route: "/apps/sales-live/activity/42", actorSessionId: "customer-session-1" });
    assert.equal(fixedRouteHost.routeRequests.at(-1)?.hadSession, true, "the updated fixed route lost its customer host session");
    const updatedHostScriptDigest = await fixedRouteScriptDigest(fixedRouteHost);
    assert.equal(updatedHostScriptDigest, preInstallHostScriptDigest, "the customer host script changed during app update");
    assert.deepEqual(warmed, [
      "runner:app-sales-live-generation-1", "remote-ui:app-sales-live-generation-1", "storage:app-sales-live-generation-1", "surfaces:app-sales-live-generation-1",
      "runner:app-sales-live-generation-2", "remote-ui:app-sales-live-generation-2", "storage:app-sales-live-generation-2", "surfaces:app-sales-live-generation-2"
    ]);

    const dispatcher = new PostgresRuntimeExtensionOutboxDispatcher(pool);
    let deliberatelyDroppedInvalidations = 0;
    for (;;) {
      const delivery = await dispatcher.dispatchNext({ publish: async () => { deliberatelyDroppedInvalidations += 1; } });
      if (delivery.status === "idle") break;
    }
    assert.equal(deliberatelyDroppedInvalidations > 0, true, "test must drop the PostgreSQL outbox invalidation before recovery polling");
    let convergedConsumers;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      convergedConsumers = [
        await webService.state("/runtime-extension-state"),
        await workerService.state("/runtime-extension-state"),
        await runnerService.state("/runtime-extension-state"),
        { ...(await browserPage.evaluate(() => window.runtimeExtensionState("snapshot"))), role: "browser" }
      ];
      if (convergedConsumers.every((consumer) => consumer.snapshot.generationId === updated.generationId)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(convergedConsumers.every((consumer) => consumer.snapshot.generationId === updated.generationId), true, "autonomous revision polling did not recover every consumer after the dropped outbox invalidation");
    assert.deepEqual(convergedConsumers.map((consumer) => [consumer.role, consumer.snapshot.generationId, consumer.combinedGeneration.generationId, consumer.combinedGeneration.serverGenerationId, consumer.combinedGeneration.uiGenerationId, consumer.combinedGeneration.storageGenerationId]), [
      ["web", updated.generationId, updated.generationId, updated.generationId, updated.generationId, updated.generationId],
      ["worker", updated.generationId, updated.generationId, updated.generationId, updated.generationId, updated.generationId],
      ["runner", updated.generationId, updated.generationId, updated.generationId, updated.generationId, updated.generationId],
      ["browser", updated.generationId, updated.generationId, updated.generationId, updated.generationId, updated.generationId]
    ], "autonomous revision polling must recover every consumer to the exact combined server/UI/storage generation");
    assert.equal((await invokeTraffic()).generationId, updated.generationId, "Runner recovery bypassed the Docker generation path.");
    lostInvalidationRecovery = {
      roles: convergedConsumers.map((consumer) => consumer.role),
      processes: baselineServices.map(({ role, pid }) => ({ role: role === "browser-host" ? "browser" : role, pid })),
      testParentPid: process.pid,
      droppedOutboxInvalidations: deliberatelyDroppedInvalidations,
      generationId: updated.generationId
    };

    await trafficProbe.pause();
    const beforeRestore = await manager.inventory("customer-alpha", "production");
    const uri = new URL(container.getConnectionUri());
    uri.hostname = "127.0.0.1";
    uri.port = "5432";
    const dumped = await container.exec(["pg_dump", "--format=custom", "--file=/tmp/p9-extension.dump", uri.toString()]);
    assert.equal(dumped.exitCode, 0, dumped.output);
    await pool.query("delete from runtime_extension_artifact_bindings where extension_id='app.sales-live'");
    await pool.query("delete from runtime_extension_artifacts where extension_id='app.sales-live'");
    await pool.query("update runtime_extensions set metadata_json='{\"corrupt\":true}'::jsonb where extension_id='app.sales-live'");
    assert.equal(await artifacts.resolve({ owner: { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-live" }, generationId: updated.generationId, artifactDigest: byGeneration.get(updated.generationId).authority.artifactDigest }), undefined);
    await assert.rejects(manager.inventory("customer-alpha", "production"), { code: "ARTIFACT_AUTHORITY_REJECTED" });
    const restored = await container.exec(["pg_restore", "--clean", "--if-exists", "--no-owner", `--dbname=${uri.toString()}`, "/tmp/p9-extension.dump"]);
    assert.equal(restored.exitCode, 0, restored.output);
    assert.deepEqual(await manager.inventory("customer-alpha", "production"), beforeRestore);
    for (const release of releases) {
      assert.equal(await pipeline.reverify(release.authority, { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-live" }), true);
      assert.equal((await artifacts.read(release.authority.artifactDigest)).verified.artifactDigest, release.authority.artifactDigest);
    }
    assert.deepEqual(await invokeTraffic(), { marker: "sales-live-v2", generationId: updated.generationId });

    trafficProbe.resume();
    trafficProbe.transition("rollback", [updated.generationId, installed.generationId]);
    await trafficProbe.waitForGeneration("rollback", updated.generationId);
    const rollback = await manager.plan(request("rollback", "1.0.0", updated.revisionAfter));
    const rolledBack = await manager.rollback(rollback.operationId);
    await trafficProbe.waitForGeneration("rollback", rolledBack.generationId);
    assert.equal(rolledBack.generationId, installed.generationId);
    assert.deepEqual(await manager.rollback(rollback.operationId), rolledBack);
    const rolledBackRoute = await routePage.goto(`${fixedRouteHost.url}/apps/sales-live/activity/42`);
    assert.equal(rolledBackRoute?.status(), 200, "the fixed route must resolve the rolled-back active generation without a rebuild");
    await routePage.getByRole("heading", { name: "sales-live-v1" }).waitFor();
    assert.deepEqual(await routePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: rolledBack.generationId, route: "/apps/sales-live/activity/42", actorSessionId: "customer-session-1" });
    assert.equal(fixedRouteHost.routeRequests.every((request) => request.route === "/apps/sales-live/activity/42"), true, "the customer host did not use the declared fixed catch-all route");
    assert.equal(fixedRouteHost.scriptBuilds, 1, "the customer host rebuilt its fixed route during install, update, or rollback");
    const rolledBackHostScriptDigest = await fixedRouteScriptDigest(fixedRouteHost);
    assert.equal(rolledBackHostScriptDigest, preInstallHostScriptDigest, "the customer host script changed during app rollback");
    const rollbackTraffic = await fetch(`${gateway.url}/rollback`);
    assert.equal(rollbackTraffic.status, 200);
    assert.equal(JSON.parse(await rollbackTraffic.text()).generationId, installed.generationId);
    assert.deepEqual(await invokeTraffic(), { marker: "sales-live-v1", generationId: installed.generationId });
    await trafficProbe.stop();
    trafficProbe.assertEvidence({
      install: ["host-gateway-generation-0", "app-sales-live-generation-1"],
      update: ["app-sales-live-generation-1", "app-sales-live-generation-2"],
      rollback: ["app-sales-live-generation-2", "app-sales-live-generation-1"]
    });
    continuousHttp = trafficProbe.summary();

    const irreversibleUpdate = await manager.plan(request("update", "2.0.0", rolledBack.revisionAfter));
    await manager.stage(irreversibleUpdate.operationId);
    const cutover = await manager.activate(irreversibleUpdate.operationId);
    assert.equal(cutover.rollback, "blocked-irreversible");

    await pool.query("update runtime_extensions set active_generation=jsonb_set(active_generation, '{artifactDigest}', to_jsonb($1::text)) where extension_id='app.sales-live'", [digest("f")]);
    await assert.rejects(manager.inventory("customer-alpha", "production"), { code: "ARTIFACT_AUTHORITY_REJECTED" });

    const disablePlan = await manager.plan(request("disable", "2.0.0", cutover.revisionAfter));
    const disabled = await manager.disable(disablePlan.operationId);
    assert.deepEqual(await manager.disable(disablePlan.operationId), disabled);
    const uninstallPlan = await manager.plan(request("uninstall", "2.0.0", disabled.revisionAfter));
    const uninstalled = await manager.uninstall(uninstallPlan.operationId);
    assert.deepEqual(await manager.uninstall(uninstallPlan.operationId), uninstalled);
    console.log(`P9_RUNTIME_JOURNEY_EVIDENCE=${JSON.stringify({
      scenarios: ["SCN-11", "SCN-16"],
      productionDockerExecution: {
        runner: "DockerHotApplicationSandboxSupervisor",
        image: "node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43",
        startedGenerationIds: [...new Set(dockerExecutions.filter((execution) => execution.event === "started").map((execution) => execution.generationId))],
        stoppedGenerationIds: [...new Set(dockerExecutions.filter((execution) => execution.event === "stopped").map((execution) => execution.generationId))]
      },
      oldGenerationDrain: { generationId: installed.generationId, leaseObserved: true, runnerAdmissionBeforeCutover: true, staleLeaseDenied: true, completed: true },
      fixedRouteAuthority: {
        startedBeforeInstall: true,
        preInstallStatus: preInstallRoute.status,
        scriptBuilds: fixedRouteHost.scriptBuilds,
        scriptDigests: [preInstallHostScriptDigest, updatedHostScriptDigest, rolledBackHostScriptDigest]
      },
      lostInvalidationRecovery,
      continuousHttp
    })}`);
  } finally {
    await trafficProbe?.stop();
    await browserContext?.close();
    await browser?.close();
    await Promise.allSettled(consumerFleet.map((consumer) => consumer.close()));
    await Promise.allSettled(hosts.map((host) => host.close()));
    await pool.end();
    await container.stop();
  }
});
