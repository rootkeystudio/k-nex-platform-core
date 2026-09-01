import { describe, expect, it } from "vitest";

import { ExtensionRevisionTracker } from "../src/index.js";

describe("ExtensionRevisionTracker", () => {
  it("converges every runtime consumer by monotonic polling after a lost invalidation", () => {
    const consumers = ["web", "worker", "runner", "browser"].map(() => new ExtensionRevisionTracker());
    const oldGeneration = { revision: 4, inventoryRevision: 8, generationId: "sales-generation-1" };
    const newGeneration = { revision: 6, inventoryRevision: 10, generationId: "sales-generation-2" };
    for (const consumer of consumers) expect(consumer.observe(oldGeneration)).toBe(true);
    expect(consumers[0]!.invalidate(10)).toBe(true);
    for (const consumer of consumers) expect(consumer.observe(newGeneration)).toBe(true);
    for (const consumer of consumers) {
      expect(consumer.observe(oldGeneration)).toBe(false);
      expect(consumer.snapshot()).toEqual(newGeneration);
    }
  });
});
