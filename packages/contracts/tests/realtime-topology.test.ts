import { describe, expect, it } from "vitest";

import { RealtimeProcessTopologySchema } from "../src/realtime-topology.js";

const memory = {
  adapter: "memory",
  webInstances: 1,
  worker: "embedded",
  workerInvalidationPath: "direct",
  realtimeGateway: "embedded",
  rollingDeployment: "stop-before-start"
} as const;

describe("realtime deployment topology contract", () => {
  it("accepts the single-owner memory topology", () => {
    expect(RealtimeProcessTopologySchema.parse(memory)).toEqual(memory);
  });

  it("makes memory compatibility part of manifest/config schema validation", () => {
    const parsed = RealtimeProcessTopologySchema.safeParse({
      ...memory,
      webInstances: 2,
      worker: "separate",
      workerInvalidationPath: "direct",
      rollingDeployment: "overlap"
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(({ message }) => message).join(" ");
      expect(messages).toContain("MEMORY_MULTIPLE_WEB_INSTANCES");
      expect(messages).toContain("MEMORY_SEPARATE_WORKER_PUBLISHER");
      expect(messages).toContain("MEMORY_ROLLING_OVERLAP");
      expect(messages).toContain("distributed Socket.IO adapter/backplane");
    }
  });
});
