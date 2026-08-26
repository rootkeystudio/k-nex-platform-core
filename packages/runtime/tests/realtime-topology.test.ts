import { describe, expect, it } from "vitest";

import { assertRealtimeTopologyCompatible, doctorRealtimeTopology, RealtimeTopologyError } from "../src/realtime-topology.js";

const memory = {
  adapter: "memory",
  webInstances: 1,
  worker: "embedded",
  workerInvalidationPath: "direct",
  realtimeGateway: "embedded",
  rollingDeployment: "stop-before-start"
} as const;

describe("realtime topology doctor", () => {
  it("accepts memory mode only when one process owns sockets and direct publication", () => {
    expect(doctorRealtimeTopology(memory)).toMatchObject({ ok: true, issues: [] });
    expect(assertRealtimeTopologyCompatible(memory)).toEqual(memory);
  });

  it.each([
    ["multiple web instances", { ...memory, webInstances: 2 }, "MEMORY_MULTIPLE_WEB_INSTANCES", "2 web instances"],
    ["a separate publishing worker", { ...memory, worker: "separate", workerInvalidationPath: "direct" }, "MEMORY_SEPARATE_WORKER_PUBLISHER", "separate worker"],
    ["a separate gateway", { ...memory, realtimeGateway: "separate" }, "MEMORY_SEPARATE_GATEWAY", "separate realtime gateway"],
    ["rolling overlap", { ...memory, rollingDeployment: "overlap" }, "MEMORY_ROLLING_OVERLAP", "old and new web revisions"]
  ])("rejects %s with path-specific remedies", (_name, topology, code, path) => {
    const report = doctorRealtimeTopology(topology);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([expect.objectContaining({ code, publicationPath: expect.stringContaining(path) })]);
    expect(report.issues[0]?.remedies).toContain("select a distributed Socket.IO adapter/backplane");
    expect(() => assertRealtimeTopologyCompatible(topology)).toThrow(RealtimeTopologyError);
  });

  it("rejects distributed mode until an executable distributed provider is installed", () => {
    const topology = {
      adapter: "distributed",
      webInstances: 3,
      worker: "separate",
      workerInvalidationPath: "direct",
      realtimeGateway: "separate",
      rollingDeployment: "overlap"
    } as const;
    expect(doctorRealtimeTopology(topology)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "DISTRIBUTED_ADAPTER_UNAVAILABLE" })]
    });
    expect(() => assertRealtimeTopologyCompatible(topology)).toThrow(RealtimeTopologyError);
  });

  it("accepts a separate worker when PostgreSQL relays invalidations to the socket owner", () => {
    expect(doctorRealtimeTopology({
      ...memory,
      worker: "separate",
      workerInvalidationPath: "postgres-outbox-relay"
    })).toMatchObject({ ok: true, issues: [] });
  });
});
