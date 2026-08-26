import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceConvergenceController, sourceFreshnessIntervalsMs } from "../src/source-convergence.js";

function harness(options: { authorized?: boolean; freshness?: "live" | "standard" | "background"; surface?: "workspace" | "other" } = {}) {
  let now = 1_000;
  let snapshot = { data: "first", revision: 1 };
  let authorized = options.authorized ?? true;
  const authorize = vi.fn(async () => authorized);
  const fetch = vi.fn(async () => snapshot);
  const controller = new SourceConvergenceController({
    authorize,
    fetch,
    freshness: options.freshness ?? "standard",
    surface: options.surface ?? "workspace",
    now: () => now
  });
  return {
    authorize,
    controller,
    fetch,
    advance(milliseconds: number) { now += milliseconds; },
    revoke() { authorized = false; },
    snapshot(value: typeof snapshot) { snapshot = value; }
  };
}

describe("source revision convergence", () => {
  afterEach(() => vi.useRealTimers());
  it("starts with an authorized authoritative fetch and ignores old invalidations", async () => {
    const test = harness();
    await expect(test.controller.initialize()).resolves.toMatchObject({ status: "ready", revision: 1, data: "first" });
    await test.controller.handleInvalidation(1);
    expect(test.fetch).toHaveBeenCalledTimes(1);
    expect(test.authorize).toHaveBeenCalledTimes(1);
  });

  it("refetches a newer revision hint and never treats the hint as state", async () => {
    const test = harness();
    await test.controller.initialize();
    test.snapshot({ data: "authoritative second", revision: 2 });
    await expect(test.controller.handleInvalidation(2)).resolves.toMatchObject({ status: "ready", revision: 2, data: "authoritative second" });
    expect(test.fetch).toHaveBeenLastCalledWith("invalidation", expect.any(AbortSignal));
    expect(test.authorize).toHaveBeenCalledTimes(2);
  });

  it("marks a lagging authoritative response stale until a later bounded revalidation converges", async () => {
    const test = harness({ freshness: "live" });
    await test.controller.initialize();
    await expect(test.controller.handleInvalidation(3)).resolves.toMatchObject({ status: "stale", revision: 1 });
    test.snapshot({ data: "caught up", revision: 3 });
    test.advance(sourceFreshnessIntervalsMs.live);
    await expect(test.controller.handlePeriodicTick()).resolves.toMatchObject({ status: "ready", revision: 3, data: "caught up" });
  });

  it("converges after a lost hint through bounded periodic revalidation", async () => {
    const test = harness({ freshness: "standard" });
    await test.controller.initialize();
    test.snapshot({ data: "changed without hint", revision: 4 });
    test.advance(sourceFreshnessIntervalsMs.standard - 1);
    await test.controller.handlePeriodicTick();
    expect(test.fetch).toHaveBeenCalledTimes(1);
    test.advance(1);
    await expect(test.controller.handlePeriodicTick()).resolves.toMatchObject({ revision: 4, data: "changed without hint" });
  });

  it("schedules bounded revalidation and wires reconnect signals during its executable lifecycle", async () => {
    vi.useFakeTimers();
    let snapshot = { data: "initial", revision: 1 };
    let reconnect = () => undefined;
    const controller = new SourceConvergenceController({
      authorize: async () => true,
      fetch: async () => snapshot,
      freshness: "live",
      now: Date.now,
      signals: {
        onInvalidation: () => () => undefined,
        onReconnect(listener) { reconnect = listener; return () => { reconnect = () => undefined; }; },
        onWindowFocus: () => () => undefined
      },
      surface: "workspace"
    });
    await controller.start();
    snapshot = { data: "changed without hint", revision: 2 };
    await vi.advanceTimersByTimeAsync(sourceFreshnessIntervalsMs.live);
    expect(controller.state).toMatchObject({ data: "changed without hint", revision: 2, status: "ready" });
    snapshot = { data: "after reconnect", revision: 3 };
    reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state).toMatchObject({ data: "after reconnect", revision: 3, status: "ready" });
    controller.stop();
  });

  it("reauthorizes and refetches whenever reconnect makes resume uncertain", async () => {
    const test = harness();
    await test.controller.initialize();
    test.snapshot({ data: "after reconnect", revision: 5 });
    await test.controller.handleReconnect();
    expect(test.fetch).toHaveBeenLastCalledWith("reconnect", expect.any(AbortSignal));
    expect(test.authorize).toHaveBeenCalledTimes(2);
    expect(test.controller.state).toMatchObject({ status: "ready", revision: 5 });
  });

  it("revalidates workspace focus after a bounded age but not other surfaces", async () => {
    const workspace = harness({ surface: "workspace" });
    await workspace.controller.initialize();
    workspace.advance(sourceFreshnessIntervalsMs.live);
    await workspace.controller.handleWindowFocus();
    expect(workspace.fetch).toHaveBeenLastCalledWith("focus", expect.any(AbortSignal));

    const other = harness({ surface: "other" });
    await other.controller.initialize();
    other.advance(sourceFreshnessIntervalsMs.background);
    await other.controller.handleWindowFocus();
    expect(other.fetch).toHaveBeenCalledTimes(1);
  });

  it("clears previously cached data when permission is revoked", async () => {
    const test = harness();
    await test.controller.initialize();
    test.revoke();
    await expect(test.controller.handleReconnect()).resolves.toEqual({
      data: null,
      lastValidatedAt: 1_000,
      revision: null,
      status: "forbidden"
    });
    expect(test.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects revision regression without overwriting newer cached state", async () => {
    const test = harness();
    test.snapshot({ data: "newer", revision: 5 });
    await test.controller.initialize();
    test.snapshot({ data: "regressed", revision: 4 });
    await test.controller.handleReconnect();
    expect(test.controller.state).toMatchObject({ status: "error", revision: 5, data: "newer" });
  });

  it("fails closed when reauthorization errors", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("private policy detail"));
    const controller = new SourceConvergenceController({
      authorize,
      fetch: async () => ({ data: "private", revision: 1 }),
      freshness: "standard",
      surface: "workspace"
    });
    await controller.initialize();
    await controller.handleReconnect();
    expect(controller.state).toMatchObject({ status: "error", data: null, revision: null });
  });

  it("clears private data on authorization timeout and retries after recovery", async () => {
    vi.useFakeTimers();
    let hang = false;
    const authorize = vi.fn((signal: AbortSignal) => {
      if (!hang) return Promise.resolve(true);
      return new Promise<boolean>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const controller = new SourceConvergenceController({
      authorize,
      fetch: async () => ({ data: "private", revision: 1 }),
      freshness: "standard",
      refreshTimeoutMs: 10,
      surface: "workspace"
    });
    await controller.initialize();
    hang = true;
    const timedOut = controller.handleReconnect();
    await vi.advanceTimersByTimeAsync(10);
    await expect(timedOut).resolves.toMatchObject({ status: "error", data: null, revision: null });
    hang = false;
    await expect(controller.handleReconnect()).resolves.toMatchObject({ status: "ready", data: "private", revision: 1 });
    expect(authorize).toHaveBeenCalledTimes(3);
  });

  it("bounds a hanging fetch and ignores its late rejection after a successful retry", async () => {
    vi.useFakeTimers();
    let hang = false;
    let rejectLate: ((error: Error) => void) | undefined;
    const fetch = vi.fn(async () => {
      if (hang) await new Promise<void>((_, reject) => { rejectLate = reject; });
      return { data: "current private", revision: 3 };
    });
    const controller = new SourceConvergenceController({
      authorize: async () => true,
      fetch,
      freshness: "standard",
      refreshTimeoutMs: 10,
      surface: "workspace"
    });
    await controller.initialize();
    hang = true;
    const timedOut = controller.handleReconnect();
    await vi.advanceTimersByTimeAsync(10);
    await expect(timedOut).resolves.toMatchObject({ status: "error", data: null, revision: null });
    hang = false;
    await expect(controller.handleReconnect()).resolves.toMatchObject({ status: "ready", data: "current private", revision: 3 });
    rejectLate?.(new Error("late private failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state).toMatchObject({ status: "ready", data: "current private", revision: 3 });
  });
});
