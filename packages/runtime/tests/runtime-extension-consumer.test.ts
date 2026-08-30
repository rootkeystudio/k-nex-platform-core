import { describe, expect, it, vi } from "vitest";

import { RuntimeExtensionRevisionConsumer } from "../src/runtime-extension-consumer.js";

const extension = { deliveryClass: "hot-application" as const, id: "app.sales-live" };
const observation = (revision: number, generationId = "sales-generation-1") => ({ revision, inventoryRevision: revision, generationId });

describe("RuntimeExtensionRevisionConsumer polling lifecycle", () => {
  it("owns one non-overlapping recovery loop and stops deterministically", async () => {
    let resolveFirst: ((value: ReturnType<typeof observation>) => void) | undefined;
    const observeActiveGeneration = vi.fn(() => new Promise<ReturnType<typeof observation>>((resolve) => { resolveFirst = resolve; }));
    const scheduled: Array<() => void> = [];
    const consumer = new RuntimeExtensionRevisionConsumer({ observeActiveGeneration }, "customer-alpha", "production", extension, {
      intervalMs: 50, schedule: (work) => { scheduled.push(work); return work; }, cancel: (handle) => {
        const index = scheduled.indexOf(handle as () => void);
        if (index >= 0) scheduled.splice(index, 1);
      }
    });

    consumer.start();
    consumer.start();
    expect(observeActiveGeneration).toHaveBeenCalledTimes(1);
    expect(consumer.started).toBe(true);
    resolveFirst!(observation(1));
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    scheduled.shift()!();
    expect(observeActiveGeneration).toHaveBeenCalledTimes(2);
    consumer.stop();
    expect(consumer.started).toBe(false);
    expect(scheduled).toHaveLength(0);
  });

  it("reports errors and continues polling instead of creating an unhandled loop failure", async () => {
    const onError = vi.fn();
    const observeActiveGeneration = vi.fn()
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValueOnce(observation(2, "sales-generation-2"));
    const scheduled: Array<() => void> = [];
    const consumer = new RuntimeExtensionRevisionConsumer({ observeActiveGeneration }, "customer-alpha", "production", extension, {
      intervalMs: 50, onError, schedule: (work) => { scheduled.push(work); return work; }, cancel: () => undefined
    });

    consumer.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "database temporarily unavailable" })));
    scheduled.shift()!();
    await vi.waitFor(() => expect(consumer.snapshot()).toMatchObject({ revision: 2, generationId: "sales-generation-2" }));
    consumer.stop();
  });
});
