import { readFileSync } from "node:fs";

import { ActionDescriptorSchema, DataSourceDescriptorSchema, PluginPageTemplateDescriptorSchema, PluginUiContributionDescriptorSchema } from "@k-nex/contracts";
import { describe, expect, it } from "vitest";

import {
  salesDataMovementActionInputRuntimeSchemas,
  salesDataMovementActionOutputRuntimeSchemas,
  salesDedupeCandidatesDescriptor,
  salesDedupeCandidatesOutputRuntimeSchema,
  salesExportJobDetailDescriptor,
  salesExportJobDetailOutputRuntimeSchema,
  salesExportJobListDescriptor,
  salesExportsBlockDescriptor,
  salesExportsPageTemplate,
  salesImportJobDetailDescriptor,
  salesImportJobListDescriptor,
  salesImportsBlockDescriptor,
  salesImportsPageTemplate,
  salesMergeCommitDescriptor
} from "../src/contracts.js";
import { salesExportJobsCollection, salesImportChunksCollection, salesImportJobsCollection, salesImportRowsCollection, salesMergeLineageCollection } from "../src/crm-core.js";
import {
  SalesDataMovementError,
  buildSalesExportCsv,
  normalizeSalesDedupeValue,
  parseSalesImportCsv,
  planSalesMerge,
  salesCrmActionDescriptors,
  salesMergeRelationIds
} from "../src/server.js";

const frozen = JSON.parse(readFileSync(new URL("../../../contracts/phase-13-crm-product-contract.v1.json", import.meta.url), "utf8")) as { dataSemantics: { dataMovement: { descriptors: { actions: Record<string, unknown>; sources: Record<string, unknown>; pages: readonly unknown[]; contributions: readonly unknown[] } } } };
const csv = (value: string) => new TextEncoder().encode(value);
const expectCode = (run: () => unknown, code: string) => expect(run).toThrowError(expect.objectContaining({ code }));

