import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { chromium } from "playwright";

import { ArtifactVerifier, buildBundle, canonicalJson, CatalogClient, InMemoryCatalogCheckpointStore, sha256 } from "@k-nex/extension-bundler";
import { DockerHotApplicationSandboxSupervisor, dockerIsolationPolicyFromEnvironment } from "@k-nex/extension-runner";
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

function requestFixedRoute(host, path) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(`${host.url}${path}`, { ca: host.tlsCertificate, rejectUnauthorized: true }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end();
  });
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

function stateActivation(authority, now, version = "1.0.0") {
  return {
    authority, version,
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
  await store.stageGeneration({ operationId: operation.operationId, leaseToken: operation.leaseToken, stage: stateActivation(authority, now, change.targetVersion) });
  return store.readOperation(operation.operationId);
}

async function rollbackMutationSnapshot(pool, extensionId) {
  const values = ["customer-alpha", "production", "hot-application", extensionId];
  const scopedRows = async (table, orderBy) => (await pool.query(
    `select to_jsonb(row) value from ${table} row
     where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 ${orderBy}`,
    values
  )).rows.map(({ value }) => value);
  const receipts = await pool.query(
    `select to_jsonb(receipt) value from runtime_extension_transition_receipts receipt
     join runtime_extension_operations operation using (operation_id)
     where operation.application_id=$1 and operation.environment=$2 and operation.delivery_class=$3 and operation.extension_id=$4
     order by receipt.receipt_id`,
    values
  );
  const revision = await pool.query(
    "select to_jsonb(row) value from runtime_extension_inventory_revisions row where application_id=$1 and environment=$2",
    values.slice(0, 2)
  );
  const budget = await pool.query(
    "select to_jsonb(row) value from runtime_extension_operation_budget row where application_id=$1 and environment=$2",
    values.slice(0, 2)
  );
  return {
    pointer: await scopedRows("runtime_extensions", "order by extension_id"),
    generations: await scopedRows("runtime_extension_generations", "order by generation_id"),
    revision: revision.rows.map(({ value }) => value),
    operations: await scopedRows("runtime_extension_operations", "order by operation_id"),
    budget: budget.rows.map(({ value }) => value),
    receipts: receipts.rows.map(({ value }) => value),
    audit: await scopedRows("runtime_extension_audit", "order by audit_id"),
    outbox: await scopedRows("runtime_extension_outbox", "order by event_id")
  };
}

async function waitForRuntimeExtensionLock(pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query(
      "select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select pg_advisory_xact_lock%' limit 1"
    );
    if (result.rowCount === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Rollback never waited on its runtime extension advisory lock.");
}

function releaseDefinition(generation, version, marker, compatibility) {
  const generationId = `app-sales-live-generation-${generation}`;
  const bundle = buildBundle({
    manifest: {
      schemaVersion: 1, deliveryClass: "hot-application", id: "app.sales-live", displayName: "Sales live", version, runtimeAbi: "1.0.0",
      entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] },
      capabilities: [{ kind: "records", required: true, reason: "Read the bounded Hot Application fixture.", operations: ["query"], resources: [{ id: "sales.records", version: 1 }] }],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 },
      settings: [], screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }, { id: "sales.activity", route: "/activity/:activityid", entrypoint: "ui/main.mjs" }], navigation: [], sources: [{ id: "sales.live", path: "schemas/sales-live.json" }], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: ["assets/marker.txt"], localization: [], healthChecks: []
    },
    files: [
      { path: "server/main.mjs", bytes: Buffer.from(`export default async ({ input, host }) => { const scope = await host.call("records.query", input); return { marker: ${JSON.stringify(marker)}, generationId: scope.generationId }; };\n`), contentType: "application/javascript" },
      { path: "ui/main.mjs", bytes: Buffer.from(`let port,sessionId,appId,generationId,sequence=0;const send=(type,body={})=>port.postMessage({schemaVersion:1,sessionId,appId,generationId,sequence:++sequence,direction:'realm-to-host',type,...body});const tree=(status)=>({nodeId:'root',component:'stack',props:{},events:[],children:[{nodeId:'title',component:'heading',props:{level:1,text:${JSON.stringify(marker)}},events:[],children:[]},{nodeId:'status',component:'heading',props:{level:2,text:status},events:[],children:[]},{nodeId:'query',component:'button',props:{label:'Query source'},events:[{event:'press',handlerId:'sales.live.query'}],children:[]}]});const request=()=>send('request',{operation:'source',requestId:'source-'+(sequence+1),targetId:'sales.live',input:{delayMs:500}});self.onmessage=({data,ports})=>{if(data?.type!=='connect'||!ports[0])return;port=ports[0];port.onmessage=({data})=>{if(data?.type==='bootstrap'){({sessionId,appId,generationId}=data);send('ready');send('render',{root:tree('source-idle')});}else if(data?.type==='event')request();else if(data?.type==='response-ok')send('render',{root:tree('source:'+data.output.generationId)});else if(data?.type==='response-error')send('render',{root:tree('source-denied')});};port.start();};\n`), contentType: "application/javascript" },
      { path: "schemas/sales-live.json", bytes: Buffer.from('{"schemaVersion":1,"id":"sales.live"}\n'), contentType: "application/json" },
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

test("proves catalog-scoped verified-artifact acceptances preserve independent trust for identical bytes in PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_artifact_acceptances").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  try {
    await boot(container.getConnectionUri());
    const release = releaseDefinition(99, "3.0.0", "catalog-scoped-bytes", { status: "compatible", windowId: "catalog-acceptance-window", closesAt: "2026-08-30T09:00:00.000Z", migrationDigest: digest("9"), dataRevision: 1 });
    const catalogA = signedCatalog([release.entry], 1);
    const catalogB = signedCatalog([release.entry], 2);
    const catalogC = signedCatalog([release.entry], 3);
    const acceptedA = verifiedRelease(release, catalogA);
    const acceptedB = verifiedRelease({ ...release, generationId: "app-sales-live-generation-98" }, catalogB);
    const acceptedC = verifiedRelease({ ...release, generationId: "app-sales-live-generation-97" }, catalogC);
    const artifactsA = new PostgresVerifiedArtifactStore(pool, new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [publisher.identity]: publisher.publicKey }));
    const artifactsB = new PostgresVerifiedArtifactStore(pool, new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [publisher.identity]: publisher.publicKey }));
    const artifactsC = new PostgresVerifiedArtifactStore(pool, new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [publisher.identity]: publisher.publicKey }));

    await Promise.all([artifactsA.stage(acceptedA.stage), artifactsB.stage(acceptedB.stage)]);
    assert.deepEqual((await pool.query(`
      select (select count(*)::int from runtime_extension_artifacts) bytes,
             (select count(*)::int from runtime_extension_artifact_acceptances) acceptances
    `)).rows, [{ bytes: 1, acceptances: 2 }]);
    assert.equal((await artifactsA.resolve({ owner: acceptedA.stage.owner, generationId: acceptedA.generationId, artifactDigest: release.entry.artifactDigest }))?.authority.catalogDigest, acceptedA.authority.catalogDigest);
    assert.equal((await artifactsB.resolve({ owner: acceptedB.stage.owner, generationId: acceptedB.generationId, artifactDigest: release.entry.artifactDigest }))?.authority.catalogDigest, acceptedB.authority.catalogDigest);

    await assert.rejects(artifactsB.stage({ ...acceptedB.stage, owner: acceptedA.stage.owner, authority: { ...acceptedA.authority, catalogDigest: acceptedB.authority.catalogDigest } }), { code: "ARTIFACT_CONFLICT" });
    assert.equal((await artifactsA.resolve({ owner: acceptedA.stage.owner, generationId: acceptedA.generationId, artifactDigest: release.entry.artifactDigest }))?.authority.catalogDigest, acceptedA.authority.catalogDigest);

    const missingCatalogDigest = digest("f");
    await assert.rejects(pool.query(
      `insert into runtime_extension_artifact_bindings
        (application_id, environment, delivery_class, extension_id, generation_id, artifact_digest, catalog_digest, authority_json, activation_json, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
      ["customer-alpha", "production", "hot-application", "app.sales-live", "app-sales-live-generation-missing-acceptance", release.entry.artifactDigest, missingCatalogDigest,
        JSON.stringify({ ...acceptedA.authority, generationId: "app-sales-live-generation-missing-acceptance", catalogDigest: missingCatalogDigest }), JSON.stringify(acceptedA.stage.activation), release.version]
    ), { code: "23503" });

    await pool.query("update runtime_extension_artifact_acceptances set catalog_json=$1::jsonb where artifact_digest=$2 and catalog_digest=$3", [JSON.stringify(catalogA), release.entry.artifactDigest, acceptedB.authority.catalogDigest]);
    await assert.rejects(artifactsB.resolve({ owner: acceptedB.stage.owner, generationId: acceptedB.generationId, artifactDigest: release.entry.artifactDigest }), { code: "ARTIFACT_INVALID" });
    await assert.rejects(artifactsB.runnerSource().load({ owner: acceptedB.stage.owner, artifactDigest: release.entry.artifactDigest, serverEntrypoint: "server/main.mjs" }), { code: "ARTIFACT_INVALID" });
    assert.equal((await artifactsA.resolve({ owner: acceptedA.stage.owner, generationId: acceptedA.generationId, artifactDigest: release.entry.artifactDigest }))?.authority.catalogDigest, acceptedA.authority.catalogDigest);

    await pool.query(
      `insert into runtime_extension_artifact_acceptances
        (artifact_digest, catalog_digest, catalog_json, provenance_bytes, delivery_class, extension_id, version, runtime_abi)
       values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
      [release.entry.artifactDigest, acceptedC.authority.catalogDigest, JSON.stringify(catalogA), acceptedC.stage.verification.provenance,
        "hot-application", "app.sales-live", release.version, "1.0.0"]
    );
    const conflictBefore = await pool.query(`
      select (select count(*)::int from runtime_extension_artifact_acceptances) acceptances,
             (select count(*)::int from runtime_extension_artifact_bindings) bindings
    `);
    await assert.rejects(artifactsC.stage(acceptedC.stage), { code: "ARTIFACT_CONFLICT" });
    assert.deepEqual((await pool.query(`
      select (select count(*)::int from runtime_extension_artifact_acceptances) acceptances,
             (select count(*)::int from runtime_extension_artifact_bindings) bindings
    `)).rows, conflictBefore.rows);
    assert.equal(await artifactsC.resolve({ owner: acceptedC.stage.owner, generationId: acceptedC.generationId, artifactDigest: release.entry.artifactDigest }), undefined);
    await assert.rejects(artifactsC.runnerSource().load({ owner: acceptedC.stage.owner, artifactDigest: release.entry.artifactDigest, serverEntrypoint: "server/main.mjs" }), { code: "ARTIFACT_UNAVAILABLE" });
  } finally {
    await pool.end();
    await container.stop();
  }
});

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
    await assert.rejects(artifacts.read(release.entry.artifactDigest, acceptedRelease.authority.catalogDigest), { code: "ARTIFACT_INVALID" });

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

