import { describe, expect, it } from "vitest";

import { createRealtimeTopicRegistry, defineRealtimeTopic } from "../src/realtime.js";

const topic = () => defineRealtimeTopic({
  id: "sales.tasks",
  authorize: ({ actor, params }) => actor.id === params.ownerId,
  parseEvent(value) {
    if (typeof value !== "object" || value === null || !("revision" in value) || !Number.isSafeInteger(value.revision)) {
      throw new TypeError("event is invalid");
    }
    return value as { revision: number };
  },
  parseParams(value) {
    if (typeof value !== "object" || value === null || !("ownerId" in value) || typeof value.ownerId !== "string") {
      throw new TypeError("params are invalid");
    }
    return Object.freeze({ ownerId: value.ownerId });
  }
});

describe("realtime topic registration", () => {
  it("registers typed factories in an immutable lookup", async () => {
    const definition = topic();
    const registry = createRealtimeTopicRegistry([definition]);

    expect(registry.get("sales.tasks")).toStrictEqual(definition);
    expect(registry.get("sales.unknown")).toBeUndefined();
    expect(Object.isFrozen(registry.definitions)).toBe(true);
    expect(await definition.authorize({ actor: { id: "owner-1", type: "user" }, params: { ownerId: "owner-1" } })).toBe(true);
  });

  it("rejects invalid and duplicate topic identities", () => {
    expect(() => defineRealtimeTopic({ ...topic(), id: "raw room" })).toThrow();
    expect(() => createRealtimeTopicRegistry([topic(), topic()])).toThrow(/already registered/);
  });
});
