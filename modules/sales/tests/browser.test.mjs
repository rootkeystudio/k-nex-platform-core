import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "@k-nex/contracts";

import {
  salesAccountDetailQuery,
  salesAccountsQuery,
  salesCreateTaskMutation,
  salesContactDetailQuery,
  salesContactsQuery,
  salesDedupeCandidatesQuery,
  salesExportCreateMutation,
  salesExportJobDetailQuery,
  salesExportJobListQuery,
  salesImportDryRunMutation,
  salesImportJobDetailQuery,
  salesImportJobListQuery,
  salesLeadDetailQuery,
  salesLeadQualifyMutation,
  salesLeadsQuery,
  salesNoteCreateMutation,
  salesOpportunityDetailQuery,
  salesOpportunitiesQuery,
  salesOpportunityStageMutation,
  salesTasksQuery,
  salesTimelineQuery,
  salesOwnershipAssignMutation,
  salesUpdateTaskMutation,
  salesWorkspacePresentation
} from "../dist/browser.js";
import {
  isSalesRecordId,
  salesCrmDetailInputRuntimeSchema,
  salesAccountDetailDescriptor, salesAccountsDescriptor, salesContactDetailDescriptor, salesContactsDescriptor,
  salesLeadDetailDescriptor, salesLeadsDescriptor, salesOpportunityDetailDescriptor, salesOpportunitiesDescriptor,
  salesLeadDetailOutputRuntimeSchema,
  salesTimelineDescriptor,
  salesOpportunityDetailOutputRuntimeSchema,
  salesOpportunitiesOutputRuntimeSchema,
  salesWorkflowActionInputRuntimeSchemas,
  salesWorkflowActionOutputRuntimeSchemas,
  salesDataMovementActionInputRuntimeSchemas,
  salesDataMovementActionOutputRuntimeSchemas
} from "../dist/contracts.js";

const signal = new AbortController().signal;
const context = {
  surface: "workspace",
  authorizationBoundary: { kind: "actor", actorFingerprint: `sha256:${"a".repeat(64)}` },
  signal
};

