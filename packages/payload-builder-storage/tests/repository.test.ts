import { describe, expect, it } from "vitest";

import { createPayloadUiDocumentRepository, uiDocumentRevisionsCollection } from "../src/index.js";

const document = (version: number) => ({ schemaVersion: 1, id: "cms.home", version, profile: "cms", regions: { main: [] } });

function storage() {
  const records: Record<string, any>[] = [];
  let id = 0;
  const matches = (record: Record<string, any>, where: any): boolean => {
    if (where.and) return where.and.every((part: any) => matches(record, part));
    return Object.entries(where).every(([key, condition]: [string, any]) => record[key] === condition.equals);
  };
  return {
    records,
    port: {
      async create(input: any) {
        const record = { id: `row-${++id}`, ...structuredClone(input.data) };
        records.push(record);
        return record;
      },
      async find(input: any) {
        const sign = String(input.sort ?? "").startsWith("-") ? -1 : 1;
        const field = String(input.sort ?? "revisionNumber").replace(/^-/, "");
        return { docs: records.filter((record) => matches(record, input.where)).sort((a, b) => sign * (a[field] - b[field])).slice(0, input.limit) };
      },
      async findByID(input: any) { return records.find((record) => record.id === input.id); }
    }
  };
}

describe("Payload UiDocumentRepository", () => {
  it("stores drafts, immutable publication copies, lineage, query order, and rollback copies", async () => {
    const fake = storage();
    let revision = 0;
    const repository = createPayloadUiDocumentRepository({ payload: fake.port, createRevisionId: () => `ui-revision.${++revision}`, now: () => "2026-08-27T00:00:00.000Z" });
    const firstDraft = await repository.saveDraft({ documentId: "cms.home", document: document(1), validationStatus: "valid" });
    const firstPublished = await repository.publishDraft(firstDraft.id);
    const secondDraft = await repository.saveDraft({ documentId: "cms.home", document: document(2), validationStatus: "valid" });
    const secondPublished = await repository.publishDraft(secondDraft.id);
    const rolledBack = await repository.rollback("cms.home", firstPublished.revisionId);
    expect(firstPublished.document).toEqual(document(1));
    expect(secondPublished.document).toEqual(document(2));
    expect(rolledBack.document).toEqual(document(1));
    expect(rolledBack).toMatchObject({ previousRevisionId: secondPublished.revisionId, rollbackOfRevisionId: firstPublished.revisionId });
    expect(await repository.getPublished("cms.home")).toEqual(rolledBack);
    expect((await repository.listRevisions("cms.home")).map(({ revisionNumber }) => revisionNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(Object.isFrozen(firstPublished)).toBe(true);
  });

  it("fails closed for invalid publication and cross-document rollback", async () => {
    const fake = storage();
    let revision = 0;
    const repository = createPayloadUiDocumentRepository({ payload: fake.port, createRevisionId: () => `ui-revision.${++revision}`, now: () => "2026-08-27T00:00:00.000Z" });
    const invalid = await repository.saveDraft({ documentId: "cms.home", document: { invalid: true }, validationStatus: "invalid", validationIssues: ["INVALID"] });
    await expect(repository.publishDraft(invalid.id)).rejects.toThrow(/validation/);
    await expect(repository.rollback("cms.other", "ui-revision.unknown")).rejects.toThrow(/target/);
  });

  it("declares the bounded Payload collection indexes and denies direct mutation", () => {
    const fields = new Map((uiDocumentRevisionsCollection.fields as any[]).map((field) => [field.name, field]));
    for (const name of ["revisionId", "documentId", "revisionNumber", "state", "validationStatus", "previousRevisionId", "rollbackOfRevisionId", "publishedAt"]) expect(fields.get(name)?.index).toBe(true);
    expect(uiDocumentRevisionsCollection.access.create()).toBe(false);
    expect(uiDocumentRevisionsCollection.access.update()).toBe(false);
    expect(uiDocumentRevisionsCollection.access.delete()).toBe(false);
  });
});
