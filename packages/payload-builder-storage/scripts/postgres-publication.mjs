import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { postgresAdapter } from "@payloadcms/db-postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { buildConfig, createPayloadRequest, getPayload } from "payload";

import {
  cmsPageDraftsCollection,
  cmsPageRevisionsCollection,
  cmsPublicationPairsCollection,
  createAtomicCmsPublisher,
  createPayloadUiDocumentRepository,
  uiDocumentRevisionsCollection
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

try {
  const config = buildConfig({
    secret: "p5-6-atomic-publication-secret-at-least-32",
    db: postgresAdapter({ pool: { connectionString }, push: true }),
    collections: [uiDocumentRevisionsCollection, cmsPageDraftsCollection, cmsPageRevisionsCollection, cmsPublicationPairsCollection].map(mutableCopy)
  });
  payload = await getPayload({ config, key });
  let revision = 0;
  let tick = 0;
  const invalidations = [];
  const now = () => `2026-08-27T12:00:0${tick++}.000Z`;
  const createRevisionId = () => `p5-6.revision.${++revision}`;
  const documents = createPayloadUiDocumentRepository({
    payload,
    createRevisionId,
    now,
    validateForPublication(document) {
      const hero = document?.regions?.main?.[0];
      return hero?.type === "content.hero" && hero?.props?.heading !== "REJECT"
        ? { success: true, document }
        : { success: false, issues: ["PUBLIC_BLOCK_VALIDATION_FAILED"] };
    }
  });
  const publisher = createAtomicCmsPublisher({
    payload,
    documents,
    createRevisionId,
    now,
    async requestForTransaction(transactionID) {
      const req = await createPayloadRequest({ config: payload.config, payloadInstanceCacheKey: key, request: new Request("http://localhost/internal/publish") });
      req.transactionID = transactionID;
      return req;
    },
    validatePublication({ page, document }) {
      assert.equal(page.themeProfileRevisionId, "theme.minimal.published.1");
      assert.equal(document?.profile, "cms");
      assert.equal(document?.regions?.main?.[0]?.type, "content.hero");
      assert.equal(document?.bindings, undefined);
    },
    async invalidate(pair) {
      const visible = await query('select count(*)::int as count from "k_nex_cms_publication_pairs" where "pair_revision_id" = $1', [pair.pairRevisionId]);
      assert.equal(visible.rows[0].count, 1, "invalidation must run only after the pair commits");
      invalidations.push(pair.pairRevisionId);
    }
  });
  const metadata = {
    pageId: "cms.home", locale: "en-US", path: "/operations", title: "Operations",
    description: "Track every delivery.", canonicalPath: "/operations", robots: "index-follow",
    documentId: "cms.home", themeProfileRevisionId: "theme.minimal.published.1",
    validationStatus: "valid", validationIssues: []
  };
  const pageDraft = await payload.create({ collection: "k-nex-cms-page-drafts", data: metadata, overrideAccess: true });
  const firstDraft = await documents.saveDraft({ documentId: "cms.home", document: fixture, validationStatus: "valid" });
  const first = await publisher.publish(String(pageDraft.id), firstDraft.id);
  assert.deepEqual(await publisher.getPublishedPair("cms.home", "en-US"), first);
  assert.deepEqual(invalidations, [first.pairRevisionId]);

  const failedDocument = structuredClone(fixture);
  failedDocument.regions.main[0].props.heading = "REJECT";
  const failedDraft = await documents.saveDraft({ documentId: "cms.home", document: failedDocument, validationStatus: "pending" });
  const beforeFailure = await payload.find({ collection: "k-nex-cms-page-revisions", limit: 100, overrideAccess: true });
  await assert.rejects(() => publisher.publish(String(pageDraft.id), failedDraft.id), /PUBLIC_BLOCK_VALIDATION_FAILED/);
  const afterFailure = await payload.find({ collection: "k-nex-cms-page-revisions", limit: 100, overrideAccess: true });
  assert.equal(afterFailure.totalDocs, beforeFailure.totalDocs, "failed pair must roll back its page revision");
  assert.deepEqual(invalidations, [first.pairRevisionId], "failed publication must not invalidate caches");

  const secondDocument = structuredClone(fixture);
  secondDocument.regions.main[0].props.heading = "Current operations";
  const secondDraft = await documents.saveDraft({ documentId: "cms.home", document: secondDocument, validationStatus: "valid" });
  const second = await publisher.publish(String(pageDraft.id), secondDraft.id);
  const rolledBack = await publisher.rollback("cms.home", "en-US", first.pairRevisionId);
  assert.equal(rolledBack.rollbackOfPairRevisionId, first.pairRevisionId);
  assert.equal(rolledBack.previousPairRevisionId, second.pairRevisionId);
  assert.deepEqual(invalidations, [first.pairRevisionId, second.pairRevisionId, rolledBack.pairRevisionId]);
  const published = await documents.getPublished("cms.home");
  assert.deepEqual(published.document, fixture, "rollback must create a new copy of the previous document revision");
  const pairRows = await query('select count(*)::int as count from "k_nex_cms_publication_pairs"');
  assert.equal(pairRows.rows[0].count, 3);
  process.stdout.write("P5_6_POSTGRES_PUBLICATION_PASS\n");
  passed = true;
} finally {
  payload?.db?.pool?.on?.("error", () => {});
  if (payload) await payload.destroy();
  await Promise.race([container.stop(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
}
if (passed) process.exit(0);
