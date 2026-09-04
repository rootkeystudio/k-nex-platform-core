import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { issueWorkspacePageMutationFence, PostgresWorkspaceNavigationStore, PostgresWorkspacePageStore } from "@k-nex/payload-adapter";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixtureDirectory = fileURLToPath(new URL("..", import.meta.url));
const instant = "2026-09-03T08:00:00.000Z";
const actor = { kind: "user", id: "user:owner" };
const digest = (character) => `sha256:${character.repeat(64)}`;

function mutationFence(identity, authorizationRevision = 1, lifecycleRevision = 1, extensionGeneration = 1, themeRevision = 1, themeActiveRevisionId = "private.theme-revision", themeStateDigest = digest("d")) {
  return issueWorkspacePageMutationFence({
    applicationId: identity.applicationId,
    environment: identity.environment,
    authorizationRevision,
    lifecycleRevision,
    catalogRevision: lifecycleRevision,
    catalogDigest: digest("e"),
    extensionGenerations: [{ applicationId: identity.applicationId, deliveryClass: "platform-plugin", extensionId: "module.sales", authorizationGeneration: extensionGeneration }],
    themePublication: { applicationId: identity.applicationId, environment: identity.environment, profileId: "private.theme-profile", activeRevisionId: themeActiveRevisionId, revision: themeRevision, stateDigest: themeStateDigest },
    authorityDigest: digest("f")
  });
}

function navigationMutationFence(identity, authorizationRevision = 1, lifecycleRevision = 1) {
  return {
    applicationId: identity.applicationId,
    environment: identity.environment,
    authorizationRevision,
    lifecycleRevision
  };
}

