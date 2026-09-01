import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { canonicalJson } from "@k-nex/contracts";
import { ArtifactVerifier, buildBundle, CatalogClient, InMemoryCatalogCheckpointStore, sha256, VerifiedRemoteUiAssetService } from "@k-nex/extension-bundler";
import { PostgresRuntimeExtensionStore, PostgresVerifiedArtifactStore } from "@k-nex/payload-adapter";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const digest = (character) => `sha256:${character.repeat(64)}`;
const source = { repository: "https://github.com/k-nex/customer-gate-1-apps", commit: "0123456789abcdef0123456789abcdef01234567" };
const publisherKeys = generateKeyPairSync("ed25519");
const catalogKeys = generateKeyPairSync("ed25519");
const publisher = { identity: "customer-gate-1-remote-ui-publisher", publicKey: publisherKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const catalogSigner = { identity: "customer-gate-1-remote-ui-catalog", publicKey: catalogKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
const owner = { applicationId: "customer-alpha", environment: "production", deliveryClass: "hot-application", extensionId: "app.sales-live" };

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p9-remote-ui-assets", BOOT_KEY: "p9-remote-ui-assets" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function catalog(entries, sequence) {
  const payload = { schemaVersion: 1, sequence, expiresAt: "2030-01-01T00:00:00.000Z", entries };
  return { schemaVersion: 1, signer: catalogSigner, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), catalogKeys.privateKey).toString("base64") };
}

function release(generation, version, marker, compatibility = { status: "compatible", windowId: `remote-ui-window-${generation}`, closesAt: "2026-09-01T00:00:00.000Z", migrationDigest: digest(String(generation)), dataRevision: generation }) {
  const generationId = `app-sales-live-generation-${generation}`;
  const bundle = buildBundle({
    manifest: {
      schemaVersion: 1, deliveryClass: "hot-application", id: owner.extensionId, displayName: "Sales live", version, runtimeAbi: "1.0.0",
      entrypoints: { server: ["server/main.mjs"], ui: ["ui/main.mjs"] }, capabilities: [], permissions: [], policyBindings: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 },
      settings: [], screens: [{ id: "sales.screen", route: "/", entrypoint: "ui/main.mjs" }], navigation: [], sources: [], actions: [], tools: [], logicFunctions: [], eventSubscriptions: [], schedules: [], storageSchemas: [], assets: ["assets/marker.txt"], localization: [{ locale: "en", path: "locales/en.json" }], healthChecks: []
    },
    files: [
      { path: "server/main.mjs", bytes: Buffer.from("export default async () => ({ ok: true });\n"), contentType: "application/javascript" },
      { path: "ui/main.mjs", bytes: Buffer.from(`self.onmessage=()=>postMessage(${JSON.stringify(marker)});\n`), contentType: "application/javascript" },
      { path: "assets/marker.txt", bytes: Buffer.from(marker), contentType: "text/plain" },
      { path: "assets/undeclared.txt", bytes: Buffer.from("undeclared"), contentType: "text/plain" },
      { path: "locales/en.json", bytes: Buffer.from('{"label":"Sales"}\n'), contentType: "application/json" },
      { path: "locales/undeclared.json", bytes: Buffer.from('{"label":"Unlisted"}\n'), contentType: "application/json" }
    ],
    source,
    workflowIdentity: `${source.repository}/.github/workflows/release.yml@${source.commit}`
  });
  const entry = {
    deliveryClass: "hot-application", id: owner.extensionId, version, runtimeAbi: "1.0.0", publisher,
    source: { ...source, assetUrl: `${source.repository}/releases/download/${version}/app.sales-live.tar.gz` },
    artifactDigest: sha256(bundle.artifact), manifestDigest: sha256(Buffer.from(canonicalJson(bundle.manifest))), sbomDigest: sha256(bundle.sbom), provenanceDigest: sha256(bundle.provenance),
    support: "supported", review: "approved", security: "clear", revoked: false
  };
  return { generationId, version, marker, bundle, entry, compatibility };
}

