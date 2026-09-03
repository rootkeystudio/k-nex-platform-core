import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { PostgresWorkspaceNavigationStore, PostgresWorkspacePageStore } from "@k-nex/payload-adapter";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const instant = "2026-09-03T08:00:00.000Z";
const actor = { kind: "user", id: "user:owner" };
const digest = (character) => `sha256:${character.repeat(64)}`;

function boot(connectionString) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/boot-once.mjs"], {
      cwd: fixtureDirectory,
      env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", PAYLOAD_SECRET: "p12-workspace-page-storage", BOOT_KEY: "p12-workspace-page-storage" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
}

function values(applicationId = "customer-alpha") {
  const identity = { applicationId, environment: "production", pageId: "workspace.page.sales-board", documentId: "workspace.document.sales-board" };
  const document = { schemaVersion: 1, id: identity.documentId, version: 1, profile: "workspace", regions: { main: [{ id: "secret-title", type: "content.text", version: 1, props: { text: "private-board-value" } }] } };
  const page = { schemaVersion: 1, identity, title: "private-page-title", state: "draft", navigation: { state: "placed", parentNavigationId: "sales.navigation.root", order: 20 }, workingCopyRevision: 1, accessRevision: 0, themeProfile: { profileId: "private.theme-profile", revisionId: "private.theme-revision", surface: "admin" }, revision: 1, createdBy: actor, updatedBy: actor, createdAt: instant, updatedAt: instant };
  const access = { schemaVersion: 1, identity, accessRevision: 0, assignments: [{ subject: { kind: "role", roleId: "private-sales-manager" }, capability: "edit" }] };
  const workingCopy = { schemaVersion: 1, identity, revision: 1, document, editorSessionId: "editor-session-one", idempotencyKey: "workspace-create-one", updatedBy: actor, updatedAt: instant };
  return { identity, document, page, access, workingCopy };
}

function nextPage(page, changes) {
  return { ...page, ...changes, revision: page.revision + 1, updatedBy: actor, updatedAt: instant };
}

