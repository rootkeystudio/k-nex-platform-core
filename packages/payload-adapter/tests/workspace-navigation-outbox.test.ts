import { canonicalJson } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspaceNavigationOutboxDispatcher, parseWorkspaceNavigationInvalidation } from "../src/workspace-navigation-outbox.js";
import { kNexWorkspacePageSchemaMigration } from "../src/workspace-page-schema-migration.js";

const invalidation = Object.freeze({
  schemaVersion: 1 as const,
  eventId: "ed5c8a6a-522f-4601-a3d5-59b9bd7df7c3",
  eventType: "workspace-navigation.changed" as const,
  operation: "update" as const,
  applicationId: "customer-alpha",
  environment: "production",
  folderId: "customer.folder.reports",
  folderRevision: 2,
  authorizationRevision: 4,
  lifecycleRevision: 2,
  occurredAt: "2026-09-03T12:00:00.000Z"
});

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_id: invalidation.eventId, application_id: invalidation.applicationId, environment: invalidation.environment,
    folder_id: invalidation.folderId, operation_kind: invalidation.operation, folder_revision: invalidation.folderRevision,
    authorization_revision: invalidation.authorizationRevision, lifecycle_revision: invalidation.lifecycleRevision,
    event_json: invalidation, attempt_count: 1, claim_token: "ee2f520a-886a-4ee9-ae0a-3d0988472c90", ...overrides
  };
}

describe("workspace navigation outbox", () => {
  it("migrates durable lease, retry, dead-letter, and identity state", () => {
    const source = String(kNexWorkspacePageSchemaMigration.up);
    for (const fragment of ["k_nex_workspace_navigation_outbox", "folder_revision", "authorization_revision", "lifecycle_revision", "attempt_count", "lease_expires_at", "claim_token", "dead-letter", "expired_lease_idx"]) expect(source).toContain(fragment);
  });

  it("accepts only exact canonical invalidations", () => {
    expect(parseWorkspaceNavigationInvalidation(invalidation)).toEqual(invalidation);
    expect(() => parseWorkspaceNavigationInvalidation({ ...invalidation, extra: true })).toThrow("not canonical");
    expect(() => parseWorkspaceNavigationInvalidation({ ...invalidation, authorizationRevision: -1 })).toThrow("invalid");
    expect(canonicalJson(parseWorkspaceNavigationInvalidation(invalidation))).toBe(canonicalJson(invalidation));
  });

  it("retries a lost notification; next current-store poll remains independent", async () => {
    const query = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row()] }
      : { rows: [], rowCount: text.includes("status='delivered'") ? 1 : 0 });
    const dispatcher = new PostgresWorkspaceNavigationOutboxDispatcher({ query } as never, { applicationId: "customer-alpha", environment: "production", leaseMs: 20, publishTimeoutMs: 10 });
    await expect(dispatcher.dispatchNext({ publish: async () => { throw new Error("lost notification"); } })).rejects.toThrow("lost notification");
    expect(query.mock.calls.some(([text]) => String(text).includes("last_error_code='DELIVERY_FAILED'"))).toBe(true);
    await expect(dispatcher.dispatchNext({ publish: async () => undefined })).resolves.toMatchObject({ status: "delivered", invalidation });
    expect(query.mock.calls.filter(([text]) => String(text).includes("for update skip locked"))).toHaveLength(4);
  });
});
