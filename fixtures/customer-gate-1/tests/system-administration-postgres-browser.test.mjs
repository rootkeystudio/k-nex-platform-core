import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgresAuthorizationStore } from "@k-nex/payload-adapter";
import {
  CurrentAuthorityAdapter,
  EffectiveAuthorityResolver,
  SystemExtensionAdministrationError,
  SystemAccessAdministrationService,
  SystemExtensionAdministrationService,
  bootstrapFirstOwner,
  createAuthorizationCatalogProvider,
  createEffectiveAuthorizationCatalog,
  createEffectiveAuthorizationRequest,
  createPlatformPluginRegistrationAuthorizationContribution,
  createTrustedAuthorizationSession,
  definePluginRegistration,
  executeRegistration,
  scopePlatformPluginRegistration
} from "@k-nex/runtime";
import { chromium } from "playwright";
import pg from "pg";

import { startSystemAdministrationHost } from "../dist/src/system-administration-host.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-system-administration";
const environment = "production";
const ownerId = "user:system-owner";
const inactiveId = "user:inactive-role";

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], { cwd: fixtureDirectory, env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p10-9-system-administration", BOOT_KEY: "p10-9-system-administration" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject).once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function catalog(lifecycleRevision = 0) {
  const publisher = { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" };
  const owner = { ...publisher, generation: 1 };
  const descriptors = ["sales.pipeline.read", "sales.pipeline.manage"].map((id) => ({ schemaVersion: 1, id, publisher, title: id, description: "Sales template permission", audience: "authenticated", resource: "sales.pipeline", operation: id.endsWith("read") ? "read" : "manage", scope: "application" }));
  const template = { schemaVersion: 1, id: "sales.manager", publisher, version: 1, instantiation: "manual", title: "Sales manager", permissionIds: descriptors.map(({ id }) => id).sort() };
  const manifest = { apiVersion: 1, id: "module.sales", kind: "module", displayName: "Sales", version: "1.0.0", package: "@k-nex/module-sales", compatibility: { core: ">=1.0.0 <2.0.0", payload: ">=3.0.0 <4.0.0", node: ">=24.0.0 <25.0.0", payloadDatabaseAdapters: ["postgres"] }, provides: [], requires: [], optional: [], conflicts: [], surfaces: ["workspace"], lifecycle: { ownsPayloadSchema: false, ownsPersistentData: false, disable: "supported", uninstall: "supported", purge: "supported" }, contributions: { permissions: Object.fromEntries(descriptors.map(({ id }) => [id, "required"])), policyBindings: {}, roleTemplates: { [template.id]: "required" } } };
  const graph = { resolverVersion: "1.0.0", plugins: [{ id: manifest.id, kind: manifest.kind, package: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" , required: [], optional: [] }], capabilityProviders: [], registrationOrder: [manifest.id] };
  const registration = definePluginRegistration({ pluginId: manifest.id, contracts(context) { for (const descriptor of descriptors) context.register("permissions", descriptor.id, descriptor); context.register("roleTemplates", template.id, template); } });
  const scoped = scopePlatformPluginRegistration(executeRegistration({ graph, installed: [{ package: { name: manifest.package, version: manifest.version, integrity: "sha512-c2FsZXM=" }, manifest }], registrations: [registration] }), []);
  const contribution = createPlatformPluginRegistrationAuthorizationContribution({ registration: scoped, generation: { schemaVersion: 1, applicationId, owner, runtimeGenerationIds: ["sales-administration-generation"], state: "current", authorizationRevision: 1, lifecycleRevision } });
  return createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [contribution], executables: [] });
}

function planFor(input) {
  const common = { schemaVersion: 1, planId: "plan-system-administration", operationId: input.idempotencyKey, operation: input.operation, version: input.targetVersion, artifactDigest: `sha256:${"a".repeat(64)}`, expectedRevision: input.expectedRevision, targetGenerationId: "generation-system-administration", approvalRequired: input.extension.deliveryClass === "hot-application", rollback: { available: true, windowSeconds: 60 } };
  if (input.extension.deliveryClass === "hot-application") return { executionClass: "live-generation", operationId: common.operationId, generationId: common.targetGenerationId, plan: { ...common, deliveryClass: "hot-application", id: input.extension.id, availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, requiredCapabilities: [], resourceBudget: { cpuMilliCores: 100, memoryMiB: 64, processes: 1, openFiles: 16, tempBytes: 1024, wallTimeMs: 1000, inputBytes: 1024, outputBytes: 1024, logBytes: 1024, concurrency: 1 } } };
  if (input.extension.deliveryClass === "theme-skin") return { executionClass: "live-generation", operationId: common.operationId, generationId: common.targetGenerationId, plan: { ...common, deliveryClass: "theme-skin", id: input.extension.id, availability: { outcome: "live-generation", activation: "atomic-generation-pointer" }, resourceBudget: { cssBytes: 1024, assetBytes: 1024 } } };
  return { executionClass: "static-release", operationId: common.operationId, generationId: common.targetGenerationId, plan: { ...common, deliveryClass: "platform-plugin", id: input.extension.id, availability: input.extension.id === "module.sales" ? { outcome: "maintenance-required", reasons: ["incompatible-overlap"] } : { outcome: "zero-downtime-eligible", checks: { oldGenerationHealthy: true, expandCompatibleMigration: true, writerReaderOverlap: true, workerDrain: true, realtimeConvergence: true, targetReadiness: true, inventoryMatch: true, rollbackCompatible: true } } } };
}

async function request(url, path, token, body) {
  return fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { cookie: `system_session=${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function submit(page, label) {
  const navigation = page.waitForNavigation();
  await page.getByRole("button", { name: label, exact: true }).click();
  return navigation;
}

function authorityRequest(decisionId, permissionId, resource) {
  return createEffectiveAuthorizationRequest({ schemaVersion: 1, decisionId, permissionId, scope: { kind: "application", resource }, facts: { boundary: "system-administration-ui" } });
}

test("P10.9 proves fixed host routes, RBAC actions, lifecycle truth, and Chromium semantics against PostgreSQL", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("system_administration").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let host;
  let browser;
  try {
    await boot(container.getConnectionUri());
    const store = new PostgresAuthorizationStore(pool, { validate: (currentApplicationId, subject) => currentApplicationId === applicationId && subject.kind === "user" && [ownerId, inactiveId].includes(subject.id) ? "accepted" : "rejected" });
    await bootstrapFirstOwner({ store, expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: ownerId } });
    const provider = createAuthorizationCatalogProvider(({ applicationId: requested, lifecycleRevision }) => requested === applicationId ? { applicationId, lifecycleRevision, catalog: catalog(lifecycleRevision) } : undefined);
    const resolver = new EffectiveAuthorityResolver({ store, catalogProvider: provider });
    const sessions = new Map([
      ["owner", createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "p10-9-owner", principal: { kind: "user", id: ownerId }, effectiveActor: { kind: "user", id: ownerId } })],
      ["limited", createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "p10-9-limited", principal: { kind: "user", id: inactiveId }, effectiveActor: { kind: "user", id: inactiveId } })],
      ["plan-only", createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "p10-9-plan-only", principal: { kind: "user", id: inactiveId }, effectiveActor: { kind: "user", id: inactiveId } })]
    ]);
    const authority = new CurrentAuthorityAdapter({ current(context) { return context?.session ? sessions.get(context.session) : undefined; } }, resolver);
    const access = new SystemAccessAdministrationService({ store, catalogProvider: provider, authority });
    let approval = false;
    let operatorCalls = 0;
    let activationCalls = 0;
    const operations = new Map();
    const operation = (input) => ({ operationId: input.idempotencyKey, request: { ...input, correlationId: "system-extension-administration" }, phase: "staged", plan: planFor(input) });
    const records = [
      ["hot-application", "app.sales-assistant", "Sales assistant", "live-generation"], ["theme-skin", "skin.accent", "Accent skin", "live-generation"], ["platform-plugin", "module.reports", "Reports", "static-release"], ["platform-plugin", "module.sales", "Sales", "static-release"]
    ].map(([deliveryClass, id, displayName, availability]) => ({ extension: { deliveryClass, id }, version: "1.0.0", displayName, support: "supported", review: "approved", security: "clear", revoked: false, availability }));
    const operator = {
      async catalogList() { operatorCalls += 1; return records; }, async catalogDetail(identity) { return records.find((record) => record.extension.id === identity.id); },
      async status() { operatorCalls += 1; return { applicationId, environment, inventory: { revision: 7, extensions: {
        hotApplications: { "app.sales-assistant": { disposition: "active" } },
        themeSkins: { "skin.accent": { disposition: "active" } },
        platformPlugins: { "module.reports": { disposition: "active" }, "module.sales": { disposition: "disabled" } }
      } }, health: records.map(({ extension }) => ({ extension, state: extension.id === "module.sales" ? "healthy" : "degraded" })) }; },
      async plan(input) { operatorCalls += 1; const current = operation(input); operations.set(input.idempotencyKey, current); return current.plan; }, async operation(operationId) { operatorCalls += 1; return [...operations.values()].find((current) => current.operationId === operationId) ?? operation({ applicationId, environment, extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", expectedRevision: 7, idempotencyKey: "system-administration-plan" }); },
      async activate() { operatorCalls += 1; activationCalls += 1; return { receiptId: "receipt-system-administration" }; }, async rollback() { throw new Error("not used"); }, async disable() { throw new Error("not used"); }, async uninstall() { throw new Error("not used"); }
    };
    const planOnlyOperator = Object.freeze({ ...operator, async activate() { throw new SystemExtensionAdministrationError("UNAUTHORIZED", "Bound plan-only operator denies lifecycle execution."); } });
    const extensions = new SystemExtensionAdministrationService({ operator: { resolve(context) { return context?.session === "plan-only" ? planOnlyOperator : context?.session === "owner" ? operator : undefined; } }, authority, state: store, approval: { verify: async () => approval } });
    host = await startSystemAdministrationHost({ access, extensions, context(requestMessage) { const token = /(?:^|;\\s*)system_session=([^;]+)/u.exec(requestMessage.headers.cookie ?? "")?.[1]; return token ? { session: token } : undefined; }, sessionKey(context) { return context?.session; }, async expected() { const state = await store.readState(applicationId, environment); assert.ok(state); return { ...state, extensionRevision: 7 }; } });

    const beforeDenied = operatorCalls;
    assert.equal((await request(host.url, "/system/access/roles")).status, 403);
    assert.equal((await request(host.url, "/api/system/extensions/plan", undefined, { expected: { applicationId, environment, authorizationRevision: 1, lifecycleRevision: 0, extensionRevision: 7 }, request: { extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", idempotencyKey: "system-administration-plan" } })).status, 403);
    assert.equal((await request(host.url, "/api/system/extensions/plan", undefined, { expected: { applicationId, environment, authorizationRevision: 1, lifecycleRevision: 0, extensionRevision: 7 }, request: { extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", idempotencyKey: "system-administration-plan", owner: { kind: "platform" } } })).status, 400);
    assert.equal(operatorCalls, beforeDenied, "unauthenticated route/action attacks must stop before the extension operator");
    assert.equal((await request(host.url, "/system/extensions", "limited")).status, 403);

    const initial = await store.readState(applicationId, environment);
    await store.transaction({ applicationId, environment, authorizationRevision: initial.authorizationRevision, lifecycleRevision: initial.lifecycleRevision }, async (transaction) => {
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.mixed-role", applicationId, label: "Mixed role", revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.second-role", applicationId, label: "Second role", revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "customer.plan-only-role", applicationId, label: "Plan only role", revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "role", role: { schemaVersion: 1, id: "sales.inactive-role", applicationId, label: "Inactive Sales role", revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "extension-generation", generation: { schemaVersion: 1, applicationId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 1 }, runtimeGenerationIds: ["sales-administration-generation"], state: "current", authorizationRevision: initial.authorizationRevision + 1, lifecycleRevision: initial.lifecycleRevision + 1 } });
      await transaction.write({ kind: "extension-generation", generation: { schemaVersion: 1, applicationId, owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 }, runtimeGenerationIds: ["sales-retired-generation"], state: "retired", authorizationRevision: initial.authorizationRevision + 1, lifecycleRevision: initial.lifecycleRevision + 1 } });
      await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: "sales.inactive-grant", applicationId, roleId: "sales.inactive-role", permissionId: "sales.pipeline.read", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 }, revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "sales.inactive-assignment", applicationId, roleId: "sales.inactive-role", principal: { kind: "user", id: inactiveId }, state: "active", revision: initial.authorizationRevision + 1 } });
      for (const permissionId of ["system.extensions.read", "system.extensions.plan"]) await transaction.write({ kind: "grant", grant: { schemaVersion: 1, id: `plan-only-${permissionId.replace(/[^a-z]/gu, "-")}`, applicationId, roleId: "customer.plan-only-role", permissionId, owner: { kind: "platform", namespace: "system" }, revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "assignment", assignment: { schemaVersion: 1, id: "plan-only-assignment", applicationId, roleId: "customer.plan-only-role", principal: { kind: "user", id: inactiveId }, state: "active", revision: initial.authorizationRevision + 1 } });
      await transaction.write({ kind: "catalog-snapshot", snapshot: { schemaVersion: 1, id: "sales.inactive-snapshot", applicationId, source: "administrative-non-authoritative", permission: { schemaVersion: 1, id: "sales.pipeline.read", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" }, title: "Sales pipeline read", description: "Disabled extension", audience: "authenticated", resource: "sales.pipeline", operation: "read", scope: "application" }, state: "inactive-extension-disabled", owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 }, revision: initial.authorizationRevision + 1 } });
    });
    const expected = async () => {
      const state = await store.readState(applicationId, environment);
      assert.ok(state);
      return { applicationId, environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision, extensionRevision: 7 };
    };
    const accessExpected = async () => {
      const current = await expected();
      return { applicationId: current.applicationId, environment: current.environment, authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision };
    };
    const assertRevisionOutbox = async (before, operation) => {
      const after = await expected();
      assert.equal(after.authorizationRevision, before.authorizationRevision + 1, `${operation} advances authorization revision`);
      assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_outbox where application_id=$1 and environment=$2 and authorization_revision=$3 and lifecycle_revision=$4", [applicationId, environment, after.authorizationRevision, after.lifecycleRevision])).rows[0].count, 1, `${operation} writes one revision outbox`);
      return after;
    };
    const authorityProbe = await resolver.authorize(sessions.get("owner"), createEffectiveAuthorizationRequest({ schemaVersion: 1, decisionId: "p10-9-owner-read-roles", permissionId: "system.roles.read", scope: { kind: "application", resource: "system.roles" }, facts: { boundary: "system-access-administration" } }));
    assert.equal(authorityProbe.outcome, "allow", JSON.stringify(authorityProbe));
    await assert.doesNotReject(access.roles({ context: { session: "owner" } }));
    const allRoutes = ["/system/access/roles", "/system/access/roles/sales.inactive-role", "/system/access/permissions", "/system/access/assignments", "/system/access/templates", "/system/access/audit", "/system/extensions", "/system/extensions/module.sales"];
    browser = await chromium.launch();
    const context = await browser.newContext();
    await context.addCookies([{ name: "system_session", value: "owner", url: host.url }]);
    for (const path of allRoutes) {
      const page = await context.newPage();
      const response = await page.goto(`${host.url}${path}`);
      assert.equal(response?.status(), 200, `${path}: ${await page.content()}`);
      assert.equal(await page.locator("h1").count(), 1, `${path} has semantic H1`);
      assert.equal(await page.locator("main").count(), 1, `${path} has main`);
      assert.ok(await page.locator("a[href='#main-content']").count(), `${path} has skip link`);
      assert.ok(await page.locator("nav[aria-label='System administration']").count(), `${path} has navigation`);
      await page.close();
    }
    const detail = await request(host.url, "/system/access/roles/sales.inactive-role", "owner");
    assert.match(await detail.text(), /Inactive permission diagnostics/u);
    const permissions = await request(host.url, "/system/access/permissions", "owner");
    assert.match(await permissions.text(), /inactive-extension-disabled/u);
    const assignments = await request(host.url, "/system/access/assignments", "owner");
    assert.match(await assignments.text(), /Inactive Sales role/u);
    const rolesPage = await request(host.url, "/system/access/roles", "owner");
    assert.match(await rolesPage.text(), /Inactive Sales role/u, "assigned inactive role must remain on the default roles page");
    const roleEditor = await request(host.url, "/system/access/roles/sales.inactive-role", "owner");
    const roleEditorText = await roleEditor.text();
    assert.match(roleEditorText, /Platform system/u);
    assert.match(roleEditorText, /system\.roles/u);
    assert.match(roleEditorText, /read/u);
    const protectedEditor = await request(host.url, "/system/access/roles/system.role.owner", "owner");
    assert.doesNotMatch(await protectedEditor.text(), /\/api\/system\/access\/grants\//u, "protected role grants have no removal action");

    const actionPage = await context.newPage();
    await actionPage.goto(`${host.url}/system/access/roles/customer.mixed-role`);
    assert.equal((await submit(actionPage, "Add system.settings.read"))?.status(), 200, "Chromium submits individual permission form");
    await actionPage.goto(`${host.url}/system/access/templates`);
    assert.equal((await submit(actionPage, "Instantiate sales.manager"))?.status(), 200, "Chromium submits template instantiation form");
    await actionPage.goto(`${host.url}/system/access/roles/customer.mixed-role`);
    const beforeTemplate = await accessExpected();
    await actionPage.getByRole("checkbox", { name: "sales.pipeline.read", exact: true }).check();
    assert.equal((await submit(actionPage, "Copy sales.manager permissions"))?.status(), 200, "Chromium submits template-copy form");
    const mixedGrants = (await access.roleDetail({ context: { session: "owner" }, roleId: "customer.mixed-role" })).grants.map(({ grant }) => grant.permissionId);
    assert.ok(mixedGrants.includes("sales.pipeline.read"), "Chromium can select the non-first template permission");
    assert.ok(!mixedGrants.includes("sales.pipeline.manage"), "unselected template permission is not copied");
    await actionPage.goto(`${host.url}/system/access/assignments`);
    assert.equal((await submit(actionPage, "Create fixture assignment"))?.status(), 200, "Chromium submits assignment creation form");
    assert.equal((await resolver.authorize(sessions.get("limited"), authorityRequest("p10-9-sales-before-remove", "sales.pipeline.read", "sales.pipeline"))).outcome, "allow", "next request receives newly assigned role grant");
    await actionPage.goto(`${host.url}/system/access/roles/customer.mixed-role`);
    const beforeRemoval = await expected();
    assert.equal((await submit(actionPage, "Remove sales.pipeline.read"))?.status(), 200, "Chromium removes an existing active role grant");
    await assertRevisionOutbox(beforeRemoval, "grant removal");
    assert.ok(!(await access.roleDetail({ context: { session: "owner" }, roleId: "customer.mixed-role" })).grants.some(({ grant }) => grant.permissionId === "sales.pipeline.read"), "removed role grant no longer exists");
    assert.equal((await resolver.authorize(sessions.get("limited"), authorityRequest("p10-9-sales-after-remove", "sales.pipeline.read", "sales.pipeline"))).outcome, "deny", "next request loses removed role grant");
    const beforeStaleAudits = (await pool.query("select count(*)::int as count from k_nex_authorization_audit where application_id=$1", [applicationId])).rows[0].count;
    const beforeStaleGrants = (await pool.query("select count(*)::int as count from k_nex_role_permission_grants where application_id=$1", [applicationId])).rows[0].count;
    assert.equal((await request(host.url, "/api/system/access/templates/copy", "owner", { expected: beforeTemplate, templateId: "sales.manager", roleId: "customer.mixed-role", permissionIds: ["sales.pipeline.manage"] })).status, 409, "stale revisions must conflict");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_authorization_audit where application_id=$1", [applicationId])).rows[0].count, beforeStaleAudits, "stale HTTP mutation writes no audit");
    assert.equal((await pool.query("select count(*)::int as count from k_nex_role_permission_grants where application_id=$1", [applicationId])).rows[0].count, beforeStaleGrants, "stale HTTP mutation writes no grant");
    await actionPage.goto(`${host.url}/system/access/roles/customer.second-role`);
    await actionPage.getByRole("checkbox", { name: "sales.pipeline.manage", exact: true }).check();
    await actionPage.getByRole("checkbox", { name: "sales.pipeline.read", exact: true }).check();
    assert.equal((await submit(actionPage, "Copy sales.manager permissions"))?.status(), 200, "Chromium submits a multi-permission selection");
    assert.deepEqual((await access.roleDetail({ context: { session: "owner" }, roleId: "customer.second-role" })).grants.map(({ grant }) => grant.permissionId).sort(), ["sales.pipeline.manage", "sales.pipeline.read"]);
    assert.equal((await resolver.authorize(sessions.get("limited"), authorityRequest("p10-9-settings-before-revoke", "system.settings.read", "system.settings"))).outcome, "allow", "active assignment authorizes current role grant");
    await actionPage.goto(`${host.url}/system/access/assignments`);
    const beforeRevoke = await expected();
    assert.equal((await submit(actionPage, "Revoke customer.mixed-assignment"))?.status(), 200, "Chromium submits assignment revocation form");
    await assertRevisionOutbox(beforeRevoke, "assignment revocation");
    assert.equal((await resolver.authorize(sessions.get("limited"), authorityRequest("p10-9-settings-after-revoke", "system.settings.read", "system.settings"))).outcome, "deny", "next request loses revoked assignment authority");
    await actionPage.goto(`${host.url}/system/access/assignments`);
    const beforeReactivate = await expected();
    assert.equal((await submit(actionPage, "Reactivate customer.mixed-assignment"))?.status(), 200, "Chromium reactivates the same revoked assignment");
    await assertRevisionOutbox(beforeReactivate, "assignment reactivation");
    assert.equal((await access.assignments({ context: { session: "owner" } })).find(({ id }) => id === "customer.mixed-assignment")?.state, "active");
    assert.equal((await resolver.authorize(sessions.get("limited"), authorityRequest("p10-9-settings-after-reactivate", "system.settings.read", "system.settings"))).outcome, "allow", "next request restores reactivated assignment authority");
    const audit = await request(host.url, "/system/access/audit", "owner");
    assert.match(await audit.text(), /system\.roles\.manage/u);
    assert.ok((await pool.query("select count(*)::int as count from k_nex_authorization_audit where application_id=$1", [applicationId])).rows[0].count >= 3, "role mutations must write real PostgreSQL audit rows");
    const auditRows = (await pool.query("select audit_id from k_nex_authorization_audit where application_id=$1 order by audit_id asc limit 3", [applicationId])).rows;
    for (const [index, row] of auditRows.entries()) await pool.query("update k_nex_authorization_audit set created_at=$1::timestamptz where application_id=$2 and audit_id=$3", [`2030-01-01T00:00:0${index}.000Z`, applicationId, row.audit_id]);
    const durableAudits = await access.audits({ context: { session: "owner" }, limit: 100 });
    const selected = durableAudits.filter(({ audit: entry }) => auditRows.some((row) => row.audit_id === entry.auditId));
    assert.deepEqual(selected.map(({ occurredAt }) => occurredAt), ["2030-01-01T00:00:02.000Z", "2030-01-01T00:00:01.000Z", "2030-01-01T00:00:00.000Z"], "real PostgreSQL audit timestamps order newest first");
    assert.equal((await access.audits({ context: { session: "owner" }, afterAuditId: selected[0].audit.auditId, limit: 100 }))[0]?.audit.auditId, selected[1].audit.auditId, "audit cursor continues from durable timestamp order");
    const durableAuditPage = await request(host.url, "/system/access/audit", "owner");
    assert.match(await durableAuditPage.text(), /2030-01-01T00:00:02\.000Z/u, "audit page displays durable ISO timestamp, not audit ID");

    await actionPage.goto(`${host.url}/system/extensions/app.sales-assistant`);
    assert.equal((await submit(actionPage, "Plan install"))?.status(), 200, "Chromium submits extension plan form");
    await actionPage.goto(`${host.url}/system/extensions/app.sales-assistant`);
    assert.equal((await submit(actionPage, "Execute planned operation"))?.status(), 403, "approval-required browser execution must not activate without a verifier");
    approval = true;
    await actionPage.goto(`${host.url}/system/extensions/app.sales-assistant`);
    assert.equal((await submit(actionPage, "Execute planned operation"))?.status(), 200, "Chromium submits approved extension execution form");
    const planOnly = { expected: await expected(), request: { extension: { deliveryClass: "hot-application", id: "app.sales-assistant" }, operation: "install", targetVersion: "1.0.0", idempotencyKey: "plan-only-administration" } };
    assert.equal((await request(host.url, "/api/system/extensions/plan", "plan-only", planOnly)).status, 200, "plan-only session receives only its bound planner facade");
    assert.equal((await request(host.url, "/api/system/extensions/app.sales-assistant/execute", "plan-only", { expected: await expected(), operationId: "plan-only-administration" })).status, 403, "plan-only bound operator cannot reach lifecycle execution");
    assert.equal(activationCalls, 1, "plan-only facade must not invoke the owner lifecycle operator");
    for (const [extension, expectedOutcome] of [[{ deliveryClass: "theme-skin", id: "skin.accent" }, "install-live"], [{ deliveryClass: "platform-plugin", id: "module.reports" }, "no-outage-deployment"], [{ deliveryClass: "platform-plugin", id: "module.sales" }, "maintenance-required"]]) {
      const response = await request(host.url, "/api/system/extensions/plan", "owner", { expected: await expected(), request: { extension, operation: "install", targetVersion: "1.0.0", idempotencyKey: `system-plan-${extension.id.replace(/[^a-z]/gu, "")}` } });
      assert.equal(response.status, 200); assert.equal((await response.json()).display.outcome, expectedOutcome);
    }
    const extensionsPage = await request(host.url, "/system/extensions", "owner");
    const extensionsPageText = await extensionsPage.text();
    assert.match(extensionsPageText, /Install live/u);
    assert.match(extensionsPageText, /No-outage deployment/u);
    assert.match(extensionsPageText, /maintenance-required/u);
    const salesExtension = await request(host.url, "/system/extensions/module.sales", "owner");
    const salesExtensionText = await salesExtension.text();
    assert.match(salesExtensionText, /maintenance-required/u);
    assert.match(salesExtensionText, /disabled/u, "durable inventory disposition wins over conflicting healthy observation");
    await actionPage.goto(`${host.url}/system/extensions/module.sales`);
    const salesBrowserText = await actionPage.locator("body").innerText();
    assert.ok(salesBrowserText.indexOf("incompatible-overlap") >= 0 && salesBrowserText.indexOf("incompatible-overlap") < salesBrowserText.indexOf("Execute planned operation"), "canonical maintenance impact appears before execution");
    assert.equal((await request(host.url, "/api/system/extensions/module.sales/execute", "owner", { expected: await expected(), operationId: "forged-operation" })).status, 403, "forged execution identity must not reach the operator");
    console.log("P10_9_SYSTEM_ADMIN_POSTGRES_CHROMIUM_EVIDENCE=PASS");
    await context.close();
  } finally {
    await browser?.close();
    await host?.close();
    await pool.end();
    await container.stop();
  }
});
