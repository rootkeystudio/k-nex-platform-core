import { describe, expect, it } from "vitest";

import { ApplicationManifestSchema } from "../src/application-manifest.js";
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

  it("requires explicit topology whenever realtime.gateway is selected", () => {
    const manifest = {
      schemaVersion: 1,
      application: { id: "customer-one", name: "Customer One", type: "customer-platform" },
      runtime: { node: "24.19.0", packageManager: "pnpm", packageManagerVersion: "11.9.0", deploymentMode: "container" },
      framework: { payload: { database: { adapter: "postgres", package: "@payloadcms/db-postgres", connectionEnvironmentVariable: "DATABASE_URL" } } },
      plugins: [{ id: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.0.0", enabled: true }],
      providers: { "realtime.gateway": { plugin: "provider.realtime.socketio", package: "@k-nex/provider-realtime-socketio", version: "1.0.0" } },
      themes: {},
      development: { database: { mode: "external" } },
      build: { dockerfile: false, commitGeneratedRegistries: true, validateGeneratedFilesInCI: true },
      environment: { required: ["DATABASE_URL"] }
    } as const;
    expect(ApplicationManifestSchema.safeParse(manifest).success).toBe(false);
    expect(ApplicationManifestSchema.safeParse({ ...manifest, runtime: { ...manifest.runtime, realtime: memory } }).success).toBe(true);
  });
});