test("Sales browser factories use stable platform query/action metadata", async () => {
  assert.deepEqual(salesTasksQuery.source, { id: "sales.tasks", version: 2 });
  assert.deepEqual(salesTasksQuery.selectedFields, ["title", "status"]);
  assert.deepEqual(salesCreateTaskMutation.invalidation.sources, ["sales.tasks"]);
  assert.deepEqual(salesOpportunitiesQuery.source, { id: "sales.opportunities", version: 3 });
  assert.deepEqual(salesOpportunitiesQuery.selectedFields, ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision"]);
  assert.deepEqual(salesOpportunityStageMutation.invalidation.sources, ["sales.opportunities"]);
  assert.deepEqual(salesUpdateTaskMutation.invalidation.sources, ["sales.tasks"]);
  assert.deepEqual([
    salesAccountsQuery.source.id, salesContactsQuery.source.id, salesLeadsQuery.source.id,
    salesAccountDetailQuery.source.id, salesContactDetailQuery.source.id, salesLeadDetailQuery.source.id, salesOpportunityDetailQuery.source.id
  ], ["sales.accounts", "sales.contacts", "sales.leads", "sales.account.detail", "sales.contact.detail", "sales.lead.detail", "sales.opportunity.detail"]);
  assert.equal(salesContactsQuery.selectedFields.includes("email"), false);
  assert.equal(salesLeadsQuery.selectedFields.includes("phone"), false);

  const identity = await salesTasksQuery.identity({}, context);
  assert.match(identity.key, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(identity).includes("actorFingerprint"), true);
});

test("P13.5 browser data movement keeps exact source shapes, nested requests, and invalidations", async () => {
  assert.deepEqual(salesImportJobListQuery.source, { id: "sales.import-job.list", version: 1 });
  assert.deepEqual(salesExportJobDetailQuery.selectedFields, ["id", "state", "artifact-id", "artifact-expires-at", "revision"]);
  assert.deepEqual(salesDedupeCandidatesQuery.selectedFields, ["candidate-id", "candidate-revision", "match-kind"]);
  const calls = [];
  const transport = {
    query: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }),
    mutate: async (request) => { calls.push(request); return request.action.id === "sales.import.dry-run"
      ? { ok: true, data: { importJobId: 4, revision: 2, state: "validated", uploadDigest: `sha256:${"a".repeat(64)}`, acceptedRows: 0, rejectedRows: 1, diagnosticDigest: `sha256:${"b".repeat(64)}` } }
      : { ok: true, data: { exportJobId: 8, revision: 1, state: "queued", snapshotDigest: `sha256:${"c".repeat(64)}`, snapshotRevision: 5, receiptId: "export-receipt" } }; }
  };
  assert.equal((await salesImportJobDetailQuery.execute(transport, { "import-job-id": 4 }, context)).state, "invalid-contract");
  assert.equal((await salesExportJobDetailQuery.execute(transport, { "export-job-id": 4 }, context)).state, "invalid-contract");
  assert.equal((await salesDedupeCandidatesQuery.execute(transport, { "target-object-type": "sales.object.contact", id: 4 }, context)).state, "invalid-contract");
  const dryRun = { request: { uploadArtifactId: "upload-1", targetObjectType: "sales.object.lead", columnMapping: [{ header: "Display name", fieldId: "displayName" }, { header: "Source", fieldId: "source" }], expectedAuthorizationRevision: 3 } };
  assert.equal((await salesImportDryRunMutation.execute(transport, dryRun, { signal, idempotencyKey: "import-1" })).state, "success");
  assert.equal((await salesImportDryRunMutation.execute(transport, { request: { ...dryRun.request, columnMapping: [{ header: "Display name", fieldId: "displayName" }, { header: "Source", fieldId: "displayName" }] } }, { signal, idempotencyKey: "import-2" })).state, "invalid-contract");
  assert.equal((await salesExportCreateMutation.execute(transport, { request: { targetObjectType: "sales.object.account", sourceId: "sales.accounts", sourceVersion: 1, sourceSchemaVersion: 1, selectedFields: ["name", "status"], expectedAuthorizationRevision: 3 } }, { signal, idempotencyKey: "export-1" })).state, "success");
  assert.deepEqual(calls.map(({ action }) => action), [{ id: "sales.import.dry-run", version: 1 }, { id: "sales.export.create", version: 1 }]);
  assert.equal(salesImportDryRunMutation.invalidation.sources.includes("sales.import-job.list"), true);
  assert.equal(salesExportCreateMutation.invalidation.sources.includes("sales.export-job.detail"), true);
  assert.ok(salesDataMovementActionInputRuntimeSchemas["sales.merge.commit"]);
  assert.ok(salesDataMovementActionOutputRuntimeSchemas["sales.export.create"]);
});

test("timeline query omits note body unless caller chooses authorized projection", async () => {
  let request;
  const transport = {
    async query(value) {
      request = value;
      return { ok: true, data: { fields: ["kind", "subject", "status", "occurred-at", "revision"], rows: [{ key: "91", values: { kind: { kind: "text", value: "note" }, subject: { kind: "text", value: "Note" }, status: { kind: "status", value: "recorded" }, "occurred-at": { kind: "text", value: "2026-09-06T00:00:00.000Z" }, revision: { kind: "integer", value: 1 } } }], page: { number: 1, pageSize: 25, hasNext: false } } };
    },
    async mutate() { return { ok: false, problem: { code: "UNUSED", status: 500 } }; }
  };
  const result = await salesTimelineQuery.execute(transport, { "related-record-type": "sales.contact", "related-record-id": "21" }, context);
  assert.equal(result.state, "success");
  assert.deepEqual(request.input, { "related-record-type": "sales.contact", "related-record-id": "21" });
  assert.equal(request.selectedFields.includes("body"), false);
  assert.equal(JSON.stringify(result).includes("private-note-body"), false);
  assert.equal(salesNoteCreateMutation.invalidation.sources.includes("sales.timeline"), true);
});