describe("P13.5 Sales domain", () => {
  it("registers the exact controlled movement descriptors", () => {
    const movement = frozen.dataSemantics.dataMovement.descriptors;
    for (const descriptor of salesCrmActionDescriptors.filter(({ id }) => Object.hasOwn(movement.actions, id))) {
      expect(ActionDescriptorSchema.parse(descriptor)).toEqual(movement.actions[descriptor.id]);
    }
    for (const descriptor of [salesImportJobListDescriptor, salesImportJobDetailDescriptor, salesExportJobListDescriptor, salesExportJobDetailDescriptor, salesDedupeCandidatesDescriptor]) {
      expect(DataSourceDescriptorSchema.parse(descriptor)).toEqual(movement.sources[descriptor.id]);
    }
    expect([salesImportsPageTemplate, salesExportsPageTemplate].map(PluginPageTemplateDescriptorSchema.parse)).toEqual(movement.pages);
    expect([salesImportsBlockDescriptor, salesExportsBlockDescriptor].map(PluginUiContributionDescriptorSchema.parse)).toEqual(movement.contributions);
  });

  it("maps protected movement persistence to the frozen job, row, chunk, export, and lineage records", () => {
    const names = (collection: { readonly fields: readonly { readonly name?: string }[] }) => collection.fields.map(({ name }) => name).filter((name): name is string => name !== undefined);
    expect(names(salesImportJobsCollection)).toEqual(["applicationId", "environment", "actorId", "targetObjectType", "uploadArtifactId", "uploadDigest", "mappingCanonicalJson", "mappingDigest", "schemaRevision", "authorizationRevision", "lifecycleRevision", "scopeRevision", "fieldGrants", "permissionGrants", "state", "revision", "acceptedRows", "rejectedRows", "diagnosticArtifactId", "diagnosticDigest", "receiptId"]);
    expect(names(salesImportChunksCollection)).toEqual(["importJobId", "chunkIndex", "rowStart", "rowEndExclusive", "inputDigest", "state", "attempt", "workerGenerationId", "workerFencingToken", "workerPromotionRevision", "workerLeaseOwner", "leaseRevision", "leaseExpiresAt", "completedAt", "resultDigest"]);
    expect(names(salesImportRowsCollection)).toEqual(["importJobId", "oneBasedDataRow", "rowDigest", "canonicalMappedJson", "mappedDigest", "outcome", "targetRecordId", "diagnosticCode"]);
    expect(names(salesExportJobsCollection)).toEqual(["applicationId", "environment", "actorId", "targetObjectType", "sourceId", "sourceVersion", "sourceSchemaVersion", "queryCanonicalJson", "queryDigest", "selectedFields", "authorizationRevision", "lifecycleRevision", "scopeRevision", "fieldGrants", "permissionGrants", "snapshotRevision", "snapshotDigest", "state", "revision", "rowCount", "workerGenerationId", "workerFencingToken", "workerPromotionRevision", "workerLeaseOwner", "leaseRevision", "leaseExpiresAt", "attempt", "artifactId", "artifactDigest", "receiptId"]);
    expect(names(salesMergeLineageCollection)).toEqual(["applicationId", "environment", "lineageId", "targetObjectType", "winnerId", "winnerPreRevision", "winnerPostRevision", "loserId", "loserPreRevision", "loserPostRevision", "matchKind", "normalizerVersion", "actorId", "authorizationRevision", "winnerPreDigest", "winnerPostDigest", "loserPreDigest", "loserPostDigest", "rewrittenRelationCounts", "committedAt", "lineageDigest"]);
  });

  it("strictly validates RFC4180, mappings, limits, formula cells, and deterministic chunks", () => {
    const input = csv("Name,Source,Email\r\nAlice,Referral,alice@example.com\r\nBob,Event,\r\n");
    const result = parseSalesImportCsv(input, "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }, { header: "Email", fieldId: "email" }]);
    expect(result.acceptedRows).toBe(2); expect(result.rejectedRows).toBe(0); expect(result.rows[1]?.values.email).toBeNull(); expect(result.chunks).toEqual([{ chunkIndex: 0, rowStart: 0, rowEndExclusive: 2, state: "queued", attempt: 0, leaseRevision: 1 }]);
    expect(() => parseSalesImportCsv(csv("Name,Source\nAlice,Referral\n"), "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }])).toThrowError(expect.objectContaining({ code: "IMPORT_INVALID_CSV" }));
    expect(() => parseSalesImportCsv(csv("Name,Source\r\nAlice,\u00a0=1+1\r\n"), "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }])).toThrowError(expect.objectContaining({ code: "IMPORT_UNSAFE_FORMULA" }));
    expect(() => parseSalesImportCsv(csv("Name,Owner\r\nAlice,x\r\n"), "sales.object.account", [{ header: "Name", fieldId: "name" }, { header: "Owner", fieldId: "ownerId" }])).toThrowError(expect.objectContaining({ code: "IMPORT_PROTECTED_FIELD" }));
  });

  it("rejects malformed syntax, invalid encoding, and every formula-leading prefix", () => {
    for (const malformed of ["", "Name\r\n", "Name\nAlice\n", "Name\rAlice\r", "Name\r\n\"Alice\r\n", "Name\r\n\"Alice\"x\r\n"]) {
      expectCode(() => parseSalesImportCsv(csv(malformed), "sales.object.account", [{ header: "Name", fieldId: "name" }]), "IMPORT_INVALID_CSV");
    }
    expectCode(() => parseSalesImportCsv(csv("Name,Extra\r\nonly-one\r\n"), "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Extra", fieldId: "source" }]), "IMPORT_INVALID_CSV");
    expectCode(() => parseSalesImportCsv(Uint8Array.from([0xff, 0xfe, 0x00]), "sales.object.account", [{ header: "Name", fieldId: "name" }]), "IMPORT_INVALID_ENCODING");
    for (const prefix of ["=", "+", "-", "@"]) {
      for (const leading of ["", "\u0000", "\u0009", "\u0085", "\u00a0", "\u2007", "\u202f", "\u3000"])
        expectCode(() => parseSalesImportCsv(csv(`Name\r\n"${leading}${prefix}unsafe"\r\n`), "sales.object.account", [{ header: "Name", fieldId: "name" }]), "IMPORT_UNSAFE_FORMULA");
    }
    expectCode(() => parseSalesImportCsv(csv("\u00a0=Name\r\nACME\r\n"), "sales.object.account", [{ header: "\u00a0=Name", fieldId: "name" }]), "IMPORT_UNSAFE_FORMULA");
  });

  it("accepts only the optional BOM and enforces file, row, column, and cell limits", () => {
    const plain = csv("Name\r\nACME\r\n"); const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...plain]);
    expect(parseSalesImportCsv(bom, "sales.object.account", [{ header: "Name", fieldId: "name" }]).uploadDigest).toBe(parseSalesImportCsv(plain, "sales.object.account", [{ header: "Name", fieldId: "name" }]).uploadDigest);
    expectCode(() => parseSalesImportCsv(new Uint8Array(16_777_217), "sales.object.account", [{ header: "Name", fieldId: "name" }]), "IMPORT_LIMIT_EXCEEDED");
    const tooManyRows = `Name\r\n${"x\r\n".repeat(10_001)}`;
    expectCode(() => parseSalesImportCsv(csv(tooManyRows), "sales.object.account", [{ header: "Name", fieldId: "name" }]), "IMPORT_LIMIT_EXCEEDED");
    const headers = Array.from({ length: 65 }, (_, index) => `H${index}`);
    expectCode(() => parseSalesImportCsv(csv(`${headers.join(",")}\r\n${headers.map(() => "x").join(",")}\r\n`), "sales.object.account", headers.map((header, index) => ({ header, fieldId: index === 0 ? "name" : `field${index}` }))), "IMPORT_LIMIT_EXCEEDED");
    expectCode(() => parseSalesImportCsv(csv(`Name\r\n${"x".repeat(16_385)}\r\n`), "sales.object.account", [{ header: "Name", fieldId: "name" }]), "IMPORT_LIMIT_EXCEEDED");
    const bounded = parseSalesImportCsv(csv(`Name\r\n${"x\r\n".repeat(251)}`), "sales.object.account", [{ header: "Name", fieldId: "name" }]);
    expect(bounded.chunks.map(({ rowStart, rowEndExclusive }) => [rowStart, rowEndExclusive])).toEqual([[0, 250], [250, 251]]);
  });

  it("rejects protected, duplicate, missing-required, and target-crossed mappings", () => {
    const lead = csv("Name,Source\r\nAlice,Referral\r\n");
    expectCode(() => parseSalesImportCsv(lead, "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "displayName" }]), "IMPORT_MAPPING_INVALID");
    expectCode(() => parseSalesImportCsv(lead, "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Name", fieldId: "source" }]), "IMPORT_MAPPING_INVALID");
    expectCode(() => parseSalesImportCsv(lead, "sales.object.lead", [{ header: "Name", fieldId: "displayName" }, { header: "Source", fieldId: "email" }]), "IMPORT_MAPPING_INVALID");
    expectCode(() => parseSalesImportCsv(csv("Name,Revision\r\nAlice,2\r\n"), "sales.object.account", [{ header: "Name", fieldId: "name" }, { header: "Revision", fieldId: "revision" }]), "IMPORT_PROTECTED_FIELD");
    expectCode(() => parseSalesImportCsv(csv("Name\r\nACME\r\n"), "sales.object.contact", [{ header: "Name", fieldId: "displayName" }]), "IMPORT_MAPPING_INVALID");
    expectCode(() => parseSalesImportCsv(csv("Náme,Na\u0301me\r\nA,B\r\n"), "sales.object.account", [{ header: "Náme", fieldId: "name" }, { header: "Na\u0301me", fieldId: "name" }]), "IMPORT_INVALID_CSV");
  });

  it("records safe row diagnostics without persisting invalid values", () => {
    const required = parseSalesImportCsv(csv("Name,Account\r\n,7\r\n"), "sales.object.contact", [{ header: "Name", fieldId: "displayName" }, { header: "Account", fieldId: "accountId" }]);
    expect(required).toMatchObject({ acceptedRows: 0, rejectedRows: 1, diagnostics: [{ oneBasedDataRow: 1, code: "IMPORT_REQUIRED_VALUE" }], rows: [] });
    for (const account of ["0", "01", " 1", "1 ", "9007199254740992", "1.0"])
      expect(parseSalesImportCsv(csv(`Name,Account\r\nAlice,${account}\r\n`), "sales.object.contact", [{ header: "Name", fieldId: "displayName" }, { header: "Account", fieldId: "accountId" }])).toMatchObject({ acceptedRows: 0, rejectedRows: 1, diagnostics: [{ code: "IMPORT_VALUE_INVALID" }] });
    expectCode(() => parseSalesImportCsv(csv("Name,Account\r\nAlice,+1\r\n"), "sales.object.contact", [{ header: "Name", fieldId: "displayName" }, { header: "Account", fieldId: "accountId" }]), "IMPORT_UNSAFE_FORMULA");
  });

  it("closes request variants and duplicate field selection", () => {
    expect(salesDataMovementActionInputRuntimeSchemas["sales.import.dry-run"]?.safeParse({ request: { uploadArtifactId: "u", targetObjectType: "sales.object.account", columnMapping: [{ header: "Name", fieldId: "name" }], expectedAuthorizationRevision: 1 } }).success).toBe(true);
    expect(salesDataMovementActionInputRuntimeSchemas["sales.export.create"]?.safeParse({ request: { targetObjectType: "sales.object.account", sourceId: "sales.contacts", sourceVersion: 1, sourceSchemaVersion: 1, selectedFields: ["name"], expectedAuthorizationRevision: 1 } }).success).toBe(false);
    expect(salesDataMovementActionInputRuntimeSchemas["sales.export.create"]?.safeParse({ request: { targetObjectType: "sales.object.account", sourceId: "sales.accounts", sourceVersion: 1, sourceSchemaVersion: 1, selectedFields: ["name", "name"], expectedAuthorizationRevision: 1 } }).success).toBe(false);
    expect(salesMergeCommitDescriptor.effect).toBe("destructive");
  });

  it("closes movement source cells and action evidence", () => {
    const page = { number: 1, pageSize: 100, hasNext: false };
    expect(salesDedupeCandidatesOutputRuntimeSchema.safeParse({ fields: ["candidate-id", "candidate-revision", "match-kind"], rows: [{ key: "candidate", values: { "candidate-id": { kind: "integer", value: 9_007_199_254_740_991 }, "candidate-revision": { kind: "integer", value: 2 }, "match-kind": { kind: "enum", value: "contact-email" } } }], page }).success).toBe(true);
    expect(salesDedupeCandidatesOutputRuntimeSchema.safeParse({ fields: ["candidate-id", "candidate-revision", "match-kind"], rows: [{ key: "candidate", values: { "candidate-id": { kind: "integer", value: 1 }, "candidate-revision": { kind: "integer", value: 2 }, "match-kind": { kind: "enum", value: "heuristic" } } }], page }).success).toBe(false);
    expect(salesExportJobDetailOutputRuntimeSchema.safeParse({ fields: ["id", "state", "artifact-id", "artifact-expires-at", "revision"], rows: [{ key: "export", values: { id: { kind: "integer", value: 1 }, state: { kind: "status", value: "succeeded" }, "artifact-id": { kind: "resource", resourceType: "sales.export-artifact", id: "artifact-1", label: "Download", route: { routeId: "sales.route.exports", params: { exportJobId: "1" } } }, "artifact-expires-at": { kind: "datetime", value: "2026-10-07T00:00:00.000Z" }, revision: { kind: "integer", value: 2 } } }], page }).success).toBe(true);
    expect(salesExportJobDetailOutputRuntimeSchema.safeParse({ fields: ["id", "state", "artifact-id", "artifact-expires-at", "revision"], rows: [{ key: "export", values: { id: { kind: "integer", value: 1 }, state: { kind: "status", value: "partial" }, "artifact-id": null, "artifact-expires-at": null, revision: { kind: "integer", value: 2 } } }], page }).success).toBe(false);
    const dryRun = { importJobId: 1, revision: 2, state: "validated", uploadDigest: `sha256:${"a".repeat(64)}`, acceptedRows: 1, rejectedRows: 0, diagnosticDigest: `sha256:${"b".repeat(64)}` };
    expect(salesDataMovementActionOutputRuntimeSchemas["sales.import.dry-run"]?.safeParse(dryRun).success).toBe(true);
    expect(salesDataMovementActionOutputRuntimeSchemas["sales.import.dry-run"]?.safeParse({ ...dryRun, uploadDigest: `sha256:${"G".repeat(64)}` }).success).toBe(false);
    expect(salesDataMovementActionOutputRuntimeSchemas["sales.import.dry-run"]?.safeParse({ ...dryRun, acceptedRows: 10_000, rejectedRows: 1 }).success).toBe(false);
  });

  it("uses pinned dedupe normalization and preserves merge direction and lineage", () => {
    expect(normalizeSalesDedupeValue("account-name", " ACME\u00a0Corp ")).toBe("acme corp");
    expect(normalizeSalesDedupeValue("contact-email", " USER@Example.COM ")).toBe("user@example.com");
    expect(normalizeSalesDedupeValue("contact-phone", "+90 (555) 123-4567")).toBe("905551234567");
    expect(normalizeSalesDedupeValue("account-name", "\ufeffACME\ufeff")).toBe("\ufeffacme\ufeff");
    const base = { applicationId: "customer-gate-1", environment: "production", status: "active", accountId: 7, email: "A@EXAMPLE.COM", phone: "+90 555 123 4567" };
    const counts = Object.fromEntries(salesMergeRelationIds["sales.object.contact"].map((id, index) => [id, index]));
    const result = planSalesMerge({ targetObjectType: "sales.object.contact", winner: { ...base, id: 10, revision: 3, displayName: "Winner" }, winnerExpectedRevision: 3, loser: { ...base, id: 11, revision: 4, displayName: "Loser" }, loserExpectedRevision: 4, actorId: "user-1", authorizationRevision: 9, lineageId: "lineage-1", committedAt: "2026-09-07T00:00:00.000Z", relationCounts: counts });
    expect(result.winnerPost).toMatchObject({ id: 10, revision: 4, displayName: "Winner", status: "active" });
    expect(result.loserPost).toMatchObject({ id: 11, revision: 5, status: "merged", mergedIntoId: 10 });
    expect(result.lineage).toMatchObject({ winnerId: 10, loserId: 11, matchKind: "contact-email-and-phone", rewrittenRelationCounts: salesMergeRelationIds["sales.object.contact"].map((relationId, count) => ({ relationId, count })) });
    expect(result.lineageDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects invalid dedupe values and unsafe merge substitutions", () => {
    expect(normalizeSalesDedupeValue("contact-phone", "123456")).toBeNull();
    expect(normalizeSalesDedupeValue("contact-phone", "+12 (345) 678-9012-3456")).toBeNull();
    expect(normalizeSalesDedupeValue("contact-email", " User+tag@Example.COM ")).toBe("user+tag@example.com");
    const base = { applicationId: "app", environment: "production", status: "active", accountId: 7, email: "a@example.com", phone: "905551234567", revision: 1 };
    const counts = Object.fromEntries(salesMergeRelationIds["sales.object.contact"].map((id) => [id, 0]));
    const merge = (winner: Record<string, unknown>, loser: Record<string, unknown>, relationCounts = counts, winnerExpectedRevision = 1, loserExpectedRevision = 1) => planSalesMerge({ targetObjectType: "sales.object.contact", winner, winnerExpectedRevision, loser, loserExpectedRevision, actorId: "user-1", authorizationRevision: 1, lineageId: "lineage", committedAt: "2026-09-07T00:00:00.000Z", relationCounts });
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 1 }), "STALE_RECORD");
    expectCode(() => merge({ ...base, id: 1, status: "merged" }, { ...base, id: 2 }), "STALE_RECORD");
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 2, environment: "staging" }), "STALE_RECORD");
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 2, accountId: 8 }), "ACTION_FORBIDDEN");
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 2 }, { ...counts, [salesMergeRelationIds["sales.object.contact"][0]!]: -1 }), "ACTION_FORBIDDEN");
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 2 }, Object.fromEntries(Object.entries(counts).slice(1))), "ACTION_FORBIDDEN");
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 2 }, { ...counts, unexpected: 0 }), "ACTION_FORBIDDEN");
    expectCode(() => merge({ ...base, id: 1 }, { ...base, id: 2 }, counts, 2), "STALE_RECORD");
  });

  it("emits exact neutralized RFC4180 export bytes", () => {
    expect(new TextDecoder().decode(buildSalesExportCsv(["name"], []))).toBe("name\r\n");
    expect(new TextDecoder().decode(buildSalesExportCsv(["name", "note"], [{ name: "ACME", note: "\u00a0=cmd" }, { name: "A, B", note: null }]))).toBe("name,note\r\nACME,'\u00a0=cmd\r\n\"A, B\",\r\n");
    expect(() => buildSalesExportCsv(["name"], Array.from({ length: 10_001 }, () => ({ name: "x" })))).toThrow(SalesDataMovementError);
    for (const prefix of ["=", "+", "-", "@"])
      expect(new TextDecoder().decode(buildSalesExportCsv(["value"], [{ value: `\u0085${prefix}unsafe` }]))).toBe(`value\r\n'\u0085${prefix}unsafe\r\n`);
    expectCode(() => buildSalesExportCsv(["name", "name"], []), "IMPORT_LIMIT_EXCEEDED");
    expectCode(() => buildSalesExportCsv(Array.from({ length: 9 }, (_, index) => `f${index}`), []), "IMPORT_LIMIT_EXCEEDED");
    expectCode(() => buildSalesExportCsv(["value"], [{ value: "x".repeat(16_777_216) }]), "IMPORT_LIMIT_EXCEEDED");
  });
});
