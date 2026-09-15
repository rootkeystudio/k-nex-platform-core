import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PlatformReleaseTransitionManifestSchema } from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import { registerPlatformReleaseTransitionInvariantsKeyword } from "../src/platform-release-transition-invariants.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const integrity = (character: string) => `sha512-${character.repeat(86)}==`;

const valid = {
  schemaVersion: 1,
  transitionId: "platform:1.0.0-to-1.1.0",
  source: { release: "1.0.0", manifestDigest: digest("a") },
  target: { release: "1.1.0", manifestDigest: digest("b") },
  directPredecessors: ["1.0.0"],
  packages: [
    { identity: { package: "@k-nex/runtime", role: "core" }, disposition: "upgrade", source: { version: "1.0.0", integrity: integrity("A") }, target: { version: "1.1.0", integrity: integrity("C") } },
    { identity: { package: "@k-nex/module-sales", role: "plugin", pluginId: "module.sales" }, disposition: "upgrade", source: { version: "1.0.0", integrity: integrity("B") }, target: { version: "1.1.0", integrity: integrity("D") } }
  ],
  generator: { package: "@k-nex/runtime", sourceVersion: "1.0.0", targetVersion: "1.1.0", sourceSchemaVersion: 1, targetSchemaVersion: 2, managedOutputContractDigest: digest("c") },
  applicationManifest: { sourceSchemaVersion: 1, targetSchemaVersion: 1 },
  framework: {
    source: { core: "1.0.0", payload: "3.88.0", node: "24.19.0", pnpm: "11.9.0", payloadDatabaseAdapter: "postgres" },
    target: { core: "1.1.0", payload: "3.88.0", node: "24.19.0", pnpm: "11.9.0", payloadDatabaseAdapter: "postgres" }
  },
  migrations: { graphDigest: digest("d"), phases: ["offline-required"], steps: [{ id: "sales.000029.crm", phase: "offline-required" }], deliveryClassification: "maintenance-required", rollbackClassification: "source-restore-required" },
  compatibility: {
    storedDocuments: "migration-required", settings: "migration-required", themeProfiles: "compatible",
    hotApplicationHostAbiFrom: "1.0.0", hotApplicationHostAbiTo: "1.1.0",
    themeSkinHostAbiFrom: "1.0.0", themeSkinHostAbiTo: "1.1.0", catalogDigest: digest("e")
  },
  protection: {
    preUpgradeBackup: "fresh-required", maximumBackupAgeSeconds: 3600, cleanRestoreDrill: "required",
    failureRecovery: "restore-source-protection-point", postUpgradeBackup: "required", rollbackWindowSeconds: 86400
  },
  lifecycle: { publishedAt: "2026-09-15T10:00:00.000Z", expiresAt: "2027-09-15T10:00:00.000Z", support: "supported", security: "standard", revocation: { status: "active" } }
};

describe("generated platform release transition invariants", () => {
  it("keeps generated AJV validation equivalent to Zod for recomputed semantic mutations", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormatsModule.default(ajv);
    registerPlatformReleaseTransitionInvariantsKeyword(ajv);
    const schema = JSON.parse(await readFile(resolve(repositoryRoot, "schemas/platform-release-transition-manifest.v1.schema.json"), "utf8")) as AnySchema;
    const validate = ajv.compile(schema);
    expect(PlatformReleaseTransitionManifestSchema.safeParse(valid).success).toBe(true);
    expect(validate(valid), ajv.errorsText(validate.errors)).toBe(true);

    const mutations: Array<[string, (value: Record<string, any>) => void]> = [
      ["wrong predecessor", (value) => { value.directPredecessors = ["0.9.0"]; }],
      ["duplicate package", (value) => { value.packages.push(structuredClone(value.packages[0])); }],
      ["duplicate plugin id", (value) => { value.packages.push({ ...structuredClone(value.packages[1]), identity: { ...value.packages[1].identity, package: "@k-nex/module-other" } }); }],
      ["reversed releases", (value) => { value.source.release = "1.2.0"; value.packages.forEach((entry: any) => { if (entry.source) entry.source.version = "1.2.0"; }); value.framework.source.core = "1.2.0"; value.generator.sourceVersion = "1.2.0"; }],
      ["offline zero downtime", (value) => { value.migrations.deliveryClassification = "zero-downtime-eligible"; }],
      ["bad phase order", (value) => { value.migrations.phases = ["offline-required", "online-expand"]; value.migrations.steps.push({ id: "sales.000030.expand", phase: "online-expand" }); }],
      ["generator mismatch", (value) => { value.generator.package = "@k-nex/missing-generator"; }],
      ["framework mismatch", (value) => { value.framework.target.core = "1.2.0"; }],
      ["disposition endpoints", (value) => { value.packages[0].disposition = "add-for-generator"; }],
      ["stale backup escape", (value) => { value.protection.preUpgradeBackup = "restore-verified-within-window"; }],
      ["restore proof escape", (value) => { value.protection.cleanRestoreDrill = "risk-policy"; }],
      ["rollback escape", (value) => { value.migrations.rollbackClassification = "source-generation"; }]
    ];
    for (const [name, mutate] of mutations) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      expect(PlatformReleaseTransitionManifestSchema.safeParse(invalid).success, `${name} Zod`).toBe(false);
      expect(validate(invalid), `${name} AJV: ${ajv.errorsText(validate.errors)}`).toBe(false);
    }
  });
});