test("P13.3 browser workflow uses strict registered mutation and complete invalidation", async () => {
  let call;
  const transport = {
    async query() { return { ok: false, problem: { code: "UNUSED", status: 500 } }; },
    async mutate(request) {
      call = request;
      return { ok: true, data: { id: "41", revision: 2, status: "qualified", accountId: "51", contactId: "61", opportunityId: "71" } };
    }
  };
  const result = await salesLeadQualifyMutation.execute(transport, {
    id: "41", expectedRevision: 1, accountMode: "create", accountName: "Acme", contactMode: "create", contactName: "Ada", opportunityName: "Expansion", pipelineId: "11"
  }, { signal, idempotencyKey: "lead-qualify-1" });
  assert.equal(result.state, "success");
  assert.deepEqual(call.action, { id: "sales.lead.qualify", version: 2 });
  assert.equal(salesLeadQualifyMutation.invalidation.sources.includes("sales.accounts"), true);
  assert.equal(salesLeadQualifyMutation.invalidation.sources.includes("sales.opportunities"), true);
  assert.equal((await salesLeadQualifyMutation.execute(transport, { id: "41", expectedRevision: 0 }, { signal, idempotencyKey: "bad" })).state, "invalid-contract");
  for (const input of [
    { id: "41", expectedRevision: 1, accountMode: "link", accountId: "51", contactMode: "create", contactName: "Ada", opportunityName: "Expansion", pipelineId: "11" },
    { id: "41", expectedRevision: 1, accountMode: "link", accountId: "51", contactMode: "link", contactId: "61", opportunityName: "Expansion", pipelineId: "11" }
  ]) assert.equal((await salesLeadQualifyMutation.execute(transport, input, { signal, idempotencyKey: `valid-${input.contactMode}` })).state, "success");
  for (const input of [
    { id: "41", expectedRevision: 1, accountMode: "create", accountName: "Acme", contactMode: "link", contactId: "61", opportunityName: "Expansion", pipelineId: "11" },
    { id: "41", expectedRevision: 1, accountMode: "link", accountName: "Acme", accountId: "51", contactMode: "create", contactName: "Ada", opportunityName: "Expansion", pipelineId: "11" },
    { id: "41", expectedRevision: 1, accountMode: "link", accountId: "01", contactMode: "create", contactName: "Ada", opportunityName: "Expansion", pipelineId: "11" }
  ]) assert.equal((await salesLeadQualifyMutation.execute(transport, input, { signal, idempotencyKey: "invalid-combination" })).state, "invalid-contract");
});

test("ownership assignment keeps team omission exact and rejects null", async () => {
  const calls = [];
  const transport = { query: async () => ({ ok: false, problem: { code: "UNUSED", status: 500 } }), mutate: async (request) => { calls.push(request); return { ok: true, data: { recordType: "sales.account", id: "1", revision: 3, ownerId: "2" } }; } };
  const signal = new AbortController().signal;
  const result = await salesOwnershipAssignMutation.execute(transport, { recordType: "sales.account", id: "1", expectedRevision: 2, ownerId: "2" }, { signal, idempotencyKey: "ownership-1" });
  assert.equal(result.state, "success");
  assert.equal(Object.hasOwn(calls[0].input, "teamId"), false);
  assert.equal(salesOwnershipAssignMutation.invalidation.sources.includes("sales.account.detail"), true);
  assert.deepEqual(await salesOwnershipAssignMutation.execute(transport, { recordType: "sales.account", id: "1", expectedRevision: 2, ownerId: "2", teamId: null }, { signal, idempotencyKey: "ownership-2" }), { state: "invalid-contract" });
});

