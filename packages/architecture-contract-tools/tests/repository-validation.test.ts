import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/canonical-json.js";
import { validateFixtures } from "../src/fixture-validation.js";
import {
  formatDiagnostics,
  parseJsonDocument,
  repositoryFileExists,
  validateEvidenceRegistry,
  validateFixtureInventory,
  validateGeneratedArtifacts,
  validateGeneratedDocument,
  validateGeneratedInventory,
  validateLegacyText,
  validateMarkdownText,
  validateRepository
} from "../src/repository-validation.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("P0.4 executable repository validation", () => {
  it("accepts the repository through the complete TypeScript validator", async () => {
    expect(await validateRepository(repositoryRoot)).toEqual([]);
  });

  it("reports malformed JSON without throwing", () => {
    const result = parseJsonDocument("broken.json", "{");
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["JSON_INVALID"]);
  });

  it("reports schema-invalid input", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormatsModule.default(ajv);
    const pluginSchema = JSON.parse(await readFile(resolve(repositoryRoot, "schemas/plugin-manifest.v1.schema.json"), "utf8")) as AnySchema;
    const diagnostics = validateFixtures(
      [{ fixturePath: "invalid-plugin.json", schema: "plugin", value: {} }],
      { forbiddenLegacySymbols: [], identity: { capabilityIdPattern: "^.+$", pluginIdPattern: "^.+$" } },
      { application: ajv.compile({}), plugin: ajv.compile(pluginSchema) },
      new Map()
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(["SCHEMA_INVALID"]);
  });

  it("collects multiple simultaneous evidence diagnostics deterministically", () => {
    const diagnostics = validateEvidenceRegistry(
      { levels: ["design-only"], records: { "9999": { level: "unknown", evidence: ["missing.txt"] } } },
      new Set(["0001"]),
      () => false
    );
    expect(diagnostics).toHaveLength(4);
    expect(formatDiagnostics(diagnostics, "json")).toBe(formatDiagnostics([...diagnostics].reverse(), "json"));
  });

  it("catches legacy text, missing links, missing evidence, and nondeterministic generated keys", () => {
    expect(validateLegacyText("active.md", "database.primary", ["database.primary"]).map(({ code }) => code)).toEqual(["LEGACY_SYMBOL_FORBIDDEN"]);
    expect(validateMarkdownText("docs/page.md", "[missing](./missing.md)", () => false).map(({ code }) => code)).toEqual(["MARKDOWN_LINK_INVALID"]);
    expect(validateEvidenceRegistry({ levels: [], records: {} }, new Set(["0001"]), () => true).map(({ code }) => code)).toEqual(["ADR_EVIDENCE_INVALID"]);
    expect(validateGeneratedDocument("generated.json", canonicalJson({ generatedAt: "now" }), { generatedAt: "now" }).map(({ code }) => code)).toEqual(["GENERATED_ARTIFACT_INVALID"]);
  });

  it("discovers missing and stale invalid-fixture declarations", () => {
    expect(validateFixtureInventory(["fixtures/contracts/invalid/new.json"], [])).toHaveLength(1);
    expect(validateFixtureInventory([], ["fixtures/contracts/invalid/stale.json"])).toHaveLength(1);
  });

  it("rejects duplicate, unsafe, and missing generated inventory entries", () => {
    const result = validateGeneratedInventory(
      { artifacts: ["contracts/valid.json", "contracts/valid.json", "../outside.json", "contracts/missing.json"] },
      (path) => path === "contracts/valid.json"
    );
    expect(result.artifacts).toEqual(["contracts/valid.json", "contracts/missing.json"]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports malformed sidecar JSON at repository level", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "k-nex-sidecar-"));
    try {
      await mkdir(resolve(root, "contracts"));
      await writeFile(resolve(root, "contracts/generated-contracts.v1.json"), "{", "utf8");
      expect((await validateGeneratedArtifacts(root)).map(({ code }) => code)).toEqual(["JSON_INVALID"]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("validates forbidden keys in every inventoried artifact", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "k-nex-artifact-"));
    try {
      await mkdir(resolve(root, "contracts"));
      await writeFile(resolve(root, "contracts/generated-contracts.v1.json"), canonicalJson({ artifacts: ["artifact.json"], generator: "test", version: 1 }), "utf8");
      await writeFile(resolve(root, "artifact.json"), canonicalJson({ generatedAt: "now" }), "utf8");
      const diagnostics = await validateGeneratedArtifacts(root);
      expect(diagnostics.map(({ sourcePath, code }) => ({ sourcePath, code }))).toEqual([
        { sourcePath: "artifact.json", code: "GENERATED_ARTIFACT_INVALID" }
      ]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("rejects evidence paths that escape the repository", () => {
    const absolutePath = resolve(repositoryRoot, "README.md");
    const evidence = {
      levels: ["design-only"],
      records: { "0001": { level: "design-only", evidence: ["../outside", absolutePath] } }
    };
    const diagnostics = validateEvidenceRegistry(evidence, new Set(["0001"]), (path) => repositoryFileExists(repositoryRoot, path));
    expect(diagnostics).toHaveLength(2);
    expect(repositoryFileExists(repositoryRoot, "")).toBe(false);
  });
});