function staged(releaseDefinition, signedCatalog, now) {
  const authority = {
    ...owner, generationId: releaseDefinition.generationId, sourceCommit: source.commit, artifactDigest: releaseDefinition.entry.artifactDigest,
    manifestDigest: releaseDefinition.entry.manifestDigest, catalogDigest: sha256(Buffer.from(canonicalJson(signedCatalog))), provenanceDigest: releaseDefinition.entry.provenanceDigest, sbomDigest: releaseDefinition.entry.sbomDigest
  };
  return {
    authority,
    artifact: {
      owner: { ...owner, generationId: releaseDefinition.generationId },
      verification: { catalog: signedCatalog, artifact: releaseDefinition.bundle.artifact, provenance: releaseDefinition.bundle.provenance, deliveryClass: "hot-application", id: owner.extensionId, version: releaseDefinition.version, runtimeAbi: "1.0.0" },
      authority,
      activation: { compatibility: releaseDefinition.compatibility, metadata: {}, settings: {}, storageSchemaVersions: {} }
    },
    generation: {
      authority, version: releaseDefinition.version, compatibility: releaseDefinition.compatibility, metadata: {}, settings: {}, storageSchemaVersions: {},
      readiness: { generationId: releaseDefinition.generationId, serverGenerationId: releaseDefinition.generationId, uiGenerationId: releaseDefinition.generationId, storageGenerationId: releaseDefinition.generationId, leaseToken: `ready:${releaseDefinition.generationId}`, readyAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 60_000).toISOString() }
    }
  };
}

function change(operation, version, expectedRevision) {
  return { applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: owner.deliveryClass, id: owner.extensionId }, operation, targetVersion: version, expectedRevision, idempotencyKey: `${operation}:${version}:${expectedRevision}`, correlationId: `remote-ui-assets-${operation}-${version.replaceAll(".", "-")}` };
}

function plan(operationId, request, target, currentGenerationId) {
  return {
    executionClass: "live-generation", operationId, sourceCommit: source.commit, generationId: target.generationId,
    plan: {
      schemaVersion: 1, planId: `${target.generationId}-plan`, operationId, operation: request.operation, version: request.targetVersion,
      artifactDigest: target.entry.artifactDigest, expectedRevision: request.expectedRevision, ...(currentGenerationId ? { currentGenerationId } : {}), targetGenerationId: target.generationId,
      approvalRequired: false, rollback: { available: true, windowSeconds: 86_400 }, deliveryClass: "hot-application", id: owner.extensionId,
      availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [],
      resourceBudget: { maxBundleBytes: 1_048_576, maxAssetBytes: 262_144, maxStorageBytes: 1_048_576, maxMemoryMiB: 128, maxCpuMilliCores: 500, maxWallTimeMs: 5_000, maxInputBytes: 65_536, maxOutputBytes: 131_072, maxLogBytes: 65_536, maxConcurrency: 4 }
    }
  };
}

async function claim(store, request) {
  const result = await store.claimOperation({ request, requestDigest: sha256(Buffer.from(canonicalJson(request))), workerId: "remote-ui-assets-worker", authorization: { actor: { kind: "trusted-automation", identity: "github-actions:phase-9" }, decisionId: digest("9") } });
  assert.equal(result.status, "claimed");
  return result.operation;
}

async function warm(store, artifacts, request, releaseDefinition, signedCatalog, now, currentGenerationId) {
  const operation = await claim(store, request);
  let current = await store.savePlan(operation.operationId, operation.leaseToken, plan(operation.operationId, request, releaseDefinition, currentGenerationId));
  current = (await store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "planning", phase: "downloading" })).operation;
  const stagedRelease = staged(releaseDefinition, signedCatalog, now);
  await artifacts.stage(stagedRelease.artifact);
  current = (await store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "downloading", phase: "verified", authority: stagedRelease.authority })).operation;
  current = (await store.transition({ operationId: current.operationId, leaseToken: current.leaseToken, expectedPhase: "verified", phase: "staged", authority: stagedRelease.authority })).operation;
  await store.stageGeneration({ operationId: current.operationId, leaseToken: current.leaseToken, stage: stagedRelease.generation });
  return { operationId: current.operationId, leaseToken: current.leaseToken };
}

function assetRequest(releaseDefinition) {
  return { applicationId: owner.applicationId, environment: owner.environment, appId: owner.extensionId, generationId: releaseDefinition.generationId, artifactDigest: releaseDefinition.entry.artifactDigest, fileDigest: releaseDefinition.bundle.manifest.files["assets/marker.txt"].digest, path: "assets/marker.txt" };
}

async function assertNoBytes(service, request, message) {
  await assert.rejects(service.read(request), (error) => error?.code === "GENERATION_INACTIVE" || error?.code === "ARTIFACT_UNAVAILABLE" || error?.code === "REQUEST_INVALID", message);
}

async function assertUndeclaredAsset(service, request, message) {
  await assert.rejects(service.read(request), (error) => error?.code === "ASSET_UNAVAILABLE", message);
}

