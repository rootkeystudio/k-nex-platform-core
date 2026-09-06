import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "@k-nex/contracts";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import { validateFixtures } from "../src/fixture-validation.js";
import { validatePhase13ProductContract } from "../src/phase-13-product-contract-validation.js";
import { registerPluginContributionOwnershipKeyword } from "../src/plugin-contribution-ownership.js";
import {
  declaredFixtureSchema,
  formatDiagnostics,
  parseJsonDocument,
  repositoryFileExists,
  validateEvidenceRegistry,
  validateExpectedDiagnostics,
  validateFixtureInventory,
  validateForbiddenGeneratedKeys,
  validateGeneratedArtifacts,
  validateGeneratedDocument,
  validateGeneratedInventory,
  validateLegacyText,
  validateMarkdownText,
  validateRepository,
  validateValidFixtureCoverage
} from "../src/repository-validation.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function phase13Contract(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(repositoryRoot, "contracts/phase-13-crm-product-contract.v1.json"), "utf8")) as Record<string, unknown>;
}

describe("P0.4 executable repository validation", () => {
  it("rejects Phase 13 duplicate ownership, unknown IDs, illegal transitions, ambiguous metrics, and unmapped objects", async () => {
    const duplicateOwner = structuredClone(await phase13Contract());
    (duplicateOwner.owners as Array<unknown>).push((duplicateOwner.owners as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicateOwner).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const unknownJourney = structuredClone(await phase13Contract());
    ((unknownJourney.journeys as Array<Record<string, unknown>>)[0]!.routeIds as string[])[0] = "sales.route.unknown";
    expect(validatePhase13ProductContract(unknownJourney).map(({ code }) => code)).toContain("PHASE13_UNKNOWN_ID");

    const illegalTransition = structuredClone(await phase13Contract());
    ((illegalTransition.lifecycles as Array<Record<string, unknown>>)[0]!.transitions as unknown[]).push(["qualified", "working"]);
    expect(validatePhase13ProductContract(illegalTransition).map(({ code }) => code)).toContain("PHASE13_ILLEGAL_TRANSITION");

    const ambiguousMetric = structuredClone(await phase13Contract());
    (ambiguousMetric.metrics as Array<Record<string, unknown>>)[0]!.timezone = "";
    expect(validatePhase13ProductContract(ambiguousMetric).map(({ code }) => code)).toContain("PHASE13_AMBIGUOUS_METRIC");

    const unmappedObject = structuredClone(await phase13Contract());
    (unmappedObject.objects as Array<Record<string, unknown>>)[0]!.dailyJourneyIds = [];
    expect(validatePhase13ProductContract(unmappedObject).map(({ code }) => code)).toContain("PHASE13_OBJECT_UNMAPPED");

    const orphanedLifecycle = structuredClone(await phase13Contract());
    ((orphanedLifecycle.lifecycles as Array<Record<string, unknown>>)[1]!.alsoAppliesTo as string[]).splice(0, 1);
    expect(validatePhase13ProductContract(orphanedLifecycle).map(({ code }) => code)).toContain("PHASE13_ILLEGAL_TRANSITION");

    const deletedMatrixRow = structuredClone(await phase13Contract());
    (deletedMatrixRow.permissions as Record<string, unknown>).objectFieldActionMatrix = (deletedMatrixRow.permissions as Record<string, unknown>).objectFieldActionMatrix as Array<unknown>;
    ((deletedMatrixRow.permissions as Record<string, unknown>).objectFieldActionMatrix as Array<unknown>).shift();
    expect(validatePhase13ProductContract(deletedMatrixRow).map(({ code }) => code)).toContain("PHASE13_UNKNOWN_ID");

    const misassignedPermission = structuredClone(await phase13Contract());
    (((misassignedPermission.permissions as Record<string, unknown>).personaGrants as Array<Record<string, unknown>>)[0]!.permissionIds as string[])[0] = "sales.permission.unknown";
    expect(validatePhase13ProductContract(misassignedPermission).map(({ code }) => code)).toContain("PHASE13_UNKNOWN_ID");

    const missingRouteAuthority = structuredClone(await phase13Contract());
    ((missingRouteAuthority.permissions as Record<string, unknown>).routePermissions as unknown[]).pop();
    expect(validatePhase13ProductContract(missingRouteAuthority).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    for (const section of ["target", "permissions", "lifecycles", "metrics", "attacks", "nonGoals", "dataSemantics", "retention"]) {
      const missingSection = structuredClone(await phase13Contract());
      delete missingSection[section];
      expect(validatePhase13ProductContract(missingSection).map(({ code }) => code), section).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");
    }

    const extraSection = structuredClone(await phase13Contract());
    extraSection.future = {};
    expect(validatePhase13ProductContract(extraSection).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const orphanRoute = structuredClone(await phase13Contract());
    (orphanRoute.routes as string[]).push("sales.route.orphan");
    expect(validatePhase13ProductContract(orphanRoute).map(({ code }) => code)).toContain("PHASE13_OBJECT_UNMAPPED");

    const orphanAction = structuredClone(await phase13Contract());
    (orphanAction.actions as string[]).push("sales.action.orphan");
    expect(validatePhase13ProductContract(orphanAction).map(({ code }) => code)).toContain("PHASE13_OBJECT_UNMAPPED");

    const duplicateLifecycle = structuredClone(await phase13Contract());
    (duplicateLifecycle.lifecycles as Array<unknown>).push((duplicateLifecycle.lifecycles as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicateLifecycle).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const duplicatePersona = structuredClone(await phase13Contract());
    (duplicatePersona.personas as Array<unknown>).push((duplicatePersona.personas as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicatePersona).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const duplicateGrant = structuredClone(await phase13Contract());
    const duplicateGrantPermissions = duplicateGrant.permissions as Record<string, unknown>;
    (duplicateGrantPermissions.personaGrants as Array<unknown>).push((duplicateGrantPermissions.personaGrants as Array<unknown>)[0]);
    expect(validatePhase13ProductContract(duplicateGrant).map(({ code }) => code)).toContain("PHASE13_DUPLICATE_OWNERSHIP");

    const missingPredecessor = structuredClone(await phase13Contract());
    ((missingPredecessor.predecessorInventory as Record<string, unknown>).identities as string[]).pop();
    expect(validatePhase13ProductContract(missingPredecessor).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeMigration = structuredClone(await phase13Contract());
    (unsafeMigration.migration as Record<string, unknown>).legacyTaskStatusMap = { open: "open", done: "done" };
    expect(validatePhase13ProductContract(unsafeMigration).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeScopeAdministration = structuredClone(await phase13Contract());
    ((unsafeScopeAdministration.permissions as Record<string, unknown>).scopeAdministration as Record<string, unknown>).lifecycle = "revoked scopes may auto-reactivate";
    expect(validatePhase13ProductContract(unsafeScopeAdministration).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const unsafeRelatedVocabulary = structuredClone(await phase13Contract());
    ((((unsafeRelatedVocabulary.dataSemantics as Record<string, unknown>).polymorphicRelatedTargets as Record<string, unknown>).vocabulary as string[])).pop();
    expect(validatePhase13ProductContract(unsafeRelatedVocabulary).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const missingAttackDelivery = structuredClone(await phase13Contract());
    ((missingAttackDelivery.attacks as Array<Record<string, unknown>>)[0]!).deliveryTasks = [];
    expect(validatePhase13ProductContract(missingAttackDelivery).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const wrongAttackVerification = structuredClone(await phase13Contract());
    ((wrongAttackVerification.attacks as Array<Record<string, unknown>>)[0]!).verificationTasks = ["P13.9"];
    expect(validatePhase13ProductContract(wrongAttackVerification).map(({ code }) => code)).toContain("PHASE13_PRODUCT_CONTRACT_INVALID");

    const driftMutations: Array<[string, (contract: Record<string, unknown>) => void]> = [
      ["predecessor substitution", (contract) => { ((contract.predecessorInventory as Record<string, unknown>).identities as string[])[0] = "sales.substituted"; }],
      ["dropped retirement", (contract) => { ((((contract.predecessorInventory as Record<string, unknown>).decisionGroups as Array<Record<string, unknown>>)[3]!.ids as string[])).pop(); }],
      ["added permission", (contract) => { ((contract.permissions as Record<string, unknown>).definitions as string[]).push("sales.extra.read"); }],
      ["viewer privilege widening", (contract) => { ((((contract.permissions as Record<string, unknown>).personaGrants as Array<Record<string, unknown>>)[3]!.permissionIds as string[])).push("sales.accounts.write"); }],
      ["sensitive field remap", (contract) => { (((((contract.permissions as Record<string, unknown>).objectFieldActionMatrix as Array<Record<string, unknown>>)[1]!.sensitiveFields as Record<string, unknown>))).email = "sales.contacts.read"; }],
      ["required owner removal", (contract) => { (((contract.objects as Array<Record<string, unknown>>)[0]!.requiredFields as string[])).splice(1, 1); }],
      ["lifecycle transition removal", (contract) => { (((contract.lifecycles as Array<Record<string, unknown>>)[0]!.transitions as unknown[])).pop(); }],
      ["metric formula replacement", (contract) => { (contract.metrics as Array<Record<string, unknown>>)[0]!.formula = "always zero"; }],
      ["attack task reassignment", (contract) => { (contract.attacks as Array<Record<string, unknown>>)[0]!.deliveryTasks = ["P13.9"]; }]
    ];
    for (const [name, mutate] of driftMutations) {
      const changed = structuredClone(await phase13Contract());
      mutate(changed);
      expect(validatePhase13ProductContract(changed).map(({ code }) => code), name).toContain("PHASE13_PRODUCT_CONTRACT_DRIFT");
    }
  });

  it("accepts the repository through the complete TypeScript validator", async () => {
    expect(await validateRepository(repositoryRoot)).toEqual([]);
  }, 30_000);

  it("reports malformed JSON without throwing", () => {
    const result = parseJsonDocument("broken.json", "{");
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["JSON_INVALID"]);
  });

  it("reports schema-invalid input", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormatsModule.default(ajv);
    registerPluginContributionOwnershipKeyword(ajv);
    const pluginSchema = JSON.parse(await readFile(resolve(repositoryRoot, "schemas/plugin-manifest.v1.schema.json"), "utf8")) as AnySchema;
    const diagnostics = validateFixtures(
      [{ fixturePath: "invalid-plugin.json", schema: "plugin", value: {} }],
      { forbiddenLegacySymbols: [], identity: { capabilityIdPattern: "^.+$", pluginIdPattern: "^.+$" } },
      { application: ajv.compile({}), plugin: ajv.compile(pluginSchema) },
      new Map()
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(["SCHEMA_INVALID"]);
  });

  it("keeps generated extension-plan SemVer grammar aligned with contracts", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormatsModule.default(ajv);
    const schema = JSON.parse(await readFile(resolve(repositoryRoot, "schemas/extension-install-plan.v1.schema.json"), "utf8")) as AnySchema;
    const validate = ajv.compile(schema);
    const plan = {
      schemaVersion: 1, planId: "plan-semver-1", operationId: "operation-semver-1", operation: "install", version: "1.0.0-rc.1+build.2",
      artifactDigest: `sha256:${"a".repeat(64)}`, expectedRevision: 0, approvalRequired: false, rollback: { available: false, reason: "not-requested" },
      deliveryClass: "platform-plugin", id: "module.sales", availability: { outcome: "maintenance-required", reasons: ["destructive-migration"] }
    };
    expect(validate(plan), ajv.errorsText(validate.errors)).toBe(true);
    const maxVersion = `1.0.0+${"a".repeat(58)}`;
    expect(maxVersion).toHaveLength(64);
    expect(validate({ ...plan, version: maxVersion }), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate({ ...plan, version: `${maxVersion}a` })).toBe(false);
    for (const version of ["1.0.0-01", "1.0.0-alpha..1", "1.0.0-.", "1.0.0+build..1"]) {
      expect(validate({ ...plan, version }), version).toBe(false);
    }
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
    expect(validateGeneratedDocument("generated.json", canonicalJson({ note: "generatedAt" }), { note: "generatedAt" })).toEqual([]);
    expect(validateForbiddenGeneratedKeys("generated.json", { nested: { hostname: "value" } })).toHaveLength(1);
  });

  it("validates bare relative Markdown links and ignores external links", () => {
    const checked: string[] = [];
    const diagnostics = validateMarkdownText(
      "docs/page.md",
      "[bare](guide.md) [dot](./guide.md) [external](https://example.com) [fragment](#section)",
      (target) => { checked.push(target); return false; }
    );
    expect(checked).toEqual(["guide.md", "./guide.md"]);
    expect(diagnostics).toHaveLength(2);
  });

  it("rejects malformed expected diagnostic declarations without throwing", () => {
    const result = validateExpectedDiagnostics({
      "fixtures/contracts/invalid/null.json": null,
      "fixtures/contracts/invalid/schema.json": { code: "SCHEMA_INVALID", schema: "unknown", validator: "json-schema" }
    });
    expect(result.expected).toEqual({});
    expect(result.declaredPaths).toHaveLength(2);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("requires every P0.3 valid fixture category", () => {
    expect(validateValidFixtureCoverage([]).map(({ code }) => code)).toEqual([
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING",
      "VALID_FIXTURE_MISSING"
    ]);
  });

  it("identifies fixture schemas from declarations instead of filenames", () => {
    expect(declaredFixtureSchema({ $schema: "../../../schemas/application-manifest.v1.schema.json" })).toBe("application");
    expect(declaredFixtureSchema({ $schema: "../../../schemas/plugin-manifest.v1.schema.json" })).toBe("plugin");
    expect(declaredFixtureSchema({ $schema: "https://schemas.k-nex.dev/authorization.v1.schema.json" })).toBe("authorization");
    expect(declaredFixtureSchema({})).toBeUndefined();
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
      records: { "0001": { level: "design-only", evidence: ["../outside", absolutePath, "C:/outside/file"] } }
    };
    const diagnostics = validateEvidenceRegistry(evidence, new Set(["0001"]), (path) => repositoryFileExists(repositoryRoot, path));
    expect(diagnostics).toHaveLength(3);
    expect(repositoryFileExists(repositoryRoot, "")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "../outside")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "/outside")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "C:/outside/file")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "C:outside/file")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "C:")).toBe(false);
    expect(repositoryFileExists(repositoryRoot, "README.md")).toBe(true);
  });

  it("requires repository paths to name regular non-symlink files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "k-nex-files-"));
    const outside = await mkdtemp(resolve(tmpdir(), "k-nex-outside-"));
    try {
      await mkdir(resolve(root, "directory"));
      await writeFile(resolve(outside, "target.json"), "{}\n", "utf8");
      await symlink(resolve(outside, "target.json"), resolve(root, "link.json"));
      expect(repositoryFileExists(root, "directory")).toBe(false);
      expect(repositoryFileExists(root, "link.json")).toBe(false);

      await mkdir(resolve(root, "contracts"));
      await writeFile(resolve(root, "contracts/generated-contracts.v1.json"), canonicalJson({ artifacts: ["directory", "link.json"], generator: "test", version: 1 }), "utf8");
      const diagnostics = await validateGeneratedArtifacts(root);
      expect(diagnostics.filter(({ message }) => message.includes("missing"))).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true });
      await rm(outside, { recursive: true });
    }
  });

  it("rejects non-array ADR evidence fields", () => {
    const diagnostics = validateEvidenceRegistry(
      { levels: ["design-only"], records: { "0001": { level: "design-only", evidence: "README.md" } } },
      new Set(["0001"]),
      () => true
    );
    expect(diagnostics.map(({ code }) => code)).toEqual(["ADR_EVIDENCE_INVALID"]);
  });
});
