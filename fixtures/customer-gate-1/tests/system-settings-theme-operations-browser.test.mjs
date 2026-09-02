import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { canonicalJson } from "@k-nex/contracts";
import { PostgresAuthorizationStore, PostgresSystemOperationsStore, PostgresSystemSettingsStore } from "@k-nex/payload-adapter";
import {
  CurrentAuthorityAdapter, EffectiveAuthorityResolver, SystemCatalogAdministrationService, SystemOperationsAdministrationService, SystemSettingsAdministrationService,
  SystemThemeAdministrationService, bootstrapFirstOwner, createAuthorizationCatalogProvider, createEffectiveAuthorizationCatalog,
  createTrustedAuthorizationSession
} from "@k-nex/runtime";
import { chromium } from "playwright";
import pg from "pg";

import { startSystemAdministrationHost } from "../dist/src/system-administration-host.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const applicationId = "customer-fixed-administration";
const environment = "production";
const ownerId = "user:owner";
const inventoryDigest = `sha256:${"a".repeat(64)}`;

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], { cwd: fixtureDirectory, env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p11-8-fixed-administration", BOOT_KEY: "p11-8-fixed-administration" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; }); child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject).once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

async function submit(page, label) { const navigation = page.waitForNavigation(); await page.getByRole("button", { name: label, exact: true }).click(); return navigation; }
function request(url, path, token, body) { return fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { cookie: `system_session=${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

test("P11.8 serves fixed settings, theme, and operations journeys with current authority", { timeout: 180_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("fixed_administration").withStartupTimeout(120_000).start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let host; let browser;
  try {
    await boot(container.getConnectionUri());
    const authorizationStore = new PostgresAuthorizationStore(pool, { validate: (currentApplicationId, subject) => currentApplicationId === applicationId && subject.kind === "user" && subject.id === ownerId ? "accepted" : "rejected" });
    await bootstrapFirstOwner({ store: authorizationStore, expected: { applicationId, environment, authorizationRevision: 0, lifecycleRevision: 0 }, firstOwner: { kind: "user", id: ownerId } });
    const catalogProvider = createAuthorizationCatalogProvider(({ applicationId: id, lifecycleRevision }) => id === applicationId ? { applicationId, lifecycleRevision, catalog: createEffectiveAuthorizationCatalog({ applicationId, lifecycleRevision, extensions: [], executables: [] }) } : undefined);
    const resolver = new EffectiveAuthorityResolver({ store: authorizationStore, catalogProvider });
    const session = createTrustedAuthorizationSession({ schemaVersion: 1, applicationId, environment, correlationId: "fixed-admin-owner", principal: { kind: "user", id: ownerId }, effectiveActor: { kind: "user", id: ownerId } });
    const authority = new CurrentAuthorityAdapter({ current(context) { return context?.session === "owner" ? session : undefined; } }, resolver);

    await pool.query("insert into k_nex_system_settings_state (application_id, environment, settings_revision) values ($1,$2,0)", [applicationId, environment]);
    const settingsStore = new PostgresSystemSettingsStore(pool);
    const descriptor = { schemaVersion: 1, id: "system.general", publisher: { kind: "platform", namespace: "system" }, descriptorSchemaVersion: 1, validation: "immediate", fields: { siteName: { type: "string", required: true, default: "K-Nex" }, apiToken: { type: "secret-reference", required: false } }, readPermission: "system.settings.read", changePermission: "system.settings.manage" };
    const settings = new SystemSettingsAdministrationService({ authority, state: authorizationStore, store: settingsStore, descriptorSource: { list: async () => [{ descriptor, identity: { applicationId, environment, descriptorId: descriptor.id, descriptorSchemaVersion: 1, owner: { kind: "platform", namespace: "system" } }, lifecycle: "active" }] }, evidence: { verify: async ({ context }) => context?.session === "owner" ? ({ reauthentication: "satisfied", evidenceId: "settings-browser-evidence", verifiedAt: "2026-09-01T23:59:00.000Z", expiresAt: "2026-09-02T00:01:00.000Z" }) : undefined }, secrets: { resolve: async ({ slotAlias }) => slotAlias === "system-primary" ? ({ kind: "secret-reference", provider: "environment", key: "SYSTEM_API_TOKEN" }) : undefined }, metadata: (() => { let id = 0; return { id(kind) { id += 1; return `settings-${kind}-${id}`; }, now() { return new Date("2026-09-02T00:00:00.000Z"); } }; })() });

    const activeProfile = { schemaVersion: 1, id: "profile.admin", surface: "admin", themeId: "theme.default", themeVersion: "1.0.0", palette: "default", mode: "system", values: {}, revision: { id: "profile-revision-1", number: 1, state: "published", createdAt: "2026-09-02T00:00:00.000Z", publishedAt: "2026-09-02T00:00:00.000Z" } };
    let profileSnapshot = { profileId: activeProfile.id, revision: 1, active: activeProfile };
    const profileOperator = { async list() { return [profileSnapshot]; }, async read({ profileId }) { return profileId === activeProfile.id ? profileSnapshot : undefined; }, async preview({ profile }) { return { profileId: profile.id, accessibility: "passed" }; }, async stageDraft({ profile }) { profileSnapshot = { ...profileSnapshot, draft: profile }; return profileSnapshot; }, async publish() { return { operation: "publish" }; }, async rollback() { return { operation: "rollback" }; } };
    const themes = new SystemThemeAdministrationService({ authority, state: authorizationStore, profiles: { resolve(context) { return context?.session === "owner" ? profileOperator : undefined; } }, catalog: { async read() { return { packages: [{ id: "theme.default", version: "1.0.0", displayName: "Default", surfaces: ["admin", "public"], availability: "installed" }], inventory: { extensions: { platformPlugins: {}, hotApplications: {}, themeSkins: {} } }, catalog: [] }; } } });

    const operationsStore = new PostgresSystemOperationsStore(pool, { now: () => new Date("2026-09-02T00:00:00.000Z") });
    await operationsStore.initialize({ applicationId, environment, inventoryDigest });
    const operationsState = { async readState(id, env) { const [authorization, operations] = await Promise.all([authorizationStore.readState(id, env), operationsStore.state(id, env)]); return authorization && operations ? { ...authorization, ...operations } : undefined; } };
    const operations = new SystemOperationsAdministrationService({ authority, state: operationsState, operator: { resolve(context) { return context?.session === "owner" ? operationsStore : undefined; } }, evidence: { verify: async () => ({ reauthentication: "satisfied", approval: "satisfied" }) }, projection: { async read() { const state = await operationsStore.state(applicationId, environment); const receipts = await pool.query("select receipt_json from k_nex_system_operation_receipts order by terminal desc, occurred_at desc"); return { ...state, references: receipts.rows.map((row) => row.receipt_json.reference), health: [{ schemaVersion: 1, observationId: "health-backup-1", applicationId, environment, source: "backup", state: "ready", revision: Math.max(1, state.operationsRevision), checkIds: ["backup.fresh", "restore.clean"], observedAt: "2026-09-02T00:00:00.000Z" }] }; } } });
    await pool.query("insert into k_nex_catalog_mirror_state (application_id, environment) values ($1,$2)", [applicationId, environment]);
    const catalog = new SystemCatalogAdministrationService({ authority,
      state: { async readState(id, env) { const state = await authorizationStore.readState(id, env); return state ? { ...state, catalogRevision: 0 } : undefined; } },
      observation: { async readObservation() { return { schemaVersion: 1, state: "no-accepted-snapshot", catalogRevision: 0 }; } },
      operator: { resolve(context) { return context?.session === "owner" ? { async refresh(input) { return { schemaVersion: 1, receiptId: "catalog-browser-receipt", refreshId: input.refreshId, outcome: "rejected", reason: "fetch-failed", requestedBy: input.requestedBy, authorityDigest: `sha256:${createHash("sha256").update(canonicalJson(input.authorityEnvelope)).digest("hex")}`, idempotencyKey: input.idempotencyKey, occurredAt: "2026-09-02T00:00:00.000Z" }; } } : undefined; } },
      id: () => "catalog-browser-refresh"
    });

    host = await startSystemAdministrationHost({ access: {}, catalog, extensions: {}, settings, themes, operations, context(message) { return /system_session=owner/u.test(message.headers.cookie ?? "") ? { session: "owner" } : undefined; }, sessionKey(context) { return context?.session; }, async expected() { const state = await authorizationStore.readState(applicationId, environment); return { ...state, inventoryRevision: 0, extensionRevision: 0 }; } });
    for (const path of ["/system/settings", "/system/settings/system.general", "/system/themes", "/system/themes/profiles/profile.admin", "/system/operations"]) {
      assert.equal((await request(host.url, path)).status, 403, `${path} denies unauthenticated reads`);
      const response = await request(host.url, path, "owner"); assert.equal(response.status, 200, `${path}: ${await response.text()}`);
    }
    assert.equal((await request(host.url, "/system/settings/system.missing", "owner")).status, 404);
    assert.equal((await request(host.url, "/system/themes/profiles/profile.missing", "owner")).status, 404);
    assert.equal((await request(host.url, "/system/operations/missing-operation", "owner")).status, 404);

    browser = await chromium.launch();
    const context = await browser.newContext(); await context.addCookies([{ name: "system_session", value: "owner", url: host.url }]);
    const page = await context.newPage();
    for (const path of ["/system/settings", "/system/settings/system.general", "/system/themes", "/system/themes/profiles/profile.admin", "/system/operations"]) {
      await page.goto(`${host.url}${path}`); assert.equal(await page.locator("h1").count(), 1); assert.equal(await page.locator("main").count(), 1); assert.equal(await page.locator("a[href='#main-content']").count(), 1);
    }
    await page.goto(`${host.url}/system/settings/system.general`); const saveResponse = await submit(page, "Save settings"); assert.equal(saveResponse?.status(), 200, await saveResponse?.text());
    assert.equal((await request(host.url, "/api/system/settings/system.general/secret", undefined, { action: "bind", field: "apiToken", slotAlias: "system-primary", expectedDocumentRevision: 1, expectedSettingsRevision: 1, idempotencyKey: "settings-secret-bind-1" })).status, 403);
    assert.equal((await request(host.url, "/api/system/settings/system.general/secret", "owner", { action: "bind", field: "apiToken", slotAlias: "system-primary", expectedDocumentRevision: 1, expectedSettingsRevision: 1, idempotencyKey: "settings-secret-bind-1" })).status, 200);
    assert.equal((await request(host.url, "/api/system/settings/system.general/secret", "owner", { action: "unbind", field: "apiToken", expectedDocumentRevision: 2, expectedSettingsRevision: 2, idempotencyKey: "settings-secret-unbind-1" })).status, 200);
    const settingsAudit = await pool.query("select requested_by_id, authority_json, reauthentication from k_nex_system_settings_audit order by created_at");
    assert.equal(settingsAudit.rows.length, 3);
    assert.ok(settingsAudit.rows.every((row) => row.requested_by_id === ownerId && row.authority_json.principal.id === ownerId && row.reauthentication === "satisfied"));
    assert.doesNotMatch(JSON.stringify(settingsAudit.rows), /SYSTEM_API_TOKEN/u, "Audit contains proof metadata, never provider keys.");
    assert.equal((await request(host.url, "/api/system/settings/system.general", "owner", { expectedDocumentRevision: 0, expectedSettingsRevision: 0, idempotencyKey: "settings-stale-1", values: { siteName: "Stale" } })).status, 409);
    await page.goto(`${host.url}/system/themes/profiles/profile.admin`); assert.equal((await submit(page, "Preview profile"))?.status(), 200);
    await page.goto(`${host.url}/system/operations`); assert.equal((await submit(page, "Request backup"))?.status(), 200);
    const catalogResult = await page.evaluate(async () => (await fetch("/api/system/catalog/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: { expectedCatalogRevision: 0, idempotencyKey: "catalog-browser-refresh-1" } }) })).json());
    assert.deepEqual(catalogResult, { schemaVersion: 1, receiptId: "catalog-browser-receipt", refreshId: "catalog-browser-refresh", outcome: "rejected", reason: "fetch-failed", requestedBy: { kind: "user", id: ownerId }, authorityDigest: catalogResult.authorityDigest, idempotencyKey: "catalog-browser-refresh-1", occurredAt: "2026-09-02T00:00:00.000Z" });
    assert.match(catalogResult.authorityDigest, /^sha256:[0-9a-f]{64}$/u);
    await page.goto(`${host.url}/system/operations`); assert.match(await page.locator("body").innerText(), /backup-operation/u);
    const operationHref = await page.locator("a[href^='/system/operations/']").first().getAttribute("href"); assert.ok(operationHref);
    assert.equal((await page.goto(`${host.url}${operationHref}`))?.status(), 200);
    assert.equal((await request(host.url, "/api/system/operations/backup", "owner", { request: { expectedOperationsRevision: 0, idempotencyKey: "forged-backup-1", target: "attacker" } })).status, 400);
    assert.doesNotMatch(await page.content(), /PAYLOAD_SECRET|password|credential|raw operator/u);
    console.log("P11_8_FIXED_ADMINISTRATION_POSTGRES_CHROMIUM_EVIDENCE=PASS");
    await context.close();
  } finally { await browser?.close(); await host?.close(); await pool.end(); await container.stop(); }
});