test("Sales workspace settings drive default routing and source presentation", () => {
  assert.deepEqual(salesWorkspacePresentation({
    defaultTaskPageSize: 50,
    showPotentialRevenue: false,
    defaultPage: "opportunities"
  }), {
    routeId: "sales.route.opportunities",
    taskPageSize: 50,
    showPotentialRevenue: false
  });
});

test("Sales browser factories execute only through injected platform transport", async () => {
  const calls = [];
  const transport = {
    async query(request) {
      calls.push(["query", request.source.id]);
      return { ok: true, data: { fields: ["title", "status"], rows: [], page: { number: 1, pageSize: 25, hasNext: false } } };
    },
    async mutate(request) {
      calls.push(["mutate", request.action.id]);
      return { ok: true, data: { id: "1", title: request.input.title, status: "open", revision: 1 } };
    }
  };
  assert.deepEqual(await salesTasksQuery.execute(transport, {}, context), { state: "empty" });
  assert.deepEqual(await salesCreateTaskMutation.execute(transport, { title: "Follow up" }, { signal, idempotencyKey: "task-1" }), {
    state: "success",
    data: { id: "1", title: "Follow up", status: "open", revision: 1 }
  });
  assert.deepEqual(calls, [["query", "sales.tasks"], ["mutate", "sales.task.create"]]);
});

test("CRM browser boundary accepts only canonical PostgreSQL integer record IDs", async () => {
  assert.equal(isSalesRecordId("2147483647"), true);
  for (const id of ["0", "01", "2147483648", "9007199254740992", "9".repeat(128)]) {
    assert.equal(isSalesRecordId(id), false, id);
    assert.equal(salesCrmDetailInputRuntimeSchema.safeParse({ id }).success, false, id);
  }
  const update = salesWorkflowActionInputRuntimeSchemas["sales.account.update"];
  assert.equal(update.safeParse({ id: "2147483647", expectedRevision: 1, name: "Acme" }).success, true);
  assert.equal(update.safeParse({ id: "2147483648", expectedRevision: 1, name: "Acme" }).success, false);
});

test("opportunity archive status requires the exact status cell contract", () => {
  const data = { fields: ["name", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "revision"], rows: [{ key: "1", values: { name: { kind: "text", value: "Acme" }, "pipeline-id": { kind: "integer", value: 2 }, "pipeline-revision": { kind: "integer", value: 1 }, "stage-id": { kind: "status", value: "00000000-0000-5000-8000-000000000001" }, "stage-name": { kind: "text", value: "Discovery" }, "stage-semantic": { kind: "enum", value: "discovery" }, "stage-revision": { kind: "integer", value: 1 }, revision: { kind: "integer", value: 1 } } }], page: { number: 1, pageSize: 25, hasNext: false } };
  assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse(data).success, true);
  assert.equal(salesOpportunitiesOutputRuntimeSchema.safeParse({ ...data, rows: [{ ...data.rows[0], values: { ...data.rows[0].values, "archive-status": { kind: "status", value: "active" } } }] }).success, false);
});

test("opportunity detail relationship IDs enforce the frozen Postgres range", () => {
  const data = {
    fields: ["name", "owner-id", "team-id", "account-id", "primary-contact-id", "pipeline-id", "pipeline-revision", "stage-id", "stage-name", "stage-semantic", "stage-revision", "archive-status", "revision"],
    rows: [{ key: "1", values: {
      name: { kind: "text", value: "Acme" }, "owner-id": { kind: "text", value: "owner-1" }, "team-id": null,
      "account-id": { kind: "integer", value: 1 }, "primary-contact-id": null, "pipeline-id": { kind: "integer", value: 2 }, "pipeline-revision": { kind: "integer", value: 1 },
      "stage-id": { kind: "status", value: "00000000-0000-5000-8000-000000000001" }, "stage-name": { kind: "text", value: "Qualification" }, "stage-semantic": { kind: "enum", value: "qualification" }, "stage-revision": { kind: "integer", value: 1 }, "archive-status": { kind: "status", value: "active" }, revision: { kind: "integer", value: 1 }
    } }], page: { number: 1, pageSize: 25, hasNext: false }
  };
  assert.equal(salesOpportunityDetailOutputRuntimeSchema.safeParse(data).success, true);
  for (const field of ["account-id", "primary-contact-id", "pipeline-id"]) {
    for (const value of [0, -1, 2_147_483_648]) {
      const forged = structuredClone(data);
      forged.rows[0].values[field] = { kind: "integer", value };
      assert.equal(salesOpportunityDetailOutputRuntimeSchema.safeParse(forged).success, false, `${field}:${value}`);
    }
  }
});