test("P12.5 stores workspace pages, ACL, CAS copies, immutable publications, rollback, and physical restore", { timeout: 240_000 }, async () => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("workspace_pages").withStartupTimeout(120_000).start();
  let pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  let restoredPool;
  try {
    await boot(container.getConnectionUri());
    const store = new PostgresWorkspacePageStore(pool, () => new Date(instant));
    const navigationStore = new PostgresWorkspaceNavigationStore(pool, () => new Date(instant));
    const alpha = values();
    const beta = values("customer-beta");

    assert.deepEqual(await store.create({ page: alpha.page, access: alpha.access, workingCopy: alpha.workingCopy, idempotencyKey: "workspace-create-one" }), alpha.page);
    assert.deepEqual(await store.create({ page: alpha.page, access: alpha.access, workingCopy: alpha.workingCopy, idempotencyKey: "workspace-create-one" }), alpha.page, "response-loss replay must return the first result");
    await assert.rejects(store.create({ page: { ...alpha.page, title: "different" }, access: alpha.access, workingCopy: alpha.workingCopy, idempotencyKey: "workspace-create-one" }), { code: "IDEMPOTENCY_CONFLICT" });
    await store.create({ page: beta.page, access: beta.access, workingCopy: beta.workingCopy, idempotencyKey: "workspace-create-beta" });
    assert.equal((await store.list({ applicationId: "customer-alpha", environment: "production" })).length, 1);
    assert.equal((await store.list({ applicationId: "customer-beta", environment: "production" })).length, 1);
    const themedDraft = nextPage(alpha.page, { title: "private-page-title-themed" });
    assert.equal((await store.updateMetadata({ currentRevision: alpha.page.revision, page: themedDraft, idempotencyKey: "workspace-theme-draft" })).title, themedDraft.title);

    const folder = { id: "customer.folder.reports", owner: { kind: "customer" }, kind: "folder", parentId: "sales.navigation.root", label: "Reports", icon: "folder", order: 20 };
    assert.deepEqual(await navigationStore.create({ applicationId: "customer-alpha", environment: "production" }, folder, actor), { node: folder, revision: 1 });
    assert.deepEqual(await navigationStore.update({ applicationId: "customer-alpha", environment: "production" }, { ...folder, order: 30 }, 1, actor), { node: { ...folder, order: 30 }, revision: 2 });
    await assert.rejects(navigationStore.update({ applicationId: "customer-alpha", environment: "production" }, { ...folder, order: 40 }, 1, actor), { code: "REVISION_CONFLICT" });
    assert.equal((await navigationStore.list({ applicationId: "customer-beta", environment: "production" })).length, 0);

    const save = { expectedRevision: 1, editorSessionId: "editor-session-one", idempotencyKey: "workspace-save-one", document: { ...alpha.document, version: 2 } };
    const saved = await store.saveWorkingCopy(alpha.identity, save, actor);
    assert.equal(saved.revision, 2);
    assert.deepEqual(await store.saveWorkingCopy(alpha.identity, save, actor), saved, "accepted autosave replay must survive the newer page revision");
    const race = await Promise.allSettled([
      store.saveWorkingCopy(alpha.identity, { ...save, expectedRevision: saved.revision, idempotencyKey: "workspace-save-race-a", document: { ...alpha.document, version: 3 } }, actor),
      store.saveWorkingCopy(alpha.identity, { ...save, expectedRevision: saved.revision, idempotencyKey: "workspace-save-race-b", document: { ...alpha.document, version: 3 } }, actor)
    ]);
    assert.deepEqual(race.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    assert.equal(race.find(({ status }) => status === "rejected").reason.code, "REVISION_CONFLICT", "stale tab must receive a conflict");

    let snapshot = await store.read(alpha.identity);
    assert.ok(snapshot);
    const access = { ...snapshot.access, accessRevision: 1, assignments: [{ subject: { kind: "user", userId: "private-page-viewer" }, capability: "view" }] };
    await store.replaceAccess({ access, expectedPageRevision: snapshot.page.revision, expectedAccessRevision: 0, idempotencyKey: "workspace-access-one", updatedBy: actor });
    snapshot = await store.read(alpha.identity);
    assert.equal(snapshot.access.accessRevision, 1);

    const firstRevision = { schemaVersion: 1, revisionId: "workspace-publication-one", identity: alpha.identity, documentRevision: snapshot.workingCopy.revision, document: snapshot.workingCopy.document, accessRevision: 1, themeProfile: snapshot.page.themeProfile, dependencies: { entries: [{ kind: "block", id: "content.text", version: 1, owner: { kind: "platform" } }], digest: digest("a") }, publishedBy: actor, publishedAt: instant };
    const firstPage = nextPage(snapshot.page, { state: "published", publishedRevisionId: firstRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest });
    const firstPointer = { schemaVersion: 1, identity: alpha.identity, pointerRevision: 1, publishedRevisionId: firstRevision.revisionId, publishedDocumentRevision: firstRevision.documentRevision, updatedAt: instant };
    const firstReceipt = { schemaVersion: 1, receiptId: "workspace-receipt-one", operation: "publish", identity: alpha.identity, pointerRevision: 1, publishedRevisionId: firstRevision.revisionId, accessRevision: 1, dependencyDigest: firstRevision.dependencies.digest, requestedBy: actor, authorityDigest: digest("b"), idempotencyKey: "workspace-publish-one", occurredAt: instant };
    assert.deepEqual(await store.publish({ page: firstPage, revision: firstRevision, pointer: firstPointer, receipt: firstReceipt }), firstReceipt);
    assert.deepEqual(await store.publish({ page: firstPage, revision: firstRevision, pointer: firstPointer, receipt: firstReceipt }), firstReceipt);

    snapshot = await store.read(alpha.identity);
    const secondSave = { expectedRevision: snapshot.workingCopy.revision, editorSessionId: "editor-session-two", idempotencyKey: "workspace-save-two", document: { ...snapshot.workingCopy.document, version: snapshot.workingCopy.revision + 1 } };
    await store.saveWorkingCopy(alpha.identity, secondSave, actor);
    snapshot = await store.read(alpha.identity);
    const secondRevision = { ...firstRevision, revisionId: "workspace-publication-two", documentRevision: snapshot.workingCopy.revision, document: snapshot.workingCopy.document, dependencies: { ...firstRevision.dependencies, digest: digest("c") } };
    const secondPage = nextPage(snapshot.page, { publishedRevisionId: secondRevision.revisionId, dependencyDigest: secondRevision.dependencies.digest });
    const secondPointer = { ...firstPointer, pointerRevision: 2, publishedRevisionId: secondRevision.revisionId, publishedDocumentRevision: secondRevision.documentRevision, previousPublishedRevisionId: firstRevision.revisionId };
    const secondReceipt = { ...firstReceipt, receiptId: "workspace-receipt-two", pointerRevision: 2, publishedRevisionId: secondRevision.revisionId, previousPublishedRevisionId: firstRevision.revisionId, dependencyDigest: secondRevision.dependencies.digest, idempotencyKey: "workspace-publish-two" };
    await store.publish({ page: secondPage, revision: secondRevision, pointer: secondPointer, receipt: secondReceipt });

    snapshot = await store.read(alpha.identity);
    const failedRevision = { ...secondRevision, revisionId: "workspace-publication-duplicate-document" };
    const failedPage = nextPage(snapshot.page, { publishedRevisionId: failedRevision.revisionId });
    const failedPointer = { ...secondPointer, pointerRevision: 3, publishedRevisionId: failedRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId };
    const failedReceipt = { ...secondReceipt, receiptId: "workspace-receipt-failed", pointerRevision: 3, publishedRevisionId: failedRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId, idempotencyKey: "workspace-publish-failed" };
    const beforeFailedMutation = await pool.query("select (select count(*)::int from k_nex_workspace_page_audit where application_id='customer-alpha') audit, (select count(*)::int from k_nex_workspace_page_outbox where application_id='customer-alpha') outbox");
    await assert.rejects(store.publish({ page: failedPage, revision: failedRevision, pointer: failedPointer, receipt: failedReceipt }));
    const afterFailedMutation = await pool.query("select (select count(*)::int from k_nex_workspace_page_audit where application_id='customer-alpha') audit, (select count(*)::int from k_nex_workspace_page_outbox where application_id='customer-alpha') outbox");
    assert.deepEqual(afterFailedMutation.rows[0], beforeFailedMutation.rows[0], "failed transaction cannot leak audit/outbox rows");

    snapshot = await store.read(alpha.identity);
    const rollbackPage = nextPage(snapshot.page, { publishedRevisionId: firstRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest });
    const rollbackPointer = { ...secondPointer, pointerRevision: 3, publishedRevisionId: firstRevision.revisionId, publishedDocumentRevision: firstRevision.documentRevision, previousPublishedRevisionId: secondRevision.revisionId };
    const rollbackReceipt = { ...secondReceipt, receiptId: "workspace-receipt-rollback", operation: "rollback", pointerRevision: 3, publishedRevisionId: firstRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest, idempotencyKey: "workspace-rollback-one" };
    await store.rollback({ page: rollbackPage, pointer: rollbackPointer, receipt: rollbackReceipt });
    snapshot = await store.read(alpha.identity);
    const archived = nextPage(snapshot.page, { state: "archived", navigation: { state: "unplaced", reason: "parent-inactive" } });
    await store.updateMetadata({ currentRevision: snapshot.page.revision, page: archived, idempotencyKey: "workspace-archive-one" });

    const persisted = await new PostgresWorkspacePageStore(pool, () => new Date(instant)).read(alpha.identity);
    assert.equal(persisted.page.state, "archived");
    assert.deepEqual(persisted.page.navigation, { state: "unplaced", reason: "parent-inactive" });
    assert.equal(persisted.publication.pointer.publishedRevisionId, firstRevision.revisionId);
    assert.equal(persisted.publication.revision.dependencies.digest, firstRevision.dependencies.digest);
    assert.equal((await new PostgresWorkspacePageStore(pool).read({ ...alpha.identity, applicationId: "customer-gamma" })), undefined);

    const unsafe = ["private-board-value", "private-page-title", "private-sales-manager", "private-page-viewer", "private.theme-profile", "private.theme-revision"];
    const metadataRows = await pool.query("select event_json from k_nex_workspace_page_audit union all select event_json from k_nex_workspace_page_outbox");
    for (const row of metadataRows.rows) for (const value of unsafe) assert.equal(JSON.stringify(row.event_json).includes(value), false, "generic metadata must not contain document, ACL, or theme values");
    await assert.rejects(pool.query("update k_nex_workspace_published_revisions set revision_json='{}'::jsonb where application_id='customer-alpha'"), /immutable history/u);
    await assert.rejects(pool.query("delete from k_nex_workspace_publication_receipts where application_id='customer-alpha'"), /immutable history/u);

    const user = container.getUsername();
    const sourceDatabase = container.getDatabase();
    assert.equal((await container.exec(["pg_dump", "-U", user, "-Fc", "-f", "/tmp/workspace-pages.backup", sourceDatabase])).exitCode, 0);
    assert.equal((await container.exec(["createdb", "-U", user, "workspace_pages_restore"])).exitCode, 0);
    assert.equal((await container.exec(["pg_restore", "-U", user, "-d", "workspace_pages_restore", "--exit-on-error", "/tmp/workspace-pages.backup"])).exitCode, 0);
    const restoredUrl = new URL(container.getConnectionUri());
    restoredUrl.pathname = "/workspace_pages_restore";
    restoredPool = new pg.Pool({ connectionString: restoredUrl.toString() });
    const restored = await new PostgresWorkspacePageStore(restoredPool).read(alpha.identity);
    assert.deepEqual(restored, persisted, "physical restore must preserve working copy, ACL, theme, pointer, dependency snapshot, and archive state");
    assert.deepEqual(await new PostgresWorkspaceNavigationStore(restoredPool).list({ applicationId: "customer-alpha", environment: "production" }), [{ node: { ...folder, order: 30 }, revision: 2 }], "physical restore must preserve customer folders and order");
  } finally {
    await restoredPool?.end().catch(() => {});
    await pool.end().catch(() => {});
    await container.stop();
  }
});
