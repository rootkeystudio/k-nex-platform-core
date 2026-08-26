import { CmsPageMetadataSchema, ThemeProfileSchema, type CmsPageMetadata, type ThemeProfile } from "@k-nex/contracts";

import { UI_DOCUMENT_REVISIONS_SLUG, createPayloadUiDocumentRepository, type PayloadUiDocumentStoragePort, type UiDocumentRevision } from "./index.js";

export const CMS_PAGE_DRAFTS_SLUG = "k-nex-cms-page-drafts" as const;
export const CMS_PAGE_REVISIONS_SLUG = "k-nex-cms-page-revisions" as const;
export const CMS_PUBLICATION_PAIRS_SLUG = "k-nex-cms-publication-pairs" as const;
export const THEME_PROFILE_REVISIONS_SLUG = "k-nex-theme-profile-revisions" as const;
export type { CmsPageMetadata } from "@k-nex/contracts";

export interface CmsPublicationPair {
  readonly id: string;
  readonly operationId: string;
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
  readonly db: { beginTransaction(): Promise<unknown>; commitTransaction(id: unknown): Promise<void>; rollbackTransaction(id: unknown): Promise<void> };
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("CMS page metadata is invalid.");
  const record = value as Record<string, unknown>;
  return CmsPageMetadataSchema.parse({ schemaVersion: record.schemaVersion, pageId: record.pageId, locale: record.locale, path: record.path, title: record.title, description: record.description, canonicalPath: record.canonicalPath, robots: record.robots, documentId: record.documentId, themeProfileRevisionId: record.themeProfileRevisionId });
}

function publicationPair(value: unknown): CmsPublicationPair {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("CMS publication pair is invalid.");
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.revisionNumber) || (record.revisionNumber as number) < 1) throw new TypeError("CMS publication pair revision is invalid.");
  return Object.freeze({
    id: identifier(record, "id"), operationId: string(record, "operationId"), pairRevisionId: string(record, "pairRevisionId"), pageId: string(record, "pageId"), locale: string(record, "locale"),
    revisionNumber: record.revisionNumber as number, pageRevisionId: string(record, "pageRevisionId"), documentRevisionId: string(record, "documentRevisionId"), publishedAt: string(record, "publishedAt"),
    ...(typeof record.previousPairRevisionId === "string" ? { previousPairRevisionId: record.previousPairRevisionId } : {}),
    ...(typeof record.rollbackOfPairRevisionId === "string" ? { rollbackOfPairRevisionId: record.rollbackOfPairRevisionId } : {})
  });
}

const pairWhere = (pageId: string, locale: string) => ({ and: [{ pageId: { equals: pageId } }, { locale: { equals: locale } }] });
const sequenceKey = (pageId: string, locale: string, revisionNumber: number) => `${pageId}:${locale}:${revisionNumber}`;

