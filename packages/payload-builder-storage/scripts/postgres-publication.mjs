import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { resolveMinimalThemeProfile } from "@k-nex/theme-minimal";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { buildConfig, createPayloadRequest, getPayload } from "payload";

import {
  cmsPageDraftsCollection, cmsPageRevisionsCollection, cmsPublicationPairsCollection, createAtomicCmsPublisher,
  createPayloadUiDocumentRepository, themeProfileRevisionsCollection, uiDocumentRevisionsCollection
} from "../dist/index.js";

const POSTGRES_IMAGE = "postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const fixture = JSON.parse(await readFile(new URL("../../../fixtures/ui-documents/valid/cms.v1.json", import.meta.url), "utf8"));
const container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase("gate5").withStartupTimeout(120_000).start();
const connectionString = container.getConnectionUri();
const key = `p5-6-${Date.now()}`;
let payload;
let passed = false;

const mutableCopy = (value) => {
  if (Array.isArray(value)) return value.map(mutableCopy);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, mutableCopy(child)]));
  return value;
};
const query = async (text, values = []) => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
};
const count = async (collection) => (await payload.find({ collection, limit: 0, overrideAccess: true })).totalDocs;

try {
  const config = buildConfig({
    secret: "p5-6-atomic-publication-secret-at-least-32",
    db: postgresAdapter({ pool: { connectionString }, push: true }),
    collections: [uiDocumentRevisionsCollection, cmsPageDraftsCollection, cmsPageRevisionsCollection, cmsPublicationPairsCollection, themeProfileRevisionsCollection].map(mutableCopy)
  });
  payload = await getPayload({ config, key });
  let revision = 0;
  let tick = 0;
  const invalidationAttempts = [];
  const invalidationEffects = new Set();
  const failInvalidationOnce = new Set();
  const deniedHeadings = new Set();
  const now = () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++)).toISOString();
  const createRevisionId = () => `p5-6.revision.${++revision}`;
  const requestForTransaction = async (transactionID) => {
    const req = await createPayloadRequest({ config: payload.config, payloadInstanceCacheKey: key, request: new Request("http://localhost/internal/publish") });
    req.transactionID = transactionID;
    return req;
  };
  const documents = createPayloadUiDocumentRepository({
    payload, createRevisionId, now,
    validateForPublication(document) {
      const hero = document?.regions?.main?.[0];
      return hero?.type === "content.hero" && !deniedHeadings.has(hero?.props?.heading)
        ? { success: true, document }
        : { success: false, issues: ["PUBLIC_BLOCK_VALIDATION_FAILED"] };
    }
  });
  const publisher = createAtomicCmsPublisher({
    payload, documents, createRevisionId, now, requestForTransaction,
    validatePublication({ page, document, themeProfile }) {
      assert.equal(page.themeProfileRevisionId, themeProfile.revision.id);
      assert.equal(resolveMinimalThemeProfile(themeProfile).themeId, "theme.minimal", "theme revision must resolve through the installed public registry");
      assert.equal(document?.profile, "cms");
      assert.equal(document?.regions?.main?.[0]?.type, "content.hero");
      assert.equal(document?.bindings, undefined);
    },
    async invalidate(pair) {
      const visible = await query('select count(*)::int as count from "k_nex_cms_publication_pairs" where "pair_revision_id" = $1', [pair.pairRevisionId]);
      assert.equal(visible.rows[0].count, 1, "invalidation must run only after the pair commits");
      invalidationAttempts.push(pair.operationId);
      if (failInvalidationOnce.delete(pair.operationId)) throw new Error("invalidation transport unavailable");
      invalidationEffects.add(pair.pairRevisionId);
    }
  });

  const themeProfile = {
    schemaVersion: 1, id: "theme-profile.public-default", surface: "public", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light", values: {},
    revision: { id: "theme-revision.minimal-1", number: 1, state: "published", createdAt: "2026-08-27T00:00:00.000Z", publishedAt: "2026-08-27T00:01:00.000Z" }
  };
  const themeRow = await payload.create({ collection: "k-nex-theme-profile-revisions", data: { revisionId: themeProfile.revision.id, state: "published", profile: themeProfile }, overrideAccess: true });
  const metadata = {
    schemaVersion: 1, pageId: "cms.home", locale: "en-US", path: "/operations", title: "Operations", description: "Track every delivery.",
    canonicalPath: "/operations", robots: "index-follow", documentId: "cms.home", themeProfileRevisionId: themeProfile.revision.id,
    validationStatus: "valid", validationIssues: []
  };
  const pageDraft = await payload.create({ collection: "k-nex-cms-page-drafts", data: metadata, overrideAccess: true });
  await assert.rejects(() => payload.create({ collection: "k-nex-cms-page-drafts", data: { ...metadata, path: "/operations?draft=1" }, overrideAccess: true }), /Invalid string|metadata|validation/i);

  const ordinary = await createPayloadRequest({ config: payload.config, payloadInstanceCacheKey: key, request: new Request("http://localhost/api/revisions") });
  ordinary.user = { id: "ordinary-user", collection: "users" };
  await assert.rejects(() => payload.find({ collection: "k-nex-ui-document-revisions", overrideAccess: false, req: ordinary, limit: 10 }), /not allowed|Forbidden/i);

  const firstDraft = await documents.saveDraft({ documentId: "cms.home", document: fixture, validationStatus: "valid" });
  await assert.rejects(() => payload.findByID({ collection: "k-nex-ui-document-revisions", id: firstDraft.id, overrideAccess: false, req: ordinary }), /not allowed|Forbidden|not found/i);
  const first = await publisher.publish("publish.first", String(pageDraft.id), firstDraft.id);
  assert.deepEqual(await publisher.getPublishedPair("cms.home", "en-US"), first);

  const invalidDocument = structuredClone(fixture);
  invalidDocument.regions.main[0].props.heading = "Denied heading";
  deniedHeadings.add("Denied heading");
  const invalidDraft = await documents.saveDraft({ documentId: "cms.home", document: invalidDocument, validationStatus: "pending" });
  const beforeFailure = await count("k-nex-cms-page-revisions");
  await assert.rejects(() => publisher.publish("publish.invalid", String(pageDraft.id), invalidDraft.id), /PUBLIC_BLOCK_VALIDATION_FAILED/);
  assert.equal(await count("k-nex-cms-page-revisions"), beforeFailure, "failed publication must roll back its page revision");

  const parallelDrafts = [];
  for (const heading of ["Parallel A", "Parallel B"]) {
    const document = structuredClone(fixture);
    document.regions.main[0].props.heading = heading;
    parallelDrafts.push(await documents.saveDraft({ documentId: "cms.home", document, validationStatus: "valid" }));
  }
  const parallel = await Promise.all(parallelDrafts.map((draft, index) => publisher.publish(`publish.parallel-${index}`, String(pageDraft.id), draft.id)));
  assert.deepEqual(parallel.map(({ revisionNumber }) => revisionNumber).sort((a, b) => a - b), [2, 3]);

  const retryDocument = structuredClone(fixture);
  retryDocument.regions.main[0].props.heading = "Retry once";
  const retryDraft = await documents.saveDraft({ documentId: "cms.home", document: retryDocument, validationStatus: "valid" });
  failInvalidationOnce.add("publish.retry");
  const beforeRetry = await count("k-nex-cms-publication-pairs");
  await assert.rejects(() => publisher.publish("publish.retry", String(pageDraft.id), retryDraft.id), /invalidation transport unavailable/);
  assert.equal(await count("k-nex-cms-publication-pairs"), beforeRetry + 1, "publication remains committed when post-commit invalidation fails");
  const recovered = await publisher.publish("publish.retry", String(pageDraft.id), retryDraft.id);
  assert.equal(await count("k-nex-cms-publication-pairs"), beforeRetry + 1, "same operation retry must not republish");
  assert.deepEqual(invalidationAttempts.filter((operationId) => operationId === "publish.retry"), ["publish.retry", "publish.retry"]);
  assert(invalidationEffects.has(recovered.pairRevisionId), "invalidation retry must converge idempotently");

  const rollbacks = await Promise.all([
    publisher.rollback("rollback.parallel-0", "cms.home", "en-US", first.pairRevisionId),
    publisher.rollback("rollback.parallel-1", "cms.home", "en-US", parallel[0].pairRevisionId)
  ]);
  assert.equal(new Set(rollbacks.map(({ revisionNumber }) => revisionNumber)).size, 2, "parallel rollbacks must receive distinct revisions");
  const pairs = await payload.find({ collection: "k-nex-cms-publication-pairs", where: { and: [{ pageId: { equals: "cms.home" } }, { locale: { equals: "en-US" } }] }, sort: "revisionNumber", limit: 100, overrideAccess: true });
  for (let index = 0; index < pairs.docs.length; index += 1) {
    assert.equal(pairs.docs[index].revisionNumber, index + 1);
    if (index > 0) assert.equal(pairs.docs[index].previousPairRevisionId, pairs.docs[index - 1].pairRevisionId);
  }
  assert.equal((await publisher.getPublishedPair("cms.home", "en-US")).pairRevisionId, pairs.docs.at(-1).pairRevisionId);

  const beforeDeniedRollback = await count("k-nex-cms-publication-pairs");
  deniedHeadings.add(fixture.regions.main[0].props.heading);
  await assert.rejects(() => publisher.rollback("rollback.invalid-block", "cms.home", "en-US", first.pairRevisionId), /PUBLIC_BLOCK_VALIDATION_FAILED/);
  await payload.update({ collection: "k-nex-theme-profile-revisions", id: themeRow.id, data: { state: "archived" }, overrideAccess: true });
  await assert.rejects(() => publisher.rollback("rollback.archived-theme", "cms.home", "en-US", first.pairRevisionId), /Published theme profile revision was not found/);
  assert.equal(await count("k-nex-cms-publication-pairs"), beforeDeniedRollback, "denied rollbacks must be atomic");
  assert(!invalidationAttempts.includes("rollback.invalid-block") && !invalidationAttempts.includes("rollback.archived-theme"));

  const duplicateSequences = await query('select "sequence_key", count(*)::int as count from "k_nex_cms_publication_pairs" group by "sequence_key" having count(*) > 1');
  assert.deepEqual(duplicateSequences.rows, []);
  process.stdout.write("P5_6_POSTGRES_PUBLICATION_PASS\n");
  passed = true;
} finally {
  payload?.db?.pool?.on?.("error", () => {});
  if (payload) await payload.destroy();
  await Promise.race([container.stop(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
}
if (passed) process.exit(0);
