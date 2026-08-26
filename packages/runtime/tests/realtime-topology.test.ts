import { describe, expect, it } from "vitest";

import { assertRealtimeTopologyCompatible, doctorRealtimeTopology, RealtimeTopologyError } from "../src/realtime-topology.js";

const memory = {
  adapter: "memory",
  webInstances: 1,
  worker: "embedded",
  realtimeGateway: "embedded",
  invalidationPublishers: ["web"],
  rollingDeployment: "stop-before-start"
} as const;

describe("realtime topology doctor", () => {
  it("accepts memory mode only when one process owns sockets and direct publication", () => {
    expect(doctorRealtimeTopology(memory)).toMatchObject({ ok: true, issues: [] });
    expect(assertRealtimeTopologyCompatible(memory)).toEqual(memory);
  });

  it.each([
    ["multiple web instances", { ...memory, webInstances: 2 }, "MEMORY_MULTIPLE_WEB_INSTANCES", "2 web instances"],
    ["a separate publishing worker", { ...memory, worker: "separate", invalidationPublishers: ["worker"] }, "MEMORY_SEPARATE_WORKER_PUBLISHER", "separate worker"],
    ["a separate gateway", { ...memory, realtimeGateway: "separate" }, "MEMORY_SEPARATE_GATEWAY", "separate realtime gateway"],
    ["rolling overlap", { ...memory, rollingDeployment: "overlap" }, "MEMORY_ROLLING_OVERLAP", "old and new web revisions"]
  ])("rejects %s with path-specific remedies", (_name, topology, code, path) => {
    const report = doctorRealtimeTopology(topology);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([expect.objectContaining({ code, publicationPath: expect.stringContaining(path) })]);
    expect(report.issues[0]?.remedies).toContain("select a distributed Socket.IO adapter/backplane");
    expect(() => assertRealtimeTopologyCompatible(topology)).toThrow(RealtimeTopologyError);
  });

  it("accepts distributed mode for split and rolling process topologies", () => {
    expect(doctorRealtimeTopology({
      adapter: "distributed",
      webInstances: 3,
      worker: "separate",
      realtimeGateway: "separate",
      invalidationPublishers: ["web", "worker", "realtime-gateway"],
      rollingDeployment: "overlap"
    })).toMatchObject({ ok: true, issues: [] });
  });
});
