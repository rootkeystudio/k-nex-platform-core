import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { HotApplicationManifestSchema, TemplateAdoptionSchema, canonicalJson } from "@k-nex/contracts";

import { type FixtureInput, type FixtureSchema, validateFixtures } from "../src/fixture-validation.js";
import { registerAuthorizationOwnershipKeyword } from "../src/authorization-ownership.js";
import { registerHotApplicationAuthorizationKeyword } from "../src/hot-application-authorization.js";
import { registerPluginContributionOwnershipKeyword } from "../src/plugin-contribution-ownership.js";
import { registerSystemAdministrationInvariantsKeyword } from "../src/system-administration-invariants.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function load<T = unknown>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repositoryRoot, relativePath), "utf8")) as T;
}

async function fixture(relativePath: string, schema: FixtureSchema): Promise<FixtureInput> {
  return { fixturePath: relativePath, schema, value: await load(relativePath) };
}

const registry = await load<{
  forbiddenLegacySymbols: string[];
  identity: { capabilityIdPattern: string; pluginIdPattern: string };
}>("contracts/architecture-contracts.v1.json");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);
registerPluginContributionOwnershipKeyword(ajv);
registerAuthorizationOwnershipKeyword(ajv);
registerHotApplicationAuthorizationKeyword(ajv);
registerSystemAdministrationInvariantsKeyword(ajv);
ajv.addKeyword({
  keyword: "kNexMaxCanonicalBytes",
  type: "object",
  schemaType: "number",
  errors: false,
  validate: (maximum: number, data: unknown) => new TextEncoder().encode(canonicalJson(data)).byteLength <= maximum
});
const validators = {
  application: ajv.compile(await load<AnySchema>("schemas/application-manifest.v1.schema.json")),
  plugin: ajv.compile(await load<AnySchema>("schemas/plugin-manifest.v1.schema.json")),
  "hot-application-manifest": ajv.compile(await load<AnySchema>("schemas/hot-application-manifest.v1.schema.json")),
  authorization: ajv.compile(await load<AnySchema>("schemas/authorization.v1.schema.json")),
  "system-administration": ajv.compile(await load<AnySchema>("schemas/system-administration.v1.schema.json"))
};

const validPaths = [
  "fixtures/plugin-manifests/valid/module.sales.json",
  "fixtures/contracts/valid/application.minimal.json",
  "fixtures/customer-gate-1/k-nex.app.json",
  "fixtures/contracts/valid/provider.realtime.socketio.json",
  "fixtures/contracts/valid/theme.minimal.json",
  "fixtures/contracts/valid/authorization.platform-descriptor.json"
];
const validFixtures = await Promise.all(validPaths.map((path) => fixture(
  path,
  path.includes("authorization.") ? "authorization" : path.includes("application.") || path.endsWith("/k-nex.app.json") ? "application" : "plugin"
)));
const pluginCapabilities = new Map<string, ReadonlySet<string>>();
for (const item of validFixtures.filter(({ schema }) => schema === "plugin")) {
  const manifest = item.value as { id: string; provides?: Array<{ capability: string }> };
  pluginCapabilities.set(manifest.id, new Set((manifest.provides ?? []).map(({ capability }) => capability)));
}

const expected = await load<Record<string, { code: string; schema: FixtureSchema; validator: string }>>("fixtures/contracts/expected-diagnostics.json");
const invalidFixtures = await Promise.all(Object.entries(expected).map(([path, declaration]) => fixture(path, declaration.schema)));

