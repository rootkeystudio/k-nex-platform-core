import { describe, expect, it, vi } from "vitest";

import { RuntimeAuthorizationRevisionConsumer } from "../src/authorization-revision-consumer.js";

const state = (authorizationRevision: number, lifecycleRevision: number) => ({
  applicationId: "customer-alpha", environment: "production", authorizationRevision, lifecycleRevision
});
const invalidation = (authorizationRevision: number, lifecycleRevision: number, scope: "application" | "environment" = "environment") => ({
  ...state(authorizationRevision, lifecycleRevision), scope
});

describe("RuntimeAuthorizationRevisionConsumer", () => {
  it("rejects wrong owners and treats an invalidation as a revision floor until the exact state is observed", async () => {
    const readState = vi.fn()
      .mockResolvedValueOnce(state(2, 1))
      .mockResolvedValueOnce(state(3, 1));
    const consumer = new RuntimeAuthorizationRevisionConsumer({ readState }, "customer-alpha", "production");

    expect(consumer.invalidate({ ...invalidation(3, 1), applicationId: "customer-beta" })).toBe(false);
    expect(consumer.invalidate(invalidation(3, 1))).toBe(true);
    await expect(consumer.poll()).resolves.toBe(false);
    expect(consumer.snapshot()).toBeUndefined();
    await expect(consumer.poll()).resolves.toBe(true);
    expect(consumer.snapshot()).toEqual(state(3, 1));
  });

  it("fans application authorization changes across environments but keeps lifecycle hints local", async () => {
    const readState = vi.fn().mockResolvedValue(state(5, 2));
    const consumer = new RuntimeAuthorizationRevisionConsumer({ readState }, "customer-alpha", "production");

    expect(consumer.invalidate({ ...invalidation(5, 2, "environment"), environment: "staging" })).toBe(false);
    expect(consumer.invalidate({ ...invalidation(5, 2, "application"), environment: "staging" })).toBe(true);
    await expect(consumer.poll()).resolves.toBe(true);
    expect(consumer.snapshot()).toEqual(state(5, 2));
  });

  it("coalesces concurrent authoritative polls and never regresses an observed revision", async () => {
    let resolve: ((value: ReturnType<typeof state>) => void) | undefined;
    const readState = vi.fn(() => new Promise<ReturnType<typeof state>>((done) => { resolve = done; }));
    const onAdvance = vi.fn();
    const consumer = new RuntimeAuthorizationRevisionConsumer({ readState }, "customer-alpha", "production", { onAdvance });

    const first = consumer.poll();
    const second = consumer.poll();
    expect(readState).toHaveBeenCalledTimes(1);
    resolve!(state(3, 2));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(state(3, 2));
    readState.mockResolvedValueOnce(state(2, 2));
    await expect(consumer.poll()).resolves.toBe(false);
    expect(consumer.snapshot()).toEqual(state(3, 2));
  });

  it("retries an authoritative advance when its sink fails before publishing it", async () => {
    const readState = vi.fn().mockResolvedValue(state(4, 2));
    const onAdvance = vi.fn().mockRejectedValueOnce(new Error("cache clear failed"));
    const consumer = new RuntimeAuthorizationRevisionConsumer({ readState }, "customer-alpha", "production", { onAdvance });

    await expect(consumer.poll()).rejects.toThrow("cache clear failed");
    expect(consumer.snapshot()).toBeUndefined();
    await expect(consumer.poll()).resolves.toBe(true);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(consumer.snapshot()).toEqual(state(4, 2));
  });

  it("recovers from lost events with one owned polling loop and continues after errors", async () => {
    const onError = vi.fn();
    const readState = vi.fn()
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValueOnce(state(4, 2));
    const scheduled: Array<() => void> = [];
    const consumer = new RuntimeAuthorizationRevisionConsumer({ readState }, "customer-alpha", "production", {
      intervalMs: 50,
      onError,
      schedule: (work) => { scheduled.push(work); return work; },
      cancel: (handle) => {
        const index = scheduled.indexOf(handle as () => void);
        if (index >= 0) scheduled.splice(index, 1);
      }
    });

    consumer.start();
    consumer.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "database temporarily unavailable" })));
    expect(scheduled).toHaveLength(1);
    scheduled.shift()!();
    await vi.waitFor(() => expect(consumer.snapshot()).toEqual(state(4, 2)));
    consumer.stop();
    expect(consumer.started).toBe(false);
    expect(scheduled).toHaveLength(0);
  });
});
