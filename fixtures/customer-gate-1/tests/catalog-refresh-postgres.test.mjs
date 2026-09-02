import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { ArtifactVerifier, CatalogClient, canonicalJson, OfficialGithubCatalogReader, sha256 } from "@k-nex/extension-bundler";
import { ActiveExtensionSecurityReconciler, CatalogRefreshCoordinator, PostgresCatalogCheckpointStore, PostgresCatalogMirrorStore, PostgresRuntimeExtensionStore, PostgresVerifiedArtifactStore, SharedStaticPlatformPluginGenerationRebinder } from "@k-nex/payload-adapter";
import { CurrentAuthorityAdapter, SystemCatalogAdministrationService, createTrustedAuthorizationSession } from "@k-nex/runtime";
import pg from "pg";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const directory = fileURLToPath(new URL("..", import.meta.url));
const endpoint = "https://api.github.com/repos/k-nex/official-catalog/releases/assets/42";
const now = () => Date.parse("2030-01-01T00:00:00.000Z");
const clock = { now: () => new Date(now()) };
const owner = { applicationId: "customer-catalog-alpha", environment: "production" };
const source = { repository: "https://github.com/k-nex/official-apps", commit: "0123456789abcdef0123456789abcdef01234567" };
const digest = (character) => `sha256:${character.repeat(64)}`;

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p11-catalog-refresh", BOOT_KEY: "p11-catalog-refresh" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function release(keys, version = "1.0.0") {
  return {
    deliveryClass: "hot-application",
    id: "app.catalog-proof",
    version,
    runtimeAbi: "1.0.0",
    publisher: { identity: "k-nex-catalog-proof-publisher", publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() },
    source: { ...source, assetUrl: "https://github.com/k-nex/official-apps/releases/download/v1.0.0/app.catalog-proof.tar.gz" },
    artifactDigest: digest("a"), manifestDigest: digest("b"), sbomDigest: digest("c"), provenanceDigest: digest("d"),
    support: "supported", review: "approved", security: "clear", revoked: false
  };
}