describe("P0.3 contract fixtures", () => {
  it("accepts every valid fixture", () => {
    expect(validateFixtures(validFixtures, registry, validators, pluginCapabilities)).toEqual([]);
  });

  it("declares every invalid fixture exactly once", async () => {
    const files = (await readdir(resolve(repositoryRoot, "fixtures/contracts/invalid")))
      .filter((name) => name.endsWith(".json"))
      .map((name) => `fixtures/contracts/invalid/${name}`)
      .sort();
    expect(Object.keys(expected).sort()).toEqual(files);
  });

  it("covers every forbidden legacy symbol with one intentional fixture", () => {
    const legacyFixtures = invalidFixtures.filter(({ fixturePath }) => fixturePath.includes("/legacy-"));
    expect(legacyFixtures).toHaveLength(registry.forbiddenLegacySymbols.length);
    const covered = legacyFixtures.flatMap(({ fixturePath, value }) => {
      const matches = registry.forbiddenLegacySymbols.filter((symbol) => JSON.stringify(value).includes(symbol));
      expect(matches, `${fixturePath} must contain exactly one forbidden legacy symbol`).toHaveLength(1);
      return matches;
    });
    expect(new Set(covered)).toEqual(new Set(registry.forbiddenLegacySymbols));
  });

  it("keeps every legacy fixture valid against its declared JSON Schema", () => {
    for (const item of invalidFixtures.filter(({ fixturePath }) => fixturePath.includes("/legacy-"))) {
      const validate = validators[item.schema];
      expect(validate(item.value), `${item.fixturePath}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("rejects each invalid fixture with its declared primary diagnostic", () => {
    const diagnostics = validateFixtures(invalidFixtures, registry, validators, pluginCapabilities);
    expect(diagnostics).toHaveLength(invalidFixtures.length);
    expect(Object.fromEntries(diagnostics.map(({ fixturePath, code, validator }) => [fixturePath, { code, validator }]))).toEqual(
      Object.fromEntries(Object.entries(expected).map(([path, { code, validator }]) => [path, { code, validator }]))
    );
    for (const item of diagnostics) {
      expect(item.path, item.fixturePath).not.toBe("");
      expect(item.remediation, item.fixturePath).not.toBe("");
    }
  });

  it("produces the same sorted diagnostics for any fixture ordering", () => {
    const forward = validateFixtures(invalidFixtures, registry, validators, pluginCapabilities);
    const reverse = validateFixtures([...invalidFixtures].reverse(), registry, validators, pluginCapabilities);
    expect(reverse).toEqual(forward);
  });
});

describe("P10.2 Hot Application authorization parity", () => {
  it("keeps the generated schema aligned with the canonical manifest semantics", async () => {
    const validate = validators["hot-application-manifest"];
    const fixtures = [
      { path: "fixtures/extensions/valid/hot-application.manifest.json", valid: true },
      { path: "fixtures/extensions/invalid/hot-application.permission-wrong-publisher.json", valid: false },
      { path: "fixtures/extensions/invalid/hot-application.policy-undeclared-permission.json", valid: false }
    ] as const;
    for (const fixture of fixtures) {
      const value = await load(fixture.path);
      expect(HotApplicationManifestSchema.safeParse(value).success, fixture.path).toBe(fixture.valid);
      expect(validate(value), `${fixture.path}: ${ajv.errorsText(validate.errors)}`).toBe(fixture.valid);
    }
  });

  it("reports cross-manifest authorization errors as repository semantics", async () => {
    const fixtures = await Promise.all([
      fixture("fixtures/extensions/invalid/hot-application.permission-wrong-publisher.json", "hot-application-manifest"),
      fixture("fixtures/extensions/invalid/hot-application.policy-undeclared-permission.json", "hot-application-manifest")
    ]);
    expect(validateFixtures(fixtures, registry, validators, pluginCapabilities).map(({ code, validator }) => ({ code, validator }))).toEqual([
      { code: "AUTHORIZATION_OWNERSHIP_INVALID", validator: "repository-semantic" },
      { code: "AUTHORIZATION_OWNERSHIP_INVALID", validator: "repository-semantic" }
    ]);
  });

  it("does not misclassify unrelated Hot Application refinements as authorization errors", async () => {
    const value = await load<Record<string, unknown>>("fixtures/extensions/valid/hot-application.manifest.json");
    const capabilities = value.capabilities as readonly unknown[];
    const diagnostics = validateFixtures([{
      fixturePath: "fixtures/extensions/invalid/hot-application.duplicate-capability.inline.json",
      schema: "hot-application-manifest",
      value: { ...value, capabilities: [capabilities[0], capabilities[0]] }
    }], registry, validators, pluginCapabilities);
    expect(diagnostics.map(({ code, validator }) => ({ code, validator }))).toEqual([
      { code: "SCHEMA_INVALID", validator: "json-schema" }
    ]);
  });
});

describe("P10.6 template-adoption schema parity", () => {
  it("accepts only an independent instantiated-role tombstone in both Zod and AJV", async () => {
    const fixture = await load<{ contract: Record<string, unknown> }>("fixtures/contracts/valid/authorization.adoption.json");
    const independentTombstone = { ...fixture.contract, state: "tombstoned" };
    delete independentTombstone.roleId;
    const invalidLiveTombstone = { ...fixture.contract, state: "tombstoned" };
    const invalidCopiedTombstone = { ...independentTombstone, kind: "copied-permissions" };
    const candidates = [
      { value: independentTombstone, valid: true },
      { value: invalidLiveTombstone, valid: false },
      { value: invalidCopiedTombstone, valid: false }
    ] as const;
    const validate = validators.authorization;
    for (const candidate of candidates) {
      expect(TemplateAdoptionSchema.safeParse(candidate.value).success).toBe(candidate.valid);
      expect(validate({ $schema: "https://schemas.k-nex.dev/authorization.v1.schema.json", contract: candidate.value }), ajv.errorsText(validate.errors)).toBe(candidate.valid);
    }
  });
});
