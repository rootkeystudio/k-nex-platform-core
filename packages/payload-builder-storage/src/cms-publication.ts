import { UI_DOCUMENT_REVISIONS_SLUG, createPayloadUiDocumentRepository, type PayloadUiDocumentStoragePort, type UiDocumentRevision } from "./index.js";

export const CMS_PAGE_DRAFTS_SLUG = "k-nex-cms-page-drafts" as const;
export const CMS_PAGE_REVISIONS_SLUG = "k-nex-cms-page-revisions" as const;
export const CMS_PUBLICATION_PAIRS_SLUG = "k-nex-cms-publication-pairs" as const;

export interface CmsPageMetadata {
  readonly pageId: string;
  readonly locale: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly canonicalPath: string;
  readonly robots: "index-follow" | "noindex-follow" | "noindex-nofollow";
  readonly documentId: string;
  readonly themeProfileRevisionId: string;
}

export interface CmsPublicationPair {
  readonly id: string;
  readonly pairRevisionId: string;
  readonly pageId: string;
  readonly locale: string;
  readonly revisionNumber: number;
  readonly pageRevisionId: string;
  readonly documentRevisionId: string;
  readonly publishedAt: string;
  readonly previousPairRevisionId?: string;
  readonly rollbackOfPairRevisionId?: string;
}

export interface AtomicPayloadPort extends PayloadUiDocumentStoragePort {
  readonly db: {
    beginTransaction(): Promise<unknown>;
    commitTransaction(id: unknown): Promise<void>;
    rollbackTransaction(id: unknown): Promise<void>;
  };
}

function string(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`CMS record field is invalid: ${key}.`);
  return value;
}

function identifier(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) throw new TypeError(`CMS record identifier is invalid: ${key}.`);
  return String(value);
}

function pageMetadata(value: unknown): CmsPageMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("CMS page draft is invalid.");
  const record = value as Record<string, unknown>;
  const locale = string(record, "locale");
  const path = string(record, "path");
  const canonicalPath = string(record, "canonicalPath");
  const robots = string(record, "robots");
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale) || !path.startsWith("/") || path.startsWith("//") || !canonicalPath.startsWith("/") || canonicalPath.startsWith("//")) throw new TypeError("CMS locale and paths must be canonical internal values.");
  if (!(robots === "index-follow" || robots === "noindex-follow" || robots === "noindex-nofollow")) throw new TypeError("CMS robots policy is invalid.");
  return Object.freeze({
    pageId: string(record, "pageId"), locale, path,
    title: string(record, "title"), description: string(record, "description"), canonicalPath,
    robots, documentId: string(record, "documentId"), themeProfileRevisionId: string(record, "themeProfileRevisionId")
  });
}

function publicationPair(value: unknown): CmsPublicationPair {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("CMS publication pair is invalid.");
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.revisionNumber) || (record.revisionNumber as number) < 1) throw new TypeError("CMS publication pair revision is invalid.");
  return Object.freeze({
    id: identifier(record, "id"), pairRevisionId: string(record, "pairRevisionId"), pageId: string(record, "pageId"), locale: string(record, "locale"),
    revisionNumber: record.revisionNumber as number, pageRevisionId: string(record, "pageRevisionId"), documentRevisionId: string(record, "documentRevisionId"), publishedAt: string(record, "publishedAt"),
    ...(typeof record.previousPairRevisionId === "string" ? { previousPairRevisionId: record.previousPairRevisionId } : {}),
    ...(typeof record.rollbackOfPairRevisionId === "string" ? { rollbackOfPairRevisionId: record.rollbackOfPairRevisionId } : {})
  });
}

const pairWhere = (pageId: string, locale: string) => ({ and: [{ pageId: { equals: pageId } }, { locale: { equals: locale } }] });

