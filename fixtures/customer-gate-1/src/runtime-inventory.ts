import { createHash } from "node:crypto";

import type { RegistrationResult } from "@k-nex/runtime";
import { canonicalJson } from "@k-nex/contracts";
import type { Endpoint } from "payload";

import resolvedJson from "../.k-nex/generated/k-nex.resolved.json" with { type: "json" };
import { applicationMigrationRevision } from "./migration-revision.js";

export function createGate1RuntimeInventory(registration: RegistrationResult) {
  return {
    schemaVersion: 1,
    applicationId: resolvedJson.application.id,
    sourceArtifact: {
      kind: "customer-config",
      digest: resolvedJson.customerConfigFingerprint
    },
    applicationManifestDigest: resolvedJson.application.manifestDigest,
    resolvedGraphDigest: `sha256:${createHash("sha256").update(canonicalJson(resolvedJson)).digest("hex")}`,
    framework: { ...resolvedJson.framework },
    plugins: resolvedJson.plugins.map(({ contributions, id, integrity, package: packageName, version }) => ({
      id,
      package: packageName,
      version,
      integrity,
      expectedContributions: structuredClone(contributions),
      actualContributions: structuredClone(registration.inventory.find((entry) => entry.id === id)?.contributions ?? {})
    })),
    migrationRevision: { ...applicationMigrationRevision }
  } as const;
}

export function createRuntimeInventoryEndpoint(inventory: ReturnType<typeof createGate1RuntimeInventory>): Endpoint {
  return {
    path: "/k-nex/runtime-inventory",
    method: "get",
    handler: async (req) => {
      const headers = { "cache-control": "private, no-store" };
      if (req.user?.collection !== "users") return Response.json({ error: "unauthorized" }, { status: 401, headers });
      return Response.json(inventory, { headers });
    }
  };
}
