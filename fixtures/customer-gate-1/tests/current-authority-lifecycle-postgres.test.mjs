import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import {
  AuthorizationLifecycleProjector,
  createStaticPlatformPluginAuthorizationDescriptorResolver
} from "@k-nex/payload-adapter";
import {
  AuthoritativeHotApplicationRuntime,
  adoptRetainedExtensionGrants,
  bootstrapFirstOwner,
  createCurrentAuthorityTarget,
  createEffectiveAuthorizationCatalog,
  createPlatformPluginPolicyExecutable,
  createPlatformPluginRegistrationAuthorizationContribution
} from "@k-nex/runtime";
import { createPayloadRequest } from "payload";
import pg from "pg";
import hotManifest from "../../extensions/valid/hot-application.manifest.json" with { type: "json" };
import { installStaticAuthorizationEnvironment } from "./static-authorization-build.mjs";

const image = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const directory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-gate-1";
const environment = "production";
const extensionId = "module.sales";
const sourceCommit = "a".repeat(40);
const applicationDigest = "sha256:474447597887192457f6eb22c3e512e3a27294a060798fae58b9f9e6e53a3f2f";
const permissions = ["sales.tasks.read", "sales.tasks.title.read", "sales.tasks.status.read", "sales.tasks.revenue.read"];
const owner = (generation) => ({ kind: "extension", deliveryClass: "platform-plugin", extensionId, generation });
const expected = (state) => ({ applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
const digest = (character) => `sha256:${character.repeat(64)}`;
const hotProfile = {
  schemaVersion: 1, scope: "production", profile: "os-container-per-generation-v1", isolation: "os-container-per-generation", workloadIdentity: "unique-non-root",
  namespaces: { pid: "separate", mount: "separate", user: "separate", network: "separate" },
  filesystem: { root: "read-only", code: "read-only", temporaryStorage: "bounded-tmpfs", hostMounts: "none" },
  privileges: { linuxCapabilities: "dropped", noNewPrivileges: true, dockerSocket: "none", databaseCredential: "none", hostSecrets: "none" },
  policy: { syscallProfile: digest("9"), macProfile: digest("8"), rawEgress: "denied", inboundListener: "denied", hostNetworkAdapter: "allowlisted-proxy-only" },
  limits: { cpuMilliCores: 2_000, memoryMiB: 512, processes: 256, openFiles: 4_096, tempBytes: 268_435_456 },
  rpc: { transport: "structured-host-rpc-only", schemaValidated: true, shortLivedGenerationActorIdentity: true }
};

installStaticAuthorizationEnvironment();

function staticBuild(generationId, commit = sourceCommit) {
  return {
    authority: "static-build", generationId, version: "1.0.0", sourceCommit: commit,
    compositionChangePlanDigest: `sha256:${"c".repeat(64)}`, buildEvidenceDigest: `sha256:${"d".repeat(64)}`,
    applicationDigest, imageDigest: `sha256:${"e".repeat(64)}`, migrationRevision: 1
  };
}

function hotBuild(generationId, character) {
  const authority = {
    applicationId, environment, deliveryClass: "hot-application", extensionId: hotManifest.id,
    generationId, sourceCommit: character.repeat(40), artifactDigest: digest(character), manifestDigest: digest(character === "1" ? "2" : "7"),
    catalogDigest: digest(character === "1" ? "3" : "8"), provenanceDigest: digest(character === "1" ? "4" : "9"), sbomDigest: digest(character === "1" ? "5" : "a")
  };
  return {
    active: { authority: "verified-bundle", ...authority, version: hotManifest.version, receiptId: `receipt-${generationId}` },
    artifact: {
      authority, version: hotManifest.version, hotApplicationManifest: hotManifest, capabilities: hotManifest.capabilities, resourceBudget: hotManifest.resourceBudget,
      compatibility: { status: "incompatible", migrationDigest: digest("f"), dataRevision: 1 }, metadata: {}, settings: {}, storageSchemaVersions: {}
    }
  };
}

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-7-current-authority", BOOT_KEY: "p10-7-current-authority" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { output += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { output += value; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function lifecycleEvent(operation, lifecycleState, revision, generationId) {
  return {
    schemaVersion: 1, applicationId, environment, eventId: `current-authority-${revision}`, eventType: "extension.lifecycle-transition",
    operationId: `current-authority-operation-${revision}`, operation, operationPhase: "completed", lifecycleState,
    expectedRevision: revision - 1, revision, inventoryRevision: revision,
    actor: { kind: "trusted-automation", identity: "fixture.current-authority" }, receiptId: `current-authority-receipt-${revision}`,
    auditId: `current-authority-audit-${revision}`, idempotencyKey: `current-authority:${revision}`, correlationId: `current-authority-${revision}`,
    occurredAt: "2026-09-01T00:00:00.000Z", deliveryClass: "platform-plugin", id: extensionId,
    evidence: { sourceCommit, compositionChangePlanDigest: `sha256:${"c".repeat(64)}`, generationId }
  };
}

async function transaction(pool, work) {
  const session = await pool.connect();
  try { await session.query("begin"); const result = await work(session); await session.query("commit"); return result; }
  catch (error) { await session.query("rollback"); throw error; }
  finally { session.release(); }
}

test("P10.7 durable lifecycle catalog binds and revokes Sales and Hot authority", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(image).withDatabase("current_authority_lifecycle").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let payload;
  try {
    await boot(container.getConnectionUri());
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.PAYLOAD_SECRET = "p10-7-current-authority";
    const { bootGate1Application } = await import("../dist/src/boot.js");
    payload = await bootGate1Application({ key: "p10-7-current-authority" });
    const { composedApplication } = await import("../dist/src/payload.config.js");
    const resolver = createStaticPlatformPluginAuthorizationDescriptorResolver({ applicationId, registrations: [{ sourceCommit, registration: composedApplication.registration }] });
    const projector = new AuthorizationLifecycleProjector(resolver);
    let userId;
    const store = new PostgresAuthorizationStore(pool, { validate: (id, subject) => id === applicationId && subject.kind === "user" && subject.id === userId ? "accepted" : "rejected" });
    const user = await payload.create({ collection: "users", data: { email: "fixture-user@example.test", password: "fixture-password" } });
    userId = String(user.id);
    const firstOwner = await bootstrapFirstOwner({ store, expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: userId } });
    await pool.query("insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition) values ($1,$2,$3,$4,0,'removed')", [applicationId, environment, "platform-plugin", extensionId]);
    const project = (event, runtimeGenerationIds, sql, values, updateCompatibility, priorGenerationEvidence) => transaction(pool, async (session) => {
      await session.query(sql, values);
      return projector.project({ session, transition: event, runtimeGenerationIds, ...(updateCompatibility === undefined ? {} : { updateCompatibility }), ...(priorGenerationEvidence === undefined ? {} : { priorGenerationEvidence }) });
    });
    const installed = lifecycleEvent("install", "active", 1, "static-module-sales-1");
    await project(installed, ["static-module-sales-1"],
      "update runtime_extensions set revision=1, disposition='active', active_generation_id=$5, active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [applicationId, environment, "platform-plugin", extensionId, "static-module-sales-1"]);
    await pool.query(
      "update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5",
      [JSON.stringify(staticBuild("static-module-sales-1")), applicationId, environment, "platform-plugin", extensionId]
    );
    await store.transaction(expected((await store.readState(applicationId, environment))), async (view) => {
      await view.write({ kind: "role", role: { schemaVersion: 1, applicationId, id: "fixture.sales-reader", label: "Fixture Sales reader", revision: 0 } });
      for (const permissionId of permissions) await view.write({ kind: "grant", grant: { schemaVersion: 1, applicationId, id: `fixture.${permissionId}`, roleId: "fixture.sales-reader", permissionId, owner: owner(1), revision: 0 } });
      await view.write({ kind: "assignment", assignment: { schemaVersion: 1, applicationId, id: "fixture.sales-reader.user", roleId: "fixture.sales-reader", principal: { kind: "user", id: String(user.id) }, state: "active", revision: 0 } });
    });
    await payload.create({ collection: "sales-tasks", data: { title: "durable catalog proof", status: "open", potentialRevenue: "1" } });
    const login = await payload.login({ collection: "users", data: { email: "fixture-user@example.test", password: "fixture-password" }, overrideAccess: false });
    const endpoint = payload.config.endpoints.find(({ path }) => path === "/k-nex/data-source-query");
    assert.ok(endpoint && login.token);
    const source = async () => endpoint.handler(await createPayloadRequest({ config: payload.config, payloadInstanceCacheKey: "p10-7-current-authority", request: new Request("http://localhost/api/k-nex/data-source-query", {
      method: "POST", headers: { authorization: `JWT ${login.token}`, "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "sales.tasks", surface: "workspace", input: {}, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields: ["title", "status", "potential-revenue"] })
    }) }));
    assert.equal((await source()).status, 200);

    await pool.query(
      "update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5",
      [JSON.stringify(staticBuild("static-module-sales-1", "b".repeat(40))), applicationId, environment, "platform-plugin", extensionId]
    );
    assert.equal((await source()).status, 403, "an old process cannot label its static descriptors as a newly promoted source");
    await pool.query(
      "update runtime_extensions set active_generation=$1::jsonb where application_id=$2 and environment=$3 and delivery_class=$4 and extension_id=$5",
      [JSON.stringify(staticBuild("static-module-sales-1")), applicationId, environment, "platform-plugin", extensionId]
    );

    await project(lifecycleEvent("disable", "disabled", 2, "static-module-sales-1"), ["static-module-sales-1"],
      "update runtime_extensions set revision=2, disposition='disabled', active_generation_id=null, active_generation=null where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [applicationId, environment, "platform-plugin", extensionId]);
    assert.equal((await source()).status, 403);

    await project(lifecycleEvent("install", "active", 3, "sales-one-restored"), ["sales-one-restored"],
      "update runtime_extensions set revision=3, disposition='active', active_generation_id=$5, active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [applicationId, environment, "platform-plugin", extensionId, "sales-one-restored"]);
    assert.equal((await source()).status, 403, "a process from the former static generation cannot authorize the newly active binary");

    await project(lifecycleEvent("update", "active", 4, "sales-two"), ["sales-two"],
      "update runtime_extensions set revision=4, disposition='active', active_generation_id=$5, active_generation='{}'::jsonb where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [applicationId, environment, "platform-plugin", extensionId, "sales-two"], "incompatible", { authority: "static-build", sourceCommit, generationId: "sales-one-restored" });
    assert.equal((await source()).status, 403);

    await project(lifecycleEvent("uninstall", "removed", 5, "sales-two-removed"), ["sales-two"],
      "update runtime_extensions set revision=5, disposition='removed', active_generation_id=null, active_generation=null, retained_generation=$5::jsonb where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [applicationId, environment, "platform-plugin", extensionId, JSON.stringify({ authority: "static-build", sourceCommit, generationId: "sales-two" })]);
    assert.equal((await source()).status, 403);

    await project(lifecycleEvent("install", "active", 6, "sales-three"), ["sales-three"],
      "update runtime_extensions set revision=6, disposition='active', active_generation_id=$5, active_generation='{}'::jsonb, retained_generation=null where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4",
      [applicationId, environment, "platform-plugin", extensionId, "sales-three"]);
    assert.equal((await source()).status, 403, "retired generation grants never revive after reinstall");
    const reinstalled = await store.readState(applicationId, environment);
    const contribution = createPlatformPluginRegistrationAuthorizationContribution({
      registration: composedApplication.registration,
      generation: { schemaVersion: 1, applicationId, owner: owner(3), runtimeGenerationIds: ["sales-three"], state: "current", authorizationRevision: reinstalled.authorizationRevision, lifecycleRevision: reinstalled.lifecycleRevision }
    });
    const catalog = createEffectiveAuthorizationCatalog({
      applicationId,
      lifecycleRevision: reinstalled.lifecycleRevision,
      extensions: [contribution],
      executables: composedApplication.registration.contributions.policyBindings
        .filter(({ pluginId }) => pluginId === extensionId)
        .map(({ value }) => createPlatformPluginPolicyExecutable({ kind: "platform-plugin", publisher: value.publisher, bindingId: value.id, policyReference: value.policyReference, executor: { evaluate: () => ({ schemaVersion: 1, outcome: "allow" }) } }))
    });
    await adoptRetainedExtensionGrants({ store, expected: expected(reinstalled), effectiveCatalog: catalog, targetOwner: owner(3), roleId: "fixture.sales-reader", selectedGrantIds: permissions.map((permissionId) => `fixture.${permissionId}`).sort() });
    assert.equal((await source()).status, 403, "retained-grant adoption does not let an old static binary impersonate the new generation");

    await pool.query("update runtime_extensions set disposition='quarantined', active_generation_id=null, active_generation=null where application_id=$1 and environment=$2 and delivery_class=$3 and extension_id=$4", [applicationId, environment, "platform-plugin", extensionId]);
    assert.equal((await source()).status, 403);

    let hotRelease = hotBuild("app-sales-assistant-generation-1", "1");
    const artifacts = new Map([[hotRelease.active.generationId, hotRelease.artifact]]);
    const hotStore = {
      async inventory() {
        const result = await pool.query(
          "select disposition, active_generation from runtime_extensions where application_id=$1 and environment=$2 and delivery_class='hot-application' and extension_id=$3",
          [applicationId, environment, hotManifest.id]
        );
        const row = result.rows[0];
        return { extensions: { platformPlugins: {}, themeSkins: {}, hotApplications: row?.disposition === "active" ? {
          [hotManifest.id]: { disposition: "active", activeGeneration: row.active_generation }
        } : {} } };
      },
      async acquireGenerationLease() { return "lease-00000000-0000-4000-8000-000000000000"; },
      async releaseGenerationLease() {}
    };
    const hotRuntime = new AuthoritativeHotApplicationRuntime(
      hotStore,
      { resolve: async ({ generationId, artifactDigest }) => {
        const artifact = artifacts.get(generationId);
        return artifact?.authority.artifactDigest === artifactDigest ? artifact : undefined;
      } },
      { issue: () => "capability-token" },
      { isolationProfile: hotProfile, invoke: async () => ({ schemaVersion: 1, outcome: "allow" }) },
      { authorize: async () => true },
      { applicationId, environment, appId: hotManifest.id },
      "p10-current-authority-hot-proof"
    );
    composedApplication.hotAuthorizationRuntimeRegistry.register(hotManifest.id, hotRuntime);
    let state = await store.readState(applicationId, environment);
    const hotOwner = (generation) => ({ kind: "extension", deliveryClass: "hot-application", extensionId: hotManifest.id, generation });
    await pool.query(
      "insert into k_nex_extension_authorization_generations (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision) values ($1,'hot-application',$2,1,$3::jsonb,'current',$4,$5)",
      [applicationId, hotManifest.id, JSON.stringify([hotRelease.active.generationId]), state.authorizationRevision, state.lifecycleRevision]
    );
    await pool.query(
      "insert into runtime_extensions (application_id, environment, delivery_class, extension_id, revision, disposition, active_generation_id, active_generation) values ($1,$2,'hot-application',$3,1,'active',$4,$5::jsonb)",
      [applicationId, environment, hotManifest.id, hotRelease.active.generationId, JSON.stringify(hotRelease.active)]
    );
    const hotGrantId = "fixture.hot-sales-assistant.read";
    state = (await store.transaction(expected(state), async (view) => {
      await view.write({ kind: "grant", grant: {
        schemaVersion: 1, applicationId, id: hotGrantId, roleId: "fixture.sales-reader",
        permissionId: hotManifest.permissions[0].id, owner: hotOwner(1), revision: state.authorizationRevision + 1
      } });
    })).state;
    const hotRequest = { payload, user: { ...user, collection: "users" } };
    const hotContext = composedApplication.authority.context(hotRequest, "p10-hot-lifecycle", hotRequest.user);
    const hotTarget = createCurrentAuthorityTarget({
      permissionId: hotManifest.permissions[0].id,
      scope: { kind: "record", resource: hotManifest.permissions[0].resource, recordId: "assistant-task-1" },
      facts: {}
    });
    assert.equal(await composedApplication.authority.adapter.allows(hotContext, hotTarget), true, "the composed host discovers a registered Hot runtime without authority reconstruction");

    await transaction(pool, async (session) => {
      await session.query("update runtime_extensions set revision=2, disposition='quarantined', active_generation_id=null, active_generation=null, retained_generation=$4::jsonb where application_id=$1 and environment=$2 and extension_id=$3", [applicationId, environment, hotManifest.id, JSON.stringify(hotRelease.active)]);
      await session.query("update k_nex_extension_authorization_generations set state='retired', lifecycle_revision=$3 where application_id=$1 and extension_id=$2 and authorization_generation=1", [applicationId, hotManifest.id, state.lifecycleRevision + 1]);
      await session.query("update k_nex_authorization_state set lifecycle_revision=$2 where application_id=$1", [applicationId, state.lifecycleRevision + 1]);
    });
    state = await store.readState(applicationId, environment);
    assert.equal(await composedApplication.authority.adapter.allows(hotContext, hotTarget), false, "Hot quarantine revokes only that app's authority");

    hotRelease = hotBuild("app-sales-assistant-generation-2", "6");
    artifacts.set(hotRelease.active.generationId, hotRelease.artifact);
    await transaction(pool, async (session) => {
      await session.query("update runtime_extensions set revision=3, disposition='active', active_generation_id=$4, active_generation=$5::jsonb, retained_generation=null where application_id=$1 and environment=$2 and extension_id=$3", [applicationId, environment, hotManifest.id, hotRelease.active.generationId, JSON.stringify(hotRelease.active)]);
      await session.query(
        "insert into k_nex_extension_authorization_generations (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision) values ($1,'hot-application',$2,2,$3::jsonb,'current',$4,$5)",
        [applicationId, hotManifest.id, JSON.stringify([hotRelease.active.generationId]), state.authorizationRevision, state.lifecycleRevision + 1]
      );
      await session.query("update k_nex_authorization_state set lifecycle_revision=$2 where application_id=$1", [applicationId, state.lifecycleRevision + 1]);
    });
    state = await store.readState(applicationId, environment);
    assert.equal(await composedApplication.authority.adapter.allows(hotContext, hotTarget), false, "a retired Hot grant does not revive on recovery");
    state = (await store.transaction(expected(state), async (view) => {
      await view.write({ kind: "grant", grant: {
        schemaVersion: 1, applicationId, id: hotGrantId, roleId: "fixture.sales-reader",
        permissionId: hotManifest.permissions[0].id, owner: hotOwner(2), revision: state.authorizationRevision + 1
      } });
    })).state;
    assert.equal(await composedApplication.authority.adapter.allows(hotContext, hotTarget), true, "only an exact current-generation Hot grant restores authority");

    await transaction(pool, async (session) => {
      await session.query("update k_nex_authorization_state set lifecycle_revision=$2 where application_id=$1", [applicationId, state.lifecycleRevision + 1]);
    });
    state = await store.readState(applicationId, environment);
    assert.equal(await composedApplication.authority.adapter.allows(hotContext, hotTarget), true, "an unrelated global lifecycle advance does not revoke an unchanged exact Hot generation");

    await transaction(pool, async (session) => {
      await session.query("update runtime_extensions set revision=4, disposition='removed', active_generation_id=null, active_generation=null, retained_generation=$4::jsonb where application_id=$1 and environment=$2 and extension_id=$3", [applicationId, environment, hotManifest.id, JSON.stringify(hotRelease.active)]);
      await session.query("update k_nex_extension_authorization_generations set state='retired', lifecycle_revision=$3 where application_id=$1 and extension_id=$2 and authorization_generation=2", [applicationId, hotManifest.id, state.lifecycleRevision + 1]);
      await session.query("update k_nex_authorization_state set lifecycle_revision=$2 where application_id=$1", [applicationId, state.lifecycleRevision + 1]);
    });
    assert.equal(await composedApplication.authority.adapter.allows(hotContext, hotTarget), false, "Hot uninstall revokes authority");
    composedApplication.hotAuthorizationRuntimeRegistry.unregister(hotManifest.id);
  } finally {
    await payload?.destroy();
    await pool.end();
    payload?.db?.pool?.on?.("error", () => undefined);
    await container.stop();
  }
});