export function createAtomicCmsPublisher(options: {
  readonly payload: AtomicPayloadPort;
  readonly documents: ReturnType<typeof createPayloadUiDocumentRepository>;
  readonly createRevisionId: () => string;
  readonly now: () => string;
  readonly requestForTransaction: (transactionId: unknown) => Promise<unknown>;
  readonly validatePublication: (input: { readonly page: CmsPageMetadata; readonly document: unknown }) => void;
  readonly invalidate: (pair: CmsPublicationPair) => Promise<void> | void;
}) {
  const latestPair = async (pageId: string, locale: string, req?: unknown): Promise<CmsPublicationPair | undefined> => {
    const result = await options.payload.find({ collection: CMS_PUBLICATION_PAIRS_SLUG, where: pairWhere(pageId, locale), sort: "-revisionNumber", limit: 1, depth: 0, overrideAccess: true, ...(req === undefined ? {} : { req }) });
    return result.docs[0] === undefined ? undefined : publicationPair(result.docs[0]);
  };
  const create = (collection: string, data: Record<string, unknown>, req: unknown) => options.payload.create({ collection, data, req, depth: 0, overrideAccess: true });
  const transaction = async <T>(work: (req: unknown) => Promise<T>): Promise<T> => {
    const transactionId = await options.payload.db.beginTransaction();
    const req = await options.requestForTransaction(transactionId);
    try {
      const result = await work(req);
      await options.payload.db.commitTransaction(transactionId);
      return result;
    } catch (error) {
      await options.payload.db.rollbackTransaction(transactionId);
      throw error;
    }
  };
  return Object.freeze({
    async publish(pageDraftId: string, documentDraftId: string): Promise<CmsPublicationPair> {
      const page = pageMetadata(await options.payload.findByID({ collection: CMS_PAGE_DRAFTS_SLUG, id: pageDraftId, depth: 0, overrideAccess: true }));
      const documentDraft = await options.payload.findByID({ collection: UI_DOCUMENT_REVISIONS_SLUG, id: documentDraftId, depth: 0, overrideAccess: true }) as Record<string, unknown>;
      if (documentDraft.documentId !== page.documentId) throw new TypeError("CMS page and UI document draft identities do not match.");
      options.validatePublication({ page, document: documentDraft.document });
      const pair = await transaction(async (req) => {
        const previous = await latestPair(page.pageId, page.locale, req);
        const pageRevisionId = options.createRevisionId();
        await create(CMS_PAGE_REVISIONS_SLUG, { ...page, pageRevisionId, revisionNumber: (previous?.revisionNumber ?? 0) + 1, publishedAt: options.now(), ...(previous === undefined ? {} : { previousPageRevisionId: previous.pageRevisionId }) }, req);
        const documentRevision = await options.documents.publishDraft(documentDraftId, req);
        const pairRevisionId = options.createRevisionId();
        return publicationPair(await create(CMS_PUBLICATION_PAIRS_SLUG, {
          pairRevisionId, pageId: page.pageId, locale: page.locale, revisionNumber: (previous?.revisionNumber ?? 0) + 1,
          pageRevisionId, documentRevisionId: documentRevision.revisionId, publishedAt: options.now(),
          ...(previous === undefined ? {} : { previousPairRevisionId: previous.pairRevisionId })
        }, req));
      });
      await options.invalidate(pair);
      return pair;
    },
    async getPublishedPair(pageId: string, locale: string): Promise<CmsPublicationPair | undefined> {
      return latestPair(pageId, locale);
    },
    async rollback(pageId: string, locale: string, targetPairRevisionId: string): Promise<CmsPublicationPair> {
      const targetResult = await options.payload.find({ collection: CMS_PUBLICATION_PAIRS_SLUG, where: { and: [...pairWhere(pageId, locale).and, { pairRevisionId: { equals: targetPairRevisionId } }] }, limit: 1, depth: 0, overrideAccess: true });
      const target = targetResult.docs[0] === undefined ? undefined : publicationPair(targetResult.docs[0]);
      if (target === undefined) throw new TypeError("CMS rollback target pair was not found.");
      const pair = await transaction(async (req) => {
        const current = await latestPair(pageId, locale, req);
        if (current === undefined) throw new TypeError("CMS page has no published pair to roll back.");
        const pageResult = await options.payload.find({ collection: CMS_PAGE_REVISIONS_SLUG, where: { pageRevisionId: { equals: target.pageRevisionId } }, limit: 1, depth: 0, overrideAccess: true, req });
        const page = pageMetadata(pageResult.docs[0]);
        const pageRevisionId = options.createRevisionId();
        await create(CMS_PAGE_REVISIONS_SLUG, { ...page, pageRevisionId, revisionNumber: current.revisionNumber + 1, publishedAt: options.now(), previousPageRevisionId: current.pageRevisionId, rollbackOfPageRevisionId: target.pageRevisionId }, req);
        const targetDocument = await options.payload.find({ collection: UI_DOCUMENT_REVISIONS_SLUG, where: { revisionId: { equals: target.documentRevisionId } }, limit: 1, depth: 0, overrideAccess: true, req });
        const targetDocumentRevision = targetDocument.docs[0] as UiDocumentRevision | undefined;
        if (targetDocumentRevision === undefined) throw new TypeError("CMS rollback document revision was not found.");
        const documentRevision = await options.documents.rollback(page.documentId, targetDocumentRevision.revisionId, req);
        const pairRevisionId = options.createRevisionId();
        return publicationPair(await create(CMS_PUBLICATION_PAIRS_SLUG, {
          pairRevisionId, pageId, locale, revisionNumber: current.revisionNumber + 1, pageRevisionId, documentRevisionId: documentRevision.revisionId,
          publishedAt: options.now(), previousPairRevisionId: current.pairRevisionId, rollbackOfPairRevisionId: target.pairRevisionId
        }, req));
      });
      await options.invalidate(pair);
      return pair;
    }
  });
}