const navigationCatalog = {
  staticNodes: [
    { id: "system.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "System", icon: "system", order: 1_000_000 },
    { id: "system.navigation.workspace-pages", owner: { kind: "platform" }, kind: "link", parentId: "system.navigation.root", label: "Workspace pages", icon: "dashboard", order: 45, target: { class: "system", routeId: "system.route.workspace-pages" } },
    { id: "sales.navigation.root", owner: { kind: "platform-plugin", pluginId: "module.sales" }, kind: "folder", label: "Sales", icon: "sales", order: 100 }
  ],
  staticParentIds: ["sales.navigation.root"]
};

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

async function mutationCounts(pool, applicationId) {
  const names = ["pages", "access", "working", "published", "pointers", "receipts", "audit", "outbox", "operations"];
  const tables = ["k_nex_workspace_pages", "k_nex_workspace_page_access", "k_nex_workspace_working_copies", "k_nex_workspace_published_revisions", "k_nex_workspace_publication_pointers", "k_nex_workspace_publication_receipts", "k_nex_workspace_page_audit", "k_nex_workspace_page_outbox", "k_nex_workspace_page_operations"];
  const result = {};
  for (let index = 0; index < tables.length; index += 1) result[names[index]] = (await pool.query(`select count(*)::int as count from ${tables[index]} where application_id=$1`, [applicationId])).rows[0].count;
  return result;
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
    await pool.query("insert into k_nex_authorization_state (application_id, authorization_revision, lifecycle_revision) values ($1,1,1),($2,1,1)", [alpha.identity.applicationId, beta.identity.applicationId]);
    for (const current of [alpha, beta]) {
      await pool.query(
        "insert into k_nex_extension_authorization_generations (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision) values ($1,'platform-plugin','module.sales',1,'[]'::jsonb,'current',1,1)",
        [current.identity.applicationId]
      );
      await pool.query(
        "insert into runtime_theme_profile_publications (application_id, environment, profile_id, revision, active_revision_id, active_profile, state_digest) values ($1,$2,'private.theme-profile',1,'private.theme-revision','{}'::jsonb,$3)",
        [current.identity.applicationId, current.identity.environment, digest("d")]
      );
    }
    let alphaFence = mutationFence(alpha.identity);
    const betaFence = mutationFence(beta.identity);
    const alphaNavigationFence = navigationMutationFence(alpha.identity);

    assert.deepEqual(await store.create({ page: alpha.page, access: alpha.access, workingCopy: alpha.workingCopy, idempotencyKey: "workspace-create-one", fence: alphaFence }), alpha.page);
    assert.deepEqual(await store.create({ page: alpha.page, access: alpha.access, workingCopy: alpha.workingCopy, idempotencyKey: "workspace-create-one", fence: alphaFence }), alpha.page, "response-loss replay must return the first result");
    await assert.rejects(store.create({ page: { ...alpha.page, title: "different" }, access: alpha.access, workingCopy: alpha.workingCopy, idempotencyKey: "workspace-create-one", fence: alphaFence }), { code: "IDEMPOTENCY_CONFLICT" });
    console.log("P12_ATK_09_CHANGED_IDEMPOTENCY_PAYLOAD_POSTGRES_DENIED=PASS");
    await store.create({ page: beta.page, access: beta.access, workingCopy: beta.workingCopy, idempotencyKey: "workspace-create-beta", fence: betaFence });
    assert.equal((await store.list({ applicationId: "customer-alpha", environment: "production" })).length, 1);
    assert.equal((await store.list({ applicationId: "customer-beta", environment: "production" })).length, 1);
    const themedDraft = nextPage(alpha.page, { title: "private-page-title-themed" });
    assert.equal((await store.updateMetadata({ currentRevision: alpha.page.revision, page: themedDraft, idempotencyKey: "workspace-theme-draft", fence: alphaFence })).title, themedDraft.title);

    const folder = { id: "customer.folder.reports", owner: { kind: "customer" }, kind: "folder", parentId: "sales.navigation.root", label: "Reports", icon: "folder", order: 20 };
    assert.deepEqual(await navigationStore.create({ applicationId: "customer-alpha", environment: "production" }, folder, actor, alphaNavigationFence, navigationCatalog), { node: folder, revision: 1 });
    assert.deepEqual(await navigationStore.update({ applicationId: "customer-alpha", environment: "production" }, { ...folder, order: 30 }, 1, actor, alphaNavigationFence, navigationCatalog), { node: { ...folder, order: 30 }, revision: 2 });
    await assert.rejects(navigationStore.update({ applicationId: "customer-alpha", environment: "production" }, { ...folder, order: 40 }, 1, actor, alphaNavigationFence, navigationCatalog), { code: "REVISION_CONFLICT" });
    assert.equal((await navigationStore.list({ applicationId: "customer-beta", environment: "production" })).length, 0);

    const save = { expectedRevision: 1, editorSessionId: "editor-session-one", idempotencyKey: "workspace-save-one", document: { ...alpha.document, version: 2 } };
    const saved = await store.saveWorkingCopy(alpha.identity, save, actor, saveExpected(await store.read(alpha.identity)), alphaFence);
    assert.equal(saved.revision, 2);
    assert.deepEqual(await store.saveWorkingCopy(alpha.identity, save, actor, { expectedPageRevision: themedDraft.revision, expectedAccessRevision: 0 }, alphaFence), saved, "accepted autosave replay must survive the newer page revision");
    let snapshot = await store.read(alpha.identity);
    const race = await Promise.allSettled([
      store.saveWorkingCopy(alpha.identity, { ...save, expectedRevision: saved.revision, idempotencyKey: "workspace-save-race-a", document: { ...alpha.document, version: 3 } }, actor, saveExpected(snapshot), alphaFence),
      store.saveWorkingCopy(alpha.identity, { ...save, expectedRevision: saved.revision, idempotencyKey: "workspace-save-race-b", document: { ...alpha.document, version: 3 } }, actor, saveExpected(snapshot), alphaFence)
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
      const revocation = store.replaceAccess({ access, expectedPageRevision: snapshot.page.revision, expectedAccessRevision: snapshot.access.accessRevision, idempotencyKey: "workspace-access-one", updatedBy: actor, fence: alphaFence });
      await waitForAdvisoryWaiters(pool, 1);
      const staleAutosave = store.saveWorkingCopy(alpha.identity, {
        expectedRevision: snapshot.workingCopy.revision,
        editorSessionId: "editor-session-revoked",
        idempotencyKey: "workspace-save-revoked-race",
        document: { ...snapshot.workingCopy.document, version: snapshot.workingCopy.revision + 1 }
      }, actor, saveExpected(snapshot), alphaFence);
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
      await assert.rejects(store.publish({ page: firstPage, revision, pointer: firstPointer, receipt: firstReceipt, fence: alphaFence }), { code: "REVISION_CONFLICT" }, "publication snapshots must equal locked current metadata and ACL");
    }
    assert.deepEqual(await store.publish({ page: firstPage, revision: firstRevision, pointer: firstPointer, receipt: firstReceipt, fence: alphaFence }), firstReceipt);
    assert.deepEqual(await store.publish({ page: firstPage, revision: firstRevision, pointer: firstPointer, receipt: firstReceipt, fence: alphaFence }), firstReceipt);

    snapshot = await store.read(alpha.identity);
    const replacedMetadata = nextPage(snapshot.page, { title: "private-page-title-replaced", description: "private-page-description-replaced", navigation: { state: "unplaced", reason: "manual" } });
    await store.updateMetadata({ currentRevision: snapshot.page.revision, page: replacedMetadata, idempotencyKey: "workspace-metadata-replaced", fence: alphaFence });
    snapshot = await store.read(alpha.identity);
    const replacementAccess = { ...snapshot.access, accessRevision: snapshot.access.accessRevision + 1, assignments: [{ subject: { kind: "role", roleId: "private-current-editor" }, capability: "edit" }] };
    await store.replaceAccess({ access: replacementAccess, expectedPageRevision: snapshot.page.revision, expectedAccessRevision: snapshot.access.accessRevision, idempotencyKey: "workspace-access-replaced", updatedBy: actor, fence: alphaFence });
    snapshot = await store.read(alpha.identity);
    const historical = await store.readPublishedRevision(alpha.identity, firstRevision.revisionId);
    assert.deepEqual(historical.page, firstRevision.page, "published metadata must remain reconstructable after replacement");
    assert.deepEqual(historical.access, firstRevision.access, "published ACL must remain reconstructable after replacement");
    assert.deepEqual(snapshot.access, replacementAccess, "current ACL remains separate from published history");
    const secondSave = { expectedRevision: snapshot.workingCopy.revision, editorSessionId: "editor-session-two", idempotencyKey: "workspace-save-two", document: { ...snapshot.workingCopy.document, version: snapshot.workingCopy.revision + 1 } };
    await store.saveWorkingCopy(alpha.identity, secondSave, actor, saveExpected(snapshot), alphaFence);
    snapshot = await store.read(alpha.identity);
    const secondRevisionId = "workspace-publication-two";
    const secondDependencies = { ...firstRevision.dependencies, digest: digest("c") };
    const secondPage = nextPage(snapshot.page, { publishedRevisionId: secondRevisionId, dependencyDigest: secondDependencies.digest });
    const secondRevision = { ...firstRevision, revisionId: secondRevisionId, documentRevision: snapshot.workingCopy.revision, document: snapshot.workingCopy.document, page: secondPage, access: snapshot.access, dependencies: secondDependencies };
    const secondPointer = { ...firstPointer, pointerRevision: 2, publishedRevisionId: secondRevision.revisionId, publishedDocumentRevision: secondRevision.documentRevision, previousPublishedRevisionId: firstRevision.revisionId };
    const secondReceipt = { ...firstReceipt, receiptId: "workspace-receipt-two", pointerRevision: 2, publishedRevisionId: secondRevision.revisionId, previousPublishedRevisionId: firstRevision.revisionId, accessRevision: snapshot.access.accessRevision, dependencyDigest: secondRevision.dependencies.digest, idempotencyKey: "workspace-publish-two" };
    await store.publish({ page: secondPage, revision: secondRevision, pointer: secondPointer, receipt: secondReceipt, fence: alphaFence });

    snapshot = await store.read(alpha.identity);
    const failedRevisionId = "workspace-publication-duplicate-document";
    const failedPage = nextPage(snapshot.page, { publishedRevisionId: failedRevisionId });
    const failedRevision = { ...secondRevision, revisionId: failedRevisionId, page: failedPage };
    const failedPointer = { ...secondPointer, pointerRevision: 3, publishedRevisionId: failedRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId };
    const failedReceipt = { ...secondReceipt, receiptId: "workspace-receipt-failed", pointerRevision: 3, publishedRevisionId: failedRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId, idempotencyKey: "workspace-publish-failed" };
    const beforeFailedMutation = await pool.query("select (select count(*)::int from k_nex_workspace_page_audit where application_id='customer-alpha') audit, (select count(*)::int from k_nex_workspace_page_outbox where application_id='customer-alpha') outbox");
    await assert.rejects(store.publish({ page: failedPage, revision: failedRevision, pointer: failedPointer, receipt: failedReceipt, fence: alphaFence }));
    const afterFailedMutation = await pool.query("select (select count(*)::int from k_nex_workspace_page_audit where application_id='customer-alpha') audit, (select count(*)::int from k_nex_workspace_page_outbox where application_id='customer-alpha') outbox");
    assert.deepEqual(afterFailedMutation.rows[0], beforeFailedMutation.rows[0], "failed transaction cannot leak audit/outbox rows");
    console.log("P12_ATK_18_FAILED_TRANSACTION_AUDIT_OUTBOX_LEAKAGE_POSTGRES_DENIED=PASS");

    snapshot = await store.read(alpha.identity);
    const rollbackPage = nextPage(snapshot.page, { publishedRevisionId: firstRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest });
    const rollbackPointer = { ...secondPointer, pointerRevision: 3, publishedRevisionId: firstRevision.revisionId, publishedDocumentRevision: firstRevision.documentRevision, previousPublishedRevisionId: secondRevision.revisionId };
    const rollbackReceipt = { ...secondReceipt, receiptId: "workspace-receipt-rollback", operation: "rollback", pointerRevision: 3, publishedRevisionId: firstRevision.revisionId, previousPublishedRevisionId: secondRevision.revisionId, dependencyDigest: firstRevision.dependencies.digest, idempotencyKey: "workspace-rollback-one" };
    await store.rollback({ page: rollbackPage, pointer: rollbackPointer, receipt: rollbackReceipt, fence: alphaFence });
    snapshot = await store.read(alpha.identity);
    assert.deepEqual(snapshot.access, replacementAccess, "rollback must preserve current ACL authority rather than restore the target snapshot");

    const beforeAuthorityDenials = await mutationCounts(pool, alpha.identity.applicationId);
    const beforeAuthoritySnapshot = snapshot;
    const pageLock = await pool.connect();
    try {
      await pageLock.query("begin");
      await pageLock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [pageLockKey(alpha.identity)]);
      const staleReplay = store.rollback({ page: rollbackPage, pointer: rollbackPointer, receipt: rollbackReceipt, fence: alphaFence });
      await waitForAdvisoryWaiters(pool, 1);
      await pool.query("update k_nex_authorization_state set authorization_revision=2 where application_id=$1", [alpha.identity.applicationId]);
      await pageLock.query("commit");
      await assert.rejects(staleReplay, { code: "AUTHORITY_CONFLICT" }, "revocation must deny even an already accepted idempotency replay");
    } finally {
      await pageLock.query("rollback").catch(() => {});
      pageLock.release();
    }
    alphaFence = mutationFence(alpha.identity, 2, 1);
    const lifecycleLock = await pool.connect();
    try {
      await lifecycleLock.query("begin");
      await lifecycleLock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [pageLockKey(alpha.identity)]);
      const deniedPage = nextPage(snapshot.page, { title: "must-not-commit" });
      const staleLifecycleMutation = store.updateMetadata({ currentRevision: snapshot.page.revision, page: deniedPage, idempotencyKey: "workspace-lifecycle-stale", fence: alphaFence });
      await waitForAdvisoryWaiters(pool, 1);
      await pool.query("update k_nex_authorization_state set lifecycle_revision=2 where application_id=$1", [alpha.identity.applicationId]);
      await lifecycleLock.query("commit");
      await assert.rejects(staleLifecycleMutation, { code: "AUTHORITY_CONFLICT" });
    } finally {
      await lifecycleLock.query("rollback").catch(() => {});
      lifecycleLock.release();
    }
    assert.deepEqual(await mutationCounts(pool, alpha.identity.applicationId), beforeAuthorityDenials, "stale authority must write no page, ACL, working-copy, publication, audit, outbox, or operation state");
    assert.deepEqual(await store.read(alpha.identity), beforeAuthoritySnapshot);

    alphaFence = mutationFence(alpha.identity, 2, 2);
    let reachedAuthorityLock;
    let releaseMutation;
    const authorityLocked = new Promise((resolve) => { reachedAuthorityLock = resolve; });
    const mutationReleased = new Promise((resolve) => { releaseMutation = resolve; });
    const barrierPool = {
      query: (...args) => pool.query(...args),
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (text, parameters) => {
            const result = await client.query(text, parameters);
            if (String(text).includes("from k_nex_authorization_state") && String(text).includes("for share")) {
              reachedAuthorityLock();
              await mutationReleased;
            }
            return result;
          },
          release: () => client.release()
        };
      }
    };
    const serialStore = new PostgresWorkspacePageStore(barrierPool, () => new Date(instant));
    const serializedPage = nextPage(snapshot.page, { title: "mutation-wins-before-revocation" });
    const mutationWins = serialStore.updateMetadata({ currentRevision: snapshot.page.revision, page: serializedPage, idempotencyKey: "workspace-mutation-wins", fence: alphaFence });
    await authorityLocked;
    const writer = pool.query("update k_nex_authorization_state set authorization_revision=3 where application_id=$1", [alpha.identity.applicationId]);
    releaseMutation();
    assert.deepEqual(await mutationWins, serializedPage);
    await writer;
    snapshot = await store.read(alpha.identity);
    assert.equal(snapshot.page.title, "mutation-wins-before-revocation", "mutation holding the authority row lock must commit before the writer advances authority");
    console.log("P12_WORKSPACE_MUTATION_AUTHORITY_FENCE_POSTGRES=PASS");

    alphaFence = mutationFence(alpha.identity, 3, 2);
    const beforeDependencyDenials = await mutationCounts(pool, alpha.identity.applicationId);
    const beforeDependencySnapshot = snapshot;
    const themeLock = await pool.connect();
    try {
      await themeLock.query("begin");
      await themeLock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [pageLockKey(alpha.identity)]);
      const staleThemeReplay = store.rollback({ page: rollbackPage, pointer: rollbackPointer, receipt: rollbackReceipt, fence: alphaFence });
      await waitForAdvisoryWaiters(pool, 1);
      await pool.query("update runtime_theme_profile_publications set revision=2, active_revision_id='private.theme-revision-next', state_digest=$2 where application_id=$1 and profile_id='private.theme-profile'", [alpha.identity.applicationId, digest("c")]);
      await themeLock.query("commit");
      await assert.rejects(staleThemeReplay, { code: "AUTHORITY_CONFLICT" }, "Theme Profile publication changes must deny an accepted idempotency replay");
    } finally {
      await themeLock.query("rollback").catch(() => {});
      themeLock.release();
    }
    await pool.query("update runtime_theme_profile_publications set revision=3, active_revision_id='private.theme-revision', state_digest=$2 where application_id=$1 and profile_id='private.theme-profile'", [alpha.identity.applicationId, digest("d")]);
    alphaFence = mutationFence(alpha.identity, 3, 2, 1, 3);
    const extensionLock = await pool.connect();
    try {
      await extensionLock.query("begin");
      await extensionLock.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [pageLockKey(alpha.identity)]);
      const deniedPage = nextPage(snapshot.page, { title: "stale-plugin-generation" });
      const staleExtensionMutation = store.updateMetadata({ currentRevision: snapshot.page.revision, page: deniedPage, idempotencyKey: "workspace-extension-stale", fence: alphaFence });
      await waitForAdvisoryWaiters(pool, 1);
      await pool.query("update k_nex_extension_authorization_generations set state='retired' where application_id=$1 and delivery_class='platform-plugin' and extension_id='module.sales' and authorization_generation=1", [alpha.identity.applicationId]);
      await pool.query("insert into k_nex_extension_authorization_generations (application_id, delivery_class, extension_id, authorization_generation, runtime_generation_ids, state, authorization_revision, lifecycle_revision) values ($1,'platform-plugin','module.sales',2,'[]'::jsonb,'current',3,2)", [alpha.identity.applicationId]);
      await extensionLock.query("commit");
      await assert.rejects(staleExtensionMutation, { code: "AUTHORITY_CONFLICT" });
    } finally {
      await extensionLock.query("rollback").catch(() => {});
      extensionLock.release();
    }
    assert.deepEqual(await mutationCounts(pool, alpha.identity.applicationId), beforeDependencyDenials, "stale dependency observations must write no page, ACL, working-copy, publication, receipt, audit, outbox, or operation state");
    assert.deepEqual(await store.read(alpha.identity), beforeDependencySnapshot);
    for (const [idempotencyKey, fence] of [
      ["workspace-extension-missing", mutationFence(alpha.identity, 3, 2, 99, 3)],
      ["workspace-extension-retired", mutationFence(alpha.identity, 3, 2, 1, 3)],
      ["workspace-theme-active-wrong", mutationFence(alpha.identity, 3, 2, 2, 3, "private.theme-revision-wrong")],
      ["workspace-theme-digest-wrong", mutationFence(alpha.identity, 3, 2, 2, 3, "private.theme-revision", digest("c"))]
    ]) {
      await assert.rejects(store.updateMetadata({ currentRevision: snapshot.page.revision, page: nextPage(snapshot.page, { title: idempotencyKey }), idempotencyKey, fence }), { code: "AUTHORITY_CONFLICT" });
    }
    assert.deepEqual(await mutationCounts(pool, alpha.identity.applicationId), beforeDependencyDenials, "missing, retired, or mismatched dependency rows must write nothing");
    assert.deepEqual(await store.read(alpha.identity), beforeDependencySnapshot);
    console.log("P12_WORKSPACE_THEME_PLUGIN_DEPENDENCY_FENCE_POSTGRES=PASS");

    alphaFence = mutationFence(alpha.identity, 3, 2, 2, 3);
    const beforeForgedFence = await mutationCounts(pool, alpha.identity.applicationId);
    const forgedPage = nextPage(snapshot.page, { title: "browser-forged-fence" });
    await assert.rejects(store.updateMetadata({
      currentRevision: snapshot.page.revision,
      page: forgedPage,
      idempotencyKey: "workspace-browser-forged-fence",
      fence: JSON.parse(JSON.stringify(alphaFence))
    }), { code: "INVALID_INPUT" });
    assert.deepEqual(await mutationCounts(pool, alpha.identity.applicationId), beforeForgedFence, "serialized browser input cannot forge the service mutation capability");
    assert.deepEqual(await store.read(alpha.identity), snapshot);
    const archived = nextPage(snapshot.page, { state: "archived", navigation: { state: "unplaced", reason: "parent-inactive" } });
    await store.updateMetadata({ currentRevision: snapshot.page.revision, page: archived, idempotencyKey: "workspace-archive-one", fence: alphaFence });

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
