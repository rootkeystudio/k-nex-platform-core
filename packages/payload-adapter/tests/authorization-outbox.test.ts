import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationOutboxWorker,
  PostgresAuthorizationOutboxDispatcher,
  writeAuthorizationInvalidationOutbox
} from "../src/authorization-outbox.js";
import { canonicalJson } from "@k-nex/contracts";

const invalidation = {
  applicationId: "customer-alpha", environment: "production", scope: "application", authorizationRevision: 5, lifecycleRevision: 3
} as const;

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_id: "ed5c8a6a-522f-4601-a3d5-59b9bd7df7c3", application_id: invalidation.applicationId,
    environment: invalidation.environment, authorization_revision: invalidation.authorizationRevision,
    lifecycle_revision: invalidation.lifecycleRevision, event_json: invalidation, attempt_count: 1,
    claim_token: "ee2f520a-886a-4ee9-ae0a-3d0988472c90", ...overrides
  };
}

describe("authorization outbox", () => {
  it("writes one canonical opaque event for an exact revision pair", async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    await writeAuthorizationInvalidationOutbox({ query } as never, invalidation);
    await writeAuthorizationInvalidationOutbox({ query } as never, invalidation);

    expect(query).toHaveBeenCalledTimes(2);
    for (const [text, values] of query.mock.calls) {
      expect(String(text)).toContain("on conflict (application_id, environment, authorization_revision, lifecycle_revision) do nothing");
      expect(values?.slice(1)).toEqual([
        invalidation.applicationId, invalidation.environment, invalidation.authorizationRevision, invalidation.lifecycleRevision,
        canonicalJson(invalidation)
      ]);
      expect(values?.[0]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("publishes only the opaque persisted event and acknowledges its claim", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("returning event.event_id")) return { rows: [row()] };
      if (text.startsWith("update k_nex_authorization_outbox\n         set status='delivered'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const dispatcher = new PostgresAuthorizationOutboxDispatcher({ query } as never, { applicationId: "customer-alpha", leaseMs: 20, publishTimeoutMs: 10 });
    const publish = vi.fn(async () => undefined);

    await expect(dispatcher.dispatchNext({ publish })).resolves.toMatchObject({ status: "delivered", invalidation });
    expect(publish).toHaveBeenCalledWith(invalidation, expect.any(AbortSignal));
    expect(query.mock.calls.some(([text]) => String(text).includes("for update skip locked"))).toBe(true);
    expect(query.mock.calls.find(([text]) => String(text).includes("returning event.event_id"))?.[1]?.slice(0, 2)).toEqual([3, "customer-alpha"]);
  });

  it("releases malformed and timed-out claims for retry or dead-letter handling", async () => {
    const malformedQuery = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row({ event_json: { ...invalidation, authorizationRevision: 4 } })] }
      : { rows: [], rowCount: 0 });
    const malformed = new PostgresAuthorizationOutboxDispatcher({ query: malformedQuery } as never, { applicationId: "customer-alpha", leaseMs: 20, publishTimeoutMs: 10 });

    await expect(malformed.dispatchNext({ publish: async () => undefined })).rejects.toThrow("does not match");
    expect(malformedQuery.mock.calls.some(([text]) => String(text).includes("last_error_code='DELIVERY_FAILED'"))).toBe(true);

    const timeoutQuery = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row()] }
      : { rows: [], rowCount: 0 });
    const timeout = new PostgresAuthorizationOutboxDispatcher({ query: timeoutQuery } as never, { applicationId: "customer-alpha", leaseMs: 20, publishTimeoutMs: 5 });

    await expect(timeout.dispatchNext({ publish: async () => new Promise<void>(() => {}) })).rejects.toThrow("timed out");
    expect(timeoutQuery.mock.calls.some(([text]) => String(text).includes("last_error_code='DELIVERY_FAILED'"))).toBe(true);
  });

  it("owns one bounded dispatcher loop and resumes after a failed tick", async () => {
    const scheduled: Array<() => void> = [];
    const onError = vi.fn();
    const dispatchNext = vi.fn()
      .mockRejectedValueOnce(new Error("postgres unavailable"))
      .mockResolvedValueOnce({ status: "delivered", eventId: "event-1", invalidation })
      .mockResolvedValue({ status: "idle" });
    const worker = new AuthorizationOutboxWorker({ dispatchNext } as never, { publish: vi.fn() }, {
      intervalMs: 10,
      onError,
      schedule: (work) => { scheduled.push(work); return work; },
      cancel: (handle) => {
        const index = scheduled.indexOf(handle as () => void);
        if (index >= 0) scheduled.splice(index, 1);
      }
    });

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "postgres unavailable" })));
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    await vi.waitFor(() => expect(dispatchNext).toHaveBeenCalledTimes(3));
    expect(scheduled).toHaveLength(1);
    worker.stop();
    expect(worker.started).toBe(false);
    expect(scheduled).toHaveLength(0);
  });
});