test("Lead detail qualification lineage uses optional canonical Postgres IDs", () => {
  const fields = ["display-name", "source", "owner-id", "team-id", "status", "archive-status", "revision", "decided-at", "qualified-at", "disqualified-at", "qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"];
  const data = { fields, rows: [{ key: "1", values: {
    "display-name": { kind: "text", value: "Qualified lead" },
    source: { kind: "text", value: "Referral" },
    "owner-id": { kind: "text", value: "owner-1" }, "team-id": null,
    status: { kind: "status", value: "qualified" }, "archive-status": { kind: "status", value: "active" }, revision: { kind: "integer", value: 2 },
    "decided-at": { kind: "text", value: "2026-09-06T12:30:00.000Z" },
    "qualified-at": { kind: "text", value: "2026-09-06T12:30:00.000Z" },
    "disqualified-at": null,
    "qualified-account-id": { kind: "integer", value: 2 },
    "qualified-contact-id": { kind: "integer", value: 3 },
    "qualified-opportunity-id": { kind: "integer", value: 2_147_483_647 }
  } }], page: { number: 1, pageSize: 1, hasNext: false } };
  assert.equal(salesLeadDetailOutputRuntimeSchema.safeParse(data).success, true);
  for (const field of ["qualified-account-id", "qualified-contact-id", "qualified-opportunity-id"]) {
    const invalid = structuredClone(data);
    invalid.rows[0].values[field] = { kind: "integer", value: 2_147_483_648 };
    assert.equal(salesLeadDetailOutputRuntimeSchema.safeParse(invalid).success, false, field);
  }
});

test("active CRM source structural hashes cover the frozen compatibility projection", () => {
  for (const descriptor of [salesAccountsDescriptor, salesAccountDetailDescriptor, salesContactsDescriptor, salesContactDetailDescriptor, salesLeadsDescriptor, salesLeadDetailDescriptor, salesOpportunitiesDescriptor, salesOpportunityDetailDescriptor, salesTimelineDescriptor]) {
    const projection = { id: descriptor.id, version: descriptor.version, primaryContract: descriptor.primaryContract, sourceSchema: descriptor.sourceSchema, inputFields: descriptor.inputFields, outputFields: descriptor.outputFields ?? [], paginationModes: descriptor.paginationModes, limits: descriptor.limits };
    assert.equal(descriptor.structuralCompatibilityHash, `sha256:${createHash("sha256").update(canonicalJson(projection)).digest("hex")}`, descriptor.id);
  }
});

