import { describe, expect, it, vi } from "vitest";

import { cmsPageDraftsCollection, cmsPageRevisionsCollection, cmsPublicationPairsCollection, createAtomicCmsPublisher, themeProfileRevisionsCollection } from "../src/index.js";

const metadata = { schemaVersion: 1, pageId: "cms.home", locale: "en-US", path: "/operations", title: "Operations", description: "Track every delivery.", canonicalPath: "/operations", robots: "index-follow", documentId: "cms.home", themeProfileRevisionId: "theme-revision.minimal-1" };

describe("atomic CMS publication boundaries", () => {
  it("rolls back an opened transaction when request construction fails", async () => {
    const rollbackTransaction = vi.fn(async () => undefined);
    const payload = {
      db: { beginTransaction: vi.fn(async () => "tx-1"), commitTransaction: vi.fn(), rollbackTransaction },
      async find() { return { docs: [] }; },
      async findByID(input: Record<string, unknown>) { return input.collection === "k-nex-cms-page-drafts" ? metadata : { documentId: "cms.home", document: { schemaVersion: 1 } }; },
      async create() { throw new Error("must not create"); }
    };
    const publisher = createAtomicCmsPublisher({ payload, documents: {} as never, createRevisionId: () => "revision.1", now: () => "2026-08-27T00:00:00.000Z", requestForTransaction: async () => { throw new Error("request failed"); }, validatePublication: () => undefined, invalidate: () => undefined });
    await expect(publisher.publish("publish.request-failure", "page-1", "document-1")).rejects.toThrow("request failed");
    expect(rollbackTransaction).toHaveBeenCalledExactlyOnceWith("tx-1");
  });

  it("keeps page, pair, theme, and UI storage server-only with unique ordering keys", () => {
    for (const collection of [cmsPageDraftsCollection, cmsPageRevisionsCollection, cmsPublicationPairsCollection, themeProfileRevisionsCollection]) {
      expect(collection.access.read({ req: { user: { id: "ordinary" } } } as never)).toBe(false);
    }
    for (const collection of [cmsPageRevisionsCollection, cmsPublicationPairsCollection]) {
      const fields = new Map((collection.fields as any[]).map((field) => [field.name, field]));
      expect(fields.get("sequenceKey")).toMatchObject({ unique: true, index: true });
    }
    const pairFields = new Map((cmsPublicationPairsCollection.fields as any[]).map((field) => [field.name, field]));
    expect(pairFields.get("operationKind")).toMatchObject({ required: true, options: ["publish", "rollback"] });
    expect(pairFields.get("operationDigest")).toMatchObject({ required: true });
    expect(() => cmsPageDraftsCollection.hooks.beforeValidate[0]({ data: { ...metadata, path: "/operations?draft=1" } })).toThrow();
    expect(cmsPageDraftsCollection.hooks.beforeValidate[0]({ data: metadata })).toEqual(metadata);
  });
});
