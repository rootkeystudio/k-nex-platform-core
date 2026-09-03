import { describe, expect, it, vi } from "vitest";

import { RuntimeSettingsRevisionConsumer } from "../src/settings-revision-consumer.js";

const state = (settingsRevision: number) => ({
  schemaVersion: 1 as const, applicationId: "customer-alpha", environment: "production", settingsRevision
});
const invalidation = (settingsRevision: number) => ({
  schemaVersion: 1 as const,
  invalidationId: `settings-event-${settingsRevision}`,
  identity: {
    applicationId: "customer-alpha", environment: "production", descriptorId: "sales.settings.workspace",
    descriptorSchemaVersion: 1, owner: { kind: "extension" as const, deliveryClass: "platform-plugin" as const, extensionId: "module.sales", generation: 1 }
  },
  settingsRevision,
  occurredAt: "2026-09-02T00:00:00.000Z"
});

describe("RuntimeSettingsRevisionConsumer", () => {
  it("rejects foreign invalidations and waits for the authoritative revision floor", async () => {
    const readState = vi.fn().mockResolvedValueOnce(state(2)).mockResolvedValueOnce(state(3));
    const consumer = new RuntimeSettingsRevisionConsumer({ readState }, "customer-alpha", "production");

    expect(consumer.invalidate({ ...invalidation(3), identity: { ...invalidation(3).identity, applicationId: "customer-beta" } })).toBe(false);
    expect(consumer.invalidate(invalidation(3))).toBe(true);
    await expect(consumer.poll()).resolves.toBe(false);
    expect(consumer.snapshot()).toBeUndefined();
    await expect(consumer.poll()).resolves.toBe(true);
    expect(consumer.snapshot()).toEqual(state(3));
  });

  it("coalesces polls, never regresses, and retries a failed boundary advance", async () => {
    let resolve: ((value: ReturnType<typeof state>) => void) | undefined;
    const readState = vi.fn(() => new Promise<ReturnType<typeof state>>((done) => { resolve = done; }));
    const onAdvance = vi.fn();
    const consumer = new RuntimeSettingsRevisionConsumer({ readState }, "customer-alpha", "production", { onAdvance });

    const first = consumer.poll();
    const second = consumer.poll();
    expect(readState).toHaveBeenCalledTimes(1);
    resolve!(state(4));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(onAdvance).toHaveBeenCalledTimes(1);

    readState.mockResolvedValueOnce(state(3));
    await expect(consumer.poll()).resolves.toBe(false);
    expect(consumer.snapshot()).toEqual(state(4));

    readState.mockResolvedValue(state(5));
    onAdvance.mockRejectedValueOnce(new Error("cache clear failed"));
    await expect(consumer.poll()).rejects.toThrow("cache clear failed");
    expect(consumer.snapshot()).toEqual(state(4));
    await expect(consumer.poll()).resolves.toBe(true);
    expect(consumer.snapshot()).toEqual(state(5));
  });

  it("recovers a lost invalidation through one owned polling loop", async () => {
    const onError = vi.fn();
    const readState = vi.fn().mockRejectedValueOnce(new Error("postgres unavailable")).mockResolvedValueOnce(state(6));
    const scheduled: Array<() => void> = [];
    const consumer = new RuntimeSettingsRevisionConsumer({ readState }, "customer-alpha", "production", {
      intervalMs: 50,
      onError,
      schedule: (work) => { scheduled.push(work); return work; },
      cancel: (handle) => { const index = scheduled.indexOf(handle as () => void); if (index >= 0) scheduled.splice(index, 1); }
    });

    consumer.start();
    consumer.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    await vi.waitFor(() => expect(consumer.snapshot()).toEqual(state(6)));
    consumer.stop();
    expect(consumer.started).toBe(false);
    expect(scheduled).toHaveLength(0);
  });
});