test("persists exact active-generation POLICY_VIOLATION runner quarantine across a runner restart", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("runtime_runner_quarantine").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const now = new Date("2026-08-29T09:00:00.000Z");
  const clock = { now: () => now };
  const store = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  const competingStore = new PostgresRuntimeExtensionStore(pool, clock, digest("7"));
  try {
    await boot(container.getConnectionUri());
    const change = stateRequest("app.sales-runner-quarantine", "runner-quarantine");
    const warming = await prepareStateGeneration(store, change, digest("a"), "runner-quarantine-worker", now);
    const activated = await store.activateGeneration(warming.operationId, warming.leaseToken);
    const active = (await store.inventory(change.applicationId, change.environment)).extensions.hotApplications[change.extension.id].activeGeneration;
    const siblingChange = stateRequest("app.sales-runner-sibling", "runner-quarantine-sibling");
    const siblingWarming = await prepareStateGeneration(store, siblingChange, digest("b"), "runner-quarantine-sibling-worker", now);
    const siblingActivated = await store.activateGeneration(siblingWarming.operationId, siblingWarming.leaseToken);
    const sibling = (await store.inventory(siblingChange.applicationId, siblingChange.environment)).extensions.hotApplications[siblingChange.extension.id].activeGeneration;
    const adapter = new RuntimeStoreRunnerQuarantineAdapter(store);
    const identity = { applicationId: change.applicationId, environment: change.environment, appId: change.extension.id, generationId: active.generationId };
    const leaseId = await store.acquireGenerationLease({ applicationId: change.applicationId, environment: change.environment, extension: change.extension, generationId: active.generationId, holder: "runner-quarantine-proof", ttlMs: 30_000 });
    assert.equal(await adapter.admit(identity, leaseId), true);
    const supervisor = new DockerHotApplicationSandboxSupervisor(
      {}, adapter, { active: (runnerIdentity) => adapter.active(runnerIdentity), admit: (runnerIdentity, drainLeaseId) => adapter.admit(runnerIdentity, drainLeaseId) },
      { async started() {}, async stopped() {} }, { async load() { throw new Error("quarantine containment proof never loads an artifact"); } },
      dockerIsolationPolicyFromEnvironment("local-docker-test-only")
    );
    const supervisorState = supervisor.state(identity);
    supervisorState.active = 2;
    supervisorState.containers.add("runner-quarantine-current");
    supervisorState.containers.add("runner-quarantine-sibling");
    const containmentAttempts = [];
    supervisor.kill = async (containerName) => {
      containmentAttempts.push(containerName);
      if (containerName === "runner-quarantine-sibling") throw new Error("sibling containment failed");
    };
    const request = {
      applicationId: change.applicationId,
      environment: change.environment,
      appId: change.extension.id,
      generationId: active.generationId,
      expectedRevision: activated.revisionAfter,
      reason: "POLICY_VIOLATION"
    };
    assert.equal(supervisor.health(identity).activeInvocations, 2, "proof models two concurrent invocation containers");
    assert.equal(
      await supervisor.quarantineGeneration(supervisorState, identity, "POLICY_VIOLATION", "runner-quarantine-current"),
      true,
      "containment failure must remain visible without replacing the causal runner error"
    );
    assert.deepEqual(containmentAttempts, ["runner-quarantine-sibling"]);
    const race = await Promise.allSettled([
      adapter.quarantine(identity, "POLICY_VIOLATION"),
      competingStore.quarantineRunnerGeneration({ ...request, expectedRevision: request.expectedRevision - 1 }),
      competingStore.quarantineRunnerGeneration({ ...request, generationId: "app-sales-runner-quarantine-generation-stale" })
    ]);
    assert.deepEqual(race.map(({ status }) => status).sort(), ["fulfilled", "rejected", "rejected"], race.map((result) => result.status === "rejected" ? `${result.reason.code ?? result.reason.name}:${result.reason.message}` : "fulfilled").join(" | "));
    const receipt = (await pool.query("select receipt_json from runtime_extension_runner_quarantine_receipts where application_id=$1 and extension_id=$2", [change.applicationId, change.extension.id])).rows[0].receipt_json;
    assert.deepEqual(await store.quarantineRunnerGeneration(request), receipt, "the exact runner quarantine request must replay its original receipt");
    const beforeReplay = await pool.query("select (select count(*)::int from runtime_extension_runner_quarantine_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'receiptId'=$1) outbox", [receipt.receiptId]);
    const restartedAdapter = new RuntimeStoreRunnerQuarantineAdapter(new PostgresRuntimeExtensionStore(pool, clock, digest("7")));
    assert.equal(receipt.reason, "POLICY_VIOLATION");
    assert.equal(receipt.generationId, active.generationId);
    assert.equal(receipt.revisionBefore, activated.revisionAfter);
    assert.equal(receipt.revisionAfter, activated.revisionAfter + 1);
    assert.equal(await restartedAdapter.active(identity), false);
    assert.equal(await restartedAdapter.admit(identity, leaseId), false, "restart must not readmit the cleared lease");
    await restartedAdapter.quarantine(identity, "POLICY_VIOLATION");
    await assert.rejects(competingStore.quarantineRunnerGeneration({ ...request, reason: "CONTAINER_FAILED", expectedRevision: receipt.revisionBefore }), { code: "REVISION_CONFLICT" });
    await assert.rejects(competingStore.quarantineRunnerGeneration({ ...request, generationId: "app-sales-runner-quarantine-generation-stale", expectedRevision: receipt.revisionAfter }), { code: "GENERATION_MISMATCH" });
    assert.deepEqual((await pool.query("select (select count(*)::int from runtime_extension_runner_quarantine_receipts) receipts, (select count(*)::int from runtime_extension_audit) audits, (select count(*)::int from runtime_extension_outbox where event_json->>'receiptId'=$1) outbox", [receipt.receiptId])).rows, beforeReplay.rows, "replay and stale runner races must be inert");
    const inventory = await store.inventory(change.applicationId, change.environment);
    assert.deepEqual(inventory.extensions.hotApplications[change.extension.id], {
      disposition: "quarantined", revision: receipt.revisionAfter, lastOperationId: receipt.quarantineTransitionId,
      lastReceiptId: receipt.receiptId, stateDigest: inventory.extensions.hotApplications[change.extension.id].stateDigest,
      retainedGeneration: active
    });
    assert.equal(await store.liveGenerationLeaseCount(change.applicationId, change.environment, change.extension, active.generationId), 0);
    assert.deepEqual((await pool.query("select state from runtime_extension_generations where application_id=$1 and extension_id=$2 and generation_id=$3", [change.applicationId, change.extension.id, active.generationId])).rows, [{ state: "retired" }]);
    assert.deepEqual((await pool.query("select reason, expected_revision, revision, receipt_json->>'generationId' generation_id from runtime_extension_runner_quarantine_receipts")).rows, [{ reason: "POLICY_VIOLATION", expected_revision: activated.revisionAfter, revision: receipt.revisionAfter, generation_id: active.generationId }]);
    assert.deepEqual((await pool.query("select count(*)::int audits, (select count(*)::int from runtime_extension_outbox where event_json->>'receiptId'=$1 and event_json->>'operationPhase'='failed' and event_json->>'lifecycleState'='quarantined') outbox from runtime_extension_audit where event_json->>'receiptId'=$1 and event_json->>'operationPhase'='failed' and event_json->>'lifecycleState'='quarantined'", [receipt.receiptId])).rows, [{ audits: 1, outbox: 1 }]);
    const siblingAdapter = new RuntimeStoreRunnerQuarantineAdapter(store);
    const siblingIdentity = { applicationId: siblingChange.applicationId, environment: siblingChange.environment, appId: siblingChange.extension.id, generationId: sibling.generationId };
    const siblingLease = await store.acquireGenerationLease({ applicationId: siblingChange.applicationId, environment: siblingChange.environment, extension: siblingChange.extension, generationId: sibling.generationId, holder: "runner-quarantine-sibling-proof", ttlMs: 30_000 });
    assert.equal(await siblingAdapter.active(siblingIdentity), true);
    assert.equal(await siblingAdapter.admit(siblingIdentity, siblingLease), true);
    assert.equal((await store.inventory(siblingChange.applicationId, siblingChange.environment)).extensions.hotApplications[siblingChange.extension.id].activeGeneration.generationId, siblingActivated.generationId);
    console.log(`P9_RUNNER_QUARANTINE_EVIDENCE=${JSON.stringify({ scenarios: ["SCN-07"], reason: receipt.reason, generationId: receipt.generationId, revision: [receipt.revisionBefore, receipt.revisionAfter], leaseCleared: true, retired: true, restartDenied: true, replayIdempotent: true, staleRacesInert: true, siblingContainmentFailed: true, siblingActive: true })}`);
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

    const activeVersionRequest = stateRequest("app.sales-semver", "install:app.sales-semver:1-0-1", { version: "1.0.1" });
    const activeVersionOperation = await prepareStateGeneration(storeA, activeVersionRequest, digest("e"), "semver-worker", now);
    const activeVersionReceipt = await storeA.activateGeneration(activeVersionOperation.operationId, activeVersionOperation.leaseToken);
    await assert.rejects(
      claimState(storeB, stateRequest("app.sales-semver", "update:app.sales-semver:1-0-0-attacker", { operation: "update", version: "1.0.0+attacker", expectedRevision: activeVersionReceipt.revisionAfter }), digest("f"), "semver-attacker"),
      { code: "VERSION_DOWNGRADE" }
    );

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
  let now = new Date("2026-08-29T09:00:00.000Z");
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
      releaseDefinition(3, "2.0.0", "sales-live-v3", { status: "irreversible", decisionId: "sales-contract-cutover", reason: "The storage contract no longer supports generation 1.", migrationDigest: digest("3"), dataRevision: 3 }),
      releaseDefinition(4, "2.1.0", "sales-live-v4", { status: "compatible", windowId: "sales-window-4", closesAt: "2026-08-30T10:59:59.000Z", migrationDigest: digest("4"), dataRevision: 4 }),
      releaseDefinition(5, "2.2.0", "sales-live-v5", { status: "compatible", windowId: "sales-window-5", closesAt: "2026-08-30T11:59:59.000Z", migrationDigest: digest("5"), dataRevision: 5 })
    ];
    const catalog = signedCatalog(releaseDrafts.map((release) => release.entry));
    const releases = releaseDrafts.map((release) => verifiedRelease(release, catalog));
    const byVersion = new Map(releases.map((release) => [release.version, release]));
    const byGeneration = new Map(releases.map((release) => [release.generationId, release]));
    const verifier = new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore()), { [publisher.identity]: publisher.publicKey });
    const artifacts = new PostgresVerifiedArtifactStore(pool, verifier);
    await Promise.all(releases.map((release) => artifacts.stage(release.stage)));
    const storedBytes = await pool.query("select artifact_digest, octet_length(artifact_bytes)::int artifact_bytes, (select octet_length(provenance_bytes)::int from runtime_extension_artifact_acceptances where artifact_digest=runtime_extension_artifacts.artifact_digest) provenance_bytes from runtime_extension_artifacts order by artifact_digest");
    assert.equal(storedBytes.rows.length, 5);
    assert.equal(storedBytes.rows.every((row) => row.artifact_bytes > 0 && row.provenance_bytes > 0), true);

    const warmed = [];
    let readinessSequence = 0;
    const warmer = new ReferenceHotApplicationGenerationWarmer({
      runner: { prepareServer: async ({ artifact }) => { assert.match((await artifacts.runnerSource().load({ owner: { ...artifact.authority, generationId: artifact.authority.generationId }, artifactDigest: artifact.authority.artifactDigest, serverEntrypoint: "server/main.mjs" })).source, /export default async/u); warmed.push(`runner:${artifact.authority.generationId}`); } },
      remoteUi: { prepareRemoteUi: async ({ artifact }) => { assert.ok((await artifacts.read(artifact.authority.artifactDigest, artifact.authority.catalogDigest))?.verified.files.get("ui/main.mjs")); warmed.push(`remote-ui:${artifact.authority.generationId}`); } },
      storage: { prepareStorage: async ({ artifact }) => { assert.equal((await pool.query("select to_regclass('public.runtime_extension_storage_namespaces')::text storage")).rows[0].storage, "runtime_extension_storage_namespaces"); warmed.push(`storage:${artifact.authority.generationId}`); } },
      surfaces: { prepareFixedSurfaces: async ({ manifest, artifact }) => { assert.equal(manifest.screens.some((screen) => screen.route === "/activity/:activityid"), true); warmed.push(`surfaces:${artifact.authority.generationId}`); } },
      clock
    });
    const deterministicWarmer = {
      async warm(input) {
        const readiness = await warmer.warm(input);
        const sequence = ++readinessSequence;
        const readyAt = clock.now();
        return {
          ...readiness,
          leaseToken: `ready:${readiness.generationId}:fixture-${sequence}`,
          readyAt: readyAt.toISOString(),
          expiresAt: new Date(readyAt.valueOf() + 60_000).toISOString()
        };
      }
    };
    const pipeline = new DurableDynamicArtifactPipeline(artifacts);
    const dynamicRuntime = new DurableDynamicGenerationRuntime(artifacts, deterministicWarmer);
    const manager = new PluginManager("activation-worker", new TrustedAutomationOperationAuthorizer("github-actions:phase-9"), {
      validate: async () => undefined,
      plan: async (change) => {
        const release = byVersion.get(change.targetVersion);
        if (!release) throw new Error("Fixture release is unavailable.");
        return { plan: plan(change.operationId, change, release).plan, sourceCommit: release.authority.sourceCommit, generationId: release.generationId };
      }
    }, storeA, pipeline, { request: async () => { throw new Error("Static delivery is not used."); } }, { request: async () => { throw new Error("Static delivery is not used."); }, reverify: async () => false }, dynamicRuntime, clock);

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
        const barrier = admissionBarrier;
        if (barrier?.generationId === runnerIdentity.generationId) {
          barrier.leaseId ??= drainLeaseId;
          barrier.reached.resolve();
          await barrier.release.promise;
          const admitted = await runnerQuarantine.admit(runnerIdentity, drainLeaseId);
          barrier.admitted = admitted;
          return admitted;
        }
        return runnerQuarantine.admit(runnerIdentity, drainLeaseId);
      }
    };
    const runner = new DockerHotApplicationSandboxSupervisor(runnerGateway, runnerQuarantine, runnerAuthority, {
      started(identity) { dockerExecutions.push({ event: "started", generationId: identity.generationId }); },
      stopped(identity) { dockerExecutions.push({ event: "stopped", generationId: identity.generationId }); }
    }, artifacts.runnerSource(), dockerIsolationPolicyFromEnvironment(process.env.K_NEX_RUNNER_ISOLATION_POLICY));
    const trafficRuntime = new AuthoritativeHotApplicationRuntime(storeB, artifacts, capabilityTokens, runner, {
      applicationId: "customer-alpha", environment: "production", appId: "app.sales-live"
    }, "runtime-traffic-gateway");
    let trafficSequence = 0;
    const activeTrafficGeneration = async () => {
      const inventory = await storeB.inventory("customer-alpha", "production");
      const entry = inventory.extensions.hotApplications[identity.id];
      if (!entry || entry.disposition !== "active") throw new Error("Traffic has no authoritative active Hot Application generation.");
      return Object.freeze({ generationId: entry.activeGeneration.generationId, artifactDigest: entry.activeGeneration.artifactDigest });
    };
    const invokeTraffic = async (input = {}, expectedGeneration = undefined) => trafficRuntime.invoke({
      input,
      actor: { principalId: "user:one", effectiveActorId: "user:one" },
      correlationId: `traffic-correlation-${++trafficSequence}`,
      expectedGeneration: expectedGeneration ?? await activeTrafficGeneration()
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
    let sourceAdmissionBarrier;
    const pinnedSourceExecutions = [];
    const fixedRouteHost = await startHotApplicationFixedRouteHost({
      store: storeA, artifacts, applicationId: "customer-alpha", environment: "production", extension: identity,
      invokeSource: async ({ identity: routeSessionIdentity, expectedGeneration, input }) => {
        const barrier = sourceAdmissionBarrier;
        if (barrier?.sessionId === routeSessionIdentity.sessionId) {
          barrier.reached.resolve();
          await barrier.release.promise;
        }
        const output = await invokeTraffic(input, expectedGeneration);
        pinnedSourceExecutions.push(Object.freeze({ sessionId: routeSessionIdentity.sessionId, generationId: output.generationId }));
        return output;
      }
    });
    hosts.push(fixedRouteHost);
    const preInstallRoute = await requestFixedRoute(fixedRouteHost, "/apps/sales-live/activity/42");
    assert.equal(preInstallRoute.status, 404, "the immutable customer route host must exist and fail closed before app installation");

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
    browserContext = await browser.newContext({ ignoreHTTPSErrors: true });
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
    assert.deepEqual(await routePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: installed.generationId, route: "/apps/sales-live/activity/42" });
    const drainingRoutePage = await browserContext.newPage();
    await drainingRoutePage.goto(`${fixedRouteHost.url}/apps/sales-live/activity/42`);
    await drainingRoutePage.getByRole("heading", { name: "sales-live-v1" }).waitFor();
    const installedFramePath = await drainingRoutePage.evaluate(() => new URL(window.__K_NEX_HOT_APPLICATION_ROUTE__.remoteUiFrameUrl).pathname);
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
    await trafficProbe.pause();
    const routeSessionId = await routePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE__.sessionId);
    const drainingRouteSessionId = await drainingRoutePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE__.sessionId);
    const sourceBarrier = {
      sessionId: routeSessionId,
      reached: Promise.withResolvers(),
      release: Promise.withResolvers()
    };
    sourceAdmissionBarrier = sourceBarrier;
    await routePage.getByRole("button", { name: "Query source" }).click();
    await sourceBarrier.reached.promise;
    assert.equal(fixedRouteHost.sourceRequests.some((request) => request.sessionId === routeSessionId && request.generationId === installed.generationId && request.status === "admitted"), true, "the pinned G1 source request never reached the host-authorized pre-runtime gap");
    const barrier = {
      generationId: installed.generationId,
      reached: Promise.withResolvers(),
      release: Promise.withResolvers(),
      admitted: undefined,
      leaseId: undefined
    };
    admissionBarrier = barrier;
    await drainingRoutePage.getByRole("button", { name: "Query source" }).click();
    for (let attempt = 0; attempt < 50 && !fixedRouteHost.sourceRequests.some((request) => request.sessionId === drainingRouteSessionId && request.generationId === installed.generationId && request.status === "admitted"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fixedRouteHost.sourceRequests.some((request) => request.sessionId === drainingRouteSessionId && request.generationId === installed.generationId && request.status === "admitted"), true, "the host-owned G1 source gateway never admitted the lease-holding request before cutover");
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
      sourceAdmissionBarrier = undefined;
      barrier.release.resolve();
      sourceBarrier.release.resolve();
    }
    await drainingRoutePage.getByRole("heading", { name: `source:${installed.generationId}` }).waitFor();
    await routePage.getByRole("heading", { name: "source-denied" }).waitFor();
    assert.equal(barrier.admitted, true, "the old generation must be admitted through its exact live lease after cutover");
    assert.equal(fixedRouteHost.sourceRequests.some((request) => request.sessionId === routeSessionId && request.generationId === installed.generationId && request.status === "runtime-denied"), true, "the host-authorized G1 request must be rejected when its pinned generation is no longer active");
    assert.equal(pinnedSourceExecutions.some((execution) => execution.sessionId === routeSessionId), false, "the pre-runtime G1/G2 cutover-gap request reached an executor after its pinned generation was denied");
    assert.equal(pinnedSourceExecutions.some((execution) => execution.sessionId === drainingRouteSessionId && execution.generationId === installed.generationId), true, "the G1 request that already held a drain lease did not return from G1");
    const sourceAdmission = Object.freeze({
      cutoverGap: Object.freeze({
        sessionId: routeSessionId,
        generationId: fixedRouteHost.sourceRequests.find((request) => request.sessionId === routeSessionId && request.status === "admitted")?.generationId ?? null,
        hostAuthorizedBeforeRuntime: fixedRouteHost.sourceRequests.some((request) => request.sessionId === routeSessionId && request.generationId === installed.generationId && request.status === "admitted"),
        runtimeDeniedAfterCutover: fixedRouteHost.sourceRequests.some((request) => request.sessionId === routeSessionId && request.generationId === installed.generationId && request.status === "runtime-denied"),
        executedGenerationId: pinnedSourceExecutions.find((execution) => execution.sessionId === routeSessionId)?.generationId ?? null
      }),
      leaseHeldG1: Object.freeze({
        sessionId: drainingRouteSessionId,
        generationId: fixedRouteHost.sourceRequests.find((request) => request.sessionId === drainingRouteSessionId && request.status === "admitted")?.generationId ?? null,
        hostAuthorizedBeforeRuntime: fixedRouteHost.sourceRequests.some((request) => request.sessionId === drainingRouteSessionId && request.generationId === installed.generationId && request.status === "admitted"),
        runnerAdmissionWithLease: barrier.admitted === true,
        returnedGenerationId: pinnedSourceExecutions.find((execution) => execution.sessionId === drainingRouteSessionId)?.generationId ?? null
      })
    });
    trafficProbe.resume();
    await trafficProbe.waitForGeneration("update", updated.generationId);
    assert.equal(updated.previousGenerationId, installed.generationId);
    assert.deepEqual(await manager.activate(update.operationId), updated);
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
    const updatedRoutePage = await browserContext.newPage();
    const updatedRoute = await updatedRoutePage.goto(`${fixedRouteHost.url}/apps/sales-live/activity/42`);
    assert.equal(updatedRoute?.status(), 200, "the fixed route must resolve the active updated generation without a rebuild");
    await updatedRoutePage.getByRole("heading", { name: "sales-live-v2" }).waitFor();
    assert.deepEqual(await updatedRoutePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: updated.generationId, route: "/apps/sales-live/activity/42" });
    assert.equal(fixedRouteHost.routeRequests.at(-1)?.hadSession, true, "the updated fixed route lost its customer host session");
    await updatedRoutePage.getByRole("button", { name: "Query source" }).click();
    await updatedRoutePage.getByRole("heading", { name: `source:${updated.generationId}` }).waitFor();
    assert.equal((await requestFixedRoute(fixedRouteHost, installedFramePath)).status, 404, "mixed-generation G1 UI bytes must be denied after G2 becomes active");
    assert.equal(routePage.url(), `${fixedRouteHost.url}/apps/sales-live/activity/42`, "the original G1 page must remain open across the update rather than proving only a reload");
    await Promise.all([
      routePage.waitForFunction((generationId) => window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.some((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementScheduled) === true, updated.generationId),
      drainingRoutePage.waitForFunction((generationId) => window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.some((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementScheduled) === true, updated.generationId)
    ]);
    const g1RetirementDeadline = Math.max(...(await Promise.all([routePage, drainingRoutePage].map((page) => page.evaluate(() => {
      const observation = window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.find((entry) => entry.source === "snapshot-poll" && entry.retirementScheduled);
      if (!observation) throw new Error("The page did not retain its polling retirement observation.");
      return observation.observedAt + 10_000;
    })))));
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
    await pool.query("delete from runtime_extension_artifact_acceptances where extension_id='app.sales-live'");
    await pool.query("delete from runtime_extension_artifacts where not exists (select 1 from runtime_extension_artifact_acceptances where runtime_extension_artifact_acceptances.artifact_digest=runtime_extension_artifacts.artifact_digest)");
    await pool.query("update runtime_extensions set metadata_json='{\"corrupt\":true}'::jsonb where extension_id='app.sales-live'");
    assert.equal(await artifacts.resolve({ owner: { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-live" }, generationId: updated.generationId, artifactDigest: byGeneration.get(updated.generationId).authority.artifactDigest }), undefined);
    await assert.rejects(manager.inventory("customer-alpha", "production"), { code: "ARTIFACT_AUTHORITY_REJECTED" });
    const noFallbackHost = await startHotApplicationFixedRouteHost({ store: storeA, artifacts, applicationId: "customer-alpha", environment: "production", extension: identity, invokeSource: ({ input, expectedGeneration }) => invokeTraffic(input, expectedGeneration) });
    hosts.push(noFallbackHost);
    assert.equal((await requestFixedRoute(noFallbackHost, "/apps/sales-live/activity/42")).status, 404, "a freshly started fixed host must reject missing durable PostgreSQL bytes instead of falling back to a digest");
    const restored = await container.exec(["pg_restore", "--clean", "--if-exists", "--no-owner", `--dbname=${uri.toString()}`, "/tmp/p9-extension.dump"]);
    assert.equal(restored.exitCode, 0, restored.output);
    assert.deepEqual(await manager.inventory("customer-alpha", "production"), beforeRestore);
    for (const release of releases) {
      assert.equal(await pipeline.reverify(release.authority, { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-live" }), true);
      assert.equal((await artifacts.read(release.authority.artifactDigest, release.authority.catalogDigest)).verified.artifactDigest, release.authority.artifactDigest);
    }
    assert.deepEqual(await invokeTraffic(), { marker: "sales-live-v2", generationId: updated.generationId });
    const restartedFixedRouteHost = await startHotApplicationFixedRouteHost({ store: storeA, artifacts, applicationId: "customer-alpha", environment: "production", extension: identity, invokeSource: ({ input, expectedGeneration }) => invokeTraffic(input, expectedGeneration) });
    hosts.push(restartedFixedRouteHost);
    const restoredRoutePage = await browserContext.newPage();
    await restoredRoutePage.goto(`${restartedFixedRouteHost.url}/apps/sales-live/activity/42`);
    await restoredRoutePage.getByRole("heading", { name: "sales-live-v2" }).waitFor();
    assert.deepEqual(await restoredRoutePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: updated.generationId, route: "/apps/sales-live/activity/42" });

    const retained = byGeneration.get(installed.generationId);
    assert.ok(retained, "rollback fixture lost its retained verified generation");
    await pool.query(
      "update runtime_extension_generations set readiness_expires_at=$1 where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6",
      [new Date(now.valueOf() - 1_000).toISOString(), "customer-alpha", "production", "hot-application", identity.id, installed.generationId]
    );
    const expiredReadiness = await pool.query(
      "select readiness_token, readiness_expires_at::text from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5",
      ["customer-alpha", "production", "hot-application", identity.id, installed.generationId]
    );
    assert.equal(new Date(expiredReadiness.rows[0].readiness_expires_at).valueOf() <= now.valueOf(), true, "retained generation must require a fresh rollback readiness lease");

    const rollback = await manager.plan(request("rollback", "1.0.0", updated.revisionAfter));
    const rollbackOperation = await storeA.readOperation(rollback.operationId);
    assert.ok(rollbackOperation, "planned rollback operation is unavailable");
    const rollbackStage = {
      authority: retained.authority,
      version: retained.version,
      readiness: {
        generationId: retained.generationId,
        serverGenerationId: retained.generationId,
        uiGenerationId: retained.generationId,
        storageGenerationId: retained.generationId,
        leaseToken: `ready:${retained.generationId}:direct-stage`,
        readyAt: now.toISOString(),
        expiresAt: new Date(now.valueOf() + 60_000).toISOString()
      },
      compatibility: retained.compatibility,
      metadata: retained.stage.activation.metadata,
      settings: retained.stage.activation.settings,
      storageSchemaVersions: retained.stage.activation.storageSchemaVersions
    };
    const rejectedRollbackStages = [
      { name: "expired-at-store-check", expectedCode: "READINESS_EXPIRED", stage: { ...rollbackStage, readiness: { ...rollbackStage.readiness, expiresAt: now.toISOString() } } },
      { name: "wrong-owner", expectedCode: "GENERATION_MISMATCH", stage: { ...rollbackStage, authority: { ...rollbackStage.authority, applicationId: "customer-beta" } } },
      { name: "wrong-generation", expectedCode: "GENERATION_MISMATCH", stage: { ...rollbackStage, authority: { ...rollbackStage.authority, generationId: "app-sales-live-generation-99" }, readiness: { ...rollbackStage.readiness, generationId: "app-sales-live-generation-99", serverGenerationId: "app-sales-live-generation-99", uiGenerationId: "app-sales-live-generation-99", storageGenerationId: "app-sales-live-generation-99" } } },
      { name: "wrong-artifact", expectedCode: "GENERATION_MISMATCH", stage: { ...rollbackStage, authority: { ...rollbackStage.authority, artifactDigest: digest("9") } } },
      { name: "wrong-version", expectedCode: "GENERATION_MISMATCH", stage: { ...rollbackStage, version: "1.1.0" } },
      { name: "wrong-activation", expectedCode: "GENERATION_MISMATCH", stage: { ...rollbackStage, metadata: { ...rollbackStage.metadata, forged: "rollback" } } }
    ];
    for (const rejected of rejectedRollbackStages) {
      const before = await rollbackMutationSnapshot(pool, identity.id);
      await assert.rejects(storeA.rollbackGeneration(rollback.operationId, rollbackOperation.leaseToken, rejected.stage), { code: rejected.expectedCode }, rejected.name);
      assert.deepEqual(await rollbackMutationSnapshot(pool, identity.id), before, `${rejected.name} rollback stage mutated durable state`);
    }

    const rollbackLock = await pool.connect();
    let rollbackLockOpen = false;
    try {
      await rollbackLock.query("begin");
      rollbackLockOpen = true;
      await rollbackLock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson(["customer-alpha", "production", "hot-application", identity.id])]);
      const beforeExpiredWhileWaiting = await rollbackMutationSnapshot(pool, identity.id);
      const expiredWhileWaiting = storeA.rollbackGeneration(rollback.operationId, rollbackOperation.leaseToken, rollbackStage);
      await waitForRuntimeExtensionLock(pool);
      now = new Date(now.valueOf() + 60_001);
      await rollbackLock.query("commit");
      rollbackLockOpen = false;
      await assert.rejects(expiredWhileWaiting, { code: "READINESS_EXPIRED" });
      assert.deepEqual(await rollbackMutationSnapshot(pool, identity.id), beforeExpiredWhileWaiting, "Rollback whose fresh readiness expired while waiting mutated durable state");
    } finally {
      if (rollbackLockOpen) await rollbackLock.query("rollback");
      rollbackLock.release();
    }
    const beforeRollback = await rollbackMutationSnapshot(pool, identity.id);

    trafficProbe.resume();
    trafficProbe.transition("rollback", [updated.generationId, installed.generationId]);
    await trafficProbe.waitForGeneration("rollback", updated.generationId);
    assert.equal(Date.now() < g1RetirementDeadline, true, "rollback did not begin before the original G1 retirement deadline");
    const rolledBack = await manager.rollback(rollback.operationId);
    const afterRollback = await rollbackMutationSnapshot(pool, identity.id);
    const refreshedRetained = afterRollback.generations.find((generation) => generation.generation_id === installed.generationId);
    assert.deepEqual(afterRollback.pointer[0].active_generation_id, installed.generationId);
    assert.deepEqual(afterRollback.pointer[0].rollback_generation_id, updated.generationId);
    assert.equal(refreshedRetained.state, "active");
    assert.equal(refreshedRetained.readiness_token, `ready:${installed.generationId}:fixture-3`);
    assert.equal(new Date(refreshedRetained.readiness_expires_at).toISOString(), "2026-08-29T09:02:00.001Z");
    assert.equal(refreshedRetained.staged_revision, rolledBack.revisionBefore);
    assert.equal(refreshedRetained.readiness_token === expiredReadiness.rows[0].readiness_token, false, "rollback must replace stored retained readiness token");
    assert.deepEqual(rolledBack.compatibility, releases[1].compatibility, "rollback receipt must bind current active rollback compatibility window");
    assert.deepEqual(afterRollback.operations.find((operation) => operation.operation_id === rollback.operationId).result_json, rolledBack);
    assert.equal(afterRollback.receipts.some((receipt) => receipt.receipt_id === rolledBack.receiptId), true);
    assert.equal(afterRollback.audit.some((audit) => audit.event_json?.receiptId === rolledBack.receiptId), true);
    assert.equal(afterRollback.outbox.some((event) => event.event_json?.receiptId === rolledBack.receiptId), true);
    assert.equal(afterRollback.revision[0].revision, rolledBack.inventoryRevision);
    assert.equal(afterRollback.budget[0].active_count, 0);
    assert.equal(afterRollback.operations.length, beforeRollback.operations.length, "rollback completion must finish its planned operation in place");
    await trafficProbe.waitForGeneration("rollback", rolledBack.generationId);
    assert.equal(rolledBack.generationId, installed.generationId);
    assert.deepEqual(await manager.rollback(rollback.operationId), rolledBack);
    await Promise.all([
      routePage.waitForFunction((generationId) => window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.some((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementCancelled) === true, rolledBack.generationId),
      drainingRoutePage.waitForFunction((generationId) => window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.some((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementCancelled) === true, rolledBack.generationId)
    ]);
    const rollbackObservationTimes = await Promise.all([routePage, drainingRoutePage].map((page) => page.evaluate((generationId) => {
      const observation = window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.find((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementCancelled);
      if (!observation) throw new Error("The rollback snapshot polling observation is unavailable.");
      return observation.observedAt;
    }, rolledBack.generationId)));
    assert.equal(rollbackObservationTimes.every((observedAt) => observedAt < g1RetirementDeadline), true, "G1 pages did not observe rollback before their scheduled retirement deadline");
    const rolledBackRoutePage = await browserContext.newPage();
    const rolledBackRoute = await rolledBackRoutePage.goto(`${restartedFixedRouteHost.url}/apps/sales-live/activity/42`);
    assert.equal(rolledBackRoute?.status(), 200, "the fixed route must resolve the rolled-back active generation without a rebuild");
    await rolledBackRoutePage.getByRole("heading", { name: "sales-live-v1" }).waitFor();
    assert.deepEqual(await rolledBackRoutePage.evaluate(() => window.__K_NEX_HOT_APPLICATION_ROUTE_SESSION__), { appId: "app.sales-live", generationId: rolledBack.generationId, route: "/apps/sales-live/activity/42" });
    await rolledBackRoutePage.close();
    await Promise.all([
      updatedRoutePage.waitForFunction(() => document.querySelectorAll("iframe").length === 0, { timeout: 12_000 }),
      new Promise((resolve) => setTimeout(resolve, Math.max(0, g1RetirementDeadline - Date.now()) + 100))
    ]);
    assert.equal(await routePage.locator("iframe").count(), 1, "rollback did not cancel G1 retirement after its original deadline elapsed");
    assert.equal(await drainingRoutePage.locator("iframe").count(), 1, "rollback did not preserve the lease-drained G1 page after its original retirement deadline elapsed");
    assert.equal(fixedRouteHost.routeRequests.every((request) => request.route === "/apps/sales-live/activity/42"), true, "the customer host did not use the declared fixed catch-all route");
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
    await Promise.all([
      routePage.waitForFunction((generationId) => window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.some((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementScheduled) === true, cutover.generationId),
      drainingRoutePage.waitForFunction((generationId) => window.__K_NEX_HOT_APPLICATION_LIFECYCLE_OBSERVATIONS__?.some((entry) => entry.source === "snapshot-poll" && entry.generationId === generationId && entry.retirementScheduled) === true, cutover.generationId)
    ]);
    await Promise.all([
      routePage.waitForFunction(() => document.querySelectorAll("iframe").length === 0, { timeout: 12_000 }),
      drainingRoutePage.waitForFunction(() => document.querySelectorAll("iframe").length === 0, { timeout: 12_000 })
    ]);

    await pool.query("update runtime_extensions set active_generation=jsonb_set(active_generation, '{artifactDigest}', to_jsonb($1::text)) where extension_id='app.sales-live'", [digest("f")]);
    await assert.rejects(manager.inventory("customer-alpha", "production"), { code: "ARTIFACT_AUTHORITY_REJECTED" });
    await pool.query("update runtime_extensions set active_generation=jsonb_set(active_generation, '{artifactDigest}', to_jsonb($1::text)) where extension_id='app.sales-live'", [byGeneration.get(cutover.generationId).authority.artifactDigest]);

    const terminalRoutePage = await browserContext.newPage();
    await terminalRoutePage.goto(`${restartedFixedRouteHost.url}/apps/sales-live/activity/42`);
    await terminalRoutePage.getByRole("heading", { name: "sales-live-v3" }).waitFor();
    const disablePlan = await manager.plan(request("disable", "2.0.0", cutover.revisionAfter));
    const disabled = await manager.disable(disablePlan.operationId);
    assert.deepEqual(await manager.disable(disablePlan.operationId), disabled);
    await terminalRoutePage.waitForFunction(() => document.querySelectorAll("iframe").length === 0, { timeout: 5_000 });
    assert.equal((await requestFixedRoute(restartedFixedRouteHost, "/apps/sales-live/activity/42")).status, 404, "disabled applications must reject new fixed-route sessions immediately");
    const reinstall = await manager.plan(request("install", "2.1.0", disabled.revisionAfter));
    await manager.stage(reinstall.operationId);
    assert.equal((await manager.validate(reinstall.operationId)).valid, true);
    const reactivated = await manager.activate(reinstall.operationId);
    const quarantinedRoutePage = await browserContext.newPage();
    await quarantinedRoutePage.goto(`${restartedFixedRouteHost.url}/apps/sales-live/activity/42`);
    await quarantinedRoutePage.getByRole("heading", { name: "sales-live-v4" }).waitFor();
    const quarantined = await storeA.quarantineRunnerGeneration({ applicationId: "customer-alpha", environment: "production", appId: identity.id, generationId: reactivated.generationId, expectedRevision: reactivated.revisionAfter, reason: "INVOCATION_TIMEOUT" });
    await quarantinedRoutePage.waitForFunction(() => document.querySelectorAll("iframe").length === 0, { timeout: 5_000 });
    assert.equal((await requestFixedRoute(restartedFixedRouteHost, "/apps/sales-live/activity/42")).status, 404, "quarantined applications must reject new fixed-route sessions immediately");
    const removalReinstall = await manager.plan(request("install", "2.2.0", quarantined.revisionAfter));
    await manager.stage(removalReinstall.operationId);
    assert.equal((await manager.validate(removalReinstall.operationId)).valid, true);
    const removalActive = await manager.activate(removalReinstall.operationId);
    const removedRoutePage = await browserContext.newPage();
    await removedRoutePage.goto(`${restartedFixedRouteHost.url}/apps/sales-live/activity/42`);
    await removedRoutePage.getByRole("heading", { name: "sales-live-v5" }).waitFor();
    const uninstallPlan = await manager.plan(request("uninstall", "2.2.0", removalActive.revisionAfter));
    const uninstalled = await manager.uninstall(uninstallPlan.operationId);
    assert.deepEqual(await manager.uninstall(uninstallPlan.operationId), uninstalled);
    await removedRoutePage.waitForFunction(() => document.querySelectorAll("iframe").length === 0, { timeout: 5_000 });
    assert.equal((await requestFixedRoute(restartedFixedRouteHost, "/apps/sales-live/activity/42")).status, 404, "removed applications must reject new fixed-route sessions immediately");
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
        httpsDistinctOrigins: true,
        durableBytesRequiredAfterRestart: true,
        lifecycle: ["g1-observed-g2-scheduled-retirement", "rollback-observed-g1-before-deadline", "rollback-cancelled-g1-retirement-after-deadline", "g2-drained-after-rollback", "g1-drained-after-irreversible-v3-cutover", "disable", "quarantine", "remove"]
      },
      sourceAdmission,
      freshRollbackReadiness: {
        generationId: installed.generationId,
        expiredToken: expiredReadiness.rows[0].readiness_token,
        token: refreshedRetained.readiness_token,
        expiresAt: refreshedRetained.readiness_expires_at,
        stagedRevision: refreshedRetained.staged_revision,
        compatibilityWindowId: rolledBack.compatibility.windowId,
        rejectedStages: rejectedRollbackStages.map(({ name }) => name)
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