function signed(signer, privateKey, sequence, entries, expiresAt = "2030-01-02T00:00:00.000Z") {
  const payload = { schemaVersion: 1, sequence, expiresAt, entries };
  return { schemaVersion: 1, signer, payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") };
}

function activeGeneration(applicationId = owner.applicationId, extensionId = "app.catalog-proof", generationId = "catalog-proof-generation-1") {
  return {
    authority: "verified-bundle", applicationId, environment: owner.environment, deliveryClass: "hot-application", extensionId,
    generationId, version: "1.0.0", sourceCommit: source.commit,
    artifactDigest: digest("a"), manifestDigest: digest("b"), catalogDigest: digest("e"), provenanceDigest: digest("d"), sbomDigest: digest("c"), receiptId: "catalog-proof-generation-receipt"
  };
}

async function insertActive(pool, targetOwner = owner, extensionId = "app.catalog-proof", generationId = "catalog-proof-generation-1") {
  const active = activeGeneration(targetOwner.applicationId, extensionId, generationId);
  await pool.query(
    "insert into runtime_extension_inventory_revisions (application_id, environment, revision) values ($1,$2,0) on conflict do nothing",
    [targetOwner.applicationId, targetOwner.environment]
  );
  await pool.query(
    `insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation)
     values ($1,$2,'hot-application',$3,1,'active',$4,$5::jsonb)`,
    [targetOwner.applicationId, targetOwner.environment, extensionId, active.generationId, JSON.stringify(active)]
  );
  await pool.query(
    `insert into runtime_extension_generations (application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest, state)
     values ($1,$2,'hot-application',$3,$4,'1.0.0',$5::jsonb,$6,'active')`,
    [targetOwner.applicationId, targetOwner.environment, extensionId, active.generationId, JSON.stringify(active), digest("f")]
  );
}

async function relay() {
  const state = { response: { status: 200, body: "{}", headers: { "content-type": "application/json" } }, urls: [] };
  const server = createServer((_request, response) => {
    const { status, body, headers } = state.response;
    response.writeHead(status, headers);
    response.end(body);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Catalog relay did not bind a TCP port.");
  return {
    state,
    transport: {
      async request(input) {
        state.urls.push(input.url);
        const response = await fetch(`http://127.0.0.1:${address.port}/catalog`, { headers: input.headers, redirect: "manual", signal: input.signal });
        return { status: response.status, headers: Object.freeze({ "content-type": response.headers.get("content-type") ?? undefined, "content-length": response.headers.get("content-length") ?? undefined, location: response.headers.get("location") ?? undefined }), body: response.body };
      }
    },
    async close() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  };
}

function refresh(id, revision, targetOwner = owner) {
  const requestedBy = { kind: "service", id: "catalog-proof" };
  return { refreshId: id, expectedCatalogRevision: revision, requestedBy, authorityEnvelope: { schemaVersion: 1, ...targetOwner, principal: requestedBy, effectiveActor: requestedBy, authorizationRevision: 1, lifecycleRevision: 1, permissions: [{ decisionId: "catalog-proof-decision", permissionId: "system.catalog.refresh", owner: { kind: "platform", namespace: "system" }, scope: { kind: "application", resource: "system.catalog" } }] }, idempotencyKey: `${id}-idempotency` };
}

function coordinator(pool, targetOwner, reader, catalog, verifier, reconciler, currentAuthority = { reauthorize: async () => ({ schemaVersion: 1, ...targetOwner, authorizationRevision: 1, lifecycleRevision: 1 }) }) {
  const mirror = new PostgresCatalogMirrorStore(pool, targetOwner);
  const extensions = new PostgresRuntimeExtensionStore(pool, clock, digest("9"), {
    sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder(),
    authorizationLifecycleProjector: { project: async () => undefined }
  });
  return { mirror, extensions, value: new CatalogRefreshCoordinator({ owner: targetOwner, reader, catalog, checkpoints: new PostgresCatalogCheckpointStore(pool, targetOwner), verifier, mirror, extensions, reconciler, currentAuthority }) };
}

function catalogAdministration(targetOwner, mirror, operator) {
  const actor = { kind: "service", id: "catalog-proof" };
  const session = createTrustedAuthorizationSession({ schemaVersion: 1, ...targetOwner, correlationId: `catalog-${targetOwner.applicationId}`, principal: actor, effectiveActor: actor });
  const authority = new CurrentAuthorityAdapter({ current: async () => session }, { authorize: async (current, request) => ({
    schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, ...targetOwner, permissionId: request.permissionId,
    owner: { kind: "platform", namespace: "system" }, principal: current.principal, effectiveActor: current.effectiveActor, scope: request.scope,
    authorizationRevision: 1, lifecycleRevision: 1, outcome: "allow", reason: "granted", approval: "not-required", reauthentication: "not-required"
  }) });
  return new SystemCatalogAdministrationService({ authority,
    state: { async readState() { const observation = await mirror.readObservation(); return { schemaVersion: 1, ...targetOwner, authorizationRevision: 1, lifecycleRevision: 1, catalogRevision: observation.catalogRevision }; } },
    observation: mirror, operator: { resolve: async () => operator }
  });
}

test("P11.4 consumes a bounded official catalog through real HTTP and PostgreSQL without activation", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("catalog_refresh").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  const catalogKeys = generateKeyPairSync("ed25519");
  const publisherKeys = generateKeyPairSync("ed25519");
  const signer = { identity: "k-nex-catalog-proof", publicKey: catalogKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  const v1 = release(publisherKeys);
  const http = await relay();
  try {
    await boot(container.getConnectionUri());
    await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1)", [owner.applicationId]);
    const checkpoints = new PostgresCatalogCheckpointStore(pool, owner);
    const catalog = new CatalogClient({ [signer.identity]: signer.publicKey }, checkpoints, now);
    const verifier = new ArtifactVerifier(catalog, { [v1.publisher.identity]: v1.publisher.publicKey });
    const reader = new OfficialGithubCatalogReader({ endpoint, transport: http.transport, maxBytes: 4_096 });
    const store = new PostgresRuntimeExtensionStore(pool, clock, digest("9"), {
      sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder(),
      authorizationLifecycleProjector: { project: async () => undefined }
    });
    const reconciler = new ActiveExtensionSecurityReconciler(verifier, store);
    const primary = coordinator(pool, owner, reader, catalog, verifier, reconciler);
    const send = async (snapshot) => { http.state.response = { status: 200, body: JSON.stringify(snapshot), headers: { "content-type": "application/json" } }; };

    await send(signed(signer, catalogKeys.privateKey, 1, [v1]));
    const accepted = await primary.value.refresh(refresh("catalog-refresh-accepted-v1", 0));
    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.accepted.sequence, 1);
    assert.deepEqual((await pool.query("select release_count from k_nex_catalog_refresh_audit where receipt_id=$1", [accepted.receiptId])).rows, [{ release_count: 1 }], "Audit records catalog releases, not the zero active reconciliations.");
    assert.deepEqual(http.state.urls, [endpoint], "The relay only received the configured GitHub release endpoint.");
    assert.equal((await pool.query("select count(*)::int count from runtime_extensions")).rows[0].count, 0, "Refresh never activates extensions.");

    const revokedOwner = { applicationId: "customer-catalog-revoked", environment: "production" };
    await insertActive(pool, revokedOwner);
    await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1)", [revokedOwner.applicationId]);
    await pool.query("insert into k_nex_roles (application_id, role_id, label) values ($1,'customer.catalog-admin','Catalog admin')", [revokedOwner.applicationId]);
    await pool.query(`insert into k_nex_role_permission_grants (application_id, grant_id, role_id, permission_id, owner_kind, owner_namespace) values ($1,'customer.catalog-refresh-grant','customer.catalog-admin','system.catalog.refresh','platform','system')`, [revokedOwner.applicationId]);
    await pool.query(`insert into k_nex_role_assignments (application_id, assignment_id, role_id, subject_kind, subject_id, state) values ($1,'customer.catalog-admin-assignment','customer.catalog-admin','service','catalog-proof','active')`, [revokedOwner.applicationId]);
    const revokedAuthority = { async reauthorize(input) {
      const [grant, state] = await Promise.all([
        pool.query(`select permission.permission_id from k_nex_role_assignments assignment join k_nex_role_permission_grants permission on permission.application_id=assignment.application_id and permission.role_id=assignment.role_id where assignment.application_id=$1 and assignment.subject_kind=$2 and assignment.subject_id=$3 and assignment.state='active' and permission.permission_id='system.catalog.refresh'`, [revokedOwner.applicationId, input.authority.principal.kind, input.authority.principal.id]),
        pool.query("select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1", [revokedOwner.applicationId])
      ]);
      return grant.rows.length === 1 && state.rows.length === 1 && input.authority.applicationId === revokedOwner.applicationId && input.authority.environment === revokedOwner.environment
        ? { schemaVersion: 1, ...revokedOwner, authorizationRevision: state.rows[0].authorization_revision, lifecycleRevision: state.rows[0].lifecycle_revision }
        : undefined;
    } };
    const revokedCheckpoints = new PostgresCatalogCheckpointStore(pool, revokedOwner);
    const revokedCatalog = new CatalogClient({ [signer.identity]: signer.publicKey }, revokedCheckpoints, now);
    const revokedVerifier = new ArtifactVerifier(revokedCatalog, { [v1.publisher.identity]: v1.publisher.publicKey });
    const revokedRuntime = new PostgresRuntimeExtensionStore(pool, clock, digest("7"), { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() });
    const revokedReconciler = new ActiveExtensionSecurityReconciler(revokedVerifier, revokedRuntime);
    let releaseReconciliation; let reconciliationStarted;
    const reconciliationGate = new Promise((resolve) => { releaseReconciliation = resolve; });
    const reconciliationReady = new Promise((resolve) => { reconciliationStarted = resolve; });
    const revoked = coordinator(pool, revokedOwner, reader, revokedCatalog, revokedVerifier, { reconcileSnapshot: async (input) => { reconciliationStarted(); await reconciliationGate; return revokedReconciler.reconcileSnapshot(input); } }, revokedAuthority);
    await send(signed(signer, catalogKeys.privateKey, 1, [v1]));
    const revokedRun = revoked.value.refresh(refresh("catalog-refresh-revoked", 0, revokedOwner));
    await reconciliationReady;
    await pool.query("update k_nex_role_assignments set state='revoked', revision=revision+1 where application_id=$1 and assignment_id='customer.catalog-admin-assignment'", [revokedOwner.applicationId]);
    await pool.query("update k_nex_authorization_state set authorization_revision=authorization_revision+1 where application_id=$1", [revokedOwner.applicationId]);
    releaseReconciliation();
    const revokedReceipt = await revokedRun;
    assert.deepEqual({ outcome: revokedReceipt.outcome, reason: revokedReceipt.reason }, { outcome: "rejected", reason: "permission-revoked" });
    assert.equal(await revoked.mirror.readAcceptedSnapshot(), undefined, "Revocation during reconciliation cannot advance the accepted pointer.");
    assert.equal((await revoked.mirror.readObservation()).state, "no-accepted-snapshot", "Revocation clears the staged pointer after fail-closed reconciliation.");

    const responseLoss = async (suffix, boundary) => {
      const targetOwner = { applicationId: `customer-catalog-loss-${suffix}`, environment: "production" };
      await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1)", [targetOwner.applicationId]);
      if (boundary === "stage") await insertActive(pool, targetOwner);
      const targetCheckpoints = new PostgresCatalogCheckpointStore(pool, targetOwner);
      const targetCatalog = new CatalogClient({ [signer.identity]: signer.publicKey }, targetCheckpoints, now);
      const targetVerifier = new ArtifactVerifier(targetCatalog, { [v1.publisher.identity]: v1.publisher.publicKey });
      const targetRuntime = new PostgresRuntimeExtensionStore(pool, clock, digest("6"), { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() });
      const targetReconciler = new ActiveExtensionSecurityReconciler(targetVerifier, targetRuntime);
      const target = coordinator(pool, targetOwner, reader, targetCatalog, targetVerifier, boundary === "stage" ? { reconcileSnapshot: async () => { throw new Error("response lost after staged checkpoint commit"); } } : targetReconciler);
      const request = { expectedCatalogRevision: 0, idempotencyKey: `catalog-loss-${suffix}-request` };
      await send(signed(signer, catalogKeys.privateKey, 1, [v1]));
      const lossyOperator = boundary === "begin"
        ? { read: target.value.read.bind(target.value), async refresh(input) { await target.mirror.begin(input); throw new Error("response lost after begin"); } }
        : boundary === "terminal"
          ? { read: target.value.read.bind(target.value), async refresh(input) { await target.value.refresh(input); throw new Error("response lost after terminal commit"); } }
          : target.value;
      await assert.rejects(catalogAdministration(targetOwner, target.mirror, lossyOperator).refresh({ context: {}, request }), /response lost/u);
      const recovered = boundary === "stage" ? coordinator(pool, targetOwner, reader, targetCatalog, targetVerifier, targetReconciler) : target;
      const receipt = await catalogAdministration(targetOwner, recovered.mirror, recovered.value).refresh({ context: {}, request });
      assert.equal(receipt.outcome, "accepted", `${boundary} response loss resumes one durable refresh.`);
      assert.deepEqual(await new PostgresCatalogMirrorStore(pool, targetOwner).readRefresh(receipt.refreshId), receipt, `${boundary} response loss returns the exact persisted receipt.`);
    };
    await responseLoss("begin", "begin");
    await responseLoss("stage", "stage");
    await responseLoss("terminal", "terminal");

    const tamperOwner = { applicationId: "customer-catalog-tamper", environment: "production" };
    await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1)", [tamperOwner.applicationId]);
    const tamperRefresh = refresh("catalog-refresh-tamper", 0, tamperOwner);
    const tamperPhases = [];
    const tamper = coordinator(pool, tamperOwner, reader, catalog, verifier, reconciler, { reauthorize: async ({ phase }) => { tamperPhases.push(phase); return { schemaVersion: 1, ...tamperOwner, authorizationRevision: 1, lifecycleRevision: 1 }; } });
    await tamper.mirror.begin(tamperRefresh);
    await pool.query("update k_nex_catalog_refresh_operations set authority_json=$4::jsonb where application_id=$1 and environment=$2 and refresh_id=$3", [tamperOwner.applicationId, tamperOwner.environment, tamperRefresh.refreshId, JSON.stringify({ ...tamperRefresh.authorityEnvelope, authorizationRevision: 2 })]);
    await assert.rejects(tamper.value.refresh(tamperRefresh), { code: "STATE", message: "Persisted catalog refresh authority digest is invalid." });
    assert.deepEqual(tamperPhases, ["begin"], "Corrupt recovered authority reached resume authorization.");
    assert.deepEqual((await pool.query("select staged_snapshot_id, accepted_snapshot_id from k_nex_catalog_mirror_state where application_id=$1 and environment=$2", [tamperOwner.applicationId, tamperOwner.environment])).rows, [{ staged_snapshot_id: null, accepted_snapshot_id: null }], "Corrupt authority moved a catalog pointer.");
    assert.equal((await pool.query("select count(*)::int count from k_nex_catalog_refresh_receipts where application_id=$1 and environment=$2", [tamperOwner.applicationId, tamperOwner.environment])).rows[0].count, 0, "Corrupt authority produced a receipt.");

    const acceptedPointer = async () => (await primary.mirror.readAcceptedSnapshot())?.sequence;
    const poisonCatalog = signed(signer, catalogKeys.privateKey, 2, [v1]);
    const poisonAuthority = { ...activeGeneration(), catalogDigest: digest("e") };
    const artifacts = new PostgresVerifiedArtifactStore(pool, verifier, primary.mirror, owner);
    await assert.rejects(artifacts.stage({
      owner: { applicationId: owner.applicationId, environment: owner.environment, deliveryClass: "hot-application", extensionId: v1.id, generationId: poisonAuthority.generationId },
      authority: poisonAuthority,
      activation: { compatibility: { status: "compatible", windowId: "catalog-poison", closesAt: "2030-01-02T00:00:00.000Z", migrationDigest: digest("9"), dataRevision: 1 }, metadata: {}, settings: {}, storageSchemaVersions: {} },
      verification: { catalog: poisonCatalog, artifact: Buffer.from("not-an-artifact"), provenance: Buffer.from("not-provenance"), deliveryClass: "hot-application", id: v1.id, version: v1.version, runtimeAbi: v1.runtimeAbi }
    }), { code: "ARTIFACT_UNAVAILABLE" });
    assert.equal((await checkpoints.read(signer.identity))?.sequence, 1, "Rejected artifact staging cannot advance the official refresh checkpoint.");
    await send(poisonCatalog);
    assert.equal((await primary.value.refresh(refresh("catalog-refresh-after-poison", 2))).outcome, "accepted", "The same catalog remains admissible to the sole checkpoint-advancing refresh path.");
    for (const [name, response] of [
      ["partial", { status: 200, body: "{", headers: { "content-type": "application/json" } }],
      ["oversized", { status: 200, body: "x".repeat(4_097), headers: { "content-type": "application/json" } }],
      ["redirect", { status: 302, body: "", headers: { location: "http://127.0.0.1/escape" } }],
      ["expired", { status: 200, body: JSON.stringify(signed(signer, catalogKeys.privateKey, 3, [v1], "2029-12-31T00:00:00.000Z")), headers: { "content-type": "application/json" } }],
      ["replay", { status: 200, body: JSON.stringify(signed(signer, catalogKeys.privateKey, 1, [v1])), headers: { "content-type": "application/json" } }],
      ["downgrade", { status: 200, body: JSON.stringify(signed(signer, catalogKeys.privateKey, 3, [release(publisherKeys, "0.9.0")])), headers: { "content-type": "application/json" } }]
    ]) {
      http.state.response = response;
      const result = await primary.value.refresh(refresh(`catalog-refresh-${name}`, 4));
      assert.equal(result.outcome, "rejected", `${name} must terminalize as rejected.`);
      assert.equal(await acceptedPointer(), 2, `${name} must preserve the accepted pointer.`);
    }

    await insertActive(pool);
    assert.equal((await store.inventory(owner.applicationId, owner.environment)).extensions.hotApplications["app.catalog-proof"]?.disposition, "active");
    await send(signed(signer, catalogKeys.privateKey, 3, [{ ...v1, artifactDigest: digest("0") }]));
    let crashReconciliations = 0;
    const crashed = coordinator(pool, owner, reader, catalog, verifier, { reconcileSnapshot: async () => { crashReconciliations += 1; throw new Error("injected crash after checkpoint and stage"); } });
    await assert.rejects(crashed.value.refresh(refresh("catalog-refresh-crash", 4)), /injected crash/u);
    assert.equal(crashReconciliations, 1);
    assert.equal((await crashed.mirror.readSecuritySnapshot(owner))?.sequence, 3, "Staged policy is effective before acceptance.");
    assert.equal(await acceptedPointer(), 2);
    const replaced = activeGeneration(owner.applicationId, "app.catalog-proof", "catalog-proof-generation-2");
    await pool.query("update runtime_extensions set revision=2, active_generation_id=$3, active_generation=$4::jsonb where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id='app.catalog-proof'", [owner.applicationId, owner.environment, replaced.generationId, JSON.stringify(replaced)]);
    await pool.query("insert into runtime_extension_generations (application_id, environment, delivery_class, extension_id, generation_id, version, authority_json, authority_digest, state) values ($1,$2,'hot-application','app.catalog-proof',$3,'1.0.0',$4::jsonb,$5,'active')", [owner.applicationId, owner.environment, replaced.generationId, JSON.stringify(replaced), digest("f")]);
    await insertActive(pool, owner, "app.catalog-new", "catalog-new-generation-1");
    await pool.query("update runtime_extension_inventory_revisions set revision=revision+1 where application_id=$1 and environment=$2", [owner.applicationId, owner.environment]);
    const recovered = coordinator(pool, owner, reader, catalog, verifier, reconciler);
    const recoveredReceipt = await recovered.value.refresh(refresh("catalog-refresh-crash", 4));
    assert.equal(recoveredReceipt.outcome, "accepted");
    assert.equal(recoveredReceipt.accepted.sequence, 3);
    assert.equal((await recovered.extensions.inventory(owner.applicationId, owner.environment)).extensions.hotApplications["app.catalog-proof"].disposition, "quarantined");
    assert.equal((await recovered.extensions.inventory(owner.applicationId, owner.environment)).extensions.hotApplications["app.catalog-new"].disposition, "quarantined", "A newly active release after stage is terminally reconciled on restart.");
    const evidence = await pool.query(
      `select (select count(*)::int from runtime_extension_security_receipts) receipts,
              (select count(*)::int from runtime_extension_security_audit) audit,
              (select count(*)::int from runtime_extension_outbox where event_json->>'eventType'='extension.security-quarantine') outbox,
              (select count(*)::int from k_nex_catalog_refresh_audit where catalog_revision=6) catalog_audit,
              (select count(*)::int from k_nex_catalog_refresh_outbox where catalog_revision=6) catalog_outbox`
    );
    assert.deepEqual(evidence.rows[0], { receipts: 2, audit: 2, outbox: 2, catalog_audit: 1, catalog_outbox: 1 }, "Replacement and newly active releases are both quarantined before the accepted refresh receipt.");

    const raceOwner = { applicationId: "customer-catalog-race", environment: "production" };
    const raceCheckpoints = new PostgresCatalogCheckpointStore(pool, raceOwner);
    const high = new CatalogClient({ [signer.identity]: signer.publicKey }, raceCheckpoints, now);
    const low = new CatalogClient({ [signer.identity]: signer.publicKey }, raceCheckpoints, now);
    const highInput = signed(signer, catalogKeys.privateKey, 9, [release(publisherKeys, "1.2.0")]);
    const highSnapshot = await high.verifySnapshot(highInput);
    const raceMirror = new PostgresCatalogMirrorStore(pool, raceOwner);
    const raceRefresh = refresh("catalog-race-stage", 0, raceOwner);
    await raceMirror.begin(raceRefresh);
    await Promise.allSettled([
      raceMirror.stageVerified({
        refresh: raceRefresh,
        snapshot: { snapshotId: "catalog-race-snapshot", signedCatalog: highSnapshot.catalog, signerIdentity: signer.identity, sequence: 9, digest: sha256(Buffer.from(canonicalJson(highSnapshot.catalog.payload))), releaseCount: 1, observedAt: new Date(now()).toISOString() },
        expectedCheckpoint: undefined, checkpoint: highSnapshot.checkpoint, requirements: []
      }),
      low.read(signed(signer, catalogKeys.privateKey, 8, [release(publisherKeys, "1.1.0")]))
    ]);
    await high.read(highInput);
    assert.equal((await raceCheckpoints.read(signer.identity))?.sequence, 9, "Concurrent absent checkpoint reads cannot leave a lower sequence.");

    const finalOwner = { applicationId: "customer-catalog-final", environment: "production" };
    await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1)", [finalOwner.applicationId]);
    await insertActive(pool, finalOwner);
    const finalCheckpoints = new PostgresCatalogCheckpointStore(pool, finalOwner);
    const finalCatalog = new CatalogClient({ [signer.identity]: signer.publicKey }, finalCheckpoints, now);
    const finalVerifier = new ArtifactVerifier(finalCatalog, { [v1.publisher.identity]: v1.publisher.publicKey });
    const finalReader = new OfficialGithubCatalogReader({ endpoint, transport: http.transport, maxBytes: 4_096 });
    const finalExtensions = new PostgresRuntimeExtensionStore(pool, clock, digest("9"), { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() });
    const finalMirror = new PostgresCatalogMirrorStore(pool, finalOwner);
    const finalReconciler = {
      reconcileSnapshot: async () => {
        return { status: "clear" };
      }
    };
    const finalMirrorPort = {
      begin: finalMirror.begin.bind(finalMirror), readRefresh: finalMirror.readRefresh.bind(finalMirror), readRefreshAuthority: finalMirror.readRefreshAuthority.bind(finalMirror), stageVerified: finalMirror.stageVerified.bind(finalMirror), readStaged: finalMirror.readStaged.bind(finalMirror),
      readRequirements: finalMirror.readRequirements.bind(finalMirror), rebaseRequirements: finalMirror.rebaseRequirements.bind(finalMirror), markReconciliationTerminal: finalMirror.markReconciliationTerminal.bind(finalMirror),
      readObservation: finalMirror.readObservation.bind(finalMirror), reject: finalMirror.reject.bind(finalMirror),
      async acceptAfterTerminalReconciliation(input) {
        await pool.query("update runtime_extension_inventory_revisions set revision=revision+1 where application_id=$1 and environment=$2", [finalOwner.applicationId, finalOwner.environment]);
        return finalMirror.acceptAfterTerminalReconciliation(input);
      }
    };
    const finalCoordinator = new CatalogRefreshCoordinator({ owner: finalOwner, reader: finalReader, catalog: finalCatalog, checkpoints: finalCheckpoints, verifier: finalVerifier, mirror: finalMirrorPort, extensions: finalExtensions, reconciler: finalReconciler, currentAuthority: { reauthorize: async () => ({ schemaVersion: 1, ...finalOwner, authorizationRevision: 1, lifecycleRevision: 1 }) } });
    await send(signed(signer, catalogKeys.privateKey, 1, [v1]));
    await assert.rejects(finalCoordinator.refresh(refresh("catalog-refresh-final-check", 0, finalOwner)), /inventory changed before catalog acceptance/u);
    assert.equal(await finalMirror.readAcceptedSnapshot(), undefined, "An inventory revision change during final check cannot advance the pointer.");

    const replayOwner = { applicationId: "customer-catalog-replay", environment: "production" };
    await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1)", [replayOwner.applicationId]);
    const replayCheckpoints = new PostgresCatalogCheckpointStore(pool, replayOwner);
    const replayCatalog = new CatalogClient({ [signer.identity]: signer.publicKey }, replayCheckpoints, now);
    const replayVerifier = new ArtifactVerifier(replayCatalog, { [v1.publisher.identity]: v1.publisher.publicKey });
    const replayReader = new OfficialGithubCatalogReader({ endpoint, transport: http.transport, maxBytes: 4_096 });
    const replayStore = coordinator(pool, replayOwner, replayReader, replayCatalog, replayVerifier, new ActiveExtensionSecurityReconciler(replayVerifier, new PostgresRuntimeExtensionStore(pool, clock, digest("8"), { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() })));
    await send(signed(signer, catalogKeys.privateKey, 1, [v1]));
    const request = refresh("catalog-refresh-race-replay", 0, replayOwner);
    const outcomes = await Promise.all([replayStore.value.refresh(request), replayStore.value.refresh(request)]);
    assert.deepEqual(outcomes, [outcomes[0], outcomes[0]], "Concurrent replay returns one deterministic terminal receipt.");
    assert.equal(outcomes[0].outcome, "accepted");
    console.log("P11_4_CATALOG_REFRESH_POSTGRES_HTTP_EVIDENCE=PASS");
  } finally {
    await http.close();
    await pool.end();
    await container.stop();
  }
});
