import { describe, expect, it, vi } from "vitest";

import { PostgresSettingsOutboxDispatcher, SettingsOutboxWorker } from "../src/system-settings-outbox.js";

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  event_id: "settings-event-1", application_id: "customer-alpha", environment: "production",
  descriptor_id: "sales.settings.workspace", descriptor_schema_version: 1,
  owner_scope_key: "platform-plugin:module.sales:1",
  owner_kind: "extension", owner_namespace: null, owner_delivery_class: "platform-plugin",
  owner_extension_id: "module.sales", owner_generation: "1", settings_revision: 4,
  occurred_at: new Date("2026-09-02T00:00:00.000Z"), attempt_count: 1, claim_token: "claim-token", ...overrides
});

describe("system settings outbox", () => {
  it("publishes only the value-free persisted invalidation and acknowledges the lease", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("returning event.event_id")) return { rows: [row()] };
      if (text.startsWith("update k_nex_system_settings_outbox\n         set status='delivered'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const publish = vi.fn(async () => undefined);
    const dispatcher = new PostgresSettingsOutboxDispatcher({ query } as never, { applicationId: "customer-alpha", environment: "production", leaseMs: 20, publishTimeoutMs: 10 });

    await expect(dispatcher.dispatchNext({ publish })).resolves.toMatchObject({
      status: "delivered",
      invalidation: { settingsRevision: 4, identity: { descriptorId: "sales.settings.workspace" } }
    });
    const message = publish.mock.calls[0]?.[0];
    expect(JSON.stringify(message)).not.toMatch(/value|secret|reference/iu);
    expect(query.mock.calls.some(([text]) => String(text).includes("for update skip locked"))).toBe(true);
    expect(query.mock.calls.find(([text]) => String(text).includes("returning event.event_id"))?.[1]?.slice(0, 3)).toEqual([3, "customer-alpha", "production"]);
  });

  it("rejects malformed identity columns and releases the claim", async () => {
    const query = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row({ owner_extension_id: "module.other" })] }
      : { rows: [], rowCount: 0 });
    const dispatcher = new PostgresSettingsOutboxDispatcher({ query } as never, { applicationId: "customer-alpha", environment: "production", leaseMs: 20, publishTimeoutMs: 10 });

    await expect(dispatcher.dispatchNext({ publish: async () => undefined })).rejects.toThrow("invalid");
    expect(query.mock.calls.some(([text]) => String(text).includes("last_error_code='DELIVERY_FAILED'"))).toBe(true);
  });

  it("times out publication and leaves the event retryable", async () => {
    const query = vi.fn(async (text: string) => text.includes("returning event.event_id")
      ? { rows: [row()] }
      : { rows: [], rowCount: 0 });
    const dispatcher = new PostgresSettingsOutboxDispatcher({ query } as never, { applicationId: "customer-alpha", environment: "production", leaseMs: 20, publishTimeoutMs: 5 });

    await expect(dispatcher.dispatchNext({ publish: async () => new Promise<void>(() => {}) })).rejects.toThrow("timed out");
    expect(query.mock.calls.some(([text]) => String(text).includes("last_error_code='DELIVERY_FAILED'"))).toBe(true);
  });

  it("owns one bounded worker loop and resumes after a failed tick", async () => {
    const scheduled: Array<() => void> = [];
    const onError = vi.fn();
    const dispatchNext = vi.fn()
      .mockRejectedValueOnce(new Error("postgres unavailable"))
      .mockResolvedValueOnce({ status: "delivered", eventId: "settings-event-1", invalidation: {} })
      .mockResolvedValue({ status: "idle" });
    const worker = new SettingsOutboxWorker({ dispatchNext } as never, { publish: vi.fn() }, {
      intervalMs: 10, onError,
      schedule: (work) => { scheduled.push(work); return work; },
      cancel: (handle) => { const index = scheduled.indexOf(handle as () => void); if (index >= 0) scheduled.splice(index, 1); }
    });

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    await vi.waitFor(() => expect(dispatchNext).toHaveBeenCalledTimes(3));
    worker.stop();
    expect(scheduled).toHaveLength(0);
  });
});
