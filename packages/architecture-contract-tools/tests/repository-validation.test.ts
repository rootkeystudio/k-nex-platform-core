import { readFile } from "node:fs/promises";
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
  validateEvidenceRegistry,
  validateGeneratedDocument,
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
});