test("workflow schemas close canonical stages, instants, IDs, and action-specific outputs", () => {
  const opportunityCreate = salesWorkflowActionInputRuntimeSchemas["sales.opportunity.create"];
  const stageId = "00000000-0000-5000-8000-000000000001";
  const baseOpportunity = { name: "Acme", accountId: "1", pipelineId: "2", expectedPipelineRevision: 1, stageId, expectedStageRevision: 1 };
  assert.equal(opportunityCreate.safeParse(baseOpportunity).success, true);
  assert.equal(opportunityCreate.safeParse({ ...baseOpportunity, primaryContactId: "3", amount: { kind: "money", value: "12", currency: "EUR", scale: 2 }, expectedCloseDate: "2026-09-30" }).success, true);
  assert.equal(opportunityCreate.safeParse({ ...baseOpportunity, amount: { kind: "money", value: "12.345", currency: "EUR", scale: 2 } }).success, false);
  assert.equal(opportunityCreate.safeParse({ ...baseOpportunity, expectedCloseDate: "0000-01-01" }).success, false);
  assert.equal(opportunityCreate.safeParse({ ...baseOpportunity, stageId: "qualification" }).success, false);
  const opportunityUpdate = salesWorkflowActionInputRuntimeSchemas["sales.opportunity.update"];
  const retained = { id: "2", expectedRevision: 1, name: "Renewal", primaryContactMode: "retain", amountMode: "retain", expectedCloseDateMode: "retain" };
  assert.equal(opportunityUpdate.safeParse(retained).success, true);
  assert.equal(opportunityUpdate.safeParse({ ...retained, amountMode: "clear" }).success, true);
  assert.equal(opportunityUpdate.safeParse({ ...retained, amountMode: "set" }).success, false);
  assert.equal(opportunityUpdate.safeParse({ ...retained, amount: { kind: "money", value: "12", currency: "EUR", scale: 2 } }).success, false);
  assert.equal(opportunityUpdate.safeParse({ ...retained, expectedCloseDateMode: "set", expectedCloseDate: "2026-02-29" }).success, false);
  assert.equal(opportunityUpdate.safeParse({ ...retained, expectedCloseDateMode: "set", expectedCloseDate: "0000-01-01" }).success, false);
  for (const actionId of ["sales.contact.update", "sales.lead.update"]) {
    const schema = salesWorkflowActionInputRuntimeSchemas[actionId];
    const base = actionId === "sales.contact.update" ? { id: "1", expectedRevision: 1, displayName: "Ada", emailMode: "retain", phoneMode: "retain" } : { id: "1", expectedRevision: 1, displayName: "Ada", source: "Referral", emailMode: "retain", phoneMode: "retain" };
    assert.equal(schema.safeParse(base).success, true);
    assert.equal(schema.safeParse({ ...base, emailMode: "clear" }).success, true);
    assert.equal(schema.safeParse({ ...base, emailMode: "set", email: "ada@example.test" }).success, true);
    assert.equal(schema.safeParse({ ...base, phoneMode: "set", phone: "p".repeat(64) }).success, true);
    assert.equal(schema.safeParse({ ...base, phoneMode: "set", phone: "p".repeat(65) }).success, false);
    assert.equal(schema.safeParse({ ...base, emailMode: "set" }).success, false);
    assert.equal(schema.safeParse({ ...base, email: "ada@example.test" }).success, false);
  }
  const noteCreate = salesWorkflowActionInputRuntimeSchemas["sales.note.create"];
  assert.equal(noteCreate.safeParse({ relatedRecordType: "sales.account", relatedRecordId: "1", body: "Correction", replacesNoteId: "2" }).success, true);
  assert.equal(noteCreate.safeParse({ relatedRecordType: "sales.account", relatedRecordId: "1", body: "Correction", replacesNoteId: "01" }).success, false);
  const activityCreate = salesWorkflowActionInputRuntimeSchemas["sales.activity.create"];
  const activity = { relatedRecordType: "sales.account", relatedRecordId: "1", type: "call", subject: "Follow up", scheduledAt: "2026-09-06T12:30:00.000Z" };
  assert.equal(activityCreate.safeParse(activity).success, true);
  assert.equal(activityCreate.safeParse({ ...activity, scheduledAt: "2026-09-06 12:30" }).success, false);
  const complete = salesWorkflowActionOutputRuntimeSchemas["sales.activity.complete"];
  assert.equal(complete.safeParse({ id: "2147483647", revision: 2, status: "completed" }).success, true);
  assert.equal(complete.safeParse({ id: "2147483648", revision: 2, status: "completed" }).success, false);
  assert.equal(complete.safeParse({ id: "1", revision: 2, status: "cancelled" }).success, false);
  assert.equal(complete.safeParse({ id: "1", revision: 2, status: "completed", actorId: "hidden" }).success, false);
});
