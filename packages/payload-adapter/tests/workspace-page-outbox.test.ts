import { canonicalJson } from "@k-nex/contracts";
import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspacePageOutboxDispatcher, WorkspacePageOutboxWorker, parseWorkspacePageInvalidation } from "../src/workspace-page-outbox.js";
import { kNexWorkspacePageSchemaMigration } from "../src/workspace-page-schema-migration.js";

const invalidation = Object.freeze({
  schemaVersion: 1 as const,
  eventId: "ed5c8a6a-522f-4601-a3d5-59b9bd7df7c3",
  eventType: "workspace-page.changed" as const,
  operation: "access" as const,
  applicationId: "customer-alpha",
  environment: "production",
  pageId: "workspace.page.alpha",
  pageRevision: 5,
  workingCopyRevision: 3,
  accessRevision: 2,
  authorizationRevision: 4,
  lifecycleRevision: 6,
  catalogRevision: 6,
  catalogDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  authorityDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  occurredAt: "2026-09-03T12:00:00.000Z"
});

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_id: invalidation.eventId, application_id: invalidation.applicationId, environment: invalidation.environment,
    page_id: invalidation.pageId, operation_kind: invalidation.operation, page_revision: invalidation.pageRevision,
    event_json: invalidation, attempt_count: 1, claim_token: "ee2f520a-886a-4ee9-ae0a-3d0988472c90", ...overrides
  };
}

describe("workspace page outbox", () => {
  it("requires a canonical application/environment identity", () => {
    expect(() => new PostgresWorkspacePageOutboxDispatcher({ query: vi.fn() } as never, { applicationId: "customer-alpha", environment: "Production" })).toThrow("identity is invalid");
  });

  it("migrates durable lease, retry, and dead-letter state", () => {
    const source = String(kNexWorkspacePageSchemaMigration.up);
    for (const fragment of ["attempt_count", "lease_expires_at", "claim_token", "dead_lettered_at", "dead-letter", "expired_lease_idx"]) expect(source).toContain(fragment);
  });

  it("accepts only the exact canonical invalidation shape", () => {
    expect(parseWorkspacePageInvalidation(invalidation)).toEqual(invalidation);
    expect(() => parseWorkspacePageInvalidation({ ...invalidation, extra: true })).toThrow("not canonical");
    expect(canonicalJson(parseWorkspacePageInvalidation(invalidation))).toBe(canonicalJson(invalidation));
  });

  it("claims, publishes, and acknowledges one persisted identity", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("returning event.event_id")) return { rows: [row()] };
      if (text.startsWith("update k_nex_workspace_page_outbox set status='delivered'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const publish = vi.fn(async () => undefined);
    const dispatcher = new PostgresWorkspacePageOutboxDispatcher({ query } as never, { applicationId: "customer-alpha", environment: "production", leaseMs: 20, publishTimeoutMs: 10 });

    await expect(dispatcher.dispatchNext({ publish })).resolves.toMatchObject({ status: "delivered", invalidation });
    expect(publish).toHaveBeenCalledWith(invalidation, expect.any(AbortSignal));
    expect(query.mock.calls.some(([text]) => String(text).includes("for update skip locked"))).toBe(true);
    const selectionCalls = query.mock.calls.filter(([text]) => String(text).includes("with candidate as"));
    expect(selectionCalls).toHaveLength(2);
    expect(selectionCalls[0]?.[1]).toEqual([3, "customer-alpha", "production"]);
    expect(selectionCalls[1]?.[1]?.slice(0, 4)).toEqual([3, "customer-alpha", "production", 20]);
    expect(selectionCalls.every(([text]) => String(text).includes("application_id=$2 and environment=$3"))).toBe(true);
  });

  it("retries malformed events and dead-letters exhausted publication", async () => {
    const malformedQuery = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row({ event_json: { ...invalidation, pageRevision: 4 } })] }
      : { rows: [], rowCount: 0 });
    const malformed = new PostgresWorkspacePageOutboxDispatcher({ query: malformedQuery } as never, { applicationId: "customer-alpha", environment: "production", leaseMs: 20, publishTimeoutMs: 10 });
    await expect(malformed.dispatchNext({ publish: async () => undefined })).rejects.toThrow("does not match");
    expect(malformedQuery.mock.calls.some(([text]) => String(text).includes("last_error_code='DELIVERY_FAILED'"))).toBe(true);

    const terminalQuery = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row({ attempt_count: 1 })] }
      : { rows: [], rowCount: 0 });
    const terminal = new PostgresWorkspacePageOutboxDispatcher({ query: terminalQuery } as never, { applicationId: "customer-alpha", environment: "production", maxAttempts: 1, leaseMs: 20, publishTimeoutMs: 10 });
    await expect(terminal.dispatchNext({ publish: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect(terminalQuery.mock.calls.some(([, values]) => values?.[2] === "dead-letter")).toBe(true);
  });

  it("owns one bounded worker loop", async () => {
    const scheduled: Array<() => void> = [];
    const dispatchNext = vi.fn().mockResolvedValueOnce({ status: "delivered", eventId: invalidation.eventId, invalidation }).mockResolvedValue({ status: "idle" });
    const worker = new WorkspacePageOutboxWorker({ dispatchNext } as never, { publish: vi.fn() }, {
      intervalMs: 10, schedule: (work) => { scheduled.push(work); return work; }, cancel: vi.fn()
    });
    worker.start();
    await vi.waitFor(() => expect(dispatchNext).toHaveBeenCalledTimes(2));
    expect(scheduled).toHaveLength(1);
    worker.stop();
    expect(worker.started).toBe(false);
  });
});
