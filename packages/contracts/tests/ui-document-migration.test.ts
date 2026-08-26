import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  migrateUiDocumentToCurrent,
  UiDocumentMigrationError,
  UiDocumentSchema,
  type UiDocument
} from "../src/index.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/ui-documents");

function loadFixture(kind: "valid" | "invalid", name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureRoot, kind, name), "utf8")) as unknown;
}

describe("current UI document migration", () => {
  it.each(["cms.v1.json", "workspace.v1.json"]) ("parses and migrates the %s fixture", (name) => {
    const fixture = loadFixture("valid", name);
    expect(UiDocumentSchema.safeParse(fixture).success).toBe(true);
    expect(canonicalJson(migrateUiDocumentToCurrent(fixture))).toBe(canonicalJson(fixture));
  });

  it.each([
    "unsafe-script.json",
    "unrestricted-url.json",
    "duplicate-node-id.json",
    "non-namespaced-engine-metadata.json"
  ])("rejects the %s fixture", (name) => {
    const fixture = loadFixture("invalid", name);
    expect(UiDocumentSchema.safeParse(fixture).success).toBe(false);
    expect(() => migrateUiDocumentToCurrent(fixture)).toThrowError(UiDocumentMigrationError);
    try {
      migrateUiDocumentToCurrent(fixture);
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_DOCUMENT" });
    }
  });

  it("is deterministic, idempotent, canonical, and nonmutating", () => {
    const input = structuredClone(loadFixture("valid", "workspace.v1.json")) as UiDocument;
    const migrated = migrateUiDocumentToCurrent(input);
    const canonical = canonicalJson(migrated);

    expect(canonical).toBe(canonicalJson(loadFixture("valid", "workspace.v1.json")));
    expect(canonicalJson(migrateUiDocumentToCurrent(input))).toBe(canonical);
    expect(canonicalJson(migrateUiDocumentToCurrent(migrated))).toBe(canonical);
    expect(input).toEqual(loadFixture("valid", "workspace.v1.json"));

    (input.regions.main[0].props as Record<string, unknown>).title = "Changed by caller";
    expect(migrated.regions.main[0].props.title).toBe("Open tasks");
  });

  it("reports stable typed errors for missing and unsupported versions", () => {
    const valid = migrateUiDocumentToCurrent(loadFixture("valid", "cms.v1.json"));
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.schemaVersion;

    expect(() => migrateUiDocumentToCurrent(missing)).toThrowError(UiDocumentMigrationError);
    try {
      migrateUiDocumentToCurrent(missing);
    } catch (error) {
      expect(error).toMatchObject({ code: "MISSING_SCHEMA_VERSION" });
    }

    expect(() => migrateUiDocumentToCurrent({ ...valid, schemaVersion: 2 })).toThrowError(UiDocumentMigrationError);
    try {
      migrateUiDocumentToCurrent({ ...valid, schemaVersion: 2 });
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_SCHEMA_VERSION" });
    }
  });
});