test("PostgreSQL Remote UI reads are generation-linearized, restart-safe, and fail closed", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("remote_ui_assets").withStartupTimeout(120_000).start();
  const connectionString = container.getConnectionUri();
  let pool = new pg.Pool({ connectionString });
  const now = new Date("2026-08-31T10:00:00.000Z");
  const makeArtifacts = (candidatePool) => new PostgresVerifiedArtifactStore(candidatePool, new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore(), () => now.valueOf()), { [publisher.identity]: publisher.publicKey }));
  try {
    await boot(connectionString);
    let store = new PostgresRuntimeExtensionStore(pool, { now: () => now }, digest("7"));
    let artifacts = makeArtifacts(pool);
    const service = new VerifiedRemoteUiAssetService(artifacts);
    const a = release(1, "1.0.0", "verified-a");
    const b = release(2, "1.1.0", "verified-b");
    const c = release(3, "1.2.0", "verified-c");
    const d = release(4, "1.3.0", "verified-d");
    const catalogA = catalog([a.entry], 1);
    const catalogB = catalog([a.entry, b.entry], 2);
    const catalogC = catalog([a.entry, b.entry, c.entry], 3);
    const catalogD = catalog([a.entry, b.entry, c.entry, d.entry], 4);

    const warmA = await warm(store, artifacts, change("install", a.version, 0), a, catalogA, now);
    const activatedA = await store.activateGeneration(warmA.operationId, warmA.leaseToken);
    assert.deepEqual(Buffer.from((await service.read(assetRequest(a))).body), Buffer.from(a.marker));
    for (const [path, expected] of [["assets/marker.txt", a.marker], ["locales/en.json", '{"label":"Sales"}\n']]) {
      const response = await service.read({ ...assetRequest(a), path, fileDigest: a.bundle.manifest.files[path].digest });
      assert.deepEqual(Buffer.from(response.body), Buffer.from(expected), `a declared ${path} must serve its exact verified bytes`);
    }
    for (const path of ["assets/undeclared.txt", "locales/undeclared.json"]) {
      await assertUndeclaredAsset(service, { ...assetRequest(a), path, fileDigest: a.bundle.manifest.files[path].digest }, `a signed but undeclared ${path} must never serve`);
    }

    await pool.end();
    pool = new pg.Pool({ connectionString });
    store = new PostgresRuntimeExtensionStore(pool, { now: () => now }, digest("7"));
    artifacts = makeArtifacts(pool);
    const restartedService = new VerifiedRemoteUiAssetService(artifacts);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(a))).body), Buffer.from(a.marker), "a reconstructed pool/store must reverify and return the exact stored bytes");
    await Promise.all([
      assertNoBytes(restartedService, { ...assetRequest(a), applicationId: "customer-beta" }, "another application cannot read A"),
      assertNoBytes(restartedService, { ...assetRequest(a), environment: "staging" }, "another environment cannot read A"),
      assertNoBytes(restartedService, { ...assetRequest(a), appId: "app.sales-other" }, "another app cannot read A"),
      assertNoBytes(restartedService, { ...assetRequest(a), generationId: "app-sales-live-generation-99" }, "another generation cannot read A"),
      assertNoBytes(restartedService, { ...assetRequest(a), artifactDigest: digest("f") }, "another artifact cannot read A")
    ]);

    await makeArtifacts(pool).stage(staged(b, catalogB, now).artifact);
    await assertNoBytes(restartedService, assetRequest(b), "a merely staged artifact must never serve Remote UI bytes");
    const warmB = await warm(store, artifacts, change("update", b.version, activatedA.revisionAfter), b, catalogB, now, a.generationId);

    const readerReached = Promise.withResolvers();
    const releaseReader = Promise.withResolvers();
    let heldReader = false;
    const lockingArtifacts = new PostgresVerifiedArtifactStore({
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        return {
          release: () => client.release(),
          async query(statement, values) {
            const result = await client.query(statement, values);
            if (!heldReader && typeof statement === "string" && statement.includes("from runtime_extension_artifact_bindings")) {
              heldReader = true;
              readerReached.resolve();
              await releaseReader.promise;
            }
            return result;
          }
        };
      }
    }, new ArtifactVerifier(new CatalogClient({ [catalogSigner.identity]: catalogSigner.publicKey }, new InMemoryCatalogCheckpointStore(), () => now.valueOf()), { [publisher.identity]: publisher.publicKey }));
    const linearizedRead = new VerifiedRemoteUiAssetService(lockingArtifacts).read(assetRequest(a));
    await readerReached.promise;
    const activatingB = store.activateGeneration(warmB.operationId, warmB.leaseToken);
    assert.equal(await Promise.race([activatingB.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 25))]), false, "activation must wait at Remote UI read's advisory-lock linearization point");
    releaseReader.resolve();
    assert.deepEqual(Buffer.from((await linearizedRead).body), Buffer.from(a.marker), "the in-flight read is admitted only as the pre-cutover generation");
    const activatedB = await activatingB;
    await assertNoBytes(restartedService, assetRequest(a), "A becomes rollback-only after B and cannot serve detached UI bytes");
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(b))).body), Buffer.from(b.marker));

    await store.quarantineActiveGeneration({
      applicationId: owner.applicationId, environment: owner.environment, extension: { deliveryClass: owner.deliveryClass, id: owner.extensionId }, generationId: b.generationId, expectedRevision: activatedB.revisionAfter,
      decision: { catalogDigest: sha256(Buffer.from(canonicalJson(catalogB))), catalogSignerIdentity: catalogSigner.identity, catalogSequence: 5, disposition: "revoked", release: { deliveryClass: "hot-application", id: owner.extensionId, version: b.version, sourceCommit: source.commit, artifactDigest: b.entry.artifactDigest, manifestDigest: b.entry.manifestDigest, provenanceDigest: b.entry.provenanceDigest, sbomDigest: b.entry.sbomDigest } }
    });
    await assertNoBytes(restartedService, assetRequest(b), "a revoked/quarantined generation cannot serve bytes");

    const warmC = await warm(store, artifacts, change("install", c.version, activatedB.revisionAfter + 1), c, catalogC, now, b.generationId);
    const activatedC = await store.activateGeneration(warmC.operationId, warmC.leaseToken);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker));
    const activePointer = (await pool.query("select active_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4", [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId])).rows[0].active_generation;
    await pool.query("update runtime_extensions set active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4", [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    await assertNoBytes(restartedService, assetRequest(c), "malformed active_generation JSON without its bound artifact cannot serve");
    await pool.query("update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [JSON.stringify(activePointer), owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker));
    await pool.query("update runtime_extensions set active_generation=active_generation || jsonb_build_object('extra', true) where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4", [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    await assertNoBytes(restartedService, assetRequest(c), "an active pointer with an extra field cannot serve bytes");
    await pool.query("update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [JSON.stringify(activePointer), owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    for (const [field, value] of [
      ["authority", "forged-bundle"],
      ["applicationId", "customer-beta"],
      ["environment", "staging"],
      ["deliveryClass", "theme-skin"],
      ["extensionId", "app.sales-other"],
      ["generationId", "app-sales-live-generation-forged"],
      ["version", "9.9.9"],
      ["sourceCommit", "f".repeat(40)],
      ["artifactDigest", digest("f")],
      ["manifestDigest", digest("e")],
      ["catalogDigest", digest("d")],
      ["provenanceDigest", digest("c")],
      ["sbomDigest", digest("b")],
      ["receiptId", "receipt-forged"]
    ]) {
      await pool.query("update runtime_extensions set active_generation=jsonb_set(active_generation, $1::text[], to_jsonb($2::text)) where application_id=$3 and environment=$4 and delivery_class=$5 and extension_id=$6", [[field], value, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
      await assertNoBytes(restartedService, assetRequest(c), `a forged active pointer ${field} cannot serve`);
      await pool.query("update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [JSON.stringify(activePointer), owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
      assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker), `restoring the active pointer ${field} restores exact verified bytes`);
    }
    const forgedReceiptId = (await pool.query(
      "select receipt_id from runtime_extension_generations where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5",
      [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, a.generationId]
    )).rows[0].receipt_id;
    await pool.query(
      "update runtime_extension_generations set receipt_id=$1 where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6",
      [forgedReceiptId, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, c.generationId]
    );
    await pool.query("update runtime_extensions set active_generation=jsonb_set(active_generation, '{receiptId}'::text[], to_jsonb($1::text)) where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [forgedReceiptId, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    await assertNoBytes(restartedService, assetRequest(c), "a coordinated pointer and generation receipt forgery cannot borrow another durable activation receipt");
    await pool.query(
      "update runtime_extension_generations set receipt_id=$1 where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6",
      [activePointer.receiptId, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, c.generationId]
    );
    await pool.query("update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [JSON.stringify(activePointer), owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker), "restoring the canonical pointer and generation receipt restores exact verified bytes");

    const verifiedCBytes = (await pool.query("select artifact_bytes from runtime_extension_artifacts where artifact_digest=$1", [c.entry.artifactDigest])).rows[0].artifact_bytes;
    await pool.query("update runtime_extension_artifacts set artifact_bytes=$1 where artifact_digest=$2", [Buffer.from("corrupt"), c.entry.artifactDigest]);
    await assertNoBytes(restartedService, assetRequest(c), "corrupt reverified bytes cannot serve");
    await pool.query("update runtime_extension_artifacts set artifact_bytes=$1 where artifact_digest=$2", [verifiedCBytes, c.entry.artifactDigest]);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker), "restoring original artifact bytes restores the exact active bytes");

    const warmD = await warm(store, artifacts, change("update", d.version, activatedC.revisionAfter), d, catalogD, now, c.generationId);
    const activatedD = await store.activateGeneration(warmD.operationId, warmD.leaseToken);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(d))).body), Buffer.from(d.marker));
    await pool.query("delete from runtime_extension_artifact_bindings where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4 and generation_id=$5", [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, d.generationId]);
    await assertNoBytes(restartedService, assetRequest(d), "a deleted immutable binding cannot serve active-pointer bytes");
    const rollback = await claim(store, change("rollback", c.version, activatedD.revisionAfter));
    const rollbackPlan = await store.savePlan(rollback.operationId, rollback.leaseToken, plan(rollback.operationId, rollback.request, c, d.generationId));
    const rollbackStage = staged(c, catalogC, now).generation;
    const rolledBack = await store.rollbackGeneration(rollbackPlan.operationId, rollbackPlan.leaseToken, {
      ...rollbackStage, readiness: { ...rollbackStage.readiness, leaseToken: `rollback:${c.generationId}` }
    });
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker), "a completed rollback receipt serves its restored active generation");
    const rollbackPointer = (await pool.query("select active_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4", [owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId])).rows[0].active_generation;
    await pool.query(
      "update runtime_extension_generations set receipt_id=$1 where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6",
      [activePointer.receiptId, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, c.generationId]
    );
    await pool.query("update runtime_extensions set active_generation=jsonb_set(active_generation, '{receiptId}'::text[], to_jsonb($1::text)) where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [activePointer.receiptId, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    await assertNoBytes(restartedService, assetRequest(c), "a post-rollback pointer and generation receipt swap to the prior same-generation receipt cannot serve");
    await pool.query(
      "update runtime_extension_generations set receipt_id=$1 where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5 and generation_id=$6",
      [rollbackPointer.receiptId, owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId, c.generationId]
    );
    await pool.query("update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5", [JSON.stringify(rollbackPointer), owner.applicationId, owner.environment, owner.deliveryClass, owner.extensionId]);
    assert.deepEqual(Buffer.from((await restartedService.read(assetRequest(c))).body), Buffer.from(c.marker), "restoring the newest rollback receipt restores the active generation");

    const disable = await claim(store, change("disable", c.version, rolledBack.revisionAfter));
    const disabledPlan = await store.savePlan(disable.operationId, disable.leaseToken, plan(disable.operationId, disable.request, c, c.generationId));
    const disabled = await store.disableGeneration(disabledPlan.operationId, disabledPlan.leaseToken);
    await assertNoBytes(restartedService, assetRequest(c), "a disabled retained generation cannot serve bytes");
    const uninstall = await claim(store, change("uninstall", c.version, disabled.revisionAfter));
    const removedPlan = await store.savePlan(uninstall.operationId, uninstall.leaseToken, plan(uninstall.operationId, uninstall.request, c, c.generationId));
    await store.uninstallGeneration(removedPlan.operationId, removedPlan.leaseToken);
    await assertNoBytes(restartedService, assetRequest(c), "a removed generation cannot serve bytes");
    console.log('P9_REMOTE_UI_POSTGRES_EVIDENCE={"scenarios":["restart","owner-denial","declared-assets","signed-undeclared-assets","staged","linearized-cutover","rollback-only","revoked","malformed-pointer","complete-canonical-pointer-tamper","extra-canonical-pointer-field","coordinated-pointer-generation-receipt-forgery","corrupt-bytes-restored","deleted-binding","completed-rollback","post-rollback-stale-same-generation-receipt","disabled","removed"]}');
  } finally {
    await pool.end();
    await container.stop();
  }
});