function isUniqueConflict(error: unknown): boolean {
  if (Array.isArray(error)) return error.some(isUniqueConflict);
  if (error === null || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "23505" || record.message === "Value must be unique" || isUniqueConflict(record.cause) || isUniqueConflict(record.data) || isUniqueConflict(record.errors);
}

export function createAtomicCmsPublisher(options: {
  readonly payload: AtomicPayloadPort;
  readonly documents: ReturnType<typeof createPayloadUiDocumentRepository>;
  readonly createRevisionId: () => string;
  readonly now: () => string;
  readonly requestForTransaction: (transactionId: unknown) => Promise<unknown>;
  readonly validatePublication: (input: { readonly page: CmsPageMetadata; readonly document: unknown; readonly themeProfile: ThemeProfile }) => Promise<void> | void;
  readonly invalidate: (pair: CmsPublicationPair) => Promise<void> | void;
}) {
  const latestPair = async (pageId: string, locale: string, req?: unknown): Promise<CmsPublicationPair | undefined> => {
    const result = await options.payload.find({ collection: CMS_PUBLICATION_PAIRS_SLUG, where: pairWhere(pageId, locale), sort: "-revisionNumber", limit: 1, depth: 0, overrideAccess: true, ...(req === undefined ? {} : { req }) });
    return result.docs[0] === undefined ? undefined : publicationPair(result.docs[0]);
  };
  const findOperation = async (operationId: string, req?: unknown): Promise<CmsPublicationPair | undefined> => {
    const result = await options.payload.find({ collection: CMS_PUBLICATION_PAIRS_SLUG, where: { operationId: { equals: operationId } }, limit: 1, depth: 0, overrideAccess: true, ...(req === undefined ? {} : { req }) });
    return result.docs[0] === undefined ? undefined : publicationPair(result.docs[0]);
  };
  const create = (collection: string, data: Record<string, unknown>, req: unknown) => options.payload.create({ collection, data, req, depth: 0, overrideAccess: true });
  const publishedTheme = async (revisionId: string, req: unknown): Promise<ThemeProfile> => {
    const result = await options.payload.find({ collection: THEME_PROFILE_REVISIONS_SLUG, where: { and: [{ revisionId: { equals: revisionId } }, { state: { equals: "published" } }] }, limit: 1, depth: 0, overrideAccess: true, req });
    const record = result.docs[0];
    if (record === undefined || record === null || typeof record !== "object") throw new TypeError(`Published theme profile revision was not found: ${revisionId}.`);
    const theme = ThemeProfileSchema.parse((record as Record<string, unknown>).profile);
    if (theme.revision.state !== "published" || theme.revision.id !== revisionId || theme.surface !== "public") throw new TypeError(`Theme profile revision is not current public publication authority: ${revisionId}.`);
    return theme;
  };
  const validate = async (page: CmsPageMetadata, document: unknown, req: unknown) => options.validatePublication({ page, document, themeProfile: await publishedTheme(page.themeProfileRevisionId, req) });
  const transaction = async <T>(work: (req: unknown) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const transactionId = await options.payload.db.beginTransaction();
      try {
        const req = await options.requestForTransaction(transactionId);
        const result = await work(req);
        await options.payload.db.commitTransaction(transactionId);
        return result;
      } catch (error) {
        await options.payload.db.rollbackTransaction(transactionId).catch(() => undefined);
        if (attempt < 2 && isUniqueConflict(error)) continue;
        throw error;
      }
    }
    throw new TypeError("CMS publication transaction retry budget was exhausted.");
  };
  const complete = async (pair: CmsPublicationPair) => { await options.invalidate(pair); return pair; };
  return Object.freeze({
    async publish(operationId: string, pageDraftId: string, documentDraftId: string): Promise<CmsPublicationPair> {
      const existing = await findOperation(operationId);
      if (existing !== undefined) return complete(existing);
      const page = pageMetadata(await options.payload.findByID({ collection: CMS_PAGE_DRAFTS_SLUG, id: pageDraftId, depth: 0, overrideAccess: true }));
      const documentDraft = await options.payload.findByID({ collection: UI_DOCUMENT_REVISIONS_SLUG, id: documentDraftId, depth: 0, overrideAccess: true }) as Record<string, unknown>;
      if (documentDraft.documentId !== page.documentId) throw new TypeError("CMS page and UI document draft identities do not match.");
      const pair = await transaction(async (req) => {
        const concurrent = await findOperation(operationId, req);
        if (concurrent !== undefined) return concurrent;
        await validate(page, documentDraft.document, req);
        const previous = await latestPair(page.pageId, page.locale, req);
        const revisionNumber = (previous?.revisionNumber ?? 0) + 1;
        const pageRevisionId = options.createRevisionId();
        await create(CMS_PAGE_REVISIONS_SLUG, { ...page, sequenceKey: sequenceKey(page.pageId, page.locale, revisionNumber), pageRevisionId, revisionNumber, publishedAt: options.now(), ...(previous === undefined ? {} : { previousPageRevisionId: previous.pageRevisionId }) }, req);
        const documentRevision = await options.documents.publishDraft(documentDraftId, req);
        const pairRevisionId = options.createRevisionId();
        return publicationPair(await create(CMS_PUBLICATION_PAIRS_SLUG, { operationId, sequenceKey: sequenceKey(page.pageId, page.locale, revisionNumber), pairRevisionId, pageId: page.pageId, locale: page.locale, revisionNumber, pageRevisionId, documentRevisionId: documentRevision.revisionId, publishedAt: options.now(), ...(previous === undefined ? {} : { previousPairRevisionId: previous.pairRevisionId }) }, req));
      });
      return complete(pair);
    },
    async getPublishedPair(pageId: string, locale: string): Promise<CmsPublicationPair | undefined> { return latestPair(pageId, locale); },
    async rollback(operationId: string, pageId: string, locale: string, targetPairRevisionId: string): Promise<CmsPublicationPair> {
      const existing = await findOperation(operationId);
      if (existing !== undefined) return complete(existing);
      const targetResult = await options.payload.find({ collection: CMS_PUBLICATION_PAIRS_SLUG, where: { and: [...pairWhere(pageId, locale).and, { pairRevisionId: { equals: targetPairRevisionId } }] }, limit: 1, depth: 0, overrideAccess: true });
      const target = targetResult.docs[0] === undefined ? undefined : publicationPair(targetResult.docs[0]);
      if (target === undefined) throw new TypeError("CMS rollback target pair was not found.");
      const pair = await transaction(async (req) => {
        const concurrent = await findOperation(operationId, req);
        if (concurrent !== undefined) return concurrent;
        const current = await latestPair(pageId, locale, req);
        if (current === undefined) throw new TypeError("CMS page has no published pair to roll back.");
        const pageResult = await options.payload.find({ collection: CMS_PAGE_REVISIONS_SLUG, where: { pageRevisionId: { equals: target.pageRevisionId } }, limit: 1, depth: 0, overrideAccess: true, req });
        const page = pageMetadata(pageResult.docs[0]);
        const targetDocument = await options.payload.find({ collection: UI_DOCUMENT_REVISIONS_SLUG, where: { revisionId: { equals: target.documentRevisionId } }, limit: 1, depth: 0, overrideAccess: true, req });
        const targetDocumentRevision = targetDocument.docs[0] as UiDocumentRevision | undefined;
        if (targetDocumentRevision === undefined) throw new TypeError("CMS rollback document revision was not found.");
        await validate(page, targetDocumentRevision.document, req);
        const revisionNumber = current.revisionNumber + 1;
        const pageRevisionId = options.createRevisionId();
        await create(CMS_PAGE_REVISIONS_SLUG, { ...page, sequenceKey: sequenceKey(pageId, locale, revisionNumber), pageRevisionId, revisionNumber, publishedAt: options.now(), previousPageRevisionId: current.pageRevisionId, rollbackOfPageRevisionId: target.pageRevisionId }, req);
        const documentRevision = await options.documents.rollback(page.documentId, targetDocumentRevision.revisionId, req);
        const pairRevisionId = options.createRevisionId();
        return publicationPair(await create(CMS_PUBLICATION_PAIRS_SLUG, { operationId, sequenceKey: sequenceKey(pageId, locale, revisionNumber), pairRevisionId, pageId, locale, revisionNumber, pageRevisionId, documentRevisionId: documentRevision.revisionId, publishedAt: options.now(), previousPairRevisionId: current.pairRevisionId, rollbackOfPairRevisionId: target.pairRevisionId }, req));
      });
      return complete(pair);
    }
  });
}