const serverOnlyAccess = { read: () => false, create: () => false, update: () => false, delete: () => false };
const metadataFields = [
  { name: "pageId", type: "text", required: true, index: true }, { name: "locale", type: "text", required: true, index: true },
  { name: "path", type: "text", required: true, index: true }, { name: "title", type: "text", required: true },
  { name: "description", type: "textarea", required: true }, { name: "canonicalPath", type: "text", required: true },
  { name: "robots", type: "select", required: true, options: ["index-follow", "noindex-follow", "noindex-nofollow"] },
  { name: "documentId", type: "text", required: true, index: true }, { name: "themeProfileRevisionId", type: "text", required: true, index: true }
];

export const cmsPageDraftsCollection = Object.freeze({ slug: CMS_PAGE_DRAFTS_SLUG, access: serverOnlyAccess, fields: [...metadataFields, { name: "validationStatus", type: "select", required: true, options: ["pending", "valid", "invalid"] }, { name: "validationIssues", type: "json", required: true, defaultValue: [] }] });
export const cmsPageRevisionsCollection = Object.freeze({ slug: CMS_PAGE_REVISIONS_SLUG, access: serverOnlyAccess, fields: [...metadataFields, { name: "pageRevisionId", type: "text", required: true, unique: true, index: true }, { name: "revisionNumber", type: "number", required: true, index: true }, { name: "publishedAt", type: "date", required: true, index: true }, { name: "previousPageRevisionId", type: "text", index: true }, { name: "rollbackOfPageRevisionId", type: "text", index: true }] });
export const cmsPublicationPairsCollection = Object.freeze({ slug: CMS_PUBLICATION_PAIRS_SLUG, access: serverOnlyAccess, fields: [{ name: "pairRevisionId", type: "text", required: true, unique: true, index: true }, { name: "pageId", type: "text", required: true, index: true }, { name: "locale", type: "text", required: true, index: true }, { name: "revisionNumber", type: "number", required: true, index: true }, { name: "pageRevisionId", type: "text", required: true, index: true }, { name: "documentRevisionId", type: "text", required: true, index: true }, { name: "publishedAt", type: "date", required: true, index: true }, { name: "previousPairRevisionId", type: "text", index: true }, { name: "rollbackOfPairRevisionId", type: "text", index: true }] });
