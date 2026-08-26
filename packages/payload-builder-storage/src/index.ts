import { UiDocumentSchema, assertJsonValue, type JsonValue, type UiDocument } from "@k-nex/contracts";

export const UI_DOCUMENT_REVISIONS_SLUG = "k-nex-ui-document-revisions" as const;

export type UiDocumentRevisionState = "draft" | "published" | "archived";
export type UiDocumentValidationStatus = "pending" | "valid" | "invalid";

export interface UiDocumentRevision {
  readonly id: string;
  readonly revisionId: string;
  readonly documentId: string;
  readonly revisionNumber: number;
  readonly state: UiDocumentRevisionState;
  readonly document: JsonValue;
  readonly validationStatus: UiDocumentValidationStatus;
  readonly validationIssues: readonly string[];
  readonly previousRevisionId?: string;
  readonly rollbackOfRevisionId?: string;
  readonly publishedAt?: string;
}

interface PayloadFindResult { readonly docs: readonly unknown[] }

export interface PayloadUiDocumentStoragePort {
  create(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  find(input: Readonly<Record<string, unknown>>): Promise<PayloadFindResult>;
  findByID(input: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface PublicationValidationResult {
  readonly success: boolean;
  readonly document?: UiDocument;
  readonly issues?: readonly string[];
}

export interface UiDocumentRepositoryOptions {
  readonly payload: PayloadUiDocumentStoragePort;
  readonly createRevisionId: () => string;
  readonly now: () => string;
  readonly validateForPublication?: (document: unknown) => PublicationValidationResult;
}

function snapshotRevision(value: unknown): UiDocumentRevision {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Payload returned an invalid UI document revision.");
  const record = value as Record<string, unknown>;
  assertJsonValue(record.document);
  const issues = Array.isArray(record.validationIssues) && record.validationIssues.every((item) => typeof item === "string") ? record.validationIssues : [];
  if (!(["string", "number"] as const).includes(typeof record.id as "string" | "number") || ![record.revisionId, record.documentId].every((item) => typeof item === "string") || !Number.isSafeInteger(record.revisionNumber) || (record.revisionNumber as number) < 1) {
    throw new TypeError("Payload returned an invalid UI document revision identity.");
  }
  if (!(["draft", "published", "archived"] as const).includes(record.state as UiDocumentRevisionState) || !(["pending", "valid", "invalid"] as const).includes(record.validationStatus as UiDocumentValidationStatus)) {
    throw new TypeError("Payload returned an invalid UI document revision state.");
  }
  return Object.freeze({
    id: String(record.id),
    revisionId: record.revisionId as string,
    documentId: record.documentId as string,
    revisionNumber: record.revisionNumber as number,
    state: record.state as UiDocumentRevisionState,
    document: structuredClone(record.document),
    validationStatus: record.validationStatus as UiDocumentValidationStatus,
    validationIssues: Object.freeze([...issues]),
    ...(typeof record.previousRevisionId === "string" ? { previousRevisionId: record.previousRevisionId } : {}),
    ...(typeof record.rollbackOfRevisionId === "string" ? { rollbackOfRevisionId: record.rollbackOfRevisionId } : {}),
    ...(typeof record.publishedAt === "string" ? { publishedAt: record.publishedAt } : {})
  });
}

const whereDocument = (documentId: string, state?: UiDocumentRevisionState) => state === undefined
  ? { documentId: { equals: documentId } }
  : { and: [{ documentId: { equals: documentId } }, { state: { equals: state } }] };

export function createPayloadUiDocumentRepository(options: UiDocumentRepositoryOptions) {
  const validate = options.validateForPublication ?? ((document: unknown): PublicationValidationResult => {
    const result = UiDocumentSchema.safeParse(document);
    return result.success ? { success: true, document: result.data } : { success: false, issues: ["INVALID_UI_DOCUMENT"] };
  });
  const findLatest = async (documentId: string, state?: UiDocumentRevisionState, req?: unknown): Promise<UiDocumentRevision | undefined> => {
    const result = await options.payload.find({ collection: UI_DOCUMENT_REVISIONS_SLUG, where: whereDocument(documentId, state), sort: "-revisionNumber", limit: 1, depth: 0, overrideAccess: true, ...(req === undefined ? {} : { req }) });
    return result.docs[0] === undefined ? undefined : snapshotRevision(result.docs[0]);
  };
  const create = async (data: Record<string, unknown>, req?: unknown): Promise<UiDocumentRevision> => snapshotRevision(await options.payload.create({
    collection: UI_DOCUMENT_REVISIONS_SLUG,
    data,
    depth: 0,
    overrideAccess: true,
    ...(req === undefined ? {} : { req })
  }));
  return Object.freeze({
    async saveDraft(input: {
      readonly documentId: string;
      readonly document: unknown;
      readonly validationStatus: UiDocumentValidationStatus;
      readonly validationIssues?: readonly string[];
      readonly req?: unknown;
    }): Promise<UiDocumentRevision> {
      assertJsonValue(input.document);
      const latest = await findLatest(input.documentId, undefined, input.req);
      return create({
        revisionId: options.createRevisionId(),
        documentId: input.documentId,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        state: "draft",
        document: structuredClone(input.document),
        validationStatus: input.validationStatus,
        validationIssues: [...(input.validationIssues ?? [])],
        ...(latest === undefined ? {} : { previousRevisionId: latest.revisionId })
      }, input.req);
    },
    async publishDraft(draftId: string, req?: unknown): Promise<UiDocumentRevision> {
      const draft = snapshotRevision(await options.payload.findByID({ collection: UI_DOCUMENT_REVISIONS_SLUG, id: draftId, depth: 0, overrideAccess: true, ...(req === undefined ? {} : { req }) }));
      if (draft.state !== "draft") throw new TypeError("Only a draft UI document revision can be published.");
      const validation = validate(draft.document);
      if (!validation.success || validation.document === undefined) throw new TypeError(`UI document publication validation failed: ${(validation.issues ?? ["INVALID"]).join(",")}.`);
      const current = await findLatest(draft.documentId, "published", req);
      return create({
        revisionId: options.createRevisionId(),
        documentId: draft.documentId,
        revisionNumber: Math.max(draft.revisionNumber, current?.revisionNumber ?? 0) + 1,
        state: "published",
        document: structuredClone(validation.document),
        validationStatus: "valid",
        validationIssues: [],
        publishedAt: options.now(),
        previousRevisionId: current?.revisionId ?? draft.revisionId
      }, req);
    },
    async getPublished(documentId: string): Promise<UiDocumentRevision | undefined> {
      return findLatest(documentId, "published");
    },
    async listRevisions(documentId: string): Promise<readonly UiDocumentRevision[]> {
      const result = await options.payload.find({ collection: UI_DOCUMENT_REVISIONS_SLUG, where: whereDocument(documentId), sort: "revisionNumber", limit: 100, depth: 0, overrideAccess: true });
      return Object.freeze(result.docs.map(snapshotRevision));
    },
    async rollback(documentId: string, targetRevisionId: string, req?: unknown): Promise<UiDocumentRevision> {
      const result = await options.payload.find({ collection: UI_DOCUMENT_REVISIONS_SLUG, where: { and: [{ documentId: { equals: documentId } }, { revisionId: { equals: targetRevisionId } }, { state: { equals: "published" } }] }, limit: 1, depth: 0, overrideAccess: true });
      const target = result.docs[0] === undefined ? undefined : snapshotRevision(result.docs[0]);
      if (target === undefined) throw new TypeError("Rollback target is not a published revision of this document.");
      const current = await findLatest(documentId, "published", req);
      return create({
        revisionId: options.createRevisionId(),
        documentId,
        revisionNumber: (current?.revisionNumber ?? target.revisionNumber) + 1,
        state: "published",
        document: structuredClone(target.document),
        validationStatus: "valid",
        validationIssues: [],
        publishedAt: options.now(),
        previousRevisionId: current?.revisionId ?? target.revisionId,
        rollbackOfRevisionId: target.revisionId
      }, req);
    }
  });
}

export const uiDocumentRevisionsCollection = Object.freeze({
  slug: UI_DOCUMENT_REVISIONS_SLUG,
  admin: { useAsTitle: "revisionId", defaultColumns: ["documentId", "revisionNumber", "state", "validationStatus"] },
  access: { read: ({ req }: { req: { user?: unknown } }) => req.user != null, create: () => false, update: () => false, delete: () => false },
  versions: false,
  fields: [
    { name: "revisionId", type: "text", required: true, unique: true, index: true },
    { name: "documentId", type: "text", required: true, index: true },
    { name: "revisionNumber", type: "number", required: true, index: true, min: 1 },
    { name: "state", type: "select", required: true, index: true, options: ["draft", "published", "archived"] },
    { name: "document", type: "json", required: true },
    { name: "validationStatus", type: "select", required: true, index: true, options: ["pending", "valid", "invalid"] },
    { name: "validationIssues", type: "json", required: true, defaultValue: [] },
    { name: "previousRevisionId", type: "text", index: true },
    { name: "rollbackOfRevisionId", type: "text", index: true },
    { name: "publishedAt", type: "date", index: true }
  ]
});

export * from "./cms-publication.js";