const serverOnlyAccess = { read: () => false, create: () => false, update: () => false, delete: () => false };
const metadataFields = [
  { name: "schemaVersion", type: "number", required: true, defaultValue: 1 }, { name: "pageId", type: "text", required: true, index: true }, { name: "locale", type: "text", required: true, index: true },
  { name: "path", type: "text", required: true, index: true }, { name: "title", type: "text", required: true }, { name: "description", type: "textarea", required: true }, { name: "canonicalPath", type: "text", required: true },
  { name: "robots", type: "select", required: true, options: ["index-follow", "noindex-follow", "noindex-nofollow"] }, { name: "documentId", type: "text", required: true, index: true }, { name: "themeProfileRevisionId", type: "text", required: true, index: true }
];
const validateMetadata = ({ data }: { data?: unknown }) => { pageMetadata(data); return data; };

export const cmsPageDraftsCollection = Object.freeze({ slug: CMS_PAGE_DRAFTS_SLUG, access: serverOnlyAccess, hooks: { beforeValidate: [validateMetadata] }, fields: [...metadataFields, { name: "validationStatus", type: "select", required: true, options: ["pending", "valid", "invalid"] }, { name: "validationIssues", type: "json", required: true, defaultValue: [] }] });
export const cmsPageRevisionsCollection = Object.freeze({ slug: CMS_PAGE_REVISIONS_SLUG, access: serverOnlyAccess, hooks: { beforeValidate: [validateMetadata] }, fields: [...metadataFields, { name: "sequenceKey", type: "text", required: true, unique: true, index: true }, { name: "pageRevisionId", type: "text", required: true, unique: true, index: true }, { name: "revisionNumber", type: "number", required: true, index: true }, { name: "publishedAt", type: "date", required: true, index: true }, { name: "previousPageRevisionId", type: "text", index: true }, { name: "rollbackOfPageRevisionId", type: "text", index: true }] });
export const cmsPublicationPairsCollection = Object.freeze({ slug: CMS_PUBLICATION_PAIRS_SLUG, access: serverOnlyAccess, fields: [{ name: "operationId", type: "text", required: true, unique: true, index: true }, { name: "sequenceKey", type: "text", required: true, unique: true, index: true }, { name: "pairRevisionId", type: "text", required: true, unique: true, index: true }, { name: "pageId", type: "text", required: true, index: true }, { name: "locale", type: "text", required: true, index: true }, { name: "revisionNumber", type: "number", required: true, index: true }, { name: "pageRevisionId", type: "text", required: true, index: true }, { name: "documentRevisionId", type: "text", required: true, index: true }, { name: "publishedAt", type: "date", required: true, index: true }, { name: "previousPairRevisionId", type: "text", index: true }, { name: "rollbackOfPairRevisionId", type: "text", index: true }] });
export const themeProfileRevisionsCollection = Object.freeze({ slug: THEME_PROFILE_REVISIONS_SLUG, access: serverOnlyAccess, fields: [{ name: "revisionId", type: "text", required: true, unique: true, index: true }, { name: "state", type: "select", required: true, index: true, options: ["draft", "published", "archived"] }, { name: "profile", type: "json", required: true }] });
