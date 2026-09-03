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

function saveExpected(snapshot) {
  return { expectedPageRevision: snapshot.page.revision, expectedAccessRevision: snapshot.access.accessRevision };
}

function pageLockKey(identity) {
  return `${JSON.stringify([identity.applicationId, identity.environment, identity.pageId], null, 2)}\n`;
}

async function waitForAdvisoryWaiters(pool, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query("select count(*)::int as count from pg_locks where locktype='advisory' and not granted");
    if (result.rows[0].count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} workspace-page mutations to contend on the lock.`);
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
    console.log("P12_ATK_09_CHANGED_IDEMPOTENCY_PAYLOAD_POSTGRES_DENIED=PASS");
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
    const saved = await store.saveWorkingCopy(alpha.identity, save, actor, saveExpected(await store.read(alpha.identity)));
    assert.equal(saved.revision, 2);
    assert.deepEqual(await store.saveWorkingCopy(alpha.identity, save, actor, { expectedPageRevision: themedDraft.revision, expectedAccessRevision: 0 }), saved, "accepted autosave replay must survive the newer page revision");
    let snapshot = await store.read(alpha.identity);
    const race = await Promise.allSettled([
      store.saveWorkingCopy(alpha.identity, { ...save, expectedRevision: saved.revision, idempotencyKey: "workspace-save-race-a", document: { ...alpha.document, version: 3 } }, actor, saveExpected(snapshot)),
      store.saveWorkingCopy(alpha.identity, { ...save, expectedRevision: saved.revision, idempotencyKey: "workspace-save-race-b", document: { ...alpha.document, version: 3 } }, actor, saveExpected(snapshot))
    ]);
    assert.deepEqual(race.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    assert.equal(race.find(({ status }) => status === "rejected").reason.code, "REVISION_CONFLICT", "stale tab must receive a conflict");
    console.log("P12_ATK_08_STALE_AUTOSAVE_CAS_POSTGRES_DENIED=PASS");

    snapshot = await store.read(alpha.identity);
    const access = { ...snapshot.access, accessRevision: snapshot.access.accessRevision + 1, assignments: [{ subject: { kind: "user", userId: "private-page-viewer" }, capability: "view" }] };
    const lock = await pool.connect();
    try {
      await lock.query("begin");
      await lock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [pageLockKey(alpha.identity)]);
      const revocation = store.replaceAccess({ access, expectedPageRevision: snapshot.page.revision, expectedAccessRevision: snapshot.access.accessRevision, idempotencyKey: "workspace-access-one", updatedBy: actor });
      await waitForAdvisoryWaiters(pool, 1);
      const staleAutosave = store.saveWorkingCopy(alpha.identity, {
        expectedRevision: snapshot.workingCopy.revision,
        editorSessionId: "editor-session-revoked",
        idempotencyKey: "workspace-save-revoked-race",
        document: { ...snapshot.workingCopy.document, version: snapshot.workingCopy.revision + 1 }
      }, actor, saveExpected(snapshot));
      await waitForAdvisoryWaiters(pool, 2);
      await lock.query("commit");
      await revocation;
      await assert.rejects(staleAutosave, { code: "REVISION_CONFLICT" }, "ACL revocation that wins the page lock must reject the stale autosave");
    } finally {
      await lock.query("rollback").catch(() => {});
      lock.release();
    }
    console.log("P12_ATK_20_REVOKED_AUTOSAVE_POSTGRES_DENIED=PASS");
    snapshot = await store.read(alpha.identity);
    assert.equal(snapshot.access.accessRevision, 1);

    const firstRevisionId = "workspace-publication-one";
    const firstDependencies = { entries: [{ kind: "block", id: "content.text", version: 1, owner: { kind: "platform" } }], digest: digest("a") };
    const firstPage = nextPage(snapshot.page, { state: "published", publishedRevisionId: firstRevisionId, dependencyDigest: firstDependencies.digest });
    const firstRevision = { schemaVersion: 1, revisionId: firstRevisionId, identity: alpha.identity, documentRevision: snapshot.workingCopy.revision, document: snapshot.workingCopy.document, page: firstPage, access: snapshot.access, themeProfile: snapshot.page.themeProfile, dependencies: firstDependencies, publishedBy: actor, publishedAt: instant };
    const firstPointer = { schemaVersion: 1, identity: alpha.identity, pointerRevision: 1, publishedRevisionId: firstRevision.revisionId, publishedDocumentRevision: firstRevision.documentRevision, updatedAt: instant };
    const firstReceipt = { schemaVersion: 1, receiptId: "workspace-receipt-one", operation: "publish", identity: alpha.identity, pointerRevision: 1, publishedRevisionId: firstRevision.revisionId, accessRevision: 1, dependencyDigest: firstRevision.dependencies.digest, requestedBy: actor, authorityDigest: digest("b"), idempotencyKey: "workspace-publish-one", occurredAt: instant };
    for (const revision of [{ ...firstRevision, page: { ...firstRevision.page, title: "forged-title" } }, { ...firstRevision, access: { ...firstRevision.access, assignments: [] } }]) {
      await assert.rejects(store.publish({ page: firstPage, revision, pointer: firstPointer, receipt: firstReceipt }), { code: "REVISION_CONFLICT" }, "publication snapshots must equal locked current metadata and ACL");
    }
    assert.deepEqual(await store.publish({ page: firstPage, revision: firstRevision, pointer: firstPointer, receipt: firstReceipt }), firstReceipt);
    assert.deepEqual(await store.publish({ page: firstPage, revision: firstRevision, pointer: firstPointer, receipt: firstReceipt }), firstReceipt);

    snapshot = await store.read(alpha.identity);
    const replacedMetadata = nextPage(snapshot.page, { title: "private-page-title-replaced", description: "private-page-description-replaced", navigation: { state: "unplaced", reason: "manual" } });
    await store.updateMetadata({ currentRevision: snapshot.page.revision, page: replacedMetadata, idempotencyKey: "workspace-metadata-replaced" });
    snapshot = await store.read(alpha.identity);
    const replacementAccess = { ...snapshot.access, accessRevision: snapshot.access.accessRevision + 1, assignments: [{ subject: { kind: "role", roleId: "private-current-editor" }, capability: "edit" }] };
    await store.replaceAccess({ access: replacementAccess, expectedPageRevision: snapshot.page.revision, expectedAccessRevision: snapshot.access.accessRevision, idempotencyKey: "workspace-access-replaced", updatedBy: actor });
    snapshot = await store.read(alpha.identity);
    const historical = await store.readPublishedRevision(alpha.identity, firstRevision.revisionId);
    assert.deepEqual(historical.page, firstRevision.page, "published metadata must remain reconstructable after replacement");
    assert.deepEqual(historical.access, firstRevision.access, "published ACL must remain reconstructable after replacement");
    assert.deepEqual(snapshot.access, replacementAccess, "current ACL remains separate from published history");
    const secondSave = { expectedRevision: snapshot.workingCopy.revision, editorSessionId: "editor-session-two", idempotencyKey: "workspace-save-two", document: { ...snapshot.workingCopy.document, version: snapshot.workingCopy.revision + 1 } };
    await store.saveWorkingCopy(alpha.identity, secondSave, actor, saveExpected(snapshot));
    snapshot = await store.read(alpha.identity);
    const secondRevisionId = "workspace-publication-two";
    const secondDependencies = { ...firstRevision.dependencies, digest: digest("c") };
    const secondPage = nextPage(snapshot.page, { publishedRevisionId: secondRevisionId, dependencyDigest: secondDependencies.digest });
    const secondRevision = { ...firstRevision, revisionId: secondRevisionId, documentRevision: snapshot.workingCopy.revision, document: snapshot.workingCopy.document, page: secondPage, access: snapshot.access, dependencies: secondDependencies };
    const secondPointer = { ...firstPointer, pointerRevision: 2, publishedRevisionId: secondRevision.revisionId, publishedDocumentRevision: secondRevision.documentRevision, previousPublishedRevisionId: firstRevision.revisionId };
    const secondReceipt = { ...firstReceipt, receiptId: "workspace-receipt-two", pointerRevision: 2, publishedRevisionId: secondRevision.revisionId, previousPublishedRevisionId: firstRevision.revisionId, accessRevision: snapshot.access.accessRevision, dependencyDigest: secondRevision.dependencies.digest, idempotencyKey: "workspace-publish-two" };
    await store.publish({ page: secondPage, revision: secondRevision, pointer: secondPointer, receipt: secondReceipt });

    snapshot = await store.read(alpha.identity);
    const failedRevisionId = "workspace-publication-duplicate-document";
    const failedPage = nextPage(snapshot.page, { publishedRevisionId: failedRevisionId });
    const failedRevision = { ...secondRevision, revisionId: failedRevisionId, page: failedPage };
    const failedPointer = { ...secondPointer, pointerRevision: 3, publishedRevisionId: failedRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId };
    const failedReceipt = { ...secondReceipt, receiptId: "workspace-receipt-failed", pointerRevision: 3, publishedRevisionId: failedRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId, idempotencyKey: "workspace-publish-failed" };
    const beforeFailedMutation = await pool.query("select (select count(*)::int from k_nex_workspace_page_audit where application_id='customer-alpha') audit, (select count(*)::int from k_nex_workspace_page_outbox where application_id='customer-alpha') outbox");
    await assert.rejects(store.publish({ page: failedPage, revision: failedRevision, pointer: failedPointer, receipt: failedReceipt }));
    const afterFailedMutation = await pool.query("select (select count(*)::int from k_nex_workspace_page_audit where application_id='customer-alpha') audit, (select count(*)::int from k_nex_workspace_page_outbox where application_id='customer-alpha') outbox");
    assert.deepEqual(afterFailedMutation.rows[0], beforeFailedMutation.rows[0], "failed transaction cannot leak audit/outbox rows");
    console.log("P12_ATK_18_FAILED_TRANSACTION_AUDIT_OUTBOX_LEAKAGE_POSTGRES_DENIED=PASS");

    snapshot = await store.read(alpha.identity);
    const rollbackPage = nextPage(snapshot.page, { publishedRevisionId: firstRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest });
    const rollbackPointer = { ...secondPointer, pointerRevision: 3, publishedRevisionId: firstRevision.revisionId, publishedDocumentRevision: firstRevision.documentRevision, previousPublishedRevisionId: secondRevision.revisionId };
    const rollbackReceipt = { ...secondReceipt, receiptId: "workspace-receipt-rollback", operation: "rollback", pointerRevision: 3, publishedRevisionId: firstRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest, idempotencyKey: "workspace-rollback-one" };
    await store.rollback({ page: rollbackPage, pointer: rollbackPointer, receipt: rollbackReceipt });
    snapshot = await store.read(alpha.identity);
    assert.deepEqual(snapshot.access, replacementAccess, "rollback must preserve current ACL authority rather than restore the target snapshot");
    const archived = nextPage(snapshot.page, { state: "archived", navigation: { state: "unplaced", reason: "parent-inactive" } });
    await store.updateMetadata({ currentRevision: snapshot.page.revision, page: archived, idempotencyKey: "workspace-archive-one" });

    const persisted = await new PostgresWorkspacePageStore(pool, () => new Date(instant)).read(alpha.identity);
    assert.equal(persisted.page.state, "archived");
    assert.deepEqual(persisted.page.navigation, { state: "unplaced", reason: "parent-inactive" });
    assert.equal(persisted.publication.pointer.publishedRevisionId, firstRevision.revisionId);
    assert.equal(persisted.publication.revision.dependencies.digest, firstRevision.dependencies.digest);
    assert.equal((await new PostgresWorkspacePageStore(pool).read({ ...alpha.identity, applicationId: "customer-gamma" })), undefined);
    console.log("P12_ATK_02_CROSS_CUSTOMER_READ_POSTGRES_DENIED=PASS");

    const unsafe = ["private-board-value", "private-page-title", "private-sales-manager", "private-page-viewer", "private.theme-profile", "private.theme-revision"];
    const metadataRows = await pool.query("select event_json from k_nex_workspace_page_audit union all select event_json from k_nex_workspace_page_outbox");
    for (const row of metadataRows.rows) for (const value of unsafe) assert.equal(JSON.stringify(row.event_json).includes(value), false, "generic metadata must not contain document, ACL, or theme values");
    console.log("P12_ATK_18_AUDIT_OUTBOX_SECRET_LEAKAGE_POSTGRES_DENIED=PASS");
    await assert.rejects(pool.query("update k_nex_workspace_published_revisions set revision_json='{}'::jsonb where application_id='customer-alpha'"), /immutable history/u);
    await assert.rejects(pool.query("delete from k_nex_workspace_publication_receipts where application_id='customer-alpha'"), /immutable history/u);
    console.log("P12_ATK_16_IMMUTABLE_HISTORY_POSTGRES_DENIED=PASS");

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
    console.log("P12_5_WORKSPACE_STORAGE_POSTGRES_EVIDENCE=PASS");
  } finally {
    await restoredPool?.end().catch(() => {});
    await pool.end().catch(() => {});
    await container.stop();
  }
});
